// Return game stats: node tools/returns.mjs [games]
import { Game } from '../js/game.js';
import { TEAMS } from '../js/data/teams.js';
const N = Number(process.argv[2] || 30);
const k = { n: 0, y: 0, td: 0, tb: 0, fum: 0 }, p = { n: 0, y: 0, td: 0, fc: 0, muff: 0, tb: 0 };
for (let g = 0; g < N; g++) {
  const game = new Game(TEAMS[g % 8], TEAMS[(g + 5) % 8], 6100 + g);
  let rec;
  while ((rec = game.next())) {
    const t = rec.text || '';
    if (rec.type === 'kickoff' && !/onside/i.test(t)) { if (/Touchback/.test(t)) k.tb++; else { k.n++; const m = t.match(/(?:returned by .*? |back )(\d+) yards/); if (m) k.y += +m[1]; if (/TOUCHDOWN/.test(t)) k.td++; if (/FUMBLES/.test(t)) k.fum++; } }
    if (rec.type === 'punt') { if (/Touchback/.test(t)) p.tb++; else if (/Fair catch/.test(t)) p.fc++; else if (/MUFFED/.test(t)) p.muff++; else if (/returned by|returns it/.test(t)) { p.n++; const m = t.match(/(?:returned by .*? |returns it )(\d+) yards/); if (m) p.y += +m[1]; if (/TOUCHDOWN/.test(t)) p.td++; } }
  }
}
console.log(`Kick returns: ${k.n} (avg ${(k.y / k.n).toFixed(1)}), TDs ${k.td}, touchbacks ${k.tb}, fumbles ${k.fum}`);
console.log(`Punt returns: ${p.n} (avg ${(p.y / p.n).toFixed(1)}), TDs ${p.td}, fair catches ${p.fc}, muffs ${p.muff}, touchbacks ${p.tb}`);
