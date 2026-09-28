// Seeded PRNG (mulberry32) so games are reproducible from a seed.
export class RNG {
  constructor(seed = Date.now()) {
    this.seed = seed >>> 0;
    this.s = this.seed;
  }
  next() {
    let t = (this.s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a, b) { return a + (b - a) * this.next(); }
  int(a, b) { return Math.floor(this.range(a, b + 1)); }
  chance(p) { return this.next() < p; }
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
  gauss(mean = 0, sd = 1) {
    const u = 1 - this.next(), v = this.next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  // items: [{w, ...}] -> picks one proportional to w
  weighted(items) {
    const total = items.reduce((s, it) => s + Math.max(0, it.w), 0);
    let r = this.next() * total;
    for (const it of items) {
      r -= Math.max(0, it.w);
      if (r <= 0) return it;
    }
    return items[items.length - 1];
  }
}
