// Field + token rendering. Field and overlay are canvases; players are DOM
// tokens so animated GIF sprites keep animating.
const SPRITE_BASE = 'https://img.pokemondb.net/sprites';
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function spriteUrl(player, style = 'home') {
  if (style === 'bw' && player.sprites?.bw) return `${SPRITE_BASE}/black-white/anim/normal/${player.sprites.bw}.gif`;
  return `${SPRITE_BASE}/home/normal/${player.sprites?.home || player.slug}.png`;
}

export class FieldRenderer {
  constructor({ stage, field, overlay, tokens, onPlayerHover }) {
    this.stage = stage; this.field = field; this.overlay = overlay; this.tokensEl = tokens;
    this.onPlayerHover = onPlayerHover;
    this.fctx = field.getContext('2d');
    this.octx = overlay.getContext('2d');
    this.tokens = new Map();
    this.camX = 50;
    this.dir = 1;
    this.view = 'broadcast'; // 'broadcast' (side-on) | 'all14' (behind the offense, looking downfield)
    this.spriteStyle = 'home';
    this.resize();
    new ResizeObserver(() => this.resize()).observe(stage);
  }

  resize() {
    const r = this.stage.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = Math.max(200, r.width); this.h = Math.max(120, r.height);
    for (const c of [this.field, this.overlay]) {
      c.width = Math.round(this.w * dpr); c.height = Math.round(this.h * dpr);
    }
    this.fctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.octx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.dirty = true;
  }

  // world (absolute yards) -> screen px
  layout(W) {
    this.W = W;
    if (this.view === 'all14') {
      // a camera BACK yards behind the ball and HGT yards up, looking straight downfield, with the
      // ball 64% down the screen. Wide screens fit the field's full width at the ball; narrower
      // ones (phones) zoom in so the players stay a decent size.
      this.back = 22; this.hgt = 17;
      const half = clamp((this.w / this.h) * 13, 13, W / 2 + 1);
      this.focal = (this.w / 2) * this.back / half;
      this.scale = this.focal / this.back; // px per yard at the ball (token sizes key off this)
      this.horizon = this.h * 0.64 - this.hgt * this.scale;
      return;
    }
    const marginY = 2.2;
    this.scale = this.h / (W + marginY * 2);
    this.viewYards = this.w / this.scale;
    this.offY = marginY;
  }
  sx(X) { return (X - this.camX) * this.scale + this.w / 2; }
  sy(Y) { return (Y + this.offY) * this.scale; }
  // Project a field point (absolute yards), optionally h yards off the ground. k = size relative to
  // the ball's spot, sq = how squashed a ground shape looks (1 = seen from straight above).
  pt(X, Y, h = 0) {
    if (this.view !== 'all14') return { x: this.sx(X), y: this.sy(Y) - h * this.scale * 0.55, k: 1, sq: 1 };
    const F = (X - this.camX) * this.dir, L = (Y - this.W / 2) * this.dir;
    const z = Math.max(F + this.back, 0.8);
    const f = this.focal / z;
    return { x: this.w / 2 + L * f, y: this.horizon + (this.hgt - h) * f, k: f / this.scale, sq: this.hgt / z, behind: F + this.back < 2 };
  }

  setCamera(targetX, snap = false) {
    let t;
    if (this.view === 'all14') t = clamp(targetX, -8, 108);
    else {
      const half = this.viewYards / 2;
      const lo = -12 + half, hi = 112 - half;
      t = lo > hi ? 50 : clamp(targetX, lo, hi);
    }
    this.camX = snap ? t : this.camX + (t - this.camX) * 0.12;
  }

  // ------------------------------------------------------------------
  // All-14 field: the same field, in perspective from behind the offense.
  drawField14(ctx, game, rec) {
    const W = this.W, dir = this.dir;
    ctx.clearRect(0, 0, this.w, this.h);
    // stands / sky above the horizon, sideline grass below it
    const hz = Math.max(0, this.horizon);
    const sky = ctx.createLinearGradient(0, 0, 0, hz);
    sky.addColorStop(0, '#0d1420'); sky.addColorStop(1, '#25313f');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, this.w, hz);
    ctx.fillStyle = '#18532a'; ctx.fillRect(0, hz, this.w, this.h - hz);
    // visible stretch of field (in absolute X): from just in front of the camera to far downfield
    const nearF = -this.back + 2, farF = 140;
    const a = this.camX + dir * nearF, b = this.camX + dir * farF;
    const lo = Math.min(a, b), hi = Math.max(a, b);
    const clip = (x) => clamp(x, lo, hi);
    const quad = (x0, x1, y0, y1, fill) => {
      const c0 = clip(x0), c1 = clip(x1);
      if (c0 === c1) return;
      const P = [this.pt(c0, y0), this.pt(c1, y0), this.pt(c1, y1), this.pt(c0, y1)];
      ctx.fillStyle = fill;
      ctx.beginPath(); P.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y))); ctx.closePath(); ctx.fill();
    };
    const line = (x0, y0, x1, y1, width) => {
      if ((x0 < lo && x1 < lo) || (x0 > hi && x1 > hi)) return;
      const p0 = this.pt(clip(x0), y0), p1 = this.pt(clip(x1), y1);
      ctx.lineWidth = width * Math.max(0.35, Math.min(p0.k, 2));
      ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
    };
    // grass stripes
    for (let X = 0; X < 100; X += 5) quad(X, X + 5, 0, W, (X / 5) % 2 ? '#2a8a45' : '#2f944b');
    // end zones, painted with the team defending each end this play
    const leftIdx = rec ? (rec.dir > 0 ? rec.frameTeam : 1 - rec.frameTeam) : 0;
    const teams = game ? [game.teams[leftIdx], game.teams[1 - leftIdx]] : [null, null];
    [[-10, teams[0]], [100, teams[1]]].forEach(([ex, team]) => {
      quad(ex, ex + 10, 0, W, team ? team.colors.primary : '#225');
      const c = ex + 5;
      if (team && c >= lo && c <= hi) {
        const p = this.pt(c, W / 2), q = this.pt(c + 1, W / 2);
        const pxYd = p.k * this.scale, squash = Math.abs(q.y - p.y) / pxYd;
        ctx.save();
        ctx.translate(p.x, p.y); ctx.scale(1, Math.max(0.15, squash));
        ctx.fillStyle = 'rgba(255,255,255,.9)';
        ctx.font = `700 ${Math.round(pxYd * 5)}px Oswald, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(team.name.toUpperCase(), 0, 0);
        ctx.restore();
      }
    });
    // yard lines, sidelines, end lines
    ctx.strokeStyle = 'rgba(255,255,255,.85)';
    for (let X = 0; X <= 100; X += 5) if (X >= lo && X <= hi) line(X, 0, X, W, X % 10 === 0 ? 2 : 1.2);
    for (const X of [-10, 110]) if (X >= lo && X <= hi) line(X, 0, X, W, 3);
    line(-10, 0, 110, 0, 3); line(-10, W, 110, W, 3);
    // hash marks
    ctx.strokeStyle = 'rgba(255,255,255,.7)';
    for (let X = Math.ceil(lo); X <= Math.min(99, hi); X++) {
      if (X <= 0 || X % 5 === 0) continue;
      for (const Y of [0.4, W / 2 - 4, W / 2 + 4, W - 0.4]) line(X, Y - 0.35, X, Y + 0.35, 1);
    }
    // numbers (lying flat on the grass)
    ctx.fillStyle = 'rgba(255,255,255,.8)';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let X = 10; X <= 90; X += 10) {
      if (X < lo || X > hi) continue;
      for (const Y of [6, W - 6]) {
        const p = this.pt(X, Y), q = this.pt(X + 1, Y);
        const pxYd = p.k * this.scale;
        if (pxYd < 2) continue;
        ctx.save();
        ctx.translate(p.x, p.y); ctx.scale(1, Math.max(0.15, Math.abs(q.y - p.y) / pxYd));
        ctx.font = `600 ${Math.round(pxYd * 2.4)}px Oswald, sans-serif`;
        ctx.fillText(String(X <= 50 ? X : 100 - X), 0, 0);
        ctx.restore();
      }
    }
    // midfield logo
    if (50 >= lo && 50 <= hi) {
      const p = this.pt(50, W / 2), r = p.k * this.scale * 3.2;
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.translate(p.x, p.y); ctx.scale(1, p.sq);
      ctx.beginPath(); ctx.arc(0, 0, r, Math.PI, 0); ctx.fillStyle = '#e53935'; ctx.fill();
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI); ctx.fillStyle = '#fff'; ctx.fill();
      ctx.lineWidth = r * 0.11; ctx.strokeStyle = '#222';
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-r, 0); ctx.lineTo(r, 0); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, r * 0.3, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.stroke();
      ctx.restore();
    }
    // line of scrimmage & line to gain
    if (rec && rec.losX != null) {
      const abs = (x) => (rec.dir > 0 ? x : 100 - x);
      ctx.strokeStyle = 'rgba(64, 140, 255, .95)';
      line(abs(rec.losX), 0, abs(rec.losX), W, 3);
      if (rec.fdX != null && rec.fdX < 100) { ctx.strokeStyle = 'rgba(255, 221, 0, .95)'; line(abs(rec.fdX), 0, abs(rec.fdX), W, 3); }
    }
    // goal posts, standing up: base post, crossbar at ~3.3 yards, uprights to ~10
    for (const X of [-10, 110]) {
      if (X < lo || X > hi) continue;
      const base = this.pt(X, W / 2), bar = this.pt(X, W / 2, 3.3);
      const l0 = this.pt(X, W / 2 - 3.1, 3.3), r0 = this.pt(X, W / 2 + 3.1, 3.3);
      const l1 = this.pt(X, W / 2 - 3.1, 10), r1 = this.pt(X, W / 2 + 3.1, 10);
      ctx.strokeStyle = '#ffd400'; ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(2, base.k * this.scale * 0.35);
      ctx.beginPath(); ctx.moveTo(base.x, base.y); ctx.lineTo(bar.x, bar.y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(l1.x, l1.y); ctx.lineTo(l0.x, l0.y); ctx.lineTo(r0.x, r0.y); ctx.lineTo(r1.x, r1.y); ctx.stroke();
      ctx.lineCap = 'butt';
    }
  }

  // ------------------------------------------------------------------
  drawField(ctx, game, rec) {
    const W = this.W, s = this.scale;
    ctx.clearRect(0, 0, this.w, this.h);
    // out of bounds surround
    ctx.fillStyle = '#18532a';
    ctx.fillRect(0, 0, this.w, this.h);
    const x0 = this.sx(-10), x1 = this.sx(110), y0 = this.sy(0), y1 = this.sy(W);
    // grass stripes
    for (let X = 0; X < 100; X += 5) {
      ctx.fillStyle = (X / 5) % 2 ? '#2a8a45' : '#2f944b';
      ctx.fillRect(this.sx(X), y0, 5 * s + 1, y1 - y0);
    }
    // end zones: painted with the team defending that end during this play
    const leftIdx = rec ? (rec.dir > 0 ? rec.frameTeam : 1 - rec.frameTeam) : 0;
    const leftTeam = game ? game.teams[leftIdx] : null;
    const rightTeam = game ? game.teams[1 - leftIdx] : null;
    for (const [ex, team] of [[-10, leftTeam], [100, rightTeam]]) {
      ctx.fillStyle = team ? team.colors.primary : '#225';
      ctx.fillRect(this.sx(ex), y0, 10 * s, y1 - y0);
      if (team) {
        ctx.save();
        ctx.translate(this.sx(ex + 5), this.sy(W / 2));
        ctx.rotate(ex < 0 ? -Math.PI / 2 : Math.PI / 2);
        ctx.fillStyle = 'rgba(255,255,255,.9)';
        ctx.font = `700 ${Math.round(s * 5)}px Oswald, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(team.name.toUpperCase(), 0, 0);
        ctx.restore();
      }
    }
    // lines
    ctx.strokeStyle = 'rgba(255,255,255,.85)';
    for (let X = 0; X <= 100; X += 5) {
      ctx.lineWidth = X % 10 === 0 ? 2 : 1.2;
      ctx.beginPath(); ctx.moveTo(this.sx(X), y0); ctx.lineTo(this.sx(X), y1); ctx.stroke();
    }
    ctx.lineWidth = 3;
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    // hash marks
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let X = 1; X < 100; X++) {
      if (X % 5 === 0) continue;
      const px = this.sx(X);
      for (const Y of [0.4, W / 2 - 4, W / 2 + 4, W - 0.4]) {
        ctx.moveTo(px, this.sy(Y - 0.35)); ctx.lineTo(px, this.sy(Y + 0.35));
      }
    }
    ctx.stroke();
    // numbers
    ctx.fillStyle = 'rgba(255,255,255,.8)';
    ctx.font = `600 ${Math.round(s * 2.4)}px Oswald, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let X = 10; X <= 90; X += 10) {
      const n = X <= 50 ? X : 100 - X;
      for (const [Y, rot] of [[6, 0], [W - 6, Math.PI]]) {
        ctx.save(); ctx.translate(this.sx(X), this.sy(Y)); ctx.rotate(rot); ctx.fillText(String(n), 0, 0); ctx.restore();
      }
    }
    // midfield logo
    const mx = this.sx(50), my = this.sy(W / 2), r = s * 3.2;
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.beginPath(); ctx.arc(mx, my, r, Math.PI, 0); ctx.fillStyle = '#e53935'; ctx.fill();
    ctx.beginPath(); ctx.arc(mx, my, r, 0, Math.PI); ctx.fillStyle = '#fff'; ctx.fill();
    ctx.lineWidth = s * 0.35; ctx.strokeStyle = '#222';
    ctx.beginPath(); ctx.arc(mx, my, r, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(mx - r, my); ctx.lineTo(mx + r, my); ctx.stroke();
    ctx.beginPath(); ctx.arc(mx, my, r * 0.3, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.stroke();
    ctx.restore();
    // goal posts (top-down)
    for (const X of [-10, 110]) {
      const px = this.sx(X);
      ctx.strokeStyle = '#ffd400'; ctx.lineWidth = Math.max(2, s * 0.3);
      ctx.beginPath(); ctx.moveTo(px, this.sy(W / 2 - 3.1)); ctx.lineTo(px, this.sy(W / 2 + 3.1)); ctx.stroke();
      ctx.beginPath(); ctx.arc(px, this.sy(W / 2), s * 0.4, 0, Math.PI * 2); ctx.fillStyle = '#ffd400'; ctx.fill();
    }
    // line of scrimmage & line to gain
    if (rec && rec.losX != null) {
      const abs = (x) => (rec.dir > 0 ? x : 100 - x);
      ctx.lineWidth = Math.max(2, s * 0.25);
      ctx.strokeStyle = 'rgba(64, 140, 255, .95)';
      ctx.beginPath(); ctx.moveTo(this.sx(abs(rec.losX)), y0); ctx.lineTo(this.sx(abs(rec.losX)), y1); ctx.stroke();
      if (rec.fdX != null && rec.fdX < 100) {
        ctx.strokeStyle = 'rgba(255, 221, 0, .95)';
        ctx.beginPath(); ctx.moveTo(this.sx(abs(rec.fdX)), y0); ctx.lineTo(this.sx(abs(rec.fdX)), y1); ctx.stroke();
      }
    }
  }

  // ------------------------------------------------------------------
  // Tokens
  ensureTokens(rec, game) {
    const want = new Set(rec.cast.map((c) => c.pid));
    for (const [pid, t] of this.tokens) t.el.style.display = want.has(pid) ? '' : 'none';
    rec.cast.forEach((c) => {
      let t = this.tokens.get(c.pid);
      const pl = game.players[c.pid];
      if (!t) {
        const el = document.createElement('div');
        el.className = 'token';
        const team = game.teams.find((x) => x.id === pl.teamId);
        el.innerHTML = `<div class="base"></div><img alt="${pl.name}" draggable="false" /><span class="label">${pl.name}</span>`;
        el.querySelector('.base').style.background = hexA(team.colors.primary, 0.85);
        el.querySelector('.label').style.background = team.colors.primary;
        const img = el.querySelector('img');
        img.referrerPolicy = 'no-referrer';
        img.onerror = () => { if (!img.dataset.fallback) { img.dataset.fallback = '1'; img.src = spriteUrl(pl, 'home'); } };
        this.tokensEl.appendChild(el);
        el.dataset.pid = c.pid;
        if (this.onPlayerHover) {
          el.addEventListener('mouseenter', () => this.onPlayerHover(el.dataset.pid, el));
          el.addEventListener('mouseleave', () => this.onPlayerHover(null));
          el.addEventListener('click', (e) => { e.stopPropagation(); this.onPlayerHover(el.dataset.pid, el, true); });
        }
        t = { el, img, pl, style: null, flip: false };
        this.tokens.set(c.pid, t);
      }
      if (t.style !== this.spriteStyle) {
        t.style = this.spriteStyle;
        t.img.dataset.fallback = '';
        t.img.src = spriteUrl(pl, this.spriteStyle);
        t.el.classList.toggle('bw', this.spriteStyle === 'bw' && !!pl.sprites?.bw);
      }
    });
  }

  sizeTokens() {
    const s = this.scale;
    const size = clamp(s * 3.5, 22, 84);
    for (const t of this.tokens.values()) {
      const big = Math.pow(clamp(t.pl.height, 0.4, 3.5), 0.25); // bigger Pokemon look a bit bigger
      const sz = size * big;
      t.img.style.width = `${sz}px`; t.img.style.height = `${sz}px`;
      const base = t.el.querySelector('.base');
      base.style.width = `${size * 0.62}px`; base.style.height = `${size * 0.32}px`;
    }
  }

  // ------------------------------------------------------------------
  // Main draw. ft = playback time within rec (seconds)
  draw(rec, ft, game, opts = {}) {
    if (!rec) return;
    if (this.view === 'all14' && rec.dir !== this.dir) opts = { ...opts, snapCamera: true }; // possession flipped
    this.dir = rec.dir;
    this.layout(rec.W);
    const frames = rec.frames;
    const fi = clamp(ft / 0.05, 0, frames.length - 1);
    const i0 = Math.floor(fi), i1 = Math.min(frames.length - 1, i0 + 1), k = fi - i0;
    const A = frames[i0], B = frames[i1];
    const dir = rec.dir;
    const absX = (x) => (dir > 0 ? x : 100 - x);
    const absY = (y) => (dir > 0 ? y : rec.W - y);
    const lerp = (a, b) => a + (b - a) * k;

    const bx = absX(lerp(A.b[0], B.b[0]));
    this.setCamera(bx, opts.snapCamera);
    if (this.lastScale !== this.scale) { this.sizeTokens(); this.lastScale = this.scale; }

    if (this.view === 'all14') this.drawField14(this.fctx, game, rec);
    else this.drawField(this.fctx, game, rec);
    const ctx = this.octx;
    ctx.clearRect(0, 0, this.w, this.h);

    // play design overlay (pre-snap / early)
    if (opts.design && rec.design) this.drawDesign(ctx, rec, absX, absY, opts.designAlpha ?? 1);

    // tokens
    const holder = A.b[3];
    rec.cast.forEach((c, idx) => {
      const t = this.tokens.get(c.pid);
      if (!t) return;
      const pa = A.p[idx], pb = B.p[idx];
      const X = absX(lerp(pa[0], pb[0])), Y = absY(lerp(pa[1], pb[1]));
      const P = this.pt(X, Y);
      const all14 = this.view === 'all14';
      t.el.style.transform = all14 ? `translate(${P.x}px, ${P.y}px) scale(${P.k.toFixed(3)})` : `translate(${P.x}px, ${P.y}px)`;
      t.el.style.visibility = P.behind ? 'hidden' : '';
      t.el.style.zIndex = String(Math.round(P.y));
      // face the direction of travel across the screen; at rest, face the other team
      // (side-on: toward the opponent's end zone; all-14: sideways motion only, so keep the last facing)
      const vx = all14 ? lerp(pa[4], pb[4]) : lerp(pa[3], pb[3]) * dir; // all-14: screen-right is +y in the play's frame
      let faceRight = t.flip;
      if (Math.abs(vx) > 0.6) faceRight = vx > 0;
      else if (ft < 0.1 && !all14) faceRight = (c.side === 'O') === (dir > 0);
      if (faceRight !== t.flip) { t.flip = faceRight; t.img.classList.toggle('flip', faceRight); }
      t.el.classList.toggle('engaged', pa[2] === 1);
      t.el.classList.toggle('stun', pa[2] === 2);
      t.el.classList.toggle('carrier', holder === idx && rec.type === 'scrimmage');
    });

    // QB read highlight
    if (opts.reads && A.read >= 0 && rec.type === 'scrimmage') {
      const p = A.p[A.read];
      const R = this.pt(absX(p[0]), absY(p[1]));
      const rr = this.scale * 1.6 * R.k;
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 203, 5, .95)'; ctx.lineWidth = 2.5;
      ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.ellipse(R.x, R.y, rr, rr * R.sq, 0, 0, Math.PI * 2); ctx.stroke();
      // sightline from QB
      const q = A.p[0], Q = this.pt(absX(q[0]), absY(q[1]));
      ctx.globalAlpha = 0.35; ctx.setLineDash([2, 6]);
      ctx.beginPath(); ctx.moveTo(Q.x, Q.y); ctx.lineTo(R.x, R.y); ctx.stroke();
      ctx.restore();
      const order = rec.design?.prog ? rec.design.prog.indexOf(A.read) : -1;
      if (order >= 0) {
        ctx.fillStyle = '#ffcb05'; ctx.font = `800 ${Math.round(this.scale * 1.3 * Math.max(0.6, R.k))}px Inter, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(`READ ${order + 1}`, R.x, R.y - this.scale * 3.4 * R.k);
      }
    }

    // ball
    const bX = absX(lerp(A.b[0], B.b[0])), bY = absY(lerp(A.b[1], B.b[1])), bz = lerp(A.b[2], B.b[2]);
    const held = A.b[3] >= 0;
    if (!held || rec.type !== 'scrimmage') {
      const G = this.pt(bX, bY), U = this.pt(bX, bY, bz);
      const gk = this.scale * G.k;
      ctx.fillStyle = 'rgba(0,0,0,.35)';
      ctx.beginPath(); ctx.ellipse(G.x, G.y, gk * 0.45, gk * 0.22, 0, 0, Math.PI * 2); ctx.fill();
      // side-on: the ball grows a little as it climbs (fake height); all-14: real height + distance
      const r = this.view === 'all14' ? gk * 0.45 : this.scale * (0.42 + Math.min(bz, 16) * 0.025);
      const ang = this.view === 'all14' ? 0 : Math.atan2(lerp(A.b[1], B.b[1]) - A.b[1], 1);
      ctx.save();
      ctx.translate(U.x, U.y); ctx.rotate(ang);
      ctx.fillStyle = '#8b4a1f'; ctx.strokeStyle = '#3b1d0a'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(0, 0, r * 1.25, r * 0.78, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(-r * 0.45, 0); ctx.lineTo(r * 0.45, 0); ctx.stroke();
      ctx.restore();
    }
  }

  drawDesign(ctx, rec, absX, absY, alpha) {
    const d = rec.design;
    const s = this.scale;
    ctx.save();
    ctx.globalAlpha = alpha;
    // zones
    const P = (x, y) => this.pt(absX(x), absY(y));
    for (const z of d.zones || []) {
      ctx.fillStyle = z.deep ? 'rgba(80, 160, 255, .13)' : 'rgba(255, 120, 80, .13)';
      ctx.strokeStyle = z.deep ? 'rgba(120, 190, 255, .55)' : 'rgba(255, 150, 110, .55)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      const c = P(z.x, z.y), along = s * (z.deep ? 5 : 3.2) * c.k, across = s * z.r * 0.75 * c.k;
      // side-on, the zone's depth runs across the screen; from behind the offense it runs up it
      if (this.view === 'all14') ctx.ellipse(c.x, c.y, across, along * c.sq, 0, 0, Math.PI * 2);
      else ctx.ellipse(c.x, c.y, along, across, 0, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
    }
    // routes
    ctx.lineWidth = 2.2; ctx.setLineDash([6, 4]);
    for (const r of d.routes || []) {
      ctx.strokeStyle = 'rgba(255,255,255,.85)';
      ctx.beginPath();
      r.pts.forEach((p, i) => { const q = P(p.x, p.y); i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); });
      ctx.stroke();
      const n = r.pts.length;
      if (n >= 2) {
        const a = P(r.pts[n - 2].x, r.pts[n - 2].y), b = P(r.pts[n - 1].x, r.pts[n - 1].y);
        arrowHead(ctx, a.x, a.y, b.x, b.y, s * 0.9 * Math.max(0.5, b.k));
      }
    }
    ctx.setLineDash([]);
    // pre-snap motion path
    if (d.motion) {
      const a = P(d.motion.from.x, d.motion.from.y), b = P(d.motion.to.x, d.motion.to.y);
      ctx.strokeStyle = 'rgba(255, 203, 5, .9)'; ctx.lineWidth = 2; ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.setLineDash([]);
      arrowHead(ctx, a.x, a.y, b.x, b.y, s * 0.9 * b.k, 'rgba(255, 203, 5, .9)');
    }
    // run aim point
    if (d.aim && this.view === 'all14') {
      // downfield is up the screen: arrow from just behind the aim point through it
      const a = P(d.aim.x - 1.8, d.aim.y), b = P(d.aim.x + 0.8, d.aim.y);
      ctx.strokeStyle = 'rgba(255, 203, 5, .9)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      arrowHead(ctx, a.x, a.y, b.x, b.y, s * 1.1 * b.k, 'rgba(255, 203, 5, .9)');
    } else if (d.aim) {
      const X = this.sx(absX(d.aim.x)), Y = this.sy(absY(d.aim.y));
      ctx.strokeStyle = 'rgba(255, 203, 5, .9)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(X - s * 1.8, Y); ctx.lineTo(X + s * 0.6, Y); ctx.stroke();
      arrowHead(ctx, X - s * 1.8, Y, X + s * 0.8, Y, s * 1.1, 'rgba(255, 203, 5, .9)');
    }
    // blitzers
    const f0 = rec.frames[0];
    for (const idx of d.rush || []) {
      const p = f0.p[idx];
      if (!p) continue;
      const a = P(p[0], p[1]), b = P(p[0] - 2.4, p[1]);
      ctx.strokeStyle = 'rgba(255, 90, 90, .85)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      arrowHead(ctx, a.x, a.y, b.x, b.y, s * 0.8 * a.k, 'rgba(255, 90, 90, .85)');
    }
    ctx.restore();
  }
}

function arrowHead(ctx, x0, y0, x1, y1, size, color) {
  const a = Math.atan2(y1 - y0, x1 - x0);
  ctx.save();
  ctx.setLineDash([]);
  ctx.fillStyle = color || ctx.strokeStyle;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - size * Math.cos(a - 0.45), y1 - size * Math.sin(a - 0.45));
  ctx.lineTo(x1 - size * Math.cos(a + 0.45), y1 - size * Math.sin(a + 0.45));
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
