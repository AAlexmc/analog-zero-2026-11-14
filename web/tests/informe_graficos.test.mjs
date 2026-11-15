import test from 'node:test';
import assert from 'node:assert/strict';
import { esc, marcas, graficoLineas, graficoTira, graficoBarras, graficoHistograma, graficoPlano, COLORES } from '../informe/graficos.js';
import { PALETA } from '../marca/contraste.js';

const tramos = (svg) => [...svg.matchAll(/<path class="serie"[^>]* d="([^"]*)"/g)].map((m) => m[1].split('M').filter(Boolean).length);

test('text is escaped, including quotes', () => {
  assert.equal(esc('<img src=x onerror="a()">&\''), '&lt;img src=x onerror=&quot;a()&quot;&gt;&amp;&#39;');
  assert.equal(esc(null), '');
});

test('axis ticks are round numbers covering the range', () => {
  assert.deepEqual(marcas(0, 100, 6), [0, 20, 40, 60, 80, 100]);
  const m = marcas(-3.2, 47.9, 6);
  assert.ok(m[0] <= -3.2 && m.at(-1) >= 47.9);
  assert.ok(m.every((v, i) => i === 0 || Math.abs(v - m[i - 1] - (m[1] - m[0])) < 1e-9));
  assert.deepEqual(marcas(5, 5, 4).length > 1, true, 'a flat series still gets an axis');
});

test('a line with NaN or null values breaks into separate pieces, never drops to 0', () => {
  const svg = graficoLineas({ titulo: 'Sun', series: [{ nombre: 'Earth', puntos: [[0, 1], [1, 2], [2, NaN], [3, 4], [4, 5], [5, null], [6, 7]] }], x: { rotulo: 'Hour (h)', min: 0, max: 6 }, y: { rotulo: 'Elevation (°)' }, pie: 'own calculation' });
  assert.deepEqual(tramos(svg), [3]);
  assert.match(svg, /data-aislados="1"/, 'the lone point at x = 6 is still drawn');
  const y0 = graficoLineas({ titulo: 't', series: [{ nombre: 's', puntos: [[0, 10], [1, NaN], [2, 10]] }], x: { rotulo: 'x (h)', min: 0, max: 2 }, y: { rotulo: 'y (°)', min: 0, max: 20 }, pie: 'p' });
  assert.deepEqual(tramos(y0), [2]);
});

test('every chart has a title, axis labels with units, a legend and a caption saying where the data come from', () => {
  const svg = graficoLineas({ titulo: 'Sun elevation', series: [{ nombre: 'Moon', puntos: [[0, 1], [24, 1]] }, { nombre: 'Earth', puntos: [[0, -5], [24, 5]] }], x: { rotulo: 'Hour of the day (h)', min: 0, max: 24 }, y: { rotulo: 'Elevation (°)' }, pie: 'own calculation from NOAA formulas' });
  assert.match(svg, /<figure/);
  assert.match(svg, /Sun elevation/);
  assert.match(svg, /Hour of the day \(h\)/);
  assert.match(svg, /Elevation \(°\)/);
  assert.match(svg, /class="leyenda"[\s\S]*Moon[\s\S]*Earth/);
  assert.match(svg, /<figcaption>[^<]*own calculation from NOAA formulas/);
});

test('a chart with no finite data says so instead of drawing a flat line', () => {
  const svg = graficoLineas({ titulo: 'Nothing', series: [{ nombre: 'A', puntos: [[0, NaN], [1, null]] }], x: { rotulo: 'x (h)', min: 0, max: 1 }, y: { rotulo: 'y (°)' }, pie: 'p' });
  assert.match(svg, /no data/);
  assert.deepEqual(tramos(svg), []);
});

test('only brand colours are used', () => {
  const marca = new Set(Object.values(PALETA).map((h) => h.toUpperCase()));
  for (const c of Object.values(COLORES)) assert.ok(marca.has(c.toUpperCase()), c);
  const todo = [
    graficoLineas({ titulo: 't', series: [{ nombre: 'a', puntos: [[0, 1], [1, 2]] }, { nombre: 'b', puntos: [[0, 2], [1, 1]] }, { nombre: 'c', puntos: [[0, 3], [1, 3]] }], x: { rotulo: 'x (h)', min: 0, max: 1 }, y: { rotulo: 'y (°)' }, pie: 'p' }),
    graficoTira({ titulo: 't', filas: [{ rotulo: 'r', celdas: ['sol', 'sombra', 'noche', null] }], x: { rotulo: 'Step' }, pie: 'p' }),
    graficoBarras({ titulo: 't', filas: [{ rotulo: 'a', valor: 50 }, { rotulo: 'b', valor: null }], x: { rotulo: 'Match (%)', min: 0, max: 100 }, pie: 'p' }),
    graficoHistograma({ titulo: 't', bordes: [0, 2, 4], series: [{ nombre: 'a', valores: [10, 90] }, { nombre: 'b', valores: [50, 50] }], x: { rotulo: 'Slope (°)' }, y: { rotulo: 'Share of cells (%)' }, pie: 'p' }),
    graficoPlano({ titulo: 't', radio_m: 1000, piezas: [{ num: 1, este_m: 0, sur_m: 0, rompe: true }], norteArriba: true, pie: 'p' }),
  ].join('');
  for (const h of todo.match(/#[0-9A-Fa-f]{6}\b/g)) assert.ok(marca.has(h.toUpperCase()), `colour ${h} is not in the brand palette`);
});

test('day strip: one cell per step per row, missing cells drawn as no data, with a legend', () => {
  const svg = graficoTira({ titulo: 'Light', filas: [{ rotulo: '1 Habitat · Moon', celdas: Array.from({ length: 24 }, (_, k) => (k < 12 ? 'sol' : 'sombra')), extra: '12 of 24' }, { rotulo: '1 Habitat · Earth', celdas: Array(24).fill(null) }], x: { rotulo: 'Step of the day (h)', etiquetas: [0, 6, 12, 18, 24] }, pie: 'terrain shadows' });
  assert.equal((svg.match(/class="c sol"/g) ?? []).length, 12);
  assert.equal((svg.match(/class="c sombra"/g) ?? []).length, 12);
  assert.equal((svg.match(/class="c nd"/g) ?? []).length, 24);
  assert.match(svg, /sunlit[\s\S]*terrain shadow[\s\S]*night[\s\S]*no data/);
  assert.match(svg, /12 of 24/);
});

test('bars: a parameter with no data gets no bar and says so', () => {
  const svg = graficoBarras({ titulo: 'Match', filas: [{ rotulo: 'Roughness', valor: 80 }, { rotulo: 'Max temp', valor: null }], x: { rotulo: 'Match (%)', min: 0, max: 100 }, pie: 'engine' });
  assert.equal((svg.match(/class="barra"/g) ?? []).length, 1);
  assert.match(svg, /Max temp[\s\S]*no data/);
});

test('histogram: same bins for every series, grouped bars, last bin open-ended', () => {
  const svg = graficoHistograma({ titulo: 'Slopes', bordes: [0, 2, 4, Infinity], series: [{ nombre: 'Moon', valores: [10, 20, 70] }, { nombre: 'Earth', valores: [60, 30, NaN] }], x: { rotulo: 'Slope (°)' }, y: { rotulo: 'Share of cells (%)' }, pie: 'DEM' });
  assert.equal((svg.match(/class="barra s0"/g) ?? []).length, 3);
  assert.equal((svg.match(/class="barra s1"/g) ?? []).length, 2, 'NaN bin = no bar');
  assert.match(svg, /≥4/);
});

test('base plan: numbered pieces, radius ring, scale bar; north arrow only when north is up', () => {
  const piezas = [{ num: 1, este_m: 0, sur_m: 0, rompe: false }, { num: 2, este_m: 600, sur_m: -300, rompe: true }];
  const n = graficoPlano({ titulo: 'Base on Earth', radio_m: 1000, piezas, norteArriba: true, pie: 'own rules' });
  assert.match(n, /class="anillo"/);
  assert.match(n, /class="norte"/);
  assert.match(n, /class="escala"/);
  assert.match(n, />500 m</);
  assert.equal((n.match(/class="pieza( rompe)?"/g) ?? []).length, 2);
  assert.match(n, /class="pieza rompe"/);
  const p = graficoPlano({ titulo: 'Base on the Moon', radio_m: 1000, piezas, norteArriba: false, pie: 'own rules' });
  assert.doesNotMatch(p, /class="norte"/);
  assert.match(p, /map grid, north not up/);
  // Este a la derecha, sur hacia abajo: la pieza 2 queda a la derecha y arriba del centro.
  const pos = [...n.matchAll(/<g class="pieza[^"]*" transform="translate\(([\d.]+) ([\d.]+)\)"/g)].map((m) => [+m[1], +m[2]]);
  assert.ok(pos[1][0] > pos[0][0] && pos[1][1] < pos[0][1]);
});

test('labels with markup are escaped inside the SVG', () => {
  const svg = graficoBarras({ titulo: '<script>x</script>', filas: [{ rotulo: '<img src=x onerror=alert(1)>', valor: 10 }], x: { rotulo: 'a (%)', min: 0, max: 100 }, pie: '<b>' });
  assert.doesNotMatch(svg, /<img|<script|<b>/);
});
