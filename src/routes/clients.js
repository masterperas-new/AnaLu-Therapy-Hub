const express = require('express');

const router = express.Router();

// NIF (Portuguese fiscal number) validation
function isValidNIF(nif) {
  if (!nif) return true; // optional field
  const cleaned = nif.replace(/\s/g, '');
  if (!/^\d{9}$/.test(cleaned)) return false;
  const digits = cleaned.split('').map(Number);
  const sum = digits[0]*9 + digits[1]*8 + digits[2]*7 + digits[3]*6 + digits[4]*5 + digits[5]*4 + digits[6]*3 + digits[7]*2;
  let remainder = 11 - (sum % 11);
  if (remainder >= 10) remainder = 0;
  return remainder === digits[8];
}

router.get('/', async (req, res) => {
  const { db } = require('../db/database');
  const search = (req.query.q || '').trim();
  const user = req.session.user;
  const conditions = [];
  let params = [];
  let paramIdx = 1;

  // Non-admin users only see their own patients
  if (user.role !== 'admin') {
    conditions.push(`created_by = $${paramIdx++}`);
    params.push(user.id);
  }

  if (search) {
    conditions.push(`(lower(full_name) LIKE lower($${paramIdx}) OR lower(condition_notes) LIKE lower($${paramIdx + 1}))`);
    params.push(`%${search}%`, `%${search}%`);
    paramIdx += 2;
  }

  const whereSql = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  try {
    const rows = await db.all(
      `SELECT id, full_name, condition_notes, phone, email, address, nif, created_by, created_at
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

// Duplicate detection — admin only
router.get('/duplicates', async (req, res) => {
  const { db } = require('../db/database');
  const user = req.session.user;

  if (user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  try {
    // Find patients with matching NIF (exact)
    const nifDups = await db.all(`
      SELECT c1.id AS id1, c1.full_name AS name1, c1.nif, c1.created_by AS owner1,
             c2.id AS id2, c2.full_name AS name2, c2.created_by AS owner2,
             u1.full_name AS therapist1, u2.full_name AS therapist2
      FROM clients c1
      JOIN clients c2 ON c1.nif = c2.nif AND c1.id < c2.id
      LEFT JOIN users u1 ON c1.created_by = u1.id
      LEFT JOIN users u2 ON c2.created_by = u2.id
      WHERE c1.nif IS NOT NULL AND c1.nif != ''
    `);

    // Find patients with very similar names (exact match, case-insensitive)
    const nameDups = await db.all(`
      SELECT c1.id AS id1, c1.full_name AS name1, c1.nif AS nif1, c1.created_by AS owner1,
             c2.id AS id2, c2.full_name AS name2, c2.nif AS nif2, c2.created_by AS owner2,
             u1.full_name AS therapist1, u2.full_name AS therapist2
      FROM clients c1
      JOIN clients c2 ON lower(trim(c1.full_name)) = lower(trim(c2.full_name)) AND c1.id < c2.id
      LEFT JOIN users u1 ON c1.created_by = u1.id
      LEFT JOIN users u2 ON c2.created_by = u2.id
    `);

    return res.json({ nifDuplicates: nifDups, nameDuplicates: nameDups });
  } catch (error) {
    console.error('Duplicate detection error:', error.message);
    return res.status(500).json({ error: 'Failed to check duplicates.' });
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
  const { fullName, conditionNotes, phone, email, address, nif } = req.body;
  const user = req.session.user;

  if (!fullName || !fullName.trim() || !conditionNotes || !conditionNotes.trim()) {
    return res.status(400).json({ error: 'Client name and condition are required.' });
  }

  if (nif && !isValidNIF(nif)) {
    return res.status(400).json({ error: 'Invalid NIF. Must be 9 digits with a valid check digit.' });
  }

  try {
    const result = await db.run(
      'INSERT INTO clients (full_name, condition_notes, phone, email, address, nif, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [fullName.trim(), conditionNotes.trim(), phone || null, email || null, address || null, nif || null, user.id]
    );

    return res.status(201).json({
      id: result.lastID,
      fullName: fullName.trim(),
      conditionNotes: conditionNotes.trim(),
      phone: phone || null,
      email: email || null,
      nif: nif || null,
    });
  } catch (error) {
    console.error('Client creation error:', error.message);
    return res.status(500).json({ error: 'Failed to create client.' });
  }
});

router.put('/:id', async (req, res) => {
  const { db } = require('../db/database');
  const clientId = Number(req.params.id);
  const { fullName, conditionNotes, phone, email, address, nif } = req.body;
  const user = req.session.user;

  if (!Number.isInteger(clientId) || clientId <= 0) {
    return res.status(400).json({ error: 'Invalid client id.' });
  }

  if (!fullName || !fullName.trim() || !conditionNotes || !conditionNotes.trim()) {
    return res.status(400).json({ error: 'Client name and condition are required.' });
  }

  if (nif && !isValidNIF(nif)) {
    return res.status(400).json({ error: 'Invalid NIF. Must be 9 digits with a valid check digit.' });
  }

  // Non-admin: only update own patients
  if (user.role !== 'admin') {
    const owner = await db.get('SELECT created_by FROM clients WHERE id = $1', [clientId]);
    if (!owner || owner.created_by !== user.id) {
      return res.status(403).json({ error: 'You can only edit your own patients.' });
    }
  }

  try {
    const result = await db.run(
      'UPDATE clients SET full_name = $1, condition_notes = $2, phone = $3, email = $4, address = $5, nif = $6 WHERE id = $7',
      [fullName.trim(), conditionNotes.trim(), phone || null, email || null, address || null, nif || null, clientId]
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

/* ---- Insurance routes ---- */
router.get('/:id/insurances', async (req, res) => {
  const { db } = require('../db/database');
  const clientId = Number(req.params.id);

  if (!Number.isInteger(clientId) || clientId <= 0) {
    return res.status(400).json({ error: 'Invalid client id.' });
  }

  try {
    const rows = await db.all(
      'SELECT id, client_id, insurance_name, policy_number, provider_name, created_at FROM patient_insurances WHERE client_id = $1 ORDER BY insurance_name ASC',
      [clientId]
    );
    return res.json(rows);
  } catch (error) {
    console.error('Insurances fetch error:', error.message);
    return res.status(500).json({ error: 'Failed to fetch insurances.' });
  }
});

router.post('/:id/insurances', async (req, res) => {
  const { db } = require('../db/database');
  const clientId = Number(req.params.id);
  const { insuranceName, policyNumber, providerName } = req.body;

  if (!Number.isInteger(clientId) || clientId <= 0) {
    return res.status(400).json({ error: 'Invalid client id.' });
  }

  if (!insuranceName || !insuranceName.trim()) {
    return res.status(400).json({ error: 'Insurance name is required.' });
  }

  if (!providerName || !providerName.trim()) {
    return res.status(400).json({ error: 'Provider name is required.' });
  }

  const policyNum = (policyNumber || '').trim();
  if (policyNum.length > 35) {
    return res.status(400).json({ error: 'Policy number must be 35 characters or less.' });
  }

  try {
    const result = await db.run(
      'INSERT INTO patient_insurances (client_id, insurance_name, policy_number, provider_name) VALUES ($1, $2, $3, $4)',
      [clientId, insuranceName.trim(), policyNum || null, providerName.trim()]
    );
    return res.status(201).json({ id: result.lastID });
  } catch (error) {
    console.error('Insurance creation error:', error.message);
    return res.status(500).json({ error: 'Failed to create insurance.' });
  }
});

router.put('/:id/insurances/:insuranceId', async (req, res) => {
  const { db } = require('../db/database');
  const clientId = Number(req.params.id);
  const insuranceId = Number(req.params.insuranceId);
  const { insuranceName, policyNumber, providerName } = req.body;

  if (!Number.isInteger(insuranceId) || insuranceId <= 0) {
    return res.status(400).json({ error: 'Invalid insurance id.' });
  }

  if (!insuranceName || !insuranceName.trim()) {
    return res.status(400).json({ error: 'Insurance name is required.' });
  }

  if (!providerName || !providerName.trim()) {
    return res.status(400).json({ error: 'Provider name is required.' });
  }

  const policyNum = (policyNumber || '').trim();
  if (policyNum.length > 35) {
    return res.status(400).json({ error: 'Policy number must be 35 characters or less.' });
  }

  try {
    const result = await db.run(
      'UPDATE patient_insurances SET insurance_name = $1, policy_number = $2, provider_name = $3 WHERE id = $4 AND client_id = $5',
      [insuranceName.trim(), policyNum || null, providerName.trim(), insuranceId, clientId]
    );

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Insurance not found.' });
    }

    return res.json({ id: insuranceId });
  } catch (error) {
    console.error('Insurance update error:', error.message);
    return res.status(500).json({ error: 'Failed to update insurance.' });
  }
});

router.delete('/:id/insurances/:insuranceId', async (req, res) => {
  const { db } = require('../db/database');
  const clientId = Number(req.params.id);
  const insuranceId = Number(req.params.insuranceId);

  if (!Number.isInteger(insuranceId) || insuranceId <= 0) {
    return res.status(400).json({ error: 'Invalid insurance id.' });
  }

  try {
    const result = await db.run(
      'DELETE FROM patient_insurances WHERE id = $1 AND client_id = $2',
      [insuranceId, clientId]
    );

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Insurance not found.' });
    }

    return res.sendStatus(204);
  } catch (error) {
    console.error('Insurance deletion error:', error.message);
    return res.status(500).json({ error: 'Failed to delete insurance.' });
  }
});

module.exports = router;
