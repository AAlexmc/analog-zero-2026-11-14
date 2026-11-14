import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { ESQUEMAS, CONSTRUCTORES_CONCEPTO, ROTULO, SIN_ESCALA, construirEsquematico, construirConcepto, validarConceptos, generadoDe, volumenPublicado } from '../terreno/modelos_generados.js';

const DATA = fileURLToPath(new URL('../data/', import.meta.url));
const conceptos = JSON.parse(readFileSync(`${DATA}conceptos.json`, 'utf8'));
const equipos = JSON.parse(readFileSync(`${DATA}equipo.json`, 'utf8')).equipos;
const MM = 1e-3;

const tam = (o) => new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3());
const cajaDe = (o) => new THREE.Box3().setFromObject(o);
const cerca = (a, b, msg) => assert.ok(Math.abs(a - b) <= MM, `${msg}: ${a} vs ${b}`);
const cifra = (nombre, valor, extra = {}) => ({ nombre, valor, unidad: 'm', fuente: 'https://example.org/doc.pdf', cita: 'quote', verificado: true, ...extra });

// Cada dimensión citada con eje se mide en la caja del modelo (o de su pieza); las de la torre sin eje, a mano.
function comprobarCitadas(eq, r) {
  const s = ESQUEMAS[eq.id];
  for (const c of r.citadas) {
    if (c.k === 'volumen') continue;
    const d = s.dims.find((x) => x.k === c.k);
    if (!d.eje) { assert.ok(eq.id === 'torre_solar' && ['ancho_paneles', 'libre'].includes(c.k), `${eq.id}.${c.k} cited but not measurable`); continue; }
    const t = tam(d.parte ? r.base.getObjectByName(d.parte) : r.base);
    for (const e of d.eje) cerca(t[e], c.valor, `${eq.id} ${c.k} on ${e}`);
  }
  if (eq.id === 'torre_solar') {
    const a = cajaDe(r.base.getObjectByName('panel_a')), b = cajaDe(r.base.getObjectByName('panel_b')), suelo = cajaDe(r.base).min.y;
    cerca(a.max.x - a.min.x + b.max.x - b.min.x, r.dims.ancho_paneles, 'tower array width (both wings)');
    cerca(a.min.y - suelo, r.dims.libre, 'tower clearance under arrays');
  }
}

// Lo citado sale de cifras presentes con ese valor; lo no citado está en la lista ilustrativa; nada en las dos.
function comprobarCoherencia(eq, r) {
  const s = ESQUEMAS[eq.id];
  for (const c of r.citadas) {
    const [, nombre, i] = c.nombre.match(/^(.*?)(?:\[(\d)\])?$/);
    const q = eq.cifras.find((x) => x.nombre === nombre);
    assert.ok(q, `${eq.id}: cited ${c.nombre} is not in the catalogue`);
    assert.equal(i === undefined ? q.valor : q.valor[+i], c.valor);
    assert.notEqual(q.origen, 'mío');
    assert.match(q.fuente, /^https?:\/\//);
  }
  const citadas = new Set(r.citadas.map((c) => c.k)), ilus = new Set(r.ilustrativas.map((x) => x.k));
  for (const d of s.dims) assert.ok(citadas.has(d.k) !== ilus.has(d.k), `${eq.id}.${d.k} must be either cited or illustrative`);
  for (const c of r.citadas) assert.ok(r.linea.includes(`${c.etiqueta} ${c.valor} ${c.unidad === 'm3' ? 'm³' : 'm'} (cited`), `${eq.id}: label lacks ${c.etiqueta}: ${r.linea}`);
  if (r.ilustrativas.length) assert.match(r.linea, /illustrative/);
}

test('conceptos.json: contract holds, five own designs, every parameter marked as assumed', () => {
  assert.deepEqual(validarConceptos(conceptos), []);
  assert.deepEqual(conceptos.conceptos.map((c) => c.id).sort(), ['celda_verde', 'deposito_propelente', 'nivelador', 'planta_agua_concepto', 'tramo_carretera']);
  for (const c of conceptos.conceptos) {
    assert.equal(c.origen, 'mío');
    for (const p of c.parametros) assert.equal(p.supuesto, true, `${c.id}.${p.nombre}`);
  }
  assert.equal(conceptos.conceptos.find((c) => c.id === 'celda_verde').equipo, 'celda_verde');
  assert.ok(equipos.some((q) => q.id === 'celda_verde'));
});

test('conceptos contract rejects a published-looking entry, a missing parameter and an unknown id', () => {
  const base = structuredClone(conceptos);
  const con = (f) => { const o = structuredClone(base); f(o.conceptos[0]); return validarConceptos(o); };
  assert.equal(con((c) => { c.origen = 'NASA'; }).length, 1);
  assert.equal(con((c) => { c.parametros[0].supuesto = false; }).length, 1);
  assert.equal(con((c) => { c.parametros = c.parametros.slice(1); }).length, 1);
  assert.equal(con((c) => { c.parametros[0].valor = 0; }).length, 1);
  assert.equal(con((c) => { c.id = 'tostadora'; }).length, 1);
  assert.equal(validarConceptos({}).length, 1);
});

test('each concept is drawn at exactly its assumed dimensions and carries the concept label', () => {
  const p = (id) => Object.fromEntries(conceptos.conceptos.find((c) => c.id === id).parametros.map((x) => [x.nombre, x.valor]));
  const esperado = {
    nivelador: (q) => [q.largo_m, q.ancho_m, q.alto_m],
    planta_agua_concepto: (q) => [q.largo_m, q.ancho_m, q.alto_m],
    deposito_propelente: (q) => [q.largo_m, q.diametro_m, q.alto_apoyos_m + q.diametro_m],
    tramo_carretera: (q) => [q.largo_m, q.ancho_m + 2 * q.ancho_berma_m, Math.max(q.espesor_m, q.alto_berma_m)],
    celda_verde: (q) => [q.ancho_entre_caras_m, (2 * q.ancho_entre_caras_m) / Math.sqrt(3), q.alto_base_m + q.alto_cupula_m],
  };
  assert.deepEqual(Object.keys(esperado).sort(), Object.keys(CONSTRUCTORES_CONCEPTO).sort());
  for (const [id, f] of Object.entries(esperado)) {
    const r = construirConcepto(id, {}, conceptos);
    const t = tam(r.base), e = f(p(id));
    [t.x, t.z, t.y].forEach((v, k) => cerca(v, e[k], `${id} axis ${'xzy'[k]}`));
    r.medida.forEach((v, k) => cerca(v, e[k], `${id} medida`));
    assert.equal(r.titulo, ROTULO.concepto);
    assert.equal(r.titulo, 'Analog Zero concept · own design, assumed dimensions');
    assert.match(r.linea, /\(assumed\)$/);
    for (const x of conceptos.conceptos.find((c) => c.id === id).parametros) assert.ok(r.linea.includes(`${x.etiqueta} ${x.valor} m`), `${id}: ${r.linea}`);
  }
});

test('road segment is parametric in width and length; bad parameters are refused, never drawn', () => {
  const r = construirConcepto('tramo_carretera', { ancho_m: 8, largo_m: 50 }, conceptos);
  const bw = conceptos.conceptos.find((c) => c.id === 'tramo_carretera').parametros.find((x) => x.nombre === 'ancho_berma_m').valor;
  const t = tam(r.base);
  cerca(t.x, 50, 'road length');
  cerca(t.z, 8 + 2 * bw, 'road width with berms');
  cerca(tam(r.base.getObjectByName('losa')).z, 8, 'slab width');
  assert.match(r.linea, /carriageway width 8 m/);
  assert.throws(() => construirConcepto('tramo_carretera', { ancho_m: -1 }, conceptos), /positive/);
  assert.throws(() => construirConcepto('tramo_carretera', { ancho_m: NaN }, conceptos), /positive/);
  assert.throws(() => construirConcepto('tramo_carretera', { radio_m: 3 }, conceptos), /unknown parameter/);
  assert.throws(() => construirConcepto('deposito_propelente', { largo_m: 2, diametro_m: 3 }, conceptos), /largo_m/);
  assert.throws(() => construirConcepto('nivelador', {}, null), /not loaded/);
});

test('every schematic with all its dimensions cited matches them to 1 mm', () => {
  const todas = {
    torre_solar: [cifra('longitud_mastil_max_m', 20), cifra('ancho_paneles_m', 6), cifra('alto_paneles_m', 6), cifra('altura_libre_bajo_paneles_m', 10)],
    habitat_superficie: [cifra('diametro_m', 6.5), cifra('alto_inflable_m', 5.2), cifra('diametro_metalico_m', 4.4), cifra('alto_metalico_m', 2.6)],
    reactor_fision: [cifra('alto_m', 17.6), cifra('ancho_m', 3.2)],
    pista_aterrizaje: [cifra('diametro_m', 30), cifra('alto_m', 0.3)],
  };
  for (const id of Object.keys(ESQUEMAS)) {
    const cifras = todas[id] ?? [cifra('largo_m', 4.1), cifra('ancho_m', 2.3), cifra('alto_m', 2.6)];
    const eq = { id, cifras };
    const r = construirEsquematico(eq, conceptos);
    assert.equal(r.aEscala, true, id);
    assert.equal(r.citadas.length, ESQUEMAS[id].dims.filter((d) => d.nombres.length).length, id);
    comprobarCitadas(eq, r);
    comprobarCoherencia(eq, r);
    assert.equal(r.titulo, 'schematic · built from published dimensions');
  }
});

test('one cited dimension is exact and the rest are listed as illustrative', () => {
  for (const id of ['viper', 'ltv', 'ipex', 'flip', 'rover_prospeccion_rtg', 'reles_comunicaciones']) {
    const eq = { id, cifras: [cifra('alto_m', 2.2)] };
    const r = construirEsquematico(eq);
    cerca(tam(r.base).y, 2.2, `${id} height`);
    assert.deepEqual(r.ilustrativas.map((x) => x.k), ['largo', 'ancho']);
    assert.match(r.linea, /^height 2\.2 m \(cited\) · length [\d.]+ m, width [\d.]+ m, .* illustrative$/);
    comprobarCoherencia(eq, r);
  }
});

test('a dimensiones [length, width, height] figure counts as cited when there are no single figures', () => {
  const eq = { id: 'ltv', cifras: [cifra('clv1_dimensiones_desplegado_m', [4, 2.3, 2.6])] };
  const r = construirEsquematico(eq);
  const t = tam(r.base);
  cerca(t.x, 4, 'length'); cerca(t.z, 2.3, 'width'); cerca(t.y, 2.6, 'height');
  assert.deepEqual(r.ilustrativas, []);
  comprobarCoherencia(eq, r);
});

test('without a cited size there is no model: own values, missing source, null, zero and other units do not count', () => {
  const malas = [
    [],
    [{ nombre: 'masa_kg', valor: 30, unidad: 'kg', fuente: 'https://x.org' }],
    [cifra('largo_m', 3, { origen: 'mío' })],
    [cifra('largo_m', 3, { fuente: undefined })],
    [cifra('largo_m', null)],
    [cifra('largo_m', 0)],
    [cifra('largo_m', 300, { unidad: 'cm' })],
    [cifra('largo_m', '3')],
  ];
  for (const id of Object.keys(ESQUEMAS)) {
    for (const cifras of malas) {
      const r = construirEsquematico({ id, cifras });
      assert.equal(r.aEscala, false, `${id} ${JSON.stringify(cifras)}`);
      assert.equal(r.base, null);
      assert.equal(r.medida, null);
      assert.equal(r.linea, SIN_ESCALA);
      assert.equal(r.linea, 'size not published — not drawn to scale');
    }
  }
  const nuevo = construirEsquematico({ id: 'tostadora', cifras: [cifra('largo_m', 1)] });
  assert.equal(nuevo.base, null);
  assert.match(nuevo.linea, /no schematic/);
});

test('a quote not yet verified is still cited but the label says so', () => {
  const r = construirEsquematico({ id: 'viper', cifras: [cifra('largo_m', 1.5, { verificado: false })] });
  assert.match(r.linea, /length 1\.5 m \(cited, quote not verified\)/);
});

test('habitat with only the cited module volume: drawn volume equals it and the label says the shape is illustrative', () => {
  const eq = { id: 'habitat_superficie', cifras: [{ ...cifra('volumen_modulo_m3', 100), unidad: 'm3' }] };
  const r = construirEsquematico(eq);
  const d = r.dims;
  const vol = (Math.PI / 4) * (d.diametro ** 2 * d.alto_inflable + d.diametro_metalico ** 2 * d.alto_metalico);
  assert.ok(Math.abs(vol - 100) < 1e-9, `${vol}`);
  const inf = tam(r.base.getObjectByName('inflable')), met = tam(r.base.getObjectByName('cubierta_metalica'));
  const volDibujo = (Math.PI / 4) * (inf.x ** 2 * inf.y + met.x ** 2 * met.y);
  assert.ok(Math.abs(volDibujo - 100) < 0.05, `drawn ${volDibujo}`);
  assert.match(r.linea, /^module volume 100 m³ \(cited\) · .* illustrative \(sized to the cited volume\)$/);
  assert.equal(r.ilustrativas.length, 4);
});

test('real catalogue (web/data/equipo.json): drawn to scale only from cited figures, coherent labels', () => {
  for (const eq of equipos) {
    const r = construirEsquematico(eq, conceptos);
    if (eq.origen === 'mío') { assert.equal(r.clase, 'concepto', eq.id); continue; }
    if (!ESQUEMAS[eq.id]) { assert.equal(r.base, null, eq.id); continue; }
    const hay = ESQUEMAS[eq.id].dims.some((d) => (eq.cifras ?? []).some((c) => d.nombres.includes(c.nombre) && Number.isFinite(c.valor) && c.valor > 0 && c.fuente && c.origen !== 'mío'))
      || (eq.cifras ?? []).some((c) => /dimensiones/.test(c.nombre) && Array.isArray(c.valor) && c.fuente)
      || (!!ESQUEMAS[eq.id].volumen && (eq.cifras ?? []).some((c) => ESQUEMAS[eq.id].volumen.nombres.includes(c.nombre) && c.valor > 0 && c.fuente));
    assert.equal(r.aEscala, hay, `${eq.id}: drawn to scale = ${r.aEscala}, cited size present = ${hay}`);
    if (!r.aEscala) { assert.equal(r.base, null); assert.equal(r.linea, SIN_ESCALA); continue; }
    comprobarCitadas(eq, r);
    comprobarCoherencia(eq, r);
  }
  const torre = construirEsquematico(equipos.find((q) => q.id === 'torre_solar'));
  assert.match(torre.linea, /^mast 20 m \(cited\)/);
  assert.equal(construirEsquematico(equipos.find((q) => q.id === 'flip')).aEscala, false);
});

test('green cell: the concept dome follows the across-flats width of the catalogue', () => {
  const eq = structuredClone(equipos.find((q) => q.id === 'celda_verde'));
  const ancho = eq.cifras.find((c) => c.nombre === 'ancho_entre_caras_m').valor;
  const r = construirEsquematico(eq, conceptos);
  assert.equal(r.clase, 'concepto');
  assert.equal(r.titulo, ROTULO.concepto);
  cerca(tam(r.base).x, ancho, 'across flats');
  eq.cifras.find((c) => c.nombre === 'ancho_entre_caras_m').valor = 4.2;
  cerca(tam(construirEsquematico(eq, conceptos).base).x, 4.2, 'across flats after change');
  assert.equal(construirEsquematico(eq, null).base, null);
});

test('cache returns the same model until the figures change', () => {
  const eq = { id: 'viper', cifras: [cifra('largo_m', 1.5)] };
  const a = generadoDe(eq), b = generadoDe({ ...eq });
  assert.equal(a, b);
  const c = generadoDe({ id: 'viper', cifras: [cifra('largo_m', 1.6)] });
  assert.notEqual(c.clave, a.clave);
  cerca(tam(c.base).x, 1.6, 'rebuilt length');
});

test('in-progress catalogue source (datos_json/equipo.json), if it parses: same rules hold', (t) => {
  let fuente;
  try { fuente = JSON.parse(readFileSync(fileURLToPath(new URL('../../datos_json/equipo.json', import.meta.url)), 'utf8')).equipos; } catch { t.skip('datos_json/equipo.json not readable'); return; }
  for (const eq of fuente) {
    if (eq.origen === 'mío' || !ESQUEMAS[eq.id]) continue;
    const r = construirEsquematico(eq);
    if (!r.aEscala) continue;
    comprobarCitadas(eq, r);
    comprobarCoherencia(eq, r);
  }
});

test('mission volumes: the box and the dome measure exactly the published sizes, standing on y = 0', () => {
  const caja = volumenPublicado({ forma: 'caja', largo_m: 2.9, ancho_m: 1.9, alto_m: 2 });
  caja.medida.forEach((v, i) => assert.ok(Math.abs(v - [2.9, 1.9, 2][i]) < 1e-6, `box ${caja.medida}`));
  const b = new THREE.Box3().setFromObject(caja.base);
  assert.ok(Math.abs(b.min.y) < 1e-9);
  const D = 36 * 0.3048;
  for (const h of [D / 2, 3, 8]) {
    const d = volumenPublicado({ forma: 'domo', diametro_m: D, alto_m: h });
    assert.ok(Math.abs(d.tam.x - D) < 1e-6 && Math.abs(d.tam.z - D) < 1e-6 && Math.abs(d.tam.y - h) < 1e-6, `dome ${h}: ${d.tam.toArray()}`);
    assert.equal(d.base.children[0].children[0].name, 'domo');
  }
});
