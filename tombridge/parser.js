'use strict';

const cheerio = require('cheerio');

function norm(s) {
  return (s || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function divIdFromLabel(label) {
  const l = (label || '').toLowerCase();
  if (l.includes('junior') && l.includes('senior')) return 'JR_SR';
  if (l.includes('junior')) return 'JR';
  if (l.includes('senior')) return 'SR';
  if (l.includes('master')) return 'MA';
  return norm(label).toUpperCase().replace(/[^A-Z]+/g, '_');
}

// "2/1/0 (6)" -> { w:2, l:1, t:0, points:6, text:"2/1/0 (6)" }
function parseRecord(text) {
  const m = norm(text).match(/(\d+)\/(\d+)\/(\d+)\s*\((\d+)\)/);
  if (!m) return null;
  return { w: +m[1], l: +m[2], t: +m[3], points: +m[4], text: `${m[1]}/${m[2]}/${m[3]} (${m[4]})` };
}

function parsePercent(text) {
  const m = norm(text).match(/([\d.]+)\s*%/);
  return m ? parseFloat(m[1]) : null;
}

// Footer timestamp, e.g. "07/06/2026 20:30:42"
function parseGeneratedAt($) {
  const t = norm($('.footer td[align="right"] b').first().text());
  return t || null;
}

/* ---------------- tournament_details.html ---------------- */
function parseDetails(html) {
  const $ = cheerio.load(html);
  const kv = {};
  $('table').first().find('tr').each((_, tr) => {
    const tds = $(tr).find('td');
    if (tds.length >= 2) kv[norm($(tds[0]).text()).replace(/:$/, '')] = norm($(tds[1]).text());
  });

  const orgMatch = (kv['Organizer'] || '').match(/^(.*?)\s*\((\d+)\)\s*$/);

  const divisions = [];
  // The second table lists per-division config incl. "Finals Players" (= top cut size)
  const dTable = $('table.report').filter((_, t) => norm($(t).text()).includes('Age Division')).first();
  dTable.find('tr').each((i, tr) => {
    if (i === 0) return; // header
    const td = $(tr).find('td');
    if (td.length < 7) return;
    const label = norm($(td[0]).text());
    divisions.push({
      id: divIdFromLabel(label),
      label,
      totalPlayers: parseInt(norm($(td[1]).text()), 10) || 0,
      swissRounds: parseInt(norm($(td[4]).text()), 10) || null,
      cutSize: parseInt(norm($(td[5]).text()), 10) || 0,   // "Finals Players"
      totalRounds: parseInt(norm($(td[6]).text()), 10) || null,
      startingTable: parseInt(norm($(td[9]).text()), 10) || null,
    });
  });

  return {
    name: kv['Tournament'] || null,
    tournamentId: kv['Tournament ID'] || null,
    location: kv['Location'] || null,
    dateTime: kv['Date/Time'] || null,
    organizer: orgMatch ? { name: norm(orgMatch[1]), id: orgMatch[2] } : { name: kv['Organizer'] || null, id: null },
    mode: kv['Tournament Mode'] || null,
    gameType: kv['Game Type'] || null,
    pairingType: kv['Type'] || null,
    divisions,
    generatedAt: parseGeneratedAt($),
  };
}

/* ---------------- standings.html ---------------- */
function parseStandings(html) {
  const $ = cheerio.load(html);
  const out = [];
  // Each division = an <h2>Label</h2> followed by the next data table.
  $('h2').each((_, h2) => {
    const label = norm($(h2).text());
    // round label from the nearest preceding <h3> "Standings - Round 3/5"
    let roundLabel = null;
    const prevH3 = $(h2).prevAll('h3').first();
    const rm = norm(prevH3.text()).match(/Round\s+([\d]+)\s*\/\s*([\d]+)/i);
    if (rm) roundLabel = { round: +rm[1], totalRounds: +rm[2] };

    const table = $(h2).nextAll('table.report').first();
    const rows = [];
    table.find('tr').each((i, tr) => {
      if (i === 0) return;
      const td = $(tr).find('td');
      if (td.length < 8) return;
      const rec = parseRecord($(td[4]).text());
      rows.push({
        rank: parseInt(norm($(td[0]).text()), 10),
        name: norm($(td[1]).text()),
        flight: norm($(td[2]).text()) || null,
        dropRound: norm($(td[3]).text()) || null,
        record: rec,
        points: parseInt(norm($(td[5]).text()), 10),
        omw: parsePercent($(td[6]).text()),
        oomw: parsePercent($(td[7]).text()),
      });
    });
    out.push({ id: divIdFromLabel(label), label, roundLabel, rows });
  });
  return { divisions: out, generatedAt: parseGeneratedAt($) };
}

/* ---------------- pairings.html ---------------- */
// name cell: "Benjamin Mussett (2/0/0 (6) - JR)" or "Camden Schaneville (2/0/0 (6))"
function parsePlayerCell(text) {
  const t = norm(text);
  if (!t) return null;
  const name = norm(t.split('(')[0]);
  const rec = parseRecord(t);
  const dm = t.match(/-\s*(JR|SR|MA)\s*\)/i);
  return { name, record: rec, division: dm ? dm[1].toUpperCase() : null };
}

function parsePairings(html) {
  const $ = cheerio.load(html);
  let roundNum = null;
  const rh = norm($('body').text()).match(/Pairings\s*-\s*Round\s+(\d+)/i);
  if (rh) roundNum = +rh[1];

  const groups = [];
  let current = null;

  // Walk headings + tables in document order.
  $('body').find('h3, table.report').each((_, el) => {
    const tag = el.tagName.toLowerCase();
    if (tag === 'h3') {
      const txt = norm($(el).text());
      if (/^Pairings\s*-/i.test(txt)) return;      // skip the "Pairings - Round N" heading
      current = { id: divIdFromLabel(txt).replace('JR_SR', 'JR_SR'), label: txt, matches: [], byes: [] };
      groups.push(current);
    } else if (tag === 'table') {
      if (!current) return;
      const seen = new Set();
      $(el).find('tr').each((i, tr) => {
        if (i === 0) return;
        const td = $(tr).find('td');
        if (td.length < 4) return;
        const tableCell = norm($(td[0]).text());
        const p1 = parsePlayerCell($(td[1]).text());
        const p2 = parsePlayerCell($(td[3]).text());
        if (/^bye$/i.test(tableCell)) {
          if (p1) current.byes.push(p1);
          return;
        }
        const tableNum = parseInt(tableCell, 10);
        if (!Number.isFinite(tableNum) || seen.has(tableNum)) return; // dedupe mirrored rows
        seen.add(tableNum);
        current.matches.push({ table: tableNum, players: [p1, p2].filter(Boolean) });
      });
      current.matches.sort((a, b) => a.table - b.table);
    }
  });

  return { round: roundNum, groups, generatedAt: parseGeneratedAt($) };
}

/* ---------------- roster.html ---------------- */
function parseRoster(html) {
  const $ = cheerio.load(html);
  const divisions = [];
  $('h3').each((_, h3) => {
    const label = norm($(h3).text());
    const m = label.match(/^(.*?Division)\s*--\s*(\d+)\s*Players?\s*Entered/i);
    if (!m) return;
    const table = $(h3).nextAll('table.players_table').first();
    const players = [];
    table.find('tbody tr').each((_, tr) => {
      const td = $(tr).find('td');
      if (td.length < 3) return;
      players.push({
        seat: norm($(td[0]).text()) || null,
        name: norm($(td[1]).text()),
        ageDivision: norm($(td[2]).text()) || null,
      });
    });
    divisions.push({ id: divIdFromLabel(m[1]), label: m[1], entered: +m[2], players });
  });
  return { divisions, generatedAt: parseGeneratedAt($) };
}

module.exports = { parseDetails, parseStandings, parsePairings, parseRoster, divIdFromLabel, parseRecord };
