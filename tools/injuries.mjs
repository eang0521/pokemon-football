// Injury frequency: node tools/injuries.mjs [games]
import { Game } from '../js/game.js';
import { TEAMS } from '../js/data/teams.js';
const N = Number(process.argv[2] || 60);
let inj = 0, oop = 0; const byPos = {};
for (let g = 0; g < N; g++) {
  const game = new Game(TEAMS[g % 8], TEAMS[(g + 3) % 8], 8800 + g);
  while (game.next());
  for (const l of game.log) if (l.kind === 'injury') { inj++; const m = l.text.match(/\((\w+)\) is out/); byPos[m[1]] = (byPos[m[1]] || 0) + 1; if (/moves from/.test(l.text)) oop++; }
}
console.log(`injuries/game ${(inj / N).toFixed(2)}, out-of-position fills ${oop}`, byPos);
