/* ============================================================
   Balance Martial Arts & Gaming — game info pages
   Renders the per-game tap page: tonight's event (pulled live from
   Shopify), the pairings app pointer, and quick links. Read-only.
   ============================================================ */
(function (global) {
  "use strict";

  var SHOP = "https://balancegamingfl.com";

  var LINKS = {
    events:      SHOP + "/collections/events",
    buylist:     SHOP + "/pages/buylist",
    deckbuilder: SHOP + "/pages/deck-builder",
    elite:       SHOP + "/products/elite-membership",
    shop:        SHOP + "/",
    discord:     "https://discord.gg/TSaCprrsTB",
    facebook:    "https://www.facebook.com/balance.martialarts.gaming",
    instagram:   "https://www.instagram.com/balancegamingfl",
    tiktok:      "https://www.tiktok.com/@balancegamingfl.com"
  };

  // Each game has its own Shopify events collection. The game name isn't always
  // in the title, so we filter by COLLECTION (reliable), not keyword. Titles are
  // "YYYY/MM/DD <Event Name>"; we match today's date. `app` = the pairings app.
  // ── Confirm each eventsHandle against the store's collection URLs. ──
  var GAMES = {
    pokemon:   { label: "Pokémon TCG",         short: "Pokémon",  singles: SHOP + "/collections/all-pokemon-singles", eventsHandle: "pokemon-events",   app: null, deck: true },
    mtg:       { label: "Magic: The Gathering", short: "Magic",    singles: SHOP + "/collections/all-mtg-singles",     eventsHandle: "mtg-events",       app: { name: "Magic Companion", url: "https://magic.wizards.com/en/companion-app" }, deck: true },
    onepiece:  { label: "One Piece TCG",        short: "One Piece", singles: SHOP + "/collections/one-piece-singles-1", eventsHandle: "one-piece-events", app: { name: "Bandai TCG+", url: "https://www.bandai-tcg-plus.com/" }, deck: false },
    riftbound: { label: "Riftbound",            short: "Riftbound", singles: null,                                      eventsHandle: "riftbound-events", app: null, deck: false }
  };

  function el(t, c, x) { var e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; }
  function linkBtn(label, href, opts) {
    var a = el("a", "gl" + (opts && opts.cls ? " " + opts.cls : ""));
    a.href = href;
    if (opts && opts.blank) { a.target = "_blank"; a.rel = "noopener"; }
    a.appendChild(el("span", "gl-t", label));
    if (opts && opts.sub) a.appendChild(el("span", "gl-s", opts.sub));
    return a;
  }

  // ---- "tonight" date matching -----------------------------------------
  // Events are products whose TITLE STARTS WITH the event date. We build the
  // likely string forms of today and match a title that begins with one.
  function todayForms() {
    var d = new Date();
    var m = d.getMonth() + 1, day = d.getDate(), y = d.getFullYear(), yy = String(y).slice(-2);
    var p = function (n) { return String(n).length < 2 ? "0" + n : String(n); };
    var months = ["january","february","march","april","may","june","july","august","september","october","november","december"];
    var mon = months[d.getMonth()], mon3 = mon.slice(0, 3);
    return [
      m + "/" + day + "/" + y, m + "/" + day + "/" + yy, p(m) + "/" + p(day) + "/" + y, p(m) + "/" + p(day) + "/" + yy,
      m + "/" + day, p(m) + "/" + p(day),
      y + "-" + p(m) + "-" + p(day), y + "/" + p(m) + "/" + p(day),
      m + "-" + day + "-" + yy, m + "-" + day + "-" + y, p(m) + "-" + p(day),
      mon + " " + day, mon3 + " " + day, day + " " + mon, day + " " + mon3,
      mon + " " + day + ", " + y, mon3 + " " + day + ", " + y
    ].map(function (s) { return s.toLowerCase(); });
  }
  function isTonight(title) {
    var t = (title || "").toLowerCase().trim();
    return todayForms().some(function (f) { return t.indexOf(f) === 0; });
  }
  function stripDate(title) {
    // remove a leading date + separator so the card shows just the event name
    return (title || "").replace(/^\s*[a-z]*\.?\s*[\d]{1,4}[\d./,\- ]*[-–—:]?\s*/i, "").trim() || title;
  }

  // ---- tonight's event (Shopify) ---------------------------------------
  function loadTonight(game, host) {
    var G = GAMES[game];
    host.appendChild(loadingCard());
    var url = SHOP + "/collections/" + G.eventsHandle + "/products.json?limit=250";
    fetch(url, { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (data) {
        var list = (data && data.products) || [];
        renderTonight(game, host, list.filter(function (p) { return isTonight(p.title); }));
      })
      .catch(function () { renderTonight(game, host, null); }); // network/CORS/404 → graceful fallback
  }
  function loadingCard() { var c = el("div", "event-card muted"); c.appendChild(el("div", "ec-title", "Checking tonight's event…")); return c; }
  function renderTonight(game, host, events) {
    host.innerHTML = "";
    var G = GAMES[game];
    if (events === null || (events && !events.length)) {
      var msg = (events === null) ? "See the schedule for today's games." : "No " + G.short + " event listed for today.";
      var card = el("div", "event-card");
      card.appendChild(el("div", "ec-title", "Tonight at Balance"));
      card.appendChild(el("p", "ec-sub", msg));
      card.appendChild(linkBtn("See all events", LINKS.events, { cls: "wide", blank: true }));
      host.appendChild(card);
      return;
    }
    events.forEach(function (p) {
      var card = el("div", "event-card live");
      card.appendChild(el("span", "ec-tag", "Tonight"));
      card.appendChild(el("h2", "ec-title", stripDate(p.title)));
      var price = (p.variants && p.variants[0] && p.variants[0].price != null) ? p.variants[0].price : null;
      if (price != null && Number(price) > 0) card.appendChild(el("div", "ec-sub", "Entry $" + price));
      var a = linkBtn("Register / details", SHOP + "/products/" + p.handle, { cls: "wide primary", blank: true });
      card.appendChild(a);
      host.appendChild(card);
    });
  }

  // ---- page ------------------------------------------------------------
  function initGame(game) {
    var G = GAMES[game] || GAMES.pokemon;
    var titleEl = document.querySelector(".event-title"), subEl = document.querySelector(".event-sub");
    if (titleEl) titleEl.textContent = G.label;
    if (subEl) subEl.textContent = "Everything for tonight — right at your table.";
    var body = document.getElementById("gameBody");
    body.innerHTML = "";

    // 1) tonight's event
    var tonight = el("div"); body.appendChild(tonight); loadTonight(game, tonight);

    // 2) pairings app pointer (Magic / One Piece)
    if (G.app) {
      var note = el("div", "notice");
      note.innerHTML = "Pairings &amp; standings are in the <b style=\"color:var(--text)\">" + G.app.name + "</b> app — make sure you're checked in.";
      note.style.marginTop = "16px";
      body.appendChild(note);
      var act = el("div", "event-actions");
      act.appendChild(linkBtn("Open " + G.app.name + " ↗", G.app.url, { cls: "primary", blank: true }));
      body.appendChild(act);
    }

    // 3) quick links
    body.appendChild(sec("Quick links"));
    var grid = el("div", "glinks");
    if (G.singles) grid.appendChild(linkBtn("Search " + G.short + " Singles", G.singles, { sub: "Find that card", blank: true }));
    if (G.deck) grid.appendChild(linkBtn("Deck Builder", LINKS.deckbuilder, { sub: "Build & price a list", blank: true }));
    grid.appendChild(linkBtn("Sell / Trade — Buylist", LINKS.buylist, { sub: "What we're buying", blank: true }));
    grid.appendChild(linkBtn("Upcoming Events", LINKS.events, { sub: "This week & beyond", blank: true }));
    grid.appendChild(linkBtn("Join our Discord", LINKS.discord, { sub: "Community & announcements", blank: true }));
    grid.appendChild(linkBtn("Elite Membership", LINKS.elite, { sub: "Perks & discounts", blank: true }));
    body.appendChild(grid);

    // 4) socials
    body.appendChild(sec("Follow us"));
    var soc = el("div", "gsocial");
    soc.appendChild(socialLink("Facebook", LINKS.facebook));
    soc.appendChild(socialLink("Instagram", LINKS.instagram));
    soc.appendChild(socialLink("TikTok", LINKS.tiktok));
    body.appendChild(soc);
  }

  function sec(t) { return el("p", "section-label", t); }
  function socialLink(label, href) { var a = el("a", "gsoc"); a.href = href; a.target = "_blank"; a.rel = "noopener"; a.textContent = label; return a; }

  // ---- TV / wall version (event-tv.html?game=…) ------------------------
  // Big-screen "tonight's event" for the advertising display. Same Shopify
  // pull as the tap page, rendered large. Auto-refreshes so it stays live.
  function loadTonightTv(game, host) {
    var G = GAMES[game];
    var url = SHOP + "/collections/" + G.eventsHandle + "/products.json?limit=250";
    fetch(url, { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (data) {
        var list = (data && data.products) || [];
        renderTonightTv(game, host, list.filter(function (p) { return isTonight(p.title); }));
      })
      .catch(function () { renderTonightTv(game, host, null); });
  }
  function renderTonightTv(game, host, events) {
    var G = GAMES[game];
    host.innerHTML = "";
    if (events === null || (events && !events.length)) {
      host.appendChild(el("div", "evtv-kicker", "Tonight at Balance"));
      host.appendChild(el("div", "evtv-title", (events === null) ? "See tonight's schedule" : "No " + G.short + " event tonight"));
      host.appendChild(el("div", "evtv-meta", "Ask the counter or check our events page for what's on."));
      return;
    }
    events.forEach(function (p) {
      var card = el("div", "evtv-card");
      card.appendChild(el("div", "evtv-kicker", "Tonight · " + G.short));
      card.appendChild(el("div", "evtv-title", stripDate(p.title)));
      var price = (p.variants && p.variants[0] && p.variants[0].price != null) ? p.variants[0].price : null;
      if (price != null && Number(price) > 0) card.appendChild(el("div", "evtv-meta", "Entry $" + price + " · register at the counter"));
      else card.appendChild(el("div", "evtv-meta", "Register at the counter"));
      host.appendChild(card);
    });
  }
  function initGameTv(game) {
    game = (GAMES[game] ? game : "pokemon");
    var G = GAMES[game];
    document.body.setAttribute("data-game", game);
    var nameEl = document.getElementById("evtvGame");
    if (nameEl) nameEl.textContent = G.label;
    var host = document.getElementById("evtvBody");
    loadTonightTv(game, host);
    setInterval(function () { loadTonightTv(game, host); }, 60000); // stay live
  }

  global.BGFG = { GAMES: GAMES, LINKS: LINKS, initGame: initGame, initGameTv: initGameTv, isTonight: isTonight, stripDate: stripDate };
  if (typeof module !== "undefined" && module.exports) module.exports = global.BGFG;
})(typeof window !== "undefined" ? window : globalThis);
