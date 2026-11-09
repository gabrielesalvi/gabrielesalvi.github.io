/**
 * Quanta carreggiata usa la traiettoria (centro dell'auto, metri dal bordo esterno del cordolo):
 * all'esterno delle curve (ingresso e uscita) tutta, all'interno sul cordolo con le ruote ma senza passarlo con l'auto
 * (l'IA taglia ancora un po' rispetto alla linea). cordolo = quota di cordolo usabile.
 */
export const LIMITI = { cordolo: 1, margine: 1.3, margineInterno: 1.6 };
// Provati e scartati il 07-11 (vedi STATO.md): rifinitura laplaciana (segue le corde, +10 s al giro), biarmonico pesato
// sugli apici e partenza da una linea «corta» (nessun effetto: il biarmonico converge sempre alla stessa linea).

// Traiettoria ideale (curvatura minima a "elastico") + profilo di velocità.

const G = 9.81;

export function buildRacingLine(track, spec) {
  const n = track.n, step = track.step;
  const off = new Float64Array(n);
  const limL = new Float64Array(n), limR = new Float64Array(n);
  // lato interno delle curve (curvatura > 1/300 m), allargato di ±20 m lungo la pista
  const intR = new Uint8Array(n), intL = new Uint8Array(n), R20 = Math.round(20 / step);
  for (let i = 0; i < n; i++) {
    const k = track.kappa[i];
    if (Math.abs(k) < 1 / 300) continue;
    for (let j = -R20; j <= R20; j++) { const q = (i + j + n) % n; if (k > 0) intR[q] = 1; else intL[q] = 1; }
  }
  for (let i = 0; i < n; i++) {
    const hw = track.w[i] / 2;
    limR[i] = hw + track.R.kerb[i] * LIMITI.cordolo - (intR[i] ? LIMITI.margineInterno : LIMITI.margine);
    limL[i] = hw + track.L.kerb[i] * LIMITI.cordolo - (intL[i] ? LIMITI.margineInterno : LIMITI.margine);
  }
  const px = track.px, pz = track.pz, nx = track.nx, nz = track.nz;
  const X = (i) => px[i] + nx[i] * off[i];
  const Z = (i) => pz[i] + nz[i] * off[i];
  // elastico multi-scala
  for (const k of [60, 40, 25, 14, 7]) {
    const K = Math.max(1, Math.round(k / step));
    const iters = 500;
    for (let it = 0; it < iters; it++) {
      for (let i = 0; i < n; i++) {
        // rilassamento biarmonico: minimizza la variazione di direzione (curvatura), non la lunghezza
        const a = (i - K + n) % n, b = (i + K) % n, a2 = (i - 2 * K + n) % n, b2 = (i + 2 * K) % n;
        const mx = (4 * (X(a) + X(b)) - X(a2) - X(b2)) / 6, mz = (4 * (Z(a) + Z(b)) - Z(a2) - Z(b2)) / 6;
        const want = (mx - px[i]) * nx[i] + (mz - pz[i]) * nz[i];
        let d = off[i] + (want - off[i]) * 0.6;
        if (d > limR[i]) d = limR[i];
        if (d < -limL[i]) d = -limL[i];
        off[i] = d;
      }
    }
  }
  // curvatura della traiettoria (cerchio per 3 punti a ±8 m)
  const kap = new Float64Array(n);
  const K = Math.max(2, Math.round(8 / step));
  for (let i = 0; i < n; i++) {
    const a = (i - K + n) % n, b = (i + K) % n;
    const ax = X(a), az = Z(a), bx = X(i), bz = Z(i), cx = X(b), cz = Z(b);
    const ab = Math.hypot(bx - ax, bz - az), bc = Math.hypot(cx - bx, cz - bz), ca = Math.hypot(ax - cx, az - cz);
    const cross = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
    kap[i] = (2 * cross) / Math.max(1e-6, ab * bc * ca);
  }
  // smussa un poco la curvatura (media su ±6 m)
  const ks = new Float64Array(n);
  const R = Math.max(1, Math.round(6 / step));
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (let k = -R; k <= R; k++) m += Math.abs(kap[(i + k + n) % n]);
    ks[i] = m / (2 * R + 1);
  }
  // distanza percorsa sulla traiettoria
  const ds = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    ds[i] = Math.hypot(X(j) - X(i), Z(j) - Z(i));
  }
  const prof = speedProfile(track, spec, ks, ds);
  // direzione della traiettoria (yaw) e curvatura con segno, smussata
  const yaw = new Float64Array(n), ksig = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = (i - 1 + n) % n, b = (i + 1) % n;
    yaw[i] = Math.atan2(Z(b) - Z(a), X(b) - X(a));
    let m = 0;
    for (let k = -R; k <= R; k++) m += kap[(i + k + n) % n];
    ksig[i] = m / (2 * R + 1);
  }
  return { off, kappa: ksig, v: prof, ds, limL, limR, yaw };
}

export function speedProfile(track, spec, kap, ds, muScale = 1) {
  const n = track.n, m = spec.mass;
  const mu = spec.mu * 0.9 * muScale, df = spec.df;
  const v = new Float64Array(n);
  // curvatura verticale (dossi <0, compressioni >0) su ±10 m
  const kv = new Float64Array(n);
  const KV = Math.max(2, Math.round(10 / track.step));
  for (let i = 0; i < n; i++) {
    const a = (i - KV + n) % n, b = (i + KV) % n, h = KV * track.step;
    kv[i] = (track.py[a] - 2 * track.py[i] + track.py[b]) / (h * h);
  }
  for (let i = 0; i < n; i++) {
    let kvm = 0;
    for (let k = -KV; k <= KV; k++) kvm = Math.min(kvm, kv[(i + k + n) % n]);
    const k = Math.abs(kap[i]);
    const den = m * k - mu * df - mu * m * kvm;
    let vm = den <= 0 ? 95 : Math.sqrt((mu * m * G) / den);
    // sui dossi non si decolla troppo: g efficace ≥ 0.45 g
    if (kvm < 0) vm = Math.min(vm, Math.sqrt((0.55 * G) / -kvm));
    // inclinazione trasversale aiuta un poco
    vm *= 1 + Math.abs(track.bank[i]) * 0.8;
    v[i] = Math.min(95, vm);
  }
  // indietro: frenata
  for (let pass = 0; pass < 2; pass++)
    for (let ii = n - 1; ii >= 0; ii--) {
      const i = ii, j = (i + 1) % n;
      const vj = v[j];
      const dec = mu * (G + (df * vj * vj) / m) * 0.86 + (spec.cd * vj * vj) / m;
      const lim = Math.sqrt(vj * vj + 2 * dec * ds[i]);
      if (v[i] > lim) v[i] = lim;
    }
  // avanti: accelerazione
  for (let pass = 0; pass < 2; pass++)
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const vi = Math.max(v[i], 5);
      const acc = Math.min(mu * G * 0.75, (spec.power * 0.8) / (m * vi)) - (spec.cd * vi * vi) / m - track.slope[i] * G;
      const lim = Math.sqrt(Math.max(0, vi * vi + 2 * Math.max(0.3, acc) * ds[i]));
      if (v[j] > lim) v[j] = lim;
    }
  return v;
}
