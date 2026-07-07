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
| `config.html` | Private staff control panel — one-tap instant toggle |
| `assets/brand.css` | Shared design system — edit brand colors here once |
| `assets/app.js` | Shared logic: reads/writes the active event, parses `tbl`, routing |
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
