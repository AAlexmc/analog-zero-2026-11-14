import test from 'node:test';
import assert from 'node:assert/strict';
import { medirPunto, medirSeparacion, evaluarRequisito, evaluarEquipo, compararRequisito, margenComparacion, cargasExcavadora, cantidad, decimalesVeredicto, redondearArriba, notaBasesPendiente } from '../terreno/evaluar.js';

const RAD = Math.PI / 180;

function rampa(n, m, grados) {
  const a = new Float32Array(n * n), t = Math.tan(grados * RAD);
  for (let f = 0; f < n; f++) for (let c = 0; c < n; c++) a[f * n + c] = 500 + c * m * t;
  return a;
}

const req = (variable, op, valor, extra = {}) => ({ variable, op, valor, unidad: 'deg', texto: 't', fuente: 'https://x', cita: 'c', ...extra });
const terreno = (alturas, capas = {}) => ({ n: 9, m_por_px: 39.0625, alturas, capas });

test('slope measured at a point says its baseline: two cells of the DEM', () => {
  const m = medirPunto(terreno(rampa(9, 39.0625, 22)), 4, 4);
  assert.ok(Math.abs(m.pendiente_deg.valor - 22) < 1e-3);
  assert.match(m.pendiente_deg.como, /over 78 m/);
  assert.match(m.pendiente_deg.como, /39\.06 m\/px/);
});

test('slope next to a no-data cell falls back to one cell and says so', () => {
  const a = rampa(9, 39.0625, 10);
  a[4 * 9 + 5] = NaN;
  const m = medirPunto(terreno(a), 4, 4);
  assert.ok(Math.abs(m.pendiente_deg.valor - 10) < 1e-3);
  assert.match(m.pendiente_deg.como, /over 39–78 m/);
});

test('missing layers are reported with the reason, never as zero', () => {
  const m = medirPunto(terreno(rampa(9, 39.0625, 5)), 4, 4);
  assert.equal(m.iluminacion_frac.valor, null);
  assert.match(m.iluminacion_frac.motivo, /no illumination layer on this terrain/);
  assert.equal(m.sombra_permanente.valor, null);
  assert.match(m.temp_k.max.motivo, /no temperature layer on this terrain/);
  assert.match(m.horas_en_sombra.motivo, /needs a route/);
  assert.match(m.distancia_recorrido_km.motivo, /needs a route/);
});

test('a NaN in a layer at the point is "no data here", not zero', () => {
  const ilu = new Float32Array(81).fill(0.4);
  ilu[4 * 9 + 4] = NaN;
  const m = medirPunto(terreno(rampa(9, 39.0625, 5), { iluminacion: ilu }), 4, 4);
  assert.equal(m.iluminacion_frac.valor, null);
  assert.match(m.iluminacion_frac.motivo, /no data/);
  const m2 = medirPunto(terreno(rampa(9, 39.0625, 5), { iluminacion: ilu }), 3, 3);
  assert.ok(Math.abs(m2.iluminacion_frac.valor - 0.4) < 1e-6);
});

test('route values can be passed in and are then evaluated', () => {
  const m = medirPunto(terreno(rampa(9, 39.0625, 5)), 4, 4, { horas_en_sombra: { valor: 160, como: 'route' } });
  const r = evaluarRequisito(req('horas_en_sombra', '<=', 150, { unidad: 'h' }), m);
  assert.equal(r.estado, 'rompe');
  assert.equal(r.exceso, 10);
});

test('value exactly at an inclusive limit is OK; at a strict limit it breaks', () => {
  const med = { pendiente_deg: { valor: 15, como: 'x' } };
  assert.equal(evaluarRequisito(req('pendiente_deg', '<=', 15), med).estado, 'ok');
  assert.equal(evaluarRequisito(req('pendiente_deg', '<', 15), med).estado, 'rompe');
  assert.equal(evaluarRequisito(req('pendiente_deg', '>=', 15), med).estado, 'ok');
  assert.equal(evaluarRequisito(req('pendiente_deg', '>', 15), med).estado, 'rompe');
});

test('a break reports by how much it exceeds the limit', () => {
  const r = evaluarRequisito(req('pendiente_deg', '<=', 15), { pendiente_deg: { valor: 22.5, como: 'x' } });
  assert.equal(r.estado, 'rompe');
  assert.equal(r.exceso, 7.5);
  const r2 = evaluarRequisito(req('temp_k', '>=', 40, { unidad: 'K' }), { temp_k: { min: { valor: 25 }, max: { valor: 60 } } });
  assert.equal(r2.estado, 'rompe');
  assert.equal(r2.exceso, 15);
});

test('requirement with no public value shows its text without a verdict', () => {
  const r = evaluarRequisito(req('separacion_m', '>=', null, { respecto_a: 'habitat_superficie', texto: 'not public: no standoff distance has been defined for landers' }), {});
  assert.equal(r.estado, 'sin_limite');
  assert.match(r.motivo, /no standoff distance has been defined/);
});

test('a NaN measurement is not measured, never OK', () => {
  const r = evaluarRequisito(req('pendiente_deg', '<=', 15), { pendiente_deg: { valor: NaN, como: 'x' } });
  assert.equal(r.estado, 'no_medido');
  assert.match(r.motivo, /no data/);
});

test('equipment without requirements gives an empty sheet', () => {
  assert.deepEqual(evaluarEquipo({ id: 'flip', requisitos: [] }, {}), []);
  assert.deepEqual(evaluarEquipo({ id: 'x' }, {}), []);
});

test('unknown variable is not measured and says so', () => {
  const r = evaluarRequisito(req('radiacion_sv', '<=', 1), {});
  assert.equal(r.estado, 'no_medido');
  assert.match(r.motivo, /not measured by this viewer/);
});

test('upper temperature limit uses the max-temperature layer', () => {
  const t = new Float32Array(81).fill(320);
  const m = medirPunto(terreno(rampa(9, 39.0625, 1), { temp_max: t }), 4, 4);
  const r = evaluarRequisito(req('temp_k', '<=', 300, { unidad: 'K' }), m);
  assert.equal(r.estado, 'rompe');
  assert.equal(r.exceso, 20);
});

test('lower temperature limit with only a max layer: breaks if even the max is too cold, otherwise not measured', () => {
  const frio = medirPunto(terreno(rampa(9, 39.0625, 1), { temp_max: new Float32Array(81).fill(35) }), 4, 4);
  const r = evaluarRequisito(req('temp_k', '>=', 40, { unidad: 'K' }), frio);
  assert.equal(r.estado, 'rompe');
  assert.match(r.como, /maximum/);
  const templado = medirPunto(terreno(rampa(9, 39.0625, 1), { temp_max: new Float32Array(81).fill(250) }), 4, 4);
  const r2 = evaluarRequisito(req('temp_k', '>=', 40, { unidad: 'K' }), templado);
  assert.equal(r2.estado, 'no_medido');
  assert.match(r2.motivo, /minimum temperature/);
});

test('separation: nearest planted item of the referenced kind, in metres on the map plane', () => {
  const plantados = [
    { uid: 1, equipo: 'reactor_fision', fila: 0, col: 0 },
    { uid: 2, equipo: 'habitat_superficie', fila: 3, col: 4 },
    { uid: 3, equipo: 'habitat_superficie', fila: 30, col: 40 },
  ];
  const s = medirSeparacion(plantados, plantados[0], 'habitat_superficie', 10, () => 'Surface habitat');
  assert.equal(s.valor, 50);
  const r = evaluarRequisito(req('separacion_m', '>=', 1000, { unidad: 'm', respecto_a: 'habitat_superficie' }), { separacion_m: { habitat_superficie: s } });
  assert.equal(r.estado, 'rompe');
  assert.equal(r.exceso, 950);
});

test('separation with nothing to measure against asks to plant it', () => {
  const s = medirSeparacion([{ uid: 1, equipo: 'reactor_fision', fila: 0, col: 0 }], { uid: 1, equipo: 'reactor_fision', fila: 0, col: 0 }, 'habitat_superficie', 10, () => 'Surface habitat');
  assert.equal(s.valor, null);
  assert.equal(s.motivo, 'plant a Surface habitat to evaluate');
  const r = evaluarRequisito(req('separacion_m', '>=', 1000, { respecto_a: 'habitat_superficie' }), { separacion_m: { habitat_superficie: s } });
  assert.equal(r.estado, 'no_medido');
  assert.equal(r.motivo, 'plant a Surface habitat to evaluate');
});

test('separation ignores the item itself when it is of the referenced kind', () => {
  const yo = { uid: 7, equipo: 'habitat_superficie', fila: 0, col: 0 };
  const s = medirSeparacion([yo], yo, 'habitat_superficie', 10, () => 'Surface habitat');
  assert.equal(s.valor, null);
});

test('Earth vs Moon: within the own margin is reproduced, gentler is under-tested, harsher is over-tested', () => {
  const r = req('pendiente_deg', '<=', 15);
  const ev = (v) => ({ estado: 'ok', valor: v });
  assert.equal(compararRequisito(r, ev(22), ev(21)).lectura, 'reproducido');
  assert.equal(compararRequisito(r, ev(22), ev(4)).lectura, 'infra');
  assert.equal(compararRequisito(r, ev(22), ev(30)).lectura, 'sobre');
});

test('for a lower limit (cold), a colder Earth is the harsher test', () => {
  const r = req('temp_k', '>=', 40, { unidad: 'K' });
  const ev = (v) => ({ estado: 'ok', valor: v });
  assert.equal(compararRequisito(r, ev(60), ev(250)).lectura, 'infra');
  assert.equal(compararRequisito(r, ev(260), ev(60)).lectura, 'sobre');
});

test('the margin edge counts as reproduced', () => {
  const r = req('pendiente_deg', '<=', 15);
  const mg = margenComparacion('pendiente_deg', 20);
  assert.equal(mg, 2);
  assert.equal(compararRequisito(r, { valor: 20 }, { valor: 18 }).lectura, 'reproducido');
});

test('comparison is "cannot be measured" when either side has no value', () => {
  const r = req('iluminacion_frac', '>=', 0.5, { unidad: 'fraction' });
  const c = compararRequisito(r, { estado: 'ok', valor: 0.6 }, { estado: 'no_medido', valor: null, motivo: 'no illumination layer on this terrain' });
  assert.equal(c.lectura, 'no_medible');
  assert.match(c.motivo, /no illumination layer/);
});

test('excavator loads: volume to mass with a density range, none without density', () => {
  const c = cargasExcavadora(10000, [1300, 1920], 10000);
  assert.deepEqual(c, { min: 1300, max: 1920 });
  assert.equal(cargasExcavadora(10000, [], 10000), null);
  assert.equal(cargasExcavadora(0, [1300, 1920], 10000).min, 0);
  assert.equal(cargasExcavadora(10, [1300], null), null);
});

const cotaInf = (valor) => ({ horas_en_sombra: { valor, como: 'shadow stretch ÷ catalogue top speed', cota: 'inferior', notaCota: 'at catalogue top speed 0.72 km/h' } });

test('a lower bound under an upper limit cannot say OK: it is "lower bound only"', () => {
  const r = evaluarRequisito(req('horas_en_sombra', '<', 50, { unidad: 'h' }), cotaInf(3.5));
  assert.equal(r.estado, 'cota_inferior');
  assert.equal(r.cota, 'inferior');
  assert.equal(r.exceso, null);
  assert.equal(r.notaCota, 'at catalogue top speed 0.72 km/h');
  const r2 = evaluarRequisito(req('horas_en_sombra', '<=', 150, { unidad: 'h' }), cotaInf(150));
  assert.equal(r2.estado, 'cota_inferior');
});

test('a lower bound that already exceeds an upper limit breaks (by at least the excess)', () => {
  const r = evaluarRequisito(req('horas_en_sombra', '<', 50, { unidad: 'h' }), cotaInf(60));
  assert.equal(r.estado, 'rompe');
  assert.equal(r.cota, 'inferior');
  assert.equal(r.exceso, 10);
});

test('a lower bound under a lower limit: meeting it is a valid OK, missing it is only a lower bound', () => {
  assert.equal(evaluarRequisito(req('horas_en_sombra', '>=', 10, { unidad: 'h' }), cotaInf(12)).estado, 'ok');
  const r = evaluarRequisito(req('horas_en_sombra', '>', 10, { unidad: 'h' }), cotaInf(8));
  assert.equal(r.estado, 'cota_inferior');
  assert.equal(r.exceso, null);
});

test('an exact measurement keeps the plain verdicts', () => {
  const r = evaluarRequisito(req('horas_en_sombra', '<', 50, { unidad: 'h' }), { horas_en_sombra: { valor: 3.5, como: 'x' } });
  assert.equal(r.estado, 'ok');
  assert.equal(r.cota, null);
});

test('comparing lower bounds says so', () => {
  const r = req('horas_en_sombra', '<', 50, { unidad: 'h' });
  const c = compararRequisito(r, { valor: 3, cota: 'inferior' }, { valor: 3.1, cota: 'inferior' });
  assert.equal(c.lectura, 'reproducido');
  assert.match(c.motivo, /lower bounds/);
});

test('the shown value never equals the shown limit when the verdict breaks', () => {
  const r = evaluarRequisito(req('pendiente_deg', '<=', 15), { pendiente_deg: { valor: 15.04 } });
  const d = decimalesVeredicto(r, 1);
  assert.equal(cantidad(r.valor, 'deg', d), '15.04°');
  assert.equal(cantidad(r.exceso, 'deg', d), '0.04°');
  assert.equal(cantidad(r.limite, 'deg'), '15°');
});

test('a strict limit that is met is shown distinct from the limit', () => {
  const r = evaluarRequisito(req('pendiente_deg', '<', 15), { pendiente_deg: { valor: 14.96 } });
  assert.equal(r.estado, 'ok');
  assert.equal(cantidad(r.valor, 'deg', decimalesVeredicto(r, 1)), '14.96°');
});

test('a value clearly away from the limit keeps the usual decimals; equal to the limit stays as is', () => {
  const r = evaluarRequisito(req('pendiente_deg', '<=', 15), { pendiente_deg: { valor: 22.5 } });
  assert.equal(decimalesVeredicto(r, 1), 1);
  const r2 = evaluarRequisito(req('pendiente_deg', '<', 15), { pendiente_deg: { valor: 15 } });
  assert.equal(decimalesVeredicto(r2, 1), 1);
});

test('metres shown in km do not hide a break at the limit', () => {
  const r = evaluarRequisito(req('separacion_m', '>=', 1000, { unidad: 'm', respecto_a: 'h' }), { separacion_m: { h: { valor: 999.6 } } });
  const d = decimalesVeredicto(r, 0);
  assert.equal(cantidad(r.valor, 'm', d), '999.6 m');
  assert.equal(cantidad(r.exceso, 'm', d), '0.4 m');
  const r2 = evaluarRequisito(req('separacion_m', '<=', 1000, { unidad: 'm', respecto_a: 'h' }), { separacion_m: { h: { valor: 1004 } } });
  assert.notEqual(cantidad(r2.valor, 'm', decimalesVeredicto(r2, 0)), cantidad(1000, 'm'));
});

test('rounding up for a threshold: the shown number connects and differs from the failed limit', () => {
  assert.equal(redondearArriba(15.04, 1), 15.1);
  assert.equal(redondearArriba(10.0000086, 1), 10.1);
  assert.equal(redondearArriba(12.5, 1), 12.5);
  const f32 = Math.fround(12.3);
  assert.ok(redondearArriba(f32, 1) >= f32);
});

test('slope on the original view is labelled original DEM', () => {
  const m = medirPunto({ ...terreno(rampa(9, 39.0625, 5)), original: true }, 4, 4);
  assert.match(m.pendiente_deg.como, /^original DEM slope/);
  assert.match(medirPunto(terreno(rampa(9, 39.0625, 5)), 4, 4).pendiente_deg.como, /^retouched DEM slope/);
});

test('slope bases of the two terrains: a note only when they differ, with both bases', () => {
  assert.equal(notaBasesPendiente(39.0625, 39.0625), null);
  const t = notaBasesPendiente(9.765625, 39.0625);
  assert.match(t, /over 20 m/);
  assert.match(t, /over 78 m/);
  assert.match(t, /9\.77 m\/px/);
  assert.match(t, /39\.06 m\/px/);
});

test('a point on water: slope is not measured ("water surface, not ground") and the water class is returned', () => {
  const agua = new Float32Array(81);
  agua[4 * 9 + 4] = 2;
  const m = medirPunto(terreno(rampa(9, 39.0625, 0), { agua }), 4, 4);
  assert.equal(m.pendiente_deg.valor, null);
  assert.equal(m.pendiente_deg.motivo, 'water surface, not ground');
  assert.equal(m.agua, 2);
  const r = evaluarRequisito(req('pendiente_deg', '<=', 5), m);
  assert.equal(r.estado, 'no_medido');
  assert.match(r.motivo, /water surface, not ground/);
});

test('on water the other requirements follow their normal path', () => {
  const agua = new Float32Array(81).fill(1), ilu = new Float32Array(81).fill(0.4);
  const m = medirPunto(terreno(rampa(9, 39.0625, 0), { agua, iluminacion: ilu }), 4, 4);
  assert.equal(evaluarRequisito(req('iluminacion_frac', '>=', 0.3, { unidad: 'fraction' }), m).estado, 'ok');
  assert.match(m.horas_en_sombra.motivo, /needs a route/);
});

test('land (0), no water data (NaN) and a terrain without the layer measure the slope as before', () => {
  const agua = new Float32Array(81);
  agua[4 * 9 + 4] = NaN;
  const nan = medirPunto(terreno(rampa(9, 39.0625, 7), { agua }), 4, 4);
  assert.ok(Math.abs(nan.pendiente_deg.valor - 7) < 1e-3);
  assert.ok(!(nan.agua >= 1));
  const tierra = medirPunto(terreno(rampa(9, 39.0625, 7), { agua }), 3, 3);
  assert.equal(tierra.agua, 0);
  const sin = medirPunto(terreno(rampa(9, 39.0625, 7)), 4, 4);
  assert.equal(sin.agua, null);
});
