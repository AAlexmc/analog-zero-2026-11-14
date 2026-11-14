// Del manifiesto (capas.json) a la lista de capas de un par, y de bytes a colores. Sin DOM.
import { byteDe } from './png.js';
import { valorByte, estadoCelda, NA, SIN_DATO } from './rejilla.js';
import { PALETA, mezclar } from '../marca/contraste.js';

// Todo sale de la paleta de marca (mezclas con alfa incluidas). Sin rojos: el rojo es solo para «se rompe».
const hex = (n) => [1, 3, 5].map((i) => parseInt(PALETA[n].slice(i, i + 2), 16));
const mezcla = (c, a, f) => mezclar(c, a, f).map(Math.round);
export const RAMPA = [[0, hex('electric-blue')], [0.5, hex('blue-yonder')], [1, hex('white')]];
// Sin puntuar: deep blue translúcido (falla una puerta) o rayado (no evaluable, sin dato); n/a más claro. Ninguno cae en la rampa.
const RAYADO = [hex('deep-blue'), mezcla('white', 0.4, 'deep-blue')];
export const COLOR = { falla: mezcla('deep-blue', 0.8, 'white'), noEval: RAYADO, na: mezcla('deep-blue', 0.5, 'white'), sinDato: RAYADO };
const CATEGORIAS = [hex('blue-yonder'), hex('neon-yellow'), hex('white'), hex('neon-blue'), mezcla('neon-yellow', 0.5, 'electric-blue'),
  hex('electric-blue'), mezcla('blue-yonder', 0.5, 'white'), mezcla('neon-yellow', 0.5, 'deep-blue')];
// Rayas diagonales de dos celdas.
export const raya = (f, c) => ((f + c) >> 1) & 1;

const numDim = (id) => Number(id.slice(1));

export function objetivosDe(m) {
  const out = [];
  for (const p of m?.pares ?? []) {
    let o = out.find((x) => x.id === p.objetivo);
    if (!o) out.push((o = { id: p.objetivo, nombre: p.nombre_objetivo ?? p.objetivo, pares: [] }));
    o.pares.push(p);
  }
  return out;
}

export function dimensionesConPeso(par) {
  return Object.keys(par?.pesos ?? {}).filter((d) => /^D\d+$/.test(d)).sort((a, b) => numDim(a) - numDim(b));
}

// Capas del par en orden: S y sus percentiles, dimensiones con peso, variables crudas.
export function capasDePar(m, par) {
  const canales = m?.canales ?? {};
  const capas = [];
  const sF = par.ficheros.s;
  (canales[sF] ?? []).forEach((c, i) => { if (!c.vacio) capas.push({ id: c.id, grupo: 'puntuacion', fichero: sF, canal: i, meta: c }); });
  const pesos = par.pesos ?? {};
  const dims = [];
  for (const f of par.ficheros.dim ?? []) {
    (canales[f] ?? []).forEach((c, i) => { if (!c.vacio && c.id in pesos) dims.push({ id: c.id, grupo: 'dimension', fichero: f, canal: i, meta: c, peso: pesos[c.id] }); });
  }
  dims.sort((a, b) => numDim(a.id) - numDim(b.id));
  capas.push(...dims);
  for (const f of Object.keys(canales).filter((k) => /^var_/.test(k)).sort()) {
    canales[f].forEach((c, i) => { if (!c.vacio) capas.push({ id: c.id, grupo: 'variable', fichero: f, canal: i, meta: c }); });
  }
  return capas;
}

export function colorRampa(t) {
  const x = Math.min(1, Math.max(0, t));
  for (let k = 1; k < RAMPA.length; k++) {
    const [t1, c1] = RAMPA[k];
    if (x <= t1) {
      const [t0, c0] = RAMPA[k - 1], u = (x - t0) / (t1 - t0);
      return c0.map((v, j) => Math.round(v + (c1[j] - v) * u));
    }
  }
  return RAMPA[RAMPA.length - 1][1];
}

export function rampaCSS() {
  return `linear-gradient(90deg, ${RAMPA.map(([t, c]) => `rgb(${c.join(',')}) ${t * 100}%`).join(', ')})`;
}

export function colorCategoria(codigo) {
  return CATEGORIAS[codigo % CATEGORIAS.length];
}

// Pinta una capa en RGBA (océano transparente). Devuelve también el dominio de la rampa y lo que aparece.
export function colorear(capa, img, imgS, imgC) {
  const n = img.ancho * img.alto, rgba = new Uint8ClampedArray(n * 4);
  const fija01 = capa.grupo !== 'variable';
  let lo = Infinity, hi = -Infinity;
  const clases = new Set();
  const cuenta = { falla: 0, no_evaluable: 0, na: 0, sin_dato: 0 };
  if (!fija01 && !/^litologia/.test(capa.id)) {
    for (let i = 0; i < n; i++) {
      if (imgC.datos[i * imgC.canales + 1] === SIN_DATO) continue;
      const b = img.datos[i * img.canales + capa.canal];
      if (b <= 250) { const v = valorByte(b, capa.meta).v; if (v < lo) lo = v; if (v > hi) hi = v; }
    }
  }
  const dominio = fija01 ? [0, 1] : [lo, hi];
  const ancho = hi > lo ? hi - lo : 1;
  for (let f = 0; f < img.alto; f++) {
    for (let c = 0; c < img.ancho; c++) {
      const i = f * img.ancho + c, o = i * 4;
      const sR = byteDe(imgS, f, c, 0), cG = byteDe(imgC, f, c, 1);
      const est = estadoCelda(sR, cG);
      if (est === 'oceano') continue;
      const b = byteDe(img, f, c, capa.canal);
      const ajedrez = raya(f, c);
      let col;
      if (capa.grupo === 'puntuacion' && est === 'falla_puerta') { col = COLOR.falla; cuenta.falla++; }
      else if (capa.grupo === 'puntuacion' && est === 'no_evaluable') { col = COLOR.noEval[ajedrez]; cuenta.no_evaluable++; }
      else if (b === NA) { col = COLOR.na; cuenta.na++; }
      else if (b > 250) { col = COLOR.sinDato[ajedrez]; cuenta.sin_dato++; }
      else {
        const v = valorByte(b, capa.meta);
        if (v.tipo === 'clase') { clases.add(v.codigo); col = colorCategoria(v.codigo); }
        else col = colorRampa(fija01 ? v.v : (v.v - lo) / ancho);
      }
      rgba[o] = col[0]; rgba[o + 1] = col[1]; rgba[o + 2] = col[2]; rgba[o + 3] = 255;
    }
  }
  return { rgba, dominio, clases: [...clases].sort((a, b) => a - b), cuenta };
}

// Muestras de estado de la leyenda: n = celdas pintadas así en la capa cargada; nValidacion = cifra del manifiesto (sin el sur de −60° salvo McMurdo).
export function estadosLeyenda(capa, cuenta, par) {
  if (capa.grupo === 'puntuacion') {
    return [
      { id: 'falla', color: COLOR.falla, texto: 'fails a gate', n: cuenta.falla, nValidacion: par?.n_fallan_puerta },
      { id: 'no_evaluable', color: COLOR.noEval, texto: 'not evaluable', n: cuenta.no_evaluable, nValidacion: par?.n_no_evaluables },
    ];
  }
  return [{ id: 'na', color: COLOR.na, texto: 'n/a', n: cuenta.na }, { id: 'sin_dato', color: COLOR.sinDato, texto: 'no data', n: cuenta.sin_dato }].filter((f) => f.n);
}

// Máscara de tierra a partir del canal G de c_* (océano = 255).
export function mascaraTierra(imgC) {
  const n = imgC.ancho * imgC.alto, t = new Uint8Array(n);
  for (let i = 0; i < n; i++) t[i] = imgC.datos[i * imgC.canales + 1] === SIN_DATO ? 0 : 1;
  return t;
}
