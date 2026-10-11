// Gym leader teams vs the regional teams: win rate per gym team (each plays every regional team, home and away).
// Run: node tools/gym-balance.mjs [rounds]
import { Game } from '../js/game.js';
import { TEAMS } from '../js/data/teams.js';
import { GYM_TEAMS } from '../js/data/gymTeams.js';

const R = Number(process.argv[2] || 1);
const only = process.argv[3] ? new Set(process.argv[3].split(',')) : null; // e.g. HAM,LVR
const res = [];
let seed = 20000, tot = [0, 0];
for (const G of GYM_TEAMS.filter((t) => !only || only.has(t.abbr))) {
  let w = 0, n = 0, pf = 0, pa = 0;
  for (let r = 0; r < R; r++) for (const T of TEAMS) for (const home of [0, 1]) {
    const game = new Game(home ? T : G, home ? G : T, seed++, { injuries: false });
    let guard = 0;
    while (game.next() && guard++ < 700);
    const gi = home ? 1 : 0, s = game.score;
    w += s[gi] > s[1 - gi] ? 1 : s[gi] === s[1 - gi] ? 0.5 : 0; n++;
    pf += s[gi]; pa += s[1 - gi];
  }
  res.push([G.abbr, G.coach.name, w / n, pf / n, pa / n]);
  tot[0] += w; tot[1] += n;
}
res.sort((a, b) => b[2] - a[2]);
for (const [a, l, p, f, g] of res) console.log(`${a} ${l.padEnd(13)} ${(p * 100).toFixed(0).padStart(3)}%  ${f.toFixed(1)}-${g.toFixed(1)}`);
console.log(`gym teams overall vs regional: ${(tot[0] / tot[1] * 100).toFixed(1)}%`);
