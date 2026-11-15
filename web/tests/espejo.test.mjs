import test from 'node:test';
import assert from 'node:assert/strict';
import { celdaEspejo, textoDesplazamiento, filasEspejo, resumenEspejo } from '../terreno/espejo.js';

const plano = (n, v = 10) => new Float32Array(n * n).fill(v);

test('the twin lands at the same metres east and south of the window centre', () => {
  const origen = { n: 1023, m: 9.775 }, destino = { n: 1024, m: 39.0625, alturas: plano(1024) };
  const r = celdaEspejo(origen, destino, 511 - 40, 511 + 80);
  assert.equal(r.fila, Math.round(511.5 - (40 * 9.775) / 39.0625));
  assert.equal(r.col, Math.round(511.5 + (80 * 9.775) / 39.0625));
  assert.equal(r.recortado, false);
  assert.equal(r.movido, false);
  assert.ok(Math.abs(r.este_m - 782) < 0.01 && Math.abs(r.sur_m + 391) < 0.01);
  assert.equal(textoDesplazamiento(r), '782 m east and 391 m north of the window centre');
  assert.equal(textoDesplazamiento({ este_m: 0, sur_m: 0.2 }), 'at the window centre');
});

test('a twin that would fall outside the other window is clamped to its edge, and says so', () => {
  const r = celdaEspejo({ n: 1024, m: 39.0625 }, { n: 1023, m: 1.955, alturas: plano(1023) }, 100, 900);
  assert.deepEqual([r.fila, r.col], [0, 1022]);
  assert.equal(r.recortado, true);
});

test('a twin on a no-data cell moves to the nearest cell with data; none at all → null', () => {
  const n = 9, alturas = plano(n);
  for (const i of [40, 41, 39, 31, 49]) alturas[i] = NaN;
  const r = celdaEspejo({ n, m: 1 }, { n, m: 1, alturas }, 4, 4);
  assert.equal(r.movido, true);
  assert.equal(Math.max(Math.abs(r.fila - 4), Math.abs(r.col - 4)), 1);
  assert.ok(Number.isFinite(alturas[r.fila * n + r.col]));
  assert.equal(celdaEspejo({ n, m: 1 }, { n, m: 1, alturas: new Float32Array(n * n).fill(NaN) }, 4, 4), null);
});

const lado = (cuerpo, pend, el, luz, extra = {}) => ({ cuerpo, pendiente: { valor: pend }, sol: { el, luz }, dia: null, capas: {}, ...extra });

test('rows say what matches, what differs and what cannot be measured', () => {
  const luna = lado('Moon', 4.0, 1.5, true, { capas: { iluminacion: 0.8, temp_max: 210 }, dia: { luz: 24, total: 24, unidad: 'steps' } });
  const tierra = lado('Earth', 4.6, 32, true, { dia: { luz: 11, total: 24, unidad: 'steps' } });
  const f = filasEspejo(luna, tierra, [{ parametro: 'pendiente_grados', tipo: 'max', valor: 4.5, unidad: 'deg' }]);
  const de = (id) => f.find((x) => x.id === id);
  assert.equal(de('pendiente').lectura, 'igual');
  assert.equal(de('limite_pendiente').lectura, 'distinto');
  assert.match(de('limite_pendiente').nota, /Earth breaks it, Moon does not/);
  assert.equal(de('sol').lectura, 'distinto');
  assert.match(de('sol').nota, /higher on Earth by 30\.5°/);
  assert.equal(de('luz').lectura, 'igual');
  assert.equal(de('dia').lectura, 'distinto');
  assert.equal(de('iluminacion').lectura, 'no_medible');
  assert.match(de('iluminacion').nota, /no such map for the Earth terrain/);
  const r = resumenEspejo(f);
  assert.deepEqual(r.igual, ['Slope', 'Light on it now']);
  assert.ok(r.distinto.includes('Sun height now') && r.no_medible.length === 2);
});

test('a slope without data is not measurable, never zero', () => {
  const f = filasEspejo({ cuerpo: 'Moon', pendiente: { valor: null, motivo: 'no elevation data at this point' }, sol: {}, capas: {} }, lado('Earth', 3, 20, false));
  assert.equal(f[0].lectura, 'no_medible');
  assert.equal(f[0].a, '—');
  assert.match(f[0].nota, /no elevation data/);
  assert.equal(f.some((x) => x.id === 'sol'), false);
});
