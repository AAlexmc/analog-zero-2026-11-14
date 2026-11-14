// Modo «test conditions»: de condiciones.json y cond_*.png a selección, valores, veredictos y colores. Sin DOM.
import { byteDe } from './png.js';
import { valorByte } from './rejilla.js';
import { colorRampa, COLOR } from './capas.js';

const ENTORNO = { oscuridad_max_h: 'continuous darkness', sol_rasante_h_ano: 'grazing sun (lunar polar elevations)', t_min_alcanzable_k: 'coldest air temperature' };
const NOTA = { terreno: 'measured on the 3D terrain', no_evaluado: 'not evaluated' };
const LOG_MIN = 10;

export function leerCond(search) {
  const q = new URLSearchParams(search);
  const acc = q.get('acc') === null || q.get('acc').trim() === '' ? NaN : Number(q.get('acc'));
  return { modo: q.get('modo') === 'cond' ? 'cond' : 'ranking', eq: q.get('eq'), req: q.get('req'), acc: Number.isFinite(acc) && acc >= 0 ? acc : null };
}

export function escribirCond(base, { modo, eq, req, acc }) {
  if (modo !== 'cond') return base;
  const q = new URLSearchParams(base);
  q.set('modo', 'cond');
  if (eq) q.set('eq', eq);
  if (req !== null && req !== undefined) q.set('req', req);
  if (Number.isFinite(acc)) q.set('acc', String(acc));
  return `?${q.toString()}`;
}

export function canalDe(man, id) {
  for (const [fichero, lista] of Object.entries(man?.canales ?? {})) {
    const k = lista.findIndex((c) => c.id === id && !c.vacio);
    if (k >= 0) return { fichero, indice: k, meta: lista[k] };
  }
  return null;
}

export function opcionesRequisito(man, eqId) {
  const eq = man.equipos.find((e) => e.id === eqId);
  const reqs = eq?.requisitos ?? [];
  const txt = (r) => r.texto ?? `${r.variable} ${r.op} ${r.valor ?? '?'} ${r.unidad ?? ''}`;
  return {
    evaluables: reqs.filter((r) => r.tratamiento === 'condicion').map((r) => ({ valor: String(r.indice), texto: r.prueba ?? txt(r), req: r })),
    otros: reqs.filter((r) => r.tratamiento !== 'condicion').map((r) => ({ valor: String(r.indice), texto: txt(r), nota: NOTA[r.tratamiento] ?? 'not evaluated', req: r })),
    entorno: Object.keys(ENTORNO).filter((id) => canalDe(man, id)).map((id) => ({ valor: `env:${id}`, texto: `Environment · ${ENTORNO[id]}` })),
  };
}

export function seleccion(man, eqId, reqClave) {
  const eq = man.equipos.find((e) => e.id === eqId) ?? man.equipos.find((e) => e.id === 'ltv') ?? man.equipos[0];
  const o = opcionesRequisito(man, eq.id);
  if (typeof reqClave === 'string' && reqClave.startsWith('env:') && o.entorno.some((x) => x.valor === reqClave)) {
    return { eq, req: null, clave: reqClave, canal: reqClave.slice(4) };
  }
  const r = o.evaluables.find((x) => x.valor === reqClave) ?? o.evaluables[0];
  if (r) return { eq, req: r.req, clave: r.valor, canal: r.req.condicion };
  const env = o.entorno.find((x) => x.valor === 'env:sol_rasante_h_ano') ?? o.entorno[0];
  return { eq, req: null, clave: env.valor, canal: env.valor.slice(4) };
}

// Valor de la condición en la celda; null si océano o sin dato. Las condiciones de latitud salen exactas de por_latitud.
export function valorCondicion(man, id, fila, col, imgs) {
  const c = canalDe(man, id);
  const img = c && imgs[c.fichero];
  if (!img) return null;
  const x = valorByte(byteDe(img, fila, col, c.indice), c.meta);
  if (x.tipo !== 'valor') return null;
  const exacta = c.meta.por_latitud ? man.por_latitud?.[id]?.[fila] : undefined;
  return Number.isFinite(exacta) ? exacta : x.v;
}

const alcanza = (r, x) => (r.sentido === '>=' ? x >= r.valor : x <= r.valor);

export function veredictoCelda(r, x) {
  if (r.tratamiento !== 'condicion') return { veredicto: r.tratamiento, fraccion: null, falta: null };
  if (!Number.isFinite(x)) return { veredicto: 'no_data', fraccion: null, falta: null };
  if (r.veredicto_global === 'not_reachable') return { veredicto: 'not_reachable', fraccion: null, falta: Math.abs(x - r.valor) };
  if (alcanza(r, x)) return { veredicto: 'reaches', fraccion: 1, falta: 0 };
  return { veredicto: 'partial', fraccion: r.sentido === '>=' ? x / r.valor : null, falta: Math.abs(x - r.valor) };
}

export function textoVeredicto(r, v) {
  switch (v.veredicto) {
    case 'reaches': return 'reaches';
    case 'partial': return v.fraccion !== null ? `partial (${Math.round(v.fraccion * 100)} %)` : `partial (${fmtNum(v.falta)} ${r.unidad} short)`;
    case 'not_reachable': return 'not reachable on Earth';
    case 'terreno': return NOTA.terreno;
    case 'no_data': return 'no data';
    default: return NOTA.no_evaluado;
  }
}

const fmtNum = (x) => (Math.abs(x) >= 100 ? Math.round(x).toLocaleString('en-US') : String(Number(x.toFixed(1))));

export function fmtValor(x, unidad) {
  return Number.isFinite(x) ? `${fmtNum(x)}${unidad ? ` ${unidad}` : ''}` : '—';
}

const fmtLat = (x) => `${Math.abs(x).toFixed(2)}° ${x < 0 ? 'S' : 'N'}`;

export function lineaResumen(r) {
  if (!r) return '';
  if (r.veredicto_global === 'not_reachable') {
    const ext = Number.isFinite(r.extremo_tierra) ? ` (${r.sentido === '<=' ? 'coldest' : 'highest'} land cell ${r.extremo_tierra.toFixed(1)} ${r.unidad})` : '';
    return `${r.prueba}: not reachable in the field — chamber only${ext}`;
  }
  if (r.veredicto_global !== 'reaches') return `${r.prueba}: no data`;
  const lat = r.lat_umbral ? [r.lat_umbral.norte !== null ? `north of ${fmtLat(r.lat_umbral.norte)}` : null, r.lat_umbral.sur !== null ? `south of ${fmtLat(r.lat_umbral.sur)}` : null].filter(Boolean).join(' / ') : '';
  return `${r.prueba}: ${r.pct_tierra.toFixed(1)} % of land${lat ? `, ${lat}` : ''}`;
}

// RGBA del mapa (océano transparente), máscara de celdas que alcanzan el requisito y dominio de la rampa.
export function colorearCond({ man, canal, imgs, req, acc }) {
  const c = canalDe(man, canal), img = imgs[c.fichero], n = img.ancho * img.alto;
  const tierra = canalDe(man, 'oscuridad_max_h');
  const acceso = canalDe(man, 'tiempo_ciudad_h');
  const rgba = new Uint8ClampedArray(n * 4), mask = new Uint8Array(n);
  const vals = new Float64Array(n).fill(NaN);
  const cuenta = { sin_dato: 0, lejos: 0, sin_acceso: 0 };
  let lo = Infinity, hi = -Infinity;
  for (let f = 0; f < img.alto; f++) {
    for (let k = 0; k < img.ancho; k++) {
      const i = f * img.ancho + k;
      if (byteDe(imgs[tierra.fichero], f, k, tierra.indice) === 255) continue;
      const v = valorCondicion(man, canal, f, k, imgs);
      if (v === null) continue;
      vals[i] = v;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  const log = canal === 'oscuridad_max_h';
  const a = log ? Math.log10(LOG_MIN) : lo, b = log ? Math.log10(Math.max(hi, LOG_MIN * 10)) : hi;
  const t = (v) => (log ? (Math.log10(Math.max(v, LOG_MIN)) - a) / (b - a) : b > a ? (v - a) / (b - a) : 0.5);
  for (let f = 0; f < img.alto; f++) {
    for (let k = 0; k < img.ancho; k++) {
      const i = f * img.ancho + k, o = i * 4;
      if (byteDe(imgs[tierra.fichero], f, k, tierra.indice) === 255) continue;
      const v = vals[i], ajedrez = (f + k) & 1;
      let col;
      const tAcc = Number.isFinite(acc) && acceso ? valorCondicion(man, 'tiempo_ciudad_h', f, k, imgs) : undefined;
      if (Number.isNaN(v)) { col = COLOR.sinDato[ajedrez]; cuenta.sin_dato++; }
      else if (tAcc === null) { col = COLOR.sinDato[ajedrez]; cuenta.sin_acceso++; }
      else if (tAcc !== undefined && tAcc > acc) { col = COLOR.falla; cuenta.lejos++; }
      else col = colorRampa(t(v));
      if (req && req.tratamiento === 'condicion' && req.condicion === canal && req.veredicto_global === 'reaches' && Number.isFinite(v) && alcanza(req, v)) mask[i] = 1;
      rgba[o] = col[0]; rgba[o + 1] = col[1]; rgba[o + 2] = col[2]; rgba[o + 3] = 255;
    }
  }
  return { rgba, alcanza: mask, dominio: [lo, hi], log, logMin: LOG_MIN, cuenta };
}

// Una fila por requisito del equipo, en el orden del catálogo.
export function filasHoja(man, eq, fila, col, imgs) {
  return (eq?.requisitos ?? []).map((r) => {
    const valor = r.tratamiento === 'condicion' ? valorCondicion(man, r.condicion, fila, col, imgs) : null;
    const v = veredictoCelda(r, valor);
    return { req: r, valor, ...v, texto: textoVeredicto(r, v), rompe: v.veredicto === 'not_reachable' };
  });
}
