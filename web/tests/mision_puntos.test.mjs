import test from 'node:test';
import assert from 'node:assert/strict';
import { LETRAS, distanciaKm, elegirPuntos, puntosDeMision, frasesPuntos } from '../explorar/mision_puntos.js';

const c = (lat, lon, similitud_pct) => ({ lat, lon, similitud_pct, valores: {} });

test('distance on a sphere: a quarter of a great circle, and zero', () => {
  assert.ok(Math.abs(distanciaKm({ lat: 0, lon: 0 }, { lat: 0, lon: 90 }, 1000) - 1000 * Math.PI / 2) < 1e-9);
  assert.equal(distanciaKm({ lat: 10, lon: 20 }, { lat: 10, lon: 20 }, 3389.5), 0);
});

test('spots are taken best first, kept apart, lettered in order, and may be filtered', async () => {
  const cand = [c(0, 0, 99), c(0, 1, 98.9), c(0, 30, 98), c(0, 60, 97), c(0, 90, 96), c(0, 120, 95), c(0, 150, 94)];
  const libre = await elegirPuntos(cand, { separacion_km: 1000, radio_km: 3389.5 });
  assert.deepEqual(libre.puntos.map((p) => [p.letra, p.lon]), [['A', 0], ['B', 30], ['C', 60], ['D', 90], ['E', 120]]);
  assert.equal(libre.revisados, 5);
  const vistos = [];
  const filtrado = await elegirPuntos(cand, { separacion_km: 1000, radio_km: 3389.5, apta: async (la, lo) => { vistos.push(lo); return lo !== 30 && lo !== 60; } });
  assert.deepEqual(filtrado.puntos.map((p) => [p.letra, p.lon]), [['A', 0], ['B', 90], ['C', 120], ['D', 150]]);
  assert.deepEqual(vistos, [0, 30, 60, 90, 120, 150], 'the one too close to A is never checked');
  const tope = await elegirPuntos(cand, { separacion_km: 1000, radio_km: 3389.5, apta: async () => false, tope: 3 });
  assert.deepEqual([tope.puntos.length, tope.revisados], [0, 3]);
  assert.equal(LETRAS.length, 5);
});

const motor = (r) => ({ leerPunto: () => ({ valores: { rug: 0.02, lluvia: 3 } }), parecidosEnCuerpo: (...a) => { motor.args = a; return r; } });
const MARTE = { id: 'mars', radio_km: 3389.5 };
const corto = (id) => ({ rug: 'roughness', lluvia: 'rain and snow', roca: 'rock type' })[id];
const ACTIVA = { parametros: ['rug', 'lluvia'], referencia: { lat: 35.68, lon: -116.22, nombre: 'Dumont Dunes, California' } };

test('mission spots: reverse search from the test site, with the zone and limit filters passed on', async () => {
  const r = { usados: ['rug'], sin_capa: ['lluvia'], sin_referencia: [], celdas: 5000, empatadas: 900, candidatos: [c(10, 0, 99), c(10, 40, 98), c(10, 80, 97)] };
  const ambito = () => true;
  const res = await puntosDeMision({ M: motor(r), mundo: MARTE, activa: ACTIVA, separacion_km: 1000, ambito, apta: async () => true, limites: true });
  assert.equal(res.estado, 'ok');
  assert.deepEqual(res.puntos.map((p) => p.letra), ['A', 'B', 'C']);
  assert.deepEqual([motor.args[0], motor.args[2], motor.args[3].filtro], ['mars', ['rug', 'lluvia'], ambito]);
  assert.deepEqual(motor.args[1], { rug: 0.02, lluvia: 3 });
  const f = frasesPuntos(res, { corto, en: 'on Mars' });
  assert.equal(f.titulo, 'Where on Mars this test fits');
  assert.equal(f.lineas[0], "A–C on the globe: the places on Mars most like Dumont Dunes, California, where NASA ran this test, in roughness, among those that meet NASA's limits in step 2. Own metric, year averages.");
  const zona = await puntosDeMision({ M: motor({ ...r, sin_referencia: ['roca'] }), mundo: MARTE, activa: ACTIVA, separacion_km: 1000, apta: async () => true });
  const fz = frasesPuntos(zona, { corto, en: 'on the Moon' });
  assert.match(fz.lineas[0], /in roughness, inside the area searched in step 2\. Own metric/);
  assert.equal(fz.nota, 'Earth only, not on the Moon: rain and snow. No value at the test site, so not used: rock type.');
  assert.equal(f.lineas[1], 'Only 3 places far enough apart.');
  assert.equal(f.lineas[2], '18 % of the grid cells compared on Mars are within half a point of the best: with one parameter, much of it looks alike, and these are 3 of them spread apart.');
  assert.equal(frasesPuntos({ ...res, empatadas: 200 }, { corto, en: 'on Mars' }).lineas.length, 2, 'a few ties are not worth a warning');
  assert.equal(f.nota, 'Earth only, not on Mars: rain and snow.');
});

test('mission spots: no mission, no test site, only Earth-side traits, or no place that passes', async () => {
  const vacio = { usados: [], sin_capa: ['lluvia', 'roca'], sin_referencia: [], celdas: 0, empatadas: 0, candidatos: [] };
  assert.equal((await puntosDeMision({ M: motor(vacio), mundo: MARTE, activa: null, separacion_km: 1000 })).estado, 'sin_mision');
  assert.equal(frasesPuntos({ estado: 'sin_mision', puntos: [] }, { corto, en: 'on Mars' }), null);
  const sinRef = await puntosDeMision({ M: motor(vacio), mundo: MARTE, activa: { parametros: ['rug'], referencia: null }, separacion_km: 1000 });
  assert.equal(sinRef.estado, 'sin_referencia');
  assert.match(frasesPuntos(sinRef, { corto, en: 'on Mars' }).lineas[0], /no test site with coordinates/);
  const soloTierra = await puntosDeMision({ M: motor(vacio), mundo: MARTE, activa: { ...ACTIVA, parametros: ['lluvia', 'roca'] }, separacion_km: 1000 });
  assert.equal(soloTierra.estado, 'sin_parametros');
  const f = frasesPuntos(soloTierra, { corto, en: 'on Mars' });
  assert.equal(f.lineas[0], 'Every parameter of this mission is Earth only (rain and snow and rock type): there is nothing on Mars to rank.');
  assert.equal(f.lineas[1], 'The numbered spots come from step 2, not from the mission.');
  const r = { usados: ['rug'], sin_capa: [], sin_referencia: [], celdas: 10, empatadas: 1, candidatos: [c(80, 0, 99)] };
  const sinLugar = await puntosDeMision({ M: motor(r), mundo: MARTE, activa: ACTIVA, separacion_km: 1000, apta: async () => false, limites: true });
  assert.equal(sinLugar.estado, 'sin_lugar');
  assert.equal(frasesPuntos(sinLugar, { corto, en: 'on Mars' }).lineas[0], "No place on Mars that meets NASA's limits in step 2 could be compared in roughness.");
  const sinFiltro = await puntosDeMision({ M: motor(r), mundo: MARTE, activa: ACTIVA, separacion_km: 1000 });
  assert.equal(frasesPuntos(sinFiltro, { corto, en: 'on Mars' }).lineas[0], 'A on the globe: the place on Mars most like Dumont Dunes, California, where NASA ran this test, in roughness. Own metric, year averages.');
});
