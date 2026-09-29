// Roster rules: 15 starters (7 offense, 7 defense, K) + one backup per position.
import { POKEMON } from './data/pokemon.js';

export const STARTERS = [
  { key: 'QB', label: 'QB', unit: 'O', pos: ['QB'] },
  { key: 'RB', label: 'RB', unit: 'O', pos: ['RB'] },
  { key: 'WR', label: 'WR', unit: 'O', pos: ['WR'] },
  { key: 'FXO', label: 'FLEX', unit: 'O', pos: ['RB', 'WR', 'TE'] },
  { key: 'OL1', label: 'OL', unit: 'O', pos: ['OL'] },
  { key: 'OL2', label: 'OL', unit: 'O', pos: ['OL'] },
  { key: 'OL3', label: 'OL', unit: 'O', pos: ['OL'] },
  { key: 'DL1', label: 'DL', unit: 'D', pos: ['DL'] },
  { key: 'DL2', label: 'DL', unit: 'D', pos: ['DL'] },
  { key: 'LB1', label: 'LB', unit: 'D', pos: ['LB'] },
  { key: 'LB2', label: 'LB', unit: 'D', pos: ['LB'] },
  { key: 'DB1', label: 'DB', unit: 'D', pos: ['DB'] },
  { key: 'DB2', label: 'DB', unit: 'D', pos: ['DB'] },
  { key: 'FXD', label: 'FLEX', unit: 'D', pos: ['DL', 'LB', 'DB'] },
  { key: 'K', label: 'K', unit: 'S', pos: ['K'] },
];
// Kickers barely tire, so there's no backup K.
export const BENCH = ['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'DB'].map((p) => ({ key: `b${p}`, label: p, unit: 'B', pos: [p] }));
export const ALL_SLOTS = [...STARTERS, ...BENCH];
export const SLOT = Object.fromEntries(ALL_SLOTS.map((s) => [s.key, s]));

export const PERSONNEL = {
  RB: { name: '2-back', desc: 'Two running backs: I-formation, split backs, a fullback to lead block' },
  WR: { name: '2-receiver', desc: 'Spread sets: two wideouts plus a back' },
  TE: { name: 'Tight end', desc: 'An in-line blocker who can also run routes' },
};
export const FRONTS = {
  DL: { name: '3-2-2', desc: 'Three down linemen: heavier pass rush and run stopping' },
  LB: { name: '2-3-2', desc: 'Three linebackers: flexible, strong vs the run' },
  DB: { name: '2-2-3', desc: 'Three defensive backs: nickel-style coverage' },
};

// Roster values are "slug" or "slug:POS" (flex slots need the position).
export function parseCard(value, slotKey) {
  if (!value) return null;
  const [mon, p] = String(value).split(':');
  const slot = SLOT[slotKey];
  const pos = p || slot.pos[0];
  return { mon, pos };
}
export const cardValue = (mon, pos, slotKey) => (SLOT[slotKey].pos.length > 1 ? `${mon}:${pos}` : mon);

export const personnelOf = (roster) => parseCard(roster.FXO, 'FXO')?.pos || 'WR';
export const frontOf = (roster) => parseCard(roster.FXD, 'FXD')?.pos || 'DB';

export function validateRoster(roster) {
  const errors = [];
  const seen = new Map();
  for (const s of ALL_SLOTS) {
    const c = parseCard(roster[s.key], s.key);
    if (!c) { errors.push(`${s.unit === 'B' ? 'Backup ' : ''}${s.label} is empty`); continue; }
    if (!POKEMON[c.mon]) { errors.push(`Unknown Pokémon "${c.mon}"`); continue; }
    if (!s.pos.includes(c.pos)) errors.push(`${POKEMON[c.mon].name} can't be a ${c.pos} in the ${s.label} slot`);
    if (seen.has(c.mon)) errors.push(`${POKEMON[c.mon].name} is on the roster twice`);
    seen.set(c.mon, s.key);
  }
  return errors;
}
