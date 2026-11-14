// Búsqueda de análogos en la Tierra para un punto de la Luna o de Marte. Sin DOM. Métrica: docs/metrica-analogos.md.
import { celdaDeLatLon, latLonDeCelda } from '../mapa/rejilla.js';

export async function fetchBinario(url, tipo) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${url}`);
  return tipo === 'json' ? r.json() : r.arrayBuffer();
}

const finito = (v) => typeof v === 'number' && Number.isFinite(v);

function transformador(p) {
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
  for (const p of indice.parametros) for (const r of Object.values(p.capas ?? {})) if (r) rutas.add(r);
  const capas = new Map();
  await Promise.all([...rutas].map(async (r) => capas.set(r, aF32(await leer(base + r, 'f32'), N, r))));

  const params = new Map(indice.parametros.map((p) => {
    const f = transformador(p);
    return [p.id, { p, f, den: f(p.rango_ref.max) - f(p.rango_ref.min) }];
  }));
  const tierra = capas.get(indice.mascara_tierra);
  const casquete = indice.mascara_casquete ? capas.get(indice.mascara_casquete) : null;
  const radioTierra = indice.cuerpos.earth.radio_km;

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
  function tierraTransformada(id) {
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
    if (!finito(vTierra) || !finito(vObjetivo) || !(e.den > 0)) return null;
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
  const parametrosEn = (valores, reproducibles, usados, i) => reproducibles.map((id) => {
    const vt = valorEn(params.get(id).p, 'earth', i);
    const vo = finito(valores[id]) ? valores[id] : null;
    const d = usados.includes(id) ? desviacion(id, vt, vo) : null;
    const estado = vo === null ? 'sin_dato_objetivo' : !usados.includes(id) ? 'no_usado' : vt === null ? 'sin_dato_tierra' : 'ok';
    return { id, valor_tierra: vt, valor_objetivo: vo, desviacion_pct: d, similitud_pct: d === null ? null : 100 - d, estado };
  });

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
    const valores = objetivo.valores ?? leerPunto(objetivo.cuerpo, objetivo.lat, objetivo.lon).valores;
    const pedidos = opc.parametros ?? indice.parametros.filter((p) => p.reproducible_en_tierra).map((p) => p.id);
    for (const id of pedidos) if (!params.has(id)) throw new Error(`parámetro desconocido: ${id}`);

    const reproducibles = pedidos.filter((id) => params.get(id).p.reproducible_en_tierra);
    const usados = reproducibles.filter((id) => finito(valores[id]) && (pesos[id] ?? 1) > 0);
    const sin_dato = reproducibles.filter((id) => !finito(valores[id]));
    const minimo = Math.ceil(usados.length / 2);

    const cols = usados.map((id) => {
      const { f, den } = params.get(id);
      return { id, a: tierraTransformada(id), fo: f(valores[id]), den, w: pesos[id] ?? 1 };
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
          const d = Math.min(100, (Math.abs(v - c.fo) / c.den) * 100);
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
      parametros: parametrosEn(valores, reproducibles, usados, i),
    });
    const ficha = porComp ? (x) => ({ ...ficha0(x), similitud_parametros_pct: simParam[x.i], distancia_componentes: dist[x.i] }) : ficha0;
    const resultados = elegidos.map(ficha);
    const parciales = parcialesI.map(ficha);

    // Parámetro con capa en la Tierra: el valor de la mejor celda (cada resultado lleva el suyo).
    const no_reproducibles = noReproEn(valores, elegidos.length ? elegidos[0].i : null);

    const salida = { objetivo, usados, sin_dato, resultados, parciales, no_reproducibles, mapa, cobertura };
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
    const valores = valoresDe(objetivo);
    const reproducibles = indice.parametros.filter((p) => p.reproducible_en_tierra).map((p) => p.id);
    const usados = reproducibles.filter((id) => finito(valores[id]));
    const sin_dato = reproducibles.filter((id) => !finito(valores[id]));
    if (usados.length > 16) throw new Error('cartera: más de 16 parámetros');
    const minimo = Math.ceil(usados.length / 2);
    const cols = usados.map((id) => {
      const { f, den } = params.get(id);
      return { a: tierraTransformada(id), fo: f(valores[id]), den };
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
        ds[j] = Math.min(100, (Math.abs(v - c.fo) / c.den) * 100);
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
      parametros: parametrosEn(valores, reproducibles, usados, i),
    }));
    const sin_cubrir = usados.map((id, j) => ({ id, j })).filter(({ j }) => !(todo & (1 << j))).map(({ id, j }) => {
      const b = mejorDesv[j];
      return b.i < 0 ? { id, mejor_desviacion_pct: null, lat: null, lon: null } : { id, mejor_desviacion_pct: b.d, ...latLon(b.i) };
    });
    const out = { corte, usados, sin_dato, lugares, cubiertos: usados.filter((_, j) => todo & (1 << j)), sin_cubrir };
    if (sep > 0) Object.assign(out, { separacion_km: sep, separacion_cumplida });
    return out;
  }

  return { indice, leerPunto, desviacion, buscar, tierra, clases, claseDe, cartera };
}
