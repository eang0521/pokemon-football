// Depth chart, energy (HP = stamina) and substitutions for one team.
import { buildCard, applySynergies } from './ratings.js';
import { STARTERS, BENCH, parseCard, personnelOf, frontOf } from './roster.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const OFF_KEYS = ['QB', 'RB', 'WR', 'FXO', 'OL1', 'OL2', 'OL3'];
const SIM_OFF = { QB: 'QB', RB: 'RB', WR: 'WR', FXO: 'FX', OL1: 'LG', OL2: 'C', OL3: 'RG' };
const DEF_KEYS = ['DL1', 'DL2', 'LB1', 'LB2', 'DB1', 'DB2', 'FXD'];

// Fatigue thresholds
const SUB_OUT = 66; // starter comes out below this
const SUB_BACK = 88; // and returns once recovered to this
const FRESH = 80; // no penalty above this

export class TeamDepth {
  constructor(team, registry) {
    this.team = team;
    this.cards = {};
    for (const s of [...STARTERS, ...BENCH]) {
      const c = parseCard(team.roster[s.key], s.key);
      const card = buildCard(c.mon, c.pos, { id: `${team.id}-${s.key}`, teamId: team.id, slot: s.key });
      this.cards[s.key] = card;
      registry[card.id] = card;
    }
    this.personnel = personnelOf(team.roster);
    this.front = frontOf(team.roster);
    this.onField = Object.fromEntries([...OFF_KEYS, ...DEF_KEYS, 'K'].map((k) => [k, this.cards[k]]));
    this.energy = Object.fromEntries(Object.values(this.cards).map((c) => [c.id, 100]));
  }

  get K() { return this.onField.K; }
  get QB() { return this.onField.QB; }
  offense() { return OFF_KEYS.map((k) => this.onField[k]); }
  defense() { return DEF_KEYS.map((k) => this.onField[k]); }
  all() { return Object.values(this.cards); }

  // ratings after fatigue (and type synergies for the unit on the field)
  fatigueMult(card) {
    const e = this.energy[card.id];
    return e >= FRESH ? 1 : clamp(1 - (FRESH - e) * 0.005, 0.6, 1);
  }
  liveRatings(cards, unit) {
    const base = applySynergies(cards, unit);
    return cards.map((c, i) => {
      const m = this.fatigueMult(c);
      if (m === 1) return base[i];
      const r = {};
      for (const k in base[i]) r[k] = k === 'mass' ? base[i][k] : Math.round(base[i][k] * m);
      return r;
    });
  }

  // [{slot, player, ratings}] in sim slot order QB, RB, WR, FX, LG, C, RG
  simOffense() {
    const cards = this.offense();
    const rt = this.liveRatings(cards, 'offense');
    return OFF_KEYS.map((k, i) => ({ slot: SIM_OFF[k], player: cards[i], ratings: rt[i] }));
  }
  // defenders named by what they are on the field: DL1.., LB1.., DB1..
  simDefense() {
    const cards = this.defense();
    const rt = this.liveRatings(cards, 'defense');
    const n = { DL: 0, LB: 0, DB: 0 };
    const out = cards.map((c, i) => ({ slot: `${c.pos}${++n[c.pos]}`, player: c, ratings: rt[i] }));
    const order = { DL: 0, LB: 1, DB: 2 };
    return out.sort((a, b) => order[a.player.pos] - order[b.player.pos]);
  }

  // ---- energy
  drain(card, amount) {
    const stm = card.ratings.stm;
    this.energy[card.id] = clamp(this.energy[card.id] - amount * (1.6 - stm / 100), 0, 100);
  }
  recover(card, amount) {
    const stm = card.ratings.stm;
    this.energy[card.id] = clamp(this.energy[card.id] + amount * (0.6 + stm / 200), 0, 100);
  }
  recoverAll(amount) { for (const c of this.all()) this.recover(c, amount); }
  // after a play: everyone not on the field for it rests
  restExcept(ids, amount) { for (const c of this.all()) if (!ids.has(c.id)) this.recover(c, amount); }

  // ---- substitutions for a unit ('O' or 'D'); returns human-readable notes
  substitute(unit) {
    const notes = [];
    const keys = unit === 'O' ? OFF_KEYS : DEF_KEYS;
    for (const k of keys) {
      const starter = this.cards[k];
      const current = this.onField[k];
      const backup = this.cards[`b${starter.pos}`];
      if (!backup) continue;
      if (current === starter) {
        const e = this.energy[starter.id], be = this.energy[backup.id];
        const benchFree = !Object.values(this.onField).includes(backup);
        if (e < SUB_OUT && benchFree && be >= FRESH && be - e >= 15) {
          this.onField[k] = backup;
          notes.push(`${backup.name} (${backup.pos}) in for a winded ${starter.name}`);
        }
      } else if (this.energy[starter.id] >= SUB_BACK) {
        this.onField[k] = starter;
        notes.push(`${starter.name} (${starter.pos}) back in`);
      }
    }
    return notes;
  }
}
