import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { estadistica, pendientes, histograma, tiraLuz, parecidoDe, parecidoDeBusqueda, recoger, BORDES_PENDIENTE } from '../informe/recoger.js';
import { evaluarEquipo, medirPunto } from '../terreno/evaluar.js';
import { solTierra, solPolar } from '../terreno/sol.js';

const catalogo = JSON.parse(await readFile(new URL('../data/equipo.json', import.meta.url), 'utf8'));
const indice = JSON.parse(await readFile(new URL('../data/cuerpos/indice.json', import.meta.url), 'utf8'));
const CUERPO = { luna: 'Moon', tierra: 'Earth', marte: 'Mars' };
const equipoDe = (id) => catalogo.equipos.find((q) => q.id === id) ?? null;
const nombreCorto = (id) => equipoDe(id)?.nombre.replace(/\s*\(.*\)\s*$/, '') ?? id;

// Rejilla 5 × 5 con un hueco sin dato (NaN) y, en la Tierra, una celda de agua.
function escena({ cuerpo, polar, m, alturas, agua = null }) {
  const n = 5;
  return {
    n, m, mostradas: Float32Array.from(alturas), delta: new Float32Array(n * n), verOriginal: false, capas: agua ? { agua: Uint8Array.from(agua) } : {},
    meta: { id: `${cuerpo}-t`, cuerpo, nombre: `${cuerpo} <b>terrain</b>`, n, m_por_px: m, lado_km: (n * m) / 1000, centro: { lat: polar ? -89.5 : 75.4, lon: polar ? 130 : -89.8 },
      georef: polar ? { tipo: 'estereo_polar', polo: 'sur', radio_m: 1737400 } : { tipo: 'local_aeqd', radio_m: 6371000 },
      capas: { altura: { fuente: `${cuerpo} DEM`, url: `https://example.org/${cuerpo}`, unidad: 'm' } } },
  };
}
const alturasLuna = [0, 1, 2, 3, 4, 0, 1, 2, 3, 4, 0, NaN, 2, 3, 4, 0, 1, 2, 3, 4, 0, 1, 2, 3, 4].map((v) => v * 10);
const alturasTierra = [5, 5, 5, 5, 5, 5, 6, 7, 6, 5, 5, 7, 9, 7, 5, 5, 6, 7, 6, 5, 5, 5, 5, 5, 5];
const aguaTierra = Array(25).fill(0); aguaTierra[24] = 1;

function panel(lado, esc, lista, conModelo = []) {
  return { lado, escena: esc, plantados: { lista }, modelos: { instancias: () => lista.filter((x) => conModelo.includes(x.equipo)).map((x) => ({ uid: x.uid })) } };
}

function mapaDe(p, bitsPorCelda, elevaciones) {
  return { bits: Uint32Array.from({ length: 25 }, (_, i) => bitsPorCelda(i)), soles: elevaciones.map((el) => ({ el, az: 0 })), total: 24, unidad: 'hours', ahora: null };
}

function dia({ sinLuna = false } = {}) {
  const S = { activo: false, hora: 12, mes: 6, modo: 'propio', decl: 0 };
  return {
    estado: S,
    mapa: (p) => (p.escena.meta.cuerpo === 'luna' ? (sinLuna ? null : mapaDe(p, () => 0, Array(24).fill(1.5))) : mapaDe(p, (i) => (i === 12 ? 0xfff000 : 0), Array.from({ length: 24 }, (_, k) => (k < 4 || k > 20 ? -3 : 20)))),
    solDe: (p, t) => (p.escena.meta.cuerpo === 'luna' ? (sinLuna ? null : { ...solPolar({ az0: 90, el: 1.5, horas: (t / 24) * 708.72 }), tipo: 'polar' }) : { ...solTierra({ lat: 75.4, mes: 6, hora: t }), tipo: 'tierra' }),
  };
}

const evaluar = (p, it) => evaluarEquipo(equipoDe(it.equipo) ?? {}, medirPunto({ n: p.escena.n, m_por_px: p.escena.m, alturas: p.escena.mostradas, capas: p.escena.capas }, it.fila, it.col));
const ctxBase = (paneles, extra = {}) => ({ paneles, catalogo, cuerpos: indice, dia: dia(), asentamiento: null, evaluar, equipoDe, nombreCorto, CUERPO, lugar: null, punto: null, mision: null, mes: null, exag: 1, espejo: true, ejemplo: false, url: 'http://127.0.0.1/terreno/index.html', ...extra });

test('statistics skip NaN cells and never turn them into 0', () => {
  const s = estadistica([NaN, 1, 2, 3, 4, NaN, 100]);
  assert.equal(s.total, 7);
  assert.equal(s.validas, 5);
  assert.equal(s.min, 1);
  assert.equal(s.max, 100);
  assert.equal(s.mediana, 3);
  assert.equal(s.media, 22);
  assert.equal(s.p05, 1);
  assert.equal(s.p95, 100);
  const vacio = estadistica([NaN, NaN]);
  assert.equal(vacio.validas, 0);
  assert.equal(vacio.min, null);
  assert.equal(vacio.media, null);
});

test('slopes: water cells and cells without elevation have no slope; histogram is the share of cells with data', () => {
  const e = escena({ cuerpo: 'tierra', polar: false, m: 10, alturas: alturasTierra, agua: aguaTierra });
  const p = pendientes(e.mostradas, 5, 10, e.capas.agua);
  assert.ok(Number.isNaN(p[24]));
  assert.ok(Number.isFinite(p[0]));
  const h = histograma([1, 3, 3, 50, NaN], BORDES_PENDIENTE);
  assert.equal(h.length, 21);
  assert.equal(h[0], 25);
  assert.equal(h[1], 50);
  assert.equal(h.at(-1), 25);
  assert.ok(histograma([NaN], [0, 2]).every((v) => v === null));
});

test('day strip of a cell: sunlit bit, else terrain shadow if the Sun is up, else night; no map = null', () => {
  const m = { bits: Uint32Array.of(0b101), soles: [{ el: 5 }, { el: 5 }, { el: 5 }, { el: -1 }], total: 4 };
  assert.deepEqual(tiraLuz(m, 0), ['sol', 'sombra', 'sol', 'noche']);
  assert.equal(tiraLuz({ pendiente: true }, 0), null);
  assert.equal(tiraLuz(null, 0), null);
  const sinLuz = { bits: new Uint32Array(1), soles: Array(24).fill({ el: 2 }), total: 24 };
  assert.ok(tiraLuz(sinLuz, 0).every((c) => c === 'sombra'));
});

test('two worlds, a generated base with one piece without a twin, and a piece planted by hand', () => {
  const luna = escena({ cuerpo: 'luna', polar: true, m: 20, alturas: alturasLuna });
  const tierra = escena({ cuerpo: 'tierra', polar: false, m: 10, alturas: alturasTierra, agua: aguaTierra });
  const pl = [
    { uid: 1, equipo: 'habitat_superficie', fila: 2, col: 2, par: 'base:50:habitat_superficie' },
    { uid: 2, equipo: 'ltv', fila: 1, col: 3, par: 'base:50:ltv' },
    { uid: 3, equipo: 'viper', fila: 0, col: 0, par: null },
  ];
  const pt = [
    { uid: 4, equipo: 'habitat_superficie', fila: 2, col: 2, par: 'base:50:habitat_superficie' },
    { uid: 5, equipo: 'ltv', fila: 4, col: 4, par: 'base:50:ltv' },
  ];
  const pa = panel('a', tierra, pt, ['ltv']), pb = panel('b', luna, pl, ['habitat_superficie', 'ltv']);
  const res = { r: { piezas: [{ id: 'habitat_superficie', fila: 2, col: 2, criterios: [{ tipo: 'pendiente', peso: 2, usado: true, valor: 3.2 }, { tipo: 'luz', peso: 1, usado: false, valor: null, motivo: 'no light map' }] }], sin_sitio: [{ id: 'reactor_fision', motivo: 'no free ground left inside this radius' }], candidatos: 20, paso: 1, usaLuz: true, sombraDe: 'luz' },
    excluidos: [{ id: 'reles_comunicaciones', nombre: 'Relays', motivo: 'in orbit, not on the ground' }], radio_m: 50, separacion_min_m: 30, pri: 'b', sec: 'a' };
  const d = recoger(ctxBase([pa, pb], { asentamiento: { estado: { res } } }));
  assert.deepEqual(JSON.parse(JSON.stringify(d)).paneles.length, 2, 'plain data: survives a JSON round trip');
  const [T, L] = d.paneles;
  assert.equal(L.cotas.validas, 24, 'the NaN cell is left out of the elevation statistics');
  assert.equal(L.cotas.min, 0);
  assert.equal(T.celdas_agua, 1);
  assert.equal(T.pendientes.validas, 24, 'the water cell has no slope');
  assert.equal(L.norte_arriba, false);
  assert.equal(T.norte_arriba, true);
  assert.equal(L.sol.length, 25);
  assert.equal(L.tipo_sol, 'polar');
  assert.ok(Math.abs(L.equivale_h - 29.53) < 1e-9);
  assert.equal(L.el_display, 1.5);
  assert.equal(T.equivale_h, 1);
  const hT = T.sol[9], ref = solTierra({ lat: 75.4, mes: 6, hora: 9 });
  assert.equal(hT.el, ref.el);
  const hab = L.piezas.find((x) => x.id === 'habitat_superficie');
  assert.equal(hab.num !== null && hab.de_base, true);
  assert.equal(hab.este_m, 0);
  assert.ok(hab.luz.every((c) => c === 'sombra'), 'a Moon map with no light: every step is terrain shadow, not night');
  assert.equal(hab.horas_luz, 0);
  assert.deepEqual(hab.criterios.map((c) => [c.tipo, c.peso, c.usado]), [['pendiente', 2, true], ['luz', 1, false]]);
  const habT = T.piezas.find((x) => x.id === 'habitat_superficie');
  assert.equal(habT.horas_luz, 12);
  assert.deepEqual(habT.luz.slice(0, 5), ['noche', 'noche', 'noche', 'noche', 'sombra']);
  assert.equal(habT.criterios, null, 'criteria come from the world the base was laid out for');
  const ltvT = T.piezas.find((x) => x.id === 'ltv');
  assert.equal(ltvT.agua, true);
  assert.equal(ltvT.pendiente, null);
  assert.equal(L.piezas.find((x) => x.id === 'ltv').este_m, 20);
  assert.equal(L.piezas.find((x) => x.id === 'ltv').sur_m, -20);
  const viper = L.piezas.find((x) => x.id === 'viper');
  assert.equal(viper.de_base, false);
  assert.equal(viper.modelo3d, false);
  assert.ok(viper.requisitos.length > 0 && viper.requisitos.every((r) => typeof r.veredicto === 'string'));
  const pend = L.piezas.find((x) => x.id === 'ltv').requisitos.find((r) => r.nombre === 'Slope');
  assert.equal(pend.url, 'https://www.nasa.gov/moonbase-systems/');
  assert.match(pend.cita, /20 degrees/);
  assert.equal(d.base.radio_m, 50);
  assert.equal(d.base.separacion_min_m, 30);
  assert.equal(d.base.modo, null, 'priority mode not set by the base panel yet: null, not invented');
  assert.deepEqual(d.base.sin_sitio.map((x) => x.motivo), ['no free ground left inside this radius']);
  assert.equal(d.mundo.clave, 'moon');
  assert.equal(d.mundo.de, 'window centre');
  assert.equal(d.lugar.de, 'window centre');
  assert.ok(d.limites_tierra.some((x) => x.nombre === 'Gravity' && x.mundo === 1.62 && x.tierra === 9.82));
});

test('base restored from a previous visit: radius from the saved pieces, no criteria invented', () => {
  const luna = escena({ cuerpo: 'luna', polar: true, m: 20, alturas: alturasLuna });
  const d = recoger(ctxBase([panel('b', luna, [{ uid: 1, equipo: 'habitat_superficie', fila: 2, col: 2, par: 'base:500:habitat_superficie' }])], { asentamiento: { estado: { res: null } } }));
  assert.equal(d.base.radio_m, 500);
  assert.equal(d.base.restaurada, true);
  assert.equal(d.paneles[0].piezas[0].criterios, null);
});

test('one panel only, nothing planted, Day cannot move its Sun: no base, no Sun, no Earth place', () => {
  const luna = escena({ cuerpo: 'luna', polar: true, m: 20, alturas: alturasLuna });
  const d = recoger({ ...ctxBase([{ lado: 'b', escena: luna, plantados: { lista: [] } }, { lado: 'a', escena: null }]), dia: dia({ sinLuna: true }) });
  assert.equal(d.paneles.length, 1);
  assert.equal(d.base, null);
  assert.equal(d.paneles[0].sol, null);
  assert.equal(d.paneles[0].mapa_luz, false);
  assert.equal(d.lugar, null);
});

test('simulation with the place and the point from the URL', () => {
  const luna = escena({ cuerpo: 'marte', polar: false, m: 20, alturas: alturasLuna });
  const tierra = escena({ cuerpo: 'tierra', polar: false, m: 10, alturas: alturasTierra });
  tierra.meta.dinamico = true;
  const d = recoger(ctxBase([panel('a', tierra, []), panel('b', luna, [])], { lugar: { lat: 75.25, lon: -84.25, nombre: '<img src=x onerror=alert(1)>', lado_km: 10 }, punto: { mundo: 'mars', lat: -4.5, lon: 137.4, lado_km: 10 } }));
  assert.deepEqual([d.mundo.clave, d.mundo.lat, d.mundo.de], ['mars', -4.5, 'point']);
  assert.deepEqual([d.lugar.lat, d.lugar.de], [75.25, 'place']);
  assert.equal(d.lugar.nombre, '<img src=x onerror=alert(1)>', 'raw here; the report escapes it');
  assert.equal(d.simulacion.ventana_km, 10);
});

test('similarity parameter by parameter comes from the engine functions, not a parallel calculation', () => {
  const llamadas = [];
  const motor = {
    indice: { parametros: [{ id: 'a', nombre: 'A', unidad: 'K', reproducible_en_tierra: true, fuentes: { moon: { texto: 'm', url: 'https://m' }, earth: { texto: 'e', url: 'https://e' } } }, { id: 'b', nombre: 'B', unidad: 'm', reproducible_en_tierra: true }, { id: 'g', nombre: 'Gravity', unidad: 'm/s2', reproducible_en_tierra: false }], rejilla: { paso_deg: 0.5 }, metrica: { desviacion_pct: 'f' } },
    leerPunto: (c, lat, lon) => ({ fila: 1, col: 2, valores: c === 'earth' ? { a: 250, b: null, g: 9.82 } : { a: 200, b: 3, g: 1.62 } }),
    desviacion: (id, vt, vo) => { llamadas.push(id); return vt === null || vo === null ? null : id === 'a' ? 25 : 100; },
  };
  const r = parecidoDe(motor, { clave: 'moon', lat: -89, lon: 0 }, { lat: 75, lon: -90 });
  assert.deepEqual(llamadas, ['a', 'b', 'g']);
  assert.deepEqual(r.filas.map((f) => [f.id, f.similitud_pct]), [['a', 75], ['b', null]]);
  assert.equal(r.no_reproducibles[0].nombre, 'Gravity');
  assert.equal(r.celda_deg, 0.5);
});

test('pieces are numbered in the order they were placed, as on the markers; base offsets are from the base centre', () => {
  const luna = escena({ cuerpo: 'luna', polar: true, m: 20, alturas: alturasLuna });
  const lista = [{ uid: 1, equipo: 'ltv', fila: 2, col: 3, par: 'base:50:ltv:p1' }, { uid: 2, equipo: 'habitat_superficie', fila: 2, col: 2, par: 'base:50:habitat_superficie:p2' }];
  const res = { r: { piezas: [] , sin_sitio: [] }, excluidos: [], radio_m: 50, separacion_min_m: 30, modo: 'prioridad', orden: ['ltv', 'habitat_superficie'], pri: 'b', sec: null };
  const d = recoger(ctxBase([panel('b', luna, lista)], { asentamiento: { estado: { res } }, centroDe: () => ({ fila: 2, col: 3, punto: true }) }));
  const P = d.paneles[0];
  assert.deepEqual(P.piezas.map((x) => [x.id, x.num]), [['ltv', 1], ['habitat_superficie', 2]]);
  assert.equal(P.piezas[0].este_m, 0, 'the LTV sits on the base centre');
  assert.equal(P.piezas[1].este_m, -20);
  assert.deepEqual([P.centro_base.punto, P.centro_base.este_m], [true, 20]);
  assert.deepEqual(d.base.orden, ['Lunar Terrain Vehicle', 'Surface habitat']);
  const sinRes = recoger(ctxBase([panel('b', luna, lista)], { asentamiento: { estado: { res: null } } }));
  assert.deepEqual(sinRes.paneles[0].piezas.map((x) => x.num), [1, 2], 'restored: the place saved in the key');
});

test('similarity with a mission or a month: the figures are the ones the search of the results page gives for this place', () => {
  const ind = { rejilla: { paso_deg: 0.5 }, metrica: { desviacion_pct: 'f' },
    parametros: [{ id: 'a', nombre: 'Slope', unidad: 'deg', reproducible_en_tierra: true, fuentes: { moon: { texto: 'LOLA', url: 'https://example.org/a' }, earth: { texto: 'GLO', url: 'https://example.org/b' } } }, { id: 'b', nombre: 'Rain', unidad: 'mm', reproducible_en_tierra: true }, { id: 'g', nombre: 'Gravity', unidad: 'm/s2', reproducible_en_tierra: false }],
    parametros_tierra: [{ id: 't', nombre: 'Aridity', unidad: '', solo_tierra: true, fuentes: { earth: { texto: 'CGIAR', url: 'https://example.org/t' } } }] };
  const pedidas = [];
  const ficha = (lat, lon, sim) => ({ lat, lon, fila: 3, col: 4, similitud_pct: sim, comparados: 2, de: 2, parametros: [
    { id: 'a', valor_tierra: 4, valor_objetivo: 5, desviacion_pct: 20, similitud_pct: 80, estado: 'ok', origen_objetivo: 'punto' },
    { id: 'b', valor_tierra: 0, valor_objetivo: 0, desviacion_pct: null, similitud_pct: null, estado: 'no_usado', origen_objetivo: 'punto' },
    { id: 't', valor_tierra: 0.02, valor_objetivo: 0.03, desviacion_pct: 10, similitud_pct: 90, estado: 'ok', origen_objetivo: 'referencia' }] });
  const motor = { indice: ind,
    leerPunto: (c) => ({ fila: 1, col: 2, valores: c === 'earth' ? { a: 9, b: 1, g: 9.82 } : { a: 5, b: 0, g: 1.62 } }),
    desviacion: () => 50,
    buscar: (objetivo, opc) => { pedidas.push(opc); return { resultados: [ficha(10.25, 20.25, 88), ficha(-18.75, 12.75, 85)], parciales: [ficha(40.25, 0.25, 70)], mensuales: opc.mes ? ['t'] : [] }; } };
  const mundo = { clave: 'moon', lat: -89, lon: 0 }, opciones = { parametros: ['a', 't'], referencia: { lat: -24, lon: -70 } };
  const r = parecidoDeBusqueda(motor, mundo, { lat: -18.7500, lon: 12.7500 }, { opciones, mes: 7, mes_nombre: 'July', mision: { id: 'taladros', titulo: 'Drills', parametros: 2, referencia: 'Atacama' } });
  assert.deepEqual(pedidas, [{ ...opciones, mes: 7 }], 'the options of the results page, with the month');
  assert.deepEqual(r.filas.map((f) => [f.id, f.valor_mundo, f.valor_tierra, f.similitud_pct, f.referencia, f.mensual]), [['a', 5, 4, 80, false, false], ['t', 0.03, 0.02, 90, true, true]]);
  assert.deepEqual(r.filas[1].fuentes.map((f) => f.url), ['https://example.org/t'], 'an Earth-only trait cites its Earth source only');
  assert.deepEqual([r.busqueda.puesto, r.busqueda.lista, r.busqueda.similitud_pct, r.busqueda.mes, r.busqueda.no_usados], [2, 'resultados', 85, 7, ['Rain']]);
  assert.deepEqual(r.celdas.tierra, { fila: 3, col: 4 });
  assert.equal(r.no_reproducibles[0].nombre, 'Gravity');
  const parcial = parecidoDeBusqueda(motor, mundo, { lat: 40.25, lon: 0.25 }, { opciones: {} });
  assert.deepEqual([parcial.busqueda.puesto, parcial.busqueda.lista, parcial.busqueda.mes], [1, 'parciales', null]);
  assert.deepEqual(pedidas.at(-1), {}, 'no month: the options go as they are');
  assert.equal(parecidoDeBusqueda(motor, mundo, { lat: 0, lon: 0 }, { opciones }), null, 'a place that search does not return has no figure to copy');
});
