const express = require('express');
const { db } = require('../db/database');

const router = express.Router();

router.get('/', (_req, res) => {
  db.get(
    "SELECT value FROM settings WHERE key = 'default_fee_cents'",
    [],
    (err, row) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to fetch settings.' });
      }

      const defaultFeeCents = Number(row?.value || 0);
      return res.json({ defaultFeeCents });
    }
  );
});

router.put('/', (req, res) => {
  const defaultFeeAmount = Number(req.body.defaultFeeAmount);
  const defaultFeeCents = Math.round(defaultFeeAmount * 100);

  if (Number.isNaN(defaultFeeCents) || defaultFeeCents < 0) {
    return res.status(400).json({ error: 'Default fee must be a non-negative number.' });
  }

  db.run(
    `
      INSERT INTO settings (key, value, updated_at)
      VALUES ('default_fee_cents', ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
    `,
    [String(defaultFeeCents)],
    (err) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to update settings.' });
      }

      return res.json({ defaultFeeCents });
    }
  );
});

module.exports = router;
