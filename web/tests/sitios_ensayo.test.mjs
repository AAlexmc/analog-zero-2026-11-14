import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const leer = (n) => JSON.parse(readFileSync(new URL(`../../datos_json/${n}`, import.meta.url), 'utf8'));
const catalogo = leer('sitios_ensayo.json');
const SITIOS = catalogo.sitios;
const ID_EQUIPOS = new Set(leer('equipo.json').equipos.map((e) => e.id));
const PALABRAS_MIN = 5, PALABRAS_MAX = 40;

const textoLleno = (v) => typeof v === 'string' && v.trim().length > 0;
const nuloOTexto = (v) => v === null || typeof v === 'string';

function recorrer(nodo, ruta, visita) {
  if (Array.isArray(nodo)) nodo.forEach((h, i) => recorrer(h, `${ruta}[${i}]`, visita));
  else if (nodo && typeof nodo === 'object') {
    visita(nodo, ruta);
    for (const [k, h] of Object.entries(nodo)) recorrer(h, `${ruta}.${k}`, visita);
  }
}

test('sitios is a non-empty array with unique, non-empty snake_case ids', () => {
  assert.ok(Array.isArray(SITIOS) && SITIOS.length > 0);
  const vistos = new Set();
  for (const s of SITIOS) {
    assert.ok(textoLleno(s.id), `id ${JSON.stringify(s.id)}`);
    assert.match(s.id, /^[a-z0-9_]+$/);
    assert.ok(!vistos.has(s.id), `duplicate id ${s.id}`);
    vistos.add(s.id);
  }
});

test('each site has a name, a known type and lat/lon both null or both valid finite numbers (never 0/0)', () => {
  for (const s of SITIOS) {
    assert.ok(textoLleno(s.nombre), `${s.id}: nombre`);
    assert.ok(['campo', 'laboratorio'].includes(s.tipo), `${s.id}: tipo ${s.tipo}`);
    if (s.lat === null || s.lon === null) {
      assert.equal(s.lat, null, `${s.id}: lat without lon`);
      assert.equal(s.lon, null, `${s.id}: lon without lat`);
      continue;
    }
    assert.ok(Number.isFinite(s.lat) && Math.abs(s.lat) <= 90, `${s.id}: lat ${s.lat}`);
    assert.ok(Number.isFinite(s.lon) && Math.abs(s.lon) <= 180, `${s.id}: lon ${s.lon}`);
    assert.ok(!(s.lat === 0 && s.lon === 0), `${s.id}: 0/0 used as coordinates`);
  }
});

test('each site has cuerpo (null or non-empty unique moon/mars list) and clase (terreno/operaciones for campo, null for laboratorio)', () => {
  for (const s of SITIOS) {
    for (const k of ['cuerpo', 'clase']) assert.ok(k in s, `${s.id}: missing ${k}`);
    if (s.cuerpo !== null) {
      assert.ok(Array.isArray(s.cuerpo) && s.cuerpo.length > 0, `${s.id}: cuerpo ${JSON.stringify(s.cuerpo)}`);
      for (const c of s.cuerpo) assert.ok(['moon', 'mars'].includes(c), `${s.id}: cuerpo ${c}`);
      assert.equal(new Set(s.cuerpo).size, s.cuerpo.length, `${s.id}: duplicate in cuerpo`);
    }
    if (s.tipo === 'campo') assert.ok(['terreno', 'operaciones'].includes(s.clase), `${s.id}: clase ${s.clase}`);
    else assert.equal(s.clase, null, `${s.id}: clase ${s.clase} on a laboratory`);
  }
});

test('each site has a coordenadas block; numeric coordinates carry a source and a quote, laboratories may have none', () => {
  for (const s of SITIOS) {
    const c = s.coordenadas;
    assert.ok(c && typeof c === 'object' && !Array.isArray(c), `${s.id}: coordenadas`);
    assert.equal(typeof c.texto, 'string', `${s.id}: coordenadas.texto`);
    assert.equal(typeof c.verificado, 'boolean', `${s.id}: coordenadas.verificado`);
    if (typeof s.lat === 'number') {
      assert.ok(textoLleno(c.fuente), `${s.id}: coordinates without coordenadas.fuente`);
      assert.ok(textoLleno(c.cita), `${s.id}: coordinates without coordenadas.cita`);
    }
  }
});

test('each site has campaigns with name, year, system, what was tested, limitation, related equipment and source fields', () => {
  for (const s of SITIOS) {
    assert.ok(Array.isArray(s.campanas) && s.campanas.length > 0, `${s.id}: campanas`);
    s.campanas.forEach((c, i) => {
      const donde = `${s.id}.campanas[${i}]`;
      assert.ok(textoLleno(c.nombre), `${donde}: nombre`);
      assert.ok(c.ano === null || Number.isInteger(c.ano), `${donde}: ano ${c.ano}`);
      assert.equal(typeof c.sistema, 'string', `${donde}: sistema`);
      assert.equal(typeof c.que_se_probo, 'string', `${donde}: que_se_probo`);
      assert.ok(nuloOTexto(c.limitacion_reconocida), `${donde}: limitacion_reconocida`);
      assert.ok(Array.isArray(c.equipo_relacionado), `${donde}: equipo_relacionado`);
      for (const e of c.equipo_relacionado) assert.equal(typeof e, 'string', `${donde}: equipo_relacionado ${e}`);
      for (const k of ['fuente', 'cita', 'verificado']) assert.ok(k in c, `${donde}: missing ${k}`);
      assert.ok(nuloOTexto(c.fuente), `${donde}: fuente`);
      assert.ok(nuloOTexto(c.cita), `${donde}: cita`);
      assert.equal(typeof c.verificado, 'boolean', `${donde}: verificado`);
    });
  }
});

test('every quoted source anywhere is https, quotes have 5–40 words and verificado is boolean; a null source has no quote and is not verified', () => {
  let n = 0;
  recorrer(catalogo, '$', (o, ruta) => {
    if (typeof o.fuente === 'string' && typeof o.cita === 'string') {
      n++;
      assert.ok(o.fuente.startsWith('https://'), `${ruta}: fuente ${o.fuente}`);
      const palabras = o.cita.trim().split(/\s+/).filter(Boolean).length;
      assert.ok(palabras >= PALABRAS_MIN && palabras <= PALABRAS_MAX, `${ruta}: cita has ${palabras} words`);
      assert.equal(typeof o.verificado, 'boolean', `${ruta}: verificado`);
    }
    if ('fuente' in o && o.fuente === null) {
      assert.equal(o.cita, null, `${ruta}: cita without fuente`);
      assert.equal(o.verificado, false, `${ruta}: verified without fuente`);
    }
  });
  assert.ok(n > 0);
});

test('every citas_extra entry says what it supports', () => {
  recorrer(catalogo, '$', (o, ruta) => {
    if (!('citas_extra' in o)) return;
    assert.ok(Array.isArray(o.citas_extra), `${ruta}.citas_extra`);
    o.citas_extra.forEach((x, i) => assert.ok(textoLleno(x.apoya), `${ruta}.citas_extra[${i}].apoya`));
  });
});

test('every related equipment id exists in datos_json/equipo.json', () => {
  assert.ok(ID_EQUIPOS.size > 0);
  for (const s of SITIOS) {
    s.campanas.forEach((c, i) => {
      for (const e of c.equipo_relacionado) assert.ok(ID_EQUIPOS.has(e), `${s.id}.campanas[${i}]: unknown equipment ${e}`);
    });
  }
});
