// Batch-run every offensive play vs every defense: node tools/play-stats.mjs [reps] [playId]
import { RNG } from '../js/rng.js';
import { TEAMS } from '../js/data/teams.js';
import { PLAYS, DEFENSES } from '../js/playbook.js';
import { simulatePlay } from '../js/sim/playSim.js';
import { playArgs } from './lib.mjs';

const reps = Number(process.argv[2] || 30);
const only = process.argv[3];
const rng = new RNG(42);
const rows = [];
for (const play of PLAYS) {
  if (only && play.id !== only) continue;
  const acc = { n: 0, yds: 0, cmp: 0, att: 0, int: 0, sack: 0, td: 0, yac: 0, air: 0, big: 0, dur: 0, scr: 0 };
  for (const dcall of DEFENSES) for (let r = 0; r < reps; r++) {
    const offTeam = TEAMS.filter((t) => play.forms[t.roster.FXO.split(':')[1]])[rng.int(0, 99) % TEAMS.filter((t) => play.forms[t.roster.FXO.split(':')[1]]).length] || TEAMS[0];
    const res = simulatePlay(playArgs({ rng, play, dcall, offTeam, defTeam: TEAMS[rng.int(0, 7)], ballY: rng.pick([16, 20, 24]), flip: rng.pick([1, -1]) }));
    acc.n++; acc.yds += res.turnover ? 0 : res.yards; acc.dur += res.duration;
    if (res.passer) acc.att++;
    if (res.completion) { acc.cmp++; acc.yac += res.yac || 0; acc.air += res.airYards || 0; }
    if (res.kind === 'int') acc.int++;
    if (res.kind === 'sack') acc.sack++;
    if (res.scramble) acc.scr++;
    if (res.td) acc.td++;
    if (res.yards >= 20) acc.big++;
  }
  const f = (v) => (v / acc.n).toFixed(2);
  rows.push(`${play.id.padEnd(12)} ${play.type.padEnd(4)} yds ${f(acc.yds).padStart(6)}  cmp ${acc.att ? (100 * acc.cmp / acc.att).toFixed(0).padStart(3) : '  -'}%  air ${acc.cmp ? (acc.air / acc.cmp).toFixed(1) : '-'}  yac ${acc.cmp ? (acc.yac / acc.cmp).toFixed(1) : '-'}  int ${f(acc.int)} sack ${f(acc.sack)} td ${f(acc.td)} 20+ ${f(acc.big)} dur ${f(acc.dur)}`);
}
console.log(rows.join('\n'));
