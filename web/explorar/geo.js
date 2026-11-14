// Esfera del globo ↔ latitud/longitud. Marco del globo (el de SphereGeometry de three.js con textura
// equirrectangular de lon −180 a la izquierda): +Y norte, +X lon 0°, −Z lon 90° E. Longitud este positiva, (−180, 180].
const RAD = Math.PI / 180;

export const normLon = (l) => { const v = ((l + 180) % 360 + 360) % 360 - 180; return v === -180 ? 180 : v; };

export function latLonAVector(lat, lon, r = 1) {
  const f = lat * RAD, l = lon * RAD;
  return { x: r * Math.cos(f) * Math.cos(l), y: r * Math.sin(f), z: -r * Math.cos(f) * Math.sin(l) };
}

export function vectorALatLon({ x, y, z }) {
  const r = Math.hypot(x, y, z);
  if (!(r > 0)) return null;
  const lat = Math.asin(Math.max(-1, Math.min(1, y / r))) / RAD;
  const h = Math.hypot(x, z);
  return { lat, lon: h < 1e-12 * r ? 0 : normLon(Math.atan2(-z, x) / RAD) };
}

// Primer corte del rayo (origen + t·dir, t ≥ 0) con la esfera de radio r centrada en el origen; null si no la toca.
export function rayoEsfera(o, d, r = 1) {
  const a = d.x * d.x + d.y * d.y + d.z * d.z;
  const b = 2 * (o.x * d.x + o.y * d.y + o.z * d.z);
  const c = o.x * o.x + o.y * o.y + o.z * o.z - r * r;
  const disc = b * b - 4 * a * c;
  if (!(a > 0) || disc < 0) return null;
  const s = Math.sqrt(disc);
  let t = (-b - s) / (2 * a);
  if (t < 0) t = (-b + s) / (2 * a);
  if (t < 0) return null;
  return { x: o.x + t * d.x, y: o.y + t * d.y, z: o.z + t * d.z };
}

export function distanciaAngular(lat1, lon1, lat2, lon2) {
  const a = Math.sin((lat2 - lat1) * RAD / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin((lon2 - lon1) * RAD / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(a))) / RAD;
}

export function formatoLatLon(lat, lon, dec = 2) {
  const n = (v) => Math.abs(v).toFixed(dec);
  const la = Number(n(lat)) === 0 ? `${n(0)}°` : `${n(lat)}° ${lat > 0 ? 'N' : 'S'}`;
  const lo = Number(n(lon)) === 0 || Number(n(lon)) === 180 ? `${n(lon)}°` : `${n(lon)}° ${lon > 0 ? 'E' : 'W'}`;
  return { lat: la, lon: lo, texto: `${la}, ${lo}` };
}
