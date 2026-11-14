import test from 'node:test';
import assert from 'node:assert/strict';
import { aplicarToque, pesoPincel, pasoMetros } from '../terreno/pincel.js';
import { Historial } from '../terreno/historial.js';

function estadoPlano(n, cota = 100, m = 10) {
  return { n, m_por_px: m, base: new Float32Array(n * n).fill(cota), delta: new Float32Array(n * n) };
}
const alt = (e, f, c) => e.base[f * e.n + c] + e.delta[f * e.n + c];

test('brush weight is 1 at the centre, 0 at the radius and decreases outward', () => {
  assert.equal(pesoPincel(0, 50), 1);
  assert.equal(pesoPincel(50, 50), 0);
  assert.equal(pesoPincel(80, 50), 0);
  assert.ok(pesoPincel(10, 50) > pesoPincel(30, 50));
});

test('raise adds the full step at the centre cell and nothing outside the radius', () => {
  const e = estadoPlano(21);
  const reg = new Map();
  aplicarToque(e, { fila: 10, col: 10, radio_m: 50, intensidad: 1, herramienta: 'subir' }, reg);
  assert.equal(alt(e, 10, 10), 100 + pasoMetros(50, 1));
  assert.equal(alt(e, 10, 16), 100);
  assert.ok(alt(e, 10, 13) > 100 && alt(e, 10, 13) < alt(e, 10, 11));
  assert.equal(e.base[10 * 21 + 10], 100, 'original heights untouched');
});

test('lower is the mirror of raise', () => {
  const e = estadoPlano(21);
  aplicarToque(e, { fila: 10, col: 10, radio_m: 50, intensidad: 0.5, herramienta: 'bajar' }, new Map());
  assert.equal(alt(e, 10, 10), 100 - pasoMetros(50, 0.5));
});

test('flatten at full strength sets the centre cell to the target elevation', () => {
  const e = estadoPlano(21);
  for (let i = 0; i < e.base.length; i++) e.base[i] = 100 + (i % 21);
  aplicarToque(e, { fila: 10, col: 10, radio_m: 40, intensidad: 1, herramienta: 'allanar', cota_objetivo: 105 }, new Map());
  assert.ok(Math.abs(alt(e, 10, 10) - 105) < 1e-4);
  const antes = Math.abs(100 + 12 - 105), despues = Math.abs(alt(e, 10, 12) - 105);
  assert.ok(despues < antes, 'neighbour moves toward target');
});

test('smooth pulls a single spike toward its neighbours and does not move flat ground', () => {
  const e = estadoPlano(21);
  e.base[10 * 21 + 10] = 200;
  aplicarToque(e, { fila: 10, col: 10, radio_m: 30, intensidad: 1, herramienta: 'suavizar' }, new Map());
  assert.ok(alt(e, 10, 10) < 200 && alt(e, 10, 10) > 100);
  assert.equal(alt(e, 3, 3), 100);
});

test('NaN cells stay NaN gaps and are never written', () => {
  const e = estadoPlano(21);
  e.base[10 * 21 + 10] = NaN;
  aplicarToque(e, { fila: 10, col: 10, radio_m: 50, intensidad: 1, herramienta: 'subir' }, new Map());
  assert.equal(e.delta[10 * 21 + 10], 0);
  aplicarToque(e, { fila: 10, col: 11, radio_m: 50, intensidad: 1, herramienta: 'suavizar' }, new Map());
  assert.ok(Number.isFinite(alt(e, 10, 11)));
});

test('brush near the edge clips to the grid', () => {
  const e = estadoPlano(8);
  const caja = aplicarToque(e, { fila: 0, col: 0, radio_m: 30, intensidad: 1, herramienta: 'subir' }, new Map());
  assert.deepEqual([caja.f0, caja.c0], [0, 0]);
  assert.ok(alt(e, 0, 0) > 100);
});

test('the stroke register keeps the delta from before the first touch of each cell', () => {
  const e = estadoPlano(21);
  const reg = new Map();
  aplicarToque(e, { fila: 10, col: 10, radio_m: 50, intensidad: 1, herramienta: 'subir' }, reg);
  aplicarToque(e, { fila: 10, col: 10, radio_m: 50, intensidad: 1, herramienta: 'subir' }, reg);
  assert.equal(reg.get(10 * 21 + 10), 0);
});

test('undo restores the deltas of the whole stroke and redo reapplies them', () => {
  const e = estadoPlano(21);
  const h = new Historial();
  h.comenzar();
  aplicarToque(e, { fila: 10, col: 10, radio_m: 50, intensidad: 1, herramienta: 'subir' }, h.trazo);
  aplicarToque(e, { fila: 10, col: 12, radio_m: 50, intensidad: 1, herramienta: 'subir' }, h.trazo);
  h.terminar(e.delta);
  const tras = Float32Array.from(e.delta);
  assert.ok(h.puedeDeshacer());
  h.deshacer(e.delta);
  assert.ok(e.delta.every((d) => d === 0));
  assert.ok(h.puedeRehacer());
  h.rehacer(e.delta);
  assert.deepEqual(e.delta, tras);
});

test('a new stroke after undo drops the redo branch', () => {
  const e = estadoPlano(11);
  const h = new Historial();
  for (const col of [3, 7]) {
    h.comenzar();
    aplicarToque(e, { fila: 5, col, radio_m: 20, intensidad: 1, herramienta: 'subir' }, h.trazo);
    h.terminar(e.delta);
  }
  h.deshacer(e.delta);
  h.comenzar();
  aplicarToque(e, { fila: 2, col: 2, radio_m: 20, intensidad: 1, herramienta: 'bajar' }, h.trazo);
  h.terminar(e.delta);
  assert.equal(h.puedeRehacer(), false);
});

test('an empty stroke does not create an undo step', () => {
  const h = new Historial();
  h.comenzar();
  h.terminar(new Float32Array(4));
  assert.equal(h.puedeDeshacer(), false);
});

test('a bulk replacement (reset or import) is one undoable step', () => {
  const e = estadoPlano(5);
  e.delta[3] = 2; e.delta[7] = -1;
  const h = new Historial();
  h.reemplazar(e.delta, new Float32Array(25));
  assert.ok(e.delta.every((d) => d === 0));
  h.deshacer(e.delta);
  assert.equal(e.delta[3], 2); assert.equal(e.delta[7], -1);
});

test('history keeps at most the configured number of steps', () => {
  const d = new Float32Array(4);
  const h = new Historial(2);
  for (let i = 0; i < 4; i++) { h.comenzar(); h.trazo.set(0, d[0]); d[0] += 1; h.terminar(d); }
  assert.ok(h.deshacer(d)); assert.ok(h.deshacer(d));
  assert.equal(h.deshacer(d), null);
  assert.equal(d[0], 2);
});
