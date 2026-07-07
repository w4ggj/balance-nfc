/* ============================================================
   Balance Martial Arts & Gaming — Swiss tournament
   - Pure engine (pairings, byes, standings, tiebreakers) — testable in Node
   - Player page logic (scan a table → see match → report winner)
   - Admin console logic (players, rounds, results, standings)

   Data shape stored in Firebase at /tournament:
   {
     status: "setup" | "running" | "final",
     name: "Friday Night Swiss",
     totalRounds: 4,
     currentRound: 0,            // 0 = not paired yet
     nextId: 5,                  // counter for player ids
     players: { p1:{name,dropped}, ... },
     rounds: {
       "1": { m1:{table:1,p1:"p1",p2:"p2",winner:null}, bye:{table:null,p1:"p5",p2:null,winner:"p1"} }
     }
   }
   winner is "p1" | "p2" | "draw" | null
   ============================================================ */
(function (global) {
  "use strict";

  var WIN = 3, DRAW = 1;

  // ---- Engine (pure) ---------------------------------------------------

  function playersArray(players) {
    players = players || {};
    return Object.keys(players).map(function (id) {
      return { id: id, name: players[id].name, dropped: !!players[id].dropped };
    });
  }

  function activePlayers(players) {
    return playersArray(players).filter(function (p) { return !p.dropped; });
  }

  // Standard Swiss round count: ceil(log2(n)), min 1.
  function recommendedRounds(n) {
    if (n <= 2) return 1;
    return Math.max(1, Math.ceil(Math.log2(n)));
  }

  function roundKeys(rounds) {
    return Object.keys(rounds || {}).sort(function (a, b) { return (+a) - (+b); });
  }

  // Per-player record derived from all reported results.
  function computeStats(players, rounds) {
    var stats = {};
    playersArray(players).forEach(function (p) {
      stats[p.id] = { id: p.id, name: p.name, dropped: p.dropped,
        points: 0, w: 0, l: 0, d: 0, byes: 0, played: 0, opponents: [] };
    });
    roundKeys(rounds).forEach(function (rk) {
      var matches = rounds[rk] || {};
      Object.keys(matches).forEach(function (mk) {
        var m = matches[mk];
        var s1 = stats[m.p1];
        if (m.p2 == null) {                       // bye = automatic win
          if (s1) { s1.points += WIN; s1.w += 1; s1.played += 1; s1.byes += 1; }
          return;
        }
        var s2 = stats[m.p2];
        if (!s1 || !s2) return;
        s1.opponents.push(m.p2);                  // opponents faced (for OMW)
        s2.opponents.push(m.p1);
        if (m.winner == null) return;             // not reported yet
        s1.played += 1; s2.played += 1;
        if (m.winner === "p1") { s1.points += WIN; s1.w += 1; s2.l += 1; }
        else if (m.winner === "p2") { s2.points += WIN; s2.w += 1; s1.l += 1; }
        else if (m.winner === "draw") { s1.points += DRAW; s2.points += DRAW; s1.d += 1; s2.d += 1; }
      });
    });
    return stats;
  }

  // Match-win % with the standard 0.33 floor.
  function mwp(s) {
    if (!s || s.played === 0) return 0.33;
    return Math.max(0.33, s.points / (3 * s.played));
  }

  // Standings sorted by points, then Opponents' Match-Win % (OMW).
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
      Object.keys(matches).forEach(function (mk) {
        var m = matches[mk];
        if (m.p2 == null) b[m.p1] = true;
      });
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

  // Backtracking pairing: pair the top player with the nearest-ranked opponent
  // they haven't already played; backtrack when a branch can't complete.
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

  // Produce the matches object for a round. tableCount = number of physical tables.
  function pairRound(players, rounds, roundNumber, tableCount, rnd) {
    tableCount = tableCount || 16;
    var order;
    if (roundNumber <= 1) {
      order = shuffle(activePlayers(players), rnd);
    } else {
      var st = standings(players, rounds);
      var rank = {}; st.forEach(function (s, i) { rank[s.id] = i; });
      order = activePlayers(players).sort(function (a, b) { return rank[a.id] - rank[b.id]; });
    }

    var byePlayer = null;
    if (order.length % 2 === 1) {
      var taken = byesTaken(players, rounds);
      for (var i = order.length - 1; i >= 0; i--) {
        if (!taken[order[i].id]) { byePlayer = order[i]; break; }
      }
      if (!byePlayer) byePlayer = order[order.length - 1];
      order = order.filter(function (p) { return p.id !== byePlayer.id; });
    }

    var opps = opponentsMap(players, rounds);
    var paired = backtrackPair(order, opps);
    if (paired === null) {                         // unavoidable rematch — pair sequentially
      paired = [];
      for (var k = 0; k < order.length; k += 2) paired.push([order[k], order[k + 1]]);
    }

    var matches = {};
    paired.forEach(function (pair, idx) {
      matches["m" + (idx + 1)] = { table: idx + 1, p1: pair[0].id, p2: pair[1].id, winner: null };
    });
    if (byePlayer) matches["bye"] = { table: null, p1: byePlayer.id, p2: null, winner: "p1" };
    return matches;
  }

  // Are all matches in a round decided?
  function roundComplete(matches) {
    if (!matches) return false;
    return Object.keys(matches).every(function (mk) { return matches[mk].winner != null; });
  }

  var Engine = {
    WIN: WIN, DRAW: DRAW,
    playersArray: playersArray, activePlayers: activePlayers,
    recommendedRounds: recommendedRounds, computeStats: computeStats,
    mwp: mwp, standings: standings, opponentsMap: opponentsMap,
    byesTaken: byesTaken, pairRound: pairRound, roundComplete: roundComplete
  };

  // ---- DOM helpers (browser only) --------------------------------------
  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  }
  function nameOf(T, pid) { return (T.players && T.players[pid] && T.players[pid].name) || "—"; }

  // ---- Player page (tournament.html) -----------------------------------
  function initPlayer() {
    var tbl = BGF.getTable();
    var root = document.getElementById("tourPlayer");
    var busy = false;

    function reportBtn(label, val, current, round, mid) {
      var b = el("button", "rbtn" + (current === val ? " sel" : ""), label);
      b.addEventListener("click", function () {
        if (busy) return;
        busy = true;
        b.classList.add("saving");
        BGF.fbSet("tournament/rounds/" + round + "/" + mid + "/winner", val)
          .then(function () { return load(); })
          .catch(function () { showToast("Couldn't save — try again"); })
          .then(function () { busy = false; });
      });
      return b;
    }

    function render(T) {
      root.innerHTML = "";
      if (!T || T.status === "setup" || !T.status) {
        root.appendChild(msgCard("No tournament running", "When a tournament starts, your match will appear here after the first round is paired."));
        return;
      }
      if (T.status === "final") {
        root.appendChild(msgCard("Tournament complete 🏆", "Thanks for playing! Check the final standings with the tournament organizer."));
        return;
      }
      var round = T.currentRound;
      var matches = (T.rounds && T.rounds[round]) || null;
      if (!round || !matches) {
        root.appendChild(msgCard("Round being paired…", "Hang tight — pairings for the next round are on the way. This page updates on its own."));
        return;
      }
      // find the match at THIS table
      var mid = null, m = null;
      Object.keys(matches).forEach(function (k) { if (matches[k].table === tbl) { mid = k; m = matches[k]; } });
      if (!m) {
        root.appendChild(msgCard("No match at this table", "You're not seated here this round. Check with the organizer, or you may have a bye."));
        return;
      }

      var card = el("div", "match-card");
      card.appendChild(el("div", "round-tag", "Round " + round + " · Table " + tbl));
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
        var conf = el("p", "reported-note",
          m.winner === "draw" ? "Recorded: draw" : "Recorded: " + nameOf(T, m.winner === "p1" ? m.p1 : m.p2) + " won");
        card.appendChild(conf);
      }
      root.appendChild(card);
    }

    function msgCard(title, body) {
      var c = el("div", "panel placeholder");
      c.appendChild(el("span", "tag", "Tournament"));
      c.appendChild(el("h2", null, title));
      c.appendChild(el("p", null, body));
      return c;
    }

    function load() {
      return BGF.fbGet("tournament").then(render);
    }

    load();
    setInterval(function () { if (!busy) load(); }, 4000);
  }

  // ---- Admin console (admin.html) --------------------------------------
  function initAdmin() {
    var root = document.getElementById("adminRoot");
    var TABLES = BGF.MAX_TABLES || 16;
    var T = null;          // authoritative tournament object
    var poll = null;
    var savingBanner = document.getElementById("saveState");

    function setSaving(txt) { if (savingBanner) savingBanner.textContent = txt || ""; }

    function fresh() {
      return { status: "setup", name: "", totalRounds: 0, currentRound: 0, nextId: 1, players: {}, rounds: {} };
    }

    function load() {
      return BGF.fbGet("tournament").then(function (data) {
        T = data && data.status ? data : fresh();
        render();
      });
    }

    function startPolling() {
      if (poll) return;
      poll = setInterval(function () {
        // Only refresh live data while running/final so we pick up player-reported results.
        if (!T || T.status === "setup") return;
        BGF.fbGet("tournament").then(function (data) { if (data) { T = data; render(); } });
      }, 3000);
    }

    // ---- mutations ----
    function saveAll() {                    // safe only during setup (no concurrent writers)
      setSaving("Saving…");
      return BGF.fbSet("tournament", T).then(function () { setSaving(""); }).catch(function () { setSaving("Save failed"); });
    }

    function addPlayers(names) {
      names.forEach(function (nm) {
        nm = nm.trim();
        if (!nm) return;
        var id = "p" + T.nextId++;
        T.players[id] = { name: nm, dropped: false };
      });
      saveAll().then(render);
    }
    function removePlayer(id) { delete T.players[id]; saveAll().then(render); }

    function startTournament() {
      var n = Engine.activePlayers(T.players).length;
      if (n < 2) { showToast("Add at least 2 players"); return; }
      T.status = "running";
      T.currentRound = 0;
      T.totalRounds = Engine.recommendedRounds(n);
      T.rounds = {};
      saveAll().then(function () { startPolling(); render(); });
    }

    function pairNext() {
      var next = (T.currentRound || 0) + 1;
      var matches = Engine.pairRound(T.players, T.rounds, next, TABLES);
      var used = Object.keys(matches).filter(function (k) { return matches[k].table != null; }).length;
      if (used > TABLES) { showToast("Too many matches for " + TABLES + " tables"); return; }
      setSaving("Pairing…");
      // path-scoped writes so we never clobber a player-reported result
      BGF.fbSet("tournament/rounds/" + next, matches)
        .then(function () { return BGF.fbSet("tournament/currentRound", next); })
        .then(function () { T.rounds[next] = matches; T.currentRound = next; setSaving(""); startPolling(); render(); })
        .catch(function () { setSaving("Pairing failed"); });
    }

    function setResult(round, mid, val) {
      setSaving("Saving…");
      BGF.fbSet("tournament/rounds/" + round + "/" + mid + "/winner", val)
        .then(function () {
          if (T.rounds[round] && T.rounds[round][mid]) T.rounds[round][mid].winner = val;
          setSaving(""); render();
        }).catch(function () { setSaving("Save failed"); });
    }

    function dropPlayer(id) {
      BGF.fbSet("tournament/players/" + id + "/dropped", true).then(function () {
        if (T.players[id]) T.players[id].dropped = true; render();
      });
    }

    function finish() {
      T.status = "final";
      BGF.fbSet("tournament/status", "final").then(render);
    }

    function resetAll() {
      T = fresh();
      BGF.fbSet("tournament", T).then(render);
    }

    // ---- render ----
    function render() {
      root.innerHTML = "";
      if (!T || T.status === "setup") return renderSetup();
      renderRunning();
    }

    function renderSetup() {
      var list = Engine.playersArray(T.players);
      var wrap = el("div");

      var h = el("div", "admin-card");
      h.appendChild(el("p", "section-label", "New tournament"));
      var nameIn = el("input", "field");
      nameIn.placeholder = "Tournament name (optional)";
      nameIn.value = T.name || "";
      nameIn.addEventListener("change", function () { T.name = nameIn.value; saveAll(); });
      h.appendChild(nameIn);
      wrap.appendChild(h);

      var addCard = el("div", "admin-card");
      addCard.appendChild(el("p", "section-label", "Add players (" + list.length + ")"));
      var ta = el("textarea", "field area");
      ta.placeholder = "Type one name per line, then Add";
      addCard.appendChild(ta);
      var addBtn = el("button", "btn game", "Add players");
      addBtn.addEventListener("click", function () {
        var names = ta.value.split("\n"); ta.value = "";
        addPlayers(names);
      });
      addCard.appendChild(addBtn);

      if (list.length) {
        var ul = el("div", "player-list");
        list.forEach(function (p) {
          var row = el("div", "player-chip");
          row.appendChild(el("span", null, p.name));
          var x = el("button", "x", "✕");
          x.addEventListener("click", function () { removePlayer(p.id); });
          row.appendChild(x);
          ul.appendChild(row);
        });
        addCard.appendChild(ul);
      }
      wrap.appendChild(addCard);

      var startCard = el("div", "admin-card");
      var n = Engine.activePlayers(T.players).length;
      startCard.appendChild(el("p", "hint", n >= 2
        ? (n + " players · " + Engine.recommendedRounds(n) + " Swiss rounds")
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

      // header / status
      var head = el("div", "admin-card");
      head.appendChild(el("p", "section-label", (T.name || "Tournament")));
      var sub = T.status === "final"
        ? "Final standings"
        : (T.currentRound ? ("Round " + T.currentRound + " of " + T.totalRounds) : "Ready to pair round 1");
      head.appendChild(el("p", "hint", sub));
      wrap.appendChild(head);

      // current round matches
      if (T.currentRound && T.rounds[T.currentRound]) {
        var matches = T.rounds[T.currentRound];
        var rc = el("div", "admin-card");
        rc.appendChild(el("p", "section-label", "Round " + T.currentRound + " matches"));
        Object.keys(matches).sort(function (a, b) {
          var ta = matches[a].table, tb = matches[b].table;
          if (ta == null) return 1; if (tb == null) return -1; return ta - tb;
        }).forEach(function (mid) {
          var m = matches[mid];
          var row = el("div", "match-row");
          var lbl = m.table == null ? "Bye" : ("T" + m.table);
          row.appendChild(el("span", "tnum", lbl));
          var who = el("span", "who");
          if (m.p2 == null) {
            who.textContent = nameOf(T, m.p1) + " (bye)";
          } else {
            who.appendChild(el("b" + (m.winner === "p1" ? "" : ""), null, nameOf(T, m.p1)));
            who.appendChild(document.createTextNode("  vs  "));
            who.appendChild(el("b", null, nameOf(T, m.p2)));
          }
          row.appendChild(who);
          if (m.p2 != null) {
            var seg = el("div", "seg");
            [["1", "p1"], ["D", "draw"], ["2", "p2"]].forEach(function (opt) {
              var b = el("button", "segbtn" + (m.winner === opt[1] ? " on" : ""), opt[0]);
              b.title = opt[1];
              b.addEventListener("click", function () { setResult(T.currentRound, mid, opt[1]); });
              seg.appendChild(b);
            });
            row.appendChild(seg);
          } else {
            row.appendChild(el("span", "byeflag", "auto-win"));
          }
          rc.appendChild(row);
        });

        var complete = Engine.roundComplete(matches);
        rc.appendChild(el("p", "hint", complete ? "All results in ✓" : "Waiting on results…"));
        if (T.status !== "final") {
          if (complete && T.currentRound < T.totalRounds) {
            var np = el("button", "btn primary", "Pair round " + (T.currentRound + 1));
            np.addEventListener("click", pairNext); rc.appendChild(np);
          } else if (complete && T.currentRound >= T.totalRounds) {
            var fin = el("button", "btn primary", "Finish tournament 🏆");
            fin.addEventListener("click", finish); rc.appendChild(fin);
          }
        }
        wrap.appendChild(rc);
      } else if (T.status === "running") {
        var pc = el("div", "admin-card");
        var pr = el("button", "btn primary", "Pair round 1");
        pr.addEventListener("click", pairNext);
        pc.appendChild(pr);
        wrap.appendChild(pc);
      }

      // standings
      var st = Engine.standings(T.players, T.rounds);
      var sc = el("div", "admin-card");
      sc.appendChild(el("p", "section-label", "Standings"));
      var table = el("div", "standings");
      var header = el("div", "srow shead");
      ["#", "Player", "Rec", "Pts", "OMW"].forEach(function (h, i) {
        header.appendChild(el("span", "c c" + i, h));
      });
      table.appendChild(header);
      st.forEach(function (s) {
        var r = el("div", "srow" + (s.dropped ? " dropped" : ""));
        r.appendChild(el("span", "c c0", String(s.rank)));
        var nm = el("span", "c c1", s.name + (s.dropped ? " (dropped)" : ""));
        r.appendChild(nm);
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

      // danger / reset
      var dz = el("div", "admin-card");
      if (T.status === "final") {
        dz.appendChild(el("p", "hint", "Tournament finished. Start a new one below."));
      }
      var reset = el("button", "btn ghost", T.status === "final" ? "New tournament" : "Reset / cancel tournament");
      reset.addEventListener("click", function () {
        if (confirm("This clears the current tournament. Continue?")) resetAll();
      });
      dz.appendChild(reset);
      wrap.appendChild(dz);

      root.appendChild(wrap);
    }

    load();
  }

  // ---- toast (shared) --------------------------------------------------
  var toastTimer;
  function showToast(msg) {
    var t = document.getElementById("toast");
    if (!t) return;
    t.textContent = msg; t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("show"); }, 2400);
  }

  // ---- expose ----------------------------------------------------------
  var api = { Engine: Engine, initPlayer: initPlayer, initAdmin: initAdmin };
  global.BGFT = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;

})(typeof window !== "undefined" ? window : globalThis);
