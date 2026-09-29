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
      QB: { mon: 'alakazam' }, RB: { mon: 'tauros' }, WR1: { mon: 'jolteon' },
      WR2: { mon: 'rapidash' }, TE: { mon: 'nidoking' }, C: { mon: 'snorlax' },
      G: { mon: 'golem' },
      DL1: { mon: 'rhydon' }, DL2: { mon: 'machamp' }, LB1: { mon: 'kangaskhan' },
      LB2: { mon: 'gyarados' }, CB1: { mon: 'persian' }, CB2: { mon: 'dugtrio' },
      S: { mon: 'arcanine' }, K: { mon: 'starmie' },
    },
  },
  {
    id: 'johto', city: 'Johto', name: 'Jets', abbr: 'JOH',
    colors: { primary: '#1e88e5', secondary: '#cfd8dc' },
    coach: { name: 'Coach Falkner', style: 'Air Raid',
      passRate: 0.68, deepRate: 0.6, aggression: 0.7, blitzRate: 0.25, manRate: 0.35, paRate: 0.15, runStyle: 'zone', tempo: 'hurry' },
    roster: {
      QB: { mon: 'espeon' }, RB: { mon: 'houndoom' }, WR1: { mon: 'crobat' },
      WR2: { mon: 'sneasel' }, TE: { mon: 'heracross' }, C: { mon: 'steelix' },
      G: { mon: 'donphan' },
      DL1: { mon: 'tyranitar' }, DL2: { mon: 'ursaring' }, LB1: { mon: 'scizor' },
      LB2: { mon: 'granbull' }, CB1: { mon: 'jumpluff' }, CB2: { mon: 'xatu' },
      S: { mon: 'kingdra' }, K: { mon: 'togetic' },
    },
  },
  {
    id: 'hoenn', city: 'Hoenn', name: 'Hurricanes', abbr: 'HOE',
    colors: { primary: '#00897b', secondary: '#1a237e' },
    coach: { name: 'Coach Wallace', style: 'Ground & Pound',
      passRate: 0.4, deepRate: 0.35, aggression: 0.35, blitzRate: 0.35, manRate: 0.4, paRate: 0.4, runStyle: 'power', tempo: 'slow' },
    roster: {
      QB: { mon: 'gardevoir' }, RB: { mon: 'blaziken' }, WR1: { mon: 'manectric' },
      WR2: { mon: 'ninjask' }, TE: { mon: 'swampert' }, C: { mon: 'aggron' },
      G: { mon: 'hariyama' },
      DL1: { mon: 'metagross' }, DL2: { mon: 'walrein' }, LB1: { mon: 'zangoose' },
      LB2: { mon: 'salamence' }, CB1: { mon: 'sceptile' }, CB2: { mon: 'linoone' },
      S: { mon: 'absol' }, K: { mon: 'swellow' },
    },
  },
  {
    id: 'sinnoh', city: 'Sinnoh', name: 'Blizzard', abbr: 'SIN',
    colors: { primary: '#263238', secondary: '#81d4fa' },
    coach: { name: 'Coach Cynthia', style: 'Attack Defense',
      passRate: 0.55, deepRate: 0.5, aggression: 0.75, blitzRate: 0.6, manRate: 0.65, paRate: 0.25, runStyle: 'mixed', tempo: 'normal' },
    roster: {
      QB: { mon: 'lucario' }, RB: { mon: 'garchomp' }, WR1: { mon: 'infernape' },
      WR2: { mon: 'floatzel' }, TE: { mon: 'luxray' }, C: { mon: 'rhyperior' },
      G: { mon: 'bastiodon' },
      DL1: { mon: 'mamoswine' }, DL2: { mon: 'hippowdon' }, LB1: { mon: 'gallade' },
      LB2: { mon: 'staraptor' }, CB1: { mon: 'weavile' }, CB2: { mon: 'ambipom' },
      S: { mon: 'honchkrow' }, K: { mon: 'togekiss' },
    },
  },
  {
    id: 'unova', city: 'Unova', name: 'Volts', abbr: 'UNO',
    colors: { primary: '#fdd835', secondary: '#212121' },
    coach: { name: 'Coach Elesa', style: 'Spread Tempo',
      passRate: 0.62, deepRate: 0.55, aggression: 0.55, blitzRate: 0.3, manRate: 0.3, paRate: 0.2, runStyle: 'zone', tempo: 'hurry' },
    roster: {
      QB: { mon: 'zoroark' }, RB: { mon: 'krookodile' }, WR1: { mon: 'zebstrika' },
      WR2: { mon: 'accelgor' }, TE: { mon: 'haxorus' }, C: { mon: 'conkeldurr' },
      G: { mon: 'gigalith' },
      DL1: { mon: 'beartic' }, DL2: { mon: 'excadrill' }, LB1: { mon: 'bisharp' },
      LB2: { mon: 'braviary' }, CB1: { mon: 'liepard' }, CB2: { mon: 'swoobat' },
      S: { mon: 'galvantula' }, K: { mon: 'chandelure' },
    },
  },
  {
    id: 'kalos', city: 'Kalos', name: 'Royals', abbr: 'KAL',
    colors: { primary: '#6a1b9a', secondary: '#f48fb1' },
    coach: { name: 'Coach Diantha', style: 'West Coast',
      passRate: 0.58, deepRate: 0.3, aggression: 0.4, blitzRate: 0.2, manRate: 0.35, paRate: 0.3, runStyle: 'zone', tempo: 'normal' },
    roster: {
      QB: { mon: 'delphox' }, RB: { mon: 'hawlucha' }, WR1: { mon: 'greninja' },
      WR2: { mon: 'talonflame' }, TE: { mon: 'tyrantrum' }, C: { mon: 'avalugg' },
      G: { mon: 'chesnaught' },
      DL1: { mon: 'goodra' }, DL2: { mon: 'gogoat' }, LB1: { mon: 'pangoro' },
      LB2: { mon: 'pyroar' }, CB1: { mon: 'heliolisk' }, CB2: { mon: 'noivern' },
      S: { mon: 'sylveon' }, K: { mon: 'aromatisse' },
    },
  },
  {
    id: 'alola', city: 'Alola', name: 'Tides', abbr: 'ALO',
    colors: { primary: '#ef6c00', secondary: '#4dd0e1' },
    coach: { name: 'Coach Kukui', style: 'Run & Shoot',
      passRate: 0.6, deepRate: 0.5, aggression: 0.85, blitzRate: 0.45, manRate: 0.5, paRate: 0.2, runStyle: 'mixed', tempo: 'hurry' },
    roster: {
      QB: { mon: 'primarina' }, RB: { mon: 'lycanroc' }, WR1: { mon: 'ribombee' },
      WR2: { mon: 'salazzle' }, TE: { mon: 'tsareena' }, C: { mon: 'mudsdale' },
      G: { mon: 'kommo-o' },
      DL1: { mon: 'incineroar' }, DL2: { mon: 'bewear' }, LB1: { mon: 'golisopod' },
      LB2: { mon: 'decidueye' }, CB1: { mon: 'mimikyu' }, CB2: { mon: 'passimian' },
      S: { mon: 'silvally' }, K: { mon: 'oranguru' },
    },
  },
  {
    id: 'galar', city: 'Galar', name: 'Gales', abbr: 'GAL',
    colors: { primary: '#8e1b3a', secondary: '#ffca28' },
    coach: { name: 'Coach Leon', style: 'Clock Control',
      passRate: 0.5, deepRate: 0.4, aggression: 0.5, blitzRate: 0.35, manRate: 0.45, paRate: 0.35, runStyle: 'power', tempo: 'slow' },
    roster: {
      QB: { mon: 'inteleon' }, RB: { mon: 'cinderace' }, WR1: { mon: 'dragapult' },
      WR2: { mon: 'boltund' }, TE: { mon: 'rillaboom' }, C: { mon: 'copperajah' },
      G: { mon: 'coalossal' },
      DL1: { mon: 'grimmsnarl' }, DL2: { mon: 'centiskorch' }, LB1: { mon: 'sirfetchd' },
      LB2: { mon: 'corviknight' }, CB1: { mon: 'obstagoon' }, CB2: { mon: 'thievul' },
      S: { mon: 'barraskewda' }, K: { mon: 'alcremie' },
    },
  },
];

export const OFF_POS = ['QB', 'RB', 'WR1', 'WR2', 'TE', 'C', 'G'];
export const DEF_POS = ['DL1', 'DL2', 'LB1', 'LB2', 'CB1', 'CB2', 'S'];
