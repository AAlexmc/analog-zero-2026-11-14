// Lógica pura de la página de resultados: grupos por desviación, formato de valores, sitio conocido cercano y rampa de color.
const RAD = Math.PI / 180;
const MENOS = '−';

// Cortes propios (origen: mío) para los tres grupos de la pestaña Metrics, en % de desviación.
export const CORTES = { cerca: 15, lejos: 70 };
export const RADIO_TIERRA_KM = 6371;
export const RADIO_CONTEXTO_KM = 300;
export const NO_COMPARADO = ['Radiation', 'Dust and wind', 'Geology and minerals', 'Subsurface and ice'];
// Con misión entran viento, tipo de roca y permafrost de la Tierra: lo que sigue sin capa se nombra más fino.
export const NO_COMPARADO_MISION = ['Radiation', 'Dust in the air', 'Minerals and soil chemistry', 'Ice under the ground'];

const finito = (v) => typeof v === 'number' && Number.isFinite(v);
const signo = (s) => s.replace(/^-/, MENOS);

export function grupoDe(desviacion) {
  if (!finito(desviacion)) return null;
  if (desviacion < CORTES.cerca) return 'cerca';
  if (desviacion > CORTES.lejos) return 'lejos';
  return 'medio';
}

// Orden de menor a mayor desviación; sin dato al final; empate → orden de entrada.
export function ordenar(parametros) {
  return parametros.map((p, i) => ({ p, i }))
    .sort((a, b) => (finito(a.p.desviacion_pct) ? a.p.desviacion_pct : Infinity) - (finito(b.p.desviacion_pct) ? b.p.desviacion_pct : Infinity) || a.i - b.i)
    .map((x) => x.p);
}

export function agrupar(parametros) {
  const g = { cerca: [], medio: [], lejos: [], sin: [] };
  for (const p of ordenar(parametros)) g[grupoDe(p.desviacion_pct) ?? 'sin'].push(p);
  return g;
}

export const fmtPct = (v) => (finito(v) ? `${v.toFixed(1)} %` : '—');

function cientifico(v) {
  const e = Math.floor(Math.log10(Math.abs(v)));
  const m = v / 10 ** e;
  const sup = String(e).replace(/-/g, '⁻').replace(/\d/g, (d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[d]);
  return `${Math.abs(m - Math.round(m)) < 0.05 ? Math.round(m) : m.toFixed(1)} × 10${sup}`;
}

// p (opcional): el parámetro del índice, para los que la unidad sola no basta (diferencia en K, clase de roca).
export function formatoValor(v, unidad, p = null) {
  if (!finito(v)) return 'no data';
  if (p?.transformacion === 'categoria') return p.clases?.[String(v)] ?? `rock class ${v}`;
  if (p?.id === 'amplitud_diurna_k') return `${signo(v.toFixed(1))} K`;
  if (p?.transformacion === 'log10' && unidad === '1') return signo(String(Number(v.toPrecision(2))));
  switch (unidad) {
    case 'h': return `${signo(Math.abs(v) < 10 ? v.toFixed(1) : v.toFixed(0))} h`;
    case 'm/s': return `${signo(v.toFixed(1))} m/s`;
    case 'K': return `${signo(v.toFixed(1))} K (${signo((v - 273.15).toFixed(1))} °C)`;
    case 'm': return `${signo(Math.abs(v) < 10 ? v.toFixed(1) : v.toFixed(0))} m`;
    case '1 (tangent)': return `${signo(v.toPrecision(2))} (slope tangent)`;
    case 'kWh m-2 per 24 h': return `${signo(v.toFixed(2))} kWh/m² per day`;
    case '1': return signo(v.toFixed(2));
    case 'mm/year': return `${signo(v.toFixed(0))} mm/year`;
    case 'm/s2': return `${signo(v.toFixed(2))} m/s²`;
    case 'Pa':
      if (v !== 0 && Math.abs(v) < 0.01) return `${cientifico(v)} Pa`;
      if (Math.abs(v) < 1000) return `${signo(v.toFixed(0))} Pa`;
      return `${signo((v / 1000).toFixed(1))} kPa`;
    default: return `${signo(String(v))} ${unidad}`;
  }
}

export const celsius = (k) => (finito(k) ? `${signo((k - 273.15).toFixed(1))} °C` : 'no data');

export function distanciaKm(lat1, lon1, lat2, lon2, R = RADIO_TIERRA_KM) {
  const a = Math.sin(((lat2 - lat1) * RAD) / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(((lon2 - lon1) * RAD) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(Math.min(1, a)));
}

// Elemento de la lista (con lat/lon finitos) más cercano a menos de maxKm, o null.
export function masCercano(lat, lon, lista, maxKm = RADIO_CONTEXTO_KM, R = RADIO_TIERRA_KM) {
  let mejor = null;
  for (const x of lista ?? []) {
    if (!finito(x?.lat) || !finito(x?.lon)) continue;
    const km = distanciaKm(lat, lon, x.lat, x.lon, R);
    if (km <= maxKm && (!mejor || km < mejor.km)) mejor = { item: x, km };
  }
  return mejor;
}

// NASA Worldview centrado en el lugar: v=lonMin,latMin,lonMax,latMax, ±2° recortado a ±180/±90, 4 decimales sin ceros de cola.
// Capas fijas (Blue Marble, costas, nombres): con las de por defecto se abre la imagen del día, negra en noche polar o tapada de nubes.
export const CAPAS_WORLDVIEW = 'Reference_Labels_15m,Coastlines_15m,BlueMarble_NextGeneration';
export function enlaceWorldview(lat, lon, margen = 2) {
  if (!finito(lat) || !finito(lon)) return null;
  const c = (v, tope) => String(Number(Math.max(-tope, Math.min(tope, v)).toFixed(4)));
  return `https://worldview.earthdata.nasa.gov/?v=${[c(lon - margen, 180), c(lat - margen, 90), c(lon + margen, 180), c(lat + margen, 90)].join(',')}&l=${CAPAS_WORLDVIEW}`;
}

export const sitiosConCoordenadas = (sitios) => (sitios ?? []).filter((s) => finito(s?.lat) && finito(s?.lon)).length;

export const lineaContexto = (c, nSitios) => (c ? `near ${c.item.nombre} — a known analog site (${Math.round(c.km)} km)` : `not near any of the ${nSitios} analog sites in our catalogue`);

// Cuántos lugares no tienen un sitio del catálogo a menos de RADIO_CONTEXTO_KM («unlisted»: solo fuera de NUESTRO catálogo).
export function fraseUnlisted(sinSitio, total, nSitios) {
  if (!total) return null;
  const cola = `none of the ${nSitios} analog sites in our catalogue is within ${RADIO_CONTEXTO_KM} km`;
  if (sinSitio === 0) return `All ${total} places are near a known analog site in our catalogue.`;
  if (sinSitio === total) return `All ${total} places are unlisted: ${cola}.`;
  return `${sinSitio} of these ${total} places ${sinSitio === 1 ? 'is' : 'are'} unlisted: ${cola}.`;
}

export const fraseParcial = (r) => `only ${r.comparados} of ${r.de} parameters have Earth data here`;

// Terreno lunar que contiene el punto (centro a menos de medio lado), el más cercano.
export function terrenoDelPunto(lat, lon, terrenos, R) {
  let mejor = null;
  for (const t of terrenos ?? []) {
    if (!finito(t?.lat) || !finito(t?.lon) || !finito(t?.lado_km)) continue;
    const km = distanciaKm(lat, lon, t.lat, t.lon, R);
    if (km <= t.lado_km / 2 && (!mejor || km < mejor.km)) mejor = { id: t.id, km };
  }
  return mejor?.id ?? null;
}

// Rampa de la capa de similitud: solo colores de la marca, interpolados entre paradas.
export const RAMPA = [[0, '#0042A6'], [0.5, '#2E96F5'], [0.85, '#FFFFFF'], [1, '#EAFE07']];
export const SIN_COMPARAR = '#07173F';
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
export function colorRampa(t) {
  const x = Math.max(0, Math.min(1, finito(t) ? t : 0));
  for (let k = 1; k < RAMPA.length; k++) {
    const [t1, c1] = RAMPA[k];
    if (x <= t1) {
      const [t0, c0] = RAMPA[k - 1], f = (x - t0) / (t1 - t0), a = rgb(c0), b = rgb(c1);
      return a.map((v, i) => Math.round(v + (b[i] - v) * f));
    }
  }
  return rgb(RAMPA[RAMPA.length - 1][1]);
}

export function minMax(mapa) {
  let min = Infinity, max = -Infinity;
  for (const v of mapa) if (v === v) { if (v < min) min = v; if (v > max) max = v; }
  return Number.isFinite(min) ? { min, max } : null;
}

// RGBA fila a fila (fila 0 = norte, columna 0 = −180°). Tierra firme sin comparar → deep blue opaco; mar → transparente.
export function pintarMapa(mapa, min, max, alfa = 210, tierra = null) {
  const out = new Uint8ClampedArray(mapa.length * 4);
  const den = max > min ? max - min : 1;
  for (let i = 0; i < mapa.length; i++) {
    const v = mapa[i];
    if (v !== v) {
      if (tierra && tierra[i] >= 0.5) out.set([...rgb(SIN_COMPARAR), 240], i * 4);
      continue;
    }
    const [r, g, b] = colorRampa((v - min) / den);
    out.set([r, g, b, alfa], i * 4);
  }
  return out;
}

// Cartera (M.cartera): letras de los lugares, nombres cortos de los parámetros y textos.
export const letra = (k) => String.fromCharCode(65 + k);
export const NOMBRE_CORTO = {
  rugosidad_tan: 'roughness', relieve_m: 'relief', t_max_k: 'daytime high', t_min_k: 'night-time low', t_media_k: 'mean temperature',
  insolacion_kwh_m2_dia: 'sunlight', ndvi_max: 'vegetation', precip_mm_ano: 'rain and snow',
  aridez_ai: 'dryness', viento_medio_m_s: 'mean wind', viento_p95_m_s: 'strong wind', amplitud_diurna_k: 'day-night swing',
  permafrost_frac: 'permafrost', elev_m: 'elevation', tiempo_ciudad_h: 'time to a city', litologia_glim: 'rock type',
};
export const nombreCorto = (id, P) => NOMBRE_CORTO[id] ?? P?.[id]?.nombre ?? id;

export function titularCartera(c) {
  const y = c.usados.length, x = c.cubiertos.length, n = c.lugares.length;
  if (!y) return 'No parameter could be compared at this point.';
  if (!n) return `No place on Earth comes within ${c.corte} % on any of the ${y} parameters.`;
  if (n === 1 && x === y) return `One place on Earth covers all ${y} parameters.`;
  if (n === 1) return `No single place on Earth matches everything. This place covers ${x} of ${y} parameters.`;
  return `No single place on Earth matches everything. Together, these ${n} places cover ${x} of ${y} parameters.`;
}

// Un parámetro que ningún lugar cubre: lo más cerca que llega la Tierra y dónde (texto del sitio ya formateado).
export function fraseSinCubrir(s, donde) {
  if (!finito(s.mejor_desviacion_pct)) return 'No place on Earth has data for it.';
  return `The closest any place gets is ${fmtPct(s.mejor_desviacion_pct)} off, at ${donde}.`;
}

export const reglaCartera = (c) => [
  `A parameter is covered at a place when its deviation there is under ${c.corte} % (the "close match" cut-off of Metrics; own criterion).`,
  'We check every land cell on Earth and find the smallest set of places that together cover every parameter that any place can cover. The search is exact, not a guess.',
  'If several sets have that size, we keep the one with the highest average match.',
  'Cells must be at least half land, not ice cap, and have Earth data for at least half of the parameters.',
];

// Tipo de entorno (M.claseDe) en una línea; null si el punto no se pudo proyectar.
export function lineaEntorno(k, nTipos) {
  if (!k || k.id === null || k.id === undefined) return null;
  if (!k.dentro) return `Earth has nothing quite like this: its conditions fall outside all ${nTipos} types of land environment we found. Closest type: “${k.rotulo}”.`;
  return `Its conditions fall within an Earth environment type: “${k.rotulo}”.`;
}

// «How we know»: lo que dice clases.json y la distancia del punto, sin texto propio salvo el que explica la silueta.
export function comoSabemos(clases, k) {
  const sil = clases.criterio_k?.tabla?.find((t) => t.k === clases.criterio_k.k)?.silueta_media;
  const tipo = clases.clases.find((c) => c.id === k?.id);
  return [
    clases.que_es,
    clases.metodo,
    `${clases.clases.length} types from ${clases.celdas.n} land cells (${clases.celdas.pct_area_tierra_firme.toFixed(1)} % of the land area without ice caps).`,
    finito(sil) ? `The groups are weak: mean silhouette ${sil.toFixed(2)}, on a scale where 1 is sharp groups and 0 is none. Earth's land is a continuum, so the borders between types are a convention.` : null,
    tipo && finito(k.distancia) ? `Your point is ${k.distancia.toFixed(1)} from the centre of “${tipo.rotulo}”; 95 % of that type's own land is within ${tipo.radio.toFixed(2)}. Units: Earth's own spread.` : null,
    k?.faltan?.length ? `No data at your point for ${k.faltan.length} parameter(s); placed with the ones it has.` : null,
  ].filter(Boolean);
}

// Capa de tipos de entorno: colores de la marca y una transparencia de la paleta (blanco al 50 % sobre martian red).
export const COLORES_CLASE = ['#0042A6', '#C78880', '#EAFE07', '#2E96F5', '#FFFFFF', '#8E1100'];
// Tierra firme sin clase (hielo, sin dato) → deep blue opaco, como en la capa de similitud: el hielo blanco no se confunde con una clase.
export function pintarClases(clase, colores = COLORES_CLASE, alfa = 225, tierra = null) {
  const out = new Uint8ClampedArray(clase.length * 4);
  for (let i = 0; i < clase.length; i++) {
    const v = clase[i];
    if (v !== v || !colores[v]) {
      if (tierra && tierra[i] >= 0.5) out.set([...rgb(SIN_COMPARAR), 240], i * 4);
      continue;
    }
    out.set([...rgb(colores[v]), alfa], i * 4);
  }
  return out;
}

// Orden por componentes (buscar con metrica 'componentes'): la distancia en múltiplos de d_ref; su % no se enseña (sale 0 lejos de la Tierra).
export const lineaDistancia = (d, dRef) => (finito(d) && finito(dRef) && dRef > 0 ? `distance ${(d / dRef).toFixed(2)} × Earth's own spread` : null);
export const textoComponentes = (clases) => [
  'Daily maximum, minimum and mean temperature move together, so by default they weigh three times.',
  'With this on, places are ordered by distance in the principal components of Earth\'s land (the same ones as the environment types): each independent direction counts once. Own criterion.',
  `Earth's own spread = ${clases.d_ref.valor.toFixed(2)}, the distance that 99 % of pairs of Earth land cells (a fixed sample of 5000) stay under.`,
  'Points on the Moon and Mars are far from all of Earth in this space, so the distance is not turned into a percentage. The match % on each card is still the per-parameter one.',
];

// Tabla lado a lado: una fila por parámetro; en cada lugar valor y desviación; la menor desviación de la fila marcada (empates: todas).
export function tablaComparar(lugares, ids) {
  return ids.map((id) => {
    const ps = lugares.map((x) => x.parametros.find((q) => q.id === id) ?? null);
    const celdas = ps.map((p) => ({ valor: p?.valor_tierra ?? null, desv: finito(p?.desviacion_pct) ? p.desviacion_pct : null }));
    const ds = celdas.map((c) => c.desv).filter((d) => d !== null);
    const min = ds.length ? Math.min(...ds) : null;
    return { id, objetivo: ps.find(Boolean)?.valor_objetivo ?? null, celdas: celdas.map((c) => ({ ...c, mejor: min !== null && c.desv === min })) };
  });
}

// Superíndices de formatoValor (m/s², 10⁻¹⁰) en trozos para pintarlos con <sup>: la fuente mono no los tiene.
const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹⁻', NORMAL = '0123456789−';
export function partesSup(s) {
  const out = [];
  let buf = '', enSup = false;
  for (const ch of s) {
    const k = SUP.indexOf(ch);
    if ((k >= 0) !== enSup && buf) { out.push(enSup ? { sup: buf } : { t: buf }); buf = ''; }
    enSup = k >= 0;
    buf += k >= 0 ? NORMAL[k] : ch;
  }
  if (buf) out.push(enSup ? { sup: buf } : { t: buf });
  return out;
}
export const planoSup = (s) => partesSup(s).map((p) => p.t ?? p.sup).join('');
