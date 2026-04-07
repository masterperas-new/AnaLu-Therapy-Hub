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
    const defaultTheme = currentUser && currentUser.role === 'admin' ? 'dark-green' : 'light-green';
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
      `<div class="theme-picker">` +
        THEMES.map((t) => `<button type="button" class="theme-swatch theme-swatch--${t}" data-theme="${t}" title="${THEME_LABELS[t]}"></button>`).join('') +
      `</div>` +
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
    userStatus.querySelectorAll('.theme-swatch').forEach((btn) => {
      btn.addEventListener('click', () => setTheme(btn.dataset.theme));
    });
    loadTheme();
    startClock();
  }

  function startClock() {
    tickClock();
    if (clockInterval) clearInterval(clockInterval);
    clockInterval = setInterval(tickClock, 1000);
  }

  function stopClock() {
    if (clockInterval) { clearInterval(clockInterval); clockInterval = null; }
  }

  function tickClock() {
    const el = document.getElementById('live-clock');
    if (!el) return;
    const now = new Date();
    const date = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const time = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
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
        await onAuthenticated();
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



  window.AppCommon = {
    api,
    setMessage,
    euroFromCents,
    ensureAuth,
    confirmPayment,
    getUser: () => currentUser,
    mapsLink,
  };
})();
