/* ============================================================
   Balance Gaming FL — Board Data API (Cloudflare Worker)

   One cached endpoint the signage board reads. Merges:
     • Google Calendar  → the FULL upcoming schedule (recurring events
       expanded), including events that aren't ticketed in Shopify.
     • Shopify Admin API → entry price + EXACT seats-left (inventory)
       for the events that ARE sold as products.

   The Shopify Admin token is a secret, so it lives here (server-side),
   never in the browser. The board just fetches this Worker's URL.

   Response shape (what the board consumes):
   {
     "updated": 1720000000000,
     "events": [
       {
         "name": "Late Night Commander",
         "start": "2026-07-10T23:30:00.000Z",
         "end":   "2026-07-11T02:00:00.000Z",
         "allDay": false,
         "ticketed": true,
         "price": "5.00",
         "registerUrl": "https://balancegamingfl.com/products/friday-commander",
         "seatsLeft": 3,
         "status": "almost"      // open | almost | sold-out | null(=not ticketed)
       }
     ]
   }
   ============================================================ */

export default {
  async fetch(request, env, ctx) {
    const cors = {
      "Access-Control-Allow-Origin": env.ALLOW_ORIGIN || "https://nfc.balancegamingfl.com",
      "Content-Type": "application/json; charset=utf-8",
      // Board polls ~every 60s; a short edge cache keeps Google/Shopify calls low.
      "Cache-Control": "public, max-age=30"
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });

    try {
      const days = Number(env.HORIZON_DAYS || 21);
      const tz = env.TIMEZONE || "America/New_York";

      const [calEvents, shopEvents] = await Promise.all([
        loadCalendar(env, days),
        loadShopify(env)
      ]);

      const events = merge(calEvents, shopEvents, env, tz);
      return new Response(JSON.stringify({ updated: Date.now(), events }), { headers: cors });
    } catch (err) {
      // Never hard-fail the TV: return 200 + empty list so the board shows its
      // graceful "see the counter for today's schedule" state instead of blanking.
      return new Response(
        JSON.stringify({ updated: Date.now(), events: [], error: String(err && err.message || err) }),
        { status: 200, headers: cors }
      );
    }
  }
};

/* ---- Google Calendar --------------------------------------------------
   Uses the Calendar API with singleEvents=true so weekly/recurring game
   nights are expanded into individual dated instances automatically.
   Requires: calendar set to public, and an API key restricted to the
   Google Calendar API. */
async function loadCalendar(env, days) {
  if (!env.GCAL_CALENDAR_ID || !env.GCAL_API_KEY) return [];
  const now = Date.now();
  const timeMin = new Date(now - 6 * 3600 * 1000).toISOString();          // include earlier-today
  const timeMax = new Date(now + days * 24 * 3600 * 1000).toISOString();
  const url =
    "https://www.googleapis.com/calendar/v3/calendars/" +
    encodeURIComponent(env.GCAL_CALENDAR_ID) + "/events" +
    "?key=" + encodeURIComponent(env.GCAL_API_KEY) +
    "&singleEvents=true&orderBy=startTime&maxResults=60" +
    "&timeMin=" + encodeURIComponent(timeMin) +
    "&timeMax=" + encodeURIComponent(timeMax);

  const r = await fetch(url);
  if (!r.ok) throw new Error("Calendar API " + r.status);
  const data = await r.json();

  return (data.items || []).map(function (ev) {
    const s = ev.start || {}, e = ev.end || {};
    const allDay = !!(s.date && !s.dateTime);
    return {
      name: (ev.summary || "Event").trim(),
      start: s.dateTime || s.date || null,
      end: e.dateTime || e.date || null,
      allDay: allDay,
      description: ev.description || "",
      location: ev.location || ""
    };
  }).filter(function (e) { return e.start; });
}

/* ---- Shopify Admin ----------------------------------------------------
   Pulls the "Events" collection with per-variant inventory + price.
   Requires a custom app Admin token with read_products + read_inventory. */
async function loadShopify(env) {
  if (!env.SHOPIFY_SHOP || !env.SHOPIFY_ADMIN_TOKEN) return [];
  const ver = env.SHOPIFY_API_VERSION || "2024-10";
  const handle = env.EVENTS_COLLECTION_HANDLE || "events";
  const query =
    "query($handle:String!){collectionByHandle(handle:$handle){products(first:120,sortKey:CREATED,reverse:true){nodes{" +
    "title handle onlineStoreUrl " +
    "variants(first:10){nodes{title price inventoryQuantity availableForSale}}}}}}";

  const r = await fetch("https://" + env.SHOPIFY_SHOP + "/admin/api/" + ver + "/graphql.json", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": env.SHOPIFY_ADMIN_TOKEN
    },
    body: JSON.stringify({ query: query, variables: { handle: handle } })
  });
  if (!r.ok) throw new Error("Shopify Admin " + r.status);
  const data = await r.json();
  const nodes = (data && data.data && data.data.collectionByHandle &&
    data.data.collectionByHandle.products && data.data.collectionByHandle.products.nodes) || [];

  return nodes.map(function (p) {
    let seats = 0, tracked = false, price = null;
    (p.variants.nodes || []).forEach(function (v) {
      if (typeof v.inventoryQuantity === "number") { tracked = true; seats += Math.max(0, v.inventoryQuantity); }
      if (price == null && v.price != null) price = v.price;
    });
    return {
      title: p.title,
      handle: p.handle,
      url: p.onlineStoreUrl || ("https://balancegamingfl.com/products/" + p.handle),
      price: price,
      seatsLeft: tracked ? seats : null,
      date: dateFromTitle(p.title)     // "YYYY-MM-DD" or null
    };
  });
}

/* ---- Merge ------------------------------------------------------------
   For each calendar event, attach a Shopify product if one matches.
   Matching order:
     1) Explicit — a Shopify product handle/URL in the calendar event's
        description (put "/products/<handle>" or "shopify: <handle>" in the
        GCal event to force an exact link).
     2) Fallback — same local date AND fuzzy name match. */
function merge(calEvents, shopEvents, env, tz) {
  const almost = Number(env.ALMOST_FULL || 3);

  const byHandle = {};
  shopEvents.forEach(function (s) { byHandle[s.handle] = s; });

  const out = calEvents.map(function (ev) {
    const evDate = ev.allDay ? String(ev.start).slice(0, 10) : localDate(ev.start, tz);
    let match = null;

    const explicit = handleFromText(ev.description);
    if (explicit && byHandle[explicit]) {
      match = byHandle[explicit];
    } else {
      const key = normalize(ev.name);
      match = shopEvents.find(function (s) {
        if (s.date && evDate && s.date !== evDate) return false;
        const sn = normalize(stripDate(s.title));
        return sn && key && (sn.indexOf(key) !== -1 || key.indexOf(sn) !== -1);
      }) || null;
    }

    const seatsLeft = match ? match.seatsLeft : null;
    return {
      name: ev.name,
      start: ev.start,
      end: ev.end,
      allDay: ev.allDay,
      ticketed: !!match,
      price: match ? match.price : null,
      registerUrl: match ? match.url : null,
      seatsLeft: seatsLeft,
      status: statusFor(seatsLeft, almost)
    };
  });

  out.sort(function (a, b) { return new Date(a.start) - new Date(b.start); });
  return out;
}

function statusFor(seatsLeft, almost) {
  if (seatsLeft == null) return null;      // not ticketed / not tracked
  if (seatsLeft <= 0) return "sold-out";
  if (seatsLeft <= almost) return "almost";
  return "open";
}

/* ---- Small helpers ---------------------------------------------------- */
function localDate(iso, tz) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date(iso));
  const g = function (t) { const p = parts.find(function (x) { return x.type === t; }); return p ? p.value : ""; };
  return g("year") + "-" + g("month") + "-" + g("day");
}

function dateFromTitle(title) {
  const m = String(title || "").match(/(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
  if (!m) return null;
  const p = function (n) { return String(n).length < 2 ? "0" + n : String(n); };
  return m[1] + "-" + p(m[2]) + "-" + p(m[3]);
}

function stripDate(title) {
  return String(title || "")
    .replace(/^\s*[a-z]*\.?\s*[\d]{1,4}[\d.\/,\- ]*[-\u2013\u2014:]?\s*/i, "")
    .trim() || title;
}

function normalize(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function handleFromText(text) {
  const t = String(text || "");
  let m = t.match(/\/products\/([a-z0-9\-]+)/i);
  if (m) return m[1].toLowerCase();
  m = t.match(/shopify\s*[:=]\s*([a-z0-9\-]+)/i);
  if (m) return m[1].toLowerCase();
  return null;
}
