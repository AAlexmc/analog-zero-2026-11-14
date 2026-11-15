// Globo 3D común a la vista del mundo y a los resultados en la Tierra: girar, ampliar, clic sin arrastre,
// centrado en el hueco que deja el panel y giro animado hasta un punto.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { crearRenderer, reducirMovimiento, crearEstrellas, crearPlaneta, crearHalo, crearLuces, crearMarcador, situarMarcador } from '../portada/espacio.js';
import { latLonAVector, vectorALatLon, rayoEsfera } from './geo.js';

const RAD = Math.PI / 180;
const LAT_VISTA_MAX = 80;
const UMBRAL_PX = { mouse: 5, pen: 6, touch: 10 };

export function crearGlobo({ canvas, panel, mundo, vista0, inicial = null, alClic = null, barra = 56, arriba = null }) {
  const renderer = crearRenderer(canvas);
  const escena = new THREE.Scene();
  const camara = new THREE.PerspectiveCamera(35, 1, 0.01, 200);
  crearLuces(escena, camara);
  escena.add(crearEstrellas());
  let alListo;
  const texturaLista = new Promise((ok) => { alListo = ok; });
  const malla = crearPlaneta(mundo, renderer, { segmentos: 192, alListo: (e) => alListo(e) });
  escena.add(malla, crearHalo());
  const marcador = crearMarcador();
  marcador.visible = false;
  escena.add(marcador);

  const controles = new OrbitControls(camara, canvas);
  controles.enablePan = false;
  controles.enableDamping = true;
  controles.dampingFactor = 0.09;
  controles.minDistance = 1.25;
  // Mismo tamaño en pantalla a cualquier distancia: de cerca no tapa lo que tiene al lado.
  const tamMarcador = () => 0.0156 * Math.max(0.05, camara.position.length() - 1);

  // latMax: de cerca hace falta mirar casi desde encima del polo, o lo que hay junto a él se sale de la pantalla.
  const dirDe = ({ lat, lon }, latMax = LAT_VISTA_MAX) => {
    const v = latLonAVector(Math.max(-latMax, Math.min(latMax, lat)), lon);
    return new THREE.Vector3(v.x, v.y, v.z);
  };
  let distancia0 = 3.6;
  const reducir = reducirMovimiento();
  let anim = null;
  function mirar(objetivo, dist = camara.position.length(), latMax = LAT_VISTA_MAX) {
    const a = camara.position.clone().normalize(), b = dirDe(objetivo, latMax);
    const d0 = camara.position.length();
    if (reducir || a.lengthSq() === 0) { anim = null; camara.position.copy(b.multiplyScalar(dist)); controles.update(); return; }
    const qa = new THREE.Quaternion(), qb = new THREE.Quaternion().setFromUnitVectors(a, b), qt = new THREE.Quaternion();
    anim = { t0: performance.now(), dur: 900, f: (k) => { qt.slerpQuaternions(qa, qb, k); camara.position.copy(a.clone().applyQuaternion(qt).multiplyScalar(d0 + (dist - d0) * k)); } };
  }

  // Centro del dibujo en el hueco libre: panel a lo ancho abajo (móvil), a la izquierda o a la derecha.
  let huella = '';
  function medir() {
    const w = canvas.clientWidth, h = canvas.clientHeight, p = panel.getBoundingClientRect();
    const techo = Math.max(barra, arriba?.() ?? 0);
    const h2 = `${w}x${h}x${Math.round(p.left)}x${Math.round(p.width)}x${Math.round(p.top)}x${Math.round(techo)}`;
    if (h2 === huella) return;
    const primera = !huella;
    huella = h2;
    renderer.setSize(w, h, false);
    camara.aspect = w / h;
    let x0 = 0, x1 = w, y0 = techo, y1 = h;
    if (p.width >= w - 2) y1 = Math.max(techo + 80, p.top);
    else if (p.left + p.width / 2 < w / 2) x0 = p.right;
    else x1 = p.left;
    camara.setViewOffset(w, h, w / 2 - (x0 + x1) / 2, h / 2 - (y0 + y1) / 2, w, h);
    camara.updateProjectionMatrix();
    const rpx = 0.4 * Math.min(x1 - x0, y1 - y0);
    distancia0 = 1 / Math.sin(Math.atan((rpx / (h / 2)) * Math.tan((camara.fov * RAD) / 2)));
    controles.maxDistance = distancia0 * 1.6;
    if (primera) {
      camara.position.copy(dirDe(inicial ?? vista0 ?? { lat: 0, lon: 0 }).multiplyScalar(distancia0));
      controles.update();
    }
  }

  const rayo = new THREE.Raycaster();
  function latLonDePixel(x, y) {
    const r = canvas.getBoundingClientRect();
    rayo.setFromCamera(new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1), camara);
    const q = rayoEsfera(rayo.ray.origin, rayo.ray.direction, 1);
    return q ? vectorALatLon(q) : null;
  }

  // Clic o toque sin arrastre → alClic. Un arrastre o un pellizco no cuentan.
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
    if (!alClic || e.type !== 'pointerup' || !g.valido || Math.hypot(e.clientX - g.x, e.clientY - g.y) > (UMBRAL_PX[g.tipo] ?? 6)) return;
    const ll = latLonDePixel(e.clientX, e.clientY);
    if (ll) alClic(ll.lat, ll.lon);
  };
  canvas.addEventListener('pointerup', soltar);
  canvas.addEventListener('pointercancel', soltar);

  function aPantalla(lat, lon) {
    const v = latLonAVector(lat, lon, 1.004), w = new THREE.Vector3(v.x, v.y, v.z);
    const visible = w.clone().normalize().dot(camara.position.clone().sub(w)) > 0;
    w.project(camara);
    const r = canvas.getBoundingClientRect();
    return { x: r.left + ((w.x + 1) / 2) * r.width, y: r.top + ((1 - w.y) / 2) * r.height, visible };
  }

  // Se dibuja solo si algo cambia: gesto (con su inercia), giro animado, textura, chincheta o tamaño. Pestaña oculta: nada.
  const alDibujar = new Set();
  let pedido = 0, fotogramas = 0;
  const previa = new THREE.Vector3();
  function pedir() {
    if (pedido || document.hidden) return;
    pedido = requestAnimationFrame(dibujar);
  }
  function dibujar(ahora = performance.now()) {
    if (pedido) cancelAnimationFrame(pedido);
    pedido = 0;
    medir();
    let sigue = false;
    if (anim) {
      const k = Math.min(1, (ahora - anim.t0) / anim.dur);
      anim.f(1 - (1 - k) ** 3);
      if (k >= 1) anim = null; else sigue = true;
    }
    controles.rotateSpeed = Math.max(0.12, Math.min(1, (camara.position.length() - 1) / (distancia0 - 1)));
    previa.copy(camara.position);
    controles.update();
    if (camara.position.distanceToSquared(previa) > 1e-12) sigue = true;
    // Inercia ya invisible (< 1e-6 de radio): se descarta el resto para que no mueva la cámara en el próximo dibujo.
    else { controles._sphericalDelta.set(0, 0, 0); controles._panOffset.set(0, 0, 0); }
    if (marcador.visible) marcador.scale.setScalar(tamMarcador());
    renderer.render(escena, camara);
    fotogramas++;
    for (const cb of alDibujar) cb();
    if (sigue) pedir();
  }
  controles.addEventListener('change', pedir);
  texturaLista.then(pedir);
  new ResizeObserver(pedir).observe(canvas);
  new ResizeObserver(pedir).observe(panel);
  window.addEventListener('resize', pedir);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { pedir(); return; }
    cancelAnimationFrame(pedido);
    pedido = 0;
  });
  medir();
  pedir();

  return {
    camara, controles, escena, renderer, malla, texturaLista, latLonDePixel, aPantalla, dibujar, pedir,
    mirar: (objetivo, dist, latMax) => { mirar(objetivo, dist, latMax); pedir(); },
    alDibujar: (cb) => { alDibujar.add(cb); return () => alDibujar.delete(cb); },
    animando: () => !!anim,
    fotogramas: () => fotogramas,
    distancia0: () => distancia0,
    reiniciar: () => { mirar(vista0 ?? { lat: 0, lon: 0 }, distancia0); pedir(); },
    ponerMarcador: (lat, lon) => { situarMarcador(marcador, latLonAVector(lat, lon), tamMarcador()); pedir(); },
    camaraJSON: () => ({ proyInv: camara.projectionMatrixInverse.elements.slice(), mundo: camara.matrixWorld.elements.slice(), ancho: canvas.clientWidth, alto: canvas.clientHeight }),
  };
}
