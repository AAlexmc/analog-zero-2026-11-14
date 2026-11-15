// Un panel 3D: malla desplazada en el sombreador, normales/pendiente a resolución completa, sombras por barrido en CPU.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { sombras, sobrePlanoTangente, intersectarRayo, rango, alturaBilineal, pendienteGrados } from './calculo.js';
import { pixelALatLon, latLonAPixel } from './georef.js';

const VS = /* glsl */`
uniform sampler2D uAlt;
uniform float uLado, uZc, uExag;
varying vec2 vTc;
varying vec2 vXZ;
varying float vDist;
void main() {
  vec2 tc = position.xz / uLado + 0.5;
  float h = textureLod(uAlt, tc, 0.0).r;
  vTc = tc; vXZ = position.xz;
  vec4 mv = modelViewMatrix * vec4(position.x, (h - uZc) / 1000.0 * uExag, position.z, 1.0);
  vDist = length(mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

// Cielo de la vista a ras de suelo: esfera centrada en la cámara, degradado del horizonte al cénit.
const VS_CIELO = /* glsl */`
varying vec3 vDir;
void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const FS_CIELO = /* glsl */`
uniform vec3 uArriba, uHorizonte;
varying vec3 vDir;
void main() { gl_FragColor = vec4(mix(uHorizonte, uArriba, smoothstep(0.0, 0.55, vDir.y)), 1.0); }`;

// Colores de web/marca/marca.css: blue yonder, blanco y deep blue.
const AZUL_YONDER = 0x2e96f5, BLANCO = 0xffffff, AZUL_PROFUNDO = 0x07173f;
export const OJO_M = 2;
// Los sombreadores propios escriben el color tal cual: sin pasar el hex a espacio lineal.
const colorTal = (hex) => new THREE.Color().setHex(hex, THREE.LinearSRGBColorSpace);

const FS = /* glsl */`
uniform sampler2D uAlt, uSombra, uCapa, uAgua, uImg;
uniform float uN, uM, uGain, uAmb, uZmin, uZmax, uCurva, uRkm, uDia;
uniform vec3 uSol;
uniform int uModo, uCapaModo, uHayAgua;
uniform vec2 uCapaRango;
uniform vec3 uCapaColor;
uniform vec3 uPincel;
uniform vec3 uNiebla;
uniform vec3 uNieblaD;
varying vec2 vTc;
varying vec2 vXZ;
varying float vDist;
const vec3 OSC = vec3(0.016, 0.075, 0.15);
const vec3 PRU = vec3(0.0, 0.19, 0.33);
const vec3 CIA = vec3(0.30, 0.58, 0.78);
const vec3 BLA = vec3(0.93, 0.95, 0.97);
const vec3 AGUA = vec3(0.08, 0.30, 0.66);
vec3 rampa(float t) {
  t = clamp(t, 0.0, 1.0);
  return t < 0.4 ? mix(OSC, PRU, t / 0.4) : (t < 0.75 ? mix(PRU, CIA, (t - 0.4) / 0.35) : mix(CIA, BLA, (t - 0.75) / 0.25));
}
void main() {
  vec2 hv = texture(uAlt, vTc).rg;
  if (hv.g < 0.5) discard;
  float d = 1.0 / uN;
  float gx = (texture(uAlt, vTc + vec2(d, 0.0)).r - texture(uAlt, vTc - vec2(d, 0.0)).r) / (2.0 * uM);
  float gz = (texture(uAlt, vTc + vec2(0.0, d)).r - texture(uAlt, vTc - vec2(0.0, d)).r) / (2.0 * uM);
  vec3 nrm = normalize(vec3(-gx + vXZ.x / uRkm, 1.0, -gz + vXZ.y / uRkm));
  float luz = max(dot(nrm, uSol), 0.0) * texture(uSombra, vTc).r;
  float sombreado = clamp(uAmb + luz * uGain, 0.0, 1.0);
  vec3 col;
  if (uModo == 0) {
    col = mix(OSC, BLA, sombreado);
  } else if (uModo == 1) {
    col = rampa((hv.r - uZmin) / max(uZmax - uZmin, 1e-3)) * (0.55 + 0.45 * sombreado);
    float q = hv.r / uCurva;
    float w = fwidth(q);
    col = mix(col, BLA, 0.55 * (1.0 - smoothstep(0.0, 1.2 * w, abs(fract(q + 0.5) - 0.5))));
  } else if (uModo == 3) {
    // Imagen × luz del sol, con la misma ganancia que Relief: laderas al sol más claras, en sombra más oscuras pero no negras.
    col = min(texture(uImg, vTc).rgb * (0.35 + 0.65 * luz * uGain), vec3(1.0));
  } else {
    float s = degrees(atan(length(vec2(gx, gz))));
    col = rampa(floor(min(s, 45.0) / 5.0) / 9.0) * (0.6 + 0.4 * sombreado);
  }
  if (uHayAgua > 0) {
    // Tinte que sigue el sombreado (y con él las sombras proyectadas) y orilla fina.
    float w = texture(uAgua, vTc).r;
    col = mix(col, AGUA * (0.15 + 0.85 * sombreado), 0.8 * w);
    col = mix(col, BLA, 0.35 * (1.0 - smoothstep(0.0, 1.5 * fwidth(w), abs(w - 0.5))) * step(0.02, w) * step(w, 0.98));
  }
  if (uCapaModo > 0) {
    vec2 c = texture(uCapa, vTc).rg;
    if (c.g > 0.5) {
      if (uCapaModo == 3) {
        if (c.r > 0.5) col = mix(col, uCapaColor * (0.7 + 0.3 * sombreado), 0.85);
      } else if (uCapaModo == 2) {
        if (c.r > 0.5) {
          col = mix(col, OSC, 0.45);
          if (mod(gl_FragCoord.x + gl_FragCoord.y, 7.0) < 1.6) col = BLA;
        }
      } else {
        vec3 k = mix(vec3(0.05, 0.12, 0.35), vec3(0.62, 0.95, 1.0), clamp((c.r - uCapaRango.x) / max(uCapaRango.y - uCapaRango.x, 1e-6), 0.0, 1.0));
        col = mix(col, k * (0.55 + 0.45 * sombreado), 0.85);
      }
    }
  }
  if (uPincel.z > 0.0) {
    float r = abs(length(vXZ - uPincel.xy) - uPincel.z);
    float w = fwidth(length(vXZ - uPincel.xy));
    col = mix(col, BLA, 1.0 - smoothstep(0.0, 1.5 * w, r));
  }
  col *= uDia;
  if (uNieblaD.z > 0.0) col = mix(col, uNiebla, uNieblaD.z * smoothstep(uNieblaD.x, uNieblaD.y, vDist));
  gl_FragColor = vec4(col, 1.0);
}`;

const MODOS = { relieve: 0, cota: 1, pendiente: 2, satelite: 3 };

function intervaloBonito(x) {
  const p = 10 ** Math.floor(Math.log10(x)), r = x / p;
  return (r < 1.5 ? 1 : r < 3.5 ? 2 : r < 7.5 ? 5 : 10) * p;
}

export class Escena {
  constructor(contenedor, datos, ladoVistaKm) {
    const { meta } = datos;
    this.meta = meta;
    this.n = meta.n; this.m = meta.m_por_px; this.mkm = meta.m_por_px / 1000;
    this.base = datos.altura;
    this.capas = datos.capas;
    this.delta = new Float32Array(this.n * this.n);
    this.actual = Float32Array.from(this.base);
    this.verOriginal = false;
    this.contenedor = contenedor;
    this.alCambiarCamara = null;
    this.alDibujar = null;
    this.sucio = true;
    const r = rango(this.base);
    this.zc = (r.min + r.max) / 2;
    this.zmin = r.min; this.zmax = r.max;
    this.fraccionNaN = r.nan;
    this.relleno = Number.isFinite(r.min) ? r.min : 0;

    // Fondo transparente: alrededor del terreno se ve el degradado de la marca de la página.
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);
    contenedor.appendChild(this.renderer.domElement);
    // El navegador puede soltar el contexto 3D y devolverlo después: al volver se redibuja; quien monta el panel avisa (alContexto).
    this.sinContexto = false;
    this.alContexto = null;
    this.renderer.domElement.addEventListener('webglcontextlost', () => { this.sinContexto = true; this.alContexto?.(true); });
    this.renderer.domElement.addEventListener('webglcontextrestored', () => { this.sinContexto = false; this.sucio = true; this.alContexto?.(false); });
    const filtro = this.renderer.extensions.has('OES_texture_float_linear') ? THREE.LinearFilter : THREE.NearestFilter;

    const n = this.n;
    this.datosAlt = new Float32Array(n * n * 2);
    this.tAlt = new THREE.DataTexture(this.datosAlt, n, n, THREE.RGFormat, THREE.FloatType);
    this.tAlt.minFilter = this.tAlt.magFilter = filtro;
    this.datosSombra = new Uint8Array(n * n);
    this.tSombra = new THREE.DataTexture(this.datosSombra, n, n, THREE.RedFormat, THREE.UnsignedByteType);
    this.tSombra.minFilter = this.tSombra.magFilter = THREE.LinearFilter;
    this.tSombra.unpackAlignment = 1;
    this.tCapa = new THREE.DataTexture(new Float32Array(2), 1, 1, THREE.RGFormat, THREE.FloatType);
    this.tCapa.minFilter = this.tCapa.magFilter = filtro;
    const agua = this.capas.agua;
    this.tAgua = new THREE.DataTexture(agua ? Uint8Array.from(agua, (v) => (v >= 1 ? 255 : 0)) : new Uint8Array(1), agua ? n : 1, agua ? n : 1, THREE.RedFormat, THREE.UnsignedByteType);
    this.tAgua.minFilter = this.tAgua.magFilter = THREE.LinearFilter;
    this.tAgua.unpackAlignment = 1;
    this.tAgua.needsUpdate = true;
    // Imagen de la Tierra (GIBS) en los mismos nodos que la altura; sin ella, el modo Satellite no se ofrece.
    this.imagen = datos.imagen ?? null;
    const img = this.imagen;
    this.tImg = new THREE.DataTexture(img ? new Uint8Array(img.buffer, img.byteOffset, img.length) : new Uint8Array(4), img ? n : 1, img ? n : 1, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.tImg.minFilter = this.tImg.magFilter = THREE.LinearFilter;
    this.tImg.needsUpdate = true;

    const L = n * this.mkm;
    this.ladoKm = L;
    this.uniforms = {
      uAlt: { value: this.tAlt }, uSombra: { value: this.tSombra }, uCapa: { value: this.tCapa }, uAgua: { value: this.tAgua }, uHayAgua: { value: agua ? 1 : 0 }, uImg: { value: this.tImg },
      uLado: { value: L }, uZc: { value: this.zc }, uExag: { value: 1 },
      uN: { value: n }, uM: { value: this.m }, uGain: { value: 1 }, uAmb: { value: 0.03 },
      uZmin: { value: r.min }, uZmax: { value: r.max }, uCurva: { value: intervaloBonito(Math.max(r.max - r.min, 1) / 20) }, uRkm: { value: meta.georef.radio_m / 1000 },
      uSol: { value: new THREE.Vector3(0, 1, 0) }, uModo: { value: 0 }, uCapaModo: { value: 0 },
      uCapaRango: { value: new THREE.Vector2(0, 1) }, uCapaColor: { value: new THREE.Vector3(1, 1, 1) }, uPincel: { value: new THREE.Vector3(0, 0, -1) },
      uNiebla: { value: colorTal(BLANCO) }, uNieblaD: { value: new THREE.Vector3(0, 1, 0) }, uDia: { value: 1 },
    };
    const seg = Math.min(n - 1, 1023);
    const geo = new THREE.PlaneGeometry(L, L, seg, seg);
    geo.rotateX(-Math.PI / 2);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), L * 2);
    this.malla = new THREE.Mesh(geo, new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: FS, uniforms: this.uniforms }));
    this.malla.frustumCulled = false;
    this.escena = new THREE.Scene();
    this.escena.add(this.malla);

    this.camara = new THREE.PerspectiveCamera(40, 1, 0.01, 2000);
    const D = ladoVistaKm * 1.45;
    this.camara.position.set(0, D * Math.sin(55 * Math.PI / 180), D * Math.cos(55 * Math.PI / 180));
    this.controles = new OrbitControls(this.camara, this.renderer.domElement);
    this.controles.maxPolarAngle = Math.PI * 0.495;
    this.controles.minDistance = 0.05;
    this.controles.maxDistance = ladoVistaKm * 6;
    this.controles.addEventListener('change', () => { this.sucio = true; this.alCambiarCamara?.(this); });

    // Tierra: cielo claro (blue yonder → blanco) y bruma; sin aire (Luna, Marte aquí): cielo oscuro y sin bruma.
    const aire = meta.cuerpo === 'tierra';
    this.cielo = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), new THREE.ShaderMaterial({
      vertexShader: VS_CIELO, fragmentShader: FS_CIELO, side: THREE.BackSide, depthWrite: false, depthTest: false,
      uniforms: { uArriba: { value: colorTal(aire ? AZUL_YONDER : AZUL_PROFUNDO) }, uHorizonte: { value: colorTal(aire ? BLANCO : AZUL_PROFUNDO) } },
    }));
    this.cielo.renderOrder = -1;
    this.cielo.frustumCulled = false;
    this.cielo.visible = false;
    this.escena.add(this.cielo);
    this.conBruma = aire;
    this.luzDia = 1;
    this.suelo = null;
    this.teclas = new Set();
    this.#ratonSuelo();

    this.sol = { az: 315, el: 30 };
    this.exag = 1;
    this.#subirAlturas();
    new ResizeObserver(() => this.redimensionar()).observe(contenedor);
    this.redimensionar();
  }

  #subirAlturas(caja) {
    const n = this.n, src = this.verOriginal ? this.base : this.actual, d = this.datosAlt;
    const f0 = caja ? caja.f0 : 0, f1 = caja ? caja.f1 : n - 1, c0 = caja ? caja.c0 : 0, c1 = caja ? caja.c1 : n - 1;
    for (let f = f0; f <= f1; f++) for (let c = c0; c <= c1; c++) {
      const i = f * n + c, v = src[i];
      const ok = Number.isFinite(v);
      d[2 * i] = ok ? v : this.relleno; d[2 * i + 1] = ok ? 1 : 0;
    }
    this.tAlt.needsUpdate = true;
    this.versionAlturas = (this.versionAlturas ?? 0) + 1;
    this.geoRayo = null;
    this.sucio = true;
  }

  get mostradas() { return this.verOriginal ? this.base : this.actual; }

  actualizarAlturas(caja) {
    const n = this.n;
    const f0 = caja ? caja.f0 : 0, f1 = caja ? caja.f1 : n - 1, c0 = caja ? caja.c0 : 0, c1 = caja ? caja.c1 : n - 1;
    for (let f = f0; f <= f1; f++) for (let c = c0; c <= c1; c++) { const i = f * n + c; this.actual[i] = this.base[i] + this.delta[i]; }
    this.#subirAlturas(caja);
  }

  setVerOriginal(v) { this.verOriginal = v; this.#subirAlturas(); this.recalcularSombras(); }

  // A ras de suelo la exageración es siempre 1: la pedida se guarda para la vuelta.
  setExag(e) {
    if (this.suelo) { this.suelo.exagFuera = e; return; }
    this.#ponerExag(e);
  }

  #ponerExag(e) { this.exag = e; this.uniforms.uExag.value = e; this.geoRayo = null; this.sucio = true; }

  setModo(m) { this.uniforms.uModo.value = MODOS[m]; this.sucio = true; }

  // el <= 0: el sol está bajo el horizonte y nada recibe luz directa. Con aire, el cielo y el suelo se apagan entre
  // 0° y −6° (crepúsculo civil; el reparto de esa luz es criterio propio, no una medida).
  setSol(az, el) {
    this.sol = { az, el };
    const a = az * Math.PI / 180, e = Math.max(el, 0) * Math.PI / 180;
    this.uniforms.uSol.value.set(Math.cos(e) * Math.sin(a), Math.sin(e), -Math.cos(e) * Math.cos(a));
    this.uniforms.uGain.value = 1 / Math.sin(Math.min(e + 20 * Math.PI / 180, Math.PI / 2));
    const k = this.conBruma ? Math.min(1, Math.max(0, (el + 6) / 6)) : 1;
    this.luzDia = this.conBruma ? 0.25 + 0.75 * k : 1;
    this.uniforms.uDia.value = this.luzDia;
    if (this.conBruma) {
      const noche = colorTal(AZUL_PROFUNDO), u = this.cielo.material.uniforms;
      u.uArriba.value.copy(noche).lerp(colorTal(AZUL_YONDER), k);
      u.uHorizonte.value.copy(noche).lerp(colorTal(BLANCO), k);
      this.uniforms.uNiebla.value.copy(u.uHorizonte.value);
    }
    this.recalcularSombras();
  }

  // Luz directa en la celda: hay sol sobre el horizonte y el relieve no lo tapa.
  conSol(fila, col) { return this.sol.el > 0 && this.datosSombra[Math.round(fila) * this.n + Math.round(col)] === 255; }

  fraccionConSol() {
    if (!(this.sol.el > 0)) return 0;
    let k = 0, t = 0;
    const a = this.mostradas, d = this.datosSombra;
    for (let i = 0; i < d.length; i++) if (Number.isFinite(a[i])) { t++; if (d[i] === 255) k++; }
    return t ? k / t : NaN;
  }

  recalcularSombras() {
    if (!(this.sol.el > 0)) { this.datosSombra.fill(0); this.tSombra.needsUpdate = true; this.sucio = true; return; }
    const h = sobrePlanoTangente(this.mostradas, this.n, this.m, this.meta.georef.radio_m);
    this.datosSombra.set(sombras(h, this.n, this.m, this.sol.az, this.sol.el));
    this.tSombra.needsUpdate = true;
    this.sucio = true;
  }

  // capa: {nombre, binaria} o null; color [r, g, b] (0-1): máscara de un solo color, celdas con valor > 0.5.
  setCapa(nombre, binaria, color = null) {
    if (!nombre) { this.uniforms.uCapaModo.value = 0; this.sucio = true; return null; }
    const v = this.capas[nombre], n = this.n;
    const d = new Float32Array(n * n * 2);
    for (let i = 0; i < v.length; i++) { const ok = Number.isFinite(v[i]); d[2 * i] = ok ? v[i] : 0; d[2 * i + 1] = ok ? 1 : 0; }
    this.tCapa.dispose();
    this.tCapa = new THREE.DataTexture(d, n, n, THREE.RGFormat, THREE.FloatType);
    this.tCapa.minFilter = this.tCapa.magFilter = this.tAlt.minFilter;
    this.tCapa.needsUpdate = true;
    this.uniforms.uCapa.value = this.tCapa;
    const r = rango(v);
    this.uniforms.uCapaRango.value.set(r.min, r.max);
    if (color) this.uniforms.uCapaColor.value.set(...color);
    this.uniforms.uCapaModo.value = color ? 3 : binaria ? 2 : 1;
    this.sucio = true;
    return r;
  }

  setPincel(golpe, radio_m) {
    if (!golpe) this.uniforms.uPincel.value.z = -1;
    else this.uniforms.uPincel.value.set(golpe.x, golpe.z, radio_m / 1000);
    this.sucio = true;
  }

  redimensionar() {
    const w = this.contenedor.clientWidth, h = this.contenedor.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camara.aspect = w / h;
    this.camara.updateProjectionMatrix();
    this.sucio = true;
  }

  rayo(clientX, clientY) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const v = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    const rc = new THREE.Raycaster();
    rc.setFromCamera(v, this.camara);
    if (!this.geoRayo) this.geoRayo = { alturas: this.mostradas, n: this.n, mkm: this.mkm, zc: this.zc, exag: this.exag };
    return intersectarRayo(this.geoRayo, rc.ray.origin.toArray(), rc.ray.direction.toArray());
  }

  leer(fila, col) {
    const g = pixelALatLon(this.meta, fila, col);
    const a = this.mostradas, n = this.n;
    const fr = Math.min(n - 1, Math.max(0, Math.round(fila))), cr = Math.min(n - 1, Math.max(0, Math.round(col)));
    return { lat: g.lat, lon: g.lon, cota: alturaBilineal(a, n, fila, col), pendiente: pendienteGrados(a, n, this.m, fr, cr), agua: this.capas.agua ? this.capas.agua[fr * n + cr] : null };
  }

  mundoDePixel(fila, col) {
    const k = (this.n - 1) / 2;
    const h = alturaBilineal(this.mostradas, this.n, fila, col);
    return new THREE.Vector3((col - k) * this.mkm, ((Number.isFinite(h) ? h : this.zc) - this.zc) / 1000 * this.exag, (fila - k) * this.mkm);
  }

  // Posición en pantalla (px de cliente) de un punto del mundo; null si queda detrás.
  aPantalla(v) {
    const p = v.clone().project(this.camara);
    if (p.z > 1 || p.z < -1) return null;
    const r = this.renderer.domElement.getBoundingClientRect();
    return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height, dentro: Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1 };
  }

  rasgosEnRejilla() {
    return (this.meta.rasgos ?? []).map((r) => ({ ...r, px: latLonAPixel(this.meta, r.lat, r.lon) }))
      .filter((r) => r.px.fila >= -0.5 && r.px.col >= -0.5 && r.px.fila <= this.n - 0.5 && r.px.col <= this.n - 0.5);
  }

  pxPorKm() {
    const t = this.controles.target.clone();
    const der = new THREE.Vector3().setFromMatrixColumn(this.camara.matrixWorld, 0).normalize();
    const a = t.clone().project(this.camara), b = t.add(der).project(this.camara);
    return Math.hypot((b.x - a.x) / 2 * this.contenedor.clientWidth, (b.y - a.y) / 2 * this.contenedor.clientHeight);
  }

  copiarCamara(otra) {
    this.camara.position.copy(otra.camara.position);
    this.controles.target.copy(otra.controles.target);
    this.camara.quaternion.copy(otra.camara.quaternion);
    this.camara.updateMatrixWorld();
    this.sucio = true;
  }

  // Vista aérea sobre el centro de la ventana, a la distancia que deja ver entero un círculo de ese radio.
  encuadrar(radio_km, centro = null) {
    if (this.suelo) return;
    const fov = (this.camara.fov * Math.PI) / 360, aspecto = Math.min(1, this.camara.aspect || 1);
    const d = Math.min(this.controles.maxDistance, Math.max(this.controles.minDistance, (1.35 * radio_km) / (Math.tan(fov) * aspecto)));
    const k = (this.n - 1) / 2, c = this.mundoDePixel(centro?.fila ?? k, centro?.col ?? k), a = (55 * Math.PI) / 180;
    this.controles.target.copy(c);
    this.camara.position.set(c.x, c.y + d * Math.sin(a), c.z + d * Math.cos(a));
    this.camara.lookAt(c);
    this.controles.update();
    this.sucio = true;
  }

  // ---------- Vista a ras de suelo ----------
  // Cota del suelo (y del mundo, km) en (x, z) del mundo; NaN fuera de la rejilla o sin dato.
  alturaSuelo(x, z) {
    const k = (this.n - 1) / 2, f = z / this.mkm + k, c = x / this.mkm + k;
    if (!(f >= 0 && c >= 0 && f <= this.n - 1 && c <= this.n - 1)) return NaN;
    const h = alturaBilineal(this.mostradas, this.n, f, c);
    return ((h - this.zc) / 1000) * this.exag;
  }

  // Ojo a OJO_M sobre el suelo en (fila, col), mirando a `mirar` (fila, col), al `rumbo` (grados) o al norte de la rejilla.
  entrarSuelo({ fila, col, mirar = null, rumbo = null }) {
    const k = (this.n - 1) / 2;
    let x = (col - k) * this.mkm, z = (fila - k) * this.mkm;
    if (!Number.isFinite(this.alturaSuelo(x, z))) { x = 0; z = 0; }
    if (!Number.isFinite(this.alturaSuelo(x, z))) return false;
    if (!this.suelo) {
      this.suelo = {
        exagFuera: this.exag, ojo: OJO_M / 1000,
        vuelta: { pos: this.camara.position.clone(), target: this.controles.target.clone(), near: this.camara.near, far: this.camara.far },
      };
      this.controles.enabled = false;
      this.#ponerExag(1);
      this.camara.near = 0.0003;
      this.camara.far = this.ladoKm * 3;
      this.camara.updateProjectionMatrix();
      this.cielo.visible = true;
      this.cielo.scale.setScalar(this.ladoKm * 2);
      if (this.conBruma) this.uniforms.uNieblaD.value.set(0.3, 12, 0.6);
    }
    const s = this.suelo;
    s.x = x; s.z = z; s.yaw = Number.isFinite(rumbo) ? rumbo * Math.PI / 180 : 0; s.pitch = -0.05;
    if (mirar) {
      const mx = (mirar.col - k) * this.mkm, mz = (mirar.fila - k) * this.mkm, d = Math.hypot(mx - x, mz - z);
      if (d > 1e-9) {
        s.yaw = Math.atan2(mx - x, -(mz - z));
        const objetivo = this.alturaSuelo(mx, mz) + 0.001;
        if (Number.isFinite(objetivo)) s.pitch = Math.atan2(objetivo - (this.alturaSuelo(x, z) + s.ojo), d);
      }
    }
    this.#ponerCamaraSuelo();
    return true;
  }

  salirSuelo() {
    const s = this.suelo;
    if (!s) return;
    this.suelo = null;
    this.teclas.clear();
    this.camara.near = s.vuelta.near; this.camara.far = s.vuelta.far;
    this.camara.updateProjectionMatrix();
    this.camara.position.copy(s.vuelta.pos);
    this.controles.target.copy(s.vuelta.target);
    this.camara.lookAt(this.controles.target);
    this.controles.enabled = true;
    this.controles.update();
    this.cielo.visible = false;
    this.uniforms.uNieblaD.value.z = 0;
    this.#ponerExag(s.exagFuera);
  }

  girarSuelo(dYaw, dPitch) {
    const s = this.suelo;
    if (!s) return;
    s.yaw += dYaw;
    s.pitch = Math.max(-1.4, Math.min(1.4, s.pitch + dPitch));
    this.#ponerCamaraSuelo();
  }

  // Avanza en horizontal (metros; negativo = atrás). No sale de la rejilla ni entra en celdas sin dato.
  andarSuelo(metros) {
    const s = this.suelo;
    if (!s) return;
    const lim = ((this.n - 1) / 2) * this.mkm * 0.999;
    const x = Math.max(-lim, Math.min(lim, s.x + (Math.sin(s.yaw) * metros) / 1000));
    const z = Math.max(-lim, Math.min(lim, s.z - (Math.cos(s.yaw) * metros) / 1000));
    if (!Number.isFinite(this.alturaSuelo(x, z))) return;
    s.x = x; s.z = z;
    this.#ponerCamaraSuelo();
  }

  // Para la interfaz y las capturas: altura del ojo sobre el suelo (m), exageración y rumbo.
  estadoSuelo() {
    const s = this.suelo;
    if (!s) return null;
    const p = this.camara.position;
    return { ojo_m: (p.y - this.alturaSuelo(p.x, p.z)) * 1000, exag: this.exag, rumbo_deg: ((s.yaw * 180 / Math.PI) % 360 + 360) % 360, x_km: p.x, z_km: p.z };
  }

  #ponerCamaraSuelo() {
    const s = this.suelo, y = this.alturaSuelo(s.x, s.z) + s.ojo;
    const dir = new THREE.Vector3(Math.sin(s.yaw) * Math.cos(s.pitch), Math.sin(s.pitch), -Math.cos(s.yaw) * Math.cos(s.pitch));
    this.camara.position.set(s.x, y, s.z);
    this.camara.lookAt(this.camara.position.clone().add(dir));
    // Objetivo a 50 m: la escala de los modelos (factorAmpliacion) se queda en ×1.
    this.controles.target.copy(this.camara.position).addScaledVector(dir.setY(0).normalize(), 0.05);
    this.sucio = true;
  }

  // Arrastrar mira alrededor; la rueda avanza o retrocede 2 m por paso.
  #ratonSuelo() {
    const cv = this.renderer.domElement;
    let arr = null;
    cv.addEventListener('pointerdown', (ev) => {
      if (!this.suelo || ev.button !== 0) return;
      arr = { x: ev.clientX, y: ev.clientY, id: ev.pointerId };
      cv.setPointerCapture(ev.pointerId);
    });
    cv.addEventListener('pointermove', (ev) => {
      if (!this.suelo || !arr || ev.pointerId !== arr.id) return;
      const k = (this.camara.fov * Math.PI / 180) / Math.max(cv.clientHeight, 1);
      this.girarSuelo(-(ev.clientX - arr.x) * k, (ev.clientY - arr.y) * k);
      arr.x = ev.clientX; arr.y = ev.clientY;
    });
    const fin = () => { arr = null; };
    cv.addEventListener('pointerup', fin);
    cv.addEventListener('pointercancel', fin);
    cv.addEventListener('wheel', (ev) => {
      if (!this.suelo) return;
      ev.preventDefault();
      this.andarSuelo(ev.deltaY < 0 ? 2 : -2);
    }, { passive: false });
  }

  // Teclas pulsadas (las pone el visor): flechas o W/S a 1,5 m/s, giro a 45°/s.
  #moverConTeclas() {
    const ahora = performance.now(), dt = Math.min((ahora - (this.tTeclas ?? ahora)) / 1000, 0.1);
    this.tTeclas = ahora;
    if (!this.suelo || !this.teclas.size || !dt) return;
    const t = this.teclas, avance = (t.has('adelante') ? 1 : 0) - (t.has('atras') ? 1 : 0), giro = (t.has('derecha') ? 1 : 0) - (t.has('izquierda') ? 1 : 0);
    if (giro) this.girarSuelo(giro * dt * Math.PI / 4, 0);
    if (avance) this.andarSuelo(avance * 1.5 * dt);
  }

  dibujar(forzar) {
    this.#moverConTeclas();
    if (!this.sucio && !forzar) return false;
    if (!this.contenedor.clientWidth) return false;
    this.sucio = false;
    if (this.suelo) this.cielo.position.copy(this.camara.position);
    this.camara.updateMatrixWorld();
    this.renderer.render(this.escena, this.camara);
    this.alDibujar?.(this);
    return true;
  }

  // Para pruebas: dibuja y cuenta colores distintos del lienzo.
  muestraLienzo() {
    this.dibujar(true);
    const gl = this.renderer.getContext();
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const colores = new Set();
    for (let i = 0; i < px.length; i += 4 * 97) colores.add((px[i] << 16) | (px[i + 1] << 8) | px[i + 2]);
    return { w, h, colores: colores.size };
  }
}
