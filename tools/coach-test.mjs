// Coaching-only matchups: the same roster on both sides, one coach vs another.
// node tools/coach-test.mjs [games] [variant]
//   variants: none (control), max (all sliders 100), min (all 0), offMax (pass/deep/PA/aggression 100), defMax (blitz/man 100)
import { Game } from '../js/game.js';
import { TEAMS, COACH_PRESETS } from '../js/data/teams.js';
import { familyOf } from '../js/playcaller.js';

const N = Number(process.argv[2] || 40);
const variant = process.argv[3] || 'max';
const MAX = {
  none: {}, // control: should come out near 50%
  max: { passRate: 1, deepRate: 1, paRate: 1, aggression: 1, blitzRate: 1, manRate: 1 },
  min: { passRate: 0, deepRate: 0, paRate: 0, aggression: 0, blitzRate: 0, manRate: 0 },
  offMax: { passRate: 1, deepRate: 1, paRate: 1, aggression: 1 },
  defMax: { blitzRate: 1, manRate: 1 },
  passMax: { passRate: 1 },
  deepMax: { deepRate: 1 },
  blitzMax: { blitzRate: 1 },
  manMax: { manRate: 1 },
}[variant];
const clone = (t, coach) => ({ ...t, id: `${t.id}-${coach.name}`, coach });
let w = 0, l = 0, t = 0, pf = 0, pa = 0;
const fam = [{}, {}]; // [maxed, normal] offense: family -> { n, yds }
const dfam = [{}, {}]; // [maxed, normal] defense: call -> { n, yds }
const cross = {}; // normal offense vs maxed defense: 'family|call' -> { n, yds }
const st = { pass: 0, plays: 0, blitz: 0, dplays: 0, sacksFor: 0, sacksAgainst: 0, intFor: 0, intAgainst: 0, ypaFor: 0, attFor: 0, ypaAg: 0, attAg: 0 };
for (let k = 0; k < N; k++) {
  const base = TEAMS[k % TEAMS.length];
  const preset = Object.keys(COACH_PRESETS)[Math.floor(k / TEAMS.length) % 8];
  const normal = { name: 'Normal', preset, ...COACH_PRESETS[preset] };
  const maxed = { ...normal, name: 'Maxed', ...MAX };
  const home = k % 2 === 0;
  const A = clone(base, maxed), B = clone(base, normal);
  const g = new Game(home ? B : A, home ? A : B, 31000 + k);
  const me = home ? 1 : 0;
  g.onPlay = ({ oc, dc, res }) => {
    if (!oc.play.special) {
      const y = res.turnover ? -25 : res.yards;
      const f = (fam[g.poss === me ? 0 : 1][familyOf(oc.play)] ||= { n: 0, yds: 0 }); f.n++; f.yds += y;
      const e = (dfam[g.poss === me ? 1 : 0][dc.dcall.id] ||= { n: 0, yds: 0 }); e.n++; e.yds += y;
      if (g.poss !== me) { const c = (cross[`${familyOf(oc.play)}|${dc.dcall.id}`] ||= { n: 0, yds: 0, sack: 0 }); c.n++; c.yds += y; if (res.kind === 'sack') c.sack++; }
    }
    if (g.poss === me) {
      st.plays++; if (oc.play.type === 'pass') st.pass++;
      if (res.kind === 'sack') st.sacksAgainst++; if (res.kind === 'int') st.intAgainst++;
      if (res.passer && !res.throwAway) { st.attFor++; st.ypaFor += res.completion ? res.yards : 0; }
    } else {
      st.dplays++; if (dc.dcall.tags?.includes('blitz')) st.blitz++;
      if (res.kind === 'sack') st.sacksFor++; if (res.kind === 'int') st.intFor++;
      if (res.passer && !res.throwAway) { st.attAg++; st.ypaAg += res.completion ? res.yards : 0; }
    }
  };
  while (g.next());
  const a = g.score[me], b = g.score[1 - me];
  pf += a; pa += b;
  if (a > b) w++; else if (a < b) l++; else t++;
}
console.log(`${variant}: ${N} games  W-L-T ${w}-${l}-${t}  (${(w / N * 100).toFixed(0)}% wins)  PF ${(pf / N).toFixed(1)}  PA ${(pa / N).toFixed(1)}`);
console.log(`  offense: pass ${(st.pass / st.plays * 100).toFixed(0)}%  Y/A ${(st.ypaFor / st.attFor).toFixed(2)}  sacked ${(st.sacksAgainst / N).toFixed(1)}/g  INT ${(st.intAgainst / N).toFixed(1)}/g`);
console.log(`  defense: blitz ${(st.blitz / st.dplays * 100).toFixed(0)}%  Y/A allowed ${(st.ypaAg / st.attAg).toFixed(2)}  sacks ${(st.sacksFor / N).toFixed(1)}/g  INT ${(st.intFor / N).toFixed(1)}/g`);
for (const [k, side] of [['maxed O', 0], ['normal O', 1]]) {
  const tot = Object.values(fam[side]).reduce((a, b) => a + b.n, 0);
  console.log(`  ${k}: ` + Object.entries(fam[side]).sort((a, b) => b[1].n - a[1].n).map(([f, b]) => `${f} ${(b.n / tot * 100).toFixed(0)}% ${(b.yds / b.n).toFixed(1)}y`).join(' · '));
}
for (const [k, side] of [['maxed D', 0], ['normal D', 1]]) {
  const tot = Object.values(dfam[side]).reduce((a, b) => a + b.n, 0);
  console.log(`  ${k}: ` + Object.entries(dfam[side]).sort((a, b) => b[1].n - a[1].n).map(([f, b]) => `${f} ${(b.n / tot * 100).toFixed(0)}% ${(b.yds / b.n).toFixed(1)}y`).join(' · '));
}
if (process.argv[4] === 'cross') {
  console.log('  normal O vs maxed D (family|call: share, y/play, sack%):');
  const tot = Object.values(cross).reduce((a, b) => a + b.n, 0);
  for (const [k, b] of Object.entries(cross).sort((a, b) => b[1].n - a[1].n).slice(0, 18)) console.log(`    ${k.padEnd(18)} ${(b.n / tot * 100).toFixed(1).padStart(5)}%  ${(b.yds / b.n).toFixed(1).padStart(5)}y  ${(b.sack / b.n * 100).toFixed(0)}%`);
}
