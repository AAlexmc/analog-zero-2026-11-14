// Página de datos: de dónde sale cada parámetro en cada mundo, leído de los índices que ya usa la web.
// Funciones puras (sin DOM) para poder probarlas en node.

export const MUNDOS = { earth: 'Earth', moon: 'Moon', mars: 'Mars' };

export const SECCIONES = [
  { id: 'comparado', titulo: 'Compared with the Moon or Mars' },
  { id: 'no_reproducible', titulo: 'Shown but not compared: Earth cannot reproduce it' },
  { id: 'solo_tierra', titulo: 'Earth only: compared with the mission reference site' },
  { id: 'sitio', titulo: 'Base-site criteria' },
];

// Agrupación propia por la dirección o el nombre de cada fuente; una fuente puede estar en varios grupos.
export const GRUPOS = [
  { id: 'earthdata', titulo: 'NASA Earthdata', regla: 'address ends in earthdata.nasa.gov' },
  { id: 'gibs', titulo: 'NASA Worldview / GIBS', regla: 'address is a Worldview or GIBS server' },
  { id: 'pds', titulo: 'Planetary Data System', regla: 'address is a PDS node' },
  { id: 'lro', titulo: 'Lunar Reconnaissance Orbiter', regla: 'the source names LRO or the file sits in an LRO folder' },
  { id: 'nasa', titulo: 'Other NASA sources', regla: 'address ends in nasa.gov or the source names NASA' },
  { id: 'otras', titulo: 'Other sources', regla: 'everything else' },
];

const PRINCIPALES = ['earthdata', 'gibs', 'pds', 'lro'];

function host(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ''; }
}

export function gruposDe(fuente) {
  const h = host(fuente?.url);
  const texto = String(fuente?.texto ?? '');
  const ruta = String(fuente?.url ?? '').toLowerCase();
  const g = [];
  if (h.endsWith('earthdata.nasa.gov')) g.push('earthdata');
  if (['wvs.earthdata.nasa.gov', 'gibs.earthdata.nasa.gov', 'worldview.earthdata.nasa.gov'].includes(h)) g.push('gibs');
  if (h.split('.')[0].startsWith('pds')) g.push('pds');
  if (/\bLRO\b/.test(texto) || ruta.includes('/lro/')) g.push('lro');
  if (g.length) return g;
  if (h.endsWith('nasa.gov') || /\bNASA\b/.test(texto)) return ['nasa'];
  return ['otras'];
}

const entrada = (seccion, id, nombre, mundo, f) => ({
  seccion, id, nombre, mundo,
  texto: f?.texto ?? null,
  url: f?.url ?? null,
  propio: f?.origen === 'mío',
});

// Una fila por parámetro y mundo, en el orden de los índices.
export function entradas(indice, sitio) {
  const out = [];
  for (const p of indice?.parametros ?? []) {
    const sec = p.reproducible_en_tierra ? 'comparado' : 'no_reproducible';
    for (const m of Object.keys(MUNDOS)) if (p.fuentes?.[m]) out.push(entrada(sec, p.id, p.nombre, m, p.fuentes[m]));
  }
  for (const p of indice?.parametros_tierra ?? []) {
    if (p.fuentes?.earth) out.push(entrada('solo_tierra', p.id, p.nombre, 'earth', p.fuentes.earth));
  }
  for (const [m, w] of Object.entries(sitio?.mundos ?? {})) {
    for (const c of w.criterios ?? []) if (c.fuente_dato) out.push(entrada('sitio', c.id, c.nombre, m, c.fuente_dato));
  }
  return out;
}

// Fuentes únicas (misma dirección y mismo texto) con los usos de cada una, repartidas por grupo.
export function porGrupo(lista) {
  const unicas = new Map();
  for (const e of lista) {
    if (!e.texto && !e.url) continue;
    const clave = `${e.url ?? ''}\n${e.texto ?? ''}`;
    if (!unicas.has(clave)) unicas.set(clave, { texto: e.texto, url: e.url, propio: e.propio, usos: [] });
    const u = unicas.get(clave);
    const uso = `${e.nombre} (${MUNDOS[e.mundo]})`;
    if (!u.usos.includes(uso)) u.usos.push(uso);
  }
  const grupos = Object.fromEntries(GRUPOS.map((g) => [g.id, []]));
  for (const u of unicas.values()) for (const g of gruposDe(u)) grupos[g].push(u);
  return GRUPOS.map((g) => ({ ...g, principal: PRINCIPALES.includes(g.id), fuentes: grupos[g.id] }));
}

// Tabla por parámetro: filas con una celda por mundo (null si el parámetro no existe en ese mundo).
export function porParametro(lista, seccion) {
  const filas = new Map();
  for (const e of lista.filter((x) => x.seccion === seccion)) {
    const clave = `${e.id}\n${e.nombre}`;
    if (!filas.has(clave)) filas.set(clave, { id: e.id, nombre: e.nombre, celdas: { earth: null, moon: null, mars: null } });
    filas.get(clave).celdas[e.mundo] = e;
  }
  return [...filas.values()];
}
