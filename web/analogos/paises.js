// País o territorio (Natural Earth 1:110m, web/data/paises_110m.json) que contiene un punto. Sin DOM.

// Par-impar: cuántas veces corta el anillo un rayo hacia el este desde el punto (plano lon/lat).
export function dentroDeAnillo(lon, lat, anillo) {
  let dentro = false;
  for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
    const [xi, yi] = anillo[i], [xj, yj] = anillo[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) dentro = !dentro;
  }
  return dentro;
}

// Nombre del país o null (mar, o costa que a esta escala queda fuera de todo polígono: no se inventa).
export function paisDe(lat, lon, paises) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const x = ((((lon + 180) % 360) + 360) % 360) - 180;
  for (const p of paises ?? []) {
    const [w, s, e, n] = p.caja;
    if (lat < s || lat > n || x < w || x > e) continue;
    for (const poligono of p.poligonos) {
      let dentro = false;
      for (const anillo of poligono) if (dentroDeAnillo(x, lat, anillo)) dentro = !dentro;
      if (dentro) return p.nombre;
    }
  }
  return null;
}
