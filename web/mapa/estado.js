// Enlace permanente: par, capa vista y celda abierta en la URL.
export function leerURL(search) {
  const q = new URLSearchParams(search);
  const num = (k) => { const v = q.get(k); if (v === null || v.trim() === '') return null; const x = Number(v); return Number.isFinite(x) ? x : null; };
  const lat = num('lat'), lon = num('lon');
  return { ejemplo: q.get('ejemplo') === '1', par: q.get('par'), capa: q.get('capa'), lat: Math.abs(lat) <= 90 ? lat : null, lon: Math.abs(lon) <= 180 ? lon : null };
}

// Puente al visor 3D: pareja con el terreno lunar del objetivo si existe; si no, el terrestre solo.
export function enlaceTerreno(tierra, objetivo, lunares) {
  const a = encodeURIComponent(tierra);
  return objetivo && (lunares ?? []).includes(objetivo)
    ? { href: `terreno/index.html?a=${a}&b=${encodeURIComponent(objetivo)}`, solo: false }
    : { href: `terreno/index.html?solo=${a}`, solo: true };
}

export function escribirURL({ ejemplo, par, capa, lat, lon }) {
  const q = new URLSearchParams();
  if (ejemplo) q.set('ejemplo', '1');
  if (par) q.set('par', par);
  if (capa) q.set('capa', capa);
  if (Number.isFinite(lat) && Number.isFinite(lon)) { q.set('lat', lat.toFixed(2)); q.set('lon', lon.toFixed(2)); }
  return `?${q.toString()}`;
}
