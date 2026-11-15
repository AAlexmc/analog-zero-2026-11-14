// Portada: tres secciones con encaje vertical y un solo lienzo 3D cuyo planeta sigue al desplazamiento.
import * as THREE from 'three';
import { COLOR, webglDisponible, avisarSinWebgl, crearRenderer, reducirMovimiento, cargarMundos, crearEstrellas, crearPlaneta, crearHalo, crearLuces, crearMarcador, situarMarcador } from './espacio.js';
import { latLonAVector } from '../explorar/geo.js';

const RAD = Math.PI / 180;
const contenedor = document.getElementById('secciones');
const secciones = [...document.querySelectorAll('.seccion')];
const puntos = [...document.querySelectorAll('.indicador a')];
const az = (window.__az ??= {});
const P = (az.portada = { listo: false, webgl: false, seccion: secciones[0].id, planeta: null, texturas: {}, errores: [] });

const posicion = () => contenedor.scrollTop / Math.max(1, contenedor.clientHeight);
P.posicion = posicion;

function marcarSeccion() {
  const i = Math.max(0, Math.min(secciones.length - 1, Math.round(posicion())));
  P.seccion = secciones[i].id;
  puntos.forEach((a, k) => a.setAttribute('aria-current', String(k === i)));
}
// Desplazamiento animado a mano con el encaje apagado: el «smooth» del navegador junto al encaje se quedaba a medias.
let animS = null;
const pararAnim = () => { animS = null; contenedor.style.scrollSnapType = ''; };
function irA(i) {
  const destino = Math.max(0, Math.min(secciones.length - 1, i)) * contenedor.clientHeight;
  const desde = contenedor.scrollTop;
  pararAnim();
  if (reducirMovimiento() || Math.abs(destino - desde) < 1) { contenedor.scrollTop = destino; return; }
  const yo = (animS = {}), t0 = performance.now(), dur = 650;
  contenedor.style.scrollSnapType = 'none';
  const paso = (t) => {
    if (animS !== yo) return;
    const k = Math.min(1, (t - t0) / dur);
    contenedor.scrollTop = desde + (destino - desde) * (1 - (1 - k) ** 3);
    if (k < 1) requestAnimationFrame(paso); else pararAnim();
  };
  requestAnimationFrame(paso);
}
for (const ev of ['wheel', 'touchstart', 'pointerdown']) contenedor.addEventListener(ev, () => { if (animS) pararAnim(); }, { passive: true });
contenedor.addEventListener('scroll', marcarSeccion, { passive: true });
for (const a of [...puntos, ...document.querySelectorAll('.siguiente')]) {
  a.addEventListener('click', (e) => { e.preventDefault(); irA(secciones.findIndex((s) => `#${s.id}` === a.getAttribute('href'))); });
}
window.addEventListener('keydown', (e) => {
  if ((e.key !== 'ArrowDown' && e.key !== 'ArrowUp') || e.altKey || e.ctrlKey || e.metaKey) return;
  if (e.target.closest?.('input, textarea, select')) return;
  e.preventDefault();
  irA(Math.round(posicion()) + (e.key === 'ArrowDown' ? 1 : -1));
});
marcarSeccion();

let mundos = [];
try {
  mundos = await cargarMundos('data/cuerpos/mundos.json');
  for (const m of mundos) {
    const p = document.querySelector(`[data-credito="${m.id}"]`);
    if (p) p.textContent = `Image: ${m.credito}`;
  }
} catch (e) { P.errores.push(String(e.message ?? e)); }

if (!webglDisponible()) {
  document.body.classList.add('sin-webgl');
  avisarSinWebgl();
  P.listo = true;
} else {
  await montar3D();
}

async function montar3D() {
  const canvas = document.getElementById('espacio');
  const renderer = crearRenderer(canvas);
  const escena = new THREE.Scene();
  const camara = new THREE.PerspectiveCamera(32, 1, 0.1, 200);
  camara.position.set(0, 0, 9);
  crearLuces(escena, camara);
  const estrellas = crearEstrellas();
  escena.add(estrellas);
  P.webgl = true;

  const porId = Object.fromEntries(mundos.map((m) => [m.id, m]));
  const esperas = [];
  const planeta = (id, inclinacion, lonDeFrente) => {
    const grupo = new THREE.Group(), eje = new THREE.Group();
    const m = porId[id] ?? { id };
    esperas.push(new Promise((ok) => {
      const malla = crearPlaneta(m, renderer, { alListo: (estado) => { P.texturas[id] = estado; ok(); } });
      malla.rotation.y = (-90 - lonDeFrente) * RAD;
      eje.add(malla);
      eje.userData.malla = malla;
    }));
    eje.rotation.x = inclinacion;
    grupo.add(eje, crearHalo());
    grupo.userData.eje = eje;
    escena.add(grupo);
    return grupo;
  };
  const luna = planeta('moon', -0.42, 0);
  const marte = planeta('mars', 0.12, 70);
  const pin = crearMarcador();
  situarMarcador(pin, latLonAVector(-90, 0), 0.07);
  luna.userData.eje.userData.malla.add(pin);

  // «Más mundos»: siluetas apagadas con anillo y dos lunas.
  const mas = new THREE.Group();
  const sombra = (r, x, y) => {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), new THREE.MeshBasicMaterial({ color: COLOR.deepBlue })));
    g.add(crearHalo(COLOR.blueYonder, 1.12, 3.2));
    g.scale.setScalar(r); g.position.set(x, y, 0);
    mas.add(g);
  };
  sombra(1, 0, 0); sombra(0.22, 1.55, 0.95); sombra(0.13, -1.35, -1.05);
  const anillo = new THREE.Mesh(new THREE.RingGeometry(1.35, 1.75, 96), new THREE.MeshBasicMaterial({ color: COLOR.blueYonder, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false }));
  anillo.rotation.set(-1.2, 0.25, 0);
  mas.add(anillo);
  escena.add(mas);
  const grupos = [luna, marte, mas];

  let ancho = 0, alto = 0;
  function medir() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (w === ancho && h === alto) return;
    ancho = w; alto = h;
    renderer.setSize(w, h, false);
    camara.aspect = w / h;
    camara.updateProjectionMatrix();
  }
  const reducir = reducirMovimiento();
  let antes = performance.now(), ultimo = -Infinity, sAntes = NaN, texAntes = -1;
  P.fotogramas = 0;
  // Giro lento a ≤ 30 fps; desplazamiento, tamaño y texturas al momento; sin giro (movimiento reducido) solo si algo cambia.
  function dibujar(ahora = performance.now()) {
    const s0 = posicion(), nTex = Object.keys(P.texturas).length;
    const cambio = s0 !== sAntes || nTex !== texAntes || canvas.clientWidth !== ancho || canvas.clientHeight !== alto;
    if (!cambio && (reducir || ahora - ultimo < 1000 / 30 - 1)) return;
    ultimo = ahora; sAntes = s0; texAntes = nTex;
    medir();
    const dt = Math.min(0.1, (ahora - antes) / 1000); antes = ahora;
    const H = 2 * camara.position.z * Math.tan((camara.fov * RAD) / 2), W = H * camara.aspect;
    const ancha = camara.aspect >= 1;
    const cx = ancha ? 0.68 : 0.5, cy = ancha ? 0.52 : 0.31;
    const R = ancha ? Math.min(0.33 * H, 0.2 * W) : Math.min(0.34 * W, 0.19 * H);
    const s = posicion();
    grupos.forEach((g, i) => {
      g.position.set((cx - 0.5) * W, (0.5 - cy) * H + (s - i) * H, 0);
      g.scale.setScalar(i === 2 ? R * 0.62 : R);
      g.visible = Math.abs(s - i) < 1.1;
      if (!reducir && g.userData.eje) g.userData.eje.userData.malla.rotation.y += dt * 0.08;
    });
    if (!reducir) { mas.rotation.y += dt * 0.05; estrellas.rotation.y += dt * 0.004; }
    estrellas.position.y = s * 0.6;
    P.planeta = grupos.findIndex((g, i) => Math.abs(s - i) < 0.5) >= 0 ? ['moon', 'mars', 'more'][Math.round(s)] : null;
    renderer.render(escena, camara);
    P.fotogramas++;
  }
  P.camara = camara;
  P.grupos = grupos;
  P.dibujar = dibujar;
  renderer.setAnimationLoop(dibujar);
  document.addEventListener('visibilitychange', () => renderer.setAnimationLoop(document.hidden ? null : dibujar));
  await Promise.all(esperas);
  await document.fonts.ready;
  P.listo = true;
}
