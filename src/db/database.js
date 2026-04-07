const path = require('path');
const bcrypt = require('bcryptjs');

let db;
let isPostgres = false;

// Initialize database based on environment
async function initializeDatabase() {
  if (process.env.DATABASE_URL) {
    // Use PostgreSQL/NeonDB for production
    isPostgres = true;
    const { Pool } = require('pg');
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }, // NeonDB requires SSL
    });

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

    console.log('[NeonDB] Connected to NeonDB PostgreSQL database (PRODUCTION)');
  } else {
    // Use SQLite for local development
    const sqlite3 = require('sqlite3').verbose();
    const dbPath = path.join(__dirname, '..', '..', 'data', 'app.db');
    const sqlite = new sqlite3.Database(dbPath);

    db = {
      async get(sql, params = []) {
        return new Promise((resolve, reject) => {
          // Convert $1, $2 placeholders to ?
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

    console.log('[SQLite] Using local SQLite database at ' + dbPath + ' (DEVELOPMENT)');
  }

  await initializeDatabaseSchema();
}

async function initializeDatabaseSchema() {
  try {
    if (isPostgres) {
      // PostgreSQL initialization
      try {
        await db.run('SET session_replication_role = replica');
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
