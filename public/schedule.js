const state = {
  view: 'week',
  date: new Date(),
  appointments: [],
};

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
  return date.toISOString().slice(0, 10);
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

async function loadClients() {
  const clients = await AppCommon.api('/api/clients');
  clientSelect.innerHTML = '';

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Select a patient';
  placeholder.selected = true;
  placeholder.disabled = true;
  clientSelect.appendChild(placeholder);

  clients.forEach((client) => {
    const option = document.createElement('option');
    option.value = String(client.id);
    option.textContent = client.full_name;
    clientSelect.appendChild(option);
  });
}

async function loadSettings() {
  const settings = await AppCommon.api('/api/settings');
  feeInput.placeholder = (settings.defaultFeeCents / 100).toFixed(2);
}

async function loadAppointments() {
  const { start, end } = currentRange();
  const params = new URLSearchParams({
    start: start.toISOString(),
    end: end.toISOString(),
  });
  state.appointments = await AppCommon.api(`/api/appointments?${params.toString()}`);
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

      (grouped.get(dayKey(date)) || []).slice(0, 4).forEach((appointment) => {
        const link = document.createElement('a');
        link.className = `appt-chip ${appointment.wire_received ? 'paid' : 'owed'}`;
        link.href = `/appointments.html?id=${appointment.id}`;
        link.textContent = `${new Date(appointment.appointment_date).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} ${appointment.full_name}`;
        cell.appendChild(link);
      });

      const cellDate = new Date(date);
      cell.addEventListener('click', (e) => {
        if (e.target.closest('a')) return;
        prefillDate(cellDate);
      });

      calendarGrid.appendChild(cell);
    }
    return;
  }

  calendarGrid.className = 'calendar-grid week';
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
      events.forEach((appointment) => {
        const link = document.createElement('a');
        link.className = `appt-chip ${appointment.wire_received ? 'paid' : 'owed'}`;
        link.href = `/appointments.html?id=${appointment.id}`;
        link.textContent = `${new Date(appointment.appointment_date).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} ${appointment.full_name}`;
        cell.appendChild(link);
      });
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

    const payload = {
      clientId: Number(data.get('clientId')),
      appointmentDate: new Date(data.get('appointmentDate')).toISOString(),
      address: data.get('address'),
      durationMinutes: Number(data.get('durationMinutes') || 60),
      comments: data.get('comments'),
    };

    const feeAmount = parseFeeAmount(data.get('feeAmount'));
    if (Number.isNaN(feeAmount)) {
      throw new Error('Fee must be a valid number.');
    }
    if (feeAmount !== null) {
      payload.feeAmount = feeAmount;
    }

    await AppCommon.api('/api/appointments', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    appointmentForm.reset();
    document.getElementById('durationMinutes').value = '60';
    clientSelect.selectedIndex = 0;
    AppCommon.setMessage('Appointment created.');
    await loadAppointments();
  } catch (error) {
    AppCommon.setMessage(error.message, true);
  }
});

async function initPage() {
  calendarView.value = 'week';
  await Promise.all([loadClients(), loadSettings(), loadAppointments()]);
}

AppCommon.ensureAuth(initPage);
