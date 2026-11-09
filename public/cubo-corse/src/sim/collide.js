// Urti fra auto: ogni auto = 5 cerchi lungo l'asse (fianchi quasi diritti). Impulso con rimbalzo minimo,
// attrito di strisciamento e rotazione contenuta: le auto si toccano e si strusciano, non schizzano via.

const OFFS = [-1.36, -0.68, 0, 0.68, 1.36];
const RAD = 0.97;
const E = 0.05;        // rimbalzo (prima 0.2)
const MU = 0.35;       // attrito fra le carrozzerie
const SPIN = 0.35;     // quota dell'impulso che diventa rotazione (prima 0.6)

export function collideCars(cars, impacts) {
  const n = cars.length;
  for (let a = 0; a < n; a++) {
    const A = cars[a];
    if (A.ghost > 0) continue;
    for (let b = a + 1; b < n; b++) {
      const B = cars[b];
      if (B.ghost > 0) continue;
      const dx0 = B.x - A.x, dz0 = B.z - A.z;
      if (dx0 * dx0 + dz0 * dz0 > 36) continue;
      if (Math.abs(A.y - B.y) > 2.5) continue;
      const ca = Math.cos(A.yaw), sa = Math.sin(A.yaw), cb = Math.cos(B.yaw), sb = Math.sin(B.yaw);
      let hit = null, best = 0;
      for (const oa of OFFS)
        for (const ob of OFFS) {
          const ax = A.x + ca * oa, az = A.z + sa * oa;
          const bx = B.x + cb * ob, bz = B.z + sb * ob;
          const dx = bx - ax, dz = bz - az;
          const d = Math.hypot(dx, dz);
          const pen = 2 * RAD - d;
          if (pen > best) {
            best = pen;
            hit = { ax, az, bx, bz, nx: d > 1e-4 ? dx / d : 1, nz: d > 1e-4 ? dz / d : 0, oa, ob };
          }
        }
      if (!hit) continue;
      const { nx, nz } = hit;
      // separa
      A.x -= nx * best * 0.5; A.z -= nz * best * 0.5;
      B.x += nx * best * 0.5; B.z += nz * best * 0.5;
      // punto di contatto e bracci
      const px = (hit.ax + hit.bx) / 2, pz = (hit.az + hit.bz) / 2;
      const rax = px - A.x, raz = pz - A.z, rbx = px - B.x, rbz = pz - B.z;
      // velocità dei punti (ω × r con ω sull'asse y; yaw>0 ruota x verso z)
      const avx = A.vx - A.r * raz, avz = A.vz + A.r * rax;
      const bvx = B.vx - B.r * rbz, bvz = B.vz + B.r * rbx;
      const vrel = (bvx - avx) * nx + (bvz - avz) * nz;
      if (vrel >= 0) continue;
      const raxn = rax * nz - raz * nx, rbxn = rbx * nz - rbz * nx;
      const mA = A.spec.mass, mB = B.spec.mass;
      const k = 1 / mA + 1 / mB + (raxn * raxn) / A.Iz + (rbxn * rbxn) / B.Iz;
      const j = (-(1 + E) * vrel) / k;
      // attrito: frena lo scorrimento tangenziale fra i due punti di contatto (limite di Coulomb)
      const tx = -nz, tz = nx;
      const vt = (bvx - avx) * tx + (bvz - avz) * tz;
      const jt = Math.max(-MU * j, Math.min(MU * j, -vt / (1 / mA + 1 / mB) * 0.5));
      const jx = nx * j + tx * jt, jz = nz * j + tz * jt;
      A.setWorldVel(A.vx - jx / mA, A.vz - jz / mA);
      B.setWorldVel(B.vx + jx / mB, B.vz + jz / mB);
      // momento: r × J (componente y) con convenzione yaw
      A.r += ((rax * -jz - raz * -jx) / A.Iz) * SPIN;
      B.r += ((rbx * jz - rbz * jx) / B.Iz) * SPIN;
      if (-vrel > 1) {
        impacts.push({ type: 'auto', speed: -vrel, oa: hit.oa, ob: hit.ob, x: px, z: pz, y: (A.y + B.y) / 2 + 0.5, a: A, b: B, nx, nz });
      }
    }
  }
}
