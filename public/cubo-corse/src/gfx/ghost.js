// Ghost del time trial: il giro migliore (valido) per pista e modalità di fisica, salvato nel browser e
// ripercorso da un'auto trasparente in sincrono col giro del giocatore. Fornisce anche il distacco in tempo reale.
import * as THREE from 'three';
import { CarVisual } from './carmodel.js';

const KEY = (pista, fisica) => `cubo-corse-ghost-v1|${pista}|${fisica || 'arcade'}`;
// canali di un campione: t (s dal via del giro), s (m percorsi nel giro), x, y, z, yaw, beccheggio, rollio, sterzo
const CANALI = 9, DEC = [3, 2, 2, 2, 2, 3, 3, 3, 3];

export function caricaGhost(pista, fisica) {
  try {
    const g = JSON.parse(localStorage.getItem(KEY(pista, fisica)) || 'null');
    if (!g || !Array.isArray(g.dati) || g.dati.length < CANALI * 10) return null;
    return g;
  } catch {
    return null;
  }
}

/** salva il giro (campioni [[t,s,x,y,z,yaw,pitch,roll,delta], …]); ritorna l'oggetto salvato, o null se lo spazio non basta */
export function salvaGhost(pista, fisica, tempo, campioni, info) {
  const dati = [];
  for (const c of campioni) for (let k = 0; k < CANALI; k++) dati.push(+c[k].toFixed(DEC[k]));
  const g = { tempo, data: new Date().toISOString(), ...info, dati };
  try {
    localStorage.setItem(KEY(pista, fisica), JSON.stringify(g));
    return g;
  } catch {
    return null;
  }
}

export class Ghost {
  constructor(scene, spec, livery, num) {
    this.scene = scene;
    this.vis = new CarVisual(spec, livery, num);
    // materiali propri, trasparenti (quelli delle auto sono condivisi)
    this.vis.group.traverse((o) => {
      if (!o.isMesh) return;
      const conv = (m) => { const c = m.clone(); c.transparent = true; c.opacity = 0.32; c.depthWrite = false; return c; };
      o.material = Array.isArray(o.material) ? o.material.map(conv) : conv(o.material);
      o.castShadow = false;
      o.renderOrder = 3;
    });
    this.vis._remesh = () => {}; // il fantasma non si ammacca
    this.vis.group.visible = false;
    scene.add(this.vis.group);
    this.dati = null;
    this.on = true;
    this._st = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, bankRoll: 0, wheelSpin: 0, delta: 0, brake: 0, gear: 3 };
    this._i = 0;
  }
  set(g) {
    this.g = g;
    this.dati = g ? g.dati : null;
    this.n = this.dati ? this.dati.length / CANALI : 0;
    this.durata = this.n ? this.dati[(this.n - 1) * CANALI] : 0;
  }
  _v(i, k) { return this.dati[i * CANALI + k]; }

  /** indice del campione con il valore del canale k appena sotto v (ricerca binaria; t e s crescono nel giro) */
  _cerca(k, v) {
    let lo = 0, hi = this.n - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (this._v(m, k) <= v) lo = m; else hi = m;
    }
    return lo;
  }

  /** posiziona il fantasma al tempo t del giro (secondi dal traguardo) */
  update(t, dt, now) {
    const G = this.vis.group;
    if (!this.dati || !this.on || t < 0 || t > this.durata) { G.visible = false; return; }
    const i = this._cerca(0, t), j = Math.min(this.n - 1, i + 1);
    const t0 = this._v(i, 0), t1 = this._v(j, 0), a = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
    const L = (k) => this._v(i, k) + (this._v(j, k) - this._v(i, k)) * a;
    const st = this._st;
    st.x = L(2); st.y = L(3); st.z = L(4);
    let dy = this._v(j, 5) - this._v(i, 5);
    while (dy > Math.PI) dy -= 2 * Math.PI;
    while (dy < -Math.PI) dy += 2 * Math.PI;
    st.yaw = this._v(i, 5) + dy * a;
    st.pitch = L(6); st.roll = L(7); st.delta = L(8);
    // ruote: girano con la velocità (dalla distanza fra due campioni)
    const ds = this._v(j, 1) - this._v(i, 1), dtc = Math.max(1e-3, t1 - t0);
    st.wheelSpin += (ds / dtc / 0.34) * dt;
    G.visible = true;
    this.vis.update(st, dt, now);
  }

  /** distacco in secondi rispetto al fantasma a parità di metri percorsi nel giro (>0 = sei più lento) */
  delta(tGiro, sGiro) {
    if (!this.dati || sGiro <= 0) return null;
    if (sGiro > this._v(this.n - 1, 1)) return null;
    const i = this._cerca(1, sGiro), j = Math.min(this.n - 1, i + 1);
    const s0 = this._v(i, 1), s1 = this._v(j, 1), a = s1 > s0 ? (sGiro - s0) / (s1 - s0) : 0;
    const tg = this._v(i, 0) + (this._v(j, 0) - this._v(i, 0)) * a;
    return tGiro - tg;
  }

  dispose() {
    this.scene.remove(this.vis.group);
    this.vis.group.traverse((o) => { if (o.isMesh) [].concat(o.material).forEach((m) => m.dispose()); });
  }
}
