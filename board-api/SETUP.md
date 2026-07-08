# Board Data API — setup

One small Cloudflare Worker that feeds the signage board a merged, cached
list of upcoming events: **Google Calendar** for the full schedule,
**Shopify Admin** for entry price + exact seats-left.

The board reads this Worker's URL. Nothing else needs a server.

---

## What you provide (4 things)

| Setting | What it is | Secret? |
|---|---|---|
| `GCAL_CALENDAR_ID` | The calendar that holds all store events | No — in `wrangler.toml` |
| `GCAL_API_KEY` | Google API key, restricted to the Calendar API | **Yes — secret** |
| `SHOPIFY_SHOP` | Your `*.myshopify.com` domain | No — in `wrangler.toml` |
| `SHOPIFY_ADMIN_TOKEN` | Custom-app Admin API token | **Yes — secret** |

---

## 1. Google Calendar

1. Make the calendar public: Google Calendar → that calendar's **Settings and
   sharing** → **Access permissions** → check **Make available to public**
   (set to "See only free/busy"? No — choose **See all event details**).
2. On the same page, copy the **Calendar ID** (looks like
   `abc123@group.calendar.google.com`). → this is `GCAL_CALENDAR_ID`.

> **Multiple calendars (one per game)?** Do step 1 (make public) for **each**
> game calendar, then set `GCAL_CALENDAR_ID` to all their IDs **comma-separated**
> — the Worker merges them into one schedule and tags each event with its
> calendar name (shown on the board). One API key covers them all.
3. Get an API key: [console.cloud.google.com](https://console.cloud.google.com)
   → create/select a project → **APIs & Services** → enable **Google Calendar
   API** → **Credentials** → **Create credentials → API key**. Restrict it to
   the **Calendar API** (and optionally to your Worker's domain). → this is
   `GCAL_API_KEY`.

> Recurring weekly game nights are fine — the Worker asks Google to expand them
> into individual dated instances.

---

## 2. Shopify Admin token

You need an **offline Admin API token** (`shpat_…`) for this store. Any app's
token works — **you can reuse the `shpat_` from another of your apps** (e.g. the
booking / orchestrator app). Scopes it needs:

- **`read_products`** → event price + Open/Sold-out. Required.
- **`read_inventory`** → EXACT seats-left ("3 seats left"). Optional — if the
  token's app doesn't have it, the Worker automatically falls back to price +
  Open/Sold-out (no error, no blank board).

Set it as a secret: `wrangler secret put SHOPIFY_ADMIN_TOKEN` (or, in the
Cloudflare dashboard, Worker → Settings → Variables and Secrets → add as an
**encrypted** secret). Never put it in `wrangler.toml` or commit it.

Your `SHOPIFY_SHOP` is the `*.myshopify.com` domain (`d94663-4.myshopify.com`).

> Events must live in a collection whose handle is `events` (default) — or set
> `EVENTS_COLLECTION_HANDLE` to match.

> Events must be in a collection whose handle is `events` (default) — or set
> `EVENTS_COLLECTION_HANDLE` to match. Seats-left = the event product's tracked
> inventory, exactly as you already cap seats.

---

## 3. Deploy

```bash
npm install -g wrangler        # if needed
cd board-api
# edit wrangler.toml: set GCAL_CALENDAR_ID and SHOPIFY_SHOP
wrangler secret put GCAL_API_KEY          # paste when prompted
wrangler secret put SHOPIFY_ADMIN_TOKEN   # paste when prompted
wrangler deploy
```

Wrangler prints the Worker URL, e.g.
`https://board-api.jleone0.workers.dev`. Open it in a browser — you should see
JSON with an `events` array. **That URL is what the board will read.**

---

## 4. Optional: force a calendar event to a specific product

If the auto-match (same date + similar name) ever guesses wrong, put the
Shopify product handle in the calendar event's **description**, either as:

```
shopify: friday-commander
```

or just paste the product URL (`.../products/friday-commander`). The Worker
uses that link over any guess.

---

## Tuning (wrangler.toml `[vars]`)

- `HORIZON_DAYS` — how far ahead to show (default 21).
- `ALMOST_FULL` — seats at/under this show "almost full" (default 3).
- `TIMEZONE` — used to date-match evening events (default America/New_York).
