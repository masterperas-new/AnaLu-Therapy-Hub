// Re-checks the signed-in user against the database on each request, so that
// blocking a user, changing their role or resetting their password takes effect
// straight away instead of when their 8-hour session runs out.

// Short marker of the password hash, kept server-side in the session store.
// If the password changes, the marker no longer matches and the session ends.
function passwordStamp(passwordHash) {
  return passwordHash ? String(passwordHash).slice(-16) : null;
}

function endSession(req) {
  return new Promise((resolve) => {
    if (!req.session) return resolve();
    req.session.destroy(() => resolve());
  });
}

// Returns true when the session belongs to an active user. Ends the session and
// returns false when the user was deleted, blocked, or their password changed.
async function validateSession(req) {
  if (!(req.session && req.session.authenticated && req.session.user)) {
    return false;
  }

  const { db } = require('./db/database');
  const current = await db.get('SELECT role, blocked, password_hash FROM users WHERE id = $1', [req.session.user.id]);

  // Sessions created before this check existed have no stamp; they stay valid.
  const stampChanged = req.session.passwordStamp && passwordStamp(current && current.password_hash) !== req.session.passwordStamp;

  if (!current || current.blocked || stampChanged) {
    await endSession(req);
    return false;
  }

  if (current.role !== req.session.user.role) {
    req.session.user.role = current.role;
  }
  return true;
}

module.exports = { validateSession, passwordStamp };
