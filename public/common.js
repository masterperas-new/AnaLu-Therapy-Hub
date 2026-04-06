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
  }

  function updateNavForRole() {
    if (!currentUser) return;
    document.querySelectorAll('[data-admin-only]').forEach((el) => {
      el.style.display = currentUser.role === 'admin' ? '' : 'none';
    });
  }

  async function ensureAuth(onAuthenticated) {
    const loginForm = document.getElementById('login-form');

    if (loginForm) {
      loginForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const formData = new FormData(loginForm);

        try {
          const result = await api('/api/auth/login', {
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
          await onAuthenticated();
          setMessage(`Logged in as ${currentUser.fullName}.`);
        } catch (error) {
          setMessage(error.message, true);
        }
      });
    }

    document.querySelectorAll('.logout-btn').forEach((button) => {
      button.addEventListener('click', async () => {
        try {
          await api('/api/auth/logout', { method: 'POST' });
          currentUser = null;
          setAuthenticated(false);
          setMessage('Logged out.');
        } catch (error) {
          setMessage(error.message, true);
        }
      });
    });

    document.querySelectorAll('.main-nav a').forEach((link) => {
      if (link.pathname === window.location.pathname) {
        link.classList.add('active');
      }
    });

    try {
      const session = await api('/api/auth/session');
      if (session.authenticated && session.user) {
        currentUser = session.user;
        setAuthenticated(true);
        updateNavForRole();
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

  window.AppCommon = {
    api,
    setMessage,
    euroFromCents,
    ensureAuth,
    confirmPayment,
    getUser: () => currentUser,
  };
})();
