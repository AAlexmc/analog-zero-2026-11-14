import test from 'node:test';
import assert from 'node:assert/strict';
import { esDeBase, filaRequisito, lecturaPieza, alinear, resumenBase } from '../terreno/asentamiento_ficha.js';
import { evaluarRequisito } from '../terreno/evaluar.js';

const medidas = (pend, sep) => ({ pendiente_deg: { valor: pend }, separacion_m: { habitat_superficie: { valor: sep } } });
const reqPend = { variable: 'pendiente_deg', op: '<=', valor: 20, unidad: 'deg' };
const reqSep = { variable: 'separacion_m', op: '>=', valor: 1000, unidad: 'm', respecto_a: 'habitat_superficie' };
const base = { cuerpo: 'Moon', punto: true, desplazamiento: { este_m: 300, sur_m: -400 }, rejilla: false, cota: 1234.56, pendiente: { valor: 3.21 }, evs: [], sol: { activo: false, el: 30 }, alto_m: 2.6, dia: null, capas: {} };
const fila = (l, id) => l.filas.find((f) => f.id === id);

test('only pieces planted by the base generator count as base pieces', () => {
  assert.equal(esDeBase({ par: 'base:1000:ltv' }), true);
  assert.equal(esDeBase({ par: 'mwha9poy5l2nsu' }), false);
  assert.equal(esDeBase({ par: null }), false);
});

test('a requirement row says the value, the published limit and the verdict, like the side sheet', () => {
  const ok = filaRequisito(evaluarRequisito(reqPend, medidas(12.34, 0)));
  assert.deepEqual([ok.nombre, ok.valor, ok.estado, ok.nota], ['Slope', '12.3°', 'ok', 'published limit ≤ 20°: OK']);
  const mal = filaRequisito(evaluarRequisito(reqSep, medidas(0, 640)), () => 'Surface habitat');
  assert.equal(mal.nombre, 'Distance from Surface habitat');
  assert.equal(mal.estado, 'rompe');
  assert.equal(mal.valor, '640 m');
  assert.match(mal.nota, /≥ 1\.00 km: BREAKS by 360 m/);
  const sin = filaRequisito(evaluarRequisito({ variable: 'temp_k', op: '<=', valor: 300, unidad: 'K' }, medidas(1, 1)));
  assert.equal(sin.valor, 'NOT MEASURED');
  assert.equal(sin.estado, 'nm');
  assert.match(sin.nota, /no temperature layer/);
  const libre = filaRequisito(evaluarRequisito({ variable: 'separacion_m', op: '>=', valor: null, unidad: 'm', respecto_a: 'habitat_superficie', texto: 'not published' }, medidas(1, 1)), () => 'habitat');
  assert.equal(libre.nota, 'no public limit');
});

test('a value shown never contradicts its verdict: 20.04° against a 20° limit is not printed as 20.0°', () => {
  const f = filaRequisito(evaluarRequisito(reqPend, medidas(20.04, 0)));
  assert.equal(f.estado, 'rompe');
  assert.equal(f.valor, '20.04°');
});

test('where the piece is: distance and bearing from the point, or from the window centre outside a simulation', () => {
  assert.equal(fila(lecturaPieza(base), 'lugar').valor, '500 m NE of the point');
  assert.equal(fila(lecturaPieza({ ...base, punto: false }), 'lugar').valor, '500 m NE of the window centre');
  assert.equal(fila(lecturaPieza({ ...base, desplazamiento: { este_m: -1200, sur_m: 0 } }), 'lugar').valor, '1.2 km W of the point');
  assert.equal(fila(lecturaPieza({ ...base, desplazamiento: { este_m: 0, sur_m: 30 } }), 'lugar').valor, '30 m S of the point');
  assert.equal(fila(lecturaPieza({ ...base, rejilla: true }), 'lugar').valor, '500 m from the point', 'no compass bearing on a polar map');
  assert.equal(fila(lecturaPieza({ ...base, desplazamiento: { este_m: 0, sur_m: 0 } }), 'lugar').valor, 'at the point');
});

test('with no published slope limit the slope is still shown, and says there is no limit', () => {
  const l = lecturaPieza(base);
  assert.equal(fila(l, 'pendiente').valor, '3.2°');
  assert.match(fila(l, 'pendiente').nota, /no public slope limit/);
  const sinDato = lecturaPieza({ ...base, pendiente: { valor: null, motivo: 'water surface, not ground' } });
  assert.equal(fila(sinDato, 'pendiente').valor, 'NOT MEASURED');
  assert.equal(fila(sinDato, 'pendiente').nota, 'water surface, not ground');
  const conLimite = lecturaPieza({ ...base, evs: [evaluarRequisito(reqPend, medidas(3.21, 0))] });
  assert.equal(fila(conLimite, 'pendiente'), undefined);
  assert.equal(fila(conLimite, 'req:pendiente_deg:<=').estado, 'ok');
});

test('until the Day runs the Sun is the one set by hand, and the card says how to follow the real one', () => {
  const l = lecturaPieza(base);
  assert.equal(fila(l, 'sol').valor, 'set by hand, 30.0° high');
  assert.match(fila(l, 'sol').nota, /Play in Day/);
  assert.equal(fila(l, 'luz'), undefined);
});

test('with the Day running: Sun height and bearing, light on the piece and the length of its shadow', () => {
  const dia = lecturaPieza({ ...base, sol: { activo: true, el: 45, az: 90, polar: false, luz: true } });
  assert.equal(fila(dia, 'sol').valor, '45.0° high, to the E');
  assert.equal(fila(dia, 'luz').valor, 'sunlit');
  assert.equal(fila(dia, 'sombra').valor, '2.6 m');
  const tapado = lecturaPieza({ ...base, sol: { activo: true, el: 10, az: 180, polar: false, luz: false } });
  assert.equal(fila(tapado, 'luz').valor, 'in the shadow of the terrain');
  assert.equal(fila(tapado, 'sombra'), undefined);
  const noche = lecturaPieza({ ...base, sol: { activo: true, el: -12.3, az: 0, polar: false, luz: false } });
  assert.equal(fila(noche, 'sol').valor, '12.3° below the horizon');
  assert.equal(fila(noche, 'sol').nota, 'night');
  assert.equal(fila(noche, 'luz').valor, 'in the dark');
  const polar = lecturaPieza({ ...base, sol: { activo: true, el: 1.5, az: 200, polar: true, luz: true } });
  assert.equal(fila(polar, 'sol').valor, '1.5° high');
  assert.match(fila(polar, 'sol').nota, /season/);
  const sinAlto = lecturaPieza({ ...base, alto_m: null, sol: { activo: true, el: 45, az: 90, polar: false, luz: true } });
  assert.equal(fila(sinAlto, 'sombra'), undefined);
});

test('the day strip marks each step as sunlit, terrain shadow or night, and counts the sunlit ones', () => {
  const soles = Array.from({ length: 24 }, (_, k) => ({ el: k >= 6 && k < 18 ? 20 : -20 }));
  let v = 0;
  for (let k = 8; k < 16; k++) v |= 1 << k;
  const l = lecturaPieza({ ...base, dia: { v, soles, total: 24, unidad: 'hours', ahora: 9 } });
  assert.equal(fila(l, 'dia').valor, '8 of 24 hours');
  assert.equal(l.tira.map((x) => ({ sol: 'S', sombra: 's', noche: 'n' }[x.c])).join(''), 'nnnnnnssSSSSSSSSssnnnnnn');
  assert.deepEqual(l.tira.slice(5, 9).map((x) => x.c), ['noche', 'sombra', 'sombra', 'sol']);
  assert.equal(l.tira.filter((x) => x.ahora).length, 1);
  assert.equal(l.tira[9].ahora, true);
  const ultimo = lecturaPieza({ ...base, dia: { v: 0x800000, soles, total: 24, unidad: 'steps of 29.5 h', ahora: null } });
  assert.equal(fila(ultimo, 'dia').valor, '1 of 24 steps of 29.5 h');
  assert.equal(ultimo.tira.filter((x) => x.ahora).length, 0);
  const sin = lecturaPieza({ ...base, diaMotivo: 'not computed for this terrain' });
  assert.equal(sin.tira, null);
  assert.equal(fila(sin, 'dia').valor, 'not computed for this terrain');
});

test('map layers appear only where the terrain has them; a missing value is "no data", never zero', () => {
  assert.equal(fila(lecturaPieza(base), 'iluminacion'), undefined);
  const l = lecturaPieza({ ...base, capas: { iluminacion: 0.714, temp_max: NaN } });
  assert.equal(fila(l, 'iluminacion').valor, '71 %');
  assert.equal(fila(l, 'temp_max').valor, 'no data');
});

test('two worlds line up row by row, with a gap where one of them has no such row', () => {
  const a = lecturaPieza({ ...base, capas: { iluminacion: 0.5 } }), b = lecturaPieza({ ...base, cuerpo: 'Earth' });
  const filas = alinear(a, b);
  assert.equal(filas.find((f) => f.id === 'iluminacion').b, null);
  assert.ok(filas.find((f) => f.id === 'cota').a && filas.find((f) => f.id === 'cota').b);
  assert.equal(alinear(a, null).every((f) => f.b === null), true);
});

test('the summary of a base counts and names the pieces that break a published limit', () => {
  assert.deepEqual(resumenBase([{ nombre: 'LTV', rompe: false }, { nombre: 'Reactor', rompe: true }]), { total: 2, rompen: 1, nombres: ['Reactor'] });
});
