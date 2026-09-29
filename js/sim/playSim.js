// Physics-lite, agent-based simulation of a single scrimmage play.
//
// Everything is in the OFFENSE frame: x = yards from the offense's own goal line
// (offense attacks toward x = 100), y = 0..W across the field.
// The sim records a frame every tick so the UI can replay it.
import { FORMATIONS, ROUTES, assignFor, resolveDefense } from '../playbook.js';

export const DT = 0.05;
const MAX_T = 14;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const hyp = Math.hypot;
const dist = (a, b) => hyp(a.x - b.x, a.y - b.y);
const r2 = (v) => Math.round(v * 100) / 100;

// --------------------------------------------------------------------------
// Entities
function makeEnt(player, ratings, side, pos, idx, mods = {}) {
  const rt = ratings;
  return {
    mods: mods || {},
    idx, side, pos, kind: player.pos, pl: player, r: rt,
    x: 0, y: 0, vx: 0, vy: 0, x0: 0, y0: 0,
    maxSpd: 5.6 + rt.spd * 0.043,
    accel: (4.6 + rt.agi * 0.045) * (1 + (mods?.burst || 0)), // Fire: burst
    mass: rt.mass,
    height: player.height,
    role: null, route: null, wp: 0, engaged: null,
    stunUntil: -1, noEngageUntil: -1, lastTackleTry: -9, slowUntil: -1,
    hist: [], down: false, tipTried: false,
  };
}

function steer(e, tx, ty, frac, S) {
  let top = e.maxSpd * frac * (e.spdMul ?? 1);
  if (S.t < e.stunUntil) top *= 0.25;
  if (S.t < e.slowUntil) top *= 0.72;
  if (e.hasBall) top *= 0.93;
  const dx = tx - e.x, dy = ty - e.y;
  const d = hyp(dx, dy);
  const want = Math.min(top, d * 3.2);
  const dvx = (d > 1e-6 ? (dx / d) * want : 0) - e.vx;
  const dvy = (d > 1e-6 ? (dy / d) * want : 0) - e.vy;
  const dv = hyp(dvx, dvy);
  let lim = e.accel * DT;
  if (e.mods.flow) {
    const sp = hyp(e.vx, e.vy);
    if (sp > 2 && d > 1e-6 && (e.vx * dx + e.vy * dy) < 0.5 * sp * d) lim *= 1 + e.mods.flow * 1.5;
  }
  const k = dv > lim ? lim / dv : 1;
  e.vx += dvx * k;
  e.vy += dvy * k;
}

// --------------------------------------------------------------------------
// Zone landmarks
function zoneSpot(name, S) {
  const { los, ballY, flip, W } = S;
  const side = name.endsWith('S') ? flip : name.endsWith('W') ? -flip : 0;
  const base = name.replace(/[SWM]$/, '');
  let depth, y, halfW, deep = false;
  switch (base) {
    case 'deepMid': depth = 14.5; y = (W / 2 + ballY) / 2; halfW = 16; deep = true; break;
    case 'half': depth = 13.5; y = W / 2 + side * (W / 4); halfW = 10; deep = true; break;
    case 'third': depth = 13; y = W / 2 + side * (W / 3); halfW = 7.5; deep = true; break;
    case 'quarter': depth = 11; y = W / 2 + side * 13; halfW = 7; deep = true; break;
    case 'curl': depth = 7; y = ballY + side * 9; halfW = 6; break;
    case 'hook': depth = 7; y = ballY + side * 4; halfW = 5.5; break;
    case 'deepHook': depth = 11; y = ballY + side * 6; halfW = 6; break;
    case 'flat': depth = 4; y = ballY + side * 12; halfW = 6.5; break;
    case 'prevent': depth = side ? 18 : 26; y = W / 2 + side * 12; halfW = side ? 9 : 16; deep = true; break;
    default: depth = 8; y = ballY; halfW = 6;
  }
  // don't drop out the back of the end zone
  const x = Math.min(los + depth, 108);
  return { x, y: clamp(y, 3, W - 3), halfW, deep, name };
}

// --------------------------------------------------------------------------
// Setup
export function simulatePlay(opts) {
  const { rng, W, los, ballY, flip, offense, defense, play, dcall, situation } = opts;
  const S = {
    rng, W, los, ballY, flip, play, dcall, situation,
    t: 0, ents: [], O: {}, D: {}, frames: [], events: [], pairs: [],
    ball: { state: 'held', holder: null, x: 0, y: 0, z: 1 },
    carrier: null, phase: 'live', result: null,
    handed: false, thrown: false, passInfo: null, runDiag: {},
    qb: { state: 'drop', tSet: null, readIdx: 0, lastEval: 0, onRun: false },
    stats: [], tacklers: [], design: { routes: [], zones: [], aim: null, rush: [] }, toxic: {},
  };
  const form = FORMATIONS[opts.form];
  S.form = form;
  S.pers = offense.personnel;

  offense.slots.forEach(({ slot, player, ratings, mods }, i) => {
    const e = makeEnt(player, ratings, 'O', slot, i, mods);
    const [dx, dy] = form.align[slot];
    e.x = e.x0 = los + dx;
    e.y = e.y0 = clamp(ballY + dy * flip, 1.2, W - 1.2);
    S.ents.push(e); S.O[slot] = e;
  });
  defense.slots.forEach(({ slot, player, ratings, mods }, i) => {
    const e = makeEnt(player, ratings, 'D', slot, i + 7, mods);
    S.ents.push(e); S.D[slot] = e;
  });
  S.offList = S.ents.filter((e) => e.side === 'O');
  S.defList = S.ents.filter((e) => e.side === 'D');
  S.runner = play.carrier === 'FX' ? S.O.FX : S.O.RB;

  setupOffense(S);
  setupDefense(S);
  if (play.type === 'run') assignRunBlocks(S);
  S.ball.holder = S.O.C;
  syncBall(S);
  if (opts.motion && S.O.FX && S.O.FX.detached) runMotion(S);
  record(S);

  // snap
  S.ball.holder = S.O.QB;
  S.O.QB.hasBall = true;
  if (play.type === 'run' && play.carrier === 'QB') { setCarrier(S, S.O.QB); S.handed = true; S.handTime = 0; }

  while (!S.result && S.t < MAX_T) {
    S.t = r2(S.t + DT);
    tick(S);
    record(S);
  }
  settleFall(S);
  if (!S.result) endPlay(S, { type: 'timeout' });
  return finalize(S);
}

// Pre-snap motion: the FLEX receiver motions across from the other side. A man
// defender has to travel with him, which tips man vs zone to the QB.
function runMotion(S) {
  const fx = S.O.FX, W = S.W;
  const endY = fx.y0, startY = clamp(S.ballY - (fx.y0 - S.ballY), 1.5, W - 1.5);
  const follower = S.defList.find((d) => d.man === fx && (d.role === 'man' || d.role === 'dog'));
  const fEnd = follower ? { x: follower.x0, y: follower.y0 } : null;
  const fStart = follower ? { x: follower.x0, y: clamp(S.ballY - (follower.y0 - S.ballY), 1, W - 1) } : null;
  // ~6 yd/s average (9 at peak), at least 0.8 s
  const n = Math.max(16, Math.ceil(Math.abs(endY - startY) / 6 / DT)), dur = n * DT;
  const ease = (u) => u * u * (3 - 2 * u);
  S.design.motion = { idx: fx.idx, from: { x: fx.x0, y: startY }, to: { x: fx.x0, y: endY } };
  for (let k = 0; k <= n; k++) {
    const u = k / n, e = ease(u);
    fx.x = fx.x0; fx.y = startY + (endY - startY) * e; fx.vy = (endY - startY) / dur;
    // the man defender reacts a beat late but still arrives by the snap
    if (follower) { follower.x = fStart.x; follower.y = fStart.y + (fEnd.y - fStart.y) * ease(Math.max(0, (u - 0.1) / 0.9)); follower.vy = fx.vy; }
    if (k < n) { S.t = r2(-dur + k * DT); record(S); }
  }
  fx.x = fx.x0; fx.y = fx.y0; fx.vx = fx.vy = 0;
  if (follower) { follower.x = fEnd.x; follower.y = fEnd.y; follower.vx = follower.vy = 0; }
  S.coverageTipped = follower ? 'man' : 'zone';
  S.motionFrames = n;
  S.t = 0;
  event(S, follower ? `Motion: ${follower.pl.name} travels with ${fx.pl.name} — man coverage!` : `Motion: nobody follows ${fx.pl.name} — zone.`);
  S.events[S.events.length - 1].t = -0.1;
}

function setupOffense(S) {
  const { play, flip, O } = S;
  const pers = S.pers;
  const backOut = (e) => {
    const dy = e.y0 - S.ballY;
    if (Math.abs(dy) > 0.5) return Math.sign(dy);
    return flip * (play.rbDir || 1);
  };
  for (const slot of ['WR', 'FX', 'RB']) {
    const e = O[slot];
    e.detached = Math.abs(e.y0 - S.ballY) > 4;
    if (play.type === 'run') {
      if (e === S.runner && play.carrier !== 'QB') e.role = 'runner';
      else if (e.detached) e.role = 'stalk';
      else e.role = 'runblock';
      continue;
    }
    const a = assignFor(play, slot, pers);
    if (!a || a === 'block') { e.role = 'pblock'; continue; }
    const rdef = ROUTES[a];
    const back = e.x0 < S.los - 2;
    const out = back ? backOut(e) : Math.sign(e.y0 - S.ballY) || flip;
    const pts = rdef.pts.map(([f, o]) => ({ x: Math.min(e.x0 + f, 109), y: clamp(e.y0 + o * out, 1.8, S.W - 1.8) }));
    e.role = 'route';
    e.route = { name: a, pts, settle: !!rdef.settle, depth: rdef.depth, delay: rdef.delay || 0, screen: !!rdef.screen };
    e.wp = 0;
    S.design.routes.push({ idx: e.idx, pts: [{ x: e.x0, y: e.y0 }, ...pts], name: a });
  }
  for (const k of ['LG', 'C', 'RG']) O[k].role = play.type === 'run' ? 'runblock' : 'pblock';
  O.QB.role = 'qb';
  if (play.prog) S.design.prog = play.prog.map((p) => O[p]).filter((e) => e.role === 'route').map((e) => e.idx);
  if (play.type === 'run') {
    S.design.aim = { x: S.los + 1, y: clamp(S.ballY + flip * play.aim, 1.5, S.W - 1.5) };
    S.runSide = Math.sign(play.aim) * flip || flip;
    const shotgun = S.form.shotgun;
    const qb = O.QB, rb = S.runner;
    if (play.scheme === 'draw') S.mesh = { x: S.los - 5.2, y: S.ballY + S.runSide * 0.2 };
    else if (shotgun) S.mesh = rb.x < qb.x - 1.5 ? { x: qb.x - 1.0, y: qb.y + S.runSide * 0.4 } : { x: qb.x + 0.7, y: qb.y + S.runSide * 0.5 };
    else S.mesh = { x: S.los - 3.9, y: S.ballY + S.runSide * 0.8 };
    if (play.scheme === 'counter') S.mesh.x -= 0.5;
    // the back must be able to reach the mesh from behind
    if (rb.x > S.mesh.x - 0.5 && play.carrier !== 'QB') S.mesh.x = rb.x + 0.8;
  }
  if (play.screen) for (const k of ['LG', 'C', 'RG']) O[k].screenRelease = 1.1;
}

function assignRunBlocks(S) {
  const { O, play } = S;
  const ps = S.runSide;
  const ofKind = (k) => S.defList.filter((d) => d.kind === k);
  const dls = ofKind('DL').sort((a, b) => (b.y - a.y) * ps); // playside first
  const lbs = ofKind('LB').sort((a, b) => (b.y - a.y) * ps);
  const taken = new Set();
  const give = (b, d) => { if (b && d) { b.assignDef = d; taken.add(d); } };
  const nextLB = () => lbs.find((l) => !taken.has(l)) || ofKind('DB').filter((d) => !taken.has(d)).sort((a, b) => a.x - b.x)[0];
  const oline = [O.LG, O.C, O.RG].sort((a, b) => (b.y - a.y) * ps);
  const extra = [O.FX, O.RB].filter((e) => e.role === 'runblock'); // TE, fullback, lead back

  if (play.scheme === 'power' || play.scheme === 'counter') {
    // backside guard pulls to the playside linebacker; everyone else blocks down
    const puller = oline[oline.length - 1];
    puller.pull = { x: S.los - 1.4, y: S.ballY + ps * 2.2 };
    oline.slice(0, -1).forEach((b, i) => give(b, dls[i]));
    for (const e of extra) give(e, dls.find((d) => !taken.has(d)) || nextLB());
    give(puller, nextLB());
    return;
  }
  if (play.scheme === 'read' && dls.length) {
    // leave the backside end unblocked; the QB reads him
    S.readDef = dls[dls.length - 1];
    taken.add(S.readDef);
  }
  // zone: linemen take the down linemen playside-first, the rest climb to linebackers
  for (const b of oline) give(b, dls.find((d) => !taken.has(d)) || nextLB());
  for (const e of extra) give(e, nextLB());
}

function setupDefense(S) {
  const { O, dcall, los, ballY, flip, W } = S;
  const roles = resolveDefense(dcall, S.defList.map((e) => ({ slot: e.pos, kind: e.kind, r: e.r })),
    { WR: O.WR, FX: O.FX, RB: O.RB });
  for (const e of S.defList) {
    const a = roles[e.pos];
    e.assign = a;
    if (a === 'rush') e.role = 'rush';
    else if (a === 'spy') e.role = 'spy';
    else if (a.man) { e.role = a.dog ? 'dog' : 'man'; e.man = O[a.man]; e.press = !!a.press; }
    else { e.role = 'zone'; e.zone = zoneSpot(a.zone, S); }
  }
  // in-game adjustment: deep help shades toward the hot receiver
  const hot = dcall.bracket && O[dcall.bracket];
  if (hot) for (const e of S.defList) if (e.role === 'zone' && e.zone.deep) e.zone.y = clamp(e.zone.y + clamp(hot.y - e.zone.y, -4, 4), 3, W - 3);
  // alignment
  const dls = S.defList.filter((e) => e.kind === 'DL');
  const dlSpots = dls.length >= 3 ? [0, 2.4, -2.4] : [1.0, -1.5];
  dls.forEach((e, i) => { e.x = los + 1; e.y = ballY + flip * (dlSpots[i] ?? i * 1.2); });
  let rushN = 0;
  for (const e of S.defList) {
    if (e.kind === 'DL') continue;
    if (e.role === 'rush') { e.x = los + 4; e.y = ballY + flip * [1.5, -2.5, 3.5, -4][rushN++ % 4]; }
    else if (e.role === 'spy') { e.x = los + 5; e.y = ballY; }
    else if (e.role === 'man' || e.role === 'dog') {
      const m = e.man;
      const inside = Math.sign(ballY - m.y) || 0;
      if (m.detached) { e.x = los + (e.press ? 1.2 : e.kind === 'DB' ? 6 : 5); e.y = m.y + inside * 0.8; }
      else { e.x = los + 4.5; e.y = m.y * 0.55 + ballY * 0.45; }
    } else {
      const z = e.zone;
      const sided = /[WS]$/.test(z.name);
      if (z.deep && sided) {
        // corners: over the widest receiver on that side
        const sideSign = Math.sign(z.y - W / 2) || 1;
        const wide = [O.WR, O.FX, O.RB].filter((r) => r.detached && Math.sign(r.y - ballY) === sideSign)
          .sort((a, b) => Math.abs(b.y - ballY) - Math.abs(a.y - ballY))[0];
        e.x = los + (z.name.startsWith('prevent') ? 12 : 7);
        e.y = wide ? wide.y + sideSign * 1 : z.y;
      } else if (z.deep) { e.x = Math.min(los + (z.name.startsWith('prevent') ? 20 : 12.5), 108); e.y = z.y; }
      else if (z.name.startsWith('flat')) { e.x = los + 5; e.y = z.y; }
      else { e.x = los + 4.5; e.y = clamp(z.y * 0.6 + ballY * 0.4, 2, W - 2); }
    }
  }
  // set the edge: on each side, someone in the box must align outside the widest
  // attached blocker (TE, wing, fullback offset), or outside runs have a free alley
  for (const side of [1, -1]) {
    const out = (p) => (p.y - ballY) * side;
    const attached = [O.LG, O.C, O.RG, O.WR, O.FX, O.RB].filter((p) => !p.detached && p.x0 > los - 2);
    const edge = Math.max(1.3, ...attached.map(out));
    const boxy = (d) => d.kind !== 'DL' && d.x < los + 7 && !(d.role === 'zone' && d.zone.deep) && !(d.role === 'man' && d.man?.detached);
    if (S.defList.some((d) => boxy(d) && out(d) > edge + 0.5)) continue;
    const cand = S.defList.filter((d) => boxy(d) && out(d) > -1).sort((a, b) => out(b) - out(a))[0];
    if (cand) { cand.y = ballY + side * (edge + 1.6); cand.x = Math.min(cand.x, los + 4); }
  }
  for (const e of S.defList) {
    e.y = clamp(e.y, 1, W - 1);
    e.x0 = e.x; e.y0 = e.y;
    if (e.role === 'zone') S.design.zones.push({ idx: e.idx, x: e.zone.x, y: e.zone.y, r: e.zone.halfW, deep: e.zone.deep });
    if (e.role === 'rush') S.design.rush.push(e.idx);
    e.diagT = 0.25 + (100 - e.r.awr) * 0.007;
    e.react = 0.16 + (100 - e.r.awr) * 0.004;
  }
}

// --------------------------------------------------------------------------
// Main tick
function tick(S) {
  const { O } = S;
  // positional history for delayed reactions (man coverage)
  for (const e of S.ents) { e.hist.push([e.x, e.y]); if (e.hist.length > 12) e.hist.shift(); }

  if (S.ball.state === 'air') updateBallFlight(S);
  if (S.ball.state === 'loose') updateLooseBall(S);
  if (S.result) return;

  // --- offense
  qbLogic(S);
  if (S.result) return;
  for (const e of S.offList) if (e !== O.QB) offenseSkill(S, e);
  if (S.carrier) carrierLogic(S, S.carrier);

  // --- defense
  for (const e of S.defList) defenseLogic(S, e);

  // --- engagements (blocks)
  updatePairs(S);

  // --- integrate
  for (const e of S.ents) {
    if (e.engaged) continue; // pair moves them
    if (e.down) { e.vx *= 0.5; e.vy *= 0.5; }
    e.x += e.vx * DT; e.y += e.vy * DT;
  }
  separate(S);
  syncBall(S);

  // --- contact
  if (S.carrier) checkCarrier(S);
  else if (S.ball.state === 'held' && S.ball.holder === O.QB) checkSack(S);
}

// soft body separation so tokens don't stack
function separate(S) {
  const ents = S.ents;
  for (let i = 0; i < ents.length; i++) {
    for (let j = i + 1; j < ents.length; j++) {
      const a = ents[i], b = ents[j];
      if (a.engaged && a.engaged === b.engaged) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = hyp(dx, dy);
      const min = 0.7;
      if (d > 1e-4 && d < min) {
        const push = (min - d) / 2;
        const ma = a.mass, mb = b.mass;
        const ka = mb / (ma + mb), kb = ma / (ma + mb);
        a.x -= (dx / d) * push * ka * 2; a.y -= (dy / d) * push * ka * 2;
        b.x += (dx / d) * push * kb * 2; b.y += (dy / d) * push * kb * 2;
      }
    }
  }
}

function syncBall(S) {
  const b = S.ball;
  if (b.state === 'held' && b.holder) { b.x = b.holder.x; b.y = b.holder.y; b.z = 1; }
}

function setCarrier(S, e) {
  if (S.carrier) S.carrier.hasBall = false;
  for (const x of S.ents) x.hasBall = false;
  S.carrier = e;
  e.hasBall = true;
  e.role = 'carrier';
  if (e.engaged) breakPair(S, e.engaged);
  S.ball.state = 'held';
  S.ball.holder = e;
  e.heading = null;
  e.carryStart = { x: e.x, t: S.t };
}

function event(S, text, kind = 'info') { S.events.push({ t: S.t, text, kind }); }

// Contact between two opponents: Ice slows the other player, Poison drains their energy.
function contact(S, a, b) {
  for (const [x, y] of [[a, b], [b, a]]) {
    if (x.mods.chill) y.slowUntil = Math.max(y.slowUntil, S.t + x.mods.chill);
    if (x.mods.toxic) S.toxic[y.pl.id] = (S.toxic[y.pl.id] || 0) + x.mods.toxic;
  }
}
const nearMates = (S, e, r = 2.5) => S.ents.filter((o) => o !== e && o.side === e.side && dist(o, e) < r).length;

// --------------------------------------------------------------------------
// QB
function qbLogic(S) {
  const { O, play, t } = S;
  const qb = O.QB;
  const st = S.qb;
  if (S.carrier === qb || qb.role === 'carrier' || S.ball.holder !== qb || S.ball.state !== 'held') {
    if (S.handed && S.carrier !== qb && !S.thrown) {
      // carry out the fake
      steer(qb, qb.x - 1, qb.y - S.flip * 2.5, 0.5, S);
    } else if (S.thrown || S.carrier) {
      if (S.carrier && S.carrier !== qb) pursueAsBlocker(S, qb);
      else if (!S.carrier) steer(qb, qb.x, qb.y, 0.3, S);
    }
    return;
  }

  if (play.type === 'run') return qbRunPlay(S, qb);

  // ---- pass play
  const dd = { quick: 1, std: 2, deep: 3 }[play.drop] || 2;
  const shotgun = S.form.shotgun;
  if (!st.drop) {
    st.drop = shotgun ? { x: S.los - 5 - dd, y: S.ballY } : { x: S.los - 1 - [0, 3, 5, 7][dd], y: S.ballY };
    if (play.boot) st.boot = { x: S.los - 6, y: clamp(S.ballY - S.flip * 9, 3, S.W - 3) };
    st.fakeUntil = play.pa ? 0.65 : 0;
  }
  if (st.state === 'drop') {
    if (t < st.fakeUntil) {
      steer(qb, S.O.RB.x + 0.5, (qb.y + S.O.RB.y) / 2, 0.55, S);
      if (!S.paFaked && t > 0.3) { S.paFaked = true; }
    } else if (st.boot) {
      steer(qb, st.boot.x, st.boot.y, 0.9, S);
      if (t > st.fakeUntil + 0.5) { st.state = 'set'; st.tSet = t; st.onRun = true; }
    } else {
      steer(qb, st.drop.x, st.drop.y, 0.75, S);
      const minSet = ({ quick: 0.7, std: 1.1, deep: 1.5 }[play.drop] || 1.1) - (shotgun ? 0.1 : 0);
      if (dist(qb, st.drop) < 0.6 && t >= minSet) { st.state = 'set'; st.tSet = t; }
    }
    if (st.state !== 'set') return;
  }

  // ---- set: pocket movement
  const rushers = freeRushers(S);
  let px = 0, py = 0, nearest = Infinity, nearestR = null;
  for (const r of rushers) {
    const d = dist(r, qb);
    if (d < nearest) { nearest = d; nearestR = r; }
    if (d < 5) { px += (qb.x - r.x) / (d * d); py += (qb.y - r.y) / (d * d); }
  }
  // does the QB feel it? (blind-side / late pressure isn't always noticed)
  if (nearest < 3 && !st.felt && S.rng.chance((0.05 + qb.r.awr * 0.0012) * (nearestR && nearestR.x < qb.x + 0.5 ? 0.5 : 1))) st.felt = true;
  if (nearest >= 3.5) st.felt = false;
  const pressured = nearest < 2.6 && st.felt;
  if (st.boot) {
    steer(qb, st.boot.x + 0.5, clamp(st.boot.y - S.flip * 2, 1.5, S.W - 1.5), 0.6, S);
  } else {
    const pm = hyp(px, py);
    const pres = qb.r.awr / 100;
    let tx = st.drop.x + 0.6, ty = st.drop.y; // step up
    if (pm > 0.05) { tx = qb.x + (px / pm) * 2 * pres; ty = qb.y + (py / pm) * 2.5 * pres; }
    steer(qb, clamp(tx, S.los - 12, S.los - 1.5), clamp(ty, 1.5, S.W - 1.5), 0.5, S);
  }
  S.pressure = nearest;

  if (st.windup) {
    if (t >= st.windup.at) { const w = st.windup; st.windup = null; releaseThrow(S, w.rec, w.opts); }
    return;
  }
  if (t - st.lastEval < 0.1) return;
  st.lastEval = t;

  const since = t - st.tSet;
  const readTime = clamp(0.74 - (qb.r.awr - 60) * 0.006, 0.52, 0.92);
  const prog = play.prog.map((p) => O[p]).filter((e) => e.role === 'route');
  const aggression = S.situation.aggression ?? 0.5;

  // ---- special: hail mary / screen
  if (play.special === 'hail') {
    if (since > 1.4 || (pressured && since > 0.8)) {
      const tgt = prog.slice().sort((a, b) => b.x - a.x)[0];
      return throwTo(S, tgt, { hail: true });
    }
    return;
  }
  if (play.screen) {
    const rb = O.RB;
    if (t > 1.35 || (pressured && t > 0.9)) return throwTo(S, rb, {});
    return;
  }

  // current read (advance faster when the read is blanketed)
  let idx = Math.floor(since / readTime);
  const scanning = idx >= prog.length;
  idx = Math.min(idx, prog.length - 1);
  st.readIdx = idx;
  S.currentRead = prog[idx] ? prog[idx].idx : -1;

  // motion before the snap tipped the coverage: a cleaner read
  const noise = (100 - qb.r.awr) * 0.02 * (S.coverageTipped === 'man' ? 0.55 : S.coverageTipped === 'zone' ? 0.75 : 1);
  const perceive = (rec) => {
    let op = openness(S, rec, qb) + S.rng.gauss(0, noise);
    let nd = null, nds = Infinity;
    for (const d of S.defList) { const dd = dist(d, rec); if (dd < nds) { nds = dd; nd = d; } }
    if (nd && nd.mods.misread && nds < 6) op += nd.mods.misread * 14; // looks open, isn't
    return op;
  };
  let thrBase = 2.75 - since * 0.4 - aggression * 0.45 - (pressured ? (nearest < 1.7 ? 0.8 : 0.4) : 0);
  if (S.situation.desperate) thrBase -= 0.8;

  const candidates = scanning ? prog : [prog[idx]];
  // hot read vs blitz
  if (pressured && since < 1.2 && rushers.length > 2) {
    const hot = prog.slice().sort((a, b) => (a.route.depth === 'short' ? 0 : 1) - (b.route.depth === 'short' ? 0 : 1))[0];
    if (hot && !candidates.includes(hot)) candidates.push(hot);
  }
  let best = null, bestOp = -Infinity;
  for (const rec of candidates) {
    if (!rec || rec.route.delay > t) continue;
    // timing: don't throw a route until the receiver reaches his break
    const R = rec.route;
    const readyWp = R.settle ? Math.max(0, R.pts.length - 1) : Math.min(1, R.pts.length - 1);
    if (rec.wp < readyWp && !(pressured && since > 0.5)) continue;
    const op = perceive(rec);
    const depthAdj = rec.route.depth === 'deep' ? 0.35 - (S.situation.deepBias || 0) * 0.6 : rec.route.depth === 'medium' ? 0.1 : 0;
    let score = op - depthAdj;
    // 3rd/4th down: a completion short of the sticks is worth much less
    const sit = S.situation;
    if (sit.down >= 3 && sit.toGo > 1 && since < 2.6) {
      const P = pathAhead(rec, 1.5);
      const short = S.los + sit.toGo - Math.max(rec.x, P.x);
      if (short > 0.5) score -= Math.min(0.9, 0.3 + short * 0.08);
    }
    if (score > bestOp) { bestOp = score; best = rec; }
  }
  if (best && bestOp >= thrBase && bestOp > -0.6) return throwTo(S, best, { pressured });

  // ---- nothing open: scramble / throw away / hold
  const lane = scrambleLane(S, qb);
  const mobile = qb.r.spd;
  if (pressured && nearest < 2.0) {
    if (lane && mobile > 55 && S.rng.chance(0.25 + mobile * 0.004)) return startScramble(S, qb);
    const outside = Math.abs(qb.y - S.ballY) > 3.5 || st.onRun;
    if ((outside || S.rng.chance(qb.r.awr * 0.004)) && since > 1.2 && S.rng.chance(0.35)) return throwAway(S, qb);
    // last-gasp: throw to anyone
    if (best && bestOp > -1.4 && S.rng.chance(0.3)) return throwTo(S, best, { pressured: true });
  }
  if (since > 2.3 + qb.r.awr * 0.004) {
    if (lane && mobile > 68 && S.rng.chance(0.25)) return startScramble(S, qb);
    if (since > 3.6 && S.rng.chance(0.25)) {
      if (best && bestOp > -0.8) return throwTo(S, best, {});
      return throwAway(S, qb);
    }
  }
}

function qbRunPlay(S, qb) {
  const { play, t, O, flip } = S;
  const rb = S.runner;
  if (S.handed) return;
  if (play.scheme === 'toss') {
    steer(qb, qb.x - 0.5, qb.y, 0.4, S);
    if (t >= 0.25) {
      // pitch
      S.handed = true; S.handTime = t;
      S.ball.state = 'air';
      const T = 0.35;
      const tx = rb.x + rb.vx * T, ty = rb.y + rb.vy * T;
      S.ball.flight = { fx: qb.x, fy: qb.y, tx, ty, t0: t, T, target: rb, peak: 0.6, pitch: true };
      qb.hasBall = false;
    }
    return;
  }
  const mesh = S.mesh;
  // QB presents the ball just beside the mesh point
  steer(qb, mesh.x - 0.3, mesh.y - S.runSide * 0.7, play.scheme === 'draw' ? 0.6 : 0.8, S);
  const minT = play.scheme === 'draw' ? 0.75 : 0.3;
  if ((dist(rb, mesh) < 1.0 && t > minT) || t > minT + 1.1) {
    if (play.scheme === 'read' && S.readDef) {
      const rd = S.readDef;
      const crashing = dist(rd, rb) < 3.2 && (rd.vx * 0 + (rb.y - rd.y) * rd.vy) > 0;
      const keep = crashing && S.rng.chance(0.55 + qb.r.awr * 0.004);
      if (keep) {
        S.handed = true; S.handTime = t; S.qbKeep = true;
        setCarrier(S, qb);
        qb.runAim = { x: S.los + 2, y: clamp(S.ballY - flip * 7, 2, S.W - 2) };
        event(S, `${qb.pl.name} keeps it!`);
        rb.role = 'runblock';
        return;
      }
    }
    S.handed = true; S.handTime = t;
    setCarrier(S, rb);
    // draw: pass sets turn into run blocks once the ball is handed off
    for (const p of S.pairs) if (p.kind === 'pass') { p.kind = 'run'; p.diff -= 4; }
  }
}

function freeRushers(S) {
  return S.ents.filter((e) => e.side === 'D' && (e.role === 'rush' || e.role === 'dogRush') && !e.engaged && S.t >= e.stunUntil);
}

function scrambleLane(S, qb) {
  for (const d of S.ents) {
    if (d.side !== 'D' || d.engaged) continue;
    const dx = d.x - qb.x, dy = d.y - qb.y;
    if (dx > -0.5 && dx < 5 && Math.abs(dy) < 1.5 + dx * 0.45) return false;
  }
  return true;
}

function startScramble(S, qb) {
  S.scramble = true;
  setCarrier(S, qb);
  event(S, `${qb.pl.name} scrambles!`);
  for (const e of S.ents) if (e.side === 'D' && (e.role === 'man' || e.role === 'zone' || e.role === 'spy')) e.scrambleReact = S.t + e.react + 0.2;
}

// --------------------------------------------------------------------------
// Passing
function ballSpeed(qb, d) {
  let v = 15 + qb.r.arm * 0.11;
  if (d > 22) v *= 0.84; // touch / arc on deep balls
  return v;
}

function pathAhead(rec, dist0) {
  // project the receiver along the rest of his route
  if (rec.role !== 'route' || !rec.route) return { x: rec.x + rec.vx * 0.3, y: rec.y + rec.vy * 0.3 };
  let x = rec.x, y = rec.y, left = dist0;
  const pts = rec.route.pts;
  for (let i = rec.wp; i < pts.length; i++) {
    const seg = hyp(pts[i].x - x, pts[i].y - y);
    if (seg >= left) return { x: x + ((pts[i].x - x) / seg) * left, y: y + ((pts[i].y - y) / seg) * left };
    left -= seg; x = pts[i].x; y = pts[i].y;
  }
  if (rec.route.settle) return { x, y };
  // continue along the final segment
  const a = pts[pts.length - 2] || { x: rec.x0, y: rec.y0 }, b = pts[pts.length - 1];
  const sl = hyp(b.x - a.x, b.y - a.y) || 1;
  return { x: x + ((b.x - a.x) / sl) * left, y: y + ((b.y - a.y) / sl) * left };
}

function travel(rec, T) {
  const v0 = hyp(rec.vx, rec.vy), vm = rec.maxSpd * 0.95, a = rec.accel;
  const tA = Math.max(0, (vm - v0) / a);
  if (T <= tA) return v0 * T + 0.5 * a * T * T;
  return v0 * tA + 0.5 * a * tA * tA + vm * (T - tA);
}

function leadPoint(S, qb, rec) {
  let P = { x: rec.x, y: rec.y }, T = 0;
  for (let i = 0; i < 3; i++) {
    const d = dist(qb, P);
    T = d / ballSpeed(qb, d) + 0.05;
    P = pathAhead(rec, travel(rec, T) * 0.96);
  }
  P.x = Math.min(P.x, 109.3);
  P.y = clamp(P.y, 1.3, S.W - 1.3);
  return { P, T };
}

function openness(S, rec, qb) {
  const { P, T } = leadPoint(S, qb, rec);
  let sep = 8;
  const segx = P.x - qb.x, segy = P.y - qb.y, segL2 = segx * segx + segy * segy;
  for (const d of S.ents) {
    if (d.side !== 'D') continue;
    if (d.role === 'rush' && !(S.t > 1.5 && dist(d, qb) > 4)) continue;
    const reach = d.maxSpd * Math.max(0, T - d.react) * 0.8;
    sep = Math.min(sep, dist(d, P) - reach - 0.4);
    // throwing lane
    const u = clamp(((d.x - qb.x) * segx + (d.y - qb.y) * segy) / segL2, 0, 1);
    if (u > 0.12 && u < 0.85) {
      const lx = qb.x + segx * u, ly = qb.y + segy * u;
      const lane = hyp(d.x - lx, d.y - ly);
      const arc = Math.sqrt(segL2) > 18 && u > 0.2 && u < 0.7; // deep balls go over
      if (!arc && lane < 1.6) sep = Math.min(sep, lane - 1.2);
    }
  }
  if (P.x > 109.5) sep -= 4;
  return sep;
}

// Deciding to throw starts the throwing motion; the ball comes out after a short windup.
function throwTo(S, rec, opts = {}) {
  const qb = S.O.QB;
  if (S.qb.windup) return;
  const w = 0.16 + (100 - qb.r.arm) * 0.0022 + (opts.pressured ? 0.04 : 0);
  S.qb.windup = { rec, opts, at: S.t + w };
}

function releaseThrow(S, rec, { hail = false, pressured = false } = {}) {
  const qb = S.O.QB;
  let { P, T } = leadPoint(S, qb, rec);
  if (hail) P = { x: Math.min(Math.max(rec.x, S.los + 38), 107), y: clamp(rec.y, 6, S.W - 6) };
  const d = dist(qb, P);
  T = d / ballSpeed(qb, d);
  // placement: away from the nearest defender
  let nd = null, nds = Infinity;
  for (const e of S.ents) if (e.side === 'D') { const dd = dist(e, P); if (dd < nds) { nds = dd; nd = e; } }
  if (nd && nds < 3) {
    const k = (qb.r.acc / 100) * 0.45;
    P.x += ((P.x - nd.x) / (nds || 1)) * k;
    P.y += ((P.y - nd.y) / (nds || 1)) * k;
  }
  // inaccuracy
  let sigma = 0.1 + (100 - qb.r.acc) * 0.01 + d * 0.01;
  if (pressured) sigma *= 1.45;
  // hit as he throws
  const inFace = S.ents.some((d) => d.side === 'D' && !d.engaged && dist(d, qb) < 1.4);
  if (inFace) { sigma *= 1.8; if (!pressured) pressured = true; }
  if (S.qb.onRun || S.scramble) sigma *= 1.25;
  const ux = (P.x - qb.x) / (d || 1), uy = (P.y - qb.y) / (d || 1);
  const along = S.rng.gauss(0, sigma * 1.1), lat = S.rng.gauss(0, sigma);
  P.x += ux * along - uy * lat;
  P.y += uy * along + ux * lat;

  S.thrown = true;
  S.ball.state = 'air';
  S.ball.flight = { fx: qb.x, fy: qb.y, tx: P.x, ty: P.y, t0: S.t, T, target: rec, peak: clamp(d * 0.13, 0.8, 9), hail };
  qb.hasBall = false;
  S.passInfo = { target: rec, airYards: P.x - S.los, throwX: qb.x, throwY: qb.y, pressured, T, t: S.t, pressure: S.pressure };
  S.currentRead = rec.idx;
  // receivers & defenders react
  rec.role = 'target';
  for (const e of S.ents) if (e.side === 'D') e.ballReact = S.t + e.react + (e.role === 'man' ? 0.08 : 0) + (rec.mods.misread || 0);
  // batted at the line
  for (const e of S.ents) {
    if (e.side === 'D' && dist(e, qb) < 1.6 && S.rng.chance(0.06 + e.height * 0.02)) {
      S.ball.flight.batted = e;
      break;
    }
  }
}

function throwAway(S, qb) {
  const side = qb.y < S.W / 2 ? -1 : 1;
  S.thrown = true;
  S.throwAway = true;
  S.ball.state = 'air';
  const tx = qb.x + 8, ty = side < 0 ? -3 : S.W + 3;
  const d = hyp(tx - qb.x, ty - qb.y);
  S.ball.flight = { fx: qb.x, fy: qb.y, tx, ty, t0: S.t, T: d / ballSpeed(qb, d), target: null, peak: 2 };
  qb.hasBall = false;
  S.passInfo = { target: null, airYards: 0, throwAway: true };
  event(S, `${qb.pl.name} throws it away.`);
}

function updateBallFlight(S) {
  const b = S.ball, f = b.flight;
  const s = clamp((S.t - f.t0) / f.T, 0, 1);
  b.x = f.fx + (f.tx - f.fx) * s;
  b.y = f.fy + (f.ty - f.fy) * s;
  b.z = 1.6 + f.peak * 4 * s * (1 - s);

  if (f.pitch) {
    if (s >= 1) { setCarrier(S, f.target); }
    return;
  }
  if (f.batted && s > 0.08) {
    event(S, `Batted at the line by ${f.batted.pl.name}!`, 'big');
    credit(S, f.batted, 'pd', 1);
    return endPlay(S, { type: 'incomplete', batted: true });
  }
  // tipped/picked in the lane
  if (s > 0.1 && s < 0.9 && !f.hail) {
    for (const d of S.ents) {
      if (d.side !== 'D' || d.tipTried) continue;
      if (hyp(d.x - b.x, d.y - b.y) < 0.85 + (d.mods.reach || 0) && b.z < 2.2 + d.height * 0.4 + (d.mods.reach || 0)) {
        d.tipTried = true;
        if (S.rng.chance(0.55)) {
          if (S.rng.chance(0.2 + d.r.ball * 0.003)) return intercept(S, d, 'undercuts the route and picks it off');
          event(S, `Tipped by ${d.pl.name}!`);
          credit(S, d, 'pd', 1);
          return endPlay(S, { type: 'incomplete' });
        }
      }
    }
  }
  if (s >= 1) resolveCatch(S);
}

function resolveCatch(S) {
  const b = S.ball, f = b.flight;
  const L = { x: f.tx, y: f.ty };
  if (!f.target) return endPlay(S, { type: 'incomplete', throwAway: true });
  const rec = f.target;
  const oob = L.y < 0 || L.y > S.W || L.x > 110;
  const dr = dist(rec, L);
  const Rc = 1.35 + clamp(rec.height - 1, -0.5, 1.5) * 0.22 + (rec.mods.reach || 0);
  let bestD = null, dd = Infinity;
  for (const e of S.ents) {
    if (e.side !== 'D') continue;
    const d = dist(e, L);
    if (d < dd) { dd = d; bestD = e; }
  }
  const Rd = 1.0 + clamp((bestD?.height || 1) - 1, -0.5, 1.5) * 0.2 + (bestD?.mods.reach || 0);
  const recIn = dr <= Rc, defIn = dd <= Rd;

  if (oob) {
    if (recIn && Math.min(Math.abs(L.y), Math.abs(L.y - S.W)) < 0.6 && L.x <= 110 && S.rng.chance(0.35 + rec.r.awr * 0.003)) {
      // toe-tap
      rec.y = clamp(rec.y, 0.2, S.W - 0.2);
      event(S, `${rec.pl.name} tiptoes the sideline!`, 'big');
      catchMade(S, rec, true);
      return;
    }
    return endPlay(S, { type: 'incomplete', oob: true });
  }
  if (recIn && defIn) {
    const hand = rec.r.hands * 0.7 + rec.r.str * 0.3, cov = bestD.r.cover * 0.4 + bestD.r.ball * 0.3 + bestD.r.press * 0.3;
    const edge = (dd - dr) * 0.35;
    const pCatch = clamp(0.5 + (hand - cov) * 0.007 + edge + (rec.height - bestD.height) * 0.08, 0.15, 0.85);
    const pInt = clamp(0.1 + (bestD.r.ball - 60) * 0.003 - edge * 0.3, 0.02, 0.3);
    const roll = S.rng.next();
    if (dd < dr - 0.4 && S.rng.chance(0.07 * (1 - (bestD.mods.discipline || 0)))) return endPlay(S, { type: 'dpi', defender: bestD, spot: L.x });
    if (roll < pCatch) { event(S, `${rec.pl.name} makes a contested catch!`, 'big'); return catchMade(S, rec, false, bestD); }
    if (roll < pCatch + pInt) return intercept(S, bestD, 'jumps the route');
    credit(S, bestD, 'pd', 1);
    event(S, `Broken up by ${bestD.pl.name}.`);
    return endPlay(S, { type: 'incomplete', pbu: bestD });
  }
  if (recIn) {
    const stretch = dr / Rc;
    const pCatch = clamp(0.84 + rec.r.hands * 0.0013 - stretch * 0.1, 0.6, 0.985);
    if (S.rng.chance(pCatch)) return catchMade(S, rec, false);
    event(S, `Dropped by ${rec.pl.name}!`);
    return endPlay(S, { type: 'incomplete', drop: true });
  }
  if (defIn) {
    if (S.rng.chance(0.18 + bestD.r.ball * 0.004)) return intercept(S, bestD, 'reads it all the way');
    credit(S, bestD, 'pd', 1);
    return endPlay(S, { type: 'incomplete', pbu: bestD });
  }
  return endPlay(S, { type: 'incomplete', miss: L.x > rec.x ? 'overthrown' : 'underthrown' });
}

function catchMade(S, rec, oobCatch, contestedBy) {
  S.completion = { rec, x: rec.x };
  // the ball comes to his hands (he's within reach); don't move him to it
  rec.y = clamp(rec.y, 0.1, S.W - 0.1);
  setCarrier(S, rec);
  if (oobCatch) return endPlay(S, { type: 'dead', oob: true });
  if (rec.x >= 100) return endPlay(S, { type: 'td' });
  if (contestedBy) { contestedBy.lastTackleTry = S.t - 0.3; }
  // gather after the catch: turn upfield before accelerating
  rec.slowUntil = S.t + 0.4;
  rec.vx *= 0.5; rec.vy *= 0.5;
}

// The ball comes to the defender's hands (he's within reach of it); he isn't moved to it.
function intercept(S, d, how) {
  d.x = clamp(d.x, -9.5, 109.5); d.y = clamp(d.y, 0.2, S.W - 0.2);
  S.interception = { by: d, x: d.x };
  event(S, `INTERCEPTED! ${d.pl.name} ${how}!`, 'big');
  setCarrier(S, d);
  for (const e of S.ents) if (e.side === 'O') { e.role = 'pursue'; e.react = 0.3; }
  if (d.x >= 100 && S.rng.chance(0.75)) {
    event(S, `${d.pl.name} takes a knee in the end zone.`);
    return endPlay(S, { type: 'dead', touchback: true });
  }
}

// --------------------------------------------------------------------------
// Offensive skill players / linemen
function offenseSkill(S, e) {
  const { t } = S;
  if (e === S.carrier || e.engaged) return;
  if (S.interception) { pursueCarrier(S, e); return; }
  if (S.ball.state === 'loose') return chaseLoose(S, e);

  switch (e.role) {
    case 'route': return runRoute(S, e);
    case 'target': {
      const f = S.ball.flight;
      if (f && S.ball.state === 'air') {
        // pace the route to arrive with the ball
        const left = Math.max(0.05, f.t0 + f.T - S.t);
        const need = dist(e, { x: f.tx, y: f.ty }) / left;
        steer(e, f.tx, f.ty, clamp(need / e.maxSpd, 0.25, 1), S);
      }
      return;
    }
    case 'pblock': return passBlock(S, e);
    case 'runblock': case 'stalk': return runBlock(S, e);
    case 'runner': return rbPreHandoff(S, e);
    default:
      if (S.carrier) return pursueAsBlocker(S, e);
      steer(e, e.x, e.y, 0.2, S);
  }
}

function runRoute(S, e) {
  const { t } = S;
  if (S.thrown || S.carrier) { if (S.carrier) pursueAsBlocker(S, e); else steer(e, e.x + 1, e.y, 0.5, S); return; }
  const R = e.route;
  if (t < R.delay) {
    // check-release: stay in and block if a free rusher is coming
    return passBlock(S, e, true);
  }
  if (e.jamUntil && t < e.jamUntil) { steer(e, e.x, e.y, 0.1, S); return; }
  if (R.screen && S.O.QB.hasBall) {
    // screen: sneak out and wait
    const p = R.pts[Math.min(e.wp, R.pts.length - 1)];
    steer(e, p.x, p.y, t < 0.7 ? 0.5 : 0.8, S);
    if (dist(e, p) < 0.6 && e.wp < R.pts.length - 1) e.wp++;
    return;
  }
  if (e.wp < R.pts.length) {
    const p = R.pts[e.wp];
    steer(e, p.x, p.y, 1, S);
    if (dist(e, p) < 0.7) {
      const prev = e.wp > 0 ? R.pts[e.wp - 1] : { x: e.x0, y: e.y0 };
      const next = R.pts[e.wp + 1];
      e.wp++;
      if (next) {
        const a1 = Math.atan2(p.y - prev.y, p.x - prev.x), a2 = Math.atan2(next.y - p.y, next.x - p.x);
        let da = Math.abs(a2 - a1); if (da > Math.PI) da = 2 * Math.PI - da;
        if (da > 0.7) { let k = 0.45 + e.r.route * 0.004 + e.r.agi * 0.001; k += (1 - k) * (e.mods.flow || 0); e.vx *= k; e.vy *= k; }
      }
    }
    return;
  }
  const last = R.pts[R.pts.length - 1];
  if (R.settle) {
    // sit in the hole, drift away from the nearest defender
    let nd = null, nds = Infinity;
    for (const d of S.ents) if (d.side === 'D') { const dd = dist(d, e); if (dd < nds) { nds = dd; nd = d; } }
    let tx = last.x, ty = last.y;
    if (nd && nds < 4) { ty = last.y + clamp((e.y - nd.y), -2, 2); tx = last.x - (nd.x > e.x ? 0.5 : -0.5); }
    steer(e, tx, clamp(ty, 0.8, S.W - 0.8), 0.45, S);
  } else {
    const prev = R.pts[R.pts.length - 2] || { x: e.x0, y: e.y0 };
    let dx = last.x - prev.x, dy = last.y - prev.y;
    const dl = hyp(dx, dy) || 1;
    let tx = e.x + (dx / dl) * 5, ty = e.y + (dy / dl) * 5;
    if (ty < 1 || ty > S.W - 1) { ty = clamp(ty, 1, S.W - 1); tx = e.x + 5; }
    if (tx > 108.5) tx = 108.5;
    steer(e, tx, ty, 1, S);
  }
}

function passBlock(S, e, check = false) {
  const qb = S.O.QB;
  if (e.screenRelease && S.t > e.screenRelease) {
    // screen: release to lead block
    if (S.carrier) return pursueAsBlocker(S, e);
    const rb = S.O.RB;
    return steer(e, rb.x + 3, (rb.y + e.y) / 2, 0.8, S);
  }
  if (S.carrier && S.carrier !== qb) return pursueAsBlocker(S, e);
  if (S.thrown) { steer(e, e.x + 0.5, e.y, 0.3, S); return; }
  if (S.t < e.stunUntil) return;
  const rushers = freeRushers(S);
  // keep my assignment while it's still a live, unblocked rusher (sticky protection)
  let best = e.ppTarget;
  const valid = (r) => r && rushers.includes(r) && !(r.noEngageFrom === e && S.t < r.noEngageUntil);
  if (!valid(best)) {
    best = null;
    let bs = Infinity;
    const takenBy = new Set(S.ents.filter((b) => b !== e && b.side === 'O' && b.ppTarget && !b.engaged).map((b) => b.ppTarget));
    for (const r of rushers) {
      if (!valid(r)) continue;
      // lane-based: prefer the rusher in my lateral lane; don't double someone already picked up
      const sc = Math.abs(r.y - e.y) * 1.4 + dist(e, r) + dist(r, qb) * 0.4 + (takenBy.has(r) ? 6 : 0);
      if (sc < bs) { bs = sc; best = r; }
    }
    e.ppTarget = best;
  }
  if (check && (!best || dist(best, qb) > 7)) return; // release after delay
  if (!best) {
    const tx = Math.max(qb.x + 2.2, S.los - 2.5);
    steer(e, e.kind === 'OL' ? Math.min(tx, S.los - 0.5) : e.x, e.y, 0.3, S);
    return;
  }
  best.claimedBy = e; best.claimedT = S.t;
  const dq = dist(best, qb) || 1;
  // meet him where he's going, between him and the QB
  const px = best.x + best.vx * 0.3 + ((qb.x - best.x) / dq) * 0.9, py = best.y + best.vy * 0.3 + ((qb.y - best.y) / dq) * 0.9;
  steer(e, Math.min(px, S.los - 0.3), py, 1, S);
  if (dist(e, best) < 1.35 && S.t > 0.05) engage(S, e, best, 'pass');
}

function rbPreHandoff(S, e) {
  const { play, flip, t, O } = S;
  if (S.handed) { if (!S.carrier || S.carrier !== e) pursueAsBlocker(S, e); return; }
  const qb = O.QB;
  if (play.scheme === 'toss') { steer(e, S.los - 3.5, clamp(S.ballY + flip * 6, 1, S.W - 1), 1, S); return; }
  if (play.scheme === 'counter' && t < 0.2) { steer(e, e.x0 + 0.8, e.y0 - S.runSide * 1.2, 0.9, S); return; }
  if (play.scheme === 'draw' && t < 0.4) { steer(e, e.x0, e.y0, 0.3, S); return; }
  // run through the mesh point, then press toward the aim point
  const m = S.mesh, aim = S.design.aim;
  const dm = dist(e, m);
  const past = (e.x - m.x) > -0.2 && dm < 1.4;
  const tx = past ? aim.x : m.x + (aim.x - m.x) * 0.15, ty = past ? aim.y : m.y + (aim.y - m.y) * 0.15;
  steer(e, tx, ty, play.scheme === 'read' ? 0.8 : 1, S);
}

function runBlock(S, e) {
  const { t } = S;
  if (S.thrown || (S.carrier && S.carrier.side === 'D')) return pursueAsBlocker(S, e);
  if (S.t < e.stunUntil) return;
  if (e.role === 'stalk') {
    // stalk the nearest DB
    let tgt = e.assignDef;
    if (!tgt) {
      let bs = Infinity;
      for (const d of S.ents) if (d.side === 'D' && d.kind === 'DB' && !d.stalked) { const dd = dist(e, d); if (dd < bs) { bs = dd; tgt = d; } }
      if (tgt) { tgt.stalked = e; e.assignDef = tgt; }
    }
    if (!tgt) return steer(e, e.x + 2, e.y, 0.5, S);
    const cushion = t < 1 ? 2 : 0.8;
    steer(e, tgt.x - cushion, tgt.y, 0.8, S);
    if (dist(e, tgt) < 1.1 && !tgt.engaged && S.t >= tgt.noEngageUntil) engage(S, e, tgt, 'stalk');
    return;
  }
  if (S.play.scheme === 'draw' && t < 0.8) return passBlock(S, e);
  if (e.pull && t < 0.7) { steer(e, e.pull.x, e.pull.y, 1, S); return; }
  let d = e.assignDef;
  if (!d || d.engaged || S.t < d.noEngageUntil || dist(e, d) > 7) {
    // find the nearest unblocked defender in front of me
    d = null; let bs = Infinity;
    for (const x of S.ents) {
      if (x.side !== 'D' || x.engaged || S.t < x.noEngageUntil) continue;
      if (x === S.readDef && !S.qbKeep && !S.handed) continue;
      const sc = dist(e, x) + Math.max(0, e.x - x.x) * 2;
      if (sc < bs) { bs = sc; d = x; }
    }
    if (!d || bs > 8) {
      // lead up the field
      const c = S.carrier || S.runner;
      return steer(e, c.x + 3, c.y, 0.8, S);
    }
    e.assignDef = d;
  }
  // get between the defender and the ball (the mesh before the handoff)
  const c = S.carrier || (S.ball.state === 'held' && S.ball.holder !== S.O.C ? S.ball.holder : null) || S.mesh || S.design.aim;
  const dc = hyp(c.x - d.x, c.y - d.y) || 1;
  const tx = d.x + d.vx * 0.3 + ((c.x - d.x) / dc) * 0.8, ty = d.y + d.vy * 0.3 + ((c.y - d.y) / dc) * 0.8;
  steer(e, tx, ty, 1, S);
  if (dist(e, d) < 1.35) engage(S, e, d, 'run');
}

// teammates of the ball carrier: escort / lead-block
function pursueAsBlocker(S, e) {
  if (S.t < e.stunUntil) return;
  const c = S.carrier;
  if (!c) return steer(e, e.x, e.y, 0.2, S);
  if (c.side !== e.side) return pursueCarrier(S, e);
  let best = null, bs = Infinity;
  for (const d of S.ents) {
    if (d.side === e.side || d.engaged || S.t < d.noEngageUntil || S.t < d.stunUntil) continue;
    const dc = dist(d, c);
    if (dc > 9) continue;
    const sc = dist(e, d) + dc * 0.5;
    if (sc < bs) { bs = sc; best = d; }
  }
  if (!best || bs > 9) {
    const g = c.side === 'O' ? 1 : -1;
    return steer(e, c.x + g * 4, c.y + (e.y > c.y ? 2 : -2), 0.8, S);
  }
  const dc = dist(best, c) || 1;
  steer(e, best.x + ((c.x - best.x) / dc) * 0.8, best.y + ((c.y - best.y) / dc) * 0.8, 1, S);
  if (dist(e, best) < 1.0 && !e.engaged) engage(S, e, best, 'stalk');
}

// --------------------------------------------------------------------------
// Defense
function defenseLogic(S, e) {
  const { t, O } = S;
  if (e.engaged || e === S.carrier) return;
  if (e.down) return;
  if (S.ball.state === 'loose') return chaseLoose(S, e);

  // ball in the air: break on it
  if (S.ball.state === 'air' && S.ball.flight.target && !S.ball.flight.pitch) {
    const f = S.ball.flight;
    if (t < e.ballReact) return coverageLogic(S, e);
    const T = f.t0 + f.T - t;
    const dL = hyp(f.tx - e.x, f.ty - e.y);
    if (dL < e.maxSpd * (T + 0.25) + 1) return steer(e, f.tx, f.ty, 1, S);
    // can't get there: pursue the catch point to make the tackle
    return steer(e, f.tx, f.ty, 0.9, S);
  }

  if (S.carrier && S.carrier.side === 'D') return escortReturn(S, e);

  // linebackers & safeties read their keys before committing
  const deepDB = e.kind === 'DB' && e.role === 'zone' && e.zone.deep;
  const reader = e.kind === 'LB' || deepDB;
  e.spdMul = reader && e.role !== 'rush' && t < e.diagT ? 0.45 : 1;
  // read step: underneath zone defenders hold their spot while reading run/pass,
  // instead of bailing to their drop (so they can trigger downhill on a run)
  if (e.kind === 'LB' && e.role === 'zone' && !e.zone.deep && t < e.diagT && !S.carrier && S.ball.state === 'held') {
    return steer(e, e.x0 - 0.3, e.y0, 0.5, S);
  }
  // deep defenders: a controlled backpedal while reading, not a full-speed bail
  if (deepDB && t < e.diagT + 0.25 && !S.carrier && S.ball.state === 'held') {
    return steer(e, e.x0 + 1.2 + t * 1.5, e.y0, 0.45, S);
  }

  if (S.play.type === 'run' && !S.completion) {
    // draws look like pass: second level drops before it reads run
    const drawDelay = S.play.scheme === 'draw' && e.kind !== 'DL' ? 0.45 : 0;
    const diag = e.diagT + (deepDB ? 0.25 : 0) + drawDelay;
    if (t < diag && S.play.carrier !== 'QB') return coverageLogic(S, e);
    const c = S.carrier || S.ball.holder;
    // corners in man stay with their man until the ball is clearly coming their way
    // (only when their man is actually running a route; a DB 'covering' a blocker plays the run)
    if (e.role === 'man' && e.kind === 'DB' && e.man?.detached && e.man !== c && c && c.x < S.los + 0.5 && dist(e, c) > 7) return coverageLogic(S, e);
    if (c && c === S.carrier && isContain(S, e, c)) return containCarrier(S, e, c);
    return pursueCarrier(S, e, e.role !== 'rush' && e.role !== 'dogRush' && e.kind !== 'DL');
  }

  if (S.carrier) {
    const recognized = !!S.completion || t >= (e.scrambleReact ?? 0);
    if (!recognized) return coverageLogic(S, e);
    return pursueCarrier(S, e);
  }

  // play-action bite
  if (S.play.pa && reader && e.role !== 'rush') {
    const bite = clamp(0.25 + (100 - e.r.awr) * 0.012, 0.2, 0.95) * (deepDB ? 0.5 : 1);
    if (t > 0.2 && t < 0.2 + bite) return steer(e, S.los + 1.5, e.y + (S.O.RB.y - e.y) * 0.3, 0.7, S);
  }
  return coverageLogic(S, e);
}

function coverageLogic(S, e) {
  const { t, O } = S;
  const qb = O.QB;
  switch (e.role) {
    case 'rush': case 'dogRush': {
      if (S.thrown) return steer(e, e.x - 0.5, e.y, 0.3, S);
      let tgt = S.carrier || (S.ball.holder || qb);
      // vs a run look, attack the mesh (where the ball will be)
      if (S.play.type === 'run' && !S.handed && S.mesh && S.play.scheme !== 'draw') tgt = { x: (S.mesh.x + S.runner.x) / 2, y: (S.mesh.y + S.runner.y) / 2 };
      // avoid unengaged blockers directly in the path
      let tx = tgt.x, ty = tgt.y;
      for (const b of S.ents) {
        if (b.side !== 'O' || b.engaged || b === tgt || b.role === 'route') continue;
        const bx = b.x - e.x, by = b.y - e.y;
        if (hyp(bx, by) < 2.2 && (tx - e.x) * bx + (ty - e.y) * by > 0) ty += (e.y >= b.y ? 1 : -1) * 1.4;
      }
      return steer(e, tx, ty, 1, S);
    }
    case 'spy': {
      if (S.scramble || (S.carrier === qb)) return pursueCarrier(S, e);
      return steer(e, S.los + 4.5, qb.y, 0.7, S);
    }
    case 'dog': {
      const rb = e.man;
      if (t > 0.6 && (rb.role === 'pblock' || (rb.role === 'route' && rb.route.delay > t))) {
        e.role = 'dogRush';
        return;
      }
      return manCover(S, e, rb);
    }
    case 'man': {
      const m = e.man;
      if (m.role === 'pblock' || m.role === 'runblock' || m.role === 'stalk') {
        // my man stayed in: help underneath / read the QB
        return steer(e, S.los + 5, clamp(qb.y + (e.y0 - qb.y) * 0.4, 1, S.W - 1), 0.6, S);
      }
      return manCover(S, e, m);
    }
    case 'zone': return zoneCover(S, e);
    default: steer(e, e.x, e.y, 0.2, S);
  }
}

function manCover(S, e, m) {
  const { t } = S;
  // press jam at the line
  if (e.press && !e.jamDone && t > 0.05 && dist(e, m) < 1.6) {
    e.jamDone = true;
    contact(S, e, m);
    const win = (e.r.press * 0.7 + e.r.agi * 0.3) - (m.r.str * 0.6 + m.r.route * 0.2 + m.r.agi * 0.2) + S.rng.gauss(0, 12);
    if (win > 0) { m.jamUntil = t + clamp(0.15 + win * 0.012, 0.15, 0.55); }
    else { e.stunUntil = t + clamp(0.1 - win * 0.01, 0.1, 0.5); event(S, `${m.pl.name} beats the press!`); }
  }
  // delayed read of the receiver (reaction time)
  // crisp route runners buy extra separation against lesser cover players
  const lag = Math.round(clamp(e.react + Math.max(0, m.r.route - e.r.cover) * 0.003 + (m.mods.misread || 0), 0.1, 0.8) / DT);
  const hist = m.hist;
  const h = hist[Math.max(0, hist.length - 1 - lag)] || [m.x, m.y];
  const h2 = hist[Math.max(0, hist.length - 2 - lag)] || h;
  const hvx = (h[0] - h2[0]) / DT, hvy = (h[1] - h2[1]) / DT;
  const inside = Math.sign(S.ballY - m.y) || 1;
  // keep a cushion over the top that shrinks as the receiver eats it up
  const startCushion = e.press ? 0.8 : Math.max(1.5, e.x0 - m.x0);
  const gained = Math.max(0, h[0] - m.x0);
  const cushion = clamp(startCushion - gained * 0.45, e.press ? 0.4 : 1.0, 7);
  let tx = h[0] + cushion + hvx * 0.25;
  let ty = h[1] + inside * 0.7 + hvy * 0.3;
  if (m.x > e.x + 0.5) {
    // beaten: turn and run, chase the hip
    tx = m.x + 0.6 + m.vx * 0.3; ty = m.y + inside * 0.3 + m.vy * 0.2;
  }
  steer(e, tx, clamp(ty, 0.5, S.W - 0.5), 1, S);
}

function zoneCover(S, e) {
  const { t, O } = S;
  const z = e.zone;
  const qb = O.QB;
  const dropping = t < (z.deep ? 0.9 : 0.7);
  // receivers threatening my zone
  let threat = null, tscore = -Infinity;
  for (const r of [O.WR, O.FX, O.RB]) {
    if (r.role !== 'route' && r.role !== 'target') continue;
    const dy = Math.abs(r.y - z.y);
    if (dy > z.halfW + 2) continue;
    if (z.deep) {
      if (r.x < S.los + 6 && !(z.name.startsWith('quarter') && r.x > S.los + 3)) continue;
      const sc = r.x - dy * 0.3;
      if (sc > tscore) { tscore = sc; threat = r; }
    } else {
      const dx = Math.abs(r.x - z.x);
      if (dx > 7) continue;
      const sc = -hyp(dx, dy);
      if (sc > tscore) { tscore = sc; threat = r; }
    }
  }
  let tx = z.x, ty = z.y;
  // eyes on the QB: drift toward the current read
  const readE = S.currentRead >= 0 ? S.ents[S.currentRead] : null;
  if (readE && !dropping) {
    const k = clamp((e.r.awr - 40) / 100, 0, 0.6);
    ty += clamp((readE.y - z.y) * k, -z.halfW, z.halfW);
  }
  if (threat && !dropping) {
    if (z.deep) {
      // stay on top of the deepest threat
      tx = Math.max(z.x - 1, threat.x + 3.5);
      ty = z.y + clamp(threat.y - z.y, -z.halfW - 1, z.halfW + 1);
    } else {
      // undercut: sit between QB and receiver
      const dq = dist(threat, qb) || 1;
      tx = threat.x + ((qb.x - threat.x) / dq) * 1.5;
      ty = threat.y + ((qb.y - threat.y) / dq) * 1.5;
      tx = clamp(tx, S.los + 1, z.x + 5);
    }
  }
  tx = Math.min(tx, 109.5);
  steer(e, tx, clamp(ty, 0.8, S.W - 0.8), dropping ? 0.95 : 0.85, S);
}

// Edge contain: the outermost second-level defender on the side the runner is
// heading keeps outside leverage and squeezes, turning the run back inside.
function isContain(S, e, c) {
  if (e.kind === 'DL' || e.engaged || S.t < e.stunUntil || c.side !== 'O' || c.x > S.los + 4) return false;
  const side = Math.sign((c.y - S.ballY) + c.vy * 0.4) || 1;
  if (S._containT !== S.t || S._containSide !== side) {
    S._containT = S.t; S._containSide = side;
    const outside = (d) => (d.y - S.ballY) * side;
    // the outermost free second-level defender on the run side is the force player;
    // corners still carrying a receiver in man and middle-of-field safeties are excluded
    S._contain = S.defList.filter((d) => d.kind !== 'DL' && !d.engaged && S.t >= d.stunUntil && outside(d) > -2 && d.x < c.x + 12 &&
      !(d.role === 'zone' && d.zone.deep && !/[WS]$/.test(d.zone.name)) && !(d.role === 'man' && d.man?.detached && d.man !== c))
      .sort((a, b) => outside(b) - outside(a))[0];
  }
  return S._contain === e;
}

function containCarrier(S, e, c) {
  const side = Math.sign((c.y - S.ballY) + c.vy * 0.4) || 1;
  // beaten to the edge already: just chase
  if ((c.y - e.y) * side > 1.5 && c.x > e.x + 0.5) return pursueCarrier(S, e);
  // get a step outside the runner and come downhill to meet him
  const tx = Math.max(S.los + 0.5, c.x + 1.5 + c.vx * 0.25);
  const ty = clamp(c.y + side * 1.3 + c.vy * 0.35, 0.5, S.W - 0.5);
  steer(e, tx, ty, 1, S);
}

function pursueCarrier(S, e, gapFit = false) {
  const c = S.carrier || (S.ball.state === 'held' ? S.ball.holder : null);
  if (!c || S.t < e.stunUntil) { if (c) steer(e, c.x, c.y, 0.3, S); return; }
  // intercept course: solve |r + v t| = s t for the earliest meeting time
  const rx = c.x - e.x, ry = c.y - e.y, sp = e.maxSpd * 0.97;
  const a = c.vx * c.vx + c.vy * c.vy - sp * sp, b = 2 * (rx * c.vx + ry * c.vy), cc = rx * rx + ry * ry;
  let tI = null;
  if (Math.abs(a) < 1e-6) tI = b < 0 ? -cc / b : null;
  else {
    const disc = b * b - 4 * a * cc;
    if (disc >= 0) {
      const q = Math.sqrt(disc), t1 = (-b - q) / (2 * a), t2 = (-b + q) / (2 * a);
      tI = [t1, t2].filter((x) => x > 0).sort((x, y) => x - y)[0] ?? null;
    }
  }
  // smarter defenders take better angles
  const iq = 0.6 + e.r.awr * 0.004;
  const lead = tI != null ? Math.min(tI, 2.5) * iq : 1.4 * iq;
  let tx = c.x + c.vx * lead, ty = c.y + c.vy * lead;
  // keep leverage: don't overrun; stay slightly on the goal side
  const g = c.side === 'O' ? 1 : -1;
  if ((e.x - c.x) * g > 0) tx += g * 0.4;
  if (!c.vx && !c.vy) { tx = c.x; ty = c.y; }
  // second-level defenders fit the gap at the line; they don't chase into the backfield
  if (gapFit && c.side === 'O' && c.x < S.los - 0.5) { tx = Math.max(tx, S.los + 0.3); ty = c.y + clamp(c.vy * 0.5, -2, 2); }
  steer(e, tx, ty, 1, S);
}

function escortReturn(S, e) {
  // defense has the ball (INT/fumble return): block for the returner
  const c = S.carrier;
  let best = null, bs = Infinity;
  for (const o of S.ents) {
    if (o.side !== 'O' || o.engaged || S.t < o.stunUntil) continue;
    const sc = dist(e, o) + dist(o, c) * 0.6;
    if (sc < bs) { bs = sc; best = o; }
  }
  if (!best) return steer(e, c.x - 4, c.y, 0.8, S);
  const dc = dist(best, c) || 1;
  steer(e, best.x + ((c.x - best.x) / dc) * 0.8, best.y + ((c.y - best.y) / dc) * 0.8, 1, S);
  if (dist(e, best) < 1 && !best.engaged) engage(S, e, best, 'stalk');
}

// --------------------------------------------------------------------------
// Blocking engagements
function power(e, kind, isDef) {
  const r = e.r;
  if (kind === 'pass') return isDef ? r.rushPow * 0.6 + r.agi * 0.2 + r.rushFin * 0.2 : r.passBlk * 0.7 + r.tech * 0.15 + r.awr * 0.15;
  if (kind === 'run') return isDef ? r.runStop * 0.65 + r.rushPow * 0.2 + r.awr * 0.15 : r.runBlk * 0.7 + r.tech * 0.15 + r.awr * 0.15 + 15;
  return isDef ? r.runStop * 0.5 + r.agi * 0.3 + r.awr * 0.2 : r.runBlk * 0.6 + r.agi * 0.2 + r.awr * 0.2; // stalk
}

function engage(S, blk, def, kind) {
  if (blk.engaged || def.engaged || S.t < def.noEngageUntil && def.noEngageFrom === blk) return;
  if (def === S.carrier || blk === S.carrier) return;
  // Ghost: the block attempt phases right through
  if (def.mods.phase && S.rng.chance(def.mods.phase)) {
    def.noEngageUntil = S.t + 0.6; def.noEngageFrom = blk;
    if (S.rng.chance(0.3)) event(S, `${def.pl.name} phases through ${blk.pl.name}'s block!`);
    return;
  }
  let diff = power(def, kind, true) - power(blk, kind, false) + (def.mass - blk.mass) * 0.08 + S.rng.gauss(0, 7);
  diff += (def.mods.leverage || 0) - (blk.mods.leverage || 0); // Ground
  diff += ((def.mods.swarm || 0) * nearMates(S, def) - (blk.mods.swarm || 0) * nearMates(S, blk)) * 60; // Bug
  contact(S, blk, def);
  const p = { a: blk, d: def, kind, t0: S.t, diff, cx: (blk.x + def.x) / 2, cy: (blk.y + def.y) / 2 };
  // pass rush 'quick win': a rep can be lost at the snap (speed rush, swim, bull)
  if (kind === 'pass' && S.rng.chance(clamp(0.25 + diff * 0.009 + (def.r.rushFin - 60) * 0.004, 0.06, 0.5))) p.winAt = S.t + S.rng.range(0.35, 1.3);
  blk.engaged = def.engaged = p;
  S.pairs.push(p);
}

function breakPair(S, p) {
  p.a.engaged = null; p.d.engaged = null;
  S.pairs = S.pairs.filter((x) => x !== p);
}

function slideTo(e, x, y, max) {
  const dx = x - e.x, dy = y - e.y, l = hyp(dx, dy);
  if (l <= max) { e.x = x; e.y = y; } else { e.x += dx / l * max; e.y += dy / l * max; }
}

function updatePairs(S) {
  for (const p of S.pairs.slice()) {
    const { a, d, kind } = p;
    const goal = S.carrier ? S.carrier : (S.ball.state === 'held' && S.ball.holder ? S.ball.holder : S.O.QB);
    if (S.thrown && kind === 'pass') { breakPair(S, p); continue; }
    if (S.carrier && S.carrier.side === d.side) { breakPair(S, p); continue; }
    let ux = goal.x - p.cx, uy = goal.y - p.cy;
    const ul = hyp(ux, uy) || 1; ux /= ul; uy /= ul;
    let v = kind === 'pass' ? clamp(1.35 + p.diff * 0.1, -0.8, 3.5) : clamp(p.diff * 0.07, -1.6, 2.2);
    if (v > 0 && a.mods.sturdy) v *= 1 - a.mods.sturdy;
    if (v < 0 && d.mods.sturdy) v *= 1 - d.mods.sturdy;
    p.cx += ux * v * DT; p.cy += uy * v * DT;
    // defender works laterally toward the ball
    if (kind !== 'pass') p.cy += clamp(goal.y - p.cy, -1, 1) * 0.6 * DT * (d.r.agi / 80);
    // blocker sits between the defender and his target (slide into place; no snapping)
    const slide = Math.abs(v) * DT + 0.22;
    slideTo(d, p.cx - ux * 0.42, p.cy - uy * 0.42, slide);
    slideTo(a, p.cx + ux * 0.42, p.cy + uy * 0.42, slide);
    d.vx = a.vx = ux * v; d.vy = a.vy = uy * v;
    // shed?
    const held = S.t - p.t0;
    let rate;
    if (kind === 'pass') rate = 0.3 + Math.max(0, p.diff) * 0.025 + (held > 1.5 ? 0.85 : 0) + (S.ball.holder === S.O.QB && dist(d, S.O.QB) < 1.6 ? 2.0 : 0);
    else if (kind === 'run') rate = 0.1 + Math.max(0, p.diff) * 0.012 + (S.carrier && dist(d, S.carrier) < 2.0 ? 0.15 + Math.max(0, p.diff) * 0.02 : 0);
    else rate = 0.5 + Math.max(0, p.diff) * 0.02 + (S.carrier && dist(d, S.carrier) < 2 ? 1.2 : 0);
    if (kind !== 'stalk') rate *= 1.25 - a.r.tech * 0.005; // technique sustains blocks
    if (S.carrier && S.carrier.side === 'O' && ((S.carrier.x - p.cx) > 3)) rate += 2; // runner is past
    if (S.rng.chance(rate * DT) || (p.winAt && S.t >= p.winAt)) {
      if (p.winAt && S.t >= p.winAt) event(S, `${d.pl.name} beats ${a.pl.name}!`);
      breakPair(S, p);
      a.stunUntil = S.t + 0.35;
      d.noEngageUntil = S.t + 0.9; d.noEngageFrom = a;
      if (kind === 'run' && p.diff < -14 && S.rng.chance(0.3)) { d.stunUntil = S.t + 0.9; }
    }
  }
}

// --------------------------------------------------------------------------
// Ball carrier AI
function carrierLogic(S, c) {
  const g = c.side === 'O' ? 1 : -1;
  const { t } = S;
  if (S.result) return;
  // run-play press phase: follow the aim point to the line
  if (c.side === 'O' && S.play.type === 'run' && !S.completion && c.x < S.los - 0.3 && t - (S.handTime || 0) < 0.9) {
    const aim = c.runAim || S.design.aim;
    const tx = aim.x, ty = aim.y;
    // still look for daylight
    const h = chooseHeading(S, c, g);
    const bx = c.x + h.dx * 4, by = c.y + h.dy * 4;
    steer(c, tx * 0.55 + bx * 0.45, ty * 0.55 + by * 0.45, 1, S);
    return;
  }
  if (!c.nextThink || t >= c.nextThink) {
    c.nextThink = t + 0.1;
    c.heading = chooseHeading(S, c, g);
  }
  const h = c.heading;
  steer(c, c.x + h.dx * 5, c.y + h.dy * 5, 1, S);
  // QB slides / gives himself up
  if (c.pos === 'QB' && c.side === 'O' && c.x > S.los + 2 && S.scramble) {
    for (const d of S.ents) if (d.side === 'D' && !d.engaged && dist(d, c) < 1.6 && S.rng.chance(0.35)) {
      event(S, `${c.pl.name} slides.`);
      return endPlay(S, { type: 'dead', slide: true });
    }
  }
}

function chooseHeading(S, c, g) {
  const W = S.W;
  const wantOOB = c.side === 'O' && S.situation.wantOOB;
  let best = null, bestScore = -Infinity;
  const prev = c.heading;
  for (let a = -84; a <= 84; a += 12) {
    const rad = (a * Math.PI) / 180;
    const dx = g * Math.cos(rad), dy = Math.sin(rad);
    let score = Math.cos(rad) * 1.2;
    for (const L of [1.5, 3.5, 6.5]) {
      const px = c.x + dx * L, py = c.y + dy * L;
      const tL = L / c.maxSpd;
      for (const o of S.ents) {
        if (o.side === c.side || S.t < o.stunUntil || o.down) continue;
        // blocked defenders still clog the lane (but can't chase)
        const reach = o.engaged ? 0.9 : o.maxSpd * tL * 0.85 + 0.8;
        const gap = hyp(o.x - px, o.y - py) - reach;
        if (gap < 2.2) score -= (2.2 - gap) * (2.2 - gap) * (L === 1.5 ? 0.16 : 0.1) * (o.engaged ? 0.7 : 1);
      }
      if (py < 0.7 || py > W - 0.7) score -= wantOOB ? -0.2 : 2.5;
    }
    if (wantOOB) score += (c.y < W / 2 ? -dy : dy) * 0.5;
    if (prev) score += (dx * prev.dx + dy * prev.dy) * 0.25; // smoothness
    if (c.r.vision < 99) score += S.rng.gauss(0, (100 - c.r.vision) * 0.004); // vision: seeing the right hole
    if (score > bestScore) { bestScore = score; best = { dx, dy }; }
  }
  return best;
}

function checkCarrier(S) {
  const c = S.carrier;
  const g = c.side === 'O' ? 1 : -1;
  // scoring / boundaries
  if (c.side === 'O' && c.x >= 100) return endPlay(S, { type: 'td' });
  if (c.side === 'D' && c.x <= 0) return endPlay(S, { type: 'defTD' });
  if (c.y < 0 || c.y > S.W) {
    c.y = clamp(c.y, 0, S.W);
    return endPlay(S, { type: 'dead', oob: true });
  }
  if (c.x > 110 || c.x < -10) return endPlay(S, { type: 'dead', oob: true });
  // tackles
  const near = [];
  for (const o of S.ents) {
    if (o.side === c.side || o.down || S.t < o.stunUntil) continue;
    const d = dist(o, c);
    if (o.engaged && (d > 1.2 || o.engaged.kind === 'pass')) continue; // blocked: only an arm tackle at close range
    if (d < 2.2 && !o.engaged) near.push(o);
    const R = 1.0 + (o.mass + c.mass) / 450;
    // dive only when the runner is pulling away (not closing)
    const closing = d > 1e-3 ? -(((c.vx - o.vx) * (c.x - o.x) + (c.vy - o.vy) * (c.y - o.y)) / d) : 0;
    const dive = d > R && d < R + 0.8 && closing < 0.6;
    if ((d > R && !dive) || S.t - o.lastTackleTry < 0.6) continue;
    o.lastTackleTry = S.t;
    contact(S, o, c);
    if (c.mods.phase && S.rng.chance(c.mods.phase)) {
      o.stunUntil = S.t + 0.5;
      event(S, `${c.pl.name} phases right through ${o.pl.name}!`);
      continue;
    }
    const helpers = near.filter((x) => x !== o).length;
    const tr = o.r, cr = c.r;
    let p = 0.91 + (tr.tackle * 0.45 + tr.awr * 0.25 + tr.spd * 0.3 - cr.elu * 0.35 - cr.tgh * 0.35 - cr.str * 0.3) * 0.012;
    p += (o.mass - c.mass) * 0.003 + helpers * 0.08;
    p += (o.mods.swarm || 0) * helpers - (c.mods.swarm || 0) * nearMates(S, c); // Bug
    if (c.pos === 'QB' && S.ball.holder === c && !S.scramble && c.side === 'O') p += 0.08;
    p = clamp(p, 0.45, 0.98);
    if (dive) p *= 0.62;
    if (o.engaged) p *= 0.35; // arm tackle while blocked
    if (S.rng.chance(p)) {
      if (o.engaged) breakPair(S, o.engaged);
      S.tacklers = [o, ...near.filter((x) => x !== o && dist(x, c) < 1.4).slice(0, 1)];
      // fumble?
      const pF = (0.009 + Math.max(0, tr.tackle - cr.tgh) * 0.00035) * (1 - (c.mods.sturdy || 0));
      if (S.rng.chance(pF)) return fumble(S, c, o);
      // fall forward
      let fall = clamp(0.5 + (cr.str + c.mass - tr.tackle - o.mass) * 0.015, 0, 1.6);
      if (S.play.carrier === 'QB' && S.play.type === 'run' && c.pos === 'QB' && S.t < 1.2) fall += 1.1; // sneak: the pile surges forward
      // short yardage: the whole pile leans forward near the line
      if (c.side === 'O' && S.play.type === 'run' && (S.situation.toGo ?? 10) <= 2 && c.x < S.los + 3) fall += 0.8;
      fall *= 1 - Math.min(0.9, o.mods.sturdy || 0); // Rock: tacklers can't be driven back either
      const moving = (c.vx * g) > 1;
      S.fall = { e: c, x0: c.x };
      c.x += g * (moving ? fall : fall * 0.3);
      if (c.side === 'O' && c.x >= 100) return endPlay(S, { type: 'td', reach: true });
      return endPlay(S, { type: 'tackle' });
    }
    // missed
    o.stunUntil = S.t + (dive ? 0.9 : 0.5);
    c.slowUntil = S.t + 0.3;
    if (!S.brokenTackles) S.brokenTackles = 0;
    S.brokenTackles++;
    credit(S, c, 'brk', 1);
    event(S, cr.elu > cr.str ? `${c.pl.name} jukes ${o.pl.name}!` : `${c.pl.name} breaks the tackle of ${o.pl.name}!`);
  }
}

function checkSack(S) {
  const qb = S.O.QB;
  for (const o of S.ents) {
    if (o.side !== 'D' || o.engaged || S.t < o.stunUntil) continue;
    const d = dist(o, qb);
    if (d > 1.05 || S.t - o.lastTackleTry < 0.6) continue;
    o.lastTackleTry = S.t;
    contact(S, o, qb);
    if (qb.mods.phase && S.rng.chance(qb.mods.phase)) { o.stunUntil = S.t + 0.6; event(S, `${qb.pl.name} phases out of ${o.pl.name}'s grasp!`); continue; }
    const escape = clamp(0.08 + (qb.r.agi * 0.5 + qb.r.tgh * 0.5 - o.r.rushPow * 0.6 - o.r.spd * 0.2) * 0.005, 0.03, 0.25);
    if (S.rng.chance(escape)) {
      o.stunUntil = S.t + 0.6;
      event(S, `${qb.pl.name} escapes ${o.pl.name}!`);
      continue;
    }
    S.tacklers = [o];
    if (S.rng.chance(0.07 * (1 - (qb.mods.sturdy || 0)))) return fumble(S, qb, o, true);
    S.sacked = true;
    return endPlay(S, { type: 'sack', by: o });
  }
}

function fumble(S, c, forcer, sack = false) {
  event(S, `FUMBLE! ${forcer.pl.name} knocks it loose!`, 'big');
  credit(S, forcer, 'ff', 1);
  credit(S, c, 'fum', 1);
  if (sack) { S.sacked = true; S.sackFumble = true; }
  S.fumbleBy = c;
  c.hasBall = false;
  S.carrier = null;
  const ang = S.rng.range(0, Math.PI * 2), dd = S.rng.range(1.5, 4);
  S.ball.state = 'loose';
  S.ball.loose = { fx: c.x, fy: c.y, tx: clamp(c.x + Math.cos(ang) * dd, -9, 109), ty: clamp(c.y + Math.sin(ang) * dd, 0.3, S.W - 0.3), t0: S.t, T: 0.6 };
  for (const e of S.ents) e.stunUntil = Math.max(e.stunUntil, S.t + 0.15);
  for (const p of S.pairs.slice()) breakPair(S, p);
}

function updateLooseBall(S) {
  const b = S.ball, l = b.loose;
  const s = clamp((S.t - l.t0) / l.T, 0, 1);
  b.x = l.fx + (l.tx - l.fx) * s;
  b.y = l.fy + (l.ty - l.fy) * s;
  b.z = 0.3 + Math.abs(Math.sin(s * Math.PI * 3)) * 0.6 * (1 - s);
  if (s < 0.4) return;
  const near = S.ents.filter((e) => hyp(e.x - b.x, e.y - b.y) < 0.9);
  if (!near.length) return;
  const w = near.map((e) => ({ e, w: e.r.awr + e.r.agi * 0.5 }));
  const rec = S.rng.weighted(w).e;
  S.fumbleRec = rec;
  credit(S, rec, 'fr', 1);
  event(S, `Recovered by ${rec.pl.name}${rec.side === 'D' ? ' — TURNOVER!' : '.'}`, 'big');
  rec.x = b.x; rec.y = b.y;
  setCarrier(S, rec);
  endPlay(S, { type: 'fumbleRec', side: rec.side });
}

function chaseLoose(S, e) {
  steer(e, S.ball.x, S.ball.y, 1, S);
}

// --------------------------------------------------------------------------
function credit(S, e, stat, v) { S.stats.push({ pid: e.pl.id, stat, v }); }

function endPlay(S, info) {
  if (S.result) return;
  S.result = { ...info, t: S.t };
  const c = S.carrier;
  if (c) { c.vx = 0; c.vy = 0; }
}

// The tackle's fall-forward is applied in one step; replay it over a few frames so the pile slides instead of hopping.
function settleFall(S) {
  const f = S.fall;
  if (!f || S.carrier !== f.e || !S.frames.length) return;
  const c = f.e, x1 = c.x, n = Math.max(1, Math.ceil(Math.abs(x1 - f.x0) / 0.35));
  if (n < 2) return;
  const t = S.t;
  S.frames.pop();
  S.t = r2(t - DT);
  for (let i = 1; i <= n; i++) {
    c.x = f.x0 + (x1 - f.x0) * (i / n);
    if (S.ball.holder === c) S.ball.x = c.x;
    S.t = r2(S.t + DT);
    record(S);
  }
  c.x = x1;
}

function record(S) {
  const fr = {
    t: S.t,
    p: S.ents.map((e) => [r2(e.x), r2(e.y), e.engaged ? 1 : (S.t < e.stunUntil ? 2 : 0), r2(e.vx), r2(e.vy)]),
    b: [r2(S.ball.x), r2(S.ball.y), r2(S.ball.z), S.ball.state === 'held' && S.ball.holder ? S.ball.holder.idx : -1],
    read: S.thrown ? -1 : (S.currentRead ?? -1),
  };
  S.frames.push(fr);
}

// --------------------------------------------------------------------------
// Build the play result
function finalize(S) {
  const R = S.result;
  const { los } = S;
  const out = {
    frames: S.frames, events: S.events, design: S.design, duration: S.t, motionT: (S.motionFrames || 0) * DT, coverageTipped: S.coverageTipped || null,
    cast: S.ents.map((e) => ({ pid: e.pl.id, side: e.side, pos: e.pos, card: e.pl.pos })),
    stats: S.stats, kind: S.play.type, playName: S.play.name, defName: S.dcall.name, toxic: S.toxic,
    yards: 0, endX: los, td: false, defTD: false, safety: false, turnover: false,
    incomplete: false, oob: false, clockStops: false, desc: null,
  };
  const c = S.carrier;
  const qb = S.O.QB;
  const tacklerIds = (S.tacklers || []).map((e) => e.pl.id);
  out.tacklers = tacklerIds;
  const credTackles = () => {
    const tk = S.tacklers || [];
    tk.forEach((e, i) => out.stats.push({ pid: e.pl.id, stat: i === 0 ? 'tkl' : 'ast', v: 1 }));
  };

  // penalties decided by the sim
  if (R.type === 'dpi') {
    out.penalty = { type: 'DPI', on: 'D', player: R.defender.pl.id, spot: Math.min(R.spot, 99), auto1st: true };
    out.passer = qb.pl.id; out.target = S.passInfo.target.pl.id;
    out.incomplete = true; out.clockStops = true;
    return out;
  }

  const passAttempt = S.thrown && !S.ball.flight?.pitch;
  if (passAttempt) { out.throwT = S.passInfo.t; out.pressureAtThrow = S.passInfo.pressure; out.passer = qb.pl.id; out.airYards = r2(S.passInfo.airYards); if (S.passInfo.target) out.target = S.passInfo.target.pl.id; }
  if (S.throwAway) out.throwAway = true;

  if (R.type === 'incomplete') {
    out.kind = 'pass'; out.incomplete = true; out.clockStops = true; out.endX = los;
    out.pbu = R.pbu ? R.pbu.pl.id : null; out.drop = !!R.drop; out.miss = R.miss; out.batted = !!R.batted;
    return out;
  }
  if (R.type === 'sack') {
    out.kind = 'sack'; out.sack = R.by.pl.id; out.endX = Math.min(qb.x, los);
    out.yards = r2(out.endX - los);
    if (out.endX <= 0) out.safety = true;
    credTackles();
    return out;
  }
  if (R.type === 'timeout') {
    // play clock ran out on the sim: whistle it dead where the ball is
    if (!c) { out.kind = 'pass'; out.incomplete = true; out.clockStops = true; return out; }
  }

  if (S.interception) {
    out.kind = 'int'; out.turnover = true; out.interceptor = S.interception.by.pl.id; out.clockStops = true;
    const d = S.interception.by;
    const endX = R.touchback ? 100 : clamp(d.x, -10, 110);
    out.returnYards = r2(S.interception.x - Math.min(endX, 100));
    out.endX = endX;
    if (R.type === 'defTD') out.defTD = true;
    else if (endX >= 100) out.touchback = true;
    if (R.type === 'tackle') credTackles();
    return out;
  }

  if (R.type === 'fumbleRec' || S.fumbleRec) {
    out.fumble = S.fumbleBy.pl.id;
    out.recovered = S.fumbleRec.pl.id;
    out.endX = clamp(S.fumbleRec.x, -10, 110);
    out.kind = S.sackFumble ? 'sack' : (S.completion ? 'pass' : (S.play.type === 'run' || S.scramble ? 'run' : 'pass'));
    if (S.sackFumble) out.sack = (S.tacklers[0] || {}).pl?.id;
    out.yards = r2(out.endX - los);
    out.clockStops = true;
    if (S.fumbleRec.side === 'D') { out.turnover = true; }
    if (S.completion) { out.completion = true; out.receiver = S.completion.rec.pl.id; }
    if (S.fumbleBy && S.play.type === 'run' && !S.completion) out.rusher = S.fumbleBy.pl.id;
    if (S.fumbleRec.side === 'O' && out.endX <= 0) out.safety = true;
    credTackles();
    return out;
  }

  // ball carrier play (run, scramble, completion)
  if (!c) { out.kind = S.play.type === 'run' ? 'run' : 'pass'; out.incomplete = S.play.type !== 'run'; out.clockStops = out.incomplete; if (!out.incomplete) out.rusher = S.O.QB.pl.id; return out; }
  out.endX = clamp(c ? c.x : los, -10, 110);
  if (S.completion) {
    out.kind = 'pass'; out.completion = true; out.receiver = S.completion.rec.pl.id;
    out.yac = r2(out.endX - S.completion.x);
  } else {
    out.kind = 'run'; out.rusher = c.pl.id; out.scramble = !!S.scramble;
  }
  if (R.type === 'td') { out.td = true; out.endX = 100; }
  if (R.oob) { out.oob = true; }
  if (R.slide) out.slide = true;
  out.yards = r2(Math.min(out.endX, 100) - los);
  if (!out.td && out.endX <= 0) out.safety = true;
  if (R.type === 'tackle') credTackles();
  out.brokenTackles = S.brokenTackles || 0;
  return out;
}

// ==========================================================================
// Kick & punt returns, simulated with the same engine as scrimmage plays.
// Frame: the RECEIVING team's frame (returner runs toward +x; coverage comes from +x).
// opts: { rng, W, kind: 'kickoff'|'punt', kickX, kickY, landX, landY, hang,
//         receivers: [{player, ratings, mods}] (returner first), coverage: [{...}] (kicker first) }
export function simulateReturn(opts) {
  const { rng, W, kind, kickX, kickY, landX, landY, hang } = opts;
  const S = {
    rng, W, los: Math.min(landX, 99), ballY: landY, flip: 1,
    play: { type: 'return', name: kind === 'punt' ? 'Punt Return' : 'Kick Return' }, dcall: { name: 'Coverage' },
    situation: {}, t: 0, ents: [], O: {}, D: {}, frames: [], events: [], pairs: [],
    ball: { state: 'held', holder: null, x: 0, y: 0, z: 1 }, carrier: null, result: null,
    handed: true, thrown: false, qb: {}, stats: [], tacklers: [], toxic: {},
    design: { routes: [], zones: [], aim: null, rush: [] },
  };
  opts.receivers.forEach(({ player, ratings, mods }, i) => { const e = makeEnt(player, ratings, 'O', `R${i}`, i, mods); e.role = i === 0 ? 'returner' : 'wall'; S.ents.push(e); });
  opts.coverage.forEach(({ player, ratings, mods }, i) => { const e = makeEnt(player, ratings, 'D', `C${i}`, opts.receivers.length + i, mods); e.role = i === 0 ? 'kicker' : 'cover'; S.ents.push(e); });
  S.offList = S.ents.filter((e) => e.side === 'O');
  S.defList = S.ents.filter((e) => e.side === 'D');
  const ret = S.offList[0], kicker = S.defList[0];
  S.O.QB = ret; S.runner = ret;
  // --- alignment
  const nCov = S.defList.length - 1;
  S.defList.forEach((e, i) => {
    if (i === 0) { e.x = kind === 'punt' ? kickX + 13 : kickX + 6; e.y = kind === 'punt' ? kickY : W / 2; return; }
    if (kind === 'punt') { e.x = kickX + 0.6; e.y = i <= 2 ? (i === 1 ? 4 : W - 4) : clamp(kickY + (i - 4.5) * 1.6, 2, W - 2); } // gunners wide
    else { e.x = kickX + 1; e.y = 3 + (i - 1) * ((W - 6) / Math.max(1, nCov - 1)); }
  });
  S.offList.forEach((e, i) => {
    if (i === 0) { e.x = kind === 'punt' ? landX - 6 : Math.min(landX - 6, 97); e.y = W / 2 + (landY - W / 2) * 0.4; return; }
    if (kind === 'punt') { e.x = kickX - 1; e.y = clamp(kickY + (i - 3.5) * 2.2, 2, W - 2); if (i <= 2) { e.x = kickX - 1; e.y = i === 1 ? 5 : W - 5; } }
    else { e.x = kickX - 12 - (i % 2) * 8; e.y = 5 + (i - 1) * ((W - 10) / 5); }
  });
  for (const e of S.ents) { e.x0 = e.x; e.y0 = e.y; e.react = 0.2; e.diagT = 0.3; }
  // --- ball flight from the kick point to the landing spot
  const fromX = kind === 'punt' ? kickX + 12 : kickX, fromY = kind === 'punt' ? kickY : W / 2;
  S.ball = { state: 'air', holder: null, x: fromX, y: fromY, z: 0.5,
    flight: { fx: fromX, fy: fromY, tx: landX, ty: landY, t0: 0, T: hang, target: ret, peak: kind === 'punt' ? 14 : 16, kick: true } };
  record(S);
  while (!S.result && S.t < 16) {
    S.t = r2(S.t + DT);
    returnTick(S, kind, ret, kicker);
    record(S);
  }
  settleFall(S);
  if (!S.result) endPlay(S, { type: 'tackle' });
  const R = S.result, c = S.carrier;
  const out = {
    frames: S.frames, events: S.events, duration: S.t, catchT: S.catchT ?? null,
    cast: S.ents.map((e) => ({ pid: e.pl.id, side: e.side, pos: e.pos, card: e.pl.pos })),
    stats: S.stats, tacklers: (S.tacklers || []).map((e) => e.pl.id), toxic: S.toxic,
    fairCatch: R.type === 'fair', catchX: S.catchX ?? landX,
  };
  if (R.type === 'fumbleRec') { out.fumble = true; out.recoveredBy = S.fumbleRec.side === 'O' ? 'receiving' : 'kicking'; out.endX = clamp(S.fumbleRec.x, -10, 110); }
  else out.endX = clamp(c ? c.x : (S.catchX ?? landX), -10, 110);
  out.td = R.type === 'td' || (!out.fumble && out.endX >= 100);
  out.defTD = R.type === 'defTD';
  if (out.td) out.endX = 100;
  if (R.type === 'tackle') (S.tacklers || []).forEach((e, i) => out.stats.push({ pid: e.pl.id, stat: i === 0 ? 'tkl' : 'ast', v: 1 }));
  return out;
}

function returnTick(S, kind, ret, kicker) {
  const t = S.t;
  for (const e of S.ents) { e.hist.push([e.x, e.y]); if (e.hist.length > 12) e.hist.shift(); }
  // --- ball in the air
  if (S.ball.state === 'air') {
    const f = S.ball.flight, s = clamp((t - f.t0) / f.T, 0, 1);
    S.ball.x = f.fx + (f.tx - f.fx) * s; S.ball.y = f.fy + (f.ty - f.fy) * s;
    S.ball.z = 1 + f.peak * 4 * s * (1 - s);
    if (s >= 1) {
      const nearest = Math.min(...S.defList.map((d) => dist(d, ret)));
      if (kind === 'punt' && nearest < 11 && S.rng.chance(nearest < 6 ? 0.97 : 0.75)) {
        S.catchX = ret.x; S.ball.state = 'held'; S.ball.holder = ret; ret.hasBall = true;
        event(S, `${ret.pl.name} calls for a fair catch.`);
        return endPlay(S, { type: 'fair' });
      }
      if (kind === 'punt' && S.rng.chance(clamp(0.03 - ret.r.hands * 0.0003, 0.004, 0.03))) {
        event(S, `${ret.pl.name} muffs the punt!`, 'big');
        S.fumbleBy = ret;
        S.ball.state = 'loose';
        S.ball.loose = { fx: ret.x, fy: ret.y, tx: ret.x + S.rng.range(-3, 3), ty: clamp(ret.y + S.rng.range(-3, 3), 0.5, S.W - 0.5), t0: t, T: 0.6 };
      } else {
        S.catchX = ret.x; S.catchT = t;
        setCarrier(S, ret);
      }
    }
  }
  if (S.ball.state === 'loose') { updateLooseBall(S); if (S.result) return; }
  // --- receiving team
  for (const e of S.offList) {
    if (e === S.carrier || e.engaged) continue;
    if (S.ball.state === 'loose') { chaseLoose(S, e); continue; }
    if (e === ret && !S.carrier) {
      // settle 4 yards behind the landing spot, then time the approach to catch it moving forward
      const f = S.ball.flight, left = f.t0 + f.T - S.t;
      if (left > 0.9) steer(e, f.tx - 4, f.ty, 0.8, S);
      else steer(e, f.tx + 3, f.ty, 1, S);
      continue;
    }
    // punts: most of the return unit rushes the punter first, then trails back
    if (kind === 'punt' && e.pos !== 'R1' && e.pos !== 'R2' && S.t < 1.3 && !S.carrier) { steer(e, kicker.x, kicker.y, 0.9, S); continue; }
    // pick up the most dangerous free cover man: closest to the ball, in my area
    const ref = S.carrier && S.carrier.side === 'O' ? S.carrier : { x: S.ball.flight.tx, y: S.ball.flight.ty };
    let best = null, bs = Infinity;
    for (const d of S.defList) {
      if (d.engaged || S.t < d.noEngageUntil || S.t < d.stunUntil) continue;
      const sc = dist(e, d) * 0.7 + dist(d, ref) * 0.6 + (d.claimedBy && d.claimedBy !== e && d.claimedT === S.t ? 8 : 0);
      if (sc < bs) { bs = sc; best = d; }
    }
    if (best) { best.claimedBy = e; best.claimedT = S.t; }
    if (!S.carrier && !(best && dist(e, best) < 15)) {
      // form the wall 10-22 yards in front of the catch, in my lane
      const wallX = clamp(best ? (best.x + ref.x) / 2 : ref.x + 15, ref.x + 8, ref.x + 22);
      steer(e, wallX, best ? (best.y + e.y0) / 2 : e.y0, 0.9, S);
    } else if (best) {
      // after the catch: get between my man and the returner
      const dc = dist(best, ref) || 1;
      steer(e, best.x + ((ref.x - best.x) / dc) * 0.9, best.y + ((ref.y - best.y) / dc) * 0.9, 1, S);
    } else steer(e, ref.x + 4, e.y, 0.8, S);
    if (best && dist(e, best) < 1.6) engage(S, e, best, 'run');
  }
  if (S.carrier) carrierLogic(S, S.carrier);
  // --- coverage: sprint down in lanes, then converge on the ball
  for (const e of S.defList) {
    if (e === S.carrier || e.engaged) continue;
    if (S.ball.state === 'loose') { chaseLoose(S, e); continue; }
    if (S.carrier) { if (S.carrier.side === 'O') pursueCarrier(S, e); else escortReturn(S, e); continue; }
    const f = S.ball.flight;
    // keep lane discipline: spread across the field, squeezing only partway toward the ball
    const lane = e === kicker ? f.ty : f.ty + (e.y0 - S.W / 2) * clamp((e.x - f.tx) / 30, 0.35, 0.8);
    // break down under control as the ball comes down, so the returner can't just juke past
    const closeIn = hyp(e.x - f.tx, e.y - f.ty) < 7;
    steer(e, f.tx + (closeIn ? 2.5 : 1), clamp(lane, 1, S.W - 1), e === kicker ? 0.7 : closeIn ? 0.55 : 1, S);
  }
  updatePairs(S);
  // holdups at the line and downfield blocks don't last forever away from the ball
  for (const p of S.pairs.slice()) {
    const farFromBall = !S.carrier || dist(p.d, S.carrier) > 8;
    if (S.t - p.t0 > 2.0 && farFromBall) { breakPair(S, p); p.d.noEngageUntil = S.t + 1.2; p.d.noEngageFrom = p.a; }
  }
  for (const e of S.ents) { if (e.engaged) continue; e.x += e.vx * DT; e.y += e.vy * DT; }
  separate(S);
  syncBall(S);
  if (S.carrier) checkCarrier(S);
}
