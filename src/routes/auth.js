const express = require('express');
const bcrypt = require('bcryptjs');

const { validateSession, passwordStamp } = require('../sessionCheck');

const router = express.Router();

// Compared against when the username doesn't exist, so a wrong username takes as
// long as a wrong password and doesn't reveal which usernames exist.
const DUMMY_HASH = bcrypt.hashSync('no-such-user-placeholder', 10);

// Failed sign-in limit: 10 wrong passwords for the same username from the same
// address pauses that combination for 15 minutes. Kept in memory, so on Vercel
// each server instance counts separately; it still slows down password guessing.
const FAIL_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 10;
const failedLogins = new Map();

function failKey(req, username) {
  return `${req.ip}|${String(username).trim().toLowerCase()}`;
}

function minutesLocked(key) {
  const entry = failedLogins.get(key);
  if (!entry) return 0;
  const age = Date.now() - entry.first;
  if (age > FAIL_WINDOW_MS) {
    failedLogins.delete(key);
    return 0;
  }
  return entry.count >= MAX_FAILS ? Math.ceil((FAIL_WINDOW_MS - age) / 60000) : 0;
}

function recordFailure(key) {
  if (failedLogins.size > 5000) {
    for (const [k, v] of failedLogins) {
      if (Date.now() - v.first > FAIL_WINDOW_MS) failedLogins.delete(k);
    }
  }
  const entry = failedLogins.get(key);
  if (!entry || Date.now() - entry.first > FAIL_WINDOW_MS) {
    failedLogins.set(key, { count: 1, first: Date.now() });
  } else {
    entry.count++;
  }
}

router.get('/session', async (req, res) => {
  let valid = false;
  try {
    valid = await validateSession(req);
  } catch (error) {
    console.error('Session check error:', error.message);
  }
  if (valid) {
    return res.json({
      authenticated: true,
      user: {
        id: req.session.user.id,
        username: req.session.user.username,
        role: req.session.user.role,
        fullName: req.session.user.fullName,
        phone: req.session.user.phone,
        language: req.session.user.language || (req.session.user.role === 'admin' ? 'en' : 'pt-PT'),
        theme: req.session.user.theme || null,
        calendarView: req.session.user.calendarView || 'week',
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

  const key = failKey(req, username);
  const lockedFor = minutesLocked(key);
  if (lockedFor) {
    return res.status(429).json({ error: `Too many failed sign-in attempts. Try again in ${lockedFor} minute${lockedFor === 1 ? '' : 's'}.` });
  }

  try {
    const user = await db.get(
      'SELECT id, username, password_hash, role, full_name, phone, language, blocked, theme, calendar_view FROM users WHERE LOWER(username) = LOWER($1)',
      [username]
    );

    const passwordOk = bcrypt.compareSync(password, user ? user.password_hash : DUMMY_HASH);
    if (!user || !passwordOk) {
      recordFailure(key);
      return res.status(401).json({ error: 'Invalid username or password.' });
    }
    failedLogins.delete(key);

    if (user.blocked) {
      return res.status(403).json({ error: 'Your account has been blocked. Contact an administrator.' });
    }

    // Record last login timestamp
    await db.run('UPDATE users SET last_login = $1 WHERE id = $2', [new Date().toISOString(), user.id]);

    const effectiveLanguage = user.language && String(user.language).trim()
      ? user.language
      : (user.role === 'admin' ? 'en' : 'pt-PT');

    if (!user.language || !String(user.language).trim()) {
      await db.run('UPDATE users SET language = $1 WHERE id = $2', [effectiveLanguage, user.id]);
    }

    const sessionUser = {
      id: user.id,
      username: user.username,
      role: user.role,
      fullName: user.full_name,
      phone: user.phone,
      language: effectiveLanguage,
      theme: user.theme || null,
      calendarView: user.calendar_view || 'week',
    };

    // Start a fresh session at sign-in, so a session id set before sign-in can't be reused
    req.session.regenerate((regenErr) => {
      if (regenErr) {
        return res.status(500).json({ error: 'Session save failed.' });
      }
      req.session.authenticated = true;
      req.session.user = sessionUser;
      req.session.passwordStamp = passwordStamp(user.password_hash);

      req.session.save((err) => {
        if (err) {
          return res.status(500).json({ error: 'Session save failed.' });
        }
        return res.json({
          authenticated: true,
          user: req.session.user,
        });
      });
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
    res.clearCookie('connect.sid');
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

router.get('/build-info', (_req, res) => {
  try {
    const fs = require('fs');
    const buildFile = require('path').join(__dirname, '../../.buildcount');
    const buildCount = fs.existsSync(buildFile)
      ? parseInt(fs.readFileSync(buildFile, 'utf8').trim() || '0', 10)
      : 0;
    res.json({ buildCount });
  } catch (err) {
    res.json({ buildCount: 0 });
  }
});

module.exports = router;
