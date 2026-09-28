// Lightweight animation for kicking plays. Outcomes are decided in game.js;
// this just produces believable frames (in the KICKING team's frame).
import { DT } from './playSim.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r2 = (v) => Math.round(v * 100) / 100;

function mover(x, y, spd) { return { x, y, vx: 0, vy: 0, spd }; }
function step(m, tx, ty, frac = 1) {
  const dx = tx - m.x, dy = ty - m.y, d = Math.hypot(dx, dy);
  const v = Math.min(m.spd * frac, d / DT);
  const want = d > 1e-6 ? { x: (dx / d) * v, y: (dy / d) * v } : { x: 0, y: 0 };
  m.vx += (want.x - m.vx) * 0.25; m.vy += (want.y - m.vy) * 0.25;
  m.x += m.vx * DT; m.y += m.vy * DT;
}
const spdOf = (pl) => 5.6 + pl.ratings.spd * 0.043;

// opts: { kind:'kickoff'|'punt'|'fg', W, kickX, kickY, landX, landY, hang, returnEndX|null,
//         kickers:[players], receivers:[players], returnerIdx, fgGood, blocked }
export function specialFrames(o) {
  const { W } = o;
  const frames = [];
  const K = o.kickers.map((pl, i) => {
    let x, y;
    if (o.kind === 'kickoff') { x = o.kickX - (i === 0 ? 6 : 1); y = i === 0 ? W / 2 : 3 + (i - 1) * ((W - 6) / 5); }
    else if (o.kind === 'punt') { x = i === 0 ? o.kickX - 13 : o.kickX - 0.6; y = i === 0 ? o.kickY : o.kickY + [0, 0, -1.4, 1.4, -2.8, 2.8, 0][i] * 1; if (i === 6) x = o.kickX - 6; }
    else { x = i === 0 ? o.kickX - 7.5 : i === 1 ? o.kickX - 7 : o.kickX - 0.6; y = i <= 1 ? o.kickY + (i === 0 ? -0.8 : 0.6) : o.kickY + [0, 0, -1.3, 1.3, -2.6, 2.6, 3.9][i]; }
    return { m: mover(x, y, spdOf(pl)), pl };
  });
  const R = o.receivers.map((pl, i) => {
    let x, y;
    if (o.kind === 'kickoff') {
      if (i === o.returnerIdx) { x = Math.max(o.landX, 95); y = W / 2; }
      else { x = o.kickX + 12 + (i % 3) * 8; y = 5 + i * ((W - 10) / 6); }
    } else if (o.kind === 'punt') {
      if (i === o.returnerIdx) { x = o.landX; y = o.landY; }
      else { x = o.kickX + 1 + (i < 3 ? 0 : 6); y = o.kickY + (i - 3) * 2.2; }
    } else { x = o.kickX + 1; y = o.kickY + (i - 3) * 1.6; }
    return { m: mover(x, y, spdOf(pl)), pl };
  });
  const all = [...K, ...R];
  const retIdx = o.returnerIdx != null ? K.length + o.returnerIdx : -1;
  const snapT = o.kind === 'kickoff' ? 0.9 : o.kind === 'punt' ? 1.25 : 1.05;
  const flightT = o.hang;
  let t = 0;
  const endReturn = o.returnEndX;
  let caught = false, done = false, doneT = null;
  const ball = { x: K[0].m.x + 0.8, y: K[0].m.y, z: 0.3 };
  if (o.kind !== 'kickoff') { ball.x = o.kickX; ball.y = o.kickY; }

  while (!done && t < 16) {
    // --- ball
    let holder = -1;
    if (t < snapT) {
      if (o.kind === 'kickoff') { step(K[0].m, o.kickX - 0.5, W / 2, 0.9); ball.x = o.kickX; ball.y = W / 2; ball.z = 0.2; }
      else {
        const s = clamp(t / 0.35, 0, 1);
        const hx = o.kind === 'punt' ? K[0].m.x : o.kickX - 7;
        ball.x = o.kickX + (hx - o.kickX) * s; ball.y = o.kickY; ball.z = 0.5 + s * 0.5;
      }
    } else if (t < snapT + flightT && !caught) {
      const s = (t - snapT) / flightT;
      const sx = o.kind === 'kickoff' ? o.kickX : o.kind === 'punt' ? o.kickX - 12 : o.kickX - 7;
      const sy = o.kind === 'kickoff' ? W / 2 : o.kickY;
      ball.x = sx + (o.landX - sx) * s;
      ball.y = sy + (o.landY - sy) * s;
      const peak = o.kind === 'fg' ? 7 : o.kind === 'punt' ? 14 : 16;
      ball.z = 1 + peak * 4 * s * (1 - s) + (o.kind === 'fg' ? s * 4 : 0);
      if (o.blocked && s > 0.08) { done = true; doneT = t; }
    } else {
      if (!caught) { caught = true; if (o.kind === 'fg' || endReturn == null) { done = true; doneT = t; } }
      if (retIdx >= 0 && endReturn != null) {
        holder = retIdx;
        const rm = all[retIdx].m;
        ball.x = rm.x; ball.y = rm.y; ball.z = 1;
        if (rm.x <= endReturn + 0.3) { done = true; doneT = t; }
      }
    }
    // --- players
    const rm = retIdx >= 0 ? all[retIdx].m : null;
    K.forEach((k, i) => {
      if (o.kind === 'fg') { if (i > 1) step(k.m, k.m.x - 0.2, k.m.y, 0.2); else if (i === 0 && t > snapT - 0.4) step(k.m, o.kickX - 6.8, o.kickY - 0.2, 0.4); return; }
      if (t < snapT - (o.kind === 'kickoff' ? 0.6 : 0)) { if (o.kind === 'kickoff' && i > 0) step(k.m, o.kickX - 0.5, k.m.y, 0.6); return; }
      if (i === 0 && o.kind !== 'kickoff') { step(k.m, k.m.x + 0.5, k.m.y, 0.3); return; }
      const tx = rm ? (caught ? rm.x + rm.vx * 0.5 : o.landX) : o.landX;
      const ty = rm ? rm.y + (i - 3) * (caught ? 0.3 : 1.8) : o.landY;
      step(k.m, tx, ty, 0.95);
    });
    R.forEach((r, i) => {
      const idx = K.length + i;
      if (o.kind === 'fg') { step(r.m, o.kickX - 5, o.kickY + (i - 3) * 0.8, t > 0.2 ? 0.7 : 0); return; }
      if (idx === retIdx) {
        if (!caught) step(r.m, o.landX, o.landY, 0.7);
        else if (endReturn != null) step(r.m, endReturn - 2, clamp(r.m.y + Math.sin(t * 1.3) * 3, 3, W - 3), 1);
        return;
      }
      // blockers: set a wall between coverage and returner
      const k = K[Math.min(K.length - 1, i + 1)].m;
      if (t > snapT) step(r.m, (k.x + (rm ? rm.x : o.landX)) / 2 + 1, k.y, 0.8);
    });
    // separation
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
      const a = all[i].m, b = all[j].m;
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
      if (d > 1e-4 && d < 0.75) { const p = (0.75 - d) / 2; a.x -= (dx / d) * p; a.y -= (dy / d) * p; b.x += (dx / d) * p; b.y += (dy / d) * p; }
    }
    frames.push({ t: r2(t), p: all.map((e) => [r2(e.m.x), r2(e.m.y), 0, r2(e.m.vx), r2(e.m.vy)]), b: [r2(ball.x), r2(ball.y), r2(ball.z), holder], read: -1 });
    t = r2(t + DT);
  }
  // brief hold after the whistle
  const last = frames[frames.length - 1];
  for (let i = 0; i < 10; i++) frames.push({ ...last, t: r2(last.t + (i + 1) * DT) });
  return { frames, duration: doneT ?? t, cast: all.map((e, i) => ({ pid: e.pl.id, side: i < K.length ? 'O' : 'D', pos: e.pl.pos })) };
}
