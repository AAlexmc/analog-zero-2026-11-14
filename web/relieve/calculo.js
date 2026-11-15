// Relieve local alrededor de un punto: teselas Web Mercator (Tierra), DEM equirrectangular (Luna, Marte) y recorte
// polar (polo sur lunar) remuestreados a una rejilla métrica local; sombreado y cifras. Sin DOM.
import { latLonAPixel, latLonAXY } from '../terreno/georef.js';

// Única parte de la web que pide datos a otros servidores (excepción escrita en CLAUDE.md): solo estos dos orígenes.
export const ORIGENES_EXTERNOS = ['https://elevation-tiles-prod.s3.amazonaws.com', 'https://gibs.earthdata.nasa.gov'];
export const URL_TERRARIUM = `${ORIGENES_EXTERNOS[0]}/terrarium/{z}/{x}/{y}.png`;
export const ZOOM_MAX_TERRARIUM = 15;
// Blue Marble Next Generation: mosaico sin nubes y sin relieve sombreado; la capa no tiene dimensión de tiempo.
export const CAPA_GIBS = 'BlueMarble_NextGeneration';
export const MATRIZ_GIBS = 'GoogleMapsCompatible_Level8';
export const ZOOM_MAX_GIBS = 8;
export const URL_GIBS = `${ORIGENES_EXTERNOS[1]}/wmts/epsg3857/best/${CAPA_GIBS}/default/${MATRIZ_GIBS}/{z}/{y}/{x}.jpeg`;

export const CREDITOS_TIERRA = [
  "Imagery: NASA GIBS, Blue Marble Next Generation. We acknowledge the use of imagery provided by services from NASA's Global Imagery Browse Services (GIBS), part of NASA's Earth Science Data and Information System (ESDIS).",
  'Elevation: Terrain Tiles (Mapzen, hosted on AWS Open Data), https://registry.opendata.aws/terrain-tiles. Includes data courtesy of the U.S. Geological Survey (SRTM, GMTED2010, 3DEP), NOAA ETOPO1, and other providers listed at https://github.com/tilezen/joerd/blob/master/docs/attribution.md.',
];

export const MENSAJES = {
  sinRed: 'Terrain detail needs a connection — NASA GIBS imagery and open elevation tiles.',
  sinTeselasPolo: 'No terrain tiles this close to the pole.',
  sinRelievePolo: 'No local terrain this close to the pole.',
  sinDatos: 'Could not load the terrain data. Reload the page to try again.',
  teselaRota: 'An elevation tile for this place could not be read. Reload the page to try again.',
  sinMundo: 'No terrain for this world yet.',
};

export const N_REJILLA = 385;
export const LADO_KM = 150;
export const R_TIERRA_M = 6371008.8;
export const R_MERCATOR = 6378137;
const LAT_MERCATOR = 85.0511287798066;
const LAT_MAX_TESELAS = 84;
const LAT_MAX_EQUIRECT = 85;
const MEDIO_LADO_MIN_POLO = 25000;
const RAD = Math.PI / 180;

export const urlTesela = (plantilla, z, x, y) => plantilla.replace('{z}', z).replace('{x}', x).replace('{y}', y);

export function pixelMercator(lat, lon, z) {
  const t = 256 * 2 ** z, la = Math.max(-LAT_MERCATOR, Math.min(LAT_MERCATOR, lat)) * RAD;
  return { x: ((lon + 180) / 360) * t, y: (1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2 * t };
}

export function teselaDe(lat, lon, z) {
  const p = pixelMercator(lat, lon, z);
  return { x: Math.floor(p.x / 256), y: Math.floor(p.y / 256) };
}

// El nivel más grueso cuyo píxel (en el punto) no es mayor que el paso de la rejilla.
export function zoomPara(lat, paso_m, zmax) {
  const base = (2 * Math.PI * R_MERCATOR * Math.cos(lat * RAD)) / 256;
  for (let z = 0; z < zmax; z++) if (base / 2 ** z <= paso_m) return z;
  return zmax;
}

export function decodificarTerrarium(rgba) {
  const out = new Float32Array(rgba.length / 4);
  for (let i = 0; i < out.length; i++) out[i] = rgba[4 * i] * 256 + rgba[4 * i + 1] + rgba[4 * i + 2] / 256 - 32768;
  return out;
}

const normLon = (l) => { const v = ((l + 180) % 360 + 360) % 360 - 180; return v === -180 && l > 0 ? 180 : v; };

// Acimutal equidistante centrada en (lat0, lon0): x al este, y al norte, en metros.
export function aLocal(lat0, lon0, lat, lon, R) {
  const p1 = lat0 * RAD, p = lat * RAD, dl = (lon - lon0) * RAD;
  const cosc = Math.sin(p1) * Math.sin(p) + Math.cos(p1) * Math.cos(p) * Math.cos(dl);
  const c = Math.acos(Math.max(-1, Math.min(1, cosc)));
  const k = c === 0 ? 1 : c / Math.sin(c);
  return { x: R * k * Math.cos(p) * Math.sin(dl), y: R * k * (Math.cos(p1) * Math.sin(p) - Math.sin(p1) * Math.cos(p) * Math.cos(dl)) };
}

function deLocal(lat0, lon0, x, y, R) {
  const rho = Math.hypot(x, y);
  if (rho === 0) return { lat: lat0, lon: lon0 };
  const p1 = lat0 * RAD, c = rho / R;
  const lat = Math.asin(Math.cos(c) * Math.sin(p1) + (y * Math.sin(c) * Math.cos(p1)) / rho);
  const lon = lon0 * RAD + Math.atan2(x * Math.sin(c), rho * Math.cos(p1) * Math.cos(c) - y * Math.sin(p1) * Math.sin(c));
  return { lat: lat / RAD, lon: normLon(lon / RAD) };
}

// Rejilla n × n de lado lado_m; fila 0 = borde norte, columna 0 = borde oeste; el nodo central es el punto.
export function rejillaLocal(lat0, lon0, lado_m, n, R) {
  const paso = lado_m / (n - 1), lat = new Float64Array(n * n), lon = new Float64Array(n * n);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const q = deLocal(lat0, lon0, -lado_m / 2 + c * paso, lado_m / 2 - r * paso, R);
    lat[r * n + c] = q.lat; lon[r * n + c] = q.lon;
  }
  return { n, lado: lado_m, paso, lat, lon, lat0, lon0, R };
}

export function remuestrear(muestra, g) {
  const out = new Float32Array(g.n * g.n);
  for (let i = 0; i < out.length; i++) out[i] = muestra(g.lat[i], g.lon[i]);
  return out;
}

// Bilineal sobre centros de píxel (x = 0 es el centro del píxel 0); get(ix, iy) → valor o NaN.
function bilinealCon(get, x, y) {
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const a = get(x0, y0), b = fx ? get(x0 + 1, y0) : 0, c = fy ? get(x0, y0 + 1) : 0, d = fx && fy ? get(x0 + 1, y0 + 1) : 0;
  return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy;
}

const lector = (datos, ancho, alto, envolver) => (i, j) => {
  if (j < 0 || j >= alto) return NaN;
  if (envolver) i = ((i % ancho) + ancho) % ancho;
  else if (i < 0 || i >= ancho) return NaN;
  return datos[j * ancho + i];
};

export const bilineal = (datos, ancho, alto, x, y, envolver = false) => bilinealCon(lector(datos, ancho, alto, envolver), x, y);

// Catmull-Rom: pasa por los valores de la malla y da pendientes continuas (sin facetas al ampliar un DEM grueso).
const pesosCR = (t) => [(-t * t * t + 2 * t * t - t) / 2, (3 * t * t * t - 5 * t * t + 2) / 2, (-3 * t * t * t + 4 * t * t + t) / 2, (t * t * t - t * t) / 2];
export function bicubico(datos, ancho, alto, x, y, envolver = false) {
  const get = lector(datos, ancho, alto, envolver), x0 = Math.floor(x), y0 = Math.floor(y);
  const wx = pesosCR(x - x0), wy = pesosCR(y - y0);
  let s = 0;
  for (let j = 0; j < 4; j++) {
    if (!wy[j]) continue;
    let f = 0;
    for (let i = 0; i < 4; i++) if (wx[i]) f += wx[i] * get(x0 - 1 + i, y0 - 1 + j);
    s += wy[j] * f;
  }
  return s;
}

// Teselas que cubren la rejilla a nivel z; x envuelto en el antimeridiano, i/j = posición en el mosaico.
export function teselasVentana(g, z) {
  const mundo = 256 * 2 ** z, c = pixelMercator(g.lat0, g.lon0, z);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < g.lat.length; i++) {
    const p = pixelMercator(g.lat[i], g.lon[i], z);
    const x = p.x + Math.round((c.x - p.x) / mundo) * mundo;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
  }
  const n = 2 ** z;
  const tx0 = Math.floor((x0 - 1) / 256), tx1 = Math.floor((x1 + 1) / 256);
  const ty0 = Math.max(0, Math.floor((y0 - 1) / 256)), ty1 = Math.min(n - 1, Math.floor((y1 + 1) / 256));
  const lista = [];
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) lista.push({ x: ((tx % n) + n) % n, y: ty, i: tx - tx0, j: ty - ty0 });
  return { z, tx0, ty0, nx: tx1 - tx0 + 1, ny: ty1 - ty0 + 1, lista };
}

// teselas: Map `${x}/${y}` → Float32Array 256×256 (o RGBA con canal).
export function muestraMercator(v, teselas, z, lat, lon, canal = null) {
  const mundo = 256 * 2 ** z, n = 2 ** z, p = pixelMercator(lat, lon, z);
  let dx = p.x - v.tx0 * 256;
  dx -= Math.floor(dx / mundo) * mundo;
  const get = (i, j) => {
    const ti = Math.floor(i / 256), tj = Math.floor(j / 256);
    if (ti < 0 || tj < 0 || ti >= v.nx || tj >= v.ny) return NaN;
    const t = teselas.get(`${(((v.tx0 + ti) % n) + n) % n}/${v.ty0 + tj}`);
    if (!t) return NaN;
    const k = (j - tj * 256) * 256 + (i - ti * 256);
    return canal === null ? t[k] : t[4 * k + canal];
  };
  return bilinealCon(get, dx - 0.5, p.y - v.ty0 * 256 - 0.5);
}

// Bicúbica. m = { ancho, alto, ppd, fila0, filas, datos (metros) }; centros en lat = 90 − (f + 0,5)/ppd, lon = −180 + (c + 0,5)/ppd.
export function muestraEquirect(m, lat, lon) {
  const fy = (90 - lat) * m.ppd - 0.5 - m.fila0, fx = (lon + 180) * m.ppd - 0.5;
  return bicubico(m.datos, m.ancho, m.filas, fx, fy, true);
}

export function filasEquirect(g, ppd, alto) {
  let a = -90, b = 90;
  for (let i = 0; i < g.lat.length; i++) { a = Math.max(a, g.lat[i]); b = Math.min(b, g.lat[i]); }
  return { f0: Math.max(0, Math.floor((90 - a) * ppd - 0.5) - 2), f1: Math.min(alto, Math.ceil((90 - b) * ppd - 0.5) + 3) };
}

// Recorte polar (docs/contrato-terreno.md): m = { n, fila0, filas, datos }.
export function muestraPolo(m, meta, lat, lon) {
  const p = latLonAPixel(meta, lat, lon);
  return bilineal(m.datos, m.n, m.filas, p.col, p.fila - m.fila0, false);
}

export function filasPolo(g, meta) {
  let a = Infinity, b = -Infinity;
  for (let i = 0; i < g.lat.length; i++) { const f = latLonAPixel(meta, g.lat[i], g.lon[i]).fila; a = Math.min(a, f); b = Math.max(b, f); }
  return { f0: Math.max(0, Math.floor(a) - 1), f1: Math.min(meta.n, Math.ceil(b) + 2) };
}

export function leerI16(buffer, factor) {
  const dv = new DataView(buffer), out = new Float32Array(buffer.byteLength >> 1);
  for (let i = 0; i < out.length; i++) out[i] = dv.getInt16(2 * i, true) * factor;
  return out;
}

// Iluminación lambertiana 0…1 con el sol en (acimut desde el norte, elevación); filas de norte a sur.
export function sombreado(z, n, paso, exag, acimut, elevacion) {
  const az = acimut * RAD, el = elevacion * RAD;
  const sx = Math.sin(az) * Math.cos(el), sy = Math.cos(az) * Math.cos(el), sz = Math.sin(el);
  const out = new Float32Array(n * n);
  const v = (r, c) => z[Math.max(0, Math.min(n - 1, r)) * n + Math.max(0, Math.min(n - 1, c))];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const ce = Math.min(n - 1, c + 1), co = Math.max(0, c - 1), rn = Math.max(0, r - 1), rs = Math.min(n - 1, r + 1);
    const dzdx = (exag * (v(r, ce) - v(r, co))) / ((ce - co) * paso);
    const dzdy = (exag * (v(rn, c) - v(rs, c))) / ((rs - rn) * paso);
    const k = 1 / Math.hypot(dzdx, dzdy, 1);
    out[r * n + c] = Math.max(0, (-dzdx * sx - dzdy * sy + sz) * k);
  }
  return out;
}

// RGBA: imagen × luz (Tierra) o tono × luz (Luna, Marte); luz NaN = 1.
export function colorear(luz, imagen, tono) {
  const out = new Uint8ClampedArray(luz.length * 4);
  for (let i = 0; i < luz.length; i++) {
    const f = Number.isFinite(luz[i]) ? luz[i] : 1;
    for (let k = 0; k < 3; k++) out[4 * i + k] = (imagen ? imagen[4 * i + k] : tono[k]) * f;
    out[4 * i + 3] = 255;
  }
  return out;
}

export function estadisticas(z, n) {
  let min = Infinity, max = -Infinity;
  for (const v of z) if (Number.isFinite(v)) { min = Math.min(min, v); max = Math.max(max, v); }
  const c = z[((n - 1) / 2) * n + (n - 1) / 2];
  return { centro: Number.isFinite(c) ? c : NaN, min, max, desnivel: max - min };
}

// Criterio propio: que el desnivel de la ventana se vea como ~1/10 del lado, en pasos enteros de ×1 a ×5.
export function exageracionDefecto(desnivel_m, lado_m) {
  if (Number.isNaN(desnivel_m)) return 3;
  return Math.max(1, Math.min(5, Math.round((0.1 * lado_m) / desnivel_m)));
}

// polo: meta.json de web/data/terreno/polo_sur (o null si no está).
export function fuenteRelieve(mundo, lat, lon, lado_m, polo = null) {
  if (mundo === 'earth') return Math.abs(lat) > LAT_MAX_TESELAS ? { tipo: null, mensaje: MENSAJES.sinTeselasPolo } : { tipo: 'terrarium' };
  if (mundo !== 'moon' && mundo !== 'mars') return { tipo: null, mensaje: MENSAJES.sinMundo };
  if (mundo === 'moon' && polo && lat < -80) {
    const p = latLonAXY(polo, lat, lon), borde = Math.abs(polo.georef.x0_m) - polo.m_por_px;
    const h = Math.min(lado_m / 2, borde - Math.abs(p.x), borde - Math.abs(p.y));
    if (h >= MEDIO_LADO_MIN_POLO) return { tipo: 'polo_sur', lado_m: 2 * Math.floor(h) };
  }
  if (Math.abs(lat) > LAT_MAX_EQUIRECT) return { tipo: null, mensaje: MENSAJES.sinRelievePolo };
  return { tipo: 'equirect' };
}

const LARGOS_KM = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500];
export function barraEscala(px_por_km, max_px) {
  let km = LARGOS_KM[0];
  for (const l of LARGOS_KM) if (l * px_por_km <= max_px) km = l;
  return { km, px: Math.round(km * px_por_km) };
}

// Contorno de la celda de 0,5° centrada en (latC, lonC), en metros locales alrededor de (lat0, lon0); k puntos por lado.
export function contornoCelda(latC, lonC, lat0, lon0, R, k = 24) {
  const no = latC + 0.25, su = latC - 0.25, o = lonC - 0.25, e = lonC + 0.25;
  const lados = [[no, o, no, e], [no, e, su, e], [su, e, su, o], [su, o, no, o]];
  const pts = [];
  for (const [la1, lo1, la2, lo2] of lados) for (let i = 0; i < k; i++) pts.push(aLocal(lat0, lon0, la1 + ((la2 - la1) * i) / k, lo1 + ((lo2 - lo1) * i) / k, R));
  pts.push({ ...pts[0] });
  return pts;
}

export const formatoMetros = (v) => (Number.isFinite(v) ? `${v < -0.5 ? '−' : ''}${Math.abs(Math.round(v)).toLocaleString('en-US')} m` : 'no data');
