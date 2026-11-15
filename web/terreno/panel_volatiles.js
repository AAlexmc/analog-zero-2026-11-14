// Volátiles en pantalla: capa de hielo estable, herramienta DRILL HERE y bloque de la planta de agua en la hoja.
// Cálculo con volatiles.js; cifras con cita de obra.json y equipo.json. Lo que no tiene cita se rotula.
import { hieloEstable, lecturaPunto, planPerforacion, secuenciaPerforacion, plantaAgua, energia, propelente, M_H2, M_H2O } from './volatiles.js';
import { constante, cifraCitada, tiempoFlota, defectosFlota, SUPUESTOS, fmt } from './panel_obra.js';
import { cargarCatalogo } from './datos.js';

// Misma fuente que planta_agua_produccion; la cita del catálogo empieza después de la cifra de oxígeno.
export const O2_FUENTE = {
  valor: 10000,
  mezcla_o2_h2: 6,
  fuente: 'https://ntrs.nasa.gov/api/citations/20205007966/downloads/PolarWaterISRUstudy_Kleinhenz_final.pdf',
  cita: 'The baseline case in this study assumed that 10 mT of oxygen, along with enough hydrogen to support a propulsion mixture ratio of 6, must be produced in 225 days.',
  verificado: true,
};

export const NO_MEDIBLE = 'cannot be measured on this terrain';
const positivo = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;
// Porcentaje del catálogo a fracción sin el error de la división (5.6 / 100 = 0.055999999999999994).
const fraccion = (pct) => +(pct / 100).toPrecision(12);
const conRef = (c) => (c && positivo(c.valor) ? { valor: c.valor, ref: c } : null);

export function defectosVolatiles(obra, equipos) {
  const eq = (id) => (equipos ?? []).find((q) => q.id === id) ?? null;
  const k = (id) => constante(obra, id);
  const hielo = k('lcross_hielo_pct_masa'), rango = k('lcross_agua_total_pct_masa'), prod = k('planta_agua_produccion');
  const tri = eq('taladro_trident');
  const masa = (tri?.cifras ?? []).find((c) => c.nombre === 'masa_max_kg' && c.verificado === true && c.fuente && positivo(c.valor)) ?? null;
  const rangoOk = Array.isArray(rango?.valor) && rango.valor.length === 2 && rango.valor.every(positivo) && rango.valor[0] <= rango.valor[1];
  return {
    umbral: conRef(k('hielo_superficie_temp_max_k')),
    hielo: hielo && positivo(hielo.valor) && hielo.valor <= 100 ? { valor: fraccion(hielo.valor), pct: hielo.valor, ref: hielo } : null,
    agua_rango: rangoOk ? { min: fraccion(rango.valor[0]), max: fraccion(rango.valor[1]), ref: rango } : null,
    produccion: prod && positivo(prod.valor?.masa_agua_kg) && positivo(prod.valor?.dias) ? { agua_kg: prod.valor.masa_agua_kg, dias: prod.valor.dias, ref: prod } : null,
    potencia_kw: conRef(k('planta_agua_potencia_kw')),
    eficiencia: conRef(k('planta_agua_eficiencia_extraccion')),
    trident: {
      eq: tri,
      profundidad: conRef(cifraCitada(tri, 'profundidad_clase_m')),
      bocado: conRef(cifraCitada(tri, 'bocado_nominal_cm')),
      rotacion: conRef(cifraCitada(tri, 'potencia_rotacion_w')),
      percusion: conRef(cifraCitada(tri, 'potencia_percusion_w')),
      masa: masa ? { valor: masa.valor, op: masa.op ?? null, ref: masa } : null,
      avance: conRef(cifraCitada(tri, 'avance_mm_s')),
      wob: conRef(cifraCitada(tri, 'peso_sobre_broca_tipico_n')),
    },
    torre_kw: conRef(cifraCitada(eq('torre_solar'), 'potencia_honeybee_lamps_kw')),
    reactor_kwe: conRef(cifraCitada(eq('reactor_fision'), 'potencia_estudio_2022_kwe')),
  };
}

// Capa para el sombreador: 1 = la temperatura máxima permite hielo estable, 0 = no, NaN = sin dato.
export function capaHielo(t, umbral_K) {
  const vacia = { medido: false, capa: null, mascara: null, pct: null, pct_con_dato: null, pct_sombra: null, celdas: null, total: null, sin_dato: null, motivo_sombra: null, nota: null };
  if (!positivo(umbral_K)) return { ...vacia, motivo: 'no cited stable-ice threshold in the catalogue' };
  const h = hieloEstable(t, umbral_K);
  if (!h.evaluable || !h.medido) return { ...vacia, motivo: h.motivo };
  const c = h.celdas;
  return {
    medido: true, motivo: null, capa: Float32Array.from(h.mascara, (v) => (v === 255 ? NaN : v)), mascara: h.mascara,
    pct: 100 * h.fracciones.estable, pct_con_dato: c.con_dato ? 100 * (c.estable / c.con_dato) : null,
    pct_sombra: h.fracciones.estable_sombra === null ? null : 100 * h.fracciones.estable_sombra,
    celdas: c.estable, total: c.total, sin_dato: c.sin_dato, motivo_sombra: h.motivo_sombra, nota: h.nota,
  };
}

const ETIQUETA = { temp_max: 'Max temperature', sombra: 'Permanent shadow', iluminacion: 'Mean illumination', hielo: 'Surface ice', pendiente: 'Slope' };
const CAPA = { temp_max: 'temp_max', sombra: 'sombra_permanente', iluminacion: 'iluminacion', hielo: 'temp_max', pendiente: null };

// Lectura de un punto y plan de TRIDENT. luna = false: solo la lectura (lo que el sitio puede reproducir).
export function tarjetaPerforacion({ t, fila, col, luna, D, profundidad_m = null }) {
  if (!D?.umbral) return { evaluable: false, motivo: 'no cited stable-ice threshold in the catalogue' };
  const u = D.umbral.valor;
  const l = lecturaPunto(t, fila, col, { umbral_K: u });
  if (!l.evaluable) return { evaluable: false, motivo: l.motivo };
  const estado = (k, v) => {
    if (k === 'pendiente') return v.valor === null ? 'sin_dato' : 'medido';
    if (!t.capas?.[CAPA[k]]) return 'no_medible';
    return v.valor === null ? 'sin_dato' : 'medido';
  };
  const texto = (est, s) => (est === 'no_medible' ? NO_MEDIBLE : est === 'sin_dato' ? 'no data at this point' : s);
  const fila_ = (k, v, s) => { const est = estado(k, v); return { k, et: ETIQUETA[k], capa: CAPA[k], estado: est, valor: est === 'medido' ? v.valor : null, texto: texto(est, est === 'medido' ? s(v.valor) : '') }; };
  const hv = { valor: l.hielo_superficie === 'no_medido' ? null : l.hielo_superficie };
  const lectura = [
    fila_('temp_max', l.temp_max_K, (v) => `${v.toFixed(1)} K`),
    fila_('sombra', l.sombra_permanente, (v) => (v === 1 ? 'yes' : 'no')),
    fila_('iluminacion', l.iluminacion, (v) => v.toFixed(3)),
    fila_('hielo', hv, (v) => (v === 'si' ? `temperature allows stable surface ice (≤ ${u} K)` : `too warm for stable surface ice (> ${u} K)`)),
    fila_('pendiente', l.pendiente_deg, (v) => `${v.toFixed(1)}°`),
  ];
  const out = { evaluable: true, motivo: null, fila: l.fila, col: l.col, umbral_K: u, lectura, hielo: l.hielo_superficie, nota: l.nota, plan: null, secuencia: null, hielo_esperado: null, no_medido: [] };
  const T = D.trident, prof = profundidad_m ?? T.profundidad?.valor ?? null;
  // El taladro trabaja igual en los dos mundos: la secuencia vale para la Luna y para el ensayo en la Tierra.
  if (T.bocado && T.avance && positivo(prof)) {
    out.secuencia = secuenciaPerforacion({ profundidad_m: prof, bocado_cm: T.bocado.valor, avance_mm_s: T.avance.valor, potencia_w: T.rotacion && T.percusion ? T.rotacion.valor + T.percusion.valor : null });
  }
  if (!luna) return out;
  out.plan = T.bocado && positivo(prof)
    ? planPerforacion({ profundidad_m: prof, bocado_cm: T.bocado.valor, profundidad_max_m: T.profundidad?.valor })
    : { evaluable: false, motivo: 'no cited bite size or depth for TRIDENT in the catalogue' };
  out.no_medido = [
    ...(out.secuencia
      ? [{ k: 'horas', texto: 'time between bites (pulling the drill up, brushing the cuttings out, reading them): NOT MEASURED (not published)' }]
      : [{ k: 'horas', texto: 'drilling time: NOT MEASURED (the catalogue gives no TRIDENT drilling rate: time per bite)' },
        { k: 'energia', texto: 'drilling energy: NOT MEASURED (needs the drilling time)' }]),
    { k: 'subsuelo', texto: 'ice below the surface here: NOT MEASURED (no subsurface data on this terrain)' },
  ];
  if (D.hielo) {
    const lugar = D.hielo.ref.lugar;
    out.hielo_esperado = { valor: D.hielo.pct, ref: D.hielo.ref, lugar: lugar ?? null, rango: D.agua_rango,
      texto: `${D.hielo.pct} % water ice by mass, measured at ${lugar?.nombre ?? 'another site'}: not measured here` };
  }
  return out;
}

const t1 = (kg) => `${(kg / 1000).toFixed(1)} t`;

// luz: iluminación media de la celda (null sin dato). F = defectosFlota.
export function hojaPlanta({ D, F, luz, luna, n_robots }) {
  const out = { planta: null, motivo: null, excavacion: null, energia: null, motivo_energia: null, propelente: null, o2: null, motivo_luz: null,
    no_medido: [{ k: 'acarreo', texto: 'haul time: NOT MEASURED (no published payload per trip)' }] };
  out.motivo_luz = luz === null || luz === undefined || !Number.isFinite(luz) ? 'no illumination data at this cell' : luz > 0 ? null : 'no sunlight at this cell (mean illumination 0)';
  const conLuz = out.motivo_luz === null && luz <= 1;
  if (!D?.potencia_kw) out.motivo_energia = 'no cited plant power in the catalogue';
  else out.energia = energia({ potencia_kw: D.potencia_kw.valor, kw_por_torre: D.torre_kw?.valor, kwe_por_reactor: D.reactor_kwe?.valor, fraccion_luz: conLuz ? luz : undefined });
  const faltan = [!D?.produccion && 'water production', !D?.hielo && 'ice fraction', !D?.eficiencia && 'extraction efficiency'].filter(Boolean);
  if (faltan.length) { out.motivo = `no cited ${faltan.join(', ')} in the catalogue`; return out; }
  const { agua_kg, dias } = D.produccion;
  out.planta = plantaAgua({ agua_kg, dias, fraccion_hielo: D.hielo.valor, fraccion_min: D.agua_rango?.min, fraccion_max: D.agua_rango?.max, eficiencia: D.eficiencia.valor });
  if (!out.planta.evaluable) { out.motivo = out.planta.motivo; out.planta = null; return out; }
  const flota = { n_robots, kg_h: F?.ritmo_kg_h?.valor ?? null, mision_kg: F?.mision_kg?.valor ?? null };
  const luzO = Number.isFinite(luz) ? { valor: luz } : null;
  const iv = out.planta.intervalo_kg;
  out.excavacion = {
    central: tiempoFlota(out.planta.regolito_kg, flota, luzO, luna),
    min: iv ? tiempoFlota(iv.min, flota, luzO, luna) : null,
    max: iv ? tiempoFlota(iv.max, flota, luzO, luna) : null,
  };
  out.propelente = propelente(agua_kg);
  const p = out.propelente;
  const h2_fuente_kg = O2_FUENTE.valor / O2_FUENTE.mezcla_o2_h2, agua_h2_kg = h2_fuente_kg * M_H2O / M_H2;
  out.o2 = { fuente_kg: O2_FUENTE.valor, estequiometria_kg: p.o2_kg, h2_fuente_kg, agua_h2_kg, sobrante_kg: p.o2_kg - O2_FUENTE.valor,
    aviso: `The source baseline is ${t1(O2_FUENTE.valor)} of O₂ plus hydrogen for a mixture ratio of ${O2_FUENTE.mezcla_o2_h2}, i.e. ${t1(h2_fuente_kg)} of H₂. Electrolysis (2 H₂O → 2 H₂ + O₂) needs ${t1(agua_h2_kg)} of water for that hydrogen, close to the ${t1(agua_kg)} the source gives; the same water yields ${t1(p.o2_kg)} of O₂, so about ${t1(p.o2_kg - O2_FUENTE.valor)} of O₂ is surplus. Own reading of the cited sentence: the source does not spell out this step.` };
  return out;
}

export function celdaEstableMasCercana(mascara, n, m, fila, col) {
  if (!mascara) return null;
  let mejor = -1, d2 = Infinity;
  for (let i = 0; i < mascara.length; i++) {
    if (mascara[i] !== 1) continue;
    const df = Math.floor(i / n) - fila, dc = (i % n) - col, d = df * df + dc * dc;
    if (d < d2) { d2 = d; mejor = i; }
  }
  return mejor < 0 ? null : { fila: Math.floor(mejor / n), col: mejor % n, dist_m: Math.sqrt(d2) * m };
}

export const fmtV = {
  t1,
  dist: (m) => (!Number.isFinite(m) ? '—' : m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2)} km`),
  pct: (x) => (Number.isFinite(x) ? `${x.toFixed(1)} %` : '—'),
};

// ---------- Pantalla ----------
const COLOR_HIELO = [0.72, 0.5, 1.0];
const CAPA_HIELO = '_hielo_estable';
const CUERPO = { luna: 'Moon', tierra: 'Earth', marte: 'Mars' };
const lat = (v) => (Number.isFinite(v) ? `${Math.abs(v).toFixed(4)}° ${v < 0 ? 'S' : 'N'}` : '—');
const lon = (v) => (Number.isFinite(v) ? `${Math.abs(v).toFixed(4)}° ${v < 0 ? 'W' : 'E'}` : '—');

// ctx: catalogo, esc, fuenteYCita, nombreCorto, refrescarPlantado, modoPlantar, elegirHerramienta, leyenda, paneles
export function crearVolatiles(p, ctx) {
  const e = p.escena, n = e.n, { esc } = ctx;
  const luna = e.meta.cuerpo === 'luna';
  const V = { D: null, F: null, hielo: null, perf: null, x: null, abierta: false, eligiendo: false, prof: null, cercana: new Map() };
  const cita = (ref) => (ref ? ctx.fuenteYCita(ref) : '');
  const terreno = () => ({ n, m_por_px: e.m, alturas: e.mostradas, capas: e.capas });
  const enlaceCapa = (c) => {
    if (!c) return '';
    const u = /^https?:\/\//i.test(c.url ?? '') ? c.url : null;
    return u ? `<a href="${esc(u)}" target="_blank" rel="noopener" title="${esc(c.fuente ?? '')}">${esc(c.fuente ?? 'layer source')}</a>` : esc(c.fuente ?? 'layer source');
  };
  const enlaceCorto = (c) => {
    const u = /^https?:\/\//i.test(c?.url ?? '') ? c.url : null;
    let host = 'layer source';
    try { host = new URL(u).hostname; } catch { /* sin url */ }
    return u ? `<a href="${esc(u)}" target="_blank" rel="noopener" title="${esc(c.fuente ?? '')}">${esc(host)}</a>` : `<span title="${esc(c?.fuente ?? '')}">layer source</span>`;
  };
  const lienzo = p.el.querySelector('.lienzo');

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'perforar marca-boton secundario';
  btn.textContent = 'Drill here';
  btn.title = 'Click a point of the terrain to read it and plan a TRIDENT drill hole there';
  btn.setAttribute('aria-pressed', 'false');
  btn.disabled = true;
  p.el.querySelector('.acciones').prepend(btn);
  const aviso = document.createElement('div');
  aviso.className = 'aviso-perf';
  aviso.hidden = true;
  lienzo.appendChild(aviso);
  const tarjeta = document.createElement('aside');
  tarjeta.className = 'perforacion';
  tarjeta.hidden = true;
  lienzo.appendChild(tarjeta);
  const capaM = document.createElement('div');
  capaM.className = 'perf-capa';
  capaM.innerHTML = '<div class="perf-marca" hidden title="Drill point: click to show its card"><span class="pin"></span><span class="rot">Drill</span></div>';
  lienzo.appendChild(capaM);
  const marca = capaM.firstElementChild;
  marca.addEventListener('click', () => { V.abierta = true; p.sel = null; ctx.refrescarPlantado(); pintar(); });

  cargarCatalogo('obra.json').catch(() => null).then((o) => {
    V.D = defectosVolatiles(o, ctx.catalogo?.equipos);
    V.F = defectosFlota(o, ctx.catalogo?.equipos);
    if (luna && e.capas.temp_max) V.hielo = capaHielo(terreno(), V.D.umbral?.valor);
    botonCapa();
    btn.disabled = false;
    ctx.refrescarPlantado();
  });

  // ---------- Capa STABLE ICE ----------
  function botonCapa() {
    const fila = p.el.querySelector('.mandos [data-capa]')?.parentElement;
    if (!fila || !luna || !e.capas.temp_max) return;
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.capa = CAPA_HIELO;
    b.setAttribute('aria-pressed', 'false');
    b.textContent = 'Stable ice';
    if (!V.hielo?.medido) { b.disabled = true; b.title = V.hielo?.motivo ?? 'not measured'; } else b.title = `Cells whose maximum temperature is ≤ ${V.D.umbral.valor} K`;
    fila.appendChild(b);
    b.addEventListener('click', () => {
      fila.querySelectorAll('[data-capa]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      p.capa = null; p.rangoCapa = null;
      e.capas[CAPA_HIELO] = V.hielo.capa;
      e.setCapa(CAPA_HIELO, false, COLOR_HIELO);
      delete e.capas[CAPA_HIELO];
      ctx.leyenda(p);
    });
  }

  function leyenda() {
    const b = p.el.querySelector(`.mandos [data-capa="${CAPA_HIELO}"]`);
    if (b?.getAttribute('aria-pressed') !== 'true' || !V.hielo?.medido) return '';
    const h = V.hielo, u = V.D.umbral;
    const extra = [`${h.celdas.toLocaleString('en-US')} of ${h.total.toLocaleString('en-US')} cells`];
    if (h.pct_sombra !== null) extra.push(`${fmtV.pct(h.pct_sombra)} also in permanent shadow`);
    if (h.sin_dato) extra.push(`${h.sin_dato.toLocaleString('en-US')} cells without data`);
    return `<div data-v="leyenda-hielo"><span class="et"><i class="muestra-hielo"></i>Stable ice · max temperature ≤ ${esc(u.valor)} K</span>
      <div><span class="num" data-v="pct-hielo" data-pct="${h.pct}">${fmtV.pct(h.pct)}</span> of this terrain <span class="tenue">(${extra.join('; ')})</span></div>
      <div class="tenue">the surface temperature allows stable ice; it does not show that ice is present</div>
      <div><span class="et">Threshold</span> ${esc(u.ref.texto ?? '')} · ${cita(u.ref)}</div>
      <div class="recorte"><span class="et">Temperature</span> ${enlaceCapa(e.meta.capas.temp_max)}</div></div>`;
  }

  // ---------- DRILL HERE ----------
  function elegir(si) {
    V.eligiendo = si;
    btn.setAttribute('aria-pressed', String(si));
    if (si) { ctx.modoPlantar(p, null); ctx.elegirHerramienta(p, 'navegar'); }
    p.el.classList.toggle('plantando', si);
    aviso.hidden = !si;
    if (si) aviso.innerHTML = '<span class="et">Drill here</span> click the terrain · Esc cancels';
  }
  btn.addEventListener('click', () => elegir(!V.eligiendo));
  const cv = e.renderer.domElement;
  cv.addEventListener('pointerdown', (ev) => {
    if (!V.eligiendo || p.plantar || ev.button !== 0) return;
    ev.stopImmediatePropagation(); ev.preventDefault();
    const g = e.rayo(ev.clientX, ev.clientY);
    if (!g) return;
    V.perf = { fila: Math.min(n - 1, Math.max(0, Math.round(g.fila))), col: Math.min(n - 1, Math.max(0, Math.round(g.col))) };
    elegir(false);
    V.abierta = true;
    V.bocado = 0;
    p.sel = null;
    ctx.refrescarPlantado();
    pintar();
    ctx.alPerforar?.(p, V.perf);
  }, { capture: true });
  window.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && V.eligiendo) { ev.stopImmediatePropagation(); elegir(false); }
  }, true);

  const lectura = () => (V.perf && V.x?.evaluable ? V.x : null);

  // ---------- Cómo perfora TRIDENT: bocado a bocado ----------
  const tiempo = (s) => (s < 60 ? `${Math.round(s)} s` : `${Math.floor(s / 60)} min ${String(Math.round(s % 60)).padStart(2, '0')} s`);
  const listaCitada = (v, ordenada) => `<${ordenada ? 'ol' : 'ul'} class="perf-lista">${v.map((y) => `<li>${y.lugar ? `<b>${esc(y.lugar)}</b> · ` : ''}${esc(y.texto ?? '')} · ${cita(y)}</li>`).join('')}</${ordenada ? 'ol' : 'ul'}>`;
  function bloqueOperacion(x) {
    const T = V.D.trident, eq = T.eq ?? {}, S = x.secuencia;
    const op = eq.operacion ?? [], mide = eq.mide ?? [], ens = eq.ensayos_tierra ?? [];
    const sec = S ? `<div class="perf-sec" data-v="secuencia" data-bocados="${S.pasos.length}">
        <div class="perf-hoyo" role="img" aria-label="Hole drilled bite by bite">${S.pasos.map((b) => `<i data-k="${b.k}" title="bite ${b.k}: ${b.desde_cm.toFixed(0)}–${b.hasta_cm.toFixed(0)} cm"></i>`).join('')}</div>
        <div class="perf-paso" data-v="sec-paso" aria-live="polite"></div>
      </div>
      <div class="botones"><button type="button" data-v="sec-play">▶ Run the drill</button><button type="button" data-v="sec-sig">Next bite</button><button type="button" data-v="sec-cero">Reset</button></div>
      <dl><dt>Cutting time</dt><dd class="num" data-v="corte" data-valor="${S.corte_s}">${tiempo(S.corte_s)}</dd>
        ${S.energia_max_wh !== null ? `<dt>Energy while cutting</dt><dd class="num" data-v="energia-corte" data-valor="${S.energia_max_wh}">≤ ${S.energia_max_wh.toFixed(1)} Wh</dd>` : ''}
        ${T.wob ? `<dt>Push on the bit</dt><dd class="num" data-v="wob">≤ ${esc(T.wob.valor)} N</dd>` : ''}</dl>
      <div class="tenue nota-o">cutting time = depth ÷ feed of ${esc(T.avance.valor)} mm/s ${cita(T.avance.ref)} (own arithmetic): cutting only${S.energia_max_wh !== null ? ' · energy = both actuators at their full rating for that time, an upper bound' : ''}${T.wob ? ` · push ${cita(T.wob.ref)}` : ''}</div>`
      : '<div class="tenue" data-v="sin-secuencia">no cited feed speed or bite size for TRIDENT in the catalogue</div>';
    return `<div class="et">How TRIDENT drills this hole</div>${sec}
      ${op.length ? `<details class="perf-det" data-v="operacion"><summary>The real sequence, step by step (${op.length})</summary>${listaCitada(op, true)}</details>` : ''}
      ${mide.length ? `<details class="perf-det" data-v="mide"><summary>What the drill itself measures (${mide.length})</summary>${listaCitada(mide, false)}</details>` : ''}
      ${ens.length ? `<details class="perf-det" data-v="ensayos"${luna ? '' : ' open'}><summary>Already tried on Earth (${ens.length})</summary>${listaCitada(ens, false)}</details>` : ''}`;
  }
  function pintarPaso() {
    const S = V.x?.secuencia, caja = tarjeta.querySelector('[data-v=secuencia]');
    if (!S || !caja) return;
    const k = Math.min(V.bocado ?? 0, S.pasos.length), b = S.pasos[k - 1];
    caja.querySelectorAll('.perf-hoyo i').forEach((i) => i.classList.toggle('hecho', +i.dataset.k <= k));
    caja.dataset.bocado = k;
    caja.querySelector('[data-v=sec-paso]').innerHTML = !b
      ? `Footpad pressed on the ground. ${S.pasos.length} bites to go.`
      : `<b>Bite ${b.k} of ${S.pasos.length}</b> · <span class="num">${b.desde_cm.toFixed(0)}–${b.hasta_cm.toFixed(0)} cm</span> · cutting <span class="num">${tiempo(b.corte_s)}</span> (<span class="num">${tiempo(b.acumulado_s)}</span> so far) · drill pulled up, cuttings brushed onto the surface and read${k === S.pasos.length ? ' · <b>hole done</b>' : ''}`;
    tarjeta.querySelector('[data-v=sec-sig]').disabled = k >= S.pasos.length;
  }
  function pararTaladro() { clearInterval(V.tTaladro); V.tTaladro = null; const b = tarjeta.querySelector('[data-v=sec-play]'); if (b) b.textContent = '▶ Run the drill'; }
  function engancharSecuencia() {
    const S = V.x?.secuencia;
    if (!S || !tarjeta.querySelector('[data-v=secuencia]')) return;
    V.bocado = Math.min(V.bocado ?? 0, S.pasos.length);
    tarjeta.querySelector('[data-v=sec-sig]').addEventListener('click', () => { pararTaladro(); V.bocado = Math.min(S.pasos.length, (V.bocado ?? 0) + 1); pintarPaso(); });
    tarjeta.querySelector('[data-v=sec-cero]').addEventListener('click', () => { pararTaladro(); V.bocado = 0; pintarPaso(); });
    tarjeta.querySelector('[data-v=sec-play]').addEventListener('click', (ev) => {
      if (V.tTaladro) { pararTaladro(); return; }
      if (V.bocado >= S.pasos.length) V.bocado = 0;
      ev.currentTarget.textContent = '❚❚ Pause';
      V.tTaladro = setInterval(() => { V.bocado++; pintarPaso(); if (V.bocado >= S.pasos.length) pararTaladro(); }, 700);
      pintarPaso();
    });
    pintarPaso();
  }

  function filasLectura(x) {
    return `<dl class="lect-v">${x.lectura.map((r) => `<dt>${r.k === 'hielo' ? '<i class="muestra-hielo"></i>' : ''}${r.et}</dt><dd class="${r.estado === 'medido' ? 'num' : 'tenue'}" data-v="${r.k}" data-estado="${r.estado}" data-valor="${r.valor === null ? '' : esc(String(r.valor))}">${esc(r.texto)}</dd>`).join('')}</dl>`;
  }

  function cuerpoLuna(x) {
    const T = V.D.trident, P = x.plan, prof = V.prof ?? T.profundidad?.valor ?? null;
    const fuentes = ['temp_max', 'sombra_permanente', 'iluminacion'].filter((k) => e.meta.capas[k]).map((k) => `${{ temp_max: 'max temperature', sombra_permanente: 'permanent shadow', iluminacion: 'illumination' }[k]}: ${enlaceCorto(e.meta.capas[k])}`).join(' · ');
    let plan;
    if (!P.evaluable) plan = `<div class="sin-ruta" data-v="sin-plan">${esc(P.motivo)}</div>`;
    else {
      const ult = Math.abs(P.ultimo_bocado_cm - P.bocado_cm) > 1e-9 ? ` (last ${P.ultimo_bocado_cm.toFixed(1)} cm)` : '';
      const supera = P.supera_profundidad_max === null ? '<span class="tenue">no cited drill class</span>' : P.supera_profundidad_max ? `yes: deeper than the ${esc(T.profundidad.valor)} m class` : 'no';
      const pot = T.rotacion && T.percusion ? `${esc(T.rotacion.valor)} W rotary + ${esc(T.percusion.valor)} W percussive` : '<span class="tenue">not public</span>';
      const masa = T.masa ? `${T.masa.op === '<' ? '< ' : ''}${esc(T.masa.valor)} kg` : '<span class="tenue">not public</span>';
      plan = `<dl><dt>Bites</dt><dd class="num" data-v="bocados" data-valor="${P.bocados}">${P.bocados} × ${esc(P.bocado_cm)} cm${ult}</dd>
        <dt>Beyond drill class</dt><dd data-v="supera">${supera}</dd>
        <dt>Power</dt><dd class="num" data-v="potencia">${pot}</dd>
        <dt>Mass</dt><dd class="num" data-v="masa-taladro">${masa}</dd></dl>
        <div class="tenue nota-o">bite ${cita(T.bocado?.ref)}${T.rotacion ? ` · power ${cita(T.rotacion.ref)}` : ''}${T.masa ? ` · mass ${cita(T.masa.ref)}` : ''}</div>`;
    }
    const he = x.hielo_esperado;
    const esperado = he
      ? `<div data-v="hielo-esperado">${esc(he.texto)} · ${cita(he.ref)}${he.lugar ? ` · place ${cita(he.lugar)}` : ''}</div>
        ${he.rango ? `<div class="tenue nota-o" data-v="agua-total">total water, ice plus vapour, at the same impact: ${esc(he.rango.ref.valor.join('–'))} wt% ${cita(he.rango.ref)}</div>` : ''}`
      : '<div class="tenue">no cited ice concentration in the catalogue</div>';
    return `<div class="et">Reading at this point</div>${filasLectura(x)}
      <div class="tenue nota-o" data-v="nota-hielo">${esc(x.nota)}</div>
      <div class="como">${fuentes}</div>
      <div class="et">TRIDENT drill plan</div>
      <label class="fila-o"><span class="et">Depth</span><span><input type="number" data-v="prof" min="0" step="0.1" value="${Number.isFinite(prof) ? prof : ''}"> m</span></label>
      <div class="tenue nota-o"><span class="propio">own parameter</span> · default: ${T.profundidad ? `drill class ${esc(T.profundidad.valor)} m ${cita(T.profundidad.ref)}` : 'no cited drill class: enter one'}</div>
      ${plan}
      ${bloqueOperacion(x)}
      ${x.no_medido.map((r) => `<div class="no-medido" data-v="nm-${r.k}">${esc(r.texto)}</div>`).join('')}
      <div class="et">Ice expected</div>${esperado}`;
  }

  function cuerpoTierra(x) {
    const q = ctx.paneles.find((o) => o !== p && o.escena?.meta.cuerpo === 'luna' && o.volatiles?.lectura());
    const xl = q?.volatiles.lectura() ?? null;
    const noEns = V.D.trident.eq?.no_ensayable_tierra ?? [];
    return `<div class="et">What this site can reproduce</div>
      <table class="comp"><thead><tr><th></th>${xl ? `<th>Moon · ${esc(q.escena.meta.id)}</th>` : ''}<th>Earth · here</th></tr></thead><tbody>
      ${x.lectura.map((r) => `<tr data-v="${r.k}"><td>${r.et}</td>${xl ? `<td class="num">${esc(xl.lectura.find((y) => y.k === r.k)?.texto ?? '—')}</td>` : ''}<td class="${r.estado === 'medido' ? 'num' : 'tenue'}" data-estado="${r.estado}">${esc(r.texto)}</td></tr>`).join('')}</tbody></table>
      ${xl ? `<div class="tenue nota-o" data-v="luna-celda">Moon reading at cell ${xl.fila},${xl.col} of the Moon panel</div>` : '<div class="tenue nota-o" data-v="sin-luna">drill on the Moon panel to compare</div>'}
      <div class="tenue nota-o">no equivalence between Moon and Earth values is computed</div>
      ${bloqueOperacion(x)}
      <div class="et">Not testable on Earth (catalogue) · TRIDENT</div>
      ${noEns.length ? noEns.map((y) => `<div class="no-ens">${esc(y.texto ?? '')} · ${cita(y)}</div>`).join('') : '<div class="tenue">No public source states what cannot be tested on Earth for this drill.</div>'}`;
  }

  function pintar() {
    V.x = V.perf && V.D ? tarjetaPerforacion({ t: terreno(), fila: V.perf.fila, col: V.perf.col, luna, D: V.D, profundidad_m: V.prof }) : null;
    if (luna) for (const q of ctx.paneles) if (q !== p && q.volatiles?.V.abierta) q.volatiles.pintar();
    e.sucio = true;
    dibujar();
    pararTaladro();
    if (!V.x || !V.abierta) { tarjeta.hidden = true; tarjeta.innerHTML = ''; return; }
    const x = V.x, l = e.leer(V.perf.fila, V.perf.col);
    tarjeta.hidden = false;
    tarjeta.innerHTML = `<div class="cab-hoja"><span class="et">${esc(CUERPO[e.meta.cuerpo] ?? e.meta.cuerpo)} · ${esc(e.meta.id)} · drill here</span><button type="button" data-v="cerrar" title="Close (the mark stays)">×</button></div>
      <div class="lugar num">${lat(l.lat)} ${lon(l.lon)} · cell ${V.perf.fila},${V.perf.col}</div>
      ${!x.evaluable ? `<div class="sin-ruta" data-v="no-evaluable">${esc(x.motivo)}</div>` : luna ? cuerpoLuna(x) : cuerpoTierra(x)}
      <div class="botones"><button type="button" data-v="quitar">Remove</button><span class="tenue">removes the drill mark</span></div>`;
    tarjeta.querySelector('[data-v=cerrar]').addEventListener('click', () => { V.abierta = false; pintar(); });
    tarjeta.querySelector('[data-v=quitar]').addEventListener('click', () => { V.perf = null; V.abierta = false; pintar(); });
    tarjeta.querySelector('[data-v=prof]')?.addEventListener('change', (ev) => { const v = +ev.target.value; if (v > 0) V.prof = v; pintar(); });
    engancharSecuencia();
  }

  // Punto de perforación puesto desde fuera (el gemelo del otro panel): sin volver a avisar.
  function perforarEn(fila, col) {
    V.perf = { fila: Math.min(n - 1, Math.max(0, Math.round(fila))), col: Math.min(n - 1, Math.max(0, Math.round(col))) };
    V.abierta = true;
    V.bocado = 0;
    pintar();
  }

  function dibujar() {
    if (!V.perf) { marca.hidden = true; return; }
    const caja = lienzo.getBoundingClientRect(), s = e.aPantalla(e.mundoDePixel(V.perf.fila, V.perf.col));
    marca.hidden = !s?.dentro;
    if (s?.dentro) { marca.style.left = `${s.x - caja.left}px`; marca.style.top = `${s.y - caja.top}px`; }
  }

  // ---------- Planta de agua en la hoja ----------
  function hieloCelda(item) {
    const h = V.hielo, i = item.fila * n + item.col, u = V.D.umbral?.valor;
    if (!h?.medido) return { estado: 'no_medido', html: `stable surface ice at this cell: NOT MEASURED (${esc(h?.motivo ?? 'no maximum-temperature layer')})` };
    const T = e.capas.temp_max[i];
    if (h.mascara[i] === 255) return { estado: 'sin_dato', html: 'stable surface ice at this cell: no temperature data at this cell' };
    if (h.mascara[i] === 1) return { estado: 'si', html: `max temperature ${T.toFixed(1)} K ≤ ${esc(u)} K: the temperature at this cell allows stable surface ice (it does not show ice is present)` };
    const k = `${item.fila},${item.col}`;
    if (!V.cercana.has(k)) V.cercana.set(k, celdaEstableMasCercana(h.mascara, n, e.m, item.fila, item.col));
    const c = V.cercana.get(k);
    return { estado: 'no', dist: c?.dist_m ?? null, html: `max temperature ${T.toFixed(1)} K > ${esc(u)} K: no stable surface ice at this cell · ${c ? `nearest cell where the temperature allows it: <b class="num" data-v="dist-hielo" data-valor="${c.dist_m}">${fmtV.dist(c.dist_m)}</b> (cell ${c.fila},${c.col})` : 'no cell of this terrain is cold enough'}` };
  }

  function hoja(cont, item, eq) {
    if (V.abierta) { V.abierta = false; pintar(); }
    if (!cont) return;
    if (eq?.id !== 'planta_agua' || !V.D) { cont.innerHTML = ''; return; }
    if (!luna) {
      cont.innerHTML = `<div class="et">Water plant</div><div class="tenue" data-v="planta-tierra">the water, regolith and propellant figures are for the lunar plant (ice in lunar regolith) · stable surface ice on this terrain: ${NO_MEDIBLE}</div>`;
      return;
    }
    const D = V.D, F = V.F, i = item.fila * n + item.col;
    const ilu = e.capas.iluminacion?.[i], luz = Number.isFinite(ilu) ? ilu : null;
    const nr = p.obra?.O.flota?.n_robots ?? SUPUESTOS.n_robots;
    const h = hojaPlanta({ D, F, luz, luna, n_robots: nr });
    const hc = hieloCelda(item);
    const nom = esc(ctx.nombreCorto('ipex'));
    let agua = '';
    if (h.planta) {
      const pl = h.planta, iv = pl.intervalo_kg, ex = h.excavacion, c = ex.central;
      const exc = c.evaluable
        ? `<dt>Excavation</dt><dd class="num" data-v="horas" data-valor="${c.horas}">${fmt.horas(c.horas)} · ${fmt.dias(c.dias_tierra)} d</dd>
          ${ex.min?.evaluable ? `<dt>Range</dt><dd class="num" data-v="horas-rango" data-min="${ex.min.horas}" data-max="${ex.max.horas}">${fmt.horas(ex.min.horas)} – ${fmt.horas(ex.max.horas)}</dd>` : ''}
          ${c.misiones !== null ? `<dt>${nom} missions</dt><dd class="num" data-v="misiones" data-valor="${c.misiones}">${fmt.veces(c.misiones)}</dd>` : ''}
          <dt>Calendar</dt>${c.calendario_dias !== null ? `<dd class="num" data-v="calendario" data-valor="${c.calendario_dias}">${fmt.dias(c.calendario_dias)} d</dd>` : `<dd class="tenue" data-v="calendario">${esc(c.motivoCalendario)}</dd>`}`
        : `<dt>Excavation</dt><dd class="tenue" data-v="horas">not given: ${esc(c.motivo)}</dd>`;
      agua = `<dl><dt>Regolith</dt><dd class="num" data-v="regolito" data-valor="${pl.regolito_kg}">${fmt.masa(pl.regolito_kg)}</dd>
          <dt>Range</dt>${iv ? `<dd class="num" data-v="regolito-rango" data-min="${iv.min}" data-max="${iv.max}">${fmt.masa(iv.min)} – ${fmt.masa(iv.max)}</dd>` : `<dd class="tenue" data-v="regolito-rango">no cited range</dd>`}</dl>
        <div class="tenue nota-o">regolith = water ÷ (ice ${esc(D.hielo.pct)} % by mass × extraction ${esc(Math.round(D.eficiencia.valor * 100))} %) · ice: LCROSS ${cita(D.hielo.ref)}, measured in Cabeus crater: <b>NOT MEASURED HERE</b> · extraction ${cita(D.eficiencia.ref)}${D.agua_rango ? ` · range with the LCROSS total water ${esc(D.agua_rango.ref.valor.join('–'))} wt% (ice plus vapour) ${cita(D.agua_rango.ref)}` : ''}</div>
        <dl>${exc}</dl>
        <div class="tenue nota-o">excavation = regolith ÷ (${nr} × ${F.ritmo_kg_h ? `${esc(F.ritmo_kg_h.valor)} kg/h ${cita(F.ritmo_kg_h.ref)}` : 'no cited rate'}), in hours and Earth days of continuous work · <span class="supuesto">assumed</span> ${nr} ${nom} (robots)${F.mision_kg ? ` · missions = regolith ÷ ${fmt.masa(F.mision_kg.valor)} ${cita(F.mision_kg.ref)}` : ''} · calendar = excavation ÷ mean illumination at this cell (LOLA) · <span class="propio">own estimate</span>: robots work only while lit</div>
        ${h.no_medido.map((r) => `<div class="no-medido" data-v="${r.k}">${esc(r.texto)}</div>`).join('')}`;
    } else agua = `<div class="sin-ruta" data-v="sin-planta">${esc(h.motivo)}</div>`;
    let pot = '';
    if (h.energia) {
      const en = h.energia;
      pot = `<dl><dt>Solar towers</dt>${en.torres !== null ? `<dd class="num" data-v="torres" data-valor="${en.torres}">${en.torres} × ${esc(D.torre_kw.valor)} kW</dd>` : `<dd class="tenue" data-v="torres">${esc(en.motivo_torres)}</dd>`}
          <dt>With this light</dt>${en.torres_con_luz !== null ? `<dd class="num" data-v="torres-luz" data-valor="${en.torres_con_luz}">${en.torres_con_luz} <span class="tenue">at illumination ${fmt.frac(luz)}</span></dd>` : `<dd class="tenue" data-v="torres-luz">${esc(h.motivo_luz ?? en.motivo_torres_con_luz)}</dd>`}
          <dt>Reactors</dt>${en.reactores !== null ? `<dd class="num" data-v="reactores" data-valor="${en.reactores}">${en.reactores} × ${esc(D.reactor_kwe.valor)} kWe</dd>` : `<dd class="tenue" data-v="reactores">${esc(en.motivo_reactores)}</dd>`}</dl>
        <div class="tenue nota-o">${D.potencia_kw.valor} kW ÷ unit, rounded up${D.torre_kw ? ` · tower ${cita(D.torre_kw.ref)}` : ''}${D.reactor_kwe ? ` · reactor ${cita(D.reactor_kwe.ref)}` : ''} · ${esc(en.nota_torre)} · with this light: <span class="propio">own estimate</span>, towers at this cell's mean illumination · <span class="supuesto">assumed</span>: ${esc(en.nota_reactor)}</div>`;
    } else pot = `<div class="tenue" data-v="sin-energia">${esc(h.motivo_energia)}</div>`;
    const pr = h.propelente;
    const prop = pr ? `<dl><dt>O₂ · stoichiometry</dt><dd class="num" data-v="o2" data-valor="${pr.o2_kg}">${fmtV.t1(pr.o2_kg)}</dd>
        <dt>H₂ · stoichiometry</dt><dd class="num" data-v="h2" data-valor="${pr.h2_kg}">${fmtV.t1(pr.h2_kg)}</dd>
        <dt>O₂ · source</dt><dd class="num" data-v="o2-fuente" data-valor="${h.o2.fuente_kg}">${fmtV.t1(h.o2.fuente_kg)}</dd></dl>
      <div class="tenue nota-o">2 H₂O → 2 H₂ + O₂ with IUPAC atomic masses (own calculation) · source O₂ ${cita(O2_FUENTE)}</div>
      <div class="aviso-o2" data-v="aviso-o2">${esc(h.o2.aviso)}</div>` : '';
    cont.innerHTML = `<div class="et">Water plant · ice, regolith, power, propellant</div>
      <div class="hielo-celda ${hc.estado}" data-v="hielo-celda" data-estado="${hc.estado}">${hc.html}</div>
      ${D.produccion ? `<dl><dt>Water</dt><dd class="num" data-v="agua" data-valor="${D.produccion.agua_kg}">${fmtV.t1(D.produccion.agua_kg)} in ${esc(D.produccion.dias)} d</dd>
        ${D.potencia_kw ? `<dt>Power</dt><dd class="num" data-v="potencia-planta" data-valor="${D.potencia_kw.valor}">${esc(D.potencia_kw.valor)} kW</dd>` : ''}</dl>
        <div class="tenue nota-o">NASA baseline ${cita(D.produccion.ref)}${D.potencia_kw ? ` · ${esc(D.potencia_kw.ref.texto ?? '')} ${cita(D.potencia_kw.ref)}` : ''}</div>` : ''}
      ${agua}${pot}${prop}`;
  }

  return { V, leyenda, dibujar, hoja, pintar, lectura, perforarEn };
}
