/* ============================================================
   Balance Martial Arts & Gaming — Swiss tournament
   - Pure engine (pairings, seeding, byes, standings) — testable in Node
   - Player page: self check-in, see your match, report the winner
   - Admin console: roster + seeding, rounds, results, standings

   Firebase shape at /tournament:
   {
     status: "setup" | "running" | "final",
     name, totalRounds, currentRound, nextId,
     players: { p1:{name,dropped,seed?}, s3k9:{name,dropped} ... },
     rounds: { "1": { m1:{table,p1,p2,winner}, bye:{table:null,p1,p2:null,winner:"p1"} } }
   }
   winner is "p1" | "p2" | "draw" | null.  seed: lower number = higher seed.
   ============================================================ */
(function (global) {
  "use strict";

  var WIN = 3, DRAW = 1;

  // ---- Engine (pure) ---------------------------------------------------
  function playersArray(players) {
    players = players || {};
    return Object.keys(players).map(function (id) {
      var p = players[id];
      return { id: id, name: p.name, dropped: !!p.dropped,
        seed: (typeof p.seed === "number" ? p.seed : undefined) };
    });
  }
  function activePlayers(players) {
    return playersArray(players).filter(function (p) { return !p.dropped; });
  }
  function recommendedRounds(n) {
    if (n <= 2) return 1;
    return Math.max(1, Math.ceil(Math.log2(n)));
  }
  function roundKeys(rounds) {
    return Object.keys(rounds || {}).sort(function (a, b) { return (+a) - (+b); });
  }

  function computeStats(players, rounds) {
    var stats = {};
    playersArray(players).forEach(function (p) {
      stats[p.id] = { id: p.id, name: p.name, dropped: p.dropped, seed: p.seed,
        points: 0, w: 0, l: 0, d: 0, byes: 0, played: 0, opponents: [] };
    });
    roundKeys(rounds).forEach(function (rk) {
      var matches = rounds[rk] || {};
      Object.keys(matches).forEach(function (mk) {
        var m = matches[mk];
        var s1 = stats[m.p1];
        if (m.p2 == null) { if (s1) { s1.points += WIN; s1.w += 1; s1.played += 1; s1.byes += 1; } return; }
        var s2 = stats[m.p2];
        if (!s1 || !s2) return;
        s1.opponents.push(m.p2); s2.opponents.push(m.p1);
        if (m.winner == null) return;
        s1.played += 1; s2.played += 1;
        if (m.winner === "p1") { s1.points += WIN; s1.w += 1; s2.l += 1; }
        else if (m.winner === "p2") { s2.points += WIN; s2.w += 1; s1.l += 1; }
        else if (m.winner === "draw") { s1.points += DRAW; s2.points += DRAW; s1.d += 1; s2.d += 1; }
      });
    });
    return stats;
  }

  function mwp(s) { if (!s || s.played === 0) return 0.33; return Math.max(0.33, s.points / (3 * s.played)); }

  function standings(players, rounds) {
    var stats = computeStats(players, rounds);
    var arr = Object.keys(stats).map(function (k) { return stats[k]; });
    arr.forEach(function (s) {
      if (!s.opponents.length) { s.omw = 0; return; }
      var sum = 0, cnt = 0;
      s.opponents.forEach(function (oid) { var os = stats[oid]; if (os) { sum += mwp(os); cnt++; } });
      s.omw = cnt ? sum / cnt : 0;
    });
    arr.sort(function (a, b) {
      if (b.points !== a.points) return b.points - a.points;
      if (Math.abs(b.omw - a.omw) > 1e-9) return b.omw - a.omw;
      var sa = (typeof a.seed === "number") ? a.seed : Infinity;
      var sb = (typeof b.seed === "number") ? b.seed : Infinity;
      if (sa !== sb) return sa - sb;
      return a.name.localeCompare(b.name);
    });
    arr.forEach(function (s, i) { s.rank = i + 1; });
    return arr;
  }

  function opponentsMap(players, rounds) {
    var map = {};
    playersArray(players).forEach(function (p) { map[p.id] = {}; });
    roundKeys(rounds).forEach(function (rk) {
      var matches = rounds[rk] || {};
      Object.keys(matches).forEach(function (mk) {
        var m = matches[mk];
        if (m.p2 == null) return;
        if (map[m.p1]) map[m.p1][m.p2] = true;
        if (map[m.p2]) map[m.p2][m.p1] = true;
      });
    });
    return map;
  }
  function byesTaken(players, rounds) {
    var b = {};
    roundKeys(rounds).forEach(function (rk) {
      var matches = rounds[rk] || {};
      Object.keys(matches).forEach(function (mk) { var m = matches[mk]; if (m.p2 == null) b[m.p1] = true; });
    });
    return b;
  }
  function shuffle(arr, rnd) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor((rnd ? rnd() : Math.random()) * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function backtrackPair(list, opps) {
    if (list.length === 0) return [];
    var first = list[0];
    for (var i = 1; i < list.length; i++) {
      var cand = list[i];
      if (!opps[first.id] || !opps[first.id][cand.id]) {
        var rest = list.slice(1, i).concat(list.slice(i + 1));
        var sub = backtrackPair(rest, opps);
        if (sub !== null) return [[first, cand]].concat(sub);
      }
    }
    return null;
  }

  function anySeeded(players) {
    return activePlayers(players).some(function (p) { return typeof p.seed === "number"; });
  }

  function pairRound(players, rounds, roundNumber, tableCount, rnd) {
    tableCount = tableCount || 16;
    var active = activePlayers(players);
    var order, useFold = false;

    if (roundNumber <= 1) {
      if (anySeeded(players)) {
        var withSeed = active.filter(function (p) { return typeof p.seed === "number"; })
          .sort(function (a, b) { return a.seed - b.seed; });
        var noSeed = shuffle(active.filter(function (p) { return typeof p.seed !== "number"; }), rnd);
        order = withSeed.concat(noSeed);   // seeded first, unseeded random after
        useFold = true;                    // top-half vs bottom-half
      } else {
        order = shuffle(active, rnd);
      }
    } else {
      var st = standings(players, rounds);
      var rank = {}; st.forEach(function (s, i) { rank[s.id] = i; });
      order = active.slice().sort(function (a, b) { return rank[a.id] - rank[b.id]; });
    }

    var byePlayer = null;
    if (order.length % 2 === 1) {
      var taken = byesTaken(players, rounds);
      for (var i = order.length - 1; i >= 0; i--) { if (!taken[order[i].id]) { byePlayer = order[i]; break; } }
      if (!byePlayer) byePlayer = order[order.length - 1];
      order = order.filter(function (p) { return p.id !== byePlayer.id; });
    }

    var paired;
    if (useFold) {
      paired = [];
      var half = order.length / 2;
      for (var f = 0; f < half; f++) paired.push([order[f], order[f + half]]);
    } else {
      var opps = opponentsMap(players, rounds);
      paired = backtrackPair(order, opps);
      if (paired === null) { paired = []; for (var k = 0; k < order.length; k += 2) paired.push([order[k], order[k + 1]]); }
    }

    var matches = {};
    paired.forEach(function (pair, idx) {
      matches["m" + (idx + 1)] = { table: idx + 1, p1: pair[0].id, p2: pair[1].id, winner: null };
    });
    if (byePlayer) matches["bye"] = { table: null, p1: byePlayer.id, p2: null, winner: "p1" };
    return matches;
  }

  function roundComplete(matches) {
    if (!matches) return false;
    return Object.keys(matches).every(function (mk) { return matches[mk].winner != null; });
  }

  var Engine = {
    WIN: WIN, DRAW: DRAW, playersArray: playersArray, activePlayers: activePlayers,
    recommendedRounds: recommendedRounds, computeStats: computeStats, mwp: mwp,
    standings: standings, opponentsMap: opponentsMap, byesTaken: byesTaken,
    anySeeded: anySeeded, pairRound: pairRound, roundComplete: roundComplete
  };

  // ---- DOM helpers -----------------------------------------------------
  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  }
  function nameOf(T, pid) { return (T.players && T.players[pid] && T.players[pid].name) || "—"; }
  var LS = "bgft_pid";

  // ---- Player page (tournament.html) -----------------------------------
  function initPlayer() {
    var tbl = BGF.getTable();
    var root = document.getElementById("tourPlayer");
    var titleEl = document.querySelector(".event-title");
    var subEl = document.querySelector(".event-sub");
    var busy = false;

    function setHero(t, s) { if (titleEl) titleEl.textContent = t; if (subEl) subEl.textContent = s; }
    function msgCard(title, body) {
      var c = el("div", "panel placeholder");
      c.appendChild(el("span", "tag", "Tournament"));
      c.appendChild(el("h2", null, title));
      c.appendChild(el("p", null, body));
      return c;
    }

    function checkinView(T) {
      setHero("Player Check-In", "Add your name to join the tournament.");
      root.innerHTML = "";
      var myId = localStorage.getItem(LS);
      var me = (myId && T.players && T.players[myId]) ? T.players[myId] : null;
      if (me) {
        var c = el("div", "match-card");
        c.appendChild(el("div", "round-tag", "Checked in"));
        c.appendChild(el("div", "checked-name", me.name));
        c.appendChild(el("p", "report-label", "You're in! Keep this page open — your match appears here once the organizer pairs round 1."));
        var again = el("button", "rbtn", "Not you? Check in again");
        again.addEventListener("click", function () { localStorage.removeItem(LS); render(T); });
        c.appendChild(again);
        root.appendChild(c);
        return;
      }
      var card = el("div", "match-card");
      card.appendChild(el("div", "round-tag", "Join tournament"));
      var input = el("input", "field"); input.placeholder = "Your name"; input.setAttribute("maxlength", "40");
      input.addEventListener("keydown", function (e) { if (e.key === "Enter") submit(); });
      card.appendChild(input);
      var btn = el("button", "rbtn sel", "Check in");
      function submit() {
        var nm = (input.value || "").trim();
        if (!nm) { input.focus(); return; }
        if (busy) return; busy = true; btn.classList.add("saving");
        var id = "s" + Date.now().toString(36) + Math.floor(Math.random() * 1000);
        BGF.fbSet("tournament/players/" + id, { name: nm, dropped: false })
          .then(function () { localStorage.setItem(LS, id); return load(); })
          .catch(function () { showToast("Couldn't check in — try again"); })
          .then(function () { busy = false; });
      }
      btn.addEventListener("click", submit);
      card.appendChild(btn);
      root.appendChild(card);
    }

    function reportBtn(label, val, current, round, mid) {
      var b = el("button", "rbtn" + (current === val ? " sel" : ""), label);
      b.addEventListener("click", function () {
        if (busy) return; busy = true; b.classList.add("saving");
        BGF.fbSet("tournament/rounds/" + round + "/" + mid + "/winner", val)
          .then(function () { return load(); })
          .catch(function () { showToast("Couldn't save — try again"); })
          .then(function () { busy = false; });
      });
      return b;
    }

    function runningView(T) {
      setHero("Your Match", "Updates automatically — no need to refresh.");
      root.innerHTML = "";
      var round = T.currentRound;
      var matches = (T.rounds && T.rounds[round]) || null;
      if (!round || !matches) {
        root.appendChild(msgCard("Round being paired…", "Hang tight — pairings for the next round are on the way. This page updates on its own."));
        return;
      }
      var myId = localStorage.getItem(LS);
      var mid = null, m = null;
      // Prefer the checked-in player's own match (works even if they scan the wrong table).
      if (myId) Object.keys(matches).forEach(function (k) { var mm = matches[k]; if (mm.p1 === myId || mm.p2 === myId) { mid = k; m = mm; } });
      if (!m) Object.keys(matches).forEach(function (k) { if (matches[k].table === tbl) { mid = k; m = matches[k]; } });

      if (!m) { root.appendChild(msgCard("No match at this table", "You're not seated here this round. If you just checked in, you may have a bye — check with the organizer.")); return; }

      if (m.p2 == null) {  // this player's bye
        var bc = el("div", "match-card");
        bc.appendChild(el("div", "round-tag", "Round " + round));
        bc.appendChild(el("div", "checked-name", nameOf(T, m.p1)));
        bc.appendChild(el("p", "report-label", "You have a bye this round — automatic win 🎉  Relax and wait for the next pairing."));
        root.appendChild(bc);
        return;
      }

      var card = el("div", "match-card");
      var loc = (m.table != null && m.table !== tbl) ? ("Round " + round + " · Your table is T" + m.table) : ("Round " + round + " · Table " + (m.table != null ? m.table : tbl));
      card.appendChild(el("div", "round-tag", loc));
      var vs = el("div", "vs-row");
      vs.appendChild(el("div", "pname" + (m.winner === "p1" ? " won" : ""), nameOf(T, m.p1)));
      vs.appendChild(el("div", "vs", "vs"));
      vs.appendChild(el("div", "pname" + (m.winner === "p2" ? " won" : ""), nameOf(T, m.p2)));
      card.appendChild(vs);
      card.appendChild(el("p", "report-label", m.winner == null ? "Who won?" : "Reported — tap to change:"));
      var btns = el("div", "rbtns");
      btns.appendChild(reportBtn(nameOf(T, m.p1) + " won", "p1", m.winner, round, mid));
      btns.appendChild(reportBtn("Draw", "draw", m.winner, round, mid));
      btns.appendChild(reportBtn(nameOf(T, m.p2) + " won", "p2", m.winner, round, mid));
      card.appendChild(btns);
      if (m.winner != null) {
        card.appendChild(el("p", "reported-note",
          m.winner === "draw" ? "Recorded: draw" : "Recorded: " + nameOf(T, m.winner === "p1" ? m.p1 : m.p2) + " won"));
      }
      root.appendChild(card);
    }

    function render(T) {
      if (!T || !T.status) {
        setHero("Tournament", "Nothing running right now.");
        root.innerHTML = ""; root.appendChild(msgCard("No tournament running", "When a tournament starts, this page will show check-in and then your match."));
        return;
      }
      if (T.status === "setup") return checkinView(T);
      if (T.status === "final") {
        setHero("Tournament Complete 🏆", "Thanks for playing!");
        root.innerHTML = ""; root.appendChild(msgCard("Tournament complete 🏆", "Great games! Ask the organizer for the final standings."));
        return;
      }
      runningView(T);
    }

    // Re-render only when the data actually changed, and never while the player
    // is typing in the check-in box (otherwise the 4s poll wipes their input).
    var lastSig = null;
    function apply(T) {
      var ae = document.activeElement;
      if (ae && root.contains(ae) && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA")) return;
      var sig = JSON.stringify(T);
      if (sig === lastSig) return;
      lastSig = sig;
      render(T);
    }
    function load() { return BGF.fbGet("tournament").then(apply); }
    load();
    setInterval(function () { if (!busy) load(); }, 4000);
  }

  // ---- Admin console (admin.html) --------------------------------------
  function initAdmin() {
    var root = document.getElementById("adminRoot");
    var TABLES = BGF.MAX_TABLES || 16;
    var T = null, poll = null, lastSig = "";
    var saveEl = document.getElementById("saveState");
    function setSaving(t) { if (saveEl) saveEl.textContent = t || ""; }
    function fresh() { return { status: "setup", name: "", totalRounds: 0, currentRound: 0, nextId: 1, players: {}, rounds: {} }; }

    function startPolling() {
      if (poll) return;
      poll = setInterval(function () {
        BGF.fbGet("tournament").then(function (d) {
          if (!d) return;
          var sig = JSON.stringify(d);
          if (sig === lastSig) return;
          // don't clobber a field the organizer is actively typing in
          var ae = document.activeElement;
          if (ae && root.contains(ae) && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA")) { T = d; return; }
          T = d; lastSig = sig; render();
        });
      }, 3000);
    }

    function load() {
      return BGF.fbGet("tournament").then(function (d) {
        if (d && d.status) { T = d; lastSig = JSON.stringify(d); render(); startPolling(); }
        else { T = fresh(); BGF.fbSet("tournament", T).then(function () { lastSig = JSON.stringify(T); render(); startPolling(); }); }
      });
    }

    // ---- mutations (path-scoped so self check-ins are never clobbered) ----
    function setName(v) { T.name = v; BGF.fbSet("tournament/name", v); }
    function addPlayers(names) {
      var added = 0;
      names.forEach(function (nm) {
        nm = nm.trim(); if (!nm) return;
        var id = "p" + (T.nextId++);
        T.players[id] = { name: nm, dropped: false };
        BGF.fbSet("tournament/players/" + id, T.players[id]);
        added++;
      });
      if (added) { BGF.fbSet("tournament/nextId", T.nextId); render(); }
    }
    function removePlayer(id) { delete T.players[id]; BGF.fbSet("tournament/players/" + id, null); render(); }
    function setSeed(id, val) {
      if (!T.players[id]) return;
      if (val === "" || val == null || isNaN(val)) { delete T.players[id].seed; BGF.fbSet("tournament/players/" + id + "/seed", null); }
      else { T.players[id].seed = Number(val); BGF.fbSet("tournament/players/" + id + "/seed", Number(val)); }
    }
    function autoSeed() {
      Engine.playersArray(T.players).forEach(function (p, i) { setSeed(p.id, i + 1); });
      render();
    }
    function clearSeeds() {
      Engine.playersArray(T.players).forEach(function (p) { setSeed(p.id, ""); });
      render();
    }
    function startTournament() {
      var n = Engine.activePlayers(T.players).length;
      if (n < 2) { showToast("Add at least 2 players"); return; }
      T.status = "running"; T.currentRound = 0; T.totalRounds = Engine.recommendedRounds(n); T.rounds = {};
      setSaving("Starting…");
      Promise.all([
        BGF.fbSet("tournament/status", "running"),
        BGF.fbSet("tournament/totalRounds", T.totalRounds),
        BGF.fbSet("tournament/currentRound", 0),
        BGF.fbSet("tournament/rounds", {})
      ]).then(function () { setSaving(""); render(); }).catch(function () { setSaving("Failed"); });
    }
    function pairNext() {
      var next = (T.currentRound || 0) + 1;
      var matches = Engine.pairRound(T.players, T.rounds, next, TABLES);
      var used = Object.keys(matches).filter(function (k) { return matches[k].table != null; }).length;
      if (used > TABLES) { showToast("Too many matches for " + TABLES + " tables"); return; }
      setSaving("Pairing…");
      BGF.fbSet("tournament/rounds/" + next, matches)
        .then(function () { return BGF.fbSet("tournament/currentRound", next); })
        .then(function () { T.rounds[next] = matches; T.currentRound = next; setSaving(""); render(); })
        .catch(function () { setSaving("Pairing failed"); });
    }
    function setResult(round, mid, val) {
      setSaving("Saving…");
      BGF.fbSet("tournament/rounds/" + round + "/" + mid + "/winner", val).then(function () {
        if (T.rounds[round] && T.rounds[round][mid]) T.rounds[round][mid].winner = val;
        setSaving(""); render();
      }).catch(function () { setSaving("Save failed"); });
    }
    function dropPlayer(id) {
      BGF.fbSet("tournament/players/" + id + "/dropped", true).then(function () { if (T.players[id]) T.players[id].dropped = true; render(); });
    }
    function finish() { T.status = "final"; BGF.fbSet("tournament/status", "final").then(render); }
    function resetAll() { T = fresh(); BGF.fbSet("tournament", T).then(function () { lastSig = JSON.stringify(T); render(); }); }

    // ---- render ----
    function render() { root.innerHTML = ""; if (!T || T.status === "setup") return renderSetup(); renderRunning(); }

    function renderSetup() {
      var wrap = el("div");
      var list = Engine.playersArray(T.players);

      var nameCard = el("div", "admin-card");
      nameCard.appendChild(el("p", "section-label", "New tournament"));
      var nameIn = el("input", "field"); nameIn.placeholder = "Tournament name (optional)"; nameIn.value = T.name || "";
      nameIn.addEventListener("change", function () { setName(nameIn.value); });
      nameCard.appendChild(nameIn);
      wrap.appendChild(nameCard);

      var addCard = el("div", "admin-card");
      addCard.appendChild(el("p", "section-label", "Add players"));
      addCard.appendChild(el("p", "hint", "Type names (one per line), or have players scan any table to check themselves in — they appear here live."));
      var ta = el("textarea", "field area"); ta.placeholder = "One name per line, then Add";
      addCard.appendChild(ta);
      var addBtn = el("button", "btn game", "Add players");
      addBtn.addEventListener("click", function () { var names = ta.value.split("\n"); ta.value = ""; addPlayers(names); });
      addCard.appendChild(addBtn);
      wrap.appendChild(addCard);

      var rosterCard = el("div", "admin-card");
      rosterCard.appendChild(el("p", "section-label", "Players (" + list.length + ")"));
      if (list.length) {
        var seedActions = el("div", "seed-actions");
        var a1 = el("button", "mini", "Auto-seed (list order)");
        a1.addEventListener("click", autoSeed);
        var a2 = el("button", "mini", "Clear seeds");
        a2.addEventListener("click", clearSeeds);
        seedActions.appendChild(a1); seedActions.appendChild(a2);
        rosterCard.appendChild(seedActions);
        rosterCard.appendChild(el("p", "hint", Engine.anySeeded(T.players)
          ? "Seeded — round 1 pairs top half vs bottom half."
          : "No seeds — round 1 will be random. Set seed numbers (1 = top) to seed."));

        // show in seed order when seeded, else entry order
        var display = list.slice();
        if (Engine.anySeeded(T.players)) {
          display.sort(function (a, b) {
            var sa = (typeof a.seed === "number") ? a.seed : Infinity, sb = (typeof b.seed === "number") ? b.seed : Infinity;
            return sa - sb;
          });
        }
        var box = el("div", "setup-players");
        display.forEach(function (p) {
          var row = el("div", "setup-player");
          var seedIn = el("input", "seed-in"); seedIn.type = "number"; seedIn.min = "1"; seedIn.placeholder = "–";
          seedIn.value = (typeof p.seed === "number") ? p.seed : "";
          seedIn.title = "Seed (1 = top)";
          seedIn.addEventListener("change", function () { setSeed(p.id, seedIn.value); render(); });
          row.appendChild(seedIn);
          row.appendChild(el("span", "nm", p.name));
          var x = el("button", "x", "✕");
          x.addEventListener("click", function () { removePlayer(p.id); });
          row.appendChild(x);
          box.appendChild(row);
        });
        rosterCard.appendChild(box);
      } else {
        rosterCard.appendChild(el("p", "hint", "No players yet. Add names above or open check-in (turn on Tournament on the control panel, then players scan a table)."));
      }
      wrap.appendChild(rosterCard);

      var startCard = el("div", "admin-card");
      var n = Engine.activePlayers(T.players).length;
      startCard.appendChild(el("p", "hint", n >= 2
        ? (n + " players · " + Engine.recommendedRounds(n) + " Swiss rounds · " + (Engine.anySeeded(T.players) ? "seeded R1" : "random R1"))
        : "Add at least 2 players to start."));
      var start = el("button", "btn primary", "Start tournament");
      if (n < 2) start.setAttribute("disabled", "true");
      start.addEventListener("click", startTournament);
      startCard.appendChild(start);
      wrap.appendChild(startCard);

      root.appendChild(wrap);
    }

    function renderRunning() {
      var wrap = el("div");
      var head = el("div", "admin-card");
      head.appendChild(el("p", "section-label", (T.name || "Tournament")));
      head.appendChild(el("p", "hint", T.status === "final" ? "Final standings"
        : (T.currentRound ? ("Round " + T.currentRound + " of " + T.totalRounds) : "Ready to pair round 1")));
      wrap.appendChild(head);

      if (T.currentRound && T.rounds && T.rounds[T.currentRound]) {
        var matches = T.rounds[T.currentRound];
        var rc = el("div", "admin-card");
        rc.appendChild(el("p", "section-label", "Round " + T.currentRound + " matches"));
        Object.keys(matches).sort(function (a, b) {
          var ta = matches[a].table, tb = matches[b].table;
          if (ta == null) return 1; if (tb == null) return -1; return ta - tb;
        }).forEach(function (mid) {
          var m = matches[mid];
          var row = el("div", "match-row");
          row.appendChild(el("span", "tnum", m.table == null ? "Bye" : ("T" + m.table)));
          var who = el("span", "who");
          if (m.p2 == null) { who.textContent = nameOf(T, m.p1) + " (bye)"; }
          else {
            who.appendChild(el("b", null, nameOf(T, m.p1)));
            who.appendChild(document.createTextNode("  vs  "));
            who.appendChild(el("b", null, nameOf(T, m.p2)));
          }
          row.appendChild(who);
          if (m.p2 != null) {
            var seg = el("div", "seg");
            [["1", "p1"], ["D", "draw"], ["2", "p2"]].forEach(function (opt) {
              var b = el("button", "segbtn" + (m.winner === opt[1] ? " on" : ""), opt[0]);
              b.addEventListener("click", function () { setResult(T.currentRound, mid, opt[1]); });
              seg.appendChild(b);
            });
            row.appendChild(seg);
          } else { row.appendChild(el("span", "byeflag", "auto-win")); }
          rc.appendChild(row);
        });
        var complete = Engine.roundComplete(matches);
        rc.appendChild(el("p", "hint", complete ? "All results in ✓" : "Waiting on results…"));
        if (T.status !== "final") {
          if (complete && T.currentRound < T.totalRounds) {
            var np = el("button", "btn primary", "Pair round " + (T.currentRound + 1)); np.addEventListener("click", pairNext); rc.appendChild(np);
          } else if (complete && T.currentRound >= T.totalRounds) {
            var fin = el("button", "btn primary", "Finish tournament 🏆"); fin.addEventListener("click", finish); rc.appendChild(fin);
          }
        }
        wrap.appendChild(rc);
      } else if (T.status === "running") {
        var pc = el("div", "admin-card");
        var pr = el("button", "btn primary", "Pair round 1"); pr.addEventListener("click", pairNext);
        pc.appendChild(pr); wrap.appendChild(pc);
      }

      var st = Engine.standings(T.players, T.rounds);
      var sc = el("div", "admin-card");
      sc.appendChild(el("p", "section-label", "Standings"));
      var table = el("div", "standings");
      var header = el("div", "srow shead");
      ["#", "Player", "Rec", "Pts", "OMW"].forEach(function (h, i) { header.appendChild(el("span", "c c" + i, h)); });
      table.appendChild(header);
      st.forEach(function (s) {
        var r = el("div", "srow" + (s.dropped ? " dropped" : ""));
        r.appendChild(el("span", "c c0", String(s.rank)));
        r.appendChild(el("span", "c c1", s.name + (s.dropped ? " (dropped)" : "")));
        r.appendChild(el("span", "c c2", s.w + "-" + s.l + "-" + s.d));
        r.appendChild(el("span", "c c3", String(s.points)));
        r.appendChild(el("span", "c c4", (s.omw * 100).toFixed(1)));
        if (T.status !== "final" && !s.dropped) {
          var d = el("button", "dropbtn", "drop");
          d.addEventListener("click", function () { if (confirm("Drop " + s.name + "?")) dropPlayer(s.id); });
          r.appendChild(d);
        }
        table.appendChild(r);
      });
      sc.appendChild(table);
      wrap.appendChild(sc);

      var dz = el("div", "admin-card");
      if (T.status === "final") dz.appendChild(el("p", "hint", "Tournament finished. Start a new one below."));
      var reset = el("button", "btn ghost", T.status === "final" ? "New tournament" : "Reset / cancel tournament");
      reset.addEventListener("click", function () { if (confirm("This clears the current tournament. Continue?")) resetAll(); });
      dz.appendChild(reset);
      wrap.appendChild(dz);

      root.appendChild(wrap);
    }

    load();
  }

  // ---- toast -----------------------------------------------------------
  var toastTimer;
  function showToast(msg) {
    var t = document.getElementById("toast");
    if (!t) return;
    t.textContent = msg; t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("show"); }, 2400);
  }

  // ---- Wall board (swiss-board.html) — rotating pairings ↔ standings ---
  // Read-only TV display for the Swiss tournament (data at /tournament).
  function initBoard() {
    var head = document.getElementById("swHead");
    var body = document.getElementById("swBody");
    var foot = document.getElementById("swFoot");
    var q = new URLSearchParams(location.search);
    var secs = parseInt(q.get("rotate"), 10); if (!secs || secs < 5) secs = 18;
    var views = ["pairings", "standings"], idx = 0;
    var T = null;

    function draw() { BGF.fbGet("tournament").then(function (t) { T = t; render(); }); }

    function render() {
      if (!T || T.status === "setup" || !T.players || !Object.keys(T.players).length) {
        head.innerHTML = ""; head.appendChild(el("div", "sw-title", (T && T.name) || "Swiss Tournament"));
        body.innerHTML = ""; body.appendChild(msg("Tournament starting soon", "Pairings and standings appear here once round 1 is paired."));
        foot.textContent = "Balance Martial Arts & Gaming"; return;
      }
      var view = views[idx];
      var haveRound = T.currentRound && T.rounds && T.rounds[T.currentRound];
      if (view === "pairings" && !haveRound) view = "standings";
      head.innerHTML = "";
      head.appendChild(el("div", "sw-title", T.name || "Swiss Tournament"));
      head.appendChild(el("div", "sw-sub", T.status === "final" ? "Final Standings"
        : (view === "pairings" ? ("Round " + T.currentRound + " Pairings")
        : ("Standings" + (T.currentRound ? " · after round " + T.currentRound : "")))));
      body.innerHTML = "";
      if (view === "pairings") renderPairingsBoard(); else renderStandingsBoard();
      foot.textContent = "Balance Martial Arts & Gaming";
    }

    function renderPairingsBoard() {
      var matches = T.rounds[T.currentRound] || {};
      var keys = Object.keys(matches).sort(function (a, b) {
        var ta = matches[a].table, tb = matches[b].table;
        if (ta == null) return 1; if (tb == null) return -1; return ta - tb;
      });
      var grid = el("div", "sw-pairs");
      keys.forEach(function (k) {
        var m = matches[k], row = el("div", "sw-prow");
        row.appendChild(el("span", "sw-tnum", m.table != null ? ("T" + m.table) : "BYE"));
        var vs = el("div", "sw-vs");
        vs.appendChild(el("span", "sw-pn" + (m.winner === "p1" ? " won" : ""), nameOf(T, m.p1)));
        if (m.p2 != null) {
          vs.appendChild(el("span", "sw-vsx", "vs"));
          vs.appendChild(el("span", "sw-pn" + (m.winner === "p2" ? " won" : ""), nameOf(T, m.p2)));
        } else {
          vs.appendChild(el("span", "sw-vsx", "·"));
          vs.appendChild(el("span", "sw-pn bye", "Bye"));
        }
        row.appendChild(vs);
        grid.appendChild(row);
      });
      body.appendChild(grid);
    }

    function renderStandingsBoard() {
      var st = Engine.standings(T.players, T.rounds || {});
      var list = el("div", "sw-stand");
      var headRow = el("div", "sw-srow head");
      headRow.appendChild(el("span", "sw-rk", "#"));
      headRow.appendChild(el("span", "sw-nm", "Player"));
      headRow.appendChild(el("span", "sw-rec", "Record"));
      headRow.appendChild(el("span", "sw-pt", "Pts"));
      list.appendChild(headRow);
      st.forEach(function (s) {
        var row = el("div", "sw-srow" + (s.rank <= 3 ? " top" : "") + (s.dropped ? " dropped" : ""));
        row.appendChild(el("span", "sw-rk", String(s.rank)));
        row.appendChild(el("span", "sw-nm", s.name + (s.dropped ? " (drop)" : "")));
        row.appendChild(el("span", "sw-rec", s.w + "-" + s.l + (s.d ? "-" + s.d : "")));
        row.appendChild(el("span", "sw-pt", String(s.points)));
        list.appendChild(row);
      });
      body.appendChild(list);
    }

    function msg(t, b) { var c = el("div", "sw-empty"); c.appendChild(el("h2", null, t)); c.appendChild(el("p", null, b)); return c; }

    draw();
    setInterval(draw, 5000);
    setInterval(function () { idx = (idx + 1) % views.length; render(); }, secs * 1000);
  }

  var api = { Engine: Engine, initPlayer: initPlayer, initAdmin: initAdmin, initBoard: initBoard };
  global.BGFT = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;

})(typeof window !== "undefined" ? window : globalThis);
