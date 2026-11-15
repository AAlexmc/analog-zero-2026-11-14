// Carga del relieve local: teselas en línea para la Tierra (solo los orígenes de ORIGENES_EXTERNOS), ficheros propios
// para la Luna y Marte. Devuelve la rejilla de alturas y el color base; lanza Error con un mensaje llano si no hay terreno.
import {
  URL_TERRARIUM, URL_GIBS, ZOOM_MAX_TERRARIUM, ZOOM_MAX_GIBS, CREDITOS_TIERRA, MENSAJES, N_REJILLA, LADO_KM, R_TIERRA_M,
  urlTesela, zoomPara, decodificarTerrarium, rejillaLocal, remuestrear, teselasVentana, muestraMercator,
  muestraEquirect, filasEquirect, muestraPolo, filasPolo, leerI16, fuenteRelieve,
} from './calculo.js';
import { decodificarPng } from './png.js';

const DATOS = new URL('../data/', import.meta.url);
// Las teselas se piden sin cookies ni referer: solo la URL de la tesela.
const PEDIR_FUERA = { credentials: 'omit', referrerPolicy: 'no-referrer', mode: 'cors' };
const completos = new Map();
let indiceP = null, poloP = null;

const errorLlano = (mensaje, causa) => Object.assign(new Error(mensaje), { causa: String(causa?.message ?? causa ?? '') });

async function pixeles(blob) {
  const bm = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const { width: w, height: h } = bm;
  const cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
  const cx = cv.getContext('2d', { willReadFrequently: true });
  cx.drawImage(bm, 0, 0);
  bm.close?.();
  return cx.getImageData(0, 0, w, h).data;
}

async function json(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
}

// Filas [f0, f1) de un ráster; con Range si el servidor lo admite, si no el fichero entero una sola vez.
async function filas(url, bytesFila, f0, f1) {
  const a = f0 * bytesFila, b = f1 * bytesFila;
  if (!completos.has(url)) {
    const r = await fetch(url, { headers: { Range: `bytes=${a}-${b - 1}` } });
    if (r.status === 206 && (r.headers.get('content-range') ?? '').startsWith(`bytes ${a}-`)) {
      const buf = await r.arrayBuffer();
      if (buf.byteLength === b - a) return buf;
    }
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    completos.set(url, r.status === 200 ? r.arrayBuffer() : fetch(url).then((x) => x.arrayBuffer()));
  }
  return (await completos.get(url)).slice(a, b);
}

function leerF32(buf) {
  const dv = new DataView(buf), out = new Float32Array(buf.byteLength >> 2);
  for (let i = 0; i < out.length; i++) out[i] = dv.getFloat32(4 * i, true);
  return out;
}

async function tierra(g) {
  const zd = zoomPara(g.lat0, g.paso, ZOOM_MAX_TERRARIUM), zi = Math.min(ZOOM_MAX_GIBS, zd);
  const vd = teselasVentana(g, zd), vi = teselasVentana(g, zi);
  let bytes = 0;
  // Fuente de cada tesela de relieve según el servidor (cabecera expuesta por CORS); '' si no llega.
  const origenes = [];
  const pedir = async (plantilla, z, t) => {
    const r = await fetch(urlTesela(plantilla, z, t.x, t.y), PEDIR_FUERA);
    if (!r.ok) throw new Error(`tile ${z}/${t.x}/${t.y}: HTTP ${r.status}`);
    if (plantilla === URL_TERRARIUM) origenes.push(r.headers.get('x-amz-meta-x-imagery-sources') ?? '');
    const blob = await r.blob();
    bytes += blob.size;
    // La altura no pasa por canvas (ver png.js); la imagen sí: ahí un bit de ruido no se ve.
    const exacto = plantilla === URL_TERRARIUM && typeof DecompressionStream !== 'undefined';
    if (!exacto) return [`${t.x}/${t.y}`, await pixeles(blob)];
    try { return [`${t.x}/${t.y}`, (await decodificarPng(await blob.arrayBuffer())).rgba]; } catch (e) { throw Object.assign(new Error(`tile ${z}/${t.x}/${t.y}: ${e?.message || 'not a readable PNG'}`), { ilegible: true }); }
  };
  let alt, img;
  try {
    [alt, img] = await Promise.all([Promise.all(vd.lista.map((t) => pedir(URL_TERRARIUM, zd, t))), Promise.all(vi.lista.map((t) => pedir(URL_GIBS, zi, t)))]);
  } catch (e) { throw errorLlano(e?.ilegible ? MENSAJES.teselaRota : MENSAJES.sinRed, e); }
  const mAlt = new Map(alt.map(([k, rgba]) => [k, decodificarTerrarium(rgba)])), mImg = new Map(img);
  const z = remuestrear((la, lo) => muestraMercator(vd, mAlt, zd, la, lo), g);
  const imagen = new Uint8ClampedArray(g.n * g.n * 4);
  for (let i = 0; i < g.n * g.n; i++) {
    for (let k = 0; k < 3; k++) imagen[4 * i + k] = muestraMercator(vi, mImg, zi, g.lat[i], g.lon[i], k);
    imagen[4 * i + 3] = 255;
  }
  return {
    z, imagen, tono: null, descarga_bytes: bytes, teselas: { elevacion: { z: zd, n: vd.lista.length, origenes }, imagen: { z: zi, n: vi.lista.length } },
    rotulos: { altura: 'Terrain Tiles (Mapzen), metres above sea level', imagen: 'NASA Blue Marble Next Generation imagery (GIBS) on the elevation, shaded from it' },
    creditos: CREDITOS_TIERRA,
  };
}

const NOMBRE_DEM = { moon: 'LOLA', mars: 'MOLA' };
const REFERENCIA = { moon: 'metres above the 1,737.4 km lunar sphere', mars: 'metres above the Mars areoid' };

async function equirect(mundo, g, m) {
  const ancho = m.ancho, { f0, f1 } = filasEquirect(g, m.ppd, m.alto);
  const datos = leerI16(await filas(new URL(`relieve/${m.fichero}`, DATOS).href, ancho * 2, f0, f1), m.factor_m);
  const z = remuestrear((la, lo) => muestraEquirect({ ancho, alto: m.alto, ppd: m.ppd, fila0: f0, filas: f1 - f0, datos }, la, lo), g);
  return {
    z, imagen: null, tono: m.tono_medio_rgb, descarga_bytes: (f1 - f0) * ancho * 2,
    rotulos: { altura: `${m.fuente.texto.split(' (')[0]}, ${REFERENCIA[mundo]}`, imagen: `Shaded relief from ${NOMBRE_DEM[mundo]} elevation (low sun from the west), tinted with the average colour of the global map` },
    creditos: [`Elevation: ${m.fuente.texto}, ${m.fuente.url}`, `Tint: average colour of ${m.tono_fuente}`],
  };
}

async function poloSur(g, meta, tono, idxLuna) {
  const { f0, f1 } = filasPolo(g, meta);
  const datos = leerF32(await filas(new URL(`terreno/polo_sur/${meta.capas.altura.fichero}`, DATOS).href, meta.n * 4, f0, f1));
  const z = remuestrear((la, lo) => muestraPolo({ n: meta.n, fila0: f0, filas: f1 - f0, datos }, meta, la, lo), g);
  const a = meta.capas.altura;
  return {
    z, imagen: null, tono, descarga_bytes: (f1 - f0) * meta.n * 4,
    rotulos: { altura: `${a.fuente.split(' (')[0]} (${Math.round(meta.m_por_px)} m/px south pole map), metres above the 1,737.4 km lunar sphere`, imagen: 'Shaded relief from LOLA elevation (low sun from the west), tinted with the average colour of the global map' },
    creditos: [`Elevation: ${a.fuente}, ${a.url}`, `Tint: average colour of ${idxLuna.tono_fuente}`],
  };
}

export async function cargarRelieve({ mundo, lat, lon, lado_km = LADO_KM, n = N_REJILLA }) {
  let polo = null, idx = null;
  if (mundo === 'moon' || mundo === 'mars') {
    try {
      indiceP ??= json(new URL('relieve/indice.json', DATOS).href);
      idx = await indiceP;
      if (mundo === 'moon' && lat < -80) {
        poloP ??= json(new URL('terreno/polo_sur/meta.json', DATOS).href).catch(() => null);
        polo = await poloP;
      }
    } catch (e) { indiceP = null; throw errorLlano(MENSAJES.sinDatos, e); }
  }
  const f = fuenteRelieve(mundo, lat, lon, lado_km * 1000, polo);
  if (!f.tipo) throw errorLlano(f.mensaje);
  const lado = f.lado_m ?? lado_km * 1000;
  const R = f.tipo === 'terrarium' ? R_TIERRA_M : f.tipo === 'polo_sur' ? polo.georef.radio_m : idx.mundos[mundo].radio_m;
  const g = rejillaLocal(lat, lon, lado, n, R);
  let d;
  if (f.tipo === 'terrarium') d = await tierra(g);
  else {
    try {
      d = f.tipo === 'polo_sur' ? await poloSur(g, polo, idx.mundos.moon.tono_medio_rgb, idx.mundos.moon) : await equirect(mundo, g, idx.mundos[mundo]);
    } catch (e) { throw errorLlano(MENSAJES.sinDatos, e); }
  }
  return { mundo, lat, lon, lado_m: lado, n, paso: g.paso, R, fuente: f.tipo, ...d };
}
