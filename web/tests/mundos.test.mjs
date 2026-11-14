import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const leer = (rel) => JSON.parse(readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8'));
const M = leer('web/data/cuerpos/mundos.json');
const porId = Object.fromEntries(M.mundos.map((m) => [m.id, m]));

test('manifest: Moon and Mars are destinations, Earth is the analog; ids unique', () => {
  assert.deepEqual(M.mundos.map((m) => m.id), ['moon', 'mars', 'earth']);
  assert.equal(new Set(M.mundos.map((m) => m.id)).size, M.mundos.length);
  assert.deepEqual(M.mundos.filter((m) => m.rol === 'destino').map((m) => m.id), ['moon', 'mars']);
  assert.equal(porId.earth.rol, 'analogo');
});

test('manifest: every world has name, mean radius with source, texture path and image credit', () => {
  for (const m of M.mundos) {
    assert.ok(typeof m.nombre === 'string' && m.nombre.length > 0, m.id);
    assert.ok(Number.isFinite(m.radio_km) && m.radio_km > 0, `${m.id} radius`);
    assert.match(m.radio_fuente, /^https:\/\//, `${m.id} radius source`);
    assert.match(m.textura, /^texturas\/[a-z]+_4k\.jpg$/, `${m.id} texture`);
    assert.ok(m.credito.length > 5 && m.credito_fuente.length > 5, `${m.id} credit`);
    assert.ok(Array.isArray(m.sugerencias), `${m.id} suggestions`);
  }
  assert.equal(porId.moon.radio_km, 1737.4);
  assert.equal(porId.mars.radio_km, 3389.5);
});

test('manifest: Moon and Earth textures are in the repo', () => {
  for (const id of ['moon', 'earth']) assert.ok(existsSync(new URL(`../data/cuerpos/${porId[id].textura}`, import.meta.url)), id);
});

test('suggestions: lat/lon in range, ids unique, the lunar south pole first and marked as the NASA base region', () => {
  for (const m of M.mundos) {
    const ids = m.sugerencias.map((s) => s.id);
    assert.equal(new Set(ids).size, ids.length, m.id);
    for (const s of m.sugerencias) {
      assert.ok(Math.abs(s.lat) <= 90 && s.lon > -180 && s.lon <= 180, `${m.id}/${s.id}`);
      assert.ok(s.nombre && s.fuente, `${m.id}/${s.id}`);
    }
  }
  const p = porId.moon.sugerencias[0];
  assert.equal(p.id, 'polo_sur'); assert.equal(p.lat, -90); assert.equal(p.base_nasa, true);
  assert.equal(p.nota, "NASA's planned base region");
  assert.equal(porId.moon.sugerencias.filter((s) => s.base_nasa).length, 1);
  assert.ok(porId.mars.sugerencias.every((s) => !s.base_nasa));
});

test('suggestions copy their coordinates unchanged from the file they cite', () => {
  const umbrales = leer('umbrales.json');
  for (const m of M.mundos) for (const s of m.sugerencias) {
    let ref;
    if (s.fuente.startsWith('umbrales.json')) ref = umbrales.objetivos[s.id];
    else {
      const [, dir] = s.fuente.match(/^web\/data\/terreno\/([a-z_]+)\/meta\.json/);
      assert.equal(dir, s.id);
      ref = leer(`web/data/terreno/${dir}/meta.json`).centro;
    }
    assert.ok(ref, `${m.id}/${s.id}`);
    assert.deepEqual([s.lat, s.lon], [ref.lat, ref.lon], `${m.id}/${s.id}`);
  }
});

test('Meridiani is not suggested: umbrales.json has no coordinates for it', () => {
  assert.equal(leer('umbrales.json').objetivos.meridiani.lat, null);
  assert.ok(!porId.mars.sugerencias.some((s) => s.id === 'meridiani'));
});
