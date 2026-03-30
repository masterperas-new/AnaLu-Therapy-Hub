const express = require('express');
const { db } = require('../db/database');

const router = express.Router();

router.get('/monthly', (req, res) => {
  const month = req.query.month;
  const user = req.session.user;

  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: 'Month is required in YYYY-MM format.' });
  }

  const userFilter = user.role !== 'admin' ? 'AND user_id = ?' : '';
  const params = user.role !== 'admin' ? [month, user.id] : [month];

  const sql = `
    SELECT
      COUNT(*) AS total_appointments,
      SUM(CASE WHEN wire_received = 1 THEN 1 ELSE 0 END) AS paid_appointments,
      SUM(CASE WHEN wire_received = 0 AND appointment_date <= date('now') THEN 1 ELSE 0 END) AS owed_appointments,
      COALESCE(SUM(fee_cents), 0) AS total_cents,
      COALESCE(SUM(CASE WHEN wire_received = 1 THEN fee_cents ELSE 0 END), 0) AS paid_cents,
      COALESCE(SUM(CASE WHEN wire_received = 0 AND appointment_date <= date('now') THEN fee_cents ELSE 0 END), 0) AS owed_cents
    FROM appointments
    WHERE strftime('%Y-%m', appointment_date) = ? ${userFilter}
  `;

  db.get(sql, params, (err, row) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to build monthly report.' });
    }

    return res.json({
      month,
      totalAppointments: row.total_appointments,
      paidAppointments: row.paid_appointments,
      owedAppointments: row.owed_appointments,
      totalCents: row.total_cents,
      paidCents: row.paid_cents,
      owedCents: row.owed_cents,
    });
  });
});

router.get('/yearly', (req, res) => {
  const year = req.query.year;
  const user = req.session.user;

  if (!year || !/^\d{4}$/.test(year)) {
    return res.status(400).json({ error: 'Year is required in YYYY format.' });
  }

  const userFilter = user.role !== 'admin' ? 'AND user_id = ?' : '';
  const params = user.role !== 'admin' ? [year, user.id] : [year];

  const sql = `
    SELECT
      COUNT(*) AS total_appointments,
      SUM(CASE WHEN wire_received = 1 THEN 1 ELSE 0 END) AS paid_appointments,
      SUM(CASE WHEN wire_received = 0 THEN 1 ELSE 0 END) AS owed_appointments,
      COALESCE(SUM(fee_cents), 0) AS total_cents,
      COALESCE(SUM(CASE WHEN wire_received = 1 THEN fee_cents ELSE 0 END), 0) AS paid_cents,
      COALESCE(SUM(CASE WHEN wire_received = 0 THEN fee_cents ELSE 0 END), 0) AS owed_cents
    FROM appointments
    WHERE strftime('%Y', appointment_date) = ? ${userFilter}
  `;

  db.get(sql, params, (err, row) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to build yearly report.' });
    }

    return res.json({
      year,
      totalAppointments: row.total_appointments,
      paidAppointments: row.paid_appointments,
      owedAppointments: row.owed_appointments,
      totalCents: row.total_cents,
      paidCents: row.paid_cents,
      owedCents: row.owed_cents,
    });
  });
});

router.get('/total', (req, res) => {
  const user = req.session.user;
  const userFilter = user.role !== 'admin' ? 'WHERE user_id = ?' : '';
  const params = user.role !== 'admin' ? [user.id] : [];

  const sql = `
    SELECT
      COUNT(*) AS total_appointments,
      SUM(CASE WHEN wire_received = 1 THEN 1 ELSE 0 END) AS paid_appointments,
      SUM(CASE WHEN wire_received = 0 AND appointment_date <= date('now') THEN 1 ELSE 0 END) AS owed_appointments,
      COALESCE(SUM(fee_cents), 0) AS total_cents,
      COALESCE(SUM(CASE WHEN wire_received = 1 THEN fee_cents ELSE 0 END), 0) AS paid_cents,
      COALESCE(SUM(CASE WHEN wire_received = 0 AND appointment_date <= date('now') THEN fee_cents ELSE 0 END), 0) AS owed_cents
    FROM appointments
    ${userFilter}
  `;

  db.get(sql, params, (err, row) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to build total report.' });
    }

    return res.json({
      totalAppointments: row.total_appointments,
      paidAppointments: row.paid_appointments,
      owedAppointments: row.owed_appointments,
      totalCents: row.total_cents,
      paidCents: row.paid_cents,
      owedCents: row.owed_cents,
    });
  });
});

router.get('/future', (req, res) => {
  const user = req.session.user;
  const userFilter = user.role !== 'admin' ? 'AND user_id = ?' : '';
  const params = user.role !== 'admin' ? [user.id] : [];

  const sql = `
    SELECT
      COUNT(*) AS total_appointments,
      SUM(CASE WHEN wire_received = 1 THEN 1 ELSE 0 END) AS paid_appointments,
      SUM(CASE WHEN wire_received = 0 THEN 1 ELSE 0 END) AS unpaid_appointments,
      COALESCE(SUM(fee_cents), 0) AS total_cents,
      COALESCE(SUM(CASE WHEN wire_received = 1 THEN fee_cents ELSE 0 END), 0) AS paid_cents,
      COALESCE(SUM(CASE WHEN wire_received = 0 THEN fee_cents ELSE 0 END), 0) AS unpaid_cents
    FROM appointments
    WHERE appointment_date > date('now') ${userFilter}
  `;

  db.get(sql, params, (err, row) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to build future report.' });
    }

    return res.json({
      totalAppointments: row.total_appointments,
      paidAppointments: row.paid_appointments,
      unpaidAppointments: row.unpaid_appointments,
      totalCents: row.total_cents,
      paidCents: row.paid_cents,
      unpaidCents: row.unpaid_cents,
    });
  });
});

module.exports = router;
