import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';

const RAIZ = new URL('../../', import.meta.url);
const leer = (n) => JSON.parse(readFileSync(new URL(`datos_json/${n}`, RAIZ), 'utf8'));
const MISIONES = leer('misiones.json').misiones;
const CATALOGO = leer('equipo_mision.json');

const TIPOS = new Set(['rover', 'taladro', 'habitat', 'dron', 'instrumento']);
const LONGITUD = new Set(['m', 'cm', 'mm', 'ft', 'in']);
const UNIDADES_DIM = { largo: LONGITUD, ancho: LONGITUD, alto: LONGITUD, masa: new Set(['kg', 'lb']) };
const TEMPERATURA = new Set(['K', '°C', '°F']);
const VIENTO = new Set(['m/s', 'km/h', 'mph']);
const UNIDADES_LIMITE = {
  t_min_k: TEMPERATURA, t_max_k: TEMPERATURA, viento_p95_m_s: VIENTO, viento_medio_m_s: VIENTO, pendiente_grados: new Set(['deg']),
};
const MAX_BYTES = 8 * 1024 * 1024;
const PALABRAS_MIN = 5, PALABRAS_MAX = 40;

const textoLleno = (v) => typeof v === 'string' && v.trim().length > 0;
const palabras = (t) => t.trim().split(/\s+/).length;
const equipos = () => CATALOGO.misiones.flatMap((m) => m.equipos.map((e) => ({ m, e, donde: `${m.mision}/${e.id}` })));

function comprobarCita(o, donde) {
  assert.ok(textoLleno(o.fuente) && o.fuente.startsWith('https://'), `${donde}: fuente ${o.fuente}`);
  assert.ok(textoLleno(o.cita), `${donde}: cita`);
  const n = palabras(o.cita);
  assert.ok(n >= PALABRAS_MIN && n <= PALABRAS_MAX, `${donde}: cita de ${n} palabras`);
  assert.equal(typeof o.verificado, 'boolean', `${donde}: verificado`);
  if ('nota' in o) assert.ok(textoLleno(o.nota), `${donde}: nota vacía`);
}

test('every mission of misiones.json appears once, and nothing else', () => {
  const ids = CATALOGO.misiones.map((m) => m.mision);
  assert.deepEqual([...ids].sort(), MISIONES.map((m) => m.id).sort());
  for (const m of CATALOGO.misiones) assert.ok(Array.isArray(m.equipos), m.mision);
});

test('each equipment has a unique id per mission, a known type and a campaign of its mission', () => {
  const campanas = new Map(MISIONES.map((m) => [m.id, new Set(m.campanas.map((c) => c.nombre))]));
  for (const m of CATALOGO.misiones) {
    const vistos = new Set();
    for (const e of m.equipos) {
      assert.match(e.id, /^[a-z0-9_]+$/, `${m.mision}: id ${e.id}`);
      assert.ok(!vistos.has(e.id), `${m.mision}: id repetido ${e.id}`);
      vistos.add(e.id);
      assert.ok(textoLleno(e.nombre), `${m.mision}/${e.id}: nombre`);
      assert.ok(TIPOS.has(e.tipo), `${m.mision}/${e.id}: tipo ${e.tipo}`);
      assert.ok(campanas.get(m.mision).has(e.campana), `${m.mision}/${e.id}: campaña ${e.campana}`);
    }
  }
});

test('dimensions are null or a sourced positive value in a length or mass unit', () => {
  for (const { e, donde } of equipos()) {
    assert.deepEqual(Object.keys(e.dimensiones).sort(), ['alto', 'ancho', 'largo', 'masa'], donde);
    for (const [clave, d] of Object.entries(e.dimensiones)) {
      if (d === null) continue;
      assert.ok(Number.isFinite(d.valor) && d.valor > 0, `${donde}.${clave}: valor ${d.valor}`);
      assert.ok(UNIDADES_DIM[clave].has(d.unidad), `${donde}.${clave}: unidad ${d.unidad}`);
      comprobarCita(d, `${donde}.${clave}`);
    }
  }
});

test('limits use a known parameter, min or max, a matching unit and a quote', () => {
  for (const { e, donde } of equipos()) {
    assert.ok(Array.isArray(e.limites), donde);
    const vistos = new Set();
    for (const l of e.limites) {
      const d = `${donde}.${l.parametro}`;
      assert.ok(l.parametro in UNIDADES_LIMITE, `${d}: parámetro desconocido`);
      assert.ok(l.tipo === 'min' || l.tipo === 'max', `${d}: tipo ${l.tipo}`);
      assert.ok(!vistos.has(`${l.parametro}/${l.tipo}`), `${d}: límite repetido`);
      vistos.add(`${l.parametro}/${l.tipo}`);
      assert.ok(Number.isFinite(l.valor), `${d}: valor ${l.valor}`);
      assert.ok(UNIDADES_LIMITE[l.parametro].has(l.unidad), `${d}: unidad ${l.unidad}`);
      comprobarCita(l, d);
    }
  }
});

test('3D models are listed with terms of use; copied ones are .glb, 8 MB at most, without insignia and of the stated size', () => {
  for (const { e, donde } of equipos()) {
    const m = e.modelo3d;
    if (m === null) continue;
    for (const k of ['origen', 'repositorio']) assert.ok(textoLleno(m[k]) && m[k].startsWith('https://'), `${donde}: ${k}`);
    assert.ok(textoLleno(m.fichero) && textoLleno(m.formato), `${donde}: fichero y formato`);
    assert.ok(Number.isInteger(m.bytes) && m.bytes > 0, `${donde}: bytes`);
    assert.ok(m.lleva_insignia === null || typeof m.lleva_insignia === 'boolean', `${donde}: lleva_insignia`);
    comprobarCita(m.uso, `${donde}.uso`);
    if (m.sustituto_de !== undefined) {
      assert.ok(textoLleno(m.sustituto_de.equipo) && textoLleno(m.sustituto_de.motivo), `${donde}: sustituto_de`);
      comprobarCita(m.sustituto_de, `${donde}.sustituto_de`);
    }
    if (m.copiado === null) {
      assert.ok(textoLleno(m.motivo_no_copiado), `${donde}: falta motivo_no_copiado`);
      continue;
    }
    assert.equal(m.copiado, `web/data/modelos/mision/${e.id}.glb`, `${donde}: ruta`);
    assert.equal(m.formato, 'glb', donde);
    assert.equal(m.lleva_insignia, false, `${donde}: solo se copian modelos sin insignia`);
    const ruta = new URL(m.copiado, RAIZ);
    assert.ok(existsSync(ruta), `${donde}: no existe ${m.copiado}`);
    assert.equal(statSync(ruta).size, m.bytes, `${donde}: bytes`);
    assert.ok(m.bytes <= MAX_BYTES, `${donde}: pasa de 8 MB`);
  }
});
