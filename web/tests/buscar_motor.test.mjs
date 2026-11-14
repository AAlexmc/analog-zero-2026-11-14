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
