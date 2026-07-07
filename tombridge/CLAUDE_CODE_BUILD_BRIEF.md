# Claude Code build brief — TOM live display pages

## What this is

Build three browser display surfaces for a Pokémon tournament running in **Tournament Operations Manager (TOM)**, for Balance Gaming FL. The data pipeline that reads TOM and publishes to Firebase is **already built and tested** — do not rebuild it. Your job is the three front-end pages that subscribe to Firebase and render.

## What already exists (do not rebuild)

A tested Node package lives in `tombridge/`:

- `parser.js` — parses TOM's HTML reports. Tested against real files. Don't touch.
- `snapshot.js` — composes parsed reports into the Firebase snapshot. Don't touch.
- `watcher.js` — watches TOM's `data/reports` folder and writes the snapshot to Firebase Realtime Database at `tournaments/{tournamentId}`.
- `README.md` — **read this first.** It documents every TOM quirk (matches printed twice, JR/SR paired-but-ranked-separately, no player IDs in HTML, cut size from "Finals Players", filename prefixing, etc.).
- `config.example.json` — copy to `config.json` for the watcher.
- `sample-snapshot.json` — **a real snapshot from a live event.** Develop and test all three pages against this file offline. It is the exact shape Firebase will contain.

The snapshot is the **contract**. Read from it; never assume a different shape.

## Data model (from `sample-snapshot.json`)

Firebase RTDB path: `tournaments/{tournamentId}` (e.g. `tournaments/26-07-002866`). Shape:

```jsonc
{
  "meta": {
    "name": "Pitch Black Prerelease",
    "tournamentId": "26-07-002866",
    "gameType": "Trading Card Game",
    "mode": "Prerelease Mode",
    "round": 3,
    "generatedAt": "07/06/2026 20:30:42",  // display in the freshness footer
    "updatedMs": 1783425562746
  },
  "divisions": [
    { "id": "MA", "label": "Masters Division", "totalPlayers": 19, "totalRounds": 7, "cutSize": 0, "startingTable": 5 },
    { "id": "SR", "label": "Senior Division", "totalPlayers": 3,  "totalRounds": 5, "cutSize": 0 },
    { "id": "JR", "label": "Junior Division", "totalPlayers": 4,  "totalRounds": 5, "cutSize": 0 }
  ],
  "standings": {
    // keyed by division id — JR and SR are SEPARATE here
    "JR": { "label": "Junior Division", "round": 3, "totalRounds": 5, "cutSize": 0,
            "rows": [ { "rank": 1, "name": "Benjamin Mussett", "record": { "w":2,"l":1,"t":0,"points":6,"text":"2/1/0 (6)" },
                       "points": 6, "omw": 63.89, "oomw": 52.78, "flight": "1", "dropRound": null, "cut": false } ] },
    "SR": { ... },
    "MA": { ... }
  },
  "pairings": {
    "round": 3,
    "groups": {
      // keyed by pairing group — JR and SR are COMBINED here as "JR_SR"
      "JR_SR": {
        "label": "Junior/Senior Divisions",
        "tables": [ { "table": 2, "group": "JR_SR", "status": "paired",
                      "players": [ { "name": "Benjamin Mussett", "division": "JR", "record": {...}, "points": 6 },
                                   { "name": "Zachary Mussett",  "division": "SR", "record": {...}, "points": 6 } ] } ],
        "byes": [ { "name": "Kayden Gerke", "division": "JR", "record": {...} } ]
      },
      "MA": { ... }
    },
    "byTable": {
      // flat lookup keyed by table number — this is what the NFC tap view uses
      "2": { "table": 2, "group": "JR_SR", "status": "paired", "players": [...] }
    }
  }
}
```

Key facts to respect (details in `tombridge/README.md`):
- **Standings key by division (JR, SR, MA). Pairings key by group (JR_SR, MA).** Don't assume they align — JR/SR play together but rank apart.
- **`cutSize` is real config.** When `cutSize > 0`, rows have `cut: true` up to that rank — draw a cut line. When `cutSize == 0` (prereleases), **draw no cut line.**
- **`status` is currently always `"paired"`** — the reports carry no live per-table result. Build the status dot to render `paired | done | waiting | bye` (future values) but expect `paired` today.
- **Players are keyed by name** (no player IDs in the source).
- **`meta.generatedAt`** is the freshness stamp — every page shows it. Never present posted data as per-second live.

## Pages to build

All three are static HTML/JS subscribing to Firebase Realtime Database (read-only). **Match the conventions of the existing Balance Gaming FL NFC table pages** — same Firebase web SDK version, same init pattern, same hosting. Look at those pages first and mirror them. Dark theme (wall monitors, low glare). Reference visual specs below; three mockups were already designed and approved — replicate their layout.

### 1. Pairings board (`pairings.html`) — wall display
- Header bar: event name · `Round {meta.round}` · freshness (`generatedAt`).
- Body: one section per `pairings.groups` entry, titled with the group `label`.
- Within a group: tables sorted ascending. Each row: table-number badge, player 1 (name + record), `vs`, player 2 (name + record), status dot.
- Byes listed at the end of each group.
- Density: if a group has many tables, use two columns (~8 per column) so rows stay legible across a room.
- Status dot color map: `paired` → amber, `done` → green, `waiting` → gray, `bye` → neutral.

### 2. Standings board (`standings.html`) — wall display
- Header bar: event name · `After round {round}` · freshness.
- Body: one section per division in `standings` (JR, SR, MA). Section header: division `label` · player count · `top {cutSize}` — or `no top cut` when `cutSize == 0`.
- Rows: rank, name, record (`record.text` or `W-L`), points, OMW% (`omw`), OOMW% (`oomw`).
- When `cutSize > 0`: draw a cut line after the last `cut: true` row.
- Small divisions can stack in one column; a large division (like Masters, 19) gets its own column. If a division exceeds visible rows, slow auto-scroll.

### 3. NFC tap view (`table.html`) — phone
- Entry: table number from a URL param (`?table=7`) written into the NFC tag payload. Resolve via `pairings.byTable[table]`.
- Show: big table number, event · round, the pairing (both players + records), status. Then a standings peek **scoped to the division(s) at that table** — for a Masters table show Masters standings; for a JR/SR table (which can be a JR-vs-SR match) show the relevant division(s), with a link to the full standings page.
- Freshness footer, same as the boards.
- **Table-number mapping:** TOM assigns match table numbers (this event: JR/SR on 1–3, Masters on 4–12; Masters `startingTable` was 5). Ensure the physical NFC tag for each table carries the matching TOM table number. If the store's 16 physical tables don't line up 1:1 with TOM's numbering, add a `tagId → tomTable` map in config rather than assuming equality.

## Two decisions to confirm before/while building

1. **Wall layout for multiple divisions:** side-by-side sections (all divisions visible at once, as in the approved mockup) vs. auto-rotate through divisions on a timer. Default: side-by-side; add rotation only if a division list overflows the screen.
2. **Mid-round "done" status:** currently every table shows `paired` until the next standings post. If per-table "done" mid-round is wanted, extend `tombridge/parser.js` to parse `matchrecord.html` (players with a `*` have an incomplete current match; absence of `*` mid-round ⇒ done) and set `status` accordingly. Optional, later phase. Prereleases have no cut, so brackets/top-cut display is out of scope for this event type.

## Firebase / deployment

- Realtime Database, path `tournaments/{tournamentId}`. Watcher writes with `firebase-admin`; pages read with the Firebase web SDK.
- Reuse the existing Balance Gaming FL Firebase project. Standings/pairings are public info, so a public-read rule on `tournaments/` is fine; keep writes locked to the service account.
- Host the display pages wherever the current NFC pages live. Keep staff-only URLs off these public pages.
- Watcher runs on the TOM machine (Windows) at login via Task Scheduler; path auto-resolves to `%USERPROFILE%\TOM_DATA\data\reports` (or `$TOM_DATA_DIR`).

## Acceptance criteria

- `cd tombridge && node watcher.js --once --dry` prints a valid snapshot (sanity that the pipeline runs).
- All three pages render correctly from `tombridge/sample-snapshot.json` with no network (offline dev).
- Against live Firebase: editing/regenerating a TOM report causes the boards to update within ~1s of the watcher writing.
- Standings show separate JR / SR / MA sections; pairings show combined JR/SR and separate Masters; no cut line appears for this prerelease (`cutSize 0`); every page shows the `generatedAt` freshness stamp.
- Tap view resolves `?table=6` to the correct Masters pairing (Camden Schaneville vs Kevin Arputharaj in the sample).

## Do / don't

- **Do** read `tombridge/README.md` and `tombridge/sample-snapshot.json` before writing any page.
- **Do** mirror the existing NFC table pages' Firebase setup and styling.
- **Don't** modify `parser.js` / `snapshot.js` (except the optional matchrecord enhancement in decision #2).
- **Don't** write anything back to TOM or its files. TOM is read-only.
- **Don't** hardcode division names or table counts — read them from the snapshot so any event (full JR/SR/MA split, combined, or single division) just works.
