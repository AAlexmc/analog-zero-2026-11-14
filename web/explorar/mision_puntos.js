// Puntos de una misión en la Luna o Marte: los lugares de ese mundo que más se parecen al sitio de la Tierra donde NASA
// hace el ensayo, con los parámetros de la misión que ese mundo tiene medidos. Es la búsqueda de análogos al revés. Sin DOM.
export const LETRAS = 'ABCDE';
const RAD = Math.PI / 180;

export function distanciaKm(a, b, radio_km) {
  const h = Math.sin(((b.lat - a.lat) * RAD) / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(((b.lon - a.lon) * RAD) / 2) ** 2;
  return 2 * radio_km * Math.asin(Math.min(1, Math.sqrt(h)));
}

// De mayor a menor parecido: los primeros `cuantos` separados al menos separacion_km y que pasan apta(lat, lon)
// (asíncrona; null = sin filtro). tope = candidatos que se llegan a comprobar con apta.
export async function elegirPuntos(candidatos, { cuantos = LETRAS.length, separacion_km, radio_km, apta = null, tope = 600 }) {
  const puntos = [];
  let revisados = 0;
  for (const c of candidatos) {
    if (puntos.length >= cuantos || revisados >= tope) break;
    if (puntos.some((p) => distanciaKm(p, c, radio_km) < separacion_km)) continue;
    revisados++;
    if (apta && !(await apta(c.lat, c.lon))) continue;
    puntos.push({ ...c, letra: LETRAS[puntos.length] });
  }
  return { puntos, revisados };
}

// M = motor; mundo = {id, radio_km}; activa = misión activa (parametros, referencia) o null;
// ambito(lat, lon) = filtro rápido de zona; apta = filtro fino asíncrono (zona y límites del paso 2);
// limites = si el paso 2 tiene límites de NASA (si no, apta solo recorta a la zona que se puntúa).
export async function puntosDeMision({ M, mundo, activa, separacion_km, ambito = null, apta = null, limites = false }) {
  if (!activa) return { estado: 'sin_mision', puntos: [] };
  const ref = activa.referencia ?? null;
  if (!ref) return { estado: 'sin_referencia', puntos: [] };
  const valoresRef = M.leerPunto('earth', ref.lat, ref.lon).valores;
  const r = M.parecidosEnCuerpo(mundo.id, valoresRef, activa.parametros, { filtro: ambito });
  const base = { ref, valoresRef, usados: r.usados, sin_capa: r.sin_capa, sin_referencia: r.sin_referencia, celdas: r.celdas, empatadas: r.empatadas, conLimites: !!apta && limites, conZona: !!apta && !limites, puntos: [] };
  if (!r.usados.length) return { ...base, estado: 'sin_parametros' };
  const { puntos, revisados } = await elegirPuntos(r.candidatos, { separacion_km, radio_km: mundo.radio_km, apta });
  return { ...base, estado: puntos.length ? 'ok' : 'sin_lugar', puntos, revisados };
}

const lista = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);

// Frases del panel (texto plano). corto(id) = nombre corto del parámetro; en = «on the Moon» / «on Mars».
export function frasesPuntos(res, { corto, en }) {
  if (!res || res.estado === 'sin_mision') return null;
  const titulo = `Where ${en} this test fits`;
  if (res.estado === 'sin_referencia') return { titulo, lineas: ['This mission has no test site with coordinates, so there is nothing to look for here.'], nota: null, corta: 'This mission has no test site with coordinates.' };
  const soloTierra = [res.sin_capa.length ? `Earth only, not ${en}: ${lista(res.sin_capa.map(corto))}.` : null,
    res.sin_referencia?.length ? `No value at the test site, so not used: ${lista(res.sin_referencia.map(corto))}.` : null].filter(Boolean).join(' ') || null;
  const donde = res.conLimites ? ", among those that meet NASA's limits in step 2" : res.conZona ? ', inside the area searched in step 2' : '';
  if (res.estado === 'sin_parametros') {
    return { titulo, lineas: [`Every parameter of this mission is Earth only (${lista(res.sin_capa.map(corto))}): there is nothing ${en} to rank.`, 'The numbered spots come from step 2, not from the mission.'], nota: null, corta: 'Every parameter of this mission is Earth only.' };
  }
  const con = lista(res.usados.map(corto));
  if (res.estado === 'sin_lugar') return { titulo, lineas: [`No place ${en}${res.conLimites ? " that meets NASA's limits in step 2" : res.conZona ? ' inside the area searched in step 2' : ''} could be compared in ${con}.`], nota: soloTierra, corta: `No place ${en} could be compared.` };
  const n = res.puntos.length;
  const lineas = [`${n === 1 ? `${LETRAS[0]} on the globe: the place` : `${LETRAS[0]}–${LETRAS[n - 1]} on the globe: the places`} ${en} most like ${res.ref.nombre}, where NASA ran this test, in ${con}${donde}. Own metric, year averages.`];
  if (res.puntos.length < LETRAS.length) lineas.push(`Only ${res.puntos.length} ${res.puntos.length === 1 ? 'place' : 'places'} far enough apart.`);
  // Criterio propio: se avisa cuando al menos 1 de cada 20 celdas comparadas empata con la mejor.
  if (res.celdas > 0 && res.empatadas / res.celdas >= 0.05) lineas.push(`${Math.round((100 * res.empatadas) / res.celdas)} % of the grid cells compared ${en} are within half a point of the best: with ${res.usados.length === 1 ? 'one parameter' : 'these parameters'}, much of it looks alike, and these are ${n} of them spread apart.`);
  return { titulo, lineas, nota: soloTierra, corta: null };
}
