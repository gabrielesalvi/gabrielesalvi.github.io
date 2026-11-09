// Spazio libero della pista: niente scenario fra le barriere ad altezza d'auto, niente terreno sopra
// asfalto, cordoli e vie di fuga. Considera tutti i tratti di pista vicini (anche incroci e sovrappassi).
import * as THREE from 'three';

export const CLEAR_H = 4.8; // sopra questa altezza dalla strada possono passare ponti e portali

export class Clearance {
  constructor(track) {
    this.tr = track;
    this._A = new THREE.Vector3(); this._B = new THREE.Vector3(); this._C = new THREE.Vector3();
    this._box = new THREE.Box3();
    this.rejected = 0;
    this._runCache = new Map();
  }

  /** tratti di pista (intervalli di indici consecutivi) vicini a una zona di 20 m, memorizzati */
  _runs(x, z) {
    const Z = 20, kx = Math.floor(x / Z), kz = Math.floor(z / Z), key = kx * 100003 + kz;
    let r = this._runCache.get(key);
    if (r) return r;
    const cand = this.tr.near((kx + 0.5) * Z, (kz + 0.5) * Z, 75);
    cand.sort((a, b) => a - b);
    r = [];
    let lo = -1, prev = -10;
    for (const i of cand) {
      if (i - prev > 4) { if (lo >= 0) r.push([lo, prev]); lo = i; }
      prev = i;
    }
    if (lo >= 0) r.push([lo, prev]);
    this._runCache.set(key, r);
    return r;
  }

  /** proiezioni di (x,z) sui tratti di pista vicini (un minimo locale per tratto), con il piede davvero sul tratto */
  hits(x, z) {
    const tr = this.tr, out = [];
    const d2 = (i) => (tr.px[i] - x) ** 2 + (tr.pz[i] - z) ** 2;
    for (const [lo, hi] of this._runs(x, z)) {
      // tutti i minimi locali dell'intervallo (un tornante stretto può stare in un solo intervallo con due rami)
      let dp = Infinity, dc = d2(lo);
      for (let i = lo; i <= hi; i++) {
        const dn = i < hi ? d2(i + 1) : Infinity;
        if (dc <= dp && dc <= dn && dc < 70 * 70) {
          const p = this._proj(x, z, i);
          if (p) out.push(p);
        }
        dp = dc; dc = dn;
      }
    }
    return out;
  }

  _proj(x, z, b) {
    const tr = this.tr, n = tr.n;
    let i = b;
    let along = (x - tr.px[i]) * tr.tx[i] + (z - tr.pz[i]) * tr.tz[i];
    if (along < 0) { i = (i - 1 + n) % n; along = (x - tr.px[i]) * tr.tx[i] + (z - tr.pz[i]) * tr.tz[i]; }
    const j = (i + 1) % n;
    const t = along / tr.step;
    if (t < -0.6 || t > 1.6) return null; // il piede non cade su questo tratto
    const tc = Math.max(0, Math.min(1, t));
    const nx = tr.nx[i] + (tr.nx[j] - tr.nx[i]) * tc, nz = tr.nz[i] + (tr.nz[j] - tr.nz[i]) * tc;
    const cx = tr.px[i] + (tr.px[j] - tr.px[i]) * tc, cz = tr.pz[i] + (tr.pz[j] - tr.pz[i]) * tc;
    return {
      i, t: tc, s: (i + tc) * tr.step, d: (x - cx) * nx + (z - cz) * nz,
      cy: tr.py[i] + (tr.py[j] - tr.py[i]) * tc, w: tr.w[i] + (tr.w[j] - tr.w[i]) * tc, bank: tr.bank[i] + (tr.bank[j] - tr.bank[i]) * tc,
    };
  }

  /** quota della superficie praticabile (asfalto, cordolo, via di fuga) in p, come la disegna trackmesh */
  surfaceY(p) {
    const tr = this.tr, E = p.d >= 0 ? tr.R : tr.L, side = p.d >= 0 ? 1 : -1;
    const hw = p.w / 2, ad = Math.abs(p.d);
    if (ad <= hw + E.kerb[p.i]) return tr.groundY(p) + 0.06;
    const yEdge = p.cy + side * hw * Math.tan(p.bank);
    return yEdge - 0.02 - (ad - hw) * 0.004;
  }

  /** quota più bassa della superficie praticabile in (x,z), o NaN se il punto è fuori dalle barriere */
  floorAt(x, z, pad = 0.5) {
    let y = NaN;
    for (const p of this.hits(x, z)) {
      if (Math.abs(p.d) > this.tr.barrier(p, p.d >= 0 ? 1 : -1) + pad) continue;
      const s = this.surfaceY(p);
      if (!(y <= s)) y = s;
    }
    return y;
  }

  /** il segmento verticale [y0,y1] in (x,z) ingombra la pista? */
  blocksPoint(x, y0, y1, z, pad = 0.3) {
    for (const p of this.hits(x, z)) {
      if (Math.abs(p.d) > this.tr.barrier(p, p.d >= 0 ? 1 : -1) + pad) continue;
      const g = this.tr.groundY(p);
      if (y1 > g + 0.15 && y0 < g + CLEAR_H) return true;
    }
    return false;
  }

  /** l'oggetto (geometria + matrice mondo) è lontano dalla pista? scarto veloce con la scatola */
  _far(geo, m, pad) {
    if (!geo.boundingBox) geo.computeBoundingBox();
    const b = this._box.copy(geo.boundingBox).applyMatrix4(m);
    const cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2;
    const r = Math.hypot(b.max.x - b.min.x, b.max.z - b.min.z) / 2;
    const tr = this.tr;
    for (const i of tr.near(cx, cz, r + 45)) {
      if (Math.hypot(tr.px[i] - cx, tr.pz[i] - cz) - r < Math.max(tr.L.barD[i], tr.R.barD[i]) + pad + 1) return false;
    }
    return true;
  }

  /** la geometria, messa con la matrice m, ingombra la pista? (campiona i triangoli ogni ~1 m) */
  blocksGeo(geo, m, pad = 0.3) {
    if (this._far(geo, m, pad)) return false;
    // scarto rapido: se nemmeno la scatola (impronta campionata, altezza piena) tocca la pista, è libero
    const b = this._box;
    let any = false;
    const nx = Math.min(30, Math.max(1, Math.ceil((b.max.x - b.min.x) / 1.5))), nz = Math.min(30, Math.max(1, Math.ceil((b.max.z - b.min.z) / 1.5)));
    for (let i = 0; i <= nx && !any; i++)
      for (let j = 0; j <= nz && !any; j++)
        if (this.blocksPoint(b.min.x + ((b.max.x - b.min.x) * i) / nx, b.min.y, b.max.y, b.min.z + ((b.max.z - b.min.z) * j) / nz, pad + 1.1)) any = true;
    if (!any) return false;
    const P = geo.attributes.position, I = geo.index;
    const nTri = I ? I.count / 3 : P.count / 3;
    const A = this._A, B = this._B, C = this._C;
    for (let t = 0; t < nTri; t++) {
      A.fromBufferAttribute(P, I ? I.getX(t * 3) : t * 3).applyMatrix4(m);
      B.fromBufferAttribute(P, I ? I.getX(t * 3 + 1) : t * 3 + 1).applyMatrix4(m);
      C.fromBufferAttribute(P, I ? I.getX(t * 3 + 2) : t * 3 + 2).applyMatrix4(m);
      const L = Math.max(A.distanceTo(B), B.distanceTo(C), C.distanceTo(A));
      const n = Math.min(40, Math.max(1, Math.ceil(L / 1.0)));
      for (let i = 0; i <= n; i++)
        for (let j = 0; j <= n - i; j++) {
          const u = i / n, w = j / n, s = 1 - u - w;
          const y = A.y * s + B.y * u + C.y * w;
          if (this.blocksPoint(A.x * s + B.x * u + C.x * w, y, y, A.z * s + B.z * u + C.z * w, pad)) return true;
        }
    }
    return false;
  }
}
