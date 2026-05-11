require('dotenv').config();

const express = require('express');
const session = require('express-session');

const path = require('path');
const { initializeDatabase } = require('./db/database');
const authRouter = require('./routes/auth');
const clientsRouter = require('./routes/clients');
const appointmentsRouter = require('./routes/appointments');
const reportsRouter = require('./routes/reports');
const settingsRouter = require('./routes/settings');
const usersRouter = require('./routes/users');
const recurrencesRouter = require('./routes/recurrences');

const app = express();
const port = Number(process.env.PORT) || 8080;
const isProduction = process.env.NODE_ENV === 'production';

// --- Register middleware and routes synchronously (required for Vercel) ---

app.use(express.json());

// Trust proxy (for Vercel)
app.set('trust proxy', 1);

// Session store configuration
let sessionStore;

if (process.env.DATABASE_URL) {
  // Use PostgreSQL for session storage (required for Vercel serverless)
  const pgSession = require('connect-pg-simple')(session);
  let sessionPool;

  if (process.env.VERCEL) {
    const { Pool: NeonPool, neonConfig } = require('@neondatabase/serverless');
    const ws = require('ws');
    neonConfig.webSocketConstructor = ws;
    let connStr = process.env.DATABASE_URL.replace(/[&?]channel_binding=[^&]*/g, '').replace(/\?$/, '');
    sessionPool = new NeonPool({ connectionString: connStr, ssl: { rejectUnauthorized: false }, max: 2 });
  } else {
    const { Pool } = require('pg');
    let connStr = process.env.DATABASE_URL.replace(/[&?]channel_binding=[^&]*/g, '').replace(/\?$/, '');
    sessionPool = new Pool({ connectionString: connStr, ssl: { rejectUnauthorized: false }, max: 2 });
  }

  sessionStore = new pgSession({
    pool: sessionPool,
    tableName: 'session',
    createTableIfMissing: true,
  });
  console.log('[Session Store] Using PostgreSQL session store');
} else {
  sessionStore = new session.MemoryStore();
  console.log('[Session Store] Using memory store');
}

app.use(
  session({
    store: sessionStore,
    secret: process.env.SESSION_SECRET || 'your-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: 'auto',
      maxAge: 1000 * 60 * 60 * 8,
    },
  })
);

app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

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

app.get('/ALTApi/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use('/ALTApi/auth', authRouter);
app.use('/ALTApi/clients', requireAuth, clientsRouter);
app.use('/ALTApi/appointments', requireAuth, appointmentsRouter);
app.use('/ALTApi/reports', requireAuth, reportsRouter);
app.use('/ALTApi/settings', requireAuth, settingsRouter);
app.use('/ALTApi/users', requireAuth, usersRouter);
app.use('/ALTApi/recurrences', requireAuth, recurrencesRouter);

// --- Initialize database, then start server (non-Vercel) ---
const dbReady = initializeDatabase()
  .then(() => {
    console.log('[DB] Database initialized successfully');

    if (!process.env.VERCEL) {
      app.listen(port, () => {
        console.log(`Server running at http://localhost:${port}`);
      });

      process.on('SIGINT', async () => {
        try {
          const { db } = require('./db/database');
          await db.close();
          console.log('Database connection closed.');
        } catch (err) {
          console.error('Error closing database:', err.message);
        }
        process.exit(0);
      });
    }
  })
  .catch((err) => {
    console.error('Failed to initialize database:', err);
    if (!process.env.VERCEL) {
      process.exit(1);
    }
  });

// Always export app for Vercel serverless
module.exports = app;
