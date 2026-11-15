// Generador de base en el panel lunar (base.js en un Worker) y su ensayo en el terreno terrestre de la pareja.
// Medidas del catálogo con su rótulo: cited (cifra tal cual), derived (own) (cifra citada con un uso propio), assumed (sin cita).
import { compararRequisito, cantidad, decimales, notaBasesPendiente, redondearArriba } from './evaluar.js';
import { cifraCitada, constante, defectosFlota, tiempoFlota, mediaCapa, pesosTrapecio, longitudCorte, celdasDisco, fmt, SUPUESTOS } from './panel_obra.js';
import { masaCorte } from './obra.js';
import { vehiculos, velocidadCatalogo } from './rutas.js';
import { pixelALatLon } from './georef.js';
import { cargarCatalogo } from './datos.js';
import { pedir } from './panel_rutas.js';

export const IDS_BASE = ['habitat', 'reactor', 'pista', 'torre', 'agua'];
export const EQUIPO_BASE = { habitat: 'habitat_superficie', reactor: 'reactor_fision', pista: 'pista_aterrizaje', torre: 'torre_solar', agua: 'planta_agua' };
// Criterio propio (el mismo que scripts/probar_base.mjs): candidatos de cada pieza a ≥ 200 m entre sí.
export const SEP_CANDIDATOS_M = 200;
const CRITERIOS = {
  habitat: [{ id: 'iluminacion', beneficio: true, peso: 1 }],
  reactor: [{ id: 'pendiente', beneficio: false, peso: 1 }],
  pista: [{ id: 'pendiente', beneficio: false, peso: 1 }],
  torre: [{ id: 'iluminacion', beneficio: true, peso: 1 }],
  agua: [{ id: 'dist_frio', beneficio: false, peso: 1 }],
};

const equipoDe = (catalogo, id) => (catalogo?.equipos ?? []).find((q) => q.id === id) ?? null;

export function medidasBase(catalogo, conceptos) {
  const citada = (eqId, nombre, rotulo, de) => {
    const c = cifraCitada(equipoDe(catalogo, eqId), nombre);
    return c ? { valor: c.valor, rotulo, ref: c, de: de(c) } : { valor: null, rotulo: null, ref: null, de: '', motivo: `${eqId}: no cited ${nombre} in the catalogue` };
  };
  const pa = (conceptos?.conceptos ?? []).find((c) => c.id === 'planta_agua_concepto');
  const par = (k) => pa?.parametros?.find((x) => x.nombre === k && Number.isFinite(x.valor) && x.valor > 0);
  const largo = par('largo_m'), ancho = par('ancho_m');
  const ltv = citada('ltv', 'ancho_m', 'assumed', (c) => `road width = LTV CLV-1 deployed width ${c.valor} m (cited), no margin`);
  return {
    habitat: citada('habitat_superficie', 'diametro_m', 'cited', (c) => `habitat diameter: ${c.texto ?? c.nombre}`),
    reactor: citada('reactor_fision', 'ancho_m', 'cited', (c) => `reactor width: ${c.texto ?? c.nombre}`),
    pista: citada('pista_aterrizaje', 'distancia_entre_zonas_m', 'derived (own)', (c) => `spacing between landing zones (${c.texto ?? c.nombre}) used as the pad diameter`),
    torre: citada('torre_solar', 'ancho_paneles_m', 'derived (own)', (c) => `solar array width (${c.texto ?? c.nombre}) used as the footprint diameter; tower base not public`),
    agua: largo && ancho
      ? { valor: Math.hypot(largo.valor, ancho.valor), rotulo: 'assumed', ref: null, de: `circle around the ${largo.valor} × ${ancho.valor} m water-plant concept (own concept, assumed size)` }
      : { valor: null, rotulo: null, ref: null, de: '', motivo: 'no water-plant concept size (conceptos.json)' },
    carretera: { ...ltv, ...(ltv.valor === null ? {} : { rotulo: 'assumed' }) },
  };
}

export function separacionPistaDefecto(catalogo) {
  const r = (equipoDe(catalogo, 'reactor_fision')?.requisitos ?? []).find((x) => x.variable === 'separacion_m' && x.respecto_a === 'habitat_superficie' && Number.isFinite(x.valor) && x.verificado === true);
  return r ? { valor: r.valor, ref: r } : null;
}

export function piezasBase(catalogo, M, umbralHielo, activas) {
  return IDS_BASE.filter((id) => activas.has(id) && M[id]?.valor > 0 && equipoDe(catalogo, EQUIPO_BASE[id])).map((id) => ({
    id, equipo: equipoDe(catalogo, EQUIPO_BASE[id]), diametro_m: M[id].valor,
    criterios: CRITERIOS[id].map((c) => (c.id === 'dist_frio' ? { ...c, umbral_k: umbralHielo } : { ...c })),
  }));
}

export function opcionesBase(M, sepPista, activas) {
  const extra = activas.has('pista') && activas.has('habitat') && Number.isFinite(sepPista) && sepPista > 0;
  return {
    anchoCarretera_m: M.carretera.valor, separacionHuellas_m: 0, separacionCandidatos_m: SEP_CANDIDATOS_M,
    separacionesExtra: extra ? [{ pieza: 'pista', con: 'habitat', op: '>=', valor: sepPista }] : [],
  };
}

// Lo que sale del Worker: sin los deltas n×n de las plataformas, con las celdas en corte contadas.
export function aligerar(r) {
  if (!r?.piezas) return r;
  return {
    ...r,
    piezas: r.piezas.map((p) => {
      const d = p.plataforma?.delta;
      let k = 0;
      if (d) for (let i = 0; i < d.length; i++) if (d[i] < 0) k++;
      return { ...p, plataforma: { ...p.plataforma, delta: null, celdas_corte: k } };
    }),
  };
}

// Mismas distancias en metros respecto al hábitat, sobre la rejilla terrestre; nada se mueve si cae fuera o sobre agua.
export function trasplantar(piezasLuna, mLuna, tierra, hab) {
  const hub = piezasLuna.find((p) => p.hub) ?? piezasLuna[0];
  const out = piezasLuna.map((p) => {
    const dx_m = (p.col - hub.col) * mLuna, dy_m = (p.fila - hub.fila) * mLuna;
    const fila = hab.fila + Math.round(dy_m / tierra.m), col = hab.col + Math.round(dx_m / tierra.m);
    const dentro = fila >= 0 && col >= 0 && fila < tierra.n && col < tierra.n;
    const agua = dentro && tierra.agua ? tierra.agua[fila * tierra.n + col] : null;
    return { id: p.id, hub: p === hub, dx_m, dy_m, fila, col, dentro, agua, enAgua: agua >= 1, comparte: null };
  });
  for (const x of out) x.comparte = out.find((y) => y !== x && y.fila === x.fila && y.col === x.col)?.id ?? null;
  return out;
}

// filas por pieza y requisito; la lectura es la de compararRequisito (la misma que la hoja Moon vs Earth).
export function filasEnsayo(piezas) {
  const out = [];
  for (const { id, eq, evsLuna, evsTierra, motivoTierra } of piezas) {
    evsLuna.forEach((evL, k) => {
      const req = evL.req;
      const evT = evsTierra ? evsTierra[k] : { req, variable: req.variable, op: req.op, limite: req.valor, unidad: req.unidad, valor: null, estado: req.valor === null || req.valor === undefined ? 'sin_limite' : 'no_medido', motivo: motivoTierra ?? 'not measured' };
      if (evL.estado === 'sin_limite') { out.push({ pieza: id, eq, req, luna: evL, tierra: evT, lectura: null, c: null }); return; }
      const c = compararRequisito(req, evL, evT);
      out.push({ pieza: id, eq, req, luna: evL, tierra: evT, lectura: c.lectura, c });
    });
  }
  return out;
}

export function resumenEnsayo(filas) {
  const r = { reproducido: 0, infra: 0, sobre: 0, no_medible: 0, sin_limite: 0, total: filas.length };
  for (const f of filas) r[f.lectura ?? 'sin_limite']++;
  return r;
}

// Excavación de toda la base: cada plataforma y carretera con corte, con las funciones de panel_obra.
export function flotaBase(r, { n, m, luz, densidad, flota, ancho_m }) {
  const elementos = [];
  for (const p of r.piezas ?? []) {
    const pl = p.plataforma;
    if (!(pl?.corte_m3 > 0)) continue;
    const rad = p.diametro_m / 2;
    const prof_m = pl.sub_celda ? pl.corte_m3 / ((Math.PI * rad * rad) / 2) : pl.corte_m3 / (Math.max(pl.celdas_corte ?? 0, 1) * m * m);
    elementos.push({ que: `pad ${p.id}`, corte_m3: pl.corte_m3, prof_m, celdas: pl.sub_celda ? [p.i] : celdasDisco(n, m, p.fila, p.col, p.diametro_m), pesos: null });
  }
  for (const c of r.carreteras ?? []) {
    if (c.tipo !== 'carretera' || !(c.corte_m3 > 0)) continue;
    const Lc = longitudCorte(c.s, c.z, c.zp);
    elementos.push({ que: `road to ${c.hasta}`, corte_m3: c.corte_m3, prof_m: Lc > 0 ? c.corte_m3 / (ancho_m * Lc) : 0, celdas: Array.from(c.traza), pesos: pesosTrapecio(c.s) });
  }
  if (!densidad) return { elementos, masa_kg: null, motivoMasa: 'no regolith density with a verified source', flota: { evaluable: false, motivo: 'no regolith mass' } };
  let masa = 0;
  const fls = elementos.map((x) => {
    x.masa_kg = masaCorte(x.corte_m3, x.prof_m, densidad);
    x.luz = luz ? mediaCapa(luz, x.celdas, x.pesos) : null;
    masa += x.masa_kg;
    return tiempoFlota(x.masa_kg, flota, x.luz, true);
  });
  if (!fls.length) {
    const t = tiempoFlota(0, flota, null, true);
    return { elementos, masa_kg: 0, flota: t.evaluable ? { ...t, calendario_dias: 0, motivoCalendario: null } : t };
  }
  const malo = fls.find((f) => !f.evaluable);
  if (malo) return { elementos, masa_kg: masa, flota: malo };
  const suma = (k) => (fls.every((f) => f[k] !== null) ? fls.reduce((s, f) => s + f[k], 0) : null);
  const cal = suma('calendario_dias');
  return {
    elementos, masa_kg: masa,
    flota: { evaluable: true, motivo: null, horas: suma('horas'), dias_tierra: suma('dias_tierra'), misiones: suma('misiones'), calendario_dias: cal, motivoCalendario: cal === null ? fls.find((f) => f.motivoCalendario)?.motivoCalendario ?? null : null },
  };
}

export const campanasDe = (sitios, id) => ((sitios?.sitios ?? []).find((s) => s.id === id)?.campanas ?? []).filter((c) => c.cita && c.fuente && c.verificado === true);

// Restricción que impide la base, por su nombre (texto plano).
export function textoRestriccion(q) {
  if (!q) return 'unknown';
  const org = q.origen === 'supuesto' ? ' (assumed parameter)' : q.fuente ? ' (catalogue)' : '';
  switch (q.tipo) {
    case 'separacion': return `separation: ${q.pieza} ${q.op} ${q.limite} m from the ${q.respecto_a}${org}`;
    case 'huella': return `footprint gap: ${q.pieza} ${q.op} ${q.limite} m from the ${q.con}`;
    case 'zona': return `suitable zone of ${q.pieza}: slope ≤ ${q.limite_pend_deg}°${(q.requisitos ?? []).filter((r) => r.variable !== 'pendiente_deg').map((r) => `, ${r.variable} ${r.op} ${r.valor}`).join('')}`;
    case 'plataforma': return `platform fit for ${q.pieza}`;
    case 'acceso': return `access from the ${q.con} to ${q.pieza}: vehicle route or road ≤ ${q.limite}°`;
    case 'combinacion': return 'combination: separations, footprint gaps and routes over other pads, all together';
    case 'presupuesto': return `search budget (${q.limite} routes)`;
    default: return q.tipo;
  }
}

// ---------- Pantalla ----------
const NOMBRE = { habitat: 'Habitat', reactor: 'Fission reactor', pista: 'Landing pad', torre: 'Solar tower', agua: 'Water plant' };
const ROTULO = { cited: '', 'derived (own)': 'propio', assumed: 'supuesto' };
const NOMBRE_TIPO = { zona: 'zone', pendiente_celda: 'cell slope', pendiente_plataforma: 'pad slope', sombra_permanente: 'perm. shadow', separacion: 'separation', huella: 'footprint gap', acceso: 'access', cruce: 'clear of pad' };
const fmtLat = (v) => (Number.isFinite(v) ? `${Math.abs(v).toFixed(5)}° ${v < 0 ? 'S' : 'N'}` : '—');
const fmtLon = (v) => (Number.isFinite(v) ? `${Math.abs(v).toFixed(5)}° ${v < 0 ? 'W' : 'E'}` : '—');
const numero = (v, d = 2) => (v === null || v === undefined ? '—' : Number.isFinite(v) ? (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(d)) : String(v));

class Cancelado extends Error {}

// ctx: catalogo, equipoDe, nombreCorto, esc, fuenteYCita, plantarEn, quitarPlantado, refrescarPlantado, evaluar, LECTURA, VARIABLE, OP, paneles, alternarAmpliado
export function crearBase(p, ctx) {
  const e = p.escena, n = e.n, { esc } = ctx;
  const luna = e.meta.cuerpo === 'luna';
  const B = { listo: false, err: null, M: null, sep: null, sepDef: null, obra: null, conceptos: null, sitios: null, activas: new Set(IDS_BASE), trabajo: null, res: null, uids: new Map(), serie: 0 };
  const aside = p.el.querySelector('.rutas');
  const sec = document.createElement('div');
  sec.className = 'base';
  aside?.appendChild(sec);
  const lienzo = p.el.querySelector('.lienzo');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('base-svg');
  lienzo.appendChild(svg);
  const cita = (ref) => (ref ? ctx.fuenteYCita(ref) : '');
  const veh = vehiculos(ctx.catalogo).find((v) => v.equipo.id === 'ltv') ?? null;
  const $ = (k) => sec.querySelector(`[data-b="${k}"]`);

  Promise.all(['obra.json', 'conceptos.json', 'sitios_ensayo.json'].map((f) => cargarCatalogo(f).catch((err) => { B.err = err.message; return null; })))
    .then(([obra, conceptos, sitios]) => {
      Object.assign(B, { obra, conceptos, sitios, listo: true });
      B.M = medidasBase(ctx.catalogo, conceptos);
      B.sepDef = separacionPistaDefecto(ctx.catalogo);
      B.sep = B.sepDef?.valor ?? null;
      B.F = defectosFlota(obra, ctx.catalogo?.equipos);
      B.hielo = constante(obra, 'hielo_superficie_temp_max_k');
      if (luna) pintar(); else pintarTierra();
    });

  // ---------- Parte A: generar (solo Luna) ----------
  function pintar() {
    if (!luna || !aside) return;
    if (!B.listo) { sec.innerHTML = '<div class="et sub">BASE · loading catalogue…</div>'; return; }
    const M = B.M, d = B.sepDef;
    const filaPieza = (id) => {
      const x = M[id], ok = x.valor > 0;
      const rot = ok ? `<span class="${ROTULO[x.rotulo] ?? ''}">${esc(x.rotulo)}</span>` : '';
      return `<div class="pieza-b"><label><input type="checkbox" data-b="usa-${id}" ${B.activas.has(id) && ok ? 'checked' : ''} ${id === 'habitat' || !ok || B.trabajo ? 'disabled' : ''} ${id === 'habitat' ? 'title="the habitat is the hub: every piece is joined to it"' : ''}>
        <span>${esc(NOMBRE[id])}</span></label><span class="num">${ok ? `Ø ${esc(numero(x.valor))} m` : '—'}</span>${rot}
        <div class="tenue nota-o${ok ? ' solo-fondo' : ''}">${ok ? `${esc(x.de)}${x.ref ? ` · ${cita(x.ref)}` : ''}` : esc(x.motivo)}</div></div>`;
    };
    sec.innerHTML = `<div class="et sub">BASE · generate on this terrain</div>
      <div class="tenue nota-o solo-fondo">places each ticked piece on its suitable zone, joined to the habitat by a ${esc(veh ? ctx.nombreCorto('ltv') : 'vehicle')} route or a built road, with the least earthworks and route length (own weights 1 m³ = 1 m³ = 1 m)</div><div class="tenue nota-o solo-simple">Laid out with our own weights (own criterion).</div>
      <div class="piezas-b">${IDS_BASE.map(filaPieza).join('')}</div>
      <label class="fila-o"><span class="et">PAD STANDOFF</span><span><input type="number" data-b="sep" min="0" step="any" value="${Number.isFinite(B.sep) ? B.sep : ''}" ${B.trabajo ? 'disabled' : ''}> m</span></label>
      <div class="tenue nota-o" data-b="sep-nota"><span class="supuesto">assumed · no published lander standoff; default = the cited reactor standoff figure, editable</span>${d ? ` · reactor ≥ ${esc(d.valor)} m from the habitat ${cita(d.ref)}` : ' · no cited reactor standoff in the catalogue'}</div>
      <div class="tenue nota-o">vehicle: ${veh ? `${esc(ctx.nombreCorto('ltv'))} ≤ ${esc(veh.limite)}° ${cita(veh.req)}` : 'no LTV slope limit in the catalogue'} · road width ${M.carretera.valor > 0 ? `${esc(M.carretera.valor)} m <span class="supuesto">assumed</span> (${esc(M.carretera.de)}) ${cita(M.carretera.ref)}` : esc(M.carretera.motivo)}${B.hielo ? ` · water plant near cold traps: temp_max ≤ ${esc(B.hielo.valor)} K ${cita(B.hielo)}` : ''}</div>
      <div class="botones"><button type="button" data-b="generar" ${B.trabajo || !veh || !(M.habitat.valor > 0) || !(M.carretera.valor > 0) ? 'disabled' : ''}>Plan base and roads</button><button type="button" data-b="cancelar" ${B.trabajo ? '' : 'disabled'}>Cancel</button><button type="button" data-b="ensayar" ${puedeEnsayar() ? '' : 'disabled'} title="${esc(tituloEnsayar())}">Rehearse on Earth</button></div>
      <div class="estado-b" data-b="estado">${esc(B.estado ?? '')}</div>
      <div data-b="res">${resultadoHtml()}</div>`;
    IDS_BASE.forEach((id) => $(`usa-${id}`)?.addEventListener('change', (ev) => { if (ev.target.checked) B.activas.add(id); else B.activas.delete(id); }));
    $('sep').addEventListener('change', (ev) => { const v = +ev.target.value; if (ev.target.value !== '' && v >= 0 && Number.isFinite(v)) B.sep = v; else ev.target.value = Number.isFinite(B.sep) ? B.sep : ''; });
    $('generar').addEventListener('click', generar);
    $('cancelar').addEventListener('click', () => B.trabajo?.cancelar());
    $('ensayar').addEventListener('click', () => ensayarEnTierra());
    dibujar();
  }
  const estadoTxt = (t) => { B.estado = t; const el = $('estado'); if (el) el.textContent = t; };

  function tierra() {
    return (ctx.paneles ?? []).find((q) => q !== p && q.escena?.meta.cuerpo === 'tierra' && q.base) ?? null;
  }
  function puedeEnsayar() { return luna && !!B.res?.r.factible && !B.trabajo && !!tierra(); }
  function tituloEnsayar() { return !tierra() ? 'needs an Earth terrain in the other panel' : !B.res?.r.factible ? 'generate a base first' : 'transplants this base to the Earth terrain of the pair'; }

  function ejecutar(datos) {
    const w = new Worker(new URL('./base_worker.js', import.meta.url), { type: 'module' });
    let cancelar;
    const pr = new Promise((ok, mal) => {
      w.onmessage = ({ data }) => { w.terminate(); data.ok ? ok(data) : mal(new Error(data.error)); };
      w.onerror = (ev) => { ev.preventDefault(); w.terminate(); mal(new Error(ev.message || 'base worker failed')); };
      cancelar = () => { w.terminate(); mal(new Cancelado()); };
    });
    w.postMessage(datos, [datos.t.alturas.buffer]);
    return { pr, cancelar };
  }

  async function generar() {
    if (B.trabajo || !veh) return;
    const activas = new Set(B.activas), sep = B.sep;
    const piezas = piezasBase(ctx.catalogo, B.M, B.hielo?.valor, activas);
    const opc = opcionesBase(B.M, sep, activas);
    const capas = {};
    for (const k of ['iluminacion', 'sombra_permanente', 'temp_max', 'temp_min', 'agua']) if (e.capas[k]) capas[k] = e.capas[k];
    const version = p.rutas?.R.version ?? 0, t0 = performance.now();
    const job = ejecutar({ t: { n, m: e.m, alturas: Float32Array.from(e.actual), capas }, piezas, vehiculo: { limite: veh.limite, equipo: { id: veh.equipo.id } }, opc });
    B.trabajo = job;
    const tic = () => estadoTxt(`computing… ${((performance.now() - t0) / 1000).toFixed(0)} s (Web Worker: the page stays usable)`);
    tic();
    const reloj = setInterval(tic, 1000);
    pintar();
    try {
      const { r, ms } = await job.pr;
      B.res = { r, ms, version, activas, sep, piezas, opc, serie: ++B.serie };
      plantar(r);
      estadoTxt(`base ${r.factible ? 'generated' : 'search finished, no base'} in ${(ms / 1000).toFixed(1)} s (Web Worker)`);
    } catch (err) {
      estadoTxt(err instanceof Cancelado ? 'cancelled: no base generated, the previous result (if any) is kept' : `base generation failed: ${err.message}`);
    } finally {
      clearInterval(reloj);
      B.trabajo = null;
    }
    pintar();
    for (const q of ctx.paneles ?? []) if (q !== p) q.base?.baseCambiada?.();
    $('res')?.scrollIntoView({ block: 'nearest' });
  }

  function quitarMios(uids) {
    for (const uid of uids.values()) if (p.plantados?.buscar(uid)) ctx.quitarPlantado(p, uid);
    uids.clear();
  }
  function plantar(r) {
    quitarMios(B.uids);
    if (!r.factible) { ctx.refrescarPlantado(); return; }
    for (const x of r.piezas) B.uids.set(x.id, ctx.plantarEn(p, x.equipo, x.fila, x.col).uid);
    p.sel = null;
    ctx.refrescarPlantado();
  }

  function resultadoHtml() {
    const R = B.res;
    if (!R) return '';
    const r = R.r;
    const obs = R.version === (p.rutas?.R.version ?? 0) ? '' : '<div class="aviso-obs" data-b="obs">terrain changed since this base: generate again</div>';
    const porMedir = `<details class="det-b" data-b="por-medir"><summary class="et">NOT MEASURED OR NOT APPLIED (${r.por_medir.length})</summary><ul>${r.por_medir.map((s) => `<li>${esc(s)}</li>`).join('')}</ul></details>`;
    if (!r.factible) {
      return `${obs}<div class="sin-ruta" data-b="sin-base">NO BASE · ${esc(r.motivo)}</div>
        <div class="restriccion-b" data-b="restriccion"><span class="et">BLOCKED BY</span> ${esc(textoRestriccion(r.restriccion))}</div>${porMedir}`;
    }
    const b = r.busqueda;
    const busq = b.optimo_probado
      ? `<b>exact</b>: the best combination of the candidate cells is proven (branch and bound over ${esc(b.combinaciones)} combinations, ${esc(b.rutas_evaluadas)} routes evaluated); cells outside the top ${esc(b.k)} candidates per piece are not searched`
      : `<b>heuristic</b>: search budget used up, optimum NOT proven (lower bound ${esc(numero(b.cota_inferior))} vs ${esc(numero(r.objetivo.total))})`;
    const acc = new Map(r.carreteras.map((c) => [c.hasta, c]));
    const piezas = r.piezas.map((x) => {
      const ll = pixelALatLon(e.meta, x.fila, x.col), pl = x.plataforma, c = acc.get(x.id);
      const acceso = x.hub ? 'hub: every access starts here'
        : c.tipo === 'ruta' ? `${esc(ctx.nombreCorto('ltv'))} route ${fmt.km(c.longitud_m)} (no earthworks)`
          : `road ${fmt.km(c.longitud_m)} · cut ${fmt.m3(c.corte_m3)} fill ${fmt.m3(c.relleno_m3)} · max cut ${fmt.m(c.corte_max_m)} · max fill ${fmt.m(c.relleno_max_m)}`;
      return `<div class="pieza-res" data-pieza="${esc(x.id)}"><div><b>${esc(NOMBRE[x.id] ?? x.id)}</b> <span class="num" data-b="pos-${esc(x.id)}">cell ${x.fila},${x.col}</span></div>
        <div class="num tenue">${fmtLat(ll.lat)} ${fmtLon(ll.lon)}</div>
        <div class="num" data-b="pad-${esc(x.id)}">pad Ø ${esc(numero(x.diametro_m))} m · slope ${fmt.grados(pl.pend_antes_deg, 2)} → ${fmt.grados(pl.pend_despues_deg, 2)} (≤ ${esc(x.limite_pend_deg)}°) · cut ${fmt.m3(pl.corte_m3)} fill ${fmt.m3(pl.relleno_m3)}${pl.sub_celda ? ' · estimate (narrower than 3 cells)' : ''}</div>
        <div class="num" data-b="acceso-${esc(x.id)}">${acceso}</div></div>`;
    }).join('');
    const T = r.totales;
    const F = B.F, flota = { n_robots: SUPUESTOS.n_robots, kg_h: F?.ritmo_kg_h?.valor ?? null, mision_kg: F?.mision_kg?.valor ?? null };
    const fb = flotaBase(r, { n, m: e.m, luz: e.capas.iluminacion ?? null, densidad: F?.densidad?.valor ?? null, flota, ancho_m: R.opc.anchoCarretera_m });
    const fl = fb.flota, nomR = esc(ctx.nombreCorto('ipex'));
    const flotaHtml = `<dt>MASS TO MOVE</dt>${fb.masa_kg !== null ? `<dd class="num" data-b="masa">${fmt.masa(fb.masa_kg)}</dd>` : `<dd class="tenue" data-b="masa">not given: ${esc(fb.motivoMasa)}</dd>`}
      ${fl.evaluable ? `<dt>EXCAVATION</dt><dd class="num" data-b="horas">${fmt.horas(fl.horas)} · ${fmt.dias(fl.dias_tierra)} d</dd>
        ${fl.misiones !== null ? `<dt>${nomR} MISSIONS</dt><dd class="num">${fmt.veces(fl.misiones)}</dd>` : ''}
        <dt>CALENDAR</dt>${fl.calendario_dias !== null ? `<dd class="num">${fmt.dias(fl.calendario_dias)} d</dd>` : `<dd class="tenue">${esc(fl.motivoCalendario)}</dd>`}` : `<dt>EXCAVATION</dt><dd class="tenue" data-b="horas">not given: ${esc(fl.motivo)}</dd>`}`;
    const restr = r.restricciones.map((q) => `<tr class="${q.holgura !== null && q.holgura < 0 ? 'rompe' : ''}"><td>${esc(q.pieza)}</td><td>${esc(NOMBRE_TIPO[q.tipo] ?? q.tipo)}${q.variable ? ` ${esc(q.variable)}` : ''}${q.con ? ` · ${esc(q.con)}` : ''}${q.origen === 'supuesto' ? ' <span class="supuesto">assumed</span>' : q.origen === 'mío' ? ' <span class="propio">own</span>' : ''}</td>
      <td class="num">${esc(numero(q.valor))} ${esc(q.op)} ${esc(numero(q.limite))}${q.unidad && q.unidad !== '0/1' ? ` ${esc(q.unidad)}` : ''}</td><td class="num">${q.holgura === null ? 'not measured' : esc(numero(q.holgura))}</td></tr>`).join('');
    return `${obs}<div class="busqueda-b" data-b="busqueda">${busq}</div>
      <div class="piezas-res">${piezas}</div>
      <dl class="totales-b"><dt>PADS CUT · FILL</dt><dd class="num" data-b="t-pads">${fmt.m3(T.plataformas_corte_m3)} · ${fmt.m3(T.plataformas_relleno_m3)}</dd>
        <dt>ROADS CUT · FILL</dt><dd class="num" data-b="t-roads">${fmt.m3(T.carreteras_corte_m3)} · ${fmt.m3(T.carreteras_relleno_m3)}</dd>
        <dt>ROUTE LENGTH</dt><dd class="num" data-b="t-rutas">${fmt.km(T.rutas_m)}</dd>
        <dt>OBJECTIVE</dt><dd class="num" data-b="t-obj">${esc(numero(r.objetivo.total))} <span class="propio">own criterion</span></dd>${flotaHtml}</dl>
      <div class="no-medido" data-b="acarreo">haul time: NOT MEASURED (no published payload per trip)</div>
      <div class="tenue nota-o">excavation = mass of every cut (pads and roads) ÷ (${SUPUESTOS.n_robots} <span class="supuesto">assumed</span> × ${F?.ritmo_kg_h ? `${esc(F.ritmo_kg_h.valor)} kg/h ${cita(F.ritmo_kg_h.ref)}` : 'no cited rate'}), mass from the regolith density profile ${F?.densidad ? cita(F.densidad.ref) : ''}; calendar counts only sunlight (<span class="propio">own estimate</span>, as in the road tool)</div>
      <details class="det-b solo-fondo" data-b="restricciones"><summary class="et">CONSTRAINTS · value, limit and slack (${r.restricciones.length})</summary><table class="comp"><tbody>${restr}</tbody></table></details>
      ${porMedir}
      <div class="tenue nota-o">lines on the terrain: solid = ${esc(ctx.nombreCorto('ltv'))} route, dashed = road to build · click a marker for its sheet</div>`;
  }

  // ---------- Dibujo ----------
  function trazo(camino, caja) {
    const paso = Math.max(1, Math.ceil(camino.length / 600));
    let d = '', abierto = false;
    const punto = (i) => { const s = e.aPantalla(e.mundoDePixel(Math.floor(i / n), i % n)); return s ? `${(s.x - caja.left).toFixed(1)},${(s.y - caja.top).toFixed(1)}` : null; };
    for (let k = 0; k < camino.length; k += paso) {
      const s = punto(camino[k]);
      if (!s) { abierto = false; continue; }
      d += `${abierto ? 'L' : 'M'}${s}`; abierto = true;
    }
    const u = punto(camino[camino.length - 1]);
    if (u && abierto) d += `L${u}`;
    return d;
  }
  function dibujar() {
    const lineas = B.lineas?.() ?? (B.res?.r.factible ? B.res.r.carreteras.map((c) => ({ camino: c.traza, clase: c.tipo === 'ruta' ? 'ruta-b' : 'carretera-b' })) : []);
    if (!lineas.length || p.el.offsetParent === null) { svg.innerHTML = ''; return; }
    const caja = lienzo.getBoundingClientRect();
    svg.innerHTML = lineas.map((l) => { const d = trazo(l.camino, caja); return `<path class="fondo-b" d="${d}"></path><path class="${l.clase}" d="${d}"></path>`; }).join('');
  }

  // ---------- Parte B: ensayo en la Tierra (se completa en el panel terrestre) ----------
  function ensayarEnTierra() {
    const q = tierra();
    if (!q || !B.res?.r.factible) return;
    q.base.ensayar(p, B.res);
  }

  // ---------- Parte B en el panel terrestre ----------
  const aviso = document.createElement('div');
  aviso.className = 'aviso-ruta';
  aviso.hidden = true;
  lienzo.appendChild(aviso);
  B.lineas = () => (luna ? null : (B.ens?.accesos ?? []).filter((a) => a.camino).map((a) => ({ camino: a.camino, clase: 'ruta-b' })));

  function ensayar(pLuna, resLuna) {
    const nueva = B.ens?.resLuna !== resLuna;
    B.ens = { pLuna, resLuna, hab: nueva || !B.ens ? { fila: Math.floor(n / 2), col: Math.floor(n / 2) } : B.ens.hab, serie: (B.ens?.serie ?? 0) + 1 };
    if (!p.ampliado) ctx.alternarAmpliado(p, true);
    calcularEnsayo();
  }

  function itemLuna(id) {
    const uid = B.ens.pLuna.base?.B.uids.get(id);
    return uid ? B.ens.pLuna.plantados?.buscar(uid) ?? null : null;
  }

  async function calcularEnsayo() {
    const E = B.ens, pL = E.pLuna, r = E.resLuna.r, eL = pL.escena, serie = ++B.serie;
    E.serieCalculo = serie;
    E.tras = trasplantar(r.piezas, eL.m, { n, m: e.m, agua: e.capas.agua ?? null }, E.hab);
    quitarMios(B.uids);
    for (const t of E.tras) if (t.dentro) B.uids.set(t.id, ctx.plantarEn(p, EQUIPO_BASE[t.id], t.fila, t.col).uid);
    p.sel = null;
    ctx.refrescarPlantado();
    const entrada = E.tras.map((t) => {
      const eq = ctx.equipoDe(EQUIPO_BASE[t.id]), iL = itemLuna(t.id), iT = B.uids.has(t.id) ? p.plantados.buscar(B.uids.get(t.id)) : null;
      return { id: t.id, eq, evsLuna: iL ? ctx.evaluar(pL, iL) : [], sinLuna: !iL, evsTierra: iT ? ctx.evaluar(p, iT) : null, motivoTierra: `falls outside this Earth terrain (cell ${t.fila},${t.col})` };
    });
    E.sinLuna = entrada.filter((x) => x.sinLuna).map((x) => x.id);
    E.filas = filasEnsayo(entrada);
    E.resumen = resumenEnsayo(E.filas);
    E.accesos = null; E.visita = null; E.listo = false;
    estadoTierra('computing Earth routes for the LTV… (Web Worker)');
    pintarTierra();
    try {
      await rutasTierra(E, serie);
      if (B.serie === serie) estadoTierra(`rehearsal computed: ${E.accesos.filter((a) => a.camino).length} of ${E.accesos.length} accesses with an LTV route on this terrain`);
    } catch (err) {
      if (B.serie === serie) estadoTierra(`Earth routes failed: ${err.message}`);
    }
    if (B.serie !== serie) return;
    E.listo = true;
    pintarTierra();
  }

  async function rutasTierra(E, serie) {
    if (!veh) { E.accesos = []; return; }
    const por = Object.fromEntries(E.tras.map((t) => [t.id, t]));
    const hub = E.tras.find((t) => t.hub), out = [];
    const pedirT = async (tipo, extra) => {
      const alt = Float32Array.from(e.actual);
      return pedir(tipo, { n, m: e.m, alturas: alt, sombra: null, agua: e.capas.agua ?? null, carreteras: null, limite: veh.limite, factor: 1, ...extra }, [alt.buffer]);
    };
    for (const c of E.resLuna.r.carreteras) {
      const t = por[c.hasta], a = { id: c.hasta, luna: c, camino: null };
      if (!hub.dentro || !t.dentro) a.motivo = `${!hub.dentro ? 'the habitat' : 'this piece'} falls outside this Earth terrain`;
      else {
        const q = await pedirT('ruta', { origen: hub.fila * n + hub.col, destino: t.fila * n + t.col });
        if (B.serie !== serie) return;
        if (q.camino) Object.assign(a, { camino: q.camino, longitud_m: q.medidas.longitud_m, diezmado: q.diezmado });
        else if (q.aguaOrigen >= 1 || q.aguaDestino >= 1) a.motivo = `${q.aguaOrigen >= 1 ? 'the habitat' : 'this piece'} is on water (impassable)`;
        else a.umbral = q.umbral;
      }
      out.push(a);
    }
    E.accesos = out;
    const puntos = E.tras.filter((t) => t.dentro && !t.enAgua);
    if (puntos.length >= 2 && puntos[0].hub) {
      const q = await pedirT('visita', { puntos: puntos.map((t) => t.fila * n + t.col) });
      if (B.serie !== serie) return;
      E.visita = { ids: puntos.map((t) => t.id), ...q };
    }
  }

  const estadoTierra = (t) => { B.estado = t; const el = sec.querySelector('[data-b="estado"]'); if (el) el.textContent = t; };
  const VERED = { ok: ['OK', 'v-ok'], rompe: ['BREAKS', 'v-rompe'], no_medido: ['NOT MEASURED', 'v-nm'], cota_inferior: ['LOWER BOUND', 'v-cota'], sin_limite: ['NO LIMIT', 'v-nm'] };
  const FACTOR = { vacio: 'Vacuum', polvo: 'Dust', gravedad: 'Gravity' };
  const celdaEv = (ev) => {
    const [t, cl] = VERED[ev.estado] ?? [ev.estado, ''];
    return `<span class="num">${esc(cantidad(ev.valor, ev.unidad, decimales(ev.unidad)))}</span> <b class="${cl}">${t}</b>`;
  };
  const nombreReq = (q) => `${ctx.VARIABLE?.[q.variable] ?? q.variable}${q.variable === 'separacion_m' ? ` from ${ctx.nombreCorto(q.respecto_a)}` : ''} ${ctx.OP?.[q.op] ?? q.op} ${q.valor === null || q.valor === undefined ? '—' : cantidad(q.valor, q.unidad)}`;

  function pintarTierra() {
    if (luna || !aside) return;
    const E = B.ens;
    if (!E) { sec.innerHTML = '<div class="et sub">REHEARSE ON EARTH</div><div class="tenue">generate a base on the Moon panel, then press Rehearse on Earth there</div>'; dibujar(); return; }
    const pL = E.pLuna, eL = pL.escena, R = E.resumen;
    const obs = pL.base?.B.res === E.resLuna ? '' : '<div class="aviso-obs" data-b="obs">the Moon base changed since: press Rehearse on Earth again</div>';
    const fuera = E.tras.filter((t) => !t.dentro), agua = E.tras.filter((t) => t.enAgua);
    const posiciones = E.tras.map((t) => `<tr data-b="tras-${esc(t.id)}"><td>${esc(NOMBRE[t.id] ?? t.id)}</td><td class="num">${t.hub ? 'hub' : `${(t.dx_m / 1000).toFixed(2)}, ${(-t.dy_m / 1000).toFixed(2)} km`}</td><td class="num">${t.fila},${t.col}</td><td>${!t.dentro ? '<b class="v-nm">OUTSIDE</b>' : t.enAgua ? `<b class="v-rompe">ON WATER</b>` : 'land'}</td></tr>`).join('');
    const filas = E.filas.map((f) => `<tr class="${f.lectura ? `lec-${f.lectura}` : ''}"><td><b>${esc(NOMBRE[f.pieza] ?? f.pieza)}</b><div>${esc(nombreReq(f.req))}</div></td><td class="lados-b"><div><span class="et">M</span> ${celdaEv(f.luna)}</div><div><span class="et">E</span> ${celdaEv(f.tierra)}</div></td>
      <td>${f.lectura ? `${esc(ctx.LECTURA[f.lectura])}${f.c.motivo ? `<div class="motivo">${esc(f.c.motivo)}</div>` : ''}` : '<span class="tenue">no public limit: not compared</span>'}</td></tr>`).join('');
    const accesos = E.accesos === null ? '<div class="tenue">computing…</div>' : `<table class="comp" data-b="accesos"><thead><tr><th></th><th>MOON</th><th>EARTH · ${esc(ctx.nombreCorto('ltv'))} ≤ ${esc(veh?.limite)}°</th></tr></thead><tbody>${E.accesos.map((a) => `<tr data-b="acc-${esc(a.id)}"><td>${esc(NOMBRE[a.id] ?? a.id)}</td>
        <td class="num">${a.luna.tipo === 'ruta' ? `route ${fmt.km(a.luna.longitud_m)}` : `road ${fmt.km(a.luna.longitud_m)} (built)`}</td>
        <td class="num">${a.camino ? `route ${fmt.km(a.longitud_m)}${a.diezmado ? ' (grid ×2)' : ''}` : a.motivo ? `<span class="tenue">${esc(a.motivo)}</span>` : Number.isFinite(a.umbral) ? `<b>no route</b> · a slope limit of ${redondearArriba(a.umbral, 1).toFixed(1)}° would open it` : '<b>no route</b> at any slope (water or no data in between)'}</td></tr>`).join('')}</tbody></table>`;
    const vel = veh ? velocidadCatalogo(veh.equipo) : null;
    const v = E.visita;
    const conduccion = !E.listo ? '<div class="tenue">computing…</div>'
      : !v ? '<div class="tenue" data-b="visita">no round trip: fewer than two pieces on land inside this terrain, or the habitat is not one of them</div>'
        : !v.camino ? '<div class="tenue" data-b="visita">no round trip within the LTV slope limit on this terrain</div>'
          : `<dl><dt>ROUND TRIP</dt><dd class="num" data-b="visita">${fmt.km(v.medidas.longitud_m)} · ${v.ids.length} pieces</dd>${vel ? `<dt>DRIVING TIME</dt><dd class="num" data-b="visita-h">≥ ${fmt.horas(v.medidas.longitud_m / 1000 / vel.kmh)}</dd>` : ''}</dl>
            <div class="tenue nota-o">${vel ? `<span class="propio">own figure</span> · lower bound: round trip at the catalogue ${esc(vel.tipo)} speed ${esc(+vel.kmh.toFixed(3))} km/h, constant, no stops ${cita(vel.cifra)}` : 'no catalogue speed with a source: no time given'}</div>`;
    const camps = campanasDe(B.sitios, e.meta.id);
    const campanas = camps.length
      ? camps.map((c) => `<div class="campana" data-b="campana"><b>${esc(c.nombre)}</b> · ${esc(c.sistema ?? '')} · ${cita(c)}</div>`).join('') + '<div class="tenue nota-o solo-fondo">duration: only as written in the quote (the catalogue has no duration field)</div>'
      : '<div class="tenue" data-b="sin-campana">no real campaign on this terrain in the catalogue (sitios_ensayo.json)</div>';
    const noMed = E.filas.filter((f) => f.lectura === 'no_medible');
    const noEns = [...new Set(E.tras.map((t) => EQUIPO_BASE[t.id]))].flatMap((id) => (ctx.equipoDe(id)?.no_ensayable_tierra ?? []).map((x) => ({ id, x })));
    const bases = E.filas.some((f) => f.req.variable === 'pendiente_deg') ? notaBasesPendiente(eL.m, e.m) : null;
    const noDice = [
      ...noMed.map((f) => `<li>${esc(NOMBRE[f.pieza] ?? f.pieza)} · ${esc(nombreReq(f.req))}: ${esc(f.c.motivo ?? 'not measured')}</li>`),
      ...fuera.map((t) => `<li>${esc(NOMBRE[t.id] ?? t.id)}: falls outside this Earth terrain at the same offset: not rehearsed (not moved)</li>`),
      ...agua.map((t) => `<li>${esc(NOMBRE[t.id] ?? t.id)}: lands on water at the same offset: not ground (not moved)</li>`),
      ...E.tras.filter((t) => t.comparte && t.dentro && E.tras.indexOf(t) < E.tras.findIndex((y) => y.id === t.comparte)).map((t) => `<li>${esc(NOMBRE[t.id] ?? t.id)} and ${esc(NOMBRE[t.comparte] ?? t.comparte)} land on the same Earth cell (${e.m.toFixed(0)} m): their spacing is not resolved here</li>`),
      ...E.sinLuna.map((id) => `<li>${esc(NOMBRE[id] ?? id)}: no longer planted on the Moon panel: Moon values not measured</li>`),
      ...noEns.map(({ id, x }) => `<li>${esc(ctx.nombreCorto(id))} · ${esc(FACTOR[x.factor] ?? x.factor ?? '')}: ${esc(x.texto ?? '')} · ${cita(x)}</li>`),
      '<li>pads and roads: the Moon earthworks are not rebuilt or measured on this terrain</li>',
      bases ? `<li>${esc(bases)}</li>` : '',
      `<li>reproduced = Earth within a margin of the Moon value: own threshold, not from a source</li>`,
      `<li>positions keep the Moon grid offsets (${eL.m.toFixed(2)} m/px) on the Earth grid (${e.m.toFixed(2)} m/px), rounded to the nearest cell; grids are not rotated to a common north</li>`,
    ].join('');
    sec.innerHTML = `<div class="et sub">REHEARSE ON EARTH · ${esc(eL.meta.id)} → ${esc(e.meta.id)}</div>${obs}
      <div class="fila-o"><span class="et">HABITAT AT</span><span class="num" data-b="hab">cell ${E.hab.fila},${E.hab.col}</span></div>
      <div class="botones"><button type="button" data-b="elegir" aria-pressed="${!!B.eligiendo}">Click where the habitat goes</button></div>
      <table class="comp solo-fondo" data-b="trasplante"><thead><tr><th></th><th>OFFSET (GRID →, ↑)</th><th>CELL</th><th></th></tr></thead><tbody>${posiciones}</tbody></table>
      <div class="et">SUMMARY · ${R.total - R.sin_limite} requirements compared</div>
      <div class="resumen-b num" data-b="resumen"><span>reproduced <b data-n="reproducido">${R.reproducido}</b></span> <span>under-tested <b data-n="infra">${R.infra}</b></span> <span>over-tested <b data-n="sobre">${R.sobre}</b></span> <span>cannot be measured <b data-n="no_medible">${R.no_medible}</b></span>${R.sin_limite ? ` <span class="tenue">no public limit <b data-n="sin_limite">${R.sin_limite}</b></span>` : ''}</div>
      <table class="comp" data-b="tabla"><thead><tr><th>requirement</th><th>MOON · EARTH</th><th>reading</th></tr></thead><tbody>${filas}</tbody></table>
      <div class="et">ACCESS FROM THE HABITAT</div>${accesos}
      <div class="et">CAMPAIGN</div>
      <div class="tenue nota-o">real campaigns on this terrain <span class="tenue">(cited)</span></div>${campanas}
      ${conduccion}
      <div class="tenue nota-o" data-b="sin-veredicto">no cited working hours per day: the campaign and the driving time are shown side by side, with no verdict on whether the rehearsal fits</div>
      <details class="det-b" data-b="no-dice" open><summary class="et">WHAT THIS REHEARSAL DOES NOT TELL YOU</summary><ul>${noDice}</ul></details>
      <div class="estado-b" data-b="estado">${esc(B.estado ?? '')}</div>`;
    sec.querySelector('[data-b="elegir"]').addEventListener('click', () => elegirHab(!B.eligiendo));
    dibujar();
  }

  function elegirHab(si) {
    B.eligiendo = si;
    if (si) { ctx.modoPlantar(p, null); ctx.elegirHerramienta(p, 'navegar'); }
    p.el.classList.toggle('plantando', si);
    aviso.hidden = !si;
    if (si) aviso.innerHTML = '<span class="et">REHEARSE</span> click where the habitat goes · Esc cancels';
    sec.querySelector('[data-b="elegir"]')?.setAttribute('aria-pressed', String(si));
  }
  if (!luna) {
    e.renderer.domElement.addEventListener('pointerdown', (ev) => {
      if (!B.eligiendo || ev.button !== 0) return;
      ev.stopImmediatePropagation(); ev.preventDefault();
      const g = e.rayo(ev.clientX, ev.clientY);
      if (!g || !B.ens) return;
      B.ens.hab = { fila: Math.min(n - 1, Math.max(0, Math.round(g.fila))), col: Math.min(n - 1, Math.max(0, Math.round(g.col))) };
      elegirHab(false);
      calcularEnsayo();
    }, { capture: true });
    window.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && B.eligiendo) { ev.stopImmediatePropagation(); elegirHab(false); } }, true);
  }

  const baseCambiada = () => { if (!luna && B.ens) pintarTierra(); };
  if (luna) pintar(); else pintarTierra();
  return { B, dibujar, pintar, sec, ensayar, baseCambiada };
}
