// Scenario dei tre circuiti: posiziona i modelli voxel (props.js) attorno alla pista.
import * as THREE from 'three';
import { meshGrid, voxelMaterials, MAT, VoxelGrid } from './voxel.js';
import { Crowd } from './crowd.js';
import { fbm } from './trackmesh.js';

function mulberry(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

/** geometria (con gruppi per materiale) da un risultato di props */
function geoOf(res) {
  if (!res.geo) res.geo = meshGrid(res.grid, { scale: res.scale, origin: res.origin });
  return res.geo;
}

/** spazio libero della pista in costruzione (Clearance di trackmesh), usato da Batcher e instanced() */
let CLEAR = null;
const _gm = new THREE.Matrix4();

/** Lato dei riquadri in cui si divide lo scenario: la scheda video scarta i riquadri fuori inquadratura. */
const TILE = 240;
const tileKey = (x, z, size = TILE) => Math.floor(x / size) + ',' + Math.floor(z / size);

/**
 * Unisce tante geometrie voxel (con gruppi per materiale) in poche mesh, una per riquadro di TILE metri,
 * ciascuna con un gruppo per materiale. Una mesh unica per tutta la pista verrebbe disegnata sempre per intero.
 */
class Batcher {
  constructor() {
    this.tiles = new Map();
    this.v = new THREE.Vector3();
    this.n = new THREE.Vector3();
    this.nm = new THREE.Matrix3();
    this.count = 0;
  }
  _tile(key) {
    let t = this.tiles.get(key);
    if (!t) {
      t = [];
      for (let m = 0; m < 9; m++) t.push({ pos: [], nor: [], col: [] });
      this.tiles.set(key, t);
    }
    return t;
  }
  /** aggiunge l'oggetto se non ingombra la pista; ritorna false se scartato */
  add(geo, matrix, guard = true) {
    if (guard && CLEAR && CLEAR.blocksGeo(geo, matrix)) { CLEAR.rejected++; return false; }
    const P = geo.attributes.position.array, N = geo.attributes.normal.array, C = geo.attributes.color.array, I = geo.index.array;
    this.nm.getNormalMatrix(matrix);
    const per = this._tile(tileKey(matrix.elements[12], matrix.elements[14]));
    for (const g of geo.groups) {
      const out = per[g.materialIndex];
      for (let k = g.start; k < g.start + g.count; k++) {
        const i = I[k];
        this.v.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]).applyMatrix4(matrix);
        this.n.set(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]).applyMatrix3(this.nm).normalize();
        out.pos.push(this.v.x, this.v.y, this.v.z);
        out.nor.push(this.n.x, this.n.y, this.n.z);
        out.col.push(C[i * 3], C[i * 3 + 1], C[i * 3 + 2]);
      }
    }
    this.count++;
    return true;
  }
  build(castShadow = true) {
    const out = new THREE.Group();
    for (const per of this.tiles.values()) {
      let total = 0;
      for (const p of per) total += p.pos.length;
      if (!total) continue;
      const pos = new Float32Array(total), nor = new Float32Array(total), col = new Float32Array(total);
      const geo = new THREE.BufferGeometry();
      let o = 0;
      per.forEach((p, m) => {
        if (!p.pos.length) return;
        pos.set(p.pos, o); nor.set(p.nor, o); col.set(p.col, o);
        geo.addGroup(o / 3, p.pos.length / 3, m);
        o += p.pos.length;
      });
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, voxelMaterials().list);
      mesh.castShadow = castShadow;
      mesh.receiveShadow = true;
      mesh.name = 'edifici-uniti';
      out.add(mesh);
    }
    this.tiles.clear();
    return out.children.length ? out : null;
  }
}

/** divide una lista di oggetti {x,z,…} per riquadro */
function byTile(list, size = TILE) {
  const m = new Map();
  for (const t of list) {
    const k = tileKey(t.x, t.z, size);
    let a = m.get(k);
    if (!a) m.set(k, (a = []));
    a.push(t);
  }
  return [...m.values()];
}

/**
 * istanze di una stessa geometria voxel, una InstancedMesh per riquadro (così ognuna ha una sfera
 * d'ingombro piccola e viene scartata quando è fuori inquadratura o fuori dal cono d'ombra).
 * t.c (THREE.Color, facoltativo) = colore per istanza.
 */
function instanced(geo, mats, list, castShadow = true, opts = {}) {
  const o = new THREE.Object3D();
  if (CLEAR && opts.guard !== false) {
    list = list.filter((t) => {
      o.position.set(t.x, t.y, t.z); o.rotation.set(0, t.yaw || 0, 0); o.scale.setScalar(t.s || 1); o.updateMatrix();
      if (!CLEAR.blocksGeo(geo, o.matrix)) return true;
      CLEAR.rejected++;
      return false;
    });
  }
  if (!list.length) return null;
  const out = new THREE.Group();
  for (const part of byTile(list, opts.tile || 360)) {
    const im = new THREE.InstancedMesh(geo, mats, part.length);
    part.forEach((t, k) => {
      o.position.set(t.x, t.y, t.z);
      o.rotation.set(0, t.yaw || 0, 0);
      o.scale.setScalar(t.s || 1);
      o.updateMatrix();
      im.setMatrixAt(k, o.matrix);
      if (t.c) im.setColorAt(k, t.c);
    });
    im.castShadow = castShadow;
    im.receiveShadow = true;
    im.name = opts.name || 'istanze';
    im.computeBoundingSphere();
    if (opts.maxDist) { im.userData.maxDist = opts.maxDist; distCulled.push(im); }
    out.add(im);
  }
  return out;
}

/** oggetti spenti oltre una certa distanza dalla telecamera (dettagli piccoli: viti, …) */
const distCulled = [];
function distCull(v) {
  for (const im of distCulled) {
    const c = im.boundingSphere.center;
    im.visible = Math.hypot(c.x - v.x, c.z - v.z) - im.boundingSphere.radius < im.userData.maxDist;
  }
}

const M4 = (x, y, z, yaw, s = 1) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(s, s, s));

/** yaw perché il fronte del modello (che guarda -z) guardi verso il punto (tx,tz) */
function faceYaw(x, z, tx, tz) {
  // il fronte locale -z dopo una rotazione yaw punta verso (-sin yaw, -cos yaw)
  return Math.atan2(-(tx - x), -(tz - z));
}

/** modelli di riserva (se props.js manca o una funzione non c'è) */
function fallbackProps() {
  const g = (nx, ny, nz, fill) => { const v = new VoxelGrid(nx, ny, nz); fill(v); return v; };
  const res = (grid, scale) => ({ grid, scale, origin: [grid.nx / 2, 0, grid.nz / 2] });
  return {
    palazzo: (rnd, o = {}) => {
      const w = Math.round((o.larghezza || 12) / 1), d = Math.round((o.profondita || 10) / 1), h = (o.piani || 4) * 3;
      const cols = [0xd9b26f, 0xd98c6c, 0xe8d28a, 0xc7704e, 0xeadbc0];
      return res(g(w, h + 1, d, (v) => {
        v.box(0, 0, 0, w, h, d, v.p(cols[Math.floor(rnd() * cols.length)]));
        v.box(0, h, 0, w, h + 1, d, v.p(0xa0522d));
        const win = v.p(0x1a2630, MAT.GLASS), lit = v.p(0xffd9a0, MAT.NIGHT);
        for (let y = 2; y < h; y += 3) for (let x = 1; x < w - 1; x += 2) v.set(x, y, 0, rnd() < 0.3 ? lit : win);
      }), 1);
    },
    tribuna: (rnd, o = {}) => {
      const L = Math.round(o.lunghezza || 40), F = o.file || 10;
      const r = res(g(L, F + 4, F + 2, (v) => {
        for (let k = 0; k < F; k++) v.box(0, 0, k, L, k + 1, k + 1, v.p(0x9a9a96));
        v.box(0, F + 3, 0, L, F + 4, F + 2, v.p(0xdddddd, MAT.METAL));
      }), 1);
      r.extra = { posti: [] };
      for (let k = 0; k < F; k++) for (let x = 0.5; x < L; x += 0.8) r.extra.posti.push({ x: x - L / 2, y: k + 1, z: k + 0.5 - (F + 2) / 2 });
      return r;
    },
    albero: (rnd, tipo) => res(g(5, 12, 5, (v) => {
      v.box(2, 0, 2, 3, tipo === 'palma' ? 10 : 4, 3, v.p(0x5a4330));
      if (tipo === 'cipresso') v.box(1, 2, 1, 4, 12, 4, v.p(0x2e4a26, MAT.FOLIAGE));
      else v.box(0, tipo === 'palma' ? 9 : 4, 0, 5, tipo === 'palma' ? 11 : 9, 5, v.p(0x4a7a36, MAT.FOLIAGE));
    }), 0.6),
    filare: (rnd) => res(g(24, 6, 2, (v) => { v.box(0, 0, 0, 24, 5, 2, v.p(0x557a2e, MAT.FOLIAGE)); }), 0.25),
    yacht: (rnd, o = {}) => res(g(Math.round((o.lunghezza || 14) * 2), 6, 8, (v) => { v.box(0, 0, 0, v.nx, 3, 8, v.p(0xf4f4f0, MAT.PAINT)); v.box(4, 3, 2, v.nx - 6, 5, 6, v.p(0x22303a, MAT.GLASS)); }), 0.5),
    barca: (rnd) => res(g(12, 3, 4, (v) => v.box(0, 0, 0, 12, 2, 4, v.p(0x8a5a32))), 0.5),
    faro: (rnd) => { const r = res(g(5, 44, 5, (v) => { for (let y = 0; y < 40; y++) v.box(0, y, 0, 5, y + 1, 5, v.p(Math.floor(y / 5) % 2 ? 0xc62828 : 0xf2f2f2)); v.box(1, 40, 1, 4, 43, 4, v.p(0xfff2c0, MAT.LIGHT)); }), 0.5); r.extra = { luce: { x: 0, y: 21, z: 0 } }; return r; },
    casale: (rnd) => res(g(14, 8, 10, (v) => { v.box(0, 0, 0, 14, 6, 10, v.p(0xc9a77a)); v.box(0, 6, 0, 14, 8, 10, v.p(0xa0522d)); }), 1),
  };
}

export async function buildScenery(track, world, q, progress = () => {}) {
  distCulled.length = 0;
  CLEAR = world.clear || null;
  if (CLEAR) CLEAR.rejected = 0;
  let P = {};
  try { P = { ...(await import('./props.js')) }; } catch (e) { console.warn('props.js non disponibile, uso modelli di riserva', e); }
  const FB = fallbackProps();
  for (const k in FB) if (typeof P[k] !== 'function') P[k] = FB[k];
  const group = new THREE.Group();
  group.name = 'scenario';
  const rnd = mulberry(track.length | 0);
  const lamps = [];
  const seats = [];
  const stands = [];
  const tunnels = [];
  const mats = voxelMaterials().list;
  const occ = new Set();
  const occKey = (x, z) => `${Math.floor(x / 6)},${Math.floor(z / 6)}`;
  const occupy = (x, z, r) => {
    for (let dx = -r; dx <= r; dx += 6) for (let dz = -r; dz <= r; dz += 6) occ.add(occKey(x + dx, z + dz));
  };
  const isOcc = (x, z, r) => {
    for (let dx = -r; dx <= r; dx += 6) for (let dz = -r; dz <= r; dz += 6) if (occ.has(occKey(x + dx, z + dz))) return true;
    return false;
  };
  const free = (x, z, r, margin = 3) => {
    if (isOcc(x, z, r)) return false;
    for (const [dx, dz] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) if (!world.isFree(x + dx, z + dz, margin) || world.isSea(x + dx, z + dz)) return false;
    return true;
  };
  const H = (x, z) => world.heightAt(x, z);
  // coperture: celle di COV metri → quota della parte bassa del tetto
  const COV = 2, cover = new Map();
  /** rettangolo coperto: centro, direzione del lato lungo (yaw come M4: lato lungo = x locale), lunghezze, quota del tetto */
  const addCover = (cx, cz, yaw, lx, lz, roofY) => {
    const ax = Math.cos(yaw), az = -Math.sin(yaw), bx = Math.sin(yaw), bz = Math.cos(yaw);
    for (let u = -lx / 2; u <= lx / 2; u += COV / 2)
      for (let w = -lz / 2; w <= lz / 2; w += COV / 2) {
        const x = cx + ax * u + bx * w, z = cz + az * u + bz * w;
        const k = Math.floor(x / COV) * 100003 + Math.floor(z / COV);
        const old = cover.get(k);
        if (old === undefined || roofY < old) cover.set(k, roofY);
      }
  };

  // ---------------------------------------------------------- tribune + pubblico
  const addStand = (x, z, yaw, len, rows, batch) => {
    const st = P.tribuna(rnd, { lunghezza: len, file: rows });
    // se ingombra la pista (curva, via di fuga larga, altro tratto vicino) la allontano a passi di 3 m
    const ax = Math.sin(yaw), az = Math.cos(yaw); // dal fronte verso il retro, cioè via dalla pista
    let ok = false;
    for (let k = 0; k < 14; k++) {
      if (!CLEAR || !CLEAR.blocksGeo(geoOf(st), M4(x, H(x, z), z, yaw))) { ok = true; break; }
      x += ax * 3; z += az * 3;
    }
    if (!ok) { CLEAR.rejected++; return; }
    const y = H(x, z);
    batch.add(geoOf(st), M4(x, y, z, yaw), false);
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    let k = 0;
    for (const p of st.extra?.posti || []) {
      // rotazione attorno a y
      const wx = x + p.x * cy + p.z * sy, wz = z - p.x * sy + p.z * cy;
      seats.push({ x: wx, y: y + p.y, z: wz, yaw, seat: stands.length * 400 + k++ });
    }
    stands.push({ x, z, len });
    occupy(x, z, len / 2 + 6);
  };
  /** tribuna lungo la pista a distanza s, lato side, fronte verso la pista */
  const standAlong = (s, side, len, rows, batch, extra = 6) => {
    const i = Math.floor(track.wrapS(s) / track.step) % track.n;
    const E = side > 0 ? track.R : track.L;
    const d = side * (E.barD[i] + extra + rows * 0.45);
    const p = track.pointAt(s, d);
    const c = track.pointAt(s, 0);
    addStand(p.x, p.z, faceYaw(p.x, p.z, c.x, c.z), len, rows, batch);
  };

  // ---------------------------------------------------------- semaforo del via
  let gantry = null;
  if (P.semaforo) {
    gantry = P.semaforo();
    const p = track.pointAt(track.startS + 2, 0);
    gantry.group.position.set(p.x, p.y, p.z);
    // il portale è largo 16 m lungo x locale: lo mettiamo trasversale alla pista
    gantry.group.rotation.y = -p.yaw + Math.PI / 2;
    const i0 = Math.floor(track.wrapS(track.startS + 2) / track.step) % track.n;
    const span = 2 * Math.max(track.L.barD[i0], track.R.barD[i0]) + 2.4;
    // gambe (piede interno a 7 m dal centro nel modello) fuori dalla barriera più larga
    const mb = Math.max(track.L.barD[i0], track.R.barD[i0]);
    gantry.group.scale.x = Math.max(1, (mb + 0.8) / 7);
    void span;
    gantry.group.scale.y = 1.25; // pannello delle luci sopra i 5 m
    group.add(gantry.group);
  }

  // ---------------------------------------------------------- luci notturne lungo la pista
  const lampGeoCity = P.lampione ? P.lampione(rnd) : null;
  const towerGeo = P.torreFari ? P.torreFari(rnd) : null;
  const lampList = [], towerList = [];
  const city = track.stile === 'citta';
  const spacing = city ? 32 : 85;
  for (let s = 0, k = 0; s < track.length; s += spacing, k++) {
    const side = city ? (k % 2 ? 1 : -1) : (k % 2 ? 1 : -1);
    const i = Math.floor(s / track.step) % track.n;
    const E = side > 0 ? track.R : track.L;
    const off = E.barD[i] + (city ? 0.9 : 3.0);
    const p = track.pointAt(s, side * off);
    const c = track.pointAt(s, 0);
    const y = city ? c.y : Math.max(H(p.x, p.z), c.y - 0.3);
    if (!city && !world.isFree(p.x, p.z, 1)) continue;
    const yaw = faceYaw(p.x, p.z, c.x, c.z);
    const lg = city ? lampGeoCity : towerGeo;
    if (CLEAR && lg && CLEAR.blocksGeo(geoOf(lg), M4(p.x, y, p.z, yaw))) { CLEAR.rejected++; continue; }
    (city ? lampList : towerList).push({ x: p.x, y, z: p.z, yaw });
    const lp = track.pointAt(s, side * (off - (city ? 1.6 : 4)));
    const ext = (city ? lampGeoCity : towerGeo)?.extra?.luce;
    const hy = ext ? ext.y : city ? 6 : 18;
    lamps.push({ x: lp.x, y: y + hy - 0.3, z: lp.z, gx: track.pointAt(s, side * (off - (city ? 3 : 8))).x, gy: c.y, gz: track.pointAt(s, side * (off - (city ? 3 : 8))).z, r: city ? 15 : 30, i: city ? 70 : 260, color: city ? 0xffc27a : 0xf4f6ff });
  }
  if (lampGeoCity && lampList.length) group.add(instanced(geoOf(lampGeoCity), mats, lampList, true, { name: 'lampioni', guard: false }));
  if (towerGeo && towerList.length) group.add(instanced(geoOf(towerGeo), mats, towerList, true, { name: 'torri-faro', guard: false }));

  progress(0.1, 'Pianto gli alberi…');
  await nextFrame();

  // ---------------------------------------------------------- per circuito
  const batch = new Batcher();
  const trees = { pino: [], cipresso: [], latifoglia: [], palma: [] };
  const treeModels = {};
  for (const k of Object.keys(trees)) treeModels[k] = [0, 1, 2].map(() => P.albero(rnd, k));
  const addTree = (kind, x, z, s = 1) => {
    trees[kind].push({ x, y: H(x, z) - 0.1, z, yaw: rnd() * 6.28, s: s * (0.8 + rnd() * 0.45), v: Math.floor(rnd() * 3) });
  };
  const simpleTrees = [];
  let crowdDensity = q.crowd ?? 1;

  if (track.id === 'porto') await sceneryPorto();
  else if (track.id === 'colline') await sceneryColline();
  else await sceneryMonza();

  // alberi istanziati (3 varianti per tipo)
  for (const kind of Object.keys(trees)) {
    for (let v = 0; v < 3; v++) {
      const list = trees[kind].filter((t) => t.v === v);
      const im = instanced(geoOf(treeModels[kind][v]), mats, list, true, { name: 'albero-' + kind });
      if (im) group.add(im);
    }
  }
  // alberi lontani semplificati (tronco + chioma a cubi)
  if (simpleTrees.length) {
    const g1 = new THREE.BoxGeometry(0.6, 3, 0.6); g1.translate(0, 1.5, 0);
    const g2 = new THREE.BoxGeometry(4.2, 4.6, 4.2); g2.translate(0, 5.2, 0);
    const g3 = new THREE.BoxGeometry(2.8, 2.2, 2.8); g3.translate(0.4, 8.2, -0.3);
    const im1 = instanced(g1, new THREE.MeshStandardMaterial({ color: 0x5a4330, roughness: 1 }), simpleTrees, false, { name: 'alberi-lontani' });
    const fol = new THREE.MeshStandardMaterial({ color: 0x41672f, roughness: 0.95 });
    const merged = (await import('three/addons/utils/BufferGeometryUtils.js')).mergeGeometries([g2, g3]);
    const chiome = simpleTrees.map((t) => ({ ...t, c: new THREE.Color().setHSL(0.27 + rnd() * 0.06, 0.38 + rnd() * 0.12, 0.26 + rnd() * 0.08) }));
    const im2 = instanced(merged, fol, chiome, true, { name: 'alberi-lontani' });
    group.add(im1, im2);
  }
  const bm = batch.build();
  if (bm) group.add(bm);

  progress(0.85, 'Faccio sedere il pubblico…');
  await nextFrame();
  let crowd = null;
  if (seats.length) {
    crowd = new Crowd(group, seats, P.spettatore ? P.spettatore() : null, P.bandiera ? P.bandiera() : null, crowdDensity);
    crowd.maxDist = q.crowdDist || 700;
  }

  // ---------------------------------------------------------- interfaccia verso main
  let olaT = 0, olaOn = 0;
  let cullT = -1;
  const api = {
    /** quota del tetto sopra (x,z) (galleria, passerelle), -Infinity all'aperto: lì sotto non piove */
    coverAt(x, z) {
      const v = cover.get(Math.floor(x / COV) * 100003 + Math.floor(z / COV));
      return v === undefined ? -Infinity : v;
    },
    group, lamps, gantry, seats, stands,
    crowdDist: 1e9,
    crowdNear(x, z) {
      let bd = 1e9;
      for (const s of stands) bd = Math.min(bd, Math.hypot(s.x - x, s.z - z) - s.len / 2);
      this.crowdDist = Math.max(0, bd);
      return Math.max(0, Math.min(1, 1 - bd / 160));
    },
    inTunnel(x, y, z) {
      if (!tunnels.length) return 0;
      for (const t of tunnels) if (Math.abs(x - t.x) < t.r && Math.abs(z - t.z) < t.r && y < t.y + 6) return 1;
      return 0;
    },
    update(dt, t, player, cheer, race) {
      olaT -= dt;
      if (olaT <= 0) { olaOn = olaOn ? 0 : 2.6; olaT = olaOn ? 9 : 18 + Math.random() * 20; }
      if (crowd) crowd.update(t, player, cheer, olaOn);
      if (player && distCulled.length && (t - cullT > 0.3 || t < cullT)) { cullT = t; distCull(player); }
    },
  };
  return api;

  // ======================================================================= PORTO
  async function sceneryPorto() {
    // palazzi su entrambi i lati, fronte verso la pista
    let placed = 0;
    for (let s = 0; s < track.length; s += 9) {
      for (const side of [-1, 1]) {
        const i = Math.floor(s / track.step) % track.n;
        const E = side > 0 ? track.R : track.L;
        const c = track.pointAt(s, 0);
        for (let row = 0; row < 2; row++) {
          const w = 10 + Math.floor(rnd() * 8), dpt = 10 + Math.floor(rnd() * 5);
          const off = E.barD[i] + 3.2 + dpt / 2 + row * (dpt + 5);
          const p = track.pointAt(s, side * off);
          if (world.isSea(p.x, p.z) || p.z > 6) continue;
          if (!free(p.x, p.z, Math.max(w, dpt) / 2, 2.5)) continue;
          const pal = P.palazzo(rnd, { larghezza: w, profondita: dpt, piani: 3 + Math.floor(rnd() * 4) });
          const y = Math.min(H(p.x, p.z), c.y + 0.2);
          batch.add(geoOf(pal), M4(p.x, y - 0.2, p.z, faceYaw(p.x, p.z, c.x, c.z)));
          occupy(p.x, p.z, Math.max(w, dpt) / 2 + 1);
          placed++;
        }
      }
      if (s % 450 < 9) { progress(0.1 + (s / track.length) * 0.5, `Costruisco il paese… (${placed} palazzi)`); await nextFrame(); }
    }
    // riempi l'entroterra (a nord) con case più lontane
    const b = track.bounds;
    for (let k = 0; k < 220; k++) {
      const x = b.minx - 80 + rnd() * (b.maxx - b.minx + 160), z = b.minz - 160 + rnd() * (-b.minz + 140);
      if (z > -30) continue;
      if (!free(x, z, 8, 6)) continue;
      const pal = P.palazzo(rnd, { larghezza: 9 + Math.floor(rnd() * 8), profondita: 9 + Math.floor(rnd() * 5), piani: 2 + Math.floor(rnd() * 4) });
      batch.add(geoOf(pal), M4(x, H(x, z) - 0.3, z, Math.floor(rnd() * 4) * Math.PI / 2));
      occupy(x, z, 9);
    }
    // chiesa sulla piazza
    if (P.chiesa) {
      const p = track.pointAt(track.curve[2]?.s ?? 1600, -(track.L.barD[0] + 22));
      const ch = P.chiesa(rnd);
      const c = track.pointAt(track.curve[2]?.s ?? 1600, 0);
      if (world.isFree(p.x, p.z, 4)) { batch.add(geoOf(ch), M4(p.x, H(p.x, p.z) - 0.2, p.z, faceYaw(p.x, p.z, c.x, c.z))); occupy(p.x, p.z, 14); }
    }
    // galleria: muri e volta lungo i campioni con x nell'intervallo
    const [ta, tb] = track.def.tunnel[0];
    const tg = new VoxelGrid(1, 1, 1);
    void tg;
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x6f675d, roughness: 0.9 });
    const stripMat = new THREE.MeshBasicMaterial({ color: 0xffb060 });
    stripMat.color.multiplyScalar(3);
    const boxes = [], strips = [];
    for (let i = 0; i < track.n; i += 2) {
      const x = track.px[i], z = track.pz[i];
      if (!(x < ta && x > tb && z < -140)) continue;
      const w = track.w[i];
      const yaw = Math.atan2(track.tz[i], track.tx[i]);
      for (const side of [-1, 1]) {
        const E = side > 0 ? track.R : track.L;
        const d = side * (E.barD[i] + 0.6); // faccia interna del muro sulla barriera fisica
        boxes.push({ x: x + track.nx[i] * d, y: track.py[i] + 3.2, z: z + track.nz[i] * d, yaw, sx: 4.2, sy: 7, sz: 1.2 });
      }
      const roofW = 2 * Math.max(track.L.barD[i], track.R.barD[i]) + 2.6;
      boxes.push({ x, y: track.py[i] + 7.2, z, yaw, sx: 4.2, sy: 1.2, sz: roofW });
      addCover(x, z, -yaw, 4.4, roofW, track.py[i] + 6.6);
      if (i % 6 === 0) for (const side of [-1, 1]) strips.push({ x: x + track.nx[i] * side * 3, y: track.py[i] + 6.5, z: z + track.nz[i] * side * 3, yaw, sx: 2.5, sy: 0.15, sz: 0.4 });
      tunnels.push({ x, z, y: track.py[i], r: w / 2 + 3 });
    }
    const boxIM = (list, mat, shadow) => {
      const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, list.length);
      const o = new THREE.Object3D();
      list.forEach((bx, k) => {
        o.position.set(bx.x, bx.y, bx.z);
        o.rotation.set(0, -bx.yaw, 0);
        o.scale.set(bx.sx, bx.sy, bx.sz);
        o.updateMatrix();
        im.setMatrixAt(k, o.matrix);
      });
      im.castShadow = shadow; im.receiveShadow = true;
      return im;
    };
    if (boxes.length) group.add(boxIM(boxes, wallMat, true), boxIM(strips, stripMat, false));
    // lungomare: palme, tribune sul mare, yacht, faro, gru
    for (let x = -480; x < 330; x += 22) {
      const p = { x: x + rnd() * 6, z: 9 + rnd() * 2 };
      if (world.isFree(p.x, p.z, 0.5)) addTree('palma', p.x, p.z);
    }
    standAlong(track.startS - 120, 1, 70, 12, batch, 3);
    standAlong(track.startS + 140, 1, 60, 10, batch, 3);
    standAlong(track.startS + 330, 1, 50, 10, batch, 3);
    standAlong(track.curve[1]?.s ?? 1280, -1, 40, 8, batch, 4);
    standAlong(track.curve[4]?.s ?? 2140, 1, 40, 8, batch, 4);
    for (let k = 0; k < 34; k++) {
      const len = 10 + rnd() * 18;
      const y = P.yacht(rnd, { lunghezza: Math.round(len) });
      const x = -560 + rnd() * 980, z = 34 + rnd() * 150;
      batch.add(geoOf(y), M4(x, 0.1, z, (rnd() < 0.5 ? 0 : Math.PI) + (rnd() - 0.5) * 0.4));
    }
    for (let k = 0; k < 16; k++) {
      const bt = P.barca(rnd);
      const x = -600 + rnd() * 300, z = 18 + rnd() * 20;
      batch.add(geoOf(bt), M4(x, 0.1, z, rnd() * 6.28));
    }
    // molo con faro
    const molo = new THREE.Mesh(new THREE.BoxGeometry(12, 3, 160), new THREE.MeshStandardMaterial({ color: 0x9a9284, roughness: 1 }));
    molo.position.set(470, 0.5, 90);
    molo.rotation.y = 0.35;
    molo.receiveShadow = true; molo.castShadow = true;
    group.add(molo);
    const fa = P.faro(rnd);
    batch.add(geoOf(fa), M4(496, 2, 162, 0));
    const fl = fa.extra?.luce;
    if (fl) lamps.push({ x: 496 + fl.x, y: 2 + fl.y, z: 162 + fl.z, r: 30, i: 300, color: 0xfff0c0 });
    for (const [x, z] of [[-660, -40], [-700, -10]]) {
      if (P.gru) batch.add(geoOf(P.gru(rnd)), M4(x, H(x, z), z, rnd() * 6.28));
    }
    // pini sulla collina
    for (let k = 0; k < 500 * (q.trees || 1); k++) {
      const x = -700 + rnd() * 1300, z = -650 + rnd() * 560;
      if (H(x, z) > 9 && free(x, z, 3, 5)) addTree(rnd() < 0.75 ? 'pino' : 'cipresso', x, z);
    }
  }

  // ======================================================================= COLLINE
  async function sceneryColline() {
    const S = 1.45;
    // tribune principali e box
    standAlong(track.startS - 160, 1, 70, 14, batch, 4);
    standAlong(track.startS - 60, 1, 70, 14, batch, 4);
    standAlong(track.startS + 40, 1, 70, 14, batch, 4);
    standAlong(track.startS + 140, 1, 60, 12, batch, 4);
    standAlong(track.curve[2].s - 20, -1, 60, 10, batch, 14);
    standAlong(track.curve[4].s, 1, 50, 10, batch, 10);
    standAlong(track.curve[6].s - 40, 1, 60, 10, batch, 12);
    standAlong(track.curve[0].s + 40, -1, 50, 10, batch, 22);
    // corsia box + edificio a sinistra del rettilineo
    if (P.boxPit) {
      for (let k = 0; k < 6; k++) {
        const s = track.startS - 230 + k * 62;
        const i = Math.floor(track.wrapS(s) / track.step) % track.n;
        const p = track.pointAt(s, -(track.L.barD[i] + 7.5)); // a ridosso della corsia box (barD = muro esterno della corsia)
        const c = track.pointAt(s, 0);
        const bp = P.boxPit(rnd, { lunghezza: 60 });
        batch.add(geoOf(bp), M4(p.x, c.y - 0.1, p.z, faceYaw(p.x, p.z, c.x, c.z)));
        occupy(p.x, p.z, 32);
      }
      // la corsia box (asfalto, muretto, linee) la disegna trackmesh da Track.pit
    }
    if (P.passerella) {
      const s = track.startS + 260;
      const c = track.pointAt(s, 0);
      const ps = P.passerella(rnd, { luce: 34 });
      if (batch.add(geoOf(ps), M4(c.x, c.y, c.z, -c.yaw + Math.PI / 2))) addCover(c.x, c.z, -c.yaw + Math.PI / 2, 40, 4, c.y + 5.5);
    }
    progress(0.3, 'Pianto le vigne…');
    await nextFrame();
    // vigne nelle zone di terra
    const vineList = [];
    const tg = world.terrainGrid;
    const vine = P.filare(rnd, { lunghezza: 6 });
    for (let j = 0; j < tg.H; j += 2)
      for (let i = 0; i < tg.W; i += 2) {
        const k = j * tg.W + i;
        if (tg.biome[k] !== 2 || Number.isNaN(tg.hq[k])) continue;
        const x = tg.x0 + (i + 0.5) * tg.R, z = tg.z0 + (j + 0.5) * tg.R;
        if (!world.isFree(x, z, 6)) continue;
        vineList.push({ x, y: tg.hq[k], z, yaw: 0.6 });
      }
    const vstep = Math.max(1, Math.round(1 / (q.trees || 1)));
    const vim = instanced(geoOf(vine), mats, vineList.filter((_, k) => k % vstep === 0), false, { tile: 90, maxDist: q.vineDist || 260, name: 'viti' });
    if (vim) group.add(vim);
    // casali e pievi
    let n = 0;
    for (let k = 0; k < 400 && n < 9; k++) {
      const x = -700 + rnd() * 1900, z = -400 + rnd() * 1200;
      if (!free(x, z, 14, 30)) continue;
      const m = n === 0 && P.cappella ? P.cappella(rnd) : P.casale(rnd);
      batch.add(geoOf(m), M4(x, H(x, z) - 0.3, z, rnd() * 6.28));
      occupy(x, z, 16);
      n++;
    }
    // pieve vicino al tornante (dà il nome alla curva) e cappella
    for (const [ci, off] of [[2, -40], [3, 30]]) {
      const cs = track.curve[ci].s;
      const i = Math.floor(cs / track.step) % track.n;
      const side = track.kappa[i] > 0 ? -1 : 1;
      const p = track.pointAt(cs, side * (Math.abs(off) + 30));
      if (P.cappella && free(p.x, p.z, 10, 10)) { batch.add(geoOf(P.cappella(rnd)), M4(p.x, H(p.x, p.z) - 0.3, p.z, rnd() * 6.28)); occupy(p.x, p.z, 12); }
    }
    progress(0.5, 'Pianto cipressi e pini…');
    await nextFrame();
    // filari di cipressi lungo i rettilinei
    for (let s = 0; s < track.length; s += 14) {
      const i = Math.floor(s / track.step) % track.n;
      if (Math.abs(track.kappa[i]) > 1 / 500) continue;
      for (const side of [-1, 1]) {
        const E = side > 0 ? track.R : track.L;
        const p = track.pointAt(s, side * (E.barD[i] + 9));
        if (fbm(p.x / 200, p.z / 200) > 0.55 && free(p.x, p.z, 2, 7)) addTree('cipresso', p.x, p.z, 1.1);
      }
    }
    const N = Math.round(2600 * (q.trees || 1));
    const b = track.bounds;
    for (let k = 0; k < N; k++) {
      const x = b.minx - 350 + rnd() * (b.maxx - b.minx + 700), z = b.minz - 350 + rnd() * (b.maxz - b.minz + 700);
      const f = fbm(x / 180 + 4, z / 180 + 1);
      if (f < 0.5) continue;
      const tgk = world._cell(x, z);
      if (!free(x, z, 3, 6)) continue;
      void tgk;
      const nearTrack = world.info(x, z).dist < 140;
      if (nearTrack) addTree(f > 0.62 ? 'latifoglia' : rnd() < 0.6 ? 'pino' : 'cipresso', x, z);
      else simpleTrees.push({ x, y: H(x, z), z, yaw: rnd() * 6, s: 0.8 + rnd() * 0.5 });
    }
  }

  // ======================================================================= MONZA
  async function sceneryMonza() {
    const J = track.def.json;
    // tribune: dai poligoni OSM vicini alla pista
    let used = 0;
    for (const t of J.tribune || []) {
      const pts = t.pts;
      if (pts.length < 3) continue;
      let cx = 0, cz = 0;
      for (const p of pts) { cx += p[0]; cz += p[1]; }
      cx /= pts.length; cz /= pts.length;
      const f = world.info(cx, cz);
      if (f.i < 0 || f.dist > 140) continue;
      // asse lungo: lato più lungo del poligono
      let best = 0, ax = 1, az = 0;
      for (let k = 0; k < pts.length - 1; k++) {
        const dx = pts[k + 1][0] - pts[k][0], dz = pts[k + 1][1] - pts[k][1];
        const L = Math.hypot(dx, dz);
        if (L > best) { best = L; ax = dx / L; az = dz / L; }
      }
      const len = Math.max(20, Math.min(160, best));
      // fronte verso il centro pista più vicino
      const tx = track.px[f.i], tz = track.pz[f.i];
      let yaw = Math.atan2(-az, ax); // asse x locale lungo il lato lungo
      // scegli il verso che guarda la pista
      const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
      if ((tx - cx) * fx + (tz - cz) * fz < 0) yaw += Math.PI;
      if (!world.isFree(cx, cz, 2)) continue;
      addStand(cx, cz, yaw, len, 12, batch);
      used++;
    }
    // se OSM ne ha poche vicino al rettilineo, aggiungi la tribuna centrale
    standAlong(track.startS + 60, -1, 120, 16, batch, 5);
    standAlong(track.startS - 120, -1, 90, 14, batch, 5);
    standAlong((track.curve[0]?.s ?? 650) - 60, -1, 70, 12, batch, 30);
    standAlong((track.curve[8]?.s ?? 4850) + 200, -1, 90, 12, batch, 34);
    // box: lato destro del rettilineo, oltre la corsia box
    if (P.boxPit) {
      for (let k = 0; k < 6; k++) {
        const s = track.startS - 260 + k * 62;
        const i = Math.floor(track.wrapS(s) / track.step) % track.n;
        const p = track.pointAt(s, track.R.barD[i] + 7.5);
        const c = track.pointAt(s, 0);
        if (!world.isFree(p.x, p.z, 1)) continue;
        batch.add(geoOf(P.boxPit(rnd, { lunghezza: 60 })), M4(p.x, c.y - 0.1, p.z, faceYaw(p.x, p.z, c.x, c.z)));
        occupy(p.x, p.z, 32);
      }
    }
    // passerelle: sul rettilineo e "sotto il ponte" prima di Ascari
    if (P.passerella) {
      for (const s of [track.startS + 380, (track.curve[7]?.s ?? 3740) - 260]) {
        const c = track.pointAt(s, 0);
        const i = Math.floor(track.wrapS(s) / track.step) % track.n;
        const luce = Math.min(40, 2 * Math.max(track.L.barD[i], track.R.barD[i]) + 4);
        if (batch.add(geoOf(P.passerella(rnd, { luce })), M4(c.x, c.y, c.z, -c.yaw + Math.PI / 2))) addCover(c.x, c.z, -c.yaw + Math.PI / 2, luce + 6, 4, c.y + 5.5);
      }
    }
    progress(0.25, 'Ricostruisco il vecchio anello sopraelevato…');
    await nextFrame();
    buildBanking(J.anello || []);
    progress(0.45, 'Pianto il bosco del Parco di Monza…');
    await nextFrame();
    // bosco: denso vicino alla pista, semplice lontano
    const b = track.bounds;
    const step = 10 / Math.sqrt(q.trees || 1);
    for (let z = b.minz - 300; z < b.maxz + 300; z += step) {
      for (let x = b.minx - 300; x < b.maxx + 300; x += step) {
        const jx = x + (rnd() - 0.5) * step * 0.9, jz = z + (rnd() - 0.5) * step * 0.9;
        const f = fbm(jx / 140, jz / 140);
        if (f < 0.38) continue; // radure
        const inf = world.info(jx, jz);
        if (inf.i < 0 || inf.dist > (q.terrainRange || 380) - 10) continue;
        const E = inf.side > 0 ? track.R : track.L;
        if (inf.dist < E.barD[inf.i] + 9) continue;
        if (isOcc(jx, jz, 3)) continue;
        if (inf.dist < E.barD[inf.i] + 70) addTree(rnd() < 0.85 ? 'latifoglia' : 'pino', jx, jz, 1.15);
        else simpleTrees.push({ x: jx, y: H(jx, jz), z: jz, yaw: rnd() * 6, s: 0.9 + rnd() * 0.6 });
      }
      if (Math.floor(z) % 300 < step) await nextFrame();
    }
    // Alpi in lontananza (nord = -z)
    const alps = new Batcher();
    void alps;
    const mg = new THREE.BoxGeometry(1, 1, 1);
    const rock = new THREE.MeshStandardMaterial({ color: 0x7d8796, roughness: 1, fog: true });
    const snow = new THREE.MeshStandardMaterial({ color: 0xf2f5fa, roughness: 0.8, fog: true });
    const L1 = [], L2 = [];
    for (let k = 0; k < 140; k++) {
      const x = -9000 + rnd() * 18000, z = -9000 - rnd() * 4000;
      const h = 700 + rnd() * 1800, w = 600 + rnd() * 1200;
      L1.push({ x, y: h / 2 - 60, z, sx: w, sy: h, sz: w * 0.8 });
      L2.push({ x, y: h - 60 - h * 0.12, z, sx: w * 0.55, sy: h * 0.26, sz: w * 0.5 });
    }
    for (const [L, m] of [[L1, rock], [L2, snow]]) {
      const im = new THREE.InstancedMesh(mg, m, L.length);
      const o = new THREE.Object3D();
      L.forEach((t, k) => { o.position.set(t.x, t.y, t.z); o.scale.set(t.sx, t.sy, t.sz); o.rotation.y = rnd() * 0.5; o.updateMatrix(); im.setMatrixAt(k, o.matrix); });
      group.add(im);
    }
    void used;
  }

  /** anello sopraelevato: nastro di cemento inclinato, rialzato e con ponti sopra la pista GP */
  function buildBanking(ways) {
    const _wallGeo = new THREE.BoxGeometry(12.5, 1, 0.8), _wo = new THREE.Object3D();
    // concatena le vie dell'anello in una polilinea (ordinandole per vicinanza)
    const segs = ways.filter((w) => w.pts.length > 1).map((w) => w.pts.slice());
    if (!segs.length) return;
    const pos = [], idx = [], col = [];
    const deckPillars = [];
    let v = 0;
    for (const seg of segs) {
      // ricampiona a 6 m
      const pts = [];
      for (let k = 0; k < seg.length - 1; k++) {
        const [ax, az] = seg[k], [bx, bz] = seg[k + 1];
        const L = Math.hypot(bx - ax, bz - az);
        const n = Math.max(1, Math.ceil(L / 6));
        for (let j = 0; j < n; j++) pts.push([ax + ((bx - ax) * j) / n, az + ((bz - az) * j) / n]);
      }
      pts.push(seg[seg.length - 1]);
      if (pts.length < 3) continue;
      // curvatura → inclinazione (fino a ~30°)
      const W = 13;
      const rows = [];
      for (let k = 0; k < pts.length; k++) {
        const a = pts[Math.max(0, k - 3)], b = pts[Math.min(pts.length - 1, k + 3)];
        let tx = b[0] - a[0], tz = b[1] - a[1];
        const L = Math.hypot(tx, tz) || 1;
        tx /= L; tz /= L;
        const nx = -tz, nz = tx;
        // curvatura dal cambio di direzione
        const a2 = pts[Math.max(0, k - 8)], b2 = pts[Math.min(pts.length - 1, k + 8)];
        const h1 = Math.atan2(pts[Math.min(pts.length - 1, k + 1)][1] - a2[1], pts[Math.min(pts.length - 1, k + 1)][0] - a2[0]);
        const h2 = Math.atan2(b2[1] - pts[Math.max(0, k - 1)][1], b2[0] - pts[Math.max(0, k - 1)][0]);
        let dh = h2 - h1;
        while (dh > Math.PI) dh -= 2 * Math.PI;
        while (dh < -Math.PI) dh += 2 * Math.PI;
        const curv = dh / 96;
        const bank = Math.min(0.52, Math.abs(curv) * 160) * Math.sign(curv);
        // quota: terreno + 1, ma sopra la pista GP dove la scavalca
        const [x, z] = pts[k];
        const f = world.info(x, z);
        let base = world.heightAt(x, z) + 0.8;
        if (f.i >= 0 && f.dist < 40) base = Math.max(base, track.py[f.i] + 6.2 * (1 - Math.max(0, f.dist - 20) / 20));
        // tratti in comune con la pista GP (il vecchio anello usava il rettilineo): lì l'anello non va ricostruito
        let shared = false;
        if (CLEAR) for (const p of CLEAR.hits(x, z)) {
          const E = p.d >= 0 ? track.R : track.L;
          const par = Math.abs(tx * track.tx[p.i] + tz * track.tz[p.i]);
          if (Math.abs(p.d) < E.barD[p.i] + W / 2 + 4 && par > 0.6) { shared = true; break; }
        }
        rows.push({ x, z, nx, nz, base, bank, bridge: f.i >= 0 && f.dist < 22, shared });
      }
      // liscia la quota
      for (let it = 0; it < 6; it++) for (let k = 1; k < rows.length - 1; k++) rows[k].base = Math.max(rows[k].base, (rows[k - 1].base + rows[k + 1].base) / 2 - 0.3);
      for (const r of rows) {
        // bordo interno (verso il centro della curva) basso, esterno alto
        for (const d of [-W / 2, W / 2]) {
          const lift = Math.max(0, d * Math.sign(r.bank)) * Math.tan(Math.abs(r.bank)) * 2 + (r.bank ? 0 : 0);
          pos.push(r.x + r.nx * d, r.base + lift, r.z + r.nz * d);
          const g = 0.62 + Math.random() * 0.06;
          col.push(g, g * 0.99, g * 0.95);
        }
        if (r.bridge) deckPillars.push(r);
      }
      for (let k = 0; k < rows.length - 1; k++) {
        const a = v + k * 2;
        const r0 = rows[k], r1 = rows[k + 1];
        if (r0.shared || r1.shared) continue;
        // un pezzo di impalcato basso sopra la carreggiata non deve esistere (i ponti veri stanno sopra CLEAR_H)
        if (CLEAR && [r0, r1].some((r) => [-W / 2, 0, W / 2].some((d) => {
          const lift = Math.max(0, d * Math.sign(r.bank)) * Math.tan(Math.abs(r.bank)) * 2;
          return CLEAR.blocksPoint(r.x + r.nx * d, r.base + lift - 0.5, r.base + lift + 0.5, r.z + r.nz * d);
        }))) continue;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
      v += rows.length * 2;
      // muro esterno e piloni
      const wallList = [];
      rows.forEach((r, k) => {
        if (k % 2 || r.shared) return;
        const out = r.bank >= 0 ? 1 : -1;
        const d = out * (W / 2 + 0.3);
        const lift = Math.tan(Math.abs(r.bank)) * W;
        const top = r.base + lift + 1.2;
        let gy = world.heightAt(r.x + r.nx * d, r.z + r.nz * d);
        const wx = r.x + r.nx * d, wz = r.z + r.nz * d;
        // sopra la pista il muro è solo il parapetto del ponte, non scende a terra; se ingombra comunque, niente muro
        const yaw = Math.atan2(r.nz, r.nx) + Math.PI / 2;
        const hit = (y0) => {
          _wo.position.set(wx, (top + y0) / 2, wz); _wo.rotation.set(0, -yaw, 0); _wo.scale.set(1, Math.max(0.5, top - y0), 1); _wo.updateMatrix();
          return CLEAR.blocksGeo(_wallGeo, _wo.matrix);
        };
        if (CLEAR && hit(gy)) {
          gy = r.base - 0.8;
          if (hit(gy)) return;
        }
        wallList.push({ x: r.x + r.nx * d, z: r.z + r.nz * d, y: (top + gy) / 2, h: top - gy, yaw: Math.atan2(r.nz, r.nx) + Math.PI / 2 });
      });
      const wm = new THREE.InstancedMesh(_wallGeo, new THREE.MeshStandardMaterial({ color: 0x9b968c, roughness: 1 }), wallList.length);
      const o = new THREE.Object3D();
      wallList.forEach((w, k) => { o.position.set(w.x, w.y, w.z); o.rotation.set(0, -w.yaw, 0); o.scale.set(1, Math.max(0.5, w.h), 1); o.updateMatrix(); wm.setMatrixAt(k, o.matrix); });
      wm.castShadow = true; wm.receiveShadow = true;
      wm.name = 'anello-muri';
      group.add(wm);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide }));
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.name = 'anello';
    group.add(mesh);
    // piloni sotto i tratti a ponte
    if (deckPillars.length) {
      const pillarGeo = new THREE.BoxGeometry(1.4, 1, 1.4);
      const pm = new THREE.InstancedMesh(pillarGeo, new THREE.MeshStandardMaterial({ color: 0x8e8a82, roughness: 1 }), deckPillars.length * 2);
      const o = new THREE.Object3D();
      let k = 0;
      for (const r of deckPillars) for (const d of [-5.5, 5.5]) {
        const x = r.x + r.nx * d, z = r.z + r.nz * d;
        const gy = world.heightAt(x, z);
        o.position.set(x, (r.base + gy) / 2, z); o.scale.set(1, Math.max(0.5, r.base - gy), 1); o.updateMatrix();
        // niente piloni dentro le barriere (di nessun tratto di pista)
        if (CLEAR && CLEAR.blocksGeo(pillarGeo, o.matrix)) continue;
        pm.setMatrixAt(k++, o.matrix);
      }
      pm.count = k;
      pm.name = 'anello-piloni';
      pm.castShadow = true;
      group.add(pm);
    }
  }
}
