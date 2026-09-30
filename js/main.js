import { TEAMS } from './data/teams.js';
import { POKEMON } from './data/pokemon.js';
import { GameView, EngineClient, recFrames } from './client.js';
import { FieldRenderer, spriteUrl } from './render.js';
import { STAT_KEYS, STAT_LABELS } from './ratings.js';
import { STARTERS, BENCH, parseCard, personnelOf, frontOf, PERSONNEL, FRONTS } from './roster.js';
import { loadCustomTeams } from './storage.js';
import { openBuilder, wireBuilder, TYPE_COLORS, synergyChips, unitCounts } from './builder.js';
import { encodeTeam, decodeTeam } from './teamcode.js';
import { openModal, closeModal } from './modal.js';
import { saveCustomTeam } from './storage.js';
import { initAdventure, showAdventureHome, showAdventure } from './adventure/ui.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem(`pgf:${k}`); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(`pgf:${k}`, JSON.stringify(v)); } catch { /* ignore */ } },
};

const typeChips = (types) => `<span class="types">${types.map((t) => `<span class="type" style="background:${TYPE_COLORS[t] || '#666'}">${t}</span>`).join('')}</span>`;
const clockText = (s) => { s = Math.max(0, Math.ceil(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const qText = (q) => (q === 5 ? 'OT' : ['1st', '2nd', '3rd', '4th'][q - 1]);
const allTeams = () => [...loadCustomTeams(), ...TEAMS];
// teams embedded in shared game links ("~CODE") are decoded on the fly (not saved)
const linkTeams = new Map();
const findTeam = (id) => {
  if (!id) return null;
  if (id.startsWith('~')) {
    if (!linkTeams.has(id)) { const { team } = decodeTeam(id); linkTeams.set(id, team ? { ...team, id, linked: true } : null); }
    return linkTeams.get(id);
  }
  return allTeams().find((t) => t.id === id);
};
// id to put in a shareable game URL: custom teams travel as their code
const urlId = (t) => (t.custom ? `~${encodeTeam(t)}` : t.id);

function importDialog(prefill = '') {
  openModal(`<h3>Import a team</h3>
    <p class="muted small">Paste a team code (or a link someone shared).</p>
    <textarea class="code" id="m-code" rows="4" placeholder="PG1...">${esc(prefill)}</textarea>
    <div id="m-msg" class="small"></div>
    <div class="modal-actions"><button type="button" class="primary" id="m-import">Import</button><button type="button" class="ghost" data-close>Cancel</button></div>`, (d) => {
    const go = () => {
      const { team, errors } = decodeTeam(d.querySelector('#m-code').value);
      const msg = d.querySelector('#m-msg');
      if (!team) { msg.innerHTML = `<span class="b-errors">${esc(errors[0])}</span>`; return; }
      if (errors.length) { msg.innerHTML = `<span class="b-errors">Imported, but the roster needs work: ${esc(errors.slice(0, 2).join('; '))}. Open it in the builder to finish.</span>`; }
      saveCustomTeam(team);
      renderTeamGrid();
      if (!errors.length) {
        if (!sel.away) sel.away = team.id; else if (!sel.home && sel.away !== team.id) sel.home = team.id;
        syncSetup();
        closeModal();
      }
    };
    d.querySelector('#m-import').onclick = go;
  });
}
$('#btn-import').addEventListener('click', () => importDialog());

function showScreen(name) {
  for (const id of ['setup', 'builder', 'game', 'adventure']) $(`#${id}`).classList.toggle('hidden', id !== name);
  const adv = name === 'adventure' || (name === 'game' && ctl.adventure);
  $('#btn-new').classList.toggle('hidden', name === 'setup' || name === 'adventure');
  $('#btn-new').textContent = name === 'builder' ? 'Back to teams' : adv ? 'Back to adventure' : 'New game';
  $$('.modes [data-mode]').forEach((b) => b.classList.toggle('on', (b.dataset.mode === 'adventure') === !!adv));
  if (name !== 'game') { ctl.playing = false; }
  window.scrollTo(0, 0);
}
$$('.modes [data-mode]').forEach((b) => b.addEventListener('click', () => {
  if (ctl.adventure && !$('#game').classList.contains('hidden')) { leaveAdventureGame(); return; }
  if (b.dataset.mode === 'adventure') { history.replaceState(null, '', `${location.pathname}#adventure`); showAdventure(); }
  else { history.replaceState(null, '', location.pathname); ctl.adventure = null; showScreen('setup'); renderTeamGrid(); }
}));

// ==========================================================================
// Setup screen
const sel = { away: null, home: null };
function renderTeamGrid() {
  const grid = $('#team-grid');
  grid.innerHTML = allTeams().map((t) => {
    const stars = ['QB', 'RB', 'WR'].map((k) => POKEMON[parseCard(t.roster[k], k)?.mon]).filter(Boolean);
    const c = t.coach;
    const meter = (label, v) => `<span>${label}</span><div class="meter"><span style="width:${Math.round(v * 100)}%"></span></div>`;
    return `<div class="team-card" data-team="${t.id}" role="button" tabindex="0">
      <div class="band" style="background:linear-gradient(120deg, ${t.colors.primary}, ${t.colors.primary} 60%, ${t.colors.secondary})">
        ${stars.map((p) => `<img src="${spriteUrl(p)}" alt="${esc(p.name)}" loading="lazy" referrerpolicy="no-referrer">`).join('')}
        <span class="abbr">${esc(t.abbr)}</span>
        ${t.custom ? '<span class="custom-badge">Custom</span>' : ''}
      </div>
      <div class="info">
        <div class="tname">${esc(t.city)} ${esc(t.name)}</div>
        <div class="coach">${esc(c.name)} · ${esc(c.style)}</div>
        ${(() => {
          const o = unitCounts(t.roster, 'O'), d = unitCounts(t.roster, 'D');
          const row = (label, set, u) => `<div class="unit-row"><span class="unit-lab">${label}</span><span class="set">${set}</span>${synergyChips(u.counts, u.active, { compact: true, onlyActive: true }) || '<span class="muted small">no synergies</span>'}</div>`;
          return `<div class="sets">${row('OFF', PERSONNEL[personnelOf(t.roster)].name, o)}${row('DEF', FRONTS[frontOf(t.roster)].name, d)}</div>`;
        })()}
        <div class="meters">${meter('Pass', c.passRate)}${meter('Aggressive', c.aggression)}${meter('Blitz', c.blitzRate)}${meter('Man cov.', c.manRate)}</div>
        <div class="card-foot"><span class="pick"></span>${t.custom ? `<button type="button" class="ghost edit" data-edit="${t.id}">Edit</button>` : ''}</div>
      </div>
    </div>`;
  }).join('');
  grid.querySelectorAll('.team-card').forEach((el) => {
    el.addEventListener('click', (e) => { if (e.target.closest('[data-edit]')) return; pickTeam(el.dataset.team); });
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickTeam(el.dataset.team); } });
  });
  grid.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => editTeam(findTeam(b.dataset.edit))));
  syncSetup();
}
function pickTeam(id) {
  if (sel.away === id) sel.away = null;
  else if (sel.home === id) sel.home = null;
  else if (!sel.away) sel.away = id;
  else if (!sel.home) sel.home = id;
  else sel.home = id;
  syncSetup();
}
function syncSetup() {
  for (const side of ['away', 'home']) {
    if (sel[side] && !findTeam(sel[side])) sel[side] = null;
    const t = findTeam(sel[side]);
    const slot = $(`#slot-${side}`);
    slot.classList.toggle('filled', !!t);
    slot.querySelector('.slot-name').textContent = t ? `${t.city} ${t.name}` : 'Select a team';
    slot.style.borderColor = t ? t.colors.primary : '';
  }
  $$('.team-card').forEach((el) => {
    const id = el.dataset.team;
    el.classList.toggle('sel-away', sel.away === id);
    el.classList.toggle('sel-home', sel.home === id);
    el.querySelector('.pick').textContent = sel.away === id ? 'AWAY' : sel.home === id ? 'HOME' : '';
  });
  $('#btn-start').disabled = !(sel.away && sel.home);
}
$('#btn-random').addEventListener('click', () => {
  const ids = allTeams().map((t) => t.id).sort(() => Math.random() - 0.5);
  sel.away = ids[0]; sel.home = ids[1];
  syncSetup();
});
function editTeam(team) {
  showScreen('builder');
  openBuilder(team, {
    onSave: (t) => { showScreen('setup'); renderTeamGrid(); if (!sel.away) sel.away = t.id; else if (!sel.home && sel.away !== t.id) sel.home = t.id; syncSetup(); },
    onClose: () => { showScreen('setup'); renderTeamGrid(); },
  });
}
$('#btn-build').addEventListener('click', () => editTeam(null));
$('#opt-injuries').checked = store.get('injuries', true);
$('#opt-injuries').addEventListener('change', (e) => store.set('injuries', e.target.checked));
wireBuilder();
$('#btn-start').addEventListener('click', () => {
  const seedIn = Number($('#seed').value);
  const seed = seedIn > 0 ? seedIn : Math.floor(Math.random() * 1e9);
  startGame(sel.away, sel.home, seed);
});
$('#btn-new').addEventListener('click', () => {
  ctl.playing = false;
  if (ctl.adventure) { leaveAdventureGame(); return; }
  showScreen('setup');
  renderTeamGrid();
  history.replaceState(null, '', location.pathname);
});

// ==========================================================================
// Game controller. The game itself runs in a Web Worker (js/worker.js); the page
// keeps a mirror (GameView) and plays back records as they arrive.
const ctl = {
  game: null, client: null, renderer: null, playing: false, speed: store.get('speed', 1), stepOnce: false,
  cur: null, phase: 'idle', phaseT: 0, preDur: 0, playDur: 0, postDur: 0, lastRec: null, evIdx: 0,
  queue: [], requested: 0, noMore: false, finalState: null, history: new Map(), replay: null,
  opts: { design: store.get('design', true), reads: store.get('reads', true), names: store.get('names', false), sprites: store.get('sprites', 'home'), playcard: store.get('playcard', 'snap') },
};

function startGame(awayId, homeId, seed) {
  ctl.adventure = null;
  startGameWith(findTeam(awayId), findTeam(homeId), seed);
}

// Adventure battles: the player is the home team; the result goes back to the adventure.
function startBattle(away, home, seed, hooks) {
  ctl.adventure = hooks;
  startGameWith(away, home, seed);
}
function leaveAdventureGame() {
  const h = ctl.adventure;
  ctl.playing = false;
  ctl.client?.terminate(); ctl.client = null;
  ctl.adventure = null;
  history.replaceState(null, '', `${location.pathname}#adventure`);
  if (h && ctl.game?.final) h.onDone(adventureResult()); else h?.onAbort();
}
function adventureResult() {
  const g = ctl.game;
  const injuredSlots = Object.values(g.players).filter((p) => p.teamId === 'adv' && p.injured).map((p) => p.id.slice(4).split('@')[0]);
  return { pf: g.score[1], pa: g.score[0], injuredSlots };
}

function startGameWith(away, home, seed) {
  ctl.client?.terminate();
  Object.assign(ctl, { game: null, cur: null, phase: 'idle', lastRec: null, queue: [], requested: 0, noMore: false, finalState: null, history: new Map(), replay: null });
  showScreen('game');
  $('#final').classList.add('hidden');
  $('#tokens').innerHTML = '';
  hideReplayBadge();
  if (!ctl.renderer) {
    ctl.renderer = new FieldRenderer({ stage: $('#stage'), field: $('#field'), overlay: $('#overlay'), tokens: $('#tokens'), onPlayerHover: showPlayerCard });
  } else { ctl.renderer.tokens.clear(); ctl.renderer.lastScale = null; }
  ctl.renderer.spriteStyle = ctl.opts.sprites;
  if (ctl.adventure) history.replaceState(null, '', `${location.pathname}#adventure`);
  else history.replaceState(null, '', `?away=${urlId(away)}&home=${urlId(home)}&seed=${seed}`);
  $('#lastplay').innerHTML = '<span class="muted">Setting up the game…</span>';
  ctl.client = new EngineClient(onEngineMessage);
  ctl.client.send({ type: 'new', away, home, seed, options: { injuries: ctl.adventure ? true : $('#opt-injuries').checked } });
  setPlaying(false);
}

function requestMore() {
  while (!ctl.noMore && ctl.queue.length + ctl.requested < 2) { ctl.requested++; ctl.client.send({ type: 'next' }); }
}

function storeHistory(rec) {
  const { state, frames, ...lite } = rec;
  ctl.history.set(rec.id, lite);
}

function onEngineMessage(m) {
  if (m.type === 'error') { console.error(m.message); $('#lastplay').innerHTML = `<span class="b-errors">Simulation error: ${esc(m.message.split('\n')[0])}</span>`; return; }
  if (m.type === 'init') {
    ctl.game = new GameView(m.teams, m.seed);
    ctl.game.apply(m.state);
    renderScorebug(ctl.game.snapshot());
    $('#lastplay').innerHTML = `<span class="muted">${esc(ctl.game.log[0]?.text || '')} Press <b>Play</b> to kick off. (Seed ${m.seed}${ctl.client.mode === 'page' ? ', running on the page' : ''})</span>`;
    renderPanels();
    requestMore();
    return;
  }
  if (m.type === 'rec') {
    ctl.requested = Math.max(0, ctl.requested - 1);
    m.rec.state = m.state;
    storeHistory(m.rec);
    if (ctl.simming) return; // skipped over by a sim in progress
    ctl.queue.push(m.rec);
    if (ctl.phase === 'idle' || ctl.phase === 'waiting') loadNext();
    requestMore();
    return;
  }
  if (m.type === 'batch') {
    for (const r of m.recs) { storeHistory(r); ctl.simLast = r; }
    $('#sim-progress') && ($('#sim-progress').textContent = `Simulating… ${Math.round(m.progress * 100)}%`);
    return;
  }
  if (m.type === 'simmed') { finishSimTo(m); return; }
  if (m.type === 'final') {
    ctl.requested = 0;
    ctl.noMore = true;
    ctl.finalState = m.state;
    if (ctl.simming) { finishSim(); return; }
    if (ctl.phase === 'idle' || ctl.phase === 'waiting') loadNext();
  }
}

function loadNext() {
  if (!ctl.game) return;
  if (!ctl.queue.length) {
    if (ctl.noMore) { if (ctl.finalState) ctl.game.apply(ctl.finalState); onFinal(); return; }
    ctl.phase = 'waiting';
    requestMore();
    return;
  }
  const rec = ctl.queue.shift();
  recFrames(rec);
  ctl.cur = rec;
  ctl.evIdx = 0;
  ctl.phase = 'pre'; ctl.phaseT = 0;
  const kick = rec.type !== 'scrimmage' && rec.type !== 'penalty';
  ctl.preDur = rec.type === 'scrimmage' ? 1.9 : kick ? 0.9 : 0.6;
  ctl.playDur = (rec.frames.length - 1) * 0.05;
  const big = ['td', 'int', 'fumble', 'safety', 'downs'].includes(rec.highlight);
  ctl.postDur = big ? 2.2 : 1.1;
  ctl.renderer.ensureTokens(rec, ctl.game);
  ctl.renderer.lastScale = null;
  renderScorebug(rec.before, rec);
  renderPlaycard(rec);
  $('#toast').classList.add('hidden');
  hideCaption();
  ctl.renderer.draw(rec, 0, ctl.game, { ...drawOpts(0), snapCamera: !ctl.lastRec || ctl.lastRec.type !== 'scrimmage' || rec.type !== 'scrimmage' });
  requestMore();
}

function drawOpts(ft) {
  const early = ctl.phase === 'pre' ? 1 : Math.max(0, 1 - ft / 0.8);
  return { design: ctl.opts.design && early > 0, designAlpha: early, reads: ctl.opts.reads };
}

function onPlayEnd() {
  const rec = ctl.cur, g = ctl.game;
  if (rec.state) { g.apply(rec.state); delete rec.state; }
  renderScorebug(rec.after, rec);
  const hl = rec.highlight;
  const toast = { td: 'Touchdown!', int: 'Intercepted!', fumble: 'Fumble!', fg: "It's good!", miss: 'No good!', safety: 'Safety!', downs: 'Turnover on downs', flag: 'Flag!' }[hl];
  if (rec.type === 'pat' && !hl) showToast('Extra point good', true);
  else if (toast) showToast(toast);
  else if (/ sacked by /.test(rec.text || '')) showToast('Sack!');
  else if (rec.firstDown) showToast('First down', true);
  const team = g.teams[rec.presnap?.offTeam ?? 0];
  $('#lastplay').innerHTML = `<span class="lp-dd">${esc(rec.presnap?.dd || '')} · ${esc(rec.presnap?.spot || '')}</span><b style="color:${team.colors.secondary === '#212121' ? '#fff' : ''}">${esc(team.abbr)}</b> ${esc(rec.text || '')}` +
    (rec.notes?.length ? `<div class="muted" style="margin-top:4px">${rec.notes.map((n) => esc(n.text)).join(' · ')}</div>` : '');
  renderPanels();
}

function onFinal() {
  ctl.phase = 'final';
  $('#playcard').classList.add('hidden');
  hideCaption();
  setPlaying(false);
  const g = ctl.game;
  renderScorebug(g.snapshot());
  renderPanels();
  const [a, h] = g.score;
  const winner = a === h ? null : g.teams[a > h ? 0 : 1];
  const stars = playersOfGame(g);
  const nHi = highlightIds().length;
  const el = $('#final');
  el.innerHTML = `<h3>${winner ? `${esc(winner.city)} ${esc(winner.name)} win!` : 'It ends in a tie'}</h3>
    <div class="fscore">${g.teams[0].abbr} ${a} — ${h} ${g.teams[1].abbr}</div>
    <div class="stars">${stars.map(esc).join('<br>')}</div>
    <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;justify-content:center">
      ${nHi ? `<button class="primary" id="btn-hi" type="button">▶ Watch highlights (${nHi})</button>` : ''}
      ${ctl.adventure ? '<button id="btn-adv" type="button" class="primary">Continue adventure ▶</button>' : '<button id="btn-rematch" type="button">Rematch (new seed)</button>'}<button id="btn-box" type="button">View box score</button></div>`;
  el.classList.remove('hidden');
  if (ctl.adventure) $('#btn-adv').onclick = () => leaveAdventureGame();
  else $('#btn-rematch').onclick = () => startGame(g.teams[0].id, g.teams[1].id, Math.floor(Math.random() * 1e9));
  $('#btn-box').onclick = () => { el.classList.add('hidden'); selectTab('box'); };
  if (nHi) $('#btn-hi').onclick = () => { el.classList.add('hidden'); startReplay(highlightIds(), 'Highlights'); };
}

function playersOfGame(g) {
  const out = [];
  const P = g.stats.players;
  const best = (fn, fmt) => {
    let top = null, v = -Infinity;
    for (const id in P) { const x = fn(P[id]); if (x > v) { v = x; top = id; } }
    return top && v > 0 ? fmt(g.players[top], P[top]) : null;
  };
  out.push(best((s) => s.pass.yds, (p, s) => `${p.name} (${abbrOf(g, p)}): ${s.pass.cmp}/${s.pass.att}, ${s.pass.yds} yds, ${s.pass.td} TD, ${s.pass.int} INT`));
  out.push(best((s) => s.rush.yds, (p, s) => `${p.name} (${abbrOf(g, p)}): ${s.rush.car} car, ${s.rush.yds} yds, ${s.rush.td} TD`));
  out.push(best((s) => s.rec.yds, (p, s) => `${p.name} (${abbrOf(g, p)}): ${s.rec.rec} rec, ${s.rec.yds} yds, ${s.rec.td} TD`));
  out.push(best((s) => s.def.tkl + s.def.ast * 0.5 + s.def.sck * 3 + s.def.int * 4 + s.def.pd, (p, s) => `${p.name} (${abbrOf(g, p)}): ${s.def.tkl + s.def.ast} tkl, ${s.def.sck} sck, ${s.def.int} INT, ${s.def.pd} PD`));
  return out.filter(Boolean);
}
const abbrOf = (g, p) => g.teams.find((t) => t.id === p.teamId)?.abbr || '';

// ---------------- replays & highlights
// Highlight reel: every score (not extra points / 2-pt tries), every turnover and blocked kick,
// big gains (20+ yds), big returns (30+ yds) and big sacks. Capped at 30 by dropping the
// smallest big plays; always in game order.
const HIGHLIGHT_CAP = 30;
function highlightIds() {
  const items = [];
  for (const [id, r] of ctl.history) {
    if (r.type === 'pat' || r.type === 'kneel' || r.type === 'spike') continue;
    const t = r.text || '', gain = r.gain ?? 0, ret = r.retYds ?? 0;
    let pri = 0, size = 0;
    if (['td', 'safety', 'fg'].includes(r.highlight)) pri = 3; // scores
    else if (['int', 'fumble', 'downs'].includes(r.highlight) || /BLOCKED/.test(t)) pri = 3; // turnovers, blocks
    else if (gain >= 20 || ret >= 30) { pri = 2; size = Math.max(gain, ret - 10); } // big plays
    else if (/ sacked by /.test(t) && gain <= -8) { pri = 1; size = -gain; } // big sacks
    if (pri) items.push({ id, pri, size, order: items.length });
  }
  const keep = items.slice().sort((a, b) => b.pri - a.pri || b.size - a.size).slice(0, HIGHLIGHT_CAP);
  return keep.sort((a, b) => a.order - b.order).map((x) => x.id);
}
function startReplay(ids, label = 'Replay') {
  const list = ids.map((id) => ctl.history.get(id)).filter(Boolean);
  if (!list.length) return;
  if (!ctl.replay) ctl.replay = { saved: { cur: ctl.cur, phase: ctl.phase, phaseT: ctl.phaseT, preDur: ctl.preDur, playDur: ctl.playDur, postDur: ctl.postDur, evIdx: ctl.evIdx, playing: ctl.playing } };
  ctl.replay.list = list; ctl.replay.i = 0; ctl.replay.label = label;
  $('#final').classList.add('hidden');
  playReplayItem();
  setPlaying(true);
}
function playReplayItem() {
  const R = ctl.replay, rec = R.list[R.i];
  recFrames(rec);
  ctl.cur = rec; ctl.evIdx = 0; ctl.phase = 'pre'; ctl.phaseT = 0;
  ctl.preDur = 0.7; ctl.playDur = (rec.frames.length - 1) * 0.05; ctl.postDur = 1.2;
  ctl.renderer.ensureTokens(rec, ctl.game);
  ctl.renderer.lastScale = null;
  renderPlaycard(rec);
  hideCaption();
  if (rec.before) renderScorebug(rec.before, rec); // rewind: clock, score, down & distance at the time
  showReplayBadge(`${R.label}${R.list.length > 1 ? ` ${R.i + 1}/${R.list.length}` : ''}`, rec.text);
  ctl.renderer.draw(rec, 0, ctl.game, { ...drawOpts(0), snapCamera: true });
}
function endReplay() {
  if (!ctl.replay) { hideReplayBadge(); return; }
  const s = ctl.replay.saved;
  ctl.replay = null;
  hideReplayBadge();
  Object.assign(ctl, { cur: s.cur, phase: s.phase, phaseT: s.phaseT, preDur: s.preDur, playDur: s.playDur, postDur: s.postDur, evIdx: s.evIdx });
  setPlaying(s.phase === 'final' ? false : s.playing);
  if (ctl.cur) { ctl.renderer.ensureTokens(ctl.cur, ctl.game); ctl.renderer.lastScale = null; }
  // back to the live situation
  const live = ctl.phase === 'pre' || ctl.phase === 'play' ? ctl.cur?.before : ctl.phase === 'post' ? ctl.cur?.after : null;
  renderScorebug(live || ctl.game.snapshot(), ctl.cur);
  if (ctl.cur) renderPlaycard(ctl.cur);
  if (ctl.phase === 'final' || (ctl.phase !== 'pre' && ctl.opts.playcard !== 'always')) $('#playcard').classList.add('hidden');
  if (ctl.phase === 'final') $('#final').classList.remove('hidden');
}
function showReplayBadge(label, text) {
  let b = $('#replay-badge');
  if (!b) {
    b = document.createElement('div'); b.id = 'replay-badge'; b.className = 'replay-badge';
    $('#stage').appendChild(b);
  }
  b.innerHTML = `<span class="rb-tag">⟲ ${esc(label)}</span><span class="rb-txt">${esc(text || '')}</span><button type="button" id="rb-exit" class="ghost">Exit replay</button>`;
  b.classList.remove('hidden');
  $('#rb-exit').onclick = () => endReplay();
}
function hideReplayBadge() { $('#replay-badge')?.classList.add('hidden'); }

function advance(dt) {
  if (!ctl.game || !ctl.cur) return;
  if (!ctl.replay && (ctl.phase === 'final' || ctl.phase === 'idle' || ctl.phase === 'waiting')) return;
  ctl.phaseT += dt;
  if (ctl.phase === 'pre' && ctl.phaseT >= ctl.preDur) { ctl.phase = 'play'; ctl.phaseT = 0; }
  if (ctl.phase === 'play') {
    const evs = ctl.cur.events || [];
    while (ctl.evIdx < evs.length && evs[ctl.evIdx].t + (ctl.cur.motionT || 0) <= ctl.phaseT) { showCaption(evs[ctl.evIdx].text); ctl.evIdx++; }
    if (ctl.phaseT >= ctl.playDur) {
      ctl.phase = 'post'; ctl.phaseT = 0;
      if (!ctl.replay) onPlayEnd();
      else if (ctl.cur.after) renderScorebug(ctl.cur.after, ctl.cur); // the replayed play's result
    }
  }
  if (ctl.phase === 'post' && ctl.phaseT >= ctl.postDur) {
    if (ctl.replay) {
      if (++ctl.replay.i < ctl.replay.list.length) playReplayItem(); else endReplay();
      return;
    }
    ctl.lastRec = ctl.cur;
    if (ctl.stepOnce) { ctl.stepOnce = false; setPlaying(false); }
    loadNext();
  }
}

let lastT = performance.now(), lastRaf = 0;
function frame(now, fromTimer = false) {
  if (!fromTimer) lastRaf = now;
  const dt = Math.min(0.1, (now - lastT) / 1000);
  lastT = now;
  if (ctl.playing) advance(dt * ctl.speed);
  if (ctl.cur && ctl.renderer && ctl.game) {
    const ft = ctl.phase === 'play' ? ctl.phaseT : ctl.phase === 'pre' ? 0 : ctl.playDur;
    ctl.renderer.draw(ctl.cur, ft, ctl.game, drawOpts(ft));
    if (ctl.phase === 'play' && ctl.phaseT > 0.1 && ctl.opts.playcard === 'snap') $('#playcard').classList.add('hidden');
  }
  if (!fromTimer) requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
// fallback when rAF is paused (occluded windows): keep the game moving
setInterval(() => { const now = performance.now(); if (now - lastRaf > 250) frame(now, true); }, 50);
window.__pgf = ctl;

function setPlaying(on) {
  ctl.playing = on;
  $('#btn-play').textContent = on ? '❚❚ Pause' : '▶ Play';
}
$('#btn-play').addEventListener('click', () => { if (ctl.phase === 'final' && !ctl.replay) return; ctl.stepOnce = false; setPlaying(!ctl.playing); });
$('#btn-step').addEventListener('click', () => { if (ctl.phase === 'final' || ctl.replay) return; ctl.stepOnce = true; setPlaying(true); });
$('#btn-sim').addEventListener('click', () => {
  if (!ctl.game || ctl.phase === 'final' || ctl.simming) return;
  if (ctl.replay) endReplay();
  ctl.simming = true;
  setPlaying(false);
  ctl.queue = [];
  const el = $('#final');
  el.innerHTML = '<h3 id="sim-progress">Simulating…</h3><div class="stars">The rest of the game is being simulated in the background.</div>';
  el.classList.remove('hidden');
  ctl.client.send({ type: 'simToEnd' });
});
// "Sim to 3:00": skip ahead, then resume normal play-by-play from there.
const SIM_TO_SECS = 180;
$('#btn-sim3').addEventListener('click', () => {
  if (!ctl.game || ctl.phase === 'final' || ctl.simming || !canSimTo()) return;
  if (ctl.replay) endReplay();
  ctl.simming = true;
  setPlaying(false);
  ctl.queue = [];
  const el = $('#final');
  el.innerHTML = '<h3 id="sim-progress">Simulating…</h3><div class="stars">Skipping ahead to 3:00 left in the 4th quarter.</div>';
  el.classList.remove('hidden');
  ctl.client.send({ type: 'simTo', secsLeft: SIM_TO_SECS });
});
function canSimTo() { const g = ctl.game; return !!g && !g.final && g.quarter < 5 && g.secsLeft > SIM_TO_SECS; }
function syncSimTo() { $('#btn-sim3').disabled = !canSimTo() || ctl.phase === 'final'; }
function finishSimTo(m) {
  ctl.simming = false;
  ctl.queue = []; ctl.requested = 0;
  ctl.game.apply(m.state);
  ctl.lastRec = null; // new spot on the field: snap the camera
  ctl.cur = null;
  ctl.phase = 'idle';
  $('#final').classList.add('hidden');
  renderScorebug(ctl.game.snapshot());
  renderPanels();
  $('#lastplay').innerHTML = `<span class="muted">Simulated to ${clockText(ctl.game.snap.clock)} left in the ${qText(ctl.game.quarter)} quarter. Press <b>Play</b> to watch the finish.</span>`;
  requestMore();
}

function finishSim() {
  ctl.simming = false;
  ctl.game.apply(ctl.finalState);
  const last = ctl.simLast || ctl.cur;
  if (last) { recFrames(last); ctl.cur = last; ctl.playDur = (last.frames.length - 1) * 0.05; ctl.renderer.ensureTokens(last, ctl.game); }
  ctl.phase = 'post';
  onFinal();
}

$$('.speed button').forEach((b) => {
  b.classList.toggle('on', Number(b.dataset.speed) === ctl.speed);
  b.addEventListener('click', () => {
    ctl.speed = Number(b.dataset.speed); store.set('speed', ctl.speed);
    $$('.speed button').forEach((x) => x.classList.toggle('on', x === b));
  });
});
for (const [id, key] of [['#opt-routes', 'design'], ['#opt-reads', 'reads'], ['#opt-names', 'names']]) {
  const el = $(id);
  el.checked = ctl.opts[key];
  el.addEventListener('change', () => { ctl.opts[key] = el.checked; store.set(key, el.checked); applyOpts(); });
}
$('#opt-sprites').value = ctl.opts.sprites;
$('#opt-sprites').addEventListener('change', (e) => {
  ctl.opts.sprites = e.target.value; store.set('sprites', ctl.opts.sprites);
  if (ctl.renderer) { ctl.renderer.spriteStyle = ctl.opts.sprites; if (ctl.cur) ctl.renderer.ensureTokens(ctl.cur, ctl.game); }
});
// Play card: 'snap' = shown before each snap, 'always' = stays up during plays, 'off' = never.
$('#opt-playcard').value = ctl.opts.playcard;
$('#opt-playcard').addEventListener('change', (e) => {
  ctl.opts.playcard = e.target.value; store.set('playcard', ctl.opts.playcard);
  const show = ctl.cur && ctl.phase !== 'final' && (ctl.opts.playcard === 'always' || (ctl.opts.playcard === 'snap' && ctl.phase === 'pre'));
  if (show) renderPlaycard(ctl.cur); else $('#playcard').classList.add('hidden');
});
function applyOpts() { $('#stage').classList.toggle('names', ctl.opts.names); }
applyOpts();
document.addEventListener('keydown', (e) => {
  if ($('#game').classList.contains('hidden') || e.target.matches('input, select, textarea')) return;
  if (e.code === 'Space') { e.preventDefault(); $('#btn-play').click(); }
  if (e.key === 'n') $('#btn-step').click();
});

// ==========================================================================
// Overlays
function renderPlaycard(rec) {
  const g = ctl.game, p = rec.presnap;
  if (!p) { $('#playcard').classList.add('hidden'); return; }
  const off = g.teams[p.offTeam], def = g.teams[1 - p.offTeam];
  const kick = rec.type !== 'scrimmage' && rec.type !== 'penalty';
  $('#playcard').innerHTML = `<div class="dd">${esc(p.dd)} <span class="muted" style="font-size:13px">· ${esc(p.spot)}</span></div>
    <div class="row"><span class="side" style="background:${off.colors.primary}">${off.abbr}</span><div><span class="call">${esc(p.offCall)}</span>${p.offReason ? `<div class="why">${esc(p.offReason)}</div>` : ''}</div></div>
    ${kick && !p.defReason ? '' : `<div class="row"><span class="side" style="background:${def.colors.primary}">${def.abbr}</span><div><span class="call">${esc(p.defCall)}</span>${p.defReason ? `<div class="why">${esc(p.defReason)}</div>` : ''}</div></div>`}
    ${p.decision ? `<div class="decision">${esc(p.decision)}</div>` : ''}
    ${p.audible ? `<div class="decision">Audible! ${esc(p.audible)}</div>` : ''}
    ${p.syn && (Object.keys(p.syn.off).length || Object.keys(p.syn.def).length) ? `<div class="pc-syn">${Object.keys(p.syn.off).length ? `<span class="muted">${off.abbr}</span> ${synergyChips(p.syn.off, p.syn.off, { compact: true })}` : ''} ${Object.keys(p.syn.def).length ? `<span class="muted">${def.abbr}</span> ${synergyChips(p.syn.def, p.syn.def, { compact: true })}` : ''}</div>` : ''}`;
  $('#playcard').classList.toggle('hidden', ctl.opts.playcard === 'off');
}
let toastTimer;
function showToast(text, small = false) {
  const el = $('#toast');
  el.textContent = text;
  el.style.fontSize = small ? 'clamp(18px, 3.5vw, 34px)' : '';
  el.classList.remove('hidden');
  el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), (small ? 900 : 1800) / Math.max(1, ctl.speed * 0.7));
}
let capEl;
function showCaption(text) {
  if (!capEl) {
    capEl = document.createElement('div');
    capEl.className = 'caption';
    capEl.style.cssText = 'position:absolute;left:50%;bottom:12px;transform:translateX(-50%);background:rgba(14,17,22,.85);border:1px solid #2e3844;border-radius:8px;padding:6px 12px;font-weight:700;font-size:13px;pointer-events:none;white-space:nowrap';
    $('#stage').appendChild(capEl);
  }
  capEl.textContent = text;
  capEl.style.display = '';
}
function hideCaption() { if (capEl) capEl.style.display = 'none'; }

// ==========================================================================
// Scorebug
function renderScorebug(snap, rec) {
  const g = ctl.game;
  const side = (i) => {
    const t = g.teams[i];
    const qb = g.depth[i].QB;
    const to = [0, 1, 2].map((k) => `<i class="${k < snap.timeouts[i] ? '' : 'used'}"></i>`).join('');
    return `<div class="sb-team ${i === 0 ? 'away' : 'home'}" style="background:linear-gradient(${i === 0 ? '90deg' : '270deg'}, ${t.colors.primary}55, transparent 70%)">
      <div class="logo" style="background:${t.colors.primary}"><img src="${spriteUrl(qb)}" alt="" referrerpolicy="no-referrer"></div>
      <div class="tn"><div class="city">${esc(t.city)}</div><div class="nick"><span class="full">${esc(t.name)}</span><span class="short">${esc(t.abbr)}</span></div><div class="to">${to}</div></div>
      <div class="pts">${snap.score[i]}</div>
      ${snap.poss === i && !snap.final && snap.phase !== 'kickoff' ? '<span class="poss"></span>' : ''}
    </div>`;
  };
  const dd = snap.final ? 'FINAL' : snap.phase === 'kickoff' ? 'KICKOFF' : snap.phase === 'pat' ? 'PAT' :
    `${['1st', '2nd', '3rd', '4th'][snap.down - 1]} & ${snap.goal ? 'Goal' : Math.max(1, Math.round(snap.toGo))}`;
  const spot = snap.final || snap.phase !== 'scrimmage' ? '' : `Ball on ${g.yardText(snap.ballOn, snap.poss)}`;
  $('#scorebug').innerHTML = `<div class="sb">${side(0)}
    <div class="sb-mid"><div class="sb-clock">${snap.final ? 'FINAL' : `${qText(snap.q)} · ${clockText(snap.clock)}`}</div><div class="sb-dd">${esc(dd)}</div><div class="sb-spot">${esc(spot)}</div></div>
    ${side(1)}</div>`;
}

// ==========================================================================
// Panels
$$('.tabs button').forEach((b) => b.addEventListener('click', () => selectTab(b.dataset.tab)));
function selectTab(tab) {
  $$('.tabs button').forEach((x) => x.classList.toggle('on', x.dataset.tab === tab));
  for (const t of ['pbp', 'box', 'team', 'roster']) $(`#tab-${t}`).classList.toggle('hidden', t !== tab);
  store.set('tab', tab);
}
selectTab(store.get('tab', 'pbp'));

function renderPanels() {
  const g = ctl.game;
  if (!g) return;
  syncSimTo();
  renderPBP(g, g.log.length);
  renderBox(g);
  renderTeamStats(g);
  renderRosters(g);
}

function renderPBP(g, upto) {
  const items = g.log.slice(0, upto);
  let html = '', lastQ = null, lastScore = [0, 0];
  const rows = [];
  for (const l of items) {
    const scored = l.score && (l.score[0] !== lastScore[0] || l.score[1] !== lastScore[1]);
    if (l.score) lastScore = l.score;
    rows.push({ l, scored });
  }
  for (const { l, scored } of rows.reverse()) {
    if (l.q !== lastQ) { html += `<div class="pbp-q">${l.q === 5 ? 'Overtime' : `${qText(l.q)} quarter`}</div>`; lastQ = l.q; }
    const team = l.team != null ? g.teams[l.team] : null;
    const cls = l.kind === 'sub' ? 'note sub' : l.kind === 'injury' ? 'injury' : l.kind ? 'note' : scored ? 'score' : ['int', 'fumble', 'downs'].includes(l.highlight) ? 'turnover' : '';
    html += `<div class="pbp-item ${cls}"><span class="stripe" style="background:${team ? team.colors.primary : 'transparent'}"></span><div>
      <div class="meta">${clockText(l.clock)}${l.dd ? ` · ${esc(l.dd)} at ${esc(l.spot)}` : ''}${team ? ` · ${team.abbr}` : ''}${scored ? `<span class="sc">${g.teams[0].abbr} ${l.score[0]} – ${g.teams[1].abbr} ${l.score[1]}</span>` : ''}</div>
      <div class="txt">${esc(l.text)}${l.recId && ctl.history.has(l.recId) ? ` <button type="button" class="replay-btn" data-rec="${l.recId}" title="Watch this play again">▶</button>` : ''}</div></div></div>`;
  }
  $('#tab-pbp').innerHTML = html || '<p class="muted">No plays yet.</p>';
  $$('#tab-pbp .replay-btn').forEach((b) => b.addEventListener('click', () => startReplay([Number(b.dataset.rec)])));
}

function plCell(g, id) {
  const p = g.players[id];
  return `<td class="pl"><img src="${spriteUrl(p)}" alt="" loading="lazy" referrerpolicy="no-referrer">${esc(p.name)} <span class="muted">${p.pos}</span></td>`;
}
function statTable(g, ti, title, cols, filter, row) {
  const ids = Object.keys(g.stats.players).filter((id) => g.players[id].teamId === g.teams[ti].id && filter(g.stats.players[id]));
  if (!ids.length) return '';
  ids.sort((a, b) => row(g.stats.players[b])[0] - row(g.stats.players[a])[0]);
  return `<div class="box-h">${title}</div><table class="st"><thead><tr><th>Player</th>${cols.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>
    ${ids.map((id) => `<tr>${plCell(g, id)}${row(g.stats.players[id]).slice(1).map((v) => `<td>${v}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}
function renderBox(g) {
  const qs = g.quarterScores;
  const hasOT = g.quarter === 5 || qs[0].otPts || qs[1].otPts;
  let html = `<table class="st linescore"><thead><tr><th></th><th>1</th><th>2</th><th>3</th><th>4</th>${hasOT ? '<th>OT</th>' : ''}<th>T</th></tr></thead><tbody>
    ${[0, 1].map((i) => `<tr><td>${g.teams[i].abbr}</td>${qs[i].slice(0, 4).map((v) => `<td>${v}</td>`).join('')}${hasOT ? `<td>${qs[i].otPts || 0}</td>` : ''}<td><b>${g.score[i]}</b></td></tr>`).join('')}</tbody></table>`;
  for (const ti of [0, 1]) {
    const t = g.teams[ti];
    html += `<div class="box-team"><span class="chip" style="background:${t.colors.primary}"></span>${esc(t.city)} ${esc(t.name)}</div>`;
    html += statTable(g, ti, 'Passing', ['C/Att', 'Yds', 'TD', 'Int', 'Sck', 'Lng'], (s) => s.pass.att > 0,
      (s) => [s.pass.yds, `${s.pass.cmp}/${s.pass.att}`, s.pass.yds, s.pass.td, s.pass.int, `${s.pass.sck}-${s.pass.sckY}`, s.pass.lng]);
    html += statTable(g, ti, 'Rushing', ['Car', 'Yds', 'Avg', 'TD', 'Lng'], (s) => s.rush.car > 0,
      (s) => [s.rush.yds, s.rush.car, s.rush.yds, (s.rush.yds / s.rush.car).toFixed(1), s.rush.td, s.rush.lng]);
    html += statTable(g, ti, 'Receiving', ['Rec', 'Tgt', 'Yds', 'TD', 'Lng', 'YAC'], (s) => s.rec.tgt > 0 || s.rec.rec > 0,
      (s) => [s.rec.yds, s.rec.rec, s.rec.tgt, s.rec.yds, s.rec.td, s.rec.lng, s.rec.yac]);
    html += statTable(g, ti, 'Defense', ['Tkl', 'Sck', 'TFL', 'Int', 'PD', 'FF'], (s) => s.def.tkl + s.def.ast + s.def.sck + s.def.int + s.def.pd + s.def.ff > 0,
      (s) => [s.def.tkl + s.def.ast + s.def.sck * 2 + s.def.int * 3, s.def.tkl + s.def.ast, s.def.sck, s.def.tfl, s.def.int, s.def.pd, s.def.ff]);
    html += statTable(g, ti, 'Kicking', ['FG', 'Lng', 'XP'], (s) => s.kick.fga + s.kick.xpa > 0,
      (s) => [s.kick.fgm, `${s.kick.fgm}/${s.kick.fga}`, s.kick.lng, `${s.kick.xpm}/${s.kick.xpa}`]);
    html += statTable(g, ti, 'Punting', ['P', 'Yds', 'Avg', 'Lng', 'In20'], (s) => s.punt.n > 0,
      (s) => [s.punt.n, s.punt.n, s.punt.yds, (s.punt.yds / s.punt.n).toFixed(1), s.punt.lng, s.punt.in20]);
    html += statTable(g, ti, 'Returns', ['KR', 'Yds', 'PR', 'Yds', 'TD'], (s) => s.ret.kr + s.ret.pr > 0,
      (s) => [s.ret.kry + s.ret.pry, s.ret.kr, s.ret.kry, s.ret.pr, s.ret.pry, s.ret.td]);
  }
  $('#tab-box').innerHTML = html;
}

function renderTeamStats(g) {
  const [A, B] = g.stats.teams;
  const top = (s) => clockText(s);
  const rows = [
    ['First downs', A.first, B.first],
    ['Total yards', A.yds, B.yds],
    ['Passing yards', A.passYds, B.passYds],
    ['Rushing yards', A.rushYds, B.rushYds],
    ['Plays', A.plays, B.plays],
    ['Yards / play', A.plays ? (A.yds / A.plays).toFixed(1) : '0.0', B.plays ? (B.yds / B.plays).toFixed(1) : '0.0'],
    ['3rd down', `${A.third[0]}/${A.third[1]}`, `${B.third[0]}/${B.third[1]}`],
    ['4th down', `${A.fourth[0]}/${A.fourth[1]}`, `${B.fourth[0]}/${B.fourth[1]}`],
    ['Red zone TD', `${A.rz[0]}/${A.rz[1]}`, `${B.rz[0]}/${B.rz[1]}`],
    ['Sacks allowed', A.sacked, B.sacked],
    ['Turnovers', A.to, B.to],
    ['Penalties', `${A.pen}-${A.penY}`, `${B.pen}-${B.penY}`],
    ['2-pt conversions', `${A.twoPt[0]}/${A.twoPt[1]}`, `${B.twoPt[0]}/${B.twoPt[1]}`],
    ['Time of possession', top(A.top), top(B.top)],
  ];
  let html = `<table class="st"><thead><tr><th></th><th>${g.teams[0].abbr}</th><th>${g.teams[1].abbr}</th></tr></thead><tbody>
    ${rows.map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join('')}</tbody></table>`;
  // drives
  const drives = g.drives.slice(-24).reverse();
  if (drives.length) {
    html += `<div class="box-h">Drives</div><table class="st"><thead><tr><th>Team</th><th>Q</th><th>Start</th><th>Plays</th><th>Yds</th><th>Result</th></tr></thead><tbody>
      ${drives.map((d) => `<tr><td><span class="chip" style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${g.teams[d.team].colors.primary}"></span> ${g.teams[d.team].abbr}</td><td>${qText(d.startQ)}</td><td>${esc(g.yardText(d.startOn, d.team))}</td><td>${d.plays}</td><td>${d.yds}</td><td>${esc(d.result)}</td></tr>`).join('')}</tbody></table>`;
  }
  $('#tab-team').innerHTML = html;
}

let rosterTeam = 0;
function renderRosters(g) {
  const t = g.teams[rosterTeam];
  const D = g.depth[rosterTeam];
  const energyBar = (c) => {
    const e = Math.round(D.energy[c.id]);
    const col = e >= 80 ? '#3fb950' : e >= 60 ? '#ffcb05' : '#f85149';
    return `<span class="en" title="Energy ${e}%"><i style="width:${e}%;background:${col}"></i></span>`;
  };
  const onField = new Set(Object.values(D.onField).map((c) => c.id));
  const row = (c, slotLabel) => {
    const labels = STAT_LABELS[c.pos];
    const tip = STAT_KEYS.map((k) => `${labels[k]} ${c.base[k]}`).join(' · ');
    const top = STAT_KEYS.slice().sort((a, b) => c.base[b] - c.base[a]).slice(0, 2).map((k) => `${labels[k]} ${c.base[k]}`).join(', ');
    return `<tr title="${esc(tip)} · ${c.height} m, ${c.weight} kg" class="${onField.has(c.id) ? '' : 'dim'}">
      <td class="pl"><img src="${spriteUrl(c)}" alt="" loading="lazy" referrerpolicy="no-referrer"><div><b>${esc(c.name)}</b> <span class="muted">${slotLabel}</span><br>${typeChips(c.types)}</div></td>
      <td class="ovr">${c.ovr}</td><td class="best">${esc(top)}</td><td>${energyBar(c)}</td></tr>`;
  };
  const starters = STARTERS.map((s) => row(D.cards[s.key], s.label === 'FLEX' ? `FLEX ${D.cards[s.key].pos}` : s.label));
  const bench = BENCH.map((s) => D.cards[s.key]).filter((c) => !c.convertedTo).map((c, i) => row(c, `Backup ${c.pos}`));
  const hurt = (D.injuredCards || []).filter((c) => !c.convertedTo).map((c) => `<tr class="dim"><td class="pl"><img src="${spriteUrl(c)}" alt="" loading="lazy" referrerpolicy="no-referrer"><div><b>${esc(c.name)}</b> <span class="muted">${c.pos}</span></div></td><td colspan="3" class="inj">✚ Out for the game</td></tr>`);
  $('#tab-roster').innerHTML = `<div class="roster-sw">${[0, 1].map((i) => `<button type="button" data-rt="${i}" class="${i === rosterTeam ? 'on' : ''}">${esc(g.teams[i].city)} ${esc(g.teams[i].name)}</button>`).join('')}</div>
    <div class="muted" style="font-size:12px;margin-bottom:6px">${esc(t.coach.name)} · ${esc(t.coach.style)} · ${PERSONNEL[D.personnel].name} offense · ${FRONTS[D.front].name} defense. Faded rows are off the field right now. Hover a player to see what each stat means at that position.</div>
    <div class="b-syn"><span class="muted small">Offense on field</span> ${synergyChips(D.synergy.O.counts, D.synergy.O.active)}</div>
    <div class="b-syn" style="margin-bottom:8px"><span class="muted small">Defense on field</span> ${synergyChips(D.synergy.D.counts, D.synergy.D.active)}</div>
    <table class="st"><thead><tr><th>Starters</th><th>OVR</th><th>Best traits</th><th>Energy</th></tr></thead><tbody>${starters.join('')}</tbody></table>
    <table class="st"><thead><tr><th>Bench</th><th>OVR</th><th>Best traits</th><th>Energy</th></tr></thead><tbody>${bench.join('')}</tbody></table>
    ${hurt.length ? `<table class="st"><thead><tr><th>Injured</th><th colspan="3"></th></tr></thead><tbody>${hurt.join('')}</tbody></table>` : ''}`;
  $$('#tab-roster [data-rt]').forEach((b) => b.addEventListener('click', () => { rosterTeam = Number(b.dataset.rt); renderRosters(g); }));
}

// ==========================================================================
// Boot
initAdventure({ showScreen, startBattle });
renderTeamGrid();
if (location.hash === '#adventure') showAdventureHome();
const qp = new URLSearchParams(location.search);
if (qp.get('team')) importDialog(qp.get('team'));
if (qp.get('away') && qp.get('home') && findTeam(qp.get('away')) && findTeam(qp.get('home'))) {
  sel.away = qp.get('away'); sel.home = qp.get('home');
  if (qp.get('seed')) $('#seed').value = qp.get('seed');
  syncSetup();
}

// ==========================================================================
// Player hover card
const OFF_CARD_POS = new Set(['QB', 'RB', 'WR', 'TE', 'OL']);
let pcardSticky = false;
function showPlayerCard(pid, el, sticky = false) {
  let card = $('#pcard');
  if (!pid) { if (!pcardSticky && card) card.classList.add('hidden'); return; }
  const g = ctl.game;
  const p = g?.players[pid];
  if (!p) return;
  if (!card) {
    card = document.createElement('div'); card.id = 'pcard'; card.className = 'pcard hidden';
    $('#stage').appendChild(card);
    $('#stage').addEventListener('click', () => { pcardSticky = false; card.classList.add('hidden'); });
  }
  pcardSticky = sticky;
  const ti = g.teams.findIndex((t) => t.id === p.teamId);
  const team = g.teams[ti];
  const D = g.depth[ti];
  const unit = p.pos === 'K' ? null : OFF_CARD_POS.has(p.pos) ? 'O' : 'D';
  const active = unit ? D.synergy[unit].active : {};
  const syn = p.types.filter((t) => active[t]);
  const e = Math.round(D.energy[pid] ?? 100);
  const labels = STAT_LABELS[p.pos];
  const stats = STAT_KEYS.map((k) => `<div class="pc-row"><span>${labels[k]}</span><i><b style="width:${Math.min(100, p.base[k] / 1.6)}%"></b></i><em>${p.base[k]}</em></div>`).join('');
  card.innerHTML = `<div class="pc-head" style="border-color:${team.colors.primary}">
      <img src="${spriteUrl(p)}" alt="" referrerpolicy="no-referrer">
      <div><b>${esc(p.name)}</b> <span class="muted">${p.pos}${p.outOfPosition ? ` (normally ${p.outOfPosition})` : ''}</span><br>${typeChips(p.types)}</div>
      <div class="pc-ovr">${p.ovr}<small>OVR</small></div></div>
    ${stats}
    <div class="pc-foot"><span>Energy</span><span class="en"><i style="width:${e}%;background:${e >= 80 ? '#3fb950' : e >= 60 ? '#ffcb05' : '#f85149'}"></i></span><b>${e}%</b></div>
    ${syn.length ? `<div class="pc-syn">${synergyChips(Object.fromEntries(syn.map((t) => [t, 1])), Object.fromEntries(syn.map((t) => [t, active[t]])), { compact: true })}</div>` : ''}
    ${p.injured ? '<div class="pc-inj">✚ Injured</div>' : ''}`;
  card.classList.remove('hidden');
  // position next to the token, kept inside the stage
  const sr = $('#stage').getBoundingClientRect(), r = el.getBoundingClientRect();
  const w = card.offsetWidth, h = card.offsetHeight;
  let x = r.right - sr.left + 8, y = r.top - sr.top - h / 2;
  if (x + w > sr.width - 6) x = r.left - sr.left - w - 8;
  card.style.left = `${Math.max(6, x)}px`;
  card.style.top = `${Math.max(6, Math.min(sr.height - h - 6, y))}px`;
}
