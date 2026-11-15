import test from 'node:test';
import assert from 'node:assert/strict';
import { solMundo, DIA_MARTE_H, OBLICUIDAD_MARTE, declinacionSolar, posicionSol, solTierra, solPolar, largoSombra, horaTexto, rumboTexto, DIA_DEL_ANO, DIA_LUNAR_H, MESES, FUENTES_SOL } from '../terreno/sol.js';

const cerca = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} vs ${b}`);

test('declination follows the seasons: about +23.4° in late June, −23.4° in late December, near 0 at the equinoxes', () => {
  cerca(declinacionSolar(172), 23.44, 0.15);
  cerca(declinacionSolar(355), -23.44, 0.15);
  cerca(declinacionSolar(80), 0, 0.6);
  cerca(declinacionSolar(266), 0, 0.6);
  assert.equal(DIA_DEL_ANO.length, 12);
  assert.equal(MESES.length, 12);
});

test('at local solar noon the Sun is due south (north of the tropic) at 90° − lat + decl', () => {
  const s = posicionSol(41.4, 10, 0);
  cerca(s.el, 90 - 41.4 + 10, 1e-9);
  cerca(s.az, 180, 1e-9);
  const sur = posicionSol(-30, 0, 0);
  cerca(sur.el, 60, 1e-9);
  cerca(sur.az, 0, 1e-9, 'south of the Sun it stands due north');
});

test('morning Sun is in the east, afternoon Sun in the west, midnight Sun below the horizon at mid latitudes', () => {
  const m = posicionSol(40, 0, -45), t = posicionSol(40, 0, 45), n = posicionSol(40, 0, 180);
  assert.ok(m.az > 90 && m.az < 180 && t.az > 180 && t.az < 270);
  cerca(m.el, t.el, 1e-9);
  cerca(m.az + t.az, 360, 1e-9);
  assert.ok(n.el < 0);
  cerca(posicionSol(0, 0, -90).az, 90, 1e-9, 'equinox sunrise on the equator is due east');
  cerca(posicionSol(0, 0, -90).el, 0, 1e-9);
});

test('polar day and polar night come out of the same formula', () => {
  for (let h = 0; h < 24; h += 3) {
    assert.ok(solTierra({ lat: 80, mes: 6, hora: h }).el > 0, `80° N in June at ${h} h`);
    assert.ok(solTierra({ lat: 80, mes: 12, hora: h }).el < 0, `80° N in December at ${h} h`);
    assert.ok(solTierra({ lat: -77.25, mes: 8, hora: h }).el < 3, `77° S in August at ${h} h`);
  }
});

test('on a lunar polar window the Sun goes once round the horizon per synodic day and keeps its height', () => {
  cerca(DIA_LUNAR_H, 708.72, 1e-9);
  const a = solPolar({ az0: 315, el: 1.5, horas: 24 });
  cerca(a.az, 315 - 360 * 24 / 708.72, 1e-9);
  assert.equal(a.el, 1.5);
  cerca(solPolar({ az0: 10, el: 1.5, horas: DIA_LUNAR_H / 2 }).az, 190, 1e-9);
  cerca(solPolar({ az0: 315, el: 2, horas: DIA_LUNAR_H }).az, 315, 1e-9);
  cerca(solPolar({ az0: 315, el: 2, horas: 6, dia_h: 24 }).az, 225, 1e-9);
});

test('shadow length is height over tan(Sun height); no Sun, no shadow', () => {
  cerca(largoSombra(20, 45), 20, 1e-9);
  cerca(largoSombra(20, 1.5), 763.8, 0.1);
  assert.equal(largoSombra(20, 0), null);
  assert.equal(largoSombra(20, -5), null);
});

test('labels and sources', () => {
  assert.equal(horaTexto(14.5), '14:30');
  assert.equal(horaTexto(24), '00:00');
  assert.equal(horaTexto(0.999), '01:00');
  assert.deepEqual([0, 44, 90, 200, 359].map(rumboTexto), ['N', 'NE', 'E', 'S', 'N']);
  for (const f of Object.values(FUENTES_SOL)) assert.match(f.url, /^https:\/\/(gml\.noaa\.gov|nssdc\.gsfc\.nasa\.gov)\//);
});

test('a non-polar place on another world: noon Sun at 90° − |lat − subsolar latitude|, and the Mars figures are the fact-sheet ones', () => {
  cerca(solMundo({ lat: 18.44, decl: 0, hora: 12 }).el, 90 - 18.44, 1e-9);
  cerca(solMundo({ lat: 18.44, decl: OBLICUIDAD_MARTE, hora: 12 }).el, 90 - (OBLICUIDAD_MARTE - 18.44), 1e-9);
  assert.ok(solMundo({ lat: 18.44, decl: 0, hora: 0 }).el < 0);
  cerca(solMundo({ lat: 18.44, decl: 0, hora: 6 }).az, 90, 1e-9);
  assert.equal(DIA_MARTE_H, 24.6597);
  assert.equal(OBLICUIDAD_MARTE, 25.19);
  assert.match(FUENTES_SOL.marte.cita, /24\.6597/);
  assert.match(FUENTES_SOL.marte.cita_oblicuidad, /25\.19/);
});
