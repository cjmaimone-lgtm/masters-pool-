require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

const supabase = createClient(
  process.env.SUPABASE_URL || 'https://gxaaiunlgncadupyylni.supabase.co',
  process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd4YWFpdW5sZ25jYWR1cHl5bG5pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1NDA4NjYsImV4cCI6MjA5MDExNjg2Nn0.bD8HMKyRVPyV-gmFu23j4KdqxqQNF1Pggz80lSedbi8'
);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const GOLFERS_FILE = path.join(__dirname, 'data', 'golfers.json');
const STATUS_FILE = path.join(__dirname, 'data', 'refresh-status.json');
const FIELD_ENTRIES_FILE = path.join(__dirname, 'data', 'field-entries.json');

// --- Tournament config: repurpose the whole site per event by editing this block ---
// The pickable field is sourced live from ESPN's entrant list for espnEventId, so it
// tracks who is actually playing (updates daily, including WDs/late adds).
const TOURNAMENT = {
  espnEventId: 401811957,                        // ESPN PGA-league event id = The Open 2026
  oddsSportKey: 'golf_the_open_championship_winner', // The Odds API market key
  name: 'The Open',                              // fallback label; real name comes from ESPN
  lockNameMatch: 'open',                         // substring fallback for the entry lock
  // Cut line (to-par number). Leave null to AUTO-DETECT: the app scrapes ESPN's leaderboard
  // page for espnEventId and reads the posted cut line. This is needed because ESPN's
  // scoreboard *API* lags for hours after R2 — it keeps returning cut players as "active"
  // with an empty R3 linescore, defeating status-based detection. Whatever the line, any
  // player whose 36-hole (R1+R2) score is worse than it is marked cut. Set a number here
  // only if you ever need to override the scrape.
  cutLine: null,
};

// ESPN reports country as a full name (flag.alt); map to the 3-letter codes used by
// COUNTRY_FLAGS on the client. Unmapped countries fall back to no flag.
const COUNTRY_NAME_TO_CODE = {
  'United States': 'USA', 'USA': 'USA', 'England': 'ENG', 'Scotland': 'SCO',
  'Northern Ireland': 'NIR', 'Ireland': 'IRL', 'Spain': 'ESP', 'Australia': 'AUS',
  'Japan': 'JPN', 'South Korea': 'KOR', 'Sweden': 'SWE', 'Norway': 'NOR',
  'Denmark': 'DEN', 'Austria': 'AUT', 'Finland': 'FIN', 'Belgium': 'BEL',
  'Canada': 'CAN', 'New Zealand': 'NZL', 'South Africa': 'RSA', 'Colombia': 'COL',
  'Mexico': 'MEX', 'Argentina': 'ARG', 'Chile': 'CHI', 'China': 'CHN',
  'Thailand': 'THA', 'France': 'FRA', 'Germany': 'GER', 'Italy': 'ITA',
  'Netherlands': 'NED', 'Zimbabwe': 'ZIM', 'Fiji': 'FJI',
};

// --- Name normalization for matching across APIs ---

// Map of known nickname/spelling variants to canonical names used in golfers.json
const NAME_ALIASES = {
  'matthew fitzpatrick': 'matt fitzpatrick',
  'christopher gotterup': 'chris gotterup',
  'nico echavarria': 'nicolas echavarria',
  'john keefer': 'johnny keefer',
  'pongsapak laopakdee': 'fifa laopakdee',
  'j j spaun': 'jj spaun',
  'william zalatoris': 'will zalatoris',
  // The Open 2026: odds-feed spellings -> ESPN field spellings (keeps odds on the real entry)
  'joohyung kim': 'tom kim',
  'alexander noren': 'alex noren',
  'eugenio lopez chacarra': 'eugenio chacarra',
  'jayden trey schaper': 'jayden schaper',
  'jose luis ballester': 'josele ballester',
  'baard skogen': 'bard bjornevik skogen',
  'tom sloman': 'thomas sloman',
  'jackson buchanan': 'jack buchanan',
};

function normalizeName(name) {
  return name
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')  // strip combining accents (\u00e5->a, \u00e9->e)
    .replace(/[\u00f8\u00d8]/g, 'o').replace(/[\u0142\u0141]/g, 'l')       // fold letters NFD can't decompose
    .replace(/[\u00e6\u00c6]/g, 'ae').replace(/[\u00f0\u00d0]/g, 'd')      // (e.g. H\u00f8jgaard <-> Hojgaard)
    .replace(/[.\-']/g, '')                             // strip dots, hyphens, apostrophes
    .replace(/\s+/g, ' ')                               // collapse whitespace
    .trim()
    .toLowerCase();
}

// Look up birth year from ESPN athlete profile (try PGA, then DP World Tour)
async function fetchBirthYearById(espnId) {
  for (const league of ['pga', 'eur', 'liv']) {
    try {
      const url = `https://site.web.api.espn.com/apis/common/v3/sports/golf/${league}/athletes/${espnId}`;
      const res = await fetch(url);
      if (!res.ok) {
        console.log(`    Profile HTTP ${res.status} for ID ${espnId} (${league})`);
        continue;
      }
      const data = await res.json();
      const dob = data.displayDOB || (data.athlete && data.athlete.displayDOB);
      if (dob) {
        const parts = dob.split('/');
        return parseInt(parts[parts.length - 1]);
      }
    } catch (err) {
      console.log(`    Profile error for ID ${espnId} (${league}): ${err.message}`);
    }
  }
  return null;
}

// Search ESPN for a golfer by name and return their birth year
async function fetchBirthYearByName(golferName) {
  try {
    const searchUrl = `https://site.web.api.espn.com/apis/common/v3/search?query=${encodeURIComponent(golferName)}&limit=5&type=player&sport=golf`;
    const res = await fetch(searchUrl);
    if (!res.ok) {
      console.log(`    ESPN search HTTP ${res.status} for "${golferName}"`);
      return null;
    }
    const data = await res.json();
    const results = data.items || [];
    console.log(`    ESPN search for "${golferName}": ${results.length} results`);
    if (results.length === 0) return null;
    // Find the best match among golf results
    const norm = normalizeName(golferName);
    for (const r of results) {
      if (normalizeName(r.displayName || '') === norm) {
        console.log(`    Exact match: ${r.displayName} (ID: ${r.id})`);
        return await fetchBirthYearById(r.id);
      }
    }
    // If no exact match, try the first result
    console.log(`    No exact match, using first result: ${results[0].displayName} (ID: ${results[0].id})`);
    return await fetchBirthYearById(results[0].id);
  } catch (err) {
    console.log(`    ESPN search error for "${golferName}": ${err.message}`);
    return null;
  }
}

function resolveAlias(name) {
  const normalized = normalizeName(name);
  return NAME_ALIASES[normalized] ? normalizeName(NAME_ALIASES[normalized]) : normalized;
}

function buildNameIndex(golfers) {
  const index = {};
  golfers.forEach((g, i) => {
    index[resolveAlias(g.name)] = i;
  });
  return index;
}

function findGolferIndex(nameIndex, apiName) {
  return nameIndex[resolveAlias(apiName)] ?? -1;
}

// --- Refresh status tracking ---
function getRefreshStatus() {
  try {
    return JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
  } catch {
    return { oddsUpdatedAt: null, statsUpdatedAt: null };
  }
}

function saveRefreshStatus(status) {
  fs.writeFileSync(STATUS_FILE, JSON.stringify(status, null, 2));
}

// --- Rate limiting: 3 windows per day ---
// Before 12pm, 12pm-4pm, 4pm-midnight (Eastern)
function getRefreshWindow() {
  const now = new Date();
  // Get Eastern time hour (UTC-4 for EDT, UTC-5 for EST)
  const eastern = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const hour = eastern.getHours();
  const dateStr = eastern.toISOString().slice(0, 10); // YYYY-MM-DD

  let window;
  if (hour < 12) window = 'morning';
  else if (hour < 16) window = 'afternoon';
  else window = 'evening';

  return `${dateStr}_${window}`;
}

function canRefresh(type) {
  const status = getRefreshStatus();
  const currentWindow = getRefreshWindow();
  const lastWindow = type === 'odds' ? status.oddsLastWindow : status.statsLastWindow;
  return lastWindow !== currentWindow;
}

function getNextWindowTime() {
  const now = new Date();
  const eastern = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const hour = eastern.getHours();

  if (hour < 12) return '12:00 PM ET';
  if (hour < 16) return '4:00 PM ET';
  return 'tomorrow morning';
}

// ============================================================
// EXISTING ENDPOINTS
// ============================================================

// GET golfers
app.get('/api/golfers', (req, res) => {
  const golfers = JSON.parse(fs.readFileSync(GOLFERS_FILE, 'utf8'));
  res.json(golfers);
});

// GET refresh status
app.get('/api/refresh-status', (req, res) => {
  res.json(getRefreshStatus());
});

// GET all submissions
app.get('/api/submissions', async (req, res) => {
  const { data, error } = await supabase
    .from('submissions')
    .select('*')
    .order('submitted_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });

  const submissions = data.map(row => ({
    id: row.id,
    userName: row.user_name,
    entryName: row.entry_name || '',
    golfers: row.golfers,
    winningGolfer: row.winning_golfer || null,
    winningScore: row.winning_score != null ? row.winning_score : null,
    submittedAt: row.submitted_at
  }));
  res.json(submissions);
});

// POST a new fivesome submission
app.post('/api/submissions', async (req, res) => {
  const { userName, entryName, golfers, winningGolfer, winningScore } = req.body;

  if (!userName || !userName.trim()) {
    return res.status(400).json({ error: 'Name is required' });
  }
  if (!golfers || golfers.length !== 5) {
    return res.status(400).json({ error: 'You must select exactly 5 golfers' });
  }

  const { data: existing, error: countErr } = await supabase
    .from('submissions')
    .select('id')
    .ilike('user_name', userName.trim());

  if (countErr) return res.status(500).json({ error: countErr.message });

  if (existing.length >= 1) {
    return res.status(400).json({ error: 'You already have an entry submitted!' });
  }

  const newId = Date.now().toString();

  if (!entryName || !entryName.trim()) {
    return res.status(400).json({ error: 'Entry name is required' });
  }

  const row = {
    id: newId,
    user_name: userName.trim(),
    entry_name: entryName.trim(),
    golfers,
    winning_golfer: winningGolfer ? winningGolfer.trim() : null,
    winning_score: winningScore != null ? Number(winningScore) : null
  };

  const { data, error } = await supabase
    .from('submissions')
    .insert(row)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  res.status(201).json({
    id: data.id,
    userName: data.user_name,
    entryName: data.entry_name || '',
    golfers: data.golfers,
    winningGolfer: data.winning_golfer || null,
    winningScore: data.winning_score != null ? data.winning_score : null,
    submittedAt: data.submitted_at
  });

  // Trigger a stats refresh in the background after submission (if not already refreshed this window)
  if (canRefresh('stats')) {
    refreshStatsInBackground();
  }
});

// Shared helper: check if the configured tournament is live or finished
async function isTournamentLocked() {
  try {
    const res = await fetch(`${ESPN_PGA}/scoreboard/${TOURNAMENT.espnEventId}`);
    const data = await res.json();
    const evt = data.events?.[0] || data;
    const state = evt?.status?.type?.state || evt?.competitions?.[0]?.status?.type?.state;
    if (state === 'in' || state === 'post') return true;
  } catch {
    // If ESPN check fails, allow the action rather than locking everyone out
  }
  return false;
}

// PUT (edit) a submission (blocked once the tournament is live, unless admin)
app.put('/api/submissions/:id', async (req, res) => {
  const isAdmin = req.query.admin === '1';

  if (!isAdmin && await isTournamentLocked()) {
    return res.status(403).json({ error: `Entries are locked — ${TOURNAMENT.name} has started!` });
  }

  const { entryName, golfers, winningGolfer, winningScore } = req.body;

  if (!golfers || golfers.length !== 5) {
    return res.status(400).json({ error: 'You must select exactly 5 golfers' });
  }

  const updates = {
    golfers,
    winning_golfer: winningGolfer ? winningGolfer.trim() : null,
    winning_score: winningScore != null ? Number(winningScore) : null
  };
  if (entryName !== undefined) updates.entry_name = entryName.trim();

  const { data, error } = await supabase
    .from('submissions')
    .update(updates)
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  res.json({
    id: data.id,
    userName: data.user_name,
    entryName: data.entry_name || '',
    golfers: data.golfers,
    winningGolfer: data.winning_golfer || null,
    winningScore: data.winning_score != null ? data.winning_score : null,
    submittedAt: data.submitted_at
  });
});

// DELETE a submission (blocked once the tournament is live, unless admin)
app.delete('/api/submissions/:id', async (req, res) => {
  const isAdmin = req.query.admin === '1';

  if (!isAdmin && await isTournamentLocked()) {
    return res.status(403).json({ error: `Entries are locked — ${TOURNAMENT.name} has started!` });
  }

  const { error } = await supabase
    .from('submissions')
    .delete()
    .eq('id', req.params.id);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// GET field entries (the competition — stored in a JSON file, easy to replace)
app.get('/api/field-entries', (req, res) => {
  try {
    const entries = JSON.parse(fs.readFileSync(FIELD_ENTRIES_FILE, 'utf8'));
    res.json(entries);
  } catch {
    res.json([]);
  }
});

// ============================================================
// ODDS API REFRESH
// ============================================================

// Core odds refresh logic (reusable from endpoint and startup)
async function refreshOddsCore() {
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) throw new Error('ODDS_API_KEY not configured');

  const url = `https://api.the-odds-api.com/v4/sports/${TOURNAMENT.oddsSportKey}/odds?apiKey=${apiKey}&regions=us&markets=outrights&oddsFormat=american`;
  const response = await fetch(url);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Odds API error: ${text}`);
  }

  const oddsData = await response.json();
  const remaining = response.headers.get('x-requests-remaining');

  const allBookmakers = oddsData[0]?.bookmakers || [];
  if (!allBookmakers.length) throw new Error(`No odds data available for ${TOURNAMENT.name} right now`);

  // The event name the odds feed itself reports (e.g. "The Open Championship")
  const oddsEventName = oddsData[0]?.sport_title || TOURNAMENT.name;

  // Merge outcomes across all bookmakers so no golfer is falsely marked withdrawn
  // Use the first bookmaker's odds as the canonical price, but track all names seen
  const outcomesMap = new Map();
  allBookmakers.forEach(bk => {
    const mkts = bk.markets.find(m => m.key === 'outrights')?.outcomes || [];
    mkts.forEach(o => {
      if (!outcomesMap.has(o.name)) {
        outcomesMap.set(o.name, o);
      }
    });
  });
  const outcomes = Array.from(outcomesMap.values());
  const bookmaker = allBookmakers[0];

  const golfers = JSON.parse(fs.readFileSync(GOLFERS_FILE, 'utf8'));
  const nameIndex = buildNameIndex(golfers);

  let matched = 0;
  let added = [];
  let unmatched = [];

  // Track which golfers appear in the API response
  const seenInApi = new Set();

  outcomes.forEach(outcome => {
    const idx = findGolferIndex(nameIndex, outcome.name);
    const oddsVal = outcome.price > 0 ? `+${outcome.price}` : `${outcome.price}`;
    if (idx >= 0) {
      if (!golfers[idx].openingOdds) {
        golfers[idx].openingOdds = oddsVal;   // first real line seen becomes the "opening" line
      }
      golfers[idx].odds = oddsVal;
      golfers[idx].withdrawn = false;
      seenInApi.add(idx);
      matched++;
    } else {
      // Auto-add new golfer from the odds market
      const newGolfer = {
        name: outcome.name,
        ranking: null,
        odds: oddsVal,
        form: { events: 0, wins: 0, top10s: 0, cuts: 0, avg: null },
        augusta: {},
        birthYear: null,
        openingOdds: oddsVal,
        withdrawn: false
      };
      golfers.push(newGolfer);
      seenInApi.add(golfers.length - 1);
      added.push(outcome.name);
    }
  });

  // Remove duplicate entries that snuck in from API name mismatches
  const seenNames = new Set();
  for (let i = golfers.length - 1; i >= 0; i--) {
    const key = resolveAlias(golfers[i].name);
    if (seenNames.has(key)) {
      golfers.splice(i, 1);
      // Adjust seenInApi indices
    } else {
      seenNames.add(key);
    }
  }

  // Rebuild seenInApi after dedup (re-match against cleaned list)
  const cleanIndex = buildNameIndex(golfers);
  const cleanSeen = new Set();
  outcomes.forEach(outcome => {
    const idx = findGolferIndex(cleanIndex, outcome.name);
    if (idx >= 0) cleanSeen.add(idx);
  });

  // NOTE: withdrawn status is driven by ESPN field membership (refreshFieldCore), NOT by
  // odds-market presence — the betting market is often a subset of the full field, so
  // absence here must not withdraw a legitimate entrant. (cleanSeen retained for logging.)
  void cleanSeen;

  fs.writeFileSync(GOLFERS_FILE, JSON.stringify(golfers, null, 2));

  const status = getRefreshStatus();
  status.oddsUpdatedAt = new Date().toISOString();
  status.oddsSource = bookmaker.title;
  status.oddsEvent = oddsEventName;
  status.oddsLastWindow = getRefreshWindow();
  saveRefreshStatus(status);

  const withdrawn = golfers.filter(g => g.withdrawn).map(g => g.name);
  return { matched, added, unmatched, withdrawn, source: bookmaker.title, requestsRemaining: remaining, updatedAt: status.oddsUpdatedAt };
}

app.post('/api/refresh-odds', async (req, res) => {
  if (!canRefresh('odds')) {
    return res.status(429).json({ error: `Odds already refreshed this window. Next refresh available at ${getNextWindowTime()}` });
  }

  try {
    const result = await refreshOddsCore();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: `Failed to fetch odds: ${err.message}` });
  }
});

// ============================================================
// ESPN STATS REFRESH
// ============================================================

const ESPN_PGA = 'https://site.api.espn.com/apis/site/v2/sports/golf/pga';
const ESPN_EUR = 'https://site.api.espn.com/apis/site/v2/sports/golf/eur';
const ESPN_LIV = 'https://site.api.espn.com/apis/site/v2/sports/golf/liv';

// PGA form is pulled from ALL completed 2026 PGA events (no hardcoded list), so
// "recent form" tracks the current season automatically — same as the DP World/LIV feeds.

// Fetch completed event IDs from an ESPN tour endpoint
async function getCompletedEventIds(baseUrl, knownIds) {
  try {
    const res = await fetch(`${baseUrl}/scoreboard?dates=2026&limit=60`);
    const data = await res.json();
    const completed = [];
    for (const evt of (data.events || [])) {
      const id = parseInt(evt.id);
      if (knownIds && !knownIds.includes(id)) continue;
      if (evt.status?.type?.completed) completed.push(id);
    }
    return completed;
  } catch {
    return [];
  }
}

// Fetch leaderboard for a single event
async function fetchLeaderboard(baseUrl, id) {
  try {
    const res = await fetch(`${baseUrl}/scoreboard/${id}`);
    const data = await res.json();
    const evt = data.events?.[0] || data;
    const competition = evt.competitions?.[0];
    const competitors = competition?.competitors || [];
    const name = evt.name || evt.shortName || `Event ${id}`;
    return { id, name, competitors };
  } catch {
    return { id, name: `Event ${id}`, competitors: [] };
  }
}

// Core stats refresh logic (reusable from endpoint and post-submission)
async function refreshStatsCore() {
  // Fetch PGA Tour completed events (no ID filter — take the most recent completed)
  const pgaCompleted = await getCompletedEventIds(ESPN_PGA, null);
  const pgaRecent = pgaCompleted.slice(-9);

  // Fetch DP World Tour completed events (no ID filter — take all completed)
  const eurCompleted = await getCompletedEventIds(ESPN_EUR, null);
  const eurRecent = eurCompleted.slice(-6);

  // Fetch LIV Golf completed events (no ID filter — take all completed)
  const livCompleted = await getCompletedEventIds(ESPN_LIV, null);
  const livRecent = livCompleted.slice(-6);

  // Fetch all leaderboards in parallel
  const leaderboards = await Promise.all([
    ...pgaRecent.map(id => fetchLeaderboard(ESPN_PGA, id)),
    ...eurRecent.map(id => fetchLeaderboard(ESPN_EUR, id)),
    ...livRecent.map(id => fetchLeaderboard(ESPN_LIV, id))
  ]);

  const golfers = JSON.parse(fs.readFileSync(GOLFERS_FILE, 'utf8'));
  const nameIndex = buildNameIndex(golfers);

  const formData = {};
  const espnIds = {};

  for (const lb of leaderboards) {
    for (const comp of lb.competitors) {
      const fullName = comp.athlete?.fullName || comp.athlete?.displayName;
      if (!fullName) continue;

      // Collect ESPN athlete IDs for birth year lookups
      const espnId = comp.id || comp.athlete?.id;
      if (espnId) {
        espnIds[resolveAlias(fullName)] = espnId;
      }

      const norm = normalizeName(fullName);
      const idx = nameIndex[norm];
      if (idx === undefined) continue;

      if (!formData[norm]) {
        formData[norm] = { events: 0, wins: 0, top10s: 0, cuts: 0, scores: [], recentFinishes: [] };
      }

      const fd = formData[norm];
      fd.events++;

      const position = parseInt(comp.order || comp.status?.position?.id || '999');
      const linescores = comp.linescores || [];
      const roundsPlayed = linescores.length;

      if (roundsPlayed >= 4) {
        fd.cuts++;
        if (position === 1) fd.wins++;
        if (position <= 10) fd.top10s++;
      }

      for (const round of linescores) {
        const val = parseFloat(round.value);
        if (!isNaN(val)) fd.scores.push(val);
      }

      fd.recentFinishes.push(position);
    }
  }

  let updated = 0;
  for (const [norm, fd] of Object.entries(formData)) {
    const idx = nameIndex[norm];
    if (idx === undefined) continue;

    const avg = fd.scores.length > 0
      ? Math.round((fd.scores.reduce((a, b) => a + b, 0) / fd.scores.length) * 10) / 10
      : null;

    golfers[idx].form = {
      events: fd.events,
      wins: fd.wins,
      top10s: fd.top10s,
      cuts: fd.cuts,
      avg
    };

    golfers[idx].recentFinishes = fd.recentFinishes.slice(-3);
    updated++;
  }

  // Auto-fill missing birth years from ESPN athlete profiles
  const missingBY = golfers
    .map((g, i) => ({ g, i }))
    .filter(({ g }) => !g.birthYear);

  console.log(`Birth year lookup: ${missingBY.length} golfers missing birthYear`);

  let birthYearsFound = 0;
  for (const { g, i } of missingBY) {
    const key = resolveAlias(g.name);
    const espnId = espnIds[key];
    let year = null;
    if (espnId) {
      year = await fetchBirthYearById(espnId);
    }
    // Fallback: search ESPN by name (covers LIV, amateurs, past champions)
    if (!year) {
      year = await fetchBirthYearByName(g.name);
    }
    if (year) {
      golfers[i].birthYear = year;
      birthYearsFound++;
      console.log(`  Found birthYear for ${g.name}: ${year}`);
    } else {
      console.log(`  FAILED to find birthYear for ${g.name}`);
    }
  }
  console.log(`Birth year lookup complete: ${birthYearsFound}/${missingBY.length} found`);

  fs.writeFileSync(GOLFERS_FILE, JSON.stringify(golfers, null, 2));

  const status = getRefreshStatus();
  status.statsUpdatedAt = new Date().toISOString();
  status.statsLastWindow = getRefreshWindow();
  status.tournamentsScanned = leaderboards.map(lb => lb.name);
  saveRefreshStatus(status);

  return { tournamentsScanned: leaderboards.length, tournaments: leaderboards.map(lb => lb.name), golfersUpdated: updated, updatedAt: status.statsUpdatedAt };
}

function refreshStatsInBackground() {
  refreshStatsCore().catch(err => console.error('Background stats refresh failed:', err.message));
}

// ============================================================
// ESPN FIELD — who is actually playing this week (source of truth for the pick list)
// ============================================================

// Light in-memory cache so /api/field doesn't hit ESPN on every page load.
let fieldCache = { window: null, data: null };

// Fetch the entrant list for the configured event straight from ESPN.
async function fetchOpenField() {
  const res = await fetch(`${ESPN_PGA}/scoreboard/${TOURNAMENT.espnEventId}`);
  if (!res.ok) throw new Error(`ESPN field HTTP ${res.status}`);
  const data = await res.json();
  const evt = data.events?.[0] || data;            // per-event endpoint returns the event at top level
  const competitors = evt.competitions?.[0]?.competitors || [];
  const tournamentName = evt.name || evt.shortName || TOURNAMENT.name;
  const entrants = competitors.map(c => {
    const a = c.athlete || {};
    const countryName = a.flag?.alt || null;
    return {
      name: a.displayName || a.fullName,
      fullName: a.fullName || a.displayName,
      espnId: c.id || a.id || null,
      country: countryName ? (COUNTRY_NAME_TO_CODE[countryName] || null) : null,
    };
  }).filter(e => e.name);
  return { tournamentName, entrants };
}

// Rebuild golfers.json from the ESPN field so the roster == who's playing. Existing
// birthYear/form/ranking are preserved by name; odds reset until the market opens.
async function refreshFieldCore() {
  const { tournamentName, entrants } = await fetchOpenField();
  if (!entrants.length) throw new Error('ESPN returned no entrants for the configured event');

  let existing = [];
  try { existing = JSON.parse(fs.readFileSync(GOLFERS_FILE, 'utf8')); } catch { /* first run */ }
  const prevIndex = buildNameIndex(existing);

  const golfers = entrants.map(e => {
    const key = resolveAlias(e.name);
    const prev = prevIndex[key] !== undefined ? existing[prevIndex[key]] : null;
    return {
      name: e.name,                                // canonical = ESPN displayName (matches scoring)
      ranking: prev?.ranking ?? null,
      odds: '',                                    // filled by the odds refresh once the market opens
      form: prev?.form || { events: 0, wins: 0, top10s: 0, cuts: 0, avg: null },
      birthYear: prev?.birthYear ?? null,
      openingOdds: null,
      withdrawn: false,
      recentFinishes: prev?.recentFinishes || [],
      country: e.country || prev?.country || null,
      espnId: e.espnId || prev?.espnId || null,
    };
  });

  fs.writeFileSync(GOLFERS_FILE, JSON.stringify(golfers, null, 2));

  const status = getRefreshStatus();
  status.tournamentName = tournamentName;
  status.fieldUpdatedAt = new Date().toISOString();
  status.fieldCount = entrants.length;
  saveRefreshStatus(status);

  fieldCache = {
    window: getRefreshWindow(),
    data: { tournamentName, entrants: entrants.map(e => e.name), updatedAt: status.fieldUpdatedAt },
  };
  return { tournamentName, count: entrants.length, updatedAt: status.fieldUpdatedAt };
}

// GET the current field (entrant names + tournament name) — powers the client pick gate.
app.get('/api/field', async (req, res) => {
  try {
    if (fieldCache.data && fieldCache.window === getRefreshWindow()) {
      return res.json(fieldCache.data);
    }
    const { tournamentName, entrants } = await fetchOpenField();
    const data = { tournamentName, entrants: entrants.map(e => e.name), updatedAt: new Date().toISOString() };
    fieldCache = { window: getRefreshWindow(), data };
    res.json(data);
  } catch (err) {
    // Fall back to the last recorded field name; empty entrants means the client keeps its fallback list
    const status = getRefreshStatus();
    res.json({ tournamentName: status.tournamentName || TOURNAMENT.name, entrants: [], updatedAt: status.fieldUpdatedAt || null, error: err.message });
  }
});

app.post('/api/refresh-stats', async (req, res) => {
  try {
    const result = await refreshStatsCore();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: `Failed to refresh stats: ${err.message}` });
  }
});

// ============================================================
// LIVE TOURNAMENT LEADERBOARD
// ============================================================

// Cut line is not exposed by ESPN's JSON APIs — only rendered on the leaderboard web
// page. We scrape it from the page for THIS event and cache it. Confirming espnEventId
// is present in the returned HTML guards against ESPN redirecting to a different event.
let cutLineCache = { value: null, fetchedAt: 0 };
const CUT_LINE_TTL_MS = 5 * 60 * 1000; // refetch at most every 5 minutes

async function getCutLine() {
  // Manual override in config always wins.
  if (TOURNAMENT.cutLine != null) return TOURNAMENT.cutLine;

  const now = Date.now();
  if (cutLineCache.value != null && (now - cutLineCache.fetchedAt) < CUT_LINE_TTL_MS) {
    return cutLineCache.value;
  }

  try {
    const url = `https://www.espn.com/golf/leaderboard?tournamentId=${TOURNAMENT.espnEventId}`;
    const pageRes = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } });
    if (!pageRes.ok) return cutLineCache.value; // keep last known on error
    const html = await pageRes.text();

    // Confirm ESPN served the event we asked for (no redirect to a featured event).
    if (!html.includes(String(TOURNAMENT.espnEventId))) return cutLineCache.value;

    // Anchor to the final post-cut message so we never read a moving "projected cut"
    // shown earlier in the event (both use the same cut-score span):
    //   ...failed to make the cut at <span class="cut-score">+1</span>
    const m = html.match(/make the cut at[\s\S]{0,40}?<span class="cut-score">([+\-]?\d+|E)<\/span>/);
    if (m) {
      const cl = m[1] === 'E' ? 0 : parseInt(m[1], 10);
      if (!Number.isNaN(cl)) cutLineCache = { value: cl, fetchedAt: now };
    }
    return cutLineCache.value; // null until the cut is actually posted
  } catch (err) {
    console.error('Cut-line scrape failed:', err.message);
    return cutLineCache.value;
  }
}

app.get('/api/live-leaderboard', async (req, res) => {
  try {
    // Fetch the pinned tournament directly (The Open), NOT ESPN's default
    // scoreboard — that default lags to whatever event ESPN features this week
    // (e.g. Corales Puntacana) until The Open goes live. Keeps the tracker on
    // the same event as the pick field / odds / entry lock (TOURNAMENT config).
    const lbRes = await fetch(`${ESPN_PGA}/scoreboard/${TOURNAMENT.espnEventId}`);
    const lbData = await lbRes.json();
    const evt = lbData.events?.[0] || lbData;

    if (!evt || !evt.competitions) {
      return res.json({ tournament: null, competitors: [], scoreMap: {} });
    }

    // Downstream code reads the resolved event object as `event`
    const event = evt;
    const competition = evt.competitions?.[0] || {};
    const competitors = competition.competitors || [];

    const scoreMap = {};

    // Competition period tells us which round the tournament is in
    const competitionPeriod = competition.status?.period || 1;

    // Cut line, scraped from ESPN's page for this event (null until the cut is posted).
    const cutLine = await getCutLine();

    const competitorList = competitors.map((c, idx) => {
      const displayName = c.athlete?.displayName || c.athlete?.fullName || 'Unknown';
      const scoreStr = c.score || 'E';
      let scoreToPar = 0;
      if (scoreStr !== 'E') scoreToPar = parseInt(scoreStr) || 0;

      // Round scores (completed rounds only — 18 holes or value with no hole detail)
      // Exclude "not started" rounds where ESPN sends value=0 with no hole data
      const rounds = (c.linescores || [])
        .filter(ls => ls.value != null && ls.value > 0 && ((ls.linescores?.length || 0) === 18 || (ls.linescores?.length || 0) === 0))
        .map(ls => ({ round: ls.period, strokes: ls.value, toPar: ls.displayValue }));

      // Determine "thru" and round status from linescores
      // ESPN structure: each linescore = one round
      //   Completed round: value = total strokes, linescores = 18 holes
      //   Mid-round: value = partial strokes, linescores = holes completed (1-17)
      //   Not started: value = undefined, no nested linescores
      let thru = 'F';
      let todayScore = null;
      let teeTime = null;
      let currentPeriod = null;

      const roundScores = c.linescores || [];

      // Find the latest round with activity
      // Walk rounds in reverse to find current state
      let foundMidRound = false;
      let foundNotStarted = false;
      let completedRounds = 0;

      for (const ls of roundScores) {
        const holeCount = ls.linescores ? ls.linescores.length : 0;

        if ((ls.value == null || (ls.value === 0 && holeCount === 0)) && holeCount === 0) {
          // Not started this round (ESPN sends value=0 with no hole data for unstarted rounds)
          foundNotStarted = true;
          currentPeriod = ls.period;
        } else if (holeCount > 0 && holeCount < 18) {
          // Mid-round: has some holes but not all 18
          foundMidRound = true;
          thru = String(holeCount);
          currentPeriod = ls.period;
          // Calculate today's score from hole-by-hole data
          todayScore = ls.linescores.reduce((sum, h) => {
            const v = parseInt(h.scoreType?.displayValue);
            return isNaN(v) ? sum : sum + v;
          }, 0);
        } else if (holeCount === 18 || (ls.value != null && ls.value > 0 && holeCount === 0)) {
          // Completed round (18 holes, or has a non-zero value but no hole detail)
          completedRounds++;
        }
      }

      if (foundMidRound) {
        // thru already set above
      } else if (foundNotStarted) {
        thru = '-';
      } else {
        // All rounds are complete — thru stays 'F'
        currentPeriod = completedRounds;
      }

      // For completed rounds, set currentPeriod to the number of completed rounds
      if (!currentPeriod && completedRounds > 0) {
        currentPeriod = completedRounds;
      }

      // Extract today's round strokes for completed current round
      // (displayValue from the most recent completed round)
      let todayStrokes = null;
      if (thru === 'F' && roundScores.length > 0) {
        const lastCompleted = [...roundScores].reverse().find(ls => ls.value != null && ls.value > 0);
        if (lastCompleted) {
          todayStrokes = lastCompleted.value;
        }
      } else if (foundMidRound) {
        // For mid-round, todayStrokes is the partial stroke count
        const midRound = roundScores.find(ls => (ls.linescores?.length || 0) > 0 && (ls.linescores?.length || 0) < 18);
        if (midRound) todayStrokes = midRound.value;
      }

      // Extract tee time if available
      if (c.status?.teeTime) {
        teeTime = c.status.teeTime;
      } else if (c.status?.startDate) {
        teeTime = c.status.startDate;
      }
      // ESPN embeds tee time in the not-started round's statistics (last stat entry)
      if (!teeTime && foundNotStarted) {
        const notStartedRound = roundScores.find(ls => {
          const hc = ls.linescores ? ls.linescores.length : 0;
          return (ls.value == null || (ls.value === 0 && hc === 0)) && hc === 0;
        });
        const stats = notStartedRound?.statistics?.categories?.[0]?.stats;
        if (stats && stats.length > 0) {
          const lastStat = stats[stats.length - 1];
          if (lastStat.displayValue && /\d{4}/.test(lastStat.displayValue)) {
            teeTime = lastStat.displayValue;
          }
        }
      }

      // Player status
      let playerStatus = 'active';
      if (c.status?.type?.name === 'cut' || c.status?.type?.name === 'STATUS_CUT' || c.status?.period === 99) {
        playerStatus = 'cut';
      } else if (c.status?.type?.name === 'wd' || c.status?.type?.description === 'Withdrawn') {
        playerStatus = 'wd';
      }
      // Heuristic: when tournament is in R3+, golfers with no R3/R4 linescore entries were CUT
      if (playerStatus === 'active' && competitionPeriod >= 3) {
        const maxRound = Math.max(...roundScores.map(ls => ls.period || 0), 0);
        if (maxRound <= 2) {
          playerStatus = 'cut';
        }
      }
      // Authoritative cut detection via the scraped cut line. A player whose 36-hole
      // (R1+R2) score is worse than the line missed the cut. This uses the through-36
      // total, NOT the current cumulative score, so a golfer who made the cut and then
      // plays a poor R3 stays "active" — only the first two rounds decide the cut. Fixes
      // the case where ESPN's API still marks cut players "active" with a phantom R3 round.
      if (playerStatus === 'active' && cutLine != null) {
        const toParNum = (dv) => (dv === 'E' || dv == null) ? 0 : (parseInt(dv, 10) || 0);
        const r1 = rounds.find(r => r.round === 1);
        const r2 = rounds.find(r => r.round === 2);
        if (r1 && r2) {
          const through36 = toParNum(r1.toPar) + toParNum(r2.toPar);
          if (through36 > cutLine) playerStatus = 'cut';
        }
      }

      // Extract hole-by-hole data for the current/latest round
      let holes = [];
      const currentRoundLS = foundMidRound
        ? roundScores.find(ls => (ls.linescores?.length || 0) > 0 && (ls.linescores?.length || 0) < 18)
        : roundScores.filter(ls => ls.linescores?.length === 18).pop();
      if (currentRoundLS?.linescores) {
        holes = currentRoundLS.linescores.map(h => ({
          hole: h.period,
          strokes: h.value,
          toPar: h.scoreType?.displayValue || 'E'
        }));
      }

      const entry = {
        name: displayName,
        score: scoreToPar,
        scoreDisplay: scoreStr === 'E' ? 'E' : (scoreToPar > 0 ? `+${scoreToPar}` : String(scoreToPar)),
        position: idx + 1,
        rounds,
        thru,
        teeTime,
        currentPeriod,
        todayStrokes: todayStrokes,
        today: todayScore !== null ? (todayScore > 0 ? `+${todayScore}` : todayScore === 0 ? 'E' : String(todayScore)) : null,
        status: playerStatus,
        holes
      };

      // Build scoreMap keyed by normalized name for client-side matching
      const normKey = resolveAlias(displayName);
      scoreMap[normKey] = entry;

      return entry;
    });

    // Derive course pars from hole-by-hole data (first golfer with 18 holes)
    let coursePars = null;
    for (const comp of competitorList) {
      if (comp.holes && comp.holes.length === 18) {
        coursePars = {};
        for (const h of comp.holes) {
          const toParNum = h.toPar === 'E' ? 0 : parseInt(h.toPar) || 0;
          coursePars[h.hole] = h.strokes - toParNum;
        }
        break;
      }
    }

    res.json({
      tournament: {
        name: event.name || event.shortName,
        id: event.id,
        status: event.status?.type?.description || 'Unknown',
        detail: event.status?.type?.detail || '',
        state: event.status?.type?.state
      },
      competitors: competitorList,
      scoreMap,
      coursePars
    });
  } catch (err) {
    res.status(500).json({ error: `Failed to fetch live leaderboard: ${err.message}` });
  }
});

app.listen(PORT, () => {
  console.log(`${TOURNAMENT.name} Fivesome Picker running at http://localhost:${PORT}`);

  // On startup (and Render cold starts): seed the field from ESPN first so the roster
  // exists, then enrich with stats, then odds (a no-op until the betting market opens).
  (async () => {
    try {
      console.log('Triggering startup field refresh...');
      const f = await refreshFieldCore();
      console.log(`Startup field refresh complete: ${f.count} entrants (${f.tournamentName})`);
    } catch (err) { console.error('Startup field refresh failed:', err.message); }

    try {
      console.log('Triggering startup stats refresh...');
      const s = await refreshStatsCore();
      console.log(`Startup stats refresh complete: ${s.golfersUpdated} golfers updated`);
    } catch (err) { console.error('Startup stats refresh failed:', err.message); }

    try {
      console.log('Triggering startup odds refresh...');
      const o = await refreshOddsCore();
      console.log(`Startup odds refresh complete: ${o.matched} matched, ${o.added.length} added (${o.source})`);
    } catch (err) { console.error('Startup odds refresh failed:', err.message); }
  })();
});
