require('dotenv').config();

const express = require('express');
const session = require('express-session');
const path = require('path');
const { initializeDatabase, db } = require('./db/database');
const authRouter = require('./routes/auth');
const clientsRouter = require('./routes/clients');
const appointmentsRouter = require('./routes/appointments');
const reportsRouter = require('./routes/reports');
const settingsRouter = require('./routes/settings');
const usersRouter = require('./routes/users');

const app = express();
const port = Number(process.env.PORT) || 3000;

initializeDatabase();

app.use(express.json());
app.use(
  session({
    name: 'client-intelligence.sid',
    secret: process.env.SESSION_SECRET || 'change-this-session-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 8,
    },
  })
);
app.use(express.static(path.join(__dirname, '..', 'public')));

function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated && req.session.user) {
    return next();
  }

  return res.status(401).json({ error: 'Authentication required.' });
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.user && req.session.user.role === 'admin') {
    return next();
  }

  return res.status(403).json({ error: 'Admin access required.' });
}

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api/auth', authRouter);
app.use('/api/clients', requireAuth, clientsRouter);
app.use('/api/appointments', requireAuth, appointmentsRouter);
app.use('/api/reports', requireAuth, reportsRouter);
app.use('/api/settings', requireAuth, settingsRouter);
app.use('/api/users', requireAuth, usersRouter);

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});

process.on('SIGINT', () => {
  db.close(() => {
    process.exit(0);
  });
});
