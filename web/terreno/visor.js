import { Escena } from './escena.js';
import { cargarIndice, cargarTerreno, cargarCatalogo } from './datos.js';
import { Plantados, deJSON, huella } from './plantado.js';
import { medirPunto, medirSeparacion, evaluarEquipo, compararRequisito, MARGEN, cargasExcavadora, cantidad, decimales, decimalesVeredicto, notaBasesPendiente } from './evaluar.js';
import { terrenoSintetico } from './sintetico.js';
import { aplicarToque, pasoMetros } from './pincel.js';
import { Historial } from './historial.js';
import { estadisticas, exportarRetoque, importarRetoque } from './retoque.js';
import { sha256Hex } from './sha256.js';
import { alturaBilineal, rumboHorizonte } from './calculo.js';
import { crearRutas } from './panel_rutas.js';
import { crearObra } from './panel_obra.js';
import { crearVolatiles } from './panel_volatiles.js';
import { crearBase } from './panel_base.js';
import { crearCerca, capaModelos, catalogoModelos, medidaTexto } from './modelo3d.js';
import { volumenPublicado } from './modelos_generados.js';
import { PREFIJO, equiposDeMision, formaPublicada, medidaForma, sustitutoDe, limitesDe, textoPendiente } from './equipo_mision.js';
import { leerLugar, idLugar, cargarLugar, textoMuestreo, LADOS_KM, leerPunto, idPunto, cargarPunto, textoPunto, MUNDOS_PUNTO } from './lugar.js';
import { crearDia } from './panel_dia.js';
import { celdaEspejo, textoDesplazamiento, filasEspejo, resumenEspejo, MARGEN_SOL_DEG, MARGEN_LUZ_FRAC } from './espejo.js';

const qs = new URLSearchParams(location.search);
const EJEMPLO = qs.get('ejemplo') === '1';
const LUGAR = EJEMPLO ? null : leerLugar(location.search);
const ID_LUGAR = LUGAR ? idLugar(LUGAR) : null;
// Punto elegido en la Luna o Marte sin terreno de catálogo: su panel se hace en el momento, con la ventana del lugar.
const PUNTO = LUGAR && !qs.get('b') ? leerPunto(location.search, LUGAR.lado_km) : null;
const ID_PUNTO = PUNTO ? idPunto(PUNTO) : null;
const MISION = qs.get('mision');
const MES = qs.get('mes');
const CLAVE = (id) => `analog-zero.retouch.${id}`;
const CLAVE_PLANTADO = (id) => `analog-zero.planted.${id}`;
const CUERPO = { luna: 'Moon', tierra: 'Earth', marte: 'Mars' };
const NOMBRE_CAPA = { iluminacion: 'Illumination', sombra_permanente: 'Perm. shadow', temp_max: 'Max temp', temp_media: 'Mean temp' };
const HERRAMIENTAS = [['navegar', 'Navigate'], ['subir', 'Raise'], ['bajar', 'Lower'], ['allanar', 'Flatten'], ['suavizar', 'Smooth']];
const RAMPA_CAPA = 'linear-gradient(90deg, rgb(13,31,89), rgb(158,242,255))';
const RAMPA_BASE = 'linear-gradient(90deg, rgb(4,19,38) 0%, rgb(0,48,84) 40%, rgb(77,148,199) 75%, rgb(237,242,247) 100%)';

const estado = { paneles: [], enlazar: false, espejo: qs.get('espejo') !== '0', exag: 1, errores: [], listo: false, catalogo: null, errCatalogo: null, constantes: null };
window.__az = estado;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (x, d) => (Number.isFinite(x) ? x.toFixed(d) : '—');
const fmtLat = (v, d = 4) => (Number.isFinite(v) ? `${Math.abs(v).toFixed(d)}° ${v < 0 ? 'S' : 'N'}` : '—');
const fmtLon = (v, d = 4) => (Number.isFinite(v) ? `${Math.abs(v).toFixed(d)}° ${v < 0 ? 'W' : 'E'}` : '—');
const fmtVol = (v) => Math.round(v).toLocaleString('en-US').replace(/,/g, ' ');
const urlSegura = (u) => (/^https?:\/\//i.test(u ?? '') ? u : null);

function enlaceFuente(c) {
  const u = urlSegura(c.url);
  const txt = esc(c.fuente ?? 'unknown source');
  return u ? `<a href="${esc(u)}" target="_blank" rel="noopener" title="${txt}">${txt}</a>` : `<span title="${txt}">${txt}</span>`;
}

// ---------- Selección de terrenos ----------
async function elegirIds() {
  if (EJEMPLO) {
    const ids = ['ejemplo-tierra', 'ejemplo-luna'];
    return { a: ids[0], b: ids[1], solo: ids.includes(qs.get('solo')) ? qs.get('solo') : null, indice: null };
  }
  let indice = null, errIndice = null;
  try { indice = await cargarIndice(); } catch (e) { errIndice = e.message; }
  let a = qs.get('a') ?? indice?.pareja_inicial?.tierra ?? null;
  let b = qs.get('b') ?? indice?.pareja_inicial?.luna ?? null;
  // Con ?lugar= el panel de la Tierra se hace en el momento; el del catálogo queda de reserva.
  const reserva = a;
  if (LUGAR) a = ID_LUGAR;
  // ?solo=lugar: el lugar de la Tierra sin pareja (p. ej. cuando el punto elegido está en Marte); no es la vista ampliada.
  const unico = qs.get('solo') === 'lugar' && !!LUGAR && !PUNTO;
  if (PUNTO) b = ID_PUNTO;
  if (unico) { b = null; document.body.dataset.unico = 'a'; }
  const solo = unico ? null : qs.get('solo');
  if (solo && solo !== a && solo !== b) {
    const t = indice?.terrenos?.find((x) => x.id === solo);
    if (t?.cuerpo === 'tierra') a = solo; else b = solo;
  }
  return { a, b, solo, indice, errIndice, reserva };
}

async function obtenerDatos(id) {
  if (EJEMPLO) {
    const t = terrenoSintetico(id === 'ejemplo-luna' ? 'luna' : 'tierra');
    return { ...t, bytesAltura: new Uint8Array(t.altura.buffer), notas: [] };
  }
  if (LUGAR && id === ID_LUGAR) return cargarLugar(LUGAR);
  if (PUNTO && id === ID_PUNTO) return cargarPunto(PUNTO);
  return cargarTerreno(id);
}

// ---------- Panel ----------
function crearPanel(lado) {
  const el = document.createElement('section');
  el.className = 'panel';
  el.dataset.lado = lado;
  el.innerHTML = `
    <aside class="lado marca-panel">
      <p class="aviso-lugar" role="status" hidden></p>
      <div class="tarjeta"><div class="et cab">Loading…</div></div>
      <section class="seccion"><h3 class="marca-subtitulo">Explore</h3>
        <div class="acciones"><button type="button" class="suelo marca-boton" aria-pressed="false" disabled>Ground view</button><button type="button" class="ver-paleta marca-boton secundario" aria-pressed="false" disabled>Equipment</button><button type="button" class="ampliar marca-boton secundario" disabled>Expand</button></div>
        <div class="sec-suelo" hidden>
          <p class="tenue">Drag to look around. Arrow keys or W/S walk, A/D turn, the mouse wheel steps 2 m.</p>
          <div class="botones"><button type="button" data-s="izquierda" title="Turn left 15°">◀ Turn</button><button type="button" data-s="adelante">Forward 5 m</button><button type="button" data-s="atras">Back 5 m</button><button type="button" data-s="derecha" title="Turn right 15°">Turn ▶</button></div>
        </div>
      </section>
      <div class="paleta" hidden></div>
      <aside class="hoja" hidden></aside>
      <details class="seccion pliegue" open><summary class="marca-subtitulo">Display</summary><div class="mandos"></div></details>
    </aside>
    <div class="lienzo"><div class="rotulos"></div>
      <div class="marcas"><svg class="huellas"></svg></div>
      <div class="pildora-suelo" hidden></div>
      <div class="aviso-plantar" hidden></div>
      <div class="aviso-espejo" role="status" hidden></div>
    </div>
    <aside class="retoque"></aside>
    <footer class="lectura">
      <span><span class="et">Lat</span> <span class="num v" data-k="lat">—</span></span>
      <span><span class="et">Lon</span> <span class="num v" data-k="lon">—</span></span>
      <span><span class="et">Elevation</span> <span class="num v corta" data-k="cota">—</span></span>
      <span><span class="et">Slope</span> <span class="num v mini" data-k="pend">—</span></span>
      <span class="lect-agua" hidden><span class="et">Water</span> <span class="num v mini" data-k="agua">—</span></span>
      <span class="lect-res"><span class="et">Resolution</span> <span class="num" data-k="res">—</span></span>
      <span class="hueco"></span>
      <span class="escala"><span class="regla"></span><span class="num et-escala"></span></span>
    </footer>`;
  document.getElementById('paneles').appendChild(el);
  const p = { lado, el, id: null, escena: null, ampliado: false, herramienta: 'navegar', radio_m: 250, intensidad: 0.5, historial: new Historial(), trazo: null, sha: null,
    plantados: null, sel: null, plantar: null, arrastre: null, marcas: new Map() };
  el.querySelector('.ampliar').addEventListener('click', () => alternarAmpliado(p));
  el.querySelector('.suelo').addEventListener('click', () => alternarSuelo(p));
  const GIRO = Math.PI / 12;
  el.querySelectorAll('[data-s]').forEach((b) => b.addEventListener('click', () => {
    const e = p.escena, k = b.dataset.s;
    if (!e?.suelo) return;
    if (k === 'adelante' || k === 'atras') e.andarSuelo(k === 'adelante' ? 5 : -5);
    else e.girarSuelo(k === 'izquierda' ? -GIRO : GIRO, 0);
  }));
  el.addEventListener('pointerdown', () => { if (p.escena?.suelo) estado.sueloActivo = p; });
  return p;
}

function mostrarError(p, msg) {
  const d = document.createElement('div');
  d.className = 'error';
  d.innerHTML = `<b>${esc(msg)}</b><span class="pista">${EJEMPLO ? '' : 'expected in web/data/terreno/ · add ?ejemplo=1 for a synthetic example'}</span>`;
  p.el.querySelector('.lienzo').appendChild(d);
  p.el.querySelector('.tarjeta').innerHTML = `<div class="et">${p.id ? esc(p.id) : 'No terrain'}</div>`;
  estado.errores.push(msg);
}

function rellenarTarjeta(p, datos) {
  const m = datos.meta, h = m.capas.altura;
  const notas = [...datos.notas];
  if (p.escena.fraccionNaN > 0) notas.push(`${(p.escena.fraccionNaN * 100).toFixed(2)} % no-data cells shown as gaps`);
  p.el.querySelector('.tarjeta').innerHTML = `
    <div><span class="marca-chip cuerpo">${esc(CUERPO[m.cuerpo] ?? m.cuerpo)}</span>${m.sintetico ? '<span class="sello">SYNTHETIC EXAMPLE — not real data</span>' : ''}${m.dinamico ? '<span class="marca-chip vivo">Your place</span>' : ''}${m.punto ? '<span class="marca-chip vivo">Your point</span>' : ''}</div>
    <h2 class="marca-titulo">${esc(m.nombre)}</h2>
    <div class="cifras">
      <div><span class="et">Center</span><span class="num">${fmtLat(m.centro.lat, 2)} ${fmtLon(m.centro.lon, 2)}</span></div>
      <div><span class="et">Side</span><span class="num">${fmt(m.lado_km, 1)} <u>km</u></span></div>
      <div><span class="num">${fmt(m.m_por_px, 2)} <u>m/px</u></span></div>
    </div>
    ${m.dinamico ? `<div class="muestreo" data-muestreo>${esc(textoMuestreo(m))}</div>` : ''}
    ${m.punto ? `<div class="muestreo" data-muestreo-punto>${esc(textoPunto(m))}</div>` : ''}
    ${m.imagen ? `<div class="fuente" data-imagen>${esc(m.imagen.texto)}</div>` : ''}
    <div class="fuente recorte">Elevation data: ${enlaceFuente(h)}${h.resolucion_origen_m && !m.dinamico ? ` · source ${esc(h.resolucion_origen_m)} m` : ''}${m.z_referencia ? ` · elev. ref. ${esc(m.z_referencia)}` : ''}${m.dinamico || m.punto ? ' · built live in your browser, not stored' : ''}</div>
    <div class="notas">${notas.map(esc).join(' · ')}</div>
    ${m.notas ? `<details class="notas-meta"><summary class="et">Notes</summary><div class="tenue" data-notas>${[].concat(m.notas).map(esc).join(' · ')}</div></details>` : ''}
    ${m.creditos?.length ? `<details class="notas-meta"><summary class="et">Credits</summary><div class="tenue" data-creditos>${m.creditos.map(esc).join(' · ')}</div></details>` : ''}`;
  if (m.dinamico) selectorVentana(p);
  p.el.querySelector('[data-k=res]').textContent = `${fmt(m.m_por_px, 2)} m/px`;
  p.el.querySelector('.lect-agua').hidden = !p.escena.capas.agua;
  p.el.classList.toggle('con-agua', !!p.escena.capas.agua);
}

// Ventana del lugar: otra anchura recarga la página con &lado= (el terreno se vuelve a construir).
function selectorVentana(p) {
  const s = document.createElement('section');
  s.className = 'seccion ventana';
  s.innerHTML = `<h3 class="marca-subtitulo">Window</h3>
    <div class="mandos-ventana">${LADOS_KM.map((k) => `<button type="button" data-lado-km="${k}" aria-pressed="${k === LUGAR.lado_km}">${k} km</button>`).join('')}</div>
    <p class="tenue">A wider window is sampled more coarsely.</p>`;
  s.querySelectorAll('[data-lado-km]').forEach((b) => b.addEventListener('click', () => {
    if (+b.dataset.ladoKm === LUGAR.lado_km) return;
    const u = new URL(location.href);
    u.searchParams.set('lado', b.dataset.ladoKm);
    u.searchParams.delete('solo');
    location.assign(u);
  }));
  p.el.querySelector('.tarjeta').after(s);
}

// ---------- Vista a ras de suelo ----------
// Junto al equipo seleccionado (o el último plantado), mirándolo desde el sur; si no hay, en el centro mirando al norte.
function puntoSuelo(p) {
  const e = p.escena, k = (e.n - 1) / 2;
  const it = p.plantados?.buscar(p.sel) ?? p.plantados?.lista.at(-1) ?? null;
  // Lugar de la Tierra sin nada plantado: mirando hacia donde más sube el terreno en la ventana.
  if (!it) return { fila: k, col: k, mirar: null, rumbo: e.meta.dinamico ? rumboHorizonte(e.mostradas, e.n, e.m, k, k)?.rumbo_deg ?? null : null };
  const tam = p.modelos?.instancias().find((x) => x.uid === it.uid)?.tam;
  const d_m = Math.min(60, Math.max(10, 3 * Math.max(...(tam ?? [5]))));
  const sur = it.fila + d_m / e.m;
  // Volumen de una misión: desde el suroeste, para ver una cara al sol (por defecto del noroeste) y otra en sombra.
  if (equipoMisionDe(it.equipo)) {
    const q = d_m / e.m / Math.SQRT2;
    return { fila: Math.min(e.n - 1, it.fila + q), col: Math.max(0, it.col - q), mirar: { fila: it.fila, col: it.col } };
  }
  return { fila: sur <= e.n - 1 ? sur : it.fila - d_m / e.m, col: it.col, mirar: { fila: it.fila, col: it.col } };
}

function alternarSuelo(p, forzar) {
  const e = p.escena;
  if (!e) return;
  const si = forzar ?? !e.suelo;
  let pt = null;
  if (si) {
    elegirHerramienta(p, 'navegar');
    pt = puntoSuelo(p);
    if (!e.entrarSuelo(pt)) { nota(p, 'ground view: no elevation data at this point'); return; }
    estado.sueloActivo = p;
    // La hoja del equipo taparía la vista: se cierra (se reabre pulsando su marca).
    if (p.sel !== null) { p.sel = null; refrescarPlantado(); }
  } else e.salirSuelo();
  const b = p.el.querySelector('.suelo');
  b.textContent = si ? 'Overview' : 'Ground view';
  b.setAttribute('aria-pressed', String(si));
  p.el.querySelector('.sec-suelo').hidden = !si;
  const pild = p.el.querySelector('.pildora-suelo');
  pild.hidden = !si;
  if (si) {
    const s = e.estadoSuelo();
    pild.textContent = `Ground view · eye ${s.ojo_m.toFixed(1)} m above the ground · vertical 1× (true scale) · ${e.conBruma ? 'light haze added for depth (own choice)' : 'no haze: no air'}${Number.isFinite(pt?.rumbo) ? ` · facing ${Math.round(pt.rumbo)}°, where the land rises most in this window` : ''}`;
  }
}

const claseAgua = (meta, v) => (Number.isFinite(v) ? meta.capas.agua?.clases?.[String(v)] ?? (v >= 1 ? 'water' : 'land') : 'no data');
function enlaceAgua(meta) {
  const c = meta.capas.agua, u = urlSegura(c?.url);
  return u ? `<a href="${esc(u)}" target="_blank" rel="noopener" title="${esc(c.fuente ?? '')}">Copernicus water mask</a>` : 'Copernicus water mask';
}

function nota(p, txt) {
  const n = p.el.querySelector('.notas');
  if (n) n.textContent = n.textContent ? `${n.textContent} · ${txt}` : txt;
}

function crearMandos(p) {
  const m = p.escena.meta;
  // Estereográfica polar: el azimut de rejilla del sol es la longitud subsolar.
  const polar = m.georef.tipo === 'estereo_polar';
  // Sol rasante solo en los recortes polares de la Luna.
  const luna = m.cuerpo === 'luna' && polar;
  const txtAz = (az) => (polar ? fmtLon(az > 180 ? az - 360 : az, 0) : `${az}°`);
  const capas = Object.keys(m.capas).filter((k) => k !== 'altura' && k !== 'agua' && p.escena.capas[k]);
  const el = p.el.querySelector('.mandos');
  el.innerHTML = `
    <div class="fila"><span class="et">Colour</span>
      <button type="button" data-modo="relieve" aria-pressed="true">Relief</button>
      <button type="button" data-modo="cota" aria-pressed="false">Elevation</button>
      <button type="button" data-modo="pendiente" aria-pressed="false">Slope</button>${p.escena.imagen ? `<button type="button" data-modo="satelite" aria-pressed="false">${m.imagen?.tinte ? 'Tinted' : 'Satellite'}</button>` : ''}</div>
    ${capas.length ? `<div class="fila"><span class="et">Layer</span>
      <button type="button" data-capa="" aria-pressed="true">None</button>
      ${capas.map((k) => `<button type="button" data-capa="${esc(k)}" aria-pressed="false">${esc(NOMBRE_CAPA[k] ?? k)}</button>`).join('')}</div>` : ''}
    <div class="fila"><span class="et">${polar ? 'Sun longitude' : 'Sun azimuth'}</span><input type="range" data-sol="az" min="0" max="359" step="1" value="315"><span class="num" data-v="az">${txtAz(315)}</span>
      <span class="et">Elevation</span><input type="range" data-sol="el" min="0" max="${luna ? 10 : 90}" step="${luna ? 0.1 : 0.5}" value="${luna ? 1.5 : 30}"><span class="num" data-v="el">${luna ? '1.5' : '30.0'}°</span>
      ${polar && luna ? '<button type="button" data-a="dia" aria-pressed="false" title="Sweeps the subsolar longitude through 360° in 20 s at the current elevation">Lunar day ▶</button>' : ''}</div>
    <div class="leyenda"></div>`;
  p.modo = 'relieve'; p.capa = null; p.rangoCapa = null;
  // «Generate simulation» (&vista=suelo) entra con el color real de la imagen.
  if (p.escena.imagen && qs.get('vista') === 'suelo') {
    p.modo = 'satelite';
    p.escena.setModo('satelite');
    el.querySelectorAll('[data-modo]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.modo === 'satelite')));
  }
  el.querySelectorAll('[data-modo]').forEach((b) => b.addEventListener('click', () => {
    p.modo = b.dataset.modo;
    el.querySelectorAll('[data-modo]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    p.escena.setModo(p.modo);
    leyenda(p);
  }));
  el.querySelectorAll('[data-capa]').forEach((b) => b.addEventListener('click', () => {
    p.capa = b.dataset.capa || null;
    el.querySelectorAll('[data-capa]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    const c = p.capa ? m.capas[p.capa] : null;
    p.rangoCapa = p.escena.setCapa(p.capa, c && esBinaria(p.capa, c));
    leyenda(p);
  }));
  let pendiente = false;
  const solInput = (cual = 'az') => {
    const az = +el.querySelector('[data-sol=az]').value, ev = +el.querySelector('[data-sol=el]').value;
    el.querySelector('[data-v=az]').textContent = txtAz(az);
    el.querySelector('[data-v=el]').textContent = `${ev.toFixed(1)}°`;
    if (pendiente) return;
    pendiente = true;
    requestAnimationFrame(() => { pendiente = false; p.escena.setSol(az, ev); leyenda(p); estado.dia?.manual(p, cual); });
  };
  el.querySelectorAll('[data-sol]').forEach((i) => i.addEventListener('input', () => solInput(i.dataset.sol)));
  const dia = el.querySelector('[data-a=dia]');
  dia?.addEventListener('click', () => {
    if (p.dia) { cancelAnimationFrame(p.dia); p.dia = null; dia.setAttribute('aria-pressed', 'false'); return; }
    const azIn = el.querySelector('[data-sol=az]'), az0 = +azIn.value, t0 = performance.now();
    dia.setAttribute('aria-pressed', 'true');
    const paso = (t) => {
      const k = Math.min((t - t0) / 20000, 1);
      azIn.value = Math.round(az0 + 360 * k) % 360;
      solInput();
      if (k < 1) p.dia = requestAnimationFrame(paso); else { p.dia = null; dia.setAttribute('aria-pressed', 'false'); }
    };
    p.dia = requestAnimationFrame(paso);
  });
  p.escena.setSol(315, luna ? 1.5 : 30);
  leyenda(p);
}

const esBinaria = (nombre, c) => nombre === 'sombra_permanente' || (c.tipo === 'uint8' && /0\/1/.test(c.unidad ?? ''));

function leyenda(p) {
  const e = p.escena, partes = [];
  if (p.modo === 'satelite') {
    partes.push(e.meta.imagen?.tinte
      ? `<span class="et" data-leyenda="tinte">Tinted · one average colour of this world × light from the sun above, on the real elevation · cast shadows computed from the DEM · not an image of this place</span>`
      : `<span class="et" data-leyenda="satelite">Satellite · NASA Blue Marble colour × light from the sun above, on the real elevation · cast shadows computed from the DEM · nothing added</span>`);
  } else if (p.modo === 'relieve') {
    partes.push(`<span class="et">Relief · cast shadows computed from the DEM · ${e.meta.georef.tipo === 'estereo_polar' ? 'polar stereographic: sun grid azimuth = subsolar longitude' : 'sun azimuth clockwise from grid top'}</span>`);
  } else if (p.modo === 'cota') {
    partes.push(`<span class="et">Elevation · contours every ${e.uniforms.uCurva.value} m</span><div class="bar" style="background:${RAMPA_BASE}"></div>
      <div class="ext num"><span>${fmt(e.zmin, 0)} m</span><span>${fmt(e.zmax, 0)} m</span></div>`);
  } else {
    partes.push(`<span class="et">Slope · 5° classes</span><div class="bar" style="background:${RAMPA_BASE}"></div>
      <div class="ext num"><span>0°</span><span>22.5°</span><span>≥45°</span></div>`);
  }
  if (e.capas.agua) {
    const c = e.meta.capas.agua;
    p.clasesAgua ??= (() => {
      const k = new Map();
      for (const v of e.capas.agua) if (v >= 1) k.set(v, (k.get(v) ?? 0) + 1);
      return [...k].sort((a, b) => a[0] - b[0]).map(([v, x]) => `${claseAgua(e.meta, v)} ${(100 * x / e.capas.agua.length).toFixed(x / e.capas.agua.length < 0.001 ? 3 : 1)} %`);
    })();
    partes.push(`<div data-leyenda="agua"><span class="et"><i class="muestra-agua"></i>Water · ${esc(p.clasesAgua.join(' · ') || 'none on this terrain')} of cells · not ground</span>
      <div class="recorte"><span class="et">Source</span> ${enlaceFuente(c)}</div></div>`);
  }
  if (p.capa) {
    const c = e.meta.capas[p.capa];
    const src = `<div class="recorte"><span class="et">Source</span> ${enlaceFuente(c)}${c.origen ? ` · origin: ${esc(c.origen)}` : ''}</div>`;
    if (esBinaria(p.capa, c)) {
      partes.push(`<span class="et">${esc(NOMBRE_CAPA[p.capa] ?? p.capa)} · hatched = 1 (${esc(c.unidad)})</span>${src}`);
    } else {
      const r = p.rangoCapa;
      partes.push(`<span class="et">${esc(NOMBRE_CAPA[p.capa] ?? p.capa)} · ${esc(c.unidad)}</span><div class="bar" style="background:${RAMPA_CAPA}"></div>
        <div class="ext num"><span>${fmt(r.min, 2)}</span><span>${fmt(r.max, 2)}</span></div>${src}`);
    }
  }
  const vol = p.volatiles?.leyenda();
  if (vol) partes.push(vol);
  p.el.querySelector('.leyenda').innerHTML = partes.join('');
}

// ---------- Rótulos, escala y lectura ----------
function crearRotulos(p) {
  const capa = p.el.querySelector('.rotulos');
  p.rasgos = p.escena.rasgosEnRejilla().sort((x, y) => (y.diametro_km ?? 0) - (x.diametro_km ?? 0)).map((r) => {
    const d = document.createElement('div');
    d.className = 'rasgo';
    d.textContent = `${r.nombre}${r.diametro_km ? ` · Ø ${(+r.diametro_km).toFixed(1)} km` : ''}`;
    d.title = r.fuente ?? '';
    capa.appendChild(d);
    return { r, d };
  });
}

function trasDibujar(p) {
  const e = p.escena;
  const caja = p.el.querySelector('.lienzo').getBoundingClientRect();
  const puestos = [];
  for (const { r, d } of p.rasgos) {
    const s = e.aPantalla(e.mundoDePixel(r.px.fila, r.px.col));
    const x = s && s.x - caja.left, y = s && s.y - caja.top;
    // Rasgos de mayor a menor; uno que pisa a otro ya colocado no se rotula.
    const w = (d.offsetWidth || 120) + 8, choca = s && puestos.some((q) => x < q.x + q.w && q.x < x + w && Math.abs(y - q.y) < 14);
    if (!s || !s.dentro || choca) { d.style.display = 'none'; continue; }
    d.style.display = '';
    d.style.left = `${x}px`; d.style.top = `${y}px`;
    puestos.push({ x, y, w: d.offsetWidth });
  }
  const ppk = e.pxPorKm();
  let km = 1;
  if (ppk > 0) {
    const objetivo = 120 / ppk, p10 = 10 ** Math.floor(Math.log10(objetivo));
    km = [1, 2, 5, 10].map((k) => k * p10).reduce((a, b) => (Math.abs(b - objetivo) < Math.abs(a - objetivo) ? b : a));
  }
  p.el.querySelector('.escala').hidden = !!e.suelo;
  p.el.querySelector('.regla').style.width = `${Math.round(km * ppk)}px`;
  p.el.querySelector('.et-escala').textContent = km >= 1 ? `${km} km` : `${Math.round(km * 1000)} m`;
  posicionarMarcas(p);
  p.rutas?.dibujar();
  p.obra?.dibujar();
  p.volatiles?.dibujar();
  p.base?.dibujar();
}

function leerCursor(p, ev) {
  const g = p.escena.rayo(ev.clientX, ev.clientY);
  const set = (k, v) => { p.el.querySelector(`[data-k=${k}]`).textContent = v; };
  if (!g) { ['lat', 'lon', 'cota', 'pend', 'agua'].forEach((k) => set(k, '—')); return null; }
  const l = p.escena.leer(g.fila, g.col);
  set('lat', fmtLat(l.lat, 5)); set('lon', fmtLon(l.lon, 5));
  set('cota', Number.isFinite(l.cota) ? `${l.cota.toFixed(1)} m` : 'no data');
  set('pend', Number.isFinite(l.pendiente) ? `${l.pendiente.toFixed(1)}°` : '—');
  if (l.agua !== null) set('agua', claseAgua(p.escena.meta, l.agua));
  return g;
}

// ---------- Retoque ----------
function crearRetoque(p) {
  const e = p.escena;
  const el = p.el.querySelector('.retoque');
  const rmin = Math.max(e.m, 5), rmax = Math.max(e.ladoKm * 1000 / 8, rmin * 4);
  p.radio_m = Math.min(Math.max(250, rmin), rmax);
  const aSlider = (r) => Math.round(1000 * Math.log(r / rmin) / Math.log(rmax / rmin));
  const deSlider = (v) => rmin * (rmax / rmin) ** (v / 1000);
  el.innerHTML = `
    <div class="et">Retouch · ${esc(e.meta.id)}</div>
    <div class="botones" data-g="herr">${HERRAMIENTAS.map(([k, t]) => `<button type="button" data-herr="${k}" aria-pressed="${k === 'navegar'}">${t}</button>`).join('')}</div>
    <label><span><span class="et">Brush radius</span><span class="num" data-v="radio"></span></span><input type="range" data-i="radio" min="0" max="1000" value="${aSlider(p.radio_m)}"></label>
    <label><span><span class="et">Strength</span><span class="num" data-v="int"></span></span><input type="range" data-i="int" min="1" max="100" value="${p.intensidad * 100}"></label>
    <div class="botones"><button type="button" data-a="deshacer" title="Ctrl+Z">Undo</button><button type="button" data-a="rehacer" title="Ctrl+Shift+Z">Redo</button><button type="button" data-a="reset">Reset</button></div>
    <div class="botones"><span class="et" style="align-self:center">View</span><button type="button" data-ver="retocado" aria-pressed="true">Retouched</button><button type="button" data-ver="original" aria-pressed="false">Original</button></div>
    <dl><dt>Cells</dt><dd class="num" data-v="celdas">0</dd><dt>Cut</dt><dd class="num" data-v="exc">0 m³</dd><dt>Fill</dt><dd class="num" data-v="rel">0 m³</dd><dt>Cell area</dt><dd class="num">${fmtVol(e.m * e.m)} m²</dd></dl>
    <div class="ipex" data-v="ipex" hidden></div>
    <div class="botones"><button type="button" data-a="exportar">Export retouch</button><label class="boton">Import<input type="file" accept=".json,application/json" hidden data-a="importar"></label></div>
    <div class="estado"></div>`;
  const radioTxt = () => {
    el.querySelector('[data-v=radio]').textContent = `${Math.round(p.radio_m)} m`;
    el.querySelector('[data-v=int]').textContent = `${Math.round(p.intensidad * 100)} % · ${pasoMetros(p.radio_m, p.intensidad).toFixed(2)} m/dab`;
  };
  radioTxt();
  el.querySelector('[data-i=radio]').addEventListener('input', (ev) => { p.radio_m = deSlider(+ev.target.value); radioTxt(); });
  el.querySelector('[data-i=int]').addEventListener('input', (ev) => { p.intensidad = +ev.target.value / 100; radioTxt(); });
  el.querySelectorAll('[data-herr]').forEach((b) => b.addEventListener('click', () => elegirHerramienta(p, b.dataset.herr)));
  el.querySelectorAll('[data-ver]').forEach((b) => b.addEventListener('click', () => {
    el.querySelectorAll('[data-ver]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    e.setVerOriginal(b.dataset.ver === 'original');
    refrescarRetoque(p);
    refrescarPlantado();
  }));
  el.querySelector('[data-a=deshacer]').addEventListener('click', () => deshacer(p, false));
  el.querySelector('[data-a=rehacer]').addEventListener('click', () => deshacer(p, true));
  el.querySelector('[data-a=reset]').addEventListener('click', () => {
    if (!estadisticas(e.delta, e.m).celdas) return;
    if (!window.confirm(`Reset all retouching of "${e.meta.nombre}"? (Ctrl+Z undoes it)`)) return;
    if (p.historial.reemplazar(e.delta, new Float32Array(e.delta.length))) trasCambio(p, 'retouching reset');
  });
  el.querySelector('[data-a=exportar]').addEventListener('click', () => exportar(p));
  el.querySelector('[data-a=importar]').addEventListener('change', async (ev) => {
    const f = ev.target.files[0];
    ev.target.value = '';
    if (!f) return;
    try {
      const obj = JSON.parse(await f.text());
      const nuevo = importarRetoque(obj, { id: e.meta.id, n: e.n, sha: shaDe(p) });
      const extra = obj.plantado !== undefined ? leerPlantado(p, obj.plantado) : '';
      p.historial.reemplazar(e.delta, nuevo);
      trasCambio(p, `imported ${f.name}${extra}`);
    } catch (err) {
      estadoRetoque(p, `import failed: ${err.message}`);
    }
  });
  enganchePincel(p);
  refrescarRetoque(p);
}

function elegirHerramienta(p, h) {
  if (h !== 'navegar') modoPlantar(p, null);
  p.herramienta = h;
  p.el.querySelectorAll('[data-herr]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.herr === h)));
  p.el.classList.toggle('pintando', h !== 'navegar');
  if (h === 'navegar') p.escena.setPincel(null);
}

const estadoRetoque = (p, txt) => { p.el.querySelector('.retoque .estado').textContent = txt; };

function shaDe(p) {
  p.sha ??= sha256Hex(p.bytesAltura);
  return p.sha;
}

function refrescarRetoque(p) {
  const e = p.escena, s = estadisticas(e.delta, e.m);
  const el = p.el.querySelector('.retoque');
  el.querySelector('[data-v=celdas]').textContent = s.celdas.toLocaleString('en-US');
  el.querySelector('[data-v=exc]').textContent = `${fmtVol(s.excavado_m3)} m³`;
  el.querySelector('[data-v=rel]').textContent = `${fmtVol(s.rellenado_m3)} m³`;
  cargasIpex(p, s.excavado_m3);
  el.querySelector('[data-a=deshacer]').disabled = !p.historial.puedeDeshacer() || e.verOriginal;
  el.querySelector('[data-a=rehacer]').disabled = !p.historial.puedeRehacer() || e.verOriginal;
  el.querySelector('[data-a=reset]').disabled = !s.celdas || e.verOriginal;
  el.querySelectorAll('[data-herr]').forEach((b) => { b.disabled = e.verOriginal && b.dataset.herr !== 'navegar'; });
  if (e.verOriginal) estadoRetoque(p, 'showing the original DEM; switch to Retouched to edit');
  return s;
}

function trasCambio(p, txt) {
  p.escena.actualizarAlturas();
  p.escena.recalcularSombras();
  const s = refrescarRetoque(p);
  if (txt) estadoRetoque(p, txt);
  guardar(p, s);
  p.rutas?.terrenoCambiado();
  refrescarPlantado();
}

function deshacer(p, rehacer) {
  if (p.escena.verOriginal || p.trazo) return;
  const paso = rehacer ? p.historial.rehacer(p.escena.delta) : p.historial.deshacer(p.escena.delta);
  if (paso) trasCambio(p, `${rehacer ? 'redo' : 'undo'}: ${paso.indices.length} cells`);
}

function guardar(p, s) {
  clearTimeout(p.tGuardar);
  p.tGuardar = setTimeout(() => {
    try {
      const e = p.escena;
      if (!s.celdas) localStorage.removeItem(CLAVE(e.meta.id));
      else localStorage.setItem(CLAVE(e.meta.id), JSON.stringify(exportarRetoque(e.meta.id, e.n, shaDe(p), e.delta)));
    } catch {
      estadoRetoque(p, 'autosave unavailable in this browser (export to keep the retouch)');
    }
  }, 400);
}

function restaurar(p) {
  const e = p.escena;
  let raw = null;
  try { raw = localStorage.getItem(CLAVE(e.meta.id)); } catch { return; }
  if (!raw) return;
  try {
    const d = importarRetoque(JSON.parse(raw), { id: e.meta.id, n: e.n, sha: shaDe(p) });
    e.delta.set(d);
    e.actualizarAlturas();
    e.recalcularSombras();
    refrescarRetoque(p);
    nota(p, `autosaved retouch restored (${estadisticas(d, e.m).celdas} cells)`);
  } catch (err) {
    nota(p, `autosaved retouch ignored: ${err.message}`);
  }
}

function exportar(p) {
  const e = p.escena;
  const s = estadisticas(e.delta, e.m);
  const nPlant = p.plantados?.lista.length ?? 0;
  if (!s.celdas && !nPlant) { estadoRetoque(p, 'nothing to export: no cells retouched, nothing planted'); return; }
  const obj = exportarRetoque(e.meta.id, e.n, shaDe(p), e.delta);
  if (nPlant) obj.plantado = p.plantados.aJSON();
  const blob = new Blob([JSON.stringify(obj)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `retouch-${e.meta.id}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  estadoRetoque(p, `exported ${s.celdas} cells${nPlant ? `, ${nPlant} planted` : ''}`);
}

function enganchePincel(p) {
  const e = p.escena, cv = e.renderer.domElement;
  const toque = (g) => {
    const caja = aplicarToque({ n: e.n, m_por_px: e.m, base: e.base, delta: e.delta },
      { fila: g.fila, col: g.col, radio_m: p.radio_m, intensidad: p.intensidad, herramienta: p.herramienta, cota_objetivo: p.trazo.objetivo }, p.historial.trazo);
    if (caja) e.actualizarAlturas(caja);
  };
  cv.addEventListener('pointerdown', (ev) => {
    if (!p.ampliado || p.herramienta === 'navegar' || ev.button !== 0 || e.verOriginal) return;
    const g = e.rayo(ev.clientX, ev.clientY);
    if (!g) return;
    ev.stopImmediatePropagation(); ev.preventDefault();
    const objetivo = alturaBilineal(e.actual, e.n, g.fila, g.col);
    if (p.herramienta === 'allanar' && !Number.isFinite(objetivo)) { estadoRetoque(p, 'flatten: no elevation data where the stroke starts; start it on a cell with data'); return; }
    cv.setPointerCapture(ev.pointerId);
    p.historial.comenzar();
    p.trazo = { ultimo: g, objetivo };
    toque(g);
  }, { capture: true });
  cv.addEventListener('pointermove', (ev) => {
    const g = leerCursor(p, ev);
    if (p.ampliado && p.herramienta !== 'navegar') {
      e.setPincel(g, p.radio_m);
      if (p.trazo && g) {
        const u = p.trazo.ultimo, dist = Math.hypot(g.fila - u.fila, g.col - u.col);
        const paso = Math.max(p.radio_m / e.m / 4, 0.5);
        if (dist >= paso) {
          const k = Math.floor(dist / paso);
          for (let j = 1; j <= k; j++) toque({ fila: u.fila + (g.fila - u.fila) * j / k, col: u.col + (g.col - u.col) * j / k });
          p.trazo.ultimo = g;
        }
      }
    }
  });
  const fin = () => {
    if (!p.trazo) return;
    p.trazo = null;
    const paso = p.historial.terminar(e.delta);
    trasCambio(p, paso ? `stroke: ${paso.indices.length} cells changed` : null);
  };
  cv.addEventListener('pointerup', fin);
  cv.addEventListener('pointercancel', fin);
  cv.addEventListener('pointerleave', () => { if (!p.trazo) e.setPincel(null); });
}

// ---------- Equipo plantado ----------
const CLASE = { movilidad: 'Mobility', prospeccion: 'Prospecting', excavacion: 'Excavation', habitat: 'Habitat & landing', energia: 'Power', comunicaciones: 'Communications', cultivo: 'Crops', recursos: 'Resources' };
const VARIABLE = { pendiente_deg: 'Slope', iluminacion_frac: 'Illumination', sombra_permanente: 'Permanent shadow', temp_k: 'Temperature', horas_en_sombra: 'Hours in shadow', distancia_recorrido_km: 'Drive distance', separacion_m: 'Separation' };
const OP = { '<=': '≤', '<': '<', '>=': '≥', '>': '>' };
const LECTURA = { reproducido: 'reproduced here', infra: 'under-tested here', sobre: 'over-tested here', no_medible: 'cannot be measured on this terrain' };
const FACTOR = { vacio: 'Vacuum', polvo: 'Dust', gravedad: 'Gravity' };

const equipoDe = (id) => estado.catalogo?.equipos?.find((q) => q.id === id) ?? null;
const equipoMisionDe = (id) => (typeof id === 'string' && id.startsWith(PREFIJO) ? estado.mision?.equipos.find((q) => PREFIJO + q.id === id) ?? null : null);
const nombreCorto = (id) => { const q = equipoDe(id) ?? equipoMisionDe(id); return q ? q.nombre.replace(/\s*\(.*\)\s*$/, '') : id; };
const hostDe = (u) => { try { return new URL(u).hostname; } catch { return 'source'; } };

function fuenteYCita(x, rotulo = null) {
  if (!x?.fuente) return '<span class="tenue">no source</span>';
  const u = urlSegura(x.fuente);
  const enl = u ? `<a href="${esc(u)}" target="_blank" rel="noopener" title="${esc(x.cita ? `“${x.cita}”` : x.fuente)}">${esc(rotulo ?? hostDe(u))}</a>` : esc(x.fuente);
  const sinVer = x.verificado === true ? '' : ' <span class="tenue">(quote not verified)</span>';
  return x.cita ? `<details class="cita"><summary>${enl} <span class="ver-cita">quote</span>${sinVer}</summary><q>${esc(x.cita)}</q></details>` : `${enl}${sinVer}`;
}

function crearEquipo(p) {
  const e = p.escena;
  p.plantados = new Plantados(e.n);
  p.modelos = capaModelos(e, p.el.querySelector('.lienzo'), modeloMision);
  const btn = p.el.querySelector('.ver-paleta');
  btn.disabled = false;
  btn.addEventListener('click', () => {
    const pal = p.el.querySelector('.paleta');
    pal.hidden = !pal.hidden;
    btn.setAttribute('aria-pressed', String(!pal.hidden));
  });
  pintarPaleta(p);
  paletaMision(p);
  const cv = e.renderer.domElement;
  cv.addEventListener('pointerdown', (ev) => {
    if (!p.plantar || ev.button !== 0) return;
    ev.stopImmediatePropagation(); ev.preventDefault();
    const g = e.rayo(ev.clientX, ev.clientY);
    if (!g) return;
    const id = p.plantar;
    modoPlantar(p, null);
    const item = plantarEn(p, id, g.fila, g.col);
    // Equipo de la misión plantado a ras de suelo: la cámara se pone a unos metros, mirándolo, con su ficha abierta.
    if (e.suelo && equipoMisionDe(id)) mirarPlantado(p, item);
    plantarGemelo(p, item);
  }, { capture: true });
  restaurarPlantado(p);
}

function mirarPlantado(p, item) {
  p.modelos.sincronizar(p.plantados.lista);
  alternarSuelo(p, true);
  p.sel = item.uid;
  refrescarPlantado();
}

// ---------- Equipo espejo ----------
// El otro panel, si es de otro mundo (Luna, Tierra o Marte): ahí va el gemelo de lo que se planta aquí.
const otroPanel = (p) => estado.paneles.find((x) => x !== p && x.plantados && x.escena && x.escena.meta.cuerpo !== p.escena.meta.cuerpo) ?? null;
const gemeloDe = (p, item) => {
  const q = item?.par ? otroPanel(p) : null;
  return q ? { q, item: q.plantados.lista.find((x) => x.par === item.par) ?? null } : { q: null, item: null };
};

function plantarGemelo(p, item) {
  const q = estado.espejo ? otroPanel(p) : null;
  if (!q) return null;
  const r = celdaEspejo({ n: p.escena.n, m: p.escena.m }, { n: q.escena.n, m: q.escena.m, alturas: q.escena.mostradas }, item.fila, item.col);
  if (!r) return null;
  item.par = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const gemelo = q.plantados.plantar(item.equipo, r.fila, r.col, item.par);
  crearMarca(q, gemelo);
  q.sel = gemelo.uid;
  guardarPlantado(p);
  guardarPlantado(q);
  const av = q.el.querySelector('.aviso-espejo');
  av.textContent = `Also planted here: ${nombreCorto(item.equipo)} · ${textoDesplazamiento(r)}, as on ${CUERPO[p.escena.meta.cuerpo] ?? 'the other panel'}${r.recortado ? ' (clamped to this window)' : ''}${r.movido ? ' (moved to the nearest cell with elevation data)' : ''}`;
  av.hidden = false;
  clearTimeout(q.tEspejo);
  q.tEspejo = setTimeout(() => { av.hidden = true; }, 8000);
  if (q.escena.suelo) mirarPlantado(q, gemelo); else refrescarPlantado();
  return gemelo;
}

// «Drill here» en un panel pone también el punto en el otro, a los mismos metros del centro.
function perforarGemelo(p, perf) {
  const q = estado.espejo ? otroPanel(p) : null;
  if (!q?.volatiles) return;
  const r = celdaEspejo({ n: p.escena.n, m: p.escena.m }, { n: q.escena.n, m: q.escena.m, alturas: q.escena.mostradas }, perf.fila, perf.col);
  if (!r) return;
  q.sel = null;
  q.volatiles.perforarEn(r.fila, r.col);
  refrescarPlantado();
}

function plantarEn(p, id, fila, col) {
  const item = p.plantados.plantar(id, fila, col);
  crearMarca(p, item);
  p.sel = item.uid;
  guardarPlantado(p);
  refrescarPlantado();
  return item;
}

function pintarPaleta(p) {
  const pal = p.el.querySelector('.paleta');
  const eqs = estado.catalogo?.equipos;
  if (!Array.isArray(eqs)) {
    pal.innerHTML = `<b>equipment catalogue not found</b><span class="pista">${esc(estado.errCatalogo ?? 'expected web/data/equipo.json (python -m pipeline.exportar)')}</span>`;
    return;
  }
  const grupos = new Map();
  for (const q of eqs) { if (!grupos.has(q.clase)) grupos.set(q.clase, []); grupos.get(q.clase).push(q); }
  pal.innerHTML = `<div class="et">Plant equipment: pick one, then click the terrain</div>${[...grupos].map(([k, qs]) => `
    <div class="et clase">${esc(CLASE[k] ?? k)}</div>
    ${qs.map((q) => `<button type="button" class="item-eq" data-eq="${esc(q.id)}" aria-pressed="false">
      <span class="nom">${esc(q.nombre)}${q.origen ? ` <span class="sello-propio">own concept</span>` : ''}</span><span class="est">${esc(q.estado ?? '')}</span></button>`).join('')}`).join('')}`;
  pal.querySelectorAll('[data-eq]').forEach((b) => b.addEventListener('click', () => modoPlantar(p, p.plantar === b.dataset.eq ? null : b.dataset.eq)));
}

function modoPlantar(p, id) {
  if (!p.plantados) return;
  p.plantar = id;
  if (id) elegirHerramienta(p, 'navegar');
  p.el.classList.toggle('plantando', !!id);
  p.el.querySelectorAll('[data-eq], [data-eqm]').forEach((b) => b.setAttribute('aria-pressed', String((b.dataset.eq ?? PREFIJO + b.dataset.eqm) === id)));
  const av = p.el.querySelector('.aviso-plantar');
  av.hidden = !id;
  if (id) {
    av.innerHTML = `<span class="et">Plant</span> ${esc(nombreCorto(id))} · click the terrain · Esc cancels`;
    p.el.querySelector('.paleta').hidden = true;
    p.el.querySelector('.ver-paleta').setAttribute('aria-pressed', 'false');
  }
}

function crearMarca(p, item) {
  const d = document.createElement('div');
  d.className = 'marca';
  d.dataset.uid = item.uid;
  d.innerHTML = `<span class="pin"></span><span class="rot">${esc(nombreCorto(item.equipo))}</span>`;
  p.el.querySelector('.marcas').appendChild(d);
  const poli = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
  p.el.querySelector('.huellas').appendChild(poli);
  p.marcas.set(item.uid, { d, poli, h: huella(equipoDe(item.equipo) ?? {}) });
  const e = p.escena;
  d.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    ev.preventDefault(); ev.stopPropagation();
    p.sel = item.uid;
    const g = gemeloDe(p, item);
    if (g.item) g.q.sel = g.item.uid;
    p.arrastre = { uid: item.uid, movido: false };
    d.setPointerCapture(ev.pointerId);
    refrescarPlantado();
  });
  d.addEventListener('pointermove', (ev) => {
    if (p.arrastre?.uid !== item.uid) return;
    const g = e.rayo(ev.clientX, ev.clientY);
    if (!g) return;
    const f = Math.round(g.fila), c = Math.round(g.col);
    if (f === item.fila && c === item.col) return;
    p.plantados.mover(item.uid, f, c);
    p.arrastre.movido = true;
    refrescarPlantado();
  });
  const fin = () => {
    if (p.arrastre?.uid !== item.uid) return;
    const movido = p.arrastre.movido;
    p.arrastre = null;
    if (movido) guardarPlantado(p);
  };
  d.addEventListener('pointerup', fin);
  d.addEventListener('pointercancel', fin);
}

function quitarPlantado(p, uid, conGemelo = true) {
  const g = conGemelo ? gemeloDe(p, p.plantados.buscar(uid)) : null;
  if (g?.item) quitarPlantado(g.q, g.item.uid, false);
  if (!p.plantados.quitar(uid)) return;
  const m = p.marcas.get(uid);
  m?.d.remove(); m?.poli.remove();
  p.marcas.delete(uid);
  if (p.sel === uid) p.sel = null;
  guardarPlantado(p);
  refrescarPlantado();
}

function posicionarMarcas(p) {
  if (!p.plantados) return;
  const e = p.escena;
  p.modelos?.sincronizar(p.plantados.lista);
  const caja = p.el.querySelector('.lienzo').getBoundingClientRect();
  for (const item of p.plantados.lista) {
    const m = p.marcas.get(item.uid);
    if (!m) continue;
    const s = e.aPantalla(e.mundoDePixel(item.fila, item.col));
    m.d.style.display = s?.dentro ? '' : 'none';
    if (s?.dentro) { m.d.style.left = `${s.x - caja.left}px`; m.d.style.top = `${s.y - caja.top}px`; }
    let pts = m.h && s?.dentro ? m.h.esquinas(item.fila, item.col, e.m).map(([f, c]) => e.aPantalla(e.mundoDePixel(f, c))) : null;
    if (pts?.some((q) => !q)) pts = null;
    // Huella a escala real solo cuando ya ocupa unos píxeles en pantalla.
    const ext = pts ? Math.max(...pts.map((q) => Math.hypot(q.x - s.x, q.y - s.y))) : 0;
    m.poli.style.display = ext >= 3 ? '' : 'none';
    if (ext >= 3) m.poli.setAttribute('points', pts.map((q) => `${(q.x - caja.left).toFixed(1)},${(q.y - caja.top).toFixed(1)}`).join(' '));
    m.d.classList.toggle('con-huella', ext >= 3);
  }
}

function medidasDe(p, item) {
  const e = p.escena;
  const med = medirPunto({ n: e.n, m_por_px: e.m, alturas: e.mostradas, capas: e.capas, original: e.verOriginal }, item.fila, item.col, p.rutas?.medidasDe(item));
  med.separacion_m = {};
  for (const r of equipoDe(item.equipo)?.requisitos ?? []) {
    if (r.variable === 'separacion_m' && r.respecto_a) med.separacion_m[r.respecto_a] = medirSeparacion(p.plantados.lista, item, r.respecto_a, e.m, nombreCorto);
  }
  return med;
}

const evaluar = (p, item) => evaluarEquipo(equipoDe(item.equipo) ?? {}, medidasDe(p, item));

// Panel de la Luna y de la Tierra con el mismo equipo plantado: el seleccionado si coincide, si no el primero.
function contraparte(p, item) {
  const q = estado.paneles.find((x) => x !== p && x.plantados);
  if (!q) return { q: null, item: null };
  const cuerpos = new Set([p.escena.meta.cuerpo, q.escena.meta.cuerpo]);
  if (!(cuerpos.has('luna') && cuerpos.has('tierra'))) return { q: null, item: null };
  const sel = q.plantados.buscar(q.sel), gem = item.par ? q.plantados.lista.find((x) => x.par === item.par) : null;
  return { q, item: gem ?? (sel?.equipo === item.equipo ? sel : q.plantados.lista.find((x) => x.equipo === item.equipo) ?? null) };
}

function refrescarPlantado() {
  for (const p of estado.paneles) {
    if (!p.plantados) continue;
    for (const item of p.plantados.lista) {
      const m = p.marcas.get(item.uid);
      if (!m) continue;
      m.d.classList.toggle('rompe', p.escena.capas.agua?.[item.fila * p.escena.n + item.col] >= 1 || evaluar(p, item).some((r) => r.estado === 'rompe'));
      m.d.classList.toggle('sel', item.uid === p.sel);
    }
    pintarHoja(p);
    p.rutas?.refrescar();
    p.escena.sucio = true;
  }
  estado.dia?.refrescar();
}

function filaRequisito(r, meta) {
  const q = r.req;
  const nom = q.variable === 'separacion_m' ? `${VARIABLE.separacion_m} from ${nombreCorto(q.respecto_a)}` : q.variable === 'temp_k' ? `${VARIABLE.temp_k} (${q.op === '<=' || q.op === '<' ? 'max' : 'min'})` : (VARIABLE[q.variable] ?? q.variable);
  const lim = r.estado === 'sin_limite' ? '—' : `${OP[q.op] ?? q.op} ${cantidad(q.valor, q.unidad)}`;
  const dec = decimalesVeredicto(r, decimales(q.unidad));
  let ver;
  if (r.estado === 'ok') ver = '<b class="v-ok">OK</b>';
  else if (r.estado === 'rompe') ver = `<b class="v-rompe">BREAKS</b> <span class="num">by ${r.cota ? 'at least ' : ''}${esc(cantidad(r.exceso, q.unidad, dec))}</span>`;
  else if (r.estado === 'cota_inferior') ver = `<b class="v-cota">LOWER BOUND ONLY</b> <span class="motivo">· at least ${esc(cantidad(r.valor, q.unidad, dec))}${r.notaCota ? ` ${esc(r.notaCota)}` : ''}: cannot confirm</span>`;
  else if (r.estado === 'sin_limite') ver = `<b class="v-nm">NO LIMIT</b> <span class="motivo">${esc(r.motivo)}</span>`;
  else ver = `<b class="v-nm">NOT MEASURED HERE</b> <span class="motivo">· ${esc(r.motivo)}</span>`;
  const c = r.capa && meta.capas[r.capa], uc = c && urlSegura(c.url);
  const capa = c ? ` · ${uc ? `<a href="${esc(uc)}" target="_blank" rel="noopener" title="${esc(c.fuente)}">${esc(hostDe(uc))}</a>` : `<span title="${esc(c.fuente)}">layer source</span>`}` : '';
  return `<div class="req ${r.estado}" data-var="${esc(q.variable)}">
    <div class="cab-req"><span class="nom-req">${esc(nom)}</span><span class="num aqui">${r.cota && Number.isFinite(r.valor) ? '≥ ' : ''}${esc(cantidad(r.valor, q.unidad, dec))}</span><span class="num lim">${esc(lim)}</span></div>
    <div class="veredicto">${ver}</div>
    ${r.como ? `<div class="como">${esc(r.como)}${capa}</div>` : ''}
    ${r.adicional ? `<div class="como adicional">${esc(r.adicional.texto)} · ${fuenteYCita(r.adicional.cifra)}</div>` : ''}
    <div class="src">${esc(q.texto ?? '')} · ${fuenteYCita(q)}</div></div>`;
}

function pintarHoja(p) {
  const hoja = p.el.querySelector('.hoja');
  const item = p.plantados.buscar(p.sel);
  if (!item) { hoja.hidden = true; hoja.innerHTML = ''; return; }
  const e = p.escena, eq = equipoDe(item.equipo);
  if (!eq) {
    const q = equipoMisionDe(item.equipo);
    hoja.hidden = !q;
    if (q) pintarHojaMision(p, hoja, item, q);
    return;
  }
  const l = e.leer(item.fila, item.col), cota = e.mostradas[item.fila * e.n + item.col], retocada = e.delta[item.fila * e.n + item.col] !== 0;
  const med = medidasDe(p, item), evs = evaluarEquipo(eq, med);
  const h = p.marcas.get(item.uid)?.h;
  const cifras = eq.cifras ?? [];
  hoja.hidden = false;
  hoja.innerHTML = `
    <div class="cab-hoja"><span class="et">${esc(CUERPO[e.meta.cuerpo] ?? e.meta.cuerpo)} · ${esc(e.meta.id)} · planted</span><button type="button" data-a="cerrar" title="Close">×</button></div>
    <h3>${esc(eq.nombre)}</h3>
    ${med.agua >= 1 ? `<div class="aviso-agua" data-a="agua">On water —${esc(claseAgua(e.meta, med.agua))} in the ${enlaceAgua(e.meta)}: not ground</div>` : ''}
    <div class="tenue">${esc(eq.estado ?? '')}${eq.origen ? ' · own concept' : ''}</div>
    <div class="lugar num">${fmtLat(l.lat)} ${fmtLon(l.lon)} · elev ${fmt(cota, 1)} m${retocada ? (e.verOriginal ? ' (original view; this cell is retouched)' : ' (retouched)') : ''} · cell ${item.fila},${item.col}</div>
    ${h ? `<div class="tenue">footprint ${h.forma === 'rect' ? `${h.largo_m} × ${h.ancho_m} m` : `hexagon ${h.entre_caras_m} m across flats`} (${esc(h.cifra.texto ?? h.cifra.nombre)}) · drawn to scale when zoomed in</div>` : ''}
    <div class="botones"><button type="button" data-a="quitar">Remove</button><span class="tenue">drag the marker to move it</span></div>
    ${bloqueEspejo(p, item, (eq.requisitos ?? []).filter((r) => r.variable === 'pendiente_deg' && Number.isFinite(r.valor)).map((r) => ({ parametro: 'pendiente_grados', tipo: r.op === '>=' || r.op === '>' ? 'min' : 'max', valor: r.valor })))}
    <div class="cerca"></div>
    <div class="et">Requirements · value here vs design limit</div>
    ${evs.length ? evs.map((r) => filaRequisito(r, e.meta)).join('') : '<div class="tenue">The catalogue has no public design limit for this system.</div>'}
    <div class="obra-pad"></div>
    <div class="vol-hoja"></div>
    ${comparacion(p, item, eq, evs)}
    <details class="cifras-eq"><summary class="et">Figures (${cifras.length})</summary>${cifras.map((c) => `
      <div class="cifra"><span>${esc(c.nombre)}</span> <span class="num">${c.valor === null || c.valor === undefined ? 'not public' : esc(Array.isArray(c.valor) ? c.valor.join(' – ') : c.valor)} ${esc(c.unidad ?? '')}</span>
      ${c.texto ? `<div class="tenue">${esc(c.texto)}</div>` : ''}${c.fuente ? `<div>${fuenteYCita(c)}</div>` : ''}</div>`).join('')}</details>`;
  hoja.querySelector('[data-a=cerrar]').addEventListener('click', () => { p.sel = null; refrescarPlantado(); });
  hoja.querySelector('[data-a=quitar]').addEventListener('click', () => quitarPlantado(p, item.uid));
  (p.cerca ??= crearCerca()).montar(hoja.querySelector('.cerca'), { eq, pendiente: med.pendiente_deg, huella: h });
  p.obra?.hoja(hoja.querySelector('.obra-pad'), item, eq);
  p.volatiles?.hoja(hoja.querySelector('.vol-hoja'), item, eq);
}

// ---------- Equipo de la misión (&mision=) ----------
// Catálogo web/data/equipo_mision.json; si falta, está roto o la misión no tiene equipos, la paleta queda como siempre.
async function cargarMision() {
  if (!MISION) return null;
  try {
    const [cat, mod] = await Promise.all([cargarCatalogo('equipo_mision.json'), catalogoModelos()]);
    const equipos = equiposDeMision(cat, MISION).map((q) => ({ ...q, forma: formaPublicada(q), sustituto: sustitutoDe(q, mod.lista) }));
    return equipos.length ? { id: MISION, equipos } : null;
  } catch { return null; }
}

const volumenes = new Map();
function modeloMision(id) {
  const q = equipoMisionDe(id);
  if (!q) return null;
  if (q.sustituto) return { fichero: q.sustituto.modelo.fichero };
  if (!q.forma.forma) return null;
  if (!volumenes.has(id)) volumenes.set(id, { generado: { ...volumenPublicado(q.forma), clase: 'volumen' } });
  return volumenes.get(id);
}

const enPanelMision = (p) => !!estado.mision && p.escena?.meta.cuerpo === 'tierra';
const motivoSinForma = (f) => `${f.motivo}${f.citas.length && f.falta?.length ? ` (no ${f.falta.join(' or ')})` : ''}`;

// Límites publicados con su cita; la pendiente se compara con la de la celda (sin veredictos por mes: eso va en Calendar).
function fichaLimites(q, pend, m, donde) {
  const lim = limitesDe(q);
  if (!lim.length) return '';
  return `<div class="limites-mision" data-limites="${esc(q.id)}"><div class="et">Published limits</div>${lim.map((l) => {
    const t = l.parametro === 'pendiente_grados' && l.unidad === 'deg' ? textoPendiente(pend, l, m) : null;
    return `<div class="lim"><span class="num">${esc(l.texto)}</span> · ${fuenteYCita(l, 'source')}${l.nota ? `<div class="tenue">${esc(l.nota)}</div>` : ''}
      ${t ? `<div class="pend-mision ${t.estado}" data-pendiente="${t.estado}">${esc(t.texto)}${donde ? ` · ${esc(donde)}` : ''}</div>` : ''}</div>`;
  }).join('')}${MES ? '<div class="tenue">Month-by-month verdicts are in the Calendar tab of the results, not here.</div>' : ''}</div>`;
}

function seccionMision(p) {
  if (!enPanelMision(p)) return '';
  const e = p.escena, k = (e.n - 1) / 2, pendCentro = e.leer(k, k).pendiente;
  return `<section class="mision-eq" data-mision="${esc(estado.mision.id)}"><div class="et clase">Equipment of this mission</div>
    ${estado.mision.equipos.some((q) => q.sustituto || q.forma.forma) ? '<div class="et">Pick one, then click the terrain</div>' : ''}
    ${estado.mision.equipos.map((q) => {
      const f = q.forma, s = q.sustituto;
      if (s || f.forma) {
        const est = s ? `${s.modelo.nombre_real} model in its place` : `${f.forma === 'domo' ? 'dome' : 'box'} ${medidaTexto(medidaForma(f))} · ${f.supuesto ? 'diameter published, height assumed' : 'from published figures (see sources)'}`;
        return `<button type="button" class="item-eq" data-eqm="${esc(q.id)}" aria-pressed="false"><span class="nom">${esc(q.nombre)}</span><span class="est">${esc(est)}</span></button>`;
      }
      return `<div class="item-eq sin-dim" data-eqm-sin="${esc(q.id)}"><span class="nom">${esc(q.nombre)}</span><span class="est">${esc(motivoSinForma(f))}</span>
        ${fichaLimites(q, pendCentro, e.m, 'at the centre of the window (your place)')}</div>`;
    }).join('')}</section>`;
}

// Primero en la paleta, antes del equipo lunar.
function paletaMision(p) {
  const sec = seccionMision(p);
  if (!sec) return;
  const pal = p.el.querySelector('.paleta');
  pal.insertAdjacentHTML('afterbegin', sec);
  pal.querySelectorAll('[data-eqm]').forEach((b) => b.addEventListener('click', () => { const id = PREFIJO + b.dataset.eqm; modoPlantar(p, p.plantar === id ? null : id); }));
}

function pintarHojaMision(p, hoja, item, q) {
  const e = p.escena, l = e.leer(item.fila, item.col), f = q.forma, s = q.sustituto;
  const forma = s
    ? `<div class="rotulo-volumen" data-volumen="sustituto">${esc(s.rotulo)} · ${fuenteYCita(s.cita, 'source')}</div>
      <div><span class="num">${esc(medidaTexto(s.modelo.medida_m))}</span> <span class="tenue">(length × width × height of the 3D model) · Credit: NASA${urlSegura(s.modelo.fuente_url) ? ` · <a href="${esc(s.modelo.fuente_url)}" target="_blank" rel="noopener">model source</a>` : ''}</span></div>
      ${f.forma ? '' : `<div class="tenue">${esc(q.nombre)}: ${esc(motivoSinForma(f))}</div>`}`
    : `<div class="rotulo-volumen" data-volumen="${esc(f.forma)}">${esc(f.rotulo)}</div>
      <div><span class="num">${esc(medidaTexto(medidaForma(f)))}</span> <span class="tenue">(${f.forma === 'domo' ? 'diameter × diameter × height' : 'length × width × height'})</span></div>
      ${f.citas.map((c) => `<div class="dim">${esc(c.etiqueta)} <span class="num">${esc(c.valor)} ${esc(c.unidad)}${c.unidad === 'm' ? '' : ` (${c.m.toFixed(2)} m)`}</span> · ${fuenteYCita(c, 'source')}${c.nota ? ` <span class="tenue">${esc(c.nota)}</span>` : ''}</div>`).join('')}
      ${f.supuesto ? `<div class="supuesto-mision">${esc(f.supuesto)}</div>` : ''}`;
  hoja.innerHTML = `
    <div class="cab-hoja"><span class="et">${esc(CUERPO[e.meta.cuerpo] ?? e.meta.cuerpo)} · ${esc(e.meta.id)} · planted</span><button type="button" data-a="cerrar" title="Close">×</button></div>
    <h3>${esc(q.nombre)}</h3>
    <div class="tenue">Equipment of this mission${q.campana ? ` · ${esc(q.campana)}` : ''}</div>
    <div class="lugar num">${fmtLat(l.lat)} ${fmtLon(l.lon)} · elev ${fmt(l.cota, 1)} m · cell ${item.fila},${item.col}</div>
    ${forma}
    <div class="botones"><button type="button" data-a="quitar">Remove</button><span class="tenue">drag the marker to move it</span></div>
    ${fichaLimites(q, l.pendiente, e.m, null) || '<div class="tenue">No published operating limits in the catalogue.</div>'}
    ${bloqueEspejo(p, item, limitesDe(q))}`;
  hoja.querySelector('[data-a=cerrar]').addEventListener('click', () => { p.sel = null; refrescarPlantado(); });
  hoja.querySelector('[data-a=quitar]').addEventListener('click', () => quitarPlantado(p, item.uid));
}

// Mismo equipo en el otro mundo: qué coincide, qué no y qué no se puede medir; con la Tierra delante, lo que no reproduce.
const MUNDO = { luna: 'moon', tierra: 'earth', marte: 'mars' };
function ladoEspejo(x, it) {
  const e = x.escena, i = it.fila * e.n + it.col, capas = {};
  for (const k of ['iluminacion', 'temp_max']) if (e.capas[k]) capas[k] = e.capas[k][i];
  return { cuerpo: CUERPO[e.meta.cuerpo] ?? e.meta.cuerpo, pendiente: medidasDe(x, it).pendiente_deg, sol: { el: e.sol.el, luz: e.conSol(it.fila, it.col) }, dia: estado.dia?.de(x, it) ?? null, capas };
}

function noReproducible(a, b) {
  const ps = (estado.cuerpos?.parametros ?? []).filter((q) => q.reproducible_en_tierra === false);
  const ma = MUNDO[a.escena.meta.cuerpo], mb = MUNDO[b.escena.meta.cuerpo];
  if (mb !== 'earth' || !ps.length) return '';
  return `<div class="et">Cannot be reproduced on Earth</div>${ps.map((q) => {
    const va = q.constante?.[ma], vb = q.constante?.[mb], fa = q.fuentes?.[ma], fb = q.fuentes?.[mb];
    const enl = (f, t) => (urlSegura(f?.url) ? `<a href="${esc(f.url)}" target="_blank" rel="noopener" title="${esc(f.cita ? `“${f.cita}”` : f.texto ?? '')}">${esc(t)}</a>` : esc(t));
    const cifra = Number.isFinite(va) && Number.isFinite(vb) ? ` <span class="num">${esc(va)} ${esc(q.unidad)}</span> on ${enl(fa, CUERPO[a.escena.meta.cuerpo])}, <span class="num">${esc(vb)} ${esc(q.unidad)}</span> on ${enl(fb, 'Earth')}` : fa?.texto ? ` ${enl(fa, fa.texto.length <= 90 ? fa.texto : `${CUERPO[a.escena.meta.cuerpo]} source`)}` : '';
    return `<div class="no-ens" data-no-repro="${esc(q.id)}"><b>${esc(q.nombre)}</b>${cifra}</div>`;
  }).join('')}`;
}

function bloqueEspejo(p, item, limites) {
  const g = gemeloDe(p, item);
  if (!g.item) return '';
  // a = el otro mundo, b = la Tierra (si no hay Tierra, a = este panel).
  const tierraAqui = p.escena.meta.cuerpo === 'tierra';
  const [xa, ia, xb, ib] = tierraAqui ? [g.q, g.item, p, item] : [p, item, g.q, g.item];
  const a = ladoEspejo(xa, ia), b = ladoEspejo(xb, ib);
  const filas = filasEspejo(a, b, limites), r = resumenEspejo(filas);
  const R = [['igual', 'Matches'], ['distinto', 'Differs'], ['no_medible', 'Cannot be measured']];
  const TXT = { igual: 'matches', distinto: 'differs', no_medible: 'cannot be measured' };
  const sinDia = !a.dia || !b.dia;
  return `<section class="espejo" data-espejo="${esc(item.par)}">
    <div class="et">Same equipment on ${esc(CUERPO[g.q.escena.meta.cuerpo])} · planted by the viewer at the same offset from the window centre</div>
    <div class="resumen-espejo">${R.map(([k, t]) => `<div data-r="${k}" class="r-${k}"><b>${t}</b> ${r[k].length ? esc(r[k].join(' · ')) : '<span class="tenue">nothing</span>'}</div>`).join('')}</div>
    <table class="comp"><thead><tr><th></th><th>${esc(a.cuerpo)}</th><th>${esc(b.cuerpo)}</th><th>Reading</th></tr></thead><tbody>
    ${filas.map((f) => `<tr class="esp-${f.lectura}" data-fila="${esc(f.id)}"><td>${esc(f.nombre)}</td><td class="num">${esc(f.a)}</td><td class="num">${esc(f.b)}</td><td><b>${TXT[f.lectura]}</b>${f.nota ? `<div class="motivo">${esc(f.nota)}</div>` : ''}</td></tr>`).join('')}</tbody></table>
    <div class="tenue">matches = within a margin (own threshold, not from a source): slope ± max(${MARGEN.pendiente_deg.abs}°, ${Math.round(MARGEN.pendiente_deg.rel * 100)} %), Sun height ± ${MARGEN_SOL_DEG}°, sunlit share ± ${Math.round(MARGEN_LUZ_FRAC * 100)} % of the day. Slopes come from DEMs of ${xa.escena.m.toFixed(1)} and ${xb.escena.m.toFixed(1)} m per cell.${sinDia ? ' Sunlit share of the day: run “Day” above to compute it.' : ''}</div>
    ${noReproducible(xa, xb)}</section>`;
}

function comparacion(p, item, eq, evs) {
  const { q, item: otro } = contraparte(p, item);
  if (!q) return '';
  const luna = p.escena.meta.cuerpo === 'luna';
  const otroNombre = CUERPO[q.escena.meta.cuerpo];
  const noEns = eq.no_ensayable_tierra ?? [];
  const lista = noEns.length
    ? noEns.map((x) => `<div class="no-ens"><b>${esc(FACTOR[x.factor] ?? x.factor ?? '')}</b> ${esc(x.texto ?? '')} · ${fuenteYCita(x)}</div>`).join('')
    : '<div class="tenue">No public source states what cannot be tested on Earth for this system.</div>';
  const cab = `<div class="et">Moon vs Earth · ${esc(luna ? p.escena.meta.id : q.escena.meta.id)} vs ${esc(luna ? q.escena.meta.id : p.escena.meta.id)}</div>`;
  if (!otro) return `${cab}<div class="tenue">plant a ${esc(nombreCorto(item.equipo))} on the ${esc(otroNombre)} panel to compare</div><div class="et">Not testable on Earth (catalogue)</div>${lista}`;
  const evsOtro = evaluar(q, otro);
  const filas = evs.map((r, k) => {
    const [el, et] = luna ? [r, evsOtro[k]] : [evsOtro[k], r];
    const qq = r.req;
    if (r.estado === 'sin_limite') return `<tr><td>${esc(VARIABLE[qq.variable] ?? qq.variable)}</td><td>—</td><td>—</td><td class="tenue">no public limit</td></tr>`;
    const c = compararRequisito(qq, el, et);
    const mg = c.margen === null ? '' : ` title="within ± ${esc(cantidad(c.margen, qq.unidad, decimales(qq.unidad)))} of the Moon value counts as reproduced (own threshold)"`;
    return `<tr class="lec-${c.lectura}"><td>${esc(VARIABLE[qq.variable] ?? qq.variable)}${qq.variable === 'temp_k' ? ` ${esc(OP[qq.op] ?? qq.op)}` : ''}</td><td class="num">${esc(cantidad(c.luna, qq.unidad, decimales(qq.unidad)))}</td><td class="num">${esc(cantidad(c.tierra, qq.unidad, decimales(qq.unidad)))}</td>
      <td${mg}>${esc(LECTURA[c.lectura])}${c.motivo ? `<div class="motivo">${esc(c.motivo)}</div>` : ''}</td></tr>`;
  }).join('');
  const margenes = [...new Set(evs.map((r) => r.req.variable))].filter((v) => MARGEN[v]).map((v) => `${VARIABLE[v] ?? v} ± max(${MARGEN[v].abs}, ${Math.round(MARGEN[v].rel * 100)} %)`).join(' · ');
  const bases = evs.some((r) => r.req.variable === 'pendiente_deg') ? notaBasesPendiente(luna ? p.escena.m : q.escena.m, luna ? q.escena.m : p.escena.m) : null;
  return `${cab}${evs.length ? `<table class="comp"><thead><tr><th></th><th>Moon</th><th>Earth</th><th>Reading</th></tr></thead><tbody>${filas}</tbody></table>
    ${bases ? `<div class="motivo" data-nota="bases">${esc(bases)}</div>` : ''}
    <div class="tenue">reproduced = Earth within a margin of the Moon value; own threshold, not from a source: ${esc(margenes)}</div>` : ''}
    <div class="et">Not testable on Earth (catalogue)</div>${lista}`;
}

function guardarPlantado(p) {
  try {
    const id = p.escena.meta.id;
    if (!p.plantados.lista.length) localStorage.removeItem(CLAVE_PLANTADO(id));
    else localStorage.setItem(CLAVE_PLANTADO(id), JSON.stringify({ terreno: id, n: p.escena.n, plantado: p.plantados.aJSON() }));
  } catch {
    estadoRetoque(p, 'autosave unavailable in this browser (export to keep planted equipment)');
  }
}

function leerPlantado(p, arr) {
  const ids = new Set([...(estado.catalogo?.equipos ?? []).map((q) => q.id), ...(estado.mision?.equipos ?? []).map((q) => PREFIJO + q.id)]);
  const r = deJSON(arr, { n: p.escena.n, ids });
  for (const m of p.marcas.values()) { m.d.remove(); m.poli.remove(); }
  p.marcas.clear();
  p.plantados.lista = r.lista;
  p.sel = null;
  r.lista.forEach((item) => crearMarca(p, item));
  guardarPlantado(p);
  return `, ${r.lista.length} planted${r.ignorados ? ` (${r.ignorados} ignored)` : ''}`;
}

function restaurarPlantado(p) {
  if (!estado.catalogo) return;
  let raw = null;
  try { raw = localStorage.getItem(CLAVE_PLANTADO(p.escena.meta.id)); } catch { return; }
  if (!raw) return;
  try {
    const d = JSON.parse(raw);
    if (d.n !== p.escena.n) throw new Error(`grid size n=${d.n} does not match`);
    nota(p, `autosaved planted equipment restored${leerPlantado(p, d.plantado).replace(/^, /, ': ')}`);
  } catch (err) {
    nota(p, `autosaved planted equipment ignored: ${err.message}`);
  }
}

function cargasIpex(p, vol) {
  const caja = p.el.querySelector('[data-v=ipex]');
  const dens = (estado.constantes?.constantes ?? []).filter((c) => /^densidad_regolito/.test(c.id) && c.verificado === true && Number.isFinite(c.valor));
  const carga = equipoDe('ipex')?.cifras?.find((c) => c.nombre === 'regolito_excavado_kg' && c.verificado === true && Number.isFinite(c.valor));
  const ver = p.escena.meta.cuerpo === 'luna' && dens.length > 0 && !!carga;
  caja.hidden = !ver;
  if (!ver) return;
  const c = cargasExcavadora(vol, dens.map((d) => d.valor), carga.valor);
  const n1 = (x) => (x >= 100 ? fmtVol(x) : fmt(x, 1));
  const rho = dens.map((d) => d.valor / 1000).sort((a, b) => a - b);
  caja.innerHTML = `<span class="et">Cut ≈ IPEx loads</span> <span class="num">${c.min === c.max ? n1(c.min) : `${n1(c.min)}–${n1(c.max)}`}</span>
    <div class="tenue">cut × regolith bulk density ${rho.map((x) => x.toFixed(2)).join('–')} t/m³ (surface–below 1 m) ${fuenteYCita(dens[0])} ÷ ${fmtVol(carga.valor)} kg per IPEx reference mission ${fuenteYCita(carga)}</div>`;
}

// ---------- Ampliar ----------
function alternarAmpliado(p, forzar) {
  const nuevo = forzar ?? !p.ampliado;
  for (const q of estado.paneles) {
    q.ampliado = q === p && nuevo;
    q.el.classList.toggle('ampliado', q.ampliado);
    const b = q.el.querySelector('.ampliar');
    b.textContent = q.ampliado ? 'Back to pair' : 'Expand';
    if (!q.ampliado && q.escena) { elegirHerramienta(q, 'navegar'); }
  }
  if (nuevo) document.body.dataset.ampliado = p.lado; else delete document.body.dataset.ampliado;
  const u = new URL(location.href);
  if (nuevo && p.id) u.searchParams.set('solo', p.id); else u.searchParams.delete('solo');
  history.replaceState(null, '', u);
  for (const q of estado.paneles) q.escena?.redimensionar();
}

// Andar a ras de suelo: el panel que se tocó por última vez en esa vista.
const TECLAS = { arrowup: 'adelante', w: 'adelante', arrowdown: 'atras', s: 'atras', arrowleft: 'izquierda', a: 'izquierda', arrowright: 'derecha', d: 'derecha' };
const teclaSuelo = (ev) => {
  const t = TECLAS[ev.key.toLowerCase()], e = estado.sueloActivo?.escena;
  if (!t || !e?.suelo || ev.ctrlKey || ev.metaKey || ev.altKey || ev.target.matches?.('input, select, textarea')) return null;
  return { t, e };
};
document.addEventListener('keyup', (ev) => { const k = TECLAS[ev.key.toLowerCase()]; if (k) estado.paneles.forEach((q) => q.escena?.teclas.delete(k)); });
window.addEventListener('blur', () => estado.paneles.forEach((q) => q.escena?.teclas.clear()));

document.addEventListener('keydown', (ev) => {
  const ts = teclaSuelo(ev);
  if (ts) { ev.preventDefault(); ts.e.teclas.add(ts.t); return; }
  const enPlantar = estado.paneles.find((q) => q.plantar);
  if (ev.key === 'Escape' && enPlantar) { modoPlantar(enPlantar, null); return; }
  const p = estado.paneles.find((q) => q.ampliado);
  if (ev.key === 'Escape' && p) { alternarAmpliado(p, false); return; }
  if (!p?.escena || !(ev.ctrlKey || ev.metaKey) || ev.target.matches?.('input[type=text]')) return;
  const k = ev.key.toLowerCase();
  if (k === 'z' && !ev.shiftKey) { ev.preventDefault(); deshacer(p, false); }
  else if ((k === 'z' && ev.shiftKey) || k === 'y') { ev.preventDefault(); deshacer(p, true); }
});

// ---------- Global ----------
function enlazarCamaras() {
  let copiando = false;
  for (const p of estado.paneles) {
    if (!p.escena) continue;
    p.escena.alCambiarCamara = (e) => {
      if (!estado.enlazar || copiando || e.suelo) return;
      copiando = true;
      for (const q of estado.paneles) if (q.escena && q.escena !== e && !q.escena.suelo) q.escena.copiarCamara(e);
      copiando = false;
    };
  }
  const b = document.getElementById('enlazar');
  b.addEventListener('click', () => {
    estado.enlazar = !estado.enlazar;
    b.setAttribute('aria-pressed', String(estado.enlazar));
    const [a, c] = estado.paneles.map((p) => p.escena);
    if (estado.enlazar && a && c && !a.suelo && !c.suelo) c.copiarCamara(a);
  });
  const be = document.getElementById('espejo');
  be.hidden = !estado.paneles.some((p) => p.escena && otroPanel(p));
  be.setAttribute('aria-pressed', String(estado.espejo));
  be.addEventListener('click', () => { estado.espejo = !estado.espejo; be.setAttribute('aria-pressed', String(estado.espejo)); });
  const ex = document.getElementById('exag');
  ex.addEventListener('input', () => {
    estado.exag = +ex.value;
    document.getElementById('exag-v').textContent = `${estado.exag.toFixed(1)}×${estado.exag === 1 ? ' true scale' : ''}`;
    for (const p of estado.paneles) p.escena?.setExag(estado.exag);
  });
  document.getElementById('exag-v').textContent = '1.0× true scale';
}

function bucle() {
  for (const p of estado.paneles) {
    if (p.escena && p.el.offsetParent !== null && p.escena.dibujar()) trasDibujar(p);
  }
  requestAnimationFrame(bucle);
}

// Para el guion de capturas: gira las cámaras visibles y cuenta fotogramas.
estado.medirFps = (ms = 2000) => new Promise((ok) => {
  const vis = estado.paneles.filter((p) => p.escena && p.el.offsetParent !== null);
  const guardadas = vis.map((p) => p.escena.camara.position.clone());
  let frames = 0;
  const t0 = performance.now();
  const paso = () => {
    for (const p of vis) {
      const c = p.escena.camara.position;
      const a = 0.01, x = c.x, z = c.z;
      c.x = x * Math.cos(a) - z * Math.sin(a); c.z = x * Math.sin(a) + z * Math.cos(a);
      p.escena.camara.lookAt(p.escena.controles.target);
      p.escena.sucio = true;
    }
    frames++;
    if (performance.now() - t0 < ms) requestAnimationFrame(paso);
    else {
      vis.forEach((p, i) => { p.escena.camara.position.copy(guardadas[i]); p.escena.camara.lookAt(p.escena.controles.target); p.escena.sucio = true; });
      ok(frames / ((performance.now() - t0) / 1000));
    }
  };
  requestAnimationFrame(paso);
});

async function iniciar() {
  if (EJEMPLO) document.getElementById('banda-sintetico').hidden = false;
  const sel = await elegirIds();
  try {
    [estado.catalogo, estado.constantes] = await Promise.all([cargarCatalogo('equipo.json'), cargarCatalogo('constantes.json')]);
  } catch (e) { estado.errCatalogo = e.message; }
  estado.cuerpos = await cargarCatalogo('cuerpos/indice.json').catch(() => null);
  estado.mision = await cargarMision();
  const pa = crearPanel('a'), pb = crearPanel('b');
  estado.paneles.push(pa, pb);
  pa.id = sel.a; pb.id = sel.b;
  if (LUGAR && pa.id === ID_LUGAR) pa.el.querySelector('.tarjeta').innerHTML = '<div class="et cab">Building the terrain of your place from open elevation tiles…</div>';
  const res = await Promise.all([pa, pb].map(async (p) => {
    if (!p.id) { mostrarError(p, sel.errIndice ?? 'terrain data not found: no terrain pair in index.json'); return null; }
    try { return await obtenerDatos(p.id); } catch (e) {
      // Sin red o teselas cortadas: aviso llano y el terreno del catálogo de siempre.
      if (p.id === ID_LUGAR && sel.reserva) {
        const av = p.el.querySelector('.aviso-lugar');
        av.hidden = false;
        av.textContent = `${e.message} Your place could not be built, so this is the catalogue terrain instead.`;
        estado.avisoLugar = av.textContent;
        p.id = sel.reserva;
        try { return await obtenerDatos(p.id); } catch (e2) { mostrarError(p, e2.message); return null; }
      }
      if (p.id === ID_PUNTO) {
        document.body.dataset.unico = 'a';
        const av = pa.el.querySelector('.aviso-lugar');
        av.hidden = false;
        av.textContent = `${av.textContent ? `${av.textContent} ` : ''}The terrain of your point on ${PUNTO.mundo === 'moon' ? 'the Moon' : MUNDOS_PUNTO[PUNTO.mundo].nombre} could not be built (${String(e.message).replace(/\.$/, '')}), so your place on Earth is shown alone.`;
        estado.avisoPunto = av.textContent;
        p.id = null;
        return null;
      }
      mostrarError(p, e.message); return null;
    }
  }));
  const lados = res.filter(Boolean).map((d) => d.meta.lado_km);
  // Con el lugar del usuario la vista inicial encuadra su ventana; la otra se ve a la misma escala (recortada al centro).
  const ladoVista = res[0]?.meta.dinamico ? res[0].meta.lado_km : Math.max(...lados, 1);
  const notaEsc = document.getElementById('nota-escala');
  if (lados.length === 2 && Math.abs(lados[0] - lados[1]) > 1e-6) notaEsc.textContent = `extents differ (${lados[0]} km vs ${lados[1]} km) · shown at the same horizontal scale`;
  else if (lados.length === 2) notaEsc.textContent = `same horizontal scale · ${lados[0]} km each`;
  [pa, pb].forEach((p, i) => {
    const d = res[i];
    if (!d) return;
    try {
      p.bytesAltura = d.bytesAltura;
      p.escena = new Escena(p.el.querySelector('.lienzo'), d, ladoVista);
      rellenarTarjeta(p, d);
      crearMandos(p);
      crearRotulos(p);
      crearRetoque(p);
      restaurar(p);
      crearEquipo(p);
      const marte = d.meta.cuerpo === 'marte';
      if (!marte) p.rutas = crearRutas(p, { catalogo: estado.catalogo, equipoDe, nombreCorto, esc, fuenteYCita, plantarEn, elegirHerramienta, modoPlantar, refrescarPlantado });
      if (!marte) p.obra = crearObra(p, { catalogo: estado.catalogo, equipoDe, nombreCorto, esc, fuenteYCita, trasCambio, refrescarPlantado });
      p.volatiles = crearVolatiles(p, { catalogo: estado.catalogo, esc, fuenteYCita, nombreCorto, refrescarPlantado, modoPlantar, elegirHerramienta, leyenda, paneles: estado.paneles, alPerforar: perforarGemelo });
      if (!marte) p.base = crearBase(p, { catalogo: estado.catalogo, equipoDe, nombreCorto, esc, fuenteYCita, plantarEn, quitarPlantado, refrescarPlantado, evaluar, LECTURA, VARIABLE, OP, paneles: estado.paneles, alternarAmpliado, modoPlantar, elegirHerramienta });
      p.el.querySelector('.ampliar').disabled = false;
      // Las fichas (equipo, perforación) se abren en el panel lateral, bajo las acciones, no sobre el terreno.
      const perf = p.el.querySelector('.lienzo > .perforacion');
      if (perf) p.el.querySelector('.lado .hoja').after(perf);
      const bs = p.el.querySelector('.suelo');
      bs.disabled = false;
      p.el.querySelector('.acciones').prepend(bs);
    } catch (e) {
      console.error(e);
      mostrarError(p, `terrain could not be shown: ${p.id} (${e.message})`);
      p.escena = null;
    }
  });
  enlazarCamaras();
  const mesUrl = /^([1-9]|1[0-2])$/.test(MES ?? '') ? +MES : null;
  estado.dia = crearDia(document.getElementById('dia'), { paneles: estado.paneles, esc, nombreCorto, CUERPO, mes: mesUrl, alCambiar: refrescarPlantado });
  refrescarPlantado();
  const solo = [pa, pb].find((p) => p.id && p.id === sel.solo);
  if (solo?.escena) alternarAmpliado(solo, true);
  // «Generate simulation» entra de pie en el lugar de la Tierra (&vista=suelo), no en vista aérea.
  if (qs.get('vista') === 'suelo' && pa.escena?.meta.dinamico) alternarSuelo(pa, true);
  if (qs.get('vista') === 'suelo' && pb.escena?.meta.punto) alternarSuelo(pb, true);
  requestAnimationFrame(bucle);
  estado.listo = true;
}

iniciar();
