'use strict';

const { parseDetails, parseStandings, parsePairings, parseRoster } = require('./parser');

// Compose one Firebase-ready snapshot from the raw report HTML strings.
// Any input may be null/undefined; the composer degrades gracefully.
function buildSnapshot({ detailsHtml, standingsHtml, pairingsHtml, rosterHtml, config } = {}) {
  const cfg = config || {};
  const details = detailsHtml ? parseDetails(detailsHtml) : null;
  const standings = standingsHtml ? parseStandings(standingsHtml) : null;
  const pairings = pairingsHtml ? parsePairings(pairingsHtml) : null;
  const roster = rosterHtml ? parseRoster(rosterHtml) : null;

  // ---- divisions (from details; fall back to standings labels) ----
  const divIndex = {};
  const divisions = [];
  const addDiv = d => { if (!divIndex[d.id]) { divIndex[d.id] = d; divisions.push(d); } };
  if (details) details.divisions.forEach(addDiv);
  if (standings) standings.divisions.forEach(d => addDiv({ id: d.id, label: d.label, cutSize: 0 }));

  // cutSize resolution: config override wins, else TOM "Finals Players", else 0
  const cutFor = id => {
    if (cfg.cutSizes && (cfg.cutSizes[id] != null)) return cfg.cutSizes[id];
    if (cfg.cutSizes && cfg.cutSizes.default != null && divIndex[id] && !divIndex[id].cutSize) return cfg.cutSizes.default;
    return (divIndex[id] && divIndex[id].cutSize) || 0;
  };

  // ---- standings by division id, with cut flags ----
  const standingsOut = {};
  if (standings) {
    for (const d of standings.divisions) {
      const cut = cutFor(d.id);
      standingsOut[d.id] = {
        label: d.label,
        round: d.roundLabel ? d.roundLabel.round : null,
        totalRounds: d.roundLabel ? d.roundLabel.totalRounds : null,
        cutSize: cut,
        rows: d.rows.map(r => ({ ...r, cut: cut > 0 && r.rank <= cut })),
      };
    }
  }

  // ---- pairings by group + flat byTable map (for tap-view lookups) ----
  const groupsOut = {};
  const byTable = {};
  let round = pairings ? pairings.round : null;
  if (pairings) {
    for (const g of pairings.groups) {
      const tables = g.matches.map(m => ({
        table: m.table,
        group: g.id,
        status: 'paired',              // TOM reports carry no live per-table result; see README
        players: m.players.map(p => ({
          name: p.name,
          division: p.division || (g.id === 'MA' ? 'MA' : null),
          record: p.record,
          points: p.record ? p.record.points : null,
        })),
      }));
      tables.forEach(t => { byTable[t.table] = t; });
      groupsOut[g.id] = {
        label: g.label,
        tables,
        byes: g.byes.map(b => ({ name: b.name, division: b.division, record: b.record })),
      };
    }
  }

  const generatedAt =
    (standings && standings.generatedAt) ||
    (pairings && pairings.generatedAt) ||
    (details && details.generatedAt) || null;

  return {
    meta: {
      name: (details && details.name) || cfg.displayName || null,
      tournamentId: (details && details.tournamentId) || cfg.tournamentId || null,
      gameType: details && details.gameType,
      mode: details && details.mode,
      pairingType: details && details.pairingType,
      organizer: details && details.organizer,
      location: details && details.location,
      round,
      generatedAt,
      updatedMs: Date.now(),
    },
    divisions: divisions.map(d => ({ ...d, cutSize: cutFor(d.id) })),
    standings: standingsOut,
    pairings: { round, groups: groupsOut, byTable },
    roster: roster ? roster.divisions.map(d => ({ id: d.id, label: d.label, entered: d.entered })) : null,
  };
}

module.exports = { buildSnapshot };
