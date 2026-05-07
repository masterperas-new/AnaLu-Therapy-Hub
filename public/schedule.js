const state = {
  view: 'week',
  date: new Date(),
  appointments: [],
};

/* ── Custom Dialog ── */
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

  const title = document.createElement('h3');
  title.textContent = 'AnaLu Therapy Hub';
  Object.assign(title.style, { margin: '0 0 12px', fontSize: '1.1rem', color: 'var(--text, #222)' });

  const msg = document.createElement('p');
  msg.textContent = message;
  Object.assign(msg.style, {
    margin: '0 0 20px', fontSize: '0.95rem', lineHeight: '1.5',
    color: isError ? 'var(--danger, #c0392b)' : 'var(--text, #444)',
  });

  const btn = document.createElement('button');
  btn.textContent = 'OK';
  Object.assign(btn.style, {
    padding: '8px 32px', border: 'none', borderRadius: '6px', cursor: 'pointer',
    fontSize: '0.95rem', fontWeight: '600',
    background: isError ? 'var(--danger, #c0392b)' : 'var(--primary, #2563eb)',
    color: '#fff',
  });

  btn.addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  box.append(title, msg, btn);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  btn.focus();
}

const calendarView = document.getElementById('calendar-view');
const calendarPrev = document.getElementById('calendar-prev');
const calendarToday = document.getElementById('calendar-today');
const calendarNext = document.getElementById('calendar-next');
const calendarRange = document.getElementById('calendar-range');
const calendarGrid = document.getElementById('calendar-grid');
const appointmentForm = document.getElementById('appointment-form');
const clientSelect = document.getElementById('clientId');
const feeInput = document.getElementById('feeAmount');
const appointmentDateInput = document.getElementById('appointmentDate');
const therapistFieldWrap = document.getElementById('therapist-field-wrap');
const therapistSelect = document.getElementById('therapistId');

function prefillDate(date) {
  const d = new Date(date);
  d.setHours(9, 0, 0, 0);
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T09:00`;
  appointmentDateInput.value = iso;
  appointmentForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
  clientSelect.focus({ preventScroll: true });
}

function startOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay();
  const shift = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + shift);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function addMonths(date, months) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

function monthRange(date) {
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 1);
  return { start, end };
}

function weekRange(date) {
  const start = startOfWeek(date);
  const end = addDays(start, 7);
  return { start, end };
}

function currentRange() {
  return state.view === 'month' ? monthRange(state.date) : weekRange(state.date);
}

function rangeLabel(start, end) {
  const fmt = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  return `${fmt.format(start)} - ${fmt.format(addDays(end, -1))}`;
}

function dayKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function parseFeeAmount(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim().replace(',', '.');
  if (!normalized) return null;

  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount < 0) return Number.NaN;
  return amount;
}

let clientSearchSelect = null;

function lastApptLabel(date) {
  if (!date) return 'No appointments yet';
  const d = new Date(date);
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days === 0) return 'Last: today';
  if (days === 1) return 'Last: yesterday';
  if (days < 7) return `Last: ${days} days ago`;
  if (days < 30) return `Last: ${Math.floor(days / 7)} week(s) ago`;
  return `Last: ${d.toLocaleDateString('en-GB')}`;
}

async function loadClients() {
  const clients = await AppCommon.api('/ALTApi/clients');
  clientsById = new Map(clients.map((client) => [client.id, client]));

  // Sort by most recent appointment first, then by name
  const sorted = [...clients].sort((a, b) => {
    const aDate = a.last_appointment_date ? new Date(a.last_appointment_date).getTime() : 0;
    const bDate = b.last_appointment_date ? new Date(b.last_appointment_date).getTime() : 0;
    if (bDate !== aDate) return bDate - aDate;
    return a.full_name.localeCompare(b.full_name);
  });

  clientSelect.innerHTML = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Select a patient';
  placeholder.selected = true;
  placeholder.disabled = true;
  clientSelect.appendChild(placeholder);

  const items = sorted.map((client) => ({
    id: client.id,
    label: client.full_name,
    detail: lastApptLabel(client.last_appointment_date),
  }));

  sorted.forEach((client) => {
    const option = document.createElement('option');
    option.value = String(client.id);
    option.textContent = client.full_name;
    clientSelect.appendChild(option);
  });

  if (!clientSearchSelect) {
    clientSearchSelect = AppCommon.createSearchSelect(clientSelect, items, {
      placeholder: 'Search patient…',
    });
  } else {
    clientSearchSelect.setItems(items);
  }
}

// Preload address when patient selected
clientSelect.addEventListener('change', () => {
  const clientId = Number(clientSelect.value);
  if (clientId && clientsById.has(clientId)) {
    document.getElementById('address').value = clientsById.get(clientId).address || '';
  }
});

async function loadSettings() {
  const settings = await AppCommon.api('/ALTApi/settings');
  feeInput.placeholder = (settings.defaultFeeCents / 100).toFixed(2);
}

async function loadTherapists() {
  const user = AppCommon.getUser();
  if (!user || user.role !== 'admin') return;

  therapistFieldWrap.classList.remove('hidden');
  const therapists = await AppCommon.api('/ALTApi/users/therapists');
  therapistSelect.innerHTML = '<option value="" selected disabled>Select a therapist</option>';
  therapists.forEach((t) => {
    const option = document.createElement('option');
    option.value = String(t.id);
    option.textContent = t.full_name;
    therapistSelect.appendChild(option);
  });
}

async function loadAppointments() {
  const { start, end } = currentRange();
  const params = new URLSearchParams({
    start: start.toISOString(),
    end: end.toISOString(),
  });
  state.appointments = await AppCommon.api(`/ALTApi/appointments?${params.toString()}`);
  renderCalendar();
}

function renderCalendar() {
  const { start, end } = currentRange();
  calendarRange.textContent = rangeLabel(start, end);
  calendarGrid.innerHTML = '';

  const grouped = new Map();
  state.appointments.forEach((appointment) => {
    const key = dayKey(new Date(appointment.appointment_date));
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(appointment);
  });

  function buildChip(appointment) {
    const link = document.createElement('a');
    const chipClass = AppCommon.getUser()?.role === 'admin' ? '' : (appointment.wire_received ? 'paid' : 'owed');
    link.className = `appt-chip ${chipClass}`;
    link.href = `/appointments.html?id=${appointment.id}`;
    link.textContent = `${new Date(appointment.appointment_date).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} ${appointment.full_name}`;
    return link;
  }

  function showDayPopup(date, events) {
    const existing = document.getElementById('day-popup-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'day-popup-overlay';
    overlay.className = 'day-popup-overlay';

    const box = document.createElement('div');
    box.className = 'day-popup';

    const header = document.createElement('div');
    header.className = 'day-popup-head';
    const heading = document.createElement('h3');
    heading.textContent = date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const closeBtn = document.createElement('button');
    closeBtn.className = 'outline';
    closeBtn.textContent = 'Close';
    closeBtn.addEventListener('click', () => overlay.remove());
    header.append(heading, closeBtn);

    const list = document.createElement('div');
    list.className = 'day-popup-list';
    events.forEach((appointment) => {
      const row = document.createElement('a');
      const chipClass = AppCommon.getUser()?.role === 'admin' ? '' : (appointment.wire_received ? 'paid' : 'owed');
      row.className = `day-popup-item ${chipClass}`;
      row.href = `/appointments.html?id=${appointment.id}`;

      const time = document.createElement('span');
      time.className = 'day-popup-time';
      time.textContent = new Date(appointment.appointment_date).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

      const name = document.createElement('span');
      name.className = 'day-popup-name';
      name.textContent = appointment.full_name;

      const addr = document.createElement('span');
      addr.className = 'day-popup-addr';
      addr.textContent = appointment.location || '';

      row.append(time, name, addr);
      list.appendChild(row);
    });

    const addBtn = document.createElement('button');
    addBtn.className = 'outline day-popup-add';
    addBtn.textContent = '+ Quick Add to this day';
    addBtn.addEventListener('click', () => {
      overlay.remove();
      prefillDate(date);
    });

    box.append(header, list, addBtn);
    overlay.appendChild(box);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
  }

  const MONTH_VISIBLE = 3;

  if (state.view === 'month') {
    calendarGrid.className = 'calendar-grid month';
    const mStart = new Date(state.date.getFullYear(), state.date.getMonth(), 1);
    const firstCell = startOfWeek(mStart);

    for (let i = 0; i < 42; i += 1) {
      const date = addDays(firstCell, i);
      const cell = document.createElement('article');
      cell.className = 'calendar-cell';
      if (date.getMonth() !== mStart.getMonth()) cell.classList.add('faded');
      if (isSameDay(date, new Date())) cell.classList.add('today');

      const title = document.createElement('h4');
      title.textContent = `${date.getDate()} ${date.toLocaleString('en-GB', { weekday: 'short' })}${isSameDay(date, new Date()) ? ' - Today' : ''}`;
      cell.appendChild(title);

      const events = grouped.get(dayKey(date)) || [];
      events.slice(0, MONTH_VISIBLE).forEach((appointment) => {
        cell.appendChild(buildChip(appointment));
      });

      if (events.length > MONTH_VISIBLE) {
        const more = document.createElement('button');
        more.className = 'more-btn';
        more.textContent = `+${events.length - MONTH_VISIBLE} more`;
        const cellDate = new Date(date);
        more.addEventListener('click', (e) => {
          e.stopPropagation();
          showDayPopup(cellDate, events);
        });
        cell.appendChild(more);
      }

      const cellDate = new Date(date);
      cell.addEventListener('click', (e) => {
        if (e.target.closest('a') || e.target.closest('.more-btn')) return;
        prefillDate(cellDate);
      });

      calendarGrid.appendChild(cell);
    }
    return;
  }

  calendarGrid.className = 'calendar-grid week';
  const WEEK_VISIBLE = 6;
  for (let i = 0; i < 7; i += 1) {
    const date = addDays(start, i);
    const cell = document.createElement('article');
    cell.className = 'calendar-cell';
    if (isSameDay(date, new Date())) cell.classList.add('today');

    const title = document.createElement('h4');
    title.textContent = `${date.toLocaleString('en-GB', { weekday: 'long' })} ${date.getDate()}${isSameDay(date, new Date()) ? ' - Today' : ''}`;
    cell.appendChild(title);

    const events = grouped.get(dayKey(date)) || [];
    if (!events.length) {
      const empty = document.createElement('p');
      empty.className = 'small';
      empty.textContent = 'No appointments';
      cell.appendChild(empty);
    } else {
      events.slice(0, WEEK_VISIBLE).forEach((appointment) => {
        cell.appendChild(buildChip(appointment));
      });
      if (events.length > WEEK_VISIBLE) {
        const more = document.createElement('button');
        more.className = 'more-btn';
        more.textContent = `+${events.length - WEEK_VISIBLE} more`;
        const cellDate = new Date(date);
        more.addEventListener('click', (e) => {
          e.stopPropagation();
          showDayPopup(cellDate, events);
        });
        cell.appendChild(more);
      }
    }

    const cellDate = new Date(date);
    cell.addEventListener('click', (e) => {
      if (e.target.closest('a')) return;
      prefillDate(cellDate);
    });

    calendarGrid.appendChild(cell);
  }
}

calendarView.addEventListener('change', async () => {
  state.view = calendarView.value;
  localStorage.setItem('calendarView', state.view);
  const user = AppCommon.getUser();
  if (user) {
    AppCommon.api(`/ALTApi/users/${user.id}/calendar-view`, {
      method: 'PATCH',
      body: JSON.stringify({ calendarView: state.view }),
    }).catch(() => {});
  }
  await loadAppointments();
});

calendarPrev.addEventListener('click', async () => {
  state.date = state.view === 'month' ? addMonths(state.date, -1) : addDays(state.date, -7);
  await loadAppointments();
});

calendarNext.addEventListener('click', async () => {
  state.date = state.view === 'month' ? addMonths(state.date, 1) : addDays(state.date, 7);
  await loadAppointments();
});

calendarToday.addEventListener('click', async () => {
  state.date = new Date();
  await loadAppointments();
});

appointmentForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = new FormData(appointmentForm);

  try {
    if (!data.get('clientId')) {
      throw new Error('Please select a patient.');
    }

    const user = AppCommon.getUser();
    const payload = {
      clientId: Number(data.get('clientId')),
      appointmentDate: new Date(data.get('appointmentDate')).toISOString(),
      address: data.get('address'),
      durationMinutes: Number(data.get('durationMinutes') || 60),
      comments: data.get('comments'),
    };

    if (user && user.role === 'admin') {
      const selTherapist = therapistSelect.value;
      if (!selTherapist) throw new Error('Please select a therapist.');
      payload.userId = Number(selTherapist);
    }

    const feeAmount = parseFeeAmount(data.get('feeAmount'));
    if (Number.isNaN(feeAmount)) {
      throw new Error('Fee must be a valid number.');
    }
    if (feeAmount !== null) {
      payload.feeAmount = feeAmount;
    }

    if (data.get('markAsPaid')) {
      payload.wireReceived = true;
    }

    await AppCommon.api('/ALTApi/appointments', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    // Clear the whole form
    appointmentForm.reset();
    document.getElementById('durationMinutes').value = '60';
    if (clientSearchSelect) clientSearchSelect.clear();
    if (therapistSelect) therapistSelect.selectedIndex = 0;
    await loadAppointments();
    showDialog('Appointment created successfully!');
  } catch (error) {
    showDialog(error.message, true);
  }
});

async function initPage() {
  const user = AppCommon.getUser();
  const savedView = localStorage.getItem('calendarView') || (user && user.calendarView) || 'week';
  state.view = savedView;
  calendarView.value = savedView;
  await Promise.all([loadClients(), loadSettings(), loadTherapists(), loadAppointments()]);
}

AppCommon.ensureAuth(initPage);
