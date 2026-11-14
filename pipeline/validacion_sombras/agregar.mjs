// Fracción iluminada promediando la sombra del visor (web/terreno/calculo.js, sin cambios) sobre posiciones del Sol.
import { sombras } from '../../web/terreno/calculo.js';

const RAD = Math.PI / 180;

// λs cada pasoAz; δ = ε·sin φ con φ en el centro de `fases` intervalos iguales (arcoseno), sin repetir valores.
export function muestrasSol({ pasoAz = 5, fases = 36, oblicuidad = 1.54 } = {}) {
  const lats = [];
  for (let k = 0; k < fases; k++) {
    const phi = (k + 0.5) * 360 / fases;
    if (phi > 90 && phi < 270) continue;
    lats.push(oblicuidad * Math.sin(phi * RAD));
  }
  const out = [];
  for (let lon = 0; lon < 360; lon += pasoAz) for (const lat of lats) out.push({ lon, lat });
  return out;
}

// Sol (lonSol, latSol) visto desde (lat, lon) en ejes de la rejilla estereográfica polar sur:
// azimut horario desde arriba (hacia lon 0 en el polo), elevación sobre el plano tangente.
export function solLocal(lat, lon, lonSol, latSol) {
  const [fi, la, ls, ds] = [lat * RAD, lon * RAD, lonSol * RAD, latSol * RAD];
  const s = [Math.cos(ds) * Math.cos(ls), Math.cos(ds) * Math.sin(ls), Math.sin(ds)];
  const u = [Math.cos(fi) * Math.cos(la), Math.cos(fi) * Math.sin(la), Math.sin(fi)];
  const e = [-Math.sin(la), Math.cos(la), 0];
  const nn = [-Math.sin(fi) * Math.cos(la), -Math.sin(fi) * Math.sin(la), Math.cos(fi)];
  const ex = nn.map((v, i) => Math.sin(la) * v + Math.cos(la) * e[i]);
  const ey = nn.map((v, i) => Math.cos(la) * v - Math.sin(la) * e[i]);
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const az = Math.atan2(dot(s, ex), dot(s, ey)) / RAD;
  return { az: (az + 360) % 360, el: Math.asin(Math.max(-1, Math.min(1, dot(s, u)))) / RAD };
}

// Centro del recorte (georef estereo_polar sur, docs/contrato-terreno.md) en lat/lon.
export function centroRecorte(georef, n, m) {
  const k = (n - 1) / 2, x = georef.x0_m + k * m, y = georef.y0_m - k * m;
  const rho = Math.hypot(x, y);
  const lat = -90 + 2 * Math.atan(rho / (2 * georef.radio_m)) / RAD;
  return { lat, lon: rho === 0 ? 0 : ((Math.atan2(x, y) / RAD) + 360) % 360 };
}

// h − (x·ŝ)·tan(el), x medido desde el centro y ŝ = dirección horizontal hacia el Sol.
export function inclinar(a, n, m, az, el, out = new Float32Array(n * n)) {
  const dc = Math.sin(az * RAD), df = -Math.cos(az * RAD), t = Math.tan(el * RAD) * m, k = (n - 1) / 2;
  for (let f = 0; f < n; f++) {
    const bf = (f - k) * df;
    for (let c = 0; c < n; c++) out[f * n + c] = a[f * n + c] - ((c - k) * dc + bf) * t;
  }
  return out;
}

// sombras() recorta el < 0 a 0; con el Sol bajo el plano se inclina el terreno y se usa el = 0.
export function luz(a, n, m, az, el, tmp) {
  return el >= 0 ? sombras(a, n, m, az, el) : sombras(inclinar(a, n, m, az, el, tmp), n, m, az, 0);
}

export function acumular(a, n, m, soles, cuenta) {
  const tmp = new Float32Array(n * n);
  for (const { az, el } of soles) {
    const s = luz(a, n, m, az, el, tmp);
    for (let i = 0; i < s.length; i++) if (s[i] === 255) cuenta[i]++;
  }
  return cuenta;
}

export function fraccion(cuenta, total, a) {
  const out = new Float32Array(cuenta.length);
  for (let i = 0; i < out.length; i++) out[i] = Number.isFinite(a[i]) ? cuenta[i] / total : NaN;
  return out;
}
