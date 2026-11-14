// Plano local ↔ lat/lon según docs/contrato-terreno.md (esfera de radio radio_m).
const RAD = Math.PI / 180;

const normLon = (l) => { const v = ((l + 180) % 360 + 360) % 360 - 180; return v === -180 ? 180 : v; };

export function centroPixel(meta, fila, col) {
  const g = meta.georef;
  return { x: g.x0_m + col * meta.m_por_px, y: g.y0_m - fila * meta.m_por_px };
}

export function pixelDeXY(meta, x, y) {
  const g = meta.georef;
  return { fila: (g.y0_m - y) / meta.m_por_px, col: (x - g.x0_m) / meta.m_por_px };
}

export function xyALatLon(meta, x, y) {
  const g = meta.georef;
  const R = g.radio_m;
  if (g.tipo === 'estereo_polar') {
    // Contrato: x hacia lon 90° E, y hacia lon 0° (en los dos polos).
    const rho = Math.hypot(x, y);
    const c = 2 * Math.atan(rho / (2 * R));
    const lat = g.polo === 'sur' ? -90 + c / RAD : 90 - c / RAD;
    return { lat, lon: rho === 0 ? 0 : normLon(Math.atan2(x, y) / RAD) };
  }
  if (g.tipo === 'local_aeqd') {
    const p1 = meta.centro.lat * RAD, l0 = meta.centro.lon * RAD;
    const rho = Math.hypot(x, y);
    if (rho === 0) return { lat: meta.centro.lat, lon: meta.centro.lon };
    const c = rho / R;
    const lat = Math.asin(Math.cos(c) * Math.sin(p1) + (y * Math.sin(c) * Math.cos(p1)) / rho);
    const lon = l0 + Math.atan2(x * Math.sin(c), rho * Math.cos(p1) * Math.cos(c) - y * Math.sin(p1) * Math.sin(c));
    return { lat: lat / RAD, lon: normLon(lon / RAD) };
  }
  throw new Error(`unknown georef type: ${g.tipo}`);
}

export function latLonAXY(meta, lat, lon) {
  const g = meta.georef;
  const R = g.radio_m;
  if (g.tipo === 'estereo_polar') {
    const c = g.polo === 'sur' ? (lat + 90) * RAD : (90 - lat) * RAD;
    const rho = 2 * R * Math.tan(c / 2);
    return { x: rho * Math.sin(lon * RAD), y: rho * Math.cos(lon * RAD) };
  }
  if (g.tipo === 'local_aeqd') {
    const p1 = meta.centro.lat * RAD, p = lat * RAD, dl = (lon - meta.centro.lon) * RAD;
    const cosc = Math.sin(p1) * Math.sin(p) + Math.cos(p1) * Math.cos(p) * Math.cos(dl);
    const c = Math.acos(Math.max(-1, Math.min(1, cosc)));
    const k = c === 0 ? 1 : c / Math.sin(c);
    return {
      x: R * k * Math.cos(p) * Math.sin(dl),
      y: R * k * (Math.cos(p1) * Math.sin(p) - Math.sin(p1) * Math.cos(p) * Math.cos(dl)),
    };
  }
  throw new Error(`unknown georef type: ${g.tipo}`);
}

export function pixelALatLon(meta, fila, col) {
  const p = centroPixel(meta, fila, col);
  return xyALatLon(meta, p.x, p.y);
}

export function latLonAPixel(meta, lat, lon) {
  const p = latLonAXY(meta, lat, lon);
  return pixelDeXY(meta, p.x, p.y);
}
