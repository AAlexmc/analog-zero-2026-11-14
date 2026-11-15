// Búsqueda por objetivo de misión (docs/contrato-misiones.md): parámetros, sitio de referencia, resumen por lugar y estado en la URL. Sin DOM.
import { agrupar } from './metricas.js';

export const ID_NUEVA = 'nueva';
export const TITULO_MAX = 60;
const CLAVES_URL = ['mision', 'titulo', 'p', 'ref'];
const MUNDO = { moon: 'Moon', mars: 'Mars' };
const finito = (v) => typeof v === 'number' && Number.isFinite(v);

// Parámetros que se pueden pedir al motor, en el orden del índice: los comparables con la Luna/Marte y los solo-Tierra.
export const comparables = (indice) => [...indice.parametros.filter((p) => p.reproducible_en_tierra), ...(indice.parametros_tierra ?? [])];
const enOrden = (ids, indice) => { const s = new Set(ids); return comparables(indice).map((p) => p.id).filter((id) => s.has(id)); };

export const parametrosDe = (mision, indice) => enOrden((mision.caracteristicas ?? []).filter((c) => c.medido === true).flatMap((c) => c.parametros ?? []), indice);

export const elegible = (mision, indice) => mision.respaldo !== 'no_encontrado' && parametrosDe(mision, indice).length > 0;

// Misiones que se ofrecen para un mundo: las que NASA liga a él (o a ninguno); `conservar` = id que se deja aunque sea de otro.
export const misionesDe = (misiones, mundo, conservar = null) => misiones.filter((m) => !(m.cuerpo ?? []).length || m.cuerpo.includes(mundo) || m.id === conservar);

export function textoOpcion(mision, mundo, indice) {
  if (mision.respaldo === 'no_encontrado') return `${mision.nombre} — no public NASA source found`;
  if (!elegible(mision, indice)) return `${mision.nombre} — nothing we can measure`;
  const cuerpos = mision.cuerpo ?? [];
  return cuerpos.includes(mundo) || cuerpos.length !== 1 ? mision.nombre : `${mision.nombre} — ${MUNDO[cuerpos[0]] ?? cuerpos[0]} only`;
}

export function referenciaDe(mision, sitios = []) {
  const c = (mision.campanas ?? []).find((x) => finito(x.lat) && finito(x.lon));
  if (!c) return null;
  const s = c.sitio ? sitios.find((x) => x.id === c.sitio) : null;
  return { lat: c.lat, lon: c.lon, nombre: s?.nombre ?? c.sitio_texto ?? c.nombre, sitio: c.sitio ?? null };
}

export const noMedidas = (mision) => (mision.caracteristicas ?? []).filter((c) => c.medido === false).map((c) => ({ id: c.id, nombre: c.nombre, motivo: c.motivo }));

export const sitiosReferencia = (sitios) => (sitios ?? []).filter((s) => finito(s?.lat) && finito(s?.lon)).map((s) => ({ id: s.id, nombre: s.nombre, lat: s.lat, lon: s.lon }));

// Por lugar: solo cuentan los parámetros con dato en los dos lados (estado 'ok').
export function resumenLugar(x) {
  const g = agrupar(x.parametros.filter((p) => p.estado === 'ok' || p.estado === 'sin_dato_tierra'));
  const ids = (l) => l.map((p) => p.id);
  return { comparados: g.cerca.length + g.medio.length + g.lejos.length, cerca: ids(g.cerca), medio: ids(g.medio), lejos: ids(g.lejos), sin: ids(g.sin) };
}

export function lineaResumen(r, corto) {
  if (!r.comparados) return 'No parameter could be compared here.';
  const lista = (ids) => ids.map(corto).join(', ');
  return [`${r.cerca.length} of ${r.comparados} parameter${r.comparados === 1 ? '' : 's'} close`,
    r.medio.length ? `partly: ${lista(r.medio)}` : null,
    r.lejos.length ? `far off: ${lista(r.lejos)}` : null].filter(Boolean).join(' · ');
}

export function validarNueva({ titulo, parametros }, indice) {
  const t = [...String(titulo ?? '').trim()].slice(0, TITULO_MAX).join('').trim();
  const ps = enOrden(parametros ?? [], indice);
  return { ok: t.length > 0 && ps.length > 0, titulo: t, parametros: ps };
}

const soloDeLaTierra = (ids, indice) => { const t = new Set((indice.parametros_tierra ?? []).map((p) => p.id)); return ids.length > 0 && ids.every((id) => t.has(id)); };

// Una misión que solo nombra rasgos de la Tierra no diría nada del punto elegido (y miles de celdas empatarían al 100 %):
// la búsqueda añade entonces todos los parámetros comparados con el punto, y la ficha lo dice (`ampliada`).
export function activaDeCatalogo(mision, indice, sitios) {
  const propios = parametrosDe(mision, indice), ampliada = soloDeLaTierra(propios, indice);
  const parametros = ampliada ? [...indice.parametros.filter((p) => p.reproducible_en_tierra).map((p) => p.id), ...propios] : propios;
  return { tipo: 'catalogo', id: mision.id, titulo: mision.nombre, mision, parametros, ampliada, referencia: referenciaDe(mision, sitios) };
}

export function activaNueva({ titulo, parametros, ref }, indice, sitios) {
  const v = validarNueva({ titulo, parametros }, indice);
  if (!v.ok) return null;
  const s = sitiosReferencia(sitios).find((x) => x.id === ref) ?? null;
  return { tipo: 'nueva', id: ID_NUEVA, titulo: v.titulo, mision: null, parametros: v.parametros, sinPunto: soloDeLaTierra(v.parametros, indice), ref: s?.id ?? null, referencia: s && { lat: s.lat, lon: s.lon, nombre: s.nombre, sitio: s.id } };
}

// Id desconocido, misión sin fuente o misión nueva incompleta → null (sin misión, sin error).
export function leerEstado(q, catalogo, indice, sitios) {
  const id = q.get('mision');
  if (!id) return null;
  if (id === ID_NUEVA) return activaNueva({ titulo: q.get('titulo'), parametros: (q.get('p') ?? '').split(',').map((s) => s.trim()).filter(Boolean), ref: q.get('ref') }, indice, sitios);
  const m = (catalogo ?? []).find((x) => x.id === id);
  return m && elegible(m, indice) ? activaDeCatalogo(m, indice, sitios) : null;
}

export function escribirEstado(q, activa) {
  const out = new URLSearchParams(q);
  for (const k of CLAVES_URL) out.delete(k);
  if (!activa) return out;
  out.set('mision', activa.id);
  if (activa.tipo === 'nueva') {
    out.set('titulo', activa.titulo);
    out.set('p', activa.parametros.join(','));
    if (activa.ref) out.set('ref', activa.ref);
  }
  return out;
}

// Enlace entre la pantalla del mundo y resultados con la misión al final; sin misión, el enlace tal cual.
export function conMision(href, activa) {
  const s = escribirEstado(new URLSearchParams(), activa).toString();
  return s ? `${href}${href.includes('?') ? '&' : '?'}${s}` : href;
}

export function opcionesBusqueda(activa) {
  if (!activa) return {};
  return activa.referencia ? { parametros: activa.parametros, referencia: { lat: activa.referencia.lat, lon: activa.referencia.lon } } : { parametros: activa.parametros };
}

export function frasesNoUsados(r, activa, corto) {
  const lista = (ids) => ids.map(corto).join(', ');
  return [
    r.sin_referencia?.length ? `Not used, ${activa?.referencia ? 'no data at the test site' : activa?.tipo === 'nueva' ? 'no test site picked' : 'no test site with coordinates'}: ${lista(r.sin_referencia)}.` : null,
    r.sin_dato?.length ? `Not used, no data at your point: ${lista(r.sin_dato)}.` : null,
  ].filter(Boolean);
}
