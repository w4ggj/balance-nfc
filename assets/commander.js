/* ============================================================
   Balance Commander League — engine + pages
   Subsystem of the Balance Gaming FL NFC system. Firebase RTDB
   (shared) + Firebase Auth email-link. Balance branding.

   Data model (RTDB /commander), per the build spec §10:
     league/  meta{name,startDate,weeks,tables[],podSize,status}  scoring{votePoints,questionnairePoints}
     players/{uid}{name,joinedAt}                 // email lives in Firebase Auth, not here
     nights/{nightId}/ status, currentGame, attendance{uid:true},
                       pods/{podNo}{table,members{uid:true}},
                       votes/{game}/{voterUid}{target,reason,ts},
                       questionnaire/{uid}{answers,ts}
   ============================================================ */
(function (global) {
  "use strict";

  // ---- Engine (pure) ---------------------------------------------------
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function shuffle(arr, rnd) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor((rnd ? rnd() : Math.random()) * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function assignPods(uids, tables, podSize, rnd) {
    podSize = podSize || 4; tables = tables || [];
    var players = shuffle(uids, rnd);
    var n = players.length;
    if (n === 0 || tables.length === 0) return [];
    var lo = Math.ceil(n / 5), hi = Math.max(1, Math.floor(n / 3));
    var numPods = clamp(Math.max(1, Math.round(n / podSize)), lo, hi);
    numPods = Math.min(numPods, tables.length) || 1;
    var pods = [];
    for (var i = 0; i < numPods; i++) pods.push({ podNo: i + 1, table: tables[i], members: [] });
    players.forEach(function (uid, idx) { pods[idx % numPods].members.push(uid); });
    return pods;
  }

  var DEFAULT_SCORING = { votePoints: 1, questionnairePoints: 1 };

  function standings(commander) {
    commander = commander || {};
    var players = commander.players || {}, nights = commander.nights || {};
    var sc = (commander.league && commander.league.scoring) || DEFAULT_SCORING;
    var vp = sc.votePoints != null ? sc.votePoints : 1, qp = sc.questionnairePoints != null ? sc.questionnairePoints : 1;
    var stat = {};
    function row(uid) {
      if (!stat[uid]) stat[uid] = { uid: uid, name: (players[uid] && players[uid].name) || "Player",
        points: 0, votes: 0, questionnaires: 0, reasons: {}, nights: {} };
      return stat[uid];
    }
    Object.keys(players).forEach(row);
    Object.keys(nights).forEach(function (nid) {
      var night = nights[nid] || {}, games = night.votes || {};
      Object.keys(games).forEach(function (g) {
        var byVoter = games[g] || {};
        Object.keys(byVoter).forEach(function (voter) {
          var v = byVoter[voter];
          if (!v || v.target == null || v.reason === "abstain") return;
          var r = row(v.target);
          r.points += vp; r.votes += 1; r.nights[nid] = (r.nights[nid] || 0) + vp;
          var reason = v.reason || "vote"; r.reasons[reason] = (r.reasons[reason] || 0) + 1;
        });
      });
      var q = night.questionnaire || {};
      Object.keys(q).forEach(function (uid) {
        var r = row(uid); r.points += qp; r.questionnaires += 1; r.nights[nid] = (r.nights[nid] || 0) + qp;
      });
    });
    var arr = Object.keys(stat).map(function (k) { return stat[k]; });
    arr.sort(function (a, b) { return b.points !== a.points ? b.points - a.points : a.name.localeCompare(b.name); });
    arr.forEach(function (s, i) { s.rank = i + 1; });
    return arr;
  }

  function playerStats(commander, uid) {
    var all = standings(commander), me = null;
    for (var i = 0; i < all.length; i++) if (all[i].uid === uid) { me = all[i]; break; }
    if (!me) me = { uid: uid, name: "Player", points: 0, votes: 0, questionnaires: 0, reasons: {}, nights: {}, rank: null };
    var attendance = [], nights = (commander && commander.nights) || {};
    Object.keys(nights).sort().forEach(function (nid) {
      var att = (nights[nid] && nights[nid].attendance) || {}, pods = (nights[nid] && nights[nid].pods) || {};
      var here = !!att[uid];
      if (!here) Object.keys(pods).forEach(function (pn) { if (pods[pn].members && pods[pn].members[uid]) here = true; });
      if (here) attendance.push(nid);
    });
    me.attendance = attendance; return me;
  }

  var Engine = { assignPods: assignPods, standings: standings, playerStats: playerStats, DEFAULT_SCORING: DEFAULT_SCORING };

  // ============================================================
  // App layer (browser)
  // ============================================================
  var FIREBASE_CONFIG = {
    apiKey: "AIzaSyClGbR2no18qvLfwbb2lasFyzKth-We1C0",
    authDomain: "balance-nfc.firebaseapp.com",
    databaseURL: "https://balance-nfc-default-rtdb.firebaseio.com",
    projectId: "balance-nfc",
    storageBucket: "balance-nfc.firebasestorage.app",
    messagingSenderId: "21159440638",
    appId: "1:21159440638:web:8d10d2b734710ba50df5af"
  };

  var REASONS = ["Nicest player", "Funniest play", "Winner", "Best deck", "Good sport"];
  var QUESTIONS = [
    { key: "bathroom", label: "Bathroom cleanliness" },
    { key: "store", label: "Store cleanliness" },
    { key: "staff", label: "Staff friendliness" },
    { key: "community", label: "Community friendliness" },
    { key: "rules", label: "Fair play / rules followed" }
  ];

  function el(t, c, x) { var e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; }
  function todayId(d) { d = d || new Date(); var p = function (n) { return n < 10 ? "0" + n : "" + n; }; return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()); }
  function nameOf(c, uid) { return (c.players && c.players[uid] && c.players[uid].name) || "Player"; }
  function findPod(night, uid) {
    var pods = (night && night.pods) || {};
    var found = null;
    Object.keys(pods).forEach(function (pn) { if (pods[pn].members && pods[pn].members[uid]) found = { podNo: +pn, table: pods[pn].table, members: Object.keys(pods[pn].members) }; });
    return found;
  }
  function qp(name) { return new URLSearchParams(location.search).get(name); }

  // ---- TV leaderboard (commander-board.html) — read-only via REST ------
  function initBoard() {
    var root = document.getElementById("clBoard");
    function draw() { BGF.fbGet("commander").then(render); }
    function render(c) {
      c = c || {};
      root.innerHTML = "";
      var name = (c.league && c.league.meta && c.league.meta.name) || "Commander League";
      var today = todayId();
      var night = (c.nights || {})[today];
      var pods = night && night.pods;
      var live = night && (night.status === "checkin" || /^game\d+$/.test(night.status));
      // During a live night with pods assigned, the game-room TV shows the
      // seating — each pod's table and who's in it. Otherwise it shows the
      // season leaderboard.
      if (live && pods && Object.keys(pods).length) renderPods(c, name, night, pods);
      else renderStandings(c, name);
    }

    function bhead(name, sub) {
      var head = el("div", "cl-bhead");
      head.appendChild(el("div", "cl-btitle", name));
      head.appendChild(el("div", "cl-bsub", sub));
      root.appendChild(head);
    }

    function renderPods(c, name, night, pods) {
      var sub = /^game(\d+)$/.test(night.status)
        ? ("Game " + (night.currentGame || night.status.match(/\d+/)[0]) + " · Pods")
        : "Tonight's Pods";
      bhead(name, sub);
      var grid = el("div", "cl-podgrid");
      Object.keys(pods).sort(function (a, b) { return a - b; }).forEach(function (pn) {
        var p = pods[pn] || {};
        var card = el("div", "cl-podcard");
        var top = el("div", "cl-podcardhead");
        top.appendChild(el("span", "cl-podcardt", "Table " + p.table));
        top.appendChild(el("span", "cl-podcardp", "Pod " + pn));
        card.appendChild(top);
        var names = el("div", "cl-podnames");
        Object.keys(p.members || {}).forEach(function (u) { names.appendChild(el("div", "cl-podnm", nameOf(c, u))); });
        card.appendChild(names);
        grid.appendChild(card);
      });
      root.appendChild(grid);
    }

    function renderStandings(c, name) {
      bhead(name, "Season Standings");
      var st = Engine.standings(c);
      if (!st.length) { root.appendChild(clMsg("No players yet", "Standings appear as players join and vote.")); return; }
      var list = el("div", "cl-lb");
      st.forEach(function (s) {
        var row = el("div", "cl-lbrow" + (s.rank <= 3 ? " top" : ""));
        row.appendChild(el("span", "cl-rk", String(s.rank)));
        row.appendChild(el("span", "cl-nm", s.name));
        row.appendChild(el("span", "cl-pts", String(s.points)));
        list.appendChild(row);
      });
      root.appendChild(list);
    }

    draw(); setInterval(draw, 4000);
  }
  function clMsg(t, b) { var c = el("div", "cl-empty"); c.appendChild(el("h2", null, t)); c.appendChild(el("p", null, b)); return c; }

  // ---- Staff admin (commander-admin.html) — REST, open writes ----------
  function initAdmin() {
    var root = document.getElementById("clAdmin");
    var C = null;
    function load() { return BGF.fbGet("commander").then(function (c) { C = c || {}; render(); }); }
    function set(path, val) { return BGF.fbSet("commander/" + path, val); }
    // Surface write failures instead of silently doing nothing. A denied write
    // (HTTP 401) almost always means the Firebase rules don't allow the staff
    // console to write /commander — see the ruleset in the setup notes.
    function oops(e) {
      var msg = (e && e.message) || "Couldn't save";
      if (/401/.test(msg)) msg = "Firebase blocked the write — update the /commander database rules (staff console needs write access).";
      showToast(msg);
      if (window.console) console.error("[commander-admin]", e);
    }
    function commit(p) { return p.then(load).catch(oops); }

    function render() {
      root.innerHTML = "";
      if (!C.league || !C.league.meta) return renderCreate();
      renderNight();
    }

    function renderCreate() {
      var card = el("div", "cl-card");
      card.appendChild(el("p", "section-label", "Create the league"));
      var name = field("League name", "Friday Commander League");
      var weeks = field("Weeks", "8"); weeks.querySelector("input").type = "number";
      var start = field("Start date", todayId()); start.querySelector("input").type = "date";
      card.appendChild(name); card.appendChild(weeks); card.appendChild(start);
      card.appendChild(el("p", "hint", "Uses tables 1–8, pods of 4. Scoring: vote +1, questionnaire +1."));
      var btn = el("button", "btn primary", "Create league");
      btn.addEventListener("click", function () {
        var meta = { name: name.querySelector("input").value || "Commander League",
          startDate: start.querySelector("input").value || todayId(),
          weeks: parseInt(weeks.querySelector("input").value, 10) || 8,
          tables: [1, 2, 3, 4, 5, 6, 7, 8], podSize: 4, status: "active" };
        commit(Promise.all([set("league/meta", meta), set("league/scoring", DEFAULT_SCORING)]));
      });
      card.appendChild(btn); root.appendChild(card);
    }

    function renderNight() {
      var meta = C.league.meta, today = todayId();
      var nights = C.nights || {}, night = nights[today];

      var head = el("div", "cl-card");
      head.appendChild(el("p", "section-label", meta.name));
      head.appendChild(el("p", "hint", "Tables " + meta.tables[0] + "–" + meta.tables[meta.tables.length - 1] + " · pods of " + meta.podSize + " · " + meta.weeks + " weeks"));
      root.appendChild(head);

      if (!night) {
        var sc = el("div", "cl-card");
        sc.appendChild(el("p", "hint", "No session started for tonight (" + today + ")."));
        var start = el("button", "btn primary", "Start tonight's session");
        start.addEventListener("click", function () {
          commit(Promise.all([set("nights/" + today + "/status", "checkin"), set("nights/" + today + "/currentGame", 0)]));
        });
        sc.appendChild(start); root.appendChild(sc);
        renderStandings(); renderDanger(); return;
      }

      // status + phase controls
      var sc2 = el("div", "cl-card");
      sc2.appendChild(el("p", "section-label", "Tonight — " + today));
      var att = night.attendance ? Object.keys(night.attendance).length : 0;
      var pods = night.pods || {};
      sc2.appendChild(el("p", "hint", "Phase: " + phaseLabel(night) + " · " + att + " checked in · " + Object.keys(pods).length + " pods"));

      var actions = el("div", "cl-actions");
      if (night.status === "checkin") {
        var assign = el("button", "btn game", (Object.keys(pods).length ? "Re-assign pods" : "Assign pods") + " (" + att + ")");
        assign.addEventListener("click", function () {
          var uids = Object.keys(night.attendance || {});
          if (uids.length < 2) { showToast("Need at least 2 checked-in players"); return; }
          var assigned = Engine.assignPods(uids, meta.tables, meta.podSize);
          var podsObj = {};
          assigned.forEach(function (p) { var m = {}; p.members.forEach(function (u) { m[u] = true; }); podsObj[p.podNo] = { table: p.table, members: m }; });
          commit(set("nights/" + today + "/pods", podsObj));
        });
        actions.appendChild(assign);
        if (Object.keys(pods).length) {
          var toG1 = el("button", "btn primary", "Start Game 1");
          toG1.addEventListener("click", function () { commit(Promise.all([set("nights/" + today + "/status", "game1"), set("nights/" + today + "/currentGame", 1)])); });
          actions.appendChild(toG1);
        }
      } else if (/^game(\d+)$/.test(night.status)) {
        var g = +night.status.match(/^game(\d+)$/)[1];
        var next = el("button", "btn primary", "Start Game " + (g + 1));
        next.addEventListener("click", function () { commit(Promise.all([set("nights/" + today + "/status", "game" + (g + 1)), set("nights/" + today + "/currentGame", g + 1)])); });
        actions.appendChild(next);
        var toQ = el("button", "btn game", "End games → Questionnaire");
        toQ.addEventListener("click", function () { commit(set("nights/" + today + "/status", "questionnaire")); });
        actions.appendChild(toQ);
      } else if (night.status === "questionnaire") {
        var close = el("button", "btn primary", "Close the night");
        close.addEventListener("click", function () { commit(set("nights/" + today + "/status", "closed")); });
        actions.appendChild(close);
      } else if (night.status === "closed") {
        sc2.appendChild(el("p", "hint", "Session closed. Standings carry to the season."));
      }
      sc2.appendChild(actions);
      root.appendChild(sc2);

      if (night.status !== "closed") renderRoster(night);

      // pods list
      if (Object.keys(pods).length) {
        var pc = el("div", "cl-card");
        pc.appendChild(el("p", "section-label", "Pods"));
        Object.keys(pods).sort(function (a, b) { return a - b; }).forEach(function (pn) {
          var p = pods[pn], row = el("div", "cl-podrow");
          row.appendChild(el("span", "cl-podt", "T" + p.table));
          var names = Object.keys(p.members || {}).map(function (u) { return nameOf(C, u); }).join(", ");
          row.appendChild(el("span", "cl-podm", names));
          pc.appendChild(row);
        });
        root.appendChild(pc);
      }

      renderFeedback(night); renderStandings(); renderDanger();
    }

    // Tonight's roster — everyone checked in, plus a way to add a phone-less
    // walk-in and to remove anyone who changed their mind (before pods).
    //   • Walk-ins get a synthetic "walk_" uid so the Firebase rules can tell
    //     staff-added players apart from Auth players. Removing a walk-in deletes
    //     the record (they're a single-night identity).
    //   • Removing a phone player only drops them from tonight's attendance —
    //     their season account and points are untouched.
    function renderRoster(night) {
      var today = todayId();
      var checkin = night.status === "checkin";
      var card = el("div", "cl-card");
      card.appendChild(el("p", "section-label", "Tonight's roster"));
      card.appendChild(el("p", "hint", checkin
        ? "Everyone checked in for tonight. Add a phone-less walk-in, or drop anyone who changed their mind before you assign pods."
        : "Drop a player from tonight if they leave mid-night — it pulls them from their pod too. Season stats stay intact."));

      // Add a walk-in — only while checking in (before pods are assigned).
      if (checkin) {
        var add = el("div"); add.style.display = "flex"; add.style.gap = "8px"; add.style.margin = "10px 0";
        var i = el("input", "field"); i.placeholder = "Add a walk-in (no phone) — name"; i.setAttribute("maxlength", "40"); i.style.margin = "0";
        var btn = el("button", "btn game", "Add"); btn.style.flex = "0 0 auto";
        function doAdd() {
          var name = (i.value || "").trim();
          if (!name) { i.focus(); return; }
          var uid = "walk_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
          i.value = "";
          commit(Promise.all([
            set("players/" + uid, { name: name, joinedAt: Date.now(), walkIn: true }),
            set("nights/" + today + "/attendance/" + uid, true)
          ]));
        }
        btn.addEventListener("click", doAdd);
        i.addEventListener("keydown", function (e) { if (e.key === "Enter") doAdd(); });
        add.appendChild(i); add.appendChild(btn); card.appendChild(add);
      }

      // Drop a player from THIS session: clear their check-in and pull them out
      // of any pod tonight.
      //   • Phone player → flag them "dropped" for the night. The Firebase rules
      //     then reject any re-check-in, so their still-open phone can't add them
      //     back. Season account and stats are untouched, and it's reversible.
      //   • Walk-in (single-night identity) → delete the record outright.
      function drop(u, walk) {
        var updates = {};
        updates["nights/" + today + "/attendance/" + u] = null;
        var pods = night.pods || {};
        Object.keys(pods).forEach(function (pn) {
          if (pods[pn].members && pods[pn].members[u]) updates["nights/" + today + "/pods/" + pn + "/members/" + u] = null;
        });
        if (walk) updates["players/" + u] = null;
        else updates["nights/" + today + "/dropped/" + u] = true;
        commit(BGF.fbUpdate("commander", updates));
      }
      // Undo a phone-player drop: clear the flag first, then re-check them in.
      // Two steps on purpose — the rules block the attendance write until the
      // dropped flag is actually gone.
      function undrop(u) {
        commit(set("nights/" + today + "/dropped/" + u, null)
          .then(function () { return set("nights/" + today + "/attendance/" + u, true); }));
      }

      var att = night.attendance || {};
      var uids = Object.keys(att);
      if (!uids.length) card.appendChild(el("p", "hint", "No one checked in yet."));
      else {
        uids.sort(function (a, b) { return nameOf(C, a).localeCompare(nameOf(C, b)); });
        uids.forEach(function (u) {
          var walk = u.indexOf("walk_") === 0;
          var row = el("div", "cl-frow");
          var nm = el("span", null, nameOf(C, u));
          if (walk) { var tag = el("span", null, " · walk-in"); tag.style.cssText = "opacity:.55;font-size:.85em"; nm.appendChild(tag); }
          row.appendChild(nm);
          var rm = el("button", "cl-choice sm", "Drop");
          rm.addEventListener("click", function () { drop(u, walk); });
          row.appendChild(rm); card.appendChild(row);
        });
        card.appendChild(el("p", "hint", uids.length + " in tonight"));
      }

      // Dropped phone players — offer an undo in case it was a mistake.
      var dropped = Object.keys(night.dropped || {});
      if (dropped.length) {
        card.appendChild(el("p", "section-label", "Dropped tonight"));
        dropped.sort(function (a, b) { return nameOf(C, a).localeCompare(nameOf(C, b)); });
        dropped.forEach(function (u) {
          var row = el("div", "cl-frow");
          var nm = el("span", null, nameOf(C, u)); nm.style.opacity = ".6";
          row.appendChild(nm);
          var un = el("button", "cl-choice sm", "Add back");
          un.addEventListener("click", function () { undrop(u); });
          row.appendChild(un); card.appendChild(row);
        });
      }
      root.appendChild(card);
    }

    function renderFeedback(night) {
      var q = night.questionnaire || {}, uids = Object.keys(q);
      if (!uids.length) return;
      var card = el("div", "cl-card");
      card.appendChild(el("p", "section-label", "Feedback (" + uids.length + " responses)"));
      QUESTIONS.forEach(function (qq) {
        var sum = 0, cnt = 0;
        uids.forEach(function (u) { var a = q[u].answers || {}; if (a[qq.key] != null) { sum += Number(a[qq.key]); cnt++; } });
        var avg = cnt ? (sum / cnt).toFixed(1) : "—";
        var row = el("div", "cl-frow");
        row.appendChild(el("span", null, qq.label));
        row.appendChild(el("b", null, avg + " / 5"));
        card.appendChild(row);
      });
      var comments = uids.map(function (u) { return q[u].answers && q[u].answers.comment; }).filter(Boolean);
      if (comments.length) { card.appendChild(el("p", "section-label", "Comments")); comments.forEach(function (c) { card.appendChild(el("p", "cl-comment", "“" + c + "”")); }); }
      root.appendChild(card);
    }

    function renderStandings() {
      var st = Engine.standings(C);
      var card = el("div", "cl-card");
      card.appendChild(el("p", "section-label", "Season standings"));
      if (!st.length) { card.appendChild(el("p", "hint", "No points yet.")); root.appendChild(card); return; }
      var tbl = el("div", "cl-slist");
      st.forEach(function (s) {
        var row = el("div", "cl-srow");
        row.appendChild(el("span", "cl-rk", String(s.rank)));
        row.appendChild(el("span", "cl-nm", s.name));
        row.appendChild(el("span", "cl-pts", String(s.points)));
        tbl.appendChild(row);
      });
      card.appendChild(tbl); root.appendChild(card);
    }

    function renderDanger() {
      var card = el("div", "cl-card");
      var reset = el("button", "btn ghost", "End league / reset");
      reset.addEventListener("click", function () { if (confirm("This clears the whole Commander League (players, nights, standings). Continue?")) commit(Promise.all([set("league", null), set("nights", null), set("players", null)])); });
      card.appendChild(reset); root.appendChild(card);
    }

    function field(label, ph) {
      var w = el("div", "cl-field"); w.appendChild(el("label", "cl-flabel", label));
      var i = el("input", "field"); i.placeholder = ph || ""; if (ph) i.value = ph; w.appendChild(i); return w;
    }
    function phaseLabel(n) {
      if (n.status === "checkin") return "Check-in";
      if (/^game/.test(n.status)) return "Game " + n.currentGame;
      if (n.status === "questionnaire") return "Questionnaire";
      return "Closed";
    }
    load();
  }

  // ---- Player page (commander.html) — Firebase Auth email-link ---------
  function initPlayer() {
    var root = document.getElementById("clPlayer");
    if (typeof firebase === "undefined") { root.appendChild(clMsg("Loading…", "One moment.")); return; }
    firebase.initializeApp(FIREBASE_CONFIG);
    var auth = firebase.auth(), db = firebase.database();
    var LS_EMAIL = "cl_email", LS_TBL = "cl_tbl";
    var autoChecked = {}; // auto-check-in once per night, so a staff removal isn't instantly undone
    var tbl = qp("tbl"); if (tbl) localStorage.setItem(LS_TBL, tbl);

    // Complete an email-link sign-in if we arrived from the emailed link.
    if (auth.isSignInWithEmailLink(location.href)) {
      var email = localStorage.getItem(LS_EMAIL) || window.prompt("Confirm the email you signed up with:");
      if (email) {
        auth.signInWithEmailLink(email, location.href).then(function () {
          localStorage.removeItem(LS_EMAIL);
          var keepTbl = localStorage.getItem(LS_TBL);
          history.replaceState({}, "", "commander.html" + (keepTbl ? "?tbl=" + keepTbl : ""));
        }).catch(function (e) { root.innerHTML = ""; root.appendChild(clMsg("Sign-in link problem", e.message)); });
      }
    }

    auth.onAuthStateChanged(function (user) {
      if (!user) { renderAuth(); return; }
      ensurePlayer(user).then(function () { watchNight(user); });
    });

    function ensurePlayer(user) {
      var ref = db.ref("commander/players/" + user.uid);
      return ref.get().then(function (snap) {
        var pendingName = localStorage.getItem("cl_name");
        if (!snap.exists()) return ref.set({ name: pendingName || (user.email ? user.email.split("@")[0] : "Player"), joinedAt: Date.now() });
        if (pendingName && snap.val().name !== pendingName) return ref.child("name").set(pendingName);
      });
    }

    function renderAuth() {
      root.innerHTML = "";
      var sent = localStorage.getItem(LS_EMAIL);
      var card = el("div", "cl-card");
      if (sent) {
        card.appendChild(el("div", "cl-h", "Check your email"));
        card.appendChild(el("p", "cl-sub", "We sent a sign-in link to " + sent + ". Open it on this phone to join the league."));
        var again = el("button", "btn ghost", "Use a different email");
        again.addEventListener("click", function () { localStorage.removeItem(LS_EMAIL); renderAuth(); });
        card.appendChild(again); root.appendChild(card); return;
      }
      card.appendChild(el("div", "cl-h", "Join the Commander League"));
      card.appendChild(el("p", "cl-sub", "One-time sign-in on this phone. Your stats stay private to you."));
      var nm = el("input", "field"); nm.placeholder = "Your name"; nm.setAttribute("maxlength", "40");
      var em = el("input", "field"); em.placeholder = "Email"; em.type = "email"; em.style.marginTop = "8px";
      card.appendChild(nm); card.appendChild(em);
      var btn = el("button", "btn primary", "Email me a sign-in link");
      btn.style.marginTop = "10px";
      btn.addEventListener("click", function () {
        var name = (nm.value || "").trim(), email = (em.value || "").trim();
        if (!name) { nm.focus(); return; }
        if (!/.+@.+\..+/.test(email)) { em.focus(); return; }
        localStorage.setItem("cl_name", name);
        btn.disabled = true; btn.textContent = "Sending…";
        var url = location.origin + location.pathname + (tbl ? "?tbl=" + tbl : "");
        auth.sendSignInLinkToEmail(email, { url: url, handleCodeInApp: true }).then(function () {
          localStorage.setItem(LS_EMAIL, email); renderAuth();
        }).catch(function (e) { btn.disabled = false; btn.textContent = "Email me a sign-in link"; showToast(e.message); });
      });
      card.appendChild(btn); root.appendChild(card);
    }

    function watchNight(user) {
      db.ref("commander").on("value", function (snap) { renderNight(user, snap.val() || {}); });
    }

    function renderNight(user, C) {
      root.innerHTML = "";
      var uid = user.uid, today = todayId();
      var league = C.league && C.league.meta;
      var night = (C.nights || {})[today];

      if (!league || league.status !== "active" || !night) {
        root.appendChild(hello(C, uid));
        root.appendChild(clCard("No league night right now", "You're signed in. Your match and voting show here on league night."));
        root.appendChild(statsLink(user, C));
        return;
      }

      // If the organizer dropped you from tonight, stop here — don't check back
      // in (the rules would reject it anyway). Your season stats are unaffected.
      if (night.dropped && night.dropped[uid]) {
        root.appendChild(hello(C, uid));
        root.appendChild(clCard("Checked out for tonight", "The organizer removed you from tonight's session. See a staff member if that wasn't expected."));
        root.appendChild(statsLink(user, C));
        return;
      }

      // check in for tonight — only once per night per device.
      if (!autoChecked[today]) {
        autoChecked[today] = true;
        if (!night.attendance || !night.attendance[uid]) db.ref("commander/nights/" + today + "/attendance/" + uid).set(true);
      }

      var pod = findPod(night, uid);
      root.appendChild(hello(C, uid));

      if (night.status === "checkin") {
        if (pod) root.appendChild(podCard(C, pod, "You're seated — waiting for Game 1 to start."));
        else root.appendChild(clCard("You're checked in ✅", "Hang tight — the organizer is assigning pods."));
      } else if (/^game(\d+)$/.test(night.status)) {
        if (!pod) { root.appendChild(clCard("Not seated this round", "Check with the organizer.")); }
        else {
          var g = night.currentGame || 1;
          var voted = night.votes && night.votes[g] && night.votes[g][uid];
          root.appendChild(podCard(C, pod, "Game " + g + " · Table " + pod.table));
          if (voted) root.appendChild(votedCard(C, voted));
          else root.appendChild(voteCard(user, C, today, g, pod));
        }
      } else if (night.status === "questionnaire") {
        var done = night.questionnaire && night.questionnaire[uid];
        if (done) root.appendChild(statsCard(user, C));
        else root.appendChild(questionnaireCard(user, today));
      } else { // closed
        root.appendChild(statsCard(user, C));
      }
      root.appendChild(statsLink(user, C));
    }

    function hello(C, uid) { var c = el("div", "cl-hello"); c.appendChild(el("span", null, "Signed in as ")); c.appendChild(el("b", null, nameOf(C, uid))); return c; }
    function podCard(C, pod, sub) {
      var c = el("div", "cl-card");
      c.appendChild(el("div", "cl-podbadge", "Table " + pod.table + " · Pod " + pod.podNo));
      c.appendChild(el("p", "cl-sub", sub));
      var ul = el("div", "cl-pod");
      pod.members.forEach(function (u) { ul.appendChild(el("span", "cl-podname", nameOf(C, u))); });
      c.appendChild(ul); return c;
    }
    function voteCard(user, C, today, g, pod) {
      var c = el("div", "cl-card");
      c.appendChild(el("div", "cl-h", "Vote — Game " + g));
      c.appendChild(el("p", "cl-sub", "Pick one player (not yourself) and a reason, or abstain."));
      var chosen = { target: null, reason: null };
      var who = el("div", "cl-choices");
      pod.members.filter(function (u) { return u !== user.uid; }).forEach(function (u) {
        var b = el("button", "cl-choice", nameOf(C, u));
        b.addEventListener("click", function () { chosen.target = u; mark(who, b); });
        who.appendChild(b);
      });
      var ab = el("button", "cl-choice abstain", "Abstain");
      ab.addEventListener("click", function () { chosen.target = "__abstain__"; mark(who, ab); });
      who.appendChild(ab);
      c.appendChild(who);
      c.appendChild(el("p", "cl-sub", "Reason"));
      var rs = el("div", "cl-choices");
      REASONS.forEach(function (r) { var b = el("button", "cl-choice sm", r); b.addEventListener("click", function () { chosen.reason = r; mark(rs, b); }); rs.appendChild(b); });
      c.appendChild(rs);
      var submit = el("button", "btn primary", "Submit vote"); submit.style.marginTop = "12px";
      submit.addEventListener("click", function () {
        if (!chosen.target) { showToast("Pick a player or abstain"); return; }
        var abstain = chosen.target === "__abstain__";
        if (!abstain && !chosen.reason) { showToast("Pick a reason"); return; }
        submit.disabled = true;
        var payload = { target: abstain ? null : chosen.target, reason: abstain ? "abstain" : chosen.reason, ts: Date.now() };
        db.ref("commander/nights/" + today + "/votes/" + g + "/" + user.uid).set(payload)
          .catch(function (e) { submit.disabled = false; showToast("Couldn't save your vote"); });
      });
      c.appendChild(submit); return c;
    }
    function mark(group, btn) { Array.prototype.forEach.call(group.children, function (b) { b.classList.remove("on"); }); btn.classList.add("on"); }
    function votedCard(C, v) {
      var c = el("div", "cl-card");
      c.appendChild(el("div", "cl-h", "Vote recorded ✅"));
      c.appendChild(el("p", "cl-sub", v.reason === "abstain" ? "You abstained this game." : "You voted " + nameOf(C, v.target) + " — " + v.reason + "."));
      c.appendChild(el("p", "cl-sub", "Waiting for the next game…"));
      return c;
    }
    function questionnaireCard(user, today) {
      var c = el("div", "cl-card");
      c.appendChild(el("div", "cl-h", "Quick feedback (+1 point)"));
      c.appendChild(el("p", "cl-sub", "Rate tonight 1–5. Takes 15 seconds."));
      var answers = {};
      QUESTIONS.forEach(function (q) {
        var row = el("div", "cl-q"); row.appendChild(el("div", "cl-qlabel", q.label));
        var scale = el("div", "cl-scale");
        [1, 2, 3, 4, 5].forEach(function (n) {
          var b = el("button", "cl-dot", String(n));
          b.addEventListener("click", function () { answers[q.key] = n; Array.prototype.forEach.call(scale.children, function (x) { x.classList.remove("on"); }); b.classList.add("on"); });
          scale.appendChild(b);
        });
        row.appendChild(scale); c.appendChild(row);
      });
      var comment = el("textarea", "field area"); comment.placeholder = "Anything else? (optional)";
      c.appendChild(comment);
      var submit = el("button", "btn primary", "Submit & finish"); submit.style.marginTop = "10px";
      submit.addEventListener("click", function () {
        if (Object.keys(answers).length < QUESTIONS.length) { showToast("Please rate all " + QUESTIONS.length); return; }
        if ((comment.value || "").trim()) answers.comment = comment.value.trim();
        submit.disabled = true;
        db.ref("commander/nights/" + today + "/questionnaire/" + user.uid).set({ answers: answers, ts: Date.now() })
          .catch(function () { submit.disabled = false; showToast("Couldn't submit"); });
      });
      c.appendChild(submit); return c;
    }
    function statsLink(user, C) {
      var a = el("button", "btn ghost", "My stats"); a.style.marginTop = "12px";
      a.addEventListener("click", function () { root.innerHTML = ""; root.appendChild(hello(C, user.uid)); root.appendChild(statsCard(user, C)); var back = el("button", "btn ghost", "Back"); back.style.marginTop = "10px"; back.addEventListener("click", function () { watchNight(user); }); root.appendChild(back); });
      return a;
    }
    function statsCard(user, C) {
      var s = Engine.playerStats(C, user.uid);
      var c = el("div", "cl-card");
      c.appendChild(el("div", "cl-h", "Your stats"));
      var big = el("div", "cl-statbig");
      big.appendChild(stat(String(s.points), "points"));
      big.appendChild(stat(s.rank ? "#" + s.rank : "—", "rank"));
      big.appendChild(stat(String(s.attendance.length), "nights"));
      c.appendChild(big);
      var rk = Object.keys(s.reasons);
      if (rk.length) {
        c.appendChild(el("p", "section-label", "Voted for you"));
        var rl = el("div", "cl-reasons");
        rk.sort(function (a, b) { return s.reasons[b] - s.reasons[a]; }).forEach(function (r) {
          var chip = el("span", "cl-reason"); chip.appendChild(el("b", null, String(s.reasons[r]))); chip.appendChild(document.createTextNode(" " + r)); rl.appendChild(chip);
        });
        c.appendChild(rl);
      }
      if (s.attendance.length) c.appendChild(el("p", "cl-sub", "Attended: " + s.attendance.join(", ")));
      var out = el("button", "btn ghost", "Sign out"); out.style.marginTop = "12px";
      out.addEventListener("click", function () {
        // Changed your mind? Signing out also drops you from tonight's roster so
        // you won't be seated in a pod. Your season stats are untouched.
        var today = todayId();
        autoChecked[today] = true;
        db.ref("commander/nights/" + today + "/attendance/" + user.uid).remove()
          .catch(function () {}).then(function () { auth.signOut(); });
      });
      c.appendChild(out);
      return c;
    }
    function stat(v, l) { var d = el("div", "cl-stat"); d.appendChild(el("div", "cl-statv", v)); d.appendChild(el("div", "cl-statl", l)); return d; }
    function clCard(t, b) { var c = el("div", "cl-card"); c.appendChild(el("div", "cl-h", t)); c.appendChild(el("p", "cl-sub", b)); return c; }
  }

  // ---- toast -----------------------------------------------------------
  var toastTimer;
  function showToast(msg) { var t = document.getElementById("toast"); if (!t) return; t.textContent = msg; t.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove("show"); }, 2600); }

  global.BGFCL = { Engine: Engine, FIREBASE_CONFIG: FIREBASE_CONFIG, REASONS: REASONS, QUESTIONS: QUESTIONS,
    initBoard: initBoard, initAdmin: initAdmin, initPlayer: initPlayer };
  if (typeof module !== "undefined" && module.exports) module.exports = global.BGFCL;
})(typeof window !== "undefined" ? window : globalThis);
