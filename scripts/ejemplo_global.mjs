// Juego de ejemplo SINTÉTICO con la forma de docs/contrato-capas.md, para el mapa con ?ejemplo=1.
// Lee pares, pesos y puertas de umbrales.json; los valores de las celdas son un patrón inventado.
// Uso: node scripts/ejemplo_global.mjs   → web/data/global_ejemplo/
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { deflateSync, crc32 } from 'node:zlib';

const RAIZ = resolve(new URL('..', import.meta.url).pathname);
const SALIDA = join(RAIZ, 'web/data/global_ejemplo');
const W = 720, H = 360, PASO = 0.5, LAT0 = 89.75, LON0 = -179.75;
const FUENTE = 'synthetic example — no source';

const umbrales = JSON.parse(await readFile(join(RAIZ, 'umbrales.json'), 'utf8'));
const sitios = JSON.parse(await readFile(join(RAIZ, 'web/data/sitios_ensayo.json'), 'utf8')).sitios.filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon));
const indice = JSON.parse(await readFile(join(RAIZ, 'web/data/terreno/index.json'), 'utf8'));
const centros = [];
for (const t of indice.terrenos.filter((t) => t.cuerpo === 'tierra')) {
  const m = JSON.parse(await readFile(join(RAIZ, 'web/data/terreno', t.id, 'meta.json'), 'utf8'));
  centros.push(m.centro);
}
const validacion = umbrales.validacion.sitios.filter((s) => Number.isFinite(s.lat));

// ---------- PNG RGBA, alfa 255 ----------
function trozo(tipo, datos) {
  const t = Buffer.from(tipo, 'ascii'), l = Buffer.alloc(4), c = Buffer.alloc(4);
  l.writeUInt32BE(datos.length);
  c.writeUInt32BE(crc32(Buffer.concat([t, datos])) >>> 0);
  return Buffer.concat([l, t, datos, c]);
}
function png(r, g, b) {
  const crudo = Buffer.alloc(H * (W * 4 + 1));
  for (let f = 0; f < H; f++) {
    for (let c = 0; c < W; c++) {
      const i = f * W + c, o = f * (W * 4 + 1) + 1 + c * 4;
      crudo[o] = r[i]; crudo[o + 1] = g[i]; crudo[o + 2] = b[i]; crudo[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), trozo('IHDR', ihdr), trozo('IDAT', deflateSync(crudo, { level: 9 })), trozo('IEND', Buffer.alloc(0))]);
}

// ---------- Patrón ----------
const latDe = (f) => LAT0 - f * PASO, lonDe = (c) => LON0 + c * PASO;
const celda = (lat, lon) => ({ f: Math.round((LAT0 - lat) / PASO), c: Math.round((lon - LON0) / PASO) });
function ruido(lat, lon, k) {
  const a = (lat * Math.PI) / 180, o = (lon * Math.PI) / 180;
  const x = Math.cos(a) * Math.cos(o), y = Math.cos(a) * Math.sin(o), z = Math.sin(a);
  let s = 0;
  for (let j = 1; j <= 4; j++) s += Math.sin(j * 2.1 * x + k * 1.7 + j) * Math.cos(j * 1.9 * y - k * 0.9) * Math.sin(j * 2.3 * z + k * 0.5 + 1) / j;
  return s;
}
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const byte01 = (v) => Math.round(clamp(v) / 0.004);

const tierra = new Uint8Array(W * H);
for (let f = 0; f < H; f++) for (let c = 0; c < W; c++) {
  const lat = latDe(f), lon = lonDe(c);
  tierra[f * W + c] = ruido(lat, lon, 0) > 0.12 || lat < -72 ? 1 : 0;
}
for (const p of [...sitios, ...centros, ...validacion]) {
  const { f, c } = celda(p.lat, p.lon);
  for (let df = -2; df <= 2; df++) for (let dc = -2; dc <= 2; dc++) if (f + df >= 0 && f + df < H) tierra[(f + df) * W + ((c + dc + W) % W)] = 1;
}

const DIMS = ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D8', 'D9'];
const dimVal = (d, lat, lon) => {
  if (d === 'D3' || d === 'D9') return clamp(Math.abs(lat) / 80 + 0.15 * ruido(lat, lon, 3));
  return clamp(0.5 + 0.45 * ruido(lat, lon, DIMS.indexOf(d) + 5));
};
const dimSinDato = (d, lat, lon) => (d === 'D8' && ruido(lat, lon, 21) > 0.3) || (d === 'D2' && lat < -60 && ruido(lat, lon, 22) > 0.2);

const NOMBRE_DIM = { D1: 'Geology and materials', D2: 'Terrain', D3: 'Temperature and light', D4: 'Water, ice, permafrost', D5: 'Dust and wind', D6: 'Biology and habitability', D8: 'Operations (feasibility)', D9: 'Operational cold' };
const NOMBRE_OBJ = { shackleton: 'Shackleton rim', jezero: 'Jezero crater', arcadia: 'Arcadia Planitia' };
const NOMBRE_MIS = { P1: 'Ice drilling', P2: 'Growing in local soil', P3: 'Polar base', P4: 'Mobility and landing', P5: 'Cold and grazing sun' };
const TEXTO_PUERTA = { casquete: 'ice cap fraction <= 0.5', relieve: 'relief over 1 km <= 130 m', permafrost: 'permafrost fraction >= 0.5', aridez: 'aridity index <= 0.20 or n/a from cold', ndvi: 'max NDVI <= 0.3' };
// Puerta fallada o sin dato según un patrón inventado.
function puerta(id, lat, lon) {
  if (id === 'casquete') return lat > 78 || lat < -70 ? 'falla' : 'pasa';
  if (id === 'relieve') return ruido(lat, lon, 31) > 0.62 ? 'falla' : lon > 20 && lon < 30 && Math.abs(lat) < 10 ? 'sin_dato' : 'pasa';
  if (id === 'permafrost') return lat < 0 ? 'sin_dato' : Math.abs(lat) > 55 ? 'pasa' : 'falla';
  if (id === 'aridez') return ruido(lat, lon, 33) > 0.3 ? 'falla' : 'pasa';
  if (id === 'ndvi') return ruido(lat, lon, 34) > 0.35 ? 'falla' : 'pasa';
  return 'pasa';
}

await mkdir(SALIDA, { recursive: true });
const manifiesto = {
  malla: 'synthetic', umbrales_sha256: 'example — not a real run', ejemplo: true,
  rejilla: { ancho: W, alto: H, fila0: 'norte', lon0: LON0, lat0: LAT0, paso: PASO },
  pares: [], canales: {}, dimensiones: NOMBRE_DIM,
  litologia_clases: { 1: 'unconsolidated sediments', 2: 'basic volcanic', 3: 'acid plutonic', 4: 'metamorphic', 5: 'carbonate sedimentary', 6: 'siliciclastic sedimentary' },
};
const s01 = (id, nombre) => ({ id, nombre, unidad: '0-1', scale: 0.004, offset: 0.0 });
const vacio = (id) => ({ id, vacio: true, unidad: '0-1', scale: 0.004, offset: 0.0 });
const nuevo = () => new Uint8Array(W * H).fill(255);
const informePolar = [];

for (const pp of umbrales.pares) {
  const { objetivo, mision } = pp, id = `${objetivo}_${mision}`;
  const mis = umbrales.misiones[mision];
  const pesos = mis.pesos, puertas = mis.puertas.map((p) => ({ id: p.id, texto: TEXTO_PUERTA[p.id] ?? p.id }));
  const S = [nuevo(), nuevo(), nuevo()], Cc = [nuevo(), nuevo(), nuevo()], D = Object.fromEntries(DIMS.map((d) => [d, nuevo()]));
  let nT = 0, nNE = 0, nF = 0, nEvalPuertas = 0, nPasa = 0;
  const evaluables = [];
  for (let f = 0; f < H; f++) for (let c = 0; c < W; c++) {
    const i = f * W + c;
    if (!tierra[i]) continue;
    nT++;
    const lat = latDe(f), lon = lonDe(c);
    let bits = 0;
    const est = puertas.map((p) => puerta(p.id, lat, lon));
    est.forEach((e, k) => { if (e === 'falla') bits |= 1 << k; else if (e === 'sin_dato') bits |= 1 << (4 + k); });
    if (bits & 0x0f) bits &= 0x0f;
    let cob = 0, logS = 0;
    for (const d of DIMS) {
      if (!(d in pesos)) continue;
      if (dimSinDato(d, lat, lon)) continue;
      const v = byte01(dimVal(d, lat, lon));
      D[d][i] = v;
      cob += pesos[d];
    }
    for (const d of DIMS) if (d in pesos && D[d][i] <= 250) logS += pesos[d] * Math.log(Math.max(D[d][i] * 0.004, 0.05));
    const s = cob > 0 ? Math.exp(logS / cob) : NaN;
    Cc[0][i] = byte01(cob); Cc[1][i] = bits; Cc[2][i] = 'D8' in pesos ? D.D8[i] : 255;
    if (!(bits >> 4)) { nEvalPuertas++; if (!(bits & 0x0f)) nPasa++; }
    if (bits & 0x0f) { nF++; S[0][i] = 0; S[1][i] = 0; S[2][i] = 0; continue; }
    if (bits >> 4 || cob < 0.7) { nNE++; continue; }
    S[0][i] = byte01(s); S[1][i] = byte01(s * 0.82); S[2][i] = byte01(Math.min(1, s * 1.12 + 0.02));
    evaluables.push(i);
  }
  const fs = { s: `s_${id}.png`, c: `c_${id}.png`, dim: ['a', 'b', 'c'].map((k) => `dim_${id}_${k}.png`) };
  await writeFile(join(SALIDA, fs.s), png(...S));
  await writeFile(join(SALIDA, fs.c), png(...Cc));
  const grupos = [['D1', 'D2', 'D3'], ['D4', 'D5', 'D6'], ['D8', 'D9', null]];
  for (let k = 0; k < 3; k++) {
    const g = grupos[k];
    await writeFile(join(SALIDA, fs.dim[k]), png(...g.map((d) => (d && d in pesos ? D[d] : nuevo()))));
    manifiesto.canales[fs.dim[k]] = g.map((d) => (d && d in pesos ? s01(d, NOMBRE_DIM[d]) : vacio(d ?? 'libre')));
  }
  manifiesto.canales[fs.s] = [s01('S', 'similarity score'), s01('S_p5', 'similarity score, 5th percentile'), s01('S_p95', 'similarity score, 95th percentile')];
  manifiesto.canales[fs.c] = [s01('C', 'coverage'), { id: 'puertas', nombre: 'gate bits', unidad: 'bits', scale: 1, offset: 0 }, 'D8' in pesos ? s01('F', 'feasibility (D8)') : vacio('F')];

  evaluables.sort((a, b) => S[0][b] - S[0][a] || a - b);
  const dimsPeso = DIMS.filter((d) => d in pesos);
  const cand = evaluables.slice(0, 200).map((i, k) => {
    const f = Math.floor(i / W), c = i % W, lat = latDe(f), lon = lonDe(c);
    const cerca = sitios.find((s) => { const q = celda(s.lat, s.lon); return Math.max(Math.abs(q.f - f), Math.abs(q.c - c)) <= 1; });
    const o = { puesto: k + 1, lat, lon, S: +(S[0][i] * 0.004).toFixed(3), S_p5: +(S[1][i] * 0.004).toFixed(3), S_p95: +(S[2][i] * 0.004).toFixed(3), C: +(Cc[0][i] * 0.004).toFixed(3) };
    for (const d of dimsPeso) o[d] = D[d][i] <= 250 ? +(D[d][i] * 0.004).toFixed(3) : null;
    o.sitio_cercano = cerca?.id ?? '';
    return o;
  });
  const cols = Object.keys(cand[0] ?? {});
  await writeFile(join(SALIDA, `candidatos_${id}.csv`), [cols.join(','), ...cand.map((o) => cols.map((k) => o[k] ?? '').join(','))].join('\n') + '\n');
  await writeFile(join(SALIDA, `candidatos_${id}.geojson`), JSON.stringify({ type: 'FeatureCollection', features: cand.map((o) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [o.lon, o.lat] }, properties: o })) }));

  manifiesto.pares.push({
    id, objetivo, mision, prerregistrado: pp.prerregistrado !== false, nombre_objetivo: NOMBRE_OBJ[objetivo] ?? objetivo, nombre_mision: NOMBRE_MIS[mision] ?? mision,
    pesos, puertas, n_tierra: nT, n_no_evaluables: nNE, n_fallan_puerta: nF, fraccion_tierra_pasa_puertas: +(nPasa / nEvalPuertas).toFixed(4),
    ficheros: fs, candidatos: { csv: `candidatos_${id}.csv`, geojson: `candidatos_${id}.geojson` },
  });
  if (objetivo === 'shackleton') {
    for (const sid of umbrales.validacion.descriptivo_polar.sitios) {
      const s = sitios.find((x) => x.id === sid);
      if (!s) continue;
      const { f, c } = celda(s.lat, s.lon), v = S[0][f * W + c];
      const pct = v <= 250 ? evaluables.filter((i) => S[0][i] >= v).length / evaluables.length : null;
      informePolar.push({ sitio: sid, par: id, percentil_area: pct === null ? null : +(100 * (1 - pct)).toFixed(1) });
    }
  }
}

// Variables crudas: 6 ficheros × 3 canales, patrón inventado.
const VARS = {
  'var_a.png': [['radiacion_kwh_m2_dia', 'solar radiation', 'kWh/m²/day', 0.04, 0], ['t_media_c', 'mean air temperature', '°C', 0.4, -60], ['aridez_ai', 'aridity index', 'index', 0.02, 0]],
  'var_b.png': [['ndvi_max', 'max NDVI', 'index', 0.004, 0], ['soc_g_kg', 'soil organic carbon', 'g/kg', 1, 0], ['ph_h2o', 'soil pH (H₂O)', 'pH', 0.04, 0]],
  'var_c.png': [['rugosidad_tan', 'roughness', 'tan', 0.0004, 0], ['relieve_m', 'relief over 1 km', 'm', 10, 0], ['tiempo_ciudad_h', 'travel time to a city', 'h', 1, 0]],
  'var_d.png': [['nv_dias_m23c', 'days with max ≤ −23 °C', 'days/yr', 1.5, 0], ['nv_dias_0c', 'days with max ≤ 0 °C', 'days/yr', 1.5, 0], ['amplitud_diurna_k', 'diurnal range', 'K', 0.2, 0]],
  'var_e.png': [['permafrost_frac', 'permafrost fraction', 'fraction', 0.004, 0], ['viento_p95_m_s', 'wind P95', 'm/s', 0.1, 0], ['litologia_glim', 'lithology', 'class', 1, 0]],
  'var_f.png': [['f_low', 'low-sun fraction', 'fraction', 0.004, 0], ['elev_solar_max_deg', 'max solar elevation', 'deg', 0.4, 0], ['elev_m', 'elevation', 'm', 25, -500]],
};
let k = 40;
for (const [fich, canales] of Object.entries(VARS)) {
  const out = [nuevo(), nuevo(), nuevo()];
  for (let i = 0; i < W * H; i++) {
    if (!tierra[i]) continue;
    const lat = latDe(Math.floor(i / W)), lon = lonDe(i % W);
    canales.forEach(([id], j) => {
      if (id === 'litologia_glim') { out[j][i] = 1 + Math.floor(clamp(0.5 + 0.5 * ruido(lat, lon, 50), 0, 0.999) * 6); return; }
      if (id === 'aridez_ai' && Math.abs(lat) > 62) { out[j][i] = 254; return; }
      out[j][i] = Math.round(clamp(0.5 + 0.5 * ruido(lat, lon, k + j)) * 250);
    });
  }
  k += 3;
  await writeFile(join(SALIDA, fich), png(...out));
  manifiesto.canales[fich] = canales.map(([id, nombre, unidad, scale, offset]) => ({ id, nombre, unidad, scale, offset, fuente: FUENTE }));
}

await writeFile(join(SALIDA, 'capas.json'), JSON.stringify(manifiesto, null, 1));
await writeFile(join(SALIDA, 'informe_validacion.json'), JSON.stringify({
  ejemplo: true, umbrales_sha256: manifiesto.umbrales_sha256,
  h1: { k: 7, n_sitios: 11, k0: 3, exito: 'k >= 8 of 11 and k >= k0 + 2', nota: 'SYNTHETIC EXAMPLE — invented numbers' },
  h1_s: { n_sitios: 11, n_dentro: 5, n_no_evaluables: 1, nota: 'SYNTHETIC EXAMPLE — invented numbers' },
  h3: { aciertos: 7, de: 9, nota: 'SYNTHETIC EXAMPLE — invented numbers' },
  denominadores: Object.fromEntries(manifiesto.pares.map((p) => [p.id, { n_tierra: p.n_tierra, n_no_evaluables: p.n_no_evaluables }])),
  descriptivo_polar: { tipo: 'descriptive, NOT pre-registered, no threshold', filas: informePolar },
}, null, 1));
console.log(`${manifiesto.pares.length} pairs → ${SALIDA}`);
