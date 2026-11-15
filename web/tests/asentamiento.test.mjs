import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RADIOS_M, RADIO_DEFECTO_M, HOLGURA_M, EN_ORBITA, REGLAS, REGLA_DEFECTO, huellaDe, piezasDe, generarAsentamiento, piezasPorPrioridad, PESO_ANCLA } from '../terreno/asentamiento.js';
import { pendienteGrados } from '../terreno/calculo.js';

const CATALOGO = JSON.parse(readFileSync(new URL('../../datos_json/equipo.json', import.meta.url), 'utf8'));
const { piezas: PIEZAS } = piezasDe(CATALOGO);
const DE = Object.fromEntries(PIEZAS.map((p) => [p.id, p]));
const CON_LIMITE = PIEZAS.filter((p) => p.limite).map((p) => p.id);

const plano = (n, v = 0) => new Float32Array(n * n).fill(v);
const llano = (n, m) => ({ n, m, alturas: plano(n) });
const de = (r, id) => r.piezas.find((p) => p.id === id);
const metros = (a, b, m) => Math.hypot(a.fila - b.fila, a.col - b.col) * m;

function holgurasRespetadas(r, m) {
  for (let a = 0; a < r.piezas.length; a++) for (let b = a + 1; b < r.piezas.length; b++) {
    const pa = r.piezas[a], pb = r.piezas[b];
    const min = ((DE[pa.id].huella_m ?? 0) + (DE[pb.id].huella_m ?? 0)) / 2 + HOLGURA_M;
    assert.ok(metros(pa, pb, m) >= min - 1e-9, `${pa.id} and ${pb.id} are ${metros(pa, pb, m)} m apart, need ${min}`);
    assert.ok(pa.fila !== pb.fila || pa.col !== pb.col, `${pa.id} and ${pb.id} share a cell`);
  }
}

test('the constants are the published contract', () => {
  assert.deepEqual(RADIOS_M, [250, 500, 1000, 2000]);
  assert.equal(RADIO_DEFECTO_M, 1000);
  assert.equal(HOLGURA_M, 10);
  assert.deepEqual(EN_ORBITA, ['reles_comunicaciones']);
  assert.equal(REGLA_DEFECTO.orden, 99);
  for (const r of Object.values(REGLAS)) for (const c of r.criterios) {
    assert.ok(['pendiente', 'centro', 'luz', 'sombra', 'cerca', 'lejos'].includes(c.tipo));
    if (c.tipo === 'cerca' || c.tipo === 'lejos') assert.ok(REGLAS[c.con], `${c.con} has a rule`);
  }
});

test('pieces from the real catalogue: relay left out, rule order, published limits and separations', () => {
  const { piezas, excluidos } = piezasDe(CATALOGO);
  assert.deepEqual(excluidos, [{ id: 'reles_comunicaciones', nombre: 'Lunar relay constellation', motivo: 'in orbit, not on the ground' }]);
  assert.deepEqual(piezas.map((p) => p.id), Object.keys(REGLAS).sort((a, b) => REGLAS[a].orden - REGLAS[b].orden));
  const reactor = DE.reactor_fision;
  assert.equal(reactor.separaciones.length, 1);
  assert.equal(reactor.separaciones[0].con, 'habitat_superficie');
  assert.equal(reactor.separaciones[0].min_m, 1000);
  const reqReal = CATALOGO.equipos.find((e) => e.id === 'reactor_fision').requisitos.find((q) => q.variable === 'separacion_m');
  assert.equal(reactor.separaciones[0].req, reqReal);
  assert.match(reactor.separaciones[0].req.fuente, /^https:\/\//);
  assert.match(reactor.separaciones[0].req.cita, /one km distance/);
  assert.equal(reactor.limite, null);
  assert.deepEqual([DE.pista_aterrizaje.limite.valor, DE.pista_aterrizaje.limite.op], [5, '<=']);
  assert.equal(DE.pista_aterrizaje.limite.req.variable, 'pendiente_deg');
  assert.deepEqual(DE.pista_aterrizaje.separaciones, []);
  assert.equal(DE.ltv.limite.valor, 20);
  assert.equal(DE.ipex.texto, REGLAS.ipex.texto);
  assert.deepEqual(DE.planta_agua.criterios, REGLAS.planta_agua.criterios);
});

test('footprint from cited figures of the real catalogue, null where there is none', () => {
  const huella = (id) => huellaDe(CATALOGO.equipos.find((e) => e.id === id));
  assert.deepEqual(huella('habitat_superficie'), { diametro_m: 6.5, de: 'diametro_m' });
  assert.equal(huella('ltv').diametro_m, Math.hypot(4, 2.3));
  assert.equal(huella('celda_verde').diametro_m, (3.6 * 2) / Math.sqrt(3));
  assert.equal(huella('celda_verde').de, 'ancho_entre_caras_m');
  assert.equal(huella('viper').diametro_m, Math.hypot(1.5, 1.5));
  assert.deepEqual(huella('torre_solar'), { diametro_m: 6, de: 'ancho_paneles_m' });
  assert.deepEqual(huella('pista_aterrizaje'), { diametro_m: 19.9, de: 'distancia_entre_zonas_m' });
  assert.deepEqual(huella('reactor_fision'), { diametro_m: 3.2, de: 'ancho_m' });
  assert.deepEqual(huella('taladro_trident'), { diametro_m: 1, de: 'largo_m' });
  for (const id of ['ipex', 'flip', 'rover_prospeccion_rtg', 'planta_agua']) assert.deepEqual(huella(id), { diametro_m: null, de: '' }, id);
  assert.equal(DE.ipex.huella_m, null);
  assert.equal(DE.habitat_superficie.huella_m, 6.5);
});

test('footprint ignores own or uncited figures on cited equipment and reads a dimensions array', () => {
  const c = (nombre, valor, extra = {}) => ({ nombre, valor, unidad: 'm', fuente: 'https://x.org/a.pdf', cita: 'c', verificado: true, ...extra });
  assert.deepEqual(huellaDe({ cifras: [c('diametro_m', 9, { origen: 'mío' }), c('ancho_m', 2)] }), { diametro_m: 2, de: 'ancho_m' });
  assert.deepEqual(huellaDe({ cifras: [c('diametro_m', 9, { fuente: '' }), c('largo_m', 5)] }), { diametro_m: 5, de: 'largo_m' });
  assert.deepEqual(huellaDe({ cifras: [c('diametro_m', null), c('diametro_m', 0), c('ancho_m', 3, { unidad: 'cm' })] }), { diametro_m: null, de: '' });
  assert.equal(huellaDe({ cifras: [c('x_dimensiones_m', [3, 4, 9])] }).diametro_m, 5);
  assert.equal(huellaDe({ origen: 'mío', cifras: [{ nombre: 'diametro_m', valor: 7, unidad: 'm', origen: 'mío' }] }).diametro_m, 7);
  assert.deepEqual(huellaDe({}), { diametro_m: null, de: '' });
});

test('equipment missing from the rules gets the default rule and is placed last', () => {
  const cat = { equipos: [...CATALOGO.equipos, { id: 'zz_nuevo', nombre: 'New thing', clase: 'x', requisitos: [], cifras: [] }] };
  const { piezas } = piezasDe(cat);
  const nuevo = piezas.at(-1);
  assert.equal(nuevo.id, 'zz_nuevo');
  assert.equal(nuevo.orden, 99);
  assert.equal(nuevo.texto, REGLA_DEFECTO.texto);
});

test('flat ground: every piece inside the radius, own cells, gaps kept, habitat on the point, same result twice', () => {
  const n = 121, m = 10, t = llano(n, m);
  const r = generarAsentamiento(t, PIEZAS, { radio_m: 500 });
  assert.deepEqual(r.centro, { fila: 60, col: 60 });
  assert.equal(r.radio_m, 500);
  assert.equal(r.paso, 1);
  assert.equal(r.usaLuz, false);
  assert.equal(r.sombraDe, null);
  assert.deepEqual(r.sin_sitio, []);
  assert.deepEqual(r.piezas.map((p) => p.id), PIEZAS.map((p) => p.id));
  for (const p of r.piezas) {
    assert.ok(Number.isInteger(p.fila) && Number.isInteger(p.col));
    assert.ok(p.dist_centro_m <= 500 + 1e-9, `${p.id} at ${p.dist_centro_m} m`);
    assert.equal(p.dist_centro_m, Math.hypot(p.fila - 60, p.col - 60) * m);
    assert.equal(p.pendiente_deg, 0);
    assert.equal(p.luz, null);
    assert.ok(p.coste >= 0 && p.coste <= 1);
  }
  holgurasRespetadas(r, m);
  assert.deepEqual([de(r, 'habitat_superficie').fila, de(r, 'habitat_superficie').col], [60, 60]);
  assert.deepEqual(generarAsentamiento(t, PIEZAS, { radio_m: 500 }), r);
});

test('criteria report raw value, normalised cost and whether they were used', () => {
  const n = 121, m = 10;
  const r = generarAsentamiento(llano(n, m), PIEZAS, { radio_m: 500 });
  const hab = de(r, 'habitat_superficie');
  const luz = hab.criterios.find((c) => c.tipo === 'luz');
  assert.deepEqual(luz, { tipo: 'luz', con: null, peso: 1, valor: null, coste: null, usado: false, motivo: 'no light map' });
  const trident = de(r, 'taladro_trident');
  const sombra = trident.criterios.find((c) => c.tipo === 'sombra');
  assert.equal(sombra.usado, false);
  assert.equal(sombra.motivo, 'no shadow data');
  const torre = de(r, 'torre_solar');
  const cerca = torre.criterios.find((c) => c.tipo === 'cerca');
  assert.equal(cerca.con, 'habitat_superficie');
  assert.equal(cerca.usado, true);
  assert.ok(Math.abs(cerca.valor - metros(torre, hab, m)) < 1e-9);
  assert.ok(Math.abs(cerca.coste - metros(torre, hab, m) / 1000) < 1e-12);
  const usados = torre.criterios.filter((c) => c.usado);
  const esperado = usados.reduce((s, c) => s + c.peso * c.coste, 0) / usados.reduce((s, c) => s + c.peso, 0);
  assert.ok(Math.abs(torre.coste - esperado) < 1e-12);
});

test('a piece whose only criteria cannot be used falls back to distance from the point', () => {
  const pieza = { id: 'solo', nombre: 'Solo', clase: 'x', huella_m: null, huella_de: '', limite: null, separaciones: [], criterios: [{ tipo: 'luz', peso: 1 }, { tipo: 'cerca', con: 'nadie', peso: 1 }], texto: 't', orden: 1 };
  const r = generarAsentamiento(llano(21, 10), [pieza], { radio_m: 50 });
  const p = r.piezas[0];
  assert.deepEqual([p.fila, p.col], [10, 10]);
  assert.equal(p.criterios.find((c) => c.tipo === 'cerca').motivo, 'nadie not placed');
  const centro = p.criterios.find((c) => c.tipo === 'centro');
  assert.equal(centro.usado, true);
  assert.equal(p.coste, 0);
});

test('radius 250 m: the reactor cannot keep its 1000 m standoff, says so and goes as far from the habitat as the disc allows', () => {
  const n = 61, m = 10;
  const r = generarAsentamiento(llano(n, m), PIEZAS, { radio_m: 250 });
  const hab = de(r, 'habitat_superficie'), reac = de(r, 'reactor_fision');
  assert.ok(reac.incumple.includes('separacion:habitat_superficie'));
  const maximo = 250 + hab.dist_centro_m;
  assert.ok(Math.abs(metros(reac, hab, m) - maximo) <= 2 * m, `${metros(reac, hab, m)} vs ${maximo}`);
  assert.deepEqual(hab.incumple, []);
});

test('radius 2000 m: the reactor keeps its 1000 m standoff and stays close to it, not at the edge', () => {
  const n = 401, m = 10;
  const r = generarAsentamiento(llano(n, m), PIEZAS, { radio_m: 2000 });
  const hab = de(r, 'habitat_superficie'), reac = de(r, 'reactor_fision');
  const d = metros(reac, hab, m);
  assert.equal(reac.incumple.length, 0);
  assert.ok(d >= 1000 && d <= 1000 + 2 * m * r.paso, `${d} m`);
  assert.ok(reac.dist_centro_m < 1500);
  holgurasRespetadas(r, m);
});

test('the published standoff is also kept when the reference is placed after the piece that has it', () => {
  const n = 401, m = 10, hab = { ...DE.habitat_superficie, orden: 2 }, reac = { ...DE.reactor_fision, orden: 1 };
  const r = generarAsentamiento(llano(n, m), [hab, reac], { radio_m: 2000 });
  assert.ok(metros(de(r, 'reactor_fision'), de(r, 'habitat_superficie'), m) >= 1000);
  assert.deepEqual(de(r, 'reactor_fision').incumple, []);
});

test('half of the disc at 30°: nothing with a slope limit lands on the steep half', () => {
  const n = 121, m = 10, k = 60, t = llano(n, m), tan30 = Math.tan(Math.PI / 6);
  for (let f = 0; f < n; f++) for (let c = k + 1; c < n; c++) t.alturas[f * n + c] = (c - k) * m * tan30;
  const r = generarAsentamiento(t, PIEZAS, { radio_m: 500 });
  assert.deepEqual(r.sin_sitio, []);
  for (const id of CON_LIMITE) {
    const p = de(r, id);
    assert.ok(p.col <= k, `${id} at column ${p.col}`);
    assert.ok(p.pendiente_deg <= DE[id].limite.valor, `${id} at ${p.pendiente_deg}°`);
    assert.deepEqual(p.incumple, []);
  }
});

test('the slope is measured exactly like the terrain sheet does', () => {
  const n = 81, m = 10, t = llano(n, m);
  for (let i = 0; i < n * n; i++) t.alturas[i] = Math.sin(i * 0.37) * 3 + (i % n) * 0.4;
  const r = generarAsentamiento(t, PIEZAS, { radio_m: 300 });
  for (const p of r.piezas) assert.equal(p.pendiente_deg, pendienteGrados(t.alturas, n, m, p.fila, p.col));
});

test('ground all at 8°: the landing pad (5° limit) is flagged, the LTV (20°) is not', () => {
  const n = 121, m = 10, t = llano(n, m), tan8 = Math.tan((8 * Math.PI) / 180);
  for (let f = 0; f < n; f++) for (let c = 0; c < n; c++) t.alturas[f * n + c] = c * m * tan8;
  const r = generarAsentamiento(t, PIEZAS, { radio_m: 500 });
  const pista = de(r, 'pista_aterrizaje'), ltv = de(r, 'ltv');
  assert.ok(Math.abs(pista.pendiente_deg - 8) < 0.01);
  assert.deepEqual(pista.incumple, ['pendiente']);
  assert.deepEqual(ltv.incumple, []);
  assert.deepEqual(de(r, 'torre_solar').incumple, []);
});

test('when no ground meets a slope limit, the piece goes to the gentlest slope and is flagged', () => {
  const n = 121, m = 10, k = 60, t = llano(n, m), tan8 = Math.tan((8 * Math.PI) / 180), tan12 = Math.tan((12 * Math.PI) / 180);
  for (let f = 0; f < n; f++) for (let c = 0; c < n; c++) t.alturas[f * n + c] = c <= k ? c * m * tan8 : k * m * tan8 + (c - k) * m * tan12;
  const r = generarAsentamiento(t, PIEZAS, { radio_m: 500 });
  const pista = de(r, 'pista_aterrizaje');
  assert.deepEqual(pista.incumple, ['pendiente']);
  assert.ok(pista.col < k && Math.abs(pista.pendiente_deg - 8) < 0.01, `pad at column ${pista.col}, ${pista.pendiente_deg}°`);
});

const pieza = (id, orden, criterios) => ({ id, nombre: id, clase: 'x', huella_m: null, huella_de: '', limite: null, separaciones: [], criterios, texto: 't', orden });

test('cost ties go to the cell nearest the point, then to the lowest cell index', () => {
  const r = generarAsentamiento(llano(20, 10), [pieza('a', 1, [{ tipo: 'pendiente', peso: 1 }])], { radio_m: 80 });
  assert.deepEqual(r.centro, { fila: 9.5, col: 9.5 });
  assert.deepEqual([r.piezas[0].fila, r.piezas[0].col], [9, 9]);
});

test('the improvement round moves a piece next to one placed after it, but never moves the first piece', () => {
  const n = 41, m = 10;
  const a = pieza('a', 1, [{ tipo: 'cerca', con: 'c', peso: 1 }]);
  const b = pieza('b', 2, [{ tipo: 'cerca', con: 'c', peso: 1 }, { tipo: 'pendiente', peso: 1 }]);
  const c = pieza('c', 3, [{ tipo: 'lejos', con: 'a', peso: 1 }]);
  const r = generarAsentamiento(llano(n, m), [c, b, a], { radio_m: 200 });
  assert.deepEqual(r.piezas.map((p) => p.id), ['a', 'b', 'c']);
  assert.deepEqual([de(r, 'a').fila, de(r, 'a').col], [20, 20]);
  assert.ok(metros(de(r, 'c'), de(r, 'a'), m) >= 190);
  assert.ok(metros(de(r, 'b'), de(r, 'c'), m) <= 15, `b is ${metros(de(r, 'b'), de(r, 'c'), m)} m from c`);
  assert.equal(de(r, 'a').criterios[0].usado, true);
});

test('light map: the solar tower goes to the sunlit half and the drill to the dark half', () => {
  const n = 101, m = 10, k = 50;
  const luz = { pasos: (i) => ((i % n) < k ? 24 : 0), total: 24 };
  const r = generarAsentamiento(llano(n, m), PIEZAS, { radio_m: 400, luz });
  assert.equal(r.usaLuz, true);
  assert.equal(r.sombraDe, 'luz');
  const torre = de(r, 'torre_solar'), trident = de(r, 'taladro_trident');
  assert.ok(torre.col < k && torre.luz === 24, `tower at column ${torre.col}`);
  assert.ok(trident.col >= k && trident.luz === 0, `drill at column ${trident.col}`);
  const s = trident.criterios.find((c) => c.tipo === 'sombra');
  assert.equal(s.usado, true);
  assert.equal(s.coste, 0);
  assert.equal(s.valor, 1);
  const l = torre.criterios.find((c) => c.tipo === 'luz');
  assert.deepEqual([l.valor, l.coste, l.usado], [24, 0, true]);
});

test('permanent-shadow layer: the drill lands in the patch or right next to it', () => {
  const n = 101, m = 10, sombra = new Float32Array(n * n);
  sombra[n * n - 1] = NaN;
  for (let f = 20; f <= 24; f++) for (let c = 70; c <= 74; c++) sombra[f * n + c] = 1;
  const r = generarAsentamiento({ ...llano(n, m), capas: { sombra_permanente: sombra } }, PIEZAS, { radio_m: 450 });
  assert.equal(r.sombraDe, 'sombra_permanente');
  const trident = de(r, 'taladro_trident');
  const dentro = trident.fila >= 20 && trident.fila <= 24 && trident.col >= 70 && trident.col <= 74;
  const pegado = trident.fila >= 19 && trident.fila <= 25 && trident.col >= 69 && trident.col <= 75;
  assert.ok(dentro || pegado, `drill at ${trident.fila},${trident.col}`);
  const s = trident.criterios.find((c) => c.tipo === 'sombra');
  assert.equal(s.usado, true);
  if (dentro) assert.deepEqual([s.valor, s.coste], [0, 0]);
});

test('inside a large permanent-shadow patch every cell counts as shadow, not only the sampled reference cells', () => {
  const n = 201, m = 10, sombra = new Float32Array(n * n);
  for (let f = 41; f <= 91; f++) for (let c = 111; c <= 161; c++) sombra[f * n + c] = 1;
  const r = generarAsentamiento({ ...llano(n, m), capas: { sombra_permanente: sombra } }, PIEZAS, { radio_m: 1000 });
  assert.equal(r.paso, 1);
  const trident = de(r, 'taladro_trident');
  assert.deepEqual([trident.fila, trident.col], [91, 111]);
  assert.equal(trident.criterios.find((x) => x.tipo === 'sombra').valor, 0);
});

test('thin permanent-shadow lines that the sampling stride misses still pull the drill towards them', () => {
  const n = 201, m = 10, sombra = new Float32Array(n * n);
  // Antidiagonales de suma impar: ninguna celda alineada con zancada 2 desde el centro (100, 100).
  for (let f = 0; f < n; f++) for (let c = 0; c < n; c++) if ((f + c) % 2 === 1 && f + c >= 101 && f + c <= 141) sombra[f * n + c] = 1;
  const t = { ...llano(n, m), capas: { sombra_permanente: sombra } };
  const r = generarAsentamiento(t, PIEZAS, { radio_m: 1000, maxCandidatos: 10000 });
  assert.equal(r.paso, 2);
  assert.equal(r.sombraDe, 'sombra_permanente');
  const trident = de(r, 'taladro_trident');
  assert.ok(trident.fila + trident.col >= 100 && trident.fila + trident.col <= 142, `drill at ${trident.fila},${trident.col}`);
  assert.ok(trident.criterios.find((x) => x.tipo === 'sombra').valor <= 2 * m);
});

test('a shadow patch outside the disc does not count; without light or shadow everything is still placed', () => {
  const n = 101, m = 10, sombra = new Float32Array(n * n);
  sombra[0] = 1;
  const r = generarAsentamiento({ ...llano(n, m), capas: { sombra_permanente: sombra } }, PIEZAS, { radio_m: 300 });
  assert.equal(r.sombraDe, null);
  assert.deepEqual(r.sin_sitio, []);
  for (const p of r.piezas) for (const c of p.criterios.filter((x) => x.tipo === 'sombra' || x.tipo === 'luz')) {
    assert.equal(c.usado, false);
    assert.equal(c.valor, null);
    assert.equal(c.coste, null);
  }
});

test('no piece on water, on a cell rejected by the twin check, or on a cell without elevation', () => {
  const n = 81, m = 10, k = 40, t = { ...llano(n, m), agua: new Float32Array(n * n) };
  const d = (f, c) => Math.hypot(f - k, c - k);
  // Anillos alrededor del punto (lo más atractivo): agua, luego rechazado por el gemelo, luego sin altura en un lado.
  // NaN en la capa de agua = sin dato (no excluye).
  for (let f = 0; f < n; f++) for (let c = 0; c < n; c++) {
    const i = f * n + c;
    if (d(f, c) <= 4) t.agua[i] = 1;
    else if (f < 5) t.agua[i] = NaN;
    if (d(f, c) > 8 && d(f, c) <= 11 && c > k) t.alturas[i] = NaN;
  }
  const apto = (f, c) => !(d(f, c) > 4 && d(f, c) <= 8);
  const r = generarAsentamiento(t, PIEZAS, { radio_m: 400, apto });
  assert.deepEqual(r.sin_sitio, []);
  assert.ok(de(r, 'habitat_superficie').dist_centro_m <= 100);
  for (const p of r.piezas) {
    const i = p.fila * n + p.col;
    assert.ok(!(t.agua[i] >= 1), `${p.id} on water`);
    assert.ok(apto(p.fila, p.col), `${p.id} on a rejected cell`);
    assert.ok(Number.isFinite(t.alturas[i]), `${p.id} without elevation`);
    assert.ok(Number.isFinite(p.pendiente_deg));
  }
  holgurasRespetadas(r, m);
});

test('a point away from the window centre whose disc leaves the grid stays inside both', () => {
  const n = 60, m = 10, centro = { fila: 3, col: 55 };
  const r = generarAsentamiento(llano(n, m), PIEZAS, { radio_m: 250, centro });
  assert.deepEqual(r.centro, centro);
  assert.ok(r.piezas.length > 0);
  assert.equal(r.piezas.length + r.sin_sitio.length, PIEZAS.length);
  for (const p of r.piezas) {
    assert.ok(p.fila >= 0 && p.fila < n && p.col >= 0 && p.col < n, `${p.id} at ${p.fila},${p.col}`);
    assert.ok(Math.hypot(p.fila - 3, p.col - 55) * m <= 250 + 1e-9);
  }
  assert.deepEqual([de(r, 'habitat_superficie').fila, de(r, 'habitat_superficie').col], [3, 55]);
  holgurasRespetadas(r, m);
});

test('a tiny disc: what does not fit goes to no-room with a reason, without throwing', () => {
  const n = 21, m = 10;
  const r = generarAsentamiento(llano(n, m), PIEZAS, { radio_m: 15 });
  assert.equal(r.candidatos, 9);
  assert.ok(r.sin_sitio.length > 0);
  assert.equal(r.piezas.length + r.sin_sitio.length, PIEZAS.length);
  for (const s of r.sin_sitio) assert.equal(s.motivo, 'no free ground left inside this radius');
  holgurasRespetadas(r, m);
});

test('no ground with elevation inside the radius: everything is without a site', () => {
  const n = 21, t = { n, m: 10, alturas: plano(n, NaN) };
  const r = generarAsentamiento(t, PIEZAS, { radio_m: 100 });
  assert.equal(r.candidatos, 0);
  assert.deepEqual(r.piezas, []);
  assert.deepEqual(r.sin_sitio.map((s) => s.id), PIEZAS.map((p) => p.id));
  for (const s of r.sin_sitio) assert.equal(s.motivo, 'no ground with elevation data inside this radius');
});

test('the minimum spacing option keeps every pair of centres apart', () => {
  const n = 121, m = 10;
  const r = generarAsentamiento(llano(n, m), PIEZAS, { radio_m: 500, separacion_min_m: 60 });
  for (let a = 0; a < r.piezas.length; a++) for (let b = a + 1; b < r.piezas.length; b++) assert.ok(metros(r.piezas[a], r.piezas[b], m) >= 60);
});

test('big disc is sampled with a stride that keeps the window centre and caps the candidates', () => {
  const n = 401, m = 10;
  const r = generarAsentamiento(llano(n, m), PIEZAS, { radio_m: 2000, maxCandidatos: 5000 });
  assert.ok(r.paso > 1);
  assert.ok(r.candidatos <= 5000 * 1.1, `${r.candidatos}`);
  assert.deepEqual([de(r, 'habitat_superficie').fila, de(r, 'habitat_superficie').col], [200, 200]);
  for (const p of r.piezas) assert.ok((p.fila - 200) % r.paso === 0 && (p.col - 200) % r.paso === 0, `${p.id} off the stride`);
});

test('1024×1024 grid, 2000 m radius, light map and shadow layer in well under a second', () => {
  // ~5× lo medido en local (90-135 ms).
  const UMBRAL_MS = 600;
  const n = 1024, m = 10, alturas = new Float32Array(n * n), sombra = new Float32Array(n * n);
  for (let f = 0; f < n; f++) for (let c = 0; c < n; c++) {
    alturas[f * n + c] = 40 * Math.sin(f / 37) * Math.cos(c / 53) + 0.02 * c;
    if (Math.hypot(f - 650, c - 400) < 30) sombra[f * n + c] = 1;
  }
  const luz = { pasos: (i) => (i * 7) % 25, total: 24 };
  const t = { n, m, alturas, capas: { sombra_permanente: sombra } };
  generarAsentamiento(t, PIEZAS, { radio_m: 500, luz });
  const t0 = performance.now();
  const r = generarAsentamiento(t, PIEZAS, { radio_m: 2000, luz });
  const ms = performance.now() - t0;
  assert.equal(r.piezas.length + r.sin_sitio.length, PIEZAS.length);
  assert.equal(r.sombraDe, 'sombra_permanente');
  assert.ok(ms < UMBRAL_MS, `${ms.toFixed(0)} ms`);
});

test('another published limit measured in the cell (cumple) is as hard as the slope limit, and is reported when no cell meets it', () => {
  const n = 201, m = 10, t = llano(n, m);
  // La torre solar solo «aguanta» al este del centro; el resto de piezas, en cualquier sitio.
  const cumple = (p, f, c) => p.id !== 'torre_solar' || c >= 120;
  const r = generarAsentamiento(t, PIEZAS, { radio_m: 500, cumple });
  assert.ok(de(r, 'torre_solar').col >= 120);
  assert.deepEqual(de(r, 'torre_solar').incumple, []);
  const libre = generarAsentamiento(t, PIEZAS, { radio_m: 500 });
  assert.ok(de(libre, 'torre_solar').col < 120, 'without the limit the tower sits by the habitat');
  const imposible = generarAsentamiento(t, PIEZAS, { radio_m: 500, cumple: (p) => p.id !== 'viper' });
  assert.deepEqual(de(imposible, 'viper').incumple, ['limite']);
  assert.equal(imposible.sin_sitio.length, 0);
});

test('a cell limit that nowhere can meet does not drag the piece away: it stays where its rule puts it', () => {
  const n = 201, m = 10, t = llano(n, m);
  const libre = generarAsentamiento(t, PIEZAS, { radio_m: 500 });
  const frio = generarAsentamiento(t, PIEZAS, { radio_m: 500, cumple: (p) => p.id !== 'torre_solar' });
  assert.deepEqual([de(frio, 'torre_solar').fila, de(frio, 'torre_solar').col], [de(libre, 'torre_solar').fila, de(libre, 'torre_solar').col]);
  assert.deepEqual(de(frio, 'torre_solar').incumple, ['limite']);
});

test('equipment already planted by hand takes its ground and counts for the published separations', () => {
  const n = 401, m = 10, t = llano(n, m), k = (n - 1) / 2;
  // Un hábitat puesto a mano 600 m al este del centro: el reactor de la base debe quedar a ≥ 1000 m de los dos hábitats.
  const mano = { equipo: 'habitat_superficie', fila: k, col: k + 60, huella_m: DE.habitat_superficie.huella_m };
  const r = generarAsentamiento(t, PIEZAS, { radio_m: 2000, ocupadas: [mano] });
  const reactor = de(r, 'reactor_fision'), hab = de(r, 'habitat_superficie');
  assert.ok(metros(reactor, hab, m) >= 1000);
  assert.ok(metros(reactor, mano, m) >= 1000, `reactor is ${metros(reactor, mano, m)} m from the hand-planted habitat`);
  assert.deepEqual(reactor.incumple, []);
  for (const p of r.piezas) assert.ok(metros(p, mano, m) >= ((DE[p.id].huella_m ?? 0) + mano.huella_m) / 2 + HOLGURA_M, `${p.id} sits on the hand-planted habitat`);
  // En un radio donde no cabe a 1000 m del hábitat manual, se dice.
  const corto = generarAsentamiento(t, PIEZAS, { radio_m: 250, ocupadas: [mano] });
  assert.ok(de(corto, 'reactor_fision').incumple.includes('separacion:habitat_superficie'));
});

test('a separation margin keeps the reactor that far beyond its published distance', () => {
  const n = 401, m = 10, t = llano(n, m);
  const justo = generarAsentamiento(t, PIEZAS, { radio_m: 2000 });
  const holgado = generarAsentamiento(t, PIEZAS, { radio_m: 2000, margen_separacion_m: 60 });
  const d = (r) => metros(de(r, 'reactor_fision'), de(r, 'habitat_superficie'), m);
  assert.ok(d(justo) >= 1000 && d(justo) < 1060, `without margin the reactor sits at ${d(justo)} m`);
  assert.ok(d(holgado) >= 1060, `with a 60 m margin the reactor sits at ${d(holgado)} m`);
});

// ---------- Modo por prioridad ----------
test('priority: the order is the user\'s, pieces not listed keep their rule order after the listed ones', () => {
  const p = piezasPorPrioridad(PIEZAS, ['taladro_trident', 'torre_solar']);
  assert.deepEqual(p.slice(0, 3).map((x) => x.id), ['taladro_trident', 'torre_solar', 'habitat_superficie']);
  assert.deepEqual(p.map((x) => x.orden), PIEZAS.map((_, k) => k + 1));
  assert.equal(p.length, PIEZAS.length);
  assert.deepEqual(piezasPorPrioridad(PIEZAS, []).map((x) => x.id), PIEZAS.map((x) => x.id), 'an empty list keeps the rule order');
  assert.deepEqual(piezasPorPrioridad(PIEZAS, ['no_such_piece']).map((x) => x.id), PIEZAS.map((x) => x.id), 'unknown ids are ignored');
  assert.deepEqual(DE.ltv.criterios, REGLAS.ltv.criterios, 'the catalogue pieces are not touched');
});

test('priority: the anchor keeps only what it measures on the ground, plus the centre', () => {
  const [ancla] = piezasPorPrioridad(PIEZAS, ['ltv']);
  assert.equal(ancla.id, 'ltv');
  assert.equal(ancla.ancla, true);
  assert.deepEqual(ancla.criterios, [{ tipo: 'pendiente', peso: 1 }, { tipo: 'centro', peso: 1 }]);
  assert.equal(ancla.texto, 'Your first need: placed first, looking for the flattest ground, the centre');
  assert.equal(ancla.limite.valor, 20, 'its published limit stays');
  const [hab] = piezasPorPrioridad(PIEZAS, ['habitat_superficie']);
  assert.deepEqual(hab.criterios, REGLAS.habitat_superficie.criterios, 'a piece that already looks for the centre is not given it twice');
});

test('priority: every other piece is pulled towards the anchor, more the earlier it goes, unless its own rule already refers to it', () => {
  const p = piezasPorPrioridad(PIEZAS, ['taladro_trident']);
  const de2 = Object.fromEntries(p.map((x) => [x.id, x]));
  assert.equal(de2.planta_agua.tira, null, 'the water plant already goes next to the drill');
  assert.deepEqual(de2.planta_agua.criterios, REGLAS.planta_agua.criterios);
  const tiran = p.filter((x) => x.tira);
  assert.ok(tiran.length >= 6);
  for (const x of tiran) {
    assert.deepEqual(x.criterios.at(-1), { tipo: 'cerca', con: 'taladro_trident', peso: x.tira.peso });
    assert.deepEqual(x.criterios.slice(0, -1), (REGLAS[x.id] ?? REGLA_DEFECTO).criterios, 'its own rule stays');
    assert.ok(x.tira.peso <= PESO_ANCLA.max && x.tira.peso >= PESO_ANCLA.min);
  }
  for (let k = 1; k < tiran.length; k++) assert.ok(tiran[k].tira.peso < tiran[k - 1].tira.peso, 'the pull falls with the rank');
  assert.equal(p[1].tira?.peso ?? PESO_ANCLA.max, PESO_ANCLA.max);
  assert.equal(p.at(-1).tira?.peso ?? PESO_ANCLA.min, PESO_ANCLA.min);
  const pista = piezasPorPrioridad(PIEZAS, ['habitat_superficie']).find((x) => x.id === 'pista_aterrizaje');
  assert.equal(pista.tira, null, 'the landing pad keeps away from the habitat: no pull towards it');
  assert.deepEqual(piezasPorPrioridad(PIEZAS.slice(0, 2), ['reactor_fision']).map((x) => x.tira), [null, { con: 'reactor_fision', peso: PESO_ANCLA.max }], 'with two pieces the second gets the full pull');
});

test('priority: on flat ground the layout gathers around the anchor and the published limits still hold', () => {
  const n = 201, m = 20, t = llano(n, m), opc = { radio_m: 2000, separacion_min_m: 100 };
  const optimo = generarAsentamiento(t, PIEZAS, opc);
  const orden = ['taladro_trident', ...PIEZAS.map((p) => p.id).filter((id) => id !== 'taladro_trident')];
  const r = generarAsentamiento(t, piezasPorPrioridad(PIEZAS, orden), opc);
  assert.equal(r.piezas.length, PIEZAS.length);
  assert.deepEqual(r.piezas.map((p) => p.id), orden, 'placed in the order asked');
  const ancla = de(r, 'taladro_trident');
  assert.ok(ancla.dist_centro_m < 1e-9, 'on flat ground with no light map the anchor sits at the centre');
  const media = (res, id) => res.piezas.filter((p) => p.id !== id).reduce((s, p) => s + metros(p, de(res, id), m), 0) / (res.piezas.length - 1);
  assert.ok(media(r, 'taladro_trident') < media(optimo, 'taladro_trident') - 50, `mean distance to the drill ${media(r, 'taladro_trident')} m, was ${media(optimo, 'taladro_trident')} m`);
  assert.ok(metros(de(r, 'reactor_fision'), de(r, 'habitat_superficie'), m) >= 1000, 'reactor still 1 km from the habitat');
  assert.deepEqual(r.piezas.flatMap((p) => p.incumple), []);
  holgurasRespetadas(r, m);
  const otra = generarAsentamiento(t, piezasPorPrioridad(PIEZAS, orden), opc);
  assert.deepEqual(otra.piezas.map((p) => [p.id, p.fila, p.col]), r.piezas.map((p) => [p.id, p.fila, p.col]), 'no randomness');
});

test('centre off the middle of the window: distances are measured from it and the disc is cut by the window edge', () => {
  const n = 101, m = 20, t = llano(n, m);
  const r = generarAsentamiento(t, PIEZAS, { radio_m: 500, centro: { fila: 10.4, col: 80.2 }, separacion_min_m: 40 });
  assert.deepEqual(r.centro, { fila: 10.4, col: 80.2 });
  for (const p of r.piezas) {
    assert.ok(Math.abs(p.dist_centro_m - Math.hypot(p.fila - 10.4, p.col - 80.2) * m) < 1e-9);
    assert.ok(p.dist_centro_m <= 500 + 1e-9 && p.fila >= 0 && p.col >= 0 && p.fila < n && p.col < n);
  }
  assert.ok(de(r, 'habitat_superficie').dist_centro_m <= m, 'the habitat goes to the cell nearest the point');
});
