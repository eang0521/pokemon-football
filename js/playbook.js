// Formations, routes, offensive plays and defensive calls.
//
// Offensive sim slots: QB, RB, WR, FX (the FLEX: a 2nd back, 2nd receiver or tight end), LG, C, RG.
// Personnel (what the FLEX is) decides which formations a team can use:
//   'RB' = 2-back sets, 'WR' = 2-receiver spread sets, 'TE' = tight end sets.
//
// Coordinates are relative to the ball at the snap:
//   dx: yards toward the defense (negative = backfield)
//   dy: yards laterally, positive = the play's STRONG side (flipped per call)

export const OFF_SLOTS = ['QB', 'RB', 'WR', 'FX', 'LG', 'C', 'RG'];
const OL = { C: [-0.4, 0], LG: [-0.6, -1.3], RG: [-0.6, 1.3] };
const f = (name, shotgun, align) => ({ name, shotgun, align: { ...OL, ...align } });

export const FORMATIONS = {
  // 2-receiver (FLEX = WR)
  gunSpread: f('Gun Spread', true, { QB: [-5, 0], RB: [-5, -1.6], WR: [-0.5, -13], FX: [-0.5, 13] }),
  gunTwins: f('Gun Twins', true, { QB: [-5, 0], RB: [-5, -1.6], WR: [-0.5, 13.5], FX: [-1.2, 7.5] }),
  singleback: f('Singleback', false, { QB: [-1.1, 0], RB: [-6, 0], WR: [-0.5, -12], FX: [-0.5, 12] }),
  pistol: f('Pistol', true, { QB: [-4, 0], RB: [-7, 0], WR: [-0.5, -12], FX: [-1.2, 8] }),
  empty: f('Empty', true, { QB: [-5, 0], RB: [-1.2, 7], WR: [-0.5, -13.5], FX: [-0.5, 13.5] }),
  // tight end (FLEX = TE)
  singlebackTE: f('Singleback TE', false, { QB: [-1.1, 0], RB: [-6, 0], WR: [-0.5, -12], FX: [-0.6, 2.6] }),
  gunTE: f('Gun Flex TE', true, { QB: [-5, 0], RB: [-5, -1.6], WR: [-0.5, -13], FX: [-1.2, 6] }),
  pistolTE: f('Pistol TE', true, { QB: [-4, 0], RB: [-7, 0], WR: [-0.5, -12], FX: [-0.6, 2.6] }),
  jumboTE: f('Goal Line', false, { QB: [-1.1, 0], RB: [-5.5, 0], WR: [-0.6, -5], FX: [-0.6, 2.6] }),
  // 2-back (FLEX = RB)
  iForm: f('I-Formation', false, { QB: [-1.1, 0], FX: [-3.8, 0], RB: [-6.3, 0], WR: [-0.5, -12] }),
  offsetI: f('Offset I', false, { QB: [-1.1, 0], FX: [-3.8, 1.3], RB: [-6.3, 0], WR: [-0.5, -12] }),
  gunSplit: f('Gun Split Backs', true, { QB: [-5, 0], RB: [-5, -1.6], FX: [-5, 1.6], WR: [-0.5, -13] }),
  jumbo2: f('Goal Line 2-Back', false, { QB: [-1.1, 0], FX: [-3.6, 0.8], RB: [-6, 0], WR: [-0.6, -5] }),
};

// Route waypoints: [forward, outward] cumulative from the receiver's alignment.
// outward is toward the receiver's sideline (for backs: toward his side / the strong side).
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

// Formation sets by personnel
const GUN = { WR: 'gunSpread', TE: 'gunTE', RB: 'gunSplit' };
const TWINS = { WR: 'gunTwins', TE: 'gunTE', RB: 'gunSplit' };
const UNDER = { WR: 'singleback', TE: 'singlebackTE', RB: 'iForm' };
const PISTOL = { WR: 'pistol', TE: 'pistolTE', RB: 'offsetI' };
const GOAL = { WR: 'singleback', TE: 'jumboTE', RB: 'jumbo2' };

// ---------------------------------------------------------------------------
// Offensive playbook.
// forms: formation per personnel (a play is only available to personnel listed).
// assign: route per eligible slot; a value can be an object keyed by personnel. 'block' = pass pro.
// prog: QB read order.
export const PLAYS = [
  // ---- quick game
  { id: 'slants', name: 'Slants', type: 'pass', forms: GUN, drop: 'quick', depth: 'short',
    assign: { WR: 'slant', FX: { WR: 'slant', TE: 'flat', RB: 'flat' }, RB: 'checkFlat' }, prog: ['WR', 'FX', 'RB'] },
  { id: 'hitchSeam', name: 'Hitch Seam', type: 'pass', forms: GUN, drop: 'quick', depth: 'short',
    assign: { WR: 'hitch', FX: { WR: 'seam', TE: 'seam', RB: 'wheel' }, RB: 'checkFlat' }, prog: ['WR', 'FX', 'RB'] },
  { id: 'quickOuts', name: 'Speed Outs', type: 'pass', forms: GUN, drop: 'quick', depth: 'short', tags: ['sideline'],
    assign: { WR: 'quickOut', FX: { WR: 'quickOut', TE: 'flat', RB: 'swing' }, RB: 'block' }, prog: ['WR', 'FX'] },
  { id: 'stick', name: 'Stick', type: 'pass', forms: TWINS, drop: 'quick', depth: 'short',
    assign: { WR: 'go', FX: { WR: 'stick', TE: 'stick', RB: 'flat' }, RB: 'flat' }, prog: ['FX', 'RB', 'WR'] },
  { id: 'fade', name: 'Fade', type: 'pass', forms: GOAL, drop: 'quick', depth: 'deep', tags: ['redzone'],
    assign: { WR: 'fade', FX: { WR: 'fade', TE: 'flat', RB: 'flat' }, RB: 'block' }, prog: ['WR', 'FX'] },
  // ---- intermediate
  { id: 'mesh', name: 'Mesh', type: 'pass', forms: GUN, drop: 'std', depth: 'medium',
    assign: { WR: 'drag', FX: { WR: 'cross', TE: 'cross', RB: 'angle' }, RB: 'angle' }, prog: ['FX', 'WR', 'RB'] },
  { id: 'smash', name: 'Smash', type: 'pass', forms: TWINS, drop: 'std', depth: 'medium', tags: ['sideline'],
    assign: { WR: 'hitch', FX: { WR: 'corner', TE: 'corner', RB: 'wheel' }, RB: 'checkFlat' }, prog: ['FX', 'WR', 'RB'] },
  { id: 'curlFlat', name: 'Curl Flat', type: 'pass', forms: UNDER, drop: 'std', depth: 'medium',
    assign: { WR: 'curl', FX: { WR: 'curl', TE: 'flat', RB: 'flat' }, RB: 'swing' }, prog: ['WR', 'FX', 'RB'] },
  { id: 'flood', name: 'Flood', type: 'pass', forms: TWINS, drop: 'std', depth: 'medium', tags: ['sideline'],
    assign: { WR: 'go', FX: { WR: 'out', TE: 'out', RB: 'flat' }, RB: { WR: 'flat', TE: 'flat', RB: 'swing' } }, prog: ['FX', 'RB', 'WR'] },
  { id: 'drive', name: 'Drive', type: 'pass', forms: GUN, drop: 'std', depth: 'medium',
    assign: { WR: 'drag', FX: { WR: 'dig', TE: 'dig', RB: 'angle' }, RB: 'checkFlat' }, prog: ['WR', 'FX', 'RB'] },
  { id: 'comebacks', name: 'Comebacks', type: 'pass', forms: GUN, drop: 'std', depth: 'medium', tags: ['sideline'],
    assign: { WR: 'comeback', FX: { WR: 'comeback', TE: 'out', RB: 'swing' }, RB: 'checkFlat' }, prog: ['WR', 'FX', 'RB'] },
  { id: 'yCross', name: 'Y-Cross', type: 'pass', forms: { WR: 'gunTwins', TE: 'gunTE' }, drop: 'std', depth: 'medium',
    assign: { WR: 'go', FX: 'cross', RB: 'swing' }, prog: ['FX', 'RB', 'WR'] },
  // ---- shots
  { id: 'verts', name: 'Verticals', type: 'pass', forms: GUN, drop: 'std', depth: 'deep',
    assign: { WR: 'go', FX: { WR: 'go', TE: 'seam', RB: 'wheel' }, RB: 'checkFlat' }, prog: ['FX', 'WR', 'RB'] },
  { id: 'dagger', name: 'Dagger', type: 'pass', forms: TWINS, drop: 'deep', depth: 'deep',
    assign: { WR: 'dig', FX: { WR: 'seam', TE: 'seam', RB: 'wheel' }, RB: 'block' }, prog: ['WR', 'FX'] },
  { id: 'postWheel', name: 'Post Wheel', type: 'pass', forms: UNDER, drop: 'deep', depth: 'deep',
    assign: { WR: 'post', FX: { WR: 'dig', TE: 'block', RB: 'block' }, RB: 'wheel' }, prog: ['WR', 'RB', 'FX'] },
  { id: 'paShot', name: 'PA Deep Shot', type: 'pass', forms: PISTOL, drop: 'deep', depth: 'deep', pa: true,
    assign: { WR: 'post', FX: { WR: 'go', TE: 'block', RB: 'block' }, RB: 'block' }, prog: ['WR', 'FX'] },
  { id: 'paBoot', name: 'PA Boot', type: 'pass', forms: UNDER, drop: 'std', depth: 'medium', pa: true, boot: true, rbDir: -1,
    assign: { WR: 'corner', FX: { WR: 'drag', TE: 'drag', RB: 'flat' }, RB: 'flat' }, prog: ['WR', 'FX', 'RB'] },
  { id: 'rbScreen', name: 'RB Screen', type: 'pass', forms: GUN, drop: 'std', depth: 'short', screen: true,
    assign: { WR: 'go', FX: { WR: 'go', TE: 'block', RB: 'block' }, RB: 'screen' }, prog: ['RB'] },
  { id: 'hailMary', name: 'Hail Mary', type: 'pass', forms: { WR: 'empty', TE: 'gunTE', RB: 'gunSplit' }, drop: 'deep', depth: 'deep', special: 'hail',
    assign: { WR: 'go', FX: 'go', RB: 'seam' }, prog: ['WR', 'FX', 'RB'] },

  // ---- runs (aim = lateral landmark, positive = strong side)
  { id: 'insideZone', name: 'Inside Zone', type: 'run', forms: UNDER, scheme: 'zone', aim: 1.5 },
  { id: 'gunZone', name: 'Gun Zone', type: 'run', forms: GUN, scheme: 'zone', aim: 1.0 },
  { id: 'outsideZone', name: 'Outside Zone', type: 'run', forms: UNDER, scheme: 'zone', aim: 5.5 },
  { id: 'power', name: 'Power', type: 'run', forms: UNDER, scheme: 'power', aim: 2.2 },
  { id: 'counter', name: 'Counter', type: 'run', forms: PISTOL, scheme: 'counter', aim: 2.4 },
  { id: 'iso', name: 'Iso', type: 'run', forms: { RB: 'iForm' }, scheme: 'zone', aim: 0.8 },
  { id: 'fbDive', name: 'FB Dive', type: 'run', forms: { RB: 'iForm' }, scheme: 'zone', aim: 0.4, carrier: 'FX' },
  { id: 'draw', name: 'Draw', type: 'run', forms: GUN, scheme: 'draw', aim: 0.5 },
  { id: 'toss', name: 'Toss Sweep', type: 'run', forms: UNDER, scheme: 'toss', aim: 9 },
  { id: 'zoneRead', name: 'Zone Read', type: 'run', forms: { WR: 'pistol', TE: 'pistolTE' }, scheme: 'read', aim: 1.2 },
  { id: 'glPower', name: 'Goal Line Power', type: 'run', forms: GOAL, scheme: 'power', aim: 1.8 },
  { id: 'sneak', name: 'QB Sneak', type: 'run', forms: GOAL, scheme: 'sneak', aim: 0.3, carrier: 'QB' },
];

export const PLAY_BY_ID = Object.fromEntries(PLAYS.map((p) => [p.id, p]));
export const assignFor = (play, slot, pers) => {
  const a = play.assign?.[slot];
  return a && typeof a === 'object' ? a[pers] : a;
};
export const playsFor = (pers) => PLAYS.filter((p) => p.forms[pers]);

// ---------------------------------------------------------------------------
// Defensive calls are templates resolved against whatever front is on the field
// (3-2-2, 2-3-2 or 2-2-3) — see resolveDefense().
//   man: cover the eligibles man-to-man (best cover players on the most dangerous receivers)
//   blitz: extra rushers beyond the defensive linemen (LBs first, then DBs; 'all' = everyone not in man)
//   extras: roles for leftover defenders, in priority order (deep zones go to the fastest DBs)
//   zones: zone landmarks in priority order (only as many as there are coverage players)
export const DEFENSES = [
  { id: 'c1', name: 'Cover 1', tags: ['man'], man: true, blitz: 0, dog: true, extras: ['deepMid', 'hookM', 'spy'] },
  { id: 'c1press', name: 'Cover 1 Press', tags: ['man', 'press'], man: true, press: true, blitz: 0, extras: ['deepMid', 'hookM'] },
  { id: 'c1spy', name: 'Cover 1 Spy', tags: ['man', 'spy'], man: true, blitz: 0, extras: ['deepMid', 'spy'] },
  { id: 'c1blitz', name: 'Cover 1 Blitz', tags: ['man', 'blitz'], man: true, blitz: 1, extras: ['deepMid', 'hookM'] },
  { id: 'c0', name: 'Cover 0 Blitz', tags: ['man', 'blitz'], man: true, press: true, blitz: 'all' },
  { id: 'c3', name: 'Cover 3', tags: ['zone'], zones: ['thirdW', 'thirdS', 'thirdM', 'curlS', 'curlW', 'hookM'] },
  { id: 'c2', name: 'Cover 2', tags: ['zone'], zones: ['halfW', 'halfS', 'flatW', 'flatS', 'hookM'] },
  { id: 'c4', name: 'Cover 4 Match', tags: ['zone'], zones: ['quarterW', 'quarterS', 'deepMid', 'curlS', 'curlW'] },
  { id: 'cloud', name: 'Cloud', tags: ['zone'], zones: ['deepMid', 'flatW', 'flatS', 'deepHookS', 'deepHookW'] },
  { id: 'fireZone', name: 'Fire Zone Blitz', tags: ['zone', 'blitz'], blitz: 1, zones: ['thirdW', 'thirdS', 'thirdM', 'hookM'] },
  { id: 'runBlitz', name: 'Run Blitz', tags: ['man', 'blitz', 'run'], man: true, blitz: 2, extras: ['hookM'] },
  { id: 'prevent', name: 'Prevent', tags: ['zone', 'prevent'], zones: ['preventM', 'preventW', 'preventS', 'deepHookS', 'deepHookW'] },
];
export const DEF_BY_ID = Object.fromEntries(DEFENSES.map((d) => [d.id, d]));

const isDeep = (z) => /^(deepMid|third|half|quarter|prevent)/.test(z);

// defenders: [{slot, kind:'DL'|'LB'|'DB', r}] ; eligibles: {WR, FX, RB} entities with .r and .detached
// returns { [slot]: role } where role = 'rush' | 'spy' | {man, press?, dog?} | {zone}
export function resolveDefense(call, defenders, eligibles) {
  const out = {};
  const free = [];
  for (const d of defenders) { if (d.kind === 'DL') out[d.slot] = 'rush'; else free.push(d); }
  const take = (list, score) => {
    if (!list.length) return null;
    let best = list[0], bs = -Infinity;
    for (const d of list) { const s = score(d); if (s > bs) { bs = s; best = d; } }
    list.splice(list.indexOf(best), 1);
    return best;
  };
  const cov = (d) => d.r.cover * 0.6 + d.r.spd * 0.4 + (d.kind === 'DB' ? 8 : 0);
  const deepScore = (d) => d.r.spd * 0.6 + d.r.cover * 0.4 + (d.kind === 'DB' ? 12 : 0);
  const underScore = (d) => d.r.cover * 0.4 + d.r.tackle * 0.3 + d.r.spd * 0.3 + (d.kind === 'LB' ? 10 : 0);
  const rushScore = (d) => d.r.rushFin * 0.6 + d.r.spd * 0.4 + (d.kind === 'LB' ? 15 : 0);

  const men = call.man ? ['WR', 'FX', 'RB'].map((k) => eligibles[k]).filter(Boolean)
    .sort((a, b) => ((b.pos === call.bracket) - (a.pos === call.bracket)) || (b.detached - a.detached) || (b.r.spd - a.r.spd)) : [];
  const nBlitz = call.blitz === 'all' ? Math.max(0, free.length - men.length) : Math.min(call.blitz || 0, Math.max(0, free.length - men.length));

  // deep help first (needs the right athletes), then blitzers, then man, then the rest
  const extras = [...(call.extras || [])];
  if (call.man) {
    const deepExtra = extras.filter(isDeep);
    const room = free.length - nBlitz - men.length;
    for (const z of deepExtra.slice(0, Math.max(0, room))) { out[take(free, deepScore).slot] = { zone: z }; extras.splice(extras.indexOf(z), 1); }
  }
  for (let i = 0; i < nBlitz; i++) out[take(free, rushScore).slot] = 'rush';
  if (call.man) {
    for (const m of men) {
      if (!free.length) break;
      const back = !m.detached;
      const d = take(free, back ? (x) => underScore(x) + (x.kind === 'LB' ? 5 : 0) : cov);
      out[d.slot] = { man: m.pos, press: !!call.press && d.kind === 'DB' && m.detached, dog: !!call.dog && back && d.kind === 'LB' };
    }
    for (const x of extras) { if (!free.length) break; out[take(free, underScore).slot] = x === 'spy' ? 'spy' : { zone: x }; }
    while (free.length) out[take(free, underScore).slot] = { zone: 'hookM' };
  } else {
    // match personnel: only as many deep defenders as there are wide threats (+1);
    // extra deep bodies rotate down into the box vs tight end / 2-back sets
    const wide = ['WR', 'FX', 'RB'].filter((k) => eligibles[k]?.detached).length;
    const maxDeep = call.id === 'prevent' ? 9 : Math.max(1, wide + 1);
    let deepUsed = 0;
    const zones = call.zones.filter((z) => !isDeep(z) || deepUsed++ < maxDeep);
    while (zones.length < free.length) zones.push(zones.length % 2 ? 'hookS' : 'hookW');
    zones.length = free.length;
    // fill deep zones first with the best deep athletes
    for (const z of zones.filter(isDeep)) out[take(free, deepScore).slot] = { zone: z };
    for (const z of zones.filter((z) => !isDeep(z))) {
      out[take(free, z.startsWith('flat') ? cov : underScore).slot] = { zone: z };
    }
    while (free.length) out[take(free, underScore).slot] = { zone: 'hookM' };
  }
  return out;
}
