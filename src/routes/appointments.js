const express = require('express');

const router = express.Router();

function parseBoolFilter(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  if (value === '1' || value === 'true') {
    return 1;
  }

  if (value === '0' || value === 'false') {
    return 0;
  }

  return null;
}

async function getDefaultFeeCents() {
  const { db } = require("../db/database");
  try {
    const row = await db.get(
      "SELECT value FROM settings WHERE key = $1",
      ['default_fee_cents']
    );
    return Number(row?.value || 0);
  } catch (err) {
    console.error('Error fetching default fee cents:', err);
    throw err;
  }
}

router.get('/', async (req, res) => {
  const { db } = require("../db/database");
  try {
    const { month, start, end, q, clientId, wireReceived, paymentType, from, to, userId } = req.query;
    const user = req.session.user;

    const filters = [];
    const params = [];
    let paramIndex = 1;

    /* Role-based filter: therapists see only their own appointments */
    if (user.role !== 'admin') {
      filters.push(`a.user_id = $${paramIndex}`);
      params.push(user.id);
      paramIndex++;
    } else if (userId) {
      filters.push(`a.user_id = $${paramIndex}`);
      params.push(Number(userId));
      paramIndex++;
    }

    if (month) {
      filters.push(`to_char(a.appointment_date, 'YYYY-MM') = $${paramIndex}`);
      params.push(month);
      paramIndex++;
    }

    if (start && end) {
      filters.push(`a.appointment_date >= $${paramIndex} AND a.appointment_date < $${paramIndex + 1}`);
      params.push(start, end);
      paramIndex += 2;
    }

    if (from) {
      filters.push(`a.appointment_date >= $${paramIndex}`);
      params.push(from);
      paramIndex++;
    }

    if (to) {
      filters.push(`a.appointment_date <= $${paramIndex}`);
      params.push(to);
      paramIndex++;
    }

    if (q && q.trim()) {
      filters.push(`(LOWER(c.full_name) LIKE LOWER($${paramIndex}) OR LOWER(COALESCE(a.comments, a.notes, '')) LIKE LOWER($${paramIndex + 1}))`);
      params.push(`%${q.trim()}%`, `%${q.trim()}%`);
      paramIndex += 2;
    }

    if (clientId) {
      filters.push(`a.client_id = $${paramIndex}`);
      params.push(Number(clientId));
      paramIndex++;
    }

    const paidFilter = parseBoolFilter(wireReceived);
    if (paidFilter !== null) {
      filters.push(`a.wire_received = $${paramIndex}`);
      params.push(paidFilter);
      paramIndex++;
    }

    if (paymentType && paymentType.trim()) {
      filters.push(`a.payment_type = $${paramIndex}`);
      params.push(paymentType.trim());
      paramIndex++;
    }

    const whereSql = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

    const sql = `
      SELECT
        a.id,
        a.client_id,
        c.full_name,
        c.condition_notes,
        a.appointment_date,
        a.location,
        a.fee_cents,
        a.duration_minutes,
        a.notes,
        a.comments,
        a.wire_received,
        a.wire_received_date,
        a.payment_type,
        a.user_id,
        u.full_name AS therapist_name,
        a.created_at
      FROM appointments a
      JOIN clients c ON c.id = a.client_id
      LEFT JOIN users u ON u.id = a.user_id
      ${whereSql}
      ORDER BY a.appointment_date DESC
    `;

    const rows = await db.all(sql, params);
    return res.json(rows);
  } catch (err) {
    console.error('Error fetching appointments:', err);
    return res.status(500).json({ error: 'Failed to fetch appointments.' });
  }
});

router.get('/:id', async (req, res) => {
  const { db } = require("../db/database");
  try {
    const appointmentId = Number(req.params.id);
    const user = req.session.user;

    if (!Number.isInteger(appointmentId) || appointmentId <= 0) {
      return res.status(400).json({ error: 'Invalid appointment id.' });
    }

    const userFilter = user.role !== 'admin' ? `AND a.user_id = $2` : '';
    const params = user.role !== 'admin' ? [appointmentId, user.id] : [appointmentId];

    const sql = `
      SELECT
        a.id,
        a.client_id,
        c.full_name,
        a.appointment_date,
        a.location,
        a.fee_cents,
        a.duration_minutes,
        a.notes,
        a.comments,
        a.wire_received,
        a.wire_received_date,
        a.payment_type,
        a.user_id,
        u.full_name AS therapist_name,
        a.created_at
      FROM appointments a
      JOIN clients c ON c.id = a.client_id
      LEFT JOIN users u ON u.id = a.user_id
      WHERE a.id = $1 ${userFilter}
    `;

    const row = await db.get(sql, params);

    if (!row) {
      return res.status(404).json({ error: 'Appointment not found.' });
    }

    return res.json(row);
  } catch (err) {
    console.error('Error fetching appointment:', err);
    return res.status(500).json({ error: 'Failed to fetch appointment.' });
  }
});

router.post('/', async (req, res) => {
  const { db } = require("../db/database");
  try {
    const {
      clientId,
      appointmentDate,
      address,
      feeAmount,
      durationMinutes,
      comments,
      wireReceived,
      paymentType,
      userId,
    } = req.body;
    const user = req.session.user;
    const safeDuration = durationMinutes === undefined ? 60 : Number(durationMinutes);
    const safePaymentType = paymentType || null;
    const feeProvided = feeAmount !== undefined && feeAmount !== null && feeAmount !== '';

    if (!clientId || !appointmentDate || !address || !address.trim()) {
      return res.status(400).json({ error: 'Client, date, and address are required.' });
    }

    if (Number.isNaN(safeDuration) || safeDuration <= 0) {
      return res.status(400).json({ error: 'Duration must be a positive number of minutes.' });
    }

    /* Determine which therapist owns this appointment */
    let assignedUserId;
    if (user.role === 'admin') {
      if (!userId) {
        return res.status(400).json({ error: 'Admin must select a therapist for the appointment.' });
      }
      assignedUserId = Number(userId);
      if (assignedUserId === user.id) {
        return res.status(400).json({ error: 'Admin cannot be assigned appointments.' });
      }
    } else {
      assignedUserId = user.id;
    }

    /* Block payment on future appointments */
    const isFuture = new Date(appointmentDate) > new Date();
    const paid = (wireReceived && !isFuture) ? 1 : 0;
    const paidDate = paid ? new Date().toISOString() : null;

    let feeCents;
    if (feeProvided) {
      feeCents = Math.round(Number(feeAmount) * 100);
      if (Number.isNaN(feeCents) || feeCents < 0) {
        return res.status(400).json({ error: 'Fee must be a non-negative number.' });
      }
    } else {
      feeCents = await getDefaultFeeCents();
    }

    const sql = `
      INSERT INTO appointments (
        client_id,
        user_id,
        appointment_date,
        location,
        fee_cents,
        duration_minutes,
        notes,
        comments,
        wire_received,
        wire_received_date,
        payment_type
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING id
    `;

    const result = await db.run(
      sql,
      [
        Number(clientId),
        assignedUserId,
        appointmentDate,
        address.trim(),
        feeCents,
        safeDuration,
        comments || null,
        comments || null,
        paid,
        paidDate,
        safePaymentType,
      ]
    );

    return res.status(201).json({ id: result.id });
  } catch (err) {
    console.error('Error creating appointment:', err);
    return res.status(500).json({ error: 'Failed to create appointment.' });
  }
});

router.put('/:id', async (req, res) => {
  const { db } = require("../db/database");
  try {
    const appointmentId = Number(req.params.id);
    const user = req.session.user;
    const {
      clientId,
      appointmentDate,
      address,
      feeAmount,
      durationMinutes,
      comments,
      wireReceived,
      paymentType,
      userId,
    } = req.body;

    const feeCents = Math.round(Number(feeAmount) * 100);
    const safeDuration = Number(durationMinutes);
    const safePaymentType = paymentType || null;

    if (!Number.isInteger(appointmentId) || appointmentId <= 0) {
      return res.status(400).json({ error: 'Invalid appointment id.' });
    }

    if (!clientId || !appointmentDate || !address || !address.trim()) {
      return res.status(400).json({ error: 'Client, date, and address are required.' });
    }

    if (Number.isNaN(feeCents) || feeCents < 0) {
      return res.status(400).json({ error: 'Fee must be a non-negative number.' });
    }

    if (Number.isNaN(safeDuration) || safeDuration <= 0) {
      return res.status(400).json({ error: 'Duration must be a positive number of minutes.' });
    }

    /* Block payment on future appointments */
    const isFuture = new Date(appointmentDate) > new Date();
    if (wireReceived && isFuture) {
      return res.status(400).json({ error: 'Future appointments cannot be marked as paid.' });
    }
    const paid = wireReceived ? 1 : 0;
    const paidDate = paid ? new Date().toISOString() : null;

    /* Admin can reassign therapist; therapist can only edit own */
    // userFilter will be calculated after determining final param index
    const assignedUserId = (user.role === 'admin' && userId) ? Number(userId) : null;

    if (assignedUserId && assignedUserId === user.id) {
      return res.status(400).json({ error: 'Admin cannot be assigned appointments.' });
    }

    const setCols = [
      'client_id = $1',
      'appointment_date = $2',
      'location = $3',
      'fee_cents = $4',
      'duration_minutes = $5',
      'notes = $6',
      'comments = $7',
      'wire_received = $8',
      'wire_received_date = $9',
      'payment_type = $10',
    ];
    const updateParams = [
      Number(clientId),
      appointmentDate,
      address.trim(),
      feeCents,
      safeDuration,
      comments || null,
      comments || null,
      paid,
      paidDate,
      safePaymentType,
    ];

    let paramIndex = 11;
    if (assignedUserId) {
      paramIndex++;
      setCols.push(`user_id = $${paramIndex}`);
      updateParams.push(assignedUserId);
    }

    paramIndex++;
    const idParamIndex = paramIndex;
    updateParams.push(appointmentId);
    
    let userFilter = '';
    if (user.role !== 'admin') {
      paramIndex++;
      userFilter = ` AND user_id = $${paramIndex}`;
      updateParams.push(user.id);
    }

    const sql = `UPDATE appointments SET ${setCols.join(', ')} WHERE id = $${idParamIndex}$${userFilter}`;

    const result = await db.run(sql, updateParams);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Appointment not found.' });
    }

    return res.json({ id: appointmentId });
  } catch (err) {
    console.error('Error updating appointment:', err);
    return res.status(500).json({ error: 'Failed to update appointment.' });
  }
});

router.patch('/:id/payment-received', async (req, res) => {
  const { db } = require("../db/database");
  try {
    const { id } = req.params;
    const user = req.session.user;
    const body = req.body || {};
    const paymentDate = new Date().toISOString();
    const safePaymentType = body.paymentType || null;

    /* Block payment on future appointments */
    const userCheckFilter = user.role !== 'admin' ? `AND user_id = $2` : '';
    const checkParams = user.role !== 'admin' ? [id, user.id] : [id];

    const checkRow = await db.get(
      `SELECT appointment_date FROM appointments WHERE id = $1 ${userCheckFilter}`,
      checkParams
    );

    if (!checkRow) {
      return res.status(404).json({ error: 'Appointment not found.' });
    }

    if (new Date(checkRow.appointment_date) > new Date()) {
      return res.status(400).json({ error: 'Future appointments cannot be marked as paid.' });
    }

    const userFilter = user.role !== 'admin' ? `AND user_id = $4` : '';
    const params = [paymentDate, safePaymentType, id];
    if (user.role !== 'admin') params.push(user.id);

    const result = await db.run(
      `UPDATE appointments SET wire_received = 1, wire_received_date = $1, payment_type = COALESCE($2, payment_type) WHERE id = $3 ${userFilter}`,
      params
    );

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Appointment not found.' });
    }

    return res.json({ id: Number(id), paymentReceived: true, paymentDate, paymentType: safePaymentType });
  } catch (err) {
    console.error('Error updating payment status:', err);
    return res.status(500).json({ error: 'Failed to update payment status.' });
  }
});

router.delete('/:id', async (req, res) => {
  const { db } = require("../db/database");
  try {
    const appointmentId = Number(req.params.id);
    const user = req.session.user;

    if (!Number.isInteger(appointmentId) || appointmentId <= 0) {
      return res.status(400).json({ error: 'Invalid appointment id.' });
    }

    const userFilter = user.role !== 'admin' ? `AND user_id = $2` : '';
    const params = [appointmentId];
    if (user.role !== 'admin') params.push(user.id);

    const result = await db.run(
      `DELETE FROM appointments WHERE id = $1 ${userFilter}`,
      params
    );

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Appointment not found.' });
    }

    return res.status(204).send();
  } catch (err) {
    console.error('Error deleting appointment:', err);
    return res.status(500).json({ error: 'Failed to delete appointment.' });
  }
});

module.exports = router;
