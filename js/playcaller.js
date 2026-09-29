// Situational play-calling AI for both sidelines.
import { PLAYS, DEFENSES } from './playbook.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pct = (v) => `${Math.round(v * 100)}%`;

// sit: { down, toGo, ballOn, quarter, clock, secsHalf, secsGame, diff (offense - defense),
//        twoMinute, killClock, timeouts, oppTimeouts, lastPlayId, offQB }
export function passProbability(coach, sit) {
  let p = coach.passRate;
  const why = [];
  const { down, toGo } = sit;
  if (down === 1) p -= 0.04;
  if (down === 2 && toGo >= 8) { p += 0.12; why.push('2nd & long'); }
  if (down === 2 && toGo <= 3) { p -= 0.12; why.push('2nd & short'); }
  if (down >= 3 && toGo <= 2) { p -= 0.28; why.push('short yardage'); }
  else if (down >= 3 && toGo <= 6) { p += 0.15; why.push(`${ord(down)} & medium`); }
  else if (down >= 3) { p += 0.35; why.push(`${ord(down)} & long`); }
  if (sit.twoMinute) { p += 0.35; why.push('two-minute drill'); }
  else if (sit.quarter >= 3 && sit.diff <= -9) { p += 0.2; why.push(`trailing by ${-sit.diff}`); }
  if (sit.killClock) { p -= 0.4; why.push('protecting the lead'); }
  else if (sit.quarter === 4 && sit.diff >= 8) { p -= 0.2; why.push('ahead late'); }
  if (sit.ballOn >= 97 && toGo <= 3) { p -= 0.15; why.push('goal line'); }
  return { p: clamp(p, 0.06, 0.96), why };
}

function ord(n) { return ['1st', '2nd', '3rd', '4th'][n - 1] || `${n}th`; }

export function callOffense(team, sit, rng) {
  const coach = team.coach;
  const { down, toGo, ballOn } = sit;

  // --- clock specials
  if (sit.kneel) return { play: KNEEL, reason: 'Victory formation — kneel to run out the clock' };
  if (sit.spike) return { play: SPIKE, reason: 'No timeouts — spike to stop the clock' };

  const { p: pPass, why } = passProbability(coach, sit);
  const hail = sit.secsHalf <= 7 && ballOn >= 35 && ballOn <= 72 && (sit.quarter === 2 || sit.diff < 0 && sit.diff >= -8 || sit.quarter === 2);
  if (hail) return { play: PLAYS.find((p) => p.id === 'hailMary'), reason: 'Last play of the half — Hail Mary!', pPass: 1 };

  const isPass = rng.chance(pPass);
  const qbSpd = sit.offQB?.ratings.spd || 60;
  const candidates = PLAYS.filter((p) => p.type === (isPass ? 'pass' : 'run') && !p.special && p.forms[sit.personnel || 'WR']).map((p) => {
    let w = 1;
    if (p.type === 'pass') {
      const long = toGo;
      const dw = long <= 3 ? { short: 2.6, medium: 1, deep: 0.45 }
        : long <= 7 ? { short: 1.5, medium: 1.6, deep: 0.65 }
          : long <= 12 ? { short: 0.6, medium: 1.8, deep: 1.2 }
            : { short: 0.25, medium: 1.4, deep: 2.1 };
      w *= dw[p.depth];
      if (p.depth === 'deep') w *= 0.5 + coach.deepRate;
      if (p.depth === 'short') w *= 1.5 - coach.deepRate;
      if (p.pa) w *= down <= 2 && !sit.twoMinute ? coach.paRate * 3 : 0.25;
      if (p.id === 'fade') w *= ballOn >= 88 ? 3 : 0;
      if (ballOn >= 85 && p.depth === 'deep' && p.id !== 'fade') w *= 0.5;
      if (sit.twoMinute && p.tags?.includes('sideline')) w *= 2.5;
      if (p.screen) w *= down === 2 && toGo >= 7 ? 1.6 : 0.5;
      if (sit.twoMinute && p.screen) w *= 0.3;
    } else {
      const style = coach.runStyle;
      if (style === 'zone' && p.scheme === 'zone') w *= 1.6;
      if (style === 'power' && (p.scheme === 'power' || p.scheme === 'counter')) w *= 1.7;
      if (p.scheme === 'toss') w *= 0.7;
      if (p.scheme === 'draw') w *= toGo >= 7 ? 0.5 : 0.12;
      if (p.scheme === 'counter') w *= 0.5;
      if (p.scheme === 'read') w *= qbSpd >= 72 ? 1.3 : 0.15;
      if (p.carrier === 'QB') w *= toGo <= 1 ? 3 : 0;
      if (p.id === 'fbDive') w *= toGo <= 2 ? 2.5 : 0.4;
      if (p.id === 'iso') w *= toGo <= 3 ? 1.6 : 1;
      if (p.id === 'glPower') w *= ballOn >= 95 || toGo <= 1 ? 3 : 0;
      if (p.id === 'outsideZone' || p.id === 'toss') w *= toGo <= 2 ? 0.5 : 1;
    }
    if (p.id === sit.lastPlayId) w *= 0.4;
    return { w, p };
  });
  const pick = rng.weighted(candidates).p;
  const reason = `${why.length ? why.join(', ') + ' — ' : ''}${pct(pPass)} pass tendency → ${pick.type === 'pass' ? 'pass' : 'run'}`;
  return { play: pick, reason, pPass };
}

export function callDefense(team, sit, oppTendency, rng) {
  const coach = team.coach;
  const { down, toGo, ballOn } = sit; // sit is from the OFFENSE's perspective
  const lead = -sit.diff;
  const why = [];
  // expected pass rate from what we've seen
  const seen = oppTendency.plays >= 6 ? oppTendency.pass / oppTendency.plays : 0.55;
  let expPass = seen;
  if (down >= 3 && toGo >= 7) expPass += 0.3;
  if (toGo <= 2) expPass -= 0.25;
  if (sit.twoMinute) expPass += 0.3;
  expPass = clamp(expPass, 0.05, 0.95);

  const prevent = (sit.secsHalf <= 10 && ballOn <= 70) || (sit.quarter >= 4 && sit.secsGame <= 75 && lead >= 1 && lead <= 8 && ballOn <= 65);
  if (prevent) return { dcall: DEFENSES.find((d) => d.id === 'prevent'), reason: 'Protect the lead: keep everything in front' };

  const cands = DEFENSES.filter((d) => d.id !== 'prevent').map((d) => {
    let w = d.tags.includes('man') ? coach.manRate : 1 - coach.manRate;
    if (d.tags.includes('blitz')) w *= coach.blitzRate * 1.6;
    if (d.id === 'runBlitz') w *= expPass < 0.4 ? 2.5 : 0.15;
    if (expPass > 0.7 && d.tags.includes('zone')) w *= 1.4;
    if (down >= 3 && toGo >= 8 && d.id === 'c0') w *= 0.4 + coach.aggression * 0.6;
    if (toGo <= 2 && (d.id === 'c0' || d.id === 'c1press')) w *= 1.6;
    if (ballOn >= 90 && d.tags.includes('man')) w *= 1.3;
    if (d.id === 'c1spy') w *= (sit.offQB?.ratings.spd || 60) >= 75 ? 2 : 0.3;
    if (d.id === 'cloud' && toGo <= 6) w *= 1.3;
    // front: three DL already bring pressure; three DBs lean toward coverage
    if (sit.front === 'DL' && d.tags.includes('blitz')) w *= 0.7;
    if (sit.front === 'DB' && d.tags.includes('zone')) w *= 1.15;
    if (sit.front === 'LB' && d.id === 'runBlitz') w *= 1.3;
    if (sit.twoMinute && d.id === 'c4') w *= 1.6;
    return { w, d };
  });
  const pick = rng.weighted(cands).d;
  if (expPass >= 0.65) why.push(`expecting pass (${pct(expPass)})`);
  else if (expPass <= 0.4) why.push(`expecting run (${pct(1 - expPass)})`);
  if (pick.tags.includes('blitz')) why.push('sending pressure');
  return { dcall: pick, reason: why.join(', ') || 'base call' };
}

// ---------------------------------------------------------------------------
// 4th down & PAT decisions
export function fourthDown(team, sit, kicker) {
  const coach = team.coach;
  const { toGo, ballOn } = sit;
  const fgDist = 100 - ballOn + 17;
  const maxFG = 41 + kicker.ratings.kpow * 0.15;
  const inRange = fgDist <= maxFG;
  const late = sit.quarter >= 4;
  const trail = -sit.diff; // points behind

  // end of half / game: take the points
  if (sit.secsHalf <= 12 && inRange && (!late || (trail <= 3 && trail >= 0) || sit.diff > 0)) return { call: 'fg', reason: 'Clock nearly out — kick it' };
  if (late && trail > 0) {
    if (trail <= 3 && inRange && sit.secsGame <= 40) return { call: 'fg', reason: 'Kick to tie/win at the end' };
    if (sit.secsGame <= 240 && (trail > 3 || !inRange)) return { call: 'go', reason: `Down ${trail} late — must go for it` };
    if (sit.secsGame <= 480 && trail > 8 && toGo <= 6) return { call: 'go', reason: `Down ${trail} — need possessions` };
  }
  if (late && sit.diff > 0 && sit.secsGame <= 300) {
    if (inRange && fgDist <= maxFG - 3) return { call: 'fg', reason: 'Extend the lead' };
    return { call: 'punt', reason: 'Protect the lead — pin them deep' };
  }
  const goMax = ballOn >= 45 ? 1 + coach.aggression * 3 : ballOn >= 30 ? 0.3 + coach.aggression * 1.5 : coach.aggression > 0.8 ? 1 : 0;
  if (toGo <= goMax) return { call: 'go', reason: `${coach.name} (aggression ${pct(coach.aggression)}) keeps the offense on the field` };
  if (inRange) return { call: 'fg', reason: `${Math.round(fgDist)}-yard try is within range` };
  if (ballOn >= 62 && toGo <= 3 + coach.aggression * 3) return { call: 'go', reason: 'Too far to kick, too close to punt' };
  return { call: 'punt', reason: 'Punting it away' };
}

export function patDecision(team, sit, rng) {
  // sit.diff is after the TD (offense - defense), before the PAT
  const d = sit.diff;
  const late = sit.quarter >= 4 || (sit.quarter === 3 && sit.clock < 240);
  const coach = team.coach;
  if (late) {
    if ([-2, -5, -10, 1, 5, -9, -13, -16].includes(d)) return { call: 'two', reason: `Chart says go for two (${d > 0 ? '+' : ''}${d})` };
  }
  if (coach.aggression >= 0.8 && rng.chance(0.15)) return { call: 'two', reason: `${coach.name} rolls the dice` };
  return { call: 'kick', reason: 'Extra point' };
}

export const KNEEL = { id: 'kneel', name: 'Victory Formation', type: 'kneel', form: 'singleback' };
export const SPIKE = { id: 'spike', name: 'Spike', type: 'spike', form: 'singleback' };
