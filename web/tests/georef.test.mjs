import test from 'node:test';
import assert from 'node:assert/strict';
import { centroPixel, pixelDeXY, xyALatLon, latLonAXY, pixelALatLon, latLonAPixel } from '../terreno/georef.js';

const R = 1737400;
const polarSur = { n: 1024, m_por_px: 40, centro: { lat: -89.67, lon: 129.8 },
  georef: { tipo: 'estereo_polar', polo: 'sur', radio_m: R, x0_m: -20000, y0_m: 20000 } };
const polarNorte = { ...polarSur, georef: { ...polarSur.georef, polo: 'norte' } };
const aeqd = { n: 1024, m_por_px: 39.0625, centro: { lat: 75.4, lon: -89.68 },
  georef: { tipo: 'local_aeqd', radio_m: 6371000, x0_m: -19980.47, y0_m: 19980.47 } };

const cerca = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} vs ${b}`);

function distanciaGranCirculo(R, lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const a = Math.sin((lat2 - lat1) * r / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin((lon2 - lon1) * r / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

test('pixel centre follows x = x0 + col·m and y = y0 − row·m', () => {
  const p = centroPixel(polarSur, 10, 3);
  assert.equal(p.x, -20000 + 3 * 40);
  assert.equal(p.y, 20000 - 10 * 40);
  const q = pixelDeXY(polarSur, p.x, p.y);
  cerca(q.fila, 10, 1e-9); cerca(q.col, 3, 1e-9);
});

test('south polar stereographic: origin is the pole', () => {
  cerca(xyALatLon(polarSur, 0, 0).lat, -90, 1e-12);
});

test('south polar stereographic: +x points to lon 90E and +y to lon 0', () => {
  const e = xyALatLon(polarSur, 5000, 0);
  cerca(e.lon, 90, 1e-9);
  const n = xyALatLon(polarSur, 0, 5000);
  cerca(n.lon, 0, 1e-9);
  assert.ok(e.lat > -90 && e.lat < -89.8);
});

test('south polar stereographic: lat -89 on lon 0 sits at 2R·tan(0.5°) on +y', () => {
  const p = latLonAXY(polarSur, -89, 0);
  cerca(p.x, 0, 1e-6);
  cerca(p.y, 2 * R * Math.tan(0.5 * Math.PI / 180), 1e-6);
});

test('north polar stereographic follows the contract axes too (+x lon 90E, +y lon 0)', () => {
  cerca(xyALatLon(polarNorte, 0, 0).lat, 90, 1e-12);
  cerca(xyALatLon(polarNorte, 3000, 0).lon, 90, 1e-9);
  cerca(xyALatLon(polarNorte, 0, 3000).lon, 0, 1e-9);
  assert.ok(xyALatLon(polarNorte, 0, 3000).lat < 90);
});

test('polar stereographic round trip lat/lon → x/y → lat/lon', () => {
  for (const meta of [polarSur, polarNorte]) {
    const s = meta.georef.polo === 'sur' ? -1 : 1;
    for (const [lat, lon] of [[89.9, 0], [89.5, 45], [88.7, -170], [89.99, 179], [85, -60]]) {
      const p = latLonAXY(meta, s * lat, lon);
      const g = xyALatLon(meta, p.x, p.y);
      cerca(g.lat, s * lat, 1e-9); cerca(g.lon, lon, 1e-7);
    }
  }
});

test('azimuthal equidistant: origin is the meta centre', () => {
  const g = xyALatLon(aeqd, 0, 0);
  cerca(g.lat, 75.4, 1e-12); cerca(g.lon, -89.68, 1e-12);
});

test('azimuthal equidistant: +y is north, +x is east', () => {
  const n = xyALatLon(aeqd, 0, 10000);
  cerca(n.lon, -89.68, 1e-9);
  cerca(n.lat, 75.4 + (10000 / 6371000) * 180 / Math.PI, 1e-9);
  const e = xyALatLon(aeqd, 10000, 0);
  assert.ok(e.lon > -89.68);
});

test('azimuthal equidistant preserves distance from the centre', () => {
  for (const [x, y] of [[15000, -7000], [-19000, 19000], [300, 12]]) {
    const g = xyALatLon(aeqd, x, y);
    cerca(distanciaGranCirculo(6371000, 75.4, -89.68, g.lat, g.lon), Math.hypot(x, y), 1e-4);
    const p = latLonAXY(aeqd, g.lat, g.lon);
    cerca(p.x, x, 1e-5); cerca(p.y, y, 1e-5);
  }
});

test('pixel ↔ lat/lon round trip on both georef types', () => {
  for (const meta of [polarSur, aeqd]) {
    const g = pixelALatLon(meta, 700.25, 31.5);
    const p = latLonAPixel(meta, g.lat, g.lon);
    cerca(p.fila, 700.25, 1e-6); cerca(p.col, 31.5, 1e-6);
  }
});

test('unknown georef type throws a clear error', () => {
  assert.throws(() => xyALatLon({ ...aeqd, georef: { tipo: 'utm' } }, 0, 0), /georef/);
});
