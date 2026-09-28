// Per-play-call results inside real games: node tools/game-breakdown.mjs [games]
import { Game } from '../js/game.js';
import { TEAMS } from '../js/data/teams.js';

const N = Number(process.argv[2] || 40);
const byPlay = {}, byDef = {}, rush = { n: 0, y: 0, tfl: 0, big: 0 }, pass = { drop: 0, sack: 0, throwT: [], press: 0 };
const bump = (m, k, y) => { (m[k] ||= { n: 0, y: 0 }); m[k].n++; m[k].y += y; };
for (let g = 0; g < N; g++) {
  const game = new Game(TEAMS[g % 8], TEAMS[(g * 3 + 1) % 8 === g % 8 ? (g + 1) % 8 : (g * 3 + 1) % 8], 500 + g);
  game.onPlay = ({ oc, dc, res }) => {
    const y = res.turnover ? 0 : Math.round(res.yards);
    if (oc.play.type === 'run') {
      bump(byPlay, oc.play.id, y); bump(byDef, dc.dcall.id, y);
      rush.n++; rush.y += y; if (y < 0) rush.tfl++; if (y >= 10) rush.big++;
    } else if (oc.play.type === 'pass') {
      pass.drop++; if (res.kind === 'sack') pass.sack++;
      if (res.throwT != null) pass.throwT.push(res.throwT);
      if (res.pressureAtThrow != null && res.pressureAtThrow < 2.5) pass.press++;
    }
  };
  while (game.next());
}
const f = (o) => Object.entries(o).sort((a, b) => b[1].n - a[1].n).map(([k, v]) => `  ${k.padEnd(12)} n=${String(v.n).padStart(4)}  ypc ${(v.y / v.n).toFixed(2)}`).join('\n');
console.log(`RUN  ${rush.n} att  ${(rush.y / rush.n).toFixed(2)} ypc  TFL ${(100 * rush.tfl / rush.n).toFixed(0)}%  10+ ${(100 * rush.big / rush.n).toFixed(0)}%`);
console.log('by play:\n' + f(byPlay));
console.log('by defense:\n' + f(byDef));
const t = pass.throwT.sort((a, b) => a - b);
console.log(`PASS dropbacks ${pass.drop}  sack ${(100 * pass.sack / pass.drop).toFixed(1)}%  pressured throws ${(100 * pass.press / pass.drop).toFixed(0)}%  throwT p50 ${t[t.length >> 1]?.toFixed(2)} p90 ${t[Math.floor(t.length * 0.9)]?.toFixed(2)}`);
