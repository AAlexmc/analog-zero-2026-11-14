// Rejilla global y lectura de bytes según docs/contrato-capas.md. Sin DOM.
export const NA = 254;
export const SIN_DATO = 255;
export const MAX_DATO = 250;

const normLon = (lon) => ((((lon + 180) % 360) + 360) % 360) - 180;

export function latLonDeCelda(r, fila, col) {
  return { lat: r.lat0 - fila * r.paso, lon: r.lon0 + col * r.paso };
}

export function celdaDeLatLon(r, lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  // Los bordes norte y sur de la rejilla (±90°) caen en la primera y la última fila.
  const norte = r.lat0 + r.paso / 2, sur = r.lat0 - (r.alto - 0.5) * r.paso;
  if (lat > norte || lat < sur) return null;
  const fila = Math.min(r.alto - 1, Math.max(0, Math.round((r.lat0 - lat) / r.paso)));
  let col = Math.round((normLon(lon) - r.lon0) / r.paso);
  col = ((col % r.ancho) + r.ancho) % r.ancho;
  return { fila, col };
}

// x, y en unidades de celda desde la esquina noroeste del mapa.
export function celdaDePosicion(r, x, y) {
  const fila = Math.floor(y), col = Math.floor(x);
  if (fila < 0 || fila >= r.alto || col < 0 || col >= r.ancho) return null;
  return { fila, col };
}

export function posicionDeLatLon(r, lat, lon) {
  return { x: (normLon(lon) - r.lon0) / r.paso + 0.5, y: (r.lat0 - lat) / r.paso + 0.5 };
}

export function esCategorico(canal) {
  return /^litologia/.test(canal?.id ?? '');
}

export function valorByte(byte, canal) {
  if (byte === SIN_DATO) return { tipo: 'sin_dato' };
  if (byte === NA) return { tipo: 'na' };
  if (byte > MAX_DATO) return { tipo: 'sin_dato' };
  if (esCategorico(canal)) return { tipo: 'clase', codigo: byte };
  return { tipo: 'valor', v: (canal?.offset ?? 0) + byte * (canal?.scale ?? 1) };
}

// Canal G de c_*: bit i = puerta i fallada, bit 4+i = puerta i sin dato.
export function leerPuertas(g, puertas) {
  return (puertas ?? []).map((p, i) => ({ ...p, estado: (g >> i) & 1 ? 'falla' : (g >> (4 + i)) & 1 ? 'sin_dato' : 'pasa' }));
}

export function estadoCelda(sR, cG) {
  if (cG === SIN_DATO) return 'oceano';
  if (cG & 0x0f) return 'falla_puerta';
  if (sR === SIN_DATO) return 'no_evaluable';
  return 'evaluable';
}

export function distanciaCeldas(a, b, ancho) {
  const dc = Math.abs(a.col - b.col);
  return Math.max(Math.abs(a.fila - b.fila), Math.min(dc, ancho - dc));
}

// Lugares a ≤ max celdas (Chebyshev, con vuelta en longitud), del más cercano al más lejano.
export function cercanos(r, celda, lugares, max = 1) {
  const out = [];
  for (const l of lugares ?? []) {
    const c = celdaDeLatLon(r, l.lat, l.lon);
    if (!c) continue;
    const d = distanciaCeldas(celda, c, r.ancho);
    if (d <= max) out.push({ ...l, distancia: d });
  }
  return out.sort((a, b) => a.distancia - b.distancia);
}

// Bordes tierra/océano como segmentos [x0, y0, x1, y1] en unidades de celda; tramos seguidos se unen.
export function segmentosCosta(tierra, ancho, alto) {
  const seg = [];
  for (let f = 0; f < alto; f++) {
    let ini = -1;
    for (let c = 0; c <= ancho; c++) {
      const borde = c < ancho && f + 1 < alto && tierra[f * ancho + c] !== tierra[(f + 1) * ancho + c];
      if (borde && ini < 0) ini = c;
      if (!borde && ini >= 0) { seg.push([ini, f + 1, c, f + 1]); ini = -1; }
    }
  }
  for (let c = 0; c + 1 < ancho; c++) {
    let ini = -1;
    for (let f = 0; f <= alto; f++) {
      const borde = f < alto && tierra[f * ancho + c] !== tierra[f * ancho + c + 1];
      if (borde && ini < 0) ini = f;
      if (!borde && ini >= 0) { seg.push([c + 1, ini, c + 1, f]); ini = -1; }
    }
  }
  return seg;
}
