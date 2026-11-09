// Traiettoria ideale disegnata sull'asfalto: nastro tratteggiato colorato dal profilo di velocità
// (verde = gas, giallo = rilascio, rosso = frenata). Si accende e spegne con mesh.visible.
import * as THREE from 'three';

export function racingLineMesh(track, rl) {
  const n = track.n, ds = track.step;
  const W = 0.7;          // larghezza del nastro (m)
  const DASH = 3, GAP = 1.4; // tratteggio (m)
  const pos = [], col = [], idx = [];
  const verde = new THREE.Color(0x35e06b), giallo = new THREE.Color(0xffd23f), rosso = new THREE.Color(0xff3b2f), c = new THREE.Color();
  // accelerazione longitudinale prevista (m/s²) fra un campione e il successivo, guardando 20 m avanti
  const acc = new Float32Array(n);
  const ahead = Math.max(1, Math.round(20 / ds));
  for (let i = 0; i < n; i++) {
    const v0 = rl.v[i], v1 = rl.v[(i + ahead) % n];
    acc[i] = (v1 * v1 - v0 * v0) / (2 * ahead * ds);
  }
  const p = {};
  let s = 0;
  const L = track.length;
  while (s < L) {
    const s1 = Math.min(L, s + DASH);
    const base = pos.length / 3;
    let k = 0;
    for (let q = s; q <= s1 + 1e-6; q += 0.75, k++) {
      const i = Math.floor(q / ds) % n;
      const off = rl.off[i] + (rl.off[(i + 1) % n] - rl.off[i]) * ((q / ds) % 1);
      for (const side of [-1, 1]) {
        track.pointAt(q, off + (side * W) / 2, p);
        pos.push(p.x, p.y + 0.045, p.z);
      }
      const a = acc[i];
      if (a < -3) c.copy(rosso);
      else if (a < 0.5) c.copy(giallo).lerp(rosso, Math.max(0, Math.min(1, (-a - 0.5) / 2.5)));
      else c.copy(verde);
      col.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
    for (let j = 0; j < k - 1; j++) {
      const a = base + j * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    s += DASH + GAP;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.62, depthWrite: false, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8, toneMapped: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'traiettoria';
  mesh.renderOrder = 2;
  mesh.frustumCulled = false;
  return mesh;
}
