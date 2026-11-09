// Voxel: griglia + greedy meshing con occlusione ambientale per vertice + materiali condivisi.
import * as THREE from 'three';

/** Tipi di materiale (indice = gruppo nella geometria). */
export const MAT = {
  MATTE: 0,     // intonaco, legno, terra, plastica opaca
  PAINT: 1,     // vernice lucida con trasparente (carrozzerie, yacht)
  METAL: 2,     // metallo / cerchi / guardrail
  GLASS: 3,     // vetri (riflettono il cielo)
  LIGHT: 4,     // luce sempre accesa (neon, semaforo)
  NIGHT: 5,     // luci che si accendono di notte (finestre, lampioni, fari)
  RUBBER: 6,    // gomme, asfalto scuro
  BRAKE: 7,     // stop delle auto (intensità per auto)
  FOLIAGE: 8,   // chiome (leggero sottosurface finto)
};
export const MAT_COUNT = 9;

/** Voce di tavolozza: colore (hex) + tipo di materiale */
export const pal = (color, mat = MAT.MATTE) => ({ color, mat });

export class VoxelGrid {
  constructor(nx, ny, nz) {
    this.nx = nx; this.ny = ny; this.nz = nz;
    this.data = new Uint16Array(nx * ny * nz); // 0 = vuoto, altrimenti indice+1 nella tavolozza
    this.palette = [];
    this._palIndex = new Map();
  }
  /** registra (o riusa) una voce di tavolozza e ritorna il codice da usare in set() */
  p(color, mat = MAT.MATTE) {
    const key = color + ':' + mat;
    let k = this._palIndex.get(key);
    if (k === undefined) {
      this.palette.push({ color, mat });
      k = this.palette.length;
      this._palIndex.set(key, k);
    }
    return k;
  }
  idx(x, y, z) {
    return x + this.nx * (z + this.nz * y);
  }
  inside(x, y, z) {
    return x >= 0 && y >= 0 && z >= 0 && x < this.nx && y < this.ny && z < this.nz;
  }
  get(x, y, z) {
    return this.inside(x, y, z) ? this.data[this.idx(x, y, z)] : 0;
  }
  set(x, y, z, v) {
    if (this.inside(x, y, z)) this.data[this.idx(x, y, z)] = v;
  }
  /** riempie un parallelepipedo [x0,x1) × [y0,y1) × [z0,z1) */
  box(x0, y0, z0, x1, y1, z1, v) {
    for (let y = Math.max(0, y0); y < Math.min(this.ny, y1); y++)
      for (let z = Math.max(0, z0); z < Math.min(this.nz, z1); z++)
        for (let x = Math.max(0, x0); x < Math.min(this.nx, x1); x++) this.data[this.idx(x, y, z)] = v;
  }
  /** riempie solo dove già pieno (per dipingere) */
  paint(x0, y0, z0, x1, y1, z1, v) {
    for (let y = Math.max(0, y0); y < Math.min(this.ny, y1); y++)
      for (let z = Math.max(0, z0); z < Math.min(this.nz, z1); z++)
        for (let x = Math.max(0, x0); x < Math.min(this.nx, x1); x++) {
          const i = this.idx(x, y, z);
          if (this.data[i]) this.data[i] = v;
        }
  }
  clone() {
    const g = new VoxelGrid(this.nx, this.ny, this.nz);
    g.data.set(this.data);
    g.palette = this.palette.slice();
    g._palIndex = new Map(this._palIndex);
    return g;
  }
}

const AO_CURVE = [0.5, 0.68, 0.84, 1.0];
const _c = new THREE.Color();

/**
 * Greedy meshing con AO. opts: {scale=1, origin=[0,0,0] (in voxel), ao=true, aoStrength=1}
 * Ritorna BufferGeometry con gruppi per tipo di materiale (MAT).
 */
export function meshGrid(grid, opts = {}) {
  const scale = opts.scale ?? 1;
  const [ox, oy, oz] = opts.origin ?? [0, 0, 0];
  const aoOn = opts.ao !== false;
  const aoK = opts.aoStrength ?? 1;
  const dims = [grid.nx, grid.ny, grid.nz];
  const pal = grid.palette;
  // colori lineari precalcolati per voce
  const cols = pal.map((p) => {
    _c.set(p.color);
    if (opts.colorJitter) {
      // nulla qui: il jitter lo applichiamo per faccia
    }
    return [_c.r, _c.g, _c.b];
  });
  const perMat = [];
  for (let m = 0; m < MAT_COUNT; m++) perMat.push({ pos: [], nor: [], col: [], idx: [] });

  const get = (x, y, z) => grid.get(x, y, z);
  const solid = (x, y, z) => (get(x, y, z) ? 1 : 0);
  const glassLike = (v) => v && (pal[v - 1].mat === MAT.GLASS);

  // per ogni asse d e direzione
  const x = [0, 0, 0];
  for (let d = 0; d < 3; d++) {
    const u = (d + 1) % 3, v = (d + 2) % 3;
    const q = [0, 0, 0];
    q[d] = 1;
    const W = dims[u], H = dims[v];
    const mask = new Int32Array(W * H);
    const aoMask = new Int32Array(W * H);
    for (let side = -1; side <= 1; side += 2) {
      for (x[d] = 0; x[d] < dims[d]; x[d]++) {
        // costruisci la maschera delle facce visibili
        let n = 0;
        for (x[v] = 0; x[v] < H; x[v]++)
          for (x[u] = 0; x[u] < W; x[u]++, n++) {
            const a = get(x[0], x[1], x[2]);
            const b = get(x[0] + q[0] * side, x[1] + q[1] * side, x[2] + q[2] * side);
            // faccia visibile se il vicino è vuoto (o se il vicino è vetro e noi no)
            if (a && (!b || (glassLike(b) && !glassLike(a)))) {
              mask[n] = a;
              if (aoOn) {
                // AO dei 4 vertici: vicini nello strato esterno
                const px = x[0] + q[0] * side, py = x[1] + q[1] * side, pz = x[2] + q[2] * side;
                const du = [0, 0, 0], dv = [0, 0, 0];
                du[u] = 1; dv[v] = 1;
                const s = (a1, a2) => solid(px + du[0] * a1 + dv[0] * a2, py + du[1] * a1 + dv[1] * a2, pz + du[2] * a1 + dv[2] * a2);
                const vao = (su, sv) => {
                  const s1 = s(su, 0), s2 = s(0, sv), c = s(su, sv);
                  return s1 && s2 ? 0 : 3 - (s1 + s2 + c);
                };
                const a00 = vao(-1, -1), a10 = vao(1, -1), a11 = vao(1, 1), a01 = vao(-1, 1);
                aoMask[n] = a00 | (a10 << 2) | (a11 << 4) | (a01 << 6);
              } else aoMask[n] = 255;
            } else mask[n] = 0;
          }
        // greedy
        n = 0;
        for (let j = 0; j < H; j++)
          for (let i = 0; i < W; ) {
            const c = mask[n];
            if (!c) { i++; n++; continue; }
            const ao = aoMask[n];
            let w = 1;
            while (i + w < W && mask[n + w] === c && aoMask[n + w] === ao) w++;
            let h = 1, done = false;
            while (j + h < H) {
              for (let k = 0; k < w; k++) {
                const m = n + k + h * W;
                if (mask[m] !== c || aoMask[m] !== ao) { done = true; break; }
              }
              if (done) break;
              h++;
            }
            // emetti quad
            const pc = pal[c - 1];
            const out = perMat[pc.mat];
            const base = out.pos.length / 3;
            const p0 = [0, 0, 0];
            p0[d] = x[d] + (side > 0 ? 1 : 0);
            p0[u] = i; p0[v] = j;
            const du = [0, 0, 0], dv = [0, 0, 0];
            du[u] = w; dv[v] = h;
            const corners = [
              [p0[0], p0[1], p0[2]],
              [p0[0] + du[0], p0[1] + du[1], p0[2] + du[2]],
              [p0[0] + du[0] + dv[0], p0[1] + du[1] + dv[1], p0[2] + du[2] + dv[2]],
              [p0[0] + dv[0], p0[1] + dv[1], p0[2] + dv[2]],
            ];
            const aos = [ao & 3, (ao >> 2) & 3, (ao >> 4) & 3, (ao >> 6) & 3];
            const col = cols[c - 1];
            for (let k = 0; k < 4; k++) {
              const cc = corners[k];
              out.pos.push((cc[0] - ox) * scale, (cc[1] - oy) * scale, (cc[2] - oz) * scale);
              out.nor.push(q[0] * side, q[1] * side, q[2] * side);
              const f = aoOn ? 1 - (1 - AO_CURVE[aos[k]]) * aoK : 1;
              out.col.push(col[0] * f, col[1] * f, col[2] * f);
            }
            // orientamento: normale uscente; flip della diagonale per l'AO anisotropo
            const flip = aos[0] + aos[2] < aos[1] + aos[3];
            const ccw = side > 0; // per ogni asse u×v ha verso +d
            let tri = flip ? [1, 2, 3, 1, 3, 0] : [0, 1, 2, 0, 2, 3];
            if (!(ccw)) tri = flip ? [1, 3, 2, 1, 0, 3] : [0, 2, 1, 0, 3, 2];
            for (const t of tri) out.idx.push(base + t);
            // azzera la maschera usata
            for (let hh = 0; hh < h; hh++)
              for (let k = 0; k < w; k++) mask[n + k + hh * W] = 0;
            i += w; n += w;
          }
      }
    }
  }
  return buildGeometry(perMat);
}

function buildGeometry(perMat) {
  let nv = 0, ni = 0;
  for (const m of perMat) { nv += m.pos.length / 3; ni += m.idx.length; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), col = new Float32Array(nv * 3);
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  const geo = new THREE.BufferGeometry();
  let vo = 0, io = 0;
  for (let m = 0; m < perMat.length; m++) {
    const P = perMat[m];
    const cnt = P.idx.length;
    if (!cnt) continue;
    pos.set(P.pos, vo * 3); nor.set(P.nor, vo * 3); col.set(P.col, vo * 3);
    for (let k = 0; k < cnt; k++) idx[io + k] = P.idx[k] + vo;
    geo.addGroup(io, cnt, m);
    vo += P.pos.length / 3; io += cnt;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  return geo;
}

// ------------------------------------------------------------------ materiali condivisi
let SHARED = null;
let LEGGERI = false;
/** grafica bassa: materiali semplici (Lambert, senza riflessi fisici). Va deciso prima di costruire il mondo. */
export function materialiLeggeri(on) {
  if (SHARED && !!on !== LEGGERI) throw new Error('materiali già creati');
  LEGGERI = !!on;
}
export function usaMaterialiLeggeri() { return LEGGERI; }
/** Materiali condivisi per i voxel (indice = MAT). Le intensità notturne si regolano con setNight(). */
export function voxelMaterials() {
  if (SHARED) return SHARED;
  const L = (o) => new THREE.MeshLambertMaterial({ vertexColors: true, ...o });
  const matte = LEGGERI ? L() : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0.0 });
  const paint = LEGGERI ? L() : new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.15, clearcoat: 1.0, clearcoatRoughness: 0.06 });
  const metal = LEGGERI ? L() : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.9 });
  const glass = LEGGERI ? L() : new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.04, metalness: 0.2, clearcoat: 1, envMapIntensity: 1.6 });
  const light = new THREE.MeshBasicMaterial({ vertexColors: true });
  light.color.setScalar(3.0);
  const night = LEGGERI ? L({ emissive: 0xffffff, emissiveIntensity: 0 }) : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0, emissive: 0xffffff, emissiveIntensity: 0 });
  // emissivo dal colore dei vertici: usa il colore anche come emissivo
  night.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = SHARED.uNight;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNight;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance = vColor.rgb * uNight;');
  };
  const rubber = LEGGERI ? L() : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  const brake = new THREE.MeshBasicMaterial({ vertexColors: true });
  brake.color.setScalar(1.2);
  const foliage = LEGGERI ? L() : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
  SHARED = {
    list: [matte, paint, metal, glass, light, night, rubber, brake, foliage],
    uNight: { value: 0 },
  };
  return SHARED;
}
/** 0 = giorno, 1 = notte piena */
export function setNight(k) {
  const S = voxelMaterials();
  S.uNight.value = 0.05 + k * 3.2;
  S.list[MAT.LIGHT].color.setScalar(1.5 + k * 2.5);
  // di notte la vernice e i vetri a specchio riflettevano i fari come lampadine: un po' meno lucidi
  const paint = S.list[MAT.PAINT], glass = S.list[MAT.GLASS];
  if (LEGGERI) return;
  paint.clearcoatRoughness = 0.06 + 0.3 * k;
  paint.roughness = 0.32 + 0.16 * k;
  paint.clearcoat = 1 - 0.35 * k;
  glass.roughness = 0.04 + 0.22 * k;
}

/** Mesh da griglia con i materiali condivisi (o sostituiti: overrides = {matIndex: material}) */
export function voxelMesh(grid, opts = {}, overrides = null) {
  const geo = meshGrid(grid, opts);
  let mats = voxelMaterials().list;
  if (overrides) {
    mats = mats.slice();
    for (const k in overrides) mats[k] = overrides[k];
  }
  const mesh = new THREE.Mesh(geo, mats);
  mesh.castShadow = opts.castShadow !== false;
  mesh.receiveShadow = opts.receiveShadow !== false;
  return mesh;
}
