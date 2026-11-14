import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../lib/three/three.module.js';
import { latLonAVector, vectorALatLon, rayoEsfera, distanciaAngular, formatoLatLon, normLon } from '../explorar/geo.js';

const cerca = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} vs ${b}`);

test('poles: +Y is 90° N and −Y is 90° S, with longitude 0 by convention', () => {
  assert.deepEqual(vectorALatLon({ x: 0, y: 1, z: 0 }), { lat: 90, lon: 0 });
  assert.deepEqual(vectorALatLon({ x: 0, y: -3, z: 0 }), { lat: -90, lon: 0 });
  const v = latLonAVector(-90, 129.78);
  cerca(v.y, -1, 1e-15); cerca(Math.hypot(v.x, v.z), 0, 1e-15);
});

test('east is positive: +X is 0°, −Z is 90° E, +Z is 90° W', () => {
  assert.deepEqual(vectorALatLon({ x: 1, y: 0, z: 0 }), { lat: 0, lon: 0 });
  cerca(vectorALatLon({ x: 0, y: 0, z: -1 }).lon, 90, 1e-12);
  cerca(vectorALatLon({ x: 0, y: 0, z: 1 }).lon, -90, 1e-12);
});

test('meridian 180: both sides of the seam come out as 180, never −180', () => {
  assert.equal(vectorALatLon({ x: -1, y: 0, z: 0 }).lon, 180);
  assert.equal(vectorALatLon({ x: -1, y: 0, z: -0 }).lon, 180);
  assert.equal(normLon(-180), 180);
  assert.equal(normLon(540), 180);
  cerca(vectorALatLon(latLonAVector(10, 179.99)).lon, 179.99, 1e-9);
  cerca(vectorALatLon(latLonAVector(10, -179.99)).lon, -179.99, 1e-9);
});

test('round trip lat/lon → vector → lat/lon over a grid, any radius', () => {
  for (let lat = -89.5; lat <= 89.5; lat += 7.25) for (let lon = -179.5; lon <= 180; lon += 11.5) {
    const p = vectorALatLon(latLonAVector(lat, lon, 1737.4));
    cerca(p.lat, lat, 1e-9, 'lat'); cerca(p.lon, lon, 1e-9, 'lon');
  }
});

test('same frame as the texture on three.js SphereGeometry: vertex uv (u = (lon+180)/360, v = (lat+90)/180) matches', () => {
  const g = new THREE.SphereGeometry(1, 64, 32), pos = g.attributes.position, uv = g.attributes.uv;
  let n = 0;
  for (let i = 0; i < pos.count; i++) {
    const u = uv.getX(i), v = uv.getY(i);
    const latUV = -90 + 180 * v, lonUV = -180 + 360 * u;
    if (Math.abs(latUV) > 89.9 || u < 1e-9 || u > 1 - 1e-9) continue;
    const p = vectorALatLon({ x: pos.getX(i), y: pos.getY(i), z: pos.getZ(i) });
    cerca(p.lat, latUV, 1e-4, `lat vertex ${i}`); cerca(p.lon, lonUV, 1e-4, `lon vertex ${i}`);
    n++;
  }
  assert.ok(n > 1500, `checked ${n} vertices`);
});

test('ray hits the near side of the sphere; a miss or a sphere behind gives null', () => {
  const h = rayoEsfera({ x: 0, y: 0, z: 5 }, { x: 0, y: 0, z: -2 }, 1);
  assert.deepEqual(h, { x: 0, y: 0, z: 1 });
  assert.equal(rayoEsfera({ x: 0, y: 0, z: 5 }, { x: 0, y: 1, z: 0 }, 1), null);
  assert.equal(rayoEsfera({ x: 0, y: 0, z: 5 }, { x: 0, y: 0, z: 1 }, 1), null);
  const t = rayoEsfera({ x: 0, y: 1, z: 5 }, { x: 0, y: 0, z: -1 }, 1);
  cerca(t.y, 1, 1e-12); cerca(t.z, 0, 1e-12);
});

test('angular distance: quarter turn, pole to equator, same point', () => {
  cerca(distanciaAngular(0, 0, 0, 90), 90, 1e-12);
  cerca(distanciaAngular(-90, 0, 0, 77), 90, 1e-12);
  cerca(distanciaAngular(-89.67, 129.78, -89.67, 129.78), 0, 1e-12);
  cerca(distanciaAngular(10, 179.5, 10, -179.5), 1 * Math.cos(10 * Math.PI / 180), 1e-4);
});

test('readout: N/S and E/W written, no hemisphere letter on the equator, the prime meridian or 180°', () => {
  assert.deepEqual(formatoLatLon(18.38, 77.58), { lat: '18.38° N', lon: '77.58° E', texto: '18.38° N, 77.58° E' });
  assert.equal(formatoLatLon(-89.68643, -162.9371).texto, '89.69° S, 162.94° W');
  assert.equal(formatoLatLon(0.001, 0.004).texto, '0.00°, 0.00°');
  assert.equal(formatoLatLon(-0.004, -0.001).texto, '0.00°, 0.00°');
  assert.equal(formatoLatLon(5, 180).lon, '180.00°');
  assert.equal(formatoLatLon(-90, 0).texto, '90.00° S, 0.00°');
});
