const versionBadge = document.getElementById('version-badge');
const releaseDate = document.getElementById('release-date');
const versionHistory = document.getElementById('version-history');

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
}

function buildVersionCard(release, isCurrent) {
  const section = document.createElement('section');
  section.className = 'card';

  const heading = document.createElement('h3');
  heading.style.marginBottom = '4px';
  heading.innerHTML = `v${release.version}` +
    (isCurrent ? ' <span style="color:var(--accent);font-size:0.8rem">(current)</span>' : '');
  section.appendChild(heading);

  const dateLine = document.createElement('p');
  dateLine.style.cssText = 'color:var(--muted);font-size:0.85rem;margin-bottom:8px';
  dateLine.textContent = `${formatDate(release.date)} — ${release.summary}`;
  section.appendChild(dateLine);

  const ul = document.createElement('ul');
  ul.style.cssText = 'margin:0;padding-left:20px;line-height:1.6';
  release.changes.forEach((change) => {
    const li = document.createElement('li');
    li.textContent = change;
    ul.appendChild(li);
  });
  section.appendChild(ul);
  return section;
}

async function loadVersion() {
  const data = await AppCommon.api('/version.json');
  
  // Fetch build count
  let buildCount = 0;
  try {
    const buildRes = await AppCommon.api('/ALTApi/auth/build-info');
    buildCount = buildRes.buildCount || 0;
  } catch (_) {}
  
  const displayVersion = buildCount > 0 ? `v${data.version}.${buildCount}` : `v${data.version}`;
  versionBadge.textContent = displayVersion;
  releaseDate.textContent = `Released ${formatDate(data.releaseDate)}`;

  versionHistory.innerHTML = '';

  if (data.history.length > 0) {
    versionHistory.appendChild(buildVersionCard(data.history[0], true));
  }

  if (data.history.length > 1) {
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.textContent = 'Show version history';
    toggle.style.cssText = 'margin-top:8px;padding:8px 16px;border:1px solid var(--accent);color:var(--accent);background:transparent;border-radius:999px;cursor:pointer;font:inherit;font-size:0.85rem';

    const olderContainer = document.createElement('div');
    olderContainer.style.display = 'none';
    olderContainer.className = 'stack';

    data.history.slice(1).forEach((release) => {
      olderContainer.appendChild(buildVersionCard(release, false));
    });

    toggle.addEventListener('click', () => {
      const visible = olderContainer.style.display !== 'none';
      olderContainer.style.display = visible ? 'none' : '';
      toggle.textContent = visible ? 'Show version history' : 'Hide version history';
    });

    versionHistory.appendChild(toggle);
    versionHistory.appendChild(olderContainer);
  }
}

AppCommon.ensureAuth(() => {
  const user = AppCommon.getUser();
  loadVersion();
  if (!user || user.role !== 'admin') {
    versionHistory.style.display = 'none';
  }
});
