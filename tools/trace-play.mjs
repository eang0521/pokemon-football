// Trace a single play: node tools/trace-play.mjs <playId> <defId> [seed]
import { RNG } from '../js/rng.js';
import { buildPlayer } from '../js/ratings.js';
import { TEAMS, OFF_POS, DEF_POS } from '../js/data/teams.js';
import { PLAY_BY_ID, DEF_BY_ID } from '../js/playbook.js';
import { simulatePlay } from '../js/sim/playSim.js';

const [playId = 'insideZone', defId = 'c3', seed = '7'] = process.argv.slice(2);
const A = TEAMS[0], B = TEAMS[1];
const mk = (t, list) => Object.fromEntries(list.map((p) => [p, buildPlayer(t, p, t.roster[p])]));
const off = mk(A, OFF_POS), def = mk(B, DEF_POS);
const rt = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v.ratings]));
const res = simulatePlay({
  rng: new RNG(Number(seed)), W: 40, los: 30, ballY: 20, flip: 1,
  offense: { players: off, ratings: rt(off) }, defense: { players: def, ratings: rt(def) },
  play: PLAY_BY_ID[playId], dcall: DEF_BY_ID[defId], situation: { aggression: 0.5 },
});
const names = res.cast.map((c) => `${c.pos}`);
for (const f of res.frames) {
  if (Math.round(f.t * 100) % 25 !== 0) continue;
  const row = f.p.map((p, i) => `${names[i]}:${p[0].toFixed(1)},${p[1].toFixed(1)}${p[2] === 1 ? '*' : p[2] === 2 ? '~' : ''}`).join(' ');
  console.log(`t=${f.t.toFixed(2)} ball=${f.b[0].toFixed(1)},${f.b[1].toFixed(1)},z${f.b[2].toFixed(1)} h${f.b[3]} | ${row}`);
}
console.log(res.events.map((e) => `${e.t}: ${e.text}`).join('\n'));
const { frames, cast, design, ...rest } = res;
console.log(JSON.stringify(rest, null, 0));
