// Kicking plays over full games: blocks by rush call, fakes, and the snap check: node tools/kicks.mjs [games]
import { Game } from '../js/game.js';
import { TEAMS } from '../js/data/teams.js';

const N = Number(process.argv[2] || 40);
const c = { punt: 0, puntBlk: 0, puntBlockCall: 0, puntBlkOnBlock: 0, fg: 0, fgBlk: 0, fgBlockCall: 0, fgBlkOnBlock: 0, pat: 0, patBlk: 0,
  fakes: 0, fakeWins: 0, badSnap: 0, kicks: 0, puntYds: 0, fgMade: 0,
  pTB: 0, pFair: 0, pDowned: 0, pRet: 0, pIn20: 0, pinTries: 0, kickGap: [], koGap: [], fgT: [] };
// the frame where the ball leaves the kicker's foot, and how far the kicker / punter is from it then
function kickMoment(rec, kickerIdx) {
  for (let i = 1; i < rec.frames.length; i++) {
    const a = rec.frames[i - 1], b = rec.frames[i];
    if (b.b[2] > a.b[2] + 0.25 && b.b[3] < 0) { const k = a.p[kickerIdx]; return { t: a.t, gap: Math.hypot(k[0] - a.b[0], k[1] - a.b[1]) }; }
  }
  return null;
}
for (let k = 0; k < N; k++) {
  const g = new Game(TEAMS[k % 8], TEAMS[(k + 1 + (k >> 3)) % 8], 5100 + k);
  let rec;
  while ((rec = g.next())) {
    const t = rec.text || '';
    if (/^FAKE/.test(t)) { c.fakes++; if (rec.firstDown || rec.highlight === 'td') c.fakeWins++; continue; }
    if (rec.type === 'kickoff' && !/onside/.test(t)) {
      const ki = rec.cast.findIndex((x) => (x.card || x.pos) === 'K');
      const m = ki >= 0 && kickMoment(rec, ki); if (m) c.koGap.push(m.gap);
      continue;
    }
    if (rec.type !== 'punt' && rec.type !== 'fg' && rec.type !== 'pat') continue;
    // the snap: at the first frame the ball should be at the line, not in the punter's / holder's hands
    const f0 = rec.frames[0], dirX = rec.type === 'punt' ? 100 - rec.before.ballOn : rec.losX ?? (rec.type === 'pat' ? 85 : rec.before.ballOn);
    c.kicks++;
    if (Math.abs(f0.b[0] - dirX) > 2) c.badSnap++;
    const blk = /BLOCKED/.test(t), all = /all-out/.test(rec.presnap?.defCall || '');
    if (rec.type === 'punt') {
      if (/Touchback/.test(t)) c.pTB++; else if (/Fair catch/.test(t)) c.pFair++; else if (/downed/.test(t)) c.pDowned++; else if (/returned/.test(t)) c.pRet++;
      if (/pinning/.test(rec.presnap?.offReason || '')) c.pinTries++;
      const ki = rec.cast.findIndex((x) => (x.card || x.pos) === 'K'); const m = ki >= 0 && kickMoment(rec, ki); if (m) c.kickGap.push(m.gap);
      const after = rec.after; if (after && after.poss !== rec.before.poss && after.ballOn <= 20 && !/Touchback/.test(t)) c.pIn20++;
    }
    if (rec.type === 'fg') { const m = kickMoment(rec, 1); if (m) { c.fgT.push(m.t); c.kickGap.push(m.gap); } }
    if (rec.type === 'punt') { c.punt++; c.puntBlk += blk; c.puntBlockCall += all; c.puntBlkOnBlock += blk && all; const m = t.match(/punts (\d+) yards/); if (m) c.puntYds += +m[1]; }
    else if (rec.type === 'fg') { c.fg++; c.fgBlk += blk; c.fgBlockCall += all; c.fgBlkOnBlock += blk && all; c.fgMade += /GOOD/.test(t); }
    else { c.pat++; c.patBlk += blk; }
  }
}
const pc = (a, b) => (b ? `${(a / b * 100).toFixed(1)}%` : '-');
console.log(`${N} games`);
console.log(`punts ${c.punt} (${(c.puntYds / Math.max(1, c.punt - c.puntBlk)).toFixed(1)} avg): blocked ${c.puntBlk} (${pc(c.puntBlk, c.punt)}); all-out rush ${pc(c.puntBlockCall, c.punt)} of punts, block rate then ${pc(c.puntBlkOnBlock, c.puntBlockCall)}`);
console.log(`field goals ${c.fg} (${pc(c.fgMade, c.fg)} made): blocked ${c.fgBlk} (${pc(c.fgBlk, c.fg)}); all-out rush ${pc(c.fgBlockCall, c.fg)}, block rate then ${pc(c.fgBlkOnBlock, c.fgBlockCall)}`);
console.log(`PATs ${c.pat}: blocked ${c.patBlk} (${pc(c.patBlk, c.pat)})`);
console.log(`fakes ${c.fakes} (${(c.fakes / N).toFixed(2)}/game), converted ${pc(c.fakeWins, c.fakes)}`);
console.log(`kicks starting with the ball away from the snapper: ${c.badSnap} of ${c.kicks}`);
console.log(`punt results: touchback ${pc(c.pTB, c.punt)}, fair catch ${pc(c.pFair, c.punt)}, downed ${pc(c.pDowned, c.punt)}, returned ${pc(c.pRet, c.punt)}; pinned inside the 20 ${pc(c.pIn20, c.punt)} (pin attempts ${pc(c.pinTries, c.punt)})`);
const med = (a) => (a.length ? a.slice().sort((x, y) => x - y)[a.length >> 1].toFixed(2) : '-');
const mx = (a) => (a.length ? Math.max(...a).toFixed(2) : '-');
console.log(`kicker/punter distance from the ball as it's kicked: punts+FGs median ${med(c.kickGap)} (max ${mx(c.kickGap)}), kickoffs median ${med(c.koGap)} (max ${mx(c.koGap)}); FG snap-to-kick ${med(c.fgT)} s`);
