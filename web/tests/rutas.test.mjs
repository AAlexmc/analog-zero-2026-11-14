import test from 'node:test';
import assert from 'node:assert/strict';
import { pendientes, caminoMinimo, umbralMinimo, medirRuta, ordenOptimo, matrizCostes, velocidadCatalogo, vehiculos, diezmar, velocidadEfectiva, horasEnSombra, aRejillaCompleta, celdasSobreLimite } from '../terreno/rutas.js';
import { evaluarRequisito } from '../terreno/evaluar.js';
import { perfil, rasante, deltaCarretera } from '../terreno/obra.js';

const S2 = Math.SQRT2;
const plano = (n, h = 0) => new Float32Array(n * n).fill(h);
const idx = (n, f, c) => f * n + c;
const celdas = (n, camino) => Array.from(camino, (i) => [Math.floor(i / n), i % n]);
const cerca = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} ≠ ${b}`);

// 5×5 plano; columna 2 es muro (90°) salvo la fila 4, que es el paso.
function muroConPaso(pasoDeg = 0) {
  const n = 5, pend = new Float32Array(n * n);
  for (let f = 0; f < 4; f++) pend[idx(n, f, 2)] = 90;
  pend[idx(n, 4, 2)] = pasoDeg;
  return { n, m: 10, alturas: plano(n), pend };
}

test('route through a 5×5 grid with a wall goes through the only gap and costs 4 + 4√2 cells', () => {
  const t = muroConPaso();
  const r = caminoMinimo(t, idx(5, 0, 0), idx(5, 0, 4), { limite: 20 });
  cerca(r.coste, 10 * (4 + 4 * S2));
  const cs = celdas(5, r.camino);
  assert.deepEqual(cs[0], [0, 0]);
  assert.deepEqual(cs.at(-1), [0, 4]);
  assert.ok(cs.some(([f, c]) => f === 4 && c === 2), 'path crosses the gap');
  assert.ok(!cs.some(([f, c]) => c === 2 && f < 4), 'path never enters the wall');
});

test('a cell whose slope is exactly the limit is passable; just above it is not', () => {
  const enLimite = caminoMinimo(muroConPaso(20), idx(5, 0, 0), idx(5, 0, 4), { limite: 20 });
  assert.ok(Number.isFinite(enLimite.coste));
  const encima = caminoMinimo(muroConPaso(20.0001), idx(5, 0, 0), idx(5, 0, 4), { limite: 20 });
  assert.equal(encima.coste, Infinity);
  assert.equal(encima.camino, null);
});

test('without a route, the minimum slope that connects is the steepest cell of the best path', () => {
  const t = muroConPaso(27);
  t.pend[idx(5, 0, 2)] = 31;
  assert.equal(caminoMinimo(t, idx(5, 0, 0), idx(5, 0, 4), { limite: 20 }).coste, Infinity);
  cerca(umbralMinimo(t, idx(5, 0, 0), idx(5, 0, 4)), 27, 1e-6);
  t.pend[idx(5, 0, 0)] = 33;
  cerca(umbralMinimo(t, idx(5, 0, 0), idx(5, 0, 4)), 33, 1e-6);
});

test('an origin steeper than the limit has no route', () => {
  const t = muroConPaso();
  t.pend[0] = 25;
  assert.equal(caminoMinimo(t, 0, idx(5, 0, 1), { limite: 20 }).coste, Infinity);
});

test('step cost is the 3D distance: a 3-4-5 step along a ramp', () => {
  const n = 3, a = new Float32Array(n * n);
  for (let f = 0; f < n; f++) for (let c = 0; c < n; c++) a[idx(n, f, c)] = 4 * c;
  const t = { n, m: 3, alturas: a, pend: new Float32Array(n * n) };
  cerca(caminoMinimo(t, idx(n, 1, 0), idx(n, 1, 2), { limite: 20 }).coste, 10);
});

test('permanent-shadow penalty averages the factor of both cells of a step and makes the route detour', () => {
  const n = 3, sombra = new Float32Array(n * n);
  sombra[idx(n, 1, 1)] = 1;
  const t = { n, m: 1, alturas: plano(n), pend: new Float32Array(n * n), sombra };
  const recto = caminoMinimo(t, idx(n, 1, 0), idx(n, 1, 2), { limite: 20, factorSombra: 1 });
  cerca(recto.coste, 2);
  const conPena = caminoMinimo(t, idx(n, 1, 0), idx(n, 1, 2), { limite: 20, factorSombra: 3 });
  cerca(conPena.coste, 2 * S2);
  assert.ok(!Array.from(conPena.camino).includes(idx(n, 1, 1)));
  const leve = caminoMinimo(t, idx(n, 1, 0), idx(n, 1, 2), { limite: 20, factorSombra: 1.2 });
  cerca(leve.coste, 2 * (1 + 1.2) / 2);
});

test('no-data cells are never crossed', () => {
  const n = 3, a = plano(n);
  a[idx(n, 0, 1)] = NaN; a[idx(n, 1, 1)] = NaN; a[idx(n, 2, 1)] = NaN;
  const t = { n, m: 1, alturas: a, pend: pendientes(a, n, 1) };
  assert.equal(caminoMinimo(t, idx(n, 1, 0), idx(n, 1, 2), { limite: 90 }).coste, Infinity);
});

test('A* returns the same cost as exhaustive relaxation on a random grid', () => {
  let s = 12345;
  const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);
  const n = 14, a = new Float32Array(n * n).map(() => rnd() * 30);
  const pend = pendientes(a, n, 20);
  const sombra = new Float32Array(n * n).map(() => (rnd() < 0.3 ? 1 : 0));
  const t = { n, m: 20, alturas: a, pend, sombra };
  const opc = { limite: 40, factorSombra: 2.5 };
  const pasa = (i) => Number.isFinite(a[i]) && pend[i] <= opc.limite;
  const w = (i) => (sombra[i] === 1 ? opc.factorSombra : 1);
  for (const [o, d] of [[0, n * n - 1], [idx(n, 3, 10), idx(n, 12, 1)], [idx(n, 7, 7), idx(n, 0, 13)]]) {
    const dist = new Float64Array(n * n).fill(Infinity);
    if (pasa(o)) dist[o] = 0;
    for (let it = 0; it < n * n; it++) {
      let cambio = false;
      for (let i = 0; i < n * n; i++) {
        if (!Number.isFinite(dist[i])) continue;
        const f = Math.floor(i / n), c = i % n;
        for (let df = -1; df <= 1; df++) for (let dc = -1; dc <= 1; dc++) {
          if (!df && !dc) continue;
          const ff = f + df, cc = c + dc;
          if (ff < 0 || cc < 0 || ff >= n || cc >= n) continue;
          const j = ff * n + cc;
          if (!pasa(j)) continue;
          const L = Math.hypot(df, dc) * 20, dh = a[j] - a[i];
          const v = dist[i] + Math.sqrt(L * L + dh * dh) * (w(i) + w(j)) / 2;
          if (v < dist[j] - 1e-12) { dist[j] = v; cambio = true; }
        }
      }
      if (!cambio) break;
    }
    const r = caminoMinimo(t, o, d, opc);
    if (!Number.isFinite(dist[d])) assert.equal(r.coste, Infinity);
    else cerca(r.coste, dist[d], 1e-9);
  }
});

test('route measures: length, climb, steepest cell, shadow km and longest shadow stretch', () => {
  // Fila 0 de una rejilla 1×5 a 10 m/px; alturas 0, 0, 10, 10, 0; sombra en las celdas 2 y 3.
  const n = 5, a = plano(n), sombra = new Float32Array(n * n), pend = new Float32Array(n * n);
  [0, 0, 10, 10, 0].forEach((h, c) => { a[c] = h; });
  sombra[2] = 1; sombra[3] = 1;
  [1, 2, 3, 4, 5].forEach((p, c) => { pend[c] = p; });
  const m = medirRuta({ n, m: 10, alturas: a, pend, sombra }, Int32Array.from([0, 1, 2, 3, 4]));
  const diag = Math.hypot(10, 10);
  cerca(m.longitud_m, 10 + diag + 10 + diag);
  cerca(m.subida_m, 10);
  cerca(m.bajada_m, 10);
  cerca(m.pendMax, 5);
  cerca(m.pendP95, 5);
  // Cada paso reparte su longitud a medias entre sus dos celdas.
  cerca(m.sombra_m, diag / 2 + 10 + diag / 2);
  cerca(m.sombraTramoMax_m, diag / 2 + 10 + diag / 2);
  cerca(m.sombraFrac, m.sombra_m / m.longitud_m);
});

test('route measures without a shadow layer report shadow as not measured (null), never zero', () => {
  const n = 3;
  const m = medirRuta({ n, m: 1, alturas: plano(n), pend: new Float32Array(n * n) }, Int32Array.from([0, 1, 2]));
  assert.equal(m.sombra_m, null);
  assert.equal(m.sombraTramoMax_m, null);
  assert.equal(m.sombraFrac, null);
});

test('optimal round trip over 4 stops given out of order is the square perimeter', () => {
  const p = [[0, 0], [1, 1], [0, 1], [1, 0]];
  const M = p.map((a) => p.map((b) => Math.hypot(a[0] - b[0], a[1] - b[1])));
  const r = ordenOptimo(M);
  cerca(r.coste, 4);
  assert.equal(r.orden[0], 0);
  assert.equal(r.orden.length, 4);
  for (let k = 0; k < 4; k++) cerca(M[r.orden[k]][r.orden[(k + 1) % 4]], 1);
});

test('optimal order is exact against brute force on 7 asymmetric-looking stops', () => {
  const p = [[0, 0], [5, 1], [2, 7], [9, 3], [4, 4], [8, 8], [1, 9]];
  const M = p.map((a) => p.map((b) => Math.hypot(a[0] - b[0], a[1] - b[1])));
  let mejor = Infinity;
  const perm = (resto, ult, c) => {
    if (!resto.length) { mejor = Math.min(mejor, c + M[ult][0]); return; }
    resto.forEach((x, k) => perm(resto.filter((_, j) => j !== k), x, c + M[ult][x]));
  };
  perm([1, 2, 3, 4, 5, 6], 0, 0);
  cerca(ordenOptimo(M).coste, mejor);
});

test('round trip with an unreachable stop has no order', () => {
  const M = [[0, 1, Infinity], [1, 0, Infinity], [Infinity, Infinity, 0]];
  assert.equal(ordenOptimo(M), null);
});

test('pairwise cost matrix is symmetric on flat ground and keeps each path', () => {
  const n = 6, t = { n, m: 1, alturas: plano(n), pend: new Float32Array(n * n) };
  const pts = [idx(n, 0, 0), idx(n, 5, 5), idx(n, 0, 5)];
  const r = matrizCostes(t, pts, { limite: 20 });
  cerca(r.M[0][1], 5 * S2);
  cerca(r.M[1][0], 5 * S2);
  cerca(r.M[0][2], 5);
  assert.equal(r.caminos[0][2][0], pts[0]);
  assert.equal(r.caminos[0][2].at(-1), pts[2]);
});

test('speed for times only comes from a verified catalogue top or nominal speed, converted to km/h', () => {
  const ltv = { cifras: [{ nombre: 'velocidad_max_kmh', valor: 10, unidad: 'km/h', fuente: 'https://x', verificado: true }] };
  assert.deepEqual(velocidadCatalogo(ltv).kmh, 10);
  assert.equal(velocidadCatalogo(ltv).tipo, 'top');
  const viper = { cifras: [{ nombre: 'velocidad_efectiva_cm_s', valor: 0.8, unidad: 'cm/s', fuente: 'https://x', verificado: true }, { nombre: 'velocidad_max_cm_s', valor: 20, unidad: 'cm/s', fuente: 'https://x', verificado: true }] };
  cerca(velocidadCatalogo(viper).kmh, 0.72);
  const ipex = { cifras: [{ nombre: 'velocidad_nominal_cm_s', valor: 30, unidad: 'cm/s', fuente: 'https://x', verificado: true }] };
  assert.equal(velocidadCatalogo(ipex).tipo, 'nominal');
  assert.equal(velocidadCatalogo({ cifras: [{ nombre: 'velocidad_max', valor: null, texto: 'not public' }] }), null);
  assert.equal(velocidadCatalogo({ cifras: [{ nombre: 'velocidad_max_kmh', valor: 10, unidad: 'km/h', fuente: 'https://x', verificado: false }] }), null);
  assert.equal(velocidadCatalogo({ cifras: [{ nombre: 'pegasus_velocidad_mph', valor: 9, unidad: 'mph', op: '>', fuente: 'https://x', verificado: true }] }), null);
});

test('vehicles are the mobility, prospecting and excavation entries with a slope limit', () => {
  const cat = { equipos: [
    { id: 'a', clase: 'movilidad', requisitos: [{ variable: 'pendiente_deg', op: '<=', valor: 20 }] },
    { id: 'b', clase: 'movilidad', requisitos: [] },
    { id: 'c', clase: 'energia', requisitos: [{ variable: 'pendiente_deg', op: '<=', valor: 10 }] },
    { id: 'd', clase: 'excavacion', requisitos: [{ variable: 'pendiente_deg', op: '<=', valor: 15 }] },
  ] };
  assert.deepEqual(vehiculos(cat).map((v) => [v.equipo.id, v.limite]), [['a', 20], ['d', 15]]);
});

test('decimating ×2 keeps every second cell and doubles the cell size', () => {
  const n = 4, a = Float32Array.from({ length: 16 }, (_, i) => i);
  const d = diezmar({ n, m: 10, alturas: a, sombra: Float32Array.from({ length: 16 }, (_, i) => i % 2) });
  assert.equal(d.n, 2);
  assert.equal(d.m, 20);
  assert.deepEqual(Array.from(d.alturas), [0, 2, 8, 10]);
  assert.deepEqual(Array.from(d.sombra), [0, 0, 0, 0]);
});

const CITA_VIPER = '20 cm/s max driving speed (approx. 5x Perseverance) • 0.8 cm/s "Speed Made Good"';
const VIPER = {
  id: 'viper', clase: 'prospeccion',
  requisitos: [{ variable: 'horas_en_sombra', op: '<', valor: 50, unidad: 'h', texto: 'safe havens need shadow periods under 50 h' }],
  cifras: [
    { nombre: 'velocidad_max_cm_s', valor: 20, unidad: 'cm/s', fuente: 'https://ntrs.nasa.gov/x.pdf', cita: CITA_VIPER, verificado: true },
    { nombre: 'velocidad_efectiva_cm_s', valor: 0.8, unidad: 'cm/s', texto: '"Speed Made Good"', fuente: 'https://ntrs.nasa.gov/x.pdf', cita: CITA_VIPER, verificado: true },
  ],
};

test('hours in shadow at catalogue top speed are a lower bound and cannot give OK under a "< 50 h" limit', () => {
  const h = horasEnSombra({ sombraTramoMax_m: 2540 }, VIPER, 'route');
  cerca(h.valor, 2.54 / 0.72);
  assert.equal(h.cota, 'inferior');
  assert.match(h.notaCota, /catalogue top speed 0\.72 km\/h/);
  const r = evaluarRequisito(VIPER.requisitos[0], { horas_en_sombra: h });
  assert.equal(r.estado, 'cota_inferior');
});

test('the cited "speed made good" gives the time as an extra figure with its source, no verdict', () => {
  const ef = velocidadEfectiva(VIPER);
  cerca(ef.kmh, 0.8 * 0.036);
  const h = horasEnSombra({ sombraTramoMax_m: 2540 }, VIPER, 'route');
  cerca(h.adicional.horas, 2.54 / 0.0288);
  assert.equal(h.adicional.cifra.nombre, 'velocidad_efectiva_cm_s');
  assert.match(h.adicional.texto, /"Speed Made Good" 0\.8 cm\/s: 88 h/);
  assert.equal(velocidadEfectiva({ cifras: [{ ...VIPER.cifras[1], verificado: false }] }), null);
  assert.equal(horasEnSombra({ sombraTramoMax_m: 2540 }, { cifras: [VIPER.cifras[0]] }, 'route').adicional, undefined);
});

test('a route that crosses no permanent-shadow cell spends exactly 0 h there: no lower bound, OK under a limit', () => {
  const h = horasEnSombra({ sombraTramoMax_m: 0, sombraSinDato_m: 0 }, VIPER, 'route');
  assert.equal(h.valor, 0);
  assert.equal(h.cota, undefined);
  assert.equal(evaluarRequisito(VIPER.requisitos[0], { horas_en_sombra: h }).estado, 'ok');
  assert.equal(horasEnSombra({ sombraTramoMax_m: 0, sombraSinDato_m: 40 }, VIPER, 'route').cota, 'inferior');
});

test('hours in shadow without a shadow layer or a cited speed are not measured, never zero', () => {
  assert.equal(horasEnSombra({ sombraTramoMax_m: null }, VIPER, 'route').valor, null);
  assert.match(horasEnSombra({ sombraTramoMax_m: 100 }, { cifras: [] }, 'route').motivo, /no catalogue speed/);
});

test('a decimated path mapped to the full grid is 8-connected, includes each mid cell and the real endpoints', () => {
  const n = 9, nD = 5;
  const caminoD = Int32Array.from([[0, 0], [1, 1], [1, 2], [2, 2]], ([f, c]) => f * nD + c);
  const camino = aRejillaCompleta(caminoD, nD, n, idx(n, 1, 0), idx(n, 4, 5));
  const cs = celdas(n, camino);
  assert.deepEqual(cs, [[1, 0], [0, 0], [1, 1], [2, 2], [2, 3], [2, 4], [3, 4], [4, 4], [4, 5]]);
  for (let k = 1; k < cs.length; k++) assert.ok(Math.max(Math.abs(cs[k][0] - cs[k - 1][0]), Math.abs(cs[k][1] - cs[k - 1][1])) === 1, `step ${k}`);
});

test('measured on the full grid, a decimated route reveals the steep cells it skipped', () => {
  const n = 9, m = 10, pend = new Float32Array(n * n).fill(2);
  for (let f = 0; f < n; f++) for (let c = 0; c < n; c++) if (f % 2 && c % 2) pend[idx(n, f, c)] = 25;
  const t = { n, m, alturas: plano(n), pend };
  const tD = diezmar(t);
  tD.pend = new Float32Array(tD.n * tD.n).fill(2);
  const r = caminoMinimo(tD, 0, tD.n * tD.n - 1, { limite: 15 });
  assert.equal(medirRuta(tD, r.camino).pendMax, 2);
  const camino = aRejillaCompleta(r.camino, tD.n, n, 0, n * n - 1);
  assert.equal(medirRuta(t, camino).pendMax, 25);
  assert.deepEqual(celdasSobreLimite(pend, camino, 15), { sobre: 4, sinDato: 0 });
  cerca(medirRuta(t, camino).longitud_m, 8 * S2 * m);
});

// Lago en el centro de un 7×7 llano: la recta de (3,0) a (3,6) lo cruza.
function conLago() {
  const n = 7, agua = new Float32Array(n * n);
  for (let f = 1; f <= 5; f++) for (let c = 2; c <= 4; c++) agua[idx(n, f, c)] = 2;
  agua[idx(n, 0, 0)] = NaN;
  return { n, m: 10, alturas: plano(n, 334.5), pend: new Float32Array(n * n), agua };
}

test('water is impassable: a route goes around a lake even when the water is flat', () => {
  const t = conLago();
  const r = caminoMinimo(t, idx(7, 3, 0), idx(7, 3, 6), { limite: 20 });
  assert.ok(r.camino);
  for (const i of r.camino) assert.ok(!(t.agua[i] >= 1), `path enters water at ${celdas(7, [i])}`);
  assert.ok(r.coste > 60 + 1e-9, 'longer than the straight line');
});

test('no water data (NaN) is passable; a terrain without the layer routes as before', () => {
  const t = conLago();
  assert.ok(caminoMinimo(t, idx(7, 0, 0), idx(7, 0, 6), { limite: 20 }).camino);
  delete t.agua;
  cerca(caminoMinimo(t, idx(7, 3, 0), idx(7, 3, 6), { limite: 20 }).coste, 60);
});

test('an origin or destination on water has no route and no minimum slope that would connect it', () => {
  const t = conLago();
  assert.equal(caminoMinimo(t, idx(7, 3, 3), idx(7, 3, 6), { limite: 90 }).coste, Infinity);
  assert.equal(caminoMinimo(t, idx(7, 3, 0), idx(7, 3, 3), { limite: 90 }).coste, Infinity);
  assert.equal(umbralMinimo(t, idx(7, 3, 3), idx(7, 3, 6)), Infinity);
});

test('the minimum connecting slope never crosses water', () => {
  const t = conLago();
  // Anillo de tierra empinada (25°) alrededor del lago; por el agua sería 0°.
  for (const f of [0, 6]) for (let c = 0; c < 7; c++) t.pend[idx(7, f, c)] = 25;
  cerca(umbralMinimo(t, idx(7, 3, 0), idx(7, 3, 6)), 25, 1e-6);
});

test('pairwise costs: a stop on water is unconnected to every other stop', () => {
  const t = conLago();
  const { M } = matrizCostes(t, [idx(7, 3, 0), idx(7, 3, 6), idx(7, 3, 3)], { limite: 20 });
  assert.ok(Number.isFinite(M[0][1]));
  assert.equal(M[0][2], Infinity);
  assert.equal(M[1][2], Infinity);
});

test('decimating ×2 marks a coarse cell as water if any of its 4 cells is water (conservative)', () => {
  const n = 4, agua = new Float32Array(n * n);
  agua[idx(n, 1, 1)] = 3;           // bloque (0,0): solo la celda de abajo a la derecha
  agua[idx(n, 0, 2)] = NaN;         // bloque (0,1): un NaN y tres de tierra
  agua[idx(n, 2, 0)] = NaN; agua[idx(n, 2, 1)] = NaN; agua[idx(n, 3, 0)] = NaN; agua[idx(n, 3, 1)] = NaN;
  const d = diezmar({ n, m: 10, alturas: plano(n), agua });
  assert.equal(d.agua[0], 3);
  assert.equal(d.agua[1], 0);
  assert.ok(Number.isNaN(d.agua[2]));
  assert.equal(d.agua[3], 0);
  assert.equal(diezmar({ n, m: 10, alturas: plano(n) }).agua, null);
});

test('a route found on the decimated grid and mapped back to the full grid never steps on water', () => {
  const n = 12, agua = new Float32Array(n * n);
  // Río de una celda de ancho en columnas impares: en la rejilla diezmada (que toma las pares) no se vería sin la regla.
  for (let f = 0; f < 9; f++) agua[idx(n, f, 5)] = 3;
  const t = { n, m: 10, alturas: plano(n), agua };
  const tD = diezmar(t);
  tD.pend = pendientes(tD.alturas, tD.n, tD.m);
  const o = idx(n, 2, 2), d = idx(n, 2, 8);
  const r = caminoMinimo(tD, (2 / 2) * tD.n + 1, (2 / 2) * tD.n + 4, { limite: 20 });
  assert.ok(r.camino);
  const full = aRejillaCompleta(r.camino, tD.n, n, o, d);
  for (const i of full) assert.ok(!(agua[i] >= 1), `full-grid path on water at ${celdas(n, [i])}`);
});

// Escarpe con ladera transversal: 21×21, 10 m/px. Escalón a 35° en las columnas 8–11 a lo largo de la fila 10 y,
// entre las columnas 6 y 14, ladera de 30° hacia las filas: ninguna celda de esa franja baja de 20° de pendiente de celda.
function escarpe() {
  const n = 21, m = 10, a = new Float32Array(n * n), t35 = Math.tan(35 * Math.PI / 180), t30 = Math.tan(30 * Math.PI / 180);
  for (let f = 0; f < n; f++) for (let c = 0; c < n; c++) {
    a[idx(n, f, c)] = t35 * m * Math.min(Math.max(c - 8, 0), 3) + (c >= 6 && c <= 14 ? t30 * m * (f - 10) : 0);
  }
  return { n, m, alturas: a };
}
// Carretera aplicada a lo largo de la fila 10 (columnas 3–17) con la rasante a `grados`, como la escribe la obra.
function conCarretera(t, grados) {
  const camino = Int32Array.from({ length: 15 }, (_, k) => idx(t.n, 10, 3 + k));
  const p = perfil(t, camino), g = rasante(p.s, p.z, grados, { anclarInicio: true, anclarFin: true });
  const d = deltaCarretera(t, camino, g.zp);
  const alturas = Float32Array.from(t.alturas, (h, i) => h + d[i]);
  return { t: { n: t.n, m: t.m, alturas, pend: pendientes(alturas, t.n, t.m) }, camino };
}

test('without a road the scarp has no route at 20°; with the applied road the route exists and runs along it', () => {
  const t0 = escarpe();
  t0.pend = pendientes(t0.alturas, t0.n, t0.m);
  const o = idx(21, 2, 0), d = idx(21, 18, 20);
  assert.equal(caminoMinimo(t0, o, d, { limite: 20 }).camino, null);
  const { t, camino } = conCarretera(escarpe(), 19.99);
  assert.equal(caminoMinimo(t, o, d, { limite: 20 }).camino, null, 'cell slope alone still blocks: the cross slope is untouched');
  assert.ok(celdasSobreLimite(t.pend, camino, 20).sobre > 0);
  const r = caminoMinimo(t, o, d, { limite: 20, carreteras: [camino] });
  assert.ok(r.camino);
  const enRuta = new Set(r.camino);
  for (let c = 6; c <= 14; c++) assert.ok(enRuta.has(idx(21, 10, c)), `route crosses the scarp on the road at column ${c}`);
  for (const i of r.camino) if (!camino.includes(i)) assert.ok(t.pend[i] <= 20, `off the road every cell keeps the cell-slope rule (${celdas(21, [i])})`);
  assert.ok(umbralMinimo(t, o, d) > 20);
  assert.ok(umbralMinimo(t, o, d, { carreteras: [camino] }) <= 20);
});

test('a road with one step along it steeper than the limit does not open the route; the connecting slope is that step', () => {
  const { t, camino } = conCarretera(escarpe(), 25);
  const o = idx(21, 2, 0), d = idx(21, 18, 20);
  assert.equal(caminoMinimo(t, o, d, { limite: 20, carreteras: [camino] }).camino, null);
  const u = umbralMinimo(t, o, d, { carreteras: [camino] });
  assert.ok(u > 20 && u <= 25 + 1e-4, `${u}`);
  assert.ok(caminoMinimo(t, o, d, { limite: u, carreteras: [camino] }).camino);
});

test('only consecutive cells of the trace count as road: a gap in the trace is judged by cell slope', () => {
  const { t, camino } = conCarretera(escarpe(), 19.99);
  const o = idx(21, 2, 0), d = idx(21, 18, 20);
  const partida = [camino.subarray(0, 8), camino.subarray(7)];
  assert.ok(caminoMinimo(t, o, d, { limite: 20, carreteras: partida }).camino, 'two pieces sharing a cell: no step is missing');
  const conHueco = [camino.subarray(0, 7), camino.subarray(8)];
  assert.equal(caminoMinimo(t, o, d, { limite: 20, carreteras: conHueco }).camino, null);
});

test('route measures on a road: cell slope of road cells is left out and the steepest step along the road is given', () => {
  const { t, camino } = conCarretera(escarpe(), 19.99);
  const r = caminoMinimo(t, idx(21, 2, 0), idx(21, 18, 20), { limite: 20, carreteras: [camino] });
  const sin = medirRuta(t, r.camino), con = medirRuta(t, r.camino, { carreteras: [camino] });
  assert.ok(sin.pendMax > 20);
  assert.ok(con.pendMax <= 20);
  assert.ok(con.carretera.pasos >= 8, `${con.carretera.pasos}`);
  assert.ok(con.carretera.pendMax <= 20 && con.carretera.pendMax > 19.9, `${con.carretera.pendMax}`);
  assert.equal(con.longitud_m, sin.longitud_m);
  assert.equal('carretera' in sin, false);
});

test('roads are optional: no list or an empty one gives the same result as before', () => {
  const t = escarpe();
  t.pend = pendientes(t.alturas, t.n, t.m);
  for (const lim of [20, 31, 45]) {
    const a = caminoMinimo(t, idx(21, 2, 0), idx(21, 18, 20), { limite: lim });
    const b = caminoMinimo(t, idx(21, 2, 0), idx(21, 18, 20), { limite: lim, carreteras: [] });
    assert.deepEqual(b, a);
  }
  assert.equal(umbralMinimo(t, idx(21, 2, 0), idx(21, 18, 20), { carreteras: [] }), umbralMinimo(t, idx(21, 2, 0), idx(21, 18, 20)));
});
