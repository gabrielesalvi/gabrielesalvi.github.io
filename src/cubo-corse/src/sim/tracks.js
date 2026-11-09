// Definizioni dei circuiti. Coordinate: x = est, z = sud, y = quota (metri).
// bank: inclinazione trasversale (rad), >0 = lato destro più alto.
import { SURF, BAR } from './track.js';

// ------------------------------------------------------------------ PORTO
// Cittadino sul lungomare: rettilineo sul mare, Curva del Faro, salita fra i palazzi,
// Tornante di San Rocco, discesa al Duomo, Galleria, Chicane del Porto, Banchina, Curva della Lanterna.
const P = (x, y, z, w = 12, bank = 0) => ({ x, y, z, w, bank });
export const PORTO = {
  id: 'porto',
  nome: 'Porto Azzurro',
  sottotitolo: 'Cittadino · lungomare, tunnel e tornanti',
  stile: 'citta',
  ctrl: [
    P(-520, 2, 0, 13), P(-300, 2, 0, 13), P(-60, 2, 1, 13), P(180, 2, 1, 13), P(330, 2, 0, 13),
    // Curva del Faro (sinistra, verso nord)
    P(392, 2.4, -14, 12), P(418, 3.4, -58, 12),
    // Salita dei Pescatori
    P(424, 8, -140, 11), P(412, 13.5, -210, 11), P(428, 19, -282, 11),
    // Tornante di San Rocco
    P(434, 21.5, -318, 11), P(420, 22.5, -340, 11), P(396, 23, -344, 11), P(377, 22.5, -326, 11), P(374, 21.5, -298, 11),
    // Discesa del Duomo, curva a destra verso ovest
    P(372, 20, -262, 11), P(352, 17.5, -228, 11), P(306, 15.5, -210, 11.5), P(228, 13.5, -214, 11.5),
    // Piazza (esse)
    P(168, 12.5, -228, 11), P(128, 12, -210, 11), P(86, 11.6, -224, 11), P(20, 11, -220, 12),
    // Galleria (curvone a sinistra in discesa)
    P(-70, 10, -214, 12), P(-160, 8, -194, 12), P(-228, 6, -160, 12), P(-266, 4.2, -118, 12),
    // Chicane del Porto
    P(-282, 3.2, -86, 11), P(-306, 2.6, -70, 11), P(-332, 2.2, -58, 11),
    // Banchina verso ovest
    P(-420, 2, -54, 12), P(-510, 2, -52, 12),
    // Curva della Lanterna (tornante a sinistra)
    P(-566, 2, -48, 12), P(-594, 2, -28, 12), P(-590, 2, -6, 12), P(-562, 2, 1, 13),
  ],
  startS: 520,
  tunnel: [[-20, -250]], // x (da, a) coperti: usato dallo scenario
  curve: [
    { name: 'Curva del Faro', s: 0 }, { name: 'Tornante di San Rocco', s: 0 },
    { name: 'Piazza del Duomo', s: 0 }, { name: 'Galleria', s: 0 },
    { name: 'Chicane del Porto', s: 0 }, { name: 'Curva della Lanterna', s: 0 },
  ],
  curvaAt: [[392, -14], [396, -344], [128, -210], [-160, -194], [-306, -70], [-594, -28]],
  override: [],
  overrideXZ: [
    // vie di fuga asfaltate dritte nelle curve principali (lato esterno)
    { at: [392, -14], r: 70, lato: 'R', run: SURF.RUNOFF, runW: 9, bar: BAR.TECPRO },
    { at: [400, -340], r: 45, lato: 'R', run: SURF.RUNOFF, runW: 7, bar: BAR.TECPRO },
    { at: [-306, -70], r: 40, lato: 'B', run: SURF.RUNOFF, runW: 6, bar: BAR.TECPRO },
    { at: [-590, -28], r: 50, lato: 'R', run: SURF.RUNOFF, runW: 8, bar: BAR.TECPRO },
  ],
  luce: { mare: true },
};

// ------------------------------------------------------------------ COLLINE
// Permanente fra vigne e cipressi, ~4 km, 38 m di dislivello.
const S = 1.45;
const C = (x, y, z, w = 13, bank = 0) => ({ x: x * S, y, z: z * S, w, bank });
export const COLLINE = {
  id: 'colline',
  nome: 'Autodromo delle Colline',
  sottotitolo: 'Permanente · saliscendi, Cavatappi, spalti',
  stile: 'permanente',
  // corsia box a sinistra del rettilineo (startS = 470)
  pit: { lato: 'L', da: 470 - 330, a: 470 + 250, d: 17, w: 9, rIn: 95, rOut: 95 },
  ctrl: [
    // rettilineo dei box (verso est)
    C(-300, 20, 0, 15), C(-60, 20, 0, 15), C(200, 20, 0, 15), C(440, 20, 2, 14),
    // Curvone (destra veloce, in discesa)
    C(560, 18.5, 24, 13, -0.05), C(632, 15.5, 92, 13, -0.05), C(652, 13, 160, 13),
    // Esse delle Vigne
    C(624, 10.5, 226, 12), C(660, 8, 292, 12), C(700, 5.5, 346, 12),
    // Tornante della Pieve (destra)
    C(712, 3.5, 396, 12), C(690, 2.5, 432, 12), C(646, 2, 440, 12),
    // Rettilineo del Fiume (verso ovest)
    C(520, 3, 446, 13), C(360, 6, 452, 13), C(220, 9, 444, 13),
    // Curva della Cappella (destra, inizio salita)
    C(140, 11, 426, 12), C(102, 15, 384, 12),
    // Salita dei Cipressi
    C(86, 22, 318, 12), C(92, 30, 256, 12), C(106, 36.5, 206, 12), C(110, 39.5, 176, 12),
    // Cavatappi (sinistra-destra in picchiata)
    C(98, 39.5, 150, 11.5), C(76, 36.5, 136, 11.5), C(70, 32.5, 116, 11.5), C(80, 28.5, 94, 11.5),
    C(66, 25.5, 70, 12),
    // Curva del Mulino (sinistra larga, verso ovest)
    C(20, 22, 74, 13), C(-60, 19, 96, 13), C(-160, 17, 112, 13),
    // Curva del Lago (destra lunga, rientro sul rettilineo)
    C(-262, 16.5, 112, 13, -0.06), C(-340, 17.5, 82, 13, -0.06), C(-366, 18.5, 36, 13, -0.04), C(-344, 19.5, 6, 14),
  ],
  startS: 470,
  curvaAt: [[600 * S, 60 * S], [640 * S, 260 * S], [690 * S, 432 * S], [120 * S, 410 * S],
    [80 * S, 125 * S], [-60 * S, 96 * S], [-340 * S, 82 * S]],
  curve: [
    { name: 'Curvone' }, { name: 'Esse delle Vigne' }, { name: 'Tornante della Pieve' },
    { name: 'Curva della Cappella' }, { name: 'Cavatappi' }, { name: 'Curva del Mulino' }, { name: 'Curva del Lago' },
  ],
  override: [],
  overrideXZ: [
    // muretto dei box a sinistra del rettilineo
    { seg: [[-260 * S, 0], [380 * S, 0]], lato: 'L', run: SURF.RUNOFF, runW: 2.5, bar: BAR.WALL, kerb: 0 },
    // tribuna a destra del rettilineo: erba stretta e rete
    { seg: [[-200 * S, 0], [360 * S, 0]], lato: 'R', run: SURF.GRASS, runW: 6, bar: BAR.FENCE, kerb: 0 },
    // via di fuga asfaltata al Tornante della Pieve
    { at: [700 * S, 420 * S], r: 70, lato: 'L', run: SURF.RUNOFF, runW: 26, bar: BAR.TECPRO },
  ],
};

// ------------------------------------------------------------------ MONZA (dati reali)
export function monzaDef(json) {
  const samples = json.centro.map((p, i) => ({ x: p[0], y: p[1], z: p[2], w: json.larghezze[i] }));
  const L = json.lunghezza;
  const at = (name) => (json.curve.find((c) => c.name === name) || { s: 0 }).s;
  const r = at('Variante del Rettifilo'), alb = at('Curva Alboreto');
  const rog = at('Variante della Roggia'), via = at('Curva Vialone'), asc = at('Variante Ascari');
  return {
    id: 'monza',
    nome: 'Monza',
    sottotitolo: `Scala 1:1 · ${(L / 1000).toFixed(3).replace('.', ',')} km · dati reali OpenStreetMap`,
    stile: 'monza',
    samples,
    startS: 0,
    curve: json.curve.map((c) => ({ name: c.name === 'Curva Alboreto' ? 'Parabolica (Curva Alboreto)' : c.name === 'Curva Biassono' ? 'Curva Grande (Biassono)' : c.name, s: c.s + 40 })),
    // corsia box vera (OpenStreetMap proiettata sulla pista): a destra, si stacca a 556 m dal traguardo e rientra a 164 m
    pit: { lato: 'R', da: L - 556, a: 164, d: 18.3, w: 9, rIn: 190, rOut: 145 },
    override: [
      // Rettifilo: muretto box a destra, tribune a sinistra
      { da: L - 330, a: r - 140, lato: 'R', run: SURF.RUNOFF, runW: 3, bar: BAR.WALL, kerb: 0 },
      { da: L - 330, a: r - 140, lato: 'L', run: SURF.GRASS, runW: 5, bar: BAR.FENCE, kerb: 0 },
      // Variante del Rettifilo (destra-sinistra, apici a r+10 e r+42): non si taglia.
      // Interno della 1ª (destra) e della 2ª (sinistra) chiusi da TecPro subito dopo il cordolo;
      // via di fuga in asfalto all'esterno della 1ª per chi sbaglia la frenata, che si richiude in diagonale e riporta in pista.
      { da: r - 120, a: r - 45, lato: 'R', run: SURF.RUNOFF, runW: 26, bar: BAR.TECPRO },
      { da: r - 45, a: r - 15, lato: 'R', run: SURF.RUNOFF, runW: [26, 2.5], bar: BAR.TECPRO },
      { da: r - 15, a: r + 28, lato: 'R', run: SURF.RUNOFF, runW: 2.5, bar: BAR.TECPRO },
      { da: r + 28, a: r + 60, lato: 'R', run: SURF.RUNOFF, runW: [2.5, 26], bar: BAR.TECPRO },
      { da: r + 60, a: r + 140, lato: 'R', run: SURF.RUNOFF, runW: 26, bar: BAR.TECPRO },
      { da: r - 120, a: r + 0, lato: 'L', run: SURF.RUNOFF, runW: 26, bar: BAR.TECPRO },
      { da: r + 0, a: r + 45, lato: 'L', run: SURF.RUNOFF, runW: [26, 2.5], bar: BAR.TECPRO },
      { da: r + 45, a: r + 80, lato: 'L', run: SURF.RUNOFF, runW: 2.5, bar: BAR.TECPRO },
      { da: r + 80, a: r + 120, lato: 'L', run: SURF.RUNOFF, runW: [2.5, 7], bar: BAR.TECPRO },
      // cordoli larghi nelle varianti, come si vedono sul satellite (piatti larghi + dissuasore): li usa anche l'IA
      { da: r - 15, a: r + 85, lato: 'B', kerb: 2.2 },
      { da: rog - 25, a: rog + 75, lato: 'B', kerb: 2.2 },
      { da: Math.min(via, asc) - 30, a: Math.max(via, asc) + 110, lato: 'B', kerb: 2.0 },
      // Curva Grande / Biassono: ghiaia all'esterno (sinistra)
      { da: r + 420, a: r + 860, lato: 'L', run: SURF.GRAVEL, runW: 20, bar: BAR.TECPRO },
      // Parabolica: ghiaia all'esterno (sinistra)
      { da: alb + 40, a: alb + 520, lato: 'L', run: SURF.GRAVEL, runW: 30, bar: BAR.TECPRO },
    ],
    json,
  };
}

