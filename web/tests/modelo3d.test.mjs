import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { factorAmpliacion, factorModelo, modeloDe, rotuloModelo, validarModelos, medidaTexto, RELACIONES } from '../terreno/modelo3d.js';

const DATA = fileURLToPath(new URL('../data/', import.meta.url));
const modelos = JSON.parse(readFileSync(`${DATA}modelos.json`, 'utf8'));
const equipos = JSON.parse(readFileSync(`${DATA}equipo.json`, 'utf8')).equipos;
const ids = new Set(equipos.map((q) => q.id));
const equipo = (id) => equipos.find((q) => q.id === id);

// Caja del modelo en metros a partir del min/max de POSITION y las transformaciones de nodo (glTF exige min/max).
function cajaGlb(ruta) {
  const b = readFileSync(ruta);
  assert.equal(b.toString('latin1', 0, 4), 'glTF');
  const g = JSON.parse(b.toString('utf8', 20, 20 + b.readUInt32LE(12)));
  const mul = (a, c) => Array.from({ length: 16 }, (_, k) => { const i = k % 4, j = Math.floor(k / 4); let s = 0; for (let t = 0; t < 4; t++) s += a[t * 4 + i] * c[j * 4 + t]; return s; });
  const local = (n) => {
    if (n.matrix) return n.matrix;
    const [x, y, z, w] = n.rotation ?? [0, 0, 0, 1], [sx, sy, sz] = n.scale ?? [1, 1, 1], [tx, ty, tz] = n.translation ?? [0, 0, 0];
    return [(1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
      2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
      2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0, tx, ty, tz, 1];
  };
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  const visitar = (i, P) => {
    const n = g.nodes[i], M = mul(P, local(n));
    for (const pr of n.mesh === undefined ? [] : g.meshes[n.mesh].primitives) {
      const { min, max } = g.accessors[pr.attributes.POSITION];
      for (const x of [min[0], max[0]]) for (const y of [min[1], max[1]]) for (const z of [min[2], max[2]]) {
        for (let k = 0; k < 3; k++) {
          const v = M[k] * x + M[4 + k] * y + M[8 + k] * z + M[12 + k];
          lo[k] = Math.min(lo[k], v); hi[k] = Math.max(hi[k], v);
        }
      }
    }
    for (const c of n.children ?? []) visitar(c, M);
  };
  for (const r of g.scenes[g.scene ?? 0].nodes) visitar(r, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  return hi.map((h, k) => h - lo[k]);
}

test('modelos.json: every published model passes the contract against the real equipment catalogue', () => {
  assert.ok(Array.isArray(modelos.modelos) && modelos.modelos.length > 0);
  assert.deepEqual(validarModelos(modelos, ids), []);
});

test('modelos.json: each file exists under web/data, is a .glb and is at most 25 MB', () => {
  for (const m of modelos.modelos) {
    const ruta = `${DATA}${m.fichero}`;
    assert.ok(existsSync(ruta), `${m.id}: missing ${m.fichero}`);
    assert.match(m.fichero, /^modelos\/[a-z0-9_]+\.glb$/);
    assert.ok(statSync(ruta).size <= 25 * 1024 * 1024, `${m.id}: ${statSync(ruta).size} bytes`);
  }
});

test('modelos.json: medida_m is the bounding box of the glTF itself (length × width × height, Y up)', () => {
  for (const m of modelos.modelos) {
    const [x, y, z] = cajaGlb(`${DATA}${m.fichero}`);
    const esperada = [Math.max(x, z), Math.min(x, z), y];
    m.medida_m.forEach((v, k) => assert.ok(Math.abs(v - esperada[k]) <= 0.01, `${m.id}: medida_m ${m.medida_m} vs glb ${esperada.map((e) => e.toFixed(3))}`));
  }
});

test('modelos.json: no model is presented as VIPER, LTV or IPEx themselves, and each system has at most one model', () => {
  for (const m of modelos.modelos) if (['viper', 'ltv', 'ipex'].includes(m.equipo)) assert.notEqual(m.relacion, 'mismo', m.id);
  const vistos = modelos.modelos.map((m) => m.equipo).filter(Boolean);
  assert.equal(new Set(vistos).size, vistos.length);
});

test('contract check rejects unknown relation, unknown equipment, missing size and a relation without equipment', () => {
  const bueno = { id: 'a', fichero: 'modelos/a.glb', nombre_real: 'A rover', fuente_url: null, a_escala_real: true, medida_m: [2, 1, 1], equipo: 'ltv', relacion: 'sustituto' };
  assert.deepEqual(validarModelos({ modelos: [bueno] }, ids), []);
  const errores = (cambio) => validarModelos({ modelos: [{ ...bueno, ...cambio }] }, ids);
  assert.equal(errores({ relacion: 'parecido' }).length, 1);
  assert.equal(errores({ equipo: 'tostadora' }).length, 1);
  assert.equal(errores({ medida_m: [2, null, 1] }).length, 1);
  assert.equal(errores({ equipo: null }).length, 1);
  assert.equal(errores({ a_escala_real: false }).length, 1);
  assert.equal(errores({ fuente_url: 'ftp://x' }).length, 1);
  assert.equal(errores({ fichero: '../../etc/passwd' }).length, 1);
  assert.equal(errores({ equipo: null, relacion: null }).length, 0);
  assert.equal(validarModelos({ modelos: [bueno, { ...bueno }] }, ids).length, 1);
  assert.equal(validarModelos({}, ids).length, 1);
  assert.deepEqual(RELACIONES, ['mismo', 'sustituto']);
});

test('modeloDe finds the model of a system and returns null for a system without one', () => {
  const lista = modelos.modelos;
  assert.equal(modeloDe(lista, 'ipex')?.id, 'rassor');
  assert.equal(modeloDe(lista, 'viper'), null);
  assert.equal(modeloDe(null, 'ipex'), null);
});

test('label of a stand-in names the model and says which system it is not', () => {
  const r = rotuloModelo(modeloDe(modelos.modelos, 'ipex'), equipo('ipex'));
  assert.equal(r.sustituto, '3D model shown: NASA RASSOR excavator — stand-in, not IPEx');
  assert.equal(r.medida, '1.66 × 0.85 × 0.94 m');
  const mismo = rotuloModelo({ ...modeloDe(modelos.modelos, 'ipex'), relacion: 'mismo' }, equipo('ipex'));
  assert.equal(mismo.sustituto, null);
  assert.match(mismo.titulo, /RASSOR/);
});

test('size text keeps two decimals and says when there is no size', () => {
  assert.equal(medidaTexto([5.91, 4.038, 3.969]), '5.91 × 4.04 × 3.97 m');
  assert.equal(medidaTexto(null), 'size not available');
});

test('terrain enlargement factor is a 1-2-5 number, never below 1, growing with camera distance', () => {
  assert.equal(factorAmpliacion(10), 1);
  assert.equal(factorAmpliacion(0), 1);
  assert.equal(factorAmpliacion(NaN), 1);
  let antes = 1;
  for (const d of [100, 500, 1000, 5000, 20000, 58000, 300000, 1e6]) {
    const f = factorAmpliacion(d);
    assert.ok(f >= antes, `${d} m → ×${f}`);
    assert.match(String(f / 10 ** Math.floor(Math.log10(f))), /^(1|2|5)$/);
    antes = f;
  }
  assert.equal(factorAmpliacion(58000), 500);
  assert.equal(factorAmpliacion(300), 2);
});

test('per-model enlargement: items over the cap are enlarged less, never below true scale', () => {
  assert.equal(factorModelo(500, { x: 1.66, y: 0.94, z: 0.85 }), 500);
  assert.equal(factorModelo(500, { x: 3.2, y: 17.6, z: 3.2 }, 4), 500 * 4 / 17.6);
  assert.equal(factorModelo(500, { x: 6.24, y: 20, z: 1.6 }, 4) * 20, 500 * 4);
  assert.equal(factorModelo(2, { x: 1, y: 20, z: 1 }, 4), 1);
  assert.equal(factorModelo(1, { x: 1, y: 20, z: 1 }, 4), 1);
  assert.equal(factorModelo(500, null), 500);
});
