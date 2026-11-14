import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  leerCond, escribirCond, opcionesRequisito, seleccion, canalDe, valorCondicion, veredictoCelda, textoVeredicto, lineaResumen,
  fmtValor, colorearCond, filasHoja,
} from '../mapa/condiciones.js';
import { COLOR } from '../mapa/capas.js';

// Imagen RGBA de 4 × 2 (fila 0 = norte). Canal R oscuridad (18 h/byte), G sol rasante, B frío (150 + 0,6·b K).
const img = (pix) => ({ ancho: 4, alto: 2, canales: 4, datos: Uint8Array.from(pix.flatMap((p) => [...p, 255])) });
const A = img([[200, 100, 60], [200, 100, 61], [255, 255, 255], [10, 50, 200], [1, 40, 220], [1, 40, 221], [1, 40, 222], [255, 255, 255]]);
const B = img([[10, 255, 255], [250, 255, 255], [255, 255, 255], [255, 255, 255], [5, 255, 255], [255, 255, 255], [5, 255, 255], [255, 255, 255]]);
const LTV150 = { indice: 1, variable: 'horas_en_sombra', op: '<=', valor: 150, unidad: 'h', texto: 'survive up to 150 h in shadow', tratamiento: 'condicion',
  condicion: 'oscuridad_max_h', sentido: '>=', prueba: 'Continuous darkness ≥ 150 h', veredicto_global: 'reaches', pct_tierra: 14.528,
  lat_umbral: { norte: 66.59, sur: -66.59 }, fuente: 'https://www.nasa.gov/moonbase-systems/', cita: 'survive up to 150 hours in shadow' };
const FRIO = { indice: 2, variable: 'temp_k', op: '>=', valor: 40, unidad: 'K', tratamiento: 'condicion', condicion: 't_min_alcanzable_k', sentido: '<=',
  prueba: 'Air temperature ≤ 40 K', veredicto_global: 'not_reachable', extremo_tierra: 186.25, pct_tierra: 0, lat_umbral: null,
  laboratorios: [{ id: 'glenn_camara_polar', nombre: 'Glenn chamber', cita: '140K at vacuum', fuente: 'https://ntrs.nasa.gov/x' }], camara: 'not reachable in the field — chamber only' };
const PEND = { indice: 0, variable: 'pendiente_deg', op: '<=', valor: 20, unidad: 'deg', tratamiento: 'terreno', condicion: null, motivo: 'local slope' };
const CALOR = { indice: 3, variable: 'temp_k', op: '<=', valor: 300, unidad: 'K', tratamiento: 'no_evaluado', condicion: null, motivo: 'upper temperature limit' };
const M = {
  rejilla: { ancho: 4, alto: 2, lat0: 45, lon0: -135, paso: 90 },
  canales: {
    'cond_a.png': [{ id: 'oscuridad_max_h', unidad: 'h', scale: 18, offset: 0, por_latitud: true }, { id: 'sol_rasante_h_ano', unidad: 'h/year', scale: 2, offset: 0, por_latitud: true },
      { id: 't_min_alcanzable_k', unidad: 'K', scale: 0.6, offset: 150 }],
    'cond_b.png': [{ id: 'tiempo_ciudad_h', unidad: 'h', scale: 0.4, offset: 0 }, { id: 'libre', vacio: true }, { id: 'libre', vacio: true }],
  },
  por_latitud: { oscuridad_max_h: [3600.5, 14.42], sol_rasante_h_ano: [210.4, 98.55] },
  entorno: [{ condicion: 'sol_rasante_h_ano', texto: 'lunar grazing sun' }],
  equipos: [{ id: 'ltv', nombre: 'Lunar Terrain Vehicle', requisitos: [PEND, LTV150, FRIO, CALOR] }, { id: 'flip', nombre: 'FLIP', requisitos: [] }],
};
const IMGS = { 'cond_a.png': A, 'cond_b.png': B };

test('permalink keeps mode, equipment, requirement and own access threshold; ranking is the default', () => {
  const q = escribirCond('?par=shackleton_P3&capa=S', { modo: 'cond', eq: 'ltv', req: '1', acc: 24 });
  assert.equal(q, '?par=shackleton_P3&capa=S&modo=cond&eq=ltv&req=1&acc=24');
  assert.deepEqual(leerCond(q), { modo: 'cond', eq: 'ltv', req: '1', acc: 24 });
  assert.deepEqual(leerCond('?par=x&acc=-3'), { modo: 'ranking', eq: null, req: null, acc: null });
  assert.equal(escribirCond('?par=x', { modo: 'ranking', eq: 'ltv', req: '1', acc: 5 }), '?par=x');
});

test('requirement options: evaluable ones first, terrain and not-evaluated listed apart, environment layers always there', () => {
  const o = opcionesRequisito(M, 'ltv');
  assert.deepEqual(o.evaluables.map((x) => x.valor), ['1', '2']);
  assert.deepEqual(o.otros.map((x) => [x.valor, x.nota]), [['0', 'measured on the 3D terrain'], ['3', 'not evaluated']]);
  assert.deepEqual(o.entorno.map((x) => x.valor), ['env:oscuridad_max_h', 'env:sol_rasante_h_ano', 'env:t_min_alcanzable_k']);
  assert.equal(opcionesRequisito(M, 'flip').evaluables.length, 0);
});

test('selection falls back to the first evaluable requirement, then to an environment layer', () => {
  assert.equal(seleccion(M, 'ltv', null).req.indice, 1);
  assert.equal(seleccion(M, 'ltv', '2').canal, 't_min_alcanzable_k');
  assert.equal(seleccion(M, 'ltv', '0').req.indice, 1, 'a terrain requirement cannot be painted');
  const f = seleccion(M, 'flip', null);
  assert.equal(f.req, null);
  assert.equal(f.canal, 'sol_rasante_h_ano');
  assert.equal(seleccion(M, 'nope', null).eq.id, 'ltv');
  assert.equal(seleccion(M, 'ltv', 'env:t_min_alcanzable_k').canal, 't_min_alcanzable_k');
});

test('latitude conditions read the exact value per row; others decode the byte; ocean and no data are null', () => {
  assert.equal(valorCondicion(M, 'oscuridad_max_h', 1, 0, IMGS), 14.42);
  assert.equal(valorCondicion(M, 'oscuridad_max_h', 0, 2, IMGS), null, 'ocean');
  assert.ok(Math.abs(valorCondicion(M, 't_min_alcanzable_k', 0, 0, IMGS) - 186) < 1e-9);
  assert.equal(valorCondicion(M, 'tiempo_ciudad_h', 0, 3, IMGS), null, 'land without access data');
  assert.deepEqual(canalDe(M, 'tiempo_ciudad_h').fichero, 'cond_b.png');
});

test('cell verdicts: reaches, partial with fraction for hours, kelvins short for cold, not reachable when no land cell gets there', () => {
  assert.deepEqual(veredictoCelda(LTV150, 3600.5), { veredicto: 'reaches', fraccion: 1, falta: 0 });
  const p = veredictoCelda(LTV150, 62);
  assert.equal(p.veredicto, 'partial');
  assert.ok(Math.abs(p.fraccion - 62 / 150) < 1e-12);
  assert.equal(textoVeredicto(LTV150, p), 'partial (41 %)');
  const f = veredictoCelda(FRIO, 186);
  assert.equal(f.veredicto, 'not_reachable');
  assert.equal(textoVeredicto(FRIO, f), 'not reachable on Earth');
  const caliente = { ...FRIO, veredicto_global: 'reaches', valor: 200 };
  assert.equal(textoVeredicto(caliente, veredictoCelda(caliente, 230)), 'partial (30 K short)');
  assert.equal(textoVeredicto(PEND, veredictoCelda(PEND, null)), 'measured on the 3D terrain');
  assert.equal(textoVeredicto(CALOR, veredictoCelda(CALOR, null)), 'not evaluated');
  assert.equal(textoVeredicto(LTV150, veredictoCelda(LTV150, null)), 'no data');
});

test('summary line gives % of land and both latitudes, or says chamber only', () => {
  assert.equal(lineaResumen(LTV150), 'Continuous darkness ≥ 150 h: 14.5 % of land, north of 66.59° N / south of 66.59° S');
  assert.equal(lineaResumen(FRIO), 'Air temperature ≤ 40 K: not reachable in the field — chamber only (coldest land cell 186.3 K)');
});

test('values are formatted with their unit', () => {
  assert.equal(fmtValor(2398.97, 'h'), '2,399 h');
  assert.equal(fmtValor(14.42, 'h'), '14.4 h');
  assert.equal(fmtValor(null, 'K'), '—');
});

test('painting: ocean transparent, reach mask from exact values, access filter greys far cells', () => {
  const r = colorearCond({ man: M, canal: 'oscuridad_max_h', imgs: IMGS, req: LTV150, acc: null });
  assert.equal(r.rgba[2 * 4 + 3], 0, 'ocean stays transparent');
  assert.deepEqual([...r.alcanza], [1, 1, 0, 1, 0, 0, 0, 0]);
  assert.equal(r.log, true);
  const g = colorearCond({ man: M, canal: 'oscuridad_max_h', imgs: IMGS, req: LTV150, acc: 3 });
  assert.equal(g.cuenta.lejos, 2);
  assert.equal(g.cuenta.sin_acceso, 2);
  assert.deepEqual([...g.rgba.slice(4, 7)], COLOR.falla);
  const t = colorearCond({ man: M, canal: 't_min_alcanzable_k', imgs: IMGS, req: FRIO, acc: null });
  assert.equal(t.log, false);
  assert.ok(t.alcanza.every((x) => x === 0));
});

test('sheet rows cover every requirement of the equipment; only not reachable breaks', () => {
  const filas = filasHoja(M, M.equipos[0], 1, 0, IMGS);
  assert.deepEqual(filas.map((f) => f.texto), ['measured on the 3D terrain', 'partial (10 %)', 'not reachable on Earth', 'not evaluated']);
  assert.deepEqual(filas.map((f) => f.rompe), [false, false, true, false]);
  assert.equal(filas[1].valor, 14.42);
  assert.deepEqual(filasHoja(M, M.equipos[1], 1, 0, IMGS), []);
});

test('the real manifest has no number without a source', async () => {
  let m;
  try { m = JSON.parse(await readFile(new URL('../data/global/condiciones.json', import.meta.url), 'utf8')); } catch { return; }
  assert.equal(m.prerregistrado, false);
  for (const c of Object.values(m.canales).flat()) if (!c.vacio) assert.ok(/^https?:\/\//.test(c.fuente), c.id);
  for (const e of m.equipos) for (const r of e.requisitos) {
    assert.ok(r.fuente && r.cita, `${e.id} ${r.variable}`);
    if (r.tratamiento === 'condicion') assert.ok(['reaches', 'not_reachable'].includes(r.veredicto_global));
  }
});
