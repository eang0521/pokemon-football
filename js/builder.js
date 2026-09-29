// Team builder: pick any card (Pokémon + position) for each roster slot.
import { POKEMON_LIST, POKEMON } from './data/pokemon.js';
import { cardRatings, overall, STAT_KEYS, STAT_LABELS, POS_NAMES } from './ratings.js';
import { STARTERS, BENCH, SLOT, parseCard, cardValue, validateRoster, PERSONNEL, FRONTS, personnelOf, frontOf } from './roster.js';
import { COACH_PRESETS } from './data/teams.js';
import { saveCustomTeam, deleteCustomTeam } from './storage.js';
import { encodeTeam, shareLink } from './teamcode.js';
import { openModal, copyText } from './modal.js';
import { SYNERGIES, TIER_COUNTS, unitSynergies, tierName } from './synergy.js';
import { spriteUrl } from './render.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const TYPE_COLORS = {
  normal: '#9fa19f', fire: '#e62829', water: '#2980ef', electric: '#fac000', grass: '#3fa129', ice: '#3dcef3',
  fighting: '#ff8000', poison: '#9141cb', ground: '#915121', flying: '#81b9ef', psychic: '#ef4179', bug: '#91a119',
  rock: '#afa981', ghost: '#704170', dragon: '#5060e1', dark: '#624d4e', steel: '#60a1b8', fairy: '#ef70ef',
};
const typeChips = (types) => `<span class="types">${types.map((t) => `<span class="type" style="background:${TYPE_COLORS[t] || '#666'}">${t}</span>`).join('')}</span>`;
const PAGE = 60;

// Synergy chips: counts {type:n}, active {type:tier}. Shows progress toward the next tier.
export function synergyChips(counts, active, { compact = false, onlyActive = false } = {}) {
  const list = Object.keys(counts).filter((t) => SYNERGIES[t] && (!onlyActive || active[t]))
    .sort((a, b) => (active[b] || 0) - (active[a] || 0) || counts[b] - counts[a]);
  if (!list.length) return compact ? '' : '<span class="muted small">No types yet</span>';
  return list.map((t) => {
    const s = SYNERGIES[t], tier = active[t] || 0, n = counts[t];
    const next = TIER_COUNTS.find((c) => c > n);
    const tip = `${s.name} — ${s.title}: ${s.desc}  Tiers at ${TIER_COUNTS.join('/')}.`;
    const label = compact ? `${s.name} ${tierName(tier)}` : `${s.name} ${n}${next ? `/${next}` : ''}${tier ? ` · ${s.title} ${tierName(tier)}` : ''}`;
    return `<span class="syn${tier ? ' on' : ''}" style="--tc:${TYPE_COLORS[t]}" title="${esc(tip)}">${esc(label)}</span>`;
  }).join('');
}
const unitCounts = (roster, unit) => {
  const cards = STARTERS.filter((s) => s.unit === unit).map((s) => parseCard(roster[s.key], s.key)).filter(Boolean).map((c) => ({ types: POKEMON[c.mon].types }));
  return unitSynergies(cards);
};
export { unitCounts };

// cache: pos -> [{p, r, ovr}]
const cardCache = {};
function cardsFor(pos) {
  if (!cardCache[pos]) cardCache[pos] = POKEMON_LIST.map((p) => { const r = cardRatings(p.slug, pos); return { p, r, ovr: overall(pos, r) }; });
  return cardCache[pos];
}

let state = null;

export function openBuilder(team, { onSave, onClose }) {
  state = {
    team: team ? JSON.parse(JSON.stringify(team)) : blankTeam(),
    isNew: !team, slot: 'QB', flexPos: {}, shown: PAGE, onSave, onClose,
  };
  const t = state.team;
  $('#b-city').value = t.city; $('#b-name').value = t.name; $('#b-abbr').value = t.abbr;
  $('#b-c1').value = t.colors.primary; $('#b-c2').value = t.colors.secondary;
  $('#b-delete').classList.toggle('hidden', state.isNew);
  $('#b-search').value = '';
  renderCoach();
  render();
}

function blankTeam() {
  return {
    id: `u${Math.random().toString(36).slice(2, 9)}`, custom: true,
    city: 'My', name: 'Squad', abbr: 'MY',
    colors: { primary: '#3d7dca', secondary: '#ffcb05' },
    coach: { name: 'Coach You', preset: 'balanced', ...COACH_PRESETS.balanced },
    roster: {},
  };
}

function render() { renderSlots(); renderSummary(); renderBrowser(); }

// ---------------------------------------------------------------- roster slots
function slotTile(s) {
  const c = parseCard(state.team.roster[s.key], s.key);
  const sel = state.slot === s.key ? ' sel' : '';
  if (!c) {
    return `<button type="button" class="b-slot empty${sel}" data-slot="${s.key}"><span class="b-lab">${s.unit === 'B' ? 'Backup ' : ''}${s.label}${s.pos.length > 1 ? ` <small>${s.pos.join('/')}</small>` : ''}</span><span class="b-empty">Empty — pick a card</span></button>`;
  }
  const p = POKEMON[c.mon];
  const ovr = overall(c.pos, cardRatings(c.mon, c.pos));
  return `<button type="button" class="b-slot${sel}" data-slot="${s.key}">
    <span class="b-lab">${s.unit === 'B' ? 'Backup ' : ''}${s.label}${s.pos.length > 1 ? ` · ${c.pos}` : ''}</span>
    <img src="${spriteUrl(p)}" alt="" loading="lazy" referrerpolicy="no-referrer">
    <span class="b-nm">${esc(p.name)}</span><span class="b-ovr">${ovr}</span>
  </button>`;
}
function renderSlots() {
  const group = (title, list) => `<div class="b-group"><div class="b-gtitle">${title}</div><div class="b-grid">${list.map(slotTile).join('')}</div></div>`;
  $('#b-slots').innerHTML =
    group('Offense', STARTERS.filter((s) => s.unit === 'O')) +
    group('Defense', STARTERS.filter((s) => s.unit === 'D')) +
    group('Special teams', STARTERS.filter((s) => s.unit === 'S')) +
    group('Bench (one backup per position)', BENCH);
  document.querySelectorAll('#b-slots .b-slot').forEach((el) => el.addEventListener('click', () => {
    state.slot = el.dataset.slot; state.shown = PAGE; render();
    if (window.innerWidth < 900) $('.b-browser').scrollIntoView({ behavior: 'smooth' });
  }));
}

function renderSummary() {
  const r = state.team.roster;
  const pers = PERSONNEL[personnelOf(r)], front = FRONTS[frontOf(r)];
  const avg = (unit) => {
    const v = STARTERS.filter((s) => s.unit === unit).map((s) => parseCard(r[s.key], s.key)).filter(Boolean).map((c) => overall(c.pos, cardRatings(c.mon, c.pos)));
    return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : '—';
  };
  const errors = validateRoster(r);
  const filled = [...STARTERS, ...BENCH].filter((s) => r[s.key]).length;
  $('#b-summary').innerHTML = `<div class="b-sum-row">
      <div><span class="muted">Offense</span> <b>${pers.name}</b> <span class="muted">· OVR ${avg('O')}</span><div class="muted small">${esc(pers.desc)}</div></div>
      <div><span class="muted">Defense</span> <b>${front.name}</b> <span class="muted">· OVR ${avg('D')}</span><div class="muted small">${esc(front.desc)}</div></div>
      <div><span class="muted">Cards</span> <b>${filled}/${STARTERS.length + BENCH.length}</b></div>
    </div>
    <div class="b-syn"><span class="muted small">Offense synergies</span> ${(() => { const u = unitCounts(r, 'O'); return synergyChips(u.counts, u.active); })()}</div>
    <div class="b-syn"><span class="muted small">Defense synergies</span> ${(() => { const u = unitCounts(r, 'D'); return synergyChips(u.counts, u.active); })()}</div>
    ${errors.length && filled ? `<div class="b-errors">${errors.slice(0, 3).map(esc).join(' · ')}${errors.length > 3 ? ` · +${errors.length - 3} more` : ''}</div>` : ''}`;
}

// ---------------------------------------------------------------- card browser
function currentPos() {
  const s = SLOT[state.slot];
  if (s.pos.length === 1) return s.pos[0];
  const c = parseCard(state.team.roster[s.key], s.key);
  return state.flexPos[s.key] || c?.pos || (s.key === 'FXO' ? 'WR' : 'DB');
}

function renderBrowser() {
  const s = SLOT[state.slot];
  const pos = currentPos();
  $('#b-title').textContent = `${s.unit === 'B' ? 'Backup ' : ''}${s.label === 'FLEX' ? 'FLEX' : POS_NAMES[pos]} — choose a ${pos} card`;
  $('#b-postabs').innerHTML = s.pos.length > 1
    ? s.pos.map((p) => `<button type="button" data-pos="${p}" class="${p === pos ? 'on' : ''}">${p}</button>`).join('') +
      `<span class="muted small">${s.key === 'FXO' ? 'RB = 2-back sets · WR = spread · TE = tight end sets' : 'DL = 3-2-2 · LB = 2-3-2 · DB = 2-2-3'}</span>`
    : '';
  document.querySelectorAll('#b-postabs [data-pos]').forEach((b) => b.addEventListener('click', () => { state.flexPos[s.key] = b.dataset.pos; state.shown = PAGE; renderBrowser(); }));

  const labels = STAT_LABELS[pos];
  const sortSel = $('#b-sort');
  const prev = sortSel.value || 'ovr';
  sortSel.innerHTML = `<option value="ovr">Sort: ${pos} overall</option><option value="bst">Sort: base stat total</option>` +
    STAT_KEYS.map((k) => `<option value="${k}">Sort: ${labels[k]} (${k.toUpperCase()})</option>`).join('') + '<option value="dex">Sort: Pokédex #</option>';
  sortSel.value = [...sortSel.options].some((o) => o.value === prev) ? prev : 'ovr';
  $('#b-legend').innerHTML = `As a <b>${pos}</b>: ${STAT_KEYS.map((k) => `<span class="lg"><span class="muted">${statShort(k)}</span> = ${labels[k]}</span>`).join(' ')}`;

  const q = $('#b-search').value.trim().toLowerCase();
  const cap = Number($('#b-cap').value);
  const sort = sortSel.value;
  const onRoster = new Map();
  for (const sl of [...STARTERS, ...BENCH]) { const c = parseCard(state.team.roster[sl.key], sl.key); if (c) onRoster.set(c.mon, sl); }
  let list = cardsFor(pos).filter(({ p }) => p.bst <= cap && (!q || p.name.toLowerCase().includes(q) || p.types.some((t) => t.startsWith(q)) || String(p.dex) === q));
  const key = (c) => (sort === 'ovr' ? c.ovr : sort === 'bst' ? c.p.bst : sort === 'dex' ? -c.p.dex : c.p.stats[sort]);
  list = list.slice().sort((a, b) => key(b) - key(a) || b.ovr - a.ovr);
  const current = parseCard(state.team.roster[s.key], s.key);
  const html = list.slice(0, state.shown).map(({ p, ovr }) => {
    const taken = onRoster.get(p.slug);
    const isHere = current && current.mon === p.slug && current.pos === pos;
    const bars = STAT_KEYS.map((k) => {
      const v = p.stats[k];
      return `<div class="sb-row"><span class="sb-l">${labels[k]}</span><span class="sb-bar"><i style="width:${Math.min(100, v / 1.6)}%;background:${barColor(v)}"></i></span><span class="sb-v">${v}</span></div>`;
    }).join('');
    return `<button type="button" class="b-card${taken && !isHere ? ' taken' : ''}${isHere ? ' here' : ''}" data-mon="${p.slug}" ${taken && !isHere ? 'disabled' : ''}>
      <div class="bc-top"><img src="${spriteUrl(p)}" alt="" loading="lazy" referrerpolicy="no-referrer">
        <div class="bc-id"><b>${esc(p.name)}</b> <span class="muted">#${p.dex}</span><br>${typeChips(p.types)} <span class="muted small">BST ${p.bst}</span></div>
        <div class="bc-ovr"><span>${ovr}</span><small>${pos}</small></div></div>
      <div class="bc-stats">${bars}</div>
      ${taken && !isHere ? `<div class="bc-taken">On roster (${taken.unit === 'B' ? 'backup ' : ''}${taken.label})</div>` : isHere ? '<div class="bc-taken here">In this slot</div>' : ''}
    </button>`;
  }).join('');
  $('#b-list').innerHTML = (html || '<p class="muted">No cards match.</p>') +
    (list.length > state.shown ? `<button type="button" id="b-more" class="b-more">Show more (${list.length - state.shown} left)</button>` : '');
  document.querySelectorAll('#b-list .b-card:not([disabled])').forEach((el) => el.addEventListener('click', () => pick(el.dataset.mon)));
  $('#b-more')?.addEventListener('click', () => { state.shown += PAGE; renderBrowser(); });
}
const statShort = (k) => ({ hp: 'HP', atk: 'Atk', def: 'Def', spa: 'SpA', spd: 'SpD', spe: 'Spe' }[k]);
const barColor = (v) => (v >= 120 ? '#3fb950' : v >= 90 ? '#8bc34a' : v >= 60 ? '#ffcb05' : '#f0883e');

function pick(mon) {
  const s = SLOT[state.slot];
  state.team.roster[s.key] = cardValue(mon, currentPos(), s.key);
  // advance to the next empty slot
  const order = [...STARTERS, ...BENCH];
  const next = order.find((x) => !state.team.roster[x.key]);
  if (next) { state.slot = next.key; state.shown = PAGE; $('#b-search').value = ''; }
  render();
}

// ---------------------------------------------------------------- coach
function renderCoach() { coachControls($('#b-coach'), state.team.coach); }

// Coach tendency controls (preset + sliders), shared with adventure mode. Edits `coach` in place.
export function coachControls(el, coach, onChange = () => {}) {
  const c = coach;
  const slider = (k, label) => `<label class="cs"><span>${label}</span><input type="range" min="0" max="100" value="${Math.round(c[k] * 100)}" data-k="${k}"><b>${Math.round(c[k] * 100)}</b></label>`;
  el.classList.add('coach-ctl');
  el.innerHTML = `
    <label class="cs"><span>Preset</span><select data-preset>${Object.entries(COACH_PRESETS).map(([k, v]) => `<option value="${k}" ${c.preset === k ? 'selected' : ''}>${v.style}</option>`).join('')}</select></label>
    ${slider('passRate', 'Pass rate')}${slider('deepRate', 'Deep shots')}${slider('paRate', 'Play action')}${slider('aggression', 'Aggression (4th down / 2-pt)')}
    ${slider('blitzRate', 'Blitz rate')}${slider('manRate', 'Man coverage')}
    <label class="cs"><span>Run scheme</span><select data-k="runStyle">${['zone', 'power', 'mixed'].map((v) => `<option ${c.runStyle === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
    <label class="cs"><span>Tempo</span><select data-k="tempo">${['hurry', 'normal', 'slow'].map((v) => `<option ${c.tempo === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label>`;
  el.querySelector('[data-preset]').addEventListener('change', (e) => {
    Object.assign(c, COACH_PRESETS[e.target.value], { preset: e.target.value });
    coachControls(el, c, onChange); onChange();
  });
  el.querySelectorAll('input[type=range]').forEach((r) => r.addEventListener('input', () => {
    c[r.dataset.k] = Number(r.value) / 100; r.nextElementSibling.textContent = r.value; onChange();
  }));
  el.querySelectorAll('select[data-k]').forEach((s) => s.addEventListener('change', () => { c[s.dataset.k] = s.value; onChange(); }));
}

// ---------------------------------------------------------------- actions
function autoFill() {
  const cap = Number($('#b-cap').value);
  const r = state.team.roster;
  const used = new Set([...STARTERS, ...BENCH].map((s) => parseCard(r[s.key], s.key)?.mon).filter(Boolean));
  for (const s of [...STARTERS, ...BENCH]) {
    if (r[s.key]) continue;
    const pos = s.pos.length > 1 ? (state.flexPos[s.key] || (s.key === 'FXO' ? 'WR' : 'DB')) : s.pos[0];
    const best = cardsFor(pos).filter(({ p }) => p.bst <= cap && !used.has(p.slug)).sort((a, b) => b.ovr - a.ovr)[0];
    if (best) { r[s.key] = cardValue(best.p.slug, pos, s.key); used.add(best.p.slug); }
  }
  render();
}

function save() {
  const t = state.team;
  t.city = $('#b-city').value.trim() || 'My';
  t.name = $('#b-name').value.trim() || 'Squad';
  t.abbr = ($('#b-abbr').value.trim() || t.name.slice(0, 3)).toUpperCase().slice(0, 3);
  t.colors = { primary: $('#b-c1').value, secondary: $('#b-c2').value };
  const errors = validateRoster(t.roster);
  if (errors.length) { alert(`Finish your roster first:\n• ${errors.slice(0, 8).join('\n• ')}`); return; }
  if (!saveCustomTeam(t)) { alert('Could not save (browser storage unavailable).'); return; }
  state.onSave(t);
}

export function wireBuilder() {
  $('#b-search').addEventListener('input', () => { state.shown = PAGE; renderBrowser(); });
  $('#b-sort').addEventListener('change', () => { state.shown = PAGE; renderBrowser(); });
  $('#b-cap').addEventListener('change', () => { state.shown = PAGE; renderBrowser(); });
  $('#b-auto').addEventListener('click', autoFill);
  $('#b-clear').addEventListener('click', () => { if (confirm('Clear every slot?')) { state.team.roster = {}; state.slot = 'QB'; render(); } });
  $('#b-save').addEventListener('click', save);
  $('#b-share').addEventListener('click', () => {
    const t = state.team;
    t.city = $('#b-city').value.trim() || t.city; t.name = $('#b-name').value.trim() || t.name;
    t.abbr = ($('#b-abbr').value.trim() || t.abbr).toUpperCase().slice(0, 3);
    t.colors = { primary: $('#b-c1').value, secondary: $('#b-c2').value };
    const errors = validateRoster(t.roster);
    const code = encodeTeam(t), link = shareLink(code);
    openModal(`<h3>Share ${esc(t.city)} ${esc(t.name)}</h3>
      ${errors.length ? `<p class="b-errors">This roster isn't complete yet (${errors.length} issue${errors.length > 1 ? 's' : ''}). Friends can still import and finish it.</p>` : ''}
      <p class="muted small">Anyone can paste this code into “Import a team code”, or open the link.</p>
      <textarea class="code" readonly rows="4">${code}</textarea>
      <div class="modal-actions"><button type="button" class="primary" id="m-copy-code">Copy code</button><button type="button" id="m-copy-link">Copy link</button><button type="button" class="ghost" data-close>Close</button></div>`, (d) => {
      d.querySelector('#m-copy-code').onclick = (e) => copyText(code, e.target);
      d.querySelector('#m-copy-link').onclick = (e) => copyText(link, e.target);
      d.querySelector('textarea').onclick = (e) => e.target.select();
    });
  });
  $('#b-cancel').addEventListener('click', () => state.onClose());
  $('#b-delete').addEventListener('click', () => {
    if (confirm(`Delete ${state.team.city} ${state.team.name}?`)) { deleteCustomTeam(state.team.id); state.onClose(true); }
  });
}
