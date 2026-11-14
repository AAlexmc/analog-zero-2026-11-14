import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { cargar } from '../buscar/motor.js';
import { MESES_CORTO, MESES_LARGO, MARGEN, nombreMes, leerMes, escribirMes, conMes, idsMensuales, mejorYPeor, rachas, planRepetir, moverEnMes, fraseRepetir, lineaMejorPeor, lineaMesActivo, etiquetaMes, escalaTiras } from '../analogos/meses.js';
import { opcionesBusqueda, activaDeCatalogo } from '../analogos/misiones.js';

const leer = (r) => JSON.parse(readFileSync(new URL(r, import.meta.url), 'utf8'));
const INDICE = leer('../data/cuerpos/indice.json');
const CATALOGO = leer('../data/misiones.json').misiones;
const SITIOS = leer('../data/sitios_ensayo.json').sitios;

// Forma real de perfilMensual / calendario: 12 filas, null = menos de la mitad de los parámetros con dato.
const perfil = (pcts) => pcts.map((v, k) => ({ mes: k + 1, similitud_pct: v, comparados: v === null ? 1 : 5, parametros: [] }));
const fila = (mes, mejor, aqui, lat = -18.25, lon = 12.25) => ({ mes, lat: mejor === null ? null : lat, lon: mejor === null ? null : lon, similitud_pct: mejor, en_lugar_pct: aqui, relevo: mejor === null ? null : true });

test('month names in English, short and long, 1-based; anything else is null', () => {
  assert.equal(MESES_CORTO.length, 12);
  assert.equal(MESES_LARGO.length, 12);
  assert.equal(nombreMes(1), 'January');
  assert.equal(nombreMes(7, false), 'Jul');
  assert.equal(nombreMes(12, false), 'Dec');
  assert.equal(nombreMes(0), null);
  assert.equal(nombreMes(13), null);
  assert.equal(nombreMes(null), null);
});

test('month in the URL: &mes=1..12 is a month; missing, empty, 0, 13, decimals or text are no month (whole year)', () => {
  const q = (s) => new URLSearchParams(s);
  assert.equal(leerMes(q('mundo=mars&mes=7')), 7);
  assert.equal(leerMes(q('mes=12')), 12);
  assert.equal(leerMes(q('mes=07')), 7);
  for (const s of ['', 'mes=', 'mes=0', 'mes=13', 'mes=7.5', 'mes=-1', 'mes=july', 'mes=1e1', 'mes= 7']) assert.equal(leerMes(q(s)), null, s);
});

test('writing the month keeps the rest of the URL; no month removes it', () => {
  const q0 = new URLSearchParams('mundo=mars&lat=18.38&lon=77.58&mes=3&mision=biomarcadores');
  assert.equal(escribirMes(q0, 7).toString(), 'mundo=mars&lat=18.38&lon=77.58&mision=biomarcadores&mes=7');
  assert.equal(escribirMes(q0, null).toString(), 'mundo=mars&lat=18.38&lon=77.58&mision=biomarcadores');
  assert.equal(q0.get('mes'), '3');
  assert.equal(conMes('../explorar/index.html?mundo=mars&lat=1&lon=2', 7), '../explorar/index.html?mundo=mars&lat=1&lon=2&mes=7');
  assert.equal(conMes('../explorar/index.html', 1), '../explorar/index.html?mes=1');
  assert.equal(conMes('../explorar/index.html?mundo=mars', null), '../explorar/index.html?mundo=mars');
});

test('monthly files a search needs: only the asked parameters that have a monthly version', () => {
  const todos = INDICE.parametros.filter((p) => p.reproducible_en_tierra).map((p) => p.id).filter((id) => [...INDICE.parametros, ...INDICE.parametros_tierra].find((p) => p.id === id).meses?.earth);
  assert.deepEqual(idsMensuales({}, INDICE), todos);
  assert.ok(todos.length >= 5 && !todos.includes('ndvi_max') && !todos.includes('viento_medio_m_s'));
  const b = activaDeCatalogo(CATALOGO.find((m) => m.id === 'biomarcadores'), INDICE, SITIOS);
  assert.deepEqual(idsMensuales(opcionesBusqueda(b), INDICE), ['t_max_k', 'precip_mm_ano', 'viento_medio_m_s']);
  assert.deepEqual(idsMensuales({ parametros: ['elev_m', 'aridez_ai'] }, INDICE), []);
});

test('best and worst months, with ties; months without data do not count', () => {
  const r = mejorYPeor(perfil([70, 80, 80, 60, null, 60, 75, 75, 75, 75, 75, 75]));
  assert.deepEqual(r, { mejor: [2, 3], peor: [4, 6], max: 80, min: 60 });
  assert.equal(mejorYPeor(perfil(Array(12).fill(null))), null);
  assert.deepEqual(mejorYPeor(perfil(Array(12).fill(50))), { mejor: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], peor: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], max: 50, min: 50 });
});

test('runs within the cut of the best month: the year wraps (Dec–Jan is one run), gaps and missing data split runs', () => {
  // Mejor 90 en enero; corte 5: entran los > 85.
  const p = perfil([90, 88, 80, 86, 70, 70, 70, 70, 70, 70, 87, 89]);
  assert.deepEqual(rachas(p, 5), [{ meses: [4], texto: 'Apr' }, { meses: [11, 12, 1, 2], texto: 'Nov–Feb' }]);
  // Exactamente corte puntos por debajo no entra («a menos de»).
  assert.deepEqual(rachas(perfil([90, 85, 70, 70, 70, 70, 70, 70, 70, 70, 70, 70]), 5), [{ meses: [1], texto: 'Jan' }]);
  assert.deepEqual(rachas(perfil([80, 80, null, 80, 80, 80, 80, 80, 80, 80, 80, 80]), 5), [{ meses: [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2], texto: 'Apr–Feb' }]);
  assert.deepEqual(rachas(perfil(Array(12).fill(70)), 5), [{ meses: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], texto: 'All year' }]);
  assert.deepEqual(rachas(perfil([60, 70, 75, 70, 60, 60, 60, 60, 60, 60, 60, 60]), 6), [{ meses: [2, 3, 4], texto: 'Feb–Apr' }]);
  assert.deepEqual(rachas(perfil(Array(12).fill(null)), 5), []);
});

test('repeat plan: January then six months later; move when the place is more than the margin below the best of that month', () => {
  const cal = Array.from({ length: 12 }, (_, k) => fila(k + 1, 84, 84));
  cal[0] = fila(1, 86, 86);
  cal[6] = fila(7, 83.3, 78.3);
  const p = planRepetir(cal, 1, 6);
  assert.equal(MARGEN, 5);
  assert.equal(p.primero.mes, 1);
  assert.equal(p.primero.pct, 86);
  assert.equal(p.repeticion.mes, 7);
  assert.equal(p.repeticion.pct_aqui, 78.3);
  assert.deepEqual(p.repeticion.mejor, { lat: -18.25, lon: 12.25, pct: 83.3 });
  assert.ok(Math.abs(p.diferencia - 5) < 1e-9);
  // 83.3 − 78.3 = 5,0000000000000x en coma flotante: el veredicto usa la cuenta tal cual, como el motor.
  assert.equal(p.mover, p.diferencia > 5);
  cal[6] = fila(7, 83.3, 77);
  assert.equal(planRepetir(cal, 1, 6).mover, true);
  cal[6] = fila(7, 83.3, 80);
  assert.equal(planRepetir(cal, 1, 6).mover, false);
  assert.equal(planRepetir(cal, 1, 6, 2).mover, true);
});

test('repeat plan wraps the year and checks its inputs', () => {
  const cal = Array.from({ length: 12 }, (_, k) => fila(k + 1, 80 + k, 70 + k));
  const p = planRepetir(cal, 10, 6);
  assert.equal(p.repeticion.mes, 4);
  assert.equal(p.repeticion.pct_aqui, 73);
  assert.equal(p.diferencia, 10);
  assert.equal(p.mover, true);
  assert.equal(planRepetir(cal, 12, 1).repeticion.mes, 1);
  assert.throws(() => planRepetir(cal, 0, 6), /mes/);
  assert.throws(() => planRepetir(cal, 1, 0), /1-11/);
  assert.throws(() => planRepetir(cal, 1, 12), /1-11/);
  assert.throws(() => planRepetir(cal.slice(0, 11), 1, 6), /12/);
});

test('repeat plan with missing data: no verdict (mover false, diferencia null)', () => {
  const cal = Array.from({ length: 12 }, (_, k) => fila(k + 1, 80, 70));
  cal[6] = fila(7, 80, null);
  const p = planRepetir(cal, 1, 6);
  assert.equal(p.mover, false);
  assert.equal(p.diferencia, null);
  cal[6] = fila(7, null, 60);
  const q = planRepetir(cal, 1, 6);
  assert.equal(q.repeticion.mejor, null);
  assert.equal(q.mover, false);
  assert.equal(moverEnMes(fila(3, 80, 74.9)), true);
  assert.equal(moverEnMes(fila(3, 80, 75)), false);
  assert.equal(moverEnMes(fila(3, 80, null)), null);
  assert.equal(moverEnMes(fila(3, null, 70)), null);
});

test('repeat plan sentence: move, stay, rise and missing data', () => {
  const cal = Array.from({ length: 12 }, (_, k) => fila(k + 1, 84, 84));
  cal[0] = fila(1, 86, 86);
  cal[6] = fila(7, 83.3, 78.2);
  const donde = '18.25° S, 12.25° E (Namibia)';
  assert.equal(fraseRepetir(planRepetir(cal, 1, 6), donde), 'January here: 86.0 %. Six months later, in July, this place drops to 78.2 %; the best place then is 18.25° S, 12.25° E (Namibia), 83.3 %. Move the test.');
  cal[6] = fila(7, 83.3, 80);
  assert.equal(fraseRepetir(planRepetir(cal, 1, 6), donde), 'January here: 86.0 %. Six months later, in July, this place drops to 80.0 % but still holds (within 5 points of the best). Stay.');
  cal[6] = fila(7, 92, 90);
  assert.equal(fraseRepetir(planRepetir(cal, 1, 6), donde), 'January here: 86.0 %. Six months later, in July, this place rises to 90.0 % and holds (within 5 points of the best). Stay.');
  cal[6] = fila(7, 86, 86);
  assert.equal(fraseRepetir(planRepetir(cal, 1, 6), donde), 'January here: 86.0 %. Six months later, in July, this place stays at 86.0 % and holds (within 5 points of the best). Stay.');
  cal[1] = fila(2, 95, 89);
  assert.equal(fraseRepetir(planRepetir(cal, 1, 1), donde), 'January here: 86.0 %. One month later, in February, this place rises to 89.0 %; the best place then is 18.25° S, 12.25° E (Namibia), 95.0 %. Move the test.');
  cal[1] = fila(2, 95, null);
  assert.equal(fraseRepetir(planRepetir(cal, 1, 1), donde), 'January here: 86.0 %. One month later, in February, this place cannot be compared (missing data).');
  cal[1] = fila(2, null, 80);
  assert.equal(fraseRepetir(planRepetir(cal, 1, 1), donde), 'January here: 86.0 %. One month later, in February, this place drops to 80.0 %; no other place on Earth can be compared then.');
  cal[0] = fila(1, 86, null);
  cal[1] = fila(2, 84, 84);
  assert.equal(fraseRepetir(planRepetir(cal, 1, 11, 3), donde), 'January here: cannot be compared (missing data). Eleven months later, in December, this place is at 84.0 % and holds (within 3 points of the best). Stay.');
});

test('strip lines: best and worst with ties, and the active month against the best', () => {
  const p = perfil([70, 80, 80, 60, null, 60, 75, 75, 75, 75, 75, 75]);
  assert.equal(lineaMejorPeor(p), 'Best: Feb, Mar · worst: Apr, Jun');
  assert.equal(lineaMejorPeor(perfil(Array(12).fill(null))), null);
  assert.equal(lineaMesActivo(p, 7), 'July: 5.0 points below its best month');
  assert.equal(lineaMesActivo(p, 2), 'February is its best month');
  assert.equal(lineaMesActivo(p, 5), 'May: no data here');
  assert.equal(lineaMesActivo(p, null), null);
  assert.equal(etiquetaMes(p[6]), 'July: 75.0 % match');
  assert.equal(etiquetaMes(p[4]), 'May: no data');
  assert.deepEqual(escalaTiras([p, perfil([90, ...Array(11).fill(null)])]), { min: 60, max: 90 });
  assert.equal(escalaTiras([perfil(Array(12).fill(null))]), null);
});

test('with the real engine: plan and Move? column agree with calendario at Jezero for the first place of July', async () => {
  const base = new URL('../data/cuerpos/', import.meta.url).pathname;
  const M = await cargar(base, async (ruta, tipo) => { const b = await readFile(ruta); return tipo === 'json' ? JSON.parse(b.toString('utf8')) : b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); });
  const o = M.leerPunto('mars', 18.38, 77.58);
  await M.cargarMeses(idsMensuales({}, M.indice));
  const x = M.buscar(o, { mes: 7 }).resultados[0];
  const cal = M.calendario(o, { lugar: { lat: x.lat, lon: x.lon } });
  const per = M.perfilMensual(o, { lat: x.lat, lon: x.lon });
  assert.ok(Math.abs(cal[6].en_lugar_pct - x.similitud_pct) < 1e-9);
  assert.ok(Math.abs(per[6].similitud_pct - x.similitud_pct) < 1e-9);
  const p = planRepetir(cal, 1, 6);
  assert.equal(p.repeticion.pct_aqui, cal[6].en_lugar_pct);
  assert.equal(p.mover, cal[6].similitud_pct - cal[6].en_lugar_pct > 5);
  for (const f of cal) assert.equal(typeof moverEnMes(f), 'boolean');
  const mp = mejorYPeor(per);
  assert.ok(mp.mejor.every((m) => per[m - 1].similitud_pct === mp.max));
});
