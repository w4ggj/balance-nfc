/* ============================================================
   Balance League Pass — open-play check-in points + monthly drawing
   Pokémon League (Mondays) and One Piece open play (Tuesdays).

   Subsystem of the NFC system. Firebase RTDB /league, plus the Commander
   League's Firebase Auth email-link sign-in (same Firebase project, so one
   account works for both). Rules + setup: LEAGUE_SETUP.md.

   How it scores (Joe, Nov 17 2026):
     • 1 point per league-night check-in. Check-ins only, never purchases
       (a purchase-for-entry drawing can count as an illegal lottery in FL).
     • Every 4 points = 1 entry in that game's monthly prize drawing.
     • The drawing runs on the game's last league night of the month. Entries
       are used up by the drawing (win or not); leftover points carry over
       (6 points → 1 entry, and 2 points count toward next month).
     • Kids: a parent's email signs in, and one account can hold several
       players (siblings). Staff can also check a kid in by name.

   Data model (RTDB /league):
     players/{pid}                    {first, li, walkIn?, createdAt}
         pid = the auth uid for an account's first player, uid + "_2", "_3"…
         for more players on the same account, "walk_…" for staff-added
         players (no email). Only first name + last initial are stored.
     checkins/{game}/{YYYY-MM-DD}/{pid}  server timestamp (ms)
     draws/{game}/{YYYY-MM-DD}        {at, pool{pid:entries}, winners[pid], prize, threshold}
     meta/{game}                      {prize}

   The ledger is recomputed from check-ins + draws every time — nothing
   stores a running total, so removing a bad check-in or undoing a drawing
   fixes every number automatically.
   ============================================================ */
(function (global) {
  "use strict";

  var TZ = "America/New_York";
  var THRESHOLD = 4;     // points per drawing entry
  var OPEN_HOUR = 12;    // player self check-in opens at noon (store time) on league night
  // League Pass launched mid-November 2026, too late for a fair November drawing
  // (two league nights left, and 4 points needed). The first drawing is
  // December's; November check-ins count toward it. (Joe, Nov 17 2026)
  var FIRST_DRAW_MONTH = "2026-12";
  var SITE = "https://nfc.balancegamingfl.com";

  var GAMES = {
    pokemon:  { key: "pokemon",  label: "Pokémon League",      short: "Pokémon",   dow: 1, day: "Monday",  color: "#ffcb05", events: "pokemon-events" },
    onepiece: { key: "onepiece", label: "One Piece Open Play", short: "One Piece", dow: 2, day: "Tuesday", color: "#ff5a5f", events: "one-piece-events" }
  };
  var DOW = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var MON3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  // ---- Engine (pure; node-testable) -------------------------------------

  // Store-time (Eastern) calendar parts for a timestamp. Every device agrees on
  // "tonight" no matter its own timezone.
  function eastern(ms) {
    var d = new Date(ms == null ? Date.now() : ms);
    var o = {};
    new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", hourCycle: "h23", weekday: "short" }).formatToParts(d)
      .forEach(function (p) { o[p.type] = p.value; });
    return { id: o.year + "-" + o.month + "-" + o.day, y: +o.year, m: +o.month, d: +o.day,
      hour: (+o.hour) % 24, dow: DOW[o.weekday] };
  }
  function pad(n) { return n < 10 ? "0" + n : "" + n; }
  function dateId(y, m, d) { return y + "-" + pad(m) + "-" + pad(d); }
  function parseId(id) { var p = String(id).split("-"); return { y: +p[0], m: +p[1], d: +p[2] }; }
  // Pure calendar math on a date id (no timezones involved).
  function dowOfId(id) { var p = parseId(id); return new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay(); }
  function niceDate(id, long) {
    var p = parseId(id), w = DAYS[dowOfId(id)];
    return (long ? w : w.slice(0, 3)) + ", " + MON3[p.m - 1] + " " + p.d;
  }

  // The game's last league night in a month, e.g. the last Monday.
  function lastNightOfMonth(game, y, m) {
    var last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    var back = (new Date(Date.UTC(y, m - 1, last)).getUTCDay() - GAMES[game].dow + 7) % 7;
    return dateId(y, m, last - back);
  }
  // The next drawing: this month's last league night, unless it has passed or
  // its drawing already ran, then next month's.
  function nextDraw(L, game, now) {
    var e = eastern(now), ran = (L && L.draws && L.draws[game]) || {};
    var y = e.y, m = e.m, id = lastNightOfMonth(game, y, m);
    while (e.id > id || ran[id] || dateId(y, m, 1).slice(0, 7) < FIRST_DRAW_MONTH) {
      if (m === 12) { y++; m = 1; } else m++;
      id = lastNightOfMonth(game, y, m);
    }
    var p = parseId(id);
    return { id: id, month: MONTHS[p.m - 1], label: niceDate(id, true), tonight: id === e.id };
  }
  function isLeagueNight(game, now) { return !!GAMES[game] && eastern(now).dow === GAMES[game].dow; }
  function checkinOpen(game, now) { var e = eastern(now); return isLeagueNight(game, now) && e.hour >= OPEN_HOUR; }
  // Which game's league night is it right now (store time)? null if neither.
  function gameTonight(now) {
    var d = eastern(now).dow, k = null;
    Object.keys(GAMES).forEach(function (g) { if (GAMES[g].dow === d) k = g; });
    return k;
  }

  function displayName(p) {
    if (!p || !p.first) return "Player";
    return p.first + (p.li ? " " + p.li + "." : "");
  }
  function nameOf(L, pid) { return displayName(L && L.players && L.players[pid]); }

  // A check-in counts only if its server timestamp falls on the date it's
  // filed under — so nobody can file one under an old night.
  function checkinEvents(L, game) {
    var ck = (L && L.checkins && L.checkins[game]) || {}, out = [];
    Object.keys(ck).forEach(function (date) {
      var day = ck[date] || {};
      Object.keys(day).forEach(function (pid) {
        var ts = Number(day[pid]);
        if (!ts || eastern(ts).id !== date) return;
        out.push({ pid: pid, date: date, ts: ts });
      });
    });
    out.sort(function (a, b) { return a.ts - b.ts; });
    return out;
  }
  function drawList(L, game) {
    var d = (L && L.draws && L.draws[game]) || {};
    return Object.keys(d).map(function (id) {
      var x = d[id] || {};
      return { id: id, at: Number(x.at) || 0, pool: x.pool || {}, winners: winnersOf(x), prize: x.prize || "", threshold: x.threshold || THRESHOLD };
    }).filter(function (x) { return x.at > 0; }).sort(function (a, b) { return a.at - b.at; });
  }
  // Firebase can hand an array back as an object ({0:…,1:…}); normalize.
  function winnersOf(x) {
    var w = x && x.winners;
    if (!w) return [];
    if (Array.isArray(w)) return w.filter(Boolean);
    return Object.keys(w).sort(function (a, b) { return a - b; }).map(function (k) { return w[k]; }).filter(Boolean);
  }

  // Walk every check-in in time order, closing a period at each drawing.
  // Returns one period per drawing plus the open (current) one, last.
  //   period.rows  — everyone who checked in that period: pts (incl. carry),
  //                  nights (check-ins that period), entries, toNext
  //   period.carry — {pid: pts} for players with carried points who haven't
  //                  checked in yet this period
  function ledger(L, game) {
    var events = checkinEvents(L, game), draws = drawList(L, game);
    var bank = {}, periods = [], i = 0, start = 0;
    function close(endAt, draw) {
      var seen = {}, firstTs = 0;
      while (i < events.length && (endAt == null || events[i].ts <= endAt)) {
        var ev = events[i++];
        if (!firstTs) firstTs = ev.ts;
        bank[ev.pid] = (bank[ev.pid] || 0) + 1;
        seen[ev.pid] = (seen[ev.pid] || 0) + 1;
      }
      var t = (draw && draw.threshold) || THRESHOLD;
      var rows = Object.keys(seen).map(function (pid) { return row(L, pid, bank[pid], seen[pid], t); });
      rows.sort(byPoints);
      var carry = {};
      Object.keys(bank).forEach(function (pid) { if (!seen[pid] && bank[pid]) carry[pid] = bank[pid]; });
      periods.push({ start: start, end: endAt, draw: draw, rows: rows, carry: carry, firstTs: firstTs });
      if (draw) { Object.keys(bank).forEach(function (p) { bank[p] = bank[p] % t; }); start = endAt; }
    }
    draws.forEach(function (d) { close(d.at, d); });
    close(null, null);
    return periods;
  }
  function row(L, pid, pts, nights, t) {
    t = t || THRESHOLD;
    return { pid: pid, name: nameOf(L, pid), pts: pts, nights: nights, entries: Math.floor(pts / t), toNext: t - (pts % t), into: pts % t };
  }
  function byPoints(a, b) { return b.pts !== a.pts ? b.pts - a.pts : a.name.localeCompare(b.name); }

  function current(L, game) { var p = ledger(L, game); return p[p.length - 1]; }

  // A player's standing right now (for their phone).
  function standing(L, game, pid) {
    var cur = current(L, game);
    for (var i = 0; i < cur.rows.length; i++) if (cur.rows[i].pid === pid) return cur.rows[i];
    return row(L, pid, cur.carry[pid] || 0, 0);
  }

  // The pool for a drawing run now: {pid: entries} for everyone with ≥1 entry.
  function pool(L, game) {
    var out = {};
    current(L, game).rows.forEach(function (r) { if (r.entries > 0) out[r.pid] = r.entries; });
    return out;
  }
  // Weighted pick: one ticket per entry. `exclude` = earlier winners tonight.
  function pickWinner(poolObj, exclude, rnd) {
    exclude = exclude || {}; rnd = rnd || secureRandom;
    var tickets = [];
    Object.keys(poolObj || {}).sort().forEach(function (pid) {
      if (exclude[pid]) return;
      for (var k = 0; k < (poolObj[pid] || 0); k++) tickets.push(pid);
    });
    if (!tickets.length) return null;
    return tickets[Math.floor(rnd() * tickets.length)];
  }
  function secureRandom() {
    try { var a = new Uint32Array(1); (global.crypto || require("crypto").webcrypto).getRandomValues(a); return a[0] / 4294967296; }
    catch (e) { return Math.random(); }
  }

  // What the TV shows. On drawing night after the draw, it keeps the period
  // that just closed (the final roster + winners) up for the rest of the night.
  function boardView(L, game, now) {
    var tonight = eastern(now).id, periods = ledger(L, game), view = periods[periods.length - 1];
    for (var i = periods.length - 1; i >= 0; i--) {
      if (periods[i].draw && periods[i].draw.id === tonight) { view = periods[i]; break; }
    }
    var here = {}, day = (L && L.checkins && L.checkins[game] && L.checkins[game][tonight]) || {};
    Object.keys(day).forEach(function (pid) { var ts = Number(day[pid]); if (ts && eastern(ts).id === tonight) here[pid] = true; });
    var nd = nextDraw(L, game, now);
    var monthName = view.draw ? MONTHS[parseId(view.draw.id).m - 1] : nd.month;
    // A period that started in an earlier month (the launch, or a skipped
    // drawing) is titled with both, e.g. "November & December".
    if (!view.draw && view.firstTs) {
      var fm = MONTHS[eastern(view.firstTs).m - 1];
      if (fm !== monthName) monthName = fm + " & " + monthName;
    }
    return { rows: view.rows, draw: view.draw, here: here, next: nd, month: monthName,
      prize: (view.draw && view.draw.prize) || ((L && L.meta && L.meta[game] && L.meta[game].prize) || "") };
  }

  var Engine = { GAMES: GAMES, THRESHOLD: THRESHOLD, OPEN_HOUR: OPEN_HOUR, FIRST_DRAW_MONTH: FIRST_DRAW_MONTH, eastern: eastern, niceDate: niceDate,
    lastNightOfMonth: lastNightOfMonth, nextDraw: nextDraw, isLeagueNight: isLeagueNight, checkinOpen: checkinOpen,
    gameTonight: gameTonight, displayName: displayName, nameOf: nameOf, checkinEvents: checkinEvents, drawList: drawList,
    winnersOf: winnersOf, ledger: ledger, current: current, standing: standing, pool: pool, pickWinner: pickWinner,
    boardView: boardView };

  // ============================================================
  // App layer (browser)
  // ============================================================
  // Same Firebase project as the Commander League (see commander.js).
  var FIREBASE_CONFIG = {
    apiKey: "AIzaSyClGbR2no18qvLfwbb2lasFyzKth-We1C0",
    authDomain: "balance-nfc.firebaseapp.com",
    databaseURL: "https://balance-nfc-default-rtdb.firebaseio.com",
    projectId: "balance-nfc",
    storageBucket: "balance-nfc.firebasestorage.app",
    messagingSenderId: "21159440638",
    appId: "1:21159440638:web:8d10d2b734710ba50df5af"
  };

  function el(t, c, x) { var e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; }
  function qp(name) { return new URLSearchParams(location.search).get(name); }
  function pickGame() {
    var g = qp("game");
    if (GAMES[g]) return g;
    return gameTonight() || null;
  }
  function checkinUrl(game) { return SITE + "/league.html?game=" + game; }
  function cleanName(s) { return String(s || "").replace(/\s+/g, " ").trim().slice(0, 30); }
  function initialOf(s) { var m = cleanName(s).match(/[A-Za-z]/); return m ? m[0].toUpperCase() : ""; }
  function plural(n, w) { return n + " " + w + (n === 1 ? "" : "s"); }
  function entries(n) { return n + (n === 1 ? " entry" : " entries"); }

  // Progress pips toward the next entry, e.g. ●●○○
  function pips(into, t) {
    var w = el("span", "lp-pips");
    for (var k = 0; k < (t || THRESHOLD); k++) w.appendChild(el("span", "lp-pip" + (k < into ? " on" : "")));
    return w;
  }
  function ticket(n) { var s = el("span", "lp-ticket"); s.textContent = "🎟 " + (n > 1 ? "×" + n : "entry"); return s; }

  var toastTimer;
  function showToast(msg) { var t = document.getElementById("toast"); if (!t) return; t.textContent = msg; t.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove("show"); }, 2800); }
  // brand.css fades .event-body children in. Live pages re-render on every
  // change, so after the first paint turn that off or every update flickers.
  function settle(root) { if (!root.__lpSettle) root.__lpSettle = setTimeout(function () { root.classList.add("lp-live"); }, 800); }
  function card(title, sub) { var c = el("div", "cl-card"); if (title) c.appendChild(el("div", "cl-h", title)); if (sub) c.appendChild(el("p", "cl-sub", sub)); return c; }

  // ---- Player page (league.html?game=…) — Firebase Auth email-link -------
  function initPlayer() {
    var root = document.getElementById("lpPlayer");
    var game = pickGame();
    if (!game) { renderChooser(root); return; }
    var G = GAMES[game];
    document.body.setAttribute("data-game", game);
    var t1 = document.getElementById("lpTitle"); if (t1) t1.textContent = G.label;
    var t2 = document.getElementById("lpSub"); if (t2) t2.textContent = "Check in every " + G.day + ". Every " + THRESHOLD + " check-ins = 1 entry in the monthly prize drawing.";
    if (typeof firebase === "undefined") { root.appendChild(card("Loading…", "One moment.")); return; }
    if (!firebase.apps || !firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
    var auth = firebase.auth(), db = firebase.database();
    var LS_EMAIL = "lp_email", LS_FIRST = "lp_first", LS_LAST = "lp_last";
    var autoTried = {};   // one auto check-in per night per page load, so a staff removal isn't instantly undone
    var adding = false, L = {}, user = null, watching = false;

    if (auth.isSignInWithEmailLink(location.href)) {
      var email = localStorage.getItem(LS_EMAIL) || window.prompt("Confirm the email you used to sign up:");
      if (email) {
        auth.signInWithEmailLink(email, location.href).then(function () {
          localStorage.removeItem(LS_EMAIL);
          history.replaceState({}, "", "league.html?game=" + game);
        }).catch(function (e) { root.innerHTML = ""; root.appendChild(card("Sign-in link problem", e.message + " Ask for a new link below.")); localStorage.removeItem(LS_EMAIL); });
      }
    }

    auth.onAuthStateChanged(function (u) {
      user = u;
      if (!u) { renderAuth(); return; }
      if (!watching) {
        watching = true;
        db.ref("league").on("value", function (snap) { L = snap.val() || {}; render(); });
      }
    });

    function myPids() {
      var ps = L.players || {};
      return Object.keys(ps).filter(function (pid) { return pid === user.uid || pid.indexOf(user.uid + "_") === 0; })
        .sort(function (a, b) { return a.length - b.length || a.localeCompare(b); });
    }
    function checkedIn(pid, today) { return !!(L.checkins && L.checkins[game] && L.checkins[game][today] && L.checkins[game][today][pid]); }
    function checkIn(pid) {
      var today = eastern().id;
      if (checkedIn(pid, today)) return Promise.resolve();
      return db.ref("league/checkins/" + game + "/" + today + "/" + pid).set(firebase.database.ServerValue.TIMESTAMP)
        .catch(function (e) { showToast("Couldn't check in. Try again or see the counter."); if (window.console) console.error(e); });
    }
    function createPlayer(first, last) {
      var mine = myPids(), pid = user.uid;
      if (mine.indexOf(pid) !== -1) { var n = 2; while (mine.indexOf(user.uid + "_" + n) !== -1) n++; pid = user.uid + "_" + n; }
      return db.ref("league/players/" + pid).set({ first: cleanName(first), li: initialOf(last), createdAt: firebase.database.ServerValue.TIMESTAMP })
        .then(function () { return pid; });
    }

    function renderAuth() {
      root.innerHTML = "";
      var sent = localStorage.getItem(LS_EMAIL);
      if (sent) {
        var c = card("Check your email", "We sent a sign-in link to " + sent + ". Open it on this phone and you're in.");
        var again = el("button", "btn ghost", "Use a different email"); again.style.marginTop = "12px";
        again.addEventListener("click", function () { localStorage.removeItem(LS_EMAIL); renderAuth(); });
        c.appendChild(again); root.appendChild(c); return;
      }
      var c2 = card("Get your League Pass", "One-time sign-up on this phone. After that, scanning the code checks you in.");
      var f = el("input", "field"); f.placeholder = "Player's first name"; f.setAttribute("maxlength", "30"); f.autocomplete = "given-name";
      var l = el("input", "field"); l.placeholder = "Last name (we only show the first letter)"; l.setAttribute("maxlength", "30"); l.autocomplete = "family-name"; l.style.marginTop = "8px";
      var em = el("input", "field"); em.placeholder = "Email (a parent's email is fine for kids)"; em.type = "email"; em.autocomplete = "email"; em.style.marginTop = "8px";
      c2.appendChild(f); c2.appendChild(l); c2.appendChild(em);
      var btn = el("button", "btn primary", "Email me a sign-in link"); btn.style.marginTop = "10px";
      btn.addEventListener("click", function () {
        var first = cleanName(f.value), last = cleanName(l.value), email = (em.value || "").trim();
        if (!first) { f.focus(); return; }
        if (!/.+@.+\..+/.test(email)) { em.focus(); return; }
        localStorage.setItem(LS_FIRST, first); localStorage.setItem(LS_LAST, last);
        btn.disabled = true; btn.textContent = "Sending…";
        auth.sendSignInLinkToEmail(email, { url: location.origin + location.pathname + "?game=" + game, handleCodeInApp: true })
          .then(function () { localStorage.setItem(LS_EMAIL, email); renderAuth(); })
          .catch(function (e) { btn.disabled = false; btn.textContent = "Email me a sign-in link"; showToast(e.message); });
      });
      c2.appendChild(btn);
      c2.appendChild(el("p", "lp-fine", "No email? The counter can check you in by name."));
      root.appendChild(c2);
    }

    function render() {
      if (!user) return;
      settle(root);
      root.innerHTML = "";
      var mine = myPids();
      // First visit after the email link: make the player from the saved name.
      if (!mine.length && !adding) {
        var pf = localStorage.getItem(LS_FIRST);
        if (pf) {
          adding = true;
          createPlayer(pf, localStorage.getItem(LS_LAST) || "").then(function () {
            localStorage.removeItem(LS_FIRST); localStorage.removeItem(LS_LAST); adding = false;
          }).catch(function (e) { adding = false; showToast("Couldn't save your name. Try again."); if (window.console) console.error(e); });
          root.appendChild(card("Setting up your pass…", "One moment."));
          return;
        }
        root.appendChild(addForm("Who's playing?", "First name and last name. Only the first letter of the last name shows on the TV.", false));
        root.appendChild(signOut());
        return;
      }
      if (adding) { root.appendChild(card("Saving…", "One moment.")); return; }

      var now = Date.now(), e = eastern(now), today = e.id, open = checkinOpen(game, now);
      var nd = nextDraw(L, game, now);
      var tonightDraw = L.draws && L.draws[game] && L.draws[game][today];
      var winners = tonightDraw ? winnersOf(tonightDraw) : [];

      // Single player on the account: scanning the code IS the check-in.
      if (open && mine.length === 1 && !checkedIn(mine[0], today) && !autoTried[today]) {
        autoTried[today] = true; checkIn(mine[0]);
      }

      if (!open) {
        var other = gameTonight(now);
        var msg = isLeagueNight(game, now)
          ? "Check-in opens at noon today."
          : G.short + " check-in opens " + G.day + " at noon.";
        var oc = card(isLeagueNight(game, now) ? "Check-in opens at noon" : "Not " + G.short + " night", msg);
        if (other && other !== game) {
          var a = el("a", "btn primary", "Here for " + GAMES[other].short + " tonight? Check in there");
          a.href = "league.html?game=" + other; a.style.marginTop = "12px"; oc.appendChild(a);
        }
        root.appendChild(oc);
      }

      mine.forEach(function (pid) { root.appendChild(playerCard(pid, today, open, winners)); });

      var notIn = mine.filter(function (pid) { return !checkedIn(pid, today); });
      if (open && mine.length > 1 && notIn.length > 1) {
        var all = el("button", "btn primary", "Check in everyone");
        all.addEventListener("click", function () { all.disabled = true; Promise.all(notIn.map(checkIn)).then(function () { all.disabled = false; }); });
        root.appendChild(all);
      }

      var prize = (L.meta && L.meta[game] && L.meta[game].prize) || "";
      var dc = card(nd.month + " drawing", nd.tonight ? "Tonight! The drawing is at the end of the night." : nd.label);
      if (prize) dc.appendChild(el("p", "lp-prize", "Prize: " + prize));
      dc.appendChild(el("p", "lp-fine", "Every " + THRESHOLD + " check-ins = 1 entry. Entries are used up by the drawing; extra points carry to next month. Points come from showing up, never from buying anything."));
      root.appendChild(dc);

      var addBtn = el("button", "btn ghost", "Add a kid or another player");
      addBtn.addEventListener("click", function () { addBtn.replaceWith(addForm("Add a player", "They'll share this sign-in. Each player gets their own points.", true)); });
      root.appendChild(addBtn);
      root.appendChild(signOut());
    }

    function playerCard(pid, today, open, winners) {
      var s = standing(L, game, pid), here = checkedIn(pid, today);
      var c = el("div", "cl-card lp-me" + (here ? " here" : ""));
      var top = el("div", "lp-merow");
      top.appendChild(el("div", "cl-h", nameOf(L, pid)));
      if (here) top.appendChild(el("span", "lp-badge", "Checked in ✓"));
      c.appendChild(top);
      if (winners.indexOf(pid) !== -1) c.appendChild(el("div", "lp-won", "🎉 You won tonight's drawing! See the counter."));
      var stats = el("div", "lp-stats");
      var pts = el("div", "lp-pts"); pts.appendChild(el("b", null, String(s.pts))); pts.appendChild(el("span", null, s.pts === 1 ? "point" : "points")); stats.appendChild(pts);
      var prog = el("div", "lp-prog"); prog.appendChild(pips(s.into)); stats.appendChild(prog);
      c.appendChild(stats);
      c.appendChild(el("p", "cl-sub", s.entries
        ? "You have " + entries(s.entries) + " in the drawing. " + plural(s.toNext, "more check-in") + " for another."
        : plural(s.toNext, "more check-in") + " to your first entry."));
      if (open && !here) {
        var b = el("button", "btn primary", "Check in " + nameOf(L, pid).split(" ")[0]); b.style.marginTop = "12px";
        b.addEventListener("click", function () { b.disabled = true; checkIn(pid); });
        c.appendChild(b);
      }
      return c;
    }

    function addForm(title, sub, cancelable) {
      var c = card(title, sub);
      var f = el("input", "field"); f.placeholder = "First name"; f.setAttribute("maxlength", "30");
      var l = el("input", "field"); l.placeholder = "Last name"; l.setAttribute("maxlength", "30"); l.style.marginTop = "8px";
      c.appendChild(f); c.appendChild(l);
      var b = el("button", "btn primary", "Save"); b.style.marginTop = "10px";
      b.addEventListener("click", function () {
        if (!cleanName(f.value)) { f.focus(); return; }
        b.disabled = true; adding = true;
        createPlayer(f.value, l.value).then(function () { adding = false; render(); })
          .catch(function (e) { adding = false; b.disabled = false; showToast("Couldn't save. Try again."); if (window.console) console.error(e); });
      });
      c.appendChild(b);
      if (cancelable) { var x = el("button", "btn ghost", "Cancel"); x.style.marginTop = "8px"; x.addEventListener("click", render); c.appendChild(x); }
      setTimeout(function () { try { f.focus(); } catch (e2) {} }, 50);
      return c;
    }
    function signOut() {
      var o = el("button", "btn ghost", "Sign out"); o.style.marginTop = "10px";
      o.addEventListener("click", function () { auth.signOut(); });
      return o;
    }
  }

  function renderChooser(root) {
    root.innerHTML = "";
    var c = card("Which league?", "Pick tonight's game.");
    Object.keys(GAMES).forEach(function (g) {
      var a = el("a", "btn primary", GAMES[g].label + " · " + GAMES[g].day + "s");
      a.href = "league.html?game=" + g; a.style.marginTop = "10px"; c.appendChild(a);
    });
    root.appendChild(c);
  }

  // ---- Staff console (league-admin.html) — REST, open writes ------------
  function initAdmin() {
    var root = document.getElementById("lpAdmin");
    var game = GAMES[qp("game")] ? qp("game") : (gameTonight() || "pokemon");
    var L = {}, query = "";
    var TS = { ".sv": "timestamp" };

    function load() { return BGF.fbGet("league").then(function (v) { L = v || {}; render(); }); }
    function set(path, val) { return BGF.fbSet("league/" + path, val); }
    function oops(e) {
      var msg = (e && e.message) || "Couldn't save";
      if (/40[13]/.test(msg)) msg = "Firebase blocked the write. The /league rules in LEAGUE_SETUP.md aren't applied yet.";
      showToast(msg); if (window.console) console.error("[league-admin]", e);
    }
    function commit(p) { return p.then(load).catch(oops); }
    function setGame(g) { game = g; history.replaceState({}, "", "league-admin.html?game=" + g); query = ""; render(); }

    function render() {
      settle(root);
      root.innerHTML = "";
      document.body.setAttribute("data-game", game);
      var G = GAMES[game], now = Date.now(), e = eastern(now), today = e.id;
      var night = isLeagueNight(game, now);

      var tabs = el("div", "lp-tabs");
      Object.keys(GAMES).forEach(function (g) {
        var b = el("button", "lp-tab" + (g === game ? " on" : ""), GAMES[g].short + " · " + GAMES[g].day.slice(0, 3));
        b.addEventListener("click", function () { setGame(g); });
        tabs.appendChild(b);
      });
      root.appendChild(tabs);

      // Tonight
      var day = (L.checkins && L.checkins[game] && L.checkins[game][today]) || {};
      var hereIds = Object.keys(day).sort(function (a, b) { return nameOf(L, a).localeCompare(nameOf(L, b)); });
      var tc = card("Tonight · " + niceDate(today, true), night
        ? hereIds.length + " checked in for " + G.label + "."
        : "Not a " + G.short + " night (" + G.short + " is " + G.day + "s). Check-ins here still count if you need them.");
      if (!hereIds.length) tc.appendChild(el("p", "hint", "No one checked in yet."));
      hereIds.forEach(function (pid) {
        var r = el("div", "cl-frow");
        var nm = el("span", null, nameOf(L, pid));
        if (pid.indexOf("walk_") === 0) { var tg = el("span", "lp-dim", " · no email"); nm.appendChild(tg); }
        r.appendChild(nm);
        var rm = el("button", "cl-choice sm", "Remove");
        rm.addEventListener("click", function () { if (confirm("Remove " + nameOf(L, pid) + "'s check-in for tonight?")) commit(set("checkins/" + game + "/" + today + "/" + pid, null)); });
        r.appendChild(rm); tc.appendChild(r);
      });
      root.appendChild(tc);

      // Check someone in
      var cc = card("Check someone in", "Tap a name, or add a new player who has no email (kids, no phone).");
      var search = el("input", "field"); search.placeholder = "Search players"; search.value = query;
      var list = el("div", "lp-pick");
      function drawPicks() {
        list.innerHTML = "";
        var q = query.toLowerCase(), ps = L.players || {};
        var regulars = {};
        checkinEvents(L, game).forEach(function (ev) { regulars[ev.pid] = (regulars[ev.pid] || 0) + 1; });
        var ids = Object.keys(ps).filter(function (pid) {
          if (q) return nameOf(L, pid).toLowerCase().indexOf(q) !== -1;
          return regulars[pid];
        }).sort(function (a, b) { return nameOf(L, a).localeCompare(nameOf(L, b)); }).slice(0, 40);
        if (!ids.length) list.appendChild(el("p", "hint", q ? "No match. Add them below." : "Regulars show here after their first check-in. Search for anyone."));
        ids.forEach(function (pid) {
          var isIn = !!day[pid];
          var b = el("button", "cl-choice sm" + (isIn ? " on" : ""), nameOf(L, pid) + (isIn ? " ✓" : ""));
          b.addEventListener("click", function () {
            if (isIn) return;
            if (!night && !confirm("Today isn't " + G.day + ". Check " + nameOf(L, pid) + " in anyway?")) return;
            commit(set("checkins/" + game + "/" + today + "/" + pid, TS));
          });
          list.appendChild(b);
        });
      }
      search.addEventListener("input", function () { query = search.value; drawPicks(); });
      cc.appendChild(search); drawPicks(); cc.appendChild(list);
      var add = el("div", "lp-addrow");
      var af = el("input", "field"); af.placeholder = "First name"; af.setAttribute("maxlength", "30");
      var al = el("input", "field"); al.placeholder = "Last name"; al.setAttribute("maxlength", "30");
      var ab = el("button", "btn game", "Add + check in");
      ab.addEventListener("click", function () {
        var first = cleanName(af.value);
        if (!first) { af.focus(); return; }
        if (!night && !confirm("Today isn't " + G.day + ". Add and check in anyway?")) return;
        var pid = "walk_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
        commit(set("players/" + pid, { first: first, li: initialOf(al.value), walkIn: true, createdAt: TS })
          .then(function () { return set("checkins/" + game + "/" + today + "/" + pid, TS); }));
      });
      add.appendChild(af); add.appendChild(al); add.appendChild(ab);
      cc.appendChild(add);
      root.appendChild(cc);

      renderDrawing(now, today);
      renderRoster();
      renderHistory();

      var links = el("div", "cl-card");
      links.appendChild(el("p", "section-label", "Links"));
      var lk = el("div", "event-actions");
      [["TV roster ↗", "league-board.html?game=" + game], ["Check-in page ↗", "league.html?game=" + game], ["Printable QR sign ↗", "league-qr.html?game=" + game]].forEach(function (x) {
        var a = el("a", "btn ghost", x[0]); a.href = x[1]; a.target = "_blank"; a.rel = "noopener"; lk.appendChild(a);
      });
      links.appendChild(lk); root.appendChild(links);
    }

    function renderDrawing(now, today) {
      var nd = nextDraw(L, game, now);
      var ran = L.draws && L.draws[game] && L.draws[game][today];
      var c = card(ran ? "Tonight's drawing" : nd.month + " drawing", ran ? "" : (nd.tonight ? "Tonight is drawing night." : "Runs " + nd.label + ", the last " + GAMES[game].day + " of the month."));

      var prizeIn = el("input", "field"); prizeIn.placeholder = "Prize (shows on the TV and phones)";
      prizeIn.value = (L.meta && L.meta[game] && L.meta[game].prize) || "";
      var ps = el("button", "btn ghost", "Save prize"); ps.style.marginTop = "8px";
      ps.addEventListener("click", function () {
        set("meta/" + game + "/prize", cleanName(prizeIn.value) ? prizeIn.value.trim().slice(0, 80) : null)
          .then(function () { showToast("Prize saved"); return load(); }).catch(oops);
      });
      c.appendChild(prizeIn); c.appendChild(ps);

      if (ran) {
        var w = winnersOf(ran);
        c.appendChild(el("p", "section-label", w.length > 1 ? "Winners" : "Winner"));
        w.forEach(function (pid) { c.appendChild(el("div", "lp-winrow", "🎉 " + nameOf(L, pid))); });
        var more = el("button", "btn game", "Draw another winner"); more.style.marginTop = "10px";
        more.addEventListener("click", function () {
          var ex = {}; w.forEach(function (p) { ex[p] = true; });
          var pid = pickWinner(ran.pool || {}, ex);
          if (!pid) { showToast("Everyone in the pool has already won."); return; }
          commit(set("draws/" + game + "/" + today + "/winners/" + w.length, pid));
        });
        c.appendChild(more);
        var undo = el("button", "btn ghost", "Undo tonight's drawing"); undo.style.marginTop = "8px";
        undo.addEventListener("click", function () {
          if (confirm("Undo tonight's drawing? Everyone gets their entries back and the winner is cleared.")) commit(set("draws/" + game + "/" + today, null));
        });
        c.appendChild(undo);
        root.appendChild(c); return;
      }

      var pl = pool(L, game), ids = Object.keys(pl), tickets = 0;
      ids.forEach(function (p) { tickets += pl[p]; });
      c.appendChild(el("p", "section-label", "In the drawing (" + plural(ids.length, "player") + ", " + entries(tickets) + ")"));
      if (!ids.length) c.appendChild(el("p", "hint", "No one has " + THRESHOLD + " points yet."));
      ids.sort(function (a, b) { return pl[b] - pl[a] || nameOf(L, a).localeCompare(nameOf(L, b)); }).forEach(function (pid) {
        var r = el("div", "cl-frow"); r.appendChild(el("span", null, nameOf(L, pid))); r.appendChild(el("b", null, "×" + pl[pid])); c.appendChild(r);
      });
      var run = el("button", "btn primary", "Run the drawing"); run.style.marginTop = "12px";
      run.addEventListener("click", function () {
        if (!ids.length) { showToast("No one has an entry yet."); return; }
        var warn = nd.tonight ? "" : "Tonight isn't the last " + GAMES[game].day + " of the month. ";
        if (!confirm(warn + "Run the " + nd.month + " drawing now? Entries get used up and the winner shows on the TV.")) return;
        var pid = pickWinner(pl, {});
        var prize = (L.meta && L.meta[game] && L.meta[game].prize) || "";
        commit(set("draws/" + game + "/" + today, { at: { ".sv": "timestamp" }, pool: pl, winners: [pid], prize: prize, threshold: THRESHOLD }));
      });
      c.appendChild(run);
      root.appendChild(c);
    }

    function renderRoster() {
      var cur = current(L, game);
      var c = card("Roster since the last drawing", cur.rows.length ? "" : "No check-ins yet.");
      cur.rows.forEach(function (r) {
        var row2 = el("div", "cl-frow");
        row2.appendChild(el("span", null, r.name));
        var right = el("span", "lp-rright"); right.appendChild(pips(r.into)); right.appendChild(el("b", null, String(r.pts)));
        if (r.entries) right.appendChild(ticket(r.entries));
        row2.appendChild(right); c.appendChild(row2);
      });
      root.appendChild(c);
    }

    function renderHistory() {
      var ds = drawList(L, game).reverse();
      if (!ds.length) return;
      var c = card("Past drawings");
      ds.slice(0, 12).forEach(function (d) {
        var r = el("div", "cl-frow");
        r.appendChild(el("span", null, niceDate(d.id) + (d.prize ? " · " + d.prize : "")));
        r.appendChild(el("b", null, d.winners.map(function (p) { return nameOf(L, p); }).join(", ") || "—"));
        c.appendChild(r);
      });
      root.appendChild(c);
    }

    load(); setInterval(function () { if (!document.activeElement || document.activeElement.tagName !== "INPUT") load(); }, 10000);
  }

  // ---- TV roster (league-board.html?game=…) — read-only via REST ---------
  // Three spots: tonight's open play (left top), the sign-in QR (left bottom),
  // and the month's running roster (right). ?demo=1 renders sample data.
  function initBoard() {
    var game = GAMES[qp("game")] ? qp("game") : (gameTonight() || "pokemon");
    var G = GAMES[game], demo = qp("demo") != null;
    document.body.setAttribute("data-game", game);
    var $ = function (id) { return document.getElementById(id); };
    $("lpbGame").textContent = G.label;
    $("lpbQrTitle").textContent = "Scan to check in";
    $("lpbQrSub").textContent = "1 check-in = 1 point · " + THRESHOLD + " points = 1 entry";
    try {
      var q = global.qrcode(0, "M"); q.addData(checkinUrl(game)); q.make();
      $("lpbQr").innerHTML = q.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
    } catch (e) { $("lpbQr").textContent = checkinUrl(game); }
    $("lpbUrl").textContent = checkinUrl(game).replace(/^https:\/\//, "");

    var seenWinners = null, revealUntil = 0;

    function tick() {
      var now = Date.now();
      $("lpbClock").textContent = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" }).format(new Date(now));
      $("lpbDate").textContent = "Open play · " + niceDate(eastern(now).id, true);
    }
    function load() {
      (demo ? Promise.resolve(demoData(game)) : BGF.fbGet("league")).then(function (L) { render(L || {}); });
    }
    function render(L) {
      var now = Date.now(), v = boardView(L, game, now);
      var nextPrize = (L.meta && L.meta[game] && L.meta[game].prize) || "";
      $("lpbMonth").textContent = v.month + " roster";
      var sub = (v.draw ? "Drawing done" : (v.next.tonight ? "Drawing tonight" : "Drawing " + v.next.label)) + (v.prize ? " · Prize: " + v.prize : "");
      $("lpbRosterSub").textContent = sub;
      $("lpbRules").innerHTML = "";
      [["Check in every " + G.day, "Scan the code when you get here."], [THRESHOLD + " check-ins = 1 entry", "Extra points carry to next month."], [v.next.tonight && !v.draw ? "Drawing is tonight" : "Drawing: " + v.next.label, nextPrize ? "Prize: " + nextPrize : "Last " + G.day + " of the month."]].forEach(function (x) {
        var li = el("div", "lpb-rule"); li.appendChild(el("b", null, x[0])); li.appendChild(el("span", null, x[1])); $("lpbRules").appendChild(li);
      });

      var box = $("lpbRows"); box.innerHTML = "";
      var rows = v.rows, n = rows.length;
      if (!n) {
        var em = el("div", "lpb-empty");
        em.appendChild(el("b", null, "No check-ins yet this month"));
        em.appendChild(el("span", null, "Scan the code to get on the board."));
        box.appendChild(em);
      } else {
        var cols = n <= 10 ? 1 : n <= 24 ? 2 : n <= 45 ? 3 : 4;
        var perCol = Math.ceil(n / cols);
        box.style.setProperty("--cols", cols);
        box.style.setProperty("--rows", perCol);
        box.style.setProperty("--fs", Math.max(1.5, Math.min(cols > 2 ? 2.7 : cols > 1 ? 3 : 3.6, 66 / perCol)).toFixed(2) + "vh");
        box.classList.toggle("dense", cols > 2);   // 3+ columns: drop the pips so names fit
        var winners = (v.draw && v.draw.winners) || [];
        rows.forEach(function (r) {
          var won = winners.indexOf(r.pid) !== -1;
          var d = el("div", "lpb-row" + (v.here[r.pid] ? " here" : "") + (won ? " won" : ""));
          d.appendChild(el("span", "lpb-nm", r.name));
          d.appendChild(pips(r.into));
          d.appendChild(el("span", "lpb-pts", String(r.pts)));
          var tk = el("span", "lpb-tk");
          if (won) tk.textContent = "🏆";
          else if (r.entries) { tk.textContent = "🎟"; if (r.entries > 1) tk.appendChild(el("sub", null, "×" + r.entries)); }
          d.appendChild(tk);
          box.appendChild(d);
        });
      }
      $("lpbLegend").textContent = Object.keys(v.here).length ? Object.keys(v.here).length + " here tonight (highlighted)" : "";

      // Drawing winner: spin + reveal when a new winner shows up while this TV
      // is on (or the TV loaded within 2 minutes of the draw), then keep a
      // banner up for the rest of the night.
      var w = (v.draw && v.draw.winners) || [];
      var key = v.draw ? v.draw.id + ":" + w.join(",") : "";
      if (seenWinners === null) {
        seenWinners = key;
        if (w.length && now - v.draw.at < 120000) reveal(L, v, w[w.length - 1]);
      } else if (key !== seenWinners) {
        seenWinners = key;
        if (w.length) reveal(L, v, w[w.length - 1]);
      }
      var ban = $("lpbBanner");
      if (w.length && now > revealUntil) {
        ban.hidden = false;
        ban.textContent = "🎉 " + v.month + " drawing winner" + (w.length > 1 ? "s" : "") + ": " + w.map(function (p) { return nameOf(L, p); }).join(", ");
      } else ban.hidden = true;
    }
    function reveal(L, v, winner) {
      var ov = $("lpbReveal"), nm = $("lpbRevealName");
      var prior = ((v.draw && v.draw.winners) || []).slice(0, -1);
      var names = Object.keys((v.draw && v.draw.pool) || {}).filter(function (p) { return prior.indexOf(p) === -1; })
        .map(function (p) { return nameOf(L, p); });
      if (!names.length) names = [nameOf(L, winner)];
      revealUntil = Date.now() + 45000;
      ov.hidden = false; ov.classList.remove("done");
      $("lpbRevealKick").textContent = v.month + " drawing";
      var i = 0, steps = 34;
      (function spin() {
        if (i < steps) {
          nm.textContent = names[i % names.length];
          i++; setTimeout(spin, 60 + i * i * 0.35);
        } else {
          nm.textContent = nameOf(L, winner); ov.classList.add("done");
          setTimeout(function () { ov.hidden = true; }, 40000);
        }
      })();
    }

    tick(); setInterval(tick, 15000);
    load(); setInterval(load, 5000);
    loadTonight();
    setInterval(loadTonight, 5 * 60000);

    // Tonight's open-play event, from the game's Shopify events collection
    // (titles are "YYYY/MM/DD Event Name", same as event-tv.html).
    function loadTonight() {
      var host = $("lpbTonight");
      function fallback() { host.innerHTML = ""; host.appendChild(el("div", "lpb-ev", G.short + " Open Play")); host.appendChild(el("div", "lpb-evmeta", "Free to play · all levels welcome")); }
      if (demo || !global.BGFG) { fallback(); return; }
      fetch("https://balancegamingfl.com/collections/" + G.events + "/products.json?limit=250", { cache: "no-store" })
        .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
        .then(function (data) {
          var evs = ((data && data.products) || []).filter(function (p) { return BGFG.isTonight(p.title); });
          if (!evs.length) { fallback(); return; }
          host.innerHTML = "";
          evs.slice(0, 2).forEach(function (p) {
            host.appendChild(el("div", "lpb-ev", BGFG.stripDate(p.title)));
            var price = p.variants && p.variants[0] && Number(p.variants[0].price);
            host.appendChild(el("div", "lpb-evmeta", price > 0 ? "Entry $" + p.variants[0].price + " · register at the counter" : "Free to play · all levels welcome"));
          });
        }).catch(fallback);
    }
  }

  // Sample data for ?demo=1 previews (never written anywhere).
  function demoData(game) {
    var now = Date.now(), e = eastern(now), names = [["Ash", "K"], ["Misty", "W"], ["Brock", "H"], ["Dawn", "B"], ["Gary", "O"], ["Serena", "Y"], ["Max", "M"], ["Lillie", "A"], ["Hop", "L"], ["Nemona", "P"], ["Iris", "D"], ["Cilan", "S"], ["Leon", "C"], ["Marnie", "G"]];
    var L = { players: {}, checkins: {}, meta: {} };
    L.meta[game] = { prize: "Battle deck" };
    L.checkins[game] = {};
    // Four earlier league nights this month-ish, plus tonight.
    var dayMs = 86400000, nights = [];
    for (var k = 4; k >= 0; k--) nights.push(now - k * 7 * dayMs);
    names.forEach(function (n, i) {
      var pid = "demo" + i; L.players[pid] = { first: n[0], li: n[1] };
      nights.forEach(function (ts, j) {
        if ((i * 7 + j * 3) % 5 === 0 && j < 4) return;          // skip some nights
        if (j === 4 && i % 3 === 2) return;                       // not everyone's here tonight
        var t2 = ts - (j === 4 ? 0 : 3600000) + i, id = eastern(t2).id;
        (L.checkins[game][id] = L.checkins[game][id] || {})[pid] = t2;
      });
    });
    if (qp("demo") === "draw") {
      var pl = pool(L, game); L.draws = {}; L.draws[game] = {};
      L.draws[game][e.id] = { at: now - 5000, pool: pl, winners: [Object.keys(pl)[0]], prize: "Battle deck", threshold: THRESHOLD };
    }
    return L;
  }

  // ---- Printable counter sign (league-qr.html?game=…) -------------------
  function initQrSign() {
    var game = GAMES[qp("game")] ? qp("game") : "pokemon", G = GAMES[game];
    document.body.setAttribute("data-game", game);
    document.getElementById("lqTitle").textContent = G.label;
    document.getElementById("lqSub").textContent = "Check in every " + G.day + ". Every " + THRESHOLD + " check-ins = 1 entry in the monthly prize drawing.";
    try { var q = global.qrcode(0, "M"); q.addData(checkinUrl(game)); q.make(); document.getElementById("lqQr").innerHTML = q.createSvgTag({ cellSize: 8, margin: 2, scalable: true }); }
    catch (e) { document.getElementById("lqQr").textContent = checkinUrl(game); }
    document.getElementById("lqUrl").textContent = checkinUrl(game).replace(/^https:\/\//, "");
  }

  global.BGFLP = { Engine: Engine, GAMES: GAMES, initPlayer: initPlayer, initAdmin: initAdmin, initBoard: initBoard, initQrSign: initQrSign, demoData: demoData };
  if (typeof module !== "undefined" && module.exports) module.exports = global.BGFLP;
})(typeof window !== "undefined" ? window : globalThis);
