// Generador de base: elige la celda de cada pieza (zona apta, plataforma, acceso al hábitat) minimizando un objetivo ponderado.
// Sin DOM: vale en un Worker. Ninguna cifra física aquí: límites, anchura, pesos y umbrales entran por parámetros.
import { pendientes, caminoMinimo, umbralMinimo, medirRuta, diezmar, aRejillaCompleta, celdasSobreLimite } from './rutas.js';
import { zonaApta, sugerir, transformadaDistancia } from './reparto.js';
import { perfil, rasante, volumenCarretera, plataforma } from './obra.js';

const RAD = Math.PI / 180;
const DF = [-1, -1, -1, 0, 0, 1, 1, 1], DC = [-1, 0, 1, -1, 1, -1, 0, 1];
const CUMPLE = { '<=': (v, l) => v <= l, '<': (v, l) => v < l, '>=': (v, l) => v >= l, '>': (v, l) => v > l };
const superior = (op) => op === '<=' || op === '<';
const holgura = (op, v, l) => (superior(op) ? l - v : v - l);
const CAPA_DE = { iluminacion_frac: 'iluminacion', sombra_permanente: 'sombra_permanente' };

// Valores por defecto del algoritmo (no físicos). Pesos: criterio propio.
export const PESOS_DEFECTO = { plataformas_m3: 1, carreteras_m3: 1, rutas_m: 1 };
const DEFECTO = { k: 8, presupuestoRutas: 4000, presupuestoNodos: 2e6, pesoCercania: 1, separacionHuellas_m: 0, nMaxRutas: Infinity, semilla: 1 };

class SinPresupuesto extends Error {}

function aleatorio(semilla) {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const menor = (a, b) => a.coste < b.coste || (a.coste === b.coste && a.x < b.x);
function meter(H, e) {
  let i = H.length;
  H.push(e);
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (!menor(e, H[p])) break;
    H[i] = H[p]; i = p;
  }
  H[i] = e;
}
function sacar(H) {
  const top = H[0], e = H.pop(), n = H.length;
  if (!n) return top;
  let i = 0;
  for (;;) {
    let h = 2 * i + 1;
    if (h >= n) break;
    if (h + 1 < n && menor(H[h + 1], H[h])) h++;
    if (!menor(H[h], e)) break;
    H[i] = H[h]; i = h;
  }
  H[i] = e;
  return top;
}

// Candidatos ordenados por cota inferior; se evalúan bajo demanda y salen en orden de coste real.
class Lista {
  constructor(items, evaluar) { this.items = items; this.pos = 0; this.heap = []; this.seq = []; this.evaluar = evaluar; this.fallos = 0; this.motivo = null; }
  cota(j) {
    if (j < this.seq.length) return this.seq[j].coste;
    let c = this.heap.length ? this.heap[0].coste : Infinity;
    if (this.pos < this.items.length) c = Math.min(c, this.items[this.pos].lb);
    return c;
  }
  get(j) {
    while (this.seq.length <= j) {
      while (this.pos < this.items.length && (!this.heap.length || this.items[this.pos].lb < this.heap[0].coste)) {
        const e = this.evaluar(this.items[this.pos].x);
        this.pos++;
        if (e.ok) meter(this.heap, e); else { this.fallos++; this.motivo = e.motivo; }
      }
      if (!this.heap.length) return null;
      this.seq.push(sacar(this.heap));
    }
    return this.seq[j];
  }
}

function componentes(tr, lim) {
  const { n, alturas, pend, agua } = tr, N = n * n;
  const pasa = (i) => Number.isFinite(alturas[i]) && pend[i] <= lim && !(agua && agua[i] >= 1);
  const lab = new Int32Array(N).fill(-1), pila = new Int32Array(N);
  let id = 0;
  for (let s = 0; s < N; s++) {
    if (lab[s] !== -1 || !pasa(s)) continue;
    let top = 0;
    pila[top++] = s; lab[s] = id;
    while (top) {
      const i = pila[--top], f = Math.floor(i / n), c = i % n;
      for (let k = 0; k < 8; k++) {
        const ff = f + DF[k], cc = c + DC[k];
        if (ff < 0 || cc < 0 || ff >= n || cc >= n) continue;
        const j = ff * n + cc;
        if (lab[j] === -1 && pasa(j)) { lab[j] = id; pila[top++] = j; }
      }
    }
    id++;
  }
  return lab;
}

function limitePendiente(reqs) {
  let lim = Infinity, req = null;
  for (const r of reqs) if (r.variable === 'pendiente_deg' && superior(r.op) && Number.isFinite(r.valor) && r.valor < lim) { lim = r.valor; req = r; }
  return req ? { lim, req } : null;
}

// t = {n, m | m_por_px, alturas, pend?, capas: {iluminacion, sombra_permanente, temp_max, agua}}
// piezas = [{id, equipo: {id, requisitos}, diametro_m, criterios: [{id, beneficio, peso, umbral_k?}], pendiente_max_deg?, enSombra?}]
// vehiculo = {limite (°), equipo?}; opc = {k, pesos, anchoCarretera_m, talud, separacionHuellas_m, separacionCandidatos_m,
//   pesoCercania, presupuestoRutas, presupuestoNodos, nMaxRutas, semilla, hub,
//   separacionesExtra: [{pieza, con, op, valor}] (separaciones supuestas entre dos piezas, centro a centro, en m)}
export function generarBase(t, piezas, vehiculo, opc = {}) {
  const n = t.n, m = t.m ?? t.m_por_px, alturas = t.alturas, capas = t.capas ?? {}, N = n * n;
  const o = { ...DEFECTO, ...Object.fromEntries(Object.entries(opc).filter(([, v]) => v !== undefined)) };
  const pesos = { ...PESOS_DEFECTO, ...(opc.pesos ?? {}) };
  if (!(n > 0 && m > 0 && alturas?.length === N)) throw new Error('terrain needs n, m and an n×n elevation array');
  if (!piezas?.length) throw new Error('no pieces to place');
  if (new Set(piezas.map((p) => p.id)).size !== piezas.length) throw new Error('piece ids must be unique');
  for (const p of piezas) if (!(p.diametro_m > 0 && Number.isFinite(p.diametro_m))) throw new Error(`${p.id}: platform diameter must be > 0`);
  const lv = vehiculo?.limite;
  if (!(lv >= 0 && lv < 90)) throw new Error('vehicle slope limit must be in [0, 90) degrees');
  if (!(o.anchoCarretera_m > 0 && Number.isFinite(o.anchoCarretera_m))) throw new Error('road width (anchoCarretera_m) must be > 0');
  for (const [k, w] of Object.entries(pesos)) if (!(w >= 0 && Number.isFinite(w))) throw new Error(`weight ${k} must be a finite number ≥ 0`);
  const wP = pesos.plataformas_m3, wC = pesos.carreteras_m3, wL = pesos.rutas_m;

  const hubId = o.hub ?? piezas.find((p) => p.equipo?.id === 'habitat_superficie')?.id;
  const H = piezas.findIndex((p) => p.id === hubId);
  if (H < 0) throw new Error('no hub piece: pass opc.hub or include a habitat_superficie piece');
  const otros = piezas.map((_, j) => j).filter((j) => j !== H);
  const extras = (opc.separacionesExtra ?? []).map((x) => {
    const a = piezas.findIndex((p) => p.id === x?.pieza), b = piezas.findIndex((p) => p.id === x?.con);
    if (a < 0 || b < 0 || a === b) throw new Error(`assumed separation ${x?.pieza} – ${x?.con}: both must be different pieces of this base`);
    if (!CUMPLE[x.op] || !(Number.isFinite(x.valor) && x.valor >= 0)) throw new Error(`assumed separation ${x.pieza} – ${x.con}: needs an operator and a finite value ≥ 0 m`);
    return { a, b, x };
  });

  const porMedir = [];
  const nota = (s) => { if (!porMedir.includes(s)) porMedir.push(s); };
  const pend = t.pend ?? pendientes(alturas, n, m);
  const sombra = capas.sombra_permanente ?? null, agua = capas.agua ?? null;
  if (!sombra) nota('no permanent-shadow layer: the rule «nothing on permanent shadow» is not applied');

  // Zona apta por pieza (requisitos de celda); las separaciones se tratan aquí, entre piezas.
  const info = piezas.map((p) => {
    const reqs = p.equipo?.requisitos ?? [];
    const zona = zonaApta({ n, m, pend, capas }, { ...p.equipo, requisitos: reqs.filter((r) => r.variable !== 'separacion_m') }, {});
    for (const om of zona.omitidos) nota(`${p.id}: ${om.req.variable} ${om.req.op} ${om.req.valor ?? '—'} not applied (${om.motivo})`);
    for (const a of zona.aplicados) if (a.parcial) nota(`${p.id}: ${a.req.variable} ${a.req.op} ${a.req.valor} ${a.como}`);
    const lc = limitePendiente(reqs);
    const lim = lc ? lc.lim : Number.isFinite(p.pendiente_max_deg) ? p.pendiente_max_deg : lv;
    const limOrigen = lc ? 'catalogue' : Number.isFinite(p.pendiente_max_deg) ? 'piece parameter' : 'vehicle limit (mío: the vehicle must drive onto it)';
    if (!lc) nota(`${p.id}: no catalogue slope limit; platform slope limit ${lim}° from the ${limOrigen}`);
    const mascara = new Uint8Array(N);
    let celdas = 0, sinSombra = 0;
    for (let i = 0; i < N; i++) {
      if (!(Number.isFinite(alturas[i]) && pend[i] <= lim)) continue;
      if (zona.mascara ? !zona.mascara[i] : agua && agua[i] >= 1) continue;
      if (sombra && !p.enSombra && sombra[i] !== 0) { if (!Number.isFinite(sombra[i])) sinSombra++; continue; }
      mascara[i] = 1; celdas++;
    }
    if (sinSombra) nota(`${p.id}: ${sinSombra} cells without permanent-shadow data left out`);
    return { p, lim, limOrigen, zona, mascara, celdas, plat: new Map() };
  });

  // Separaciones entre pares: catálogo (centro a centro, plano del mapa) y huellas.
  const pares = piezas.map(() => piezas.map(() => []));
  for (let a = 0; a < piezas.length; a++) for (let b = 0; b < piezas.length; b++) {
    if (a === b) continue;
    for (const r of piezas[a].equipo?.requisitos ?? []) {
      if (r.variable !== 'separacion_m' || r.respecto_a !== piezas[b].equipo?.id) continue;
      if (!Number.isFinite(r.valor) || !CUMPLE[r.op]) continue;
      const c = { tipo: 'separacion', pieza: piezas[a].id, con: piezas[b].id, respecto_a: r.respecto_a, op: r.op, limite: r.valor, unidad: 'm', fuente: r.fuente ?? null, huella: false };
      pares[a][b].push(c); pares[b][a].push(c);
    }
    if (a < b) {
      const c = { tipo: 'huella', pieza: piezas[a].id, con: piezas[b].id, op: '>=', limite: o.separacionHuellas_m, unidad: 'm', origen: 'mío', huella: true, radios: (piezas[a].diametro_m + piezas[b].diametro_m) / 2 };
      pares[a][b].push(c); pares[b][a].push(c);
    }
  }
  for (const { a, b, x } of extras) {
    const c = { tipo: 'separacion', pieza: piezas[a].id, con: piezas[b].id, respecto_a: piezas[b].equipo?.id ?? piezas[b].id, op: x.op, limite: x.valor, unidad: 'm', fuente: null, origen: 'supuesto', huella: false };
    pares[a][b].push(c); pares[b][a].push(c);
    nota(`${piezas[a].id}: separation from ${piezas[b].id} ${x.op} ${x.valor} m is an assumed parameter, not from a source`);
  }
  const cubierta = (p, r) => extras.some(({ a, b }) => (piezas[a] === p && piezas[b].equipo?.id === r.respecto_a) || (piezas[b] === p && piezas[a].equipo?.id === r.respecto_a));
  for (const p of piezas) for (const r of p.equipo?.requisitos ?? []) {
    if (r.variable !== 'separacion_m') continue;
    if (!Number.isFinite(r.valor) && cubierta(p, r)) continue;
    if (!Number.isFinite(r.valor)) nota(`${p.id}: separation from ${r.respecto_a} not applied (no public limit)`);
    else if (!piezas.some((q) => q.equipo?.id === r.respecto_a)) nota(`${p.id}: separation from ${r.respecto_a} not applied (no ${r.respecto_a} in this base)`);
  }
  const dist = (i, j) => Math.hypot(Math.floor(i / n) - Math.floor(j / n), (i % n) - (j % n)) * m;
  const valorPar = (c, d) => (c.huella ? d - c.radios : d);
  const fallaPar = (a, i, b, j) => {
    const d = dist(i, j);
    for (const c of pares[a][b]) if (!CUMPLE[c.op](valorPar(c, d), c.limite)) return c;
    return null;
  };

  // Criterios de preferencia (solo ordenan candidatos; el objetivo no los usa).
  const crCache = new Map();
  const valoresCriterio = (c, pid) => {
    const clave = c.id === 'dist_frio' ? `dist_frio:${c.umbral_k}` : c.id;
    if (crCache.has(clave)) return crCache.get(clave);
    let v = null;
    if (c.id === 'iluminacion') {
      v = capas.iluminacion ?? null;
      if (!v) nota(`${pid}: no illumination layer: preference «iluminacion» dropped`);
    } else if (c.id === 'pendiente') v = pend;
    else if (c.id === 'dist_sombra' || c.id === 'dist_frio') {
      const frio = c.id === 'dist_frio';
      if (!sombra || (frio && !capas.temp_max)) nota(`${pid}: no ${!sombra ? 'permanent-shadow' : 'temperature'} layer: preference «${c.id}» dropped`);
      else if (frio && !Number.isFinite(c.umbral_k)) throw new Error(`${pid}: criterion dist_frio needs umbral_k`);
      else {
        const mk = new Uint8Array(N);
        let hay = 0;
        for (let i = 0; i < N; i++) if (sombra[i] === 1 && (!frio || capas.temp_max[i] <= c.umbral_k)) { mk[i] = 1; hay++; }
        if (hay) v = transformadaDistancia(mk, n, m);
        else nota(`${pid}: no ${frio ? `permanent-shadow cell with temp_max ≤ ${c.umbral_k} K` : 'permanent-shadow cell'} on this terrain: preference «${c.id}» dropped`);
      }
    } else throw new Error(`${pid}: unknown criterion ${c.id}`);
    crCache.set(clave, v);
    return v;
  };
  const criterios = info.map(({ p }) => {
    const cs = [];
    for (const c of p.criterios ?? []) {
      const v = valoresCriterio(c, p.id);
      if (v) cs.push({ id: c.id, valores: v, beneficio: !!c.beneficio, peso: c.peso ?? 1 });
    }
    return cs;
  });

  const platDe = (a, i) => {
    const I = info[a];
    if (!I.plat.has(i)) {
      const pl = plataforma(t, Math.floor(i / n), i % n, piezas[a].diametro_m, I.lim);
      I.plat.set(i, pl.corte_m3 === null ? null : { pl, vol: pl.corte_m3 + pl.relleno_m3 });
    }
    return I.plat.get(i);
  };
  const conCandidatos = (a, mascara, extra) => {
    if (!Number.isFinite(o.k)) {
      const out = [];
      for (let i = 0; i < N; i++) if (mascara[i]) out.push(i);
      return out;
    }
    const cs = [...criterios[a], ...extra];
    if (!cs.length) cs.push({ id: 'pendiente', valores: pend, beneficio: false, peso: 1 });
    const sepC = o.separacionCandidatos_m ?? piezas[a].diametro_m;
    return sugerir({ n, m, mascara, criterios: cs, N: o.k, separacion_m: sepC }).map((s) => s.i);
  };

  // Rejilla de rutas (diezmada si n > nMaxRutas) y componentes conexas al límite del vehículo.
  const niveles = [{ n, m, alturas, pend, agua, sombra }];
  while (niveles[niveles.length - 1].n > o.nMaxRutas) {
    const d = diezmar(niveles[niveles.length - 1]);
    d.pend = pendientes(d.alturas, d.n, d.m);
    niveles.push(d);
  }
  const tr = niveles[niveles.length - 1];
  if (niveles.length > 1) nota(`routes searched on a ${tr.n}×${tr.n} grid (decimated ×${2 ** (niveles.length - 1)}, ${tr.m.toFixed(2)} m/px); lengths, slopes and road grades measured on the full grid`);
  const lab = componentes(tr, lv);
  const bajar = (i) => {
    const out = [i];
    for (let L = 1; L < niveles.length; L++) {
      const nA = niveles[L - 1].n, nB = niveles[L].n, x = out[L - 1];
      out.push(Math.min(nB - 1, Math.round(Math.floor(x / nA) / 2)) * nB + Math.min(nB - 1, Math.round((x % nA) / 2)));
    }
    return out;
  };

  let evals = 0, limiteEvals = o.presupuestoRutas;
  const conexiones = new Map();
  const conexion = (h, x) => {
    const clave = h * N + x;
    if (conexiones.has(clave)) return conexiones.get(clave);
    if (evals >= limiteEvals) throw new SinPresupuesto();
    evals++;
    const oh = bajar(h), ox = bajar(x), L = niveles.length - 1;
    let camR, umbral = null;
    if (lab[oh[L]] >= 0 && lab[oh[L]] === lab[ox[L]]) camR = caminoMinimo(tr, oh[L], ox[L], { limite: lv }).camino;
    else {
      umbral = umbralMinimo(tr, oh[L], ox[L]);
      if (Number.isFinite(umbral)) camR = caminoMinimo(tr, oh[L], ox[L], { limite: umbral }).camino;
    }
    let res;
    if (!camR) res = { ok: false, motivo: 'no path with elevation data between the habitat and this cell' };
    else {
      let cam = camR;
      for (let k = L; k > 0; k--) cam = aRejillaCompleta(cam, niveles[k].n, niveles[k - 1].n, oh[k - 1], ox[k - 1]);
      const caja = [Infinity, -Infinity, Infinity, -Infinity];
      for (let j = 1; j < cam.length - 1; j++) {
        const f = Math.floor(cam[j] / n), c = cam[j] % n;
        caja[0] = Math.min(caja[0], f); caja[1] = Math.max(caja[1], f); caja[2] = Math.min(caja[2], c); caja[3] = Math.max(caja[3], c);
      }
      const md = medirRuta({ n, m, alturas, pend, sombra }, cam);
      const sobre = celdasSobreLimite(pend, cam, lv);
      if (!sobre.sobre && !sobre.sinDato) res = { ok: true, tipo: 'ruta', camino: cam, caja, md, sobre, vol: 0, zp: null, umbral };
      else {
        const pf = perfil(t, cam);
        const ra = rasante(pf.s, pf.z, lv, { anclarInicio: true, anclarFin: true });
        if (!ra.factible) res = { ok: false, motivo: `road at the vehicle limit ${lv}° is not buildable: ${ra.motivo}` };
        else {
          const v = volumenCarretera(pf.s, pf.z, ra.zp, o.anchoCarretera_m, o.talud ?? 0);
          let g = 0;
          for (let j = 1; j < pf.s.length; j++) g = Math.max(g, Math.abs(ra.zp[j] - ra.zp[j - 1]) / (pf.s[j] - pf.s[j - 1]));
          res = { ok: true, tipo: 'carretera', camino: cam, caja, md, sobre, vol: v.corte_m3 + v.relleno_m3, v, s: pf.s, z: pf.z, zp: ra.zp, gradoMax: Math.atan(g) / RAD, umbral };
        }
      }
    }
    conexiones.set(clave, res);
    return res;
  };

  // Ninguna traza pasa por la plataforma de otra pieza: celdas interiores (sin los extremos) a ≥ radio + media calzada de su centro.
  const radioCruce = piezas.map((p) => p.diametro_m / 2 + o.anchoCarretera_m / 2);
  const distTraza = (cam, x) => {
    const f0 = Math.floor(x / n), c0 = x % n;
    let d2 = Infinity;
    for (let j = 1; j < cam.length - 1; j++) {
      const df = Math.floor(cam[j] / n) - f0, dc = (cam[j] % n) - c0;
      if (df * df + dc * dc < d2) d2 = df * df + dc * dc;
    }
    return Math.sqrt(d2) * m;
  };
  const pisa = (c, b, x) => {
    const k = c.caja, f = Math.floor(x / n), col = x % n, r = radioCruce[b] / m;
    if (f < k[0] - r || f > k[1] + r || col < k[2] - r || col > k[3] + r) return false;
    return distTraza(c.camino, x) < radioCruce[b];
  };
  const cruce = (h, a, xa, b, xb) => pisa(conexion(h, xa), b, xb) || pisa(conexion(h, xb), a, xa);

  // Candidatos: hábitat primero; para cada hábitat, los de cada pieza compatibles con él.
  const vacios = Object.fromEntries(otros.map((a) => [a, new Map()]));
  const sinPlat = new Map();
  const listaPlat = (a, cand) => cand.filter((i) => {
    if (platDe(a, i)) return true;
    sinPlat.set(a, (sinPlat.get(a) ?? 0) + 1);
    return false;
  });
  const infactible = (motivo, restriccion, extra = {}) => ({
    factible: false, motivo, restriccion, por_medir: porMedir,
    busqueda: { metodo: null, rutas_evaluadas: evals, presupuesto_rutas: o.presupuestoRutas, ...extra },
  });
  const zonaVacia = (a) => {
    const I = info[a], ap = I.zona.aplicados.map((x) => `${x.req.variable} ${x.req.op} ${x.req.valor}`);
    return infactible(`${piezas[a].id}: no cell meets ${[`slope ≤ ${I.lim}°`, ...ap.filter((s) => !s.startsWith('pendiente_deg')), sombra && !piezas[a].enSombra ? 'not on permanent shadow' : null].filter(Boolean).join(', ')}`,
      { tipo: 'zona', pieza: piezas[a].id, requisitos: I.zona.aplicados.map((x) => x.req), limite_pend_deg: I.lim });
  };
  if (!info[H].celdas) return zonaVacia(H);
  for (const a of otros) if (!info[a].celdas) return zonaVacia(a);

  const hubs = listaPlat(H, conCandidatos(H, info[H].mascara, []));
  if (!hubs.length) return infactible(`${piezas[H].id}: no candidate cell with a platform fit`, { tipo: 'plataforma', pieza: piezas[H].id });
  const porHub = [];
  for (const h of hubs) {
    const distH = new Float32Array(N);
    let viable = true;
    const listas = [];
    for (const a of otros) {
      const mk = new Uint8Array(N);
      let quedan = 0;
      const corta = new Map();
      for (let i = 0; i < N; i++) {
        if (!info[a].mascara[i]) continue;
        const c = fallaPar(H, h, a, i);
        if (c) { const k = c.huella ? 'huella' : c; corta.set(k, (corta.get(k) ?? 0) + 1); continue; }
        mk[i] = 1; quedan++;
      }
      if (!quedan) {
        let peor = null, max = -1;
        for (const [k, v] of corta) if (v > max) { max = v; peor = k; }
        vacios[a].set(peor, (vacios[a].get(peor) ?? 0) + 1);
        viable = false; break;
      }
      let extra = [];
      if (Number.isFinite(o.k)) {
        for (let i = 0; i < N; i++) distH[i] = dist(h, i);
        extra = [{ id: 'dist_hub', valores: distH, beneficio: false, peso: o.pesoCercania }];
      }
      const cand = listaPlat(a, conCandidatos(a, mk, extra));
      if (!cand.length) { vacios[a].set('plataforma', (vacios[a].get('plataforma') ?? 0) + 1); viable = false; break; }
      const items = cand.map((x) => ({ x, lb: (wP * platDe(a, x).vol + wL * dist(h, x)) * (1 - 1e-9) })).sort((p, q) => p.lb - q.lb || p.x - q.x);
      listas.push(new Lista(items, (x) => {
        const c = conexion(h, x);
        if (!c.ok) return { ok: false, motivo: c.motivo };
        return { ok: true, x, coste: wP * platDe(a, x).vol + wC * c.vol + wL * c.md.longitud_m };
      }));
    }
    if (!viable) continue;
    const lb = wP * platDe(H, h).vol + listas.reduce((s, l) => s + l.cota(0), 0);
    porHub.push({ h, listas, lb, base: wP * platDe(H, h).vol, hecho: false });
  }
  if (!porHub.length) {
    for (const a of otros) {
      let total = 0, peor = null, max = -1;
      for (const [k, v] of vacios[a]) { total += v; if (v > max) { max = v; peor = k; } }
      if (!total) continue;
      if (peor === 'plataforma') return infactible(`${piezas[a].id}: no candidate cell with a platform fit`, { tipo: 'plataforma', pieza: piezas[a].id });
      const con = piezas[H].id, de = `for ${max} of ${hubs.length} ${con} candidates`;
      if (peor === 'huella') {
        return infactible(`${piezas[a].id}: no cell keeps the footprint gap ≥ ${o.separacionHuellas_m} m from the ${con} ${de}`,
          { tipo: 'huella', pieza: piezas[a].id, con, op: '>=', limite: o.separacionHuellas_m, unidad: 'm' });
      }
      return infactible(`${piezas[a].id}: no apt cell is ${peor.op} ${peor.limite} m from the ${peor.respecto_a} ${de} (the terrain is too small or the apt zones too close)`,
        { tipo: 'separacion', pieza: piezas[a].id, respecto_a: peor.respecto_a, op: peor.op, limite: peor.limite, unidad: 'm', fuente: peor.fuente, ...(peor.origen ? { origen: peor.origen } : {}) });
    }
  }
  porHub.sort((p, q) => p.lb - q.lb || p.h - q.h);

  // Ramificación y poda: hábitats por cota inferior, piezas en orden de entrada, candidatos en orden de coste real.
  const q = otros.length;
  let best = Infinity, sol = null, nodos = 0;
  const elegidos = new Array(q);
  const compatible = (h, d, x) => {
    for (let e = 0; e < d; e++) if (fallaPar(otros[e], elegidos[e].x, otros[d], x) || cruce(h, otros[e], elegidos[e].x, otros[d], x)) return false;
    return true;
  };
  const dfs = (hb, d, acum) => {
    if (d === q) {
      if (acum < best) { best = acum; sol = { h: hb.h, xs: elegidos.map((e) => e.x) }; }
      return;
    }
    if (++nodos > o.presupuestoNodos) throw new SinPresupuesto();
    let resto = 0;
    for (let e = d + 1; e < q; e++) resto += hb.listas[e].cota(0);
    const L = hb.listas[d];
    for (let j = 0; ; j++) {
      if (acum + L.cota(j) + resto >= best) break;
      const it = L.get(j);
      if (!it) break;
      if (!compatible(hb.h, d, it.x)) continue;
      elegidos[d] = it;
      dfs(hb, d + 1, acum + it.coste);
    }
  };
  let metodo = 'exacto';
  try {
    for (const hb of porHub) {
      if (hb.lb >= best) break;
      dfs(hb, 0, hb.base);
      hb.hecho = true;
    }
  } catch (e) {
    if (!(e instanceof SinPresupuesto)) throw e;
    metodo = 'heuristica';
  }
  const exploradoExacto = metodo === 'exacto';
  if (!exploradoExacto) {
    // Voraz por hábitat y mejora local (cambiar una pieza por su mejor candidato compatible); presupuesto adicional igual al inicial.
    limiteEvals = evals + o.presupuestoRutas;
    const rnd = aleatorio(o.semilla);
    try {
      for (const hb of porHub) {
        if (hb.hecho || hb.lb >= best) continue;
        let acum = hb.base, ok = true;
        for (let d = 0; d < q && ok; d++) {
          ok = false;
          for (let j = 0; ; j++) {
            const it = hb.listas[d].get(j);
            if (!it) break;
            if (compatible(hb.h, d, it.x)) { elegidos[d] = it; acum += it.coste; ok = true; break; }
          }
        }
        if (!ok) continue;
        let mejora = true;
        while (mejora) {
          mejora = false;
          const orden = Array.from({ length: q }, (_, d) => d);
          for (let i = q - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [orden[i], orden[j]] = [orden[j], orden[i]]; }
          for (const d of orden) {
            const L = hb.listas[d], actual = elegidos[d];
            for (let j = 0; L.cota(j) < actual.coste; j++) {
              const it = L.get(j);
              if (!it || !(it.coste < actual.coste)) break;
              const guarda = elegidos[d];
              elegidos[d] = { x: -1, coste: 0 };
              const vale = (() => {
                for (let e = 0; e < q; e++) if (e !== d && (fallaPar(otros[e], elegidos[e].x, otros[d], it.x) || cruce(hb.h, otros[e], elegidos[e].x, otros[d], it.x))) return false;
                return true;
              })();
              elegidos[d] = guarda;
              if (vale) { acum += it.coste - actual.coste; elegidos[d] = it; mejora = true; break; }
            }
          }
        }
        if (acum < best) { best = acum; sol = { h: hb.h, xs: elegidos.map((e) => e.x) }; }
      }
    } catch (e) {
      if (!(e instanceof SinPresupuesto)) throw e;
    }
  }
  const cotaInferior = exploradoExacto ? best : Math.min(best, ...porHub.filter((hb) => !hb.hecho).map((hb) => hb.lb));
  const combinaciones = porHub.reduce((s, hb) => s + hb.listas.reduce((pr, l) => pr * l.items.length, 1), 0);
  const busqueda = {
    metodo, optimo_probado: exploradoExacto, rutas_evaluadas: evals, presupuesto_rutas: o.presupuestoRutas, nodos, presupuesto_nodos: o.presupuestoNodos,
    candidatos_hub: hubs.length, combinaciones, k: Number.isFinite(o.k) ? o.k : 'all', cota_inferior: Number.isFinite(cotaInferior) ? cotaInferior : null,
    rejilla_rutas: { n: tr.n, m: tr.m, diezmado: niveles.length > 1 }, semilla: o.semilla,
    como: exploradoExacto
      ? 'branch and bound over every combination of the candidate sets (lower bound per pair = platform + straight-line distance); routes evaluated lazily, cached per (habitat, cell)'
      : `route budget (${o.presupuestoRutas}) or node budget (${o.presupuestoNodos}) exhausted: greedy per habitat candidate in lower-bound order, then one-piece swaps until no gain`,
  };
  if (!Number.isFinite(o.k)) nota('candidates = every apt cell (k = all)');
  else nota(`candidates: top ${o.k} per piece by TOPSIS on its preferences${o.pesoCercania ? ' plus closeness to the habitat' : ''}; cells outside the top k are not searched`);

  if (!sol) {
    if (metodo === 'heuristica') return infactible(`search budget exhausted before any feasible base was found (${evals} routes evaluated)`, { tipo: 'presupuesto', limite: o.presupuestoRutas }, busqueda);
    for (let d = 0; d < q; d++) {
      if (porHub.every((hb) => hb.listas[d].seq.length === 0 && hb.listas[d].pos === hb.listas[d].items.length)) {
        const motivo = porHub.map((hb) => hb.listas[d].motivo).find(Boolean);
        return infactible(`${piezas[otros[d]].id}: no candidate can be joined to the ${piezas[H].id} by a vehicle route or a road at ${lv}° (${motivo})`,
          { tipo: 'acceso', pieza: piezas[otros[d]].id, con: piezas[H].id, op: '<=', limite: lv, unidad: 'deg' }, busqueda);
      }
    }
    return infactible('every combination breaks a separation or footprint gap between two pieces, or runs a route or road across another pad', { tipo: 'combinacion' }, busqueda);
  }

  // Salida.
  const celdaDe = (a) => (a === H ? sol.h : sol.xs[otros.indexOf(a)]);
  const restricciones = [];
  const salidaPiezas = piezas.map((p, a) => {
    const i = celdaDe(a), I = info[a], pl = platDe(a, i).pl;
    for (const x of I.zona.aplicados) {
      const r = x.req;
      let v = null;
      if (r.variable === 'pendiente_deg') v = pend[i];
      else if (CAPA_DE[r.variable]) v = capas[CAPA_DE[r.variable]][i];
      else if (r.variable === 'temp_k' && superior(r.op)) v = capas.temp_max[i];
      else if (r.variable === 'temp_k' && capas.temp_min) v = capas.temp_min[i];
      if (r.variable === 'pendiente_deg') continue;
      restricciones.push({ tipo: 'zona', pieza: p.id, variable: r.variable, op: r.op, limite: r.valor, unidad: r.unidad ?? null, valor: v, holgura: Number.isFinite(v) && !x.parcial ? holgura(r.op, v, r.valor) : null, como: x.como, fuente: r.fuente ?? null });
    }
    restricciones.push({ tipo: 'pendiente_celda', pieza: p.id, op: '<=', limite: I.lim, unidad: 'deg', valor: pend[i], holgura: I.lim - pend[i], origen: I.limOrigen });
    restricciones.push({ tipo: 'pendiente_plataforma', pieza: p.id, op: '<=', limite: I.lim, unidad: 'deg', valor: pl.pend_despues_deg, holgura: I.lim - pl.pend_despues_deg, origen: I.limOrigen });
    if (sombra && !p.enSombra) restricciones.push({ tipo: 'sombra_permanente', pieza: p.id, op: '==', limite: 0, unidad: '0/1', valor: sombra[i], holgura: 0 });
    if (pl.sub_celda) nota(`${p.id}: platform (${p.diametro_m} m) narrower than ${3} cells of ${m.toFixed(2)} m: tilted-disc wedge from the cell slope, not a grid fit`);
    return { id: p.id, equipo: p.equipo?.id ?? null, hub: a === H, fila: Math.floor(i / n), col: i % n, i, diametro_m: p.diametro_m, limite_pend_deg: I.lim, limite_origen: I.limOrigen, plataforma: pl };
  });
  for (let a = 0; a < piezas.length; a++) for (let b = a + 1; b < piezas.length; b++) {
    const d = dist(celdaDe(a), celdaDe(b));
    for (const c of pares[a][b]) {
      const v = valorPar(c, d);
      restricciones.push({ tipo: c.tipo, pieza: c.pieza, con: c.con, respecto_a: c.respecto_a ?? null, op: c.op, limite: c.limite, unidad: 'm', valor: v, holgura: holgura(c.op, v, c.limite),
        como: c.huella ? 'centre distance minus both platform radii, map plane' : 'centre to centre, map plane', fuente: c.fuente ?? null, origen: c.origen ?? null });
    }
  }
  const carreteras = [];
  let cP = 0, rP = 0, cC = 0, rC = 0, lon = 0;
  for (const p of salidaPiezas) { cP += p.plataforma.corte_m3; rP += p.plataforma.relleno_m3; }
  for (const a of otros) {
    const c = conexion(sol.h, celdaDe(a));
    const pf = c.s ? null : perfil(t, c.camino);
    const out = {
      desde: piezas[H].id, hasta: piezas[a].id, tipo: c.tipo, traza: c.camino, s: c.s ?? pf.s, z: c.z ?? pf.z, zp: c.zp,
      corte_m3: c.tipo === 'carretera' ? c.v.corte_m3 : 0, relleno_m3: c.tipo === 'carretera' ? c.v.relleno_m3 : 0,
      corte_max_m: c.tipo === 'carretera' ? c.v.corte_max_m : 0, relleno_max_m: c.tipo === 'carretera' ? c.v.relleno_max_m : 0,
      longitud_m: c.md.longitud_m, longitud_plano_m: (c.s ?? pf.s)[c.camino.length - 1], medidas: c.md,
      celdas_sobre_limite: c.sobre.sobre, celdas_sin_dato: c.sobre.sinDato, umbral_minimo_deg: c.umbral,
    };
    carreteras.push(out);
    cC += out.corte_m3; rC += out.relleno_m3; lon += out.longitud_m;
    const v = c.tipo === 'ruta' ? c.md.pendMax : c.gradoMax;
    restricciones.push({ tipo: 'acceso', pieza: piezas[a].id, con: piezas[H].id, op: '<=', limite: lv, unidad: 'deg', valor: v, holgura: lv - v,
      como: c.tipo === 'ruta' ? 'vehicle route: steepest cell slope on the path' : 'road: steepest grade of the cut-and-fill profile (anchored at both ends)' });
    for (const b of otros) {
      if (b === a) continue;
      const v = c.camino.length > 2 ? distTraza(c.camino, celdaDe(b)) : null;
      restricciones.push({ tipo: 'cruce', pieza: piezas[a].id, con: piezas[b].id, op: '>=', limite: radioCruce[b], unidad: 'm', valor: v, holgura: v === null ? null : v - radioCruce[b],
        como: `${c.tipo === 'ruta' ? 'route' : 'road'} to ${piezas[a].id}: nearest inner path cell centre to the ${piezas[b].id} pad centre ≥ pad radius + half the road width`, origen: 'mío' });
    }
  }
  if (carreteras.some((c) => c.tipo === 'carretera')) {
    nota('roads follow the shortest path under the least bottleneck slope, then cut and fill to the vehicle limit: not the minimum-earthworks alignment');
    nota('roads meet each platform at the terrain elevation of its centre cell, not at the levelled platform');
    if (o.talud === undefined) nota('road side slopes not counted (talud not given): volumes = width × depth only');
  }
  nota('routes and roads keep clear of the other pads (inner path cell centres at ≥ pad radius + half the road width), but are not rerouted around them: a combination whose shortest path crosses a pad is dropped');
  nota('routes and roads may cross each other');
  nota(`DEM ${m.toFixed(2)} m/px: cell slope over a ${(2 * m).toFixed(0)} m baseline; separations measured centre to centre on the map plane`);
  if (o.separacionHuellas_m === DEFECTO.separacionHuellas_m && opc.separacionHuellas_m === undefined) nota('no gap between footprints required beyond not overlapping');

  const objetivo = {
    total: wP * (cP + rP) + wC * (cC + rC) + wL * lon,
    plataformas_m3: { valor: cP + rP, peso: wP, ponderado: wP * (cP + rP) },
    carreteras_m3: { valor: cC + rC, peso: wC, ponderado: wC * (cC + rC) },
    rutas_m: { valor: lon, peso: wL, ponderado: wL * lon },
    pesos: { ...pesos }, origen: 'mío',
    como: 'weights are an Analog Zero criterion; platform and road earthworks = cut + fill (m³), routes = 3D length along the path (m)',
  };
  return {
    factible: true, piezas: salidaPiezas, carreteras,
    totales: { plataformas_corte_m3: cP, plataformas_relleno_m3: rP, carreteras_corte_m3: cC, carreteras_relleno_m3: rC, rutas_m: lon },
    objetivo, restricciones, busqueda, vehiculo: { limite_deg: lv, equipo: vehiculo.equipo?.id ?? null }, por_medir: porMedir,
  };
}
