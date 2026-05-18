const express = require('express');

const router = express.Router();

router.get('/monthly', async (req, res) => {
  
  const { db, isPostgres } = require('../db/database');
  try {
    const month = req.query.month;
    const user = req.session.user;
  
  // Therapists only - admins cannot access revenue reports
  if (user.role === 'admin') {
    return res.status(403).json({ error: 'Revenue reports are for therapists only.' });
  }

    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: 'Month is required in YYYY-MM format.' });
    }

    let userFilter = '';
    const params = [month];
    let paramIndex = 2;
    if (user.role !== 'admin') {
      userFilter = `AND user_id = $${paramIndex}`;
      params.push(user.id);
      paramIndex++;
    } else if (req.query.userId) {
      userFilter = `AND user_id = $${paramIndex}`;
      params.push(Number(req.query.userId));
      paramIndex++;
    }

    const dateCompare = isPostgres ? "appointment_date::timestamp::date" : "date(appointment_date)";

    const sql = `
      SELECT
        COUNT(*) AS total_appointments,
        SUM(CASE WHEN wire_received = 1 THEN 1 ELSE 0 END) AS paid_appointments,
        SUM(CASE WHEN wire_received = 0 AND ${dateCompare} <= CURRENT_DATE THEN 1 ELSE 0 END) AS owed_appointments,
        COALESCE(SUM(fee_cents), 0) AS total_cents,
        COALESCE(SUM(CASE WHEN wire_received = 1 THEN fee_cents ELSE 0 END), 0) AS paid_cents,
        COALESCE(SUM(CASE WHEN wire_received = 0 AND ${dateCompare} <= CURRENT_DATE THEN fee_cents ELSE 0 END), 0) AS owed_cents
      FROM appointments
      WHERE ${isPostgres ? "to_char(appointment_date::timestamp, 'YYYY-MM')" : "strftime('%Y-%m', appointment_date)"} = $1 ${userFilter}
    `;

    const row = await db.get(sql, params);

    return res.json({
      month,
      totalAppointments: row.total_appointments,
      paidAppointments: row.paid_appointments,
      owedAppointments: row.owed_appointments,
      totalCents: row.total_cents,
      paidCents: row.paid_cents,
      owedCents: row.owed_cents,
    });
  } catch (err) {
    console.error('Error building monthly report:', err);
    return res.status(500).json({ error: 'Failed to build monthly report.' });
  }
});

router.get('/yearly', async (req, res) => {
  
  const { db, isPostgres } = require('../db/database');
  try {
    const year = req.query.year;
    const user = req.session.user;
    // Therapists only - admins cannot access revenue reports
    if (req.session.user.role === 'admin') {
      return res.status(403).json({ error: 'Revenue reports are for therapists only.' });
    }

    if (!year || !/^\d{4}$/.test(year)) {
      return res.status(400).json({ error: 'Year is required in YYYY format.' });
    }

    let userFilter = '';
    const params = [year];
    let paramIndex = 2;
    if (user.role !== 'admin') {
      userFilter = `AND user_id = $${paramIndex}`;
      params.push(user.id);
      paramIndex++;
    } else if (req.query.userId) {
      userFilter = `AND user_id = $${paramIndex}`;
      params.push(Number(req.query.userId));
      paramIndex++;
    }

    const dateCompare = isPostgres ? "appointment_date::timestamp::date" : "date(appointment_date)";

    const sql = `
      SELECT
        COUNT(*) AS total_appointments,
        SUM(CASE WHEN wire_received = 1 THEN 1 ELSE 0 END) AS paid_appointments,
        SUM(CASE WHEN wire_received = 0 AND ${dateCompare} <= CURRENT_DATE THEN 1 ELSE 0 END) AS owed_appointments,
        COALESCE(SUM(fee_cents), 0) AS total_cents,
        COALESCE(SUM(CASE WHEN wire_received = 1 THEN fee_cents ELSE 0 END), 0) AS paid_cents,
        COALESCE(SUM(CASE WHEN wire_received = 0 AND ${dateCompare} <= CURRENT_DATE THEN fee_cents ELSE 0 END), 0) AS owed_cents
      FROM appointments
      WHERE ${isPostgres ? "to_char(appointment_date::timestamp, 'YYYY')" : "strftime('%Y', appointment_date)"} = $1 ${userFilter}
    `;

    const row = await db.get(sql, params);

    return res.json({
      year,
      totalAppointments: row.total_appointments,
      paidAppointments: row.paid_appointments,
      owedAppointments: row.owed_appointments,
      totalCents: row.total_cents,
      paidCents: row.paid_cents,
      owedCents: row.owed_cents,
    });
  } catch (err) {
    console.error('Error building yearly report:', err);
    return res.status(500).json({ error: 'Failed to build yearly report.' });
  }
});

router.get('/total', async (req, res) => {
  
  const { db, isPostgres } = require('../db/database');
  try {
    const user = req.session.user;
    // Therapists only - admins cannot access revenue reports
    if (req.session.user.role === 'admin') {
      return res.status(403).json({ error: 'Revenue reports are for therapists only.' });
    }
    let userFilter = '';
    const params = [];
    let paramIndex = 1;
    if (user.role !== 'admin') {
      userFilter = `WHERE user_id = $${paramIndex}`;
      params.push(user.id);
      paramIndex++;
    } else if (req.query.userId) {
      userFilter = `WHERE user_id = $${paramIndex}`;
      params.push(Number(req.query.userId));
      paramIndex++;
    }

    const dateCompareTotal = isPostgres ? "appointment_date::timestamp::date" : "date(appointment_date)";

    const sql = `
      SELECT
        COUNT(*) AS total_appointments,
        SUM(CASE WHEN wire_received = 1 THEN 1 ELSE 0 END) AS paid_appointments,
        SUM(CASE WHEN wire_received = 0 AND ${dateCompareTotal} <= CURRENT_DATE THEN 1 ELSE 0 END) AS owed_appointments,
        COALESCE(SUM(fee_cents), 0) AS total_cents,
        COALESCE(SUM(CASE WHEN wire_received = 1 THEN fee_cents ELSE 0 END), 0) AS paid_cents,
        COALESCE(SUM(CASE WHEN wire_received = 0 AND ${dateCompareTotal} <= CURRENT_DATE THEN fee_cents ELSE 0 END), 0) AS owed_cents
      FROM appointments
      ${userFilter}
    `;

    const row = await db.get(sql, params);

    return res.json({
      totalAppointments: row.total_appointments,
      paidAppointments: row.paid_appointments,
      owedAppointments: row.owed_appointments,
      totalCents: row.total_cents,
      paidCents: row.paid_cents,
      owedCents: row.owed_cents,
    });
  } catch (err) {
    console.error('Error building total report:', err);
    return res.status(500).json({ error: 'Failed to build total report.' });
  }
});

router.get('/future', async (req, res) => {
  
  const { db, isPostgres } = require('../db/database');
  try {
    const user = req.session.user;
    // Therapists only - admins cannot access revenue reports
    if (req.session.user.role === 'admin') {
      return res.status(403).json({ error: 'Revenue reports are for therapists only.' });
    }
    let userFilter = '';
    const params = [];
    let paramIndex = 1;
    if (user.role !== 'admin') {
      userFilter = `AND user_id = $${paramIndex}`;
      params.push(user.id);
      paramIndex++;
    } else if (req.query.userId) {
      userFilter = `AND user_id = $${paramIndex}`;
      params.push(Number(req.query.userId));
      paramIndex++;
    }

    const dateCompareFuture = isPostgres ? "appointment_date::timestamp::date" : "date(appointment_date)";

    const sql = `
      SELECT
        COUNT(*) AS total_appointments,
        SUM(CASE WHEN wire_received = 1 THEN 1 ELSE 0 END) AS paid_appointments,
        SUM(CASE WHEN wire_received = 0 THEN 1 ELSE 0 END) AS unpaid_appointments,
        COALESCE(SUM(fee_cents), 0) AS total_cents,
        COALESCE(SUM(CASE WHEN wire_received = 1 THEN fee_cents ELSE 0 END), 0) AS paid_cents,
        COALESCE(SUM(CASE WHEN wire_received = 0 THEN fee_cents ELSE 0 END), 0) AS unpaid_cents
      FROM appointments
      WHERE ${dateCompareFuture} > CURRENT_DATE ${userFilter}
    `;

    const row = await db.get(sql, params);

    return res.json({
      totalAppointments: row.total_appointments,
      paidAppointments: row.paid_appointments,
      unpaidAppointments: row.unpaid_appointments,
      totalCents: row.total_cents,
      paidCents: row.paid_cents,
      unpaidCents: row.unpaid_cents,
    });
  } catch (err) {
    console.error('Error building future report:', err);
    return res.status(500).json({ error: 'Failed to build future report.' });
  }
});

router.get('/by-client', async (req, res) => {
  const { db, isPostgres } = require('../db/database');
  try {
    const user = req.session.user;
    if (user.role === 'admin') {
      return res.status(403).json({ error: 'Revenue reports are for therapists only.' });
    }

    let userFilter = 'WHERE a.user_id = $1';
    const params = [user.id];

    const dateCompare = isPostgres ? "a.appointment_date::timestamp::date" : "date(a.appointment_date)";

    const sql = `
      SELECT
        c.id AS client_id,
        c.full_name,
        COUNT(*) AS total_appointments,
        SUM(CASE WHEN a.wire_received = 1 THEN 1 ELSE 0 END) AS paid_appointments,
        SUM(CASE WHEN a.wire_received = 0 AND ${dateCompare} <= CURRENT_DATE THEN 1 ELSE 0 END) AS owed_appointments,
        COALESCE(SUM(a.fee_cents), 0) AS total_cents,
        COALESCE(SUM(CASE WHEN a.wire_received = 1 THEN a.fee_cents ELSE 0 END), 0) AS paid_cents,
        COALESCE(SUM(CASE WHEN a.wire_received = 0 AND ${dateCompare} <= CURRENT_DATE THEN a.fee_cents ELSE 0 END), 0) AS owed_cents,
        MAX(a.appointment_date) AS last_appointment
      FROM appointments a
      JOIN clients c ON c.id = a.client_id
      ${userFilter}
      GROUP BY c.id, c.full_name
      ORDER BY c.full_name
    `;

    const rows = await db.all(sql, params);
    return res.json(rows);
  } catch (err) {
    console.error('Error building by-client report:', err);
    return res.status(500).json({ error: 'Failed to build client report.' });
  }
});

module.exports = router;
