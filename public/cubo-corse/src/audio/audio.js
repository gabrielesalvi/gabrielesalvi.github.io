// Cubo Corse — modulo audio.
//
// Tutto è sintetizzato con WebAudio: nessun file audio, nessuna libreria.
// Struttura del grafo:
//
//   motore giocatore ─┐
//   gomme/cordoli ────┼─ busGiocatore → pan/attenuazione camera → busLoop ─┐
//   fuori pista ──────┘                                                    │
//   vento ────────────────────────────────────────────────────── busLoop ──┤
//   avversari (PannerNode) ─────────────────────────────────────── busAvv ─┤
//   urti, fuochi, cambi… ───────────────────────────────────────── busSfx ─┼→ mix → compressore → master (≤0,8) → muto → limitatore → uscita
//   folla, pioggia ─────────────────────────────────────────────── busAmb ─┤
//   semaforo, giri, menu ───────────────────────────────────────── busUi ──┤
//   mandate → riverbero (convolver con IR a rumore) ───────────────────────┘
//
// I loop continui sono creati una volta sola in init(); a ogni frame si
// cambiano soltanto parametri, sempre con setTargetAtTime. Gli eventi brevi
// creano nodi usa-e-getta che si scollegano da soli a fine suono.

const RPM_MIN = 1300;          // minimo
const RPM_MAX = 8300;          // limitatore (massimo)
const RPM_LIM = 8200;          // soglia oltre cui il limitatore taglia
const C_SUONO = 343;           // m/s
const DIST_MAX = 250;          // oltre: avversario muto
const DIST_SFUMA = 200;        // da qui comincia la dissolvenza
const DOPPLER_MAX_CENT = 350;  // detune Doppler limitato a ±3,5 semitoni
const MAX_AVV = 11;            // voci avversarie massime (il gioco ne usa fino a 9)
const DURATA_DOPPIETTA = 0.2;  // s

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const finito = (v) => typeof v === 'number' && Number.isFinite(v);
const caso = (a, b) => a + Math.random() * (b - a);
const nota = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

// ---------------------------------------------------------------------------
// Famiglie di motori. «arm» descrive l'onda di carattere (PeriodicWave) costruita
// su METÀ della frequenza di scoppio: l'armonica k vale k·f0/2, quindi le posizioni
// dispari sono i mezzi ordini (borbottio del V8 a croce, raspa del V6), le pari gli
// ordini interi (urlo pulito del V12).
// ---------------------------------------------------------------------------
const FAMIGLIE = {
  6: {
    nome: 'V6 biturbo',
    saw: 0.40, sq: 0.42, sqRapp: 1, sub: 0.30, car: 0.45,
    arm: [0.55, 1.0, 0.50, 0.62, 0.40, 0.45, 0.26, 0.30, 0.16, 0.20, 0.10, 0.14, 0.06, 0.08, 0.04, 0.05],
    am: 0.22, lp: 1.0, q: 4.0, drive: 1.25, turbo: true, ruvido: 1.2, aspira: 0.8, corpo: 1.0,
  },
  8: {
    nome: 'V8 aspirato',
    saw: 0.55, sq: 0.22, sqRapp: 1, sub: 0.55, car: 0.55,
    arm: [1.0, 0.90, 0.72, 0.50, 0.38, 0.30, 0.20, 0.15, 0.09, 0.06, 0.04, 0.03, 0.02, 0.015, 0.01, 0.01],
    am: 0.38, lp: 0.78, q: 2.6, drive: 1.45, turbo: false, ruvido: 1.0, aspira: 0.6, corpo: 1.6,
  },
  12: {
    nome: 'V12 aspirato',
    saw: 0.46, sq: 0.13, sqRapp: 2, sub: 0.10, car: 0.60,
    arm: [0.05, 1.0, 0.04, 0.78, 0.04, 0.58, 0.03, 0.42, 0.02, 0.32, 0.02, 0.24, 0.01, 0.17, 0.01, 0.12],
    am: 0.07, lp: 1.6, q: 5.5, drive: 0.85, turbo: false, ruvido: 0.6, aspira: 1.4, corpo: 0.6,
  },
};
function chiaveFamiglia(cyl) {
  const c = num(cyl, 8);
  if (c <= 6) return 6;
  if (c >= 10) return 12;
  return 8;
}

// ---------------------------------------------------------------------------
// Buffer generati (rumori, crepitio, gocce, risposta all'impulso)
// ---------------------------------------------------------------------------

// Riempie n campioni con gen() e salda la coda all'inizio, così il loop non fa click.
function generaCiclico(n, gen) {
  const m = Math.min(4096, Math.floor(n / 8));
  const tmp = new Float32Array(n + m);
  for (let i = 0; i < n + m; i++) tmp[i] = gen();
  const out = tmp.subarray(0, n);
  for (let i = 0; i < m; i++) {
    const w = i / m;
    out[i] = tmp[i] * w + tmp[n + i] * (1 - w);
  }
  return out;
}
function normalizza(d, picco) {
  let max = 0;
  for (let i = 0; i < d.length; i++) max = Math.max(max, Math.abs(d[i]));
  if (max > 0) { const k = picco / max; for (let i = 0; i < d.length; i++) d[i] *= k; }
}
function bufBianco(ctx, sec) {
  const n = Math.floor(ctx.sampleRate * sec);
  const b = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  return b;
}
// Rumore rosa (filtro di Paul Kellet).
function bufRosa(ctx, sec) {
  const n = Math.floor(ctx.sampleRate * sec);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  const dati = generaCiclico(n, () => {
    const w = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.96900 * b2 + w * 0.1538520;
    b3 = 0.86650 * b3 + w * 0.3104856;
    b4 = 0.55000 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.0168980;
    const o = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
    b6 = w * 0.115926;
    return o;
  });
  normalizza(dati, 0.9);
  const b = ctx.createBuffer(1, n, ctx.sampleRate);
  b.getChannelData(0).set(dati);
  return b;
}
// Crepitio: impulsi sparsi con piccola coda (ghiaia, detriti, fuochi d'artificio).
function bufCrepitio(ctx, sec, densita = 380) {
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * sec);
  const b = ctx.createBuffer(1, n, sr);
  const d = b.getChannelData(0);
  let i = 0;
  for (;;) {
    i += Math.max(1, Math.floor(-Math.log(1 - Math.random()) * sr / densita));
    if (i >= n) break;
    const a = Math.pow(Math.random(), 2.2) * (Math.random() < 0.5 ? -1 : 1);
    const len = Math.floor(sr * (0.0004 + Math.random() * 0.003));
    for (let k = 0; k < len && i + k < n; k++) {
      d[i + k] += a * (Math.random() * 2 - 1) * Math.exp(-k / (len * 0.25));
    }
  }
  normalizza(d, 0.9);
  return b;
}
// Gocce di pioggia in stereo: piccoli "plic" con glissando e posizione casuale.
function bufGocce(ctx, sec) {
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * sec);
  const b = ctx.createBuffer(2, n, sr);
  const L = b.getChannelData(0), R = b.getChannelData(1);
  const quante = Math.floor(sec * 70);
  for (let q = 0; q < quante; q++) {
    const p0 = Math.floor(Math.random() * n);
    const f = 1800 + Math.random() * 3500;
    const dur = 0.004 + Math.random() * 0.02;
    const amp = Math.pow(Math.random(), 3) * 0.8 + 0.05;
    const pan = Math.random();
    const gl = Math.cos(pan * Math.PI / 2), gr = Math.sin(pan * Math.PI / 2);
    const len = Math.floor(dur * sr * 4);
    let fase = 0;
    for (let k = 0; k < len; k++) {
      const tt = k / sr;
      const env = Math.exp(-tt / (dur * 0.3));
      fase += 2 * Math.PI * f * (1 + 0.6 * tt / dur) / sr;
      let s = Math.sin(fase) * env * amp;
      if (k < 24) s += (Math.random() * 2 - 1) * amp * 0.5 * (1 - k / 24);
      const j = (p0 + k) % n;
      L[j] += s * gl; R[j] += s * gr;
    }
  }
  let max = 0;
  for (let i = 0; i < n; i++) max = Math.max(max, Math.abs(L[i]), Math.abs(R[i]));
  if (max > 0) for (let i = 0; i < n; i++) { L[i] *= 0.9 / max; R[i] *= 0.9 / max; }
  return b;
}
// Risposta all'impulso: rumore che decade esponenzialmente e si scurisce nel tempo,
// con qualche prima riflessione. Stereo decorrelato.
function bufRiverbero(ctx, sec) {
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * sec);
  const pre = Math.floor(0.012 * sr);
  const b = ctx.createBuffer(2, n, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    let lp = 0;
    for (let i = pre; i < n; i++) {
      const t = i / sr;
      const env = Math.exp(-t * 6.9 / sec);
      const a = 0.12 + 0.78 * (t / sec);           // smorzamento delle alte che cresce
      lp += (Math.random() * 2 - 1 - lp) * (1 - a);
      d[i] = lp * env;
    }
    for (let r = 0; r < 7; r++) {
      const j = pre + Math.floor((0.004 + Math.random() * 0.07) * sr);
      if (j < n) d[j] += (r % 2 ? -1 : 1) * (0.5 + Math.random() * 0.4) * Math.exp(-r * 0.25);
    }
  }
  return b;
}
// Curva di saturazione (tanh asimmetrica: aggiunge anche armoniche pari).
function curvaDistorsione(k, asim) {
  const n = 2048;
  const c = new Float32Array(n);
  let max = 0;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const y = Math.tanh(k * (x + asim * x * x));
    c[i] = y;
    max = Math.max(max, Math.abs(y));
  }
  for (let i = 0; i < n; i++) c[i] /= max;
  return c;
}

// ---------------------------------------------------------------------------

export class AudioEngine {
  constructor() {
    // Niente AudioContext qui: i browser lo vogliono dopo un gesto dell'utente.
    this._ctx = null;
    this._ready = false;
    this._avvio = null;
    this._muted = false;
    this._vol = 1;
    this._paused = false;
    this._L = { x: 0, y: 0, z: 0, yaw: 0 };
    this._scrapeOn = false;
    this._azzera();
  }

  // Stato interno dei loop (anche per ripartire dopo dispose()).
  _azzera() {
    this._ultimi = new Map();   // ultimo valore chiesto a ogni AudioParam
    this._sorgenti = [];        // sorgenti continue da fermare in dispose()
    this._voci = [];            // voci avversarie
    this._onde = {};            // PeriodicWave per famiglia
    this._mot = null; this._gom = null; this._amb = null;
    this._m = {
      grinta: -1, jit: 0, boost: 0, thrPrev: 0, limProssimo: 0, blip: 0,
      popPausa: 0, airPrev: 0, cockpit: false,
    };
    this._a = { onda: 0, cheerPrev: 0, raffica: 1, w1: 0, w2: 0, w3: 0 };
    this._ascoltatoreIniziale = true;
  }

  get ready() { return this._ready; }
  get paused() { return this._paused; }

  // -------------------------------------------------------------------------
  // Avvio
  // -------------------------------------------------------------------------
  async init() {
    if (this._ready) return;
    if (this._avvio) return this._avvio;
    this._avvio = (async () => {
      const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AC) { console.warn('[audio] WebAudio non disponibile'); return; }
      let ctx;
      try { ctx = new AC({ latencyHint: 'interactive' }); } catch { ctx = new AC(); }
      this._ctx = ctx;
      try {
        this._costruisci();
      } catch (e) {
        console.error('[audio] costruzione del grafo fallita', e);
        this._ctx = null;
        try { ctx.close(); } catch { /* niente */ }
        this._azzera();
        return;
      }
      try { if (ctx.state !== 'running') await ctx.resume(); } catch { /* riprova al prossimo gesto */ }
      this._ready = true;
      this._applicaAscoltatore();
    })();
    try { await this._avvio; } finally { this._avvio = null; }
  }

  _costruisci() {
    const ctx = this._ctx;
    this._buf = {
      bianco: bufBianco(ctx, 2.5),
      rosa: bufRosa(ctx, 3.5),
      crepitio: bufCrepitio(ctx, 3),
      gocce: bufGocce(ctx, 4),
    };

    // --- catena finale ---
    this._mix = this._g(1);
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 3;
    comp.attack.value = 0.006; comp.release.value = 0.25;
    this._master = this._g(0.8 * this._vol);
    this._muto = this._g(this._muted ? 0 : 1);
    const lim = ctx.createDynamicsCompressor();       // limitatore finale
    lim.threshold.value = -2; lim.knee.value = 0; lim.ratio.value = 20;
    lim.attack.value = 0.002; lim.release.value = 0.12;
    this._analisi = ctx.createAnalyser();             // solo per misure (pagina di prova)
    this._analisi.fftSize = 2048;
    this._mix.connect(comp); comp.connect(this._master);
    this._master.connect(this._muto); this._muto.connect(lim);
    lim.connect(ctx.destination); lim.connect(this._analisi);

    // --- riverbero ---
    this._verbIn = this._g(1);
    const conv = ctx.createConvolver();
    conv.buffer = bufRiverbero(ctx, 2.6);
    const verbOut = this._g(0.8);
    this._verbIn.connect(conv); conv.connect(verbOut); verbOut.connect(this._mix);

    // --- bus ---
    this._busLoop = this._g(1); this._busLoop.connect(this._mix);
    this._busAvv = this._g(1); this._busAvv.connect(this._mix);
    this._busSfx = this._g(1); this._busSfx.connect(this._mix);
    this._busAmb = this._g(1); this._busAmb.connect(this._mix);
    this._busUi = this._g(1); this._busUi.connect(this._mix);
    this._mandaLoop = this._g(0.025); this._busLoop.connect(this._mandaLoop); this._mandaLoop.connect(this._verbIn);
    this._mandaAvv = this._g(0.03); this._busAvv.connect(this._mandaAvv); this._mandaAvv.connect(this._verbIn);
    this._mandaSfx = this._g(0.07); this._busSfx.connect(this._mandaSfx); this._mandaSfx.connect(this._verbIn);
    this._mandaUi = this._g(0.05); this._busUi.connect(this._mandaUi); this._mandaUi.connect(this._verbIn);

    // suoni "dell'auto del giocatore": seguono la sua posizione se la camera si allontana
    this._busGiocatore = this._g(1);
    this._panGiocatore = this._stereo();
    this._attGiocatore = this._g(1);
    this._busGiocatore.connect(this._panGiocatore);
    this._panGiocatore.connect(this._attGiocatore);
    this._attGiocatore.connect(this._busLoop);

    this._costruisciMotore();
    this._costruisciGomme();
    this._costruisciAmbiente();
    this._rumoreAvv = this._loop(this._buf.bianco);   // condiviso dalle voci avversarie

    if (this._paused) this._applicaPausa();
  }

  // -------------------------------------------------------------------------
  // Fabbriche di nodi
  // -------------------------------------------------------------------------
  _g(v = 1) { const g = this._ctx.createGain(); g.gain.value = v; return g; }
  _f(tipo, freq, Q) {
    const f = this._ctx.createBiquadFilter();
    f.type = tipo; f.frequency.value = freq;
    if (Q !== undefined) f.Q.value = Q;
    return f;
  }
  _o(tipo, freq) { const o = this._ctx.createOscillator(); o.type = tipo; o.frequency.value = freq; return o; }
  _loop(buf, rate = 1) {
    const s = this._ctx.createBufferSource();
    s.buffer = buf; s.loop = true; s.playbackRate.value = rate;
    s.start(0, Math.random() * buf.duration);
    this._sorgenti.push(s);
    return s;
  }
  _avvia(nodo) { nodo.start(); this._sorgenti.push(nodo); return nodo; }
  _stereo() {
    if (this._ctx.createStereoPanner) return this._ctx.createStereoPanner();
    return this._g(1); // ripiego senza pan
  }
  // Sorgente costante (pilota di frequenze/detune). Con ripiego per browser vecchi.
  _costante(v) {
    const ctx = this._ctx;
    if (ctx.createConstantSource) {
      const c = ctx.createConstantSource();
      c.offset.value = v;
      this._avvia(c);
      return { out: c, offset: c.offset };
    }
    const b = ctx.createBuffer(1, 128, ctx.sampleRate);
    b.getChannelData(0).fill(1);
    const s = ctx.createBufferSource(); s.buffer = b; s.loop = true;
    const g = this._g(v); s.connect(g); this._avvia(s);
    return { out: g, offset: g.gain };
  }
  _panner() {
    const p = this._ctx.createPanner();
    p.panningModel = 'equalpower';
    p.distanceModel = 'inverse';
    p.refDistance = 8;
    p.rolloffFactor = 1.2;
    p.maxDistance = 10000;
    return p;
  }
  _onda(cyl) {
    const k = chiaveFamiglia(cyl);
    if (!this._onde[k]) {
      const arm = FAMIGLIE[k].arm;
      const n = arm.length + 1;
      const re = new Float32Array(n), im = new Float32Array(n);
      for (let i = 1; i < n; i++) {
        const fase = i * i * 0.7;     // fasi fisse "disordinate": forma d'onda meno da sintetizzatore
        re[i] = arm[i - 1] * Math.cos(fase);
        im[i] = arm[i - 1] * Math.sin(fase);
      }
      this._onde[k] = this._ctx.createPeriodicWave(re, im);
    }
    return this._onde[k];
  }

  // Cambia un parametro senza click; salta le chiamate inutili.
  _p(param, v, tc = 0.03) {
    if (!finito(v)) return;
    const prec = this._ultimi.get(param);
    if (prec !== undefined && Math.abs(prec - v) <= Math.abs(v) * 1e-4 + 1e-6) return;
    this._ultimi.set(param, v);
    param.setTargetAtTime(v, this._ctx.currentTime, tc);
  }
  // Imposta subito (prima posizione di un panner, ecc.).
  _pSubito(param, v) {
    if (!finito(v)) return;
    const t = this._ctx.currentTime;
    param.cancelScheduledValues(t);
    param.setValueAtTime(v, t);
    this._ultimi.set(param, v);
  }
  // Scollega i nodi di un evento quando ha finito di suonare.
  _usaEGetta(nodi, fine) {
    const ms = Math.max(50, (fine - this._ctx.currentTime + 0.3) * 1000);
    setTimeout(() => { for (const n of nodi) { try { n.disconnect(); } catch { /* già scollegato */ } } }, ms);
  }
  // Inviluppo attacco-decadimento su un AudioParam di un nodo nuovo.
  _inv(param, t, att, picco, dec) {
    param.setValueAtTime(0, t);
    param.linearRampToValueAtTime(picco, t + att);
    param.setTargetAtTime(0, t + att, dec);
  }
  // Rumore usa-e-getta da un buffer, con partenza a caso.
  _rumore(buf, t, dur, rate = 1) {
    const s = this._ctx.createBufferSource();
    s.buffer = buf; s.loop = true; s.playbackRate.value = rate;
    s.start(t, Math.random() * buf.duration);
    s.stop(t + dur);
    return s;
  }
  _posPanner(pn, x, y, z, subito) {
    if (pn.positionX) {
      if (subito) { this._pSubito(pn.positionX, x); this._pSubito(pn.positionY, y); this._pSubito(pn.positionZ, z); }
      else { this._p(pn.positionX, x, 0.02); this._p(pn.positionY, y, 0.02); this._p(pn.positionZ, z, 0.02); }
    } else if (pn.setPosition) {
      pn.setPosition(x, y, z);
    }
  }
  // Panner usa-e-getta già posizionato, collegato a dest.
  _pannerEvento(x, y, z, dest) {
    const pn = this._panner();
    if (pn.positionX) { pn.positionX.value = x; pn.positionY.value = y; pn.positionZ.value = z; }
    else pn.setPosition(x, y, z);
    pn.connect(dest);
    return pn;
  }

  // -------------------------------------------------------------------------
  // Motore del giocatore
  // -------------------------------------------------------------------------
  _costruisciMotore() {
    const M = this._mot = {};
    // pilota di frequenza: offset = frequenza di scoppio f0; ogni oscillatore la riceve scalata
    M.freq = this._costante(60);
    M.det = this._costante(0);    // jitter comune in cent

    M.saw = this._o('sawtooth', 0);
    M.sq = this._o('square', 0);
    M.sub = this._o('triangle', 0);
    M.car = this._o('sine', 0);   // onda di carattere (PeriodicWave per famiglia)
    M.am = this._o('sine', 0);    // modulazione al ciclo motore (borbottio)

    M.kSaw = this._g(1); M.kSq = this._g(1); M.kSub = this._g(0.5); M.kCar = this._g(0.5); M.kAm = this._g(1 / 8);
    const pilotati = [[M.kSaw, M.saw], [M.kSq, M.sq], [M.kSub, M.sub], [M.kCar, M.car], [M.kAm, M.am]];
    for (const [k, o] of pilotati) { M.freq.out.connect(k); k.connect(o.frequency); }
    for (const o of [M.saw, M.sq, M.sub, M.car]) M.det.out.connect(o.detune);

    M.mSaw = this._g(0.5); M.mSq = this._g(0.3); M.mSub = this._g(0.4); M.mCar = this._g(0.5);
    M.mix = this._g(0.5);
    M.saw.connect(M.mSaw); M.sq.connect(M.mSq); M.sub.connect(M.mSub); M.car.connect(M.mCar);
    for (const m of [M.mSaw, M.mSq, M.mSub, M.mCar]) m.connect(M.mix);

    M.amG = this._g(0.85); M.amD = this._g(0.15);
    M.am.connect(M.amD); M.amD.connect(M.amG.gain);

    M.drive = this._g(1);
    M.shaper = this._ctx.createWaveShaper();
    M.shaper.oversample = '2x';
    M.dc = this._f('highpass', 28, 0);       // toglie la continua dell'asimmetria
    M.lp = this._f('lowpass', 1500, 3);
    M.corpo = this._f('peaking', 160, 1.1); M.corpo.gain.value = 3;
    M.limG = this._g(1);        // tagli del limitatore (automazioni ad hoc)
    M.cambioG = this._g(1);     // taglio del gas al cambio marcia
    M.livello = this._g(0);
    M.out = this._g(1);
    M.mix.connect(M.amG); M.amG.connect(M.drive); M.drive.connect(M.shaper);
    M.shaper.connect(M.dc); M.dc.connect(M.lp); M.lp.connect(M.corpo);
    M.corpo.connect(M.limG); M.limG.connect(M.cambioG); M.cambioG.connect(M.livello);
    M.livello.connect(M.out);

    // scarico: rumore a banda, pulsato dagli scoppi (il dente di sega modula il guadagno)
    M.nBP = this._f('bandpass', 600, 0.9);
    M.nPuls = this._g(0.5); M.nPulsD = this._g(0.5);
    M.nLiv = this._g(0);
    this._loop(this._buf.bianco).connect(M.nBP);
    M.nBP.connect(M.nPuls); M.saw.connect(M.nPulsD); M.nPulsD.connect(M.nPuls.gain);
    M.nPuls.connect(M.nLiv); M.nLiv.connect(M.lp);

    // aspirazione: soffio acuto che cresce con gas e giri
    M.aspHP = this._f('highpass', 1800, 0);
    M.aspBP = this._f('peaking', 3200, 1.5); M.aspBP.gain.value = 6;
    M.aspG = this._g(0);
    this._loop(this._buf.rosa).connect(M.aspHP);
    M.aspHP.connect(M.aspBP); M.aspBP.connect(M.aspG); M.aspG.connect(M.limG);

    // fischio turbo (solo V6)
    M.turbo = this._o('sine', 2000);
    M.turboG = this._g(0);
    M.turbo.connect(M.turboG); M.turboG.connect(M.out);

    // sibilo degli ingranaggi a denti dritti (si sente in abitacolo e in retro)
    M.whine = this._o('triangle', 400);
    M.whineG = this._g(0);
    M.whine.connect(M.whineG); M.whineG.connect(M.out);

    // uscita: abitacolo (ovattato) → galleria (rimbombo) → bus giocatore
    M.abit = this._f('lowpass', 18000, 0);
    M.galleria = this._f('lowshelf', 150); M.galleria.gain.value = 0;
    M.popIn = this._g(1);       // scoppiettii e sfiati entrano qui
    M.out.connect(M.abit); M.popIn.connect(M.abit);
    M.abit.connect(M.galleria); M.galleria.connect(this._busGiocatore);

    for (const o of [M.saw, M.sq, M.sub, M.car, M.am, M.turbo, M.whine]) this._avvia(o);
    M.cyl = 0;
    this._impostaFamiglia(8, true);
    this._impostaGrinta(0.7);
  }

  _impostaFamiglia(cyl, subito) {
    const M = this._mot;
    const k = chiaveFamiglia(cyl);
    const F = FAMIGLIE[k];
    M.cyl = cyl; M.fam = F;
    const c = clamp(num(cyl, 8), 2, 16);
    const imposta = subito ? (p, v) => this._pSubito(p, v) : (p, v) => this._p(p, v, 0.05);
    imposta(M.kSq.gain, F.sqRapp);
    imposta(M.kAm.gain, 1 / c);                 // ciclo motore = f0 / cilindri
    M.car.setPeriodicWave(this._onda(k));
  }

  _impostaGrinta(gr) {
    this._m.grinta = gr;
    this._mot.shaper.curve = curvaDistorsione(1.2 + 4 * gr, 0.08 + 0.2 * gr);
  }

  _aggiornaMotore(dt, t, p, st) {
    const M = this._mot, m = this._m;
    const cyl = num(p.cyl, 8);
    if (cyl !== M.cyl) this._impostaFamiglia(cyl, false);
    const F = M.fam;
    const voce = p.voce || {};
    const base = clamp(num(voce.base, 0.5), 0, 1);
    const grinta = clamp(num(voce.grinta, 0.6), 0, 1);
    if (Math.abs(grinta - m.grinta) > 0.03) this._impostaGrinta(grinta);

    let thr = clamp(num(p.throttle, 0), 0, 1);
    let rpm = clamp(num(p.rpm, RPM_MIN), 500, 9500);
    // doppietta in scalata: colpo di gas che alza i giri per un attimo
    if (m.blip > 0) {
      const k = Math.sin(Math.PI * (1 - m.blip / DURATA_DOPPIETTA));
      rpm = Math.min(RPM_MAX, rpm + 1100 * k);
      thr = Math.max(thr, 0.85 * k);
      m.blip -= dt;
    }
    const rn = clamp((rpm - RPM_MIN) / (RPM_MAX - RPM_MIN), 0, 1);
    const minimo = 1 - rn;
    const f0 = (rpm / 60) * cyl / 2;
    const cockpit = !!st.cockpit;
    const tunnel = clamp(num(st.tunnel, 0), 0, 1);

    this._p(M.freq.offset, f0, 0.012);
    // jitter: passeggiata casuale sul detune, più ampia al minimo
    m.jit = m.jit * 0.86 + (Math.random() - 0.5) * 0.9;
    this._p(M.det.offset, m.jit * (3 + 12 * minimo * minimo) * F.ruvido, 0.025);

    // miscela: timbro (base) e ruvidità (grinta)
    this._p(M.mSaw.gain, F.saw * (0.7 + 0.6 * base), 0.1);
    this._p(M.mSq.gain, F.sq * (0.6 + 0.8 * grinta), 0.1);
    this._p(M.mSub.gain, F.sub * (1.3 - 0.6 * base) * (0.8 + 0.4 * minimo), 0.1);
    this._p(M.mCar.gain, F.car * (0.8 + 0.4 * base), 0.1);

    // borbottio al ciclo motore, forte al minimo
    const am = F.am * (0.35 + 0.65 * minimo) * (0.7 + 0.5 * grinta);
    this._p(M.amG.gain, 1 - am * 0.5, 0.05);
    this._p(M.amD.gain, am * 0.5, 0.05);

    // saturazione: più gas e più grinta = più ruvido
    this._p(M.drive.gain, F.drive * (0.7 + 2.4 * grinta) * (0.45 + 0.75 * thr) * (0.85 + 0.3 * rn), 0.04);

    // filtro che segue gas e giri; in rilascio il suono si scurisce
    let fc = F.lp * (420 + 1500 * rn + 3200 * thr * (0.35 + 0.65 * rn)) * (0.75 + 0.5 * base);
    fc = clamp(Math.max(fc, f0 * 2.4), 150, 14000);
    this._p(M.lp.frequency, fc, 0.03);
    this._p(M.lp.Q, F.q, 0.2);
    this._p(M.corpo.frequency, clamp(f0, 70, 420), 0.03);
    this._p(M.corpo.gain, 2 + 2.5 * F.corpo + 3 * tunnel, 0.1);

    let liv = (0.13 + 0.15 * thr + 0.09 * rn) * (thr < 0.05 ? 0.8 : 1);
    if (cockpit) liv *= 1.15;
    liv *= 1 + 0.35 * tunnel;
    this._p(M.livello.gain, liv, 0.04);

    // scarico e aspirazione
    this._p(M.nBP.frequency, clamp(f0 * 2.2, 180, 3200), 0.03);
    this._p(M.nLiv.gain, (0.05 + 0.35 * thr) * (0.5 + 0.5 * rn) * (0.6 + 0.6 * grinta), 0.04);
    this._p(M.aspHP.frequency, 1500 + 2500 * rn, 0.05);
    this._p(M.aspG.gain, 0.05 * thr * rn * F.aspira, 0.05);

    // turbo: si carica col gas, si scarica in fretta in rilascio (con sfiato)
    if (F.turbo) {
      const obiettivo = thr * rn;
      m.boost += (obiettivo - m.boost) * Math.min(1, dt * (obiettivo > m.boost ? 1.8 : 4));
      this._p(M.turbo.frequency, 1800 + 5200 * m.boost, 0.03);
      this._p(M.turboG.gain, 0.02 * m.boost * m.boost, 0.03);
      if (m.thrPrev > 0.55 && thr < 0.15 && m.boost > 0.3) this._sfiato(m.boost);
    } else {
      m.boost = 0;
      this._p(M.turboG.gain, 0, 0.05);
    }

    // ingranaggi
    const gear = num(p.gear, 1);
    const speed = Math.abs(num(p.speed, 0));
    if (gear === -1) {
      this._p(M.whine.frequency, 260 + speed * 75, 0.03);
      this._p(M.whineG.gain, 0.05 * clamp(speed / 4, 0, 1), 0.05);
    } else {
      this._p(M.whine.frequency, (rpm / 60) * 23, 0.02);
      this._p(M.whineG.gain, (cockpit ? 0.006 + 0.014 * thr * rn : 0.0015) * clamp(speed / 10, 0, 1), 0.05);
    }

    // abitacolo e galleria
    this._p(M.abit.frequency, cockpit ? 2300 + 1200 * thr : 18000, 0.08);
    this._p(M.galleria.gain, 7 * tunnel, 0.1);

    // limitatore: tagli d'accensione a raffica
    if (rpm >= RPM_LIM && m.blip <= 0 && thr > 0.3) {
      if (t >= m.limProssimo) {
        const g = M.limG.gain;
        g.setTargetAtTime(0.1, t, 0.003);
        g.setTargetAtTime(1, t + 0.03 + Math.random() * 0.012, 0.006);
        m.limProssimo = t + 0.065 + Math.random() * 0.025;
        if (Math.random() < 0.25) this._scoppio(0.25 + 0.2 * Math.random(), t + 0.02);
      }
    }

    // scoppiettii in rilascio: gas a zero e giri alti
    m.popPausa -= dt;
    if (thr < 0.08 && rpm > 3800 && m.popPausa <= 0) {
      const prob = dt * 7 * ((rpm - 3800) / 4500) * (0.5 + grinta);
      if (Math.random() < prob) {
        this._scoppio(0.25 + 0.6 * Math.random() * (0.4 + 0.6 * rn));
        if (Math.random() < 0.35) this._scoppio(0.2 + 0.3 * Math.random(), t + 0.035 + Math.random() * 0.03);
        m.popPausa = 0.05;
      }
    }
    m.thrPrev = thr;
  }

  // Scoppio nello scarico: botto di rumore a banda + colpo grave.
  _scoppio(forza, quando) {
    const t = (quando ?? this._ctx.currentTime) + Math.random() * 0.01;
    const f = clamp(forza, 0, 1);
    const dest = this._mot.popIn;
    const src = this._rumore(this._buf.bianco, t, 0.25);
    const bp = this._f('bandpass', caso(200, 700), 1.1);
    const g = this._g(0);
    this._inv(g.gain, t, 0.002, 0.9 * f, caso(0.018, 0.045));
    src.connect(bp); bp.connect(g); g.connect(dest);
    const o = this._o('sine', caso(70, 110));
    o.frequency.setValueAtTime(caso(90, 130), t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.08);
    const og = this._g(0);
    this._inv(og.gain, t, 0.002, 0.6 * f, 0.03);
    o.connect(og); og.connect(dest);
    o.start(t); o.stop(t + 0.25);
    this._usaEGetta([src, bp, g, o, og], t + 0.25);
  }

  // Sfiato della valvola (V6 turbo): "psss" che scende.
  _sfiato(boost) {
    const t = this._ctx.currentTime;
    const src = this._rumore(this._buf.bianco, t, 0.6);
    const bp = this._f('bandpass', 4200, 1.2);
    bp.frequency.setValueAtTime(4200, t);
    bp.frequency.exponentialRampToValueAtTime(1600, t + 0.35);
    const g = this._g(0);
    this._inv(g.gain, t, 0.012, 0.16 * boost, 0.12);
    src.connect(bp); bp.connect(g); g.connect(this._mot.popIn);
    this._usaEGetta([src, bp, g], t + 0.6);
  }

  // Clack della leva del cambio.
  _clack(t) {
    const dest = this._busGiocatore;
    const liv = this._m.cockpit ? 1 : 0.5;
    const src = this._rumore(this._buf.bianco, t, 0.08);
    const bp = this._f('bandpass', 2600, 1);
    const g = this._g(0);
    this._inv(g.gain, t, 0.001, 0.2 * liv, 0.012);
    src.connect(bp); bp.connect(g); g.connect(dest);
    const o = this._o('sine', 180);
    o.frequency.setValueAtTime(190, t);
    o.frequency.exponentialRampToValueAtTime(85, t + 0.04);
    const og = this._g(0);
    this._inv(og.gain, t, 0.001, 0.14 * liv, 0.02);
    o.connect(og); og.connect(dest);
    o.start(t); o.stop(t + 0.12);
    this._usaEGetta([src, bp, g, o, og], t + 0.12);
  }

  // -------------------------------------------------------------------------
  // Gomme, cordoli, fuori pista, strisciata
  // -------------------------------------------------------------------------
  _costruisciGomme() {
    const G = this._gom = {};
    const dest = this._busGiocatore;
    const bianco = this._loop(this._buf.bianco);

    // stridio: banda larga + banda stretta (componente tonale) con frequenze che vagano
    G.bp1 = this._f('bandpass', 1500, 1.4); G.g1 = this._g(0);
    G.bp2 = this._f('bandpass', 1800, 14); G.g2 = this._g(0);
    bianco.connect(G.bp1); G.bp1.connect(G.g1); G.g1.connect(dest);
    bianco.connect(G.bp2); G.bp2.connect(G.g2); G.g2.connect(dest);

    // cordoli: impulsi bassi a 25-40 Hz (quadra che apre e chiude un rumore grave) + tono ronzante
    G.kOsc = this._o('square', 30);
    G.kNLP = this._f('lowpass', 300, 0);
    G.kAm = this._g(0.5); G.kAmD = this._g(0.5);
    G.kToneLP = this._f('lowpass', 220, 0); G.kTone = this._g(0.15);
    G.kG = this._g(0);
    bianco.connect(G.kNLP); G.kNLP.connect(G.kAm);
    G.kOsc.connect(G.kAmD); G.kAmD.connect(G.kAm.gain);
    G.kOsc.connect(G.kToneLP); G.kToneLP.connect(G.kTone);
    G.kAm.connect(G.kG); G.kTone.connect(G.kG);
    G.kG.connect(dest);
    this._avvia(G.kOsc);

    // erba: fruscio morbido
    G.erbaLP = this._f('lowpass', 800, 1);
    G.erbaG = this._g(0);
    this._loop(this._buf.rosa).connect(G.erbaLP); G.erbaLP.connect(G.erbaG); G.erbaG.connect(dest);

    // ghiaia: crepitio granuloso + rombo grave
    G.crep = this._loop(this._buf.crepitio);
    G.ghiaiaHP = this._f('highpass', 900, 0);
    G.ghiaiaG = this._g(0);
    G.crep.connect(G.ghiaiaHP); G.ghiaiaHP.connect(G.ghiaiaG); G.ghiaiaG.connect(dest);
    G.ghiaiaLP = this._f('lowpass', 380, 0);
    G.ghiaiaRomboG = this._g(0);
    bianco.connect(G.ghiaiaLP); G.ghiaiaLP.connect(G.ghiaiaRomboG); G.ghiaiaRomboG.connect(dest);

    // strisciata contro il muro: attrito + risonanza metallica + grana
    G.scBP = this._f('bandpass', 1400, 2); G.scG = this._g(0);
    G.scMet = this._f('bandpass', 3700, 9); G.scMetG = this._g(0);
    G.scCrepG = this._g(0);
    bianco.connect(G.scBP); G.scBP.connect(G.scG); G.scG.connect(dest);
    bianco.connect(G.scMet); G.scMet.connect(G.scMetG); G.scMetG.connect(dest);
    G.crep.connect(G.scCrepG); G.scCrepG.connect(dest);

    // spruzzi d'acqua dalle gomme sul bagnato
    G.sprayBP = this._f('bandpass', 1200, 0.8); G.sprayG = this._g(0);
    bianco.connect(G.sprayBP); G.sprayBP.connect(G.sprayG); G.sprayG.connect(dest);
  }

  _aggiornaSuolo(dt, t, p, st) {
    const G = this._gom, a = this._a;
    const speed = Math.abs(num(p.speed, 0));
    const air = num(p.air, 0);
    const aTerra = air <= 0.05 ? 1 : 0;
    const rain = clamp(num(st.rain, 0), 0, 1);

    // vagabondaggi lenti per non avere toni fissi
    a.w1 = clamp(a.w1 * 0.97 + (Math.random() - 0.5) * 0.25, -1, 1);
    a.w2 = clamp(a.w2 * 0.95 + (Math.random() - 0.5) * 0.3, -1, 1);
    a.w3 = clamp(a.w3 * 0.98 + (Math.random() - 0.5) * 0.15, -1, 1);

    // stridio gomme
    const skid = clamp(num(p.skid, 0), 0, 2.5);
    const lv = aTerra * Math.pow(clamp(skid / 1.6, 0, 1), 1.2) * (0.45 + 0.55 * clamp(speed / 10, 0, 1)) * (1 - 0.45 * rain);
    this._p(G.bp1.frequency, 1100 + 900 * lv + 250 * a.w1, 0.05);
    this._p(G.bp2.frequency, 1450 + 700 * lv + 180 * a.w2 + 120 * Math.sin(t * 7.3), 0.03);
    this._p(G.g1.gain, 0.8 * lv, 0.04);
    this._p(G.g2.gain, 2.2 * lv * (0.75 + 0.25 * Math.sin(t * 3.1 + a.w1 * 2)), 0.04);

    // cordoli
    const kerb = clamp(num(p.onKerb, 0) / 4, 0, 1);
    const kl = aTerra * Math.pow(kerb, 0.7) * clamp(speed / 12, 0, 1);
    this._p(G.kOsc.frequency, 25 + 15 * clamp(speed / 60, 0, 1), 0.03);
    this._p(G.kG.gain, 0.9 * kl, 0.02);

    // fuori pista
    const off = aTerra * clamp(num(p.offroad, 0) / 4, 0, 1) * clamp(speed / 20, 0, 1);
    const ghiaia = p.surface === 'ghiaia';
    this._p(G.erbaG.gain, ghiaia ? 0 : off * 0.6 * (0.8 + 0.2 * a.w3), 0.05);
    this._p(G.erbaLP.frequency, 450 + 700 * off + 300 * a.w3, 0.05);
    this._p(G.ghiaiaG.gain, ghiaia ? off * 0.9 : 0, 0.04);
    this._p(G.ghiaiaRomboG.gain, ghiaia ? off * 0.7 : 0, 0.04);
    this._p(G.crep.playbackRate, 0.6 + Math.min(speed, 70) / 35, 0.05);

    // strisciata
    const sc = this._scrapeOn ? 0.35 + 0.65 * clamp(speed / 35, 0, 1) : 0;
    this._p(G.scG.gain, 0.5 * sc, 0.03);
    this._p(G.scBP.frequency, 1200 + 500 * a.w1 + speed * 15, 0.04);
    this._p(G.scMetG.gain, 0.9 * sc * (0.6 + 0.4 * Math.abs(a.w2)), 0.03);
    this._p(G.scMet.frequency, 3500 + 400 * a.w2, 0.05);
    this._p(G.scCrepG.gain, 0.35 * sc, 0.03);

    // spruzzi
    this._p(G.sprayG.gain, 0.25 * rain * clamp(speed / 50, 0, 1), 0.1);

    // atterraggio dopo un volo
    if (this._m.airPrev > 0.25 && air <= 0.02) this._tonfo(clamp(this._m.airPrev / 1.5, 0.2, 1));
    this._m.airPrev = air;
  }

  _tonfo(forza) {
    const t = this._ctx.currentTime;
    const dest = this._busGiocatore;
    const o = this._o('sine', 80);
    o.frequency.setValueAtTime(85, t);
    o.frequency.exponentialRampToValueAtTime(35, t + 0.25);
    const og = this._g(0);
    this._inv(og.gain, t, 0.004, 0.7 * forza, 0.09);
    o.connect(og); og.connect(dest);
    o.start(t); o.stop(t + 0.6);
    const src = this._rumore(this._buf.bianco, t, 0.4);
    const lp = this._f('lowpass', 700, 1);
    const g = this._g(0);
    this._inv(g.gain, t, 0.002, 0.35 * forza, 0.05);
    src.connect(lp); lp.connect(g); g.connect(dest);
    this._usaEGetta([o, og, src, lp, g], t + 0.6);
  }

  // -------------------------------------------------------------------------
  // Atmosfera: vento, folla, pioggia
  // -------------------------------------------------------------------------
  _costruisciAmbiente() {
    const A = this._amb = {};
    const rosa = this._loop(this._buf.rosa);
    const bianco = this._loop(this._buf.bianco);

    // vento (abitacolo/esterno): rumore rosa a banda + un sibilo acuto
    A.ventoBP = this._f('bandpass', 400, 0.6); A.ventoG = this._g(0);
    A.ventoHP = this._f('highpass', 3000, 0); A.ventoHiG = this._g(0);
    rosa.connect(A.ventoBP); A.ventoBP.connect(A.ventoG); A.ventoG.connect(this._busLoop);
    rosa.connect(A.ventoHP); A.ventoHP.connect(A.ventoHiG); A.ventoHiG.connect(this._busLoop);

    // folla: brusio rosa nella banda della voce + chiacchiericcio più acuto
    const rosa2 = this._loop(this._buf.rosa);
    A.follaBP = this._f('bandpass', 700, 0.7); A.follaG = this._g(0);
    A.vociBP = this._f('bandpass', 1800, 1.5); A.vociG = this._g(0);
    rosa2.connect(A.follaBP); A.follaBP.connect(A.follaG); A.follaG.connect(this._busAmb);
    rosa2.connect(A.vociBP); A.vociBP.connect(A.vociG); A.vociG.connect(this._busAmb);

    // pioggia: fruscio passa-alto + rombo grave + gocce stereo
    A.pioggiaHP = this._f('highpass', 2800, 0);
    A.pioggiaLP = this._f('lowpass', 9000, 0);
    A.pioggiaG = this._g(0);
    bianco.connect(A.pioggiaHP); A.pioggiaHP.connect(A.pioggiaLP); A.pioggiaLP.connect(A.pioggiaG); A.pioggiaG.connect(this._busAmb);
    A.pioggiaBassoLP = this._f('lowpass', 600, 0); A.pioggiaBassoG = this._g(0);
    rosa.connect(A.pioggiaBassoLP); A.pioggiaBassoLP.connect(A.pioggiaBassoG); A.pioggiaBassoG.connect(this._busAmb);
    A.gocceLP = this._f('lowpass', 12000, 0); A.gocceG = this._g(0);
    this._loop(this._buf.gocce).connect(A.gocceLP); A.gocceLP.connect(A.gocceG); A.gocceG.connect(this._busAmb);
  }

  _aggiornaAmbiente(dt, t, st, p) {
    const A = this._amb, a = this._a;
    const crowd = clamp(num(st.crowd, 0), 0, 1);
    const cheer = clamp(num(st.cheer, 0), 0, 1);
    const rain = clamp(num(st.rain, 0), 0, 1);
    const tunnel = clamp(num(st.tunnel, 0), 0, 1);
    const cockpit = !!st.cockpit;

    // vento ∝ velocità²
    const wind = Math.abs(num(st.wind, num(p.speed, 0)));
    const w = clamp(wind / 85, 0, 1.3);
    a.raffica = clamp(a.raffica + (Math.random() - 0.5) * dt * 1.6 + (1 - a.raffica) * dt * 0.8, 0.7, 1.3);
    const vento = w * w * a.raffica * (cockpit ? 0.35 : 1) * (1 + 0.3 * tunnel);
    this._p(A.ventoG.gain, 1.1 * vento, 0.08);
    this._p(A.ventoBP.frequency, (250 + wind * 14) * (cockpit ? 0.7 : 1), 0.08);
    this._p(A.ventoHiG.gain, (cockpit ? 0.04 : 0.12) * w * w * a.raffica, 0.08);

    // folla: ondate lente + picchi di entusiasmo
    a.onda = clamp(a.onda * 0.995 + (Math.random() - 0.5) * dt * 1.5, -1, 1);
    const smorza = (cockpit ? 0.6 : 1) * (1 - 0.85 * tunnel);
    this._p(A.follaG.gain, (crowd * (0.5 + 0.18 * a.onda) + cheer * 0.6) * smorza, 0.15);
    this._p(A.follaBP.frequency, 650 + 280 * cheer + 80 * a.onda, 0.2);
    this._p(A.vociG.gain, (crowd * 0.25 + cheer * 0.4) * smorza, 0.15);
    if (!this._paused && cheer > 0.1 && smorza > 0.2 && Math.random() < dt * cheer * 7) this._grido(cheer * smorza);
    if (!this._paused && cheer - a.cheerPrev > 0.25 && smorza > 0.2) {          // ondata improvvisa
      const n = 3 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) this._grido(cheer * smorza, Math.random() * 0.25);
    }
    a.cheerPrev = cheer;

    // pioggia (in galleria non piove; in abitacolo si sente sul tetto)
    const r = rain * (1 - 0.9 * tunnel);
    this._p(A.pioggiaG.gain, 0.2 * Math.pow(r, 0.8), 0.2);
    this._p(A.pioggiaLP.frequency, cockpit ? 3200 : 9000, 0.2);
    this._p(A.pioggiaBassoG.gain, 0.14 * r, 0.2);
    this._p(A.gocceG.gain, r * (cockpit ? 0.9 : 0.45), 0.2);
    this._p(A.gocceLP.frequency, cockpit ? 3000 : 12000, 0.2);

    // riverbero: poco all'aperto, tanto in galleria
    this._p(this._mandaLoop.gain, 0.025 + 0.45 * tunnel, 0.15);
    this._p(this._mandaAvv.gain, 0.03 + 0.4 * tunnel, 0.15);
    this._p(this._mandaSfx.gain, 0.07 + 0.4 * tunnel, 0.15);
  }

  // Un grido sintetico dalla folla: dente di sega con glissando dentro due formanti.
  _grido(intensita, ritardo = 0) {
    const ctx = this._ctx;
    const t = ctx.currentTime + ritardo + Math.random() * 0.05;
    const f = (Math.random() < 0.5 ? 170 : 260) * caso(0.85, 1.15);
    const dur = caso(0.35, 0.95);
    const o = this._o('sawtooth', f);
    o.frequency.setValueAtTime(f * 0.9, t);
    o.frequency.linearRampToValueAtTime(f * caso(1.1, 1.3), t + dur * 0.3);
    o.frequency.linearRampToValueAtTime(f * 0.8, t + dur);
    const f1 = this._f('bandpass', caso(600, 900), 5);
    const f2 = this._f('bandpass', caso(1100, 1600), 7);
    const g2 = this._g(0.6);
    const lp = this._f('lowpass', 3200, 0);
    const g = this._g(0);
    const picco = 0.08 * (0.5 + intensita);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(picco, t + 0.06);
    g.gain.setTargetAtTime(picco * 0.7, t + 0.06, 0.15);
    g.gain.setTargetAtTime(0, t + dur * 0.8, 0.06);
    const pan = this._stereo();
    if (pan.pan) pan.pan.value = caso(-0.8, 0.8);
    o.connect(f1); o.connect(f2); f1.connect(lp); f2.connect(g2); g2.connect(lp);
    lp.connect(g); g.connect(pan); pan.connect(this._busAmb);
    o.start(t); o.stop(t + dur + 0.4);
    this._usaEGetta([o, f1, f2, g2, lp, g, pan], t + dur + 0.4);
  }

  // -------------------------------------------------------------------------
  // Avversari
  // -------------------------------------------------------------------------
  _creaVoce() {
    const v = {};
    v.o1 = this._o('sine', 50);       // onda di carattere della famiglia, a f0/2
    v.o2 = this._o('sawtooth', 100);  // morso a f0
    v.o2g = this._g(0.45);
    v.lp = this._f('lowpass', 1200, 2);
    v.g = this._g(0);
    v.fade = this._g(0);
    v.pan = this._panner();
    v.nbp = this._f('bandpass', 1800, 1.5);
    v.ng = this._g(0);
    v.o1.connect(v.lp); v.o2.connect(v.o2g); v.o2g.connect(v.lp);
    v.lp.connect(v.g); v.g.connect(v.fade);
    this._rumoreAvv.connect(v.nbp); v.nbp.connect(v.ng); v.ng.connect(v.fade);
    v.fade.connect(v.pan); v.pan.connect(this._busAvv);
    this._avvia(v.o1); this._avvia(v.o2);
    v.dPrev = -1; v.vr = 0; v.cyl = 0; v.attiva = false;
    return v;
  }

  _famigliaVoce(v, cyl) {
    v.cyl = cyl;
    const k = chiaveFamiglia(cyl);
    v.F = FAMIGLIE[k];
    v.o1.setPeriodicWave(this._onda(k));
    this._p(v.o2g.gain, k === 12 ? 0.3 : k === 6 ? 0.55 : 0.4, 0.05);
  }

  _aggiornaAvversari(dt, t, cars) {
    const L = this._L;
    const n = Math.min(cars.length, MAX_AVV);
    while (this._voci.length < n) this._voci.push(this._creaVoce());
    for (let i = 0; i < this._voci.length; i++) {
      const v = this._voci[i];
      const c = i < n ? cars[i] : null;
      if (!c || !finito(c.x) || !finito(c.z)) { this._zittisci(v); continue; }
      const cy = num(c.y, 0);
      const dx = c.x - L.x, dy = cy - L.y, dz = c.z - L.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      // velocità radiale (positiva = si allontana), filtrata
      if (v.dPrev >= 0) {
        const vr = clamp((d - v.dPrev) / dt, -90, 90);
        v.vr += (vr - v.vr) * Math.min(1, dt * 8);
      } else v.vr = 0;
      v.dPrev = d;

      const fade = d >= DIST_MAX ? 0 : d > DIST_SFUMA ? (DIST_MAX - d) / (DIST_MAX - DIST_SFUMA) : 1;
      this._p(v.fade.gain, fade, 0.05);
      if (fade <= 0) { v.attiva = false; continue; }   // sospesa: niente aggiornamenti
      this._posPanner(v.pan, c.x, cy, c.z, !v.attiva);
      v.attiva = true;

      const cyl = num(c.cyl, 8);
      if (cyl !== v.cyl) this._famigliaVoce(v, cyl);
      const voce = c.voce || {};
      const base = clamp(num(voce.base, 0.5), 0, 1);
      const thr = clamp(num(c.throttle, 0.5), 0, 1);
      const speed = Math.abs(num(c.speed, 0));
      const rpm = clamp(num(c.rpm, RPM_MIN + speed * 80), 500, 9500);
      const rn = clamp((rpm - RPM_MIN) / (RPM_MAX - RPM_MIN), 0, 1);

      // Doppler approssimato, con detune limitato
      const cent = clamp(1200 * Math.log2(C_SUONO / (C_SUONO + v.vr)), -DOPPLER_MAX_CENT, DOPPLER_MAX_CENT);
      const mul = Math.pow(2, cent / 1200);
      const f0 = (rpm / 60) * cyl / 2 * mul;
      this._p(v.o1.frequency, f0 / 2, 0.02);
      this._p(v.o2.frequency, f0, 0.02);
      let fc = v.F.lp * (500 + 1600 * rn + 2200 * thr) * (0.8 + 0.4 * base);
      fc = clamp(Math.max(fc, f0 * 2), 150, 9000);
      this._p(v.lp.frequency, fc, 0.04);
      this._p(v.g.gain, 0.12 + 0.2 * thr + 0.06 * rn, 0.05);

      const sk = clamp(num(c.skid, 0) / 1.6, 0, 1);
      this._p(v.ng.gain, 0.6 * sk, 0.05);
      this._p(v.nbp.frequency, (1300 + 600 * sk) * mul, 0.05);
    }
  }

  _zittisci(v) {
    this._p(v.fade.gain, 0, 0.05);
    v.dPrev = -1; v.vr = 0; v.attiva = false;
  }

  // -------------------------------------------------------------------------
  // Ascoltatore
  // -------------------------------------------------------------------------
  setListener(x, y, z, yaw) {
    const L = this._L;
    L.x = num(x, L.x); L.y = num(y, L.y); L.z = num(z, L.z); L.yaw = num(yaw, L.yaw);
    if (this._ready) this._applicaAscoltatore();
  }

  _applicaAscoltatore() {
    const li = this._ctx.listener, L = this._L;
    const fx = Math.cos(L.yaw), fz = Math.sin(L.yaw);
    if (li.positionX) {
      const subito = this._ascoltatoreIniziale;
      const set = subito ? (p, v) => this._pSubito(p, v) : (p, v) => this._p(p, v, 0.015);
      set(li.positionX, L.x); set(li.positionY, L.y); set(li.positionZ, L.z);
      set(li.forwardX, fx); set(li.forwardY, 0); set(li.forwardZ, fz);
      set(li.upX, 0); set(li.upY, 1); set(li.upZ, 0);
    } else {
      li.setPosition(L.x, L.y, L.z);
      li.setOrientation(fx, 0, fz, 0, 1, 0);
    }
    this._ascoltatoreIniziale = false;
  }

  // Se la camera si allontana dall'auto del giocatore (replay, camera TV)
  // i suoni dell'auto si spostano e si attenuano come una sorgente qualsiasi.
  _aggiornaPosGiocatore(p) {
    const L = this._L;
    let pan = 0, att = 1;
    if (finito(p.x) && finito(p.z)) {
      const dx = p.x - L.x, dy = num(p.y, L.y) - L.y, dz = p.z - L.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > 4) {
        const rx = -Math.sin(L.yaw), rz = Math.cos(L.yaw);   // destra
        pan = clamp(((dx * rx + dz * rz) / d) * 0.8, -1, 1);
        att = d <= 8 ? 1 : 8 / (8 + 1.2 * (d - 8));
      }
    }
    if (this._panGiocatore.pan) this._p(this._panGiocatore.pan, pan, 0.03);
    this._p(this._attGiocatore.gain, att, 0.03);
  }

  // -------------------------------------------------------------------------
  // Aggiornamento per frame
  // -------------------------------------------------------------------------
  update(dt, st) {
    if (!this._ready || !this._ctx || !st) return;
    const d = clamp(num(dt, 1 / 60), 0.001, 0.1);
    const t = this._ctx.currentTime;
    const p = st.player || {};
    this._m.cockpit = !!st.cockpit;
    try {
      this._aggiornaAmbiente(d, t, st, p);
      if (this._paused) return;      // loop già abbassati: niente scoppi né grida nuove
      this._aggiornaPosGiocatore(p);
      this._aggiornaMotore(d, t, p, st);
      this._aggiornaSuolo(d, t, p, st);
      this._aggiornaAvversari(d, t, Array.isArray(st.cars) ? st.cars : []);
    } catch (e) {
      // l'audio non deve mai far cadere il gioco
      if (!this._erroreSegnalato) { console.error('[audio] update', e); this._erroreSegnalato = true; }
    }
  }

  // -------------------------------------------------------------------------
  // Volume, muto, pausa
  // -------------------------------------------------------------------------
  setMuted(b) {
    this._muted = !!b;
    if (this._ready) this._p(this._muto.gain, this._muted ? 0 : 1, 0.02);
  }
  toggleMute() {
    this.setMuted(!this._muted);
    return this._muted;
  }
  setVolume(v) {
    this._vol = clamp(num(v, 1), 0, 1);
    if (this._ready) this._p(this._master.gain, 0.8 * this._vol, 0.03);
  }
  pause(b) {
    this._paused = !!b;
    if (this._ctx && this._busLoop) this._applicaPausa();
  }
  _applicaPausa() {
    const pa = this._paused;
    this._p(this._busLoop.gain, pa ? 0 : 1, 0.06);
    this._p(this._busAvv.gain, pa ? 0 : 1, 0.06);
    this._p(this._busAmb.gain, pa ? 0.3 : 1, 0.2);
  }

  // -------------------------------------------------------------------------
  // Eventi
  // -------------------------------------------------------------------------
  shift(dir) {
    if (!this._ready) return;
    const t = this._ctx.currentTime;
    const M = this._mot;
    // taglio breve del gas
    const g = M.cambioG.gain;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(dir > 0 ? 0.3 : 0.5, t, 0.008);
    g.setTargetAtTime(1, t + (dir > 0 ? 0.075 : 0.05), 0.03);
    this._clack(t + 0.01);
    if (dir < 0) {
      // doppietta + scoppi
      this._m.blip = DURATA_DOPPIETTA;
      const n = 1 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) this._scoppio(caso(0.4, 0.85), t + 0.09 + i * caso(0.04, 0.08));
    } else if (Math.random() < 0.3) {
      this._scoppio(caso(0.3, 0.5), t + 0.02);
    }
  }

  impact(speed, x, y, z, isPlayer) {
    if (!this._ready) return;
    const ctx = this._ctx;
    const v = clamp(num(speed, 5), 1, 40);
    const s = (v - 1) / 39;
    const t = ctx.currentTime + 0.005;
    const nodi = [];
    const out = this._g(0.25 + 0.4 * Math.pow(s, 0.8));
    nodi.push(out);
    if (!isPlayer && finito(x) && finito(z)) nodi.push(this._pannerEvento(x, num(y, 0), z, this._busSfx));
    out.connect(nodi.length > 1 ? nodi[1] : this._busSfx);
    const durata = 0.4 + 1.1 * s;

    // tonfo grave
    const o = this._o('sine', 100);
    o.frequency.setValueAtTime(120 - 50 * s, t);
    o.frequency.exponentialRampToValueAtTime(34 + 10 * (1 - s), t + 0.18 + 0.25 * s);
    const og = this._g(0);
    this._inv(og.gain, t, 0.003, 0.9, 0.05 + 0.1 * s);
    o.connect(og); og.connect(out); o.start(t); o.stop(t + durata);
    nodi.push(o, og);

    // carrozzeria/plastica: botta di rumore scuro, più chiusa a bassa velocità
    const n1 = this._rumore(this._buf.bianco, t, 0.5);
    const lp1 = this._f('lowpass', 900 + 3000 * s, 1);
    const n1g = this._g(0);
    this._inv(n1g.gain, t, 0.002, 0.6 * (1 - 0.35 * s), 0.02 + 0.06 * s);
    n1.connect(lp1); lp1.connect(n1g); n1g.connect(out);
    nodi.push(n1, lp1, n1g);

    // metallo: modi inarmonici smorzati, più lunghi e forti con la velocità
    const fm = caso(380, 800) * (1 - 0.25 * s);
    const rapporti = [1, 2.31, 3.89, 5.43, 7.12];
    rapporti.forEach((r, i) => {
      const mo = this._o('sine', fm * r * caso(0.98, 1.02));
      const mg = this._g(0);
      this._inv(mg.gain, t, 0.001, (0.16 / Math.sqrt(i + 1)) * (0.2 + 0.8 * s), (0.05 + 0.35 * s) / (1 + i * 0.4));
      mo.connect(mg); mg.connect(out); mo.start(t); mo.stop(t + durata);
      nodi.push(mo, mg);
    });
    const n2 = this._rumore(this._buf.bianco, t, durata);
    const bp2 = this._f('bandpass', caso(2400, 4200), 4);
    const n2g = this._g(0);
    this._inv(n2g.gain, t, 0.002, 0.5 * s, 0.08 + 0.3 * s);
    n2.connect(bp2); bp2.connect(n2g); n2g.connect(out);
    nodi.push(n2, bp2, n2g);

    // detriti negli urti forti
    if (s > 0.4) {
      const c = this._rumore(this._buf.crepitio, t + 0.02, 0.9, caso(0.9, 1.3));
      const hp = this._f('highpass', 2000, 0);
      const cg = this._g(0);
      this._inv(cg.gain, t + 0.02, 0.01, 0.6 * s, 0.2 + 0.3 * s);
      c.connect(hp); hp.connect(cg); cg.connect(out);
      nodi.push(c, hp, cg);
    }
    this._usaEGetta(nodi, t + durata + 0.2);
  }

  scrape(on) {
    this._scrapeOn = !!on;
    if (this._ready && !on) {      // chiude subito anche se update non arriva
      const G = this._gom;
      this._p(G.scG.gain, 0, 0.04); this._p(G.scMetG.gain, 0, 0.04); this._p(G.scCrepG.gain, 0, 0.04);
    }
  }

  // Bip del semaforo / verde.
  _bip(f, dur, vel) {
    const t = this._ctx.currentTime + 0.005;
    const o = this._o('square', f);
    const o2 = this._o('sine', f);
    const lp = this._f('lowpass', f * 4, 0);
    const g = this._g(0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vel, t + 0.004);
    g.gain.setValueAtTime(vel, t + dur);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.03);
    const og = this._g(0.25);
    o.connect(og); og.connect(lp); o2.connect(lp); lp.connect(g); g.connect(this._busUi);
    o.start(t); o2.start(t); o.stop(t + dur + 0.05); o2.stop(t + dur + 0.05);
    this._usaEGetta([o, o2, lp, g, og], t + dur + 0.05);
  }
  beep(n) {
    if (!this._ready) return;
    void n; // stessa nota per tutte e cinque le luci, come ai box veri
    this._bip(440, 0.16, 0.24);
  }
  go() {
    if (!this._ready) return;
    this._bip(880, 0.7, 0.28);
  }

  // Campanella (triangolo + ottava sinusoidale) per il jingle del giro.
  _campanella(f, t, dur, vel, dest) {
    const o = this._o('triangle', f);
    const o2 = this._o('sine', f * 2);
    const g = this._g(0), g2 = this._g(0);
    this._inv(g.gain, t, 0.005, vel, dur * 0.4);
    this._inv(g2.gain, t, 0.003, vel * 0.35, dur * 0.25);
    o.connect(g); o2.connect(g2); g.connect(dest); g2.connect(dest);
    o.start(t); o2.start(t); o.stop(t + dur * 3); o2.stop(t + dur * 3);
    this._usaEGetta([o, o2, g, g2], t + dur * 3);
  }
  lap(best) {
    if (!this._ready) return;
    const t = this._ctx.currentTime + 0.01;
    const note = best ? [76, 79, 83, 88] : [72, 76, 79];
    const passo = best ? 0.075 : 0.09;
    note.forEach((m, i) => {
      const ultima = i === note.length - 1;
      this._campanella(nota(m), t + i * passo, ultima ? 0.5 : 0.18, best ? 0.2 : 0.17, this._busUi);
    });
    if (best) {
      // luccichio: lo stesso arpeggio un'ottava sopra, leggero, e un tintinnio finale
      note.forEach((m, i) => this._campanella(nota(m + 12), t + 0.035 + i * passo, 0.12, 0.05, this._busUi));
      const fine = t + note.length * passo;
      for (let i = 0; i < 6; i++) this._campanella(nota(96 + [0, 4, 7, 12, 7, 4][i]), fine + 0.05 + i * 0.045, 0.08, 0.035, this._busUi);
    }
  }

  // Voce d'ottone per la fanfara: due denti di sega con filtro che si apre e vibrato.
  _ottone(f, t, dur, vel, dest) {
    const o1 = this._o('sawtooth', f), o2 = this._o('sawtooth', f);
    o1.detune.value = -7; o2.detune.value = 7;
    const lfo = this._o('sine', 5.5);
    const lfoG = this._g(0);
    lfoG.gain.setValueAtTime(0, t);
    lfoG.gain.linearRampToValueAtTime(0, t + 0.15);
    lfoG.gain.linearRampToValueAtTime(9, t + 0.35);
    lfo.connect(lfoG); lfoG.connect(o1.detune); lfoG.connect(o2.detune);
    const lp = this._f('lowpass', f * 1.2, 1);
    lp.frequency.setValueAtTime(f * 1.2, t);
    lp.frequency.linearRampToValueAtTime(Math.min(12000, f * 6 + 800 * vel), t + 0.05);
    lp.frequency.setTargetAtTime(f * 3.5, t + 0.05, 0.15);
    lp.frequency.setTargetAtTime(f * 1.2, t + dur, 0.05);
    const g = this._g(0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vel * 0.12, t + 0.03);
    g.gain.setTargetAtTime(vel * 0.09, t + 0.03, 0.1);
    g.gain.setTargetAtTime(0, t + dur, 0.06);
    o1.connect(lp); o2.connect(lp); lp.connect(g); g.connect(dest);
    const fine = t + dur + 0.5;
    for (const o of [o1, o2, lfo]) { o.start(t); o.stop(fine); }
    this._usaEGetta([o1, o2, lfo, lfoG, lp, g], fine);
  }
  _timpano(f, t, vel, dest) {
    const o = this._o('sine', f);
    o.frequency.setValueAtTime(f * 1.15, t);
    o.frequency.exponentialRampToValueAtTime(f * 0.85, t + 0.4);
    const g = this._g(0);
    this._inv(g.gain, t, 0.004, 0.5 * vel, 0.25);
    o.connect(g); g.connect(dest);
    o.start(t); o.stop(t + 1.5);
    const src = this._rumore(this._buf.bianco, t, 0.2);
    const lp = this._f('lowpass', 400, 0);
    const ng = this._g(0);
    this._inv(ng.gain, t, 0.002, 0.25 * vel, 0.03);
    src.connect(lp); lp.connect(ng); ng.connect(dest);
    this._usaEGetta([o, g, src, lp, ng], t + 1.5);
  }
  _piatto(t, vel, dest) {
    const src = this._rumore(this._buf.bianco, t, 2.5);
    const hp = this._f('highpass', 5000, 0);
    const pk = this._f('peaking', 8000, 2); pk.gain.value = 6;
    const g = this._g(0);
    this._inv(g.gain, t, 0.005, 0.15 * vel, 0.55);
    src.connect(hp); hp.connect(pk); pk.connect(g); g.connect(dest);
    this._usaEGetta([src, hp, pk, g], t + 2.5);
  }
  finish(position) {
    if (!this._ready) return;
    const pos = Math.round(num(position, 0));
    const t = this._ctx.currentTime + 0.05;
    const dest = this._g(1);
    dest.connect(this._busUi);
    const verb = this._g(0.25); dest.connect(verb); verb.connect(this._verbIn);
    const accordo = (note, t0, dur, vel) => note.forEach((m) => this._ottone(nota(m), t0, dur, vel, dest));
    let fine;
    if (pos === 1) {
      // «ta-ta-ta-taaa» trionfale, poi salita e accordo finale con piatto e timpani
      const T = 0.12;
      [67, 67, 67].forEach((m, i) => this._ottone(nota(m), t + i * T, T * 0.8, 1, dest));
      accordo([60, 72, 76, 79], t + 3 * T, 0.5, 1);
      this._timpano(nota(36), t + 3 * T, 1, dest);
      const t2 = t + 3 * T + 0.6;
      this._ottone(nota(76), t2, 0.1, 1, dest);
      this._ottone(nota(79), t2 + 0.12, 0.1, 1, dest);
      accordo([60, 72, 76, 79, 84], t2 + 0.24, 1.1, 1.1);
      for (let i = 0; i < 6; i++) this._timpano(nota(i % 2 ? 31 : 36), t2 + 0.24 + i * 0.07, 0.5 + i * 0.08, dest);
      this._piatto(t2 + 0.24, 1, dest);
      for (let i = 0; i < 8; i++) this._campanella(nota(84 + [0, 4, 7, 12, 16, 12, 7, 4][i]), t2 + 0.5 + i * 0.06, 0.1, 0.05, dest);
      fine = t2 + 3;
    } else if (pos === 2 || pos === 3) {
      this._ottone(nota(67), t, 0.12, 0.9, dest);
      this._ottone(nota(72), t + 0.15, 0.12, 0.9, dest);
      accordo([60, 67, 71, 74], t + 0.3, 0.7, 0.9);   // accordo di sol con la tonica sotto: festa contenuta
      this._timpano(nota(43), t + 0.3, 0.7, dest);
      this._piatto(t + 0.3, 0.5, dest);
      fine = t + 2.5;
    } else {
      this._ottone(nota(74), t, 0.12, 0.7, dest);
      accordo([60, 64, 67, 72], t + 0.15, 0.6, 0.7);
      this._timpano(nota(36), t + 0.15, 0.5, dest);
      fine = t + 2;
    }
    this._usaEGetta([dest, verb], fine);
  }

  firework(x, y, z) {
    if (!this._ready) return;
    const ctx = this._ctx;
    const L = this._L;
    const fx = num(x, L.x), fy = num(y, L.y + 40), fz = num(z, L.z);
    const dist = Math.hypot(fx - L.x, fy - L.y, fz - L.z);
    const t = ctx.currentTime + Math.min(dist / C_SUONO, 1.2);   // il suono arriva in ritardo
    const pn = this._pannerEvento(fx, fy, fz, this._busSfx);
    const out = this._g(0.9);
    const verb = this._g(0.5);
    out.connect(pn); out.connect(verb); verb.connect(this._verbIn);
    const nodi = [pn, out, verb];

    // scoppio
    const b = this._rumore(this._buf.bianco, t, 0.8);
    const blp = this._f('lowpass', 2500, 0.5);
    blp.frequency.setValueAtTime(2500, t);
    blp.frequency.exponentialRampToValueAtTime(220, t + 0.4);
    const bg = this._g(0);
    this._inv(bg.gain, t, 0.003, 0.8, 0.12);
    b.connect(blp); blp.connect(bg); bg.connect(out);
    const o = this._o('sine', 70);
    o.frequency.setValueAtTime(75, t);
    o.frequency.exponentialRampToValueAtTime(32, t + 0.5);
    const og = this._g(0);
    this._inv(og.gain, t, 0.003, 0.7, 0.18);
    o.connect(og); og.connect(out); o.start(t); o.stop(t + 1.2);
    nodi.push(b, blp, bg, o, og);

    // coda: rombo che si allontana
    const c = this._rumore(this._buf.rosa, t, 2.8);
    const clp = this._f('lowpass', 420, 0);
    const cg = this._g(0);
    this._inv(cg.gain, t + 0.02, 0.05, 0.35, 0.7);
    c.connect(clp); clp.connect(cg); cg.connect(out);
    nodi.push(c, clp, cg);

    // crepitio delle stelline
    const t2 = t + caso(0.25, 0.45);
    const cr = this._rumore(this._buf.crepitio, t2, 2.2, caso(0.9, 1.4));
    const chp = this._f('highpass', 1800, 0);
    const crg = this._g(0);
    crg.gain.setValueAtTime(0, t2);
    crg.gain.linearRampToValueAtTime(0.55, t2 + 0.08);
    crg.gain.setTargetAtTime(0, t2 + 0.4, 0.45);
    cr.connect(chp); chp.connect(crg); crg.connect(out);
    nodi.push(cr, chp, crg);
    this._usaEGetta(nodi, t2 + 2.4);
  }

  ui() {
    if (!this._ready) return;
    const t = this._ctx.currentTime + 0.002;
    const o = this._o('square', 1600);
    o.frequency.setValueAtTime(1700, t);
    o.frequency.exponentialRampToValueAtTime(900, t + 0.03);
    const lp = this._f('lowpass', 4000, 0);
    const g = this._g(0);
    this._inv(g.gain, t, 0.001, 0.09, 0.012);
    o.connect(lp); lp.connect(g); g.connect(this._busUi);
    o.start(t); o.stop(t + 0.1);
    const src = this._rumore(this._buf.bianco, t, 0.03);
    const hp = this._f('highpass', 4000, 0);
    const ng = this._g(0);
    this._inv(ng.gain, t, 0.0005, 0.12, 0.004);
    src.connect(hp); hp.connect(ng); ng.connect(this._busUi);
    this._usaEGetta([o, lp, g, src, hp, ng], t + 0.1);
  }

  // -------------------------------------------------------------------------
  dispose() {
    this._ready = false;
    for (const s of this._sorgenti) { try { s.stop(); } catch { /* già ferma */ } }
    const ctx = this._ctx;
    this._ctx = null;
    this._azzera();
    if (ctx && ctx.close) { try { ctx.close().catch(() => {}); } catch { /* niente */ } }
  }
}

