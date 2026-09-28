// Field + token rendering. Field and overlay are canvases; players are DOM
// tokens so animated GIF sprites keep animating.
const SPRITE_BASE = 'https://img.pokemondb.net/sprites';
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function spriteUrl(player, style = 'home') {
  if (style === 'bw' && player.sprites?.bw) return `${SPRITE_BASE}/black-white/anim/normal/${player.sprites.bw}.gif`;
  return `${SPRITE_BASE}/home/normal/${player.sprites?.home || player.slug}.png`;
}

export class FieldRenderer {
  constructor({ stage, field, overlay, tokens }) {
    this.stage = stage; this.field = field; this.overlay = overlay; this.tokensEl = tokens;
    this.fctx = field.getContext('2d');
    this.octx = overlay.getContext('2d');
    this.tokens = new Map();
    this.camX = 50;
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
    const marginY = 2.2;
    this.scale = this.h / (W + marginY * 2);
    this.viewYards = this.w / this.scale;
    this.W = W;
    this.offY = marginY;
  }
  sx(X) { return (X - this.camX) * this.scale + this.w / 2; }
  sy(Y) { return (Y + this.offY) * this.scale; }

  setCamera(targetX, snap = false) {
    const half = this.viewYards / 2;
    const lo = -12 + half, hi = 112 - half;
    const t = lo > hi ? 50 : clamp(targetX, lo, hi);
    this.camX = snap ? t : this.camX + (t - this.camX) * 0.12;
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
    // end zones: painted with the team defending that end this quarter
    const leftTeam = game ? (game.dirFor(0) === 1 ? game.teams[0] : game.teams[1]) : null;
    const rightTeam = game ? (leftTeam === game.teams[0] ? game.teams[1] : game.teams[0]) : null;
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
        el.innerHTML = `<div class="base"></div><img alt="${pl.name}" draggable="false" /><span class="num">${pl.num}<span class="nm">${pl.name}</span></span>`;
        el.querySelector('.base').style.background = hexA(team.colors.primary, 0.85);
        el.querySelector('.num').style.background = team.colors.primary;
        const img = el.querySelector('img');
        img.referrerPolicy = 'no-referrer';
        img.onerror = () => { if (!img.dataset.fallback) { img.dataset.fallback = '1'; img.src = spriteUrl(pl, 'home'); } };
        this.tokensEl.appendChild(el);
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

    this.drawField(this.fctx, game, rec);
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
      const vx = lerp(pa[3], pb[3]) * dir;
      const px = this.sx(X), py = this.sy(Y);
      t.el.style.transform = `translate(${px}px, ${py}px)`;
      t.el.style.zIndex = String(Math.round(py));
      // face direction of travel; at rest face the opponent's end zone
      let faceRight = t.flip;
      if (Math.abs(vx) > 0.6) faceRight = vx > 0;
      else if (ft < 0.1) faceRight = (c.side === 'O') === (dir > 0);
      if (faceRight !== t.flip) { t.flip = faceRight; t.img.classList.toggle('flip', faceRight); }
      t.el.classList.toggle('engaged', pa[2] === 1);
      t.el.classList.toggle('stun', pa[2] === 2);
      t.el.classList.toggle('carrier', holder === idx && rec.type === 'scrimmage');
    });

    // QB read highlight
    if (opts.reads && A.read >= 0 && rec.type === 'scrimmage') {
      const p = A.p[A.read];
      const X = absX(p[0]), Y = absY(p[1]);
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 203, 5, .95)'; ctx.lineWidth = 2.5;
      ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.arc(this.sx(X), this.sy(Y), this.scale * 1.6, 0, Math.PI * 2); ctx.stroke();
      // sightline from QB
      const q = A.p[0];
      ctx.globalAlpha = 0.35; ctx.setLineDash([2, 6]);
      ctx.beginPath(); ctx.moveTo(this.sx(absX(q[0])), this.sy(absY(q[1]))); ctx.lineTo(this.sx(X), this.sy(Y)); ctx.stroke();
      ctx.restore();
      const order = rec.design?.prog ? rec.design.prog.indexOf(A.read) : -1;
      if (order >= 0) {
        ctx.fillStyle = '#ffcb05'; ctx.font = `800 ${Math.round(this.scale * 1.3)}px Inter, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(`READ ${order + 1}`, this.sx(X), this.sy(Y) - this.scale * 3.4);
      }
    }

    // ball
    const bX = absX(lerp(A.b[0], B.b[0])), bY = absY(lerp(A.b[1], B.b[1])), bz = lerp(A.b[2], B.b[2]);
    const held = A.b[3] >= 0;
    if (!held || rec.type !== 'scrimmage') {
      const gx = this.sx(bX), gy = this.sy(bY);
      ctx.fillStyle = 'rgba(0,0,0,.35)';
      ctx.beginPath(); ctx.ellipse(gx, gy, this.scale * 0.45, this.scale * 0.22, 0, 0, Math.PI * 2); ctx.fill();
      const lift = bz * this.scale * 0.55;
      const r = this.scale * (0.42 + Math.min(bz, 16) * 0.025);
      const ang = Math.atan2(lerp(A.b[1], B.b[1]) - A.b[1], 1);
      ctx.save();
      ctx.translate(gx, gy - lift); ctx.rotate(ang);
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
    for (const z of d.zones || []) {
      ctx.fillStyle = z.deep ? 'rgba(80, 160, 255, .13)' : 'rgba(255, 120, 80, .13)';
      ctx.strokeStyle = z.deep ? 'rgba(120, 190, 255, .55)' : 'rgba(255, 150, 110, .55)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(this.sx(absX(z.x)), this.sy(absY(z.y)), s * (z.deep ? 5 : 3.2), s * z.r * 0.75, 0, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
    }
    // routes
    ctx.lineWidth = 2.2; ctx.setLineDash([6, 4]);
    for (const r of d.routes || []) {
      ctx.strokeStyle = 'rgba(255,255,255,.85)';
      ctx.beginPath();
      r.pts.forEach((p, i) => { const X = this.sx(absX(p.x)), Y = this.sy(absY(p.y)); i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); });
      ctx.stroke();
      const n = r.pts.length;
      if (n >= 2) arrowHead(ctx, this.sx(absX(r.pts[n - 2].x)), this.sy(absY(r.pts[n - 2].y)), this.sx(absX(r.pts[n - 1].x)), this.sy(absY(r.pts[n - 1].y)), s * 0.9);
    }
    ctx.setLineDash([]);
    // run aim point
    if (d.aim) {
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
      const X = this.sx(absX(p[0])), Y = this.sy(absY(p[1]));
      const tx = this.sx(absX(p[0] - 2.4));
      ctx.strokeStyle = 'rgba(255, 90, 90, .85)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(X, Y); ctx.lineTo(tx, Y); ctx.stroke();
      arrowHead(ctx, X, Y, tx, Y, s * 0.8, 'rgba(255, 90, 90, .85)');
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
