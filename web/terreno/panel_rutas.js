// Herramienta Route (recorridos) y Sites (reparto de instalaciones) de un panel del visor.
import { vehiculos, velocidadCatalogo, velocidadEfectiva, horasEnSombra } from './rutas.js';
import { decimalesVeredicto, redondearArriba } from './evaluar.js';
import { firmaDisposicion } from './plantado.js';

const TOPSIS_REF = {
  fuente: 'https://arxiv.org/pdf/2406.19863',
  cita: 'This study evaluates potential landing sites for the Artemis III mission using a combination of Geographic Information Systems (GIS) and Multi-Criteria Decision Making (MCDM) methodologies, specifically the TOPSIS algorithm.',
  verificado: true,
};
// Criterios propios (no vienen de ninguna fuente).
const N_SUG = 5;
const SEPARACION_SUG_M = 1000;
const MAX_PARADAS = 8;
const RAMPA_ZONA = 'linear-gradient(90deg, rgb(13,31,89), rgb(158,242,255))';
const CAPA_ZONA = '_zona_apta';
const CRITERIOS = [
  { id: 'iluminacion', nombre: 'mean illumination', beneficio: true },
  { id: 'pendiente', nombre: 'slope', beneficio: false },
  { id: 'dist_sombra', nombre: 'distance to permanent shadow', beneficio: false },
  { id: 'dist_ref', nombre: 'distance to', beneficio: false },
];

let worker = null, sigId = 1;
const enCurso = new Map();

export function pedir(tipo, datos, transfer = []) {
  if (!worker) {
    worker = new Worker(new URL('./rutas_worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      const h = enCurso.get(data.id);
      enCurso.delete(data.id);
      if (h) (data.ok ? h.ok(data.r) : h.mal(new Error(data.error)));
    };
    worker.onerror = (ev) => {
      ev.preventDefault();
      for (const h of enCurso.values()) h.mal(new Error(ev.message || 'route worker failed'));
      enCurso.clear();
    };
  }
  const id = sigId++;
  return new Promise((ok, mal) => {
    enCurso.set(id, { ok, mal });
    worker.postMessage({ id, tipo, ...datos }, transfer);
  });
}

const km = (m, d = 2) => (Number.isFinite(m) ? `${(m / 1000).toFixed(d)} km` : '—');
const grados = (x) => (Number.isFinite(x) ? `${x.toFixed(1)}°` : '—');
// Pendiente comparada con un límite: con los decimales que hagan falta para no parecer igual a él.
const gradosFrente = (v, lim) => (Number.isFinite(v) ? `${v.toFixed(decimalesVeredicto({ valor: v, limite: lim, exceso: Math.abs(v - lim) }, 1))}°` : '—');
const horas = (h) => (h >= 10 ? `${h.toFixed(0)} h` : h >= 1 ? `${h.toFixed(1)} h` : `${Math.round(h * 60)} min`);

// ctx: funciones del visor (equipoDe, nombreCorto, esc, fuenteYCita, plantarEn, elegirHerramienta, modoPlantar, refrescarPlantado, catalogo)
export function crearRutas(p, ctx) {
  const e = p.escena, n = e.n, { esc } = ctx;
  const luna = e.meta.cuerpo === 'luna';
  const hayPSR = !!e.capas.sombra_permanente;
  const hayILU = !!e.capas.iluminacion;
  const hayAgua = !!e.capas.agua;
  const fuenteAgua = () => {
    const c = e.meta.capas.agua, u = /^https?:\/\//i.test(c?.url ?? '') ? c.url : null;
    return u ? `<a href="${esc(u)}" target="_blank" rel="noopener" title="${esc(c.fuente ?? '')}">Copernicus DEM water body mask</a>` : 'Copernicus DEM water body mask';
  };
  const nombreAgua = (a) => e.meta.capas.agua?.clases?.[String(a)] ?? `class ${a}`;
  const vehs = vehiculos(ctx.catalogo);
  const R = { desde: null, hasta: null, eligiendo: null, res: null, visita: null, version: 0, zona: null, zonaVisible: false, sug: null, firmaPlantados: '' };

  const aside = document.createElement('aside');
  aside.className = 'rutas';
  p.el.appendChild(aside);
  const lienzo = p.el.querySelector('.lienzo');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('rutas-svg');
  lienzo.appendChild(svg);
  const aviso = document.createElement('div');
  aviso.className = 'aviso-ruta';
  aviso.hidden = true;
  lienzo.appendChild(aviso);

  const fuenteVeh = (v) => ctx.fuenteYCita(v.req);
  aside.innerHTML = `
    <div class="et">Route · ${esc(e.meta.id)}</div>
    <div class="aviso-obs" data-r="vista" hidden>routes, zones and suggestions are computed on the retouched terrain; the view shows the original</div>
    ${vehs.length ? '' : '<div class="tenue">no vehicle with a slope limit in the catalogue</div>'}
    <label><span class="et">Vehicle</span><select data-r="veh">${vehs.map((v) => `<option value="${esc(v.equipo.id)}">${esc(ctx.nombreCorto(v.equipo.id))} · ≤ ${v.limite}°</option>`).join('')}</select></label>
    <div class="tenue" data-r="veh-src"></div>
    <div class="punto"><span class="et">From</span><select data-r="desde"></select><button type="button" data-r="clic-desde" title="Click a point on the terrain">Click</button></div>
    <div class="punto"><span class="et">To</span><select data-r="hasta"></select><button type="button" data-r="clic-hasta" title="Click a point on the terrain">Click</button></div>
    <label class="fila-r"><span class="et">Avoid perm. shadow</span><span><input type="number" data-r="factor" min="1" max="20" step="0.5" value="1" ${hayPSR ? '' : 'disabled'}> ×</span></label>
    <div class="tenue">${hayPSR ? 'cost × this factor on permanent-shadow cells · own criterion · 1 = no penalty' : 'no permanent-shadow layer on this terrain'}</div>
    <div class="botones"><button type="button" data-r="calcular">Compute route</button><button type="button" data-r="borrar">Clear</button></div>
    <div class="res-ruta" data-r="res"></div>
    <div class="et sub">Visit all · round trip from the first ticked</div>
    <div class="paradas" data-r="paradas"></div>
    <div class="botones"><button type="button" data-r="visitar">Visit all</button></div>
    <div class="res-ruta" data-r="res-visita"></div>
    <div class="tenue nota-pend">Slope limit applied per cell: gradient magnitude at the DEM resolution (${e.m.toFixed(1)} m/px), the same in every driving direction. Conservative: a vehicle could zig-zag across a slope it cannot climb straight.</div>
    <div class="et sub">Sites · where can this go?</div>
    <label><span class="et">Equipment</span><select data-r="eq">${(ctx.catalogo?.equipos ?? []).map((q) => `<option value="${esc(q.id)}">${esc(ctx.nombreCorto(q.id))}</option>`).join('')}</select></label>
    <div class="botones"><button type="button" data-r="zona" aria-pressed="false">Where can this go?</button></div>
    <div class="res-ruta" data-r="res-zona"></div>
    <div class="et sub">Suggest sites · TOPSIS · own weights</div>
    <div class="criterios">${CRITERIOS.map((c) => `<label class="crit" data-crit="${c.id}"><input type="checkbox" data-r="usa-${c.id}"><span>${c.nombre}${c.id === 'dist_ref' ? ' <select data-r="ref"></select>' : ''} <span class="tenue">(${c.beneficio ? 'more' : 'less'} is better)</span></span><input type="number" data-r="peso-${c.id}" min="0" step="0.5" value="1" title="weight (own)"></label>`).join('')}</div>
    <div class="botones"><button type="button" data-r="sugerir">Suggest ${N_SUG} sites</button></div>
    <div class="tenue">best ${N_SUG} cells of the suitable zone, ≥ ${SEPARACION_SUG_M / 1000} km apart (own threshold); equal weights by default (own); method: TOPSIS, as used for lunar landing sites in ${ctx.fuenteYCita(TOPSIS_REF)}</div>
    <div class="res-ruta" data-r="res-sug"></div>
    <div class="estado-r" data-r="estado"></div>`;
  const $ = (k) => aside.querySelector(`[data-r="${k}"]`);
  const estado = (t) => { $('estado').textContent = t; };

  const vehiculo = () => vehs.find((v) => v.equipo.id === $('veh').value) ?? null;
  const fuenteVehTxt = () => { const v = vehiculo(); $('veh-src').innerHTML = v ? `slope limit: ${esc(v.req.texto ?? '')} · ${fuenteVeh(v)}` : ''; };
  $('veh').addEventListener('change', fuenteVehTxt);
  fuenteVehTxt();
  const factor = () => (hayPSR ? Math.max(1, +$('factor').value || 1) : 1);
  // Lo plantado de lo que depende el reparto de un equipo: sus referencias de separación y la referencia de distancia.
  const disposicion = (eqId, refUid) => {
    const tipos = new Set((ctx.equipoDe(eqId)?.requisitos ?? []).filter((r) => r.variable === 'separacion_m').map((r) => r.respecto_a));
    return firmaDisposicion((p.plantados?.lista ?? []).filter((it) => tipos.has(it.equipo) || it.uid === refUid));
  };
  const vigenteReparto = (x) => x && x.version === R.version && x.firma === disposicion(x.equipo, x.refUid);

  const celdaDe = (pt) => {
    if (!pt) return null;
    if (pt.tipo === 'libre') return { f: pt.fila, c: pt.col };
    const it = p.plantados?.buscar(pt.uid);
    return it ? { f: it.fila, c: it.col } : null;
  };
  const nombrePt = (pt) => {
    if (!pt) return '—';
    if (pt.tipo === 'libre') return `point ${pt.fila},${pt.col}`;
    const it = p.plantados?.buscar(pt.uid);
    return it ? ctx.nombreCorto(it.equipo) : 'removed';
  };

  // ---------- Selectores que dependen de lo plantado ----------
  function opcionesPunto(sel, pt) {
    const lista = p.plantados?.lista ?? [];
    sel.innerHTML = `<option value="">—</option>${lista.map((it) => `<option value="eq:${it.uid}">${esc(ctx.nombreCorto(it.equipo))} · ${it.fila},${it.col}</option>`).join('')}
      <option value="libre">${pt?.tipo === 'libre' ? `point ${pt.fila},${pt.col}` : 'point on the terrain…'}</option>`;
    sel.value = !pt ? '' : pt.tipo === 'libre' ? 'libre' : `eq:${pt.uid}`;
    if (sel.value === '' && pt) sel.value = '';
  }
  function refrescarSelects() {
    for (const k of ['desde', 'hasta']) {
      if (R[k]?.tipo === 'eq' && !p.plantados?.buscar(R[k].uid)) R[k] = null;
      opcionesPunto($(k), R[k]);
    }
    const lista = p.plantados?.lista ?? [];
    const marcados = new Set([...aside.querySelectorAll('[data-parada]:checked')].map((x) => +x.dataset.parada));
    $('paradas').innerHTML = lista.length ? lista.map((it) => `<label class="parada"><input type="checkbox" data-parada="${it.uid}" ${marcados.has(it.uid) ? 'checked' : ''}> ${esc(ctx.nombreCorto(it.equipo))} <span class="tenue num">${it.fila},${it.col}</span></label>`).join('')
      : '<div class="tenue">plant equipment to visit it (Equipment button)</div>';
    aside.querySelectorAll('[data-parada]').forEach((x) => x.addEventListener('change', limitarParadas));
    limitarParadas();
    const ref = $('ref'), antes = ref.value;
    ref.innerHTML = lista.length ? lista.map((it) => `<option value="${it.uid}">${esc(ctx.nombreCorto(it.equipo))} ${it.fila},${it.col}</option>`).join('') : '<option value="">(nothing planted)</option>';
    if ([...ref.options].some((o) => o.value === antes)) ref.value = antes;
    disponibilidad();
  }
  function limitarParadas() {
    const cajas = [...aside.querySelectorAll('[data-parada]')];
    const k = cajas.filter((x) => x.checked).length;
    cajas.forEach((x) => { x.disabled = !x.checked && k >= MAX_PARADAS; });
    $('visitar').disabled = k < 2;
    $('visitar').title = k < 2 ? 'tick at least two planted items' : `${k} stops (up to ${MAX_PARADAS})`;
  }

  for (const k of ['desde', 'hasta']) {
    $(k).addEventListener('change', () => {
      const v = $(k).value;
      if (v === 'libre') { elegir(k); return; }
      R[k] = v ? { tipo: 'eq', uid: +v.slice(3) } : null;
      dibujar();
    });
    $(`clic-${k}`).addEventListener('click', () => elegir(k));
  }

  // ---------- Elegir un punto en el terreno ----------
  function elegir(k) {
    ctx.modoPlantar(p, null);
    ctx.elegirHerramienta(p, 'navegar');
    R.eligiendo = k;
    p.el.classList.add('plantando');
    aviso.hidden = false;
    aviso.innerHTML = `<span class="et">Route</span> click the terrain for ${k === 'desde' ? 'FROM' : 'TO'} · Esc cancels`;
  }
  function dejarDeElegir() {
    R.eligiendo = null;
    p.el.classList.remove('plantando');
    aviso.hidden = true;
    refrescarSelects();
  }
  const cv = e.renderer.domElement;
  cv.addEventListener('pointerdown', (ev) => {
    if (!R.eligiendo || ev.button !== 0) return;
    ev.stopImmediatePropagation(); ev.preventDefault();
    const g = e.rayo(ev.clientX, ev.clientY);
    if (!g) return;
    R[R.eligiendo] = { tipo: 'libre', fila: Math.min(n - 1, Math.max(0, Math.round(g.fila))), col: Math.min(n - 1, Math.max(0, Math.round(g.col))) };
    dejarDeElegir();
    dibujar();
  }, { capture: true });
  window.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && R.eligiendo) { ev.stopImmediatePropagation(); dejarDeElegir(); }
  }, true);

  // ---------- Ruta ----------
  const capasRuta = () => (hayPSR ? Float32Array.from(e.capas.sombra_permanente) : null);
  const vigente = (r) => r && r.version === R.version && r.celdas.every((c, k) => { const a = celdaDe(r.puntos[k]); return a && a.f === c.f && a.c === c.c; });

  async function calcular() {
    const v = vehiculo(), o = celdaDe(R.desde), d = celdaDe(R.hasta);
    if (!v) { estado('no vehicle to route'); return; }
    if (!o || !d) { estado('choose FROM and TO first'); return; }
    if (o.f === d.f && o.c === d.c) { estado('FROM and TO are the same cell'); return; }
    estado('computing route…');
    $('calcular').disabled = true;
    const alt = Float32Array.from(e.actual), sombra = capasRuta();
    const fa = factor(), version = R.version, puntos = [R.desde, R.hasta];
    try {
      const r = await pedir('ruta', { n, m: e.m, alturas: alt, sombra, agua: e.capas.agua ?? null, carreteras: p.obra?.carreteras() ?? null, limite: v.limite, factor: fa, origen: o.f * n + o.c, destino: d.f * n + d.c }, [alt.buffer, ...(sombra ? [sombra.buffer] : [])]);
      R.res = { tipo: 'ruta', vehiculo: v.equipo.id, limite: v.limite, factor: fa, puntos, celdas: [o, d], version, ...r };
      estado(`route computed in ${Math.round(r.ms)} ms on ${r.diezmado ? `the grid decimated ×2 (${r.m.toFixed(1)} m/px) because the full ${n}² grid took over 5 s` : `the full ${n}² grid`} (Web Worker)`);
    } catch (err) {
      estado(`route failed: ${err.message}`);
    } finally { $('calcular').disabled = false; }
    pintarRes();
    ctx.refrescarPlantado();
    $('res').scrollIntoView({ block: 'nearest' });
  }

  // Ruta hallada en la rejilla diezmada que en la completa pisa celdas por encima del límite.
  function avisoAprox(r) {
    if (!r.diezmado || !(r.sobreLimite > 0 || r.sinDatoRuta > 0)) return '';
    const sd = r.sinDatoRuta > 0 ? ` and ${r.sinDatoRuta} no-data cells` : '';
    return `<div class="aviso-obs" data-r="aprox">approximate route: found on the grid decimated ×2; on the full grid it crosses ${r.sobreLimite} cells steeper than ≤ ${r.limite}°${sd} (steepest ${gradosFrente(r.medidas.pendMax, r.limite)})</div>`;
  }

  function filasMedidas(r, v) {
    const md = r.medidas, vel = velocidadCatalogo(ctx.equipoDe(v)), ef = velocidadEfectiva(ctx.equipoDe(v));
    const sinDato = md.sombraSinDato_m > 0 ? `<dt>SHADOW NO DATA</dt><dd class="num" data-r="sombra-sin-dato">${km(md.sombraSinDato_m)}</dd>` : '';
    const sombra = md.sombra_m === null
      ? '<dt>PERM. SHADOW</dt><dd class="tenue">not measured on this terrain</dd>'
      : `<dt>PERM. SHADOW</dt><dd class="num">${km(md.sombra_m)} · ${(100 * md.sombraFrac).toFixed(1)} %</dd><dt>LONGEST IN SHADOW</dt><dd class="num">${km(md.sombraTramoMax_m)}</dd>${sinDato}`;
    const t = vel && md.sombra_m !== null ? `<dd class="num">${horas(md.longitud_m / 1000 / vel.kmh)} · longest shadow stretch ${horas(md.sombraTramoMax_m / 1000 / vel.kmh)}</dd>`
      : vel ? `<dd class="num">${horas(md.longitud_m / 1000 / vel.kmh)}</dd>` : '';
    const tEf = ef ? `<div class="tenue" data-r="tiempo-efectivo">extra figure, no verdict: at the catalogue ${esc(ef.cifra.texto ?? ef.cifra.nombre)} ${esc(ef.cifra.valor)} ${esc(ef.cifra.unidad)} the route takes ${horas(md.longitud_m / 1000 / ef.kmh)}${md.sombra_m !== null ? `, its longest shadow stretch ${horas(md.sombraTramoMax_m / 1000 / ef.kmh)}` : ''} · ${ctx.fuenteYCita(ef.cifra)}</div>` : '';
    const car = md.carretera?.pasos > 0 ? md.carretera : null;
    return `<dl>
      <dt>LENGTH</dt><dd class="num">${km(md.longitud_m)}</dd>
      <dt>CLIMB ↑ / ↓</dt><dd class="num">${Math.round(md.subida_m)} m / ${Math.round(md.bajada_m)} m</dd>
      <dt>SLOPE MAX · P95${car ? ' (OFF ROAD)' : ''}</dt><dd class="num">${gradosFrente(md.pendMax, r.limite)} · ${grados(md.pendP95)}</dd>
      ${car ? `<dt>ON APPLIED ROAD</dt><dd class="num" data-r="carretera">${car.pasos} steps · steepest ${gradosFrente(car.pendMax, r.limite)}</dd>` : ''}
      ${sombra}
      ${vel ? `<dt>TIME</dt>${t}` : ''}</dl>
      ${car ? `<div class="no-medido" data-r="carretera-transversal">on the applied road each step is judged by its grade along the road; cross slope of the road: NOT MEASURED (road narrower than a ${e.m.toFixed(1)} m cell)</div>` : ''}
      <div class="tenue">measured on the route: 3D length of its 8-neighbour cell steps on the retouched DEM${r.diezmado ? ' (found on the grid decimated ×2, measured on the full grid)' : ''}; slope = cell slope; ${hayAgua ? `water cells of the ${fuenteAgua()} treated as impassable; ` : ''}${hayPSR ? `shadow = cells flagged in the permanent-shadow layer, each step split half-and-half between its two cells${md.sombraSinDato_m > 0 ? '; no data = cells with no value in that layer' : ''}` : 'no permanent-shadow layer on this terrain'}.</div>
      ${vel ? `<div class="tenue">TIME at catalogue ${vel.tipo} speed ${+vel.kmh.toFixed(3)} km/h, constant — lower bound on time · ${ctx.fuenteYCita(vel.cifra)}</div>` : `<div class="tenue">no catalogue speed with a source for this vehicle: no time given</div>`}${tEf}`;
  }

  function pintarRes() {
    p.obra?.rutaCambiada();
    const r = R.res, el = $('res');
    if (!r) { el.innerHTML = ''; dibujar(); return; }
    const nom = ctx.nombreCorto(r.vehiculo);
    const cab = `<div class="cab-res"><b>${esc(nom)}</b> · ${esc(nombrePt(r.puntos[0]))} → ${esc(nombrePt(r.puntos[1]))}${r.factor !== 1 ? ` · shadow ×${r.factor}` : ''}</div>`;
    const obs = vigente(r) ? '' : '<div class="aviso-obs">terrain or endpoints changed since this route: compute again</div>';
    if (!r.camino) {
      const enAgua = [['FROM', r.aguaOrigen], ['TO', r.aguaDestino]].filter(([, a]) => a >= 1).map(([k, a]) => `${k} is on water (${nombreAgua(a)})`);
      if (enAgua.length) {
        el.innerHTML = `${cab}<div class="sin-ruta" data-r="sin-ruta">no route: ${esc(enAgua.join(' · '))}</div><div class="tenue">water cells of the ${fuenteAgua()} are impassable; choose a point on land</div>${obs}`;
        dibujar();
        return;
      }
      const pista = Number.isFinite(r.umbral) ? `minimum slope limit that would connect them: <b class="num">${redondearArriba(r.umbral, 1).toFixed(1)}°</b> (steepest cell of the least-steep path, measured on this DEM, rounded up)` : `not connected at any slope (${hayAgua ? 'water or no-data' : 'no-data'} cells in between)`;
      const ext = r.pendOrigen > r.limite ? ` · FROM cell is already ${gradosFrente(r.pendOrigen, r.limite)}` : r.pendDestino > r.limite ? ` · TO cell is already ${gradosFrente(r.pendDestino, r.limite)}` : '';
      el.innerHTML = `${cab}<div class="sin-ruta" data-r="sin-ruta">no route within ${esc(nom)}'s slope limit (≤ ${r.limite}°)${esc(ext)}</div><div class="tenue">${pista}${hayAgua ? ' · water treated as impassable' : ''}</div>${obs}`;
    } else {
      el.innerHTML = `${cab}${avisoAprox(r)}${filasMedidas(r, r.vehiculo)}${obs}`;
    }
    dibujar();
  }

  $('calcular').addEventListener('click', calcular);
  $('borrar').addEventListener('click', () => { R.res = null; R.visita = null; R.sug = null; $('res-visita').innerHTML = ''; $('res-sug').innerHTML = ''; pintarRes(); ctx.refrescarPlantado(); estado(''); });

  // ---------- Visitar todos ----------
  async function visitar() {
    const v = vehiculo();
    const uids = [...aside.querySelectorAll('[data-parada]:checked')].map((x) => +x.dataset.parada).slice(0, MAX_PARADAS);
    const puntos = uids.map((uid) => ({ tipo: 'eq', uid }));
    const celdas = puntos.map(celdaDe);
    if (!v || celdas.length < 2) return;
    estado(`computing ${celdas.length}×${celdas.length} cost matrix…`);
    $('visitar').disabled = true;
    const alt = Float32Array.from(e.actual), sombra = capasRuta(), fa = factor(), version = R.version;
    try {
      const r = await pedir('visita', { n, m: e.m, alturas: alt, sombra, agua: e.capas.agua ?? null, carreteras: p.obra?.carreteras() ?? null, limite: v.limite, factor: fa, puntos: celdas.map((c) => c.f * n + c.c) }, [alt.buffer, ...(sombra ? [sombra.buffer] : [])]);
      R.visita = { tipo: 'visita', vehiculo: v.equipo.id, limite: v.limite, factor: fa, puntos, celdas, version, ...r };
      estado(`round trip computed in ${Math.round(r.ms)} ms: ${celdas.length - 1} Dijkstra searches + exact order over ${celdas.length - 1}! permutations (Web Worker)`);
    } catch (err) {
      estado(`round trip failed: ${err.message}`);
    } finally { limitarParadas(); }
    pintarVisita();
    ctx.refrescarPlantado();
    $('res-visita').scrollIntoView({ block: 'nearest' });
  }
  function pintarVisita() {
    const r = R.visita, el = $('res-visita');
    if (!r) { el.innerHTML = ''; dibujar(); return; }
    const obs = vigente(r) ? '' : '<div class="aviso-obs">terrain or stops changed since this round trip: compute again</div>';
    if (!r.camino) {
      const rotos = [];
      r.M.forEach((fila, a) => fila.forEach((c, b) => { if (b > a && !Number.isFinite(c)) rotos.push(`${nombrePt(r.puntos[a])} – ${nombrePt(r.puntos[b])}`); }));
      const enAgua = (r.aguaParadas ?? []).map((a, k) => (a >= 1 ? `${nombrePt(r.puntos[k])} (${nombreAgua(a)})` : null)).filter(Boolean);
      const cabV = enAgua.length ? `no round trip: on water ${esc(enAgua.join(' · '))}` : `no round trip within ${esc(ctx.nombreCorto(r.vehiculo))}'s slope limit (≤ ${r.limite}°)`;
      el.innerHTML = `<div class="sin-ruta" data-r="sin-visita">${cabV}</div><div class="tenue">unconnected pairs: ${esc(rotos.join(' · '))}${hayAgua ? ' · water treated as impassable' : ''}</div>${obs}`;
    } else {
      el.innerHTML = `<div class="cab-res"><b>${esc(ctx.nombreCorto(r.vehiculo))}</b> · optimal order (exact):</div>
        <ol class="orden">${r.orden.map((k) => `<li>${esc(nombrePt(r.puntos[k]))}</li>`).join('')}<li class="tenue">back to ${esc(nombrePt(r.puntos[0]))}</li></ol>
        ${filasMedidas(r, r.vehiculo)}${obs}`;
    }
    dibujar();
  }
  $('visitar').addEventListener('click', visitar);

  // ---------- Zona apta ----------
  function capasZona() {
    const out = {};
    for (const k of ['temp_max', 'temp_min', 'iluminacion', 'sombra_permanente', 'agua']) if (e.capas[k]) out[k] = e.capas[k];
    return out;
  }
  async function zona() {
    const eq = ctx.equipoDe($('eq').value);
    if (!eq) return null;
    const alt = Float32Array.from(e.actual), version = R.version, firma = disposicion(eq.id);
    estado('computing suitable zone…');
    const r = await pedir('zona', { n, m: e.m, alturas: alt, capas: capasZona(), equipo: eq, plantados: (p.plantados?.lista ?? []).map(({ uid, equipo, fila, col }) => ({ uid, equipo, fila, col })) }, [alt.buffer]);
    R.zona = { ...r, equipo: eq.id, version, firma };
    estado(`suitable zone computed in ${Math.round(r.ms)} ms`);
    return R.zona;
  }
  function mostrarZona(ver) {
    R.zonaVisible = ver && !!R.zona?.mascara;
    $('zona').setAttribute('aria-pressed', String(R.zonaVisible));
    if (R.zonaVisible) {
      const z = R.zona;
      e.capas[CAPA_ZONA] = z.margen ?? Float32Array.from(z.mascara, (x) => (x ? 1 : NaN));
      e.setCapa(CAPA_ZONA, !z.margen);
    } else {
      delete e.capas[CAPA_ZONA];
      const b = p.el.querySelector('.mandos [data-capa][aria-pressed=true]');
      if (b) b.click(); else e.setCapa(null);
    }
  }
  function pintarZona() {
    const z = R.zona, el = $('res-zona');
    if (!z) { el.innerHTML = ''; return; }
    const lista = (xs, f) => xs.map(f).join('');
    const req = (a) => `${esc(a.req.variable === 'separacion_m' ? `separation from ${ctx.nombreCorto(a.req.respecto_a)}` : a.req.variable)} ${esc(a.req.op)} ${esc(a.req.valor ?? '—')} ${esc(a.req.unidad ?? '')}`;
    const apl = lista(z.aplicados, (a) => `<li>${req(a)} <span class="tenue">· ${esc(a.como)} · ${ctx.fuenteYCita(a.req)}</span></li>`);
    const omi = lista(z.omitidos, (a) => `<li class="tenue">${req(a)} · not applied: ${esc(a.motivo)}</li>`);
    const agua = z.agua && z.mascara ? `<li data-r="agua-zona">water excluded · ${fuenteAgua()} <span class="tenue">· ocean, lake and river cells are not ground: removes <span class="num">${z.agua.celdas.toLocaleString('en-US')}</span> cells</span></li>` : '';
    const obs = vigenteReparto(z) ? '' : '<div class="aviso-obs" data-r="zona-obs">terrain or planted equipment changed since this zone: compute again</div>';
    if (!z.mascara) {
      el.innerHTML = `<div data-r="sin-zona"><b>${esc(ctx.nombreCorto(z.equipo))}</b>: no measurable requirement in the catalogue on this terrain</div>${omi ? `<ul class="reqs">${omi}</ul>` : ''}${obs}`;
      return;
    }
    const km2 = (z.celdas * e.m * e.m) / 1e6;
    el.innerHTML = `<div><b>${esc(ctx.nombreCorto(z.equipo))}</b>: <span class="num" data-r="frac">${(100 * z.frac).toFixed(1)} %</span> of this terrain · <span class="num">${km2.toFixed(1)} km²</span> (${z.celdas.toLocaleString('en-US')} cells of ${(e.m * e.m).toFixed(0)} m²)</div>
      ${z.cotaSuperior ? '<div class="tenue" data-r="cota-zona">upper bound: at most this share, because a requirement is applied only in part (marked below); the sheet may not confirm it at a cell of this zone</div>' : ''}
      <ul class="reqs">${apl}${agua}${omi}</ul>
      ${z.margen ? `<div class="tenue">overlay: suitable cells coloured by margin to the slope limit</div><div class="bar" style="background:${RAMPA_ZONA}"></div><div class="ext num"><span>0° (at the limit)</span><span>${z.limitePend}° (flat)</span></div>` : '<div class="tenue">overlay: suitable cells hatched</div>'}${obs}`;
  }
  $('zona').addEventListener('click', async () => {
    if (R.zonaVisible) { mostrarZona(false); return; }
    try {
      await zona();
      pintarZona();
      mostrarZona(true);
      $('res-zona').scrollIntoView({ block: 'nearest' });
    } catch (err) { estado(`zone failed: ${err.message}`); }
  });
  $('eq').addEventListener('change', () => {
    if (R.zonaVisible) mostrarZona(false);
    R.zona = null; R.sug = null;
    pintarZona(); $('res-sug').innerHTML = '';
    defectosCriterios();
    dibujar();
  });
  p.el.querySelectorAll('.mandos [data-capa]').forEach((b) => b.addEventListener('click', () => {
    if (!R.zonaVisible) return;
    R.zonaVisible = false;
    delete e.capas[CAPA_ZONA];
    $('zona').setAttribute('aria-pressed', 'false');
  }));

  // ---------- Sugerencias ----------
  let hayPixelPSR = null;
  function disponible(id) {
    if (id === 'iluminacion') return hayILU ? null : 'no illumination layer on this terrain';
    if (id === 'dist_sombra') {
      if (!hayPSR) return 'no permanent-shadow layer on this terrain';
      hayPixelPSR ??= e.capas.sombra_permanente.some((v) => v === 1);
      return hayPixelPSR ? null : 'no permanent-shadow cell on this terrain';
    }
    if (id === 'dist_ref') return p.plantados?.lista.length ? null : 'plant something to use it as reference';
    return null;
  }
  function disponibilidad() {
    for (const c of CRITERIOS) {
      const motivo = disponible(c.id), lab = aside.querySelector(`[data-crit="${c.id}"]`);
      const caja = $(`usa-${c.id}`);
      caja.disabled = !!motivo;
      if (motivo) caja.checked = false;
      lab.classList.toggle('apagado', !!motivo);
      lab.title = motivo ?? '';
    }
  }
  function defectosCriterios() {
    const eq = ctx.equipoDe($('eq').value);
    const prosp = ['prospeccion', 'excavacion'].includes(eq?.clase);
    $('usa-iluminacion').checked = true;
    $('usa-pendiente').checked = true;
    $('usa-dist_sombra').checked = prosp;
    $('usa-dist_ref').checked = false;
    disponibilidad();
  }
  async function sugerirSitios() {
    try {
      if (!R.zona || R.zona.equipo !== $('eq').value || !vigenteReparto(R.zona)) { await zona(); pintarZona(); }
      const z = R.zona;
      if (!z.mascara) { $('res-sug').innerHTML = '<div class="tenue">no suitable zone to choose from: no measurable requirement</div>'; return; }
      if (!z.celdas) { $('res-sug').innerHTML = '<div class="tenue">the suitable zone is empty on this terrain</div>'; return; }
      const crit = CRITERIOS.filter((c) => $(`usa-${c.id}`).checked && !$(`usa-${c.id}`).disabled).map((c) => ({ id: c.id, beneficio: c.beneficio, peso: Math.max(0, +$(`peso-${c.id}`).value || 0) }));
      if (!crit.length || crit.every((c) => c.peso === 0)) { $('res-sug').innerHTML = '<div class="tenue">tick at least one criterion with a weight above 0</div>'; return; }
      const refIt = p.plantados?.buscar(+$('ref').value);
      const capas = {};
      if (hayILU) capas.iluminacion = e.capas.iluminacion;
      if (hayPSR) capas.sombra_permanente = e.capas.sombra_permanente;
      estado('ranking cells…');
      const alt = Float32Array.from(e.actual), version = R.version, firma = disposicion(z.equipo, refIt?.uid);
      const r = await pedir('sugerencias', { n, m: e.m, alturas: alt, capas, mascara: z.mascara, criterios: crit, ref: refIt ? { fila: refIt.fila, col: refIt.col } : null, N: N_SUG, separacion_m: SEPARACION_SUG_M }, [alt.buffer]);
      R.sug = { lista: r.lista, crit, equipo: z.equipo, ref: refIt ? ctx.nombreCorto(refIt.equipo) : null, refUid: refIt?.uid ?? null, version, firma };
      estado(`${r.lista.length} sites ranked in ${Math.round(r.ms)} ms over ${z.celdas.toLocaleString('en-US')} suitable cells`);
      pintarSug();
      $('res-sug').scrollIntoView({ block: 'nearest' });
    } catch (err) { estado(`suggestions failed: ${err.message}`); }
  }
  function pintarSug() {
    const s = R.sug, el = $('res-sug');
    if (!s) { el.innerHTML = ''; dibujar(); return; }
    const val = (id, v) => (id === 'iluminacion' ? v.toFixed(2) : id === 'pendiente' ? grados(v) : km(v, 2));
    const nomC = (c) => (c.id === 'dist_ref' ? `to ${esc(s.ref)}` : c.id === 'dist_sombra' ? 'to PSR' : c.id === 'iluminacion' ? 'illum.' : 'slope');
    const obs = vigenteReparto(s) ? '' : '<div class="aviso-obs" data-r="sug-obs">terrain or planted equipment changed since these suggestions: suggest again</div>';
    el.innerHTML = s.lista.length ? `${obs}<ol class="sug">${s.lista.map((x, k) => `<li data-sug="${k}"><span class="num"><b>S${k + 1}</b> · score ${x.puntuacion.toFixed(3)}</span> <span class="tenue num">${s.crit.map((c) => `${nomC(c)} ${val(c.id, x.valores[c.id])}`).join(' · ')}</span>
        <button type="button" data-plantar-sug="${k}">Plant ${esc(ctx.nombreCorto(s.equipo))} here</button></li>`).join('')}</ol>
        <div class="tenue">weights ${s.crit.map((c) => `${nomC(c)} ${c.peso}`).join(', ')} (own) · illumination = LOLA average visibility layer; slope = cell slope; distances = straight line on the map plane (distance transform)</div>`
      : '<div class="tenue">no cell of the zone has a value for every ticked criterion</div>';
    el.querySelectorAll('[data-plantar-sug]').forEach((b) => b.addEventListener('click', () => {
      const x = s.lista[+b.dataset.plantarSug];
      ctx.plantarEn(p, s.equipo, x.fila, x.col);
      estado(`${ctx.nombreCorto(s.equipo)} planted at suggestion ${+b.dataset.plantarSug + 1} (cell ${x.fila},${x.col})`);
    }));
    dibujar();
  }
  $('sugerir').addEventListener('click', sugerirSitios);
  defectosCriterios();

  // ---------- Dibujo sobre el terreno ----------
  const pantalla = (f, c, caja) => {
    const s = e.aPantalla(e.mundoDePixel(f, c));
    return s ? { x: s.x - caja.left, y: s.y - caja.top, dentro: s.dentro } : null;
  };
  function trazo(camino, caja) {
    const paso = Math.max(1, Math.ceil(camino.length / 600));
    let d = '', abierto = false;
    for (let k = 0; k < camino.length; k += paso) {
      const i = camino[Math.min(k, camino.length - 1)];
      const s = pantalla(Math.floor(i / n), i % n, caja);
      if (!s) { abierto = false; continue; }
      d += `${abierto ? 'L' : 'M'}${s.x.toFixed(1)},${s.y.toFixed(1)}`;
      abierto = true;
    }
    const u = camino[camino.length - 1], s = pantalla(Math.floor(u / n), u % n, caja);
    if (s && abierto) d += `L${s.x.toFixed(1)},${s.y.toFixed(1)}`;
    return d;
  }
  function marca(c, txt, clase, caja) {
    const s = pantalla(c.f, c.c, caja);
    if (!s?.dentro) return '';
    const forma = txt.length > 1 ? '<rect x="-11" y="-7" width="22" height="14"></rect>' : '<circle r="7"></circle>';
    return `<g class="${clase}" transform="translate(${s.x.toFixed(1)},${s.y.toFixed(1)})">${forma}<text dy="3.5">${esc(txt)}</text></g>`;
  }
  function dibujar() {
    if (!p.el.classList.contains('ampliado') && !R.res && !R.visita && !R.sug) { svg.innerHTML = ''; return; }
    const caja = lienzo.getBoundingClientRect();
    let h = '';
    if (R.visita?.camino) h += `<path class="tour${vigente(R.visita) ? '' : ' obsoleta'}" d="${trazo(R.visita.camino, caja)}"></path>`;
    if (R.res?.camino) h += `<path class="ruta-fondo" d="${trazo(R.res.camino, caja)}"></path><path class="ruta${vigente(R.res) ? '' : ' obsoleta'}" d="${trazo(R.res.camino, caja)}"></path>`;
    if (R.sug) { const cl = vigenteReparto(R.sug) ? 'sug-m' : 'sug-m obsoleta'; R.sug.lista.forEach((x, k) => { h += marca({ f: x.fila, c: x.col }, `S${k + 1}`, cl, caja); }); }
    if (R.visita?.orden) R.visita.orden.forEach((k, j) => { h += marca(R.visita.celdas[k], String(j + 1), 'parada-m', caja); });
    const a = celdaDe(R.desde), b = celdaDe(R.hasta);
    if (a) h += marca(a, 'A', 'extremo', caja);
    if (b) h += marca(b, 'B', 'extremo', caja);
    svg.innerHTML = h;
  }

  // ---------- Enganches con el visor ----------
  function medidasDe(item) {
    const r = [R.res, R.visita].find((x) => x && x.vehiculo === item.equipo && x.puntos.some((pt) => pt.tipo === 'eq' && pt.uid === item.uid) && vigente(x));
    if (!r) return {};
    if (!r.camino) {
      const agua = r.aguaOrigen >= 1 || r.aguaDestino >= 1 || (r.aguaParadas ?? []).some((a) => a >= 1);
      return { distancia_recorrido_km: { valor: null, motivo: agua ? 'no route: an end point is on water (impassable)' : `no route within the ${r.limite}° slope limit to the chosen ${r.tipo === 'visita' ? 'stops' : 'destination'}` } };
    }
    const md = r.medidas;
    const que = r.tipo === 'visita' ? 'round trip' : 'route';
    const aprox = r.diezmado && (r.sobreLimite > 0 || r.sinDatoRuta > 0) ? `; approximate: crosses ${r.sobreLimite} cells steeper than the slope limit on the full grid` : '';
    return {
      distancia_recorrido_km: { valor: md.longitud_m / 1000, como: `length of the ${que} computed in the Route tool (3D, 8-neighbour steps on the retouched DEM${r.diezmado ? ', found on the grid decimated ×2' : ''})${aprox}` },
      horas_en_sombra: horasEnSombra(md, ctx.equipoDe(item.equipo), que),
    };
  }
  function terrenoCambiado() {
    R.version++;
    pintarRes(); pintarVisita(); pintarZona();
    if (R.sug) pintarSug();
  }
  function refrescar() {
    $('vista').hidden = !e.verOriginal;
    const firma = (p.plantados?.lista ?? []).map((it) => `${it.uid}:${it.fila},${it.col}`).join('|');
    if (firma === R.firmaPlantados) return;
    R.firmaPlantados = firma;
    refrescarSelects();
    if (R.res) pintarRes();
    if (R.visita) pintarVisita();
    if (R.zona) pintarZona();
    if (R.sug) pintarSug();
    dibujar();
  }
  refrescarSelects();
  return { R, dibujar, medidasDe, terrenoCambiado, refrescar, calcular, visitar, sugerirSitios, elegir };
}
