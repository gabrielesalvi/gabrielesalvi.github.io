// Pubblico vivo: spettatori istanziati animati nello shader (saltano e alzano le braccia al passaggio
// del giocatore, fanno la ola lungo gli spalti, esultano all'arrivo) + bandiere che sventolano.
import * as THREE from 'three';

const SHIRTS = [0xd7263d, 0x1b998b, 0x2e86ab, 0xf46036, 0xffd23f, 0xffffff, 0x222222, 0x8e44ad, 0x3bb273, 0xe84855, 0x0b5fa5, 0xf2a541];

function fallbackPerson() {
  // persona voxel minima: gambe, busto, braccia, testa
  const parts = [
    [0.36, 0.8, 0.22, 0, 0.4, 0, 0, 0x2b2f3a],
    [0.46, 0.62, 0.26, 0, 1.11, 0, 1, 0xffffff],
    [0.12, 0.6, 0.14, -0.3, 1.1, 0, 2, 0xffffff],
    [0.12, 0.6, 0.14, 0.3, 1.1, 0, 2, 0xffffff],
    [0.26, 0.26, 0.26, 0, 1.58, 0, 3, 0xe0b090],
  ];
  const pos = [], nor = [], col = [], part = [], idx = [];
  const c = new THREE.Color();
  for (const [w, h, d, x, y, z, p, color] of parts) {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y, z);
    const base = pos.length / 3;
    const P = g.attributes.position.array, N = g.attributes.normal.array;
    c.set(color);
    for (let i = 0; i < P.length / 3; i++) {
      pos.push(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
      nor.push(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]);
      col.push(c.r, c.g, c.b);
      part.push(p);
    }
    for (const k of g.index.array) idx.push(base + k);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('part', new THREE.Float32BufferAttribute(part, 1));
  geo.setIndex(idx);
  return geo;
}

/** persona da lontano: gambe, busto con le braccia, testa (3 scatole, 36 triangoli invece di ~144) */
function lowPerson() {
  const parts = [
    [0.34, 0.9, 0.18, 0, 0.45, 0, 0, 0x2b2f38],
    [0.6, 0.58, 0.22, 0, 1.17, 0, 1, 0xffffff],
    [0.24, 0.3, 0.24, 0, 1.6, 0, 3, 0xc99a78],
  ];
  const pos = [], nor = [], col = [], part = [], idx = [];
  const c = new THREE.Color();
  for (const [w, h, d, x, y, z, p, color] of parts) {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y, z);
    const base = pos.length / 3;
    const P = g.attributes.position.array, N = g.attributes.normal.array;
    c.set(color);
    for (let i = 0; i < P.length / 3; i++) {
      // niente facce di sotto: non si vedono mai
      pos.push(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
      nor.push(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]);
      col.push(c.r, c.g, c.b);
      part.push(p);
    }
    for (const k of g.index.array) idx.push(base + k);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('part', new THREE.Float32BufferAttribute(part, 1));
  geo.setIndex(idx);
  return geo;
}

export class Crowd {
  /**
   * seats: [{x,y,z,yaw,seat (indice lungo la tribuna)}]; personGeo: BufferGeometry con attributi color e part
   * flagGeo: BufferGeometry con attributo flag (opzionale)
   */
  constructor(scene, seats, personGeo, flagGeo, density = 1) {
    this.u = { uTime: { value: 0 }, uPlayer: { value: new THREE.Vector3(1e6, 0, 1e6) }, uCheer: { value: 0 }, uOla: { value: 0 } };
    const geo = (personGeo || fallbackPerson()).clone();
    if (!geo.attributes.part) geo.setAttribute('part', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count).fill(1), 1));
    const rnd = mulberry(seats.length * 31 + 1);
    const chosen = seats.filter(() => rnd() < density * 0.92);
    const n = chosen.length;
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
    mat.onBeforeCompile = (sh) => this._patch(sh);
    const o = new THREE.Object3D(), c = new THREE.Color();
    // un InstancedMesh per riquadro di 100 m: la scheda video scarta le tribune fuori inquadratura,
    // e update() spegne quelle lontane (a qualche centinaio di metri una persona è meno di un pixel)
    this.tiles = [];
    this.lods = []; // [vicino, lontano] per riquadro
    const low = lowPerson();
    for (const part of byTile(chosen, 100)) {
      const g = new THREE.BufferGeometry();
      for (const name of Object.keys(geo.attributes)) g.setAttribute(name, geo.attributes[name]);
      g.setIndex(geo.index);
      const phase = new Float32Array(part.length), seatIx = new Float32Array(part.length);
      const im = new THREE.InstancedMesh(g, mat, part.length);
      part.forEach((s, k) => {
        o.position.set(s.x, s.y, s.z);
        o.rotation.set(0, s.yaw + (rnd() - 0.5) * 0.4, 0);
        const sc = 0.9 + rnd() * 0.2;
        o.scale.set(sc, sc * (0.92 + rnd() * 0.16), sc);
        o.updateMatrix();
        im.setMatrixAt(k, o.matrix);
        im.setColorAt(k, c.set(SHIRTS[Math.floor(rnd() * SHIRTS.length)]).multiplyScalar(0.8 + rnd() * 0.3));
        phase[k] = rnd();
        seatIx[k] = s.seat ?? k;
      });
      g.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
      g.setAttribute('aSeat', new THREE.InstancedBufferAttribute(seatIx, 1));
      im.castShadow = false;
      im.receiveShadow = true;
      im.computeBoundingSphere();
      im.boundingSphere.radius += 2.5; // salti e braccia alzate (spostati nello shader)
      // versione da lontano: stesse istanze (matrici, colori, fase), geometria semplice
      const gl = new THREE.BufferGeometry();
      for (const name of Object.keys(low.attributes)) gl.setAttribute(name, low.attributes[name]);
      gl.setIndex(low.index);
      gl.setAttribute('aPhase', g.attributes.aPhase);
      gl.setAttribute('aSeat', g.attributes.aSeat);
      const lim = new THREE.InstancedMesh(gl, mat, part.length);
      lim.instanceMatrix = im.instanceMatrix;
      lim.instanceColor = im.instanceColor;
      lim.receiveShadow = true;
      lim.boundingSphere = im.boundingSphere.clone();
      lim.visible = false;
      im.name = lim.name = 'pubblico';
      this.lods.push([im, lim]);
      scene.add(im, lim);
    }
    // bandiere: ~1 ogni 14 spettatori
    this.flags = null;
    const fl = chosen.filter((_, k) => k % 14 === 3);
    if (flagGeo && fl.length) {
      const fm = new THREE.MeshStandardMaterial({ vertexColors: false, roughness: 0.8, side: THREE.DoubleSide });
      fm.onBeforeCompile = (sh) => {
        sh.uniforms.uTime = this.u.uTime;
        sh.uniforms.uCheer = this.u.uCheer;
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nattribute float flag; uniform float uTime; uniform float uCheer;')
          .replace('#include <begin_vertex>', `#include <begin_vertex>
            float ph = instanceMatrix[3][0] * 0.37 + instanceMatrix[3][2] * 0.11;
            float wv = sin(uTime * (5.0 + uCheer * 4.0) - flag * 5.0 + ph) * 0.18 * flag;
            transformed.z += wv;
            transformed.y += sin(uTime * 3.0 + ph) * 0.03 * flag + 0.35;`);
      };
      const fc = [0xd7263d, 0x009246, 0xffffff, 0xffd23f, 0x2e86ab, 0xf46036];
      let j = 0;
      for (const part of byTile(fl, 160)) {
        const fim = new THREE.InstancedMesh(flagGeo, fm, part.length);
        part.forEach((s, k) => {
          o.position.set(s.x + 0.25, s.y + 1.2, s.z);
          o.rotation.set(0, s.yaw + Math.PI / 2, 0);
          o.scale.setScalar(1);
          o.updateMatrix();
          fim.setMatrixAt(k, o.matrix);
          fim.setColorAt(k, c.set(fc[j++ % fc.length]));
        });
        fim.name = 'bandiere';
        fim.computeBoundingSphere();
        fim.boundingSphere.radius += 2;
        this.tiles.push(fim);
        scene.add(fim);
      }
    }
    this.maxDist = 700;
    this._cullT = -1;
  }
  /** distanza (in pianta) dal punto v al bordo della sfera d'ingombro */
  _dist(im, v) {
    const c = im.boundingSphere.center;
    return Math.max(0, Math.hypot(c.x - v.x, c.z - v.z) - im.boundingSphere.radius);
  }
  _patch(sh) {
    Object.assign(sh.uniforms, this.u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float part; attribute float aPhase; attribute float aSeat;
        uniform float uTime; uniform vec3 uPlayer; uniform float uCheer; uniform float uOla;`)
      .replace('#include <color_vertex>', `
        #ifdef USE_COLOR
          vColor = color;
          #ifdef USE_INSTANCING_COLOR
            if (part > 0.5 && part < 2.5) vColor *= instanceColor.rgb;
          #endif
        #endif`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        float dP = distance(ip.xz, uPlayer.xz);
        float ex = clamp(1.0 - (dP - 12.0) / 75.0, 0.0, 1.0);
        float ola = uOla > 0.0 ? smoothstep(0.82, 1.0, sin(aSeat * 0.16 - uTime * uOla)) : 0.0;
        float e = max(max(ex, uCheer), ola * 0.8);
        float hop = max(0.0, sin(uTime * (8.0 + aPhase * 3.0) + aPhase * 6.2831));
        float idle = sin(uTime * 1.2 + aPhase * 6.2831) * 0.012;
        float lift = e * hop * 0.26 + idle + ola * 0.18;
        transformed.y += lift;
        if (part > 1.5 && part < 2.5) {
          // braccia alzate (e un po' agitate)
          transformed.y += e * 0.5 + e * 0.06 * sin(uTime * 14.0 + aPhase * 30.0);
        }`);
  }
  update(t, player, cheer, ola, cam) {
    this.u.uTime.value = t;
    const v = cam || player;
    if (v && (t - this._cullT > 0.3 || t < this._cullT)) {
      this._cullT = t;
      const near = this.nearDist ?? 90;
      for (const im of this.tiles) im.visible = this._dist(im, v) < this.maxDist;
      for (const [im, lim] of this.lods) {
        const d = this._dist(im, v);
        im.visible = d < near;
        lim.visible = d >= near && d < this.maxDist;
      }
    }
    if (player) this.u.uPlayer.value.set(player.x, player.y, player.z);
    this.u.uCheer.value = cheer;
    this.u.uOla.value = ola;
  }
}

function byTile(list, size) {
  const m = new Map();
  for (const t of list) {
    const k = Math.floor(t.x / size) + ',' + Math.floor(t.z / size);
    let a = m.get(k);
    if (!a) m.set(k, (a = []));
    a.push(t);
  }
  return [...m.values()];
}

function mulberry(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
