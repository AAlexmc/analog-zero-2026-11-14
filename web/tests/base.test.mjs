import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generarBase } from '../terreno/base.js';
import { pendientes, caminoMinimo, umbralMinimo, medirRuta } from '../terreno/rutas.js';
import { perfil, rasante, volumenCarretera, plataforma } from '../terreno/obra.js';

const RAD = Math.PI / 180;
const CUMPLE = { '<=': (v, l) => v <= l, '<': (v, l) => v < l, '>=': (v, l) => v >= l, '>': (v, l) => v > l };
const json = (o) => JSON.stringify(o, (_, v) => (ArrayBuffer.isView(v) ? Array.from(v) : v === Infinity ? 'Infinity' : v));
const rel = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${msg ?? ''} ${a} ≠ ${b}`);

function mulberry32(semilla) {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sep = (valor, respecto_a) => ({ variable: 'separacion_m', op: '>=', valor, unidad: 'm', respecto_a, texto: 't', fuente: 'https://x', cita: 'c', verificado: true });
const pend = (valor) => ({ variable: 'pendiente_deg', op: '<=', valor, unidad: 'deg', texto: 't', fuente: 'https://x', cita: 'c', verificado: true });

// 48×48 a 30 m: ladera de 12°, meseta A y B cortadas en la ladera (con rampa por la columna central),
// meseta C levantada 40 m con acantilado alrededor (solo se llega con carretera) y una zona en sombra permanente fría.
function terrenoMesetas(semilla) {
  const n = 48, m = 30, rnd = mulberry32(semilla), N = n * n;
  const alturas = new Float32Array(N), sombra = new Float32Array(N), temp = new Float32Array(N), ilum = new Float32Array(N);
  const k = Math.tan(12 * RAD) * m;
  const d = () => Math.floor(rnd() * 3) - 1;
  const A = [6 + d(), 6 + d(), 6], B = [30 + d(), 30 + d(), 7], C = [20 + d(), 38 + d(), 5];
  const dentro = (f, c, [f0, c0, L]) => f >= f0 && f < f0 + L && c >= c0 && c < c0 + L;
  for (let f = 0; f < n; f++) for (let c = 0; c < n; c++) {
    const i = f * n + c;
    let z = k * c;
    if (dentro(f, c, A)) z = k * (A[1] + 3);
    if (dentro(f, c, B)) z = k * (B[1] + 3);
    if (dentro(f, c, C)) z = k * (n - 1) + 40;
    alturas[i] = z + (rnd() - 0.5) * 0.3;
    const sp = f >= 36 && c >= 26 ? 1 : 0;
    sombra[i] = sp;
    temp[i] = sp ? 60 + 20 * rnd() : 250;
    ilum[i] = sp ? 0 : 0.3 + (0.6 * c) / n;
  }
  return { n, m, alturas, capas: { sombra_permanente: sombra, temp_max: temp, iluminacion: ilum } };
}

const piezasMesetas = () => [
  { id: 'hab', equipo: { id: 'habitat_superficie', requisitos: [] }, diametro_m: 20, pendiente_max_deg: 5, criterios: [] },
  { id: 'reactor', equipo: { id: 'reactor_fision', requisitos: [sep(600, 'habitat_superficie')] }, diametro_m: 10, pendiente_max_deg: 5, criterios: [] },
  { id: 'pista', equipo: { id: 'pista_aterrizaje', requisitos: [pend(5)] }, diametro_m: 100, criterios: [] },
  { id: 'agua', equipo: { id: 'planta_agua', requisitos: [] }, diametro_m: 30, pendiente_max_deg: 5, criterios: [{ id: 'dist_frio', umbral_k: 100, beneficio: false, peso: 1 }] },
];
const VEH = { limite: 20 };
const PESOS = { plataformas_m3: 1, carreteras_m3: 0.5, rutas_m: 2 };
const SEP_H = 30, ANCHO = 6;

// Fuerza bruta independiente del módulo: todas las celdas que cumplen, todas las combinaciones.
function fuerzaBruta(t, piezas, lv) {
  const { n, m, alturas, capas } = t, N = n * n;
  const tr = { n, m, alturas, pend: pendientes(alturas, n, m), sombra: capas.sombra_permanente };
  const lim = (p) => (p.equipo.requisitos.find((r) => r.variable === 'pendiente_deg')?.valor ?? p.pendiente_max_deg ?? lv);
  const celdas = piezas.map((p) => {
    const out = [];
    for (let i = 0; i < N; i++) {
      if (!(tr.pend[i] <= lim(p)) || capas.sombra_permanente[i] !== 0) continue;
      const pl = plataforma(t, Math.floor(i / n), i % n, p.diametro_m, lim(p));
      if (pl.corte_m3 !== null) out.push({ i, vol: pl.corte_m3 + pl.relleno_m3 });
    }
    return out;
  });
  const dist = (a, b) => Math.hypot(Math.floor(a / n) - Math.floor(b / n), (a % n) - (b % n)) * m;
  const minSep = (a, b) => {
    let s = (piezas[a].diametro_m + piezas[b].diametro_m) / 2 + SEP_H;
    for (const [x, y] of [[a, b], [b, a]]) for (const r of piezas[x].equipo.requisitos) if (r.variable === 'separacion_m' && r.respecto_a === piezas[y].equipo.id) s = Math.max(s, r.valor);
    return s;
  };
  const pisa = (cam, x, diam) => cam.slice(1, -1).some((i) => dist(i, x) < diam / 2 + ANCHO / 2);
  const cache = new Map();
  const conexion = (h, x) => {
    const key = h * N + x;
    if (cache.has(key)) return cache.get(key);
    let out = null;
    const r = caminoMinimo(tr, h, x, { limite: lv });
    if (r.camino) out = { vol: 0, len: medirRuta(tr, r.camino).longitud_m, cam: r.camino };
    else {
      const u = umbralMinimo(tr, h, x);
      if (Number.isFinite(u)) {
        const cam = caminoMinimo(tr, h, x, { limite: u }).camino;
        const p = perfil(t, cam), ra = rasante(p.s, p.z, lv, { anclarInicio: true, anclarFin: true });
        if (ra.factible) {
          const v = volumenCarretera(p.s, p.z, ra.zp, ANCHO);
          out = { vol: v.corte_m3 + v.relleno_m3, len: medirRuta(tr, cam).longitud_m, cam };
        }
      }
    }
    cache.set(key, out);
    return out;
  };
  let best = Infinity, segundo = Infinity, pos = null;
  for (const h of celdas[0]) {
    const listas = [];
    for (let p = 1; p < piezas.length; p++) {
      const l = [];
      for (const x of celdas[p]) {
        if (dist(h.i, x.i) < minSep(0, p)) continue;
        const c = conexion(h.i, x.i);
        if (c) l.push({ i: x.i, cam: c.cam, coste: PESOS.plataformas_m3 * x.vol + PESOS.carreteras_m3 * c.vol + PESOS.rutas_m * c.len });
      }
      listas.push(l);
    }
    const elegidos = [];
    const rec = (p, acum) => {
      if (p === listas.length) {
        const total = acum;
        if (total < best) { segundo = best; best = total; pos = [h.i, ...elegidos.map((e) => e.i)]; } else if (total < segundo) segundo = total;
        return;
      }
      for (const x of listas[p]) {
        let ok = true;
        for (let q = 0; ok && q < p; q++) {
          ok = dist(elegidos[q].i, x.i) >= minSep(q + 1, p + 1)
            && !pisa(elegidos[q].cam, x.i, piezas[p + 1].diametro_m) && !pisa(x.cam, elegidos[q].i, piezas[q + 1].diametro_m);
        }
        if (!ok) continue;
        elegidos.push(x);
        rec(p + 1, acum + x.coste);
        elegidos.pop();
      }
    };
    rec(0, PESOS.plataformas_m3 * h.vol);
  }
  return { best, segundo, pos };
}

for (const semilla of [1, 2, 3]) {
  test(`exact search over every candidate cell matches brute force (two plateaus, ridge, cold shadow; seed ${semilla})`, () => {
    const t = terrenoMesetas(semilla), piezas = piezasMesetas();
    const bf = fuerzaBruta(t, piezas, VEH.limite);
    assert.ok(Number.isFinite(bf.best), 'brute force must find a base on this terrain');
    const r = generarBase(t, piezas, VEH, { k: Infinity, pesos: PESOS, anchoCarretera_m: ANCHO, separacionHuellas_m: SEP_H, presupuestoRutas: 1e6 });
    assert.equal(r.factible, true);
    assert.equal(r.busqueda.metodo, 'exacto');
    assert.equal(r.busqueda.optimo_probado, true);
    rel(r.objetivo.total, bf.best, 1e-9, 'objective');
    if (bf.segundo - bf.best > 1e-6 * bf.best) assert.deepEqual(r.piezas.map((p) => p.i), bf.pos);
    // La meseta C solo se alcanza por carretera: al menos una pieza en C en alguna semilla no es obligatorio, pero si hay carretera tiene volumen.
    for (const c of r.carreteras) if (c.tipo === 'carretera') assert.ok(c.corte_m3 + c.relleno_m3 > 0);
  });
}

test('every connection type appears on the plateau terrain: plain route and built road', () => {
  const t = terrenoMesetas(1), piezas = piezasMesetas();
  // Forzar la pista a la meseta C (la única con la cota de C) con un requisito de iluminación que solo C cumple.
  const nC = t.n, ilum = t.capas.iluminacion;
  for (let i = 0; i < nC * nC; i++) if (t.alturas[i] > Math.tan(12 * RAD) * 30 * (nC - 1) + 20) ilum[i] = 0.99;
  piezas[2].equipo.requisitos.push({ variable: 'iluminacion_frac', op: '>=', valor: 0.95, unidad: 'fraction' });
  const r = generarBase(t, piezas, VEH, { k: Infinity, pesos: PESOS, anchoCarretera_m: ANCHO, separacionHuellas_m: SEP_H });
  assert.equal(r.factible, true);
  const tipos = new Set(r.carreteras.map((c) => c.tipo));
  assert.ok(tipos.has('carretera'), `types: ${[...tipos]}`);
  assert.ok(tipos.has('ruta'), `types: ${[...tipos]}`);
});

// Terreno aleatorio con colinas suaves; la sombra permanente son las celdas más bajas.
function terrenoAleatorio(semilla) {
  const rnd = mulberry32(semilla);
  const n = 32 + Math.floor(rnd() * 12), m = 20 + rnd() * 30, N = n * n;
  const alturas = new Float32Array(N);
  const colinas = Array.from({ length: 6 }, () => ({ f: rnd() * n, c: rnd() * n, r: 3 + rnd() * n / 3, h: (rnd() - 0.4) * m * 4 }));
  // Escarpe de un paso de celda que cruza todo el terreno: solo se pasa con carretera.
  const escarpe = rnd() < 0.6 ? { c0: n * (0.3 + 0.4 * rnd()), a: rnd() * 4, h: m * (0.8 + rnd()) } : null;
  for (let f = 0; f < n; f++) for (let c = 0; c < n; c++) {
    let z = 0;
    for (const q of colinas) z += q.h * Math.exp(-((f - q.f) ** 2 + (c - q.c) ** 2) / (2 * q.r * q.r));
    if (escarpe && c > escarpe.c0 + escarpe.a * Math.sin(f / 5)) z += escarpe.h;
    alturas[f * n + c] = z + rnd() * 0.2 * m;
  }
  if (rnd() < 0.3) for (let i = 0; i < 6; i++) alturas[Math.floor(rnd() * N)] = NaN;
  const orden = Array.from(alturas.keys()).filter((i) => Number.isFinite(alturas[i])).sort((a, b) => alturas[a] - alturas[b]);
  const sombra = new Float32Array(N), temp = new Float32Array(N), ilum = new Float32Array(N);
  const corte = orden[Math.floor(orden.length * 0.12)];
  for (let i = 0; i < N; i++) {
    const ps = Number.isFinite(alturas[i]) && alturas[i] <= alturas[corte] ? 1 : 0;
    // Con escarpe, la luz alta queda arriba: las torres (iluminación ≥ 0.5) cruzan el escarpe desde el hábitat (< 0.5).
    const arriba = escarpe && (i % n) > escarpe.c0 + escarpe.a * Math.sin(Math.floor(i / n) / 5);
    sombra[i] = ps; ilum[i] = ps ? 0 : escarpe ? (arriba ? 0.5 : 0) + 0.49 * rnd() : rnd(); temp[i] = ps ? 40 + 80 * rnd() : 150 + 200 * rnd();
  }
  const capas = { sombra_permanente: sombra, temp_max: temp, iluminacion: ilum };
  return { t: { n, m, alturas, capas }, rnd, escarpe: !!escarpe };
}

function piezasAleatorias(rnd, m, escarpe) {
  const out = [
    { id: 'hab', equipo: { id: 'habitat_superficie', requisitos: [] }, diametro_m: m * (0.3 + rnd() * 3), criterios: [{ id: 'pendiente', beneficio: false, peso: 1 }] },
    { id: 'reactor', equipo: { id: 'reactor_fision', requisitos: [sep(m * (2 + rnd() * 8), 'habitat_superficie')] }, diametro_m: m * 0.2, criterios: [{ id: 'pendiente', beneficio: false, peso: 1 }] },
  ];
  if (rnd() < 0.7) out.push({ id: 'pista', equipo: { id: 'pista_aterrizaje', requisitos: [pend(5 + rnd() * 5)] }, diametro_m: m * (1 + rnd() * 4), criterios: [{ id: 'pendiente', beneficio: false, peso: 1 }] });
  const luz = (op, valor) => ({ variable: 'iluminacion_frac', op, valor, unidad: 'fraction' });
  if (escarpe) out[0].equipo.requisitos.push(luz('<', 0.5));
  const torres = Math.floor(rnd() * 3) + (escarpe ? 1 : 0);
  for (let j = 0; j < torres; j++) out.push({ id: `torre${j}`, equipo: { id: 'torre_solar', requisitos: escarpe ? [pend(10), luz('>=', 0.5)] : [pend(10)] }, diametro_m: m * 0.3, criterios: [{ id: 'iluminacion', beneficio: true, peso: 1 }] });
  if (rnd() < 0.7) out.push({ id: 'agua', equipo: { id: 'planta_agua', requisitos: [] }, diametro_m: m * 0.5, criterios: [{ id: 'dist_frio', umbral_k: 100, beneficio: false, peso: 2 }, { id: 'iluminacion', beneficio: true, peso: 1 }] });
  return out;
}

// Recomprobación sin pasar por base.js: celdas, plataformas, separaciones, accesos y objetivo.
function recomprobar(t, piezas, veh, opc, r) {
  const { n, m, alturas, capas } = t;
  const pd = pendientes(alturas, n, m), lv = veh.limite;
  const errores = [];
  const mal = (s) => errores.push(s);
  const lim = (p) => {
    const ls = p.equipo.requisitos.filter((q) => q.variable === 'pendiente_deg').map((q) => q.valor);
    return ls.length ? Math.min(...ls) : p.pendiente_max_deg ?? lv;
  };
  const porId = new Map(r.piezas.map((p) => [p.id, p]));
  let volP = 0, volC = 0, len = 0;
  for (const p of piezas) {
    const s = porId.get(p.id);
    if (!s) { mal(`missing piece ${p.id}`); continue; }
    const i = s.fila * n + s.col;
    if (s.i !== i) mal(`${p.id}: index ≠ fila·n + col`);
    if (!Number.isFinite(alturas[i])) mal(`${p.id}: no elevation`);
    if (!(pd[i] <= lim(p))) mal(`${p.id}: cell slope ${pd[i]} > ${lim(p)}`);
    if (capas.sombra_permanente && !p.enSombra && capas.sombra_permanente[i] !== 0) mal(`${p.id}: on permanent shadow`);
    for (const q of p.equipo.requisitos) {
      if (q.variable === 'iluminacion_frac' && !CUMPLE[q.op](capas.iluminacion[i], q.valor)) mal(`${p.id}: illumination`);
    }
    const pl = plataforma(t, s.fila, s.col, p.diametro_m, lim(p));
    if (!(pl.pend_despues_deg <= lim(p) + 1e-9)) mal(`${p.id}: platform slope after ${pl.pend_despues_deg}`);
    if (Math.abs(pl.corte_m3 - s.plataforma.corte_m3) > 1e-6 * (1 + pl.corte_m3)) mal(`${p.id}: platform cut differs`);
    volP += pl.corte_m3 + pl.relleno_m3;
  }
  for (let a = 0; a < piezas.length; a++) for (let b = a + 1; b < piezas.length; b++) {
    const A = porId.get(piezas[a].id), B = porId.get(piezas[b].id);
    if (!A || !B) continue;
    const d = Math.hypot(A.fila - B.fila, A.col - B.col) * m;
    if (d - (piezas[a].diametro_m + piezas[b].diametro_m) / 2 < (opc.separacionHuellas_m ?? 0) - 1e-9) mal(`${piezas[a].id}-${piezas[b].id}: footprints too close (${d} m)`);
    for (const [x, y] of [[piezas[a], piezas[b]], [piezas[b], piezas[a]]]) for (const q of x.equipo.requisitos) {
      if (q.variable === 'separacion_m' && q.respecto_a === y.equipo.id && Number.isFinite(q.valor) && !CUMPLE[q.op](d, q.valor)) mal(`${x.id}: separation from ${y.id} ${d} < ${q.valor}`);
    }
  }
  const hub = r.piezas.find((p) => p.hub);
  const k = Math.tan(lv * RAD);
  for (const p of r.piezas) {
    if (p.hub) continue;
    const c = r.carreteras.find((x) => x.hasta === p.id);
    if (!c) { mal(`${p.id}: no connection to the habitat`); continue; }
    const cam = Array.from(c.traza);
    if (cam[0] !== hub.i || cam[cam.length - 1] !== p.i) mal(`${p.id}: path does not join the habitat and the piece`);
    for (let j = 1; j < cam.length; j++) {
      const df = Math.abs(Math.floor(cam[j] / n) - Math.floor(cam[j - 1] / n)), dc = Math.abs((cam[j] % n) - (cam[j - 1] % n));
      if (Math.max(df, dc) !== 1) mal(`${p.id}: path step ${j} is not between neighbours`);
    }
    let L = 0, sobre = 0;
    for (let j = 0; j < cam.length; j++) {
      if (!(pd[cam[j]] <= lv)) sobre++;
      if (j) {
        const h = Math.hypot(Math.floor(cam[j] / n) - Math.floor(cam[j - 1] / n), (cam[j] % n) - (cam[j - 1] % n)) * m;
        L += Math.hypot(h, alturas[cam[j]] - alturas[cam[j - 1]]);
      }
    }
    rel(c.longitud_m, L, 1e-9, `${p.id} route length`);
    for (const o of r.piezas) {
      if (o.hub || o.id === p.id) continue;
      const pisadas = cam.slice(1, -1).filter((i) => Math.hypot(Math.floor(i / n) - o.fila, (i % n) - o.col) * m < o.diametro_m / 2 + opc.anchoCarretera_m / 2);
      if (pisadas.length) mal(`${p.id}: path crosses the ${o.id} pad at ${pisadas.length} cells`);
    }
    len += L;
    if (c.tipo === 'ruta') {
      if (sobre) mal(`${p.id}: plain route crosses ${sobre} cells over the vehicle limit`);
    } else {
      const s = [0];
      for (let j = 1; j < cam.length; j++) s.push(s[j - 1] + Math.hypot(Math.floor(cam[j] / n) - Math.floor(cam[j - 1] / n), (cam[j] % n) - (cam[j - 1] % n)) * m);
      const zp = Array.from(c.zp);
      if (zp.length !== cam.length) mal(`${p.id}: grade length`);
      for (let j = 1; j < zp.length; j++) if (Math.abs(zp[j] - zp[j - 1]) > k * (s[j] - s[j - 1]) + 1e-6) mal(`${p.id}: road grade over the vehicle limit at ${j}`);
      if (Math.abs(zp[0] - alturas[cam[0]]) > 1e-6 || Math.abs(zp[zp.length - 1] - alturas[cam[cam.length - 1]]) > 1e-6) mal(`${p.id}: road not anchored at the ends`);
      const z = cam.map((i) => alturas[i]);
      const v = volumenCarretera(Float64Array.from(s), Float64Array.from(z), Float64Array.from(zp), opc.anchoCarretera_m, opc.talud ?? 0);
      rel(c.corte_m3 + c.relleno_m3, v.corte_m3 + v.relleno_m3, 1e-6, `${p.id} road volume`);
      volC += v.corte_m3 + v.relleno_m3;
    }
  }
  const w = { plataformas_m3: 1, carreteras_m3: 1, rutas_m: 1, ...opc.pesos };
  rel(r.objetivo.total, w.plataformas_m3 * volP + w.carreteras_m3 * volC + w.rutas_m * len, 1e-6, 'objective');
  for (const q of r.restricciones) if (!(q.holgura >= -1e-9)) mal(`constraint ${q.tipo} ${q.pieza ?? ''} has negative slack ${q.holgura}`);
  return errores;
}

test('property: every feasible base on 30 random terrains meets every constraint, rechecked independently', () => {
  let factibles = 0, heur = 0, carreteras = 0;
  for (let s = 1; s <= 30; s++) {
    const { t, rnd, escarpe } = terrenoAleatorio(1000 + s);
    const piezas = piezasAleatorias(rnd, t.m, escarpe);
    const opc = { k: 3 + Math.floor(rnd() * 4), anchoCarretera_m: 5, talud: rnd() < 0.5 ? 1.5 : undefined, separacionHuellas_m: t.m * rnd(), semilla: s,
      separacionCandidatos_m: t.m * 2, pesos: { plataformas_m3: 1, carreteras_m3: rnd() * 2, rutas_m: rnd() * 5 }, presupuestoRutas: s % 4 === 0 ? 6 : 1e5 };
    const veh = { limite: 12 + rnd() * 15 };
    const r = generarBase(t, piezas, veh, opc);
    if (!r.factible) {
      assert.ok(r.motivo && r.restriccion, `seed ${s}: infeasible without a reason`);
      continue;
    }
    factibles++;
    carreteras += r.carreteras.filter((c) => c.tipo === 'carretera').length;
    assert.deepEqual(recomprobar(t, piezas, veh, opc, r), [], `seed ${s}`);
    if (r.busqueda.metodo === 'heuristica') {
      heur++;
      assert.equal(r.busqueda.optimo_probado, false);
      const ex = generarBase(t, piezas, veh, { ...opc, presupuestoRutas: 1e5 });
      assert.equal(ex.busqueda.metodo, 'exacto');
      assert.ok(ex.objetivo.total <= r.objetivo.total * (1 + 1e-9), `seed ${s}: heuristic beats the exact search`);
      assert.ok(r.busqueda.cota_inferior <= ex.objetivo.total * (1 + 1e-9), `seed ${s}: lower bound above the optimum`);
    }
  }
  assert.ok(factibles >= 15, `only ${factibles} of 30 random terrains gave a base`);
  assert.ok(heur >= 1, 'the small-budget cases should use the heuristic at least once');
  assert.ok(carreteras >= 3, `only ${carreteras} built roads over 30 terrains: the road checks are barely exercised`);
});

test('same input gives the same output byte for byte (exact and heuristic)', () => {
  for (const presupuestoRutas of [1e6, 8]) {
    const opc = { k: 6, pesos: PESOS, anchoCarretera_m: ANCHO, separacionHuellas_m: SEP_H, separacionCandidatos_m: 60, presupuestoRutas, semilla: 7 };
    const a = generarBase(terrenoMesetas(2), piezasMesetas(), VEH, opc);
    const b = generarBase(terrenoMesetas(2), piezasMesetas(), VEH, { ...opc });
    assert.equal(json(a), json(b));
  }
});

const catalogo = JSON.parse(readFileSync(new URL('../data/equipo.json', import.meta.url), 'utf8'));
const eq = (id) => catalogo.equipos.find((q) => q.id === id);

test('reactor that cannot be 1000 m from the habitat on a 500 m terrain: infeasible, separation is the reason', () => {
  const n = 20, m = 25, N = n * n;
  const t = { n, m, alturas: new Float32Array(N), capas: { sombra_permanente: new Float32Array(N) } };
  const piezas = [
    { id: 'hab', equipo: eq('habitat_superficie'), diametro_m: 6.5, criterios: [] },
    { id: 'reactor', equipo: eq('reactor_fision'), diametro_m: 3.2, criterios: [] },
  ];
  const r = generarBase(t, piezas, { limite: 20 }, { anchoCarretera_m: 6 });
  assert.equal(r.factible, false);
  assert.equal(r.restriccion.tipo, 'separacion');
  assert.equal(r.restriccion.pieza, 'reactor');
  assert.equal(r.restriccion.respecto_a, 'habitat_superficie');
  assert.equal(r.restriccion.limite, 1000);
  assert.match(r.motivo, /1000/);
  assert.equal(r.piezas, undefined);
});

test('no cell meets the pad slope: infeasible with the zone as the reason', () => {
  const n = 16, m = 10, N = n * n, alturas = new Float32Array(N);
  for (let i = 0; i < N; i++) alturas[i] = (i % n) * m * Math.tan(8 * RAD);
  const piezas = [
    { id: 'hab', equipo: eq('habitat_superficie'), diametro_m: 6.5, criterios: [] },
    { id: 'pista', equipo: eq('pista_aterrizaje'), diametro_m: 19.9, criterios: [] },
  ];
  const r = generarBase({ n, m, alturas, capas: {} }, piezas, { limite: 20 }, { anchoCarretera_m: 6 });
  assert.equal(r.factible, false);
  assert.equal(r.restriccion.tipo, 'zona');
  assert.equal(r.restriccion.pieza, 'pista');
});

test('missing layers and unmeasured requirements are listed in por_medir, weights are marked as own criterion', () => {
  const n = 24, m = 50, N = n * n, alturas = new Float32Array(N);
  for (let i = 0; i < N; i++) alturas[i] = Math.sin(i / 7);
  const piezas = [
    { id: 'hab', equipo: eq('habitat_superficie'), diametro_m: 6.5, criterios: [] },
    { id: 'torre', equipo: eq('torre_solar'), diametro_m: 6, criterios: [{ id: 'iluminacion', beneficio: true, peso: 1 }] },
    { id: 'pista', equipo: eq('pista_aterrizaje'), diametro_m: 19.9, criterios: [] },
  ];
  const r = generarBase({ n, m, alturas, capas: {} }, piezas, { limite: 20 }, { anchoCarretera_m: 6 });
  assert.equal(r.factible, true);
  const txt = r.por_medir.join('\n');
  assert.match(txt, /permanent-shadow/);
  assert.match(txt, /illumination/);
  assert.match(txt, /no public limit/);
  assert.equal(r.objetivo.origen, 'mío');
  assert.deepEqual(Object.keys(r.objetivo.pesos).sort(), ['carreteras_m3', 'plataformas_m3', 'rutas_m']);
});

test('decimated routing grid is reported and the paths still land on the full-grid cells', () => {
  const t = terrenoMesetas(3), piezas = piezasMesetas();
  const r = generarBase(t, piezas, VEH, { k: 4, pesos: PESOS, anchoCarretera_m: ANCHO, separacionHuellas_m: SEP_H, nMaxRutas: 24 });
  assert.equal(r.factible, true);
  assert.equal(r.busqueda.rejilla_rutas.n, 24);
  assert.match(r.por_medir.join('\n'), /decimated/);
  assert.deepEqual(recomprobar(t, piezas, VEH, { pesos: PESOS, anchoCarretera_m: ANCHO, separacionHuellas_m: SEP_H }, r), []);
});

// Llano 30×30 a 10 m: la única celda de «lejos» queda en la recta del hábitat; «medio» puede ir en esa recta o fuera de ella.
function terrenoCruce(conAlternativa) {
  const n = 30, m = 10, N = n * n, ilum = new Float32Array(N);
  ilum[15 * n + 3] = 0.5; ilum[15 * n + 26] = 1; ilum[15 * n + 10] = 0.75;
  if (conAlternativa) ilum[5 * n + 10] = 0.75;
  return { n, m, alturas: new Float32Array(N), capas: { iluminacion: ilum } };
}
const luz = (op, valor) => ({ variable: 'iluminacion_frac', op, valor, unidad: 'fraction' });
const piezasCruce = () => [
  { id: 'hab', equipo: { id: 'habitat_superficie', requisitos: [luz('>=', 0.45), luz('<=', 0.55)] }, diametro_m: 10, criterios: [] },
  { id: 'lejos', equipo: { id: 'x_lejos', requisitos: [luz('>=', 0.95)] }, diametro_m: 10, criterios: [] },
  { id: 'medio', equipo: { id: 'x_medio', requisitos: [luz('>=', 0.7), luz('<=', 0.8)] }, diametro_m: 10, criterios: [] },
];

test('a route never runs across another pad: the cheaper cell on the habitat line is skipped (exact and heuristic)', () => {
  for (const presupuestoRutas of [1e6, 2]) {
    const t = terrenoCruce(true), piezas = piezasCruce(), opc = { k: Infinity, anchoCarretera_m: 4, presupuestoRutas };
    const r = generarBase(t, piezas, { limite: 20 }, opc);
    assert.equal(r.factible, true);
    assert.equal(r.busqueda.metodo, presupuestoRutas === 2 ? 'heuristica' : 'exacto');
    const medio = r.piezas.find((p) => p.id === 'medio');
    assert.deepEqual([medio.fila, medio.col], [5, 10]);
    const cruces = r.restricciones.filter((q) => q.tipo === 'cruce');
    assert.equal(cruces.length, 2);
    for (const q of cruces) { assert.ok(q.holgura >= 0, `${q.pieza} vs ${q.con}: ${q.holgura}`); assert.equal(q.limite, 7); }
    assert.deepEqual(recomprobar(t, piezas, { limite: 20 }, opc, r), []);
  }
});

test('when every cell left for a piece puts it on another route, the base is infeasible and says so', () => {
  const r = generarBase(terrenoCruce(false), piezasCruce(), { limite: 20 }, { k: Infinity, anchoCarretera_m: 4 });
  assert.equal(r.factible, false);
  assert.equal(r.restriccion.tipo, 'combinacion');
  assert.match(r.motivo, /across another pad/);
});

test('a piece without requirements is never placed on water', () => {
  const n = 20, m = 10, N = n * n, agua = new Float32Array(N).fill(1);
  for (let c = 0; c < n; c++) agua[10 * n + c] = 0;
  const r = generarBase({ n, m, alturas: new Float32Array(N), capas: { agua } }, [{ id: 'hab', equipo: { id: 'habitat_superficie', requisitos: [] }, diametro_m: 10, criterios: [] }], { limite: 20 }, { anchoCarretera_m: 4 });
  assert.equal(r.factible, true);
  assert.equal(r.piezas[0].fila, 10);
  assert.equal(agua[r.piezas[0].i], 0);
});

// Llano partido por un río (columna 10) con un solo vado en la fila 2, sobre un lomo de 10 m: solo se cruza con carretera.
test('water is not a shortcut: the only dry crossing is over a steep ridge, so the link is a built road that keeps off the water', () => {
  const n = 20, m = 10, N = n * n, alturas = new Float32Array(N), agua = new Float32Array(N), ilum = new Float32Array(N);
  for (let f = 0; f < n; f++) if (f !== 2) agua[f * n + 10] = 1;
  for (const c of [9, 10, 11]) alturas[2 * n + c] = 10;
  ilum[10 * n + 3] = 0.5; ilum[10 * n + 16] = 1;
  const t = { n, m, alturas, capas: { iluminacion: ilum, agua } };
  const r = generarBase(t, piezasCruce().slice(0, 2), { limite: 20 }, { k: Infinity, anchoCarretera_m: 4 });
  assert.equal(r.factible, true, r.motivo);
  const c = r.carreteras[0];
  assert.equal(c.tipo, 'carretera');
  assert.ok(c.corte_m3 > 0);
  assert.ok(Array.from(c.traza).every((i) => agua[i] === 0), 'path over water');
  assert.ok(Array.from(c.traza).includes(2 * n + 10), 'path does not use the ford');
});
