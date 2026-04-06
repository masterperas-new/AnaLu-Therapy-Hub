const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../db/database');

const router = express.Router();

/* List active therapists — any authenticated user (used by appointment form) */
router.get('/therapists', (req, res) => {
  db.all(
    "SELECT id, full_name FROM users WHERE role = 'therapist' AND blocked = 0 ORDER BY full_name ASC",
    [],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to fetch therapists.' });
      }

      return res.json(rows);
    }
  );
});

/* List users — admin only */
router.get('/', (req, res) => {
  if (req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  db.all(
    'SELECT id, username, role, full_name, phone, blocked, created_at FROM users ORDER BY full_name ASC',
    [],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to fetch users.' });
      }

      return res.json(rows);
    }
  );
});

/* Create user — admin only */
router.post('/', (req, res) => {
  if (req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  const { username, password, role, fullName, phone } = req.body;

  if (!username || !username.trim() || !password || password.length < 4) {
    return res.status(400).json({ error: 'Username and password (min 4 chars) are required.' });
  }

  const safeRole = role === 'admin' ? 'admin' : 'therapist';

  if (!fullName || !fullName.trim()) {
    return res.status(400).json({ error: 'Full name is required.' });
  }

  const hash = bcrypt.hashSync(password, 10);

  db.run(
    'INSERT INTO users (username, password_hash, role, full_name, phone) VALUES (?, ?, ?, ?, ?)',
    [username.trim(), hash, safeRole, fullName.trim(), phone || null],
    function insertCallback(err) {
      if (err) {
        if (err.message.includes('UNIQUE constraint')) {
          return res.status(409).json({ error: 'Username already exists.' });
        }
        return res.status(500).json({ error: 'Failed to create user.' });
      }

      return res.status(201).json({ id: this.lastID });
    }
  );
});

/* Update user — admin can update anyone, therapist can update self only */
router.put('/:id', (req, res) => {
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

  const fields = ['full_name = ?', 'phone = ?'];
  const params = [fullName.trim(), phone || null];

  /* Only admin can change roles */
  if (isAdmin && role) {
    const safeRole = role === 'admin' ? 'admin' : 'therapist';
    fields.push('role = ?');
    params.push(safeRole);
  }

  /* Password change */
  if (password && password.length >= 4) {
    fields.push('password_hash = ?');
    params.push(bcrypt.hashSync(password, 10));
  }

  params.push(userId);

  db.run(
    `UPDATE users SET ${fields.join(', ')} WHERE id = ?`,
    params,
    function updateCallback(err) {
      if (err) {
        return res.status(500).json({ error: 'Failed to update user.' });
      }

      if (this.changes === 0) {
        return res.status(404).json({ error: 'User not found.' });
      }

      /* If self, update session */
      if (isSelf) {
        req.session.user.fullName = fullName.trim();
        req.session.user.phone = phone || null;
      }

      return res.json({ id: userId });
    }
  );
});

/* Block / unblock user — admin only, cannot block self */
router.patch('/:id/block', (req, res) => {
  if (req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  const userId = Number(req.params.id);

  if (userId === req.session.user.id) {
    return res.status(400).json({ error: 'Cannot block your own account.' });
  }

  const { blocked } = req.body;
  const value = blocked ? 1 : 0;

  db.run('UPDATE users SET blocked = ? WHERE id = ?', [value, userId], function updateCallback(err) {
    if (err) {
      return res.status(500).json({ error: 'Failed to update user status.' });
    }

    if (this.changes === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }

    return res.json({ id: userId, blocked: value });
  });
});

module.exports = router;
