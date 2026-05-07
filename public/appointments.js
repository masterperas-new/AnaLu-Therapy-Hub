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

const therapistFilterWrap = document.getElementById('therapist-filter-wrap');
const filterTherapistSelect = document.getElementById('filterTherapist');
const therapistFieldWrap = document.getElementById('therapist-field-wrap');
const therapistSelect = document.getElementById('therapistId');
const therapistColHead = document.getElementById('therapist-col-head');

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
let isAdmin = false;
let therapists = [];
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

function dateToInputValue(isoString) {
  const d = new Date(isoString);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function clearForm() {
  appointmentForm.reset();
  document.getElementById('appointmentId').value = '';
  clientSelect.value = '';
  if (clientSearchSelect) clientSearchSelect.clear();
  document.getElementById('durationMinutes').value = '60';
  feeInput.value = (defaultFeeCents / 100).toFixed(2);
  document.getElementById('wireReceivedEdit').disabled = false;
  deleteAppointmentBtn.disabled = true;
  deleteAppointmentBtn.classList.add('hidden');
  if (isAdmin && therapistSelect) therapistSelect.value = '';
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
  filterClientSelect.innerHTML = '<option value="">All patients</option>';

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Select a patient';
  placeholder.disabled = true;
  placeholder.selected = true;
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
    clientSelect.appendChild(option.cloneNode(true));
    filterClientSelect.appendChild(option);
  });

  if (!clientSearchSelect) {
    clientSearchSelect = AppCommon.createSearchSelect(clientSelect, items, {
      placeholder: 'Search patient…',
    });
  } else {
    clientSearchSelect.setItems(items);
  }
}
// Preload address from selected patient
clientSelect.addEventListener('change', () => {
  const clientId = Number(clientSelect.value);
  if (clientId && clientsById.has(clientId)) {
    const client = clientsById.get(clientId);
    document.getElementById('address').value = client.address || '';
  }
});

async function loadSettings() {
  const settings = await AppCommon.api('/ALTApi/settings');
  defaultFeeCents = settings.defaultFeeCents;
  feeInput.value = (defaultFeeCents / 100).toFixed(2);
}

async function loadTherapists() {
  therapists = await AppCommon.api('/ALTApi/users/therapists');

  /* Populate filter dropdown */
  filterTherapistSelect.innerHTML = '<option value="">All therapists</option>';
  therapists.forEach((t) => {
    const opt = document.createElement('option');
    opt.value = String(t.id);
    opt.textContent = t.full_name;
    filterTherapistSelect.appendChild(opt);
  });

  /* Populate form dropdown */
  therapistSelect.innerHTML = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Select a therapist';
  placeholder.disabled = true;
  placeholder.selected = true;
  therapistSelect.appendChild(placeholder);
  therapists.forEach((t) => {
    const opt = document.createElement('option');
    opt.value = String(t.id);
    opt.textContent = t.full_name;
    therapistSelect.appendChild(opt);
  });
}

function buildFilters() {
  const data = new FormData(filterForm);
  const params = new URLSearchParams();

  ['q', 'clientId', 'wireReceived', 'paymentType'].forEach((key) => {
    const value = data.get(key);
    if (value) params.set(key, value);
  });

  if (isAdmin) {
    const therapistId = data.get('userId');
    if (therapistId) params.set('userId', therapistId);
  }

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
  const addrEl = document.getElementById('patient-info-address');
  if (addrEl) {
    addrEl.innerHTML = client.address ? `${client.address} ${AppCommon.mapsLink(client.address)}` : '-';
  }

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
    const colCount = isAdmin ? 6 : 8;
    const tr = document.createElement('tr');
    tr.innerHTML = `<td colspan="${colCount}" class="small">No appointments found.</td>`;
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
      <td>${appointment.location} ${AppCommon.mapsLink(appointment.location)}</td>
      <td>${appointment.duration_minutes}m</td>
      ${!isAdmin ? `<td>${AppCommon.euroFromCents(appointment.fee_cents)}</td>` : ''}
      ${!isAdmin ? `<td><span class="${appointment.wire_received ? 'status-paid' : 'status-owed'}">${appointment.wire_received ? 'PAID' : 'OWED'}</span></td>` : ''}
      ${!isAdmin ? `<td>${appointment.payment_type || '-'}</td>` : ''}
      ${isAdmin ? `<td>${appointment.therapist_name || '-'}</td>` : ''}
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

    if (!isAdmin && !appointment.wire_received && new Date(appointment.appointment_date) <= new Date()) {
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
          await AppCommon.api(`/ALTApi/appointments/${appointment.id}/payment-received`, { method: 'PATCH', body: JSON.stringify({}) });
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

  if (isAdmin) {
    const tId = filterTherapistSelect.value;
    if (tId) {
      const opt = filterTherapistSelect.options[filterTherapistSelect.selectedIndex];
      parts.push(opt.textContent);
    }
  }

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
  currentRows = await AppCommon.api(`/ALTApi/appointments?${params.toString()}`);
  currentPage = 1;
  currentRows.sort(compareRows);
  renderAppointmentsTable(currentRows);
  updateSortLabels();
  updateFilterSummary();
}

async function loadAppointmentById(id) {
  const appointment = await AppCommon.api(`/ALTApi/appointments/${id}`);
  document.getElementById('appointmentId').value = String(appointment.id);
  document.getElementById('clientId').value = String(appointment.client_id);
  if (clientSearchSelect) clientSearchSelect.setValue(appointment.client_id);
  document.getElementById('appointmentDate').value = dateToInputValue(appointment.appointment_date);
  document.getElementById('address').value = appointment.location;
  document.getElementById('durationMinutes').value = String(appointment.duration_minutes || 60);
  document.getElementById('feeAmount').value = (Number(appointment.fee_cents || 0) / 100).toFixed(2);
  document.getElementById('wireReceivedEdit').value = appointment.wire_received ? 'true' : 'false';
  const isFutureAppt = new Date(appointment.appointment_date) > new Date();
  const wireSelect = document.getElementById('wireReceivedEdit');
  if (isFutureAppt) { wireSelect.value = 'false'; wireSelect.disabled = true; }
  else { wireSelect.disabled = false; }
  document.getElementById('paymentType').value = appointment.payment_type || '';
  document.getElementById('comments').value = appointment.comments || appointment.notes || '';
  if (isAdmin && therapistSelect) {
    therapistSelect.value = appointment.user_id ? String(appointment.user_id) : '';
  }
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

  if (isAdmin) {
    const selTherapist = therapistSelect.value;
    if (!selTherapist) {
      AppCommon.setMessage('Please select a therapist.', true);
      return;
    }
    payload.userId = Number(selTherapist);
  }

  try {
    if (id) {
      await AppCommon.api(`/ALTApi/appointments/${id}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      AppCommon.setMessage('Appointment updated.');
      await loadAppointments();
      clearForm();
      setTimeout(closeEditor, 1500);
    } else {
      await AppCommon.api('/ALTApi/appointments', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      AppCommon.setMessage('Appointment created — form ready for another.');
      await loadAppointments();
      // Keep patient, address, fee, therapist — clear date, comments, payment
      document.getElementById('appointmentDate').value = '';
      document.getElementById('comments').value = '';
      document.getElementById('wireReceivedEdit').value = 'false';
      document.getElementById('wireReceivedEdit').disabled = false;
      document.getElementById('paymentType').value = '';
    }
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
    await AppCommon.api(`/ALTApi/appointments/${id}`, { method: 'DELETE' });
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
  if (isAdmin) filterTherapistSelect.value = '';
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

clientSelect.addEventListener('change', () => {
  const addressInput = document.getElementById('address');
  if (!addressInput.value) {
    const client = clientsById.get(Number(clientSelect.value));
    if (client && client.address) addressInput.value = client.address;
  }
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
  const user = AppCommon.getUser();
  isAdmin = user && user.role === 'admin';

  /* Show admin-only UI elements */
  if (isAdmin) {
    therapistFilterWrap.classList.remove('hidden');
    therapistFieldWrap.classList.remove('hidden');
    therapistColHead.classList.remove('hidden');
    document.getElementById('bulk-therapist-field-wrap').classList.remove('hidden');
  }

  const initPromises = [loadClients(), loadSettings()];
  if (isAdmin) initPromises.push(loadTherapists());
  await Promise.all(initPromises);
  clearForm();
  initBulkForm();
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
    const client = clientsById.get(Number(newForId));
    if (client && client.address) document.getElementById('address').value = client.address;
    openEditor('New Appointment');
    AppCommon.setMessage('Ready for a new appointment.');
  }
}

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

/* ── Bulk Add Appointments ── */
let bulkClientSearchSelect = null;

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
  const bulkOverlay = document.getElementById('bulk-overlay');
  const bulkDrawer = document.getElementById('bulk-drawer');
  const closeBulkBtn = document.getElementById('close-bulk');
  const bulkAddBtn = document.getElementById('bulk-add-appointment');

  const bulkDates = [];

  // Populate bulk client select from the main client list
  bulkClientSelect.innerHTML = '<option value="" selected disabled>Select a patient</option>';
  const clients = [...clientsById.values()].sort((a, b) => {
    const aDate = a.last_appointment_date ? new Date(a.last_appointment_date).getTime() : 0;
    const bDate = b.last_appointment_date ? new Date(b.last_appointment_date).getTime() : 0;
    if (bDate !== aDate) return bDate - aDate;
    return a.full_name.localeCompare(b.full_name);
  });

  const items = clients.map((c) => ({
    id: c.id,
    label: c.full_name,
    detail: lastApptLabel(c.last_appointment_date),
  }));

  clients.forEach((c) => {
    const opt = document.createElement('option');
    opt.value = String(c.id);
    opt.textContent = c.full_name;
    bulkClientSelect.appendChild(opt);
  });

  bulkClientSearchSelect = AppCommon.createSearchSelect(bulkClientSelect, items, {
    placeholder: 'Search patient…',
  });

  // Populate bulk therapist select
  if (isAdmin && bulkTherapistSelect) {
    bulkTherapistSelect.innerHTML = '<option value="" selected disabled>Select a therapist</option>';
    const mainTherapist = document.getElementById('therapistId');
    [...mainTherapist.options].forEach((opt) => {
      bulkTherapistSelect.appendChild(opt.cloneNode(true));
    });
  }

  bulkClientSelect.addEventListener('change', () => {
    const clientId = Number(bulkClientSelect.value);
    if (clientId && clientsById.has(clientId)) {
      bulkAddress.value = clientsById.get(clientId).address || '';
    }
  });

  function openBulkDrawer() {
    bulkOverlay.classList.remove('hidden');
    bulkDrawer.classList.remove('hidden');
    requestAnimationFrame(() => {
      bulkOverlay.classList.add('open');
      bulkDrawer.classList.add('open');
      bulkDrawer.setAttribute('aria-hidden', 'false');
    });
  }

  function closeBulkDrawer() {
    bulkOverlay.classList.remove('open');
    bulkDrawer.classList.remove('open');
    bulkDrawer.setAttribute('aria-hidden', 'true');
    setTimeout(() => {
      bulkOverlay.classList.add('hidden');
      bulkDrawer.classList.add('hidden');
    }, 220);
  }

  bulkAddBtn.addEventListener('click', () => {
    openBulkDrawer();
  });

  closeBulkBtn.addEventListener('click', closeBulkDrawer);
  bulkOverlay.addEventListener('click', closeBulkDrawer);

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
      showDialog('Please pick a date and time first.', true);
      return;
    }
    const d = new Date(val);
    const exists = bulkDates.some((existing) => existing.getTime() === d.getTime());
    if (exists) {
      showDialog('That date and time is already in the list.', true);
      return;
    }
    bulkDates.push(d);
    bulkDateInput.value = '';
    renderChips();
  });

  bulkForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (bulkDates.length === 0) {
      showDialog('Please add at least one date before creating.', true);
      return;
    }
    if (!bulkClientSelect.value) {
      showDialog('Please select a patient.', true);
      return;
    }

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

    if (isAdmin) {
      const sel = bulkTherapistSelect.value;
      if (!sel) {
        showDialog('Please select a therapist.', true);
        return;
      }
      payload.userId = Number(sel);
    }

    const fee = bulkFeeInput ? Number(bulkFeeInput.value) : undefined;
    if (fee !== undefined && !Number.isNaN(fee) && bulkFeeInput.value !== '') {
      payload.feeAmount = fee;
    }

    try {
      const result = await AppCommon.api('/ALTApi/appointments/batch', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      bulkDates.length = 0;
      renderChips();
      bulkForm.reset();
      bulkDuration.value = '60';
      if (bulkPaidCheckbox) bulkPaidCheckbox.checked = false;
      if (bulkPaymentTypeSelect) bulkPaymentTypeSelect.value = '';
      if (bulkClientSearchSelect) bulkClientSearchSelect.clear();
      if (bulkTherapistSelect) bulkTherapistSelect.selectedIndex = 0;
      await loadAppointments();
      closeBulkDrawer();
      showDialog(`${result.count} appointment${result.count !== 1 ? 's' : ''} created successfully!`);
    } catch (error) {
      showDialog(error.message, true);
    }
  });
}

AppCommon.ensureAuth(initPage);
