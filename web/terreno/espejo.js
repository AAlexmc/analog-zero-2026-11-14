// Equipo espejo: lo que se planta en un panel se planta también en el otro, a la misma distancia y rumbo del centro
// de su ventana, y se comparan las dos celdas. Sin DOM. Los márgenes son criterio propio (se rotulan en pantalla).
import { margenComparacion } from './evaluar.js';

export const MARGEN_SOL_DEG = 5;
export const MARGEN_LUZ_FRAC = 0.1;

// origen = {n, m}; destino = {n, m, alturas}. Devuelve la celda del destino con dato más cercana a la simétrica, o null.
export function celdaEspejo(origen, destino, fila, col) {
  const ko = (origen.n - 1) / 2, kd = (destino.n - 1) / 2, n = destino.n;
  const este_m = (col - ko) * origen.m, sur_m = (fila - ko) * origen.m;
  const f0 = kd + sur_m / destino.m, c0 = kd + este_m / destino.m;
  const f = Math.min(n - 1, Math.max(0, Math.round(f0))), c = Math.min(n - 1, Math.max(0, Math.round(c0)));
  const recortado = Math.abs(f - f0) > 0.5 || Math.abs(c - c0) > 0.5;
  const hay = (ff, cc) => Number.isFinite(destino.alturas[ff * n + cc]);
  const base = { este_m, sur_m, recortado };
  if (hay(f, c)) return { ...base, fila: f, col: c, movido: false };
  for (let r = 1; r < n; r++) {
    let mejor = null;
    for (let ff = Math.max(0, f - r); ff <= Math.min(n - 1, f + r); ff++) for (let cc = Math.max(0, c - r); cc <= Math.min(n - 1, c + r); cc++) {
      if (Math.max(Math.abs(ff - f), Math.abs(cc - c)) !== r || !hay(ff, cc)) continue;
      const d = Math.hypot(ff - f, cc - c);
      if (!mejor || d < mejor.d) mejor = { d, fila: ff, col: cc };
    }
    if (mejor) return { ...base, fila: mejor.fila, col: mejor.col, movido: true };
  }
  return null;
}

// rejilla = true cuando algún panel no tiene el norte arriba (recorte polar): se dice en ejes del mapa, no en rumbos.
export function textoDesplazamiento({ este_m, sur_m }, rejilla = false) {
  const p = (v, pos, neg) => (Math.abs(v) < 0.5 ? null : `${Math.round(Math.abs(v))} m ${v > 0 ? pos : neg}`);
  const partes = (rejilla ? [p(este_m, 'right', 'left'), p(sur_m, 'down', 'up')] : [p(este_m, 'east', 'west'), p(sur_m, 'south', 'north')]).filter(Boolean);
  return partes.length ? `${partes.join(' and ')} ${rejilla ? 'from the window centre on the map' : 'of the window centre'}` : 'at the window centre';
}

const grados = (v) => `${v.toFixed(1)}°`;
const noMed = (id, nombre, a, b, motivo) => ({ id, nombre, a, b, lectura: 'no_medible', nota: motivo });

// Cada lado: {cuerpo, pendiente: {valor, motivo}, sol: {el, luz}, dia: {luz, total, unidad} | null, capas: {iluminacion, temp_max}}.
// a = el otro mundo (Luna o Marte), b = la Tierra cuando la hay: el margen de la pendiente se mide sobre a.
export function filasEspejo(a, b, limites = []) {
  const filas = [];
  const pa = a.pendiente?.valor, pb = b.pendiente?.valor;
  if (Number.isFinite(pa) && Number.isFinite(pb)) {
    const mg = margenComparacion('pendiente_deg', pa);
    filas.push({ id: 'pendiente', nombre: 'Slope', a: grados(pa), b: grados(pb), lectura: Math.abs(pa - pb) <= mg ? 'igual' : 'distinto',
      nota: Math.abs(pa - pb) <= mg ? `within ± ${grados(mg)}` : `${b.cuerpo} is ${pb > pa ? 'steeper' : 'gentler'} by ${grados(Math.abs(pb - pa))}` });
  } else filas.push(noMed('pendiente', 'Slope', Number.isFinite(pa) ? grados(pa) : '—', Number.isFinite(pb) ? grados(pb) : '—', a.pendiente?.motivo ?? b.pendiente?.motivo ?? 'no elevation data'));
  for (const l of limites) {
    if (l.parametro !== 'pendiente_grados' || !Number.isFinite(pa) || !Number.isFinite(pb)) continue;
    const ok = (v) => (l.tipo === 'max' ? v <= l.valor : v >= l.valor), ta = ok(pa) ? 'within' : 'outside', tb = ok(pb) ? 'within' : 'outside';
    filas.push({ id: 'limite_pendiente', nombre: `Published slope limit (${l.tipo === 'max' ? '≤' : '≥'} ${l.valor}°)`, a: ta, b: tb, lectura: ta === tb ? 'igual' : 'distinto',
      nota: ta === tb ? `${ta} the limit in both places` : `${ta === 'outside' ? a.cuerpo : b.cuerpo} breaks it, ${ta === 'outside' ? b.cuerpo : a.cuerpo} does not` });
  }
  const ea = a.sol?.el, eb = b.sol?.el;
  if (Number.isFinite(ea) && Number.isFinite(eb)) {
    const d = Math.abs(ea - eb);
    filas.push({ id: 'sol', nombre: 'Sun height now', a: grados(ea), b: grados(eb), lectura: d <= MARGEN_SOL_DEG ? 'igual' : 'distinto',
      nota: d <= MARGEN_SOL_DEG ? `within ± ${MARGEN_SOL_DEG}°` : `the Sun is ${eb > ea ? 'higher' : 'lower'} on ${b.cuerpo} by ${grados(d)}` });
    const la = a.sol.luz, lb = b.sol.luz, t = (v) => (v ? 'sunlit' : 'in shadow');
    if (typeof la === 'boolean' && typeof lb === 'boolean') filas.push({ id: 'luz', nombre: 'Light on it now', a: t(la), b: t(lb), lectura: la === lb ? 'igual' : 'distinto', nota: la === lb ? null : `${t(la)} on ${a.cuerpo}, ${t(lb)} on ${b.cuerpo}` });
  }
  if (a.dia && b.dia) {
    const fa = a.dia.luz / a.dia.total, fb = b.dia.luz / b.dia.total, t = (d) => `${d.luz} of ${d.total} ${d.unidad}`;
    filas.push({ id: 'dia', nombre: 'Sunlit share of its day', a: t(a.dia), b: t(b.dia), lectura: Math.abs(fa - fb) <= MARGEN_LUZ_FRAC ? 'igual' : 'distinto',
      nota: Math.abs(fa - fb) <= MARGEN_LUZ_FRAC ? `within ± ${MARGEN_LUZ_FRAC * 100} % of the day` : `${Math.round(100 * fa)} % of the day on ${a.cuerpo}, ${Math.round(100 * fb)} % on ${b.cuerpo}` });
  }
  for (const [k, nombre, fmt] of [['iluminacion', 'Mean illumination (yearly map)', (v) => v.toFixed(2)], ['temp_max', 'Max temperature (map)', (v) => `${v.toFixed(0)} K`]]) {
    const va = a.capas?.[k], vb = b.capas?.[k];
    if (va === undefined && vb === undefined) continue;
    const f = (v) => (Number.isFinite(v) ? fmt(v) : '—');
    if (Number.isFinite(va) && Number.isFinite(vb)) continue;
    const sin = [va === undefined ? a.cuerpo : null, vb === undefined ? b.cuerpo : null].filter(Boolean);
    filas.push(noMed(k, nombre, f(va), f(vb), sin.length ? `no such map for the ${sin.join(' or ')} terrain here` : 'no data at this cell'));
  }
  return filas;
}

export function resumenEspejo(filas) {
  const de = (l) => filas.filter((f) => f.lectura === l).map((f) => f.nombre);
  return { igual: de('igual'), distinto: de('distinto'), no_medible: de('no_medible') };
}
