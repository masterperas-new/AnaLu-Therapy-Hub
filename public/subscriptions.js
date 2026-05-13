(function () {
  const { api, getUser, euroFromCents, ensureAuth } = window.AppCommon;

  const subsTableBody = document.getElementById('subs-table-body');
  const subOverlay = document.getElementById('sub-overlay');
  const subDrawer = document.getElementById('sub-drawer');
  const subDrawerTitle = document.getElementById('sub-drawer-title');
  const closeDrawerBtn = document.getElementById('close-sub-drawer');

  // Report elements
  const reportYear = document.getElementById('reportYear');
  const loadReportBtn = document.getElementById('loadReport');
  const toggleReportBtn = document.getElementById('toggleReport');
  const reportBody = document.getElementById('report-body');
  const reportKpis = document.getElementById('reportKpis');
  const reportMonthlyBody = document.getElementById('report-monthly-body');
  const reportMonthlyFoot = document.getElementById('report-monthly-foot');
  const reportOutstandingBody = document.getElementById('report-outstanding-body');
  const outstandingHeading = document.getElementById('outstanding-heading');
  const outstandingTable = document.getElementById('outstanding-table');

  // Subscription settings
  const subSettingsForm = document.getElementById('sub-settings-form');
  const subUserId = document.getElementById('subUserId');
  const subMonthlyPrice = document.getElementById('subMonthlyPrice');
  const subStatus = document.getElementById('subStatus');
  const subNotes = document.getElementById('subNotes');

  // Payment form
  const paymentForm = document.getElementById('payment-form');
  const paymentId = document.getElementById('paymentId');
  const payAmount = document.getElementById('payAmount');
  const payDate = document.getElementById('payDate');
  const payCoversUntil = document.getElementById('payCoversUntil');
  const payMethod = document.getElementById('payMethod');
  const payNotes = document.getElementById('payNotes');
  const paySubmitBtn = document.getElementById('paySubmitBtn');
  const payCancelEditBtn = document.getElementById('payCancelEditBtn');
  const paymentHistory = document.getElementById('payment-history');

  let allSubs = [];

  /* ── Dialog ── */
  function showDialog(message, isError) {
    const existing = document.getElementById('app-dialog-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'app-dialog-overlay';
    Object.assign(overlay.style, {
      position: 'fixed', inset: '0', background: 'rgba(0,0,0,.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: '9999',
    });

    const box = document.createElement('div');
    Object.assign(box.style, {
      background: 'var(--surface, #fff)', borderRadius: '12px', padding: '24px 28px',
      maxWidth: '380px', width: '90%', boxShadow: '0 8px 32px rgba(0,0,0,.18)',
      textAlign: 'center', fontFamily: 'inherit',
    });

    const title = document.createElement('div');
    title.textContent = 'AnaLu Therapy Hub';
    Object.assign(title.style, { fontWeight: '700', fontSize: '1rem', marginBottom: '10px', color: 'var(--primary, #2563eb)' });

    const msg = document.createElement('div');
    msg.textContent = message;
    Object.assign(msg.style, { fontSize: '0.95rem', marginBottom: '18px', color: isError ? 'var(--danger, #c0392b)' : 'var(--text, #333)' });

    const btn = document.createElement('button');
    btn.textContent = 'OK';
    Object.assign(btn.style, {
      padding: '8px 32px', borderRadius: '8px', border: 'none', cursor: 'pointer',
      fontWeight: '600', fontSize: '0.9rem',
      background: isError ? 'var(--danger, #c0392b)' : 'var(--primary, #2563eb)', color: '#fff',
    });
    btn.addEventListener('click', () => overlay.remove());

    box.append(title, msg, btn);
    overlay.appendChild(box);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
  }

  /* ── Drawer ── */
  function openDrawer(userName) {
    subDrawerTitle.textContent = userName;
    subOverlay.classList.remove('hidden');
    subDrawer.classList.remove('hidden');
    requestAnimationFrame(() => {
      subOverlay.classList.add('open');
      subDrawer.classList.add('open');
      subDrawer.setAttribute('aria-hidden', 'false');
    });
  }

  function closeDrawer() {
    subOverlay.classList.remove('open');
    subDrawer.classList.remove('open');
    subDrawer.setAttribute('aria-hidden', 'true');
    setTimeout(() => {
      subOverlay.classList.add('hidden');
      subDrawer.classList.add('hidden');
    }, 220);
    clearPaymentForm();
  }

  closeDrawerBtn.addEventListener('click', closeDrawer);
  subOverlay.addEventListener('click', closeDrawer);

  /* ── Helpers ── */
  function computeBalance(sub) {
    if (!sub.monthly_price_cents) return { label: '-', cls: '' };
    const coversUntil = sub.last_covers_until;
    if (!coversUntil) return { label: 'No payments', cls: 'status-owed' };

    const today = new Date();
    const until = new Date(coversUntil + 'T23:59:59');
    if (until >= today) {
      return { label: 'Paid', cls: 'status-paid' };
    }

    // Calculate months overdue
    const todayMonth = today.getFullYear() * 12 + today.getMonth();
    const untilMonth = until.getFullYear() * 12 + until.getMonth();
    const monthsOverdue = todayMonth - untilMonth;
    const debtCents = monthsOverdue * sub.monthly_price_cents;
    return { label: `${euroFromCents(debtCents)} owed`, cls: 'status-owed' };
  }

  function formatDate(dateStr) {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  /* ── Load & Render ── */
  async function loadSubs() {
    try {
      allSubs = await api('/ALTApi/subscriptions');
      renderTable();
    } catch (err) {
      showDialog(err.message, true);
    }
  }

  function renderTable() {
    subsTableBody.innerHTML = '';

    if (!allSubs.length) {
      subsTableBody.innerHTML = '<tr><td colspan="7" class="small">No therapists found.</td></tr>';
      return;
    }

    allSubs.forEach((sub) => {
      const tr = document.createElement('tr');
      tr.className = 'appt-row';
      tr.tabIndex = 0;

      const price = sub.monthly_price_cents ? euroFromCents(sub.monthly_price_cents) : 'Not set';
      const statusLabel = sub.sub_status || 'Not set';
      const statusCls = sub.sub_status === 'active' ? 'status-paid' : sub.sub_status === 'cancelled' ? 'status-owed' : '';
      const balance = computeBalance(sub);

      tr.innerHTML = `
        <td>${sub.full_name}</td>
        <td>${price}</td>
        <td><span class="${statusCls}">${statusLabel.charAt(0).toUpperCase() + statusLabel.slice(1)}</span></td>
        <td style="font-size:0.9rem;color:var(--muted);white-space:nowrap">${formatDate(sub.last_paid_date)}</td>
        <td style="font-size:0.9rem;color:var(--muted);white-space:nowrap">${formatDate(sub.last_covers_until)}</td>
        <td><span class="${balance.cls}">${balance.label}</span></td>
      `;

      const actionTd = document.createElement('td');
      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'outline';
      editBtn.textContent = 'Manage';
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openSubDetail(sub);
      });
      actionTd.appendChild(editBtn);
      tr.appendChild(actionTd);

      tr.addEventListener('click', () => openSubDetail(sub));
      tr.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openSubDetail(sub); }
      });

      subsTableBody.appendChild(tr);
    });
  }

  /* ── Open detail drawer ── */
  async function openSubDetail(sub) {
    subUserId.value = sub.user_id;
    subMonthlyPrice.value = sub.monthly_price_cents ? (sub.monthly_price_cents / 100).toFixed(2) : '';
    subStatus.value = sub.sub_status || 'active';
    subNotes.value = sub.sub_notes || '';

    payDate.value = new Date().toISOString().slice(0, 10);

    openDrawer(sub.full_name);
    await loadPayments(sub.user_id);
  }

  /* ── Save subscription settings ── */
  subSettingsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const userId = Number(subUserId.value);
    const priceCents = Math.round(Number(subMonthlyPrice.value) * 100);

    try {
      await api(`/ALTApi/subscriptions/${userId}`, {
        method: 'PUT',
        body: JSON.stringify({
          monthlyPriceCents: priceCents,
          status: subStatus.value,
          notes: subNotes.value || null,
        }),
      });
      showDialog('Subscription saved.');
      await loadSubs();
    } catch (err) {
      showDialog(err.message, true);
    }
  });

  /* ── Payment form ── */
  function clearPaymentForm() {
    paymentId.value = '';
    payAmount.value = '';
    payDate.value = new Date().toISOString().slice(0, 10);
    payCoversUntil.value = '';
    payMethod.value = '';
    payNotes.value = '';
    paySubmitBtn.textContent = 'Record Payment';
    payCancelEditBtn.classList.add('hidden');
  }

  payCancelEditBtn.addEventListener('click', clearPaymentForm);

  paymentForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const userId = Number(subUserId.value);
    const amountCents = Math.round(Number(payAmount.value) * 100);
    const editId = paymentId.value;

    const payload = {
      amountCents,
      paidDate: payDate.value,
      coversUntil: payCoversUntil.value,
      paymentMethod: payMethod.value || null,
      notes: payNotes.value || null,
    };

    try {
      if (editId) {
        await api(`/ALTApi/subscriptions/payments/${editId}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        showDialog('Payment updated.');
      } else {
        await api(`/ALTApi/subscriptions/${userId}/payments`, {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        showDialog('Payment recorded.');
      }
      clearPaymentForm();
      await loadPayments(userId);
      await loadSubs();
    } catch (err) {
      showDialog(err.message, true);
    }
  });

  /* ── Payment history ── */
  async function loadPayments(userId) {
    try {
      const payments = await api(`/ALTApi/subscriptions/${userId}/payments`);
      renderPayments(payments);
    } catch (err) {
      paymentHistory.innerHTML = '<p style="color:var(--danger)">Failed to load payments.</p>';
    }
  }

  function renderPayments(payments) {
    if (!payments.length) {
      paymentHistory.innerHTML = '<p class="small" style="color:var(--muted);text-align:center;padding:16px 0">No payments recorded yet.</p>';
      return;
    }

    paymentHistory.innerHTML = '';
    payments.forEach((p) => {
      const card = document.createElement('div');
      card.className = 'rec-card';
      card.innerHTML = `
        <div class="rec-card-head">
          <strong>${euroFromCents(p.amount_cents)}</strong>
          <span class="small">${formatDate(p.paid_date)}</span>
        </div>
        <div class="rec-card-detail">Covers until: ${formatDate(p.covers_until)}</div>
        ${p.payment_method ? `<div class="rec-card-detail">Method: ${p.payment_method}</div>` : ''}
        ${p.notes ? `<div class="rec-card-detail">${p.notes}</div>` : ''}
        <div class="rec-card-actions" style="display:flex;gap:6px">
          <button type="button" class="outline tiny-btn edit-pay-btn">Edit</button>
          <button type="button" class="outline tiny-btn delete-pay-btn" style="color:var(--danger);border-color:var(--danger)">Delete</button>
        </div>
      `;

      card.querySelector('.edit-pay-btn').addEventListener('click', () => {
        paymentId.value = p.id;
        payAmount.value = (p.amount_cents / 100).toFixed(2);
        payDate.value = p.paid_date;
        payCoversUntil.value = p.covers_until;
        payMethod.value = p.payment_method || '';
        payNotes.value = p.notes || '';
        paySubmitBtn.textContent = 'Update Payment';
        payCancelEditBtn.classList.remove('hidden');
        payAmount.focus();
      });

      card.querySelector('.delete-pay-btn').addEventListener('click', async () => {
        if (!confirm('Delete this payment record?')) return;
        try {
          await api(`/ALTApi/subscriptions/payments/${p.id}`, { method: 'DELETE' });
          showDialog('Payment deleted.');
          await loadPayments(Number(subUserId.value));
          await loadSubs();
        } catch (err) {
          showDialog(err.message, true);
        }
      });

      paymentHistory.appendChild(card);
    });
  }

  /* ── Economic Report ── */
  const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  let reportVisible = false;
  let reportLoaded = false;

  toggleReportBtn.addEventListener('click', async () => {
    reportVisible = !reportVisible;
    reportBody.style.display = reportVisible ? '' : 'none';
    toggleReportBtn.textContent = reportVisible ? 'Hide' : 'Show';
    if (reportVisible && !reportLoaded) {
      reportLoaded = true;
      await loadReport();
    }
  });

  loadReportBtn.addEventListener('click', () => loadReport());

  async function loadReport() {
    const year = reportYear.value || new Date().getFullYear();
    try {
      const r = await api(`/ALTApi/subscriptions/report?year=${year}`);
      renderReport(r);
    } catch (err) {
      showDialog(err.message, true);
    }
  }

  function renderReport(r) {
    // KPI cards
    reportKpis.innerHTML = `
      <div class="rev-kpi">
        <span class="rev-kpi-label">Active Subscriptions</span>
        <span class="rev-kpi-val">${r.totalActiveSubs}</span>
      </div>
      <div class="rev-kpi">
        <span class="rev-kpi-label">Expected Monthly</span>
        <span class="rev-kpi-val">${euroFromCents(r.expectedMonthlyCents)}</span>
      </div>
      <div class="rev-kpi rev-kpi--ok">
        <span class="rev-kpi-label">Received This Month</span>
        <span class="rev-kpi-val">${euroFromCents(r.receivedThisMonthCents)}</span>
      </div>
      <div class="rev-kpi rev-kpi--ok">
        <span class="rev-kpi-label">Received ${r.year}</span>
        <span class="rev-kpi-val">${euroFromCents(r.receivedThisYearCents)}</span>
      </div>
      <div class="rev-kpi${r.totalOutstandingCents > 0 ? ' rev-kpi--warn' : ' rev-kpi--ok'}">
        <span class="rev-kpi-label">Outstanding</span>
        <span class="rev-kpi-val">${r.totalOutstandingCents > 0 ? euroFromCents(r.totalOutstandingCents) : '€0.00'}</span>
      </div>
    `;

    // Monthly breakdown
    reportMonthlyBody.innerHTML = '';
    let yearTotalCents = 0;
    let yearTotalPayments = 0;

    r.monthlyBreakdown.forEach((m) => {
      yearTotalCents += m.totalCents;
      yearTotalPayments += m.paymentCount;

      const diffCents = m.totalCents - r.expectedMonthlyCents;
      const diffLabel = r.expectedMonthlyCents === 0 ? '-' :
        diffCents === 0 ? 'On target' :
        diffCents > 0 ? `+${euroFromCents(diffCents)}` : euroFromCents(diffCents);
      const diffCls = diffCents > 0 ? 'status-paid' : diffCents < 0 ? 'status-owed' : '';

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${MONTH_NAMES[m.month - 1]} ${r.year}</td>
        <td>${m.paymentCount}</td>
        <td>${m.totalCents > 0 ? euroFromCents(m.totalCents) : '-'}</td>
        <td><span class="${diffCls}">${m.paymentCount > 0 ? diffLabel : '-'}</span></td>
      `;
      reportMonthlyBody.appendChild(tr);
    });

    // Footer totals
    const expectedYearlyCents = r.expectedMonthlyCents * 12;
    const yearDiff = yearTotalCents - expectedYearlyCents;
    const yearDiffLabel = expectedYearlyCents === 0 ? '-' :
      yearDiff === 0 ? 'On target' :
      yearDiff > 0 ? `+${euroFromCents(yearDiff)}` : euroFromCents(yearDiff);
    const yearDiffCls = yearDiff > 0 ? 'status-paid' : yearDiff < 0 ? 'status-owed' : '';

    reportMonthlyFoot.innerHTML = `
      <tr style="font-weight:700;border-top:2px solid var(--border)">
        <td>Total ${r.year}</td>
        <td>${yearTotalPayments}</td>
        <td>${euroFromCents(yearTotalCents)}</td>
        <td><span class="${yearDiffCls}">${yearDiffLabel}</span></td>
      </tr>
    `;

    // Outstanding details
    if (r.outstandingDetails.length > 0) {
      outstandingHeading.classList.remove('hidden');
      outstandingTable.classList.remove('hidden');
      reportOutstandingBody.innerHTML = '';
      r.outstandingDetails.forEach((d) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${d.full_name}</td>
          <td>${euroFromCents(d.monthly_price_cents)}</td>
          <td>${d.months_overdue}</td>
          <td><span class="status-owed">${euroFromCents(d.owed_cents)}</span></td>
        `;
        reportOutstandingBody.appendChild(tr);
      });
    } else {
      outstandingHeading.classList.add('hidden');
      outstandingTable.classList.add('hidden');
    }
  }

  /* ── Init ── */
  ensureAuth(async () => {
    const user = getUser();
    if (!user || user.role !== 'admin') {
      document.getElementById('app-content').innerHTML =
        '<section class="card"><h2>Access Denied</h2><p>Admin access required.</p></section>';
      return;
    }
    reportYear.value = new Date().getFullYear();
    await loadSubs();
  });
})();
