// Pista come "nastro": centro campionato a passo costante + profilo dei bordi per lato.
// Tutta la fisica ragiona nel riferimento della pista (s lungo, d laterale; d>0 = destra).
// Nessuna dipendenza da three.js: gira anche in Node per i test.

import { catmullRomClosed, resampleClosed, smoothClosed } from './spline.js';

export const SURF = { ROAD: 0, KERB: 1, GRASS: 2, GRAVEL: 3, RUNOFF: 4, SIDEWALK: 5 };
export const BAR = { GUARDRAIL: 0, WALL: 1, TECPRO: 2, FENCE: 3 };
export const SURF_NAMES = ['asfalto', 'cordolo', 'erba', 'ghiaia', 'via di fuga', 'marciapiede'];

// aderenza (moltiplicatore di μ) e freno della superficie (m/s² + coeff·v)
export const SURF_PHYS = [
  { mu: 1.0, drag: 0.0, dragV: 0.0 },     // asfalto
  { mu: 0.96, drag: 0.15, dragV: 0.0 },   // cordolo
  { mu: 0.58, drag: 1.4, dragV: 0.025 },  // erba
  { mu: 0.5, drag: 4.5, dragV: 0.06 },    // ghiaia
  { mu: 0.97, drag: 0.1, dragV: 0.0 },    // via di fuga asfaltata
  { mu: 0.9, drag: 0.4, dragV: 0.0 },     // marciapiede
];

const TAU = Math.PI * 2;

export class Track {
  /**
   * def: {
   *   id, nome, stile: 'permanente'|'citta'|'monza',
   *   ctrl?: [{x,y,z,w,bank}]   punti di controllo (piste inventate)
   *   samples?: [{x,y,z,w}]     campioni già pronti (Monza)
   *   override?: [{da, a, lato:'L'|'R'|'B', kerb?, run?, runW?, bar?}]  (metri)
   *   startS?: metri del traguardo, curve?: [{name,s}]
   * }
   */
  constructor(def) {
    this.def = def;
    this.id = def.id;
    this.nome = def.nome;
    this.stile = def.stile;
    let pts;
    if (def.samples) {
      const r = resampleClosed(def.samples, 2);
      pts = r.pts;
    } else {
      const dense = catmullRomClosed(def.ctrl, 32);
      pts = resampleClosed(dense, 2).pts;
    }
    const n = (this.n = pts.length);
    this.px = new Float64Array(n); this.py = new Float64Array(n); this.pz = new Float64Array(n);
    this.w = new Float64Array(n); this.bank = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      this.px[i] = pts[i].x; this.py[i] = pts[i].y; this.pz[i] = pts[i].z;
      this.w[i] = pts[i].w || 12; this.bank[i] = pts[i].bank || 0;
    }
    // quota e larghezza morbide
    this.py = smoothClosed(this.py, 4);
    this.w = smoothClosed(this.w, 6);
    // ascisse
    this.s = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      this.s[i + 1] = this.s[i] + Math.hypot(this.px[j] - this.px[i], this.pz[j] - this.pz[i]);
    }
    this.length = this.s[n];
    this.step = this.length / n;
    // tangenti (orizzontali) e normali destre
    this.tx = new Float64Array(n); this.tz = new Float64Array(n);
    this.nx = new Float64Array(n); this.nz = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const a = (i - 1 + n) % n, b = (i + 1) % n;
      let dx = this.px[b] - this.px[a], dz = this.pz[b] - this.pz[a];
      const l = Math.hypot(dx, dz) || 1;
      dx /= l; dz /= l;
      this.tx[i] = dx; this.tz[i] = dz;
      this.nx[i] = -dz; this.nz[i] = dx;
    }
    // pendenza longitudinale
    this.slope = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const a = (i - 2 + n) % n, b = (i + 2) % n;
      this.slope[i] = (this.py[b] - this.py[a]) / (4 * this.step);
    }
    // curvatura con segno (>0 = curva a destra)
    const k = new Float64Array(n);
    const K = Math.max(2, Math.round(6 / this.step));
    for (let i = 0; i < n; i++) {
      const a = (i - K + n) % n, b = (i + K) % n;
      let h1 = Math.atan2(this.tz[a], this.tx[a]);
      let h2 = Math.atan2(this.tz[b], this.tx[b]);
      let dh = h2 - h1;
      while (dh > Math.PI) dh -= TAU;
      while (dh < -Math.PI) dh += TAU;
      k[i] = dh / (2 * K * this.step);
    }
    this.kappa = smoothClosed(k, 3);
    this.startS = def.startS || 0;
    this._buildGrid();
    this.curve = (def.curve || []).map((c, k) => ({
      name: c.name,
      s: def.curvaAt ? this.nearest(def.curvaAt[k][0], def.curvaAt[k][1]).i * this.step : c.s,
    }));
    // override espressi in coordinate → intervalli di s
    this.overrides = [...(def.override || [])];
    for (const o of def.overrideXZ || []) {
      if (o.at) {
        const s = this.nearest(o.at[0], o.at[1]).i * this.step;
        this.overrides.push({ ...o, da: this.wrapS(s - o.r), a: this.wrapS(s + o.r) });
      } else if (o.seg) {
        const a = this.nearest(o.seg[0][0], o.seg[0][1]).i * this.step;
        const b = this.nearest(o.seg[1][0], o.seg[1][1]).i * this.step;
        this.overrides.push({ ...o, da: a, a: b });
      }
    }
    this._buildEdges();
    this._buildPit();
  }

  // ---------- indice spaziale ----------
  _buildGrid() {
    const C = (this.cell = 25);
    let minx = Infinity, minz = Infinity, maxx = -Infinity, maxz = -Infinity;
    for (let i = 0; i < this.n; i++) {
      minx = Math.min(minx, this.px[i]); maxx = Math.max(maxx, this.px[i]);
      minz = Math.min(minz, this.pz[i]); maxz = Math.max(maxz, this.pz[i]);
    }
    this.bounds = { minx, minz, maxx, maxz };
    this.gx0 = minx - 200; this.gz0 = minz - 200;
    this.gw = Math.ceil((maxx - minx + 400) / C); this.gh = Math.ceil((maxz - minz + 400) / C);
    this.grid = new Map();
    for (let i = 0; i < this.n; i++) {
      const key = this._key(this.px[i], this.pz[i]);
      let a = this.grid.get(key);
      if (!a) this.grid.set(key, (a = []));
      a.push(i);
    }
  }
  _key(x, z) {
    const gx = Math.floor((x - this.gx0) / this.cell), gz = Math.floor((z - this.gz0) / this.cell);
    return gz * 100000 + gx;
  }
  /** campioni entro `r` metri da (x,z) */
  near(x, z, r) {
    const out = [];
    const c = this.cell, R = Math.ceil(r / c);
    const gx = Math.floor((x - this.gx0) / c), gz = Math.floor((z - this.gz0) / c);
    for (let j = -R; j <= R; j++)
      for (let i = -R; i <= R; i++) {
        const a = this.grid.get((gz + j) * 100000 + gx + i);
        if (a) for (const k of a) out.push(k);
      }
    return out;
  }
  /** campione più vicino (ricerca globale) */
  nearest(x, z, rmax = 400) {
    let best = -1, bd = Infinity;
    for (let r = 50; r <= rmax && best < 0; r *= 2) {
      for (const i of this.near(x, z, r)) {
        const d = (this.px[i] - x) ** 2 + (this.pz[i] - z) ** 2;
        if (d < bd) { bd = d; best = i; }
      }
    }
    if (best < 0) {
      for (let i = 0; i < this.n; i++) {
        const d = (this.px[i] - x) ** 2 + (this.pz[i] - z) ** 2;
        if (d < bd) { bd = d; best = i; }
      }
    }
    return { i: best, dist: Math.sqrt(bd) };
  }

  // ---------- profilo dei bordi ----------
  _buildEdges() {
    const n = this.n, st = this.stile;
    const mk = () => ({
      kerb: new Float64Array(n), run: new Uint8Array(n), runW: new Float64Array(n),
      bar: new Uint8Array(n), barD: new Float64Array(n),
    });
    this.L = mk(); this.R = mk();
    const kerbK = st === 'citta' ? 1 / 70 : 1 / 320;
    const kerbW = st === 'citta' ? 0.7 : 1.3;
    const k1 = new Float64Array(n), k2 = new Float64Array(n);
    // kerb e larghezze di base
    for (const [side, E, sign] of [['L', this.L, -1], ['R', this.R, 1]]) {
      const runW = new Float64Array(n), gravel = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        const kap = this.kappa[i];
        const c = Math.abs(kap);
        const outside = Math.sign(kap) === -sign; // curva a destra → esterno a sinistra
        E.kerb[i] = c > kerbK ? kerbW : 0;
        if (st === 'citta') {
          runW[i] = 1.6;
          E.run[i] = SURF.SIDEWALK;
          E.bar[i] = BAR.WALL;
        } else {
          const vc = Math.sqrt((1.6 * 9.81) / Math.max(c, 1e-4));
          if (outside && c > 1 / 190) {
            gravel[i] = Math.min(st === 'monza' ? 26 : 30, Math.max(10, vc * 0.45));
          }
          runW[i] = st === 'monza' ? 7 : 11;
          E.run[i] = SURF.GRASS;
          E.bar[i] = BAR.GUARDRAIL;
        }
      }
      // dilata le zone di ghiaia e i cordoli lungo la pista
      const dil = (arr, R) => {
        const o = new Float64Array(n);
        for (let i = 0; i < n; i++) {
          let m = 0;
          for (let k = -R; k <= R; k++) m = Math.max(m, arr[(i + k + n) % n]);
          o[i] = m;
        }
        return o;
      };
      const gD = smoothClosed(dil(gravel, Math.round(40 / this.step)), 6);
      const kD = dil(E.kerb, Math.round(10 / this.step));
      for (let i = 0; i < n; i++) {
        E.kerb[i] = kD[i] > 0.3 ? kerbW : 0;
        if (gD[i] > 6) {
          E.run[i] = SURF.GRAVEL;
          runW[i] = gD[i];
          E.bar[i] = BAR.TECPRO;
        }
        E.runW[i] = runW[i];
      }
    }
    // override manuali per tratti (metri)
    for (const o of this.overrides) {
      const sides = o.lato === 'B' || !o.lato ? [this.L, this.R] : [o.lato === 'L' ? this.L : this.R];
      for (let i = 0; i < n; i++) {
        const s = i * this.step;
        const inside = o.da <= o.a ? s >= o.da && s <= o.a : s >= o.da || s <= o.a;
        if (!inside) continue;
        for (const E of sides) {
          if (o.kerb !== undefined) E.kerb[i] = o.kerb;
          if (o.run !== undefined) E.run[i] = o.run;
          if (Array.isArray(o.runW)) {
            // rampa lineare da runW[0] (inizio del tratto) a runW[1] (fine): barriere che si raccordano senza gradini
            const len = o.da <= o.a ? o.a - o.da : this.length - o.da + o.a;
            const t = Math.max(0, Math.min(1, (((s - o.da) % this.length) + this.length) % this.length / Math.max(1, len)));
            E.runW[i] = o.runW[0] + (o.runW[1] - o.runW[0]) * t;
          } else if (o.runW !== undefined) E.runW[i] = o.runW;
          if (o.bar !== undefined) E.bar[i] = o.bar;
        }
      }
    }
    // distanza della barriera e limite dovuto ad altri tratti vicini della pista
    for (const [E, sign] of [[this.L, -1], [this.R, 1]]) {
      for (let i = 0; i < n; i++) {
        E.barD[i] = this.w[i] / 2 + E.kerb[i] + E.runW[i] + 0.6;
      }
      for (let i = 0; i < n; i++) {
        let lim = E.barD[i];
        for (const j of this.near(this.px[i], this.pz[i], lim + 30)) {
          let ds = Math.abs(j - i);
          ds = Math.min(ds, n - ds) * this.step;
          if (ds < 120) continue;
          const vx = this.px[j] - this.px[i], vz = this.pz[j] - this.pz[i];
          const along = vx * this.tx[i] + vz * this.tz[i];
          if (Math.abs(along) > 14) continue;
          const lat = (vx * this.nx[i] + vz * this.nz[i]) * sign;
          if (lat <= 0) continue;
          const mine = this.w[i] / 2, other = lat - this.w[j] / 2;
          lim = Math.min(lim, Math.max(mine + 0.8, (mine + other) / 2));
        }
        E.barD[i] = lim;
      }
      // morbido (solo verso il basso) per evitare gradini nella barriera
      const sm = smoothClosed(E.barD, 3);
      for (let i = 0; i < n; i++) {
        E.barD[i] = Math.min(E.barD[i], sm[i] + 0.3);
        const free = E.barD[i] - 0.6 - this.w[i] / 2;
        if (E.kerb[i] > free) E.kerb[i] = Math.max(0, free);
        E.runW[i] = Math.max(0, Math.min(E.runW[i], free - E.kerb[i]));
      }
    }
  }

  /**
   * Corsia box (def.pit = {lato, da, a, d, w, rIn, rOut}): asfalto fino al muro esterno dietro la corsia e
   * un muretto box (isola solida) fra pista e corsia. Profilo del centro corsia: dal bordo pista a d in rIn metri,
   * costante, poi di nuovo al bordo in rOut metri.
   */
  _buildPit() {
    const P = this.def.pit;
    this.pit = null;
    if (!P) return;
    const n = this.n, E = P.lato === 'L' ? this.L : this.R;
    const len = P.da <= P.a ? P.a - P.da : this.length - P.da + P.a;
    E.pitC = new Float64Array(n); E.isl0 = new Float64Array(n); E.isl1 = new Float64Array(n);
    const sm = (x) => x * x * (3 - 2 * x);
    for (let i = 0; i < n; i++) {
      const s = i * this.step;
      const u = (((s - P.da) % this.length) + this.length) % this.length; // metri dall'inizio della corsia
      if (u > len) continue;
      const hw = this.w[i] / 2;
      const k = u < P.rIn ? sm(u / P.rIn) : u > len - P.rOut ? sm((len - u) / P.rOut) : 1;
      const c = hw + (P.d - hw) * k;            // centro corsia (distanza dal centro pista)
      E.pitC[i] = c;
      const outer = c + P.w / 2 + 1.0;
      if (outer > E.barD[i]) E.barD[i] = outer;
      E.run[i] = SURF.RUNOFF;
      E.bar[i] = BAR.WALL;
      E.runW[i] = Math.max(0, E.barD[i] - 0.6 - hw - E.kerb[i]);
      // muretto: da 1,2 m oltre il cordolo, largo 0,8 m, dove la corsia se n'è staccata abbastanza
      const a = hw + E.kerb[i] + 1.2, b = a + 0.8;
      if (c - P.w / 2 > b + 0.4) { E.isl0[i] = a; E.isl1[i] = b; }
    }
    this.pit = { ...P, E, len };
  }

  /** la proiezione p cade nella corsia box (oltre il muretto o nei raccordi)? */
  inPit(p) {
    if (!this.pit) return false;
    const E = this.pit.E;
    if ((p.d >= 0 ? this.R : this.L) !== E || !E.pitC[p.i]) return false;
    return Math.abs(p.d) > this.w[p.i] / 2 + E.kerb[p.i] + 0.5;
  }

  // ---------- interrogazioni ----------
  wrapS(s) {
    s %= this.length;
    return s < 0 ? s + this.length : s;
  }
  idx(i) {
    return ((i % this.n) + this.n) % this.n;
  }
  /**
   * Proietta (x,z) sulla pista. hint = indice del frame precedente (o -1).
   * Ritorna un oggetto riusabile {i, t, s, d, cy, w}.
   */
  project(x, z, hint = -1, out = {}) {
    const n = this.n;
    let best = -1, bd = Infinity;
    if (hint < 0) best = this.nearest(x, z).i;
    else {
      for (let k = -25; k <= 25; k++) {
        const i = (hint + k + n) % n;
        const d = (this.px[i] - x) ** 2 + (this.pz[i] - z) ** 2;
        if (d < bd) { bd = d; best = i; }
      }
    }
    // segmento giusto: best o best-1
    let i = best;
    let vx = x - this.px[i], vz = z - this.pz[i];
    let along = vx * this.tx[i] + vz * this.tz[i];
    if (along < 0) {
      i = (i - 1 + n) % n;
      vx = x - this.px[i]; vz = z - this.pz[i];
      along = vx * this.tx[i] + vz * this.tz[i];
    }
    const j = (i + 1) % n;
    const t = Math.max(0, Math.min(1, along / this.step));
    const nx = this.nx[i] + (this.nx[j] - this.nx[i]) * t;
    const nz = this.nz[i] + (this.nz[j] - this.nz[i]) * t;
    const cx = this.px[i] + (this.px[j] - this.px[i]) * t;
    const cz = this.pz[i] + (this.pz[j] - this.pz[i]) * t;
    out.i = i; out.t = t;
    out.s = (i + t) * this.step;
    out.d = (x - cx) * nx + (z - cz) * nz;
    out.cy = this.py[i] + (this.py[j] - this.py[i]) * t;
    out.w = this.w[i] + (this.w[j] - this.w[i]) * t;
    out.bank = this.bank[i] + (this.bank[j] - this.bank[i]) * t;
    return out;
  }
  /** quota del terreno/strada a distanza laterale d dal centro (proiezione già calcolata) */
  groundY(p) {
    const hw = p.w / 2;
    const dd = Math.max(-hw, Math.min(hw, p.d));
    let y = p.cy + dd * Math.tan(p.bank);
    const E = p.d >= 0 ? this.R : this.L;
    const ad = Math.abs(p.d);
    if (ad > hw) {
      const kw = E.kerb[p.i];
      if (ad <= hw + kw) y += 0.05 * Math.min(1, (ad - hw) / 0.3); // cordolo rialzato
      else y -= 0.04;
    }
    return y;
  }
  /** tipo di superficie e distanza della barriera dal lato in cui si trova d */
  surface(p) {
    const E = p.d >= 0 ? this.R : this.L;
    const i = p.i;
    const ad = Math.abs(p.d), hw = p.w / 2;
    let type;
    if (ad <= hw) type = SURF.ROAD;
    else if (ad <= hw + E.kerb[i]) type = SURF.KERB;
    else type = E.run[i];
    return type;
  }
  barrier(p, side) {
    const E = side > 0 ? this.R : this.L;
    const j = (p.i + 1) % this.n;
    return E.barD[p.i] + (E.barD[j] - E.barD[p.i]) * p.t;
  }
  /** punto in coordinate mondo a (s, d) */
  pointAt(s, d = 0, out = {}) {
    s = this.wrapS(s);
    const f = s / this.step;
    const i = Math.floor(f) % this.n, j = (i + 1) % this.n, t = f - Math.floor(f);
    const nx = this.nx[i] + (this.nx[j] - this.nx[i]) * t;
    const nz = this.nz[i] + (this.nz[j] - this.nz[i]) * t;
    const tx = this.tx[i] + (this.tx[j] - this.tx[i]) * t;
    const tz = this.tz[i] + (this.tz[j] - this.tz[i]) * t;
    out.x = this.px[i] + (this.px[j] - this.px[i]) * t + nx * d;
    out.z = this.pz[i] + (this.pz[j] - this.pz[i]) * t + nz * d;
    const w = this.w[i] + (this.w[j] - this.w[i]) * t;
    const bank = this.bank[i] + (this.bank[j] - this.bank[i]) * t;
    out.y = this.py[i] + (this.py[j] - this.py[i]) * t + Math.max(-w / 2, Math.min(w / 2, d)) * Math.tan(bank);
    out.yaw = Math.atan2(tz, tx);
    out.i = i;
    return out;
  }
  /** nome della curva più vicina a s (per HUD) */
  cornerAt(s) {
    let best = null, bd = 220;
    for (const c of this.curve) {
      let d = Math.abs(this.wrapS(s - c.s));
      d = Math.min(d, this.length - d);
      if (d < bd) { bd = d; best = c.name; }
    }
    return best;
  }
}
