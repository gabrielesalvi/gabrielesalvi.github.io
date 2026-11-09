import { maxSteer } from './car.js';
// Pilota IA: segue la traiettoria ideale con un inseguitore "pure pursuit",
// regola gas/freno sul profilo di velocità, sorpassa, evita e ogni tanto sbaglia.

export const DIFFICOLTA = {
  facile: { pace: 0.88, err: 1.6, elastico: true },
  normale: { pace: 0.95, err: 1.0, elastico: false },
  difficile: { pace: 0.98, err: 0.55, elastico: false },
};

export class AIDriver {
  constructor(car, rl, profile, difficulty, rand = Math.random) {
    this.car = car;
    this.rl = rl;
    this.p = profile; // {skill 0.95..1.02, aggr 0..1, nome}
    this.diff = DIFFICOLTA[difficulty] || DIFFICOLTA.normale;
    this.rand = rand;
    this.offset = 0;
    this.offTarget = 0;
    this.mistake = 0;
    this.mistakeKind = 0;
    this.nextMistake = 25 + rand() * 60;
    this.stuck = 0;
    this.inp = { throttle: 0, brake: 0, steer: 0, handbrake: false, assist: false };
    this.rubber = 1;
    this.kE = 2.5;
    this.kR = 0;
    this.kH = 0.7;
    this.mode = 'pp';
    this.ppA = 9;
    this.ppB = 0.5;
  }

  _rl(arr, s) {
    const tr = this.car.track;
    const f = tr.wrapS(s) / tr.step;
    const i = Math.floor(f) % tr.n, j = (i + 1) % tr.n, t = f - Math.floor(f);
    return arr[i] + (arr[j] - arr[i]) * t;
  }
  _rl2yaw(s) {
    const tr = this.car.track;
    const f = tr.wrapS(s) / tr.step;
    const i = Math.floor(f) % tr.n, j = (i + 1) % tr.n, t = f - Math.floor(f);
    const a = this.rl.yaw[i];
    let d = this.rl.yaw[j] - a;
    if (d > Math.PI) d -= 2 * Math.PI;
    if (d < -Math.PI) d += 2 * Math.PI;
    return a + d * t;
  }
  _minV(s0, s1) {
    const tr = this.car.track;
    let m = Infinity;
    for (let s = s0; s <= s1; s += tr.step * 2) m = Math.min(m, this._rl(this.rl.v, s));
    return m;
  }

  update(dt, cars, race) {
    const car = this.car, tr = car.track, p = car.proj;
    const v = car.speed;
    const s = p.s;

    // ---- errori occasionali
    this.nextMistake -= dt;
    if (this.nextMistake <= 0 && v > 25) {
      this.mistake = 1.2 + this.rand() * 1.5;
      this.mistakeKind = this.rand() < 0.5 ? 1 : 2; // 1 = frenata lunga, 2 = largo
      this.nextMistake = (40 + this.rand() * 80) / this.diff.err / Math.max(0.5, this.p.skill - 0.9) / 10;
    }
    if (this.mistake > 0) this.mistake -= dt;

    // ---- traffico: sorpasso / difesa / evitare contatti
    let want = 0, follow = Infinity, followV = 0;
    const myD = p.d;
    const rlD = this._rl(this.rl.off, s);
    for (const o of cars) {
      if (o.rimossa) continue; // auto distrutta e tolta dalla pista
      if (o === car || o.ghost > 0) continue;
      let ds = o.proj.s - s;
      if (ds > tr.length / 2) ds -= tr.length;
      if (ds < -tr.length / 2) ds += tr.length;
      const dd = o.proj.d - myD;
      const ov = o.speed;
      if (ds > 0 && ds < 32 + v * 0.4) {
        // davanti
        if (Math.abs(dd) < 2.6) {
          if (v > ov + 0.5) {
            // sorpasso: scegli il lato con più spazio
            const room = (side) => (side > 0 ? this.rl.limR : this.rl.limL)[p.i] - side * o.proj.d;
            const side = room(1) > room(-1) ? 1 : -1;
            const targetD = o.proj.d + side * 3.0;
            want = targetD - rlD;
            if (room(side) < 2.4) {
              follow = Math.min(follow, ds);
              followV = ov;
            }
          }
          if (ds < 14) { follow = Math.min(follow, ds); followV = ov; }
        }
      } else if (Math.abs(ds) <= 5.5 && Math.abs(dd) < 2.7) {
        // affiancati: allarga
        want += -Math.sign(dd || 1) * (2.7 - Math.abs(dd)) * 1.2;
      }
    }
    const lim = 0.3;
    this.offTarget = Math.max(-this.rl.limL[p.i] - rlD + lim, Math.min(this.rl.limR[p.i] - rlD - lim, want));
    if (this.mistake > 0 && this.mistakeKind === 2) this.offTarget += 1.6;
    this.offset += (this.offTarget - this.offset) * Math.min(1, dt * 1.4);

    // ---- sterzo: anticipo sulla curvatura + errore di direzione + errore laterale
    const sa = s + v * 0.12 + 1;
    const kff = this._rl(this.rl.kappa, sa);
    const wantD = this._rl(this.rl.off, s + v * 0.25 + 2) + this.offset;
    let lineYaw = this._rl2yaw(s + v * 0.1 + 1);
    let he = lineYaw - car.yaw;
    while (he > Math.PI) he -= 2 * Math.PI;
    while (he < -Math.PI) he += 2 * Math.PI;
    const ec = wantD - p.d;
    let delta;
    if (this.mode === 'pp') {
      // inseguitore "pure pursuit" sulla traiettoria (più morbido ad alta velocità)
      const look = this.ppA + v * this.ppB;
      const sl = s + look;
      const tp = tr.pointAt(sl, this._rl(this.rl.off, sl) + this.offset);
      const cy = Math.cos(car.yaw), sy = Math.sin(car.yaw);
      // posizione prevista fra un attimo (compensa l'inerzia)
      const px = car.x + car.vx * 0.08, pz = car.z + car.vz * 0.08;
      const dx = tp.x - px, dz = tp.z - pz;
      const lx = dx * cy + dz * sy, ly = -dx * sy + dz * cy;
      const curv = (2 * ly) / Math.max(1, lx * lx + ly * ly);
      delta = Math.atan(curv * car.L) + (v * curv - car.r) * this.kR;
    } else {
      delta = Math.atan(car.L * kff) + he * this.kH + Math.atan((this.kE * ec) / (v + 3));
      delta += (v * kff - car.r) * this.kR; // smorzamento d'imbardata
    }
    const dmax = maxSteer(v);
    this.inp.steer = Math.max(-1, Math.min(1, delta / dmax));

    // ---- velocità
    let pace = this.diff.pace * this.p.skill;
    if (this.diff.elastico && race && race.player) {
      let gap = race.progress(car) - race.progress(race.player);
      if (gap > 120) pace *= 0.95;
      else if (gap < -150) pace *= 1.03;
    }
    const lookV = Math.max(10, v * 0.6);
    let vt = this._minV(s, s + lookV) * pace;
    if (this.mistake > 0 && this.mistakeKind === 1) vt *= 1.06;
    if (follow < Infinity) {
      const gapWanted = 6 + v * 0.18;
      if (follow < gapWanted) vt = Math.min(vt, followV - (gapWanted - follow) * 0.5);
    }
    // fuori pista: rallenta e torna dentro
    if (car.offroad >= 3) vt = Math.min(vt, v - 1.5);
    const e = vt - v;
    if (e > 0) {
      this.inp.throttle = Math.min(1, 0.55 + e * 0.25);
      this.inp.brake = 0;
    } else {
      this.inp.throttle = e > -1.2 ? 0.25 : 0;
      this.inp.brake = e < -1.2 ? Math.min(1, -e * 0.22) : 0;
    }
    // troppo intraversata: alza il piede
    if (car.slipR > 0.16 && v > 10) this.inp.throttle *= 0.4;

    // ---- bloccata?
    if (race && race.started && v < 2) this.stuck += dt;
    else this.stuck = Math.max(0, this.stuck - dt);
    // contromano / girata
    const along = Math.cos(car.yaw) * tr.tx[p.i] + Math.sin(car.yaw) * tr.tz[p.i];
    if (race && race.started && along < -0.2 && v < 8) this.stuck += dt;
    return this.stuck > 3;
  }
}
