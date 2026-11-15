// Hielo y agua: dónde la temperatura permitiría hielo en superficie, perforación, planta de agua, energía y propelente. Sin DOM.
// Las cifras citadas entran por parámetros (web/data/obra.json, equipo.json); aquí solo masas molares.
import { pendienteGrados } from './calculo.js';
import { planFlota } from './obra.js';

// Pesos atómicos convencionales IUPAC (g/mol = kg/kmol).
const M_H = 1.008, M_O = 15.999;
export const M_H2 = 2 * M_H, M_O2 = 2 * M_O, M_H2O = M_H2 + M_O;

const NOTA_HIELO = 'the maximum temperature only says surface ice would survive here; it does not show ice is present';

const no = (campo, motivo) => ({ evaluable: false, campo, motivo });
const falta = (v) => v === undefined || v === null;
const finito = (v) => typeof v === 'number' && Number.isFinite(v);

const REGLAS = {
  pos: [(v) => v > 0, 'must be a finite number > 0'],
  nn: [(v) => v >= 0, 'must be a finite number ≥ 0'],
  frac: [(v) => v > 0 && v <= 1, 'must be in (0, 1]'],
};

// campos = [[nombre, regla, opcional]]; devuelve el primer fallo o null.
function revisar(e, campos) {
  for (const [k, regla, opcional] of campos) {
    const v = e[k];
    if (opcional && falta(v)) continue;
    const [ok, texto] = REGLAS[regla];
    if (!finito(v) || !ok(v)) return no(k, `${k} ${texto} (got ${v === undefined ? 'nothing' : String(v)})`);
  }
  return null;
}

// Techo que no suma una unidad por el error de coma flotante de un múltiplo exacto (1.1 / 0.1 = 11.000000000000002).
const techo = (x) => Math.ceil(x - Math.abs(x) * 1e-12);

function comprobarTerreno(t) {
  if (!t || typeof t !== 'object' || !Number.isInteger(t.n) || t.n <= 0) return no('t', 'terrain must have a whole grid size n > 0');
  return null;
}

function capaValida(t, nombre) {
  const v = t.capas?.[nombre];
  if (!v) return { capa: null };
  if (v.length !== t.n * t.n) return { fallo: no(nombre, `${nombre} layer has ${v.length} cells, grid has ${t.n * t.n}`) };
  return { capa: v };
}

export function hieloEstable(t, umbral_K) {
  const mal = comprobarTerreno(t) ?? revisar({ umbral_K }, [['umbral_K', 'pos']]);
  if (mal) return mal;
  const temp = capaValida(t, 'temp_max'), psr = capaValida(t, 'sombra_permanente');
  if (temp.fallo) return temp.fallo;
  if (!temp.capa) {
    return { evaluable: true, medido: false, campo: null, motivo: 'no maximum-temperature (temp_max) layer on this terrain: not measured', umbral_K, mascara: null, celdas: null, fracciones: null, motivo_sombra: null, nota: NOTA_HIELO };
  }
  if (psr.fallo) return psr.fallo;
  const T = temp.capa, P = psr.capa, N = t.n * t.n, mascara = new Uint8Array(N);
  let estable = 0, sombra = 0, sin = 0;
  for (let i = 0; i < N; i++) {
    const x = T[i];
    if (!Number.isFinite(x)) { mascara[i] = 255; sin++; continue; }
    if (x <= umbral_K) {
      mascara[i] = 1; estable++;
      if (P && P[i] === 1) sombra++;
    }
  }
  return {
    evaluable: true, medido: true, campo: null, motivo: null, umbral_K, mascara,
    celdas: { total: N, con_dato: N - sin, estable, estable_sombra: P ? sombra : null, sin_dato: sin },
    fracciones: { estable: estable / N, estable_sombra: P ? sombra / N : null, sin_dato: sin / N },
    motivo_sombra: P ? null : 'no permanent-shadow layer on this terrain',
    nota: NOTA_HIELO,
  };
}

const NOMBRE = { temp_max: 'maximum-temperature', sombra_permanente: 'permanent-shadow', iluminacion: 'illumination' };

function leerCapa(t, nombre, i) {
  const v = t.capas?.[nombre];
  if (!v || v.length !== t.n * t.n) return { valor: null, motivo: `no ${NOMBRE[nombre]} layer on this terrain` };
  if (!Number.isFinite(v[i])) return { valor: null, motivo: `no data in the ${NOMBRE[nombre]} layer at this point` };
  return { valor: v[i], motivo: null };
}

function celda(v, n, campo) {
  if (!finito(v)) return { fallo: no(campo, `${campo} must be a finite number`) };
  const k = Math.round(v);
  if (k < 0 || k > n - 1) return { fallo: no(campo, `${campo} ${v} is outside the grid (0 to ${n - 1})`) };
  return { k };
}

export function lecturaPunto(t, fila, col, { umbral_K } = {}) {
  const mal = comprobarTerreno(t);
  if (mal) return mal;
  const f = celda(fila, t.n, 'fila');
  if (f.fallo) return f.fallo;
  const c = celda(col, t.n, 'col');
  if (c.fallo) return c.fallo;
  const malU = revisar({ umbral_K }, [['umbral_K', 'pos']]);
  if (malU) return malU;
  const { n } = t, m = t.m_por_px, i = f.k * n + c.k;

  let pendiente_deg;
  if (!t.alturas || t.alturas.length !== n * n || !(m > 0)) pendiente_deg = { valor: null, motivo: 'no elevation grid on this terrain' };
  else {
    const p = pendienteGrados(t.alturas, n, m, f.k, c.k);
    pendiente_deg = Number.isFinite(p) ? { valor: p, motivo: null, como: `DEM slope, ${m.toFixed(2)} m/px` } : { valor: null, motivo: 'no elevation data at this point' };
  }

  const temp_max_K = leerCapa(t, 'temp_max', i);
  let hielo_superficie, motivo;
  if (temp_max_K.valor === null) { hielo_superficie = 'no_medido'; motivo = temp_max_K.motivo; }
  else if (temp_max_K.valor <= umbral_K) { hielo_superficie = 'si'; motivo = `maximum temperature ${temp_max_K.valor.toFixed(1)} K ≤ ${umbral_K} K: surface ice would be stable`; }
  else { hielo_superficie = 'no'; motivo = `maximum temperature ${temp_max_K.valor.toFixed(1)} K > ${umbral_K} K: surface ice would sublimate`; }

  return {
    evaluable: true, campo: null, fila: f.k, col: c.k, umbral_K,
    temp_max_K, sombra_permanente: leerCapa(t, 'sombra_permanente', i), iluminacion: leerCapa(t, 'iluminacion', i), pendiente_deg,
    hielo_superficie, motivo, nota: NOTA_HIELO,
  };
}

export function planPerforacion(e = {}) {
  const mal = revisar(e, [['profundidad_m', 'pos'], ['bocado_cm', 'pos'], ['potencia_w', 'pos', true], ['horas_por_bocado', 'pos', true], ['profundidad_max_m', 'pos', true]]);
  if (mal) return mal;
  const { profundidad_m, bocado_cm, potencia_w, horas_por_bocado, profundidad_max_m } = e;
  const cm = profundidad_m * 100, x = cm / bocado_cm;
  if (!Number.isFinite(cm) || !Number.isFinite(x)) return no('profundidad_m', 'inputs out of range: result overflows');
  const bocados = techo(x);
  const ultimo_bocado_cm = Math.min(bocado_cm, cm - (bocados - 1) * bocado_cm);
  const conH = !falta(horas_por_bocado), conP = !falta(potencia_w);
  const horas = conH ? bocados * horas_por_bocado : null;
  const faltan = [!conP && 'potencia_w', !conH && 'horas_por_bocado'].filter(Boolean);
  const energia_wh = faltan.length ? null : potencia_w * horas;
  if ((horas !== null && !Number.isFinite(horas)) || (energia_wh !== null && !Number.isFinite(energia_wh))) return no('horas_por_bocado', 'inputs out of range: result overflows');
  const conMax = !falta(profundidad_max_m);
  return {
    evaluable: true, campo: null, motivo: null, profundidad_m, bocado_cm, bocados, ultimo_bocado_cm,
    horas, motivo_horas: conH ? null : 'needs the time per bite (horas_por_bocado)',
    energia_wh, motivo_energia: faltan.length ? `needs ${faltan.join(' and ')}` : null,
    nota_energia: faltan.length ? null : 'upper bound: the given power held for the whole drilling time',
    supera_profundidad_max: conMax ? profundidad_m > profundidad_max_m : null,
    motivo_profundidad_max: conMax ? null : 'needs the drill depth class (profundidad_max_m)',
  };
}

// Bocado a bocado al avance publicado. Solo el tiempo cortando: subir, cepillar el material y leerlo entre bocados no
// está publicado. potencia_w (opcional) da un tope de energía: esa potencia durante todo el corte.
export function secuenciaPerforacion({ profundidad_m, bocado_cm, avance_mm_s, potencia_w = null } = {}) {
  if (![profundidad_m, bocado_cm, avance_mm_s].every((v) => typeof v === 'number' && Number.isFinite(v) && v > 0)) return null;
  const total_cm = profundidad_m * 100, n = techo(total_cm / bocado_cm), conP = typeof potencia_w === 'number' && potencia_w > 0;
  if (!Number.isFinite(n) || n > 10000) return null;
  const pasos = [];
  let acumulado_s = 0;
  for (let k = 0; k < n; k++) {
    const desde_cm = k * bocado_cm, hasta_cm = Math.min(total_cm, desde_cm + bocado_cm), corte_s = ((hasta_cm - desde_cm) * 10) / avance_mm_s;
    acumulado_s += corte_s;
    pasos.push({ k: k + 1, desde_cm, hasta_cm, corte_s, acumulado_s });
  }
  return { pasos, corte_s: acumulado_s, energia_max_wh: conP ? (potencia_w * acumulado_s) / 3600 : null };
}

export function plantaAgua(e = {}) {
  const mal = revisar(e, [['agua_kg', 'nn'], ['dias', 'pos'], ['fraccion_hielo', 'frac'], ['eficiencia', 'frac'], ['fraccion_min', 'frac', true], ['fraccion_max', 'frac', true]]);
  if (mal) return mal;
  const { agua_kg, dias, fraccion_hielo, fraccion_min, fraccion_max, eficiencia } = e;
  const hayMin = !falta(fraccion_min), hayMax = !falta(fraccion_max);
  if (hayMin !== hayMax) return hayMin ? no('fraccion_max', 'fraccion_max is needed with fraccion_min') : no('fraccion_min', 'fraccion_min is needed with fraccion_max');
  if (hayMin && fraccion_min > fraccion_max) return no('fraccion_min', `fraccion_min ${fraccion_min} is above fraccion_max ${fraccion_max}`);
  const regolito_kg = agua_kg / (fraccion_hielo * eficiencia);
  const intervalo_kg = hayMin ? { min: agua_kg / (fraccion_max * eficiencia), max: agua_kg / (fraccion_min * eficiencia) } : null;
  if (!Number.isFinite(regolito_kg) || (intervalo_kg && !Number.isFinite(intervalo_kg.max))) return no('agua_kg', 'inputs out of range: result overflows');
  return {
    evaluable: true, campo: null, motivo: null, regolito_kg, intervalo_kg,
    motivo_intervalo: hayMin ? null : 'needs fraccion_min and fraccion_max',
    agua_kg_dia: agua_kg / dias, regolito_kg_dia: regolito_kg / dias,
    intervalo_kg_dia: intervalo_kg ? { min: intervalo_kg.min / dias, max: intervalo_kg.max / dias } : null,
  };
}

export function energia(e = {}) {
  const mal = revisar(e, [['potencia_kw', 'nn'], ['kw_por_torre', 'pos', true], ['kwe_por_reactor', 'pos', true], ['fraccion_luz', 'frac', true]]);
  if (mal) return mal;
  const { potencia_kw, kw_por_torre, kwe_por_reactor, fraccion_luz } = e;
  const hayT = !falta(kw_por_torre), hayR = !falta(kwe_por_reactor), hayL = !falta(fraccion_luz);
  const torres = hayT ? techo(potencia_kw / kw_por_torre) : null;
  const reactores = hayR ? techo(potencia_kw / kwe_por_reactor) : null;
  const torres_con_luz = hayT && hayL ? techo(potencia_kw / (kw_por_torre * fraccion_luz)) : null;
  if ([torres, reactores, torres_con_luz].some((v) => v !== null && !Number.isFinite(v))) return no('potencia_kw', 'inputs out of range: result overflows');
  const faltaL = [!hayT && 'kw_por_torre', !hayL && 'fraccion_luz'].filter(Boolean);
  return {
    evaluable: true, campo: null, motivo: null, potencia_kw,
    torres, motivo_torres: hayT ? null : 'needs the power of one tower (kw_por_torre)',
    torres_con_luz, motivo_torres_con_luz: faltaL.length ? `needs ${faltaL.join(' and ')}` : null,
    reactores, motivo_reactores: hayR ? null : 'needs the electric power of one reactor (kwe_por_reactor)',
    nota_torre: 'a tower gives its rated power only while its panels are in sunlight; the light-corrected count is a mean over time and still needs storage for the dark hours (not sized here)',
    nota_reactor: 'assumes the required power is electric (kWe)',
  };
}

// 2 H2O → 2 H2 + O2.
export function propelente(agua_kg) {
  const mal = revisar({ agua_kg }, [['agua_kg', 'nn']]);
  if (mal) return mal;
  return {
    evaluable: true, campo: null, motivo: null, agua_kg,
    o2_kg: agua_kg * (M_O2 / (2 * M_H2O)), h2_kg: agua_kg * (M_H2 / M_H2O), relacion_o2_h2: M_O2 / (2 * M_H2),
  };
}

const CAMPOS_FLOTA = ['n_robots', 'kg_por_dia_lunar', 'fraccion_luz', 'distancia_acarreo_m', 'carga_kg', 'velocidad_m_s', 'horas_dia_lunar'];

export function excavacionParaAgua(e = {}) {
  const { regolito_kg, ...flota } = e;
  const mal = revisar({ regolito_kg }, [['regolito_kg', 'nn']]);
  if (mal) return mal;
  const p = planFlota({ ...flota, masa_kg: regolito_kg });
  if (!p.evaluable) {
    const pos = CAMPOS_FLOTA.map((k) => [k, p.motivo.indexOf(k)]).filter(([, j]) => j >= 0).sort((a, b) => a[1] - b[1]);
    return no(pos.length ? pos[0][0] : 'regolito_kg', p.motivo);
  }
  const { dias_excavacion, dias_acarreo, dias, manda, viajes } = p;
  return { evaluable: true, campo: null, motivo: null, regolito_kg, dias_excavacion, dias_acarreo, dias, manda, viajes };
}
