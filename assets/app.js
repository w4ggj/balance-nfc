/* ============================================================
   Balance Martial Arts & Gaming — table landing logic
   Shared by index (router), event pages, and the control panel.
   ============================================================ */
(function () {
  "use strict";

  // ---- Config source of truth ------------------------------------------
  // Right now this is a small file in the repo (config.json). To change what
  // customers see, you edit that file and commit — GitHub Pages redeploys.
  //
  // LATER (optional): to get instant one-tap toggling with no commits, point
  // CONFIG_URL at a Cloudflare Worker that returns { "active": "..." }.
  // Nothing else in the code has to change.
  var CONFIG_URL = "config.json";

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

  // Always fetch fresh (cache-busted) so a scanning phone never sees a stale toggle.
  function getConfig() {
    var url = CONFIG_URL + (CONFIG_URL.indexOf("?") === -1 ? "?" : "&") + "ts=" + Date.now();
    return fetch(url, { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (cfg) {
        var active = cfg && cfg.active;
        if (active !== "main" && EVENTS.indexOf(active) === -1) active = "main";
        return { active: active };
      })
      .catch(function () { return { active: "main" }; });
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
  function initConfig() {
    var current = "main";          // what's actually live (from config.json)
    var selected = "main";         // what the operator has picked in the UI

    var dot = document.getElementById("liveDot");
    var liveName = document.getElementById("liveName");
    var publish = document.getElementById("publish");
    var codebox = document.getElementById("codebox");
    var toggles = Array.prototype.slice.call(document.querySelectorAll(".toggle input"));

    function render() {
      // toggles reflect the selection (single-active)
      toggles.forEach(function (input) {
        var page = input.getAttribute("data-page");
        var on = (selected === page);
        input.checked = on;
        var row = input.closest(".switch-row");
        if (row) row.setAttribute("data-on", on ? "true" : "false");
      });

      // live status card = what's really published right now
      if (dot) dot.style.setProperty("--dot", COLORS[current]);
      if (liveName) liveName.textContent = LABELS[current];

      // publish box only when the pick differs from what's live
      if (selected === current) {
        publish.classList.add("hidden");
      } else {
        publish.classList.remove("hidden");
        codebox.textContent = JSON.stringify({ active: selected });
      }
    }

    // Wire the switches — turning one on turns the others off (single landing).
    toggles.forEach(function (input) {
      input.addEventListener("change", function () {
        var page = input.getAttribute("data-page");
        selected = input.checked ? page : "main";
        render();
      });
    });

    // Copy button
    var copyBtn = document.getElementById("copyBtn");
    if (copyBtn) {
      copyBtn.addEventListener("click", function () {
        var text = codebox.textContent;
        var done = function () { showToast("Copied — now paste it in the GitHub editor"); };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(done, function () { legacyCopy(text); done(); });
        } else { legacyCopy(text); done(); }
      });
    }

    // Load what's currently live
    getConfig().then(function (cfg) {
      current = cfg.active;
      selected = cfg.active;
      render();
    });
  }

  function legacyCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); } catch (e) {}
    document.body.removeChild(ta);
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
    getTable: getTable, getConfig: getConfig,
    routeHome: routeHome, initEvent: initEvent, initConfig: initConfig
  };
})();
