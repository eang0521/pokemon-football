// Measure each type synergy's impact: a team plays an identical copy of itself,
// with one synergy forced active on one unit (4 of 7 players = tier 2).
// node tools/synergy-calibrate.mjs [gamesPerConfig] [types,comma,separated|all] [tier]
import { Game } from '../js/game.js';
import { TEAMS } from '../js/data/teams.js';
import { SYNERGIES, TIER_COUNTS } from '../js/synergy.js';
import { RNG } from '../js/rng.js';

const N = Number(process.argv[2] || 100);
const types = !process.argv[3] || process.argv[3] === 'all' ? Object.keys(SYNERGIES) : process.argv[3].split(',');
const tier = Number(process.argv[4] || 2);
const OFF = ['QB', 'RB', 'WR', 'FXO', 'OL1', 'OL2', 'OL3'], DEF = ['DL1', 'DL2', 'LB1', 'LB2', 'DB1', 'DB2', 'FXD'];

function run(type, unit) {
  const rng = new RNG(12345);
  let wins = 0, margin = 0, played = 0;
  for (let g = 0; g < N; g++) {
    const base = TEAMS[g % TEAMS.length];
    const A = { ...base, id: `${base.id}A` }, B = { ...base, id: `${base.id}B` };
    const synHome = g % 2 === 0; // alternate who is home
    const game = synHome ? new Game(B, A, 9000 + g) : new Game(A, B, 9000 + g);
    const idx = synHome ? 1 : 0;
    const D = game.depth[idx];
    if (type !== 'none') {
      const keys = (unit === 'O' ? OFF : DEF).slice().sort(() => rng.next() - 0.5).slice(0, TIER_COUNTS[tier - 1]);
      const members = new Set();
      for (const k of keys) { members.add(D.cards[k].id); const b = D.cards[`b${D.cards[k].pos}`]; if (b) members.add(b.id); }
      D.synOverride = { [unit]: { type, tier, members } };
    }
    let guard = 0;
    while (game.next() && guard++ < 800);
    const m = game.score[idx] - game.score[1 - idx];
    margin += m; played++;
    if (m > 0) wins++; else if (m === 0) wins += 0.5;
  }
  return { type, unit, win: wins / played, margin: margin / played };
}

const rows = [run('none', 'O')];
for (const t of types) for (const u of ['O', 'D']) rows.push(run(t, u));
for (const r of rows) console.log(JSON.stringify(r));
