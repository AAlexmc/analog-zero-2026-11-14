// Vista del mundo: globo que se gira y amplía, chincheta con clic o toque, sugerencias y paso a la búsqueda en la Tierra.
import { webglDisponible, cargarMundos } from '../portada/espacio.js';
import { formatoLatLon, normLon } from './geo.js';
import { crearGlobo } from './globo.js';
import { cargar } from '../buscar/motor.js';
import { formatoValor, celsius, partesSup } from '../analogos/metricas.js';

// Vista inicial (propia): la Luna algo desde el sur para que se vea el polo; Marte de cara a Syrtis–Jezero.
const VISTA0 = { moon: { lat: -38, lon: 0 }, mars: { lat: 15, lon: 72 } };

const $ = (id) => document.getElementById(id);
const q = new URLSearchParams(location.search);
const idMundo = q.get('mundo');
const az = (window.__az ??= {});
const V = (az.vista = { listo: false, errores: [], textura: null });
const oyentes = new Set();
let punto = null;
az.explorar = {
  mundo: idMundo,
  get punto() { return punto ? { lat: punto.lat, lon: punto.lon } : null; },
  alCambiar(cb) { oyentes.add(cb); return () => oyentes.delete(cb); },
};

// Capas globales en segundo plano para «What it is like there»; si no han llegado, nada espera por ellas.
V.motor = 'cargando';
const motorP = cargar('../data/cuerpos/').then((M) => { V.motor = 'ok'; return M; }, (e) => { V.motor = 'error'; V.errores.push(String(e.message ?? e)); return null; });
const AMBIENTE = [
  ['t_max_k', 'Daily high', (v) => celsius(v)],
  ['t_min_k', 'Daily low', (v) => celsius(v)],
  ['rugosidad_tan', 'Terrain roughness', (v) => formatoValor(v, '1 (tangent)')],
  ['gravedad_m_s2', 'Gravity', (v) => formatoValor(v, 'm/s2')],
];
async function pintarAmbiente(cuerpo, lat, lon) {
  const caja = $('ambiente');
  caja.hidden = true;
  const M = await motorP;
  if (!M || punto?.lat !== lat || punto?.lon !== lon) return;
  const { valores } = M.leerPunto(cuerpo, lat, lon);
  V.ambiente = { lat, lon, valores };
  $('ambiente-valores').replaceChildren(...AMBIENTE.flatMap(([id, et, f]) => {
    const dt = document.createElement('dt'), dd = document.createElement('dd');
    dt.textContent = et; dd.className = 'marca-num'; dd.dataset.id = id;
    dd.append(...partesSup(f(valores[id])).map((x) => (x.sup ? Object.assign(document.createElement('sup'), { textContent: x.sup }) : x.t)));
    return [dt, dd];
  }));
  caja.hidden = false;
}

let mundo = null;
try {
  mundo = (await cargarMundos('../data/cuerpos/mundos.json')).find((m) => m.id === idMundo && m.rol === 'destino') ?? null;
} catch (e) { V.errores.push(String(e.message ?? e)); }

const pasos = [...document.querySelectorAll('.paso')];
const verPaso = (k) => pasos.forEach((s) => { s.hidden = s.dataset.paso !== String(k); });

if (!mundo) {
  document.body.classList.add('sin-mundo');
  $('nombre-mundo').textContent = 'Unknown world';
  verPaso('sin-mundo');
  V.listo = true;
} else {
  document.title = `Analog Zero · ${mundo.nombre}`;
  $('nombre-mundo').textContent = mundo.nombre;
  $('credito').textContent = `Image: ${mundo.credito}`;
  await montar(mundo);
}

async function montar(m) {
  const caja = $('sugerencias');
  for (const s of m.sugerencias) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `sugerencia${s.base_nasa ? ' base' : ''}`;
    b.dataset.id = s.id;
    b.setAttribute('aria-pressed', 'false');
    b.textContent = s.nombre;
    if (s.nota) { const n = document.createElement('small'); n.textContent = s.nota; b.append(n); }
    b.addEventListener('click', () => irA(s));
    caja.append(b);
  }

  const canvas = $('globo');
  const fijarPunto = (lat, lon, sug = null) => {
    punto = { lat, lon: lon > -180 && lon <= 180 ? lon : normLon(lon), sugerencia: sug?.id ?? null };
    const f = formatoLatLon(punto.lat, punto.lon);
    $('lat').textContent = f.lat; $('lon').textContent = f.lon;
    $('nombre-punto').textContent = sug ? sug.nombre : 'Your pin';
    const cifra = (v) => (sug ? String(v) : v.toFixed(4));
    $('buscar').href = `../analogos/index.html?mundo=${encodeURIComponent(m.id)}&lat=${cifra(punto.lat)}&lon=${cifra(punto.lon)}${sug ? `&nombre=${encodeURIComponent(sug.nombre)}` : ''}`;
    caja.querySelectorAll('.sugerencia').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.id === punto.sugerencia)));
    caja.dataset.titulo = 'Or try one of these:';
    verPaso(2);
    $('pista').hidden = true;
    const u = new URL(location.href);
    u.searchParams.set('lat', punto.lat.toFixed(4)); u.searchParams.set('lon', punto.lon.toFixed(4));
    history.replaceState(null, '', u);
    V.ponerMarcador?.(punto.lat, punto.lon);
    pintarAmbiente(m.id, punto.lat, punto.lon);
    for (const cb of oyentes) { try { cb(az.explorar.punto); } catch (e) { V.errores.push(String(e.message ?? e)); } }
  };
  V.fijarPunto = fijarPunto;

  let irA = (s) => fijarPunto(s.lat, s.lon, s);
  const latQ = Number(q.get('lat')), lonQ = Number(q.get('lon'));
  const inicial = q.get('lat') !== null && q.get('lon') !== null && Math.abs(latQ) <= 90 && Math.abs(lonQ) <= 180 ? { lat: latQ, lon: lonQ } : null;
  const sugInicial = inicial && m.sugerencias.find((s) => Math.abs(s.lat - inicial.lat) < 1e-4 && Math.abs(s.lon - inicial.lon) < 1e-4);
  const fijarInicial = () => (sugInicial ? fijarPunto(sugInicial.lat, sugInicial.lon, sugInicial) : fijarPunto(inicial.lat, inicial.lon));

  if (!webglDisponible()) {
    document.body.classList.add('sin-webgl');
    $('pista').textContent = 'This browser cannot draw the 3D globe. Pick one of the places below.';
    if (inicial) fijarInicial();
    V.listo = true;
    return;
  }

  const G = crearGlobo({ canvas, panel: $('panel'), mundo: m, vista0: VISTA0[m.id], inicial, alClic: (lat, lon) => fijarPunto(lat, lon) });
  V.ponerMarcador = G.ponerMarcador;
  irA = (s) => { fijarPunto(s.lat, s.lon, s); G.mirar(s); };
  V.reiniciar = G.reiniciar;
  $('reiniciar').addEventListener('click', V.reiniciar);
  Object.assign(V, { camara: G.camara, controles: G.controles, latLonDePixel: G.latLonDePixel, animando: G.animando, aPantalla: G.aPantalla, camaraJSON: G.camaraJSON });
  if (inicial) fijarInicial();
  G.dibujar();
  V.textura = await G.texturaLista;
  await document.fonts.ready;
  V.listo = true;
}
