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
void main() {
  vec2 tc = position.xz / uLado + 0.5;
  float h = textureLod(uAlt, tc, 0.0).r;
  vTc = tc; vXZ = position.xz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position.x, (h - uZc) / 1000.0 * uExag, position.z, 1.0);
}`;

const FS = /* glsl */`
uniform sampler2D uAlt, uSombra, uCapa, uAgua;
uniform float uN, uM, uGain, uAmb, uZmin, uZmax, uCurva, uRkm;
uniform vec3 uSol;
uniform int uModo, uCapaModo, uHayAgua;
uniform vec2 uCapaRango;
uniform vec3 uPincel;
varying vec2 vTc;
varying vec2 vXZ;
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
      if (uCapaModo == 2) {
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
  gl_FragColor = vec4(col, 1.0);
}`;

const MODOS = { relieve: 0, cota: 1, pendiente: 2 };

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

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x021226);
    contenedor.appendChild(this.renderer.domElement);
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

    const L = n * this.mkm;
    this.ladoKm = L;
    this.uniforms = {
      uAlt: { value: this.tAlt }, uSombra: { value: this.tSombra }, uCapa: { value: this.tCapa }, uAgua: { value: this.tAgua }, uHayAgua: { value: agua ? 1 : 0 },
      uLado: { value: L }, uZc: { value: this.zc }, uExag: { value: 1 },
      uN: { value: n }, uM: { value: this.m }, uGain: { value: 1 }, uAmb: { value: 0.03 },
      uZmin: { value: r.min }, uZmax: { value: r.max }, uCurva: { value: intervaloBonito(Math.max(r.max - r.min, 1) / 20) }, uRkm: { value: meta.georef.radio_m / 1000 },
      uSol: { value: new THREE.Vector3(0, 1, 0) }, uModo: { value: 0 }, uCapaModo: { value: 0 },
      uCapaRango: { value: new THREE.Vector2(0, 1) }, uPincel: { value: new THREE.Vector3(0, 0, -1) },
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

  setExag(e) { this.exag = e; this.uniforms.uExag.value = e; this.geoRayo = null; this.sucio = true; }

  setModo(m) { this.uniforms.uModo.value = MODOS[m]; this.sucio = true; }

  setSol(az, el) {
    this.sol = { az, el };
    const a = az * Math.PI / 180, e = el * Math.PI / 180;
    this.uniforms.uSol.value.set(Math.cos(e) * Math.sin(a), Math.sin(e), -Math.cos(e) * Math.cos(a));
    this.uniforms.uGain.value = 1 / Math.sin(Math.min(e + 20 * Math.PI / 180, Math.PI / 2));
    this.recalcularSombras();
  }

  recalcularSombras() {
    const h = sobrePlanoTangente(this.mostradas, this.n, this.m, this.meta.georef.radio_m);
    this.datosSombra.set(sombras(h, this.n, this.m, this.sol.az, this.sol.el));
    this.tSombra.needsUpdate = true;
    this.sucio = true;
  }

  // capa: {nombre, binaria} o null
  setCapa(nombre, binaria) {
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
    this.uniforms.uCapaModo.value = binaria ? 2 : 1;
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

  dibujar(forzar) {
    if (!this.sucio && !forzar) return false;
    if (!this.contenedor.clientWidth) return false;
    this.sucio = false;
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
