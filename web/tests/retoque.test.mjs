import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { estadisticas, exportarRetoque, importarRetoque } from '../terreno/retoque.js';
import { sha256Hex } from '../terreno/sha256.js';

test('stats count touched cells and split cut and fill volumes in m³', () => {
  const d = new Float32Array(16);
  d[1] = 2; d[5] = -0.5; d[9] = -1.5;
  const s = estadisticas(d, 10);
  assert.equal(s.celdas, 3);
  assert.equal(s.rellenado_m3, 2 * 100);
  assert.equal(s.excavado_m3, 2 * 100);
});

test('stats of an untouched terrain are all zero', () => {
  assert.deepEqual(estadisticas(new Float32Array(9), 39.0625), { celdas: 0, excavado_m3: 0, rellenado_m3: 0 });
});

test('export writes the contract shape with ascending indices and float32-exact deltas', () => {
  const d = new Float32Array(1024 * 1024);
  d[12346] = -0.25; d[12345] = 1.5; d[1048575] = Math.fround(0.1);
  const r = exportarRetoque('shackleton', 1024, 'ab'.repeat(32), d);
  assert.deepEqual(Object.keys(r), ['terreno', 'n', 'base_sha256', 'celdas']);
  assert.deepEqual(r.celdas.indices, [12345, 12346, 1048575]);
  assert.equal(Math.fround(r.celdas.delta_m[2]), Math.fround(0.1));
  assert.deepEqual(r.celdas.delta_m.slice(0, 2), [1.5, -0.25]);
});

test('export → JSON → import gives back the same deltas', () => {
  const d = new Float32Array(64 * 64);
  for (let i = 0; i < d.length; i += 7) d[i] = Math.fround(Math.sin(i) * 3.3);
  const sha = 'cd'.repeat(32);
  const json = JSON.stringify(exportarRetoque('haughton', 64, sha, d));
  const back = importarRetoque(JSON.parse(json), { id: 'haughton', n: 64, sha });
  assert.deepEqual(back, d);
});

test('import refuses a retouch made for another terrain', () => {
  const r = { terreno: 'haughton', n: 4, base_sha256: 'x', celdas: { indices: [], delta_m: [] } };
  assert.throws(() => importarRetoque(r, { id: 'shackleton', n: 4, sha: 'x' }), /haughton/);
});

test('import refuses a retouch whose base data changed (sha256 mismatch)', () => {
  const r = { terreno: 't', n: 4, base_sha256: 'aaa', celdas: { indices: [0], delta_m: [1] } };
  assert.throws(() => importarRetoque(r, { id: 't', n: 4, sha: 'bbb' }), /sha256/);
});

test('import refuses wrong n, out-of-range indices, length mismatch and non-finite deltas', () => {
  const ok = { id: 't', n: 4, sha: 's' };
  const mk = (celdas, n = 4) => ({ terreno: 't', n, base_sha256: 's', celdas });
  assert.throws(() => importarRetoque(mk({ indices: [], delta_m: [] }, 8), ok), /n/);
  assert.throws(() => importarRetoque(mk({ indices: [16], delta_m: [1] }), ok), /index/);
  assert.throws(() => importarRetoque(mk({ indices: [-1], delta_m: [1] }), ok), /index/);
  assert.throws(() => importarRetoque(mk({ indices: [1.5], delta_m: [1] }), ok), /index/);
  assert.throws(() => importarRetoque(mk({ indices: [1, 2], delta_m: [1] }), ok), /length/);
  assert.throws(() => importarRetoque(mk({ indices: [1], delta_m: [null] }), ok), /delta/);
  assert.throws(() => importarRetoque({ terreno: 't', n: 4, base_sha256: 's' }, ok), /celdas/);
});

test('sha256 matches node:crypto on empty, short and multi-block inputs', () => {
  for (const len of [0, 3, 55, 56, 64, 1000, 4 * 1024 * 37 + 5]) {
    const b = new Uint8Array(len);
    for (let i = 0; i < len; i++) b[i] = (i * 31 + 7) & 255;
    assert.equal(sha256Hex(b), createHash('sha256').update(b).digest('hex'), `len ${len}`);
  }
});
