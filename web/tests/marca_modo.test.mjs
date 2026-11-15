import test from 'node:test';
import assert from 'node:assert/strict';
import { MODOS, POR_DEFECTO, CLAVE, leerModo, modoValido } from '../marca/modo.js';

test('reading modes: simple and in depth, in depth by default, stored under analog-zero.mode', () => {
  assert.deepEqual(MODOS, ['simple', 'fondo']);
  assert.equal(POR_DEFECTO, 'fondo');
  assert.equal(CLAVE, 'analog-zero.mode');
});

test('only the two known modes are valid', () => {
  assert.equal(modoValido('simple'), true);
  assert.equal(modoValido('fondo'), true);
  for (const x of ['', 'Simple', 'SIMPLE', ' simple', 'depth', 'in depth', null, undefined, 0, 'null', 'toString', '__proto__']) assert.equal(modoValido(x), false, String(x));
});

test('nothing in the URL and nothing stored gives in depth', () => {
  assert.equal(leerModo('', null), 'fondo');
  assert.equal(leerModo(undefined, undefined), 'fondo');
  assert.equal(leerModo('?mundo=moon&lat=-89.7', null), 'fondo');
});

test('the stored choice is used when the URL does not say', () => {
  assert.equal(leerModo('', 'simple'), 'simple');
  assert.equal(leerModo('?mundo=mars', 'fondo'), 'fondo');
  assert.equal(leerModo('?mundo=mars&lat=18.38&lon=77.58', 'simple'), 'simple');
});

test('?modo= in the URL wins over the stored choice', () => {
  assert.equal(leerModo('?modo=simple', 'fondo'), 'simple');
  assert.equal(leerModo('?modo=fondo', 'simple'), 'fondo');
  assert.equal(leerModo('?mundo=moon&modo=simple&lat=-89.68643', null), 'simple');
  assert.equal(leerModo('modo=simple', null), 'simple');
});

test('unknown values fall back: bad URL value to stored, bad stored value to in depth', () => {
  assert.equal(leerModo('?modo=SIMPLE', 'simple'), 'simple');
  assert.equal(leerModo('?modo=deep', null), 'fondo');
  assert.equal(leerModo('?modo=', 'simple'), 'simple');
  assert.equal(leerModo('', 'garbage'), 'fondo');
  assert.equal(leerModo('?modo=%00', 'ÿ'), 'fondo');
  assert.equal(leerModo('?modo=simple&modo=fondo', null), 'simple');
});
