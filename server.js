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

// GET golfers (still from local JSON — no reason to put static data in the DB)
app.get('/api/golfers', (req, res) => {
  const golfers = JSON.parse(fs.readFileSync(GOLFERS_FILE, 'utf8'));
  res.json(golfers);
});

// GET all submissions
app.get('/api/submissions', async (req, res) => {
  const { data, error } = await supabase
    .from('submissions')
    .select('*')
    .order('submitted_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });

  // Map DB column names to what the frontend expects
  const submissions = data.map(row => ({
    id: row.id,
    userName: row.user_name,
    golfers: row.golfers,
    submittedAt: row.submitted_at
  }));
  res.json(submissions);
});

// POST a new fivesome submission
app.post('/api/submissions', async (req, res) => {
  const { userName, golfers } = req.body;

  if (!userName || !userName.trim()) {
    return res.status(400).json({ error: 'Name is required' });
  }
  if (!golfers || golfers.length !== 5) {
    return res.status(400).json({ error: 'You must select exactly 5 golfers' });
  }

  // Check if user already has 3 submissions
  const { data: existing, error: countErr } = await supabase
    .from('submissions')
    .select('id')
    .ilike('user_name', userName.trim());

  if (countErr) return res.status(500).json({ error: countErr.message });

  if (existing.length >= 3) {
    return res.status(400).json({ error: 'You already have 3 fivesomes submitted!' });
  }

  const newId = Date.now().toString();

  const { data, error } = await supabase
    .from('submissions')
    .insert({ id: newId, user_name: userName.trim(), golfers })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  res.status(201).json({
    id: data.id,
    userName: data.user_name,
    golfers: data.golfers,
    submittedAt: data.submitted_at
  });
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

app.listen(PORT, () => {
  console.log(`Masters Fivesome Picker running at http://localhost:${PORT}`);
});
