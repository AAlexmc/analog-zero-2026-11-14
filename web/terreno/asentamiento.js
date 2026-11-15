// Base alrededor del punto: una celda por equipo del catálogo dentro de un radio, sin azar. Sin DOM.
// Límites publicados (pendiente, separación) = restricciones duras; REGLAS, pesos y HOLGURA_M = criterio propio (se rotula).
import { pendienteGrados } from './calculo.js';

export const RADIOS_M = [250, 500, 1000, 2000];
export const RADIO_DEFECTO_M = 1000;
export const HOLGURA_M = 10;            // criterio propio: metros libres entre huellas
export const EN_ORBITA = ['reles_comunicaciones'];
// Criterio propio por equipo. tipo ∈ 'pendiente' | 'centro' | 'luz' | 'sombra' | 'cerca' | 'lejos'; `con` = id de otro equipo (solo cerca/lejos).
export const REGLAS = {
  habitat_superficie: { orden: 1, criterios: [{ tipo: 'pendiente', peso: 2 }, { tipo: 'centro', peso: 2 }, { tipo: 'luz', peso: 1 }], texto: 'Hub of the base: flat, sunlit ground as close to the centre as possible' },
  reactor_fision:     { orden: 2, criterios: [{ tipo: 'pendiente', peso: 1 }, { tipo: 'cerca', con: 'habitat_superficie', peso: 3 }], texto: 'Beyond its published standoff from the habitat, as near to it as flat ground allows' },
  pista_aterrizaje:   { orden: 3, criterios: [{ tipo: 'pendiente', peso: 1 }, { tipo: 'lejos', con: 'habitat_superficie', peso: 2 }], texto: 'As far from the habitat as the radius allows (no published standoff), on the flattest ground' },
  taladro_trident:    { orden: 4, criterios: [{ tipo: 'sombra', peso: 3 }, { tipo: 'pendiente', peso: 1 }], texto: 'On the ground the Sun reaches least inside the radius (our choice for an ice drill)' },
  planta_agua:        { orden: 5, criterios: [{ tipo: 'cerca', con: 'taladro_trident', peso: 2 }, { tipo: 'pendiente', peso: 1 }], texto: 'Next to the drill site, on flat ground' },
  torre_solar:        { orden: 6, criterios: [{ tipo: 'luz', peso: 3 }, { tipo: 'cerca', con: 'habitat_superficie', peso: 1 }, { tipo: 'pendiente', peso: 1 }], texto: 'Where the Sun reaches most through the day, near the habitat' },
  ltv:                { orden: 7, criterios: [{ tipo: 'cerca', con: 'habitat_superficie', peso: 2 }, { tipo: 'pendiente', peso: 1 }], texto: 'Parked next to the habitat' },
  celda_verde:        { orden: 8, criterios: [{ tipo: 'cerca', con: 'habitat_superficie', peso: 2 }, { tipo: 'luz', peso: 1 }, { tipo: 'pendiente', peso: 1 }], texto: 'Next to the habitat, in the light' },
  ipex:               { orden: 9, criterios: [{ tipo: 'cerca', con: 'pista_aterrizaje', peso: 2 }, { tipo: 'pendiente', peso: 1 }], texto: 'Next to the landing pad it would build' },
  flip:               { orden: 10, criterios: [{ tipo: 'cerca', con: 'pista_aterrizaje', peso: 2 }, { tipo: 'pendiente', peso: 1 }], texto: 'Next to the landing pad where cargo arrives' },
  viper:              { orden: 11, criterios: [{ tipo: 'cerca', con: 'taladro_trident', peso: 2 }, { tipo: 'pendiente', peso: 1 }], texto: 'Near the drill site it prospects' },
  rover_prospeccion_rtg: { orden: 12, criterios: [{ tipo: 'cerca', con: 'taladro_trident', peso: 1 }, { tipo: 'sombra', peso: 1 }, { tipo: 'pendiente', peso: 1 }], texto: 'Near the drill site, towards the darker ground' },
};
// Regla para un equipo del catálogo que no esté en REGLAS (catálogo ampliado en el futuro):
export const REGLA_DEFECTO = { orden: 99, criterios: [{ tipo: 'cerca', con: 'habitat_superficie', peso: 1 }, { tipo: 'pendiente', peso: 1 }], texto: 'Near the habitat, on flat ground' };

const PENDIENTE_REF_DEG = 20;
const MAX_REF_SOMBRA = 2000;
const EPS = 1e-9;
const SIN_SUELO = 'no ground with elevation data inside this radius';
const SIN_HUECO = 'no free ground left inside this radius';
const CUMPLE = { '<=': (v, l) => v <= l, '<': (v, l) => v < l, '>=': (v, l) => v >= l, '>': (v, l) => v > l };
const recorte = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const positivo = (v) => Number.isFinite(v) && v > 0;
const modulo = (a, p) => ((a % p) + p) % p;
const porOrden = (a, b) => a.orden - b.orden || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function huellaDe(equipo) {
  const propio = equipo?.origen === 'mío';
  const citadas = (equipo?.cifras ?? []).filter((x) => x?.unidad === 'm' && (propio || (/^https?:\/\//.test(x.fuente ?? '') && x.origen !== 'mío')));
  const cifra = (nombre) => citadas.find((x) => x.nombre === nombre && positivo(x.valor));
  const da = (diametro_m, de) => ({ diametro_m, de });
  const d = cifra('diametro_m');
  if (d) return da(d.valor, d.nombre);
  const l = cifra('largo_m'), a = cifra('ancho_m');
  if (l && a) return da(Math.hypot(l.valor, a.valor), 'largo_m + ancho_m');
  const dim = citadas.find((x) => String(x.nombre).includes('dimensiones') && Array.isArray(x.valor) && positivo(x.valor[0]) && positivo(x.valor[1]));
  if (dim) return da(Math.hypot(dim.valor[0], dim.valor[1]), dim.nombre);
  const hex = cifra('ancho_entre_caras_m');
  if (hex) return da((hex.valor * 2) / Math.sqrt(3), hex.nombre);
  for (const nombre of ['ancho_paneles_m', 'distancia_entre_zonas_m', 'ancho_m', 'largo_m']) {
    const x = cifra(nombre);
    if (x) return da(x.valor, nombre);
  }
  return da(null, '');
}

export function piezasDe(catalogo) {
  const piezas = [], excluidos = [];
  for (const e of catalogo?.equipos ?? []) {
    if (EN_ORBITA.includes(e.id)) {
      excluidos.push({ id: e.id, nombre: e.nombre, motivo: 'in orbit, not on the ground' });
      continue;
    }
    const regla = REGLAS[e.id] ?? REGLA_DEFECTO, reqs = e.requisitos ?? [], h = huellaDe(e);
    const lim = reqs.find((q) => q.variable === 'pendiente_deg' && Number.isFinite(q.valor) && (q.op === '<=' || q.op === '<'));
    const separaciones = reqs
      .filter((q) => q.variable === 'separacion_m' && typeof q.respecto_a === 'string' && positivo(q.valor) && (q.op === '>=' || q.op === '>'))
      .map((q) => ({ con: q.respecto_a, min_m: q.valor, req: q }));
    piezas.push({
      id: e.id, nombre: e.nombre, clase: e.clase, huella_m: h.diametro_m, huella_de: h.de,
      limite: lim ? { valor: lim.valor, op: lim.op, req: lim } : null, separaciones,
      criterios: regla.criterios.map((c) => ({ ...c })), texto: regla.texto, orden: regla.orden,
    });
  }
  piezas.sort(porOrden);
  return { piezas, excluidos };
}

// Modo por prioridad (criterio propio): el orden lo pone el usuario. La primera pieza (ancla) se coloca solo por lo que ella
// mide en el suelo; las demás conservan su regla y además tiran hacia el ancla, con más peso cuanto antes van en la lista.
export const PESO_ANCLA = { max: 3, min: 1 };
const BUSCA = { pendiente: 'the flattest ground', luz: 'the most sunlight', sombra: 'the darkest ground', centro: 'the centre' };

export function piezasPorPrioridad(piezas, ids = []) {
  const rango = new Map(ids.map((id, k) => [id, k]));
  const lista = [...piezas].sort((a, b) => (rango.has(a.id) ? rango.get(a.id) : ids.length + a.orden) - (rango.has(b.id) ? rango.get(b.id) : ids.length + b.orden) || porOrden(a, b));
  const ancla = lista[0]?.id ?? null, N = lista.length;
  return lista.map((p, k) => {
    if (k === 0) {
      const criterios = p.criterios.filter((c) => c.tipo !== 'cerca' && c.tipo !== 'lejos').map((c) => ({ ...c }));
      if (!criterios.some((c) => c.tipo === 'centro')) criterios.push({ tipo: 'centro', peso: 1 });
      return { ...p, orden: 1, ancla: true, tira: null, criterios, texto: `Your first need: placed first, looking for ${criterios.map((c) => BUSCA[c.tipo]).join(', ')}` };
    }
    const ligada = p.criterios.some((c) => (c.tipo === 'cerca' || c.tipo === 'lejos') && c.con === ancla);
    const peso = N > 2 ? +(PESO_ANCLA.max - ((PESO_ANCLA.max - PESO_ANCLA.min) * (k - 1)) / (N - 2)).toFixed(2) : PESO_ANCLA.max;
    const criterios = p.criterios.map((c) => ({ ...c }));
    if (!ligada) criterios.push({ tipo: 'cerca', con: ancla, peso });
    return { ...p, orden: k + 1, ancla: false, tira: ligada ? null : { con: ancla, peso }, criterios };
  });
}

export function generarAsentamiento(t, piezas, opc = {}) {
  const { n, m, alturas } = t, R = opc.radio_m;
  const centro = { fila: opc.centro?.fila ?? (n - 1) / 2, col: opc.centro?.col ?? (n - 1) / 2 };
  const cf = centro.fila, cc = centro.col, fr = Math.round(cf), cr = Math.round(cc);
  const agua = t.agua ?? null, capaSombra = t.capas?.sombra_permanente ?? null, apto = opc.apto ?? null;
  const luz = opc.luz && typeof opc.luz.pasos === 'function' && opc.luz.total > 0 ? opc.luz : null;
  const sepMin = opc.separacion_min_m ?? 0, maxCand = opc.maxCandidatos ?? 40000;
  // opc.cumple(pieza, fila, col): otros límites publicados que se miden en la celda (p. ej. temperatura); duro como la pendiente.
  const extra = typeof opc.cumple === 'function' ? opc.cumple : null;
  // opc.ocupadas: [{ equipo, fila, col, huella_m }] ya plantado a mano: ocupa sitio y cuenta para las separaciones publicadas.
  const ocupadas = Array.isArray(opc.ocupadas) ? opc.ocupadas : [];
  // opc.margen_separacion_m: holgura añadida al exigir una separación (p. ej. el redondeo de la celda gemela en otra rejilla).
  const margenSep = opc.margen_separacion_m ?? 0;

  // Disco por filas: [fila, primera col, última col] con distancia al centro ≤ R.
  const rc = R / m, dentro = (f, c) => Math.hypot(f - cf, c - cc) * m <= R;
  const filas = [];
  let enDisco = 0;
  for (let f = Math.max(0, Math.ceil(cf - rc) - 1); f <= Math.min(n - 1, Math.floor(cf + rc) + 1); f++) {
    const w = Math.sqrt(Math.max(0, rc * rc - (f - cf) * (f - cf)));
    let a = Math.max(0, Math.ceil(cc - w)), b = Math.min(n - 1, Math.floor(cc + w));
    while (a <= b && !dentro(f, a)) a++;
    while (b >= a && !dentro(f, b)) b--;
    if (a > b) continue;
    while (a > 0 && dentro(f, a - 1)) a--;
    while (b < n - 1 && dentro(f, b + 1)) b++;
    filas.push([f, a, b]);
    enDisco += b - a + 1;
  }
  const paso = Math.max(1, Math.ceil(Math.sqrt(enDisco / maxCand)));

  const lista = [];
  for (const [f, a, b] of filas) {
    if (modulo(f - fr, paso)) continue;
    for (let c = a + modulo(cr - a, paso); c <= b; c += paso) {
      const i = f * n + c;
      if (!Number.isFinite(alturas[i]) || (agua && agua[i] >= 1) || (apto && !apto(f, c))) continue;
      const pe = pendienteGrados(alturas, n, m, f, c);
      if (Number.isFinite(pe)) lista.push(f, c, pe);
    }
  }
  const K = lista.length / 3;
  const CF = new Int32Array(K), CC = new Int32Array(K), PE = new Float64Array(K), DC = new Float64Array(K), LU = new Float64Array(K).fill(NaN);
  for (let k = 0; k < K; k++) {
    CF[k] = lista[3 * k]; CC[k] = lista[3 * k + 1]; PE[k] = lista[3 * k + 2];
    DC[k] = Math.hypot(CF[k] - cf, CC[k] - cc) * m;
    if (luz) {
      const v = luz.pasos(CF[k] * n + CC[k]);
      if (Number.isFinite(v)) LU[k] = v;
    }
  }

  let sombraDe = null, SD = null;
  if (capaSombra) {
    const refs = [];
    for (const [f, a, b] of filas) for (let c = a; c <= b; c++) if (capaSombra[f * n + c] === 1) refs.push(f, c);
    if (refs.length) {
      sombraDe = 'sombra_permanente';
      let pts = refs;
      const nS = refs.length / 2;
      if (nS > MAX_REF_SOMBRA) {
        const z = Math.ceil(Math.sqrt(nS / MAX_REF_SOMBRA));
        pts = [];
        for (let j = 0; j < refs.length; j += 2) if (!modulo(refs[j] - fr, z) && !modulo(refs[j + 1] - cr, z)) pts.push(refs[j], refs[j + 1]);
        // Mancha fina que la zancada no toca: una de cada s en orden de lectura.
        if (!pts.length) for (let j = 0, s = 2 * Math.ceil(nS / MAX_REF_SOMBRA); j < refs.length; j += s) pts.push(refs[j], refs[j + 1]);
      }
      const P2 = Int32Array.from(pts);
      SD = new Float64Array(K);
      for (let k = 0; k < K; k++) {
        if (capaSombra[CF[k] * n + CC[k]] === 1) continue;
        let min = Infinity;
        for (let j = 0; j < P2.length; j += 2) {
          const df = CF[k] - P2[j], dc = CC[k] - P2[j + 1], q = df * df + dc * dc;
          if (q < min) min = q;
        }
        SD[k] = Math.sqrt(min) * m;
      }
    }
  }
  if (!sombraDe && luz) sombraDe = 'luz';

  const orden = [...piezas].sort(porOrden), porId = new Map(orden.map((p) => [p.id, p])), pos = new Map();
  const d2 = (k, j) => { const df = CF[k] - CF[j], dc = CC[k] - CC[j]; return df * df + dc * dc; };
  const distM = (k, j) => Math.sqrt(d2(k, j)) * m;
  const distA = (k, o) => Math.hypot(CF[k] - o.f, CC[k] - o.c) * m;
  const refPend = (p) => (p.limite && p.limite.valor > 0 ? p.limite.valor : PENDIENTE_REF_DEG);
  const cumplePend = (p, k) => !p.limite || CUMPLE[p.limite.op](PE[k], p.limite.valor);
  const cumpleExtra = (p, k) => !extra || !!extra(p, CF[k], CC[k]);
  const cumpleSep = (s, d) => (s.estricto ? d > s.min_m : d >= s.min_m);

  const planDe = (p, colocadas) => {
    const plan = (p.criterios ?? []).map((c) => {
      const x = { tipo: c.tipo, con: c.con ?? null, peso: c.peso, usado: false, motivo: null, ref: -1 };
      if (c.tipo === 'pendiente' || c.tipo === 'centro') x.usado = true;
      else if (c.tipo === 'luz') { if (luz) x.usado = true; else x.motivo = 'no light map'; }
      else if (c.tipo === 'sombra') { if (sombraDe) x.usado = true; else x.motivo = 'no shadow data'; }
      else if (c.tipo === 'cerca' || c.tipo === 'lejos') {
        if (colocadas.includes(c.con)) { x.usado = true; x.ref = pos.get(c.con); } else x.motivo = `${c.con} not placed`;
      } else x.motivo = 'unknown criterion';
      return x;
    });
    if (!plan.some((x) => x.usado)) plan.push({ tipo: 'centro', con: null, peso: 1, usado: true, motivo: null, ref: -1 });
    return plan;
  };
  // Sin dato de luz en una celda usada = el peor valor (nunca la favorece).
  const costeDe = (x, k, rp) => {
    switch (x.tipo) {
      case 'pendiente': return recorte(PE[k] / rp);
      case 'centro': return recorte(DC[k] / R);
      case 'luz': return Number.isFinite(LU[k]) ? recorte(1 - LU[k] / luz.total) : 1;
      case 'sombra':
        if (sombraDe === 'sombra_permanente') return recorte(SD[k] / (2 * R));
        return Number.isFinite(LU[k]) ? recorte(LU[k] / luz.total) : 1;
      case 'cerca': return recorte(distM(k, x.ref) / (2 * R));
      default: return recorte(1 - distM(k, x.ref) / (2 * R));
    }
  };
  const valorDe = (x, k) => {
    switch (x.tipo) {
      case 'pendiente': return PE[k];
      case 'centro': return DC[k];
      case 'luz': return Number.isFinite(LU[k]) ? LU[k] : null;
      case 'sombra':
        if (sombraDe === 'sombra_permanente') return SD[k];
        return Number.isFinite(LU[k]) ? 1 - LU[k] / luz.total : null;
      default: return distM(k, x.ref);
    }
  };
  const coste = (plan, k, rp) => {
    let s = 0, w = 0;
    for (const x of plan) if (x.usado) { s += x.peso * costeDe(x, k, rp); w += x.peso; }
    return w > 0 ? s / w : 0;
  };

  // Huecos y separaciones publicadas respecto a las colocadas y a lo ya plantado a mano, en los dos sentidos.
  const contexto = (p, colocadas) => {
    const huecos = [], seps = [];
    const frente = (id, huella, f, c, sepsDeOtra) => {
      const min = Math.max(((p.huella_m ?? 0) + (huella ?? 0)) / 2 + HOLGURA_M, sepMin) / m;
      huecos.push({ f, c, min2: min * min });
      for (const s of p.separaciones ?? []) if (s.con === id) seps.push({ f, c, min_m: s.min_m, estricto: s.req?.op === '>', etiqueta: `separacion:${id}` });
      for (const s of sepsDeOtra ?? []) if (s.con === p.id) seps.push({ f, c, min_m: s.min_m, estricto: s.req?.op === '>', etiqueta: `${id}>separacion:${p.id}` });
    };
    for (const id of colocadas) { const o = porId.get(id), j = pos.get(id); frente(id, o.huella_m, CF[j], CC[j], o.separaciones); }
    for (const o of ocupadas) frente(o.equipo, o.huella_m, o.fila, o.col, porId.get(o.equipo)?.separaciones);
    return { huecos, seps };
  };
  const violaciones = (p, k, seps) => {
    const v = new Set();
    if (!cumplePend(p, k)) v.add('pendiente');
    if (!cumpleExtra(p, k)) v.add('limite');
    for (const s of seps) if (!cumpleSep(s, distA(k, s))) v.add(s.etiqueta);
    return v;
  };
  const mejor = (c, k, cb, kb) => c < cb - EPS || (c <= cb + EPS && DC[k] < DC[kb] - EPS);

  // Todo cumple → menor coste; si no, se suelta el límite medido en la celda, luego la separación (máxima holgura) y por último la pendiente (la menor).
  const colocar = (p, colocadas) => {
    const { huecos, seps } = contexto(p, colocadas), plan = planDe(p, colocadas), rp = refPend(p);
    let k1 = -1, c1 = 0, k1b = -1, c1b = 0, k2 = -1, c2 = 0, h2 = 0, k3 = -1, c3 = 0;
    for (let k = 0; k < K; k++) {
      let libre = true;
      for (const o of huecos) {
        const df = CF[k] - o.f, dc = CC[k] - o.c, q = df * df + dc * dc;
        if (q === 0 || q < o.min2) { libre = false; break; }
      }
      if (!libre) continue;
      const okA = cumplePend(p, k);
      let okB = true, holgura = Infinity;
      for (const s of seps) {
        const d = distA(k, s) - margenSep;
        if (!cumpleSep(s, d)) okB = false;
        if (d - s.min_m < holgura) holgura = d - s.min_m;
      }
      const c = coste(plan, k, rp);
      // Un límite medido en la celda que ningún sitio cumple (p. ej. frío en todo el disco) no arrastra la pieza: se ignora y se dice.
      if (okA && okB) {
        if (cumpleExtra(p, k)) { if (k1 < 0 || mejor(c, k, c1, k1)) { k1 = k; c1 = c; } }
        else if (k1 < 0 && (k1b < 0 || mejor(c, k, c1b, k1b))) { k1b = k; c1b = c; }
      } else if (okA) { if (k2 < 0 || holgura > h2 + EPS || (holgura >= h2 - EPS && mejor(c, k, c2, k2))) { k2 = k; c2 = c; h2 = holgura; } }
      if (k3 < 0 || PE[k] < PE[k3] - EPS || (PE[k] <= PE[k3] + EPS && mejor(c, k, c3, k3))) { k3 = k; c3 = c; }
    }
    const k = k1 >= 0 ? k1 : k1b >= 0 ? k1b : k2 >= 0 ? k2 : k3;
    return k < 0 ? null : { k, viol: violaciones(p, k, seps) };
  };

  const colocadas = [], sin_sitio = [];
  for (const p of orden) {
    const r = K ? colocar(p, colocadas) : null;
    if (!r) { sin_sitio.push({ id: p.id, motivo: K ? SIN_HUECO : SIN_SUELO }); continue; }
    pos.set(p.id, r.k);
    colocadas.push(p.id);
  }
  for (const id of colocadas.slice(1)) {
    const p = porId.get(id), otras = colocadas.filter((x) => x !== id), actual = pos.get(id);
    const r = colocar(p, otras);
    if (!r || r.k === actual) continue;
    const plan = planDe(p, otras), rp = refPend(p);
    if (coste(plan, r.k, rp) >= coste(plan, actual, rp) - EPS) continue;
    const antes = violaciones(p, actual, contexto(p, otras).seps);
    if ([...r.viol].every((x) => antes.has(x))) pos.set(id, r.k);
  }

  const resultado = colocadas.map((id) => {
    const p = porId.get(id), k = pos.get(id), plan = planDe(p, colocadas.filter((x) => x !== id)), rp = refPend(p);
    const incumple = new Set();
    if (!cumplePend(p, k)) incumple.add('pendiente');
    if (!cumpleExtra(p, k)) incumple.add('limite');
    for (const s of p.separaciones ?? []) {
      const sep = { min_m: s.min_m, estricto: s.req?.op === '>' };
      if (s.con !== id && pos.has(s.con) && !cumpleSep(sep, distM(k, pos.get(s.con)))) incumple.add(`separacion:${s.con}`);
      for (const o of ocupadas) if (o.equipo === s.con && !cumpleSep(sep, distA(k, { f: o.fila, c: o.col }))) incumple.add(`separacion:${s.con}`);
    }
    let s = 0, w = 0;
    const criterios = plan.map((x) => {
      if (!x.usado) return { tipo: x.tipo, con: x.con, peso: x.peso, valor: null, coste: null, usado: false, motivo: x.motivo };
      const c = costeDe(x, k, rp);
      s += x.peso * c;
      w += x.peso;
      return { tipo: x.tipo, con: x.con, peso: x.peso, valor: valorDe(x, k), coste: c, usado: true, motivo: null };
    });
    return {
      id, fila: CF[k], col: CC[k], dist_centro_m: DC[k], pendiente_deg: PE[k], luz: Number.isFinite(LU[k]) ? LU[k] : null,
      coste: w > 0 ? s / w : 0, incumple: [...incumple], criterios,
    };
  });

  return { radio_m: R, centro, paso, candidatos: K, usaLuz: !!luz, sombraDe, piezas: resultado, sin_sitio };
}
