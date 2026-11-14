import test from 'node:test';
import assert from 'node:assert/strict';
import { rango, pendienteGrados, alturaBilineal, sombras, sobrePlanoTangente, intersectarRayo, pixelAMundo, rumboHorizonte } from '../terreno/calculo.js';

const RAD = Math.PI / 180;
const cerca = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} vs ${b}`);

function rampa(n, m, grados) {
  const a = new Float32Array(n * n), t = Math.tan(grados * RAD);
  for (let f = 0; f < n; f++) for (let c = 0; c < n; c++) a[f * n + c] = 500 + c * m * t;
  return a;
}

test('range ignores NaN and reports the no-data fraction', () => {
  const r = rango(Float32Array.from([3, NaN, -2, 7]));
  assert.deepEqual([r.min, r.max, r.nan], [-2, 7, 0.25]);
});

test('slope of a 10° ramp reads 10° in the interior and on the edges', () => {
  const a = rampa(9, 20, 10);
  cerca(pendienteGrados(a, 9, 20, 4, 4), 10, 1e-3);
  cerca(pendienteGrados(a, 9, 20, 0, 0), 10, 1e-3);
  cerca(pendienteGrados(a, 9, 20, 8, 8), 10, 1e-3);
});

test('slope next to a NaN gap falls back to the one-sided difference', () => {
  const a = rampa(9, 20, 30);
  a[4 * 9 + 5] = NaN;
  cerca(pendienteGrados(a, 9, 20, 4, 4), 30, 1e-3);
  assert.ok(Number.isNaN(pendienteGrados(a, 9, 20, 4, 5)));
});

test('bilinear height interpolates between cell centres', () => {
  const a = Float32Array.from([0, 10, 20, 30]);
  cerca(alturaBilineal(a, 2, 0.5, 0.5), 15, 1e-9);
  cerca(alturaBilineal(a, 2, 0, 0.25), 2.5, 1e-9);
});

test('flat ground under a low sun is fully lit', () => {
  const n = 32, a = new Float32Array(n * n).fill(100);
  const s = sombras(a, n, 10, 37, 1.5);
  assert.ok(s.every((v) => v === 255));
});

function pilar(n, h) {
  const a = new Float32Array(n * n);
  a[(n / 2) * n + n / 2] = h;
  return a;
}

test('a pillar casts a shadow of length h / tan(elevation) away from the sun', () => {
  const n = 64, m = 10, el = 45;
  const a = pilar(n, 100);
  const s = sombras(a, n, m, 0, el);
  const c = n / 2;
  assert.equal(s[(c - 3) * n + c], 255, 'sun side is lit');
  for (let k = 1; k <= 9; k++) assert.equal(s[(c + k) * n + c], 0, `shadow ${k} cells south`);
  assert.equal(s[(c + 11) * n + c], 255, 'beyond 100 m it is lit again');
});

test('shadow direction follows the sun azimuth (east sun → shadow to the west)', () => {
  const n = 64, c = 32;
  const s = sombras(pilar(n, 100), n, 10, 90, 30);
  assert.equal(s[c * n + c - 5], 0);
  assert.equal(s[c * n + c + 5], 255);
  const w = sombras(pilar(n, 100), n, 10, 225, 30);
  assert.equal(w[(c - 4) * n + c + 4], 0, 'south-west sun → shadow to the north-east');
});

test('sun at the zenith casts no shadows', () => {
  const n = 16, a = pilar(n, 500);
  assert.ok(sombras(a, n, 10, 0, 90).every((v) => v === 255));
});

test('NaN cells never cast shadows', () => {
  const n = 16, a = new Float32Array(n * n);
  a[8 * n + 8] = NaN;
  const s = sombras(a, n, 10, 0, 1);
  assert.equal(s[9 * n + 8], 255);
});

function bruto(a, n, m, az, el) {
  const dc = Math.sin(az * RAD), df = -Math.cos(az * RAD), t = Math.tan(el * RAD);
  const out = new Uint8Array(n * n);
  for (let f = 0; f < n; f++) for (let c = 0; c < n; c++) {
    const h0 = a[f * n + c];
    let lit = 255;
    for (let k = 0.25; ; k += 0.25) {
      const ff = f + df * k, cc = c + dc * k;
      if (ff < 0 || cc < 0 || ff > n - 1 || cc > n - 1) break;
      if (alturaBilineal(a, n, ff, cc) > h0 + k * m * t + 0.01) { lit = 0; break; }
    }
    out[f * n + c] = lit;
  }
  return out;
}

test('shadow sweep agrees with brute-force ray marching on rough terrain (≥97% cells)', () => {
  const n = 96, m = 20, a = new Float32Array(n * n);
  for (let f = 0; f < n; f++) for (let c = 0; c < n; c++) {
    a[f * n + c] = 300 * Math.sin(f / 9) * Math.cos(c / 7) + 120 * Math.sin((f + 2 * c) / 4) + 0.02 * ((f * 7919 + c * 104729) % 97);
  }
  for (const [az, el] of [[20, 1.5], [135, 5], [260, 10], [300, 3]]) {
    const r = sombras(a, n, m, az, el), b = bruto(a, n, m, az, el);
    let igual = 0, sombra = 0;
    for (let i = 0; i < r.length; i++) { if (r[i] === b[i]) igual++; if (b[i] === 0) sombra++; }
    assert.ok(sombra > n * n * 0.05, `test terrain has shadows at az ${az}`);
    assert.ok(igual / r.length >= 0.97, `az ${az} el ${el}: ${(100 * igual / r.length).toFixed(1)}%`);
  }
});

test('a ray straight down hits the cell below at the displayed height', () => {
  const n = 11, a = new Float32Array(n * n).fill(1500);
  const geo = { alturas: a, n, mkm: 0.1, zc: 1000, exag: 2 };
  const p = pixelAMundo(geo, 3, 7);
  const hit = intersectarRayo(geo, [p.x, 50, p.z], [0, -1, 0]);
  cerca(hit.fila, 3, 1e-6); cerca(hit.col, 7, 1e-6);
  cerca(hit.y, 1.0, 1e-4);
});

test('an oblique ray hits a ramp where the ray height equals the terrain height', () => {
  const n = 41, m = 25, a = rampa(n, m, 20);
  const geo = { alturas: a, n, mkm: m / 1000, zc: 500, exag: 1 };
  const d = [0.6, -0.5, 0.2], L = Math.hypot(...d);
  const hit = intersectarRayo(geo, [-0.4, 0.6, -0.3], d.map((v) => v / L));
  assert.ok(hit);
  cerca(hit.y, (alturaBilineal(a, n, hit.fila, hit.col) - 500) / 1000, 1e-4);
});

test('a ray that misses the terrain returns null', () => {
  const n = 11, geo = { alturas: new Float32Array(n * n), n, mkm: 0.1, zc: 0, exag: 1 };
  assert.equal(intersectarRayo(geo, [0, 5, 0], [0, 1, 0]), null);
  assert.equal(intersectarRayo(geo, [50, 5, 0], [0, -1, 0]), null);
});

test('a ray over a NaN gap passes through it', () => {
  const n = 11, a = new Float32Array(n * n);
  a[5 * n + 5] = NaN;
  const geo = { alturas: a, n, mkm: 0.1, zc: 0, exag: 1 };
  assert.equal(intersectarRayo(geo, [0, 5, 0], [0, -1, 0]), null);
});

test('on a sphere the shadow of a 400 m pillar at 1.5° sun reaches 19.4 km, not the 15.3 km of a flat plane', () => {
  const n = 501, m = 100, R = 1737400, k = 250;
  const a = new Float32Array(n * n);
  a[k * n + k] = 400;
  const largo = (s) => { let c = k - 1; while (c >= 0 && s[k * n + c] === 0) c--; return (k - 1 - c) * m; };
  const plano = largo(sombras(a, n, m, 90, 1.5));
  const esfera = largo(sombras(sobrePlanoTangente(a, n, m, R), n, m, 90, 1.5));
  assert.ok(Math.abs(plano - 15275) <= 200, `flat ${plano}`);
  assert.ok(Math.abs(esfera - 19420) <= 300, `sphere ${esfera}`);
});

test('a wall on the sun side shades the whole far edge at 0°, 90°, 180° and 270° alike', () => {
  const n = 50, m = 10;
  for (const [az, muro] of [[0, (k) => k], [90, (k) => k * n + n - 1], [180, (k) => (n - 1) * n + k], [270, (k) => k * n]]) {
    const a = new Float32Array(n * n);
    for (let k = 0; k < n; k++) a[muro(k)] = 1000;
    const s = sombras(a, n, m, az, 1);
    let lit = 0;
    for (let f = 0; f < n; f++) for (let c = 0; c < n; c++) if (a[f * n + c] === 0 && s[f * n + c] === 255) lit++;
    assert.equal(lit, 0, `sun at ${az}°: ${lit} ground cells lit`);
  }
});

test('bilinear height on an exact valid cell next to a NaN row is that cell, not NaN', () => {
  const n = 64, a = new Float32Array(n * n).fill(100);
  for (let c = 0; c < n; c++) a[10 * n + c] = NaN;
  assert.equal(alturaBilineal(a, n, 9, 20), 100);
  assert.equal(alturaBilineal(a, n, 11, 20), 100);
  assert.equal(alturaBilineal(a, n, 9, 20.5), 100);
  assert.ok(Number.isNaN(alturaBilineal(a, n, 9.4, 20)), 'a NaN neighbour with weight > 0 still gives NaN');
  assert.ok(Number.isNaN(alturaBilineal(a, n, 10, 20)));
});

test('ground view heading: the bearing where the terrain rises most above the ground under the eye', () => {
  const n = 101, m = 10, k = 50;
  // Llano con una loma al este (columnas altas): el horizonte más alto está a 90°.
  const a = new Float32Array(n * n).fill(100);
  for (let f = 0; f < n; f++) for (let c = 80; c < n; c++) a[f * n + c] = 160;
  const r = rumboHorizonte(a, n, m, k, k, 72);
  assert.equal(r.rumbo_deg, 90);
  cerca(r.angulo_deg, Math.atan2(60, 30 * m) / RAD, 1e-6, 'angle to the near edge of the hill');
  // La misma loma al suroeste: 225°.
  const b = new Float32Array(n * n).fill(100);
  for (let f = 0; f < n; f++) for (let c = 0; c < n; c++) if (f - k > 20 && k - c > 20) b[f * n + c] = 160;
  assert.equal(rumboHorizonte(b, n, m, k, k, 72).rumbo_deg, 225);
  // Llano: todos iguales (también los rayos más largos de las diagonales) → el primero (norte); sin dato bajo el ojo → null; NaN en el camino no cuenta.
  assert.equal(rumboHorizonte(new Float32Array(n * n).fill(5), n, m, k, k).rumbo_deg, 0);
  const c = Float32Array.from(a); c[k * n + k] = NaN;
  assert.equal(rumboHorizonte(c, n, m, k, k), null);
  const d = Float32Array.from(a);
  for (let f = 0; f < n; f++) d[f * n + 90] = NaN;
  assert.equal(rumboHorizonte(d, n, m, k, k).rumbo_deg, 90);
});
