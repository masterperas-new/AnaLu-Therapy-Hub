const express = require('express');
const bcrypt = require('bcryptjs');

const router = express.Router();

router.get('/session', (req, res) => {
  if (req.session && req.session.user) {
    return res.json({
      authenticated: true,
      user: {
        id: req.session.user.id,
        username: req.session.user.username,
        role: req.session.user.role,
        fullName: req.session.user.fullName,
        phone: req.session.user.phone,
        theme: req.session.user.theme || null,
      },
    });
  }
  return res.json({ authenticated: false });
});

router.post('/login', async (req, res) => {
  const { db } = require('../db/database');
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(401).json({ error: 'Username and password are required.' });
  }

  try {
    const user = await db.get(
      'SELECT id, username, password_hash, role, full_name, phone, blocked, theme FROM users WHERE LOWER(username) = LOWER($1)',
      [username]
    );

    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    if (user.blocked) {
      return res.status(403).json({ error: 'Your account has been blocked. Contact an administrator.' });
    }

    req.session.authenticated = true;
    req.session.user = {
      id: user.id,
      username: user.username,
      role: user.role,
      fullName: user.full_name,
      phone: user.phone,
      theme: user.theme || null,
    };

    return res.json({
      authenticated: true,
      user: req.session.user,
    });
  } catch (error) {
    console.error('Login error:', error.message);
    return res.status(500).json({ error: 'Login failed.' });
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Logout failed.' });
    }
    res.clearCookie('client-intelligence.sid');
    return res.status(204).send();
  });
});

router.get('/environment', (_req, res) => {
  const isProduction = !!process.env.DATABASE_URL;
  res.json({
    environment: isProduction ? 'production' : 'development',
    database: isProduction ? 'neondb' : 'sqlite',
  });
});

module.exports = router;

