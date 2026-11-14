import test from 'node:test';
import assert from 'node:assert/strict';
import { Plantados, huella, deJSON, firmaDisposicion } from '../terreno/plantado.js';

const LTV = {
  id: 'ltv', nombre: 'Lunar Terrain Vehicle', requisitos: [],
  cifras: [
    { nombre: 'pegasus_masa_kg', valor: null, unidad: 'kg', texto: 'not public' },
    { nombre: 'clv1_dimensiones_desplegado_m', valor: [4, 2.3, 2.6], unidad: 'm', texto: 'Astrolab CLV-1 deployed: length x width x height to antenna top', fuente: 'https://astrolab.space/x', cita: 'c', verificado: true },
  ],
};
const CELDA = { id: 'celda_verde', origen: 'mío', cifras: [{ nombre: 'ancho_entre_caras_m', valor: 3.6, unidad: 'm' }] };

test('planting snaps to the cell, gives each item its own id, and can plant several of the same', () => {
  const p = new Plantados(1024);
  const a = p.plantar('ltv', 10.4, 20.6);
  const b = p.plantar('ltv', 10.4, 20.6);
  assert.deepEqual([a.fila, a.col], [10, 21]);
  assert.notEqual(a.uid, b.uid);
  assert.equal(p.lista.length, 2);
});

test('planting outside the grid is clamped to the edge cell', () => {
  const p = new Plantados(8);
  const a = p.plantar('ltv', -3, 99);
  assert.deepEqual([a.fila, a.col], [0, 7]);
});

test('move and remove act on one item only', () => {
  const p = new Plantados(64);
  const a = p.plantar('ltv', 1, 1), b = p.plantar('viper', 2, 2);
  p.mover(a.uid, 5.6, 6.2);
  assert.deepEqual([a.fila, a.col], [6, 6]);
  assert.deepEqual([b.fila, b.col], [2, 2]);
  assert.equal(p.quitar(b.uid), true);
  assert.equal(p.quitar(b.uid), false);
  assert.deepEqual(p.lista.map((x) => x.equipo), ['ltv']);
});

test('JSON keeps equipment and cell only, and reads back', () => {
  const p = new Plantados(64);
  p.plantar('ltv', 1, 2); p.plantar('reactor_fision', 30, 40);
  const json = JSON.parse(JSON.stringify(p.aJSON()));
  assert.deepEqual(json, [{ equipo: 'ltv', fila: 1, col: 2 }, { equipo: 'reactor_fision', fila: 30, col: 40 }]);
  const r = deJSON(json, { n: 64, ids: new Set(['ltv', 'reactor_fision']) });
  assert.equal(r.lista.length, 2);
  assert.equal(r.ignorados, 0);
});

test('reading JSON drops unknown equipment and out-of-grid or non-integer cells, and counts them', () => {
  const r = deJSON([
    { equipo: 'ltv', fila: 0, col: 63 },
    { equipo: 'nave_espacial', fila: 1, col: 1 },
    { equipo: 'ltv', fila: 64, col: 1 },
    { equipo: 'ltv', fila: 1.5, col: 1 },
    { equipo: 'ltv', fila: null, col: 1 },
    null,
  ], { n: 64, ids: new Set(['ltv']) });
  assert.equal(r.lista.length, 1);
  assert.equal(r.ignorados, 5);
});

test('reading something that is not a list fails with a message', () => {
  assert.throws(() => deJSON({ equipo: 'ltv' }, { n: 64, ids: new Set() }), /list/);
});

test('footprint comes from catalogue dimensions; none when the catalogue has none', () => {
  const h = huella(LTV);
  assert.equal(h.forma, 'rect');
  assert.deepEqual([h.largo_m, h.ancho_m], [4, 2.3]);
  assert.equal(h.cifra.fuente, 'https://astrolab.space/x');
  const hx = huella(CELDA);
  assert.equal(hx.forma, 'hex');
  assert.equal(hx.entre_caras_m, 3.6);
  assert.equal(huella({ id: 'flip', cifras: [{ nombre: 'masa_kg', valor: null }] }), null);
  assert.equal(huella({ id: 'x' }), null);
});

test('footprint corners are in grid cells around the planted cell', () => {
  const pts = huella(LTV).esquinas(10, 10, 1);
  assert.equal(pts.length, 4);
  const fs = pts.map((p) => p[0]), cs = pts.map((p) => p[1]);
  assert.ok(Math.abs(Math.max(...cs) - Math.min(...cs) - 4) < 1e-9);
  assert.ok(Math.abs(Math.max(...fs) - Math.min(...fs) - 2.3) < 1e-9);
  const hex = huella(CELDA).esquinas(0, 0, 0.5);
  assert.equal(hex.length, 6);
  const cs2 = hex.map((p) => p[1]);
  assert.ok(Math.abs(Math.max(...cs2) - Math.min(...cs2) - 3.6 / 0.5) < 1e-9);
});

test('layout signature changes with the position or the kind of any planted item, not with the order', () => {
  const a = new Plantados(100), b = new Plantados(100);
  const h = a.plantar('habitat_superficie', 30, 30);
  a.plantar('reactor_fision', 5, 5);
  b.plantar('reactor_fision', 5, 5);
  b.plantar('habitat_superficie', 30, 30);
  assert.equal(firmaDisposicion(a.lista), firmaDisposicion(b.lista));
  const antes = firmaDisposicion(a.lista);
  a.mover(h.uid, 31, 30);
  assert.notEqual(firmaDisposicion(a.lista), antes);
  const c = new Plantados(100);
  c.plantar('torre_solar', 30, 30);
  c.plantar('reactor_fision', 5, 5);
  assert.notEqual(firmaDisposicion(c.lista), firmaDisposicion(b.lista));
  assert.equal(firmaDisposicion([]), '');
});
