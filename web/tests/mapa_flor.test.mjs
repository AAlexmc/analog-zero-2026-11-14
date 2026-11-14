import test from 'node:test';
import assert from 'node:assert/strict';
import { florSVG, estadoPetalo, ROMPE } from '../mapa/flor.js';

const petalos = [
  { id: 'D1', nombre: 'Geology', estado: 'valor', v: 0.82 },
  { id: 'D2', nombre: 'Terrain', estado: 'valor', v: 0.12 },
  { id: 'D3', nombre: 'Temperature', estado: 'sin_dato' },
  { id: 'D8', nombre: 'Operations', estado: 'valor', v: 0 },
];
const grupos = (svg) => [...svg.matchAll(/<g class="petalo ([a-z]+)" data-dim="(D\d)">([\s\S]*?)<\/g>/g)].map((m) => ({ clase: m[1], id: m[2], cuerpo: m[3] }));

test('one petal per dimension, in the given order', () => {
  assert.deepEqual(grupos(florSVG(petalos)).map((g) => g.id), ['D1', 'D2', 'D3', 'D8']);
});

test('breaks only below 0.4: red class and a split petal (two halves)', () => {
  assert.equal(ROMPE, 0.4);
  assert.equal(estadoPetalo({ estado: 'valor', v: 0.4 }), 'ok');
  assert.equal(estadoPetalo({ estado: 'valor', v: 0.399 }), 'rompe');
  const g = grupos(florSVG(petalos));
  assert.equal(g[1].clase, 'rompe');
  assert.equal((g[1].cuerpo.match(/class="relleno"/g) ?? []).length, 2);
  assert.equal((g[0].cuerpo.match(/class="relleno"/g) ?? []).length, 1);
});

test('no data is a hatched ghost petal labelled n/d, never a zero-length petal', () => {
  const g = grupos(florSVG(petalos))[2];
  assert.equal(g.clase, 'nd');
  assert.match(g.cuerpo, /class="fantasma"/);
  assert.match(g.cuerpo, />n\/d</);
  assert.doesNotMatch(g.cuerpo, /0\.00/);
});

test('a real zero is printed as 0.00 and drawn, distinct from n/d', () => {
  const g = grupos(florSVG(petalos))[3];
  assert.match(g.cuerpo, />0\.00</);
  assert.match(g.cuerpo, /class="valor"/);
});

test('value printed next to every petal; n/a kept apart from n/d', () => {
  const svg = florSVG([{ id: 'D5', nombre: 'Dust', estado: 'na' }, { id: 'D6', nombre: 'Bio', estado: 'valor', v: 0.5 }]);
  assert.match(svg, />n\/a</);
  assert.match(svg, />0\.50</);
});

test('no closed contour joining petals: no polygon or polyline', () => {
  assert.doesNotMatch(florSVG(petalos), /<polygon|<polyline/);
});

test('an interval, when given, is drawn as its own band and written', () => {
  const svg = florSVG([{ id: 'D1', nombre: 'x', estado: 'valor', v: 0.6, p5: 0.5, p95: 0.7 }]);
  assert.match(svg, /class="banda"/);
  assert.match(svg, /0\.60 \[0\.50–0\.70\]/);
  assert.doesNotMatch(florSVG(petalos), /class="banda"/);
});

test('petal angular width is the same whatever the value', () => {
  const svg = florSVG([{ id: 'D1', nombre: 'a', estado: 'valor', v: 0.9 }, { id: 'D2', nombre: 'b', estado: 'valor', v: 0.5 }]);
  const anchos = [...svg.matchAll(/class="valor" d="M([-\d.]+) ([-\d.]+) A([\d.]+) [\d.]+ 0 0 1 ([-\d.]+) ([-\d.]+)"/g)].map((m) => {
    const r = +m[3], cuerda = Math.hypot(m[4] - m[1], m[5] - m[2]);
    return 2 * Math.asin(cuerda / (2 * r));
  });
  assert.equal(anchos.length, 2);
  assert.ok(Math.abs(anchos[0] - anchos[1]) < 1e-3);
});
