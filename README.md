# Balance Gaming FL — NFC Table Landing

Mobile landing system for the NFC tags on every table. One base URL is written to
all tags; a small config file decides what customers see when they scan.

**Live URL written to every tag:**
```
https://nfc.balancegamingfl.com/?tbl=N      (N = table number, 1–16)
```
The `?tbl=N` never changes per tag — table 7's tag is always `...?tbl=7`.
(Served via GitHub Pages; the `CNAME` file in this repo binds the custom domain.
The old `https://w4ggj.github.io/balance-nfc/?tbl=N` URLs still redirect here.)

## How it works

`index.html` is a router. On every scan it reads **`config.json`** and decides:

- **`{"active":"main"}`** → shows the normal store hub. `tbl` is ignored.
- **`{"active":"pokemon"}`** (or `onepiece` / `riftbound` / `mtg`) → forwards to that
  event page, carrying the table number, which the page shows as a big **TABLE N** badge.

Because the tags all point at the same base URL, you switch what they show by
changing one line in `config.json` — **no re-tagging, ever**.

## Files

| File | What it is |
|------|------------|
| `index.html` | Router + the store hub (the default landing) |
| `pokemon.html`, `onepiece.html`, `riftbound.html`, `mtg.html` | Event pages (one per game) |
| `config.json` | **Source of truth** — which page is live. One line. |
| `config.html` | Private staff control panel (pick the active page, get the JSON to commit) |
| `assets/brand.css` | Shared design system — edit brand colors here once |
| `assets/app.js` | Shared logic: reads config, parses `tbl`, routing, control panel |
| `assets/logo.png` | Dragon logo (favicon + header). Already in the repo. |

## Turning an event on / off

1. Open **`config.html`** on your phone (bookmark it — keep it private).
2. Flip the switch for the game that's running. Turn all off for the normal hub.
3. Tap **Copy config.json**, then **Open GitHub editor**, paste over the file, commit to `main`.
4. Live in ~1 minute. The router fetches `config.json` fresh (cache-busted) on every scan.

`?hub=1` on the base URL always shows the hub, even during an event (handy for testing).

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

## Optional upgrade: one-tap toggling (no commits)

Static hosting means a toggle has to be committed to take effect. To flip events
instantly with no commit, stand up a small **Cloudflare Worker** (you already run one)
that stores `active` and returns `{"active":"…"}`. Then change one line in `app.js`:
```js
var CONFIG_URL = "https://<your-worker>.workers.dev/";
```
Nothing else changes.
