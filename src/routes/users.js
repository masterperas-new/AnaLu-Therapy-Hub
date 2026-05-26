const express = require('express');
const bcrypt = require('bcryptjs');

const router = express.Router();

/* List active therapists — any authenticated user (used by appointment form) */
router.get('/therapists', async (req, res) => {
  const { db } = require('../db/database');
  
  try {
    const rows = await db.all(
      "SELECT id, full_name FROM users WHERE role = $1 AND blocked = $2 ORDER BY full_name ASC",
      ['therapist', 0]
    );
    return res.json(rows);
  } catch (error) {
    console.error('Therapists fetch error:', error.message);
    return res.status(500).json({ error: 'Failed to fetch therapists.' });
  }
});

/* List users — admin only */
router.get('/', async (req, res) => {
  const { db } = require('../db/database');
  
  if (req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  try {
    const rows = await db.all(
      'SELECT id, username, role, full_name, phone, language, blocked, last_login, created_at FROM users ORDER BY full_name ASC',
      []
    );
    return res.json(rows);
  } catch (error) {
    console.error('Users fetch error:', error.message);
    return res.status(500).json({ error: 'Failed to fetch users.' });
  }
});

/* Create user — admin only */
router.post('/', async (req, res) => {
  const { db } = require('../db/database');
  
  if (req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  const { username, password, role, fullName, phone } = req.body;

  if (!username || !username.trim() || !password || password.length < 4) {
    return res.status(400).json({ error: 'Username and password (min 4 chars) are required.' });
  }

  const safeRole = role === 'admin' ? 'admin' : 'therapist';
  const defaultLanguage = safeRole === 'admin' ? 'en' : 'pt-PT';

  if (!fullName || !fullName.trim()) {
    return res.status(400).json({ error: 'Full name is required.' });
  }

  const hash = bcrypt.hashSync(password, 10);

  try {
    const result = await db.run(
      'INSERT INTO users (username, password_hash, role, full_name, phone, language) VALUES ($1, $2, $3, $4, $5, $6)',
      [username.trim(), hash, safeRole, fullName.trim(), phone || null, defaultLanguage]
    );

    return res.status(201).json({ id: result.lastID });
  } catch (error) {
    if (error.message && error.message.includes('unique')) {
      return res.status(409).json({ error: 'Username already exists.' });
    }
    console.error('User creation error:', error.message);
    return res.status(500).json({ error: 'Failed to create user.' });
  }
});

/* Update user — admin can update anyone, therapist can update self only */
router.put('/:id', async (req, res) => {
  const { db } = require('../db/database');
  
  const userId = Number(req.params.id);
  const isAdmin = req.session.user.role === 'admin';
  const isSelf = req.session.user.id === userId;

  if (!isAdmin && !isSelf) {
    return res.status(403).json({ error: 'You can only update your own profile.' });
  }

  const { fullName, phone, password, role } = req.body;

  if (!fullName || !fullName.trim()) {
    return res.status(400).json({ error: 'Full name is required.' });
  }

  const fields = ['full_name = $1', 'phone = $2'];
  const params = [fullName.trim(), phone || null];
  let paramCount = 3;

  /* Only admin can change roles */
  if (isAdmin && role) {
    const safeRole = role === 'admin' ? 'admin' : 'therapist';
    fields.push(`role = $${paramCount}`);
    params.push(safeRole);
    paramCount++;
  }

  /* Password change */
  if (password && password.length >= 4) {
    fields.push(`password_hash = $${paramCount}`);
    params.push(bcrypt.hashSync(password, 10));
    paramCount++;
  }

  params.push(userId);

  try {
    const result = await db.run(
      `UPDATE users SET ${fields.join(', ')} WHERE id = $${paramCount}`,
      params
    );

    if (result.changes === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }

    /* If self, update session */
    if (isSelf) {
      req.session.user.fullName = fullName.trim();
      req.session.user.phone = phone || null;
    }

    return res.json({ id: userId });
  } catch (error) {
    console.error('User update error:', error.message);
    return res.status(500).json({ error: 'Failed to update user.' });
  }
});

/* Save theme preference */
router.patch('/:id/theme', async (req, res) => {
  const { db } = require('../db/database');
  
  const userId = Number(req.params.id);
  if (req.session.user.id !== userId) {
    return res.status(403).json({ error: 'You can only change your own theme.' });
  }

  const { theme } = req.body;

  try {
    await db.run('UPDATE users SET theme = $1 WHERE id = $2', [theme || null, userId]);
    req.session.user.theme = theme || null;
    return res.json({ theme: theme || null });
  } catch (error) {
    console.error('Theme save error:', error.message);
    return res.status(500).json({ error: 'Failed to save theme.' });
  }
});

/* Save calendar view preference */
router.patch('/:id/calendar-view', async (req, res) => {
  const { db } = require('../db/database');

  const userId = Number(req.params.id);
  if (req.session.user.id !== userId) {
    return res.status(403).json({ error: 'You can only change your own calendar view.' });
  }

  const { calendarView } = req.body;
  const allowed = ['week', 'month'];
  const value = allowed.includes(calendarView) ? calendarView : 'week';

  try {
    await db.run('UPDATE users SET calendar_view = $1 WHERE id = $2', [value, userId]);
    req.session.user.calendarView = value;
    return res.json({ calendarView: value });
  } catch (error) {
    console.error('Calendar view save error:', error.message);
    return res.status(500).json({ error: 'Failed to save calendar view.' });
  }
});

/* Save language preference */
router.patch('/:id/language', async (req, res) => {
  const { db } = require('../db/database');

  const userId = Number(req.params.id);
  if (req.session.user.id !== userId) {
    return res.status(403).json({ error: 'You can only change your own language.' });
  }

  const { language } = req.body;
  const allowed = ['en', 'pt-PT'];
  const value = allowed.includes(language) ? language : (req.session.user.role === 'admin' ? 'en' : 'pt-PT');

  try {
    await db.run('UPDATE users SET language = $1 WHERE id = $2', [value, userId]);
    req.session.user.language = value;
    return res.json({ language: value });
  } catch (error) {
    console.error('Language save error:', error.message);
    return res.status(500).json({ error: 'Failed to save language.' });
  }
});

/* Block / unblock user — admin only, cannot block self */
router.patch('/:id/block', async (req, res) => {
  const { db } = require('../db/database');
  
  if (req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  const userId = Number(req.params.id);

  if (userId === req.session.user.id) {
    return res.status(400).json({ error: 'Cannot block your own account.' });
  }

  const { blocked } = req.body;
  const value = blocked ? 1 : 0;

  try {
    const result = await db.run('UPDATE users SET blocked = $1 WHERE id = $2', [value, userId]);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }

    return res.json({ id: userId, blocked: value });
  } catch (error) {
    console.error('User block error:', error.message);
    return res.status(500).json({ error: 'Failed to update user status.' });
  }
});

module.exports = router;
