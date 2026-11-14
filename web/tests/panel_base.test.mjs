import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { medidasBase, separacionPistaDefecto, piezasBase, opcionesBase, trasplantar, filasEnsayo, resumenEnsayo, flotaBase, aligerar, campanasDe, IDS_BASE } from '../terreno/panel_base.js';
import { generarBase } from '../terreno/base.js';
import { defectosFlota } from '../terreno/panel_obra.js';
import { masaCorte } from '../terreno/obra.js';
import { evaluarRequisito, compararRequisito } from '../terreno/evaluar.js';
import { vehiculos } from '../terreno/rutas.js';

const leer = (f) => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url), 'utf8'));
const CAT = leer('equipo.json'), CONC = leer('conceptos.json'), OBRA = leer('obra.json'), SITIOS = leer('sitios_ensayo.json');
const eq = (id) => CAT.equipos.find((q) => q.id === id);
const LTV = vehiculos(CAT).find((v) => v.equipo.id === 'ltv');
const todas = () => new Set(IDS_BASE);

test('piece measures come from the real catalogue with their label: habitat and reactor cited, pad and tower derived, water plant and road width assumed', () => {
  const M = medidasBase(CAT, CONC);
  assert.equal(M.habitat.valor, 6.5);
  assert.equal(M.habitat.rotulo, 'cited');
  assert.match(M.habitat.ref.cita, /6\.5 meters/);
  assert.equal(M.reactor.valor, 3.2);
  assert.equal(M.reactor.rotulo, 'cited');
  assert.equal(M.reactor.ref.nombre, 'ancho_m');
  assert.equal(M.pista.valor, 19.9);
  assert.equal(M.pista.rotulo, 'derived (own)');
  assert.equal(M.pista.ref.nombre, 'distancia_entre_zonas_m');
  assert.equal(M.torre.valor, 6);
  assert.equal(M.torre.rotulo, 'derived (own)');
  assert.equal(M.agua.valor, Math.hypot(7, 3));
  assert.equal(M.agua.rotulo, 'assumed');
  assert.equal(M.agua.ref, null);
  assert.equal(M.carretera.valor, 2.3);
  assert.equal(M.carretera.rotulo, 'assumed');
  assert.equal(M.carretera.ref.nombre, 'ancho_m');
  for (const k of [...IDS_BASE, 'carretera']) assert.ok(M[k].de.length > 10, `${k}: no explanation`);
});

test('a measure without a verified quote is not used: the piece gets no value and a reason', () => {
  const sinVer = { equipos: CAT.equipos.map((q) => (q.id !== 'habitat_superficie' ? q : { ...q, cifras: q.cifras.map((c) => ({ ...c, verificado: false })) })) };
  const M = medidasBase(sinVer, CONC);
  assert.equal(M.habitat.valor, null);
  assert.match(M.habitat.motivo, /habitat_superficie/);
  const sinConc = medidasBase(CAT, null);
  assert.equal(sinConc.agua.valor, null);
  assert.ok(sinConc.agua.motivo);
});

test('landing-pad standoff default = the cited reactor–habitat separation (1000 m) with its quote', () => {
  const s = separacionPistaDefecto(CAT);
  assert.equal(s.valor, 1000);
  assert.match(s.ref.cita, /one km distance/);
  assert.equal(separacionPistaDefecto({ equipos: CAT.equipos.filter((q) => q.id !== 'reactor_fision') }), null);
});

test('pieces for generarBase: the five of probar_base with catalogue equipment, ice threshold for the water plant, unticked pieces left out', () => {
  const M = medidasBase(CAT, CONC);
  const ps = piezasBase(CAT, M, 100, todas());
  assert.deepEqual(ps.map((p) => [p.id, p.equipo.id, p.diametro_m]), [
    ['habitat', 'habitat_superficie', 6.5], ['reactor', 'reactor_fision', 3.2], ['pista', 'pista_aterrizaje', 19.9], ['torre', 'torre_solar', 6], ['agua', 'planta_agua', Math.hypot(7, 3)],
  ]);
  assert.equal(ps.find((p) => p.id === 'agua').criterios[0].umbral_k, 100);
  assert.equal(ps.find((p) => p.id === 'habitat').criterios[0].id, 'iluminacion');
  const sinTorre = piezasBase(CAT, M, 100, new Set(['habitat', 'reactor', 'pista', 'agua']));
  assert.deepEqual(sinTorre.map((p) => p.id), ['habitat', 'reactor', 'pista', 'agua']);
});

test('options: road width from the measures, candidates 200 m apart, landing-pad standoff only when both the pad and the habitat are in the base', () => {
  const M = medidasBase(CAT, CONC);
  const o = opcionesBase(M, 1000, todas());
  assert.equal(o.anchoCarretera_m, 2.3);
  assert.equal(o.separacionHuellas_m, 0);
  assert.equal(o.separacionCandidatos_m, 200);
  assert.deepEqual(o.separacionesExtra, [{ pieza: 'pista', con: 'habitat', op: '>=', valor: 1000 }]);
  assert.deepEqual(opcionesBase(M, 1000, new Set(['habitat', 'reactor'])).separacionesExtra, []);
  assert.deepEqual(opcionesBase(M, null, todas()).separacionesExtra, []);
  assert.deepEqual(opcionesBase(M, NaN, todas()).separacionesExtra, []);
});

// Llano de 2 km a 20 m/px, sin sombra permanente: todo cabe salvo una separación mayor que el terreno.
function llano() {
  const n = 100, m = 20, N = n * n;
  const ilum = new Float32Array(N), temp = new Float32Array(N).fill(250);
  for (let i = 0; i < N; i++) ilum[i] = 0.2 + 0.6 * ((i % n) / n);
  return { n, m, alturas: new Float32Array(N), capas: { iluminacion: ilum, sombra_permanente: new Float32Array(N), temp_max: temp } };
}

test('the landing-pad standoff reaches generarBase: kept when it fits, the named reason when it does not', () => {
  const M = medidasBase(CAT, CONC), ps = piezasBase(CAT, M, 100, todas());
  const r = generarBase(llano(), ps, LTV, opcionesBase(M, 1000, todas()));
  assert.equal(r.factible, true, r.motivo);
  const h = r.piezas.find((p) => p.id === 'habitat'), q = r.piezas.find((p) => p.id === 'pista');
  assert.ok(Math.hypot(h.fila - q.fila, h.col - q.col) * 20 >= 1000);
  assert.ok(r.restricciones.some((x) => x.tipo === 'separacion' && x.pieza === 'pista' && x.origen === 'supuesto'));
  const no = generarBase(llano(), ps, LTV, opcionesBase(M, 3000, todas()));
  assert.equal(no.factible, false);
  assert.equal(no.restriccion.tipo, 'separacion');
  assert.equal(no.restriccion.pieza, 'pista');
  assert.equal(no.restriccion.origen, 'supuesto');
  assert.equal(no.restriccion.limite, 3000);
});

test('worker payload: platform deltas dropped, cut cells counted, everything else unchanged', () => {
  const N = 9;
  const delta = new Float32Array(N);
  delta[1] = -0.5; delta[2] = -0.1; delta[4] = 0.3;
  const r = { factible: true, piezas: [{ id: 'a', plataforma: { corte_m3: 1, delta } }, { id: 'b', plataforma: { corte_m3: 0, delta: null } }], totales: { x: 1 } };
  const l = aligerar(r);
  assert.equal(l.piezas[0].plataforma.delta, null);
  assert.equal(l.piezas[0].plataforma.celdas_corte, 2);
  assert.equal(l.piezas[1].plataforma.celdas_corte, 0);
  assert.equal(l.piezas[0].plataforma.corte_m3, 1);
  assert.deepEqual(l.totales, { x: 1 });
  assert.deepEqual(aligerar({ factible: false, motivo: 'm' }), { factible: false, motivo: 'm' });
});

test('transplant keeps offsets in metres from the habitat on the Earth grid; out-of-crop and water are flagged, never moved', () => {
  const luna = [{ id: 'habitat', hub: true, fila: 50, col: 50 }, { id: 'reactor', fila: 50, col: 150 }, { id: 'pista', fila: 30, col: 50 }, { id: 'torre', fila: 50, col: 10 }];
  const n = 40, agua = new Float32Array(n * n);
  agua[15 * n + 20] = 1;
  const t = trasplantar(luna, 10, { n, m: 40, agua }, { fila: 20, col: 20 });
  const by = Object.fromEntries(t.map((x) => [x.id, x]));
  assert.deepEqual([by.habitat.fila, by.habitat.col, by.habitat.dx_m, by.habitat.dy_m], [20, 20, 0, 0]);
  assert.deepEqual([by.reactor.fila, by.reactor.col, by.reactor.dx_m, by.reactor.dy_m], [20, 45, 1000, 0]);
  assert.equal(by.reactor.dentro, false);
  assert.deepEqual([by.pista.fila, by.pista.col, by.pista.dy_m], [15, 20, -200]);
  assert.equal(by.pista.dentro, true);
  assert.equal(by.pista.agua, 1);
  assert.equal(by.pista.enAgua, true);
  assert.deepEqual([by.torre.fila, by.torre.col, by.torre.dentro, by.torre.enAgua], [20, 10, true, false]);
  assert.equal(by.reactor.comparte, null);
  const juntos = trasplantar([{ id: 'habitat', hub: true, fila: 50, col: 50 }, { id: 'torre', fila: 50, col: 51 }], 10, { n, m: 40, agua: null }, { fila: 20, col: 20 });
  assert.deepEqual(juntos.map((x) => [x.fila, x.col, x.comparte]), [[20, 20, 'torre'], [20, 20, 'habitat']]);
  const sinAgua = trasplantar(luna, 10, { n, m: 40, agua: null }, { fila: 20, col: 20 });
  assert.equal(sinAgua.find((x) => x.id === 'pista').agua, null);
  assert.equal(sinAgua.find((x) => x.id === 'pista').enAgua, false);
});

test('rehearsal rows use compararRequisito on the Moon and Earth verdicts; no-limit rows are not compared; out-of-crop pieces cannot be measured', () => {
  const pista = eq('pista_aterrizaje');
  const ev = (vals) => pista.requisitos.map((r) => evaluarRequisito(r, { pendiente_deg: vals.pend, separacion_m: {} }));
  const L = ev({ pend: { valor: 0.37, como: 'x' } });
  const filas = filasEnsayo([
    { id: 'pista', eq: pista, evsLuna: L, evsTierra: ev({ pend: { valor: 3, como: 'x' } }) },
    { id: 'pista2', eq: pista, evsLuna: L, evsTierra: ev({ pend: { valor: 0.5, como: 'x' } }) },
    { id: 'fuera', eq: pista, evsLuna: L, evsTierra: null, motivoTierra: 'falls outside this Earth terrain' },
  ]);
  const pend = filas.filter((f) => f.req.variable === 'pendiente_deg');
  assert.deepEqual(pend.map((f) => f.lectura), ['sobre', 'reproducido', 'no_medible']);
  assert.deepEqual(pend[0].c, compararRequisito(pista.requisitos[0], L[0], ev({ pend: { valor: 3, como: 'x' } })[0]));
  assert.match(pend[2].c.motivo, /outside this Earth terrain/);
  assert.equal(pend[2].tierra.estado, 'no_medido');
  const sep = filas.filter((f) => f.req.variable === 'separacion_m');
  assert.ok(sep.every((f) => f.lectura === null && f.luna.estado === 'sin_limite'));
  assert.deepEqual(resumenEnsayo(filas), { reproducido: 1, infra: 0, sobre: 1, no_medible: 1, sin_limite: 3, total: 6 });
});

test('fleet time for the whole base: cut of every pad and road through masaCorte and the IPEx rate; zero when nothing is cut; no mass without a density', () => {
  const F = defectosFlota(OBRA, CAT.equipos);
  const flota = { n_robots: 1, kg_h: F.ritmo_kg_h.valor, mision_kg: F.mision_kg.valor };
  const n = 10, m = 10, luz = new Float32Array(n * n).fill(0.5);
  const s = [0, 10, 20, 30], z = [0, 2, 2, 0], zp = [0, 1, 1, 0];
  const r = {
    piezas: [{ id: 'a', fila: 2, col: 2, i: 22, diametro_m: 6, plataforma: { sub_celda: true, corte_m3: 0.5, relleno_m3: 0.5 } }, { id: 'b', fila: 5, col: 5, i: 55, diametro_m: 6, plataforma: { sub_celda: true, corte_m3: 0, relleno_m3: 0 } }],
    carreteras: [{ tipo: 'carretera', hasta: 'b', traza: [0, 1, 2, 3], s, z, zp, corte_m3: 40, relleno_m3: 0 }, { tipo: 'ruta', hasta: 'a', traza: [0, 1], s: [0, 10], z: [0, 0], zp: null, corte_m3: 0, relleno_m3: 0 }],
  };
  const x = flotaBase(r, { n, m, luz, densidad: F.densidad.valor, flota, ancho_m: 2 });
  const masaPad = masaCorte(0.5, 0.5 / ((Math.PI * 9) / 2), F.densidad.valor);
  const masaCar = masaCorte(40, 40 / (2 * 30), F.densidad.valor);
  assert.equal(x.elementos.length, 2);
  assert.ok(Math.abs(x.masa_kg - (masaPad + masaCar)) < 1e-9 * x.masa_kg);
  assert.ok(Math.abs(x.flota.horas - x.masa_kg / 42) < 1e-9 * x.flota.horas);
  assert.ok(Math.abs(x.flota.calendario_dias - x.flota.horas / 0.5 / 24) < 1e-9 * x.flota.calendario_dias);
  assert.ok(Math.abs(x.flota.misiones - x.masa_kg / 10000) < 1e-12);
  const cero = flotaBase({ piezas: [r.piezas[1]], carreteras: [r.carreteras[1]] }, { n, m, luz, densidad: F.densidad.valor, flota, ancho_m: 2 });
  assert.equal(cero.masa_kg, 0);
  assert.equal(cero.flota.horas, 0);
  assert.equal(cero.flota.calendario_dias, 0);
  const sinD = flotaBase(r, { n, m, luz, densidad: null, flota, ancho_m: 2 });
  assert.equal(sinD.masa_kg, null);
  assert.equal(sinD.flota.evaluable, false);
  const sinLuz = flotaBase(r, { n, m, luz: null, densidad: F.densidad.valor, flota, ancho_m: 2 });
  assert.equal(sinLuz.flota.calendario_dias, null);
  assert.ok(sinLuz.flota.motivoCalendario);
});

test('real campaigns of the Earth terrain come from sitios_ensayo.json with their quotes; none for a terrain without campaigns', () => {
  const c = campanasDe(SITIOS, 'haughton');
  assert.equal(c.length, 2);
  assert.ok(c.every((x) => x.cita && x.fuente && x.verificado === true));
  assert.deepEqual(campanasDe(SITIOS, 'shackleton'), []);
  assert.deepEqual(campanasDe(null, 'haughton'), []);
});
