const path = require('path');
const bcrypt = require('bcryptjs');

let db;
let isPostgres = false;

// Initialize database based on environment
async function initializeDatabase() {
  if (process.env.DATABASE_URL) {
    // Try PostgreSQL/NeonDB for production
    try {
      isPostgres = true;
      
      // Strip channel_binding from connection string (not supported by NeonDB pooler/PgBouncer)
      let connectionString = process.env.DATABASE_URL;
      connectionString = connectionString.replace(/[&?]channel_binding=[^&]*/g, '');
      connectionString = connectionString.replace(/\?$/, '');
      
      const maskedUrl = connectionString.replace(/:([^@/]+)@/, ':***@');
      console.log('[NeonDB] Connecting with URL:', maskedUrl);

      let pool;
      
      // Use @neondatabase/serverless on Vercel (WebSocket-based, works in serverless)
      if (process.env.VERCEL) {
        const { Pool: NeonPool, neonConfig } = require('@neondatabase/serverless');
        const ws = require('ws');
        neonConfig.webSocketConstructor = ws;
        
        pool = new NeonPool({
          connectionString,
          ssl: { rejectUnauthorized: false },
          connectionTimeoutMillis: 10000,
          idleTimeoutMillis: 30000,
          max: 3,
        });
        console.log('[NeonDB] Using @neondatabase/serverless Pool driver (Vercel)');
      } else {
        const { Pool } = require('pg');
        pool = new Pool({
          connectionString,
          ssl: { rejectUnauthorized: false },
          connectionTimeoutMillis: 10000,
          idleTimeoutMillis: 30000,
          max: 3,
        });
        console.log('[NeonDB] Using pg driver (Docker/Local)');
      }

      db = {
        pool,
        async get(sql, params = []) {
          try {
            const result = await pool.query(sql, params);
            return result.rows[0] || null;
          } catch (err) {
            console.error('Database error:', err.message);
            throw err;
          }
        },
        async all(sql, params = []) {
          try {
            const result = await pool.query(sql, params);
            return result.rows;
          } catch (err) {
            console.error('Database error:', err.message);
            throw err;
          }
        },
        async run(sql, params = []) {
          try {
            const result = await pool.query(sql, params);
            return { lastID: result.rows[0]?.id, changes: result.rowCount };
          } catch (err) {
            console.error('Database error:', err.message);
            throw err;
          }
        },
        async close() {
          await pool.end();
        },
      };

      // Test connection with retries (NeonDB cold starts can take several seconds)
      let connected = false;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await pool.query('SELECT 1');
          console.log(`[NeonDB] Connected to NeonDB PostgreSQL database (PRODUCTION) on attempt ${attempt}`);
          connected = true;
          break;
        } catch (testErr) {
          const rawUrl = process.env.DATABASE_URL || '(not set)';
          const maskedUrl = rawUrl.replace(/:([^@/]+)@/, ':***@');
          console.warn(`[NeonDB] Connection attempt ${attempt}/3 failed: ${testErr.message} | DATABASE_URL: ${maskedUrl}`);
          if (attempt < 3) {
            await new Promise(r => setTimeout(r, 2000));
          } else {
            throw testErr;
          }
        }
      }
    } catch (pgErr) {
      // Log the connection string (mask password) to help debug
      const rawUrl = process.env.DATABASE_URL || '(not set)';
      const maskedUrl = rawUrl.replace(/:([^@/]+)@/, ':***@');
      console.error('[NeonDB] Connection failed:', pgErr.message);
      console.error('[NeonDB] DATABASE_URL:', maskedUrl);
      isPostgres = false;
      db = null;
      
      // On Vercel, SQLite won't work (read-only filesystem) — fail loudly
      if (process.env.VERCEL) {
        throw new Error('[NeonDB] PostgreSQL connection failed on Vercel. SQLite is not available. DATABASE_URL=' + maskedUrl + ' Error: ' + pgErr.message);
      }
      console.warn('[NeonDB] Falling back to SQLite');
    }
  }

  // Use SQLite if no DATABASE_URL or PostgreSQL failed
  if (!isPostgres) {
    const sqlite3 = require('sqlite3').verbose();
    const path = require('path');
    const dbPath = path.join(__dirname, '..', '..', 'data', 'app.db');
    const sqlite = new sqlite3.Database(dbPath);

    db = {
      async get(sql, params = []) {
        return new Promise((resolve, reject) => {
          const convertedSql = sql.replace(/\$\d+/g, '?');
          sqlite.get(convertedSql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row || null);
          });
        });
      },
      async all(sql, params = []) {
        return new Promise((resolve, reject) => {
          const convertedSql = sql.replace(/\$\d+/g, '?');
          sqlite.all(convertedSql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
          });
        });
      },
      async run(sql, params = []) {
        return new Promise((resolve, reject) => {
          const convertedSql = sql.replace(/\$\d+/g, '?');
          sqlite.run(convertedSql, params, function (err) {
            if (err) reject(err);
            else resolve({ lastID: this.lastID, changes: this.changes });
          });
        });
      },
      async close() {
        return new Promise((resolve, reject) => {
          sqlite.close((err) => {
            if (err) reject(err);
            else resolve();
          });
        });
      },
    };

    console.log('[SQLite] Using SQLite database (DEVELOPMENT/FALLBACK)');
  }

  await initializeDatabaseSchema();
}

async function initializeDatabaseSchema() {
  try {
    if (isPostgres) {
      // PostgreSQL initialization
      try {
        // Skipped: session_replication_role (NeonDB permission issue)
      } catch (_) {
        // NeonDB doesn't allow this, continue anyway
      }

      // Create users table
      await db.run(`
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          username TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'therapist',
          full_name TEXT NOT NULL,
          phone TEXT,
          blocked INTEGER NOT NULL DEFAULT 0,
          theme TEXT,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Seed admin user if not exists
      const adminUser = await db.get(
        "SELECT id FROM users WHERE username = $1",
        ['NunFur']
      );
      if (!adminUser) {
        const hash = bcrypt.hashSync('NunFurPass', 10);
        await db.run(
          "INSERT INTO users (username, password_hash, role, full_name, phone) VALUES ($1, $2, $3, $4, $5)",
          ['NunFur', hash, 'admin', 'Nuno Furtado', null]
        );
      }

      // Create clients table
      await db.run(`
        CREATE TABLE IF NOT EXISTS clients (
          id SERIAL PRIMARY KEY,
          full_name TEXT NOT NULL,
          condition_notes TEXT NOT NULL,
          phone TEXT,
          email TEXT,
          address TEXT,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Create appointments table
      await db.run(`
        CREATE TABLE IF NOT EXISTS appointments (
          id SERIAL PRIMARY KEY,
          client_id INTEGER NOT NULL,
          user_id INTEGER,
          appointment_date TEXT NOT NULL,
          location TEXT NOT NULL,
          fee_cents INTEGER NOT NULL,
          duration_minutes INTEGER NOT NULL DEFAULT 60,
          notes TEXT,
          comments TEXT,
          wire_received INTEGER NOT NULL DEFAULT 0,
          wire_received_date TEXT,
          payment_type TEXT,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
        )
      `);

      // Create index on appointments date
      await db.run(
        `CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments(appointment_date)`
      );

      // Create settings table
      await db.run(`
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Seed default fee setting
      await db.run(
        `INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`,
        ['default_fee_cents', '6000']
      );

      // Create patient_comments table
      await db.run(`
        CREATE TABLE IF NOT EXISTS patient_comments (
          id SERIAL PRIMARY KEY,
          client_id INTEGER NOT NULL,
          comment_date TEXT NOT NULL,
          body TEXT NOT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
        )
      `);

      try {
        await db.run('SET session_replication_role = DEFAULT');
      } catch (_) {
        // NeonDB doesn't allow this, continue anyway
      }
    } else {
      // SQLite initialization
      await db.run('PRAGMA foreign_keys = ON');

      await db.run(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'therapist',
          full_name TEXT NOT NULL,
          phone TEXT,
          blocked INTEGER NOT NULL DEFAULT 0,
          theme TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Seed admin user if not exists
      const adminUser = await db.get(
        "SELECT id FROM users WHERE username = $1",
        ['NunFur']
      );
      if (!adminUser) {
        const hash = bcrypt.hashSync('NunFurPass', 10);
        await db.run(
          "INSERT INTO users (username, password_hash, role, full_name, phone) VALUES ($1, $2, $3, $4, $5)",
          ['NunFur', hash, 'admin', 'Nuno Furtado', null]
        );
      }

      await db.run(`
        CREATE TABLE IF NOT EXISTS clients (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          full_name TEXT NOT NULL,
          condition_notes TEXT NOT NULL,
          phone TEXT,
          email TEXT,
          address TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);

      await db.run(`
        CREATE TABLE IF NOT EXISTS appointments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          client_id INTEGER NOT NULL,
          user_id INTEGER,
          appointment_date TEXT NOT NULL,
          location TEXT NOT NULL,
          fee_cents INTEGER NOT NULL,
          duration_minutes INTEGER NOT NULL DEFAULT 60,
          notes TEXT,
          comments TEXT,
          wire_received INTEGER NOT NULL DEFAULT 0,
          wire_received_date TEXT,
          payment_type TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
        )
      `);

      await db.run(
        `CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments(appointment_date)`
      );

      await db.run(`
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);

      await db.run(
        "INSERT OR IGNORE INTO settings (key, value) VALUES ($1, $2)",
        ['default_fee_cents', '6000']
      );

      await db.run(`
        CREATE TABLE IF NOT EXISTS patient_comments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          client_id INTEGER NOT NULL,
          comment_date TEXT NOT NULL,
          body TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
        )
      `);
    }
  } catch (err) {
    console.error('Database initialization error:', err.message);
    throw err;
  }
}

module.exports = {
  get db() {
    if (!db) {
      throw new Error('Database not initialized. Call initializeDatabase() first.');
    }
    return db;
  },
  initializeDatabase,
};
