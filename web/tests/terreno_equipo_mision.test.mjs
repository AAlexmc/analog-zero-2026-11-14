import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { equiposDeMision, formaPublicada, medidaForma, sustitutoDe, limitesDe, textoPendiente, ROTULO } from '../terreno/equipo_mision.js';

const leer = (f) => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url), 'utf8'));
const CAT = leer('equipo_mision.json');
const MODELOS = leer('modelos.json').modelos;
const eqDe = (mision, id) => equiposDeMision(CAT, mision).find((e) => e.id === id);
const cerca = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);
const dim = (valor, unidad = 'm') => ({ valor, unidad, fuente: 'https://example.org/spec', cita: 'Height: 2m Width: 1.9m Length: 2.9m', verificado: true });

test('equipment of a mission: the list from the catalogue, empty for an unknown mission or a broken catalogue', () => {
  assert.deepEqual(equiposDeMision(CAT, 'biomarcadores').map((e) => e.id), ['zoe']);
  assert.deepEqual(equiposDeMision(CAT, 'polimeros_sellos'), []);
  assert.deepEqual(equiposDeMision(CAT, 'no_such_mission'), []);
  for (const roto of [null, {}, { misiones: 'x' }, { misiones: [{ mision: 'a', equipos: null }] }]) assert.deepEqual(equiposDeMision(roto, 'a'), []);
});

test('Zoë: a box with the three published sizes, each with its source and quote', () => {
  const f = formaPublicada(eqDe('biomarcadores', 'zoe'));
  assert.equal(f.forma, 'caja');
  assert.deepEqual(medidaForma(f), [2.9, 1.9, 2]);
  assert.equal(f.rotulo, ROTULO.caja);
  assert.equal(f.supuesto, null);
  assert.deepEqual(f.citas.map((c) => c.etiqueta), ['length', 'width', 'height']);
  assert.ok(f.citas.every((c) => /^https:\/\//.test(c.fuente) && c.cita.length > 0));
});

test('HI-SEAS dome: diameter from length = width (36 ft), no height published → half sphere, said as assumed', () => {
  const f = formaPublicada(eqDe('simulacion_larga', 'domo_hi_seas'));
  assert.equal(f.forma, 'domo');
  cerca(f.diametro_m, 36 * 0.3048);
  cerca(f.alto_m, (36 * 0.3048) / 2);
  assert.match(f.supuesto, /height not published/);
  assert.equal(f.rotulo, ROTULO.domo);
});

test('a habitat with length ≠ width is a box, in metres from feet (ILC Dover 24 × 16 × 8 ft)', () => {
  const f = formaPublicada(eqDe('habitats_inflables', 'habitat_inflable'));
  assert.equal(f.forma, 'caja');
  medidaForma(f).forEach((v, i) => cerca(v, [24, 16, 8][i] * 0.3048));
});

test('a dome with a published height is a cap of that height', () => {
  const f = formaPublicada({ tipo: 'habitat', dimensiones: { diametro: dim(10), alto: dim(3) } });
  assert.deepEqual([f.forma, f.diametro_m, f.alto_m, f.supuesto], ['domo', 10, 3, null]);
});

test('missing sizes: nothing drawn, and the reason says which', () => {
  const sc = formaPublicada(eqDe('ruedas_en_arena', 'scarecrow'));
  assert.equal(sc.forma, null);
  assert.equal(sc.motivo, 'not enough published dimensions');
  assert.deepEqual(sc.falta, ['width', 'height']);
  const k10 = formaPublicada(eqDe('georradar_hielo', 'k10_black'));
  assert.equal(k10.motivo, 'no published dimensions', 'mass alone is not a size');
  assert.equal(formaPublicada({ tipo: 'rover', dimensiones: { largo: dim(2), ancho: dim(1), alto: { ...dim(1), fuente: null } } }).forma, null, 'a size without a source does not count');
  assert.equal(formaPublicada({ tipo: 'rover', dimensiones: { largo: dim(2), ancho: dim(1), alto: dim(0) } }).forma, null, 'zero is not a size');
  assert.equal(formaPublicada({ tipo: 'rover', dimensiones: { largo: dim(2), ancho: dim(1), alto: dim(1, 'furlong') } }).forma, null, 'unknown unit');
  assert.equal(formaPublicada({ tipo: 'habitat', dimensiones: { alto: dim(3) } }).forma, null, 'a dome needs its diameter');
  assert.equal(formaPublicada(null).motivo, 'no published dimensions');
});

test('Lunar Electric Rover → the SEV model already in the repo, matched by the published file name', () => {
  const s = sustitutoDe(eqDe('movilidad_rovers', 'lunar_electric_rover'), MODELOS);
  assert.equal(s.modelo.fichero, 'modelos/sev.glb');
  assert.equal(s.rotulo, 'SEV model shown in place of the Lunar Electric Rover (the SEV concept evolved from it)');
  assert.match(s.cita.cita, /evolved from the Lunar Electric Rover/);
  assert.equal(sustitutoDe(eqDe('ruedas_en_arena', 'scarecrow'), MODELOS), null, 'Scarecrow: no stand-in, its model is not in the repo');
  assert.equal(sustitutoDe(eqDe('movilidad_rovers', 'lunar_electric_rover'), null), null);
  assert.equal(sustitutoDe(eqDe('biomarcadores', 'zoe'), MODELOS), null);
});

test('published limits, as written by the source; the slope compared with the cell slope', () => {
  const l = limitesDe(eqDe('ruedas_en_arena', 'scarecrow'));
  assert.equal(l.length, 1);
  assert.equal(l[0].texto, 'Slope ≤ 15°');
  assert.equal(limitesDe(eqDe('simulacion_larga', 'domo_hi_seas'))[0].texto, 'Wind (95th percentile) ≤ 70 mph');
  assert.deepEqual(limitesDe(eqDe('lidar_estereo', 'lidar_ilris3d')).map((x) => x.texto), ['Temperature ≥ 0 °C', 'Temperature ≤ 40 °C']);
  assert.deepEqual(limitesDe({ limites: null }), []);
  assert.equal(textoPendiente(9.64, l[0], 10).texto, 'slope here 9.6° — within the published 15° · measured over 10.0 m terrain cells');
  assert.equal(textoPendiente(15, l[0], 10).estado, 'dentro');
  assert.equal(textoPendiente(15.2, l[0], 9.79).texto, 'slope here 15.2° — over the published 15° · measured over 9.8 m terrain cells');
  assert.equal(textoPendiente(NaN, l[0], 10).estado, 'sin_dato');
});
