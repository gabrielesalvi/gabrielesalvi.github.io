// Renderer + post-processing (GTAO, bloom, profondità di campo per le foto, filtri, SMAA) e preset di qualità.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

export const QUALITA = {
  basso: { nome: 'Basso', diretto: true, pixelRatio: 0.6, shadows: 0, shadowRange: 55, gtao: false, smaa: false, bloom: false, terrainRange: 220, cell: 4, trees: 0.25, crowd: 0.25, crowdDist: 350, vineDist: 150, lampLights: 0, rainDrops: 2500, far: 1800 },
  medio: { nome: 'Medio', pixelRatio: 1, shadows: 2048, shadowRange: 65, gtao: false, smaa: true, bloom: true, terrainRange: 300, cell: 3, trees: 0.65, crowd: 0.65, crowdDist: 500, vineDist: 200, lampLights: 4, rainDrops: 4500, far: 2600 },
  alto: { nome: 'Alto', pixelRatio: 1, shadows: 4096, shadowRange: 80, gtao: false, smaa: true, bloom: true, terrainRange: 380, cell: 3, trees: 1, crowd: 1, crowdDist: 700, vineDist: 260, lampLights: 6, rainDrops: 6000, far: 3600 },
  ultra: { nome: 'Ultra', pixelRatio: 2, shadows: 4096, shadowRange: 95, gtao: true, smaa: true, bloom: true, terrainRange: 420, cell: 3, trees: 1.3, crowd: 1.2, crowdDist: 950, vineDist: 400, lampLights: 8, rainDrops: 8000, far: 4500 },
};

const FILTRI = {
  nessuno: 0, 'bianco e nero': 1, seppia: 2, vivace: 3, pellicola: 4,
};
export const FILTRI_NOMI = Object.keys(FILTRI);

const FilterShader = {
  uniforms: { tDiffuse: { value: null }, uMode: { value: 0 }, uVignette: { value: 0.25 }, uTime: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform int uMode; uniform float uVignette; uniform float uTime; varying vec2 vUv;
    float rnd(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)) + uTime) * 43758.5453); }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.299,0.587,0.114));
      if (uMode == 1) c.rgb = vec3(pow(l, 1.05));
      else if (uMode == 2) c.rgb = vec3(l) * vec3(1.08, 0.92, 0.72);
      else if (uMode == 3) c.rgb = mix(vec3(l), c.rgb, 1.35);
      else if (uMode == 4) { c.rgb = mix(vec3(l), c.rgb, 0.8) * vec3(1.04,1.0,0.94); c.rgb += (rnd(vUv) - 0.5) * 0.06; }
      vec2 d = vUv - 0.5;
      c.rgb *= 1.0 - dot(d, d) * uVignette * 2.0;
      gl_FragColor = c;
    }`,
};

/** nome della scheda video che il browser sta usando davvero */
export function gpuName(gl) {
  try {
    const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
    return (ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) || '';
  } catch {
    return '';
  }
}

/** 'software' = il browser non usa la scheda video; 'integrata' = grafica del processore; '' = scheda dedicata o sconosciuta */
export function gpuKind(name) {
  if (/swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/i.test(name)) return 'software';
  if (/intel|uhd|iris|radeon\(tm\) graphics|radeon graphics|vega \d+ graphics|mali|adreno|powervr|apple m\d/i.test(name) && !/arc/i.test(name)) return 'integrata';
  return '';
}

export class Renderer {
  constructor(canvas, qualityKey = 'alto') {
    this.canvas = canvas;
    this.r = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, preserveDrawingBuffer: false });
    this.r.outputColorSpace = THREE.SRGBColorSpace;
    this.r.toneMapping = THREE.AgXToneMapping;
    this.r.toneMappingExposure = 0.9;
    this.r.shadowMap.enabled = true;
    this.r.shadowMap.type = THREE.PCFSoftShadowMap;
    // ombre calcolate una volta per fotogramma (render): il retrovisore le riusa invece di rifarle
    this.r.shadowMap.autoUpdate = false;
    this.r.info.autoReset = false; // contatori di tutto il fotogramma (tutti i passaggi), azzerati in render()
    this.gpu = gpuName(this.r.getContext());
    this.setQualityKey(qualityKey);
  }
  setQualityKey(k) {
    this.qKey = QUALITA[k] ? k : 'alto';
    this.q = QUALITA[this.qKey];
    const pr = Math.min(window.devicePixelRatio || 1, this.q.pixelRatio);
    this.r.setPixelRatio(this.qKey === 'ultra' ? Math.min(window.devicePixelRatio || 1, 2) : pr);
    this.basePR = this.r.getPixelRatio(); // risoluzione piena della qualità scelta (la dinamica non la supera)
  }
  /** cambia la risoluzione interna (risoluzione dinamica) */
  setPixelRatio(pr) {
    this.r.setPixelRatio(pr);
    if (this.composer) this.composer.setPixelRatio(pr);
    this.resize();
  }

  /** (ri)costruisce la catena di effetti per scena+camera */
  setup(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    const w = window.innerWidth, h = window.innerHeight;
    this.r.setSize(w, h);
    const C = (this.composer = new EffectComposer(this.r));
    C.setPixelRatio(this.r.getPixelRatio());
    C.setSize(w, h);
    C.addPass(new RenderPass(scene, camera));
    this.gtao = null;
    if (this.q.gtao) {
      this.gtao = new GTAOPass(scene, camera, w, h);
      this.gtao.output = GTAOPass.OUTPUT.Default;
      this.gtao.blendIntensity = 0.85;
      this.gtao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.4, thickness: 1.5, scale: 1.0, samples: 12 });
      this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
      C.addPass(this.gtao);
    }
    this.bokeh = new BokehPass(scene, camera, { focus: 12, aperture: 0.0025, maxblur: 0.012 });
    this.bokeh.enabled = false;
    C.addPass(this.bokeh);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.35, 0.55, 0.92);
    C.addPass(this.bloom);
    // setBloom() può essere stato chiamato prima di setup(): riapplica le impostazioni dell'ora corrente
    if (this._bloomArgs) this.setBloom(...this._bloomArgs);
    C.addPass(new OutputPass());
    this.filter = new ShaderPass(FilterShader);
    C.addPass(this.filter);
    this.smaa = null;
    if (this.q.smaa) {
      this.smaa = new SMAAPass(w * this.r.getPixelRatio(), h * this.r.getPixelRatio());
      C.addPass(this.smaa);
    }
    camera.far = this.q.far + 6000;
    camera.updateProjectionMatrix();
  }

  setBloom(night, wet) {
    this._bloomArgs = [night, wet];
    if (!this.bloom) return;
    // la soglia è sui valori di luce lineari (prima dell'esposizione): di giorno una superficie al sole vale 2-3,
    // quindi solo riflessi del sole, stop e fari devono superarla, non l'intera scena
    this.bloom.strength = night ? 0.4 : 0.22 + wet * 0.08;
    this.bloom.threshold = night ? 0.95 : 4.0;
    this.bloom.radius = night ? 0.5 : 0.4;
  }
  setFilter(name) {
    this.filter.uniforms.uMode.value = FILTRI[name] ?? 0;
  }
  setDOF(on, focus = 12, aperture = 0.0025) {
    this.bokeh.enabled = on;
    this.bokeh.uniforms.focus.value = focus;
    this.bokeh.uniforms.aperture.value = aperture;
  }
  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.r.setSize(w, h);
    if (this.composer) {
      this.composer.setSize(w, h);
      if (this.camera) { this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
    }
  }
  render(t) {
    this.r.info.reset();
    this.r.shadowMap.needsUpdate = true;
    // grafica bassa: niente catena di effetti (bagliore, filtri, antialias) se non serve la modalità foto
    if (this.q.diretto && !this.bokeh.enabled && !this.filter.uniforms.uMode.value) { this.r.render(this.scene, this.camera); return; }
    this.filter.uniforms.uTime.value = t || 0;
    this.composer.render();
  }
  /** salva il fotogramma corrente come PNG */
  screenshot(name = 'cubo-corse.png') {
    this.r.shadowMap.needsUpdate = true;
    this.composer.render();
    this.r.domElement.toBlob((b) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }, 'image/png');
  }
}
