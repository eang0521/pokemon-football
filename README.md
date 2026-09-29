# Pokémon Gridiron

A static, browser-only 7-on-7 tackle football simulation where every player is a Pokémon card. Pick two teams (or build your own from any card), then watch the game play out on an animated top-down field. Each play is called by the coaches' AI and simulated player by player.

## Features

- **Agent-based play sim.** QBs drop back, go through progressions (you can see each read live), feel pressure, scramble, throw it away, or take sacks. Receivers run real route trees. Defenders play man coverage with reaction delays, match their zones, blitz, green-dog, spy, and pursue with proper intercept angles. Blockers engage in one-on-one leverage battles. Tackles, broken tackles, fumbles, tipped passes, contested catches, and interceptions all emerge from the simulation.
- **Situational play-calling.** Each coach has tendencies: pass rate, deep-shot rate, aggression, blitz rate, man/zone preference, play-action rate, run scheme, and tempo. Those combine with down and distance, field position, score, clock, and the team's personnel and front to pick plays. The defense adjusts to the opponent's observed tendencies. There are 4th-down, 2-point, and timeout decisions, plus spikes and kneels.
- **Full game flow.** Four 6-minute quarters with realistic clock rules, a two-minute warning, and timeouts. Kickoffs, onside kicks, punts, field goals, PATs, 2-point tries, safeties, penalties (false start, offside, holding, pass interference), and sudden-death overtime.
- **Fatigue and substitutions.** HP is stamina; tired players rotate out for their backups.
- **Team builder.** Build a 23-card roster from all 1,025 Pokémon.
- **Stats.** Box score, team stats, a drive chart, play-by-play, a live depth chart with energy, and players of the game.

### Cards
Every card is a **Pokémon at a position**, for example Delphox QB or Delphox DB. All 1,025 Pokémon can play all 9 positions (QB, RB, WR, TE, OL, DL, LB, DB, K). A card's ratings are simply the Pokémon's own base stats, and each stat means something specific at each position:

| Position | HP | Attack | Defense | Sp. Atk | Sp. Def | Speed |
|---|---|---|---|---|---|---|
| QB | Stamina | Arm strength | Toughness | Accuracy | Vision | Speed |
| RB | Stamina | Power | Ball security | Elusiveness | Vision | Speed |
| WR | Stamina | Physicality | Toughness | Route running | Hands | Speed |
| TE | Stamina | Blocking | Toughness | Route running | Hands | Speed |
| OL | Stamina | Run blocking | Pass blocking | Technique | Awareness | Footwork |
| DL | Stamina | Power rush | Run stopping | Finesse rush | Diagnosis | Get-off |
| LB | Stamina | Tackling | Block shedding | Blitzing | Coverage | Speed |
| DB | Stamina | Tackling | Press | Ball skills | Coverage | Speed |
| K | Stamina | Leg power | — | Accuracy | Composure | — |

Traits a position doesn't train still come from the same stat at an 85% discount (a WR who has to tackle after an interception uses his Attack at 85%). Weight and height stay universal: mass in collisions and catch radius.

### Rosters
- **Offense (7):** QB, RB, WR, FLEX (RB/WR/TE), OL x3. The FLEX sets personnel: a 2nd RB runs 2-back sets (I-form, split backs, fullback lead blocks), a 2nd WR runs spread sets, and a TE runs tight end sets.
- **Defense (7):** DL x2, LB x2, DB x2, FLEX (DL/LB/DB). The FLEX sets the front: 3-2-2, 2-3-2, or 2-2-3. Coverage calls are templates resolved against whatever front is on the field.
- **Special teams:** K.
- **Bench:** one backup each at QB, RB, WR, TE, OL, DL, LB, and DB. That's 23 cards in all, with no Pokémon on the roster twice.

### Fatigue
HP is stamina. Every snap drains energy by effort (distance run, blocks fought, trench work), scaled by stamina. Players on the sideline recover, with bigger boosts at quarter breaks, halftime, and timeouts. Below 80% energy a player's ratings fade. Starters under 66% rotate out for a fresh backup and return once they're back to 88%.

### Team builder
Build your own team from any card in the database. You can:
- search, and sort by any stat (labeled with what it means at that position);
- cap total base stats (BST) to keep legendaries out;
- choose the FLEX positions, team name, colors, and coach tendencies;
- use Auto-fill to complete a roster with the best available cards.

Custom teams are saved in your browser.

### Type synergies
Count each type among the 7 players a unit has on the field (dual types count for both). With **2 / 4 / 6** of a type, the synergy reaches tier I / II / III, and every Pokémon of that type in the unit gets its effect. Each effect works the same on offense and defense. Substitutions can switch a synergy on or off mid-game.

| Type | Synergy | Effect |
|---|---|---|
| Normal | Endurance | +HP (stamina) |
| Fighting | Brawler | +Attack (arm, power, blocking, tackling, depending on position) |
| Steel | Iron | +Defense (toughness, pass blocking, run stopping, press) |
| Psychic | Mind | +Sp. Atk (accuracy, route running, finesse rush, ball skills) |
| Fairy | Grace | +Sp. Def (vision, hands, diagnosis, coverage) |
| Electric | Charge | +Speed |
| Dragon | Outrage | Clutch: every rating rises on 3rd/4th down, in the red zone, and in one-score 4th quarters or overtime |
| Fire | Burst | Faster acceleration |
| Water | Flow | Keep speed through cuts, route breaks, and breaks on the ball |
| Grass | Photosynthesis | Faster energy recovery, less drain per snap |
| Ice | Chill | Opponents they make contact with are briefly slowed |
| Poison | Toxic | Opponents they make contact with lose extra energy |
| Ground | Leverage | Win the push in blocking battles, on either side of the block |
| Flying | Reach | Bigger reach on the ball (catch radius, interception and deflection radius) |
| Bug | Swarm | Stronger in contact for each nearby teammate |
| Rock | Sturdy | Resist being moved in blocks; fewer fumbles |
| Ghost | Phase | Chance that tackles and blocks on them miss |
| Dark | Feint | Defenders react late to their routes; QBs misjudge windows near them |

Magnitudes live in `SYNERGY_VALUES` in `js/synergy.js` and are balanced by simulation. `tools/synergy-calibrate.mjs` plays each team against an identical copy with one synergy forced to tier II, so every type can be tuned to about the same win-rate edge.

## Project layout

```
index.html            page shell
css/style.css
js/main.js            UI controller (playback, scorebug, panels)
js/builder.js         team builder + card browser
js/render.js          canvas field + DOM sprite tokens
js/game.js            game state machine: clock, downs, scoring, special teams, stats
js/depth.js           depth chart, energy/fatigue, substitutions
js/roster.js          roster slots, FLEX personnel/fronts, validation
js/ratings.js         cards: base stats -> position traits
js/synergy.js         type synergy definitions, tiers and tuned magnitudes
js/playcaller.js      offensive/defensive play-calling AI, 4th-down and PAT logic
js/playbook.js        formations, routes, plays, defensive call templates + resolver
js/sim/playSim.js     the per-play agent simulation
js/sim/special.js     kicking-play animation
js/storage.js         custom teams in localStorage
js/data/teams.js      the 8 AI teams (23-card rosters) and coach presets
js/data/pokemon.js    all 1,025 Pokémon, generated (do not edit by hand)
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

Share a specific game between AI teams with URL parameters, for example `?away=kanto&home=johto&seed=42`.

## Editing AI teams / refreshing data

1. Edit `js/data/teams.js`. Rosters use pokemondb.net slugs, e.g. `mr-mime`. FLEX slots take `slug:POS`, e.g. `luxray:TE`.
2. Refresh the card database with `node tools/fetch-pokemon.mjs`. It scrapes every species' base stats, types, height, and weight from pokemondb.net and checks for HOME sprites. Results are cached in `tools/.pokemon-cache.json`.

## Tuning tools

```bash
node tools/sim-test.mjs 100          # 100 headless games -> league-wide averages
node tools/play-stats.mjs 20         # every play vs every coverage
node tools/game-breakdown.mjs 40     # run game by scheme/coverage + pass-rush stats inside real games
node tools/trace-play.mjs smash c3 7 # frame-by-frame trace of one play
node tools/fatigue-report.mjs 12     # substitutions and energy by position
node tools/random-rosters.mjs 30     # stress test with random rosters from the whole Pokédex
node tools/synergy-calibrate.mjs 400 all 2   # win-rate edge of every type synergy at tier II
```

Sprites are hotlinked from [pokemondb.net](https://pokemondb.net/sprites) (Pokémon HOME renders by default, with optional Gen 5 animated sprites). Pokémon © Nintendo / Game Freak / The Pokémon Company. This is an unaffiliated fan project.
