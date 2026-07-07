/* ============================================================
   Balance Commander League — engine + pages
   Subsystem of the Balance Gaming FL NFC system. Firebase RTDB
   (shared) + Firebase Auth email-link. Balance branding.

   This file has two parts:
   1. Engine (pure functions) — pod assignment + points tally.
      Testable in Node; no Firebase, no DOM.
   2. Pages (added in later phases) — player flow, board, admin.

   Data model (RTDB /commander), per the build spec §10:
     league/  meta{name,startDate,weeks,tables[],podSize,status}  scoring{votePoints,questionnairePoints}
     players/{uid}{name,email,joinedAt}
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

  // Assign checked-in players into pods across the active tables.
  // Pods trend to `podSize` (default 4) and stay in [3,5] where possible; nobody
  // is left out. Pod count is capped by the number of tables. Pod N → tables[N].
  // Returns [{ podNo, table, members: [uid,...] }].
  function assignPods(uids, tables, podSize, rnd) {
    podSize = podSize || 4;
    tables = tables || [];
    var players = shuffle(uids, rnd);
    var n = players.length;
    if (n === 0 || tables.length === 0) return [];

    // pods in [ceil(n/5), floor(n/3)] so sizes land in 3..5, target ~n/podSize,
    // never more than we have tables for.
    var lo = Math.ceil(n / 5);
    var hi = Math.max(1, Math.floor(n / 3));
    var target = Math.max(1, Math.round(n / podSize));
    var numPods = clamp(target, lo, hi);
    numPods = Math.min(numPods, tables.length);
    if (numPods < 1) numPods = 1;

    var pods = [];
    for (var i = 0; i < numPods; i++) pods.push({ podNo: i + 1, table: tables[i], members: [] });
    // round-robin keeps pod sizes within 1 of each other
    players.forEach(function (uid, idx) { pods[idx % numPods].members.push(uid); });
    return pods;
  }

  // Default scoring; overridden by league.scoring.
  var DEFAULT_SCORING = { votePoints: 1, questionnairePoints: 1 };

  // Tally season standings from the raw logs. Returns sorted array:
  // [{ uid, name, points, votes, questionnaires, reasons:{reason:count}, nights:{nightId:pts} }]
  function standings(commander) {
    commander = commander || {};
    var players = commander.players || {};
    var nights = commander.nights || {};
    var scoring = (commander.league && commander.league.scoring) || DEFAULT_SCORING;
    var vp = scoring.votePoints != null ? scoring.votePoints : 1;
    var qp = scoring.questionnairePoints != null ? scoring.questionnairePoints : 1;

    var stat = {};
    function row(uid) {
      if (!stat[uid]) stat[uid] = {
        uid: uid, name: (players[uid] && players[uid].name) || "Player",
        points: 0, votes: 0, questionnaires: 0, reasons: {}, nights: {}
      };
      return stat[uid];
    }
    // ensure every registered player appears (even at 0)
    Object.keys(players).forEach(row);

    Object.keys(nights).forEach(function (nid) {
      var night = nights[nid] || {};
      var games = night.votes || {};
      Object.keys(games).forEach(function (g) {
        var byVoter = games[g] || {};
        Object.keys(byVoter).forEach(function (voter) {
          var v = byVoter[voter];
          if (!v || v.target == null || v.reason === "abstain") return;
          var r = row(v.target);
          r.points += vp; r.votes += 1;
          r.nights[nid] = (r.nights[nid] || 0) + vp;
          var reason = v.reason || "vote";
          r.reasons[reason] = (r.reasons[reason] || 0) + 1;
        });
      });
      var q = night.questionnaire || {};
      Object.keys(q).forEach(function (uid) {
        var r = row(uid);
        r.points += qp; r.questionnaires += 1;
        r.nights[nid] = (r.nights[nid] || 0) + qp;
      });
    });

    var arr = Object.keys(stat).map(function (k) { return stat[k]; });
    arr.sort(function (a, b) {
      if (b.points !== a.points) return b.points - a.points;
      return a.name.localeCompare(b.name);
    });
    arr.forEach(function (s, i) { s.rank = i + 1; });
    return arr;
  }

  // A single player's detail (points, reasons breakdown, attendance nights).
  function playerStats(commander, uid) {
    var all = standings(commander);
    var me = null;
    for (var i = 0; i < all.length; i++) if (all[i].uid === uid) { me = all[i]; break; }
    if (!me) me = { uid: uid, name: "Player", points: 0, votes: 0, questionnaires: 0, reasons: {}, nights: {}, rank: null };
    // attendance = nights where the player is in a pod or checked in
    var attendance = [];
    var nights = (commander && commander.nights) || {};
    Object.keys(nights).sort().forEach(function (nid) {
      var att = (nights[nid] && nights[nid].attendance) || {};
      var pods = (nights[nid] && nights[nid].pods) || {};
      var here = !!att[uid];
      if (!here) Object.keys(pods).forEach(function (pn) { if (pods[pn].members && pods[pn].members[uid]) here = true; });
      if (here) attendance.push(nid);
    });
    me.attendance = attendance;
    return me;
  }

  var Engine = {
    assignPods: assignPods, standings: standings, playerStats: playerStats,
    DEFAULT_SCORING: DEFAULT_SCORING
  };

  global.BGFCL = { Engine: Engine };
  if (typeof module !== "undefined" && module.exports) module.exports = global.BGFCL;
})(typeof window !== "undefined" ? window : globalThis);
