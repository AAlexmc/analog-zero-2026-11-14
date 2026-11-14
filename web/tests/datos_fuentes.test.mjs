import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MUNDOS, GRUPOS, SECCIONES, gruposDe, entradas, porGrupo, porParametro } from '../datos/fuentes.js';

const leer = (r) => JSON.parse(readFileSync(new URL(`../data/${r}`, import.meta.url), 'utf8'));
const INDICE = leer('cuerpos/indice.json');
const SITIO = leer('sitio/indice.json');
const LISTA = entradas(INDICE, SITIO);

test('every source in the indexes becomes one row, with its text and link as they are', () => {
  let esperadas = 0;
  for (const p of INDICE.parametros) esperadas += Object.keys(MUNDOS).filter((m) => p.fuentes?.[m]).length;
  for (const p of INDICE.parametros_tierra) esperadas += p.fuentes?.earth ? 1 : 0;
  for (const w of Object.values(SITIO.mundos)) esperadas += (w.criterios ?? []).filter((c) => c.fuente_dato).length;
  assert.equal(LISTA.length, esperadas);
  const p = INDICE.parametros.find((x) => x.id === 'ndvi_max');
  const e = LISTA.find((x) => x.id === 'ndvi_max' && x.mundo === 'earth');
  assert.equal(e.texto, p.fuentes.earth.texto);
  assert.equal(e.url, p.fuentes.earth.url);
  assert.equal(e.seccion, 'comparado');
  for (const x of LISTA) {
    assert.ok(Object.keys(MUNDOS).includes(x.mundo), x.mundo);
    assert.ok(SECCIONES.some((s) => s.id === x.seccion), x.seccion);
    assert.ok(x.url === null || x.url.startsWith('https://'), x.url);
    assert.equal(x.propio, x.seccion !== 'sitio' && [...INDICE.parametros, ...INDICE.parametros_tierra].find((p) => p.id === x.id)?.fuentes?.[x.mundo]?.origen === 'mío');
  }
});

test('own computations keep their label; a value set by definition has no link', () => {
  const luna = LISTA.find((x) => x.id === 'ndvi_max' && x.mundo === 'moon');
  assert.equal(luna.propio, true);
  assert.equal(luna.url, null);
  assert.ok(LISTA.some((x) => x.propio) && LISTA.some((x) => !x.propio));
});

test('grouping rules: Worldview/GIBS, PDS, LRO, other NASA, others', () => {
  assert.deepEqual(gruposDe({ url: 'https://wvs.earthdata.nasa.gov/api/v1/snapshot?x=1', texto: 'NASA GIBS MODIS' }), ['earthdata', 'gibs']);
  assert.deepEqual(gruposDe({ url: 'https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/x.img', texto: 'own computation on LOLA LDEM_64' }), ['pds', 'lro']);
  assert.deepEqual(gruposDe({ url: 'https://pgda.gsfc.nasa.gov/data/MoonIllumination/A.TIF', texto: 'LRO LOLA average solar illumination' }), ['lro']);
  assert.deepEqual(gruposDe({ url: 'https://pds-geosciences.wustl.edu/mgs/x.img', texto: 'MGS MOLA MEGDR' }), ['pds']);
  assert.deepEqual(gruposDe({ url: 'https://power.larc.nasa.gov', texto: 'NASA POWER' }), ['nasa']);
  assert.deepEqual(gruposDe({ url: 'https://nasa-power.s3.us-west-2.amazonaws.com/x.zarr', texto: 'NASA POWER MERRA-2' }), ['nasa']);
  assert.deepEqual(gruposDe({ url: 'https://doi.org/10.21954/ou.rd.24573205.v3', texto: 'OpenMARS reanalysis' }), ['otras']);
  assert.deepEqual(gruposDe({ url: null, texto: '0 by definition' }), ['otras']);
});

test('real data: each of the four archives the jury asked about has at least one dataset, and no dataset is lost', () => {
  const g = porGrupo(LISTA);
  assert.deepEqual(g.map((x) => x.id), GRUPOS.map((x) => x.id));
  for (const id of ['earthdata', 'gibs', 'pds', 'lro']) assert.ok(g.find((x) => x.id === id).fuentes.length > 0, id);
  const unicas = new Set(LISTA.filter((e) => e.texto || e.url).map((e) => `${e.url ?? ''}\n${e.texto ?? ''}`));
  const vistas = new Set(g.flatMap((x) => x.fuentes.map((f) => `${f.url ?? ''}\n${f.texto ?? ''}`)));
  assert.equal(vistas.size, unicas.size);
  const lro = g.find((x) => x.id === 'lro').fuentes;
  assert.ok(lro.some((f) => f.usos.some((u) => u.endsWith('(Moon)'))));
});

test('table by parameter: one row per parameter, one cell per world, empty where the world has none', () => {
  const filas = porParametro(LISTA, 'comparado');
  assert.equal(filas.length, INDICE.parametros.filter((p) => p.reproducible_en_tierra).length);
  for (const f of filas) for (const m of Object.keys(MUNDOS)) assert.ok(f.celdas[m] === null || f.celdas[m].mundo === m);
  const tierra = porParametro(LISTA, 'solo_tierra');
  assert.equal(tierra.length, INDICE.parametros_tierra.length);
  for (const f of tierra) assert.equal(f.celdas.moon, null);
});
