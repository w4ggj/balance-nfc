# Balance Gaming FL — NFC Table & Event System

**Goal:** NFC tags on every table give customers a phone hub, let staff instantly
switch what the tags/screens show, run in-house Swiss tournaments and a Friday
Commander league, mirror sanctioned Pokémon (TOM) events to live boards, and
drive the in-store signage TVs (event schedule + live boards) — all from one
control panel.

**Status:** ✅ Live in production. 16 tags programmed and on tables.

## Live URLs
- **Customer landing (on tags):** `https://nfc.balancegamingfl.com/?tbl=N` (N = 1–16)
- **Staff control panel (private):** `…/config.html` — one hub linking every tool
- **Tournament (Swiss) admin:** `…/admin.html` · **board (TV):** `…/swiss-board.html`
- **Commander League:** `…/commander-admin.html` (staff) · `…/commander-board.html` (TV) · `…/commander.html` (players)
- **Pokémon TOM wall boards:** `…/pairings.html`, `…/standings.html`, `…/board.html`
- **Signage TVs:** `…/signage.html?screen=main` (75" landscape) · `…/signage.html?screen=entrance` (40" portrait)
- **Advertising TV (legacy DakBoard):** `…/overlay.html` · `…/event-tv.html?game=…`
- **Board data API (Cloudflare Worker):** `https://board-api.jleone0.workers.dev`
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
- **In-store signage TVs (`signage.html`) — replaces DakBoard.** Two kiosk
  screens, one page, two layouts:
  - **75" landscape (`?screen=main`)** — split board: **left** = upcoming events;
    **right** is gated by the "Live event on TV" toggle:
    - toggle **ON** + an event active → that event's **live board** (Commander /
      Swiss standings, rotating with pairings/pods) + a "Live now" pill;
    - toggle **OFF** → the upcoming Shopify events **spotlighted one at a time**
      (game tag, title, time, price/seats, event image, scan-to-register QR),
      rotating every ~10s.
  - **40" portrait (`?screen=entrance`)** — events list + a large scan-to-register
    QR; never flips to the live board.
  - Shared: header (logo + clock + Live pill), a **full-bleed continuous ticker**
    with the "★ Today's special" folded in, corner QR that auto-targets tonight's
    event (or the store site). Pages cache-bust their assets and self-reload
    hourly so the unattended TVs always run the latest build.
- **Advertising display (legacy DakBoard `overlay.html`)** — still works: a
  transparent Web Frame that mirrors the live event when the toggle is on. Kept
  for any DakBoard setup; superseded by `signage.html?screen=main`.
- **Printable QR backups** — one QR per table if a tag ever fails.

## Board data API (`board-api/` — Cloudflare Worker)
Feeds the signage board a merged, cached schedule. Deployed on Cloudflare (not
GitHub Pages) — re-deploy by pasting `board-api/worker.js` into the dashboard.
- **Google Calendar** — the full schedule; one calendar per game, listed
  comma-separated in `GCAL_CALENDAR_ID` and merged (each event tagged with its
  game). Recurring events expand automatically.
- **Shopify Admin** — entry price + exact seats-left + the product image, matched
  to a calendar event by **same date** + name (or an explicit `shopify: <handle>`
  in the event description). Works with any store `shpat_` token; `read_inventory`
  gives exact seats, otherwise it falls back to Open/Sold-out.
- Never hard-fails: returns an empty list so the board shows a graceful state.
  Setup + JSON contract: `board-api/SETUP.md`.

## Tech / architecture
- Static site on **GitHub Pages**, repo `w4ggj/balance-nfc`, custom domain
  `nfc.balancegamingfl.com` + HTTPS.
- Live state in **Firebase Realtime Database** (event toggle `active`, Swiss
  `/tournament`, TOM `/tournaments`, Commander `/commander`, `/display` toggle,
  signage `/signage` = special / ticker / tickerSpeed / featured).
- **Firebase Auth (email-link)** for Commander League players only; all other
  pages are anonymous. RTDB rules integrity-check player writes (own node,
  write-once votes, no self-vote). Rules reference: `COMMANDER_SETUP.md`.
- **Shopify** — game info pages pull events client-side from public
  `products.json` (no token); the signage schedule uses the `board-api` Worker
  (Google Calendar + Shopify Admin for exact seats/price/image).
- **tombridge/** Node pipeline (parser + watcher) runs on the TOM Windows PC →
  Firebase.
- **board-api/** Cloudflare Worker (deployed separately) feeds the signage board.
- Self-contained HTML/CSS/JS, mobile-first; push to `main` auto-deploys (~1 min).
- Docs in repo: `README.md`, `tombridge/SETUP.md`, `TAGS.md`, this file.

## Notes / open items
- Control panel, tournament admin, and DakBoard toggle have **no password** (by
  design, staff-only links).
- Firebase rules: public read on `active` / `tournament` / `tournaments` /
  `display` / `signage`; writes locked appropriately (`/signage` children incl.
  `tickerSpeed` are staff-writable). Full ruleset lives in the Firebase console.
- **Signage TVs** run a kiosk browser at the two `signage.html?screen=…` URLs
  (portrait is an OS-level rotation on that Pi). After a code change, they pick
  it up on the hourly self-reload; force it once with a hard refresh.
- **board-api Worker** must be re-deployed on Cloudflare when `board-api/worker.js`
  changes (it does not deploy from GitHub). Set `BOARD_API` in `assets/app.js`
  to its URL.
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
| `signage.html` | In-store signage TVs (`?screen=main` / `?screen=entrance`) |
| `config.html` | Staff control panel — one card per program + Board & signage + all tool links |
| `overlay.html` | Legacy DakBoard overlay (self-refreshing; superseded by signage.html) |
| `qr-sheet.html` | Printable QR backups |
| `assets/app.js` | Routing, Firebase helpers, toggles, event overlay, `initSignage`, `BOARD_API` |
| `assets/signage.js` | Signage board (events, live board, showcase, ticker, QR) |
| `assets/tournament.js` | Swiss engine + tournament UI + wall board |
| `assets/commander.js` | Commander engine + player/admin/board |
| `assets/games.js` | Game info pages + Shopify events pull (phone + TV) |
| `assets/qrcode.js` | Vendored QR generator (MIT) for signage QRs |
| `assets/tom.js` / `assets/brand.css` / `assets/signage.css` / `assets/tom.css` | Logic + styles |
| `board-api/` | Cloudflare Worker: Google Calendar + Shopify → signage feed |
| `tombridge/` | TOM → Firebase pipeline (runs on the store PC) |
| `COMMANDER_SETUP.md` | Firebase rules + Auth setup for the league |
