// Cards: every card is (Pokémon, position). A card's football ratings are that
// Pokémon's own six base stats, each read with a position-specific meaning.
//
// Traits a position doesn't train still come from the same stat, at a discount
// (e.g. a WR who has to tackle after an interception uses his Attack at 85%).
import { POKEMON } from './data/pokemon.js';

export const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'DB', 'K'];
export const POS_NAMES = {
  QB: 'Quarterback', RB: 'Running Back', WR: 'Wide Receiver', TE: 'Tight End', OL: 'Offensive Line',
  DL: 'Defensive Line', LB: 'Linebacker', DB: 'Defensive Back', K: 'Kicker',
};
export const STAT_KEYS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
export const STAT_SHORT = { hp: 'HP', atk: 'Atk', def: 'Def', spa: 'SpA', spd: 'SpD', spe: 'Spe' };

// What each base stat means at each position -> the sim traits it drives.
export const STAT_MAP = {
  QB: { hp: ['stm'], atk: ['arm'], def: ['tgh'], spa: ['acc'], spd: ['awr'], spe: ['spd'] },
  RB: { hp: ['stm'], atk: ['str'], def: ['tgh', 'passBlk'], spa: ['elu'], spd: ['vision'], spe: ['spd'] },
  WR: { hp: ['stm'], atk: ['str'], def: ['tgh'], spa: ['route'], spd: ['hands'], spe: ['spd'] },
  TE: { hp: ['stm'], atk: ['runBlk', 'passBlk', 'str'], def: ['tgh'], spa: ['route'], spd: ['hands'], spe: ['spd'] },
  OL: { hp: ['stm'], atk: ['runBlk', 'str'], def: ['passBlk', 'tgh'], spa: ['tech'], spd: ['awr'], spe: ['spd'] },
  DL: { hp: ['stm'], atk: ['rushPow', 'str', 'tackle'], def: ['runStop', 'tgh'], spa: ['rushFin'], spd: ['awr'], spe: ['spd'] },
  LB: { hp: ['stm'], atk: ['tackle', 'str'], def: ['runStop', 'tgh'], spa: ['rushFin'], spd: ['cover', 'awr'], spe: ['spd'] },
  DB: { hp: ['stm'], atk: ['tackle', 'str'], def: ['press', 'tgh'], spa: ['ball', 'hands'], spd: ['cover', 'awr'], spe: ['spd'] },
  K: { hp: ['stm'], atk: ['kpow'], def: ['tgh'], spa: ['kacc'], spd: ['comp'], spe: ['spd'] },
};

// Display labels: what each stat means on this card.
export const STAT_LABELS = {
  QB: { hp: 'Stamina', atk: 'Arm Strength', def: 'Toughness', spa: 'Accuracy', spd: 'Vision', spe: 'Speed' },
  RB: { hp: 'Stamina', atk: 'Power', def: 'Ball Security', spa: 'Elusiveness', spd: 'Vision', spe: 'Speed' },
  WR: { hp: 'Stamina', atk: 'Physicality', def: 'Toughness', spa: 'Route Running', spd: 'Hands', spe: 'Speed' },
  TE: { hp: 'Stamina', atk: 'Blocking', def: 'Toughness', spa: 'Route Running', spd: 'Hands', spe: 'Speed' },
  OL: { hp: 'Stamina', atk: 'Run Blocking', def: 'Pass Blocking', spa: 'Technique', spd: 'Awareness', spe: 'Footwork' },
  DL: { hp: 'Stamina', atk: 'Power Rush', def: 'Run Stopping', spa: 'Finesse Rush', spd: 'Diagnosis', spe: 'Get-off' },
  LB: { hp: 'Stamina', atk: 'Tackling', def: 'Block Shedding', spa: 'Blitzing', spd: 'Coverage', spe: 'Speed' },
  DB: { hp: 'Stamina', atk: 'Tackling', def: 'Press', spa: 'Ball Skills', spd: 'Coverage', spe: 'Speed' },
  K: { hp: 'Stamina', atk: 'Leg Power', def: 'Toughness', spa: 'Accuracy', spd: 'Composure', spe: 'Speed' },
};

// Default stat behind every trait (used when the card's position doesn't train it).
const GENERIC = {
  spd: 'spe', stm: 'hp', arm: 'atk', acc: 'spa', awr: 'spd', tgh: 'def', str: 'atk', elu: 'spa', vision: 'spd',
  route: 'spa', hands: 'spd', runBlk: 'atk', passBlk: 'def', tech: 'spa', rushPow: 'atk', runStop: 'def',
  rushFin: 'spa', tackle: 'atk', cover: 'spd', press: 'def', ball: 'spa', kpow: 'atk', kacc: 'spa', comp: 'spd',
};
const OFF_POSITION = 0.85;

// How much each trait matters for the card's overall.
export const OVR_WEIGHTS = {
  QB: { acc: 0.3, arm: 0.2, awr: 0.25, spd: 0.1, tgh: 0.08, stm: 0.07 },
  RB: { spd: 0.25, elu: 0.2, str: 0.2, vision: 0.15, tgh: 0.1, stm: 0.1 },
  WR: { spd: 0.3, route: 0.25, hands: 0.25, str: 0.1, tgh: 0.05, stm: 0.05 },
  TE: { hands: 0.2, route: 0.15, runBlk: 0.25, spd: 0.15, tgh: 0.1, stm: 0.15 },
  OL: { runBlk: 0.3, passBlk: 0.3, tech: 0.15, awr: 0.1, stm: 0.1, mass: 0.05 },
  DL: { rushPow: 0.3, runStop: 0.25, rushFin: 0.2, awr: 0.1, spd: 0.05, stm: 0.1 },
  LB: { tackle: 0.25, runStop: 0.2, cover: 0.2, spd: 0.15, rushFin: 0.1, stm: 0.1 },
  DB: { spd: 0.3, cover: 0.25, ball: 0.15, tackle: 0.1, press: 0.1, stm: 0.1 },
  K: { kpow: 0.5, kacc: 0.4, comp: 0.1 },
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Base stat -> 20..99 rating. Linear through the normal range, soft-capped above 140
// so outliers (Shuckle's 230 Defense, Blissey's 255 HP) don't break the physics.
export function rate(x) {
  const v = x <= 140 ? 35 + (x - 40) * 0.55 : 90 + (x - 140) * 0.08;
  return clamp(Math.round(v), 20, 99);
}

export function massRating(kg) {
  return clamp(Math.round(20 + Math.log10(Math.max(kg, 0.5)) * 28), 20, 99);
}

// Base stats plus any flat per-card bonus (adventure training), e.g. { atk: 8 }.
export function cardBase(slug, bonus = null) {
  const s = POKEMON[slug].stats;
  if (!bonus) return s;
  const out = { ...s };
  for (const k in bonus) if (k in out) out[k] = Math.min(255, out[k] + bonus[k]);
  return out;
}

// statBoost: optional { atk: 0.16, ... } fractions added to base stats (type synergies)
// bonus: optional flat base-stat bonus on this card
export function cardRatings(slug, pos, statBoost = null, bonus = null) {
  const p = POKEMON[slug];
  if (!p) throw new Error(`Unknown Pokémon: ${slug}`);
  let s = cardBase(slug, bonus);
  if (statBoost) { s = { ...s }; for (const k in statBoost) s[k] = Math.round(s[k] * (1 + statBoost[k])); }
  const map = STAT_MAP[pos];
  const trained = {};
  for (const k of STAT_KEYS) for (const trait of map[k]) trained[trait] = rate(s[k]);
  const r = {};
  for (const trait in GENERIC) {
    r[trait] = trained[trait] ?? clamp(Math.round(rate(s[GENERIC[trait]]) * OFF_POSITION), 20, 99);
  }
  r.mass = massRating(p.weight);
  // agility: quickness from Speed, lighter bodies change direction faster
  r.agi = clamp(Math.round(0.7 * rate(s.spe) + 0.3 * (110 - r.mass)), 20, 99);
  return r;
}

export function overall(pos, r) {
  const w = OVR_WEIGHTS[pos];
  let v = 0;
  for (const k in w) v += w[k] * r[k];
  return Math.round(v);
}

export function cardOverall(slug, pos, bonus = null) { return overall(pos, cardRatings(slug, pos, null, bonus)); }

// A card instance on a team
export function buildCard(slug, pos, extra = {}) {
  const p = POKEMON[slug];
  const bonus = extra.bonus && Object.keys(extra.bonus).length ? extra.bonus : null;
  const ratings = cardRatings(slug, pos, null, bonus);
  const base = cardBase(slug, bonus);
  return {
    slug, pos, name: p.name, types: p.types, height: p.height, weight: p.weight, dex: p.dex,
    sprites: p.sprites, base, bst: Object.values(base).reduce((a, b) => a + b, 0), ratings, ovr: overall(pos, ratings), ...extra, bonus,
  };
}

// Type synergies live in js/synergy.js.
