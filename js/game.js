// Game state machine: clock, downs, possession, scoring, special teams, stats.
// DOM-free so it can also run headless (see tools/sim-test.mjs).
import { RNG } from './rng.js';
import { TeamDepth } from './depth.js';
import { simulatePlay, simulateReturn, simulateFieldGoal } from './sim/playSim.js';
import { PLAYS, FORMATIONS, DEFENSES } from './playbook.js';
import { specialFrames } from './sim/special.js';
import { callOffense, callDefense, fourthDown, patDecision, familyOf, KNEEL, SPIKE } from './playcaller.js';

export const FIELD_W = 40;
export const QUARTER_SECS = 360;
const HASH_L = FIELD_W / 2 - 4, HASH_R = FIELD_W / 2 + 4;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const blankLine = () => ({
  pass: { cmp: 0, att: 0, yds: 0, td: 0, int: 0, sck: 0, sckY: 0, lng: 0 },
  rush: { car: 0, yds: 0, td: 0, lng: 0 },
  rec: { tgt: 0, rec: 0, yds: 0, td: 0, lng: 0, yac: 0 },
  def: { tkl: 0, ast: 0, sck: 0, tfl: 0, int: 0, pd: 0, ff: 0, fr: 0, td: 0 },
  kick: { fgm: 0, fga: 0, lng: 0, xpm: 0, xpa: 0 },
  punt: { n: 0, yds: 0, lng: 0, in20: 0 },
  ret: { kr: 0, kry: 0, pr: 0, pry: 0, td: 0 },
  brk: 0, fum: 0, snaps: 0,
});
const blankTeam = () => ({ first: 0, plays: 0, yds: 0, passYds: 0, rushYds: 0, to: 0, pen: 0, penY: 0, top: 0,
  third: [0, 0], fourth: [0, 0], sacked: 0, rz: [0, 0], twoPt: [0, 0] });

export class Game {
  constructor(away, home, seed = Date.now() % 1e9, options = {}) {
    this.options = { injuries: true, ...options };
    // Player mode: the team index a person controls (null = the AI coaches both sides). Their play
    // calls come from the page, and every play involving them runs live there: next() hands back an
    // { type: 'await' } record, and the game resumes on next() (after a call) or finishLive(res).
    this.human = options.human ?? null;
    this.seed = seed;
    this.rng = new RNG(seed);
    this.teams = [away, home];
    this.players = {};
    this.depth = this.teams.map((t) => new TeamDepth(t, this.players));
    this.teamOf = {};
    this.depth.forEach((d, i) => { for (const c of d.all()) this.teamOf[c.id] = i; });
    this.stats = { players: {}, teams: [blankTeam(), blankTeam()] };
    for (const id in this.players) this.stats.players[id] = blankLine();
    this.tendency = [{ plays: 0, pass: 0, deep: 0, scr: 0, scrYds: 0 }, { plays: 0, pass: 0, deep: 0, scr: 0, scrYds: 0 }];
    // in-game learning: yards per offensive play family / per defensive call, and the looks each defense shows
    this.callLog = [{ off: {}, def: {} }, { off: {}, def: {} }];
    this.dTend = [{ plays: 0, blitz: 0, man: 0 }, { plays: 0, blitz: 0, man: 0 }];
    this.kickTend = [{ n: 0, block: 0 }, { n: 0, block: 0 }]; // how often each team sends everyone after kicks
    this.recent = [{ runs: [], passes: [], recYds: {} }, { runs: [], passes: [], recYds: {} }];
    this.score = [0, 0];
    this.quarterScores = [[0, 0, 0, 0], [0, 0, 0, 0]];
    this.quarter = 1;
    this.clock = QUARTER_SECS;
    this.timeouts = [3, 3];
    this.clockRunning = false;
    this.poss = 0;
    this.ballOn = 25; this.ballY = FIELD_W / 2; this.down = 1; this.toGo = 10;
    this.log = [];
    this.notes = [];
    this.lastPlayId = null;
    this.drive = null;
    this.drives = [];
    this.final = false;
    // coin toss
    this.openingReceiver = this.rng.chance(0.5) ? 0 : 1;
    this.phase = 'kickoff';
    this.kicking = 1 - this.openingReceiver;
    this.kickFrom = 35;
    this.note(`${this.teams[this.openingReceiver].name} win the toss and will receive.`);
  }

  // absolute direction for team i in the current quarter (+1 = toward right end zone)
  dirFor(i) {
    const q = this.quarter;
    const d = q === 5 ? 1 : (q % 2 === 1 ? 1 : -1);
    return i === 0 ? d : -d;
  }

  note(text, kind = 'note') {
    const n = { q: this.quarter, clock: this.clock, text, kind };
    this.notes.push(n);
    this.log.push(n);
  }

  secsHalf() { return this.quarter === 1 || this.quarter === 3 ? this.clock + QUARTER_SECS : this.clock; }
  secsGame() { return this.quarter >= 4 ? this.clock : (4 - this.quarter) * QUARTER_SECS + this.clock; }

  situation(i = this.poss) {
    const diff = this.score[i] - this.score[1 - i];
    const q = this.quarter;
    const secsHalf = this.secsHalf(), secsGame = this.secsGame();
    const late = q >= 4;
    // the seconds that matter right now: to halftime in the 2nd quarter, to the end late in the game
    const secsLeft = q === 2 ? secsHalf : late ? secsGame : Infinity;
    // can a trailing team still catch up? (about one score per 75 seconds left, 8 points each)
    const reachable = diff >= -8 || -diff <= 8 * (1 + Math.floor(secsGame / 75));
    const twoMinute = (q === 2 && secsHalf <= 120) || (late && secsGame <= 150 && diff <= 0 && reachable) || (late && secsGame <= 330 && diff < -8 && reachable);
    const killClock = late && diff > 0 && secsGame <= 330;
    // a field goal is all we need (end of the half; tied or down 3 or less late; OT): if we're
    // comfortably in range and can bleed the clock with the downs left, run it down, then kick
    const K = this.depth[i].K;
    const fgOK = 100 - this.ballOn + 17 <= 41 + K.ratings.kpow * 0.15 - 4;
    const fgEnough = q === 2 || q === 5 || (q === 4 && diff <= 0 && diff >= -3);
    const drain = this.phase === 'scrimmage' && fgEnough && fgOK && secsLeft > 4 && secsLeft <= (4 - this.down) * 38 + 8;
    const milk = late && diff > 0 && secsGame <= 600 && !killClock; // ahead in the 4th: shorten the game
    const hurryLate = late && diff < 0 && reachable && secsGame <= 480 && !twoMinute;
    return {
      down: this.down, toGo: this.toGo, ballOn: this.ballOn, quarter: q, clock: this.clock,
      secsHalf, secsGame, secsLeft, diff, twoMinute, killClock, drain, milk, hurryLate, reachable,
      timeouts: this.timeouts[i], oppTimeouts: this.timeouts[1 - i],
      lastPlayId: this.lastPlayId, offQB: this.depth[i].QB, adjust: this.scouting(i),
      runShare: this.runShare(i),
      personnel: this.depth[i].personnel, front: this.depth[1 - i].front,
      contain: this.containFor(i),
    };
  }

  // How much the defense has to worry about this offense's QB taking off, 0..1: his legs get some
  // respect from the start, and every scramble that hurts them adds more (spy him, rush to contain).
  containFor(i) {
    const T = this.tendency[i], spd = this.depth[i].QB.ratings.spd;
    let c = clamp((spd - 75) / 40, 0, 0.35);
    if (T.scr >= 2) c += clamp((T.scrYds / T.scr - 3) / 6, 0, 1) * clamp(T.scr / 4, 0.5, 1);
    return clamp(c, 0, 1);
  }

  snapshot() {
    return {
      q: this.quarter, clock: this.clock, score: [...this.score], poss: this.poss, down: this.down, toGo: this.toGo,
      ballOn: this.ballOn, timeouts: [...this.timeouts], phase: this.phase, final: this.final,
      goal: this.ballOn + this.toGo >= 100,
    };
  }

  yardText(ballOn, poss = this.poss) {
    const b = Math.round(ballOn);
    if (b === 50) return 'the 50';
    return b < 50 ? `${this.teams[poss].abbr} ${b}` : `${this.teams[1 - poss].abbr} ${100 - b}`;
  }
  ddText() {
    const ord = ['1st', '2nd', '3rd', '4th'][this.down - 1];
    return `${ord} & ${this.ballOn + this.toGo >= 100 ? 'Goal' : Math.max(1, Math.round(this.toGo))}`;
  }

  // ------------------------------------------------------------------------
  // Advance one "snap" (any play). Returns a record for the UI, or null when final.
  next() {
    if (this.final) return null;
    if (this.pendingLive) return this.pendingLive.await; // still waiting for the live play
    if (!this.pending) {
      this.curRecId = (this.recSeq = (this.recSeq || 0) + 1);
      this.recBefore = this.snapshot();
      this.preSnapState = this.recBefore; // doScrimmage replaces this once the between-plays runoff is applied
    }
    let rec;
    if (this.phase === 'kickoff') rec = this.doKickoff();
    else if (this.phase === 'pat') rec = this.doPAT();
    else rec = this.doScrimmage();
    if (!rec) return this.next();
    if (rec.type === 'await') return rec;
    return this.finishRec(rec);
  }

  // Player mode: the live play the page just ran (finishPlay's result) -> the play's record.
  finishLive(res) {
    const L = this.pendingLive;
    this.pendingLive = null;
    const rec = this.afterScrimmagePlay(L.oc, L.dc, L.sit, L.args, res, false);
    if (L.goingForIt) rec.presnap.decision = `4th down: ${L.goingForIt}`;
    return this.finishRec(rec);
  }

  finishRec(rec) {
    rec.id = this.curRecId;
    rec.before = rec.before || this.preSnapState || this.recBefore;
    if (rec.type !== 'penalty' && rec.cast) this.applyFatigue(rec);
    rec.notes = [...(rec.notes || []), ...this.notes];
    this.notes = [];
    this.checkQuarterEnd(rec);
    rec.after = this.snapshot();
    rec.notes.push(...this.notes);
    this.notes = [];
    return rec;
  }

  // Energy: everyone who played drains by effort (distance run, blocks fought, trench work);
  // everyone else on both rosters rests. HP (stamina) scales both.
  applyFatigue(rec) {
    const involved = new Set();
    const frames = rec.frames;
    rec.cast.forEach((c, idx) => {
      const t = this.teamOf[c.pid];
      if (t == null) return;
      const card = this.players[c.pid];
      if (card.pos === 'K') { involved.add(c.pid); return; }
      let dist = 0, eng = 0;
      for (let f = 1; f < frames.length; f++) {
        const a = frames[f - 1].p[idx], b = frames[f].p[idx];
        dist += Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (b[2] === 1) eng++;
      }
      const trench = card.pos === 'OL' || card.pos === 'DL';
      this.depth[t].drain(card, 0.55 + dist * 0.083 + eng * 0.011 + (trench ? 0.7 : 0));
      if (rec.type === 'scrimmage') this.stats.players[c.pid].snaps++;
      involved.add(c.pid);
    });
    for (const d of this.depth) d.restExcept(involved, 2.4);
    if (this.options.injuries) this.rollInjuries(rec);
  }

  // Injuries: rare, weighted by exposure (tackled runners, sacked QBs, tacklers, blockers),
  // and more likely for low-HP or exhausted players.
  rollInjuries(rec) {
    const tackled = new Set(), tacklers = new Set(rec.tacklers || []);
    if (rec.carrierId) tackled.add(rec.carrierId);
    rec.cast.forEach((c, idx) => {
      const card = this.players[c.pid];
      const t = this.teamOf[c.pid];
      if (!card || t == null || card.injured || card.pos === 'K') return;
      const hit = tackled.has(c.pid) ? 0.0035 : tacklers.has(c.pid) ? 0.0015 : 0.00012;
      const hp = card.ratings.stm, e = this.depth[t].energy[c.pid];
      const p = hit * (1.6 - hp / 100) * (e < 60 ? 1.6 : 1);
      if (!this.rng.chance(p)) return;
      const { replacement } = this.depth[t].injure(card, this.players);
      if (replacement) {
        this.teamOf[replacement.id] = t;
        if (!this.stats.players[replacement.id]) this.stats.players[replacement.id] = blankLine();
      }
      const who = replacement ? (replacement.outOfPosition ? `${replacement.name} moves from ${replacement.outOfPosition} to ${replacement.pos}` : `${replacement.name} takes over`) : 'no healthy backup, so he stays in';
      this.note(`INJURY (${this.teams[t].abbr}): ${card.name} (${card.pos}) is out for the game — ${who}.`, 'injury');
    });
  }

  // In-game scouting of team i's offense: recent efficiency and the receiver doing damage.
  scouting(i) {
    const R = this.recent[i];
    const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
    const out = { ...this.tendency[i], runN: R.runs.length, passN: R.passes.length, runYpc: avg(R.runs), passYpa: avg(R.passes),
      offLog: this.callLog[i].off, defLog: this.callLog[1 - i].def, oppD: this.dTend[1 - i] };
    // hot receiver: 60+ yards and clearly ahead of teammates, currently on the field
    const onField = this.depth[i].onField;
    const slotOf = { WR: 'WR', FXO: 'FX', RB: 'RB' };
    let best = null, second = 0;
    for (const [key, slot] of Object.entries(slotOf)) {
      const c = onField[key]; const y = R.recYds[c.id] || 0;
      if (!best || y > best.y) { if (best) second = Math.max(second, best.y); best = { slot, y, name: c.name }; } else second = Math.max(second, y);
    }
    if (best && best.y >= 60 && best.y >= second * 1.6) { out.hotSlot = best.slot; out.hotName = best.name; }
    return out;
  }
  trackResult(i, res, yards) {
    const R = this.recent[i];
    if (res.kind === 'run' && !res.scramble) R.runs.push(yards);
    else if (res.kind === 'pass' || res.kind === 'sack' || res.kind === 'int') R.passes.push(res.kind === 'int' ? -10 : yards);
    if (R.runs.length > 12) R.runs.shift();
    if (R.passes.length > 12) R.passes.shift();
    if (res.completion && res.receiver) R.recYds[res.receiver] = (R.recYds[res.receiver] || 0) + yards;
  }

  checkQuarterEnd(rec) {
    if (this.final || this.phase === 'pat') return;
    if (this.clock > 0) return;
    this.clock = 0;
    const q = this.quarter;
    this.clockRunning = false;
    if (q === 1 || q === 3) {
      this.note(`End of the ${q === 1 ? '1st' : '3rd'} quarter.`, 'period');
      this.quarter++; this.clock = QUARTER_SECS;
      for (const d of this.depth) d.recoverAll(8);
    } else if (q === 2) {
      this.endDrive('End of half');
      this.note(`Halftime: ${this.scoreText()}`, 'period');
      this.quarter = 3; this.clock = QUARTER_SECS; this.timeouts = [3, 3];
      for (const d of this.depth) d.recoverAll(45);
      this.phase = 'kickoff'; this.kicking = this.openingReceiver; this.kickFrom = 35;
    } else if (q === 4 && this.score[0] === this.score[1]) {
      this.endDrive('End of regulation');
      this.note(`End of regulation — tied ${this.score[0]}-${this.score[1]}. Overtime!`, 'period');
      this.quarter = 5; this.clock = QUARTER_SECS; this.timeouts = [2, 2];
      for (const d of this.depth) d.recoverAll(20);
      const recv = this.rng.chance(0.5) ? 0 : 1;
      this.note(`${this.teams[recv].name} win the OT toss.`);
      this.phase = 'kickoff'; this.kicking = 1 - recv; this.kickFrom = 35;
    } else {
      this.endDrive(q === 5 ? 'End of overtime' : 'End of game');
      this.finish();
    }
  }

  finish() {
    this.final = true;
    this.phase = 'final';
    const [a, h] = this.score;
    const txt = a === h ? `Final: ${this.scoreText()} — it ends in a tie!` :
      `Final: ${this.teams[a > h ? 0 : 1].city} ${this.teams[a > h ? 0 : 1].name} win ${Math.max(a, h)}-${Math.min(a, h)}!`;
    this.note(txt, 'final');
  }

  scoreText() { return `${this.teams[0].abbr} ${this.score[0]}, ${this.teams[1].abbr} ${this.score[1]}`; }

  addScore(team, pts, text) {
    this.score[team] += pts;
    const qi = Math.min(this.quarter, 4) - 1;
    this.quarterScores[team][qi] += pts;
    if (this.quarter === 5) this.quarterScores[team].otPts = (this.quarterScores[team].otPts || 0) + pts;
  }

  // ------------------------------------------------------------------------
  // Clock between plays: runoff, timeouts, spikes, draining for a kick (two-minute warning in applyRunoff).
  preSnapClock(sit) {
    const i = this.poss, d = 1 - i, q = this.quarter;
    const coach = this.teams[i].coach;
    const TO = this.timeouts[i], left = sit.secsLeft;
    const r = (a, b) => this.rng.range(a, b);
    this.kickNow = false; this.wantSpike = false;
    if (!this.clockRunning) return;

    // trailing defense: stop the clock while the leader runs it out (or drains it for a kick)
    const lead = sit.diff;
    if (this.timeouts[d] > 0 && q >= 4 && sit.secsGame <= 200 && (sit.killClock || sit.drain) && lead >= 0 && lead <= 16) {
      this.useTimeout(d, r(1, 3)); return;
    }

    // a field goal is enough: bleed the clock, then use a timeout (or hurry the kicking unit on) and kick
    if (sit.drain) {
      const runoff = Math.min(37 + r(0, 2), left - 5);
      if (TO > 0 && left - runoff <= 7) {
        this.applyRunoff(Math.max(0, left - 3 - r(0, 2)));
        if (this.clockRunning) this.useTimeout(i, 0);
        this.kickNow = true; return;
      }
      if (TO === 0 && left <= 45) { this.applyRunoff(clamp(left - 4, 0, 12)); this.kickNow = true; return; }
      this.applyRunoff(Math.max(0, runoff)); return;
    }

    // two-minute offense: save timeouts until the clock is actually short; spike when out of them
    const needs = q === 2 ? (this.ballOn >= 25 || left > 45) : sit.diff <= 0 && sit.reachable;
    if (sit.twoMinute && needs && left > 3 && this.down < 4) { // (no timeout just to punt on 4th down)
      if (TO === 0 || (TO === 1 && this.down === 1 && left <= 45 && left > 15)) {
        // line up and spike it (keeping the last timeout when we can)
        if (left <= 45 && this.down < 3) { this.applyRunoff(5 + r(0, 3)); this.wantSpike = true; return; }
      } else if (left <= 30 + 20 * (TO - 1)) { this.useTimeout(i, r(1, 3)); return; }
    }

    let runoff;
    if (sit.killClock) runoff = 36 + r(0, 3);
    else if (sit.twoMinute) runoff = 9 + r(0, 5);
    else if (sit.hurryLate) runoff = 13 + r(0, 4);
    else {
      runoff = { hurry: 14, normal: 25, slow: 31 }[coach.tempo] + r(-4, 4);
      if (sit.milk) runoff = Math.max(runoff, 31 + r(0, 5));
    }
    if (this.oobRestart) runoff = Math.max(5, runoff - 14);
    this.applyRunoff(runoff);
  }

  applyRunoff(secs) {
    const q = this.quarter;
    const before = this.clock;
    let after = Math.max(0, before - secs);
    if ((q === 2 || q === 4) && before > 120 && after <= 120 && !this.twoMinWarned?.[q]) {
      after = 120;
      this.twoMinWarned = { ...(this.twoMinWarned || {}), [q]: true };
      this.clock = after;
      this.clockRunning = false;
      this.note('Two-minute warning.', 'period');
      return;
    }
    this.clock = after;
  }

  runPlayClock(dur) {
    const q = this.quarter;
    const before = this.clock;
    this.clock = Math.max(0, this.clock - dur);
    if ((q === 2 || q === 4) && before > 120 && this.clock <= 120 && !this.twoMinWarned?.[q]) {
      this.twoMinWarned = { ...(this.twoMinWarned || {}), [q]: true };
      this.pendingWarning = true;
    }
    this.stats.teams[this.poss].top += Math.min(dur, before);
  }

  useTimeout(team, runoff) {
    this.applyRunoff(runoff);
    for (const d of this.depth) d.recoverAll(3);
    this.timeouts[team]--;
    this.clockRunning = false;
    this.note(`Timeout, ${this.teams[team].name} (${this.timeouts[team]} left).`, 'timeout');
  }

  // ------------------------------------------------------------------------
  startDrive(team, how) {
    this.drive = { team, startOn: this.ballOn, startQ: this.quarter, startClock: this.clock, plays: 0, yds: 0, how };
  }
  endDrive(result) {
    const d = this.drive;
    if (!d) return;
    d.result = result;
    d.endQ = this.quarter; d.endClock = this.clock;
    this.drives.push(d);
    this.drive = null;
  }

  changePossession(newBallOn, how) {
    this.poss = 1 - this.poss;
    this.ballOn = clamp(newBallOn, 1, 99);
    this.ballY = FIELD_W / 2;
    this.down = 1;
    this.toGo = Math.min(10, 100 - this.ballOn);
    this.clockRunning = false;
    this.phase = 'scrimmage';
    this.startDrive(this.poss, how);
  }

  // ------------------------------------------------------------------------
  doScrimmage() {
    const i = this.poss, d = 1 - i;
    const team = this.teams[i], dteam = this.teams[d];
    if (this.pending) return this.resumeScrimmage();
    let sit = this.situation();
    this.preSnapClock(sit);
    if (this.clock <= 0) { this.clock = 0; this.checkQuarterEnd(); return null; }
    if (this.pendingWarning) { this.pendingWarning = false; this.note('Two-minute warning.', 'period'); }
    this.preSnapState = this.snapshot(); // the clock as the ball is snapped
    for (const n of this.depth[i].substitute('O')) this.note(`Sub (${team.abbr}): ${n}`, 'sub');
    for (const n of this.depth[d].substitute('D')) this.note(`Sub (${dteam.abbr}): ${n}`, 'sub');
    sit = this.situation();

    // clock-management specials
    const remDowns = 4 - this.down;
    const kneelable = sit.killClock && sit.secsGame <= (remDowns + 1) * 2 + Math.max(0, remDowns - sit.oppTimeouts) * 40;
    // end of the half with nowhere to go: take a knee
    const halfKneel = this.quarter === 2 && this.down < 4 &&
      ((sit.secsHalf <= 22 && this.ballOn < 55 && sit.diff >= 0) || (sit.secsHalf <= 30 && this.ballOn < 30));
    sit.kneel = (kneelable && this.down < 4) || halfKneel;
    sit.spike = !sit.kneel && this.wantSpike;
    // what the coach would do here (for the person's offense, it's only a suggestion)
    const K = this.depth[i].K;
    const fgDist = 100 - this.ballOn + 17;
    const inRange = fgDist <= 41 + K.ratings.kpow * 0.15;
    const needFGNow = inRange && sit.secsHalf <= 6 && (this.quarter === 2 || (sit.diff <= 0 && sit.diff >= -3) || this.quarter === 5);
    let special = sit.kneel ? { call: 'kneel', reason: 'Run out the clock' } : sit.spike ? { call: 'spike', reason: 'Stop the clock' }
      : this.kickNow && inRange ? { call: 'fg', reason: 'Clock drained, now kick it' } : needFGNow ? { call: 'fg', reason: 'Time for one last kick' } : null;
    if (!special && this.down === 4) {
      const dec = fourthDown(team, sit, K);
      special = dec.call === 'go' ? null : dec;
      if (dec.call === 'go') this.goingForIt = dec.reason;
    }
    if (this.human === i) {
      this.goingForIt = null;
      this.pending = { sit, coach: special, fgDist: Math.round(fgDist), inRange };
      return this.awaitCall('O');
    }
    if (special && this.human === d && (special.call === 'punt' || special.call === 'fg')) {
      this.pending = { sit, kick: special };
      return this.awaitKickCall();
    }
    if (special) return this.runSpecial(special, sit);

    // pre-snap penalties
    const pr = this.rng.next();
    if (pr < 0.012) {
      const who = this.rng.pick(this.depth[i].offense().filter((c) => c.pos !== 'QB'));
      if (!this.disciplined(who)) return this.preSnapPenalty('O', 'False start', who);
    } else if (pr < 0.022) {
      const who = this.rng.pick(this.depth[d].defense().filter((c) => c.pos !== 'DB'));
      if (!this.disciplined(who)) return this.preSnapPenalty('D', 'Offside', who);
    }

    if (this.human === d) { this.pending = { sit }; return this.awaitCall('D'); }

    // play calls
    const oc = callOffense(team, sit, this.rng);
    const dc = callDefense(dteam, sit, this.scouting(i), this.rng);
    return this.callsMade(oc, dc, sit);
  }

  callsMade(oc, dc, sit, swap = null, fake = false) {
    const goingForIt = this.goingForIt;
    this.goingForIt = null;
    const rec = this.runScrimmagePlay(oc, dc, sit, { swap, fake });
    if (rec.type === 'await') { this.pendingLive.goingForIt = goingForIt; return rec; }
    if (goingForIt) rec.presnap.decision = `4th down: ${goingForIt}`;
    return rec;
  }

  runSpecial(sp, sit) {
    if (sp.call === 'kneel') return this.doKneel(sit);
    if (sp.call === 'spike') return this.doSpike(sit);
    if (sp.call === 'fakePunt' || sp.call === 'fakeFG') {
      const kind = sp.call === 'fakePunt' ? 'punt' : 'fg';
      return this.doFake(kind, this.rng.chance(0.55) ? 'pass' : 'run', this.kickRushCall(1 - this.poss, kind), sp.reason);
    }
    if (sp.call === 'punt') return this.doPunt(sp.reason);
    return this.doFieldGoal(sp.reason);
  }

  // ---- player mode: the person's play call
  // What they can call: every play their personnel can run (plus punt / field goal / kneel /
  // spike on offense) or every defense, and what the coach would call.
  awaitCall(side) {
    const P = this.pending, i = this.poss, d = 1 - i, sit = P.sit;
    const menu = { side, dd: this.ddText(), spot: this.yardText(this.ballOn), quarter: this.quarter, clock: this.clock };
    if (side === 'O') {
      const pers = this.depth[i].personnel;
      menu.plays = PLAYS.filter((p) => p.forms[pers] && (!p.special || p.id === 'hailMary'))
        .map((p) => ({ id: p.id, name: p.name, family: familyOf(p), form: FORMATIONS[p.forms[pers]]?.name || '' }));
      menu.specials = [
        ...(this.down === 4 ? [{ call: 'punt', label: 'Punt' }] : []),
        ...(P.inRange ? [{ call: 'fg', label: `Field goal (${P.fgDist} yds)` }] : []),
        ...(this.down === 4 && this.ballOn >= 20 ? [{ call: 'fakePunt', label: 'Fake punt' }] : []),
        ...(this.down === 4 && P.inRange ? [{ call: 'fakeFG', label: 'Fake field goal' }] : []),
        { call: 'kneel', label: 'Kneel' },
        ...(this.clockRunning && this.down < 4 ? [{ call: 'spike', label: 'Spike' }] : []),
      ];
      const oc = P.coach ? null : callOffense(this.teams[i], sit, this.rng);
      P.coachOC = oc;
      menu.coach = P.coach ? { special: P.coach.call, label: { kneel: 'Kneel', spike: 'Spike', punt: 'Punt', fg: 'Field goal' }[P.coach.call], reason: P.coach.reason }
        : { play: oc.play.id, label: oc.play.name, reason: oc.reason };
    } else {
      menu.defs = DEFENSES.map((x) => ({ id: x.id, name: x.name, tags: x.tags }));
      const dc = callDefense(this.teams[d], sit, this.scouting(i), this.rng);
      P.coachDC = dc;
      menu.coach = { def: dc.dcall.id, label: dc.dcall.name, reason: dc.reason };
    }
    P.menu = menu;
    return { type: 'await', need: 'call', menu };
  }

  // The person's defense, facing a punt or field goal: send everyone, or play it safe.
  awaitKickCall() {
    const P = this.pending, kind = P.kick.call, d = 1 - this.poss;
    const coach = this.aiKickCall(d, kind);
    P.coachKick = coach;
    const safe = kind === 'punt' ? 'return' : 'safe';
    const label = (c) => (c === 'block' ? (kind === 'punt' ? 'Punt block (all-out)' : 'FG block (all-out)') : kind === 'punt' ? 'Punt return' : 'Safe (watch for a fake)');
    P.menu = {
      side: 'D', kick: kind, dd: this.ddText(), spot: this.yardText(this.ballOn), quarter: this.quarter, clock: this.clock,
      title: kind === 'punt' ? 'They\'re punting' : `${100 - this.ballOn + 17}-yard field goal try`,
      kicks: [{ call: safe, label: label(safe) }, { call: 'block', label: label('block') }],
      coach: { kick: coach, label: label(coach), reason: coach === 'block' ? 'Go get it' : 'Don\'t give them a fake' },
    };
    return { type: 'await', need: 'call', menu: P.menu };
  }

  // After the person's call (this.humanCall), or with nobody to ask any more (a sim took over).
  resumeScrimmage() {
    const P = this.pending, i = this.poss, d = 1 - i, sit = P.sit;
    const H = this.humanCall || {};
    this.pending = null; this.humanCall = null;
    if (P.kick) { this.kickCall = H.kick || P.coachKick || null; return this.runSpecial(P.kick, sit); }
    if (P.menu?.side === 'O') {
      const pick = H.special ? { call: H.special, reason: 'Your call' } : H.play ? null : P.coach;
      if (pick) return this.runSpecial(pick, sit);
      const oc = H.play && PLAY_BY_ID[H.play] ? { play: PLAY_BY_ID[H.play], reason: 'Your call' } : (P.coachOC || callOffense(this.teams[i], sit, this.rng));
      const dc = callDefense(this.teams[d], sit, this.scouting(i), this.rng);
      return this.callsMade(oc, dc, sit);
    }
    if (P.coach && !P.menu) return this.runSpecial(P.coach, sit); // offense call skipped by a sim
    const oc = callOffense(this.teams[i], sit, this.rng);
    const dc = H.def && DEF_BY_ID[H.def] ? { dcall: DEF_BY_ID[H.def], reason: 'Your call' } : (P.coachDC || callDefense(this.teams[d], sit, this.scouting(i), this.rng));
    return this.callsMade(oc, dc, sit);
  }

  simArgs(i, play, dcall, sit, overrideBallOn) {
    const d = 1 - i;
    const ballOn = overrideBallOn ?? this.ballOn;
    const pers = this.depth[i].personnel;
    // Dragon (Outrage): big moments — 3rd/4th down, red zone, one-score 4th quarter or OT
    const clutch = this.down >= 3 || ballOn >= 80 || (this.quarter >= 4 && Math.abs(this.score[0] - this.score[1]) <= 8);
    let flip = this.ballY <= FIELD_W / 2 ? 1 : -1;
    if (this.rng.chance(0.25)) flip = -flip;
    return {
      rng: this.rng, W: FIELD_W, los: ballOn, ballY: this.ballY, flip,
      offense: { slots: this.depth[i].simOffense({ clutch, quarter: this.quarter }), personnel: pers },
      defense: { slots: this.depth[d].simDefense({ clutch, quarter: this.quarter }) },
      play, dcall, form: play.forms[pers],
      situation: {
        aggression: this.teams[i].coach.aggression, deepBias: this.teams[i].coach.deepRate - 0.5,
        down: this.down, toGo: this.toGo,
        desperate: sit.secsGame <= 20 && sit.diff < 0 && this.quarter >= 4,
        wantOOB: sit.twoMinute && (this.quarter === 2 || sit.diff <= 0),
        protect: sit.killClock || sit.drain, // stay in bounds, keep the clock running
        runRespect: this.runRespect(i, sit),
        contain: sit.contain ?? this.containFor(i),
        passExpect: this.passExpect(i, sit),
      },
    };
  }

  // How much the defense has to respect the run, 0..~1.1: play action only fools them if this
  // offense actually runs (this game, or its coach's tendency early on), and not on obvious passing downs.
  runShare(i) {
    const T = this.tendency[i];
    return T.plays >= 6 ? 1 - T.pass / T.plays : 1 - this.teams[i].coach.passRate;
  }
  runRespect(i, sit) {
    let r = clamp((this.runShare(i) - 0.12) / 0.33, 0, 1.1);
    if (this.down >= 3 && this.toGo >= 6) r *= 0.35;
    else if (this.down === 2 && this.toGo >= 9) r *= 0.75;
    if (sit.twoMinute) r *= 0.3;
    return r;
  }

  // How sure the defense is that a pass is coming, 0..1: this offense's pass rate, plus the situation.
  passExpect(i, sit) {
    let p = 1 - this.runShare(i);
    if (this.down >= 3 && this.toGo >= 6) p += 0.25;
    if (sit.twoMinute) p += 0.25;
    if (this.toGo <= 2) p -= 0.2;
    return clamp(p, 0, 1);
  }

  // QB audible: read the defense's look (blitz, loaded box, soft shell) and check out.
  audible(i, oc, dc, sit) {
    const qb = this.depth[i].QB;
    const vision = qb.ratings.awr;
    const pers = this.depth[i].personnel;
    const call = dc.dcall;
    const blitzLook = call.tags.includes('blitz');
    const softLook = call.id === 'prevent' || call.id === 'c4' || call.id === 'cloud';
    const pickPlay = (ids) => { const opts = PLAYS.filter((p) => ids.includes(p.id) && p.forms[pers]); return opts.length ? this.rng.pick(opts) : null; };
    if (sit.kneel || sit.spike || oc.play.special) return null;
    // run into a loaded box -> quick throw
    if (oc.play.type === 'run' && (call.id === 'runBlitz' || call.id === 'c0') && sit.toGo > 2 && this.rng.chance(vision / 140)) {
      const p = pickPlay(['slants', 'quickOuts', 'hitchSeam', 'stick']);
      if (p) return { play: p, why: `${qb.name} sees the loaded box and checks to ${p.name}` };
    }
    // pass vs the blitz -> hot/quick game
    // a defense that's been blitzing all game has the QB primed to check out of it
    const DT = this.dTend[1 - i], blitzy = DT.plays >= 6 ? DT.blitz / DT.plays : 0;
    if (oc.play.type === 'pass' && blitzLook && oc.play.drop !== 'quick' && this.rng.chance((vision / 170) * (1 + blitzy * 1.6))) {
      const p = pickPlay(['slants', 'quickOuts', 'stick', 'rbScreen']);
      if (p) return { play: p, why: `${qb.name} spots the blitz and checks to ${p.name}` };
    }
    // pass vs a soft shell on short yardage -> run it
    if (oc.play.type === 'pass' && softLook && sit.toGo <= 4 && !sit.twoMinute && this.rng.chance(vision / 180)) {
      const p = pickPlay(['insideZone', 'gunZone', 'power', 'iso']);
      if (p) return { play: p, why: `${qb.name} sees a light box and checks to ${p.name}` };
    }
    return null;
  }

  runScrimmagePlay(oc, dc, sit, { twoPoint = false, swap = null, fake = false } = {}) {
    const i = this.poss, d = 1 - i;
    const aud = this.human === i ? null : this.audible(i, oc, dc, sit); // the person calls their own plays
    if (aud) oc = { ...oc, play: aud.play, audible: aud.why };
    const args = this.simArgs(i, oc.play, dc.dcall, sit);
    // fakes: the punter / kicker / up-back take over slots (their own card ratings, no synergy)
    args.situation.fake = fake; // the defense lined up for a kick: slow to realize
    if (swap) args.offense.slots = args.offense.slots.map((sl) => (swap[sl.slot] ? { slot: sl.slot, player: swap[sl.slot], ratings: swap[sl.slot].ratings, mods: {} } : sl));
    // pre-snap motion on some pass plays when the FLEX is split out
    const fxAlign = FORMATIONS[args.form]?.align.FX;
    args.motion = oc.play.type === 'pass' && !oc.play.special && fxAlign && Math.abs(fxAlign[1]) > 4 && this.rng.chance(0.3);
    if (!twoPoint && this.human != null && (this.human === i || this.human === d)) {
      args.human = { side: this.human === i ? 'O' : 'D' };
      args.motion = false; // (motion plays out before the snap; live, there's no "before")
      const await_ = {
        type: 'await', need: 'live', args,
        rec: { type: 'scrimmage', frameTeam: i, dir: this.dirFor(i), W: FIELD_W, losX: this.ballOn, fdX: Math.min(this.ballOn + this.toGo, 100),
          presnap: this.presnapInfo(oc, dc, i, d, twoPoint, args.form) },
      };
      this.pendingLive = { oc, dc, sit, args, await: await_ };
      return await_;
    }
    const res = simulatePlay(args);
    return this.afterScrimmagePlay(oc, dc, sit, args, res, twoPoint);
  }

  presnapInfo(oc, dc, i, d, twoPoint, form) {
    return {
      dd: twoPoint ? 'Two-point try' : this.ddText(), spot: this.yardText(this.ballOn), offCall: `${oc.play.name}`, form,
      defCall: dc.dcall.name, offReason: oc.reason, defReason: dc.reason, offTeam: i, audible: oc.audible || null,
      syn: { off: { ...this.depth[i].synergy.O.active }, def: { ...this.depth[d].synergy.D.active } },
    };
  }

  afterScrimmagePlay(oc, dc, sit, args, res, twoPoint) {
    const i = this.poss, d = 1 - i;
    // Poison: extra energy lost from contact with Poison types
    for (const pid in res.toxic) { const t = this.teamOf[pid]; if (t != null) this.depth[t].drain(this.players[pid], res.toxic[pid]); }
    if (this.onPlay) this.onPlay({ oc, dc, res, sit });
    const los = this.ballOn;
    const dd = this.ddText();
    const rec = {
      type: 'scrimmage', frames: res.frames, cast: res.cast, frameTeam: i, dir: this.dirFor(i), W: FIELD_W,
      tacklers: res.tacklers, carrierId: res.tacklers?.length ? (res.kind === 'sack' ? res.cast.find((c) => c.side === 'O' && c.pos === 'QB')?.pid : (res.rusher || res.receiver || null)) : null,
      design: res.design, losX: los, fdX: Math.min(los + this.toGo, 100), events: res.events, motionT: res.motionT || 0,
      presnap: { ...this.presnapInfo(oc, dc, i, d, twoPoint, args.form), dd: twoPoint ? 'Two-point try' : dd },
    };
    this.lastPlayId = oc.play.id;
    this.tendency[i].plays++;
    if (oc.play.type === 'pass') this.tendency[i].pass++;
    if (oc.play.type === 'pass' && oc.play.depth === 'deep') this.tendency[i].deep++;
    if (res.scramble) { this.tendency[i].scr++; this.tendency[i].scrYds += res.turnover ? 0 : res.yards; }
    const DT = this.dTend[d];
    DT.plays++;
    if (dc.dcall.tags.includes('blitz')) DT.blitz++;
    if (dc.dcall.tags.includes('man')) DT.man++;
    if (twoPoint) return this.applyTwoPoint(res, rec);
    this.applyScrimmage(res, rec, sit);
    if (this.fakeLabel) {
      rec.text = `${this.fakeLabel} ${rec.text}`;
      const L = this.log[this.log.length - 1];
      if (L && L.recId === this.curRecId) L.text = rec.text;
      rec.highlight = rec.highlight || 'fake';
      this.fakeLabel = null;
    }
    if (rec.gain != null && !oc.play.special) {
      const y = res.turnover ? -25 : rec.gain;
      const fo = (this.callLog[i].off[familyOf(oc.play)] ||= { n: 0, yds: 0 }); fo.n++; fo.yds += y;
      const fd = (this.callLog[d].def[dc.dcall.id] ||= { n: 0, yds: 0 }); fd.n++; fd.yds += y;
    }
    return rec;
  }

  // ------------------------------------------------------------------------
  applyScrimmage(res, rec, sit) {
    const i = this.poss, d = 1 - i;
    const T = this.stats.teams[i];
    const los = this.ballOn;
    const P = (id) => this.players[id];
    const S = (id) => this.stats.players[id];
    const nm = (id) => P(id)?.name || '?';
    const downBefore = this.down;
    const fdLine = los + this.toGo;
    this.runPlayClock(res.duration);
    if (this.drive) this.drive.plays++;

    // --- post-play penalties
    const holder = this.rng.pick(this.depth[i].offense().filter((c) => c.pos === 'OL' || c.pos === 'TE'));
    const holding = !res.turnover && !res.td && res.yards > 3 && (res.kind === 'run' || res.completion) && this.rng.chance(0.028) && !this.disciplined(holder);
    if (res.penalty?.type === 'DPI' || holding) {
      let text;
      if (holding) {
        const off = holder;
        const yds = Math.min(10, Math.floor(los / 2));
        this.ballOn = los - yds; this.toGo += yds;
        T.pen++; T.penY += yds;
        text = `PENALTY: Holding on ${off.name} (${team(this, i)}), ${yds} yards. Replay ${this.ddText()}.`;
      } else {
        const spot = Math.round(clamp(res.penalty.spot, los + 1, 99));
        const yds = spot - los;
        this.stats.teams[d].pen++; this.stats.teams[d].penY += yds;
        this.ballOn = spot >= 100 ? 99 : spot;
        this.down = 1; this.toGo = Math.min(10, 100 - this.ballOn);
        T.first++;
        text = `PENALTY: Pass interference on ${nm(res.penalty.player)} (${team(this, d)}), ${yds} yards — automatic first down.`;
      }
      this.clockRunning = false;
      rec.text = text; rec.highlight = 'flag';
      this.pushLog(rec, text, i);
      return;
    }

    // --- stats from the sim (tackles, PDs, forced fumbles...)
    for (const s of res.stats) {
      const L = S(s.pid); if (!L) continue;
      if (s.stat === 'tkl') L.def.tkl++;
      else if (s.stat === 'ast') L.def.ast++;
      else if (s.stat === 'pd') L.def.pd++;
      else if (s.stat === 'ff') L.def.ff++;
      else if (s.stat === 'fr') L.def.fr++;
      else if (s.stat === 'fum') L.fum++;
      else if (s.stat === 'brk') L.brk++;
    }

    const endSpot = Math.round(clamp(res.endX, -10, 110));
    let yards = clamp(endSpot, 0, 100) - los;
    if (res.td) yards = 100 - los;
    const tk = res.tacklers.length ? ` (${res.tacklers.map(nm).join(', ')})` : '';
    const dir = (y) => (y < this.ballY - 4 ? 'left' : y > this.ballY + 4 ? 'right' : 'middle');
    const last = res.frames[res.frames.length - 1];
    const carrierIdx = last.b[3];
    const endY = carrierIdx >= 0 ? last.p[carrierIdx][1] : last.b[1];
    let text = '';
    T.plays++;

    if (res.kind === 'pass' || res.kind === 'int') {
      const passer = res.passer, tgt = res.target;
      if (passer) { S(passer).pass.att++; }
      if (tgt) S(tgt).rec.tgt++;
      const air = res.airYards ?? 0;
      const depth = air >= 15 ? 'deep' : 'short';
      const catchY = res.frames[res.frames.length - 1].b[1];
      if (res.completion && !res.fumble) {
        S(passer).pass.cmp++; S(passer).pass.yds += yards; S(passer).pass.lng = Math.max(S(passer).pass.lng, yards);
        const R = S(res.receiver).rec; R.rec++; R.yds += yards; R.lng = Math.max(R.lng, yards); R.yac += Math.round(res.yac || 0);
        T.passYds += yards; T.yds += yards;
        text = `${nm(passer)} pass ${depth} ${dir(catchY)} to ${nm(res.receiver)} for ${yardsText(yards)}${res.td ? '' : tk}.`;
        if (res.oob) text += ' Pushed out of bounds.';
        if (res.td) { S(passer).pass.td++; R.td++; }
      } else if (res.completion && res.fumble) {
        S(passer).pass.cmp++;
        const catchYds = yards;
        S(passer).pass.yds += catchYds; S(res.receiver).rec.rec++; S(res.receiver).rec.yds += catchYds;
        T.passYds += catchYds; T.yds += catchYds;
        text = `${nm(passer)} pass to ${nm(res.receiver)}... FUMBLE! Recovered by ${nm(res.recovered)}.`;
      } else if (res.kind === 'int') {
        S(passer).pass.int++;
        const L = S(res.interceptor).def; L.int++;
        text = `${nm(passer)} pass ${depth} ${dir(catchY)} intended for ${nm(tgt)} INTERCEPTED by ${nm(res.interceptor)}` +
          (res.defTD ? ' and returned for a TOUCHDOWN!' : res.touchback ? ' in the end zone. Touchback.' : `, returned ${Math.max(0, Math.round(res.returnYards))} yards${tk}.`);
      } else {
        yards = 0;
        if (res.throwAway) text = `${nm(passer)} throws it away under pressure.`;
        else if (res.batted) text = `${nm(passer)} pass batted down at the line.`;
        else text = `${nm(passer)} pass incomplete ${depth} ${dir(catchY)} intended for ${nm(tgt)}` +
          (res.pbu ? ` (broken up by ${nm(res.pbu)}).` : res.drop ? ' — dropped!' : res.miss ? ` — ${res.miss}.` : '.');
      }
    } else if (res.kind === 'sack') {
      const qb = res.cast.find((c) => c.side === 'O' && c.pos === 'QB').pid;
      S(qb).pass.sck++; S(qb).pass.sckY += -yards; T.sacked++;
      T.yds += yards; T.passYds += yards;
      if (res.sack) { S(res.sack).def.sck++; S(res.sack).def.tfl++; }
      text = res.fumble ? `${nm(qb)} strip-sacked by ${nm(res.sack)}! Recovered by ${nm(res.recovered)}.`
        : `${nm(qb)} sacked by ${nm(res.sack)} for ${yardsText(yards)}.`;
    } else {
      const rusher = res.rusher || res.fumble;
      const L = S(rusher).rush; L.car++; L.yds += yards; L.lng = Math.max(L.lng, yards);
      T.rushYds += yards; T.yds += yards;
      if (yards < 0) for (const t0 of res.tacklers.slice(0, 1)) S(t0).def.tfl++;
      const how = res.scramble ? `scrambles ${dir(endY)}` : runDir(endY, this.ballY);
      text = res.fumble ? `${nm(rusher)} ${how}... FUMBLE! Recovered by ${nm(res.recovered)}.` : `${nm(rusher)} ${how} for ${yardsText(yards)}${res.td ? '' : tk}.`;
      if (res.oob && !res.td) text += ' Out of bounds.';
      if (res.slide) text += ' Slides down.';
      if (res.td) L.td++;
    }
    if (res.brokenTackles >= 2) text += ` (${res.brokenTackles} broken tackles!)`;
    this.trackResult(i, res, yards);
    if (this.drive) this.drive.yds += res.turnover ? 0 : yards;

    if (downBefore === 3) T.third[1]++;
    if (downBefore === 4) T.fourth[1]++;
    if (los >= 80 && !this.drive?.rz) { if (this.drive) this.drive.rz = true; T.rz[1]++; }

    // --- outcomes
    this.oobRestart = false;
    if (res.defTD || (res.turnover && res.endX <= 0 && res.kind !== 'int')) {
      T.to++;
      this.stats.players[res.interceptor || res.recovered].def.td++;
      this.endDrive(res.kind === 'int' ? 'Interception' : 'Fumble');
      this.poss = d;
      this.addScore(d, 6);
      text += ` ${this.teams[d].name.toUpperCase()} TOUCHDOWN!`;
      rec.highlight = 'td';
      this.clockRunning = false;
      this.phase = 'pat'; this.patTeam = d;
    } else if (res.turnover) {
      T.to++;
      this.endDrive(res.kind === 'int' ? 'Interception' : 'Fumble');
      const newOn = res.touchback ? 20 : 100 - clamp(endSpot, 1, 99);
      this.changePossession(newOn, res.kind === 'int' ? 'INT' : 'Fumble');
      rec.highlight = res.kind === 'int' ? 'int' : 'fumble';
    } else if (res.td) {
      if (downBefore === 3) T.third[0]++;
      if (downBefore === 4) T.fourth[0]++;
      if (this.drive?.rz) T.rz[0]++;
      T.first++;
      this.addScore(i, 6);
      text += ` TOUCHDOWN ${this.teams[i].name.toUpperCase()}!`;
      rec.highlight = 'td';
      this.endDrive('Touchdown');
      this.clockRunning = false;
      this.phase = 'pat'; this.patTeam = i;
    } else if (res.safety) {
      this.addScore(d, 2);
      text += ` SAFETY! ${this.teams[d].name} get 2 points.`;
      rec.highlight = 'safety';
      this.endDrive('Safety');
      this.clockRunning = false;
      this.phase = 'kickoff'; this.kicking = i; this.kickFrom = 20;
      if (this.quarter === 5) this.finish();
    } else {
      this.ballOn = clamp(endSpot, 1, 99);
      if (!res.incomplete) this.ballY = clamp(endY, HASH_L, HASH_R);
      if (this.ballOn >= fdLine) {
        if (downBefore === 3) T.third[0]++;
        if (downBefore === 4) T.fourth[0]++;
        T.first++;
        this.down = 1; this.toGo = Math.min(10, 100 - this.ballOn);
        if (res.kind !== 'sack') rec.firstDown = true;
      } else {
        this.down++;
        this.toGo = fdLine - this.ballOn;
        if (this.down > 4) {
          text += ' Turnover on downs.';
          this.endDrive('Downs');
          this.changePossession(100 - this.ballOn, 'Downs');
          rec.highlight = 'downs';
        }
      }
      if (this.phase === 'scrimmage' && this.poss === i) {
        const lateWindow = (this.quarter === 2 && this.clock <= 120) || (this.quarter >= 4 && this.clock <= 300);
        this.clockRunning = !(res.incomplete || (res.oob && lateWindow));
        if (res.oob && !lateWindow) this.oobRestart = true;
      }
    }
    rec.text = text;
    rec.gain = res.turnover ? 0 : yards;
    this.pushLog(rec, text, i);
  }

  pushLog(rec, text, team) {
    const at = rec.before || this.preSnapState;
    this.log.push({ q: at?.q ?? this.quarter, clock: at?.clock ?? this.clock, team, dd: rec.presnap?.dd, spot: rec.presnap?.spot, text, highlight: rec.highlight, score: [...this.score], recId: this.curRecId });
  }

  quarterEndRecord() {
    return null; // checkQuarterEnd handles it in next()
  }

  // Grass (discipline): chance the would-be offender keeps his composure
  disciplined(card) {
    const L = this.depth[this.teamOf[card.id]]?.live[card.id];
    return !!(L?.discipline && this.rng.chance(L.discipline));
  }

  preSnapPenalty(side, name, who) {
    const i = this.poss, d = 1 - i;
    const sit = this.situation();
    // show the formation briefly
    const oc = callOffense(this.teams[i], sit, this.rng);
    const dc = callDefense(this.teams[d], sit, this.tendency[i], this.rng);
    const args = this.simArgs(i, oc.play, dc.dcall, sit);
    const res = simulatePlay(args);
    const frames = res.frames.slice(0, 1);
    for (let k = 0; k < 20; k++) frames.push({ ...frames[0], t: (k + 1) * 0.05 });
    let text;
    if (side === 'O') {
      const yds = Math.min(5, Math.floor(this.ballOn / 2));
      this.ballOn -= yds; this.toGo += yds;
      this.stats.teams[i].pen++; this.stats.teams[i].penY += yds;
      text = `PENALTY: ${name}, ${who.name} (${team(this, i)}), ${yds} yards. ${this.ddText()}.`;
    } else {
      const yds = Math.min(5, Math.floor((100 - this.ballOn) / 2));
      this.ballOn += yds; this.toGo -= yds;
      this.stats.teams[d].pen++; this.stats.teams[d].penY += yds;
      if (this.toGo <= 0) { this.down = 1; this.toGo = Math.min(10, 100 - this.ballOn); this.stats.teams[i].first++; }
      text = `PENALTY: ${name}, ${who.name} (${team(this, d)}), ${yds} yards. ${this.ddText()}.`;
    }
    this.clockRunning = false;
    const rec = {
      type: 'penalty', frames, cast: res.cast, frameTeam: i, dir: this.dirFor(i), W: FIELD_W, design: res.design,
      losX: args.los, fdX: Math.min(args.los + sit.toGo, 100), events: [], highlight: 'flag', text,
      presnap: { dd: this.situationDD(sit), spot: this.yardText(args.los), offCall: oc.play.name, defCall: dc.dcall.name, offReason: oc.reason, defReason: dc.reason, offTeam: i },
    };
    this.pushLog(rec, text, i);
    return rec;
  }

  situationDD(sit) {
    const ord = ['1st', '2nd', '3rd', '4th'][sit.down - 1];
    return `${ord} & ${sit.ballOn + sit.toGo >= 100 ? 'Goal' : Math.max(1, Math.round(sit.toGo))}`;
  }

  staticFrames(i, n, mutate) {
    // a formation snapshot used for kneels/spikes
    const sit = this.situation();
    const args = this.simArgs(i, FORMATION_ONLY, DEF_C1, sit);
    const res = simulatePlay(args);
    const f0 = res.frames[0];
    const frames = [];
    for (let k = 0; k < n; k++) {
      const fr = { t: k * 0.05, p: f0.p.map((p) => [...p]), b: [...f0.b], read: -1 };
      mutate?.(fr, k / n, res);
      frames.push(fr);
    }
    return { frames, cast: res.cast, design: { routes: [], zones: [], rush: [] }, los: args.los };
  }

  doKneel(sit) {
    const i = this.poss;
    const st = this.staticFrames(i, 40, (fr, s) => {
      const qb = fr.p[0];
      qb[0] = this.ballOn - 0.8 - Math.min(s, 0.3) * 3;
      fr.b = [qb[0], qb[1], 0.6, 0];
    });
    this.runPlayClock(2);
    const qb = this.depth[i].QB;
    this.stats.players[qb.id].rush.car++; this.stats.players[qb.id].rush.yds -= 1;
    this.stats.teams[i].rushYds -= 1; this.stats.teams[i].yds -= 1; this.stats.teams[i].plays++;
    const dd = this.ddText();
    const los = this.ballOn;
    this.ballOn = Math.max(1, this.ballOn - 1);
    this.down++; this.toGo += 1;
    this.clockRunning = true;
    const text = `${qb.name} kneels.`;
    const rec = { type: 'kneel', ...st, frameTeam: i, dir: this.dirFor(i), W: FIELD_W, losX: los, fdX: Math.min(los + sit.toGo, 100), events: [], text,
      presnap: { dd, spot: this.yardText(los), offCall: KNEEL.name, defCall: '—', offReason: 'Victory formation — run out the clock', defReason: '', offTeam: i } };
    if (this.down > 4) { this.endDrive('Downs'); this.changePossession(100 - this.ballOn, 'Downs'); }
    this.pushLog(rec, text, i);
    return rec;
  }

  doSpike(sit) {
    const i = this.poss;
    const st = this.staticFrames(i, 26, (fr, s) => {
      const qb = fr.p[0];
      qb[0] = this.ballOn - 1;
      fr.b = s < 0.4 ? [qb[0], qb[1], 1, 0] : [qb[0] + 0.8, qb[1], 0.2, -1];
    });
    this.runPlayClock(1);
    const qb = this.depth[i].QB;
    this.stats.players[qb.id].pass.att++;
    const dd = this.ddText();
    const los = this.ballOn;
    this.down++;
    this.clockRunning = false;
    const text = `${qb.name} spikes the ball to stop the clock.`;
    const rec = { type: 'spike', ...st, frameTeam: i, dir: this.dirFor(i), W: FIELD_W, losX: los, fdX: Math.min(los + sit.toGo, 100), events: [], text,
      presnap: { dd, spot: this.yardText(los), offCall: SPIKE.name, defCall: '—', offReason: this.timeouts[i] ? 'Stop the clock and save the last timeout' : 'No timeouts left — stop the clock', defReason: '', offTeam: i } };
    this.pushLog(rec, text, i);
    return rec;
  }

  // ------------------------------------------------------------------------
  // Special teams
  returnerFor(t, kinds) {
    const D = this.depth[t];
    return [...D.offense(), ...D.defense()].filter((c) => kinds.includes(c.pos)).sort((a, b) => b.ratings.spd - a.ratings.spd)[0];
  }

  // players for a return: card ratings, no synergy mods (special teams units mix positions)
  stUnit(cards) { return cards.map((c) => ({ player: c, ratings: c.ratings, mods: {} })); }

  // Run a simulated return (receiving team's frame). Returns the sim result.
  runReturn(kind, kickerTeam, kickers, receivers, { kickX, kickY, landX, landY, hang, ...more }) {
    return simulateReturn({ rng: this.rng, W: FIELD_W, kind, kickX, kickY, landX, landY, hang, ...more,
      receivers: this.stUnit(receivers), coverage: this.stUnit(kickers) });
  }

  // ---- kicks: the receiving side's rush call, and fakes
  // 'block' sends everyone after the kick (more blocks, but wide open for a fake); otherwise a
  // safe look ('return' on punts, 'safe' on field goals). The person picks their own.
  aiKickCall(d, kind) {
    const late = this.quarter >= 4 && this.score[d] < this.score[1 - d] && this.secsGame() < 300;
    let p = (kind === 'punt' ? 0.15 : 0.16) * (0.6 + this.teams[d].coach.aggression * 0.8);
    if (late) p = 0.6;
    return this.rng.chance(p) ? 'block' : kind === 'punt' ? 'return' : 'safe';
  }
  kickRushCall(d, kind) {
    const call = this.kickCall || this.aiKickCall(d, kind);
    this.kickCall = null;
    const T = this.kickTend[d];
    T.n++; if (call === 'block') T.block++;
    return call;
  }
  // Rare fakes, likelier when the other side has been sending everyone (or shows it now) and
  // it's short yardage; never on a kick that has to happen (end of the half, a must-make).
  aiFake(i, kind, rush, sit) {
    if (this.down !== 4 || this.human === i) return null;
    const T = this.kickTend[1 - i];
    let p = kind === 'punt' ? 0.012 : 0.01;
    if (T.n >= 2 && T.block / T.n >= 0.5) p *= 3;
    if (rush === 'block') p *= 2.5;
    if (this.toGo > 10) return null;
    p *= this.toGo <= 3 ? 2 : this.toGo >= 8 ? 0.35 : 1;
    if (kind === 'punt' && (this.ballOn < 25 || this.ballOn > 65)) return null;
    if (kind === 'fg' && (sit.secsHalf <= 15 || (this.quarter >= 4 && sit.diff <= 0 && sit.diff >= -3 && sit.secsGame < 150))) return null;
    if (this.quarter >= 4 && sit.diff > 0 && sit.secsGame < 300) p *= 0.3;
    p *= 0.6 + this.teams[i].coach.aggression * 0.8;
    return this.rng.chance(Math.min(p, 0.15)) ? (this.rng.chance(0.55) ? 'pass' : 'run') : null;
  }
  // A fake: a real play from the kicking formation, with the punter / holder / up-back in the slots.
  doFake(kind, variant, rush, reason) {
    const i = this.poss;
    const sit = this.situation();
    const K = this.depth[i].K, RB = this.depth[i].onField.RB;
    const id = kind === 'punt' ? (variant === 'pass' ? 'fakePuntPass' : 'fakePuntRun') : (variant === 'pass' ? 'fakeFGPass' : 'fakeFGRun');
    const swap = kind === 'punt' ? (variant === 'pass' ? { QB: K } : { QB: RB, RB: K }) : { RB: K };
    const dcall = DEF_BY_ID[rush === 'block' ? 'c0' : kind === 'punt' ? 'prevent' : 'c1'];
    this.fakeLabel = kind === 'punt' ? 'FAKE PUNT!' : 'FAKE FIELD GOAL!';
    const oc = { play: PLAY_BY_ID[id], reason: `${reason} (fake)` };
    const dc = { dcall, reason: rush === 'block' ? 'Sending everyone after the kick' : 'Setting up the return' };
    return this.callsMade(oc, dc, sit, swap, true);
  }

  creditReturnStats(res) {
    for (const st of res.stats) {
      const L = this.stats.players[st.pid]; if (!L) continue;
      if (st.stat === 'tkl') L.def.tkl++; else if (st.stat === 'ast') L.def.ast++;
      else if (st.stat === 'ff') L.def.ff++; else if (st.stat === 'fr') L.def.fr++;
      else if (st.stat === 'fum') L.fum++; else if (st.stat === 'brk') L.brk++;
    }
    for (const pid in res.toxic) { const t = this.teamOf[pid]; if (t != null) this.depth[t].drain(this.players[pid], res.toxic[pid]); }
  }

  doKickoff() {
    const k = this.kicking, r = 1 - k;
    const K = this.depth[k].K;
    const kl = this.depth[k], rl = this.depth[r];
    const kickX = this.kickFrom;
    const byCover = (a, b) => b.ratings.spd - a.ratings.spd;
    const kickers = [K, ...kl.defense().sort(byCover).slice(0, 6)];
    const retr = this.returnerFor(r, ['RB', 'WR', 'DB']);
    const receivers = [retr, ...[...rl.offense().filter((c) => c.pos !== 'QB' && c.pos !== 'OL'), ...rl.defense().filter((c) => c.pos !== 'DL')].filter((p) => p !== retr)].slice(0, 7);
    const sgm = this.situation(k);
    const onside = this.quarter >= 4 && sgm.diff < 0 && sgm.diff >= -16 && sgm.secsGame <= 150;
    const S = (id) => this.stats.players[id];
    const nm = (id) => this.players[id]?.name || '?';
    const landY = FIELD_W / 2 + this.rng.range(-6, 6);
    const presnap = { dd: onside ? 'Onside kick' : 'Kickoff', spot: this.yardText(kickX, k), offCall: onside ? 'Onside Kick' : 'Kickoff', defCall: onside ? 'Hands Team' : 'Kick Return', offReason: onside ? 'Need the ball back!' : '', defReason: '', offTeam: k };
    this.poss = k; // so changePossession flips to r

    // ---- onside kick (still a quick resolution)
    if (onside) {
      const landX = kickX + 11 + this.rng.range(0, 2);
      const good = this.rng.chance(0.12);
      const text = `${K.name} onside kick... ${good ? `RECOVERED by the ${this.teams[k].name}!` : `recovered by the ${this.teams[r].name}.`}`;
      const sf = specialFrames({ kind: 'kickoff', W: FIELD_W, kickX, kickY: FIELD_W / 2, landX, landY, hang: 1.2, returnEndX: null, kickers, receivers, returnerIdx: 0 });
      const rec = { type: 'kickoff', ...sf, frameTeam: k, dir: this.dirFor(k), W: FIELD_W, losX: kickX, fdX: null, design: null, events: [], text, presnap };
      if (good) { this.poss = r; this.changePossession(Math.round(landX), 'Onside'); rec.highlight = 'fumble'; }
      else this.changePossession(100 - Math.round(landX), 'Kickoff');
      this.pushLog(rec, text, k);
      return rec;
    }

    const dist = 58 + K.ratings.kpow * 0.12 + this.rng.gauss(0, 4);
    const landK = kickX + dist; // kicking frame
    const landR = 100 - landK; // receiving frame
    const hang = 3.6 + K.ratings.kpow * 0.01;
    // ---- touchback (deep kick, or returner kneels it)
    if (landR < -3.5 || (landR < 0 && this.rng.chance(0.8))) {
      const text = `${K.name} kicks ${Math.round(dist)} yards into the end zone. Touchback.`;
      const sf = specialFrames({ kind: 'kickoff', W: FIELD_W, kickX, kickY: FIELD_W / 2, landX: Math.min(landK, 108), landY, hang, returnEndX: null, kickers, receivers, returnerIdx: 0 });
      const rec = { type: 'kickoff', ...sf, frameTeam: k, dir: this.dirFor(k), W: FIELD_W, losX: kickX, fdX: null, design: null, events: [], text, presnap };
      this.changePossession(25, 'Kickoff');
      this.pushLog(rec, text, k);
      return rec;
    }
    // ---- simulated return (receiving team's frame)
    const res = this.runReturn('kickoff', k, kickers, receivers, { kickX: 100 - kickX, kickY: FIELD_W / 2, landX: Math.max(landR, -2), landY: FIELD_W - landY, hang });
    this.creditReturnStats(res);
    const start = Math.round(Math.max(res.catchX, -2));
    const end = Math.round(res.endX);
    let text;
    const rec = { type: 'kickoff', frames: res.frames, cast: res.cast, duration: res.duration, frameTeam: r, dir: this.dirFor(r), W: FIELD_W, losX: null, fdX: null, design: null, events: res.events, presnap, tacklers: res.tacklers, carrierId: res.tacklers.length ? retr.id : null };
    rec.retYds = res.td ? 100 - start : Math.max(0, end - start); // for the highlight reel
    this.runPlayClock(Math.max(1, res.duration - (res.catchT ?? hang)));
    if (res.fumble && res.recoveredBy === 'kicking') {
      text = `${K.name} kicks off... ${retr.name} FUMBLES the return! ${this.teams[k].name} recover at the ${this.yardText(100 - end, k)}!`;
      this.poss = r; this.changePossession(100 - clamp(end, 1, 99), 'Fumble');
      rec.highlight = 'fumble';
    } else if (res.td) {
      S(retr.id).ret.kr++; S(retr.id).ret.kry += 100 - start; S(retr.id).ret.td++;
      text = `${K.name} kicks off. ${retr.name} takes it back ${100 - start} yards for a TOUCHDOWN!`;
      this.poss = r; this.startDrive(r, 'Kickoff');
      this.addScore(r, 6); rec.highlight = 'td';
      this.endDrive('Kick return TD');
      this.phase = 'pat'; this.patTeam = r;
    } else {
      const spot = end <= 0 ? 20 : end; // tackled in the end zone = touchback-ish
      S(retr.id).ret.kr++; S(retr.id).ret.kry += Math.max(0, end - start);
      const tk = res.tacklers.length ? ` (${res.tacklers.map(nm).join(', ')})` : '';
      text = `${K.name} kicks ${Math.round(dist)} yards, returned by ${retr.name} ${Math.max(0, end - start)} yards to the ${this.yardText(spot, r)}${tk}.`;
      this.changePossession(spot, 'Kickoff');
    }
    rec.text = text;
    this.pushLog(rec, text, k);
    return rec;
  }

  doPunt(reason) {
    const i = this.poss, d = 1 - i;
    const K = this.depth[i].K;
    const los = this.ballOn;
    const S = (id) => this.stats.players[id];
    const nm = (id) => this.players[id]?.name || '?';
    const retr = this.returnerFor(d, ['DB', 'RB', 'WR']);
    const kickers = [K, ...this.depth[i].offense().filter((c) => c.pos !== 'QB')];
    const receivers = [retr, ...this.depth[d].defense().filter((p) => p !== retr)].slice(0, 7);
    const dd = this.ddText();
    const spot = this.yardText(los);
    const presnap = { dd, spot, offCall: 'Punt', defCall: 'Punt Return', offReason: reason, defReason: '', offTeam: i };
    const rush = this.kickRushCall(d, 'punt');
    presnap.defCall = rush === 'block' ? 'Punt Block (all-out)' : 'Punt Return';
    const fake = this.aiFake(i, 'punt', rush, this.situation());
    if (fake) return this.doFake('punt', fake, rush, reason);
    this.stats.teams[i].plays++;
    // Boom it, unless a full punt would carry into the end zone: then place it and pin them deep.
    // Accuracy and awareness decide how close to the goal line he can drop it (and how often).
    const full = 39 + K.ratings.kpow * 0.12;
    const toGoal = 100 - los;
    const touch = clamp((K.ratings.kacc * 0.7 + K.ratings.awr * 0.3 - 40) / 55, 0, 1);
    const pin = full + 4 > toGoal;
    const dist = pin ? Math.min(toGoal - (9 - touch * 4) + this.rng.gauss(0, 5.5 - touch * 3.5), full + 6) : full + this.rng.gauss(0, 5);
    const land = los + dist;
    const hang = pin ? 3.3 + dist * 0.02 + this.rng.gauss(0, 0.2) : 3.6 + K.ratings.kpow * 0.012 + this.rng.gauss(0, 0.3);
    const landY = clamp(this.ballY + this.rng.gauss(0, 6), pin ? 5 : 4, FIELD_W - (pin ? 5 : 4));
    if (pin) presnap.offReason = `${reason} (pinning them deep)`;
    this.endDrive('Punt');
    // ---- the snap, the rush and the kick, then the return (receiving team's frame);
    // blocked only if a rusher gets to the ball as it's punted
    const touchback = land >= 100;
    const res = this.runReturn('punt', i, kickers, receivers, { kickX: 100 - los, kickY: FIELD_W - this.ballY, landX: 100 - Math.min(land, 108), landY: FIELD_W - landY, hang, rushCall: rush, touchback });
    this.creditReturnStats(res);
    this.runPlayClock(Math.min(res.duration, 12));
    const rec = { type: 'punt', frames: res.frames, cast: res.cast, duration: res.duration, frameTeam: d, dir: this.dirFor(d), W: FIELD_W, losX: null, fdX: null, design: null, events: res.events, presnap, tacklers: res.tacklers, carrierId: res.tacklers.length ? retr.id : null };
    if (res.blocked) {
      // receiving team's frame: x >= 100 is the punting team's end zone
      const who = this.players[res.blockedBy]?.name || 'the rush';
      const at = res.endX;
      let text;
      rec.highlight = 'fumble';
      if (at >= 100 && res.recoveredBy === 'receiving') {
        text = `${K.name} punt is BLOCKED by ${who}! ${this.teams[d].name} fall on it in the end zone — TOUCHDOWN!`;
        this.poss = d; this.addScore(d, 6); rec.highlight = 'td';
        this.phase = 'pat'; this.patTeam = d;
      } else if (at >= 100) {
        text = `${K.name} punt is BLOCKED by ${who}! ${K.name} covers it in the end zone — SAFETY!`;
        this.addScore(d, 2); rec.highlight = 'safety';
        this.phase = 'kickoff'; this.kicking = i; this.kickFrom = 20; this.clockRunning = false;
      } else {
        const spotOn = clamp(Math.round(at), 1, 99);
        text = `${K.name} punt is BLOCKED by ${who}! ${this.teams[d].name} take over at the ${this.yardText(spotOn, d)}.`;
        this.changePossession(spotOn, 'Blocked punt');
      }
      rec.text = text;
      this.pushLog(rec, text, i);
      return rec;
    }
    const py = Math.round((touchback ? 100 : land) - los);
    S(K.id).punt.n++; S(K.id).punt.yds += py; S(K.id).punt.lng = Math.max(S(K.id).punt.lng, py);
    if (land >= 80 && !touchback) S(K.id).punt.in20++;
    if (res.touchback || touchback) {
      const text = `${K.name} punts ${py} yards into the end zone. Touchback.`;
      this.changePossession(20, 'Punt');
      rec.text = text;
      this.pushLog(rec, text, i);
      return rec;
    }
    const start = Math.round(res.catchX), end = Math.round(res.endX);
    rec.retYds = res.fairCatch ? 0 : res.td ? 100 - start : Math.max(0, end - start); // for the highlight reel
    let text;
    if (res.downed) {
      const spotOn = clamp(Math.round(res.catchX), 1, 99);
      text = `${K.name} punts ${100 - spotOn - los} yards. ${retr.name} lets it bounce, and it's downed at the ${this.yardText(spotOn, d)}.`;
      if (spotOn <= 20) S(K.id).punt.in20++;
      this.changePossession(spotOn, 'Punt');
    } else if (res.fairCatch) {
      text = `${K.name} punts ${py} yards. Fair catch by ${retr.name} at the ${this.yardText(start, d)}.`;
      this.changePossession(clamp(start, 1, 99), 'Punt');
    } else if (res.fumble && res.recoveredBy === 'kicking') {
      text = `${K.name} punts ${py} yards... MUFFED by ${retr.name}! ${this.teams[i].name} recover!`;
      this.ballOn = clamp(100 - end, 1, 99); this.down = 1; this.toGo = Math.min(10, 100 - this.ballOn); this.clockRunning = false;
      this.startDrive(i, 'Muffed punt'); rec.highlight = 'fumble';
    } else if (res.td) {
      S(retr.id).ret.pr++; S(retr.id).ret.pry += 100 - start; S(retr.id).ret.td++;
      text = `${K.name} punts ${py} yards. ${retr.name} returns it ${100 - start} yards for a TOUCHDOWN!`;
      this.poss = d; this.addScore(d, 6); rec.highlight = 'td';
      this.phase = 'pat'; this.patTeam = d;
    } else {
      S(retr.id).ret.pr++; S(retr.id).ret.pry += Math.max(0, end - start);
      const tk = res.tacklers.length ? ` (${res.tacklers.map(nm).join(', ')})` : '';
      text = `${K.name} punts ${py} yards, returned by ${retr.name} ${Math.max(0, end - start)} yards to the ${this.yardText(clamp(end, 1, 99), d)}${tk}.`;
      this.changePossession(clamp(end, 1, 99), 'Punt');
    }
    rec.text = text;
    this.pushLog(rec, text, i);
    return rec;
  }

  // pressure: 0..1 (kickPressure). Composure decides how much it bites: shaky kickers
  // miss up to ~1.8x as often on a pressure kick, ice-cold ones get slightly better.
  fgProb(K, dist, pressure = 0) {
    const acc = K.ratings.kacc, pow = K.ratings.kpow;
    const maxD = 41 + pow * 0.15;
    let p = 0.99 - Math.max(0, dist - 22) * 0.011 * (1.45 - acc / 100);
    if (dist > maxD - 6) p -= (dist - (maxD - 6)) * 0.06;
    p = clamp(p, 0.02, 0.99);
    if (pressure > 0) p = 1 - (1 - p) * (1 + pressure * (0.9 - K.ratings.comp / 100) * 1.5);
    return clamp(p, 0.02, 0.99);
  }

  // How much a kick matters: ramps up over the last 5 minutes of the 4th (always on in OT),
  // highest when the kick ties the game or takes the lead.
  kickPressure(i, pts) {
    if (this.quarter < 4) return 0;
    const late = this.quarter >= 5 ? 1 : clamp(1 - (this.clock - 30) / 270, 0, 1);
    const margin = this.score[i] - this.score[1 - i];
    const stakes = margin <= 0 && margin + pts >= 0 ? 1 // ties it or takes the lead
      : margin < 0 && margin >= -8 ? 0.5 // still need another score
      : margin > 0 && margin <= 8 ? 0.4 // padding a one-score lead
      : 0.1;
    return late * stakes;
  }

  doFieldGoal(reason, pat = false) {
    const i = pat ? this.patTeam : this.poss, d = 1 - i;
    const K = this.depth[i].K;
    const los = pat ? 85 : this.ballOn;
    const dist = 100 - los + 17;
    const pressure = this.kickPressure(i, pat ? 1 : 3);
    const p = this.fgProb(K, dist, pressure);
    // the defense's rush call; a 4th-down kick might be a fake
    const rush = pat ? (this.rng.chance(0.12) ? 'block' : 'safe') : this.kickRushCall(d, 'fg');
    const fake = pat ? null : this.aiFake(i, 'fg', rush, this.situation());
    if (fake) return this.doFake('fg', fake, rush, reason);
    // the snap, hold and kick, with a real rush: blocked only if someone gets there
    const kickGood = this.rng.chance(p);
    const S = this.stats.players[K.id];
    const dd = pat ? 'PAT' : this.ddText();
    const spot = this.yardText(los, i);
    let text;
    const miss = kickGood ? 0 : this.rng.chance(0.5) ? -1 : 1;
    const short = !kickGood && dist > 45 && this.rng.chance(0.4);
    const landY = kickGood ? FIELD_W / 2 + this.rng.range(-2, 2) : FIELD_W / 2 + miss * this.rng.range(3.6, 6);
    const landX = short ? 106 : 111;
    const off = this.depth[i].offense();
    const kickers = [off[0], K, ...off.filter((c) => c.pos === 'OL'), ...off.filter((c) => c.pos !== 'OL' && c.pos !== 'QB')].slice(0, 7);
    const receivers = this.depth[d].defense();
    const sf = simulateFieldGoal({ rng: this.rng, W: FIELD_W, kickX: los, kickY: this.ballY, kickers: this.stUnit(kickers), receivers: this.stUnit(receivers),
      rushCall: rush, landX, landY, hang: 0.9 + dist * 0.025 });
    const blocked = sf.blocked, good = kickGood && !blocked;
    const blocker = blocked ? this.players[sf.blockedBy]?.name : null;
    // a blocked kick the defense scoops up in the kicking team's end zone is six the other way
    const scoop = blocked && sf.recoveredBy === 'defense' && sf.recX != null && sf.recX <= 0;
    if (pat) {
      S.kick.xpa++;
      if (good) { S.kick.xpm++; this.addScore(i, 1); }
      text = good ? `${K.name} extra point is GOOD.` : blocked ? `${K.name} extra point is BLOCKED by ${blocker}!` : `${K.name} extra point is no good${miss < 0 ? ', wide left' : ', wide right'}.`;
    } else {
      S.kick.fga++;
      this.stats.teams[i].plays++;
      this.runPlayClock(Math.min(sf.duration, 5));
      if (good) {
        S.kick.fgm++; S.kick.lng = Math.max(S.kick.lng, dist);
        this.addScore(i, 3);
        text = `${K.name} ${dist}-yard field goal is GOOD!`;
      } else {
        text = `${K.name} ${dist}-yard field goal is ${blocked ? `BLOCKED by ${blocker}!` : short ? 'short' : `no good, wide ${miss < 0 ? 'left' : 'right'}`}${blocked ? '' : '.'}`;
        if (scoop) text += ` ${this.teams[d].name} scoop it up in the end zone — TOUCHDOWN!`;
      }
    }
    const rec = { type: pat ? 'pat' : 'fg', frames: sf.frames, cast: sf.cast, duration: sf.duration, frameTeam: i, dir: this.dirFor(i), W: FIELD_W, losX: los, fdX: null, design: null, events: sf.events, text,
      highlight: scoop ? 'td' : good && !pat ? 'fg' : (!good ? 'miss' : null),
      presnap: { dd, spot, offCall: pat ? 'Extra Point' : `${dist}-yd Field Goal`, defCall: rush === 'block' ? 'FG Block (all-out)' : 'FG Block (safe)', offReason: pat ? (pressure >= 0.5 ? `Pressure kick (composure ${K.ratings.comp})` : '') : `${reason} (${Math.round(p * 100)}% make${pressure >= 0.5 ? `, pressure kick, composure ${K.ratings.comp}` : ''})`, defReason: '', offTeam: i } };
    if (pat) {
      this.afterPAT(i);
    } else {
      this.endDrive(good ? 'Field goal' : blocked ? 'Blocked FG' : 'Missed FG');
      if (good) {
        if (this.quarter === 5) { this.finish(); }
        else { this.phase = 'kickoff'; this.kicking = i; this.kickFrom = 35; this.clockRunning = false; }
      } else if (scoop) {
        this.poss = d; this.addScore(d, 6);
        if (this.quarter === 5) this.finish(); else { this.phase = 'pat'; this.patTeam = d; this.clockRunning = false; }
      } else if (blocked) {
        // the defense takes over where the ball ended up (behind the line, most of the time)
        this.changePossession(clamp(100 - Math.round(sf.recX ?? los - 7), 1, 99), 'Blocked FG');
      } else {
        this.changePossession(Math.max(20, 100 - (los - 7)), 'Missed FG');
      }
    }
    this.pushLog(rec, text, i);
    return rec;
  }

  afterPAT(i) {
    if (this.quarter === 5) { this.finish(); return; }
    this.phase = 'kickoff'; this.kicking = i; this.kickFrom = 35; this.clockRunning = false;
  }

  doPAT() {
    const i = this.patTeam;
    if (this.quarter === 5) { this.finish(); return this.finalRecord(); }
    const sit = { ...this.situation(i), diff: this.score[i] - this.score[1 - i] };
    const dec = patDecision(this.teams[i], sit, this.rng);
    if (dec.call === 'kick') return this.doFieldGoal('', true);
    // two-point try: a real scrimmage play from the 2
    this.poss = i;
    const saved = { ballOn: this.ballOn, down: this.down, toGo: this.toGo, ballY: this.ballY };
    this.ballOn = 98; this.down = 1; this.toGo = 2; this.ballY = FIELD_W / 2;
    const s2 = { ...this.situation(i), down: 3, toGo: 2, ballOn: 98, twoMinute: false, killClock: false };
    const oc = callOffense(this.teams[i], s2, this.rng);
    const dc = callDefense(this.teams[1 - i], s2, this.tendency[i], this.rng);
    const rec = this.runScrimmagePlay(oc, dc, s2, { twoPoint: true });
    rec.presnap.offReason = `${dec.reason} — ${oc.reason}`;
    Object.assign(this, saved);
    return rec;
  }

  applyTwoPoint(res, rec) {
    const i = this.poss;
    const T = this.stats.teams[i];
    T.twoPt[1]++;
    const nm = (id) => this.players[id]?.name || '?';
    let text;
    if (res.td) {
      T.twoPt[0]++;
      this.addScore(i, 2);
      const who = res.receiver ? `${nm(res.passer)} to ${nm(res.receiver)}` : nm(res.rusher);
      text = `Two-point conversion is GOOD! (${who})`;
      rec.highlight = 'td';
    } else if (res.defTD) {
      this.addScore(1 - i, 2);
      text = `Two-point try fails — returned the other way for 2 points by ${this.teams[1 - i].name}!`;
    } else text = `Two-point conversion fails.`;
    rec.text = text;
    this.afterPAT(i);
    this.pushLog(rec, text, i);
    return rec;
  }

  finalRecord() { return null; }
}

function team(g, i) { return g.teams[i].abbr; }
function yardsText(y) {
  if (y === 0) return 'no gain';
  if (y < 0) return `a loss of ${-y}`;
  return `${y} yard${y === 1 ? '' : 's'}`;
}
function runDir(endY, ballY) {
  const dy = endY - ballY;
  if (Math.abs(dy) < 2) return 'up the middle';
  if (Math.abs(dy) < 5) return dy < 0 ? 'left guard' : 'right guard';
  if (Math.abs(dy) < 9) return dy < 0 ? 'left tackle' : 'right tackle';
  return dy < 0 ? 'around left end' : 'around right end';
}

// helpers for static frames
import { PLAY_BY_ID, DEF_BY_ID } from './playbook.js';
const FORMATION_ONLY = { id: 'formation', name: 'Formation', type: 'pass', drop: 'std', forms: { WR: 'singleback', TE: 'singlebackTE', RB: 'iForm' }, assign: { WR: 'block', FX: 'block', RB: 'block' }, prog: [] };
const DEF_C1 = DEF_BY_ID.c1;
