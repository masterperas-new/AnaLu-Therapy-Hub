const express = require('express');

const router = express.Router();

router.get('/', async (_req, res) => {
  const { db } = require('../db/database');
  try {
    const row = await db.get(
      "SELECT value FROM settings WHERE key = $1",
      ['default_fee_cents']
    );

    const defaultFeeCents = Number(row?.value || 0);
    return res.json({ defaultFeeCents });
  } catch (err) {
    console.error('Error fetching settings:', err);
    return res.status(500).json({ error: 'Failed to fetch settings.' });
  }
});

router.put('/', async (req, res) => {
  const { db } = require('../db/database');
  try {
    const defaultFeeAmount = Number(req.body.defaultFeeAmount);
    const defaultFeeCents = Math.round(defaultFeeAmount * 100);

    if (Number.isNaN(defaultFeeCents) || defaultFeeCents < 0) {
      return res.status(400).json({ error: 'Default fee must be a non-negative number.' });
    }

    await db.run(
      `
        INSERT INTO settings (key, value, updated_at)
        VALUES ($1, $2, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
      `,
      ['default_fee_cents', String(defaultFeeCents)]
    );

    return res.json({ defaultFeeCents });
  } catch (err) {
    console.error('Error updating settings:', err);
    return res.status(500).json({ error: 'Failed to update settings.' });
  }
});

module.exports = router;
