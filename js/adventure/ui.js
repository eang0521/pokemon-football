// Adventure mode screens: saved runs, the act map, every kind of stop, and the roster editor.
// Game logic lives in ./run.js; battles are played in the normal game viewer via hooks.
import * as A from './run.js';
import { ovrOf, pctOfCard, rarityOf, keyStats } from './cards.js';
import { POKEMON } from '../data/pokemon.js';
import { COACH_PRESETS } from '../data/teams.js';
import { STAT_KEYS, STAT_LABELS, POSITIONS, cardOverall } from '../ratings.js';
import { ALL_SLOTS, STARTERS, BENCH, PERSONNEL, FRONTS, personnelOf, frontOf } from '../roster.js';
import { spriteUrl } from '../render.js';
import { TYPE_COLORS, synergyChips, unitCounts } from '../builder.js';
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
const rosterCards = (roster) => ALL_SLOTS.map((s) => { const [m, p] = String(roster[s.key]).split(':'); return { slot: s, c: { mon: m, pos: p || s.pos[0] } }; });

// ---------------------------------------------------------------- home
function renderHome() {
  const runs = loadRuns();
  const status = (r) => r.status === 'won' ? '<span class="adv-st won">🏆 Champions</span>' : r.status === 'lost' ? '<span class="adv-st lost">Eliminated</span>'
    : `<span class="adv-st">Act ${r.act} · ${'♥'.repeat(r.lives)}${'♡'.repeat(Math.max(0, r.maxLives - r.lives))} · ${r.coins} coins</span>`;
  root().innerHTML = `<section class="adv-home">
    <div class="adv-intro">
      <h2>Adventure</h2>
      <p>Start with a scrappy team of weak cards and fight your way through three acts. Choose your route: battle random teams, take on elite teams for bigger rewards, open packs, shop, train, rest, and handle surprises. Opponents get better as you go. Each act ends with a boss, and you have 3 lives.</p>
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
  openModal(`<h3>New adventure</h3>
    <p class="muted small">Name your team. You'll start with 23 random cards from the 5th to 15th percentile at their positions.</p>
    <div class="adv-form">
      <label>City <input id="n-city" maxlength="16" value="${esc(city)}"></label>
      <label>Team name <input id="n-name" maxlength="16" value="${esc(name)}"></label>
      <label>Abbr. <input id="n-abbr" maxlength="3" value="${esc(city.slice(0, 3).toUpperCase())}" class="abbr"></label>
      <label>Primary <input id="n-c1" type="color" value="#2e7d32"></label>
      <label>Secondary <input id="n-c2" type="color" value="#ffcb05"></label>
      <label>Coaching style <select id="n-coach">${Object.entries(COACH_PRESETS).map(([k, p]) => `<option value="${k}">${esc(p.style)}</option>`).join('')}</select></label>
    </div>
    <div class="modal-actions"><button type="button" class="primary" id="n-go">Start adventure</button><button type="button" class="ghost" data-close>Cancel</button></div>`, (d) => {
    $('#n-go', d).onclick = () => {
      const v = (id) => $(id, d).value.trim();
      const preset = v('#n-coach');
      const team = {
        city: v('#n-city') || 'Pallet', name: v('#n-name') || 'Underdogs', abbr: (v('#n-abbr') || 'YOU').toUpperCase().slice(0, 3),
        colors: { primary: v('#n-c1'), secondary: v('#n-c2') },
        coach: { name: 'Coach You', preset, ...COACH_PRESETS[preset] },
      };
      run = A.newRun({ team });
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
  const hearts = `${'♥'.repeat(Math.max(0, run.lives))}${'♡'.repeat(Math.max(0, run.maxLives - run.lives))}`;
  const top = `<div class="adv-top" style="--tc:${run.team.colors.primary}">
    <div class="adv-team"><span class="chip" style="background:${run.team.colors.primary};border-color:${run.team.colors.secondary}"></span><b>${esc(run.team.city)} ${esc(run.team.name)}</b></div>
    <div class="adv-stats">
      <span title="Act">Act <b>${Math.min(run.act, A.ACTS)}</b>/${A.ACTS}</span>
      <span class="hearts" title="Lives">${hearts}</span>
      <span title="Coins">🪙 <b>${run.coins}</b></span>
      <span title="Average overall of your 15 starters (and their average percentile)">Team <b>${tr.ovr}</b> OVR <span class="muted">(${ord(tr.pct)})</span></span>
      <span title="Win-loss record">${run.stats.w}-${run.stats.l}${run.stats.t ? `-${run.stats.t}` : ''}</span>
    </div>
    <div class="adv-btns"><button type="button" data-act="roster">Roster</button><button type="button" data-act="log">Log</button><button type="button" class="ghost" data-act="home">Saves</button></div>
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
  const bossName = A.BOSS_TITLES[run.act - 1];
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
  const head = `<div class="adv-nodehead"><span class="nicon">${info.icon}</span><div><h3>${esc(n.type === 'boss' ? `${A.BOSS_TITLES[run.act - 1]} battle` : info.name)}</h3><div class="muted small">Act ${run.act} · stop ${n.row === A.ROWS ? 'boss' : n.row + 1}</div></div></div>`;
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
  const kind = n.type === 'boss' ? `${A.BOSS_TITLES[run.act - 1]}` : n.type === 'elite' ? 'Elite team' : 'Opponent';
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
    const draft = r.draft.length ? `<div class="b-gtitle">Draft ${picks > 1 ? `${picks} cards` : 'a card'} from the ${esc(o.city)} ${esc(o.name)} ${left > 0 ? `(${left} left)` : ''}</div>
      <div class="acard-grid">${r.draft.map((c, i) => cardTile(c, {
        cls: taken.includes(i) ? 'picked' : '',
        extra: taken.includes(i) ? '<span class="ac-tag">Drafted</span>' : left > 0 ? `<button type="button" class="ac-btn" data-act="draft" data-i="${i}">Draft</button>` : '',
      })).join('')}</div>` : '';
    after = `${draft}${cont(left > 0 && r.draft.length ? 'Skip draft ▶' : n.type === 'boss' ? (run.act >= A.ACTS ? 'Claim the title ▶' : `On to act ${run.act + 1} ▶`) : 'Back to the map ▶')}`;
  }
  return `<div class="adv-result ${r.win ? 'win' : r.tie ? 'tie' : 'loss'}">
    <h2>${title}</h2><div class="fscore">${esc(run.team.abbr)} ${r.pf} — ${r.pa} ${esc(o.abbr)}</div>
    <ul>${lines.map((l) => `<li>${l}</li>`).join('')}</ul></div>${after}`;
}

function packHTML(n) {
  if (!n.taken) return `<div class="pack-closed"><div class="pack-art">🎁</div><p>A pack of 5 cards. Rarer cards are stronger at their position.</p>
    <div class="adv-actions"><button type="button" class="primary big" data-act="openpack">Open pack</button></div></div>`;
  return `<div class="acard-grid reveal">${n.pack.map((c) => cardTile(c, { extra: `<span class="ac-rar">${rarityOf(pctOfCard(c)).name}</span>` })).join('')}</div>
    <p class="muted small">All 5 cards were added to your collection.${run.autoManage !== false ? ' Your lineup was updated with any upgrades.' : ''}</p>${cont()}`;
}

function shopHTML(n) {
  const s = n.shop;
  const inLineup = new Set(Object.values(run.lineup));
  const sellable = run.cards.slice().sort((a, b) => (inLineup.has(a.uid) - inLineup.has(b.uid)) || ovrOf(a) - ovrOf(b));
  return `<div class="b-gtitle">Cards for sale · you have 🪙 ${run.coins}</div>
    <div class="acard-grid">${s.cards.map((c, i) => cardTile(c, {
      cls: c.sold ? 'picked' : '',
      extra: c.sold ? '<span class="ac-tag">Sold</span>' : `<button type="button" class="ac-btn" data-act="buy" data-i="${i}" ${run.coins < c.price ? 'disabled' : ''}>🪙 ${c.price}</button>`,
    })).join('')}</div>
    <div class="b-gtitle">Services</div>
    <div class="shop-items">${s.items.map((it) => {
      const na = it.sold || run.coins < it.price || (it.key === 'life' && run.lives >= run.maxLives) || (it.key === 'heal' && !run.cards.some((c) => c.inj > 0));
      return `<div class="shop-item"><span>${esc(it.name)}</span><button type="button" data-act="item" data-k="${it.key}" ${na ? 'disabled' : ''}>${it.sold ? 'Bought' : `🪙 ${it.price}`}</button></div>`;
    }).join('')}</div>
    <details class="shop-sell"><summary>Sell cards (${run.cards.length} in your collection)</summary>
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
      <button type="button" data-act="rest" data-k="life" ${run.lives < run.maxLives ? '' : 'disabled'}><b>❤️ Recover</b><span>${run.lives < run.maxLives ? 'Get back a life' : 'Lives are full'}</span></button>
      <button type="button" data-act="rest" data-k="coins"><b>🪙 Work a camp</b><span>Run a youth clinic for 25 coins</span></button>
    </div>`;
}

function eventHTML(n) {
  const e = n.event, def = A.EVENTS[e.id];
  const cards = [];
  if (e.ctx.card) cards.push(e.ctx.card);
  if (e.ctx.get) cards.push(e.ctx.get);
  const give = e.ctx.give ? A.cardByUid(run, e.ctx.give) : null;
  return `<h3 class="ev-title">${esc(def.title)}</h3><p>${esc(def.text(run, e.ctx))}</p>
    ${cards.length || give ? `<div class="acard-grid">${give ? cardTile(give, { note: 'You give' }) : ''}${cards.map((c) => cardTile(c, { note: give ? 'You get' : '' })).join('')}</div>` : ''}
    ${e.done ? `<div class="adv-msg">${esc(e.message)}</div>${cont()}` : `<div class="adv-actions">${A.eventOptions(run).map((o) => `<button type="button" data-act="ev" data-k="${o.key}" ${o.disabled ? 'disabled' : ''}>${esc(o.label)}</button>`).join('')}</div>`}`;
}

function summaryHTML() {
  const won = run.status === 'won';
  const best = run.cards.slice().sort((a, b) => ovrOf(b) - ovrOf(a)).slice(0, 6);
  return `<div class="adv-result ${won ? 'win' : 'loss'}"><h2>${won ? '🏆 Champions!' : 'Adventure over'}</h2>
    <div class="fscore">${run.stats.w}-${run.stats.l}${run.stats.t ? `-${run.stats.t}` : ''} · ${run.stats.pf} pts for, ${run.stats.pa} against</div>
    <p>${won ? 'You beat all three bosses.' : `Eliminated in act ${run.act} after ${run.path.length} stops.`}</p></div>
    <div class="b-gtitle">Your best cards</div><div class="acard-grid">${best.map((c) => cardTile(c)).join('')}</div>
    <div class="b-gtitle">Story of the run</div><ol class="adv-log">${run.log.map((l) => `<li><span class="muted">Act ${l.act}</span> ${esc(l.text)}</li>`).join('')}</ol>
    <div class="adv-actions"><button type="button" class="primary" data-act="new">New adventure</button><button type="button" data-act="home">All saves</button></div>`;
}

// ---------------------------------------------------------------- roster editor
let rosterSel = null;
function openRoster() {
  rosterSel = null;
  openModal('<div id="rst"></div>', (d) => {
    if (!d.rosterWired) { d.addEventListener('click', onRosterClick); d.rosterWired = true; }
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
  el.innerHTML = `<div class="rhead"><h3>Roster</h3><span>Team <b>${tr.ovr}</b> OVR (${ord(tr.pct)})</span>
      <label class="small"><input type="checkbox" id="r-auto" ${run.autoManage !== false ? 'checked' : ''}> Auto-manage lineup</label>
      <button type="button" data-ra="best">Best lineup now</button><button type="button" class="ghost" data-close>Done</button></div>
    <p class="muted small">Click a slot to change who plays there. With auto-manage on, your best healthy cards are placed automatically whenever your roster changes; editing a slot turns it off.</p>
    ${chooser}
    ${group('Offense', STARTERS.filter((s) => s.unit === 'O'))}
    ${group('Defense & kicker', STARTERS.filter((s) => s.unit !== 'O'))}
    ${group('Bench', BENCH)}
    <div class="b-gtitle">Reserve (${reserve.length})</div>
    ${reserve.length ? `<div class="acard-grid">${reserve.map((c) => cardTile(c)).join('')}</div>` : '<p class="muted small">Every card is in the lineup.</p>'}`;
  $('#r-auto', el).onchange = (e) => { run.autoManage = e.target.checked; if (run.autoManage) A.autoLineup(run); save(); renderRoster(); };
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
    case 'enter': A.enterNode(run, Number(b.dataset.r), Number(b.dataset.c)); break;
    case 'play': playBattle(); return;
    case 'draft': A.takeDraft(run, Number(b.dataset.i)); break;
    case 'retry': A.retryBattle(run); break;
    case 'end': run.node = null; break;
    case 'openpack': A.takePack(run); break;
    case 'buy': if (!A.buyCard(run, Number(b.dataset.i))) flash('Not enough coins.'); break;
    case 'item': {
      const got = A.buyItem(run, b.dataset.k);
      if (Array.isArray(got)) flash(`Pack: ${got.map(nm).join(', ')}`);
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
