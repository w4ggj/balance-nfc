# Balance Gaming FL — NFC Table & Event System

**Goal:** NFC tags on every table give customers a phone hub, let staff instantly
switch what the tags/screens show, run in-house Swiss tournaments and a Friday
Commander league, mirror sanctioned Pokémon (TOM) events to live boards, and
drive the advertising display so it mirrors whatever event is live — all from
one control panel.

**Status:** ✅ Live in production. 16 tags programmed and on tables.

## Live URLs
- **Customer landing (on tags):** `https://nfc.balancegamingfl.com/?tbl=N` (N = 1–16)
- **Staff control panel (private):** `…/config.html` — one hub linking every tool
- **Tournament (Swiss) admin:** `…/admin.html` · **board (TV):** `…/swiss-board.html`
- **Commander League:** `…/commander-admin.html` (staff) · `…/commander-board.html` (TV) · `…/commander.html` (players)
- **Pokémon TOM wall boards:** `…/pairings.html`, `…/standings.html`, `…/board.html`
- **Advertising TV:** `…/overlay.html` (DakBoard Web Frame) · `…/event-tv.html?game=…` (big event banner)
- **QR backup sheet:** `…/qr-sheet.html`

## What it does
- **Store hub** — dragon branding; links to Events, Search Singles
  (Pokémon/Magic/One Piece), Shop, Join Our Discord, socials, address/phone/
  hours/directions.
- **Instant mode switching** — control panel toggles flip every tag between the
  hub, a game page, or a live tournament view (Firebase, no re-tagging).
- **Game info pages** (Magic / One Piece / Riftbound / casual Pokémon) —
  **tonight's event pulled live from each game's Shopify collection** (matched by
  today's date), the official pairings-app pointer (Magic Companion / Bandai
  TCG+), plus singles, deck builder, buylist, events, Discord, Elite membership,
  socials.
- **In-house Swiss tournaments** — player self check-in (scan a table), optional
  seeding, auto pairings/byes/rounds, tap-to-report results, live standings with
  tiebreakers, and a rotating pairings↔standings **wall board** (`swiss-board.html`).
- **Balance Commander League** — Friday-night EDH. Players tap a table → email-link
  sign-in → auto check-in; staff console creates the league, starts a night,
  assigns pods (4 per table), and advances games; players vote for one pod-mate
  per game (with a reason) or abstain, plus a +1 end-of-night questionnaire;
  private personal stats; aggregate season **leaderboard** on the TV. Serverless —
  Firebase Auth + RTDB rules enforce one write-once vote per game and no self-votes.
- **Pokémon TOM integration** — a watcher on the store PC mirrors TOM's reports
  to Firebase; wall boards show live pairings/standings; scanning a table shows
  that table's live match + standings peek.
- **Advertising display (DakBoard) — mirrors the live event.** One toggle turns TV
  mirroring on; `overlay.html` then shows whatever is live: Commander → leaderboard,
  Pokémon tournament → TOM board, Swiss → Swiss board, or any game event → a
  full-screen "tonight's event" banner pulled from Shopify (`event-tv.html`).
  Off = transparent, normal DakBoard shows through. The overlay self-refreshes
  hourly and pulls fresh code so the unattended sign stays current.
- **Printable QR backups** — one QR per table if a tag ever fails.

## Tech / architecture
- Static site on **GitHub Pages**, repo `w4ggj/balance-nfc`, custom domain
  `nfc.balancegamingfl.com` + HTTPS.
- Live state in **Firebase Realtime Database** (event toggle `active`, Swiss
  `/tournament`, TOM `/tournaments`, Commander `/commander`, `/display` toggle).
- **Firebase Auth (email-link)** for Commander League players only; all other
  pages are anonymous. RTDB rules integrity-check player writes (own node,
  write-once votes, no self-vote). Rules reference: `COMMANDER_SETUP.md`.
- **Shopify** events pulled client-side from public `products.json` per game
  collection (no token).
- **tombridge/** Node pipeline (parser + watcher) runs on the TOM Windows PC →
  Firebase.
- Self-contained HTML/CSS/JS, mobile-first; push to `main` auto-deploys (~1 min).
- Docs in repo: `README.md`, `tombridge/SETUP.md`, `TAGS.md`, this file.

## Notes / open items
- Control panel, tournament admin, and DakBoard toggle have **no password** (by
  design, staff-only links).
- Firebase rules: public read on `active` / `tournament` / `tournaments` /
  `display`; writes locked appropriately.
- Update the store's **Google/Facebook listings** to the correct phone
  (727) 279-5617 (old public listings had a different number).
- Magic / One Piece pairings intentionally **not** rebuilt — their official apps
  do it better.

## Key files
| Path | Role |
|------|------|
| `index.html` | Router + store hub |
| `pokemon/onepiece/riftbound/mtg.html` | Game info pages (phone) |
| `event-tv.html` | Big-screen "tonight's event" banner (`?game=…`) |
| `tournament.html` / `admin.html` | Swiss tournament player + organizer |
| `swiss-board.html` | Swiss rotating pairings↔standings wall board |
| `pairings.html` / `standings.html` / `board.html` | TOM (Pokémon) wall boards |
| `table.html` | TOM per-table tap view |
| `commander.html` / `commander-admin.html` / `commander-board.html` | Commander player / staff / TV |
| `config.html` | Staff control panel — one card per program + all tool links |
| `overlay.html` | Event-aware DakBoard overlay (self-refreshing) |
| `qr-sheet.html` | Printable QR backups |
| `assets/app.js` | Routing, Firebase helpers, toggles, big-screen dispatcher |
| `assets/tournament.js` | Swiss engine + tournament UI + wall board |
| `assets/commander.js` | Commander engine + player/admin/board |
| `assets/games.js` | Game info pages + Shopify events pull (phone + TV) |
| `assets/tom.js` / `assets/brand.css` / `assets/tom.css` | TOM logic + styles |
| `tombridge/` | TOM → Firebase pipeline (runs on the store PC) |
| `COMMANDER_SETUP.md` | Firebase rules + Auth setup for the league |
