// Team codes: a compact, URL-safe string that fully describes a custom team.
// Format: "PG1" + base64url(JSON) where Pokémon are stored by Pokédex number.
import { POKEMON, POKEMON_LIST } from './data/pokemon.js';
import { STARTERS, BENCH, parseCard, cardValue, validateRoster } from './roster.js';
import { COACH_PRESETS } from './data/teams.js';

const SLOTS = [...STARTERS, ...BENCH];
const PREFIX = 'PG1';
const byDex = new Map(POKEMON_LIST.map((p) => [p.dex, p.slug]));
const POS_CODE = { RB: 0, WR: 1, TE: 2, DL: 0, LB: 1, DB: 2 };
const FXO_POS = ['RB', 'WR', 'TE'], FXD_POS = ['DL', 'LB', 'DB'];
const COACH_KEYS = ['passRate', 'deepRate', 'paRate', 'aggression', 'blitzRate', 'manRate'];
const RUN = ['zone', 'power', 'mixed'], TEMPO = ['hurry', 'normal', 'slow'];

const b64url = (str) => btoa(unescape(encodeURIComponent(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4))));

export function encodeTeam(team) {
  const dex = [], flex = [];
  for (const s of SLOTS) {
    const c = parseCard(team.roster[s.key], s.key);
    dex.push(c ? POKEMON[c.mon].dex : 0);
    if (s.pos.length > 1) flex.push(c ? POS_CODE[c.pos] : 1);
  }
  const co = team.coach;
  const data = {
    c: team.city, n: team.name, a: team.abbr,
    k: [team.colors.primary.slice(1), team.colors.secondary.slice(1)],
    r: dex, f: flex,
    h: [...COACH_KEYS.map((k) => Math.round((co[k] ?? 0.5) * 100)), RUN.indexOf(co.runStyle), TEMPO.indexOf(co.tempo)],
    p: co.preset || 'balanced', m: co.name,
  };
  return PREFIX + b64url(JSON.stringify(data));
}

// Accepts a raw code or any URL containing ?team=CODE. Returns { team, errors }.
export function decodeTeam(input) {
  let code = String(input || '').trim();
  const m = code.match(/[?&](?:team|away|home)=~?([A-Za-z0-9_-]+)/);
  if (m) code = m[1];
  code = code.replace(/^~/, '');
  if (!code.startsWith(PREFIX)) return { team: null, errors: ['That doesn\'t look like a team code.'] };
  let d;
  try { d = JSON.parse(unb64url(code.slice(PREFIX.length))); } catch { return { team: null, errors: ['The team code is damaged or incomplete.'] }; }
  const roster = {};
  let fi = 0;
  SLOTS.forEach((s, i) => {
    const slug = byDex.get(d.r?.[i]);
    if (!slug) return;
    if (s.pos.length > 1) { const pos = (s.key === 'FXO' ? FXO_POS : FXD_POS)[d.f?.[fi++] ?? 1]; roster[s.key] = cardValue(slug, pos, s.key); }
    else roster[s.key] = slug;
  });
  const h = d.h || [];
  const preset = COACH_PRESETS[d.p] ? d.p : 'balanced';
  const coach = { name: String(d.m || 'Coach').slice(0, 24), preset, ...COACH_PRESETS[preset] };
  COACH_KEYS.forEach((k, i) => { if (Number.isFinite(h[i])) coach[k] = Math.max(0, Math.min(1, h[i] / 100)); });
  if (RUN[h[6]]) coach.runStyle = RUN[h[6]];
  if (TEMPO[h[7]]) coach.tempo = TEMPO[h[7]];
  const hex = (v, dflt) => (/^[0-9a-f]{6}$/i.test(v || '') ? `#${v}` : dflt);
  const team = {
    id: `c${hash(code)}`, custom: true, imported: true,
    city: String(d.c || 'Imported').slice(0, 16), name: String(d.n || 'Team').slice(0, 16), abbr: String(d.a || 'IMP').slice(0, 3).toUpperCase(),
    colors: { primary: hex(d.k?.[0], '#3d7dca'), secondary: hex(d.k?.[1], '#ffcb05') },
    coach, roster,
  };
  return { team, errors: validateRoster(roster) };
}

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

export const shareLink = (code) => `${location.origin}${location.pathname}?team=${code}`;
