// Plays whole adventure runs headless with a simple auto-player, to tune difficulty.
// node tools/adventure-sim.mjs [runs] [strategy: random|fight|loot]
import { Game } from '../js/game.js';
import { COACH_PRESETS } from '../js/data/teams.js';
import * as A from '../js/adventure/run.js';
import { ovrOf } from '../js/adventure/cards.js';

const N = Number(process.argv[2] || 10);
const STRAT = process.argv[3] || 'random';
const OFFSET = Number(process.argv[4] || 0);
const pref = { random: {}, fight: { battle: 3, elite: 2 }, loot: { pack: 3, shop: 3, training: 3, event: 2, rest: 2 } }[STRAT];

function playBattle(run) {
  const node = run.node;
  const me = A.gameTeam(run);
  const g = new Game(node.opponent, me, A.battleSeed(run));
  while (g.next());
  const injuredSlots = Object.values(g.players).filter((p) => p.teamId === 'adv' && p.injured).map((p) => p.id.slice(4).split('@')[0]);
  return A.applyBattle(run, { pf: g.score[1], pa: g.score[0], injuredSlots });
}

// greedy "does this card beat the weakest starter at its position?" value
function gain(run, c) {
  const at = Object.entries(run.lineup).map(([k, u]) => ({ k, c: A.cardByUid(run, u) })).filter((x) => x.c && x.c.pos === c.pos && !x.k.startsWith('b'));
  if (!at.length) return ovrOf(c) - 40;
  return ovrOf(c) - Math.min(...at.map((x) => ovrOf(x.c)));
}

const agg = { runs: 0, won: 0, lost: 0, byAct: {}, deathAt: [], ovrAt: {} };
const bump = (act, type, win) => { const k = `${act}-${type}`; agg.byAct[k] = agg.byAct[k] || { g: 0, w: 0 }; agg.byAct[k].g++; if (win) agg.byAct[k].w++; };
for (let r = 0; r < N; r++) {
  const run = A.newRun({ team: { city: 'Test', name: 'Runners', abbr: 'TST', colors: { primary: '#333333', secondary: '#ffcc00' }, coach: { name: 'Coach Bot', preset: 'balanced', ...COACH_PRESETS.balanced } }, seed: 1000 + OFFSET + r });
  let guard = 0;
  while (run.status === 'active' && guard++ < 200) {
    const opts = A.available(run);
    const pick = opts.slice().sort((a, b) => (pref[b.type] || 1) * Math.random() - (pref[a.type] || 1) * Math.random())[0];
    const node = A.enterNode(run, pick.row, pick.col);
    const t = node.type;
    if (t === 'battle' || t === 'elite' || t === 'boss') {
      if (t === 'boss') { const k = `a${run.act}`; agg.ovrAt[k] = agg.ovrAt[k] || []; agg.ovrAt[k].push(A.teamRating(run).pct); }
      for (;;) {
        const res = playBattle(run);
        bump(run.act, t, res.win);
        if (res.win && res.draft.length) {
          for (let k = 0; k < (res.picks || 1); k++) {
            const best = res.draft.map((c, i) => ({ i, v: gain(run, c) })).filter((x) => !(res.drafted || []).includes(x.i)).sort((a, b) => b.v - a.v)[0];
            if (best) A.takeDraft(run, best.i);
          }
        }
        if (run.status !== 'active') break;
        if (res.retry) { A.retryBattle(run); continue; }
        break;
      }
      if (run.status === 'active') A.completeNode(run);
    } else if (t === 'pack') { A.takePack(run); A.completeNode(run); }
    else if (t === 'shop') {
      const s = node.shop;
      if (run.cards.some((c) => c.inj > 0)) A.buyItem(run, 'heal');
      if (run.lives < 2) A.buyItem(run, 'life');
      for (;;) {
        const best = s.cards.map((c, i) => ({ c, i, v: gain(run, c) })).filter((x) => !x.c.sold && x.c.price <= run.coins && x.v > 2).sort((a, b) => b.v - a.v)[0];
        if (!best) break;
        A.buyCard(run, best.i);
      }
      A.buyItem(run, 'pack');
      A.completeNode(run);
    } else if (t === 'training') {
      const st = Object.entries(run.lineup).filter(([k]) => !k.startsWith('b')).map(([, u]) => A.cardByUid(run, u)).filter(Boolean);
      const target = st.sort((a, b) => ovrOf(b) - ovrOf(a))[0];
      A.trainCard(run, target.uid); A.completeNode(run);
    } else if (t === 'rest') {
      A.restChoice(run, run.cards.some((c) => c.inj > 0 && Object.values(run.lineup).includes(c.uid)) ? 'heal' : run.lives < run.maxLives ? 'life' : 'coins');
      A.completeNode(run);
    } else if (t === 'event') {
      const o = A.eventOptions(run).filter((x) => !x.disabled);
      const e = node.event;
      let key = o[0].key;
      if (e.id === 'gamble') key = 'pass';
      if (e.id === 'trade') key = ovrOf(e.ctx.get) > ovrOf(A.cardByUid(run, e.ctx.give) || { mon: e.ctx.giveCard.mon, pos: e.ctx.giveCard.pos }) + 3 ? 'accept' : 'pass';
      if (e.id === 'sponsor') key = 'card';
      A.resolveEvent(run, key); A.completeNode(run);
    }
  }
  agg.runs++;
  if (run.status === 'won') agg.won++; else { agg.lost++; agg.deathAt.push(`a${run.act}r${run.pos?.row ?? -1}`); }
  process.stderr.write(`run ${r}: ${run.status} act ${run.act} steps ${run.path.length} W-L-T ${run.stats.w}-${run.stats.l}-${run.stats.t} team pct ${A.teamRating(run).pct} cards ${run.cards.length} coins ${run.coins}\n`);
}
console.log(`strategy ${STRAT}: ${agg.won}/${agg.runs} runs won`);
for (const k of Object.keys(agg.byAct).sort()) console.log(k, `${agg.byAct[k].w}/${agg.byAct[k].g}`, (agg.byAct[k].w / agg.byAct[k].g * 100).toFixed(0) + '%');
for (const k in agg.ovrAt) console.log('team pct at boss', k, (agg.ovrAt[k].reduce((a, b) => a + b, 0) / agg.ovrAt[k].length).toFixed(1));
console.log('eliminated at', agg.deathAt.join(' '));
