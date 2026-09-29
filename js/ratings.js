// Converts Pokemon base stats into football ratings (roughly 25..99).
//
//   Speed   -> spd (top speed), agi (cuts / jukes, lighter is quicker)
//   Attack  -> str (blocking, tackling, breaking tackles), kick power
//   Defense -> tgh (hard to bring down, ball security)
//   Sp. Atk -> arm (throw velocity), part of accuracy / hands
//   Sp. Def -> awr (reads, reaction, composure), acc, hands
//   HP      -> stm (stamina)
//   Weight  -> mass (collisions), Height -> catch radius / pass deflection
import { POKEMON } from './data/pokemon.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r = (x) => clamp(Math.round(35 + (x - 40) * 0.55), 25, 99);

export function massRating(kg) {
  return clamp(Math.round(20 + Math.log10(Math.max(kg, 0.5)) * 28), 20, 99);
}

export function ratingsFor(slug) {
  const p = POKEMON[slug];
  if (!p) throw new Error(`Unknown Pokemon: ${slug}`);
  const s = p.stats;
  const mass = massRating(p.weight);
  const ratings = {
    spd: r(s.spe),
    agi: clamp(Math.round(0.7 * r(s.spe) + 0.3 * (110 - mass)), 25, 99),
    str: clamp(Math.round(0.72 * r(s.atk) + 0.28 * mass), 25, 99),
    tgh: clamp(Math.round(0.5 * r(s.def) + 0.25 * r(s.hp) + 0.25 * mass), 25, 99),
    arm: r(s.spa),
    acc: clamp(Math.round(0.55 * r(s.spa) + 0.45 * r(s.spd)), 25, 99),
    awr: clamp(Math.round(0.7 * r(s.spd) + 0.3 * r(s.spa)), 25, 99),
    hands: clamp(Math.round(0.55 * r(s.spd) + 0.25 * r(s.spa) + 0.2 * r(s.spe)), 25, 99),
    stm: r(s.hp),
    kpow: clamp(Math.round(0.5 * r(s.atk) + 0.5 * r(s.spa)), 25, 99),
    kacc: clamp(Math.round(0.6 * r(s.spd) + 0.4 * r(s.spa)), 25, 99),
    mass,
  };
  return ratings;
}

// Position overall = weighted blend of the ratings that matter there.
const OVR_WEIGHTS = {
  QB: { arm: 0.3, acc: 0.3, awr: 0.25, spd: 0.15 },
  RB: { spd: 0.3, agi: 0.25, tgh: 0.2, str: 0.15, hands: 0.1 },
  WR: { spd: 0.4, hands: 0.3, agi: 0.2, awr: 0.1 },
  TE: { hands: 0.25, str: 0.25, spd: 0.25, tgh: 0.25 },
  OL: { str: 0.45, tgh: 0.35, awr: 0.1, mass: 0.1 },
  DL: { str: 0.5, spd: 0.2, tgh: 0.15, mass: 0.15 },
  LB: { str: 0.3, spd: 0.3, awr: 0.25, tgh: 0.15 },
  CB: { spd: 0.45, agi: 0.2, awr: 0.2, hands: 0.15 },
  S: { spd: 0.35, awr: 0.3, str: 0.2, hands: 0.15 },
  K: { kpow: 0.5, kacc: 0.5 },
};

export function posGroup(pos) {
  if (pos === 'WR1' || pos === 'WR2') return 'WR';
  if (pos === 'C' || pos === 'G') return 'OL';
  if (pos.startsWith('DL')) return 'DL';
  if (pos.startsWith('LB')) return 'LB';
  if (pos.startsWith('CB')) return 'CB';
  return pos;
}

export function overall(pos, ratings) {
  const w = OVR_WEIGHTS[posGroup(pos)];
  let v = 0;
  for (const k in w) v += w[k] * ratings[k];
  return Math.round(v);
}

export function buildPlayer(team, pos, entry) {
  const p = POKEMON[entry.mon];
  const ratings = ratingsFor(entry.mon);
  return {
    id: `${team.id}-${pos}`,
    teamId: team.id,
    pos,
    slug: entry.mon,
    name: p.name,
    types: p.types,
    height: p.height,
    weight: p.weight,
    dex: p.dex,
    sprites: p.sprites,
    base: p.stats,
    ratings,
    ovr: overall(pos, ratings),
  };
}

// ---------------------------------------------------------------------------
// Type synergy hook (future feature).
// Each rule: if at least `count` players of `type` are on the field for a unit,
// every player on that unit gets `boost` added to the listed ratings.
// Leave empty to disable. Example (commented out):
//   { type: 'electric', count: 3, unit: 'offense', boost: { spd: 2 } },
//   { type: 'steel',    count: 2, unit: 'defense', boost: { tgh: 3 } },
export const TYPE_SYNERGIES = [];

export function applySynergies(players, unit) {
  if (!TYPE_SYNERGIES.length) return players.map((p) => p.ratings);
  const counts = {};
  for (const p of players) for (const t of p.types) counts[t] = (counts[t] || 0) + 1;
  return players.map((p) => {
    const out = { ...p.ratings };
    for (const rule of TYPE_SYNERGIES) {
      if (rule.unit !== unit || (counts[rule.type] || 0) < rule.count) continue;
      for (const k in rule.boost) out[k] = clamp(out[k] + rule.boost[k], 25, 99);
    }
    return out;
  });
}
