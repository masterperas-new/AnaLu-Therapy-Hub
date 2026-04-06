const versionBadge = document.getElementById('version-badge');
const releaseDate = document.getElementById('release-date');
const versionHistory = document.getElementById('version-history');

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
}

async function loadVersion() {
  const data = await AppCommon.api('/version.json');

  versionBadge.textContent = `v${data.version}`;
  releaseDate.textContent = `Released ${formatDate(data.releaseDate)}`;

  versionHistory.innerHTML = '';

  data.history.forEach((release, idx) => {
    const section = document.createElement('section');
    section.className = 'card';

    const heading = document.createElement('h3');
    heading.style.marginBottom = '4px';
    heading.innerHTML = `v${release.version}` +
      (idx === 0 ? ' <span style="color:var(--accent);font-size:0.8rem">(current)</span>' : '');
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

    versionHistory.appendChild(section);
  });
}

AppCommon.ensureAuth(loadVersion);
