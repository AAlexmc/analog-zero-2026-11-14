// Terreno de la Tierra hecho en el momento para un lugar de la URL (?lugar=lat,lon): teselas abiertas de web/relieve/
// convertidas a la forma de un terreno del catálogo (docs/contrato-terreno.md, «Terreno dinámico»). Nunca se escribe a disco.
import { cargarRelieve } from '../relieve/datos.js';
import { R_MERCATOR, ZOOM_MAX_TERRARIUM, zoomPara } from '../relieve/calculo.js';
import { rango } from './calculo.js';

export const LADOS_KM = [2, 10, 40];
export const LADO_DEFECTO_KM = 10;
export const N_MAX = 1023;
const LADO_MAX_KM = 50;
// Por debajo de 1 km la rejilla sería más fina que el píxel de la tesela más detallada.
const LADO_MIN_KM = 1;
const RAD = Math.PI / 180;

export function leerLugar(search) {
  const q = new URLSearchParams(search);
  const partes = (q.get('lugar') ?? '').split(',');
  if (partes.length !== 2 || partes.some((s) => s.trim() === '')) return null;
  const [lat, lon] = partes.map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const nombre = (q.get('nombre') ?? '').trim() || null;
  const l = Number(q.get('lado'));
  const lado_km = q.get('lado') !== null && Number.isFinite(l) && l >= LADO_MIN_KM && l <= LADO_MAX_KM ? l : LADO_DEFECTO_KM;
  return { lat, lon, nombre, lado_km };
}

// Enlace al visor (relativo a la raíz de la web) con el lugar de la Tierra y, al lado, el terreno lunar del catálogo que
// contiene el punto elegido o, si no hay, el terreno del punto hecho en el momento (punto = {mundo: 'moon'|'mars', lat, lon});
// sin ninguno de los dos el lugar se abre solo.
export function enlaceSimulacion({ lat, lon, nombre = null, lunar = null, punto = null }) {
  const q = new URLSearchParams({ lugar: `${lat.toFixed(4)},${lon.toFixed(4)}` });
  if (nombre) q.set('nombre', nombre);
  if (lunar) q.set('b', lunar);
  else if (punto && MUNDOS_PUNTO[punto.mundo] && Number.isFinite(punto.lat) && Number.isFinite(punto.lon)) { q.set('punto', `${punto.lat.toFixed(4)},${punto.lon.toFixed(4)}`); q.set('mundo', punto.mundo); }
  else q.set('solo', 'lugar');
  q.set('vista', 'suelo');
  return `terreno/index.html?${q.toString()}`;
}

export const idLugar = ({ lat, lon, lado_km }) => `lugar_${lat.toFixed(4)}_${lon.toFixed(4)}_${lado_km}km`;

// ---------- Punto elegido en la Luna o Marte (?punto=lat,lon&mundo=moon|mars) ----------
export const MUNDOS_PUNTO = { moon: { cuerpo: 'luna', nombre: 'Moon' }, mars: { cuerpo: 'marte', nombre: 'Mars' } };
export const N_PUNTO = 257;
export const TEXTO_TONO = 'Ground colour: one tint, the average colour of the global map of this world. It is not an image of this place.';

export function leerPunto(search, lado_km = LADO_DEFECTO_KM) {
  const q = new URLSearchParams(search), mundo = q.get('mundo');
  const partes = (q.get('punto') ?? '').split(',');
  if (!MUNDOS_PUNTO[mundo] || partes.length !== 2 || partes.some((s) => s.trim() === '')) return null;
  const [lat, lon] = partes.map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { mundo, lat, lon, lado_km };
}

export const idPunto = ({ mundo, lat, lon, lado_km }) => `punto_${mundo}_${lat.toFixed(4)}_${lon.toFixed(4)}_${lado_km}km`;

// relieve: lo que devuelve cargarRelieve({ mundo: 'moon' | 'mars', … }); origen_m = lado de celda del mapa global (null si no se sabe).
export function terrenoDePunto(relieve, { mundo, lat, lon, lado_km }, origen_m = null) {
  const { n, paso: m } = relieve, M = MUNDOS_PUNTO[mundo];
  const altura = Float32Array.from(relieve.z);
  const r = rango(altura), k = ((n - 1) / 2) * m, f = fuenteAltura(relieve.creditos);
  const tono = Array.isArray(relieve.tono) && relieve.tono.length === 3 && relieve.tono.every((v) => Number.isFinite(v) && v >= 0 && v <= 255) ? relieve.tono : null;
  const meta = {
    id: idPunto({ mundo, lat, lon, lado_km }),
    cuerpo: M.cuerpo,
    nombre: `Your point on ${mundo === 'moon' ? 'the Moon' : M.nombre} · ${fmtGrado(lat, 'N', 'S')}, ${fmtGrado(lon, 'E', 'W')}`,
    centro: { lat, lon },
    lado_km: Math.round(n * m) / 1000, n, m_por_px: m,
    z_min: r.min, z_max: r.max,
    z_referencia: (relieve.rotulos?.altura ?? '').split(', ').pop() || null,
    georef: { tipo: 'local_aeqd', radio_m: relieve.R, x0_m: -k, y0_m: k },
    capas: { altura: { fichero: null, tipo: 'float32', unidad: 'm', fuente: f.fuente, url: f.url, resolucion_origen_m: origen_m } },
    creditos: relieve.creditos ?? [],
    // Sin imagen del lugar: el suelo se tiñe con el color medio del mapa global (lo dice la tarjeta).
    imagen: tono ? { texto: TEXTO_TONO, tinte: true } : null,
    punto: { mundo, origen_m },
  };
  let imagen = null;
  if (tono) {
    imagen = new Uint8ClampedArray(n * n * 4);
    for (let i = 0; i < n * n; i++) { imagen[4 * i] = tono[0]; imagen[4 * i + 1] = tono[1]; imagen[4 * i + 2] = tono[2]; imagen[4 * i + 3] = 255; }
  }
  return { meta, altura, bytesAltura: new Uint8Array(altura.buffer), capas: {}, notas: [], imagen };
}

export function textoPunto(meta) {
  const o = meta.punto?.origen_m, m = meta.m_por_px;
  const grano = (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)} km` : `${Math.round(v)} m`);
  return Number.isFinite(o)
    ? `Built live from the global elevation map: one value every ${grano(o)}, smoothed onto a ${grano(m)} grid. Anything smaller than ${grano(o)} is not in the data, so the ground looks smoother than it is.`
    : `Built live from the elevation map of this world, on a ${grano(m)} grid. Detail finer than the source map is not in the data.`;
}

export async function cargarPunto(punto) {
  // Lado entre nodos extremos: así n × paso = lado pedido, como en el lugar de la Tierra.
  const r = await cargarRelieve({ mundo: punto.mundo, lat: punto.lat, lon: punto.lon, lado_km: (punto.lado_km * (N_PUNTO - 1)) / N_PUNTO, n: N_PUNTO });
  let origen = null;
  if (r.fuente === 'equirect') {
    try { origen = (await (await fetch(new URL('../data/relieve/indice.json', import.meta.url))).json()).mundos?.[punto.mundo]?.m_por_px ?? null; } catch { origen = null; }
  }
  return terrenoDePunto(r, punto, Number.isFinite(origen) ? origen : null);
}

// Lado en el suelo de un píxel de tesela Web Mercator a esa latitud (la misma cuenta que zoomPara).
export const pixelTesela = (lat, z) => (2 * Math.PI * R_MERCATOR * Math.cos(lat * RAD)) / 256 / 2 ** z;

// Rejilla n × n (impar: el nodo central es el lugar) con paso no menor que el píxel de tesela del zoom máximo.
export function ventanaLugar(lat, lado_km, nMax = N_MAX) {
  const lado_m = lado_km * 1000;
  let n = Math.min(nMax, Math.floor(lado_m / pixelTesela(lat, ZOOM_MAX_TERRARIUM)));
  if (n % 2 === 0) n -= 1;
  n = Math.max(n, 3);
  const m = lado_m / n, zoom = zoomPara(lat, m, ZOOM_MAX_TERRARIUM);
  return { n, m_por_px: m, lado_km, lado_pedido_km: ((n - 1) * m) / 1000, zoom, pixel_tesela_m: pixelTesela(lat, zoom) };
}

const fmtGrado = (v, pos, neg) => `${Math.abs(v).toFixed(2)}° ${v < 0 ? neg : pos}`;

function fuenteAltura(creditos) {
  const linea = (creditos ?? []).find((t) => /^Elevation:/.test(t)) ?? '';
  const url = (linea.match(/https?:\/\/[^\s,]+/)?.[0] ?? '').replace(/\.$/, '');
  return { linea, fuente: linea.replace(/^Elevation:\s*/, '').split(/,\s*https?:/)[0] || null, url: url || null };
}

export const TEXTO_IMAGEN = 'Image: NASA Blue Marble (GIBS), low resolution: colours are real, detail is not';

// relieve: lo que devuelve cargarRelieve({ mundo: 'earth', … }). Mismos nodos: centro del píxel (f, c) = nodo (f, c).
export function terrenoDeRelieve(relieve, { lat, lon, nombre }) {
  const { n, paso: m } = relieve;
  const altura = Float32Array.from(relieve.z);
  const r = rango(altura);
  const lado_km = Math.round(n * m) / 1000;
  const k = ((n - 1) / 2) * m;
  const f = fuenteAltura(relieve.creditos);
  const zoom = relieve.teselas?.elevacion?.z ?? null;
  const fuentes = fuentesDeTeselas(relieve.teselas?.elevacion?.origenes);
  const lineaImagen = relieve.imagen ? (relieve.creditos ?? []).find((t) => /^Imagery:/.test(t)) ?? null : null;
  const unica = fuentes.fuentes.length === 1 && !fuentes.sin_dato ? fuentes.fuentes[0].m : null;
  const meta = {
    id: idLugar({ lat, lon, lado_km }),
    cuerpo: 'tierra',
    nombre: nombre ?? `Your place · ${fmtGrado(lat, 'N', 'S')}, ${fmtGrado(lon, 'E', 'W')}`,
    centro: { lat, lon },
    lado_km, n, m_por_px: m,
    z_min: r.min, z_max: r.max,
    z_referencia: 'metres above sea level',
    georef: { tipo: 'local_aeqd', radio_m: relieve.R, x0_m: -k, y0_m: k },
    capas: { altura: { fichero: null, tipo: 'float32', unidad: 'm', fuente: f.fuente, url: f.url, resolucion_origen_m: unica } },
    creditos: [lineaImagen, f.linea].filter(Boolean),
    // web/relieve/ no declara la resolución de Blue Marble: sin cifra.
    imagen: relieve.imagen ? { texto: TEXTO_IMAGEN, zoom: relieve.teselas?.imagen?.z ?? null, credito: lineaImagen } : null,
    muestreo: {
      m, zoom, pixel_tesela_m: zoom === null ? null : pixelTesela(lat, zoom),
      teselas: relieve.teselas?.elevacion?.n ?? null, descarga_bytes: relieve.descarga_bytes ?? null, fuentes,
    },
    dinamico: true,
  };
  return { meta, altura, bytesAltura: new Uint8Array(altura.buffer), capas: {}, notas: [], imagen: relieve.imagen ? Uint8ClampedArray.from(relieve.imagen) : null };
}

// Fuente de cada tesela: cabecera x-amz-meta-x-imagery-sources del servidor de teselas. Solo prefijos vistos en teselas
// reales; los metros, de la documentación de Mapzen/joerd. Un prefijo que no está aquí no se adivina.
const DOC_JOERD = 'https://github.com/tilezen/joerd/blob/master/docs/data-sources.md';
const ORIGEN_TABLA = 'mío: prefix read on real tiles, metres from the joerd documentation';
export const FUENTES_TERRARIUM = [
  { prefijo: 'pgdc_5m/', nombre: 'ArcticDEM', m: 5, cita: 'strips of 5 meter mosaics across all of the land north of 60° latitude', url: DOC_JOERD, origen: ORIGEN_TABLA },
  { prefijo: 'ned13/', nombre: 'USGS 3DEP 1/3″', m: 10, cita: 'in the United States, 10 meters outside of Alaska, 3 meter in select land and territorial water areas', url: DOC_JOERD, origen: ORIGEN_TABLA },
  { prefijo: 'srtm/', nombre: 'SRTM', m: 30, cita: 'globally except high latitudes, 30 meters (90 meters nominal quality) in land areas', url: DOC_JOERD, origen: ORIGEN_TABLA },
];

// origenes: una cabecera por tesela ('' si no llegó). sin_dato = teselas sin cabecera o con alguna fuente desconocida.
export function fuentesDeTeselas(origenes) {
  const vistas = new Set();
  let sin_dato = 0;
  for (const cab of origenes ?? []) {
    const partes = String(cab ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const fs = partes.map((s) => FUENTES_TERRARIUM.find((f) => s.startsWith(f.prefijo)));
    if (!partes.length || fs.some((f) => !f)) sin_dato++;
    fs.forEach((f) => f && vistas.add(f));
  }
  return { fuentes: FUENTES_TERRARIUM.filter((f) => vistas.has(f)), sin_dato };
}

export function textoMuestreo(meta) {
  const m = meta.muestreo.m, s = m.toFixed(1);
  const { fuentes, sin_dato } = meta.muestreo.fuentes ?? { fuentes: [], sin_dato: 0 };
  const cab = `Sampled every ${s} m from open elevation tiles (zoom ${meta.muestreo.zoom})`;
  if (!fuentes.length) return `${cab}. Source resolution not stated; anything smaller than ${s} m is not in the data.`;
  const fino = Math.min(...fuentes.map((f) => f.m));
  const txt = fuentes.length === 1 ? `source: ${fuentes[0].nombre}, about ${fuentes[0].m} m` : `sources: ${fuentes.map((f) => `${f.nombre} about ${f.m} m`).join(', ')}`;
  const lim = sin_dato || fino <= m ? `${s} m` : `about ${fino} m`;
  return `${cab}; ${txt}${sin_dato ? '; some tiles do not state their source' : ''}. Anything smaller than ${lim} is not in the data.`;
}

export async function cargarLugar(lugar) {
  const v = ventanaLugar(lugar.lat, lugar.lado_km);
  const r = await cargarRelieve({ mundo: 'earth', lat: lugar.lat, lon: lugar.lon, lado_km: v.lado_pedido_km, n: v.n });
  return terrenoDeRelieve(r, lugar);
}
