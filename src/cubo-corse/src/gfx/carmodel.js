// Auto GT a voxel, procedurali: 3 carrozzerie × livree, numeri sulle portiere, luci, ruote che girano,
// abitacolo per la visuale interna, danni (si staccano i cubetti).
import * as THREE from 'three';
import { VoxelGrid, MAT, meshGrid, voxelMaterials, voxelMesh } from './voxel.js';

export const VOX = 0.1; // lato del voxel delle auto (m)
const NX = 47, NY = 15, NZ = 21; // lunghezza, altezza, larghezza (voxel)

// forme delle 3 carrozzerie: profili a punti chiave [x (0 = coda … 46 = muso), valore in voxel]
const BODY = {
  // berlinetta a motore anteriore: cofano lungo, abitacolo arretrato
  falco: {
    top: [[0, 7], [3, 7.7], [9, 7.9], [16, 7.6], [26, 7.2], [34, 6.7], [40, 5.9], [44, 4.8], [46, 4.0]],
    roof: [[8, 7.8], [11, 11.4], [13, 12.3], [20, 12.3], [22, 11.8], [28, 7.2]],
    winF: 21, winR: 12, lunotto: true, axF: 36.5, axR: 8.2, wing: 13.6, scoop: true, intake: false,
  },
  // motore centrale: abitacolo avanzato, coda alta con cofano motore
  vespro: {
    top: [[0, 8.2], [4, 8.7], [11, 8.7], [17, 8.2], [24, 7.0], [30, 6.2], [38, 5.7], [43, 4.7], [46, 3.6]],
    roof: [[14, 8.4], [19, 11.8], [21, 12.2], [27, 12.2], [29, 11.6], [35, 6.4]],
    winF: 28, winR: 18, lunotto: false, axF: 37, axR: 8.5, wing: 13.9, scoop: false, intake: true,
  },
  // coda lunga: bassissima e affusolata
  orsa: {
    top: [[0, 6.8], [5, 7.4], [12, 7.4], [18, 7.0], [26, 6.3], [32, 5.7], [40, 5.1], [44, 4.3], [46, 3.4]],
    roof: [[15, 7.2], [21, 11.2], [22, 11.6], [28, 11.6], [30, 11.0], [36, 6.0]],
    winF: 29, winR: 20, lunotto: false, axF: 38, axR: 6.5, wing: 12.8, scoop: false, intake: true,
  },
};
const lerpK = (k, x) => {
  if (x <= k[0][0]) return k[0][1];
  for (let i = 1; i < k.length; i++) if (x <= k[i][0]) {
    const [x0, y0] = k[i - 1], [x1, y1] = k[i];
    return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return k[k.length - 1][1];
};
const HW = [[0, 8.4], [3, 9.5], [6, 10], [40, 10], [44, 9.2], [46, 7.6]];

const DIGITS = {
  0: ['111', '101', '101', '101', '111'], 1: ['010', '110', '010', '010', '111'], 2: ['111', '001', '111', '100', '111'],
  3: ['111', '001', '111', '001', '111'], 4: ['101', '101', '111', '001', '001'], 5: ['111', '100', '111', '001', '111'],
  6: ['111', '100', '111', '101', '111'], 7: ['111', '001', '010', '010', '010'], 8: ['111', '101', '111', '101', '111'],
  9: ['111', '101', '111', '001', '111'],
};

const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Costruisce la griglia voxel della carrozzeria. */
export function buildCarGrid(bodyId, livery, number, pattern = 0) {
  const B = BODY[bodyId] || BODY.falco;
  const g = new VoxelGrid(NX, NY, NZ);
  const base = g.p(livery.base, MAT.PAINT);
  const sec = g.p(livery.sec, MAT.PAINT);
  const ter = g.p(livery.ter, MAT.PAINT);
  const carbon = g.p(0x17181b, MAT.MATTE);
  const glass = g.p(0x0d1418, MAT.GLASS);
  const head = g.p(0xf3f6ff, MAT.NIGHT);
  const drl = g.p(0xffffff, MAT.LIGHT);
  const tail = g.p(0xff1a12, MAT.BRAKE);
  const grille = g.p(0x0b0b0c, MAT.MATTE);
  const metal = g.p(0x9aa0a6, MAT.METAL);
  const white = g.p(0xf5f5f0, MAT.PAINT);
  const zc = (NZ - 1) / 2; // asse centrale

  const xF = Math.round(B.axF), xR = Math.round(B.axR);
  const roofX0 = B.roof[0][0], roofX1 = B.roof[B.roof.length - 1][0];
  const roofPeak = Math.max(...B.roof.map((k) => k[1]));
  for (let x = 0; x < NX; x++) {
    const fen = Math.max(Math.exp(-(((x - xF) / 4.0) ** 2)), Math.exp(-(((x - xR) / 4.4) ** 2)));
    const top = lerpK(B.top, x) + fen * 0.7;
    const hw = Math.min(10, lerpK(HW, x) + fen * 0.4);
    const inCab = x > roofX0 && x < roofX1;
    const roof = inCab ? lerpK(B.roof, x) : 0;
    const topI = Math.round(top);
    for (let z = 0; z < NZ; z++) {
      const dz = Math.abs(z - zc);
      for (let y = 1; y <= topI; y++) {
        // spalla arrotondata: l'ultima fila rientra
        const lim = y === topI ? hw - 1.2 : y === topI - 1 ? hw - 0.4 : hw;
        if (dz <= lim) g.set(x, y, z, base);
      }
      if (inCab && roof > topI + 0.5) {
        const rI = Math.round(roof);
        for (let y = topI + 1; y <= rI; y++) {
          const cw = 7.8 - (y - topI) * 0.3; // si stringe verso il tetto
          if (dz > cw) continue;
          const roofTop = y === rI && roof >= roofPeak - 0.75;
          const pillarA = x === B.winF + 1 || x === B.winF + 2;
          const pillarB = x === B.winR - 1;
          const edge = dz > cw - 1.2;
          let v = glass;
          if (roofTop) v = base;
          else if (edge && (pillarA || pillarB)) v = base;
          else if (!edge && x < B.winR && !B.lunotto) v = base; // cofano motore pieno
          g.set(x, y, z, v);
        }
      }
    }
  }
  // passaruota (vuoti) per ruote raggio ~3.6 voxel
  const arch = (xc) => {
    for (let x = xc - 5; x <= xc + 5; x++)
      for (let y = 0; y < 8; y++) {
        const r = Math.hypot(x - xc, y - 3.4);
        if (r < 4.1)
          for (let z = 0; z < NZ; z++) {
            const dz = Math.abs(z - zc);
            if (dz > 5.5) g.set(x, y, z, 0);
          }
      }
  };
  arch(xF); arch(xR);
  // minigonne e splitter in carbonio
  for (let x = 2; x < NX - 1; x++)
    for (let z = 0; z < NZ; z++) if (g.get(x, 1, z)) g.set(x, 1, z, carbon);
  g.box(NX - 2, 1, 2, NX, 2, NZ - 2, carbon); // splitter
  // griglia anteriore
  for (let z = 0; z < NZ; z++) {
    const dz = Math.abs(z - zc);
    if (dz < 5) for (let y = 2; y <= 3; y++) if (g.get(NX - 1, y, z)) g.set(NX - 1, y, z, grille);
  }
  // fari anteriori (angoli del muso) e luci diurne
  for (let x = NX - 4; x < NX; x++)
    for (let z = 0; z < NZ; z++) {
      const dz = Math.abs(z - zc);
      if (dz >= 5 && dz <= 8.5) {
        const yTop = (() => { for (let y = NY - 1; y > 0; y--) if (g.get(x, y, z)) return y; return 0; })();
        if (yTop >= 3) {
          g.set(x, yTop, z, x >= NX - 2 ? head : g.get(x, yTop, z));
          if (x === NX - 1 || (x === NX - 2 && !g.get(x + 1, yTop, z))) g.set(x, yTop - 1, z, dz > 7.5 ? drl : head);
        }
      }
    }
  // fanali posteriori
  for (let z = 0; z < NZ; z++) {
    const dz = Math.abs(z - zc);
    if (dz >= 4 && dz <= 9) {
      for (let x = 0; x < 3; x++) {
        let yTop = 0;
        for (let y = NY - 1; y > 0; y--) if (g.get(x, y, z)) { yTop = y; break; }
        if (yTop > 3 && !g.get(x - 1, yTop - 1, z)) { g.set(x, yTop - 1, z, tail); break; }
      }
    }
  }
  // diffusore e scarichi
  for (let z = 3; z < NZ - 3; z += 2) g.box(0, 1, z, 3, 3, z + 1, carbon);
  g.box(0, 2, 7, 1, 3, 8, metal); g.box(0, 2, 13, 1, 3, 14, metal);
  // alettone posteriore
  const wy = Math.round(B.wing);
  const wx0 = 0;
  for (const zs of [5, NZ - 6]) g.box(2, Math.round(lerpK(B.top, 3)) - 1, zs, 4, wy, zs + 1, carbon);
  g.box(wx0, wy, 1, wx0 + 5, wy + 1, NZ - 1, carbon);
  g.box(wx0, wy - 2, 0, wx0 + 5, wy + 2, 1, carbon); // paratie
  g.box(wx0, wy - 2, NZ - 1, wx0 + 5, wy + 2, NZ, carbon);
  // specchietti
  const mx = B.winF + 1;
  for (const zs of [0, NZ - 1]) {
    const yy = Math.round(lerpK(B.top, mx)) + 1;
    g.box(mx, yy, zs, mx + 2, yy + 1, zs + 1, base);
    g.box(mx, yy, zs === 0 ? 1 : NZ - 2, mx + 1, yy + 1, zs === 0 ? 3 : NZ - 1, carbon);
  }
  // prese d'aria sul cofano / sul tetto
  // sfoghi sul cofano (griglie scure)
  for (let x = B.winF + 6; x < B.winF + 12 && x < NX - 4; x++) {
    if (x % 2) continue;
    const y = Math.round(lerpK(B.top, x));
    for (const [z0, z1] of B.scoop ? [[6, 15]] : [[4, 7], [14, 17]]) for (let z = z0; z < z1; z++) if (g.get(x, y, z)) g.set(x, y, z, carbon);
  }
  // presa d'aria sul tetto
  const roofMax = Math.round(Math.max(...B.roof.map((k) => k[1])));
  const rx = Math.round((B.winR + B.winF) / 2);
  g.box(rx - 3, roofMax + 1, 9, rx + 1, roofMax + 2, 12, carbon);
  // prese laterali per i motori centrali
  if (B.intake) for (let x = B.winR - 5; x < B.winR; x++) for (let y = 3; y <= 5; y++) for (const z of [0, 1, NZ - 2, NZ - 1]) if (g.get(x, y, z) && !g.get(x, y, z === 0 || z === 1 ? z - 1 : z + 1)) g.set(x, y, z, carbon);

  // ---- livrea
  const paintTop = (x0, x1, z0, z1, c) => {
    for (let x = x0; x < x1; x++)
      for (let z = z0; z < z1; z++)
        for (let y = NY - 1; y > 0; y--) {
          const v = g.get(x, y, z);
          if (v) { if (v === base) g.set(x, y, z, c); break; }
        }
  };
  if (pattern === 0) {
    // doppia striscia centrale
    paintTop(0, NX, Math.round(zc) - 3, Math.round(zc) - 1, sec);
    paintTop(0, NX, Math.round(zc) + 2, Math.round(zc) + 4, sec);
  } else if (pattern === 1) {
    // bicolore: parte bassa
    for (let x = 0; x < NX; x++) for (let z = 0; z < NZ; z++) for (let y = 2; y <= 4; y++) if (g.get(x, y, z) === base) g.set(x, y, z, sec);
    paintTop(0, NX, Math.round(zc) - 1, Math.round(zc) + 2, ter);
  } else {
    // fascia laterale a freccia
    for (let x = 0; x < NX; x++) {
      const y0 = 3 + Math.floor((x / NX) * 3);
      for (let z = 0; z < NZ; z++) for (let y = y0; y <= y0 + 1; y++) if (g.get(x, y, z) === base) g.set(x, y, z, sec);
    }
    paintTop(Math.round(NX * 0.8), NX, 0, NZ, sec);
  }
  // numero sulle portiere (tondo bianco + cifre) e sul cofano
  const num = String(number).slice(0, 2);
  const dx = Math.round((B.winR + B.winF) / 2);
  const drawSide = (zEdgeDir) => {
    for (let x = dx - 4; x <= dx + 4; x++)
      for (let y = 2; y <= 6; y++) {
        // trova il voxel più esterno su questo lato
        for (let k = 0; k < NZ; k++) {
          const z = zEdgeDir > 0 ? NZ - 1 - k : k;
          if (g.get(x, y, z)) {
            if (g.get(x, y, z) !== glass) g.set(x, y, z, white);
            break;
          }
        }
      }
    const w = num.length * 4 - 1;
    const x0 = dx - Math.floor(w / 2);
    for (let c = 0; c < num.length; c++) {
      const D = DIGITS[num[c]] || DIGITS[0];
      for (let r = 0; r < 5; r++)
        for (let q = 0; q < 3; q++) {
          if (D[r][q] !== '1') continue;
          // sul lato destro (+z) la x cresce verso il muso: leggiamo da sinistra a destra guardando il fianco
          const col = zEdgeDir > 0 ? c * 4 + q : w - 1 - (c * 4 + q);
          const x = x0 + col, y = 6 - r;
          for (let k = 0; k < NZ; k++) {
            const z = zEdgeDir > 0 ? NZ - 1 - k : k;
            if (g.get(x, y, z)) { g.set(x, y, z, ter); break; }
          }
        }
    }
  };
  drawSide(1); drawSide(-1);
  return g;
}

/** Ruota voxel (asse = z locale). */
let WHEEL_GEO = null;
function wheelGeometry() {
  if (WHEEL_GEO) return WHEEL_GEO;
  const R = 4, W = 3;
  const g = new VoxelGrid(2 * R + 1, 2 * R + 1, W);
  const tyre = g.p(0x161616, MAT.RUBBER), rim = g.p(0xb8bcc2, MAT.METAL), hub = g.p(0x2a2c30, MAT.METAL), wall = g.p(0x2b2b2b, MAT.RUBBER);
  for (let x = 0; x <= 2 * R; x++)
    for (let y = 0; y <= 2 * R; y++) {
      const r = Math.hypot(x - R, y - R);
      if (r > R + 0.35) continue;
      for (let z = 0; z < W; z++) {
        let v = r > R - 1.2 ? tyre : r > 1.3 ? ((Math.round(Math.atan2(y - R, x - R) / (Math.PI / 5)) % 2 === 0 || z === 0) ? rim : hub) : hub;
        if (r > R - 1.2 && z === W - 1 && r < R - 0.4) v = wall;
        g.set(x, y, z, v);
      }
    }
  WHEEL_GEO = meshGrid(g, { scale: VOX * 0.85, origin: [R + 0.5, R + 0.5, W / 2], aoStrength: 0.5 });
  return WHEEL_GEO;
}

/** Abitacolo per la visuale interna, in voxel da 5 cm, costruito attorno agli occhi del pilota (origine). */
function cockpitMesh() {
  // indici: x -10..30 (avanti), y -22..10, z -20..20
  const OX = 10, OY = 22, OZ = 20;
  const g = new VoxelGrid(41, 33, 41);
  const S = (x0, y0, z0, x1, y1, z1, v) => g.box(x0 + OX, y0 + OY, z0 + OZ, x1 + OX, y1 + OY, z1 + OZ, v);
  const dash = g.p(0x121316, MAT.MATTE), carbon = g.p(0x1e2024, MAT.MATTE), alc = g.p(0x2a2b30, MAT.RUBBER);
  const screen = g.p(0x1f5a6e, MAT.LIGHT), red = g.p(0x8a1d14, MAT.LIGHT), grn = g.p(0x1d7a36, MAT.LIGHT), yel = g.p(0x8a6d18, MAT.LIGHT);
  const frame = g.p(0x0c0c0e, MAT.MATTE), cage = g.p(0x8a9098, MAT.METAL);
  // cruscotto basso
  S(14, -16, -19, 24, -7, 20, dash);
  S(16, -7, -19, 24, -5, -15, dash); S(16, -7, 16, 24, -5, 20, dash); // spalle del cruscotto sotto i montanti
  S(12, -9, -9, 16, -7, 10, carbon);
  // volante (anello nel piano y-z a 0.6 m davanti agli occhi): si vede la parte alta della corona
  const cx = 12, cy = -12;
  for (let y = cy - 5; y <= cy + 5; y++)
    for (let z = -6; z <= 6; z++) {
      const r = Math.hypot(y - cy, z);
      const ring = r > 3.6 && r < 5.1;
      const spoke = Math.abs(y - cy) <= 0.6 && Math.abs(z) < 4.6;
      if (ring || spoke) S(cx, y, z, cx + 1, y + 1, z + 1, ring ? alc : carbon);
    }
  S(cx - 1, cy - 1, -2, cx, cy + 2, 3, carbon);
  S(cx - 1, cy, -1, cx, cy + 1, 2, screen);
  // display e luci di cambiata sul cruscotto, piccoli
  S(15, -8, -2, 16, -7, 3, screen);
  [[-3, grn], [-2, grn], [-1, yel], [1, yel], [2, red], [3, red]].forEach(([z, c]) => S(16, -7, z, 17, -6, z + 1, c));
  // montanti A (sottili e larghi), cornice del tetto, specchietto
  for (let k = 0; k < 6; k++) { // montante inclinato: scende in avanti
    S(17 + k, 8 - k * 2 - 3, -19, 18 + k, 8 - k * 2, -17, frame);
    S(17 + k, 8 - k * 2 - 3, 18, 18 + k, 8 - k * 2, 20, frame);
  }
  S(22, -5, -19, 24, -2, -17, frame); S(22, -5, 18, 24, -2, 20, frame);
  S(-10, 8, -19, 18, 10, -16, frame); S(-10, 8, 17, 18, 10, 20, frame);
  S(16, 8, -19, 18, 10, 20, frame);
  S(15, 5, -2, 16, 7, 3, carbon); S(15, 7, 0, 16, 8, 1, carbon);
  // gabbia di sicurezza
  S(-8, -20, -15, -7, 8, -14, cage); S(-8, -20, 15, -7, 8, 16, cage); S(-8, 7, -15, -7, 8, 16, cage);
  S(-7, 7, -15, 16, 8, -14, cage); S(-7, 7, 15, 16, 8, 16, cage);
  return voxelMesh(g, { scale: 0.05, origin: [OX, OY, OZ], castShadow: false, aoStrength: 0.6 });
}

export class CarVisual {
  /** spec: CARS[i]; livery: LIVREE[k]; number: int */
  constructor(spec, livery, number, opts = {}) {
    this.spec = spec;
    this.group = new THREE.Group();
    this.body = new THREE.Group(); // assetto (beccheggio/rollio)
    this.group.add(this.body);
    const pattern = (number * 7) % 3;
    this.grid = buildCarGrid(spec.id, livery, number, pattern);
    this.brakeMat = new THREE.MeshBasicMaterial({ vertexColors: true });
    this.brakeMat.color.setScalar(1.0);
    this.mesh = null;
    this._remesh();
    // ruote
    const B = BODY[spec.id] || BODY.falco;
    const wg = wheelGeometry();
    const wmats = voxelMaterials().list;
    this.wheels = [];
    const xF = (Math.round(B.axF) - (NX - 1) / 2) * VOX, xR = (Math.round(B.axR) - (NX - 1) / 2) * VOX;
    for (const [x, z, front] of [[xF, -0.82, true], [xF, 0.82, true], [xR, -0.82, false], [xR, 0.82, false]]) {
      const pivot = new THREE.Group();
      pivot.position.set(x, 0.34, z);
      const w = new THREE.Mesh(wg, wmats);
      w.castShadow = true;
      if (z < 0) w.rotation.y = Math.PI; // lato sinistro: fianco del cerchio verso l'esterno
      const spin = new THREE.Group();
      spin.add(w);
      pivot.add(spin);
      this.body.add(pivot);
      this.wheels.push({ pivot, spin, front, left: z < 0 });
    }
    // cockpit (solo visuale interna)
    const roofMax = Math.max(...B.roof.map((k) => k[1]));
    this.eye = new THREE.Vector3(((B.winR + B.winF) / 2 - 2.5 - (NX - 1) / 2) * VOX, (roofMax - 3.0) * VOX, -0.05);
    this.cockpit = cockpitMesh();
    this.cockpit.position.copy(this.eye);
    this.cockpit.visible = false;
    this.body.add(this.cockpit);
    this.bonnet = new THREE.Vector3((B.winF + 7 - (NX - 1) / 2) * VOX, lerpK(B.top, B.winF + 7) * VOX + 0.4, 0);
    this.lastRemesh = 0;
    this.pendingRemesh = false;
    this.lost = 0;
  }

  _remesh() {
    if (this.mesh) {
      this.mesh.geometry.dispose();
      this.body.remove(this.mesh);
    }
    const geo = meshGrid(this.grid, { scale: VOX, origin: [(NX - 1) / 2 + 0.5, 0, NZ / 2] });
    const mats = voxelMaterials().list.slice();
    mats[MAT.BRAKE] = this.brakeMat;
    this.mesh = new THREE.Mesh(geo, mats);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    // dopo un urto la carrozzeria si ricostruisce: in abitacolo deve restare nascosta (prima ricompariva attorno alla telecamera)
    this.mesh.visible = !this.cockpitOn;
    this.body.add(this.mesh);
  }

  /**
   * Danno: stacca fino a n cubetti vicino al punto locale (metri, sistema dell'auto: x avanti, z destra).
   * Ritorna l'elenco dei cubetti staccati [{x,y,z (locali, m), color}] per gli effetti.
   */
  damage(lx, ly, lz, n) {
    const g = this.grid;
    const cx = lx / VOX + (NX - 1) / 2 + 0.5, cy = ly / VOX, cz = lz / VOX + NZ / 2;
    const cand = [];
    const R = 5;
    for (let x = Math.floor(cx - R); x <= cx + R; x++)
      for (let y = Math.max(1, Math.floor(cy - R)); y <= cy + R; y++)
        for (let z = Math.floor(cz - R); z <= cz + R; z++) {
          const v = g.get(x, y, z);
          if (!v) continue;
          // solo voxel esposti
          if (g.get(x + 1, y, z) && g.get(x - 1, y, z) && g.get(x, y + 1, z) && g.get(x, y, z + 1) && g.get(x, y, z - 1)) continue;
          const d = (x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2;
          cand.push([d + Math.random() * 6, x, y, z, v]);
        }
    cand.sort((a, b) => a[0] - b[0]);
    const out = [];
    for (let k = 0; k < Math.min(n, cand.length); k++) {
      const [, x, y, z, v] = cand[k];
      // non bucare troppo: tieni le luci
      g.set(x, y, z, 0);
      out.push({ x: (x - (NX - 1) / 2 - 0.5) * VOX, y: y * VOX, z: (z - NZ / 2) * VOX, color: g.palette[v - 1].color, mat: g.palette[v - 1].mat });
    }
    this.lost += out.length;
    if (out.length) this.pendingRemesh = true;
    return out;
  }

  /** aggiorna posa e animazioni dallo stato fisico */
  update(car, dt, now) {
    const G = this.group;
    G.position.set(car.x, car.y, car.z);
    G.rotation.set(0, -car.yaw, 0);
    // assetto: beccheggio dalla pendenza + accelerazione, rollio dalla curva + inclinazione della strada
    this.body.rotation.set(-(car.roll + (car.bankRoll || 0)), 0, car.pitch, 'XYZ');
    // ruote
    for (const w of this.wheels) {
      w.spin.rotation.z = -car.wheelSpin;
      w.pivot.rotation.y = w.front ? -car.delta * 1.2 : 0;
    }
    // stop
    const br = car.brake > 0.1 || (car.gear === -1);
    this.brakeMat.color.setScalar(br ? 4.5 : 1.1);
    if (this.pendingRemesh && now - this.lastRemesh > 0.2) {
      this._remesh();
      this.pendingRemesh = false;
      this.lastRemesh = now;
    }
  }

  setCockpit(on) {
    this.cockpitOn = on;
    this.cockpit.visible = on;
    this.mesh.visible = !on;
    for (const w of this.wheels) w.pivot.visible = !on;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.cockpit.geometry.dispose();
  }
}

/** Anteprima statica (menu): mesh dell'auto senza fisica */
export function carPreview(spec, livery, number) {
  const v = new CarVisual(spec, livery, number);
  return v;
}
