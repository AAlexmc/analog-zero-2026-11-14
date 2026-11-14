import test from 'node:test';
import assert from 'node:assert/strict';
import { transformadaDistancia, topsis, zonaApta, sugerir } from '../terreno/reparto.js';
import { evaluarRequisito } from '../terreno/evaluar.js';

const cerca = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} ≠ ${b}`);
const req = (variable, op, valor, extra = {}) => ({ variable, op, valor, unidad: 'deg', texto: 't', fuente: 'https://x', cita: 'c', verificado: true, ...extra });

test('distance transform gives the exact Euclidean distance in metres to the nearest marked cell', () => {
  const n = 5, mk = new Uint8Array(n * n);
  mk[0] = 1; mk[4 * n + 4] = 1;
  const d = transformadaDistancia(mk, n, 10);
  assert.equal(d[0], 0);
  cerca(d[1], 10);
  cerca(d[2 * n + 2], 10 * Math.hypot(2, 2));
  cerca(d[4 * n + 0], 40);
  cerca(d[3 * n + 1], 10 * Math.hypot(3, 1));
});

test('distance transform equals brute force on a random 23×23 mask', () => {
  let s = 7;
  const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);
  const n = 23, mk = new Uint8Array(n * n).map(() => (rnd() < 0.04 ? 1 : 0));
  const d = transformadaDistancia(mk, n, 3);
  for (let i = 0; i < n * n; i++) {
    let b = Infinity;
    for (let j = 0; j < n * n; j++) if (mk[j]) b = Math.min(b, Math.hypot(Math.floor(i / n) - Math.floor(j / n), (i % n) - (j % n)) * 3);
    cerca(d[i], b, 1e-5);
  }
});

test('distance transform without any marked cell is Infinity everywhere', () => {
  const d = transformadaDistancia(new Uint8Array(9), 3, 1);
  assert.ok(d.every((x) => x === Infinity));
});

test('TOPSIS with three alternatives and two criteria matches the hand calculation', () => {
  // Criterio 1 (beneficio): 3, 4, 0; criterio 2 (coste): 4, 3, 0; pesos 1:1.
  // Normalizados: c1 = [0.6, 0.8, 0], c2 = [0.8, 0.6, 0]; ponderados ×0.5.
  // Ideal = (0.4, 0); anti = (0, 0.4).
  // A: S+ = √(0.1²+0.4²) = √0.17, S− = √(0.3²+0) = 0.3 → C = 0.3/(0.3+√0.17).
  // B: S+ = √(0+0.3²) = 0.3, S− = √(0.4²+0.1²) = √0.17 → C = √0.17/(0.3+√0.17).
  // C: S+ = 0.4, S− = 0.4 → C = 0.5.
  const X = Float64Array.from([3, 4, 4, 3, 0, 0]);
  const c = topsis(X, 3, [1, 1], [true, false]);
  const r = Math.sqrt(0.17);
  cerca(c[0], 0.3 / (0.3 + r));
  cerca(c[1], r / (0.3 + r));
  cerca(c[2], 0.5);
});

test('TOPSIS weights are normalised: doubling all weights changes nothing', () => {
  const X = Float64Array.from([1, 9, 2, 5, 7, 1, 3, 3]);
  const a = topsis(X, 4, [1, 2], [true, false]), b = topsis(X, 4, [2, 4], [true, false]);
  a.forEach((v, i) => cerca(v, b[i]));
});

function terreno(n, pend, capas = {}) {
  return { n, m: 100, alturas: new Float32Array(n * n), pend, capas };
}

test('suitable zone keeps cells within every measurable limit and agrees with the sheet verdict cell by cell', () => {
  const n = 4, pend = Float32Array.from({ length: 16 }, (_, i) => i);
  const tmax = Float32Array.from({ length: 16 }, (_, i) => 280 + 3 * i);
  tmax[3] = NaN;
  const eq = { requisitos: [req('pendiente_deg', '<=', 10), req('temp_k', '<=', 300, { unidad: 'K' }), req('horas_en_sombra', '<=', 50, { unidad: 'h' })] };
  const z = zonaApta(terreno(n, pend, { temp_max: tmax }), eq, { plantados: [] });
  for (let i = 0; i < 16; i++) {
    const med = { pendiente_deg: { valor: pend[i] }, temp_k: { max: { valor: Number.isFinite(tmax[i]) ? tmax[i] : null }, min: { valor: null } } };
    const okHoja = eq.requisitos.slice(0, 2).every((r) => evaluarRequisito(r, med).estado === 'ok');
    assert.equal(z.mascara[i] === 1, okHoja, `cell ${i}`);
  }
  assert.equal(z.celdas, 6);
  assert.deepEqual(z.aplicados.map((a) => a.req.variable), ['pendiente_deg', 'temp_k']);
  assert.match(z.omitidos[0].motivo, /needs a route/);
});

test('a lower temperature limit with only a maximum-temperature layer only drops cells whose maximum is already too cold', () => {
  const n = 2, pend = new Float32Array(4);
  const tmax = Float32Array.from([30, 50, 100, 39.9]);
  const z = zonaApta(terreno(n, pend, { temp_max: tmax }), { requisitos: [req('temp_k', '>=', 40, { unidad: 'K' })] }, { plantados: [] });
  assert.deepEqual(Array.from(z.mascara), [0, 1, 1, 0]);
  assert.match(z.aplicados[0].como, /only/);
});

test('separation from a planted reference is applied only when that reference is planted', () => {
  const n = 5, pend = new Float32Array(25);
  const eq = { requisitos: [req('separacion_m', '>=', 250, { unidad: 'm', respecto_a: 'habitat' })] };
  const sin = zonaApta(terreno(n, pend), eq, { plantados: [] });
  assert.equal(sin.mascara, null);
  assert.match(sin.omitidos[0].motivo, /plant/);
  const con = zonaApta(terreno(n, pend), eq, { plantados: [{ uid: 1, equipo: 'habitat', fila: 2, col: 2 }] });
  // 100 m/px: celdas a ≥ 2,5 celdas del centro.
  for (let f = 0; f < n; f++) for (let c = 0; c < n; c++) assert.equal(con.mascara[f * n + c] === 1, Math.hypot(f - 2, c - 2) * 100 >= 250);
});

test('equipment without a measurable requirement gives no zone and says so', () => {
  const z = zonaApta(terreno(2, new Float32Array(4)), { requisitos: [req('separacion_m', '>=', null, { respecto_a: 'h' })] }, { plantados: [] });
  assert.equal(z.mascara, null);
  assert.equal(z.aplicados.length, 0);
});

test('no-data cells are never suitable', () => {
  const pend = Float32Array.from([1, NaN, 1, 1]);
  const z = zonaApta(terreno(2, pend), { requisitos: [req('pendiente_deg', '<=', 5)] }, { plantados: [] });
  assert.deepEqual(Array.from(z.mascara), [1, 0, 1, 1]);
});

test('suggested sites are the best TOPSIS cells inside the zone, at least the minimum spacing apart', () => {
  const n = 10, m = 100, mk = new Uint8Array(n * n).fill(1);
  mk[0] = 0;
  const ilu = Float32Array.from({ length: n * n }, (_, i) => i / (n * n));
  const pend = new Float32Array(n * n).fill(1);
  const s = sugerir({ n, m, mascara: mk, criterios: [{ id: 'ilu', valores: ilu, beneficio: true, peso: 1 }, { id: 'pend', valores: pend, beneficio: false, peso: 1 }], N: 3, separacion_m: 250 });
  assert.equal(s.length, 3);
  assert.equal(s[0].i, n * n - 1);
  for (let a = 0; a < s.length; a++) for (let b = a + 1; b < s.length; b++) assert.ok(Math.hypot(s[a].fila - s[b].fila, s[a].col - s[b].col) * m >= 250);
  assert.ok(s[0].puntuacion >= s[1].puntuacion && s[1].puntuacion >= s[2].puntuacion);
  cerca(s[0].valores.ilu, ilu[n * n - 1]);
});

test('cells with no value in an active criterion are not suggested', () => {
  const n = 3, mk = new Uint8Array(9).fill(1);
  const v = Float32Array.from([NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, 5]);
  const s = sugerir({ n, m: 1000, mascara: mk, criterios: [{ id: 'x', valores: v, beneficio: true, peso: 1 }], N: 5, separacion_m: 1000 });
  assert.deepEqual(s.map((x) => x.i), [8]);
});

test('a lower temperature limit with only a max layer is applied only in part and the zone share is an upper bound', () => {
  const n = 2, pend = new Float32Array(4);
  const tmax = Float32Array.from([30, 50, 200, 39.9]);
  const eq = { requisitos: [req('temp_k', '>=', 40, { unidad: 'K' })] };
  const z = zonaApta(terreno(n, pend, { temp_max: tmax }), eq, { plantados: [] });
  assert.equal(z.aplicados[0].parcial, true);
  assert.equal(z.cotaSuperior, true);
  const hoja = evaluarRequisito(eq.requisitos[0], { temp_k: { max: { valor: 200, capa: 'temp_max' }, min: { valor: null, motivo: 'no min' } } });
  assert.equal(hoja.estado, 'no_medido');
  const z2 = zonaApta(terreno(n, pend, { temp_max: tmax, temp_min: tmax }), eq, { plantados: [] });
  assert.equal(z2.cotaSuperior, false);
  assert.ok(!z2.aplicados[0].parcial);
});

test('water cells (class 1-3) are never suitable; no water data (NaN) does not exclude; the count of cells removed is returned', () => {
  const n = 3, pend = new Float32Array(9);
  // 0 tierra, 1 océano, 2 lago, 3 río, NaN = 255 sin dato (forma de datos.js).
  const agua = Float32Array.from([0, 1, 2, 3, NaN, 0, 0, 0, 2]);
  const eq = { requisitos: [req('pendiente_deg', '<=', 5)] };
  const z = zonaApta(terreno(n, pend, { agua }), eq, { plantados: [] });
  assert.deepEqual(Array.from(z.mascara), [1, 0, 0, 0, 1, 1, 1, 1, 0]);
  assert.equal(z.celdas, 5);
  assert.equal(z.agua.celdas, 4);
  // Solo cuenta las celdas que la exclusión quita: el agua que ya fallaba la pendiente no.
  pend[1] = 30;
  const z2 = zonaApta(terreno(n, pend, { agua }), eq, { plantados: [] });
  assert.equal(z2.agua.celdas, 3);
});

test('water is excluded for every equipment, also one whose only measurable requirement is a separation', () => {
  const n = 3, pend = new Float32Array(9), agua = new Float32Array(9);
  agua[4] = 2;
  const eq = { requisitos: [req('separacion_m', '>=', 0, { unidad: 'm', respecto_a: 'habitat' })] };
  const z = zonaApta(terreno(n, pend, { agua }), eq, { plantados: [{ uid: 1, equipo: 'habitat', fila: 0, col: 0 }] });
  assert.equal(z.mascara[4], 0);
  assert.equal(z.celdas, 8);
});

test('a terrain without a water layer gives exactly the same zone as before and no water exclusion', () => {
  const n = 2, pend = Float32Array.from([1, 9, 1, 1]);
  const z = zonaApta(terreno(n, pend), { requisitos: [req('pendiente_deg', '<=', 5)] }, { plantados: [] });
  assert.deepEqual(Array.from(z.mascara), [1, 0, 1, 1]);
  assert.equal(z.agua, null);
});

test('suggested landing sites never fall on water even when the water is the flattest ground', () => {
  const n = 20, m = 100, pend = new Float32Array(n * n).fill(3), agua = new Float32Array(n * n);
  // Mar llano (pendiente 0) en la mitad de arriba, como en Haughton.
  for (let i = 0; i < n * n / 2; i++) { pend[i] = 0; agua[i] = 1; }
  const z = zonaApta(terreno(n, pend, { agua }), { requisitos: [req('pendiente_deg', '<=', 5)] }, { plantados: [] });
  const s = sugerir({ n, m, mascara: z.mascara, criterios: [{ id: 'pendiente', valores: pend, beneficio: false, peso: 1 }], N: 5, separacion_m: 300 });
  assert.equal(s.length, 5);
  for (const x of s) assert.equal(agua[x.i], 0, `S at ${x.fila},${x.col} is on water`);
});
