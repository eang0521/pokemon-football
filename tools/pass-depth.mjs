// In-game passing by play depth / play action: node tools/pass-depth.mjs [games]
import { Game } from '../js/game.js';
import { TEAMS } from '../js/data/teams.js';

const N = Number(process.argv[2] || 24);
const by = {};
for (let k = 0; k < N; k++) {
  const g = new Game(TEAMS[k % TEAMS.length], TEAMS[(k + 1 + (k >> 3)) % TEAMS.length], 9100 + k);
  g.onPlay = ({ oc, res }) => {
    const p = oc.play;
    if (p.type !== 'pass' || p.special) return;
    const key = p.screen ? 'screen' : p.pa ? 'PA' : p.depth;
    const b = (by[key] ||= { n: 0, att: 0, cmp: 0, yds: 0, int: 0, sack: 0, big: 0 });
    b.n++;
    if (res.kind === 'sack') { b.sack++; b.yds += res.yards; return; }
    if (res.passer) b.att++;
    if (res.completion) { b.cmp++; b.yds += res.yards; if (res.yards >= 20) b.big++; }
    if (res.kind === 'int') b.int++;
  };
  while (g.next());
}
console.log('group     calls   cmp%   Y/call  20+%   INT%  sack%');
for (const [k, b] of Object.entries(by)) console.log(`${k.padEnd(9)} ${String(b.n).padStart(5)}  ${(b.cmp / b.att * 100).toFixed(0).padStart(5)}  ${(b.yds / b.n).toFixed(1).padStart(6)}  ${(b.big / b.n * 100).toFixed(0).padStart(4)}  ${(b.int / b.att * 100).toFixed(1).padStart(5)}  ${(b.sack / b.n * 100).toFixed(1).padStart(5)}`);
