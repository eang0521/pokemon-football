// Adventure mode screens: saved runs, the act map, every kind of stop, and the roster editor.
// Game logic lives in ./run.js; battles are played in the normal game viewer via hooks.
import * as A from './run.js';
import { ovrOf, pctOfCard, rarityOf, keyStats } from './cards.js';
import { POKEMON } from '../data/pokemon.js';
import { COACH_PRESETS } from '../data/teams.js';
import { STAT_KEYS, STAT_LABELS, POSITIONS, cardOverall } from '../ratings.js';
import { ALL_SLOTS, STARTERS, BENCH, PERSONNEL, FRONTS, personnelOf, frontOf } from '../roster.js';
import { spriteUrl } from '../render.js';
import { TYPE_COLORS, synergyChips, unitCounts, coachControls } from '../builder.js';
import { openModal, closeModal } from '../modal.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const typeChips = (types) => `<span class="types">${types.map((t) => `<span class="type" style="background:${TYPE_COLORS[t] || '#666'}">${t}</span>`).join('')}</span>`;
const ord = (n) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`; };
const mon = (c) => POKEMON[c.mon];
const nm = (c) => `${mon(c).name} (${c.pos})`;

// ---------------------------------------------------------------- saves
const KEY = 'pgf:adventures';
function loadRuns() { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } }
function writeRuns(list) { try { localStorage.setItem(KEY, JSON.stringify(list)); return true; } catch { return false; } }
function save() {
  if (!run) return;
  run.updated = Date.now();
  const list = loadRuns().filter((r) => r.id !== run.id);
  list.unshift(run);
  if (!writeRuns(list)) flash('Could not save: browser storage is full or blocked.');
}
function deleteRun(id) { writeRuns(loadRuns().filter((r) => r.id !== id)); }

// ---------------------------------------------------------------- state
let H = null; // hooks from main.js: { showScreen, startBattle }
let run = null;
let msg = null; // one-off message shown at the top of the current stop
const root = () => $('#adv-root');

export function initAdventure(hooks) {
  H = hooks;
  root().addEventListener('click', onClick);
  // remember whether the shop's "Sell cards" section is open across re-renders
  root().addEventListener('toggle', (e) => {
    if (!run?.node) return;
    if (e.target.matches?.('.shop-sell')) run.node.sellOpen = e.target.open;
    if (e.target.matches?.('.shop-team')) run.node.teamClosed = !e.target.open;
  }, true);
}
export function showAdventureHome() { run = null; H.showScreen('adventure'); renderHome(); }
export function showAdventure() { H.showScreen('adventure'); if (run) render(); else renderHome(); }
const flash = (text) => { msg = text; };

// ---------------------------------------------------------------- card tiles
function cardTile(c, { extra = '', cls = '', note = '' } = {}) {
  const p = mon(c), ovr = ovrOf(c), pct = pctOfCard(c), rar = rarityOf(pct);
  const trained = c.bonus && Object.keys(c.bonus).length;
  const base = { ...p.stats };
  if (trained) for (const k in c.bonus) base[k] += c.bonus[k];
  const tip = STAT_KEYS.map((k) => `${STAT_LABELS[c.pos][k]} ${base[k]}${c.bonus?.[k] ? ` (+${c.bonus[k]})` : ''}`).join(' · ');
  return `<div class="acard r-${rar.key}${c.inj > 0 ? ' inj' : ''} ${cls}" title="${esc(tip)}">
    <img src="${spriteUrl(p)}" alt="" loading="lazy" referrerpolicy="no-referrer">
    <div class="ac-id"><b>${esc(p.name)}</b><div><span class="ac-pos">${c.pos}</span> ${typeChips(p.types)}</div>${note ? `<div class="ac-note">${note}</div>` : ''}</div>
    <div class="ac-ovr">${ovr}<small>${ord(pct)}</small></div>
    ${trained ? '<span class="ac-plus" title="Trained">▲</span>' : ''}
    ${c.inj > 0 ? `<span class="ac-inj" title="Injured: misses ${c.inj} more battle${c.inj > 1 ? 's' : ''}">✚ ${c.inj}</span>` : ''}
    ${extra}
  </div>`;
}
// "What would this card do for my team?" (cached until the collection changes)
const impactCache = new Map();
function impacts(cands) {
  const sig = run.cards.map((c) => `${c.uid}${c.pos}${c.inj > 0 ? 'i' : ''}${JSON.stringify(c.bonus || {})}`).join(',');
  const key = `${run.id}|${sig}|${cands.map((c) => `${c.mon}:${c.pos}`).join(',')}`;
  if (!impactCache.has(key)) { if (impactCache.size > 40) impactCache.clear(); impactCache.set(key, A.previewAdditions(run, cands)); }
  return impactCache.get(key);
}
const slotName = (s) => (s.unit === 'B' ? `backup ${s.label}` : s.label === 'FLEX' ? `FLEX (${s.unit === 'O' ? 'offense' : 'defense'})` : s.label);
function impactHTML(p) {
  if (!p) return '';
  if (p.role === 'starter') {
    if (p.delta == null) return `<div class="ac-imp up">▲ Starts at ${esc(slotName(p.slot))}${p.dropped ? ` over ${esc(mon(p.dropped).name)}` : ''}</div>`;
    const d = p.delta >= 0.05 ? `+${p.delta.toFixed(1)} team OVR` : 'Starter';
    return `<div class="ac-imp up">▲ ${d} · starts at ${esc(slotName(p.slot))}${p.dropped ? ` over ${esc(mon(p.dropped).name)}` : ''}${p.syn.length ? ` · <b>${esc(p.syn.join(', '))}</b>` : ''}</div>`;
  }
  if (p.role === 'bench') return `<div class="ac-imp">Would be your ${esc(slotName(p.slot))}</div>`;
  return '<div class="ac-imp none">Wouldn&rsquo;t make your lineup</div>';
}
function lineupPanel(n) {
  const tr = A.teamRating(run);
  const row = (s) => {
    const c = A.cardByUid(run, run.lineup[s.key]);
    return `<div class="lm${c && c.inj > 0 ? ' inj' : ''}"><span class="lm-s">${esc(s.label === 'FLEX' ? `FLEX` : s.label)}</span>${c ? `<img src="${spriteUrl(mon(c))}" alt="" loading="lazy" referrerpolicy="no-referrer"><span class="lm-n">${esc(mon(c).name)} <small>${c.pos}</small></span><b>${ovrOf(c)}</b>` : '<span class="lm-n muted">walk-on</span><b>–</b>'}</div>`;
  };
  return `<details class="shop-team" ${n.teamClosed ? '' : 'open'}><summary>Your lineup · Team <b>${tr.ovr}</b> OVR (${ord(tr.pct)})</summary>
    <div class="lineup-mini">${STARTERS.map(row).join('')}</div>
    <div class="lineup-mini bench"><span class="muted small">Bench</span>${BENCH.map(row).join('')}</div>
    <div class="adv-actions"><button type="button" data-act="roster">Edit lineup</button></div></details>`;
}
const rosterCards = (roster) => ALL_SLOTS.map((s) => { const [m, p] = String(roster[s.key]).split(':'); return { slot: s, c: { mon: m, pos: p || s.pos[0] } }; });

const livesText = (r) => (A.hasLives(r) ? `${'♥'.repeat(Math.max(0, r.lives))}${'♡'.repeat(Math.max(0, r.maxLives - r.lives))}` : '♥ ∞');

// ---------------------------------------------------------------- home
function renderHome() {
  const runs = loadRuns();
  const tags = (r) => `${r.options?.endless ? ' · Endless' : ''}${r.options?.noLives ? ' · No lives' : ''}`;
  const status = (r) => r.status === 'won' ? '<span class="adv-st won">🏆 Champions</span>' : r.status === 'lost' ? `<span class="adv-st lost">Eliminated in act ${r.act}${tags(r)}</span>`
    : r.status === 'retired' ? `<span class="adv-st">Retired in act ${r.act}${tags(r)}</span>`
    : `<span class="adv-st">Act ${r.act} · ${livesText(r)} · ${r.coins} coins${tags(r)}</span>`;
  root().innerHTML = `<section class="adv-home">
    <div class="adv-intro">
      <h2>Adventure</h2>
      <p>Start with a scrappy team of weak cards and fight your way through three acts. Choose your route: battle random teams, take on elite teams for bigger rewards, open packs, shop, train, rest, and handle surprises. Opponents get better as you go. Each act ends with a boss, and you have 3 lives. Want more? Turn on <b>Endless</b> (the acts never stop) or <b>No lives</b> (losses never end your run).</p>
      <button type="button" class="primary" data-act="new">＋ New adventure</button>
    </div>
    <h3 class="adv-h">Saved adventures</h3>
    ${runs.length ? `<div class="adv-saves">${runs.map((r) => `<div class="adv-save">
      <div class="band" style="background:linear-gradient(120deg, ${r.team.colors.primary}, ${r.team.colors.primary} 60%, ${r.team.colors.secondary})"><span class="abbr">${esc(r.team.abbr)}</span></div>
      <div class="info"><b>${esc(r.team.city)} ${esc(r.team.name)}</b>${status(r)}
        <div class="muted small">Record ${r.stats.w}-${r.stats.l}${r.stats.t ? `-${r.stats.t}` : ''} · ${r.path.length} stops · ${r.cards.length} cards · ${new Date(r.updated).toLocaleDateString()}</div></div>
      <div class="acts"><button type="button" class="${r.status === 'active' ? 'primary' : ''}" data-act="open" data-id="${r.id}">${r.status === 'active' ? 'Continue' : 'View'}</button>
        <button type="button" class="ghost danger" data-act="del" data-id="${r.id}">Delete</button></div>
    </div>`).join('')}</div>` : '<p class="muted">No adventures yet.</p>'}
  </section>`;
}

const CITY_IDEAS = ['Pallet', 'Twinleaf', 'Littleroot', 'Nuvema', 'Vaniville', 'Postwick', 'Cabo Poco', 'Iki', 'New Bark'];
const NAME_IDEAS = ['Underdogs', 'Rookies', 'Hopefuls', 'Longshots', 'Mavericks', 'Wildcards', 'Scrappers'];
function newDialog() {
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const city = pick(CITY_IDEAS), name = pick(NAME_IDEAS);
  const coach = { name: 'Coach You', preset: 'balanced', ...COACH_PRESETS.balanced };
  openModal(`<h3>New adventure</h3>
    <p class="muted small">Name your team. You'll start with 23 random cards from the 5th to 15th percentile at their positions.</p>
    <div class="adv-form">
      <label>City <input id="n-city" maxlength="16" value="${esc(city)}"></label>
      <label>Team name <input id="n-name" maxlength="16" value="${esc(name)}"></label>
      <label>Abbr. <input id="n-abbr" maxlength="3" value="${esc(city.slice(0, 3).toUpperCase())}" class="abbr"></label>
      <label>Primary <input id="n-c1" type="color" value="#2e7d32"></label>
      <label>Secondary <input id="n-c2" type="color" value="#ffcb05"></label>
    </div>
    <div class="adv-opts">
      <label><input type="checkbox" id="n-endless"> <b>Endless</b> <span class="muted small">No final act: after the Champion, Legend tiers keep getting tougher</span></label>
      <label><input type="checkbox" id="n-nolives"> <b>No lives</b> <span class="muted small">Losses never end the run (you still have to beat each boss to move on)</span></label>
    </div>
    <details class="b-coach" open><summary>Coach tendencies</summary><div id="n-coach"></div></details>
    <p class="muted small">You can change these any time during the adventure with the <b>Coach</b> button.</p>
    <div class="modal-actions"><button type="button" class="primary" id="n-go">Start adventure</button><button type="button" class="ghost" data-close>Cancel</button></div>`, (d) => {
    coachControls($('#n-coach', d), coach);
    $('#n-go', d).onclick = () => {
      const v = (id) => $(id, d).value.trim();
      const team = {
        city: v('#n-city') || 'Pallet', name: v('#n-name') || 'Underdogs', abbr: (v('#n-abbr') || 'YOU').toUpperCase().slice(0, 3),
        colors: { primary: v('#n-c1'), secondary: v('#n-c2') },
        coach,
      };
      run = A.newRun({ team, options: { endless: $('#n-endless', d).checked, noLives: $('#n-nolives', d).checked } });
      save();
      closeModal();
      flash('Your starting roster is ready. Pick your first stop on the map.');
      render();
    };
  });
}

// ---------------------------------------------------------------- run screen
function render() {
  if (!run) return renderHome();
  const tr = A.teamRating(run);
  const hearts = livesText(run);
  const top = `<div class="adv-top" style="--tc:${run.team.colors.primary}">
    <div class="adv-team"><span class="chip" style="background:${run.team.colors.primary};border-color:${run.team.colors.secondary}"></span><b>${esc(run.team.city)} ${esc(run.team.name)}</b></div>
    <div class="adv-stats">
      <span title="Act">Act <b>${A.isEndless(run) ? run.act : Math.min(run.act, A.ACTS)}</b>${A.isEndless(run) ? ' <span class="muted">(endless)</span>' : `/${A.ACTS}`}</span>
      <span class="hearts" title="Lives">${hearts}</span>
      <span title="Coins">🪙 <b>${run.coins}</b></span>
      <span title="Average overall of your 15 starters (and their average percentile)">Team <b>${tr.ovr}</b> OVR <span class="muted">(${ord(tr.pct)})</span></span>
      <span title="Win-loss record">${run.stats.w}-${run.stats.l}${run.stats.t ? `-${run.stats.t}` : ''}</span>
    </div>
    <div class="adv-btns"><button type="button" data-act="roster">Roster</button><button type="button" data-act="coach" title="Coaching tendencies: pass rate, blitzing, coverage, tempo…">Coach</button><button type="button" data-act="log">Log</button>${run.status === 'active' && !A.hasLives(run) ? '<button type="button" class="ghost" data-act="retire" title="End this run and see the summary">Retire</button>' : ''}<button type="button" class="ghost" data-act="home">Saves</button></div>
  </div>`;
  let body;
  if (run.status !== 'active' && !(run.node && run.node.stage === 'result')) body = summaryHTML();
  else if (run.node) body = nodeHTML();
  else body = mapHTML();
  root().innerHTML = `${top}${msg ? `<div class="adv-msg">${esc(msg)}</div>` : ''}<div class="adv-body">${body}</div>`;
  msg = null;
}

// ---------------------------------------------------------------- map
function mapHTML() {
  const m = A.mapOf(run);
  const avail = new Set(A.available(run).map((n) => `${n.row}:${n.col}`));
  const done = run.path.filter((p) => p.act === run.act);
  const doneSet = new Set(done.map((p) => `${p.row}:${p.col}`));
  const rowH = 76, pad = 34, h = pad * 2 + A.ROWS * rowH;
  const X = (col) => ((col + 0.5) / 5) * 100, Y = (row) => pad + row * rowH;
  const lines = [];
  const walked = new Set(done.slice(1).map((p, i) => `${done[i].row}:${done[i].col}>${p.row}:${p.col}`));
  m.rows.forEach((row, r) => row.forEach((n) => {
    const targets = r === A.ROWS - 1 ? [{ row: A.ROWS, col: 2 }] : n.next.map((c) => ({ row: r + 1, col: c }));
    for (const t of targets) {
      const on = walked.has(`${r}:${n.col}>${t.row}:${t.col}`);
      lines.push(`<line x1="${X(n.col)}" y1="${Y(r)}" x2="${X(t.col)}" y2="${Y(t.row)}" class="${on ? 'walked' : ''}" vector-effect="non-scaling-stroke"/>`);
    }
  }));
  const node = (n) => {
    const k = `${n.row}:${n.col}`, info = A.NODE_INFO[n.type];
    const cur = run.pos && run.pos.row === n.row && run.pos.col === n.col;
    return `<button type="button" class="mnode t-${n.type}${avail.has(k) ? ' avail' : ''}${doneSet.has(k) ? ' done' : ''}${cur ? ' cur' : ''}"
      style="left:${X(n.col)}%;top:${Y(n.row)}px" ${avail.has(k) ? `data-act="enter" data-r="${n.row}" data-c="${n.col}"` : 'tabindex="-1"'}
      title="${esc(info.name)}: ${esc(info.desc)}" aria-label="${esc(info.name)}">${info.icon}</button>`;
  };
  const nodes = [...m.rows.flat().map(node), node(m.boss)];
  const bossName = A.bossTitle(run.act);
  return `<div class="adv-mapwrap">
    <div class="adv-maphead"><h3>Act ${run.act}: road to the ${esc(bossName)}</h3>
      <p class="muted small">${avail.size ? 'Choose a highlighted stop. You can only move forward along the lines.' : ''}</p></div>
    <div class="adv-map" style="height:${h}px">
      <svg viewBox="0 0 100 ${h}" preserveAspectRatio="none" aria-hidden="true">${lines.join('')}</svg>
      ${nodes.join('')}
      <div class="boss-label" style="top:${Y(A.ROWS) + 28}px">${esc(bossName)}</div>
    </div>
    <div class="adv-legend">${Object.entries(A.NODE_INFO).map(([, i]) => `<span>${i.icon} ${esc(i.name)}</span>`).join('')}</div>
  </div>`;
}

// ---------------------------------------------------------------- stops
function nodeHTML() {
  const n = run.node;
  const info = A.NODE_INFO[n.type];
  const head = `<div class="adv-nodehead"><span class="nicon">${info.icon}</span><div><h3>${esc(n.type === 'boss' ? `${A.bossTitle(run.act)} battle` : info.name)}</h3><div class="muted small">Act ${run.act} · stop ${n.row === A.ROWS ? 'boss' : n.row + 1}</div></div></div>`;
  const fn = { battle: battleHTML, elite: battleHTML, boss: battleHTML, pack: packHTML, shop: shopHTML, training: trainingHTML, rest: restHTML, event: eventHTML }[n.type];
  return `<div class="adv-node">${head}${fn(n)}</div>`;
}
const cont = (label = 'Continue ▶') => `<div class="adv-actions"><button type="button" class="primary" data-act="done">${label}</button></div>`;

function verdict(diff) {
  if (diff >= 8) return ['Heavy favorite', 'good'];
  if (diff >= 3) return ['Favored', 'good'];
  if (diff > -3) return ['Even matchup', ''];
  if (diff > -8) return ['Underdog', 'warn'];
  return ['Big underdog', 'bad'];
}

function battleHTML(n) {
  if (n.stage === 'result') return resultHTML(n);
  const o = n.opponent, orat = A.opponentRating(o), mine = A.teamRating(run);
  const [vtext, vcls] = verdict(mine.pct - orat.pct);
  const kind = n.type === 'boss' ? `${A.bossTitle(run.act)}` : n.type === 'elite' ? 'Elite team' : 'Opponent';
  const oc = rosterCards(o.roster);
  const starters = oc.filter((x) => x.slot.unit !== 'B');
  const uo = unitCounts(o.roster, 'O'), ud = unitCounts(o.roster, 'D');
  const gaps = A.lineupGaps(run);
  const my = A.gameTeam(run);
  const mo = unitCounts(my.roster, 'O'), md = unitCounts(my.roster, 'D');
  return `<div class="adv-vs">
    <div class="opp-card">
      <div class="band" style="background:linear-gradient(120deg, ${o.colors.primary}, ${o.colors.primary} 60%, ${o.colors.secondary})">
        <span class="kind ${n.type}">${esc(kind)}</span><span class="abbr">${esc(o.abbr)}</span></div>
      <div class="info">
        <div class="tname">${esc(o.city)} ${esc(o.name)}</div>
        <div class="muted small">${esc(o.coach.name)} · ${esc(o.coach.style)} · ${PERSONNEL[personnelOf(o.roster)].name} offense · ${FRONTS[frontOf(o.roster)].name} defense${o.theme ? ` · ${typeChips([o.theme])} theme` : ''}</div>
        <div class="unit-row"><span class="unit-lab">OFF</span>${synergyChips(uo.counts, uo.active, { compact: true, onlyActive: true }) || '<span class="muted small">no synergies</span>'}</div>
        <div class="unit-row"><span class="unit-lab">DEF</span>${synergyChips(ud.counts, ud.active, { compact: true, onlyActive: true }) || '<span class="muted small">no synergies</span>'}</div>
      </div>
    </div>
    <div class="vs-meter">
      <div><span class="muted small">You</span><b>${mine.ovr}</b><span class="muted small">${ord(mine.pct)}</span></div>
      <div class="vs-v ${vcls}">${vtext}</div>
      <div><span class="muted small">Them</span><b>${orat.ovr}</b><span class="muted small">${ord(orat.pct)}</span></div>
    </div>
  </div>
  <div class="unit-row mine"><span class="unit-lab">YOUR OFF</span>${synergyChips(mo.counts, mo.active, { compact: true, onlyActive: true }) || '<span class="muted small">no synergies</span>'}
    <span class="unit-lab">YOUR DEF</span>${synergyChips(md.counts, md.active, { compact: true, onlyActive: true }) || '<span class="muted small">no synergies</span>'}</div>
  ${gaps.length ? `<div class="adv-warn">⚠ ${gaps.length} roster slot${gaps.length > 1 ? 's' : ''} (${gaps.map((s) => s.label).join(', ')}) will be filled by weak walk-ons. Check your <a href="#" data-act="roster">roster</a>.</div>` : ''}
  ${n.attempt ? `<div class="adv-msg">Rematch ${n.attempt + 1}: the boss is waiting.</div>` : ''}
  <div class="b-gtitle">Their starters</div>
  <div class="acard-grid">${starters.map((x) => cardTile(x.c, { note: x.slot.label === 'FLEX' ? 'FLEX' : '' })).join('')}</div>
  <div class="adv-actions"><button type="button" class="primary big" data-act="play">Kick off ▶</button><button type="button" data-act="roster">Edit lineup</button></div>
  <p class="muted small">Watch the game or hit <b>Sim to end</b>. If you leave the game early, the result isn't counted and you can play it again.</p>`;
}

function resultHTML(n) {
  const r = n.result, o = n.opponent;
  const title = r.win ? 'Victory!' : r.tie ? 'Tie game' : 'Defeat';
  const lines = [];
  lines.push(`🪙 +${r.coins} coins`);
  if (r.lifeLost) lines.push('💔 Lost a life');
  if (r.lifeGained) lines.push('❤️ Boss beaten: recovered a life');
  if (r.hurt.length) lines.push(`✚ Injured (out ${A.INJURY_GAMES} battles): ${r.hurt.map(esc).join(', ')}`);
  let after;
  if (run.status === 'lost') after = `<div class="adv-actions"><button type="button" class="primary" data-act="end">See how it went</button></div>`;
  else if (r.retry) after = `<p>${r.tie ? 'A tie won\'t do: you have to beat the boss to move on.' : 'The boss is still standing. Regroup and try again.'}</p><div class="adv-actions"><button type="button" class="primary" data-act="retry">Rematch</button></div>`;
  else {
    const picks = r.picks || 1, taken = r.drafted || [];
    const left = picks - taken.length;
    const imp = left > 0 ? impacts(r.draft) : [];
    const draft = r.draft.length ? `<div class="b-gtitle">Draft ${picks > 1 ? `${picks} cards` : 'a card'} from the ${esc(o.city)} ${esc(o.name)} ${left > 0 ? `(${left} left)` : ''}</div>
      <div class="acard-grid">${r.draft.map((c, i) => cardTile(c, {
        cls: taken.includes(i) ? 'picked' : '',
        extra: taken.includes(i) ? '<span class="ac-tag">Drafted</span>' : left > 0 ? `${impactHTML(imp[i])}<button type="button" class="ac-btn" data-act="draft" data-i="${i}">Draft</button>` : '',
      })).join('')}</div>` : '';
    after = `${draft}${cont(left > 0 && r.draft.length ? 'Skip draft ▶' : n.type === 'boss' ? (run.act >= A.ACTS && !A.isEndless(run) ? 'Claim the title ▶' : `On to act ${run.act + 1} ▶`) : 'Back to the map ▶')}`;
  }
  return `<div class="adv-result ${r.win ? 'win' : r.tie ? 'tie' : 'loss'}">
    <h2>${title}</h2><div class="fscore">${esc(run.team.abbr)} ${r.pf} — ${r.pa} ${esc(o.abbr)}</div>
    <ul>${lines.map((l) => `<li>${l}</li>`).join('')}</ul></div>${after}`;
}

function packHTML(n) {
  if (!n.taken) return `<div class="pack-closed"><div class="pack-art">🎁</div><p>A pack of 5 cards. Rarer cards are stronger at their position.</p>
    <div class="adv-actions"><button type="button" class="primary big" data-act="openpack">Open pack</button></div></div>`;
  const im = n.impact;
  const role = (i) => {
    const r = im?.roles[i];
    if (!r) return '';
    const slot = ALL_SLOTS.find((s) => s.key === r.slot);
    return impactHTML({ ...r, slot, delta: null, dropped: r.over ? A.cardByUid(run, r.over) : null });
  };
  const summary = im ? (im.delta >= 0.05
    ? `<div class="adv-msg">This pack improves your best lineup by <b>+${im.delta.toFixed(1)} team OVR</b>${im.syn.length ? ` and switches on <b>${esc(im.syn.join(', '))}</b>` : ''}.${run.autoManage === false ? ' Auto-manage is off, so use <b>Best lineup now</b> in the roster to apply it.' : ''}</div>`
    : `<div class="adv-msg">None of these cards would improve your best lineup${im.roles.some((r) => r.role === 'bench') ? ', but some add depth on the bench' : ''}.</div>`) : '';
  return `${summary}<div class="acard-grid reveal">${n.pack.map((c, i) => cardTile(c, { extra: `${role(i)}<span class="ac-rar">${rarityOf(pctOfCard(c)).name}</span>` })).join('')}</div>
    <p class="muted small">All 5 cards were added to your collection.${run.autoManage !== false ? ' Your lineup was updated with any upgrades.' : ''}</p>${cont()}`;
}

function shopHTML(n) {
  const s = n.shop;
  const inLineup = new Set(Object.values(run.lineup));
  const sellable = run.cards.slice().sort((a, b) => (inLineup.has(a.uid) - inLineup.has(b.uid)) || ovrOf(a) - ovrOf(b));
  const imp = impacts(s.cards.filter((c) => !c.sold));
  const impOf = (c) => imp[s.cards.filter((x) => !x.sold).indexOf(c)];
  return `${lineupPanel(n)}<div class="b-gtitle">Cards for sale · you have 🪙 ${run.coins}</div>
    <div class="acard-grid">${s.cards.map((c, i) => cardTile(c, {
      cls: c.sold ? 'picked' : '',
      extra: c.sold ? '<span class="ac-tag">Sold</span>' : `${impactHTML(impOf(c))}<button type="button" class="ac-btn" data-act="buy" data-i="${i}" ${run.coins < c.price ? 'disabled' : ''}>🪙 ${c.price}</button>`,
    })).join('')}</div>
    <div class="b-gtitle">Services</div>
    <div class="shop-items">${s.items.map((it) => {
      const na = it.sold || run.coins < it.price || (it.key === 'life' && run.lives >= run.maxLives) || (it.key === 'heal' && !run.cards.some((c) => c.inj > 0));
      return `<div class="shop-item"><span>${esc(it.name)}</span><button type="button" data-act="item" data-k="${it.key}" ${na ? 'disabled' : ''}>${it.sold ? 'Bought' : `🪙 ${it.price}`}</button></div>`;
    }).join('')}</div>
    <details class="shop-sell" ${n.sellOpen ? 'open' : ''}><summary>Sell cards (${run.cards.length} in your collection)</summary>
      <p class="muted small">Cards in your lineup are marked. If you sell one, the next best card takes its slot.</p>
      <div class="acard-grid">${sellable.map((c) => cardTile(c, {
        note: inLineup.has(c.uid) ? 'in lineup' : 'reserve',
        extra: `<button type="button" class="ac-btn ghost" data-act="sell" data-u="${c.uid}">Sell 🪙 ${A.cardSellValue(c)}</button>`,
      })).join('')}</div></details>
    ${cont('Leave shop ▶')}`;
}

function trainingHTML(n) {
  if (n.done) return cont();
  const amt = A.trainingAmount(run);
  const lineup = ALL_SLOTS.map((s) => ({ s, c: A.cardByUid(run, run.lineup[s.key]) })).filter((x) => x.c);
  const tab = n.tab || 'up';
  let list;
  if (tab === 'up') {
    list = `<p class="muted small">Pick one card: +${amt} to its two most important stats for its position.</p>
      <div class="acard-grid">${lineup.map(({ s, c }) => {
        const [a, b] = keyStats(c.pos);
        const after = cardOverall(c.mon, c.pos, (() => { const x = { ...c.bonus }; x[a] = (x[a] || 0) + amt; if (b) x[b] = (x[b] || 0) + amt; return x; })());
        return cardTile(c, { note: `${s.unit === 'B' ? 'Bench' : s.label} · +${amt} ${STAT_LABELS[c.pos][a]}${b ? `, ${STAT_LABELS[c.pos][b]}` : ''}`, extra: `<button type="button" class="ac-btn" data-act="train" data-u="${c.uid}">${ovrOf(c)} → ${after}</button>` });
      }).join('')}</div>`;
  } else {
    const cards = run.cards.slice().sort((x, y) => ovrOf(y) - ovrOf(x));
    list = `<p class="muted small">Teach a card a new position. The same Pokémon's stats mean different things at each spot, so some make great converts.</p>
      <div class="retrain">${cards.map((c) => `<div class="rt-row">${cardTile(c)}<div class="rt-opts">${POSITIONS.filter((p) => p !== c.pos).map((p) => {
        const o = cardOverall(c.mon, p, Object.keys(c.bonus || {}).length ? c.bonus : null);
        return `<button type="button" class="${o > ovrOf(c) ? 'better' : ''}" data-act="retrain" data-u="${c.uid}" data-p="${p}">${p} ${o}</button>`;
      }).join('')}</div></div>`).join('')}</div>`;
  }
  return `<div class="roster-sw"><button type="button" data-act="ttab" data-t="up" class="${tab === 'up' ? 'on' : ''}">Upgrade a card</button><button type="button" data-act="ttab" data-t="pos" class="${tab === 'pos' ? 'on' : ''}">Change position</button></div>
    ${list}<div class="adv-actions"><button type="button" class="ghost" data-act="done">Skip training</button></div>`;
}

function restHTML(n) {
  if (n.done) return cont();
  const hurt = run.cards.filter((c) => c.inj > 0);
  return `<p>Your team makes camp. Choose one:</p>
    <div class="rest-opts">
      <button type="button" data-act="rest" data-k="heal" ${hurt.length ? '' : 'disabled'}><b>✚ Heal</b><span>Treat every injury${hurt.length ? ` (${hurt.map(nm).map(esc).join(', ')})` : ' (nobody is hurt)'}</span></button>
      ${A.hasLives(run) ? `<button type="button" data-act="rest" data-k="life" ${run.lives < run.maxLives ? '' : 'disabled'}><b>❤️ Recover</b><span>${run.lives < run.maxLives ? 'Get back a life' : 'Lives are full'}</span></button>` : ''}
      <button type="button" data-act="rest" data-k="coins"><b>🪙 Work a camp</b><span>Run a youth clinic for 25 coins</span></button>
    </div>`;
}

function eventHTML(n) {
  const e = n.event, def = A.EVENTS[e.id];
  const cards = [];
  if (e.ctx.card) cards.push(e.ctx.card);
  if (e.ctx.get) cards.push(e.ctx.get);
  const give = e.ctx.give ? A.cardByUid(run, e.ctx.give) : null;
  const imp = !e.done && e.id === 'freeAgent' ? impacts([e.ctx.card]) : [];
  return `<h3 class="ev-title">${esc(def.title)}</h3><p>${esc(def.text(run, e.ctx))}</p>
    ${cards.length || give ? `<div class="acard-grid">${give ? cardTile(give, { note: 'You give' }) : ''}${cards.map((c, i) => cardTile(c, { note: give ? 'You get' : '', extra: impactHTML(imp[i]) })).join('')}</div>` : ''}
    ${e.done ? `<div class="adv-msg">${esc(e.message)}</div>${cont()}` : `<div class="adv-actions">${A.eventOptions(run).map((o) => `<button type="button" data-act="ev" data-k="${o.key}" ${o.disabled ? 'disabled' : ''}>${esc(o.label)}</button>`).join('')}</div>`}`;
}

function summaryHTML() {
  const won = run.status === 'won', retired = run.status === 'retired';
  const best = run.cards.slice().sort((a, b) => ovrOf(b) - ovrOf(a)).slice(0, 6);
  return `<div class="adv-result ${won ? 'win' : 'loss'}"><h2>${won ? '🏆 Champions!' : retired ? 'Retired' : 'Adventure over'}</h2>
    <div class="fscore">${run.stats.w}-${run.stats.l}${run.stats.t ? `-${run.stats.t}` : ''} · ${run.stats.pf} pts for, ${run.stats.pa} against</div>
    <p>${won ? 'You beat all three bosses.' : retired ? `You hung it up in act ${run.act} after ${run.path.length} stops${A.isEndless(run) ? ` (bosses beaten: ${run.path.filter((p) => p.type === 'boss').length})` : ''}.` : `Eliminated in act ${run.act} after ${run.path.length} stops${A.isEndless(run) ? ` (bosses beaten: ${run.path.filter((p) => p.type === 'boss').length})` : ''}.`}</p></div>
    <div class="b-gtitle">Your best cards</div><div class="acard-grid">${best.map((c) => cardTile(c)).join('')}</div>
    <div class="b-gtitle">Story of the run</div><ol class="adv-log">${run.log.map((l) => `<li><span class="muted">Act ${l.act}</span> ${esc(l.text)}</li>`).join('')}</ol>
    <div class="adv-actions"><button type="button" class="primary" data-act="new">New adventure</button><button type="button" data-act="home">All saves</button></div>`;
}

// ---------------------------------------------------------------- roster editor
let rosterSel = null;
function openRoster() {
  rosterSel = null;
  openModal(`<div id="rst-head"></div>
    <details class="b-coach"><summary>Coach tendencies</summary><div id="r-coach"></div></details>
    <div id="rst"></div>`, (d) => {
    if (!d.rosterWired) { d.addEventListener('click', onRosterClick); d.rosterWired = true; }
    coachControls($('#r-coach', d), run.team.coach, save);
    renderRoster(d);
  }, { wide: true });
}
function renderRoster(d = document.querySelector('dialog.modal')) {
  const el = $('#rst', d);
  if (!el) return;
  const tr = A.teamRating(run);
  const slotBtn = (s) => {
    const c = A.cardByUid(run, run.lineup[s.key]);
    const label = s.unit === 'B' ? `Backup ${s.label}` : s.label === 'FLEX' ? `FLEX ${s.pos.join('/')}` : s.label;
    return `<button type="button" class="rslot${rosterSel === s.key ? ' sel' : ''}${c ? '' : ' empty'}" data-rs="${s.key}">
      <span class="rs-l">${esc(label)}</span>${c ? cardTile(c) : '<span class="muted small">Empty: a walk-on will play</span>'}</button>`;
  };
  const group = (title, list) => `<div class="b-gtitle">${title}</div><div class="rgrid">${list.map(slotBtn).join('')}</div>`;
  let chooser = '';
  if (rosterSel) {
    const s = ALL_SLOTS.find((x) => x.key === rosterSel);
    const where = Object.fromEntries(Object.entries(run.lineup).map(([k, u]) => [u, k]));
    const cands = run.cards.filter((c) => s.pos.includes(c.pos)).sort((a, b) => (a.inj > 0) - (b.inj > 0) || ovrOf(b) - ovrOf(a));
    chooser = `<div class="rchooser"><div class="b-gtitle">Choose for ${esc(s.unit === 'B' ? `backup ${s.label}` : s.label === 'FLEX' ? `FLEX (${s.pos.join('/')})` : s.label)}</div>
      ${cands.length ? `<div class="acard-grid">${cands.map((c) => cardTile(c, {
        note: where[c.uid] ? (where[c.uid] === rosterSel ? 'current' : `in ${ALL_SLOTS.find((x) => x.key === where[c.uid]).label}`) : 'reserve',
        extra: c.inj > 0 || where[c.uid] === rosterSel ? '' : `<button type="button" class="ac-btn" data-pick="${c.uid}">Use</button>`,
      })).join('')}</div>` : '<p class="muted small">No cards for this slot. Find some in packs, shops, and drafts.</p>'}</div>`;
  }
  const inLineup = new Set(Object.values(run.lineup));
  const reserve = run.cards.filter((c) => !inLineup.has(c.uid)).sort((a, b) => a.pos.localeCompare(b.pos) || ovrOf(b) - ovrOf(a));
  const head = $('#rst-head', d);
  const gt = A.gameTeam(run).roster, uo = unitCounts(gt, 'O'), ud = unitCounts(gt, 'D');
  head.innerHTML = `<div class="rhead"><h3>Roster</h3><span>Team <b>${tr.ovr}</b> OVR (${ord(tr.pct)})</span>
      <label class="small"><input type="checkbox" id="r-auto" ${run.autoManage !== false ? 'checked' : ''}> Auto-manage lineup</label>
      <button type="button" data-ra="best">Best lineup now</button><button type="button" class="primary" data-close>Done</button></div>
    <div class="unit-row mine"><span class="unit-lab">OFF</span>${synergyChips(uo.counts, uo.active, { compact: true, onlyActive: true }) || '<span class="muted small">no synergies</span>'}
      <span class="unit-lab">DEF</span>${synergyChips(ud.counts, ud.active, { compact: true, onlyActive: true }) || '<span class="muted small">no synergies</span>'}</div>
    <p class="muted small">Click a slot to change who plays there. With auto-manage on, your best healthy cards are placed automatically whenever your roster changes (when two lineups are about as strong, the one with more type synergies wins); editing a slot turns it off.</p>`;
  $('#r-auto', head).onchange = (e) => { run.autoManage = e.target.checked; if (run.autoManage) A.autoLineup(run); save(); renderRoster(); render(); };
  el.innerHTML = `${chooser}
    ${group('Offense', STARTERS.filter((s) => s.unit === 'O'))}
    ${group('Defense & kicker', STARTERS.filter((s) => s.unit !== 'O'))}
    ${group('Bench', BENCH)}
    <div class="b-gtitle">Reserve (${reserve.length})</div>
    ${reserve.length ? `<div class="acard-grid">${reserve.map((c) => cardTile(c)).join('')}</div>` : '<p class="muted small">Every card is in the lineup.</p>'}`;
}
function onRosterClick(e) {
  const b = e.target.closest('button');
  if (!b || !run || !$('#rst')) return;
  if (b.dataset.rs) { rosterSel = rosterSel === b.dataset.rs ? null : b.dataset.rs; renderRoster(); }
  else if (b.dataset.pick) { A.assignSlot(run, rosterSel, b.dataset.pick); rosterSel = null; save(); renderRoster(); }
  else if (b.dataset.ra === 'best') { A.autoLineup(run); save(); renderRoster(); }
  else return;
  // keep the page behind in sync (team rating, warnings)
  render();
}
function openCoach() {
  openModal(`<h3>Coaching</h3><p class="muted small">How ${esc(run.team.city)} ${esc(run.team.name)} call plays. Changes apply from the next battle.</p>
    <div id="c-coach"></div><div class="modal-actions"><button type="button" class="primary" data-close>Done</button></div>`, (d) => {
    coachControls($('#c-coach', d), run.team.coach, save);
  });
}
function openLog() {
  openModal(`<h3>Adventure log</h3><ol class="adv-log">${run.log.slice().reverse().map((l) => `<li><span class="muted">Act ${l.act}</span> ${esc(l.text)}</li>`).join('')}</ol>
    <div class="modal-actions"><button type="button" class="ghost" data-close>Close</button></div>`);
}

// ---------------------------------------------------------------- battles
function playBattle() {
  const n = run.node;
  const me = A.gameTeam(run);
  const runId = run.id;
  H.startBattle(n.opponent, me, A.battleSeed(run), {
    onDone: (res) => {
      if (!run || run.id !== runId || run.node !== n || n.stage === 'result') return;
      A.applyBattle(run, res);
      save();
      showAdventure();
    },
    onAbort: () => { flash('You left the game early. It was not counted.'); showAdventure(); },
  });
}

// ---------------------------------------------------------------- clicks
function onClick(e) {
  const b = e.target.closest('[data-act]');
  if (!b || b.disabled) return;
  e.preventDefault();
  const act = b.dataset.act;
  const n = run?.node;
  switch (act) {
    case 'new': newDialog(); return;
    case 'open': run = loadRuns().find((r) => r.id === b.dataset.id) || null; render(); return;
    case 'del': {
      const r = loadRuns().find((x) => x.id === b.dataset.id);
      if (r && confirm(`Delete the ${r.team.city} ${r.team.name} adventure? This can't be undone.`)) { deleteRun(r.id); renderHome(); }
      return;
    }
    case 'home': run = null; renderHome(); return;
    case 'roster': openRoster(); return;
    case 'log': openLog(); return;
    case 'retire': if (!confirm('Retire this run? It ends here, and you can view the summary any time from Saves.')) return; A.retire(run); break;
    case 'coach': openCoach(); return;
    case 'enter': A.enterNode(run, Number(b.dataset.r), Number(b.dataset.c)); break;
    case 'play': playBattle(); return;
    case 'draft': A.takeDraft(run, Number(b.dataset.i)); break;
    case 'retry': A.retryBattle(run); break;
    case 'end': run.node = null; break;
    case 'openpack': A.takePack(run); break;
    case 'buy': if (!A.buyCard(run, Number(b.dataset.i))) flash('Not enough coins.'); break;
    case 'item': {
      const got = A.buyItem(run, b.dataset.k);
      if (Array.isArray(got)) flash(`Pack: ${got.map(nm).join(', ')}. ${got.delta >= 0.05 ? `Your best lineup improves by +${got.delta.toFixed(1)} team OVR.` : 'No upgrades to your best lineup.'}`);
      break;
    }
    case 'sell': {
      const c = A.cardByUid(run, b.dataset.u);
      if (c && Object.values(run.lineup).includes(c.uid) && !confirm(`Sell ${nm(c)}? They're in your lineup.`)) return;
      const v = A.sellCard(run, b.dataset.u);
      if (v) flash(`Sold ${c ? nm(c) : 'card'} for ${v} coins.`);
      break;
    }
    case 'ttab': n.tab = b.dataset.t; break;
    case 'train': {
      const c = A.cardByUid(run, b.dataset.u), before = c && ovrOf(c);
      if (A.trainCard(run, b.dataset.u)) flash(`${nm(c)} trained: ${before} → ${ovrOf(c)} OVR.`);
      break;
    }
    case 'retrain': {
      const c = A.cardByUid(run, b.dataset.u), was = c?.pos;
      if (A.retrainCard(run, b.dataset.u, b.dataset.p)) flash(`${mon(c).name} moved from ${was} to ${c.pos}: ${ovrOf(c)} OVR.`);
      break;
    }
    case 'rest': A.restChoice(run, b.dataset.k); break;
    case 'ev': A.resolveEvent(run, b.dataset.k); break;
    case 'done': A.completeNode(run); if (run.status === 'active' && !run.node && run.pos === null && run.act > 1) flash(`Act ${run.act}: the opponents are getting stronger.`); break;
    default: return;
  }
  save();
  render();
  if (['enter', 'done', 'end'].includes(act)) window.scrollTo(0, 0);
}
