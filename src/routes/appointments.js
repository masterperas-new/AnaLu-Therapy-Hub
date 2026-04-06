const express = require('express');
const { db } = require('../db/database');

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

function getDefaultFeeCents(callback) {
  db.get(
    "SELECT value FROM settings WHERE key = 'default_fee_cents'",
    [],
    (err, row) => {
      if (err) {
        return callback(err);
      }

      return callback(null, Number(row?.value || 0));
    }
  );
}

router.get('/', (req, res) => {
  const { month, start, end, q, clientId, wireReceived, paymentType, from, to, userId } = req.query;
  const user = req.session.user;

  const filters = [];
  const params = [];

  /* Role-based filter: therapists see only their own appointments */
  if (user.role !== 'admin') {
    filters.push('a.user_id = ?');
    params.push(user.id);
  } else if (userId) {
    filters.push('a.user_id = ?');
    params.push(Number(userId));
  }

  if (month) {
    filters.push("strftime('%Y-%m', a.appointment_date) = ?");
    params.push(month);
  }

  if (start && end) {
    filters.push('a.appointment_date >= ? AND a.appointment_date < ?');
    params.push(start, end);
  }

  if (from) {
    filters.push('a.appointment_date >= ?');
    params.push(from);
  }

  if (to) {
    filters.push('a.appointment_date <= ?');
    params.push(to);
  }

  if (q && q.trim()) {
    filters.push('(lower(c.full_name) LIKE lower(?) OR lower(COALESCE(a.comments, a.notes, \"\")) LIKE lower(?))');
    params.push(`%${q.trim()}%`, `%${q.trim()}%`);
  }

  if (clientId) {
    filters.push('a.client_id = ?');
    params.push(Number(clientId));
  }

  const paidFilter = parseBoolFilter(wireReceived);
  if (paidFilter !== null) {
    filters.push('a.wire_received = ?');
    params.push(paidFilter);
  }

  if (paymentType && paymentType.trim()) {
    filters.push('a.payment_type = ?');
    params.push(paymentType.trim());
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

  db.all(sql, params, (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to fetch appointments.' });
    }

    return res.json(rows);
  });
});

router.get('/:id', (req, res) => {
  const appointmentId = Number(req.params.id);
  const user = req.session.user;

  if (!Number.isInteger(appointmentId) || appointmentId <= 0) {
    return res.status(400).json({ error: 'Invalid appointment id.' });
  }

  const userFilter = user.role !== 'admin' ? 'AND a.user_id = ?' : '';
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
    WHERE a.id = ? ${userFilter}
  `;

  db.get(sql, params, (err, row) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to fetch appointment.' });
    }

    if (!row) {
      return res.status(404).json({ error: 'Appointment not found.' });
    }

    return res.json(row);
  });
});

router.post('/', (req, res) => {
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
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  /* Block payment on future appointments */
  const isFuture = new Date(appointmentDate) > new Date();
  const paid = (wireReceived && !isFuture) ? 1 : 0;
  const paidDate = paid ? new Date().toISOString() : null;

  const insertWithFee = (feeCents) => {
    db.run(
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
      ],
      function insertCallback(err) {
        if (err) {
          return res.status(500).json({ error: 'Failed to create appointment.' });
        }

        return res.status(201).json({ id: this.lastID });
      }
    );
  };

  if (feeProvided) {
    const feeCents = Math.round(Number(feeAmount) * 100);
    if (Number.isNaN(feeCents) || feeCents < 0) {
      return res.status(400).json({ error: 'Fee must be a non-negative number.' });
    }

    return insertWithFee(feeCents);
  }

  return getDefaultFeeCents((err, defaultFeeCents) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to read default fee setting.' });
    }

    return insertWithFee(defaultFeeCents);
  });
});

router.put('/:id', (req, res) => {
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
  const userFilter = user.role !== 'admin' ? 'AND user_id = ?' : '';
  const assignedUserId = (user.role === 'admin' && userId) ? Number(userId) : null;

  if (assignedUserId && assignedUserId === user.id) {
    return res.status(400).json({ error: 'Admin cannot be assigned appointments.' });
  }

  const setCols = [
    'client_id = ?',
    'appointment_date = ?',
    'location = ?',
    'fee_cents = ?',
    'duration_minutes = ?',
    'notes = ?',
    'comments = ?',
    'wire_received = ?',
    'wire_received_date = ?',
    'payment_type = ?',
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

  if (assignedUserId) {
    setCols.push('user_id = ?');
    updateParams.push(assignedUserId);
  }

  updateParams.push(appointmentId);
  if (user.role !== 'admin') updateParams.push(user.id);

  db.run(
    `UPDATE appointments SET ${setCols.join(', ')} WHERE id = ? ${userFilter}`,
    updateParams,
    function updateCallback(err) {
      if (err) {
        return res.status(500).json({ error: 'Failed to update appointment.' });
      }

      if (this.changes === 0) {
        return res.status(404).json({ error: 'Appointment not found.' });
      }

      return res.json({ id: appointmentId });
    }
  );
});

router.patch('/:id/payment-received', (req, res) => {
  const { id } = req.params;
  const user = req.session.user;
  const body = req.body || {};
  const paymentDate = new Date().toISOString();
  const safePaymentType = body.paymentType || null;

  /* Block payment on future appointments */
  const userCheckFilter = user.role !== 'admin' ? 'AND user_id = ?' : '';
  const checkParams = user.role !== 'admin' ? [id, user.id] : [id];
  db.get(`SELECT appointment_date FROM appointments WHERE id = ? ${userCheckFilter}`, checkParams, (checkErr, row) => {
    if (checkErr) return res.status(500).json({ error: 'Failed to check appointment.' });
    if (!row) return res.status(404).json({ error: 'Appointment not found.' });
    if (new Date(row.appointment_date) > new Date()) {
      return res.status(400).json({ error: 'Future appointments cannot be marked as paid.' });
    }

  const userFilter = user.role !== 'admin' ? 'AND user_id = ?' : '';
  const params = [paymentDate, safePaymentType, id];
  if (user.role !== 'admin') params.push(user.id);

  db.run(
    `UPDATE appointments SET wire_received = 1, wire_received_date = ?, payment_type = COALESCE(?, payment_type) WHERE id = ? ${userFilter}`,
    params,
    function updateCallback(err) {
      if (err) {
        return res.status(500).json({ error: 'Failed to update payment status.' });
      }

      if (this.changes === 0) {
        return res.status(404).json({ error: 'Appointment not found.' });
      }

      return res.json({ id: Number(id), paymentReceived: true, paymentDate, paymentType: safePaymentType });
    }
  );
  });
});

router.delete('/:id', (req, res) => {
  const appointmentId = Number(req.params.id);
  const user = req.session.user;

  if (!Number.isInteger(appointmentId) || appointmentId <= 0) {
    return res.status(400).json({ error: 'Invalid appointment id.' });
  }

  const userFilter = user.role !== 'admin' ? 'AND user_id = ?' : '';
  const params = [appointmentId];
  if (user.role !== 'admin') params.push(user.id);

  db.run(`DELETE FROM appointments WHERE id = ? ${userFilter}`, params, function deleteCallback(err) {
    if (err) {
      return res.status(500).json({ error: 'Failed to delete appointment.' });
    }

    if (this.changes === 0) {
      return res.status(404).json({ error: 'Appointment not found.' });
    }

    return res.status(204).send();
  });
});

module.exports = router;
