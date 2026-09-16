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
  // Shallow read: returns just the child keys ({key:true,...}), not their data —
  // a tiny request even when a node holds many large children.
  function fbShallow(path) {
    return fetch(dbBase() + path + ".json?shallow=true", { cache: "no-store" })
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
  // live window (default 12h), else null. Used to decide Pokémon routing AND to
  // gate the live-tournament overlay on the shop TVs.
  var TOM_LIVE_WINDOW_MS = 12 * 3600 * 1000;
  function withinWindow(t) {
    if (!t || !t.meta) return null;
    var age = Date.now() - (t.meta.updatedMs || 0);
    return age < TOM_LIVE_WINDOW_MS ? t : null;
  }
  // Fallback: read the whole pile and pick the freshest. Fine on a fast browser;
  // avoided on weak kiosks (Fire Stick) because parsing every past event can time
  // out — which silently returned null and left the TV with no board overlay.
  function fullScanLiveTournament() {
    return fbGet("tournaments").then(function (all) {
      if (!all) return null;
      var best = null;
      Object.keys(all).forEach(function (k) {
        var t = all[k];
        if (t && t.meta && (!best || (t.meta.updatedMs || 0) > (best.meta.updatedMs || 0))) best = t;
      });
      return withinWindow(best);
    }).catch(function () { return null; });
  }
  function latestLiveTournament() {
    // Prefer a tiny shallow key list, then read ONLY the newest tournament — the
    // same lightweight path board.html uses, so weak kiosks don't choke on the
    // full /tournaments history just to learn whether an event is live.
    if (!fbShallow) return fullScanLiveTournament();
    return fbShallow("tournaments").then(function (keys) {
      var ks = keys ? Object.keys(keys) : [];
      var tom = ks.filter(function (k) { return /^\d{2}-\d{2}-\d+$/.test(k); }).sort();
      if (!tom.length) return fullScanLiveTournament();
      return fbGet("tournaments/" + tom[tom.length - 1]).then(withinWindow);
    }).catch(function () { return fullScanLiveTournament(); });
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

    // "Refresh all TVs" — bumps /display/reloadAt to now(); every kiosk page
    // sees the change on its next poll and reloads itself. Lets staff push a
    // reload to ceiling-mounted screens with no keyboard, from their phone.
    var refreshBtn = document.getElementById("refreshTvsBtn");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", function () {
        if (refreshBtn.disabled) return;
        refreshBtn.disabled = true;
        refreshAllTVs()
          .then(function () { showToast("Refreshing all TVs…"); })
          .catch(function () { showToast("Couldn't refresh — try again"); })
          .then(function () { setTimeout(function () { refreshBtn.disabled = false; }, 4000); });
      });
    }
  }

  // ---- Remote "Refresh all TVs" ---------------------------------------
  // Every kiosk page (signage, lounge) watches /display/reloadAt. The config
  // button bumps it to now(); each screen sees the change on its next poll and
  // reloads with a cache-buster. Loop-safe: a page records the value it first
  // sees as its baseline and reloads only when the value INCREASES past it, so
  // it never reloads on its own load and never loops after reloading.
  function forceReload() {
    try {
      var u = new URL(location.href);
      u.searchParams.set("t", String(Date.now()));
      location.replace(u.toString());
    } catch (e) { location.reload(); }
  }
  function initRemoteReload() {
    var baseline = null;
    function check() {
      fbGet("display/reloadAt").then(function (v) {
        var n = Number(v) || 0;
        if (baseline === null) { baseline = n; return; }   // first read = baseline
        if (n > baseline) { baseline = n; forceReload(); }
      }).catch(function () {});
    }
    check();
    setInterval(check, 15000);
  }
  function refreshAllTVs() { return fbSet("display/reloadAt", Date.now()); }

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
    var funFile = document.getElementById("sgFunFile");
    if (funFile) {
      fbGet("signage/funFile").then(function (v) { funFile.checked = v !== false; }); // default on
      funFile.addEventListener("change", function () {
        fbSet("signage/funFile", funFile.checked)
          .then(function () { showToast(funFile.checked ? "Joke pack on" : "Joke pack off"); })
          .catch(function () { funFile.checked = !funFile.checked; showToast("Couldn't save — try again"); });
      });
    }
    var funList = document.getElementById("sgFunList"), funInput = document.getElementById("sgFunInput"), funAdd = document.getElementById("sgFunAdd");
    if (funList && funInput && funAdd) wireListEditor(funList, funInput, funAdd, "signage/fun");

    // Presentation (classroom slides on the main board)
    // /present { on, idx, slides:[imageUrl,...] }. Saving slides resets idx so a
    // fresh deck starts at slide 1. The phone remote (present-remote.html)
    // advances idx live; the board overlays slides[idx] when `on` is true.
    var presentToggle = document.getElementById("sgPresentToggle");
    var presentSlides = document.getElementById("sgPresentSlides");
    var presentSave = document.getElementById("sgPresentSave");
    if (presentToggle) {
      fbGet("present/on").then(function (v) {
        presentToggle.checked = v === true;
        var row = presentToggle.closest(".sys-card"); if (row) row.setAttribute("data-on", v === true ? "true" : "false");
      });
      presentToggle.addEventListener("change", function () {
        var on = presentToggle.checked;
        var row = presentToggle.closest(".sys-card"); if (row) row.setAttribute("data-on", on ? "true" : "false");
        fbSet("present/on", on)
          .then(function () { showToast(on ? "Presentation on — board is showing slides" : "Presentation off — board back to normal"); })
          .catch(function () { presentToggle.checked = !on; if (row) row.setAttribute("data-on", !on ? "true" : "false"); showToast("Couldn't save — try again"); });
      });
    }
    if (presentSlides) {
      fbGet("present/slides").then(function (s) {
        presentSlides.value = Array.isArray(s) ? s.filter(Boolean).join("\n") : "";
      });
    }
    if (presentSave && presentSlides) {
      presentSave.addEventListener("click", function () {
        var slides = (presentSlides.value || "").split("\n").map(function (l) { return l.trim(); }).filter(Boolean);
        fbUpdate("present", { slides: slides.length ? slides : null, idx: 0 })
          .then(function () { showToast(slides.length ? (slides.length + " slide" + (slides.length === 1 ? "" : "s") + " saved") : "Slides cleared"); })
          .catch(function () { showToast("Couldn't save slides — try again"); });
      });
    }
    // PDF deck: one link (a PowerPoint exported to PDF). Takes precedence over
    // image slides on the board; idx becomes the page number. Saving resets to
    // page 1 and clears the old page count so the remote re-reads it.
    var presentPdf = document.getElementById("sgPresentPdf");
    var presentPdfSave = document.getElementById("sgPresentPdfSave");
    if (presentPdf) {
      fbGet("present/pdf").then(function (u) { presentPdf.value = (typeof u === "string") ? u : ""; });
    }
    if (presentPdfSave && presentPdf) {
      presentPdfSave.addEventListener("click", function () {
        var url = (presentPdf.value || "").trim();
        fbUpdate("present", { pdf: url || null, idx: 0, pages: null })
          .then(function () { showToast(url ? "PDF saved — turn on Presentation to show it" : "PDF cleared"); })
          .catch(function () { showToast("Couldn't save the PDF link — try again"); });
      });
    }
    // Speaker notes: one block per slide/page, separated by a line of "---".
    // Stored as /present/notes = [note, note, …] and shown ONLY on the phone
    // remote (never on the TV). Empty blocks are kept so notes stay aligned to
    // their slide number.
    var presentNotes = document.getElementById("sgPresentNotes");
    var presentNotesSave = document.getElementById("sgPresentNotesSave");
    if (presentNotes) {
      fbGet("present/notes").then(function (n) { presentNotes.value = Array.isArray(n) ? n.join("\n---\n") : ""; });
    }
    if (presentNotesSave && presentNotes) {
      presentNotesSave.addEventListener("click", function () {
        var chunks = (presentNotes.value || "")
          .split(/^[ \t]*-{3,}[ \t]*$/m)
          .map(function (s) { return s.replace(/^\s+|\s+$/g, ""); });
        while (chunks.length && chunks[chunks.length - 1] === "") chunks.pop();
        var hasAny = chunks.some(function (c) { return c !== ""; });
        fbUpdate("present", { notes: hasAny ? chunks : null })
          .then(function () { showToast(hasAny ? ("Notes saved for " + chunks.length + " slide" + (chunks.length === 1 ? "" : "s")) : "Notes cleared"); })
          .catch(function () { showToast("Couldn't save notes — try again"); });
      });
    }
    // "Pull notes from PDF": PowerPoint speaker notes exported as PDF comment
    // annotations (one per page) are invisible on the TV but readable with
    // pdf.js. Extract each page's comment text, fill the notes box, and save —
    // so the phone remote shows them with zero manual typing.
    var presentNotesPull = document.getElementById("sgPresentNotesPull");
    if (presentNotesPull && presentNotes) {
      presentNotesPull.addEventListener("click", function () {
        var url = ((presentPdf && presentPdf.value) || "").trim();
        var pull = function (u) {
          if (!u) { showToast("Add and save a PDF link first"); return; }
          presentNotesPull.disabled = true;
          showToast("Reading notes from the PDF…");
          notesFromPdf(u).then(function (notes) {
            var hasAny = notes.some(function (c) { return c && c.trim(); });
            if (!hasAny) { showToast("No speaker notes found in that PDF"); presentNotesPull.disabled = false; return; }
            presentNotes.value = notes.map(function (n) { return (n || "").trim(); }).join("\n---\n");
            fbUpdate("present", { notes: notes })
              .then(function () { showToast("Pulled notes for " + notes.length + " slide" + (notes.length === 1 ? "" : "s")); })
              .catch(function () { showToast("Read the notes, but couldn't save — tap Save notes"); })
              .then(function () { presentNotesPull.disabled = false; });
          }).catch(function () { showToast("Couldn't read that PDF (link or CORS) — check the link"); presentNotesPull.disabled = false; });
        };
        if (url) pull(url); else fbGet("present/pdf").then(function (u) { pull((typeof u === "string" ? u : "").trim()); });
      });
    }
    // Deck library: list the PDFs in the education repo's presentations/ folder
    // (GitHub's public contents API, CORS-enabled) so staff just pick the day's
    // deck from a dropdown. Picking one loads it on the TV and pulls its notes.
    var LIB = { owner: "w4ggj", repo: "tavaone-education", branch: "main", dir: "presentations" };
    function libUrl(name) {
      return "https://cdn.jsdelivr.net/gh/" + LIB.owner + "/" + LIB.repo + "@" + LIB.branch + "/" + LIB.dir + "/" +
        name.split("/").map(encodeURIComponent).join("/");
    }
    var pdfPick = document.getElementById("sgPresentPdfPick");
    var pdfRefresh = document.getElementById("sgPresentPdfRefresh");
    function fillPdfList() {
      if (!pdfPick) return;
      var api = "https://api.github.com/repos/" + LIB.owner + "/" + LIB.repo + "/contents/" + LIB.dir + "?ref=" + LIB.branch;
      fetch(api, { cache: "no-store", headers: { "Accept": "application/vnd.github+json" } })
        .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
        .then(function (list) {
          var pdfs = (Array.isArray(list) ? list : [])
            .filter(function (f) { return f.type === "file" && /\.pdf$/i.test(f.name); })
            .map(function (f) { return f.name; }).sort();
          pdfPick.innerHTML = "";
          var o0 = document.createElement("option");
          o0.value = ""; o0.textContent = pdfs.length ? "— choose a deck —" : "— no PDFs found —";
          pdfPick.appendChild(o0);
          pdfs.forEach(function (n) {
            var o = document.createElement("option"); o.value = n; o.textContent = n.replace(/\.pdf$/i, "");
            pdfPick.appendChild(o);
          });
          var cur = (presentPdf && presentPdf.value || "").trim();  // reflect the loaded deck
          pdfs.forEach(function (n) { if (libUrl(n) === cur) pdfPick.value = n; });
        })
        .catch(function () { pdfPick.innerHTML = "<option value=''>— couldn't load list (tap ↻) —</option>"; });
    }
    if (pdfPick) {
      fillPdfList();
      pdfPick.addEventListener("change", function () {
        var name = pdfPick.value; if (!name) return;
        var url = libUrl(name);
        if (presentPdf) presentPdf.value = url;
        showToast("Loading " + name.replace(/\.pdf$/i, "") + "…");
        fbUpdate("present", { pdf: url, idx: 0, pages: null }).then(function () {
          return notesFromPdf(url).then(function (notes) {   // best-effort auto-pull
            var hasAny = notes.some(function (c) { return c && c.trim(); });
            if (hasAny) {
              if (presentNotes) presentNotes.value = notes.map(function (n) { return (n || "").trim(); }).join("\n---\n");
              return fbUpdate("present", { notes: notes }).then(function () { showToast("Deck loaded + notes pulled"); });
            }
            if (presentNotes) presentNotes.value = "";
            return fbUpdate("present", { notes: null }).then(function () { showToast("Deck loaded (no notes in this PDF)"); });
          }).catch(function () { showToast("Deck loaded (couldn't read notes)"); });
        }).catch(function () { showToast("Couldn't load that deck — try again"); });
      });
    }
    if (pdfRefresh) pdfRefresh.addEventListener("click", fillPdfList);

    // Video background (YouTube on the main board) — /video { on, url, sound }
    var videoToggle = document.getElementById("sgVideoToggle");
    var videoUrl = document.getElementById("sgVideoUrl");
    var videoSound = document.getElementById("sgVideoSound");
    var videoSave = document.getElementById("sgVideoSave");
    var videoStatus = document.getElementById("sgVideoStatus");

    // The TV writes /video/status after it tries a link, so a failure is readable
    // here on the phone instead of only as a blank panel across the room.
    function paintVideoStatus(st) {
      if (!videoStatus) return;
      if (!st || typeof st.ok !== "boolean") { videoStatus.style.display = "none"; return; }
      videoStatus.style.display = "";
      videoStatus.style.color = st.ok ? "#22c55e" : "#f87171";
      videoStatus.textContent = st.ok ? "✓ Playing on the big TV." : ("⚠ The TV couldn't play this: " + (st.note || "unknown error"));
    }
    function pollVideoStatus() { fbGet("video/status").then(paintVideoStatus).catch(function () {}); }

    if (videoToggle || videoUrl) {
      fbGet("video").then(function (v) {
        v = v || {};
        if (videoUrl) videoUrl.value = (typeof v.url === "string") ? v.url : "";
        if (videoSound) videoSound.checked = v.sound === true;
        if (videoToggle) {
          videoToggle.checked = v.on === true;
          var row = videoToggle.closest(".sys-card"); if (row) row.setAttribute("data-on", v.on === true ? "true" : "false");
        }
        paintVideoStatus(v.status);
      });
      // Follow the TV for a while after a change — it reports within a few seconds.
      setInterval(pollVideoStatus, 4000);
    }
    if (videoToggle) {
      videoToggle.addEventListener("change", function () {
        var on = videoToggle.checked;
        var row = videoToggle.closest(".sys-card"); if (row) row.setAttribute("data-on", on ? "true" : "false");
        fbSet("video/on", on)
          .then(function () { showToast(on ? "Video on — playing on the big TV" : "Video off — board back to normal"); })
          .catch(function () { videoToggle.checked = !on; if (row) row.setAttribute("data-on", !on ? "true" : "false"); showToast("Couldn't save — try again"); });
      });
    }
    if (videoSave && videoUrl) {
      videoSave.addEventListener("click", function () {
        var url = (videoUrl.value || "").trim();
        // Clear the old verdict so a stale "couldn't play" doesn't look like the new link's.
        fbUpdate("video", { url: url || null, sound: !!(videoSound && videoSound.checked), status: null })
          .then(function () {
            paintVideoStatus(null);
            showToast(url ? "Video source saved — watching the TV for a result" : "Video source cleared");
          })
          .catch(function () { showToast("Couldn't save the video — try again"); });
      });
    }

    // Share-your-photos links — one per game. Stored as /photoUpload = { pokemon,
    // onepiece, riftbound, mtg }; each game page shows a 📸 button to its own link.
    var photoSave = document.getElementById("sgPhotoSave");
    if (photoSave) {
      var fields = Array.prototype.slice.call(document.querySelectorAll("[id^='sgPhoto'][data-game]"));
      fbGet("photoUpload").then(function (u) {
        // Accept the new per-game object, or an older single string (→ apply to all).
        var map = (u && typeof u === "object") ? u : {};
        var shared = (typeof u === "string") ? u : (u && (u.all || u.url)) || "";
        fields.forEach(function (f) { f.value = (map[f.getAttribute("data-game")] || shared || "").trim(); });
      });
      photoSave.addEventListener("click", function () {
        var out = {};
        fields.forEach(function (f) { var v = (f.value || "").trim(); if (v) out[f.getAttribute("data-game")] = v; });
        fbSet("photoUpload", Object.keys(out).length ? out : null)
          .then(function () { showToast(Object.keys(out).length ? "Photo links saved" : "Photo links cleared"); })
          .catch(function () { showToast("Couldn't save — try again"); });
      });
    }

    // Lounge TV — its own rotating images, independent of the boards. /lounge
    // { images:[url,...], seconds }.
    var loungeImages = document.getElementById("sgLoungeImages");
    var loungeSeconds = document.getElementById("sgLoungeSeconds");
    var loungeSave = document.getElementById("sgLoungeSave");
    if (loungeImages) {
      fbGet("lounge").then(function (l) {
        l = l || {};
        loungeImages.value = Array.isArray(l.images) ? l.images.filter(Boolean).join("\n") : "";
        if (loungeSeconds && l.seconds) {
          var opts = Array.prototype.map.call(loungeSeconds.options, function (o) { return Number(o.value); });
          var best = opts.reduce(function (a, b) { return Math.abs(b - l.seconds) < Math.abs(a - l.seconds) ? b : a; }, opts[0]);
          loungeSeconds.value = String(best);
        }
      });
    }
    if (loungeSave && loungeImages) {
      loungeSave.addEventListener("click", function () {
        var images = (loungeImages.value || "").split("\n").map(function (s) { return s.trim(); }).filter(Boolean);
        var secs = loungeSeconds ? (Number(loungeSeconds.value) || 10) : 10;
        fbUpdate("lounge", { images: images.length ? images : null, seconds: secs })
          .then(function () { showToast(images.length ? (images.length + " lounge image" + (images.length === 1 ? "" : "s") + " saved") : "Lounge images cleared"); })
          .catch(function () { showToast("Couldn't save the lounge images — try again"); });
      });
    }

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

  // ---- PDF speaker-note extraction (config page) ----------------------
  // Lazy-load pdf.js (only when someone pulls notes) and read each page's
  // comment annotations — that's where PowerPoint speaker notes land when a
  // deck is exported to PDF with notes as comments. Returns per-page text.
  var PDFJS_VER = "3.11.174";
  var pdfjsLoad = { state: "idle", api: null, cbs: [] };
  function loadPdfJs(cb) {
    if (pdfjsLoad.state === "ready") return cb(pdfjsLoad.api);
    if (pdfjsLoad.state === "failed") return cb(null);
    pdfjsLoad.cbs.push(cb);
    if (pdfjsLoad.state === "loading") return;
    pdfjsLoad.state = "loading";
    var s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/" + PDFJS_VER + "/pdf.min.js";
    s.onload = function () {
      var api = window.pdfjsLib || null;
      if (api) {
        try { api.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/" + PDFJS_VER + "/pdf.worker.min.js"; } catch (e) {}
        pdfjsLoad.state = "ready"; pdfjsLoad.api = api;
      } else { pdfjsLoad.state = "failed"; }
      var cbs = pdfjsLoad.cbs; pdfjsLoad.cbs = []; cbs.forEach(function (f) { f(pdfjsLoad.api); });
    };
    s.onerror = function () { pdfjsLoad.state = "failed"; var cbs = pdfjsLoad.cbs; pdfjsLoad.cbs = []; cbs.forEach(function (f) { f(null); }); };
    document.head.appendChild(s);
  }
  function notesFromPdf(url) {
    return new Promise(function (resolve, reject) {
      loadPdfJs(function (api) {
        if (!api) return reject(new Error("pdfjs unavailable"));
        api.getDocument(url).promise.then(function (doc) {
          var tasks = [];
          for (var i = 1; i <= doc.numPages; i++) tasks.push(doc.getPage(i).then(function (p) { return p.getAnnotations(); }));
          return Promise.all(tasks);
        }).then(function (annPerPage) {
          resolve(annPerPage.map(function (anns) {
            var out = [];
            (anns || []).forEach(function (a) {
              var sub = a.subtype || "";
              if (sub === "Link" || sub === "Popup" || sub === "Widget") return;
              var c = a.contents;
              if (!c && a.contentsObj) c = a.contentsObj.str;
              c = (c || "").replace(/\r/g, "\n").trim();
              if (c && out.indexOf(c) === -1) out.push(c);
            });
            return out.join("\n");
          }));
        }).catch(reject);
      });
    });
  }

  // ---- Expose ----------------------------------------------------------
  window.BGF = {
    EVENTS: EVENTS, LABELS: LABELS, COLORS: COLORS, MAX_TABLES: MAX_TABLES, BOARD_API: BOARD_API,
    getTable: getTable, getConfig: getConfig, setActive: setActive,
    fbGet: fbGet, fbShallow: fbShallow, fbSet: fbSet, fbUpdate: fbUpdate,
    routeHome: routeHome, initEvent: initEvent, initConfig: initConfig,
    initBigScreen: initBigScreen, latestLiveTournament: latestLiveTournament,
    initDisplay: initDisplay, mountEventOverlay: mountEventOverlay, initSignage: initSignage,
    initRemoteReload: initRemoteReload, refreshAllTVs: refreshAllTVs
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
    // Stable per page-load cache-buster so a reload picks up new board pages,
    // while the src stays constant across polls (no reload loop).
    var cb = "cb=" + Date.now();
    function withCb(u) { return u + (u.indexOf("?") === -1 ? "?" : "&") + cb; }

    // Choose the fullscreen page for an active event (null = hide the overlay).
    function targetFor(active, live) {
      switch (active) {
        case "commander-league": return withCb("commander-board.html");
        case "tournament":       return withCb("swiss-board.html" + passQuery);
        case "pokemon":          return withCb(live ? ("board.html" + passQuery) : "event-tv.html?game=pokemon");
        case "onepiece":         return withCb("event-tv.html?game=onepiece");
        case "riftbound":        return withCb("event-tv.html?game=riftbound");
        case "mtg":              return withCb("event-tv.html?game=mtg");
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
