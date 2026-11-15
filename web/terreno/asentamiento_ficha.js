// Lectura de una pieza plantada en su celda, para la ficha que sale al pasar el ratón: cada fila con su valor y,
// cuando hay límite publicado, su veredicto. Sin DOM. Lo que no se mide se dice; nada se rellena.
import { cantidad, decimales, decimalesVeredicto } from './evaluar.js';
import { largoSombra, rumboTexto } from './sol.js';

export const PAR_BASE = 'base:';
export const esDeBase = (it) => typeof it?.par === 'string' && it.par.startsWith(PAR_BASE);

const VARIABLE = { pendiente_deg: 'Slope', iluminacion_frac: 'Illumination (map)', sombra_permanente: 'Permanent shadow', temp_k: 'Temperature', horas_en_sombra: 'Hours in shadow', distancia_recorrido_km: 'Drive distance', separacion_m: 'Distance' };
const OP = { '<=': '≤', '<': '<', '>=': '≥', '>': '>' };
const bits = (v) => { let k = 0; for (let x = v >>> 0; x; x &= x - 1) k++; return k; };
const metros = (v) => (v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)} km` : `${v.toFixed(v < 10 ? 1 : 0)} m`);

// Fila de un requisito del catálogo (la misma evaluación que la ficha lateral): valor aquí, límite y veredicto.
export function filaRequisito(r, nombreDe = (id) => id) {
  const q = r.req, dec = decimalesVeredicto(r, decimales(q.unidad));
  const nombre = q.variable === 'separacion_m' ? `Distance from ${nombreDe(q.respecto_a)}` : q.variable === 'temp_k' ? `Temperature (${q.op === '<=' || q.op === '<' ? 'max' : 'min'})` : (VARIABLE[q.variable] ?? q.variable);
  const limite = r.estado === 'sin_limite' ? null : `${OP[q.op] ?? q.op} ${cantidad(q.valor, q.unidad)}`;
  const id = `req:${q.variable}${q.respecto_a ? `:${q.respecto_a}` : ''}:${q.op}`;
  if (r.estado === 'ok') return { id, nombre, valor: cantidad(r.valor, q.unidad, dec), estado: 'ok', nota: `published limit ${limite}: OK` };
  if (r.estado === 'rompe') return { id, nombre, valor: cantidad(r.valor, q.unidad, dec), estado: 'rompe', nota: `published limit ${limite}: BREAKS by ${cantidad(r.exceso, q.unidad, dec)}` };
  if (r.estado === 'cota_inferior') return { id, nombre, valor: `≥ ${cantidad(r.valor, q.unidad, dec)}`, estado: 'nm', nota: `published limit ${limite}: lower bound only, cannot confirm` };
  if (r.estado === 'sin_limite') return { id, nombre, valor: '—', estado: 'nm', nota: 'no public limit' };
  return { id, nombre, valor: 'NOT MEASURED', estado: 'nm', nota: `${limite ? `published limit ${limite} · ` : ''}${r.motivo ?? 'not measured here'}` };
}

// d = { cuerpo, punto (el centro de la ventana es el punto elegido), desplazamiento: {este_m, sur_m}, rejilla, cota, pendiente: {valor, motivo}, evs: evaluarEquipo(...), nombreDe,
//       sol: {activo, el, az, polar, luz}, alto_m, altoSupuesto (modelo de diseño propio, sin medida publicada), dia: {v, soles, total, unidad, ahora} | null, capas: {iluminacion, temp_max} }
export function lecturaPieza(d) {
  const filas = [];
  // En un recorte polar el norte no está arriba del mapa: se da la distancia, sin rumbo.
  const { este_m, sur_m } = d.desplazamiento, lejos = Math.hypot(este_m, sur_m), ref = d.punto ? 'the point' : 'the window centre';
  filas.push({ id: 'lugar', nombre: 'Where', valor: lejos < 0.5 ? `at ${ref}` : `${metros(lejos)} ${d.rejilla ? 'from' : `${rumboTexto((Math.atan2(este_m, -sur_m) * 180) / Math.PI)} of`} ${ref}`, estado: null, nota: null });
  filas.push({ id: 'cota', nombre: 'Elevation', valor: Number.isFinite(d.cota) ? `${d.cota.toFixed(1)} m` : 'no data', estado: null, nota: null });
  const evs = d.evs ?? [];
  if (!evs.some((r) => r.req.variable === 'pendiente_deg')) {
    const p = d.pendiente?.valor;
    filas.push({ id: 'pendiente', nombre: 'Slope', valor: Number.isFinite(p) ? `${p.toFixed(1)}°` : 'NOT MEASURED', estado: Number.isFinite(p) ? null : 'nm', nota: Number.isFinite(p) ? 'no public slope limit for this system' : d.pendiente?.motivo ?? null });
  }
  for (const r of evs) filas.push(filaRequisito(r, d.nombreDe));
  const s = d.sol ?? {};
  if (s.activo && Number.isFinite(s.el)) {
    const arriba = s.el > 0;
    filas.push({ id: 'sol', nombre: 'Sun now', valor: arriba ? `${s.el.toFixed(1)}° high${s.polar || !Number.isFinite(s.az) ? '' : `, to the ${rumboTexto(s.az)}`}` : `${Math.abs(s.el).toFixed(1)}° below the horizon`, estado: null, nota: arriba ? (s.polar ? 'height set in Display: it changes with the season' : null) : 'night' });
    filas.push({ id: 'luz', nombre: 'Light on it now', valor: s.luz ? 'sunlit' : arriba ? 'in the shadow of the terrain' : 'in the dark', estado: null, nota: null });
    const largo = s.luz ? largoSombra(d.alto_m, s.el) : null;
    if (largo) filas.push({ id: 'sombra', nombre: 'Its shadow now', valor: metros(largo), estado: null, nota: `on flat ground; it is ${d.alto_m.toFixed(1)} m tall${d.altoSupuesto ? ' (assumed: own design)' : ''}` });
  } else filas.push({ id: 'sol', nombre: 'Sun now', valor: Number.isFinite(s.el) ? `set by hand, ${s.el.toFixed(1)}° high` : '—', estado: null, nota: 'press Play in Day to follow the real Sun hour by hour' });
  let tira = null;
  if (d.dia) {
    const { v, soles, total, unidad, ahora } = d.dia, luz = bits(v);
    tira = Array.from({ length: total }, (_, k) => ({ c: (v >>> k) & 1 ? 'sol' : soles[k] && soles[k].el > 0 ? 'sombra' : 'noche', ahora: k === ahora }));
    filas.push({ id: 'dia', nombre: 'Sunlit through its day', valor: `${luz} of ${total} ${unidad}`, estado: null, nota: null, luz, total });
  } else filas.push({ id: 'dia', nombre: 'Sunlit through its day', valor: d.diaMotivo ?? 'working it out…', estado: 'nm', nota: null });
  for (const [k, nombre, fmt] of [['iluminacion', 'Mean illumination (map)', (x) => `${Math.round(100 * x)} %`], ['temp_max', 'Max temperature (map)', (x) => `${x.toFixed(0)} K`]]) {
    const x = d.capas?.[k];
    if (x === undefined) continue;
    filas.push({ id: k, nombre, valor: Number.isFinite(x) ? fmt(x) : 'no data', estado: null, nota: null });
  }
  if (d.sinModelo) filas.push({ id: 'modelo', nombre: '3D model', valor: 'none: marker only', estado: 'nm', nota: 'no published size to draw it to scale' });
  return { cuerpo: d.cuerpo, filas, tira };
}

// Dos lecturas (este mundo y su gemelo) alineadas por fila: la del otro lado puede no tener alguna.
export function alinear(a, b) {
  const ids = [...new Set([...a.filas.map((f) => f.id), ...(b?.filas ?? []).map((f) => f.id)])];
  return ids.map((id) => ({ id, a: a.filas.find((f) => f.id === id) ?? null, b: b?.filas.find((f) => f.id === id) ?? null }));
}

// Resumen de una base en un panel: piezas, cuántas rompen un límite publicado y cuáles.
export function resumenBase(piezas) {
  const rompen = piezas.filter((x) => x.rompe);
  return { total: piezas.length, rompen: rompen.length, nombres: rompen.map((x) => x.nombre) };
}
