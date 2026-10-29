/* Revenue Control (therapists only).
   v2.13: year filter with permanent reminder, previous-year comparison, month-by-month
   chart with drill-down to a month, month arrows, and an Outstanding Payments panel
   grouped by patient with payment age, Call/WhatsApp and multi-select. */

const L = (key, vars) => AppCommon.t(key, vars);
const esc = (value) => AppCommon.escapeHtml(value);
const euro = (cents) => AppCommon.euroFromCents(Number(cents) || 0);
const locale = () => (AppCommon.getLanguage() === 'en' ? 'en-GB' : 'pt-PT');
const isNarrow = () => window.matchMedia('(max-width: 640px)').matches;

const monthInput = document.getElementById('monthInput');
const monthKpis = document.getElementById('monthKpis');
const totalKpis = document.getElementById('totalKpis');
const monthLabel = document.getElementById('month-label');
const futureLabel = document.getElementById('future-label');
const futureKpis = document.getElementById('futureKpis');

/* ── Dates ── */

function pad2(n) { return String(n).padStart(2, '0'); }
function localDateStr(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
const TODAY = new Date();
const TODAY_STR = localDateStr(TODAY);
const THIS_YEAR = TODAY.getFullYear();
const THIS_MONTH_INDEX = TODAY.getMonth();

function monthName(index, style = 'long') {
  return new Date(2000, index, 1).toLocaleString(locale(), { month: style });
}
function monthTitle(ym) {
  const [y, m] = ym.split('-').map(Number);
  const name = monthName(m - 1);
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${y}`;
}
function shiftMonth(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}
function lastDayOf(ym) {
  const [y, m] = ym.split('-').map(Number);
  return `${ym}-${pad2(new Date(y, m, 0).getDate())}`;
}
// Whole days since the appointment (0 = today)
function daysAgo(appointmentDate) {
  const d = new Date(appointmentDate);
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const today = new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate());
  return Math.max(0, Math.round((today - day) / 86400000));
}
// Payment age buckets: under 15 days, 15–30 days, over 30 days (30 is the limit)
function ageBand(days) { return days < 15 ? 1 : days <= 30 ? 2 : 3; }

/* ── Shared rendering ── */

function renderKpis(target, report, owedScope) {
  target.innerHTML = `
    <div class="rev-kpi">
      <span class="rev-kpi-label">Appointments</span>
      <span class="rev-kpi-val">${Number(report.totalAppointments) || 0}</span>
    </div>
    <div class="rev-kpi rev-kpi--ok">
      <span class="rev-kpi-label">Paid</span>
      <span class="rev-kpi-val">${Number(report.paidAppointments) || 0}</span>
    </div>
    <div class="rev-kpi rev-kpi--warn rev-kpi--clickable" data-action="show-owed">
      <span class="rev-kpi-label">Owed</span>
      <span class="rev-kpi-val">${Number(report.owedAppointments) || 0}</span>
    </div>
    <div class="rev-kpi">
      <span class="rev-kpi-label">Total Revenue</span>
      <span class="rev-kpi-val">${euro(report.totalCents)}</span>
    </div>
    <div class="rev-kpi rev-kpi--ok">
      <span class="rev-kpi-label">Paid Revenue</span>
      <span class="rev-kpi-val">${euro(report.paidCents)}</span>
    </div>
    <div class="rev-kpi rev-kpi--warn rev-kpi--clickable" data-action="show-owed">
      <span class="rev-kpi-label">Owed Revenue</span>
      <span class="rev-kpi-val">${euro(report.owedCents)}</span>
    </div>
  `;
  target.querySelectorAll('[data-action="show-owed"]').forEach((el) => {
    el.addEventListener('click', () => openOwedDrawer(owedScope || {}));
  });
}

// One change figure. For "Owed", going down is the good direction.
function changeHtml(cur, prev, lowerIsBetter) {
  if (prev === null || prev === undefined) return `<span class="rev-nodata">${esc(L('rev_no_data'))}</span>`;
  const d = cur - prev;
  if (d === 0) return `<span class="rev-flat">= ${esc(L('rev_no_change'))}</span>`;
  const good = lowerIsBetter ? d < 0 : d > 0;
  const pct = prev ? ` (${d > 0 ? '+' : '−'}${Math.abs(Math.round((d / prev) * 100))}%)` : '';
  return `<span class="${good ? 'rev-up' : 'rev-down'}">${d > 0 ? '▲' : '▼'} ${euro(Math.abs(d))}${pct}</span>`;
}

// Compares Total, Received and Owed with another period ({ total, paid, owed } in cents)
function compareRowHtml(cur, prev, label) {
  return `<div class="rev-cmp-row">
    <span class="rev-cmp-lbl">${esc(L('rev_vs', { label }))}</span>
    <span class="rev-cmp-cell"><span class="rev-cmp-k">${esc(L('rev_total'))}</span>${changeHtml(cur.total, prev && prev.total)}</span>
    <span class="rev-cmp-cell"><span class="rev-cmp-k">${esc(L('rev_received'))}</span>${changeHtml(cur.paid, prev && prev.paid)}</span>
    <span class="rev-cmp-cell"><span class="rev-cmp-k">${esc(L('rev_owed'))}</span>${changeHtml(cur.owed, prev && prev.owed, true)}</span>
  </div>`;
}

function figuresFromReport(r) {
  return { total: Number(r.totalCents) || 0, paid: Number(r.paidCents) || 0, owed: Number(r.owedCents) || 0 };
}

/* ── Year filter, totals and comparison ── */

let years = [];
let selectedYear = THIS_YEAR;
const seriesCache = new Map();

const yearChips = document.getElementById('yearChips');
const yearNote = document.getElementById('yearNote');
const totalTitle = document.getElementById('totalTitle');
const yearCompare = document.getElementById('yearCompare');
const chartBlock = document.getElementById('chartBlock');

async function getSeries(year) {
  if (!seriesCache.has(year)) {
    seriesCache.set(year, await AppCommon.api(`/ALTApi/reports/monthly-series?year=${year}`));
  }
  return seriesCache.get(year);
}

function renderYearChips() {
  const chips = [{ value: 'all', label: L('rev_year_all') }, ...years.map((y) => ({ value: y, label: String(y) }))];
  yearChips.innerHTML = chips
    .map((c) => `<button type="button" class="rev-chip${c.value === selectedYear ? ' active' : ''}" data-year="${c.value}" aria-pressed="${c.value === selectedYear}">${esc(c.label)}</button>`)
    .join('');
  yearChips.querySelectorAll('.rev-chip').forEach((btn) => {
    btn.addEventListener('click', async () => {
      selectedYear = btn.dataset.year === 'all' ? 'all' : Number(btn.dataset.year);
      tappedMonth = null;
      renderYearChips();
      try {
        await loadTotal();
      } catch (err) {
        AppCommon.setMessage(err.message, true);
      }
    });
  });
}

async function loadTotal() {
  if (selectedYear === 'all') {
    totalTitle.textContent = L('rev_total_title_all');
    yearNote.textContent = `ℹ️ ${L('rev_note_all')}`;
    const report = await AppCommon.api('/ALTApi/reports/total');
    renderKpis(totalKpis, report, {});
    yearCompare.innerHTML = '';
    chartBlock.classList.add('hidden');
    return;
  }

  const year = selectedYear;
  totalTitle.textContent = L('rev_total_title_year', { year });
  yearNote.textContent = `ℹ️ ${L('rev_note_year', { year })}`;
  const hasPrev = years.includes(year - 1);
  const [report, series, prevSeries] = await Promise.all([
    AppCommon.api(`/ALTApi/reports/yearly?year=${year}`),
    getSeries(year),
    hasPrev ? getSeries(year - 1) : Promise.resolve(null),
  ]);
  renderKpis(totalKpis, report, { year });

  // Previous year, same months only, so a part-year never looks like a drop
  if (prevSeries) {
    const upto = year === THIS_YEAR ? THIS_MONTH_INDEX : 11;
    const sum = (s) => s.months.slice(0, upto + 1).reduce((acc, m) => ({
      total: acc.total + m.paidCents + m.owedCents + m.scheduledCents,
      paid: acc.paid + m.paidCents,
      owed: acc.owed + m.owedCents,
    }), { total: 0, paid: 0, owed: 0 });
    const label = upto === 11 ? String(year - 1) : L('rev_same_months', { year: year - 1, month: monthName(upto, 'short') });
    yearCompare.innerHTML = compareRowHtml(sum(series), sum(prevSeries), label);
  } else {
    yearCompare.innerHTML = `<div class="rev-nodata">${esc(L('rev_no_prev_year', { year: year - 1 }))}</div>`;
  }

  chartBlock.classList.remove('hidden');
  renderChart(series, prevSeries);
}

/* ── Month-by-month chart ── */

const chartSvg = document.getElementById('revChart');
const chartTip = document.getElementById('revTip');
const tapInfo = document.getElementById('tapInfo');
const chartLegend = document.getElementById('chartLegend');
const chartTable = document.getElementById('chartTable');
const chartTableToggle = document.getElementById('chartTableToggle');
let tappedMonth = null;
let chartData = null;

function niceStep(raw) {
  if (raw <= 0) return 1000;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

function axisLabel(cents) {
  const eurosValue = cents / 100;
  if (eurosValue >= 1000) return `€${(eurosValue / 1000).toFixed(eurosValue % 1000 ? 1 : 0)}k`;
  return `€${Math.round(eurosValue)}`;
}

function monthTotal(m) { return m.paidCents + m.owedCents + m.scheduledCents; }

function renderChart(series, prevSeries) {
  chartData = { series, prevSeries };
  const year = series.year;
  const rows = series.months;
  const prev = prevSeries ? prevSeries.months : null;

  chartLegend.innerHTML = `
    <span><i class="rev-sw rev-sw--paid"></i>${esc(L('rev_paid'))}</span>
    <span><i class="rev-sw rev-sw--owed"></i>${esc(L('rev_owed'))}</span>
    <span><i class="rev-sw rev-sw--sched"></i>${esc(L('rev_scheduled'))}</span>
    ${prev ? `<span><i class="rev-sw rev-sw--prev"></i>${esc(L('rev_prev_same_month', { year: year - 1 }))}</span>` : ''}`;

  const W = chartSvg.clientWidth || 700;
  const H = chartSvg.clientHeight || 240;
  const padL = 46, padR = 6, padT = 10, padB = 24;
  const iw = W - padL - padR, ih = H - padT - padB;
  const maxV = Math.max(1, ...rows.map(monthTotal), ...(prev ? prev.map(monthTotal) : []));
  const step = niceStep(maxV / 4);
  const top = Math.ceil(maxV / step) * step;
  const y = (v) => padT + ih - (v / top) * ih;
  const bw = iw / 12;
  const barW = Math.max(8, Math.min(34, bw * 0.62));
  const selected = currentMonth && currentMonth.startsWith(`${year}-`) ? Number(currentMonth.slice(5)) - 1 : -1;
  const narrow = isNarrow();

  let svg = `<defs><pattern id="revHatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width="6" height="6" style="fill:var(--surface)"/><rect width="3" height="6" style="fill:var(--accent);fill-opacity:.55"/></pattern></defs>`;
  for (let v = 0; v <= top; v += step) {
    svg += `<line x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}" style="stroke:var(--border)" ${v ? 'stroke-dasharray="3 3"' : ''}/>
      <text x="${padL - 6}" y="${y(v) + 4}" text-anchor="end" font-size="10" style="fill:var(--muted)">${axisLabel(v)}</text>`;
  }
  rows.forEach((m, i) => {
    const cx = padL + bw * i + bw / 2;
    const x = cx - barW / 2;
    const yPaid = y(m.paidCents), yOwed = y(m.paidCents + m.owedCents), ySched = y(monthTotal(m));
    const label = narrow ? monthName(i, 'narrow') : monthName(i, 'short').replace('.', '');
    svg += `<g class="rev-bar${i === selected ? ' selected' : ''}" data-m="${i}" tabindex="0" role="button" aria-label="${esc(monthTitle(`${year}-${pad2(i + 1)}`))}">
      <rect class="rev-hit" x="${padL + bw * i}" y="${padT}" width="${bw}" height="${ih}" rx="4"/>
      ${m.paidCents ? `<rect x="${x}" y="${yPaid}" width="${barW}" height="${y(0) - yPaid}" rx="2" style="fill:var(--ok)"/>` : ''}
      ${m.owedCents ? `<rect x="${x}" y="${yOwed}" width="${barW}" height="${yPaid - yOwed}" style="fill:var(--warn)"/>` : ''}
      ${m.scheduledCents ? `<rect x="${x}" y="${ySched}" width="${barW}" height="${yOwed - ySched}" style="fill:url(#revHatch);stroke:var(--accent);stroke-opacity:.6"/>` : ''}
      <text class="rev-lbl" x="${cx}" y="${H - 6}" text-anchor="middle" font-size="10.5" style="fill:var(--muted)">${esc(label)}</text>`;
    if (prev) {
      const pv = monthTotal(prev[i]);
      svg += `<line x1="${x - 3}" x2="${x + barW + 3}" y1="${y(pv)}" y2="${y(pv)}" stroke-width="2.5" stroke-linecap="round" style="stroke:var(--text)"/>`;
    }
    svg += '</g>';
  });
  chartSvg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  chartSvg.innerHTML = svg;

  chartSvg.querySelectorAll('.rev-bar').forEach((g) => {
    const i = Number(g.dataset.m);
    g.addEventListener('mousemove', (e) => { if (!isNarrow()) showTip(i, e); });
    g.addEventListener('mouseleave', () => chartTip.classList.add('hidden'));
    g.addEventListener('click', () => {
      if (isNarrow() && tappedMonth !== i) {
        tappedMonth = i;
        tapInfo.innerHTML = `${tipHtml(i)}<div style="margin-top:6px"><button type="button" class="action-save" id="openTappedMonth" style="width:auto;margin:0">${esc(L('rev_open_month', { month: monthName(i) }))}</button></div>`;
        document.getElementById('openTappedMonth').addEventListener('click', () => drillToMonth(i));
        return;
      }
      drillToMonth(i);
    });
    g.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); drillToMonth(i); }
    });
  });

  if (tappedMonth === null) tapInfo.textContent = L('rev_tap_hint');
  document.getElementById('chartHint').textContent = L('rev_chart_hint');
  renderChartTable();
}

function tipHtml(i) {
  const { series, prevSeries } = chartData;
  const m = series.months[i];
  const future = series.year > THIS_YEAR || (series.year === THIS_YEAR && i > THIS_MONTH_INDEX);
  let html = `<b>${esc(monthTitle(m.month))}</b><br>${esc(L('rev_appointments_n', { n: m.appointments }))}<br>`;
  html += future
    ? `${esc(L('rev_scheduled'))}: ${euro(m.scheduledCents)}${m.paidCents ? `<br>${esc(L('rev_prepaid'))}: ${euro(m.paidCents)}` : ''}`
    : `${esc(L('rev_paid'))}: ${euro(m.paidCents)}<br>${esc(L('rev_owed'))}: ${euro(m.owedCents)}${m.scheduledCents ? `<br>${esc(L('rev_scheduled'))}: ${euro(m.scheduledCents)}` : ''}`;
  if (prevSeries) html += `<br>${series.year - 1}: ${euro(monthTotal(prevSeries.months[i]))}`;
  return html;
}

function showTip(i, e) {
  const wrap = chartSvg.parentElement.getBoundingClientRect();
  chartTip.innerHTML = `${tipHtml(i)}<br><span style="opacity:.75">${esc(L('rev_click_to_open'))}</span>`;
  chartTip.style.left = `${Math.min(Math.max(e.clientX - wrap.left, 90), wrap.width - 90)}px`;
  chartTip.style.top = `${e.clientY - wrap.top - 12}px`;
  chartTip.classList.remove('hidden');
}

function renderChartTable() {
  const { series, prevSeries } = chartData;
  const head = `<tr><th>${esc(L('rev_month'))}</th><th class="rev-num">Appts</th><th class="rev-num">${esc(L('rev_paid'))}</th>
    <th class="rev-num">${esc(L('rev_owed'))}</th><th class="rev-num">${esc(L('rev_scheduled'))}</th>
    ${prevSeries ? `<th class="rev-num">${series.year - 1}</th>` : ''}</tr>`;
  const body = series.months.map((m, i) => `<tr><td>${esc(monthTitle(m.month))}</td><td class="rev-num">${m.appointments}</td>
    <td class="rev-num">${euro(m.paidCents)}</td><td class="rev-num">${euro(m.owedCents)}</td><td class="rev-num">${euro(m.scheduledCents)}</td>
    ${prevSeries ? `<td class="rev-num">${euro(monthTotal(prevSeries.months[i]))}</td>` : ''}</tr>`).join('');
  chartTable.innerHTML = `<table class="appt-table"><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

chartTableToggle.addEventListener('click', () => {
  const show = chartTable.classList.contains('hidden');
  chartTable.classList.toggle('hidden', !show);
  chartTableToggle.textContent = show ? L('rev_hide_table') : L('rev_show_table');
});

window.addEventListener('resize', () => {
  if (chartData && !chartBlock.classList.contains('hidden')) renderChart(chartData.series, chartData.prevSeries);
});

/* ── Month view: arrows, drill-down from the chart, comparison ── */

let currentMonth = `${THIS_YEAR}-${pad2(THIS_MONTH_INDEX + 1)}`;
let cameFromChart = false;
const monthCard = document.getElementById('monthCard');
const monthCrumb = document.getElementById('monthCrumb');
const monthCrumbBack = document.getElementById('monthCrumbBack');
const monthCompare = document.getElementById('monthCompare');

function drillToMonth(i) {
  if (!chartData) return;
  currentMonth = `${chartData.series.year}-${pad2(i + 1)}`;
  cameFromChart = true;
  tappedMonth = null;
  chartTip.classList.add('hidden');
  loadMonth()
    .then(() => {
      renderChart(chartData.series, chartData.prevSeries);
      monthCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
      monthCard.classList.remove('rev-flash');
      void monthCard.offsetWidth;
      monthCard.classList.add('rev-flash');
    })
    .catch((err) => AppCommon.setMessage(err.message, true));
}

async function loadMonth() {
  const month = currentMonth;
  monthInput.value = month;
  monthLabel.textContent = monthTitle(month);
  monthCrumb.classList.toggle('hidden', !cameFromChart);
  monthCrumbBack.textContent = L('rev_back_overview', { year: month.slice(0, 4) });

  const prevMonth = shiftMonth(month, -1);
  const lastYear = shiftMonth(month, -12);
  const [report, prevReport, lastYearReport] = await Promise.all([
    AppCommon.api(`/ALTApi/reports/monthly?month=${month}`),
    AppCommon.api(`/ALTApi/reports/monthly?month=${prevMonth}`).catch(() => null),
    AppCommon.api(`/ALTApi/reports/monthly?month=${lastYear}`).catch(() => null),
  ]);
  if (month !== currentMonth) return; // a newer month was chosen meanwhile
  renderKpis(monthKpis, report, { month });

  const hasData = (r) => r && Number(r.totalAppointments) > 0;
  const cur = figuresFromReport(report);
  const future = month > TODAY_STR.slice(0, 7);
  monthCompare.innerHTML =
    (future ? `<div class="rev-nodata">${esc(L('rev_upcoming_month'))}</div>` : '') +
    compareRowHtml(cur, hasData(prevReport) ? figuresFromReport(prevReport) : null, monthTitle(prevMonth)) +
    compareRowHtml(cur, hasData(lastYearReport) ? figuresFromReport(lastYearReport) : null, monthTitle(lastYear));
}

async function changeMonth(month) {
  currentMonth = month;
  cameFromChart = false;
  try {
    await loadMonth();
    if (chartData) renderChart(chartData.series, chartData.prevSeries);
  } catch (err) {
    AppCommon.setMessage(err.message, true);
  }
}

document.getElementById('prevMonth').addEventListener('click', () => changeMonth(shiftMonth(currentMonth, -1)));
document.getElementById('nextMonth').addEventListener('click', () => changeMonth(shiftMonth(currentMonth, 1)));
monthInput.addEventListener('change', () => { if (monthInput.value) changeMonth(monthInput.value); });
monthCrumbBack.addEventListener('click', () => {
  document.getElementById('totalCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

/* ── Future revenue (unchanged) ── */

function renderFutureKpis(report) {
  futureKpis.innerHTML = `
    <div class="rev-kpi">
      <span class="rev-kpi-label">Appointments</span>
      <span class="rev-kpi-val">${Number(report.totalAppointments) || 0}</span>
    </div>
    <div class="rev-kpi rev-kpi--ok">
      <span class="rev-kpi-label">Pre-paid</span>
      <span class="rev-kpi-val">${Number(report.paidAppointments) || 0}</span>
    </div>
    <div class="rev-kpi">
      <span class="rev-kpi-label">Pending</span>
      <span class="rev-kpi-val">${Number(report.unpaidAppointments) || 0}</span>
    </div>
    <div class="rev-kpi">
      <span class="rev-kpi-label">Expected Revenue</span>
      <span class="rev-kpi-val">${euro(report.totalCents)}</span>
    </div>
    <div class="rev-kpi rev-kpi--ok">
      <span class="rev-kpi-label">Pre-paid Revenue</span>
      <span class="rev-kpi-val">${euro(report.paidCents)}</span>
    </div>
    <div class="rev-kpi">
      <span class="rev-kpi-label">Pending Revenue</span>
      <span class="rev-kpi-val">${euro(report.unpaidCents)}</span>
    </div>
  `;
}

async function loadFuture() {
  const report = await AppCommon.api('/ALTApi/reports/future');
  renderFutureKpis(report);
  futureLabel.textContent = `Future Revenue (${Number(report.totalAppointments) || 0})`;
}

/* ── Outstanding Payments panel ── */

const owedOverlay = document.getElementById('owed-overlay');
const owedDrawer = document.getElementById('owed-drawer');
const owedLabel = document.getElementById('owed-label');
const owedSearch = document.getElementById('owedSearch');
const owedList = document.getElementById('owedList');
const owedEmpty = document.getElementById('owedEmpty');
const owedAging = document.getElementById('owedAging');
const owedFilterNote = document.getElementById('owedFilterNote');
const owedSelBar = document.getElementById('owedSelBar');
const owedSelInfo = document.getElementById('owedSelInfo');
const owedConfirm = document.getElementById('owedConfirm');

let allOutstanding = []; // every unpaid appointment up to today (for the client table)
let owedRows = []; // unpaid appointments in the panel's scope
let owedScope = {}; // { year } | { month } | { clientId, clientName } | {}
let owedView = 'patient';
let owedAgeFilter = null;
const owedSelected = new Set();
const owedExpanded = new Set();

function owedUrl(scope) {
  let from = null;
  let to = TODAY_STR; // owed = unpaid and already happened
  if (scope.month) {
    from = `${scope.month}-01`;
    to = lastDayOf(scope.month) < TODAY_STR ? lastDayOf(scope.month) : TODAY_STR;
  } else if (scope.year) {
    from = `${scope.year}-01-01`;
    to = `${scope.year}-12-31` < TODAY_STR ? `${scope.year}-12-31` : TODAY_STR;
  }
  return `/ALTApi/appointments?wireReceived=0${from ? `&from=${from}` : ''}&to=${to}`;
}

async function loadOutstanding() {
  allOutstanding = (await AppCommon.api(owedUrl({}))).map((a) => ({ ...a, days: daysAgo(a.appointment_date) }));
}

async function loadOwed() {
  const rows = owedScope.month || owedScope.year ? await AppCommon.api(owedUrl(owedScope)) : allOutstanding;
  owedRows = rows
    .map((a) => ({ ...a, days: daysAgo(a.appointment_date) }))
    .filter((a) => !owedScope.clientId || a.client_id === owedScope.clientId);
  const ids = new Set(owedRows.map((a) => a.id));
  [...owedSelected].forEach((id) => { if (!ids.has(id)) owedSelected.delete(id); });
}

function visibleOwedRows() {
  const term = owedSearch.value.trim().toLowerCase();
  return owedRows.filter((a) => {
    if (owedAgeFilter && ageBand(a.days) !== owedAgeFilter) return false;
    if (!term) return true;
    const date = new Date(a.appointment_date).toLocaleDateString(locale());
    return a.full_name.toLowerCase().includes(term) || date.includes(term)
      || (a.comments || '').toLowerCase().includes(term) || (a.notes || '').toLowerCase().includes(term);
  });
}

function phoneLinks(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return null;
  const international = digits.length === 9 ? `351${digits}` : digits; // Portuguese numbers get +351
  return { tel: `tel:+${international}`, wa: `https://wa.me/${international}` };
}

function renderOwed() {
  const total = owedRows.reduce((s, a) => s + Number(a.fee_cents), 0);
  owedLabel.textContent = L('rev_outstanding_title', { n: owedRows.length, total: euro(total) });

  owedAging.innerHTML = [1, 2, 3].map((band) => {
    const inBand = owedRows.filter((a) => ageBand(a.days) === band);
    return `<button type="button" class="rev-age rev-age--${band}${owedAgeFilter === band ? ' active' : ''}" data-band="${band}" aria-pressed="${owedAgeFilter === band}">
      <b>${euro(inBand.reduce((s, a) => s + Number(a.fee_cents), 0))}</b><span>${esc(L(`rev_age_${band}`))} · ${inBand.length}</span></button>`;
  }).join('');
  owedAging.querySelectorAll('.rev-age').forEach((btn) => {
    btn.addEventListener('click', () => {
      const band = Number(btn.dataset.band);
      owedAgeFilter = owedAgeFilter === band ? null : band;
      renderOwed();
    });
  });

  const notes = [];
  if (owedScope.clientName) notes.push(esc(owedScope.clientName));
  if (owedScope.month) notes.push(esc(monthTitle(owedScope.month)));
  else if (owedScope.year) notes.push(String(owedScope.year));
  if (owedAgeFilter) notes.push(`${esc(L('rev_showing', { label: L(`rev_age_${owedAgeFilter}`) }))} · <button type="button" class="rev-link-btn" id="owedClearAge">${esc(L('rev_clear'))}</button>`);
  owedFilterNote.innerHTML = notes.join(' · ');
  const clearAge = document.getElementById('owedClearAge');
  if (clearAge) clearAge.addEventListener('click', () => { owedAgeFilter = null; renderOwed(); });

  const rows = visibleOwedRows();
  owedEmpty.classList.toggle('hidden', rows.length > 0);
  owedEmpty.textContent = L('rev_nothing_outstanding');
  if (owedView === 'appt') renderOwedByAppointment(rows); else renderOwedByPatient(rows);
  renderOwedSelection();
}

function checkbox(a) {
  return `<input type="checkbox" class="owed-sel" data-id="${a.id}" ${owedSelected.has(a.id) ? 'checked' : ''}
    aria-label="${esc(`${a.full_name} ${new Date(a.appointment_date).toLocaleDateString(locale())}`)}">`;
}

function renderOwedByAppointment(rows) {
  const sorted = rows.slice().sort((a, b) => b.days - a.days);
  const allOn = sorted.length > 0 && sorted.every((a) => owedSelected.has(a.id));
  owedList.innerHTML = sorted.length ? `<div style="overflow-x:auto"><table class="appt-table"><thead><tr>
      <th style="width:28px"><input type="checkbox" id="owedSelAll" ${allOn ? 'checked' : ''} aria-label="${esc(L('rev_select_all_shown'))}"></th>
      <th>${esc(L('rev_patient'))}</th><th>${esc(L('rev_date'))}</th><th>${esc(L('rev_age'))}</th><th class="rev-num">${esc(L('rev_fee'))}</th><th>${esc(L('rev_notes'))}</th>
    </tr></thead><tbody>${sorted.map((a) => `<tr class="${owedSelected.has(a.id) ? 'selected' : ''}">
      <td>${checkbox(a)}</td><td>${esc(a.full_name)}</td><td>${new Date(a.appointment_date).toLocaleDateString(locale())}</td>
      <td><span class="rev-badge rev-badge--${ageBand(a.days)}">${a.days}d</span></td><td class="rev-num">${euro(a.fee_cents)}</td>
      <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(a.comments || a.notes || '')}</td></tr>`).join('')}
    </tbody></table></div>` : '';
  const selAll = document.getElementById('owedSelAll');
  if (selAll) {
    selAll.addEventListener('change', () => {
      sorted.forEach((a) => (selAll.checked ? owedSelected.add(a.id) : owedSelected.delete(a.id)));
      renderOwed();
    });
  }
  bindOwedCheckboxes();
}

function renderOwedByPatient(rows) {
  const groups = new Map();
  rows.forEach((a) => {
    if (!groups.has(a.client_id)) groups.set(a.client_id, { id: a.client_id, name: a.full_name, phone: a.client_phone, list: [] });
    groups.get(a.client_id).list.push(a);
  });
  const sorted = [...groups.values()]
    .map((g) => ({ ...g, list: g.list.sort((x, y) => y.days - x.days), total: g.list.reduce((s, a) => s + Number(a.fee_cents), 0), oldest: Math.max(...g.list.map((a) => a.days)) }))
    .sort((x, y) => y.oldest - x.oldest);
  if (!owedExpanded.size && sorted.length) owedExpanded.add(sorted[0].id);

  owedList.innerHTML = sorted.map((g) => {
    const links = phoneLinks(g.phone);
    const allOn = g.list.every((a) => owedSelected.has(a.id));
    const someOn = g.list.some((a) => owedSelected.has(a.id));
    const badge = `<span class="rev-badge rev-badge--${ageBand(g.oldest)}">${esc(L('rev_oldest_days', { d: g.oldest }))}</span>`;
    return `<div class="rev-pt${owedExpanded.has(g.id) ? ' expanded' : ''}" data-client="${g.id}">
      <div class="rev-pt-head" role="button" tabindex="0" aria-expanded="${owedExpanded.has(g.id)}">
        <div>
          <div class="rev-pt-name"><span class="rev-caret">▸</span> ${esc(g.name)}</div>
          <div class="rev-pt-sub">${links ? `☎ ${esc(g.phone)}` : esc(L('rev_no_phone'))}</div>
          <div class="rev-pt-meta-mobile rev-pt-sub">${esc(L('rev_unpaid_n', { n: g.list.length }))} · ${badge}</div>
        </div>
        <div class="rev-pt-count rev-pt-sub">${esc(L('rev_unpaid_n', { n: g.list.length }))}</div>
        <div class="rev-pt-age">${badge}</div>
        <div class="rev-pt-owed">${euro(g.total)}</div>
      </div>
      <div class="rev-pt-body">
        ${g.list.length > 1 ? `<label class="rev-pt-all"><input type="checkbox" class="owed-grp" data-client="${g.id}" ${allOn ? 'checked' : ''} ${!allOn && someOn ? 'data-mixed="1"' : ''}> ${esc(L('rev_select_all_for', { n: g.list.length, name: g.name.split(' ')[0] }))}</label>` : ''}
        ${g.list.map((a) => `<label class="rev-appt-line${owedSelected.has(a.id) ? ' selected' : ''}">${checkbox(a)}
          <span>${new Date(a.appointment_date).toLocaleDateString(locale())}${a.comments || a.notes ? ` <span class="rev-pt-sub">· ${esc(a.comments || a.notes)}</span>` : ''}</span>
          <span class="rev-badge rev-badge--${ageBand(a.days)}">${a.days}d</span><span class="rev-num">${euro(a.fee_cents)}</span></label>`).join('')}
        ${links ? `<div class="rev-contact">
          <a class="rev-call" href="${links.tel}">☎ ${esc(L('rev_call'))}</a>
          <a class="rev-wa" href="${links.wa}" target="_blank" rel="noopener noreferrer">💬 ${esc(L('rev_whatsapp'))}</a></div>` : ''}
      </div></div>`;
  }).join('');

  owedList.querySelectorAll('.rev-pt-head').forEach((head) => {
    const toggle = () => {
      const id = Number(head.parentElement.dataset.client);
      if (owedExpanded.has(id)) owedExpanded.delete(id); else owedExpanded.add(id);
      renderOwed();
    };
    head.addEventListener('click', toggle);
    head.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
  });
  owedList.querySelectorAll('[data-mixed]').forEach((c) => { c.indeterminate = true; });
  owedList.querySelectorAll('.owed-grp').forEach((c) => {
    c.addEventListener('change', () => {
      const clientId = Number(c.dataset.client);
      rows.filter((a) => a.client_id === clientId).forEach((a) => (c.checked ? owedSelected.add(a.id) : owedSelected.delete(a.id)));
      renderOwed();
    });
  });
  bindOwedCheckboxes();
}

function bindOwedCheckboxes() {
  owedList.querySelectorAll('.owed-sel').forEach((c) => {
    c.addEventListener('change', () => {
      const id = Number(c.dataset.id);
      if (c.checked) owedSelected.add(id); else owedSelected.delete(id);
      renderOwed();
    });
  });
}

function selectedOwed() { return owedRows.filter((a) => owedSelected.has(a.id)); }

function renderOwedSelection() {
  const sel = selectedOwed();
  owedSelBar.classList.toggle('hidden', !sel.length || !owedConfirm.classList.contains('hidden'));
  if (!sel.length) return;
  const people = new Set(sel.map((a) => a.client_id)).size;
  owedSelInfo.innerHTML = `<b>${esc(L('rev_selected_n', { n: sel.length }))}</b> · ${euro(sel.reduce((s, a) => s + Number(a.fee_cents), 0))}${people > 1 ? ` · ${esc(L('rev_patients_n', { n: people }))}` : ''}`;
}

document.getElementById('owedSelClear').addEventListener('click', () => { owedSelected.clear(); renderOwed(); });

document.getElementById('owedSelMark').addEventListener('click', () => {
  const sel = selectedOwed();
  if (!sel.length) return;
  const total = euro(sel.reduce((s, a) => s + Number(a.fee_cents), 0));
  const names = [...new Set(sel.map((a) => a.full_name))];
  document.getElementById('owedConfirmText').innerHTML =
    `${esc(sel.length === 1 ? L('rev_confirm_one', { total }) : L('rev_confirm_many', { n: sel.length, total }))}<br><span class="rev-pt-sub">${esc(names.join(', '))}</span>`;
  owedConfirm.classList.remove('hidden');
  owedSelBar.classList.add('hidden');
  document.getElementById('owedConfirmYes').focus();
});

document.getElementById('owedConfirmNo').addEventListener('click', () => {
  owedConfirm.classList.add('hidden');
  renderOwedSelection();
});

document.getElementById('owedConfirmYes').addEventListener('click', async () => {
  const ids = selectedOwed().map((a) => a.id);
  owedConfirm.classList.add('hidden');
  try {
    await AppCommon.api('/ALTApi/appointments/payment-received', { method: 'PATCH', body: JSON.stringify({ ids }) });
    owedSelected.clear();
    AppCommon.setMessage(ids.length === 1 ? L('rev_marked_one') : L('rev_marked_many', { n: ids.length }));
    await refreshAfterPayment();
  } catch (err) {
    AppCommon.setMessage(err.message, true);
    renderOwedSelection();
  }
});

document.querySelectorAll('[data-owed-view]').forEach((btn) => {
  btn.addEventListener('click', () => {
    owedView = btn.dataset.owedView;
    document.querySelectorAll('[data-owed-view]').forEach((b) => b.classList.toggle('active', b === btn));
    renderOwed();
  });
});
owedSearch.addEventListener('input', renderOwed);

async function openOwedDrawer(scope) {
  owedScope = scope || {};
  owedAgeFilter = null;
  owedSelected.clear();
  owedExpanded.clear();
  owedSearch.value = '';
  owedConfirm.classList.add('hidden');
  try {
    await loadOwed();
  } catch (err) {
    AppCommon.setMessage(err.message, true);
    return;
  }
  renderOwed();
  owedOverlay.classList.remove('hidden');
  owedDrawer.classList.remove('hidden');
  requestAnimationFrame(() => {
    owedOverlay.classList.add('open');
    owedDrawer.classList.add('open');
    owedDrawer.setAttribute('aria-hidden', 'false');
  });
}

function closeOwedDrawer() {
  owedOverlay.classList.remove('open');
  owedDrawer.classList.remove('open');
  owedDrawer.setAttribute('aria-hidden', 'true');
  setTimeout(() => {
    owedOverlay.classList.add('hidden');
    owedDrawer.classList.add('hidden');
  }, 220);
}

document.getElementById('close-owed').addEventListener('click', closeOwedDrawer);
owedOverlay.addEventListener('click', closeOwedDrawer);

/* ── Export Outstanding Payments (what the panel currently shows) ── */
document.getElementById('exportOwedBtn').addEventListener('click', () => {
  const rows = visibleOwedRows();
  const headers = ['Patient', 'Date', 'Days', 'Fee (€)', 'Notes'];
  const data = rows.map((a) => [
    a.full_name,
    new Date(a.appointment_date).toLocaleDateString('en-GB'),
    a.days,
    (Number(a.fee_cents) / 100).toFixed(2),
    a.comments || a.notes || '',
  ]);
  const prefix = owedScope.clientName ? owedScope.clientName.replace(/\s+/g, '-') : 'all';
  const title = owedScope.clientName ? `Outstanding Payments — ${owedScope.clientName}` : 'Outstanding Payments — All Clients';
  AppCommon.exportToXls(`outstanding-payments-${prefix}.xls`, headers, data, title);
});

/* ── Refresh after any payment ── */

async function refreshAfterPayment() {
  seriesCache.clear();
  await loadOutstanding();
  await Promise.all([loadTotal(), loadMonth(), loadFuture(), loadClientRevenue()]);
  if (!owedDrawer.classList.contains('hidden')) {
    await loadOwed();
    renderOwed();
  }
  if (currentDrilldownClient) {
    const updatedClient = allClientRevenue.find((r) => r.client_id === currentDrilldownClient.client_id);
    if (updatedClient) {
      currentDrilldownClient = updatedClient;
      renderClientTable([updatedClient]);
      renderClientKpis(updatedClient);
      allDrilldownRows = await AppCommon.api(`/ALTApi/appointments?clientId=${currentDrilldownClient.client_id}`);
      renderDrilldownTable();
    }
  }
}

/* ── Revenue by Client ── */
const clientRevenueSelect = document.getElementById('clientRevenueSelect');
const clientRevenueKpis = document.getElementById('clientRevenueKpis');
const clientRevenueBody = document.getElementById('client-revenue-body');
const clientBackBtn = document.getElementById('clientBackBtn');
const clientDrilldown = document.getElementById('client-drilldown');
const clientDrilldownTitle = document.getElementById('client-drilldown-title');
const clientDrilldownBody = document.getElementById('client-drilldown-body');
const clientMonthFilter = document.getElementById('clientMonthFilter');
const clientStatusFilter = document.getElementById('clientStatusFilter');
const clientFilterClear = document.getElementById('clientFilterClear');
const clientRevenueHead = document.getElementById('client-revenue-head');

let allClientRevenue = [];
let allDrilldownRows = [];
let currentDrilldownClient = null;
let clientSearchSelect = null;
let clientSort = { key: 'owed_cents', dir: -1 };

function hideClientDrilldown() {
  clientDrilldown.classList.add('hidden');
  clientDrilldownTitle.textContent = 'Appointments';
  clientDrilldownBody.innerHTML = '';
}

async function loadClientDrilldown(clientRow) {
  if (!clientRow) {
    hideClientDrilldown();
    return;
  }

  currentDrilldownClient = clientRow;
  clientMonthFilter.value = '';
  clientStatusFilter.value = '';
  clientDrilldown.classList.remove('hidden');
  clientDrilldownBody.innerHTML = '<tr><td colspan="6" style="color:var(--muted)">Loading...</td></tr>';

  try {
    allDrilldownRows = await AppCommon.api(`/ALTApi/appointments?clientId=${clientRow.client_id}`);
    renderDrilldownTable();
  } catch (err) {
    clientDrilldownBody.innerHTML = `<tr><td colspan="6" style="color:var(--danger)">${esc(err.message)}</td></tr>`;
  }
}

function getFilteredDrilldownRows() {
  let rows = allDrilldownRows;
  if (clientMonthFilter.value) {
    const [fy, fm] = clientMonthFilter.value.split('-').map(Number);
    rows = rows.filter((a) => {
      const d = new Date(a.appointment_date);
      return d.getFullYear() === fy && d.getMonth() + 1 === fm;
    });
  }
  if (clientStatusFilter.value === 'paid') rows = rows.filter((a) => a.wire_received);
  else if (clientStatusFilter.value === 'owed') rows = rows.filter((a) => !a.wire_received);
  return rows;
}

function renderDrilldownTable() {
  const rows = getFilteredDrilldownRows();
  const name = currentDrilldownClient ? currentDrilldownClient.full_name : 'Appointments';
  clientDrilldownTitle.textContent = `Appointments — ${name} (${rows.length})`;
  clientDrilldownBody.innerHTML = '';

  if (!rows.length) {
    clientDrilldownBody.innerHTML = '<tr><td colspan="6" style="color:var(--muted)">No appointments match the filter.</td></tr>';
    return;
  }

  rows.forEach((a) => {
    const tr = document.createElement('tr');
    const status = a.wire_received ? '<span class="status-paid">PAID</span>' : '<span class="status-owed">OWED</span>';
    tr.innerHTML = `
      <td>${new Date(a.appointment_date).toLocaleString('en-GB')}</td>
      <td>${status}</td>
      <td>${euro(a.fee_cents)}</td>
      <td>${esc(a.payment_type || '-')}</td>
      <td>${esc(a.comments || a.notes || '-')}</td>
      <td></td>
    `;

    if (!a.wire_received) {
      const actionTd = tr.lastElementChild;
      const payBtn = document.createElement('button');
      payBtn.type = 'button';
      payBtn.className = 'outline tiny-btn';
      payBtn.textContent = '✓ Paid';
      payBtn.style.color = 'var(--ok)';
      payBtn.style.borderColor = 'var(--ok)';
      payBtn.addEventListener('click', async () => {
        const ok = await AppCommon.confirmPayment({
          name: currentDrilldownClient.full_name,
          date: new Date(a.appointment_date).toLocaleDateString('en-GB'),
          fee: euro(a.fee_cents),
        });
        if (!ok) return;
        try {
          await AppCommon.api(`/ALTApi/appointments/${a.id}/payment-received`, {
            method: 'PATCH',
            body: JSON.stringify({}),
          });
          AppCommon.setMessage('Marked as paid.');
          await refreshAfterPayment();
        } catch (err) {
          AppCommon.setMessage(err.message, true);
        }
      });
      actionTd.appendChild(payBtn);
    }

    clientDrilldownBody.appendChild(tr);
  });
}

clientMonthFilter.addEventListener('change', renderDrilldownTable);
clientStatusFilter.addEventListener('change', renderDrilldownTable);
clientFilterClear.addEventListener('click', () => {
  clientMonthFilter.value = '';
  clientStatusFilter.value = '';
  renderDrilldownTable();
});

function showAllClients() {
  if (clientSearchSelect) clientSearchSelect.clear();
  renderClientTable(allClientRevenue);
  clientRevenueKpis.classList.add('hidden');
  clientBackBtn.classList.add('hidden');
  hideClientDrilldown();
}

clientBackBtn.addEventListener('click', showAllClients);

/* ── Export Revenue by Client ── */
document.getElementById('exportClientBtn').addEventListener('click', async () => {
  const selectedId = clientSearchSelect ? clientSearchSelect.getValue() : '';
  const visibleRows = selectedId
    ? allClientRevenue.filter((r) => String(r.client_id) === selectedId)
    : allClientRevenue;

  if (!visibleRows.length) {
    AppCommon.setMessage('No data to export.', true);
    return;
  }

  // If a single client is selected, export their appointments with payment details
  if (selectedId && visibleRows.length === 1) {
    const client = visibleRows[0];
    try {
      const appts = await AppCommon.api(`/ALTApi/appointments?clientId=${client.client_id}`);
      const headers = ['Date', 'Location', 'Duration (min)', 'Fee (€)', 'Paid', 'Payment Type', 'Notes'];
      const data = appts.map((a) => [
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

  const headers = ['Client', 'Appointments', 'Paid', 'Owed', 'Total (€)', 'Paid (€)', 'Owed (€)', 'Oldest owed (days)'];
  const data = sortedClientRows(visibleRows).map((r) => [
    r.full_name,
    r.total_appointments,
    r.paid_appointments,
    r.owed_appointments,
    (r.total_cents / 100).toFixed(2),
    (r.paid_cents / 100).toFixed(2),
    (r.owed_cents / 100).toFixed(2),
    r.oldest_owed_days >= 0 ? r.oldest_owed_days : '',
  ]);
  AppCommon.exportToXls('revenue-by-client.xls', headers, data, 'Revenue by Client — All');
});

async function loadClientRevenue() {
  try {
    const rows = await AppCommon.api('/ALTApi/reports/by-client');
    // Oldest unpaid appointment per client, in days (-1 when nothing is owed)
    const oldest = new Map();
    allOutstanding.forEach((a) => oldest.set(a.client_id, Math.max(oldest.get(a.client_id) ?? -1, a.days)));
    allClientRevenue = rows.map((r) => ({ ...r, oldest_owed_days: oldest.has(r.client_id) ? oldest.get(r.client_id) : -1 }));
    initClientSearch();
    renderClientTable(allClientRevenue);
  } catch (err) {
    clientRevenueBody.innerHTML = `<tr><td colspan="8" style="color:var(--danger)">${esc(err.message)}</td></tr>`;
  }
}

function initClientSearch() {
  const items = allClientRevenue.map((r) => ({ id: r.client_id, label: r.full_name }));
  if (!clientSearchSelect) {
    clientSearchSelect = AppCommon.createSearchSelect(clientRevenueSelect, items, {
      placeholder: 'Search client…',
      onChange: (id) => {
        if (id) {
          const row = allClientRevenue.find((r) => String(r.client_id) === id);
          renderClientTable(row ? [row] : []);
          renderClientKpis(row);
          clientBackBtn.classList.remove('hidden');
          loadClientDrilldown(row);
        } else {
          showAllClients();
        }
      },
    });
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
    <div class="rev-kpi rev-kpi--warn rev-kpi--clickable" data-action="show-client-owed">
      <span class="rev-kpi-label">Owed</span>
      <span class="rev-kpi-val">${row.owed_appointments}</span>
    </div>
    <div class="rev-kpi">
      <span class="rev-kpi-label">Total Revenue</span>
      <span class="rev-kpi-val">${euro(row.total_cents)}</span>
    </div>
    <div class="rev-kpi rev-kpi--ok">
      <span class="rev-kpi-label">Paid Revenue</span>
      <span class="rev-kpi-val">${euro(row.paid_cents)}</span>
    </div>
    <div class="rev-kpi rev-kpi--warn rev-kpi--clickable" data-action="show-client-owed">
      <span class="rev-kpi-label">Owed Revenue</span>
      <span class="rev-kpi-val">${euro(row.owed_cents)}</span>
    </div>
  `;

  clientRevenueKpis.querySelectorAll('[data-action="show-client-owed"]').forEach((el) => {
    el.addEventListener('click', () => openOwedDrawer({ clientId: row.client_id, clientName: row.full_name }));
  });
}

function sortedClientRows(rows) {
  const { key, dir } = clientSort;
  return rows.slice().sort((a, b) => {
    const x = key === 'full_name' ? String(a[key]).toLowerCase() : Number(a[key]);
    const y = key === 'full_name' ? String(b[key]).toLowerCase() : Number(b[key]);
    if (x < y) return -dir;
    if (x > y) return dir;
    return String(a.full_name).localeCompare(String(b.full_name));
  });
}

function renderClientHead() {
  clientRevenueHead.querySelectorAll('th[data-sort]').forEach((th) => {
    const base = th.dataset.label || th.textContent.replace(/ [▾▴]$/, '');
    th.dataset.label = base;
    th.textContent = clientSort.key === th.dataset.sort ? `${base} ${clientSort.dir < 0 ? '▾' : '▴'}` : base;
    th.setAttribute('aria-sort', clientSort.key === th.dataset.sort ? (clientSort.dir < 0 ? 'descending' : 'ascending') : 'none');
  });
}

clientRevenueHead.querySelectorAll('th[data-sort]').forEach((th) => {
  th.addEventListener('click', () => {
    const key = th.dataset.sort;
    clientSort = { key, dir: clientSort.key === key ? -clientSort.dir : (key === 'full_name' ? 1 : -1) };
    const selectedId = clientSearchSelect ? clientSearchSelect.getValue() : '';
    renderClientTable(selectedId ? allClientRevenue.filter((r) => String(r.client_id) === selectedId) : allClientRevenue);
  });
});

function renderClientTable(rows) {
  renderClientHead();
  clientRevenueBody.innerHTML = '';
  if (!rows.length) {
    clientRevenueBody.innerHTML = '<tr><td colspan="8" style="color:var(--muted);text-align:center;padding:16px">No data.</td></tr>';
    return;
  }
  sortedClientRows(rows).forEach((r) => {
    const tr = document.createElement('tr');
    tr.className = 'appt-row';
    tr.style.cursor = 'pointer';
    tr.innerHTML = `
      <td>${esc(r.full_name)}</td>
      <td>${r.total_appointments}</td>
      <td>${r.paid_appointments}</td>
      <td>${Number(r.owed_appointments) > 0 ? `<span class="status-owed clickable-owed">${r.owed_appointments}</span>` : '0'}</td>
      <td>${euro(r.total_cents)}</td>
      <td>${euro(r.paid_cents)}</td>
      <td>${Number(r.owed_cents) > 0 ? `<span class="status-owed clickable-owed">${euro(r.owed_cents)}</span>` : '€0.00'}</td>
      <td>${r.oldest_owed_days >= 0 ? `<span class="rev-badge rev-badge--${ageBand(r.oldest_owed_days)}">${r.oldest_owed_days}d</span>` : '—'}</td>
    `;
    tr.querySelectorAll('.clickable-owed').forEach((span) => {
      span.addEventListener('click', (e) => {
        e.stopPropagation();
        openOwedDrawer({ clientId: r.client_id, clientName: r.full_name });
      });
    });
    tr.addEventListener('click', () => {
      clientSearchSelect.setValue(r.client_id);
      renderClientTable([r]);
      renderClientKpis(r);
      clientBackBtn.classList.remove('hidden');
      loadClientDrilldown(r);
    });
    clientRevenueBody.appendChild(tr);
  });
}

/* ── Revenue Tab Switching ── */
document.querySelectorAll('.rev-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.rev-tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    const target = tab.dataset.revTab;
    document.getElementById('rev-tab-overview').style.display = target === 'overview' ? '' : 'none';
    document.getElementById('rev-tab-by-client').style.display = target === 'by-client' ? '' : 'none';
    if (target === 'overview' && chartData) renderChart(chartData.series, chartData.prevSeries);
  });
});

/* ── Export Month & Global XLS ── */
const appointmentExportHeaders = ['Date', 'Patient', 'Location', 'Duration (min)', 'Fee (€)', 'Paid', 'Payment Type', 'Notes'];
const appointmentExportRow = (a) => [
  new Date(a.appointment_date).toLocaleDateString('en-GB'),
  a.full_name,
  a.location || '',
  a.duration_minutes,
  (a.fee_cents / 100).toFixed(2),
  a.wire_received ? 'Yes' : 'No',
  a.payment_type || '',
  a.comments || a.notes || '',
];

document.getElementById('exportMonthBtn').addEventListener('click', async () => {
  const month = currentMonth;
  try {
    const appts = await AppCommon.api(`/ALTApi/appointments?month=${encodeURIComponent(month)}`);
    if (!appts.length) {
      AppCommon.setMessage('No appointments for this month.', true);
      return;
    }
    AppCommon.exportToXls(`revenue-${month}.xls`, appointmentExportHeaders, appts.map(appointmentExportRow), `Revenue — ${month}`);
  } catch (err) {
    AppCommon.setMessage(err.message, true);
  }
});

document.getElementById('exportGlobalBtn').addEventListener('click', async () => {
  try {
    const appts = await AppCommon.api('/ALTApi/appointments');
    if (!appts.length) {
      AppCommon.setMessage('No appointments to export.', true);
      return;
    }
    AppCommon.exportToXls('revenue-all.xls', appointmentExportHeaders, appts.map(appointmentExportRow), 'Revenue — All Time');
  } catch (err) {
    AppCommon.setMessage(err.message, true);
  }
});

/* ── Static labels for the new parts of the page ── */
function applyRevenueLabels() {
  document.getElementById('chartTitle').textContent = L('rev_chart_title');
  chartTableToggle.textContent = chartTable.classList.contains('hidden') ? L('rev_show_table') : L('rev_hide_table');
  document.getElementById('prevMonth').setAttribute('aria-label', L('rev_prev_month'));
  document.getElementById('nextMonth').setAttribute('aria-label', L('rev_next_month'));
  document.querySelector('label[for="monthInput"]').textContent = L('rev_month');
  document.getElementById('viewPatientBtn').textContent = L('rev_view_patient');
  document.getElementById('viewApptBtn').textContent = L('rev_view_appt');
  document.getElementById('owedSelClear').textContent = L('rev_clear').replace(/^./, (c) => c.toUpperCase());
  document.getElementById('owedSelMark').textContent = L('rev_mark_selected');
  document.getElementById('owedConfirmNo').textContent = L('rev_cancel');
  document.getElementById('owedConfirmYes').textContent = L('rev_mark_paid');
  document.getElementById('oldestOwedHead').textContent = L('rev_oldest_owed');
  delete document.getElementById('oldestOwedHead').dataset.label;
}

async function loadAll() {
  try {
    years = await AppCommon.api('/ALTApi/reports/years');
  } catch (_) {
    years = [THIS_YEAR];
  }
  if (selectedYear !== 'all' && !years.includes(selectedYear)) selectedYear = years[0] || THIS_YEAR;
  renderYearChips();
  await loadOutstanding();
  await Promise.all([loadTotal(), loadMonth(), loadFuture(), loadClientRevenue()]);
}

AppCommon.ensureAuth(async () => {
  const user = AppCommon.getUser();

  // Revenue is for therapists only; admins go to the home page
  if (user && user.role === 'admin') {
    window.location.href = '/index.html';
    return;
  }

  applyRevenueLabels();
  try {
    await loadAll();
  } catch (err) {
    AppCommon.setMessage(err.message, true);
  }
});
