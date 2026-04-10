(function initProfile() {
  const { api, setMessage, getUser, attachPasswordStrength } = window.AppCommon;
  const profileForm = document.getElementById('profile-form');
  const passwordForm = document.getElementById('password-form');

  attachPasswordStrength(document.getElementById('newPwd'));

  function populateProfile() {
    const user = getUser();
    if (!user) return;
    document.getElementById('profileUsername').value = user.username;
    document.getElementById('profileRole').value = user.role === 'admin' ? 'Admin' : 'Therapist';
    document.getElementById('profileName').value = user.fullName || '';
    document.getElementById('profilePhone').value = user.phone || '';
  }

  profileForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const user = getUser();
    const fd = new FormData(profileForm);
    try {
      await api(`/ALTApi/users/${user.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          fullName: fd.get('fullName'),
          phone: fd.get('phone') || null,
        }),
      });
      /* Refresh session info to keep nav in sync */
      const session = await api('/ALTApi/auth/session');
      if (session.authenticated && session.user) {
        Object.assign(user, session.user);
      }
      setMessage('Profile updated.');
    } catch (err) {
      setMessage(err.message, true);
    }
  });

  passwordForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(passwordForm);
    const pwd = fd.get('password');
    const confirm = fd.get('confirm');

    if (pwd !== confirm) {
      setMessage('Passwords do not match.', true);
      return;
    }

    const user = getUser();
    try {
      await api(`/ALTApi/users/${user.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          fullName: document.getElementById('profileName').value,
          phone: document.getElementById('profilePhone').value || null,
          password: pwd,
        }),
      });
      passwordForm.reset();
      setMessage('Password updated.');
    } catch (err) {
      setMessage(err.message, true);
    }
  });

  window.AppCommon.ensureAuth(async () => {
    populateProfile();
  });
})();
