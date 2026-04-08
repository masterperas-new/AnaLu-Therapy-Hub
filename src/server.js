require('dotenv').config();

const express = require('express');
const session = require('express-session');
const pgSession = (() => {
  try {
    return require('connect-pg-simple')(session);
  } catch (err) {
    return null;
  }
})();
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
    
    // Session store configuration
    let sessionStore = new session.MemoryStore();
    
    // Try to use PostgreSQL session store if DATABASE_URL is available
    if (process.env.DATABASE_URL) {
      try {
        const pgSession = require('connect-pg-simple')(session);
        const { Pool } = require('pg');
        const pool = new Pool({
          connectionString: process.env.DATABASE_URL,
          ssl: { rejectUnauthorized: false },
          max: 2, // Limit connections for Vercel
          idleTimeoutMillis: 30000,
          connectionTimeoutMillis: 5000,
        });
        
        sessionStore = new pgSession({
          pool: pool,
          tableName: 'session',
          createTableIfMissing: true,
        });
        console.log('[Session Store] PostgreSQL configured');
      } catch (err) {
        console.warn('[Session Store] PostgreSQL init failed, using memory:', err.message);
        sessionStore = new session.MemoryStore();
      }
    }

    app.use(
      session({
        store: sessionStore,
        secret: 'your-secret-key',
        resave: false,
        saveUninitialized: false,
        cookie: {
          httpOnly: true,
          sameSite: 'lax',
          secure: isProduction ? true : false,
          maxAge: 1000 * 60 * 60 * 8,
        },
      })
    );

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
