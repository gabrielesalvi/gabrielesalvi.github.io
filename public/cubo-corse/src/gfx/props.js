// Libreria dei modelli voxel di scenario per Cubo Corse.
//
// Convenzioni (valgono per tutti i costruttori a griglia):
//  - ritornano { grid, scale, origin, extra? };
//  - scale = lato di un voxel in metri;
//  - origin = centro della base in unità voxel: chi posiziona il modello mette origin nel punto a terra
//    (per le barche è sulla linea di galleggiamento);
//  - il "davanti" guarda verso -z (facciate, tribune, fari, serrande...);
//  - extra contiene posizioni in metri relative a origin.
// Si trasformano in mesh con voxelMesh(grid, { scale, origin }) di voxel.js.
//
// Nella griglia: x = larghezza, y = alto, z = profondità. z = 0 è il lato del davanti.
import * as THREE from 'three';
import { VoxelGrid, MAT, voxelMesh } from './voxel.js';

// ================================================================== utilità

const clamp255 = (v) => Math.max(0, Math.min(255, Math.round(v)));
/** schiarisce/scurisce un colore esadecimale (f > 1 schiarisce) */
export function tinta(c, f) {
  return (clamp255(((c >> 16) & 255) * f) << 16) | (clamp255(((c >> 8) & 255) * f) << 8) | clamp255((c & 255) * f);
}
/** miscela lineare fra due colori esadecimali */
export function mescola(a, b, t) {
  const ch = (s) => clamp255(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}
const scegli = (rng, arr) => arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))];
const intero = (rng, a, b) => a + Math.min(b - a, Math.floor(rng() * (b - a + 1)));
const varia = (rng, c, k = 0.06) => tinta(c, 1 + (rng() * 2 - 1) * k);
const arrot = (v) => Math.round(v * 1000) / 1000;
/** punto della griglia (in voxel, anche frazionario) → metri relativi a origin */
const metri = (o, S, x, y, z) => ({ x: arrot((x - o[0]) * S), y: arrot((y - o[1]) * S), z: arrot((z - o[2]) * S) });

/** riempie un cilindro verticale: celle col centro entro r da (cx, cz) */
function disco(g, cx, cz, r, y0, y1, v) {
  for (let z = Math.floor(cz - r - 1); z <= cz + r + 1; z++)
    for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x++) {
      const dx = x + 0.5 - cx, dz = z + 0.5 - cz;
      if (dx * dx + dz * dz <= r * r) for (let y = y0; y < y1; y++) g.set(x, y, z, v);
    }
}
/** come disco ma solo la corona r0 < d <= r1 */
function anello(g, cx, cz, r0, r1, y0, y1, v, filtro = null) {
  for (let z = Math.floor(cz - r1 - 1); z <= cz + r1 + 1; z++)
    for (let x = Math.floor(cx - r1 - 1); x <= cx + r1 + 1; x++) {
      const dx = x + 0.5 - cx, dz = z + 0.5 - cz, d2 = dx * dx + dz * dz;
      if (d2 > r0 * r0 && d2 <= r1 * r1 && (!filtro || filtro(x, z)))
        for (let y = y0; y < y1; y++) g.set(x, y, z, v);
    }
}
/** segmento spesso da a a b (in voxel): cubetti di lato s */
function linea(g, a, b, s, v) {
  const n = Math.ceil(Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]), Math.abs(b[2] - a[2])) * 1.5) + 1;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = Math.round(a[0] + (b[0] - a[0]) * t), y = Math.round(a[1] + (b[1] - a[1]) * t), z = Math.round(a[2] + (b[2] - a[2]) * t);
    g.box(x, y, z, x + s, y + s, z + s, v);
  }
}
/** prima cella piena dall'alto nella colonna (x, z), o -1 */
function cima(g, x, z) {
  for (let y = g.ny - 1; y >= 0; y--) if (g.get(x, y, z)) return y;
  return -1;
}

/**
 * Sistema di riferimento di una facciata del parallelepipedo [X0,X1)×[Z0,Z1).
 * u corre da sinistra a destra per chi guarda la facciata da fuori, d è la profondità
 * (0 = strato esterno del muro, negativo = fuori, positivo = dentro).
 */
function facciata(g, X0, Z0, X1, Z1, lato) {
  let map, len;
  if (lato === 'fronte') { len = X1 - X0; map = (u, d) => [X1 - 1 - u, Z0 + d]; }
  else if (lato === 'retro') { len = X1 - X0; map = (u, d) => [X0 + u, Z1 - 1 - d]; }
  else if (lato === 'sinistra') { len = Z1 - Z0; map = (u, d) => [X0 + d, Z0 + u]; }
  else { len = Z1 - Z0; map = (u, d) => [X1 - 1 - d, Z1 - 1 - u]; }
  const F = {
    len,
    set(u, y, d, v) { const [x, z] = map(u, d); g.set(x, y, z, v); },
    get(u, y, d) { const [x, z] = map(u, d); return g.get(x, y, z); },
    box(u0, y0, d0, u1, y1, d1, v) {
      for (let y = y0; y < y1; y++) for (let d = d0; d < d1; d++) for (let u = u0; u < u1; u++) F.set(u, y, d, v);
    },
    paint(u0, y0, d0, u1, y1, d1, v) {
      for (let y = y0; y < y1; y++) for (let d = d0; d < d1; d++) for (let u = u0; u < u1; u++) if (F.get(u, y, d)) F.set(u, y, d, v);
    },
  };
  return F;
}
const QUATTRO_LATI = ['fronte', 'retro', 'sinistra', 'destra'];

/** posizioni (u del bordo sinistro) di aperture larghe w distribuite su una facciata lunga len */
function colonne(len, w, passo) {
  const n = Math.max(1, Math.floor((len - 1) / passo));
  const sp = len / n, out = [];
  for (let i = 0; i < n; i++) out.push(Math.round(sp * (i + 0.5) - w / 2));
  return out;
}

/** tetto a padiglione in coppi: strati che rientrano di `rientro` voxel per lato */
function padiglione(g, x0, z0, x1, z1, y, coppi, rientro = 2) {
  let k = 0;
  for (; ; k++) {
    const a = x0 + rientro * k, b = x1 - rientro * k, c = z0 + rientro * k, d = z1 - rientro * k;
    if (b - a <= 0 || d - c <= 0) break;
    g.box(a, y + k, c, b, y + k + 1, d, coppi[k % coppi.length]);
  }
  return k; // numero di strati
}
const stratiPadiglione = (w, d, rientro = 2) => Math.ceil(Math.min(w, d) / (2 * rientro));

// tavolozze condivise
const INTONACI = [0xc9a26a, 0xc99484, 0xd8bf7a, 0xb87556, 0xe0d4b6, 0xa3b7bd, 0xd2a98a];
const PERSIANE = [0x3f5b45, 0x2f4a3a, 0x5b4030, 0x4f5f4a, 0x6a4a32, 0x47604f];
const TENDE = [[0xe6dcc6, 0x2f5d50], [0xe6dcc6, 0x8a3b38], [0x2e4a6b, 0xe6dcc6], [0xc28a3e, 0xe6dcc6], [0x6b2f2f, 0x6b2f2f], [0x3d5d48, 0x3d5d48], [0xb5643c, 0xe6dcc6]];
const LUMI = [0xb08a5a, 0xa8865e, 0xb69468, 0xa07c58];
const COPPI = [0xa65a3c, 0x96523a];

// ================================================================== 1. palazzo

/** Palazzo mediterraneo da lungomare. scala 0.5 m. */
export function palazzo(rng, { larghezza = 12, profondita = 10, piani } = {}) {
  const S = 0.5;
  const nP = Math.max(2, piani ?? intero(rng, 4, 6));
  const W = Math.max(10, Math.round(larghezza / S)), D = Math.max(8, Math.round(profondita / S));
  const hT = 8, hP = 6, Hw = hT + hP * (nP - 1);       // piano terra 4 m, piani 3 m
  const terrazza = rng() < 0.4;
  const X0 = 1, X1 = X0 + W, Z0 = 2, Z1 = Z0 + D;       // davanti 2 voxel di margine per i balconi
  const g = new VoxelGrid(W + 2, Hw + 1 + (terrazza ? 7 : stratiPadiglione(W + 2, D + 2, 3) + 4), D + 3);

  const base = varia(rng, scegli(rng, INTONACI), 0.04);
  const cMuro = g.p(base);
  const cZoc = g.p(tinta(mescola(base, 0x7c776e, 0.65), 0.9));
  const cFascia = g.p(mescola(base, 0xf0e8d6, 0.6));
  const cPers = g.p(varia(rng, scegli(rng, PERSIANE), 0.05));
  const cVetro = g.p(0x34424b, MAT.GLASS);
  const lumi = LUMI.map((c) => g.p(c, MAT.NIGHT));
  const cNegozio = g.p(0xc2ad86, MAT.NIGHT);
  const cFerro = g.p(0x34383a, MAT.METAL);
  const cLegno = g.p(varia(rng, 0x4a3324, 0.08));
  const cPietra = g.p(0xcfc8b8);
  const vetro = () => (rng() < 0.36 ? scegli(rng, lumi) : cVetro);

  // volume, zoccolo, marcapiano e cornicione
  g.box(X0, 0, Z0, X1, Hw, Z1, cMuro);
  g.box(X0, 0, Z0, X1, 2, Z1, cZoc);
  g.box(X0 - 1, hT, Z0 - 1, X1 + 1, hT + 1, Z1 + 1, cFascia);
  g.box(X0 - 1, Hw, Z0 - 1, X1 + 1, Hw + 1, Z1 + 1, cFascia);

  const [Ff, Fr, Fs, Fd] = QUATTRO_LATI.map((l) => facciata(g, X0, Z0, X1, Z1, l));
  // finestra con persiane: aperte (vetro incassato, ante accostate al muro) o chiuse.
  // Le ante stanno a filo del muro: sono spesse pochi centimetri e così non moltiplicano i quad dell'AO.
  // Sui fianchi il vetro sta a filo (incasso = false): costa un terzo dei triangoli.
  const finestra = (F, u, y, w, h, aperte = rng() < 0.6, incasso = true) => {
    if (aperte) {
      if (incasso) { F.box(u, y, 0, u + w, y + h, 1, 0); F.box(u, y, 1, u + w, y + h, 2, vetro()); }
      else F.box(u, y, 0, u + w, y + h, 1, vetro());
      F.box(u - 1, y, 0, u, y + h, 1, cPers);
      F.box(u + w, y, 0, u + w + 1, y + h, 1, cPers);
    } else F.box(u, y, 0, u + w, y + h, 1, cPers);
  };

  // --- fronte: piani superiori con balconi
  const colF = colonne(W, 2, 5);
  const balconata = rng() < 0.3;                       // balcone continuo al primo piano
  const conBalcone = colF.map(() => rng() < 0.6);
  for (let p = 1; p < nP; p++) {
    const fy = hT + (p - 1) * hP;
    const continuo = balconata && p === 1;
    if (continuo) {
      Ff.box(0, fy, -2, W, fy + 1, 0, cPietra);
      for (let u = 0; u < W; u += 3) Ff.set(u, fy + 1, -2, cFerro);
      Ff.set(W - 1, fy + 1, -2, cFerro);
      Ff.box(0, fy + 2, -2, W, fy + 3, -1, cFerro);
      Ff.box(0, fy + 1, -1, 1, fy + 3, 0, cFerro);
      Ff.box(W - 1, fy + 1, -1, W, fy + 3, 0, cFerro);
    }
    colF.forEach((u, i) => {
      const bal = continuo || conBalcone[i];
      if (bal && !continuo) {
        Ff.box(u - 1, fy, -2, u + 3, fy + 1, 0, cPietra);
        Ff.set(u - 1, fy + 1, -2, cFerro);
        Ff.set(u + 2, fy + 1, -2, cFerro);
        Ff.box(u - 1, fy + 2, -2, u + 3, fy + 3, -1, cFerro);
      }
      if (bal) finestra(Ff, u, fy + 1, 2, 4);
      else finestra(Ff, u, fy + 2, 2, 3);
    });
  }
  // --- fronte: piano terra con vetrine, tende e un portone
  const colT = colonne(W, 4, 6);
  const iPortone = Math.floor(rng() * colT.length);
  colT.forEach((u, i) => {
    if (i === iPortone) {
      Ff.box(u, 0, 0, u + 4, 6, 1, 0);
      Ff.box(u, 0, 1, u + 4, 6, 2, cLegno);
      Ff.set(u, 5, 0, cFascia); Ff.set(u + 3, 5, 0, cFascia); // spalle dell'arco
      Ff.box(u, 6, -1, u + 4, 7, 0, cFascia);                  // architrave
      return;
    }
    Ff.box(u, 0, 0, u + 4, 6, 1, 0);
    Ff.box(u, 1, 1, u + 4, 6, 2, rng() < 0.45 ? cNegozio : cVetro);
    Ff.box(u, 0, 1, u + 4, 1, 2, cZoc);
    if (rng() < 0.8) {
      const [t1, t2] = scegli(rng, TENDE);
      const a = g.p(varia(rng, t1, 0.04)), b = g.p(varia(rng, t2, 0.04));
      for (let k = 0; k < 4; k++) {
        const c = k % 2 ? b : a;
        Ff.set(u + k, 6, -1, c); Ff.set(u + k, 6, -2, c); Ff.set(u + k, 5, -2, c);
      }
    }
  });

  // --- retro e fianchi: finestre su tutti i piani (i fianchi a volte ciechi)
  const finestreLato = (F, len, cieco) => {
    const cols = colonne(len, 2, 5);
    for (let p = 0; p < nP; p++) {
      const fy = p === 0 ? 1 : hT + (p - 1) * hP;
      cols.forEach((u, i) => {
        if (cieco && i !== (cols.length >> 1)) return;
        if (p === 0 && F !== Fr) return;   // fianchi ciechi al piano terra
        if (p === 0 && F === Fr && i === 0) { // porta sul retro
          F.box(u, 0, 0, u + 2, 5, 1, 0); F.box(u, 0, 1, u + 2, 5, 2, cLegno);
          return;
        }
        finestra(F, u, fy + 1, 2, 3, undefined, F === Fr);
      });
    }
  };
  finestreLato(Fr, W, false);
  finestreLato(Fs, D, rng() < 0.4);
  finestreLato(Fd, D, rng() < 0.4);

  // --- tetto
  if (terrazza) {
    g.box(X0, Hw + 1, Z0, X1, Hw + 3, Z1, cMuro);
    g.box(X0 + 1, Hw + 1, Z0 + 1, X1 - 1, Hw + 3, Z1 - 1, 0);
    g.paint(X0, Hw + 2, Z0, X1, Hw + 3, Z1, cFascia);
    g.paint(X0 + 1, Hw, Z0 + 1, X1 - 1, Hw + 1, Z1 - 1, g.p(0xa9765a)); // pavimento in cotto
    // torrino della scala con porta
    const tx1 = X1 - 2, tz1 = Z1 - 2, tx0 = tx1 - 6, tz0 = tz1 - 5;
    g.box(tx0, Hw + 1, tz0, tx1, Hw + 6, tz1, cMuro);
    g.box(tx0 - 1, Hw + 6, tz0 - 1, tx1 + 1, Hw + 7, tz1 + 1, cFascia);
    g.box(tx0 + 2, Hw + 1, tz0, tx0 + 4, Hw + 5, tz0 + 1, cLegno);
    // vasi di piante sul parapetto
    const cVaso = g.p(0xa0573a), cPianta = g.p(varia(rng, 0x4f6b38, 0.1), MAT.FOLIAGE);
    for (let i = 0; i < 3; i++) {
      const x = X0 + 2 + Math.floor(rng() * (W - 10));
      g.set(x, Hw + 1, Z0 + 1, cVaso); g.box(x, Hw + 2, Z0 + 1, x + 2, Hw + 3, Z0 + 2, cPianta);
    }
  } else {
    const coppi = COPPI.map((c) => g.p(varia(rng, c, 0.04)));
    padiglione(g, X0 - 1, Z0 - 1, X1 + 1, Z1 + 1, Hw + 1, coppi, 3);
    // comignoli
    for (let i = intero(rng, 1, 2); i > 0; i--) {
      const x = X0 + 3 + Math.floor(rng() * (W - 6)), z = Z0 + 3 + Math.floor(rng() * (D - 6));
      const y = cima(g, x, z) + 1;
      g.box(x, y, z, x + 1, y + 2, z + 1, cMuro);
      g.box(x, y + 2, z, x + 1, y + 3, z + 1, cFascia);
    }
  }
  return { grid: g, scale: S, origin: [X0 + W / 2, 0, Z0 + D / 2], extra: { piani: nP, tetto: terrazza ? 'terrazza' : 'coppi' } };
}

// ================================================================== 2/9. chiese

/** Corpo comune per duomo e pieve: navata (con eventuali navate laterali), abside, facciata, campanile. */
function edificioSacro(rng, c) {
  const S = 0.5;
  const Wt = c.Wn + 2 * c.Wa, tw = c.torre.w;
  const bx0 = c.torre.lato < 0 ? tw + 2 : 1, bx1 = bx0 + Wt;
  const nx0 = bx0 + c.Wa, nx1 = bx1 - c.Wa, cxN = (nx0 + nx1) / 2;
  const Z0 = 1, Z1 = Z0 + c.L;
  const nk = stratiPadiglione(c.Wn + 2, 999);            // strati del tetto della navata
  const tx0 = c.torre.lato < 0 ? 1 : bx1 + 1;
  const tz0 = c.torre.z === 'retro' ? Z1 - tw - 4 : Z0 + 1;
  const th = c.torre.h, tettoT = Math.ceil(tw / 2) * c.torre.passo;
  const nxG = c.torre.lato < 0 ? bx1 + 1 : tx0 + tw + 1;
  const g = new VoxelGrid(nxG, Math.max(c.Hn + nk + 7, th + tettoT + 2), Z1 + c.rA + 2);

  const cMuro = g.p(c.muro);
  const cFacc = g.p(c.facciata);
  const cStr = g.p(c.striscia ?? c.facciata);
  const cCorn = g.p(c.cornice);
  const cZoc = g.p(tinta(c.muro, 0.8));
  const cTorre = g.p(c.torreColore ?? c.muro);
  const cTorreF = g.p(tinta(c.torreColore ?? c.muro, 1.12));
  const coppi = COPPI.map((x) => g.p(varia(rng, x, 0.04)));
  const cLegno = g.p(0x4b3122);
  const cVetro = g.p(0x2b3d5a, MAT.GLASS);
  const cLumi = [g.p(0xc8964a, MAT.NIGHT), g.p(0xa54c3c, MAT.NIGHT)];
  const cFerro = g.p(0x2b2a28, MAT.METAL);
  const cScuro = g.p(0x2a2622);
  const vetro = () => (rng() < 0.38 ? cLumi[0] : cVetro);

  // --- volumi
  if (c.Wa > 0) g.box(bx0, 0, Z0, bx1, c.Ha, Z1, cMuro);
  g.box(nx0, 0, Z0, nx1, c.Hn, Z1, cMuro);
  const HaA = c.Wa > 0 ? c.Ha : c.Hn - 4;
  for (let z = Z1; z <= Z1 + c.rA; z++)
    for (let x = Math.floor(cxN - c.rA - 1); x <= cxN + c.rA; x++)
      if ((x + 0.5 - cxN) ** 2 + (z + 0.5 - Z1) ** 2 <= c.rA * c.rA) g.box(x, 0, z, x + 1, HaA, z + 1, cMuro);
  // tetto dell'abside a mezzo cono
  for (let k = 0; ; k++) {
    const r = c.rA + 1 - 1.6 * k;
    if (r < 1) break;
    for (let z = Z1; z <= Z1 + r; z++)
      for (let x = Math.floor(cxN - r - 1); x <= cxN + r; x++)
        if ((x + 0.5 - cxN) ** 2 + (z + 0.5 - Z1) ** 2 <= r * r) g.set(x, HaA + k, z, coppi[k % 2]);
  }
  g.paint(0, 0, 0, nxG, 1, g.nz, cZoc);

  // --- tetto della navata a capanna, facciata che sporge sopra di un voxel
  for (let k = 0; k < nk; k++) {
    const xa = nx0 - 1 + 2 * k, xb = nx1 + 1 - 2 * k;
    g.box(xa, c.Hn + k, Z0 + 1, xb, c.Hn + k + 1, Z1 + 1, coppi[k % 2]);
    g.box(xa, c.Hn + k, Z0, xb, c.Hn + k + 2, Z0 + 1, cFacc);
  }
  const yApice = c.Hn + nk + 1;
  // navate laterali con tetto a falda unica
  let nkA = 0;
  if (c.Wa > 0) {
    for (let k = 0; c.Wa + 1 - 2 * k > 0; k++, nkA++) {
      g.box(bx0 - 1 + 2 * k, c.Ha + k, Z0 + 1, nx0, c.Ha + k + 1, Z1 + 1, coppi[k % 2]);
      g.box(nx1, c.Ha + k, Z0 + 1, bx1 + 1 - 2 * k, c.Ha + k + 1, Z1 + 1, coppi[k % 2]);
      g.box(bx0 - 1 + 2 * k, c.Ha + k, Z0, nx0, c.Ha + k + 2, Z0 + 1, cFacc);
      g.box(nx1, c.Ha + k, Z0, bx1 + 1 - 2 * k, c.Ha + k + 2, Z0 + 1, cFacc);
    }
  }
  // fasce della facciata (bicromia) e zoccolo
  for (let y = 1; y < g.ny; y++) g.paint(0, y, Z0, nxG, y + 1, Z0 + 1, c.striscia && (y >> 1) % 2 ? cStr : cFacc);

  const F = facciata(g, bx0, Z0, bx1, Z1, 'fronte');
  // --- portali con strombatura sporgente e arco
  const portale = (u, w, h) => {
    F.box(u, 0, 0, u + w, h, 1, 0);
    F.box(u, 0, 1, u + w, h, 2, cLegno);
    F.set(u, h - 1, 0, cCorn); F.set(u + w - 1, h - 1, 0, cCorn);
    F.box(u - 1, 0, -1, u, h + 1, 0, cCorn);
    F.box(u + w, 0, -1, u + w + 1, h + 1, 0, cCorn);
    F.box(u - 1, h, -1, u + w + 1, h + 1, 0, cCorn);
  };
  portale(c.Wa + (c.Wn - c.portale[0]) / 2, c.portale[0], c.portale[1]);
  if (c.Wa > 0) {
    portale((c.Wa - 2) >> 1, 2, 5);
    portale(Wt - c.Wa + ((c.Wa - 2) >> 1), 2, 5);
  }
  // --- rosone: trafori in pietra, vetri (GLASS) e vetri colorati che si accendono (NIGHT)
  {
    const uc = c.Wa + c.Wn / 2, yc = c.rosone.y, r = c.rosone.r;
    for (let y = Math.floor(yc - r - 2); y <= yc + r + 1; y++)
      for (let u = Math.floor(uc - r - 2); u <= uc + r + 1; u++) {
        const du = u + 0.5 - uc, dy = y + 0.5 - yc, d = Math.hypot(du, dy);
        if (d <= r) {
          if (r > 2.5 && d > 2.0 && d < 2.6) { F.set(u, y, 0, cCorn); continue; }   // anello di traforo
          // spicchi alterni di vetro (GLASS) e vetro colorato che di notte si accende (NIGHT)
          const spicchi = d < 2.0 ? 8 : 12, a = (Math.atan2(dy, du) + Math.PI) / (2 * Math.PI);
          F.set(u, y, 0, 0);
          F.set(u, y, 1, d < 1.2 ? cLumi[0] : Math.floor(a * spicchi) % 2 ? cVetro : cLumi[1]);
        } else if (d <= r + 1) F.set(u, y, -1, cCorn);
      }
  }
  // croce in cima alla facciata
  {
    const x = Math.floor(cxN);
    g.box(x, yApice, Z0, x + 1, yApice + 4, Z0 + 1, cFerro);
    g.box(x - 1, yApice + 2, Z0, x + 2, yApice + 3, Z0 + 1, cFerro);
  }
  // --- finestre laterali (monofore) e cleristorio
  for (const lato of ['sinistra', 'destra']) {
    const Fl = facciata(g, bx0, Z0, bx1, Z1, lato);
    const hW = c.Wa > 0 ? 5 : 4, yW = c.Wa > 0 ? 4 : Math.max(4, c.Hn - 9);
    for (let u = 5; u < c.L - 3; u += 6) {
      Fl.box(u, yW, 0, u + 1, yW + hW, 1, 0);
      Fl.set(u, yW, 1, cScuro);
      Fl.box(u, yW + 1, 1, u + 1, yW + hW, 2, vetro());
    }
    if (c.Wa > 0) {
      const Fn = facciata(g, nx0, Z0, nx1, Z1, lato), y0 = c.Ha + nkA + 1;
      for (let u = 4; u < c.L - 2; u += 5) {
        Fn.box(u, y0, 0, u + 1, c.Hn - 1, 1, 0);
        Fn.box(u, y0, 1, u + 1, c.Hn - 1, 2, vetro());
      }
    }
  }

  // --- campanile
  {
    const cx = tx0 + tw / 2, cz = tz0 + tw / 2;
    g.box(tx0, 0, tz0, tx0 + tw, th, tz0 + tw, cTorre);
    for (let y = 10; y < th - 10; y += 12) g.paint(tx0, y, tz0, tx0 + tw, y + 1, tz0 + tw, cTorreF);
    if (c.striscia) for (let y = 2; y < th - 10; y += 4) g.paint(tx0, y, tz0, tx0 + tw, y + 2, tz0 + tw, cStr);
    const yb0 = th - 10, yb1 = th - 2;
    g.box(tx0 + 1, yb0, tz0 + 1, tx0 + tw - 1, yb1, tz0 + tw - 1, 0);   // cella campanaria cava
    const ow = Math.floor((tw - 4) / 2);
    for (const lato of QUATTRO_LATI) {
      const Ft = facciata(g, tx0, tz0, tx0 + tw, tz0 + tw, lato);
      for (const u of [1, tw - 1 - ow]) Ft.box(u, yb0 + 1, 0, u + ow, yb1 - 1, 1, 0);   // bifore
      for (let y = 6; y < yb0 - 8; y += 9) Ft.box((tw >> 1) - 1 + (y % 2), y, 0, (tw >> 1) + (y % 2), y + 2, 1, cScuro); // feritoie
    }
    g.box(Math.floor(cx) - 1, yb1 - 4, Math.floor(cz) - 1, Math.floor(cx) + 1, yb1 - 1, Math.floor(cz) + 1, g.p(0x8a6a3a, MAT.METAL)); // campana
    g.box(tx0 - 1, th - 2, tz0 - 1, tx0 + tw + 1, th - 1, tz0 + tw + 1, cTorreF);
    // orologio sul lato davanti
    if (c.orologio) {
      const Ft = facciata(g, tx0, tz0, tx0 + tw, tz0 + tw, 'fronte');
      const uc = tw / 2, yc = yb0 - 5;
      const cQuad = g.p(0xe8e2d2), cLanc = g.p(0x22201c);
      for (let y = yc - 3; y <= yc + 3; y++)
        for (let u = 0; u < tw; u++) if (Math.hypot(u + 0.5 - uc, y + 0.5 - yc) <= 2.3) Ft.set(u, y, 0, cQuad);
      Ft.box(Math.floor(uc), Math.floor(yc), 0, Math.floor(uc) + 1, Math.floor(yc) + 2, 1, cLanc);
      Ft.set(Math.floor(uc) + 1, Math.floor(yc), 0, cLanc);
    }
    // copertura: piramide (passo = altezza di ogni gradino)
    const cTetto = g.p(c.torre.tetto ?? COPPI[0]);
    for (let k = 0; k * 2 < tw; k++)
      g.box(tx0 + k, th - 1 + k * c.torre.passo, tz0 + k, tx0 + tw - k, th - 1 + (k + 1) * c.torre.passo, tz0 + tw - k, cTetto);
  }
  const origin = [nxG / 2, 0, (Z0 + Z1 + c.rA) / 2];
  return { grid: g, scale: S, origin, extra: { campana: metri(origin, S, tx0 + tw / 2, th - 5, tz0 + tw / 2) } };
}

/** Duomo piccolo con facciata a capanna (a salienti), rosone e campanile. scala 0.5 m. */
export function chiesa(rng) {
  const bicromo = rng() < 0.5;
  const marmo = varia(rng, 0xe4ddcc, 0.03);
  return edificioSacro(rng, {
    Wn: 14, Wa: 6, L: 44, Hn: 26, Ha: 15, rA: 7,
    muro: bicromo ? varia(rng, 0xcfc4ae, 0.04) : varia(rng, scegli(rng, [0xd6c39a, 0xcdb48e, 0xd8c8a8]), 0.04),
    facciata: marmo,
    striscia: bicromo ? varia(rng, 0x59615a, 0.06) : null,
    cornice: tinta(marmo, 1.04),
    torreColore: bicromo ? marmo : varia(rng, 0xa9634a, 0.05),
    portale: [4, 9], rosone: { r: 3.6, y: 20 }, orologio: true,
    torre: { w: 8, h: 56, lato: 1, z: 'retro', passo: 2, tetto: scegli(rng, [0x6f8a7c, 0x9a5a3e]) },
  });
}

/** Pieve romanica in pietra con campanile. scala 0.5 m. */
export function cappella(rng) {
  const pietra = varia(rng, scegli(rng, [0xb3a48a, 0xa8997e, 0xbcae94]), 0.04);
  return edificioSacro(rng, {
    Wn: 12, Wa: 0, L: 28, Hn: 14, Ha: 0, rA: 5,
    muro: pietra, facciata: tinta(pietra, 1.05), striscia: null, cornice: tinta(pietra, 1.15),
    torreColore: tinta(pietra, 0.95),
    portale: [4, 7], rosone: { r: 1.6, y: 11 }, orologio: false,
    torre: { w: 6, h: 34, lato: rng() < 0.5 ? -1 : 1, z: 'fronte', passo: 1 },
  });
}

// ================================================================== 3. faro

/** Faro a fasce bianche e rosse, alto ~22 m. scala 0.5 m. extra.luce = centro della lanterna. */
export function faro(rng) {
  const S = 0.5, n = 15, c = 7.5;
  const g = new VoxelGrid(n, 45, n);
  const rosso = g.p(varia(rng, scegli(rng, [0xa8392f, 0x9a3a30, 0xb04434]), 0.04)), bianco = g.p(0xe8e4dc);
  const pietra = g.p(varia(rng, 0x9a9184, 0.05)), pietraS = g.p(0x7f776b);
  const ferro = g.p(0x2b2e30, MAT.METAL), luce = g.p(0xfff1c8, MAT.LIGHT);
  const vetro = g.p(0x2c3a44, MAT.GLASS), legno = g.p(0x3f4a52);
  // basamento a gradini
  disco(g, c, c, 7.2, 0, 1, pietraS);
  disco(g, c, c, 6.2, 1, 2, pietra);
  // fusto rastremato a fasce
  const yTop = 34;
  for (let y = 2; y < yTop; y++) {
    const t = (y - 2) / (yTop - 2);
    disco(g, c, c, 3.7 - 1.1 * t, y, y + 1, Math.floor((y - 2) / 5) % 2 ? rosso : bianco);
  }
  disco(g, c, c, 3.3, yTop - 1, yTop, bianco);
  // porta e finestrelle (sul davanti e dietro)
  g.box(6, 2, 0, 9, 7, 5, 0);
  for (let x = 6; x < 9; x++) { const z = 5; g.box(x, 2, z, x + 1, 7, z + 1, legno); }
  g.set(6, 6, 4, bianco); g.set(8, 6, 4, bianco);   // spalle dell'arco
  for (let y = 11; y < yTop - 4; y += 7) {
    for (const dir of [-1, 1]) {
      const z0 = dir < 0 ? 0 : n - 1;
      let z = z0;
      while (!g.get(7, y, z) && z >= 0 && z < n) z -= dir;
      g.box(7, y, z, 8, y + 2, z + 1, vetro);
    }
  }
  // ballatoio con ringhiera
  disco(g, c, c, 4.6, yTop, yTop + 1, pietraS);
  anello(g, c, c, 3.7, 4.6, yTop + 2, yTop + 3, ferro);
  anello(g, c, c, 3.7, 4.6, yTop + 1, yTop + 2, ferro, (x, z) => (x + z) % 2 === 0);
  // lanterna
  disco(g, c, c, 2.3, yTop + 1, yTop + 2, ferro);
  disco(g, c, c, 2.3, yTop + 2, yTop + 5, luce);
  anello(g, c, c, 1.9, 2.3, yTop + 2, yTop + 5, ferro, (x, z) => Math.abs(x - 7) === 2 && Math.abs(z - 7) === 1);  // montanti
  disco(g, c, c, 2.4, yTop + 5, yTop + 6, rosso);
  disco(g, c, c, 1.5, yTop + 6, yTop + 7, rosso);
  g.box(7, yTop + 7, 7, 8, yTop + 9, 8, ferro);
  const origin = [c, 0, c];
  return { grid: g, scale: S, origin, extra: { luce: metri(origin, S, c, yTop + 3.5, c) } };
}

// ================================================================== 4. yacht

/** Yacht a motore. scala 0.25 m, prua verso -z, origin sulla linea di galleggiamento. */
export function yacht(rng, { lunghezza = 14 } = {}) {
  const S = 0.25;
  const L = Math.max(24, Math.round(lunghezza / S));
  const B = Math.round(L * 0.27 / 2) * 2;                // baglio massimo (pari)
  const wl = 4, plat = 3;                                // pescaggio 1 m, plancetta 0.75 m
  const nx = B + 2, cx = nx / 2;
  const g = new VoxelGrid(nx, wl + 26, L + plat);
  const blu = rng() < 0.35;
  const cScafo = g.p(blu ? varia(rng, 0x1f3048, 0.08) : 0xe9ebec, MAT.PAINT);
  const cLinea = g.p(blu ? 0xe2e4e4 : varia(rng, scegli(rng, [0x1f3048, 0x2c4f6b, 0x5d6870]), 0.06), MAT.PAINT);
  const cAnti = g.p(scegli(rng, [0x6e2c26, 0x2a3340, 0x23282e]));
  const cTeak = g.p(varia(rng, 0x9c7550, 0.05)), cTeakS = g.p(0x7e5c3e);
  const cTuga = g.p(0xeef0f0, MAT.PAINT);
  const cVetro = g.p(0x182229, MAT.GLASS);
  const cInox = g.p(0xc9ced2, MAT.METAL);
  const cObl = g.p(0x8a7650, MAT.NIGHT);

  const semiB = (t) => (t < 0.5 ? Math.pow(Math.sin((t / 0.5) * Math.PI / 2), 0.75) : 1 - 0.1 * ((t - 0.5) / 0.5) ** 2) * (B / 2);
  const ponte = (t) => wl + 6 + Math.round(3 * (1 - t) ** 2);   // quota della coperta (insellatura verso prua)
  const fattore = (y) => (y >= wl ? 1 : 0.25 + 0.75 * (y / wl) ** 0.7);
  for (let z = 0; z < L; z++) {
    const t = (z + 0.5) / L, top = ponte(t);
    for (let y = 0; y < top; y++) {
      const tt = y < wl ? ((z + 0.5) - (wl - y) * 1.8) / L : t;
      if (tt <= 0) continue;
      const w = semiB(tt) * fattore(y);
      for (let x = 0; x < nx; x++) {
        const dx = Math.abs(x + 0.5 - cx);
        if (dx > w) continue;
        let v = y < wl ? cAnti : y < wl + 1 ? cLinea : cScafo;
        if (y === top - 1 && dx < w - 1) v = (x % 3 === 0) ? cTeakS : cTeak;   // coperta incassata nella murata
        g.set(x, y, z, v);
      }
    }
  }
  // plancetta di poppa
  g.box(1, wl + 1, L - 1, nx - 1, wl + 2, L + plat, cTeak);
  // oblò sulle murate
  for (let z = Math.round(L * 0.14); z < L * 0.55; z += 4) {
    const y = ponte((z + 0.5) / L) - 3;
    for (const dir of [-1, 1]) {
      let x = dir < 0 ? 0 : nx - 1;
      while (!g.get(x, y, z) && x > 0 && x < nx - 1) x -= dir;
      g.set(x, y, z, cObl);
    }
  }
  // tuga con parabrezza inclinato e vetri scuri
  const z0 = Math.round(L * 0.3), z1 = Math.round(L * 0.78);
  const base = ponte(z0 / L), yT = base + 6;
  const half = Math.floor(semiB(0.6) * 0.72);
  for (let z = z0; z < z1; z++) {
    const top = Math.min(yT, ponte((z + 0.5) / L) + 2 + (z - z0));
    for (let y = ponte((z + 0.5) / L) - 1; y < top; y++)
      for (let x = Math.floor(cx) - half; x < Math.ceil(cx) + half; x++) {
        const front = z - z0 < yT - base - 2 && y >= top - 2;      // gradini del parabrezza
        const lato = (x === Math.floor(cx) - half || x === Math.ceil(cx) + half - 1) && y >= base + 2 && y < yT - 1 && z < z1 - 2;
        g.set(x, y, z, front || lato ? cVetro : cTuga);
      }
  }
  // hardtop su montanti inox
  if (rng() < 0.6) {
    const za = z1 - 2, zb = Math.min(L - 3, z1 + 6);
    g.box(Math.floor(cx) - half, yT + 3, za - 4, Math.ceil(cx) + half, yT + 4, zb, cTuga);
    for (const x of [Math.floor(cx) - half, Math.ceil(cx) + half - 1]) g.box(x, ponte(zb / L) - 1, zb - 1, x + 1, yT + 3, zb, cInox);
  } else {
    // arco radar
    g.box(Math.floor(cx) - 1, yT, z1 - 4, Math.ceil(cx) + 1, yT + 3, z1 - 2, cTuga);
    g.box(Math.floor(cx), yT + 3, z1 - 3, Math.ceil(cx), yT + 4, z1 - 2, cInox);
  }
  // battagliola: candelieri e corrimano lungo il ponte di prua, pulpito a prua
  for (let z = 2; z < z0 + 2; z++) {
    const t = (z + 0.5) / L, top = ponte(t), w = semiB(t);
    for (const s of [-1, 1]) {
      const x = Math.floor(cx + s * (w - 0.6));
      if (z % 4 === 2) g.set(x, top, z, cInox);
      g.set(x, top + 1, z, cInox);
    }
  }
  const origin = [cx, wl, L / 2];
  return { grid: g, scale: S, origin, extra: { lunghezza: L * S } };
}

// ================================================================== 5. barca (gozzo)

/** Gozzo di legno, doppia punta con ruota di prua alta. scala 0.25 m, origin sul galleggiamento. */
export function barca(rng) {
  const S = 0.25;
  const L = intero(rng, 22, 28), B = 9, wl = 2, F = 3;
  const nx = B + 2, cx = nx / 2;
  const g = new VoxelGrid(nx, wl + F + 7, L);
  const cBianco = g.p(varia(rng, 0xe4e0d4, 0.03), MAT.PAINT);
  const cCinta = g.p(varia(rng, scegli(rng, [0x2f5b84, 0x3c6a4a, 0x9a3b30, 0x2e8a9a, 0xd0a238]), 0.05), MAT.PAINT);
  const cAnti = g.p(0x7a3a2e);
  const cLegno = g.p(varia(rng, 0x9a7a52, 0.06)), cLegnoS = g.p(0x6e5236);
  const semi = (t) => (B / 2) * Math.pow(Math.max(0, Math.sin(Math.PI * t)), 0.8);
  const bordo = (t) => wl + F + Math.round(2.5 * Math.abs(2 * t - 1) ** 3);
  for (let z = 0; z < L; z++) {
    const t = (z + 0.5) / L, top = bordo(t);
    for (let y = 0; y < top; y++) {
      const w = semi(t) * (y >= wl ? 1 : 0.4 + 0.6 * y / wl);
      for (let x = 0; x < nx; x++) {
        const dx = Math.abs(x + 0.5 - cx);
        if (dx > w) continue;
        const interno = y >= 1 && dx < w - 1 && t > 0.1 && t < 0.9;
        if (interno) {
          if (y === 1) g.set(x, y, z, cLegno);                       // pagliolo
          continue;
        }
        const coperta = y >= 1 && dx < w - 1;                          // coperte di prua e di poppa
        let v = y < wl ? cAnti : y === top - 1 ? cLegnoS : y === top - 2 ? cCinta : cBianco;
        if (coperta) v = y === top - 1 ? cLegno : cBianco;
        g.set(x, y, z, v);
      }
    }
  }
  // ruota di prua alta e dritto di poppa
  const xc = Math.floor(cx);
  const yP = bordo(0.5 / L), yA = bordo((L - 0.5) / L);
  g.box(xc, yP, 0, xc + 1, yP + 3, 1, cLegnoS);
  g.box(xc, yA, L - 1, xc + 1, yA + 1, L, cLegnoS);
  // banchi e cassa motore
  for (const t of [0.32, 0.62]) {
    const z = Math.round(L * t);
    for (let x = 0; x < nx; x++) if (Math.abs(x + 0.5 - cx) < semi(t) - 0.5) g.set(x, wl + F - 2, z, cLegno);
  }
  g.box(xc - 1, 2, Math.round(L * 0.45), xc + 2, 4, Math.round(L * 0.45) + 3, cLegnoS);
  // remi appoggiati sul bordo
  if (rng() < 0.5) {
    const z = Math.round(L * 0.25);
    g.box(1, wl + F, z, 2, wl + F + 1, z + Math.round(L * 0.4), cLegno);
  }
  return { grid: g, scale: S, origin: [cx, wl, L / 2] };
}

// ================================================================== 6. gru portuale

/** Gru portuale a portale con braccio verso -z, alta ~25 m. scala 0.5 m. */
export function gru(rng) {
  const S = 0.5, P = 14, Zp = 34;
  const nx = P + 2, nz = Zp + P + 6, X0 = 1;
  const g = new VoxelGrid(nx, 52, nz);
  const giallo = rng() < 0.55;
  const cStr = g.p(varia(rng, giallo ? 0xd2a12c : 0xc8642c, 0.04), MAT.METAL);
  const cScuro = g.p(0x3a3a3a, MAT.METAL);
  const cCem = g.p(0x8d8a84);
  const cVetro = g.p(0x24313a, MAT.GLASS);
  const cBianco = g.p(0xe0e0dc);
  const cx = X0 + P / 2, cz = Zp + P / 2;
  // carrelli sui binari con strisce di pericolo, gambe, travi di testa
  for (const lx of [X0, X0 + P - 2]) for (const lz of [Zp, Zp + P - 2]) {
    g.box(lx, 0, lz - 1, lx + 2, 2, lz + 3, cScuro);
    for (let z = lz - 1; z < lz + 3; z += 2) g.box(lx, 1, z, lx + 2, 2, z + 1, cStr);
    g.box(lx, 2, lz, lx + 2, 14, lz + 2, cStr);
  }
  g.box(X0, 14, Zp, X0 + P, 16, Zp + 2, cStr);
  g.box(X0, 14, Zp + P - 2, X0 + P, 16, Zp + P, cStr);
  g.box(X0, 14, Zp, X0 + 2, 16, Zp + P, cStr);
  g.box(X0 + P - 2, 14, Zp, X0 + P, 16, Zp + P, cStr);
  // correnti longitudinali a mezza altezza sui due fianchi
  g.box(X0, 8, Zp, X0 + 2, 9, Zp + P, cStr);
  g.box(X0 + P - 2, 8, Zp, X0 + P, 9, Zp + P, cStr);
  // ralla, casa macchine, contrappeso, cabina
  disco(g, cx, cz, 4.2, 16, 17, cScuro);
  g.box(cx - 4, 17, cz - 3, cx + 4, 24, cz + 7, cStr);
  g.box(cx - 4, 23, cz - 3, cx + 4, 24, cz + 7, cBianco);
  g.box(cx - 3, 17, cz + 7, cx + 3, 23, cz + 10, cCem);
  g.box(cx + 1, 17, cz - 7, cx + 4, 22, cz - 3, cStr);
  g.box(cx + 1, 19, cz - 7, cx + 4, 21, cz - 6, cVetro);
  g.box(cx + 1, 19, cz - 7, cx + 2, 21, cz - 3, cVetro);
  // torre (cavalletto) e braccio inclinato
  g.box(cx - 1, 24, cz + 2, cx + 1, 49, cz + 4, cStr);
  g.box(cx - 2, 48, cz + 1, cx + 2, 50, cz + 5, cStr);
  const piede = [cx - 1, 21, cz - 3], punta = [cx - 1, 45, cz - 3 - 34];
  linea(g, piede, punta, 2, cStr);
  g.box(cx - 1, 45, punta[2] - 1, cx + 1, 47, punta[2] + 2, cScuro);   // testa del braccio
  linea(g, [cx, 49, cz + 3], [cx, 46, punta[2] + 1], 1, cScuro);      // tiranti
  // fune e gancio
  g.box(cx, 38, punta[2], cx + 1, 45, punta[2] + 1, cScuro);
  g.box(cx - 1, 36, punta[2] - 1, cx + 1, 38, punta[2] + 1, cStr);
  g.box(cx - 1, 35, punta[2] - 1, cx + 1, 36, punta[2] + 1, cScuro);
  return { grid: g, scale: S, origin: [cx, 0, cz], extra: { gancio: metri([cx, 0, cz], S, cx, 35, punta[2]) } };
}

// ================================================================== 7. alberi

/** Albero: tipo 'pino' | 'cipresso' | 'latifoglia' | 'palma' (a caso se assente). scala 0.5 m, ≤ 400 triangoli. */
export function albero(rng, tipo) {
  tipo = tipo ?? scegli(rng, ['pino', 'cipresso', 'latifoglia', 'palma']);
  const r = tipo === 'pino' ? pino(rng) : tipo === 'cipresso' ? cipresso(rng) : tipo === 'palma' ? palma(rng) : latifoglia(rng);
  r.extra = { ...(r.extra || {}), tipo };
  return r;
}
const VERDI = [0x46602f, 0x4f6a34, 0x3e5a30, 0x56703a, 0x4a6638];

function pino(rng) {
  const S = 0.5, Ht = intero(rng, 14, 20), R = intero(rng, 4, 5);
  const n = 4 * R + 6, t = n >> 1;
  const g = new VoxelGrid(n, Ht + 6, n);
  const verde = varia(rng, scegli(rng, [0x3c5530, 0x415a2c, 0x46602f]), 0.06);
  const cS = g.p(verde, MAT.FOLIAGE), cC = g.p(tinta(verde, 1.2), MAT.FOLIAGE);
  const cTronco = g.p(varia(rng, 0x6b5442, 0.06));
  const pende = scegli(rng, [-1, 0, 1]);
  for (let y = 0, prima = 0; y < Ht; y++) {
    const o = Math.round(pende * (y / Ht) ** 2);
    g.set(t + o, y, t, cTronco);
    if (o !== prima) g.set(t + prima, y, t, cTronco);   // raccordo: niente celle unite solo per lo spigolo
    prima = o;
  }
  g.box(t + pende - 1, Ht - 1, t, t + pende + 2, Ht, t + 1, cTronco);   // biforcazione
  const ccx = t + 0.5 + pende, ccz = t + 0.5;
  for (let i = -R; i < R; i++) for (let k = -R; k < R; k++) {
    const bx = t + pende + 2 * i, bz = t + 2 * k;
    const d = Math.hypot(bx + 1 - ccx, bz + 1 - ccz) / 2;
    if (d > R) continue;
    g.box(bx, Ht, bz, bx + 2, Ht + 2, bz + 2, cS);
    if (d < R - 1.9) g.box(bx, Ht + 2, bz, bx + 2, Ht + 3, bz + 2, cC);
  }
  return { grid: g, scale: S, origin: [t + 0.5, 0, t + 0.5] };
}

function cipresso(rng) {
  const S = 0.5, H = intero(rng, 18, 30);
  const g = new VoxelGrid(4, H + 1, 4);
  const verde = varia(rng, scegli(rng, [0x2f4429, 0x34492b, 0x2b3f27]), 0.06);
  const c1 = g.p(verde, MAT.FOLIAGE), c2 = g.p(tinta(verde, 1.15), MAT.FOLIAGE);
  g.box(1, 0, 1, 3, 1, 3, g.p(0x5a4636));
  const croce = (y0, y1, v) => { g.box(1, y0, 0, 3, y1, 4, v); g.box(0, y0, 1, 4, y1, 3, v); };
  const a = Math.round(H * 0.2), b = Math.round(H * 0.6), c = Math.round(H * 0.8), d = Math.round(H * 0.95);
  croce(1, a, c1);
  g.box(0, a, 0, 4, b, 4, c1);
  croce(b, c, c2);
  g.box(1, c, 1, 3, d, 3, c2);
  g.box(1, d, 1, 2, H + 1, 2, c2);
  return { grid: g, scale: S, origin: [2, 0, 2] };
}

function latifoglia(rng) {
  const S = 0.5, Ht = intero(rng, 6, 9), n = 16, t = 7;
  const g = new VoxelGrid(n, Ht + 12, n);
  const verde = varia(rng, scegli(rng, VERDI), 0.07);
  const c1 = g.p(verde, MAT.FOLIAGE), c2 = g.p(tinta(verde, 1.16), MAT.FOLIAGE);
  const cTronco = g.p(varia(rng, 0x5e4d3e, 0.06));
  g.box(t, 0, t, t + 1, Ht + 2, t + 1, cTronco);
  const yc = Ht + 4;
  g.box(t - 4, Ht, t - 3, t + 4, yc + 3, t + 5, c1);          // massa centrale 4 × 3.5 × 4 m
  // 2-3 masse laterali sui lati cardinali (allineate alla griglia pari: si fondono meglio)
  const lati = [[1, 0], [-1, 0], [0, 1], [0, -1]].sort(() => rng() - 0.5).slice(0, intero(rng, 2, 4));
  lati.forEach(([dx, dz], i) => {
    const w = 2 * intero(rng, 2, 3), h = 4, dy = 2 * intero(rng, 0, 1);
    const cx = t + dx * 4 + (dx ? 0 : 0), cz = t + 1 + dz * 4;
    const x0 = dx ? cx + (dx > 0 ? -1 : -3) : cx - w / 2, z0 = dz ? cz + (dz > 0 ? -1 : -3) : cz - w / 2;
    const ex = dx ? 4 : w, ez = dz ? 4 : w;
    g.box(x0, Ht + dy, z0, x0 + ex, Ht + dy + h, z0 + ez, i % 2 ? c2 : c1);
  });
  g.box(t - 2, yc + 3, t - 1, t + 2, yc + 5, t + 3, c2);       // cupola
  return { grid: g, scale: S, origin: [t + 0.5, 0, t + 0.5] };
}

function palma(rng) {
  const S = 0.5, Ht = intero(rng, 14, 22), n = 15, t = 7;
  const g = new VoxelGrid(n, Ht + 4, n);
  const cT1 = g.p(varia(rng, 0x8a7a64, 0.05)), cT2 = g.p(varia(rng, 0x75664f, 0.05));
  const verde = varia(rng, scegli(rng, [0x4f6b34, 0x5a7339, 0x48632f]), 0.06);
  const cF = g.p(verde, MAT.FOLIAGE), cF2 = g.p(tinta(verde, 0.82), MAT.FOLIAGE);
  const dir = rng() < 0.5 ? [1, 0] : [0, 1], curva = intero(rng, 0, 2) * (rng() < 0.5 ? -1 : 1);
  let px = t, pz = t;
  for (let y = 0; y < Ht; y++) {
    const o = Math.round(curva * (y / Ht) ** 2), c = Math.floor(y / 4) % 2 ? cT2 : cT1;
    if (t + dir[0] * o !== px || t + dir[1] * o !== pz) g.set(px, y, pz, c);   // raccordo della curva
    px = t + dir[0] * o; pz = t + dir[1] * o;
    g.set(px, y, pz, c);
  }
  const y = Ht;
  g.box(px, y - 1, pz, px + 1, y + 1, pz + 1, cF2);
  g.set(px, y + 1, pz, cF);
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    for (let i = 1; i <= 3; i++) g.set(px + dx * i, y, pz + dz * i, cF);
    g.set(px + dx * 4, y - 1, pz + dz * 4, cF);
    g.set(px + dx * 5, y - 2, pz + dz * 5, cF);
  }
  for (const [dx, dz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    g.set(px + dx, y, pz + dz, cF2);
    g.set(px + dx * 2, y, pz + dz * 2, cF);
    g.set(px + dx * 3, y - 1, pz + dz * 3, cF);
  }
  return { grid: g, scale: S, origin: [t + 0.5, 0, t + 0.5] };
}

// ================================================================== 8. filare di vite

/** Filare di vite con pali e fili, lungo x. scala 0.25 m, ≤ 300 triangoli. */
export function filare(rng, { lunghezza = 6 } = {}) {
  const S = 0.25, L = Math.max(8, Math.round(lunghezza / S));
  const g = new VoxelGrid(L, 9, 3);
  const cPalo = g.p(0x8c9296, MAT.METAL), cFilo = cPalo;   // stesso colore: il filo si fonde coi pali
  const cCeppo = g.p(0x5a4434);
  const verde = varia(rng, scegli(rng, [0x5a7834, 0x627d36, 0x52702f]), 0.06);
  const cFoglia = g.p(verde, MAT.FOLIAGE), cUva = g.p(rng() < 0.6 ? 0x4a2c45 : 0x9fa04a, MAT.FOLIAGE);
  for (let x = 3; x < L - 1; x += 6) g.box(x, 0, 1, x + 1, 3, 2, cCeppo);   // ceppi ogni 1.5 m
  // chioma: fascia di frutti stretta in basso (dove stanno i grappoli), parete di foglie larga sopra,
  // con gobbe irregolari. La forma a T rovesciata tiene uniforme l'AO e quindi pochi quad.
  g.box(1, 3, 1, L - 1, 4, 2, cFoglia);
  g.box(1, 4, 0, L - 1, 6, 3, cFoglia);
  for (let x = 1 + intero(rng, 0, 3); x < L - 3;) {
    const w = Math.min(L - 1 - x, intero(rng, 5, 8));
    g.box(x, 6, 0, x + w, 7, 3, cFoglia);
    x += w + intero(rng, 4, 7);
  }
  for (let x = 3; x < L - 1; x += 6) if (rng() < 0.6) g.set(x, 3, 1, cUva);   // grappoli sopra i ceppi (non spezzano altri quad)
  g.box(0, 8, 1, L, 9, 2, cFilo);                              // filo di testa
  for (let x = 0; x < L - 4; x += 24) g.box(x, 0, 1, x + 1, 9, 2, cPalo);   // un palo ogni 6 m
  g.box(L - 1, 0, 1, L, 9, 2, cPalo);
  return { grid: g, scale: S, origin: [L / 2, 0, 1.5] };
}

// ================================================================== 9. casale

/** Casale toscano in pietra e intonaco con tetto in coppi, scala esterna e torre colombaia. scala 0.5 m. */
export function casale(rng) {
  const S = 0.5;
  const W = intero(rng, 12, 15) * 2, D = intero(rng, 8, 10) * 2, H = 12;
  const annesso = rng() < 0.75, Wa = annesso ? intero(rng, 6, 8) * 2 : 0, Da = D - 4, Ha = 8;
  const torre = rng() < 0.6, pergola = annesso && rng() < 0.6;
  const X0 = 1, X1 = X0 + W, Z0 = 4, Z1 = Z0 + D;
  const nx = X1 + Wa + 2, nz = Z1 + 2;
  const sk = stratiPadiglione(W + 2, D + 2, 3);
  const g = new VoxelGrid(nx, H + sk + (torre ? 12 : 3), nz);
  const pietra = varia(rng, scegli(rng, [0xa8987e, 0xb09f82, 0x9f9078]), 0.04);
  const cPietra = g.p(pietra), cPietra2 = g.p(tinta(pietra, 0.9)), cCanto = g.p(tinta(pietra, 1.14));
  const cIntonaco = g.p(varia(rng, scegli(rng, [0xd8c49a, 0xd9b8a0, 0xe0cfa8]), 0.04));
  const coppi = COPPI.map((c) => g.p(varia(rng, c, 0.05)));
  const cPers = g.p(varia(rng, scegli(rng, [0x5a4030, 0x58685a, 0x3f5546, 0x6b5a48]), 0.05));
  const cLegno = g.p(0x4e3626), cScuro = g.p(0x2a2622);
  const cVetro = g.p(0x323d44, MAT.GLASS), cLume = g.p(0xb08a5a, MAT.NIGHT);
  const vetro = () => (rng() < 0.35 ? cLume : cVetro);

  g.box(X0, 0, Z0, X1, H, Z1, cPietra);
  // macchie di pietra più scura e cantonali chiari
  for (let i = 0; i < 14; i++) {
    const x = X0 + Math.floor(rng() * W), y = Math.floor(rng() * (H - 2)), z = Z0 + Math.floor(rng() * D);
    g.paint(x - 1, y, z - 1, x + 2, y + 2, z + 2, cPietra2);
  }
  for (let y = 0; y < H; y += 2) for (const [x, z] of [[X0, Z0], [X1 - 1, Z0], [X0, Z1 - 1], [X1 - 1, Z1 - 1]]) {
    const o = (y >> 1) % 2;
    g.paint(x - o, y, z - (1 - o), x + 1 + o, y + 1, z + 2 - o, cCanto);
  }
  const fin = (F, u, y, w, h) => {
    if (rng() < 0.65) {
      F.box(u, y, 0, u + w, y + h, 1, 0);
      F.box(u, y, 1, u + w, y + h, 2, vetro());
      F.box(u - 1, y, 0, u, y + h, 1, cPers); F.box(u + w, y, 0, u + w + 1, y + h, 1, cPers);
    } else F.box(u, y, 0, u + w, y + h, 1, cPers);
    F.box(u, y - 1, 0, u + w, y, 1, cCanto);   // davanzale
  };
  const [Ff, Fr, Fs, Fd] = QUATTRO_LATI.map((l) => facciata(g, X0, Z0, X1, Z1, l));
  // scala esterna sul fronte che sale verso la porta del primo piano (lato sinistro di chi guarda)
  const sx = X1 - 10;
  for (let k = 0; k < 6; k++) {
    g.box(sx - 5 + k, 0, Z0 - 2, sx - 4 + k, k + 1, Z0, cPietra);
    g.box(sx - 5 + k, k + 1, Z0 - 2, sx - 4 + k, k + 2, Z0 - 1, cPietra2);   // parapetto a gradini
  }
  g.box(sx + 1, 0, Z0 - 2, sx + 4, 6, Z0, cPietra);
  g.box(sx + 1, 6, Z0 - 2, sx + 4, 7, Z0 - 1, cPietra2);
  g.box(sx + 2, 0, Z0 - 2, sx + 3, 3, Z0, cScuro);           // sottoscala
  const uPorta = X1 - 1 - (sx + 3);
  Ff.box(uPorta, 6, 0, uPorta + 2, 10, 1, 0); Ff.box(uPorta, 6, 1, uPorta + 2, 10, 2, cLegno);
  // fronte: finestre al primo piano, porte ad arco e finestrelle al piano terra
  for (const u of colonne(W, 2, 5)) {
    if (Math.abs(u - uPorta) < 4) continue;
    fin(Ff, u, 7, 2, 3);
  }
  const uStalla = X1 - 1 - (sx - 9);
  Ff.box(uStalla, 0, 0, uStalla + 4, 6, 1, 0); Ff.box(uStalla, 0, 1, uStalla + 4, 6, 2, cLegno);
  Ff.set(uStalla, 5, 0, cCanto); Ff.set(uStalla + 3, 5, 0, cCanto);
  for (const [F, len] of [[Fr, W], [Fs, D], [Fd, D]]) {
    const cols = colonne(len, 2, 6);
    cols.forEach((u, i) => {
      fin(F, u, 7, 2, 3);
      if (i % 2 === 0) fin(F, u, 2, 2, 2);
    });
  }
  // annesso intonacato (fienile) con grande arco
  if (annesso) {
    const ax0 = X1, ax1 = X1 + Wa, az0 = Z0 + 2, az1 = az0 + Da;
    g.box(ax0, 0, az0, ax1, Ha, az1, cIntonaco);
    g.box(ax0, 0, az0, ax1, 1, az1, cPietra2);
    const Fa = facciata(g, ax0, az0, ax1, az1, 'fronte');
    const ua = (Wa - 6) >> 1;
    Fa.box(ua, 0, 0, ua + 6, 6, 2, 0); Fa.box(ua, 0, 2, ua + 6, 6, 3, cScuro);
    Fa.set(ua, 5, 0, cIntonaco); Fa.set(ua + 5, 5, 0, cIntonaco);
    Fa.box(ua - 1, 0, -1, ua, 6, 0, cCanto); Fa.box(ua + 6, 0, -1, ua + 7, 6, 0, cCanto);
    padiglione(g, ax0 - 1, az0 - 1, ax1 + 1, az1 + 1, Ha, coppi, 3);
    if (pergola) {
      const cPalo = g.p(0x5e4a38), cVite = g.p(varia(rng, 0x55703a, 0.08), MAT.FOLIAGE);
      for (const x of [ax0 + 1, ax1 - 2]) g.box(x, 0, Z0 - 3, x + 1, 5, Z0 - 2, cPalo);
      g.box(ax0, 5, Z0 - 3, ax1, 6, az0, cPalo);
      for (let x = ax0; x < ax1; x++) if (rng() < 0.75) g.box(x, 6, Z0 - 3, x + 1, 7, az0 - (rng() < 0.4 ? 1 : 0), cVite);
    }
  }
  padiglione(g, X0 - 1, Z0 - 1, X1 + 1, Z1 + 1, H, coppi, 3);
  // torre colombaia
  if (torre) {
    const tx0 = X0 + (W >> 1) - 4 + (rng() < 0.5 ? -4 : 0), tz0 = Z0 + (D >> 1) - 4;
    const yt = H + 8;
    g.box(tx0, H - 1, tz0, tx0 + 8, yt, tz0 + 8, cPietra);
    for (const lato of QUATTRO_LATI) {
      const Ft = facciata(g, tx0, tz0, tx0 + 8, tz0 + 8, lato);
      fin(Ft, 3, H + 2, 2, 2);
      for (const u of [1, 3, 5]) { Ft.set(u, yt - 2, 0, 0); Ft.set(u, yt - 2, 1, cScuro); }   // buche della colombaia
    }
    g.box(tx0, yt - 1, tz0, tx0 + 8, yt, tz0 + 8, cCanto);
    padiglione(g, tx0 - 1, tz0 - 1, tx0 + 9, tz0 + 9, yt, coppi);
  }
  // comignolo
  { const x = X0 + 3, z = Z1 - 5, y = cima(g, x, z) + 1; g.box(x, y, z, x + 2, y + 3, z + 1, cPietra); g.box(x, y + 3, z, x + 2, y + 4, z + 1, coppi[0]); }
  return { grid: g, scale: S, origin: [nx / 2, 0, nz / 2] };
}

// ================================================================== 10. tribuna

const SEDILI = [0x2f5f8f, 0xa83a32, 0xd1aa3a, 0x2f7a52, 0xdcdcd6, 0x5a5f66, 0x3f8fa0, 0xc8682e];

/**
 * Tribuna in cemento a gradoni rivolta verso -z, con seggiolini a blocchi di colore, scalinate,
 * scale laterali e tetto a sbalzo su pilastri. scala 0.5 m.
 * extra.posti = punti di calpestio davanti ai seggiolini (piedi degli spettatori), ~1 ogni 0.8 m per fila.
 */
export function tribuna(rng, { lunghezza = 40, file = 10 } = {}) {
  const S = 0.5;
  const L = Math.max(8, Math.round(lunghezza / S)), N = Math.max(1, Math.round(file));
  const rd = 2, rh = 1, hb = 3, sc = 3;
  const X0 = sc, X1 = sc + L, Z0 = 1, Zr = Z0 + N * rd, Zb = Zr + 2;
  const yTop = hb + N * rh, yR = yTop + 9;
  const nx = L + 2 * sc, nz = Zb + 1;
  const g = new VoxelGrid(nx, yR + 3, nz);
  const cCem = g.p(varia(rng, 0xa9a7a1, 0.03)), cCemS = g.p(0x8e8c86), cGrad = g.p(0xc3c1ba);
  const cFerro = g.p(0x6f767c, MAT.METAL), cTetto = g.p(0xb7bcc1, MAT.METAL);
  const cols = [];
  while (cols.length < 3) { const c = scegli(rng, SEDILI); if (!cols.includes(c)) cols.push(c); }
  const cSed = cols.map((c) => g.p(varia(rng, c, 0.03)));
  const [acc1, acc2] = [g.p(scegli(rng, [0xa83a32, 0x2f5f8f, 0x2f7a52])), g.p(scegli(rng, [0xd1aa3a, 0xdcdcd6, 0x3f8fa0]))];
  const cBianco = g.p(0xe6e6e2);

  // scalinate (corridoi larghi 2 voxel) che dividono i settori
  const nb = Math.max(1, Math.round(L / 24));
  const corridoio = new Uint8Array(nx);
  for (let k = 1; k < nb; k++) { const c = X0 + Math.round((L * k) / nb); corridoio[c - 1] = corridoio[c] = 1; }
  const settore = (x) => { let s = 0; for (let i = X0; i <= x; i++) if (corridoio[i] && !corridoio[i - 1]) s++; return s; };
  const modo = scegli(rng, ['settori', 'fasce', 'misto']);

  // gradoni
  for (let r = 0; r < N; r++) g.box(X0, 0, Z0 + r * rd, X1, hb + r * rh, Z0 + (r + 1) * rd, cCem);
  g.box(X0, 0, Zr, X1, yTop, Zb, cCem);
  g.box(X0, yTop, Zb - 1, X1, yTop + 2, Zb, cCemS);                       // muretto in alto
  g.box(X0, 0, 0, X1, hb + 2, 1, cCemS);                                    // parapetto davanti
  g.box(X0, hb + 1, 0, X1, hb + 2, 1, acc1);
  // seggiolini e gradini delle scalinate
  for (let r = 0; r < N; r++) {
    const y = hb + r * rh, z = Z0 + r * rd + 1;
    for (let x = X0; x < X1; x++) {
      if (corridoio[x]) { g.set(x, y, z, cGrad); g.paint(x, 0, Z0 + r * rd, x + 1, y, z + 1, cGrad); continue; }
      const s = settore(x);
      const k = modo === 'settori' ? s % cSed.length : modo === 'fasce' ? Math.floor(r / 3) % 2 : (r >= N - 2 ? 2 : s % 2);
      g.set(x, y, z, cSed[k]);
    }
  }
  // scale laterali con parapetto
  for (const [xs, xp] of [[0, 0], [X1, X1 + 2]]) {
    for (let k = 0; k < yTop; k++) {
      const z = Zb - yTop + k;
      g.box(xs, 0, z, xs + 3, k + 1, z + 1, cCemS);
      g.set(xp, k + 1, z, cCem);
    }
    g.box(xs, 0, Zb, xs + 3, 1, nz, cCemS);
  }
  // pilastri, travi, tetto a sbalzo e fascia frontale a strisce
  const zc = Z0 + Math.round(N * rd * 0.25);
  const np = Math.max(2, Math.round(L / 16) + 1);
  for (let i = 0; i < np; i++) {
    const x = X0 + 1 + Math.round((i * (L - 3)) / (np - 1));
    g.box(x, 0, Zb, x + 1, yR, Zb + 1, cFerro);
    g.box(x, yR - 1, zc, x + 1, yR, Zb + 1, cFerro);
    linea(g, [x, yR - 6, Zb], [x, yR - 2, Zb - 6], 1, cFerro);
  }
  g.box(X0 - 1, yR, zc, X1 + 1, yR + 1, nz, cTetto);
  g.box(X0 - 1, yR - 2, zc, X1 + 1, yR + 2, zc + 1, cBianco);
  g.box(X0 - 1, yR - 1, zc, X1 + 1, yR, zc + 1, acc1);
  g.box(X0 - 1, yR + 1, zc, X1 + 1, yR + 2, zc + 1, acc2);

  const origin = [nx / 2, 0, nz / 2];
  // posti: gruppi continui di seggiolini, uno ogni ~0.8 m
  const posti = [];
  for (let r = 0; r < N; r++) {
    for (let a = X0; a < X1;) {
      if (corridoio[a]) { a++; continue; }
      let b = a;
      while (b < X1 && !corridoio[b]) b++;
      const m = (b - a) * S, n = Math.max(1, Math.floor(m / 0.8)), sp = (b - a) / n;
      for (let i = 0; i < n; i++) posti.push(metri(origin, S, a + (i + 0.5) * sp, hb + r * rh, Z0 + r * rd + 0.5));
      a = b;
    }
  }
  return { grid: g, scale: S, origin, extra: { posti, file: N } };
}

// ================================================================== 11. spettatore e bandiera (geometrie pronte)

/** accumulatore di parallelepipedi con colore e attributo per vertice */
function scatole() {
  const pos = [], nor = [], col = [], att = [], idx = [];
  const FACCE = [
    [[1, 0, 0], [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]]],
    [[-1, 0, 0], [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]]],
    [[0, 1, 0], [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]]],
    [[0, -1, 0], [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]]],
    [[0, 0, 1], [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]]],
    [[0, 0, -1], [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]]],
  ];
  const c3 = new THREE.Color();
  return {
    pos, nor, col, att, idx,
    box(a, b, colore, valore) {
      c3.set(colore);
      for (const [n, vs] of FACCE) {
        const base = pos.length / 3;
        for (const v of vs) {
          pos.push(v[0] ? b[0] : a[0], v[1] ? b[1] : a[1], v[2] ? b[2] : a[2]);
          nor.push(...n); col.push(c3.r, c3.g, c3.b); att.push(valore);
        }
        idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
    },
  };
}

/**
 * Spettatore voxel alto 1.75 m, piedi nell'origine, guarda verso -z.
 * Attributi: color (pelle per testa e mani, scuro per gambe e capelli, bianco per busto e braccia,
 * da tingere col colore dell'istanza) e part (0 gambe, 1 busto, 2 braccia, 3 testa).
 */
export function spettatore() {
  const B = scatole();
  const pelle = 0xc99a78, gambe = 0x2b2f38, scarpe = 0x1c1c1e, capelli = 0x3a2c22, bianco = 0xffffff;
  B.box([-0.17, 0, -0.13], [-0.02, 0.08, 0.1], scarpe, 0);
  B.box([0.02, 0, -0.13], [0.17, 0.08, 0.1], scarpe, 0);
  B.box([-0.16, 0.08, -0.08], [-0.02, 0.9, 0.08], gambe, 0);
  B.box([0.02, 0.08, -0.08], [0.16, 0.9, 0.08], gambe, 0);
  B.box([-0.2, 0.88, -0.11], [0.2, 1.46, 0.11], bianco, 1);
  B.box([-0.3, 0.9, -0.07], [-0.2, 1.44, 0.07], bianco, 2);
  B.box([0.2, 0.9, -0.07], [0.3, 1.44, 0.07], bianco, 2);
  B.box([-0.29, 0.78, -0.06], [-0.21, 0.9, 0.06], pelle, 2);
  B.box([0.21, 0.78, -0.06], [0.29, 0.9, 0.06], pelle, 2);
  B.box([-0.05, 1.46, -0.05], [0.05, 1.5, 0.05], pelle, 3);
  B.box([-0.11, 1.5, -0.12], [0.11, 1.72, 0.1], pelle, 3);
  B.box([-0.12, 1.62, -0.08], [0.12, 1.75, 0.12], capelli, 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(B.pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(B.nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(B.col, 3));
  geo.setAttribute('part', new THREE.Float32BufferAttribute(B.att, 1));
  geo.setIndex(B.idx);
  geo.computeBoundingBox(); geo.computeBoundingSphere();
  return geo;
}

/**
 * Bandiera: asta alta 2.6 m (base nell'origine) e drappo 1.2 × 0.8 m verso +x, suddiviso in 8 × 4 quad
 * nel piano x-y (normale verso -z). Attributi: flag (0 asta, 0..1 lungo il drappo dall'asta in fuori),
 * uv (sul drappo), color (asta grigia, drappo bianco da tingere).
 */
export function bandiera() {
  const B = scatole();
  const H = 2.6, a = 0.022;
  B.box([-a, 0, -a], [a, H + 0.05, a], 0x9a9ea2, 0);
  const pos = B.pos, nor = B.nor, col = B.col, att = B.att, idx = B.idx, uv = new Array((pos.length / 3) * 2).fill(0);
  const base = pos.length / 3, NX = 8, NY = 4;
  for (let j = 0; j <= NY; j++)
    for (let i = 0; i <= NX; i++) {
      const u = i / NX, v = j / NY;
      pos.push(a + u * 1.2, H - 0.8 + v * 0.8, 0);
      nor.push(0, 0, -1); col.push(1, 1, 1); att.push(u); uv.push(u, v);
    }
  for (let j = 0; j < NY; j++)
    for (let i = 0; i < NX; i++) {
      const k = base + j * (NX + 1) + i;
      idx.push(k, k + NX + 1, k + 1, k + 1, k + NX + 1, k + NX + 2);
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('flag', new THREE.Float32BufferAttribute(att, 1));
  geo.setIndex(idx);
  geo.computeBoundingBox(); geo.computeBoundingSphere();
  return geo;
}

// ================================================================== 12. lampione e torre fari

/** Lampione in ghisa alto ~6 m (a lanterna singola o a due bracci). scala 0.25 m. extra.luce = centro delle lanterne. */
export function lampione(rng) {
  const S = 0.25, doppio = rng() < 0.35;
  const nx = doppio ? 13 : 5, nz = 5, c = (nx - 1) / 2, cz = 2;
  const g = new VoxelGrid(nx, 26, nz);
  const cGhisa = g.p(scegli(rng, [0x1f2a24, 0x1e1f21, 0x26302c]), MAT.METAL);
  const cLuce = g.p(0xf0d9a0, MAT.NIGHT);
  g.box(c - 2, 0, cz - 2, c + 3, 1, cz + 3, cGhisa);
  g.box(c - 1, 1, cz - 1, c + 2, 4, cz + 2, cGhisa);
  const lanterna = (x, y0) => {               // 3×3: fondo, vetri accesi con spigoli in ghisa, cappello
    g.box(x - 1, y0, cz - 1, x + 2, y0 + 1, cz + 2, cGhisa);
    g.box(x - 1, y0 + 1, cz - 1, x + 2, y0 + 4, cz + 2, cLuce);
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) g.box(x + dx, y0 + 1, cz + dz, x + dx + 1, y0 + 4, cz + dz + 1, cGhisa);
    g.box(x - 1, y0 + 4, cz - 1, x + 2, y0 + 5, cz + 2, cGhisa);
    g.set(x, y0 + 5, cz, cGhisa);
    return y0 + 2.5;
  };
  const origin = [c + 0.5, 0, cz + 0.5];
  const luci = [];
  if (!doppio) {
    g.box(c, 4, cz, c + 1, 19, cz + 1, cGhisa);
    for (const y of [8, 14]) g.box(c - 1, y, cz - 1, c + 2, y + 1, cz + 2, cGhisa);
    const yl = lanterna(c, 19);
    g.set(c, 25, cz, cGhisa);
    luci.push(metri(origin, S, c + 0.5, yl, cz + 0.5));
  } else {
    g.box(c, 4, cz, c + 1, 23, cz + 1, cGhisa);
    g.box(c - 1, 9, cz - 1, c + 2, 10, cz + 2, cGhisa);
    g.box(c - 5, 21, cz, c + 6, 22, cz + 1, cGhisa);           // bracci
    g.set(c - 1, 20, cz, cGhisa); g.set(c + 1, 20, cz, cGhisa);
    for (const x of [c - 5, c + 5]) {
      g.set(x, 20, cz, cGhisa);
      luci.push(metri(origin, S, x + 0.5, lanterna(x, 15), cz + 0.5));
    }
  }
  const luce = { x: arrot(luci.reduce((s, l) => s + l.x, 0) / luci.length), y: luci[0].y, z: luci[0].z };
  return { grid: g, scale: S, origin, extra: { luce, luci } };
}

/** Torre di illuminazione da circuito alta ~18 m, batteria di fari verso -z. scala 0.5 m. extra.luce = centro dei fari. */
export function torreFari(rng) {
  const S = 0.5, nx = 13, nz = 8;
  const g = new VoxelGrid(nx, 38, nz);
  const cCem = g.p(0x9c9a94), cTraliccio = g.p(varia(rng, 0x8c9298, 0.04), MAT.METAL);
  const cScuro = g.p(0x34383c, MAT.METAL), cFaro = g.p(0xf2eee2, MAT.NIGHT);
  g.box(4, 0, 2, 9, 2, 7, cCem);
  // traliccio 1.5 m: quattro montanti e anelli ogni 2 m
  for (const [x, z] of [[5, 3], [7, 3], [5, 5], [7, 5]]) g.box(x, 2, z, x + 1, 31, z + 1, cTraliccio);
  for (let y = 5; y < 31; y += 4) { g.box(5, y, 3, 8, y + 1, 6, cTraliccio); g.set(6, y, 4, 0); }
  // piattaforma con ringhiera
  g.box(1, 31, 1, 12, 32, 7, cScuro);
  g.box(1, 33, 6, 12, 34, 7, cTraliccio);
  for (let x = 1; x < 12; x += 2) g.set(x, 32, 6, cTraliccio);
  g.box(1, 32, 1, 2, 34, 7, cTraliccio); g.box(11, 32, 1, 12, 34, 7, cTraliccio);
  // telaio e fari (3 file da 5)
  g.box(1, 32, 2, 12, 39, 3, cScuro);
  for (let y = 33; y < 38; y += 2) for (let x = 2; x < 12; x += 2) g.set(x, y, 1, cFaro);
  const origin = [6.5, 0, 4.5];
  return { grid: g, scale: S, origin, extra: { luce: metri(origin, S, 6.5, 35.5, 1.5), direzione: { x: 0, y: -0.25, z: -1 } } };
}

// ================================================================== 13. box dei pit

const CIFRE = {
  0: ['111', '101', '101', '101', '111'], 1: ['010', '110', '010', '010', '111'], 2: ['111', '001', '111', '100', '111'],
  3: ['111', '001', '111', '001', '111'], 4: ['101', '101', '111', '001', '001'], 5: ['111', '100', '111', '001', '111'],
  6: ['111', '100', '111', '101', '111'], 7: ['111', '001', '010', '010', '010'], 8: ['111', '101', '111', '101', '111'],
  9: ['111', '101', '111', '001', '111'],
};

/** Edificio dei box: serrande numerate, primo piano a vetrata, terrazza con ringhiera. Fronte pista = -z. scala 0.5 m. */
export function boxPit(rng, { lunghezza = 60, primo = 1 } = {}) {
  const S = 0.5, L = Math.max(24, Math.round(lunghezza / S));
  const passo = 12, nG = Math.floor(L / passo), off = (L - nG * passo) >> 1;
  const D = 24, h0 = 10, yRoof = 18, terr = 4;
  const X0 = 1, X1 = X0 + L, Z0 = 1, Z1 = Z0 + D;
  const conTorre = L >= 60;
  const g = new VoxelGrid(L + 2, yRoof + 3 + (conTorre ? 8 : 0), D + 2);
  const cMuro = g.p(varia(rng, 0xdcdcd6, 0.02)), cZoc = g.p(0x55595e);
  const cFascia = g.p(scegli(rng, [0x3a3f45, 0x7a2e2a, 0x2c4a6a, 0x345a44]));
  const cSerr = g.p(0xb4b9be, MAT.METAL), cCass = g.p(0x8a9096, MAT.METAL), cCifra = g.p(0x23262b);
  const cFerro = g.p(0x5c6268, MAT.METAL), cMont = g.p(0x3a3e43, MAT.METAL);
  const cVetro = g.p(0x2d3a44, MAT.GLASS), cLume = g.p(0xd8d2bc, MAT.NIGHT), cLampada = g.p(0xece6d2, MAT.NIGHT);
  const cPav = g.p(0x8f8c86), cTetto = g.p(0xa9adb0);

  g.box(X0, 0, Z0, X1, h0, Z1, cMuro);
  g.paint(X0, 0, Z0, X1, 1, Z1, cZoc);
  const F = facciata(g, X0, Z0, X1, Z1, 'fronte');
  F.paint(0, 7, 0, L, h0, 1, cFascia);
  for (let i = 0; i < nG; i++) {
    const u0 = off + i * passo + 2;
    F.box(u0, 0, 0, u0 + 8, 7, 1, 0);
    F.box(u0, 0, 1, u0 + 8, 6, 2, cSerr);
    F.box(u0, 6, 1, u0 + 8, 7, 2, cCass);
    const s = String(primo + i), tw = s.length * 4 - 1, us = u0 + Math.floor((8 - tw) / 2);
    [...s].forEach((ch, j) => CIFRE[ch].forEach((riga, r) => [...riga].forEach((px, k) => {
      if (px === '1') F.set(us + j * 4 + k, 5 - r, 1, cCifra);
    })));
    F.set(u0 + 3, 8, 0, cLampada); F.set(u0 + 4, 8, 0, cLampada);
  }
  // retro: porte di servizio per ogni box
  const Fr = facciata(g, X0, Z0, X1, Z1, 'retro');
  for (let i = 0; i < nG; i++) { const u = off + i * passo + 4; Fr.box(u, 0, 0, u + 4, 6, 1, 0); Fr.box(u, 0, 1, u + 4, 6, 2, cMont); }
  // primo piano arretrato, a vetrata
  g.box(X0, h0, Z0 + terr, X1, yRoof, Z1, cMuro);
  const F1 = facciata(g, X0, Z0 + terr, X1, Z1, 'fronte');
  const pannelli = Array.from({ length: Math.ceil(L / 4) }, () => (rng() < 0.36 ? cLume : cVetro));
  for (let u = 0; u < L; u++) for (let y = h0 + 1; y < yRoof - 1; y++) F1.set(u, y, 0, u % 4 === 0 ? cMont : pannelli[u >> 2]);
  const F1r = facciata(g, X0, Z0 + terr, X1, Z1, 'retro');
  for (let u = 2; u < L - 6; u += 8) F1r.box(u, h0 + 2, 0, u + 6, yRoof - 2, 1, rng() < 0.3 ? cLume : cVetro);
  // terrazza con ringhiera
  g.paint(X0, h0 - 1, Z0 + 1, X1, h0, Z0 + terr, cPav);
  g.box(X0, h0 + 1, Z0, X1, h0 + 2, Z0 + 1, cFerro);
  for (let x = X0; x < X1; x += 3) g.set(x, h0, Z0, cFerro);
  g.set(X1 - 1, h0, Z0, cFerro);
  for (const x of [X0, X1 - 1]) { g.box(x, h0 + 1, Z0, x + 1, h0 + 2, Z0 + terr, cFerro); g.set(x, h0, Z0 + 2, cFerro); }
  // copertura con sbalzo e parapetto
  g.box(X0, yRoof, Z0 + terr - 1, X1, yRoof + 1, Z1, cTetto);
  g.box(X0, yRoof + 1, Z0 + terr - 1, X1, yRoof + 2, Z1, cMuro);
  g.box(X0 + 1, yRoof + 1, Z0 + terr, X1 - 1, yRoof + 2, Z1 - 1, 0);
  // direzione gara: volume vetrato al centro
  if (conTorre) {
    const w = Math.round(L * 0.2), tx0 = X0 + ((L - w) >> 1), tz0 = Z0 + terr + 3, tz1 = Z1 - 3;
    g.box(tx0, yRoof + 1, tz0, tx0 + w, yRoof + 7, tz1, cMuro);
    for (const lato of QUATTRO_LATI) {
      const Ft = facciata(g, tx0, tz0, tx0 + w, tz1, lato);
      for (let u = 1; u < Ft.len - 1; u++) Ft.box(u, yRoof + 2, 0, u + 1, yRoof + 6, 1, u % 3 === 0 ? cMont : rng() < 0.4 ? cLume : cVetro);
    }
    g.box(tx0 - 1, yRoof + 7, tz0 - 1, tx0 + w + 1, yRoof + 8, tz1 + 1, cTetto);
  }
  return { grid: g, scale: S, origin: [X0 + L / 2, 0, (D + 2) / 2], extra: { box: nG } };
}

// ================================================================== 14. passerella

/** Ponte pedonale coperto sopra la pista, retto da due piloni. luce = distanza libera fra i piloni (m). scala 0.5 m. */
export function passerella(rng, { luce = 20 } = {}) {
  const S = 0.5, Lc = Math.max(8, Math.round(luce / S)), Pw = 6;
  const nx = Lc + 2 * Pw, nz = 10;
  const g = new VoxelGrid(nx, 20, nz);
  const cCem = g.p(varia(rng, 0xb8b4ac, 0.03)), cCemS = g.p(0x96928a);
  const cBianco = g.p(0xe8e8e4);
  const acc = [scegli(rng, [0xa83a32, 0x2f5f8f, 0x2f7a52, 0xc8682e]), scegli(rng, [0xd1aa3a, 0x3f8fa0, 0x5a5f66])].map((c) => g.p(c));
  const cVetro = g.p(0x3a4a55, MAT.GLASS), cMont = g.p(0x50565c, MAT.METAL), cTetto = g.p(0xa2a7ab, MAT.METAL);
  const cLuce = g.p(0xece6d2, MAT.NIGHT), cPorta = g.p(0x3d4247, MAT.METAL);
  // piloni (contengono le scale)
  for (const x0 of [0, Pw + Lc]) {
    g.box(x0, 0, 1, x0 + Pw, 19, 9, cCem);
    g.paint(x0, 0, 1, x0 + Pw, 1, 9, cCemS);
    const Fp = facciata(g, x0, 1, x0 + Pw, 9, 'fronte');
    Fp.box(2, 0, 0, 4, 5, 1, 0); Fp.box(2, 0, 1, 4, 5, 2, cPorta);
    for (let y = 7; y < 17; y += 4) Fp.box(2, y, 0, 4, y + 2, 1, cVetro);
  }
  // impalcato: fascia a strisce sui due lati, luci sotto
  g.box(0, 11, 2, nx, 14, 8, cBianco);
  for (const z of [2, 7]) { g.box(0, 12, z, nx, 13, z + 1, acc[0]); }
  g.box(0, 11, 2, nx, 12, 3, acc[1]); g.box(0, 11, 7, nx, 12, 8, acc[1]);
  for (let x = Pw + 2; x < Pw + Lc - 1; x += 4) g.box(x, 11, 4, x + 1, 12, 6, cLuce);
  // corridoio vetrato coperto
  for (const z of [2, 7]) {
    g.box(Pw, 14, z, Pw + Lc, 18, z + 1, cVetro);
    for (let x = Pw; x <= Pw + Lc; x += 5) g.box(Math.min(x, Pw + Lc - 1), 14, z, Math.min(x, Pw + Lc - 1) + 1, 18, z + 1, cMont);
  }
  g.box(0, 18, 1, nx, 19, 9, cTetto);
  return { grid: g, scale: S, origin: [nx / 2, 0, nz / 2], extra: { luceLibera: Lc * S, altezzaLibera: 11 * S } };
}

// ================================================================== 15. semaforo del via

/**
 * Portale del via largo 16 m e alto 7 m con 5 colonne di luci (coppia rossa + verde).
 * Ritorna { group, setLuci(n), luci }: setLuci(n) accende n coppie rosse da sinistra (per chi guarda da -z),
 * n === -1 tutte verdi, n === 0 tutto spento.
 */
export function semaforo() {
  const S = 0.25;
  const g = new VoxelGrid(64, 28, 4);
  const cTrave = g.p(0x9aa0a6, MAT.METAL), cScuro = g.p(0x1b1c1e), cBianco = g.p(0xe6e6e2), cRosso = g.p(0xa83a32);
  for (const x0 of [0, 60]) { g.box(x0, 0, 0, x0 + 4, 1, 4, cScuro); g.box(x0 + 1, 1, 1, x0 + 3, 28, 3, cTrave); }
  g.box(0, 25, 1, 64, 28, 3, cTrave);
  for (let x = 4; x < 60; x += 8) g.box(x, 26, 0, x + 4, 27, 1, x % 16 === 4 ? cRosso : cBianco);
  g.box(23, 17, 0, 41, 25, 3, cScuro);
  const origin = [32, 0, 2];
  const mesh = voxelMesh(g, { scale: S, origin });
  const group = new THREE.Group();
  group.add(mesh);
  const mat = {
    rossoOff: new THREE.MeshStandardMaterial({ color: 0x2a0806, roughness: 0.35 }),
    rossoOn: new THREE.MeshStandardMaterial({ color: 0xff1a0a, emissive: 0xff1406, emissiveIntensity: 2.6, roughness: 0.35 }),
    verdeOff: new THREE.MeshStandardMaterial({ color: 0x06200c, roughness: 0.35 }),
    verdeOn: new THREE.MeshStandardMaterial({ color: 0x18ff40, emissive: 0x10ff38, emissiveIntensity: 2.4, roughness: 0.35 }),
  };
  const disco = new THREE.CylinderGeometry(0.19, 0.19, 0.06, 12);
  disco.rotateX(Math.PI / 2);
  const zF = (0 - origin[2]) * S - 0.03;
  const luci = [];
  for (let i = 0; i < 5; i++) {
    const x = (2 - i) * 0.8;   // i = 0 è la colonna più a sinistra per chi guarda da -z
    const col = { rossi: [], verde: null };
    for (const y of [5.95, 5.45]) {
      const m = new THREE.Mesh(disco, mat.rossoOff);
      m.position.set(x, y, zF); group.add(m); col.rossi.push(m);
    }
    col.verde = new THREE.Mesh(disco, mat.verdeOff);
    col.verde.position.set(x, 4.85, zF); group.add(col.verde);
    luci.push(col);
  }
  const setLuci = (n) => {
    luci.forEach((c, i) => {
      for (const m of c.rossi) m.material = n > i ? mat.rossoOn : mat.rossoOff;
      c.verde.material = n === -1 ? mat.verdeOn : mat.verdeOff;
    });
  };
  setLuci(0);
  return { group, setLuci, luci, materiali: mat };
}

// ================================================================== 16. TecPro

/** Barriera TecPro: blocchi da 1 m alternati rossi e bianchi lungo x. scala 0.25 m. */
export function tecpro(rng, { lunghezza = 4 } = {}) {
  const S = 0.25, n = Math.max(1, Math.round(lunghezza));
  const g = new VoxelGrid(n * 4, 4, 3);
  const cR = g.p(varia(rng, 0xb8352c, 0.03)), cB = g.p(0xe4e2dc), cCinghia = g.p(0x2d2f33);
  for (let i = 0; i < n; i++) {
    const x = i * 4, c = i % 2 ? cB : cR;
    g.box(x, 0, 0, x + 4, 3, 3, c);
    g.box(x, 3, 1, x + 4, 4, 2, c);                         // dorso arrotondato
    g.box(x + 1, 3, 0, x + 3, 4, 3, c);
    g.paint(x, 1, 0, x + 4, 2, 3, cCinghia);                // cinghia di collegamento
  }
  return { grid: g, scale: S, origin: [n * 2, 0, 1.5] };
}
