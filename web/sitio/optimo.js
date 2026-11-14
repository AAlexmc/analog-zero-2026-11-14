// Mejor sitio para una base: los límites hacen de máscara, los pesos se ordenan con TOPSIS (reparto.js)
// y las alternativas guardan una distancia mínima entre sí. Sin DOM: lo usan la página, el worker y los tests.
import { topsis } from '../terreno/reparto.js';
import { normLon, distanciaAngular } from '../explorar/geo.js';

const RAD = Math.PI / 180;
export const CUMPLE = { '<=': (v, l) => v <= l, '<': (v, l) => v < l, '>=': (v, l) => v >= l, '>': (v, l) => v > l };
export const esLimite = (c) => c.tipo === 'limite' || c.tipo === 'limite+peso';
export const esPeso = (c) => c.tipo === 'peso' || c.tipo === 'limite+peso';
export const PESO_INICIAL = 0.5;

const leerFetch = async (url, tipo) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return tipo === 'json' ? r.json() : r.arrayBuffer();
};

export const cargarIndice = (base, leer = leerFetch) => leer(`${base}indice.json`, 'json');

// Capas float32 little-endian, fila 0 arriba, NaN = sin dato. radio_km: el del mundo (mundos.json).
export async function cargarMundo(indice, id, base, { radio_km, leer = leerFetch } = {}) {
  const d = indice?.mundos?.[id];
  if (!d) return null;
  const g = d.rejilla;
  const [filas, cols] = g.tipo === 'polar' ? [g.n, g.n] : [g.alto, g.ancho];
  const N = filas * cols;
  const f32 = async (ruta) => {
    const a = new Float32Array(await leer(`${base}${ruta}`, 'bin'));
    if (a.length !== N) throw new Error(`${ruta}: ${a.length} cells, grid has ${N}`);
    return a;
  };
  const capas = Object.fromEntries(await Promise.all(d.criterios.map(async (c) => [c.id, await f32(c.capa)])));
  const [lat, lon] = g.tipo === 'polar' ? await Promise.all([f32(g.lat), f32(g.lon)]) : [null, null];
  return { id, ambito: d.ambito, rejilla: g, criterios: d.criterios, no_medidos: d.no_medidos ?? [], capas, lat, lon, filas, cols, N, radio_km };
}

export function ajustesPorDefecto(M) {
  return {
    limites: Object.fromEntries(M.criterios.filter(esLimite).map((c) => [c.id, c.limite?.valor ?? null])),
    pesos: Object.fromEntries(M.criterios.filter(esPeso).map((c) => [c.id, PESO_INICIAL])),
  };
}

// Criterio propio: 5 % del ancho del recorte en la rejilla polar; 1000 km en la global.
export function separacionPorDefecto(M) {
  const g = M.rejilla;
  return g.tipo === 'polar' ? { km: (0.05 * g.n * g.m_por_px) / 1000, origen: 'mío' } : { km: 1000, origen: 'mío' };
}

export function latLonDe(M, i) {
  if (M.rejilla.tipo === 'polar') return { lat: M.lat[i], lon: M.lon[i] };
  const g = M.rejilla, f = Math.floor(i / M.cols), c = i % M.cols;
  return { lat: g.lat0 - f * g.paso_deg, lon: normLon(g.lon0 + c * g.paso_deg) };
}

function distanciaKm(M, i, j) {
  if (M.rejilla.tipo === 'polar') return (Math.hypot(Math.floor(i / M.cols) - Math.floor(j / M.cols), (i % M.cols) - (j % M.cols)) * M.rejilla.m_por_px) / 1000;
  const a = latLonDe(M, i), b = latLonDe(M, j);
  return distanciaAngular(a.lat, a.lon, b.lat, b.lon) * RAD * M.radio_km;
}

function limitesActivos(M, ajustes) {
  return M.criterios.filter((c) => esLimite(c) && CUMPLE[c.limite?.op]).flatMap((c) => {
    const v = ajustes.limites?.[c.id];
    if (v === null || v === undefined || v === '' || !Number.isFinite(Number(v))) return [];
    return [{ c, op: c.limite.op, valor: Number(v), capa: M.capas[c.id] }];
  });
}

function sitio(M, i, puntuacion, limites) {
  return {
    i, fila: Math.floor(i / M.cols), col: i % M.cols, ...latLonDe(M, i), puntuacion,
    valores: Object.fromEntries(M.criterios.map((c) => [c.id, M.capas[c.id][i]])),
    cumple: Object.fromEntries(limites.map((l) => { const v = l.capa[i]; return [l.c.id, Number.isFinite(v) ? CUMPLE[l.op](v, l.valor) : null]; })),
  };
}

// ajustes = { limites: {id: valor | null (apagado)}, pesos: {id: 0..1} }. Determinista: a igual puntuación gana la celda de índice menor.
export function mejorSitio(M, ajustes, { separacion_km = separacionPorDefecto(M).km, cuantos = 5 } = {}) {
  const { N } = M;
  const limites = limitesActivos(M, ajustes);
  const pesos = M.criterios.filter(esPeso).map((c) => ({ c, peso: Number(ajustes.pesos?.[c.id] ?? 0), capa: M.capas[c.id], beneficio: c.sentido === 'mas' })).filter((p) => p.peso > 0);
  const todas = M.criterios.map((c) => M.capas[c.id]);
  const fallos = new Float64Array(limites.length);
  const cand = new Uint32Array(N);
  // Superficie de cada celda: cos(lat) en la rejilla global; igual para todas en la polar (recorte de 6°).
  const g = M.rejilla, cosFila = g.tipo === 'polar' ? null : Float64Array.from({ length: M.filas }, (_, f) => Math.cos((g.lat0 - f * g.paso_deg) * RAD));
  let nArea = 0, nAptas = 0, nc = 0, sArea = 0, sAptas = 0;
  for (let i = 0; i < N; i++) {
    let dato = false;
    for (let k = 0; !dato && k < todas.length; k++) dato = Number.isFinite(todas[k][i]);
    if (!dato) continue;
    const w = cosFila ? cosFila[Math.floor(i / M.cols)] : 1;
    nArea++; sArea += w;
    let ok = true;
    for (let k = 0; k < limites.length; k++) {
      const l = limites[k], v = l.capa[i];
      if (!(Number.isFinite(v) && CUMPLE[l.op](v, l.valor))) { fallos[k]++; ok = false; }
    }
    if (!ok) continue;
    nAptas++; sAptas += w;
    for (let k = 0; ok && k < pesos.length; k++) ok = Number.isFinite(pesos[k].capa[i]);
    if (ok) cand[nc++] = i;
  }
  let descartadoPor = null;
  limites.forEach((l, k) => { if (fallos[k] > 0 && (!descartadoPor || fallos[k] > descartadoPor.n)) descartadoPor = { id: l.c.id, nombre: l.c.nombre, n: fallos[k] }; });
  const base = {
    mejor: null, alternativas: [], aptas: { n: nAptas, frac: nArea ? nAptas / nArea : 0, fracArea: sArea ? sAptas / sArea : 0, de: nArea }, candidatos: nc,
    usados: {
      limites: limites.map((l) => ({ id: l.c.id, op: l.op, valor: l.valor, nasa: l.c.limite.valor, origen: l.c.limite.origen, cambiado: l.valor !== l.c.limite.valor })),
      pesos: pesos.map((p) => ({ id: p.c.id, peso: p.peso, sentido: p.c.sentido })),
    },
    descartadoPor, separacion: { km: separacion_km, origen: 'mío' }, motivo: null,
  };
  if (!pesos.length) return { ...base, motivo: 'sin_pesos' };
  if (!nAptas) return { ...base, motivo: 'sin_aptas' };
  if (!nc) return { ...base, motivo: 'sin_dato' };

  const k = pesos.length, X = new Float64Array(nc * k);
  for (let a = 0; a < nc; a++) for (let j = 0; j < k; j++) X[a * k + j] = pesos[j].capa[cand[a]];
  const C = topsis(X, nc, pesos.map((p) => p.peso), pesos.map((p) => p.beneficio));
  // Equivale a recorrer de mayor a menor puntuación y saltar las que caen cerca de otra ya elegida.
  const elegidos = [];
  while (elegidos.length < cuantos) {
    let mejor = -1, mc = -Infinity;
    for (let a = 0; a < nc; a++) {
      if (!(C[a] > mc)) continue;
      const i = cand[a];
      if (elegidos.some((e) => distanciaKm(M, e.i, i) < separacion_km)) continue;
      mejor = a; mc = C[a];
    }
    if (mejor < 0) break;
    elegidos.push(sitio(M, cand[mejor], C[mejor], limites));
  }
  return { ...base, mejor: elegidos[0], alternativas: elegidos.slice(1) };
}

const xyzDe = new WeakMap();
function celdaPolar(M, lat, lon) {
  let xyz = xyzDe.get(M);
  if (!xyz) {
    xyz = new Float64Array(M.N * 3).fill(NaN);
    for (let i = 0; i < M.N; i++) {
      const f = M.lat[i] * RAD, l = M.lon[i] * RAD;
      if (Number.isFinite(f) && Number.isFinite(l)) { xyz[3 * i] = Math.cos(f) * Math.cos(l); xyz[3 * i + 1] = Math.cos(f) * Math.sin(l); xyz[3 * i + 2] = Math.sin(f); }
    }
    xyzDe.set(M, xyz);
  }
  const f = lat * RAD, l = lon * RAD, x = Math.cos(f) * Math.cos(l), y = Math.cos(f) * Math.sin(l), z = Math.sin(f);
  let mejor = -1, md = -Infinity;
  for (let i = 0; i < M.N; i++) {
    const d = xyz[3 * i] * x + xyz[3 * i + 1] * y + xyz[3 * i + 2] * z;
    if (d > md) { md = d; mejor = i; }
  }
  // Más lejos que 1,5 celdas: fuera del recorte.
  const tol = (1.5 * M.rejilla.m_por_px) / 1000 / M.radio_km;
  return mejor >= 0 && Math.acos(Math.min(1, md)) <= tol ? mejor : -1;
}

// Valores de cada criterio en la celda de (lat, lon) y si cumple cada límite activo (null = sin dato). null fuera de la rejilla.
export function valoresEn(M, lat, lon, ajustes) {
  let i;
  if (M.rejilla.tipo === 'polar') i = celdaPolar(M, lat, lon);
  else {
    const g = M.rejilla;
    const f = Math.min(M.filas - 1, Math.max(0, Math.round((g.lat0 - lat) / g.paso_deg)));
    const c = ((Math.round((normLon(lon) - g.lon0) / g.paso_deg) % M.cols) + M.cols) % M.cols;
    i = f * M.cols + c;
  }
  if (i < 0) return null;
  return sitio(M, i, null, limitesActivos(M, ajustes));
}
