// Vista del mundo: globo que se gira y amplía, chincheta con clic o toque, sugerencias y paso a la búsqueda en la Tierra.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { webglDisponible, crearRenderer, reducirMovimiento, cargarMundos, crearEstrellas, crearPlaneta, crearHalo, crearLuces, crearMarcador, situarMarcador } from '../portada/espacio.js';
import { latLonAVector, vectorALatLon, rayoEsfera, formatoLatLon, normLon } from './geo.js';

const RAD = Math.PI / 180;
// Vista inicial (propia): la Luna algo desde el sur para que se vea el polo; Marte de cara a Syrtis–Jezero.
const VISTA0 = { moon: { lat: -38, lon: 0 }, mars: { lat: 15, lon: 72 } };
const LAT_VISTA_MAX = 80;
const UMBRAL_PX = { mouse: 5, pen: 6, touch: 10 };

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
    $('buscar').href = `../analogos/index.html?mundo=${encodeURIComponent(m.id)}&lat=${punto.lat.toFixed(4)}&lon=${punto.lon.toFixed(4)}`;
    caja.querySelectorAll('.sugerencia').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.id === punto.sugerencia)));
    caja.dataset.titulo = 'Or try one of these:';
    verPaso(2);
    $('pista').hidden = true;
    const u = new URL(location.href);
    u.searchParams.set('lat', punto.lat.toFixed(4)); u.searchParams.set('lon', punto.lon.toFixed(4));
    history.replaceState(null, '', u);
    if (V.marcador) situarMarcador(V.marcador, latLonAVector(punto.lat, punto.lon), V.tamMarcador());
    for (const cb of oyentes) { try { cb(az.explorar.punto); } catch (e) { V.errores.push(String(e.message ?? e)); } }
  };
  V.fijarPunto = fijarPunto;

  let irA = (s) => fijarPunto(s.lat, s.lon, s);
  const latQ = Number(q.get('lat')), lonQ = Number(q.get('lon'));
  const inicial = q.get('lat') !== null && q.get('lon') !== null && Math.abs(latQ) <= 90 && Math.abs(lonQ) <= 180 ? { lat: latQ, lon: lonQ } : null;

  if (!webglDisponible()) {
    document.body.classList.add('sin-webgl');
    $('pista').textContent = 'This browser cannot draw the 3D globe. Pick one of the places below.';
    if (inicial) fijarPunto(inicial.lat, inicial.lon);
    V.listo = true;
    return;
  }

  const renderer = crearRenderer(canvas);
  const escena = new THREE.Scene();
  const camara = new THREE.PerspectiveCamera(35, 1, 0.01, 200);
  crearLuces(escena, camara);
  escena.add(crearEstrellas());
  let alListo;
  const texturaLista = new Promise((ok) => { alListo = ok; });
  const globo = crearPlaneta(m, renderer, { segmentos: 192, alListo: (e) => { V.textura = e; alListo(); } });
  escena.add(globo, crearHalo());
  const marcador = crearMarcador();
  marcador.visible = false;
  escena.add(marcador);
  V.marcador = marcador;

  const controles = new OrbitControls(camara, canvas);
  controles.enablePan = false;
  controles.enableDamping = true;
  controles.dampingFactor = 0.09;
  controles.minDistance = 1.25;
  V.tamMarcador = () => 0.012 * camara.position.length();

  const dirDe = ({ lat, lon }) => {
    const v = latLonAVector(Math.max(-LAT_VISTA_MAX, Math.min(LAT_VISTA_MAX, lat)), lon);
    return new THREE.Vector3(v.x, v.y, v.z);
  };
  let distancia0 = 3.6;
  const reducir = reducirMovimiento();
  let anim = null;
  function mirar(objetivo, dist = camara.position.length()) {
    const a = camara.position.clone().normalize(), b = dirDe(objetivo);
    const d0 = camara.position.length();
    if (reducir || a.lengthSq() === 0) { camara.position.copy(b.multiplyScalar(dist)); controles.update(); return; }
    const qa = new THREE.Quaternion(), qb = new THREE.Quaternion().setFromUnitVectors(a, b), qt = new THREE.Quaternion();
    anim = { t0: performance.now(), dur: 900, f: (k) => { qt.slerpQuaternions(qa, qb, k); camara.position.copy(a.clone().applyQuaternion(qt).multiplyScalar(d0 + (dist - d0) * k)); } };
  }
  irA = (s) => { fijarPunto(s.lat, s.lon, s); mirar(s); };

  // Desplaza el centro del dibujo para que el globo quede en el hueco que deja el panel.
  let ancho = 0, alto = 0, huella = '';
  function medir() {
    const w = canvas.clientWidth, h = canvas.clientHeight, p = $('panel').getBoundingClientRect();
    const movil = w <= 760 || w / h <= 1;
    const h2 = `${w}x${h}x${Math.round(p.height)}x${movil}`;
    if (h2 === huella) return;
    const primera = !huella;
    huella = h2; ancho = w; alto = h;
    renderer.setSize(w, h, false);
    camara.aspect = w / h;
    const barra = 56;
    const dx = movil ? 0 : Math.round(p.right / 2);
    const dy = movil ? Math.round((h - p.top) / 2 - barra / 2) : -Math.round(barra / 2);
    camara.setViewOffset(w, h, -dx, dy, w, h);
    camara.updateProjectionMatrix();
    const libreW = movil ? w : w - p.right, libreH = movil ? p.top - barra : h - barra;
    const rpx = 0.4 * Math.min(libreW, libreH);
    distancia0 = 1 / Math.sin(Math.atan((rpx / (h / 2)) * Math.tan((camara.fov * RAD) / 2)));
    controles.maxDistance = distancia0 * 1.6;
    if (primera) {
      camara.position.copy(dirDe(inicial ?? VISTA0[m.id] ?? { lat: 0, lon: 0 }).multiplyScalar(distancia0));
      controles.update();
    }
  }
  V.reiniciar = () => mirar(VISTA0[m.id] ?? { lat: 0, lon: 0 }, distancia0);
  $('reiniciar').addEventListener('click', V.reiniciar);

  // Clic o toque sin arrastre → chincheta. Un arrastre o un pellizco no la mueven.
  const activos = new Map();
  let gesto = null;
  canvas.addEventListener('pointerdown', (e) => {
    activos.set(e.pointerId, true);
    if (activos.size === 1) gesto = { x: e.clientX, y: e.clientY, tipo: e.pointerType, valido: true };
    else if (gesto) gesto.valido = false;
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!gesto || !activos.has(e.pointerId)) return;
    if (Math.hypot(e.clientX - gesto.x, e.clientY - gesto.y) > (UMBRAL_PX[gesto.tipo] ?? 6)) { gesto.valido = false; canvas.classList.add('arrastrando'); }
  });
  const soltar = (e) => {
    activos.delete(e.pointerId);
    canvas.classList.remove('arrastrando');
    if (!gesto || activos.size) return;
    const g = gesto; gesto = null;
    if (e.type !== 'pointerup' || !g.valido || Math.hypot(e.clientX - g.x, e.clientY - g.y) > (UMBRAL_PX[g.tipo] ?? 6)) return;
    const ll = latLonDePixel(e.clientX, e.clientY);
    if (ll) fijarPunto(ll.lat, ll.lon);
  };
  canvas.addEventListener('pointerup', soltar);
  canvas.addEventListener('pointercancel', soltar);

  const rayo = new THREE.Raycaster();
  function latLonDePixel(x, y) {
    const r = canvas.getBoundingClientRect();
    rayo.setFromCamera(new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1), camara);
    const p = rayoEsfera(rayo.ray.origin, rayo.ray.direction, 1);
    return p ? vectorALatLon(p) : null;
  }

  function dibujar(ahora = performance.now()) {
    medir();
    if (anim) {
      const k = Math.min(1, (ahora - anim.t0) / anim.dur);
      anim.f(1 - (1 - k) ** 3);
      if (k >= 1) anim = null;
    }
    controles.rotateSpeed = Math.max(0.12, Math.min(1, (camara.position.length() - 1) / (distancia0 - 1)));
    controles.update();
    if (marcador.visible) marcador.scale.setScalar(V.tamMarcador());
    renderer.render(escena, camara);
  }
  renderer.setAnimationLoop(dibujar);

  Object.assign(V, {
    camara, controles, latLonDePixel,
    animando: () => !!anim,
    aPantalla(lat, lon) {
      const v = latLonAVector(lat, lon, 1.004), w = new THREE.Vector3(v.x, v.y, v.z);
      const visible = w.clone().normalize().dot(camara.position.clone().sub(w)) > 0;
      w.project(camara);
      const r = canvas.getBoundingClientRect();
      return { x: r.left + ((w.x + 1) / 2) * r.width, y: r.top + ((1 - w.y) / 2) * r.height, visible };
    },
    camaraJSON: () => ({ proyInv: camara.projectionMatrixInverse.elements.slice(), mundo: camara.matrixWorld.elements.slice(), ancho: canvas.clientWidth, alto: canvas.clientHeight }),
  });
  if (inicial) fijarPunto(inicial.lat, inicial.lon);
  dibujar();
  await texturaLista;
  await document.fonts.ready;
  V.listo = true;
}
