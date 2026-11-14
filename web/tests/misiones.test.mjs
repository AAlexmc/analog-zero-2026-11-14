import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const leer = (n) => JSON.parse(readFileSync(new URL(`../../datos_json/${n}`, import.meta.url), 'utf8'));
const MISIONES = leer('misiones.json').misiones;
const ID_SITIOS = new Set(leer('sitios_ensayo.json').sitios.map((s) => s.id));
const PARAMETROS = new Set([
  'rugosidad_tan', 'relieve_m', 't_max_k', 't_min_k', 't_media_k', 'insolacion_kwh_m2_dia', 'ndvi_max', 'precip_mm_ano',
  'aridez_ai', 'viento_medio_m_s', 'viento_p95_m_s', 'amplitud_diurna_k', 'permafrost_frac', 'elev_m', 'tiempo_ciudad_h', 'litologia_glim',
]);
const PALABRAS_MIN = 5, PALABRAS_MAX = 40;

const textoLleno = (v) => typeof v === 'string' && v.trim().length > 0;
const palabras = (t) => t.trim().split(/\s+/).length;

function comprobarCita(o, donde) {
  assert.ok(textoLleno(o.fuente) && o.fuente.startsWith('https://'), `${donde}: fuente ${o.fuente}`);
  assert.ok(textoLleno(o.cita), `${donde}: cita`);
  const n = palabras(o.cita);
  assert.ok(n >= PALABRAS_MIN && n <= PALABRAS_MAX, `${donde}: cita de ${n} palabras`);
  assert.equal(typeof o.verificado, 'boolean', `${donde}: verificado`);
}

test('misiones is an array with unique snake_case ids', () => {
  assert.ok(Array.isArray(MISIONES));
  const vistos = new Set();
  for (const m of MISIONES) {
    assert.match(m.id, /^[a-z0-9_]+$/);
    assert.ok(!vistos.has(m.id), `id repetido ${m.id}`);
    vistos.add(m.id);
  }
});

test('each mission has name (≤ 5 words), sentence, body, group and backing', () => {
  for (const m of MISIONES) {
    assert.ok(textoLleno(m.nombre) && palabras(m.nombre) <= 5, `${m.id}: nombre`);
    assert.ok(textoLleno(m.que_se_prueba), `${m.id}: que_se_prueba`);
    assert.ok(Array.isArray(m.cuerpo) && m.cuerpo.length > 0, `${m.id}: cuerpo`);
    for (const c of m.cuerpo) assert.ok(['moon', 'mars'].includes(c), `${m.id}: cuerpo ${c}`);
    assert.equal(new Set(m.cuerpo).size, m.cuerpo.length, `${m.id}: cuerpo repetido`);
    assert.ok(Number.isInteger(m.grupo) && m.grupo >= 1 && m.grupo <= 7, `${m.id}: grupo`);
    assert.ok(['confirmado', 'parcial', 'no_encontrado'].includes(m.respaldo), `${m.id}: respaldo`);
    assert.ok(Array.isArray(m.campanas) && Array.isArray(m.caracteristicas), `${m.id}: listas`);
  }
});

test('a mission without backing has no traits; a backed one has campaigns and traits', () => {
  for (const m of MISIONES) {
    if (m.respaldo === 'no_encontrado') assert.equal(m.caracteristicas.length, 0, m.id);
    else {
      assert.ok(m.campanas.length > 0, `${m.id}: sin campañas`);
      assert.ok(m.caracteristicas.length > 0, `${m.id}: sin características`);
    }
  }
});

test('each campaign has a known site or its own place text, valid coordinates and a quoted source', () => {
  for (const m of MISIONES) {
    m.campanas.forEach((c, i) => {
      const donde = `${m.id}.campanas[${i}]`;
      assert.ok(textoLleno(c.nombre), `${donde}: nombre`);
      assert.ok(c.organismo === null || textoLleno(c.organismo), `${donde}: organismo`);
      assert.ok(c.anos === null || textoLleno(c.anos), `${donde}: anos`);
      if (c.sitio !== null) assert.ok(ID_SITIOS.has(c.sitio), `${donde}: sitio ${c.sitio} no está en sitios_ensayo.json`);
      else assert.ok(textoLleno(c.sitio_texto), `${donde}: sin sitio ni sitio_texto`);
      assert.equal(c.lat === null, c.lon === null, `${donde}: lat y lon van juntos`);
      if (c.lat !== null) {
        assert.ok(Number.isFinite(c.lat) && Math.abs(c.lat) <= 90, `${donde}: lat`);
        assert.ok(Number.isFinite(c.lon) && Math.abs(c.lon) <= 180, `${donde}: lon`);
        assert.ok(!(c.lat === 0 && c.lon === 0), `${donde}: 0/0`);
        if (c.sitio === null) {
          assert.ok(c.coordenadas_fuente, `${donde}: coordenadas sin fuente`);
          comprobarCita(c.coordenadas_fuente, `${donde}.coordenadas_fuente`);
        }
      }
      comprobarCita(c, donde);
    });
  }
});

test('each trait has a quoted source, parameters from the contract list and a coherent medido', () => {
  for (const m of MISIONES) {
    const vistos = new Set();
    m.caracteristicas.forEach((k, i) => {
      const donde = `${m.id}.caracteristicas[${i}]`;
      assert.match(k.id, /^[a-z0-9_]+$/, `${donde}: id`);
      assert.ok(!vistos.has(k.id), `${donde}: id repetido ${k.id}`);
      vistos.add(k.id);
      assert.ok(textoLleno(k.nombre) && palabras(k.nombre) <= 5, `${donde}: nombre`);
      assert.equal(typeof k.en_lista_de_partida, 'boolean', `${donde}: en_lista_de_partida`);
      assert.ok(k.valor_texto === null || textoLleno(k.valor_texto), `${donde}: valor_texto`);
      comprobarCita(k, donde);
      assert.ok(Array.isArray(k.parametros), `${donde}: parametros`);
      for (const p of k.parametros) assert.ok(PARAMETROS.has(p), `${donde}: parámetro desconocido ${p}`);
      assert.equal(new Set(k.parametros).size, k.parametros.length, `${donde}: parámetro repetido`);
      assert.equal(k.medido, k.parametros.length > 0, `${donde}: medido no cuadra con parametros`);
      if (k.medido) assert.equal(k.motivo, null, `${donde}: motivo con medido true`);
      else assert.ok(textoLleno(k.motivo), `${donde}: falta motivo`);
    });
  }
});

