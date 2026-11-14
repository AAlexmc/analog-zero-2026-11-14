import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { objetivosDe, capasDePar, dimensionesConPeso, colorear, colorRampa, mascaraTierra, estadosLeyenda, RAMPA, COLOR } from '../mapa/capas.js';
import { decodificarPNG } from '../mapa/png.js';

const par = (obj, mis, pesos, extra = {}) => ({
  id: `${obj}_${mis}`, objetivo: obj, mision: mis, nombre_objetivo: obj.toUpperCase(), pesos,
  ficheros: { s: `s_${obj}_${mis}.png`, c: `c_${obj}_${mis}.png`, dim: ['a', 'b', 'c'].map((k) => `dim_${obj}_${mis}_${k}.png`) }, ...extra,
});
const s01 = (id) => ({ id, unidad: '0-1', scale: 0.004, offset: 0 });
const vacio = (id) => ({ id, vacio: true, scale: 0.004, offset: 0 });
const M = {
  pares: [par('shackleton', 'P3', { D3: 0.521, D8: 0.271, D2: 0.146, D1: 0.063 }), par('jezero', 'P2', { D1: 0.5, D6: 0.5 }), par('shackleton', 'P5', { D9: 0.5, D3: 0.5 }, { prerregistrado: false })],
  canales: {
    's_shackleton_P3.png': [s01('S'), s01('S_p5'), s01('S_p95')],
    'dim_shackleton_P3_a.png': [s01('D1'), s01('D2'), s01('D3')],
    'dim_shackleton_P3_b.png': [vacio('D4'), vacio('D5'), vacio('D6')],
    'dim_shackleton_P3_c.png': [s01('D8'), vacio('D9'), vacio('libre')],
    'var_b.png': [{ id: 'ndvi_max', scale: 0.004, offset: 0 }, { id: 'soc', scale: 1, offset: 0 }, { id: 'ph', scale: 0.04, offset: 0 }],
    'var_a.png': [{ id: 'radiacion', scale: 0.04, offset: 0 }, { id: 't_media', scale: 0.4, offset: -60 }, { id: 'aridez', scale: 0.02, offset: 0 }],
    'var_e.png': [{ id: 'permafrost', scale: 0.004, offset: 0 }, { id: 'viento', scale: 0.1, offset: 0 }, { id: 'litologia_glim', scale: 1, offset: 0 }],
  },
};

test('base sites group their missions in manifest order', () => {
  const o = objetivosDe(M);
  assert.deepEqual(o.map((x) => x.id), ['shackleton', 'jezero']);
  assert.deepEqual(o[0].pares.map((p) => p.mision), ['P3', 'P5']);
});

test('layers: S family, then weighted dimensions in D-number order, then raw variables by file', () => {
  const ids = capasDePar(M, M.pares[0]).map((c) => c.id);
  assert.deepEqual(ids.slice(0, 7), ['S', 'S_p5', 'S_p95', 'D1', 'D2', 'D3', 'D8']);
  assert.deepEqual(ids.slice(7), ['radiacion', 't_media', 'aridez', 'ndvi_max', 'soc', 'ph', 'permafrost', 'viento', 'litologia_glim']);
});

test('empty channels (vacio) and dimensions without weight never become layers', () => {
  const ids = capasDePar(M, M.pares[0]).map((c) => c.id);
  assert.ok(!ids.includes('D9') && !ids.includes('D4') && !ids.includes('libre'));
  assert.deepEqual(dimensionesConPeso(M.pares[0]), ['D1', 'D2', 'D3', 'D8']);
});

test('the ramp is monotone in lightness and never red-dominant', () => {
  let prev = -1;
  for (let t = 0; t <= 1.0001; t += 0.05) {
    const [r, g, b] = colorRampa(t);
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    assert.ok(l > prev, `lightness at ${t}`);
    prev = l;
    assert.ok(!(r > g + 40 && r > b + 40), `red at ${t}`);
  }
  assert.deepEqual(colorRampa(0), RAMPA[0][1]);
  assert.deepEqual(colorRampa(1), RAMPA[RAMPA.length - 1][1]);
});

test('no-score colours differ from each other and from every ramp colour', () => {
  const estados = [COLOR.falla, ...COLOR.noEval, COLOR.na].map((c) => c.join());
  assert.equal(new Set(estados).size, estados.length);
  for (let t = 0; t <= 1.0001; t += 0.001) assert.ok(!estados.includes(colorRampa(t).join()), `ramp at ${t}`);
});

// Imagen 4×1 RGB: océano, fallada, no evaluable, evaluable.
const img = (bytes) => ({ ancho: 4, alto: 1, canales: 3, datos: new Uint8Array(bytes) });
const S = img([255, 255, 255, 0, 0, 0, 255, 255, 255, 125, 100, 150]);
const C = img([255, 255, 255, 200, 0b01, 200, 100, 0b10000, 200, 230, 0, 210]);

test('S layer: ocean transparent, failed gate and not evaluable have their own colours', () => {
  const capa = capasDePar(M, M.pares[0])[0];
  const r = colorear(capa, S, S, C);
  assert.equal(r.rgba[3], 0);
  assert.deepEqual([...r.rgba.slice(4, 7)], COLOR.falla);
  assert.ok(COLOR.noEval.some((c) => c.join() === [...r.rgba.slice(8, 11)].join()));
  assert.deepEqual([...r.rgba.slice(12, 15)], colorRampa(0.5));
  assert.deepEqual(r.cuenta, { falla: 1, no_evaluable: 1, na: 0, sin_dato: 0 });
  assert.deepEqual(r.dominio, [0, 1]);
});

test('raw variable layer: domain comes from land pixels only, n/a counted apart', () => {
  const V = img([0, 0, 9, 40, 254, 9, 60, 0, 9, 10, 255, 9]);
  const capa = { id: 't_media', grupo: 'variable', canal: 0, meta: { id: 't_media', scale: 0.5, offset: -10 } };
  const r = colorear(capa, V, S, C);
  assert.deepEqual(r.dominio, [-5, 20]);
  assert.deepEqual([...r.rgba.slice(4, 7)], colorRampa(0.6));
  assert.deepEqual([...r.rgba.slice(8, 11)], colorRampa(1));
  assert.deepEqual([...r.rgba.slice(12, 15)], colorRampa(0));
  const capa2 = { ...capa, canal: 1 };
  assert.deepEqual(colorear(capa2, V, S, C).cuenta, { falla: 0, no_evaluable: 0, na: 1, sin_dato: 1 });
});

test('lithology layer lists the classes present instead of a numeric range', () => {
  const V = img([0, 0, 3, 0, 0, 5, 0, 0, 3, 0, 0, 7]);
  const capa = { id: 'litologia_glim', grupo: 'variable', canal: 2, meta: { id: 'litologia_glim', scale: 1, offset: 0 } };
  assert.deepEqual(colorear(capa, V, S, C).clases, [3, 5, 7]);
});

test('land mask comes from the c_* gates channel', () => {
  assert.deepEqual([...mascaraTierra(C)], [0, 1, 1, 1]);
});

test('legend counts are the cells painted in the loaded layer; the manifest count stays as the validation figure', () => {
  const capa = capasDePar(M, M.pares[0])[0];
  const r = colorear(capa, S, S, C);
  const filas = estadosLeyenda(capa, r.cuenta, { n_fallan_puerta: 0, n_no_evaluables: 7 });
  assert.deepEqual(filas.map((f) => [f.id, f.n, f.nValidacion]), [['falla', 1, 0], ['no_evaluable', 1, 7]]);
  const V = img([0, 0, 9, 40, 254, 9, 60, 0, 9, 10, 255, 9]);
  const capaV = { id: 't_media', grupo: 'variable', canal: 1, meta: { id: 't_media', scale: 0.5, offset: -10 } };
  assert.deepEqual(estadosLeyenda(capaV, colorear(capaV, V, S, C).cuenta, M.pares[0]).map((f) => [f.id, f.n, f.nValidacion]), [['na', 1, undefined], ['sin_dato', 1, undefined]]);
  assert.deepEqual(estadosLeyenda({ ...capaV, canal: 0 }, colorear({ ...capaV, canal: 0 }, V, S, C).cuenta, M.pares[0]), []);
});

// Pillow sobre c_/s_shackleton_P3.png (REV-web hallazgo 4): 26 242 con puerta fallada, 13 005 no evaluables; el manifiesto da 3 731 y 8 169 (sin el sur de −60°).
test('real data: every legend swatch count equals the cells painted with that swatch, for every pair and layer', async (t) => {
  const raiz = new URL('../data/global/', import.meta.url);
  let man;
  try { man = JSON.parse(await readFile(new URL('capas.json', raiz), 'utf8')); } catch { t.skip('no web/data/global/capas.json'); return; }
  const cache = new Map();
  const png = async (f) => { if (!cache.has(f)) cache.set(f, await decodificarPNG(new Uint8Array(await readFile(new URL(f, raiz))))); return cache.get(f); };
  const mismo = (rgba, o, col) => rgba[o] === col[0] && rgba[o + 1] === col[1] && rgba[o + 2] === col[2] && rgba[o + 3] === 255;
  for (const par of man.pares) {
    const [imgS, imgC] = await Promise.all([png(par.ficheros.s), png(par.ficheros.c)]);
    for (const capa of capasDePar(man, par)) {
      const res = colorear(capa, await png(capa.fichero), imgS, imgC);
      const filas = estadosLeyenda(capa, res.cuenta, par);
      const colores = filas.map((f) => (Array.isArray(f.color[0]) ? f.color : [f.color]));
      const pintadas = colores.map(() => 0);
      for (let o = 0; o < res.rgba.length; o += 4) {
        const k = colores.findIndex((cs) => cs.some((c) => mismo(res.rgba, o, c)));
        if (k >= 0) pintadas[k]++;
      }
      // noEval y sinDato comparten muestra: se comparan juntas.
      const porMuestra = new Map();
      filas.forEach((f, k) => { const key = JSON.stringify(colores[k]); const a = porMuestra.get(key) ?? [0, 0]; porMuestra.set(key, [a[0] + f.n, a[1] + pintadas[k]]); });
      for (const [key, [n, vistas]] of porMuestra) assert.equal(n, vistas, `${par.id} ${capa.id} swatch ${key}`);
      if (par.id === 'shackleton_P3' && capa.id === 'S') {
        assert.deepEqual(filas.map((f) => [f.id, f.n, f.nValidacion]), [['falla', 26242, par.n_fallan_puerta], ['no_evaluable', 13005, par.n_no_evaluables]]);
      }
    }
  }
});
