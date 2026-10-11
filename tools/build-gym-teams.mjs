// Builds js/data/gymTeams.js: one team for each of the 64 gym leaders / trial captains from
// generations 1-8. Each leader's own Pokémon (their base-game team, plus rematch / later
// appearances) are always on the roster and start where possible; the rest of the 23 cards
// are filled with Pokémon of the leader's type (gens 1-8 through Sword & Shield, no legendaries), leaning toward
// their own region's Pokémon and away from cards the other leaders of that type already took.
// Every card goes to the position its stats suit best (an optimal assignment).
//
//   node tools/build-gym-teams.mjs
import { writeFileSync } from 'node:fs';
import { POKEMON_LIST, POKEMON } from '../js/data/pokemon.js';
import { cardRatings, overall } from '../js/ratings.js';
import { ALL_SLOTS, STARTERS } from '../js/roster.js';

// [gen, leader, city, name, abbr, preset, types, signature Pokémon (ace first), colors, secondary types, max secondary-type cards]
const L = (gen, leader, city, name, abbr, preset, types, sig, colors, alt = [], altN = 6) => ({ gen, leader, city, name, abbr, preset, types, sig, colors, alt, altN });
const LEADERS = [
  // ---- Kanto (Red / Blue)
  L(1, 'Brock', 'Pewter', 'Boulders', 'PEW', 'groundPound', ['rock'], ['golem', 'onix', 'rhyperior', 'omastar', 'kabutops', 'aerodactyl'], ['#8d6e63', '#d7ccc8'], ['ground']),
  L(1, 'Misty', 'Cerulean', 'Cascades', 'CER', 'airRaid', ['water'], ['starmie', 'golduck', 'gyarados', 'lapras', 'quagsire', 'seaking'], ['#0288d1', '#ffeb3b']),
  L(1, 'Lt. Surge', 'Vermilion', 'Thunder', 'VER', 'attackD', ['electric'], ['raichu', 'electrode', 'magneton', 'electabuzz', 'jolteon', 'electivire'], ['#f9a825', '#33691e']),
  L(1, 'Erika', 'Celadon', 'Blossoms', 'CEL', 'westCoast', ['grass'], ['vileplume', 'victreebel', 'tangrowth', 'bellossom', 'jumpluff', 'exeggutor'], ['#43a047', '#f48fb1']),
  L(1, 'Koga', 'Fuchsia', 'Ninjas', 'FUC', 'attackD', ['poison'], ['weezing', 'muk', 'venomoth', 'crobat', 'ariados', 'forretress'], ['#6a1b9a', '#212121']),
  L(1, 'Sabrina', 'Saffron', 'Psychics', 'SAF', 'airRaid', ['psychic'], ['alakazam', 'mr-mime', 'espeon', 'slowbro', 'jynx', 'hypno'], ['#c2185b', '#ffd54f'], ['steel']),
  L(1, 'Blaine', 'Cinnabar', 'Blaze', 'CIN', 'runShoot', ['fire'], ['arcanine', 'rapidash', 'ninetales', 'magmortar', 'magcargo', 'flareon'], ['#d32f2f', '#ffb300']),
  L(1, 'Giovanni', 'Viridian', 'Rockets', 'VIR', 'clock', ['ground'], ['rhydon', 'nidoking', 'nidoqueen', 'dugtrio', 'persian', 'rhyperior'], ['#212121', '#c62828']),
  // ---- Johto (Gold / Silver)
  L(2, 'Falkner', 'Violet', 'Wings', 'VIO', 'airRaid', ['flying'], ['pidgeot', 'noctowl', 'dodrio', 'xatu', 'honchkrow'], ['#3949ab', '#b3e5fc']),
  L(2, 'Bugsy', 'Azalea', 'Swarm', 'AZA', 'spread', ['bug'], ['scizor', 'scyther', 'heracross', 'beedrill', 'butterfree', 'yanmega'], ['#7cb342', '#6d4c41']),
  L(2, 'Whitney', 'Goldenrod', 'Stampede', 'GLD', 'groundPound', ['normal'], ['miltank', 'clefable', 'wigglytuff', 'girafarig', 'ursaring'], ['#ec407a', '#fff59d'], ['fairy', 'flying']),
  L(2, 'Morty', 'Ecruteak', 'Phantoms', 'ECR', 'westCoast', ['ghost'], ['gengar', 'mismagius', 'dusknoir', 'drifblim'], ['#4a148c', '#ffd54f'], ['poison']),
  L(2, 'Chuck', 'Cianwood', 'Crashers', 'CIA', 'groundPound', ['fighting'], ['poliwrath', 'primeape', 'machamp', 'hitmonlee', 'hitmonchan', 'hitmontop'], ['#e65100', '#5d4037']),
  L(2, 'Jasmine', 'Olivine', 'Ironclads', 'OLI', 'clock', ['steel'], ['steelix', 'magnezone', 'skarmory', 'forretress', 'ampharos'], ['#78909c', '#fff176']),
  L(2, 'Pryce', 'Mahogany', 'Freeze', 'MAH', 'groundPound', ['ice'], ['mamoswine', 'dewgong', 'cloyster', 'lapras', 'weavile'], ['#4fc3f7', '#eceff1'], ['water']),
  L(2, 'Clair', 'Blackthorn', 'Dragons', 'BLK', 'attackD', ['dragon'], ['kingdra', 'dragonite', 'gyarados', 'altaria'], ['#1565c0', '#263238'], ['water', 'flying']),
  // ---- Hoenn (Ruby / Sapphire)
  L(3, 'Roxanne', 'Rustboro', 'Scholars', 'RUS', 'westCoast', ['rock'], ['probopass', 'golem', 'cradily', 'armaldo', 'relicanth'], ['#8d6e63', '#f48fb1'], ['ground']),
  L(3, 'Brawly', 'Dewford', 'Breakers', 'DEW', 'spread', ['fighting'], ['hariyama', 'medicham', 'breloom', 'machamp'], ['#0277bd', '#ff8f00']),
  L(3, 'Wattson', 'Mauville', 'Dynamos', 'MAU', 'balanced', ['electric'], ['manectric', 'magnezone', 'electrode', 'ampharos'], ['#fbc02d', '#546e7a'], ['steel']),
  L(3, 'Flannery', 'Lavaridge', 'Heat', 'LAV', 'airRaid', ['fire'], ['torkoal', 'camerupt', 'magcargo', 'houndoom'], ['#f4511e', '#ffe082']),
  L(3, 'Norman', 'Petalburg', 'Guardians', 'PET', 'balanced', ['normal'], ['slaking', 'vigoroth', 'linoone', 'kangaskhan', 'blissey', 'tauros'], ['#00796b', '#e0e0e0'], ['flying']),
  L(3, 'Winona', 'Fortree', 'Skyhawks', 'FOR', 'westCoast', ['flying'], ['altaria', 'skarmory', 'pelipper', 'swellow', 'tropius'], ['#0097a7', '#b2ebf2']),
  L(3, 'Tate & Liza', 'Mossdeep', 'Twins', 'MOS', 'westCoast', ['psychic'], ['solrock', 'lunatone', 'claydol', 'xatu', 'gardevoir'], ['#8e24aa', '#ff7043'], ['rock']),
  L(3, 'Wallace', 'Sootopolis', 'Swell', 'SOO', 'spread', ['water'], ['milotic', 'whiscash', 'walrein', 'seaking', 'ludicolo', 'tentacruel'], ['#1e88e5', '#e1bee7']),
  // ---- Sinnoh (Diamond / Pearl)
  L(4, 'Roark', 'Oreburgh', 'Miners', 'ORE', 'groundPound', ['rock'], ['rampardos', 'golem', 'probopass', 'aerodactyl', 'onix'], ['#6d4c41', '#ff6f00']),
  L(4, 'Gardenia', 'Eterna', 'Wildflowers', 'ETR', 'spread', ['grass'], ['roserade', 'cherrim', 'torterra', 'leafeon', 'tangrowth'], ['#2e7d32', '#fdd835']),
  L(4, 'Maylene', 'Veilstone', 'Fists', 'VEI', 'attackD', ['fighting'], ['lucario', 'medicham', 'machamp', 'toxicroak'], ['#d81b60', '#424242']),
  L(4, 'Crasher Wake', 'Pastoria', 'Wrestlers', 'PAS', 'runShoot', ['water'], ['floatzel', 'gyarados', 'quagsire', 'ludicolo'], ['#00acc1', '#fdd835']),
  L(4, 'Fantina', 'Hearthome', 'Divas', 'HEA', 'westCoast', ['ghost'], ['mismagius', 'drifblim', 'gengar', 'spiritomb', 'froslass'], ['#8e24aa', '#f8bbd0'], ['psychic']),
  L(4, 'Byron', 'Canalave', 'Ironworks', 'CNV', 'clock', ['steel'], ['bastiodon', 'steelix', 'bronzong', 'aggron'], ['#455a64', '#ffb300']),
  L(4, 'Candice', 'Snowpoint', 'Flurries', 'SNO', 'spread', ['ice'], ['abomasnow', 'froslass', 'weavile', 'mamoswine', 'medicham', 'glaceon'], ['#4dd0e1', '#43a047']),
  L(4, 'Volkner', 'Sunyshore', 'Sparks', 'SUN', 'airRaid', ['electric'], ['luxray', 'electivire', 'raichu', 'jolteon', 'ambipom', 'octillery'], ['#f9a825', '#0d47a1']),
  // ---- Unova (Black / White)
  L(5, 'Cilan', 'Striaton', 'Servers', 'STR', 'westCoast', ['grass'], ['simisage', 'lilligant', 'whimsicott', 'leavanny', 'ferrothorn'], ['#43a047', '#fff8e1']),
  L(5, 'Lenora', 'Nacrene', 'Curators', 'NAC', 'clock', ['normal'], ['watchog', 'stoutland', 'cinccino', 'bouffalant', 'braviary'], ['#8d6e63', '#ffcc80']),
  L(5, 'Burgh', 'Castelia', 'Canvas', 'CAS', 'spread', ['bug'], ['leavanny', 'scolipede', 'crustle', 'escavalier', 'galvantula', 'volcarona'], ['#9ccc65', '#7b1fa2']),
  L(5, 'Elesa', 'Nimbasa', 'Stars', 'NIM', 'airRaid', ['electric'], ['zebstrika', 'emolga', 'ampharos', 'eelektross'], ['#fdd835', '#212121'], ['flying', 'steel']),
  L(5, 'Clay', 'Driftveil', 'Diggers', 'DRI', 'groundPound', ['ground'], ['excadrill', 'krookodile', 'seismitoad', 'golurk'], ['#795548', '#ffa000']),
  L(5, 'Skyla', 'Mistralton', 'Pilots', 'MIS', 'airRaid', ['flying'], ['swanna', 'unfezant', 'swoobat', 'skarmory', 'braviary'], ['#29b6f6', '#e53935']),
  L(5, 'Brycen', 'Icirrus', 'Glaciers', 'ICI', 'clock', ['ice'], ['beartic', 'cryogonal', 'vanilluxe', 'walrein'], ['#26c6da', '#263238']),
  L(5, 'Drayden', 'Opelucid', 'Wyverns', 'OPE', 'clock', ['dragon'], ['haxorus', 'druddigon', 'flygon', 'altaria'], ['#424242', '#ff7043']),
  // ---- Kalos (X / Y)
  L(6, 'Viola', 'Santalune', 'Shutterbugs', 'SAN', 'westCoast', ['bug'], ['vivillon', 'masquerain', 'pinsir', 'heracross'], ['#9ccc65', '#f06292'], ['flying']),
  L(6, 'Grant', 'Cyllage', 'Climbers', 'CYL', 'groundPound', ['rock'], ['tyrantrum', 'aurorus', 'carbink', 'barbaracle'], ['#a1887f', '#4db6ac']),
  L(6, 'Korrina', 'Shalour', 'Rollers', 'SHA', 'attackD', ['fighting'], ['lucario', 'mienshao', 'machamp', 'hawlucha'], ['#e53935', '#fdd835']),
  L(6, 'Ramos', 'Coumarine', 'Gardeners', 'COU', 'groundPound', ['grass'], ['gogoat', 'jumpluff', 'victreebel', 'chesnaught'], ['#558b2f', '#ffecb3']),
  L(6, 'Clemont', 'Lumiose', 'Inventors', 'LUM', 'spread', ['electric'], ['heliolisk', 'emolga', 'magnezone', 'dedenne'], ['#fb8c00', '#1e88e5'], ['steel']),
  L(6, 'Valerie', 'Laverre', 'Fae', 'LVR', 'airRaid', ['fairy'], ['sylveon', 'mawile', 'mr-mime', 'aromatisse', 'slurpuff'], ['#f06292', '#ce93d8'], ['steel', 'psychic'], 9),
  L(6, 'Olympia', 'Anistar', 'Oracles', 'ANI', 'balanced', ['psychic'], ['meowstic', 'sigilyph', 'slowking', 'malamar'], ['#7e57c2', '#ffd54f'], ['steel', 'fighting']),
  L(6, 'Wulfric', 'Snowbelle', 'Avalanche', 'SNB', 'groundPound', ['ice'], ['avalugg', 'abomasnow', 'cryogonal', 'aurorus'], ['#81d4fa', '#5d4037']),
  // ---- Alola (Sun / Moon): the seven trial captains, plus Hapu's grand trial
  L(7, 'Ilima', 'Verdant', 'Valiants', 'VRD', 'balanced', ['normal'], ['gumshoos', 'smeargle', 'komala', 'oranguru'], ['#fbc02d', '#ff8a65'], ['flying', 'fighting']),
  L(7, 'Lana', 'Brooklet', 'Riptides', 'BRK', 'spread', ['water'], ['araquanid', 'wishiwashi', 'lanturn', 'toxapex'], ['#0288d1', '#80deea']),
  L(7, 'Kiawe', 'Wela', 'Infernos', 'WEL', 'runShoot', ['fire'], ['salazzle', 'arcanine', 'marowak', 'turtonator'], ['#e64a19', '#ffd740']),
  L(7, 'Mallow', 'Lush Jungle', 'Chefs', 'LUS', 'westCoast', ['grass'], ['lurantis', 'tsareena', 'shiinotic', 'decidueye'], ['#388e3c', '#f8bbd0']),
  L(7, 'Sophocles', 'Hokulani', 'Circuits', 'HOK', 'spread', ['electric'], ['vikavolt', 'togedemaru', 'magnezone', 'golisopod'], ['#ffb300', '#3949ab'], ['bug', 'steel']),
  L(7, 'Acerola', 'Thrifty', 'Phantoms', 'THR', 'runShoot', ['ghost'], ['mimikyu', 'palossand', 'dhelmise', 'drifblim', 'sableye', 'froslass'], ['#5e35b1', '#80cbc4']),
  L(7, 'Mina', 'Seafolk', 'Painters', 'SEA', 'airRaid', ['fairy'], ['ribombee', 'granbull', 'wigglytuff', 'klefki', 'comfey'], ['#ec407a', '#fff176'], ['bug', 'normal'], 9),
  L(7, 'Hapu', 'Poni', 'Landslides', 'PON', 'groundPound', ['ground'], ['mudsdale', 'flygon', 'gastrodon', 'golurk'], ['#6d4c41', '#aed581']),
  // ---- Galar (Sword)
  L(8, 'Milo', 'Turffield', 'Harvest', 'TUR', 'groundPound', ['grass'], ['eldegoss', 'flapple', 'ludicolo', 'shiftry'], ['#7cb342', '#fff9c4']),
  L(8, 'Nessa', 'Hulbury', 'Waves', 'HUL', 'spread', ['water'], ['drednaw', 'barraskewda', 'golisopod', 'pelipper', 'seaking'], ['#1e88e5', '#ff7043']),
  L(8, 'Kabu', 'Motostoke', 'Flames', 'MOT', 'attackD', ['fire'], ['centiskorch', 'ninetales', 'arcanine', 'torkoal'], ['#d84315', '#fbc02d']),
  L(8, 'Bea', 'Stow-on-Side', 'Strikers', 'STW', 'attackD', ['fighting'], ['machamp', 'sirfetchd', 'hitmontop', 'pangoro', 'grapploct', 'falinks'], ['#424242', '#fdd835']),
  L(8, 'Opal', 'Ballonlea', 'Enchanters', 'BAL', 'runShoot', ['fairy'], ['alcremie', 'togekiss', 'mawile', 'hatterene'], ['#ad1457', '#b39ddb'], ['poison', 'psychic'], 9),
  L(8, 'Gordie', 'Circhester', 'Rockers', 'CIR', 'groundPound', ['rock'], ['coalossal', 'stonjourner', 'barbaracle', 'shuckle'], ['#ef6c00', '#4e342e'], ['fire']),
  L(8, 'Piers', 'Spikemuth', 'Punks', 'SPK', 'runShoot', ['dark'], ['obstagoon', 'scrafty', 'malamar', 'skuntank'], ['#d81b60', '#212121']),
  L(8, 'Raihan', 'Hammerlocke', 'Storm', 'HAM', 'airRaid', ['dragon'], ['duraludon', 'flygon', 'gigalith', 'sandaconda', 'goodra', 'turtonator'], ['#37474f', '#ff6f00'], ['ground']),
];
const REGIONS = ['Kanto', 'Johto', 'Hoenn', 'Sinnoh', 'Unova', 'Kalos', 'Alola', 'Galar'];

// legendaries, mythicals, Ultra Beasts and other one-of-a-kind Pokémon stay out of the fill
const LEGEND = new Set([
  144, 145, 146, 150, 151, 243, 244, 245, 249, 250, 251, 377, 378, 379, 380, 381, 382, 383, 384, 385, 386,
  480, 481, 482, 483, 484, 485, 486, 487, 488, 489, 490, 491, 492, 493, 494, 638, 639, 640, 641, 642, 643, 644, 645, 646, 647, 648, 649,
  716, 717, 718, 719, 720, 721, 772, 773, 785, 786, 787, 788, 789, 790, 791, 792, 793, 794, 795, 796, 797, 798, 799, 800, 801, 802,
  803, 804, 805, 806, 807, 808, 809, 888, 889, 890, 891, 892, 893, 894, 895, 896, 897, 898, 905,
]);
const genOf = (dex) => (dex <= 151 ? 1 : dex <= 251 ? 2 : dex <= 386 ? 3 : dex <= 493 ? 4 : dex <= 649 ? 5 : dex <= 721 ? 6 : dex <= 809 ? 7 : 8);

// ---- min-cost assignment (Hungarian), n rows <= m columns
function hungarian(cost) {
  const n = cost.length, m = cost[0].length, INF = 1e18;
  const u = new Array(n + 1).fill(0), v = new Array(m + 1).fill(0), p = new Array(m + 1).fill(0), way = new Array(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i; let j0 = 0;
    const minv = new Array(m + 1).fill(INF), used = new Array(m + 1).fill(false);
    do {
      used[j0] = true; const i0 = p[j0]; let delta = INF, j1 = 0;
      for (let j = 1; j <= m; j++) if (!used[j]) {
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
        if (minv[j] < delta) { delta = minv[j]; j1 = j; }
      }
      for (let j = 0; j <= m; j++) if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta;
      j0 = j1;
    } while (p[j0] !== 0);
    do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
  }
  const rowCol = new Array(n);
  for (let j = 1; j <= m; j++) if (p[j]) rowCol[p[j] - 1] = j - 1;
  return rowCol;
}

const ovrCache = {};
const ovrOf = (slug, pos) => (ovrCache[`${slug}|${pos}`] ??= overall(pos, cardRatings(slug, pos)));
// speed decides more in the sim than the OVR formula shows, especially for the skill players and back seven
// (and a front seven needs strength: tackling, shedding blocks, holding the point)
const SPEEDY = { RB: 0.2, WR: 0.2, DB: 0.25, LB: 0.12, QB: 0.05 };
const STRONG = { DL: 0.15, LB: 0.12, OL: 0.05 };
const fitOf = (slug, pos) => {
  const r = cardRatings(slug, pos);
  return ovrOf(slug, pos) + (SPEEDY[pos] || 0) * (r.spd - 60) + (STRONG[pos] || 0) * (r.str - 60);
};
const starterKeys = new Set(STARTERS.map((s) => s.key));
const used = {}; // slug -> how many teams of the same type already have it
const usedAll = {}; // slug -> how many teams of any type have it

const out = [];
for (const ld of LEADERS) {
  for (const s of ld.sig) if (!POKEMON[s]) throw new Error(`${ld.leader}: unknown ${s}`);
  const typeKey = ld.types.join('/');
  used[typeKey] ||= {};
  const ok = (p) => p.dex <= 898 && !LEGEND.has(p.dex) && p.bst < 600;
  const bestOvr = (slug) => Math.max(...['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'DB'].map((pos) => fitOf(slug, pos)));
  const pool = POKEMON_LIST.filter((p) => ok(p) && p.types.some((t) => ld.types.includes(t)));
  // a secondary type only fills gaps (six of its best cards at most, unless noted), so the team stays the leader's type
  const altPool = POKEMON_LIST.filter((p) => ok(p) && !p.types.some((t) => ld.types.includes(t)) && p.types.some((t) => ld.alt.includes(t)))
    .sort((a, b) => bestOvr(b.slug) - 2 * (usedAll[b.slug] || 0) - (bestOvr(a.slug) - 2 * (usedAll[a.slug] || 0))).slice(0, ld.altN);
  const cands = [...new Set([...ld.sig, ...pool.map((p) => p.slug), ...altPool.map((p) => p.slug)])];
  const flavor = (slug) => {
    if (ld.sig.includes(slug)) return 0;
    const p = POKEMON[slug], g = genOf(p.dex);
    let b = g === ld.gen ? 6 : g < ld.gen ? 2 : -1;
    if (!p.types.some((t) => ld.types.includes(t))) b -= ld.altN > 6 ? 0 : 3; // a secondary-theme type (free for the thin types)
    if (p.bst < 420) b -= 10; // unevolved Pokémon only when there's nothing better
    b -= 5 * Math.min(used[typeKey][slug] || 0, 2) + 1.5 * Math.min(usedAll[slug] || 0, 3);
    return b;
  };
  const cost = ALL_SLOTS.map((sl) => cands.map((slug) => {
    const best = Math.max(...sl.pos.map((pos) => fitOf(slug, pos)));
    const starter = starterKeys.has(sl.key);
    let v = (starter ? best : best * 0.55) + flavor(slug) * (starter ? 1 : 0.55);
    const si = ld.sig.indexOf(slug);
    if (si >= 0) v += 1000 + (starter ? (si === 0 ? 30 : 2) : 0);
    return -v;
  }));
  const pick = hungarian(cost);
  const roster = {};
  ALL_SLOTS.forEach((sl, i) => {
    const slug = cands[pick[i]];
    const pos = sl.pos.reduce((a, b) => (fitOf(slug, b) > fitOf(slug, a) ? b : a));
    roster[sl.key] = sl.pos.length > 1 ? `${slug}:${pos}` : slug;
    if (!ld.sig.includes(slug)) { used[typeKey][slug] = (used[typeKey][slug] || 0) + 1; usedAll[slug] = (usedAll[slug] || 0) + 1; }
  });
  const id = `gym-${ld.leader.toLowerCase().replace(/[^a-z]+/g, '-').replace(/-$/, '')}`;
  const title = ld.gen === 7 ? (ld.leader === 'Hapu' ? 'Kahuna' : 'Trial Captain') : 'Gym Leader';
  out.push({ id, region: REGIONS[ld.gen - 1], gen: ld.gen, type: ld.types[0], title, aces: ld.sig.slice(0, 3), city: ld.city, name: ld.name, abbr: ld.abbr, leader: ld.leader, preset: ld.preset, colors: ld.colors, roster });
}

const ids = new Set(out.map((t) => t.id)), abbrs = new Set(out.map((t) => t.abbr));
if (ids.size !== out.length || abbrs.size !== out.length) throw new Error('duplicate id / abbr');

const lines = out.map((t) => `  {
    id: '${t.id}', region: '${t.region}', gen: ${t.gen}, type: '${t.type}', title: '${t.title}', aces: ${JSON.stringify(t.aces).replace(/"/g, "'")},
    city: '${t.city}', name: '${t.name}', abbr: '${t.abbr}',
    colors: { primary: '${t.colors[0]}', secondary: '${t.colors[1]}' },
    coach: coach('${t.leader}', '${t.preset}'),
    roster: {
      ${ALL_SLOTS.filter((s) => s.unit === 'O').map((s) => `${s.key}: '${t.roster[s.key]}'`).join(', ')},
      ${ALL_SLOTS.filter((s) => s.unit === 'D' || s.unit === 'S').map((s) => `${s.key}: '${t.roster[s.key]}'`).join(', ')},
      ${ALL_SLOTS.filter((s) => s.unit === 'B').map((s) => `${s.key}: '${t.roster[s.key]}'`).join(', ')},
    },
  },`);
writeFileSync(new URL('../js/data/gymTeams.js', import.meta.url), `// AUTO-GENERATED by tools/build-gym-teams.mjs — edit the leader list there and re-run.
// The 64 gym leaders / trial captains of generations 1-8, as teams (same card format as js/data/teams.js).
import { COACH_PRESETS } from './teams.js';

const coach = (name, preset) => ({ name, preset, ...COACH_PRESETS[preset] });

export const GYM_REGIONS = ${JSON.stringify(REGIONS)};

export const GYM_TEAMS = [
${lines.join('\n')}
];
`);

// report
for (const t of out) {
  const st = STARTERS.map((s) => { const [slug, p] = t.roster[s.key].split(':'); return ovrOf(slug, p || s.pos[0]); });
  const own = Object.values(t.roster).filter((v) => POKEMON[v.split(':')[0]].types.includes(t.type)).length;
  console.log(`${t.abbr} ${String(own).padStart(2)}/23 ${t.leader.padEnd(13)} avg ${(st.reduce((a, b) => a + b, 0) / st.length).toFixed(1)}  ${STARTERS.map((s) => `${s.key}=${t.roster[s.key]}`).join(' ')}`);
}
