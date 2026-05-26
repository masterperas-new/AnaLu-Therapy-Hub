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
    const Database = require('better-sqlite3');
    const path = require('path');
    const dbPath = path.join(__dirname, '..', '..', 'data', 'app.db');
    const sqlite = new Database(dbPath);
    sqlite.pragma('journal_mode = WAL');

    db = {
      async get(sql, params = []) {
        const convertedSql = sql.replace(/\$\d+/g, '?');
        const row = sqlite.prepare(convertedSql).get(...params);
        return row || null;
      },
      async all(sql, params = []) {
        const convertedSql = sql.replace(/\$\d+/g, '?');
        const rows = sqlite.prepare(convertedSql).all(...params);
        return rows || [];
      },
      async run(sql, params = []) {
        const convertedSql = sql.replace(/\$\d+/g, '?');
        const result = sqlite.prepare(convertedSql).run(...params);
        return { lastID: result.lastInsertRowid, changes: result.changes };
      },
      async close() {
        sqlite.close();
      },
    };

    console.log('[SQLite] Using better-sqlite3 database (DEVELOPMENT/FALLBACK)');
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
          calendar_view TEXT DEFAULT 'week',
          last_login TIMESTAMP,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Add last_login column if missing (migration for existing tables)
      try {
        await db.run(`ALTER TABLE users ADD COLUMN last_login TIMESTAMP`);
      } catch (_) {
        // Column already exists — ignore
      }

      // Add calendar_view column if missing (migration for existing tables)
      try {
        await db.run(`ALTER TABLE users ADD COLUMN calendar_view TEXT DEFAULT 'week'`);
      } catch (_) {
        // Column already exists — ignore
      }

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
          default_fee_cents INTEGER,
          nif TEXT,
          created_by INTEGER,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
        )
      `);

      // Add default_fee_cents column if missing (migration for existing tables)
      try {
        await db.run(`ALTER TABLE clients ADD COLUMN default_fee_cents INTEGER`);
      } catch (_) {
        // Column already exists — ignore
      }

      // Add nif column if missing (migration for existing tables)
      try {
        await db.run(`ALTER TABLE clients ADD COLUMN nif TEXT`);
      } catch (_) {
        // Column already exists — ignore
      }

      // Add created_by column if missing (migration for existing tables)
      try {
        await db.run(`ALTER TABLE clients ADD COLUMN created_by INTEGER REFERENCES users(id) ON DELETE SET NULL`);
      } catch (_) {
        // Column already exists — ignore
      }

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
          recurrence_id INTEGER,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
        )
      `);

      // Add recurrence_id column if missing (migration)
      try {
        await db.run(`ALTER TABLE appointments ADD COLUMN recurrence_id INTEGER`);
      } catch (_) {
        // Column already exists — ignore
      }

      // Create index on appointments date
      await db.run(
        `CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments(appointment_date)`
      );

      // Create recurrences table
      await db.run(`
        CREATE TABLE IF NOT EXISTS recurrences (
          id SERIAL PRIMARY KEY,
          client_id INTEGER NOT NULL,
          user_id INTEGER,
          frequency TEXT NOT NULL,
          day_of_week INTEGER NOT NULL,
          time_of_day TEXT NOT NULL,
          start_date TEXT NOT NULL,
          end_date TEXT NOT NULL,
          address TEXT NOT NULL,
          duration_minutes INTEGER NOT NULL DEFAULT 60,
          fee_cents INTEGER NOT NULL,
          payment_type TEXT,
          comments TEXT,
          status TEXT NOT NULL DEFAULT 'active',
          cancelled_at TEXT,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
        )
      `);

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

      // Create patient_insurances table
      await db.run(`
        CREATE TABLE IF NOT EXISTS patient_insurances (
          id SERIAL PRIMARY KEY,
          client_id INTEGER NOT NULL,
          insurance_name TEXT NOT NULL,
          policy_number TEXT,
          provider_name TEXT NOT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
        )
      `);

      // Create subscriptions table
      await db.run(`
        CREATE TABLE IF NOT EXISTS subscriptions (
          user_id INTEGER PRIMARY KEY,
          monthly_price_cents INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'active',
          notes TEXT,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
      `);

      // Create subscription_payments table
      await db.run(`
        CREATE TABLE IF NOT EXISTS subscription_payments (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL,
          amount_cents INTEGER NOT NULL,
          paid_date TEXT NOT NULL,
          covers_until TEXT NOT NULL,
          payment_method TEXT,
          notes TEXT,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
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
          calendar_view TEXT DEFAULT 'week',
          last_login TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Add last_login column if missing (migration for existing tables)
      try {
        await db.run(`ALTER TABLE users ADD COLUMN last_login TEXT`);
      } catch (_) {
        // Column already exists — ignore
      }

      // Add calendar_view column if missing (migration for existing tables)
      try {
        await db.run(`ALTER TABLE users ADD COLUMN calendar_view TEXT DEFAULT 'week'`);
      } catch (_) {
        // Column already exists — ignore
      }

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
          default_fee_cents INTEGER,
          nif TEXT,
          created_by INTEGER,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
        )
      `);

      // Add default_fee_cents column if missing (migration for existing tables)
      try {
        await db.run(`ALTER TABLE clients ADD COLUMN default_fee_cents INTEGER`);
      } catch (_) {
        // Column already exists — ignore
      }

      // Add nif column if missing (migration for existing tables)
      try {
        await db.run(`ALTER TABLE clients ADD COLUMN nif TEXT`);
      } catch (_) {
        // Column already exists — ignore
      }

      // Add created_by column if missing (migration for existing tables)
      try {
        await db.run(`ALTER TABLE clients ADD COLUMN created_by INTEGER REFERENCES users(id) ON DELETE SET NULL`);
      } catch (_) {
        // Column already exists — ignore
      }

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
          recurrence_id INTEGER,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
        )
      `);

      // Add recurrence_id column if missing (migration)
      try {
        await db.run(`ALTER TABLE appointments ADD COLUMN recurrence_id INTEGER`);
      } catch (_) {
        // Column already exists — ignore
      }

      await db.run(
        `CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments(appointment_date)`
      );

      // Create recurrences table
      await db.run(`
        CREATE TABLE IF NOT EXISTS recurrences (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          client_id INTEGER NOT NULL,
          user_id INTEGER,
          frequency TEXT NOT NULL,
          day_of_week INTEGER NOT NULL,
          time_of_day TEXT NOT NULL,
          start_date TEXT NOT NULL,
          end_date TEXT NOT NULL,
          address TEXT NOT NULL,
          duration_minutes INTEGER NOT NULL DEFAULT 60,
          fee_cents INTEGER NOT NULL,
          payment_type TEXT,
          comments TEXT,
          status TEXT NOT NULL DEFAULT 'active',
          cancelled_at TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
        )
      `);

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

      // Create patient_insurances table
      await db.run(`
        CREATE TABLE IF NOT EXISTS patient_insurances (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          client_id INTEGER NOT NULL,
          insurance_name TEXT NOT NULL,
          policy_number TEXT,
          provider_name TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
        )
      `);

      // Create subscriptions table
      await db.run(`
        CREATE TABLE IF NOT EXISTS subscriptions (
          user_id INTEGER PRIMARY KEY,
          monthly_price_cents INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'active',
          notes TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
      `);

      // Create subscription_payments table
      await db.run(`
        CREATE TABLE IF NOT EXISTS subscription_payments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          amount_cents INTEGER NOT NULL,
          paid_date TEXT NOT NULL,
          covers_until TEXT NOT NULL,
          payment_method TEXT,
          notes TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
      `);
    }

    await normalizePatientOwnershipByTherapist();
  } catch (err) {
    console.error('Database initialization error:', err.message);
    throw err;
  }
}

async function normalizePatientOwnershipByTherapist() {
  const mismatches = await db.all(
    `
      SELECT DISTINCT
        a.client_id AS source_client_id,
        a.user_id AS therapist_id,
        c.full_name,
        c.condition_notes,
        c.phone,
        c.email,
        c.address,
        c.default_fee_cents,
        c.nif
      FROM appointments a
      JOIN clients c ON c.id = a.client_id
      WHERE a.user_id IS NOT NULL
        AND (c.created_by IS NULL OR c.created_by <> a.user_id)
    `
  );

  if (!mismatches.length) {
    return;
  }

  let fixedPairs = 0;
  for (const row of mismatches) {
    const createResult = await db.run(
      `
        INSERT INTO clients (
          full_name,
          condition_notes,
          phone,
          email,
          address,
          default_fee_cents,
          nif,
          created_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id
      `,
      [
        row.full_name,
        row.condition_notes,
        row.phone || null,
        row.email || null,
        row.address || null,
        row.default_fee_cents === undefined ? null : row.default_fee_cents,
        row.nif || null,
        row.therapist_id,
      ]
    );

    const newClientId = Number(createResult.lastID);

    // Copy comments and insurances to preserve therapist context.
    const comments = await db.all(
      'SELECT comment_date, body FROM patient_comments WHERE client_id = $1',
      [row.source_client_id]
    );
    for (const comment of comments) {
      await db.run(
        'INSERT INTO patient_comments (client_id, comment_date, body) VALUES ($1, $2, $3)',
        [newClientId, comment.comment_date, comment.body]
      );
    }

    const insurances = await db.all(
      'SELECT insurance_name, policy_number, provider_name FROM patient_insurances WHERE client_id = $1',
      [row.source_client_id]
    );
    for (const insurance of insurances) {
      await db.run(
        'INSERT INTO patient_insurances (client_id, insurance_name, policy_number, provider_name) VALUES ($1, $2, $3, $4)',
        [newClientId, insurance.insurance_name, insurance.policy_number, insurance.provider_name]
      );
    }

    await db.run(
      'UPDATE appointments SET client_id = $1 WHERE client_id = $2 AND user_id = $3',
      [newClientId, row.source_client_id, row.therapist_id]
    );

    await db.run(
      'UPDATE recurrences SET client_id = $1 WHERE client_id = $2 AND user_id = $3',
      [newClientId, row.source_client_id, row.therapist_id]
    );

    fixedPairs += 1;
  }

  console.log(`[DB] Normalized patient ownership for ${fixedPairs} therapist/client pair(s).`);
}

module.exports = {
  get db() {
    if (!db) {
      throw new Error('Database not initialized. Call initializeDatabase() first.');
    }
    return db;
  },
  get isPostgres() {
    return isPostgres;
  },
  initializeDatabase,
};
