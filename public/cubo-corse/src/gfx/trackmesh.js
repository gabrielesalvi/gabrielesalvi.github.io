// Geometria della pista e del terreno: asfalto (con gommatura), cordoli a voxel, vie di fuga,
// barriere istanziate, terreno a colonne voxel, acqua, traguardo, corsia box.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SURF, BAR } from '../sim/track.js';
import { Clearance } from './clearance.js';
import { asphaltTextures, pixelTexture, fenceTexture, waterNormal, checkerTexture } from './textures.js';

const smoothstep = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
// rumore a valori (deterministico)
function hash2(x, z) {
  let h = (x * 374761393 + z * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash2(xi, zi), b = hash2(xi + 1, zi), c = hash2(xi, zi + 1), d = hash2(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(x, z, oct = 4) {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) { s += a * vnoise(x * f, z * f); n += a; a *= 0.5; f *= 2.03; }
  return s / n;
}

export class TrackWorld {
  /** track: Track; rl: traiettoria ideale (per la gommatura); quality: {terrainRange, terrainCell} */
  constructor(track, rl, quality = {}) {
    this.track = track;
    this.rl = rl;
    this.q = { terrainRange: 380, cell: 3, ...quality };
    this.group = new THREE.Group();
    this.group.name = 'pista';
    this.lights = []; // posizioni lampioni/torri (riempite dallo scenario)
    this.water = [];
    this._raster();
    this._road();
    this._lines();
    this._kerbs();
    this._runoff();
    this._barriers();
    this.clear = new Clearance(track);
    this._terrain();
    this._waterAndFar();
    this._startLine();
    this._pitLane();
  }

  // ------------------------------------------------------------ raster distanza/indice
  _raster() {
    const tr = this.track, b = tr.bounds;
    const M = this.q.terrainRange + 60;
    const R = (this.cellR = 3);
    this.rx0 = b.minx - M; this.rz0 = b.minz - M;
    this.rw = Math.ceil((b.maxx - b.minx + 2 * M) / R);
    this.rh = Math.ceil((b.maxz - b.minz + 2 * M) / R);
    const N = this.rw * this.rh;
    this.rIdx = new Int32Array(N).fill(-1);
    this.rDist = new Float32Array(N).fill(1e9);
    this.rSide = new Int8Array(N);
    const reach = M;
    for (let i = 0; i < tr.n; i++) {
      const px = tr.px[i], pz = tr.pz[i], nx = tr.nx[i], nz = tr.nz[i];
      for (let o = -reach; o <= reach; o += 1.5) {
        const x = px + nx * o, z = pz + nz * o;
        const cx = Math.floor((x - this.rx0) / R), cz = Math.floor((z - this.rz0) / R);
        if (cx < 0 || cz < 0 || cx >= this.rw || cz >= this.rh) continue;
        const k = cz * this.rw + cx;
        const ao = Math.abs(o);
        if (ao < this.rDist[k]) { this.rDist[k] = ao; this.rIdx[k] = i; this.rSide[k] = o >= 0 ? 1 : -1; }
      }
    }
  }
  _cell(x, z) {
    const cx = Math.floor((x - this.rx0) / this.cellR), cz = Math.floor((z - this.rz0) / this.cellR);
    if (cx < 0 || cz < 0 || cx >= this.rw || cz >= this.rh) return -1;
    return cz * this.rw + cx;
  }
  /** distanza dal centro pista e indice del campione più vicino */
  info(x, z) {
    const k = this._cell(x, z);
    if (k < 0 || this.rIdx[k] < 0) return { i: -1, dist: 1e9, side: 0 };
    return { i: this.rIdx[k], dist: this.rDist[k], side: this.rSide[k] };
  }
  /** spazio libero per lo scenario: oltre la barriera + margine */
  isFree(x, z, margin = 3) {
    const f = this.info(x, z);
    if (f.i < 0) return true;
    const E = f.side > 0 ? this.track.R : this.track.L;
    return f.dist > E.barD[f.i] + margin;
  }

  /** quota "naturale" del paesaggio lontano dalla pista */
  natural(x, z) {
    const id = this.track.id;
    if (id === 'colline') {
      const n = fbm(x / 420 + 3.1, z / 420 + 7.7, 4);
      const ridge = fbm(x / 160, z / 160, 3);
      let h = 4 + n * 48 + ridge * 8;
      // lago dentro la Curva del Lago
      const lx = -305 * 1.45, lz = 62 * 1.45;
      const d = Math.hypot((x - lx) / 1.3, z - lz);
      h -= 26 * (1 - smoothstep(40, 95, d));
      return h;
    }
    if (id === 'porto') {
      if (this.isSea(x, z)) return -7;
      let h = 2.2 + Math.max(0, (-z - 30) * 0.075) + fbm(x / 120, z / 120) * 4;
      // collina sopra la galleria
      const d = Math.hypot((x + 140) / 1.6, z + 205);
      h += 24 * (1 - smoothstep(30, 140, d));
      return h;
    }
    // monza: parco quasi piano
    return 4 + fbm(x / 300, z / 300, 3) * 10;
  }
  isSea(x, z) {
    if (this.track.id !== 'porto') return false;
    // mare a sud del lungomare, darsena fra le banchine a ovest
    return z > 14 + Math.sin(x / 90) * 3 || (x < -620 && z > -120);
  }

  heightAt(x, z) {
    const f = this.info(x, z);
    const nat = this.natural(x, z);
    if (f.i < 0) return nat;
    const tr = this.track;
    const E = f.side > 0 ? tr.R : tr.L;
    const bar = E.barD[f.i];
    const base = tr.py[f.i] - 0.3;
    const t = smoothstep(bar + 3, bar + 85, f.dist);
    if (this.track.id === 'porto' && this.isSea(x, z) && f.dist > bar + 2) return -7;
    return base + (nat - base) * t;
  }

  // ------------------------------------------------------------ asfalto
  _road() {
    const tr = this.track, n = tr.n, M = 10;
    const { albedo, rough } = asphaltTextures();
    this.asphalt = { albedo, rough };
    const pos = [], uv = [], col = [], idx = [];
    const rl = this.rl;
    for (let i = 0; i <= n; i++) {
      const k = i % n;
      const w = tr.w[k];
      const s = i * tr.step;
      // zone di frenata: dove la velocità ideale cala
      let brake = 0;
      if (rl) {
        const ahead = rl.v[(k + 15) % n];
        brake = Math.max(0, Math.min(1, (rl.v[k] - ahead) / 8));
      }
      for (let j = 0; j <= M; j++) {
        const d = -w / 2 + (j / M) * w;
        const x = tr.px[k] + tr.nx[k] * d, z = tr.pz[k] + tr.nz[k] * d;
        const y = tr.py[k] + d * Math.tan(tr.bank[k]) + 0.02;
        pos.push(x, y, z);
        uv.push(d / 8, s / 8);
        let c = 1;
        if (rl) {
          const g = Math.exp(-(((d - rl.off[k]) / 1.5) ** 2));
          c -= g * (0.16 + brake * 0.18);
        }
        c *= 0.94 + hash2(i >> 3, j) * 0.1;
        col.push(c, c, c);
      }
    }
    for (let i = 0; i < n; i++)
      for (let j = 0; j < M; j++) {
        const a = i * (M + 1) + j, b = a + M + 1;
        idx.push(a, a + 1, b, a + 1, b + 1, b);
      }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ map: albedo, roughnessMap: rough, vertexColors: true, roughness: 1, metalness: 0 });
    // asfalto bagnato: ruvidità ridotta, pozzanghere quasi a specchio
    this.wetU = { value: 0 };
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uWet = this.wetU;
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uWet;')
        .replace(
          '#include <roughnessmap_fragment>',
          `float roughnessFactor = roughness;
           vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );
           float puddle = smoothstep(0.25, 0.7, texelRoughness.b) * uWet;
           roughnessFactor *= mix(texelRoughness.g, 0.3, uWet * 0.75);
           roughnessFactor = mix(roughnessFactor, 0.04, puddle);`
        )
        .replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb *= 1.0 - uWet * 0.38 - 0.0;');
    };
    this.roadMat = mat;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.name = 'asfalto';
    this.group.add(mesh);
  }

  // strisce bianche di bordo
  _lines() {
    const tr = this.track, n = tr.n;
    const pos = [], idx = [];
    const lw = 0.22;
    let v = 0;
    for (const side of [-1, 1]) {
      for (let i = 0; i <= n; i++) {
        const k = i % n;
        const d0 = side * (tr.w[k] / 2 - 0.25), d1 = d0 - side * lw;
        for (const d of [d0, d1]) {
          const y = tr.py[k] + d * Math.tan(tr.bank[k]) + 0.035;
          pos.push(tr.px[k] + tr.nx[k] * d, y, tr.pz[k] + tr.nz[k] * d);
        }
        if (i < n) {
          const a = v + i * 2;
          if (side > 0) idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
          else idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
      }
      v += (n + 1) * 2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xe9e9e4, roughness: 0.6 }));
    m.receiveShadow = true;
    this.group.add(m);
  }

  // ------------------------------------------------------------ cordoli (blocchi voxel bianco-rossi)
  _kerbs() {
    const tr = this.track;
    const blocks = [];
    for (const [E, side] of [[tr.L, -1], [tr.R, 1]]) {
      for (let s = 0; s < tr.length; s += 1.0) {
        const i = Math.floor(s / tr.step) % tr.n;
        const kw = E.kerb[i];
        if (kw <= 0.05) continue;
        blocks.push({ s, side, kw, red: Math.floor(s / 1.0) % 2 === 0 });
      }
    }
    // geometria: due gradini (voxel a sega)
    const g1 = new THREE.BoxGeometry(1.0, 0.06, 1);
    g1.translate(0, 0.03, 0);
    const g2 = new THREE.BoxGeometry(1.0, 0.05, 0.5);
    g2.translate(0, 0.085, -0.25);
    const geo = mergeGeometries([g1, g2]);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0 });
    const im = new THREE.InstancedMesh(geo, mat, blocks.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const red = new THREE.Color(0xc4161c), white = new THREE.Color(0xf2f2ee), green = new THREE.Color(0x2f8f3f);
    const pt = {};
    blocks.forEach((b, k) => {
      const i = Math.floor(b.s / tr.step) % tr.n;
      const hw = tr.w[i] / 2;
      tr.pointAt(b.s + 0.5, b.side * (hw + b.kw / 2), pt);
      const y = tr.py[i] + b.side * hw * Math.tan(tr.bank[i]) - 0.01;
      p.set(pt.x, y, pt.z);
      // orientamento: x locale lungo la pista, z locale verso l'esterno (il gradino alto sta all'interno)
      q.setFromAxisAngle(up, -pt.yaw + (b.side > 0 ? 0 : Math.PI));
      sc.set(1, 1, b.kw);
      m4.compose(p, q, sc);
      im.setMatrixAt(k, m4);
      im.setColorAt(k, b.red ? red : (this.track.stile === 'citta' && b.s % 4 < 1 ? green : white));
    });
    im.receiveShadow = true;
    im.castShadow = false;
    this.group.add(im);
  }

  // ------------------------------------------------------------ vie di fuga
  _runoff() {
    const tr = this.track, n = tr.n;
    const kinds = { [SURF.GRASS]: 'erba', [SURF.GRAVEL]: 'ghiaia', [SURF.RUNOFF]: 'fuga', [SURF.SIDEWALK]: 'marciapiede' };
    const buf = {};
    for (const [E, side] of [[tr.L, -1], [tr.R, 1]]) {
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const type = E.run[i];
        const k = kinds[type] || 'erba';
        if (!buf[k]) buf[k] = { pos: [], uv: [], idx: [] };
        const B = buf[k];
        const quad = (iA, iB, a0, a1, b0, b1) => {
          const base = B.pos.length / 3;
          for (const [ii, d] of [[iA, a0], [iA, a1], [iB, b1], [iB, b0]]) {
            const x = tr.px[ii] + tr.nx[ii] * d * side, z = tr.pz[ii] + tr.nz[ii] * d * side;
            const yEdge = tr.py[ii] + side * (tr.w[ii] / 2) * Math.tan(tr.bank[ii]);
            const y = yEdge - (type === SURF.GRAVEL ? 0.06 : 0.02) - (d - tr.w[ii] / 2) * 0.004;
            B.pos.push(x, y, z);
            B.uv.push(x / 4, z / 4);
          }
          if (side > 0) B.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
          else B.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
        };
        const a0 = tr.w[i] / 2 + E.kerb[i] - 0.05, b0 = tr.w[j] / 2 + E.kerb[j] - 0.05;
        const a1 = E.barD[i] + 0.3, b1 = E.barD[j] + 0.3;
        quad(i, j, a0, a1, b0, b1);
      }
    }
    const rough = { erba: 0.95, ghiaia: 0.98, fuga: 0.82, marciapiede: 0.9 };
    for (const k in buf) {
      const B = buf[k];
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(B.pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(B.uv, 2));
      geo.setIndex(B.idx);
      geo.computeVertexNormals();
      const mat = new THREE.MeshStandardMaterial({ map: pixelTexture(k), roughness: rough[k] });
      if (k === 'fuga') mat.onBeforeCompile = (sh) => {
        sh.uniforms.uWet = this.wetU;
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uWet;')
          .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(roughness, 0.25, uWet);');
      };
      const m = new THREE.Mesh(geo, mat);
      m.receiveShadow = true;
      m.name = 'fuga-' + k;
      this.group.add(m);
    }
  }

  // ------------------------------------------------------------ barriere
  _barriers() {
    const tr = this.track;
    const segs = { wall: [], rail: [], post: [], tecpro: [], fence: [] };
    const city = tr.stile === 'citta';
    for (const [E, side] of [[tr.L, -1], [tr.R, 1]]) {
      const step = 2.0;
      for (let s = 0; s < tr.length; s += step) {
        const i = Math.floor(s / tr.step) % tr.n;
        const type = E.bar[i];
        const pt = tr.pointAt(s + step / 2, 0);
        const d = E.barD[i];
        const y = tr.py[i] + side * Math.min(d, tr.w[i] / 2) * Math.tan(tr.bank[i]) - 0.05;
        const rec = { s, side, d, y, yaw: pt.yaw, x: pt.x, z: pt.z, i };
        if (type === BAR.WALL) segs.wall.push(rec);
        else if (type === BAR.TECPRO) segs.tecpro.push(rec);
        else if (type === BAR.FENCE) { segs.wall.push({ ...rec, low: true }); segs.fence.push(rec); }
        else { segs.rail.push(rec); if (Math.round(s / step) % 1 === 0) segs.post.push(rec); }
      }
    }
    const tmp = new THREE.Object3D();
    const place = (im, list, thick, h, colorFn) => {
      list.forEach((r, k) => {
        const off = r.side * (r.d + thick / 2);
        const i = r.i;
        tmp.position.set(r.x + this.track.nx[i] * off, r.y + h / 2, r.z + this.track.nz[i] * off);
        tmp.rotation.set(0, -r.yaw, 0);
        tmp.updateMatrix();
        im.setMatrixAt(k, tmp.matrix);
        if (colorFn) im.setColorAt(k, colorFn(r, k));
      });
      im.castShadow = true;
      im.receiveShadow = true;
      this.group.add(im);
    };
    // muri in cemento (in città bianco/rosso alternato)
    if (segs.wall.length) {
      const H = city ? 1.15 : 1.0;
      const geo = new THREE.BoxGeometry(2.02, H, 0.5);
      const im = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.85 }), segs.wall.length);
      const c1 = new THREE.Color(0xe9e6df), c2 = new THREE.Color(0xc2272d), c3 = new THREE.Color(0xb7b3aa), c4 = new THREE.Color(0x1d5fa8);
      place(im, segs.wall, 0.5, H, (r, k) => (city ? (Math.floor(r.s / 6) % 2 ? c1 : c2) : r.low ? c3 : (Math.floor(r.s / 10) % 5 === 0 ? c4 : c1)));
    }
    if (segs.tecpro.length) {
      const geo = new THREE.BoxGeometry(1.9, 1.0, 1.0);
      const im = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.7 }), segs.tecpro.length);
      const r1 = new THREE.Color(0xd2232a), w1 = new THREE.Color(0xf2f2ee), b1 = new THREE.Color(0x1f4fa0);
      place(im, segs.tecpro, 1.0, 1.0, (r, k) => [r1, w1, r1, b1][Math.floor(r.s / 2) % 4]);
    }
    if (segs.rail.length) {
      const g1 = new THREE.BoxGeometry(2.04, 0.32, 0.06); g1.translate(0, 0.62, 0);
      const g2 = new THREE.BoxGeometry(2.04, 0.32, 0.06); g2.translate(0, 0.98, 0);
      const geo = mergeGeometries([g1, g2]);
      const im = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0xb9bec4, roughness: 0.35, metalness: 0.85 }), segs.rail.length);
      place(im, segs.rail, 0.1, 0, null);
      const pg = new THREE.BoxGeometry(0.12, 1.15, 0.12); pg.translate(0, 0.575, 0.08);
      const ip = new THREE.InstancedMesh(pg, new THREE.MeshStandardMaterial({ color: 0x7b8087, roughness: 0.5, metalness: 0.7 }), segs.post.length);
      place(ip, segs.post, 0.1, 0, null);
    }
    if (segs.fence.length) {
      const ft = fenceTexture();
      ft.repeat.set(2, 3);
      const geo = new THREE.PlaneGeometry(2.02, 3.0); geo.translate(0, 2.5, 0);
      const mat = new THREE.MeshStandardMaterial({ map: ft, alphaTest: 0.4, side: THREE.DoubleSide, metalness: 0.6, roughness: 0.5 });
      const im = new THREE.InstancedMesh(geo, mat, segs.fence.length);
      place(im, segs.fence, 0.5, 0, null);
      im.castShadow = false;
      const pg = new THREE.BoxGeometry(0.1, 3.6, 0.1); pg.translate(0, 1.8, 0);
      const posts = segs.fence.filter((r, k) => k % 2 === 0);
      const ip = new THREE.InstancedMesh(pg, new THREE.MeshStandardMaterial({ color: 0x5c6168, metalness: 0.7, roughness: 0.4 }), posts.length);
      place(ip, posts, 0.5, 0, null);
    }
  }

  // ------------------------------------------------------------ terreno a colonne voxel
  _terrain() {
    const R = this.q.cell;
    const tr = this.track, b = tr.bounds;
    const range = this.q.terrainRange;
    const x0 = Math.floor((b.minx - range) / R) * R, z0 = Math.floor((b.minz - range) / R) * R;
    const W = Math.ceil((b.maxx - b.minx + 2 * range) / R), H = Math.ceil((b.maxz - b.minz + 2 * range) / R);
    const STEP = 0.5;
    const hq = new Float32Array(W * H).fill(NaN);
    const biome = new Uint8Array(W * H);
    const porto = tr.id === 'porto', colline = tr.id === 'colline';
    for (let j = 0; j < H; j++)
      for (let i = 0; i < W; i++) {
        const x = x0 + (i + 0.5) * R, z = z0 + (j + 0.5) * R;
        const f = this.info(x, z);
        if (f.i < 0 || f.dist > range) continue;
        let h = this.heightAt(x, z);
        const E = f.side > 0 ? tr.R : tr.L;
        const near = f.dist < E.barD[f.i] + 2.5;
        if (!near) h = Math.round(h / STEP) * STEP;
        else h = Math.min(h, tr.py[f.i] - 0.12);
        // la colonna (larga R) deve restare sotto asfalto, cordoli e vie di fuga in tutta la sua impronta,
        // anche dove la strada è inclinata di lato o un altro tratto di pista passa vicino
        if (f.dist < Math.max(tr.L.barD[f.i], tr.R.barD[f.i]) + R + 25) {
          let fl = Infinity;
          for (const [ox, oz] of [[0, 0], [-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) {
            const y = this.clear.floorAt(x + ox * R, z + oz * R, 0.6);
            if (y < fl) fl = y;
          }
          if (fl < Infinity) h = Math.min(h, fl - 0.15);
        }
        hq[j * W + i] = h;
        // bioma: 0 erba, 1 erba secca, 2 terra (vigna), 3 lastricato, 4 sabbia, 5 scogli
        let bm = 0;
        const n = fbm(x / 60, z / 60, 2);
        if (porto) {
          if (this.isSea(x, z)) bm = 5;
          else if (z > 4) bm = 4;
          else bm = n > 0.62 ? 0 : 3;
        } else if (colline) {
          const vine = fbm(x / 140 + 9, z / 140 + 2, 2);
          bm = vine > 0.55 && f.dist > E.barD[f.i] + 25 ? 2 : n > 0.6 ? 1 : 0;
        } else bm = n > 0.66 ? 1 : 0;
        biome[j * W + i] = bm;
      }
    this.terrainGrid = { x0, z0, W, H, R, hq, biome };
    const tints = [
      [0.95, 1.0, 0.92], [1.18, 1.08, 0.72], [1.25, 0.95, 0.75], [1, 1, 1], [1.2, 1.12, 0.92], [0.55, 0.55, 0.58],
    ];
    const sideTint = [0.62, 0.48, 0.36];
    // costruisci per blocchi (frustum culling)
    const CH = Math.max(16, Math.floor(240 / R));
    const tex = porto ? pixelTexture('marciapiede') : pixelTexture('erba');
    const texDirt = pixelTexture('terra');
    const mat = new THREE.MeshStandardMaterial({ map: tex, vertexColors: true, roughness: 0.95 });
    const matSide = new THREE.MeshStandardMaterial({ map: texDirt, vertexColors: true, roughness: 0.95 });
    for (let cj = 0; cj < H; cj += CH)
      for (let ci = 0; ci < W; ci += CH) {
        const top = { pos: [], nor: [], col: [], uv: [], idx: [] };
        const sid = { pos: [], nor: [], col: [], uv: [], idx: [] };
        const quad = (B, p, nrm, c, uvs) => {
          const base = B.pos.length / 3;
          for (let k = 0; k < 4; k++) {
            B.pos.push(p[k][0], p[k][1], p[k][2]);
            B.nor.push(nrm[0], nrm[1], nrm[2]);
            B.col.push(c[0], c[1], c[2]);
            B.uv.push(uvs[k][0], uvs[k][1]);
          }
          B.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
        };
        for (let j = cj; j < Math.min(H, cj + CH); j++) {
          // corse orizzontali di celle uguali (greedy lungo x)
          let i = ci;
          const iEnd = Math.min(W, ci + CH);
          while (i < iEnd) {
            const k = j * W + i;
            const h = hq[k];
            if (Number.isNaN(h)) { i++; continue; }
            const bm = biome[k];
            let run = 1;
            while (i + run < iEnd && hq[k + run] === h && biome[k + run] === bm && !Number.isNaN(hq[k + run])) run++;
            const xa = x0 + i * R, xb = x0 + (i + run) * R, za = z0 + j * R, zb = za + R;
            const t = tints[bm];
            const jit = 0.94 + hash2(i, j) * 0.1;
            quad(top, [[xa, h, za], [xa, h, zb], [xb, h, zb], [xb, h, za]], [0, 1, 0], [t[0] * jit, t[1] * jit, t[2] * jit],
              [[xa / 8, za / 8], [xa / 8, zb / 8], [xb / 8, zb / 8], [xb / 8, za / 8]]);
            i += run;
          }
          // facce laterali dove il vicino è più basso
          for (let ii = ci; ii < iEnd; ii++) {
            const k = j * W + ii;
            const h = hq[k];
            if (Number.isNaN(h)) continue;
            const xa = x0 + ii * R, xb = xa + R, za = z0 + j * R, zb = za + R;
            const nb = [
              [ii + 1, j, [1, 0, 0], [[xb, 0, zb], [xb, 0, za]]],
              [ii - 1, j, [-1, 0, 0], [[xa, 0, za], [xa, 0, zb]]],
              [ii, j + 1, [0, 0, 1], [[xa, 0, zb], [xb, 0, zb]]],
              [ii, j - 1, [0, 0, -1], [[xb, 0, za], [xa, 0, za]]],
            ];
            for (const [ni, nj, nrm, e] of nb) {
              let hn = ni >= 0 && nj >= 0 && ni < W && nj < H ? hq[nj * W + ni] : NaN;
              if (Number.isNaN(hn)) hn = h - 3;
              if (hn >= h - 0.01) continue;
              const st = biome[k] === 5 || biome[k] === 3 ? [0.7, 0.68, 0.64] : sideTint;
              const [a, bb] = e;
              const L = Math.hypot(bb[0] - a[0], bb[2] - a[2]);
              quad(sid, [[a[0], h, a[2]], [a[0], hn, a[2]], [bb[0], hn, bb[2]], [bb[0], h, bb[2]]], nrm, st,
                [[0, h / 4], [0, hn / 4], [L / 4, hn / 4], [L / 4, h / 4]]);
            }
          }
        }
        for (const [B, m] of [[top, mat], [sid, matSide]]) {
          if (!B.idx.length) continue;
          const geo = new THREE.BufferGeometry();
          geo.setAttribute('position', new THREE.Float32BufferAttribute(B.pos, 3));
          geo.setAttribute('normal', new THREE.Float32BufferAttribute(B.nor, 3));
          geo.setAttribute('color', new THREE.Float32BufferAttribute(B.col, 3));
          geo.setAttribute('uv', new THREE.Float32BufferAttribute(B.uv, 2));
          geo.setIndex(B.idx);
          geo.computeBoundingSphere();
          const mesh = new THREE.Mesh(geo, m);
          mesh.receiveShadow = true;
          mesh.castShadow = m === matSide;
          mesh.name = 'terreno';
          this.group.add(mesh);
        }
      }
  }

  // ------------------------------------------------------------ acqua e piano lontano
  _waterAndFar() {
    const tr = this.track, b = tr.bounds;
    const cx = (b.minx + b.maxx) / 2, cz = (b.minz + b.maxz) / 2;
    // piano lontano (sotto il terreno, coperto dalla nebbia)
    const farY = tr.id === 'porto' ? -7.5 : Math.min(...tr.py) - 1.5;
    const far = new THREE.Mesh(new THREE.PlaneGeometry(14000, 14000), new THREE.MeshStandardMaterial({ map: (() => { const t = pixelTexture(tr.id === 'porto' ? 'sabbia' : 'erba'); t.repeat.set(1400, 1400); return t; })(), roughness: 1, color: tr.id === 'colline' ? 0xb8c49a : 0xa8b890 }));
    far.rotation.x = -Math.PI / 2;
    far.position.set(cx, farY, cz);
    far.receiveShadow = false;
    far.name = 'lontano';
    this.group.add(far);
    const wn = waterNormal();
    wn.repeat.set(60, 60);
    this.waterNormal = wn;
    const waterMat = new THREE.MeshPhysicalMaterial({ color: 0x0b3a52, roughness: 0.06, metalness: 0.0, normalMap: wn, normalScale: new THREE.Vector2(0.35, 0.35), clearcoat: 1, clearcoatRoughness: 0.08 });
    if (tr.id === 'porto') {
      const sea = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), waterMat);
      sea.rotation.x = -Math.PI / 2;
      sea.position.set(cx, 0.15, cz + 1500);
      sea.receiveShadow = true;
      this.group.add(sea);
      this.water.push(sea);
    }
    if (tr.id === 'colline') {
      const lake = new THREE.Mesh(new THREE.CircleGeometry(115, 48), waterMat.clone());
      lake.material.color.set(0x23475a);
      lake.rotation.x = -Math.PI / 2;
      lake.position.set(-305 * 1.45, 9.2, 62 * 1.45);
      this.group.add(lake);
      this.water.push(lake);
    }
  }

  // ------------------------------------------------------------ traguardo e griglia
  _startLine() {
    const tr = this.track;
    const pt = tr.pointAt(tr.startS, 0);
    const i = pt.i;
    const w = tr.w[i];
    const tex = checkerTexture();
    tex.repeat.set(1, 1);
    const geo = new THREE.PlaneGeometry(1.6, w);
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 }));
    m.rotation.set(-Math.PI / 2, 0, -pt.yaw + Math.PI / 2, 'XYZ');
    m.rotation.order = 'YXZ';
    m.rotation.set(-Math.PI / 2, -pt.yaw, 0);
    m.position.set(pt.x, pt.y + 0.045, pt.z);
    m.receiveShadow = true;
    this.group.add(m);
    // piazzole della griglia
    const lineMat = new THREE.MeshStandardMaterial({ color: 0xf2f2f0, roughness: 0.6 });
    for (let slot = 0; slot < 10; slot++) {
      const dist = -(7 + slot * 8.5) + 2.6;
      const d = (slot % 2 ? 1 : -1) * w * 0.22;
      const p = tr.pointAt(tr.startS + dist, d);
      const bar = new THREE.Mesh(new THREE.PlaneGeometry(0.25, 2.6), lineMat);
      bar.rotation.set(-Math.PI / 2, 0, 0);
      const holder = new THREE.Group();
      holder.add(bar);
      holder.position.set(p.x, p.y + 0.045, p.z);
      holder.rotation.y = -p.yaw;
      bar.rotation.z = 0;
      this.group.add(holder);
    }
  }

  /** corsia box dalla geometria di Track.pit: muretto (cemento + rete) e linee bianche dei bordi corsia */
  _pitLane() {
    const tr = this.track, P = tr.pit;
    if (!P) return;
    const E = P.E, side = E === tr.R ? 1 : -1, step = 2;
    const wall = [], lines = { pos: [], idx: [] };
    const yAt = (i, d) => tr.py[i] + side * (tr.w[i] / 2) * Math.tan(tr.bank[i]) - 0.02 - (d - tr.w[i] / 2) * 0.004;
    for (let s = 0; s < tr.length; s += step) {
      const i = Math.floor(s / tr.step) % tr.n;
      if (!E.pitC[i]) continue;
      const pt = tr.pointAt(s + step / 2, 0);
      if (E.isl0[i] > 0) {
        const dm = (E.isl0[i] + E.isl1[i]) / 2;
        wall.push({ x: pt.x + tr.nx[i] * side * dm, z: pt.z + tr.nz[i] * side * dm, y: yAt(i, dm), yaw: pt.yaw, s });
      }
    }
    // linee bianche: bordo interno ed esterno della corsia
    const c = E.pitC;
    for (const edge of [-1, 1]) {
      let prev = -1;
      for (let i = 0; i < tr.n; i++) {
        if (!c[i]) { prev = -1; continue; }
        const d = c[i] + edge * (P.w / 2 - 0.2);
        if (d < tr.w[i] / 2 + E.kerb[i] + 0.3) { prev = -1; continue; } // nei raccordi la linea interna comincia dopo il cordolo
        const base = lines.pos.length / 3;
        for (const o of [-0.08, 0.08]) {
          const dd = side * (d + o);
          lines.pos.push(tr.px[i] + tr.nx[i] * dd, yAt(i, d) + 0.025, tr.pz[i] + tr.nz[i] * dd);
        }
        if (prev >= 0) lines.idx.push(prev, base, prev + 1, prev + 1, base, base + 1);
        prev = base;
      }
    }
    if (lines.idx.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(lines.pos, 3));
      geo.setIndex(lines.idx);
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.6, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4 }));
      m.receiveShadow = true;
      m.name = 'corsia-linee';
      this.group.add(m);
    }
    if (wall.length) {
      const tmp = new THREE.Object3D();
      const cg = new THREE.BoxGeometry(2.02, 1.05, 0.8); cg.translate(0, 0.52, 0);
      const im = new THREE.InstancedMesh(cg, new THREE.MeshStandardMaterial({ roughness: 0.85 }), wall.length);
      const bianco = new THREE.Color(0xe9e6df), blu = new THREE.Color(0x1d5fa8);
      const ft = fenceTexture(); ft.repeat.set(2, 3);
      const fg = new THREE.PlaneGeometry(2.02, 2.6); fg.translate(0, 1.05 + 1.3, 0);
      const fm = new THREE.InstancedMesh(fg, new THREE.MeshStandardMaterial({ map: ft, alphaTest: 0.4, side: THREE.DoubleSide, metalness: 0.6, roughness: 0.5 }), wall.length);
      wall.forEach((w, k) => {
        tmp.position.set(w.x, w.y, w.z); tmp.rotation.set(0, -w.yaw, 0); tmp.updateMatrix();
        im.setMatrixAt(k, tmp.matrix); fm.setMatrixAt(k, tmp.matrix);
        im.setColorAt(k, Math.floor(w.s / 10) % 4 === 0 ? blu : bianco);
      });
      im.castShadow = true; im.receiveShadow = true; im.name = 'muretto-box';
      fm.name = 'muretto-box-rete';
      this.group.add(im, fm);
    }
  }

  _pitLaneMonza() {
    const box = this.track.def.json.box;
    if (!box || box.length < 2) return;
    const pos = [], idx = [];
    const W = 12;
    for (let k = 0; k < box.length; k++) {
      const a = box[Math.max(0, k - 1)], b = box[Math.min(box.length - 1, k + 1)];
      let tx = b[0] - a[0], tz = b[1] - a[1];
      const l = Math.hypot(tx, tz) || 1;
      tx /= l; tz /= l;
      const nx = -tz, nz = tx;
      const f = this.info(box[k][0], box[k][1]);
      const y = (f.i >= 0 ? this.track.py[f.i] : 0) - 0.02;
      for (const d of [-W / 2, W / 2]) pos.push(box[k][0] + nx * d, y, box[k][1] + nz * d);
      if (k < box.length - 1) {
        const v = k * 2;
        idx.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    // la normale potrebbe puntare in basso: forziamo double side
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: this.asphalt.albedo, roughness: 0.9, side: THREE.DoubleSide, color: 0xd0d0d0 }));
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  update(dt, t) {
    if (this.waterNormal) {
      this.waterNormal.offset.x = t * 0.004;
      this.waterNormal.offset.y = t * 0.0025;
    }
  }
}
