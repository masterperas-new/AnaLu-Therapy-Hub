const express = require('express');

const router = express.Router();

router.get('/', async (req, res) => {
  const { db } = require('../db/database');
  const search = (req.query.q || '').trim();
  let whereSql = '';
  let params = [];

  if (search) {
    whereSql = 'WHERE lower(full_name) LIKE lower($1) OR lower(condition_notes) LIKE lower($2)';
    params = [`%${search}%`, `%${search}%`];
  }

  try {
    const rows = await db.all(
      `SELECT id, full_name, condition_notes, phone, email, address, created_at
       FROM clients
       ${whereSql}
       ORDER BY full_name ASC`,
      params
    );
    return res.json(rows);
  } catch (error) {
    console.error('Clients fetch error:', error.message);
    return res.status(500).json({ error: 'Failed to fetch clients.' });
  }
});

router.get('/:id/appointments', async (req, res) => {
  const { db } = require('../db/database');
  const clientId = Number(req.params.id);
  const user = req.session.user;

  if (!Number.isInteger(clientId) || clientId <= 0) {
    return res.status(400).json({ error: 'Invalid client id.' });
  }

  let userFilter = '';
  let params = [clientId];

  if (user.role !== 'admin') {
    userFilter = 'AND a.user_id = $2';
    params.push(user.id);
  }

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
    WHERE a.client_id = $1 ${userFilter}
    ORDER BY a.appointment_date DESC
  `;

  try {
    const rows = await db.all(sql, params);
    return res.json(rows);
  } catch (error) {
    console.error('Appointment history fetch error:', error.message);
    return res.status(500).json({ error: 'Failed to fetch appointment history.' });
  }
});

router.post('/', async (req, res) => {
  const { db } = require('../db/database');
  const { fullName, conditionNotes, phone, email, address } = req.body;

  if (!fullName || !fullName.trim() || !conditionNotes || !conditionNotes.trim()) {
    return res.status(400).json({ error: 'Client name and condition are required.' });
  }

  try {
    const result = await db.run(
      'INSERT INTO clients (full_name, condition_notes, phone, email, address) VALUES ($1, $2, $3, $4, $5)',
      [fullName.trim(), conditionNotes.trim(), phone || null, email || null, address || null]
    );

    return res.status(201).json({
      id: result.lastID,
      fullName: fullName.trim(),
      conditionNotes: conditionNotes.trim(),
      phone: phone || null,
      email: email || null,
    });
  } catch (error) {
    console.error('Client creation error:', error.message);
    return res.status(500).json({ error: 'Failed to create client.' });
  }
});

router.put('/:id', async (req, res) => {
  const { db } = require('../db/database');
  const clientId = Number(req.params.id);
  const { fullName, conditionNotes, phone, email, address } = req.body;

  if (!Number.isInteger(clientId) || clientId <= 0) {
    return res.status(400).json({ error: 'Invalid client id.' });
  }

  if (!fullName || !fullName.trim() || !conditionNotes || !conditionNotes.trim()) {
    return res.status(400).json({ error: 'Client name and condition are required.' });
  }

  try {
    const result = await db.run(
      'UPDATE clients SET full_name = $1, condition_notes = $2, phone = $3, email = $4, address = $5 WHERE id = $6',
      [fullName.trim(), conditionNotes.trim(), phone || null, email || null, address || null, clientId]
    );

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Client not found.' });
    }

    return res.json({ id: clientId });
  } catch (error) {
    console.error('Client update error:', error.message);
    return res.status(500).json({ error: 'Failed to update client.' });
  }
});

router.get('/:id/comments', async (req, res) => {
  const { db } = require('../db/database');
  const clientId = Number(req.params.id);

  if (!Number.isInteger(clientId) || clientId <= 0) {
    return res.status(400).json({ error: 'Invalid client id.' });
  }

  try {
    const rows = await db.all(
      'SELECT id, client_id, comment_date, body, created_at FROM patient_comments WHERE client_id = $1 ORDER BY comment_date DESC',
      [clientId]
    );
    return res.json(rows);
  } catch (error) {
    console.error('Comments fetch error:', error.message);
    return res.status(500).json({ error: 'Failed to fetch comments.' });
  }
});

router.post('/:id/comments', async (req, res) => {
  const { db } = require('../db/database');
  const clientId = Number(req.params.id);
  const { commentDate, body } = req.body;

  if (!Number.isInteger(clientId) || clientId <= 0) {
    return res.status(400).json({ error: 'Invalid client id.' });
  }

  if (!commentDate || !body || !body.trim()) {
    return res.status(400).json({ error: 'Date and comment text are required.' });
  }

  try {
    const result = await db.run(
      'INSERT INTO patient_comments (client_id, comment_date, body) VALUES ($1, $2, $3)',
      [clientId, commentDate, body.trim()]
    );
    return res.status(201).json({ id: result.lastID });
  } catch (error) {
    console.error('Comment creation error:', error.message);
    return res.status(500).json({ error: 'Failed to create comment.' });
  }
});

router.put('/:id/comments/:commentId', async (req, res) => {
  const { db } = require('../db/database');
  const clientId = Number(req.params.id);
  const commentId = Number(req.params.commentId);
  const { commentDate, body } = req.body;

  if (!Number.isInteger(commentId) || commentId <= 0) {
    return res.status(400).json({ error: 'Invalid comment id.' });
  }

  if (!commentDate || !body || !body.trim()) {
    return res.status(400).json({ error: 'Date and comment text are required.' });
  }

  try {
    const result = await db.run(
      'UPDATE patient_comments SET comment_date = $1, body = $2 WHERE id = $3 AND client_id = $4',
      [commentDate, body.trim(), commentId, clientId]
    );

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Comment not found.' });
    }

    return res.json({ id: commentId });
  } catch (error) {
    console.error('Comment update error:', error.message);
    return res.status(500).json({ error: 'Failed to update comment.' });
  }
});

router.delete('/:id/comments/:commentId', async (req, res) => {
  const { db } = require('../db/database');
  const clientId = Number(req.params.id);
  const commentId = Number(req.params.commentId);

  if (!Number.isInteger(commentId) || commentId <= 0) {
    return res.status(400).json({ error: 'Invalid comment id.' });
  }

  try {
    const result = await db.run(
      'DELETE FROM patient_comments WHERE id = $1 AND client_id = $2',
      [commentId, clientId]
    );

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Comment not found.' });
    }

    return res.sendStatus(204);
  } catch (error) {
    console.error('Comment deletion error:', error.message);
    return res.status(500).json({ error: 'Failed to delete comment.' });
  }
});

module.exports = router;
