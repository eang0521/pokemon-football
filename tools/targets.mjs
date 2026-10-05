// Target share by offensive slot (WR1 / FLEX / RB) over full games: node tools/targets.mjs [games]
import { Game } from '../js/game.js';
import { TEAMS } from '../js/data/teams.js';

const N = Number(process.argv[2] || 30);
const by = {}; // slot|personnel -> { tgt, cmp, yds }
let att = 0;
for (let k = 0; k < N; k++) {
  const g = new Game(TEAMS[k % TEAMS.length], TEAMS[(k + 1 + (k >> 3)) % TEAMS.length], 7000 + k);
  g.onPlay = ({ res, oc }) => {
    if (!res.target) return;
    const c = res.cast.find((x) => x.pid === res.target);
    const pers = g.depth[g.poss].personnel;
    const key = `${c.pos === 'FX' ? `FX(${pers})` : c.pos}`;
    const b = (by[key] ||= { tgt: 0, cmp: 0, yds: 0 });
    b.tgt++; att++;
    if (res.completion) { b.cmp++; b.yds += res.yards; }
  };
  while (g.next());
}
console.log(`${N} games, ${att} targets`);
for (const [k, b] of Object.entries(by).sort((a, b) => b[1].tgt - a[1].tgt)) {
  console.log(`${k.padEnd(8)} ${String(b.tgt).padStart(5)} tgt  ${(b.tgt / att * 100).toFixed(1).padStart(5)}%  cmp ${(b.cmp / b.tgt * 100).toFixed(0)}%  ${(b.yds / b.tgt).toFixed(1)} Y/tgt`);
}
