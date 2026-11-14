// Reparto de instalaciones: zona apta según el catálogo, transformada de distancia y TOPSIS. Sin DOM.
const CUMPLE = { '<=': (v, l) => v <= l, '<': (v, l) => v < l, '>=': (v, l) => v >= l, '>': (v, l) => v > l };
const CAPA_DE = { iluminacion_frac: 'iluminacion', sombra_permanente: 'sombra_permanente' };
const INF = 1e20;

// Distancia euclídea exacta (m) a la celda marcada más cercana; Felzenszwalb y Huttenlocher, por filas y luego por columnas.
export function transformadaDistancia(marca, n, m) {
  const d2 = new Float64Array(n * n);
  for (let i = 0; i < n * n; i++) d2[i] = marca[i] ? 0 : INF;
  const f = new Float64Array(n), out = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  const pasada = () => {
    let k = 0;
    v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
    for (let q = 1; q < n; q++) {
      let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) {
        k--;
        s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      }
      k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
    }
    k = 0;
    for (let q = 0; q < n; q++) {
      while (z[k + 1] < q) k++;
      out[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
    }
  };
  for (let c = 0; c < n; c++) {
    for (let r = 0; r < n; r++) f[r] = d2[r * n + c];
    pasada();
    for (let r = 0; r < n; r++) d2[r * n + c] = out[r];
  }
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) f[c] = d2[r * n + c];
    pasada();
    for (let c = 0; c < n; c++) d2[r * n + c] = out[c];
  }
  const res = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) res[i] = d2[i] >= INF / 2 ? Infinity : Math.sqrt(d2[i]) * m;
  return res;
}

// X: N alternativas × k criterios por filas. Pesos normalizados a suma 1. Devuelve la cercanía relativa al ideal (0-1).
export function topsis(X, N, pesos, beneficio) {
  const k = pesos.length, sw = pesos.reduce((a, b) => a + b, 0);
  const w = pesos.map((p) => p / sw);
  const norma = new Float64Array(k);
  for (let i = 0; i < N; i++) for (let j = 0; j < k; j++) norma[j] += X[i * k + j] ** 2;
  for (let j = 0; j < k; j++) norma[j] = Math.sqrt(norma[j]) || 1;
  const best = new Float64Array(k).fill(-Infinity), peor = new Float64Array(k).fill(Infinity);
  const V = new Float64Array(N * k);
  for (let i = 0; i < N; i++) for (let j = 0; j < k; j++) {
    const x = (w[j] * X[i * k + j]) / norma[j];
    V[i * k + j] = x;
    if (x > best[j]) best[j] = x;
    if (x < peor[j]) peor[j] = x;
  }
  for (let j = 0; j < k; j++) if (!beneficio[j]) [best[j], peor[j]] = [peor[j], best[j]];
  const C = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    let sp = 0, sm = 0;
    for (let j = 0; j < k; j++) { const x = V[i * k + j]; sp += (x - best[j]) ** 2; sm += (x - peor[j]) ** 2; }
    sp = Math.sqrt(sp); sm = Math.sqrt(sm);
    C[i] = sp + sm > 0 ? sm / (sp + sm) : 1;
  }
  return C;
}

// t = {n, m, pend (retocada), capas}; opc.plantados = [{equipo, fila, col}] del panel.
// Devuelve mascara (1 = cumple todos los requisitos medibles aquí) o null si no hay ninguno medible.
export function zonaApta(t, equipo, opc) {
  const { n, m, pend, capas = {} } = t;
  const N = n * n, pruebas = [], aplicados = [], omitidos = [];
  for (const r of equipo.requisitos ?? []) {
    if (r.valor === null || r.valor === undefined) { omitidos.push({ req: r, motivo: 'no public limit' }); continue; }
    const cumple = CUMPLE[r.op];
    if (!cumple) { omitidos.push({ req: r, motivo: `unknown operator ${r.op}` }); continue; }
    if (r.variable === 'pendiente_deg') {
      pruebas.push((i) => Number.isFinite(pend[i]) && cumple(pend[i], r.valor));
      aplicados.push({ req: r, como: 'cell slope of the retouched DEM (isotropic)' });
    } else if (r.variable === 'temp_k') {
      const sup = r.op === '<=' || r.op === '<';
      const capa = sup ? capas.temp_max : capas.temp_min ?? null;
      if (capa) {
        pruebas.push((i) => Number.isFinite(capa[i]) && cumple(capa[i], r.valor));
        aplicados.push({ req: r, como: `${sup ? 'temp_max' : 'temp_min'} layer` });
      } else if (!sup && capas.temp_max) {
        const tm = capas.temp_max;
        pruebas.push((i) => !(Number.isFinite(tm[i]) && !cumple(tm[i], r.valor)));
        aplicados.push({ req: r, parcial: true, como: 'applied only in part: only drops cells whose maximum temperature is already below this lower limit (no minimum-temperature layer); the sheet cannot confirm the rest' });
      } else omitidos.push({ req: r, motivo: 'no temperature layer on this terrain' });
    } else if (CAPA_DE[r.variable]) {
      const capa = capas[CAPA_DE[r.variable]];
      if (capa) {
        pruebas.push((i) => Number.isFinite(capa[i]) && cumple(capa[i], r.valor));
        aplicados.push({ req: r, como: `${CAPA_DE[r.variable]} layer` });
      } else omitidos.push({ req: r, motivo: `no ${CAPA_DE[r.variable]} layer on this terrain` });
    } else if (r.variable === 'separacion_m') {
      const refs = (opc.plantados ?? []).filter((q) => q.equipo === r.respecto_a);
      if (!refs.length) { omitidos.push({ req: r, motivo: `plant a ${r.respecto_a} to apply it` }); continue; }
      pruebas.push((i) => {
        const f = Math.floor(i / n), c = i % n;
        let d = Infinity;
        for (const q of refs) d = Math.min(d, Math.hypot(q.fila - f, q.col - c) * m);
        return cumple(d, r.valor);
      });
      aplicados.push({ req: r, como: `straight line on the map plane to the nearest planted ${r.respecto_a}` });
    } else if (r.variable === 'horas_en_sombra' || r.variable === 'distancia_recorrido_km') {
      omitidos.push({ req: r, motivo: 'needs a route, not a property of a cell' });
    } else omitidos.push({ req: r, motivo: `"${r.variable}" is not measured by this viewer` });
  }
  const cotaSuperior = aplicados.some((a) => a.parcial);
  const agua = capas.agua ?? null;
  if (!pruebas.length) return { mascara: null, aplicados, omitidos, celdas: 0, frac: 0, cotaSuperior, agua: agua && { celdas: 0 } };
  const mascara = new Uint8Array(N);
  let celdas = 0, quitadas = 0;
  for (let i = 0; i < N; i++) {
    let ok = Number.isFinite(pend[i]);
    for (let k = 0; ok && k < pruebas.length; k++) ok = pruebas[k](i);
    if (ok && agua && agua[i] >= 1) { quitadas++; ok = false; }
    if (ok) { mascara[i] = 1; celdas++; }
  }
  return { mascara, aplicados, omitidos, celdas, frac: celdas / N, cotaSuperior, agua: agua && { celdas: quitadas } };
}

// criterios = [{id, valores: Float32Array por celda, beneficio, peso}]; las N mejores separadas ≥ separacion_m.
export function sugerir({ n, m, mascara, criterios, N = 5, separacion_m = 1000 }) {
  const k = criterios.length, cand = [];
  for (let i = 0; i < n * n; i++) {
    if (!mascara[i]) continue;
    let ok = true;
    for (let j = 0; ok && j < k; j++) ok = Number.isFinite(criterios[j].valores[i]);
    if (ok) cand.push(i);
  }
  if (!cand.length) return [];
  const X = new Float64Array(cand.length * k);
  cand.forEach((i, a) => { for (let j = 0; j < k; j++) X[a * k + j] = criterios[j].valores[i]; });
  const C = topsis(X, cand.length, criterios.map((c) => c.peso), criterios.map((c) => c.beneficio));
  const orden = Uint32Array.from(cand.keys()).sort((a, b) => C[b] - C[a] || cand[a] - cand[b]);
  const sep = separacion_m / m, out = [];
  for (const a of orden) {
    const i = cand[a], f = Math.floor(i / n), c = i % n;
    if (out.some((s) => Math.hypot(s.fila - f, s.col - c) < sep)) continue;
    out.push({ i, fila: f, col: c, puntuacion: C[a], valores: Object.fromEntries(criterios.map((cr) => [cr.id, cr.valores[i]])) });
    if (out.length >= N) break;
  }
  return out;
}
