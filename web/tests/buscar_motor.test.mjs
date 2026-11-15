import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { cargar } from '../buscar/motor.js';

const N = 720 * 360;
const idx = (fila, col) => fila * 720 + col;
const lat = (fila) => 89.75 - fila * 0.5;
const lon = (col) => -179.75 + col * 0.5;

function buf(fn) {
  const dv = new DataView(new ArrayBuffer(N * 4));
  for (let i = 0; i < N; i++) dv.setFloat32(i * 4, fn(i), true);
  return dv.buffer;
}

// Rejilla sintética: tierra firme en las filas 100-259; casquete en las filas 250-259.
function sintetico() {
  const fila = (i) => Math.floor(i / 720), col = (i) => i % 720;
  const ficheros = {
    'earth/tierra.f32': buf((i) => (fila(i) >= 100 && fila(i) < 260 ? 1 : 0)),
    'earth/casquete.f32': buf((i) => (fila(i) >= 250 && fila(i) < 260 ? 1 : NaN)),
    'earth/a.f32': buf((i) => fila(i) + col(i) / 1000),
    'earth/b.f32': buf((i) => (col(i) % 7 === 3 ? NaN : 1 + col(i))),
    'moon/a.f32': buf((i) => 150 + col(i) / 1000),
    'moon/b.f32': buf(() => 50),
  };
  const fuente = { texto: 't', url: null };
  const fuentes = { earth: fuente, moon: fuente, mars: fuente };
  const indice = {
    rejilla: { ancho: 720, alto: 360, paso_deg: 0.5, lat0: 89.75, lon0: -179.75, fila0: 'norte' },
    cuerpos: { earth: { radio_km: 6371 }, moon: { radio_km: 1737.4 }, mars: { radio_km: 3389.5 } },
    mascara_tierra: 'earth/tierra.f32',
    mascara_casquete: 'earth/casquete.f32',
    parametros: [
      { id: 'a', capas: { earth: 'earth/a.f32', moon: 'moon/a.f32', mars: null }, constante: null, fuentes,
        rango_ref: { min: 0, max: 360 }, transformacion: 'lineal', reproducible_en_tierra: true },
      { id: 'b', capas: { earth: 'earth/b.f32', moon: 'moon/b.f32', mars: null }, constante: null, fuentes,
        rango_ref: { min: 1, max: 1000 }, transformacion: 'log10', reproducible_en_tierra: true },
      { id: 'c', capas: { earth: 'earth/a.f32', moon: null, mars: null }, constante: { earth: null, moon: null, mars: null }, fuentes,
        rango_ref: { min: 0, max: 360 }, transformacion: 'lineal', reproducible_en_tierra: true },
      { id: 'g', capas: null, constante: { earth: 9.82, moon: 1.62, mars: 3.73 }, fuentes,
        rango_ref: { min: 1.62, max: 9.82 }, transformacion: 'lineal', reproducible_en_tierra: false },
      { id: 'p', capas: { earth: 'earth/a.f32', moon: null, mars: null }, constante: { earth: null, moon: 5, mars: null }, fuentes,
        rango_ref: { min: 0, max: 360 }, transformacion: 'lineal', reproducible_en_tierra: false },
    ],
  };
  return async (ruta, tipo) => {
    const r = ruta.replace(/^base\//, '');
    if (tipo === 'json') return JSON.parse(JSON.stringify(indice));
    return ficheros[r].slice(0);
  };
}

const huella = (r) => createHash('sha256')
  .update(JSON.stringify({ ...r, mapa: undefined }))
  .update(Buffer.from(r.mapa.buffer))
  .digest('hex');

// Quita lo que añadieron los parámetros solo-Tierra (origen_objetivo, sin_referencia, sus valores en el objetivo) para comparar con huellas fijadas antes.
const sinOrigen = (xs) => xs.map(({ origen_objetivo, ...x }) => x);
function sinNovedades(r, idsTierra = []) {
  const { sin_referencia, ...resto } = r;
  const out = { ...resto };
  if (r.objetivo?.valores) out.objetivo = { ...r.objetivo, valores: Object.fromEntries(Object.entries(r.objetivo.valores).filter(([k]) => !idsTierra.includes(k))) };
  for (const k of ['resultados', 'parciales', 'lugares']) if (r[k]) out[k] = r[k].map((x) => ({ ...x, parametros: sinOrigen(x.parametros) }));
  return out;
}

test('identity: a target taken from an Earth cell finds that cell first with 0 % deviation everywhere', async () => {
  const M = await cargar('base/', sintetico());
  const o = M.leerPunto('earth', lat(180), lon(400));
  assert.equal(o.fila, 180); assert.equal(o.col, 400);
  const r = M.buscar(o, { parametros: ['a', 'b'] });
  const p = r.resultados[0];
  assert.deepEqual([p.fila, p.col], [180, 400]);
  assert.equal(p.similitud_pct, 100);
  for (const x of p.parametros) assert.equal(x.desviacion_pct, 0);
});

test('a parameter without data at the target is not used and is reported as such', async () => {
  const M = await cargar('base/', sintetico());
  const o = M.leerPunto('moon', 0.25, 10.25);
  assert.equal(o.valores.c, null);
  assert.equal(o.valores.g, 1.62);
  const r = M.buscar(o);
  assert.deepEqual(r.usados, ['a', 'b']);
  assert.deepEqual(r.sin_dato, ['c']);
  const c = r.resultados[0].parametros.find((x) => x.id === 'c');
  assert.equal(c.estado, 'sin_dato_objetivo');
  assert.equal(c.desviacion_pct, null);
  assert.equal(c.valor_objetivo, null);
});

test('non-reproducible parameters are reported apart and do not enter the similarity', async () => {
  const M = await cargar('base/', sintetico());
  const o = M.leerPunto('moon', 0.25, 10.25);
  const r = M.buscar(o);
  assert.ok(!r.usados.includes('g'));
  assert.deepEqual(r.no_reproducibles.map((x) => x.id), ['g', 'p']);
  assert.equal(r.no_reproducibles[0].desviacion_pct, 100);
  assert.ok(r.resultados[0].parametros.every((x) => x.id !== 'g' && x.id !== 'p'));
});

test('a non-reproducible parameter with an Earth layer is read at each result cell', async () => {
  const M = await cargar('base/', sintetico());
  const r = M.buscar(M.leerPunto('moon', 0.25, 10.25), { n: 3 });
  for (const x of r.resultados) {
    const p = x.no_reproducibles.find((q) => q.id === 'p');
    assert.ok(Math.abs(p.valor_tierra - (x.fila + x.col / 1000)) < 1e-4);
    assert.equal(p.valor_objetivo, 5);
  }
  assert.deepEqual(r.no_reproducibles, r.resultados[0].no_reproducibles);
});

test('results are at least the requested distance apart (great circle)', async () => {
  const M = await cargar('base/', sintetico());
  const o = M.leerPunto('moon', 0.25, 10.25);
  for (const sep of [0, 500, 2000]) {
    const r = M.buscar(o, { n: 8, separacion_km: sep });
    assert.equal(r.resultados.length, 8);
    for (let i = 0; i < r.resultados.length; i++) {
      for (let j = i + 1; j < r.resultados.length; j++) {
        const a = r.resultados[i], b = r.resultados[j];
        const rad = Math.PI / 180;
        const h = Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lon - a.lon) * rad) / 2) ** 2;
        assert.ok(2 * 6371 * Math.asin(Math.sqrt(h)) >= sep, `${i}-${j} closer than ${sep} km`);
      }
    }
  }
});

test('ocean, ice cap (unless asked) and cells with less than half the parameters stay out', async () => {
  const M = await cargar('base/', sintetico());
  const o = M.leerPunto('moon', 0.25, 10.25);
  const r = M.buscar(o);
  assert.ok(Number.isNaN(r.mapa[idx(50, 10)]));
  assert.ok(Number.isNaN(r.mapa[idx(255, 10)]));
  assert.ok(Number.isFinite(M.buscar(o, { incluir_casquete: true }).mapa[idx(255, 10)]));
  // b sin dato en la columna 3: con a y b usados queda 1 de 2 (la mitad): entra.
  assert.ok(Number.isFinite(r.mapa[idx(150, 3)]));
  const solo = M.buscar(o, { parametros: ['b'] });
  assert.ok(Number.isNaN(solo.mapa[idx(150, 3)]));
});

test('deviation follows the metric: linear, log10 with floor at min, capped at 100, null without data', async () => {
  const M = await cargar('base/', sintetico());
  assert.equal(M.desviacion('a', 0, 36), 10);
  assert.equal(M.desviacion('a', 0, 1000), 100);
  assert.ok(Math.abs(M.desviacion('b', 10, 100) - 100 / 3) < 1e-9);
  assert.equal(M.desviacion('b', 0, 1), 0);
  assert.equal(M.desviacion('a', null, 3), null);
  assert.equal(M.desviacion('a', NaN, 3), null);
});

test('weights change the cell similarity as a weighted mean', async () => {
  const M = await cargar('base/', sintetico());
  const o = M.leerPunto('moon', 0.25, 10.25);
  const i = idx(150, 20);
  const da = M.desviacion('a', 150 + 20 / 1000, o.valores.a), db = M.desviacion('b', 21, 50);
  const r = M.buscar(o, { pesos: { a: 3, b: 1 } });
  assert.ok(Math.abs(r.mapa[i] - (3 * (100 - da) + (100 - db)) / 4) < 1e-3);
});

test('the same search twice gives the same bytes', async () => {
  const M = await cargar('base/', sintetico());
  const o = M.leerPunto('moon', 0.25, 10.25);
  const M2 = await cargar('base/', sintetico());
  assert.equal(huella(M.buscar(o)), huella(M2.buscar(M2.leerPunto('moon', 0.25, 10.25))));
});

const REAL = new URL('../data/cuerpos/', import.meta.url);
const hayReal = existsSync(new URL('indice.json', REAL));
const leerDisco = async (ruta, tipo) => {
  const b = await readFile(ruta);
  return tipo === 'json' ? JSON.parse(b.toString('utf8')) : b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};

function imprime(nombre, r) {
  const filas = [`${nombre}: used ${r.usados.join(', ')}; no data at target: ${r.sin_dato.join(', ') || '-'}`];
  for (const x of r.resultados) {
    filas.push(`  ${x.lat.toFixed(2)}, ${x.lon.toFixed(2)}  ${x.similitud_pct.toFixed(1)} %  ` +
      x.parametros.map((p) => `${p.id}=${p.valor_tierra === null ? 'NaN' : p.valor_tierra.toPrecision(3)}/${p.valor_objetivo === null ? 'NaN' : p.valor_objetivo.toPrecision(3)} ${p.desviacion_pct === null ? '-' : p.desviacion_pct.toFixed(1) + '%'}`).join('  '));
  }
  for (const x of r.no_reproducibles) filas.push(`  not reproducible: ${x.id} Earth ${x.valor_tierra} target ${x.valor_objetivo} deviation ${x.desviacion_pct?.toFixed(1)} %`);
  console.log(filas.join('\n'));
}

test('real data: identity on Earth, Shackleton rim and Jezero, timed', { skip: !hayReal && 'sin web/data/cuerpos' }, async () => {
  const M = await cargar(REAL.pathname, leerDisco);
  const t = M.leerPunto('earth', -24.1, -70.01);
  const rt = M.buscar(t);
  assert.deepEqual([rt.resultados[0].fila, rt.resultados[0].col], [t.fila, t.col]);
  for (const p of rt.resultados[0].parametros) if (p.estado === 'ok') assert.equal(p.desviacion_pct, 0);

  for (const [nombre, cuerpo, la, lo] of [['Shackleton rim', 'moon', -89.69, -162.9], ['Jezero', 'mars', 18.44, 77.45]]) {
    const o = M.leerPunto(cuerpo, la, lo);
    const t0 = performance.now();
    const r = M.buscar(o);
    const ms = performance.now() - t0;
    imprime(`${nombre} (${ms.toFixed(0)} ms)`, r);
    assert.equal(r.resultados.length, 5);
    assert.equal(huella(r), huella(M.buscar(M.leerPunto(cuerpo, la, lo))));
    assert.ok(ms < 1000, `${ms} ms`);
  }
});

test('real data: ranked results are compared on every used parameter; partly compared cells are listed apart', { skip: !hayReal && 'sin web/data/cuerpos' }, async () => {
  const M = await cargar(REAL.pathname, leerDisco);
  const r = M.buscar(M.leerPunto('mars', 18.44, 77.45));
  assert.ok(r.resultados.length > 0);
  for (const x of r.resultados) {
    assert.equal(x.comparados, x.de);
    assert.equal(x.de, r.usados.length);
    assert.ok(x.parametros.every((p) => p.estado !== 'sin_dato_tierra'));
  }
  assert.ok(r.parciales.length > 0);
  for (const x of r.parciales) {
    assert.ok(x.comparados < x.de && x.comparados >= Math.ceil(x.de / 2));
    assert.ok(x.parametros.some((p) => p.estado === 'sin_dato_tierra'));
  }
  const mezcla = M.buscar(M.leerPunto('mars', 18.44, 77.45), { completos: false });
  assert.equal(mezcla.parciales.length, 0);
  assert.ok(mezcla.resultados[0].similitud_pct >= r.resultados[0].similitud_pct);
  const mejor = Math.max(r.resultados[0].similitud_pct, r.parciales[0].similitud_pct);
  assert.equal(mezcla.resultados[0].similitud_pct, mejor);
});

test('real data: rainfall is compared on a log scale, log10(1 + mm/year)', { skip: !hayReal && 'sin web/data/cuerpos' }, async () => {
  const M = await cargar(REAL.pathname, leerDisco);
  const p = M.indice.parametros.find((x) => x.id === 'precip_mm_ano');
  assert.equal(p.transformacion, 'log1p');
  const esperado = (Math.log10(301) / Math.log10(1 + p.rango_ref.max)) * 100;
  assert.ok(Math.abs(M.desviacion('precip_mm_ano', 300, 0) - esperado) < 1e-9);
  assert.equal(M.desviacion('precip_mm_ano', 0, 0), 0);
  assert.ok(M.desviacion('precip_mm_ano', 10, 0) < M.desviacion('precip_mm_ano', 300, 0));
});

// Clases de entorno, métrica por componentes y cartera.
const RAIZ2 = Math.SQRT1_2;
const clasesSinteticas = () => ({
  que_es: 'Unsupervised grouping of Earth\'s land by these 3 parameters; not a prediction.',
  origen: 'mío',
  pca: {
    parametros: ['a', 'b', 'c'], media: [180, 2, 180], desviacion: [50, 0.5, 50],
    componentes: [[RAIZ2, 0, RAIZ2], [0, 1, 0]], autovalores: [1.9, 0.8],
    varianza_explicada: [0.63, 0.27, 0.1], retenidas: 2, varianza_retenida: 0.9, residuo_z_p99: 0.1,
  },
  d_ref: { valor: 3, regla: 'r' },
  clases: [
    { id: 0, rotulo: 'x', n_celdas: 1, pct_area: 50, radio: 1, centroide_componentes: [0, 0] },
    { id: 1, rotulo: 'y', n_celdas: 1, pct_area: 50, radio: 1, centroide_componentes: [2, 0] },
  ],
});
const conClases = (leer, clases) => async (ruta, tipo) => {
  if (ruta.endsWith('clases.json')) return JSON.parse(JSON.stringify(clases));
  const r = await leer(ruta, tipo);
  return tipo === 'json' ? { ...r, clases: 'clases.json' } : r;
};

test('without clases.json the engine still works: clases is null, claseDe gives null, the component metric refuses', async () => {
  const M = await cargar('base/', sintetico());
  assert.equal(M.clases, null);
  assert.equal(M.claseDe(M.leerPunto('moon', 0.25, 10.25)), null);
  assert.throws(() => M.buscar(M.leerPunto('moon', 0.25, 10.25), { metrica: 'componentes' }), /clases/);
  const roto = await cargar('base/', conClases(sintetico(), null));
  assert.equal(roto.clases, null);
});

test('default search output is byte-identical to the one pinned before classes existed, with or without clases.json', async () => {
  for (const leer of [sintetico(), conClases(sintetico(), clasesSinteticas())]) {
    const M = await cargar('base/', leer);
    const o = M.leerPunto('moon', 0.25, 10.25);
    const h = createHash('sha256');
    for (const c of [{}, { n: 8, separacion_km: 0 }, { completos: false }, { pesos: { a: 3, b: 1 } }, { parametros: ['b'] }, { incluir_casquete: true }]) h.update(huella(sinNovedades(M.buscar(o, c))));
    h.update(huella(sinNovedades(M.buscar(M.leerPunto('earth', -10.25, 20.25)))));
    assert.equal(h.digest('hex'), 'fd3a712065edfe5b60035595b17ba64d77d4fee3ce51af9138520dbc6ccf8733');
  }
});

test('claseDe: an Earth cell near a class centre falls in that class, inside its radius; missing parameters are listed', async () => {
  const M = await cargar('base/', conClases(sintetico(), clasesSinteticas()));
  const t = M.leerPunto('earth', lat(180), lon(99));
  const k = M.claseDe(t);
  assert.equal(k.id, 0); assert.equal(k.dentro, true); assert.equal(k.componentes_usadas, 2);
  assert.deepEqual(k.faltan, []);
  assert.ok(k.residuo_z < 1e-12);
  // b = 100 → segunda componente 0; a = c ≈ 180,099 → s1 = √2 · (a − 180)/50 / √1,9.
  assert.equal(t.valores.b, 100);
  assert.ok(Math.abs(k.distancia - (Math.SQRT2 * (t.valores.a - 180) / 50) / Math.sqrt(1.9)) < 1e-12);
  const lejos = M.claseDe(M.leerPunto('earth', lat(259), lon(5)));
  assert.equal(lejos.dentro, false);
  // La Luna no tiene c: se proyecta con a y b por mínimos cuadrados (a sola fija la primera componente a la mitad).
  const o = M.leerPunto('moon', 0.25, 10.25);
  const km = M.claseDe(o);
  assert.deepEqual(km.faltan, ['c']);
  const s1 = ((o.valores.a - 180) / 50) * Math.SQRT2 / Math.sqrt(1.9), s2 = (Math.log10(50) - 2) / 0.5 / Math.sqrt(0.8);
  const d0 = Math.hypot(s1, s2), d1 = Math.hypot(s1 - 2, s2);
  assert.equal(km.id, d0 <= d1 ? 0 : 1);
  assert.ok(Math.abs(km.distancia - Math.min(d0, d1)) < 1e-9);
});

test('component metric: the target cell itself is first at distance 0 and 100 %; per-parameter deviations are the usual ones', async () => {
  const M = await cargar('base/', conClases(sintetico(), clasesSinteticas()));
  const o = M.leerPunto('earth', lat(180), lon(400));
  const r = M.buscar(o, { metrica: 'componentes' });
  const p = r.resultados[0];
  assert.deepEqual([p.fila, p.col], [180, 400]);
  assert.equal(p.distancia_componentes, 0); assert.equal(p.similitud_pct, 100);
  assert.equal(r.metrica, 'componentes'); assert.equal(r.parciales.length, 0);
  const porDefecto = M.buscar(o);
  const mismo = porDefecto.resultados[0];
  assert.deepEqual(p.parametros, mismo.parametros);
  for (let i = 1; i < r.resultados.length; i++) assert.ok(r.resultados[i].distancia_componentes >= r.resultados[i - 1].distancia_componentes);
  for (const x of r.resultados) assert.ok(Math.abs(x.similitud_pct - Math.max(0, 100 * (1 - x.distancia_componentes / 3))) < 1e-9);
  assert.throws(() => M.buscar(o, { metrica: 'componentes', pesos: { a: 2 } }), /pesos/);
  assert.throws(() => M.buscar(o, { metrica: 'otra' }), /metrica/);
});

// Mundo pequeño para la cartera: 30 celdas de tierra, 4 parámetros lineales con valores pseudoaleatorios fijos.
function mundoCartera() {
  let x = 12345;
  const azar = () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; };
  const tierraI = new Set(Array.from({ length: 30 }, (_, k) => idx(150 + (k % 3), 10 + k * 7)));
  const vals = [[], [], [], []];
  for (let k = 0; k < 30; k++) for (let j = 0; j < 4; j++) vals[j].push(j === 3 ? azar() * 100 : azar() * 100);
  vals[1][4] = NaN; vals[2][9] = NaN;
  const orden = [...tierraI];
  const capa = (j) => buf((i) => (tierraI.has(i) ? vals[j][orden.indexOf(i)] : NaN));
  const ficheros = { 'earth/tierra.f32': buf((i) => (tierraI.has(i) ? 1 : 0)) };
  for (let j = 0; j < 4; j++) ficheros[`earth/p${j}.f32`] = capa(j);
  const fuente = { texto: 't', url: null };
  const fuentes = { earth: fuente, moon: fuente, mars: fuente };
  const indice = {
    rejilla: { ancho: 720, alto: 360, paso_deg: 0.5, lat0: 89.75, lon0: -179.75, fila0: 'norte' },
    cuerpos: { earth: { radio_km: 6371 }, moon: { radio_km: 1737.4 }, mars: { radio_km: 3389.5 } },
    mascara_tierra: 'earth/tierra.f32', mascara_casquete: null,
    parametros: [0, 1, 2, 3].map((j) => ({
      id: `p${j}`, capas: { earth: `earth/p${j}.f32`, moon: null, mars: null }, constante: { earth: null, moon: [50, 30, 70, 500][j], mars: null },
      fuentes, rango_ref: { min: 0, max: j === 3 ? 1000 : 100 }, transformacion: 'lineal', reproducible_en_tierra: true,
    })),
  };
  const leer = async (ruta, tipo) => (tipo === 'json' ? JSON.parse(JSON.stringify(indice)) : ficheros[ruta.replace(/^base\//, '')].slice(0));
  return { leer, celdas: orden };
}

function* combinaciones(a, k, desde = 0, pref = []) {
  if (pref.length === k) { yield pref; return; }
  for (let i = desde; i < a.length; i++) yield* combinaciones(a, k, i + 1, [...pref, a[i]]);
}

test('portfolio: smallest set of places is exact against brute force, each place covers what it says, uncovered is right', async () => {
  const { leer, celdas } = mundoCartera();
  const M = await cargar('base/', leer);
  const o = M.leerPunto('moon', 0.25, 10.25);
  const ids = ['p0', 'p1', 'p2', 'p3'];
  const tamanos = [];
  for (const corte of [10, 15, 25]) {
    const c = M.cartera(o, { corte });
    tamanos.push(c.lugares.length);
    // Fuerza bruta sobre celdas: máscara y similitud media de cada una con la desviación del motor.
    const info = celdas.map((i) => {
      const v = M.leerPunto('earth', lat(Math.floor(i / 720)), lon(i % 720)).valores;
      const d = ids.map((id) => M.desviacion(id, v[id], o.valores[id]));
      const con = d.filter((x) => x !== null);
      return { i, d, m: d.reduce((m, x, j) => (x !== null && x < corte ? m | (1 << j) : m), 0), sim: con.reduce((s, x) => s + 100 - x, 0) / con.length };
    });
    const todo = info.reduce((u, x) => u | x.m, 0);
    let mejor = null;
    for (let k = 1; k <= 4 && !mejor; k++) {
      for (const comb of combinaciones(info, k)) {
        if (comb.reduce((u, x) => u | x.m, 0) !== todo) continue;
        const media = comb.reduce((s, x) => s + x.sim, 0) / k;
        if (!mejor || media > mejor.media + 1e-12) mejor = { k, media };
      }
    }
    assert.equal(c.lugares.length, mejor.k, `corte ${corte}`);
    assert.ok(Math.abs(c.lugares.reduce((s, l) => s + l.similitud_pct, 0) / c.lugares.length - mejor.media) < 1e-9, `corte ${corte}`);
    assert.deepEqual(c.cubiertos, ids.filter((_, j) => todo & (1 << j)));
    for (const l of c.lugares) {
      for (const p of l.parametros) {
        if (l.cubre.includes(p.id)) assert.ok(p.desviacion_pct < corte, `${p.id} ${p.desviacion_pct}`);
        else assert.ok(p.desviacion_pct === null || p.desviacion_pct >= corte);
      }
    }
    assert.deepEqual(new Set(c.lugares.flatMap((l) => l.cubre)), new Set(c.cubiertos));
    assert.ok(c.sin_cubrir.some((s) => s.id === 'p3'));
    for (const s of c.sin_cubrir) {
      const j = ids.indexOf(s.id);
      const min = Math.min(...info.filter((x) => x.d[j] !== null).map((x) => x.d[j]));
      assert.equal(s.mejor_desviacion_pct, min);
      const donde = info.find((x) => x.d[j] === min).i;
      assert.deepEqual([s.lat, s.lon], [lat(Math.floor(donde / 720)), lon(donde % 720)]);
    }
    assert.deepEqual(M.cartera(o, { corte }), c);
  }
  // El caso no es trivial: hacen falta varios lugares.
  assert.ok(Math.max(...tamanos) >= 2, `${tamanos}`);
});

test('portfolio: with a separation every pair of places is at least that far apart, or it says it could not', async () => {
  const { leer } = mundoCartera();
  const M = await cargar('base/', leer);
  const c = M.cartera(M.leerPunto('moon', 0.25, 10.25), { corte: 25, separacion_km: 300 });
  assert.equal(c.separacion_km, 300);
  if (c.separacion_cumplida) {
    for (const a of c.lugares) for (const b of c.lugares) if (a !== b) {
      const rad = Math.PI / 180;
      const h = Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lon - a.lon) * rad) / 2) ** 2;
      assert.ok(2 * 6371 * Math.asin(Math.sqrt(h)) >= 300);
    }
  }
  assert.deepEqual(new Set(c.lugares.flatMap((l) => l.cubre)), new Set(c.cubiertos));
});

async function entradaReal() {
  const indice = JSON.parse(await readFile(new URL('indice.json', REAL), 'utf8'));
  const rutas = new Set([indice.mascara_tierra, indice.mascara_casquete]);
  for (const p of indice.parametros) for (const r of Object.values(p.capas ?? {})) if (r) rutas.add(r);
  // `meses` es un añadido: la huella fija las capas anuales y sus fichas.
  const h = createHash('sha256').update(JSON.stringify(indice.parametros.map(({ meses, ...p }) => p)));
  for (const r of [...rutas].sort()) h.update(r).update(await readFile(new URL(r, REAL)));
  return h.digest('hex');
}

test('real data: default search output is byte-identical to the one pinned before classes existed', { skip: !hayReal && 'sin web/data/cuerpos' }, async (t) => {
  if (await entradaReal() !== '3a443cdd9d2d6c713f6f31ed63c7f423facfb1b1f3fc15939c0f7100df808fc9') {
    t.skip('las capas cambiaron desde que se fijó la huella: rehacerla con el motor anterior');
    return;
  }
  const M = await cargar(REAL.pathname, leerDisco);
  const idsT = (M.indice.parametros_tierra ?? []).map((p) => p.id);
  const h = createHash('sha256');
  for (const [c, la, lo] of [['moon', -89.68643, -162.9371], ['moon', 8.3355, 33.222], ['mars', 18.38, 77.58], ['mars', 47.2, -175.7], ['earth', -24.1, -70.01]]) {
    h.update(huella(sinNovedades(M.buscar(M.leerPunto(c, la, lo)), idsT)));
    h.update(huella(sinNovedades(M.buscar(M.leerPunto(c, la, lo), { completos: false, n: 10, separacion_km: 100 }), idsT)));
  }
  assert.equal(h.digest('hex'), 'dfbd0c50c125d2b1acce6bdef42a84d0b26af99e04c9e03bfdd8f01354e8ee4c');
});

const hayClases = existsSync(new URL('clases.json', REAL));

test('real data: every classified Earth cell gets its own class from claseDe, and the cell nearest a centre is inside', { skip: !hayClases && 'sin clases.json' }, async () => {
  const M = await cargar(REAL.pathname, leerDisco);
  assert.ok(M.clases && M.clases.origen === 'mío');
  const clase = new Float32Array(new Uint8Array(await readFile(new URL(M.clases.capa, REAL))).buffer);
  let n = 0, distintas = 0;
  const mejor = new Map();
  for (let i = 0; i < N; i++) {
    if (!Number.isFinite(clase[i])) continue;
    n++;
    const k = M.claseDe(M.leerPunto('earth', lat(Math.floor(i / 720)), lon(i % 720)));
    assert.deepEqual(k.faltan, []);
    if (k.id !== clase[i]) distintas++;
    if (!mejor.has(k.id) || k.distancia < mejor.get(k.id).distancia) mejor.set(k.id, k);
  }
  assert.equal(n, M.clases.celdas.n);
  assert.equal(distintas, 0);
  for (const k of mejor.values()) assert.equal(k.dentro, true);
});

test('real data: the component metric finds an Earth cell itself first at distance 0', { skip: !hayClases && 'sin clases.json' }, async () => {
  const M = await cargar(REAL.pathname, leerDisco);
  const o = M.leerPunto('earth', -24.1, -70.01);
  const r = M.buscar(o, { metrica: 'componentes' });
  assert.deepEqual([r.resultados[0].fila, r.resultados[0].col], [o.fila, o.col]);
  assert.ok(r.resultados[0].distancia_componentes < 1e-9);
  assert.ok(r.resultados[0].similitud_pct > 99.99999);
  assert.deepEqual(r.resultados[0].parametros, M.buscar(o).resultados[0].parametros);
});

test('real data: Shackleton rim portfolio — each place covers what it says, and no single place covers the whole union', { skip: !hayReal && 'sin web/data/cuerpos' }, async () => {
  const M = await cargar(REAL.pathname, leerDisco);
  const o = M.leerPunto('moon', -89.68643, -162.9371);
  const c = M.cartera(o);
  console.log(`Shackleton portfolio: ${c.lugares.map((l) => `${l.lat}, ${l.lon} covers ${l.cubre.join('+')}`).join(' | ')}; not covered: ${c.sin_cubrir.map((s) => `${s.id} best ${s.mejor_desviacion_pct.toFixed(1)} % at ${s.lat}, ${s.lon}`).join('; ')}`);
  assert.deepEqual(c, M.cartera(o));
  for (const l of c.lugares) for (const p of l.parametros) assert.equal(l.cubre.includes(p.id), p.desviacion_pct !== null && p.desviacion_pct < 15);
  const union = new Set(c.lugares.flatMap((l) => l.cubre));
  assert.deepEqual(union, new Set(c.cubiertos));
  if (c.lugares.length > 1) {
    const casquete = new Float32Array(new Uint8Array(await readFile(new URL(M.indice.mascara_casquete, REAL))).buffer);
    for (let i = 0; i < N; i++) {
      if (!(M.tierra[i] >= 0.5) || casquete[i] === 1) continue;
      const v = M.leerPunto('earth', lat(Math.floor(i / 720)), lon(i % 720)).valores;
      assert.ok(!c.cubiertos.every((id) => { const d = M.desviacion(id, v[id], o.valores[id]); return d !== null && d < 15; }), `cell ${i} covers everything`);
    }
  }
});

// Parámetros solo-Tierra (indice.parametros_tierra) y referencia terrestre.
function conTierra(leer) {
  const fila = (i) => Math.floor(i / 720), col = (i) => i % 720;
  const enTierra = (i) => fila(i) >= 100 && fila(i) < 260;
  const ficheros = {
    'earth/x.f32': buf((i) => (enTierra(i) && !(fila(i) >= 200 && fila(i) < 210) ? col(i) : NaN)),
    'earth/y.f32': buf((i) => (enTierra(i) ? 1 + fila(i) : NaN)),
    'earth/lito.f32': buf((i) => (enTierra(i) && col(i) % 50 !== 7 ? 1 + (col(i) % 3) : NaN)),
  };
  const fuentes = { earth: { texto: 't', url: 'https://example.org' } };
  const extra = [
    { id: 'x', nombre: 'X', grupo: 'g', unidad: 'u', capas: { earth: 'earth/x.f32' }, fuentes, definicion: 'd', aviso: null, solo_tierra: true,
      rango_ref: { min: 0, max: 720, origen: 'mío', regla: 'r' }, transformacion: 'lineal' },
    { id: 'y', nombre: 'Y', grupo: 'g', unidad: 'u', capas: { earth: 'earth/y.f32' }, fuentes, definicion: 'd', aviso: null, solo_tierra: true,
      rango_ref: { min: 1, max: 1000, origen: 'mío', regla: 'r' }, transformacion: 'log10' },
    { id: 'lito', nombre: 'Rock type', grupo: 'geology', unidad: 'class', capas: { earth: 'earth/lito.f32' }, fuentes, definicion: 'd', aviso: null, solo_tierra: true,
      rango_ref: null, transformacion: 'categoria', clases: { 1: 'uno', 2: 'dos', 3: 'tres' } },
  ];
  return async (ruta, tipo) => {
    const r = ruta.replace(/^base\//, '');
    if (tipo === 'json' && !ruta.endsWith('clases.json')) return { ...(await leer(ruta, tipo)), parametros_tierra: JSON.parse(JSON.stringify(extra)) };
    return ficheros[r] ? ficheros[r].slice(0) : leer(ruta, tipo);
  };
}
const LUNA = [0.25, 10.25];
const cerca = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) < tol, `${a} vs ${b}`);

test('Earth-only parameters: leerPunto gives their Earth values; the Moon and Mars get null', async () => {
  const M = await cargar('base/', conTierra(sintetico()));
  const t = M.leerPunto('earth', lat(150), lon(300));
  assert.deepEqual([t.valores.x, t.valores.y, t.valores.lito], [300, 151, 1]);
  for (const c of ['moon', 'mars']) {
    const o = M.leerPunto(c, ...LUNA);
    assert.deepEqual([o.valores.x, o.valores.y, o.valores.lito], [null, null, null]);
  }
  const M0 = await cargar('base/', sintetico());
  const { x, y, lito, ...resto } = M.leerPunto('moon', ...LUNA).valores;
  assert.deepEqual(resto, M0.leerPunto('moon', ...LUNA).valores);
});

test('Earth-only parameters in the index do not change a search or a portfolio that does not ask for them', async () => {
  const M0 = await cargar('base/', sintetico());
  const M = await cargar('base/', conTierra(sintetico()));
  const o = M0.leerPunto('moon', ...LUNA);
  for (const c of [{}, { completos: false }, { parametros: ['b'] }, { pesos: { a: 3, b: 1 } }]) assert.deepEqual(M.buscar(o, c), M0.buscar(o, c));
  assert.deepEqual(M.cartera(o), M0.cartera(o));
  const r = M.buscar(o);
  assert.deepEqual(r.sin_referencia, []);
  assert.ok(r.resultados.every((x) => x.parametros.every((p) => p.origen_objetivo === 'punto')));
});

test('mixing: point parameters are compared with the Moon point, Earth-only ones with the reference cell on Earth', async () => {
  const M = await cargar('base/', conTierra(sintetico()));
  const o = M.leerPunto('moon', ...LUNA);
  const r = M.buscar(o, { parametros: ['a', 'x'], referencia: { lat: lat(150), lon: lon(300) } });
  assert.deepEqual(r.usados, ['a', 'x']);
  assert.deepEqual(r.sin_dato, []); assert.deepEqual(r.sin_referencia, []);
  assert.equal(r.resultados.length, 5);
  for (const c of r.resultados) {
    const pa = c.parametros.find((p) => p.id === 'a'), px = c.parametros.find((p) => p.id === 'x');
    assert.equal(pa.origen_objetivo, 'punto'); assert.equal(pa.valor_objetivo, o.valores.a);
    assert.equal(px.origen_objetivo, 'referencia'); assert.equal(px.valor_objetivo, 300); assert.equal(px.valor_tierra, c.col);
    cerca(px.desviacion_pct, (Math.abs(c.col - 300) / 720) * 100);
    cerca(c.similitud_pct, (200 - pa.desviacion_pct - px.desviacion_pct) / 2);
  }
  const da = M.desviacion('a', 150 + 20 / 1000, o.valores.a), dx = M.desviacion('x', 20, 300);
  cerca(r.mapa[idx(150, 20)], (200 - da - dx) / 2, 1e-3);
});

test('an Earth-only parameter without a reference, or without data at the reference, is not used and is listed in sin_referencia', async () => {
  const M = await cargar('base/', conTierra(sintetico()));
  const o = M.leerPunto('moon', ...LUNA);
  for (const opc of [{ parametros: ['a', 'x'] }, { parametros: ['a', 'x'], referencia: { lat: lat(205), lon: lon(300) } }]) {
    const r = M.buscar(o, opc);
    assert.deepEqual(r.usados, ['a']); assert.deepEqual(r.sin_referencia, ['x']); assert.deepEqual(r.sin_dato, []);
    const px = r.resultados[0].parametros.find((p) => p.id === 'x');
    assert.deepEqual([px.valor_objetivo, px.desviacion_pct, px.estado, px.origen_objetivo], [null, null, 'sin_referencia', 'referencia']);
  }
  const r = M.buscar(o, { parametros: ['c', 'x'] });
  assert.deepEqual([r.usados, r.sin_dato, r.sin_referencia, r.resultados], [[], ['c'], ['x'], []]);
  // Un objetivo de la Tierra tampoco pone el valor solo-Tierra: sale de la referencia.
  assert.deepEqual(M.buscar(M.leerPunto('earth', lat(150), lon(300)), { parametros: ['a', 'x'] }).sin_referencia, ['x']);
});

test('categorical rock type: 0 % deviation for the same class, 100 % for another, no data stays out', async () => {
  const M = await cargar('base/', conTierra(conClases(sintetico(), clasesSinteticas())));
  assert.equal(M.desviacion('lito', 2, 2), 0);
  assert.equal(M.desviacion('lito', 2, 3), 100);
  assert.equal(M.desviacion('lito', null, 2), null);
  const o = M.leerPunto('moon', ...LUNA);
  const ref = { lat: lat(150), lon: lon(301) };
  const r = M.buscar(o, { parametros: ['lito'], referencia: ref, separacion_km: 0 });
  for (const c of r.resultados) {
    assert.equal(c.similitud_pct, 100);
    assert.equal(c.parametros[0].valor_tierra, 2); assert.equal(c.parametros[0].valor_objetivo, 2);
  }
  assert.equal(r.mapa[idx(150, 301)], 100);
  assert.equal(r.mapa[idx(150, 300)], 0);
  assert.ok(Number.isNaN(r.mapa[idx(150, 57)]));
  assert.throws(() => M.buscar(o, { metrica: 'componentes', parametros: ['lito'], referencia: ref }), /parametros/);
});

test('only Earth-only parameters with the reference at a site: that site comes first at 100 %', async () => {
  const M = await cargar('base/', conTierra(sintetico()));
  const r = M.buscar(M.leerPunto('mars', ...LUNA), { parametros: ['x', 'y', 'lito'], referencia: { lat: lat(150), lon: lon(301) } });
  const p = r.resultados[0];
  assert.deepEqual([p.fila, p.col, p.similitud_pct], [150, 301, 100]);
  for (const x of p.parametros) { assert.equal(x.desviacion_pct, 0); assert.equal(x.origen_objetivo, 'referencia'); }
  assert.ok(r.resultados.slice(1).every((x) => x.similitud_pct < 100));
});

test('unknown parameter ids and a reference off the grid are refused with a clear error', async () => {
  const M = await cargar('base/', conTierra(sintetico()));
  const o = M.leerPunto('moon', ...LUNA);
  assert.throws(() => M.buscar(o, { parametros: ['nada'] }), /parámetro desconocido: nada/);
  assert.throws(() => M.cartera(o, { parametros: ['nada'] }), /parámetro desconocido: nada/);
  for (const referencia of [{ lat: 95, lon: 0 }, { lat: NaN, lon: 0 }, {}]) {
    assert.throws(() => M.buscar(o, { parametros: ['x'], referencia }), /referencia fuera de la rejilla/);
    assert.throws(() => M.cartera(o, { parametros: ['x'], referencia }), /referencia fuera de la rejilla/);
  }
});

test('portfolio takes parametros and referencia with the same meaning; by default it still uses every reproducible parameter', async () => {
  const M = await cargar('base/', conTierra(sintetico()));
  const o = M.leerPunto('moon', ...LUNA);
  assert.deepEqual(M.cartera(o).usados, ['a', 'b']);
  const c = M.cartera(o, { parametros: ['a', 'x', 'lito'], referencia: { lat: lat(150), lon: lon(300) } });
  assert.deepEqual(c.usados, ['a', 'x', 'lito']); assert.deepEqual(c.sin_referencia, []);
  assert.ok(c.lugares.length >= 1);
  for (const l of c.lugares) {
    for (const p of l.parametros) {
      assert.equal(l.cubre.includes(p.id), p.desviacion_pct !== null && p.desviacion_pct < 15, p.id);
      assert.equal(p.origen_objetivo, p.id === 'a' ? 'punto' : 'referencia');
    }
  }
  assert.deepEqual(new Set(c.lugares.flatMap((l) => l.cubre)), new Set(c.cubiertos));
  const sin = M.cartera(o, { parametros: ['a', 'x'] });
  assert.deepEqual([sin.usados, sin.sin_referencia], [['a'], ['x']]);
});

test('real data: without the new options buscar, cartera, claseDe and leerPunto give what they gave before Earth-only parameters', { skip: !hayReal && 'sin web/data/cuerpos' }, async (t) => {
  if (await entradaReal() !== '3a443cdd9d2d6c713f6f31ed63c7f423facfb1b1f3fc15939c0f7100df808fc9') {
    t.skip('las capas cambiaron desde que se fijó la huella');
    return;
  }
  const M = await cargar(REAL.pathname, leerDisco);
  const idsT = M.indice.parametros_tierra.map((p) => p.id);
  const o = M.leerPunto('mars', 18.38, 77.58);
  const h = createHash('sha256');
  h.update(huella(sinNovedades(M.buscar(o), idsT)));
  h.update(huella(sinNovedades(M.buscar(o, { completos: false, parametros: ['precip_mm_ano', 't_min_k'] }), idsT)));
  h.update(JSON.stringify(sinNovedades(M.cartera(o), idsT)));
  h.update(JSON.stringify(M.claseDe(o)));
  const e = M.leerPunto('earth', -24.1, -70.01);
  h.update(JSON.stringify({ ...e, valores: Object.fromEntries(Object.entries(e.valores).filter(([k]) => !idsT.includes(k))) }));
  assert.equal(h.digest('hex'), '287c142cee58e60a34074cefa094e3c881297a9ccee7c33d177595fc063c89ec');
});

test('real data: Earth-only parameters only, reference at Yungay (Atacama): Yungay\'s cell comes first at 100 %', { skip: !hayReal && 'sin web/data/cuerpos' }, async () => {
  const M = await cargar(REAL.pathname, leerDisco);
  const ids = M.indice.parametros_tierra.map((p) => p.id);
  const ref = { lat: -24.08, lon: -69.92 };
  const c = M.leerPunto('earth', ref.lat, ref.lon);
  const r = M.buscar(M.leerPunto('mars', 18.38, 77.58), { parametros: ids, referencia: ref });
  assert.deepEqual(r.sin_referencia, ids.filter((id) => c.valores[id] === null));
  assert.deepEqual([r.resultados[0].fila, r.resultados[0].col, r.resultados[0].similitud_pct], [c.fila, c.col, 100]);
});

// Capas mensuales de la Tierra (indice[...].meses): solo se bajan con cargarMeses.
function bufI16(fn) {
  const dv = new DataView(new ArrayBuffer(12 * N * 2));
  for (let m = 1; m <= 12; m++) for (let i = 0; i < N; i++) dv.setInt16(((m - 1) * N + i) * 2, fn(m, i), true);
  return dv.buffer;
}
// a del mes m = fila + 10·(m − 1) (escala 0,5); sin dato en el océano y en la columna 5 de marzo. x del mes m = col + m − 1.
function conMeses(leer, lecturas = []) {
  const fila = (i) => Math.floor(i / 720), col = (i) => i % 720;
  const ficheros = {
    'earth/mes/a.i16': bufI16((m, i) => (fila(i) < 100 || (m === 3 && col(i) === 5) ? -32768 : 2 * (fila(i) + 10 * (m - 1)))),
    'earth/mes/x.i16': bufI16((m, i) => (fila(i) >= 100 && fila(i) < 260 && !(fila(i) >= 200 && fila(i) < 210) ? col(i) + m - 1 : -32768)),
  };
  const fuente = { texto: 't', url: 'https://example.org' };
  const meses = {
    a: { earth: 'earth/mes/a.i16', escala: 0.5, desplazamiento: 0, sin_dato: -32768, fuente, aviso: 'a' },
    x: { earth: 'earth/mes/x.i16', escala: 1, desplazamiento: 0, sin_dato: -32768, fuente, aviso: 'x' },
  };
  return async (ruta, tipo) => {
    const r = ruta.replace(/^base\//, '');
    lecturas.push(r);
    if (ficheros[r]) return ficheros[r].slice(0);
    const v = await leer(ruta, tipo);
    if (tipo === 'json' && !ruta.endsWith('clases.json')) for (const p of [...v.parametros, ...(v.parametros_tierra ?? [])]) if (meses[p.id]) p.meses = meses[p.id];
    return v;
  };
}
const valorDe = (r, id) => r.parametros.find((p) => p.id === id);

test('months: loading reads no monthly file, and without mes buscar and cartera give exactly what they gave', async () => {
  const lecturas = [];
  const M = await cargar('base/', conMeses(conTierra(sintetico()), lecturas));
  const M0 = await cargar('base/', conTierra(sintetico()));
  assert.ok(!lecturas.some((r) => r.includes('/mes/')), lecturas.join(' '));
  assert.deepEqual(M.conMeses, ['a', 'x']);
  assert.deepEqual(M0.conMeses, []);
  const o = M.leerPunto('moon', ...LUNA);
  const opcs = [{}, { completos: false }, { parametros: ['b'] }, { pesos: { a: 3, b: 1 } }, { parametros: ['a', 'x'], referencia: { lat: lat(150), lon: lon(300) } }];
  const compara = () => {
    for (const c of opcs) assert.deepEqual(M.buscar(o, c), M0.buscar(o, c));
    assert.deepEqual(M.cartera(o), M0.cartera(o));
  };
  compara();
  assert.deepEqual(await M.cargarMeses(), ['a', 'x']);
  compara();
  assert.ok(!('mes' in M.buscar(o)) && !('mensuales' in M.buscar(o)));
});

test('months: cargarMeses reads each monthly file once, even when called twice at the same time', async () => {
  const lecturas = [];
  const M = await cargar('base/', conMeses(conTierra(sintetico()), lecturas));
  const [r1, r2] = await Promise.all([M.cargarMeses(['a']), M.cargarMeses()]);
  assert.deepEqual([r1, r2], [['a'], ['a', 'x']]);
  await M.cargarMeses();
  assert.equal(lecturas.filter((r) => r === 'earth/mes/a.i16').length, 1);
  assert.equal(lecturas.filter((r) => r === 'earth/mes/x.i16').length, 1);
  await assert.rejects(M.cargarMeses(['nada']), /parámetro desconocido: nada/);
  await assert.rejects(M.cargarMeses(['b']), /sin versión mensual: b/);
});

test('months: with mes only the parameters that have a monthly layer take that month\'s Earth value; the target stays the same', async () => {
  const M = await cargar('base/', conMeses(conTierra(sintetico())));
  await M.cargarMeses();
  const o = M.leerPunto('moon', ...LUNA);
  const r = M.buscar(o, { mes: 7, n: 8, separacion_km: 0 });
  assert.equal(r.mes, 7);
  assert.deepEqual(r.mensuales, ['a']);
  for (const x of r.resultados) {
    assert.equal(valorDe(x, 'a').valor_tierra, x.fila + 60);
    assert.equal(valorDe(x, 'a').valor_objetivo, o.valores.a);
    assert.equal(valorDe(x, 'b').valor_tierra, 1 + x.col);
  }
  const i = idx(150, 20);
  const da = M.desviacion('a', 150 + 60, o.valores.a), db = M.desviacion('b', 21, 50);
  cerca(r.mapa[i], (200 - da - db) / 2, 1e-3);
  // Enero: a = fila → el mejor es la fila 150 (a de la Luna ≈ 150); julio: a = fila + 60 → la fila 100 (primera de tierra).
  assert.equal(M.buscar(o, { mes: 1, parametros: ['a'] }).resultados[0].fila, 150);
  assert.equal(M.buscar(o, { mes: 7, parametros: ['a'] }).resultados[0].fila, 100);
  // Sin dato del mes: la celda no tiene a ese mes.
  const marzo = M.buscar(o, { mes: 3, completos: false });
  cerca(marzo.mapa[idx(150, 5)], 100 - M.desviacion('b', 6, 50), 1e-3);
  assert.equal(marzo.cobertura[idx(150, 5)], 1);
  // Cartera: el mismo valor del mes.
  const c = M.cartera(o, { mes: 7 });
  assert.equal(c.mes, 7); assert.deepEqual(c.mensuales, ['a']);
  for (const l of c.lugares) assert.equal(valorDe(l, 'a').valor_tierra, l.fila + 60);
});

test('months: an Earth-only parameter with a monthly layer takes the month at the result cells and at the reference', async () => {
  const M = await cargar('base/', conMeses(conTierra(sintetico())));
  await M.cargarMeses();
  const o = M.leerPunto('moon', ...LUNA);
  const r = M.buscar(o, { mes: 4, parametros: ['a', 'x', 'y'], referencia: { lat: lat(150), lon: lon(300) } });
  assert.deepEqual(r.mensuales, ['a', 'x']);
  for (const x of r.resultados) {
    const px = valorDe(x, 'x');
    assert.equal(px.valor_objetivo, 303); assert.equal(px.valor_tierra, x.col + 3);
    assert.equal(valorDe(x, 'y').valor_objetivo, 151);
  }
});

test('months: errors — mes without cargarMeses, mes out of 1-12, mes with the component metric', async () => {
  const M = await cargar('base/', conMeses(conTierra(conClases(sintetico(), clasesSinteticas()))));
  const o = M.leerPunto('moon', ...LUNA);
  assert.throws(() => M.buscar(o, { mes: 1 }), /cargarMeses/);
  assert.throws(() => M.cartera(o, { mes: 1 }), /cargarMeses/);
  assert.throws(() => M.perfilMensual(o, { lat: lat(150), lon: lon(20) }), /cargarMeses/);
  assert.throws(() => M.calendario(o), /cargarMeses/);
  // Sin parámetros con mes no hace falta cargar nada.
  assert.deepEqual(M.buscar(o, { mes: 2, parametros: ['b'] }).mensuales, []);
  await M.cargarMeses(['a']);
  assert.throws(() => M.buscar(o, { mes: 1, parametros: ['a', 'x'], referencia: { lat: lat(150), lon: lon(300) } }), /cargarMeses/);
  for (const mes of [0, 13, 1.5, '3', NaN]) {
    assert.throws(() => M.buscar(o, { mes }), /mes/);
    assert.throws(() => M.cartera(o, { mes }), /mes/);
  }
  assert.throws(() => M.buscar(o, { mes: 1, metrica: 'componentes' }), /componentes/);
  assert.throws(() => M.perfilMensual(o, { lat: 95, lon: 0 }), /fuera de la rejilla/);
  assert.throws(() => M.calendario(o, { lugar: { lat: NaN, lon: 0 } }), /fuera de la rejilla/);
});

test('months: perfilMensual of month m gives the same similarity and values as buscar with mes m at that cell', async () => {
  const M = await cargar('base/', conMeses(conTierra(sintetico())));
  await M.cargarMeses();
  const o = M.leerPunto('moon', ...LUNA);
  for (const opc of [{}, { pesos: { a: 3, b: 1 } }, { parametros: ['a', 'x'], referencia: { lat: lat(150), lon: lon(300) } }]) {
    const celda = { lat: lat(150), lon: lon(5) };
    const p = M.perfilMensual(o, celda, opc);
    assert.deepEqual(p.map((x) => x.mes), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    for (const x of p) {
      // La celda fija frente al mapa de buscar (Float32) y la mejor celda del mes frente a su ficha completa.
      const r = M.buscar(o, { ...opc, mes: x.mes, completos: false });
      assert.equal(Math.fround(x.similitud_pct), r.mapa[idx(150, 5)]);
      assert.equal(x.comparados, r.cobertura[idx(150, 5)]);
      const b = r.resultados[0];
      const pb = M.perfilMensual(o, { lat: b.lat, lon: b.lon }, opc)[x.mes - 1];
      assert.equal(pb.similitud_pct, b.similitud_pct);
      assert.equal(pb.comparados, b.comparados);
      assert.deepEqual(pb.parametros, r.usados.map((id) => ({ id, valor_tierra: valorDe(b, id).valor_tierra, desviacion_pct: valorDe(b, id).desviacion_pct })));
    }
  }
  // Marzo en la columna 5: a sin dato → 1 de 2 comparados.
  const marzo = M.perfilMensual(o, { lat: lat(150), lon: lon(5) })[2];
  assert.equal(marzo.comparados, 1);
  assert.equal(marzo.parametros.find((q) => q.id === 'a').valor_tierra, null);
});

test('months: calendario gives, month by month, the first place buscar gives, the similarity at a chosen place and whether it moves', async () => {
  const M = await cargar('base/', conMeses(conTierra(sintetico())));
  await M.cargarMeses();
  const o = M.leerPunto('moon', ...LUNA);
  const lugar = { lat: lat(150), lon: lon(10) };
  for (const opc of [{ parametros: ['a'] }, {}, { incluir_casquete: true }]) {
    const cal = M.calendario(o, { ...opc, lugar });
    assert.equal(cal.length, 12);
    for (const x of cal) {
      const r = M.buscar(o, { ...opc, mes: x.mes });
      const b = r.resultados[0];
      assert.deepEqual([x.lat, x.lon, x.similitud_pct], [b.lat, b.lon, b.similitud_pct]);
      assert.equal(x.en_lugar_pct, M.perfilMensual(o, lugar, opc)[x.mes - 1].similitud_pct);
      assert.equal(x.relevo, !(b.lat === lugar.lat && b.lon === lugar.lon));
    }
    assert.ok(!('en_lugar_pct' in M.calendario(o, opc)[0]));
  }
  const cal = M.calendario(o, { parametros: ['a'], lugar: { lat: lat(150), lon: lon(10) } });
  assert.deepEqual([cal[0].relevo, cal[6].relevo], [true, true]);
  assert.equal(cal[0].lat, lat(150));
});

test('real data: monthly layers — January and July best places for Jezero differ; perfilMensual and calendario agree with buscar', { skip: !hayReal && 'sin web/data/cuerpos' }, async (t) => {
  const lecturas = [];
  const leer = async (r, tipo) => { lecturas.push(r); return leerDisco(r, tipo); };
  const M = await cargar(REAL.pathname, leer);
  if (!M.conMeses.length) { t.skip('índice sin capas mensuales'); return; }
  assert.ok(!lecturas.some((r) => r.includes('/mes/')));
  const t0 = performance.now();
  await M.cargarMeses();
  console.log(`cargarMeses: ${M.conMeses.length} files in ${(performance.now() - t0).toFixed(0)} ms`);
  const o = M.leerPunto('mars', 18.38, 77.58);
  const ene = M.buscar(o, { mes: 1 }), jul = M.buscar(o, { mes: 7 });
  console.log(`Jezero best January ${ene.resultados[0].lat}, ${ene.resultados[0].lon} ${ene.resultados[0].similitud_pct.toFixed(1)} %; July ${jul.resultados[0].lat}, ${jul.resultados[0].lon} ${jul.resultados[0].similitud_pct.toFixed(1)} %`);
  assert.notDeepEqual([ene.resultados[0].lat, ene.resultados[0].lon], [jul.resultados[0].lat, jul.resultados[0].lon]);
  assert.deepEqual(ene.mensuales, M.conMeses.filter((id) => ene.usados.includes(id)));
  const b = jul.resultados[0];
  const p = M.perfilMensual(o, { lat: b.lat, lon: b.lon })[6];
  assert.equal(p.similitud_pct, b.similitud_pct);
  const t1 = performance.now();
  const cal = M.calendario(o);
  const ms = performance.now() - t1;
  console.log(`calendario: ${ms.toFixed(0)} ms`);
  assert.ok(ms < 5000, `${ms} ms`);
  for (const m of [1, 7]) {
    const r = m === 1 ? ene : jul;
    assert.deepEqual([cal[m - 1].lat, cal[m - 1].lon, cal[m - 1].similitud_pct], [r.resultados[0].lat, r.resultados[0].lon, r.resultados[0].similitud_pct]);
  }
});

// Las huellas fijadas arriba hashean indice.parametros; con `meses` en el índice esas dos pruebas se saltan. Esta repite
// las dos comprobaciones con la entrada hasheada sin `meses`: lo único que añadieron las capas mensuales al índice.
async function entradaRealSinMeses() {
  const indice = JSON.parse(await readFile(new URL('indice.json', REAL), 'utf8'));
  const rutas = new Set([indice.mascara_tierra, indice.mascara_casquete]);
  for (const p of indice.parametros) for (const r of Object.values(p.capas ?? {})) if (r) rutas.add(r);
  const h = createHash('sha256').update(JSON.stringify(indice.parametros.map(({ meses, ...p }) => p)));
  for (const r of [...rutas].sort()) h.update(r).update(await readFile(new URL(r, REAL)));
  return h.digest('hex');
}

test('real data: with monthly layers in the index, the default outputs keep both pinned fingerprints', { skip: !hayReal && 'sin web/data/cuerpos' }, async (t) => {
  if (await entradaRealSinMeses() !== '3a443cdd9d2d6c713f6f31ed63c7f423facfb1b1f3fc15939c0f7100df808fc9') {
    t.skip('las capas cambiaron desde que se fijó la huella');
    return;
  }
  const M = await cargar(REAL.pathname, leerDisco);
  const idsT = M.indice.parametros_tierra.map((p) => p.id);
  const h1 = createHash('sha256');
  for (const [c, la, lo] of [['moon', -89.68643, -162.9371], ['moon', 8.3355, 33.222], ['mars', 18.38, 77.58], ['mars', 47.2, -175.7], ['earth', -24.1, -70.01]]) {
    h1.update(huella(sinNovedades(M.buscar(M.leerPunto(c, la, lo)), idsT)));
    h1.update(huella(sinNovedades(M.buscar(M.leerPunto(c, la, lo), { completos: false, n: 10, separacion_km: 100 }), idsT)));
  }
  assert.equal(h1.digest('hex'), 'dfbd0c50c125d2b1acce6bdef42a84d0b26af99e04c9e03bfdd8f01354e8ee4c');
  await M.cargarMeses();
  const o = M.leerPunto('mars', 18.38, 77.58);
  const h2 = createHash('sha256');
  h2.update(huella(sinNovedades(M.buscar(o), idsT)));
  h2.update(huella(sinNovedades(M.buscar(o, { completos: false, parametros: ['precip_mm_ano', 't_min_k'] }), idsT)));
  h2.update(JSON.stringify(sinNovedades(M.cartera(o), idsT)));
  h2.update(JSON.stringify(M.claseDe(o)));
  const e = M.leerPunto('earth', -24.1, -70.01);
  h2.update(JSON.stringify({ ...e, valores: Object.fromEntries(Object.entries(e.valores).filter(([k]) => !idsT.includes(k))) }));
  assert.equal(h2.digest('hex'), '287c142cee58e60a34074cefa094e3c881297a9ccee7c33d177595fc063c89ec');
});

test('reverse search: cells of another world most like a set of reference values, on the parameters that world has', async () => {
  const M = await cargar('base/', sintetico());
  const r = M.parecidosEnCuerpo('moon', { a: 150.3, b: 50, c: 5 }, ['a', 'b', 'c']);
  assert.deepEqual(r.usados, ['a', 'b']);
  assert.deepEqual(r.sin_capa, ['c']);
  assert.deepEqual(r.sin_referencia, []);
  assert.equal(r.celdas, N);
  // moon/a = 150 + col/1000: column 300 is the exact match on every row; the first row wins the tie.
  assert.deepEqual([r.candidatos[0].lat, r.candidatos[0].lon], [lat(0), lon(300)]);
  assert.ok(Math.abs(r.candidatos[0].similitud_pct - 100) < 1e-3);
  assert.ok(Math.abs(r.candidatos[0].valores.a - 150.3) < 1e-4 && r.candidatos[0].valores.b === 50);
  for (let k = 1; k < r.candidatos.length; k++) assert.ok(r.candidatos[k].similitud_pct <= r.candidatos[k - 1].similitud_pct);
  // The whole synthetic Moon is within 0.5 points of the best: all of it ties, and the result says so.
  assert.equal(r.empatadas, N);
  assert.equal(r.candidatos.length, 3000);
  const polo = M.parecidosEnCuerpo('moon', { a: 150.3, b: 50 }, ['a', 'b'], { filtro: (la) => la <= -84, maximo: 10 });
  assert.equal(polo.candidatos.length, 10);
  assert.ok(polo.candidatos.every((c) => c.lat <= -84));
  assert.deepEqual([polo.candidatos[0].lat, polo.candidatos[0].lon], [-84.25, lon(300)]);
  assert.equal(polo.celdas, 12 * 720);
});

test('reverse search without anything to compare returns no candidates and says why; unknown names throw', async () => {
  const M = await cargar('base/', sintetico());
  const soloTierra = M.parecidosEnCuerpo('moon', { c: 5 }, ['c']);
  assert.deepEqual([soloTierra.usados, soloTierra.sin_capa, soloTierra.candidatos, soloTierra.celdas], [[], ['c'], [], 0]);
  const sinRef = M.parecidosEnCuerpo('moon', { a: null }, ['a']);
  assert.deepEqual([sinRef.usados, sinRef.sin_referencia, sinRef.candidatos.length], [[], ['a'], 0]);
  // Mars has no layer for a or b in the synthetic index.
  assert.deepEqual(M.parecidosEnCuerpo('mars', { a: 1, b: 2 }, ['a', 'b']).sin_capa, ['a', 'b']);
  assert.throws(() => M.parecidosEnCuerpo('venus', {}, ['a']), /cuerpo desconocido/);
  assert.throws(() => M.parecidosEnCuerpo('moon', {}, ['zz']), /parámetro desconocido/);
  const nada = M.parecidosEnCuerpo('moon', { a: 150 }, ['a'], { filtro: () => false });
  assert.deepEqual([nada.usados, nada.candidatos.length, nada.celdas], [['a'], 0, 0]);
});
