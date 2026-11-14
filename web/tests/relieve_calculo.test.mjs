import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ORIGENES_EXTERNOS, URL_TERRARIUM, URL_GIBS, MENSAJES, N_REJILLA,
  pixelMercator, teselaDe, zoomPara, decodificarTerrarium, rejillaLocal, aLocal, bilineal, remuestrear,
  teselasVentana, muestraMercator, muestraEquirect, filasEquirect, leerI16, sombreado, colorear,
  estadisticas, exageracionDefecto, fuenteRelieve, barraEscala, urlTesela, contornoCelda, muestraPolo, filasPolo, formatoMetros, bicubico,
} from '../relieve/calculo.js';

const cerca = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} vs ${b}`);
const R_TIERRA = 6371008.8;

function distancia(R, lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const a = Math.sin((lat2 - lat1) * r / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin((lon2 - lon1) * r / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

test('only two outside origins, and the tile URLs use them', () => {
  assert.deepEqual(ORIGENES_EXTERNOS, ['https://elevation-tiles-prod.s3.amazonaws.com', 'https://gibs.earthdata.nasa.gov']);
  assert.ok(URL_TERRARIUM.startsWith(ORIGENES_EXTERNOS[0]));
  assert.ok(URL_GIBS.startsWith(ORIGENES_EXTERNOS[1]));
  assert.equal(urlTesela(URL_TERRARIUM, 9, 384, 197), 'https://elevation-tiles-prod.s3.amazonaws.com/terrarium/9/384/197.png');
  // GIBS WMTS: {TileMatrix}/{TileRow}/{TileCol} = z/y/x
  assert.match(urlTesela(URL_GIBS, 8, 192, 98), /GoogleMapsCompatible_Level8\/8\/98\/192\.jpeg$/);
});

test('Web Mercator pixel: known cases worked out by hand', () => {
  assert.deepEqual(pixelMercator(0, 0, 0), { x: 128, y: 128 });
  const a = pixelMercator(0, -180, 1);
  cerca(a.x, 0, 1e-9); cerca(a.y, 256, 1e-9);
  const b = pixelMercator(85.0511287798066, 180, 3);
  cerca(b.x, 2048, 1e-9); cerca(b.y, 0, 1e-6);
  // y(45°) = 128·(1 − ln(tan 45° + sec 45°)/π) = 128·(1 − 0.8813736/π)
  cerca(pixelMercator(45, 0, 0).y, 128 * (1 - 0.881373587019543 / Math.PI), 1e-9);
  cerca(pixelMercator(-45, 0, 0).y, 256 - 128 * (1 - 0.881373587019543 / Math.PI), 1e-9);
  assert.deepEqual(teselaDe(38.25, 90.25, 9), { x: 384, y: 197 });
  assert.deepEqual(teselaDe(38.25, 90.25, 8), { x: 192, y: 98 });
});

test('zoom: the coarsest level whose pixel is no bigger than the grid step', () => {
  assert.equal(zoomPara(0, 390, 15), 9); // 156543·cos0/2⁹ = 305.7 m
  assert.equal(zoomPara(60, 390, 15), 8); // 156543·0.5/2⁸ = 305.7 m
  assert.equal(zoomPara(0, 100, 15), 11); // 76.4 m
  assert.equal(zoomPara(0, 390, 8), 8);
  assert.equal(zoomPara(0, 1, 15), 15);
});

test('Terrarium decoding: metres = R·256 + G + B/256 − 32768', () => {
  const rgba = new Uint8ClampedArray([128, 0, 0, 255, 0, 0, 0, 255, 128, 100, 128, 255, 255, 255, 255, 255]);
  assert.deepEqual([...decodificarTerrarium(rgba)], [0, -32768, 100.5, 32767.99609375]);
});

test('local grid: centre node is the point, edges are half a side away, step is even', () => {
  const n = 5, lado = 150000;
  const g = rejillaLocal(38.25, 90.25, lado, n, R_TIERRA);
  const c = 2 * n + 2;
  cerca(g.lat[c], 38.25, 1e-12); cerca(g.lon[c], 90.25, 1e-12);
  cerca(distancia(R_TIERRA, 38.25, 90.25, g.lat[2], g.lon[2]), lado / 2, 1e-3, 'north edge');
  assert.ok(g.lat[2] > 38.25 && g.lat[22] < 38.25, 'row 0 = north');
  assert.ok(g.lon[c + 1] > 90.25, 'columns go east');
  cerca(distancia(R_TIERRA, g.lat[c], g.lon[c], g.lat[c + 1], g.lon[c + 1]), lado / (n - 1), 1e-3);
  const p = aLocal(38.25, 90.25, g.lat[c + 1], g.lon[c + 1], R_TIERRA);
  cerca(p.x, lado / (n - 1), 1e-6); cerca(p.y, 0, 1e-6);
});

test('local grid across the antimeridian keeps longitudes in −180…180', () => {
  const g = rejillaLocal(-16, 179.9, 150000, 9, R_TIERRA);
  assert.ok([...g.lon].every((l) => l >= -180 && l <= 180));
  assert.ok(g.lon[8] < -179 && g.lon[0] > 179);
});

test('bilinear on pixel centres, with wrap in x', () => {
  const d = new Float32Array([0, 10, 20, 30, 100, 110, 120, 130]);
  assert.equal(bilineal(d, 4, 2, 0, 0), 0);
  assert.equal(bilineal(d, 4, 2, 1.5, 0.5), 65);
  assert.equal(bilineal(d, 4, 2, 3.5, 0, true), 15);
  assert.ok(Number.isNaN(bilineal(d, 4, 2, 3.5, 0, false)));
  assert.ok(Number.isNaN(bilineal(d, 4, 2, 1, 1.5)));
});

// Teselas sintéticas con un plano inclinado definido en metros locales, codificado en Terrarium.
function teselasPlano(lat0, lon0, z, ax, ay, c0) {
  const vent = teselasVentana(rejillaLocal(lat0, lon0, 150000, 33, R_TIERRA), z);
  const teselas = new Map();
  for (const t of vent.lista) {
    const rgba = new Uint8ClampedArray(256 * 256 * 4);
    for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) {
      const X = (t.x * 256 + i + 0.5) / (256 * 2 ** z), Y = (t.y * 256 + j + 0.5) / (256 * 2 ** z);
      const lon = X * 360 - 180, lat = (Math.atan(Math.sinh(Math.PI * (1 - 2 * Y))) * 180) / Math.PI;
      const p = aLocal(lat0, lon0, lat, lon, R_TIERRA);
      const h = c0 + ax * p.x + ay * p.y + 32768, k = (j * 256 + i) * 4;
      rgba[k] = Math.floor(h / 256); rgba[k + 1] = Math.floor(h % 256); rgba[k + 2] = Math.round((h % 1) * 256); rgba[k + 3] = 255;
    }
    teselas.set(`${t.x}/${t.y}`, decodificarTerrarium(rgba));
  }
  return { vent, teselas };
}

test('resampling Terrarium tiles to the local grid recovers a tilted plane', () => {
  const lat0 = 38.25, lon0 = 90.25, z = 9, n = 65, lado = 150000;
  const { vent, teselas } = teselasPlano(lat0, lon0, z, 0.01, -0.02, 3000);
  // a 38° la tesela z9 cubre ~61 km: 3-4 por eje
  assert.ok(vent.lista.length >= 9 && vent.lista.length <= 16, `${vent.lista.length} tiles`);
  const g = rejillaLocal(lat0, lon0, lado, n, R_TIERRA);
  const zz = remuestrear((la, lo) => muestraMercator(vent, teselas, z, la, lo), g);
  const paso = lado / (n - 1);
  let peor = 0;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const x = -lado / 2 + c * paso, y = lado / 2 - r * paso;
    peor = Math.max(peor, Math.abs(zz[r * n + c] - (3000 + 0.01 * x - 0.02 * y)));
  }
  assert.ok(peor < 2, `worst error ${peor} m`);
  cerca(estadisticas(zz, n).centro, 3000, 0.5);
});

test('tiles of a window across the antimeridian wrap in x', () => {
  const g = rejillaLocal(-16, 179.9, 150000, 17, R_TIERRA);
  const v = teselasVentana(g, 9);
  const xs = new Set(v.lista.map((t) => t.x));
  assert.ok(xs.has(511) && xs.has(0), [...xs].join(','));
});

test('int16 little-endian read with its scale factor', () => {
  const b = new Uint8Array([0x34, 0x12, 0xff, 0xff, 0x00, 0x80]).buffer;
  assert.deepEqual([...leerI16(b, 0.5)], [0x1234 * 0.5, -0.5, -16384]);
});

test('bicubic passes through the grid values and keeps slopes continuous', () => {
  const d = new Float32Array(49);
  d[3 * 7 + 3] = 10;
  assert.equal(bicubico(d, 7, 7, 3, 3), 10);
  assert.equal(bicubico(d, 7, 7, 2, 3), 0);
  // Bilineal daría +10 a un lado del pico y −10 al otro.
  const h = 1e-7, pend = (x) => (bicubico(d, 7, 7, x + h, 3) - bicubico(d, 7, 7, x - h, 3)) / (2 * h);
  cerca(pend(2 - 1e-5), pend(2 + 1e-5), 0.01, 'no kink at the foot');
  cerca(pend(3 - 1e-5), pend(3 + 1e-5), 0.01, 'no kink at the peak');
});

test('equirectangular sample: pixel centres, rows north→south, columns from −180°, wrap', () => {
  const ancho = 360, alto = 180, d = new Float32Array(ancho * alto);
  for (let f = 0; f < alto; f++) for (let c = 0; c < ancho; c++) d[f * ancho + c] = f * 1000 + c;
  const m = { ancho, alto, ppd: 1, fila0: 0, filas: alto, datos: d };
  assert.equal(muestraEquirect(m, 89.5, -179.5), 0);
  assert.equal(muestraEquirect(m, 0, 0), 89679.5);
  // Columnas periódicas suaves: la muestra junto al antimeridiano usa las columnas del otro lado.
  const per = new Float32Array(ancho * alto);
  for (let f = 0; f < alto; f++) for (let c = 0; c < ancho; c++) per[f * ancho + c] = 100 * Math.cos((2 * Math.PI * (c + 0.5)) / 360);
  cerca(muestraEquirect({ ...m, datos: per }, 50.5, 179.9), 100 * Math.cos((2 * Math.PI * 359.9) / 360), 1e-3, 'wraps to column 0');
  cerca(muestraEquirect({ ...m, datos: per }, 50.5, -179.9), 100 * Math.cos((2 * Math.PI * 0.1) / 360), 1e-3, 'wraps to column 359');
  const sinEnvolver = new Float32Array(ancho * alto);
  for (let f = 0; f < alto; f++) for (let c = 0; c < ancho; c++) sinEnvolver[f * ancho + c] = c === 359 ? 1000 : 0;
  assert.ok(muestraEquirect({ ...m, datos: sinEnvolver }, 50.5, -179.9) > 0, 'column 359 is a neighbour of column 0');
  const parte = { ...m, fila0: 80, filas: 20, datos: d.slice(80 * ancho, 100 * ancho) };
  cerca(muestraEquirect(m, 12.3, 45.6), (90 - 12.3 - 0.5) * 1000 + (45.6 + 180 - 0.5), 1e-6, 'bicubic keeps a linear field');
  assert.equal(muestraEquirect(parte, 0, 0), 89679.5);
  assert.ok(Number.isNaN(muestraEquirect(parte, 30, 0)), 'outside the rows read');
  const fl = filasEquirect(rejillaLocal(0, 0, 150000, 9, 1737400), 16, 2880);
  // 75 km en la Luna = 2,47° = 39,6 filas a 16 px/°
  assert.ok(fl.f0 <= 1440 - 40 && fl.f1 >= 1440 + 40 && fl.f1 - fl.f0 < 100, JSON.stringify(fl));
});

test('hillshade: flat ground gets sin(sun elevation); a slope facing the sun gets 1', () => {
  const n = 5, paso = 100;
  const plano = new Float32Array(n * n).fill(42);
  const s = sombreado(plano, n, paso, 1, 270, 20);
  cerca(s[12], Math.sin((20 * Math.PI) / 180), 1e-6);
  // Pendiente subiendo hacia el este con ángulo 90° − 20° y sol al oeste: la cara mira al sol.
  const t = Math.tan((70 * Math.PI) / 180);
  const cara = new Float32Array(n * n);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) cara[r * n + c] = c * paso * t;
  cerca(sombreado(cara, n, paso, 1, 270, 20)[12], 1, 1e-6);
  cerca(sombreado(cara, n, paso, 1, 270, 20)[10], 1, 1e-6, 'west edge');
  const opuesta = cara.map((v) => -v);
  cerca(sombreado(opuesta, n, paso, 1, 270, 20)[12], 0, 1e-6);
  // La exageración vertical empina la pendiente
  const suave = new Float32Array(n * n);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) suave[r * n + c] = c * 10;
  assert.ok(sombreado(suave, n, paso, 3, 270, 20)[12] > sombreado(suave, n, paso, 1, 270, 20)[12]);
});

test('colouring: tint × shade for Moon and Mars, imagery × light for Earth', () => {
  const sh = new Float32Array([1, 0.5, NaN]);
  const t = colorear(sh, null, [100, 80, 60]);
  assert.deepEqual([...t.slice(0, 4)], [100, 80, 60, 255]);
  assert.deepEqual([...t.slice(4, 8)], [50, 40, 30, 255]);
  assert.equal(t[11], 255);
  const img = new Uint8ClampedArray([200, 100, 50, 255, 200, 100, 50, 255, 200, 100, 50, 255]);
  const e = colorear(sh, img, null);
  assert.ok(e[0] >= 200 && e[4] < e[0], `${e[0]} ${e[4]}`);
});

test('figures read from the relief: value at the pin and range inside the window', () => {
  const n = 3, z = new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, NaN]);
  assert.deepEqual(estadisticas(z, n), { centro: 5, min: 1, max: 8, desnivel: 7 });
});

test('default vertical exaggeration: whole steps from ×1 to ×5 that make the window readable', () => {
  assert.equal(exageracionDefecto(1000, 150000), 5);
  assert.equal(exageracionDefecto(8000, 150000), 2);
  assert.equal(exageracionDefecto(30000, 150000), 1);
  assert.equal(exageracionDefecto(0, 150000), 5);
  assert.equal(exageracionDefecto(NaN, 150000), 3);
});

const POLO = { n: 2048, m_por_px: 146.484375, georef: { tipo: 'estereo_polar', polo: 'sur', radio_m: 1737400, x0_m: -149926.7578125, y0_m: 149926.7578125 } };

test('source by world and latitude, with the plain messages when there is no terrain', () => {
  assert.equal(fuenteRelieve('earth', 38.25, 90.25, 150000).tipo, 'terrarium');
  assert.equal(fuenteRelieve('earth', -84, 0, 150000).tipo, 'terrarium');
  assert.deepEqual(fuenteRelieve('earth', 84.2, 10, 150000), { tipo: null, mensaje: MENSAJES.sinTeselasPolo });
  assert.equal(MENSAJES.sinTeselasPolo, 'No terrain tiles this close to the pole.');
  assert.equal(fuenteRelieve('mars', 18.38, 77.58, 150000).tipo, 'equirect');
  assert.deepEqual(fuenteRelieve('mars', 86, 0, 150000), { tipo: null, mensaje: MENSAJES.sinRelievePolo });
  assert.deepEqual(fuenteRelieve('mars', -85.5, 0, 150000), { tipo: null, mensaje: MENSAJES.sinRelievePolo });
  assert.equal(MENSAJES.sinRelievePolo, 'No local terrain this close to the pole.');
  assert.deepEqual(fuenteRelieve('moon', 86, 0, 150000, POLO), { tipo: null, mensaje: MENSAJES.sinRelievePolo });
  assert.equal(fuenteRelieve('moon', 8.3355, 33.222, 150000, POLO).tipo, 'equirect');
  const s = fuenteRelieve('moon', -89.68643, -162.9371, 150000, POLO);
  assert.equal(s.tipo, 'polo_sur'); assert.equal(s.lado_m, 150000);
  const borde = fuenteRelieve('moon', -86, -162.9371, 150000, POLO);
  assert.equal(borde.tipo, 'polo_sur');
  assert.ok(borde.lado_m < 150000 && borde.lado_m > 50000, String(borde.lado_m));
  assert.deepEqual(fuenteRelieve('moon', -86, -162.9371, 150000, null), { tipo: null, mensaje: MENSAJES.sinRelievePolo });
  assert.equal(fuenteRelieve('venus', 0, 0, 150000).tipo, null);
  assert.equal(MENSAJES.sinRed, 'Terrain detail needs a connection — NASA GIBS imagery and open elevation tiles.');
});

test('scale bar: the longest round length that fits', () => {
  assert.deepEqual(barraEscala(10, 140), { km: 10, px: 100 });
  assert.deepEqual(barraEscala(0.5, 140), { km: 200, px: 100 });
  assert.deepEqual(barraEscala(300, 140), { km: 0.2, px: 60 });
});

test('0.5° cell outline is closed and centred on the cell', () => {
  const pts = contornoCelda(38.25, 90.25, 38.25, 90.25, R_TIERRA, 4);
  assert.equal(pts.length, 17);
  assert.deepEqual(pts[0], pts[16]);
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  cerca(Math.max(...ys), (0.25 * Math.PI / 180) * R_TIERRA, 50);
  cerca(Math.min(...ys), -(0.25 * Math.PI / 180) * R_TIERRA, 50);
  assert.ok(Math.max(...xs) > 21000 && Math.max(...xs) < 23000, String(Math.max(...xs)));
});

test('default grid has an odd size so the pin is a node', () => {
  assert.equal(N_REJILLA % 2, 1);
});

test('south polar crop sample: pixel from the polar georeference, rows read in part', () => {
  const d = new Float32Array(POLO.n * 4);
  const meta = POLO;
  for (let f = 0; f < 4; f++) for (let c = 0; c < POLO.n; c++) d[f * POLO.n + c] = c + 0.25 * f;
  // Píxel (fila 1024, col 1500): centro x = x0 + 1500·m, y = y0 − 1024·m
  const x = meta.georef.x0_m + 1500.5 * meta.m_por_px, y = meta.georef.y0_m - 1024.5 * meta.m_por_px;
  const rho = Math.hypot(x, y), c = 2 * Math.atan(rho / (2 * 1737400));
  const lat = -90 + (c * 180) / Math.PI, lon = (Math.atan2(x, y) * 180) / Math.PI;
  const m = { n: POLO.n, fila0: 1023, filas: 4, datos: d };
  cerca(muestraPolo(m, meta, lat, lon), 1500.5 + 0.25 * 1.5, 1e-6);
  const fl = filasPolo(rejillaLocal(-89.68643, -162.9371, 150000, 9, 1737400), meta);
  // la rejilla local va girada ~17° respecto al recorte: 1024 px × (cos 17° + sin 17°) ≈ 1280 filas
  assert.ok(fl.f1 - fl.f0 > 1024 && fl.f1 - fl.f0 < 1350 && fl.f0 >= 0 && fl.f1 <= POLO.n, JSON.stringify(fl));
});

test('metres on screen: rounded, thousands separator, true minus sign', () => {
  assert.equal(formatoMetros(3912.4), '3,912 m');
  assert.equal(formatoMetros(-2628), '−2,628 m');
  assert.equal(formatoMetros(-0.4), '0 m');
  assert.equal(formatoMetros(NaN), 'no data');
});
