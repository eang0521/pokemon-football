// How far a player-controlled QB gets by just taking off on pass plays, vs every defense:
// node tools/scramble-test.mjs [reps] [contain 0..1]
import { RNG } from '../js/rng.js';
import { TEAMS } from '../js/data/teams.js';
import { PLAYS, DEFENSES } from '../js/playbook.js';
import { setupPlay, stepPlay, finishPlay } from '../js/sim/playSim.js';
import { playArgs } from './lib.mjs';

const reps = Number(process.argv[2] || 4), contain = Number(process.argv[3] || 0);
const rng = new RNG(21);
const styles = {
  straight: (S) => ({ x: 1, y: 0 }), // snap and run up the middle
  rollout: (S) => (S.t < 1.2 ? { x: -0.2, y: 1 } : { x: 1, y: 0.25 }), // roll right, then turn upfield
  wait: (S) => (S.t < 2 ? { x: 0, y: 0 } : { x: 1, y: 0.4 }), // let the routes clear out, then go
};
const byDef = {};
const all = {};
for (const [name, fn] of Object.entries(styles)) {
  let n = 0, y = 0, big = 0;
  for (const dcall of DEFENSES.filter((d) => d.id !== 'prevent')) for (const play of PLAYS.filter((p) => p.type === 'pass' && !p.special && !p.screen)) {
    const teams = TEAMS.filter((t) => play.forms[t.roster.FXO.split(':')[1]]);
    for (let r = 0; r < reps; r++) {
      const args = playArgs({ rng, play, dcall, offTeam: rng.pick(teams), defTeam: rng.pick(TEAMS), ballY: 20, flip: rng.pick([1, -1]),
        situation: { aggression: 0.5, down: 1, toGo: 10, contain } });
      args.human = { side: 'O' };
      const S = setupPlay(args);
      while (!stepPlay(S)) S.human.move = fn(S);
      const res = finishPlay(S);
      const g = res.turnover ? -20 : res.yards;
      n++; y += g; if (g >= 10) big++;
      if (name === 'straight') { const b = (byDef[dcall.id] ||= { n: 0, y: 0 }); b.n++; b.y += g; }
    }
  }
  all[name] = `${(y / n).toFixed(1)} y/play, ${(big / n * 100).toFixed(0)}% 10+`;
}
console.log(`contain ${contain}:`, JSON.stringify(all));
console.log('  straight, by defense:', Object.entries(byDef).map(([k, b]) => `${k} ${(b.y / b.n).toFixed(1)}`).join(' · '));
