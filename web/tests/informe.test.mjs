import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { construirInforme, TITULO, logoSeguro } from '../informe/informe.js';
import { recoger } from '../informe/recoger.js';
import { evaluarEquipo, medirPunto } from '../terreno/evaluar.js';
import { solTierra, solPolar } from '../terreno/sol.js';
import { contraste } from '../marca/contraste.js';

const catalogo = JSON.parse(await readFile(new URL('../data/equipo.json', import.meta.url), 'utf8'));
const indice = JSON.parse(await readFile(new URL('../data/cuerpos/indice.json', import.meta.url), 'utf8'));
const CUERPO = { luna: 'Moon', tierra: 'Earth', marte: 'Mars' };
const equipoDe = (id) => catalogo.equipos.find((q) => q.id === id) ?? null;
const nombreCorto = (id) => equipoDe(id)?.nombre.replace(/\s*\(.*\)\s*$/, '') ?? id;
const MALO = '<img src=x onerror=alert(1)>';

function escena(cuerpo, polar, m, nombre = `${cuerpo} terrain`) {
  const n = 5, alturas = Float32Array.from({ length: 25 }, (_, i) => (i === 7 ? NaN : (i % 5) * 3 + Math.floor(i / 5)));
  return { n, m, mostradas: alturas, delta: new Float32Array(25), verOriginal: false, capas: {},
    meta: { id: `${cuerpo}-t`, cuerpo, nombre, n, m_por_px: m, lado_km: (n * m) / 1000, centro: { lat: polar ? -89.5 : 75.4, lon: polar ? 130 : -89.8 },
      georef: polar ? { tipo: 'estereo_polar', polo: 'sur', radio_m: 1737400 } : { tipo: 'local_aeqd', radio_m: 6371000 },
      capas: { altura: { fuente: `${cuerpo} DEM`, url: `https://example.org/${cuerpo}/dem`, unidad: 'm' } } } };
}
const dia = (sinMapa = false) => ({
  estado: { activo: false, hora: 12, mes: 6, modo: 'propio', decl: 0 },
  mapa: (p) => (sinMapa ? null : { bits: Uint32Array.from({ length: 25 }, (_, i) => (p.escena.meta.cuerpo === 'tierra' && i === 12 ? 0xfff000 : 0)), soles: Array.from({ length: 24 }, (_, k) => ({ el: p.escena.meta.cuerpo === 'luna' ? 1.5 : k < 4 ? -2 : 15 })), total: 24, unidad: 'hours', ahora: null }),
  solDe: (p, t) => (p.escena.meta.cuerpo === 'luna' ? { ...solPolar({ az0: 90, el: 1.5, horas: (t / 24) * 708.72 }), tipo: 'polar' } : { ...solTierra({ lat: 75.4, mes: 6, hora: t }), tipo: 'tierra' }),
});
const evaluar = (p, it) => evaluarEquipo(equipoDe(it.equipo) ?? {}, medirPunto({ n: p.escena.n, m_por_px: p.escena.m, alturas: p.escena.mostradas, capas: p.escena.capas }, it.fila, it.col));
const panel = (lado, e, lista) => ({ lado, escena: e, plantados: { lista }, modelos: { instancias: () => lista.filter((x) => x.equipo !== 'flip').map((x) => ({ uid: x.uid })) } });
const ctx = (paneles, extra = {}) => ({ paneles, catalogo, cuerpos: indice, dia: dia(), asentamiento: null, evaluar, equipoDe, nombreCorto, CUERPO, lugar: null, punto: null, mision: null, mes: null, exag: 2, espejo: true, ejemplo: false, url: 'http://127.0.0.1:8080/terreno/index.html?a=haughton&b=shackleton', enlaceResultados: 'http://127.0.0.1:8080/analogos/index.html?mundo=moon&lat=-89.5&lon=130', parecido: null, ...extra });

function completo() {
  const pl = [
    { uid: 1, equipo: 'habitat_superficie', fila: 2, col: 2, par: 'base:50:habitat_superficie' },
    { uid: 2, equipo: 'ltv', fila: 1, col: 3, par: 'base:50:ltv' },
    { uid: 3, equipo: 'flip', fila: 3, col: 1, par: 'base:50:flip' },
  ];
  const pt = [{ uid: 4, equipo: 'habitat_superficie', fila: 2, col: 2, par: 'base:50:habitat_superficie' }, { uid: 5, equipo: 'ltv', fila: 1, col: 3, par: 'base:50:ltv' }];
  const res = { r: { piezas: [{ id: 'habitat_superficie', criterios: [{ tipo: 'pendiente', peso: 2, usado: true, valor: 3.21 }, { tipo: 'centro', peso: 2, usado: true, valor: 0 }, { tipo: 'luz', peso: 1, usado: true, valor: 0 }] }], sin_sitio: [], candidatos: 24, paso: 1, usaLuz: true, sombraDe: 'luz' }, excluidos: [], radio_m: 50, separacion_min_m: 30, pri: 'b', sec: 'a' };
  const parecido = { filas: [{ id: 'rugosidad_tan', nombre: 'Terrain roughness', unidad: '1 (tangent)', transformacion: 'log10', valor_mundo: 0.003, valor_tierra: 0.02, similitud_pct: 61.2, fuentes: [{ texto: 'LOLA', url: 'https://pds.example/lola', origen: 'mío' }] }, { id: 't_max_k', nombre: 'Max temperature', unidad: 'K', valor_mundo: 390, valor_tierra: null, similitud_pct: null, fuentes: [] }], no_reproducibles: [], celda_deg: 0.5, formula: 'min(100, |f(a) − f(b)| / range × 100)' };
  return recoger(ctx([panel('a', escena('tierra', false, 10, `Earth ${MALO}`), pt), panel('b', escena('luna', true, 20), pl)], { asentamiento: { estado: { res } }, parecido }));
}

test('a complete, self-contained document: no scripts, no external resources, no styles from elsewhere', () => {
  const h = construirInforme(completo());
  assert.match(h, /^<!doctype html>/);
  assert.match(h, /<\/html>\s*$/);
  assert.doesNotMatch(h, /<script/i);
  assert.doesNotMatch(h, /<link\b/i);
  assert.doesNotMatch(h, /<(img|iframe|object|embed|video|audio|source)\b/i);
  assert.doesNotMatch(h, /<[^>]*\ssrc\s*=/i);
  assert.doesNotMatch(h, /url\(|@import/i);
  assert.doesNotMatch(h, /<[^>]*\son[a-z]+\s*=/i, 'no inline event handlers');
  for (const m of h.matchAll(/\bhref="([^"]*)"/g)) {
    const u = m[1];
    assert.ok(/^#s\d+$/.test(u) || /^https?:\/\//.test(u), `unexpected href ${u}`);
  }
  for (const m of h.matchAll(/<(\w+)[^>]*\bhref="https?:/g)) assert.equal(m[1], 'a', 'only links to sources point outside');
});

test('text is escaped: a place name with markup stays text', () => {
  const h = construirInforme(completo());
  assert.doesNotMatch(h, /<img src=x/);
  assert.match(h, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('no generation date or time anywhere, and the same input gives the same document', () => {
  const d = completo();
  const h = construirInforme(d);
  assert.equal(h, construirInforme(JSON.parse(JSON.stringify(d))), 'deterministic, also after a JSON round trip');
  assert.doesNotMatch(h, /\b(19|20)\d\d-\d\d-\d\d\b/);
  assert.doesNotMatch(h, /\b\d\d:\d\d:\d\d\b/);
  assert.doesNotMatch(h, /\b(generated|created) (on|at)\b/i);
});

test('the ten sections in order, numbered, with charts where they belong', () => {
  const h = construirInforme(completo());
  assert.match(h, new RegExp(TITULO));
  const titulos = [...h.matchAll(/<h2>(\d+)\. ([^<]+)<\/h2>/g)].map((m) => `${m[1]} ${m[2]}`);
  assert.deepEqual(titulos, ['2 Parameters used', '3 Terrain of both worlds', '4 Sun through the day', '5 Light on each piece hour by hour', '6 Base layout', '7 Published limits checked', '8 Similarity parameter by parameter', '9 What this report does not measure', '10 Sources']);
  const sec = (k) => h.split(`<section id="s${k}">`)[1].split('</section>')[0];
  for (const k of [3, 4, 5, 6, 8]) assert.ok((sec(k).match(/<svg/g) ?? []).length >= 1, `section ${k} has a chart`);
  assert.equal((sec(4).match(/<svg/g) ?? []).length, 2, 'Sun: elevation and azimuth');
  assert.equal((sec(6).match(/class="grafico plano"/g) ?? []).length, 2, 'one plan per world');
  assert.match(sec(6), /map grid, north not up/);
  assert.match(sec(6), /class="norte"/, 'the Earth plan has its north arrow');
  assert.match(sec(5), /Temperature hour by hour: NOT MEASURED<\/b> \(not loaded in this viewer\)/);
  assert.match(sec(2), /Vertical exaggeration[\s\S]*2\.0×[\s\S]*visual only/);
  assert.match(sec(2), /minimum separation[\s\S]*own choice/i);
  assert.match(sec(4), /own calculation/i);
  assert.match(sec(4), /gml\.noaa\.gov/);
  assert.match(sec(8), /Terrain roughness[\s\S]*61\.2 %/);
  assert.match(sec(8), /Max temperature[\s\S]*no data/);
});

test('published limits: verdict, value, limit and the source with its quote; summary per world', () => {
  const h = construirInforme(completo());
  const s7 = h.split('<section id="s7">')[1].split('</section>')[0];
  assert.match(s7, /Moon<\/b>: <span class="num">\d+<\/span> of <span class="num">3<\/span> pieces break/);
  assert.match(s7, /href="https:\/\/www\.nasa\.gov\/moonbase-systems\/"/);
  assert.match(s7, /20 degrees/);
  assert.match(s7, /NO LIMIT|NOT MEASURED|OK|BREAKS/);
  const s10 = h.split('<section id="s10">')[1].split('</section>')[0];
  const urls = [...s10.matchAll(/<li><a href="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(urls.length, new Set(urls).size, 'each source once');
  assert.ok(urls.includes('https://www.nasa.gov/moonbase-systems/'));
  assert.ok(urls.includes('https://example.org/luna/dem'));
});

test('without a base the report still comes out, and says what is missing', () => {
  const d = recoger(ctx([panel('a', escena('tierra', false, 10), []), panel('b', escena('luna', true, 20), [])]));
  const h = construirInforme(d);
  assert.match(h, /<section id="s5">[\s\S]*No base generated: press Generate base\./);
  assert.match(h, /<section id="s6">[\s\S]*No base generated: press Generate base\./);
  assert.match(h, /<section id="s8">[\s\S]*similarity parameter by parameter is on the <a href="http:\/\/127\.0\.0\.1:8080\/analogos\//);
});

test('one panel and no light map: the missing parts say why, nothing is drawn as zero', () => {
  const pl = [{ uid: 1, equipo: 'ltv', fila: 2, col: 2, par: null }];
  const d = recoger({ ...ctx([panel('b', escena('luna', true, 20), pl)]), dia: { ...dia(true), solDe: () => null } });
  const h = construirInforme(d);
  assert.match(h, /no hour-by-hour Sun/);
  assert.match(h, /Moon: no light map/);
  assert.match(h, /Place on Earth<\/dt><dd>none in this simulation/);
  assert.doesNotMatch(h, /NaN|undefined|null/);
});

test('colours used for text on the white page pass 4.5:1', () => {
  for (const c of ['deep-blue', 'electric-blue', 'martian-red']) assert.ok(contraste(c, 'white') >= 4.5, c);
  assert.ok(contraste('white', 'deep-blue') >= 4.5);
  assert.ok(contraste('white', 'electric-blue') >= 4.5);
  const h = construirInforme(completo());
  const marca = new Set(['#FFFFFF', '#07173F', '#0042A6', '#2E96F5', '#0960E1', '#E43700', '#8E1100', '#EAFE07']);
  for (const x of h.match(/#[0-9A-Fa-f]{6}\b/g)) assert.ok(marca.has(x.toUpperCase()), `colour ${x} not in the brand palette`);
  assert.doesNotMatch(h.split('<style>')[1].split('</style>')[0], /color:#E43700|color:#2E96F5|color:#EAFE07/, 'rocket red, blue yonder and neon yellow are never text colours on white');
});

test('contest logo: only a plain SVG gets into the report', async () => {
  const { readFile } = await import('node:fs/promises');
  const negro = await readFile(new URL('../marca/space-apps-negro.svg', import.meta.url), 'utf8');
  assert.equal(logoSeguro(negro), negro, 'the official file passes as it is');
  for (const malo of [null, 12, 'text', '<p>x</p>', '<svg><script>alert(1)</script></svg>', '<svg onload="x()"></svg>', '<svg><a href="https://example.org">x</a></svg>', '<svg><image src="x"/></svg>', '<svg><foreignObject></foreignObject></svg>']) assert.equal(logoSeguro(malo), '');
});
