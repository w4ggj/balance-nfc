# Balance Gaming FL — NFC Table Landing Page

A mobile landing page for the NFC tags placed on every table in the store.
Customers tap a tag with their phone and land on a hub linking to the store's
key destinations.

**Status:** ✅ Live and print-ready.

## Live URL

Write this to the NFC tags:

```
https://w4ggj.github.io/balance-nfc/
```

## What it is

- Single self-contained `index.html` — no dependencies, loads instantly, mobile-first.
- Branded with the store's dragon logo (white background knocked out so it sits
  cleanly on the dark theme) and brand colors pulled from the logo.
- Logo also set as the favicon / home-screen icon.

### Brand colors

| Token        | Value      | Source              |
| ------------ | ---------- | ------------------- |
| `--accent`   | `#c81e27`  | dragon red          |
| `--accent-2` | `#f5c518`  | flame gold          |

Colors live as CSS variables at the top of `index.html` — edit there to restyle.

## Page contents

**Link tiles**

| Tile                  | Destination                                          |
| --------------------- | ---------------------------------------------------- |
| Upcoming Events       | `balancegamingfl.com/collections/events`             |
| Search for Singles    | `balancegamingfl.com/search`                         |
| Shop & Our Website    | `balancegamingfl.com`                                |
| Follow Us             | Facebook                                             |

**Singles quick chips:** Pokémon · Magic · One Piece

**Social row:** Facebook · Instagram (`/balancegamingfl`) · TikTok
(`@balancegamingfl.com`) · Get Directions

**Store info:** address (taps to maps) · phone (taps to dial) · hours

## Hosting & updates

- Hosted free on **GitHub Pages**, repo `w4ggj/balance-nfc` (public), served from
  the `main` branch root.
- Any change pushed to `main` auto-redeploys to the same URL — **the NFC tags
  never need to be re-written** for future edits.

## Local preview

It's a static file — open `index.html` in any browser, or serve the folder:

```
python3 -m http.server 8000   # then visit http://localhost:8000
```

Assets:

- `assets/logo.png` — processed logo (transparent background), used on the page.
- `assets/logo-original.png` — original logo source file.

## Open items / to verify

- Confirm the **TikTok** link (`@balancegamingfl.com`) lands on the correct
  profile — the `.com` in the handle is unusual.
- **Store hours** were sourced from public listings — verify they're accurate.
- Possible additions: Yu-Gi-Oh! / other singles, karate/dojo link, Google review
  button.

## Changelog

- **2026-07-05** — Set Instagram and TikTok profile links.
- **2026-07-05** — Add One Piece singles quick link.
- **2026-07-05** — Point Upcoming Events tile to `/collections/events`.
- **2026-07-05** — Add dragon logo and apply brand colors (red/gold).
- **2026-07-05** — Initial NFC landing page: events, singles search, shop, social,
  store info.
