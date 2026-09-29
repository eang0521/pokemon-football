// Stress test: games between fully random rosters from the whole Pokédex.
import { Game } from '../js/game.js';
import { POKEMON_LIST } from '../js/data/pokemon.js';
import { STARTERS, BENCH, validateRoster } from '../js/roster.js';
import { COACH_PRESETS } from '../js/data/teams.js';
import { RNG } from '../js/rng.js';

const N = Number(process.argv[2] || 30);
const rng = new RNG(99);
function randomTeam(i) {
  const roster = {}, used = new Set();
  for (const s of [...STARTERS, ...BENCH]) {
    let p; do { p = rng.pick(POKEMON_LIST); } while (used.has(p.slug));
    used.add(p.slug);
    roster[s.key] = s.pos.length > 1 ? `${p.slug}:${rng.pick(s.pos)}` : p.slug;
  }
  const preset = rng.pick(Object.keys(COACH_PRESETS));
  return { id: `r${i}`, city: 'Rand', name: `Team${i}`, abbr: `R${i % 10}`, colors: { primary: '#555555', secondary: '#999999' },
    coach: { name: 'Coach R', preset, ...COACH_PRESETS[preset] }, roster };
}
let pts = 0, errs = 0;
for (let g = 0; g < N; g++) {
  const a = randomTeam(g * 2), b = randomTeam(g * 2 + 1);
  if (validateRoster(a.roster).length || validateRoster(b.roster).length) { console.log('invalid roster'); errs++; continue; }
  try {
    const game = new Game(a, b, 7000 + g);
    let guard = 0;
    while (game.next() && guard++ < 700);
    if (guard >= 700) { console.log('runaway game', g); errs++; }
    pts += game.score[0] + game.score[1];
  } catch (e) { errs++; console.log('CRASH', g, e.stack.split('\n').slice(0, 3).join(' | ')); }
}
console.log(`${N} random-roster games, ${errs} problems, ${(pts / N).toFixed(1)} pts/game`);
