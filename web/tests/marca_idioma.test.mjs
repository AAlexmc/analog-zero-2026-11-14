import test from 'node:test';
import assert from 'node:assert/strict';
import { leerIdioma, idiomaValido, plantilla, traducir, diccionario, IDIOMAS, POR_DEFECTO, CLAVE } from '../marca/idioma.js';
import { TEXTOS, PATRONES } from '../marca/es.js';

test('language: English unless the address or the saved choice says Spanish', () => {
  assert.deepEqual(IDIOMAS, ['en', 'es']);
  assert.equal(POR_DEFECTO, 'en');
  assert.equal(CLAVE, 'analog-zero.lang');
  assert.equal(leerIdioma('', null), 'en');
  assert.equal(leerIdioma('?lang=es', null), 'es');
  assert.equal(leerIdioma('?lang=en', 'es'), 'en', 'the address wins over the saved choice');
  assert.equal(leerIdioma('?mundo=moon', 'es'), 'es');
  for (const raro of ['fr', '', 'ES', '<b>', 'null']) { assert.equal(leerIdioma(`?lang=${encodeURIComponent(raro)}`, null), 'en'); assert.equal(leerIdioma('', raro), 'en'); assert.equal(idiomaValido(raro), false); }
  assert.equal(leerIdioma(null, undefined), 'en');
});

test('template: spaces squeezed and every figure replaced, so one sentence serves any number', () => {
  assert.deepEqual(plantilla('  12 pieces\n inside 1 km '), { t: '# pieces inside # km', nums: ['12', '1'] });
  assert.deepEqual(plantilla('81.7 % match'), { t: '# % match', nums: ['81.7'] });
  assert.deepEqual(plantilla('89.4982° S'), { t: '#° S', nums: ['89.4982'] });
  assert.deepEqual(plantilla('1,234 cells · −5.2 m'), { t: '# cells · −# m', nums: ['1,234', '5.2'] });
});

test('translation: figures go back in their place, spaces around are kept, what is not in the dictionary stays as it is', () => {
  const dic = diccionario({ TEXTOS: { '# pieces inside # km': '# piezas dentro de # km', 'Moon': 'Luna', 'from # to #': 'hasta #2 desde #1', 'Play the day': 'Ver el día' },
    PATRONES: [[/^Also planted here: (.+), as on (.+)$/, 'También plantado aquí: $1, como en $2']] });
  assert.equal(traducir(' 12 pieces inside 1 km ', dic), ' 12 piezas dentro de 1 km ');
  assert.equal(traducir('from 3 to 9', dic), 'hasta 9 desde 3', 'numbered places reorder the figures');
  assert.equal(traducir('Moon', dic), 'Luna');
  assert.equal(traducir('Unknown sentence', dic), null);
  assert.equal(traducir('12.5', dic), null, 'figures alone are never touched');
  assert.equal(traducir('Also planted here: VSAT · 40 m east, as on Moon', dic), 'También plantado aquí: VSAT · 40 m east, como en Luna', 'what a pattern captures is translated when it is in the dictionary');
  const fallos = new Set();
  assert.equal(traducir('Not there 5', dic, fallos), null);
  assert.deepEqual([...fallos], ['Not there #'], 'misses are remembered by template');
  assert.equal(traducir(null, dic), null);
});

test('the Spanish dictionary: every entry keeps the figures of its English key and no key is a quotation', () => {
  const cuenta = (s) => (s.match(/#/g) ?? []).length;
  for (const [en, es] of Object.entries(TEXTOS)) {
    const k = plantilla(en).t;
    assert.equal(typeof es, 'string');
    assert.ok(es.trim().length > 0, `empty translation for "${en}"`);
    const usadas = new Set((es.match(/#\d?/g) ?? []).map((x, i) => (x.length > 1 ? +x[1] : `p${i}`)));
    assert.ok(cuenta(es) <= Math.max(cuenta(k), 0) || [...usadas].every((x) => typeof x === 'number' && x <= cuenta(k)), `"${en}" → "${es}": more figures than the English has`);
    if (cuenta(k) > 0 && !/#\d/.test(es)) assert.equal(cuenta(es), cuenta(k), `"${en}" → "${es}": the figures do not match`);
    assert.ok(!/^[“"]/.test(en), `"${en}" looks like a quotation: quotations are not translated`);
  }
  for (const [re, es] of PATRONES) { assert.ok(re instanceof RegExp); assert.equal(typeof es, 'string'); assert.ok(re.source.startsWith('^') && re.source.endsWith('$'), `${re} must match the whole text`); }
  assert.deepEqual(diccionario({ TEXTOS, PATRONES }).textos.size, new Set(Object.keys(TEXTOS).map((k) => plantilla(k).t)).size, 'two keys collapse into the same template');
});
