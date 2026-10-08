// Player mode on the page: the play-call menu, the keyboard, and running the person's plays live.
//
// The engine (on the page in this mode) pauses with an 'await' message when it needs a play call
// or when a play involving the person has to run live. Live plays step the same simulation the
// watch mode uses (setupPlay / stepPlay / finishPlay), one 0.05 s tick at a time, with the stick
// and button presses fed in between ticks; the result goes back to the engine to finish the play.
import { setupPlay, stepPlay, finishPlay, humanEnt, DT } from './sim/playSim.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const THROW_KEYS = { u: 'WR', i: 'FX', o: 'RB' };
const DEF_KEYS = ['r', 't', 'y', 'u', 'i', 'o', 'p'];
const MOVE_KEYS = { w: [0, 1], arrowup: [0, 1], s: [0, -1], arrowdown: [0, -1], a: [-1, 0], arrowleft: [-1, 0], d: [1, 0], arrowright: [1, 0] };
const FAMILY_ORDER = [['run', 'Runs'], ['quick', 'Quick game'], ['short', 'Short'], ['medium', 'Medium'], ['deep', 'Deep shots'], ['pa', 'Play action'], ['screen', 'Screens']];
const AUTO_SNAP = 1.4; // seconds the person's defense waits before the AI offense snaps it
const COARSE = window.matchMedia('(pointer: coarse)');

export function createPlayer({ stage, help, send, view, onCaption }) {
  const held = new Set();
  const touch = { x: 0, y: 0 }; // on-screen stick (screen right / up)
  let menuEl = null, stickEl = null;
  let live = null; // { S, rec, phase: 'pre' | 'live' | 'done', acc, preT, evIdx, side, order }

  // ---------------------------------------------------------------- play-call menu
  function showMenu(menu) {
    hideMenu();
    menuEl = document.createElement('div');
    menuEl.className = 'callmenu';
    const q = menu.quarter >= 5 ? 'OT' : `Q${menu.quarter}`;
    const clock = `${Math.floor(menu.clock / 60)}:${String(Math.floor(menu.clock % 60)).padStart(2, '0')}`;
    const coach = menu.coach;
    let body = '';
    if (menu.side === 'O') {
      if (menu.specials.length) body += `<div class="cm-row">${menu.specials.map((s) => `<button type="button" data-special="${s.call}">${esc(s.label)}</button>`).join('')}</div>`;
      for (const [fam, title] of FAMILY_ORDER) {
        const plays = menu.plays.filter((p) => p.family === fam || (fam === 'deep' && p.id === 'hailMary'));
        if (!plays.length) continue;
        body += `<div class="cm-h">${title}</div><div class="cm-grid">${plays.map((p) => `<button type="button" data-play="${p.id}"><b>${esc(p.name)}</b><small>${esc(p.form)}</small></button>`).join('')}</div>`;
      }
    } else {
      const tag = (d) => (d.tags.includes('blitz') ? 'Blitz' : d.tags.includes('prevent') ? 'Prevent' : d.tags.includes('man') ? 'Man' : 'Zone');
      body += `<div class="cm-grid">${menu.defs.map((d) => `<button type="button" data-def="${d.id}"><b>${esc(d.name)}</b><small>${tag(d)}</small></button>`).join('')}</div>`;
    }
    menuEl.innerHTML = `<div class="cm-head"><span class="cm-side">${menu.side === 'O' ? 'Your offense' : 'Your defense'}</span>
        <b>${esc(menu.dd)}</b> <span class="muted">at ${esc(menu.spot)} · ${q} ${clock}</span></div>
      <button type="button" class="cm-coach primary" data-coach="1">Coach's call: <b>${esc(coach.label)}</b><small>${esc(coach.reason || '')} · Enter</small></button>
      ${body}`;
    menuEl.addEventListener('click', (e) => {
      e.stopPropagation();
      const b = e.target.closest('button');
      if (!b) return;
      pick(b.dataset.coach ? {} : b.dataset.special ? { special: b.dataset.special } : b.dataset.play ? { play: b.dataset.play } : { def: b.dataset.def });
    });
    stage.appendChild(menuEl);
    setHelp(menu.side === 'O' ? 'Pick a play (or Enter for the coach\'s call)' : 'Pick a defense (or Enter for the coach\'s call)');
  }
  function hideMenu() { menuEl?.remove(); menuEl = null; }
  function pick(call) { hideMenu(); setHelp(''); send({ type: 'call', call }); }

  // ---------------------------------------------------------------- live plays
  function startLive(m) {
    const S = setupPlay(m.args);
    const side = S.human.side;
    // the pre-snap design overlay shows only your own side's call
    const D = S.design;
    const design = side === 'O' ? { routes: D.routes, aim: D.aim, prog: D.prog } : { zones: D.zones, rush: D.rush };
    const rec = { ...m.rec, frames: S.frames, cast: S.cast, design, events: S.events, motionT: 0 };
    // defenders' keys, left to right as you see them at the snap
    const order = side === 'D' ? sortForScreen(S.defList.slice(), S, rec.dir) : null;
    if (side === 'D') {
      // start on the second-level defender nearest the ball
      const lvl2 = S.defList.filter((e) => e.kind !== 'DL');
      S.human.ctl = (lvl2.length ? lvl2 : S.defList).slice().sort((a, b) => Math.hypot(a.x - S.los, a.y - S.ballY) - Math.hypot(b.x - S.los, b.y - S.ballY))[0];
    }
    live = { S, rec, phase: 'pre', acc: 0, preT: 0, evIdx: 0, side, order };
    if (COARSE.matches) showStick();
    setHelp(helpText());
    return rec;
  }
  function helpText() {
    const pre = live.phase === 'pre';
    if (COARSE.matches) {
      return live.side === 'O' ? `${pre ? '<b>Tap the field</b> to snap · ' : ''}<b>stick</b> to run · <b>tap a receiver</b> to throw`
        : '<b>Stick</b> to move · <b>tap a defender</b> to switch to him';
    }
    return live.side === 'O' ? `${pre ? '<b>Space</b> snap · ' : ''}<b>WASD</b> move the ball carrier · <b>U</b> <b>I</b> <b>O</b> throw to WR / FLEX / RB`
      : `<b>WASD</b> move · <b>R T Y U I O P</b> switch defender${pre ? ' · the offense snaps it in a moment' : ''}`;
  }
  function sortForScreen(list, S, dir) {
    // screen-left to screen-right: in the all-14 view that's the play's +y; side-on, it's top to bottom
    const key = view() === 'all14' ? (e) => e.y : (e) => (dir > 0 ? e.y : -e.y);
    return list.sort((a, b) => key(a) - key(b));
  }
  function snap() { if (live?.phase === 'pre') { live.phase = 'live'; live.acc = 0; setHelp(helpText()); } }

  // the stick in the play's frame (x = downfield, y = toward the +y sideline), from screen directions
  function stick() {
    let sx = touch.x, sy = touch.y;
    for (const k of held) { const v = MOVE_KEYS[k]; if (v) { sx += v[0]; sy += v[1]; } }
    if (!sx && !sy) return { x: 0, y: 0 };
    const dir = live.rec.dir;
    return view() === 'all14' ? { x: sy, y: sx } : { x: dir * sx, y: -dir * sy };
  }

  // advance the live play by dt seconds of real time; returns the finished result once it's over
  function update(dt) {
    if (!live || live.phase === 'done') return null;
    if (live.phase === 'pre') {
      live.preT += dt;
      if (live.side === 'D' && live.preT >= AUTO_SNAP) snap();
      return null;
    }
    const S = live.S;
    live.acc += dt;
    let done = false;
    while (live.acc >= DT && !done) {
      live.acc -= DT;
      S.human.move = stick();
      done = stepPlay(S);
    }
    while (live.evIdx < S.events.length) onCaption(S.events[live.evIdx++].text);
    if (!done) return null;
    live.phase = 'done';
    setHelp('');
    hideStick();
    return finishPlay(S);
  }

  // what to draw: the newest frames (a tick behind, so it can blend between them) + markers
  function drawState() {
    if (!live) return null;
    const S = live.S, n = S.frames.length;
    const ft = live.phase === 'pre' ? 0 : Math.max(0, (n - 2) * DT + Math.min(live.acc, DT));
    const marks = [];
    const me = humanEnt(S);
    if (live.side === 'O') {
      if (!S.thrown && !S.handed && S.play.type === 'pass') {
        for (const [k, slot] of Object.entries(THROW_KEYS)) {
          const e = S.O[slot];
          if (e && (e.role === 'route' || live.phase === 'pre')) marks.push({ idx: e.idx, label: k.toUpperCase(), dim: e.role !== 'route' });
        }
      }
    } else {
      live.order.forEach((e, k) => marks.push({ idx: e.idx, label: DEF_KEYS[k].toUpperCase(), on: e === S.human.ctl }));
    }
    return { rec: live.rec, ft, marks, ctlIdx: me ? me.idx : -1, pre: live.phase === 'pre' };
  }

  // a sim button while a live play is on: let the coaches finish it instantly
  function finishNow() {
    if (!live || live.phase === 'done') return null;
    live.S.human = null;
    while (!stepPlay(live.S));
    live.phase = 'done';
    setHelp('');
    hideStick();
    return finishPlay(live.S);
  }

  // ---------------------------------------------------------------- touch
  // tap a receiver to throw to him (offense) or a defender to take him over (defense)
  function tapPlayer(pid) {
    if (!live || live.phase === 'done') return false;
    const S = live.S, ent = S.ents.find((e) => e.pl.id === pid);
    if (!ent) return true;
    if (live.side === 'O') {
      const slot = Object.values(THROW_KEYS).find((k) => S.O[k] === ent);
      if (slot && live.phase === 'live') S.human.throwTo = slot;
    } else if (ent.side === 'D' && ent !== S.human.ctl) { S.human.ctl = ent; ent.manual = false; }
    return true;
  }
  function showStick() {
    if (stickEl) return;
    stickEl = document.createElement('div');
    stickEl.className = 'pm-stick';
    stickEl.innerHTML = '<i></i>';
    const knob = stickEl.firstChild;
    const move = (e) => {
      const r = stickEl.getBoundingClientRect(), R = r.width / 2;
      let dx = (e.clientX - r.left - R) / R, dy = (e.clientY - r.top - R) / R;
      const m = Math.hypot(dx, dy);
      if (m > 1) { dx /= m; dy /= m; }
      knob.style.transform = `translate(${dx * R * 0.55}px, ${dy * R * 0.55}px)`;
      const dead = m < 0.2;
      touch.x = dead ? 0 : dx; touch.y = dead ? 0 : -dy;
    };
    const end = () => { touch.x = touch.y = 0; knob.style.transform = ''; };
    stickEl.addEventListener('pointerdown', (e) => { e.stopPropagation(); stickEl.setPointerCapture(e.pointerId); move(e); });
    stickEl.addEventListener('pointermove', (e) => { if (stickEl.hasPointerCapture(e.pointerId)) move(e); });
    stickEl.addEventListener('pointerup', end);
    stickEl.addEventListener('pointercancel', end);
    stickEl.addEventListener('click', (e) => e.stopPropagation());
    stage.appendChild(stickEl);
  }
  function hideStick() { stickEl?.remove(); stickEl = null; touch.x = touch.y = 0; }

  // ---------------------------------------------------------------- keyboard
  function keyDown(e) {
    if (e.target.matches?.('input, select, textarea')) return false;
    const k = e.key.toLowerCase();
    if (menuEl && k === 'enter') { pick({}); return true; }
    if (!live || live.phase === 'done') return false;
    if (MOVE_KEYS[k]) { held.add(k); e.preventDefault(); return true; }
    if (k === ' ' && live.phase === 'pre' && live.side === 'O') { e.preventDefault(); snap(); return true; }
    const S = live.S;
    if (live.side === 'O' && THROW_KEYS[k]) { if (live.phase === 'live') S.human.throwTo = THROW_KEYS[k]; return true; }
    if (live.side === 'D' && DEF_KEYS.includes(k)) {
      const ent = live.order[DEF_KEYS.indexOf(k)];
      if (ent && ent !== S.human.ctl) { S.human.ctl = ent; ent.manual = false; }
      return true;
    }
    return false;
  }
  function keyUp(e) { held.delete(e.key.toLowerCase()); }
  window.addEventListener('blur', () => held.clear());

  function setHelp(html) { help.innerHTML = html; help.classList.toggle('hidden', !html); }
  function reset() { hideMenu(); hideStick(); live = null; held.clear(); setHelp(''); }

  return {
    showMenu, hideMenu, startLive, update, drawState, finishNow, keyDown, keyUp, reset, tapPlayer,
    snapIfWaiting() { if (live?.phase === 'pre' && live.side === 'O') { snap(); return true; } return false; },
    get live() { return live; }, endLive() { live = null; },
    get menuOpen() { return !!menuEl; },
  };
}
