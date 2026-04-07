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

const app = express();
const port = Number(process.env.PORT) || 8080;

// Initialize database and then start server
initializeDatabase()
  .then(() => {
    app.use(express.json());
    const isProduction = process.env.NODE_ENV === 'production';
    
    // Trust proxy (for Vercel)
    app.set('trust proxy', 1);
    
    app.use(
      session({
        name: 'client-intelligence.sid',
        secret: process.env.SESSION_SECRET || 'change-this-session-secret',
        resave: false,
        saveUninitialized: false,
        cookie: {
          httpOnly: true,
          sameSite: 'lax',
          secure: isProduction ? 'auto' : false,
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
  })
  .catch((err) => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });
