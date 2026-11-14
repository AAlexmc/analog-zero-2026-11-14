import test from 'node:test';
import assert from 'node:assert/strict';
import { sombras } from '../terreno/calculo.js';
import { muestrasSol, solLocal, centroRecorte, inclinar, luz, acumular, fraccion } from '../../pipeline/validacion_sombras/agregar.mjs';

const cerca = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} vs ${b}`);

test('sun samples: 72 longitudes × 18 arcsine latitudes, symmetric, mean δ² = ε²/2', () => {
  const s = muestrasSol({ pasoAz: 5, fases: 36, oblicuidad: 1.54 });
  assert.equal(s.length, 72 * 18);
  const lats = [...new Set(s.map((p) => p.lat.toFixed(9)))];
  assert.equal(lats.length, 18);
  const media = s.reduce((t, p) => t + p.lat, 0) / s.length;
  cerca(media, 0, 1e-12);
  cerca(s.reduce((t, p) => t + p.lat * p.lat, 0) / s.length, 1.54 * 1.54 / 2, 1e-12);
  cerca(Math.max(...s.map((p) => p.lat)), 1.54 * Math.sin(85 * Math.PI / 180), 1e-12);
  assert.deepEqual([...new Set(s.map((p) => p.lon))].slice(0, 3), [0, 5, 10]);
});

test('at the south pole the sun azimuth is the subsolar longitude and the elevation is −δ', () => {
  for (const [lon, lat] of [[0, -1], [90, 0.5], [275, -1.2]]) {
    const r = solLocal(-90, 0, lon, lat);
    cerca(r.az, lon, 1e-9);
    cerca(r.el, -lat, 1e-9);
  }
});

test('1° off the pole toward lon 0 the sun over lon 0 is 1° higher and over lon 180 1° lower', () => {
  const a = solLocal(-89, 0, 0, 0), b = solLocal(-89, 0, 180, 0), c = solLocal(-89, 0, 90, 0);
  cerca(a.el, 1, 1e-9); cerca(a.az, 0, 1e-9);
  cerca(b.el, -1, 1e-9); cerca(b.az, 180, 1e-9);
  cerca(c.el, 0, 1e-9); cerca(c.az, 90, 1e-9);
});

test('crop centre from the real georef of polo_sur and shackleton', () => {
  const p = centroRecorte({ radio_m: 1737400, x0_m: -149926.7578125, y0_m: 149926.7578125 }, 2048, 146.484375);
  cerca(p.lat, -90, 1e-9);
  const s = centroRecorte({ radio_m: 1737400, x0_m: -12290.224988163274, y0_m: 13577.745714175984 }, 1024, 39.0625);
  cerca(s.lat, -89.67, 1e-6);
  cerca(s.lon, 129.78, 1e-6);
});

function relieve(n) {
  const a = new Float32Array(n * n);
  for (let f = 0; f < n; f++) for (let c = 0; c < n; c++) {
    a[f * n + c] = 40 * Math.sin(c / 7) * Math.cos(f / 11) + 25 * Math.sin((c + 2 * f) / 5) + 0.3 * c;
  }
  return a;
}

test('tilting the terrain toward the sun and using elevation 0 reproduces sombras() at positive elevation', () => {
  const n = 128, m = 10, a = relieve(n);
  for (const az of [0, 37, 90, 200, 315]) for (const el of [0.5, 3, 10]) {
    const r = sombras(a, n, m, az, el), t = sombras(inclinar(a, n, m, az, el), n, m, az, 0);
    let igual = 0, sombra = 0;
    for (let i = 0; i < r.length; i++) { if (r[i] === t[i]) igual++; if (r[i] === 0) sombra++; }
    assert.ok(sombra > 0, `az ${az} el ${el} has shadow`);
    assert.ok(igual / r.length >= 0.99, `az ${az} el ${el}: ${(100 * igual / r.length).toFixed(2)}%`);
  }
});

test('a flat plane with the sun below it is dark except the sunward edge row; sombras() alone clamps it to lit', () => {
  const n = 16, m = 100, a = new Float32Array(n * n).fill(0);
  assert.ok(sombras(a, n, m, 0, -1).every((v) => v === 255), 'sombras clamps negative elevation to 0');
  const s = luz(a, n, m, 0, -1);
  for (let c = 0; c < n; c++) assert.equal(s[c], 255, 'row 0 has nothing upstream');
  for (let i = n; i < n * n; i++) assert.equal(s[i], 0);
});

test('aggregation by hand: one sun above and one below a flat plane → 1/2 inside, 1 on the sunward edge, NaN stays NaN', () => {
  const n = 8, m = 100, a = new Float32Array(n * n).fill(0);
  a[5 * n + 5] = NaN;
  const cuenta = new Uint16Array(n * n);
  acumular(a, n, m, [{ az: 0, el: 1 }, { az: 0, el: -1 }], cuenta);
  const fr = fraccion(cuenta, 2, a);
  assert.equal(fr[0 * n + 3], 1);
  assert.equal(fr[3 * n + 3], 0.5);
  assert.ok(Number.isNaN(fr[5 * n + 5]));
});
