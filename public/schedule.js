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
let bulkClientSearchSelect = null;

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

  // Populate bulk client select
  const bulkClientSelect = document.getElementById('bulkClientId');
  bulkClientSelect.innerHTML = '<option value="" selected disabled>Select a patient</option>';
  sorted.forEach((client) => {
    const option = document.createElement('option');
    option.value = String(client.id);
    option.textContent = client.full_name;
    bulkClientSelect.appendChild(option);
  });
  if (!bulkClientSearchSelect) {
    bulkClientSearchSelect = AppCommon.createSearchSelect(bulkClientSelect, items, {
      placeholder: 'Search patient…',
    });
  } else {
    bulkClientSearchSelect.setItems(items);
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
  document.getElementById('bulk-therapist-field-wrap').classList.remove('hidden');
  const therapists = await AppCommon.api('/ALTApi/users/therapists');
  therapistSelect.innerHTML = '<option value="" selected disabled>Select a therapist</option>';
  const bulkTherapistSelect = document.getElementById('bulkTherapistId');
  bulkTherapistSelect.innerHTML = '<option value="" selected disabled>Select a therapist</option>';
  therapists.forEach((t) => {
    const option = document.createElement('option');
    option.value = String(t.id);
    option.textContent = t.full_name;
    therapistSelect.appendChild(option.cloneNode(true));
    bulkTherapistSelect.appendChild(option);
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
        const chipClass = AppCommon.getUser()?.role === 'admin' ? '' : (appointment.wire_received ? 'paid' : 'owed');
        link.className = `appt-chip ${chipClass}`;
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
        const chipClass = AppCommon.getUser()?.role === 'admin' ? '' : (appointment.wire_received ? 'paid' : 'owed');
        link.className = `appt-chip ${chipClass}`;
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

    // Keep patient, address, fee, therapist — clear date, comments, paid
    appointmentDateInput.value = '';
    document.getElementById('comments').value = '';
    const paidCheckbox = document.getElementById('markAsPaid');
    if (paidCheckbox) paidCheckbox.checked = false;
    AppCommon.setMessage('Appointment created — form ready for another.');
    await loadAppointments();
  } catch (error) {
    AppCommon.setMessage(error.message, true);
  }
});

async function initPage() {
  const user = AppCommon.getUser();
  const savedView = localStorage.getItem('calendarView') || (user && user.calendarView) || 'week';
  state.view = savedView;
  calendarView.value = savedView;
  await Promise.all([loadClients(), loadSettings(), loadTherapists(), loadAppointments()]);
  initBulkForm();
}

/* ── Bulk Add Appointments ── */
function initBulkForm() {
  const bulkForm = document.getElementById('bulk-form');
  const bulkDateInput = document.getElementById('bulkDateInput');
  const bulkAddDateBtn = document.getElementById('bulkAddDate');
  const bulkDateChips = document.getElementById('bulkDateChips');
  const bulkSubmitBtn = document.getElementById('bulkSubmitBtn');
  const bulkClientSelect = document.getElementById('bulkClientId');
  const bulkFeeInput = document.getElementById('bulkFee');
  const bulkDuration = document.getElementById('bulkDuration');
  const bulkAddress = document.getElementById('bulkAddress');
  const bulkComments = document.getElementById('bulkComments');
  const bulkTherapistSelect = document.getElementById('bulkTherapistId');

  const bulkDates = [];

  bulkClientSelect.addEventListener('change', () => {
    const clientId = Number(bulkClientSelect.value);
    if (clientId && clientsById.has(clientId)) {
      bulkAddress.value = clientsById.get(clientId).address || '';
    }
  });

  function renderChips() {
    bulkDateChips.innerHTML = '';
    bulkDates.sort((a, b) => a.getTime() - b.getTime());
    bulkDates.forEach((d, idx) => {
      const chip = document.createElement('span');
      chip.className = 'date-chip';
      const label = d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      chip.innerHTML = `${label} <button type="button" class="date-chip-remove" data-idx="${idx}">&times;</button>`;
      chip.querySelector('.date-chip-remove').addEventListener('click', () => {
        bulkDates.splice(idx, 1);
        renderChips();
      });
      bulkDateChips.appendChild(chip);
    });
    const count = bulkDates.length;
    bulkSubmitBtn.textContent = `Create ${count} Appointment${count !== 1 ? 's' : ''}`;
    bulkSubmitBtn.disabled = count === 0;
  }

  bulkAddDateBtn.addEventListener('click', () => {
    const val = bulkDateInput.value;
    if (!val) {
      AppCommon.setMessage('Pick a date and time first.', true);
      return;
    }
    const d = new Date(val);
    const exists = bulkDates.some((existing) => existing.getTime() === d.getTime());
    if (exists) {
      AppCommon.setMessage('That date/time is already added.', true);
      return;
    }
    bulkDates.push(d);
    bulkDateInput.value = '';
    renderChips();
  });

  bulkForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (bulkDates.length === 0) {
      AppCommon.setMessage('Add at least one date.', true);
      return;
    }
    if (!bulkClientSelect.value) {
      AppCommon.setMessage('Please select a patient.', true);
      return;
    }

    const user = AppCommon.getUser();
    const bulkPaidCheckbox = document.getElementById('bulkMarkAsPaid');
    const bulkPaymentTypeSelect = document.getElementById('bulkPaymentType');
    const payload = {
      clientId: Number(bulkClientSelect.value),
      appointmentDates: bulkDates.map((d) => d.toISOString()),
      address: bulkAddress.value,
      durationMinutes: Number(bulkDuration.value || 60),
      comments: bulkComments.value,
      wireReceived: bulkPaidCheckbox ? bulkPaidCheckbox.checked : false,
      paymentType: bulkPaymentTypeSelect ? bulkPaymentTypeSelect.value || null : null,
    };

    if (user && user.role === 'admin') {
      const sel = bulkTherapistSelect.value;
      if (!sel) {
        AppCommon.setMessage('Please select a therapist.', true);
        return;
      }
      payload.userId = Number(sel);
    }

    const feeAmount = parseFeeAmount(bulkFeeInput.value);
    if (Number.isNaN(feeAmount)) {
      AppCommon.setMessage('Fee must be a valid number.', true);
      return;
    }
    if (feeAmount !== null) {
      payload.feeAmount = feeAmount;
    }

    try {
      const result = await AppCommon.api('/ALTApi/appointments/batch', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      AppCommon.setMessage(`${result.count} appointment${result.count !== 1 ? 's' : ''} created.`);
      bulkDates.length = 0;
      renderChips();
      bulkForm.reset();
      bulkDuration.value = '60';
      if (bulkPaidCheckbox) bulkPaidCheckbox.checked = false;
      if (bulkPaymentTypeSelect) bulkPaymentTypeSelect.value = '';
      if (bulkClientSearchSelect) bulkClientSearchSelect.clear();
      if (bulkTherapistSelect) bulkTherapistSelect.selectedIndex = 0;
      await loadAppointments();
    } catch (error) {
      AppCommon.setMessage(error.message, true);
    }
  });
}

AppCommon.ensureAuth(initPage);
