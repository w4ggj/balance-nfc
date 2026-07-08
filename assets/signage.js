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
  function whenLine(ev, d) {
    var day = isToday(d) ? "Tonight" : fmt(d, { weekday: "short" });
    var time = ev.allDay ? "All day" : fmt(d, { hour: "numeric", minute: "2-digit" });
    return day + " · " + time;
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
  function todayId() { var p = function (n) { return n < 10 ? "0" + n : "" + n; }; var d = new Date(); return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()); }

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
      var d = new Date(ev.start);
      var card = el("div", "sg-ev" + (isToday(d) ? " featured" : ""));
      card.appendChild(el("div", "sg-ev-when", whenLine(ev, d)));
      card.appendChild(el("div", "sg-ev-name", ev.name || "Event"));
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
    var right = document.getElementById("sgRight");
    if (!right) return;
    if (!rightLive) { renderShowcase(); return; }
    if (rightActive === "commander-league") {
      if (rightView === 1) paintPods(right, rightData || {});
      else paintStandings(right, commanderView(rightData || {}), rightActive);
    } else if (rightActive === "tournament") {
      if (rightView === 1) paintPairings(right, rightData || {});
      else paintStandings(right, swissView(rightData || {}), rightActive);
    } else {
      paintEventCard(right, rightActive);
    }
  }
  function rotateRight() {
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
    var right = document.getElementById("sgRight");
    if (!right) return;
    var items = buildShowcase();
    if (!items.length) { paintWelcome(right); return; }
    var it = items[showcaseIdx % items.length];
    if (it.kind === "fun") { paintFunCard(right, it.text); return; }
    right.style.setProperty("--ev", "#a07bff");
    var ev = it.ev, d = new Date(ev.start);
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
    info.appendChild(el("div", "sg-re-name", ev.name || "Event"));
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
    var night = (c.nights || {})[todayId()];
    var round = night ? (night.currentGame || 0) : 0;
    return { title: "Commander League" + (round ? " — Round " + round : ""), rows: rows };
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
    var night = (c.nights || {})[todayId()];
    var round = night ? (night.currentGame || 0) : 0;
    var head = el("div", "sg-r-head");
    head.appendChild(el("div", "sg-r-title", "Commander League" + (round ? " — Round " + round : "")));
    head.appendChild(el("div", "sg-r-sub", "Tonight's Pods"));
    right.appendChild(head);

    var pods = (night && night.pods) || null;
    if (!pods || !Object.keys(pods).length) {
      right.appendChild(centerMsg("Pods not assigned yet", "Seating shows here once the organizer assigns pods."));
      addCornerQR(right, "commander-league"); return;
    }
    var name = function (uid) { return (c.players && c.players[uid] && c.players[uid].name) || "Player"; };
    var list = el("div", "sg-plist");
    Object.keys(pods).sort(function (a, b) { return (pods[a].table || 0) - (pods[b].table || 0); }).forEach(function (pn) {
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
      right.appendChild(eventCardEls(match, new Date(match.start), match.game));
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
      if (lastEvents[i].registerUrl) { soonest = lastEvents[i].registerUrl; if (isToday(new Date(lastEvents[i].start))) return lastEvents[i].registerUrl; }
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

  // ---- init ------------------------------------------------------------
  function init() {
    var screen = (qp("screen") === "entrance") ? "entrance" : "main";
    document.body.setAttribute("data-screen", screen);

    startClock();
    loadEvents(); setInterval(loadEvents, POLL_EVENTS_MS);
    loadTicker(); loadFun(); loadJokeFile();
    setInterval(function () { loadTicker(); loadFun(); }, POLL_FB_MS);

    if (screen === "entrance") {
      renderEntranceQR(); setInterval(renderEntranceQR, POLL_FB_MS);
    } else {
      loadRight(); setInterval(loadRight, POLL_RIGHT_MS);
      setInterval(rotateRight, 10000); // live: standings↔pairings/pods · showcase: next event
    }

    // Unattended signage: reload hourly with a cache-buster so future updates
    // reach the TVs even when the kiosk browser caches aggressively.
    setTimeout(function () {
      try { var u = new URL(location.href); u.searchParams.set("t", String(Date.now())); location.replace(u.toString()); }
      catch (e) { location.reload(); }
    }, 60 * 60 * 1000);
  }

  global.Signage = { init: init };
})(typeof window !== "undefined" ? window : globalThis);
