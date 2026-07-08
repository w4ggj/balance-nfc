/* ============================================================
   Balance Martial Arts & Gaming — in-store signage board
   Runs on the two shop TVs (kiosk browsers), replacing DakBoard.
     signage.html?screen=main      → 75" landscape play-area TV
     signage.html?screen=entrance  → 40" portrait counter TV
   Shared: header + clock, upcoming events (Cloudflare Worker feed),
   today's special, and a scrolling ticker (Firebase /signage/*).
   main only:     flips to the live event board (shared mountEventOverlay).
   entrance only: a "scan to register" QR.
   Style mirrors the repo: IIFE module, var, plain fetch, vw/vh sizing.
   ============================================================ */
(function (global) {
  "use strict";

  var TIMEZONE = "America/New_York";
  var CLOSE_HOUR = 22; // 10 PM — specials flagged clearAtClose hide after this
  var EVENTS_URL = "https://balancegamingfl.com/collections/events";
  var POLL_EVENTS_MS = 60000;   // Worker feed
  var POLL_FB_MS = 20000;       // ticker + special + featured

  function el(t, c, x) { var e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; }
  function qp(name) { return new URLSearchParams(location.search).get(name); }

  // ---- date/time helpers (store timezone) ------------------------------
  function fmt(dObj, opts) { opts = opts || {}; opts.timeZone = TIMEZONE; return new Intl.DateTimeFormat("en-US", opts).format(dObj); }
  function storeHour() { return parseInt(fmt(new Date(), { hour: "2-digit", hourCycle: "h23" }), 10); }
  function dayKey(dObj) { return fmt(dObj, { year: "numeric", month: "2-digit", day: "2-digit" }); }
  function isToday(dObj) { return dayKey(dObj) === dayKey(new Date()); }
  function dayLabel(dObj) { return isToday(dObj) ? "Today" : fmt(dObj, { weekday: "short", month: "short", day: "numeric" }); }
  function timeLabel(ev, dObj) { return ev.allDay ? "All day" : fmt(dObj, { hour: "numeric", minute: "2-digit" }); }

  // ---- clock -----------------------------------------------------------
  function startClock() {
    var c = document.getElementById("sgClock");
    if (!c) return;
    function tick() {
      c.innerHTML = "";
      c.appendChild(el("div", "sg-time", fmt(new Date(), { hour: "numeric", minute: "2-digit" })));
      c.appendChild(el("div", "sg-date", fmt(new Date(), { weekday: "long", month: "long", day: "numeric" })));
    }
    tick(); setInterval(tick, 1000 * 30);
  }

  // ---- upcoming events (Worker feed) -----------------------------------
  var lastEvents = [];
  function loadEvents() {
    var api = (global.BGF && global.BGF.BOARD_API) || "";
    if (!api || /__FILL_IN/.test(api)) { renderEvents(null); return; }
    fetch(api, { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (data) { lastEvents = (data && data.events) || []; renderEvents(lastEvents); renderQR(); })
      .catch(function () { renderEvents(null); }); // unreachable → graceful state
  }
  function renderEvents(events) {
    var host = document.getElementById("sgEvents");
    if (!host) return;
    host.innerHTML = "";
    if (events === null) {
      host.appendChild(emptyCard("Schedule unavailable", "See the counter for today's games."));
      return;
    }
    if (!events.length) {
      host.appendChild(emptyCard("No upcoming events", "See the counter for today's schedule."));
      return;
    }
    events.forEach(function (ev) {
      var d = new Date(ev.start);
      var card = el("div", "sg-event" + (isToday(d) ? " today" : ""));
      var when = el("div", "sg-when");
      when.appendChild(el("div", "sg-day", dayLabel(d)));
      when.appendChild(el("div", "sg-clock2", timeLabel(ev, d)));
      card.appendChild(when);

      var mid = el("div", "sg-emid");
      if (ev.game) mid.appendChild(el("div", "sg-egame", ev.game));
      mid.appendChild(el("div", "sg-ename", ev.name || "Event"));
      var meta = el("div", "sg-emeta");
      if (ev.ticketed) {
        if (ev.price != null && Number(ev.price) > 0) meta.appendChild(el("span", "sg-price", "$" + ev.price));
        meta.appendChild(seatPill(ev));
      } else {
        meta.appendChild(el("span", "sg-cal", "Calendar event"));
      }
      mid.appendChild(meta);
      card.appendChild(mid);
      host.appendChild(card);
    });
  }
  function seatPill(ev) {
    var status = ev.status || "open";
    var label = (ev.seatsLeft != null)
      ? (status === "sold-out" || ev.seatsLeft <= 0 ? "Sold out"
        : ev.seatsLeft + " seat" + (ev.seatsLeft === 1 ? "" : "s") + " left")
      : ({ open: "Open", almost: "Almost full", "sold-out": "Sold out" }[status] || "Open");
    var cls = "sg-pill " + ({ open: "open", almost: "almost", "sold-out": "soldout" }[status] || "open");
    return el("span", cls, label);
  }
  function emptyCard(t, b) { var c = el("div", "sg-empty"); c.appendChild(el("h2", null, t)); c.appendChild(el("p", null, b)); return c; }

  // ---- today's special -------------------------------------------------
  function loadSpecial() {
    BGF.fbGet("signage/special").then(renderSpecial);
  }
  function renderSpecial(s) {
    var host = document.getElementById("sgSpecial");
    if (!host) return;
    var text = s && s.text;
    var hidden = s && s.clearAtClose !== false && storeHour() >= CLOSE_HOUR;
    if (!text || hidden) { host.hidden = true; host.innerHTML = ""; return; }
    host.hidden = false; host.innerHTML = "";
    host.appendChild(el("span", "sg-special-tag", "Today"));
    host.appendChild(el("span", "sg-special-text", text));
  }

  // ---- ticker ----------------------------------------------------------
  var lastTickerSig = "";
  function loadTicker() {
    BGF.fbGet("signage/ticker").then(function (t) {
      var lines = Array.isArray(t) ? t.filter(Boolean) : [];
      var sig = JSON.stringify(lines);
      if (sig === lastTickerSig) return; // don't restart the animation if unchanged
      lastTickerSig = sig;
      renderTicker(lines);
    });
  }
  function renderTicker(lines) {
    var host = document.getElementById("sgTicker");
    if (!host) return;
    host.innerHTML = "";
    if (!lines.length) { host.hidden = true; return; }
    host.hidden = false;
    // Duplicate the run so the marquee loops seamlessly.
    var track = el("div", "sg-ticker-track");
    for (var rep = 0; rep < 2; rep++) {
      lines.forEach(function (line) {
        track.appendChild(el("span", "sg-ticker-item", line));
        track.appendChild(el("span", "sg-ticker-dot", "•"));
      });
    }
    host.appendChild(track);
  }

  // ---- entrance QR -----------------------------------------------------
  var lastQRUrl = "";
  function renderQR() {
    var host = document.getElementById("sgQR");
    if (!host || typeof global.qrcode !== "function") return;
    BGF.fbGet("signage/featured").then(function (featured) {
      var url = qrTarget(featured);
      if (url === lastQRUrl) return;
      lastQRUrl = url;
      try {
        var qr = global.qrcode(0, "M");
        qr.addData(url); qr.make();
        host.innerHTML = qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
      } catch (e) { host.innerHTML = ""; }
    });
  }
  function qrTarget(featured) {
    // Featured handle → that event's registerUrl; else first ticketed event's
    // registerUrl; else the store events collection.
    if (featured && typeof featured === "string") {
      for (var i = 0; i < lastEvents.length; i++) {
        var ru = lastEvents[i].registerUrl || "";
        if (ru.indexOf(featured) !== -1) return ru;
      }
    }
    for (var j = 0; j < lastEvents.length; j++) {
      if (lastEvents[j].registerUrl) return lastEvents[j].registerUrl;
    }
    return EVENTS_URL;
  }

  // ---- init ------------------------------------------------------------
  function init() {
    var screen = (qp("screen") === "entrance") ? "entrance" : "main";
    document.body.setAttribute("data-screen", screen);

    startClock();
    loadEvents(); setInterval(loadEvents, POLL_EVENTS_MS);
    loadSpecial(); loadTicker();
    setInterval(function () { loadSpecial(); loadTicker(); }, POLL_FB_MS);

    if (screen === "entrance") {
      renderQR(); setInterval(renderQR, POLL_FB_MS);
    } else {
      // main: flip to the live event board using the SAME logic as overlay.html
      BGF.mountEventOverlay(document.getElementById("sgScreen"));
    }

    // Unattended signage: reload hourly so future updates reach the TVs.
    setTimeout(function () { location.reload(); }, 60 * 60 * 1000);
  }

  global.Signage = { init: init };
})(typeof window !== "undefined" ? window : globalThis);
