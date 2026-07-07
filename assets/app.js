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

  // Is the config backend a Firebase Realtime Database (writable) or a static file?
  function isFirebase() { return /firebaseio|firebasedatabase/.test(CONFIG_URL); }

  var EVENTS = ["pokemon", "onepiece", "riftbound", "mtg"];

  var LABELS = {
    main:      "Store hub",
    pokemon:   "Pokémon TCG",
    onepiece:  "One Piece TCG",
    riftbound: "Riftbound",
    mtg:       "Magic: The Gathering"
  };

  var COLORS = {
    main:      "#c81e27",
    pokemon:   "#ffcb05",
    onepiece:  "#ff5a5f",
    riftbound: "#17c0d6",
    mtg:       "#a07bff"
  };

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
        if (active !== "main" && EVENTS.indexOf(active) === -1) active = "main";
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
    if (page !== "main" && EVENTS.indexOf(page) === -1) {
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
    var toggles = Array.prototype.slice.call(document.querySelectorAll(".toggle input"));

    // While saving, show the tapped choice optimistically; otherwise what's live.
    function shown() { return busy ? pending : current; }

    function paint() {
      var eff = shown();
      toggles.forEach(function (input) {
        var page = input.getAttribute("data-page");
        var on = (eff === page);
        input.checked = on;
        var row = input.closest(".switch-row");
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

  // ---- Expose ----------------------------------------------------------
  window.BGF = {
    EVENTS: EVENTS, LABELS: LABELS, COLORS: COLORS, MAX_TABLES: MAX_TABLES,
    getTable: getTable, getConfig: getConfig, setActive: setActive,
    routeHome: routeHome, initEvent: initEvent, initConfig: initConfig
  };
})();
