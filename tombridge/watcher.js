'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');
const { buildSnapshot } = require('./snapshot');

// ---- flags ----
const DRY = process.argv.includes('--dry');   // print snapshot, do not write to Firebase
const ONCE = process.argv.includes('--once');  // build once and exit

// ---- config ----
let config = {};
const cfgPath = path.join(__dirname, 'config.json');
if (fs.existsSync(cfgPath)) config = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));

const TOM_DATA = process.env.TOM_DATA_DIR || config.reportsRoot || path.join(os.homedir(), 'TOM_DATA');
const REPORTS_DIR = config.reportsDir || path.join(TOM_DATA, 'data', 'reports');

// TOM prefixes report files with the tournament name, e.g. "Pitch_Black_Prereleasestandings.html".
// Match by suffix and pick the most-recently-modified file of each type.
const SUFFIXES = {
  detailsHtml: 'tournament_details.html',
  standingsHtml: 'standings.html',
  pairingsHtml: 'pairings.html',
  rosterHtml: 'roster.html',
};

// Collect all reports for ONE tournament — the current (newest) event.
//
// TOM prefixes every report with the tournament name (e.g.
// "Pitch_Black_Prereleasestandings.html"). Picking the newest file of each type
// INDEPENDENTLY is wrong: a brand-new event has pairings/details but no
// standings yet, so the newest standings.html is the PREVIOUS event's, and it
// gets stapled onto the new event's snapshot (stale standings in round 1).
//
// Instead: find the newest "anchor" report (one a live event always has), take
// its tournament-name prefix, and read only the reports that share that prefix.
// A report the current event hasn't produced yet stays null — so the board
// shows "Waiting for standings…" instead of a prior event's numbers.
function statMs(f) { try { return fs.statSync(path.join(REPORTS_DIR, f)).mtimeMs; } catch { return -1; } }

function collectReports() {
  let entries;
  try { entries = fs.readdirSync(REPORTS_DIR); } catch { entries = []; }
  const lower = entries.map(f => f.toLowerCase());

  // Anchor = newest file among the types a running event always writes.
  const anchorSuffixes = [SUFFIXES.pairingsHtml, SUFFIXES.detailsHtml, SUFFIXES.standingsHtml, SUFFIXES.rosterHtml];
  let prefix = null, anchorM = -1;
  entries.forEach((f, i) => {
    const suf = anchorSuffixes.find(s => lower[i].endsWith(s));
    if (!suf) return;
    const m = statMs(f);
    if (m > anchorM) { anchorM = m; prefix = lower[i].slice(0, lower[i].length - suf.length); }
  });
  if (prefix == null) return { detailsHtml: null, standingsHtml: null, pairingsHtml: null, rosterHtml: null };

  // For each type, take the same-prefix file (newest if TOM left duplicates).
  const out = {};
  for (const [key, suffix] of Object.entries(SUFFIXES)) {
    let best = null, bestM = -1;
    entries.forEach((f, i) => {
      if (!lower[i].endsWith(suffix)) return;
      if (lower[i].slice(0, lower[i].length - suffix.length) !== prefix) return; // different tournament
      const m = statMs(f);
      if (m > bestM) { bestM = m; best = f; }
    });
    out[key] = best ? fs.readFileSync(path.join(REPORTS_DIR, best), 'utf8') : null;
  }
  return out;
}

// ---- Firebase (lazy; only when actually writing) ----
let db = null;
function getDb() {
  if (db) return db;
  const admin = require('firebase-admin');
  const svc = require(config.firebase.serviceAccountPath);
  admin.initializeApp({
    credential: admin.credential.cert(svc),
    databaseURL: config.firebase.databaseURL,
  });
  db = admin.database();
  return db;
}

async function run() {
  const reports = collectReports();
  if (!reports.standingsHtml && !reports.pairingsHtml) {
    console.warn(`[tombridge] no standings/pairings found in ${REPORTS_DIR} yet — generate a report in TOM.`);
    return;
  }
  const snap = buildSnapshot({ ...reports, config });
  const id = snap.meta.tournamentId || config.tournamentId || 'current';

  if (DRY) {
    console.log(JSON.stringify(snap, null, 2));
    return;
  }
  await getDb().ref(`tournaments/${id}`).set(snap);
  console.log(`[tombridge] wrote tournaments/${id}  round=${snap.meta.round}  updated=${new Date().toLocaleTimeString()}`);
}

// ---- debounce ----
let timer = null;
function schedule() {
  clearTimeout(timer);
  timer = setTimeout(() => { run().catch(e => console.error('[tombridge] error:', e.message)); }, 750);
}

if (ONCE) {
  run().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
} else {
  console.log(`[tombridge] watching ${REPORTS_DIR}${DRY ? ' (dry run)' : ''}`);
  chokidar
    .watch(path.join(REPORTS_DIR, '*.html'), { ignoreInitial: false, awaitWriteFinish: { stabilityThreshold: 400 } })
    .on('add', schedule)
    .on('change', schedule)
    .on('error', e => console.error('[tombridge] watch error:', e.message));
}
