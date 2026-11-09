// Ambiente: cielo fisico, sole/luna, ora del giorno, meteo (nuvole voxel, pioggia, nebbia),
// mappa d'ambiente per i riflessi, luci notturne (pool di luci vere + aloni finti).
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { setNight } from './voxel.js';
import { starsPoints, glowTexture, beamTexture } from './textures.js';

export const ORE = {
  alba: { amb: [0x6f8cc0, 0xf0b994, 0x4d463d], nome: 'Alba', elev: 4.5, azim: 95, sun: 0xffb27a, sunI: 2.4, hemi: 0.55, exposure: 0.95, turb: 4, ray: 2.2, night: 0.15, fogC: 0xf0b89a },
  giorno: { amb: [0x3d78d0, 0xbcd6f0, 0x575649], nome: 'Mezzogiorno', elev: 58, azim: 160, sun: 0xfff4e6, sunI: 3.3, hemi: 0.8, exposure: 0.82, turb: 2.4, ray: 1.2, night: 0, fogC: 0xb9d3ea },
  oro: { amb: [0x5a78b4, 0xf3b27a, 0x52463a], nome: 'Ora dorata', elev: 7, azim: 255, sun: 0xffa45c, sunI: 2.8, hemi: 0.55, exposure: 0.92, turb: 5, ray: 2.6, night: 0.08, fogC: 0xf3b07a },
  notte: { nome: 'Notte', elev: -12, azim: 220, sun: 0x9db4ff, sunI: 0.35, hemi: 0.12, exposure: 1.05, turb: 1, ray: 0.3, night: 1, fogC: 0x0b1222 },
};
export const METEO = {
  sereno: { nome: 'Sereno', clouds: 14, cloudGrey: 0, fog: 0.00045, rain: 0, wet: 0 },
  nuvoloso: { nome: 'Nuvoloso', clouds: 70, cloudGrey: 0.35, fog: 0.0011, rain: 0, wet: 0 },
  pioggia: { nome: 'Pioggia', clouds: 110, cloudGrey: 0.7, fog: 0.0032, rain: 1, wet: 1 },
};

export class Environment {
  constructor(renderer, scene, quality) {
    this.renderer = renderer;
    this.scene = scene;
    this.q = quality;
    this.sky = new Sky();
    this.sky.scale.setScalar(9000);
    scene.add(this.sky);
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = quality.shadows > 0;
    const S = quality.shadows || 1024;
    this.sun.shadow.mapSize.set(S, S);
    const R = quality.shadowRange || 70;
    Object.assign(this.sun.shadow.camera, { left: -R, right: R, top: R, bottom: -R, near: 1, far: 900 });
    this.sun.shadow.bias = -0.00025;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun);
    scene.add(this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xcfe6ff, 0x5a5a48, 0.6);
    scene.add(this.hemi);
    this.stars = starsPoints();
    this.stars.visible = false;
    scene.add(this.stars);
    // luna
    const moon = new THREE.Mesh(new THREE.SphereGeometry(60, 16, 12), new THREE.MeshBasicMaterial({ color: 0xdfe8ff, fog: false }));
    moon.material.color.setScalar(2.2);
    this.moon = moon;
    moon.visible = false;
    scene.add(moon);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.cloudGroup = new THREE.Group();
    scene.add(this.cloudGroup);
    this.rain = null;
    this.lampLights = [];
    this.glows = null;
    this.night = 0;
    this.wet = 0;
    this.sunDir = new THREE.Vector3();
  }

  /** ora: chiave di ORE; meteo: chiave di METEO */
  set(oraKey, meteoKey, worldCenter) {
    const O = ORE[oraKey] || ORE.giorno;
    const M = METEO[meteoKey] || METEO.sereno;
    this.O = O; this.M = M;
    const grey = M.cloudGrey;
    const night = O.night;
    this.night = night;
    this.wet = M.wet;
    setNight(night > 0.5 ? 1 : night * 0.6);
    // sole
    const phi = THREE.MathUtils.degToRad(90 - O.elev), theta = THREE.MathUtils.degToRad(O.azim);
    this.sunDir.setFromSphericalCoords(1, phi, theta);
    const u = this.sky.material.uniforms;
    u.turbidity.value = O.turb + grey * 12;
    u.rayleigh.value = O.ray * (1 - grey * 0.5);
    u.mieCoefficient.value = 0.004 + grey * 0.02;
    u.mieDirectionalG.value = 0.82;
    const sunPos = this.sunDir.clone();
    if (O.elev < 0) sunPos.y = -0.08; // cielo notturno scuro, niente bagliore
    u.sunPosition.value.copy(sunPos);
    this.sky.visible = O.elev > -5;
    const sunColor = new THREE.Color(O.sun);
    if (grey > 0) sunColor.lerp(new THREE.Color(0xc8ccd2), grey);
    this.sun.color.copy(sunColor);
    this.sun.intensity = O.sunI * (1 - grey * 0.72);
    // di notte la "luce del sole" è la luna
    const lightDir = O.elev < 0 ? new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(50), theta + 1.2) : this.sunDir;
    this.lightDir = lightDir.clone();
    this.hemi.intensity = night > 0.5 ? O.hemi : O.hemi * 0.35 * (1 + grey * 0.6);
    this.hemi.color.set(night > 0.5 ? 0x3a4a7a : grey > 0.3 ? 0xb8c2cc : 0xcfe6ff);
    this.hemi.groundColor.set(night > 0.5 ? 0x101418 : 0x4f5240);
    this.renderer.toneMappingExposure = O.exposure * (1 + grey * 0.15);
    // nebbia
    const fogC = new THREE.Color(O.fogC);
    if (grey > 0) fogC.lerp(new THREE.Color(night > 0.5 ? 0x0c1018 : 0x9aa3ab), grey * 0.85);
    this.scene.fog = new THREE.FogExp2(fogC, M.fog * (night > 0.5 ? 1.4 : 1));
    this.scene.background = night > 0.5 ? new THREE.Color(0x05070d) : null;
    if (night > 0.5 && grey > 0.3) this.scene.background = fogC.clone();
    // stelle e luna
    this.stars.visible = night > 0.5 && grey < 0.3;
    this.moon.visible = night > 0.5 && grey < 0.6;
    this.moon.position.copy(lightDir).multiplyScalar(2600);
    // mappa d'ambiente dal cielo
    this._envMap(night, grey, fogC);
    // nuvole
    this._clouds(M.clouds, grey, night, worldCenter);
    // pioggia
    if (M.rain && !this.rain) this._makeRain();
    if (this.rain) this.rain.visible = !!M.rain;
  }

  _envMap(night, grey, fogC) {
    if (this.envRT) this.envRT.dispose();
    const sc = new THREE.Scene();
    if (night > 0.5) {
      sc.background = new THREE.Color(0x0a1020);
      const glow = new THREE.Mesh(new THREE.SphereGeometry(50, 16, 8), new THREE.MeshBasicMaterial({ color: 0x2b3550, side: THREE.BackSide }));
      sc.add(glow);
      this.envRT = this.pmrem.fromScene(sc, 0.04);
    } else {
      // luce ambiente da un cielo a gradiente (zenit, orizzonte, terreno) più un alone morbido verso il sole.
      // Non uso il cielo calcolato: contiene il disco del sole, che sfocato diventa un secondo sole
      // da tutte le direzioni e appiattisce la scena (niente ombre, tutto lattiginoso).
      const A = (this.O.amb || ORE.giorno.amb).map((c) => new THREE.Color(c));
      if (grey > 0) { const g = new THREE.Color(0x9aa3ab); A[0].lerp(g, grey); A[1].lerp(g, grey * 0.8); }
      const mat = new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false,
        uniforms: { zen: { value: A[0] }, hor: { value: A[1] }, gnd: { value: A[2] }, sunDir: { value: this.sunDir.clone() },
          sunC: { value: this.sun.color.clone().multiplyScalar(1.6 * (1 - grey)) } },
        vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: `uniform vec3 zen, hor, gnd, sunDir, sunC; varying vec3 vD;
          void main(){
            float y = vD.y;
            vec3 c = y > 0.0 ? mix(hor, zen, pow(y, 0.6)) : mix(hor, gnd, pow(min(1.0, -y * 4.0), 0.5));
            float sd = max(0.0, dot(vD, normalize(sunDir)));
            c += sunC * pow(sd, 24.0);
            gl_FragColor = vec4(c, 1.0);
          }`,
      });
      sc.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), mat));
      this.envRT = this.pmrem.fromScene(sc, 0.02);
    }
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = night > 0.5 ? 0.35 : 1.0 - grey * 0.2;
    this._envBase = this.scene.environmentIntensity;
    this._hemiBase = this.hemi.intensity;
    this.shadeK = -1;
  }

  _clouds(count, grey, night, c) {
    this.cloudGroup.clear();
    if (!count) return;
    const cube = new THREE.BoxGeometry(1, 1, 1);
    const per = 9;
    const mat = new THREE.MeshLambertMaterial({ color: night > 0.5 ? 0x2a3040 : new THREE.Color(0xffffff).lerp(new THREE.Color(0x8d939b), grey), fog: true });
    const im = new THREE.InstancedMesh(cube, mat, count * per);
    const o = new THREE.Object3D();
    let k = 0;
    const rnd = mulberry(count * 13 + 7);
    const cx = c ? c.x : 0, cz = c ? c.z : 0;
    for (let i = 0; i < count; i++) {
      const r = 600 + rnd() * 2600, a = rnd() * Math.PI * 2;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r, y = 320 + rnd() * 260 - grey * 120;
      const sz = 40 + rnd() * 90;
      for (let j = 0; j < per; j++) {
        o.position.set(x + (rnd() - 0.5) * sz * 1.6, y + (rnd() - 0.3) * sz * 0.35, z + (rnd() - 0.5) * sz);
        const s = sz * (0.35 + rnd() * 0.5);
        o.scale.set(s * (1 + rnd()), s * 0.45, s);
        o.updateMatrix();
        im.setMatrixAt(k++, o.matrix);
      }
    }
    im.count = k;
    im.castShadow = false;
    this.cloudGroup.add(im);
  }

  _makeRain() {
    const N = this.q.rainDrops || 6000;
    const pos = new Float32Array(N * 6);
    this.rainSeeds = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      this.rainSeeds[i * 3] = (Math.random() - 0.5) * 70;
      this.rainSeeds[i * 3 + 1] = Math.random() * 40;
      this.rainSeeds[i * 3 + 2] = (Math.random() - 0.5) * 70;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.LineBasicMaterial({ color: 0xaab4c4, transparent: true, opacity: 0.35, depthWrite: false });
    this.rain = new THREE.LineSegments(geo, mat);
    this.rain.frustumCulled = false;
    this.scene.add(this.rain);
  }

  /** luci notturne: positions = [{x,y,z,color?}] ; crea aloni a terra e un pool di PointLight */
  setLamps(positions) {
    this.lampPositions = positions;
    if (this.glows) { this.scene.remove(this.glows); this.glows.geometry.dispose(); }
    this.lampLights.forEach((l) => this.scene.remove(l));
    this.lampLights = [];
    if (!positions.length) return;
    // aloni a terra (additivi)
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ map: glowTexture(), color: 0xffc98a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.0, polygonOffset: true, polygonOffsetFactor: -4 });
    const im = new THREE.InstancedMesh(geo, mat, positions.length);
    const o = new THREE.Object3D();
    positions.forEach((p, k) => {
      o.position.set(p.gx ?? p.x, (p.gy ?? p.y - 5) + 0.08, p.gz ?? p.z);
      const s = p.r || 18;
      o.scale.set(s, 1, s);
      o.updateMatrix();
      im.setMatrixAt(k, o.matrix);
    });
    im.frustumCulled = false;
    this.glows = im;
    this.scene.add(im);
    const n = this.q.lampLights ?? 8;
    for (let i = 0; i < n; i++) {
      const L = new THREE.PointLight(0xffc98a, 0, 34, 1.6);
      L.visible = false;
      this.scene.add(L);
      this.lampLights.push(L);
    }
  }

  /** k 0..1: quanto la telecamera è al coperto (galleria): spegne la luce diffusa del cielo, il sole resta (fa ombra). */
  shade(k) {
    if (this._envBase === undefined || Math.abs(k - this.shadeK) < 0.01) return;
    this.shadeK = k;
    this.scene.environmentIntensity = this._envBase * (1 - 0.8 * k);
    this.hemi.intensity = this._hemiBase * (1 - 0.8 * k);
  }

  update(dt, camPos, focus, t) {
    // ombre che seguono il punto di interesse
    const f = focus || camPos;
    const dir = this.lightDir || this.sunDir;
    const T = this.sun.target.position;
    const R = this.q.shadowRange || 70;
    const texel = (2 * R) / (this.q.shadows || 1024);
    T.set(Math.round(f.x / texel) * texel, f.y, Math.round(f.z / texel) * texel);
    this.sun.position.copy(T).addScaledVector(dir, 400);
    this.sun.target.updateMatrixWorld();
    this.stars.position.copy(camPos);
    // luci notturne vicine
    if (this.lampLights.length && this.lampPositions) {
      const on = this.night > 0.5;
      const ps = this.lampPositions;
      if (!this._lampT || t - this._lampT > 0.25) {
        this._lampT = t;
        const arr = [];
        for (let k = 0; k < ps.length; k++) {
          const d = (ps[k].x - camPos.x) ** 2 + (ps[k].z - camPos.z) ** 2;
          if (d < 260 * 260) arr.push([d, k]);
        }
        arr.sort((a, b) => a[0] - b[0]);
        this._lampSel = arr.slice(0, this.lampLights.length).map((a) => a[1]);
      }
      this.lampLights.forEach((L, i) => {
        const k = this._lampSel ? this._lampSel[i] : undefined;
        if (on && k !== undefined) {
          const p = ps[k];
          L.position.set(p.x, p.y, p.z);
          L.color.set(p.color || 0xffc98a);
          L.intensity = (p.i || 60) * (this.q.lampScale || 1);
          L.distance = p.r ? p.r * 2 : 36;
        } else L.intensity = 0;
        // una luce invisibile esce dagli shader: di giorno non costa niente
        L.visible = on;
      });
      if (this.glows) this.glows.material.opacity = on ? (this.wet ? 0.55 : 0.4) : 0;
    }
    // pioggia attorno alla camera
    if (this.rain && this.rain.visible) {
      const P = this.rain.geometry.attributes.position.array, S = this.rainSeeds;
      const N = S.length / 3;
      const fall = 26, cov = this.coverAt;
      for (let i = 0; i < N; i++) {
        let y = S[i * 3 + 1] - fall * dt;
        if (y < -2) y += 40;
        S[i * 3 + 1] = y;
        const x = camPos.x + S[i * 3], z = camPos.z + S[i * 3 + 2], yy = camPos.y - 8 + y;
        // sotto una copertura (galleria, passerella) la goccia non c'è: segmento di lunghezza zero
        if (cov && yy < cov(x, z)) {
          P[i * 6] = P[i * 6 + 3] = x; P[i * 6 + 1] = P[i * 6 + 4] = -1e4; P[i * 6 + 2] = P[i * 6 + 5] = z;
          continue;
        }
        P[i * 6] = x; P[i * 6 + 1] = yy; P[i * 6 + 2] = z;
        P[i * 6 + 3] = x + 0.05; P[i * 6 + 4] = yy + 0.7; P[i * 6 + 5] = z + 0.1;
      }
      this.rain.geometry.attributes.position.needsUpdate = true;
    }
  }
}

/** Fari delle auto: per il giocatore spot veri, per tutti i coni a terra finti */
export class Headlights {
  constructor(scene, quality, cars) {
    this.scene = scene;
    this.spots = [];
    this.beams = [];
    const beamGeo = new THREE.PlaneGeometry(9, 26);
    beamGeo.rotateX(-Math.PI / 2);
    beamGeo.rotateY(-Math.PI / 2);
    beamGeo.translate(13, 0, 0);
    const beamMat = new THREE.MeshBasicMaterial({ map: beamTexture(), color: 0xfff1d8, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.22, polygonOffset: true, polygonOffsetFactor: -6 });
    beamMat.map.rotation = 0;
    for (const c of cars) {
      const m = new THREE.Mesh(beamGeo, beamMat);
      m.visible = false;
      scene.add(m);
      this.beams.push(m);
    }
    this.beamMat = beamMat;
    // fari veri per il giocatore
    for (let k = 0; k < 2; k++) {
      // decadimento dolce: con 1.3 un'auto a 5 m riceveva 10 volte la luce della strada a 30 m (riflessi accecanti)
      const s = new THREE.SpotLight(0xfff2dc, 0, 120, 0.42, 0.45, 1.0);
      s.castShadow = k === 0 && quality.shadows >= 4096;
      s.visible = false;
      s.shadow.mapSize.set(1024, 1024);
      s.shadow.bias = -0.0005;
      scene.add(s);
      scene.add(s.target);
      this.spots.push(s);
    }
    // fanali posteriori: piccolo alone rosso
    const tailGeo = new THREE.PlaneGeometry(2.6, 2.6);
    tailGeo.rotateX(-Math.PI / 2);
    this.tailMat = new THREE.MeshBasicMaterial({ map: glowTexture(), color: 0xff2010, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.5 });
    this.tails = cars.map(() => {
      const m = new THREE.Mesh(tailGeo, this.tailMat);
      m.visible = false;
      scene.add(m);
      return m;
    });
  }
  update(cars, player, night) {
    const on = night > 0.5;
    cars.forEach((c, k) => {
      const b = this.beams[k];
      // il giocatore ha già i fari veri: il cono finto serve agli avversari
      b.visible = on && c !== player;
      const t = this.tails[k];
      t.visible = on;
      if (!on) return;
      const cy = Math.cos(c.yaw), sy = Math.sin(c.yaw);
      b.position.set(c.x + cy * 2.0, c.y + 0.06, c.z + sy * 2.0);
      b.rotation.y = -c.yaw;
      t.position.set(c.x - cy * 2.6, c.y + 0.05, c.z - sy * 2.6);
      t.scale.setScalar(c.brake > 0.1 ? 1.5 : 1.0);
    });
    this.spots.forEach((s, k) => {
      s.visible = on;
      if (!on || !player) { s.intensity = 0; return; }
      const cy = Math.cos(player.yaw), sy = Math.sin(player.yaw);
      const side = k === 0 ? -0.6 : 0.6;
      s.position.set(player.x + cy * 2.1 - sy * side, player.y + 0.65, player.z + sy * 2.1 + cy * side);
      s.target.position.set(player.x + cy * 30 - sy * side * 2, player.y - 1.5, player.z + sy * 30 + cy * side * 2);
      s.target.updateMatrixWorld();
      s.intensity = 95;
    });
  }
}

function mulberry(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
