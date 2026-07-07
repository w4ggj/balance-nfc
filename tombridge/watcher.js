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

function latestBySuffix(dir, suffix) {
  let best = null, bestM = -1;
  let entries;
  try { entries = fs.readdirSync(dir); } catch { return null; }
  for (const f of entries) {
    if (!f.toLowerCase().endsWith(suffix)) continue;
    // avoid matchrecord.html matching "record.html"? suffixes are distinct here; guard match_slips
    const full = path.join(dir, f);
    let m;
    try { m = fs.statSync(full).mtimeMs; } catch { continue; }
    if (m > bestM) { bestM = m; best = full; }
  }
  return best;
}

function collectReports() {
  const out = {};
  for (const [key, suffix] of Object.entries(SUFFIXES)) {
    const file = latestBySuffix(REPORTS_DIR, suffix);
    out[key] = file ? fs.readFileSync(file, 'utf8') : null;
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
