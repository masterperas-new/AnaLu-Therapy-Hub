const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', '..', 'data', 'app.db');
const db = new sqlite3.Database(dbPath);

function initializeDatabase() {
  db.serialize(() => {
    db.run('PRAGMA foreign_keys = ON');

    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'therapist',
        full_name TEXT NOT NULL,
        phone TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    /* Seed admin user if not exists */
    db.get("SELECT id FROM users WHERE username = 'NunFur'", [], (err, row) => {
      if (!err && !row) {
        const hash = bcrypt.hashSync('NunFurPass', 10);
        db.run(
          "INSERT INTO users (username, password_hash, role, full_name, phone) VALUES ('NunFur', ?, 'admin', 'Nuno Furtado', NULL)",
          [hash]
        );
      }
    });

    db.run(`
      CREATE TABLE IF NOT EXISTS clients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        full_name TEXT NOT NULL,
        condition_notes TEXT NOT NULL,
        phone TEXT,
        email TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    db.run(`
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

    db.run(`ALTER TABLE appointments ADD COLUMN payment_type TEXT`, (err) => {
      if (err && !err.message.includes('duplicate column')) {
        console.error('Migration error:', err.message);
      }
    });

    db.run(`ALTER TABLE appointments ADD COLUMN user_id INTEGER`, (err) => {
      if (err && !err.message.includes('duplicate column')) {
        console.error('Migration error:', err.message);
      }
    });

    db.run(`ALTER TABLE users ADD COLUMN blocked INTEGER NOT NULL DEFAULT 0`, (err) => {
      if (err && !err.message.includes('duplicate column')) {
        console.error('Migration error:', err.message);
      }
    });

    db.run(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    db.run(
      "INSERT OR IGNORE INTO settings (key, value) VALUES ('default_fee_cents', '6000')"
    );

    db.all('PRAGMA table_info(appointments)', [], (err, rows) => {
      if (err) {
        return;
      }

      const columns = new Set(rows.map((row) => row.name));

      if (!columns.has('duration_minutes')) {
        db.run('ALTER TABLE appointments ADD COLUMN duration_minutes INTEGER NOT NULL DEFAULT 60');
      }

      if (!columns.has('comments')) {
        db.run('ALTER TABLE appointments ADD COLUMN comments TEXT');
      }
    });

    db.run('CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments(appointment_date)');

    db.run(`
      CREATE TABLE IF NOT EXISTS patient_comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id INTEGER NOT NULL,
        comment_date TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
      )
    `);
  });
}

module.exports = {
  db,
  initializeDatabase,
};
