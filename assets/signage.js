/* ============================================================
   Balance Martial Arts & Gaming — in-store signage board
   Runs on the two shop TVs (kiosk browsers), replacing DakBoard.
     signage.html?screen=main      → 75" landscape: split board
       LEFT  = upcoming events (Worker feed)
       RIGHT = the live board for whatever event is turned on
               (Commander / Swiss standings), + a corner QR
     signage.html?screen=entrance  → 40" portrait: events + big QR
   Shared: header + clock, scrolling ticker (with the special folded in).
   Style mirrors the repo: IIFE module, var, plain fetch, vw/vh sizing.
   ============================================================ */
(function (global) {
  "use strict";

  var TIMEZONE = "America/New_York";
  var CLOSE_HOUR = 22;                 // specials flagged clearAtClose hide after this
  var MAIN_SITE = "https://balancegamingfl.com";
  var EVENTS_URL = MAIN_SITE + "/collections/events";
  var POLL_EVENTS_MS = 60000;          // Worker feed
  var POLL_FB_MS = 15000;              // ticker + special
  var POLL_RIGHT_MS = 5000;            // active event + standings

  function el(t, c, x) { var e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; }
  function qp(name) { return new URLSearchParams(location.search).get(name); }

  // ---- date/time helpers (store timezone) ------------------------------
  function fmt(d, opts) { opts = opts || {}; opts.timeZone = TIMEZONE; return new Intl.DateTimeFormat("en-US", opts).format(d); }
  function storeHour() { return parseInt(fmt(new Date(), { hour: "2-digit", hourCycle: "h23" }), 10); }
  function dayKey(d) { return fmt(d, { year: "numeric", month: "2-digit", day: "2-digit" }); }
  function isToday(d) { return dayKey(d) === dayKey(new Date()); }
  function isTomorrow(d) { var t = new Date(); t.setDate(t.getDate() + 1); return dayKey(d) === dayKey(t); }
  // Parse an event start. All-day events arrive as a date-only string
  // ("2026-08-23"); `new Date()` reads that as UTC midnight, which shows as the
  // day before in US timezones — anchor it at local noon so the date is right.
  function evStart(ev) {
    var s = ev && ev.start;
    if (ev && ev.allDay && typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(s + "T12:00:00");
    return new Date(s);
  }
  function whenLine(ev, d) {
    // Show the calendar date so a recurring event reads as its NEXT occurrence
    // (the Worker expands recurring events, so each listed start is a real date).
    var time = ev.allDay ? "All day" : fmt(d, { hour: "numeric", minute: "2-digit" });
    if (isToday(d)) return "Tonight · " + time;
    if (isTomorrow(d)) return "Tomorrow, " + fmt(d, { month: "short", day: "numeric" }) + " · " + time;
    var wk = fmt(d, { weekday: "short" });
    var date = fmt(d, { month: "short", day: "numeric" }); // e.g. "Aug 22"
    return wk + ", " + date + " · " + time;
  }
  function statusWord(ev) {
    if (ev.status === "sold-out") return "sold out";
    if (ev.status === "almost") return (ev.seatsLeft != null ? ev.seatsLeft + " seats left" : "almost full");
    return "open";
  }
  function statusCls(ev) { return ev.status === "sold-out" ? "soldout" : (ev.status === "almost" ? "almost" : "open"); }
  function priceWord(ev) {
    if (ev.ticketed && ev.price != null && Number(ev.price) > 0) return "$" + ev.price;
    return "Free";
  }
  // Store-local (Eastern) calendar date — matches how the night is keyed, so the
  // board agrees on "today" no matter the kiosk's own timezone.
  // Event titles sometimes carry a redundant leading date (e.g.
  // "2026/08/02 One Piece …") — the board shows the date separately, so strip it.
  function cleanName(n) {
    var s = (n == null ? "" : String(n)).replace(/^\s*\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2}\s*[-–—:]*\s*/, "").trim();
    return s || (n || "Event");
  }
  function todayId() {
    try {
      var parts = new Intl.DateTimeFormat("en-US", { timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
      var o = {}; parts.forEach(function (x) { o[x.type] = x.value; });
      if (o.year && o.month && o.day) return o.year + "-" + o.month + "-" + o.day;
    } catch (e) { /* fall through */ }
    var p = function (n) { return n < 10 ? "0" + n : "" + n; }; var d = new Date();
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }
  // The Commander night to feature: the most recent one still running, so pods
  // stay on screen for a late session or after the display's date has rolled.
  function liveNight(c) {
    var nights = (c && c.nights) || {}, keys = Object.keys(nights).sort();
    for (var i = keys.length - 1; i >= 0; i--) {
      var n = nights[keys[i]];
      if (n && (n.status === "checkin" || /^game\d+$/.test(n.status || ""))) return n;
    }
    return null;
  }

  // ---- clock -----------------------------------------------------------
  function startClock() {
    var c = document.getElementById("sgClock");
    if (!c) return;
    function tick() { c.textContent = fmt(new Date(), { hour: "numeric", minute: "2-digit" }); }
    tick(); setInterval(tick, 15000);
  }

  // ---- QR helper -------------------------------------------------------
  function qrSvg(url, cell) {
    if (typeof global.qrcode !== "function") return "";
    try { var q = global.qrcode(0, "M"); q.addData(url); q.make(); return q.createSvgTag({ cellSize: cell || 4, margin: 1, scalable: true }); }
    catch (e) { return ""; }
  }

  // ---- upcoming events (left column, Worker feed) ----------------------
  var lastEvents = [];
  var lastEventsSig = null;
  function loadEvents() {
    var api = (global.BGF && global.BGF.BOARD_API) || "";
    if (!api || /__FILL_IN/.test(api)) { renderEvents(null); return; }
    fetch(api, { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (data) { lastEvents = (data && data.events) || []; renderEvents(lastEvents); })
      .catch(function () { renderEvents(null); });
  }
  function renderEvents(events) {
    var host = document.getElementById("sgEvents");
    if (!host) return;
    if (events !== null) {
      var sig = JSON.stringify(events);
      if (sig === lastEventsSig) return;
      lastEventsSig = sig;
    } else { lastEventsSig = null; }

    host.innerHTML = "";
    var track = el("div", "sg-etrack");
    if (events === null) { track.appendChild(emptyCard("Schedule unavailable", "See the counter for today's games.")); host.appendChild(track); return; }
    if (!events.length) { track.appendChild(emptyCard("No upcoming events", "See the counter for today's schedule.")); host.appendChild(track); return; }

    events.forEach(function (ev) {
      var d = evStart(ev);
      var card = el("div", "sg-ev" + (isToday(d) ? " featured" : ""));
      card.appendChild(el("div", "sg-ev-when", whenLine(ev, d)));
      card.appendChild(el("div", "sg-ev-name", cleanName(ev.name)));
      var meta = el("div", "sg-ev-meta");
      meta.appendChild(el("span", "sg-ev-price", priceWord(ev)));
      meta.appendChild(document.createTextNode(" · "));
      meta.appendChild(el("span", "sg-ev-status " + statusCls(ev), statusWord(ev)));
      card.appendChild(meta);
      track.appendChild(card);
    });
    host.appendChild(track);
    autoScrollEvents(host, track);
    // If the right panel is spotlighting events (toggle off), refresh it now
    // that fresh events are in — avoids a lingering welcome/blank state.
    if (rightLive === false && document.getElementById("sgRight")) renderShowcase();
  }
  function emptyCard(t, b) { var c = el("div", "sg-empty"); c.appendChild(el("h2", null, t)); c.appendChild(el("p", null, b)); return c; }

  var kfMade = {};
  function autoScrollEvents(host, track) {
    requestAnimationFrame(function () {
      track.style.animation = "none"; track.style.transform = "none";
      var overflow = track.scrollHeight - host.clientHeight;
      if (overflow <= 8) return;
      var name = "sgscroll_" + Math.floor(overflow);
      if (!kfMade[name]) {
        kfMade[name] = true;
        var css = "@keyframes " + name + "{0%,8%{transform:translateY(0)}48%,58%{transform:translateY(-" + overflow + "px)}98%,100%{transform:translateY(0)}}";
        var s = document.createElement("style"); s.textContent = css; document.head.appendChild(s);
      }
      var dur = Math.max(20, overflow / 18);
      track.style.animation = name + " " + (dur * 2) + "s ease-in-out infinite";
    });
  }

  // ---- RIGHT panel (main mode): the active event's live board ----------
  function setLive(on) {
    var p = document.getElementById("sgLive");
    if (p) p.hidden = !on;
  }
  // The right panel has two modes, gated by the "Live event on TV" toggle
  // (display/board):
  //   LIVE  (toggle ON + an event active) → that event's live board; Commander/
  //         Swiss rotate standings ↔ pairings/pods. The "Live now" pill shows.
  //   SHOWCASE (toggle OFF, or nothing active) → the upcoming Shopify events,
  //         spotlighted one at a time on a rotation.
  var rightActive = null;   // null so the very first render always fires
  var rightData = null;
  var rightView = 0;        // live: 0 standings, 1 pairings/pods
  var rightLive = false;    // is the live board showing?
  var showcaseIdx = 0;
  function loadRight() {
    if (videoOn) return;   // video owns the panel — don't repaint over it
    var right = document.getElementById("sgRight");
    if (!right || !global.BGF) return;
    Promise.all([BGF.fbGet("display/board"), BGF.getConfig()]).then(function (r) {
      var boardOn = r[0] === true;
      var active = (r[1] && r[1].active) || "main";
      var showLive = boardOn && active !== "main";
      var changed = (showLive !== rightLive) || (active !== rightActive);
      if (changed) rightView = 0;
      rightActive = active; rightLive = showLive;
      setLive(showLive);
      right.style.setProperty("--ev", (BGF.COLORS && BGF.COLORS[showLive ? active : "main"]) || "#a07bff");

      if (!showLive) {
        // Showcase mode: render once on entering; the rotation advances it.
        if (changed) { showcaseIdx = 0; renderShowcase(); }
        return;
      }
      // Live mode: refresh every poll so scores update.
      if (active === "commander-league") { BGF.fbGet("commander").then(function (c) { rightData = c || {}; renderRight(); }); }
      else if (active === "tournament") { BGF.fbGet("tournament").then(function (t) { rightData = t || {}; renderRight(); }); }
      else { rightData = null; paintEventCard(right, active); }
    });
  }
  function renderRight() {
    if (videoOn) return;
    var right = document.getElementById("sgRight");
    if (!right) return;
    try {
      if (!rightLive) { renderShowcase(); return; }
      if (rightActive === "commander-league") {
        // Lead with the pods (who's seated where) — that's the useful in-room
        // info during a night — and rotate to the season standings.
        if (rightView === 1) paintStandings(right, commanderView(rightData || {}), rightActive);
        else paintPods(right, rightData || {});
      } else if (rightActive === "tournament") {
        if (rightView === 1) paintPairings(right, rightData || {});
        else paintStandings(right, swissView(rightData || {}), rightActive);
      } else {
        paintEventCard(right, rightActive);
      }
    } catch (e) {
      // Never leave the panel blank on an unexpected data shape.
      right.innerHTML = "";
      right.appendChild(centerMsg("Live board", "Updating…"));
      if (global.console) global.console.error("[signage] renderRight", e);
    }
  }
  function rotateRight() {
    if (videoOn) return;
    if (rightLive && (rightActive === "commander-league" || rightActive === "tournament")) {
      rightView = rightView ? 0 : 1; renderRight();
    } else if (!rightLive) {
      showcaseIdx++; renderShowcase();
    }
  }
  // Fun rotation (dad jokes / one-liners) mixed into the showcase. Pool =
  // control-panel list (/signage/fun) + the bundled assets/jokes.txt (optional).
  var funOn = false, funLines = [], funFileOn = true, fileJokes = [];
  function shuffleArr(a) { a = a.slice(); for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function loadJokeFile() {
    fetch("assets/jokes.txt", { cache: "no-store" })
      .then(function (r) { return r.ok ? r.text() : ""; })
      .then(function (t) {
        var lines = t.split(/\r?\n/).map(function (s) { return s.trim(); }).filter(function (s) { return s && s.charAt(0) !== "#"; });
        fileJokes = shuffleArr(lines);   // shuffle once per load for variety
      }).catch(function () { fileJokes = []; });
  }
  function loadFun() {
    Promise.all([BGF.fbGet("signage/funOn"), BGF.fbGet("signage/fun"), BGF.fbGet("signage/funFile")]).then(function (r) {
      funOn = r[0] === true;
      funLines = Array.isArray(r[1]) ? r[1].filter(Boolean) : [];
      funFileOn = r[2] !== false;        // default on
    });
  }
  function funPool() { return funLines.concat(funFileOn ? fileJokes : []); }

  // Combined spotlight list: events, with a fun card slipped in after every 3rd
  // event when the fun toggle is on.
  function buildShowcase() {
    var items = lastEvents.map(function (ev) { return { kind: "event", ev: ev }; });
    var pool = funPool();
    if (funOn && pool.length && items.length) {
      var out = [], fi = 0;
      for (var i = 0; i < items.length; i++) {
        out.push(items[i]);
        if ((i + 1) % 3 === 0) { out.push({ kind: "fun", text: pool[fi % pool.length] }); fi++; }
      }
      if (out.length === items.length) out.push({ kind: "fun", text: pool[0] }); // few events → still show one
      return out;
    }
    return items;
  }

  // Spotlight the upcoming events (and fun cards) one at a time.
  function renderShowcase() {
    if (videoOn) return;
    var right = document.getElementById("sgRight");
    if (!right) return;
    var items = buildShowcase();
    if (!items.length) { paintWelcome(right); return; }
    var it = items[showcaseIdx % items.length];
    if (it.kind === "fun") { paintFunCard(right, it.text); return; }
    right.style.setProperty("--ev", "#a07bff");
    var ev = it.ev, d = evStart(ev);
    right.innerHTML = "";
    var head = el("div", "sg-r-head");
    head.appendChild(el("div", "sg-r-title", isToday(d) ? "Happening Today" : "Upcoming Event"));
    var evIdx = lastEvents.indexOf(ev);
    head.appendChild(el("div", "sg-r-sub", (evIdx + 1) + " / " + lastEvents.length));
    right.appendChild(head);
    right.appendChild(eventCardEls(ev, d, ev.game));
    addCornerQRUrl(right, ev.registerUrl || MAIN_SITE, ev.registerUrl ? "Scan to register" : "Scan to visit");
  }
  function paintFunCard(right, text) {
    right.innerHTML = "";
    right.style.setProperty("--ev", "#f5c518");
    var head = el("div", "sg-r-head");
    head.appendChild(el("div", "sg-r-title", "Just for fun"));
    head.appendChild(el("div", "sg-r-sub", "😄"));
    right.appendChild(head);
    var card = el("div", "sg-fun");
    card.appendChild(el("div", "sg-fun-text", text));
    right.appendChild(card);
  }

  // Big event card (image + details) for the showcase and live game view. The
  // image comes from the Shopify product (Worker feed); it's hidden if missing
  // or broken so the text still reads.
  function eventCardEls(ev, d, kick) {
    var card = el("div", "sg-r-event" + (ev.image ? " has-img" : ""));
    if (ev.image) {
      var box = el("div", "sg-re-img");
      var img = new Image(); img.src = ev.image; img.alt = "";
      img.onerror = function () { box.style.display = "none"; card.classList.remove("has-img"); };
      box.appendChild(img); card.appendChild(box);
    }
    var info = el("div", "sg-re-info");
    if (kick) info.appendChild(el("div", "sg-re-kick", kick));
    info.appendChild(el("div", "sg-re-name", cleanName(ev.name)));
    info.appendChild(el("div", "sg-re-when", whenLine(ev, d)));
    var meta = el("div", "sg-re-meta");
    meta.appendChild(el("span", "sg-ev-price", priceWord(ev)));
    meta.appendChild(document.createTextNode(" · "));
    meta.appendChild(el("span", "sg-ev-status " + statusCls(ev), statusWord(ev)));
    info.appendChild(meta);
    card.appendChild(info);
    return card;
  }

  function commanderView(c) {
    var rows = (global.BGFCL ? BGFCL.Engine.standings(c) : []).map(function (s) { return { rank: s.rank, name: s.name, pts: s.points }; });
    var night = liveNight(c);
    var round = night ? (night.currentGame || 0) : 0;
    return { title: "Commander League" + (round ? " — Game " + round : ""), rows: rows };
  }
  function swissView(t) {
    var rows = (global.BGFT && t.players ? BGFT.Engine.standings(t.players, t.rounds || {}) : []).map(function (s) { return { rank: s.rank, name: s.name, pts: s.points }; });
    var round = t.currentRound || 0;
    return { title: (t.name || "Tournament") + (round ? " — Round " + round : ""), rows: rows };
  }

  function paintStandings(right, view, active) {
    right.innerHTML = "";
    var head = el("div", "sg-r-head");
    head.appendChild(el("div", "sg-r-title", view.title));
    head.appendChild(el("div", "sg-r-sub", "Live Standings"));
    right.appendChild(head);

    if (!view.rows.length) {
      right.appendChild(centerMsg("Standings appear as the event runs", "Players and points show here live."));
      addCornerQR(right, active);
      return;
    }
    var tbl = el("div", "sg-stbl");
    var h = el("div", "sg-strow head");
    h.appendChild(el("span", "sg-st-rk", "#"));
    h.appendChild(el("span", "sg-st-nm", "Player"));
    h.appendChild(el("span", "sg-st-pt", "Pts"));
    tbl.appendChild(h);
    view.rows.forEach(function (r) {
      var row = el("div", "sg-strow" + (r.rank === 1 ? " top" : ""));
      row.appendChild(el("span", "sg-st-rk", String(r.rank)));
      row.appendChild(el("span", "sg-st-nm", r.name));
      row.appendChild(el("span", "sg-st-pt", String(r.pts)));
      tbl.appendChild(row);
    });
    right.appendChild(tbl);
    addCornerQR(right, active);
  }

  // Swiss pairings for the current round.
  function paintPairings(right, t) {
    right.innerHTML = "";
    var round = t.currentRound || 0;
    var head = el("div", "sg-r-head");
    head.appendChild(el("div", "sg-r-title", (t.name || "Tournament") + (round ? " — Round " + round : "")));
    head.appendChild(el("div", "sg-r-sub", "Pairings"));
    right.appendChild(head);

    var matches = (t.rounds && t.rounds[round]) || null;
    if (!matches || !Object.keys(matches).length) {
      right.appendChild(centerMsg("Pairings not posted yet", "They'll appear here when the round is paired."));
      addCornerQR(right, "tournament"); return;
    }
    var name = function (id) { return (t.players && t.players[id] && t.players[id].name) || "—"; };
    var keys = Object.keys(matches).sort(function (a, b) { var ta = matches[a].table, tb = matches[b].table; if (ta == null) return 1; if (tb == null) return -1; return ta - tb; });
    var list = el("div", "sg-plist");
    keys.forEach(function (k) {
      var m = matches[k], row = el("div", "sg-prow");
      row.appendChild(el("span", "sg-p-tbl", m.table != null ? ("T" + m.table) : "BYE"));
      var vs = el("div", "sg-p-vs");
      vs.appendChild(el("span", "sg-p-name" + (m.winner === "p1" ? " won" : ""), name(m.p1)));
      if (m.p2 != null) { vs.appendChild(el("span", "sg-p-x", "vs")); vs.appendChild(el("span", "sg-p-name" + (m.winner === "p2" ? " won" : ""), name(m.p2))); }
      else { vs.appendChild(el("span", "sg-p-x", "·")); vs.appendChild(el("span", "sg-p-name bye", "Bye")); }
      row.appendChild(vs);
      list.appendChild(row);
    });
    right.appendChild(list);
    addCornerQR(right, "tournament");
  }

  // Commander pods for tonight.
  function paintPods(right, c) {
    right.innerHTML = "";
    var night = liveNight(c);
    var round = night ? (night.currentGame || 0) : 0;
    var head = el("div", "sg-r-head");
    head.appendChild(el("div", "sg-r-title", "Commander League" + (round ? " — Game " + round : "")));
    head.appendChild(el("div", "sg-r-sub", "Tonight's Pods"));
    right.appendChild(head);

    var pods = (night && night.pods) || null;
    if (!pods || !Object.keys(pods).length) {
      right.appendChild(centerMsg("Pods not assigned yet", "Seating shows here once the organizer assigns pods."));
      addCornerQR(right, "commander-league"); return;
    }
    var name = function (uid) { return (c.players && c.players[uid] && c.players[uid].name) || "Player"; };
    var list = el("div", "sg-plist");
    // pods can arrive from Firebase as an array with a null hole at index 0
    // (keys 1,2,… coerce to an array) — skip empty slots so a null doesn't blank
    // the whole panel.
    Object.keys(pods).filter(function (k) { return pods[k]; })
      .sort(function (a, b) { return (pods[a].table || 0) - (pods[b].table || 0); }).forEach(function (pn) {
        var p = pods[pn], row = el("div", "sg-prow");
        row.appendChild(el("span", "sg-p-tbl", "T" + (p.table != null ? p.table : "?")));
        var names = Object.keys(p.members || {}).map(name).join(" · ");
        row.appendChild(el("div", "sg-p-vs", names));
        list.appendChild(row);
      });
    right.appendChild(list);
    addCornerQR(right, "commander-league");
  }

  // A game event is active but has no standings — show its next event card.
  function paintEventCard(right, active) {
    right.innerHTML = "";
    var m = { pokemon: "pok", onepiece: "one piece", riftbound: "rift", mtg: "magic" }[active];
    var match = null;
    for (var i = 0; i < lastEvents.length; i++) {
      var g = (lastEvents[i].game || "").toLowerCase();
      if (m && g.indexOf(m) !== -1) { match = lastEvents[i]; break; }
    }
    var head = el("div", "sg-r-head");
    head.appendChild(el("div", "sg-r-title", (BGF.LABELS && BGF.LABELS[active]) || "Tonight"));
    head.appendChild(el("div", "sg-r-sub", "Now Playing"));
    right.appendChild(head);

    if (match) {
      right.appendChild(eventCardEls(match, evStart(match), match.game));
    } else {
      var card = el("div", "sg-r-event");
      card.appendChild(el("div", "sg-re-name", "See the upcoming events"));
      card.appendChild(el("div", "sg-re-kick", "No scheduled event for this game right now."));
      right.appendChild(card);
    }
    addCornerQR(right, active);
  }

  function paintWelcome(right) {
    right.innerHTML = "";
    var w = el("div", "sg-welcome");
    w.appendChild(el("img", "sg-welcome-logo"));
    w.lastChild.src = "assets/logo.png"; w.lastChild.alt = "";
    w.appendChild(el("div", "sg-welcome-h", "Welcome to Balance Gaming FL"));
    w.appendChild(el("div", "sg-welcome-sub", "Trading cards, tables, and tournaments — see what's on this week."));
    right.appendChild(w);
    addCornerQR(right, "main");
  }

  function centerMsg(t, b) { var c = el("div", "sg-welcome"); c.appendChild(el("div", "sg-welcome-h", t)); c.appendChild(el("div", "sg-welcome-sub", b)); return c; }

  // Corner QR — points at the active event's register link, else the store.
  function addCornerQR(right, active) {
    addCornerQRUrl(right, qrTargetFor(active), active === "main" ? "Scan to visit" : "Scan to register");
  }
  function addCornerQRUrl(right, url, cap) {
    var box = el("div", "sg-corner-qr");
    var svg = qrSvg(url, 4);
    if (!svg) return;
    box.innerHTML = svg;
    box.appendChild(el("div", "sg-corner-cap", cap || "Scan"));
    right.appendChild(box);
  }
  function qrTargetFor(active) {
    if (["pokemon", "onepiece", "riftbound", "mtg"].indexOf(active) !== -1) {
      var m = { pokemon: "pok", onepiece: "one piece", riftbound: "rift", mtg: "magic" }[active];
      for (var i = 0; i < lastEvents.length; i++) {
        var g = (lastEvents[i].game || "").toLowerCase();
        if (m && g.indexOf(m) !== -1 && lastEvents[i].registerUrl) return lastEvents[i].registerUrl;
      }
    }
    if (active !== "main") {
      var tonight = tonightRegisterUrl();
      if (tonight) return tonight;
    }
    return MAIN_SITE;
  }
  function tonightRegisterUrl() {
    var soonest = null;
    for (var i = 0; i < lastEvents.length; i++) {
      if (lastEvents[i].registerUrl) { soonest = lastEvents[i].registerUrl; if (isToday(evStart(lastEvents[i]))) return lastEvents[i].registerUrl; }
    }
    return soonest;
  }

  // ---- entrance QR (portrait) ------------------------------------------
  var lastQRUrl = "";
  function renderEntranceQR() {
    var host = document.getElementById("sgQR");
    if (!host || typeof global.qrcode !== "function") return;
    BGF.fbGet("signage/featured").then(function (featured) {
      var url = (function () {
        if (featured && typeof featured === "string") {
          for (var i = 0; i < lastEvents.length; i++) { var ru = lastEvents[i].registerUrl || ""; if (ru.indexOf(featured) !== -1) return ru; }
        }
        return tonightRegisterUrl() || EVENTS_URL;
      })();
      if (url === lastQRUrl) return;
      lastQRUrl = url;
      var svg = qrSvg(url, 6);
      if (svg) host.innerHTML = svg;
    });
  }

  // ---- ticker (with the special folded in) -----------------------------
  var lastTickerSig = "";
  var tickerPxPerSec = 80;
  function loadTicker() {
    Promise.all([BGF.fbGet("signage/ticker"), BGF.fbGet("signage/tickerSpeed"), BGF.fbGet("signage/special")]).then(function (r) {
      var lines = Array.isArray(r[0]) ? r[0].filter(Boolean) : [];
      var speed = Number(r[1]); if (!speed || speed < 10) speed = 80;
      var special = r[2];
      var specialText = special && special.text;
      var specialHidden = special && special.clearAtClose !== false && storeHour() >= CLOSE_HOUR;
      var items = [];
      if (specialText && !specialHidden) items.push({ special: true, text: specialText });
      lines.forEach(function (l) { items.push({ special: false, text: l }); });
      var sig = JSON.stringify(items) + "|" + speed;
      if (sig === lastTickerSig) return;
      lastTickerSig = sig; tickerPxPerSec = speed;
      renderTicker(items);
    });
  }
  function renderTicker(items) {
    var host = document.getElementById("sgTicker");
    if (!host) return;
    host.innerHTML = "";
    if (!items.length) { host.hidden = true; return; }
    host.hidden = false;
    var track = el("div", "sg-ticker-track");
    host.appendChild(track);
    function appendSeq() {
      items.forEach(function (it) {
        if (it.special) {
          var s = el("span", "sg-ticker-item sg-ticker-special");
          s.appendChild(el("b", null, "★ Today's special: "));
          s.appendChild(document.createTextNode(it.text));
          track.appendChild(s);
        } else {
          track.appendChild(el("span", "sg-ticker-item", it.text));
        }
        track.appendChild(el("span", "sg-ticker-dot", "•"));
      });
    }
    appendSeq(); // one sequence, to measure
    requestAnimationFrame(function () {
      var base = track.scrollWidth;
      if (base <= 0) return;
      var vw = host.clientWidth || window.innerWidth || base;
      // Repeat enough that the strip always fills the screen (no gap/pop), then
      // loop by exactly ONE sequence width so the start seamlessly follows the end.
      var repeats = Math.max(2, Math.ceil(vw / base) + 1);
      track.innerHTML = "";
      for (var i = 0; i < repeats; i++) appendSeq();
      var name = "sgmarq_" + Math.floor(base);
      if (!kfMade[name]) {
        kfMade[name] = true;
        var css = "@keyframes " + name + "{from{transform:translateX(0)}to{transform:translateX(-" + base + "px)}}";
        var st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
      }
      var dur = Math.max(6, base / tickerPxPerSec);
      track.style.animation = name + " " + dur + "s linear infinite";
    });
  }

  // ---- Presentation mode (phone-controlled slides on the main board) ---
  // Reads /present { on, idx, slides:[imageUrl,...] }. When on, a fullscreen
  // slide overlay covers the board and shows slides[idx]; the phone remote
  // (present-remote.html) advances idx live. Nothing to relaunch — the board
  // just overlays and un-overlays. Main screen only.
  var presentEl = null, presentImg = null, lastPresentSig = "";
  function ensurePresentEl() {
    if (presentEl) return;
    presentEl = document.createElement("div");
    presentEl.style.cssText = "position:fixed;top:0;left:0;right:0;bottom:0;width:100%;height:100%;background:#000;display:none;align-items:center;justify-content:center;z-index:9000;overflow:hidden;";
    presentImg = document.createElement("img");
    presentImg.alt = "";
    presentImg.style.cssText = "max-width:100%;max-height:100%;width:auto;height:auto;object-fit:contain;display:block;";
    presentEl.appendChild(presentImg);
    document.body.appendChild(presentEl);
  }
  function loadPresent() {
    if (!global.BGF) return;
    BGF.fbGet("present").then(function (p) {
      p = p || {};
      ensurePresentEl();
      var slides = (p.slides && p.slides.length) ? p.slides.filter(Boolean) : [];
      var on = p.on === true && slides.length > 0;
      if (!on) { presentEl.style.display = "none"; lastPresentSig = ""; return; }
      var idx = p.idx || 0;
      if (idx < 0) idx = 0; if (idx > slides.length - 1) idx = slides.length - 1;
      var url = slides[idx], sig = idx + "|" + url;
      presentEl.style.display = "flex";
      if (sig !== lastPresentSig) { lastPresentSig = sig; presentImg.src = url; }
    }).catch(function () {});
  }

  // ---- Video background (YouTube in the standings panel) ---------------
  // Reads /video { on, url, sound }. When on, a YouTube video/playlist plays in
  // #sgRight (standings frame) so the events column + ticker stay on screen.
  // Driven through the IFrame Player API — NOT a dumb <iframe> — so a watchdog
  // can catch a stall/blank (flaky Wi-Fi, a YouTube error, the WebView dropping
  // the video surface) and restart playback instead of leaving the panel blank.
  // YouTube is the one embeddable source; the FAST "TV" channels (Pluto/Samsung)
  // don't expose an embeddable stream. Sound needs Fully Kiosk audio-autoplay.

  // Parse any YouTube URL form into { videoId, listId, channelId, live }.
  // Covers the formats the YouTube app hands you today — /shorts/, /live/, and a
  // channel's "live" page — not just /watch?v=. A link this failed to parse used
  // to fall through to the <video> path below and paint a white panel.
  function ytParse(raw) {
    if (!raw) return null;
    raw = String(raw).trim();
    var out = { videoId: "", listId: "", channelId: "", live: false }, m;

    // Playlists: only real, embeddable list ids. An autoplay mix/radio (RD…),
    // Watch Later (WL) or Liked (LL) id cannot be embedded as a playlist — the
    // player loads nothing — so ignore it and use the video id such links carry.
    if ((m = raw.match(/[?&]list=([A-Za-z0-9_-]+)/)) && /^(PL|UU|OL|FL)/.test(m[1])) out.listId = m[1];

    if ((m = raw.match(/youtube\.com\/live\/([A-Za-z0-9_-]{6,})/))) { out.videoId = m[1]; out.live = true; }
    else if ((m = raw.match(/youtube\.com\/shorts\/([A-Za-z0-9_-]{6,})/))) out.videoId = m[1];
    else if ((m = raw.match(/[?&]v=([A-Za-z0-9_-]{6,})/))) out.videoId = m[1];
    else if ((m = raw.match(/youtu\.be\/([A-Za-z0-9_-]{6,})/))) out.videoId = m[1];
    else if ((m = raw.match(/youtube(?:-nocookie)?\.com\/(?:embed|v|e)\/([A-Za-z0-9_-]{6,})/)) && m[1] !== "videoseries" && m[1] !== "live_stream") out.videoId = m[1];
    // A channel's live page carries no video id — YouTube resolves the current
    // broadcast from the channel id instead.
    else if ((m = raw.match(/youtube\.com\/channel\/(UC[A-Za-z0-9_-]{10,})\/live/))) { out.channelId = m[1]; out.live = true; }
    else if ((m = raw.match(/youtube\.com\/embed\/live_stream[^#]*[?&]channel=(UC[A-Za-z0-9_-]{10,})/))) { out.channelId = m[1]; out.live = true; }

    if (!out.videoId && !out.listId && !out.channelId) {
      if (/^(PL|UU|OL|FL)[A-Za-z0-9_-]+$/.test(raw)) out.listId = raw;
      else if (/^UC[A-Za-z0-9_-]{10,}$/.test(raw)) { out.channelId = raw; out.live = true; }
      else if (/^[A-Za-z0-9_-]{11}$/.test(raw)) out.videoId = raw;
    }
    return (out.videoId || out.listId || out.channelId) ? out : null;
  }

  // Fire OS decode workaround. The Fire Stick's WebView plays newer uploads and
  // live streams with sound but paints the video area white, while older uploads
  // render fine — the difference is the codec YouTube serves. Newer/live content
  // is VP9/AV1; older content still carries an H.264 rendition, which is what this
  // WebView can actually composite. Lower resolutions are far likelier to have an
  // H.264 rendition, so `?vq=medium` on the TV's start URL asks for one.
  // Values: small (240p) · medium (360p) · large (480p) · hd720. Desktop browsers
  // don't need it — leave the param off there and quality stays automatic.
  var VQ = (function () {
    var v = qp("vq") || "";
    return /^(small|medium|large|hd720|hd1080|default)$/.test(v) ? v : "";
  })();
  function applyVQ(p) {
    if (!VQ || !p) return;
    try { if (p.setPlaybackQuality) p.setPlaybackQuality(VQ); } catch (e) {}
  }

  // Serialize player vars for an iframe src (the live_stream embed below is built
  // as a real iframe, so the API can't apply playerVars for us).
  function ytQuery(vars) {
    var parts = [];
    for (var k in vars) if (Object.prototype.hasOwnProperty.call(vars, k)) {
      parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(vars[k]));
    }
    return parts.join("&");
  }

  // Load the IFrame API once; queue callers until it's ready.
  var ytApiReady = false, ytApiLoading = false, ytApiCbs = [];
  function loadYTApi(cb) {
    if (ytApiReady && global.YT && global.YT.Player) { cb(); return; }
    ytApiCbs.push(cb);
    if (ytApiLoading) return;
    ytApiLoading = true;
    var prev = global.onYouTubeIframeAPIReady;
    global.onYouTubeIframeAPIReady = function () {
      if (typeof prev === "function") { try { prev(); } catch (e) {} }
      ytApiReady = true;
      var cbs = ytApiCbs.slice(); ytApiCbs = [];
      cbs.forEach(function (f) { try { f(); } catch (e) {} });
    };
    var s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    s.async = true;
    (document.head || document.body).appendChild(s);
  }

  // The video sits INSIDE the right panel (#sgRight); `videoOn` freezes the
  // panel's own repaints so the timer-driven standings refresh won't wipe it.
  var videoEl = null, videoHost = null, videoOn = false;
  var ytPlayer = null, fileVideo = null, ytPlayerReady = false, ytEverPlayed = false;
  var curSig = "", curKind = "", curParsed = null, curFileUrl = "", curSound = false, curBadReason = "";
  var wdTimer = null, wdLastTime = -1, wdStuck = 0, recovering = false;
  var WD_STEP_MS = 10000, WD_STUCK_LIMIT = 30000; // recover after ~30s frozen
  var buildFails = 0, videoFailed = false, MAX_BUILD_FAILS = 3;

  // YouTube IFrame API error codes. These are permanent for a given link — no
  // amount of rebuilding fixes them, so say what's wrong and stop retrying.
  var YT_ERRORS = {
    2: "YouTube rejected that link — the video ID looks wrong. Re-copy it with the Share button.",
    100: "That video isn't available — it may be private, deleted, or region-blocked.",
    101: "The owner doesn't allow this video to be played on other screens. Pick a different video, or upload an .mp4.",
    150: "The owner doesn't allow this video to be played on other screens. Pick a different video, or upload an .mp4."
  };
  // Error 5 is the WebView's HTML5 player giving up — worth a retry, then this.
  var NOTE_WEBVIEW = "This video won't play in this TV's browser. YouTube embeds often fail on the Fire Stick — upload the clip to Shopify Files and paste its .mp4 link instead.";

  function makeVideoEl() {
    var el = document.createElement("div");
    el.className = "sg-videobg";
    // Transparent container centred in the panel — the board's own background
    // shows as blank space around the video, not a black box.
    el.style.cssText = "position:absolute;top:0;left:0;right:0;bottom:0;display:flex;align-items:center;justify-content:center;overflow:hidden;border-radius:inherit;";
    // Keep the 16:9 shape; the panel is narrower than 16:9 so it fills the width
    // and leaves blank board space top/bottom. The API replaces this host node.
    videoHost = document.createElement("div");
    videoHost.style.cssText = "width:100%;height:auto;aspect-ratio:16/9;max-height:100%;";
    el.appendChild(videoHost);
    return el;
  }

  // Decide how to play a URL. Embedded YouTube is unreliable inside old kiosk
  // WebViews (Fire OS) — many videos render a white frame with only audio — so a
  // direct video FILE (.mp4/.webm/…) is played through a native <video>, which
  // the WebView renders every time. YouTube links still use the IFrame player.
  function classifyVideo(raw) {
    if (!raw) return null;
    raw = String(raw).trim();
    if (/\.(mp4|m4v|webm|ogv|ogg|mov)(\?|#|$)/i.test(raw)) return { kind: "file", url: raw };
    var yt = ytParse(raw);
    if (yt) return { kind: "yt", parsed: yt };
    // A YouTube link we can't parse must NOT fall through to the <video> path —
    // a page URL in a <video> tag is exactly the white panel with no explanation.
    if (/(^|\/\/|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)\//i.test(raw)) return { kind: "bad", reason: ytHint(raw) };
    if (/^https?:\/\//i.test(raw)) return { kind: "file", url: raw }; // best-effort: treat any other URL as a file
    return null;
  }

  // Why a YouTube link is unusable, phrased so whoever is holding the phone can fix it.
  function ytHint(raw) {
    if (/youtube\.com\/(@|c\/|user\/)[^/?#]+\/live/i.test(raw))
      return "A channel @handle link can't be embedded. Open the live stream itself and copy that link (youtube.com/live/…).";
    if (/[?&]list=(WL|LL)/.test(raw))
      return "Watch Later and Liked playlists are private, so the TV can't play them. Use a public playlist or a single video.";
    if (/[?&]list=/.test(raw))
      return "That link is an autoplay mix, not a real playlist. Copy the video's own link instead.";
    return "Couldn't read a video ID from that YouTube link. Use YouTube's Share button and paste the youtu.be/… link.";
  }

  function buildYT() {
    if (!global.YT || !global.YT.Player || !videoHost || !curParsed) return;
    var vars = {
      autoplay: 1, controls: 0, rel: 0, modestbranding: 1, playsinline: 1,
      iv_load_policy: 3, fs: 0, disablekb: 1, mute: curSound ? 0 : 1
    };
    // `origin` is required by current YouTube embeds for the JS API handshake;
    // without it some builds sit on a blank frame forever.
    try { if (location.origin && location.origin.indexOf("http") === 0) vars.origin = location.origin; } catch (e) {}
    if (curParsed.listId) { vars.listType = "playlist"; vars.list = curParsed.listId; vars.loop = 1; }
    // No loop=1&playlist=<id> hack for a single video: YouTube mishandles it on a
    // live stream (it tries to wrap the broadcast in a one-item playlist and
    // renders nothing at all). Looping is done from onStateChange/ENDED instead.

    var mount, onIframe = false;
    if (curParsed.channelId && !curParsed.videoId) {
      // A channel's live page has no video id, so use YouTube's live_stream embed,
      // which resolves the channel's current broadcast. Building the player on an
      // existing iframe keeps the watchdog working — that needs enablejsapi=1.
      vars.enablejsapi = 1;
      mount = document.createElement("iframe");
      mount.setAttribute("allow", "autoplay; encrypted-media");
      mount.setAttribute("allowfullscreen", "");
      mount.setAttribute("frameborder", "0");
      mount.style.cssText = "width:100%;height:100%;border:0;display:block;";
      mount.src = "https://www.youtube.com/embed/live_stream?channel=" + encodeURIComponent(curParsed.channelId) + "&" + ytQuery(vars);
      onIframe = true;
    } else {
      mount = document.createElement("div");
      mount.style.cssText = "width:100%;height:100%;";
    }
    videoHost.innerHTML = ""; videoHost.appendChild(mount);
    ytPlayerReady = false; ytEverPlayed = false; wdLastTime = -1; wdStuck = 0;

    var opts = {
      events: {
        onReady: function (e) {
          ytPlayerReady = true;
          try { if (curSound) e.target.unMute(); else e.target.mute(); } catch (x) {}
          applyVQ(e.target);
          try { e.target.playVideo(); } catch (x) {}
        },
        onStateChange: function (e) {
          var S = global.YT.PlayerState;
          // Re-assert quality on every start: YouTube renegotiates upward on its own.
          if (e.data === S.PLAYING) { ytEverPlayed = true; buildFails = 0; applyVQ(ytPlayer); reportVideoStatus(true, ""); return; }
          // Loop a finished video by seeking back to the start; nudge a pause.
          if (e.data === S.ENDED) { try { ytPlayer.seekTo(0, true); } catch (x) {} }
          if (e.data === S.ENDED || e.data === S.PAUSED) { try { ytPlayer.playVideo(); } catch (x) {} }
        },
        onError: function (e) {
          var msg = YT_ERRORS[e && e.data];
          if (msg) failVideo(msg); else recoverVideo();
        }
      }
    };
    // On an existing iframe the API ignores these — the src already carries them.
    if (!onIframe) {
      opts.width = "100%"; opts.height = "100%";
      opts.videoId = curParsed.videoId || undefined;
      opts.playerVars = vars;
    }
    try { ytPlayer = new global.YT.Player(mount, opts); }
    catch (e) { recoverVideo(); }
  }

  function buildFile() {
    if (!videoHost || !curFileUrl) return;
    var v = document.createElement("video");
    v.style.cssText = "width:100%;height:auto;aspect-ratio:16/9;max-height:100%;display:block;background:#000;";
    v.autoplay = true; v.loop = true; v.muted = !curSound; v.controls = false;
    v.setAttribute("playsinline", ""); v.setAttribute("webkit-playsinline", "");
    if (!curSound) v.setAttribute("muted", ""); // some webviews need the attribute too
    v.src = curFileUrl;
    videoHost.innerHTML = ""; videoHost.appendChild(v);
    fileVideo = v; ytPlayerReady = true; wdLastTime = -1; wdStuck = 0;
    var play = function () { try { var p = v.play(); if (p && p.catch) p.catch(function () {}); } catch (e) {} };
    v.addEventListener("loadedmetadata", play);
    v.addEventListener("canplay", play);
    v.addEventListener("playing", function () { ytEverPlayed = true; buildFails = 0; reportVideoStatus(true, ""); });
    v.addEventListener("ended", play);            // loop should cover it; belt-and-suspenders
    v.addEventListener("error", function () {
      recoverVideo("Couldn't load that video file. Check the link is public and points straight at an .mp4.");
    });
    play();
  }

  function buildActive() {
    if (curKind === "file") buildFile();
    else loadYTApi(function () { if (videoOn && curKind === "yt") buildYT(); });
  }

  function destroyPlayers() {
    try { if (ytPlayer && ytPlayer.destroy) ytPlayer.destroy(); } catch (e) {}
    ytPlayer = null;
    if (fileVideo) { try { fileVideo.pause(); fileVideo.removeAttribute("src"); fileVideo.load(); } catch (e) {} fileVideo = null; }
    ytPlayerReady = false; ytEverPlayed = false;
  }

  // Push the outcome to Firebase so config.html can show it on the phone. The TV
  // is across the room and has no console — without this, every failure mode looks
  // the same from where the link was pasted.
  var lastStatus = null, lastNote = "";
  function reportVideoStatus(ok, msg) {
    var s = ok ? "ok" : ("fail:" + msg);
    if (!ok) lastNote = msg || "";
    if (s === lastStatus || !global.BGF || !BGF.fbSet) return;
    lastStatus = s;
    try { BGF.fbSet("video/status", { ok: !!ok, note: msg || "", at: Date.now() }).catch(function () {}); }
    catch (e) {}
  }

  // Give up on this link and say why, in the panel where the video would be. A
  // white rectangle is indistinguishable from a broken TV; a sentence isn't.
  function failVideo(msg) {
    videoFailed = true;
    reportVideoStatus(false, msg);
    destroyPlayers();
    if (!videoHost) return;
    videoHost.innerHTML = "";
    var box = document.createElement("div");
    box.style.cssText = "width:100%;height:100%;display:flex;align-items:center;justify-content:center;text-align:center;" +
      "padding:5%;box-sizing:border-box;line-height:1.35;font-weight:600;font-size:22px;font-size:clamp(14px,1.7vw,26px);color:#fff;opacity:.92;";
    box.textContent = msg;
    videoHost.appendChild(box);
  }

  function recoverVideo(reason) {
    if (recovering || videoFailed) return;
    // A rebuild loop that never succeeds just holds a blank panel — cap it.
    if (++buildFails > MAX_BUILD_FAILS) { failVideo(reason || NOTE_WEBVIEW); return; }
    recovering = true;
    wdLastTime = -1; wdStuck = 0;
    destroyPlayers();
    setTimeout(function () {
      recovering = false;
      if (videoOn && !videoFailed) buildActive();
    }, 2500);
  }

  // Watchdog: if playback should be advancing but currentTime is frozen (buffering
  // forever / blank surface), rebuild the player; if paused/ended, nudge it.
  function videoWatchdog() {
    if (!videoOn || recovering || videoFailed) return;
    if (curKind === "file") {
      if (!fileVideo) return;
      var ft = fileVideo.currentTime, paused = fileVideo.paused, paused2 = fileVideo.ended;
      if (paused || paused2) { try { fileVideo.play(); } catch (e) {} wdStuck = 0; wdLastTime = -1; return; }
      if (typeof ft === "number" && Math.abs(ft - wdLastTime) < 0.2) wdStuck += WD_STEP_MS; else wdStuck = 0;
      wdLastTime = (typeof ft === "number") ? ft : wdLastTime;
      if (wdStuck >= WD_STUCK_LIMIT) recoverVideo();
      return;
    }
    if (!ytPlayer || !ytPlayerReady || !global.YT) return;
    var S = global.YT.PlayerState, st, t;
    try { st = ytPlayer.getPlayerState(); t = ytPlayer.getCurrentTime(); }
    catch (e) { recoverVideo(); return; }
    if (st === S.PLAYING) { ytEverPlayed = true; applyVQ(ytPlayer); } // ABR climbs back up; hold it down
    if (st === S.PLAYING || st === S.BUFFERING) {
      if (typeof t === "number" && Math.abs(t - wdLastTime) < 0.2) wdStuck += WD_STEP_MS; else wdStuck = 0;
      wdLastTime = (typeof t === "number") ? t : wdLastTime;
      if (wdStuck >= WD_STUCK_LIMIT) recoverVideo(ytEverPlayed ? null : NOTE_WEBVIEW);
    } else {
      // UNSTARTED/CUED/PAUSED/ENDED: nudge it, but keep counting. This branch used
      // to reset the counter, so a player that never started was never rebuilt —
      // it just held a white panel indefinitely.
      wdStuck += WD_STEP_MS; wdLastTime = -1;
      try { ytPlayer.playVideo(); } catch (e) {}
      if (wdStuck >= WD_STUCK_LIMIT) recoverVideo(ytEverPlayed ? null : NOTE_WEBVIEW);
    }
  }

  function teardownVideo() {
    videoOn = false; curSig = ""; curParsed = null; curFileUrl = ""; curKind = ""; curBadReason = "";
    buildFails = 0; videoFailed = false;
    destroyPlayers();
    if (videoEl && videoEl.parentNode) videoEl.parentNode.removeChild(videoEl);
    rightActive = null; // force loadRight to treat this as a change and repaint
    loadRight();        // (the panel was emptied to host the video)
  }

  function loadVideo() {
    if (!global.BGF) return;
    var right = document.getElementById("sgRight");
    if (!right) return;
    BGF.fbGet("video").then(function (v) {
      v = v || {};
      var src = (v.on === true) ? classifyVideo(v.url) : null;
      if (!src) { if (videoOn) teardownVideo(); return; } // off or unrecognized URL
      var sound = (v.sound === true);
      var ident = src.kind === "file" ? src.url
        : src.kind === "bad" ? src.reason
        : (src.parsed.videoId + "|" + src.parsed.listId + "|" + src.parsed.channelId);
      var sig = src.kind + "|" + ident + "|" + (sound ? 1 : 0);
      // Same video already running — leave it completely alone (never reload on poll).
      if (videoOn && sig === curSig && videoEl && videoEl.parentNode === right) {
        // A re-save from the phone clears /video/status; re-publish the verdict we
        // already have so the panel there doesn't sit blank forever.
        if (!v.status && (videoFailed || ytEverPlayed)) {
          lastStatus = null;
          reportVideoStatus(!videoFailed, videoFailed ? lastNote : "");
        }
        return;
      }
      curSig = sig; curKind = src.kind; curSound = sound;
      curParsed = (src.kind === "yt") ? src.parsed : null;
      curFileUrl = (src.kind === "file") ? src.url : "";
      curBadReason = (src.kind === "bad") ? src.reason : "";
      videoOn = true;
      buildFails = 0; videoFailed = false; lastStatus = null; // new link: fresh retries, re-report
      if (!videoEl) videoEl = makeVideoEl();
      if (videoEl.parentNode !== right) { right.innerHTML = ""; right.appendChild(videoEl); }
      destroyPlayers();  // clear any previous player before building the new one
      if (curKind === "bad") { failVideo(curBadReason); return; }
      if (!wdTimer) wdTimer = setInterval(videoWatchdog, WD_STEP_MS);
      buildActive();
    }).catch(function () {});
  }

  // ---- Live tournament overlay (Pokémon / TOM) -------------------------
  // When the "Live event on TV" toggle (display/board) is on AND a Pokémon TOM
  // tournament is live, overlay the full-screen tournament board (board.html —
  // the rotating pairings ↔ standings). Commander/Swiss keep their in-panel
  // standings (handled by loadRight), so this is scoped to Pokémon only.
  var tvOvEl = null, tvOvFrame = null, tvOvSrc = "";
  // Stable per page-load cache-buster so a reload picks up a new board.html,
  // but the src stays constant across polls (no reload loop). Refreshes on the
  // page's hourly self-reload.
  var tvCb = String(Date.now());
  function ensureTvOverlay() {
    if (tvOvEl) return;
    tvOvEl = document.createElement("div");
    tvOvEl.style.cssText = "position:fixed;top:0;left:0;right:0;bottom:0;width:100%;height:100%;background:#0b0d12;display:none;z-index:9500;";
    tvOvFrame = document.createElement("iframe");
    tvOvFrame.setAttribute("scrolling", "no");
    tvOvFrame.setAttribute("title", "Live tournament board");
    tvOvFrame.style.cssText = "width:100%;height:100%;border:0;display:block;";
    tvOvEl.appendChild(tvOvFrame);
    document.body.appendChild(tvOvEl);
  }
  function applyTvOverlay(src) {
    ensureTvOverlay();
    if (!src) {
      if (tvOvSrc) { tvOvSrc = ""; tvOvFrame.src = "about:blank"; tvOvEl.style.display = "none"; }
      return;
    }
    tvOvEl.style.display = "block";
    if (src !== tvOvSrc) { tvOvSrc = src; tvOvFrame.src = src; }
  }
  function loadTourneyOverlay() {
    if (!global.BGF) return;
    Promise.all([BGF.fbGet("display/board"), BGF.getConfig()]).then(function (r) {
      var on = r[0] === true;
      var active = (r[1] && r[1].active) || "main";
      if (on && active === "pokemon" && BGF.latestLiveTournament) {
        BGF.latestLiveTournament().then(function (live) {
          // Carry a rotate param through so a portrait-mounted TV still reads right.
          var q = location.search ? ("&" + location.search.slice(1)) : "";
          applyTvOverlay(live ? ("board.html?t=" + tvCb + q) : "");
        }).catch(function () { applyTvOverlay(""); });
      } else {
        applyTvOverlay("");
      }
    }).catch(function () {});
  }

  // ---- init ------------------------------------------------------------
  function init() {
    var screen = (qp("screen") === "entrance") ? "entrance" : "main";
    document.body.setAttribute("data-screen", screen);
    // Optional CSS rotation for a portrait-mounted TV driven by a landscape-only
    // device (e.g. a Fire TV Stick): ?rotate=ccw (counter-clockwise) or =cw.
    var rot = qp("rotate");
    if (rot === "cw" || rot === "ccw") document.body.setAttribute("data-rotate", rot);

    startClock();
    loadEvents(); setInterval(loadEvents, POLL_EVENTS_MS);
    loadTicker(); loadFun(); loadJokeFile();
    setInterval(function () { loadTicker(); loadFun(); }, POLL_FB_MS);

    if (screen === "entrance") {
      renderEntranceQR(); setInterval(renderEntranceQR, POLL_FB_MS);
    } else {
      loadRight(); setInterval(loadRight, POLL_RIGHT_MS);
      setInterval(rotateRight, 10000); // live: standings↔pairings/pods · showcase: next event
      // Classroom mode: phone-controlled slides overlay the board when turned on.
      loadPresent(); setInterval(loadPresent, 1500);
      // Video mode: a YouTube background overlays the board when turned on.
      loadVideo(); setInterval(loadVideo, 1500);
      // Live Pokémon tournament: overlay the TOM pairings/standings board.
      loadTourneyOverlay(); setInterval(loadTourneyOverlay, 5000);
    }

    // Unattended signage: reload hourly with a cache-buster so future updates
    // reach the TVs even when the kiosk browser caches aggressively.
    setTimeout(function () {
      try { var u = new URL(location.href); u.searchParams.set("t", String(Date.now())); location.replace(u.toString()); }
      catch (e) { location.reload(); }
    }, 20 * 60 * 1000);  // every ~20 min: frees Chromium memory on low-RAM kiosks (512MB Pi, Fire Stick)
  }

  global.Signage = { init: init };
})(typeof window !== "undefined" ? window : globalThis);
