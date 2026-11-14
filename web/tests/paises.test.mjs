import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dentroDeAnillo, paisDe } from '../analogos/paises.js';

const DOC = JSON.parse(readFileSync(new URL('../data/paises_110m.json', import.meta.url), 'utf8'));
const P = DOC.paises;

test('countries file: Natural Earth 1:110m, public domain with its quote, 177 entries with a name, a box and closed rings', () => {
  assert.equal(DOC.meta.licencia, 'public domain');
  assert.equal(DOC.meta.cita, 'All versions of Natural Earth raster + vector map data found on this website are in the public domain.');
  assert.equal(DOC.meta.terminos_url, 'https://www.naturalearthdata.com/about/terms-of-use/');
  assert.match(DOC.meta.url, /^https:\/\/raw\.githubusercontent\.com\/nvkelso\/natural-earth-vector\/master\/geojson\/ne_110m_admin_0_countries\.geojson$/);
  assert.equal(P.length, 177);
  for (const p of P) {
    assert.ok(typeof p.nombre === 'string' && p.nombre.length > 1, JSON.stringify(p.nombre));
    assert.equal(p.caja.length, 4);
    for (const poli of p.poligonos) for (const a of poli) {
      assert.ok(a.length >= 4);
      assert.deepEqual(a[0], a.at(-1));
      for (const [lon, lat] of a) assert.ok(Math.abs(lon) <= 180 && Math.abs(lat) <= 90 && Math.round(lon * 100) === +(lon * 100).toFixed(6) && Math.round(lat * 100) === +(lat * 100).toFixed(6));
    }
  }
});

test('ring test: inside, outside, and a hole flips the answer', () => {
  const cuadro = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
  assert.equal(dentroDeAnillo(5, 5, cuadro), true);
  assert.equal(dentroDeAnillo(15, 5, cuadro), false);
  const conHueco = [{ nombre: 'X', caja: [0, 0, 10, 10], poligonos: [[cuadro, [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]]]] }];
  assert.equal(paisDe(2, 2, conHueco), 'X');
  assert.equal(paisDe(5, 5, conHueco), null);
});

test('a known point in each of 6 countries', () => {
  assert.equal(paisDe(40.42, -3.7, P), 'Spain');
  assert.equal(paisDe(30.04, 31.24, P), 'Egypt');
  assert.equal(paisDe(-15.8, -47.9, P), 'Brazil');
  assert.equal(paisDe(35.68, 139.69, P), 'Japan');
  assert.equal(paisDe(-33.87, 151.21, P), 'Australia');
  assert.equal(paisDe(64.8, -147.7, P), 'United States of America');
});

test('the open sea gives null; Greenland is its own territory; Antarctica down to the pole', () => {
  assert.equal(paisDe(0, -30, P), null);
  assert.equal(paisDe(-40, 90, P), null);
  assert.equal(paisDe(72, -40, P), 'Greenland');
  assert.equal(paisDe(-80, 0, P), 'Antarctica');
  assert.equal(paisDe(-89.5, 100, P), 'Antarctica');
  assert.equal(paisDe(Number.NaN, 0, P), null);
});

test('across the 180° meridian: Chukotka on both sides, Fiji, and longitudes past ±180 wrap', () => {
  assert.equal(paisDe(66, -172, P), 'Russia');
  assert.equal(paisDe(66, 175, P), 'Russia');
  assert.equal(paisDe(68, 179.9, P), 'Russia');
  assert.equal(paisDe(66, 188, P), 'Russia');
  assert.equal(paisDe(-16.5, 179.5, P), 'Fiji');
});

test('real result cells: Svalbard is Norway at this scale; a small Arctic island missing at 1:110m gives null, not a guess', () => {
  assert.equal(paisDe(79.25, 11.25, P), 'Norway');
  assert.equal(paisDe(25.75, 30.25, P), 'Egypt');
  assert.equal(paisDe(81.25, 56.75, P), null);
});
