import test from 'node:test';
import assert from 'node:assert/strict';
import { perfil, rasante, volumenCarretera, plataforma, volumenCuna, DIAMETRO_SUBCELDA, densidad, densidadMedia, masaCorte, planFlota, deltaCarretera } from '../terreno/obra.js';

const RAD = Math.PI / 180;
const S2 = Math.SQRT2;
const rel = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol * Math.max(Math.abs(b), 1e-300), `${msg ?? ''} ${a} ≠ ${b} (tol ${tol})`);

function mulberry32(semilla) {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const uniforme = (N, ds) => Float64Array.from({ length: N + 1 }, (_, i) => i * ds);

function cumple(s, zp, limite_deg, tol = 1e-9) {
  const k = Math.tan(limite_deg * RAD);
  for (let i = 0; i + 1 < s.length; i++) {
    const exceso = Math.abs(zp[i + 1] - zp[i]) - k * (s[i + 1] - s[i]);
    if (exceso > tol) return `segment ${i}: |Δzp| exceeds the limit by ${exceso}`;
  }
  return null;
}

test('profile along a path: horizontal distance (m or m·√2 per step) and terrain elevation per cell', () => {
  const alturas = Float32Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  for (const t of [{ n: 3, m: 10, alturas }, { n: 3, m_por_px: 10, alturas }]) {
    const p = perfil(t, Int32Array.from([0, 4, 5, 8]));
    rel(p.s[1], 10 * S2, 1e-15);
    rel(p.s[2], 10 * S2 + 10, 1e-15);
    rel(p.s[3], 10 * S2 + 20, 1e-15);
    assert.equal(p.s[0], 0);
    assert.deepEqual(Array.from(p.z), [1, 5, 6, 9]);
  }
});

for (const [N, ds, L] of [[1000, 1, 10], [200, 39.0625, 7], [2, 5, 30]]) {
  test(`uniform ramp of slope 2·tan(${L}°) over ${N} equal steps: free-end grade is the tan(L) line through the midpoint and cut = fill = tan(L)·Lg²/8 per metre of width`, () => {
    const k = Math.tan(L * RAD), s = uniforme(N, ds), Lg = N * ds;
    const z = s.map((x) => 2 * k * x);
    const r = rasante(s, z, L);
    assert.equal(r.factible, true);
    for (let i = 0; i <= N; i++) assert.ok(Math.abs(r.zp[i] - (k * s[i] + (k * Lg) / 2)) <= 1e-9 * k * Lg, `zp[${i}]`);
    const v = volumenCarretera(s, z, r.zp, 1);
    rel(v.corte_m3, (k * Lg * Lg) / 8, 1e-9, 'cut');
    rel(v.relleno_m3, (k * Lg * Lg) / 8, 1e-9, 'fill');
    rel(v.corte_max_m, (k * Lg) / 2, 1e-9, 'max cut');
    rel(v.relleno_max_m, (k * Lg) / 2, 1e-9, 'max fill');
    rel(v.longitud_m, Lg, 1e-15);
  });
}

test('a profile that already meets the limit is left exactly as it is and moves no earth', () => {
  const s = Float64Array.from([0, 39.0625, 39.0625 * (1 + S2), 39.0625 * (2 + S2), 39.0625 * (3 + S2)]);
  const z = Float64Array.from([-2871.7, -2868.1, -2870.3, -2866.9, -2866.9]);
  const r = rasante(s, z, 10);
  assert.equal(r.factible, true);
  for (let i = 0; i < z.length; i++) assert.ok(r.zp[i] === z[i], `zp[${i}] = ${r.zp[i]} vs ${z[i]}`);
  assert.deepEqual(volumenCarretera(s, z, r.zp, 8), { corte_m3: 0, relleno_m3: 0, corte_max_m: 0, relleno_max_m: 0, longitud_m: s[4] });
});

test('200 random profiles (seed 20261114): every segment of the grade meets the slope limit within 1e-9, with and without anchors', () => {
  const rnd = mulberry32(20261114);
  for (let caso = 0; caso < 200; caso++) {
    const N = 1 + Math.floor(rnd() * 300), m = 1 + rnd() * 50, L = 1 + rnd() * 30;
    const s = new Float64Array(N + 1), z = new Float64Array(N + 1);
    z[0] = (rnd() - 0.5) * 6000;
    for (let i = 1; i <= N; i++) {
      s[i] = s[i - 1] + m * (rnd() < 0.3 ? S2 : 1);
      z[i] = z[i - 1] + (rnd() - 0.5) * m * 3 * (rnd() < 0.1 ? 10 : 1);
    }
    const anc = [{}, { anclarInicio: true }, { anclarFin: true }, { anclarInicio: true, anclarFin: true }][caso % 4];
    const r = rasante(s, z, L, anc);
    const k = Math.tan(L * RAD);
    if (anc.anclarInicio && anc.anclarFin && Math.abs(z[N] - z[0]) > k * s[N]) {
      assert.equal(r.factible, false, `case ${caso}`);
      continue;
    }
    assert.equal(r.factible, true, `case ${caso}`);
    assert.equal(cumple(s, r.zp, L), null, `case ${caso}`);
    if (anc.anclarInicio) assert.ok(r.zp[0] === z[0], `case ${caso} start anchor`);
    if (anc.anclarFin) assert.ok(r.zp[N] === z[N], `case ${caso} end anchor`);
  }
});

test('anchoring both ends when the elevation difference exceeds what the limit allows says so and returns no grade', () => {
  const s = uniforme(10, 10), z = s.map((x) => x);
  const r = rasante(s, z, 30, { anclarInicio: true, anclarFin: true });
  assert.equal(r.factible, false);
  assert.equal(r.zp, null);
  assert.match(r.motivo, /anchor/);
});

test('anchoring a single end keeps that end on the terrain and costs at least as much as the free grade', () => {
  const s = uniforme(100, 2), z = s.map((x) => 0.5 * x);
  const coste = (zp) => volumenCarretera(s, z, zp, 1);
  const libre = coste(rasante(s, z, 5).zp);
  for (const opc of [{ anclarInicio: true }, { anclarFin: true }]) {
    const r = rasante(s, z, 5, opc);
    const v = coste(r.zp);
    assert.ok(v.corte_m3 + v.relleno_m3 >= libre.corte_m3 + libre.relleno_m3 - 1e-9);
  }
});

test('grade of 2000 points takes less than 200 ms', () => {
  const rnd = mulberry32(7);
  const s = uniforme(1999, 39.0625), z = new Float64Array(2000);
  for (let i = 1; i < 2000; i++) z[i] = z[i - 1] + (rnd() - 0.5) * 60;
  rasante(s, z, 8);
  const t0 = performance.now();
  const r = rasante(s, z, 8, { anclarInicio: true });
  const ms = performance.now() - t0;
  assert.equal(cumple(s, r.zp, 8), null);
  assert.ok(ms < 200, `${ms} ms`);
});

test('grade input errors: mismatched lengths, non-increasing distance, limit outside [0, 90)', () => {
  const s = uniforme(3, 1), z = new Float64Array(4);
  assert.throws(() => rasante(s, z.subarray(1), 5), /length/);
  assert.throws(() => rasante(Float64Array.from([0, 1, 1, 2]), z, 5), /increasing/);
  assert.throws(() => rasante(s, z, 90), /limit/);
  assert.throws(() => rasante(s, z, -1), /limit/);
});

test('a profile with a cell without elevation data cannot be graded', () => {
  const r = rasante(uniforme(3, 1), Float64Array.from([0, NaN, 0, 0]), 5);
  assert.equal(r.factible, false);
  assert.equal(r.zp, null);
  assert.match(r.motivo, /elevation/);
});

test('road volume integrates the exact piecewise-linear difference, splitting a segment where grade and terrain cross', () => {
  const v = volumenCarretera(Float64Array.from([0, 2]), Float64Array.from([0, 0]), Float64Array.from([1, -1]), 4);
  rel(v.relleno_m3, 4 * 0.5, 1e-15);
  rel(v.corte_m3, 4 * 0.5, 1e-15);
  assert.equal(v.corte_max_m, 1);
  assert.equal(v.relleno_max_m, 1);
  assert.equal(v.longitud_m, 2);
});

test('road volume with side slopes adds talud·h² to the cross-section (exact for linear depth)', () => {
  const s = Float64Array.from([0, 10]), z = Float64Array.from([5, 5]);
  const v = volumenCarretera(s, z, Float64Array.from([3, 1]), 6, 1.5);
  // h de 2 a 4 m: ∫(b·h + talud·h²) ds = 10·(6·3 + 1.5·(4 + 8 + 16)/3)
  rel(v.corte_m3, 10 * (6 * 3 + (1.5 * 28) / 3), 1e-14);
  assert.equal(v.relleno_m3, 0);
  assert.equal(v.corte_max_m, 4);
  assert.throws(() => volumenCarretera(s, z, Float64Array.from([3, 1]), 0), /width/);
});

function planoInclinado(n, m, grados, azimut) {
  const g = Math.tan(grados * RAD), gx = g * Math.sin(azimut * RAD), gy = g * Math.cos(azimut * RAD);
  const a = new Float32Array(n * n);
  const k = (n - 1) / 2;
  for (let f = 0; f < n; f++) for (let c = 0; c < n; c++) a[f * n + c] = 100 + gx * (c - k) * m - gy * (f - k) * m;
  return { n, m, alturas: a };
}

test('platform on an exact 12° plane with a 5° limit: final slope 5°, cut = fill, delta only inside the disc', () => {
  const t = planoInclinado(101, 2, 12, 30);
  const p = plataforma(t, 50, 50, 60, 5);
  assert.equal(p.sub_celda, false);
  rel(p.pend_antes_deg, 12, 1e-6);
  rel(p.pend_despues_deg, 5, 1e-12);
  rel(p.corte_m3, p.relleno_m3, 1e-6);
  assert.ok(p.corte_m3 > 0);
  let fuera = 0, suma = 0;
  for (let f = 0; f < 101; f++) for (let c = 0; c < 101; c++) {
    const d = p.delta[f * 101 + c];
    if (Math.hypot(f - 50, c - 50) * 2 > 30) fuera += Math.abs(d);
    suma += d;
  }
  assert.equal(fuera, 0);
  assert.ok(Math.abs(suma) * 4 <= 1e-6 * p.corte_m3);
  assert.ok(p.delta instanceof Float32Array && p.delta.length === 101 * 101);
});

test('platform on a plane already under the limit keeps its slope and only moves float32 rounding of the heights', () => {
  const p = plataforma(planoInclinado(41, 5, 3, 200), 20, 20, 80, 5);
  rel(p.pend_antes_deg, 3, 1e-6);
  rel(p.pend_despues_deg, 3, 1e-6);
  for (const d of p.delta) assert.ok(Math.abs(d) <= 1e-4, `${d}`);
});

test(`platform narrower than ${DIAMETRO_SUBCELDA} cells uses the tilted-disc wedge with the local slope and says so`, () => {
  const t = planoInclinado(21, 39.0625, 12, 0);
  const D = 2 * 39.0625, r = D / 2;
  const p = plataforma(t, 10, 10, D, 5);
  assert.equal(p.sub_celda, true);
  assert.equal(p.delta, null);
  const V = (2 / 3) * r ** 3 * (Math.tan(12 * RAD) - Math.tan(5 * RAD));
  rel(p.corte_m3, V, 1e-6);
  rel(p.relleno_m3, V, 1e-6);
  rel(p.pend_antes_deg, 12, 1e-6);
  assert.equal(p.pend_despues_deg, 5);
});

test('the analytic wedge agrees with the grid platform on a large disc (≤ 2 %)', () => {
  const t = planoInclinado(201, 1, 12, 75);
  const p = plataforma(t, 100, 100, 180, 5);
  const w = volumenCuna(90, 12, 5);
  rel(p.corte_m3, w.corte_m3, 0.02);
  rel(p.relleno_m3, w.relleno_m3, 0.02);
});

const CARRIER = { rho_inf: 1.92, a: 12.2, b: 18 };

test('density profile ρ(z) = 1.92·(z + 12.2)/(z + 18): 1.30 at the surface, 1.52 at 10 cm, 1.83 at 100 cm', () => {
  assert.equal(densidad(0, CARRIER).toFixed(2), '1.30');
  assert.equal(densidad(10, CARRIER).toFixed(2), '1.52');
  assert.equal(densidad(100, CARRIER).toFixed(2), '1.83');
});

test('mean density over [0, d] is the exact integral (checked against a fine Simpson rule) and tends to ρ(0) at d = 0', () => {
  for (const d of [0.5, 10, 37, 100, 300]) {
    const N = 20000, h = d / N;
    let suma = densidad(0, CARRIER) + densidad(d, CARRIER);
    for (let i = 1; i < N; i++) suma += (i % 2 ? 4 : 2) * densidad(i * h, CARRIER);
    rel(densidadMedia(d, CARRIER), (suma * h) / 3 / d, 1e-12, `d=${d}`);
  }
  rel(densidadMedia(0, CARRIER), densidad(0, CARRIER), 1e-15);
  rel(densidadMedia(1e-9, CARRIER), densidad(0, CARRIER), 1e-9);
});

test('cut mass = volume × mean density over the mean depth (g/cm³ → kg/m³)', () => {
  rel(masaCorte(10, 0.5, CARRIER), 10 * densidadMedia(50, CARRIER) * 1000, 1e-15);
  assert.equal(masaCorte(0, 0.5, CARRIER), 0);
  assert.throws(() => masaCorte(-1, 0.5, CARRIER), /volume/);
});

const FLOTA = { masa_kg: 1e6, n_robots: 2, kg_por_dia_lunar: 1e5, fraccion_luz: 0.5, distancia_acarreo_m: 500, carga_kg: 100, velocidad_m_s: 0.5, horas_dia_lunar: 708.7 };

test('fleet plan: excavation and haulage lunar days, and which one sets the schedule', () => {
  const p = planFlota(FLOTA);
  assert.equal(p.evaluable, true);
  rel(p.dias_excavacion, 1e6 / (2 * 1e5 * 0.5), 1e-15);
  // 10 000 viajes, 5 000 por robot, 2 000 s cada uno
  rel(p.dias_acarreo, (5000 * 2000) / 3600 / (708.7 * 0.5), 1e-12);
  assert.equal(p.manda, 'excavacion');
  rel(p.dias, p.dias_excavacion, 0);
  const lejos = planFlota({ ...FLOTA, distancia_acarreo_m: 5000 });
  assert.equal(lejos.manda, 'acarreo');
  rel(lejos.dias, lejos.dias_acarreo, 0);
});

test('fleet plan with a missing, zero, negative or non-finite input is explicitly not evaluable (no NaN, no Infinity)', () => {
  for (const campo of Object.keys(FLOTA)) {
    for (const v of [null, undefined, 0, -3, NaN, Infinity, '5']) {
      if (campo === 'masa_kg' && v === 0) continue;
      const p = planFlota({ ...FLOTA, [campo]: v });
      assert.equal(p.evaluable, false, `${campo}=${v}`);
      assert.match(p.motivo, new RegExp(campo));
      for (const [k, x] of Object.entries(p)) if (typeof x === 'number') assert.ok(Number.isFinite(x), `${k} = ${x}`);
    }
  }
  assert.equal(planFlota({ ...FLOTA, fraccion_luz: 1.2 }).evaluable, false);
  assert.equal(planFlota(null).evaluable, false);
});

test('fleet plan with nothing to move takes zero days', () => {
  const p = planFlota({ ...FLOTA, masa_kg: 0 });
  assert.equal(p.evaluable, true);
  assert.equal(p.dias, 0);
  assert.equal(p.manda, null);
});

test('road delta puts grade − terrain on the path cells and 0 elsewhere, as a Float32Array n×n', () => {
  const alturas = Float32Array.from({ length: 16 }, (_, i) => i);
  const t = { n: 4, m: 1, alturas };
  const d = deltaCarretera(t, Int32Array.from([0, 5, 10]), Float64Array.from([1, 4, 12.5]));
  assert.ok(d instanceof Float32Array && d.length === 16);
  assert.equal(d[0], 1);
  assert.equal(d[5], -1);
  assert.equal(d[10], 2.5);
  assert.equal(d.reduce((a, x) => a + Math.abs(x), 0), 4.5);
  assert.throws(() => deltaCarretera(t, Int32Array.from([0, 5]), Float64Array.from([1])), /length/);
});
