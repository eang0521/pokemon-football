// Headless player-mode run: the home team is "human" (random calls, scripted stick/throws), to
// exercise the await / live-play flow end to end: node tools/player-mode-test.mjs [games]
import { Game } from '../js/game.js';
import { TEAMS } from '../js/data/teams.js';
import { setupPlay, stepPlay, finishPlay, humanEnt } from '../js/sim/playSim.js';

const N = Number(process.argv[2] || 3);
for (let k = 0; k < N; k++) {
  const g = new Game(TEAMS[k % 8], TEAMS[(k + 3) % 8], 4200 + k, { human: 1 });
  let rec, calls = 0, live = 0, guard = 0;
  while ((rec = g.next()) && guard++ < 2000) {
    if (rec.type !== 'await') continue;
    if (rec.need === 'call') {
      calls++;
      const m = rec.menu, r = Math.random();
      if (m.side === 'O') g.humanCall = r < 0.15 ? {} : r < 0.2 && m.specials.length ? { special: m.specials[0].call } : { play: m.plays[Math.floor(Math.random() * m.plays.length)].id };
      else g.humanCall = r < 0.3 ? {} : { def: m.defs[Math.floor(Math.random() * m.defs.length)].id };
      continue;
    }
    live++;
    const S = setupPlay(rec.args);
    if (S.human.side === 'D') S.human.ctl = S.D.LB1 || S.defList[3];
    while (!stepPlay(S)) {
      const e = humanEnt(S);
      if (S.human.side === 'O') {
        if (S.play.type === 'pass' && S.t > 1.6 && S.O.QB.hasBall) S.human.throwTo = 'WR';
        if (e && e !== S.O.QB) S.human.move = { x: 1, y: 0 };
      } else if (S.carrier) S.human.move = { x: S.carrier.x - e.x, y: S.carrier.y - e.y };
    }
    g.finishLive(finishPlay(S));
  }
  console.log(`game ${k}: ${g.teams[0].abbr} ${g.score[0]} - ${g.score[1]} ${g.teams[1].abbr} final=${g.final} calls=${calls} live plays=${live}`);
}
