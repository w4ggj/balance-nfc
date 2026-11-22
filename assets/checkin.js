/* ============================================================
   Balance Martial Arts & Gaming — event check-in
   Players tap a table tag (→ info page → "Check in") or scan the QR on the
   event place card (event-tv). They enter their name; we match it against the
   list of people who registered on the website — matched by the "Bandai Player
   Name" they typed at checkout — and check them in. No registration found →
   they join tonight's waitlist.

   Data:
     • Today's event product   — public Shopify storefront JSON (no token).
     • The registrant list      — board-api Worker /roster?product_id=… (reads
                                   the Shopify ORDERS for that product and pulls
                                   each "Bandai Player Name"; needs read_orders).
     • Check-in + waitlist state — Firebase, like Commander attendance:
         checkin/<game>/<YYYY-MM-DD>/present/<id>  = {name,bandai,table,matched,ts}
         checkin/<game>/<YYYY-MM-DD>/waitlist/<id> = {name,bandai,table,ts}

   If the roster can't be read (Worker not deployed yet, or the token still
   lacks read_orders), check-in DEGRADES GRACEFULLY: players can still check in,
   marked "unverified", and staff see that flag on the roster page.
   ============================================================ */
(function (global) {
  "use strict";

  var BGF = global.BGF, BGFG = global.BGFG;
  var VALID = { onepiece: 1, mtg: 1, pokemon: 1, riftbound: 1 };

  function qp(n) { return new URLSearchParams(location.search).get(n); }
  function game() { var g = (qp("game") || "onepiece").toLowerCase(); return VALID[g] ? g : "onepiece"; }
  function el(t, c, x) { var e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; }
  function norm(s) { return String(s == null ? "" : s).toLowerCase().replace(/\s+/g, " ").trim(); }
  function slug(s) { return norm(s).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "x"; }
  function pad(n) { return String(n).length < 2 ? "0" + n : String(n); }
  function localDate() { var d = new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function label(g) { return (BGFG && BGFG.GAMES[g] && BGFG.GAMES[g].label) || "Event"; }

  // ---- data ------------------------------------------------------------
  // Today's event product for this game, from the public storefront JSON (the
  // same source games.js uses). Returns {title,name,handle,id} or null.
  function loadTodayEvent(g) {
    var G = BGFG && BGFG.GAMES[g];
    if (!G) return Promise.resolve(null);
    var url = "https://balancegamingfl.com/collections/" + G.eventsHandle + "/products.json?limit=250";
    return fetch(url, { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (data) {
        var list = ((data && data.products) || []).filter(function (p) { return BGFG.isTonight(p.title); });
        if (!list.length) return null;
        var p = list[0];
        return { title: p.title, name: BGFG.stripDate(p.title), handle: p.handle, id: p.id };
      })
      .catch(function () { return null; });
  }

  // The registrant list for a product, from the Worker. Resolves to an array of
  // {name,bandai} or null when it can't be read (so callers can degrade).
  function loadRoster(productId) {
    if (!BGF || !BGF.BOARD_API || !productId) return Promise.resolve(null);
    var url = BGF.BOARD_API + "/roster?product_id=" + encodeURIComponent(productId);
    return fetch(url, { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (data) {
        // An error from the Worker (e.g. the token lacks read_orders) comes back
        // as {registrants:[], error:…}. Treat that as "couldn't read" (null) so
        // check-in degrades to unverified, NOT as "nobody is registered".
        if (data && data.error) return null;
        var rows = (data && data.registrants) || (Array.isArray(data) ? data : null);
        if (!Array.isArray(rows)) return null;
        return rows.map(function (x) { return { name: x.name || "", bandai: x.bandai || x.bandaiName || "" }; })
                   .filter(function (x) { return x.name || x.bandai; });
      })
      .catch(function () { return null; });
  }

  function findReg(roster, input) {
    var q = norm(input);
    if (!q || !roster || !roster.length) return null;
    var hit = roster.filter(function (r) { return norm(r.bandai) === q || norm(r.name) === q; })[0];
    if (hit) return hit;
    hit = roster.filter(function (r) { return norm(r.bandai).indexOf(q) === 0 || norm(r.name).indexOf(q) === 0; })[0];
    if (hit) return hit;
    if (q.length >= 3) hit = roster.filter(function (r) { return norm(r.bandai).indexOf(q) >= 0 || norm(r.name).indexOf(q) >= 0; })[0];
    return hit || null;
  }

  function base(g) { return "checkin/" + g + "/" + localDate(); }

  // ---- player page -----------------------------------------------------
  function initPlayer() {
    var g = game(), tbl = (BGF && BGF.getTable && BGF.getTable()) || null;
    var root = document.getElementById("ckBody");
    var titleEl = document.querySelector(".ck-title");
    if (titleEl) titleEl.textContent = label(g) + " Check-In";

    root.innerHTML = "";
    root.appendChild(msgCard("Loading tonight's event…", ""));

    loadTodayEvent(g).then(function (ev) {
      root.innerHTML = "";
      if (!ev) {
        root.appendChild(msgCard("No " + ((BGFG && BGFG.GAMES[g] && BGFG.GAMES[g].short) || "") + " event today",
          "There's no event scheduled right now. If you think this is wrong, check with the counter."));
        return;
      }
      var sub = document.querySelector(".ck-sub");
      if (sub) sub.textContent = ev.name + (tbl ? " · Table " + tbl : "");

      // kick off the roster load in the background; the form works either way
      var rosterP = loadRoster(ev.id);
      renderForm(root, g, ev, tbl, rosterP);
    });
  }

  function renderForm(root, g, ev, tbl, rosterP) {
    var card = el("div", "event-card");
    card.appendChild(el("span", "ec-tag", "Tonight"));
    card.appendChild(el("h2", "ec-title", ev.name));
    card.appendChild(el("p", "ec-sub", "Check in for tonight's event. Enter the name you registered with — your Bandai Player Name or your real name."));

    var form = el("form", "ck-form");
    var input = el("input", "ck-input");
    input.type = "text"; input.autocomplete = "name"; input.placeholder = "Your name / Bandai Player Name";
    input.setAttribute("aria-label", "Your name or Bandai Player Name");
    form.appendChild(input);
    var btn = el("button", "gl primary wide"); btn.type = "submit";
    btn.appendChild(el("span", "gl-t", "Check in"));
    form.appendChild(btn);
    card.appendChild(form);

    var out = el("div", "ck-out"); out.setAttribute("aria-live", "polite"); card.appendChild(out);
    root.appendChild(card);
    setTimeout(function () { try { input.focus(); } catch (e) {} }, 150);

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var name = input.value.trim();
      if (!name) { input.focus(); return; }
      btn.disabled = true; out.innerHTML = ""; out.appendChild(el("p", "hint", "Checking…"));
      rosterP.then(function (roster) {
        var reg = findReg(roster, name);
        if (reg) return checkIn(g, ev, tbl, { name: reg.name || name, bandai: reg.bandai || "", matched: true }, out);
        if (roster === null) return unverifiedPrompt(g, ev, tbl, name, out, btn);   // couldn't read list
        return noMatch(g, ev, tbl, name, out, btn);                                  // list read, not found
      }).catch(function () { out.innerHTML = ""; out.appendChild(errLine("Something went wrong — try again.")); btn.disabled = false; });
    });
  }

  function checkIn(g, ev, tbl, who, out) {
    var id = slug(who.bandai || who.name);
    var rec = { name: who.name, bandai: who.bandai || "", table: tbl || null, matched: !!who.matched, ts: Date.now() };
    return BGF.fbSet(base(g) + "/present/" + id, rec).then(function () {
      out.innerHTML = "";
      var ok = el("div", "ck-ok");
      ok.appendChild(el("div", "ck-ok-ico", "✓"));
      ok.appendChild(el("div", "ck-ok-main", "You're checked in!"));
      ok.appendChild(el("div", "ck-ok-sub", who.name + (who.bandai ? " · " + who.bandai : "") + (tbl ? " · Table " + tbl : "")));
      if (!who.matched) ok.appendChild(el("div", "ck-ok-note", "We couldn't verify your registration — the staff will confirm it."));
      else ok.appendChild(el("div", "ck-ok-note", "You're on tonight's list. Good luck!"));
      out.appendChild(ok);
    });
  }

  function noMatch(g, ev, tbl, name, out, btn) {
    out.innerHTML = "";
    out.appendChild(errLine("We don't see a registration under “" + name + "”."));
    out.appendChild(el("p", "hint", "Check the spelling of your Bandai Player Name, or join tonight's waitlist."));
    var row = el("div", "event-actions");
    var again = el("button", "gl"); again.type = "button"; again.appendChild(el("span", "gl-t", "Try again"));
    again.addEventListener("click", function () { out.innerHTML = ""; btn.disabled = false; });
    var wl = el("button", "gl primary"); wl.type = "button"; wl.appendChild(el("span", "gl-t", "Join the waitlist"));
    wl.addEventListener("click", function () { joinWaitlist(g, ev, tbl, name, "", out); });
    row.appendChild(again); row.appendChild(wl);
    out.appendChild(row);
    btn.disabled = false;
  }

  // Roster unreadable (Worker/scope not ready): let them check in anyway.
  function unverifiedPrompt(g, ev, tbl, name, out, btn) {
    out.innerHTML = "";
    out.appendChild(el("p", "hint", "We couldn't pull the registration list right now, but you can still check in — the staff will confirm you against the website."));
    var row = el("div", "event-actions");
    var ci = el("button", "gl primary"); ci.type = "button"; ci.appendChild(el("span", "gl-t", "Check in anyway"));
    ci.addEventListener("click", function () { checkIn(g, ev, tbl, { name: name, bandai: "", matched: false }, out); });
    var wl = el("button", "gl"); wl.type = "button"; wl.appendChild(el("span", "gl-t", "Join waitlist instead"));
    wl.addEventListener("click", function () { joinWaitlist(g, ev, tbl, name, "", out); });
    row.appendChild(ci); row.appendChild(wl);
    out.appendChild(row);
    btn.disabled = false;
  }

  function joinWaitlist(g, ev, tbl, name, bandai, out) {
    var id = slug(name) + "-" + String(Date.now()).slice(-4);
    var rec = { name: name, bandai: bandai || "", table: tbl || null, ts: Date.now() };
    BGF.fbSet(base(g) + "/waitlist/" + id, rec).then(function () {
      out.innerHTML = "";
      var ok = el("div", "ck-ok wait");
      ok.appendChild(el("div", "ck-ok-ico", "★"));
      ok.appendChild(el("div", "ck-ok-main", "You're on the waitlist"));
      ok.appendChild(el("div", "ck-ok-sub", name));
      ok.appendChild(el("div", "ck-ok-note", "If a seat opens up, the staff will call your name. Thanks for coming out!"));
      out.appendChild(ok);
    }).catch(function () { out.appendChild(errLine("Couldn't join the waitlist — try again or see the counter.")); });
  }

  function msgCard(title, sub) {
    var c = el("div", "event-card");
    c.appendChild(el("div", "ec-title", title));
    if (sub) c.appendChild(el("p", "ec-sub", sub));
    return c;
  }
  function errLine(t) { var p = el("p", "ck-err", t); return p; }

  // ---- staff roster page (checkin-admin.html) --------------------------
  function initAdmin() {
    var g = game();
    var root = document.getElementById("adminBody");
    var head = document.querySelector(".ck-admin-sub");
    if (head) head.textContent = label(g) + " · " + localDate();
    loadTodayEvent(g).then(function (ev) { if (ev && head) head.textContent = label(g) + " · " + ev.name + " · " + localDate(); });

    // Build the layout ONCE so the 4s poll can't wipe the walk-in boxes you're
    // typing in. The walk-in form is persistent; only the counts and the lists
    // re-render, and only when the data actually changed (no needless redraw,
    // no stolen focus).
    root.innerHTML = "";
    var countsWrap = el("div");
    var walkin = addWalkIn(g);          // built once, never rebuilt
    var lists = el("div");
    root.appendChild(countsWrap);
    root.appendChild(walkin);
    root.appendChild(lists);

    var lastSig = null;
    function draw(data) {
      var present = (data && data.present) || {}, waitlist = (data && data.waitlist) || {};
      var sig = JSON.stringify([present, waitlist]);
      if (sig === lastSig) return;      // unchanged → leave the DOM (and your typing) alone
      lastSig = sig;
      var pk = Object.keys(present).sort(function (a, b) { return (present[a].ts || 0) - (present[b].ts || 0); });
      var wk = Object.keys(waitlist).sort(function (a, b) { return (waitlist[a].ts || 0) - (waitlist[b].ts || 0); });

      countsWrap.innerHTML = "";
      countsWrap.appendChild(counts(pk.length, wk.length));

      lists.innerHTML = "";
      lists.appendChild(sectionLabel("Checked in (" + pk.length + ")"));
      if (!pk.length) lists.appendChild(el("p", "hint", "No one checked in yet."));
      pk.forEach(function (id) { lists.appendChild(rosterRow(g, "present", id, present[id], false)); });

      lists.appendChild(sectionLabel("Waitlist (" + wk.length + ")"));
      if (!wk.length) lists.appendChild(el("p", "hint", "Waitlist is empty."));
      wk.forEach(function (id) { lists.appendChild(rosterRow(g, "waitlist", id, waitlist[id], true)); });
    }

    function tick() { BGF.fbGet(base(g)).then(draw).catch(function () {}); }
    tick(); setInterval(tick, 4000);
  }

  function counts(p, w) {
    var row = el("div", "ck-counts");
    var a = el("div", "ck-count"); a.appendChild(el("div", "ck-count-n", String(p))); a.appendChild(el("div", "ck-count-l", "Checked in")); row.appendChild(a);
    var b = el("div", "ck-count wait"); b.appendChild(el("div", "ck-count-n", String(w))); b.appendChild(el("div", "ck-count-l", "Waitlist")); row.appendChild(b);
    return row;
  }
  function sectionLabel(t) { return el("p", "section-label", t); }

  function rosterRow(g, bucket, id, rec, isWait) {
    var row = el("div", "ck-row");
    var main = el("div", "ck-row-main");
    var nm = el("div", "ck-row-nm", rec.name || "Player");
    if (!isWait && rec.matched === false) { var u = el("span", "ck-badge unverified", "unverified"); nm.appendChild(u); }
    main.appendChild(nm);
    var meta = [];
    if (rec.bandai) meta.push(rec.bandai);
    if (rec.table) meta.push("Table " + rec.table);
    meta.push(timeStr(rec.ts));
    main.appendChild(el("div", "ck-row-meta", meta.join(" · ")));
    row.appendChild(main);

    var acts = el("div", "ck-row-acts");
    if (isWait) {
      var up = el("button", "btn ghost sm", "Seat"); up.type = "button";
      up.addEventListener("click", function () {
        BGF.fbSet("checkin/" + g + "/" + localDate() + "/present/" + slug(rec.bandai || rec.name),
          { name: rec.name, bandai: rec.bandai || "", table: rec.table || null, matched: !!rec.bandai, ts: Date.now() })
          .then(function () { return BGF.fbSet("checkin/" + g + "/" + localDate() + "/waitlist/" + id, null); });
      });
      acts.appendChild(up);
    }
    var rm = el("button", "btn ghost sm", "Remove"); rm.type = "button";
    rm.addEventListener("click", function () { BGF.fbSet("checkin/" + g + "/" + localDate() + "/" + bucket + "/" + id, null); });
    acts.appendChild(rm);
    row.appendChild(acts);
    return row;
  }

  function addWalkIn(g) {
    var card = el("div", "ck-walkin");
    var form = el("form", "ck-form");
    var i1 = el("input", "ck-input"); i1.type = "text"; i1.placeholder = "Walk-in name"; i1.setAttribute("aria-label", "Walk-in name");
    var i2 = el("input", "ck-input"); i2.type = "text"; i2.placeholder = "Bandai name (optional)"; i2.setAttribute("aria-label", "Bandai name");
    var b = el("button", "btn primary sm", "Add"); b.type = "submit";
    form.appendChild(i1); form.appendChild(i2); form.appendChild(b);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var nm = i1.value.trim(); if (!nm) { i1.focus(); return; }
      BGF.fbSet("checkin/" + g + "/" + localDate() + "/present/" + slug(i2.value.trim() || nm),
        { name: nm, bandai: i2.value.trim(), table: null, matched: false, ts: Date.now() })
        .then(function () { i1.value = ""; i2.value = ""; i1.focus(); });
    });
    card.appendChild(form);
    return card;
  }

  function timeStr(ts) {
    if (!ts) return "";
    try { return new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); } catch (e) { return ""; }
  }

  global.BGFCheckin = { initPlayer: initPlayer, initAdmin: initAdmin, loadTodayEvent: loadTodayEvent, loadRoster: loadRoster, findReg: findReg };
  if (typeof module !== "undefined" && module.exports) module.exports = global.BGFCheckin;
})(typeof window !== "undefined" ? window : globalThis);
