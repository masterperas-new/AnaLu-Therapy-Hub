(function initCommon() {
  const messageEl = document.getElementById('message');
  const loginView = document.getElementById('login-view');
  const appView = document.getElementById('app-content');

  let currentUser = null;

  function setMessage(text, isError = false) {
    if (!messageEl) return;
    messageEl.textContent = text;
    messageEl.className = isError ? 'message error' : 'message';
  }

  async function api(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({ error: 'Request failed.' }));
      throw new Error(data.error || 'Request failed.');
    }

    if (response.status === 204) return null;
    return response.json();
  }

  function euroFromCents(cents) {
    return new Intl.NumberFormat('en-IE', {
      style: 'currency',
      currency: 'EUR',
    }).format(Number(cents || 0) / 100);
  }

  function setAuthenticated(authenticated) {
    if (loginView) loginView.classList.toggle('hidden', authenticated);
    if (appView) appView.classList.toggle('hidden', !authenticated);
    const nav = document.querySelector('.main-nav');
    if (nav) nav.classList.toggle('hidden', !authenticated);
    const userStatus = document.getElementById('user-status');
    if (userStatus) userStatus.classList.toggle('hidden', !authenticated);
    if (authenticated) {
      updateUserStatus();
    } else {
      stopClock();
    }
  }

  let clockInterval = null;

  const THEMES = ['light-green', 'light-blue', 'dark-green', 'dark-blue'];
  const THEME_LABELS = { 'light-green': 'Light Green', 'light-blue': 'Light Blue', 'dark-green': 'Dark Green', 'dark-blue': 'Dark Blue' };

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    document.querySelectorAll('.theme-swatch').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.theme === theme);
    });
  }

  function loadTheme() {
    if (currentUser && currentUser.theme && THEMES.includes(currentUser.theme)) {
      applyTheme(currentUser.theme);
      return;
    }
    const defaultTheme = 'light-blue';
    applyTheme(defaultTheme);
  }

  function setTheme(theme) {
    applyTheme(theme);
    if (currentUser) {
      currentUser.theme = theme;
      api(`/ALTApi/users/${currentUser.id}/theme`, {
        method: 'PATCH',
        body: JSON.stringify({ theme }),
      }).catch(() => {});
    }
  }

  function updateUserStatus() {
    const userStatus = document.getElementById('user-status');
    if (!userStatus || !currentUser) return;
    const isAdmin = currentUser.role === 'admin';
    userStatus.innerHTML =
      `<span id="env-badge" class="env-badge"></span><a href="/profile.html" class="user-name">${currentUser.fullName}</a>` +
      `<div class="user-role">${currentUser.role}</div>` +
      `<div class="user-clock" id="live-clock"></div>` +
      `<button type="button" class="logout-btn">Logout</button>`;
    userStatus.querySelector('.logout-btn').addEventListener('click', async () => {
      try {
        await api('/ALTApi/auth/logout', { method: 'POST' });
        currentUser = null;
        setAuthenticated(false);
        setMessage('Logged out.');
      } catch (error) {
        setMessage(error.message, true);
      }
    });
    
    loadTheme();
    startClock();
  }

  function startClock() {
    tickClock();
    if (clockInterval) clearInterval(clockInterval);
    clockInterval = setInterval(tickClock, 60000);
  }

  function stopClock() {
    if (clockInterval) { clearInterval(clockInterval); clockInterval = null; }
  }

  function tickClock() {
    const el = document.getElementById('live-clock');
    if (!el) return;
    const now = new Date();
    const date = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const time = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    el.textContent = `${date}  ${time}`;
  }

  function updateNavForRole() {
    if (!currentUser) return;
    document.querySelectorAll('[data-admin-only]').forEach((el) => {
      el.style.display = currentUser.role === 'admin' ? '' : 'none';
    });
    document.querySelectorAll('[data-therapist-only]').forEach((el) => {
      el.style.display = currentUser.role === 'therapist' ? '' : 'none';
    });
  }

  async function loadEnvironmentBadge() {
    try {
      const env = await api('/ALTApi/auth/environment');
      // Try login screen badge first
      let badge = document.getElementById('login-env-badge');
      if (badge) {
        badge.textContent = `${env.environment.toUpperCase()}: ${env.database.toUpperCase()}`;
        badge.className = `login-env-badge login-env-${env.environment}`;
      }
      // Also update user status badge
      badge = document.getElementById('env-badge');
      if (badge) {
        badge.innerHTML = `${env.environment.toUpperCase()}: ${env.database.toUpperCase()}`;
        badge.className = `env-badge env-${env.environment}`;
      }
    } catch (_) {
      // Silently fail if endpoint unavailable
    }
  }

  async function ensureAuth(onAuthenticated) {
    const loginForm = document.getElementById('login-form');

    if (loginForm) {
      loginForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const formData = new FormData(loginForm);

        try {
          const result = await api('/ALTApi/auth/login', {
            method: 'POST',
            body: JSON.stringify({
              username: formData.get('username'),
              password: formData.get('password'),
            }),
          });

          currentUser = result.user;
          loginForm.reset();
          setAuthenticated(true);
          updateNavForRole();
          await loadEnvironmentBadge();
          await onAuthenticated();
          setMessage(`Logged in as ${currentUser.fullName}.`);
        } catch (error) {
          setMessage(error.message, true);
        }
      });
    }

    document.querySelectorAll('.main-nav a').forEach((link) => {
      if (link.pathname === window.location.pathname) {
        link.classList.add('active');
      }
    });

    try {
      const session = await api('/ALTApi/auth/session');
      if (session.authenticated && session.user) {
        currentUser = session.user;
        setAuthenticated(true);
        updateNavForRole();
        await loadEnvironmentBadge();
        try {
          await onAuthenticated();
        } catch (appErr) {
          setMessage(appErr.message, true);
        }
      } else {
        setAuthenticated(false);
      }
    } catch (_error) {
      setAuthenticated(false);
    }
  }

  function confirmPayment({ name, date, fee }) {
    return new Promise((resolve) => {
      let overlay = document.getElementById('confirm-overlay');
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'confirm-overlay';
        overlay.className = 'confirm-overlay';
        overlay.innerHTML = `
          <div class="confirm-box">
            <h3>Confirm Payment</h3>
            <div class="confirm-details"></div>
            <div class="confirm-actions">
              <button type="button" class="confirm-cancel">Cancel</button>
              <button type="button" class="confirm-ok">Mark as Paid</button>
            </div>
          </div>`;
        document.body.appendChild(overlay);
      }

      const details = overlay.querySelector('.confirm-details');
      details.innerHTML = `
        <p><strong>${name}</strong></p>
        <p>${date}</p>
        <p>${fee}</p>`;

      overlay.classList.add('open');

      function close(result) {
        overlay.classList.remove('open');
        overlay.querySelector('.confirm-ok').removeEventListener('click', onOk);
        overlay.querySelector('.confirm-cancel').removeEventListener('click', onCancel);
        overlay.removeEventListener('click', onBackdrop);
        resolve(result);
      }

      function onOk() { close(true); }
      function onCancel() { close(false); }
      function onBackdrop(e) { if (e.target === overlay) close(false); }

      overlay.querySelector('.confirm-ok').addEventListener('click', onOk);
      overlay.querySelector('.confirm-cancel').addEventListener('click', onCancel);
      overlay.addEventListener('click', onBackdrop);
    });
  }

  function mapsLink(address) {
    if (!address) return '';
    const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
    return `<a href="${url}" target="_blank" rel="noopener noreferrer" title="Open in Google Maps" class="maps-link">\uD83D\uDCCD</a>`;
  }

  
  async function loadVersionInfo() {
    try {
      const response = await fetch('/version.json');
      const data = await response.json();
      
      // Fetch build count
      let buildCount = 0;
      try {
        const buildRes = await fetch('/ALTApi/auth/build-info');
        if (buildRes.ok) {
          const buildData = await buildRes.json();
          buildCount = buildData.buildCount || 0;
        }
      } catch (_) {}
      
      const versionBadge = document.getElementById('login-version');
      if (versionBadge) {
        const displayVersion = buildCount > 0 ? `v${data.version}.${buildCount}` : `v${data.version}`;
        versionBadge.textContent = displayVersion;
      }
    } catch (_) {
      // Silently fail
    }
  }


  // Initialize login screen info on page load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', async () => {
      loadVersionInfo();
      loadEnvironmentBadge();
    });
  } else {
    // Already loaded
    loadVersionInfo();
    loadEnvironmentBadge();
  }



  function attachPasswordStrength(input) {
    const wrap = document.createElement('div');
    wrap.innerHTML = '<div class="pwd-strength"><div class="pwd-strength-bar" data-level="0"></div></div><div class="pwd-strength-label"></div>';
    input.parentNode.insertBefore(wrap, input.nextSibling);
    const bar = wrap.querySelector('.pwd-strength-bar');
    const label = wrap.querySelector('.pwd-strength-label');
    const labels = ['', 'Weak', 'Fair', 'Good', 'Strong'];

    input.addEventListener('input', () => {
      const v = input.value;
      let score = 0;
      if (v.length >= 4) score++;
      if (v.length >= 8) score++;
      if (/[A-Z]/.test(v) && /[a-z]/.test(v)) score++;
      if (/[0-9]/.test(v) && /[^A-Za-z0-9]/.test(v)) score++;
      bar.setAttribute('data-level', v.length === 0 ? '0' : String(score));
      label.textContent = v.length === 0 ? '' : labels[score];
    });
  }

  /**
   * Replace a <select> with a searchable dropdown.
   * items: [{ id, label, detail? }]  — detail is optional secondary text
   * Returns { setValue(id), getValue(), setItems(items) }
   */
  function createSearchSelect(selectEl, items, { placeholder = 'Search…', onChange } = {}) {
    const wrapper = document.createElement('div');
    wrapper.className = 'search-select';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'search-select-input';
    input.placeholder = placeholder;
    input.autocomplete = 'off';

    const dropdown = document.createElement('div');
    dropdown.className = 'search-select-dropdown';

    wrapper.appendChild(input);
    wrapper.appendChild(dropdown);
    selectEl.style.display = 'none';
    selectEl.parentNode.insertBefore(wrapper, selectEl.nextSibling);

    let currentItems = items || [];
    let selectedId = '';
    let highlightIdx = -1;

    function renderDropdown(filter) {
      dropdown.innerHTML = '';
      highlightIdx = -1;
      const q = (filter || '').toLowerCase();
      const filtered = currentItems.filter((it) => it.label.toLowerCase().includes(q));
      if (!filtered.length) {
        const empty = document.createElement('div');
        empty.className = 'search-select-empty';
        empty.textContent = 'No patients found';
        dropdown.appendChild(empty);
        return;
      }
      filtered.forEach((item, idx) => {
        const opt = document.createElement('div');
        opt.className = 'search-select-option';
        opt.dataset.id = item.id;
        const name = document.createElement('span');
        name.className = 'ss-name';
        name.textContent = item.label;
        opt.appendChild(name);
        if (item.detail) {
          const det = document.createElement('span');
          det.className = 'ss-detail';
          det.textContent = item.detail;
          opt.appendChild(det);
        }
        opt.addEventListener('mousedown', (e) => {
          e.preventDefault();
          pick(item);
        });
        dropdown.appendChild(opt);
      });
    }

    function pick(item) {
      selectedId = String(item.id);
      selectEl.value = selectedId;
      input.value = item.label;
      wrapper.classList.remove('open');
      selectEl.dispatchEvent(new Event('change'));
      if (onChange) onChange(selectedId);
    }

    function open() {
      renderDropdown(selectedId ? '' : input.value);
      wrapper.classList.add('open');
    }

    input.addEventListener('focus', () => {
      input.select();
      open();
    });

    input.addEventListener('input', () => {
      selectedId = '';
      selectEl.value = '';
      renderDropdown(input.value);
      wrapper.classList.add('open');
    });

    input.addEventListener('blur', () => {
      setTimeout(() => {
        wrapper.classList.remove('open');
        if (selectedId) {
          const item = currentItems.find((it) => String(it.id) === selectedId);
          input.value = item ? item.label : '';
        } else {
          input.value = '';
        }
      }, 150);
    });

    input.addEventListener('keydown', (e) => {
      const opts = dropdown.querySelectorAll('.search-select-option');
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        highlightIdx = Math.min(highlightIdx + 1, opts.length - 1);
        opts.forEach((o, i) => o.classList.toggle('highlighted', i === highlightIdx));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        highlightIdx = Math.max(highlightIdx - 1, 0);
        opts.forEach((o, i) => o.classList.toggle('highlighted', i === highlightIdx));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (highlightIdx >= 0 && highlightIdx < opts.length) {
          const id = opts[highlightIdx].dataset.id;
          const item = currentItems.find((it) => String(it.id) === id);
          if (item) pick(item);
        }
      } else if (e.key === 'Escape') {
        wrapper.classList.remove('open');
        input.blur();
      }
    });

    function setValue(id) {
      selectedId = id ? String(id) : '';
      const item = currentItems.find((it) => String(it.id) === selectedId);
      input.value = item ? item.label : '';
      selectEl.value = selectedId;
    }

    function getValue() {
      return selectedId;
    }

    function setItems(newItems) {
      currentItems = newItems || [];
      if (selectedId) {
        const item = currentItems.find((it) => String(it.id) === selectedId);
        input.value = item ? item.label : '';
      }
    }

    function clear() {
      selectedId = '';
      input.value = '';
      selectEl.value = '';
    }

    return { setValue, getValue, setItems, clear, input };
  }

  /**
   * Export tabular data to an .xls file (XML Spreadsheet 2003 format).
   * @param {string} filename - e.g. "revenue-clients.xls"
   * @param {string[]} headers - column headers
   * @param {Array<Array<string|number>>} rows - 2D array of cell values
   * @param {string} [title] - optional title row displayed above headers
   */
  function exportToXls(filename, headers, rows, title) {
    const esc = (v) => String(v != null ? v : '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const colCount = headers.length;

    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<?mso-application progid="Excel.Sheet"?>\n';
    xml += '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"';
    xml += ' xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">\n';
    xml += '<Styles>\n';
    xml += '  <Style ss:ID="title"><Font ss:Bold="1" ss:Size="12"/></Style>\n';
    xml += '  <Style ss:ID="header"><Font ss:Bold="1"/><Interior ss:Color="#F0F0F0" ss:Pattern="Solid"/></Style>\n';
    xml += '  <Style ss:ID="Default" ss:Name="Normal"><Font ss:Size="10"/></Style>\n';
    xml += '</Styles>\n';
    xml += '<Worksheet ss:Name="Sheet1">\n<Table>\n';

    if (title) {
      xml += `<Row><Cell ss:StyleID="title" ss:MergeAcross="${colCount - 1}"><Data ss:Type="String">${esc(title)}</Data></Cell></Row>\n`;
      xml += '<Row></Row>\n';
    }

    xml += '<Row>';
    headers.forEach(h => { xml += `<Cell ss:StyleID="header"><Data ss:Type="String">${esc(h)}</Data></Cell>`; });
    xml += '</Row>\n';

    rows.forEach(row => {
      xml += '<Row>';
      row.forEach(cell => {
        const val = cell != null ? cell : '';
        const isNum = typeof val === 'number' || (typeof val === 'string' && /^\d+(\.\d+)?$/.test(val.trim()) && val.trim() !== '');
        if (isNum) {
          xml += `<Cell><Data ss:Type="Number">${val}</Data></Cell>`;
        } else {
          xml += `<Cell><Data ss:Type="String">${esc(val)}</Data></Cell>`;
        }
      });
      xml += '</Row>\n';
    });

    xml += '</Table>\n</Worksheet>\n</Workbook>';

    const blob = new Blob([xml], { type: 'application/vnd.ms-excel;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  window.AppCommon = {
    api,
    setMessage,
    euroFromCents,
    ensureAuth,
    confirmPayment,
    getUser: () => currentUser,
    mapsLink,
    attachPasswordStrength,
    createSearchSelect,
    exportToXls,
  };
})();
