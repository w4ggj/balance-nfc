/* ============================================================
   Balance Martial Arts & Gaming — table landing logic
   Shared by index (router), event pages, and the control panel.
   ============================================================ */
(function () {
  "use strict";

  // ---- Config source of truth ------------------------------------------
  // Live event state is stored in a Firebase Realtime Database. The tag pages
  // READ it on every scan; the staff control panel (config.html) WRITES it with
  // one tap — no commits, no editing files.
  //
  // This URL points at the single `active` value in the database. Database rules
  // allow anyone to read it and to set it only to one of the five valid values
  // (main / pokemon / onepiece / riftbound / mtg).
  //
  // To move to a different backend later, change only this URL — if it ends in
  // a plain JSON file the code still works for reading (writes need Firebase).
  var CONFIG_URL = "https://balance-nfc-default-rtdb.firebaseio.com/active.json";

  // Cloudflare Worker that serves the signage schedule (events + seats-left).
  // Deploy board-api/ (see board-api/SETUP.md), then paste the deployed URL here.
  // The signage board polls this ~every 60s; falls back gracefully if unset.
  var BOARD_API = "https://board-api.jleone0.workers.dev";

  // Is the config backend a Firebase Realtime Database (writable) or a static file?
  function isFirebase() { return /firebaseio|firebasedatabase/.test(CONFIG_URL); }

  // "tournament" is a special landing (Swiss tournament) that behaves like an
  // event for routing purposes — active="tournament" forwards to tournament.html.
  var EVENTS = ["pokemon", "onepiece", "riftbound", "mtg", "tournament"];

  // "commander-league" is a special landing whose page name doesn't match the
  // value (forwards to commander.html, not commander-league.html), so it's kept
  // out of EVENTS and handled explicitly in the router.
  var SPECIAL = { "commander-league": "commander" };

  var LABELS = {
    main:               "Store hub",
    pokemon:            "Pokémon TCG",
    onepiece:           "One Piece TCG",
    riftbound:          "Riftbound",
    mtg:                "Magic: The Gathering",
    tournament:         "Tournament",
    "commander-league": "Commander League"
  };

  var COLORS = {
    main:               "#c81e27",
    pokemon:            "#ffcb05",
    onepiece:           "#ff5a5f",
    riftbound:          "#17c0d6",
    mtg:                "#a07bff",
    tournament:         "#34d399",
    "commander-league": "#e0902a"
  };

  function isValidActive(a) {
    return a === "main" || EVENTS.indexOf(a) !== -1 || Object.prototype.hasOwnProperty.call(SPECIAL, a);
  }

  var MAX_TABLES = 16;

  // ---- Helpers ---------------------------------------------------------
  function getTable() {
    var raw = new URLSearchParams(location.search).get("tbl");
    if (raw == null) return null;
    var n = parseInt(String(raw).trim(), 10);
    if (!Number.isFinite(n) || n < 1 || n > MAX_TABLES) return null;
    return n;
  }

  // Always fetch fresh (no-store) so a scanning phone never sees a stale toggle.
  // Firebase returns the raw value at /active ("pokemon", or null if never set).
  // A static JSON file would return an object like {"active":"pokemon"} — both
  // shapes are handled. Anything unexpected or unreachable falls back to "main"
  // (the store hub), which is always the safe default.
  function getConfig() {
    // Cache-bust static files; Firebase rejects unknown query params, so skip it there.
    var url = isFirebase()
      ? CONFIG_URL
      : CONFIG_URL + (CONFIG_URL.indexOf("?") === -1 ? "?" : "&") + "ts=" + Date.now();
    return fetch(url, { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        var active = null;
        if (typeof data === "string") active = data;                 // Firebase raw value
        else if (data && typeof data.active === "string") active = data.active; // JSON file
        if (!isValidActive(active)) active = "main";
        return { active: active };
      })
      .catch(function () { return { active: "main" }; });
  }

  // Write the active event to Firebase (used by the staff control panel).
  // Body is a bare JSON string, e.g. "pokemon", matching the database rule.
  function setActive(page) {
    if (!isFirebase()) {
      return Promise.reject(new Error("Config backend is read-only (not Firebase)."));
    }
    if (!isValidActive(page)) {
      return Promise.reject(new Error("Invalid event: " + page));
    }
    return fetch(CONFIG_URL, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(page)
    }).then(function (r) {
      if (!r.ok) throw new Error("Save failed (" + r.status + ")");
      return r.json();
    });
  }

  // ---- Generic Firebase Realtime Database helpers ----------------------
  // Used by the tournament pages. Paths are relative to the database root,
  // e.g. fbGet("tournament"), fbSet("tournament/currentRound", 2).
  function dbBase() { return CONFIG_URL.replace(/active\.json.*$/, ""); }

  function fbGet(path) {
    return fetch(dbBase() + path + ".json", { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }
  function fbSet(path, value) {
    return fetch(dbBase() + path + ".json", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(value)
    }).then(function (r) { if (!r.ok) throw new Error("Save failed (" + r.status + ")"); return r.json(); });
  }
  function fbUpdate(path, obj) {
    return fetch(dbBase() + path + ".json", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(obj)
    }).then(function (r) { if (!r.ok) throw new Error("Update failed (" + r.status + ")"); return r.json(); });
  }

  function tblQuery(tbl) { return tbl ? ("?tbl=" + tbl) : ""; }

  // ---- Home router (index.html) ---------------------------------------
  // If an event is active, forward to that event page (carrying the table
  // number). Otherwise reveal the normal store hub.
  function routeHome() {
    var tbl = getTable();
    var params = new URLSearchParams(location.search);

    // ?hub=1 forces the store hub even during an event (for staff / testing).
    if (params.has("hub")) {
      var b = document.getElementById("boot");
      var h = document.getElementById("hub");
      if (b) b.hidden = true;
      if (h) h.hidden = false;
      return;
    }

    getConfig().then(function (cfg) {
      // While a live TOM Pokémon tournament is running, the Pokémon toggle sends
      // scanners to the live table view (their real pairing) instead of the
      // generic event page. Falls back to pokemon.html when no fresh tournament.
      if (cfg.active === "pokemon") {
        latestLiveTournament().then(function (live) {
          location.replace((live ? "table.html" : "pokemon.html") + tblQuery(tbl));
        });
        return;
      }
      if (SPECIAL[cfg.active]) {
        location.replace(SPECIAL[cfg.active] + ".html" + tblQuery(tbl));
        return;
      }
      if (cfg.active !== "main") {
        location.replace(cfg.active + ".html" + tblQuery(tbl));
        return;
      }
      var boot = document.getElementById("boot");
      var hub = document.getElementById("hub");
      if (boot) boot.hidden = true;
      if (hub) hub.hidden = false;
    });
  }

  // Returns the most-recently-updated tournament if it was posted within the
  // live window (default 12h), else null. Used to decide Pokémon routing.
  var TOM_LIVE_WINDOW_MS = 12 * 3600 * 1000;
  function latestLiveTournament() {
    return fbGet("tournaments").then(function (all) {
      if (!all) return null;
      var best = null;
      Object.keys(all).forEach(function (k) {
        var t = all[k];
        if (t && t.meta && (!best || (t.meta.updatedMs || 0) > (best.meta.updatedMs || 0))) best = t;
      });
      if (!best || !best.meta) return null;
      var age = Date.now() - (best.meta.updatedMs || 0);
      return age < TOM_LIVE_WINDOW_MS ? best : null;
    }).catch(function () { return null; });
  }

  // ---- Event page init (pokemon.html, etc.) ---------------------------
  function initEvent(page) {
    var tbl = getTable();

    // Fill the table badge
    var badge = document.getElementById("tableBadge");
    if (badge) {
      if (tbl) {
        badge.classList.remove("unknown");
        badge.innerHTML = '<span class="lbl">Table</span><span class="num">' + tbl + '</span>';
      } else {
        badge.classList.add("unknown");
        badge.innerHTML = '<span class="lbl">Your table</span><span class="num">Tap the tag on your table</span>';
      }
    }

    // Pass the table number through to any action links marked data-carry-tbl
    if (tbl) {
      document.querySelectorAll("[data-carry-tbl]").forEach(function (a) {
        var href = a.getAttribute("href") || "";
        a.setAttribute("href", href + (href.indexOf("?") === -1 ? "?" : "&") + "tbl=" + tbl);
      });
    }

    // If this event is no longer the active one, show a gentle heads-up.
    getConfig().then(function (cfg) {
      if (cfg.active !== page) {
        var n = document.getElementById("inactiveNotice");
        if (n) n.hidden = false;
      }
    });
  }

  // ---- Control panel (config.html) ------------------------------------
  // One tap = instantly live for every table. Writes straight to Firebase.
  function initConfig() {
    var current = "main";     // what's actually live right now
    var pending = null;       // target being saved (optimistic display)
    var busy = false;         // guard against overlapping writes

    var dot = document.getElementById("liveDot");
    var liveName = document.getElementById("liveName");
    var toggles = Array.prototype.slice.call(document.querySelectorAll(".toggle input[data-page]"));

    // While saving, show the tapped choice optimistically; otherwise what's live.
    function shown() { return busy ? pending : current; }

    function paint() {
      var eff = shown();
      toggles.forEach(function (input) {
        var page = input.getAttribute("data-page");
        var on = (eff === page);
        input.checked = on;
        var row = input.closest(".switch-row, .sys-card");
        if (row) row.setAttribute("data-on", on ? "true" : "false");
      });
      if (dot) dot.style.setProperty("--dot", COLORS[eff]);
      if (liveName) liveName.textContent = busy ? "Saving…" : LABELS[current];
    }

    // Turning one on turns the others off (only one landing at a time).
    // Turning the active one off returns to the store hub.
    function apply(page) {
      if (busy || page === current) { paint(); return; }
      busy = true;
      pending = page;
      paint();
      setActive(page).then(function () {
        current = page;
        busy = false;
        pending = null;
        paint();
        showToast(page === "main"
          ? "Store hub is now live"
          : LABELS[page] + " is now live for every table");
      }).catch(function (err) {
        busy = false;
        pending = null;
        paint(); // revert switches to the real live state
        showToast("Couldn't save — check your connection and try again");
        if (window.console) console.error(err);
      });
    }

    toggles.forEach(function (input) {
      input.addEventListener("change", function () {
        var page = input.getAttribute("data-page");
        apply(input.checked ? page : "main");
      });
    });

    // Load what's currently live
    getConfig().then(function (cfg) {
      current = cfg.active;
      paint();
    });
  }

  var toastTimer;
  function showToast(msg) {
    var t = document.getElementById("toast");
    if (!t) return;
    t.textContent = msg; t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("show"); }, 2400);
  }

  // ---- Big-screen (DakBoard) toggle -----------------------------------
  // Writes /display/board (bool). The overlay page on the ad display reads it:
  // on = show the tournament board over the DakBoard design, off = see-through.
  function initBigScreen() {
    var input = document.getElementById("bigScreenToggle");
    if (!input) return;
    var state = document.getElementById("bigScreenState");
    var busy = false;
    function paint(on) {
      input.checked = on;
      var row = input.closest(".switch-row");
      if (row) row.setAttribute("data-on", on ? "true" : "false");
      if (state) state.textContent = on ? "mirroring the live event" : "showing your normal display";
    }
    fbGet("display/board").then(function (v) { paint(v === true); });
    input.addEventListener("change", function () {
      if (busy) { return; }
      var on = input.checked;
      busy = true; paint(on);
      fbSet("display/board", on)
        .then(function () { showToast(on ? "The live event is on the display" : "Display back to your normal screen"); })
        .catch(function () { paint(!on); showToast("Couldn't switch the display — try again"); })
        .then(function () { busy = false; });
    });
  }

  // ---- Board & signage controls (config.html) -------------------------
  // Staff-edited content for the signage TVs, stored under /signage:
  //   special  { text, clearAtClose }   ticker  [string,…]   featured  handle|null
  // Both screens read these live, so edits appear within seconds.
  function initSignage() {
    var root = document.getElementById("signageControls");
    if (!root) return;

    // Today's special
    var specialText = document.getElementById("sgSpecialText");
    var specialClear = document.getElementById("sgSpecialClear");
    var specialSave = document.getElementById("sgSpecialSave");
    if (specialSave) {
      fbGet("signage/special").then(function (s) {
        if (specialText) specialText.value = (s && s.text) || "";
        if (specialClear) specialClear.checked = !s || s.clearAtClose !== false; // default on
      });
      specialSave.addEventListener("click", function () {
        var payload = { text: (specialText.value || "").trim(), clearAtClose: !!(specialClear && specialClear.checked) };
        fbSet("signage/special", payload)
          .then(function () { showToast(payload.text ? "Today's special updated" : "Special cleared"); })
          .catch(function () { showToast("Couldn't save the special — try again"); });
      });
    }

    // Ticker — editable list of lines
    var tickerList = document.getElementById("sgTickerList");
    var tickerAdd = document.getElementById("sgTickerAdd");
    var tickerInput = document.getElementById("sgTickerInput");
    var lines = [];
    function drawTicker() {
      if (!tickerList) return;
      tickerList.innerHTML = "";
      lines.forEach(function (line, i) {
        var row = document.createElement("div"); row.className = "sg-tline";
        var span = document.createElement("span"); span.className = "sg-tltext"; span.textContent = line;
        row.appendChild(span);
        var ctl = document.createElement("div"); ctl.className = "sg-tlctl";
        ctl.appendChild(miniBtn("↑", function () { if (i > 0) { swap(i, i - 1); } }));
        ctl.appendChild(miniBtn("↓", function () { if (i < lines.length - 1) { swap(i, i + 1); } }));
        ctl.appendChild(miniBtn("✕", function () { lines.splice(i, 1); saveTicker(); }));
        row.appendChild(ctl);
        tickerList.appendChild(row);
      });
      if (!lines.length) { var e = document.createElement("p"); e.className = "hint"; e.textContent = "No ticker messages yet."; tickerList.appendChild(e); }
    }
    function miniBtn(txt, fn) { var b = document.createElement("button"); b.className = "sg-mini"; b.type = "button"; b.textContent = txt; b.addEventListener("click", fn); return b; }
    function swap(a, b) { var t = lines[a]; lines[a] = lines[b]; lines[b] = t; saveTicker(); }
    function saveTicker() {
      drawTicker();
      fbSet("signage/ticker", lines).catch(function () { showToast("Couldn't save the ticker — try again"); });
    }
    if (tickerAdd && tickerInput) {
      fbGet("signage/ticker").then(function (t) { lines = Array.isArray(t) ? t.slice() : []; drawTicker(); });
      function addLine() {
        var v = (tickerInput.value || "").trim();
        if (!v) return;
        lines.push(v); tickerInput.value = ""; saveTicker();
      }
      tickerAdd.addEventListener("click", addLine);
      tickerInput.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); addLine(); } });
    }

    // Ticker scroll speed (pixels/sec; the board keeps the visual speed constant
    // regardless of how many messages there are).
    var tickerSpeed = document.getElementById("sgTickerSpeed");
    if (tickerSpeed) {
      fbGet("signage/tickerSpeed").then(function (v) {
        var n = Number(v) || 80;
        // snap to the closest option
        var opts = Array.prototype.map.call(tickerSpeed.options, function (o) { return Number(o.value); });
        var best = opts.reduce(function (a, b) { return Math.abs(b - n) < Math.abs(a - n) ? b : a; }, opts[0]);
        tickerSpeed.value = String(best);
      });
      tickerSpeed.addEventListener("change", function () {
        fbSet("signage/tickerSpeed", Number(tickerSpeed.value) || 80)
          .then(function () { showToast("Ticker speed updated"); })
          .catch(function () { showToast("Couldn't save speed — try again"); });
      });
    }

    // Reusable add / remove / reorder list editor bound to a Firebase array.
    function wireListEditor(listEl, inputEl, addBtn, path) {
      var lines = [];
      function mini(txt, fn) { var b = document.createElement("button"); b.className = "sg-mini"; b.type = "button"; b.textContent = txt; b.addEventListener("click", fn); return b; }
      function draw() {
        listEl.innerHTML = "";
        lines.forEach(function (line, i) {
          var row = document.createElement("div"); row.className = "sg-tline";
          var span = document.createElement("span"); span.className = "sg-tltext"; span.textContent = line; row.appendChild(span);
          var ctl = document.createElement("div"); ctl.className = "sg-tlctl";
          ctl.appendChild(mini("↑", function () { if (i > 0) { var t = lines[i - 1]; lines[i - 1] = lines[i]; lines[i] = t; save(); } }));
          ctl.appendChild(mini("↓", function () { if (i < lines.length - 1) { var t = lines[i + 1]; lines[i + 1] = lines[i]; lines[i] = t; save(); } }));
          ctl.appendChild(mini("✕", function () { lines.splice(i, 1); save(); }));
          row.appendChild(ctl); listEl.appendChild(row);
        });
        if (!lines.length) { var e = document.createElement("p"); e.className = "hint"; e.textContent = "Nothing added yet."; listEl.appendChild(e); }
      }
      function save() { draw(); fbSet(path, lines).catch(function () { showToast("Couldn't save — try again"); }); }
      fbGet(path).then(function (t) { lines = Array.isArray(t) ? t.slice() : []; draw(); });
      function add() { var v = (inputEl.value || "").trim(); if (!v) return; lines.push(v); inputEl.value = ""; save(); }
      addBtn.addEventListener("click", add);
      inputEl.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); add(); } });
    }

    // Fun rotation — on/off toggle + lines injected into the event spotlight.
    var funToggle = document.getElementById("sgFunToggle");
    if (funToggle) {
      fbGet("signage/funOn").then(function (v) {
        funToggle.checked = v === true;
        var row = funToggle.closest(".sys-card"); if (row) row.setAttribute("data-on", v === true ? "true" : "false");
      });
      funToggle.addEventListener("change", function () {
        var on = funToggle.checked;
        var row = funToggle.closest(".sys-card"); if (row) row.setAttribute("data-on", on ? "true" : "false");
        fbSet("signage/funOn", on)
          .then(function () { showToast(on ? "Fun rotation on" : "Fun rotation off"); })
          .catch(function () { funToggle.checked = !on; if (row) row.setAttribute("data-on", !on ? "true" : "false"); showToast("Couldn't save — try again"); });
      });
    }
    var funList = document.getElementById("sgFunList"), funInput = document.getElementById("sgFunInput"), funAdd = document.getElementById("sgFunAdd");
    if (funList && funInput && funAdd) wireListEditor(funList, funInput, funAdd, "signage/fun");

    // Featured event (Shopify handle, or blank = auto)
    var featInput = document.getElementById("sgFeatured");
    var featSave = document.getElementById("sgFeaturedSave");
    if (featSave && featInput) {
      fbGet("signage/featured").then(function (h) { featInput.value = (typeof h === "string") ? h : ""; });
      featSave.addEventListener("click", function () {
        var v = (featInput.value || "").trim();
        fbSet("signage/featured", v || null)
          .then(function () { showToast(v ? "Featured event set" : "Featured event set to auto"); })
          .catch(function () { showToast("Couldn't save — try again"); });
      });
    }
  }

  // ---- Expose ----------------------------------------------------------
  window.BGF = {
    EVENTS: EVENTS, LABELS: LABELS, COLORS: COLORS, MAX_TABLES: MAX_TABLES, BOARD_API: BOARD_API,
    getTable: getTable, getConfig: getConfig, setActive: setActive,
    fbGet: fbGet, fbSet: fbSet, fbUpdate: fbUpdate,
    routeHome: routeHome, initEvent: initEvent, initConfig: initConfig,
    initBigScreen: initBigScreen, latestLiveTournament: latestLiveTournament,
    initDisplay: initDisplay, mountEventOverlay: mountEventOverlay, initSignage: initSignage
  };

  // ---- Shared event overlay (overlay.html + signage.html main mode) ---
  // Mounts the "live event on the TV" behavior onto an <iframe>: when the
  // big-screen toggle (display/board) is ON and an event is active, the iframe
  // fills with the matching board/info page; OFF (or nothing live) hides it so
  // whatever sits behind (the DakBoard design, or the signage board) shows.
  // Both overlay.html and signage.html call this identical logic — no divergence.
  //   frame       : the <iframe> element to drive
  //   opts.onState : optional callback(src|null) fired when the mounted page changes
  // ?demo=1 forces it on for previewing.
  function mountEventOverlay(frame, opts) {
    if (!frame) return;
    opts = opts || {};
    var demo = new URLSearchParams(location.search).get("demo") != null;
    var passQuery = location.search || "";
    var current = null;

    // Choose the fullscreen page for an active event (null = hide the overlay).
    function targetFor(active, live) {
      switch (active) {
        case "commander-league": return "commander-board.html";
        case "tournament":       return "swiss-board.html" + passQuery;
        case "pokemon":          return (live ? "board.html" + passQuery : "event-tv.html?game=pokemon");
        case "onepiece":         return "event-tv.html?game=onepiece";
        case "riftbound":        return "event-tv.html?game=riftbound";
        case "mtg":              return "event-tv.html?game=mtg";
        default:                 return null; // main / unknown
      }
    }

    function apply(src) {
      if (src === current) return;
      current = src;
      if (!src) {
        frame.style.display = "none";
        if (frame.src && !/about:blank$/.test(frame.src)) frame.src = "about:blank";
      } else {
        frame.style.display = "block";
        if (frame.getAttribute("src") !== src) frame.src = src;
      }
      // `board-live` on <body> lets the host page hide its own design behind the
      // board (overlay.html and signage.html main mode both key off this).
      document.body.classList.toggle("board-live", !!src);
      if (opts.onState) opts.onState(src);
    }

    function tick() {
      var onP = demo ? Promise.resolve(true) : fbGet("display/board");
      onP.then(function (on) {
        if (on !== true && !demo) { apply(null); return; }
        getConfig().then(function (cfg) {
          var active = cfg.active || "main";
          if (active === "pokemon") {
            latestLiveTournament().then(function (live) { apply(targetFor("pokemon", !!live)); });
          } else {
            apply(targetFor(active, false));
          }
        });
      });
    }
    tick();
    setInterval(tick, 5000);
  }

  // overlay.html entry point — drives the #screen iframe with the shared logic.
  function initDisplay() { mountEventOverlay(document.getElementById("screen")); }
})();
