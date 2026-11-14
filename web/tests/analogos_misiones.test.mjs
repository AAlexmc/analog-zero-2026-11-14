import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ID_NUEVA, TITULO_MAX, parametrosDe, referenciaDe, noMedidas, elegible, textoOpcion, resumenLugar, lineaResumen, validarNueva, sitiosReferencia, activaDeCatalogo, activaNueva, leerEstado, escribirEstado, conMision, opcionesBusqueda, frasesNoUsados } from '../analogos/misiones.js';
import { formatoValor, NOMBRE_CORTO, nombreCorto } from '../analogos/metricas.js';

const leer = (r) => JSON.parse(readFileSync(new URL(r, import.meta.url), 'utf8'));
const CATALOGO = leer('../data/misiones.json').misiones;
const INDICE = leer('../data/cuerpos/indice.json');
const SITIOS = leer('../data/sitios_ensayo.json').sitios;
const mision = (id) => CATALOGO.find((m) => m.id === id);
const P = Object.fromEntries([...INDICE.parametros, ...INDICE.parametros_tierra].map((p) => [p.id, p]));
const corto = (id) => nombreCorto(id, P);

const caracteristica = (parametros, medido = true) => ({ id: 'c', nombre: 'Trait', en_lista_de_partida: false, valor_texto: null, fuente: 'https://x', cita: 'q', verificado: false, parametros, medido, motivo: medido ? null : 'no layer' });
const campana = (lat, lon, extra = {}) => ({ nombre: 'Camp', organismo: 'NASA', sitio: null, sitio_texto: 'Somewhere', lat, lon, coordenadas_fuente: null, anos: '2000', fuente: 'https://x', cita: 'q', verificado: true, ...extra });
const sintetica = (extra) => ({ id: 's', nombre: 'Synthetic', que_se_prueba: 'x', cuerpo: ['mars'], grupo: 9, respaldo: 'confirmado', campanas: [], caracteristicas: [], ...extra });

test('parameters of a real mission: union of measured traits, no repeats, in index order (Moon/Mars ones first)', () => {
  assert.deepEqual(parametrosDe(mision('biomarcadores'), INDICE), ['t_max_k', 'precip_mm_ano', 'aridez_ai', 'viento_medio_m_s', 'tiempo_ciudad_h', 'litologia_glim']);
  assert.deepEqual(parametrosDe(mision('habitats_inflables'), INDICE), ['rugosidad_tan', 'relieve_m', 't_min_k', 't_media_k', 'viento_medio_m_s', 'viento_p95_m_s', 'amplitud_diurna_k', 'tiempo_ciudad_h']);
});

test('parameters: traits not measured, unknown ids and gravity (not reproducible on Earth) are left out', () => {
  const m = sintetica({ caracteristicas: [caracteristica(['elev_m', 'no_existe', 'gravedad_m_s2', 'relieve_m']), caracteristica(['relieve_m', 'elev_m']), caracteristica(['ndvi_max'], false)] });
  assert.deepEqual(parametrosDe(m, INDICE), ['relieve_m', 'elev_m']);
  assert.deepEqual(parametrosDe(sintetica({ caracteristicas: undefined }), INDICE), []);
});

test('a mission with no public source (or nothing we can measure) is listed but cannot be picked', () => {
  assert.equal(elegible(mision('polimeros_sellos'), INDICE), false);
  assert.equal(elegible(sintetica({ caracteristicas: [caracteristica([], false)] }), INDICE), false);
  assert.equal(elegible(mision('biomarcadores'), INDICE), true);
  assert.equal(textoOpcion(mision('polimeros_sellos'), 'mars', INDICE), 'Polymer and seal degradation — no public NASA source found');
  assert.equal(textoOpcion(sintetica({ caracteristicas: [caracteristica([], false)] }), 'mars', INDICE), 'Synthetic — nothing we can measure');
});

test('option text: missions for the other world stay selectable with "— Moon only" / "— Mars only"', () => {
  assert.equal(textoOpcion(mision('biomarcadores'), 'mars', INDICE), 'Life-detection instruments');
  assert.equal(textoOpcion(mision('biomarcadores'), 'moon', INDICE), 'Life-detection instruments — Mars only');
  assert.equal(textoOpcion(mision('habitats_inflables'), 'mars', INDICE), 'Inflatable habitat testing — Moon only');
  assert.equal(textoOpcion(mision('energia_soporte_vital'), 'moon', INDICE), 'Autonomous power and life support');
});

test('reference site = first campaign with lat and lon; name from the site catalogue when the campaign points to it', () => {
  assert.deepEqual(referenciaDe(mision('biomarcadores'), SITIOS), { lat: -24.0883, lon: -69.9946, nombre: 'Yungay Station, hyperarid core of the Atacama Desert, Chile', sitio: 'yungay' });
  assert.equal(referenciaDe(mision('biomarcadores')).nombre, mision('biomarcadores').campanas[0].sitio_texto);
  assert.equal(referenciaDe(mision('habitats_inflables'), SITIOS), null);
  assert.equal(referenciaDe(mision('psicologia_tripulacion'), SITIOS), null);
  // lat 0 / lon 0 is a real coordinate; a campaign with only one of the two is skipped.
  const m = sintetica({ campanas: [campana(null, 5), campana(0, 0, { sitio_texto: 'Null Island' })] });
  assert.deepEqual(referenciaDe(m, SITIOS), { lat: 0, lon: 0, nombre: 'Null Island', sitio: null });
  assert.equal(referenciaDe(mision('polimeros_sellos'), SITIOS), null);
});

test('traits named by NASA and not measured, with their reason', () => {
  const n = noMedidas(mision('biomarcadores'));
  assert.equal(n.length, 8);
  assert.deepEqual(n[0], { id: 'uv_extrema', nombre: 'Extreme UV radiation', motivo: 'No global UV layer in our set (insolacion_kwh_m2_dia is total shortwave, not UV); UV exposure only roughly tracks insolation and altitude' });
  assert.deepEqual(noMedidas(mision('polimeros_sellos')), []);
});

const par = (id, estado, d = null) => ({ id, estado, desviacion_pct: d });

test('per place: compared parameters split by the own cut-offs; missing data and unused ones are not counted', () => {
  const x = { parametros: [par('t_max_k', 'ok', 3), par('precip_mm_ano', 'ok', 15), par('aridez_ai', 'ok', 70.5), par('viento_medio_m_s', 'ok', 14.99), par('tiempo_ciudad_h', 'sin_dato_tierra'), par('litologia_glim', 'sin_referencia'), par('ndvi_max', 'no_usado')] };
  const r = resumenLugar(x);
  assert.deepEqual(r, { comparados: 4, cerca: ['t_max_k', 'viento_medio_m_s'], medio: ['precip_mm_ano'], lejos: ['aridez_ai'], sin: ['tiempo_ciudad_h'] });
  assert.equal(lineaResumen(r, corto), '2 of 4 parameters close · partly: rain and snow · far off: dryness');
});

test('per place line: all close, one parameter, nothing compared', () => {
  assert.equal(lineaResumen(resumenLugar({ parametros: [par('t_min_k', 'ok', 1), par('relieve_m', 'ok', 0)] }), corto), '2 of 2 parameters close');
  assert.equal(lineaResumen(resumenLugar({ parametros: [par('t_min_k', 'ok', 99)] }), corto), '0 of 1 parameter close · far off: night-time low');
  assert.equal(lineaResumen(resumenLugar({ parametros: [par('t_min_k', 'sin_dato_tierra')] }), corto), 'No parameter could be compared here.');
});

test('new mission: title trimmed and cut to 60 characters, at least one known parameter, index order', () => {
  assert.equal(TITULO_MAX, 60);
  assert.equal(validarNueva({ titulo: '   ', parametros: ['elev_m'] }, INDICE).ok, false);
  assert.equal(validarNueva({ titulo: 'Dust test', parametros: [] }, INDICE).ok, false);
  assert.equal(validarNueva({ titulo: 'Dust test', parametros: ['no_existe'] }, INDICE).ok, false);
  const v = validarNueva({ titulo: `  ${'é'.repeat(70)}  `, parametros: ['elev_m', 't_max_k', 'elev_m', 'gravedad_m_s2'] }, INDICE);
  assert.deepEqual(v, { ok: true, titulo: 'é'.repeat(60), parametros: ['t_max_k', 'elev_m'] });
  assert.equal(validarNueva({ titulo: '<img src=x onerror=alert(1)>', parametros: ['elev_m'] }, INDICE).titulo, '<img src=x onerror=alert(1)>');
});

test('test sites offered for a new mission: only the ones with coordinates', () => {
  const s = sitiosReferencia(SITIOS);
  assert.equal(s.length, SITIOS.filter((x) => Number.isFinite(x.lat) && Number.isFinite(x.lon)).length);
  assert.ok(s.length > 0 && s.length < SITIOS.length);
  assert.deepEqual(s.find((x) => x.id === 'yungay'), { id: 'yungay', nombre: 'Yungay Station, hyperarid core of the Atacama Desert, Chile', lat: -24.0883, lon: -69.9946 });
  assert.equal(s.find((x) => x.id === 'glenn_slope_lab'), undefined);
});

test('search options: catalogue mission with and without a test site; no mission = engine defaults', () => {
  assert.deepEqual(opcionesBusqueda(activaDeCatalogo(mision('biomarcadores'), INDICE, SITIOS)), { parametros: ['t_max_k', 'precip_mm_ano', 'aridez_ai', 'viento_medio_m_s', 'tiempo_ciudad_h', 'litologia_glim'], referencia: { lat: -24.0883, lon: -69.9946 } });
  assert.deepEqual(opcionesBusqueda(activaDeCatalogo(mision('habitats_inflables'), INDICE, SITIOS)), { parametros: parametrosDe(mision('habitats_inflables'), INDICE) });
  assert.deepEqual(opcionesBusqueda(null), {});
  const n = activaNueva({ titulo: 'Wind', parametros: ['viento_p95_m_s', 'relieve_m'], ref: 'mdrs_utah' }, INDICE, SITIOS);
  assert.deepEqual(opcionesBusqueda(n), { parametros: ['relieve_m', 'viento_p95_m_s'], referencia: { lat: 38.42, lon: -110.84 } });
  assert.equal(activaNueva({ titulo: 'Wind', parametros: ['relieve_m'], ref: 'glenn_slope_lab' }, INDICE, SITIOS).referencia, null);
  assert.equal(activaNueva({ titulo: '', parametros: ['relieve_m'] }, INDICE, SITIOS), null);
});

test('URL: catalogue mission round trip, other keys kept, unknown or unsupported id = no mission', () => {
  const q0 = new URLSearchParams('mundo=mars&lat=18.38&lon=77.58&nombre=Jezero');
  const a = activaDeCatalogo(mision('biomarcadores'), INDICE, SITIOS);
  const q = escribirEstado(q0, a);
  assert.equal(q.toString(), 'mundo=mars&lat=18.38&lon=77.58&nombre=Jezero&mision=biomarcadores');
  assert.equal(q0.has('mision'), false);
  assert.deepEqual(leerEstado(q, CATALOGO, INDICE, SITIOS), a);
  assert.equal(leerEstado(new URLSearchParams('mision=no_existe'), CATALOGO, INDICE, SITIOS), null);
  assert.equal(leerEstado(new URLSearchParams('mision=polimeros_sellos'), CATALOGO, INDICE, SITIOS), null);
  assert.equal(leerEstado(new URLSearchParams('mundo=mars'), CATALOGO, INDICE, SITIOS), null);
  assert.equal(escribirEstado(q, null).toString(), 'mundo=mars&lat=18.38&lon=77.58&nombre=Jezero');
});

test('URL: new mission round trip with an awkward title; bad parameters or site degrade, never throw', () => {
  const n = activaNueva({ titulo: 'Rover & drill, «test» 1/2', parametros: ['litologia_glim', 't_min_k', 'aridez_ai'], ref: 'yungay' }, INDICE, SITIOS);
  assert.equal(n.tipo, 'nueva');
  assert.equal(n.id, ID_NUEVA);
  const q = escribirEstado(new URLSearchParams('mundo=moon&lat=-89.9&lon=0'), n);
  assert.equal(q.get('mision'), 'nueva');
  assert.equal(q.get('titulo'), 'Rover & drill, «test» 1/2');
  assert.equal(q.get('p'), 't_min_k,aridez_ai,litologia_glim');
  assert.equal(q.get('ref'), 'yungay');
  assert.deepEqual(leerEstado(new URLSearchParams(q.toString()), CATALOGO, INDICE, SITIOS), n);
  const sinRef = leerEstado(new URLSearchParams('mision=nueva&titulo=X&p=elev_m,%20no_existe,,elev_m&ref=no_existe'), CATALOGO, INDICE, SITIOS);
  assert.deepEqual([sinRef.parametros, sinRef.ref, sinRef.referencia], [['elev_m'], null, null]);
  assert.equal(escribirEstado(new URLSearchParams(), sinRef).has('ref'), false);
  assert.equal(leerEstado(new URLSearchParams('mision=nueva&titulo=X&p=no_existe'), CATALOGO, INDICE, SITIOS), null);
  assert.equal(leerEstado(new URLSearchParams('mision=nueva&p=elev_m'), CATALOGO, INDICE, SITIOS), null);
});

test('links between the world view and the results carry the mission; no mission = the link of always', () => {
  const ir = '../analogos/index.html?mundo=moon&lat=-89.9&lon=0&nombre=South%20pole';
  assert.equal(conMision(ir, null), ir);
  assert.equal(conMision(ir, activaDeCatalogo(mision('biomarcadores'), INDICE, SITIOS)), `${ir}&mision=biomarcadores`);
  assert.equal(conMision('../explorar/index.html', activaDeCatalogo(mision('biomarcadores'), INDICE, SITIOS)), '../explorar/index.html?mision=biomarcadores');
  const n = activaNueva({ titulo: 'Rover & drill?#1 «x»', parametros: ['elev_m', 't_min_k'], ref: 'yungay' }, INDICE, SITIOS);
  const h = conMision(ir, n);
  assert.ok(h.startsWith(`${ir}&mision=nueva&`));
  const q = new URL(h, 'http://x/explorar/').searchParams;
  assert.deepEqual([q.get('mundo'), q.get('nombre'), q.get('lat')], ['moon', 'South pole', '-89.9']);
  assert.deepEqual(leerEstado(q, CATALOGO, INDICE, SITIOS), n);
});

test('parameters left out of the search are named with the reason', () => {
  const a = activaDeCatalogo(mision('biomarcadores'), INDICE, SITIOS);
  assert.deepEqual(frasesNoUsados({ sin_referencia: ['permafrost_frac', 'elev_m'], sin_dato: ['ndvi_max'] }, a, corto), ['Not used, no data at the test site: permafrost, elevation.', 'Not used, no data at your point: vegetation.']);
  assert.deepEqual(frasesNoUsados({ sin_referencia: ['viento_medio_m_s'], sin_dato: [] }, activaDeCatalogo(mision('habitats_inflables'), INDICE, SITIOS), corto), ['Not used, no test site with coordinates: mean wind.']);
  assert.deepEqual(frasesNoUsados({ sin_referencia: ['elev_m'], sin_dato: [] }, activaNueva({ titulo: 'X', parametros: ['elev_m'] }, INDICE, SITIOS), corto), ['Not used, no test site picked: elevation.']);
  assert.deepEqual(frasesNoUsados({ sin_referencia: [], sin_dato: [] }, a, corto), []);
});

test('values of the Earth-only parameters: swing is a difference in K, hours, m/s, rock class by name', () => {
  assert.equal(formatoValor(12.34, 'K', P.amplitud_diurna_k), '12.3 K');
  assert.equal(formatoValor(250, 'K', P.t_max_k), '250.0 K (−23.1 °C)');
  assert.equal(formatoValor(250, 'K'), '250.0 K (−23.1 °C)');
  assert.equal(formatoValor(0.5, 'h', P.tiempo_ciudad_h), '0.5 h');
  assert.equal(formatoValor(149.2, 'h', P.tiempo_ciudad_h), '149 h');
  assert.equal(formatoValor(3.21, 'm/s', P.viento_medio_m_s), '3.2 m/s');
  assert.equal(formatoValor(2, 'class', P.litologia_glim), 'basic volcanic');
  assert.equal(formatoValor(99, 'class', P.litologia_glim), 'rock class 99');
  assert.equal(formatoValor(null, 'class', P.litologia_glim), 'no data');
  assert.equal(formatoValor(NaN, 'K', P.amplitud_diurna_k), 'no data');
  assert.equal(formatoValor(-12, 'm', P.elev_m), '−12 m');
  // Aridez en escala log: 0.0031 no puede salir como «0.00».
  assert.equal(formatoValor(0.0031, '1', P.aridez_ai), '0.0031');
  assert.equal(formatoValor(1.234, '1', P.aridez_ai), '1.2');
  assert.equal(formatoValor(0.5, '1', P.permafrost_frac), '0.50');
});

test('every Earth-only parameter has a short name', () => {
  for (const p of INDICE.parametros_tierra) assert.ok(NOMBRE_CORTO[p.id], p.id);
});
