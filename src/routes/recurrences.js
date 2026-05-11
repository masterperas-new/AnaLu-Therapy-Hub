const express = require('express');
const router = express.Router();

/* Helper: generate dates for a recurrence pattern */
function generateDates(frequency, dayOfWeek, timeOfDay, startDate, endDate) {
  const dates = [];
  const start = new Date(startDate);
  const end = new Date(endDate);
  const [hours, minutes] = timeOfDay.split(':').map(Number);

  // Find the first occurrence on or after startDate matching dayOfWeek
  const cursor = new Date(start);
  cursor.setHours(hours, minutes, 0, 0);
  while (cursor.getDay() !== dayOfWeek) {
    cursor.setDate(cursor.getDate() + 1);
  }

  const stepDays = frequency === 'weekly' ? 7 : frequency === 'biweekly' ? 14 : 0;

  while (cursor <= end) {
    if (frequency === 'monthly') {
      dates.push(new Date(cursor));
      // Advance to same weekday next month
      const targetDay = cursor.getDay();
      const weekOfMonth = Math.floor((cursor.getDate() - 1) / 7);
      cursor.setMonth(cursor.getMonth() + 1, 1);
      // Find the nth weekday of the new month
      while (cursor.getDay() !== targetDay) {
        cursor.setDate(cursor.getDate() + 1);
      }
      cursor.setDate(cursor.getDate() + weekOfMonth * 7);
      if (cursor.getDate() > 28) {
        // If we overflowed the month, skip
        cursor.setMonth(cursor.getMonth() + 1, 1);
        while (cursor.getDay() !== targetDay) {
          cursor.setDate(cursor.getDate() + 1);
        }
      }
    } else {
      dates.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + stepDays);
    }
  }

  return dates;
}

/* GET /recurrences — list all recurrences */
router.get('/', async (req, res) => {
  const { db } = require('../db/database');
  try {
    const user = req.session.user;
    let rows;
    if (user.role === 'admin') {
      rows = await db.all(`
        SELECT r.*, c.full_name AS client_name, u.full_name AS therapist_name
        FROM recurrences r
        JOIN clients c ON c.id = r.client_id
        LEFT JOIN users u ON u.id = r.user_id
        ORDER BY r.created_at DESC
      `);
    } else {
      rows = await db.all(`
        SELECT r.*, c.full_name AS client_name, u.full_name AS therapist_name
        FROM recurrences r
        JOIN clients c ON c.id = r.client_id
        LEFT JOIN users u ON u.id = r.user_id
        WHERE r.user_id = $1
        ORDER BY r.created_at DESC
      `, [user.id]);
    }
    return res.json(rows);
  } catch (err) {
    console.error('Error listing recurrences:', err);
    return res.status(500).json({ error: 'Failed to list recurrences.' });
  }
});

/* POST /recurrences/preview — preview dates without creating */
router.post('/preview', async (req, res) => {
  try {
    const { frequency, dayOfWeek, timeOfDay, startDate, endDate } = req.body;
    if (!frequency || dayOfWeek === undefined || !timeOfDay || !startDate || !endDate) {
      return res.status(400).json({ error: 'All pattern fields are required.' });
    }
    const dates = generateDates(frequency, Number(dayOfWeek), timeOfDay, startDate, endDate);
    if (dates.length > 104) {
      return res.status(400).json({ error: 'Too many dates (max 2 years / 104 weekly).' });
    }
    return res.json({ dates: dates.map((d) => d.toISOString()), count: dates.length });
  } catch (err) {
    console.error('Error previewing recurrence:', err);
    return res.status(500).json({ error: 'Failed to preview recurrence.' });
  }
});

/* POST /recurrences — create recurrence + appointments */
router.post('/', async (req, res) => {
  const { db } = require('../db/database');
  try {
    const user = req.session.user;
    const {
      clientId, frequency, dayOfWeek, timeOfDay,
      startDate, endDate, address, durationMinutes,
      feeAmount, paymentType, comments, userId,
    } = req.body;

    if (!clientId || !frequency || dayOfWeek === undefined || !timeOfDay || !startDate || !endDate || !address?.trim()) {
      return res.status(400).json({ error: 'All required fields must be filled.' });
    }

    const validFreqs = ['weekly', 'biweekly', 'monthly'];
    if (!validFreqs.includes(frequency)) {
      return res.status(400).json({ error: 'Invalid frequency.' });
    }

    const safeDuration = durationMinutes === undefined ? 60 : Number(durationMinutes);
    const safePaymentType = paymentType || null;

    let assignedUserId;
    if (user.role === 'admin') {
      if (!userId) return res.status(400).json({ error: 'Admin must select a therapist.' });
      assignedUserId = Number(userId);
      if (assignedUserId === user.id) return res.status(400).json({ error: 'Admin cannot be assigned appointments.' });
    } else {
      assignedUserId = user.id;
    }

    // Resolve fee
    let feeCents;
    if (feeAmount !== undefined && feeAmount !== null && feeAmount !== '') {
      feeCents = Math.round(Number(feeAmount) * 100);
      if (Number.isNaN(feeCents) || feeCents < 0) {
        return res.status(400).json({ error: 'Fee must be a non-negative number.' });
      }
    } else {
      const setting = await db.get("SELECT value FROM settings WHERE key = $1", ['default_fee_cents']);
      feeCents = setting ? Number(setting.value) : 6000;
    }

    // Generate dates
    const dates = generateDates(frequency, Number(dayOfWeek), timeOfDay, startDate, endDate);
    if (dates.length === 0) {
      return res.status(400).json({ error: 'No dates match the selected pattern.' });
    }
    if (dates.length > 104) {
      return res.status(400).json({ error: 'Too many occurrences (max 104). Shorten the date range.' });
    }

    // Create recurrence record
    const recResult = await db.run(`
      INSERT INTO recurrences (
        client_id, user_id, frequency, day_of_week, time_of_day,
        start_date, end_date, address, duration_minutes, fee_cents,
        payment_type, comments, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING id
    `, [
      Number(clientId), assignedUserId, frequency, Number(dayOfWeek), timeOfDay,
      startDate, endDate, address.trim(), safeDuration, feeCents,
      safePaymentType, comments || null, 'active',
    ]);

    const recurrenceId = recResult.lastID;

    // Create individual appointments
    const apptSql = `
      INSERT INTO appointments (
        client_id, user_id, appointment_date, location, fee_cents,
        duration_minutes, notes, comments, wire_received, wire_received_date,
        payment_type, recurrence_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING id
    `;

    const ids = [];
    for (const date of dates) {
      const result = await db.run(apptSql, [
        Number(clientId), assignedUserId, date.toISOString(), address.trim(), feeCents,
        safeDuration, comments || null, comments || null, 0, null,
        safePaymentType, recurrenceId,
      ]);
      ids.push(result.lastID);
    }

    return res.status(201).json({
      recurrenceId,
      count: ids.length,
      ids,
    });
  } catch (err) {
    console.error('Error creating recurrence:', err);
    return res.status(500).json({ error: 'Failed to create recurrence.' });
  }
});

/* PATCH /recurrences/:id/cancel — cancel future appointments only */
router.patch('/:id/cancel', async (req, res) => {
  const { db, isPostgres } = require('../db/database');
  try {
    const recurrenceId = Number(req.params.id);
    const user = req.session.user;

    // Verify recurrence exists and user has access
    const rec = await db.get('SELECT * FROM recurrences WHERE id = $1', [recurrenceId]);
    if (!rec) return res.status(404).json({ error: 'Recurrence not found.' });
    if (user.role !== 'admin' && rec.user_id !== user.id) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    // Delete future appointments linked to this recurrence
    const now = new Date().toISOString();
    const dateFilter = isPostgres
      ? "appointment_date::timestamp > $2::timestamp"
      : "appointment_date > $2";

    const deleteResult = await db.run(
      `DELETE FROM appointments WHERE recurrence_id = $1 AND ${dateFilter}`,
      [recurrenceId, now]
    );

    // Mark recurrence as cancelled
    await db.run(
      `UPDATE recurrences SET status = 'cancelled', cancelled_at = $1 WHERE id = $2`,
      [now, recurrenceId]
    );

    return res.json({
      cancelled: true,
      removedCount: deleteResult.changes || 0,
    });
  } catch (err) {
    console.error('Error cancelling recurrence:', err);
    return res.status(500).json({ error: 'Failed to cancel recurrence.' });
  }
});

module.exports = router;
