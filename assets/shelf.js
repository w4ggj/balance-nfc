/* ============================================================
   "On the shelf now" — in-stock product cards for the store TVs (Nov 2026).
   Joe: show what's in stock and the price, NO discounts. Event players come
   for the event and rarely shop, so the TVs put the shelf in front of them.
     - signage.html (main TV showcase): a full card slipped into the rotation
     - board.html (live pairings/standings): a slim bar under the board,
       matched to the game that's running (sealed for that game + sleeves/boxes)
   Data = the store's public collection products.json (no token, CORS open).
   Only products with an available variant, a price and a photo are shown.
   Best-effort: any failure just means no shelf cards; nothing else breaks.
   ============================================================ */
(function (global) {
  "use strict";

  var MAIN_SITE = "https://balancegamingfl.com";
  var CACHE_MS = 10 * 60 * 1000;
  var ACCESSORIES = ["card-sleeves", "deck-boxes"];
  var POOLS = {
    pokemon:   ["pokemon-sealed-product"],
    onepiece:  ["one-piece-sealed"],
    riftbound: ["riftbound-sealed"],
    mtg:       ["mtg-sealed-product", "playmats"],
    all:       ["tcg-sealed-product", "playmats"]
  };
  var GAME_LABEL = [
    [/pokemon/i, "Pokémon"], [/one piece/i, "One Piece"], [/riftbound/i, "Riftbound"],
    [/magic/i, "Magic: The Gathering"], [/weiss/i, "Weiss Schwarz"], [/digimon/i, "Digimon"],
    [/lorcana/i, "Lorcana"], [/flesh and blood/i, "Flesh and Blood"], [/yugioh|yu-gi-oh/i, "Yu-Gi-Oh!"],
    [/final fantasy/i, "Final Fantasy TCG"], [/sleeve/i, "Sleeves"], [/deck box/i, "Deck boxes"], [/playmat/i, "Playmats"]
  ];

  var colCache = {};   // handle -> { at, items }
  var pools = {};      // game -> { items, i }

  // "The Hobbit - Prerelease Pack [HOB]" -> "The Hobbit - Prerelease Pack".
  // All-caps set codes in brackets go; a bracket with real words stays as " – words".
  function cleanTitle(t) {
    var s = String(t || "").replace(/\s*\[([^\]]*)\]/g, function (m, inner) {
      return /[a-z]/.test(inner) ? " – " + inner.trim() : "";
    });
    return s.replace(/\s{2,}/g, " ").trim() || String(t || "");
  }
  function money(n) {
    var v = Number(n);
    if (!(v > 0)) return null;
    return "$" + (Math.round(v * 100) % 100 === 0 ? String(Math.round(v)) : v.toFixed(2));
  }
  function label(p) {
    var s = (p.product_type || "") + " " + (p.title || "");
    for (var i = 0; i < GAME_LABEL.length; i++) if (GAME_LABEL[i][0].test(s)) return GAME_LABEL[i][1];
    return "";
  }
  function imgUrl(src, w) { return src ? src + (src.indexOf("?") === -1 ? "?" : "&") + "width=" + w : ""; }

  function toItem(p) {
    if (!p || /^(event|gift card)$/i.test(p.product_type || "")) return null;
    var avail = (p.variants || []).filter(function (v) { return v.available && Number(v.price) > 0; });
    if (!avail.length) return null;
    var img = p.images && p.images[0] && p.images[0].src;
    if (!img) return null;
    var prices = avail.map(function (v) { return Number(v.price); });
    var lo = Math.min.apply(null, prices), hi = Math.max.apply(null, prices);
    return {
      handle: p.handle,
      title: cleanTitle(p.title),
      price: (hi > lo ? "from " : "") + money(lo),
      image: imgUrl(img, 800),
      label: label(p),
      accessory: /sleeve|deck box|playmat/i.test(p.product_type || "")
    };
  }

  function loadCollection(handle) {
    var c = colCache[handle];
    if (c && Date.now() - c.at < CACHE_MS) return Promise.resolve(c.items);
    function page(n, acc) {
      return fetch(MAIN_SITE + "/collections/" + handle + "/products.json?limit=250&page=" + n, { cache: "no-store" })
        .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
        .then(function (d) {
          var list = (d && d.products) || [];
          acc = acc.concat(list);
          return (list.length === 250 && n < 3) ? page(n + 1, acc) : acc;
        });
    }
    return page(1, []).then(function (list) {
      var items = list.map(toItem).filter(Boolean);
      colCache[handle] = { at: Date.now(), items: items };
      return items;
    }).catch(function () { return (c && c.items) || []; });
  }

  function shuffle(a) { a = a.slice(); for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

  // Two game products, then one accessory, repeating — so a Pokémon night isn't
  // all sleeves, and a game with nothing in stock still shows sleeves/boxes.
  function mix(main, acc) {
    var out = [], seen = {}, mi = 0, ai = 0;
    main = shuffle(main); acc = shuffle(acc);
    function push(x) { if (x && !seen[x.handle]) { seen[x.handle] = 1; out.push(x); } }
    while (mi < main.length || ai < acc.length) {
      if (mi < main.length) push(main[mi++]);
      if (mi < main.length) push(main[mi++]);
      if (ai < acc.length) push(acc[ai++]);
    }
    return out;
  }

  function load(game) {
    game = POOLS[game] ? game : "all";
    var p = pools[game];
    if (p && Date.now() - p.at < CACHE_MS) return Promise.resolve(p.items);
    var mainHandles = POOLS[game];
    return Promise.all(mainHandles.concat(ACCESSORIES).map(loadCollection)).then(function (lists) {
      var main = [], acc = [];
      lists.forEach(function (l, i) {
        l.forEach(function (it) { (i < mainHandles.length && !it.accessory ? main : acc).push(it); });
      });
      var items = mix(main, acc);
      pools[game] = { at: Date.now(), items: items, i: p ? p.i : 0 };
      return items;
    });
  }

  // Next product for a game (cycles through the mixed list). Synchronous so the
  // TV rotations can call it inline; returns null until the first load lands.
  function next(game) {
    game = POOLS[game] ? game : "all";
    var p = pools[game];
    if (!p || Date.now() - p.at >= CACHE_MS) load(game);   // refresh in the background
    if (!p || !p.items.length) return null;
    var it = p.items[p.i % p.items.length]; p.i++;
    return it;
  }

  // Game for the live board from the tournament key it resolved:
  // TOM ids (MM-DD-n) are Pokémon; extension keys are x-one / x-rft / x-mtg.
  function gameFromKey(key) {
    key = String(key || "");
    if (/x-one-/.test(key)) return "onepiece";
    if (/x-rft-/.test(key)) return "riftbound";
    if (/x-mtg-/.test(key)) return "mtg";
    if (/\d{2}-\d{2}-\d+$/.test(key)) return "pokemon";
    return "all";
  }

  // Slim rotating bar under the live board (board.html). Only visible while the
  // split board is up (body.tomsplit); hidden on the idle slate.
  function mountBar(host, getKey, secs) {
    if (!host) return;
    secs = secs || 12;
    var shown = null;
    function paint() {
      var game = gameFromKey(getKey ? getKey() : "");
      load(game).then(function () {
        var it = next(game);
        if (!it) { host.hidden = true; return; }
        if (shown === it.handle && host.childNodes.length) return;
        shown = it.handle;
        host.hidden = false;
        host.innerHTML = "";
        var tag = document.createElement("div"); tag.className = "shelf-tag"; tag.textContent = "On the shelf";
        var img = new Image(); img.className = "shelf-img"; img.alt = ""; img.src = it.image;
        img.onerror = function () { img.style.display = "none"; };
        var txt = document.createElement("div"); txt.className = "shelf-txt";
        var name = document.createElement("div"); name.className = "shelf-name"; name.textContent = it.title;
        var sub = document.createElement("div"); sub.className = "shelf-sub"; sub.textContent = (it.label ? it.label + " · " : "") + "grab it at the counter";
        txt.appendChild(name); txt.appendChild(sub);
        var price = document.createElement("div"); price.className = "shelf-price"; price.textContent = it.price;
        host.appendChild(tag); host.appendChild(img); host.appendChild(txt); host.appendChild(price);
      }).catch(function () { host.hidden = true; });
    }
    paint();
    setInterval(paint, secs * 1000);
  }

  global.BGFShelf = { load: load, next: next, mountBar: mountBar, gameFromKey: gameFromKey, cleanTitle: cleanTitle, money: money };
  if (typeof module !== "undefined" && module.exports) module.exports = global.BGFShelf;
})(typeof window !== "undefined" ? window : globalThis);
