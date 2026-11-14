import test from 'node:test';
import assert from 'node:assert/strict';

// El worker se engancha a `self`; aquí se le da uno de mentira para llamarlo como lo hace la página.
const salidas = [];
globalThis.self = { postMessage: (m) => salidas.push(m) };
await import('../terreno/rutas_worker.js');
let sig = 1;
const pedir = (q) => { const id = sig++; self.onmessage({ data: { id, ...q } }); const r = salidas.find((x) => x.id === id); assert.ok(r?.ok, r?.error); return r.r; };

const n = 7, idx = (f, c) => f * n + c;
function lago() {
  const alturas = new Float32Array(n * n).fill(334.5), agua = new Float32Array(n * n);
  for (let f = 1; f <= 5; f++) for (let c = 2; c <= 4; c++) agua[idx(f, c)] = 2;
  return { n, m: 10, alturas, agua, sombra: null, limite: 20, factor: 1 };
}

test('route task: endpoints on water are reported with their water class, not as a slope problem', () => {
  const r = pedir({ tipo: 'ruta', ...lago(), origen: idx(3, 3), destino: idx(3, 6) });
  assert.equal(r.camino, undefined);
  assert.equal(r.aguaOrigen, 2);
  assert.equal(r.aguaDestino, 0);
});

test('route task: water is impassable, the route goes around the lake', () => {
  const q = lago();
  const r = pedir({ tipo: 'ruta', ...q, origen: idx(3, 0), destino: idx(3, 6) });
  assert.ok(r.camino);
  for (const i of r.camino) assert.ok(!(q.agua[i] >= 1));
  assert.equal(r.aguaOrigen, 0);
});

test('route task without a water layer has no water fields', () => {
  const q = lago();
  q.agua = null;
  const r = pedir({ tipo: 'ruta', ...q, origen: idx(3, 0), destino: idx(3, 6) });
  assert.ok(r.camino);
  assert.equal(r.aguaOrigen, undefined);
});

test('visit task: a stop on water is unconnected and reported', () => {
  const r = pedir({ tipo: 'visita', ...lago(), puntos: [idx(3, 0), idx(3, 6), idx(3, 3)] });
  assert.equal(r.orden, undefined);
  assert.deepEqual(r.aguaParadas, [0, 0, 2]);
});

test('zone task: water cells are removed and counted', () => {
  const q = lago();
  const eq = { requisitos: [{ variable: 'pendiente_deg', op: '<=', valor: 5, unidad: 'deg' }] };
  const r = pedir({ tipo: 'zona', n, m: 10, alturas: q.alturas, capas: { agua: q.agua }, equipo: eq, plantados: [] });
  assert.equal(r.celdas, n * n - 15);
  assert.equal(r.agua.celdas, 15);
});

test('route task: an applied road passed as carreteras opens a route the cell slope blocks, and its measures say so', async () => {
  const { pendientes } = await import('../terreno/rutas.js');
  const { perfil, rasante, deltaCarretera } = await import('../terreno/obra.js');
  const N = 21, m = 10, a = new Float32Array(N * N), t35 = Math.tan(35 * Math.PI / 180), t30 = Math.tan(30 * Math.PI / 180);
  for (let f = 0; f < N; f++) for (let c = 0; c < N; c++) a[f * N + c] = t35 * m * Math.min(Math.max(c - 8, 0), 3) + (c >= 6 && c <= 14 ? t30 * m * (f - 10) : 0);
  const camino = Int32Array.from({ length: 15 }, (_, k) => 10 * N + 3 + k);
  const p = perfil({ n: N, m, alturas: a }, camino), g = rasante(p.s, p.z, 19.99, { anclarInicio: true, anclarFin: true });
  const d = deltaCarretera({ n: N, alturas: a }, camino, g.zp);
  const alturas = Float32Array.from(a, (h, i) => h + d[i]);
  assert.ok(pendientes(alturas, N, m)[10 * N + 10] > 20);
  const q = { tipo: 'ruta', n: N, m, alturas, sombra: null, agua: null, limite: 20, factor: 1, origen: 2 * N, destino: 18 * N + 20 };
  const sin = pedir(q);
  assert.equal(sin.camino, undefined);
  assert.ok(sin.umbral > 20);
  const con = pedir({ ...q, carreteras: [camino] });
  assert.ok(con.camino);
  assert.ok(con.medidas.pendMax <= 20);
  assert.ok(con.medidas.carretera.pasos >= 8);
  const vis = pedir({ tipo: 'visita', n: N, m, alturas, sombra: null, agua: null, limite: 20, factor: 1, puntos: [2 * N, 18 * N + 20], carreteras: [camino] });
  assert.ok(vis.camino);
  assert.ok(vis.medidas.carretera.pasos >= 16);
});
