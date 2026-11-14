import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { M_H2O, M_O2, M_H2, hieloEstable, lecturaPunto, planPerforacion, plantaAgua, energia, propelente, excavacionParaAgua } from '../terreno/volatiles.js';
import { planFlota } from '../terreno/obra.js';

const RAD = Math.PI / 180;
const rel = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol * Math.max(Math.abs(b), 1e-300), `${msg ?? ''} ${a} ≠ ${b} (tol ${tol})`);

// Ningún número del resultado puede ser NaN o ±Infinity (las máscaras tipadas se saltan).
function sinNoFinitos(x, ruta = 'r') {
  if (typeof x === 'number') assert.ok(Number.isFinite(x), `${ruta} = ${x}`);
  else if (x && typeof x === 'object' && !ArrayBuffer.isView(x)) for (const [k, v] of Object.entries(x)) sinNoFinitos(v, `${ruta}.${k}`);
}

function noEvaluable(r, campo) {
  assert.equal(r.evaluable, false, JSON.stringify(r));
  assert.equal(r.campo, campo);
  assert.equal(typeof r.motivo, 'string');
  assert.ok(r.motivo.length > 0);
  sinNoFinitos(r);
}

const raiz = fileURLToPath(new URL('../data/terreno/', import.meta.url));

// Igual que datos.js: uint8 255 → NaN.
function cargarReal(id) {
  const meta = JSON.parse(readFileSync(`${raiz}${id}/meta.json`, 'utf8'));
  const leer = (nombre) => {
    const c = meta.capas[nombre], b = readFileSync(`${raiz}${id}/${c.fichero}`);
    if (c.tipo === 'uint8') return Float32Array.from(b, (u) => (u === 255 ? NaN : u));
    return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  };
  return { n: meta.n, m_por_px: meta.m_por_px, alturas: leer('altura'), capas: { temp_max: leer('temp_max'), sombra_permanente: leer('sombra_permanente'), iluminacion: leer('iluminacion') } };
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

test('electrolysis 2 H2O → 2 H2 + O2: one mole of water gives half a mole of O2 and one of H2', () => {
  rel(M_H2O, 18.015, 1e-12); rel(M_O2, 31.998, 1e-12); rel(M_H2, 2.016, 1e-12);
  const r = propelente(18.015);
  assert.equal(r.evaluable, true);
  rel(r.o2_kg, 15.999, 1e-9);
  rel(r.h2_kg, 2.016, 1e-9);
  rel(r.o2_kg + r.h2_kg, 18.015, 1e-12, 'mass conservation');
  rel(r.relacion_o2_h2, 15.999 / 2.016, 1e-9);
  const g = propelente(15000);
  rel(g.o2_kg + g.h2_kg, 15000, 1e-12, 'mass conservation');
  rel(g.o2_kg / g.h2_kg, r.relacion_o2_h2, 1e-12);
  const z = propelente(0);
  assert.equal(z.o2_kg, 0);
  assert.equal(z.h2_kg, 0);
  sinNoFinitos(z);
  sinNoFinitos(g);
});

test('propellant: water missing, NaN, infinite or negative is not evaluable', () => {
  for (const x of [undefined, null, NaN, Infinity, -1, '18']) noEvaluable(propelente(x), 'agua_kg');
});

test('water plant: 15 t at 5.6 % ice and 75 % extraction needs 15000/(0.056·0.75) kg of regolith', () => {
  const r = plantaAgua({ agua_kg: 15000, dias: 225, fraccion_hielo: 0.056, fraccion_min: 0.03, fraccion_max: 0.1, eficiencia: 0.75 });
  assert.equal(r.evaluable, true);
  assert.equal(r.regolito_kg, 15000 / (0.056 * 0.75));
  assert.equal(r.intervalo_kg.min, 15000 / (0.1 * 0.75), 'the richest regolith gives the lower bound');
  assert.equal(r.intervalo_kg.max, 15000 / (0.03 * 0.75));
  assert.ok(r.intervalo_kg.min < r.regolito_kg && r.regolito_kg < r.intervalo_kg.max);
  assert.equal(r.agua_kg_dia, 15000 / 225);
  assert.equal(r.regolito_kg_dia, r.regolito_kg / 225);
  assert.equal(r.intervalo_kg_dia.min, r.intervalo_kg.min / 225);
  assert.equal(r.intervalo_kg_dia.max, r.intervalo_kg.max / 225);
  sinNoFinitos(r);
});

test('water plant without a fraction range gives the central value and says why there is no range', () => {
  const r = plantaAgua({ agua_kg: 15000, dias: 225, fraccion_hielo: 0.056, eficiencia: 0.75 });
  assert.equal(r.evaluable, true);
  assert.equal(r.intervalo_kg, null);
  assert.equal(r.intervalo_kg_dia, null);
  assert.match(r.motivo_intervalo, /fraccion_min/);
  sinNoFinitos(r);
});

test('water plant: every bad input names its field', () => {
  const ok = { agua_kg: 15000, dias: 225, fraccion_hielo: 0.056, fraccion_min: 0.03, fraccion_max: 0.1, eficiencia: 0.75 };
  noEvaluable(plantaAgua({ ...ok, fraccion_hielo: 0 }), 'fraccion_hielo');
  noEvaluable(plantaAgua({ ...ok, fraccion_hielo: 1.2 }), 'fraccion_hielo');
  noEvaluable(plantaAgua({ ...ok, fraccion_hielo: null }), 'fraccion_hielo');
  noEvaluable(plantaAgua({ ...ok, agua_kg: NaN }), 'agua_kg');
  noEvaluable(plantaAgua({ ...ok, agua_kg: -1 }), 'agua_kg');
  noEvaluable(plantaAgua({ ...ok, dias: 0 }), 'dias');
  noEvaluable(plantaAgua({ ...ok, dias: Infinity }), 'dias');
  noEvaluable(plantaAgua({ ...ok, eficiencia: 0 }), 'eficiencia');
  noEvaluable(plantaAgua({ ...ok, eficiencia: 1.01 }), 'eficiencia');
  noEvaluable(plantaAgua({ ...ok, fraccion_min: 0 }), 'fraccion_min');
  noEvaluable(plantaAgua({ ...ok, fraccion_max: NaN }), 'fraccion_max');
  noEvaluable(plantaAgua({ ...ok, fraccion_min: 0.1, fraccion_max: 0.03 }), 'fraccion_min');
  noEvaluable(plantaAgua({ ...ok, fraccion_max: undefined }), 'fraccion_max');
  noEvaluable(plantaAgua({ ...ok, fraccion_min: undefined }), 'fraccion_min');
  noEvaluable(plantaAgua(), 'agua_kg');
  noEvaluable(plantaAgua({ ...ok, agua_kg: 1e308, fraccion_hielo: 1e-300 }), 'agua_kg');
});

test('power: 68 kW takes 7 towers of 10 kW or 2 reactors of 40 kWe', () => {
  const r = energia({ potencia_kw: 68, kw_por_torre: 10, kwe_por_reactor: 40 });
  assert.equal(r.evaluable, true);
  assert.equal(r.torres, 7);
  assert.equal(r.reactores, 2);
  assert.equal(r.torres_con_luz, null);
  assert.match(r.nota_torre, /light/);
  assert.match(r.motivo_torres_con_luz, /fraccion_luz/);
  sinNoFinitos(r);
});

test('power: with a light fraction the towers are also given for the mean over the lunar day', () => {
  const r = energia({ potencia_kw: 68, kw_por_torre: 10, kwe_por_reactor: 40, fraccion_luz: 0.6 });
  assert.equal(r.torres, 7);
  assert.equal(r.torres_con_luz, Math.ceil(68 / (10 * 0.6)));
  assert.equal(r.torres_con_luz, 12);
  sinNoFinitos(r);
});

test('power: an exact multiple does not round up one extra unit through floating point', () => {
  assert.equal(energia({ potencia_kw: 0.1 * 3, kw_por_torre: 0.1 }).torres, 3, '(0.1·3)/0.1 = 3.0000000000000004');
  assert.equal(energia({ potencia_kw: 80, kwe_por_reactor: 40 }).reactores, 2);
  assert.equal(energia({ potencia_kw: 0, kw_por_torre: 10 }).torres, 0);
});

test('power: a source missing from the catalogue gives null with a reason, a bad value is not evaluable', () => {
  const r = energia({ potencia_kw: 68, kw_por_torre: 10, kwe_por_reactor: null });
  assert.equal(r.evaluable, true);
  assert.equal(r.reactores, null);
  assert.match(r.motivo_reactores, /kwe_por_reactor/);
  const s = energia({ potencia_kw: 68 });
  assert.equal(s.torres, null);
  assert.match(s.motivo_torres, /kw_por_torre/);
  sinNoFinitos(s);
  noEvaluable(energia({ potencia_kw: NaN, kw_por_torre: 10 }), 'potencia_kw');
  noEvaluable(energia({ potencia_kw: null, kw_por_torre: 10 }), 'potencia_kw');
  noEvaluable(energia({ potencia_kw: -5, kw_por_torre: 10 }), 'potencia_kw');
  noEvaluable(energia({ potencia_kw: 68, kw_por_torre: 0 }), 'kw_por_torre');
  noEvaluable(energia({ potencia_kw: 68, kwe_por_reactor: -40 }), 'kwe_por_reactor');
  noEvaluable(energia({ potencia_kw: 68, kw_por_torre: 10, fraccion_luz: 0 }), 'fraccion_luz');
  noEvaluable(energia({ potencia_kw: 68, kw_por_torre: 10, fraccion_luz: 1.5 }), 'fraccion_luz');
  noEvaluable(energia({ potencia_kw: 68, kw_por_torre: 10, fraccion_luz: NaN }), 'fraccion_luz');
  noEvaluable(energia({ potencia_kw: 1e308, kw_por_torre: 1e-300 }), 'potencia_kw');
  noEvaluable(energia(), 'potencia_kw');
});

test('drilling: 1 m in 10 cm bites is 10 bites; 30 cm in 10 cm bites is 3, not 4', () => {
  const r = planPerforacion({ profundidad_m: 1, bocado_cm: 10, potencia_w: 400 });
  assert.equal(r.evaluable, true);
  assert.equal(r.bocados, 10);
  assert.equal(r.ultimo_bocado_cm, 10);
  assert.equal(r.horas, null);
  assert.equal(r.energia_wh, null);
  assert.match(r.motivo_horas, /horas_por_bocado/);
  assert.match(r.motivo_energia, /horas_por_bocado/);
  sinNoFinitos(r);
  assert.equal(planPerforacion({ profundidad_m: 0.3, bocado_cm: 10 }).bocados, 3);
  const f = planPerforacion({ profundidad_m: 0.07, bocado_cm: 1 });
  assert.equal(f.bocados, 7, '0.07·100 = 7.000000000000001');
  assert.ok(f.ultimo_bocado_cm <= 1);
  const c = planPerforacion({ profundidad_m: 1, bocado_cm: 2 });
  assert.equal(c.bocados, 50);
  const p = planPerforacion({ profundidad_m: 0.25, bocado_cm: 10 });
  assert.equal(p.bocados, 3);
  rel(p.ultimo_bocado_cm, 5, 1e-12);
});

test('drilling: time and energy only when the time per bite is given; deeper than the drill class is flagged', () => {
  const r = planPerforacion({ profundidad_m: 1, bocado_cm: 10, potencia_w: 400, horas_por_bocado: 0.5, profundidad_max_m: 1 });
  assert.equal(r.horas, 5);
  assert.equal(r.energia_wh, 2000);
  assert.equal(r.supera_profundidad_max, false);
  const s = planPerforacion({ profundidad_m: 1.5, bocado_cm: 10, horas_por_bocado: 0.5, profundidad_max_m: 1 });
  assert.equal(s.supera_profundidad_max, true);
  assert.equal(s.energia_wh, null);
  assert.match(s.motivo_energia, /potencia_w/);
  const u = planPerforacion({ profundidad_m: 1, bocado_cm: 10 });
  assert.equal(u.supera_profundidad_max, null);
  assert.match(u.motivo_profundidad_max, /profundidad_max_m/);
  sinNoFinitos(r); sinNoFinitos(s); sinNoFinitos(u);
});

test('drilling: every bad input names its field', () => {
  noEvaluable(planPerforacion({ profundidad_m: 0, bocado_cm: 10 }), 'profundidad_m');
  noEvaluable(planPerforacion({ profundidad_m: NaN, bocado_cm: 10 }), 'profundidad_m');
  noEvaluable(planPerforacion({ profundidad_m: null, bocado_cm: 10 }), 'profundidad_m');
  noEvaluable(planPerforacion({ profundidad_m: 1, bocado_cm: 0 }), 'bocado_cm');
  noEvaluable(planPerforacion({ profundidad_m: 1, bocado_cm: Infinity }), 'bocado_cm');
  noEvaluable(planPerforacion({ profundidad_m: 1, bocado_cm: 10, potencia_w: -1 }), 'potencia_w');
  noEvaluable(planPerforacion({ profundidad_m: 1, bocado_cm: 10, potencia_w: NaN }), 'potencia_w');
  noEvaluable(planPerforacion({ profundidad_m: 1, bocado_cm: 10, horas_por_bocado: 0 }), 'horas_por_bocado');
  noEvaluable(planPerforacion({ profundidad_m: 1, bocado_cm: 10, profundidad_max_m: -1 }), 'profundidad_max_m');
  noEvaluable(planPerforacion({ profundidad_m: 1e308, bocado_cm: 1e-300 }), 'profundidad_m');
  noEvaluable(planPerforacion(), 'profundidad_m');
});

test('stable ice on a synthetic layer with NaN: exact counts over all cells', () => {
  const r = hieloEstable(sintetico(), 100);
  assert.equal(r.evaluable, true);
  assert.equal(r.medido, true);
  assert.deepEqual([...r.mascara], [1, 1, 0, 255, 1, 0, 255, 1, 0]);
  assert.deepEqual(r.celdas, { total: 9, con_dato: 7, estable: 4, estable_sombra: 2, sin_dato: 2 });
  assert.equal(r.fracciones.estable, 4 / 9);
  assert.equal(r.fracciones.estable_sombra, 2 / 9);
  assert.equal(r.fracciones.sin_dato, 2 / 9);
  assert.equal(r.umbral_K, 100);
  sinNoFinitos(r);
});

test('stable ice without a permanent-shadow layer: the shadow fraction is null with a reason', () => {
  const t = sintetico();
  delete t.capas.sombra_permanente;
  const r = hieloEstable(t, 100);
  assert.equal(r.celdas.estable, 4);
  assert.equal(r.celdas.estable_sombra, null);
  assert.equal(r.fracciones.estable_sombra, null);
  assert.match(r.motivo_sombra, /permanent-shadow/);
  sinNoFinitos(r);
});

test('stable ice on a terrain without temp_max is explicitly not measured', () => {
  const t = sintetico();
  delete t.capas.temp_max;
  const r = hieloEstable(t, 100);
  assert.equal(r.evaluable, true);
  assert.equal(r.medido, false);
  assert.equal(r.mascara, null);
  assert.equal(r.fracciones, null);
  assert.match(r.motivo, /temperature/);
  sinNoFinitos(r);
});

test('stable ice: bad threshold or broken terrain is not evaluable', () => {
  for (const u of [undefined, null, NaN, -1, 0, Infinity]) noEvaluable(hieloEstable(sintetico(), u), 'umbral_K');
  noEvaluable(hieloEstable(null, 100), 't');
  noEvaluable(hieloEstable({ n: 0, capas: {} }, 100), 't');
  const t = sintetico();
  t.capas.temp_max = new Float32Array(4);
  noEvaluable(hieloEstable(t, 100), 'temp_max');
  const s = sintetico();
  s.capas.sombra_permanente = new Float32Array(2);
  noEvaluable(hieloEstable(s, 100), 'sombra_permanente');
});

// Fracciones medidas sobre los .f32 de web/data/terreno con numpy (temp_max ≤ 100 K; sombra_permanente == 1).
const MEDIDO = {
  shoemaker: { estable: 304089, estable_sombra: 284231 },
  cresta_shackleton_gerlache: { estable: 32775, estable_sombra: 31965 },
  shackleton: { estable: 133560, estable_sombra: 131694 },
  shackleton_borde: { estable: 132782, estable_sombra: 129723 },
  polo_sur: { estable: 338565, estable_sombra: 306195 },
};

for (const [id, esperado] of Object.entries(MEDIDO)) {
  test(`stable ice at 100 K on the real ${id} terrain`, () => {
    const t = cargarReal(id);
    const r = hieloEstable(t, 100);
    const N = t.n * t.n;
    assert.equal(r.medido, true);
    assert.equal(r.celdas.sin_dato, 0);
    assert.equal(r.celdas.estable, esperado.estable);
    assert.equal(r.celdas.estable_sombra, esperado.estable_sombra);
    assert.equal(r.fracciones.estable, esperado.estable / N);
    console.log(`${id}: stable ${r.fracciones.estable.toFixed(5)}, stable in PSR ${r.fracciones.estable_sombra.toFixed(5)}, no data ${r.fracciones.sin_dato.toFixed(5)}`);
  });
}

test('the two figures measured by the other agent: shoemaker 0.29000, ridge 0.03126', () => {
  assert.equal(hieloEstable(cargarReal('shoemaker'), 100).fracciones.estable.toFixed(5), '0.29000');
  assert.equal(hieloEstable(cargarReal('cresta_shackleton_gerlache'), 100).fracciones.estable.toFixed(5), '0.03126');
});

test('point reading: cold permanently shadowed cell says surface ice would be stable, never that there is ice', () => {
  const r = lecturaPunto(sintetico(), 0, 1, { umbral_K: 100 });
  assert.equal(r.evaluable, true);
  assert.equal(r.hielo_superficie, 'si');
  assert.equal(r.temp_max_K.valor, 100);
  assert.equal(r.sombra_permanente.valor, 1);
  assert.equal(r.iluminacion.valor, 0);
  rel(r.pendiente_deg.valor, 10, 1e-4);
  assert.match(r.motivo, /100/);
  assert.match(r.nota, /not.*ice is present|does not show ice/i);
  assert.doesNotMatch(r.motivo, /there is ice|ice is present/i);
  sinNoFinitos(r);
});

test('point reading: warm cell is no, NaN temperature is not measured, missing layer is not measured', () => {
  const t = sintetico();
  const w = lecturaPunto(t, 0, 2, { umbral_K: 100 });
  assert.equal(w.hielo_superficie, 'no');
  assert.equal(w.temp_max_K.valor, 101);
  const n = lecturaPunto(t, 1, 0, { umbral_K: 100 });
  assert.equal(n.hielo_superficie, 'no_medido');
  assert.equal(n.temp_max_K.valor, null);
  assert.match(n.motivo, /no data/);
  const c = lecturaPunto(t, 1, 1, { umbral_K: 100 });
  assert.equal(c.hielo_superficie, 'si');
  assert.equal(c.sombra_permanente.valor, null);
  assert.equal(c.iluminacion.valor, null);
  delete t.capas.temp_max;
  const s = lecturaPunto(t, 0, 0, { umbral_K: 100 });
  assert.equal(s.hielo_superficie, 'no_medido');
  assert.match(s.motivo, /temperature/);
  for (const x of [w, n, c, s]) sinNoFinitos(x);
});

test('point reading on the real shoemaker terrain matches the layers at that cell', () => {
  const t = cargarReal('shoemaker');
  const i = t.capas.temp_max.findIndex((x) => x <= 100), f = Math.floor(i / t.n), c = i % t.n;
  const r = lecturaPunto(t, f, c, { umbral_K: 100 });
  assert.equal(r.hielo_superficie, 'si');
  assert.equal(r.temp_max_K.valor, t.capas.temp_max[i]);
  assert.ok(Number.isFinite(r.pendiente_deg.valor));
});

test('point reading: out-of-grid cell, bad threshold or no terrain is not evaluable', () => {
  const t = sintetico();
  noEvaluable(lecturaPunto(t, -1, 0, { umbral_K: 100 }), 'fila');
  noEvaluable(lecturaPunto(t, 3, 0, { umbral_K: 100 }), 'fila');
  noEvaluable(lecturaPunto(t, NaN, 0, { umbral_K: 100 }), 'fila');
  noEvaluable(lecturaPunto(t, 0, 7, { umbral_K: 100 }), 'col');
  noEvaluable(lecturaPunto(t, 0, null, { umbral_K: 100 }), 'col');
  noEvaluable(lecturaPunto(t, 0, 0, { umbral_K: NaN }), 'umbral_K');
  noEvaluable(lecturaPunto(t, 0, 0), 'umbral_K');
  noEvaluable(lecturaPunto(undefined, 0, 0, { umbral_K: 100 }), 't');
});

const FLOTA = { n_robots: 2, kg_por_dia_lunar: 10000, fraccion_luz: 1, distancia_acarreo_m: 500, carga_kg: 50, velocidad_m_s: 0.3, horas_dia_lunar: 708 };

test('excavation for water delegates to planFlota with the regolith as the mass', () => {
  const r = excavacionParaAgua({ regolito_kg: 357142.86, ...FLOTA });
  const p = planFlota({ masa_kg: 357142.86, ...FLOTA });
  assert.equal(r.evaluable, true);
  assert.equal(r.dias, p.dias);
  assert.equal(r.dias_excavacion, p.dias_excavacion);
  assert.equal(r.dias_acarreo, p.dias_acarreo);
  assert.equal(r.manda, p.manda);
  assert.equal(r.viajes, p.viajes);
  assert.equal(r.dias_excavacion, 357142.86 / 20000);
  sinNoFinitos(r);
});

test('excavation for water: bad regolith or fleet input names its field', () => {
  noEvaluable(excavacionParaAgua({ regolito_kg: NaN, ...FLOTA }), 'regolito_kg');
  noEvaluable(excavacionParaAgua({ regolito_kg: -1, ...FLOTA }), 'regolito_kg');
  noEvaluable(excavacionParaAgua({ ...FLOTA }), 'regolito_kg');
  noEvaluable(excavacionParaAgua({ regolito_kg: 1000, ...FLOTA, carga_kg: null }), 'carga_kg');
  noEvaluable(excavacionParaAgua({ regolito_kg: 1000, ...FLOTA, n_robots: 1.5 }), 'n_robots');
  noEvaluable(excavacionParaAgua({ regolito_kg: 1000, ...FLOTA, fraccion_luz: 2 }), 'fraccion_luz');
  noEvaluable(excavacionParaAgua(), 'regolito_kg');
});
