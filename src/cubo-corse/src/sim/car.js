// Fisica arcade di una GT. Modello a bicicletta con carico aerodinamico, cambio automatico,
// cerchio d'attrito sul posteriore, superfici, salti, urti contro le barriere.
// Convenzioni: avanti = (cos yaw, sin yaw) sul piano x-z; destra = (-sin yaw, cos yaw); yaw>0 = svolta a destra.

import { SURF, SURF_PHYS, BAR } from './track.js';

const G = 9.81;

// Tre carrozzerie con prestazioni bilanciate (stile "balance of performance")
export const CARS = [
  {
    id: 'falco', nome: 'Falco GT', tipo: 'Berlinetta a motore anteriore',
    mass: 1320, power: 420000, mu: 1.68, df: 1.30, cd: 0.49, a: 1.18, b: 1.47, cyl: 8, idleHz: 0.9,
    voce: { base: 0.5, grinta: 0.75 },
  },
  {
    id: 'vespro', nome: 'Vespro R', tipo: 'Centrale, corta e nervosa',
    mass: 1260, power: 405000, mu: 1.72, df: 1.42, cd: 0.51, a: 1.34, b: 1.26, cyl: 6, idleHz: 1.1,
    voce: { base: 0.65, grinta: 0.9 },
  },
  {
    id: 'orsa', nome: 'Orsa CL', tipo: 'Coda lunga, velocissima sul dritto',
    mass: 1300, power: 412000, mu: 1.66, df: 1.24, cd: 0.45, a: 1.30, b: 1.40, cyl: 12, idleHz: 1.2,
    voce: { base: 0.8, grinta: 0.6 },
  },
];

const GEARS = [3.05, 2.32, 1.86, 1.53, 1.29, 1.11];
const FINAL = 3.22;
const RW = 0.34;
const IDLE = 1300, REDLINE = 8300, UP = 7850, DOWN = 4700;

function powerAt(rpm) {
  // curva di potenza normalizzata (picco ~7300 giri)
  const x = rpm / 7300;
  if (x < 1) return 0.28 + 0.72 * Math.sin((x * Math.PI) / 2) ** 1.3;
  return Math.max(0.6, 1 - (x - 1) * 0.55);
}

/**
 * Danni meccanici (modalità «Danni: meccanici»): 0 = integro, 1 = distrutto.
 * muso = ala anteriore e radiatore, alettone, motore, cambio, ruote = sospensioni/ruote [ant sx, ant dx, post sx, post dx].
 */
export function nuoviDanni() {
  return { muso: 0, alettone: 0, motore: 0, cambio: 0, ruote: [0, 0, 0, 0] };
}

/** aiuti della modalità arcade (vedi step) */
export let STEER_MARGIN = 0.06, LAT_DAMP = 0.6, STEER_MARGIN_SIM = 0.06;
export function setSimMargin(v) { STEER_MARGIN_SIM = v; }
/** interruttori degli aiuti arcade (solo per le prove: tests/steer-step.mjs) */
export const AIUTI = { controsterzo: true, limitatore: true, esc: true };
export function setArcadeTuning(m, l) { STEER_MARGIN = m; LAT_DAMP = l; }

/** angolo di sterzo massimo (rad) in funzione della velocità */
export function maxSteer(v) {
  return 0.6 / (1 + v / 28);
}

function tire(alpha, peak, floor = 0.8) {
  const x = Math.abs(alpha) / peak;
  const y = x < 1 ? 2 * x - x * x : Math.max(floor, 1 - 0.22 * (x - 1));
  return Math.sign(alpha) * y;
}

export class Car {
  constructor(spec, track, id = 0) {
    this.spec = spec;
    this.track = track;
    this.id = id;
    this.L = spec.a + spec.b;
    this.Iz = spec.mass * 1.55;
    this.halfW = 1.0;
    this.halfL = 2.3;
    this.reset(0, 0);
    this.impacts = [];
    this.damage = 0; // 0..1 (perdita di velocità di punta piccola)
  }

  /** posiziona l'auto a (s, d) ferma */
  reset(s, d) {
    const p = this.track.pointAt(s, d);
    this.x = p.x; this.z = p.z; this.y = p.y;
    this.yaw = p.yaw;
    this.vLong = 0; this.vLat = 0; this.r = 0; this.vy = 0;
    this.gear = 1; this.rpm = IDLE; this.shiftT = 0;
    this.steer = 0; this.delta = 0;
    this.throttle = 0; this.brake = 0; this.handbrake = false;
    this.ax = 0; this.ay = 0;
    this.air = 0;
    this.proj = this.track.project(this.x, this.z, p.i, {});
    this.hint = this.proj.i;
    this.wheelSpin = 0;
    this.slipF = 0; this.slipR = 0; this.skid = 0;
    this.surfaces = [SURF.ROAD, SURF.ROAD, SURF.ROAD, SURF.ROAD];
    this.onKerb = 0; this.offroad = 0;
    this.pitch = 0; this.roll = 0;
    this.ghost = 0; // secondi di "fantasma" dopo un reset (niente urti fra auto)
    // i danni meccanici NON si azzerano con la rimessa in pista (R): solo una nuova auto riparte integra
    if (!this.dmg) this.dmg = nuoviDanni();
  }

  get speed() {
    return Math.hypot(this.vLong, this.vLat);
  }
  get vx() {
    return this.vLong * Math.cos(this.yaw) - this.vLat * Math.sin(this.yaw);
  }
  get vz() {
    return this.vLong * Math.sin(this.yaw) + this.vLat * Math.cos(this.yaw);
  }
  setWorldVel(vx, vz) {
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    this.vLong = vx * c + vz * s;
    this.vLat = -vx * s + vz * c;
  }

  /**
   * inp: {throttle 0..1, brake 0..1, steer -1..1 (già filtrato), handbrake bool, assist bool}
   * env: {wet: 0..1}
   */
  step(dt, inp, env) {
    const sp = this.spec, m = sp.mass, tr = this.track;
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    const v = Math.hypot(this.vLong, this.vLat);
    if (this.ghost > 0) this.ghost -= dt;

    // ---- pista sotto l'auto
    const p = tr.project(this.x, this.z, this.hint, this.proj);
    this.hint = p.i;
    const tnx = tr.nx[p.i], tnz = tr.nz[p.i];
    // ruote: ant sx, ant dx, post sx, post dx
    const wx = [sp.a, sp.a, -sp.b, -sp.b], wy = [-0.82, 0.82, -0.82, 0.82];
    let muF = 0, muR = 0, drag = 0, dragV = 0, kerb = 0, off = 0;
    const wet = env.wet || 0;
    for (let k = 0; k < 4; k++) {
      const ox = c * wx[k] - s * wy[k], oz = s * wx[k] + c * wy[k];
      const dw = p.d + ox * tnx + oz * tnz;
      const ad = Math.abs(dw), hw = p.w / 2;
      const E = dw >= 0 ? tr.R : tr.L;
      let type = ad <= hw ? SURF.ROAD : ad <= hw + E.kerb[p.i] ? SURF.KERB : E.run[p.i];
      this.surfaces[k] = type;
      const ph = SURF_PHYS[type];
      let mu = ph.mu;
      if (wet) mu *= type === SURF.ROAD || type === SURF.RUNOFF ? 1 - 0.24 * wet : type === SURF.KERB ? 1 - 0.4 * wet : 1 - 0.15 * wet;
      // ruota/sospensione danneggiata: meno aderenza; rotta: quasi niente, e struscia
      const rd = this.dannoOn ? this.dmg.ruote[k] : 0;
      if (rd > 0) mu *= rd >= 1 ? 0.15 : 1 - 0.55 * rd;
      if (k < 2) muF += mu / 2; else muR += mu / 2;
      drag += ph.drag / 4 + (rd >= 1 ? 1.6 : rd * 0.25); dragV += ph.dragV / 4;
      if (type === SURF.KERB) kerb++;
      if (type === SURF.GRASS || type === SURF.GRAVEL) off++;
    }
    this.onKerb = kerb; this.offroad = off;

    // ---- quota / salti
    const gy = tr.groundY(p);
    const along = c * tr.tx[p.i] + s * tr.tz[p.i];
    const slopeH = tr.slope[p.i] * along;
    const vyTrack = slopeH * this.vLong;
    this.landing = 0;
    if (this.air === 0) {
      // il terreno "scende" più in fretta della gravità → decollo (dossi, Cavatappi)
      if (vyTrack - this.vy < -G * dt * 1.2 && v > 22) {
        this.air = dt;
        this.y += this.vy * dt;
      } else {
        this.y = gy;
        this.vy = vyTrack;
      }
    } else {
      this.vy -= G * dt;
      this.y += this.vy * dt;
      this.air += dt;
      if (this.y <= gy) {
        this.landing = Math.max(0, vyTrack - this.vy);
        this.y = gy;
        this.vy = vyTrack;
        this.air = 0;
      }
    }
    const inAir = this.air > 0;

    // ---- comandi
    this.throttle = inp.throttle; this.brake = inp.brake; this.handbrake = !!inp.handbrake;
    let thr = inp.throttle, brk = inp.brake;
    if (this.gear === -1) {
      // retromarcia: il freno spinge indietro, il gas frena
      [thr, brk] = [inp.brake, inp.throttle];
      if (inp.throttle > 0.1 && v < 1.0) this.gear = 1;
    } else if (inp.brake > 0.5 && inp.throttle < 0.05 && v < 0.8) {
      this._revT = (this._revT || 0) + dt;
      if (this._revT > 0.35) { this.gear = -1; this._revT = 0; }
    } else this._revT = 0;

    // modalità: arcade (tastiera con aiuti), realistica (giocatore senza aiuti), IA (né l'una né l'altra)
    const arcade = !!inp.assist && !inp.sim, sim = !!inp.sim;
    let dmax = maxSteer(v);
    if ((arcade && v > 12) || (sim && inp.assist && v > 8)) {
      // in velocità il tasto gira le ruote quanto le gomme possono reggere (più un margine per sentire il limite),
      // non di più: altrimenti ogni colpo di sterzo diventa una sbandata e al rilascio l'auto fa il pendolo.
      // In realistica (solo tastiera) si ferma poco oltre l'angolo di massima aderenza: con un tasto non si può dosare,
      // e a fondo le gomme anteriori andavano oltre il limite (1,05 g invece di 1,5 a 60 km/h)
      const aMax = sp.mu * (G + (sp.df * v * v) / m);
      dmax = Math.min(dmax, (this.L * aMax) / (v * v) + (sim ? STEER_MARGIN_SIM : STEER_MARGIN));
    }
    let delta = inp.steer * dmax;
    if (this.dannoOn) {
      // anteriore piegata: l'auto tira dalla parte della ruota più danneggiata
      delta += (this.dmg.ruote[1] - this.dmg.ruote[0]) * 0.035;
      if (this.distrutta) delta = 0;
    }
    const vls = Math.max(Math.abs(this.vLong), 2.5);
    const beta = Math.atan2(this.vLat, vls);
    if (arcade && AIUTI.controsterzo && v > 6 && Math.abs(beta) > 0.07) {
      // controsterzo automatico (solo tastiera)
      delta += Math.max(-0.25, Math.min(0.25, (beta - Math.sign(beta) * 0.07) * 0.8));
    }
    // limitatore di deriva: le ruote anteriori non superano il picco di aderenza (non in modalità realistica)
    if (!sim && (AIUTI.limitatore || !arcade) && v > 8 && this.air === 0) {
      const aKin = Math.atan2(this.vLat + this.r * sp.a, vls) * (this.vLong >= 0 ? 1 : -1);
      const lim = 0.135;
      delta = Math.max(aKin - lim, Math.min(aKin + lim, delta));
    }
    this.delta = delta;

    // ---- carichi
    const dfk = sp.df * (1 - this.damage * 0.25);
    // aria sporca: da molto vicino a un'altra auto si perde un po' di carico (vedi Race._scia)
    const down = inAir ? 0 : dfk * v * v * (1 - (this.dirty || 0));
    const Lw = this.L;
    const transfer = (m * this.ax * (sim ? 0.42 : 0.18)) / Lw;
    const kMuso = this.dannoOn ? 1 - 0.6 * this.dmg.muso : 1, kAla = this.dannoOn ? 1 - 0.7 * this.dmg.alettone : 1;
    const FzF = inAir ? 0 : Math.max(200, (m * G * sp.b) / Lw + down * 0.5 * kMuso - transfer);
    const FzR = inAir ? 0 : Math.max(200, (m * G * sp.a) / Lw + down * 0.5 * kAla + transfer);
    const mu = sp.mu;

    // ---- motore e cambio
    const dir = this.gear === -1 ? -1 : 1;
    const ratio = this.gear === -1 ? 3.0 : GEARS[this.gear - 1];
    const wheelRpm = (Math.abs(this.vLong) / RW) * 60 / (2 * Math.PI);
    let rpm = wheelRpm * ratio * FINAL;
    if (rpm < 2600 && thr > 0.05) rpm = Math.max(rpm, 2600 + thr * 2600 * Math.max(0, 1 - v / 12)); // frizione
    rpm = Math.max(IDLE + thr * 400, rpm);
    if (this.shiftT > 0) this.shiftT -= dt;
    if (this.gear > 0 && this.shiftT <= 0) {
      // cambio danneggiato: cambiate più lente e, oltre metà danno, niente marce alte
      const maxGear = this.dannoOn ? 6 - Math.floor(Math.max(0, this.dmg.cambio - 0.4) * 6.7) : 6;
      const tCambio = this.dannoOn ? 1 + 2.5 * this.dmg.cambio : 1;
      if (rpm > UP && this.gear < maxGear) { this.gear++; this.shiftT = 0.09 * tCambio; this.onShift && this.onShift(1); }
      else if (this.gear > 1) {
        const lower = wheelRpm * GEARS[this.gear - 2] * FINAL;
        if ((rpm < DOWN && lower < UP - 600) || (brk > 0.3 && lower < UP - 900 && rpm < 6500)) {
          this.gear--; this.shiftT = 0.07; this.onShift && this.onShift(-1);
        }
      }
    }
    this.rpm += (Math.min(rpm, REDLINE + 150) - this.rpm) * Math.min(1, dt * 18);
    let Fdrive = 0;
    if (this.shiftT <= 0 && thr > 0) {
      let P = sp.power * powerAt(this.rpm) * (1 - this.damage * 0.06);
      if (this.dannoOn) P *= this.dmg.motore >= 1 || this.distrutta ? 0 : 1 - 0.65 * this.dmg.motore;
      const omega = (this.rpm * 2 * Math.PI) / 60;
      const torque = P / Math.max(omega, 100);
      Fdrive = (torque * ratio * FINAL * 0.92) / RW * thr;
      // limitatore morbido: la spinta cala negli ultimi 100 giri invece di accendersi e spegnersi a ogni passo
      if (this.rpm > REDLINE - 100) Fdrive *= Math.max(0.1, (REDLINE - this.rpm) / 100);
      if (this.gear === -1 && Math.abs(this.vLong) > 7) Fdrive = 0;
    }

    // ---- gomme
    const peak = 0.11;
    const signV = this.vLong >= 0 ? 1 : -1;
    const aF = Math.atan2(this.vLat + this.r * sp.a, vls) - delta * signV;
    const aR = Math.atan2(this.vLat - this.r * sp.b, vls);
    let capF = mu * muF * FzF, capR = mu * muR * FzR;
    if (this.handbrake) capR *= 0.42;
    const floor = sim ? 0.68 : 0.8; // realistica: oltre il limite la gomma molla di più
    let FyF = -tire(aF, peak, floor) * capF;
    let FyR = -tire(aR, peak, floor) * capR;
    // freni (con ABS) e trazione nel cerchio d'attrito
    const Fbmax = mu * (muF * FzF + muR * FzR) * 0.98;
    let Fb = (this.distrutta ? Math.max(brk, 0.55) : brk) * Fbmax;
    if (this.handbrake) Fb += 0.35 * capR;
    let Fx = Fdrive * dir;
    // controllo di trazione morbido
    const fxCap = Math.sqrt(Math.max(0, capR * capR - FyR * FyR * 0.6));
    if (sim) {
      // niente controllo di trazione: oltre il cerchio d'attrito le ruote pattinano (spinta ridotta, posteriore che scappa)
      if (Math.abs(Fx) > fxCap) { Fx = Math.sign(Fx) * fxCap * 0.85; this.spin = 1; } else this.spin = 0;
    } else if (Math.abs(Fx) > fxCap) Fx = Math.sign(Fx) * (fxCap + (Math.abs(Fx) - fxCap) * 0.15);
    // il posteriore perde laterale quando spinge forte (sovrasterzo di potenza)
    const useR = Math.min(1, Math.abs(Fx) / Math.max(capR, 1) + (sim && this.spin ? 0.25 : 0));
    FyR *= Math.sqrt(Math.max(0.25, 1 - useR * useR * 0.85));
    const useB = Math.min(1, Fb / Math.max(Fbmax, 1));
    FyF *= 1 - useB * 0.18; FyR *= 1 - useB * 0.22;
    this.slipF = Math.abs(aF); this.slipR = Math.abs(aR);
    this.skid = Math.max(0, Math.max(Math.abs(aF), Math.abs(aR)) - peak * 0.9) * v * 0.15 + (useB > 0.95 && v > 5 ? 0.3 : 0) + (useR > 0.98 && thr > 0.8 && v < 14 ? 0.25 : 0);
    if (inAir) { FyF = 0; FyR = 0; Fx = 0; Fb = 0; }

    // ---- forze sul corpo
    // scia: dietro un'altra auto la resistenza dell'aria cala (this.draft 0..0,45, vedi Race._scia)
    const aero = sp.cd * (1 - (this.draft || 0)) * (this.dannoOn ? 1 + 0.18 * this.dmg.muso + 0.1 * this.dmg.alettone : 1);
    const slopeForce = -m * G * slopeH;
    let FxB = Fx - FyF * Math.sin(delta) - aero * this.vLong * v - 4 * this.vLong + slopeForce;
    let FyB = FyF * Math.cos(delta) + FyR - aero * 0.5 * this.vLat * v;
    // freni e freno della superficie si oppongono al moto
    const surfDecel = (drag + dragV * v) * m * (inAir ? 0 : 1);
    const decel = Fb + surfDecel;
    if (Math.abs(this.vLong) > 0.05) FxB -= Math.sign(this.vLong) * decel;
    else if (Math.abs(Fx) < decel) { FxB = 0; this.vLong = 0; }
    const torque = sp.a * FyF * Math.cos(delta) - sp.b * FyR;

    this.ax = FxB / m;
    this.ay = FyB / m;
    this.vLong += (this.ax + this.r * this.vLat) * dt;
    this.vLat += (this.ay - this.r * this.vLong) * dt;
    this.r += (torque / this.Iz) * dt;
    // smorzamento d'imbardata e modello cinematico a bassa velocità
    this.r *= 1 - Math.min(0.5, dt * ((sim ? 0.35 : 0.8) + (inAir ? 2 : 0)));
    // controllo di stabilità (arcade): frena l'imbardata in eccesso rispetto a quella "di guida"
    if (!inAir && v > 8) {
      const rk = (this.vLong * Math.tan(delta)) / Lw;
      const ex = this.r - rk;
      const tol = 0.12 + (this.handbrake ? 1.5 : 0) + (inp.esc === false || sim || (arcade && !AIUTI.esc) ? 9 : 0);
      // solo contro il sovrasterzo (l'auto gira più di quanto chiede lo sterzo, o al contrario): prima interveniva anche
      // nel sottosterzo, aggiungendo rotazione oltre la tenuta delle gomme → sbandata e pendolo al rilascio
      if (Math.abs(ex) > tol && Math.sign(ex) === Math.sign(this.r)) this.r -= (ex - Math.sign(ex) * tol) * Math.min(1, dt * 6);
    }
    // arcade: la sbandata laterale si smorza un po' (auto più composta, niente pendolo)
    if (arcade && !inAir && !this.handbrake && v > 10) this.vLat *= 1 - Math.min(0.05, dt * LAT_DAMP);
    if (v < 4 && !inAir) {
      const k = 1 - v / 4;
      const rk = (this.vLong * Math.tan(delta)) / Lw;
      this.r += (rk - this.r) * k * Math.min(1, dt * 12);
      this.vLat *= 1 - k * Math.min(1, dt * 8);
    }
    if (Math.abs(this.vLong) < 0.3 && thr < 0.05 && brk > 0.05) this.vLong *= 0.9;

    // ---- integrazione posizione
    const vx = this.vLong * c - this.vLat * s;
    const vz = this.vLong * s + this.vLat * c;
    this.x += vx * dt;
    this.z += vz * dt;
    this.yaw += this.r * dt;
    if (this.yaw > Math.PI) this.yaw -= 2 * Math.PI;
    if (this.yaw < -Math.PI) this.yaw += 2 * Math.PI;
    this.wheelSpin += (this.vLong / RW) * dt;

    // ---- barriere
    this._barriers(dt);

    // ---- assetto visivo (beccheggio/rollio)
    const tgtPitch = Math.atan(slopeH) + Math.max(-0.05, Math.min(0.04, this.ax * 0.0028));
    const tgtRoll = Math.max(-0.07, Math.min(0.07, this.ay * 0.0045));
    this.pitch += (tgtPitch - this.pitch) * Math.min(1, dt * 10);
    this.roll += (tgtRoll - this.roll) * Math.min(1, dt * 8);
    // inclinazione trasversale della strada vista dall'auto (rad, >0 = lato destro più alto)
    this.bankRoll = Math.abs(p.d) < p.w / 2 ? Math.atan(Math.tan(p.bank)) * along : 0;
    this.slopeH = slopeH;
  }

  _barriers() {
    const tr = this.track, p = this.track.project(this.x, this.z, this.hint, this.proj);
    const rel = this.yaw - Math.atan2(tr.tz[p.i], tr.tx[p.i]);
    const half = this.halfW * Math.abs(Math.cos(rel)) + this.halfL * Math.abs(Math.sin(rel));
    for (const side of [1, -1]) {
      const bd = tr.barrier(p, side);
      const pen = side * p.d + half - bd;
      if (pen > 0) {
        const nx = tr.nx[p.i] * side, nz = tr.nz[p.i] * side; // normale verso la barriera
        this.x -= nx * pen;
        this.z -= nz * pen;
        const vx = this.vx, vz = this.vz;
        const vn = vx * nx + vz * nz;
        if (vn > 0) {
          // rimbalzo per tipo di barriera: il muro restituisce poco, guardrail e reti si deformano, il TecPro assorbe
          const bt = (side > 0 ? tr.R : tr.L).bar[p.i];
          const e = bt === BAR.WALL ? 0.08 : bt === BAR.TECPRO ? 0 : 0.04;
          let nvx = vx - (1 + e) * vn * nx, nvz = vz - (1 + e) * vn * nz;
          // attrito lungo il muro
          const fr = Math.max(0.55, 1 - vn * 0.04);
          const tvx = nvx - (nvx * nx + nvz * nz) * nx, tvz = nvz - (nvx * nx + nvz * nz) * nz;
          nvx = tvx * fr + (nvx - tvx); nvz = tvz * fr + (nvz - tvz);
          this.setWorldVel(nvx, nvz);
          // ruota l'auto verso il parallelo al muro
          const tx = tr.tx[p.i], tz = tr.tz[p.i];
          const fwdT = Math.cos(this.yaw) * tx + Math.sin(this.yaw) * tz;
          const relN = Math.cos(this.yaw) * nx + Math.sin(this.yaw) * nz;
          this.r -= Math.sign(fwdT || 1) * relN * Math.min(1.0, vn * 0.04);
          // il contatto col muro assorbe anche parte della rotazione già presente
          this.r *= 1 - Math.min(0.25, vn * 0.02);
          if (vn > 1.2) {
            const hx = this.x + nx * half, hz = this.z + nz * half;
            this.impacts.push({ type: 'muro', car: this, speed: vn, x: hx, z: hz, y: this.y + 0.5, nx, nz, scrape: vn < 4 });
          }
        }
        // strisciata
        if (this.speed > 5) this.scraping = 0.15;
      }
    }
    // muretto della corsia box: isola solida fra pista e corsia (si urta da entrambi i lati)
    const E = p.d >= 0 ? tr.R : tr.L;
    if (E.isl0 && E.isl0[p.i] > 0) {
      const side = p.d >= 0 ? 1 : -1, ad = Math.abs(p.d), a = E.isl0[p.i], b = E.isl1[p.i];
      if (ad + half > a && ad - half < b) {
        const versoPista = ad < (a + b) / 2;           // da che parte del muretto sta l'auto
        const target = versoPista ? a - half : b + half;
        const push = (target - ad) * side;              // spostamento lungo la normale della pista
        const nx = tr.nx[p.i], nz = tr.nz[p.i];
        this.x += nx * push; this.z += nz * push;
        const sgn = Math.sign(push);                    // la normale del muretto punta da dove arriva l'auto
        const vn = -(this.vx * nx + this.vz * nz) * sgn; // velocità verso il muretto
        if (vn > 0) {
          const e = 0.08;
          this.setWorldVel(this.vx + (1 + e) * vn * nx * sgn, this.vz + (1 + e) * vn * nz * sgn);
          this.r *= 1 - Math.min(0.25, vn * 0.02);
          if (vn > 1.2) this.impacts.push({ type: 'muro', car: this, speed: vn, x: this.x - nx * sgn * half, z: this.z - nz * sgn * half, y: this.y + 0.5, nx: -nx * sgn, nz: -nz * sgn, scrape: vn < 4 });
        }
        if (this.speed > 5) this.scraping = 0.15;
      }
    }
    if (this.scraping > 0) this.scraping -= 1 / 120;
  }
}

export { GEARS, IDLE, REDLINE };
