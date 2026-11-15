// Búsqueda de análogos en la Tierra para un punto de la Luna o de Marte. Sin DOM. Métrica: docs/metrica-analogos.md.
import { celdaDeLatLon, latLonDeCelda } from '../mapa/rejilla.js';

export async function fetchBinario(url, tipo) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${url}`);
  return tipo === 'json' ? r.json() : r.arrayBuffer();
}

const finito = (v) => typeof v === 'number' && Number.isFinite(v);

function transformador(p) {
  if (p.transformacion === 'categoria') return (v) => v;
  const { min, max } = p.rango_ref;
  if (p.transformacion === 'log10') return (v) => Math.log10(Math.max(v, min));
  if (p.transformacion === 'log1p') return (v) => Math.log10(1 + Math.max(v, 0));
  if (p.transformacion === 'lineal') return (v) => v;
  throw new Error(`transformacion desconocida: ${p.transformacion} (${p.id})`);
}

function aF32(buf, n, ruta) {
  if (buf.byteLength !== n * 4) throw new Error(`${ruta}: ${buf.byteLength} bytes, se esperaban ${n * 4}`);
  const dv = new DataView(buf);
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = dv.getFloat32(i * 4, true);
  return a;
}

function aI16(buf, n, ruta) {
  if (buf.byteLength !== n * 2) throw new Error(`${ruta}: ${buf.byteLength} bytes, se esperaban ${n * 2}`);
  const dv = new DataView(buf);
  const a = new Int16Array(n);
  for (let i = 0; i < n; i++) a[i] = dv.getInt16(i * 2, true);
  return a;
}

function distanciaKm(R, lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 +
    Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(Math.min(1, a)));
}

// A x = y (Gauss con pivote parcial); null si A es singular.
function resolver(A, y) {
  const n = y.length;
  const M = A.map((f, i) => [...f, y[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (!(Math.abs(M[p][c]) > 1e-12)) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) {
      const k = M[r][c] / M[c][c];
      for (let j = c; j <= n; j++) M[r][j] -= k * M[c][j];
    }
  }
  const x = new Array(n).fill(0);
  for (let c = n - 1; c >= 0; c--) {
    let s = M[c][n];
    for (let j = c + 1; j < n; j++) s -= M[c][j] * x[j];
    x[c] = s / M[c][c];
  }
  return x;
}

export async function cargar(base = '../data/cuerpos/', leer = fetchBinario) {
  const indice = await leer(base + 'indice.json', 'json');
  const g = indice.rejilla;
  const R = { ancho: g.ancho, alto: g.alto, paso: g.paso_deg, lat0: g.lat0, lon0: g.lon0, fila0: g.fila0 };
  const N = g.ancho * g.alto;
  const rutas = new Set([indice.mascara_tierra, indice.mascara_casquete].filter(Boolean));
  // Parámetros solo-Tierra: su valor objetivo sale de una celda de referencia de la Tierra, no del punto.
  const todos = [...indice.parametros, ...(indice.parametros_tierra ?? [])];
  for (const p of todos) for (const r of Object.values(p.capas ?? {})) if (r) rutas.add(r);
  const capas = new Map();
  await Promise.all([...rutas].map(async (r) => capas.set(r, aF32(await leer(base + r, 'f32'), N, r))));

  const params = new Map(todos.map((p) => {
    const f = transformador(p);
    const cat = p.transformacion === 'categoria';
    return [p.id, { p, f, den: cat ? NaN : f(p.rango_ref.max) - f(p.rango_ref.min), cat }];
  }));
  const soloTierra = (id) => params.get(id).p.solo_tierra === true;
  const tierra = capas.get(indice.mascara_tierra);
  const casquete = indice.mascara_casquete ? capas.get(indice.mascara_casquete) : null;
  const radioTierra = indice.cuerpos.earth.radio_km;

  // Capas mensuales de la Tierra (p.meses): 12 meses seguidos en Int16; solo se bajan con cargarMeses.
  const conMeses = todos.filter((p) => p.meses?.earth).map((p) => p.id);
  const meses = new Map();
  const bajando = new Map();
  async function cargarMeses(ids = conMeses) {
    for (const id of ids) {
      if (!params.has(id)) throw new Error(`parámetro desconocido: ${id}`);
      if (!conMeses.includes(id)) throw new Error(`sin versión mensual: ${id}`);
    }
    await Promise.all(ids.map((id) => {
      if (!bajando.has(id)) {
        const m = params.get(id).p.meses;
        bajando.set(id, leer(base + m.earth, 'i16').then((b) => { meses.set(id, aI16(b, 12 * N, m.earth)); })
          .catch((e) => { bajando.delete(id); throw e; }));
      }
      return bajando.get(id);
    }));
    return [...ids];
  }
  function valorMes(id, i, mes) {
    const m = params.get(id).p.meses;
    const k = meses.get(id)[(mes - 1) * N + i];
    return k === m.sin_dato ? null : k * m.escala + m.desplazamiento;
  }
  const usaMes = (id, mes) => mes !== null && meses.has(id);
  const valorTierra = (id, i, mes = null) => (usaMes(id, mes) ? valorMes(id, i, mes) : valorEn(params.get(id).p, 'earth', i));
  function mesDe(opc) {
    if (opc.mes === undefined || opc.mes === null) return null;
    if (!Number.isInteger(opc.mes) || opc.mes < 1 || opc.mes > 12) throw new Error(`mes fuera de 1-12: ${opc.mes}`);
    if (opc.metrica === 'componentes') throw new Error('metrica componentes: no admite mes');
    return opc.mes;
  }
  function exigeMeses(ids) {
    const faltan = ids.filter((id) => conMeses.includes(id) && !meses.has(id));
    if (faltan.length) throw new Error(`faltan las capas mensuales de ${faltan.join(', ')}: llama antes a cargarMeses`);
  }

  // Clases de entorno (pipeline/clases). Sin el fichero, el motor sigue igual y clases = null.
  let clases = null;
  if (indice.clases) {
    try {
      clases = await leer(base + indice.clases, 'json');
      if (!clases.pca.parametros.every((id) => params.has(id))) clases = null;
    } catch {
      clases = null;
    }
  }

  // Valores de la Tierra ya transformados, por parámetro (NaN = sin dato).
  const tierraF = new Map();
  // Del mes solo se guarda el último pedido: 12 meses × parámetros no caben en memoria como Float64.
  let tierraFMes = { mes: null, capas: new Map() };
  function tierraTransformada(id, mes = null) {
    if (usaMes(id, mes)) {
      if (tierraFMes.mes !== mes) tierraFMes = { mes, capas: new Map() };
      if (!tierraFMes.capas.has(id)) {
        const { f } = params.get(id);
        const a = new Float64Array(N).fill(NaN);
        for (let i = 0; i < N; i++) {
          const v = valorMes(id, i, mes);
          if (v !== null) a[i] = f(v);
        }
        tierraFMes.capas.set(id, a);
      }
      return tierraFMes.capas.get(id);
    }
    if (!tierraF.has(id)) {
      const { p, f } = params.get(id);
      const a = new Float64Array(N).fill(NaN);
      const capa = p.capas?.earth ? capas.get(p.capas.earth) : null;
      const k = p.constante?.earth;
      for (let i = 0; i < N; i++) {
        const v = capa ? capa[i] : k;
        if (finito(v)) a[i] = f(v);
      }
      tierraF.set(id, a);
    }
    return tierraF.get(id);
  }

  function valorEn(p, cuerpo, i) {
    const r = p.capas?.[cuerpo];
    if (r) {
      const v = capas.get(r)[i];
      return Number.isFinite(v) ? v : null;
    }
    const k = p.constante?.[cuerpo];
    return finito(k) ? k : null;
  }

  function leerPunto(cuerpo, lat, lon) {
    if (!indice.cuerpos[cuerpo]) throw new Error(`cuerpo desconocido: ${cuerpo}`);
    const c = celdaDeLatLon(R, lat, lon);
    if (!c) throw new Error(`coordenada fuera de la rejilla: ${lat}, ${lon}`);
    const i = c.fila * g.ancho + c.col;
    const valores = {};
    for (const { p } of params.values()) valores[p.id] = valorEn(p, cuerpo, i);
    return { cuerpo, lat, lon, fila: c.fila, col: c.col, valores };
  }

  function desviacion(param, vTierra, vObjetivo) {
    const e = params.get(typeof param === 'string' ? param : param?.id);
    if (!e) throw new Error(`parámetro desconocido: ${param}`);
    if (!finito(vTierra) || !finito(vObjetivo)) return null;
    // Categoría (criterio propio): misma clase 0 %, otra clase 100 %.
    if (e.cat) return vTierra === vObjetivo ? 0 : 100;
    if (!(e.den > 0)) return null;
    return Math.min(100, (Math.abs(e.f(vTierra) - e.f(vObjetivo)) / e.den) * 100);
  }

  // Componentes blanqueadas de clases.json. Con parámetros que faltan: mínimos cuadrados sobre los que hay.
  function proyectar(transformado) {
    const { parametros: ids, media, desviacion: desv, componentes: V, autovalores: lam } = clases.pca;
    const q = V.length;
    const z = [], hay = [], faltan = [];
    ids.forEach((id, j) => {
      const x = transformado(id);
      if (finito(x)) { z[j] = (x - media[j]) / desv[j]; hay.push(j); } else faltan.push(id);
    });
    let t, r2;
    if (!faltan.length) {
      t = V.map((v) => { let s = 0; for (let j = 0; j < ids.length; j++) s += z[j] * v[j]; return s; });
      r2 = z.reduce((s, x) => s + x * x, 0) - t.reduce((s, x) => s + x * x, 0);
    } else {
      if (hay.length < q) return null;
      const A = V.map((a) => V.map((b) => hay.reduce((s, j) => s + a[j] * b[j], 0)));
      const y = V.map((a) => hay.reduce((s, j) => s + a[j] * z[j], 0));
      t = resolver(A, y);
      if (!t) return null;
      r2 = hay.reduce((s, j) => s + (z[j] - t.reduce((u, x, c) => u + x * V[c][j], 0)) ** 2, 0);
    }
    return { s: t.map((x, c) => x / Math.sqrt(lam[c])), faltan, residuo: Math.sqrt(Math.max(r2, 0)) };
  }

  let puntosTierra = null;
  function puntuacionesTierra() {
    if (!puntosTierra) {
      const q = clases.pca.componentes.length;
      const cols = new Map(clases.pca.parametros.map((id) => [id, tierraTransformada(id)]));
      puntosTierra = new Float64Array(N * q).fill(NaN);
      for (let i = 0; i < N; i++) {
        let completa = true;
        for (const a of cols.values()) if (a[i] !== a[i]) { completa = false; break; }
        if (!completa) continue;
        const pr = proyectar((id) => cols.get(id)[i]);
        for (let c = 0; c < q; c++) puntosTierra[i * q + c] = pr.s[c];
      }
    }
    return puntosTierra;
  }

  const valoresDe = (objetivo) => objetivo.valores ?? leerPunto(objetivo.cuerpo, objetivo.lat, objetivo.lon).valores;
  const transformadoDe = (valores) => (id) => (finito(valores[id]) ? params.get(id).f(valores[id]) : NaN);

  function claseDe(objetivo) {
    if (!clases) return null;
    const valores = valoresDe(objetivo);
    const pr = proyectar(transformadoDe(valores));
    const q = clases.pca.componentes.length;
    const p99 = clases.pca.residuo_z_p99;
    if (!pr) return { id: null, rotulo: null, distancia: null, radio: null, dentro: false, componentes_usadas: q, faltan: clases.pca.parametros.filter((id) => !finito(valores[id])), residuo_z: null, residuo_z_p99_tierra: p99 };
    let mejor = null;
    for (const c of clases.clases) {
      let s = 0;
      for (let k = 0; k < q; k++) s += (pr.s[k] - c.centroide_componentes[k]) ** 2;
      if (!mejor || s < mejor.d2) mejor = { c, d2: s };
    }
    const distancia = Math.sqrt(mejor.d2);
    return { id: mejor.c.id, rotulo: mejor.c.rotulo, distancia, radio: mejor.c.radio, dentro: distancia <= mejor.c.radio, componentes_usadas: q, faltan: pr.faltan, residuo_z: pr.residuo, residuo_z_p99_tierra: p99 };
  }

  const noRepro = indice.parametros.filter((p) => !p.reproducible_en_tierra);
  const noReproEn = (valores, i) => noRepro.map((p) => {
    const vt = i === null ? (p.capas?.earth ? null : valorEn(p, 'earth', 0)) : valorEn(p, 'earth', i);
    const vo = finito(valores[p.id]) ? valores[p.id] : null;
    return { id: p.id, valor_tierra: vt, valor_objetivo: vo, desviacion_pct: desviacion(p.id, vt, vo) };
  });
  const parametrosEn = (objetivos, reproducibles, usados, i, mes = null) => reproducibles.map((id) => {
    const vt = valorTierra(id, i, mes);
    const vo = objetivos[id];
    const ref = soloTierra(id);
    const d = usados.includes(id) ? desviacion(id, vt, vo) : null;
    const estado = vo === null ? (ref ? 'sin_referencia' : 'sin_dato_objetivo') : !usados.includes(id) ? 'no_usado' : vt === null ? 'sin_dato_tierra' : 'ok';
    return { id, valor_tierra: vt, valor_objetivo: vo, desviacion_pct: d, similitud_pct: d === null ? null : 100 - d, estado, origen_objetivo: ref ? 'referencia' : 'punto' };
  });

  // Valor objetivo de cada parámetro comparable: el del punto, o el de la Tierra en opc.referencia si es solo-Tierra.
  function objetivosDe(valores, pedidos, referencia, mes = null) {
    for (const id of pedidos) if (!params.has(id)) throw new Error(`parámetro desconocido: ${id}`);
    let iRef = null;
    if (referencia != null) {
      const c = celdaDeLatLon(R, referencia.lat, referencia.lon);
      if (!c) throw new Error(`referencia fuera de la rejilla: ${referencia.lat}, ${referencia.lon}`);
      iRef = c.fila * g.ancho + c.col;
    }
    const comparables = pedidos.filter((id) => params.get(id).p.reproducible_en_tierra || soloTierra(id));
    const objetivos = {};
    for (const id of comparables) {
      const v = !soloTierra(id) ? valores[id] : iRef === null ? null : valorTierra(id, iRef, mes);
      objetivos[id] = finito(v) ? v : null;
    }
    const sinValor = (ref) => comparables.filter((id) => soloTierra(id) === ref && objetivos[id] === null);
    return { comparables, objetivos, sin_dato: sinValor(false), sin_referencia: sinValor(true) };
  }

  function buscar(objetivo, opc = {}) {
    const n = opc.n ?? 5;
    const sep = opc.separacion_km ?? 500;
    const pesos = opc.pesos ?? {};
    const conCasquete = opc.incluir_casquete === true;
    const soloCompletos = opc.completos !== false;
    const metrica = opc.metrica ?? 'parametros';
    if (metrica !== 'parametros' && metrica !== 'componentes') throw new Error(`metrica desconocida: ${metrica}`);
    const porComp = metrica === 'componentes';
    if (porComp && !clases) throw new Error('metrica componentes: falta clases.json');
    if (porComp && (opc.pesos || opc.parametros)) throw new Error('metrica componentes: usa los parámetros de clases.json, sin pesos ni parametros');
    const mes = mesDe(opc);
    const valores = objetivo.valores ?? leerPunto(objetivo.cuerpo, objetivo.lat, objetivo.lon).valores;
    const pedidos = opc.parametros ?? indice.parametros.filter((p) => p.reproducible_en_tierra).map((p) => p.id);
    const { comparables: reproducibles, objetivos, sin_dato, sin_referencia } = objetivosDe(valores, pedidos, opc.referencia, mes);
    if (mes !== null) exigeMeses(reproducibles);
    const usados = reproducibles.filter((id) => objetivos[id] !== null && (pesos[id] ?? 1) > 0);
    const minimo = Math.ceil(usados.length / 2);

    const cols = usados.map((id) => {
      const { f, den, cat } = params.get(id);
      return { id, a: tierraTransformada(id, mes), fo: f(objetivos[id]), den, cat, w: pesos[id] ?? 1 };
    });
    const mapa = new Float32Array(N).fill(NaN);
    const sim = new Float64Array(N).fill(NaN);
    const cobertura = new Uint8Array(N);
    let orden = [];
    if (usados.length) {
      for (let i = 0; i < N; i++) {
        if (!(tierra[i] >= 0.5)) continue;
        if (!conCasquete && casquete && casquete[i] === 1) continue;
        let sw = 0, ss = 0, k = 0;
        for (const c of cols) {
          const v = c.a[i];
          if (v !== v) continue;
          const d = c.cat ? (v === c.fo ? 0 : 100) : Math.min(100, (Math.abs(v - c.fo) / c.den) * 100);
          sw += c.w; ss += c.w * (100 - d); k++;
        }
        if (k < minimo || !(sw > 0)) continue;
        sim[i] = ss / sw;
        mapa[i] = sim[i];
        cobertura[i] = k;
        orden.push(i);
      }
    }
    orden.sort((a, b) => sim[b] - sim[a] || a - b);

    // Métrica por componentes: distancia euclídea en las componentes blanqueadas; similitud = 100 × (1 − d / d_ref).
    let simParam = null, dist = null, proy = null;
    if (porComp) {
      simParam = Float64Array.from(sim);
      dist = new Float64Array(N).fill(NaN);
      proy = proyectar(transformadoDe(valores));
      const P = puntuacionesTierra(), q = clases.pca.componentes.length, dRef = clases.d_ref.valor;
      const quedan = [];
      for (const i of orden) {
        sim[i] = NaN; mapa[i] = NaN;
        if (!proy || P[i * q] !== P[i * q]) continue;
        let s = 0;
        for (let c = 0; c < q; c++) s += (P[i * q + c] - proy.s[c]) ** 2;
        dist[i] = Math.sqrt(s);
        sim[i] = Math.min(100, Math.max(0, 100 * (1 - dist[i] / dRef)));
        mapa[i] = sim[i];
        quedan.push(i);
      }
      orden = quedan.sort((a, b) => dist[a] - dist[b] || a - b);
    }

    // Una celda a la que le falta un parámetro no paga su desviación: no compite con las comparadas en todo.
    const elegir = (pasa) => {
      const out = [];
      for (const i of orden) {
        if (out.length >= n) break;
        if (!pasa(i)) continue;
        const { lat, lon } = latLonDeCelda(R, Math.floor(i / g.ancho), i % g.ancho);
        if (out.every((e) => distanciaKm(radioTierra, lat, lon, e.lat, e.lon) >= sep)) out.push({ i, lat, lon });
      }
      return out;
    };
    const total = cols.length;
    const elegidos = elegir((i) => !soloCompletos || cobertura[i] === total);
    const parcialesI = soloCompletos ? elegir((i) => cobertura[i] < total) : [];

    const ficha0 = ({ i, lat, lon }) => ({
      lat, lon, fila: Math.floor(i / g.ancho), col: i % g.ancho, similitud_pct: sim[i], comparados: cobertura[i], de: total,
      no_reproducibles: noReproEn(valores, i),
      parametros: parametrosEn(objetivos, reproducibles, usados, i, mes),
    });
    const ficha = porComp ? (x) => ({ ...ficha0(x), similitud_parametros_pct: simParam[x.i], distancia_componentes: dist[x.i] }) : ficha0;
    const resultados = elegidos.map(ficha);
    const parciales = parcialesI.map(ficha);

    // Parámetro con capa en la Tierra: el valor de la mejor celda (cada resultado lleva el suyo).
    const no_reproducibles = noReproEn(valores, elegidos.length ? elegidos[0].i : null);

    const salida = { objetivo, usados, sin_dato, sin_referencia, resultados, parciales, no_reproducibles, mapa, cobertura };
    if (mes !== null) Object.assign(salida, { mes, mensuales: usados.filter((id) => usaMes(id, mes)) });
    if (porComp) {
      salida.metrica = 'componentes';
      salida.componentes = { proyectado: proy !== null, faltan: proy ? proy.faltan : clases.pca.parametros.filter((id) => !finito(valores[id])), d_ref: clases.d_ref.valor, residuo_z: proy ? proy.residuo : null, residuo_z_p99_tierra: clases.pca.residuo_z_p99 };
    }
    return salida;
  }

  // Cartera de análogos: el menor nº de lugares que entre todos cubren cada parámetro cubrible (desviación < corte).
  function cartera(objetivo, opc = {}) {
    const corte = opc.corte ?? 15;
    const sep = opc.separacion_km ?? 0;
    const conCasquete = opc.incluir_casquete === true;
    const mes = mesDe(opc);
    const valores = valoresDe(objetivo);
    const pedidos = opc.parametros ?? indice.parametros.filter((p) => p.reproducible_en_tierra).map((p) => p.id);
    const { comparables: reproducibles, objetivos, sin_dato, sin_referencia } = objetivosDe(valores, pedidos, opc.referencia, mes);
    if (mes !== null) exigeMeses(reproducibles);
    const usados = reproducibles.filter((id) => objetivos[id] !== null);
    if (usados.length > 16) throw new Error('cartera: más de 16 parámetros');
    const minimo = Math.ceil(usados.length / 2);
    const cols = usados.map((id) => {
      const { f, den, cat } = params.get(id);
      return { a: tierraTransformada(id, mes), fo: f(objetivos[id]), den, cat };
    });

    const mejorDesv = usados.map(() => ({ d: Infinity, i: -1 }));
    const mascara = new Int32Array(N);
    const sim = new Float64Array(N).fill(NaN);
    const cobertura = new Uint8Array(N);
    const celdas = [];
    const mejorDeMascara = new Map();
    const ds = new Float64Array(usados.length);
    for (let i = 0; i < N && usados.length; i++) {
      if (!(tierra[i] >= 0.5)) continue;
      if (!conCasquete && casquete && casquete[i] === 1) continue;
      let ss = 0, k = 0, m = 0;
      cols.forEach((c, j) => {
        const v = c.a[i];
        ds[j] = NaN;
        if (v !== v) return;
        ds[j] = c.cat ? (v === c.fo ? 0 : 100) : Math.min(100, (Math.abs(v - c.fo) / c.den) * 100);
        ss += 100 - ds[j]; k++;
        if (ds[j] < corte) m |= 1 << j;
      });
      if (k < minimo) continue;
      for (let j = 0; j < usados.length; j++) if (ds[j] < mejorDesv[j].d) mejorDesv[j] = { d: ds[j], i };
      sim[i] = ss / k; cobertura[i] = k; mascara[i] = m;
      celdas.push(i);
      if (m && (!mejorDeMascara.has(m) || sim[i] > sim[mejorDeMascara.get(m)])) mejorDeMascara.set(m, i);
    }

    // Programación dinámica por capas sobre la unión de máscaras: la primera capa que alcanza la unión total es el
    // mínimo de lugares; dentro de ella, la mayor suma (= media) de similitud de la mejor celda de cada máscara.
    const mascaras = [...mejorDeMascara.keys()].sort((a, b) => a - b);
    const todo = mascaras.reduce((u, m) => u | m, 0);
    let capa = new Map([[0, { v: 0, prev: null, m: 0 }]]);
    const capas = [capa];
    while (todo && !capa.has(todo)) {
      const sig = new Map();
      for (const s of [...capa.keys()].sort((a, b) => a - b)) {
        const e = capa.get(s);
        for (const m of mascaras) {
          const t = s | m;
          if (t === s) continue;
          const v = e.v + sim[mejorDeMascara.get(m)];
          if (!sig.has(t) || v > sig.get(t).v) sig.set(t, { v, prev: s, m });
        }
      }
      capa = sig; capas.push(capa);
    }
    const elegidas = [];
    for (let c = capas.length - 1, s = todo; c > 0; c--) {
      const e = capas[c].get(s);
      elegidas.push(e.m); s = e.prev;
    }
    elegidas.sort((a, b) => sim[mejorDeMascara.get(b)] - sim[mejorDeMascara.get(a)] || mejorDeMascara.get(a) - mejorDeMascara.get(b));

    // Separación (opcional): la mejor celda que cubra al menos esa máscara y quede lejos de las ya elegidas.
    const latLon = (i) => latLonDeCelda(R, Math.floor(i / g.ancho), i % g.ancho);
    let porSim = null, separacion_cumplida = true;
    const lugaresI = [];
    for (const m of elegidas) {
      let i = mejorDeMascara.get(m);
      if (sep > 0) {
        porSim ??= [...celdas].sort((a, b) => sim[b] - sim[a] || a - b);
        const lejos = (x) => { const p = latLon(x); return lugaresI.every((y) => { const q = latLon(y); return distanciaKm(radioTierra, p.lat, p.lon, q.lat, q.lon) >= sep; }); };
        const otra = porSim.find((x) => (mascara[x] & m) === m && lejos(x));
        if (otra === undefined) separacion_cumplida = false; else i = otra;
      }
      lugaresI.push(i);
    }

    const lugares = lugaresI.map((i) => ({
      ...latLon(i), fila: Math.floor(i / g.ancho), col: i % g.ancho, similitud_pct: sim[i], comparados: cobertura[i], de: usados.length,
      cubre: usados.filter((_, j) => mascara[i] & (1 << j)),
      parametros: parametrosEn(objetivos, reproducibles, usados, i, mes),
    }));
    const sin_cubrir = usados.map((id, j) => ({ id, j })).filter(({ j }) => !(todo & (1 << j))).map(({ id, j }) => {
      const b = mejorDesv[j];
      return b.i < 0 ? { id, mejor_desviacion_pct: null, lat: null, lon: null } : { id, mejor_desviacion_pct: b.d, ...latLon(b.i) };
    });
    const out = { corte, usados, sin_dato, sin_referencia, lugares, cubiertos: usados.filter((_, j) => todo & (1 << j)), sin_cubrir };
    if (sep > 0) Object.assign(out, { separacion_km: sep, separacion_cumplida });
    if (mes !== null) Object.assign(out, { mes, mensuales: usados.filter((id) => usaMes(id, mes)) });
    return out;
  }

  // Lo común de perfilMensual y calendario: los mismos usados, objetivos y pesos que buscar.
  function prepararMeses(objetivo, opc) {
    if (opc.metrica !== undefined && opc.metrica !== 'parametros') throw new Error(`metrica ${opc.metrica}: no admite mes`);
    const pesos = opc.pesos ?? {};
    const valores = valoresDe(objetivo);
    const pedidos = opc.parametros ?? indice.parametros.filter((p) => p.reproducible_en_tierra).map((p) => p.id);
    const { comparables } = objetivosDe(valores, pedidos, opc.referencia);
    exigeMeses(comparables);
    // Con referencia, el valor objetivo de un solo-Tierra mensual cambia con el mes.
    const objetivosMes = (mes) => objetivosDe(valores, pedidos, opc.referencia, mes).objetivos;
    const usadosMes = (obj) => comparables.filter((id) => obj[id] !== null && (pesos[id] ?? 1) > 0);
    return { pesos, objetivosMes, usadosMes };
  }
  function celdaI(c, que) {
    const x = celdaDeLatLon(R, c?.lat, c?.lon);
    if (!x) throw new Error(`${que} fuera de la rejilla: ${c?.lat}, ${c?.lon}`);
    return x.fila * g.ancho + x.col;
  }
  // Similitud de la celda i como en buscar (misma suma en el mismo orden); NaN con menos de la mitad.
  function puntuaCelda(usados, objetivos, pesos, i, mes) {
    let sw = 0, ss = 0, k = 0;
    const parametros = usados.map((id) => {
      const vt = valorTierra(id, i, mes);
      const d = desviacion(id, vt, objetivos[id]);
      if (d !== null) { const w = pesos[id] ?? 1; sw += w; ss += w * (100 - d); k++; }
      return { id, valor_tierra: vt, desviacion_pct: d };
    });
    const sim = k < Math.ceil(usados.length / 2) || !(sw > 0) ? null : ss / sw;
    return { similitud_pct: sim, comparados: k, parametros };
  }

  function perfilMensual(objetivo, celda, opc = {}) {
    const { pesos, objetivosMes, usadosMes } = prepararMeses(objetivo, opc);
    const i = celdaI(celda, 'celda');
    return Array.from({ length: 12 }, (_, k) => {
      const obj = objetivosMes(k + 1);
      return { mes: k + 1, ...puntuaCelda(usadosMes(obj), obj, pesos, i, k + 1) };
    });
  }

  // Mejor celda de cada mes con las reglas de buscar (una pasada por mes, sin ordenar); con opc.lugar, su similitud y si hay relevo.
  function calendario(objetivo, opc = {}) {
    const { pesos, objetivosMes, usadosMes } = prepararMeses(objetivo, opc);
    const iLugar = opc.lugar == null ? null : celdaI(opc.lugar, 'lugar');
    const conCasquete = opc.incluir_casquete === true;
    const soloCompletos = opc.completos !== false;
    const out = [];
    for (let mes = 1; mes <= 12; mes++) {
      const objetivos = objetivosMes(mes);
      const usados = usadosMes(objetivos);
      const minimo = Math.ceil(usados.length / 2);
      const cols = usados.map((id) => {
        const { f, den, cat } = params.get(id);
        return { a: tierraTransformada(id, mes), fo: f(objetivos[id]), den, cat, w: pesos[id] ?? 1 };
      });
      let mejor = -1, mejorSim = -Infinity;
      for (let i = 0; i < N && cols.length; i++) {
        if (!(tierra[i] >= 0.5)) continue;
        if (!conCasquete && casquete && casquete[i] === 1) continue;
        let sw = 0, ss = 0, k = 0;
        for (const c of cols) {
          const v = c.a[i];
          if (v !== v) continue;
          const d = c.cat ? (v === c.fo ? 0 : 100) : Math.min(100, (Math.abs(v - c.fo) / c.den) * 100);
          sw += c.w; ss += c.w * (100 - d); k++;
        }
        if (k < minimo || !(sw > 0) || (soloCompletos && k !== cols.length)) continue;
        const sim = ss / sw;
        if (sim > mejorSim) { mejor = i; mejorSim = sim; }
      }
      const x = mejor < 0 ? { mes, lat: null, lon: null, similitud_pct: null }
        : { mes, ...latLonDeCelda(R, Math.floor(mejor / g.ancho), mejor % g.ancho), similitud_pct: mejorSim };
      if (iLugar !== null) {
        x.en_lugar_pct = puntuaCelda(usados, objetivos, pesos, iLugar, mes).similitud_pct;
        x.relevo = mejor < 0 ? null : mejor !== iLugar;
      }
      out.push(x);
    }
    return out;
  }

  // Búsqueda al revés: celdas de `cuerpo` (la Luna o Marte) más parecidas a unos valores de referencia (p. ej. los del
  // sitio de la Tierra donde NASA hace un ensayo), con los parámetros de `ids` que ese cuerpo tiene en capa. Misma
  // desviación que buscar(), media simple. filtro(lat, lon) descarta celdas antes de ordenar.
  function parecidosEnCuerpo(cuerpo, valoresRef, ids, { maximo = 3000, filtro = null, empate_pct = 0.5 } = {}) {
    if (!indice.cuerpos[cuerpo]) throw new Error(`cuerpo desconocido: ${cuerpo}`);
    const usados = [], sin_capa = [], sin_referencia = [];
    for (const id of ids) {
      const e = params.get(id);
      if (!e) throw new Error(`parámetro desconocido: ${id}`);
      const r = e.p.capas?.[cuerpo];
      if (!r) sin_capa.push(id);
      else if (!finito(valoresRef?.[id])) sin_referencia.push(id);
      else usados.push({ id, e, capa: capas.get(r), fo: e.cat ? valoresRef[id] : e.f(valoresRef[id]) });
    }
    const vacio = { usados: usados.map((u) => u.id), sin_capa, sin_referencia, candidatos: [], celdas: 0, empatadas: 0 };
    if (!usados.length) return vacio;
    const orden = [];
    const sim = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      let s = 0, ok = true;
      for (const u of usados) {
        const v = u.capa[i];
        if (v !== v) { ok = false; break; }
        s += u.e.cat ? (v === u.fo ? 0 : 100) : Math.min(100, (Math.abs(u.e.f(v) - u.fo) / u.e.den) * 100);
      }
      if (!ok) continue;
      if (filtro) { const q = latLonDeCelda(R, Math.floor(i / g.ancho), i % g.ancho); if (!filtro(q.lat, q.lon)) continue; }
      sim[i] = 100 - s / usados.length;
      orden.push(i);
    }
    if (!orden.length) return vacio;
    orden.sort((a, b) => sim[b] - sim[a] || a - b);
    const mejor = sim[orden[0]];
    let empatadas = 0;
    while (empatadas < orden.length && sim[orden[empatadas]] >= mejor - empate_pct) empatadas++;
    const candidatos = orden.slice(0, maximo).map((i) => {
      const valores = Object.fromEntries(usados.map((u) => [u.id, u.capa[i]]));
      return { ...latLonDeCelda(R, Math.floor(i / g.ancho), i % g.ancho), i, similitud_pct: sim[i], valores };
    });
    return { ...vacio, candidatos, celdas: orden.length, empatadas };
  }

  return { indice, leerPunto, desviacion, buscar, tierra, clases, claseDe, cartera, conMeses, cargarMeses, perfilMensual, calendario, parecidosEnCuerpo };
}
