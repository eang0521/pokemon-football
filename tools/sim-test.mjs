// Headless batch simulation for tuning realism. Run: node tools/sim-test.mjs [games]
import { Game } from '../js/game.js';
import { TEAMS } from '../js/data/teams.js';

const N = Number(process.argv[2] || 40);
const agg = { pts: 0, plays: 0, passAtt: 0, cmp: 0, passYds: 0, int: 0, sacks: 0, rushAtt: 0, rushYds: 0, fum: 0,
  punts: 0, fga: 0, fgm: 0, tds: 0, ties: 0, ot: 0, pen: 0, third: [0, 0], snaps: 0, maxPts: 0, twoPt: [0, 0], scr: 0 };
const t0 = Date.now();
for (let g = 0; g < N; g++) {
  const a = TEAMS[g % TEAMS.length], h = TEAMS[(g * 3 + 1) % TEAMS.length === g % TEAMS.length ? (g + 1) % TEAMS.length : (g * 3 + 1) % TEAMS.length];
  const game = new Game(a, h, 1000 + g);
  let rec, guard = 0;
  while ((rec = game.next()) && guard++ < 600) { agg.snaps++; if (rec.type === 'scrimmage' && rec.text?.includes('scrambles')) agg.scr++; }
  if (guard >= 600) console.log('!! runaway game', g);
  agg.pts += game.score[0] + game.score[1];
  agg.maxPts = Math.max(agg.maxPts, ...game.score);
  if (game.score[0] === game.score[1]) agg.ties++;
  if (game.quarter === 5) agg.ot++;
  for (const T of game.stats.teams) {
    agg.plays += T.plays; agg.pen += T.pen; agg.third[0] += T.third[0]; agg.third[1] += T.third[1];
    agg.twoPt[0] += T.twoPt[0]; agg.twoPt[1] += T.twoPt[1];
  }
  for (const id in game.stats.players) {
    const s = game.stats.players[id];
    agg.passAtt += s.pass.att; agg.cmp += s.pass.cmp; agg.passYds += s.pass.yds; agg.int += s.pass.int; agg.sacks += s.pass.sck;
    agg.rushAtt += s.rush.car; agg.rushYds += s.rush.yds; agg.fum += s.fum;
    agg.punts += s.punt.n; agg.fga += s.kick.fga; agg.fgm += s.kick.fgm;
    agg.tds += s.pass.td + s.rush.td + s.def.td + s.ret.td;
  }
  if (g === 0) {
    console.log(`Sample: ${a.abbr} ${game.score[0]} - ${h.abbr} ${game.score[1]}`);
    for (const l of game.log.slice(0, 60)) console.log(`  Q${l.q} ${fmt(l.clock)} ${l.dd ? `[${l.dd} ${l.spot}] ` : ''}${l.text}`);
  }
}
function fmt(s) { s = Math.ceil(s); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
const per = (v) => (v / N).toFixed(1);
console.log(`\n${N} games in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log(`Points/game (both): ${per(agg.pts)}  max team: ${agg.maxPts}  ties: ${agg.ties}  OT: ${agg.ot}`);
console.log(`Plays/game (both): ${per(agg.plays)}  snaps: ${per(agg.snaps)}  penalties: ${per(agg.pen)}`);
console.log(`Pass: ${per(agg.cmp)}/${per(agg.passAtt)} (${(100 * agg.cmp / agg.passAtt).toFixed(1)}%)  ${(agg.passYds / agg.passAtt).toFixed(2)} Y/A  INT/g ${per(agg.int)}  sacks/g ${per(agg.sacks)} (${(100 * agg.sacks / (agg.passAtt + agg.sacks)).toFixed(1)}%)  scrambles/g ${per(agg.scr)}`);
console.log(`Rush: ${per(agg.rushAtt)} att  ${(agg.rushYds / agg.rushAtt).toFixed(2)} YPC  fumbles/g ${per(agg.fum)}`);
console.log(`TD/g ${per(agg.tds)}  FG ${per(agg.fgm)}/${per(agg.fga)}  punts/g ${per(agg.punts)}  3rd down ${(100 * agg.third[0] / agg.third[1]).toFixed(1)}%  2pt ${agg.twoPt[0]}/${agg.twoPt[1]}`);
