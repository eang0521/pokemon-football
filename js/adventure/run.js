// Adventure (roguelike) mode: run state, branching act maps, opponents that scale with
// progress, battle results, and the non-battle stops. Pure logic (no DOM): the UI in
// js/adventure/ui.js drives it, and tools/adventure-sim.mjs can play whole runs headless.
import { RNG } from '../rng.js';
import { POKEMON } from '../data/pokemon.js';
import { COACH_PRESETS } from '../data/teams.js';
import { POSITIONS } from '../ratings.js';
import { ALL_SLOTS, STARTERS, cardValue } from '../roster.js';
import { tierFor, SYNERGIES } from '../synergy.js';
import { randomCard, openPack, priceOf, sellValue, pctOfCard, ovrOf, trainingBoost, randomPos } from './cards.js';

export const ACTS = 3;
export const ROWS = 7; // regular rows per act (0..6); the boss is row 7
const COLS = 5;
export const START_LIVES = 3;
export const INJURY_GAMES = 2; // an injured card misses this many battles
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export const NODE_INFO = {
  battle: { name: 'Battle', icon: '⚔️', desc: 'Play a random team' },
  elite: { name: 'Elite battle', icon: '💀', desc: 'A tougher, type-themed team. Bigger rewards' },
  boss: { name: 'Boss', icon: '👑', desc: 'Beat the boss to finish the act' },
  pack: { name: 'Card pack', icon: '🎁', desc: 'Open a free pack of 5 cards' },
  shop: { name: 'Shop', icon: '🛒', desc: 'Buy cards, packs, healing; sell cards' },
  training: { name: 'Training camp', icon: '💪', desc: 'Upgrade a card or teach it a new position' },
  rest: { name: 'Rest stop', icon: '⛺', desc: 'Heal injuries or recover a life' },
  event: { name: 'Event', icon: '❓', desc: 'Something unexpected' },
};
export const BOSS_TITLES = ['Gym Leader', 'Elite Four', 'Champion'];

// ---------------------------------------------------------------- seeds
function hash(...parts) {
  let h = 2166136261;
  for (const ch of parts.join('|')) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const rngFor = (run, ...parts) => new RNG(hash(run.seed, ...parts));

// ---------------------------------------------------------------- difficulty
// Run progress 0..1 at a row of an act (boss row = ROWS).
export const progress = (act, row) => ((act - 1) * (ROWS + 1) + row) / (ACTS * (ROWS + 1));
// Typical opponent card percentile for a stop.
export function strength(act, row, type) {
  let c = 4 + 56 * Math.pow(progress(act, row), 1.3);
  if (type === 'elite') c += 7;
  if (type === 'boss') c += [2, 5, 8][act - 1];
  return clamp(c, 5, 97);
}
const bandWidth = (type) => (type === 'battle' ? 8 : 6);
// Where packs and shops pitch their cards: a bit ahead of the next battle.
const lootCenter = (run, row) => strength(run.act, row, 'battle') + 10;

// ---------------------------------------------------------------- cards / collection
export function addCard(run, c) {
  const card = { uid: `c${run.nextUid++}`, mon: c.mon, pos: c.pos, bonus: c.bonus ? { ...c.bonus } : {}, inj: 0 };
  run.cards.push(card);
  return card;
}
export const cardByUid = (run, uid) => run.cards.find((c) => c.uid === uid) || null;
export function removeCard(run, uid) {
  run.cards = run.cards.filter((c) => c.uid !== uid);
  for (const k in run.lineup) if (run.lineup[k] === uid) delete run.lineup[k];
}
export const healthy = (c) => !(c.inj > 0);
export const ownedMons = (run) => new Set(run.cards.map((c) => c.mon));

// Best lineup from healthy cards (greedy, strongest first; one card per Pokémon).
// keep=true keeps current valid assignments and only fills the gaps.
const SLOT_ORDER = [...STARTERS.filter((s) => s.pos.length === 1), ...STARTERS.filter((s) => s.pos.length > 1), ...ALL_SLOTS.filter((s) => s.unit === 'B')];
// What a type-synergy tier is worth when comparing lineups, in total starter OVR. From the
// synergy calibration (tools/synergy-calibrate.mjs), a tier-II synergy adds ~7% win rate,
// about what +10 total OVR across the starters buys.
export const SYNERGY_WORTH = [0, 1, 2, 3];
const UNITS = ['O', 'D'].map((u) => STARTERS.filter((s) => s.unit === u));

// Starting lineup value: starters' OVR plus active type synergies in each unit.
export function lineupScore(run, lineup, ovr = new Map()) {
  const byUid = new Map(run.cards.map((c) => [c.uid, c]));
  const o = (c) => { if (!ovr.has(c.uid)) ovr.set(c.uid, ovrOf(c)); return ovr.get(c.uid); };
  let total = 0;
  for (const s of STARTERS) { const c = byUid.get(lineup[s.key]); total += c ? o(c) : 30; } // 30: a walk-on
  for (const unit of UNITS) {
    const counts = {};
    for (const s of unit) { const c = byUid.get(lineup[s.key]); if (c) for (const t of POKEMON[c.mon].types) counts[t] = (counts[t] || 0) + 1; }
    for (const t in counts) if (SYNERGIES[t]) total += SYNERGY_WORTH[tierFor(counts[t])];
  }
  return total;
}

// Best starters for the synergy-aware score: greedy lineups (plain, and one leaning toward
// each type the collection could stack), each improved by single swaps; keep the best.
function bestStarters(run, ranked) {
  const ovr = new Map(ranked.map((x) => [x.c.uid, x.ovr]));
  const cards = ranked.map((x) => x.c);
  const byUid = new Map(cards.map((c) => [c.uid, c]));
  const score = (l) => lineupScore(run, l, ovr);
  const order = [...STARTERS.filter((s) => s.pos.length === 1), ...STARTERS.filter((s) => s.pos.length > 1)];
  const greedy = (bias) => {
    const l = {}, used = new Set();
    const pool = cards.map((c) => ({ c, v: ovr.get(c.uid) + (bias && POKEMON[c.mon].types.includes(bias) ? 8 : 0) })).sort((a, b) => b.v - a.v);
    for (const s of order) {
      const pick = pool.find(({ c }) => s.pos.includes(c.pos) && !used.has(c.mon));
      if (pick) { l[s.key] = pick.c.uid; used.add(pick.c.mon); }
    }
    return l;
  };
  const improve = (l) => {
    let best = score(l);
    for (let pass = 0; pass < 6; pass++) {
      let improved = false;
      for (const s of STARTERS) {
        for (const c of cards) {
          if (!s.pos.includes(c.pos) || l[s.key] === c.uid) continue;
          const t = { ...l }, cur = t[s.key];
          const from = STARTERS.find((x) => t[x.key] === c.uid);
          if (from) { // swap two starters (only if the other card fits there)
            const cc = byUid.get(cur);
            if (!cc || !from.pos.includes(cc.pos)) continue;
            t[from.key] = cur;
          } else if (STARTERS.some((x) => x.key !== s.key && byUid.get(t[x.key])?.mon === c.mon)) continue;
          t[s.key] = c.uid;
          const sc = score(t);
          if (sc > best + 1e-6) { best = sc; l = t; improved = true; }
        }
      }
      if (!improved) break;
    }
    return { l, best };
  };
  const typeCounts = {};
  for (const c of cards) for (const t of POKEMON[c.mon].types) typeCounts[t] = (typeCounts[t] || 0) + 1;
  const seeds = [null, ...Object.keys(typeCounts).filter((t) => typeCounts[t] >= 2)];
  let top = null;
  for (const b of seeds) { const r = improve(greedy(b)); if (!top || r.best > top.best) top = r; }
  return top.l;
}

export function autoLineup(run, keep = false) {
  const next = {}, usedUid = new Set(), usedMon = new Set();
  const ranked = run.cards.filter(healthy).map((c) => ({ c, ovr: ovrOf(c) })).sort((a, b) => b.ovr - a.ovr);
  if (!keep) {
    const st = bestStarters(run, ranked);
    for (const k in st) { const c = run.cards.find((x) => x.uid === st[k]); next[k] = c.uid; usedUid.add(c.uid); usedMon.add(c.mon); }
  }
  if (keep) {
    for (const s of SLOT_ORDER) {
      const c = cardByUid(run, run.lineup[s.key]);
      if (c && healthy(c) && s.pos.includes(c.pos) && !usedMon.has(c.mon) && !usedUid.has(c.uid)) {
        next[s.key] = c.uid; usedUid.add(c.uid); usedMon.add(c.mon);
      }
    }
  }
  for (const s of SLOT_ORDER) {
    if (next[s.key]) continue;
    const pick = ranked.find(({ c }) => s.pos.includes(c.pos) && !usedUid.has(c.uid) && !usedMon.has(c.mon));
    if (pick) { next[s.key] = pick.c.uid; usedUid.add(pick.c.uid); usedMon.add(pick.c.mon); }
  }
  // Repair: an empty slot whose position is sitting in a FLEX slot, while a spare card of about
  // the same strength could play that FLEX -> move the FLEX card over and start the spare.
  // (Never weaken the starting FLEX much just to fill a slot.)
  for (const s of SLOT_ORDER) {
    if (next[s.key]) continue;
    for (const fx of STARTERS.filter((x) => x.pos.length > 1)) {
      const held = cardByUid(run, next[fx.key]);
      if (!held || !s.pos.includes(held.pos)) continue;
      const spare = ranked.find(({ c }) => fx.pos.includes(c.pos) && !usedUid.has(c.uid) && !usedMon.has(c.mon));
      if (!spare || spare.ovr < ovrOf(held) - 3) continue;
      next[s.key] = held.uid;
      next[fx.key] = spare.c.uid; usedUid.add(spare.c.uid); usedMon.add(spare.c.mon);
      break;
    }
  }
  run.lineup = next;
}

// After any roster change: re-optimize when the player lets us manage the lineup,
// otherwise just fill gaps (injuries, sold cards).
export function refreshLineup(run) { autoLineup(run, run.autoManage === false); }

// Lineup problems the player should know about (slots that will get walk-ons).
export function lineupGaps(run) {
  return ALL_SLOTS.filter((s) => { const c = cardByUid(run, run.lineup[s.key]); return !c || !healthy(c) || !s.pos.includes(c.pos); });
}

// Assign a card to a slot (swapping with wherever it was), enforcing one card per Pokémon.
export function assignSlot(run, slotKey, uid) {
  run.autoManage = false; // a manual change: stop re-optimizing their lineup
  const slot = ALL_SLOTS.find((s) => s.key === slotKey);
  const c = cardByUid(run, uid);
  if (!slot || !c || !slot.pos.includes(c.pos)) return false;
  const prev = run.lineup[slotKey];
  for (const k in run.lineup) {
    if (k === slotKey) continue;
    const o = cardByUid(run, run.lineup[k]);
    if (run.lineup[k] === uid) { // moving from another slot: swap if the old card fits there
      const pc = cardByUid(run, prev), ks = ALL_SLOTS.find((s) => s.key === k);
      if (pc && ks.pos.includes(pc.pos)) run.lineup[k] = prev; else delete run.lineup[k];
    } else if (o && o.mon === c.mon) delete run.lineup[k]; // same Pokémon elsewhere
  }
  run.lineup[slotKey] = uid;
  return true;
}

// Team object for the game engine. Empty or injured slots get walk-ons (weak, temporary).
export function gameTeam(run) {
  const roster = {}, bonus = {}, walkOns = [];
  const used = new Set(Object.values(run.lineup).map((u) => cardByUid(run, u)?.mon).filter(Boolean));
  const rng = rngFor(run, 'walkon', run.act, run.path.length);
  for (const s of ALL_SLOTS) {
    let c = cardByUid(run, run.lineup[s.key]);
    if (!c || !healthy(c) || !s.pos.includes(c.pos)) {
      c = randomCard(rng, s.pos[0], 0, 5, used);
      used.add(c.mon);
      walkOns.push({ slot: s.key, mon: c.mon, pos: c.pos });
    }
    roster[s.key] = cardValue(c.mon, c.pos, s.key);
    if (c.bonus && Object.keys(c.bonus).length) bonus[s.key] = c.bonus;
  }
  const t = run.team;
  return { id: 'adv', city: t.city, name: t.name, abbr: t.abbr, colors: t.colors, coach: t.coach, roster, bonus, walkOns };
}

// ---------------------------------------------------------------- run
export function newRun({ team, seed = Math.floor(Math.random() * 1e9) }) {
  const run = {
    v: 1, id: `adv${seed.toString(36)}${Date.now().toString(36)}`, created: Date.now(), updated: Date.now(), seed,
    status: 'active', team, autoManage: true, lives: START_LIVES, maxLives: START_LIVES, coins: 60,
    act: 1, maps: {}, pos: null, path: [], cards: [], nextUid: 1, lineup: {}, node: null, log: [],
    stats: { w: 0, l: 0, t: 0, pf: 0, pa: 0 },
  };
  // starting roster: one card per slot, all in the 5th-15th percentile at their position
  const rng = rngFor(run, 'start');
  const avoid = new Set();
  for (const s of ALL_SLOTS) {
    const pos = s.pos.length > 1 ? rng.pick(s.pos) : s.pos[0];
    const c = randomCard(rng, pos, 5, 15, avoid);
    avoid.add(c.mon);
    addCard(run, c);
  }
  autoLineup(run);
  // any slot the lineup still can't fill gets its own starter-level card
  for (const s of lineupGaps(run)) {
    const c = randomCard(rng, rng.pick(s.pos), 5, 15, avoid);
    avoid.add(c.mon);
    addCard(run, c);
  }
  autoLineup(run);
  run.maps[1] = genMap(rngFor(run, 'map', 1));
  logEvent(run, `A new adventure begins with a 23-card roster.`);
  return run;
}

export function logEvent(run, text) { run.log.push({ act: run.act, n: run.path.length, text }); if (run.log.length > 200) run.log.shift(); }

// ---------------------------------------------------------------- map
// Slay-the-Spire style: several random walks up a 5-column grid, with no crossing edges.
export function genMap(rng) {
  const rows = Array.from({ length: ROWS }, () => new Map());
  const edges = Array.from({ length: ROWS - 1 }, () => new Set());
  const starts = [0, 1, 2, 3, 4].sort(() => rng.next() - 0.5);
  for (let p = 0; p < 5; p++) {
    let c = p < 3 ? starts[p] : rng.int(0, COLS - 1);
    for (let r = 0; r < ROWS; r++) {
      if (!rows[r].has(c)) rows[r].set(c, { row: r, col: c, type: null, next: [] });
      if (r === ROWS - 1) break;
      const opts = [c - 1, c, c + 1].filter((x) => x >= 0 && x < COLS &&
        !(x === c + 1 && edges[r].has(`${c + 1}>${c}`)) && !(x === c - 1 && edges[r].has(`${c - 1}>${c}`)));
      const nx = rng.pick(opts);
      edges[r].add(`${c}>${nx}`);
      c = nx;
    }
  }
  const out = rows.map((m) => [...m.values()].sort((a, b) => a.col - b.col));
  edges.forEach((set, r) => {
    for (const e of set) { const [a, b] = e.split('>').map(Number); out[r].find((n) => n.col === a).next.push(b); }
    for (const n of out[r]) n.next.sort((a, b) => a - b);
  });
  // node types
  const parentsOf = (r, col) => (r === 0 ? [] : out[r - 1].filter((n) => n.next.includes(col)));
  for (let r = 0; r < ROWS; r++) {
    for (const n of out[r]) {
      let w;
      if (r === 0) w = { battle: 1 };
      else if (r === ROWS - 1) w = { rest: 5, shop: 3, training: 2 };
      else w = { battle: 36, elite: r >= 2 ? 13 : 0, event: 15, pack: 12, shop: r >= 2 ? 9 : 0, training: r >= 2 ? 8 : 0, rest: r >= 3 ? 7 : 0 };
      const items = Object.entries(w).map(([type, x]) => ({ type, w: x }));
      let t = rng.weighted(items).type;
      for (let k = 0; k < 4 && t !== 'battle' && parentsOf(r, n.col).some((p) => p.type === t); k++) t = rng.weighted(items).type;
      n.type = t;
    }
  }
  return { rows: out, boss: { row: ROWS, col: 2, type: 'boss', next: [] } };
}

export const mapOf = (run) => run.maps[run.act];
export function nodeAt(run, row, col) {
  const m = mapOf(run);
  return row === ROWS ? m.boss : m.rows[row]?.find((n) => n.col === col) || null;
}
// Stops the player can go to next.
export function available(run) {
  if (run.status !== 'active' || run.node) return [];
  const m = mapOf(run);
  if (!run.pos) return m.rows[0];
  if (run.pos.row === ROWS - 1) return [m.boss];
  const cur = nodeAt(run, run.pos.row, run.pos.col);
  return m.rows[run.pos.row + 1].filter((n) => cur.next.includes(n.col));
}

// ---------------------------------------------------------------- entering / leaving stops
export function enterNode(run, row, col) {
  const n = available(run).find((x) => x.row === row && x.col === col);
  if (!n) return null;
  const node = { row, col, type: n.type, stage: 'intro', attempt: 0 };
  const rng = rngFor(run, 'node', run.act, row, col);
  if (n.type === 'battle' || n.type === 'elite' || n.type === 'boss') node.opponent = makeOpponent(run, row, col, n.type);
  else if (n.type === 'pack') node.pack = openPack(rng, lootCenter(run, row), 5, new Set());
  else if (n.type === 'shop') node.shop = makeShop(run, rng, row);
  else if (n.type === 'event') node.event = pickEvent(run, rng, row);
  run.node = node;
  return node;
}

export function completeNode(run) {
  const node = run.node;
  if (!node) return;
  run.path.push({ act: run.act, row: node.row, col: node.col, type: node.type });
  run.pos = { row: node.row, col: node.col };
  run.node = null;
  if (node.type === 'boss') {
    if (run.act >= ACTS) { run.status = 'won'; logEvent(run, 'Champions! The adventure is complete.'); return; }
    run.act++;
    run.pos = null;
    run.maps[run.act] = genMap(rngFor(run, 'map', run.act));
    logEvent(run, `Act ${run.act} begins.`);
  }
}

// ---------------------------------------------------------------- opponents
const CITIES = ['Pallet', 'Viridian', 'Pewter', 'Cerulean', 'Vermilion', 'Lavender', 'Celadon', 'Fuchsia', 'Saffron', 'Cinnabar',
  'Violet', 'Azalea', 'Goldenrod', 'Ecruteak', 'Olivine', 'Cianwood', 'Mahogany', 'Blackthorn', 'Rustboro', 'Dewford', 'Slateport',
  'Mauville', 'Lavaridge', 'Fortree', 'Lilycove', 'Mossdeep', 'Sootopolis', 'Jubilife', 'Oreburgh', 'Eterna', 'Hearthome',
  'Veilstone', 'Pastoria', 'Canalave', 'Snowpoint', 'Sunyshore', 'Striaton', 'Nacrene', 'Castelia', 'Nimbasa', 'Driftveil',
  'Mistralton', 'Icirrus', 'Opelucid', 'Lumiose', 'Santalune', 'Cyllage', 'Shalour', 'Coumarine', 'Laverre', 'Anistar',
  'Snowbelle', 'Malie', 'Konikoni', 'Motostoke', 'Hammerlocke', 'Circhester', 'Spikemuth', 'Mesagoza', 'Levincia', 'Cascarrafa',
  'Medali', 'Montenevera', 'Alfornada'];
const MASCOTS = {
  normal: ['Stampede', 'Regulars', 'Roughnecks'], fire: ['Flames', 'Inferno', 'Blaze'], water: ['Tide', 'Riptide', 'Mariners'],
  grass: ['Thorns', 'Timber', 'Sprouts'], electric: ['Volts', 'Sparks', 'Surge'], ice: ['Blizzard', 'Glaciers', 'Frost'],
  fighting: ['Brawlers', 'Fists', 'Bruisers'], poison: ['Vipers', 'Venom', 'Toxins'], ground: ['Quakes', 'Diggers', 'Dunes'],
  flying: ['Hawks', 'Falcons', 'Gales'], psychic: ['Oracles', 'Minds', 'Seers'], bug: ['Swarm', 'Hornets', 'Hive'],
  rock: ['Boulders', 'Rockslide', 'Stones'], ghost: ['Phantoms', 'Specters', 'Haunts'], dragon: ['Dragons', 'Wyverns', 'Drakes'],
  dark: ['Shadows', 'Outlaws', 'Nightfall'], steel: ['Ironclads', 'Forge', 'Titans'], fairy: ['Pixies', 'Charms', 'Glimmer'],
};
const TYPE_HEX = {
  normal: '#8a8a6a', fire: '#e2542b', water: '#3d7dca', grass: '#4e9a2f', electric: '#e0b90b', ice: '#4fb3c9', fighting: '#b22f22',
  poison: '#8d3fa0', ground: '#b8923e', flying: '#6f7fd6', psychic: '#e04a7c', bug: '#8a9a1a', rock: '#9c8a3c', ghost: '#5a4a8a',
  dragon: '#5a3ad6', dark: '#4a3a30', steel: '#7a8a9a', fairy: '#d97fc0',
};
const COACHES = ['Blaine', 'Bruno', 'Clair', 'Flint', 'Grimsley', 'Hala', 'Iris', 'Kabu', 'Lance', 'Marnie', 'Nessa', 'Piers', 'Raihan',
  'Roxie', 'Sabrina', 'Skyla', 'Volkner', 'Wattson', 'Winona', 'Morty', 'Koga', 'Erika', 'Misty', 'Brock', 'Surge', 'Janine', 'Pryce',
  'Jasmine', 'Chuck', 'Whitney', 'Bugsy', 'Falkner', 'Roxanne', 'Brawly', 'Flannery', 'Norman', 'Tate', 'Liza', 'Juan', 'Roark',
  'Gardenia', 'Maylene', 'Wake', 'Fantina', 'Byron', 'Candice', 'Cilan', 'Lenora', 'Burgh', 'Elesa', 'Clay', 'Brycen', 'Drayden',
  'Viola', 'Grant', 'Korrina', 'Ramos', 'Clemont', 'Valerie', 'Olympia', 'Wulfric', 'Milo', 'Bea', 'Allister', 'Opal', 'Gordie',
  'Melony', 'Katy', 'Brassius', 'Iono', 'Kofu', 'Larry', 'Ryme', 'Tulip', 'Grusha'];
const TYPES = Object.keys(MASCOTS);

export function makeOpponent(run, row, col, type) {
  const rng = rngFor(run, 'opp', run.act, row, col);
  const c = strength(run.act, row, type), w = bandWidth(type);
  // Elites and bosses are built around a type (like a Gym); some regular teams lean on one too.
  const theme = type !== 'battle' ? rng.pick(TYPES) : rng.chance(0.35) ? rng.pick(TYPES) : null;
  const themeRate = type === 'boss' ? 0.85 : type === 'elite' ? 0.7 : 0.4;
  const roster = {}, avoid = new Set(), counts = {};
  for (const s of ALL_SLOTS) {
    const pos = s.pos.length > 1 ? rng.pick(s.pos) : s.pos[0];
    const themed = theme && rng.chance(themeRate);
    const card = themed ? randomCard(rng, pos, c - w - 5, c + w, avoid, [theme]) : randomCard(rng, pos, c - w, c + w, avoid);
    avoid.add(card.mon);
    roster[s.key] = cardValue(card.mon, card.pos, s.key);
    if (s.unit !== 'B') for (const t of POKEMON[card.mon].types) counts[t] = (counts[t] || 0) + 1;
  }
  const main = theme || Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  let city = rng.pick(CITIES);
  let abbr = city.slice(0, 3).toUpperCase();
  if (abbr === run.team.abbr) abbr = (city.slice(0, 2) + city.slice(-1)).toUpperCase();
  const preset = rng.pick(Object.keys(COACH_PRESETS));
  const second = TYPE_HEX[rng.pick(TYPES.filter((t) => t !== main))];
  return {
    id: `opp${run.act}${row}${col}`, city, name: rng.pick(MASCOTS[main]), abbr,
    colors: { primary: TYPE_HEX[main], secondary: second },
    coach: { name: `${type === 'boss' ? BOSS_TITLES[run.act - 1] : 'Coach'} ${rng.pick(COACHES)}`, preset, ...COACH_PRESETS[preset] },
    roster, kind: type, theme, strength: Math.round(c),
  };
}

// ---------------------------------------------------------------- battles
export const battleSeed = (run) => hash(run.seed, 'game', run.act, run.node.row, run.node.col, run.node.attempt);

// result: { pf, pa, injuredSlots: [slotKey] } from the finished game.
export function applyBattle(run, { pf, pa, injuredSlots = [] }) {
  const node = run.node, type = node.type, opp = node.opponent;
  const rng = rngFor(run, 'reward', run.act, node.row, node.col, node.attempt);
  const win = pf > pa, tie = pf === pa;
  run.stats.pf += pf; run.stats.pa += pa;
  if (win) run.stats.w++; else if (tie) run.stats.t++; else run.stats.l++;
  // injuries: time served, then new ones
  for (const c of run.cards) if (c.inj > 0) c.inj--;
  const hurt = [];
  for (const k of injuredSlots) {
    const c = cardByUid(run, run.lineup[k]);
    if (c) { c.inj = INJURY_GAMES; hurt.push(c); }
  }
  const out = { win, tie, pf, pa, coins: 0, lifeLost: false, lifeGained: false, draft: [], hurt: hurt.map((c) => `${POKEMON[c.mon].name} (${c.pos})`), retry: false };
  const base = { battle: 35 + 10 * run.act, elite: 80 + 20 * run.act, boss: 120 + 30 * run.act }[type];
  if (win) {
    out.coins = base + rng.int(0, 15);
    out.picks = type === 'battle' ? 1 : 2; // elites and bosses: take 2 of 4
    out.draft = draftOptions(run, rng, opp, type === 'battle' ? 3 : 4);
    if (type === 'boss' && run.lives < run.maxLives) { run.lives++; out.lifeGained = true; }
  } else if (tie) {
    out.coins = Math.round(base / 2);
    if (type === 'boss') out.retry = true;
  } else {
    out.coins = 10;
    run.lives--; out.lifeLost = true;
    if (run.lives <= 0) run.status = 'lost';
    else if (type === 'boss') out.retry = true;
  }
  run.coins += out.coins;
  const vs = `${opp.city} ${opp.name}`;
  logEvent(run, `${win ? 'Beat' : tie ? 'Tied' : 'Lost to'} the ${vs} ${pf}-${pa}${out.lifeLost ? ' (−1 life)' : ''}.`);
  if (run.status === 'lost') logEvent(run, 'Out of lives. The adventure is over.');
  refreshLineup(run);
  node.stage = 'result';
  node.result = out;
  return out;
}

// After a win: pick 1 of 3 cards from the beaten team (their better players are likelier).
function draftOptions(run, rng, opp, n) {
  const cards = ALL_SLOTS.map((s) => {
    const [mon, p] = String(opp.roster[s.key]).split(':');
    return { mon, pos: p || s.pos[0] };
  }).filter((c) => !run.cards.some((o) => o.mon === c.mon && o.pos === c.pos))
    .map((c) => ({ c, ovr: ovrOf(c) })).sort((a, b) => b.ovr - a.ovr);
  const out = [];
  while (out.length < n && cards.length) {
    const i = Math.min(cards.length - 1, Math.floor(Math.pow(rng.next(), 1.6) * cards.length));
    out.push(cards.splice(i, 1)[0].c);
  }
  return out;
}

export function takeDraft(run, i) {
  const r = run.node?.result;
  if (!r) return null;
  r.drafted = r.drafted || [];
  const c = r.draft[i];
  if (!c || r.drafted.includes(i) || r.drafted.length >= (r.picks || 1)) return null;
  r.drafted.push(i);
  const card = addCard(run, c);
  refreshLineup(run);
  logEvent(run, `Drafted ${POKEMON[c.mon].name} (${c.pos}).`);
  return card;
}

// After a boss loss or tie: try again (new game seed, same opponent).
export function retryBattle(run) {
  if (!run.node?.result?.retry) return;
  run.node.attempt++;
  run.node.stage = 'intro';
  delete run.node.result;
}

// ---------------------------------------------------------------- packs
export function takePack(run) {
  const node = run.node;
  if (!node?.pack || node.taken) return [];
  node.taken = true;
  const got = node.pack.map((c) => addCard(run, c));
  refreshLineup(run);
  logEvent(run, `Opened a pack: ${node.pack.map((c) => `${POKEMON[c.mon].name} ${c.pos}`).join(', ')}.`);
  return got;
}

// ---------------------------------------------------------------- shop
function makeShop(run, rng, row) {
  const c = lootCenter(run, row);
  const bands = [[c - 6, c + 4], [c - 2, c + 8], [c + 4, c + 14], [c + 10, c + 20], [c + 16, c + 28], [c + 24, c + 38]];
  const avoid = new Set();
  const cards = bands.map(([lo, hi]) => {
    const card = randomCard(rng, randomPos(rng), lo, hi, avoid);
    avoid.add(card.mon);
    return { ...card, price: priceOf(pctOfCard(card)), sold: false };
  });
  return {
    cards,
    items: [
      { key: 'pack', name: 'Card pack (5 cards)', price: 55 + 15 * run.act, sold: false },
      { key: 'heal', name: 'Team physio: heal all injuries', price: 30, sold: false },
      { key: 'life', name: 'Second wind: +1 life', price: 90 + 20 * run.act, sold: false },
    ],
    packCenter: c,
  };
}

export function buyCard(run, i) {
  const s = run.node?.shop, item = s?.cards[i];
  if (!item || item.sold || run.coins < item.price) return null;
  run.coins -= item.price; item.sold = true;
  const card = addCard(run, item);
  refreshLineup(run);
  logEvent(run, `Bought ${POKEMON[item.mon].name} (${item.pos}) for ${item.price} coins.`);
  return card;
}
export function buyItem(run, key) {
  const s = run.node?.shop, item = s?.items.find((x) => x.key === key);
  if (!item || item.sold || run.coins < item.price) return null;
  if (key === 'life' && run.lives >= run.maxLives) return null;
  if (key === 'heal' && !run.cards.some((c) => c.inj > 0)) return null;
  run.coins -= item.price; item.sold = true;
  let got = null;
  if (key === 'pack') {
    got = openPack(rngFor(run, 'shoppack', run.act, run.node.row), s.packCenter, 5, new Set()).map((c) => addCard(run, c));
    logEvent(run, `Bought a pack: ${got.map((c) => `${POKEMON[c.mon].name} ${c.pos}`).join(', ')}.`);
  } else if (key === 'heal') { healAll(run); logEvent(run, 'Paid the physio: everyone is healthy.'); }
  else if (key === 'life') { run.lives++; logEvent(run, 'Bought a second wind (+1 life).'); }
  refreshLineup(run);
  return got || true;
}
export const cardSellValue = (c) => sellValue(pctOfCard(c));
export function sellCard(run, uid) {
  const c = cardByUid(run, uid);
  if (!c || !run.node?.shop) return 0;
  const v = cardSellValue(c);
  run.coins += v;
  removeCard(run, uid);
  refreshLineup(run);
  logEvent(run, `Sold ${POKEMON[c.mon].name} (${c.pos}) for ${v} coins.`);
  return v;
}

// ---------------------------------------------------------------- training / rest
export const trainingAmount = (run) => 6 + 2 * run.act;
export function trainCard(run, uid) {
  const c = cardByUid(run, uid);
  if (!c || run.node?.type !== 'training' || run.node.done) return false;
  const before = ovrOf(c);
  c.bonus = trainingBoost(c, trainingAmount(run));
  run.node.done = true;
  logEvent(run, `Training camp: ${POKEMON[c.mon].name} (${c.pos}) ${before} → ${ovrOf(c)} OVR.`);
  return true;
}
export function retrainCard(run, uid, pos) {
  const c = cardByUid(run, uid);
  if (!c || !POSITIONS.includes(pos) || pos === c.pos || run.node?.type !== 'training' || run.node.done) return false;
  const was = c.pos;
  c.pos = pos;
  run.node.done = true;
  refreshLineup(run);
  logEvent(run, `Training camp: ${POKEMON[c.mon].name} moved from ${was} to ${pos} (${ovrOf(c)} OVR).`);
  return true;
}
export function healAll(run) { for (const c of run.cards) c.inj = 0; refreshLineup(run); }
export function restChoice(run, choice) {
  if (run.node?.type !== 'rest' || run.node.done) return false;
  if (choice === 'heal') { healAll(run); logEvent(run, 'Rested: all injuries healed.'); }
  else if (choice === 'life') {
    if (run.lives >= run.maxLives) return false;
    run.lives++; logEvent(run, 'Rested: recovered a life.');
  } else if (choice === 'coins') { run.coins += 25; logEvent(run, 'Worked a camp: +25 coins.'); }
  run.node.done = true;
  return true;
}

// ---------------------------------------------------------------- events
// Each event: prepare(run, rng, row) -> ctx (plain data, saved with the run); options(run, ctx)
// -> [{ key, label, disabled? }]; resolve(run, ctx, key, rng) -> message.
const nm = (c) => `${POKEMON[c.mon].name} (${c.pos})`;
const starters = (run) => STARTERS.map((s) => cardByUid(run, run.lineup[s.key])).filter(Boolean);
export const EVENTS = {
  freeAgent: {
    title: 'A free agent',
    prepare: (run, rng, row) => ({ card: randomCard(rng, randomPos(rng), lootCenter(run, row) + 4, lootCenter(run, row) + 20, ownedMons(run)) }),
    text: (run, ctx) => `${nm(ctx.card)} was cut by a rival and wants a spot on your team. No contract needed.`,
    options: () => [{ key: 'sign', label: 'Sign them' }, { key: 'pass', label: 'Pass' }],
    resolve: (run, ctx, key) => { if (key !== 'sign') return 'You pass on the free agent.'; addCard(run, ctx.card); return `${nm(ctx.card)} joins the team!`; },
  },
  gamble: {
    title: 'Back-room card game',
    prepare: () => ({ bet: 30, win: 75 }),
    text: (run, ctx) => `A trainer offers a game of chance: put up ${ctx.bet} coins, and win ${ctx.win} back if you beat them.`,
    options: (run, ctx) => [{ key: 'play', label: `Bet ${ctx.bet} coins`, disabled: run.coins < ctx.bet }, { key: 'pass', label: 'Walk away' }],
    resolve: (run, ctx, key, rng) => {
      if (key !== 'play') return 'You keep your coins.';
      run.coins -= ctx.bet;
      if (rng.chance(0.5)) { run.coins += ctx.win; return `You win! +${ctx.win} coins.`; }
      return `You lose the ${ctx.bet} coins.`;
    },
  },
  trade: {
    title: 'Trade offer',
    prepare: (run, rng, row) => {
      const mine = starters(run).filter((c) => c.pos !== 'K');
      const give = rng.pick(mine);
      const pos = rng.pick(POSITIONS.filter((p) => p !== 'K' && p !== give.pos));
      const get = randomCard(rng, pos, Math.max(pctOfCard(give), lootCenter(run, row)) + 6, Math.max(pctOfCard(give), lootCenter(run, row)) + 22, ownedMons(run));
      return { give: give.uid, giveCard: { mon: give.mon, pos: give.pos }, get };
    },
    text: (run, ctx) => `Another team wants your ${nm(ctx.giveCard)} and offers ${nm(ctx.get)} (${ovrOf(ctx.get)} OVR) in return.`,
    options: (run, ctx) => [{ key: 'accept', label: 'Accept the trade', disabled: !cardByUid(run, ctx.give) }, { key: 'pass', label: 'Decline' }],
    resolve: (run, ctx, key) => {
      if (key !== 'accept' || !cardByUid(run, ctx.give)) return 'You keep your roster as it is.';
      removeCard(run, ctx.give); addCard(run, ctx.get);
      return `Trade done: ${nm(ctx.get)} joins, ${nm(ctx.giveCard)} leaves.`;
    },
  },
  twoADays: {
    title: 'Two-a-days',
    prepare: () => ({ amount: 4 }),
    text: (run, ctx) => `Brutal double practices: every starter in one unit gets +${ctx.amount} to their key stats, but someone in that unit will get hurt.`,
    options: () => [{ key: 'O', label: 'Drill the offense' }, { key: 'D', label: 'Drill the defense' }, { key: 'pass', label: 'Take it easy' }],
    resolve: (run, ctx, key, rng) => {
      if (key === 'pass') return 'The team rests up.';
      const unit = STARTERS.filter((s) => s.unit === key).map((s) => cardByUid(run, run.lineup[s.key])).filter(Boolean);
      for (const c of unit) c.bonus = trainingBoost(c, ctx.amount);
      const hurt = rng.pick(unit);
      if (hurt) hurt.inj = INJURY_GAMES;
      return `${key === 'O' ? 'Offensive' : 'Defensive'} starters improve. ${hurt ? `${nm(hurt)} is injured for ${INJURY_GAMES} games.` : ''}`;
    },
  },
  sponsor: {
    title: 'A sponsor calls',
    prepare: (run) => ({ cash: 40 + 10 * run.act }),
    text: (run, ctx) => `A local business wants to sponsor you. Take ${ctx.cash} coins, or a mystery card from their collection?`,
    options: (run, ctx) => [{ key: 'cash', label: `Take ${ctx.cash} coins` }, { key: 'card', label: 'Mystery card (any strength!)' }],
    resolve: (run, ctx, key, rng) => {
      if (key === 'cash') { run.coins += ctx.cash; return `+${ctx.cash} coins.`; }
      const c = randomCard(rng, randomPos(rng), 0, 100, ownedMons(run));
      addCard(run, c);
      return `It's ${nm(c)}: ${ovrOf(c)} OVR!`;
    },
  },
  medic: {
    title: 'Traveling physio',
    prepare: () => ({ price: 20 }),
    when: (run) => run.cards.some((c) => c.inj > 0),
    text: (run, ctx) => `A traveling physio offers to treat your injured players for ${ctx.price} coins.`,
    options: (run, ctx) => [{ key: 'pay', label: `Pay ${ctx.price} coins`, disabled: run.coins < ctx.price }, { key: 'pass', label: 'No thanks' }],
    resolve: (run, ctx, key) => { if (key !== 'pay') return 'You move on.'; run.coins -= ctx.price; healAll(run); return 'Everyone is healthy again.'; },
  },
  film: {
    title: 'Film study',
    prepare: (run, rng) => ({ uids: starters(run).sort(() => rng.next() - 0.5).slice(0, 3).map((c) => c.uid) }),
    text: () => 'Your coaches find a weakness in how your players read the game. Three starters can sharpen up.',
    options: () => [{ key: 'study', label: 'Study the film' }],
    resolve: (run, ctx) => {
      const got = ctx.uids.map((u) => cardByUid(run, u)).filter(Boolean);
      for (const c of got) c.bonus = { ...c.bonus, spd: (c.bonus.spd || 0) + 6 };
      return `${got.map(nm).join(', ')}: +6 Sp. Def (vision, hands, diagnosis or coverage).`;
    },
  },
};

function pickEvent(run, rng, row) {
  const ids = Object.keys(EVENTS).filter((id) => !EVENTS[id].when || EVENTS[id].when(run));
  const id = rng.pick(ids);
  return { id, ctx: EVENTS[id].prepare(run, rng, row), done: false, message: null };
}
export function eventOptions(run) {
  const e = run.node?.event;
  return e ? EVENTS[e.id].options(run, e.ctx) : [];
}
export function resolveEvent(run, key) {
  const e = run.node?.event;
  if (!e || e.done) return null;
  const opt = eventOptions(run).find((o) => o.key === key);
  if (!opt || opt.disabled) return null;
  e.message = EVENTS[e.id].resolve(run, e.ctx, key, rngFor(run, 'event', run.act, run.node.row));
  e.done = true;
  refreshLineup(run);
  logEvent(run, `${EVENTS[e.id].title}: ${e.message}`);
  return e.message;
}

// ---------------------------------------------------------------- summary helpers
export function teamRating(run) {
  const cs = STARTERS.map((s) => cardByUid(run, run.lineup[s.key])).filter(Boolean);
  if (!cs.length) return { ovr: 0, pct: 0 };
  return {
    ovr: Math.round(cs.reduce((a, c) => a + ovrOf(c), 0) / cs.length),
    pct: Math.round(cs.reduce((a, c) => a + pctOfCard(c), 0) / cs.length),
  };
}
export function opponentRating(opp) {
  const cs = STARTERS.map((s) => { const [mon, p] = String(opp.roster[s.key]).split(':'); return { mon, pos: p || s.pos[0] }; });
  return {
    ovr: Math.round(cs.reduce((a, c) => a + ovrOf(c), 0) / cs.length),
    pct: Math.round(cs.reduce((a, c) => a + pctOfCard(c), 0) / cs.length),
  };
}
export const stepsDone = (run) => run.path.length;
