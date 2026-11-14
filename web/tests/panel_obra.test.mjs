import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { defectosFlota, defectosCarretera, defectosPlataforma, mediaCapa, pesosTrapecio, longitudCorte, tiempoFlota, pendienteDiseno, ulp32,
  sobreLimiteTraza, obraCarretera, obraPlataforma, celdasDisco, perfilSvg, fmt, registrarCarretera, carreterasVigentes } from '../terreno/panel_obra.js';
import { Historial } from '../terreno/historial.js';
import { masaCorte, deltaCarretera, perfil } from '../terreno/obra.js';
import { vehiculos } from '../terreno/rutas.js';
import { pendienteGrados } from '../terreno/calculo.js';

const RAD = Math.PI / 180;
const OBRA = JSON.parse(readFileSync(new URL('../data/obra.json', import.meta.url), 'utf8'));
const CAT = JSON.parse(readFileSync(new URL('../data/equipo.json', import.meta.url), 'utf8'));
const eq = (id) => CAT.equipos.find((q) => q.id === id);
const rel = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol * Math.max(Math.abs(b), 1e-300), `${msg ?? ''} ${a} ≠ ${b}`);

test('fleet defaults come from the catalogue: IPEx 42 kg/h and 10 000 kg per lunar day with their quotes, density formula, robots assumed', () => {
  const F = defectosFlota(OBRA, CAT.equipos);
  assert.equal(F.ritmo_kg_h.valor, 42);
  assert.match(F.ritmo_kg_h.ref.cita, /42 kg\/hr/);
  assert.equal(F.mision_kg.valor, 10000);
  assert.match(F.mision_kg.ref.cita, /single lunar day/);
  assert.deepEqual(F.densidad.valor, { rho_inf: 1.92, a: 12.2, b: 18 });
  assert.ok(F.densidad.ref.fuente.startsWith('https://'));
  assert.equal(F.n_robots.ref, null);
  assert.equal('horas_dia_lunar' in F, false);
});

test('an excavation rate without a verified quote is not used', () => {
  const sinVer = CAT.equipos.map((q) => (q.id !== 'ipex' ? q : { ...q, cifras: q.cifras.map((c) => (c.nombre === 'ritmo_excavacion_kg_h' ? { ...c, verificado: false } : c)) }));
  assert.equal(defectosFlota(OBRA, sinVer).ritmo_kg_h, null);
  assert.equal(defectosFlota(null, CAT.equipos).mision_kg, null);
  assert.equal(defectosFlota(null, CAT.equipos).densidad, null);
});

test('road defaults: design grade = vehicle slope limit, width = 2 × cited vehicle width; none when the width is not cited', () => {
  const vs = vehiculos(CAT);
  const ltv = defectosCarretera(vs.find((v) => v.equipo.id === 'ltv'));
  assert.equal(ltv.pendiente.valor, 20);
  assert.match(ltv.pendiente.ref.cita, /20 degrees/);
  assert.equal(ltv.ancho.valor, 4.6);
  assert.equal(ltv.ancho.ref.valor, 2.3);
  const ipex = defectosCarretera(vs.find((v) => v.equipo.id === 'ipex'));
  assert.equal(ipex.pendiente.valor, 15);
  assert.equal(ipex.ancho.valor, null);
});

test('pad defaults: limit from the requirement, landing pad limit from obra.json; diameter from footprint or cited sizes; none without a slope requirement', () => {
  const torre = defectosPlataforma(eq('torre_solar'), OBRA);
  assert.equal(torre.limite.valor, 10);
  assert.equal(torre.limite.de, 'requisito');
  assert.equal(torre.diametro.valor, 6);
  const pista = defectosPlataforma(eq('pista_aterrizaje'), OBRA);
  assert.equal(pista.limite.valor, 5);
  assert.equal(pista.limite.op, '<');
  assert.equal(pista.limite.ref.id, 'pista_pendiente_max_deg');
  assert.equal(pista.diametro.valor, null);
  const ltv = defectosPlataforma(eq('ltv'), OBRA);
  rel(ltv.diametro.valor, Math.hypot(4, 2.3), 1e-15);
  assert.equal(defectosPlataforma(eq('habitat_superficie'), OBRA), null);
  assert.equal(defectosPlataforma(eq('planta_agua'), OBRA), null);
});

test('layer mean skips cells without data and uses the weights; trapezoid weights add up to the length', () => {
  const capa = Float32Array.from([0.2, NaN, 0.6, 1]);
  const m = mediaCapa(capa, [0, 1, 2, 3], [1, 5, 1, 2]);
  rel(m.valor, (0.2 + 0.6 + 2) / 4, 1e-7);
  assert.equal(m.sin_dato, 1);
  assert.equal(mediaCapa(capa, [1]).valor, null);
  const s = Float64Array.from([0, 3, 3 + Math.SQRT2, 10]);
  rel(pesosTrapecio(s).reduce((a, b) => a + b, 0), 10, 1e-15);
});

test('cut length splits the segment where grade and terrain cross', () => {
  const s = Float64Array.from([0, 10, 20]);
  assert.equal(longitudCorte(s, Float64Array.from([1, -1, -1]), Float64Array.from([0, 0, 0])), 5);
  assert.equal(longitudCorte(s, Float64Array.from([0, 0, 0]), Float64Array.from([0, 0, 0])), 0);
  assert.equal(longitudCorte(s, Float64Array.from([2, 2, 1]), Float64Array.from([0, 0, 0])), 20);
});

test('excavation time = mass ÷ (robots × 42 kg/h), not scaled by light; calendar = time ÷ mean illumination on the Moon only', () => {
  const fl = { n_robots: 3, kg_h: 42, mision_kg: 10000 };
  const t = tiempoFlota(126000, fl, { valor: 0.5 }, true);
  assert.equal(t.evaluable, true);
  rel(t.horas, 1000, 1e-15);
  rel(t.dias_tierra, 1000 / 24, 1e-15);
  rel(t.misiones, 12.6, 1e-15);
  rel(t.calendario_dias, 2000 / 24, 1e-15);
  const tierra = tiempoFlota(126000, fl, null, false);
  assert.equal(tierra.calendario_dias, null);
  assert.match(tierra.motivoCalendario, /Earth/);
  assert.match(tiempoFlota(1, fl, { valor: 0 }, true).motivoCalendario, /no sunlight/);
  assert.match(tiempoFlota(1, fl, { valor: null }, true).motivoCalendario, /no illumination/);
  assert.equal(tiempoFlota(1, { ...fl, n_robots: 1.5 }, null, true).evaluable, false);
  assert.equal(tiempoFlota(1, { ...fl, kg_h: null }, null, true).evaluable, false);
  assert.equal(tiempoFlota(0, fl, { valor: 1 }, true).horas, 0);
});

// Cresta: sube a `grados` hasta la columna central y baja igual; las dos puntas a la misma cota se pueden unir.
function cresta(n, m, grados, z0) {
  const g = Math.tan(grados * RAD), a = new Float32Array(n * n), k = Math.floor(n / 2);
  for (let f = 0; f < n; f++) for (let c = 0; c < n; c++) a[f * n + c] = z0 + g * (k - Math.abs(c - k)) * m + 3 * Math.sin(f);
  return { n, m, alturas: a };
}

test('design grade sits one float32 step under the limit: after applying the road on −4000 m heights no step of the trace exceeds the limit', () => {
  assert.equal(ulp32(4096), 2 ** -11);
  const t = cresta(60, 39.0625, 30, -4000);
  const camino = Int32Array.from({ length: 51 }, (_, k) => 30 * 60 + 5 + k);
  const x = obraCarretera({ t, camino, luna: true, pendiente_deg: 20, ancho_m: 4.6, densidad: null, flota: { n_robots: 1, kg_h: 42, mision_kg: 10000 } });
  assert.equal(x.factible, true);
  assert.ok(x.diseno_deg < 20 && x.diseno_deg > 19.99);
  const antes = sobreLimiteTraza(t.alturas, t.n, t.m, camino, 20);
  assert.equal(antes.pasos, 50);
  const d = deltaCarretera(t, camino, x.zp);
  const tras = Float32Array.from(t.alturas, (h, i) => h + d[i]);
  assert.equal(sobreLimiteTraza(tras, t.n, t.m, camino, 20).pasos, 0);
});

test('road result: light = length-weighted mean of the layer along the trace; mass = cut × density over mean cut depth = cut / (width × cut length)', () => {
  const t = cresta(40, 10, 25, 100);
  // Diagonal de (8,8) a (32,32): cruza la cresta en la columna 20; el ondulado por filas deja huecos que rellenar.
  const camino = Int32Array.from({ length: 25 }, (_, k) => (8 + k) * 40 + 8 + k);
  const luz = new Float32Array(40 * 40).fill(NaN);
  camino.forEach((i, k) => { luz[i] = k === 2 ? NaN : ((k * 37) % 10) / 10 + 0.05; });
  const dens = { rho_inf: 1.92, a: 12.2, b: 18 };
  const x = obraCarretera({ t, camino, luz, luna: true, pendiente_deg: 10, ancho_m: 5, densidad: dens, flota: { n_robots: 2, kg_h: 42, mision_kg: 10000 } });
  const p = perfil(t, camino), w = pesosTrapecio(p.s);
  let sw = 0, sv = 0;
  for (let k = 0; k < camino.length; k++) if (Number.isFinite(luz[camino[k]])) { sw += w[k]; sv += w[k] * luz[camino[k]]; }
  rel(x.luz.valor, sv / sw, 1e-12);
  assert.equal(x.luz.sin_dato, 1);
  rel(x.prof_m, x.corte_m3 / (5 * longitudCorte(x.s, x.z, x.zp)), 1e-12);
  rel(x.masa_kg, masaCorte(x.corte_m3, x.prof_m, dens), 1e-12);
  rel(x.flota.horas, x.masa_kg / (2 * 42), 1e-12);
  rel(x.flota.calendario_dias, x.flota.horas / x.luz.valor / 24, 1e-12);
  assert.ok(x.corte_m3 > 0 && x.relleno_m3 > 0);
});

test('on Earth the road gives volumes but no mass and no excavation time', () => {
  const t = cresta(30, 10, 25, 100);
  const camino = Int32Array.from({ length: 21 }, (_, k) => 15 * 30 + 5 + k);
  const x = obraCarretera({ t, camino, luna: false, pendiente_deg: 10, ancho_m: 5, densidad: { rho_inf: 1.92, a: 12.2, b: 18 }, flota: { n_robots: 1, kg_h: 42, mision_kg: 10000 } });
  assert.ok(x.corte_m3 > 0);
  assert.equal(x.masa_kg, null);
  assert.equal(x.motivoMasa, 'lunar regolith density does not apply to this soil');
  assert.equal(x.flota.evaluable, false);
});

test('a road whose two anchored ends cannot be joined at the grade reports why', () => {
  const t = cresta(30, 10, 40, 0);
  const camino = Int32Array.from([15 * 30 + 2, 15 * 30 + 3]);
  const x = obraCarretera({ t, camino, luna: true, pendiente_deg: 10, ancho_m: 5, densidad: null, flota: { n_robots: 1, kg_h: 42 } });
  assert.equal(x.factible, false);
  assert.match(x.motivo, /anchored/);
});

function plano(n, m, grados, z0) {
  const g = Math.tan(grados * RAD), a = new Float32Array(n * n);
  for (let f = 0; f < n; f++) for (let c = 0; c < n; c++) a[f * n + c] = z0 + g * (0.6 * c - 0.8 * f) * m;
  return { n, m, alturas: a };
}

test('pad on a 13° slope with a 10° limit: once applied in float32 the cell slope at the centre is ≤ 10°, never a rounding hair over', () => {
  for (const z0 of [-4000, -1500, 300]) {
    const t = plano(41, 39.0625, 13, z0);
    const x = obraPlataforma({ t, fila: 20, col: 20, diametro_m: 200, limite_deg: 10, luna: true, densidad: { rho_inf: 1.92, a: 12.2, b: 18 }, flota: { n_robots: 1, kg_h: 42, mision_kg: 10000 } });
    assert.equal(x.sub_celda, false);
    rel(x.pend_antes_deg, 13, 1e-4);
    const tras = Float32Array.from(t.alturas, (h, i) => h + x.delta[i]);
    const s = pendienteGrados(tras, t.n, t.m, 20, 20);
    assert.ok(s <= 10 && s > 9.99, `z0=${z0}: ${s}`);
    assert.ok(x.masa_kg > 0 && x.flota.evaluable);
    assert.equal(x.luz, null);
  }
});

test('pad smaller than 3 cells: analytic wedge, no delta, mean depth over the half disc', () => {
  const t = plano(21, 39.0625, 12, 0);
  const x = obraPlataforma({ t, fila: 10, col: 10, diametro_m: 6, limite_deg: 10, luz: new Float32Array(441).fill(0.7), luna: true, densidad: { rho_inf: 1.92, a: 12.2, b: 18 }, flota: { n_robots: 1, kg_h: 42, mision_kg: 10000 } });
  assert.equal(x.sub_celda, true);
  assert.equal(x.delta, null);
  rel(x.prof_m, x.corte_m3 / (Math.PI * 9 / 2), 1e-12);
  rel(x.luz.valor, 0.7, 1e-7);
});

test('disc cells follow the same rule as the pad (distance to centre ≤ radius)', () => {
  const idx = celdasDisco(10, 2, 5, 5, 4.1);
  assert.deepEqual(idx.sort((a, b) => a - b), [45, 54, 55, 56, 65]);
});

test('trace counts: steps steeper than the limit and cells whose slope is over it', () => {
  const t = cresta(20, 10, 30, 0);
  const r = sobreLimiteTraza(t.alturas, 20, 10, Int32Array.from([10 * 20 + 3, 10 * 20 + 4, 11 * 20 + 4]), 20);
  assert.equal(r.total, 3);
  assert.equal(r.pasos, 1);
  assert.equal(r.celdas, 3);
});

test('long section SVG has cut and fill polygons and draws nothing for a single point', () => {
  const svg = perfilSvg(Float64Array.from([0, 10, 20]), Float64Array.from([5, 0, 5]), Float64Array.from([2, 2, 2]));
  assert.match(svg, /class="corte"/);
  assert.match(svg, /class="relleno"/);
  assert.doesNotMatch(svg, /NaN/);
  assert.equal(perfilSvg(Float64Array.from([0]), Float64Array.from([1]), Float64Array.from([1])), '');
});

test('formats: thin-space thousands, tonnes from 10 t, days and hours', () => {
  assert.equal(fmt.m3(1364634.4), '1 364 634 m³');
  assert.equal(fmt.masa(2.6e9), '2 600 000 t');
  assert.equal(fmt.masa(950), '950 kg');
  assert.equal(fmt.dias(12.34), '12.3');
  assert.equal(fmt.horas(12345.6), '12 346 h');
  assert.equal(fmt.km(37243.86), '37.24 km');
  assert.equal(fmt.m3(NaN), '—');
});

// Carretera aplicada como retoque: la lista de carreteras que ven las rutas sale del historial y del delta actual.
function aplicarComoObra(h, delta, camino, valores) {
  const nuevo = Float32Array.from(delta);
  camino.forEach((i, k) => { nuevo[i] = delta[i] + valores[k]; });
  const paso = h.reemplazar(delta, nuevo);
  registrarCarretera(paso, camino, delta);
  return paso;
}

test('applied road lives with its retouch: undo removes it from routing, redo brings it back', () => {
  const h = new Historial(), delta = new Float32Array(25), camino = Int32Array.from([5, 6, 7, 8]);
  aplicarComoObra(h, delta, camino, [-1, -2, 0, 1.5]);
  assert.deepEqual(carreterasVigentes(h.pasos, delta).map((c) => Array.from(c)), [[5, 6, 7, 8]]);
  h.deshacer(delta);
  assert.deepEqual(carreterasVigentes(h.pasos, delta), []);
  h.rehacer(delta);
  assert.deepEqual(carreterasVigentes(h.pasos, delta).map((c) => Array.from(c)), [[5, 6, 7, 8]]);
});

test('a later retouch on a road cell cuts the road there; reset removes it', () => {
  const h = new Historial(), delta = new Float32Array(25), camino = Int32Array.from([5, 6, 7, 8, 9]);
  aplicarComoObra(h, delta, camino, [-1, -2, -3, -2, -1]);
  const pincel = Float32Array.from(delta);
  pincel[7] += 0.5;
  h.reemplazar(delta, pincel);
  assert.deepEqual(carreterasVigentes(h.pasos, delta).map((c) => Array.from(c)), [[5, 6], [8, 9]]);
  h.reemplazar(delta, new Float32Array(25));
  assert.deepEqual(carreterasVigentes(h.pasos, delta), []);
});

test('no applied road, no list: a pad or a brush stroke is not a road', () => {
  const h = new Historial(), delta = new Float32Array(9);
  const nuevo = Float32Array.from(delta);
  nuevo[4] = 2;
  h.reemplazar(delta, nuevo);
  assert.deepEqual(carreterasVigentes(h.pasos, delta), []);
  assert.deepEqual(carreterasVigentes([], delta), []);
});
