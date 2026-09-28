// Formations, routes, offensive plays and defensive calls.
//
// Coordinates are relative to the ball at the snap:
//   dx: yards toward the defense (negative = backfield)
//   dy: yards laterally, positive = the play's STRONG side (flipped per call)

export const FORMATIONS = {
  gunDoubles: { name: 'Gun Doubles', shotgun: true, align: {
    QB: [-5, 0], RB: [-5, -1.6], C: [-0.4, 0], G: [-0.6, -1.3], TE: [-1.2, 7], WR1: [-0.5, -13], WR2: [-0.5, 14] } },
  gunTrips: { name: 'Gun Trips', shotgun: true, align: {
    QB: [-5, 0], RB: [-5, -1.6], C: [-0.4, 0], G: [-0.6, -1.3], TE: [-1.2, 5], WR1: [-1.2, 9.5], WR2: [-0.5, 14.5] } },
  singleback: { name: 'Singleback', shotgun: false, align: {
    QB: [-1.1, 0], RB: [-6, 0], C: [-0.4, 0], G: [-0.6, -1.3], TE: [-0.6, 1.4], WR1: [-0.5, -13], WR2: [-0.5, 12] } },
  pistol: { name: 'Pistol', shotgun: true, align: {
    QB: [-4, 0], RB: [-7, 0], C: [-0.4, 0], G: [-0.6, -1.3], TE: [-0.6, 1.4], WR1: [-0.5, -13], WR2: [-0.5, 12] } },
  empty: { name: 'Empty', shotgun: true, align: {
    QB: [-5, 0], RB: [-1.2, -7], C: [-0.4, 0], G: [-0.6, -1.3], TE: [-1.2, 7], WR1: [-0.5, -14], WR2: [-0.5, 14] } },
  jumbo: { name: 'Goal Line', shotgun: false, align: {
    QB: [-1.1, 0], RB: [-5.5, 0], C: [-0.4, 0], G: [-0.6, -1.3], TE: [-0.6, 1.4], WR1: [-0.6, -5], WR2: [-0.6, 4.5] } },
};

// Route waypoints: [forward, outward] cumulative from the receiver's alignment.
// outward is toward the receiver's sideline (for backs: toward the strong side).
// settle: receiver sits in the hole at the end instead of continuing.
export const ROUTES = {
  go: { pts: [[4, 0.6], [50, 1.6]], depth: 'deep' },
  fade: { pts: [[5, 1.2], [45, 3.5]], depth: 'deep' },
  seam: { pts: [[4, 0], [50, -0.5]], depth: 'deep' },
  post: { pts: [[12, 0], [30, -10], [48, -16]], depth: 'deep' },
  corner: { pts: [[11, 0], [26, 10], [30, 13]], depth: 'deep' },
  wheel: { pts: [[1, 4], [4, 8.5], [40, 9.5]], depth: 'deep' },
  dig: { pts: [[12, 0], [12.5, -22]], depth: 'medium' },
  cross: { pts: [[7, 0], [16, -24]], depth: 'medium' },
  out: { pts: [[10, 0], [10.5, 12]], depth: 'medium', settle: true },
  curl: { pts: [[12, 0], [10.5, -1.5]], depth: 'medium', settle: true },
  comeback: { pts: [[15, 0], [13, 3]], depth: 'medium', settle: true },
  slant: { pts: [[2, 0], [8, -7], [22, -20]], depth: 'short' },
  quickOut: { pts: [[5, 0], [5.5, 8]], depth: 'short', settle: true },
  hitch: { pts: [[6, 0], [5, -0.5]], depth: 'short', settle: true },
  stick: { pts: [[6, 0], [6, -1.2]], depth: 'short', settle: true },
  drag: { pts: [[2, -1], [4, -26]], depth: 'short' },
  flat: { pts: [[1, 3], [3, 10], [4, 14]], depth: 'short', settle: true },
  swing: { pts: [[-1, 4], [1, 9], [3, 12]], depth: 'short', settle: true },
  angle: { pts: [[2, 3], [5, -3], [6, -9]], depth: 'short', settle: true },
  checkFlat: { pts: [[2, 4], [4, 8]], depth: 'short', settle: true, delay: 0.9 },
  screen: { pts: [[-2, 5], [-2.5, 7.5]], depth: 'short', settle: true, screen: true },
  spot: { pts: [[7, -2]], depth: 'short', settle: true },
};

// ---------------------------------------------------------------------------
// Offensive playbook
// assign: role per skill player ('block' = pass pro). prog: QB read order.
export const PLAYS = [
  // ---- Pass: quick game
  { id: 'slants', name: 'Double Slants', type: 'pass', form: 'gunDoubles', drop: 'quick', depth: 'short',
    assign: { WR1: 'slant', WR2: 'slant', TE: 'flat', RB: 'block' }, prog: ['WR2', 'WR1', 'TE'] },
  { id: 'hitches', name: 'Hitch Seam', type: 'pass', form: 'gunDoubles', drop: 'quick', depth: 'short',
    assign: { WR1: 'hitch', WR2: 'hitch', TE: 'seam', RB: 'checkFlat' }, prog: ['WR2', 'TE', 'WR1', 'RB'] },
  { id: 'stick', name: 'Trips Stick', type: 'pass', form: 'gunTrips', drop: 'quick', depth: 'short',
    assign: { WR2: 'go', WR1: 'stick', TE: 'flat', RB: 'checkFlat' }, prog: ['WR1', 'TE', 'WR2', 'RB'] },
  { id: 'emptyQuick', name: 'Empty Spacing', type: 'pass', form: 'empty', drop: 'quick', depth: 'short',
    assign: { WR1: 'slant', WR2: 'quickOut', TE: 'stick', RB: 'hitch' }, prog: ['TE', 'WR2', 'WR1', 'RB'], tags: ['sideline'] },
  { id: 'fade', name: 'Double Fade', type: 'pass', form: 'jumbo', drop: 'quick', depth: 'deep',
    assign: { WR1: 'fade', WR2: 'fade', TE: 'flat', RB: 'block' }, prog: ['WR2', 'WR1', 'TE'], tags: ['redzone'] },
  { id: 'quickOuts', name: 'Speed Outs', type: 'pass', form: 'gunDoubles', drop: 'quick', depth: 'short',
    assign: { WR1: 'quickOut', WR2: 'quickOut', TE: 'seam', RB: 'block' }, prog: ['WR2', 'WR1', 'TE'], tags: ['sideline'] },
  // ---- Pass: intermediate
  { id: 'mesh', name: 'Mesh', type: 'pass', form: 'gunDoubles', drop: 'std', depth: 'medium',
    assign: { WR1: 'drag', WR2: 'corner', TE: 'cross', RB: 'angle' }, prog: ['WR2', 'TE', 'WR1', 'RB'] },
  { id: 'smash', name: 'Smash', type: 'pass', form: 'gunDoubles', drop: 'std', depth: 'medium',
    assign: { WR1: 'dig', WR2: 'hitch', TE: 'corner', RB: 'checkFlat' }, prog: ['TE', 'WR2', 'WR1', 'RB'], tags: ['sideline'] },
  { id: 'curlFlat', name: 'Curl Flat', type: 'pass', form: 'singleback', drop: 'std', depth: 'medium',
    assign: { WR1: 'curl', WR2: 'curl', TE: 'flat', RB: 'swing' }, prog: ['WR2', 'TE', 'WR1', 'RB'] },
  { id: 'flood', name: 'Trips Flood', type: 'pass', form: 'gunTrips', drop: 'std', depth: 'medium',
    assign: { WR2: 'go', WR1: 'out', TE: 'flat', RB: 'checkFlat' }, prog: ['WR1', 'TE', 'WR2', 'RB'], tags: ['sideline'] },
  { id: 'drive', name: 'Drive', type: 'pass', form: 'gunDoubles', drop: 'std', depth: 'medium',
    assign: { WR1: 'drag', WR2: 'dig', TE: 'seam', RB: 'checkFlat' }, prog: ['WR1', 'WR2', 'TE', 'RB'] },
  { id: 'levels', name: 'Levels', type: 'pass', form: 'gunTrips', drop: 'std', depth: 'medium',
    assign: { WR2: 'dig', WR1: 'seam', TE: 'drag', RB: 'checkFlat' }, prog: ['WR2', 'TE', 'WR1', 'RB'] },
  { id: 'comebacks', name: 'Comebacks', type: 'pass', form: 'gunDoubles', drop: 'std', depth: 'medium',
    assign: { WR1: 'comeback', WR2: 'comeback', TE: 'out', RB: 'checkFlat' }, prog: ['WR2', 'WR1', 'TE', 'RB'], tags: ['sideline'] },
  { id: 'yCross', name: 'Y-Cross', type: 'pass', form: 'gunDoubles', drop: 'std', depth: 'medium',
    assign: { WR1: 'go', WR2: 'curl', TE: 'cross', RB: 'swing' }, prog: ['TE', 'WR2', 'RB', 'WR1'] },
  // ---- Pass: shots
  { id: 'fourVerts', name: 'Four Verticals', type: 'pass', form: 'gunDoubles', drop: 'std', depth: 'deep',
    assign: { WR1: 'go', WR2: 'go', TE: 'seam', RB: 'checkFlat' }, prog: ['TE', 'WR2', 'WR1', 'RB'] },
  { id: 'dagger', name: 'Dagger', type: 'pass', form: 'gunDoubles', drop: 'deep', depth: 'deep',
    assign: { WR1: 'post', WR2: 'dig', TE: 'seam', RB: 'block' }, prog: ['WR2', 'TE', 'WR1'] },
  { id: 'postWheel', name: 'Post Wheel', type: 'pass', form: 'singleback', drop: 'deep', depth: 'deep',
    assign: { WR1: 'dig', WR2: 'post', TE: 'block', RB: 'wheel' }, prog: ['WR2', 'RB', 'WR1'] },
  { id: 'paShot', name: 'PA Deep Shot', type: 'pass', form: 'pistol', drop: 'deep', depth: 'deep', pa: true,
    assign: { WR1: 'post', WR2: 'go', TE: 'block', RB: 'block' }, prog: ['WR2', 'WR1'] },
  { id: 'paBoot', name: 'PA Boot', type: 'pass', form: 'singleback', drop: 'std', depth: 'medium', pa: true, boot: true,
    assign: { WR1: 'corner', WR2: 'post', TE: 'drag', RB: 'flat' }, prog: ['WR1', 'TE', 'RB', 'WR2'] },
  { id: 'paCross', name: 'PA Crossers', type: 'pass', form: 'pistol', drop: 'std', depth: 'medium', pa: true,
    assign: { WR1: 'cross', WR2: 'dig', TE: 'flat', RB: 'block' }, prog: ['WR1', 'WR2', 'TE'] },
  { id: 'rbScreen', name: 'RB Screen', type: 'pass', form: 'gunDoubles', drop: 'std', depth: 'short', screen: true,
    assign: { WR1: 'go', WR2: 'go', TE: 'block', RB: 'screen' }, prog: ['RB'] },
  { id: 'hailMary', name: 'Hail Mary', type: 'pass', form: 'empty', drop: 'deep', depth: 'deep', special: 'hail',
    assign: { WR1: 'go', WR2: 'go', TE: 'seam', RB: 'seam' }, prog: ['WR2', 'WR1', 'TE', 'RB'] },

  // ---- Runs (aim = lateral landmark, positive = strong side)
  { id: 'insideZone', name: 'Inside Zone', type: 'run', form: 'singleback', scheme: 'zone', aim: 1.5 },
  { id: 'gunZone', name: 'Gun Inside Zone', type: 'run', form: 'gunDoubles', scheme: 'zone', aim: 1.0 },
  { id: 'outsideZone', name: 'Outside Zone', type: 'run', form: 'singleback', scheme: 'zone', aim: 5.5 },
  { id: 'power', name: 'Power', type: 'run', form: 'singleback', scheme: 'power', aim: 2.2 },
  { id: 'counter', name: 'Counter', type: 'run', form: 'pistol', scheme: 'counter', aim: 2.4 },
  { id: 'draw', name: 'Draw', type: 'run', form: 'gunDoubles', scheme: 'draw', aim: 0.5 },
  { id: 'toss', name: 'Toss Sweep', type: 'run', form: 'singleback', scheme: 'toss', aim: 9 },
  { id: 'zoneRead', name: 'Zone Read', type: 'run', form: 'pistol', scheme: 'read', aim: 1.2 },
  { id: 'glPower', name: 'Goal Line Power', type: 'run', form: 'jumbo', scheme: 'power', aim: 1.8 },
  { id: 'sneak', name: 'QB Sneak', type: 'run', form: 'jumbo', scheme: 'sneak', aim: 0.3, carrier: 'QB' },
];

export const PLAY_BY_ID = Object.fromEntries(PLAYS.map((p) => [p.id, p]));

// ---------------------------------------------------------------------------
// Defensive calls. Roles: 'rush' | {man: POS, press?} | {zone: NAME} | 'spy' | {dog: POS} (green dog)
// Zone names ending in S / W are strong / weak side.
export const DEFENSES = [
  { id: 'c1', name: 'Cover 1', tags: ['man'],
    assign: { DL1: 'rush', DL2: 'rush', LB1: { man: 'TE' }, LB2: { dog: 'RB' }, CB1: { man: 'WR1' }, CB2: { man: 'WR2' }, S: { zone: 'deepMid' } } },
  { id: 'c1press', name: 'Cover 1 Press', tags: ['man', 'press'],
    assign: { DL1: 'rush', DL2: 'rush', LB1: { man: 'TE' }, LB2: { dog: 'RB' }, CB1: { man: 'WR1', press: true }, CB2: { man: 'WR2', press: true }, S: { zone: 'deepMid' } } },
  { id: 'c1spy', name: 'Cover 1 Spy', tags: ['man', 'spy'],
    assign: { DL1: 'rush', DL2: 'rush', LB1: { man: 'TE' }, LB2: 'spy', CB1: { man: 'WR1' }, CB2: { man: 'WR2' }, S: { zone: 'deepMid' } } },
  { id: 'c0', name: 'Cover 0 Blitz', tags: ['man', 'blitz'],
    assign: { DL1: 'rush', DL2: 'rush', LB1: 'rush', LB2: { man: 'RB' }, CB1: { man: 'WR1', press: true }, CB2: { man: 'WR2', press: true }, S: { man: 'TE' } } },
  { id: 'c3', name: 'Cover 3', tags: ['zone'],
    assign: { DL1: 'rush', DL2: 'rush', LB1: { zone: 'curlS' }, LB2: { zone: 'curlW' }, CB1: { zone: 'thirdW' }, CB2: { zone: 'thirdS' }, S: { zone: 'thirdM' } } },
  { id: 'c4', name: 'Cover 4 Match', tags: ['zone'],
    assign: { DL1: 'rush', DL2: 'rush', LB1: { zone: 'hookS' }, LB2: { zone: 'hookW' }, CB1: { zone: 'quarterW' }, CB2: { zone: 'quarterS' }, S: { zone: 'deepMid' } } },
  { id: 'cloud', name: 'Cover 2 Cloud', tags: ['zone'],
    assign: { DL1: 'rush', DL2: 'rush', LB1: { zone: 'deepHookS' }, LB2: { zone: 'deepHookW' }, CB1: { zone: 'flatW' }, CB2: { zone: 'flatS' }, S: { zone: 'deepMid' } } },
  { id: 'fireZone', name: 'Fire Zone Blitz', tags: ['zone', 'blitz'],
    assign: { DL1: 'rush', DL2: 'rush', LB1: { zone: 'hookM' }, LB2: 'rush', CB1: { zone: 'thirdW' }, CB2: { zone: 'thirdS' }, S: { zone: 'thirdM' } } },
  { id: 'runBlitz', name: 'Run Blitz', tags: ['man', 'blitz', 'run'],
    assign: { DL1: 'rush', DL2: 'rush', LB1: 'rush', LB2: 'rush', CB1: { man: 'WR1' }, CB2: { man: 'WR2' }, S: { man: 'TE', box: true } } },
  { id: 'prevent', name: 'Prevent', tags: ['zone', 'prevent'],
    assign: { DL1: 'rush', DL2: 'rush', LB1: { zone: 'deepHookS' }, LB2: { zone: 'deepHookW' }, CB1: { zone: 'preventW' }, CB2: { zone: 'preventS' }, S: { zone: 'preventM' } } },
];

export const DEF_BY_ID = Object.fromEntries(DEFENSES.map((d) => [d.id, d]));
