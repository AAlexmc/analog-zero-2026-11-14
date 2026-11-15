import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defectosVolatiles, capaHielo, tarjetaPerforacion, hojaPlanta, celdaEstableMasCercana, O2_FUENTE } from '../terreno/panel_volatiles.js';
import { hieloEstable, lecturaPunto, planPerforacion, plantaAgua, energia, propelente } from '../terreno/volatiles.js';
import { defectosFlota, tiempoFlota } from '../terreno/panel_obra.js';

const RAD = Math.PI / 180;
const OBRA = JSON.parse(readFileSync(new URL('../data/obra.json', import.meta.url), 'utf8'));
const CAT = JSON.parse(readFileSync(new URL('../data/equipo.json', import.meta.url), 'utf8'));
const D = defectosVolatiles(OBRA, CAT.equipos);
const F = defectosFlota(OBRA, CAT.equipos);
const raiz = fileURLToPath(new URL('../data/terreno/', import.meta.url));

// Igual que datos.js: uint8 255 → NaN; solo las capas que trae el terreno.
function cargarReal(id) {
  const meta = JSON.parse(readFileSync(`${raiz}${id}/meta.json`, 'utf8'));
  const leer = (nombre) => {
    const c = meta.capas[nombre], b = readFileSync(`${raiz}${id}/${c.fichero}`);
    if (c.tipo === 'uint8') return Float32Array.from(b, (u) => (u === 255 ? NaN : u));
    return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  };
  const capas = {};
  for (const k of Object.keys(meta.capas)) if (k !== 'altura') capas[k] = leer(k);
  return { n: meta.n, m_por_px: meta.m_por_px, alturas: leer('altura'), capas };
}

const sintetico = () => ({
  n: 3,
  m_por_px: 20,
  alturas: Float32Array.from({ length: 9 }, (_, i) => (i % 3) * 20 * Math.tan(10 * RAD)),
  capas: {
    temp_max: Float32Array.from([50, 100, 101, NaN, 99.9, 200, NaN, 30, 100.0001]),
    sombra_permanente: Float32Array.from([1, 1, 0, 1, NaN, 1, 0, 0, 1]),
    iluminacion: Float32Array.from([0, 0, 0.2, 0.1, NaN, 0.4, 0.3, 0.5, 0.05]),
  },
});
const tierra = () => { const t = sintetico(); t.capas = { agua: new Float32Array(9) }; return t; };
const fila = (x, k) => x.lectura.find((r) => r.k === k);

test('catalogue defaults: 100 K threshold, LCROSS ice, water plant baseline, TRIDENT, tower and reactor, each with its verified quote', () => {
  assert.equal(D.umbral.valor, 100);
  assert.match(D.umbral.ref.cita, /100K/);
  assert.equal(D.hielo.valor, 0.056);
  assert.equal(D.hielo.ref.id, 'lcross_hielo_pct_masa');
  assert.match(D.hielo.ref.lugar.nombre, /Cabeus/);
  assert.deepEqual([D.agua_rango.min, D.agua_rango.max], [0.03, 0.1]);
  assert.deepEqual([D.produccion.agua_kg, D.produccion.dias], [15000, 225]);
  assert.equal(D.potencia_kw.valor, 68);
  assert.equal(D.eficiencia.valor, 0.75);
  assert.equal(D.trident.profundidad.valor, 1);
  assert.equal(D.trident.bocado.valor, 10);
  assert.equal(D.trident.rotacion.valor, 200);
  assert.equal(D.trident.percusion.valor, 200);
  assert.deepEqual([D.trident.masa.valor, D.trident.masa.op], [20, '<']);
  assert.equal(D.torre_kw.valor, 10);
  assert.equal(D.reactor_kwe.valor, 40);
  for (const r of [D.umbral, D.hielo, D.agua_rango, D.produccion, D.potencia_kw, D.eficiencia, D.trident.bocado, D.trident.masa, D.torre_kw, D.reactor_kwe]) {
    assert.equal(r.ref.verificado, true);
    assert.ok(r.ref.fuente.startsWith('https://'));
    assert.ok(r.ref.cita.length > 10);
  }
});

test('a constant without a verified quote is not used; no catalogue gives nulls, never zeros', () => {
  const sinVer = { ...OBRA, constantes: OBRA.constantes.map((c) => (c.id === 'hielo_superficie_temp_max_k' ? { ...c, verificado: false } : c)) };
  assert.equal(defectosVolatiles(sinVer, CAT.equipos).umbral, null);
  const vacio = defectosVolatiles(null, null);
  assert.equal(vacio.umbral, null);
  assert.equal(vacio.produccion, null);
  assert.equal(vacio.trident.bocado, null);
  assert.equal(vacio.torre_kw, null);
});

test('the oxygen figure carries its own literal quote from the same source as the water figure', () => {
  assert.equal(O2_FUENTE.valor, 10000);
  assert.equal(O2_FUENTE.fuente, D.produccion.ref.fuente);
  assert.match(O2_FUENTE.cita, /10 mT of oxygen/);
});

test('stable-ice layer: same share as hieloEstable on shoemaker; 1 / 0 / NaN cells', () => {
  const t = cargarReal('shoemaker');
  const c = capaHielo(t, D.umbral.valor), h = hieloEstable(t, 100);
  assert.equal(c.medido, true);
  assert.equal(c.pct, 100 * h.fracciones.estable);
  assert.equal(c.pct.toFixed(1), '29.0');
  assert.equal(c.celdas, h.celdas.estable);
  let unos = 0;
  for (let i = 0; i < c.capa.length; i++) if (c.capa[i] === 1) unos++;
  assert.equal(unos, h.celdas.estable);
  const s = capaHielo(sintetico(), 100);
  assert.deepEqual([...s.capa].map((v) => (Number.isNaN(v) ? 'x' : v)), [1, 1, 0, 'x', 1, 0, 'x', 1, 0]);
  assert.equal(s.pct, 100 * (4 / 9));
  assert.equal(s.pct_con_dato, 100 * (4 / 7));
});

test('stable-ice layer on a terrain without maximum temperature is not measured and has no layer', () => {
  const c = capaHielo(cargarReal('haughton'), 100);
  assert.equal(c.medido, false);
  assert.equal(c.capa, null);
  assert.equal(c.pct, null);
  assert.match(c.motivo, /temperature/);
  assert.equal(capaHielo(sintetico(), null).medido, false);
});

test('drill card on a cold permanently shadowed cell: readings equal lecturaPunto; says the temperature allows ice, never that there is ice', () => {
  const t = sintetico();
  const x = tarjetaPerforacion({ t, fila: 0, col: 1, luna: true, D });
  const l = lecturaPunto(t, 0, 1, { umbral_K: 100 });
  assert.equal(x.evaluable, true);
  assert.equal(fila(x, 'temp_max').valor, l.temp_max_K.valor);
  assert.equal(fila(x, 'temp_max').estado, 'medido');
  assert.equal(fila(x, 'sombra').valor, 1);
  assert.equal(fila(x, 'hielo').valor, 'si');
  assert.match(fila(x, 'hielo').texto, /allows stable surface ice/);
  assert.equal(fila(x, 'pendiente').valor, l.pendiente_deg.valor);
  assert.equal(x.hielo, 'si');
  for (const r of x.lectura) assert.doesNotMatch(r.texto, /there is ice|ice is present/i);
  assert.match(x.nota, /does not show ice is present/);
});

test('drill card: warm cell says too warm; NaN cell says no data; both keep the TRIDENT plan', () => {
  const t = sintetico();
  const w = tarjetaPerforacion({ t, fila: 0, col: 2, luna: true, D });
  assert.equal(fila(w, 'hielo').valor, 'no');
  assert.match(fila(w, 'hielo').texto, /too warm/);
  assert.equal(fila(w, 'sombra').valor, 0);
  const n = tarjetaPerforacion({ t, fila: 1, col: 0, luna: true, D });
  assert.equal(fila(n, 'temp_max').estado, 'sin_dato');
  assert.equal(fila(n, 'temp_max').valor, null);
  assert.match(fila(n, 'temp_max').texto, /no data at this point/);
  assert.equal(fila(n, 'hielo').estado, 'sin_dato');
  assert.ok(w.plan && n.plan);
});

test('drill plan: TRIDENT 1 m in 10 cm bites = planPerforacion; cutting time from the published feed; time between bites and subsurface ice are NOT MEASURED; LCROSS ice is from another place', () => {
  const x = tarjetaPerforacion({ t: sintetico(), fila: 0, col: 0, luna: true, D });
  const p = planPerforacion({ profundidad_m: 1, bocado_cm: 10, profundidad_max_m: 1 });
  assert.equal(x.plan.bocados, p.bocados);
  assert.equal(x.plan.bocados, 10);
  assert.equal(x.plan.profundidad_m, 1);
  assert.equal(x.plan.supera_profundidad_max, false);
  assert.equal(x.plan.horas, null);
  assert.equal(x.plan.energia_wh, null);
  const nm = Object.fromEntries(x.no_medido.map((r) => [r.k, r.texto]));
  assert.match(nm.horas, /time between bites.*NOT MEASURED/);
  assert.match(nm.energia, /drilling energy: NOT MEASURED/);
  assert.match(nm.subsuelo, /NOT MEASURED/);
  assert.equal(D.trident.avance.valor, 1.25);
  assert.equal(D.trident.wob.valor, 100);
  assert.equal(x.secuencia.pasos.length, 10);
  assert.equal(x.secuencia.pasos[0].corte_s, 80);
  assert.equal(x.secuencia.corte_min_s, 800);
  const tierra = tarjetaPerforacion({ t: sintetico(), fila: 0, col: 0, luna: false, D });
  assert.equal(tierra.secuencia.corte_min_s, 800);
  assert.equal(tierra.plan, null);
  const sinAvance = tarjetaPerforacion({ t: sintetico(), fila: 0, col: 0, luna: true, D: { ...D, trident: { ...D.trident, avance: null } } });
  assert.equal(sinAvance.secuencia, null);
  assert.match(sinAvance.no_medido.find((r) => r.k === 'horas').texto, /drilling time: NOT MEASURED/);
  assert.match(sinAvance.no_medido.find((r) => r.k === 'energia').texto, /NOT MEASURED/);
  assert.equal(x.hielo_esperado.valor, 5.6);
  assert.match(x.hielo_esperado.texto, /not measured here/);
  assert.match(x.hielo_esperado.texto, /Cabeus/);
  const hondo = tarjetaPerforacion({ t: sintetico(), fila: 0, col: 0, luna: true, D, profundidad_m: 1.5 });
  assert.equal(hondo.plan.bocados, 15);
  assert.equal(hondo.plan.supera_profundidad_max, true);
});

test('drill card outside the grid or without a threshold is not evaluable, with a reason', () => {
  const t = sintetico();
  for (const [f, c] of [[-1, 0], [3, 0], [0, 7], [NaN, 0]]) {
    const x = tarjetaPerforacion({ t, fila: f, col: c, luna: true, D });
    assert.equal(x.evaluable, false);
    assert.ok(x.motivo.length > 0);
  }
  const s = tarjetaPerforacion({ t, fila: 0, col: 0, luna: true, D: { ...D, umbral: null } });
  assert.equal(s.evaluable, false);
  assert.match(s.motivo, /threshold/);
});

test('drill card on Earth: temperature, shadow, illumination and ice cannot be measured on this terrain; slope is; no drill plan', () => {
  const x = tarjetaPerforacion({ t: tierra(), fila: 0, col: 1, luna: false, D });
  assert.equal(x.evaluable, true);
  for (const k of ['temp_max', 'sombra', 'iluminacion', 'hielo']) {
    assert.equal(fila(x, k).estado, 'no_medible');
    assert.equal(fila(x, k).valor, null);
    assert.equal(fila(x, k).texto, 'cannot be measured on this terrain');
  }
  assert.equal(fila(x, 'pendiente').estado, 'medido');
  assert.equal(x.plan, null);
});

test('drill card on the real shoemaker terrain: equal to lecturaPunto at a cold and at a lit cell', () => {
  const t = cargarReal('shoemaker');
  const frio = t.capas.temp_max.findIndex((v, i) => v <= 100 && t.capas.sombra_permanente[i] === 1);
  const luz = t.capas.temp_max.findIndex((v, i) => v > 100 && t.capas.iluminacion[i] > 0.2);
  for (const i of [frio, luz]) {
    const f = Math.floor(i / t.n), c = i % t.n;
    const x = tarjetaPerforacion({ t, fila: f, col: c, luna: true, D });
    const l = lecturaPunto(t, f, c, { umbral_K: 100 });
    assert.equal(fila(x, 'temp_max').valor, l.temp_max_K.valor);
    assert.equal(fila(x, 'sombra').valor, l.sombra_permanente.valor);
    assert.equal(fila(x, 'iluminacion').valor, l.iluminacion.valor);
    assert.equal(fila(x, 'hielo').valor, l.hielo_superficie);
  }
});

test('water plant sheet: regolith with range, IPEx time, towers and reactors, propellant: each equal to volatiles.js and panel_obra.js', () => {
  const h = hojaPlanta({ D, F, luz: 0.4, luna: true, n_robots: 1 });
  const pa = plantaAgua({ agua_kg: 15000, dias: 225, fraccion_hielo: 0.056, fraccion_min: 0.03, fraccion_max: 0.1, eficiencia: 0.75 });
  assert.equal(h.planta.regolito_kg, pa.regolito_kg);
  assert.deepEqual(h.planta.intervalo_kg, pa.intervalo_kg);
  const fl = { n_robots: 1, kg_h: 42, mision_kg: 10000 };
  assert.deepEqual(h.excavacion.central, tiempoFlota(pa.regolito_kg, fl, { valor: 0.4 }, true));
  assert.deepEqual(h.excavacion.min, tiempoFlota(pa.intervalo_kg.min, fl, { valor: 0.4 }, true));
  assert.deepEqual(h.excavacion.max, tiempoFlota(pa.intervalo_kg.max, fl, { valor: 0.4 }, true));
  assert.deepEqual(h.energia, energia({ potencia_kw: 68, kw_por_torre: 10, kwe_por_reactor: 40, fraccion_luz: 0.4 }));
  assert.equal(h.energia.torres, 7);
  assert.equal(h.energia.reactores, 2);
  assert.equal(h.energia.torres_con_luz, 17);
  assert.deepEqual(h.propelente, propelente(15000));
  assert.match(h.no_medido.find((r) => r.k === 'acarreo').texto, /haul time: NOT MEASURED/);
});

test('water plant sheet: the source says 10 t of O2 for 15 t of water; stoichiometry gives 13.3 t; both shown, difference not explained by the source', () => {
  const h = hojaPlanta({ D, F, luz: 0.4, luna: true, n_robots: 1 });
  assert.equal(h.o2.fuente_kg, 10000);
  assert.equal(h.o2.estequiometria_kg, propelente(15000).o2_kg);
  assert.equal((h.o2.estequiometria_kg / 1000).toFixed(1), '13.3');
  assert.match(h.o2.aviso, /10\.0 t/);
  assert.match(h.o2.aviso, /13\.3 t/);
  assert.match(h.o2.aviso, /mixture ratio of 6/);
  assert.match(h.o2.aviso, /1\.7 t of H₂/);
  assert.match(h.o2.aviso, /needs 14\.9 t of water/);
  assert.match(h.o2.aviso, /about 3\.3 t of O₂ is surplus/);
  assert.ok(Math.abs(h.o2.agua_h2_kg - (10000 / 6) * 18.015 / 2.016) < 1e-6);
});

test('water plant sheet without light: no light-corrected tower count and no calendar, but towers and reactors still given', () => {
  for (const luz of [0, null]) {
    const h = hojaPlanta({ D, F, luz, luna: true, n_robots: 1 });
    assert.equal(h.energia.evaluable, true);
    assert.equal(h.energia.torres, 7);
    assert.equal(h.energia.torres_con_luz, null);
    assert.ok(h.motivo_luz.length > 0);
    assert.equal(h.excavacion.central.calendario_dias, null);
  }
});

test('water plant sheet with the catalogue missing a figure: the line says why instead of a number', () => {
  const h = hojaPlanta({ D: { ...D, produccion: null }, F, luz: 0.4, luna: true, n_robots: 1 });
  assert.equal(h.planta, null);
  assert.match(h.motivo, /water production/);
  const r = hojaPlanta({ D: { ...D, reactor_kwe: null }, F, luz: 0.4, luna: true, n_robots: 1 });
  assert.equal(r.energia.reactores, null);
  assert.ok(r.energia.motivo_reactores.length > 0);
});

test('nearest cell where the temperature allows stable ice: exact on a small grid, 0 m on such a cell, null when there is none', () => {
  const n = 5, masc = new Uint8Array(n * n);
  masc[0 * n + 4] = 1; masc[4 * n + 1] = 1; masc[2 * n + 2] = 255;
  const r = celdaEstableMasCercana(masc, n, 10, 3, 2);
  assert.deepEqual([r.fila, r.col], [4, 1]);
  assert.equal(r.dist_m, 10 * Math.SQRT2);
  assert.equal(celdaEstableMasCercana(masc, n, 10, 0, 4).dist_m, 0);
  assert.equal(celdaEstableMasCercana(new Uint8Array(n * n), n, 10, 1, 1), null);
  assert.equal(celdaEstableMasCercana(null, n, 10, 1, 1), null);
});
