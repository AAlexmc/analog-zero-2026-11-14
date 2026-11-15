// Lugar + mes (docs/metrica-analogos.md, «Meses»): nombres, mes en la URL, mejores meses, rachas y plan de repetición. Sin DOM.
import { fmtPct } from './metricas.js';

export const MESES_CORTO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MESES_LARGO = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
// Criterio propio («own threshold»): puntos por debajo del mejor lugar del mes a partir de los que conviene mover el ensayo.
export const MARGEN = 5;
const NUMEROS = ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven'];

const finito = (v) => typeof v === 'number' && Number.isFinite(v);
const esMes = (m) => Number.isInteger(m) && m >= 1 && m <= 12;
export const nombreMes = (m, largo = true) => (esMes(m) ? (largo ? MESES_LARGO : MESES_CORTO)[m - 1] : null);
const mesTras = (mes, n) => ((mes - 1 + n) % 12) + 1;

// Ausente o inválido = sin mes (año entero).
export function leerMes(q) {
  const s = q.get('mes');
  return s !== null && /^\d{1,2}$/.test(s) && esMes(Number(s)) ? Number(s) : null;
}
export function escribirMes(q, mes) {
  const out = new URLSearchParams(q);
  out.delete('mes');
  if (esMes(mes)) out.set('mes', String(mes));
  return out;
}
export const conMes = (href, mes) => (esMes(mes) ? `${href}${href.includes('?') ? '&' : '?'}mes=${mes}` : href);

// Ficheros mensuales que pide una búsqueda: los parámetros pedidos (o los de siempre) que tienen versión por mes.
export function idsMensuales(opc, indice) {
  const todos = [...indice.parametros, ...(indice.parametros_tierra ?? [])];
  const pedidos = opc?.parametros ?? indice.parametros.filter((p) => p.reproducible_en_tierra).map((p) => p.id);
  return pedidos.filter((id) => todos.find((p) => p.id === id)?.meses?.earth);
}

export function mejorYPeor(perfil) {
  const con = perfil.filter((p) => finito(p.similitud_pct));
  if (!con.length) return null;
  const max = Math.max(...con.map((p) => p.similitud_pct)), min = Math.min(...con.map((p) => p.similitud_pct));
  return { mejor: con.filter((p) => p.similitud_pct === max).map((p) => p.mes), peor: con.filter((p) => p.similitud_pct === min).map((p) => p.mes), max, min };
}

// Tramos de meses seguidos a menos de `corte` puntos del mejor mes; el año es circular (dic–ene seguidos).
export function rachas(perfil, corte) {
  const mp = mejorYPeor(perfil);
  if (!mp) return [];
  const dentro = perfil.map((p) => finito(p.similitud_pct) && mp.max - p.similitud_pct < corte);
  if (dentro.every(Boolean)) return [{ meses: perfil.map((p) => p.mes), texto: 'All year' }];
  // Se empieza justo después de un mes fuera: así un tramo que cruza diciembre sale entero.
  const inicio = dentro.indexOf(false) + 1;
  const out = [];
  let actual = null;
  for (let k = 0; k < 12; k++) {
    const i = (inicio + k) % 12;
    if (dentro[i]) (actual ??= []).push(i + 1);
    else if (actual) { out.push(actual); actual = null; }
  }
  if (actual) out.push(actual);
  const texto = (ms) => (ms.length === 1 ? MESES_CORTO[ms[0] - 1] : `${MESES_CORTO[ms[0] - 1]}–${MESES_CORTO[ms.at(-1) - 1]}`);
  return out.sort((a, b) => a[0] - b[0]).map((ms) => ({ meses: ms, texto: texto(ms) }));
}

// Fila de M.calendario con lugar: true si el lugar queda más de `margen` puntos por debajo del mejor del mes; null sin dato.
export function moverEnMes(f, margen = MARGEN) {
  if (!finito(f.similitud_pct) || !finito(f.en_lugar_pct)) return null;
  return f.similitud_pct - f.en_lugar_pct > margen;
}

export function planRepetir(calendario, mesInicio, mesesDespues, margen = MARGEN) {
  if (calendario?.length !== 12) throw new Error('el calendario debe tener 12 meses');
  if (!esMes(mesInicio)) throw new Error(`mes fuera de 1-12: ${mesInicio}`);
  if (!Number.isInteger(mesesDespues) || mesesDespues < 1 || mesesDespues > 11) throw new Error(`meses después fuera de 1-11: ${mesesDespues}`);
  const a = calendario[mesInicio - 1], mes = mesTras(mesInicio, mesesDespues), b = calendario[mes - 1];
  const pct = (v) => (finito(v) ? v : null);
  const mejor = finito(b.similitud_pct) ? { lat: b.lat, lon: b.lon, pct: b.similitud_pct } : null;
  const diferencia = mejor && finito(b.en_lugar_pct) ? mejor.pct - b.en_lugar_pct : null;
  return { primero: { mes: mesInicio, pct: pct(a.en_lugar_pct) }, repeticion: { mes, pct_aqui: pct(b.en_lugar_pct), mejor }, mover: diferencia !== null && diferencia > margen, diferencia, despues: mesesDespues, margen };
}

// Frase del plan; `donde` = texto ya formateado del mejor lugar del mes de la repetición (coordenadas y país).
export function fraseRepetir(plan, donde) {
  const { primero: a, repeticion: b } = plan;
  const inicio = `${nombreMes(a.mes)} here: ${a.pct === null ? 'cannot be compared (missing data)' : fmtPct(a.pct)}. ${NUMEROS[plan.despues - 1]} month${plan.despues === 1 ? '' : 's'} later, in ${nombreMes(b.mes)}, this place`;
  if (b.pct_aqui === null) return `${inicio} cannot be compared (missing data).`;
  const cambio = a.pct === null ? 'is at' : fmtPct(b.pct_aqui) === fmtPct(a.pct) ? 'stays at' : b.pct_aqui < a.pct ? 'drops to' : 'rises to';
  const ahora = `${inicio} ${cambio} ${fmtPct(b.pct_aqui)}`;
  if (!b.mejor) return `${ahora}; no other place on Earth can be compared then.`;
  if (!plan.mover) return `${ahora} ${cambio === 'drops to' ? 'but still holds' : 'and holds'} (within ${plan.margen} points of the best). Stay.`;
  return `${ahora}; the best place then is ${donde}, ${fmtPct(b.mejor.pct)}. Move the test.`;
}

// Tira de 12 meses de una tarjeta.
export function lineaMejorPeor(perfil) {
  const mp = mejorYPeor(perfil);
  const cortos = (ms) => ms.map((m) => MESES_CORTO[m - 1]).join(', ');
  return mp && `Best: ${cortos(mp.mejor)} · worst: ${cortos(mp.peor)}`;
}
export function lineaMesActivo(perfil, mes) {
  if (!esMes(mes)) return null;
  const mp = mejorYPeor(perfil), v = perfil[mes - 1]?.similitud_pct;
  if (!mp || !finito(v)) return `${nombreMes(mes)}: no data here`;
  if (v === mp.max) return `${nombreMes(mes)} is its best month`;
  return mp.max - v < 0.05 ? `${nombreMes(mes)}: level with its best month` : `${nombreMes(mes)}: ${(mp.max - v).toFixed(1)} points below its best month`;
}
export const etiquetaMes = (p) => (finito(p.similitud_pct) ? `${nombreMes(p.mes)}: ${fmtPct(p.similitud_pct)} match` : `${nombreMes(p.mes)}: no data`);
// Una sola escala de color para todas las tiras de la pantalla, para que se puedan comparar entre lugares.
export function escalaTiras(perfiles) {
  const v = perfiles.flat().map((p) => p.similitud_pct).filter(finito);
  return v.length ? { min: Math.min(...v), max: Math.max(...v) } : null;
}
