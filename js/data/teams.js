// AI teams. Rosters use the card format from js/roster.js:
//   slot: 'slug' (position implied by the slot) or 'slug:POS' for FLEX slots.
// FXO (offensive FLEX) sets personnel: RB = 2-back, WR = spread, TE = tight end sets.
// FXD (defensive FLEX) sets the front: DL = 3-2-2, LB = 2-3-2, DB = 2-2-3.
//
// Coach tendencies (0..1):
//   passRate   base share of pass calls in neutral situations
//   deepRate   preference for vertical concepts over quick game
//   aggression 4th-down / 2-pt / late-game risk appetite
//   blitzRate  how often the defense sends extra rushers
//   manRate    man coverage vs zone preference
//   paRate     play-action usage
//   runStyle   'zone' | 'power' | 'mixed'
//   tempo      'hurry' | 'normal' | 'slow'

export const COACH_PRESETS = {
  balanced: { style: 'Balanced Pro-Style', passRate: 0.52, deepRate: 0.45, aggression: 0.5, blitzRate: 0.3, manRate: 0.5, paRate: 0.3, runStyle: 'mixed', tempo: 'normal' },
  airRaid: { style: 'Air Raid', passRate: 0.68, deepRate: 0.6, aggression: 0.7, blitzRate: 0.25, manRate: 0.35, paRate: 0.15, runStyle: 'zone', tempo: 'hurry' },
  groundPound: { style: 'Ground & Pound', passRate: 0.4, deepRate: 0.35, aggression: 0.35, blitzRate: 0.35, manRate: 0.4, paRate: 0.4, runStyle: 'power', tempo: 'slow' },
  attackD: { style: 'Attack Defense', passRate: 0.55, deepRate: 0.5, aggression: 0.75, blitzRate: 0.6, manRate: 0.65, paRate: 0.25, runStyle: 'mixed', tempo: 'normal' },
  spread: { style: 'Spread Tempo', passRate: 0.62, deepRate: 0.55, aggression: 0.55, blitzRate: 0.3, manRate: 0.3, paRate: 0.2, runStyle: 'zone', tempo: 'hurry' },
  westCoast: { style: 'West Coast', passRate: 0.58, deepRate: 0.3, aggression: 0.4, blitzRate: 0.2, manRate: 0.35, paRate: 0.3, runStyle: 'zone', tempo: 'normal' },
  runShoot: { style: 'Run & Shoot', passRate: 0.6, deepRate: 0.5, aggression: 0.85, blitzRate: 0.45, manRate: 0.5, paRate: 0.2, runStyle: 'mixed', tempo: 'hurry' },
  clock: { style: 'Clock Control', passRate: 0.5, deepRate: 0.4, aggression: 0.5, blitzRate: 0.35, manRate: 0.45, paRate: 0.35, runStyle: 'power', tempo: 'slow' },
};

const coach = (name, preset) => ({ name, preset, ...COACH_PRESETS[preset] });

export const TEAMS = [
  {
    id: 'kanto', city: 'Kanto', name: 'Kings', abbr: 'KAN',
    colors: { primary: '#c62828', secondary: '#f9c74f' },
    coach: coach('Coach Oak', 'balanced'),
    roster: {
      QB: 'alakazam', RB: 'tauros', WR: 'jolteon', FXO: 'rapidash:WR', OL1: 'snorlax', OL2: 'golem', OL3: 'rhydon',
      DL1: 'machamp', DL2: 'nidoking', LB1: 'kangaskhan', LB2: 'gyarados', DB1: 'persian', DB2: 'arcanine', FXD: 'dugtrio:DB', K: 'starmie',
      bQB: 'gengar', bRB: 'dodrio', bWR: 'aerodactyl', bTE: 'nidoqueen', bOL: 'slowbro', bDL: 'lapras', bLB: 'primeape', bDB: 'scyther',
    },
  },
  {
    id: 'johto', city: 'Johto', name: 'Jets', abbr: 'JOH',
    colors: { primary: '#1e88e5', secondary: '#cfd8dc' },
    coach: coach('Coach Falkner', 'airRaid'),
    roster: {
      QB: 'espeon', RB: 'houndoom', WR: 'crobat', FXO: 'sneasel:WR', OL1: 'steelix', OL2: 'donphan', OL3: 'ursaring',
      DL1: 'tyranitar', DL2: 'piloswine', LB1: 'scizor', LB2: 'granbull', DB1: 'jumpluff', DB2: 'xatu', FXD: 'kingdra:DB', K: 'togetic',
      bQB: 'ampharos', bRB: 'girafarig', bWR: 'yanma', bTE: 'heracross', bOL: 'quagsire', bDL: 'forretress', bLB: 'gligar', bDB: 'umbreon',
    },
  },
  {
    id: 'hoenn', city: 'Hoenn', name: 'Hurricanes', abbr: 'HOE',
    colors: { primary: '#00897b', secondary: '#1a237e' },
    coach: coach('Coach Wallace', 'groundPound'),
    roster: {
      QB: 'gardevoir', RB: 'blaziken', WR: 'manectric', FXO: 'swampert:RB', OL1: 'aggron', OL2: 'hariyama', OL3: 'walrein',
      DL1: 'metagross', DL2: 'camerupt', LB1: 'zangoose', LB2: 'salamence', DB1: 'sceptile', DB2: 'absol', FXD: 'flygon:LB', K: 'swellow',
      bQB: 'claydol', bRB: 'linoone', bWR: 'ninjask', bTE: 'breloom', bOL: 'torkoal', bDL: 'exploud', bLB: 'sharpedo', bDB: 'medicham',
    },
  },
  {
    id: 'sinnoh', city: 'Sinnoh', name: 'Blizzard', abbr: 'SIN',
    colors: { primary: '#263238', secondary: '#81d4fa' },
    coach: coach('Coach Cynthia', 'attackD'),
    roster: {
      QB: 'lucario', RB: 'garchomp', WR: 'infernape', FXO: 'luxray:TE', OL1: 'rhyperior', OL2: 'bastiodon', OL3: 'probopass',
      DL1: 'mamoswine', DL2: 'hippowdon', LB1: 'gallade', LB2: 'staraptor', DB1: 'weavile', DB2: 'honchkrow', FXD: 'abomasnow:DL', K: 'togekiss',
      bQB: 'magmortar', bRB: 'floatzel', bWR: 'ambipom', bTE: 'electivire', bOL: 'torterra', bDL: 'drapion', bLB: 'gliscor', bDB: 'lopunny',
    },
  },
  {
    id: 'unova', city: 'Unova', name: 'Volts', abbr: 'UNO',
    colors: { primary: '#fdd835', secondary: '#212121' },
    coach: coach('Coach Elesa', 'spread'),
    roster: {
      QB: 'zoroark', RB: 'krookodile', WR: 'zebstrika', FXO: 'accelgor:WR', OL1: 'conkeldurr', OL2: 'gigalith', OL3: 'golurk',
      DL1: 'beartic', DL2: 'excadrill', LB1: 'bisharp', LB2: 'braviary', DB1: 'liepard', DB2: 'galvantula', FXD: 'mienshao:DB', K: 'chandelure',
      bQB: 'volcarona', bRB: 'emboar', bWR: 'swoobat', bTE: 'haxorus', bOL: 'crustle', bDL: 'druddigon', bLB: 'sawk', bDB: 'stoutland',
    },
  },
  {
    id: 'kalos', city: 'Kalos', name: 'Royals', abbr: 'KAL',
    colors: { primary: '#6a1b9a', secondary: '#f48fb1' },
    coach: coach('Coach Diantha', 'westCoast'),
    roster: {
      QB: 'delphox', RB: 'hawlucha', WR: 'greninja', FXO: 'tyrantrum:TE', OL1: 'avalugg', OL2: 'chesnaught', OL3: 'carbink',
      DL1: 'goodra', DL2: 'gogoat', LB1: 'pangoro', LB2: 'pyroar', DB1: 'heliolisk', DB2: 'noivern', FXD: 'sylveon:DB', K: 'aromatisse',
      bQB: 'meowstic', bRB: 'diggersby', bWR: 'talonflame', bTE: 'trevenant', bOL: 'aurorus', bDL: 'dragalge', bLB: 'malamar', bDB: 'furfrou',
    },
  },
  {
    id: 'alola', city: 'Alola', name: 'Tides', abbr: 'ALO',
    colors: { primary: '#ef6c00', secondary: '#4dd0e1' },
    coach: coach('Coach Kukui', 'runShoot'),
    roster: {
      QB: 'primarina', RB: 'lycanroc', WR: 'ribombee', FXO: 'salazzle:WR', OL1: 'mudsdale', OL2: 'kommo-o', OL3: 'dhelmise',
      DL1: 'incineroar', DL2: 'bewear', LB1: 'golisopod', LB2: 'decidueye', DB1: 'mimikyu', DB2: 'passimian', FXD: 'toucannon:LB', K: 'oranguru',
      bQB: 'silvally', bRB: 'type-null', bWR: 'oricorio', bTE: 'tsareena', bOL: 'palossand', bDL: 'drampa', bLB: 'toxapex', bDB: 'bruxish',
    },
  },
  {
    id: 'galar', city: 'Galar', name: 'Gales', abbr: 'GAL',
    colors: { primary: '#8e1b3a', secondary: '#ffca28' },
    coach: coach('Coach Leon', 'clock'),
    roster: {
      QB: 'inteleon', RB: 'cinderace', WR: 'dragapult', FXO: 'rillaboom:RB', OL1: 'copperajah', OL2: 'coalossal', OL3: 'stonjourner',
      DL1: 'grimmsnarl', DL2: 'centiskorch', LB1: 'sirfetchd', LB2: 'corviknight', DB1: 'obstagoon', DB2: 'barraskewda', FXD: 'duraludon:DL', K: 'alcremie',
      bQB: 'toxtricity', bRB: 'boltund', bWR: 'thievul', bTE: 'drednaw', bOL: 'eiscue', bDL: 'falinks', bLB: 'perrserker', bDB: 'cramorant',
    },
  },
];
