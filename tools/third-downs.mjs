// Third-down conversion by distance: node tools/third-downs.mjs [games]
import { Game } from '../js/game.js';
import { TEAMS } from '../js/data/teams.js';

const N = Number(process.argv[2] || 40);
const b = {};
for (let g = 0; g < N; g++) {
  const game = new Game(TEAMS[g % 8], TEAMS[(g + 3) % 8], 3300 + g);
  game.onPlay = ({ oc, res, sit }) => {
    if (sit.down !== 3 || res.penalty) return;
    const k = sit.toGo <= 2 ? '1-2' : sit.toGo <= 5 ? '3-5' : sit.toGo <= 9 ? '6-9' : '10+';
    (b[k] ||= { n: 0, c: 0, pass: 0 }).n++;
    if (oc.play.type === 'pass') b[k].pass++;
    if (!res.turnover && (res.td || res.yards >= sit.toGo)) b[k].c++;
  };
  while (game.next());
}
let n = 0, c = 0;
for (const k of ['1-2', '3-5', '6-9', '10+']) { const v = b[k] || { n: 0, c: 0, pass: 0 }; n += v.n; c += v.c; console.log(`3rd & ${k.padEnd(4)} share ${(100 * v.n / Object.values(b).reduce((a, x) => a + x.n, 0)).toFixed(0).padStart(3)}%  conv ${(100 * v.c / v.n).toFixed(0).padStart(3)}%  pass ${(100 * v.pass / v.n).toFixed(0)}%`); }
console.log(`overall ${(100 * c / n).toFixed(1)}%`);
