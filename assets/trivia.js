/* ============================================================
   Balance Gaming FL — Live Trivia (Kahoot-style)
   Three roles, one Firebase node (/trivia):
     config.html  → host: write the question bank + run the game
     board.html   → the TV: question, timer, join QR, leaderboard
     play.html    → a phone: join by QR/NFC, tap answers, see score
   Data model (/trivia):
     questions: [ { q, choices:[a,b,c,d], correct:int, time:int(sec) } ]
     game:      { phase, idx, startedAt, code, scoredIdx, updatedMs }
     players:   { <pid>: { name, score, correctCount, last:{idx,choice,ms} } }
   phase: idle | lobby | question | reveal | ended
   Style mirrors the repo: IIFE, var, plain fetch via window.BGF.
   ============================================================ */
(function (global) {
  "use strict";

  var POLL_MS = 1200;
  var COLORS = ["#e2445c", "#2b7fe0", "#e8a33d", "#2ec27e"]; // A B C D
  var LETTERS = ["A", "B", "C", "D"];

  function el(t, c, x) { var e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; }
  function BGF() { return global.BGF; }
  function playUrl() {
    try { var u = new URL("play.html", location.href); return u.href; } catch (e) { return "play.html"; }
  }
  function makeCode() {
    var s = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789", c = "";
    for (var i = 0; i < 4; i++) c += s.charAt(Math.floor(Math.random() * s.length));
    return "BGF" + c.slice(0, 2) + c.slice(2);
  }
  // Points: correct answer = 500 base + up to 500 speed bonus (faster = more).
  function scoreFor(ms, timeMs) { var r = 1 - (ms / timeMs); if (r < 0) r = 0; if (r > 1) r = 1; return 500 + Math.round(500 * r); }
  function leaderboard(players) {
    return Object.keys(players || {}).map(function (id) { return { id: id, p: players[id] || {} }; })
      .sort(function (a, b) { return (b.p.score || 0) - (a.p.score || 0); });
  }

  // ---- QR -------------------------------------------------------------
  function qrSvg(url, cell) {
    if (typeof global.qrcode !== "function") return "";
    try { var q = global.qrcode(0, "M"); q.addData(url); q.make(); return q.createSvgTag({ cellSize: cell || 6, margin: 1, scalable: true }); }
    catch (e) { return ""; }
  }

  /* ================= HOST (config.html) ================= */
  function initConfig() {
    var bank = document.getElementById("qbank");
    var hostPlayers = document.getElementById("hostPlayers");
    var statusEl = document.getElementById("gameStatus");
    var joinInfo = document.getElementById("joinInfo");
    if (!bank) return;
    var bankPick = document.getElementById("bankPick");
    var bankName = document.getElementById("bankName");
    var banks = {}, currentBankId = null;
    var questions = [];                     // editor working copy = selected bank's questions

    function blankQ() { return { q: "", choices: ["", "", "", ""], correct: 0, time: 20 }; }
    function renderBank() {
      bank.innerHTML = "";
      if (!questions.length) bank.appendChild(el("p", "tv-hint", "No questions yet — click “Add question”."));
      questions.forEach(function (q, i) {
        var card = el("div", "qcard");
        var head = el("div", "qcard-h");
        head.appendChild(el("span", "qnum", "Q" + (i + 1)));
        var del = el("button", "btn ghost sm", "Remove");
        del.type = "button"; del.onclick = function () { questions.splice(i, 1); renderBank(); };
        head.appendChild(del);
        card.appendChild(head);

        var qt = el("input", "field"); qt.type = "text"; qt.placeholder = "Question text"; qt.value = q.q || "";
        qt.oninput = function () { q.q = qt.value; };
        card.appendChild(qt);

        q.choices.forEach(function (ch, ci) {
          var row = el("label", "choice-row");
          var radio = el("input"); radio.type = "radio"; radio.name = "correct" + i; radio.checked = (q.correct === ci);
          radio.onchange = function () { q.correct = ci; };
          var tag = el("span", "choice-letter"); tag.textContent = LETTERS[ci]; tag.style.background = COLORS[ci];
          var inp = el("input", "field inline"); inp.type = "text"; inp.placeholder = "Answer " + LETTERS[ci]; inp.value = ch || "";
          inp.oninput = function () { q.choices[ci] = inp.value; };
          row.appendChild(radio); row.appendChild(tag); row.appendChild(inp);
          card.appendChild(row);
        });

        var trow = el("div", "qtime");
        trow.appendChild(el("span", null, "Seconds to answer:"));
        var ti = el("input", "field tiny"); ti.type = "number"; ti.min = "5"; ti.max = "120"; ti.value = q.time || 20;
        ti.oninput = function () { q.time = Math.max(5, parseInt(ti.value, 10) || 20); };
        trow.appendChild(ti);
        trow.appendChild(el("span", "tv-hint", "· the dot marks the correct answer"));
        card.appendChild(trow);
        bank.appendChild(card);
      });
    }

    function validQ(q) { return (q.q || "").trim() && (q.choices || []).filter(Boolean).length >= 2; }
    function newId() { return "b" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }
    document.getElementById("qAdd").onclick = function () { questions.push(blankQ()); renderBank(); };

    // ---- Question banks (one per round/category) ----
    function selectBank(id) {
      currentBankId = id;
      var b = banks[id] || { name: "", questions: [] };
      if (bankName) bankName.value = b.name || "";
      questions = (b.questions || []).map(function (q) { return { q: q.q, choices: (q.choices || ["", "", "", ""]).slice(), correct: q.correct || 0, time: q.time || 20 }; });
      renderBank();
    }
    function renderBankPicker() {
      if (!bankPick) return;
      var ids = Object.keys(banks).sort(function (a, b) { return (banks[a].name || "").localeCompare(banks[b].name || ""); });
      bankPick.innerHTML = "";
      ids.forEach(function (id) { var o = el("option"); o.value = id; o.textContent = banks[id].name || "(unnamed)"; bankPick.appendChild(o); });
      var add = el("option"); add.value = "__new__"; add.textContent = "➕ New bank…"; bankPick.appendChild(add);
      if (!currentBankId || !banks[currentBankId]) currentBankId = ids[0] || null;
      if (currentBankId) bankPick.value = currentBankId;
      selectBank(currentBankId);
    }
    function loadBanks() {
      return BGF().fbGet("trivia/banks").then(function (b) {
        banks = (b && typeof b === "object") ? b : {};
        if (Object.keys(banks).length) return;
        // migrate a pre-existing single bank (/trivia/questions) into a "Main" bank
        return BGF().fbGet("trivia/questions").then(function (qs) {
          var id = newId();
          banks[id] = { name: "Main", questions: Array.isArray(qs) ? qs : [] };
          currentBankId = id;
          return BGF().fbSet("trivia/banks", banks);
        });
      });
    }
    if (bankPick) bankPick.onchange = function () {
      if (bankPick.value === "__new__") {
        var id = newId(); banks[id] = { name: "New bank", questions: [] }; currentBankId = id;
        BGF().fbSet("trivia/banks/" + id, banks[id]).then(function () { renderBankPicker(); if (bankName) bankName.focus(); toast("New bank — name it and add questions"); });
        return;
      }
      selectBank(bankPick.value);
    };
    var bankDelete = document.getElementById("bankDelete");
    if (bankDelete) bankDelete.onclick = function () {
      if (!currentBankId) return;
      var id = currentBankId; delete banks[id];
      BGF().fbSet("trivia/banks/" + id, null).then(function () { currentBankId = null; renderBankPicker(); toast("Bank deleted"); });
    };
    document.getElementById("qSave").onclick = function () {
      if (!currentBankId) { toast("Add a bank first"); return; }
      var clean = questions.filter(validQ);
      var nm = (bankName && bankName.value || "").trim() || "Untitled";
      banks[currentBankId] = { name: nm, questions: clean };
      BGF().fbSet("trivia/banks/" + currentBankId, banks[currentBankId])
        .then(function () { renderBankPicker(); toast("Saved “" + nm + "” — " + clean.length + " question" + (clean.length === 1 ? "" : "s")); })
        .catch(function () { toast("Couldn't save — try again"); });
    };
    var bankLoad = document.getElementById("bankLoad");
    if (bankLoad) bankLoad.onclick = function () {
      var clean = questions.filter(validQ);
      if (!clean.length) { toast("Add some questions first"); return; }
      var nm = (bankName && bankName.value || "").trim() || "Bank";
      BGF().fbSet("trivia/questions", clean)
        .then(function () { return BGF().fbUpdate("trivia/game", { roundName: nm, updatedMs: Date.now() }); })
        .then(function () { toast("Loaded “" + nm + "” onto the board — tap Start questions"); })
        .catch(function () { toast("Couldn't load — try again"); });
    };

    // Game controls
    function setPhase(patch) { patch = patch || {}; patch.updatedMs = Date.now(); return BGF().fbUpdate("trivia/game", patch); }
    document.getElementById("gNew").onclick = function () {
      BGF().fbSet("trivia/players", null).then(function () {
        return BGF().fbSet("trivia/game", { phase: "lobby", idx: 0, startedAt: 0, scoredIdx: -1, code: makeCode(), updatedMs: Date.now() });
      }).then(function () { toast("New game — players can join now"); });
    };
    document.getElementById("gStart").onclick = function () { setPhase({ phase: "question", idx: 0, startedAt: Date.now(), scoredIdx: -1 }).then(function () { toast("Question 1 is live"); }); };
    document.getElementById("gReveal").onclick = revealAndScore;
    document.getElementById("gNext").onclick = function () {
      Promise.all([BGF().fbGet("trivia/game"), BGF().fbGet("trivia/questions")]).then(function (r) {
        var g = r[0] || {}, live = r[1] || [], next = (g.idx || 0) + 1;
        if (next >= live.length) { setPhase({ phase: "ended" }).then(function () { toast("Game over — leaderboard is up"); }); return; }
        setPhase({ phase: "question", idx: next, startedAt: Date.now() }).then(function () { toast("Question " + (next + 1) + " is live"); });
      });
    };
    document.getElementById("gEnd").onclick = function () { setPhase({ phase: "ended" }).then(function () { toast("Game ended"); }); };
    var gReset = document.getElementById("gReset");
    if (gReset) gReset.onclick = function () { setPhase({ phase: "idle" }).then(function () { toast("Back to the Trivia Night screen"); }); };

    // Show-on-TV toggle: overlays the trivia board on the main 75" signage.
    var showToggle = document.getElementById("triviaShow");
    function paintShow(on) {
      if (!showToggle) return;
      var row = showToggle.closest(".switch-row"); if (row) row.setAttribute("data-on", on ? "true" : "false");
      var st = document.getElementById("triviaShowState"); if (st) st.textContent = on ? "showing on the 75″ TV" : "not on the TV";
    }
    if (showToggle) {
      BGF().fbGet("trivia/show").then(function (v) { showToggle.checked = v === true; paintShow(v === true); });
      showToggle.addEventListener("change", function () {
        var on = showToggle.checked; paintShow(on);
        BGF().fbSet("trivia/show", on)
          .then(function () { toast(on ? "Trivia is on the main TV" : "Trivia off the main TV"); })
          .catch(function () { showToggle.checked = !on; paintShow(!on); toast("Couldn't switch — try again"); });
      });
    }

    function revealAndScore() {
      Promise.all([BGF().fbGet("trivia/game"), BGF().fbGet("trivia/questions"), BGF().fbGet("trivia/players")]).then(function (r) {
        var g = r[0] || {}, qs = r[1] || [], players = r[2] || {};
        var idx = g.idx || 0, q = qs[idx];
        if (!q) { setPhase({ phase: "reveal" }); return; }
        var timeMs = (q.time || 20) * 1000;
        var jobs = [];
        if (g.scoredIdx !== idx) {               // score once per question
          Object.keys(players).forEach(function (id) {
            var p = players[id] || {}, last = p.last;
            if (last && last.idx === idx && last.choice === q.correct) {
              var pts = scoreFor(last.ms == null ? timeMs : last.ms, timeMs);
              jobs.push(BGF().fbUpdate("trivia/players/" + id, { score: (p.score || 0) + pts, correctCount: (p.correctCount || 0) + 1 }));
            }
          });
        }
        Promise.all(jobs).then(function () { setPhase({ phase: "reveal", scoredIdx: idx }); toast("Answer revealed"); });
      });
    }

    function paintGame() {
      Promise.all([BGF().fbGet("trivia/game"), BGF().fbGet("trivia/players")]).then(function (r) {
        var g = r[0] || {}, players = r[1] || {};
        var phase = g.phase || "idle";
        if (statusEl) statusEl.textContent =
          phase === "idle" ? "No game running" :
          phase === "lobby" ? ("Lobby — " + Object.keys(players).length + " joined") :
          phase === "question" ? ("Question " + ((g.idx || 0) + 1) + " live") :
          phase === "reveal" ? ("Answer shown (Q" + ((g.idx || 0) + 1) + ")") : "Game over";
        if (joinInfo) joinInfo.textContent = (phase === "lobby" || phase === "question" || phase === "reveal")
          ? ("Join: " + playUrl() + (g.code ? ("   ·   code " + g.code) : "")) : "";
        if (hostPlayers) {
          hostPlayers.innerHTML = "";
          var lb = leaderboard(players);
          if (!lb.length) { hostPlayers.appendChild(el("p", "tv-hint", "No players yet.")); }
          lb.forEach(function (row, i) {
            var r2 = el("div", "lb-row");
            r2.appendChild(el("span", "lb-rk", String(i + 1)));
            r2.appendChild(el("span", "lb-nm", row.p.name || "player"));
            r2.appendChild(el("span", "lb-sc", String(row.p.score || 0)));
            hostPlayers.appendChild(r2);
          });
        }
      }).catch(function () {});
    }

    var toastT;
    function toast(m) { var t = document.getElementById("toast"); if (!t) return; t.textContent = m; t.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove("show"); }, 2400); }

    // load banks (migrating any old single bank) + poll game state
    loadBanks().then(renderBankPicker);
    paintGame(); setInterval(paintGame, POLL_MS);
  }

  /* ================= BOARD (board.html) ================= */
  function initBoard() {
    var stage = document.getElementById("stage");
    if (!stage) return;
    var lastSig = "", timerT = null;

    function draw() {
      Promise.all([BGF().fbGet("trivia/game"), BGF().fbGet("trivia/questions"), BGF().fbGet("trivia/players")]).then(function (r) {
        var g = r[0] || {}, qs = r[1] || [], players = r[2] || {};
        var phase = g.phase || "idle";
        var sig = JSON.stringify([phase, g.idx, g.startedAt, g.code, Object.keys(players).length, g.scoredIdx]);
        var samePhase = (sig === lastSig);
        lastSig = sig;
        if (phase === "idle") { if (!samePhase) renderIdle(); return; }
        if (phase === "lobby") { if (!samePhase) renderLobby(g, players); return; }
        if (phase === "question") { renderQuestion(g, qs, players, samePhase); return; }
        if (phase === "reveal") { if (!samePhase) renderReveal(g, qs, players); return; }
        if (phase === "ended") { if (!samePhase) renderEnded(players); return; }
      }).catch(function () {});
    }
    function clearTimer() { if (timerT) { clearInterval(timerT); timerT = null; } }

    function header(title) { var h = el("div", "tv-head"); var img = el("img", "tv-logo"); img.src = "../assets/logo.png"; img.alt = ""; h.appendChild(img); h.appendChild(el("div", "tv-title", title)); return h; }

    function renderIdle() {
      clearTimer(); stage.innerHTML = "";
      var w = el("div", "tv-center");
      var img = el("img", "tv-logo-lg"); img.src = "../assets/logo.png"; img.alt = "Balance Gaming FL"; w.appendChild(img);
      w.appendChild(el("div", "tv-big", "Trivia Night"));
      w.appendChild(el("div", "tv-sub", "Get ready to play on your phone."));
      stage.appendChild(w);
    }
    function renderLobby(g, players) {
      clearTimer(); stage.innerHTML = "";
      stage.appendChild(header("Trivia Night — Join now"));
      var body = el("div", "lobby");
      var left = el("div", "lobby-join");
      var qr = el("div", "qrbox"); qr.innerHTML = qrSvg(playUrl(), 7); left.appendChild(qr);
      left.appendChild(el("div", "tv-sub", "Scan to join on your phone"));
      if (g.code) left.appendChild(el("div", "code", g.code));
      body.appendChild(left);
      var right = el("div", "lobby-players");
      right.appendChild(el("div", "tv-sub", Object.keys(players).length + " in the room"));
      var grid = el("div", "pgrid");
      leaderboard(players).forEach(function (row) { grid.appendChild(el("span", "pchip", row.p.name || "player")); });
      right.appendChild(grid);
      body.appendChild(right);
      stage.appendChild(body);
    }
    function renderQuestion(g, qs, players, samePhase) {
      var q = qs[g.idx || 0];
      if (!q) { renderIdle(); return; }
      if (!samePhase) {
        clearTimer(); stage.innerHTML = "";
        stage.appendChild(header((g.roundName ? g.roundName + " · " : "") + "Question " + ((g.idx || 0) + 1) + " of " + qs.length));
        var qt = el("div", "q-text", q.q); stage.appendChild(qt);
        var timer = el("div", "q-timer"); timer.id = "qTimer"; stage.appendChild(timer);
        var grid = el("div", "ans-grid");
        (q.choices || []).forEach(function (ch, ci) {
          var a = el("div", "ans"); a.style.background = COLORS[ci];
          a.appendChild(el("span", "ans-letter", LETTERS[ci]));
          a.appendChild(el("span", "ans-text", ch));
          grid.appendChild(a);
        });
        stage.appendChild(grid);
        var count = el("div", "ans-count"); count.id = "ansCount"; stage.appendChild(count);
        var time = q.time || 20;
        clearTimer();
        timerT = setInterval(function () {
          var left = Math.max(0, time - Math.round((Date.now() - (g.startedAt || Date.now())) / 1000));
          var t = document.getElementById("qTimer"); if (t) t.textContent = left + "s";
        }, 250);
      }
      // live answer count (updates each poll without rebuilding)
      var answered = Object.keys(players).filter(function (id) { var l = (players[id] || {}).last; return l && l.idx === (g.idx || 0); }).length;
      var c = document.getElementById("ansCount"); if (c) c.textContent = answered + " answered";
    }
    function renderReveal(g, qs, players) {
      clearTimer(); stage.innerHTML = "";
      var q = qs[g.idx || 0] || { choices: [] };
      stage.appendChild(header((g.roundName ? g.roundName + " · " : "") + "Answer — Q" + ((g.idx || 0) + 1)));
      stage.appendChild(el("div", "q-text", q.q || ""));
      var grid = el("div", "ans-grid");
      (q.choices || []).forEach(function (ch, ci) {
        var a = el("div", "ans" + (ci === q.correct ? " correct" : " dim"));
        if (ci !== q.correct) a.style.background = COLORS[ci];
        a.appendChild(el("span", "ans-letter", LETTERS[ci]));
        a.appendChild(el("span", "ans-text", ch));
        if (ci === q.correct) a.appendChild(el("span", "ans-check", "✓"));
        grid.appendChild(a);
      });
      stage.appendChild(grid);
      var top = el("div", "mini-lb");
      leaderboard(players).slice(0, 5).forEach(function (row, i) {
        var r = el("div", "lb-row");
        r.appendChild(el("span", "lb-rk", String(i + 1)));
        r.appendChild(el("span", "lb-nm", row.p.name || "player"));
        r.appendChild(el("span", "lb-sc", String(row.p.score || 0)));
        top.appendChild(r);
      });
      stage.appendChild(top);
    }
    function renderEnded(players) {
      clearTimer(); stage.innerHTML = "";
      stage.appendChild(header("Final scores"));
      var lb = leaderboard(players);
      if (lb[0]) {
        var win = el("div", "winner");
        win.appendChild(el("div", "tv-sub", "🏆 Winner"));
        win.appendChild(el("div", "tv-big", lb[0].p.name || "player"));
        win.appendChild(el("div", "code", String(lb[0].p.score || 0) + " pts"));
        stage.appendChild(win);
      }
      var list = el("div", "mini-lb");
      lb.slice(0, 10).forEach(function (row, i) {
        var r = el("div", "lb-row");
        r.appendChild(el("span", "lb-rk", String(i + 1)));
        r.appendChild(el("span", "lb-nm", row.p.name || "player"));
        r.appendChild(el("span", "lb-sc", String(row.p.score || 0)));
        list.appendChild(r);
      });
      stage.appendChild(list);
    }

    renderIdle();
    draw(); setInterval(draw, POLL_MS);
    // unattended TV: reload every ~20 min to free memory
    setTimeout(function () { try { location.reload(); } catch (e) {} }, 20 * 60 * 1000);
  }

  /* ================= PLAYER (play.html) ================= */
  function myId() {
    try {
      var k = localStorage.getItem("bgfTriviaPid");
      if (!k) { k = "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); localStorage.setItem("bgfTriviaPid", k); }
      return k;
    } catch (e) { return "p" + Math.random().toString(36).slice(2, 9); }
  }
  function myName() { try { return localStorage.getItem("bgfTriviaName") || ""; } catch (e) { return ""; } }

  function initPlay() {
    var app = document.getElementById("app");
    if (!app) return;
    var id = myId();
    var name = myName();
    var seenIdx = -1, localStart = 0, answeredIdx = -1;

    function register(nm) {
      try { localStorage.setItem("bgfTriviaName", nm); } catch (e) {}
      name = nm;
      return BGF().fbSet("trivia/players/" + id, { name: nm, score: 0, correctCount: 0 });
    }
    function renderName() {
      app.innerHTML = "";
      var c = el("div", "pl-card");
      var img = el("img", "pl-logo"); img.src = "../assets/logo.png"; img.alt = "Balance Gaming FL"; c.appendChild(img);
      c.appendChild(el("h1", null, "Trivia"));
      c.appendChild(el("p", "pl-sub", "Enter a name to join the game on the TV."));
      var inp = el("input", "pl-input"); inp.type = "text"; inp.maxLength = 18; inp.placeholder = "Your name";
      inp.value = name || ""; c.appendChild(inp);
      var go = el("button", "pl-btn", "Join"); go.type = "button";
      go.onclick = function () {
        var nm = (inp.value || "").trim().slice(0, 18); if (!nm) { inp.focus(); return; }
        register(nm).then(function () { seenIdx = -1; answeredIdx = -1; });
      };
      c.appendChild(go);
      app.appendChild(c);
    }
    function answer(choiceIdx, q) {
      answeredIdx = seenIdx;
      lastView = "ans|" + seenIdx + "|" + choiceIdx;         // keep the poll from rebuilding
      var ms = Date.now() - (localStart || Date.now());
      BGF().fbSet("trivia/players/" + id + "/last", { idx: seenIdx, choice: choiceIdx, ms: ms }).catch(function () {});
      renderAnswered(choiceIdx, q);
    }
    function renderAnswered(choiceIdx, q) {
      app.innerHTML = "";
      var c = el("div", "pl-card");
      c.appendChild(el("div", "pl-locked-letter", LETTERS[choiceIdx]));
      c.appendChild(el("h2", null, "Locked in!"));
      c.appendChild(el("p", "pl-sub", "Watch the TV for the answer."));
      app.appendChild(c);
    }
    function renderQuestion(g, qs) {
      var q = qs[g.idx || 0]; if (!q) { renderWait("Waiting for the next question…"); return; }
      app.innerHTML = "";
      var top = el("div", "pl-top"); top.appendChild(el("span", null, (name || "You"))); top.appendChild(el("span", "pl-q", "Q" + ((g.idx || 0) + 1))); app.appendChild(top);
      var grid = el("div", "pl-grid");
      (q.choices || []).forEach(function (ch, ci) {
        if (!ch) return;
        var b = el("button", "pl-ans"); b.type = "button"; b.style.background = COLORS[ci];
        b.appendChild(el("span", "pl-ans-letter", LETTERS[ci]));
        b.appendChild(el("span", "pl-ans-text", ch));
        b.onclick = function () { answer(ci, q); };
        grid.appendChild(b);
      });
      app.appendChild(grid);
    }
    function renderWait(msg) {
      app.innerHTML = "";
      var c = el("div", "pl-card");
      c.appendChild(el("h2", null, name ? ("You're in, " + name + "!") : "You're in!"));
      c.appendChild(el("p", "pl-sub", msg));
      app.appendChild(c);
    }
    function renderReveal(g, qs, me) {
      var q = qs[g.idx || 0] || {};
      var last = me && me.last;
      var gotIt = last && last.idx === (g.idx || 0) && last.choice === q.correct;
      app.innerHTML = "";
      var c = el("div", "pl-card " + (gotIt ? "good" : (last && last.idx === (g.idx || 0) ? "bad" : "")));
      c.appendChild(el("div", "pl-result", gotIt ? "✓ Correct!" : (last && last.idx === (g.idx || 0) ? "✗ Not this time" : "No answer")));
      c.appendChild(el("p", "pl-sub", "Score: " + ((me && me.score) || 0)));
      app.appendChild(c);
    }
    function renderEnded(me, players) {
      var lb = leaderboard(players);
      var rank = 0; for (var i = 0; i < lb.length; i++) { if (lb[i].id === id) { rank = i + 1; break; } }
      app.innerHTML = "";
      var c = el("div", "pl-card");
      c.appendChild(el("h1", null, "Thanks for playing!"));
      c.appendChild(el("div", "pl-result", (me && me.score || 0) + " pts"));
      if (rank) c.appendChild(el("p", "pl-sub", "You placed #" + rank + " of " + lb.length));
      app.appendChild(c);
    }

    var lastView = "";                                       // render only when the view changes
    function tick() {
      Promise.all([BGF().fbGet("trivia/game"), BGF().fbGet("trivia/questions"), BGF().fbGet("trivia/players/" + id), BGF().fbGet("trivia/players")]).then(function (r) {
        var g = r[0] || {}, qs = r[1] || [], me = r[2], players = r[3] || {};
        var phase = g.phase || "idle";
        if (!name) { if (lastView !== "name") { lastView = "name"; renderName(); } return; }
        if (!me) { register(name); return; }                 // host reset the room — rejoin
        var idx = g.idx || 0;
        if (phase === "question" && idx !== seenIdx) { seenIdx = idx; localStart = Date.now(); answeredIdx = -1; }
        var answered = phase === "question" && (answeredIdx === idx || (me.last && me.last.idx === idx));
        var sig =
          phase === "idle" ? "idle" :
          phase === "lobby" ? "lobby" :
          phase === "question" ? (answered ? ("ans|" + idx + "|" + ((me.last || {}).choice)) : ("q|" + idx)) :
          phase === "reveal" ? ("reveal|" + idx + "|" + ((me.last || {}).choice) + "|" + (me.score || 0)) :
          ("ended|" + (me.score || 0));
        if (sig === lastView) return;
        lastView = sig;
        if (phase === "idle") { renderWait("Waiting for the host to start a game…"); return; }
        if (phase === "lobby") { renderWait("You're in! Waiting for the host to start…"); return; }
        if (phase === "question") { answered ? renderAnswered((me.last || {}).choice || 0, qs[idx] || {}) : renderQuestion(g, qs); return; }
        if (phase === "reveal") { renderReveal(g, qs, me); return; }
        if (phase === "ended") { renderEnded(me, players); return; }
      }).catch(function () {});
    }

    tick(); setInterval(tick, POLL_MS);
  }

  global.Trivia = { config: initConfig, board: initBoard, play: initPlay };
})(typeof window !== "undefined" ? window : globalThis);
