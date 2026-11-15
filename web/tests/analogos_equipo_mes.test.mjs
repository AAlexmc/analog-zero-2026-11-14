import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { aMotor, deMotor, medible, equiposDe, veredictoMes, calendarioEquipo, idsMensualesEquipo, campanasCerca, fraseNasaAqui, fraseRepeticion, nombreTipo } from '../analogos/equipo_mes.js';

const leer = (r) => JSON.parse(readFileSync(new URL(r, import.meta.url), 'utf8'));
const CATALOGO = leer('../data/equipo_mision.json');
const MISIONES = leer('../data/misiones.json').misiones;
const CON_MESES = ['t_max_k', 't_min_k', 't_media_k', 'insolacion_kwh_m2_dia', 'precip_mm_ano', 'viento_medio_m_s', 'amplitud_diurna_k'];

const equipo = (mision, id) => equiposDe(CATALOGO, mision).find((e) => e.id === id);
const LIDAR = () => equipo('lidar_estereo', 'lidar_ilris3d');
const DOMO = () => equipo('simulacion_larga', 'domo_hi_seas');
const SCARECROW = () => equipo('ruedas_en_arena', 'scarecrow');
const C = (c) => c + 273.15;
// Forma real de M.perfilMensual: 12 × { mes, similitud_pct, comparados, parametros: [{ id, valor_tierra, desviacion_pct }] }.
const perfil = (porId) => Array.from({ length: 12 }, (_, k) => ({
  mes: k + 1, similitud_pct: null, comparados: 0,
  parametros: Object.entries(porId).map(([id, v]) => ({ id, valor_tierra: v[k], desviacion_pct: null })),
}));
// Forma real de M.leerPunto('earth', …).valores: todos los ids, null sin dato.
const anuales = (extra = {}) => ({ t_max_k: C(5), t_min_k: C(-20), viento_p95_m_s: 9.1, viento_medio_m_s: 4.2, relieve_m: 120, ...extra });

test('units: °C, °F and K to K; mph, km/h and m/s to m/s; and back', () => {
  assert.equal(aMotor(0, '°C', 't_min_k'), 273.15);
  assert.equal(aMotor(40, '°C', 't_max_k'), 313.15);
  assert.equal(aMotor(250, 'K', 't_min_k'), 250);
  assert.ok(Math.abs(aMotor(32, '°F', 't_min_k') - 273.15) < 1e-9);
  assert.ok(Math.abs(aMotor(70, 'mph', 'viento_p95_m_s') - 31.2928) < 1e-9);
  assert.ok(Math.abs(aMotor(36, 'km/h', 'viento_medio_m_s') - 10) < 1e-9);
  assert.equal(aMotor(12, 'm/s', 'viento_p95_m_s'), 12);
  assert.ok(Math.abs(deMotor(273.15 + 2.5, '°C', 't_min_k') - 2.5) < 1e-9);
  assert.ok(Math.abs(deMotor(31.2928, 'mph', 'viento_p95_m_s') - 70) < 1e-9);
});

test('an unknown unit, a unit of the wrong kind or a layer we do not have is NOT MEASURED, never guessed', () => {
  assert.equal(aMotor(5, 'knots', 'viento_p95_m_s'), null);
  assert.equal(aMotor(5, 'mph', 't_min_k'), null);
  assert.equal(aMotor(5, '°C', 'viento_p95_m_s'), null);
  assert.deepEqual(medible({ parametro: 'viento_p95_m_s', tipo: 'max', valor: 40, unidad: 'knots' }), { medible: false, motivo: 'unit "knots" not converted' });
  assert.deepEqual(medible(SCARECROW().limites[0]), { medible: false, motivo: 'no slope layer at this scale; see the simulation' });
  assert.equal(medible({ parametro: 'humedad', tipo: 'max', valor: 90, unidad: '%' }).medible, false);
  assert.equal(medible({ parametro: 't_min_k', tipo: 'min', valor: null, unidad: '°C' }).medible, false);
  assert.equal(medible({ parametro: 't_min_k', tipo: 'entre', valor: 0, unidad: '°C' }).medible, false);
  assert.deepEqual(medible(LIDAR().limites[0]), { medible: true, motivo: null });
});

test('equipment of a mission from the real catalogue; unknown or empty mission → empty list', () => {
  assert.deepEqual(equiposDe(CATALOGO, 'lidar_estereo').map((e) => e.id), ['k10_red', 'lidar_ilris3d']);
  assert.deepEqual(equiposDe(CATALOGO.misiones, 'lidar_estereo').map((e) => e.id), ['k10_red', 'lidar_ilris3d']);
  assert.deepEqual(equiposDe(CATALOGO, 'polimeros_sellos'), []);
  assert.deepEqual(equiposDe(CATALOGO, 'no_existe'), []);
  assert.deepEqual(equiposDe(null, 'lidar_estereo'), []);
});

test('verdict of one month: min and max limits, exactly at the limit holds, no data is no data (never 0)', () => {
  const [min, max] = LIDAR().limites;
  assert.deepEqual(veredictoMes(min, C(0)), { estado: 'ok', margen: 0, valor: 0 });
  const r = veredictoMes(min, C(-12.5));
  assert.equal(r.estado, 'rompe');
  assert.ok(Math.abs(r.margen + 12.5) < 1e-9);
  assert.equal(veredictoMes(max, C(40)).estado, 'ok');
  assert.equal(veredictoMes(max, C(40.2)).estado, 'rompe');
  assert.ok(veredictoMes(max, C(55)).margen > 14.9);
  for (const v of [null, undefined, NaN]) assert.deepEqual(veredictoMes(min, v), { estado: 'sin_dato', margen: null, valor: null });
  const viento = DOMO().limites[0];
  assert.equal(veredictoMes(viento, 70 * 0.44704).estado, 'ok');
  const w = veredictoMes(viento, 35);
  assert.equal(w.estado, 'rompe');
  assert.ok(Math.abs(w.margen - (35 / 0.44704 - 70)) < 1e-9);
  assert.equal(veredictoMes({ parametro: 'viento_p95_m_s', tipo: 'max', valor: 40, unidad: 'knots' }, 50).estado, 'sin_dato');
});

test('lidar: min 0 °C and max 40 °C at once; works only Jun–Aug, every month inside the max', () => {
  const tmin = [-30, -31, -28, -20, -8, 0.5, 3, 1, -4, -15, -25, -29].map(C);
  const tmax = [-20, -22, -18, -10, 2, 10, 14, 11, 3, -6, -15, -19].map(C);
  const c = calendarioEquipo(LIDAR(), perfil({ t_min_k: tmin, t_max_k: tmax }), anuales());
  assert.equal(c.medibles, 2);
  const [lmin, lmax] = c.limites;
  assert.equal(lmin.origen, 'mes');
  assert.deepEqual(lmin.veredictos.map((v) => v.estado), ['rompe', 'rompe', 'rompe', 'rompe', 'rompe', 'ok', 'ok', 'ok', 'rompe', 'rompe', 'rompe', 'rompe']);
  assert.deepEqual(lmin.rachas.map((r) => r.texto), ['Jun–Aug']);
  assert.equal(lmin.frase, 'Works here Jun–Aug: the night-time ground low does not drop below 0 °C.');
  assert.equal(lmax.frase, 'Holds all year: the daytime ground high does not rise above 40 °C.');
  assert.deepEqual(c.resumen.veredictos.map((v) => v.estado), lmin.veredictos.map((v) => v.estado));
  assert.deepEqual(c.resumen.rachas.map((r) => r.meses), [[6, 7, 8]]);
  assert.equal(c.resumen.frase, 'Within all its published limits here: Jun–Aug.');
  assert.ok(c.superficie);
});

test('breaks every month: night-time low below 0 °C all year; with a month of no data it says "every month with data"', () => {
  const tmin = Array(12).fill(C(-5));
  const c = calendarioEquipo(LIDAR(), perfil({ t_min_k: tmin, t_max_k: Array(12).fill(C(10)) }), anuales());
  assert.equal(c.limites[0].frase, 'Breaks every month here: the night-time ground low is below 0 °C all year.');
  assert.deepEqual(c.limites[0].rachas, []);
  assert.equal(c.resumen.frase, 'Outside at least one published limit every month here.');
  const hueco = [...tmin]; hueco[3] = null;
  const d = calendarioEquipo(LIDAR(), perfil({ t_min_k: hueco, t_max_k: Array(12).fill(C(10)) }), anuales());
  assert.equal(d.limites[0].veredictos[3].estado, 'sin_dato');
  assert.equal(d.limites[0].frase, 'Breaks in every month with data here: the night-time ground low is below 0 °C.');
  assert.equal(d.resumen.veredictos[3].estado, 'sin_dato');
});

test('a month with no data splits a run and is never counted as working', () => {
  const tmin = [-1, -1, -1, 2, 2, null, 2, 2, -1, -1, -1, -1].map((v) => (v === null ? null : C(v)));
  const c = calendarioEquipo(LIDAR(), perfil({ t_min_k: tmin, t_max_k: Array(12).fill(C(10)) }), anuales());
  assert.deepEqual(c.limites[0].rachas.map((r) => r.texto), ['Apr–May', 'Jul–Aug']);
  assert.equal(c.limites[0].frase, 'Works here Apr–May, Jul–Aug: the night-time ground low does not drop below 0 °C.');
  const vacio = calendarioEquipo(LIDAR(), perfil({ t_min_k: Array(12).fill(null), t_max_k: Array(12).fill(null) }), anuales({ t_min_k: null, t_max_k: null }));
  assert.equal(vacio.limites[0].frase, 'No data here.');
  assert.equal(vacio.resumen.frase, 'No data here.');
  assert.ok(vacio.resumen.veredictos.every((v) => v.estado === 'sin_dato'));
});

test('circular year: works Dec–Feb is one run, not two', () => {
  const tmin = [1, 1, -1, -1, -1, -1, -1, -1, -1, -1, -1, 1].map(C);
  const c = calendarioEquipo(LIDAR(), perfil({ t_min_k: tmin, t_max_k: Array(12).fill(C(30)) }), anuales());
  assert.deepEqual(c.limites[0].rachas.map((r) => r.meses), [[12, 1, 2]]);
  assert.equal(c.limites[0].frase, 'Works here Dec–Feb: the night-time ground low does not drop below 0 °C.');
  assert.equal(c.resumen.frase, 'Within all its published limits here: Dec–Feb.');
});

test('dome: the 95th-percentile wind has no monthly layer, so it uses the year value the same in all 12 months', () => {
  const c = calendarioEquipo(DOMO(), null, anuales({ viento_p95_m_s: 12.4 }));
  const l = c.limites[0];
  assert.equal(l.origen, 'anual');
  assert.ok(l.veredictos.every((v) => v.estado === 'ok'));
  assert.equal(l.frase, 'Holds all year: the 95th-percentile wind does not rise above 70 mph.');
  assert.equal(c.resumen.frase, l.frase);
  assert.equal(c.superficie, false);
  const fuerte = calendarioEquipo(DOMO(), perfil({}), anuales({ viento_p95_m_s: 40 }));
  assert.equal(fuerte.limites[0].frase, 'Breaks every month here: the 95th-percentile wind is above 70 mph all year.');
  assert.equal(calendarioEquipo(DOMO(), null, anuales({ viento_p95_m_s: null })).limites[0].frase, 'No data here.');
});

test('equipment with no limits, or only limits we cannot measure, has no strip', () => {
  const k10 = calendarioEquipo(equipo('lidar_estereo', 'k10_red'), null, anuales());
  assert.equal(k10.medibles, 0);
  assert.deepEqual(k10.limites, []);
  assert.equal(k10.resumen, null);
  const s = calendarioEquipo(SCARECROW(), null, anuales());
  assert.equal(s.medibles, 0);
  assert.equal(s.limites.length, 1);
  assert.equal(s.limites[0].medible, false);
  assert.equal(s.limites[0].motivo, 'no slope layer at this scale; see the simulation');
  assert.equal(s.resumen, null);
  const raro = calendarioEquipo({ ...LIDAR(), limites: [{ ...LIDAR().limites[0], unidad: 'Rankine' }] }, perfil({ t_min_k: Array(12).fill(C(10)) }), anuales());
  assert.equal(raro.medibles, 0);
  assert.equal(raro.limites[0].motivo, 'unit "Rankine" not converted');
});

test('monthly files the equipment needs: only measurable limits with a monthly layer, once each', () => {
  assert.deepEqual(idsMensualesEquipo(equiposDe(CATALOGO, 'lidar_estereo'), CON_MESES), ['t_min_k', 't_max_k']);
  assert.deepEqual(idsMensualesEquipo(equiposDe(CATALOGO, 'simulacion_larga'), CON_MESES), []);
  assert.deepEqual(idsMensualesEquipo(equiposDe(CATALOGO, 'ruedas_en_arena'), CON_MESES), []);
  assert.deepEqual(idsMensualesEquipo([LIDAR(), LIDAR()], CON_MESES), ['t_min_k', 't_max_k']);
});

test('NASA campaign months near the place come from the mission catalogue (300 km, with months and coordinates)', () => {
  const lidar = MISIONES.find((m) => m.id === 'lidar_estereo');
  const cerca = campanasCerca(lidar, 75.25, -89.75);
  assert.deepEqual(cerca.meses, [7]);
  assert.equal(cerca.campanas.length, 1);
  assert.equal(cerca.campanas[0].nombre, 'K10 rovers with 3D scanning lidar');
  assert.ok(cerca.campanas[0].km < 20);
  assert.match(fraseNasaAqui(cerca), /^NASA ran this here in Jul \(K10 rovers with 3D scanning lidar, \d+ km away\)\.$/);
  assert.equal(campanasCerca(lidar, 60, -89.75), null);
  assert.equal(fraseNasaAqui(null), null);
  const flota = campanasCerca(MISIONES.find((m) => m.id === 'flota_rovers'), 75.3667, -89.6833);
  assert.deepEqual(flota.meses, [7, 8]);
  assert.match(fraseNasaAqui(flota), /^NASA ran this here in Jul, Aug \(/);
  // Campaña con coordenadas pero sin meses: no cuenta.
  assert.equal(campanasCerca(MISIONES.find((m) => m.id === 'perforacion_hielo'), 75.3667, -89.6833), null);
  assert.equal(campanasCerca(null, 0, 0), null);
});

test('repeat plan: names the equipment that is outside its range in the repeat month, and nothing else', () => {
  const tmin = [-30, -31, -28, -20, -8, 0.5, 3, 1, -4, -15, -25, -29].map(C);
  const lidar = calendarioEquipo(LIDAR(), perfil({ t_min_k: tmin, t_max_k: Array(12).fill(C(10)) }), anuales());
  const domo = calendarioEquipo(DOMO(), null, anuales({ viento_p95_m_s: 40 }));
  const k10 = calendarioEquipo(equipo('lidar_estereo', 'k10_red'), null, anuales());
  assert.equal(fraseRepeticion([lidar, k10], 1), 'In January the Optech ILRIS-3D scanning lidar is outside its published range here.');
  assert.equal(fraseRepeticion([lidar, k10], 7), null);
  assert.equal(fraseRepeticion([lidar, domo], 1), 'In January the Optech ILRIS-3D scanning lidar and the HI-SEAS habitat dome are outside their published ranges here.');
  assert.equal(fraseRepeticion([lidar, domo], 7), 'In July the HI-SEAS habitat dome is outside its published range here.');
  assert.equal(fraseRepeticion([], 7), null);
});

test('equipment type ids are shown in English', () => {
  assert.equal(nombreTipo('instrumento'), 'Instrument');
  assert.equal(nombreTipo('taladro'), 'Drill');
  assert.equal(nombreTipo('habitat'), 'Habitat');
  assert.equal(nombreTipo('rover'), 'Rover');
  assert.equal(nombreTipo('dron'), 'Drone');
  assert.equal(nombreTipo('otro'), 'otro');
});

test('summary: with a published limit we cannot measure here, it does not say "all its published limits"', () => {
  const eq = LIDAR();
  eq.limites.push({ parametro: 'pendiente_grados', tipo: 'max', valor: 15, unidad: 'deg', fuente: 'https://example.org/x', cita: 'a b c d e', verificado: false });
  const tmin = [-30, -30, -25, -15, -5, 1, 4, 2, -6, -15, -25, -30].map(C);
  const c = calendarioEquipo(eq, perfil({ t_min_k: tmin, t_max_k: Array(12).fill(C(10)) }), anuales());
  assert.equal(c.medibles, 2);
  assert.equal(c.resumen.frase, 'Within the published limits we can measure here: Jun–Aug.');
});
