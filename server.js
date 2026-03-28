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

// --- Name normalization for matching across APIs ---
function normalizeName(name) {
  return name
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')  // strip accents
    .replace(/[.\-']/g, '')                             // strip dots, hyphens, apostrophes
    .replace(/\s+/g, ' ')                               // collapse whitespace
    .trim()
    .toLowerCase();
}

function buildNameIndex(golfers) {
  const index = {};
  golfers.forEach((g, i) => {
    index[normalizeName(g.name)] = i;
  });
  return index;
}

function findGolferIndex(nameIndex, apiName) {
  return nameIndex[normalizeName(apiName)] ?? -1;
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
    submittedAt: row.submitted_at
  }));
  res.json(submissions);
});

// POST a new fivesome submission
app.post('/api/submissions', async (req, res) => {
  const { userName, entryName, golfers } = req.body;

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

  if (existing.length >= 3) {
    return res.status(400).json({ error: 'You already have 3 fivesomes submitted!' });
  }

  const newId = Date.now().toString();

  if (!entryName || !entryName.trim()) {
    return res.status(400).json({ error: 'Entry name is required' });
  }

  const row = { id: newId, user_name: userName.trim(), entry_name: entryName.trim(), golfers };

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
    submittedAt: data.submitted_at
  });

  // Trigger a stats refresh in the background after submission (if not already refreshed this window)
  if (canRefresh('stats')) {
    refreshStatsInBackground();
  }
});

// DELETE a submission
app.delete('/api/submissions/:id', async (req, res) => {
  const { error } = await supabase
    .from('submissions')
    .delete()
    .eq('id', req.params.id);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ============================================================
// ODDS API REFRESH
// ============================================================

app.post('/api/refresh-odds', async (req, res) => {
  if (!canRefresh('odds')) {
    return res.status(429).json({ error: `Odds already refreshed this window. Next refresh available at ${getNextWindowTime()}` });
  }

  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ODDS_API_KEY not configured in .env' });
  }

  try {
    const url = `https://api.the-odds-api.com/v4/sports/golf_masters_tournament_winner/odds?apiKey=${apiKey}&regions=us&markets=outrights&oddsFormat=american`;
    const response = await fetch(url);

    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({ error: `Odds API error: ${text}` });
    }

    const oddsData = await response.json();
    const remaining = response.headers.get('x-requests-remaining');

    // Use the first bookmaker's outrights
    const bookmaker = oddsData[0]?.bookmakers?.[0];
    if (!bookmaker) {
      return res.status(404).json({ error: 'No odds data available for the Masters right now' });
    }

    const outcomes = bookmaker.markets.find(m => m.key === 'outrights')?.outcomes || [];

    // Load golfers and build name index
    const golfers = JSON.parse(fs.readFileSync(GOLFERS_FILE, 'utf8'));
    const nameIndex = buildNameIndex(golfers);

    let matched = 0;
    let unmatched = [];

    outcomes.forEach(outcome => {
      const idx = findGolferIndex(nameIndex, outcome.name);
      if (idx >= 0) {
        const oddsVal = outcome.price > 0 ? `+${outcome.price}` : `${outcome.price}`;
        // Preserve opening odds — only set once
        if (!golfers[idx].openingOdds) {
          golfers[idx].openingOdds = golfers[idx].odds;
        }
        golfers[idx].odds = oddsVal;
        matched++;
      } else {
        unmatched.push(outcome.name);
      }
    });

    // Save updated golfers
    fs.writeFileSync(GOLFERS_FILE, JSON.stringify(golfers, null, 2));

    // Update status
    const status = getRefreshStatus();
    status.oddsUpdatedAt = new Date().toISOString();
    status.oddsSource = bookmaker.title;
    status.oddsLastWindow = getRefreshWindow();
    saveRefreshStatus(status);

    res.json({
      success: true,
      matched,
      unmatched,
      source: bookmaker.title,
      requestsRemaining: remaining,
      updatedAt: status.oddsUpdatedAt
    });
  } catch (err) {
    res.status(500).json({ error: `Failed to fetch odds: ${err.message}` });
  }
});

// ============================================================
// ESPN STATS REFRESH
// ============================================================

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/golf/pga';

// 2026 PGA Tour event IDs (The Sentry through Valero Texas Open)
const TOURNAMENT_IDS = [
  401811927, // The Sentry
  401811928, // Sony Open
  401811929, // The American Express
  401811930, // Farmers Insurance Open
  401811931, // WM Phoenix Open
  401811932, // AT&T Pebble Beach
  401811933, // Genesis Invitational
  401811934, // Cognizant Classic
  401811935, // Arnold Palmer Invitational
  401811936, // Puerto Rico Open
  401811937, // THE PLAYERS Championship
  401811938, // Valspar Championship
  401811939, // Houston Open
  401811940, // Valero Texas Open
];

// Core stats refresh logic (reusable from endpoint and post-submission)
async function refreshStatsCore() {
  const scheduleRes = await fetch(`${ESPN_BASE}/scoreboard?dates=2026&limit=20`);
  const scheduleData = await scheduleRes.json();
  const events = scheduleData.events || [];

  const completedIds = [];
  for (const evt of events) {
    const id = parseInt(evt.id);
    if (!TOURNAMENT_IDS.includes(id)) continue;
    if (evt.status?.type?.completed) {
      completedIds.push(id);
    }
  }

  const recentIds = completedIds.slice(-9);

  const leaderboards = await Promise.all(
    recentIds.map(async (id) => {
      try {
        const lbRes = await fetch(`${ESPN_BASE}/scoreboard/${id}`);
        const lbData = await lbRes.json();
        const evt = lbData.events?.[0] || lbData;
        const competition = evt.competitions?.[0];
        const competitors = competition?.competitors || [];
        const name = evt.name || evt.shortName || `Event ${id}`;
        return { id, name, competitors };
      } catch {
        return { id, name: `Event ${id}`, competitors: [] };
      }
    })
  );

  const golfers = JSON.parse(fs.readFileSync(GOLFERS_FILE, 'utf8'));
  const nameIndex = buildNameIndex(golfers);

  const formData = {};

  for (const lb of leaderboards) {
    for (const comp of lb.competitors) {
      const fullName = comp.athlete?.fullName || comp.athlete?.displayName;
      if (!fullName) continue;

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

app.post('/api/refresh-stats', async (req, res) => {
  if (!canRefresh('stats')) {
    return res.status(429).json({ error: `Stats already refreshed this window. Next refresh available at ${getNextWindowTime()}` });
  }

  try {
    const result = await refreshStatsCore();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: `Failed to refresh stats: ${err.message}` });
  }
});

app.listen(PORT, () => {
  console.log(`Masters Fivesome Picker running at http://localhost:${PORT}`);
});
