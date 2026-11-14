// Lógica pura de la página de resultados: grupos por desviación, formato de valores, sitio conocido cercano y rampa de color.
const RAD = Math.PI / 180;
const MENOS = '−';

// Cortes propios (origen: mío) para los tres grupos de la pestaña Metrics, en % de desviación.
export const CORTES = { cerca: 15, lejos: 70 };
export const RADIO_TIERRA_KM = 6371;
export const RADIO_CONTEXTO_KM = 300;
export const NO_COMPARADO = ['Radiation', 'Dust and wind', 'Geology and minerals', 'Subsurface and ice'];

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

export function formatoValor(v, unidad) {
  if (!finito(v)) return 'no data';
  switch (unidad) {
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

export const lineaContexto = (c) => (c ? `near ${c.item.nombre} — a known analog site (${Math.round(c.km)} km)` : `no listed analog site within ${RADIO_CONTEXTO_KM} km`);

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
