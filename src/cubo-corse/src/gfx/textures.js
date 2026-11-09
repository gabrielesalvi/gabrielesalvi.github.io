// Texture procedurali (canvas): asfalto, erba, ghiaia, marciapiede, rete, acqua, bagliori.
import * as THREE from 'three';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}
function rnd(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
function tex(c, { repeat = true, srgb = true, nearest = false, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (nearest) { t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestMipmapLinearFilter; }
  t.anisotropy = aniso;
  return t;
}

/** asfalto: albedo + mappa ruvidità (G = ruvidità asciutta, B = maschera pozzanghere) */
export function asphaltTextures() {
  const N = 512;
  const r = rnd(7);
  const [c, g] = canvas(N, N);
  g.fillStyle = '#3a3b3e'; g.fillRect(0, 0, N, N);
  const img = g.getImageData(0, 0, N, N);
  for (let i = 0; i < N * N; i++) {
    const n = (r() - 0.5) * 26 + (r() < 0.03 ? 30 : 0) - (r() < 0.02 ? 20 : 0);
    img.data[i * 4] += n; img.data[i * 4 + 1] += n; img.data[i * 4 + 2] += n + 1;
  }
  g.putImageData(img, 0, 0);
  // rattoppi e crepe leggere
  for (let k = 0; k < 14; k++) {
    g.fillStyle = `rgba(${r() < 0.5 ? '20,20,22' : '70,70,72'},${0.12 + r() * 0.12})`;
    const x = r() * N, y = r() * N, w = 20 + r() * 80, h = 10 + r() * 50;
    g.fillRect(x, y, w, h);
  }
  const albedo = tex(c);
  // ruvidità + pozzanghere
  const [c2, g2] = canvas(256, 256);
  const im2 = g2.createImageData(256, 256);
  const r2 = rnd(11);
  // rumore a blob per pozzanghere
  const blobs = [];
  for (let k = 0; k < 9; k++) blobs.push([r2() * 256, r2() * 256, 12 + r2() * 30]);
  for (let y = 0; y < 256; y++)
    for (let x = 0; x < 256; x++) {
      const i = (y * 256 + x) * 4;
      let p = 0;
      for (const [bx, by, br] of blobs) {
        const dx = Math.min(Math.abs(x - bx), 256 - Math.abs(x - bx)), dy = Math.min(Math.abs(y - by), 256 - Math.abs(y - by));
        p = Math.max(p, 1 - Math.hypot(dx, dy * 1.6) / br);
      }
      im2.data[i] = 255;
      im2.data[i + 1] = 200 + r2() * 55;
      im2.data[i + 2] = Math.max(0, Math.min(255, p * 400));
      im2.data[i + 3] = 255;
    }
  g2.putImageData(im2, 0, 0);
  const rough = tex(c2, { srgb: false });
  return { albedo, rough };
}

/** texture "pixel" per superfici fuori pista */
export function pixelTexture(kind) {
  const N = 32;
  const [c, g] = canvas(N, N);
  const r = rnd(kind.length * 97 + 3);
  const P = {
    erba: [[74, 124, 52], [86, 138, 58], [66, 112, 46], [98, 146, 64], [80, 118, 50]],
    ghiaia: [[196, 178, 140], [184, 166, 128], [206, 190, 152], [170, 152, 118], [214, 200, 166]],
    fuga: [[88, 90, 94], [96, 98, 102], [80, 82, 86], [104, 106, 110]],
    marciapiede: [[196, 188, 172], [182, 174, 158], [206, 198, 182], [170, 162, 148]],
    terra: [[120, 92, 64], [132, 102, 70], [110, 84, 58]],
    sabbia: [[220, 206, 170], [210, 196, 160], [228, 216, 184]],
  }[kind];
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      let col = P[Math.floor(r() * P.length)];
      if (kind === 'marciapiede' && (x % 8 === 0 || y % 8 === 0)) col = [150, 144, 132];
      g.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`;
      g.fillRect(x, y, 1, 1);
    }
  return tex(c, { nearest: true, aniso: 4 });
}

/** rete metallica (alpha) per le reti di protezione */
export function fenceTexture() {
  const N = 64;
  const [c, g] = canvas(N, N);
  g.clearRect(0, 0, N, N);
  g.strokeStyle = 'rgba(200,205,210,1)';
  g.lineWidth = 2;
  for (let k = -N; k < N * 2; k += 8) {
    g.beginPath(); g.moveTo(k, 0); g.lineTo(k + N, N); g.stroke();
    g.beginPath(); g.moveTo(k, N); g.lineTo(k + N, 0); g.stroke();
  }
  return tex(c, { srgb: true });
}

/** mappa normale per l'acqua (onde tileabili) */
export function waterNormal() {
  const N = 256;
  const [c, g] = canvas(N, N);
  const img = g.createImageData(N, N);
  const waves = [];
  const r = rnd(5);
  for (let k = 0; k < 7; k++) waves.push([1 + Math.floor(r() * 5), 1 + Math.floor(r() * 5), r() * 6.28, 0.3 + r() * 0.7]);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      let dx = 0, dy = 0;
      for (const [fx, fy, ph, a] of waves) {
        const t = ((x * fx + y * fy) / N) * 6.2832 + ph;
        dx += Math.cos(t) * fx * a;
        dy += Math.cos(t) * fy * a;
      }
      const i = (y * N + x) * 4;
      img.data[i] = 128 + dx * 9;
      img.data[i + 1] = 128 + dy * 9;
      img.data[i + 2] = 255;
      img.data[i + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  return tex(c, { srgb: false });
}

/** bagliore radiale (pozze di luce, alone dei fari) */
export function glowTexture() {
  const N = 128;
  const [c, g] = canvas(N, N);
  const gr = g.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, N, N);
  return tex(c, { repeat: false });
}

/** cono di luce dei fari sull'asfalto (allungato) */
export function beamTexture() {
  const W = 64, H = 128;
  const [c, g] = canvas(W, H);
  const img = g.createImageData(W, H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const v = 1 - y / H; // 0 vicino all'auto, 1 lontano (la riga 0 del canvas è v=1)
      const spread = 0.15 + v * 0.85;
      const u = Math.abs(x / W - 0.5) * 2 / spread;
      const a = Math.max(0, 1 - u * u) * Math.pow(1 - v, 0.6) * Math.min(1, v * 6);
      const i = (y * W + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = a * 255;
    }
  g.putImageData(img, 0, 0);
  return tex(c, { repeat: false });
}

/** scacchi per la linea del traguardo */
export function checkerTexture() {
  const [c, g] = canvas(16, 4);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 16; x++) {
    g.fillStyle = (x + y) % 2 ? '#111' : '#f4f4f4';
    g.fillRect(x, y, 1, 1);
  }
  return tex(c, { nearest: true, repeat: false });
}

/** stelle (cielo notturno) */
export function starsPoints(count = 2500, radius = 3000) {
  const pos = new Float32Array(count * 3), col = new Float32Array(count * 3);
  const r = rnd(3);
  for (let i = 0; i < count; i++) {
    const u = r() * 2 - 1, th = r() * Math.PI * 2;
    const y = Math.abs(u) * 0.95 + 0.05;
    const rr = Math.sqrt(1 - y * y);
    pos[i * 3] = Math.cos(th) * rr * radius; pos[i * 3 + 1] = y * radius; pos[i * 3 + 2] = Math.sin(th) * rr * radius;
    const b = 0.4 + r() * 0.6;
    col[i * 3] = b; col[i * 3 + 1] = b; col[i * 3 + 2] = b * (0.9 + r() * 0.2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return new THREE.Points(geo, new THREE.PointsMaterial({ size: 2.2, sizeAttenuation: false, vertexColors: true, transparent: true, depthWrite: false, fog: false }));
}
