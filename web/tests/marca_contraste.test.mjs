import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PALETA, PAREJAS, contraste, mezclar } from '../marca/contraste.js';

test('WCAG contrast matches known values', () => {
  assert.equal(contraste([0, 0, 0], [255, 255, 255]), 21);
  assert.equal(contraste('white', 'white'), 1);
  assert.ok(Math.abs(contraste([119, 119, 119], [255, 255, 255]) - 4.48) < 0.01);
  assert.deepEqual(mezclar('white', 0, 'deep-blue'), [7, 23, 63]);
});

test('palette in contraste.js is the palette of marca.css', async () => {
  const css = await readFile(new URL('../marca/marca.css', import.meta.url), 'utf8');
  for (const [nombre, hex] of Object.entries(PALETA)) {
    const m = css.match(new RegExp(`--${nombre}:\\s*(#[0-9A-Fa-f]{6})`));
    assert.ok(m, `--${nombre} missing in marca.css`);
    assert.equal(m[1].toUpperCase(), hex.toUpperCase(), nombre);
  }
});

for (const p of PAREJAS) {
  test(`contrast ≥ 4.5:1 — ${p.uso}`, () => {
    const c = contraste(p.texto, p.fondo);
    assert.ok(c >= 4.5, `${p.uso}: ${c.toFixed(2)}:1`);
  });
}

test('blue yonder is not usable as text on electric blue (so the pages never do it)', () => {
  assert.ok(contraste('blue-yonder', 'electric-blue') < 4.5);
});
