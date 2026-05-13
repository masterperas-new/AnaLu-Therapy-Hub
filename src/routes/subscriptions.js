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

/* GET /report — economic report for subscriptions */
router.get('/report', async (req, res) => {
  const { db } = require('../db/database');
  try {
    const year = Number(req.query.year) || new Date().getFullYear();

    // Active subscriptions summary
    const activeSubs = await db.all(
      `SELECT s.user_id, u.full_name, s.monthly_price_cents, s.status
       FROM subscriptions s
       JOIN users u ON u.id = s.user_id
       WHERE s.status = 'active' AND s.monthly_price_cents > 0`
    );

    const totalActiveSubs = activeSubs.length;
    const expectedMonthlyCents = activeSubs.reduce((sum, s) => sum + s.monthly_price_cents, 0);

    // All payments for the year
    const yearPayments = await db.all(
      `SELECT sp.user_id, u.full_name, sp.amount_cents, sp.paid_date, sp.covers_until, sp.payment_method
       FROM subscription_payments sp
       JOIN users u ON u.id = sp.user_id
       WHERE sp.paid_date >= $1 AND sp.paid_date <= $2
       ORDER BY sp.paid_date`,
      [`${year}-01-01`, `${year}-12-31`]
    );

    // Received this month and this year
    const now = new Date();
    const currentMonth = String(now.getMonth() + 1).padStart(2, '0');
    const currentMonthPrefix = `${now.getFullYear()}-${currentMonth}`;

    const receivedThisYearCents = yearPayments.reduce((sum, p) => sum + p.amount_cents, 0);
    const receivedThisMonthCents = yearPayments
      .filter(p => p.paid_date.startsWith(currentMonthPrefix))
      .reduce((sum, p) => sum + p.amount_cents, 0);

    // Outstanding: for each active sub, check if covers_until is in the past
    const outstandingDetails = [];
    for (const sub of activeSubs) {
      const lastPayment = await db.get(
        `SELECT MAX(covers_until) AS last_covers_until FROM subscription_payments WHERE user_id = $1`,
        [sub.user_id]
      );
      const coversUntil = lastPayment?.last_covers_until;
      if (!coversUntil) {
        // Never paid
        outstandingDetails.push({ full_name: sub.full_name, monthly_price_cents: sub.monthly_price_cents, months_overdue: 1, owed_cents: sub.monthly_price_cents });
      } else {
        const until = new Date(coversUntil + 'T23:59:59');
        if (until < now) {
          const todayMonth = now.getFullYear() * 12 + now.getMonth();
          const untilMonth = until.getFullYear() * 12 + until.getMonth();
          const monthsOverdue = todayMonth - untilMonth;
          outstandingDetails.push({ full_name: sub.full_name, monthly_price_cents: sub.monthly_price_cents, months_overdue: monthsOverdue, owed_cents: monthsOverdue * sub.monthly_price_cents });
        }
      }
    }
    const totalOutstandingCents = outstandingDetails.reduce((sum, d) => sum + d.owed_cents, 0);

    // Monthly breakdown for the year
    const monthlyBreakdown = [];
    for (let m = 1; m <= 12; m++) {
      const mm = String(m).padStart(2, '0');
      const prefix = `${year}-${mm}`;
      const monthPayments = yearPayments.filter(p => p.paid_date.startsWith(prefix));
      const totalCents = monthPayments.reduce((sum, p) => sum + p.amount_cents, 0);
      const count = monthPayments.length;
      monthlyBreakdown.push({ month: m, monthLabel: prefix, totalCents, paymentCount: count });
    }

    return res.json({
      year,
      totalActiveSubs,
      expectedMonthlyCents,
      receivedThisMonthCents,
      receivedThisYearCents,
      totalOutstandingCents,
      outstandingDetails,
      monthlyBreakdown,
    });
  } catch (err) {
    console.error('Error generating subscription report:', err);
    return res.status(500).json({ error: 'Failed to generate report.' });
  }
});

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
          MAX(amount_cents) AS last_amount_cents
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
