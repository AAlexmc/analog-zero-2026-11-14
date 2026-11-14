// Vista 3D del relieve local: malla con la imagen o el sombreado encima, chincheta, celda comparada, norte, escala,
// exageración vertical y OrbitControls. Dibuja solo cuando algo cambia.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { crearRenderer } from '../portada/espacio.js';
import { cargarRelieve } from './datos.js';
import { sombreado, colorear, estadisticas, exageracionDefecto, barraEscala, contornoCelda, bilineal, formatoMetros, LADO_KM } from './calculo.js';

// Sol propio: alto del noroeste en la Tierra (sobre la foto), bajo del oeste en la Luna y Marte (resalta cráteres).
const SOL = { earth: { acimut: 315, elevacion: 40, base: 0.35, fuerza: 0.65 }, otro: { acimut: 270, elevacion: 20, base: 0.1, fuerza: 0.85 } };
const AMARILLO = 0xeafe07;

const el = (tag, props = {}, ...hijos) => { const e = Object.assign(document.createElement(tag), props); e.append(...hijos.filter((h) => h !== null && h !== undefined)); return e; };

// Carga primero (si falla, lanza el mensaje llano y no toca el contenedor) y luego monta la vista.
// accion (opcional): { texto, href } → botón principal bajo el título (p. ej. «Generate simulation»).
export async function abrirRelieve(contenedor, { mundo, lat, lon, lado_km = LADO_KM, titulo, celda = null, alVolver = null, accion = null }) {
  const d = await cargarRelieve({ mundo, lat, lon, lado_km });
  const est = estadisticas(d.z, d.n);
  const sol = SOL[mundo] ?? SOL.otro;
  const n = d.n, medio = (n - 1) / 2, paso_km = d.paso / 1000, lado_km_real = d.lado_m / 1000;
  const zRef = Number.isFinite(est.centro) ? est.centro : est.min;
  const z = Float32Array.from(d.z, (v) => (Number.isFinite(v) ? v : est.min));
  let exag = exageracionDefecto(est.desnivel, d.lado_m);

  const canvas = el('canvas', { className: 'relieve-lienzo', ariaLabel: `3D terrain around ${titulo}. Drag to turn, scroll or pinch to zoom.` });
  const cifra = (rotulo, valor, clave) => { const s = el('strong', { className: 'marca-num', textContent: valor }); s.dataset.v = clave; return el('span', { className: 'cifra' }, `${rotulo} `, s); };
  const volver = el('button', { type: 'button', className: 'marca-boton secundario relieve-volver', textContent: '← Back to globe' });
  const deslizador = el('input', { type: 'range', min: '1', max: '5', step: '1', value: String(exag), ariaLabel: 'Vertical exaggeration' });
  const rotuloExag = el('output', { className: 'marca-num', textContent: `vertical ×${exag}` });
  const flecha = el('span', { className: 'relieve-flecha', ariaHidden: 'true', textContent: '▲' });
  const barra = el('span', { className: 'relieve-barra' }), textoBarra = el('span', { className: 'marca-num' });
  const raiz = el('div', { className: 'relieve' },
    canvas,
    el('div', { className: 'relieve-cabecera marca-panel' },
      volver,
      el('h2', { className: 'marca-titulo relieve-titulo', textContent: titulo }),
      el('p', { className: 'relieve-cifras' }, cifra('Elevation at the pin', formatoMetros(est.centro), 'altitud'),
        cifra(`Relief in this ${Math.round(lado_km_real)} km window`, formatoMetros(est.desnivel), 'desnivel')),
      el('p', { className: 'relieve-fuente', textContent: `Read from ${d.rotulos.altura}.` }),
      accion ? el('a', { className: 'marca-boton relieve-accion', href: accion.href, textContent: accion.texto }) : null,
      celda ? el('p', { className: 'relieve-celda' }, el('span', { className: 'muestra', ariaHidden: 'true' }), 'Outline: the 0.5° cell we compared') : null),
    el('div', { className: 'relieve-pie' },
      el('div', { className: 'relieve-mandos marca-panel' },
        el('label', { className: 'relieve-exag' }, el('span', { textContent: 'Vertical exaggeration' }), deslizador, rotuloExag),
        el('span', { className: 'relieve-norte', title: 'North' }, flecha, el('span', { textContent: 'N' })),
        el('span', { className: 'relieve-escala' }, barra, textoBarra)),
      el('div', { className: 'relieve-creditos marca-panel' }, el('p', { className: 'relieve-imagen', textContent: `Image: ${d.rotulos.imagen}.` }), ...d.creditos.map((t) => el('p', { textContent: t })))));

  // Malla: X al este, Y arriba, −Z al norte; unidades en km.
  const pos = new Float32Array(n * n * 3), uv = new Float32Array(n * n * 2);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const i = r * n + c;
    pos[3 * i] = (c - medio) * paso_km; pos[3 * i + 2] = (r - medio) * paso_km;
    uv[2 * i] = c / (n - 1); uv[2 * i + 1] = 1 - r / (n - 1);
  }
  const indices = new Uint32Array((n - 1) * (n - 1) * 6);
  let k = 0;
  for (let r = 0; r < n - 1; r++) for (let c = 0; c < n - 1; c++) {
    const a = r * n + c, b = a + 1, e = a + n, f = e + 1;
    indices.set([a, e, b, b, e, f], k); k += 6;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  const lienzoTex = el('canvas', { width: n, height: n });
  const tex = new THREE.CanvasTexture(lienzoTex);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const malla = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex }));

  const altura = (v) => ((v - zRef) / 1000) * exag;
  const alto_km = lado_km_real * 0.07;
  const chincheta = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: AMARILLO });
  const palo = new THREE.Mesh(new THREE.CylinderGeometry(lado_km_real * 0.0018, lado_km_real * 0.0018, alto_km, 8), mat);
  palo.position.y = alto_km / 2;
  const cabeza = new THREE.Mesh(new THREE.SphereGeometry(lado_km_real * 0.008, 16, 12), mat);
  cabeza.position.y = alto_km;
  chincheta.add(palo, cabeza);

  let linea = null, contorno = null;
  if (celda) {
    contorno = contornoCelda(celda.lat, celda.lon, lat, lon, d.R).map((p) => ({ x: p.x / 1000, zn: -p.y / 1000, col: p.x / d.paso + medio, fila: -p.y / d.paso + medio }));
    linea = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: AMARILLO }));
  }

  function aplicarExag() {
    for (let i = 0; i < n * n; i++) pos[3 * i + 1] = altura(z[i]);
    geo.attributes.position.needsUpdate = true;
    geo.computeBoundingSphere();
    const luz = sombreado(z, n, d.paso, exag, sol.acimut, sol.elevacion);
    const s = 1 / Math.sin((sol.elevacion * Math.PI) / 180);
    for (let i = 0; i < luz.length; i++) luz[i] = sol.base + sol.fuerza * luz[i] * s;
    lienzoTex.getContext('2d').putImageData(new ImageData(colorear(luz, d.imagen, d.tono), n, n), 0, 0);
    tex.needsUpdate = true;
    chincheta.position.y = altura(z[medio * n + medio]);
    if (linea) {
      const p = [];
      for (const q of contorno) {
        const v = bilineal(z, n, n, Math.max(0, Math.min(n - 1, q.col)), Math.max(0, Math.min(n - 1, q.fila)));
        p.push(q.x, altura(v) + lado_km_real * 0.002, q.zn);
      }
      linea.geometry.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
      linea.geometry.computeBoundingSphere();
    }
    rotuloExag.textContent = `vertical ×${exag}`;
  }

  const renderer = crearRenderer(canvas);
  const escena = new THREE.Scene();
  escena.add(malla, chincheta);
  if (linea) escena.add(linea);
  const camara = new THREE.PerspectiveCamera(40, 1, lado_km_real * 0.001, lado_km_real * 20);
  const controles = new OrbitControls(camara, canvas);
  controles.enableDamping = false;
  controles.maxPolarAngle = Math.PI * 0.47;
  controles.minDistance = lado_km_real * 0.04;
  controles.maxDistance = lado_km_real * 3;
  aplicarExag();
  controles.target.set(0, chincheta.position.y, 0);
  camara.position.set(0, chincheta.position.y + lado_km_real * 0.62, lado_km_real * 0.82);
  controles.update();

  const R = (window.__az ??= {}).relieve ??= {};
  Object.assign(R, { dibujos: 0, exag, centro: est.centro, desnivel: est.desnivel, fuente: d.fuente, descarga_bytes: d.descarga_bytes, teselas: d.teselas ?? null, lado_m: d.lado_m, camara, controles });

  const v = new THREE.Vector3(), w = new THREE.Vector3(), derecha = new THREE.Vector3();
  const aPantalla = (p) => { v.copy(p).project(camara); return { x: (v.x + 1) / 2 * canvas.clientWidth, y: (1 - v.y) / 2 * canvas.clientHeight }; };
  function rotulos() {
    const t = controles.target, o = aPantalla(t), u = lado_km_real * 0.05;
    const nn = aPantalla(w.copy(t).add(new THREE.Vector3(0, 0, -u)));
    flecha.style.transform = `rotate(${Math.atan2(nn.x - o.x, o.y - nn.y)}rad)`;
    derecha.setFromMatrixColumn(camara.matrixWorld, 0).setY(0).normalize();
    const e = aPantalla(w.copy(t).addScaledVector(derecha, u));
    const b = barraEscala(Math.hypot(e.x - o.x, e.y - o.y) / u, 140);
    barra.style.width = `${b.px}px`;
    textoBarra.textContent = `${b.km} km`;
  }
  let pendiente = false, vivo = true;
  function pedir() {
    if (pendiente || !vivo) return;
    pendiente = true;
    requestAnimationFrame(() => {
      pendiente = false;
      if (!vivo) return;
      renderer.render(escena, camara);
      rotulos();
      R.dibujos++;
    });
  }
  function medir() {
    const ww = canvas.clientWidth, hh = canvas.clientHeight;
    if (!ww || !hh) return;
    renderer.setSize(ww, hh, false);
    camara.aspect = ww / hh;
    camara.updateProjectionMatrix();
    pedir();
  }
  controles.addEventListener('change', pedir);
  deslizador.addEventListener('input', () => {
    const y0 = chincheta.position.y;
    exag = Number(deslizador.value);
    aplicarExag();
    const dy = chincheta.position.y - y0;
    controles.target.y += dy; camara.position.y += dy;
    controles.update();
    R.exag = exag;
    pedir();
  });
  const obs = new ResizeObserver(medir);

  contenedor.replaceChildren(raiz);
  obs.observe(canvas);
  medir();

  function cerrar() {
    if (!vivo) return;
    vivo = false;
    obs.disconnect();
    controles.dispose();
    geo.dispose(); tex.dispose(); malla.material.dispose(); mat.dispose(); palo.geometry.dispose(); cabeza.geometry.dispose();
    linea?.geometry.dispose(); linea?.material.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    raiz.remove();
    R.camara = R.controles = null;
  }
  volver.addEventListener('click', () => { cerrar(); alVolver?.(); });
  return { cerrar, datos: d, est, volver };
}
