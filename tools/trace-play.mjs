// Trace a single play: node tools/trace-play.mjs <playId> <defId> [seed] [offTeamIdx] [defTeamIdx]
import { RNG } from '../js/rng.js';
import { TEAMS } from '../js/data/teams.js';
import { PLAY_BY_ID, DEF_BY_ID } from '../js/playbook.js';
import { simulatePlay } from '../js/sim/playSim.js';
import { playArgs } from './lib.mjs';

const [playId = 'insideZone', defId = 'c3', seed = '7', oi = '0', di = '1'] = process.argv.slice(2);
const res = simulatePlay(playArgs({ rng: new RNG(Number(seed)), play: PLAY_BY_ID[playId], dcall: DEF_BY_ID[defId], offTeam: TEAMS[+oi], defTeam: TEAMS[+di] }));
const names = res.cast.map((c) => c.pos);
for (const f of res.frames) {
  if (Math.round(f.t * 100) % 25 !== 0) continue;
  const row = f.p.map((p, i) => `${names[i]}:${p[0].toFixed(1)},${p[1].toFixed(1)}${p[2] === 1 ? '*' : p[2] === 2 ? '~' : ''}`).join(' ');
  console.log(`t=${f.t.toFixed(2)} ball=${f.b[0].toFixed(1)},${f.b[1].toFixed(1)},z${f.b[2].toFixed(1)} h${f.b[3]} | ${row}`);
}
console.log(res.events.map((e) => `${e.t}: ${e.text}`).join('\n'));
const { frames, cast, design, ...rest } = res;
console.log(JSON.stringify(rest, null, 0));
