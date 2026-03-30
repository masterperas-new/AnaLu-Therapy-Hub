const loginView = document.getElementById('login-view');
const appView = document.getElementById('app-view');
const message = document.getElementById('message');

const loginForm = document.getElementById('login-form');
const logoutButton = document.getElementById('logout-button');
const navButtons = [...document.querySelectorAll('.nav-btn')];

const clientForm = document.getElementById('client-form');
const clientsList = document.getElementById('clients-list');
const clientSelect = document.getElementById('clientId');

const appointmentForm = document.getElementById('appointment-form');
const appointmentsList = document.getElementById('appointments-list');

const reportMonthInput = document.getElementById('reportMonth');
const loadReportButton = document.getElementById('load-report');
const reportSummary = document.getElementById('report-summary');
const cashOwedList = document.getElementById('cash-owed-list');

const calendarViewSelect = document.getElementById('calendar-view');
const calendarPrevButton = document.getElementById('calendar-prev');
const calendarTodayButton = document.getElementById('calendar-today');
const calendarNextButton = document.getElementById('calendar-next');
const calendarRange = document.getElementById('calendar-range');
const calendarGrid = document.getElementById('calendar-grid');

const state = {
  clients: [],
  appointments: [],
  calendarView: 'week',
  calendarDate: new Date(),
};

function setMessage(text, isError = false) {
  message.textContent = text;
  message.className = isError ? 'message error' : 'message';
}

function euroFromCents(cents) {
  return new Intl.NumberFormat('en-IE', {
    style: 'currency',
    currency: 'EUR',
  }).format(Number(cents || 0) / 100);
}

function startOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfMonth(date) {
  const d = new Date(date);
  d.setDate(1);
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

function dayKey(date) {
  return date.toISOString().slice(0, 10);
}

function currentRange() {
  if (state.calendarView === 'month') {
    const start = startOfMonth(state.calendarDate);
    const end = addMonths(start, 1);
    return { start, end };
  }

  const start = startOfWeek(state.calendarDate);
  const end = addDays(start, 7);
  return { start, end };
}

function formatRangeLabel(start, end) {
  const fmt = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const endMinusOne = addDays(end, -1);
  return `${fmt.format(start)} - ${fmt.format(endMinusOne)}`;
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({ error: 'Request failed.' }));
    throw new Error(data.error || 'Request failed.');
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

function setAuthenticated(authenticated) {
  loginView.classList.toggle('hidden', authenticated);
  appView.classList.toggle('hidden', !authenticated);
}

function setSection(sectionName) {
  const sectionIds = ['schedule', 'clients', 'cash'];

  sectionIds.forEach((name) => {
    const panel = document.getElementById(`section-${name}`);
    panel.classList.toggle('hidden', name !== sectionName);
  });

  navButtons.forEach((button) => {
    button.classList.toggle('active', button.dataset.section === sectionName);
  });
}

async function loadClients() {
  state.clients = await api('/api/clients');

  clientsList.innerHTML = '';
  clientSelect.innerHTML = '';

  if (!state.clients.length) {
    const li = document.createElement('li');
    li.textContent = 'No patients registered yet.';
    clientsList.appendChild(li);

    const option = document.createElement('option');
    option.textContent = 'Create a patient first';
    option.value = '';
    clientSelect.appendChild(option);
    return;
  }

  state.clients.forEach((client) => {
    const li = document.createElement('li');
    li.innerHTML = `<strong>${client.full_name}</strong><small>${client.condition_notes}</small><small>${client.phone || '-'} | ${client.email || '-'}</small>`;
    clientsList.appendChild(li);

    const option = document.createElement('option');
    option.value = String(client.id);
    option.textContent = client.full_name;
    clientSelect.appendChild(option);
  });
}

function renderAppointmentsList() {
  appointmentsList.innerHTML = '';

  if (!state.appointments.length) {
    const li = document.createElement('li');
    li.textContent = 'No appointments in this period.';
    appointmentsList.appendChild(li);
    return;
  }

  state.appointments.forEach((appointment) => {
    const li = document.createElement('li');
    const paidLabel = appointment.wire_received ? 'PAID' : 'OWED';
    const paidClass = appointment.wire_received ? 'paid' : 'owed';

    li.innerHTML = `
      <div>
        <strong>${appointment.full_name}</strong>
        <small>${new Date(appointment.appointment_date).toLocaleString('en-GB')}</small>
        <small>${appointment.location} | ${euroFromCents(appointment.fee_cents)}</small>
        <small class="status ${paidClass}">${paidLabel}</small>
      </div>
    `;

    if (!appointment.wire_received) {
      const button = document.createElement('button');
      button.className = 'outline';
      button.type = 'button';
      button.textContent = 'Mark Wire Received';
      button.addEventListener('click', async () => {
        try {
          await api(`/api/appointments/${appointment.id}/wire-received`, { method: 'PATCH' });
          setMessage('Appointment payment updated.');
          await refreshData();
        } catch (error) {
          setMessage(error.message, true);
        }
      });
      li.appendChild(button);
    }

    appointmentsList.appendChild(li);
  });
}

function renderCashOwedList() {
  cashOwedList.innerHTML = '';
  const owed = state.appointments.filter((item) => !item.wire_received);

  if (!owed.length) {
    const li = document.createElement('li');
    li.textContent = 'No outstanding wires in this period.';
    cashOwedList.appendChild(li);
    return;
  }

  owed.forEach((appointment) => {
    const li = document.createElement('li');
    li.innerHTML = `<strong>${appointment.full_name}</strong><small>${new Date(appointment.appointment_date).toLocaleString('en-GB')}</small><small>${euroFromCents(appointment.fee_cents)} due</small>`;
    cashOwedList.appendChild(li);
  });
}

function renderCalendar() {
  const { start, end } = currentRange();
  calendarRange.textContent = formatRangeLabel(start, end);
  calendarGrid.innerHTML = '';

  const grouped = new Map();
  state.appointments.forEach((appointment) => {
    const key = dayKey(new Date(appointment.appointment_date));
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key).push(appointment);
  });

  if (state.calendarView === 'month') {
    calendarGrid.className = 'calendar-grid month';
    const monthStart = startOfMonth(state.calendarDate);
    const firstCell = startOfWeek(monthStart);

    for (let i = 0; i < 42; i += 1) {
      const date = addDays(firstCell, i);
      const key = dayKey(date);
      const events = grouped.get(key) || [];

      const cell = document.createElement('article');
      cell.className = 'calendar-cell';
      if (date.getMonth() !== monthStart.getMonth()) {
        cell.classList.add('faded');
      }

      const heading = document.createElement('h4');
      heading.textContent = `${date.getDate()} ${date.toLocaleString('en-GB', { weekday: 'short' })}`;
      cell.appendChild(heading);

      events.slice(0, 3).forEach((event) => {
        const p = document.createElement('p');
        p.className = event.wire_received ? 'event paid' : 'event owed';
        p.textContent = `${new Date(event.appointment_date).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} ${event.full_name}`;
        cell.appendChild(p);
      });

      if (events.length > 3) {
        const more = document.createElement('p');
        more.className = 'event-more';
        more.textContent = `+${events.length - 3} more`;
        cell.appendChild(more);
      }

      calendarGrid.appendChild(cell);
    }
    return;
  }

  calendarGrid.className = 'calendar-grid week';
  for (let i = 0; i < 7; i += 1) {
    const date = addDays(start, i);
    const key = dayKey(date);
    const events = grouped.get(key) || [];

    const cell = document.createElement('article');
    cell.className = 'calendar-cell';

    const heading = document.createElement('h4');
    heading.textContent = `${date.toLocaleString('en-GB', { weekday: 'long' })} ${date.getDate()}`;
    cell.appendChild(heading);

    if (!events.length) {
      const empty = document.createElement('p');
      empty.className = 'event-empty';
      empty.textContent = 'No appointments';
      cell.appendChild(empty);
    } else {
      events.forEach((event) => {
        const p = document.createElement('p');
        p.className = event.wire_received ? 'event paid' : 'event owed';
        p.textContent = `${new Date(event.appointment_date).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} ${event.full_name}`;
        cell.appendChild(p);
      });
    }

    calendarGrid.appendChild(cell);
  }
}

function getDefaultMonth() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${now.getFullYear()}-${month}`;
}

async function loadAppointmentsByCalendar() {
  const { start, end } = currentRange();
  const query = new URLSearchParams({
    start: start.toISOString(),
    end: end.toISOString(),
  });

  state.appointments = await api(`/api/appointments?${query.toString()}`);
}

async function loadReport() {
  const month = reportMonthInput.value || getDefaultMonth();
  reportMonthInput.value = month;

  const report = await api(`/api/reports/monthly?month=${encodeURIComponent(month)}`);
  reportSummary.innerHTML = `
    <div class="kpi"><span>Total Appointments</span><strong>${report.totalAppointments}</strong></div>
    <div class="kpi"><span>Paid Appointments</span><strong>${report.paidAppointments}</strong></div>
    <div class="kpi"><span>Owed Appointments</span><strong>${report.owedAppointments}</strong></div>
    <div class="kpi"><span>Total Cash</span><strong>${euroFromCents(report.totalCents)}</strong></div>
    <div class="kpi"><span>Paid Cash</span><strong>${euroFromCents(report.paidCents)}</strong></div>
    <div class="kpi"><span>Owed Cash</span><strong>${euroFromCents(report.owedCents)}</strong></div>
  `;
}

async function refreshData() {
  await Promise.all([loadClients(), loadAppointmentsByCalendar(), loadReport()]);
  renderAppointmentsList();
  renderCashOwedList();
  renderCalendar();
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(loginForm);

  try {
    await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ password: formData.get('password') }),
    });

    loginForm.reset();
    setAuthenticated(true);
    setSection('schedule');
    await refreshData();
    setMessage('Logged in successfully.');
  } catch (error) {
    setMessage(error.message, true);
  }
});

logoutButton.addEventListener('click', async () => {
  try {
    await api('/api/auth/logout', { method: 'POST' });
    setAuthenticated(false);
    setMessage('Logged out.');
  } catch (error) {
    setMessage(error.message, true);
  }
});

navButtons.forEach((button) => {
  button.addEventListener('click', () => {
    setSection(button.dataset.section);
  });
});

calendarViewSelect.addEventListener('change', async () => {
  state.calendarView = calendarViewSelect.value;
  await refreshData();
});

calendarPrevButton.addEventListener('click', async () => {
  state.calendarDate = state.calendarView === 'month' ? addMonths(state.calendarDate, -1) : addDays(state.calendarDate, -7);
  await refreshData();
});

calendarNextButton.addEventListener('click', async () => {
  state.calendarDate = state.calendarView === 'month' ? addMonths(state.calendarDate, 1) : addDays(state.calendarDate, 7);
  await refreshData();
});

calendarTodayButton.addEventListener('click', async () => {
  state.calendarDate = new Date();
  await refreshData();
});

clientForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(clientForm);

  try {
    await api('/api/clients', {
      method: 'POST',
      body: JSON.stringify({
        fullName: formData.get('fullName'),
        conditionNotes: formData.get('conditionNotes'),
        phone: formData.get('phone'),
        email: formData.get('email'),
      }),
    });
    clientForm.reset();
    await loadClients();
    setMessage('Patient created.');
  } catch (error) {
    setMessage(error.message, true);
  }
});

appointmentForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(appointmentForm);

  try {
    await api('/api/appointments', {
      method: 'POST',
      body: JSON.stringify({
        clientId: Number(formData.get('clientId')),
        appointmentDate: new Date(formData.get('appointmentDate')).toISOString(),
        location: formData.get('location'),
        feeAmount: Number(formData.get('feeAmount')),
        notes: formData.get('notes'),
        wireReceived: Boolean(formData.get('wireReceived')),
      }),
    });

    appointmentForm.reset();
    document.getElementById('location').value = 'In loco';
    await refreshData();
    setMessage('Appointment created.');
  } catch (error) {
    setMessage(error.message, true);
  }
});

loadReportButton.addEventListener('click', async () => {
  try {
    await loadReport();
    renderCashOwedList();
    setMessage('Cash report loaded.');
  } catch (error) {
    setMessage(error.message, true);
  }
});

async function bootstrap() {
  reportMonthInput.value = getDefaultMonth();
  calendarViewSelect.value = 'week';

  try {
    const sessionData = await api('/api/auth/session');
    setAuthenticated(sessionData.authenticated);

    if (sessionData.authenticated) {
      setSection('schedule');
      await refreshData();
    }
  } catch (_error) {
    setAuthenticated(false);
  }
}

bootstrap();
