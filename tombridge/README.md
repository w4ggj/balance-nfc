# TOM Bridge — live tournament data → Firebase

Reads the HTML reports Pokémon **Tournament Operations Manager (TOM)** writes to disk, parses them, and mirrors the tournament into Firebase. Firebase then feeds the wall-display boards and the NFC tap-to-view pages on the Balance Gaming FL NFC Table System.

TOM is treated as **read-only**. This tool never writes to TOM, never edits the `.tdf`, and never injects data into a running tournament.

## Files

| File | Role |
|------|------|
| `parser.js` | Pure functions that parse each TOM report into JS objects. No I/O, no Firebase. |
| `snapshot.js` | Composes parsed reports into one Firebase-ready snapshot object. |
| `watcher.js` | Resolves the TOM path, watches the reports folder, and writes snapshots to Firebase on change. |
| `config.example.json` | Copy to `config.json` and fill in. |

## Install

```bash
npm install cheerio chokidar firebase-admin
```

(`firebase-admin` is only needed for live writes; `--dry` runs without it.)

## Configure

Copy `config.example.json` → `config.json`:

- `firebase.serviceAccountPath` — path to your Firebase service-account JSON.
- `firebase.databaseURL` — your Realtime Database URL.
- `tournamentId` — optional; if omitted, the tournament's own ID (from TOM, e.g. `26-07-002866`) is used as the Firebase key.
- `reportsDir` — optional explicit path to TOM's `data/reports`. If omitted, resolves to `%USERPROFILE%\TOM_DATA\data\reports` (or `$TOM_DATA_DIR` if set). Works on Windows and macOS via `os.homedir()`.
- `cutSizes` — optional per-division cut override, e.g. `{ "MA": 8, "default": 0 }`. If omitted, the cut size is read from TOM's "Finals Players" value per division (0 for prereleases).

## Run

```bash
node watcher.js --once --dry     # parse current reports, print snapshot, no write (test)
node watcher.js --once           # parse once, write to Firebase, exit
node watcher.js                   # watch continuously, write on every report change
```

On Windows, run the watcher at login via Task Scheduler (or `pm2`), pointing at this folder.

## How the display pages consume it

The boards and tap view are static HTML/JS that subscribe to `tournaments/{tournamentId}` in Firebase — the same pattern the existing NFC table pages use. They read:

- `standings.{JR|SR|MA}` — ranked rows, with a `cut` boolean per row when a cut size applies.
- `pairings.groups.{JR_SR|MA}` — tables and byes per pairing group.
- `pairings.byTable["7"]` — direct lookup for the NFC tap view (tag = table number → this object).
- `meta` — event name, round, and `generatedAt` for the freshness footer.

---

## What the real TOM files told us (and why it matters)

These are the facts the parser is built around — confirmed against a live prerelease, not assumed:

1. **Each match is printed twice.** `pairings.html` lists every match once from each player's perspective (Table 2 appears as A-vs-B and again as B-vs-A). The parser **dedupes by table number**, keeping the first occurrence. Byes appear once and are collected separately.

2. **JR/SR pair together but rank apart.** In `pairings.html`, Junior and Senior are one combined group ("Junior/Senior Divisions") — cross-division matches happen — with a per-player ` - JR`/` - SR` suffix. In `standings.html`, Junior and Senior are **separate** ranked lists. So pairings key on group `JR_SR` while standings key on `JR` and `SR` independently. Masters is its own group and division.

3. **Table numbers are global per round.** JR/SR used tables 1–3, Masters 4–12. Numbers don't collide across divisions, so a single `byTable` map is safe. (Note: the "Table #" column in `roster.html` is a *seating pod*, not the match table — don't use it for pairings.)

4. **No Player IDs in the HTML reports.** Players are keyed by **name** (plus division). The organizer's ID appears in `tournament_details.html`, but individual player IDs live only in the `.tdf`, not these reports.

5. **Cut size is in `tournament_details.html`.** The "Finals Players" column = the top-cut size per division (0 for this prerelease → no cut). The parser reads it; `config.cutSizes` can override.

6. **Round counts differ per division.** Standings headers read `Round 3/5` (JR/SR) vs `Round 3/7` (Masters) — the second number is that division's total rounds and can shift as TOM recalculates. Stored per division, not globally.

7. **TOM prefixes report filenames with the tournament name** (`Pitch_Black_Prereleasestandings.html`). The watcher matches by suffix and picks the newest file of each type, so multiple events' exports in one folder don't confuse it.

8. **Record format** is `W/L/T (points)`, e.g. `2/1/0 (6)`. Tiebreakers present: Opponents' Win % (OMW) and Opponents' Opponents' Win % (OOMW).

## Known limitations

- **No live per-table result status.** The reports don't flag a specific table as "done" mid-round; `status` is `paired` until the next standings post appears. The display should show the `meta.generatedAt` timestamp and treat data as "posted," not per-second live. (`matchrecord.html` marks players with an incomplete current match via `*`; parsing that is a possible future enhancement for coarse in-round status.)
- **Brackets are empty during Swiss.** `brackets.html` only populates once top cut begins, so single-elim display is a later phase.
- **Freshness = report cadence.** Everything is only as current as TOM's last report write (round boundaries, plus whenever the organizer regenerates a report).
