// Spline Catmull-Rom centripeta chiusa + ricampionamento a passo costante.
// Punti di controllo: {x, y, z, w?, bank?}  (x = est, z = sud, y = quota; metri)

function cr1(p0, p1, p2, p3, t, t0, t1, t2, t3) {
  const a1 = ((t1 - t) / (t1 - t0)) * p0 + ((t - t0) / (t1 - t0)) * p1;
  const a2 = ((t2 - t) / (t2 - t1)) * p1 + ((t - t1) / (t2 - t1)) * p2;
  const a3 = ((t3 - t) / (t3 - t2)) * p2 + ((t - t2) / (t3 - t2)) * p3;
  const b1 = ((t2 - t) / (t2 - t0)) * a1 + ((t - t0) / (t2 - t0)) * a2;
  const b2 = ((t3 - t) / (t3 - t1)) * a2 + ((t - t1) / (t3 - t1)) * a3;
  return ((t2 - t) / (t2 - t1)) * b1 + ((t - t1) / (t2 - t1)) * b2;
}

const KEYS = ['x', 'y', 'z', 'w', 'bank'];

/** Restituisce una polilinea densa (chiusa) dai punti di controllo. */
export function catmullRomClosed(ctrl, sub = 24) {
  const n = ctrl.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const P = [ctrl[(i - 1 + n) % n], ctrl[i], ctrl[(i + 1) % n], ctrl[(i + 2) % n]];
    const ts = [0];
    for (let k = 1; k < 4; k++) {
      const d = Math.hypot(P[k].x - P[k - 1].x, P[k].z - P[k - 1].z, (P[k].y || 0) - (P[k - 1].y || 0));
      ts.push(ts[k - 1] + Math.max(Math.sqrt(d), 1e-3));
    }
    for (let j = 0; j < sub; j++) {
      const t = ts[1] + ((ts[2] - ts[1]) * j) / sub;
      const o = {};
      for (const key of KEYS) {
        const v = P.map((p) => p[key] ?? (key === 'w' ? 12 : 0));
        // y, w e bank interpolati in modo morbido (Hermite sui due punti centrali) per non avere sovraelongazioni
        if (key === 'x' || key === 'z') o[key] = cr1(v[0], v[1], v[2], v[3], t, ts[0], ts[1], ts[2], ts[3]);
        else {
          const u = j / sub;
          const s = u * u * (3 - 2 * u);
          o[key] = v[1] + (v[2] - v[1]) * s;
        }
      }
      out.push(o);
    }
  }
  return out;
}

/** Ricampiona una polilinea chiusa a passo `step` (metri, misurati in pianta). */
export function resampleClosed(pts, step = 2) {
  const n = pts.length;
  const seg = new Float64Array(n);
  let total = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    seg[i] = Math.hypot(b.x - a.x, b.z - a.z);
    total += seg[i];
  }
  const m = Math.max(8, Math.round(total / step));
  const out = [];
  let i = 0, acc = 0;
  for (let k = 0; k < m; k++) {
    const s = (k * total) / m;
    while (i < n - 1 && acc + seg[i] < s) { acc += seg[i]; i++; }
    const t = seg[i] > 0 ? Math.min(1, Math.max(0, (s - acc) / seg[i])) : 0;
    const a = pts[i], b = pts[(i + 1) % n];
    const o = {};
    for (const key of KEYS) o[key] = (a[key] ?? 0) + ((b[key] ?? 0) - (a[key] ?? 0)) * t;
    out.push(o);
  }
  return { pts: out, length: total };
}

/** Media mobile gaussiana circolare su un array di numeri. */
export function smoothClosed(vals, sigma) {
  const n = vals.length;
  const r = Math.ceil(sigma * 3);
  const w = [];
  for (let k = -r; k <= r; k++) w.push(Math.exp(-(k * k) / (2 * sigma * sigma)));
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let a = 0, ws = 0;
    for (let k = -r; k <= r; k++) {
      const j = (((i + k) % n) + n) % n;
      a += vals[j] * w[k + r];
      ws += w[k + r];
    }
    out[i] = a / ws;
  }
  return out;
}
