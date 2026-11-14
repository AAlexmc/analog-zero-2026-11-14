// Recorridos sobre la rejilla de alturas (retocada): pendiente de celda, A*/Dijkstra con 8 vecinos, medidas y orden de visita. Sin DOM.
import { pendienteGrados } from './calculo.js';

const S2 = Math.SQRT2;
const RAD = Math.PI / 180;
const DF = [-1, -1, -1, 0, 0, 1, 1, 1], DC = [-1, 0, 1, -1, 1, -1, 0, 1];
const CLASES_VEHICULO = new Set(['movilidad', 'prospeccion', 'excavacion']);

export function pendientes(a, n, m) {
  const out = new Float32Array(n * n);
  for (let f = 0; f < n; f++) for (let c = 0; c < n; c++) out[f * n + c] = pendienteGrados(a, n, m, f, c);
  return out;
}

// Montículo binario de mínimos con duplicados perezosos (se descartan al sacarlos si ya están cerrados).
class Monticulo {
  constructor(cap) { this.k = new Float64Array(cap); this.v = new Int32Array(cap); this.n = 0; }
  meter(key, val) {
    if (this.n === this.k.length) {
      const k = new Float64Array(this.n * 2), v = new Int32Array(this.n * 2);
      k.set(this.k); v.set(this.v); this.k = k; this.v = v;
    }
    const K = this.k, V = this.v;
    let i = this.n++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (K[p] <= key) break;
      K[i] = K[p]; V[i] = V[p]; i = p;
    }
    K[i] = key; V[i] = val;
  }
  sacar() {
    const K = this.k, V = this.v, top = V[0];
    this.clave = K[0];
    const n = --this.n, key = K[n], val = V[n];
    let i = 0;
    for (;;) {
      let h = 2 * i + 1;
      if (h >= n) break;
      if (h + 1 < n && K[h + 1] < K[h]) h++;
      if (K[h] >= key) break;
      K[i] = K[h]; V[i] = V[h]; i = h;
    }
    K[i] = key; V[i] = val;
    return top;
  }
}

// Carretera aplicada: cada par de celdas consecutivas de una traza es un tramo que se juzga por su pendiente longitudinal.
function tramosCarretera(carreteras) {
  if (!carreteras?.length) return null;
  const T = new Map();
  const une = (a, b) => { let s = T.get(a); if (!s) T.set(a, (s = new Set())); s.add(b); };
  for (const cam of carreteras) for (let k = 0; k + 1 < cam.length; k++) if (cam[k] !== cam[k + 1]) { une(cam[k], cam[k + 1]); une(cam[k + 1], cam[k]); }
  return T.size ? T : null;
}
const esTramo = (T, i, j) => !!T && !!T.get(i)?.has(j);
const pendPaso = (alturas, i, j, L) => Math.atan(Math.abs(alturas[j] - alturas[i]) / L) / RAD;

function preparar(t, opc) {
  const { n, m, alturas } = t;
  const pend = t.pend ?? pendientes(alturas, n, m);
  const lim = opc.limite;
  const fs = Math.max(1, opc.factorSombra ?? 1);
  const sombra = fs !== 1 ? t.sombra : null;
  const agua = t.agua;
  const suelo = (i) => Number.isFinite(alturas[i]) && !(agua && agua[i] >= 1);
  const T = tramosCarretera(opc.carreteras);
  return {
    n, m, alturas, pend, lim, fs, sombra, pasa: (i) => Number.isFinite(alturas[i]) && pend[i] <= lim && !(agua && agua[i] >= 1),
    enCarretera: (i) => !!T && T.has(i) && suelo(i),
    pasaTramo: (i, j, L) => esTramo(T, i, j) && suelo(j) && pendPaso(alturas, i, j, L) <= lim,
  };
}

// Coste de un paso = distancia 3D × media del factor de sombra de sus dos celdas.
// destinos con un solo elemento → A* con distancia octil (admisible y consistente); varios → Dijkstra.
function buscar(t, origen, destinos, opc) {
  const P = preparar(t, opc);
  const { n, m, alturas, pasa, fs, sombra, enCarretera, pasaTramo } = P;
  const N = n * n;
  const g = new Float64Array(N).fill(Infinity), padre = new Int32Array(N).fill(-1), cerrado = new Uint8Array(N);
  const entra = (i) => pasa(i) || enCarretera(i);
  const quedan = new Set(destinos.filter(entra));
  if (!entra(origen)) return { g, padre, abortado: false };
  const uno = destinos.length === 1 ? destinos[0] : -1;
  const fd = uno >= 0 ? Math.floor(uno / n) : 0, cd = uno >= 0 ? uno % n : 0;
  const heur = uno >= 0 ? (i) => { const a = Math.abs(Math.floor(i / n) - fd), b = Math.abs((i % n) - cd); return m * (Math.max(a, b) + (S2 - 1) * Math.min(a, b)); } : () => 0;
  const w = (i) => (sombra && sombra[i] === 1 ? fs : 1);
  const t0 = Date.now(), limiteMs = opc.limiteMs ?? Infinity;
  const H = new Monticulo(1 << 16);
  g[origen] = 0;
  H.meter(heur(origen), origen);
  let iter = 0;
  while (H.n && quedan.size) {
    const i = H.sacar();
    if (cerrado[i]) continue;
    cerrado[i] = 1;
    quedan.delete(i);
    if ((++iter & 0xffff) === 0 && Date.now() - t0 > limiteMs) return { g, padre, abortado: true };
    const f = Math.floor(i / n), c = i % n, hi = alturas[i], wi = w(i), gi = g[i];
    for (let k = 0; k < 8; k++) {
      const ff = f + DF[k], cc = c + DC[k];
      if (ff < 0 || cc < 0 || ff >= n || cc >= n) continue;
      const j = ff * n + cc;
      if (cerrado[j]) continue;
      const L = (DF[k] && DC[k] ? S2 : 1) * m;
      if (!pasa(j) && !pasaTramo(i, j, L)) continue;
      const dh = alturas[j] - hi;
      const v = gi + Math.sqrt(L * L + dh * dh) * (wi + w(j)) / 2;
      if (v < g[j]) { g[j] = v; padre[j] = i; H.meter(v + heur(j), j); }
    }
  }
  return { g, padre, abortado: false };
}

function reconstruir(padre, origen, destino) {
  const out = [destino];
  for (let i = destino; i !== origen; ) { i = padre[i]; out.push(i); }
  return Int32Array.from(out.reverse());
}

// t = {n, m, alturas, pend?, sombra?}; opc = {limite (°), factorSombra ≥ 1, limiteMs?, carreteras? (trazas aplicadas)}
export function caminoMinimo(t, origen, destino, opc) {
  const r = buscar(t, origen, [destino], opc);
  if (r.abortado) return { coste: NaN, camino: null, abortado: true };
  const coste = r.g[destino];
  if (!Number.isFinite(coste)) return { coste: Infinity, camino: null };
  return { coste, camino: reconstruir(r.padre, origen, destino) };
}

// Menor pendiente límite con la que origen y destino quedarían conectados (camino de cuello mínimo).
// Con carreteras, un tramo de carretera cuenta por su pendiente longitudinal y una celda de carretera vale como origen.
export function umbralMinimo(t, origen, destino, opc = {}) {
  const { n, m, alturas, agua } = t;
  const pend = t.pend ?? pendientes(alturas, n, m);
  const ok = (i) => Number.isFinite(alturas[i]) && Number.isFinite(pend[i]) && !(agua && agua[i] >= 1);
  const T = tramosCarretera(opc.carreteras);
  const suelo = (i) => Number.isFinite(alturas[i]) && !(agua && agua[i] >= 1);
  const enCarretera = (i) => !!T && T.has(i) && suelo(i);
  if (!(ok(origen) || enCarretera(origen)) || !(ok(destino) || enCarretera(destino))) return Infinity;
  const best = new Float64Array(n * n).fill(Infinity), cerrado = new Uint8Array(n * n);
  const H = new Monticulo(1 << 16);
  best[origen] = enCarretera(origen) ? 0 : pend[origen];
  H.meter(best[origen], origen);
  while (H.n) {
    const i = H.sacar();
    if (cerrado[i]) continue;
    if (i === destino) return best[i];
    cerrado[i] = 1;
    const f = Math.floor(i / n), c = i % n;
    for (let k = 0; k < 8; k++) {
      const ff = f + DF[k], cc = c + DC[k];
      if (ff < 0 || cc < 0 || ff >= n || cc >= n) continue;
      const j = ff * n + cc;
      if (cerrado[j]) continue;
      let cj = ok(j) ? pend[j] : Infinity;
      if (esTramo(T, i, j) && suelo(j)) cj = Math.min(cj, pendPaso(alturas, i, j, (DF[k] && DC[k] ? S2 : 1) * m));
      if (cj === Infinity) continue;
      const v = Math.max(best[i], cj);
      if (v < best[j]) { best[j] = v; H.meter(v, j); }
    }
  }
  return Infinity;
}

// Matriz de costes par a par (simétrica: el coste de un paso no depende del sentido) y el camino de cada par.
export function matrizCostes(t, puntos, opc) {
  const k = puntos.length;
  const M = Array.from({ length: k }, () => new Array(k).fill(0));
  const caminos = Array.from({ length: k }, () => new Array(k).fill(null));
  for (let a = 0; a < k - 1; a++) {
    const destinos = puntos.slice(a + 1);
    const r = buscar(t, puntos[a], destinos, opc);
    for (let b = a + 1; b < k; b++) {
      const c = r.g[puntos[b]];
      M[a][b] = M[b][a] = Number.isFinite(c) ? c : Infinity;
      if (Number.isFinite(c)) {
        const cam = reconstruir(r.padre, puntos[a], puntos[b]);
        caminos[a][b] = cam;
        caminos[b][a] = Int32Array.from(cam).reverse();
      }
    }
  }
  return { M, caminos };
}

// Ida y vuelta al primero; exacto por permutaciones con poda.
// Cota: cada parada aún sin visitar tiene que salir una vez, como poco por su arista más barata.
export function ordenOptimo(M) {
  const k = M.length;
  if (k === 1) return { orden: [0], coste: 0 };
  const minSal = M.map((fila, i) => Math.min(...fila.filter((_, j) => j !== i)));
  let mejor = Infinity, mejorOrden = null;
  const orden = [0], usado = new Array(k).fill(false);
  usado[0] = true;
  const rec = (ult, coste, resto) => {
    if (orden.length === k) {
      const total = coste + M[ult][0];
      if (total < mejor) { mejor = total; mejorOrden = orden.slice(); }
      return;
    }
    for (let j = 1; j < k; j++) {
      if (usado[j]) continue;
      const c = coste + M[ult][j];
      if (!(c + resto < mejor)) continue;
      usado[j] = true; orden.push(j);
      rec(j, c, resto - minSal[j]);
      orden.pop(); usado[j] = false;
    }
  };
  rec(0, 0, minSal.slice(1).reduce((a, b) => a + b, 0));
  return Number.isFinite(mejor) ? { orden: mejorOrden, coste: mejor } : null;
}

// Medidas sobre la ruta: longitud 3D, desnivel, pendiente de celda (máx y p95) y sombra permanente.
// Cada paso reparte su longitud a medias entre sus dos celdas para contar la sombra.
// Con opc.carreteras, las celdas de un tramo de carretera salen de la pendiente de celda y se da el paso más empinado de la carretera.
export function medirRuta(t, camino, opc = {}) {
  const { n, m, alturas, sombra } = t;
  const k = camino.length;
  const pendDe = (i) => (t.pend ? t.pend[i] : pendienteGrados(alturas, n, m, Math.floor(i / n), i % n));
  const pasos = new Float64Array(Math.max(k - 1, 0));
  const T = tramosCarretera(opc.carreteras), enTramo = T ? new Uint8Array(k) : null;
  let longitud = 0, subida = 0, bajada = 0, pasosC = 0, pendC = -Infinity;
  for (let s = 0; s < k - 1; s++) {
    const a = camino[s], b = camino[s + 1];
    const L = (Math.floor(a / n) !== Math.floor(b / n) && a % n !== b % n ? S2 : 1) * m;
    const dh = alturas[b] - alturas[a];
    pasos[s] = Math.sqrt(L * L + dh * dh);
    longitud += pasos[s];
    if (dh > 0) subida += dh; else bajada -= dh;
    if (esTramo(T, a, b)) { enTramo[s] = enTramo[s + 1] = 1; pasosC++; pendC = Math.max(pendC, pendPaso(alturas, a, b, L)); }
  }
  const ps = Array.from(camino, (i, s) => (enTramo?.[s] ? NaN : pendDe(i))).filter(Number.isFinite).sort((x, y) => x - y);
  const out = {
    longitud_m: longitud, subida_m: subida, bajada_m: bajada, celdas: k,
    pendMax: ps.length ? ps[ps.length - 1] : NaN,
    pendP95: ps.length ? ps[Math.max(0, Math.ceil(0.95 * ps.length) - 1)] : NaN,
    sombra_m: null, sombraFrac: null, sombraTramoMax_m: null, sombraSinDato_m: null,
  };
  if (T) out.carretera = { pasos: pasosC, pendMax: pasosC ? pendC : NaN, celdas: enTramo.reduce((x, v) => x + v, 0) };
  if (!sombra) return out;
  let enSombra = 0, sinDato = 0, tramo = 0, tramoMax = 0;
  for (let s = 0; s < k; s++) {
    const parte = ((s > 0 ? pasos[s - 1] : 0) + (s < k - 1 ? pasos[s] : 0)) / 2;
    const v = sombra[camino[s]];
    if (v === 1) { enSombra += parte; tramo += parte; tramoMax = Math.max(tramoMax, tramo); } else {
      tramo = 0;
      if (!Number.isFinite(v)) sinDato += parte;
    }
  }
  out.sombra_m = enSombra;
  out.sombraFrac = longitud > 0 ? enSombra / longitud : 0;
  out.sombraTramoMax_m = tramoMax;
  out.sombraSinDato_m = sinDato;
  return out;
}

const A_KMH = { 'km/h': 1, 'm/s': 3.6, 'cm/s': 0.036 };

// Solo una velocidad máxima o nominal con fuente verificada y sin operador (un «más de» no es una velocidad).
export function velocidadCatalogo(equipo) {
  const vale = (c) => /^velocidad_(max|nominal)(_|$)/.test(c.nombre ?? '') && Number.isFinite(c.valor) && c.valor > 0
    && c.verificado === true && c.fuente && !c.op && A_KMH[c.unidad];
  const cs = (equipo?.cifras ?? []).filter(vale);
  const c = cs.find((x) => /^velocidad_max/.test(x.nombre)) ?? cs[0];
  if (!c) return null;
  return { kmh: c.valor * A_KMH[c.unidad], tipo: /^velocidad_max/.test(c.nombre) ? 'top' : 'nominal', cifra: c };
}

// Segunda velocidad citada («speed made good»): solo como dato adicional, nunca para un veredicto.
export function velocidadEfectiva(equipo) {
  const c = (equipo?.cifras ?? []).find((x) => /^velocidad_efectiva(_|$)/.test(x.nombre ?? '') && Number.isFinite(x.valor) && x.valor > 0
    && x.verificado === true && x.fuente && !x.op && A_KMH[x.unidad]);
  return c ? { kmh: c.valor * A_KMH[c.unidad], cifra: c } : null;
}

const fmtH = (h) => `${h >= 10 ? h.toFixed(0) : h.toFixed(1)} h`;

// Tramo continuo más largo en sombra permanente ÷ velocidad de catálogo: cota inferior de las horas.
export function horasEnSombra(md, equipo, que) {
  if (md.sombraTramoMax_m === null) return { valor: null, motivo: 'no permanent-shadow layer on this terrain' };
  if (md.sombraTramoMax_m === 0 && !(md.sombraSinDato_m > 0)) return { valor: 0, como: `the ${que} crosses no cell flagged in the permanent-shadow layer` };
  const vel = velocidadCatalogo(equipo);
  if (!vel) return { valor: null, motivo: 'no catalogue speed with a source to turn the route into hours' };
  const v = `catalogue ${vel.tipo} speed ${+vel.kmh.toFixed(3)} km/h`;
  const out = {
    valor: md.sombraTramoMax_m / 1000 / vel.kmh, cota: 'inferior',
    como: `longest continuous stretch of the ${que} in permanent shadow ÷ ${v}: lower bound (only permanent shadow, constant speed)`,
    notaCota: `at ${v}; the real traverse is slower`,
  };
  const ef = velocidadEfectiva(equipo);
  if (ef) {
    const h = md.sombraTramoMax_m / 1000 / ef.kmh;
    out.adicional = { horas: h, kmh: ef.kmh, cifra: ef.cifra, texto: `same stretch at the catalogue ${ef.cifra.texto ?? ef.cifra.nombre} ${ef.cifra.valor} ${ef.cifra.unidad}: ${fmtH(h)} · extra figure, no verdict` };
  }
  return out;
}

export function vehiculos(catalogo) {
  const out = [];
  for (const q of catalogo?.equipos ?? []) {
    if (!CLASES_VEHICULO.has(q.clase)) continue;
    const r = (q.requisitos ?? []).find((x) => x.variable === 'pendiente_deg' && (x.op === '<=' || x.op === '<') && Number.isFinite(x.valor));
    if (r) out.push({ equipo: q, limite: r.valor, req: r });
  }
  return out;
}

// Rejilla ×2 más gruesa: una de cada dos celdas en cada eje.
export function diezmar(t) {
  const n2 = Math.ceil(t.n / 2), n = t.n;
  const toma = (a) => {
    if (!a) return null;
    const out = new Float32Array(n2 * n2);
    for (let f = 0; f < n2; f++) for (let c = 0; c < n2; c++) out[f * n2 + c] = a[2 * f * n + 2 * c];
    return out;
  };
  // Agua conservadora: la celda gruesa es agua si lo es cualquiera de sus 4; NaN solo si las 4 son NaN.
  const aguaDe = (a) => {
    if (!a) return null;
    const out = new Float32Array(n2 * n2);
    for (let f = 0; f < n2; f++) for (let c = 0; c < n2; c++) {
      let v = NaN;
      for (const [df, dc] of [[0, 0], [0, 1], [1, 0], [1, 1]]) {
        const ff = 2 * f + df, cc = 2 * c + dc;
        if (ff >= n || cc >= n) continue;
        const x = a[ff * n + cc];
        if (x >= 1 && !(v >= 1)) v = x;
        else if (x === 0 && Number.isNaN(v)) v = 0;
      }
      out[f * n2 + c] = v;
    }
    return out;
  };
  return { n: n2, m: t.m * 2, alturas: toma(t.alturas), sombra: toma(t.sombra), agua: aguaDe(t.agua) };
}

// Camino de la rejilla diezmada → celdas de la completa: la celda intermedia de cada paso y los extremos reales.
export function aRejillaCompleta(caminoD, nD, n, origen, destino) {
  const out = [];
  const meter = (i) => { if (out[out.length - 1] !== i) out.push(i); };
  const aC = (i) => 2 * Math.floor(i / nD) * n + 2 * (i % nD);
  meter(origen);
  for (let k = 0; k < caminoD.length; k++) {
    const b = aC(caminoD[k]);
    if (k > 0) meter((aC(caminoD[k - 1]) + b) / 2);
    meter(b);
  }
  meter(destino);
  return Int32Array.from(out);
}

// Con carreteras, las celdas de un tramo de carretera del camino no cuentan (se juzgan por el paso, no por la celda).
export function celdasSobreLimite(pend, camino, limite, carreteras = null) {
  const T = tramosCarretera(carreteras);
  let sobre = 0, sinDato = 0;
  for (let s = 0; s < camino.length; s++) {
    const i = camino[s];
    if (T && ((s > 0 && esTramo(T, camino[s - 1], i)) || (s + 1 < camino.length && esTramo(T, i, camino[s + 1])))) continue;
    if (!Number.isFinite(pend[i])) sinDato++;
    else if (pend[i] > limite) sobre++;
  }
  return { sobre, sinDato };
}
