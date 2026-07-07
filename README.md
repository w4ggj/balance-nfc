# Balance Gaming FL — NFC Table Landing

Mobile landing system for the NFC tags on every table. One base URL is written to
all tags; a live setting decides what customers see when they scan.

**Live URL written to every tag:**
```
https://nfc.balancegamingfl.com/?tbl=N      (N = table number, 1–16)
```
The `?tbl=N` never changes per tag — table 7's tag is always `...?tbl=7`.
(Served via GitHub Pages; the `CNAME` file in this repo binds the custom domain.
The old `https://w4ggj.github.io/balance-nfc/?tbl=N` URLs still redirect here.)

## How it works

`index.html` is a router. On every scan it reads the **active event** from a
Firebase Realtime Database and decides:

- **`main`** → shows the normal store hub. `tbl` is ignored.
- **`pokemon`** / **`onepiece`** / **`riftbound`** / **`mtg`** → forwards to that
  event page, carrying the table number, which the page shows as a big **TABLE N** badge.

Because the tags all point at the same base URL, staff switch what they show by
tapping a toggle — **no re-tagging, and no code changes, ever**.

## Turning an event on / off (staff)

1. Open **`config.html`** on your phone (bookmark it — keep the link private, it has no password).
2. **Tap** the game that's running. It goes live for every table **instantly** (writes to Firebase).
3. Tap it off (or tap another game) to switch. All off = the normal store hub.

That's it — no apps, no logins, no commits. `?hub=1` on the base URL always shows
the hub, even during an event (handy for testing).

## Files

| File | What it is |
|------|------------|
| `index.html` | Router + the store hub (the default landing) |
| `pokemon.html`, `onepiece.html`, `riftbound.html`, `mtg.html` | Event pages (one per game) |
| `tournament.html` | Player tournament page — scan a table → see your match → report the winner |
| `admin.html` | Private tournament organizer console (Swiss pairings, results, standings) |
| `config.html` | Private staff control panel — one-tap instant toggle |
| `assets/brand.css` | Shared design system — edit brand colors here once |
| `assets/app.js` | Shared logic: reads/writes the active event, parses `tbl`, routing, Firebase helpers |
| `assets/tournament.js` | Swiss engine (pairings/byes/standings) + player & admin logic |
| `assets/logo.png` | Dragon logo (favicon + header) |
| `config.json` | Legacy/manual fallback file — **no longer the live source** (Firebase is) |
| `CNAME` | Binds the custom domain `nfc.balancegamingfl.com` |

## The Firebase backend

Live event state is a single value stored in a Firebase Realtime Database, so the
control panel can change it instantly without any deploy.

- **Database URL** (set once in `assets/app.js`, `CONFIG_URL`):
  `https://balance-nfc-default-rtdb.firebaseio.com/active.json`
- **Security rules** (Realtime Database → Rules) — public read, and writes limited
  to the five valid values so the field can't be filled with junk:
  ```json
  {
    "rules": {
      "active": {
        ".read": true,
        ".write": "newData.isString() && newData.val().matches(/^(main|pokemon|onepiece|riftbound|mtg)$/)"
      }
    }
  }
  ```
- If Firebase is ever unreachable, the tag pages fall back to the **store hub**
  (the always-safe default), so a scan never shows an error.

The control page has **no password** by design — keep its URL off anything public
(it isn't linked from the customer-facing pages).

## Swiss tournaments

A full Swiss-pairing tournament runs on the same tags — no extra hardware.

**Run one (staff):**
1. Open **`admin.html`** (private link). Build the roster two ways (mix freely):
   - Type names (one per line) → **Add players**, and/or
   - **Self check-in:** turn on the **Tournament** toggle on the control panel and
     have players scan any table — they enter their name and appear on the roster
     live. Their device remembers them, so they later see *their* match even if
     they scan the wrong table, and byes are shown to them automatically.
2. (Optional) **Seed** players: set a seed number per player (1 = top) or tap
   **Auto-seed (list order)**. If any seeds are set, round 1 pairs **top half vs
   bottom half**; otherwise round 1 is random. Seed is also a deep tiebreaker.
3. **Start tournament** (round count auto-calculated: 8 players = 3 rounds, 16 = 4).
4. Tap **Pair round 1** — the engine seats each match at a table (T1, T2, …) and
   handles a bye automatically if the count is odd.
5. Players scan their table tag → see *"Round 1 · Table 3 — Alice vs Bob"* → tap
   the winner (or draw). Results appear on the admin console live.
6. When all results are in, **Pair round 2** (avoids rematches). Repeat, then
   **Finish** for final standings.

**Scoring & standings:** win = 3, draw = 1, loss = 0; ranked by points then
Opponents' Match-Win % (OMW, standard TCG tiebreaker). The TO can edit any result
or drop a player from the console.

**Data:** stored in Firebase at `/tournament` (players, rounds, results). Player
devices poll every few seconds, so everything stays in sync with no refresh.

**Firebase rules** must allow the tournament node and the `tournament` value — the
current rules are:
```json
{
  "rules": {
    "active": {
      ".read": true,
      ".write": "newData.isString() && newData.val().matches(/^(main|pokemon|onepiece|riftbound|mtg|tournament)$/)"
    },
    "tournament": {
      ".read": true,
      ".write": true
    }
  }
}
```

## Live tournament boards (TOM / Pokémon sanctioned events)

For Pokémon events run in **Tournament Operations Manager (TOM)**, a separate
pipeline (`tombridge/`, runs on the TOM Windows machine) mirrors TOM's reports
into Firebase at `tournaments/{tournamentId}`. Three display pages read that data:

| Page | Use |
|------|-----|
| `pairings.html` | Wall board — pairings by group (JR/SR combined, Masters separate), byes, status dots |
| `standings.html` | Wall board — standings per division (JR, SR, MA separate), points, OMW/OOMW, cut line when a cut applies |
| `table.html` | Phone tap view — a table's pairing + a standings peek scoped to that table's division(s) |

- **Reaching the tap view:** the **Pokémon** toggle on the control panel is
  TOM-aware. While a tournament is live (updated within 12h), scanning a table
  (`?tbl=N`) shows that table's live pairing (`table.html`); with no live
  tournament it shows the normal Pokémon event page. Tags map `tbl` → TOM table 1:1.
- **Boards** auto-select the most recently updated tournament (or pin one with
  `?t={tournamentId}`), and poll for updates. Add `?demo=1` to any page to render
  the bundled `tombridge/sample-snapshot.json` offline (no Firebase).
- **The snapshot is the contract** (`tombridge/sample-snapshot.json`). The display
  pages read it as-is and hardcode no division names or table counts.

**Firebase rule** — add public read on `tournaments` (writes stay locked to the
watcher's service account, which bypasses rules):
```json
{
  "rules": {
    "active":      { ".read": true, ".write": "newData.isString() && newData.val().matches(/^(main|pokemon|onepiece|riftbound|mtg|tournament)$/)" },
    "tournament":  { ".read": true, ".write": true },
    "tournaments": { ".read": true }
  }
}
```

## Adding event features later (registration / match results)

Each event page has a marked placeholder:
```html
<div class="panel placeholder" id="eventContent"> … </div>
```
Replace it with the real feature. The table number is available two ways:
- in the URL as `?tbl=N`
- already rendered in `#tableBadge`

Add `data-carry-tbl` to any **internal** link and `app.js` appends the table number
to it automatically (e.g. a link to a registration form that needs the table).

## Changing the backend later

To move off Firebase, change only `CONFIG_URL` in `assets/app.js`. If it points at
a plain JSON file the pages still **read** it (writes require a Firebase-style URL,
detected by the `firebaseio` / `firebasedatabase` host).
