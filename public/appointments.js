const filterForm = document.getElementById('filter-form');
const appointmentForm = document.getElementById('appointment-form');
const appointmentsTableBody = document.getElementById('appointments-table-body');
const newAppointmentBtn = document.getElementById('new-appointment');
const clearFiltersBtn = document.getElementById('clear-filters');
const deleteAppointmentBtn = document.getElementById('delete-appointment');
const clientSelect = document.getElementById('clientId');
const filterClientSelect = document.getElementById('filterClientId');
const feeInput = document.getElementById('feeAmount');
const editorDrawer = document.getElementById('editor-drawer');
const editorOverlay = document.getElementById('editor-overlay');
const closeEditorBtn = document.getElementById('close-editor');
const editorTitle = document.getElementById('editor-title');
const sortButtons = [...document.querySelectorAll('.sort-btn')];
const patientInfoDrawer = document.getElementById('patient-info-drawer');
const patientInfoOverlay = document.getElementById('patient-info-overlay');
const closePatientInfoBtn = document.getElementById('close-patient-info');
const patientInfoName = document.getElementById('patient-info-name');
const patientInfoCondition = document.getElementById('patient-info-condition');
const patientInfoPhone = document.getElementById('patient-info-phone');
const patientInfoEmail = document.getElementById('patient-info-email');

const pager = document.getElementById('pager');
const pagerPrev = document.getElementById('pager-prev');
const pagerNext = document.getElementById('pager-next');
const pagerInfo = document.getElementById('pager-info');

const PAGE_SIZE = 5;
let currentPage = 1;
let defaultFeeCents = 0;
let clientsById = new Map();
let currentRows = [];
let sortState = { key: 'appointment_date', dir: 'desc' };

function dateToInputValue(isoString) {
  const d = new Date(isoString);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function clearForm() {
  appointmentForm.reset();
  document.getElementById('appointmentId').value = '';
  clientSelect.value = '';
  document.getElementById('durationMinutes').value = '60';
  feeInput.value = (defaultFeeCents / 100).toFixed(2);
  deleteAppointmentBtn.disabled = true;
  deleteAppointmentBtn.classList.add('hidden');
}

function openEditor(title = 'Edit Appointment') {
  editorTitle.textContent = title;
  editorOverlay.classList.remove('hidden');
  editorDrawer.classList.remove('hidden');
  requestAnimationFrame(() => {
    editorOverlay.classList.add('open');
    editorDrawer.classList.add('open');
    editorDrawer.setAttribute('aria-hidden', 'false');
  });
}

function closeEditor() {
  editorOverlay.classList.remove('open');
  editorDrawer.classList.remove('open');
  editorDrawer.setAttribute('aria-hidden', 'true');
  setTimeout(() => {
    editorOverlay.classList.add('hidden');
    editorDrawer.classList.add('hidden');
  }, 220);
}

async function loadClients() {
  const clients = await AppCommon.api('/api/clients');
  clientsById = new Map(clients.map((client) => [client.id, client]));

  clientSelect.innerHTML = '';
  filterClientSelect.innerHTML = '<option value="">All patients</option>';

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Select a patient';
  placeholder.disabled = true;
  placeholder.selected = true;
  clientSelect.appendChild(placeholder);

  clients.forEach((client) => {
    const option = document.createElement('option');
    option.value = String(client.id);
    option.textContent = client.full_name;
    clientSelect.appendChild(option.cloneNode(true));
    filterClientSelect.appendChild(option);
  });
}

async function loadSettings() {
  const settings = await AppCommon.api('/api/settings');
  defaultFeeCents = settings.defaultFeeCents;
  feeInput.value = (defaultFeeCents / 100).toFixed(2);
}

function buildFilters() {
  const data = new FormData(filterForm);
  const params = new URLSearchParams();

  ['q', 'clientId', 'wireReceived', 'paymentType'].forEach((key) => {
    const value = data.get(key);
    if (value) params.set(key, value);
  });

  const from = data.get('from');
  const to = data.get('to');
  if (from) params.set('from', new Date(`${from}T00:00:00`).toISOString());
  if (to) params.set('to', new Date(`${to}T23:59:59`).toISOString());

  return params;
}

function compareRows(a, b) {
  const { key, dir } = sortState;
  const direction = dir === 'asc' ? 1 : -1;

  if (key === 'appointment_date') {
    return (new Date(a.appointment_date) - new Date(b.appointment_date)) * direction;
  }

  if (key === 'duration_minutes' || key === 'fee_cents' || key === 'wire_received') {
    return (Number(a[key] || 0) - Number(b[key] || 0)) * direction;
  }

  return String(a[key] || '').localeCompare(String(b[key] || '')) * direction;
}

function updateSortLabels() {
  sortButtons.forEach((btn) => {
    const key = btn.dataset.sortKey;
    const isActive = key === sortState.key;
    const suffix = isActive ? (sortState.dir === 'asc' ? ' ▲' : ' ▼') : '';
    btn.textContent = `${btn.textContent.replace(/\s[▲▼]$/, '')}${suffix}`;
  });
}

function openPatientInfo(clientId) {
  const client = clientsById.get(Number(clientId));
  if (!client) {
    AppCommon.setMessage('Patient details unavailable.', true);
    return;
  }

  patientInfoName.textContent = client.full_name || '-';
  patientInfoCondition.textContent = client.condition_notes || '-';
  patientInfoPhone.textContent = client.phone || '-';
  patientInfoEmail.textContent = client.email || '-';

  patientInfoOverlay.classList.remove('hidden');
  patientInfoDrawer.classList.remove('hidden');
  requestAnimationFrame(() => {
    patientInfoOverlay.classList.add('open');
    patientInfoDrawer.classList.add('open');
    patientInfoDrawer.setAttribute('aria-hidden', 'false');
  });
}

function closePatientInfo() {
  patientInfoOverlay.classList.remove('open');
  patientInfoDrawer.classList.remove('open');
  patientInfoDrawer.setAttribute('aria-hidden', 'true');
  setTimeout(() => {
    patientInfoOverlay.classList.add('hidden');
    patientInfoDrawer.classList.add('hidden');
  }, 220);
}

function updatePager(totalRows) {
  const totalPages = Math.ceil(totalRows / PAGE_SIZE);
  if (totalPages <= 1) {
    pager.classList.add('hidden');
    return;
  }
  pager.classList.remove('hidden');
  pagerPrev.disabled = currentPage <= 1;
  pagerNext.disabled = currentPage >= totalPages;
  pagerInfo.textContent = `Page ${currentPage} of ${totalPages}`;
}

function renderAppointmentsTable(rows) {
  appointmentsTableBody.innerHTML = '';

  if (!rows.length) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="8" class="small">No appointments found.</td>';
    appointmentsTableBody.appendChild(tr);
    pager.classList.add('hidden');
    return;
  }

  const totalPages = Math.ceil(rows.length / PAGE_SIZE);
  if (currentPage > totalPages) currentPage = totalPages;
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageRows = rows.slice(start, start + PAGE_SIZE);
  updatePager(rows.length);

  pageRows.forEach((appointment) => {
    const tr = document.createElement('tr');
    tr.className = 'appt-row';
    tr.tabIndex = 0;
    tr.innerHTML = `
      <td>${new Date(appointment.appointment_date).toLocaleString('en-GB')}</td>
      <td>
        <div class="name-cell">
          <span>${appointment.full_name}</span>
          <button type="button" class="outline tiny-btn patient-info-btn" data-client-id="${appointment.client_id}">Info</button>
        </div>
      </td>
      <td>${appointment.location}</td>
      <td>${appointment.duration_minutes}m</td>
      <td>${AppCommon.euroFromCents(appointment.fee_cents)}</td>
      <td><span class="${appointment.wire_received ? 'status-paid' : 'status-owed'}">${appointment.wire_received ? 'PAID' : 'OWED'}</span></td>
      <td>${appointment.payment_type || '-'}</td>
    `;

    const openForEdit = async () => {
      await loadAppointmentById(appointment.id);
      openEditor('Edit Appointment');
    };

    tr.addEventListener('click', async () => {
      await openForEdit();
    });

    tr.addEventListener('keydown', async (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        await openForEdit();
      }
    });

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'outline';
    button.textContent = 'Edit';
    button.addEventListener('click', async (event) => {
      event.stopPropagation();
      await openForEdit();
    });

    const infoBtn = tr.querySelector('.patient-info-btn');
    infoBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      openPatientInfo(appointment.client_id);
    });

    const actionTd = document.createElement('td');
    const actionWrap = document.createElement('div');
    actionWrap.style.cssText = 'display:flex;gap:4px;align-items:center';

    if (!appointment.wire_received) {
      const payBtn = document.createElement('button');
      payBtn.type = 'button';
      payBtn.className = 'outline tiny-btn';
      payBtn.textContent = '\u2713 Paid';
      payBtn.style.color = 'var(--ok)';
      payBtn.style.borderColor = 'var(--ok)';
      payBtn.addEventListener('click', async (event) => {
        event.stopPropagation();
        const ok = await AppCommon.confirmPayment({
          name: appointment.full_name,
          date: new Date(appointment.appointment_date).toLocaleString('en-GB'),
          fee: AppCommon.euroFromCents(appointment.fee_cents),
        });
        if (!ok) return;
        try {
          await AppCommon.api(`/api/appointments/${appointment.id}/payment-received`, { method: 'PATCH', body: JSON.stringify({}) });
          AppCommon.setMessage('Payment marked as received.');
          await loadAppointments();
        } catch (err) {
          AppCommon.setMessage(err.message, true);
        }
      });
      actionWrap.appendChild(payBtn);
    }

    actionWrap.appendChild(button);
    actionTd.appendChild(actionWrap);
    tr.appendChild(actionTd);
    appointmentsTableBody.appendChild(tr);
  });
}

function updateFilterSummary() {
  const parts = [];
  const q = document.getElementById('q').value.trim();
  if (q) parts.push(q);

  const cId = filterClientSelect.value;
  if (cId) {
    const opt = filterClientSelect.options[filterClientSelect.selectedIndex];
    parts.push(opt.textContent);
  }

  const wr = document.getElementById('wireReceived').value;
  if (wr === '1') parts.push('Paid');
  else if (wr === '0') parts.push('Owed');

  const pt = document.getElementById('filterPaymentType').value;
  if (pt) parts.push(pt);

  const from = document.getElementById('from').value;
  const to = document.getElementById('to').value;
  if (from && to) parts.push(`${from} to ${to}`);
  else if (from) parts.push(`from ${from}`);
  else if (to) parts.push(`to ${to}`);

  const el = document.getElementById('filter-summary');
  el.textContent = parts.length ? `(${parts.join(', ')})` : '';
}

async function loadAppointments() {
  const params = buildFilters();
  currentRows = await AppCommon.api(`/api/appointments?${params.toString()}`);
  currentPage = 1;
  currentRows.sort(compareRows);
  renderAppointmentsTable(currentRows);
  updateSortLabels();
  updateFilterSummary();
}

async function loadAppointmentById(id) {
  const appointment = await AppCommon.api(`/api/appointments/${id}`);
  document.getElementById('appointmentId').value = String(appointment.id);
  document.getElementById('clientId').value = String(appointment.client_id);
  document.getElementById('appointmentDate').value = dateToInputValue(appointment.appointment_date);
  document.getElementById('address').value = appointment.location;
  document.getElementById('durationMinutes').value = String(appointment.duration_minutes || 60);
  document.getElementById('feeAmount').value = (Number(appointment.fee_cents || 0) / 100).toFixed(2);
  document.getElementById('wireReceivedEdit').value = appointment.wire_received ? 'true' : 'false';
  document.getElementById('paymentType').value = appointment.payment_type || '';
  document.getElementById('comments').value = appointment.comments || appointment.notes || '';
  deleteAppointmentBtn.disabled = false;
  deleteAppointmentBtn.classList.remove('hidden');
}

filterForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await loadAppointments();
  } catch (error) {
    AppCommon.setMessage(error.message, true);
  }
});

appointmentForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const id = document.getElementById('appointmentId').value;

  if (!document.getElementById('clientId').value) {
    AppCommon.setMessage('Please select a patient.', true);
    return;
  }

  const payload = {
    clientId: Number(document.getElementById('clientId').value),
    appointmentDate: new Date(document.getElementById('appointmentDate').value).toISOString(),
    address: document.getElementById('address').value,
    durationMinutes: Number(document.getElementById('durationMinutes').value || 60),
    feeAmount: Number(document.getElementById('feeAmount').value || 0),
    comments: document.getElementById('comments').value,
    wireReceived: document.getElementById('wireReceivedEdit').value === 'true',
    paymentType: document.getElementById('paymentType').value || null,
  };

  try {
    if (id) {
      await AppCommon.api(`/api/appointments/${id}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      AppCommon.setMessage('Appointment updated.');
    } else {
      await AppCommon.api('/api/appointments', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      AppCommon.setMessage('Appointment created.');
    }

    await loadAppointments();
    clearForm();
    closeEditor();
  } catch (error) {
    AppCommon.setMessage(error.message, true);
  }
});

newAppointmentBtn.addEventListener('click', () => {
  clearForm();
  openEditor('New Appointment');
  AppCommon.setMessage('Ready for a new appointment.');
});

deleteAppointmentBtn.addEventListener('click', async () => {
  const id = document.getElementById('appointmentId').value;
  if (!id) {
    AppCommon.setMessage('Load an appointment before deleting.', true);
    return;
  }

  const confirmed = window.confirm('Delete this appointment? This action cannot be undone.');
  if (!confirmed) {
    return;
  }

  try {
    await AppCommon.api(`/api/appointments/${id}`, { method: 'DELETE' });
    await loadAppointments();
    clearForm();
    closeEditor();
    AppCommon.setMessage('Appointment deleted.');
  } catch (error) {
    AppCommon.setMessage(error.message, true);
  }
});

clearFiltersBtn.addEventListener('click', async () => {
  filterForm.reset();
  filterClientSelect.value = '';
  document.getElementById('filterPaymentType').value = '';
  try {
    await loadAppointments();
    AppCommon.setMessage('Filters cleared.');
  } catch (error) {
    AppCommon.setMessage(error.message, true);
  }
});

closeEditorBtn.addEventListener('click', () => {
  closeEditor();
});

editorOverlay.addEventListener('click', () => {
  closeEditor();
});

closePatientInfoBtn.addEventListener('click', () => {
  closePatientInfo();
});

patientInfoOverlay.addEventListener('click', () => {
  closePatientInfo();
});

pagerPrev.addEventListener('click', () => {
  if (currentPage > 1) {
    currentPage -= 1;
    renderAppointmentsTable(currentRows);
  }
});

pagerNext.addEventListener('click', () => {
  const totalPages = Math.ceil(currentRows.length / PAGE_SIZE);
  if (currentPage < totalPages) {
    currentPage += 1;
    renderAppointmentsTable(currentRows);
  }
});

sortButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const key = button.dataset.sortKey;
    if (sortState.key === key) {
      sortState.dir = sortState.dir === 'asc' ? 'desc' : 'asc';
    } else {
      sortState.key = key;
      sortState.dir = key === 'appointment_date' ? 'desc' : 'asc';
    }

    currentPage = 1;
    currentRows.sort(compareRows);
    renderAppointmentsTable(currentRows);
    updateSortLabels();
  });
});

async function initPage() {
  await Promise.all([loadClients(), loadSettings()]);
  clearForm();
  await loadAppointments();

  const url = new URL(window.location.href);
  const editId = url.searchParams.get('id');
  if (editId) {
    await loadAppointmentById(editId);
    openEditor('Edit Appointment');
    AppCommon.setMessage('Appointment loaded for editing.');
  }

  const newForId = url.searchParams.get('newFor');
  if (newForId) {
    clearForm();
    document.getElementById('clientId').value = newForId;
    openEditor('New Appointment');
    AppCommon.setMessage('Ready for a new appointment.');
  }
}

AppCommon.ensureAuth(initPage);
