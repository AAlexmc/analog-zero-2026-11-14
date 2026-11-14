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

  function buscar(objetivo, opc = {}) {
    const n = opc.n ?? 5;
    const sep = opc.separacion_km ?? 500;
    const pesos = opc.pesos ?? {};
    const conCasquete = opc.incluir_casquete === true;
    const soloCompletos = opc.completos !== false;
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
    const orden = [];
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

    const noRepro = indice.parametros.filter((p) => !p.reproducible_en_tierra);
    const noReproEn = (i) => noRepro.map((p) => {
      const vt = i === null ? (p.capas?.earth ? null : valorEn(p, 'earth', 0)) : valorEn(p, 'earth', i);
      const vo = finito(valores[p.id]) ? valores[p.id] : null;
      return { id: p.id, valor_tierra: vt, valor_objetivo: vo, desviacion_pct: desviacion(p.id, vt, vo) };
    });

    const ficha = ({ i, lat, lon }) => ({
      lat, lon, fila: Math.floor(i / g.ancho), col: i % g.ancho, similitud_pct: sim[i], comparados: cobertura[i], de: total,
      no_reproducibles: noReproEn(i),
      parametros: reproducibles.map((id) => {
        const vt = valorEn(params.get(id).p, 'earth', i);
        const vo = finito(valores[id]) ? valores[id] : null;
        const d = usados.includes(id) ? desviacion(id, vt, vo) : null;
        const estado = vo === null ? 'sin_dato_objetivo' : !usados.includes(id) ? 'no_usado' : vt === null ? 'sin_dato_tierra' : 'ok';
        return { id, valor_tierra: vt, valor_objetivo: vo, desviacion_pct: d, similitud_pct: d === null ? null : 100 - d, estado };
      }),
    });
    const resultados = elegidos.map(ficha);
    const parciales = parcialesI.map(ficha);

    // Parámetro con capa en la Tierra: el valor de la mejor celda (cada resultado lleva el suyo).
    const no_reproducibles = noReproEn(elegidos.length ? elegidos[0].i : null);

    return { objetivo, usados, sin_dato, resultados, parciales, no_reproducibles, mapa, cobertura };
  }

  return { indice, leerPunto, desviacion, buscar };
}
