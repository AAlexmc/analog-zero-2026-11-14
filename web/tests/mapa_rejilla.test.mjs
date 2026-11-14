import test from 'node:test';
import assert from 'node:assert/strict';
import { latLonDeCelda, celdaDeLatLon, celdaDePosicion, posicionDeLatLon, valorByte, leerPuertas, estadoCelda, cercanos, distanciaCeldas, segmentosCosta } from '../mapa/rejilla.js';

const R = { ancho: 720, alto: 360, fila0: 'norte', lon0: -179.75, lat0: 89.75, paso: 0.5 };

test('row 0 is the north and column 0 is lon −179.75 (cell centres)', () => {
  assert.deepEqual(latLonDeCelda(R, 0, 0), { lat: 89.75, lon: -179.75 });
  assert.deepEqual(latLonDeCelda(R, 359, 719), { lat: -89.75, lon: 179.75 });
});

test('lat/lon → cell → lat/lon round-trips on every centre of a sample', () => {
  for (const [f, c] of [[0, 0], [29, 180], [180, 360], [359, 719], [123, 456]]) {
    const { lat, lon } = latLonDeCelda(R, f, c);
    assert.deepEqual(celdaDeLatLon(R, lat, lon), { fila: f, col: c });
  }
});

test('Haughton (75.38 N, 89.67 W) falls in row 29, column 180', () => {
  assert.deepEqual(celdaDeLatLon(R, 75.3833, -89.6667), { fila: 29, col: 180 });
});

test('longitudes outside −180…180 wrap; latitudes off the grid give no cell', () => {
  assert.deepEqual(celdaDeLatLon(R, 0.25, 180.25), celdaDeLatLon(R, 0.25, -179.75));
  assert.equal(celdaDeLatLon(R, 91, 0), null);
  assert.equal(celdaDeLatLon(R, NaN, 0), null);
});

test('the poles and the date line open the edge cells; just past ±90° gives no cell', () => {
  assert.deepStrictEqual(celdaDeLatLon(R, -90, 0), { fila: 359, col: 360 });
  assert.deepStrictEqual(celdaDeLatLon(R, 90, 0), { fila: 0, col: 360 });
  assert.deepStrictEqual(celdaDeLatLon(R, -90, 180), { fila: 359, col: 0 });
  assert.deepStrictEqual(celdaDeLatLon(R, 90, -180), { fila: 0, col: 0 });
  assert.deepStrictEqual(celdaDeLatLon(R, 10.25, 180), celdaDeLatLon(R, 10.25, -180));
  assert.equal(celdaDeLatLon(R, -90.01, 0), null);
  assert.equal(celdaDeLatLon(R, 90.01, 0), null);
});

test('screen position in cell units maps to the cell under it, and outside gives null', () => {
  assert.deepEqual(celdaDePosicion(R, 0.01, 0.99), { fila: 0, col: 0 });
  assert.deepEqual(celdaDePosicion(R, 719.9, 359.9), { fila: 359, col: 719 });
  assert.equal(celdaDePosicion(R, -0.1, 3), null);
  assert.equal(celdaDePosicion(R, 3, 360), null);
  const p = posicionDeLatLon(R, 89.75, -179.75);
  assert.deepEqual(p, { x: 0.5, y: 0.5 });
});

test('byte decoding: value = offset + byte·scale; 254 is n/a; 255 is no data; never 0', () => {
  const c = { id: 'S', scale: 0.004, offset: 0 };
  assert.deepEqual(valorByte(0, c), { tipo: 'valor', v: 0 });
  assert.deepEqual(valorByte(250, c), { tipo: 'valor', v: 1 });
  assert.deepEqual(valorByte(254, c), { tipo: 'na' });
  assert.deepEqual(valorByte(255, c), { tipo: 'sin_dato' });
  assert.equal(valorByte(100, { id: 't', scale: 0.5, offset: -60 }).v, -10);
});

test('lithology is a class code, not scaled', () => {
  assert.deepEqual(valorByte(7, { id: 'litologia_glim', scale: 0.004, offset: 3 }), { tipo: 'clase', codigo: 7 });
});

test('gate bits: low nibble = failed, high nibble = no data, in manifest order', () => {
  const puertas = [{ id: 'casquete' }, { id: 'relieve' }];
  assert.deepEqual(leerPuertas(0, puertas).map((p) => p.estado), ['pasa', 'pasa']);
  assert.deepEqual(leerPuertas(0b10, puertas).map((p) => p.estado), ['pasa', 'falla']);
  assert.deepEqual(leerPuertas(0b10000, puertas).map((p) => p.estado), ['sin_dato', 'pasa']);
  assert.equal(leerPuertas(3, puertas)[0].id, 'casquete');
});

test('cell state: ocean, failed gate, not evaluable, evaluable', () => {
  assert.equal(estadoCelda(255, 255), 'oceano');
  assert.equal(estadoCelda(0, 0b01), 'falla_puerta');
  assert.equal(estadoCelda(255, 0b10000), 'no_evaluable');
  assert.equal(estadoCelda(255, 0), 'no_evaluable');
  assert.equal(estadoCelda(0, 0), 'evaluable');
});

test('known places within one cell, wrapping across the date line', () => {
  const lugares = [{ id: 'a', lat: 75.3667, lon: -89.6833 }, { id: 'b', lat: 75.38, lon: -88.6 }, { id: 'c', lat: 10, lon: 179.9 }, { id: 'sin', lat: null, lon: null }];
  assert.deepEqual(cercanos(R, { fila: 29, col: 180 }, lugares).map((l) => l.id), ['a']);
  assert.deepEqual(cercanos(R, celdaDeLatLon(R, 10.25, -179.75), lugares).map((l) => l.id), ['c']);
  assert.equal(distanciaCeldas({ fila: 0, col: 0 }, { fila: 0, col: 719 }, 720), 1);
});

test('coastline: a single land cell is closed by four unit edges', () => {
  const t = new Uint8Array(9); t[4] = 1;
  const s = segmentosCosta(t, 3, 3);
  assert.equal(s.length, 4);
  const largo = s.reduce((a, [x0, y0, x1, y1]) => a + Math.abs(x1 - x0) + Math.abs(y1 - y0), 0);
  assert.equal(largo, 4);
});

test('coastline: a straight shore is one merged segment, not one per cell', () => {
  const t = new Uint8Array(4 * 5);
  for (let c = 0; c < 5; c++) { t[2 * 5 + c] = 1; t[3 * 5 + c] = 1; }
  assert.deepEqual(segmentosCosta(t, 5, 4), [[0, 2, 5, 2]]);
});
