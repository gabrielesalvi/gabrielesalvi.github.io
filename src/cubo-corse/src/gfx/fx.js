// Effetti a voxel: detriti dei danni, scintille, fumo delle gomme, spruzzi di pioggia, terra/erba, fuochi d'artificio.
import * as THREE from 'three';

class Pool {
  constructor(scene, max, material, { size = 0.1, gravity = -9.8, drag = 0.4, bounce = 0.35, shadow = false } = {}) {
    this.max = max;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    this.im = new THREE.InstancedMesh(geo, material, max);
    this.im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.im.count = 0;
    this.im.frustumCulled = false;
    this.im.castShadow = shadow;
    scene.add(this.im);
    this.p = new Float32Array(max * 3);
    this.v = new Float32Array(max * 3);
    this.rot = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.life0 = new Float32Array(max);
    this.size = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.n = 0;
    this.g = gravity; this.drag = drag; this.bounce = bounce;
    this.baseSize = size;
    this.col = new THREE.Color();
    this.o = new THREE.Object3D();
    // colori per istanza
    this.im.setColorAt(0, this.col.set(0xffffff));
  }
  spawn(x, y, z, vx, vy, vz, life, size, color, grow = 0) {
    let i;
    if (this.n < this.max) i = this.n++;
    else {
      // ricicla la più vecchia
      let best = 0, bl = Infinity;
      for (let k = 0; k < this.n; k += 7) if (this.life[k] < bl) { bl = this.life[k]; best = k; }
      i = best;
    }
    this.p[i * 3] = x; this.p[i * 3 + 1] = y; this.p[i * 3 + 2] = z;
    this.v[i * 3] = vx; this.v[i * 3 + 1] = vy; this.v[i * 3 + 2] = vz;
    this.rot[i * 3] = Math.random() * 6; this.rot[i * 3 + 1] = Math.random() * 6; this.rot[i * 3 + 2] = Math.random() * 6;
    this.life[i] = life; this.life0[i] = life;
    this.size[i] = size ?? this.baseSize;
    this.grow[i] = grow;
    this.im.setColorAt(i, this.col.set(color));
    this.im.instanceColor.needsUpdate = true;
  }
  update(dt, ground) {
    const o = this.o;
    let w = 0;
    for (let i = 0; i < this.n; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) continue;
      // compatta
      if (w !== i) {
        for (let k = 0; k < 3; k++) {
          this.p[w * 3 + k] = this.p[i * 3 + k]; this.v[w * 3 + k] = this.v[i * 3 + k]; this.rot[w * 3 + k] = this.rot[i * 3 + k];
        }
        this.life[w] = this.life[i]; this.life0[w] = this.life0[i]; this.size[w] = this.size[i]; this.grow[w] = this.grow[i];
        this.im.getColorAt(i, this.col); this.im.setColorAt(w, this.col);
      }
      const P = this.p, V = this.v, j = w * 3;
      V[j + 1] += this.g * dt;
      const dr = Math.max(0, 1 - this.drag * dt);
      V[j] *= dr; V[j + 1] *= dr; V[j + 2] *= dr;
      P[j] += V[j] * dt; P[j + 1] += V[j + 1] * dt; P[j + 2] += V[j + 2] * dt;
      if (ground && this.bounce >= 0) {
        const gy = ground(P[j], P[j + 2]);
        if (P[j + 1] < gy + this.size[w] * 0.5) {
          P[j + 1] = gy + this.size[w] * 0.5;
          V[j + 1] = -V[j + 1] * this.bounce;
          V[j] *= 0.6; V[j + 2] *= 0.6;
        }
      }
      this.rot[j] += V[j] * dt * 2; this.rot[j + 2] += V[j + 2] * dt * 2;
      const t = 1 - this.life[w] / this.life0[w];
      let s = this.size[w] * (1 + this.grow[w] * t);
      if (this.life[w] < 0.25) s *= this.life[w] / 0.25;
      o.position.set(P[j], P[j + 1], P[j + 2]);
      o.rotation.set(this.rot[j], this.rot[j + 1], this.rot[j + 2]);
      o.scale.setScalar(s);
      o.updateMatrix();
      this.im.setMatrixAt(w, o.matrix);
      w++;
    }
    this.n = w;
    this.im.count = w;
    this.im.instanceMatrix.needsUpdate = true;
    if (this.im.instanceColor) this.im.instanceColor.needsUpdate = true;
  }
}

export class Effects {
  constructor(scene, quality) {
    const m = (q) => Math.round(q * (quality.crowd || 1));
    this.debris = new Pool(scene, 600, new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.2 }), { size: 0.1, bounce: 0.35, drag: 0.2, shadow: true });
    const sparkMat = new THREE.MeshBasicMaterial({ toneMapped: true });
    sparkMat.color.setScalar(6);
    this.sparks = new Pool(scene, 500, sparkMat, { size: 0.04, bounce: 0.25, drag: 1.2 });
    const smokeMat = new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.16, depthWrite: false, roughness: 1 });
    this.smoke = new Pool(scene, m(700), smokeMat, { size: 0.5, gravity: 0.6, drag: 1.6, bounce: -1 });
    const sprayMat = new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.1, depthWrite: false, roughness: 0.3, color: 0xdde4ee });
    this.spray = new Pool(scene, m(900), sprayMat, { size: 0.35, gravity: -2, drag: 2.0, bounce: -1 });
    this.dirt = new Pool(scene, 500, new THREE.MeshStandardMaterial({ roughness: 1 }), { size: 0.12, bounce: 0.2, drag: 0.5 });
    const fwMat = new THREE.MeshBasicMaterial();
    fwMat.color.setScalar(8);
    this.fire = new Pool(scene, 1600, fwMat, { size: 0.35, gravity: -3.5, drag: 0.7, bounce: -1 });
    // luci dei fuochi: pool fisso (aggiungere luci a runtime ricompila gli shader)
    this.flashes = [0, 1].map(() => {
      const L = new THREE.PointLight(0xffffff, 0, 260, 1.5);
      L.visible = false;
      scene.add(L);
      return { L, t: 0 };
    });
    this._fl = 0;
    this.scene = scene;
    this._acc = 0;
  }

  /** urto: punto mondo, velocità, colore dei cubetti persi (opzionale) */
  impact(x, y, z, speed, nx = 0, nz = 0) {
    const n = Math.min(60, 6 + speed * 3);
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 2 + Math.random() * speed * 0.5;
      this.sparks.spawn(x, y + Math.random() * 0.4, z, Math.cos(a) * sp - nx * 2, 1 + Math.random() * 4, Math.sin(a) * sp - nz * 2, 0.3 + Math.random() * 0.5, 0.03 + Math.random() * 0.04, Math.random() < 0.5 ? 0xffb347 : 0xffe08a);
    }
    if (speed > 6) for (let k = 0; k < 6; k++) this.smoke.spawn(x, y, z, (Math.random() - 0.5) * 2, 1, (Math.random() - 0.5) * 2, 1.4, 0.6, 0x8a8a8a, 3);
  }
  /** cubetti staccati dall'auto (coordinate mondo) con la velocità dell'auto */
  debrisFrom(list, car) {
    const cy = Math.cos(car.yaw), sy = Math.sin(car.yaw);
    for (const d of list) {
      const wx = car.x + d.x * cy - d.z * sy, wz = car.z + d.x * sy + d.z * cy, wy = car.y + d.y;
      this.debris.spawn(wx, wy, wz, car.vx * 0.7 + (Math.random() - 0.5) * 6, 2 + Math.random() * 4, car.vz * 0.7 + (Math.random() - 0.5) * 6, 4 + Math.random() * 4, 0.1, d.color);
    }
  }
  scrape(x, y, z, vx, vz) {
    for (let k = 0; k < 3; k++) this.sparks.spawn(x, y + 0.2, z, vx * 0.5 + (Math.random() - 0.5) * 3, 1 + Math.random() * 2, vz * 0.5 + (Math.random() - 0.5) * 3, 0.35, 0.035, 0xffc060);
  }
  /** per ogni auto: fumo da sgommata, spruzzi con la pioggia, terra fuori pista */
  carFx(dt, car, wet, night) {
    const v = car.speed;
    const cy = Math.cos(car.yaw), sy = Math.sin(car.yaw);
    const rx = car.x - cy * 1.5, rz = car.z - sy * 1.5;
    if (car.skid > 0.45 && v > 6 && Math.random() < (car.skid - 0.3) * dt * 14) {
      for (const side of [-0.85, 0.85])
        this.smoke.spawn(rx - sy * side, car.y + 0.25, rz + cy * side, car.vx * 0.2 + (Math.random() - 0.5), 0.6 + Math.random(), car.vz * 0.2 + (Math.random() - 0.5), 1.2 + Math.random() * 0.8, 0.35, wet ? 0xc8ccd2 : 0xd6d6d6, 2.6);
    }
    if (wet && v > 12 && Math.random() < dt * v * 0.35) {
      for (const side of [-0.85, 0.85])
        this.spray.spawn(rx - sy * side, car.y + 0.2, rz + cy * side, car.vx * 0.55 + (Math.random() - 0.5) * 3, 1 + Math.random() * 2, car.vz * 0.55 + (Math.random() - 0.5) * 3, 0.5 + Math.random() * 0.4, 0.22 + Math.random() * 0.2, 0xc8d0da, 3);
    }
    if (car.offroad > 0 && v > 6 && Math.random() < dt * v * 0.6) {
      const gravel = car.surfaces.some((s) => s === 3);
      const c = gravel ? [0xc8b48c, 0xb09a72, 0xd8c8a0] : [0x5b8a3a, 0x4a7530, 0x6f4f32];
      for (let k = 0; k < 3; k++)
        this.dirt.spawn(rx + (Math.random() - 0.5) * 2, car.y + 0.2, rz + (Math.random() - 0.5) * 2, car.vx * 0.3 + (Math.random() - 0.5) * 4, 2 + Math.random() * 4, car.vz * 0.3 + (Math.random() - 0.5) * 4, 1.2, 0.08 + Math.random() * 0.08, c[k % 3]);
      if (gravel && Math.random() < 0.5) this.smoke.spawn(rx, car.y + 0.3, rz, car.vx * 0.1, 0.5, car.vz * 0.1, 1.8, 0.8, 0xc9b896, 3);
    }
  }
  firework(x, y, z) {
    const cols = [0xff4040, 0x40c0ff, 0xffd040, 0x80ff60, 0xff60e0, 0xffffff];
    const c = cols[Math.floor(Math.random() * cols.length)];
    const n = 140;
    for (let k = 0; k < n; k++) {
      const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u);
      const sp = 14 + Math.random() * 6;
      this.fire.spawn(x, y, z, Math.cos(a) * r * sp, u * sp, Math.sin(a) * r * sp, 1.4 + Math.random() * 0.8, 0.35, Math.random() < 0.85 ? c : 0xffffff);
    }
    this.fireworksOn = true;
    const f = this.flashes[this._fl++ % this.flashes.length];
    f.L.color.set(c);
    f.L.position.set(x, y, z);
    f.t = 0.6;
  }
  update(dt, ground) {
    this.debris.update(dt, ground);
    this.sparks.update(dt, ground);
    this.smoke.update(dt, null);
    this.spray.update(dt, null);
    this.dirt.update(dt, ground);
    this.fire.update(dt, null);
    for (const f of this.flashes) {
      f.t = Math.max(0, f.t - dt);
      f.L.intensity = (f.t / 0.6) * 2200;
    }
    // le luci restano negli shader solo di notte, a fuochi iniziati (una ricompilazione all'arrivo, non a ogni scoppio)
    const want = this.night && this.fireworksOn;
    for (const f of this.flashes) f.L.visible = want;
  }
}
