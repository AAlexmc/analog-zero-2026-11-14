// Adaptador visor → informe: lee los paneles, la barra Day y la base, y devuelve un objeto plano (números, cadenas y arrays)
// para construirInforme. Las estadísticas salen de las rejillas que se ven (retocadas, si hay retoque). Sin DOM.
import { pendienteGrados } from '../terreno/calculo.js';
import { DIA_LUNAR_H, FUENTES_SOL, MESES } from '../terreno/sol.js';
import { piezasDe, HOLGURA_M } from '../terreno/asentamiento.js';
import { esDeBase, filaRequisito, PAR_BASE } from '../terreno/asentamiento_ficha.js';
import { cantidad } from '../terreno/evaluar.js';
import { textoMuestreo, textoPunto } from '../terreno/lugar.js';

export const BORDES_PENDIENTE = [...Array.from({ length: 21 }, (_, k) => 2 * k), Infinity];
export const PASOS = 24;
const MUNDO = { luna: 'moon', marte: 'mars', tierra: 'earth' };
const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const num = (v) => (fin(v) ? v : null);

// Mínimo, máximo, media, desviación típica, mediana y percentiles 5/95 (rango más cercano) de los valores finitos.
export function estadistica(valores) {
  const ok = [];
  for (const v of valores) if (fin(v)) ok.push(v);
  const total = valores.length, k = ok.length;
  if (!k) return { total, validas: 0, min: null, max: null, media: null, de: null, mediana: null, p05: null, p95: null };
  const a = Float64Array.from(ok).sort();
  let s = 0;
  for (const v of a) s += v;
  const media = s / k;
  let q = 0;
  for (const v of a) q += (v - media) ** 2;
  const rango = (p) => a[Math.min(k - 1, Math.max(0, Math.ceil(p * k) - 1))];
  return { total, validas: k, min: a[0], max: a[k - 1], media, de: Math.sqrt(q / k), mediana: k % 2 ? a[(k - 1) / 2] : (a[k / 2 - 1] + a[k / 2]) / 2, p05: rango(0.05), p95: rango(0.95) };
}

// Pendiente de cada celda en grados; NaN sin cota o sobre agua (el DEM da la superficie del agua, no el suelo).
export function pendientes(alturas, n, m, agua = null) {
  const out = new Float32Array(n * n).fill(NaN);
  for (let f = 0; f < n; f++) for (let c = 0; c < n; c++) {
    const i = f * n + c;
    if (agua && agua[i] >= 1) continue;
    out[i] = pendienteGrados(alturas, n, m, f, c);
  }
  return out;
}

// Porcentaje de las celdas con dato en cada clase [bordes[k], bordes[k+1]); null si no hay ninguna.
export function histograma(valores, bordes) {
  const c = new Array(bordes.length - 1).fill(0);
  let k = 0;
  for (const v of valores) {
    if (!fin(v)) continue;
    k++;
    for (let b = 0; b < c.length; b++) if (v >= bordes[b] && v < bordes[b + 1]) { c[b]++; break; }
  }
  return k ? c.map((x) => (100 * x) / k) : c.map(() => null);
}

// Las 24 celdas del día de una celda del mapa de luz: sol / sombra del terreno / noche.
export function tiraLuz(mapa, i) {
  if (!mapa || mapa.pendiente || !mapa.bits) return null;
  const v = mapa.bits[i];
  return Array.from({ length: mapa.total ?? PASOS }, (_, k) => ((v >>> k) & 1 ? 'sol' : mapa.soles?.[k] && mapa.soles[k].el > 0 ? 'sombra' : 'noche'));
}

// Parámetro a parámetro con el motor de búsqueda ya cargado (web/buscar/motor.js): nada se recalcula aquí.
export function parecidoDe(motor, mundo, lugar) {
  const ind = motor.indice;
  const a = motor.leerPunto(mundo.clave, mundo.lat, mundo.lon), b = motor.leerPunto('earth', lugar.lat, lugar.lon);
  const fila = (p) => {
    const vo = num(a.valores[p.id]), vt = num(b.valores[p.id]), d = motor.desviacion(p.id, vt, vo);
    return { id: p.id, nombre: p.nombre, unidad: p.unidad, transformacion: p.transformacion ?? null, clases: p.clases ?? null, valor_mundo: vo, valor_tierra: vt, desviacion_pct: num(d), similitud_pct: fin(d) ? 100 - d : null,
      aviso: p.aviso ?? null, fuentes: [p.fuentes?.[mundo.clave], p.fuentes?.earth].filter(Boolean).map((f) => ({ texto: f.texto ?? null, url: f.url ?? null, cita: f.cita ?? null, origen: f.origen ?? null })) };
  };
  return {
    filas: ind.parametros.filter((p) => p.reproducible_en_tierra).map(fila),
    no_reproducibles: ind.parametros.filter((p) => !p.reproducible_en_tierra).map(fila),
    celda_deg: num(ind.rejilla?.paso_deg), formula: ind.metrica?.desviacion_pct ?? null, doc: ind.metrica?.doc ?? null,
    celdas: { mundo: { fila: a.fila, col: a.col }, tierra: { fila: b.fila, col: b.col } },
  };
}

const radioDePar = (par) => { const v = +String(par).slice(PAR_BASE.length).split(':')[0]; return fin(v) && v > 0 ? v : null; };

function fuentesTerreno(meta) {
  const out = [];
  for (const [capa, c] of Object.entries(meta.capas ?? {})) if (c?.fuente) out.push({ capa, texto: c.fuente, url: c.url ?? null, origen: c.origen ?? null });
  return out;
}

function veredicto(r) {
  return { ok: 'OK', rompe: 'BREAKS', cota_inferior: 'LOWER BOUND ONLY', sin_limite: 'NO LIMIT' }[r.estado] ?? 'NOT MEASURED';
}

// ctx: { paneles, catalogo, cuerpos, dia, asentamiento, evaluar, equipoDe, nombreCorto, CUERPO, lugar, punto, mision, mes, exag, espejo,
//        ejemplo, url, enlaceResultados, parecido }.
export function recoger(ctx) {
  const { CUERPO, nombreCorto } = ctx;
  const vivos = ctx.paneles.filter((p) => p.escena);
  const dia = ctx.dia ?? null, S = dia?.estado ?? null;
  const reglas = new Map((Array.isArray(ctx.catalogo?.equipos) ? piezasDe(ctx.catalogo).piezas : []).map((x, i) => [x.id, { numero: i + 1, texto: x.texto, criterios: x.criterios }]));
  const A = ctx.asentamiento?.estado ?? null, res = A?.res ?? null;
  const optimo = new Map((res?.r?.piezas ?? []).map((x) => [x.id, x]));
  // Número de cada pieza = su puesto al colocarla (el de las marcas): orden de la base generada, o «:p<puesto>» guardado en la clave.
  // La regla y el número que enseña la pantalla (cambian con el modo de la base): los da el panel.
  const dePanel = (id) => ctx.asentamiento?.reglaDe?.(id) ?? null;
  const numeroDe = (it) => {
    if (dePanel(it.equipo)?.numero) return dePanel(it.equipo).numero;
    const k = res?.orden?.indexOf?.(it.equipo) ?? -1;
    if (k >= 0) return k + 1;
    const p = /:p(\d+)$/.exec(String(it.par ?? ''));
    return p ? +p[1] : reglas.get(it.equipo)?.numero ?? null;
  };

  const paneles = vivos.map((p) => {
    const e = p.escena, meta = e.meta, n = e.n, m = e.m, k = (n - 1) / 2, alt = e.mostradas, agua = e.capas?.agua ?? null;
    const pend = pendientes(alt, n, m, agua);
    let nAgua = 0;
    if (agua) for (const v of agua) if (v >= 1) nAgua++;
    const mapa = dia?.mapa?.(p) ?? null, mapaListo = mapa && !mapa.pendiente ? mapa : null;
    const soles = Array.from({ length: PASOS + 1 }, (_, t) => {
      const s = dia?.solDe?.(p, t) ?? null;
      return s ? { t, el: num(s.el), az: num(s.az), tipo: s.tipo ?? null, dia_h: num(s.dia) } : null;
    });
    const tipo = soles.find(Boolean)?.tipo ?? null;
    const propio = S?.modo !== 'mismo';
    const equivale_h = tipo === 'tierra' ? 1 : tipo === 'polar' ? (propio ? DIA_LUNAR_H / PASOS : 1) : tipo === 'mundo' ? (propio ? soles.find(Boolean).dia_h / PASOS : 1) : null;
    const instancias = p.modelos?.instancias?.() ?? [];
    // Las piezas de una base se miden desde su centro (el punto elegido, si cae en la ventana); lo demás, desde el centro de la ventana.
    const cb = ctx.centroDe?.(p) ?? null, centroBase = cb && fin(cb.fila) && fin(cb.col) ? cb : { fila: k, col: k, punto: false };
    const piezas = (p.plantados?.lista ?? []).map((it) => {
      const i = it.fila * n + it.col, eq = ctx.equipoDe(it.equipo), base = esDeBase(it), regla = base ? reglas.get(it.equipo) : null, numero = base ? numeroDe(it) : null;
      const c0 = base ? centroBase : { fila: k, col: k };
      const sobreAgua = agua ? agua[i] >= 1 : false;
      const tira = tiraLuz(mapaListo, i);
      const evs = eq ? ctx.evaluar(p, it) : [];
      return {
        uid: it.uid, id: it.equipo, nombre: nombreCorto(it.equipo), de_base: base, num: numero, par: it.par ?? null,
        fila: it.fila, col: it.col, este_m: (it.col - c0.col) * m, sur_m: (it.fila - c0.fila) * m, dist_m: Math.hypot(it.col - c0.col, it.fila - c0.fila) * m,
        cota: num(alt[i]), pendiente: sobreAgua ? null : num(pend[i]), agua: sobreAgua, modelo3d: instancias.some((x) => x.uid === it.uid),
        luz: tira, horas_luz: tira ? tira.filter((c) => c === 'sol').length : null,
        regla: base ? dePanel(it.equipo)?.texto ?? regla?.texto ?? null : null,
        criterios: base && res && res.pri === p.lado ? (optimo.get(it.equipo)?.criterios ?? []).map((c) => ({ tipo: c.tipo, con: c.con ? nombreCorto(c.con) : null, peso: c.peso, usado: !!c.usado, valor: num(c.valor), motivo: c.motivo ?? null })) : null,
        en_catalogo: !!eq,
        requisitos: evs.map((r) => {
          const f = filaRequisito(r, nombreCorto), q = r.req;
          return { nombre: f.nombre, limite: r.estado === 'sin_limite' ? null : `${{ '<=': '≤', '<': '<', '>=': '≥', '>': '>' }[q.op] ?? q.op} ${cantidad(q.valor, q.unidad)}`, valor: f.valor, estado: r.estado, veredicto: veredicto(r), nota: f.nota,
            motivo: r.motivo ?? null, como: r.como ?? null, texto: q.texto ?? null, url: q.fuente ?? null, cita: q.cita ?? null, verificado: q.verificado === true };
        }),
        no_ensayable: (eq?.no_ensayable_tierra ?? []).map((x) => ({ factor: x.factor ?? null, texto: x.texto ?? null, url: x.fuente ?? null, cita: x.cita ?? null })),
      };
    });
    return {
      lado: p.lado, id: meta.id, cuerpo: meta.cuerpo, mundo: MUNDO[meta.cuerpo] ?? meta.cuerpo, nombre_cuerpo: CUERPO[meta.cuerpo] ?? meta.cuerpo, nombre: meta.nombre,
      n, m, lado_km: num(meta.lado_km), georef: meta.georef?.tipo ?? null, norte_arriba: meta.georef?.tipo === 'local_aeqd', centro: { lat: num(meta.centro?.lat), lon: num(meta.centro?.lon) },
      sintetico: !!meta.sintetico, dinamico: !!meta.dinamico, es_punto: !!meta.punto, z_referencia: meta.z_referencia ?? null,
      muestreo: meta.dinamico && meta.muestreo ? textoMuestreo(meta) : meta.punto ? textoPunto(meta) : null, imagen: meta.imagen?.texto ?? null,
      fuentes: fuentesTerreno(meta), retocado: !!e.delta?.some?.((v) => v !== 0), original: !!e.verOriginal,
      cotas: estadistica(alt), pendientes: estadistica(pend), hist_pendiente: histograma(pend, BORDES_PENDIENTE), celdas_agua: agua ? nAgua : null,
      centro_base: { punto: !!centroBase.punto, este_m: (centroBase.col - k) * m, sur_m: (centroBase.fila - k) * m }, sol: tipo ? soles : null, tipo_sol: tipo, equivale_h, el_display: tipo === 'polar' ? num(soles.find(Boolean)?.el) : null,
      mapa_luz: !!mapaListo, unidad_paso: mapaListo?.unidad ?? null,
      piezas,
    };
  });

  const noTierra = paneles.find((x) => x.cuerpo !== 'tierra') ?? null, tierra = paneles.find((x) => x.cuerpo === 'tierra') ?? null;
  const mundo = ctx.punto ? { clave: ctx.punto.mundo, nombre: CUERPO[{ moon: 'luna', mars: 'marte' }[ctx.punto.mundo]] ?? ctx.punto.mundo, lat: ctx.punto.lat, lon: ctx.punto.lon, de: 'point' }
    : noTierra ? { clave: noTierra.mundo, nombre: noTierra.nombre_cuerpo, lat: noTierra.centro.lat, lon: noTierra.centro.lon, de: 'window centre', terreno: noTierra.nombre } : null;
  const lugar = ctx.lugar && tierra?.dinamico ? { nombre: ctx.lugar.nombre ?? tierra.nombre, lat: ctx.lugar.lat, lon: ctx.lugar.lon, de: 'place' }
    : tierra ? { nombre: tierra.nombre, lat: tierra.centro.lat, lon: tierra.centro.lon, de: 'window centre' } : null;

  const conBase = paneles.some((x) => x.piezas.some((y) => y.de_base));
  const parPri = paneles.flatMap((x) => x.piezas).find((y) => y.de_base)?.par;
  const base = conBase ? {
    radio_m: res?.radio_m ?? radioDePar(parPri), restaurada: !res, separacion_min_m: num(res?.separacion_min_m), holgura_m: HOLGURA_M,
    modo: res?.modo ?? A?.modo ?? null, orden: (res?.orden ?? A?.orden ?? null)?.map?.((id) => nombreCorto(id)) ?? null,
    candidatos: num(res?.r?.candidatos), paso: num(res?.r?.paso), usa_luz: res ? !!res.r?.usaLuz : null, sombra_de: res?.r?.sombraDe ?? null,
    pri: res?.pri ?? null, sec: res?.sec ?? null,
    sin_sitio: (res?.r?.sin_sitio ?? []).map((x) => ({ nombre: nombreCorto(x.id), motivo: x.motivo })),
    excluidos: (res?.excluidos ?? []).map((x) => ({ nombre: x.nombre, motivo: x.motivo })),
  } : null;

  const cuerpos = ctx.cuerpos;
  const limites_tierra = (cuerpos?.parametros ?? []).filter((q) => q.reproducible_en_tierra === false).map((q) => ({
    nombre: q.nombre, unidad: q.unidad, aviso: q.aviso ?? null, mundo: mundo ? num(q.constante?.[mundo.clave]) : null, tierra: num(q.constante?.earth),
    fuentes: [mundo ? q.fuentes?.[mundo.clave] : null, q.fuentes?.earth].filter(Boolean).map((f) => ({ texto: f.texto ?? null, url: f.url ?? null, cita: f.cita ?? null })),
  }));

  return {
    url: ctx.url ?? null, enlace_resultados: ctx.enlaceResultados ?? null, ejemplo: !!ctx.ejemplo,
    mundo, lugar,
    simulacion: { mision: ctx.mision ?? null, mes_url: ctx.mes ?? null, ventana_km: num(ctx.lugar?.lado_km ?? ctx.punto?.lado_km), exag: num(ctx.exag), espejo: !!ctx.espejo, espejo_aplica: new Set(paneles.map((x) => x.cuerpo)).size > 1 },
    dia: S ? { activo: !!S.activo, hora: num(S.hora), mes: num(S.mes), mes_nombre: MESES[S.mes - 1] ?? null, modo: S.modo, decl: num(S.decl) } : null,
    fuentes_sol: FUENTES_SOL,
    paneles, base, parecido: ctx.parecido ?? null, limites_tierra,
  };
}
