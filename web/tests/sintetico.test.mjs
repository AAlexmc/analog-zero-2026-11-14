import test from 'node:test';
import assert from 'node:assert/strict';
import { terrenoSintetico } from '../terreno/sintetico.js';
import { rango } from '../terreno/calculo.js';

test('synthetic terrains follow the contract shape and are labelled as synthetic', () => {
  for (const cuerpo of ['luna', 'tierra']) {
    const t = terrenoSintetico(cuerpo, 128);
    const m = t.meta;
    assert.equal(m.cuerpo, cuerpo);
    assert.equal(m.sintetico, true);
    assert.match(m.nombre, /synthetic/i);
    assert.equal(t.altura.length, m.n * m.n);
    assert.ok(Math.abs(m.n * m.m_por_px - m.lado_km * 1000) < 1e-6);
    assert.match(m.capas.altura.fuente, /synthetic/i);
    const r = rango(t.altura);
    assert.equal(m.z_min, r.min); assert.equal(m.z_max, r.max);
  }
});

test('synthetic terrains are deterministic', () => {
  assert.deepEqual(terrenoSintetico('luna', 64).altura, terrenoSintetico('luna', 64).altura);
});

test('the synthetic Earth site has a NaN gap and the Moon site an illumination layer in 0-1', () => {
  const e = terrenoSintetico('tierra', 128);
  assert.ok(rango(e.altura).nan > 0);
  const l = terrenoSintetico('luna', 128);
  const il = l.capas.iluminacion;
  assert.ok(il.every((v) => v >= 0 && v <= 1));
  assert.equal(l.meta.capas.iluminacion.unidad, 'fraction 0-1');
});
