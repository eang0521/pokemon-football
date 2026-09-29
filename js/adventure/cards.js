// Card economy for adventure mode: percentile tables, random cards by strength band,
// prices, packs and training upgrades. Pure logic (no DOM).
import { POKEMON } from '../data/pokemon.js';
import { cardOverall, POSITIONS, STAT_KEYS, STAT_MAP, OVR_WEIGHTS } from '../ratings.js';

const SLUGS = Object.keys(POKEMON);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Per position: every Pokémon's card, weakest to strongest.
const POOL = {};
export function pool(pos) {
  if (!POOL[pos]) POOL[pos] = SLUGS.map((mon) => ({ mon, ovr: cardOverall(mon, pos) })).sort((a, b) => a.ovr - b.ovr);
  return POOL[pos];
}

// Percentile (0-100) of an overall at a position.
export function pctOf(pos, ovr) {
  const P = pool(pos);
  let lo = 0, hi = P.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (P[m].ovr < ovr) lo = m + 1; else hi = m; }
  let top = lo;
  while (top < P.length && P[top].ovr === ovr) top++;
  return clamp(Math.round(((lo + top) / 2 / (P.length - 1)) * 100), 0, 100);
}

// Overall at a given percentile.
export const ovrAtPct = (pos, pct) => { const P = pool(pos); return P[Math.round(clamp(pct, 0, 100) / 100 * (P.length - 1))].ovr; };

// A random card at `pos` whose percentile is in [lo, hi]. `avoid` is a Set of Pokémon
// slugs to skip; `types` (optional) prefers Pokémon of those types.
export function randomCard(rng, pos, lo, hi, avoid = new Set(), types = null) {
  const P = pool(pos), n = P.length - 1;
  lo = clamp(lo, 0, 100); hi = clamp(Math.max(hi, lo + 1), 0, 100);
  const a = Math.floor(lo / 100 * n), b = Math.ceil(hi / 100 * n);
  let cands = [];
  for (let i = a; i <= b; i++) if (!avoid.has(P[i].mon)) cands.push(P[i]);
  if (types) {
    const themed = cands.filter((c) => POKEMON[c.mon].types.some((t) => types.includes(t)));
    if (themed.length) cands = themed;
  }
  if (!cands.length) cands = P.filter((c) => !avoid.has(c.mon));
  return { mon: rng.pick(cands).mon, pos };
}

// Which positions show up in packs (roughly how many roster slots each fills).
export const POS_WEIGHTS = { QB: 1.2, RB: 2, WR: 2.2, TE: 1, OL: 3, DL: 2.5, LB: 2.5, DB: 2.5, K: 0.7 };
export const randomPos = (rng) => rng.weighted(POSITIONS.map((p) => ({ p, w: POS_WEIGHTS[p] }))).p;

// Rarity tiers by percentile.
export const RARITY = [
  { key: 'legendary', name: 'Legendary', min: 92 },
  { key: 'epic', name: 'Epic', min: 75 },
  { key: 'rare', name: 'Rare', min: 50 },
  { key: 'common', name: 'Common', min: 0 },
];
export const rarityOf = (pct) => RARITY.find((r) => pct >= r.min);

// Coin price of a card by percentile.
export const priceOf = (pct) => Math.round(18 + pct * 0.55 + Math.pow(pct / 100, 3) * 130);
export const sellValue = (pct) => Math.max(5, Math.round(priceOf(pct) * 0.35));

// A pack of cards around a strength level (`center` = typical percentile at this point in the run).
export function openPack(rng, center, n = 5, avoid = new Set()) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const r = rng.next();
    let lo, hi;
    if (r < 0.03) { lo = 90; hi = 100; }
    else if (r < 0.12) { lo = center + 22; hi = center + 38; }
    else if (r < 0.37) { lo = center + 8; hi = center + 22; }
    else { lo = center - 12; hi = center + 8; }
    const c = randomCard(rng, randomPos(rng), lo, hi, avoid);
    avoid.add(c.mon);
    out.push(c);
  }
  return out;
}

// Base stats that matter most at a position (by overall weight), strongest first.
export function keyStats(pos) {
  const w = OVR_WEIGHTS[pos], score = {};
  for (const k of STAT_KEYS) score[k] = STAT_MAP[pos][k].reduce((s, t) => s + (w[t] || 0), 0);
  return STAT_KEYS.filter((k) => score[k] > 0).sort((a, b) => score[b] - score[a]);
}

// Training: +amount to the card's two most important stats for its position.
export function trainingBoost(card, amount) {
  const [a, b] = keyStats(card.pos);
  const bonus = { ...(card.bonus || {}) };
  bonus[a] = (bonus[a] || 0) + amount;
  if (b) bonus[b] = (bonus[b] || 0) + amount;
  return bonus;
}

export const ovrOf = (card) => cardOverall(card.mon, card.pos, card.bonus && Object.keys(card.bonus).length ? card.bonus : null);
export const pctOfCard = (card) => pctOf(card.pos, ovrOf(card));
