// Cálculo de rutas y reparto fuera del hilo de la página.
import { pendientes, caminoMinimo, umbralMinimo, medirRuta, matrizCostes, ordenOptimo, diezmar, aRejillaCompleta, celdasSobreLimite } from './rutas.js';
import { zonaApta, sugerir, transformadaDistancia } from './reparto.js';

// Criterio propio: por encima de esto en la rejilla completa se repite sobre la rejilla diezmada ×2.
const LIMITE_MS = 5000;

function ruta(q) {
  const t0 = performance.now();
  const t = { n: q.n, m: q.m, alturas: q.alturas, sombra: q.sombra, agua: q.agua };
  t.pend = pendientes(t.alturas, t.n, t.m);
  const car = q.carreteras?.length ? q.carreteras : null;
  const opc = { limite: q.limite, factorSombra: q.factor, limiteMs: LIMITE_MS, ...(car ? { carreteras: car } : {}) };
  let r = caminoMinimo(t, q.origen, q.destino, opc), tt = t, diezmado = false, o = q.origen, d = q.destino, carT = car;
  if (r.abortado) {
    diezmado = true;
    tt = diezmar(t);
    tt.pend = pendientes(tt.alturas, tt.n, tt.m);
    const aD = (i) => Math.min(tt.n - 1, Math.round(Math.floor(i / t.n) / 2)) * tt.n + Math.min(tt.n - 1, Math.round((i % t.n) / 2));
    o = aD(q.origen); d = aD(q.destino);
    carT = car ? car.map((cam) => Int32Array.from(cam, aD)) : null;
    r = caminoMinimo(tt, o, d, { ...opc, limiteMs: Infinity, ...(carT ? { carreteras: carT } : {}) });
  }
  const res = { coste: r.coste, diezmado, m: tt.m, pendOrigen: tt.pend[o], pendDestino: tt.pend[d] };
  if (q.agua) { res.aguaOrigen = q.agua[q.origen]; res.aguaDestino = q.agua[q.destino]; }
  const conCar = car ? { carreteras: car } : {};
  if (r.camino && diezmado) {
    // Las cifras y la pendiente se miden sobre la rejilla completa, no sobre la diezmada.
    res.camino = aRejillaCompleta(r.camino, tt.n, t.n, q.origen, q.destino);
    res.medidas = medirRuta(t, res.camino, conCar);
    const c = celdasSobreLimite(t.pend, res.camino, q.limite, car);
    res.sobreLimite = c.sobre; res.sinDatoRuta = c.sinDato;
  } else if (r.camino) {
    res.medidas = medirRuta(tt, r.camino, conCar);
    res.camino = r.camino;
  } else {
    res.umbral = umbralMinimo(tt, o, d, carT ? { carreteras: carT } : {});
  }
  res.ms = performance.now() - t0;
  return res;
}

function visita(q) {
  const t0 = performance.now();
  const t = { n: q.n, m: q.m, alturas: q.alturas, sombra: q.sombra, agua: q.agua };
  t.pend = pendientes(t.alturas, t.n, t.m);
  const car = q.carreteras?.length ? { carreteras: q.carreteras } : {};
  const { M, caminos } = matrizCostes(t, q.puntos, { limite: q.limite, factorSombra: q.factor, ...car });
  const o = ordenOptimo(M);
  const res = { M, ms: 0 };
  if (q.agua) res.aguaParadas = q.puntos.map((i) => q.agua[i]);
  if (o) {
    const k = o.orden.length, partes = [];
    for (let s = 0; s < k; s++) {
      const c = caminos[o.orden[s]][o.orden[(s + 1) % k]];
      partes.push(s ? c.subarray(1) : c);
    }
    const camino = new Int32Array(partes.reduce((a, c) => a + c.length, 0));
    let off = 0;
    for (const c of partes) { camino.set(c, off); off += c.length; }
    Object.assign(res, { orden: o.orden, coste: o.coste, camino, medidas: medirRuta(t, camino, car) });
  }
  res.ms = performance.now() - t0;
  return res;
}

function zona(q) {
  const t0 = performance.now();
  const pend = pendientes(q.alturas, q.n, q.m);
  const z = zonaApta({ n: q.n, m: q.m, pend, capas: q.capas }, q.equipo, { plantados: q.plantados });
  const lim = z.aplicados.find((a) => a.req.variable === 'pendiente_deg')?.req.valor;
  // Para pintar: margen hasta el límite de pendiente en las celdas aptas; NaN fuera.
  let margen = null;
  if (z.mascara && Number.isFinite(lim)) {
    margen = new Float32Array(q.n * q.n).fill(NaN);
    for (let i = 0; i < margen.length; i++) if (z.mascara[i]) margen[i] = lim - pend[i];
  }
  return { ...z, margen, limitePend: lim ?? null, ms: performance.now() - t0 };
}

function sugerencias(q) {
  const t0 = performance.now();
  const { n, m } = q, N = n * n;
  const pend = pendientes(q.alturas, n, m);
  const crit = [];
  for (const c of q.criterios) {
    let valores;
    if (c.id === 'iluminacion') valores = q.capas.iluminacion;
    else if (c.id === 'pendiente') valores = pend;
    else if (c.id === 'dist_sombra') valores = transformadaDistancia(Uint8Array.from(q.capas.sombra_permanente, (v) => (v === 1 ? 1 : 0)), n, m);
    else if (c.id === 'dist_ref') {
      valores = new Float32Array(N);
      for (let i = 0; i < N; i++) valores[i] = Math.hypot(Math.floor(i / n) - q.ref.fila, (i % n) - q.ref.col) * m;
    }
    if (valores) crit.push({ id: c.id, valores, beneficio: c.beneficio, peso: c.peso });
  }
  const lista = sugerir({ n, m, mascara: q.mascara, criterios: crit, N: q.N, separacion_m: q.separacion_m });
  return { lista, ms: performance.now() - t0 };
}

const TAREAS = { ruta, visita, zona, sugerencias };

self.onmessage = ({ data: q }) => {
  try {
    self.postMessage({ id: q.id, ok: true, r: TAREAS[q.tipo](q) });
  } catch (e) {
    self.postMessage({ id: q.id, ok: false, error: e.message });
  }
};
