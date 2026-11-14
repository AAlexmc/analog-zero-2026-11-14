// Generador de base sobre terrenos reales: posiciones, holguras, volúmenes, tiempo y recomprobación independiente.
// Uso: node scripts/probar_base.mjs [--nMaxRutas=<n>|Infinity] [id…]   (por defecto shackleton_borde cresta_shackleton_gerlache, rejilla completa)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { generarBase } from '../web/terreno/base.js';
import { pendientes, vehiculos } from '../web/terreno/rutas.js';
import { plataforma } from '../web/terreno/obra.js';
import { pixelALatLon } from '../web/terreno/georef.js';

const RAD = Math.PI / 180;
const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const leerJson = (p) => JSON.parse(readFileSync(path.join(raiz, p), 'utf8'));
const args = process.argv.slice(2), banderas = args.filter((a) => a.startsWith('--')), posicionales = args.filter((a) => !a.startsWith('--'));
const ids = posicionales.length ? posicionales : ['shackleton_borde', 'cresta_shackleton_gerlache'];
const nMaxRutas = Number(banderas.find((a) => a.startsWith('--nMaxRutas='))?.split('=')[1] ?? Infinity);
if (!(nMaxRutas > 0)) throw new Error('--nMaxRutas must be a number > 0 or Infinity');

const catalogo = leerJson('web/data/equipo.json');
const obra = leerJson('web/data/obra.json');
const conceptos = leerJson('web/data/conceptos.json');
const equipo = (id) => catalogo.equipos.find((q) => q.id === id);
const cifra = (id, nombre) => {
  const c = (equipo(id).cifras ?? []).find((x) => x.nombre === nombre);
  if (!(c && Number.isFinite(c.valor) && c.verificado === true && c.fuente)) throw new Error(`${id}.${nombre}: no cited figure in equipo.json`);
  return c;
};
const constante = (id) => {
  const c = obra.constantes.find((x) => x.id === id);
  if (!(c && Number.isFinite(c.valor) && c.verificado === true)) throw new Error(`${id}: no checked constant in obra.json`);
  return c;
};

function cargar(id) {
  const dir = path.join(raiz, 'web/data/terreno', id);
  const meta = JSON.parse(readFileSync(path.join(dir, 'meta.json'), 'utf8'));
  const n = meta.n;
  const capa = (c) => {
    const b = readFileSync(path.join(dir, c.fichero));
    if (c.tipo === 'uint8') {
      if (b.length !== n * n) throw new Error(`${id}/${c.fichero}: size ${b.length}`);
      const f = new Float32Array(n * n);
      for (let i = 0; i < f.length; i++) f[i] = b[i] === 255 ? NaN : b[i];
      return f;
    }
    if (b.length !== n * n * 4) throw new Error(`${id}/${c.fichero}: size ${b.length}`);
    return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  };
  const capas = {};
  for (const [nombre, c] of Object.entries(meta.capas)) if (nombre !== 'altura') capas[nombre] = capa(c);
  return { meta, t: { n, m: meta.m_por_px, alturas: capa(meta.capas.altura), capas } };
}

// Medidas: cited = cifra del catálogo usada tal cual; derived = cifra citada con un uso propio; assumed = sin cita.
function medidas() {
  const hab = cifra('habitat_superficie', 'diametro_m'), rea = cifra('reactor_fision', 'ancho_m');
  const pis = cifra('pista_aterrizaje', 'distancia_entre_zonas_m'), tor = cifra('torre_solar', 'ancho_paneles_m');
  const pa = conceptos.conceptos.find((c) => c.id === 'planta_agua_concepto');
  const par = (k) => pa.parametros.find((x) => x.nombre === k);
  const largo = par('largo_m'), ancho = par('ancho_m');
  const ltv = cifra('ltv', 'ancho_m');
  return {
    habitat: { valor: hab.valor, rotulo: 'cited', de: `habitat_superficie.diametro_m (${hab.texto})` },
    reactor: { valor: rea.valor, rotulo: 'cited', de: `reactor_fision.ancho_m (${rea.texto})` },
    pista: { valor: pis.valor, rotulo: 'derived (mío)', de: `pista_aterrizaje.distancia_entre_zonas_m used as pad diameter` },
    torre: { valor: tor.valor, rotulo: 'derived (mío)', de: `torre_solar.ancho_paneles_m used as footprint diameter (tower base not public)` },
    agua: { valor: Math.hypot(largo.valor, ancho.valor), rotulo: 'assumed', de: `circle around the ${largo.valor} × ${ancho.valor} m planta_agua_concepto (conceptos.json, supuesto)` },
    carretera: { valor: ltv.valor, rotulo: 'assumed', de: `road width = LTV CLV-1 deployed width ${ltv.valor} m (cited), no margin` },
  };
}

function piezasDe(M, umbralHielo) {
  return [
    { id: 'habitat', equipo: equipo('habitat_superficie'), diametro_m: M.habitat.valor, criterios: [{ id: 'iluminacion', beneficio: true, peso: 1 }] },
    { id: 'reactor', equipo: equipo('reactor_fision'), diametro_m: M.reactor.valor, criterios: [{ id: 'pendiente', beneficio: false, peso: 1 }] },
    { id: 'pista', equipo: equipo('pista_aterrizaje'), diametro_m: M.pista.valor, criterios: [{ id: 'pendiente', beneficio: false, peso: 1 }] },
    { id: 'torre', equipo: equipo('torre_solar'), diametro_m: M.torre.valor, criterios: [{ id: 'iluminacion', beneficio: true, peso: 1 }] },
    { id: 'agua', equipo: equipo('planta_agua'), diametro_m: M.agua.valor, criterios: [{ id: 'dist_frio', umbral_k: umbralHielo, beneficio: false, peso: 1 }] },
  ];
}

// Sin pasar por base.js: celda, plataforma, separaciones, huellas, rutas a pie de vehículo, rasante y huellas pisadas.
function recomprobar(t, piezas, lv, opc, r) {
  const { n, m, alturas, capas } = t;
  const pd = pendientes(alturas, n, m), errores = [];
  const mal = (s) => errores.push(s);
  const lim = (p) => {
    const ls = (p.equipo.requisitos ?? []).filter((q) => q.variable === 'pendiente_deg' && Number.isFinite(q.valor)).map((q) => q.valor);
    return ls.length ? Math.min(...ls) : lv;
  };
  const porId = new Map(r.piezas.map((p) => [p.id, p]));
  for (const p of piezas) {
    const s = porId.get(p.id);
    if (!s) { mal(`missing piece ${p.id}`); continue; }
    const i = s.fila * n + s.col;
    if (!(pd[i] <= lim(p))) mal(`${p.id}: cell slope ${pd[i]} > ${lim(p)}`);
    if (capas.sombra_permanente[i] !== 0) mal(`${p.id}: on permanent shadow (${capas.sombra_permanente[i]})`);
    const pl = plataforma(t, s.fila, s.col, p.diametro_m, lim(p));
    if (!(pl.pend_despues_deg <= lim(p) + 1e-9)) mal(`${p.id}: platform slope after levelling ${pl.pend_despues_deg} > ${lim(p)}`);
  }
  for (let a = 0; a < piezas.length; a++) for (let b = a + 1; b < piezas.length; b++) {
    const A = porId.get(piezas[a].id), B = porId.get(piezas[b].id);
    if (!A || !B) continue;
    const d = Math.hypot(A.fila - B.fila, A.col - B.col) * m;
    if (d - (piezas[a].diametro_m + piezas[b].diametro_m) / 2 < opc.separacionHuellas_m - 1e-9) mal(`${piezas[a].id}-${piezas[b].id}: footprints overlap (${d.toFixed(1)} m)`);
    for (const [x, y] of [[piezas[a], piezas[b]], [piezas[b], piezas[a]]]) for (const q of x.equipo.requisitos ?? []) {
      if (q.variable === 'separacion_m' && q.respecto_a === y.equipo.id && Number.isFinite(q.valor) && !(d >= q.valor)) mal(`${x.id}: ${d.toFixed(1)} m from ${y.id} < ${q.valor} m`);
    }
  }
  const k = Math.tan(lv * RAD), hub = r.piezas.find((p) => p.hub);
  for (const c of r.carreteras) {
    const cam = Array.from(c.traza), dest = porId.get(c.hasta);
    if (cam[0] !== hub.i || cam[cam.length - 1] !== dest.i) mal(`${c.hasta}: path does not join the habitat and the piece`);
    const s = [0];
    for (let j = 1; j < cam.length; j++) {
      const df = Math.abs(Math.floor(cam[j] / n) - Math.floor(cam[j - 1] / n)), dc = Math.abs((cam[j] % n) - (cam[j - 1] % n));
      if (Math.max(df, dc) !== 1) mal(`${c.hasta}: step ${j} not between neighbours`);
      s.push(s[j - 1] + Math.hypot(df, dc) * m);
    }
    if (c.tipo === 'ruta') {
      const sobre = cam.filter((i) => !(pd[i] <= lv)).length;
      if (sobre) mal(`${c.hasta}: plain route crosses ${sobre} cells over ${lv}°`);
    } else {
      const zp = Array.from(c.zp);
      for (let j = 1; j < zp.length; j++) if (Math.abs(zp[j] - zp[j - 1]) > k * (s[j] - s[j - 1]) + 1e-6) mal(`${c.hasta}: road grade over ${lv}° at step ${j}`);
      if (Math.abs(zp[0] - alturas[cam[0]]) > 1e-6 || Math.abs(zp[zp.length - 1] - alturas[cam[cam.length - 1]]) > 1e-6) mal(`${c.hasta}: road not anchored at both ends`);
    }
    for (const p of r.piezas) {
      if (p.hub || p.id === c.hasta) continue;
      const R = p.diametro_m / 2;
      const pisa = cam.slice(1, -1).filter((i) => Math.hypot(Math.floor(i / n) - p.fila, (i % n) - p.col) * m < R + opc.anchoCarretera_m / 2);
      if (pisa.length) mal(`${c.hasta}: ${c.tipo} crosses the ${p.id} footprint at ${pisa.length} cells`);
    }
  }
  for (const q of r.restricciones) if (!(q.holgura >= -1e-9) && q.holgura !== null) mal(`constraint ${q.tipo} ${q.pieza ?? ''} slack ${q.holgura}`);
  return errores;
}

const f1 = (x) => (Number.isFinite(x) ? (Math.abs(x) >= 100 ? x.toFixed(0) : x.toFixed(2)) : String(x));
const M = medidas(), hielo = constante('hielo_superficie_temp_max_k');
const ltv = vehiculos(catalogo).find((v) => v.equipo.id === 'ltv');
console.log('measures:');
for (const [k, v] of Object.entries(M)) console.log(`  ${k.padEnd(9)} ${f1(v.valor)} m  ${v.rotulo.padEnd(14)} ${v.de}`);
console.log(`  ice      temp_max ≤ ${hielo.valor} K  cited  obra.json hielo_superficie_temp_max_k`);
console.log(`  vehicle  ltv ≤ ${ltv.limite}°  cited  ${ltv.req.fuente}`);

let fallo = 0;
for (const id of ids) {
  const { meta, t } = cargar(id);
  const piezas = piezasDe(M, hielo.valor);
  const opc = { anchoCarretera_m: M.carretera.valor, separacionHuellas_m: 0, nMaxRutas, separacionCandidatos_m: 200 };
  const t0 = performance.now();
  const r = generarBase(t, piezas, ltv, opc);
  const seg = (performance.now() - t0) / 1000;
  console.log(`\n== ${id} (${t.n}×${t.n}, ${t.m} m/px): ${seg.toFixed(1)} s wall`);
  if (!r.factible) {
    console.log(`  infeasible: ${r.restriccion?.tipo ?? '—'} · ${r.motivo}`);
    if (!r.restriccion?.tipo) fallo = 1;
    continue;
  }
  for (const p of r.piezas) {
    const ll = pixelALatLon(meta, p.fila, p.col);
    const pl = p.plataforma;
    console.log(`  ${p.id.padEnd(8)} fila ${p.fila} col ${p.col}  lat ${ll.lat.toFixed(5)} lon ${ll.lon.toFixed(4)}  Ø ${f1(p.diametro_m)} m  slope ${f1(pl.pend_antes_deg)}°→${f1(pl.pend_despues_deg)}° (≤ ${p.limite_pend_deg}°, ${p.limite_origen})  cut ${f1(pl.corte_m3)} fill ${f1(pl.relleno_m3)} m³`);
    for (const q of r.restricciones.filter((x) => x.pieza === p.id)) {
      console.log(`      ${q.tipo}${q.con ? ` vs ${q.con}` : ''}${q.variable ? ` ${q.variable}` : ''} ${q.op} ${q.limite}: value ${f1(q.valor)} slack ${f1(q.holgura)}`);
    }
  }
  for (const c of r.carreteras) {
    console.log(`  ${c.desde}→${c.hasta}: ${c.tipo}, ${f1(c.longitud_m)} m, ${c.traza.length} cells, cut ${f1(c.corte_m3)} fill ${f1(c.relleno_m3)} m³, max cut ${f1(c.corte_max_m)} m, max fill ${f1(c.relleno_max_m)} m`);
  }
  const T = r.totales, b = r.busqueda;
  console.log(`  totals: pads cut ${f1(T.plataformas_corte_m3)} fill ${f1(T.plataformas_relleno_m3)} m³ · roads cut ${f1(T.carreteras_corte_m3)} fill ${f1(T.carreteras_relleno_m3)} m³ · routes ${f1(T.rutas_m)} m · objective ${f1(r.objetivo.total)} (${r.objetivo.origen})`);
  console.log(`  search: ${b.metodo}, optimo_probado ${b.optimo_probado}, routes ${b.rutas_evaluadas}, nodes ${b.nodos}, hub candidates ${b.candidatos_hub}, k ${b.k}, lower bound ${f1(b.cota_inferior)}, routing grid ${b.rejilla_rutas.n}${b.rejilla_rutas.diezmado ? ' (decimated)' : ''}`);
  for (const s of r.por_medir) console.log(`  por_medir: ${s}`);
  const errores = recomprobar(t, piezas, ltv.limite, opc, r);
  console.log(errores.length ? `  RECHECK FAILED:\n    ${errores.join('\n    ')}` : '  recheck: separations, footprints, pad slopes, routes, road grades and crossings OK');
  if (errores.length) fallo = 1;
}
process.exit(fallo);
