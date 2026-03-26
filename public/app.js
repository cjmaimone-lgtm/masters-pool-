const API = '';
let golfers = [];
let selectedGolfers = new Set();
let submissions = [];

// --- Init ---
document.addEventListener('DOMContentLoaded', async () => {
  await Promise.all([loadGolfers(), loadSubmissions()]);
  renderGolferTable();
  setupTabs();
  setupSearch();
  setupNameInput();

  document.getElementById('submitBtn').addEventListener('click', submitFivesome);
});

// --- Data Loading ---
async function loadGolfers() {
  const res = await fetch(`${API}/api/golfers`);
  golfers = await res.json();
}

async function loadSubmissions() {
  const res = await fetch(`${API}/api/submissions`);
  submissions = await res.json();
}

// --- Tabs ---
function setupTabs() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');

      if (tab.dataset.tab === 'board') renderSubmissions();
      if (tab.dataset.tab === 'stats') renderAllStats();
    });
  });
}

// --- Search & Sort ---
function setupSearch() {
  document.getElementById('golferSearch').addEventListener('input', renderGolferTable);
  document.getElementById('sortBy').addEventListener('change', renderGolferTable);
}

// --- Name Input ---
function setupNameInput() {
  document.getElementById('userName').addEventListener('input', updateSubmissionCount);
}

function updateSubmissionCount() {
  const name = document.getElementById('userName').value.trim().toLowerCase();
  if (!name) {
    document.getElementById('submissionCount').textContent = '';
    return;
  }
  const count = submissions.filter(s => s.userName.toLowerCase() === name).length;
  document.getElementById('submissionCount').textContent = `(${count}/3 fivesomes submitted)`;
}

// --- Golfer Table ---
function renderGolferTable() {
  const search = document.getElementById('golferSearch').value.toLowerCase();
  const sortBy = document.getElementById('sortBy').value;

  let filtered = golfers.filter(g => g.name.toLowerCase().includes(search));

  filtered.sort((a, b) => {
    switch (sortBy) {
      case 'name': return a.name.localeCompare(b.name);
      case 'odds': return parseOdds(a.odds) - parseOdds(b.odds);
      default:
        // Golfers without a ranking go to the bottom
        if (a.ranking === null && b.ranking === null) return a.name.localeCompare(b.name);
        if (a.ranking === null) return 1;
        if (b.ranking === null) return -1;
        return a.ranking - b.ranking;
    }
  });

  const tbody = document.getElementById('golferBody');
  tbody.innerHTML = filtered.map(g => {
    const formHtml = formatForm(g.form);
    const augustaHtml = formatAugusta(g.augusta);
    return `
    <tr class="${selectedGolfers.has(g.name) ? 'selected' : ''}"
        onclick="toggleGolfer('${g.name.replace(/'/g, "\\'")}')">
      <td><span class="checkmark">${selectedGolfers.has(g.name) ? '\u2713' : ''}</span></td>
      <td class="golfer-name">${g.name}</td>
      <td class="rank-cell">${g.ranking ? '#' + g.ranking : '—'}</td>
      <td class="odds-cell">${g.odds}</td>
      <td class="form-cell">${formHtml}</td>
      <td class="augusta-cell">${augustaHtml}</td>
    </tr>
  `}).join('');
}

function parseOdds(odds) {
  return parseInt(odds.replace('+', ''));
}

function formatForm(form) {
  if (!form) return '<span class="form-na">—</span>';
  const winBadge = form.wins > 0 ? `<span class="form-badge hot">${form.wins}W</span>` : '';
  const t10Badge = form.top10s > 0 ? `<span class="form-badge warm">${form.top10s}xT10</span>` : '';
  const cutRate = Math.round((form.cuts / form.events) * 100);
  const avgStr = form.avg ? form.avg.toFixed(1) : '—';
  // Heat indicator
  let heat = 'cold';
  if (form.wins > 0) heat = 'hot';
  else if (form.top10s >= 2) heat = 'warm';
  else if (form.top10s >= 1 && form.cuts / form.events >= 0.7) heat = 'mild';
  return `<span class="form-indicator ${heat}" title="${form.events} events, ${form.wins}W, ${form.top10s} T10s, ${cutRate}% cuts, ${avgStr} avg">${winBadge}${t10Badge} <span class="form-detail">${avgStr} avg</span></span>`;
}

function toggleGolfer(name) {
  if (selectedGolfers.has(name)) {
    selectedGolfers.delete(name);
  } else {
    if (selectedGolfers.size >= 5) {
      showToast('You can only select 5 golfers!');
      return;
    }
    selectedGolfers.add(name);
  }
  renderGolferTable();
  updateSelectedDisplay();
}

function updateSelectedDisplay() {
  const count = selectedGolfers.size;
  document.getElementById('selectedCount').textContent = count;
  document.getElementById('submitBtn').disabled = count !== 5;

  const namesEl = document.getElementById('selectedNames');
  if (count === 0) {
    namesEl.textContent = 'Select 5 golfers from the list above';
  } else {
    namesEl.innerHTML = '<strong>Your fivesome:</strong> ' +
      Array.from(selectedGolfers).join(', ');
  }
}

// --- Submit ---
async function submitFivesome() {
  const userName = document.getElementById('userName').value.trim();
  if (!userName) {
    showToast('Please enter your name first!');
    return;
  }
  if (selectedGolfers.size !== 5) return;

  const golferNames = Array.from(selectedGolfers);

  // Check for duplicate fivesome
  const dupes = findDuplicates(golferNames);
  if (dupes.length > 0) {
    const dupeNames = dupes.map(d => d.userName).join(', ');
    if (!confirm(`This exact fivesome was already submitted by: ${dupeNames}\n\nSubmit anyway?`)) {
      return;
    }
  }

  try {
    const res = await fetch(`${API}/api/submissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userName, golfers: golferNames })
    });

    const data = await res.json();

    if (!res.ok) {
      showToast(data.error || 'Something went wrong');
      return;
    }

    submissions.push(data);
    selectedGolfers.clear();
    renderGolferTable();
    updateSelectedDisplay();
    updateSubmissionCount();
    showToast('Fivesome submitted!');
  } catch (err) {
    showToast('Error submitting. Is the server running?');
  }
}

// --- Leaderboard ---
function renderSubmissions() {
  const container = document.getElementById('submissionsList');

  if (submissions.length === 0) {
    container.innerHTML = '<div class="no-submissions">No fivesomes submitted yet. Be the first!</div>';
    return;
  }

  // Sort newest first
  const sorted = [...submissions].sort((a, b) =>
    new Date(b.submittedAt) - new Date(a.submittedAt)
  );

  // Build a map of fivesome keys to count how many times each combo appears
  const keyCounts = {};
  sorted.forEach(s => {
    const key = fivesomeKey(s.golfers);
    keyCounts[key] = (keyCounts[key] || 0) + 1;
  });

  container.innerHTML = sorted.map(s => {
    const date = new Date(s.submittedAt);
    const timeStr = date.toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
    });
    const key = fivesomeKey(s.golfers);
    const isDupe = keyCounts[key] > 1;
    return `
      <div class="submission-card ${isDupe ? 'duplicate' : ''}">
        <div>
          <div class="user-name">${escapeHtml(s.userName)}${isDupe ? ' <span class="dupe-badge">DUPLICATE</span>' : ''}</div>
          <div class="golfer-list">${s.golfers.map(g => escapeHtml(g)).join(' &bull; ')}</div>
        </div>
        <div style="text-align:right;">
          <div class="timestamp">${timeStr}</div>
          <button class="delete-btn" onclick="deleteSubmission('${s.id}')">Remove</button>
        </div>
      </div>
    `;
  }).join('');
}

async function deleteSubmission(id) {
  if (!confirm('Remove this fivesome?')) return;
  try {
    await fetch(`${API}/api/submissions/${id}`, { method: 'DELETE' });
    submissions = submissions.filter(s => s.id !== id);
    renderSubmissions();
    updateSubmissionCount();
    showToast('Fivesome removed');
  } catch {
    showToast('Error removing submission');
  }
}

function formatAugusta(augusta) {
  if (!augusta || Object.keys(augusta).length === 0) return '<span class="form-na">Debut</span>';
  const years = ['2022', '2023', '2024', '2025'];
  const results = years
    .filter(y => augusta[y])
    .map(y => {
      const res = augusta[y];
      let cls = 'aug-mid';
      const num = parseFinish(res);
      if (res === 'MC' || res === 'WD') cls = 'aug-mc';
      else if (num <= 5) cls = 'aug-top5';
      else if (num <= 10) cls = 'aug-top10';
      else if (num <= 25) cls = 'aug-top25';
      return `<span class="aug-result ${cls}" title="${y}">'${y.slice(2)}: ${res}</span>`;
    });
  return results.join(' ');
}

function parseFinish(result) {
  if (!result || result === 'MC' || result === 'WD') return 999;
  return parseInt(result.replace('T', ''));
}

function getAugustaAvg(augusta) {
  if (!augusta) return null;
  const finishes = Object.values(augusta)
    .filter(r => r !== 'MC' && r !== 'WD')
    .map(r => parseFinish(r));
  if (finishes.length === 0) return null;
  return finishes.reduce((a, b) => a + b, 0) / finishes.length;
}

function getAugustaMadeCuts(augusta) {
  if (!augusta) return { made: 0, total: 0 };
  const entries = Object.values(augusta);
  const made = entries.filter(r => r !== 'MC' && r !== 'WD').length;
  return { made, total: entries.length };
}

// --- Analytics ---
function renderAllStats() {
  renderTierBreakdown();
  renderRiskByPerson();
  renderAugustaFit();
  renderCoverageGaps();
  renderPopularity();
}

function getOddsTier(odds) {
  const num = parseOdds(odds);
  if (num <= 2000) return 'favorite';
  if (num <= 8000) return 'contender';
  return 'longshot';
}

function getTierLabel(tier) {
  if (tier === 'favorite') return 'Favorites (+2000 or less)';
  if (tier === 'contender') return 'Contenders (+2001 to +8000)';
  return 'Longshots (+8001 and up)';
}

function getTierColor(tier) {
  if (tier === 'favorite') return '#006747';
  if (tier === 'contender') return '#d4a017';
  return '#c0392b';
}

function renderTierBreakdown() {
  const container = document.getElementById('tierBreakdown');
  if (submissions.length === 0) {
    container.innerHTML = '<div class="no-stats">No submissions yet</div>';
    return;
  }

  // Build golfer lookup
  const golferMap = {};
  golfers.forEach(g => { golferMap[g.name] = g; });

  const tierCounts = { favorite: 0, contender: 0, longshot: 0 };
  let totalPicks = 0;

  submissions.forEach(s => {
    s.golfers.forEach(name => {
      const g = golferMap[name];
      if (g) {
        tierCounts[getOddsTier(g.odds)]++;
        totalPicks++;
      }
    });
  });

  const tiers = ['favorite', 'contender', 'longshot'];

  // Stacked bar
  const barHtml = tiers.map(t => {
    const pct = totalPicks > 0 ? (tierCounts[t] / totalPicks * 100) : 0;
    return `<div class="tier-segment" style="width:${pct}%;background:${getTierColor(t)}" title="${getTierLabel(t)}: ${tierCounts[t]} picks (${Math.round(pct)}%)"></div>`;
  }).join('');

  const legendHtml = tiers.map(t => {
    const pct = totalPicks > 0 ? Math.round(tierCounts[t] / totalPicks * 100) : 0;
    return `<div class="tier-legend-item"><span class="tier-dot" style="background:${getTierColor(t)}"></span>${getTierLabel(t)}: <strong>${tierCounts[t]}</strong> picks (${pct}%)</div>`;
  }).join('');

  // Overall assessment
  const favPct = totalPicks > 0 ? tierCounts.favorite / totalPicks : 0;
  const longPct = totalPicks > 0 ? tierCounts.longshot / totalPicks : 0;
  let verdict = '';
  if (favPct > 0.5) verdict = 'The group is playing it safe — heavily indexed to favorites.';
  else if (longPct > 0.5) verdict = 'The group is swinging for the fences — heavy on longshots!';
  else if (favPct > 0.35) verdict = 'Leaning toward favorites, but with some upside picks mixed in.';
  else if (longPct > 0.35) verdict = 'Leaning toward longshots — the group likes value plays.';
  else verdict = 'A balanced portfolio — a healthy mix across all tiers.';

  container.innerHTML = `
    <div class="tier-bar">${barHtml}</div>
    <div class="tier-legend">${legendHtml}</div>
    <div class="tier-verdict">${verdict}</div>
  `;
}

function renderRiskByPerson() {
  const container = document.getElementById('riskByPerson');
  if (submissions.length === 0) {
    container.innerHTML = '<div class="no-stats">No submissions yet</div>';
    return;
  }

  const golferMap = {};
  golfers.forEach(g => { golferMap[g.name] = g; });

  // Group by user, average their odds across all their picks
  const userOdds = {};
  submissions.forEach(s => {
    const name = s.userName;
    if (!userOdds[name]) userOdds[name] = [];
    s.golfers.forEach(gn => {
      const g = golferMap[gn];
      if (g) userOdds[name].push(parseOdds(g.odds));
    });
  });

  const userAvgs = Object.entries(userOdds).map(([name, odds]) => ({
    name,
    avg: Math.round(odds.reduce((a, b) => a + b, 0) / odds.length)
  }));

  userAvgs.sort((a, b) => a.avg - b.avg);
  const maxAvg = userAvgs[userAvgs.length - 1].avg;

  container.innerHTML = userAvgs.map(u => {
    const pct = maxAvg > 0 ? (u.avg / maxAvg) * 100 : 0;
    const tierColor = u.avg <= 2000 ? '#006747' : u.avg <= 8000 ? '#d4a017' : '#c0392b';
    return `
      <div class="pop-row">
        <div class="pop-name">${escapeHtml(u.name)}</div>
        <div class="pop-bar-bg">
          <div class="pop-bar" style="width:${pct}%;background:${tierColor}"></div>
        </div>
        <div class="pop-count" style="width:60px;color:${tierColor}">+${u.avg.toLocaleString()}</div>
      </div>
    `;
  }).join('');
}

function renderAugustaFit() {
  const container = document.getElementById('augustaFit');
  if (submissions.length === 0) {
    container.innerHTML = '<div class="no-stats">No submissions yet</div>';
    return;
  }

  const golferMap = {};
  golfers.forEach(g => { golferMap[g.name] = g; });

  // Get all picked golfers with Augusta history
  const pickedSet = new Set();
  submissions.forEach(s => s.golfers.forEach(g => pickedSet.add(g)));

  const augustaData = [];
  pickedSet.forEach(name => {
    const g = golferMap[name];
    if (!g) return;
    const avg = getAugustaAvg(g.augusta);
    const cuts = getAugustaMadeCuts(g.augusta);
    augustaData.push({ name, avg, cuts, augusta: g.augusta || {} });
  });

  // Separate into golfers with history and debuts
  const withHistory = augustaData.filter(d => d.avg !== null).sort((a, b) => a.avg - b.avg);
  const debuts = augustaData.filter(d => d.avg === null && d.cuts.total === 0);
  const allMC = augustaData.filter(d => d.avg === null && d.cuts.total > 0);

  if (withHistory.length === 0 && debuts.length === 0) {
    container.innerHTML = '<div class="no-stats">No Augusta data available for picked golfers</div>';
    return;
  }

  const worstAvg = withHistory.length > 0 ? withHistory[withHistory.length - 1].avg : 60;

  let html = '';

  // Bar chart for golfers with made-cut history
  html += withHistory.map(d => {
    const pct = worstAvg > 0 ? (1 - (d.avg - 1) / (worstAvg - 1)) * 100 : 50;
    const barColor = d.avg <= 10 ? '#006747' : d.avg <= 25 ? '#d4a017' : '#c0392b';
    const years = Object.entries(d.augusta).map(([y, r]) => `'${y.slice(2)}: ${r}`).join(', ');
    return `
      <div class="pop-row">
        <div class="pop-name">${escapeHtml(d.name)}</div>
        <div class="pop-bar-bg">
          <div class="pop-bar" style="width:${Math.max(pct, 3)}%;background:${barColor}" title="${years}"></div>
        </div>
        <div class="pop-count" style="width:50px;color:${barColor}">~${Math.round(d.avg)}</div>
      </div>
    `;
  }).join('');

  // List debuts and all-MC golfers
  if (allMC.length > 0) {
    html += `<div class="augusta-note" style="margin-top:0.8rem;"><strong>All missed cuts at Augusta:</strong> ${allMC.map(d => escapeHtml(d.name)).join(', ')}</div>`;
  }
  if (debuts.length > 0) {
    html += `<div class="augusta-note"><strong>Augusta debutants:</strong> ${debuts.map(d => escapeHtml(d.name)).join(', ')}</div>`;
  }

  container.innerHTML = html;
}

function renderCoverageGaps() {
  const container = document.getElementById('coverageGaps');
  if (submissions.length === 0) {
    container.innerHTML = '<div class="no-stats">No submissions yet</div>';
    return;
  }

  const pickedSet = new Set();
  submissions.forEach(s => s.golfers.forEach(g => pickedSet.add(g)));

  // Top 25 ranked golfers not picked
  const gaps = golfers
    .filter(g => g.ranking && g.ranking <= 25 && !pickedSet.has(g.name))
    .sort((a, b) => a.ranking - b.ranking);

  if (gaps.length === 0) {
    container.innerHTML = '<div class="coverage-ok">All top-25 ranked golfers have been picked. Nice coverage!</div>';
    return;
  }

  container.innerHTML = `
    <div class="gaps-list">
      ${gaps.map(g => `
        <div class="gap-item">
          <span class="gap-rank">#${g.ranking}</span>
          <span class="gap-name">${g.name}</span>
          <span class="gap-odds">${g.odds}</span>
        </div>
      `).join('')}
    </div>
    <div class="gaps-note">${gaps.length} of the top 25 ranked golfers are unclaimed</div>
  `;
}

function renderPopularity() {
  const container = document.getElementById('popularityChart');

  if (submissions.length === 0) {
    container.innerHTML = '<div class="no-stats">No submissions yet</div>';
    return;
  }

  const counts = {};
  submissions.forEach(s => {
    s.golfers.forEach(g => {
      counts[g] = (counts[g] || 0) + 1;
    });
  });

  const sorted = Object.entries(counts).sort((a, b) =>
    b[1] - a[1] || a[0].localeCompare(b[0])
  );

  const maxCount = sorted[0][1];

  container.innerHTML = sorted.map(([name, count]) => {
    const pct = (count / maxCount) * 100;
    return `
      <div class="pop-row">
        <div class="pop-name">${escapeHtml(name)}</div>
        <div class="pop-bar-bg">
          <div class="pop-bar" style="width: ${pct}%"></div>
        </div>
        <div class="pop-count">${count}</div>
      </div>
    `;
  }).join('');
}

// --- Duplicate Detection ---
function fivesomeKey(golferArray) {
  return [...golferArray].sort().join('|').toLowerCase();
}

function findDuplicates(golferArray) {
  const key = fivesomeKey(golferArray);
  return submissions.filter(s => fivesomeKey(s.golfers) === key);
}

// --- Helpers ---
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2500);
}
