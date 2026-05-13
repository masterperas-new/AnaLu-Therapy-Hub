const express = require('express');
const router = express.Router();

/* Admin-only guard */
function requireAdmin(req, res, next) {
  if (req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }
  next();
}

router.use(requireAdmin);

/* GET / — list all subscriptions with latest payment info */
router.get('/', async (_req, res) => {
  const { db } = require('../db/database');
  try {
    const rows = await db.all(`
      SELECT
        u.id AS user_id,
        u.full_name,
        u.username,
        u.blocked,
        s.monthly_price_cents,
        s.status AS sub_status,
        s.notes AS sub_notes,
        s.created_at AS sub_created_at,
        lp.last_paid_date,
        lp.last_covers_until,
        lp.last_amount_cents
      FROM users u
      LEFT JOIN subscriptions s ON s.user_id = u.id
      LEFT JOIN (
        SELECT
          user_id,
          MAX(paid_date) AS last_paid_date,
          MAX(covers_until) AS last_covers_until,
          amount_cents AS last_amount_cents
        FROM subscription_payments
        GROUP BY user_id
      ) lp ON lp.user_id = u.id
      WHERE u.role = 'therapist'
      ORDER BY u.full_name
    `);
    return res.json(rows);
  } catch (err) {
    console.error('Error listing subscriptions:', err);
    return res.status(500).json({ error: 'Failed to list subscriptions.' });
  }
});

/* PUT /:userId — create or update a subscription */
router.put('/:userId', async (req, res) => {
  const { db, isPostgres } = require('../db/database');
  try {
    const userId = Number(req.params.userId);
    const { monthlyPriceCents, status, notes } = req.body;

    if (monthlyPriceCents === undefined || monthlyPriceCents === null) {
      return res.status(400).json({ error: 'Monthly price is required.' });
    }
    const price = Math.round(Number(monthlyPriceCents));
    if (Number.isNaN(price) || price < 0) {
      return res.status(400).json({ error: 'Monthly price must be a non-negative number.' });
    }

    const validStatuses = ['active', 'paused', 'cancelled'];
    const safeStatus = validStatuses.includes(status) ? status : 'active';

    const existing = await db.get('SELECT user_id FROM subscriptions WHERE user_id = $1', [userId]);

    if (existing) {
      await db.run(
        'UPDATE subscriptions SET monthly_price_cents = $1, status = $2, notes = $3 WHERE user_id = $4',
        [price, safeStatus, notes || null, userId]
      );
    } else {
      await db.run(
        'INSERT INTO subscriptions (user_id, monthly_price_cents, status, notes) VALUES ($1, $2, $3, $4)',
        [userId, price, safeStatus, notes || null]
      );
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error('Error saving subscription:', err);
    return res.status(500).json({ error: 'Failed to save subscription.' });
  }
});

/* GET /:userId/payments — payment history for a user */
router.get('/:userId/payments', async (req, res) => {
  const { db } = require('../db/database');
  try {
    const userId = Number(req.params.userId);
    const rows = await db.all(
      'SELECT * FROM subscription_payments WHERE user_id = $1 ORDER BY paid_date DESC',
      [userId]
    );
    return res.json(rows);
  } catch (err) {
    console.error('Error listing payments:', err);
    return res.status(500).json({ error: 'Failed to list payments.' });
  }
});

/* POST /:userId/payments — record a new payment */
router.post('/:userId/payments', async (req, res) => {
  const { db } = require('../db/database');
  try {
    const userId = Number(req.params.userId);
    const { amountCents, paidDate, coversUntil, paymentMethod, notes } = req.body;

    if (!amountCents || !paidDate || !coversUntil) {
      return res.status(400).json({ error: 'Amount, paid date, and covers-until date are required.' });
    }

    const amount = Math.round(Number(amountCents));
    if (Number.isNaN(amount) || amount <= 0) {
      return res.status(400).json({ error: 'Amount must be a positive number.' });
    }

    const result = await db.run(`
      INSERT INTO subscription_payments (user_id, amount_cents, paid_date, covers_until, payment_method, notes)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [userId, amount, paidDate, coversUntil, paymentMethod || null, notes || null]);

    return res.status(201).json({ id: result.lastID });
  } catch (err) {
    console.error('Error recording payment:', err);
    return res.status(500).json({ error: 'Failed to record payment.' });
  }
});

/* PUT /payments/:id — edit a payment */
router.put('/payments/:id', async (req, res) => {
  const { db } = require('../db/database');
  try {
    const paymentId = Number(req.params.id);
    const { amountCents, paidDate, coversUntil, paymentMethod, notes } = req.body;

    if (!amountCents || !paidDate || !coversUntil) {
      return res.status(400).json({ error: 'Amount, paid date, and covers-until date are required.' });
    }

    const amount = Math.round(Number(amountCents));
    if (Number.isNaN(amount) || amount <= 0) {
      return res.status(400).json({ error: 'Amount must be a positive number.' });
    }

    const existing = await db.get('SELECT id FROM subscription_payments WHERE id = $1', [paymentId]);
    if (!existing) return res.status(404).json({ error: 'Payment not found.' });

    await db.run(`
      UPDATE subscription_payments
      SET amount_cents = $1, paid_date = $2, covers_until = $3, payment_method = $4, notes = $5
      WHERE id = $6
    `, [amount, paidDate, coversUntil, paymentMethod || null, notes || null, paymentId]);

    return res.json({ ok: true });
  } catch (err) {
    console.error('Error updating payment:', err);
    return res.status(500).json({ error: 'Failed to update payment.' });
  }
});

/* DELETE /payments/:id — delete a payment */
router.delete('/payments/:id', async (req, res) => {
  const { db } = require('../db/database');
  try {
    const paymentId = Number(req.params.id);

    const existing = await db.get('SELECT id FROM subscription_payments WHERE id = $1', [paymentId]);
    if (!existing) return res.status(404).json({ error: 'Payment not found.' });

    await db.run('DELETE FROM subscription_payments WHERE id = $1', [paymentId]);
    return res.json({ ok: true });
  } catch (err) {
    console.error('Error deleting payment:', err);
    return res.status(500).json({ error: 'Failed to delete payment.' });
  }
});

module.exports = router;
