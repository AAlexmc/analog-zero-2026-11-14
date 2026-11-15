import test from 'node:test';
import assert from 'node:assert/strict';
import { leerLugar, idLugar, ventanaLugar, pixelTesela, terrenoDeRelieve, textoMuestreo, fuentesDeTeselas, FUENTES_TERRARIUM, LADOS_KM, LADO_DEFECTO_KM, N_MAX, enlaceSimulacion, leerPunto, idPunto, terrenoDePunto, textoPunto, enlaceSimulacion as enlaceSim2, N_PUNTO, TEXTO_TONO } from '../terreno/lugar.js';
import { rejillaLocal, zoomPara, ZOOM_MAX_TERRARIUM, CREDITOS_TIERRA, R_TIERRA_M } from '../relieve/calculo.js';
import { centroPixel, pixelALatLon } from '../terreno/georef.js';
import { pendienteGrados, rango } from '../terreno/calculo.js';

const cerca = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} vs ${b}`);
const RAD = Math.PI / 180;

// Lo que devuelve cargarRelieve para la Tierra, con el relieve h(x, y) en metros locales (x este, y norte).
function relieveDe(lat, lon, n, paso, h, z = 13) {
  const g = rejillaLocal(lat, lon, (n - 1) * paso, n, R_TIERRA_M);
  const zz = new Float32Array(n * n);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) zz[r * n + c] = h(-g.lado / 2 + c * paso, g.lado / 2 - r * paso);
  return {
    mundo: 'earth', lat, lon, lado_m: g.lado, n, paso, R: R_TIERRA_M, fuente: 'terrarium', z: zz, imagen: new Uint8ClampedArray(n * n * 4), tono: null,
    descarga_bytes: 123456, teselas: { elevacion: { z, n: 36 }, imagen: { z: 8, n: 2 } },
    rotulos: { altura: 'Terrain Tiles (Mapzen), metres above sea level', imagen: 'NASA Blue Marble' }, creditos: CREDITOS_TIERRA,
  };
}

test('place in the URL: lat,lon, optional name and window; anything else is no place', () => {
  assert.deepEqual(leerLugar('?lugar=75.25,-84.25&nombre=Devon%20Island'), { lat: 75.25, lon: -84.25, nombre: 'Devon Island', lado_km: 10 });
  assert.deepEqual(leerLugar('?lugar=-24.0883,-69.9946&lado=2'), { lat: -24.0883, lon: -69.9946, nombre: null, lado_km: 2 });
  assert.equal(leerLugar('?lugar=-24,-69&lado=40').lado_km, 40);
  assert.equal(leerLugar('?lugar=10,20&lado=abc').lado_km, LADO_DEFECTO_KM);
  assert.equal(leerLugar('?lugar=10,20&lado=0').lado_km, LADO_DEFECTO_KM);
  assert.equal(leerLugar('?lugar=10,20&lado=500').lado_km, LADO_DEFECTO_KM);
  assert.equal(leerLugar('?lugar=10,20&nombre=%20%20').nombre, null);
  for (const mal of ['', '?a=haughton', '?lugar=', '?lugar=10', '?lugar=91,0', '?lugar=0,181', '?lugar=a,b', '?lugar=1,2,3', '?lugar=%20,%20']) assert.equal(leerLugar(mal), null, mal);
  assert.deepEqual(LADOS_KM, [2, 10, 40]);
  assert.equal(LADO_DEFECTO_KM, 10);
});

test('place id is stable, has no characters that break a URL and changes with the window', () => {
  const a = idLugar({ lat: 75.25, lon: -84.25, lado_km: 10 });
  assert.equal(a, idLugar({ lat: 75.25000001, lon: -84.25, lado_km: 10 }));
  assert.notEqual(a, idLugar({ lat: 75.25, lon: -84.25, lado_km: 2 }));
  assert.equal(encodeURIComponent(a), a);
});

test('tile pixel size: Web Mercator ground size at the latitude', () => {
  cerca(pixelTesela(0, 0), 2 * Math.PI * 6378137 / 256, 1e-6);
  cerca(pixelTesela(60, 15), (2 * Math.PI * 6378137 * 0.5) / 256 / 2 ** 15, 1e-9);
});

test('window: odd grid, side kept exactly, sampling never finer than the tiles at the zoom used', () => {
  for (const lat of [0, -24.0883, 45, 75.25, 83.9]) {
    for (const lado of [2, 10, 40]) {
      const v = ventanaLugar(lat, lado);
      assert.equal(v.n % 2, 1, `n odd ${lat} ${lado}`);
      assert.ok(v.n <= N_MAX && v.n >= 3);
      cerca(v.n * v.m_por_px, lado * 1000, 1e-6, 'n·m = side');
      cerca(v.lado_pedido_km * 1000, (v.n - 1) * v.m_por_px, 1e-6, 'node-to-node side for cargarRelieve');
      assert.equal(v.zoom, zoomPara(lat, v.m_por_px, ZOOM_MAX_TERRARIUM), 'same zoom cargarRelieve will pick');
      assert.ok(v.pixel_tesela_m <= v.m_por_px + 1e-9, `tile pixel ${v.pixel_tesela_m} ≤ sampling ${v.m_por_px}`);
      cerca(v.pixel_tesela_m, pixelTesela(lat, v.zoom), 1e-9);
    }
  }
  // 2 km en el ecuador: el zoom máximo da ~4,8 m; la rejilla no baja de ahí.
  const ec = ventanaLugar(0, 2);
  assert.equal(ec.zoom, 15);
  assert.ok(ec.m_por_px >= pixelTesela(0, 15));
  assert.ok(ec.n < N_MAX);
  // 10 km a 75,25° N: tope de la rejilla, ~9,8 m.
  const dv = ventanaLugar(75.25, 10);
  assert.equal(dv.n, N_MAX);
  cerca(dv.m_por_px, 10000 / N_MAX, 1e-9);
});

test('adapter: same shape as a catalogue terrain, local_aeqd georef, real source and credits, dynamic', () => {
  const n = 101, paso = 10;
  const t = terrenoDeRelieve(relieveDe(75.25, -84.25, n, paso, () => 50), { lat: 75.25, lon: -84.25, nombre: 'Devon Island' });
  const m = t.meta;
  assert.equal(m.cuerpo, 'tierra');
  assert.equal(m.dinamico, true);
  assert.equal(m.nombre, 'Devon Island');
  assert.deepEqual(m.centro, { lat: 75.25, lon: -84.25 });
  assert.equal(m.n, n);
  assert.equal(m.m_por_px, paso);
  assert.equal(m.lado_km, 1.01);
  assert.equal(m.georef.tipo, 'local_aeqd');
  assert.equal(m.georef.radio_m, R_TIERRA_M);
  assert.equal(m.z_min, 50);
  assert.equal(m.z_max, 50);
  assert.equal(m.capas.altura.tipo, 'float32');
  assert.equal(m.capas.altura.unidad, 'm');
  assert.equal(m.capas.altura.fuente, 'Terrain Tiles (Mapzen, hosted on AWS Open Data)');
  assert.equal(m.capas.altura.url, 'https://registry.opendata.aws/terrain-tiles');
  assert.equal(m.capas.altura.resolucion_origen_m, null);
  assert.equal(Object.keys(m.capas).join(), 'altura', 'no pipeline layers');
  assert.ok(m.creditos.every((c) => CREDITOS_TIERRA.includes(c)) && m.creditos.some((c) => /^Elevation:/.test(c)));
  assert.equal(m.muestreo.m, paso);
  assert.equal(m.muestreo.zoom, 13);
  cerca(m.muestreo.pixel_tesela_m, pixelTesela(75.25, 13), 1e-9);
  assert.equal(m.muestreo.teselas, 36);
  assert.equal(m.muestreo.descarga_bytes, 123456);
  assert.ok(t.altura instanceof Float32Array && t.altura.length === n * n);
  assert.equal(t.bytesAltura.length, n * n * 4);
  assert.deepEqual(t.capas, {});
  assert.ok(Array.isArray(t.notas));
  assert.equal(m.id, idLugar({ lat: 75.25, lon: -84.25, lado_km: m.lado_km }));
  // Sin nombre: las coordenadas.
  const s = terrenoDeRelieve(relieveDe(-24.0883, -69.9946, 11, 5, () => 1), { lat: -24.0883, lon: -69.9946, nombre: null });
  assert.match(s.meta.nombre, /24\.09° S.*69\.99° W/);
});

test('adapter keeps the GIBS image on the same nodes, with its credit and a plain note on its resolution', () => {
  const n = 11, r = relieveDe(75.25, -84.25, n, 10, () => 50);
  r.imagen = new Uint8ClampedArray(n * n * 4).map((_, i) => i % 251);
  const t = terrenoDeRelieve(r, { lat: 75.25, lon: -84.25, nombre: null });
  assert.equal(t.imagen.length, n * n * 4);
  assert.deepEqual([...t.imagen], [...r.imagen]);
  assert.notEqual(t.imagen, r.imagen, 'a copy, not the loader buffer');
  assert.equal(t.meta.imagen.texto, 'Image: NASA Blue Marble (GIBS), low resolution: colours are real, detail is not');
  assert.equal(t.meta.imagen.zoom, 8);
  assert.ok(t.meta.creditos.some((c) => /^Imagery: NASA GIBS, Blue Marble/.test(c)));
  assert.ok(t.meta.creditos.every((c) => CREDITOS_TIERRA.includes(c)));
  assert.equal(Object.keys(t.meta.capas).join(), 'altura', 'the image is not a layer');
  // Sin imagen (p. ej. un relieve sin ella): nada de imagen ni su crédito.
  const s = terrenoDeRelieve({ ...r, imagen: null }, { lat: 75.25, lon: -84.25, nombre: null });
  assert.equal(s.imagen, null);
  assert.equal(s.meta.imagen, null);
  assert.ok(!s.meta.creditos.some((c) => /^Imagery:/.test(c)));
});

test('adapter: row 0 is north, column 0 is west, the centre pixel is the place', () => {
  const n = 101, paso = 20, lat = 75.25, lon = -84.25;
  const r = relieveDe(lat, lon, n, paso, (x, y) => 100 + 0.1 * y);
  const t = terrenoDeRelieve(r, { lat, lon, nombre: 'x' });
  const k = (n - 1) / 2;
  assert.ok(t.altura[0] > t.altura[(n - 1) * n], 'north row is higher (h rises to the north)');
  cerca(t.altura[k * n + k], 100, 1e-3, 'centre');
  const c = centroPixel(t.meta, k, k);
  cerca(c.x, 0, 1e-9); cerca(c.y, 0, 1e-9);
  const no = pixelALatLon(t.meta, 0, 0), se = pixelALatLon(t.meta, n - 1, n - 1);
  assert.ok(no.lat > lat && no.lon < lon, 'pixel (0,0) is north-west');
  assert.ok(se.lat < lat && se.lon > lon, 'last pixel is south-east');
  // Mismos lat/lon que los nodos que muestreó cargarRelieve.
  const g = rejillaLocal(lat, lon, r.lado_m, n, R_TIERRA_M);
  for (const [f, cc] of [[0, 0], [7, 93], [k, k], [n - 1, 3]]) {
    const q = pixelALatLon(t.meta, f, cc);
    cerca(q.lat, g.lat[f * n + cc], 1e-9, 'lat'); cerca(q.lon, g.lon[f * n + cc], 1e-9, 'lon');
  }
});

test('adapter: a ramp in the north-east quarter shows its slope there and nowhere else', () => {
  const n = 81, paso = 10, lat = -24.0883, lon = -69.9946;
  const t = terrenoDeRelieve(relieveDe(lat, lon, n, paso, (x, y) => (x > 0 && y > 0 ? 0.2 * x : 0)), { lat, lon, nombre: 'ramp' });
  const esperado = Math.atan(0.2) / RAD;
  const ne = { f: 10, c: 70 }, so = { f: 70, c: 10 };
  cerca(pendienteGrados(t.altura, n, t.meta.m_por_px, ne.f, ne.c), esperado, 1e-3, 'north-east');
  cerca(pendienteGrados(t.altura, n, t.meta.m_por_px, so.f, so.c), 0, 1e-9, 'south-west');
  const q = pixelALatLon(t.meta, ne.f, ne.c);
  assert.ok(q.lat > lat && q.lon > lon, 'ramp cell is north-east of the place');
  const r = rango(t.altura);
  assert.equal(t.meta.z_min, r.min); assert.equal(t.meta.z_max, r.max);
});

test('adapter: cells outside the tiles stay NaN and z_min/z_max ignore them', () => {
  const r = relieveDe(10, 10, 11, 5, () => 7);
  r.z[0] = NaN; r.z[5] = -3;
  const t = terrenoDeRelieve(r, { lat: 10, lon: 10, nombre: 'x' });
  assert.ok(Number.isNaN(t.altura[0]));
  assert.equal(t.meta.z_min, -3); assert.equal(t.meta.z_max, 7);
});

test('source table: only prefixes seen on real tiles, each with its documented resolution and origin', () => {
  assert.deepEqual(FUENTES_TERRARIUM.map((f) => [f.prefijo, f.m]), [['pgdc_5m/', 5], ['ned13/', 10], ['srtm/', 30]]);
  for (const f of FUENTES_TERRARIUM) {
    assert.match(f.url, /^https:\/\/github\.com\/tilezen\/joerd\//);
    assert.ok(f.cita.length > 20 && f.origen);
  }
  assert.deepEqual(fuentesDeTeselas(['srtm/S25W071.tif, srtm/S25W070.tif', 'srtm/S25W070.tif']), { fuentes: [FUENTES_TERRARIUM[2]], sin_dato: 0 });
  const mix = fuentesDeTeselas(['pgdc_5m/29_29_2_2_5m_v2.0.tif', 'srtm/N59W100.tif', '', 'gmted/xyz.tif']);
  assert.deepEqual(mix.fuentes.map((f) => f.nombre), ['ArcticDEM', 'SRTM']);
  assert.equal(mix.sin_dato, 2, 'missing header and unknown prefix are not guessed');
  assert.deepEqual(fuentesDeTeselas(undefined), { fuentes: [], sin_dato: 0 });
});

test('sampling label states the real spacing, the source resolution from the tiles and what is not in the data', () => {
  const v = ventanaLugar(75.25, 10);
  const base = (origenes) => {
    const r = relieveDe(75.25, -84.25, 11, v.m_por_px, () => 1, v.zoom);
    r.teselas.elevacion.origenes = origenes;
    return terrenoDeRelieve(r, { lat: 75.25, lon: -84.25, nombre: 'x' }).meta;
  };
  const sin = textoMuestreo(base(undefined));
  assert.match(sin, /sampled every 9\.8 m/i);
  assert.match(sin, /source resolution not stated/i);
  assert.match(sin, /smaller than 9\.8 m is not in the data/i);
  const srtm = base(['srtm/S25W070.tif', 'srtm/S25W071.tif']);
  assert.equal(srtm.capas.altura.resolucion_origen_m, 30);
  assert.match(textoMuestreo(srtm), /source: SRTM, about 30 m/i);
  assert.match(textoMuestreo(srtm), /smaller than about 30 m is not in the data/i);
  assert.doesNotMatch(textoMuestreo(srtm), /not stated/);
  const artico = base(['pgdc_5m/29_29_2_2_5m_v2.0.tif']);
  assert.match(textoMuestreo(artico), /source: ArcticDEM, about 5 m/i);
  assert.match(textoMuestreo(artico), /smaller than 9\.8 m is not in the data/i, 'the grid is coarser than the source here');
  const mezcla = base(['pgdc_5m/a.tif', 'srtm/b.tif']);
  assert.match(textoMuestreo(mezcla), /sources: ArcticDEM about 5 m, SRTM about 30 m/i);
  assert.equal(mezcla.capas.altura.resolucion_origen_m, null, 'mixed: no single number');
  const parcial = base(['srtm/b.tif', '']);
  assert.match(textoMuestreo(parcial), /some tiles do not state their source/i);
  assert.equal(parcial.capas.altura.resolucion_origen_m, null);
  const dos = textoMuestreo({ ...srtm, muestreo: { ...srtm.muestreo, m: 4.8123 } });
  assert.match(dos, /sampled every 4\.8 m/i);
});

test('simulation link: the Earth place goes with the lunar terrain of the target, or alone when there is none', () => {
  const con = enlaceSimulacion({ lat: 75.25, lon: -84.25, nombre: 'Place 2 · 75.25° N, 84.25° W', lunar: 'shackleton_borde' });
  assert.ok(con.startsWith('terreno/index.html?'));
  const q = new URLSearchParams(con.split('?')[1]);
  assert.equal(q.get('lugar'), '75.2500,-84.2500');
  assert.equal(q.get('b'), 'shackleton_borde');
  assert.equal(q.get('solo'), null);
  assert.equal(q.get('vista'), 'suelo');
  assert.deepEqual(leerLugar(`?${con.split('?')[1]}`), { lat: 75.25, lon: -84.25, nombre: 'Place 2 · 75.25° N, 84.25° W', lado_km: 10 });
  const sin = new URLSearchParams(enlaceSimulacion({ lat: -24.0883, lon: -69.9946 }).split('?')[1]);
  assert.equal(sin.get('solo'), 'lugar');
  assert.equal(sin.get('b'), null);
  assert.equal(sin.get('nombre'), null);
});

test('place window: a side under 1 km in the URL falls back to the default, so the grid is never finer than a tile pixel', () => {
  assert.equal(leerLugar('?lugar=75.25,-84.25&lado=0.01').lado_km, LADO_DEFECTO_KM);
  assert.equal(leerLugar('?lugar=75.25,-84.25&lado=1').lado_km, 1);
  assert.equal(leerLugar('?lugar=75.25,-84.25&lado=2').lado_km, 2);
});

test('point on the Moon or Mars in the URL: world and lat,lon; anything else is no point', () => {
  assert.deepEqual(leerPunto('?punto=18.44,77.45&mundo=mars'), { mundo: 'mars', lat: 18.44, lon: 77.45, lado_km: 10 });
  assert.deepEqual(leerPunto('?punto=-45,10&mundo=moon', 40), { mundo: 'moon', lat: -45, lon: 10, lado_km: 40 });
  for (const mal of ['', '?punto=1,2', '?punto=1,2&mundo=earth', '?punto=1,2&mundo=venus', '?punto=91,0&mundo=mars', '?punto=0,181&mundo=mars', '?punto=a,b&mundo=mars', '?punto=1&mundo=mars', '?mundo=mars']) assert.equal(leerPunto(mal), null, mal);
  const id = idPunto({ mundo: 'mars', lat: 18.44, lon: 77.45, lado_km: 10 });
  assert.equal(encodeURIComponent(id), id);
  assert.notEqual(id, idPunto({ mundo: 'moon', lat: 18.44, lon: 77.45, lado_km: 10 }));
});

test('simulation link: catalogue Moon terrain first, else the point itself, else the place alone', () => {
  const q = (u) => new URLSearchParams(u.split('?')[1]);
  const conLunar = q(enlaceSim2({ lat: 1, lon: 2, lunar: 'shackleton', punto: { mundo: 'moon', lat: -89, lon: 3 } }));
  assert.equal(conLunar.get('b'), 'shackleton');
  assert.equal(conLunar.get('punto'), null);
  const marte = q(enlaceSim2({ lat: 1, lon: 2, punto: { mundo: 'mars', lat: 18.44, lon: 77.45 } }));
  assert.deepEqual([marte.get('punto'), marte.get('mundo'), marte.get('solo'), marte.get('vista')], ['18.4400,77.4500', 'mars', null, 'suelo']);
  assert.deepEqual(leerPunto(`?${marte}`), { mundo: 'mars', lat: 18.44, lon: 77.45, lado_km: 10 });
  for (const sin of [{}, { punto: { mundo: 'venus', lat: 1, lon: 2 } }, { punto: { mundo: 'mars', lat: NaN, lon: 2 } }]) assert.equal(q(enlaceSim2({ lat: 1, lon: 2, ...sin })).get('solo'), 'lugar');
});

test('terrain of the point: body, georef, source resolution, one tint for the ground, nothing invented', () => {
  const n = 5, z = Float32Array.from({ length: n * n }, (_, i) => -2500 + i);
  const relieve = { n, paso: 2500, R: 3396000, z, tono: [182, 126, 84], creditos: ['Elevation: MGS MOLA MEGDR 16 px/deg (NASA PDS Geosciences Node), https://pds-geosciences.wustl.edu/x.img', 'Tint: average colour of mars.jpg'], rotulos: { altura: 'MGS MOLA MEGDR 16 px/deg, metres above the Mars areoid' } };
  const t = terrenoDePunto(relieve, { mundo: 'mars', lat: 18.44, lon: 77.45, lado_km: 10 }, 3705);
  assert.equal(t.meta.cuerpo, 'marte');
  assert.equal(t.meta.georef.tipo, 'local_aeqd');
  assert.equal(t.meta.georef.radio_m, 3396000);
  assert.deepEqual([t.meta.georef.x0_m, t.meta.georef.y0_m], [-5000, 5000]);
  assert.equal(t.meta.z_referencia, 'metres above the Mars areoid');
  assert.equal(t.meta.capas.altura.url, 'https://pds-geosciences.wustl.edu/x.img');
  assert.equal(t.meta.capas.altura.resolucion_origen_m, 3705);
  assert.match(t.meta.nombre, /Your point on Mars · 18\.44° N, 77\.45° E/);
  assert.equal(t.meta.dinamico, undefined);
  assert.deepEqual([...t.imagen.subarray(0, 8)], [182, 126, 84, 255, 182, 126, 84, 255]);
  assert.equal(t.meta.imagen.texto, TEXTO_TONO);
  assert.deepEqual(Object.keys(t.capas), []);
  assert.match(textoPunto(t.meta), /one value every 3\.7 km, smoothed onto a 2\.5 km grid\. Anything smaller than 3\.7 km is not in the data/);
  const luna = terrenoDePunto({ ...relieve, tono: null, R: 1737400 }, { mundo: 'moon', lat: -45, lon: 10, lado_km: 10 }, null);
  assert.equal(luna.meta.cuerpo, 'luna');
  assert.equal(luna.imagen, null);
  assert.equal(luna.meta.imagen, null);
  assert.match(luna.meta.nombre, /Your point on the Moon/);
  assert.match(textoPunto(luna.meta), /Detail finer than the source map is not in the data/);
  assert.equal(N_PUNTO % 2, 1);
});
