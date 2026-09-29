// Depth chart, energy (HP = stamina) and substitutions for one team.
import { buildCard, cardRatings } from './ratings.js';
import { unitSynergies, playerEffects } from './synergy.js';
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
      const card = buildCard(c.mon, c.pos, { id: `${team.id}-${s.key}`, teamId: team.id, slot: s.key, bonus: team.bonus?.[s.key] });
      this.cards[s.key] = card;
      registry[card.id] = card;
    }
    this.personnel = personnelOf(team.roster);
    this.front = frontOf(team.roster);
    this.onField = Object.fromEntries([...OFF_KEYS, ...DEF_KEYS, 'K'].map((k) => [k, this.cards[k]]));
    this.energy = Object.fromEntries(Object.values(this.cards).map((c) => [c.id, 100]));
    this.live = {}; // per card: synergy-adjusted stamina and Grass regen from its last snap
    this.synergy = { O: { counts: {}, active: {} }, D: { counts: {}, active: {} } };
    this.synOverride = null; // tools: { O|D: { type, tier, members: Set(card ids) } }
  }

  get K() { return this.onField.K; }
  get QB() { return this.onField.QB; }
  offense() { return OFF_KEYS.map((k) => this.onField[k]); }
  defense() { return DEF_KEYS.map((k) => this.onField[k]); }
  all() { return Object.values(this.cards); }

  // ratings after fatigue (and type synergies for the unit on the field)
  fatigueMult(card) {
    const e = this.energy[card.id];
    return e >= FRESH ? 1 : clamp(1 - (FRESH - e) * 0.008, 0.55, 1);
  }
  // Ratings for a unit on the field: type-synergy stat boosts (applied to base stats, so
  // they mean the right thing at each position), Dragon clutch, then fatigue.
  // Returns [{ ratings, mods }] and records the unit's active synergies.
  liveUnit(cards, unit, ctx = {}) {
    const syn = unitSynergies(cards);
    const ov = this.synOverride?.[unit];
    if (ov) syn.active = { ...syn.active, [ov.type]: ov.tier };
    this.synergy[unit] = syn;
    return cards.map((c) => {
      const types = ov && ov.members.has(c.id) && !c.types.includes(ov.type) ? [...c.types, ov.type] : c.types;
      const { stat, mods } = playerEffects({ types, base: c.base }, syn.active);
      let r = Object.keys(stat).length ? cardRatings(c.slug, c.pos, stat, c.bonus) : c.ratings;
      let m = this.fatigueMult(c);
      if (mods.growth) m *= 1 + mods.growth * Math.min(3, Math.max(0, (ctx.quarter || 1) - 1)) / 3; // Grass: builds each quarter
      if (mods.clutch && ctx.clutch) m *= 1 + mods.clutch;
      this.live[c.id] = { stm: r.stm, regen: mods.regen || 0 };
      if (m !== 1) {
        const out = {};
        for (const k in r) out[k] = k === 'mass' ? r[k] : Math.max(20, Math.round(r[k] * m));
        r = out;
      }
      return { ratings: r, mods };
    });
  }

  // [{slot, player, ratings, mods}] in sim slot order QB, RB, WR, FX, LG, C, RG
  simOffense(ctx) {
    const cards = this.offense();
    const live = this.liveUnit(cards, 'O', ctx);
    return OFF_KEYS.map((k, i) => ({ slot: SIM_OFF[k], player: cards[i], ...live[i] }));
  }
  // defenders named by what they are on the field: DL1.., LB1.., DB1..
  simDefense(ctx) {
    const cards = this.defense();
    const live = this.liveUnit(cards, 'D', ctx);
    const n = { DL: 0, LB: 0, DB: 0 };
    const out = cards.map((c, i) => ({ slot: `${c.pos}${++n[c.pos]}`, player: c, ...live[i] }));
    const order = { DL: 0, LB: 1, DB: 2 };
    return out.sort((a, b) => order[a.player.pos] - order[b.player.pos]);
  }

  // ---- energy
  drain(card, amount) {
    const L = this.live[card.id];
    const stm = L?.stm ?? card.ratings.stm;
    const regen = L?.regen || 0;
    this.energy[card.id] = clamp(this.energy[card.id] - amount * (1.6 - stm / 100) * Math.max(0.2, 1 - regen * 0.4), 0, 100);
  }
  recover(card, amount) {
    const L = this.live[card.id];
    const stm = L?.stm ?? card.ratings.stm;
    const regen = L?.regen || 0;
    this.energy[card.id] = clamp(this.energy[card.id] + amount * (0.6 + stm / 200) * (1 + regen), 0, 100);
  }
  recoverAll(amount) { for (const c of this.all()) this.recover(c, amount); }
  // after a play: everyone not on the field for it rests
  restExcept(ids, amount) { for (const c of this.all()) if (!ids.has(c.id)) this.recover(c, amount); }

  // ---- substitutions for a unit ('O' or 'D'); returns human-readable notes
  // Injury: the player is out for the game. Fill his spot with the matching backup,
  // or the healthiest free bench card playing out of position (its card for that position).
  injure(card, registry) {
    card.injured = true;
    (this.injuredCards ||= []).push(card);
    const key = Object.keys(this.onField).find((k) => this.onField[k] === card);
    if (!key) return { replacement: null };
    const need = card.pos;
    const onField = new Set(Object.values(this.onField));
    const free = BENCH.map((s) => this.cards[s.key]).filter((c) => c && !c.injured && !onField.has(c));
    let rep = free.find((c) => c.pos === need);
    if (!rep && free.length) {
      const src = free.slice().sort((a, b) => this.energy[b.id] - this.energy[a.id])[0];
      rep = buildCard(src.slug, need, { id: `${src.id}@${need}`, teamId: src.teamId, slot: src.slot, outOfPosition: src.pos, bonus: src.bonus });
      rep.sourceId = src.id;
      registry[rep.id] = rep;
      this.cards[`x${rep.id}`] = rep;
      this.energy[rep.id] = this.energy[src.id];
      src.injured = true; // he's committed to the new spot (can't also play his own)
      src.convertedTo = rep.id;
    }
    if (!rep) return { replacement: null }; // nobody left: he stays in (toughing it out)
    this.onField[key] = rep;
    // the original starter never comes back; point his slot at the replacement
    if (this.cards[key] === card) this.cards[key] = rep;
    return { replacement: rep };
  }

  substitute(unit) {
    const notes = [];
    const keys = unit === 'O' ? OFF_KEYS : DEF_KEYS;
    for (const k of keys) {
      const starter = this.cards[k];
      const current = this.onField[k];
      const backup = this.cards[`b${starter.pos}`];
      if (!backup || starter.injured) continue;
      if (backup.injured && current === starter) continue;
      if (current === starter) {
        const e = this.energy[starter.id], be = this.energy[backup.id];
        const benchFree = !Object.values(this.onField).includes(backup);
        if (e < SUB_OUT && benchFree && be >= FRESH && be - e >= 15) {
          this.onField[k] = backup;
          notes.push(`${backup.name} (${backup.pos}) in for a winded ${starter.name}`);
        }
      } else if (this.energy[starter.id] >= SUB_BACK && current === backup) {
        this.onField[k] = starter;
        notes.push(`${starter.name} (${starter.pos}) back in`);
      }
    }
    return notes;
  }
}
