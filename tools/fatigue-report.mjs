// Fatigue/substitution report: node tools/fatigue-report.mjs [games]
import { Game } from '../js/game.js';
import { TEAMS } from '../js/data/teams.js';

const N = Number(process.argv[2] || 10);
const subsByPos = {}, minEnergy = {}, snapShare = {};
let subs = 0;
for (let g = 0; g < N; g++) {
  const game = new Game(TEAMS[g % 8], TEAMS[(g + 3) % 8], 4000 + g);
  let low = {};
  game.onPlay = () => { for (const d of game.depth) for (const c of d.all()) { const e = d.energy[c.id]; low[c.pos] = Math.min(low[c.pos] ?? 100, e); } };
  while (game.next());
  for (const l of game.log) if (l.kind === 'sub' && / in for /.test(l.text)) { subs++; const pos = l.text.match(/\((\w+)\) in for/)[1]; subsByPos[pos] = (subsByPos[pos] || 0) + 1; }
  for (const k in low) minEnergy[k] = Math.min(minEnergy[k] ?? 100, Math.round(low[k]));
  for (const d of game.depth) for (const c of d.all()) { const s = game.stats.players[c.id].snaps; const key = `${c.slot.startsWith('b') ? 'bench' : 'start'} ${c.pos}`; (snapShare[key] ||= []).push(s); }
}
console.log(`subs/game ${(subs / N).toFixed(1)}`, subsByPos);
console.log('lowest energy seen by position', minEnergy);
console.log('avg snaps:', Object.fromEntries(Object.entries(snapShare).map(([k, v]) => [k, Math.round(v.reduce((a, b) => a + b, 0) / v.length)])));
