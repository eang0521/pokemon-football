# Pokémon Gridiron

A static, browser-only 7-on-7 tackle football simulation where every player is a Pokémon. Pick two teams, then watch the game play out on an animated top-down field. Each play is called by the coaches' AI and simulated player by player.

## Features

- **Agent-based play sim.** QBs drop back, go through progressions (you can see each read live), feel pressure, scramble, throw it away, or take sacks. Receivers run real route trees. Defenders play man coverage with reaction delays, match their zones, blitz, green-dog, spy, and pursue with proper intercept angles. Blockers engage in one-on-one leverage battles. Tackles, broken tackles, fumbles, tipped passes, contested catches, and interceptions all emerge from the simulation.
- **Situational play-calling.** Each coach has tendencies: pass rate, deep-shot rate, aggression, blitz rate, man/zone preference, play-action rate, run scheme, and tempo. Those combine with down and distance, field position, score, and clock (two-minute drill, killing the clock) to pick plays. The defense adjusts to the opponent's observed tendencies. There are 4th-down, 2-point, and timeout decisions, plus spikes and kneels.
- **Full game flow.** Four 6-minute quarters with realistic clock rules, a two-minute warning, and timeouts. Kickoffs, onside kicks, punts, field goals, PATs, 2-point tries, safeties, penalties (false start, offside, holding, pass interference), and sudden-death overtime.
- **Stats.** Box score, team stats, a drive chart, play-by-play, and players of the game.

### Positions
- **Offense:** QB, RB, WR ×2, TE, C, G
- **Defense:** DL ×2, LB ×2, CB ×2, S
- Plus a K/P

### How Pokémon stats map to football

| Base stat | Football rating |
|---|---|
| Speed | SPD (top speed), AGI (cuts and jukes; lighter Pokémon are quicker) |
| Attack | STR (blocking, tackling, breaking tackles), kick power |
| Defense | TGH (hard to bring down) |
| Sp. Atk | ARM (throw velocity), part of accuracy and hands |
| Sp. Def | AWR (reads and reactions), ACC, HANDS |
| HP | Stamina |
| Weight / Height | Mass in collisions / catch radius |

A type-synergy hook is stubbed in `js/ratings.js` (`TYPE_SYNERGIES`). For example, fielding 3+ Electric types could give the unit a speed boost.

## Project layout

```
index.html            page shell
css/style.css
js/main.js            UI controller (playback, scorebug, panels)
js/render.js          canvas field + DOM sprite tokens
js/game.js            game state machine: clock, downs, scoring, special teams, stats
js/playcaller.js      offensive/defensive play-calling AI, 4th-down and PAT logic
js/playbook.js        formations, routes, plays, defensive calls
js/sim/playSim.js     the per-play agent simulation
js/sim/special.js     kicking-play animation
js/ratings.js         base stats -> ratings (+ type-synergy hook)
js/data/teams.js      the 8 themed teams and coaches
js/data/pokemon.js    generated stats (do not edit by hand)
tools/                data scraper, local server, headless test harnesses
```

## Run locally

It's plain ES modules with no build step. Any static server works:

```bash
node tools/serve.mjs 8080
```

Then open http://localhost:8080.

## Deploy to GitHub Pages

1. Push this folder to a GitHub repository.
2. In the repo, go to **Settings → Pages → Build and deployment**, set **Source: Deploy from a branch**, then pick `main` and `/ (root)`.
3. The site will be at `https://<user>.github.io/<repo>/`.

Share a specific game with URL parameters, for example `?away=kanto&home=johto&seed=42`.

## Editing teams / adding Pokémon

1. Edit `js/data/teams.js`. Use the pokemondb.net slug for each Pokémon, e.g. `mr-mime`.
2. Regenerate the stats file: `node tools/fetch-pokemon.mjs`. It scrapes base stats, types, height, and weight from pokemondb.net and checks which sprite sets exist.

## Tuning tools

```bash
node tools/sim-test.mjs 100          # 100 headless games -> league-wide averages
node tools/play-stats.mjs 20         # every play vs every coverage
node tools/game-breakdown.mjs 40     # run game by scheme/coverage + pass-rush stats inside real games
node tools/trace-play.mjs smash c3 7 # frame-by-frame trace of one play
```

Sprites are hotlinked from [pokemondb.net](https://pokemondb.net/sprites) (Pokémon HOME renders by default, with optional Gen 5 animated sprites). Pokémon © Nintendo / Game Freak / The Pokémon Company. This is an unaffiliated fan project.
