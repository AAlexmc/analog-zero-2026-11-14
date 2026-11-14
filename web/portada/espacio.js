// Piezas 3D comunes a la portada y a la vista del mundo: estrellas, planeta con textura, halo y luces.
import * as THREE from 'three';

export const COLOR = {
  blueYonder: 0x2e96f5, neonBlue: 0x0960e1, electricBlue: 0x0042a6, deepBlue: 0x07173f,
  martianRed: 0x8e1100, neonYellow: 0xeafe07, white: 0xffffff,
};
// Color plano mientras no hay textura (o si falta el fichero).
const PLANO = { mars: COLOR.martianRed };

export function webglDisponible() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch { return false; }
}

export function crearRenderer(canvas) {
  const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  r.setClearColor(0x000000, 0);
  r.outputColorSpace = THREE.SRGBColorSpace;
  return r;
}

export const reducirMovimiento = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

export async function cargarMundos(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`worlds manifest: HTTP ${r.status}`);
  const j = await r.json();
  return j.mundos.map((m) => ({ ...m, texturaURL: new URL(m.textura, r.url).href }));
}

// Puntos sobre una esfera grande, reparto fijo (generador con semilla) para que las capturas se repitan.
export function crearEstrellas(n = 2400, radio = 60, semilla = 7) {
  let s = semilla >>> 0;
  const azar = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const grupo = new THREE.Group();
  const capas = [[0.8, 0.55, n * 0.7, COLOR.white], [1.6, 0.85, n * 0.25, COLOR.white], [2.4, 0.9, n * 0.05, COLOR.blueYonder]];
  for (const [tam, opac, cuantas, color] of capas) {
    const pos = new Float32Array(Math.round(cuantas) * 3);
    for (let i = 0; i < pos.length; i += 3) {
      const u = 2 * azar() - 1, a = 2 * Math.PI * azar(), h = Math.sqrt(1 - u * u), r = radio * (0.85 + 0.3 * azar());
      pos[i] = r * h * Math.cos(a); pos[i + 1] = r * u; pos[i + 2] = r * h * Math.sin(a);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    grupo.add(new THREE.Points(g, new THREE.PointsMaterial({ color, size: tam, sizeAttenuation: false, transparent: true, opacity: opac, depthWrite: false })));
  }
  return grupo;
}

// Esfera de radio 1 en el marco de geo.js; la textura entra cuando carga. Sin textura: color plano, sin aviso.
export function crearPlaneta(mundo, renderer, { segmentos = 128, alListo } = {}) {
  const mat = new THREE.MeshLambertMaterial({ color: PLANO[mundo.id] ?? COLOR.white });
  const malla = new THREE.Mesh(new THREE.SphereGeometry(1, segmentos, segmentos / 2), mat);
  malla.name = mundo.id;
  const fin = (estado) => { malla.userData.textura = estado; alListo?.(estado); };
  if (!mundo.texturaURL) { fin('sin textura'); return malla; }
  new THREE.TextureLoader().load(mundo.texturaURL, (t) => {
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    mat.map = t; mat.color.set(COLOR.white); mat.needsUpdate = true;
    fin('ok');
  }, undefined, () => fin('sin textura'));
  return malla;
}

// Brillo alrededor del disco que se apaga hacia fuera, en un color de la paleta.
export function crearHalo(color = COLOR.blueYonder, escala = 1.16, fuerza = 1.4) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(color) }, fuerza: { value: fuerza } },
    vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vec4 p = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-p.xyz); gl_Position = projectionMatrix * p; }',
    fragmentShader: 'uniform vec3 color; uniform float fuerza; varying vec3 vN; varying vec3 vV; void main(){ float f = pow(clamp(-dot(vN, vV), 0.0, 1.0), 3.0); gl_FragColor = vec4(color, f * fuerza); }',
    side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(escala, 64, 32), mat);
  m.name = 'halo';
  return m;
}

// Chincheta del punto: anillo neon yellow con centro blanco, de cara hacia fuera de la esfera; radio 1 en unidades locales.
export function crearMarcador() {
  const g = new THREE.Group();
  const comun = { side: THREE.DoubleSide, depthWrite: false, transparent: true, polygonOffset: true, polygonOffsetFactor: -4 };
  g.add(new THREE.Mesh(new THREE.RingGeometry(0.62, 1, 48), new THREE.MeshBasicMaterial({ color: COLOR.neonYellow, ...comun })));
  g.add(new THREE.Mesh(new THREE.CircleGeometry(0.3, 32), new THREE.MeshBasicMaterial({ color: COLOR.white, ...comun })));
  g.renderOrder = 2;
  g.name = 'marcador';
  return g;
}

// Coloca el marcador en el punto p (vector unitario del marco del globo), un poco por encima de la superficie.
export function situarMarcador(m, p, tam) {
  m.position.set(p.x * 1.004, p.y * 1.004, p.z * 1.004);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(p.x, p.y, p.z).normalize());
  m.scale.setScalar(tam);
  m.visible = true;
}

// Luz suave: ambiente alta + una direccional pegada a la cámara (arriba a la izquierda), sin cara negra.
export function crearLuces(escena, camara) {
  escena.add(new THREE.AmbientLight(COLOR.white, 1.1));
  const sol = new THREE.DirectionalLight(COLOR.white, 2.2);
  sol.position.set(-3, 2, 4);
  camara.add(sol);
  camara.add(sol.target);
  sol.target.position.set(0, 0, -5);
  escena.add(camara);
}
