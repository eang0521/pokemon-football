// Game state machine: clock, downs, possession, scoring, special teams, stats.
// DOM-free so it can also run headless (see tools/sim-test.mjs).
import { RNG } from './rng.js';
import { TeamDepth } from './depth.js';
import { simulatePlay, simulateReturn } from './sim/playSim.js';
import { PLAYS, FORMATIONS } from './playbook.js';
import { specialFrames } from './sim/special.js';
import { callOffense, callDefense, fourthDown, patDecision, KNEEL, SPIKE } from './playcaller.js';

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
    this.seed = seed;
    this.rng = new RNG(seed);
    this.teams = [away, home];
    this.players = {};
    this.depth = this.teams.map((t) => new TeamDepth(t, this.players));
    this.teamOf = {};
    this.depth.forEach((d, i) => { for (const c of d.all()) this.teamOf[c.id] = i; });
    this.stats = { players: {}, teams: [blankTeam(), blankTeam()] };
    for (const id in this.players) this.stats.players[id] = blankLine();
    this.tendency = [{ plays: 0, pass: 0 }, { plays: 0, pass: 0 }];
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
    const twoMinute = (q === 2 && secsHalf <= 120) || (q >= 4 && secsGame <= 150 && diff <= 0) || (q >= 4 && secsGame <= 330 && diff < -8);
    const killClock = q >= 4 && diff > 0 && secsGame <= 330;
    return {
      down: this.down, toGo: this.toGo, ballOn: this.ballOn, quarter: q, clock: this.clock,
      secsHalf, secsGame, diff, twoMinute, killClock,
      timeouts: this.timeouts[i], oppTimeouts: this.timeouts[1 - i],
      lastPlayId: this.lastPlayId, offQB: this.depth[i].QB, adjust: this.scouting(i),
      personnel: this.depth[i].personnel, front: this.depth[1 - i].front,
    };
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
    this.curRecId = (this.recSeq = (this.recSeq || 0) + 1);
    const before = this.snapshot();
    let rec;
    if (this.phase === 'kickoff') rec = this.doKickoff();
    else if (this.phase === 'pat') rec = this.doPAT();
    else rec = this.doScrimmage();
    if (!rec) return this.next();
    rec.id = this.curRecId;
    rec.before = rec.before || before;
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
    const out = { ...this.tendency[i], runN: R.runs.length, passN: R.passes.length, runYpc: avg(R.runs), passYpa: avg(R.passes) };
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
  // Clock between plays (runoff, timeouts, two-minute warning)
  preSnapClock(sit) {
    const i = this.poss;
    const coach = this.teams[i].coach;
    if (!this.clockRunning) return;
    // timeouts
    const defIdx = 1 - i;
    const offWantsTO = this.timeouts[i] > 0 && sit.secsHalf <= 110 && sit.secsHalf > 3 &&
      ((this.quarter === 2 && this.ballOn >= 30) || (this.quarter >= 4 && sit.diff <= 0));
    const defWantsTO = this.timeouts[defIdx] > 0 && this.quarter >= 4 && sit.secsGame <= 170 && sit.diff >= 0 && sit.diff <= 16;
    if (offWantsTO) { this.useTimeout(i, 2); return; }
    if (defWantsTO) { this.useTimeout(defIdx, 2); return; }

    let runoff;
    if (sit.killClock) runoff = 36 + this.rng.range(0, 3);
    else if (sit.twoMinute) runoff = 9 + this.rng.range(0, 5);
    else runoff = { hurry: 14, normal: 25, slow: 31 }[coach.tempo] + this.rng.range(-4, 4);
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
    let sit = this.situation();
    this.preSnapClock(sit);
    if (this.clock <= 0) { this.clock = 0; this.checkQuarterEnd(); return null; }
    if (this.pendingWarning) { this.pendingWarning = false; this.note('Two-minute warning.', 'period'); }
    for (const n of this.depth[i].substitute('O')) this.note(`Sub (${team.abbr}): ${n}`, 'sub');
    for (const n of this.depth[d].substitute('D')) this.note(`Sub (${dteam.abbr}): ${n}`, 'sub');
    sit = this.situation();

    // clock-management specials
    const remDowns = 4 - this.down;
    const kneelable = sit.killClock && sit.secsGame <= (remDowns + 1) * 2 + Math.max(0, remDowns - sit.oppTimeouts) * 40;
    const halfKneel = this.quarter === 2 && sit.secsHalf <= 22 && this.ballOn < 55 && sit.diff >= 0 && this.down < 4;
    sit.kneel = (kneelable && this.down < 4) || (halfKneel && this.clockRunning);
    sit.spike = !sit.kneel && sit.twoMinute && this.clockRunning && this.timeouts[i] === 0 && sit.secsHalf <= 40 && sit.secsHalf > 4 && this.down < 3;
    if (sit.kneel) return this.doKneel(sit);
    if (sit.spike) return this.doSpike(sit);

    // field goal / punt decisions
    const K = this.depth[i].K;
    const fgDist = 100 - this.ballOn + 17;
    const inRange = fgDist <= 41 + K.ratings.kpow * 0.15;
    const needFGNow = inRange && sit.secsHalf <= 6 && (this.quarter === 2 || (sit.diff <= 0 && sit.diff >= -3) || this.quarter === 5);
    if (needFGNow) return this.doFieldGoal('Time for one last kick');
    if (this.down === 4) {
      const dec = fourthDown(team, sit, K);
      if (dec.call === 'punt') return this.doPunt(dec.reason);
      if (dec.call === 'fg') return this.doFieldGoal(dec.reason);
      this.goingForIt = dec.reason;
    }

    // pre-snap penalties
    const pr = this.rng.next();
    if (pr < 0.012) {
      const who = this.rng.pick(this.depth[i].offense().filter((c) => c.pos !== 'QB'));
      if (!this.disciplined(who)) return this.preSnapPenalty('O', 'False start', who);
    } else if (pr < 0.022) {
      const who = this.rng.pick(this.depth[d].defense().filter((c) => c.pos !== 'DB'));
      if (!this.disciplined(who)) return this.preSnapPenalty('D', 'Offside', who);
    }

    // play calls
    const oc = callOffense(team, sit, this.rng);
    const dc = callDefense(dteam, sit, this.scouting(i), this.rng);
    const rec = this.runScrimmagePlay(oc, dc, sit, {});
    if (this.goingForIt) { rec.presnap.decision = `4th down: ${this.goingForIt}`; this.goingForIt = null; }
    return rec;
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
      },
    };
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
    if (oc.play.type === 'pass' && blitzLook && oc.play.drop !== 'quick' && this.rng.chance(vision / 170)) {
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

  runScrimmagePlay(oc, dc, sit, { twoPoint = false } = {}) {
    const i = this.poss, d = 1 - i;
    const team = this.teams[i];
    const aud = this.audible(i, oc, dc, sit);
    if (aud) oc = { ...oc, play: aud.play, audible: aud.why };
    const args = this.simArgs(i, oc.play, dc.dcall, sit);
    // pre-snap motion on some pass plays when the FLEX is split out
    const fxAlign = FORMATIONS[args.form]?.align.FX;
    args.motion = oc.play.type === 'pass' && !oc.play.special && fxAlign && Math.abs(fxAlign[1]) > 4 && this.rng.chance(0.3);
    const res = simulatePlay(args);
    // Poison: extra energy lost from contact with Poison types
    for (const pid in res.toxic) { const t = this.teamOf[pid]; if (t != null) this.depth[t].drain(this.players[pid], res.toxic[pid]); }
    if (this.onPlay) this.onPlay({ oc, dc, res, sit });
    const los = this.ballOn;
    const dd = this.ddText();
    const rec = {
      type: 'scrimmage', frames: res.frames, cast: res.cast, frameTeam: i, dir: this.dirFor(i), W: FIELD_W,
      tacklers: res.tacklers, carrierId: res.tacklers?.length ? (res.kind === 'sack' ? res.cast.find((c) => c.side === 'O' && c.pos === 'QB')?.pid : (res.rusher || res.receiver || null)) : null,
      design: res.design, losX: los, fdX: Math.min(los + this.toGo, 100), events: res.events, motionT: res.motionT || 0,
      presnap: {
        dd: twoPoint ? 'Two-point try' : dd, spot: this.yardText(los), offCall: `${oc.play.name}`, form: args.form,
        defCall: dc.dcall.name, offReason: oc.reason, defReason: dc.reason, offTeam: i, audible: oc.audible || null,
        syn: { off: { ...this.depth[i].synergy.O.active }, def: { ...this.depth[d].synergy.D.active } },
      },
    };
    this.lastPlayId = oc.play.id;
    this.tendency[i].plays++;
    if (oc.play.type === 'pass') this.tendency[i].pass++;
    if (twoPoint) return this.applyTwoPoint(res, rec);
    this.applyScrimmage(res, rec, sit);
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
    this.log.push({ q: rec.before?.q ?? this.quarter, clock: rec.before?.clock ?? this.clock, team, dd: rec.presnap?.dd, spot: rec.presnap?.spot, text, highlight: rec.highlight, score: [...this.score], recId: this.curRecId });
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
      presnap: { dd, spot: this.yardText(los), offCall: SPIKE.name, defCall: '—', offReason: 'No timeouts left — stop the clock', defReason: '', offTeam: i } };
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
  runReturn(kind, kickerTeam, kickers, receivers, { kickX, kickY, landX, landY, hang }) {
    return simulateReturn({ rng: this.rng, W: FIELD_W, kind, kickX, kickY, landX, landY, hang,
      receivers: this.stUnit(receivers), coverage: this.stUnit(kickers) });
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
    this.stats.teams[i].plays++;
    const blocked = this.rng.chance(0.008);
    const dist = 39 + K.ratings.kpow * 0.12 + this.rng.gauss(0, 5);
    const land = los + dist;
    const hang = 3.6 + K.ratings.kpow * 0.012 + this.rng.gauss(0, 0.3);
    const landY = clamp(this.ballY + this.rng.gauss(0, 6), 4, FIELD_W - 4);
    this.endDrive('Punt');
    // ---- blocked or touchback: quick resolution
    if (blocked || land >= 100) {
      let text, newOn;
      if (blocked) {
        newOn = 100 - Math.round(los - 6);
        text = `${K.name} punt is BLOCKED! ${this.teams[d].name} take over at the ${this.yardText(Math.round(los - 6), i)}.`;
      } else {
        newOn = 20;
        S(K.id).punt.n++; S(K.id).punt.yds += 100 - los; S(K.id).punt.lng = Math.max(S(K.id).punt.lng, 100 - los);
        text = `${K.name} punts ${100 - los} yards into the end zone. Touchback.`;
      }
      const sf = specialFrames({ kind: 'punt', W: FIELD_W, kickX: los, kickY: this.ballY, landX: blocked ? los - 6 : Math.min(land, 108), landY, hang: blocked ? 0.4 : hang, returnEndX: null, kickers, receivers, returnerIdx: 0, blocked });
      this.runPlayClock(Math.min(sf.duration, 8));
      const rec = { type: 'punt', ...sf, frameTeam: i, dir: this.dirFor(i), W: FIELD_W, losX: los, fdX: null, design: null, events: [], text, presnap };
      this.changePossession(newOn, 'Punt');
      this.pushLog(rec, text, i);
      return rec;
    }
    // ---- simulated punt return (receiving team's frame)
    const py = Math.round(land - los);
    S(K.id).punt.n++; S(K.id).punt.yds += py; S(K.id).punt.lng = Math.max(S(K.id).punt.lng, py);
    if (land >= 80) S(K.id).punt.in20++;
    const res = this.runReturn('punt', i, kickers, receivers, { kickX: 100 - los, kickY: FIELD_W - this.ballY, landX: 100 - land, landY: FIELD_W - landY, hang });
    this.creditReturnStats(res);
    this.runPlayClock(Math.min(res.duration, 12));
    const rec = { type: 'punt', frames: res.frames, cast: res.cast, duration: res.duration, frameTeam: d, dir: this.dirFor(d), W: FIELD_W, losX: null, fdX: null, design: null, events: res.events, presnap, tacklers: res.tacklers, carrierId: res.tacklers.length ? retr.id : null };
    const start = Math.round(res.catchX), end = Math.round(res.endX);
    let text;
    if (res.fairCatch) {
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

  fgProb(K, dist) {
    const acc = K.ratings.kacc, pow = K.ratings.kpow;
    const maxD = 41 + pow * 0.15;
    let p = 0.99 - Math.max(0, dist - 22) * 0.011 * (1.45 - acc / 100);
    if (dist > maxD - 6) p -= (dist - (maxD - 6)) * 0.06;
    return clamp(p, 0.02, 0.99);
  }

  doFieldGoal(reason, pat = false) {
    const i = pat ? this.patTeam : this.poss, d = 1 - i;
    const K = this.depth[i].K;
    const los = pat ? 85 : this.ballOn;
    const dist = 100 - los + 17;
    const p = this.fgProb(K, dist);
    const blocked = this.rng.chance(pat ? 0.005 : 0.012);
    const good = !blocked && this.rng.chance(p);
    const S = this.stats.players[K.id];
    const dd = pat ? 'PAT' : this.ddText();
    const spot = this.yardText(los, i);
    let text;
    const miss = good ? 0 : this.rng.chance(0.5) ? -1 : 1;
    const short = !good && !blocked && dist > 45 && this.rng.chance(0.4);
    const landY = good ? FIELD_W / 2 + this.rng.range(-2, 2) : FIELD_W / 2 + miss * this.rng.range(3.6, 6);
    const landX = short ? 106 : 111;
    const off = this.depth[i].offense();
    const kickers = [off[0], K, ...off.filter((c) => c.pos === 'OL'), ...off.filter((c) => c.pos !== 'OL' && c.pos !== 'QB')].slice(0, 7);
    const receivers = this.depth[d].defense();
    const sf = specialFrames({ kind: 'fg', W: FIELD_W, kickX: los, kickY: this.ballY, landX, landY, hang: 0.9 + dist * 0.025, returnEndX: null, kickers, receivers, returnerIdx: null, blocked });
    if (pat) {
      S.kick.xpa++;
      if (good) { S.kick.xpm++; this.addScore(i, 1); }
      text = good ? `${K.name} extra point is GOOD.` : blocked ? `${K.name} extra point is BLOCKED!` : `${K.name} extra point is no good${miss < 0 ? ', wide left' : ', wide right'}.`;
    } else {
      S.kick.fga++;
      this.stats.teams[i].plays++;
      this.runPlayClock(Math.min(sf.duration, 5));
      if (good) {
        S.kick.fgm++; S.kick.lng = Math.max(S.kick.lng, dist);
        this.addScore(i, 3);
        text = `${K.name} ${dist}-yard field goal is GOOD!`;
      } else {
        text = `${K.name} ${dist}-yard field goal is ${blocked ? 'BLOCKED' : short ? 'short' : `no good, wide ${miss < 0 ? 'left' : 'right'}`}.`;
      }
    }
    const rec = { type: pat ? 'pat' : 'fg', ...sf, frameTeam: i, dir: this.dirFor(i), W: FIELD_W, losX: los, fdX: null, design: null, events: [], text,
      highlight: good && !pat ? 'fg' : (!good ? 'miss' : null),
      presnap: { dd, spot, offCall: pat ? 'Extra Point' : `${dist}-yd Field Goal`, defCall: 'FG Block', offReason: pat ? '' : `${reason} (${Math.round(p * 100)}% make)`, defReason: '', offTeam: i } };
    if (pat) {
      this.afterPAT(i);
    } else {
      this.endDrive(good ? 'Field goal' : 'Missed FG');
      if (good) {
        if (this.quarter === 5) { this.finish(); }
        else { this.phase = 'kickoff'; this.kicking = i; this.kickFrom = 35; this.clockRunning = false; }
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
