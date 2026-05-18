const monthInput = document.getElementById('monthInput');
const monthKpis = document.getElementById('monthKpis');
const totalKpis = document.getElementById('totalKpis');
const monthLabel = document.getElementById('month-label');
const owedLabel = document.getElementById('owed-label');
const owedSearch = document.getElementById('owedSearch');
const owedTableBody = document.getElementById('owed-table-body');
const owedEmpty = document.getElementById('owedEmpty');
const owedPager = document.getElementById('owed-pager');
const owedPagerPrev = document.getElementById('owed-pager-prev');
const owedPagerNext = document.getElementById('owed-pager-next');
const owedPagerInfo = document.getElementById('owed-pager-info');

const futureLabel = document.getElementById('future-label');
const futureKpis = document.getElementById('futureKpis');

const PAGE_SIZE = 5;
let owedCurrentPage = 1;
let allOwed = [];
let isAdmin = false;

const therapistFilterWrap = document.getElementById('therapist-filter-wrap');
const therapistFilter = document.getElementById('therapistFilter');

function userIdParam() {
  if (!isAdmin) return '';
  const val = therapistFilter.value;
  return val ? `&userId=${val}` : '';
}

function userIdSeparator() {
  if (!isAdmin) return '';
  const val = therapistFilter.value;
  return val ? `?userId=${val}` : '';
}

function renderKpis(target, report) {
  target.innerHTML = `
    <div class="rev-kpi">
      <span class="rev-kpi-label">Appointments</span>
      <span class="rev-kpi-val">${report.totalAppointments}</span>
    </div>
    <div class="rev-kpi rev-kpi--ok">
      <span class="rev-kpi-label">Paid</span>
      <span class="rev-kpi-val">${report.paidAppointments}</span>
    </div>
    <div class="rev-kpi rev-kpi--warn rev-kpi--clickable" data-action="show-owed">
      <span class="rev-kpi-label">Owed</span>
      <span class="rev-kpi-val">${report.owedAppointments}</span>
    </div>
    <div class="rev-kpi">
      <span class="rev-kpi-label">Total Revenue</span>
      <span class="rev-kpi-val">${AppCommon.euroFromCents(report.totalCents)}</span>
    </div>
    <div class="rev-kpi rev-kpi--ok">
      <span class="rev-kpi-label">Paid Revenue</span>
      <span class="rev-kpi-val">${AppCommon.euroFromCents(report.paidCents)}</span>
    </div>
    <div class="rev-kpi rev-kpi--warn rev-kpi--clickable" data-action="show-owed">
      <span class="rev-kpi-label">Owed Revenue</span>
      <span class="rev-kpi-val">${AppCommon.euroFromCents(report.owedCents)}</span>
    </div>
  `;

  target.querySelectorAll('[data-action="show-owed"]').forEach((el) => {
    el.addEventListener('click', () => openOwedDrawer());
  });
}

function renderOwedTable(filter) {
  const term = (filter || '').toLowerCase();
  const rows = allOwed.filter((a) => {
    if (!term) return true;
    // Exact name match when locked to a client
    if (owedLockedClient) {
      return a.full_name.toLowerCase() === term;
    }
    const date = new Date(a.appointment_date).toLocaleDateString('en-GB');
    return (
      a.full_name.toLowerCase().includes(term) ||
      date.includes(term) ||
      (a.comments || '').toLowerCase().includes(term) ||
      (a.notes || '').toLowerCase().includes(term)
    );
  });

  // Update title with filtered count
  owedLabel.textContent = `Outstanding Payments (${rows.length})`;

  owedTableBody.innerHTML = '';

  if (!rows.length) {
    owedEmpty.textContent = allOwed.length ? 'No matches.' : 'No outstanding payments.';
    owedEmpty.classList.remove('hidden');
    owedPager.classList.add('hidden');
    return;
  }

  owedEmpty.classList.add('hidden');

  const totalPages = Math.ceil(rows.length / PAGE_SIZE);
  if (owedCurrentPage > totalPages) owedCurrentPage = totalPages;
  const start = (owedCurrentPage - 1) * PAGE_SIZE;
  const pageRows = rows.slice(start, start + PAGE_SIZE);

  if (totalPages <= 1) {
    owedPager.classList.add('hidden');
  } else {
    owedPager.classList.remove('hidden');
    owedPagerPrev.disabled = owedCurrentPage <= 1;
    owedPagerNext.disabled = owedCurrentPage >= totalPages;
    owedPagerInfo.textContent = `Page ${owedCurrentPage} of ${totalPages}`;
  }

  pageRows.forEach((a) => {
    const tr = document.createElement('tr');
    const date = new Date(a.appointment_date).toLocaleDateString('en-GB');
    const fee = AppCommon.euroFromCents(a.fee_cents);
    const notes = a.comments || a.notes || '';

    tr.innerHTML = `
      <td>${a.full_name}</td>
      <td>${date}</td>
      <td>${fee}</td>
      <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${notes}</td>
      <td></td>
    `;

    const payBtn = document.createElement('button');
    payBtn.type = 'button';
    payBtn.className = 'outline tiny-btn';
    payBtn.textContent = '\u2713 Paid';
    payBtn.style.color = 'var(--ok)';
    payBtn.style.borderColor = 'var(--ok)';
    payBtn.addEventListener('click', async () => {
      const ok = await AppCommon.confirmPayment({
        name: a.full_name,
        date: new Date(a.appointment_date).toLocaleDateString('en-GB'),
        fee: AppCommon.euroFromCents(a.fee_cents),
      });
      if (!ok) return;
      try {
        await AppCommon.api(`/ALTApi/appointments/${a.id}/payment-received`, {
          method: 'PATCH',
          body: JSON.stringify({}),
        });
        AppCommon.setMessage('Marked as paid.');
        await Promise.all([loadTotal(), loadMonth(), loadOwed(), loadFuture()]);
      } catch (err) {
        AppCommon.setMessage(err.message, true);
      }
    });

    tr.lastElementChild.appendChild(payBtn);
    owedTableBody.appendChild(tr);
  });
}

owedSearch.addEventListener('input', () => {
  owedCurrentPage = 1;
  renderOwedTable(owedSearch.value);
});

owedPagerPrev.addEventListener('click', () => {
  owedCurrentPage -= 1;
  renderOwedTable(owedSearch.value);
});

owedPagerNext.addEventListener('click', () => {
  owedCurrentPage += 1;
  renderOwedTable(owedSearch.value);
});

const owedOverlay = document.getElementById('owed-overlay');
const owedDrawer = document.getElementById('owed-drawer');
const closeOwedBtn = document.getElementById('close-owed');

let owedLockedClient = null;

function openOwedDrawer(filterName) {
  owedLockedClient = filterName || null;
  owedSearch.value = filterName || '';
  owedSearch.readOnly = !!owedLockedClient;
  owedCurrentPage = 1;
  renderOwedTable(owedSearch.value);
  owedOverlay.classList.remove('hidden');
  owedDrawer.classList.remove('hidden');
  requestAnimationFrame(() => {
    owedOverlay.classList.add('open');
    owedDrawer.classList.add('open');
    owedDrawer.setAttribute('aria-hidden', 'false');
  });
}

function closeOwedDrawer() {
  owedLockedClient = null;
  owedSearch.readOnly = false;
  owedOverlay.classList.remove('open');
  owedDrawer.classList.remove('open');
  owedDrawer.setAttribute('aria-hidden', 'true');
  setTimeout(() => {
    owedOverlay.classList.add('hidden');
    owedDrawer.classList.add('hidden');
  }, 220);
}

closeOwedBtn.addEventListener('click', closeOwedDrawer);
owedOverlay.addEventListener('click', closeOwedDrawer);

/* ── Export Outstanding Payments ── */
document.getElementById('exportOwedBtn').addEventListener('click', () => {
  const term = (owedSearch.value || '').toLowerCase();
  const rows = allOwed.filter((a) => {
    if (!term) return true;
    if (owedLockedClient) return a.full_name.toLowerCase() === term;
    const date = new Date(a.appointment_date).toLocaleDateString('en-GB');
    return a.full_name.toLowerCase().includes(term) || date.includes(term) || (a.comments || '').toLowerCase().includes(term) || (a.notes || '').toLowerCase().includes(term);
  });

  const headers = ['Patient', 'Date', 'Fee (€)', 'Notes'];
  const data = rows.map(a => [
    a.full_name,
    new Date(a.appointment_date).toLocaleDateString('en-GB'),
    (a.fee_cents / 100).toFixed(2),
    a.comments || a.notes || '',
  ]);

  const prefix = owedLockedClient ? owedLockedClient.replace(/\s+/g, '-') : 'all';
  const title = owedLockedClient ? `Outstanding Payments — ${owedLockedClient}` : 'Outstanding Payments — All Clients';
  AppCommon.exportToXls(`outstanding-payments-${prefix}.xls`, headers, data, title);
});

/* ── Future Revenue table ── */

function renderFutureKpis(report) {
  futureKpis.innerHTML = `
    <div class="rev-kpi">
      <span class="rev-kpi-label">Appointments</span>
      <span class="rev-kpi-val">${report.totalAppointments}</span>
    </div>
    <div class="rev-kpi rev-kpi--ok">
      <span class="rev-kpi-label">Pre-paid</span>
      <span class="rev-kpi-val">${report.paidAppointments}</span>
    </div>
    <div class="rev-kpi">
      <span class="rev-kpi-label">Pending</span>
      <span class="rev-kpi-val">${report.unpaidAppointments}</span>
    </div>
    <div class="rev-kpi">
      <span class="rev-kpi-label">Expected Revenue</span>
      <span class="rev-kpi-val">${AppCommon.euroFromCents(report.totalCents)}</span>
    </div>
    <div class="rev-kpi rev-kpi--ok">
      <span class="rev-kpi-label">Pre-paid Revenue</span>
      <span class="rev-kpi-val">${AppCommon.euroFromCents(report.paidCents)}</span>
    </div>
    <div class="rev-kpi">
      <span class="rev-kpi-label">Pending Revenue</span>
      <span class="rev-kpi-val">${AppCommon.euroFromCents(report.unpaidCents)}</span>
    </div>
  `;
}

async function loadTotal() {
  const report = await AppCommon.api(`/ALTApi/reports/total${userIdSeparator()}`);
  renderKpis(totalKpis, report);
}

async function loadOwed() {
  const today = new Date().toISOString().slice(0, 10);
  allOwed = await AppCommon.api(`/ALTApi/appointments?wireReceived=0&to=${today}${userIdParam()}`);
  // If drawer is open and locked to a client, re-render with that filter
  if (owedLockedClient) {
    renderOwedTable(owedLockedClient);
  } else {
    owedLabel.textContent = `Outstanding Payments (${allOwed.length})`;
    owedSearch.value = '';
    owedCurrentPage = 1;
    renderOwedTable();
  }
}

async function loadFuture() {
  const report = await AppCommon.api(`/ALTApi/reports/future${userIdSeparator()}`);
  renderFutureKpis(report);
  futureLabel.textContent = `Future Revenue (${report.totalAppointments})`;
}

async function loadMonth() {
  const month = monthInput.value;
  if (!month) {
    AppCommon.setMessage('Select a month first.', true);
    return;
  }

  const report = await AppCommon.api(`/ALTApi/reports/monthly?month=${encodeURIComponent(month)}${userIdParam()}`);
  monthLabel.textContent = `Monthly \u2014 ${month}`;
  renderKpis(monthKpis, report);
}

document.getElementById('loadMonth').addEventListener('click', async () => {
  try {
    await loadMonth();
    AppCommon.setMessage('Monthly revenue loaded.');
  } catch (error) {
    AppCommon.setMessage(error.message, true);
  }
});

async function loadAll() {
  await Promise.all([loadTotal(), loadMonth(), loadOwed(), loadFuture(), loadClientRevenue()]);
}

/* ── Revenue by Client ── */
const clientRevenueSelect = document.getElementById('clientRevenueSelect');
const clientRevenueKpis = document.getElementById('clientRevenueKpis');
const clientRevenueBody = document.getElementById('client-revenue-body');
const clientBackBtn = document.getElementById('clientBackBtn');

let allClientRevenue = [];
let clientSearchSelect = null;

function showAllClients() {
  if (clientSearchSelect) clientSearchSelect.clear();
  renderClientTable(allClientRevenue);
  clientRevenueKpis.classList.add('hidden');
  clientBackBtn.classList.add('hidden');
}

clientBackBtn.addEventListener('click', showAllClients);

/* ── Export Revenue by Client ── */
document.getElementById('exportClientBtn').addEventListener('click', async () => {
  // Determine what's currently displayed
  const selectedId = clientSearchSelect ? clientSearchSelect.getValue() : '';
  const visibleRows = selectedId
    ? allClientRevenue.filter(r => String(r.client_id) === selectedId)
    : allClientRevenue;

  if (!visibleRows.length) {
    AppCommon.setMessage('No data to export.', true);
    return;
  }

  // If a single client is selected, export their appointments with payment details
  if (selectedId && visibleRows.length === 1) {
    const client = visibleRows[0];
    try {
      const today = new Date().toISOString().slice(0, 10);
      const appts = await AppCommon.api(`/ALTApi/appointments?clientId=${client.client_id}`);
      const headers = ['Date', 'Location', 'Duration (min)', 'Fee (€)', 'Paid', 'Payment Type', 'Notes'];
      const data = appts.map(a => [
        new Date(a.appointment_date).toLocaleDateString('en-GB'),
        a.location || '',
        a.duration_minutes,
        (a.fee_cents / 100).toFixed(2),
        a.wire_received ? 'Yes' : 'No',
        a.payment_type || '',
        a.comments || a.notes || '',
      ]);
      AppCommon.exportToXls(`appointments-${client.full_name.replace(/\s+/g, '-')}.xls`, headers, data, `Appointments — ${client.full_name}`);
    } catch (err) {
      AppCommon.setMessage(err.message, true);
    }
    return;
  }

  // Otherwise export the summary table
  const headers = ['Client', 'Appointments', 'Paid', 'Owed', 'Total (€)', 'Paid (€)', 'Owed (€)'];
  const data = visibleRows.map(r => [
    r.full_name,
    r.total_appointments,
    r.paid_appointments,
    r.owed_appointments,
    (r.total_cents / 100).toFixed(2),
    (r.paid_cents / 100).toFixed(2),
    (r.owed_cents / 100).toFixed(2),
  ]);
  AppCommon.exportToXls('revenue-by-client.xls', headers, data, 'Revenue by Client — All');
});

async function loadClientRevenue() {
  try {
    allClientRevenue = await AppCommon.api('/ALTApi/reports/by-client');
    initClientSearch();
    renderClientTable(allClientRevenue);
  } catch (err) {
    clientRevenueBody.innerHTML = `<tr><td colspan="7" style="color:var(--danger)">${err.message}</td></tr>`;
  }
}

function initClientSearch() {
  const items = allClientRevenue.map(r => ({ id: r.client_id, label: r.full_name }));
  if (!clientSearchSelect) {
    clientSearchSelect = AppCommon.createSearchSelect(clientRevenueSelect, items, {
      placeholder: 'Search client…',
      onChange: (id) => {
        if (id) {
          const row = allClientRevenue.find(r => String(r.client_id) === id);
          renderClientTable(row ? [row] : []);
          renderClientKpis(row);
          clientBackBtn.classList.remove('hidden');
        } else {
          showAllClients();
        }
      },
    });
    // When input is cleared (blur without selection), show all
    clientRevenueSelect.addEventListener('change', () => {
      if (!clientRevenueSelect.value) {
        showAllClients();
      }
    });
  } else {
    clientSearchSelect.setItems(items);
  }
}

function renderClientKpis(row) {
  if (!row) {
    clientRevenueKpis.classList.add('hidden');
    return;
  }
  clientRevenueKpis.classList.remove('hidden');
  clientRevenueKpis.innerHTML = `
    <div class="rev-kpi">
      <span class="rev-kpi-label">Appointments</span>
      <span class="rev-kpi-val">${row.total_appointments}</span>
    </div>
    <div class="rev-kpi rev-kpi--ok">
      <span class="rev-kpi-label">Paid</span>
      <span class="rev-kpi-val">${row.paid_appointments}</span>
    </div>
    <div class="rev-kpi rev-kpi--warn rev-kpi--clickable" data-action="show-client-owed" data-client="${row.full_name}">
      <span class="rev-kpi-label">Owed</span>
      <span class="rev-kpi-val">${row.owed_appointments}</span>
    </div>
    <div class="rev-kpi">
      <span class="rev-kpi-label">Total Revenue</span>
      <span class="rev-kpi-val">${AppCommon.euroFromCents(row.total_cents)}</span>
    </div>
    <div class="rev-kpi rev-kpi--ok">
      <span class="rev-kpi-label">Paid Revenue</span>
      <span class="rev-kpi-val">${AppCommon.euroFromCents(row.paid_cents)}</span>
    </div>
    <div class="rev-kpi rev-kpi--warn rev-kpi--clickable" data-action="show-client-owed" data-client="${row.full_name}">
      <span class="rev-kpi-label">Owed Revenue</span>
      <span class="rev-kpi-val">${AppCommon.euroFromCents(row.owed_cents)}</span>
    </div>
  `;

  clientRevenueKpis.querySelectorAll('[data-action="show-client-owed"]').forEach(el => {
    el.addEventListener('click', () => openOwedDrawer(el.dataset.client));
  });
}

function renderClientTable(rows) {
  clientRevenueBody.innerHTML = '';
  if (!rows.length) {
    clientRevenueBody.innerHTML = '<tr><td colspan="7" style="color:var(--muted);text-align:center;padding:16px">No data.</td></tr>';
    return;
  }
  rows.forEach(r => {
    const tr = document.createElement('tr');
    tr.className = 'appt-row';
    tr.style.cursor = 'pointer';
    tr.innerHTML = `
      <td>${r.full_name}</td>
      <td>${r.total_appointments}</td>
      <td>${r.paid_appointments}</td>
      <td>${r.owed_appointments > 0 ? `<span class="status-owed clickable-owed" data-client="${r.full_name}">${r.owed_appointments}</span>` : '0'}</td>
      <td>${AppCommon.euroFromCents(r.total_cents)}</td>
      <td>${AppCommon.euroFromCents(r.paid_cents)}</td>
      <td>${r.owed_cents > 0 ? `<span class="status-owed clickable-owed" data-client="${r.full_name}">${AppCommon.euroFromCents(r.owed_cents)}</span>` : '€0.00'}</td>
    `;
    // Attach click handlers to owed spans directly
    tr.querySelectorAll('.clickable-owed').forEach(span => {
      span.addEventListener('click', (e) => {
        e.stopPropagation();
        openOwedDrawer(span.dataset.client);
      });
    });
    tr.addEventListener('click', () => {
      clientSearchSelect.setValue(r.client_id);
      renderClientTable([r]);
      renderClientKpis(r);
      clientBackBtn.classList.remove('hidden');
    });
    clientRevenueBody.appendChild(tr);
  });
}

AppCommon.ensureAuth(async () => {
  const user = AppCommon.getUser();
  
  // Block admin access to revenue - redirect to home
  if (user && user.role === 'admin') {
    window.location.href = '/index.html';
    return;
  }
  
  isAdmin = user && user.role === 'admin';

  const now = new Date();
  monthInput.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  if (isAdmin) {
    therapistFilterWrap.classList.remove('hidden');
    try {
      const therapists = await AppCommon.api('/ALTApi/users/therapists');
      therapists.forEach((t) => {
        const opt = document.createElement('option');
        opt.value = t.id;
        opt.textContent = t.full_name;
        therapistFilter.appendChild(opt);
      });
    } catch (_) { /* ignore */ }

    therapistFilter.addEventListener('change', async () => {
      try {
        await loadAll();
      } catch (err) {
        AppCommon.setMessage(err.message, true);
      }
    });
  }

  await loadAll();
});
