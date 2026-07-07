# Balance Gaming FL — NFC Table & Event System

**Goal:** NFC tags on every table give customers a phone hub, let staff instantly
switch what the tags/screens show, run in-house Swiss tournaments, mirror
sanctioned Pokémon (TOM) events to live boards, and drive the advertising
display — all from one system.

**Status:** ✅ Live in production. 16 tags programmed and on tables.

## Live URLs
- **Customer landing (on tags):** `https://nfc.balancegamingfl.com/?tbl=N` (N = 1–16)
- **Staff control panel (private):** `…/config.html`
- **Tournament admin (private):** `…/admin.html`
- **Wall boards:** `…/pairings.html`, `…/standings.html`, `…/board.html` (rotating)
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
  tiebreakers.
- **Pokémon TOM integration** — a watcher on the store PC mirrors TOM's reports
  to Firebase; wall boards show live pairings/standings; scanning a table shows
  that table's live match + standings peek.
- **Advertising display (DakBoard)** — a control-panel toggle overlays the live
  tournament board on the ad TV and instantly reverts to the normal DakBoard
  design (transparent Web Frame overlay, working on-device).
- **Printable QR backups** — one QR per table if a tag ever fails.

## Tech / architecture
- Static site on **GitHub Pages**, repo `w4ggj/balance-nfc`, custom domain
  `nfc.balancegamingfl.com` + HTTPS.
- Live state in **Firebase Realtime Database** (event toggle, tournaments, TOM
  data, display toggle).
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
| `pokemon/onepiece/riftbound/mtg.html` | Game info pages |
| `tournament.html` / `admin.html` | Swiss tournament player + organizer |
| `pairings.html` / `standings.html` / `board.html` | TOM wall boards |
| `table.html` | TOM per-table tap view |
| `config.html` | Staff control panel (mode toggles, big-screen toggle) |
| `overlay.html` | Transparent DakBoard overlay |
| `qr-sheet.html` | Printable QR backups |
| `assets/app.js` | Routing, Firebase helpers, toggles |
| `assets/tournament.js` | Swiss engine + tournament UI |
| `assets/games.js` | Game info pages + Shopify events pull |
| `assets/tom.js` / `assets/brand.css` / `assets/tom.css` | TOM logic + styles |
| `tombridge/` | TOM → Firebase pipeline (runs on the store PC) |
