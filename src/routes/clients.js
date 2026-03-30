const express = require('express');
const { db } = require('../db/database');

const router = express.Router();

router.get('/', (req, res) => {
  const search = (req.query.q || '').trim();
  const whereSql = search
    ? 'WHERE lower(full_name) LIKE lower(?) OR lower(condition_notes) LIKE lower(?)'
    : '';
  const params = search ? [`%${search}%`, `%${search}%`] : [];

  db.all(
    `SELECT id, full_name, condition_notes, phone, email, created_at
     FROM clients
     ${whereSql}
     ORDER BY full_name ASC`,
    params,
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to fetch clients.' });
      }

      return res.json(rows);
    }
  );
});

router.get('/:id/appointments', (req, res) => {
  const clientId = Number(req.params.id);
  const user = req.session.user;

  if (!Number.isInteger(clientId) || clientId <= 0) {
    return res.status(400).json({ error: 'Invalid client id.' });
  }

  const userFilter = user.role !== 'admin' ? 'AND a.user_id = ?' : '';
  const params = user.role !== 'admin' ? [clientId, user.id] : [clientId];

  const sql = `
    SELECT
      a.id,
      a.client_id,
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
      a.created_at
    FROM appointments a
    WHERE a.client_id = ? ${userFilter}
    ORDER BY a.appointment_date DESC
  `;

  db.all(sql, params, (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to fetch appointment history.' });
    }

    return res.json(rows);
  });
});

router.post('/', (req, res) => {
  const { fullName, conditionNotes, phone, email } = req.body;

  if (!fullName || !fullName.trim() || !conditionNotes || !conditionNotes.trim()) {
    return res.status(400).json({ error: 'Client name and condition are required.' });
  }

  const sql = 'INSERT INTO clients (full_name, condition_notes, phone, email) VALUES (?, ?, ?, ?)';
  db.run(
    sql,
    [fullName.trim(), conditionNotes.trim(), phone || null, email || null],
    function insertCallback(err) {
      if (err) {
        return res.status(500).json({ error: 'Failed to create client.' });
      }

      return res.status(201).json({
        id: this.lastID,
        fullName: fullName.trim(),
        conditionNotes: conditionNotes.trim(),
        phone: phone || null,
        email: email || null,
      });
    }
  );
});

router.put('/:id', (req, res) => {
  const clientId = Number(req.params.id);
  const { fullName, conditionNotes, phone, email } = req.body;

  if (!Number.isInteger(clientId) || clientId <= 0) {
    return res.status(400).json({ error: 'Invalid client id.' });
  }

  if (!fullName || !fullName.trim() || !conditionNotes || !conditionNotes.trim()) {
    return res.status(400).json({ error: 'Client name and condition are required.' });
  }

  db.run(
    'UPDATE clients SET full_name = ?, condition_notes = ?, phone = ?, email = ? WHERE id = ?',
    [fullName.trim(), conditionNotes.trim(), phone || null, email || null, clientId],
    function updateCallback(err) {
      if (err) {
        return res.status(500).json({ error: 'Failed to update client.' });
      }

      if (this.changes === 0) {
        return res.status(404).json({ error: 'Client not found.' });
      }

      return res.json({ id: clientId });
    }
  );
});

router.get('/:id/comments', (req, res) => {
  const clientId = Number(req.params.id);

  if (!Number.isInteger(clientId) || clientId <= 0) {
    return res.status(400).json({ error: 'Invalid client id.' });
  }

  db.all(
    'SELECT id, client_id, comment_date, body, created_at FROM patient_comments WHERE client_id = ? ORDER BY comment_date DESC',
    [clientId],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to fetch comments.' });
      }

      return res.json(rows);
    }
  );
});

router.post('/:id/comments', (req, res) => {
  const clientId = Number(req.params.id);
  const { commentDate, body } = req.body;

  if (!Number.isInteger(clientId) || clientId <= 0) {
    return res.status(400).json({ error: 'Invalid client id.' });
  }

  if (!commentDate || !body || !body.trim()) {
    return res.status(400).json({ error: 'Date and comment text are required.' });
  }

  db.run(
    'INSERT INTO patient_comments (client_id, comment_date, body) VALUES (?, ?, ?)',
    [clientId, commentDate, body.trim()],
    function insertCallback(err) {
      if (err) {
        return res.status(500).json({ error: 'Failed to create comment.' });
      }

      return res.status(201).json({ id: this.lastID });
    }
  );
});

router.put('/:id/comments/:commentId', (req, res) => {
  const clientId = Number(req.params.id);
  const commentId = Number(req.params.commentId);
  const { commentDate, body } = req.body;

  if (!Number.isInteger(commentId) || commentId <= 0) {
    return res.status(400).json({ error: 'Invalid comment id.' });
  }

  if (!commentDate || !body || !body.trim()) {
    return res.status(400).json({ error: 'Date and comment text are required.' });
  }

  db.run(
    'UPDATE patient_comments SET comment_date = ?, body = ? WHERE id = ? AND client_id = ?',
    [commentDate, body.trim(), commentId, clientId],
    function updateCallback(err) {
      if (err) {
        return res.status(500).json({ error: 'Failed to update comment.' });
      }

      if (this.changes === 0) {
        return res.status(404).json({ error: 'Comment not found.' });
      }

      return res.json({ id: commentId });
    }
  );
});

router.delete('/:id/comments/:commentId', (req, res) => {
  const clientId = Number(req.params.id);
  const commentId = Number(req.params.commentId);

  if (!Number.isInteger(commentId) || commentId <= 0) {
    return res.status(400).json({ error: 'Invalid comment id.' });
  }

  db.run(
    'DELETE FROM patient_comments WHERE id = ? AND client_id = ?',
    [commentId, clientId],
    function deleteCallback(err) {
      if (err) {
        return res.status(500).json({ error: 'Failed to delete comment.' });
      }

      if (this.changes === 0) {
        return res.status(404).json({ error: 'Comment not found.' });
      }

      return res.sendStatus(204);
    }
  );
});

module.exports = router;
