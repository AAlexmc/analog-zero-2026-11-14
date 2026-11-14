// Requisito del catálogo + medidas en un punto del terreno → veredicto; comparación Luna/Tierra. Sin DOM.
import { pendienteGrados } from './calculo.js';

const NOMBRE_CAPA = { iluminacion: 'illumination', sombra_permanente: 'permanent-shadow', temp_max: 'temperature', temp_min: 'temperature' };

// Criterio propio (no viene de ninguna fuente): margen dentro del cual la Tierra «reproduce» la condición lunar.
export const MARGEN = {
  pendiente_deg: { abs: 1, rel: 0.1 },
  iluminacion_frac: { abs: 0.05, rel: 0 },
  sombra_permanente: { abs: 0, rel: 0 },
  temp_k: { abs: 10, rel: 0.05 },
  separacion_m: { abs: 25, rel: 0.05 },
  horas_en_sombra: { abs: 5, rel: 0.1 },
  distancia_recorrido_km: { abs: 1, rel: 0.1 },
};

export const margenComparacion = (variable, valorLuna) => {
  const m = MARGEN[variable] ?? { abs: 0, rel: 0.1 };
  return Math.max(m.abs, m.rel * Math.abs(valorLuna));
};

const fmtM = (x) => `${Math.round(x)}`;

function capaEnPunto(capas, nombre, i) {
  const v = capas?.[nombre];
  if (!v) return { valor: null, motivo: `no ${NOMBRE_CAPA[nombre] ?? nombre} layer on this terrain` };
  const x = v[i];
  if (!Number.isFinite(x)) return { valor: null, motivo: `no data in the ${nombre} layer at this point` };
  return { valor: x, como: `${nombre} layer value at this cell`, capa: nombre };
}

function baseDerivada(a, n, i, paso, hayAntes, hayDespues, m) {
  const ant = hayAntes && Number.isFinite(a[i - paso]), des = hayDespues && Number.isFinite(a[i + paso]);
  return ant && des ? 2 * m : m;
}

// t = {n, m_por_px, alturas (las que se ven), capas: {nombre: Float32Array}, original?}; ruta = medidas que solo da una ruta.
export function medirPunto(t, fila, col, ruta = {}) {
  const { n, m_por_px: m, alturas, capas } = t;
  const f = Math.min(n - 1, Math.max(0, Math.round(fila))), c = Math.min(n - 1, Math.max(0, Math.round(col)));
  const i = f * n + c;
  const pend = pendienteGrados(alturas, n, m, f, c);
  const bx = baseDerivada(alturas, n, i, 1, c > 0, c < n - 1, m), by = baseDerivada(alturas, n, i, n, f > 0, f < n - 1, m);
  const base = bx === by ? `${fmtM(bx)} m` : `${fmtM(Math.min(bx, by))}–${fmtM(Math.max(bx, by))} m`;
  const sinRuta = { valor: null, motivo: 'needs a route' };
  const tmax = capas?.temp_max ? capaEnPunto(capas, 'temp_max', i) : { valor: null, motivo: 'no temperature layer on this terrain' };
  const tmin = capas?.temp_min ? capaEnPunto(capas, 'temp_min', i) : { valor: null, motivo: 'no minimum-temperature layer on this terrain' };
  // El DEM da la superficie del agua: su pendiente no es la del suelo.
  const agua = capas?.agua ? capas.agua[i] : null;
  return {
    agua,
    pendiente_deg: agua >= 1 ? { valor: null, motivo: 'water surface, not ground' } : Number.isFinite(pend)
      ? { valor: pend, como: `${t.original ? 'original' : 'retouched'} DEM slope over ${base}, DEM ${m.toFixed(2)} m/px (coarser than the equipment)` }
      : { valor: null, motivo: 'no elevation data at this point' },
    iluminacion_frac: capaEnPunto(capas, 'iluminacion', i),
    sombra_permanente: capaEnPunto(capas, 'sombra_permanente', i),
    temp_k: { max: tmax, min: tmin },
    horas_en_sombra: ruta.horas_en_sombra ?? sinRuta,
    distancia_recorrido_km: ruta.distancia_recorrido_km ?? sinRuta,
  };
}

// Distancia en el plano del mapa al equipo `respectoA` más cercano del mismo panel (sin contarse a sí mismo).
export function medirSeparacion(plantados, yo, respectoA, m_por_px, nombreDe) {
  let mejor = Infinity;
  for (const q of plantados) {
    if (q.equipo !== respectoA || q.uid === yo.uid) continue;
    mejor = Math.min(mejor, Math.hypot(q.fila - yo.fila, q.col - yo.col) * m_por_px);
  }
  if (!Number.isFinite(mejor)) return { valor: null, motivo: `plant a ${nombreDe(respectoA)} to evaluate` };
  return { valor: mejor, como: `straight line on the map plane to the nearest planted ${nombreDe(respectoA)}` };
}

const superior = (op) => op === '<=' || op === '<';
const CUMPLE = { '<=': (v, l) => v <= l, '<': (v, l) => v < l, '>=': (v, l) => v >= l, '>': (v, l) => v > l };

function medidaDe(req, medidas) {
  if (req.variable === 'separacion_m') return medidas.separacion_m?.[req.respecto_a] ?? { valor: null, motivo: 'no separation measured' };
  if (req.variable === 'temp_k') {
    const t = medidas.temp_k;
    if (!t) return { valor: null, motivo: 'no temperature layer on this terrain' };
    if (superior(req.op)) return t.max;
    if (Number.isFinite(t.min?.valor)) return t.min;
    // Solo hay máxima: si ya la máxima no llega al mínimo exigido, la mínima tampoco.
    if (Number.isFinite(t.max?.valor) && !CUMPLE[req.op](t.max.valor, req.valor)) {
      return { valor: t.max.valor, como: 'maximum temperature is already below this lower limit', capa: t.max.capa };
    }
    if (Number.isFinite(t.max?.valor)) return { valor: null, motivo: 'needs the minimum temperature; only a max-temperature layer here' };
    return t.max;
  }
  if (!(req.variable in MARGEN)) return { valor: null, motivo: `"${req.variable}" is not measured by this viewer` };
  return medidas[req.variable] ?? { valor: null, motivo: 'not measured' };
}

export function evaluarRequisito(req, medidas) {
  const base = { req, variable: req.variable, op: req.op, limite: req.valor, unidad: req.unidad, valor: null, exceso: null, motivo: null, como: null, capa: null };
  if (req.valor === null || req.valor === undefined) return { ...base, estado: 'sin_limite', motivo: req.texto ?? 'no public limit' };
  const md = medidaDe(req, medidas);
  if (!CUMPLE[req.op]) return { ...base, estado: 'no_medido', motivo: `unknown operator ${req.op}` };
  if (md.valor === null || md.valor === undefined) return { ...base, estado: 'no_medido', motivo: md.motivo ?? 'not measured' };
  if (!Number.isFinite(md.valor)) return { ...base, estado: 'no_medido', motivo: 'no data at this point' };
  const ok = CUMPLE[req.op](md.valor, req.valor);
  const cota = md.cota === 'inferior' ? 'inferior' : null;
  const extra = { valor: md.valor, como: md.como ?? null, capa: md.capa ?? null, cota, notaCota: cota ? md.notaCota ?? null : null, adicional: md.adicional ?? null };
  // Una cota inferior solo demuestra lo que ya incumple un tope o ya cumple un mínimo.
  if (cota && (superior(req.op) ? ok : !ok)) return { ...base, ...extra, estado: 'cota_inferior' };
  return { ...base, ...extra, estado: ok ? 'ok' : 'rompe', exceso: ok ? 0 : Math.abs(md.valor - req.valor) };
}

export const evaluarEquipo = (equipo, medidas) => (equipo.requisitos ?? []).map((r) => evaluarRequisito(r, medidas));

// lectura: reproducido | infra (la Tierra se queda corta) | sobre (la Tierra es más dura) | no_medible
export function compararRequisito(req, evLuna, evTierra) {
  const l = evLuna?.valor, t = evTierra?.valor;
  if (!Number.isFinite(l) || !Number.isFinite(t)) {
    const ml = evLuna?.motivo ?? 'not measured', mt = evTierra?.motivo ?? 'not measured';
    const motivo = Number.isFinite(l) ? `Earth: ${mt}` : Number.isFinite(t) ? `Moon: ${ml}` : ml === mt ? ml : `Moon: ${ml}; Earth: ${mt}`;
    return { lectura: 'no_medible', luna: l ?? null, tierra: t ?? null, margen: null, motivo };
  }
  const margen = margenComparacion(req.variable, l);
  const d = (t - l) * (superior(req.op) ? 1 : -1);
  const lectura = Math.abs(t - l) <= margen ? 'reproducido' : d > 0 ? 'sobre' : 'infra';
  const cota = evLuna?.cota === 'inferior' || evTierra?.cota === 'inferior';
  return { lectura, luna: l, tierra: t, margen, motivo: cota ? 'compares lower bounds at catalogue speed; the real values are higher' : null };
}

// Texto plano (quien lo meta en HTML lo escapa).
export const cantidad = (v, u, dec) => {
  if (!Number.isFinite(v)) return '—';
  const t = dec === undefined ? String(+v.toFixed(3)) : v.toFixed(dec);
  if (u === 'deg') return `${t}°`;
  if (u === 'm' && Math.abs(v) >= 1000) return `${(v / 1000).toFixed(2 + (dec ?? 0))} km`;
  return `${t}${u ? ` ${u}` : ''}`;
};
export const decimales = (u) => (u === 'fraction' || u === '0/1' ? 2 : u === 'm' ? 0 : 1);

// Decimales para que lo mostrado no contradiga el veredicto: valor distinto del límite y exceso distinto de 0.
export function decimalesVeredicto(r, dec) {
  const { valor, limite, unidad: u, exceso } = r;
  if (!Number.isFinite(valor) || !Number.isFinite(limite) || valor === limite) return dec;
  let d = dec;
  while (d < 6 && (cantidad(valor, u, d) === cantidad(limite, u, d) || (exceso > 0 && +exceso.toFixed(d) === 0))) d++;
  return d;
}

// El menor número con d decimales que no queda por debajo de x.
export function redondearArriba(x, d) {
  const s = +x.toFixed(d);
  return s < x ? +(s + 10 ** -d).toFixed(d) : s;
}

export function notaBasesPendiente(mLuna, mTierra) {
  if (mLuna === mTierra) return null;
  return `slopes measured over different baselines: MOON over ${fmtM(2 * mLuna)} m (DEM ${mLuna.toFixed(2)} m/px), EARTH over ${fmtM(2 * mTierra)} m (DEM ${mTierra.toFixed(2)} m/px); not resampled, so the slope comparison is approximate`;
}

// m³ → número de cargas de excavadora para un rango de densidades aparentes; null sin densidad o sin carga.
export function cargasExcavadora(volumen_m3, densidades, kgPorCarga) {
  if (!densidades?.length || !(kgPorCarga > 0)) return null;
  const v = densidades.map((d) => (volumen_m3 * d) / kgPorCarga);
  return { min: Math.min(...v), max: Math.max(...v) };
}
