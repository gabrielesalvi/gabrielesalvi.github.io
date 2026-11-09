// Visuali: inseguimento vicino/lontano, cofano, abitacolo, TV (griglia/arrivo) e camera libera per le foto.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export const VISUALI = ['inseguimento', 'lontana', 'cofano', 'abitacolo'];
export const VISUALI_NOMI = { inseguimento: 'Inseguimento', lontana: 'Inseguimento lontano', cofano: 'Cofano', abitacolo: 'Abitacolo' };

export class CameraRig {
  constructor(camera, dom) {
    this.cam = camera;
    this.dom = dom;
    this.mode = 'inseguimento';
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.heading = 0;
    this.fov = 62;
    this.shake = 0;
    this.orbit = null;
    this.init = false;
    this._v = new THREE.Vector3();
    this._m = new THREE.Matrix4();
    // sguardo col mouse (trascinando) e indietro (tasto tenuto): offset rispetto alla direzione dell'auto
    this.lookYaw = 0; this.lookPitch = 0; this.indietro = false;
    this._drag = null; this._rilascio = 0; this._back = 0;
    if (dom) {
      // una sola telecamera ascolta il mouse: quella vecchia (pista precedente) smette
      if (dom._rigAbort) dom._rigAbort.abort();
      const ac = new AbortController(), o = { signal: ac.signal };
      dom._rigAbort = ac;
      dom.addEventListener('pointerdown', (e) => {
        if (this.orbit || (e.button !== 0 && e.button !== 2)) return; // in modalità foto comanda la camera libera
        this._drag = { x: e.clientX, y: e.clientY };
        dom.setPointerCapture?.(e.pointerId);
      }, o);
      dom.addEventListener('pointermove', (e) => {
        if (!this._drag) return;
        const dx = e.clientX - this._drag.x, dy = e.clientY - this._drag.y;
        this._drag.x = e.clientX; this._drag.y = e.clientY;
        this.lookYaw += dx * 0.006; // trascinando a destra si guarda a destra
        this.lookPitch = Math.max(-0.5, Math.min(0.6, this.lookPitch - dy * 0.004));
      }, o);
      const su = () => { if (this._drag) { this._drag = null; this._rilascio = performance.now(); } };
      dom.addEventListener('pointerup', su, o);
      dom.addEventListener('pointercancel', su, o);
      dom.addEventListener('contextmenu', (e) => e.preventDefault(), o);
    }
  }

  /** aggiorna gli offset di sguardo: lasciato il mouse, dopo 0,8 s la visuale torna dritta; il tasto «indietro» gira di 180° */
  _sguardo(dt) {
    if (!this._drag && performance.now() - this._rilascio > 800) {
      const k = 1 - Math.exp(-dt * 3);
      let y = this.lookYaw; while (y > Math.PI) y -= 2 * Math.PI; while (y < -Math.PI) y += 2 * Math.PI;
      this.lookYaw = y * (1 - k); this.lookPitch *= 1 - k;
    }
    this._back += ((this.indietro ? 1 : 0) - this._back) * (1 - Math.exp(-dt * 14));
    return { yaw: this.lookYaw + this._back * Math.PI, pitch: this.lookPitch };
  }
  setMode(m, visual) {
    this.mode = m;
    if (visual) visual.setCockpit(m === 'abitacolo');
    this.init = false;
  }
  next(visual) {
    const i = (VISUALI.indexOf(this.mode) + 1) % VISUALI.length;
    this.setMode(VISUALI[i], visual);
    return this.mode;
  }

  /** camera di gara */
  update(dt, car, visual, groundAt) {
    const cam = this.cam;
    const cy = Math.cos(car.yaw), sy = Math.sin(car.yaw);
    const v = car.speed;
    if (this.mode === 'inseguimento' || this.mode === 'lontana') {
      const far = this.mode === 'lontana';
      const dist = far ? 9.5 : 6.4, h = far ? 3.1 : 2.05;
      // direzione morbida: segue l'auto, un po' la velocità nelle derapate
      let target = car.yaw;
      if (v > 5) {
        const vh = Math.atan2(car.vz, car.vx);
        let d = vh - car.yaw;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        if (Math.abs(d) < 1.4 && car.vLong > 0) target = car.yaw + d * 0.35;
      }
      let dh = target - this.heading;
      while (dh > Math.PI) dh -= 2 * Math.PI;
      while (dh < -Math.PI) dh += 2 * Math.PI;
      if (!this.init) { this.heading = target; dh = 0; this.spd = v; this.hy = car.y + h; }
      // smorzamenti esponenziali: stesso risultato a qualsiasi frequenza dei fotogrammi
      const ex = (k) => 1 - Math.exp(-k * dt);
      this.heading += dh * ex(far ? 4.5 : 6);
      // un filo di arretramento con la velocità (graduale), ma niente molla in avanti/indietro:
      // la molla a 290 km/h lasciava la camera 12 m dietro invece di 6 e saltava a ogni fotogramma irregolare
      this.spd += (v - this.spd) * ex(1.5);
      const dEff = dist + Math.min(1.4, this.spd * 0.016);
      this.hy += (car.y + h - this.hy) * ex(8);
      const sg = this._sguardo(dt);
      const hh = this.heading + sg.yaw;
      const hx = Math.cos(hh), hz = Math.sin(hh);
      const dP = dEff * Math.cos(sg.pitch);
      this.pos.set(car.x - hx * dP, this.hy + dEff * Math.sin(sg.pitch), car.z - hz * dP);
      const gy = groundAt ? groundAt(this.pos.x, this.pos.z) : -1e9;
      if (this.pos.y < gy + 0.8) this.pos.y = gy + 0.8;
      // guardando di lato o indietro la camera punta l'auto, non davanti a lei
      const avanti = 3.0 * Math.max(0, Math.cos(sg.yaw));
      this.look.set(car.x + cy * avanti, car.y + (far ? 1.0 : 0.9), car.z + sy * avanti);
      cam.position.copy(this.pos);
      cam.lookAt(this.look);
      this.fov += (Math.min(82, 60 + v * 0.22) - this.fov) * ex(3);
    } else {
      // camere solidali con la carrozzeria
      visual.group.updateMatrixWorld(true);
      const p = this.mode === 'cofano' ? visual.bonnet : visual.eye;
      this._v.copy(p).applyMatrix4(visual.body.matrixWorld);
      cam.position.copy(this._v);
      const fwd = new THREE.Vector3(1, 0, 0).transformDirection(visual.body.matrixWorld);
      const up = new THREE.Vector3(0, 1, 0).transformDirection(visual.body.matrixWorld);
      cam.up.copy(up);
      const sg = this._sguardo(dt);
      fwd.applyAxisAngle(up, sg.yaw);
      this.look.copy(this._v).addScaledVector(fwd, 10).addScaledVector(up, (this.mode === 'cofano' ? -0.25 : -0.9) + Math.tan(sg.pitch) * 10);
      cam.lookAt(this.look);
      cam.up.set(0, 1, 0);
      this.fov += ((this.mode === 'abitacolo' ? 66 : 64) + v * 0.12 - this.fov) * Math.min(1, dt * 3);
    }
    // vibrazioni: cordoli, fuori pista, atterraggi
    const sh = (car.onKerb ? 0.012 * car.onKerb : 0) + (car.offroad ? 0.02 * car.offroad : 0) + (car.landing || 0) * 0.05 + this.shake;
    if (sh > 0) {
      const k = Math.min(0.12, sh) * Math.min(1, v / 20 + 0.2);
      cam.position.x += (Math.random() - 0.5) * k;
      cam.position.y += (Math.random() - 0.5) * k;
    }
    this.shake = Math.max(0, this.shake - dt * 2);
    cam.fov = this.fov;
    cam.updateProjectionMatrix();
    this.init = true;
  }

  /** inquadratura TV fissa vicino a un punto della pista, guarda l'auto */
  tv(dt, car, anchor) {
    const cam = this.cam;
    cam.position.copy(anchor);
    cam.lookAt(car.x, car.y + 0.8, car.z);
    const d = Math.hypot(anchor.x - car.x, anchor.z - car.z);
    cam.fov = THREE.MathUtils.clamp(2 * Math.atan(5 / Math.max(d, 1)) * 57.3, 8, 55);
    cam.updateProjectionMatrix();
  }

  // ---------- modalità foto
  startOrbit(target) {
    this.orbit = new OrbitControls(this.cam, this.dom);
    this.orbit.target.copy(target);
    this.orbit.enableDamping = true;
    this.orbit.maxDistance = 120;
    this.orbit.minDistance = 1.5;
    this.orbit.update();
  }
  stopOrbit() {
    if (this.orbit) { this.orbit.dispose(); this.orbit = null; }
    this.init = false;
  }
  updateOrbit(groundAt) {
    if (!this.orbit) return;
    this.orbit.update();
    const gy = groundAt ? groundAt(this.cam.position.x, this.cam.position.z) : -1e9;
    if (this.cam.position.y < gy + 0.3) this.cam.position.y = gy + 0.3;
  }
}
