(function initUsers() {
  const { api, setMessage, getUser } = window.AppCommon;

  const addForm = document.getElementById('add-user-form');
  const nameInput = document.getElementById('newFullName');
  const usernameInput = document.getElementById('newUsername');
  const phoneInput = document.getElementById('newPhone');

  const usersTableBody = document.getElementById('users-table-body');

  const editorOverlay = document.getElementById('user-editor-overlay');
  const editorDrawer = document.getElementById('user-editor-drawer');
  const closeEditorBtn = document.getElementById('close-user-editor');
  const editForm = document.getElementById('edit-user-form');
  const editUserId = document.getElementById('editUserId');
  const editFullName = document.getElementById('editFullName');
  const editUsername = document.getElementById('editUsername');
  const editPhone = document.getElementById('editPhone');
  const editRole = document.getElementById('editRole');
  const blockBtn = document.getElementById('block-user-btn');

  let allUsers = [];
  let usernameManuallyEdited = false;

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /* ---- username auto-generation ---- */
  function generateUsername(fullName) {
    const parts = fullName.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '';
    if (parts.length === 1) return parts[0];
    return parts[0] + parts[parts.length - 1];
  }

  nameInput.addEventListener('input', () => {
    if (!usernameManuallyEdited) {
      usernameInput.value = generateUsername(nameInput.value);
    }
  });

  usernameInput.addEventListener('input', () => {
    usernameManuallyEdited = usernameInput.value.length > 0;
  });

  usernameInput.addEventListener('focus', () => {
    usernameManuallyEdited = true;
  });

  /* ---- phone validation ---- */
  function validatePhone(input) {
    const val = input.value.trim();
    if (!val) { input.setCustomValidity(''); return true; }
    const valid = /^\+?[0-9\s\-]{7,20}$/.test(val);
    input.setCustomValidity(valid ? '' : 'Enter a valid phone number (e.g. +351 912 345 678)');
    return valid;
  }

  phoneInput.addEventListener('input', () => validatePhone(phoneInput));
  editPhone.addEventListener('input', () => validatePhone(editPhone));

  /* ---- drawer helpers ---- */
  function openDrawer() {
    editorOverlay.classList.remove('hidden');
    editorDrawer.classList.remove('hidden');
    requestAnimationFrame(() => {
      editorOverlay.classList.add('open');
      editorDrawer.classList.add('open');
      editorDrawer.setAttribute('aria-hidden', 'false');
    });
  }

  function closeDrawer() {
    editorOverlay.classList.remove('open');
    editorDrawer.classList.remove('open');
    editorDrawer.setAttribute('aria-hidden', 'true');
    setTimeout(() => {
      editorOverlay.classList.add('hidden');
      editorDrawer.classList.add('hidden');
    }, 220);
  }

  closeEditorBtn.addEventListener('click', closeDrawer);
  editorOverlay.addEventListener('click', closeDrawer);

  /* ---- load & render ---- */
  async function loadUsers() {
    try {
      allUsers = await api('/ALTApi/users');
    } catch (err) {
      setMessage(err.message, true);
      allUsers = [];
    }
    renderTable();
  }

  function renderTable() {
    usersTableBody.innerHTML = '';

    if (!allUsers.length) {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td colspan="8" class="small">No users found.</td>';
      usersTableBody.appendChild(tr);
      return;
    }

    const currentUserId = getUser()?.id;

    allUsers.forEach((user) => {
      const tr = document.createElement('tr');
      tr.className = 'appt-row';
      tr.tabIndex = 0;

      const roleBadge = user.role === 'admin'
        ? '<span style="color:var(--accent);font-weight:700">Admin</span>'
        : '<span style="color:var(--muted)">Therapist</span>';

      const statusBadge = user.blocked
        ? '<span style="color:var(--error);font-weight:700">Blocked</span>'
        : '<span class="status-paid">Active</span>';

      const created = user.created_at ? user.created_at.slice(0, 10) : '';
      const lastLogin = user.last_login
        ? new Date(user.last_login).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
        : 'Never';

      tr.innerHTML = `
        <td>${escapeHtml(user.full_name)}</td>
        <td>${escapeHtml(user.username)}</td>
        <td>${roleBadge}</td>
        <td>${escapeHtml(user.phone || '-')}</td>
        <td>${statusBadge}</td>
        <td class="small">${lastLogin}</td>
        <td class="small">${created}</td>
      `;

      if (user.blocked) tr.style.opacity = '0.6';

      const openForEdit = () => {
        editUserId.value = user.id;
        editFullName.value = user.full_name;
        editUsername.value = user.username;
        editPhone.value = user.phone || '';
        editRole.value = user.role;
        if (user.id === currentUserId) {
          blockBtn.style.display = 'none';
        } else {
          blockBtn.style.display = '';
          blockBtn.textContent = user.blocked ? 'Unblock User' : 'Block User';
          blockBtn.className = user.blocked
            ? 'action-create-blue'
            : 'outline action-delete';
        }
        openDrawer();
      };

      tr.addEventListener('click', openForEdit);
      tr.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openForEdit(); }
      });

      const actionTd = document.createElement('td');
      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'outline tiny-btn';
      editBtn.textContent = 'Edit';
      editBtn.addEventListener('click', (e) => { e.stopPropagation(); openForEdit(); });
      actionTd.appendChild(editBtn);
      tr.appendChild(actionTd);
      usersTableBody.appendChild(tr);
    });
  }

  /* ---- create user ---- */
  addForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!validatePhone(phoneInput)) return;

    const fd = new FormData(addForm);
    try {
      await api('/ALTApi/users', {
        method: 'POST',
        body: JSON.stringify({
          fullName: fd.get('fullName'),
          username: fd.get('username'),
          password: fd.get('password'),
          phone: fd.get('phone') || null,
          role: fd.get('role'),
        }),
      });
      addForm.reset();
      usernameManuallyEdited = false;
      setMessage('User created.');
      await loadUsers();
    } catch (err) {
      setMessage(err.message, true);
    }
  });

  /* ---- edit user ---- */
  editForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!validatePhone(editPhone)) return;

    const userId = Number(editUserId.value);
    const fd = new FormData(editForm);
    try {
      await api(`/ALTApi/users/${userId}`, {
        method: 'PUT',
        body: JSON.stringify({
          fullName: fd.get('fullName'),
          phone: fd.get('phone') || null,
          role: fd.get('role'),
          password: fd.get('password') || undefined,
        }),
      });
      closeDrawer();
      setMessage('User updated.');
      await loadUsers();
    } catch (err) {
      setMessage(err.message, true);
    }
  });

  /* ---- block / unblock user ---- */
  blockBtn.addEventListener('click', async () => {
    const userId = Number(editUserId.value);
    const user = allUsers.find((u) => u.id === userId);
    if (!user) return;
    const willBlock = !user.blocked;
    const action = willBlock ? 'block' : 'unblock';
    if (!confirm(`${willBlock ? 'Block' : 'Unblock'} user "${user.full_name}"?`)) return;

    try {
      await api(`/ALTApi/users/${userId}/block`, {
        method: 'PATCH',
        body: JSON.stringify({ blocked: willBlock }),
      });
      closeDrawer();
      setMessage(`User ${action}ed.`);
      await loadUsers();
    } catch (err) {
      setMessage(err.message, true);
    }
  });

  /* ---- bootstrap ---- */
  window.AppCommon.ensureAuth(async () => {
    const user = getUser();
    if (!user || user.role !== 'admin') {
      document.getElementById('app-content').innerHTML =
        '<section class="card"><h2>Access Denied</h2><p>Admin access required.</p></section>';
      return;
    }
    await loadUsers();
  });
})();
