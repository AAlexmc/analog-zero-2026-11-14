// Obra en pantalla: carretera sobre una ruta (o bajada diseñada si no hay ruta) y plataforma bajo un equipo plantado.
// Cálculo con obra.js; constantes con cita de obra.json y equipo.json. Lo que no tiene cita se rotula «assumed».
import { perfil, rasante, volumenCarretera, plataforma, masaCorte, densidadMedia, deltaCarretera, DIAMETRO_SUBCELDA } from './obra.js';
import { pendienteGrados } from './calculo.js';
import { vehiculos } from './rutas.js';
import { huella } from './plantado.js';
import { pedir } from './panel_rutas.js';
import { cargarCatalogo } from './datos.js';

const RAD = Math.PI / 180;
// Supuesto propio, sin cita: editable y rotulado en pantalla.
export const SUPUESTOS = { n_robots: 1 };
const LIMITE_PLATAFORMA = { pista_aterrizaje: 'pista_pendiente_max_deg' };
const ROBOT_REF = 'ipex';

const metros = (t) => t.m ?? t.m_por_px;

export const constante = (obra, id) => (obra?.constantes ?? []).find((c) => c.id === id && c.verificado === true) ?? null;
export const cifraCitada = (eq, nombre) => (eq?.cifras ?? []).find((c) => c.nombre === nombre && c.verificado === true && c.fuente && !c.op && Number.isFinite(c.valor) && c.valor > 0) ?? null;

export function defectosFlota(obra, equipos) {
  const robot = (equipos ?? []).find((q) => q.id === ROBOT_REF) ?? null;
  const ritmo = cifraCitada(robot, 'ritmo_excavacion_kg_h');
  const mision = constante(obra, 'ipex_excavacion_dia_lunar');
  const dens = constante(obra, 'densidad_regolito_formula');
  const v = dens?.valor;
  const densOk = v && [v.rho_inf, v.a, v.b].every(Number.isFinite) && v.rho_inf > 0 && v.b > 0;
  return {
    robot,
    ritmo_kg_h: ritmo ? { valor: ritmo.valor, ref: ritmo } : null,
    mision_kg: mision && Number.isFinite(mision.valor) && mision.valor > 0 ? { valor: mision.valor, ref: mision } : null,
    densidad: densOk ? { valor: v, ref: dens } : null,
    n_robots: { valor: SUPUESTOS.n_robots, ref: null },
  };
}

// Tiempo de excavación con el ritmo citado. Calendario (estimación propia, solo Luna): los robots trabajan solo con luz.
// flota = {n_robots, kg_h|null, mision_kg|null}; luz = {valor}|null
export function tiempoFlota(masa_kg, flota, luz, luna) {
  const out = { evaluable: false, motivo: null, horas: null, dias_tierra: null, misiones: null, calendario_dias: null, motivoCalendario: null };
  if (!(masa_kg >= 0 && Number.isFinite(masa_kg))) return { ...out, motivo: 'no regolith mass' };
  if (!(flota.n_robots >= 1 && Number.isInteger(flota.n_robots))) return { ...out, motivo: 'robots must be a whole number ≥ 1' };
  if (!(flota.kg_h > 0)) return { ...out, motivo: 'no cited excavation rate for the reference robot' };
  const horas = masa_kg / (flota.n_robots * flota.kg_h);
  const r = { ...out, evaluable: true, horas, dias_tierra: horas / 24, misiones: flota.mision_kg > 0 ? masa_kg / flota.mision_kg : null };
  if (!luna) r.motivoCalendario = 'not given on Earth';
  else if (!luz || luz.valor === null) r.motivoCalendario = 'no illumination data: fraction of light unknown';
  else if (!(luz.valor > 0)) r.motivoCalendario = 'no sunlight here (mean illumination 0)';
  else r.calendario_dias = horas / luz.valor / 24;
  return r;
}

// veh = {equipo, limite, req} de vehiculos(catalogo).
export function defectosCarretera(veh) {
  const ancho = cifraCitada(veh?.equipo, 'ancho_m');
  return {
    pendiente: { valor: veh?.limite ?? null, ref: veh?.req ?? null },
    ancho: ancho ? { valor: 2 * ancho.valor, ref: ancho } : { valor: null, ref: null },
  };
}

export function defectosPlataforma(eq, obra) {
  const req = (eq?.requisitos ?? []).find((r) => r.variable === 'pendiente_deg' && (r.op === '<=' || r.op === '<') && Number.isFinite(r.valor));
  if (!req) return null;
  const c = LIMITE_PLATAFORMA[eq.id] ? constante(obra, LIMITE_PLATAFORMA[eq.id]) : null;
  const limite = c && Number.isFinite(c.valor) ? { valor: c.valor, op: c.op ?? '<=', ref: c, de: 'obra' } : { valor: req.valor, op: req.op, ref: req, de: 'requisito' };
  let diametro = { valor: null, ref: null, como: null };
  const h = huella(eq);
  const dm = cifraCitada(eq, 'diametro_m'), la = cifraCitada(eq, 'largo_m'), an = cifraCitada(eq, 'ancho_m'), pa = cifraCitada(eq, 'ancho_paneles_m');
  if (h?.forma === 'rect') diametro = { valor: Math.hypot(h.largo_m, h.ancho_m), ref: h.cifra, como: 'diagonal of the footprint' };
  else if (h?.forma === 'hex') diametro = { valor: (2 * h.entre_caras_m) / Math.sqrt(3), ref: h.cifra, como: 'hexagon across corners' };
  else if (dm) diametro = { valor: dm.valor, ref: dm, como: 'diameter' };
  else if (la && an) diametro = { valor: Math.hypot(la.valor, an.valor), ref: la, como: 'diagonal of length × width' };
  else if (an) diametro = { valor: an.valor, ref: an, como: 'width' };
  else if (pa) diametro = { valor: pa.valor, ref: pa, como: 'array width' };
  return { req, limite, diametro };
}

export function pesosTrapecio(s) {
  const N = s.length, w = new Float64Array(N);
  for (let i = 0; i < N; i++) w[i] = ((i > 0 ? s[i] - s[i - 1] : 0) + (i < N - 1 ? s[i + 1] - s[i] : 0)) / 2;
  return w;
}

// Media de una capa en unas celdas (pesos opcionales); las celdas sin dato no cuentan.
export function mediaCapa(capa, indices, pesos = null) {
  let sw = 0, sv = 0, sin = 0;
  for (let k = 0; k < indices.length; k++) {
    const v = capa[indices[k]], w = pesos ? pesos[k] : 1;
    if (!Number.isFinite(v)) { sin++; continue; }
    sw += w; sv += w * v;
  }
  return { valor: sw > 0 ? sv / sw : null, sin_dato: sin, total: indices.length };
}

// Tramo del perfil con el terreno por encima de la rasante (se parte el segmento donde se cruzan).
export function longitudCorte(s, z, zp) {
  let L = 0;
  for (let i = 0; i + 1 < s.length; i++) {
    const d1 = z[i] - zp[i], d2 = z[i + 1] - zp[i + 1], ds = s[i + 1] - s[i];
    if (d1 > 0 && d2 > 0) L += ds;
    else if (d1 > 0) L += (ds * d1) / (d1 - d2);
    else if (d2 > 0) L += (ds * d2) / (d2 - d1);
  }
  return L;
}

// Las alturas son float32: la rasante se proyecta un ulp por debajo del límite para que el redondeo no lo cruce.
export function ulp32(x) {
  const a = Math.abs(x);
  return a > 0 ? 2 ** (Math.floor(Math.log2(a)) - 23) : 2 ** -149;
}
export function pendienteDiseno(limite_deg, maxAbs_m, m) {
  const t = Math.tan(limite_deg * RAD) - (2 * ulp32(2 * maxAbs_m)) / m;
  return Math.atan(Math.max(t, 0)) / RAD;
}

// Pasos de la traza más empinados que el límite (cota entre celdas consecutivas) y celdas con pendiente de celda por encima.
export function sobreLimiteTraza(alturas, n, m, camino, limite_deg) {
  const k = Math.tan(limite_deg * RAD);
  let pasos = 0, celdas = 0, sinDato = 0;
  for (let j = 0; j < camino.length; j++) {
    const i = camino[j], f = Math.floor(i / n), c = i % n;
    const pc = pendienteGrados(alturas, n, m, f, c);
    if (!Number.isFinite(pc)) sinDato++; else if (pc > limite_deg) celdas++;
    if (j + 1 < camino.length) {
      const b = camino[j + 1], ds = Math.hypot(Math.floor(b / n) - f, (b % n) - c) * m;
      if (Math.abs(alturas[b] - alturas[i]) > k * ds) pasos++;
    }
  }
  return { pasos, celdas, sinDato, total: camino.length };
}

// La carretera aplicada vive en su paso del historial: deshacer la quita; un retoque posterior de una celda la corta ahí.
export function registrarCarretera(paso, camino, delta) {
  if (paso) paso.carretera = { camino: Int32Array.from(camino), esperado: Float32Array.from(camino, (i) => delta[i]) };
  return paso;
}
export function carreterasVigentes(pasos, delta) {
  const out = [];
  for (const { carretera: c } of pasos) {
    if (!c) continue;
    let ini = 0;
    for (let k = 0; k <= c.camino.length; k++) {
      if (k < c.camino.length && delta[c.camino[k]] === c.esperado[k]) continue;
      if (k - ini >= 2) out.push(c.camino.slice(ini, k));
      ini = k + 1;
    }
  }
  return out;
}

function masaYFlota({ luna, corte_m3, prof_m, densidad, luz, flota }) {
  if (!luna) return { masa_kg: null, densidad_media: null, motivoMasa: 'lunar regolith density does not apply to this soil', flota: { evaluable: false, motivo: 'the cited excavation rate is for lunar regolith in kg: no mass for this soil' } };
  if (!densidad) return { masa_kg: null, densidad_media: null, motivoMasa: 'no regolith density with a verified source', flota: { evaluable: false, motivo: 'no regolith mass' } };
  const densidad_media = densidadMedia(prof_m * 100, densidad);
  const masa_kg = masaCorte(corte_m3, prof_m, densidad);
  return { masa_kg, densidad_media, motivoMasa: null, flota: tiempoFlota(masa_kg, flota, luz, luna) };
}

// Carretera sobre una traza: rasante de mínimo movimiento de tierras con los dos extremos en el terreno.
export function obraCarretera({ t, camino, luz = null, luna, pendiente_deg, ancho_m, densidad, flota }) {
  const p = perfil(t, camino), m = metros(t);
  let maxAbs = 0;
  for (const v of p.z) if (Number.isFinite(v)) maxAbs = Math.max(maxAbs, Math.abs(v));
  const diseno_deg = pendienteDiseno(pendiente_deg, maxAbs, m);
  const base = { camino, s: p.s, z: p.z, pendiente_deg, diseno_deg, ancho_m, longitud_m: p.s.length ? p.s[p.s.length - 1] : 0 };
  const r = rasante(p.s, p.z, diseno_deg, { anclarInicio: true, anclarFin: true });
  if (!r.factible) return { ...base, factible: false, motivo: r.motivo };
  const v = volumenCarretera(p.s, p.z, r.zp, ancho_m);
  const Lc = longitudCorte(p.s, p.z, r.zp);
  const prof_m = Lc > 0 ? v.corte_m3 / (ancho_m * Lc) : 0;
  const luzM = luz ? mediaCapa(luz, camino, pesosTrapecio(p.s)) : null;
  return { ...base, factible: true, motivo: null, zp: r.zp, ...v, longitud_corte_m: Lc, prof_m, luz: luzM,
    ...masaYFlota({ luna, corte_m3: v.corte_m3, prof_m, densidad, luz: luzM, flota }) };
}

export function celdasDisco(n, m, fila, col, diametro_m) {
  const r = diametro_m / 2, rc = r / m, out = [];
  const f0 = Math.max(0, Math.ceil(fila - rc)), f1 = Math.min(n - 1, Math.floor(fila + rc));
  const c0 = Math.max(0, Math.ceil(col - rc)), c1 = Math.min(n - 1, Math.floor(col + rc));
  for (let f = f0; f <= f1; f++) for (let c = c0; c <= c1; c++) if (Math.hypot(f - fila, c - col) * m <= r) out.push(f * n + c);
  return out;
}

export function obraPlataforma({ t, fila, col, diametro_m, limite_deg, luz = null, luna, densidad, flota }) {
  const { n, alturas } = t, m = metros(t);
  const disco = celdasDisco(n, m, fila, col, Math.max(diametro_m, 1e-9));
  let maxAbs = Math.abs(alturas[fila * n + col]) || 0;
  for (const i of disco) if (Number.isFinite(alturas[i])) maxAbs = Math.max(maxAbs, Math.abs(alturas[i]));
  const diseno_deg = pendienteDiseno(limite_deg, maxAbs, m);
  const p = plataforma(t, fila, col, diametro_m, diseno_deg);
  const base = { ...p, diametro_m, limite_deg, diseno_deg };
  if (p.corte_m3 === null) return { ...base, factible: false };
  const r = diametro_m / 2;
  let prof_m, luzM = null, celdasCorte = 0;
  if (p.sub_celda) {
    prof_m = p.corte_m3 > 0 ? p.corte_m3 / ((Math.PI * r * r) / 2) : 0;
    if (luz) luzM = mediaCapa(luz, [fila * n + col]);
  } else {
    const idx = disco.filter((i) => Number.isFinite(alturas[i]));
    for (const i of idx) if (p.delta[i] < 0) celdasCorte++;
    prof_m = celdasCorte ? p.corte_m3 / (celdasCorte * m * m) : 0;
    if (luz) luzM = mediaCapa(luz, idx);
  }
  return { ...base, factible: true, prof_m, luz: luzM, celdas_corte: celdasCorte,
    ...masaYFlota({ luna, corte_m3: p.corte_m3, prof_m, densidad, luz: luzM, flota }) };
}

// ---------- Formato (texto plano; quien lo meta en HTML lo escapa) ----------
const grp = (x) => Math.round(x).toLocaleString('en-US').replace(/,/g, ' ');
export const fmt = {
  m3: (v) => (Number.isFinite(v) ? `${grp(v)} m³` : '—'),
  m: (v) => (Number.isFinite(v) ? `${v.toFixed(1)} m` : '—'),
  km: (v) => (Number.isFinite(v) ? `${(v / 1000).toFixed(2)} km` : '—'),
  masa: (kg) => (!Number.isFinite(kg) ? '—' : kg >= 1e4 ? `${grp(kg / 1000)} t` : `${grp(kg)} kg`),
  dias: (d) => (!Number.isFinite(d) ? '—' : d >= 100 ? grp(d) : d.toFixed(1)),
  grados: (x, d = 1) => (Number.isFinite(x) ? `${x.toFixed(d)}°` : '—'),
  frac: (x) => (Number.isFinite(x) ? x.toFixed(3) : '—'),
  horas: (h) => (!Number.isFinite(h) ? '—' : h >= 100 ? `${grp(h)} h` : `${h.toFixed(1)} h`),
  veces: (x) => (!Number.isFinite(x) ? '—' : x >= 100 ? grp(x) : x.toFixed(1)),
};

// Perfil longitudinal en SVG: terreno, rasante y, entre ambos, corte (terreno encima) y relleno.
export function perfilSvg(s, z, zp, W = 280, H = 90) {
  const N = s.length;
  if (N < 2) return '';
  const paso = Math.max(1, Math.ceil(N / 400)), ks = [];
  for (let k = 0; k < N; k += paso) ks.push(k);
  if (ks[ks.length - 1] !== N - 1) ks.push(N - 1);
  let lo = Infinity, hi = -Infinity;
  for (const k of ks) for (const v of [z[k], zp[k]]) if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  if (!(hi > lo)) hi = lo + 1;
  const L = s[N - 1] - s[0] || 1;
  const X = (k) => ((s[k] - s[0]) / L * (W - 2) + 1).toFixed(1), Y = (v) => ((1 - (v - lo) / (hi - lo)) * (H - 4) + 2).toFixed(1);
  const linea = (a) => ks.map((k) => `${X(k)},${Y(a(k))}`).join(' ');
  const zona = (arriba, abajo) => `${linea(arriba)} ${[...ks].reverse().map((k) => `${X(k)},${Y(abajo(k))}`).join(' ')}`;
  const corte = zona((k) => Math.max(z[k], zp[k]), (k) => zp[k]), relleno = zona((k) => zp[k], (k) => Math.min(z[k], zp[k]));
  return `<svg class="perfil-obra" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" preserveAspectRatio="none">
    <polygon class="corte" points="${corte}"></polygon><polygon class="relleno" points="${relleno}"></polygon>
    <polyline class="terreno" points="${linea((k) => z[k])}"></polyline><polyline class="rasante" points="${linea((k) => zp[k])}"></polyline></svg>`;
}

// ---------- Pantalla ----------
// ctx: catalogo, equipoDe, nombreCorto, esc, fuenteYCita, trasCambio, refrescarPlantado
export function crearObra(p, ctx) {
  const e = p.escena, n = e.n, { esc } = ctx;
  const luna = e.meta.cuerpo === 'luna';
  const capaLuz = luna ? e.capas.iluminacion ?? null : null;
  const O = { obra: null, F: null, errObra: null, clave: null, pend: null, ancho: null, diseno: null, res: null, aplicada: null, pads: new Map(), ocupado: false };
  const sec = document.createElement('div');
  sec.className = 'obra';
  p.el.querySelector('.rutas [data-r="res"]')?.after(sec);
  const lienzo = p.el.querySelector('.lienzo');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('obra-svg');
  lienzo.appendChild(svg);

  cargarCatalogo('obra.json').then((o) => { O.obra = o; }, (err) => { O.errObra = err.message; }).finally(() => {
    O.F = defectosFlota(O.obra, ctx.catalogo?.equipos);
    O.flota = { n_robots: O.F.n_robots.valor };
    pintar();
    ctx.refrescarPlantado();
  });

  const R = () => p.rutas?.R;
  const flotaDe = () => ({ ...O.flota, kg_h: O.F.ritmo_kg_h?.valor ?? null, mision_kg: O.F.mision_kg?.valor ?? null });
  const densidad = () => O.F?.densidad?.valor ?? null;
  const cita = (ref) => (ref ? ctx.fuenteYCita(ref) : '');

  function traza() {
    const r = R()?.res;
    if (!r) return null;
    const vigente = r.version === R().version;
    if (r.camino) return { tipo: 'ruta', r, camino: r.camino, vigente };
    if (!Number.isFinite(r.umbral)) return null;
    if (O.diseno?.r === r && O.diseno.camino) return { tipo: 'diseno', r, camino: O.diseno.camino, umbral: O.diseno.umbral, vigente: vigente && O.diseno.version === R().version };
    return { tipo: 'sin', r, vigente };
  }

  function vehiculoDe(id) { return vehiculos(ctx.catalogo).find((v) => v.equipo.id === id) ?? null; }

  function calcularCarretera(tr) {
    if (!O.F || !(O.pend > 0 && O.pend < 90) || !(O.ancho > 0)) return null;
    return obraCarretera({ t: { n, m: e.m, alturas: e.actual }, camino: tr.camino, luz: capaLuz, luna, pendiente_deg: O.pend, ancho_m: O.ancho, densidad: densidad(), flota: flotaDe() });
  }

  // ---------- Parámetros comunes ----------
  const campo = (k, et, valor, unidad, nota, paso = 'any') => `<label class="fila-o"><span class="et">${et}</span><span><input type="number" data-o="${k}" min="0" step="${paso}" value="${Number.isFinite(valor) ? +valor.toFixed(4) : ''}"> ${unidad}</span></label><div class="tenue nota-o">${nota}</div>`;
  function camposFlota() {
    const F = O.F, nom = esc(ctx.nombreCorto(ROBOT_REF));
    return `${campo('robots', 'ROBOTS', O.flota.n_robots, '', `<span class="supuesto">assumed</span> · number of ${nom}, editable`, 1)}
      <div class="tenue nota-o solo-fondo">reference robot: ${nom} · ${F.ritmo_kg_h ? `excavates ${esc(F.ritmo_kg_h.valor)} kg/h ${cita(F.ritmo_kg_h.ref)}` : 'no cited excavation rate'} · ${F.mision_kg ? `designed for up to ${fmt.masa(F.mision_kg.valor)} in a lunar day ${cita(F.mision_kg.ref)}` : ''}</div>`;
  }
  function leerFlota(raiz) {
    const r = +raiz.querySelector('[data-o="robots"]')?.value;
    if (Number.isFinite(r) && r >= 1) O.flota.n_robots = Math.round(r);
  }

  function filasResultado(x, extra = '') {
    const fl = x.flota, nom = esc(ctx.nombreCorto(ROBOT_REF));
    const masa = x.masa_kg !== null
      ? `<dt>MASS TO MOVE</dt><dd class="num" data-o="masa">${fmt.masa(x.masa_kg)}</dd>`
      : `<dt>MASS TO MOVE</dt><dd class="tenue" data-o="masa">not given</dd>`;
    const luz = luna ? (x.luz && x.luz.valor !== null ? `<dt>LIGHT</dt><dd class="num" data-o="luz">${fmt.frac(x.luz.valor)}</dd>` : '<dt>LIGHT</dt><dd class="tenue" data-o="luz">no data</dd>') : '';
    const t = fl.evaluable
      ? `<dt>EXCAVATION</dt><dd class="num" data-o="horas">${fmt.horas(fl.horas)} · ${fmt.dias(fl.dias_tierra)} d</dd>
        ${fl.misiones !== null ? `<dt>${nom} MISSIONS</dt><dd class="num" data-o="misiones">${fmt.veces(fl.misiones)}</dd>` : ''}
        ${luna ? `<dt>CALENDAR</dt>${fl.calendario_dias !== null ? `<dd class="num" data-o="calendario">${fmt.dias(fl.calendario_dias)} d</dd>` : `<dd class="tenue" data-o="calendario">${esc(fl.motivoCalendario)}</dd>`}` : ''}`
      : `<dt>EXCAVATION</dt><dd class="tenue" data-o="horas">not given: ${esc(fl.motivo)}</dd>`;
    return `<dl>${extra}
      <dt>CUT</dt><dd class="num" data-o="corte">${fmt.m3(x.corte_m3)}</dd>
      <dt>FILL</dt><dd class="num" data-o="relleno">${fmt.m3(x.relleno_m3)}</dd>
      ${masa}${luz}${t}</dl>
      <div class="no-medido" data-o="acarreo">haul time: NOT MEASURED (no published payload per trip)</div>`;
  }

  function notasMasa(x, que) {
    const d = O.F.densidad, fl = x.flota, nom = esc(ctx.nombreCorto(ROBOT_REF));
    const masa = x.masa_kg !== null
      ? `mass = cut × mean regolith density ${x.densidad_media.toFixed(2)} g/cm³ over the mean cut depth ${fmt.m(x.prof_m)}, ρ(z) = ${d.valor.rho_inf}·(z + ${d.valor.a})/(z + ${d.valor.b}) ${cita(d.ref)}`
      : `<span data-o="sin-masa">${esc(x.motivoMasa)}</span>${luna ? '' : ': volume only'}`;
    const tiempo = fl.evaluable
      ? ` · excavation = mass ÷ (${O.flota.n_robots} × ${esc(O.F.ritmo_kg_h.valor)} kg/h), in hours and in Earth days of continuous work${fl.misiones !== null ? `; missions = mass ÷ ${fmt.masa(O.F.mision_kg.valor)}` : ''}`
      : '';
    const cal = luna && fl.evaluable && fl.calendario_dias !== null
      ? ` · calendar = excavation ÷ mean illumination ${que} (LOLA layer${x.luz.sin_dato ? `, ${x.luz.sin_dato} of ${x.luz.total} cells without data` : ''}) · <span class="propio">own estimate</span>: robots work only while lit; no night survival stated for ${nom}`
      : '';
    return `<div class="tenue nota-o solo-fondo">${masa}${tiempo}${cal}</div>${cal ? '<div class="tenue nota-o solo-simple">Calendar days: <span class="propio">own estimate</span>.</div>' : ''}`;
  }

  // ---------- A y B: carretera ----------
  function pintar() {
    const tr = traza();
    if (!tr || !O.F) { sec.innerHTML = aplicadaHtml(); dibujar(); return; }
    const veh = vehiculoDe(tr.r.vehiculo), nom = ctx.nombreCorto(tr.r.vehiculo);
    if (O.clave !== tr.r.vehiculo) {
      const d = defectosCarretera(veh);
      O.clave = tr.r.vehiculo; O.pend = d.pendiente.valor; O.ancho = d.ancho.valor; O.defCarretera = d;
    }
    if (tr.tipo === 'sin') {
      sec.innerHTML = `<div class="et sub">ROAD · no route within ${esc(nom)}'s ${tr.r.limite}°</div>
        <div class="botones"><button type="button" data-o="disenar" ${tr.vigente && !O.ocupado ? '' : 'disabled'}>Design a road down</button></div>
        <div class="tenue nota-o solo-fondo">trace = least-cost path with the slope limit relaxed to ${fmt.grados(tr.r.umbral, 2)} (the least that connects FROM and TO on this DEM); its grade is then cut and filled to ${esc(nom)}'s ${tr.r.limite}°</div>
        ${O.errDiseno ? `<div class="sin-ruta">${esc(O.errDiseno)}</div>` : ''}${aplicadaHtml()}`;
      sec.querySelector('[data-o=disenar]').addEventListener('click', () => disenar(tr.r));
      dibujar();
      return;
    }
    O.res = calcularCarretera(tr);
    const x = O.res, d = O.defCarretera;
    const titulo = tr.tipo === 'diseno' ? `ROAD DOWN · ${esc(nom)} ≤ ${tr.r.limite}°` : 'BUILD ROAD ALONG THIS ROUTE';
    const pendNota = d.pendiente.ref ? `default: ${esc(nom)} slope limit ${cita(d.pendiente.ref)}` : 'no cited slope limit';
    const anchoNota = d.ancho.ref ? `<span class="propio">own parameter</span> · default 2 × ${esc(nom)} width ${esc(d.ancho.ref.valor)} m ${cita(d.ancho.ref)}` : `<span class="propio">own parameter</span> · no cited width for ${esc(nom)}: enter one`;
    let cuerpo;
    if (!x) cuerpo = '<div class="tenue">enter a design grade and a road width</div>';
    else if (!x.factible) cuerpo = `<div class="sin-ruta" data-o="no-factible">no grade: ${esc(x.motivo)}</div>`;
    else {
      const cab = tr.tipo === 'diseno'
        ? `<div class="pide" data-o="pide">To get ${esc(nom)} from FROM to TO at ≤ ${fmt.grados(x.pendiente_deg, 0)}: cut <b>${fmt.m3(x.corte_m3)}</b> (up to ${fmt.m(x.corte_max_m)} deep) and fill <b>${fmt.m3(x.relleno_m3)}</b> along ${fmt.km(x.longitud_m)}${x.masa_kg !== null ? ` · <b>${fmt.masa(x.masa_kg)}</b> of regolith` : ''}${x.flota.evaluable ? ` · <b>${fmt.horas(x.flota.horas)}</b> of excavation with ${O.flota.n_robots} ${esc(ctx.nombreCorto(ROBOT_REF))}${x.flota.calendario_dias !== null ? ` (≈ ${fmt.dias(x.flota.calendario_dias)} days counting only sunlight)` : ''}` : ''}</div>`
        : '';
      cuerpo = `${cab}<dl class="primera"><dt>MAX CUT</dt><dd class="num" data-o="corte-max">${fmt.m(x.corte_max_m)}</dd><dt>MAX FILL</dt><dd class="num" data-o="relleno-max">${fmt.m(x.relleno_max_m)}</dd></dl>
        <div class="tenue nota-o" data-o="nota-alineacion"><span class="propio">own criterion</span> · Straight grade along the traced line; a longer alignment with switchbacks is not computed. No published limit for cut depth: judge the figure.</div>
        ${perfilSvg(x.s, x.z, x.zp)}
        <div class="tenue nota-o"><i class="m-corte"></i>cut <i class="m-relleno"></i>fill · grey = terrain, white = grade · vertical scale exaggerated</div>
        ${filasResultado(x, `<dt>LENGTH</dt><dd class="num" data-o="longitud">${fmt.km(x.longitud_m)}</dd>`)}
        <div class="tenue nota-o solo-fondo">grade: least earth moved with every step ≤ ${fmt.grados(x.diseno_deg, 4)} (design grade less the float32 rounding of the elevations), both ends on the terrain; road ${fmt.m(x.ancho_m)} wide, vertical sides${tr.tipo === 'diseno' ? `; trace found with the limit at ${fmt.grados(tr.umbral, 2)}` : ''}</div>
        ${notasMasa(x, 'along the trace')}`;
    }
    const noMedido = `<div class="no-medido" data-o="no-medido">cross slope, rocks, bearing capacity: NOT MEASURED (DEM ${e.m.toFixed(1)} m/px, road ${O.ancho > 0 && O.ancho < e.m ? 'narrower than a cell' : 'applied to one cell per step'})</div>`;
    const nada = x?.factible && !(x.corte_m3 > 0) && !(x.relleno_m3 > 0);
    const puede = x?.factible && !nada && tr.vigente && !e.verOriginal && !O.ocupado;
    sec.innerHTML = `<div class="et sub">${titulo}</div>
      ${tr.vigente ? '' : '<div class="aviso-obs">terrain changed since this trace: compute the route again</div>'}
      <div class="params">
      ${campo('pend', 'DESIGN GRADE', O.pend, '°', pendNota)}
      ${campo('ancho', 'ROAD WIDTH', O.ancho, 'm', anchoNota)}
      ${camposFlota()}</div>
      ${cuerpo}${noMedido}
      <div class="botones"><button type="button" data-o="aplicar" ${puede ? '' : 'disabled'} title="${e.verOriginal ? 'switch to Retouched to apply' : nada ? 'nothing to change: every step is already within the grade' : 'applies the grade to the trace cells as a retouch (Undo reverts it)'}">Apply</button></div>
      ${O.aviso ? `<div class="tenue" data-o="aviso">${esc(O.aviso)}</div>` : ''}${aplicadaHtml()}`;
    sec.querySelectorAll('.params input').forEach((i) => i.addEventListener('change', () => {
      const pe = +sec.querySelector('[data-o=pend]').value, an = +sec.querySelector('[data-o=ancho]').value;
      O.pend = pe > 0 && pe < 90 ? pe : O.pend; O.ancho = an > 0 ? an : O.ancho;
      leerFlota(sec);
      pintar();
      ctx.refrescarPlantado();
    }));
    sec.querySelector('[data-o=aplicar]').addEventListener('click', () => aplicarCarretera(tr));
    dibujar();
  }

  async function disenar(r) {
    const o = r.celdas[0], d = r.celdas[1];
    O.ocupado = true; O.errDiseno = null;
    pintar();
    const alt = Float32Array.from(e.actual), sombra = r.factor !== 1 && e.capas.sombra_permanente ? Float32Array.from(e.capas.sombra_permanente) : null, version = R().version;
    try {
      const q = await pedir('ruta', { n, m: e.m, alturas: alt, sombra, agua: e.capas.agua ?? null, carreteras: carreteras(), limite: r.umbral, factor: r.factor, origen: o.f * n + o.c, destino: d.f * n + d.c }, [alt.buffer, ...(sombra ? [sombra.buffer] : [])]);
      if (!q.camino) O.errDiseno = `no trace even at ${fmt.grados(r.umbral, 2)}`;
      else O.diseno = { r, camino: q.camino, umbral: r.umbral, version, diezmado: q.diezmado };
    } catch (err) {
      O.errDiseno = `trace failed: ${err.message}`;
    } finally { O.ocupado = false; }
    pintar();
    sec.scrollIntoView({ block: 'nearest' });
  }

  function aplicar(delta, indices, texto, carretera = null) {
    const nuevo = Float32Array.from(e.delta);
    let k = 0;
    for (const i of indices) if (delta[i] !== 0) { nuevo[i] = e.delta[i] + delta[i]; k++; }
    const paso = p.historial.reemplazar(e.delta, nuevo);
    if (!paso) return { k: 0, paso: null };
    if (carretera) registrarCarretera(paso, carretera, e.delta);
    ctx.trasCambio(p, `${texto}: ${k} cells (Undo reverts it)`);
    return { k, paso };
  }

  const carreteras = () => carreterasVigentes(p.historial.pasos, e.delta);

  async function aplicarCarretera(tr) {
    const x = calcularCarretera(tr);
    if (!x?.factible || e.verOriginal) return;
    const lim = tr.r.limite;
    const antes = sobreLimiteTraza(e.actual, n, e.m, tr.camino, lim);
    const d = deltaCarretera({ n, alturas: e.actual }, tr.camino, x.zp);
    const { k, paso } = aplicar(d, tr.camino, `road applied along ${tr.camino.length} cells`, tr.camino);
    if (!paso) { O.aviso = 'nothing to apply: the grade already follows the terrain on every cell of this trace'; pintar(); return; }
    O.aviso = null;
    const despues = sobreLimiteTraza(e.actual, n, e.m, tr.camino, lim);
    O.aplicada = { tipo: tr.tipo, celdas: k, antes, despues, limite: lim, vehiculo: tr.r.vehiculo, version: R().version, camino: tr.camino, res: x, paso };
    O.ocupado = true;
    try { await p.rutas.calcular(); } finally { O.ocupado = false; }
    pintar();
  }

  function aplicadaHtml() {
    const a = O.aplicada;
    if (!a) return '';
    const activa = p.historial.pasos.includes(a.paso);
    const obs = !activa ? '<div class="aviso-obs" data-o="aplicada-obs">undone: this road no longer counts for routes</div>'
      : a.version === R()?.version ? '' : '<div class="aviso-obs" data-o="aplicada-obs">terrain changed since (another retouch)</div>';
    const nom = esc(ctx.nombreCorto(a.vehiculo));
    const r = R()?.res, ahora = r && r.version === R().version
      ? (r.camino ? `${nom} route now found: ${fmt.km(r.medidas.longitud_m)}` : Number.isFinite(r.umbral) ? `still no route within ${r.limite}°: on the road every step needs a grade ≤ ${r.limite}°, off it every cell a cell slope ≤ ${r.limite}° (now ${fmt.grados(r.umbral, 1)} at least)` : 'no route')
      : 'compute the route again';
    return `<div class="aplicada" data-o="aplicada"><div class="et">APPLIED · road along ${a.camino.length} cells</div>${obs}
      <dl><dt>STEPS OVER ${a.limite}°</dt><dd class="num" data-o="pasos-antes-despues">${a.antes.pasos} → ${a.despues.pasos}</dd>
      <dt>CELL SLOPE OVER ${a.limite}°</dt><dd class="num" data-o="celdas-antes-despues">${a.antes.celdas} → ${a.despues.celdas}</dd></dl>
      <div class="tenue nota-o solo-fondo">steps = grade between consecutive cells of the trace (what the road fixes and what the Route tool checks along it); cell slope = DEM gradient at each trace cell, which includes the untouched terrain beside it (the cross slope, not used for routes on the road)</div>
      <div class="tenue nota-o" data-o="ruta-ahora">${ahora}</div></div>`;
  }

  // ---------- C: plataforma en la hoja ----------
  function estadoPad(item, eq) {
    let s = O.pads.get(item.uid);
    if (!s || s.eq !== eq.id) {
      const d = defectosPlataforma(eq, O.obra);
      s = { eq: eq.id, def: d, abierto: false, diametro: d?.diametro.valor ?? null, limite: d?.limite.valor ?? null, aplicada: null };
      O.pads.set(item.uid, s);
    }
    return s;
  }

  function calcularPad(item, s) {
    if (!(s.diametro > 0) || !(s.limite >= 0 && s.limite < 90) || !O.F) return null;
    return obraPlataforma({ t: { n, m: e.m, alturas: e.actual }, fila: item.fila, col: item.col, diametro_m: s.diametro, limite_deg: s.limite, luz: capaLuz, luna, densidad: densidad(), flota: flotaDe() });
  }

  function hoja(cont, item, eq) {
    if (!cont) return;
    const s = O.F ? estadoPad(item, eq) : null;
    if (!s?.def) { cont.innerHTML = ''; return; }
    if (!s.abierto) {
      cont.innerHTML = `<div class="botones"><button type="button" data-o="pad">Grade a pad here</button></div>${padAplicadaHtml(item, s)}`;
      cont.querySelector('[data-o=pad]').addEventListener('click', () => { s.abierto = true; hoja(cont, item, eq); });
      return;
    }
    const x = calcularPad(item, s), d = s.def;
    const diamNota = d.diametro.valor !== null ? `default: ${esc(d.diametro.como)} ${fmt.m(d.diametro.valor)} · ${cita(d.diametro.ref)}` : 'no cited size: enter one';
    const limNota = `default: ${d.limite.de === 'obra' ? 'construction constant' : 'design limit'} ${esc(d.limite.op)} ${esc(d.limite.valor)}° · ${cita(d.limite.ref)}`;
    let cuerpo;
    if (!x) cuerpo = '<div class="tenue">enter a diameter and a slope limit</div>';
    else if (!x.factible) cuerpo = `<div class="sin-ruta">no pad: ${esc(x.motivo)}</div>`;
    else {
      cuerpo = `<dl><dt>PLANE SLOPE</dt><dd class="num" data-o="pad-pend">${fmt.grados(x.pend_antes_deg, 2)} → ${fmt.grados(x.pend_despues_deg, 2)}</dd></dl>
        ${x.sub_celda ? `<div class="aviso-obs" data-o="sub-celda">narrower than ${DIAMETRO_SUBCELDA} DEM cells (${fmt.m(DIAMETRO_SUBCELDA * e.m)}): estimate from the local slope only, terrain not modified, Apply off</div>` : ''}
        ${filasResultado(x)}
        <div class="tenue nota-o solo-fondo">${x.sub_celda ? `tilted disc ${fmt.m(x.diametro_m)} brought from the cell slope to the limit` : `least-squares plane over ${x.celdas} cells of ${e.m.toFixed(1)} m, tilted down to ${fmt.grados(x.diseno_deg, 4)} (limit less the float32 rounding of the elevations) about its mean elevation`}</div>
        ${notasMasa(x, 'over the pad')}`;
    }
    const puede = x?.factible && !x.sub_celda && !e.verOriginal;
    cont.innerHTML = `<div class="et">PAD · grade the ground under it</div>
      <div class="params">
      ${campo('diam', 'DIAMETER', s.diametro, 'm', diamNota)}
      ${campo('lim', 'SLOPE LIMIT', s.limite, '°', limNota)}
      ${camposFlota()}</div>
      ${cuerpo}
      <div class="no-medido">rocks, bearing capacity: NOT MEASURED (DEM ${e.m.toFixed(1)} m/px)</div>
      <div class="botones"><button type="button" data-o="pad-aplicar" ${puede ? '' : 'disabled'}>Apply</button><button type="button" data-o="pad-cerrar">Close</button></div>
      ${padAplicadaHtml(item, s)}`;
    cont.querySelectorAll('.params input').forEach((i) => i.addEventListener('change', () => {
      const dm = +cont.querySelector('[data-o=diam]').value, li = +cont.querySelector('[data-o=lim]').value;
      if (dm > 0) s.diametro = dm;
      if (li >= 0 && li < 90) s.limite = li;
      leerFlota(cont);
      hoja(cont, item, eq);
      pintar();
    }));
    cont.querySelector('[data-o=pad-cerrar]').addEventListener('click', () => { s.abierto = false; hoja(cont, item, eq); dibujar(); });
    cont.querySelector('[data-o=pad-aplicar]').addEventListener('click', () => {
      const y = calcularPad(item, s);
      if (!y?.delta || e.verOriginal) return;
      const centro = () => pendienteGrados(e.actual, n, e.m, item.fila, item.col);
      const antes = centro();
      const { k } = aplicar(y.delta, celdasDisco(n, e.m, item.fila, item.col, s.diametro), `pad graded under ${ctx.nombreCorto(eq.id)}`);
      s.aplicada = { celdas: k, antes, despues: centro(), version: R()?.version, fila: item.fila, col: item.col, plano: [y.pend_antes_deg, y.pend_despues_deg] };
      ctx.refrescarPlantado();
    });
    dibujar();
  }

  function padAplicadaHtml(item, s) {
    const a = s.aplicada;
    if (!a) return '';
    const obs = a.version === R()?.version && a.fila === item.fila && a.col === item.col ? '' : '<div class="aviso-obs">terrain or position changed since</div>';
    return `<div class="aplicada" data-o="pad-aplicada"><div class="et">APPLIED · pad over ${a.celdas} cells</div>${obs}
      <dl><dt>CELL SLOPE HERE</dt><dd class="num" data-o="pad-celda">${fmt.grados(a.antes, 2)} → ${fmt.grados(a.despues, 2)}</dd></dl>
      <div class="tenue nota-o solo-fondo">cell slope = the value the requirement above is checked against</div></div>`;
  }

  // ---------- Dibujo sobre el terreno ----------
  function dibujar() {
    if (!p.el.classList.contains('ampliado')) { svg.innerHTML = ''; return; }
    const caja = lienzo.getBoundingClientRect();
    const pant = (f, c) => { const s = e.aPantalla(e.mundoDePixel(f, c)); return s ? `${(s.x - caja.left).toFixed(1)},${(s.y - caja.top).toFixed(1)}` : null; };
    let h = '';
    const tr = traza();
    if (tr?.tipo === 'diseno') {
      const cam = tr.camino, paso = Math.max(1, Math.ceil(cam.length / 600)), pts = [];
      for (let k = 0; k < cam.length; k += paso) pts.push(pant(Math.floor(cam[k] / n), cam[k] % n));
      pts.push(pant(Math.floor(cam[cam.length - 1] / n), cam[cam.length - 1] % n));
      h += `<polyline class="traza-fondo" points="${pts.filter(Boolean).join(' ')}"></polyline><polyline class="traza${tr.vigente ? '' : ' obsoleta'}" points="${pts.filter(Boolean).join(' ')}"></polyline>`;
    }
    for (const [uid, s] of O.pads) {
      const it = p.plantados?.buscar(uid);
      if (!it || !s.abierto || !(s.diametro > 0) || p.sel !== uid) continue;
      const r = s.diametro / 2 / e.m, pts = [];
      for (let k = 0; k < 48; k++) { const a = (k / 48) * 2 * Math.PI; pts.push(pant(it.fila + r * Math.sin(a), it.col + r * Math.cos(a))); }
      if (pts.every(Boolean)) h += `<polygon class="pad" points="${pts.join(' ')}"></polygon>`;
    }
    svg.innerHTML = h;
  }

  return { O, pintar, rutaCambiada: pintar, hoja, dibujar, carreteras };
}
