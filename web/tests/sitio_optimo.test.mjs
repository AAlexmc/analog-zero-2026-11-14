import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { cargarIndice, cargarMundo, mejorSitio, ajustesPorDefecto, separacionPorDefecto, valoresEn, latLonDe, CUMPLE, esLimite } from '../sitio/optimo.js';
import { topsis } from '../terreno/reparto.js';
import { distanciaAngular } from '../explorar/geo.js';

const RAD = Math.PI / 180;
const cita = { texto: 'quote', fuente: 'https://example.org' };

// Índice sintético con el mismo contrato que web/data/sitio/indice.json; los ficheros viven en un Map.
function sintetico() {
  const ficheros = new Map();
  const capa = (ruta, N, f) => { const a = new Float32Array(N); for (let i = 0; i < N; i++) a[i] = f(i); ficheros.set(ruta, a.buffer); };
  // Marte: 36 × 18 celdas de 10°.
  const W = 36, H = 18, paso = 10, lat0 = 85, lon0 = -175, NM = W * H;
  const la = (i) => lat0 - Math.floor(i / W) * paso, lo = (i) => lon0 + (i % W) * paso;
  capa('mars/lat_abs_deg.f32', NM, (i) => Math.abs(la(i)));
  capa('mars/altitud_m.f32', NM, (i) => (i % 7 === 0 ? 3000 : 1000 * Math.sin(lo(i) * RAD)));
  capa('mars/pendiente_5km_deg.f32', NM, (i) => (i % 5 === 3 ? NaN : (i * 37) % 13));
  capa('mars/hidrogeno_neutrones.f32', NM, (i) => 1 + ((i * 53) % 101) / 10);
  // Luna: rejilla polar 64 × 64, 1 km por celda, centrada en el polo sur.
  const n = 64, m = 1000, R = 1737.4, NL = n * n;
  const x = (i) => ((i % n) - (n - 1) / 2) * m, y = (i) => ((n - 1) / 2 - Math.floor(i / n)) * m;
  capa('moon/lat.f32', NL, (i) => -90 + Math.hypot(x(i), y(i)) / 1000 / R / RAD);
  capa('moon/lon.f32', NL, (i) => Math.atan2(x(i), y(i)) / RAD);
  capa('moon/iluminacion.f32', NL, (i) => (Math.hypot(x(i), y(i)) > 30000 ? NaN : 0.2 + 0.6 * Math.abs(Math.sin(i * 0.37))));
  capa('moon/pendiente_deg.f32', NL, (i) => (i * 29) % 25);
  capa('moon/dist_sombra_km.f32', NL, (i) => Math.hypot(x(i) - 9000, y(i) + 4000) / 1000);
  const indice = { mundos: {
    moon: {
      ambito: 'Synthetic south pole patch', rejilla: { tipo: 'polar', n, m_por_px: m, lat: 'moon/lat.f32', lon: 'moon/lon.f32' },
      criterios: [
        { id: 'iluminacion', nombre: 'Sunlight', tipo: 'peso', sentido: 'mas', unidad: 'fraction of time', capa: 'moon/iluminacion.f32', limite: null, cita },
        { id: 'pendiente_deg', nombre: 'Slope', tipo: 'peso', sentido: 'menos', unidad: '°', capa: 'moon/pendiente_deg.f32', limite: null, cita },
        { id: 'dist_sombra_km', nombre: 'Distance to permanent shadow (possible ice)', tipo: 'peso', sentido: 'menos', unidad: 'km', capa: 'moon/dist_sombra_km.f32', limite: null, cita },
      ],
      no_medidos: [{ nombre: 'Line of sight to Earth', cita, motivo: 'no layer in this version' }],
    },
    mars: {
      ambito: 'Synthetic Mars', rejilla: { tipo: 'equirrectangular', ancho: W, alto: H, paso_deg: paso, lat0, lon0 },
      criterios: [
        { id: 'lat_abs_deg', nombre: 'Latitude', tipo: 'limite', unidad: '°', capa: 'mars/lat_abs_deg.f32', limite: { op: '<=', valor: 50, origen: 'cita' }, cita },
        { id: 'altitud_m', nombre: 'Elevation', tipo: 'limite', unidad: 'm', capa: 'mars/altitud_m.f32', limite: { op: '<=', valor: 2000, origen: 'cita' }, cita },
        { id: 'pendiente_5km_deg', nombre: 'Slope', tipo: 'limite+peso', sentido: 'menos', unidad: '°', capa: 'mars/pendiente_5km_deg.f32', limite: { op: '<=', valor: 10, origen: 'cita' }, cita },
        { id: 'hidrogeno_neutrones', nombre: 'Water indicator (hydrogen)', tipo: 'peso', sentido: 'menos', unidad: 'counts/s', capa: 'mars/hidrogeno_neutrones.f32', limite: null, cita },
      ],
      no_medidos: [],
    },
  } };
  ficheros.set('indice.json', indice);
  const leer = async (ruta) => { if (!ficheros.has(ruta)) throw new Error(`missing ${ruta}`); return ficheros.get(ruta); };
  return { leer };
}

const { leer } = sintetico();
const IDX = await cargarIndice('', leer);
const MARTE = await cargarMundo(IDX, 'mars', '', { radio_km: 3389.5, leer });
const LUNA = await cargarMundo(IDX, 'moon', '', { radio_km: 1737.4, leer });

const cumpleTodo = (M, aj, i) => M.criterios.filter(esLimite).every((c) => aj.limites[c.id] === null || (Number.isFinite(M.capas[c.id][i]) && CUMPLE[c.limite.op](M.capas[c.id][i], aj.limites[c.id])));
// Referencia por fuerza bruta: aptas, TOPSIS sobre ellas y la mejor por puntuación (índice menor si empatan).
function referencia(M, aj) {
  const pesos = M.criterios.filter((c) => (aj.pesos[c.id] ?? 0) > 0);
  const cand = [];
  for (let i = 0; i < M.N; i++) if (cumpleTodo(M, aj, i) && pesos.every((c) => Number.isFinite(M.capas[c.id][i]))) cand.push(i);
  const X = Float64Array.from(cand.flatMap((i) => pesos.map((c) => M.capas[c.id][i])));
  const C = topsis(X, cand.length, pesos.map((c) => aj.pesos[c.id]), pesos.map((c) => c.sentido === 'mas'));
  let b = 0;
  for (let a = 1; a < cand.length; a++) if (C[a] > C[b]) b = a;
  return { i: cand[b], C: C[b], n: cand.length };
}

test('default settings: NASA limits on, every weight the same', () => {
  const aj = ajustesPorDefecto(MARTE);
  assert.deepEqual(aj, { limites: { lat_abs_deg: 50, altitud_m: 2000, pendiente_5km_deg: 10 }, pesos: { pendiente_5km_deg: 0.5, hidrogeno_neutrones: 0.5 } });
  assert.deepEqual(ajustesPorDefecto(LUNA).limites, {});
});

test('the best site meets every active limit and is the TOPSIS winner among the cells that meet them', () => {
  for (const M of [MARTE, LUNA]) {
    const aj = ajustesPorDefecto(M);
    const r = mejorSitio(M, aj);
    const ref = referencia(M, aj);
    assert.equal(r.mejor.i, ref.i, M.id);
    assert.equal(r.mejor.puntuacion, ref.C);
    assert.equal(r.candidatos, ref.n);
    for (const s of [r.mejor, ...r.alternativas]) {
      assert.ok(cumpleTodo(M, aj, s.i), `${M.id} cell ${s.i}`);
      assert.ok(Object.values(s.cumple).every((v) => v === true));
      assert.deepEqual({ lat: s.lat, lon: s.lon }, latLonDe(M, s.i));
      assert.equal(s.fila * M.cols + s.col, s.i);
      for (const c of M.criterios) assert.ok(Object.is(s.valores[c.id], M.capas[c.id][s.i]));
    }
  }
});

test('limits count NaN as not met, and switching one off lets more sites in', () => {
  const aj = ajustesPorDefecto(MARTE);
  const r = mejorSitio(MARTE, aj);
  const sin = mejorSitio(MARTE, { ...aj, limites: { ...aj.limites, lat_abs_deg: null } });
  assert.ok(sin.aptas.n > r.aptas.n, `${sin.aptas.n} vs ${r.aptas.n}`);
  assert.equal(sin.usados.limites.length, 2);
  assert.ok(!sin.usados.limites.some((l) => l.id === 'lat_abs_deg'));
  let n = 0;
  for (let i = 0; i < MARTE.N; i++) if (cumpleTodo(MARTE, aj, i)) n++;
  assert.equal(r.aptas.n, n);
  assert.equal(r.aptas.de, MARTE.N);
  assert.equal(r.aptas.frac, n / MARTE.N);
  let sa = 0, st = 0;
  for (let i = 0; i < MARTE.N; i++) { const w = Math.cos((85 - Math.floor(i / 36) * 10) * RAD); st += w; if (cumpleTodo(MARTE, aj, i)) sa += w; }
  assert.ok(Math.abs(r.aptas.fracArea - sa / st) < 1e-12);
  assert.equal(mejorSitio(LUNA, ajustesPorDefecto(LUNA)).aptas.fracArea, 1);
});

test('a changed limit is reported as changed from NASA', () => {
  const aj = ajustesPorDefecto(MARTE);
  const r = mejorSitio(MARTE, { ...aj, limites: { ...aj.limites, altitud_m: 500 } });
  const l = r.usados.limites.find((x) => x.id === 'altitud_m');
  assert.deepEqual(l, { id: 'altitud_m', op: '<=', valor: 500, nasa: 2000, origen: 'cita', cambiado: true });
  assert.ok(r.mejor.valores.altitud_m <= 500);
});

test('direction: "less" picks the lowest value, "more" the highest', () => {
  const aj = { limites: {}, pesos: { iluminacion: 1 } };
  const r = mejorSitio(LUNA, aj);
  let max = -Infinity;
  for (const v of LUNA.capas.iluminacion) if (v > max) max = v;
  assert.equal(r.mejor.valores.iluminacion, max);
  const s = mejorSitio(LUNA, { limites: {}, pesos: { pendiente_deg: 1 } });
  assert.equal(s.mejor.valores.pendiente_deg, 0);
});

test('raising a weight moves the best site towards that criterion', () => {
  const aj = ajustesPorDefecto(MARTE);
  const a = mejorSitio(MARTE, aj);
  const b = mejorSitio(MARTE, { ...aj, pesos: { ...aj.pesos, hidrogeno_neutrones: 1, pendiente_5km_deg: 0.05 } });
  assert.notEqual(a.mejor.i, b.mejor.i);
  assert.ok(b.mejor.valores.hidrogeno_neutrones <= a.mejor.valores.hidrogeno_neutrones);
  assert.equal(b.mejor.i, referencia(MARTE, { ...aj, pesos: { ...aj.pesos, hidrogeno_neutrones: 1, pendiente_5km_deg: 0.05 } }).i);
});

test('alternatives are four, in falling score, and at least the minimum distance from each other', () => {
  for (const M of [MARTE, LUNA]) {
    const r = mejorSitio(M, ajustesPorDefecto(M));
    const todos = [r.mejor, ...r.alternativas];
    assert.equal(r.alternativas.length, 4, M.id);
    assert.equal(r.separacion.origen, 'mío');
    for (let a = 0; a < todos.length; a++) {
      if (a) assert.ok(todos[a].puntuacion <= todos[a - 1].puntuacion);
      for (let b = 0; b < a; b++) {
        const km = M.rejilla.tipo === 'polar'
          ? Math.hypot(todos[a].fila - todos[b].fila, todos[a].col - todos[b].col) * M.rejilla.m_por_px / 1000
          : distanciaAngular(todos[a].lat, todos[a].lon, todos[b].lat, todos[b].lon) * RAD * M.radio_km;
        assert.ok(km >= r.separacion.km, `${M.id}: ${km} km < ${r.separacion.km}`);
      }
    }
  }
  assert.equal(separacionPorDefecto(MARTE).km, 1000);
  assert.equal(separacionPorDefecto(LUNA).km, 0.05 * 64 * 1000 / 1000);
});

test('a bigger minimum distance leaves fewer alternatives when the area runs out', () => {
  const r = mejorSitio(LUNA, ajustesPorDefecto(LUNA), { separacion_km: 40 });
  assert.ok(r.alternativas.length < 4);
  assert.ok(r.mejor);
});

test('no site meets the limits: no best site, and the limit that rules out the most', () => {
  const aj = ajustesPorDefecto(MARTE);
  const r = mejorSitio(MARTE, { ...aj, limites: { ...aj.limites, lat_abs_deg: 1, altitud_m: 2000 } });
  assert.equal(r.mejor, null);
  assert.deepEqual(r.alternativas, []);
  assert.equal(r.motivo, 'sin_aptas');
  assert.equal(r.aptas.n, 0);
  assert.equal(r.descartadoPor.id, 'lat_abs_deg');
  let n = 0;
  for (let i = 0; i < MARTE.N; i++) if (!(MARTE.capas.lat_abs_deg[i] <= 1)) n++;
  assert.equal(r.descartadoPor.n, n);
});

test('all weights at zero: there is no best site, and it says so', () => {
  const aj = ajustesPorDefecto(MARTE);
  const r = mejorSitio(MARTE, { ...aj, pesos: { pendiente_5km_deg: 0, hidrogeno_neutrones: 0 } });
  assert.equal(r.mejor, null);
  assert.equal(r.motivo, 'sin_pesos');
  assert.ok(r.aptas.n > 0);
});

test('same input, same answer; ties go to the lowest cell index', () => {
  const aj = ajustesPorDefecto(LUNA);
  assert.deepEqual(mejorSitio(LUNA, aj), mejorSitio(LUNA, aj));
  const r = mejorSitio(LUNA, { limites: {}, pesos: { pendiente_deg: 1 } });
  const primero = LUNA.capas.pendiente_deg.findIndex((v) => v === 0);
  assert.equal(r.mejor.i, primero);
});

test('values at a hand-picked point: nearest cell, limit met or not, null outside the polar patch', () => {
  const aj = ajustesPorDefecto(MARTE);
  const v = valoresEn(MARTE, 44.9, -171, aj);
  assert.equal(v.lat, 45); assert.equal(v.lon, -175);
  assert.equal(v.cumple.lat_abs_deg, true);
  const w = valoresEn(MARTE, -75, 180, aj);
  assert.equal(w.lat, -75); assert.equal(w.lon, -175);
  assert.equal(w.cumple.lat_abs_deg, false);
  const nan = [...Array(MARTE.N).keys()].find((i) => Number.isNaN(MARTE.capas.pendiente_5km_deg[i]));
  const p = latLonDe(MARTE, nan);
  assert.equal(valoresEn(MARTE, p.lat, p.lon, aj).cumple.pendiente_5km_deg, null);

  const i = 20 * 64 + 41, q = latLonDe(LUNA, i);
  const u = valoresEn(LUNA, q.lat + 1e-4, q.lon, ajustesPorDefecto(LUNA));
  assert.equal(u.i, i);
  assert.deepEqual(u.cumple, {});
  assert.equal(valoresEn(LUNA, -60, 0, ajustesPorDefecto(LUNA)), null);
});

// Datos reales, si ya existen: el mejor sitio cumple los límites de NASA y Marte tarda < 300 ms.
const REAL = new URL('../data/sitio/', import.meta.url);
const hayReal = await access(new URL('indice.json', REAL)).then(() => true, () => false);
test('real site criteria: best site meets the limits, Mars under 300 ms', { skip: hayReal ? false : 'web/data/sitio/indice.json not generated yet' }, async () => {
  const leerDisco = async (url, tipo) => { const b = await readFile(new URL(url)); return tipo === 'json' ? JSON.parse(b.toString('utf8')) : b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
  const mundos = JSON.parse(await readFile(new URL('../data/cuerpos/mundos.json', import.meta.url), 'utf8')).mundos;
  const idx = await cargarIndice(REAL.href, leerDisco);
  for (const id of Object.keys(idx.mundos)) {
    const M = await cargarMundo(idx, id, REAL.href, { radio_km: mundos.find((m) => m.id === id).radio_km, leer: leerDisco });
    const aj = ajustesPorDefecto(M);
    mejorSitio(M, aj);
    const t0 = performance.now();
    const r = mejorSitio(M, aj);
    const ms = performance.now() - t0;
    assert.ok(r.mejor, `${id}: ${r.motivo}`);
    for (const s of [r.mejor, ...r.alternativas]) assert.ok(cumpleTodo(M, aj, s.i), `${id} cell ${s.i}`);
    if (id === 'mars') {
      assert.ok(ms < 300, `mars took ${ms.toFixed(0)} ms`);
      // Referencia del pipeline: con un solo peso es la celda con menos neutrones dentro de los límites (fila 80, col 78), 0,557 del área.
      assert.deepEqual([r.mejor.fila, r.mejor.col, r.mejor.lat, r.mejor.lon], [80, 78, 49.75, -140.75]);
      assert.ok(Math.abs(r.aptas.fracArea - 0.557) < 0.0005, String(r.aptas.fracArea));
      let min = Infinity;
      for (let i = 0; i < M.N; i++) if (cumpleTodo(M, aj, i) && M.capas.hidrogeno_neutrones[i] < min) min = M.capas.hidrogeno_neutrones[i];
      assert.equal(r.mejor.valores.hidrogeno_neutrones, min);
    } else {
      assert.ok(r.mejor.lat <= -84, `moon best at ${r.mejor.lat}`);
      for (const s of [r.mejor, ...r.alternativas]) assert.ok(Object.values(s.valores).every(Number.isFinite), `moon cell ${s.i} without data`);
    }
  }
});
