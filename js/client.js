// Page-side mirror of the game (fed by the worker) + the worker connection.
import { createEngine, unpackFrames } from './engine.js';

const QUARTER_SECS = 360;

export class GameView {
  constructor(teams, seed) { this.teams = teams; this.seed = seed; this.players = {}; this.depth = []; this.log = []; }
  apply(state) {
    for (const id in state.players) this.players[id] = state.players[id];
    for (const id of state.injured || []) if (this.players[id]) this.players[id].injured = true;
    this.stats = state.stats; this.log = state.log; this.drives = state.drives; this.quarterScores = state.quarterScores;
    this.score = state.score; this.quarter = state.quarter; this.final = state.final; this.snap = state.snap;
    const P = this.players;
    this.depth = state.depth.map((d) => ({
      energy: d.energy, synergy: d.synergy, personnel: d.personnel, front: d.front,
      onField: Object.fromEntries(Object.entries(d.onField).map(([k, id]) => [k, P[id]])),
      cards: Object.fromEntries(Object.entries(d.cards).map(([k, id]) => [k, P[id]])),
      injuredCards: d.injuredCards.map((id) => P[id]),
      get QB() { return this.onField.QB; },
    }));
  }
  snapshot() { return this.snap; }
  dirFor(i) { const q = this.quarter; const d = q === 5 ? 1 : (q % 2 === 1 ? 1 : -1); return i === 0 ? d : -d; }
  yardText(ballOn, poss = this.snap?.poss ?? 0) {
    const b = Math.round(ballOn);
    if (b === 50) return 'the 50';
    return b < 50 ? `${this.teams[poss].abbr} ${b}` : `${this.teams[1 - poss].abbr} ${100 - b}`;
  }
  get secsLeft() { return this.quarter >= 5 ? this.snap.clock : (4 - this.quarter) * QUARTER_SECS + this.snap.clock; }
}

// Talks to the Web Worker; falls back to running the engine on the page if workers fail.
export class EngineClient {
  constructor(onMessage) {
    this.onMessage = onMessage;
    this.local = null;
    this.started = false;
    this.lastNew = null;
    try {
      this.w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
      this.w.onmessage = (e) => { this.started = true; onMessage(e.data); };
      this.w.onerror = (e) => { e.preventDefault?.(); if (!this.started) this.fallback(); else onMessage({ type: 'error', message: e.message }); };
    } catch { this.fallback(); }
  }
  fallback() {
    if (this.local) return;
    try { this.w?.terminate(); } catch { /* ignore */ }
    this.w = null;
    this.local = createEngine();
    this.mode = 'page';
    if (this.lastNew) this.send(this.lastNew);
  }
  send(msg) {
    if (msg.type === 'new') this.lastNew = msg;
    if (this.w) { this.w.postMessage(msg); return; }
    setTimeout(() => { for (const r of this.local.handle(msg)) this.onMessage(r.msg); }, 0);
  }
  terminate() { try { this.w?.terminate(); } catch { /* ignore */ } this.w = null; this.onMessage = () => {}; }
}

export const recFrames = (rec) => rec.frames || (rec.frames = unpackFrames(rec.packed));
