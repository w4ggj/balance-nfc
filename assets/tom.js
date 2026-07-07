/* ============================================================
   TOM live displays — shared logic for pairings / standings / tap view
   Reads the Firebase snapshot at tournaments/{tournamentId}. The snapshot
   shape is the contract (tombridge/sample-snapshot.json) — read from it,
   never assume a different shape. Nothing here writes to Firebase or TOM.
   ============================================================ */
(function (global) {
  "use strict";

  // Physical NFC tag number → TOM table number. Empty = identity (tag N = table N),
  // which is how this store's tags (?tbl=1..16) line up with TOM. Add entries here
  // only if the floor layout ever stops matching TOM's numbering.
  var TAG_TO_TABLE = {};

  var POLL_MS = 2500;              // board refresh cadence
  var LIVE_WINDOW_MS = 12 * 3600 * 1000; // "a tournament is live" if updated within this

  function qp(name) { return new URLSearchParams(location.search).get(name); }
  function h(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function divClass(id) { return (id === "MA" || id === "SR" || id === "JR" || id === "JR_SR") ? id : ""; }
  function accentVar(id) { var c = divClass(id); return c ? ("var(--" + c + ")") : "var(--gold)"; }

  // ---- Snapshot loading ------------------------------------------------
  // ?demo → load the bundled sample offline. ?t=ID → pin a tournament.
  // Otherwise pick the most recently updated tournament under /tournaments.
  var resolvedPath = null;

  function loadLatest() {
    return BGF.fbGet("tournaments").then(function (all) {
      if (!all) return null;
      var bestKey = null, best = null;
      Object.keys(all).forEach(function (k) {
        var t = all[k];
        if (t && t.meta) {
          if (!best || (t.meta.updatedMs || 0) > (best.meta.updatedMs || 0)) { best = t; bestKey = k; }
        }
      });
      if (bestKey) resolvedPath = "tournaments/" + bestKey;
      return best;
    });
  }

  function fetchSnapshot() {
    if (qp("demo") != null) {
      return fetch("tombridge/sample-snapshot.json", { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
    }
    var pin = qp("t");
    if (pin) { resolvedPath = "tournaments/" + pin; return BGF.fbGet(resolvedPath); }
    if (resolvedPath) return BGF.fbGet(resolvedPath);
    return loadLatest();
  }

  function poll(renderFn) {
    var run = function () { fetchSnapshot().then(renderFn); };
    run();
    setInterval(run, POLL_MS);
  }

  // ---- Header / footer -------------------------------------------------
  function fillHeader(hdr, snap, roundText) {
    hdr.innerHTML = "";
    var logo = h("img", "logo"); logo.src = "assets/logo.png"; logo.alt = "Balance Gaming FL";
    hdr.appendChild(logo);
    var ev = h("div", "ev");
    ev.appendChild(h("div", "name", (snap && snap.meta && snap.meta.name) || "Tournament"));
    var mode = [snap && snap.meta && snap.meta.mode, snap && snap.meta && snap.meta.pairingType].filter(Boolean).join(" · ");
    if (mode) ev.appendChild(h("div", "mode", mode));
    hdr.appendChild(ev);
    var rd = h("div", "round");
    var round = snap && snap.meta ? snap.meta.round : "—";
    rd.appendChild(h("div", "r", String(round != null ? round : "—")));
    rd.appendChild(h("div", "rl", roundText || "Round"));
    hdr.appendChild(rd);
  }

  function fillFooter(foot, snap) {
    foot.innerHTML = "";
    var fresh = h("div", "fresh");
    fresh.appendChild(document.createTextNode("Posted "));
    var b = h("b", null, (snap && snap.meta && snap.meta.generatedAt) || "—");
    fresh.appendChild(b);
    foot.appendChild(fresh);
    var live = h("div", "live");
    live.appendChild(h("span", "pulse"));
    live.appendChild(h("span", null, "Auto-updating from TOM"));
    foot.appendChild(live);
  }

  function emptyState(title, body) {
    var e = h("div", "tom-empty");
    e.appendChild(h("h2", null, title));
    e.appendChild(h("p", null, body));
    return e;
  }

  // ---- Records ---------------------------------------------------------
  function recText(rec) { return (rec && (rec.text || ((rec.w != null) ? (rec.w + "/" + rec.l + "/" + rec.t + " (" + rec.points + ")") : ""))) || ""; }

  // ---- Pairings board --------------------------------------------------
  function renderPairings(snap) {
    var hdr = document.getElementById("hdr"), board = document.getElementById("board"), foot = document.getElementById("foot");
    fillHeader(hdr, snap, "Round"); fillFooter(foot, snap);
    board.innerHTML = "";
    var groups = snap && snap.pairings && snap.pairings.groups;
    if (!groups || !Object.keys(groups).length) { board.appendChild(emptyState("Waiting for pairings…", "Pairings will appear here when TOM posts the round.")); return; }

    var sections = h("div", "sections");
    Object.keys(groups).forEach(function (gid) {
      var g = groups[gid];
      var acc = accentVar(gid);
      var sec = h("div", "section"); sec.style.setProperty("--acc", acc);
      var st = h("div", "stitle");
      st.appendChild(h("div", "t", g.label || gid));
      var tcount = (g.tables || []).length;
      st.appendChild(h("div", "meta", tcount + (tcount === 1 ? " table" : " tables")));
      sec.appendChild(st);

      var tables = (g.tables || []).slice().sort(function (a, b) { return a.table - b.table; });
      var two = tables.length > 8;
      var cols = h("div", "pcols" + (two ? " two" : ""));
      if (two) {
        var half = Math.ceil(tables.length / 2);
        cols.appendChild(pairColumn(tables.slice(0, half)));
        cols.appendChild(pairColumn(tables.slice(half)));
      } else {
        cols.appendChild(pairColumn(tables));
      }
      sec.appendChild(cols);

      if (g.byes && g.byes.length) {
        var by = h("div", "byes");
        by.appendChild(h("div", "bt", "Byes"));
        g.byes.forEach(function (p, i) {
          var span = h("span", "bn", p.name + (p.division ? (" (" + p.division + ")") : ""));
          by.appendChild(span);
          if (i < g.byes.length - 1) by.appendChild(document.createTextNode(",  "));
        });
        sec.appendChild(by);
      }
      sections.appendChild(sec);
    });
    board.appendChild(sections);
  }

  function pairColumn(tables) {
    var col = h("div", "pcol");
    tables.forEach(function (t) {
      var row = h("div", "prow");
      var badge = h("div", "tbadge", String(t.table)); row.appendChild(badge);
      var m = h("div", "pmatch");
      var p1 = t.players[0], p2 = t.players[1];
      m.appendChild(playerCell(p1, false));
      m.appendChild(h("div", "vsep", "vs"));
      m.appendChild(playerCell(p2, true));
      row.appendChild(m);
      var dot = h("div", "sdot " + (t.status || "paired")); row.appendChild(dot);
      col.appendChild(row);
    });
    return col;
  }

  function playerCell(p, right) {
    var c = h("div", "pl" + (right ? " right" : ""));
    if (!p) { c.appendChild(h("div", "pn", "—")); return c; }
    c.appendChild(h("div", "pn", p.name));
    var sub = h("div", "pr");
    if (p.division) { var d = h("span", "pdiv", p.division + " "); sub.appendChild(d); }
    sub.appendChild(document.createTextNode(recText(p.record)));
    c.appendChild(sub);
    return c;
  }

  // ---- Standings board -------------------------------------------------
  function renderStandings(snap) {
    var hdr = document.getElementById("hdr"), board = document.getElementById("board"), foot = document.getElementById("foot");
    fillHeader(hdr, snap, "After rd"); fillFooter(foot, snap);
    board.innerHTML = "";
    var st = snap && snap.standings;
    if (!st || !Object.keys(st).length) { board.appendChild(emptyState("Waiting for standings…", "Standings appear here after each round is posted.")); return; }

    // Order divisions largest-first so a big one (Masters) leads.
    var ids = Object.keys(st).sort(function (a, b) { return (st[b].rows || []).length - (st[a].rows || []).length; });
    var sections = h("div", "sections");
    ids.forEach(function (id) {
      var d = st[id];
      var sec = h("div", "section"); sec.style.setProperty("--acc", accentVar(id));
      var title = h("div", "stitle");
      title.appendChild(h("div", "t", d.label || id));
      var cutTxt = (d.cutSize && d.cutSize > 0) ? ("top " + d.cutSize) : "no top cut";
      title.appendChild(h("div", "meta", (d.rows || []).length + " players · " + cutTxt));
      sec.appendChild(title);

      var scroller = h("div", "scroller");
      var inner = h("div", "inner");
      var head = h("div", "srow head");
      ["#", "Player", "Record", "Pts", "OMW", "OOMW"].forEach(function (t, i) {
        head.appendChild(h("span", ["rk", "nm", "rec", "pt", "om", "oom"][i], t));
      });
      inner.appendChild(head);

      (d.rows || []).forEach(function (r) {
        var row = h("div", "srow" + (r.dropRound != null ? " dropped" : ""));
        row.appendChild(h("span", "rk", String(r.rank)));
        row.appendChild(h("span", "nm", r.name + (r.dropRound != null ? " (drop)" : "")));
        row.appendChild(h("span", "rec", recText(r.record)));
        row.appendChild(h("span", "pt", String(r.points)));
        row.appendChild(h("span", "om", fmtPct(r.omw)));
        row.appendChild(h("span", "oom", fmtPct(r.oomw)));
        inner.appendChild(row);
        // cut line only when a cut applies
        if (d.cutSize > 0 && r.cut === true) {
          var next = (d.rows || [])[r.rank]; // rank is 1-based; next row
          if (!next || next.cut !== true) inner.appendChild(h("div", "cutline"));
        }
      });
      scroller.appendChild(inner);
      sec.appendChild(scroller);
      sections.appendChild(sec);
      autoScroll(scroller, inner);
    });
    board.appendChild(sections);
  }

  function fmtPct(v) { return (v == null) ? "—" : (Number(v).toFixed(1) + "%"); }

  // Gentle vertical auto-scroll when a column overflows its max height.
  function autoScroll(scroller, inner) {
    requestAnimationFrame(function () {
      var overflow = inner.scrollHeight - scroller.clientHeight;
      if (overflow <= 8) { inner.style.transform = "none"; return; }
      var dur = Math.max(12, overflow / 22); // ~22px/sec
      inner.style.animation = "none";
      var name = "tomscroll_" + Math.floor(overflow);
      ensureKeyframes(name, overflow);
      inner.style.animation = name + " " + (dur * 2) + "s ease-in-out infinite";
    });
  }
  var kf = {};
  function ensureKeyframes(name, overflow) {
    if (kf[name]) return; kf[name] = true;
    var css = "@keyframes " + name + "{0%,12%{transform:translateY(0)}50%,62%{transform:translateY(-" + overflow + "px)}100%{transform:translateY(0)}}";
    var s = document.createElement("style"); s.textContent = css; document.head.appendChild(s);
  }

  // ---- NFC tap view (phone) -------------------------------------------
  function renderTable(snap) {
    var root = document.getElementById("tapRoot");
    var rawTbl = qp("table") || qp("tbl") || BGF.getTable && BGF.getTable();
    var tomTable = mapTable(rawTbl);
    document.getElementById("hdrEv").textContent = snap && snap.meta ? (snap.meta.name + " · Round " + snap.meta.round) : "Tournament";

    root.innerHTML = "";
    if (!snap) { root.appendChild(emptyState("No tournament running", "When a tournament is live, scan your table to see your match.")); setFoot(snap); return; }
    var byTable = snap.pairings && snap.pairings.byTable;
    var match = (byTable && tomTable != null) ? byTable[String(tomTable)] : null;

    // table number badge
    var num = h("div", "tap-num");
    num.appendChild(h("div", "lbl", "Table"));
    num.appendChild(h("div", "n", tomTable != null ? String(tomTable) : "—"));
    root.appendChild(num);

    if (!match) {
      root.appendChild(msgPanel("No match at this table", "There's no pairing on table " + (tomTable != null ? tomTable : "?") + " this round. If you have a bye, relax — you'll be paired next round."));
      root.appendChild(boardLinks());
      setFoot(snap);
      return;
    }

    // set page accent to the group's color
    document.body.style.setProperty("--acc", accentVar(match.group));

    var card = h("div", "tap-card");
    var vs = h("div", "tap-vs");
    vs.appendChild(tapPlayer(match.players[0]));
    vs.appendChild(h("div", "mid", "vs"));
    vs.appendChild(tapPlayer(match.players[1]));
    card.appendChild(vs);
    var status = h("div", "tap-status");
    status.appendChild(h("span", "sdot " + (match.status || "paired")));
    status.appendChild(document.createTextNode(statusLabel(match.status)));
    card.appendChild(status);
    root.appendChild(card);

    // standings peek scoped to the division(s) at this table
    var divs = uniqueDivs(match.players);
    divs.forEach(function (dvid) {
      var d = snap.standings && snap.standings[dvid];
      if (!d) return;
      root.appendChild(h("div", "peek-title", (d.label || dvid) + " standings"));
      root.appendChild(peekTable(d, match.players));
    });

    root.appendChild(boardLinks());
    setFoot(snap);
  }

  function tapPlayer(p) {
    var c = h("div");
    if (!p) { c.appendChild(h("div", "pn", "—")); return c; }
    c.appendChild(h("div", "pn", p.name));
    if (p.division) c.appendChild(h("div", "pdiv", p.division));
    c.appendChild(h("div", "pr", recText(p.record)));
    return c;
  }
  function statusLabel(s) { return ({ paired: "Match in progress", done: "Result posted", waiting: "Waiting", bye: "Bye" })[s] || "Paired"; }
  function uniqueDivs(players) {
    var seen = {}, out = [];
    (players || []).forEach(function (p) { if (p && p.division && !seen[p.division]) { seen[p.division] = 1; out.push(p.division); } });
    return out;
  }
  function peekTable(d, tablePlayers) {
    var names = {}; (tablePlayers || []).forEach(function (p) { if (p) names[p.name] = 1; });
    var wrap = h("div", "tap-card"); wrap.style.padding = "6px 10px";
    (d.rows || []).slice(0, 8).forEach(function (r) {
      var row = h("div", "srow" + (names[r.name] ? " me" : ""));
      row.style.gridTemplateColumns = "34px 1fr 74px 40px";
      row.appendChild(h("span", "rk", String(r.rank)));
      row.appendChild(h("span", "nm", r.name));
      row.appendChild(h("span", "rec", recText(r.record)));
      row.appendChild(h("span", "pt", String(r.points)));
      wrap.appendChild(row);
    });
    return wrap;
  }
  function msgPanel(title, body) {
    var c = h("div", "tap-card"); c.style.textAlign = "center";
    c.appendChild(h("div", "pn", title));
    c.appendChild(h("div", "pr", body)); c.querySelector(".pr").style.marginTop = "6px";
    return c;
  }
  function boardLinks() {
    var a = h("div", "tap-actions");
    var l1 = h("a", "tap-btn", "Full standings →"); l1.href = "standings.html" + (qp("t") ? ("?t=" + qp("t")) : "");
    var l2 = h("a", "tap-btn", "All pairings →"); l2.href = "pairings.html" + (qp("t") ? ("?t=" + qp("t")) : "");
    a.appendChild(l1); a.appendChild(l2);
    return a;
  }
  function setFoot(snap) {
    var f = document.getElementById("tapFoot");
    f.textContent = snap && snap.meta ? ("Posted " + snap.meta.generatedAt + " · updates on scan") : "";
  }
  function mapTable(raw) {
    if (raw == null) return null;
    var key = String(raw).trim();
    if (TAG_TO_TABLE[key] != null) return TAG_TO_TABLE[key];
    var n = parseInt(key, 10);
    return isNaN(n) ? null : n;
  }

  // ---- public inits ----------------------------------------------------
  function initPairings() { poll(renderPairings); }
  function initStandings() { poll(renderStandings); }
  function initTable() { poll(renderTable); }

  global.TOM = {
    TAG_TO_TABLE: TAG_TO_TABLE, LIVE_WINDOW_MS: LIVE_WINDOW_MS,
    initPairings: initPairings, initStandings: initStandings, initTable: initTable,
    loadLatest: loadLatest
  };
  if (typeof module !== "undefined" && module.exports) module.exports = global.TOM;

})(typeof window !== "undefined" ? window : globalThis);
