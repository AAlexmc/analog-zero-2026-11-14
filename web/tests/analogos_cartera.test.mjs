import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { cargar } from '../buscar/motor.js';
import { PALETA, mezclar } from '../marca/contraste.js';
import {
  letra, nombreCorto, NOMBRE_CORTO, titularCartera, fraseSinCubrir, reglaCartera, lineaEntorno, comoSabemos, COLORES_CLASE, pintarClases,
  tablaComparar, sitiosConCoordenadas, lineaContexto, tipoAnalogo, fraseUnlisted, masCercano, fmtPct, lineaDistancia, textoComponentes,
} from '../analogos/metricas.js';

const DATOS = new URL('../data/', import.meta.url);
const M = await cargar(new URL('cuerpos/', DATOS).pathname, async (ruta, tipo) => {
  const b = await readFile(ruta);
  return tipo === 'json' ? JSON.parse(b.toString('utf8')) : b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
});
const P = Object.fromEntries(M.indice.parametros.map((p) => [p.id, p]));
const SITIOS = JSON.parse(readFileSync(new URL('sitios_ensayo.json', DATOS), 'utf8')).sitios;
const SHACKLETON = M.leerPunto('moon', -89.68643, -162.9371);
const JEZERO = M.leerPunto('mars', 18.38, 77.58);

test('portfolio letters and plain parameter names: every reproducible parameter has a short name', () => {
  assert.deepEqual([0, 1, 2].map(letra), ['A', 'B', 'C']);
  for (const p of M.indice.parametros.filter((p) => p.reproducible_en_tierra)) assert.ok(NOMBRE_CORTO[p.id], p.id);
  assert.equal(nombreCorto('t_min_k', P), 'night-time low');
  assert.equal(nombreCorto('gravedad_m_s2', P), 'Gravity');
  assert.equal(nombreCorto('desconocido', P), 'desconocido');
});

test('portfolio headline at the Shackleton rim (real engine): 2 places cover 6 of 8, two temperatures left for the lab', () => {
  const c = M.cartera(SHACKLETON);
  assert.equal(titularCartera(c), 'No single place on Earth matches everything. Together, these 2 places cover 6 of 8 parameters.');
  assert.deepEqual(c.sin_cubrir.map((s) => s.id), ['t_min_k', 't_media_k']);
  assert.equal(fraseSinCubrir(c.sin_cubrir[0], '79.75° S, 153.25° E'), `The closest any place gets is ${fmtPct(c.sin_cubrir[0].mejor_desviacion_pct)} off, at 79.75° S, 153.25° E.`);
  assert.match(fraseSinCubrir(c.sin_cubrir[0], 'x'), /68\.0 % off/);
  assert.equal(reglaCartera(c)[0], 'A parameter is covered at a place when its deviation there is under 15 % (the "close match" cut-off of Metrics; own criterion).');
});

test('portfolio headline at Jezero (real engine): 2 places cover 7 of 8; the first one is partly compared (Antarctica)', () => {
  const c = M.cartera(JEZERO);
  assert.equal(titularCartera(c), 'No single place on Earth matches everything. Together, these 2 places cover 7 of 8 parameters.');
  assert.equal(c.lugares[0].comparados, 5);
  assert.deepEqual(c.sin_cubrir.map((s) => s.id), ['t_min_k']);
});

test('portfolio headline edge cases: one place covers all, one place covers part, nothing covered, nothing compared', () => {
  const base = { corte: 15, usados: ['a', 'b', 'c'] };
  assert.equal(titularCartera({ ...base, lugares: [{}], cubiertos: ['a', 'b', 'c'], sin_cubrir: [] }), 'One place on Earth covers all 3 parameters.');
  assert.equal(titularCartera({ ...base, lugares: [{}], cubiertos: ['a'], sin_cubrir: [{}, {}] }), 'No single place on Earth matches everything. This place covers 1 of 3 parameters.');
  assert.equal(titularCartera({ ...base, lugares: [], cubiertos: [], sin_cubrir: [{}, {}, {}] }), 'No place on Earth comes within 15 % on any of the 3 parameters.');
  assert.equal(titularCartera({ corte: 15, usados: [], lugares: [], cubiertos: [], sin_cubrir: [] }), 'No parameter could be compared at this point.');
  assert.equal(fraseSinCubrir({ id: 'a', mejor_desviacion_pct: null, lat: null, lon: null }, ''), 'No place on Earth has data for it.');
});

test('environment type line from the real engine: Shackleton rim and Jezero fall outside all 6 types', () => {
  const s = M.claseDe(SHACKLETON), j = M.claseDe(JEZERO);
  assert.equal(lineaEntorno(s, M.clases.clases.length), 'Earth has nothing quite like this: its conditions fall outside all 6 types of land environment we found. Closest type: “cold · dim · steep”.');
  assert.equal(lineaEntorno(j, 6), 'Earth has nothing quite like this: its conditions fall outside all 6 types of land environment we found. Closest type: “dim · cool days · smooth”.');
  const dentro = M.claseDe(M.leerPunto('earth', 48.25, 2.25));
  assert.equal(dentro.dentro, true);
  assert.equal(lineaEntorno(dentro, 6), `Its conditions fall within an Earth environment type: “${dentro.rotulo}”.`);
  assert.equal(lineaEntorno(null, 6), null);
  assert.equal(lineaEntorno({ id: null, rotulo: null, dentro: false }, 6), null);
});

test('"How we know" reads clases.json: what it is, the method, the weak silhouette, and the distance of the point', () => {
  const k = M.claseDe(SHACKLETON);
  const t = comoSabemos(M.clases, k);
  assert.equal(t[0], M.clases.que_es);
  assert.match(t[0], /not a prediction/);
  assert.equal(t[1], M.clases.metodo);
  assert.equal(t[2], `6 types from ${M.clases.celdas.n} land cells (97.7 % of the land area without ice caps).`);
  assert.match(t[3], /mean silhouette 0\.32,/);
  assert.match(t[3], /continuum/);
  assert.equal(t[4], 'Your point is 11.2 from the centre of “cold · dim · steep”; 95 % of that type\'s own land is within 1.45. Units: Earth\'s own spread.');
  assert.equal(t.length, 5);
  assert.match(comoSabemos(M.clases, { ...k, faltan: ['relieve_m'] }).at(-1), /No data at your point for 1 parameter/);
});

const lab = (c) => {
  const l = c.map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const X = (l[0] * 0.4124 + l[1] * 0.3576 + l[2] * 0.1805) / 0.95047, Y = l[0] * 0.2126 + l[1] * 0.7152 + l[2] * 0.0722, Z = (l[0] * 0.0193 + l[1] * 0.1192 + l[2] * 0.9505) / 1.08883;
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
};
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

test('environment type colours: one per class, brand colours or a brand transparency, every pair clearly apart (ΔE ≥ 30)', () => {
  assert.equal(COLORES_CLASE.length, M.clases.clases.length);
  const marca = new Set(Object.values(PALETA).map((h) => h.toUpperCase()));
  const rosa = mezclar('white', 0.5, 'martian-red').map(Math.round);
  for (const c of COLORES_CLASE) assert.ok(marca.has(c.toUpperCase()) || rgb(c).every((v, i) => v === rosa[i]), c);
  assert.ok(!COLORES_CLASE.includes(PALETA['rocket-red']) && !COLORES_CLASE.includes(PALETA['deep-blue']));
  for (let i = 0; i < COLORES_CLASE.length; i++) for (let j = i + 1; j < COLORES_CLASE.length; j++) {
    const a = lab(rgb(COLORES_CLASE[i])), b = lab(rgb(COLORES_CLASE[j]));
    assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) >= 30, `${COLORES_CLASE[i]} vs ${COLORES_CLASE[j]}`);
  }
  const px = pintarClases(new Float32Array([NaN, 0, 5, 9]), COLORES_CLASE, 200);
  assert.deepEqual([...px.slice(0, 4)], [0, 0, 0, 0]);
  assert.deepEqual([...px.slice(4, 8)], [0, 66, 166, 200]);
  assert.deepEqual([...px.slice(8, 12)], [142, 17, 0, 200]);
  assert.deepEqual([...px.slice(12, 16)], [0, 0, 0, 0]);
  const conTierra = pintarClases(new Float32Array([NaN, NaN, 2]), COLORES_CLASE, 200, new Float32Array([1, 0.2, 1]));
  assert.deepEqual([...conTierra.slice(0, 4)], [7, 23, 63, 240]);
  assert.deepEqual([...conTierra.slice(4, 8)], [0, 0, 0, 0]);
  assert.deepEqual([...conTierra.slice(8, 12)], [234, 254, 7, 200]);
});

test('unlisted: only catalogue sites with coordinates count; the count sentence for none, some, one and all', () => {
  const N = SITIOS.filter((s) => s.lat !== null && s.lon !== null).length;
  assert.ok(N >= 15 && N < SITIOS.length);
  assert.equal(sitiosConCoordenadas(SITIOS), N);
  assert.equal(sitiosConCoordenadas([{ lat: 0, lon: null }, { lat: 1, lon: 2 }, {}]), 1);
  assert.equal(fraseUnlisted(4, 5, 15), '4 of these 5 places are unlisted: none of the 15 analog sites in our catalogue is within 300 km.');
  assert.equal(fraseUnlisted(1, 5, 15), '1 of these 5 places is unlisted: none of the 15 analog sites in our catalogue is within 300 km.');
  assert.equal(fraseUnlisted(5, 5, 15), 'All 5 places are unlisted: none of the 15 analog sites in our catalogue is within 300 km.');
  assert.equal(fraseUnlisted(0, 5, 15), 'All 5 places are near a known analog site in our catalogue.');
  assert.equal(fraseUnlisted(0, 0, 15), null);
  // Borde de Shackleton, motor real: «unlisted» = ningún sitio del catálogo a 300 km o menos, contado aparte por fuerza bruta.
  const r = M.buscar(SHACKLETON);
  const rad = Math.PI / 180;
  const km = (a, b, c, d) => 2 * 6371 * Math.asin(Math.sqrt(Math.sin(((c - a) * rad) / 2) ** 2 + Math.cos(a * rad) * Math.cos(c * rad) * Math.sin(((d - b) * rad) / 2) ** 2));
  const esperado = r.resultados.filter((x) => !SITIOS.some((s) => s.lat !== null && s.lon !== null && km(x.lat, x.lon, s.lat, s.lon) <= 300)).length;
  const sin = r.resultados.filter((x) => !masCercano(x.lat, x.lon, SITIOS)).length;
  assert.equal(sin, esperado);
  assert.ok(sin >= 1 && sin < r.resultados.length);
  assert.equal(lineaContexto(null, N), `not near any of the ${N} analog sites in our catalogue`);
  for (const x of r.resultados) {
    const c = masCercano(x.lat, x.lon, SITIOS);
    if (c) assert.equal(lineaContexto(c, N), `near ${c.item.nombre} — a known ${tipoAnalogo(c.item.cuerpo)} (${Math.round(c.km)} km)`);
  }
});

test('side-by-side table from the real Jezero search: one row per parameter, 5 places, best cell = smallest deviation', () => {
  const r = M.buscar(JEZERO);
  const ids = M.indice.parametros.filter((p) => p.reproducible_en_tierra).map((p) => p.id);
  const t = tablaComparar(r.resultados, ids);
  assert.equal(t.length, 8);
  for (const f of t) {
    assert.equal(f.celdas.length, 5);
    assert.equal(f.objetivo, JEZERO.valores[f.id]);
    const ds = r.resultados.map((x) => x.parametros.find((p) => p.id === f.id).desviacion_pct);
    const min = Math.min(...ds);
    f.celdas.forEach((c, k) => {
      assert.equal(c.desv, ds[k]);
      assert.equal(c.valor, r.resultados[k].parametros.find((p) => p.id === f.id).valor_tierra);
      assert.equal(c.mejor, ds[k] === min);
    });
    assert.ok(f.celdas.some((c) => c.mejor));
  }
});

test('"Count related parameters once" at the Shackleton rim (real engine): its % is 0 so only the distance in × Earth\'s spread is shown', () => {
  const rc = M.buscar(SHACKLETON, { metrica: 'componentes' });
  const dRef = M.clases.d_ref.valor;
  assert.ok(rc.resultados.every((x) => x.similitud_pct === 0), 'component % is 0 far from Earth');
  assert.ok(rc.resultados.every((x, k) => !k || x.distancia_componentes >= rc.resultados[k - 1].distancia_componentes));
  assert.equal(lineaDistancia(rc.resultados[0].distancia_componentes, dRef), `distance ${(rc.resultados[0].distancia_componentes / dRef).toFixed(2)} × Earth's own spread`);
  assert.equal(lineaDistancia(8.7, 4.3217), 'distance 2.01 × Earth\'s own spread');
  assert.equal(lineaDistancia(undefined, dRef), null);
  assert.equal(lineaDistancia(1, 0), null);
  const t = textoComponentes(M.clases);
  assert.equal(t[2], 'Earth\'s own spread = 4.32, the distance that 99 % of pairs of Earth land cells (a fixed sample of 5000) stay under.');
  assert.match(M.clases.d_ref.regla, /99th percentile of the distance between all pairs of the same fixed sample of 5000 cells/);
  assert.ok(t.some((s) => /Own criterion/.test(s)));
});

test('side-by-side table: ties mark every best cell, missing data never wins, a row with no data marks nothing', () => {
  const lugar = (d, v = 1) => ({ parametros: [{ id: 'a', valor_tierra: v, valor_objetivo: 2, desviacion_pct: d }] });
  const t = tablaComparar([lugar(5), lugar(null, null), lugar(5), lugar(9)], ['a', 'b']);
  assert.deepEqual(t[0].celdas.map((c) => c.mejor), [true, false, true, false]);
  assert.deepEqual(t[0].celdas[1], { valor: null, desv: null, mejor: false });
  assert.equal(t[0].objetivo, 2);
  assert.deepEqual(t[1], { id: 'b', objetivo: null, celdas: [0, 1, 2, 3].map(() => ({ valor: null, desv: null, mejor: false })) });
});
