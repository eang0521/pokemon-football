// Pre-built themed teams. `mon` is the pokemondb.net slug.
// Offense (7): QB, RB, WR1 (X), WR2 (Z), TE, C, G
// Defense (7): DL1, DL2, LB1 (Mike), LB2 (Will), CB1, CB2, S
// Special teams: K (kicks & punts)
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

export const TEAMS = [
  {
    id: 'kanto', city: 'Kanto', name: 'Kings', abbr: 'KAN',
    colors: { primary: '#c62828', secondary: '#f9c74f' },
    coach: { name: 'Coach Oak', style: 'Balanced Pro-Style',
      passRate: 0.52, deepRate: 0.45, aggression: 0.5, blitzRate: 0.3, manRate: 0.5, paRate: 0.3, runStyle: 'mixed', tempo: 'normal' },
    roster: {
      QB: { mon: 'alakazam', num: 12 }, RB: { mon: 'tauros', num: 28 }, WR1: { mon: 'jolteon', num: 11 },
      WR2: { mon: 'rapidash', num: 84 }, TE: { mon: 'nidoking', num: 87 }, C: { mon: 'snorlax', num: 60 },
      G: { mon: 'golem', num: 66 },
      DL1: { mon: 'rhydon', num: 99 }, DL2: { mon: 'machamp', num: 91 }, LB1: { mon: 'kangaskhan', num: 54 },
      LB2: { mon: 'gyarados', num: 52 }, CB1: { mon: 'persian', num: 24 }, CB2: { mon: 'dugtrio', num: 21 },
      S: { mon: 'arcanine', num: 31 }, K: { mon: 'starmie', num: 3 },
    },
  },
  {
    id: 'johto', city: 'Johto', name: 'Jets', abbr: 'JOH',
    colors: { primary: '#1e88e5', secondary: '#cfd8dc' },
    coach: { name: 'Coach Falkner', style: 'Air Raid',
      passRate: 0.68, deepRate: 0.6, aggression: 0.7, blitzRate: 0.25, manRate: 0.35, paRate: 0.15, runStyle: 'zone', tempo: 'hurry' },
    roster: {
      QB: { mon: 'espeon', num: 7 }, RB: { mon: 'houndoom', num: 22 }, WR1: { mon: 'crobat', num: 1 },
      WR2: { mon: 'sneasel', num: 13 }, TE: { mon: 'heracross', num: 85 }, C: { mon: 'steelix', num: 63 },
      G: { mon: 'donphan', num: 71 },
      DL1: { mon: 'tyranitar', num: 97 }, DL2: { mon: 'ursaring', num: 93 }, LB1: { mon: 'scizor', num: 50 },
      LB2: { mon: 'granbull', num: 45 }, CB1: { mon: 'jumpluff', num: 26 }, CB2: { mon: 'xatu', num: 23 },
      S: { mon: 'kingdra', num: 38 }, K: { mon: 'togetic', num: 5 },
    },
  },
  {
    id: 'hoenn', city: 'Hoenn', name: 'Hurricanes', abbr: 'HOE',
    colors: { primary: '#00897b', secondary: '#1a237e' },
    coach: { name: 'Coach Wallace', style: 'Ground & Pound',
      passRate: 0.4, deepRate: 0.35, aggression: 0.35, blitzRate: 0.35, manRate: 0.4, paRate: 0.4, runStyle: 'power', tempo: 'slow' },
    roster: {
      QB: { mon: 'gardevoir', num: 9 }, RB: { mon: 'blaziken', num: 32 }, WR1: { mon: 'manectric', num: 15 },
      WR2: { mon: 'ninjask', num: 17 }, TE: { mon: 'swampert', num: 89 }, C: { mon: 'aggron', num: 62 },
      G: { mon: 'hariyama', num: 68 },
      DL1: { mon: 'metagross', num: 95 }, DL2: { mon: 'walrein', num: 92 }, LB1: { mon: 'zangoose', num: 55 },
      LB2: { mon: 'salamence', num: 58 }, CB1: { mon: 'sceptile', num: 20 }, CB2: { mon: 'linoone', num: 27 },
      S: { mon: 'absol', num: 33 }, K: { mon: 'swellow', num: 2 },
    },
  },
  {
    id: 'sinnoh', city: 'Sinnoh', name: 'Blizzard', abbr: 'SIN',
    colors: { primary: '#263238', secondary: '#81d4fa' },
    coach: { name: 'Coach Cynthia', style: 'Attack Defense',
      passRate: 0.55, deepRate: 0.5, aggression: 0.75, blitzRate: 0.6, manRate: 0.65, paRate: 0.25, runStyle: 'mixed', tempo: 'normal' },
    roster: {
      QB: { mon: 'lucario', num: 4 }, RB: { mon: 'garchomp', num: 25 }, WR1: { mon: 'infernape', num: 81 },
      WR2: { mon: 'floatzel', num: 19 }, TE: { mon: 'luxray', num: 88 }, C: { mon: 'rhyperior', num: 64 },
      G: { mon: 'bastiodon', num: 77 },
      DL1: { mon: 'mamoswine', num: 98 }, DL2: { mon: 'hippowdon', num: 94 }, LB1: { mon: 'gallade', num: 51 },
      LB2: { mon: 'staraptor', num: 57 }, CB1: { mon: 'weavile', num: 29 }, CB2: { mon: 'ambipom', num: 36 },
      S: { mon: 'honchkrow', num: 42 }, K: { mon: 'togekiss', num: 6 },
    },
  },
  {
    id: 'unova', city: 'Unova', name: 'Volts', abbr: 'UNO',
    colors: { primary: '#fdd835', secondary: '#212121' },
    coach: { name: 'Coach Elesa', style: 'Spread Tempo',
      passRate: 0.62, deepRate: 0.55, aggression: 0.55, blitzRate: 0.3, manRate: 0.3, paRate: 0.2, runStyle: 'zone', tempo: 'hurry' },
    roster: {
      QB: { mon: 'zoroark', num: 10 }, RB: { mon: 'krookodile', num: 34 }, WR1: { mon: 'zebstrika', num: 82 },
      WR2: { mon: 'accelgor', num: 14 }, TE: { mon: 'haxorus', num: 86 }, C: { mon: 'conkeldurr', num: 61 },
      G: { mon: 'gigalith', num: 74 },
      DL1: { mon: 'beartic', num: 96 }, DL2: { mon: 'excadrill', num: 90 }, LB1: { mon: 'bisharp', num: 53 },
      LB2: { mon: 'braviary', num: 49 }, CB1: { mon: 'liepard', num: 39 }, CB2: { mon: 'swoobat', num: 30 },
      S: { mon: 'galvantula', num: 43 }, K: { mon: 'chandelure', num: 8 },
    },
  },
  {
    id: 'kalos', city: 'Kalos', name: 'Royals', abbr: 'KAL',
    colors: { primary: '#6a1b9a', secondary: '#f48fb1' },
    coach: { name: 'Coach Diantha', style: 'West Coast',
      passRate: 0.58, deepRate: 0.3, aggression: 0.4, blitzRate: 0.2, manRate: 0.35, paRate: 0.3, runStyle: 'zone', tempo: 'normal' },
    roster: {
      QB: { mon: 'delphox', num: 16 }, RB: { mon: 'hawlucha', num: 35 }, WR1: { mon: 'greninja', num: 18 },
      WR2: { mon: 'talonflame', num: 83 }, TE: { mon: 'tyrantrum', num: 80 }, C: { mon: 'avalugg', num: 65 },
      G: { mon: 'chesnaught', num: 70 },
      DL1: { mon: 'goodra', num: 94 }, DL2: { mon: 'gogoat', num: 91 }, LB1: { mon: 'pangoro', num: 56 },
      LB2: { mon: 'pyroar', num: 44 }, CB1: { mon: 'heliolisk', num: 21 }, CB2: { mon: 'noivern', num: 37 },
      S: { mon: 'sylveon', num: 41 }, K: { mon: 'aromatisse', num: 4 },
    },
  },
  {
    id: 'alola', city: 'Alola', name: 'Tides', abbr: 'ALO',
    colors: { primary: '#ef6c00', secondary: '#4dd0e1' },
    coach: { name: 'Coach Kukui', style: 'Run & Shoot',
      passRate: 0.6, deepRate: 0.5, aggression: 0.85, blitzRate: 0.45, manRate: 0.5, paRate: 0.2, runStyle: 'mixed', tempo: 'hurry' },
    roster: {
      QB: { mon: 'primarina', num: 3 }, RB: { mon: 'lycanroc', num: 26 }, WR1: { mon: 'ribombee', num: 11 },
      WR2: { mon: 'salazzle', num: 84 }, TE: { mon: 'tsareena', num: 82 }, C: { mon: 'mudsdale', num: 67 },
      G: { mon: 'kommo-o', num: 75 },
      DL1: { mon: 'incineroar', num: 93 }, DL2: { mon: 'bewear', num: 97 }, LB1: { mon: 'golisopod', num: 59 },
      LB2: { mon: 'decidueye', num: 48 }, CB1: { mon: 'mimikyu', num: 20 }, CB2: { mon: 'passimian', num: 24 },
      S: { mon: 'silvally', num: 32 }, K: { mon: 'oranguru', num: 7 },
    },
  },
  {
    id: 'galar', city: 'Galar', name: 'Gales', abbr: 'GAL',
    colors: { primary: '#8e1b3a', secondary: '#ffca28' },
    coach: { name: 'Coach Leon', style: 'Clock Control',
      passRate: 0.5, deepRate: 0.4, aggression: 0.5, blitzRate: 0.35, manRate: 0.45, paRate: 0.35, runStyle: 'power', tempo: 'slow' },
    roster: {
      QB: { mon: 'inteleon', num: 1 }, RB: { mon: 'cinderace', num: 23 }, WR1: { mon: 'dragapult', num: 88 },
      WR2: { mon: 'boltund', num: 13 }, TE: { mon: 'rillaboom', num: 85 }, C: { mon: 'copperajah', num: 69 },
      G: { mon: 'coalossal', num: 78 },
      DL1: { mon: 'grimmsnarl', num: 92 }, DL2: { mon: 'centiskorch', num: 95 }, LB1: { mon: 'sirfetchd', num: 50 },
      LB2: { mon: 'corviknight', num: 57 }, CB1: { mon: 'obstagoon', num: 25 }, CB2: { mon: 'thievul', num: 31 },
      S: { mon: 'barraskewda', num: 40 }, K: { mon: 'alcremie', num: 9 },
    },
  },
];

export const OFF_POS = ['QB', 'RB', 'WR1', 'WR2', 'TE', 'C', 'G'];
export const DEF_POS = ['DL1', 'DL2', 'LB1', 'LB2', 'CB1', 'CB2', 'S'];
