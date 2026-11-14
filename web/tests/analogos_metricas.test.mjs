import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CORTES, grupoDe, ordenar, agrupar, fmtPct, formatoValor, celsius, distanciaKm, masCercano, lineaContexto, fraseParcial, terrenoDelPunto, RAMPA, colorRampa, minMax, pintarMapa } from '../analogos/metricas.js';
import { PALETA } from '../marca/contraste.js';

const p = (id, d) => ({ id, desviacion_pct: d });

test('groups: < 15 close, > 70 far, the cut-offs themselves are "partly similar"', () => {
  assert.deepEqual(CORTES, { cerca: 15, lejos: 70 });
  assert.equal(grupoDe(0), 'cerca');
  assert.equal(grupoDe(14.999), 'cerca');
  assert.equal(grupoDe(15), 'medio');
  assert.equal(grupoDe(70), 'medio');
  assert.equal(grupoDe(70.001), 'lejos');
  assert.equal(grupoDe(100), 'lejos');
  assert.equal(grupoDe(null), null);
  assert.equal(grupoDe(NaN), null);
});

test('rows sorted from smallest to largest deviation, missing data last, ties keep input order', () => {
  const o = ordenar([p('a', 40), p('b', null), p('c', 3), p('d', 40), p('e', 99)]);
  assert.deepEqual(o.map((x) => x.id), ['c', 'a', 'd', 'e', 'b']);
});

test('agrupar splits the real Jezero best place (8 parameters) by the cut-offs, each group sorted', () => {
  const ps = [p('rugosidad_tan', 2.98), p('relieve_m', 10.03), p('t_max_k', 8.12), p('t_min_k', 24.6), p('t_media_k', 16.4), p('insolacion', 16.7), p('ndvi_max', 1.62), p('precip', 66.1), p('x', null)];
  const g = agrupar(ps);
  assert.deepEqual(g.cerca.map((x) => x.id), ['ndvi_max', 'rugosidad_tan', 't_max_k', 'relieve_m']);
  assert.deepEqual(g.medio.map((x) => x.id), ['t_media_k', 'insolacion', 't_min_k', 'precip']);
  assert.deepEqual(g.lejos, []);
  assert.deepEqual(g.sin.map((x) => x.id), ['x']);
  assert.equal(g.cerca.length + g.medio.length + g.lejos.length + g.sin.length, ps.length);
});

test('temperatures in K and °C with a real minus sign', () => {
  assert.equal(formatoValor(269.49554443359375, 'K'), '269.5 K (−3.7 °C)');
  assert.equal(formatoValor(273.15, 'K'), '273.1 K (0.0 °C)');
  assert.equal(formatoValor(300, 'K'), '300.0 K (26.9 °C)');
  assert.equal(celsius(188.927490234375), '−84.2 °C');
  assert.equal(celsius(null), 'no data');
});

test('other units: relief, roughness, sunlight, NDVI, rain, gravity, pressure', () => {
  assert.equal(formatoValor(10.398681640625, 'm'), '10 m');
  assert.equal(formatoValor(7.25, 'm'), '7.3 m');
  assert.equal(formatoValor(0.0009853122755885124, '1 (tangent)'), '0.00099 (slope tangent)');
  assert.equal(formatoValor(4.093796253204346, 'kWh m-2 per 24 h'), '4.09 kWh/m² per day');
  assert.equal(formatoValor(0.0151, '1'), '0.02');
  assert.equal(formatoValor(0, '1'), '0.00');
  assert.equal(formatoValor(190.52, 'mm/year'), '191 mm/year');
  assert.equal(formatoValor(0, 'mm/year'), '0 mm/year');
  assert.equal(formatoValor(3.73, 'm/s2'), '3.73 m/s²');
  assert.equal(formatoValor(788.5274658203125, 'Pa'), '789 Pa');
  assert.equal(formatoValor(87764.296875, 'Pa'), '87.8 kPa');
  assert.equal(formatoValor(3e-10, 'Pa'), '3 × 10⁻¹⁰ Pa');
  assert.equal(formatoValor(null, 'Pa'), 'no data');
  assert.equal(formatoValor(NaN, 'K'), 'no data');
  assert.equal(fmtPct(82.6349), '82.6 %');
  assert.equal(fmtPct(null), '—');
});

test('great-circle distance on Earth: a degree of latitude, antipodes, the 180° seam', () => {
  assert.ok(Math.abs(distanciaKm(0, 0, 1, 0) - 111.19) < 0.01);
  assert.ok(Math.abs(distanciaKm(0, 0, 0, 180) - Math.PI * 6371) < 1e-6);
  assert.ok(Math.abs(distanciaKm(10, 179.9, 10, -179.9) - distanciaKm(10, 0, 10, 0.2)) < 1e-9);
});

const SITIOS = JSON.parse(readFileSync(new URL('../data/sitios_ensayo.json', import.meta.url), 'utf8')).sitios;

test('nearest known analog site: real catalogue, sites without coordinates skipped, 300 km limit', () => {
  const h = SITIOS.find((s) => s.id === 'haughton');
  const c = masCercano(75.25, -84.25, SITIOS);
  assert.equal(c.item.id, 'haughton');
  assert.ok(Math.abs(c.km - distanciaKm(75.25, -84.25, h.lat, h.lon)) < 1e-9);
  assert.equal(lineaContexto(c, 15), `near ${h.nombre} — a known analog site (${Math.round(c.km)} km)`);
  assert.equal(masCercano(0, -150, SITIOS), null);
  assert.equal(lineaContexto(null, 15), 'not near any of the 15 analog sites in our catalogue');
  const lejos = { nombre: 'X', lat: 0, lon: 0 };
  assert.equal(masCercano(0, 300.01 / 111.195, [lejos]), null);
  assert.equal(masCercano(0, 299.9 / 111.195, [lejos]).item, lejos);
  assert.equal(masCercano(0, 0, [{ nombre: 'sin coordenadas', lat: null, lon: null }]), null);
});

test('partly compared sentence and the lunar terrain that holds the point', () => {
  assert.equal(fraseParcial({ comparados: 5, de: 8 }), 'only 5 of 8 parameters have Earth data here');
  const T = [{ id: 'polo_sur', lat: -90, lon: 0, lado_km: 300 }, { id: 'shackleton_borde', lat: -89.68643, lon: -162.9371, lado_km: 10 }, { id: 'shoemaker', lat: -88.137, lon: 45.911, lado_km: 70 }];
  assert.equal(terrenoDelPunto(-89.68643, -162.9371, T, 1737.4), 'shackleton_borde');
  assert.equal(terrenoDelPunto(-88.137, 45.911, T, 1737.4), 'shoemaker');
  assert.equal(terrenoDelPunto(-88, -100, T, 1737.4), 'polo_sur');
  assert.equal(terrenoDelPunto(8.3355, 33.222, T, 1737.4), null);
});

test('similarity ramp: only brand colours at the stops, blends of neighbouring stops in between', () => {
  const marca = new Set(Object.values(PALETA).map((h) => h.toUpperCase()));
  for (const [, c] of RAMPA) assert.ok(marca.has(c.toUpperCase()), c);
  const hex = (c) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
  assert.equal(hex(colorRampa(0)), '#0042A6');
  assert.equal(hex(colorRampa(1)), '#EAFE07');
  assert.equal(hex(colorRampa(0.5)), '#2E96F5');
  assert.equal(hex(colorRampa(-3)), '#0042A6');
  assert.equal(hex(colorRampa(7)), '#EAFE07');
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  for (let t = 0; t <= 1; t += 0.01) {
    const k = RAMPA.findIndex(([s]) => t <= s);
    const [a, b] = [rgb(RAMPA[Math.max(0, k - 1)][1]), rgb(RAMPA[k][1])];
    const c = colorRampa(t);
    c.forEach((v, i) => assert.ok(v >= Math.min(a[i], b[i]) - 0.5 && v <= Math.max(a[i], b[i]) + 0.5, `t ${t} channel ${i}`));
  }
});

test('map painting: sea transparent, land not compared → deep blue, min → electric blue, max → neon yellow; min/max skip NaN', () => {
  const m = new Float32Array([NaN, 46.5, 81.7, 60]);
  assert.deepEqual(minMax(m), { min: 46.5, max: Float32Array.of(81.7)[0] });
  assert.equal(minMax(new Float32Array([NaN, NaN])), null);
  const px = pintarMapa(m, 46.5, Float32Array.of(81.7)[0], 200);
  assert.deepEqual([...px.slice(0, 4)], [0, 0, 0, 0]);
  assert.deepEqual([...px.slice(4, 8)], [0, 66, 166, 200]);
  const conTierra = pintarMapa(new Float32Array([NaN, NaN, 60]), 46.5, 81.7, 200, new Float32Array([1, 0.2, 1]));
  assert.deepEqual([...conTierra.slice(0, 4)], [7, 23, 63, 240]);
  assert.deepEqual([...conTierra.slice(4, 8)], [0, 0, 0, 0]);
  assert.deepEqual([...px.slice(8, 12)], [234, 254, 7, 200]);
});

// Formato elegido: como mucho 4 decimales (≈ 11 m), sin ceros de cola ni ruido de coma flotante; −0 sale «0».
test('NASA Worldview link: ±2° box lonMin,latMin,lonMax,latMax, clipped to ±180/±90, at most 4 decimals', async () => {
  const { enlaceWorldview: enlace, CAPAS_WORLDVIEW } = await import('../analogos/metricas.js');
  const W = 'https://worldview.earthdata.nasa.gov/?v=';
  const L = `&l=${CAPAS_WORLDVIEW}`;
  assert.equal(CAPAS_WORLDVIEW, 'Reference_Labels_15m,Coastlines_15m,BlueMarble_NextGeneration');
  const enlaceWorldview = (la, lo) => { const u = enlace(la, lo); if (u === null) return null; assert.ok(u.endsWith(L), u); return u.slice(0, -L.length); };
  assert.equal(enlaceWorldview(18.38, 77.58), `${W}75.58,16.38,79.58,20.38`);
  assert.equal(enlaceWorldview(1.1, 4.35), `${W}2.35,-0.9,6.35,3.1`);
  assert.equal(enlaceWorldview(-4.35, 0), `${W}-2,-6.35,2,-2.35`);
  assert.equal(enlaceWorldview(0.123456, 10.987654), `${W}8.9877,-1.8765,12.9877,2.1235`);
  assert.equal(enlaceWorldview(0, -2.00001), `${W}-4,-2,0,2`);
  assert.equal(enlaceWorldview(-89.68643, -162.9371), `${W}-164.9371,-90,-160.9371,-87.6864`);
  assert.equal(enlaceWorldview(89, 10), `${W}8,87,12,90`);
  assert.equal(enlaceWorldview(0, 179.5), `${W}177.5,-2,180,2`);
  assert.equal(enlaceWorldview(0, -179), `${W}-180,-2,-177,2`);
  for (const [la, lo] of [[NaN, 0], [0, NaN], [Infinity, 0], [0, -Infinity], [null, 0], [0, undefined], ['10', 0]]) assert.equal(enlaceWorldview(la, lo), null, `${la},${lo}`);
  for (const [la, lo] of [[18.38, 77.58], [-89.68643, -162.9371], [89.9, -179.9], [-33.33, 151.2]]) {
    const u = new URL(enlace(la, lo));
    assert.equal(u.searchParams.get('l'), CAPAS_WORLDVIEW);
    assert.deepEqual([...u.searchParams.keys()], ['v', 'l']);
    assert.equal(u.protocol, 'https:');
    assert.equal(u.host, 'worldview.earthdata.nasa.gov');
    const v = u.searchParams.get('v').split(',').map(Number);
    assert.equal(v.length, 4);
    assert.ok(v.every(Number.isFinite));
    const [lonMin, latMin, lonMax, latMax] = v;
    assert.ok(lonMin < lo && lo < lonMax && latMin < la && la < latMax, `${la},${lo} inside ${v}`);
    assert.ok(lonMin >= -180 && lonMax <= 180 && latMin >= -90 && latMax <= 90, String(v));
  }
});

test('superscripts split into parts for <sup>, and the plain text the screen shows', async () => {
  const { partesSup, planoSup } = await import('../analogos/metricas.js');
  assert.deepEqual(partesSup('3 × 10⁻¹⁰ Pa'), [{ t: '3 × 10' }, { sup: '−10' }, { t: ' Pa' }]);
  assert.deepEqual(partesSup('3.73 m/s²'), [{ t: '3.73 m/s' }, { sup: '2' }]);
  assert.deepEqual(partesSup('789 Pa'), [{ t: '789 Pa' }]);
  assert.equal(planoSup('4.09 kWh/m² per day'), '4.09 kWh/m2 per day');
  assert.deepEqual(partesSup(''), []);
});
