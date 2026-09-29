// Type synergies. Count each type among the 7 players a unit has on the field
// (dual types count for both). At 2 / 4 / 6 the synergy reaches tier 1 / 2 / 3,
// and every Pokémon of that type on the unit gets the effect. Effects work the
// same way on offense and defense.
//
// Magnitudes live in SYNERGY_VALUES (one number per tier) so balance can be
// re-tuned from simulation (tools/synergy-calibrate.mjs) without touching logic.

export const TIER_COUNTS = [2, 4, 6];

export const SYNERGIES = {
  normal: { name: 'Normal', kind: 'stat', stat: 'hp', title: 'Endurance', desc: 'Boosts HP — more stamina, so they tire more slowly.' },
  fighting: { name: 'Fighting', kind: 'stat', stat: 'atk', title: 'Brawler', desc: 'Boosts Attack (arm, power, blocking, tackling, power rush — by position).' },
  steel: { name: 'Steel', kind: 'stat', stat: 'def', title: 'Iron', desc: 'Boosts Defense (toughness, pass blocking, run stopping, press — by position).' },
  psychic: { name: 'Psychic', kind: 'stat', stat: 'spa', title: 'Mind', desc: 'Boosts Sp. Atk (accuracy, route running, finesse rush, ball skills — by position).' },
  fairy: { name: 'Fairy', kind: 'stat', stat: 'spd', title: 'Grace', desc: 'Boosts Sp. Def (vision, hands, diagnosis, coverage — by position).' },
  electric: { name: 'Electric', kind: 'stat', stat: 'spe', title: 'Charge', desc: 'Boosts Speed.' },
  dragon: { name: 'Dragon', kind: 'mech', key: 'clutch', title: 'Outrage', desc: 'Clutch: every rating rises on 3rd & 4th down, in the red zone, and in one-score 4th quarters or overtime.' },
  fire: { name: 'Fire', kind: 'mech', key: 'burst', title: 'Burst', desc: 'Faster acceleration: explosive routes, runs, rushes and pursuit.' },
  water: { name: 'Water', kind: 'mech', key: 'flow', title: 'Flow', desc: 'Keep speed through direction changes: sharper cuts, route breaks and breaks on the ball.' },
  grass: { name: 'Grass', kind: 'mech', key: 'regen', title: 'Photosynthesis', desc: 'Faster energy recovery and less drain per snap.' },
  ice: { name: 'Ice', kind: 'mech', key: 'chill', title: 'Chill', desc: 'Opponents they make contact with are briefly slowed.' },
  poison: { name: 'Poison', kind: 'mech', key: 'toxic', title: 'Toxic', desc: 'Opponents they make contact with lose extra energy.' },
  ground: { name: 'Ground', kind: 'mech', key: 'leverage', title: 'Leverage', desc: 'Win the push in blocking battles — on either side of the block.' },
  flying: { name: 'Flying', kind: 'mech', key: 'reach', title: 'Reach', desc: 'Bigger reach on the ball: catch radius on offense, interception and deflection radius on defense.' },
  bug: { name: 'Bug', kind: 'mech', key: 'swarm', title: 'Swarm', desc: 'Stronger in contact for each nearby teammate — gang tackles and group blocking.' },
  rock: { name: 'Rock', kind: 'mech', key: 'sturdy', title: 'Sturdy', desc: 'Resist being moved: not driven back in blocks, fewer fumbles.' },
  ghost: { name: 'Ghost', kind: 'mech', key: 'phase', title: 'Phase', desc: 'Chance to phase through contact: tackles and blocks on them miss.' },
  dark: { name: 'Dark', kind: 'mech', key: 'misread', title: 'Feint', desc: 'Opponents misread them: defenders react late to their routes; QBs misjudge windows near them.' },
};

// Per-tier magnitudes. Stat types: fraction added to the base stat.
// Mechanics: see comments (units used by the sim).
export const SYNERGY_VALUES = {
  normal: [0.756, 1.515, 2.525],
  fighting: [0.06, 0.119, 0.186],
  steel: [0.076, 0.151, 0.238],
  psychic: [0.044, 0.087, 0.136],
  fairy: [0.044, 0.089, 0.139],
  electric: [0.02, 0.041, 0.064],
  clutch: [0.015, 0.031, 0.054], // rating multiplier bonus in clutch situations
  burst: [0.015, 0.031, 0.054], // acceleration multiplier bonus
  flow: [0.083, 0.166, 0.277], // fraction of speed loss avoided on sharp turns
  regen: [1.022, 2.041, 3.571], // recovery bonus / drain reduction
  chill: [0.591, 1.182, 2.009], // seconds an opponent is slowed after contact
  toxic: [1.042, 2.085, 3.647], // extra energy lost by an opponent per contact
  leverage: [1.379, 2.759, 4.828], // added to their side of a blocking battle
  reach: [0.13, 0.26, 0.451], // yards of extra reach on the ball
  swarm: [0.015, 0.03, 0.051], // per nearby teammate: tackle/block bonus
  sturdy: [0.183, 0.365, 0.584], // fraction of push / fumble risk resisted
  phase: [0.023, 0.046, 0.08], // chance a tackle or block attempt on them misses
  misread: [0.036, 0.072, 0.12], // seconds of opponent reaction delay (also QB misjudgment)
};

export const valueOf = (type, tier) => {
  const s = SYNERGIES[type];
  const vals = SYNERGY_VALUES[s.kind === 'stat' ? type : s.key];
  return tier > 0 ? vals[tier - 1] : 0;
};

export function tierFor(count) {
  let t = 0;
  TIER_COUNTS.forEach((n, i) => { if (count >= n) t = i + 1; });
  return t;
}

// cards: the 7 on the field. Returns { counts, active: {type: tier} }
export function unitSynergies(cards) {
  const counts = {};
  for (const c of cards) for (const t of c.types) counts[t] = (counts[t] || 0) + 1;
  const active = {};
  for (const t in counts) { const tier = tierFor(counts[t]); if (tier && SYNERGIES[t]) active[t] = tier; }
  return { counts, active };
}

// Per-player effects for a unit: { stat: {hp:.., ...}, mods: {burst, flow, ...}, clutch }
export function playerEffects(card, active) {
  const stat = {}, mods = {};
  for (const t of card.types) {
    const tier = active[t];
    if (!tier) continue;
    const s = SYNERGIES[t];
    if (s.kind === 'stat') stat[s.stat] = (stat[s.stat] || 0) + valueOf(t, tier);
    else mods[s.key] = (mods[s.key] || 0) + valueOf(t, tier);
  }
  return { stat, mods };
}

export const tierName = (tier) => ['', 'I', 'II', 'III'][tier] || '';
