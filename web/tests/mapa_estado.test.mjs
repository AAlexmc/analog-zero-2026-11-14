import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { leerURL, escribirURL, enlaceTerreno } from '../mapa/estado.js';
import { resumenValidacion, resumenSombras, jsonAHtml } from '../mapa/validacion.js';

test('permalink round-trips pair, layer and the open cell', () => {
  const e = { ejemplo: true, par: 'shackleton_P5', capa: 'D9', lat: -12.25, lon: 179.75 };
  assert.deepEqual(leerURL(escribirURL(e)), e);
});

test('permalink without an open cell has no lat/lon, and junk numbers are ignored', () => {
  const s = escribirURL({ ejemplo: false, par: 'shackleton_P3', capa: 'S', lat: null, lon: null });
  assert.equal(s, '?par=shackleton_P3&capa=S');
  assert.deepEqual(leerURL('?lat=abc&lon=&par=x'), { ejemplo: false, par: 'x', capa: null, lat: null, lon: null });
});

test('permalink: latitude outside ±90 or longitude outside ±180 is ignored; the edges themselves are kept', () => {
  assert.equal(leerURL('?lat=91&lon=0').lat, null);
  assert.equal(leerURL('?lat=-90.5&lon=0').lat, null);
  assert.equal(leerURL('?lat=10&lon=540').lon, null);
  assert.equal(leerURL('?lat=10&lon=-180.25').lon, null);
  assert.deepEqual([leerURL('?lat=-90&lon=180').lat, leerURL('?lat=-90&lon=180').lon], [-90, 180]);
  assert.deepEqual([leerURL('?lat=90&lon=-180').lat, leerURL('?lat=90&lon=-180').lon], [90, -180]);
});

const LUNARES = ['shackleton', 'polo_sur', 'shackleton_borde'];
test('3D bridge pairs the Earth terrain with the lunar terrain of the base site', () => {
  assert.deepEqual(enlaceTerreno('haughton', 'shackleton', LUNARES), { href: 'terreno/index.html?a=haughton&b=shackleton', solo: false });
  assert.deepEqual(enlaceTerreno('sp_crater', 'polo_sur', LUNARES), { href: 'terreno/index.html?a=sp_crater&b=polo_sur', solo: false });
  assert.equal(enlaceTerreno('a&b', 'shackleton', LUNARES).href, 'terreno/index.html?a=a%26b&b=shackleton');
});

test('3D bridge opens the Earth terrain alone when the base site has no 3D terrain, and never pairs Mars with Shackleton', () => {
  for (const obj of ['jezero', 'arcadia', 'otro_lunar', null, undefined]) {
    assert.deepEqual(enlaceTerreno('mistastin', obj, LUNARES), { href: 'terreno/index.html?solo=mistastin', solo: true }, String(obj));
  }
  assert.deepEqual(enlaceTerreno('haughton', 'shackleton', []), { href: 'terreno/index.html?solo=haughton', solo: true });
});

test('real data: no Mars base site gets a lunar pair on the 3D bridge', async (t) => {
  let ind, obj, man;
  try {
    [ind, obj, man] = await Promise.all(['../data/terreno/index.json', '../data/global/objetivos.json', '../data/global/capas.json']
      .map(async (p) => JSON.parse(await readFile(new URL(p, import.meta.url), 'utf8'))));
  } catch { t.skip('no terrain index or global layers'); return; }
  const lunares = ind.terrenos.filter((x) => x.cuerpo === 'luna').map((x) => x.id);
  const tierra = ind.terrenos.filter((x) => x.cuerpo === 'tierra').map((x) => x.id);
  const marte = obj.objetivos.filter((o) => o.cuerpo === 'marte').map((o) => o.id);
  assert.ok(marte.length >= 1);
  for (const par of man.pares) {
    for (const id of tierra) {
      const e = enlaceTerreno(id, par.objetivo, lunares);
      if (marte.includes(par.objetivo)) assert.equal(e.href, `terreno/index.html?solo=${id}`, par.id);
      else if (par.objetivo === 'shackleton') assert.equal(e.href, `terreno/index.html?a=${id}&b=shackleton`, par.id);
    }
  }
});

// Claves de pipeline/validacion/__main__.py e informe.py.
test('validation summary reads k, n, k0, H1-S, H3 and the hash; missing fields stay null', () => {
  const r = resumenValidacion({ h1: { k: 7, n_sitios: 11, k0: 3, veredicto: 'x' }, h1_s: { n_sitios: 11, n_dentro: 4, n_no_evaluables: 1 }, umbrales_sha256: 'ab12', generado: '2000-01-01T00:00:00Z' });
  assert.deepEqual(r.h1, { k: 7, n: 11, k0: 3, veredicto: 'x' });
  assert.equal(resumenValidacion({ h1: { veredicto: 5 } }).h1.veredicto, null);
  assert.deepEqual(r.h1s, { k: 4, n: 11, noEval: 1 });
  assert.deepEqual(r.h3, { aciertos: null, de: null });
  assert.equal(r.sha, 'ab12');
  assert.equal(resumenValidacion(null), null);
  assert.equal(resumenValidacion({ h1: { k: '7' } }).h1.k, null);
});

test('shadow validation lists the primary terrain first, from the real file', async () => {
  const v = JSON.parse(await readFile(new URL('../data/validacion_sombras.json', import.meta.url), 'utf8'));
  const r = resumenSombras(v);
  assert.ok(r.length >= 1);
  assert.match(r[0].rol, /^primary/);
  assert.equal(r[0].pearson, v.terrenos[r[0].id].metricas.iluminacion.pearson);
  assert.deepEqual(resumenSombras(null), []);
});

test('raw JSON dump escapes markup', () => {
  const h = jsonAHtml({ '<b>': ['<i>', 1], x: { y: null } });
  assert.doesNotMatch(h, /<b>|<i>/);
  assert.match(h, /&lt;b&gt;/);
});
