// Cubo Corse — avvio, stati (menu/gara/pausa/foto/risultati), ciclo a passo fisso.
import * as THREE from 'three';
import { Track } from './sim/track.js';
import { PORTO, COLLINE, monzaDef } from './sim/tracks.js';
import { CARS } from './sim/car.js';
import { Race, LIVREE } from './sim/race.js';
import { buildRacingLine } from './sim/racingline.js';
import { racingLineMesh } from './gfx/linea.js';
import * as REC from './ui/record.js';
import { materialiLeggeri, usaMaterialiLeggeri } from './gfx/voxel.js';
import { Specchio } from './gfx/specchio.js';
import { Ghost, caricaGhost, salvaGhost } from './gfx/ghost.js';
import { Renderer, QUALITA, gpuName, gpuKind } from './gfx/renderer.js';
import { Environment, Headlights } from './gfx/env.js';
import { TrackWorld } from './gfx/trackmesh.js';
import { CarVisual } from './gfx/carmodel.js';
import { Effects } from './gfx/fx.js';
import { CameraRig, VISUALI_NOMI } from './gfx/cameras.js';
import { buildScenery } from './gfx/scenery.js';
import { AudioEngine } from './audio/audio.js';
import * as UI from './ui/ui.js';

const STEP = 1 / 120;
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

// ------------------------------------------------------------------ tastiera
const $id = (id) => document.getElementById(id);

class Input {
  constructor() {
    this.k = new Set();
    this.steer = 0; this.thr = 0; this.brk = 0;
    this.handlers = {};
    addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
      const c = e.code;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(c)) e.preventDefault();
      if (!e.repeat && this.handlers[c]) this.handlers[c](e);
      this.k.add(c);
    });
    addEventListener('keyup', (e) => this.k.delete(e.code));
    addEventListener('blur', () => this.k.clear());
  }
  on(code, fn) { this.handlers[code] = fn; }
  has(...c) { return c.some((x) => this.k.has(x)); }
  /** comandi filtrati per la fisica (tastiera digitale → analogico morbido) */
  sample(dt, speed) {
    let up = this.has('ArrowUp', 'KeyW');
    const dn = this.has('ArrowDown', 'KeyS');
    const L = this.has('ArrowLeft', 'KeyA'), R = this.has('ArrowRight', 'KeyD');
    // pedali assistiti: «gas» = accelera da solo se non freni; «freno» = frena da solo appena lasci il gas
    if (this.pedali === 'gas' && !dn) up = true;
    let brkT = dn ? 1 : 0;
    if (this.pedali === 'freno' && !up && !dn && speed > 2) brkT = 0.7; // dolce: non blocca di colpo, si ferma sotto i 7 km/h
    this.thr += ((up ? 1 : 0) - this.thr) * Math.min(1, dt * (up ? 7 : 12));
    this.brk += (brkT - this.brk) * Math.min(1, dt * (brkT > this.brk ? (dn ? 9 : 4) : 14));
    const target = (R ? 1 : 0) - (L ? 1 : 0);
    // rampa dello sterzo da tastiera: a fondo in ~0,2 s da fermo, ~0,4 s a 200 km/h (via di mezzo fra 3,4/45 lento e 7/70 nervoso)
    const rate = target === 0 ? 6.5 : (Math.sign(target) !== Math.sign(this.steer) && this.steer !== 0 ? 8 : 5 / (1 + speed / 60));
    const d = target - this.steer;
    this.steer += Math.sign(d) * Math.min(Math.abs(d), rate * dt);
    return { throttle: this.thr, brake: this.brk, steer: this.steer, handbrake: this.has('Space'), assist: true, sim: !!this.sim };
  }
}

// ------------------------------------------------------------------ applicazione
class App {
  async start() {
    this.settings = UI.loadSettings();
    this.canvas = document.getElementById('gl');
    const qk = this.settings.qual === 'auto' ? autoQuality() : this.settings.qual;
    this.renderer = new Renderer(this.canvas, qk);
    // grafica bassa: materiali semplici per auto e scenario (decisi prima di costruire il mondo)
    materialiLeggeri(!!this.renderer.q.diretto);
    this.specchio = new Specchio(!!this.renderer.q.diretto);
    this.camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.08, 9000);
    this.audio = new AudioEngine();
    this.input = new Input();
    this.hud = new UI.HUD();
    this.mode = 'loading';
    this.clock = 0;
    this.acc = 0;
    addEventListener('resize', () => this.renderer.resize());
    UI.setLoading(0.05, 'Carico i dati di Monza (OpenStreetMap)…');
    const json = await (await fetch('data/monza.json')).json();
    this.defs = { porto: PORTO, colline: COLLINE, monza: monzaDef(json) };
    this.tracks = {};
    const list = [];
    for (const id of ['porto', 'colline', 'monza']) {
      const t = this.trackFor(id);
      const outline = [];
      for (let i = 0; i < t.n; i += 6) outline.push([t.px[i], t.pz[i]]);
      list.push({ id, nome: t.nome, sottotitolo: t.def.sottotitolo, lunghezza: t.length, outline });
    }
    UI.buildMenu(this.settings, list, { change: (k) => this.onSetting(k), go: () => this.go() });
    this.nomiPiste = Object.fromEntries(list.map((t) => [t.id, t.nome]));
    this.recordMenu();
    this.bindKeys();
    this.bindPanels();
    await this.loadWorld(this.settings.track);
    UI.showScreen('loading', false);
    UI.showScreen('menu', true);
    this.mode = 'menu';
    const kind = gpuKind(this.renderer.gpu);
    if (kind === 'software') UI.toast('Il browser non sta usando la scheda video: attiva l\'accelerazione hardware nelle impostazioni del browser, poi riavvialo.', 12000);
    else if (kind === 'integrata') UI.toast('Il browser sta usando la grafica integrata (' + this.renderer.gpu.replace(/^ANGLE \(|\)$/g, '') + '). Su un PC con scheda video dedicata va assegnata al browser.', 12000);
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  trackFor(id) {
    if (!this.tracks[id]) this.tracks[id] = new Track(this.defs[id]);
    return this.tracks[id];
  }

  // ---------------------------------------------------------------- mondo
  async loadWorld(id) {
    UI.showScreen('loading', true);
    UI.setLoading(0.1, 'Traccio la pista…');
    await nextFrame();
    // pulizia
    if (this.scene) this.disposeScene();
    const q = this.renderer.q;
    const track = (this.track = this.trackFor(id));
    this.scene = new THREE.Scene();
    UI.setLoading(0.2, 'Calcolo la traiettoria ideale…');
    await nextFrame();
    this.rl = buildRacingLine(track, CARS[0]);
    this.lineaMesh = racingLineMesh(track, this.rl);
    this.lineaMesh.visible = !!this.settings.linea;
    this.scene.add(this.lineaMesh);
    UI.setLoading(0.3, 'Stendo asfalto, cordoli e vie di fuga…');
    await nextFrame();
    const tW = performance.now();
    this.world = new TrackWorld(track, this.rl, { terrainRange: q.terrainRange, cell: q.cell });
    this.scene.add(this.world.group);
    this.loadTimes = { pista: Math.round(performance.now() - tW) };
    UI.setLoading(0.55, 'Costruisco lo scenario…');
    await nextFrame();
    const tS = performance.now();
    this.scenery = await buildScenery(track, this.world, q, (p, m) => UI.setLoading(0.55 + p * 0.35, m));
    this.scene.add(this.scenery.group);
    this.loadTimes.scenario = Math.round(performance.now() - tS);
    this.loadTimes.scartati = this.world.clear.rejected;
    UI.setLoading(0.92, 'Accendo le luci…');
    await nextFrame();
    this.env = new Environment(this.renderer.r, this.scene, q);
    this.env.coverAt = this.scenery.coverAt;
    const b = track.bounds;
    this.center = new THREE.Vector3((b.minx + b.maxx) / 2, 0, (b.minz + b.maxz) / 2);
    this.env.setLamps(this.scenery.lamps);
    this.applyAtmosphere();
    this.fx = new Effects(this.scene, q);
    this.renderer.setup(this.scene, this.camera);
    this.rig = new CameraRig(this.camera, this.canvas);
    this.hud.setTrack(track);
    this.setupRace(false);
    // compila gli shader prima di mostrare
    this.renderer.r.compile(this.scene, this.camera);
    UI.setLoading(1, 'Pronti!');
    await nextFrame();
    UI.showScreen('loading', false);
  }

  disposeScene() {
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      const m = o.material;
      if (Array.isArray(m)) m.forEach((x) => x && x !== undefined && x.dispose && !x.userData.shared && x.dispose());
    });
    this.visuals = [];
  }

  applyAtmosphere() {
    this.env.set(this.settings.ora, this.settings.meteo, this.center);
    this.renderer.setBloom(this.env.night > 0.5, this.env.wet);
    this.world.wetU.value = this.env.wet;
    if (this.headlights) this.headlights.update([], null, 0);
  }

  // ---------------------------------------------------------------- gara
  setupRace(started) {
    const s = this.settings;
    if (this.visuals) for (const v of this.visuals) { this.scene.remove(v.group); v.dispose(); }
    if (this.headlights) {
      for (const m of [...this.headlights.beams, ...this.headlights.tails]) this.scene.remove(m);
      for (const sp of this.headlights.spots) { this.scene.remove(sp); this.scene.remove(sp.target); sp.dispose && sp.dispose(); }
    }
    this.race = new Race({
      track: this.track, laps: s.laps, difficulty: s.diff, grid: s.grid,
      playerCar: s.car, playerLivery: s.livery, wet: this.env.wet, seed: (Date.now() & 0xffff),
      penLimiti: !!s.penLimiti, penContatti: !!s.penContatti, timeTrial: s.modo === 'tempo', nAuto: s.nAuto, danniReali: s.danni === 'meccanici',
    });
    // time trial: fantasma del giro migliore per questa pista e modalità
    if (this.ghost) { this.ghost.dispose(); this.ghost = null; }
    if (this.race.timeTrial) {
      const g = caricaGhost(this.track.id, s.fisica);
      const specIdx = g && g.specIdx !== undefined ? g.specIdx : s.car;
      this.ghost = new Ghost(this.scene, CARS[specIdx] || CARS[0], LIVREE[g ? g.livery ?? s.livery : s.livery] || LIVREE[0], 1);
      this.ghost.set(g);
      this.ghost.on = !!s.ghost;
    }
    document.getElementById('bfinett').classList.toggle('hidden', !this.race.timeTrial);
    this.input.sim = s.fisica === 'realistica';
    this.input.pedali = s.pedali || 'manuali';
    // via eventuali effetti di una distruzione precedente
    this.distruzione = null;
    this.renderer.setFilter('nessuno');
    this.renderer.filter.uniforms.uVignette.value = 0.25;
    document.getElementById('distrutta').classList.add('hidden');
    document.getElementById('distrutta').classList.remove('testo');
    this.player = this.race.player;
    this.visuals = this.race.cars.map((c) => {
      const v = new CarVisual(c.spec, LIVREE[c.livery] || LIVREE[0], c.num);
      this.scene.add(v.group);
      v.update(c, 0, 0);
      return v;
    });
    this.pVis = this.visuals[this.race.cars.indexOf(this.player)];
    this.headlights = new Headlights(this.scene, this.renderer.q, this.race.cars);
    this.player.onShift = (d) => this.audio.shift(d);
    this.finishT = -1;
    if (this.fx) this.fx.fireworksOn = false;
    this.cheer = 0;
    this.lastEvent = '';
    this.rig.setMode(this.rig.mode, this.pVis);
    if (started) this.renderer.r.compile(this.scene, this.camera);
  }

  async go() {
    UI.saveSettings(this.settings);
    if (!this.audio.ready) {
      try { await this.audio.init(); } catch (e) { console.warn('audio', e); }
    }
    this.audio.ui();
    const wantQ = this.settings.qual === 'auto' ? this.renderer.qKey : this.settings.qual;
    if (this.track.id !== this.settings.track || this.renderer.qKey !== wantQ || this.worldDirty) {
      // passare da Bassa alle altre (o viceversa) cambia i materiali condivisi: si ricarica la pagina con le impostazioni salvate
      if (!!QUALITA[wantQ]?.diretto !== usaMaterialiLeggeri()) { UI.saveSettings(this.settings); location.reload(); return; }
      this.renderer.setQualityKey(wantQ);
      this.worldDirty = false;
      await this.loadWorld(this.settings.track);
    }
    this.setupRace(true);
    UI.showScreen('menu', false);
    UI.showScreen('hud', true);
    this.mode = 'race';
    this.paused = false;
    this.dyn = null; // misura della risoluzione dinamica da capo a ogni gara
    this.raceClock = 0;
    this.hud.camLabel(VISUALI_NOMI[this.rig.mode]);
  }

  onSetting(k) {
    this.audio.ui && this.audio.ready && this.audio.ui();
    UI.saveSettings(this.settings);
    if (k === 'track') this.loadWorld(this.settings.track);
    else if (k === 'ora' || k === 'meteo') { this.applyAtmosphere(); this.setupRace(false); }
    else if (k === 'car' || k === 'livery') this.setupRace(false);
    else if (k === 'linea' && this.lineaMesh) this.lineaMesh.visible = !!this.settings.linea;
    if (k === 'track' || k === 'fisica') this.recordMenu();
    else if (k === 'qual') this.worldDirty = true;
  }

  bindKeys() {
    const I = this.input;
    I.on('KeyC', () => {
      if (this.mode !== 'race' || this.paused) return;
      const m = this.rig.next(this.pVis);
      this.hud.camLabel(VISUALI_NOMI[m]);
    });
    I.on('KeyR', () => {
      if (this.mode === 'race' && !this.paused && this.race.started && !this.player.distrutta) this.race.resetCar(this.player, this.rl);
    });
    I.on('KeyP', () => {
      if (this.mode === 'race' || this.mode === 'results') this.togglePhoto();
    });
    I.on('Escape', () => {
      if (this.photo) return this.togglePhoto();
      if (this.mode === 'race') this.setPause(!this.paused);
    });
    I.on('KeyM', () => {
      const m = this.audio.toggleMute();
      document.getElementById('bmute').textContent = 'Audio: ' + (m ? 'spento' : 'acceso');
      UI.toast(m ? 'Audio spento' : 'Audio acceso', 1000);
    });
    I.on('KeyH', () => document.getElementById('hud').classList.toggle('hidden'));
    I.on('KeyG', () => {
      this.settings.ghost = !this.settings.ghost;
      if (this.ghost) this.ghost.on = this.settings.ghost;
      UI.saveSettings(this.settings);
      UI.toast(this.settings.ghost ? 'Ghost visibile' : 'Ghost nascosto', 1000);
    });
    I.on('KeyL', () => {
      this.settings.linea = !this.settings.linea;
      if (this.lineaMesh) this.lineaMesh.visible = this.settings.linea;
      UI.saveSettings(this.settings);
      UI.toast(this.settings.linea ? 'Traiettoria ideale visibile' : 'Traiettoria ideale nascosta', 1000);
    });
    I.on('KeyF', () => {
      this.perfOn = !this.perfOn;
      document.getElementById('perf').classList.toggle('hidden', !this.perfOn);
      this.perf = { n: 0, t0: performance.now(), max: 0, cpu: 0 };
    });
  }

  bindPanels() {
    document.querySelectorAll('[data-act]').forEach((b) => {
      b.onclick = () => {
        this.audio.ready && this.audio.ui();
        const a = b.dataset.act;
        if (a === 'resume') this.setPause(false);
        if (a === 'restart') { UI.showScreen('results', false); this.setPause(false); this.go(); }
        if (a === 'menu') this.toMenu();
        if (a === 'storico') { document.getElementById('stab').innerHTML = REC.htmlStorico(REC.storico(), this.nomiPiste || {}); UI.showScreen('storico', true); }
        if (a === 'chiudiStorico') UI.showScreen('storico', false);
        if (a === 'fineTT') this.fineTimeTrial();
        if (a === 'photo') { this.setPause(false); this.togglePhoto(); }
        if (a === 'mute') {
          const m = this.audio.toggleMute();
          b.textContent = 'Audio: ' + (m ? 'spento' : 'acceso');
        }
      };
    });
    const $ = (id) => document.getElementById(id);
    const upd = () => {
      if (!this.photo) return;
      this.camera.fov = +$('pfov').value;
      this.camera.updateProjectionMatrix();
      const ap = +$('paper').value / 100;
      this.renderer.setDOF(ap > 0.01, +$('pfocus').value, ap * ap * 0.012);
      this.renderer.r.toneMappingExposure = this.env.O.exposure * (+$('pexp').value / 100);
      this.renderer.setFilter($('pfilter').value);
      const hide = $('phud').checked;
      this.visuals.forEach((v) => { if (v !== this.pVis) v.group.visible = !hide; });
    };
    ['pfov', 'pfocus', 'paper', 'pexp', 'pfilter', 'phud'].forEach((id) => ($(id).oninput = upd));
    this.photoUpd = upd;
    $('psave').onclick = () => {
      const t = new Date();
      this.renderer.screenshot(`cubo-corse-${this.track.id}-${t.getHours()}${String(t.getMinutes()).padStart(2, '0')}${String(t.getSeconds()).padStart(2, '0')}.png`);
      UI.toast('Foto salvata');
    };
    $('pexit').onclick = () => this.togglePhoto();
  }

  setPause(on) {
    this.paused = on;
    UI.showScreen('pause', on);
  }

  togglePhoto() {
    this.photo = !this.photo;
    const $ = (id) => document.getElementById(id);
    if (this.photo) {
      this.wasHud = !$('hud').classList.contains('hidden');
      UI.showScreen('hud', false);
      UI.showScreen('photo', true);
      UI.showScreen('results', false);
      const c = this.player;
      this.rig.startOrbit(new THREE.Vector3(c.x, c.y + 0.7, c.z));
      $('pfov').value = Math.round(this.camera.fov);
      $('pfocus').value = Math.round(this.camera.position.distanceTo(new THREE.Vector3(c.x, c.y, c.z)));
      this.pVis.setCockpit(false);
      this.photoUpd();
    } else {
      UI.showScreen('photo', false);
      this.rig.stopOrbit();
      this.renderer.setDOF(false);
      this.renderer.setFilter('nessuno');
      this.renderer.r.toneMappingExposure = this.env.O.exposure;
      this.visuals.forEach((v) => (v.group.visible = true));
      this.rig.setMode(this.rig.mode, this.pVis);
      if (this.mode === 'results') UI.showScreen('results', true);
      else if (this.wasHud) UI.showScreen('hud', true);
    }
  }

  toMenu() {
    this.setPause(false);
    this.photo && this.togglePhoto();
    UI.showScreen('results', false);
    UI.showScreen('hud', false);
    UI.showScreen('menu', true);
    this.mode = 'menu';
    this.setupRace(false);
  }

  // ---------------------------------------------------------------- ciclo
  frame(now) {
    requestAnimationFrame((t) => this.frame(t));
    const tCpu = performance.now();
    this._frame(now);
    if (this.perfOn) this.perfTick(now, performance.now() - tCpu);
  }

  /** tabella dei record (primi 5) per la pista e la modalità scelte nel menu */
  recordMenu() {
    const el = document.getElementById('mrecord');
    if (!el) return;
    const s = this.settings;
    el.innerHTML = `<div class="rec-sub">${(this.nomiPiste || {})[s.track] || s.track} · fisica ${REC.MODI[s.fisica] || 'Arcade'} · giro migliore</div>` +
      REC.htmlBoard(REC.board(s.track, s.fisica), -1, 5);
  }

  /**
   * all'arrivo: storico subito; il record (se il giro migliore pulito entra nei primi 10) chiede le iniziali
   * nella schermata dei risultati. Ritorna la funzione da chiamare quando i risultati sono visibili.
   */
  salvaRecord(race, pos) {
    const p = race.player, s = this.settings, pista = this.track.id, fisica = s.fisica || 'arcade';
    const best = p.bestValido ?? Infinity;
    REC.aggiungiStorico({
      data: new Date().toISOString(), pista, fisica, giri: race.laps, diff: s.diff,
      pos: race.results().findIndex((r) => r.car === p) + 1 || pos,
      tempo: p.finishTime + (p.pen || 0), pen: p.pen || 0, best: p.best, bestValido: Number.isFinite(best),
      auto: p.spec.nome, meteo: s.meteo, ora: s.ora,
    });
    const k = REC.posizione(pista, fisica, best);
    const intest = `<h4>Record · ${this.nomiPiste?.[pista] || pista} · ${REC.MODI[fisica]}</h4>`;
    return async () => {
      const el = document.getElementById('rrecord');
      if (!el) return;
      if (k < 0) {
        const nota = Number.isFinite(best) ? `Il tuo giro migliore pulito: ${UI.fmt(best)}` : 'Nessun giro pulito in questa gara (uscite o rimesse in pista): non vale per i record.';
        el.innerHTML = intest + `<p class="rec-vuoto">${nota}</p>` + REC.htmlBoard(REC.board(pista, fisica), -1, 5);
        return;
      }
      this.audio.ready && this.audio.lap && this.audio.lap(true);
      const nome = await REC.chiediIniziali(el, `NUOVO RECORD! ${k + 1}° POSTO · ${UI.fmt(best)}`, REC.ultimoNome());
      const idx = REC.aggiungiRecord(pista, fisica, { nome, tempo: best, auto: p.spec.nome, meteo: s.meteo, ora: s.ora, data: new Date().toISOString() });
      el.innerHTML = intest + REC.htmlBoard(REC.board(pista, fisica), idx);
      this.recordMenu();
    };
  }

  /** auto del giocatore distrutta: rallenty in bianco e nero, tunnel nero che si chiude, dopo ~2 s DISTRUTTA; dopo 5,2 s i risultati */
  iniziaDistruzione() {
    this.distruzione = { t0: this.clock, fatto: false };
    this.renderer.setFilter('bianco e nero');
    this.renderer.filter.uniforms.uVignette.value = 0.7;
    // dall'abitacolo si vede poco: inquadratura esterna
    if (this.rig.mode === 'abitacolo' || this.rig.mode === 'cofano') this.rig.setMode('lontana', this.pVis);
    const ov = document.getElementById('distrutta');
    ov.classList.remove('testo');
    ov.classList.remove('hidden');
    this.rig.shake = 0.35;
  }

  fineDistruzione() {
    this.distruzione.fatto = true;
    document.getElementById('distrutta').classList.add('hidden');
    document.getElementById('distrutta').classList.remove('testo');
    const race = this.race;
    if (race.timeTrial) { this.fineTimeTrial(); return; }
    this.mode = 'results';
    UI.showResults(race);
    UI.showScreen('hud', false);
    document.getElementById('rrecord').innerHTML = '';
    if (!this.photo) UI.showScreen('results', true);
    REC.aggiungiStorico({ data: new Date().toISOString(), pista: this.track.id, fisica: this.settings.fisica || 'arcade', giri: race.laps, diff: this.settings.diff, pos: 'RIT', tempo: Infinity, pen: this.player.pen || 0, best: this.player.best, bestValido: Number.isFinite(this.player.bestValido ?? Infinity), auto: this.player.spec.nome, meteo: this.settings.meteo, ora: this.settings.ora });
  }

  /** fine della sessione di time trial: elenco dei giri, record (iniziali) e storico */
  fineTimeTrial() {
    const race = this.race, p = this.player, s = this.settings;
    if (!race || !race.timeTrial) return;
    this.setPause(false);
    this.mode = 'results';
    p.finished = true;
    UI.showScreen('hud', false);
    const pista = this.track.id, fisica = s.fisica || 'arcade';
    const best = p.bestValido ?? Infinity;
    $id('rtitle').textContent = `Time trial · ${this.nomiPiste?.[pista] || pista}`;
    const giri = p.lapTimes;
    const validi = race._validi || [];
    $id('rtable').innerHTML = `<tr><th>Giro</th><th>Tempo</th><th></th></tr>` + (giri.length ? giri.map((t, i) => `<tr class="${t === best ? 'me' : ''}"><td class="p">${i + 1}</td><td>${UI.fmt(t)}</td><td>${validi[i] === false ? '<span class="pen">non valido</span>' : t === best ? 'migliore' : ''}</td></tr>`).join('') : '<tr><td colspan="3">Nessun giro completato.</td></tr>');
    if (giri.length) REC.aggiungiStorico({ data: new Date().toISOString(), tipo: 'tempo', pista, fisica, giri: giri.length, diff: '—', pos: '—', tempo: best, pen: 0, best: p.best, bestValido: Number.isFinite(best), auto: p.spec.nome, meteo: s.meteo, ora: s.ora });
    UI.showScreen('results', true);
    const k = REC.posizione(pista, fisica, best);
    const el = $id('rrecord');
    const intest = `<h4>Record · ${this.nomiPiste?.[pista] || pista} · ${REC.MODI[fisica]}</h4>`;
    if (k < 0) { el.innerHTML = intest + REC.htmlBoard(REC.board(pista, fisica), -1, 5); return; }
    REC.chiediIniziali(el, `NUOVO RECORD! ${k + 1}° POSTO · ${UI.fmt(best)}`, REC.ultimoNome()).then((nome) => {
      const idx = REC.aggiungiRecord(pista, fisica, { nome, tempo: best, auto: p.spec.nome, meteo: s.meteo, ora: s.ora, data: new Date().toISOString() });
      el.innerHTML = intest + REC.htmlBoard(REC.board(pista, fisica), idx);
      this.recordMenu();
    });
  }

  /** memorizza la posa di ogni auto prima di un passo di fisica */
  snapPrev() {
    for (const c of this.race.cars) {
      const p = c._prev || (c._prev = {});
      p.x = c.x; p.y = c.y; p.z = c.z; p.yaw = c.yaw; p.pitch = c.pitch; p.roll = c.roll; p.bankRoll = c.bankRoll || 0; p.wheelSpin = c.wheelSpin;
    }
  }

  /** pose interpolate (a = 0 passo precedente, 1 ultimo passo); il resto dei campi si legge dall'auto (prototipo) */
  renderStates(a) {
    const cars = this.race.cars;
    if (!this._rs || this._rsRace !== this.race) { this._rs = cars.map((c) => Object.create(c)); this._rsRace = this.race; }
    const L = (u, v) => u + (v - u) * a;
    cars.forEach((c, k) => {
      const r = this._rs[k], p = c._prev;
      // niente interpolazione senza un passo precedente o dopo un salto (rimessa in pista, griglia)
      if (!p || (p.x - c.x) ** 2 + (p.z - c.z) ** 2 > 25) {
        for (const f of ['x', 'y', 'z', 'yaw', 'pitch', 'roll', 'bankRoll', 'wheelSpin']) delete r[f];
        return;
      }
      r.x = L(p.x, c.x); r.y = L(p.y, c.y); r.z = L(p.z, c.z);
      let dy = c.yaw - p.yaw;
      while (dy > Math.PI) dy -= 2 * Math.PI;
      while (dy < -Math.PI) dy += 2 * Math.PI;
      r.yaw = p.yaw + dy * a;
      r.pitch = L(p.pitch, c.pitch); r.roll = L(p.roll, c.roll); r.bankRoll = L(p.bankRoll, c.bankRoll || 0); r.wheelSpin = L(p.wheelSpin, c.wheelSpin);
    });
    return this._rs;
  }

  /** pannello prestazioni (tasto F): fps, tempo CPU, cosa arriva alla scheda video */
  perfTick(now, cpu) {
    const P = this.perf;
    P.n++; P.cpu += cpu;
    const dt = now - (P.last || now);
    P.last = now;
    P.max = Math.max(P.max, dt);
    const el = now - P.t0;
    if (el < 500) return;
    const R = this.renderer, info = R.r.info, c = R.r.domElement;
    const kind = gpuKind(R.gpu);
    document.getElementById('perf').textContent =
      `${(P.n * 1000 / el).toFixed(0)} fps   fotogramma peggiore ${P.max.toFixed(0)} ms   CPU (JS) ${(P.cpu / P.n).toFixed(1)} ms\n` +
      `GPU: ${(R.gpu || 'sconosciuta').replace(/^ANGLE \(/, '').replace(/\)$/, '').slice(0, 64)}${kind === 'software' ? '   ⚠ SENZA SCHEDA VIDEO' : kind === 'integrata' ? '   ⚠ grafica integrata' : ''}\n` +
      `qualità ${R.q.nome}   ${c.width}×${c.height} px (scala ${R.r.getPixelRatio().toFixed(2)})   ` +
      `${info.render.calls} chiamate   ${(info.render.triangles / 1e6).toFixed(2)} M triangoli`;
    P.n = 0; P.cpu = 0; P.max = 0; P.t0 = now;
  }

  _frame(now) {
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (dt > 0.1) dt = 0.1;
    this.clock += dt;
    const t = this.clock;
    // l'audio è in pausa esattamente quando il gioco non sta correndo: deciso qui a ogni fotogramma,
    // così nessun passaggio (menu → nuova gara, foto, pausa) può lasciarlo muto per errore
    if (this.audio.ready) {
      const mute = this.mode === 'loading' || this.mode === 'menu' || this.paused || this.photo;
      if (mute !== this.audio.paused) this.audio.pause(mute);
    }
    if (this.mode === 'loading') return;
    const race = this.race;
    const simulate = (this.mode === 'race' || this.mode === 'results') && !this.paused && !this.photo;
    if (simulate) {
      // rallenty dopo una distruzione: da 1 a 0,2 in un quinto di secondo
      const scala = this.distruzione ? Math.max(0.2, 1 - (this.clock - this.distruzione.t0) * 4) : 1;
      this.acc += dt * scala;
      let n = 0;
      while (this.acc >= STEP && n < 12) {
        const inp = this.mode === 'race' && !this.player.finished ? this.input.sample(STEP, this.player.speed) : { throttle: 0, brake: 0.3, steer: 0 };
        this.snapPrev();
        race.step(STEP, inp);
        this.acc -= STEP;
        n++;
      }
      if (n === 12) this.acc = 0;
      this.raceClock += dt;
      this.handleEvents();
    }
    // stato da disegnare: interpolato fra gli ultimi due passi di fisica (la fisica va a 120 Hz, lo schermo
    // al ritmo del monitor: senza interpolazione l'auto avanza a scatti di uno o due passi per fotogramma)
    const rs = this.renderStates(simulate ? Math.min(1, this.acc / STEP) : 1);
    const rp = rs[this.race.cars.indexOf(this.player)];
    rs.forEach((c, k) => { this.visuals[k].group.visible = !c.rimossa; this.visuals[k].update(c, dt, t); });
    if (this.ghost && race.timeTrial) {
      const P = this.player, a = simulate ? Math.min(1, this.acc / STEP) : 1;
      const tGiro = P.lap > 0 ? race.time - (1 - a) * STEP - P.lapStart : -1;
      this.ghost.update(tGiro, dt, t);
      const sGiro = P.dist - (P.lap - 1) * this.track.length;
      race.deltaGhost = P.lap > 0 && this.ghost.dati ? this.ghost.delta(race.time - P.lapStart, sGiro) : null;
    }
    this.headlights.update(rs, rp, this.env.night);
    // camera
    const groundAt = (x, z) => this.world.heightAt(x, z);
    if (this.photo) this.rig.updateOrbit(groundAt);
    else if (this.mode === 'menu') {
      const c = this.player, a = t * 0.12;
      this.camera.position.set(c.x + Math.cos(a) * 8.5, c.y + 2.2 + Math.sin(t * 0.2) * 0.4, c.z + Math.sin(a) * 8.5);
      this.camera.lookAt(c.x, c.y + 0.6, c.z);
      this.camera.fov = 45;
      this.camera.updateProjectionMatrix();
    } else if (this.mode === 'results' && this.finishT >= 0 && t - this.finishT > 1.5) {
      // inquadratura TV dal bordo pista
      if (!this.tvAnchor || this.player.proj.s - this.tvS > 120 || this.player.proj.s < this.tvS) {
        this.tvS = this.player.proj.s;
        const p = this.track.pointAt(this.tvS + 70, (this.track.w[this.player.proj.i] / 2 + 6) * (Math.random() < 0.5 ? -1 : 1));
        this.tvAnchor = new THREE.Vector3(p.x, p.y + 3.5, p.z);
      }
      this.rig.tv(dt, rp, this.tvAnchor);
    } else {
      // tasto B tenuto: sguardo indietro
      this.rig.indietro = this.mode === 'race' && !this.paused && this.input.has('KeyB');
      this.rig.update(dt, rp, this.pVis, groundAt);
    }
    // ambiente
    const cp = this.camera.position;
    this.env.update(dt, cp, this.player, t);
    const inT = this.scenery.inTunnel ? this.scenery.inTunnel(cp.x, cp.y, cp.z) : 0;
    this.tunnelK = (this.tunnelK || 0) + (inT - (this.tunnelK || 0)) * Math.min(1, dt * 2.5);
    this.env.shade(this.tunnelK);
    this.world.update(dt, t);
    this.scenery.update && this.scenery.update(dt, t, this.player, this.cheer, race);
    this.fx.night = this.env.night > 0.5;
    this.fx.update(simulate ? dt * (this.distruzione ? 0.2 : 1) : 0, (x, z) => this.surfaceY(x, z));
    // la scritta arriva dopo 2 s di rallenty (orologio del gioco, non del browser), i risultati dopo 5,2 s
    if (this.distruzione && !this.distruzione.testo && this.clock - this.distruzione.t0 > 2) { this.distruzione.testo = true; document.getElementById('distrutta').classList.add('testo'); }
        if (this.distruzione && !this.distruzione.fatto && this.clock - this.distruzione.t0 > 5.2) this.fineDistruzione();
    if (this.cheer > 0) this.cheer = Math.max(0, this.cheer - dt * 0.08);
    // audio
    if (this.audio.ready) this.updateAudio(dt);
    // HUD
    if (this.mode === 'race') this.hud.update(dt, race, this.player, this.track);
    this.renderer.render(t);
    // retrovisore nelle visuali cofano e abitacolo (non guardando indietro, non in foto né durante la distruzione)
    const specchio = (this.mode === 'race' || this.mode === 'results') && !this.photo && !this.distruzione && !this.rig.indietro
      && (this.rig.mode === 'cofano' || this.rig.mode === 'abitacolo') && !!this.pVis;
    this.specchio.mostra(specchio);
    if (specchio) this.specchio.render(this.renderer.r, this.scene, this.pVis);
    if (this.mode === 'race' && simulate) this.autoQuality(dt);
  }

  surfaceY(x, z) {
    const f = this.world.info(x, z);
    if (f.i >= 0) {
      const E = f.side > 0 ? this.track.R : this.track.L;
      if (f.dist <= E.barD[f.i]) return this.track.py[f.i] + 0.02;
    }
    return this.world.heightAt(x, z);
  }

  handleEvents() {
    const race = this.race;
    for (const e of race.events) {
      if (e.t === 'luce') { this.hud.lights(e.n); this.audio.ready && this.audio.beep(e.n); this.scenery.gantry && this.scenery.gantry.setLuci(e.n); }
      else if (e.t === 'via') {
        this.hud.lights(-1);
        this.audio.ready && this.audio.go();
        this.scenery.gantry && this.scenery.gantry.setLuci(-1);
        setTimeout(() => { this.hud.lights(0); this.scenery.gantry && this.scenery.gantry.setLuci(0); }, 1500);
        this.hud.message('VIA!', 1200);
      } else if (e.t === 'giro' && e.car === this.player && race.timeTrial) {
        this.audio.ready && this.audio.lap(e.best);
        const g = this.ghost && this.ghost.g;
        if (e.valido && e.campioni && e.campioni.length > 20 && (!g || e.tempo < g.tempo)) {
          const nuovo = salvaGhost(this.track.id, this.settings.fisica, e.tempo, e.campioni, { specIdx: this.player.specIdx, livery: this.player.livery, auto: this.player.spec.nome });
          if (nuovo && this.ghost) this.ghost.set(nuovo);
          this.hud.message(`${UI.fmt(e.tempo)} · GIRO MIGLIORE${nuovo ? ' · GHOST AGGIORNATO' : ''}`, 2600);
        } else this.hud.message(`${UI.fmt(e.tempo)}${e.valido ? '' : ' · NON VALIDO'}${g ? ` · ${e.tempo - g.tempo >= 0 ? '+' : '−'}${Math.abs(e.tempo - g.tempo).toFixed(3)}` : ''}`, 2200);
      } else if (e.t === 'giro' && e.car === this.player) {
        const last = race.laps - this.player.lap + 1;
        this.audio.ready && this.audio.lap(e.best);
        if (this.player.lap === race.laps) this.hud.message('ULTIMO GIRO', 2200);
        else if (e.best && this.player.lapTimes.length > 1) this.hud.message('GIRO MIGLIORE ' + UI.fmt(e.tempo), 2200);
        else this.hud.message(UI.fmt(e.tempo), 1800);
        void last;
      } else if (e.t === 'arrivo' && e.car === this.player) {
        const pos = race.standings().indexOf(this.player) + 1;
        this.finishT = this.clock;
        this.mode = 'results';
        this.cheer = 1;
        this.hud.message(pos === 1 ? 'VITTORIA!' : `ARRIVATO ${pos}°`, 3000);
        this.audio.ready && this.audio.finish(pos);
        this.fireworks = 9;
        const recordPromessa = this.salvaRecord(race, pos);
        setTimeout(() => {
          if (this.mode !== 'results') return;
          UI.showResults(race);
          UI.showScreen('hud', false);
          if (!this.photo) UI.showScreen('results', true);
          recordPromessa();
        }, 3500);
      } else if (e.t === 'distrutta') {
        if (e.car === this.player) this.iniziaDistruzione();
        else this.hud.message(`${e.car.nome.toUpperCase()} · AUTO DISTRUTTA`, 2200);
      } else if (e.t === 'danno' && e.car === this.player) {
        const box = document.getElementById('hdanni');
        box.classList.remove('lampo'); void box.offsetWidth; box.classList.add('lampo');
        if (e.a > 0.3 && !this.player.distrutta) this.hud.message(`DANNI · ${e.zona.toUpperCase()}`, 1600);
      } else if (e.t === 'reset' && e.car === this.player) this.hud.message('IN PISTA', 900);
      else if (e.t === 'giroNonValido' && e.car === this.player && race.timeTrial) this.hud.message('GIRO NON VALIDO', 1600);
      else if (e.t === 'avviso' && e.car === this.player) this.hud.message(`LIMITI DELLA PISTA · AVVISO ${e.n}/${e.max || 5}`, 2000);
      else if (e.t === 'penalita') {
        const motivo = { taglio: 'TAGLIO', limiti: 'LIMITI DELLA PISTA', contatto: 'CONTATTO' }[e.motivo] || '';
        if (e.car === this.player) { this.hud.message(`+${e.sec} s · ${motivo}`, 2600); this.audio.ready && this.audio.beep && this.audio.beep(1); }
        else if (e.motivo === 'contatto') this.hud.message(`+${e.sec} s a ${e.car.nome} · CONTATTO`, 2000);
      }
    }
    race.events.length = 0;
    // urti → danni, effetti, suoni
    for (const im of race.impacts) {
      const cars = im.type === 'auto' ? [im.a, im.b] : [im.car || this.nearestCar(im.x, im.z)];
      // visuale interna: fumo, scintille e detriti dell'auto del giocatore nascono a un metro dagli occhi e coprono tutto
      const interna = this.rig.mode === 'abitacolo' || this.rig.mode === 'cofano';
      const mia = cars.includes(this.player);
      this.fx.impact(im.x, im.y, im.z, interna && mia ? im.speed * 0.3 : im.speed, im.nx, im.nz);
      let involvesPlayer = false;
      for (const c of cars) {
        if (!c) continue;
        if (c === this.player) involvesPlayer = true;
        const vis = this.visuals[race.cars.indexOf(c)];
        const n = Math.min(40, Math.floor((im.speed - 2) * 1.6));
        if (n > 0 && vis) {
          const dx = im.x - c.x, dz = im.z - c.z;
          const cy = Math.cos(c.yaw), sy = Math.sin(c.yaw);
          const lost = vis.damage(dx * cy + dz * sy, 0.5, -dx * sy + dz * cy, n);
          if (!(interna && c === this.player)) this.fx.debrisFrom(lost, c);
          c.damage = Math.min(1, c.damage + lost.length * 0.0012);
        }
      }
      if (this.audio.ready) this.audio.impact(im.speed, im.x, im.y, im.z, involvesPlayer);
      if (involvesPlayer) this.rig.shake = Math.min(interna ? 0.12 : 0.4, im.speed * (interna ? 0.006 : 0.02));
    }
    race.impacts.length = 0;
    // strisciate
    for (const c of race.cars) {
      if (c.scraping > 0) {
        const p = c.proj, side = p.d >= 0 ? 1 : -1;
        this.fx.scrape(c.x + this.track.nx[p.i] * side * 1.0, c.y, c.z + this.track.nz[p.i] * side * 1.0, c.vx, c.vz);
      }
      this.fx.carFx(STEP * 2, c, this.env.wet, this.env.night);
    }
    if (this.audio.ready) this.audio.scrape(this.player.scraping > 0);
    // fuochi d'artificio all'arrivo
    if (this.fireworks > 0 && Math.random() < 0.05) {
      this.fireworks--;
      const p = this.track.pointAt(this.track.startS + (Math.random() - 0.5) * 120, (Math.random() < 0.5 ? -1 : 1) * (30 + Math.random() * 30));
      const y = p.y + 45 + Math.random() * 30;
      this.fx.firework(p.x, y, p.z);
      this.audio.ready && this.audio.firework(p.x, y, p.z);
    }
  }

  nearestCar(x, z) {
    let best = null, bd = Infinity;
    for (const c of this.race.cars) {
      const d = (c.x - x) ** 2 + (c.z - z) ** 2;
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  updateAudio(dt) {
    const p = this.player;
    const cam = this.camera;
    const fwd = new THREE.Vector3();
    cam.getWorldDirection(fwd);
    this.audio.setListener(cam.position.x, cam.position.y, cam.position.z, Math.atan2(fwd.z, fwd.x));
    const surf = p.surfaces.includes(3) ? 'ghiaia' : p.surfaces.includes(2) ? 'erba' : null;
    const others = [];
    for (const c of this.race.cars) if (c !== p) others.push({ x: c.x, y: c.y, z: c.z, rpm: c.rpm, throttle: c.throttle, speed: c.speed, cyl: c.spec.cyl, voce: c.spec.voce, skid: c.skid });
    const crowd = this.scenery.crowdNear ? this.scenery.crowdNear(cam.position.x, cam.position.z) : 0;
    this.audio.update(dt, {
      player: { rpm: p.distrutta ? 500 : p.rpm, throttle: p.distrutta ? 0 : this.race.started ? p.throttle : (p.rpmRev || 0), gear: p.gear, speed: p.speed, skid: p.skid, onKerb: p.onKerb, offroad: p.offroad, surface: surf, air: p.air, cyl: p.spec.cyl, voce: p.spec.voce, x: p.x, y: p.y, z: p.z },
      cars: others,
      crowd,
      cheer: Math.max(this.cheer, crowd > 0.3 ? Math.max(0, 1 - this.scenery.crowdDist / 80) * 0.6 : 0),
      rain: this.env.M.rain || 0,
      tunnel: this.scenery.inTunnel ? this.scenery.inTunnel(cam.position.x, cam.position.y, cam.position.z) : 0,
      wind: p.speed * (1 - 0.7 * (p.draft || 0)), // in scia il vento si sente meno
      cockpit: this.rig.mode === 'abitacolo',
    });
  }

  /**
   * Risoluzione dinamica (qualità Auto e Bassa): ogni 2 s misura gli fps; sotto 40 abbassa la risoluzione del 15%
   * (minimo 0,45), sopra 58 la rialza del 10% fino a quella della qualità scelta. I primi 3 s di gara non contano
   * (compilazione degli shader).
   */
  autoQuality(dt) {
    const q = this.settings.qual;
    if (q !== 'auto' && q !== 'basso') return;
    if (this.raceClock < 3) return;
    const R = this.renderer, D = this.dyn || (this.dyn = { t: 0, n: 0, avvisato: false });
    D.t += dt; D.n++;
    if (D.t < 2) return;
    const fps = D.n / D.t;
    D.t = 0; D.n = 0;
    const pr = R.r.getPixelRatio(), base = R.basePR || pr;
    let nuovo = pr;
    if (fps < 40 && pr > 0.45) {
      nuovo = Math.max(0.45, pr * 0.85);
      if (R.gtao) R.gtao.enabled = false;
      if (!D.avvisato) { D.avvisato = true; UI.toast(`Risoluzione ridotta automaticamente (${Math.round(fps)} fps)`, 2500); }
    } else if (fps > 58 && pr < base) nuovo = Math.min(base, pr * 1.1);
    if (Math.abs(nuovo - pr) > 0.01) R.setPixelRatio(nuovo);
  }

}

function autoQuality() {
  try {
    const name = gpuName(document.createElement('canvas').getContext('webgl2'));
    const kind = gpuKind(name);
    if (kind === 'software') return 'basso';
    if (kind === 'integrata') return 'medio';
    return 'alto';
  } catch {
    return 'medio';
  }
}

const app = new App();
window.cuboCorse = app;
app.start().catch((e) => {
  console.error(e);
  UI.setLoading(1, 'Errore: ' + e.message);
});
