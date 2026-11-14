// Modelos 3D hechos en código: esquemáticos con las medidas citadas del catálogo (equipo.json) y diseños propios (conceptos.json).
import * as THREE from 'three';

export const ROTULO = { esquematico: 'schematic · built from published dimensions', concepto: 'Analog Zero concept · own design, assumed dimensions' };
export const SIN_ESCALA = 'size not published — not drawn to scale';

// ---------- Piezas ----------
const COLOR = { claro: 0xb4bcc4, medio: 0x7f8992, oscuro: 0x3e464e, panel: 0x52667b, tela: 0xcdcac2, vidrio: 0x9fb2be, cultivo: 0x66725f, losa: 0x8a8780, berma: 0x6c6963, arista: 0x1c232a };
const mats = new Map();
function mat(n) {
  if (!mats.has(n)) {
    const o = { color: COLOR[n], roughness: 0.85, metalness: n === 'medio' ? 0.3 : 0.05 };
    if (n === 'vidrio') Object.assign(o, { transparent: true, opacity: 0.45, depthWrite: false, roughness: 0.3 });
    mats.set(n, new THREE.MeshStandardMaterial(o));
  }
  return mats.get(n);
}
let matArista = null;

function pieza(g, geo, m, pos, nombre) {
  const malla = new THREE.Mesh(geo, mat(m));
  malla.position.set(...pos);
  if (nombre) malla.name = nombre;
  matArista ??= new THREE.LineBasicMaterial({ color: COLOR.arista, transparent: true, opacity: 0.6 });
  malla.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), matArista));
  g.add(malla);
  return malla;
}
const caja = (g, m, [x0, x1], [y0, y1], [z0, z1], nombre) => pieza(g, new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), m, [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], nombre);
// Cilindro de radio r entre a y b sobre el eje; [u, v] = posición en los otros dos ejes (x→[y,z], y→[x,z], z→[x,y]).
function cil(g, m, r, eje, a, b, [u, v] = [0, 0], { seg = 24, rArriba = r, nombre } = {}) {
  const geo = new THREE.CylinderGeometry(rArriba, r, b - a, seg);
  if (eje === 'x') geo.rotateZ(-Math.PI / 2);
  if (eje === 'z') geo.rotateX(Math.PI / 2);
  const c = (a + b) / 2;
  return pieza(g, geo, m, eje === 'x' ? [c, u, v] : eje === 'y' ? [u, c, v] : [u, v, c], nombre);
}
const esfera = (g, m, r, pos) => pieza(g, new THREE.SphereGeometry(r, 24, 12), m, pos);

function ruedas(g, n, L, W, r, tw) {
  for (let i = 0; i < n; i++) {
    const x = -(L / 2 - r) + (i * (L - 2 * r)) / (n - 1);
    cil(g, 'oscuro', r, 'z', W / 2 - tw, W / 2, [x, r], { seg: 20 });
    cil(g, 'oscuro', r, 'z', -W / 2, -W / 2 + tw, [x, r], { seg: 20 });
  }
}

// ---------- Esquemáticos (largo en x, ancho en z, alto en y) ----------
function rover4({ largo: L, ancho: W, alto: H }) {
  const g = new THREE.Group(), r = Math.min(0.17 * H, 0.2 * L, 0.25 * W), tw = 0.14 * W;
  ruedas(g, 2, L, W, r, tw);
  const y0 = 1.1 * r, y1 = Math.min(y0 + 0.3 * H, 0.65 * H), zc = W / 2 - tw - 0.02 * W;
  caja(g, 'claro', [-0.45 * L, 0.45 * L], [y0, y1], [-zc, zc], 'cuerpo');
  for (const s of [-1, 1]) caja(g, 'panel', [-0.4 * L, 0.4 * L], [y0 + 0.05 * H, y1 + 0.12 * H], s > 0 ? [zc, zc + 0.015 * W] : [-zc - 0.015 * W, -zc]);
  const xm = 0.22 * L;
  cil(g, 'medio', 0.03 * L, 'y', y1, 0.88 * H, [xm, 0]);
  caja(g, 'claro', [xm - 0.09 * L, xm + 0.09 * L], [0.88 * H, H], [-0.12 * W, 0.12 * W], 'cabeza');
  return g;
}

function vehiculoAbierto({ largo: L, ancho: W, alto: H }) {
  const g = new THREE.Group(), r = Math.min(0.2 * H, 0.13 * L, 0.25 * W), tw = 0.1 * W;
  ruedas(g, 2, L, W, r, tw);
  const y0 = 0.9 * r, y1 = y0 + 0.07 * H, zc = W / 2 - tw - 0.01 * W;
  caja(g, 'medio', [-0.48 * L, 0.48 * L], [y0, y1], [-zc, zc], 'chasis');
  for (const s of [-1, 1]) {
    caja(g, 'claro', [-0.08 * L, 0.06 * L], [y1, y1 + 0.12 * H], [s * 0.2 * W - 0.12 * W, s * 0.2 * W + 0.12 * W]);
    caja(g, 'claro', [-0.11 * L, -0.08 * L], [y1, y1 + 0.38 * H], [s * 0.2 * W - 0.12 * W, s * 0.2 * W + 0.12 * W]);
  }
  caja(g, 'claro', [0.22 * L, 0.32 * L], [y1, y1 + 0.25 * H], [-0.3 * W, 0.3 * W], 'consola');
  caja(g, 'medio', [-0.46 * L, -0.2 * L], [y1, y1 + 0.1 * H], [-0.35 * W, 0.35 * W], 'carga');
  const xa = -0.32 * L, za = 0.28 * W, rd = Math.min(0.07 * L, 0.2 * W);
  cil(g, 'medio', 0.012 * L, 'y', y1, 0.96 * H, [xa, za]);
  cil(g, 'claro', rd, 'y', 0.96 * H, H, [xa, za], { rArriba: rd * 0.6, nombre: 'antena' });
  return g;
}

function excavadora({ largo: L, ancho: W, alto: H }) {
  const g = new THREE.Group(), rd = Math.min(0.3 * H, 0.2 * L);
  for (const s of [-1, 1]) {
    cil(g, 'medio', rd, 'z', -W / 2, W / 2, [s * (L / 2 - rd), rd], { seg: 12, nombre: s > 0 ? 'tambor_a' : 'tambor_b' });
    for (const z of [-0.34 * W, 0.34 * W]) caja(g, 'oscuro', s > 0 ? [0.2 * L, L / 2 - rd] : [-(L / 2 - rd), -0.2 * L], [rd - 0.03 * H, rd + 0.05 * H], [z - 0.03 * W, z + 0.03 * W]);
  }
  caja(g, 'claro', [-0.25 * L, 0.25 * L], [0.3 * H, H], [-0.3 * W, 0.3 * W], 'cuerpo');
  for (const x of [-0.14 * L, 0.14 * L]) for (const s of [-1, 1]) cil(g, 'oscuro', 0.15 * H, 'z', s > 0 ? 0.3 * W : -0.42 * W, s > 0 ? 0.42 * W : -0.3 * W, [x, 0.15 * H], { seg: 16 });
  return g;
}

function roverCarga({ largo: L, ancho: W, alto: H }) {
  const g = new THREE.Group(), r = Math.min(0.22 * H, 0.15 * L, 0.25 * W), tw = 0.12 * W;
  ruedas(g, 2, L, W, r, tw);
  const y0 = 0.9 * r, y1 = y0 + 0.1 * H, zc = W / 2 - tw - 0.01 * W;
  caja(g, 'medio', [-0.48 * L, 0.48 * L], [y0, y1], [-zc, zc], 'plataforma');
  caja(g, 'claro', [-0.42 * L, -0.12 * L], [y1, Math.min(H, y1 + 0.35 * H)], [-0.3 * W, 0.3 * W]);
  caja(g, 'claro', [-0.08 * L, 0.18 * L], [y1, Math.min(H, y1 + 0.22 * H)], [-0.3 * W, 0.1 * W]);
  caja(g, 'claro', [0.22 * L, 0.42 * L], [y1, H], [-0.25 * W, 0.25 * W], 'carga');
  return g;
}

function rover6({ largo: L, ancho: W, alto: H }) {
  const g = new THREE.Group(), r = Math.min(0.16 * H, 0.11 * L, 0.25 * W), tw = 0.1 * W;
  ruedas(g, 3, L, W, r, tw);
  const y0 = 1.6 * r, y1 = Math.min(y0 + 0.22 * H, 0.6 * H), zc = W / 2 - tw - 0.04 * W;
  caja(g, 'claro', [-0.3 * L, 0.38 * L], [y0, y1], [-zc, zc], 'cuerpo');
  const xm = 0.3 * L;
  cil(g, 'medio', 0.02 * L, 'y', y1, 0.9 * H, [xm, 0.25 * W]);
  caja(g, 'claro', [xm - 0.06 * L, xm + 0.06 * L], [0.9 * H, H], [0.25 * W - 0.1 * W, 0.25 * W + 0.1 * W], 'cabeza');
  const yr = y1 + 0.02 * H, rr = Math.min(0.09 * H, 0.08 * W);
  cil(g, 'oscuro', rr, 'x', -0.48 * L, -0.28 * L, [yr + rr, 0], { seg: 12, nombre: 'generador' });
  caja(g, 'oscuro', [-0.47 * L, -0.29 * L], [yr + rr - 0.01 * H, yr + rr + 0.01 * H], [-1.9 * rr, 1.9 * rr]);
  caja(g, 'oscuro', [-0.47 * L, -0.29 * L], [yr - 0.9 * rr, yr + 2.9 * rr], [-0.01 * H, 0.01 * H]);
  return g;
}

function satelite({ largo: L, ancho: W, alto: H }) {
  const g = new THREE.Group();
  caja(g, 'claro', [-0.12 * L, 0.12 * L], [0, 0.7 * H], [-0.4 * W, 0.4 * W], 'bus');
  for (const s of [-1, 1]) caja(g, 'panel', s > 0 ? [0.14 * L, L / 2] : [-L / 2, -0.14 * L], [0.3 * H, 0.33 * H], [-W / 2, W / 2], 'ala');
  cil(g, 'medio', Math.min(0.1 * L, 0.45 * W), 'y', 0.7 * H, H, [0, 0], { rArriba: Math.min(0.1 * L, 0.45 * W), seg: 20 });
  return g;
}

function habitat({ diametro: D, alto_inflable: Hi, diametro_metalico: Dm, alto_metalico: Hm }) {
  const g = new THREE.Group(), R = Math.max(D, Dm) / 2;
  cil(g, 'medio', Dm / 2, 'y', 0, Hm, [0, 0], { seg: 32, nombre: 'cubierta_metalica' });
  cil(g, 'tela', D / 2, 'y', Hm, Hm + Hi, [0, 0], { seg: 32, nombre: 'inflable' });
  caja(g, 'oscuro', [Dm / 2 - 0.08, Math.min(R, Dm / 2 + 0.06)], [0.15 * Hm, 0.85 * Hm], [-0.12 * Dm, 0.12 * Dm], 'escotilla');
  return g;
}

function torre({ mastil: M, ancho_paneles: Ap, alto_paneles: Hp, libre: Y0, base: B }) {
  const g = new THREE.Group(), rm = Math.max(0.06, 0.004 * M);
  cil(g, 'medio', rm, 'y', 0, M, [0, 0], { seg: 16, nombre: 'mastil' });
  caja(g, 'panel', [1.5 * rm, 1.5 * rm + Ap / 2], [Y0, Y0 + Hp], [-0.03, 0.03], 'panel_a');
  caja(g, 'panel', [-1.5 * rm - Ap / 2, -1.5 * rm], [Y0, Y0 + Hp], [-0.03, 0.03], 'panel_b');
  caja(g, 'claro', [-B / 2, B / 2], [0, Math.min(0.05 * M, Y0)], [-B / 2, B / 2], 'base');
  return g;
}

function reactor({ alto: H, ancho: W }) {
  const g = new THREE.Group(), pata = 0.034 * H, s = W / 6, yb = pata + 0.03 * H;
  for (const x of [-s, s]) for (const z of [-s, s]) caja(g, 'medio', [x - 0.02 * W, x + 0.02 * W], [0, pata], [z - 0.02 * W, z + 0.02 * W]);
  caja(g, 'medio', [-s, s], [pata, yb], [-s, s], 'trineo');
  for (const k of [-1, 1]) {
    caja(g, 'medio', k > 0 ? [s, W / 2] : [-W / 2, -s], [0, 0.012 * H], [-0.025 * W, 0.025 * W]);
    caja(g, 'medio', [-0.025 * W, 0.025 * W], [0, 0.012 * H], k > 0 ? [s, W / 2] : [-W / 2, -s]);
  }
  const yr = yb + 0.12 * H;
  cil(g, 'oscuro', 0.22 * W, 'y', yb, yr, [0, 0], { rArriba: 0.12 * W, nombre: 'blindaje' });
  cil(g, 'medio', 0.1 * W, 'y', yr, yr + 0.05 * H, [0, 0], { nombre: 'nucleo' });
  caja(g, 'claro', [-0.4 * W, 0.4 * W], [yr + 0.05 * H, H], [-0.008 * W, 0.008 * W], 'radiador');
  caja(g, 'claro', [-0.008 * W, 0.008 * W], [yr + 0.05 * H, H], [-0.4 * W, 0.4 * W]);
  return g;
}

function taladro({ largo: Lz, ancho: W }) {
  const g = new THREE.Group();
  caja(g, 'claro', [-W / 2, W / 2], [0.75 * Lz, Lz], [-0.35 * W, 0.35 * W], 'actuadores');
  cil(g, 'medio', 0.12 * W, 'y', 0, 0.75 * Lz, [0, 0], { seg: 12, nombre: 'barrena' });
  for (const x of [-0.4 * W, 0.4 * W]) caja(g, 'oscuro', [x - 0.04 * W, x + 0.04 * W], [0.1 * Lz, 0.75 * Lz], [-0.04 * W, 0.04 * W]);
  return g;
}

function pista({ diametro: D, alto: t }) {
  const g = new THREE.Group();
  cil(g, 'losa', D / 2, 'y', 0, 0.97 * t, [0, 0], { seg: 64, nombre: 'losa' });
  cil(g, 'claro', 0.1 * D, 'y', 0, t, [0, 0], { seg: 32, nombre: 'marca' });
  return g;
}

// ---------- Conceptos propios ----------
function nivelador({ largo_m: L, ancho_m: W, alto_m: H, diametro_rodillo_m: Dr }) {
  if (!(Dr <= H && Dr <= 0.4 * L)) throw new Error('nivelador: diametro_rodillo_m must be ≤ alto_m and ≤ 0.4 × largo_m');
  const g = new THREE.Group();
  caja(g, 'medio', [0.45 * L, L / 2], [0, 0.4 * H], [-W / 2, W / 2], 'hoja');
  for (const z of [-0.3 * W, 0.3 * W]) caja(g, 'oscuro', [0.2 * L, 0.45 * L], [0.15 * H, 0.22 * H], [z - 0.03 * W, z + 0.03 * W]);
  cil(g, 'oscuro', Dr / 2, 'z', -0.45 * W, 0.45 * W, [-L / 2 + Dr / 2, Dr / 2], { nombre: 'rodillo' });
  const xb = -L / 2 + 0.9 * Dr;
  for (const z of [-0.43 * W, 0.43 * W]) caja(g, 'medio', [-L / 2 + Dr / 2, xb], [Dr / 2 - 0.03 * H, Dr / 2 + 0.05 * H], [z - 0.02 * W, z + 0.02 * W]);
  for (const s of [-1, 1]) caja(g, 'oscuro', [xb, 0.2 * L], [0, 0.28 * H], s > 0 ? [0.22 * W, 0.42 * W] : [-0.42 * W, -0.22 * W], 'oruga');
  caja(g, 'claro', [xb, 0.22 * L], [0.28 * H, 0.8 * H], [-0.4 * W, 0.4 * W], 'cuerpo');
  cil(g, 'medio', 0.015 * L, 'y', 0.8 * H, 0.94 * H, [0.1 * L, 0]);
  caja(g, 'claro', [0.06 * L, 0.14 * L], [0.94 * H, H], [-0.08 * W, 0.08 * W], 'sensor');
  return g;
}

function plantaAgua({ largo_m: L, ancho_m: W, alto_m: H, diametro_deposito_m: Dd }) {
  if (!(2 * Dd <= W && Dd < 0.85 * H && Dd <= 0.3 * L)) throw new Error('planta_agua_concepto: diametro_deposito_m must fit two tanks across ancho_m and below alto_m');
  const g = new THREE.Group(), xe = -L / 2 + 0.14 * L;
  caja(g, 'claro', [-L / 2, -L / 2 + 0.28 * L], [0, 0.55 * H], [-0.4 * W, 0.4 * W], 'extractor');
  cil(g, 'medio', Math.min(0.08 * L, 0.3 * W), 'y', 0.55 * H, H, [xe, 0], { rArriba: Math.min(0.13 * L, 0.4 * W), nombre: 'tolva' });
  caja(g, 'claro', [-0.12 * L, 0.15 * L], [0, 0.6 * H], [-0.35 * W, 0.35 * W], 'electrolizador');
  for (let i = 0; i < 5; i++) { const x = -0.1 * L + i * 0.055 * L; caja(g, 'medio', [x, x + 0.01 * L], [0.6 * H, 0.75 * H], [-0.3 * W, 0.3 * W]); }
  const xd = L / 2 - Dd / 2, r = Dd / 2;
  for (const s of [-1, 1]) {
    const zd = s * (W / 2 - r);
    cil(g, 'claro', r, 'y', r, 0.85 * H - r, [xd, zd], { nombre: s > 0 ? 'deposito_a' : 'deposito_b' });
    esfera(g, 'claro', r, [xd, r, zd]);
    esfera(g, 'claro', r, [xd, 0.85 * H - r, zd]);
    cil(g, 'medio', 0.04, 'x', 0.15 * L, xd, [0.3 * H, zd]);
  }
  cil(g, 'medio', 0.04, 'x', -L / 2 + 0.28 * L, -0.12 * L, [0.3 * H, 0]);
  return g;
}

function depositoPropelente({ largo_m: L, diametro_m: D, alto_apoyos_m: s }) {
  if (!(L >= D)) throw new Error('deposito_propelente: largo_m must be ≥ diametro_m');
  const g = new THREE.Group(), r = D / 2, y = s + r;
  cil(g, 'claro', r, 'x', -(L / 2 - r), L / 2 - r, [y, 0], { seg: 32, nombre: 'tanque' });
  esfera(g, 'claro', r, [-(L / 2 - r), y, 0]);
  esfera(g, 'claro', r, [L / 2 - r, y, 0]);
  for (const x of [-0.3 * L, 0.3 * L]) caja(g, 'medio', [x - 0.05 * L, x + 0.05 * L], [0, s + 0.35 * D], [-0.4 * D, 0.4 * D], 'apoyo');
  return g;
}

function tramoCarretera({ largo_m: L, ancho_m: W, espesor_m: e, alto_berma_m: hb, ancho_berma_m: bw }) {
  const g = new THREE.Group();
  caja(g, 'losa', [-L / 2, L / 2], [0, e], [-W / 2, W / 2], 'losa');
  const forma = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(bw, 0), new THREE.Vector2(0.7 * bw, hb), new THREE.Vector2(0.3 * bw, hb)]);
  for (const s of [-1, 1]) {
    const geo = new THREE.ExtrudeGeometry(forma, { depth: L, bevelEnabled: false }).rotateY(Math.PI / 2);
    geo.translate(-L / 2, 0, s > 0 ? W / 2 + bw : -W / 2);
    pieza(g, geo, 'berma', [0, 0, 0], s > 0 ? 'berma_a' : 'berma_b');
  }
  return g;
}

function celdaVerde({ ancho_entre_caras_m: A, alto_base_m: hb, alto_cupula_m: hd }) {
  const g = new THREE.Group(), R = A / Math.sqrt(3);
  cil(g, 'claro', R, 'y', 0, hb, [0, 0], { seg: 6, nombre: 'base' });
  const cup = new THREE.SphereGeometry(R, 6, 3, Math.PI / 2, 2 * Math.PI, 0, Math.PI / 2).scale(1, hd / R, 1);
  pieza(g, cup, 'vidrio', [0, hb, 0], 'cupula');
  for (const x of [-0.25 * A, 0, 0.25 * A]) caja(g, 'cultivo', [x - 0.08 * A, x + 0.08 * A], [hb, hb + 0.25 * hd], [-0.3 * R, 0.3 * R]);
  caja(g, 'oscuro', [A / 2 - 0.03, A / 2], [0, Math.min(1.9, 0.9 * hb)], [-0.45, 0.45], 'puerta');
  return g;
}

export const CONSTRUCTORES_CONCEPTO = {
  nivelador: { forma: nivelador, requeridos: ['largo_m', 'ancho_m', 'alto_m', 'diametro_rodillo_m'] },
  planta_agua_concepto: { forma: plantaAgua, requeridos: ['largo_m', 'ancho_m', 'alto_m', 'diametro_deposito_m'] },
  deposito_propelente: { forma: depositoPropelente, requeridos: ['largo_m', 'diametro_m', 'alto_apoyos_m'] },
  tramo_carretera: { forma: tramoCarretera, requeridos: ['largo_m', 'ancho_m', 'espesor_m', 'alto_berma_m', 'ancho_berma_m'] },
  celda_verde: { forma: celdaVerde, requeridos: ['ancho_entre_caras_m', 'alto_base_m', 'alto_cupula_m'] },
};

// ---------- Medidas citadas ----------
const dim = (k, nombres, etiqueta, prop, extra = {}) => ({ k, nombres, etiqueta, prop, ...extra });
const LAH = (pl, pa, ph) => [dim('largo', ['largo_m'], 'length', pl, { eje: ['x'] }), dim('ancho', ['ancho_m'], 'width', pa, { eje: ['z'] }), dim('alto', ['alto_m'], 'height', ph, { eje: ['y'] })];

// prop = proporción por defecto entre dimensiones; una dimensión no citada sale de la primera citada con esa proporción (ilustrativa).
export const ESQUEMAS = {
  viper: { forma: rover4, dims: LAH(1, 1, 1.6), detalle: 'wheel, body and mast proportions' },
  ltv: { forma: vehiculoAbierto, dims: LAH(1, 0.58, 0.65), detalle: 'wheel, seat and antenna proportions' },
  ipex: { forma: excavadora, dims: LAH(1, 0.52, 0.57), detalle: 'drum, arm and body proportions' },
  flip: { forma: roverCarga, dims: LAH(1, 0.75, 0.5), detalle: 'wheel, deck and payload proportions' },
  rover_prospeccion_rtg: { forma: rover6, dims: LAH(1, 0.9, 0.72), detalle: 'wheel, mast and generator proportions' },
  taladro_trident: { forma: taladro, dims: [dim('largo', ['largo_m'], 'length (vertical)', 1, { eje: ['y'] }), dim('ancho', ['ancho_m'], 'width', 0.25, { eje: ['x'] })], detalle: 'housing, auger and rail proportions' },
  planta_agua: {
    forma: (d) => plantaAgua({ largo_m: d.largo, ancho_m: d.ancho, alto_m: d.alto, diametro_deposito_m: Math.min(0.4 * d.ancho, 0.17 * d.largo, 0.4 * d.alto) }),
    dims: LAH(1, 0.43, 0.4),
    detalle: 'extractor, electrolyser and tank proportions',
  },
  reles_comunicaciones: { forma: satelite, dims: LAH(1, 0.3, 0.3), detalle: 'bus, wing and antenna proportions' },
  habitat_superficie: {
    forma: habitat,
    dims: [
      dim('diametro', ['diametro_m'], 'inflatable diameter', 1, { eje: ['x', 'z'], parte: 'inflable' }),
      dim('alto_inflable', ['alto_inflable_m'], 'inflatable height', 0.8, { eje: ['y'], parte: 'inflable' }),
      dim('diametro_metalico', ['diametro_metalico_m'], 'metallic deck diameter', 0.68, { eje: ['x', 'z'], parte: 'cubierta_metalica' }),
      dim('alto_metalico', ['alto_metalico_m'], 'metallic deck height', 0.4, { eje: ['y'], parte: 'cubierta_metalica' }),
    ],
    volumen: { nombres: ['volumen_modulo_m3'], etiqueta: 'module volume', de: (d) => (Math.PI / 4) * (d.diametro ** 2 * d.alto_inflable + d.diametro_metalico ** 2 * d.alto_metalico) },
    detalle: 'hatch',
  },
  torre_solar: {
    forma: torre,
    dims: [
      dim('mastil', ['longitud_mastil_max_m'], 'mast', 1, { eje: ['y'], parte: 'mastil' }),
      dim('ancho_paneles', ['ancho_paneles_m'], 'array width (two wings)', 0.25),
      dim('alto_paneles', ['alto_paneles_m'], 'array height', 0.25, { eje: ['y'], parte: 'panel_a' }),
      dim('libre', ['altura_libre_bajo_paneles_m'], 'clearance under arrays', 0.45),
      dim('base', [], 'base width', 0.08),
    ],
    ajustar(d, citada) {
      if (d.libre + d.alto_paneles > 0.95 * d.mastil) {
        if (!citada.has('libre')) d.libre = Math.max(0, 0.95 * d.mastil - d.alto_paneles);
        else if (!citada.has('mastil')) d.mastil = (d.libre + d.alto_paneles) / 0.95;
      }
    },
    detalle: 'mast diameter',
  },
  reactor_fision: { forma: reactor, dims: [dim('alto', ['alto_m'], 'height', 1, { eje: ['y'] }), dim('ancho', ['ancho_m'], 'base width', 0.18, { eje: ['x', 'z'] })], detalle: 'leg, shield, core and radiator proportions' },
  pista_aterrizaje: { forma: pista, dims: [dim('diametro', ['diametro_m'], 'diameter', 1, { eje: ['x', 'z'] }), dim('alto', ['alto_m'], 'thickness', 0.01, { eje: ['y'] })], detalle: 'centre mark' },
};

const INDICE_DIMENSIONES = { largo: 0, ancho: 1, alto: 2 };
const citable = (c) => Number.isFinite(c?.valor) && c.valor > 0 && c.origen !== 'mío' && /^https?:\/\//.test(c.fuente ?? '');

// Dimensión citada: cifra con nombre conocido, en m, con fuente y no propia; si no, la posición en una cifra *dimensiones* [largo, ancho, alto].
function buscar(eq, d, unidad = 'm') {
  for (const n of d.nombres) {
    const c = (eq.cifras ?? []).find((x) => x.nombre === n);
    if (citable(c) && c.unidad === unidad) return { k: d.k, etiqueta: d.etiqueta, valor: c.valor, unidad, nombre: n, verificado: c.verificado === true };
  }
  const i = INDICE_DIMENSIONES[d.k];
  if (i === undefined) return null;
  for (const c of eq.cifras ?? []) {
    const v = c.valor;
    if (/dimensiones/.test(c.nombre) && c.unidad === 'm' && Array.isArray(v) && Number.isFinite(v[i]) && v[i] > 0 && c.origen !== 'mío' && /^https?:\/\//.test(c.fuente ?? '')) {
      return { k: d.k, etiqueta: d.etiqueta, valor: v[i], unidad: 'm', nombre: `${c.nombre}[${i}]`, verificado: c.verificado === true };
    }
  }
  return null;
}

export function resolverMedidas(eq, s) {
  const citadas = [], d = {};
  for (const x of s.dims) { const c = buscar(eq, x); if (c) { citadas.push(c); d[x.k] = c.valor; } }
  const citada = new Set(citadas.map((c) => c.k));
  let k = null;
  if (citadas.length) k = citadas[0].valor / s.dims.find((x) => x.k === citadas[0].k).prop;
  else if (s.volumen) {
    const v = buscar(eq, { k: 'volumen', nombres: s.volumen.nombres, etiqueta: s.volumen.etiqueta }, 'm3');
    if (v) { citadas.push(v); k = Math.cbrt(v.valor / s.volumen.de(Object.fromEntries(s.dims.map((x) => [x.k, x.prop])))); }
  }
  if (k === null) return null;
  for (const x of s.dims) if (!citada.has(x.k)) d[x.k] = x.prop * k;
  s.ajustar?.(d, citada);
  const ilustrativas = s.dims.filter((x) => !citada.has(x.k)).map((x) => ({ k: x.k, etiqueta: x.etiqueta, valor: d[x.k] }));
  return { d, citadas, ilustrativas, porVolumen: citadas.some((c) => c.k === 'volumen') };
}

// ---------- Resultado ----------
const n2 = (v) => (Math.abs(v - Math.round(v)) < 1e-9 ? String(Math.round(v)) : v.toFixed(2));
const num = (v) => String(+v.toPrecision(6));

function asentar(g) {
  const caja3 = new THREE.Box3().setFromObject(g), c = caja3.getCenter(new THREE.Vector3());
  const base = new THREE.Group();
  g.position.sub(new THREE.Vector3(c.x, caja3.min.y, c.z));
  base.add(g);
  const tam = caja3.getSize(new THREE.Vector3());
  return { base, tam, medida: [tam.x, tam.z, tam.y] };
}

// Volumen del equipo de una misión a su tamaño publicado (equipo_mision.js, formaPublicada): caja o domo (casquete de esfera).
// Colores de web/marca/marca.css: blue yonder y blanco.
export function volumenPublicado(f) {
  let geo;
  if (f.forma === 'domo') {
    const r = f.diametro_m / 2, h = f.alto_m, R = (r * r + h * h) / (2 * h);
    // Más alto que media esfera: un casquete se saldría del diámetro publicado; media esfera estirada en vertical.
    geo = h <= r ? new THREE.SphereGeometry(R, 48, 24, 0, 2 * Math.PI, 0, Math.acos((R - h) / R)).translate(0, h - R, 0)
      : new THREE.SphereGeometry(r, 48, 24, 0, 2 * Math.PI, 0, Math.PI / 2).scale(1, h / r, 1);
  } else geo = new THREE.BoxGeometry(f.largo_m, f.alto_m, f.ancho_m).translate(0, f.alto_m / 2, 0);
  const malla = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x2e96f5, roughness: 0.8, metalness: 0.05 }));
  malla.name = f.forma;
  malla.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), new THREE.LineBasicMaterial({ color: 0xffffff })));
  const g = new THREE.Group();
  g.add(malla);
  return asentar(g);
}

const sinModelo = (id, clase, linea) => ({ id, clase, aEscala: false, base: null, tam: null, medida: null, titulo: ROTULO[clase], linea, citadas: [], ilustrativas: [], supuestas: [] });

export function validarConceptos(obj) {
  if (!Array.isArray(obj?.conceptos)) return ['conceptos.json: "conceptos" must be a list'];
  const errores = [], vistos = new Set();
  for (const c of obj.conceptos) {
    const mal = [];
    if (typeof c?.id !== 'string' || !CONSTRUCTORES_CONCEPTO[c.id]) mal.push('unknown id');
    else if (vistos.has(c.id)) mal.push('duplicate id');
    if (c?.origen !== 'mío') mal.push('origen must be "mío"');
    if (typeof c?.nombre !== 'string' || !c.nombre.trim()) mal.push('no nombre');
    if (c?.equipo !== null && typeof c?.equipo !== 'string') mal.push('equipo must be null or an equipment id');
    const ps = Array.isArray(c?.parametros) ? c.parametros : [];
    for (const p of ps) {
      if (typeof p?.nombre !== 'string' || !(Number.isFinite(p.valor) && p.valor > 0) || p.unidad !== 'm' || p.supuesto !== true || typeof p.etiqueta !== 'string') mal.push(`parameter ${p?.nombre}: needs etiqueta, valor > 0, unidad "m" and supuesto: true`);
    }
    for (const r of CONSTRUCTORES_CONCEPTO[c?.id]?.requeridos ?? []) if (!ps.some((p) => p?.nombre === r)) mal.push(`missing parameter ${r}`);
    if (mal.length) errores.push(`${c?.id ?? '?'}: ${mal.join('; ')}`);
    if (typeof c?.id === 'string') vistos.add(c.id);
  }
  return errores;
}

let conceptosCargados = null;

// params = {nombre: valor} que sustituyen a los supuestos de conceptos.json (p. ej. anchura y longitud de un tramo de carretera).
export function construirConcepto(id, params = {}, conceptos = conceptosCargados) {
  const c = conceptos?.conceptos?.find((x) => x.id === id);
  const k = CONSTRUCTORES_CONCEPTO[id];
  if (!c || !k) throw new Error(`no concept "${id}"${conceptos ? '' : ' (conceptos.json not loaded)'}`);
  const p = Object.fromEntries(c.parametros.map((x) => [x.nombre, x.valor]));
  for (const [n, v] of Object.entries(params)) {
    if (!(n in p)) throw new Error(`${id}: unknown parameter ${n}`);
    if (!(Number.isFinite(v) && v > 0)) throw new Error(`${id}: ${n} must be a positive number`);
    p[n] = v;
  }
  const a = asentar(k.forma(p));
  const supuestas = c.parametros.map((x) => ({ nombre: x.nombre, etiqueta: x.etiqueta, valor: p[x.nombre] }));
  return {
    id, nombre: c.nombre, clase: 'concepto', aEscala: true, ...a, parametros: p, titulo: ROTULO.concepto,
    linea: `${supuestas.map((x) => `${x.etiqueta} ${num(x.valor)} m`).join(', ')} (assumed)`, citadas: [], ilustrativas: [], supuestas,
  };
}

// Modelo generado para un equipo del catálogo. Equipo propio (origen "mío") → su concepto; sin medida citada → sin modelo.
export function construirEsquematico(eq, conceptos = conceptosCargados) {
  if (eq?.origen === 'mío') {
    const c = conceptos?.conceptos?.find((x) => x.equipo === eq.id);
    if (!c) return sinModelo(eq.id, 'concepto', conceptos ? 'own concept without a 3D design' : 'own concept: conceptos.json not loaded');
    const params = {};
    for (const x of c.parametros) { const v = eq.cifras?.find((q) => q.nombre === x.nombre)?.valor; if (Number.isFinite(v) && v > 0) params[x.nombre] = v; }
    return { ...construirConcepto(c.id, params, conceptos), id: eq.id };
  }
  const s = ESQUEMAS[eq?.id];
  if (!s) return sinModelo(eq?.id, 'esquematico', 'no schematic drawing for this system');
  const r = resolverMedidas(eq, s);
  if (!r) return sinModelo(eq.id, 'esquematico', SIN_ESCALA);
  const a = asentar(s.forma(r.d));
  const partes = r.citadas.map((c) => `${c.etiqueta} ${num(c.valor)} ${c.unidad === 'm3' ? 'm³' : 'm'} (cited${c.verificado ? '' : ', quote not verified'})`);
  partes.push(`${[...r.ilustrativas.map((x) => `${x.etiqueta} ${n2(x.valor)} m`), s.detalle].join(', ')} illustrative${r.porVolumen ? ' (sized to the cited volume)' : ''}`);
  return { id: eq.id, clase: 'esquematico', aEscala: true, ...a, dims: r.d, titulo: ROTULO.esquematico, linea: partes.join(' · '), citadas: r.citadas, ilustrativas: r.ilustrativas, supuestas: [] };
}

// Caché por equipo: se rehace solo si cambian sus cifras o el catálogo de conceptos.
const cache = new Map();
let version = 0;
export function generadoDe(eq, conceptos = conceptosCargados) {
  const clave = `${JSON.stringify(eq.cifras ?? [])}|${eq.origen ?? ''}|${conceptos ? 'c' : '-'}`;
  const x = cache.get(eq.id);
  if (x?.clave === clave) return x.res;
  const res = { ...construirEsquematico(eq, conceptos), clave: `${eq.id}#${++version}` };
  cache.set(eq.id, { clave, res });
  return res;
}

export async function cargarFuentes() {
  const leer = async (f) => {
    const r = await fetch(new URL(`../data/${f}`, import.meta.url), { cache: 'no-cache' });
    if (!r.ok) throw new Error(`${f} not found (HTTP ${r.status})`);
    try { return await r.json(); } catch { throw new Error(`${f} is broken (not valid JSON)`); }
  };
  const [eq, co] = await Promise.allSettled([leer('equipo.json'), leer('conceptos.json')]);
  const errores = [];
  const equipos = eq.status === 'fulfilled' && Array.isArray(eq.value?.equipos) ? eq.value.equipos : null;
  if (!equipos) errores.push(eq.reason?.message ?? 'equipo.json: no "equipos" list');
  if (co.status === 'fulfilled') {
    const e = validarConceptos(co.value);
    if (e.length) errores.push(e[0]); else conceptosCargados = co.value;
  } else errores.push(co.reason?.message ?? 'conceptos.json not reachable');
  return { equipos, conceptos: conceptosCargados, errorGenerados: errores.join(' · ') || null };
}
