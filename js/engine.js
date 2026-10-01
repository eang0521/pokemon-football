// Game engine host: runs a Game and turns its output into compact messages.
// Used inside the Web Worker (js/worker.js) and as an in-page fallback.
import { Game } from './game.js';

// Frames -> one Float32Array: per frame [t, bx, by, bz, holder, read, (x,y,flag,vx,vy) * n]
export function packFrames(frames) {
  if (!frames?.length) return { n: 0, stride: 0, data: new Float32Array(0) };
  const n = frames[0].p.length, stride = 6 + n * 5;
  const data = new Float32Array(frames.length * stride);
  frames.forEach((f, i) => {
    const o = i * stride;
    data[o] = f.t; data[o + 1] = f.b[0]; data[o + 2] = f.b[1]; data[o + 3] = f.b[2]; data[o + 4] = f.b[3]; data[o + 5] = f.read ?? -1;
    for (let k = 0; k < n; k++) { const p = f.p[k], q = o + 6 + k * 5; data[q] = p[0]; data[q + 1] = p[1]; data[q + 2] = p[2]; data[q + 3] = p[3]; data[q + 4] = p[4]; }
  });
  return { n, stride, data };
}
export function unpackFrames(pk) {
  const { n, stride, data } = pk;
  const out = [];
  for (let o = 0; o < data.length; o += stride) {
    const p = [];
    for (let k = 0; k < n; k++) { const q = o + 6 + k * 5; p.push([data[q], data[q + 1], data[q + 2], data[q + 3], data[q + 4]]); }
    out.push({ t: data[o], b: [data[o + 1], data[o + 2], data[o + 3], data[o + 4]], read: data[o + 5], p });
  }
  return out;
}

const cardLite = (c) => c && ({ ...c });

export function createEngine() {
  let game = null, sentPlayers = new Set();

  // commit=false: a look-ahead snapshot that doesn't mark new players as delivered
  function stateOf(commit = true) {
    const g = game;
    const newPlayers = {};
    for (const id in g.players) if (!sentPlayers.has(id)) { newPlayers[id] = cardLite(g.players[id]); if (commit) sentPlayers.add(id); }
    return {
      snap: g.snapshot(), quarter: g.quarter, score: [...g.score], final: g.final,
      stats: g.stats, log: g.log, drives: g.drives, quarterScores: g.quarterScores,
      players: newPlayers,
      injured: Object.keys(g.players).filter((id) => g.players[id].injured),
      depth: g.depth.map((d) => ({
        energy: { ...d.energy },
        onField: Object.fromEntries(Object.entries(d.onField).map(([k, c]) => [k, c.id])),
        cards: Object.fromEntries(Object.entries(d.cards).map(([k, c]) => [k, c.id])),
        injuredCards: (d.injuredCards || []).map((c) => c.id),
        synergy: d.synergy, personnel: d.personnel, front: d.front,
      })),
    };
  }

  function recMsg(rec) {
    const packed = packFrames(rec.frames);
    const { frames, ...rest } = rec;
    return { rec: { ...rest, packed }, transfer: [packed.data.buffer] };
  }

  return {
    handle(msg) {
      if (msg.type === 'new') {
        game = new Game(msg.away, msg.home, msg.seed, msg.options);
        sentPlayers = new Set();
        return [{ msg: { type: 'init', teams: game.teams, seed: game.seed, state: stateOf() } }];
      }
      if (!game) return [];
      if (msg.type === 'next') {
        const rec = game.next();
        if (!rec) return [{ msg: { type: 'final', state: stateOf() } }];
        const { rec: r, transfer } = recMsg(rec);
        return [{ msg: { type: 'rec', rec: r, state: stateOf() }, transfer }];
      }
      // Sim until only msg.secsLeft remain in regulation (e.g. 180 = 3:00 left in the 4th), or
      // with msg.quarter, through the end of the current quarter; then hand control back to
      // normal play-by-play.
      if (msg.type === 'simTo') {
        const out = [];
        let batch = [], transfer = [], last = null, rec;
        // (quarters roll over when the next play starts, so stop at 0:00 instead of overshooting
        // into the next quarter; if already at 0:00, finish the rollover)
        // The clock can also run out between plays, rolling into the next quarter and running a
        // play there in one step: near the end of the quarter keep a snapshot from before each
        // play, and if a play lands in the next quarter, stop at the snapshot and send that play
        // as a normal one to watch.
        const q0 = game.quarter, atZero = game.clock <= 0;
        const more = () => (msg.quarter ? game.quarter === q0 && (atZero || game.clock > 0) : secsLeft(game) > msg.secsLeft);
        let prev = null, held = null;
        while (!game.final && more()) {
          prev = msg.quarter && !atZero && game.clock <= 90 ? JSON.parse(JSON.stringify(stateOf(false))) : null;
          rec = game.next();
          if (!rec) break;
          if (prev && !game.final && game.quarter !== q0) { held = rec; break; }
          const m = recMsg(rec);
          batch.push(m.rec); transfer.push(...m.transfer); last = m.rec;
          if (batch.length >= 25) { out.push({ msg: { type: 'batch', recs: batch, progress: estimate(game) }, transfer }); batch = []; transfer = []; }
        }
        out.push({ msg: { type: 'batch', recs: batch, progress: 1 }, transfer });
        if (held) {
          for (const id in prev.players) sentPlayers.add(id);
          out.push({ msg: { type: 'simmed', state: prev, lastId: last?.id ?? null } });
          const m = recMsg(held);
          out.push({ msg: { type: 'rec', rec: m.rec, state: stateOf() }, transfer: m.transfer });
        } else out.push({ msg: game.final ? { type: 'final', state: stateOf() } : { type: 'simmed', state: stateOf(), lastId: last?.id ?? null } });
        return out;
      }
      if (msg.type === 'simToEnd') {
        const out = [];
        let batch = [], transfer = [], count = 0, rec;
        while ((rec = game.next())) {
          const m = recMsg(rec);
          batch.push(m.rec); transfer.push(...m.transfer); count++;
          if (batch.length >= 25) { out.push({ msg: { type: 'batch', recs: batch, progress: estimate(game) }, transfer }); batch = []; transfer = []; }
        }
        out.push({ msg: { type: 'batch', recs: batch, progress: 1 }, transfer });
        out.push({ msg: { type: 'final', state: stateOf() } });
        return out;
      }
      return [];
    },
  };
}

const secsLeft = (g) => (g.quarter >= 5 ? 0 : (4 - g.quarter) * 360 + g.clock);

function estimate(g) {
  const secs = g.quarter >= 5 ? 1440 : (g.quarter - 1) * 360 + (360 - g.clock);
  return Math.min(0.99, secs / 1440);
}
