const searchForm = document.getElementById('search-form');
const clearSearchBtn = document.getElementById('clear-search');
const patientsTableBody = document.getElementById('patients-table-body');
const newPatientBtn = document.getElementById('new-patient');
const clientForm = document.getElementById('client-form');

const patientEditorOverlay = document.getElementById('patient-editor-overlay');
const patientEditorDrawer = document.getElementById('patient-editor-drawer');
const patientEditorTitle = document.getElementById('patient-editor-title');
const closePatientEditorBtn = document.getElementById('close-patient-editor');

const commentsSection = document.getElementById('comments-section');
const commentsTableBody = document.getElementById('comments-table-body');
const commentsSearch = document.getElementById('comments-search');
const commentFormWrap = document.getElementById('comment-form-wrap');
const commentForm = document.getElementById('comment-form');
const newCommentBtn = document.getElementById('new-comment-btn');
const cancelCommentBtn = document.getElementById('cancel-comment');

const insuranceSection = document.getElementById('insurance-section');
const insurancesTableBody = document.getElementById('insurances-table-body');
const insuranceFormWrap = document.getElementById('insurance-form-wrap');
const insuranceForm = document.getElementById('insurance-form');
const newInsuranceBtn = document.getElementById('new-insurance-btn');
const cancelInsuranceBtn = document.getElementById('cancel-insurance');
const providerSelect = document.getElementById('providerName');
const customProviderWrap = document.getElementById('custom-provider-wrap');
const customProviderInput = document.getElementById('customProvider');
const nifInput = document.getElementById('nif');
const nifError = document.getElementById('nif-error');

const historyOverlay = document.getElementById('history-overlay');
const historyDrawer = document.getElementById('history-drawer');
const historyTitle = document.getElementById('history-title');
const closeHistoryBtn = document.getElementById('close-history');
const historyInfo = document.getElementById('history-info');
const historyTableBody = document.getElementById('history-table-body');
const historySearch = document.getElementById('history-search');
const newApptBtn = document.getElementById('new-appt-for-patient');
const filterSummary = document.getElementById('patient-filter-summary');

const pager = document.getElementById('patients-pager');
const pagerPrev = document.getElementById('patients-pager-prev');
const pagerNext = document.getElementById('patients-pager-next');
const pagerInfo = document.getElementById('patients-pager-info');

const PAGE_SIZE = 5;
let currentPage = 1;
let allClients = [];
let currentEditClientId = null;
let currentHistoryClientId = null;
let currentHistoryClient = null;
let allHistoryRows = [];
let allComments = [];
let allInsurances = [];

/* ---- NIF validation ---- */
function isValidNIF(nif) {
  if (!nif) return true;
  const cleaned = nif.replace(/\s/g, '');
  if (!/^\d{9}$/.test(cleaned)) return false;
  const d = cleaned.split('').map(Number);
  const sum = d[0]*9 + d[1]*8 + d[2]*7 + d[3]*6 + d[4]*5 + d[5]*4 + d[6]*3 + d[7]*2;
  let remainder = 11 - (sum % 11);
  if (remainder >= 10) remainder = 0;
  return remainder === d[8];
}

nifInput.addEventListener('input', () => {
  const val = nifInput.value.trim();
  if (val && val.length === 9 && !isValidNIF(val)) {
    nifError.classList.remove('hidden');
  } else {
    nifError.classList.add('hidden');
  }
});

/* ---- drawer helpers ---- */
function openDrawer(overlay, drawer) {
  overlay.classList.remove('hidden');
  drawer.classList.remove('hidden');
  requestAnimationFrame(() => {
    overlay.classList.add('open');
    drawer.classList.add('open');
    drawer.setAttribute('aria-hidden', 'false');
  });
}

function closeDrawer(overlay, drawer) {
  overlay.classList.remove('open');
  drawer.classList.remove('open');
  drawer.setAttribute('aria-hidden', 'true');
  setTimeout(() => {
    overlay.classList.add('hidden');
    drawer.classList.add('hidden');
  }, 220);
}

/* ---- pager ---- */
function updatePager() {
  const totalPages = Math.ceil(allClients.length / PAGE_SIZE);
  if (totalPages <= 1) { pager.classList.add('hidden'); return; }
  pager.classList.remove('hidden');
  pagerPrev.disabled = currentPage <= 1;
  pagerNext.disabled = currentPage >= totalPages;
  pagerInfo.textContent = `Page ${currentPage} of ${totalPages}`;
}

/* ---- patient table ---- */
async function loadClients(query = '') {
  const url = query ? `/ALTApi/clients?q=${encodeURIComponent(query)}` : '/ALTApi/clients';
  allClients = await AppCommon.api(url);
  currentPage = 1;
  renderPatientsTable();

  filterSummary.textContent = query ? `(${query})` : '';
}

async function getOwedCents(clientId) {
  const rows = await AppCommon.api(`/ALTApi/clients/${clientId}/appointments`);
  return rows
    .filter((r) => !r.wire_received)
    .reduce((sum, r) => sum + Number(r.fee_cents || 0), 0);
}

function renderPatientsTable() {
  patientsTableBody.innerHTML = '';

  if (!allClients.length) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="5" class="small">No patients found.</td>';
    patientsTableBody.appendChild(tr);
    pager.classList.add('hidden');
    return;
  }

  const totalPages = Math.ceil(allClients.length / PAGE_SIZE);
  if (currentPage > totalPages) currentPage = totalPages;
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageRows = allClients.slice(start, start + PAGE_SIZE);
  updatePager();

  pageRows.forEach((client) => {
    const tr = document.createElement('tr');
    tr.className = 'appt-row';
    tr.tabIndex = 0;
    tr.innerHTML = `
      <td>${client.full_name}</td>
      <td>${client.phone || '-'}</td>
      <td>${client.email || '-'}</td>
      <td class="balance-cell" data-client-id="${client.id}"><span class="small">...</span></td>
      <td>
        <div style="display:flex;gap:6px">
          <button type="button" class="outline tiny-btn edit-btn">Edit</button>
          <button type="button" class="outline tiny-btn history-btn" title="View appointments">&#128197;</button>
        </div>
      </td>
    `;

    tr.querySelector('.edit-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      openEditPatient(client);
    });

    tr.querySelector('.history-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      openPatientDetails(client);
    });

    tr.addEventListener('click', () => openEditPatient(client));
    tr.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEditPatient(client); }
    });

    patientsTableBody.appendChild(tr);

    // async load balance
    getOwedCents(client.id).then((owedCents) => {
      const cell = tr.querySelector('.balance-cell');
      if (owedCents > 0) {
        cell.innerHTML = `<span class="status-owed">${AppCommon.euroFromCents(owedCents)} owed</span>`;
      } else {
        cell.innerHTML = '<span class="status-paid">Clear</span>';
      }
    });
  });
}

/* ---- patient editor drawer (with comments) ---- */
function clearPatientForm() {
  clientForm.reset();
  document.getElementById('editClientId').value = '';
  currentEditClientId = null;
  commentsSection.classList.add('hidden');
  insuranceSection.classList.add('hidden');
  nifError.classList.add('hidden');
}

function openEditPatient(client) {
  currentEditClientId = client.id;
  document.getElementById('editClientId').value = String(client.id);
  document.getElementById('fullName').value = client.full_name;
  document.getElementById('phone').value = client.phone || '';
  document.getElementById('email').value = client.email || '';
  document.getElementById('patientAddress').value = client.address || '';
  document.getElementById('nif').value = client.nif || '';
  document.getElementById('conditionNotes').value = client.condition_notes;
  nifError.classList.add('hidden');
  patientEditorTitle.textContent = 'Edit Patient';
  commentsSection.classList.remove('hidden');
  insuranceSection.classList.remove('hidden');
  openDrawer(patientEditorOverlay, patientEditorDrawer);
  loadComments(client.id);
  loadInsurances(client.id);
}

newPatientBtn.addEventListener('click', () => {
  clearPatientForm();
  patientEditorTitle.textContent = 'New Patient';
  openDrawer(patientEditorOverlay, patientEditorDrawer);
});

closePatientEditorBtn.addEventListener('click', () => closeDrawer(patientEditorOverlay, patientEditorDrawer));
patientEditorOverlay.addEventListener('click', () => closeDrawer(patientEditorOverlay, patientEditorDrawer));

clientForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const id = document.getElementById('editClientId').value;
  const payload = {
    fullName: document.getElementById('fullName').value,
    conditionNotes: document.getElementById('conditionNotes').value,
    phone: document.getElementById('phone').value,
    email: document.getElementById('email').value,
    address: document.getElementById('patientAddress').value,
    nif: document.getElementById('nif').value.trim(),
  };

  if (payload.nif && !isValidNIF(payload.nif)) {
    AppCommon.setMessage('Invalid NIF. Please check the number.', true);
    return;
  }

  try {
    if (id) {
      await AppCommon.api(`/ALTApi/clients/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
      AppCommon.setMessage('Patient updated.');
    } else {
      await AppCommon.api('/ALTApi/clients', { method: 'POST', body: JSON.stringify(payload) });
      AppCommon.setMessage('Patient created.');
    }
    clearPatientForm();
    closeDrawer(patientEditorOverlay, patientEditorDrawer);
    await loadClients(document.getElementById('search').value.trim());
  } catch (error) {
    AppCommon.setMessage(error.message, true);
  }
});

/* ---- comments (inside editor drawer) ---- */
async function loadComments(clientId) {
  allComments = await AppCommon.api(`/ALTApi/clients/${clientId}/comments`);
  commentsSearch.value = '';
  commentFormWrap.classList.add('hidden');
  renderCommentsTable();
}

function renderCommentsTable(filter) {
  commentsTableBody.innerHTML = '';
  const q = (filter || '').toLowerCase();
  const rows = q
    ? allComments.filter((r) =>
        (r.body || '').toLowerCase().includes(q) ||
        (r.comment_date || '').includes(q))
    : allComments;

  if (!rows.length) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td colspan="3" class="small">${q ? 'No matching comments.' : 'No comments yet.'}</td>`;
    commentsTableBody.appendChild(tr);
    return;
  }

  const clientId = currentEditClientId;
  rows.forEach((row) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="white-space:nowrap;vertical-align:top">${row.comment_date}</td>
      <td style="white-space:pre-wrap">${row.body}</td>
      <td></td>
    `;

    const actionsCell = tr.querySelector('td:last-child');
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;gap:4px';

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'outline tiny-btn';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => {
      document.getElementById('commentId').value = String(row.id);
      document.getElementById('commentDate').value = row.comment_date;
      document.getElementById('commentBody').value = row.body;
      commentFormWrap.classList.remove('hidden');
    });

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'outline tiny-btn action-delete';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', async () => {
      if (!window.confirm('Delete this comment?')) return;
      try {
        await AppCommon.api(`/ALTApi/clients/${clientId}/comments/${row.id}`, { method: 'DELETE' });
        AppCommon.setMessage('Comment deleted.');
        await loadComments(clientId);
      } catch (err) {
        AppCommon.setMessage(err.message, true);
      }
    });

    wrap.appendChild(editBtn);
    wrap.appendChild(delBtn);
    actionsCell.appendChild(wrap);
    commentsTableBody.appendChild(tr);
  });
}

commentsSearch.addEventListener('input', () => {
  renderCommentsTable(commentsSearch.value.trim());
});

newCommentBtn.addEventListener('click', () => {
  commentForm.reset();
  document.getElementById('commentId').value = '';
  document.getElementById('commentDate').value = new Date().toISOString().slice(0, 10);
  commentFormWrap.classList.remove('hidden');
});

cancelCommentBtn.addEventListener('click', () => {
  commentFormWrap.classList.add('hidden');
});

commentForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const clientId = currentEditClientId;
  if (!clientId) return;

  const cId = document.getElementById('commentId').value;
  const payload = {
    commentDate: document.getElementById('commentDate').value,
    body: document.getElementById('commentBody').value,
  };

  try {
    if (cId) {
      await AppCommon.api(`/ALTApi/clients/${clientId}/comments/${cId}`, {
        method: 'PUT', body: JSON.stringify(payload),
      });
      AppCommon.setMessage('Comment updated.');
    } else {
      await AppCommon.api(`/ALTApi/clients/${clientId}/comments`, {
        method: 'POST', body: JSON.stringify(payload),
      });
      AppCommon.setMessage('Comment added.');
    }
    commentForm.reset();
    commentFormWrap.classList.add('hidden');
    await loadComments(clientId);
  } catch (error) {
    AppCommon.setMessage(error.message, true);
  }
});

/* ---- insurance section (inside editor drawer) ---- */
async function loadInsurances(clientId) {
  allInsurances = await AppCommon.api(`/ALTApi/clients/${clientId}/insurances`);
  insuranceFormWrap.classList.add('hidden');
  renderInsurancesTable();
}

function renderInsurancesTable() {
  insurancesTableBody.innerHTML = '';

  if (!allInsurances.length) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="4" class="small">No insurances registered.</td>';
    insurancesTableBody.appendChild(tr);
    return;
  }

  const clientId = currentEditClientId;
  allInsurances.forEach((row) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${row.insurance_name}</td>
      <td>${row.provider_name}</td>
      <td>${row.policy_number || '—'}</td>
      <td></td>
    `;

    const actionsCell = tr.querySelector('td:last-child');
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;gap:4px';

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'outline tiny-btn';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => {
      document.getElementById('insuranceId').value = String(row.id);
      document.getElementById('insuranceName').value = row.insurance_name;
      document.getElementById('policyNumber').value = row.policy_number || '';
      // Set provider dropdown
      const knownProviders = ['ADSE'];
      if (knownProviders.includes(row.provider_name)) {
        providerSelect.value = row.provider_name;
        customProviderWrap.classList.add('hidden');
        customProviderInput.value = '';
      } else {
        providerSelect.value = 'other';
        customProviderWrap.classList.remove('hidden');
        customProviderInput.value = row.provider_name;
      }
      insuranceFormWrap.classList.remove('hidden');
    });

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'outline tiny-btn action-delete';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', async () => {
      if (!window.confirm('Delete this insurance?')) return;
      try {
        await AppCommon.api(`/ALTApi/clients/${clientId}/insurances/${row.id}`, { method: 'DELETE' });
        AppCommon.setMessage('Insurance deleted.');
        await loadInsurances(clientId);
      } catch (err) {
        AppCommon.setMessage(err.message, true);
      }
    });

    wrap.appendChild(editBtn);
    wrap.appendChild(delBtn);
    actionsCell.appendChild(wrap);
    insurancesTableBody.appendChild(tr);
  });
}

providerSelect.addEventListener('change', () => {
  if (providerSelect.value === 'other') {
    customProviderWrap.classList.remove('hidden');
    customProviderInput.required = true;
  } else {
    customProviderWrap.classList.add('hidden');
    customProviderInput.required = false;
    customProviderInput.value = '';
  }
});

newInsuranceBtn.addEventListener('click', () => {
  insuranceForm.reset();
  document.getElementById('insuranceId').value = '';
  customProviderWrap.classList.add('hidden');
  customProviderInput.required = false;
  insuranceFormWrap.classList.remove('hidden');
});

cancelInsuranceBtn.addEventListener('click', () => {
  insuranceFormWrap.classList.add('hidden');
});

insuranceForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const clientId = currentEditClientId;
  if (!clientId) return;

  const iId = document.getElementById('insuranceId').value;
  const providerValue = providerSelect.value === 'other'
    ? customProviderInput.value.trim()
    : providerSelect.value;

  if (!providerValue) {
    AppCommon.setMessage('Please enter a provider name.', true);
    return;
  }

  const payload = {
    insuranceName: document.getElementById('insuranceName').value.trim(),
    policyNumber: document.getElementById('policyNumber').value.trim(),
    providerName: providerValue,
  };

  try {
    if (iId) {
      await AppCommon.api(`/ALTApi/clients/${clientId}/insurances/${iId}`, {
        method: 'PUT', body: JSON.stringify(payload),
      });
      AppCommon.setMessage('Insurance updated.');
    } else {
      await AppCommon.api(`/ALTApi/clients/${clientId}/insurances`, {
        method: 'POST', body: JSON.stringify(payload),
      });
      AppCommon.setMessage('Insurance added.');
    }
    insuranceForm.reset();
    insuranceFormWrap.classList.add('hidden');
    customProviderWrap.classList.add('hidden');
    await loadInsurances(clientId);
  } catch (error) {
    AppCommon.setMessage(error.message, true);
  }
});

/* ---- appointments drawer ---- */
async function openPatientDetails(client) {
  currentHistoryClientId = client.id;
  currentHistoryClient = client;
  historyTitle.textContent = `${client.full_name} — Appointments`;
  historySearch.value = '';
  openDrawer(historyOverlay, historyDrawer);
  await loadHistory(client.id);
}

closeHistoryBtn.addEventListener('click', () => closeDrawer(historyOverlay, historyDrawer));
historyOverlay.addEventListener('click', () => closeDrawer(historyOverlay, historyDrawer));

async function loadHistory(clientId) {
  allHistoryRows = await AppCommon.api(`/ALTApi/clients/${clientId}/appointments`);
  renderHistoryInfo();
  renderHistoryTable();
}

function renderHistoryInfo() {
  const client = currentHistoryClient;
  const rows = allHistoryRows;
  const total = rows.length;
  const totalFee = rows.reduce((s, r) => s + Number(r.fee_cents || 0), 0);
  const paid = rows.filter((r) => r.wire_received).length;
  const owed = total - paid;
  const paidFee = rows.filter((r) => r.wire_received).reduce((s, r) => s + Number(r.fee_cents || 0), 0);
  const owedFee = totalFee - paidFee;

  historyInfo.innerHTML = `
    <div class="info-row"><span class="info-label">Phone</span><span class="info-value">${client.phone || '—'}</span></div>
    <div class="info-row"><span class="info-label">Email</span><span class="info-value">${client.email || '—'}</span></div>
    <div class="info-row"><span class="info-label">Address</span><span class="info-value">${client.address ? `${client.address} ${AppCommon.mapsLink(client.address)}` : '—'}</span></div>
    <div class="info-row"><span class="info-label">NIF</span><span class="info-value">${client.nif || '—'}</span></div>
    <div class="info-row"><span class="info-label">Condition</span><span class="info-value">${client.condition_notes || '—'}</span></div>
    <div class="info-kpis">
      <div class="info-kpi"><span class="info-kpi-val">${total}</span><span class="info-kpi-lbl">Appointments</span></div>
      <div class="info-kpi"><span class="info-kpi-val status-paid">${paid}</span><span class="info-kpi-lbl">Paid</span></div>
      <div class="info-kpi"><span class="info-kpi-val status-owed">${owed}</span><span class="info-kpi-lbl">Owed</span></div>
      <div class="info-kpi"><span class="info-kpi-val">${AppCommon.euroFromCents(totalFee)}</span><span class="info-kpi-lbl">Total</span></div>
      <div class="info-kpi"><span class="info-kpi-val status-paid">${AppCommon.euroFromCents(paidFee)}</span><span class="info-kpi-lbl">Paid</span></div>
      <div class="info-kpi"><span class="info-kpi-val status-owed">${AppCommon.euroFromCents(owedFee)}</span><span class="info-kpi-lbl">Owed</span></div>
    </div>
  `;
}

function renderHistoryTable(filter) {
  historyTableBody.innerHTML = '';
  const q = (filter || '').toLowerCase();
  const rows = q
    ? allHistoryRows.filter((r) =>
        (r.location || '').toLowerCase().includes(q) ||
        new Date(r.appointment_date).toLocaleString('en-GB').toLowerCase().includes(q) ||
        (r.payment_type || '').toLowerCase().includes(q))
    : allHistoryRows;

  if (!rows.length) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="6" class="small">No appointments found.</td>';
    historyTableBody.appendChild(tr);
    return;
  }

  rows.forEach((row) => {
    const tr = document.createElement('tr');
    const statusClass = row.wire_received ? 'status-paid' : 'status-owed';
    const statusLabel = row.wire_received ? 'PAID' : 'OWED';
    const payType = row.payment_type ? ` (${row.payment_type})` : '';
    tr.innerHTML = `
      <td>${new Date(row.appointment_date).toLocaleString('en-GB')}</td>
      <td class="small">${row.location} ${AppCommon.mapsLink(row.location)}</td>
      <td>${row.duration_minutes}m</td>
      <td>${AppCommon.euroFromCents(row.fee_cents)}</td>
      <td><span class="${statusClass}">${statusLabel}${payType}</span></td>
      <td></td>
    `;

    const actionsCell = tr.querySelector('td:last-child');
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;gap:4px;align-items:center';

    if (!row.wire_received && new Date(row.appointment_date) <= new Date()) {
      const payBtn = document.createElement('button');
      payBtn.type = 'button';
      payBtn.className = 'outline tiny-btn';
      payBtn.textContent = '✓ Paid';
      payBtn.style.color = 'var(--ok)';
      payBtn.style.borderColor = 'var(--ok)';
      payBtn.addEventListener('click', async () => {
        const ok = await AppCommon.confirmPayment({
          name: row.full_name,
          date: new Date(row.appointment_date).toLocaleString('en-GB'),
          fee: AppCommon.euroFromCents(row.fee_cents),
        });
        if (!ok) return;
        try {
          await AppCommon.api(`/ALTApi/appointments/${row.id}/payment-received`, { method: 'PATCH' });
          AppCommon.setMessage('Payment marked as received.');
          await loadHistory(currentHistoryClientId);
        } catch (err) {
          AppCommon.setMessage(err.message, true);
        }
      });
      wrap.appendChild(payBtn);
    }

    const editLink = document.createElement('a');
    editLink.href = `/appointments.html?id=${row.id}`;
    editLink.textContent = 'Edit';
    editLink.className = 'patient-registry-link';
    wrap.appendChild(editLink);

    actionsCell.appendChild(wrap);
    historyTableBody.appendChild(tr);
  });
}

historySearch.addEventListener('input', () => {
  renderHistoryTable(historySearch.value.trim());
});

newApptBtn.addEventListener('click', () => {
  if (currentHistoryClientId) {
    window.location.href = `/appointments.html?newFor=${currentHistoryClientId}`;
  }
});

/* ---- search / pager ---- */
searchForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await loadClients(document.getElementById('search').value.trim());
  } catch (error) {
    AppCommon.setMessage(error.message, true);
  }
});

clearSearchBtn.addEventListener('click', async () => {
  searchForm.reset();
  try {
    await loadClients();
    AppCommon.setMessage('Search cleared.');
  } catch (error) {
    AppCommon.setMessage(error.message, true);
  }
});

pagerPrev.addEventListener('click', () => {
  if (currentPage > 1) { currentPage -= 1; renderPatientsTable(); }
});

pagerNext.addEventListener('click', () => {
  const totalPages = Math.ceil(allClients.length / PAGE_SIZE);
  if (currentPage < totalPages) { currentPage += 1; renderPatientsTable(); }
});

/* ---- duplicate detection (admin only) ---- */
async function checkDuplicates() {
  const banner = document.getElementById('duplicates-banner');
  const details = document.getElementById('duplicates-details');
  const toggleBtn = document.getElementById('toggle-duplicates');
  if (!banner) return;

  try {
    const data = await AppCommon.api('/ALTApi/clients/duplicates');
    const nifDups = data.nifDuplicates || [];
    const nameDups = data.nameDuplicates || [];

    if (nifDups.length === 0 && nameDups.length === 0) {
      banner.classList.add('hidden');
      return;
    }

    banner.classList.remove('hidden');

    let html = '';
    if (nifDups.length) {
      html += '<div style="margin-bottom:6px"><strong>Same NIF:</strong></div><ul style="margin:0 0 8px 16px;padding:0">';
      nifDups.forEach(d => {
        html += `<li>"${d.name1}" (${d.therapist1 || 'unassigned'}) and "${d.name2}" (${d.therapist2 || 'unassigned'}) — NIF ${d.nif}</li>`;
      });
      html += '</ul>';
    }
    if (nameDups.length) {
      html += '<div style="margin-bottom:6px"><strong>Same Name:</strong></div><ul style="margin:0 0 0 16px;padding:0">';
      nameDups.forEach(d => {
        const nifInfo = d.nif1 || d.nif2 ? ` (NIF: ${d.nif1 || '—'} / ${d.nif2 || '—'})` : '';
        html += `<li>"${d.name1}" (${d.therapist1 || 'unassigned'}) and "${d.name2}" (${d.therapist2 || 'unassigned'})${nifInfo}</li>`;
      });
      html += '</ul>';
    }
    details.innerHTML = html;

    toggleBtn.addEventListener('click', () => {
      details.classList.toggle('hidden');
      toggleBtn.textContent = details.classList.contains('hidden') ? 'Details' : 'Hide';
    });
  } catch (_) {
    // Not admin or endpoint error — hide banner
    banner.classList.add('hidden');
  }
}

/* ---- init ---- */
AppCommon.ensureAuth(async () => {
  await loadClients();
  checkDuplicates();
});
