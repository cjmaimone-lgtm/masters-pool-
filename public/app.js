const API = '';
let golfers = [];
let selectedGolfers = new Set();
let submissions = [];
let fieldEntries = [];

// --- Init ---
document.addEventListener('DOMContentLoaded', async () => {
  await Promise.all([loadGolfers(), loadSubmissions(), loadFieldEntries(), loadRefreshStatus()]);
  renderGolferTable();
  setupTabs();
  setupSearch();
  setupNameInput();

  document.getElementById('submitBtn').addEventListener('click', submitFivesome);
});

// --- Data Refresh ---
async function loadRefreshStatus() {
  try {
    const res = await fetch(`${API}/api/refresh-status`);
    const status = await res.json();
    updateTimestampDisplay('oddsTimestamp', status.oddsUpdatedAt, status.oddsSource);
    updateTimestampDisplay('statsTimestamp', status.statsUpdatedAt);
  } catch { /* ignore if no status yet */ }
}

function updateTimestampDisplay(elementId, isoDate, source) {
  const el = document.getElementById(elementId);
  if (!isoDate) {
    el.textContent = 'Never refreshed';
    return;
  }
  const date = new Date(isoDate);
  const timeStr = date.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
  });
  el.textContent = source ? `${timeStr} (${source})` : timeStr;
}

async function refreshOdds() {
  const btn = document.getElementById('refreshOddsBtn');
  btn.disabled = true;
  btn.classList.add('loading');
  btn.textContent = 'Refreshing...';

  try {
    const res = await fetch(`${API}/api/refresh-odds`, { method: 'POST' });
    const data = await res.json();

    if (!res.ok) {
      showToast(data.error || 'Failed to refresh odds', res.status === 429);
      return;
    }

    // Reload golfers with fresh odds
    await loadGolfers();
    renderGolferTable();
    updateTimestampDisplay('oddsTimestamp', data.updatedAt, data.source);

    let msg = `Odds updated: ${data.matched} golfers matched`;
    if (data.requestsRemaining) msg += ` (${data.requestsRemaining} API calls left this month)`;
    if (data.unmatched?.length > 0) msg += ` | ${data.unmatched.length} unmatched`;
    showToast(msg);
  } catch (err) {
    showToast('Error refreshing odds. Is the server running?');
  } finally {
    btn.disabled = false;
    btn.classList.remove('loading');
    btn.textContent = 'Refresh Odds';
  }
}

async function refreshStats() {
  const btn = document.getElementById('refreshStatsBtn');
  btn.disabled = true;
  btn.classList.add('loading');
  btn.textContent = 'Refreshing...';

  try {
    const res = await fetch(`${API}/api/refresh-stats`, { method: 'POST' });
    const data = await res.json();

    if (!res.ok) {
      showToast(data.error || 'Failed to refresh stats', res.status === 429);
      return;
    }

    // Reload golfers with fresh stats and re-render everything
    await loadGolfers();
    renderGolferTable();
    renderAllStats();
    updateTimestampDisplay('statsTimestamp', data.updatedAt);

    showToast(`Stats updated: ${data.golfersUpdated} golfers across ${data.tournamentsScanned} tournaments`);
  } catch (err) {
    showToast('Error refreshing stats. Is the server running?');
  } finally {
    btn.disabled = false;
    btn.classList.remove('loading');
    btn.textContent = 'Refresh Stats';
  }
}

// --- Data Loading ---
async function loadGolfers() {
  const res = await fetch(`${API}/api/golfers`);
  golfers = await res.json();
  // Populate tiebreaker datalist (alphabetical)
  const datalist = document.getElementById('golferDatalist');
  if (datalist) {
    datalist.innerHTML = golfers
      .filter(g => !g.withdrawn)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(g => `<option value="${g.name}">`)
      .join('');
  }
}

async function loadSubmissions() {
  const res = await fetch(`${API}/api/submissions`);
  submissions = await res.json();
}

async function loadFieldEntries() {
  try {
    const res = await fetch(`${API}/api/field-entries`);
    fieldEntries = await res.json();
  } catch {
    fieldEntries = [];
  }
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
      if (tab.dataset.tab === 'live') {
        if (!liveData) {
          loadLiveLeaderboard().then(() => renderLiveTracker());
        } else {
          renderLiveTracker();
        }
      }
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
  const select = document.getElementById('userName');
  const guestInput = document.getElementById('guestName');
  select.addEventListener('change', () => {
    guestInput.style.display = select.value === 'guest' ? 'inline-block' : 'none';
    if (select.value !== 'guest') guestInput.value = '';
    updateSubmissionCount();
  });
  guestInput.addEventListener('input', updateSubmissionCount);
}

function getEffectiveUserName() {
  const select = document.getElementById('userName');
  if (select.value === 'guest') {
    return document.getElementById('guestName').value.trim();
  }
  return select.value.trim();
}

function updateSubmissionCount() {
  const name = getEffectiveUserName().toLowerCase();
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
    const formHtml = formatForm(g.form, g.recentFinishes);
    const augustaHtml = formatAugusta(g.augusta);
    const age = g.birthYear ? new Date().getFullYear() - g.birthYear : '—';
    const withdrawnClass = g.withdrawn ? ' withdrawn' : '';
    const withdrawnLabel = g.withdrawn ? ' <span class="withdrawn-badge">WD</span>' : '';
    return `
    <tr class="${selectedGolfers.has(g.name) ? 'selected' : ''}${withdrawnClass}"
        onclick="toggleGolfer('${g.name.replace(/'/g, "\\'")}')">
      <td><span class="checkmark">${selectedGolfers.has(g.name) ? '\u2713' : ''}</span></td>
      <td class="golfer-name">${g.name}${withdrawnLabel}</td>
      <td class="age-cell">${age}</td>
      <td class="rank-cell">${g.ranking ? '#' + g.ranking : '—'}</td>
      <td class="opening-odds-cell">${formatOddsDisplay(g.openingOdds)}</td>
      <td class="odds-cell">${formatOddsWithMovement(g)}</td>
      <td class="form-cell">${formHtml}</td>
      <td class="augusta-cell">${augustaHtml}</td>
    </tr>
  `}).join('');
}

function parseOdds(odds) {
  return parseInt(odds.replace('+', ''));
}

function formatOddsDisplay(odds) {
  if (!odds) return '—';
  const num = parseOdds(odds);
  const sign = odds.startsWith('-') ? '-' : '+';
  return sign + num.toLocaleString();
}

function formatOddsWithMovement(g) {
  const display = formatOddsDisplay(g.odds);
  if (!g.openingOdds || g.openingOdds === g.odds) {
    return display;
  }
  const current = parseOdds(g.odds);
  const opening = parseOdds(g.openingOdds);
  const diff = current - opening;
  const openDisplay = formatOddsDisplay(g.openingOdds);
  // Lower odds = more favored. If odds dropped, they're getting more action (good)
  if (diff < 0) {
    return `${display} <span class="odds-move odds-up" title="Opened ${openDisplay}">&#9650;</span>`;
  } else {
    return `${display} <span class="odds-move odds-down" title="Opened ${openDisplay}">&#9660;</span>`;
  }
}

function formatForm(form, recentFinishes) {
  if (!form) return '<span class="form-na">—</span>';
  const badges = [];
  if (form.wins > 0) badges.push(`<span class="form-badge hot">${form.wins}W</span>`);
  if (form.top10s > 0) badges.push(`<span class="form-badge warm">${form.top10s}xT10</span>`);
  const cutRate = Math.round((form.cuts / form.events) * 100);
  const avgStr = form.avg ? form.avg.toFixed(1) : '—';
  let heat = 'cold';
  if (form.wins > 0) heat = 'hot';
  else if (form.top10s >= 2) heat = 'warm';
  else if (form.top10s >= 1 && form.cuts / form.events >= 0.7) heat = 'mild';

  // Show recent finishes for golfers without wins or top-10s
  let detailStr = `${avgStr} avg`;
  if (badges.length === 0 && recentFinishes && recentFinishes.length > 0) {
    const finishLabels = recentFinishes.slice(-3).map(p => p >= 999 ? 'MC' : `T${p}`);
    detailStr = `${finishLabels.join(', ')} · ${avgStr} avg`;
  } else if (badges.length === 0) {
    detailStr = `${form.cuts}/${form.events} cuts · ${avgStr} avg`;
  }

  return `<span class="form-indicator ${heat}" title="${form.events} events, ${form.wins}W, ${form.top10s} T10s, ${cutRate}% cuts, ${avgStr} avg"><span class="form-badges">${badges.join('')}</span><span class="form-detail">${detailStr}</span></span>`;
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
  const userName = getEffectiveUserName();
  if (!userName) {
    showToast(document.getElementById('userName').value === 'guest' ? 'Please enter the guest name!' : 'Please select your name first!');
    return;
  }
  if (selectedGolfers.size !== 5) return;

  const entryName = document.getElementById('entryName').value.trim();
  if (!entryName) {
    showToast('Please name this entry first!');
    return;
  }

  const winningGolfer = document.getElementById('winningGolfer').value.trim();
  const winningScoreVal = document.getElementById('winningScore').value;
  if (!winningGolfer) {
    showToast('Please pick a winning golfer for your tiebreaker!');
    return;
  }
  if (winningScoreVal === '') {
    showToast('Please enter a predicted winning score for your tiebreaker!');
    return;
  }
  const winningScore = parseInt(winningScoreVal);

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
      body: JSON.stringify({ userName, entryName, golfers: golferNames, winningGolfer, winningScore })
    });

    const data = await res.json();

    if (!res.ok) {
      showToast(data.error || 'Something went wrong');
      return;
    }

    submissions.push(data);
    selectedGolfers.clear();
    document.getElementById('entryName').value = '';
    document.getElementById('winningGolfer').value = '';
    document.getElementById('winningScore').value = '';
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
    const entryLabel = s.entryName ? ` — ${escapeHtml(s.entryName)}` : '';
    const tbGolfer = s.winningGolfer ? escapeHtml(s.winningGolfer) : '—';
    const tbScore = s.winningScore != null ? (s.winningScore > 0 ? `+${s.winningScore}` : s.winningScore === 0 ? 'E' : String(s.winningScore)) : '—';
    return `
      <div class="submission-card ${isDupe ? 'duplicate' : ''}">
        <div>
          <div class="user-name">${escapeHtml(s.userName)}${entryLabel}${isDupe ? ' <span class="dupe-badge">DUPLICATE</span>' : ''}</div>
          <div class="golfer-list">${[...s.golfers].sort((a, b) => a.localeCompare(b)).map(g => escapeHtml(g)).join(' &bull; ')}</div>
          <div class="tiebreaker-display">TB: ${tbGolfer} wins at ${tbScore}</div>
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
  if (!augusta) augusta = {};
  const years = ['2022', '2023', '2024', '2025'];
  const slots = years.map(y => {
    if (!augusta[y]) return `<span class="aug-slot"><span class="aug-empty">—</span></span>`;
    const res = augusta[y];
    let cls = 'aug-mid';
    const num = parseFinish(res);
    if (res === 'MC' || res === 'WD') cls = 'aug-mc';
    else if (num <= 5) cls = 'aug-top5';
    else if (num <= 10) cls = 'aug-top10';
    else if (num <= 25) cls = 'aug-top25';
    return `<span class="aug-slot"><span class="aug-result ${cls}" title="${y}">'${y.slice(2)}: ${res}</span></span>`;
  });
  return `<div class="augusta-grid">${slots.join('')}</div>`;
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
  renderValuePicks();
  renderSimilarityScore();
  renderMomentumTracker();
  renderPopularity();
  renderOwnershipGrid();
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
  const debuts = augustaData.filter(d => d.avg === null && d.cuts.total === 0 && d.augusta && Object.keys(d.augusta).length > 0);
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

// --- Value Picks ---
function renderValuePicks() {
  const container = document.getElementById('valuePicks');

  // Score every golfer: lower odds number = more expected to win
  // "Value" = strong form or ranking but odds are longer than expected
  const golferMap = {};
  golfers.forEach(g => { golferMap[g.name] = g; });

  const scored = golfers
    .filter(g => g.ranking && g.form && g.form.events > 0)
    .map(g => {
      const odds = parseOdds(g.odds);
      // Expected odds tier based on ranking (rough heuristic)
      const expectedOdds = g.ranking <= 5 ? 1500 : g.ranking <= 15 ? 4000 : g.ranking <= 30 ? 7000 : g.ranking <= 50 ? 12000 : 20000;

      // Form score: wins worth 5, top10s worth 2, cut rate, low avg
      const formScore = (g.form.wins * 5) + (g.form.top10s * 2) + (g.form.cuts / g.form.events);

      // Value = how much longer the odds are vs what you'd expect + form bonus
      const valueDelta = odds - expectedOdds;
      const valueScore = valueDelta + (formScore * 500);

      return { ...g, valueScore, valueDelta, formScore, expectedOdds };
    })
    .filter(g => g.valueScore > 500) // only show meaningful value
    .sort((a, b) => b.valueScore - a.valueScore)
    .slice(0, 10);

  if (scored.length === 0) {
    container.innerHTML = '<div class="no-stats">Not enough form data to identify value picks — try refreshing stats</div>';
    return;
  }

  container.innerHTML = `
    <div class="value-picks-list">
      ${scored.map(g => {
        const formBadges = [];
        if (g.form.wins > 0) formBadges.push(`<span class="form-badge hot">${g.form.wins}W</span>`);
        if (g.form.top10s > 0) formBadges.push(`<span class="form-badge warm">${g.form.top10s}xT10</span>`);
        const arrow = g.valueDelta > 0 ? 'undervalued' : 'fair price';
        return `
          <div class="value-card">
            <div class="value-card-header">
              <span class="value-name">${escapeHtml(g.name)}</span>
              <span class="value-tag">${arrow}</span>
            </div>
            <div class="value-details">
              <span>Rank #${g.ranking}</span>
              <span class="value-odds">${g.odds}</span>
              <span class="value-form">${formBadges.join(' ')} ${g.form.avg ? g.form.avg.toFixed(1) + ' avg' : ''}</span>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

// --- Fivesome Similarity / Uniqueness ---
function renderSimilarityScore() {
  const container = document.getElementById('similarityScore');
  if (submissions.length < 2) {
    container.innerHTML = '<div class="no-stats">Need at least 2 submissions to measure uniqueness</div>';
    return;
  }

  // Jaccard similarity: |intersection| / |union| for each pair
  // Uniqueness = 1 - average similarity to all other entries
  const results = submissions.map((s, i) => {
    const mySet = new Set(s.golfers);
    let totalSim = 0;
    let comparisons = 0;

    submissions.forEach((other, j) => {
      if (i === j) return;
      const otherSet = new Set(other.golfers);
      const intersection = [...mySet].filter(g => otherSet.has(g)).length;
      const union = new Set([...mySet, ...otherSet]).size;
      totalSim += intersection / union;
      comparisons++;
    });

    const avgSimilarity = totalSim / comparisons;
    const uniqueness = Math.round((1 - avgSimilarity) * 100);
    const userName = s.userName;
    const entryName = s.entryName || '';
    const lastNames = [...s.golfers].map(g => g.split(' ').slice(-1)[0]).sort((a, b) => a.localeCompare(b));
    return { userName, entryName, uniqueness, lastNames, id: s.id };
  });

  results.sort((a, b) => b.uniqueness - a.uniqueness);
  const maxUniq = results[0].uniqueness;

  container.innerHTML = results.map(r => {
    const pct = maxUniq > 0 ? (r.uniqueness / maxUniq) * 100 : 0;
    const color = r.uniqueness >= 80 ? '#006747' : r.uniqueness >= 60 ? '#d4a017' : '#c0392b';
    const namesInBar = r.lastNames.join(', ');
    return `
      <div class="pop-row">
        <div class="pop-name-col">${escapeHtml(r.userName)}</div>
        <div class="pop-entry-col">${escapeHtml(r.entryName)}</div>
        <div class="pop-bar-bg" onclick="toggleBarLabel(this)">
          <div class="pop-bar" style="width:${pct}%;background:${color}">
            <span class="bar-label">${escapeHtml(namesInBar)}</span>
          </div>
        </div>
        <div class="pop-count" style="width:40px;color:${color}">${r.uniqueness}%</div>
      </div>
    `;
  }).join('');
}

// --- Momentum Tracker ---
function getMomentumTier(finishes) {
  // finishes array: oldest first, most recent last
  // Values > 100 = missed cut
  const latest = finishes[finishes.length - 1];
  const prev = finishes.length >= 2 ? finishes[finishes.length - 2] : null;
  const prior = finishes.length >= 3 ? finishes[finishes.length - 3] : null;

  const latestMC = latest > 100;
  const prevMC = prev !== null && prev > 100;

  // Sequential improvement: each finish better than the last (ignoring MCs)
  const sequential = finishes.length >= 2 && finishes.every((f, i) => i === 0 || f <= finishes[i - 1]);

  // Net improvement score
  let netScore = 0;
  for (let i = 1; i < finishes.length; i++) {
    netScore += finishes[i - 1] - finishes[i];
  }

  // HOT: top-10 most recent finish, OR sequential improvement ending in top-20
  if (!latestMC && (latest <= 10 || (sequential && latest <= 20))) {
    return 'hot';
  }

  // TRENDING UP: net improving (score > 5) and latest wasn't a MC
  if (!latestMC && netScore > 5) {
    return 'trending-up';
  }

  // COOLING OFF: was performing well but most recent result dropped significantly or MC
  if (latestMC && prev !== null && !prevMC && prev <= 30) {
    return 'cooling-off';
  }
  if (!latestMC && prev !== null && !prevMC && latest - prev > 15) {
    return 'cooling-off';
  }

  // COLD: net declining (score < -5), or multiple MCs
  const mcCount = finishes.filter(f => f > 100).length;
  if (netScore < -5 || mcCount >= 2) {
    return 'cold';
  }

  return 'steady';
}

const MOMENTUM_CONFIG = {
  'hot':         { icon: '&#9650;&#9650;', color: '#006747', label: 'HOT' },
  'trending-up': { icon: '&#9650;',        color: '#2e8b57', label: 'TRENDING UP' },
  'steady':      { icon: '&#9644;',        color: '#d4a017', label: 'STEADY' },
  'cooling-off': { icon: '&#9660;',        color: '#e67e22', label: 'COOLING OFF' },
  'cold':        { icon: '&#9660;&#9660;', color: '#c0392b', label: 'COLD' }
};

function renderMomentumTracker() {
  const container = document.getElementById('momentumTracker');

  const pickedSet = new Set();
  submissions.forEach(s => s.golfers.forEach(g => pickedSet.add(g)));

  const golferMap = {};
  golfers.forEach(g => { golferMap[g.name] = g; });

  const momentumData = [];
  pickedSet.forEach(name => {
    const g = golferMap[name];
    if (!g || !g.recentFinishes || g.recentFinishes.length < 2) return;

    const finishes = g.recentFinishes;
    const trend = getMomentumTier(finishes);

    // Score for sorting (higher = hotter)
    let netScore = 0;
    for (let i = 1; i < finishes.length; i++) {
      netScore += finishes[i - 1] - finishes[i];
    }
    const tierOrder = { 'hot': 200, 'trending-up': 100, 'steady': 0, 'cooling-off': -100, 'cold': -200 };
    const sortScore = tierOrder[trend] + netScore;

    momentumData.push({ name, finishes, trend, sortScore });
  });

  if (momentumData.length === 0) {
    container.innerHTML = '<div class="no-stats">No momentum data available — try refreshing stats first</div>';
    return;
  }

  momentumData.sort((a, b) => b.sortScore - a.sortScore);

  container.innerHTML = `
    <div class="momentum-list">
      ${momentumData.map(m => {
        const cfg = MOMENTUM_CONFIG[m.trend];
        const finishStr = m.finishes.map((f, i) => {
          const label = i === m.finishes.length - 1 ? 'Latest' : i === m.finishes.length - 2 ? 'Prev' : 'Prior';
          return `<span class="momentum-finish" title="${label}">${f > 100 ? 'MC' : f}</span>`;
        }).join(' &#8594; ');
        return `
          <div class="momentum-row">
            <span class="momentum-name">${escapeHtml(m.name)}</span>
            <span class="momentum-finishes">${finishStr}</span>
            <span class="momentum-trend" style="color:${cfg.color}">${cfg.icon} ${cfg.label}</span>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

// --- Ownership Grid ---
function renderOwnershipGrid() {
  const container = document.getElementById('ownershipGrid');
  if (submissions.length === 0) {
    container.innerHTML = '<div class="no-stats">No submissions yet</div>';
    return;
  }

  // Get unique people (sorted) and unique golfers (sorted by pick count desc, then name)
  const people = [...new Set(submissions.map(s => s.userName))].sort((a, b) => a.localeCompare(b));

  // Build ownership map: golfer -> { person -> count }
  const ownership = {};
  submissions.forEach(s => {
    s.golfers.forEach(g => {
      if (!ownership[g]) ownership[g] = {};
      ownership[g][s.userName] = (ownership[g][s.userName] || 0) + 1;
    });
  });

  // Sort golfers by total picks descending, then alphabetically
  const golferNames = Object.keys(ownership).sort((a, b) => {
    const totalA = Object.values(ownership[a]).reduce((x, y) => x + y, 0);
    const totalB = Object.values(ownership[b]).reduce((x, y) => x + y, 0);
    if (totalB !== totalA) return totalB - totalA;
    return a.localeCompare(b);
  });

  // Find max count for color scaling
  const maxCount = Math.max(...golferNames.map(g => Math.max(...Object.values(ownership[g]))));

  // Build table
  const headerCells = people.map(p => {
    const short = p.length > 6 ? p.slice(0, 6) : p;
    return `<th class="og-person" title="${escapeHtml(p)}">${escapeHtml(short)}</th>`;
  }).join('');

  const rows = golferNames.map(g => {
    const lastName = g.split(' ').slice(-1)[0];
    const firstName = g.split(' ').slice(0, -1).join(' ');
    const cells = people.map(p => {
      const count = ownership[g][p] || 0;
      if (count === 0) return '<td class="og-cell og-empty"></td>';
      const opacity = 0.3 + (count / maxCount) * 0.7;
      const label = count > 1 ? count : '';
      return `<td class="og-cell og-filled" style="background:rgba(0,103,71,${opacity})" title="${escapeHtml(p)}: ${escapeHtml(g)} (${count}x)">${label}</td>`;
    }).join('');
    return `<tr><td class="og-golfer" title="${escapeHtml(g)}"><strong>${escapeHtml(lastName)}</strong><span class="og-first">${escapeHtml(firstName ? ', ' + firstName : '')}</span></td>${cells}</tr>`;
  }).join('');

  container.innerHTML = `
    <div class="og-wrapper">
      <table class="og-table">
        <thead><tr><th class="og-golfer-header">Golfer</th>${headerCells}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

// --- Live Tournament Tracker ---
let liveData = null;
let standingsFilter = 'ours'; // 'ours' or 'all'

function setStandingsFilter(filter) {
  standingsFilter = filter;
  document.querySelectorAll('.filter-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.filter === filter);
  });
  renderLiveTracker();
}

// Client-side name normalization (mirrors server logic)
const CLIENT_NAME_ALIASES = {
  'matthew fitzpatrick': 'matt fitzpatrick',
  'christopher gotterup': 'chris gotterup',
  'nico echavarria': 'nicolas echavarria',
  'john keefer': 'johnny keefer',
  'pongsapak laopakdee': 'fifa laopakdee',
  'j j spaun': 'jj spaun',
  'william zalatoris': 'will zalatoris',
};

function normalizeGolferName(name) {
  let n = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[.\-']/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  return CLIENT_NAME_ALIASES[n] || n;
}

function lookupGolferScore(golferName, scoreMap) {
  const key = normalizeGolferName(golferName);
  return scoreMap[key] || null;
}

async function loadLiveLeaderboard() {
  try {
    const res = await fetch(`${API}/api/live-leaderboard`);
    liveData = await res.json();
  } catch {
    liveData = null;
  }
}

async function refreshLiveLeaderboard() {
  const btn = document.getElementById('refreshLeaderboardBtn');
  btn.disabled = true;
  btn.textContent = 'Loading...';
  await loadLiveLeaderboard();
  renderLiveTracker();
  btn.disabled = false;
  btn.textContent = 'Refresh';
}

function scoreEntries(scoreMap) {
  const MC_PENALTY = 10; // +10 for golfers who missed cut or aren't in the field

  // Combine portfolio (our submissions) and field entries (the competition)
  const allEntries = [
    ...submissions.map(s => ({ ...s, isPortfolio: true })),
    ...fieldEntries.map(s => ({ ...s, isPortfolio: false }))
  ];

  return allEntries.map(s => {
    const golferScores = s.golfers.map(name => {
      const data = lookupGolferScore(name, scoreMap);
      let score, display, status, thru, today, position;

      if (!data) {
        // Not in tournament field
        score = MC_PENALTY;
        display = 'N/F';
        status = 'not_in_field';
        thru = '-';
        today = null;
        position = '-';
      } else if (data.status === 'cut') {
        score = data.score;
        display = data.scoreDisplay;
        status = 'cut';
        thru = 'MC';
        today = null;
        position = 'MC';
      } else if (data.status === 'wd') {
        score = Math.max(data.score, MC_PENALTY);
        display = data.scoreDisplay;
        status = 'wd';
        thru = 'WD';
        today = null;
        position = 'WD';
      } else {
        score = data.score;
        display = data.scoreDisplay;
        status = 'active';
        thru = data.thru;
        today = data.today;
        position = data.position;
      }

      return { name, score, display, status, thru, today, position };
    });

    // Sort by score ascending (best first), drop worst (index 4)
    const sorted = [...golferScores].sort((a, b) => a.score - b.score);
    const best4 = sorted.slice(0, 4);
    const dropped = sorted[4];
    const totalScore = best4.reduce((sum, g) => sum + g.score, 0);

    return {
      userName: s.userName || 'Unknown',
      entryName: s.entryName || '',
      id: s.id,
      golferScores,
      best4Names: new Set(best4.map(g => g.name)),
      droppedGolfer: dropped?.name,
      totalScore,
      winningGolfer: s.winningGolfer || null,
      winningScore: s.winningScore != null ? s.winningScore : null,
      isPortfolio: s.isPortfolio,
      poolPosition: null // user fills in later
    };
  }).sort((a, b) => a.totalScore - b.totalScore);
}

// Helper: get thru/round status string for a golfer in rooting display
function getRoundStatus(golferName, scoreMap) {
  const data = lookupGolferScore(golferName, scoreMap);
  if (!data) return '';
  if (data.status === 'cut') return 'MC';
  if (data.status === 'wd') return 'WD';
  // Mid-round: show "thru X"
  if (data.thru && data.thru !== 'F' && data.thru !== '-') {
    const todayPart = data.today ? ` (${data.today})` : '';
    return `thru ${data.thru}${todayPart}`;
  }
  // Finished round: show most recent round score
  if (data.rounds && data.rounds.length > 0) {
    const lastRound = data.rounds[data.rounds.length - 1];
    return `R${lastRound.round}: ${lastRound.strokes} (${lastRound.toPar})`;
  }
  return '';
}

function renderLiveTracker() {
  const container = document.getElementById('liveStandings');
  const tourneyName = document.getElementById('liveTournamentName');
  const tourneyStatus = document.getElementById('liveTournamentStatus');

  if (!liveData || !liveData.tournament) {
    tourneyName.textContent = 'No tournament data available';
    tourneyStatus.textContent = '';
    container.innerHTML = '<div class="no-stats">Could not load tournament leaderboard. Try refreshing.</div>';
    return;
  }

  // Tournament header
  tourneyName.textContent = liveData.tournament.name;
  const stateMap = { 'in': 'LIVE', 'post': 'FINAL', 'pre': 'UPCOMING' };
  const stateLabel = stateMap[liveData.tournament.state] || liveData.tournament.status;
  const stateClass = liveData.tournament.state === 'in' ? 'live-badge-live' : 'live-badge-final';
  tourneyStatus.innerHTML = `<span class="${stateClass}">${stateLabel}</span>`;
  if (liveData.tournament.detail) {
    tourneyStatus.innerHTML += ` <span class="live-detail">${escapeHtml(liveData.tournament.detail)}</span>`;
  }

  const scoreMap = liveData.scoreMap;

  if (submissions.length === 0) {
    container.innerHTML = '<div class="no-stats">No entries submitted yet.</div>';
    return;
  }

  // Score and rank all entries
  const standings = scoreEntries(scoreMap);

  // Assign ranks (handle ties)
  let rank = 1;
  standings.forEach((entry, i) => {
    if (i > 0 && entry.totalScore > standings[i - 1].totalScore) {
      rank = i + 1;
    }
    entry.rank = rank;
  });

  // Find our leading portfolio entry
  const leadEntry = standings.find(e => e.isPortfolio) || standings[0];

  // Rooting interests — rendered first (above standings)
  renderRootingInterests(standings, leadEntry, scoreMap);

  // Apply filter to standings table
  const displayEntries = standingsFilter === 'ours'
    ? standings.filter(e => e.isPortfolio)
    : standings;

  // Render standings table
  const rows = displayEntries.map(entry => {
    const isLead = entry.id === leadEntry.id;
    const isOurs = entry.isPortfolio;
    const highlightClass = isLead ? ' live-row-highlight' : isOurs ? ' live-row-portfolio' : '';
    const totalDisplay = entry.totalScore > 0 ? `+${entry.totalScore}` : entry.totalScore === 0 ? 'E' : String(entry.totalScore);
    const entryLabel = entry.entryName ? `${escapeHtml(entry.userName)} — ${escapeHtml(entry.entryName)}` : escapeHtml(entry.userName);
    const leadBadge = isLead ? ' <span class="lead-badge">OUR BEST</span>' : '';

    const golferCells = entry.golferScores
      .sort((a, b) => a.score - b.score)
      .map(g => {
        const isDrop = g.name === entry.droppedGolfer;
        const isWinPick = entry.winningGolfer && normalizeGolferName(g.name) === normalizeGolferName(entry.winningGolfer);
        const statusClass = g.status === 'cut' ? ' golfer-cut' : g.status === 'wd' ? ' golfer-wd' : g.status === 'not_in_field' ? ' golfer-nif' : '';
        const dropClass = isDrop ? ' golfer-dropped' : '';
        const winClass = isWinPick ? ' golfer-win-pick' : '';
        const lastName = g.name.split(' ').slice(-1)[0];
        const thruStr = g.thru === 'F' ? '' : g.thru === '-' ? '' : ` (${g.thru})`;
        const todayStr = g.today ? ` today: ${g.today}` : '';
        const winIcon = isWinPick ? '<span class="win-pick-icon" title="Winning golfer pick">&#9733;</span>' : '';
        return `<span class="live-golfer${statusClass}${dropClass}${winClass}" title="${escapeHtml(g.name)}: ${g.display}${thruStr}${todayStr}${isDrop ? ' (dropped)' : ''}${isWinPick ? ' (winner pick)' : ''}">${winIcon}${escapeHtml(lastName)} <span class="live-golfer-score">${g.display}</span>${isDrop ? '<span class="drop-x">&#10005;</span>' : ''}</span>`;
      }).join('');

    // Winning score tiebreaker badge
    const winScoreBadge = entry.winningScore != null
      ? `<span class="live-win-score" title="Predicted winning score">${entry.winningScore > 0 ? '+' + entry.winningScore : entry.winningScore === 0 ? 'E' : entry.winningScore}</span>`
      : '';

    const poolPosCell = '<span class="pool-pos-placeholder">—</span>';

    return `
      <tr class="live-entry-row${highlightClass}">
        <td class="live-rank">${entry.rank}</td>
        <td class="live-entry-name">${entryLabel}${leadBadge}</td>
        <td class="live-total ${entry.totalScore < 0 ? 'under-par' : entry.totalScore > 0 ? 'over-par' : ''}">${totalDisplay}</td>
        <td class="live-golfers">${golferCells}${winScoreBadge}</td>
        <td class="live-pool-pos">${poolPosCell}</td>
      </tr>
    `;
  }).join('');

  container.innerHTML = `
    <table class="live-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Entry</th>
          <th>Best 4</th>
          <th>Golfers (best → worst, &#10005; = dropped)</th>
          <th>Pool Pos</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderRootingInterests(standings, leadEntry, scoreMap) {
  const rootingHeader = document.getElementById('rootingHeader');
  const rootForList = document.getElementById('rootForList');
  const rootAgainstList = document.getElementById('rootAgainstList');

  const leadLabel = leadEntry.entryName
    ? `${leadEntry.userName} — ${leadEntry.entryName}`
    : leadEntry.userName;
  const leadScoreDisplay = leadEntry.totalScore > 0 ? `+${leadEntry.totalScore}` : leadEntry.totalScore === 0 ? 'E' : String(leadEntry.totalScore);

  // All non-portfolio entries ranked above our best entry
  const entriesAbove = standings.filter(e => !e.isPortfolio && e.rank < leadEntry.rank);
  const entriesAboveCount = entriesAbove.length;

  rootingHeader.innerHTML = `<div class="rooting-callout">
    Our leading entry: <strong>${escapeHtml(leadLabel)}</strong> (ranked #${leadEntry.rank} of ${standings.length}, best-4: ${leadScoreDisplay})
    ${entriesAboveCount > 0 ? `<br><span class="rooting-rival">${entriesAboveCount} entr${entriesAboveCount === 1 ? 'y' : 'ies'} ahead of us</span>` : '<br><span class="rooting-rival">We\'re in first!</span>'}
  </div>`;

  // Our counting golfers (not dropped)
  const ourGolfers = new Set(leadEntry.golferScores.filter(g => g.name !== leadEntry.droppedGolfer).map(g => g.name));

  // Count how many entries above us have each golfer in their counting 4
  const golferFreqAbove = new Map(); // golferName -> count of entries above that use this golfer
  entriesAbove.forEach(entry => {
    entry.golferScores.forEach(g => {
      if (entry.droppedGolfer === g.name) return; // only counting golfers
      golferFreqAbove.set(g.name, (golferFreqAbove.get(g.name) || 0) + 1);
    });
  });

  // Also include entries just behind us that could catch up
  const entriesBehind = standings.filter(e => !e.isPortfolio && e.rank > leadEntry.rank && e.rank <= leadEntry.rank + 10);
  const golferFreqBehind = new Map();
  entriesBehind.forEach(entry => {
    entry.golferScores.forEach(g => {
      if (entry.droppedGolfer === g.name) return;
      golferFreqBehind.set(g.name, (golferFreqBehind.get(g.name) || 0) + 1);
    });
  });

  // ROOT FOR: Our golfers that are most unique — fewest entries above share them.
  // Impact = how many entries above us DON'T have this golfer (we gain on them when this golfer improves)
  const rootForGolfers = [];
  ourGolfers.forEach(name => {
    const sharedAbove = golferFreqAbove.get(name) || 0;
    const impact = entriesAboveCount - sharedAbove; // entries we'd gain on
    const data = lookupGolferScore(name, scoreMap);
    rootForGolfers.push({
      name,
      score: data ? data.score : 10,
      display: data ? data.scoreDisplay : 'N/F',
      position: data ? data.position : '-',
      status: data ? data.status : 'not_in_field',
      roundStatus: getRoundStatus(name, scoreMap),
      impact,
      sharedAbove
    });
  });
  // Sort by impact descending (most unique first), then by score ascending as tiebreaker
  rootForGolfers.sort((a, b) => b.impact - a.impact || a.score - b.score);
  const topRootFor = rootForGolfers.slice(0, 5);

  if (topRootFor.length === 0 || entriesAboveCount === 0) {
    rootForList.innerHTML = entriesAboveCount === 0
      ? '<div class="no-stats">We\'re in first — every stroke our golfers gain extends the lead!</div>'
      : '<div class="no-stats">All our counting golfers are shared with entries above us.</div>';
  } else {
    rootForList.innerHTML = topRootFor.map(g => {
      const statusCls = g.status === 'cut' ? ' golfer-cut' : g.status === 'wd' ? ' golfer-wd' : g.status === 'not_in_field' ? ' golfer-nif' : '';
      const roundInfo = g.roundStatus ? `<span class="rooting-round">${escapeHtml(g.roundStatus)}</span>` : '';
      const impactLabel = `<span class="rooting-impact">beats ${g.impact} entr${g.impact === 1 ? 'y' : 'ies'}</span>`;
      return `<div class="rooting-item root-for-item${statusCls}">
        <span class="rooting-name">${escapeHtml(g.name)}</span>
        <span class="rooting-score">${g.display}</span>
        ${roundInfo}
        ${impactLabel}
      </div>`;
    }).join('');
  }

  // ROOT AGAINST: Golfers NOT on our entry that appear most across entries above us.
  // A stroke lost by this golfer hurts the most entries ahead of us simultaneously.
  // Also consider entries just behind — their golfers improving could overtake us.
  const rootAgainstGolfers = new Map();

  // Entries above: their golfers doing worse helps us climb
  golferFreqAbove.forEach((count, name) => {
    if (ourGolfers.has(name)) return; // shared — neutral
    const data = lookupGolferScore(name, scoreMap);
    rootAgainstGolfers.set(name, {
      name,
      score: data ? data.score : 10,
      display: data ? data.scoreDisplay : 'N/F',
      position: data ? data.position : '-',
      status: data ? data.status : 'not_in_field',
      roundStatus: getRoundStatus(name, scoreMap),
      impact: count,
      direction: 'above'
    });
  });

  // Entries behind: their unique golfers improving could let them catch us
  golferFreqBehind.forEach((count, name) => {
    if (ourGolfers.has(name)) return;
    if (rootAgainstGolfers.has(name)) {
      // Already tracked from above — add the behind impact
      rootAgainstGolfers.get(name).impact += count;
    } else {
      const data = lookupGolferScore(name, scoreMap);
      rootAgainstGolfers.set(name, {
        name,
        score: data ? data.score : 10,
        display: data ? data.scoreDisplay : 'N/F',
        position: data ? data.position : '-',
        status: data ? data.status : 'not_in_field',
        roundStatus: getRoundStatus(name, scoreMap),
        impact: count,
        direction: 'behind'
      });
    }
  });

  // Sort by impact descending (most widespread = max damage per stroke), then by score ascending
  const threats = [...rootAgainstGolfers.values()].sort((a, b) => b.impact - a.impact || a.score - b.score);
  const topRootAgainst = threats.slice(0, 5);

  if (topRootAgainst.length === 0) {
    rootAgainstList.innerHTML = '<div class="no-stats">No competition entries loaded yet.</div>';
  } else {
    rootAgainstList.innerHTML = topRootAgainst.map(g => {
      const statusCls = g.status === 'cut' ? ' golfer-cut' : g.status === 'wd' ? ' golfer-wd' : '';
      const roundInfo = g.roundStatus ? `<span class="rooting-round">${escapeHtml(g.roundStatus)}</span>` : '';
      const impactLabel = `<span class="rooting-impact">in ${g.impact} entr${g.impact === 1 ? 'y' : 'ies'}</span>`;
      return `<div class="rooting-item root-against-item${statusCls}">
        <span class="rooting-name">${escapeHtml(g.name)}</span>
        <span class="rooting-score">${g.display}</span>
        ${roundInfo}
        ${impactLabel}
      </div>`;
    }).join('');
  }
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

function toggleBarLabel(barBg) {
  const label = barBg.querySelector('.bar-label');
  if (!label) return;
  label.classList.toggle('visible');
  // Auto-hide after 3 seconds
  if (label.classList.contains('visible')) {
    setTimeout(() => label.classList.remove('visible'), 3000);
  }
}

function showToast(msg, long) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), long ? 5000 : 2500);
}
