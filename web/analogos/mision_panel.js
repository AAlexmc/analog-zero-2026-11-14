// Objetivo de misión en pantalla: selector, formulario «New mission», ficha y mes («When»). Lo usan la pantalla del mundo y resultados, con los mismos ids.
import { CORTES, nombreCorto } from './metricas.js';
import { formatoLatLon } from '../explorar/geo.js';
import { ID_NUEVA, comparables, elegible, textoOpcion, misionesDe, noMedidas, sitiosReferencia, validarNueva, activaDeCatalogo, activaNueva, escribirEstado } from './misiones.js';
import { MESES_LARGO, escribirMes } from './meses.js';

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...hijos) => { const e = Object.assign(document.createElement(tag), props); e.append(...hijos.filter((h) => h !== null && h !== undefined)); return e; };
const EN = { moon: 'on the Moon', mars: 'on Mars' };

const ligaFuente = (href) => el('a', { href, target: '_blank', rel: 'noopener', textContent: 'source' });
function campana(c, sitios) {
  return el('li', {}, el('strong', { textContent: c.nombre }), el('br'),
    [c.sitio_texto ?? sitios.find((x) => x.id === c.sitio)?.nombre, c.anos].filter(Boolean).join(' · '), ' ',
    c.fuente ? ligaFuente(c.fuente) : null,
    c.verificado === false ? el('span', {}, ' ', el('span', { className: 'marca-chip', textContent: 'source not verified' })) : null,
    c.cita ? el('details', {}, el('summary', { textContent: 'Quote' }), el('blockquote', { textContent: c.cita })) : null);
}

// Ficha de la misión elegida: lo que dice el catálogo. avisos (solo en resultados): lo que la búsqueda no pudo usar;
// sin avisos la ficha no habla de resultados.
export function pintarFicha({ activa, P, sitios, avisos = null }) {
  const f = $('mision-ficha');
  f.hidden = !activa;
  if (!activa) { f.replaceChildren(); return; }
  const m = activa.mision, nueva = activa.tipo === 'nueva', ref = activa.referencia, enResultados = avisos !== null;
  const corto = (id) => nombreCorto(id, P);
  const chip = (id) => {
    const c = el('li', { className: `marca-chip${P[id].solo_tierra ? ' tierra' : ''}`, textContent: corto(id), title: P[id].solo_tierra ? `${P[id].nombre}: Earth only, compared with the test site` : P[id].nombre });
    c.dataset.id = id;
    return c;
  };
  const lineaRef = !activa.parametros.some((id) => P[id].solo_tierra) ? null
    : ref ? `Earth-only parameters are compared with ${nueva ? 'the test site you picked' : "NASA's test site"}: ${ref.nombre} (${formatoLatLon(ref.lat, ref.lon).texto})`
      : nueva ? 'No test site picked: Earth-only parameters are not used.' : 'No test site with coordinates: Earth-only parameters are not used.';
  const nm = m ? noMedidas(m) : [];
  const campanas = m?.campanas ?? [];
  f.replaceChildren(...[
    nueva ? el('p', { className: 'mision-titulo', textContent: activa.titulo }) : null,
    nueva ? el('p', { className: 'tenue', textContent: 'Your own mission: parameters picked by hand.' }) : el('p', { className: 'mision-que', textContent: m.que_se_prueba }),
    campanas.length ? el('details', { className: 'como campanas-caja solo-fondo' }, el('summary', { textContent: `NASA ran this at (${campanas.length} ${campanas.length === 1 ? 'campaign' : 'campaigns'})` }),
      el('ul', { className: 'campanas' }, ...campanas.map((c) => campana(c, sitios)))) : null,
    el('p', { className: 'mision-sub' }, enResultados ? 'Searched with these parameters' : 'Parameters for the Earth search', ...(nueva ? [] : [' ', el('span', { className: 'marca-chip solo-fondo', textContent: 'own mapping', title: 'Which of our layers stands for each trait NASA names is our own criterion.' })])),
    el('ul', { className: 'chips' }, ...activa.parametros.map(chip)),
    activa.ampliada ? el('p', { className: 'tenue ampliada solo-fondo', textContent: 'This mission only names Earth-side traits, so the search also compares every parameter with your point (own choice).' }) : null,
    activa.sinPunto ? el('p', { className: 'tenue ampliada', textContent: 'None of these parameters uses your point: every place that matches the test site ties.' }) : null,
    lineaRef ? el('p', { className: `ref${ref ? ' solo-fondo' : ''}`, textContent: lineaRef }) : null,
    enResultados ? el('p', { className: 'tenue solo-fondo', textContent: `On each place: close = under ${CORTES.cerca} % off, far off = over ${CORTES.lejos} % off (own cut-offs).` }) : null,
    nm.length ? el('details', { className: 'como no-medido-caja' }, el('summary', { textContent: `Named by NASA, NOT MEASURED here (${nm.length})` }),
      el('ul', { className: 'no-medido' }, ...nm.map((n) => el('li', {}, el('strong', { textContent: `${n.nombre}: ` }), n.motivo ?? 'not public')))) : null,
    ...(avisos ?? []).map((t) => el('p', { className: 'aviso', textContent: t })),
    nueva ? el('button', { type: 'button', className: 'marca-boton secundario', id: 'mision-cambiar', textContent: 'Change this mission', onclick: () => { $('mision-nueva').hidden = false; } }) : null,
  ].filter(Boolean));
}

// Selector y formulario «New mission». alCambiar(activa) tras elegir o enviar el formulario, con la URL ya al día.
export function montarMision({ misiones, indice, sitios, mundo, activa, alCambiar }) {
  let actual = activa;
  const P = Object.fromEntries(comparables(indice).map((p) => [p.id, p]));
  const guardarUrl = () => history.replaceState(history.state, '', `${location.pathname}?${escribirEstado(new URLSearchParams(location.search), actual)}`);
  // Solo las misiones de este mundo; una de otro mundo que llegue en la URL se queda, rotulada.
  $('mision').append(...misionesDe(misiones, mundo, actual?.id).filter((m) => m.id !== ID_NUEVA).map((m) => el('option', { value: m.id, textContent: textoOpcion(m, mundo, indice), disabled: !elegible(m, indice) })),
    el('option', { value: ID_NUEVA, textContent: 'New mission…' }));
  $('mision').value = actual?.id ?? '';
  $('nueva-punto-titulo').textContent = `Compared with your point ${EN[mundo]}`;
  const casilla = (p) => {
    const l = el('label', { className: 'casilla' }, el('input', { type: 'checkbox', value: p.id }), el('span', { textContent: p.nombre }));
    l.dataset.id = p.id;
    return l;
  };
  $('nueva-punto').append(...comparables(indice).filter((p) => !p.solo_tierra).map(casilla));
  $('nueva-tierra').querySelector('legend').after(...comparables(indice).filter((p) => p.solo_tierra).map(casilla));
  $('mision-ref').append(...sitiosReferencia(sitios).map((s) => el('option', { value: s.id, textContent: s.nombre })));
  const marcados = () => [...$('mision-nueva').querySelectorAll('input[type=checkbox]:checked')].map((i) => i.value);
  function revisarNueva() {
    const v = validarNueva({ titulo: $('mision-titulo').value, parametros: marcados() }, indice);
    $('mision-buscar').disabled = !v.ok;
    $('nueva-ref-nota').hidden = !(v.parametros.some((id) => P[id].solo_tierra) && !$('mision-ref').value);
  }
  function rellenarNueva(a) {
    $('mision-titulo').value = a?.titulo ?? '';
    for (const i of $('mision-nueva').querySelectorAll('input[type=checkbox]')) i.checked = !!a?.parametros.includes(i.value);
    $('mision-ref').value = a?.ref ?? '';
    revisarNueva();
  }
  $('mision-nueva').addEventListener('input', revisarNueva);
  $('mision-nueva').addEventListener('change', revisarNueva);
  $('mision-nueva').addEventListener('submit', (e) => {
    e.preventDefault();
    const a = activaNueva({ titulo: $('mision-titulo').value, parametros: marcados(), ref: $('mision-ref').value }, indice, sitios);
    if (!a) return;
    actual = a;
    $('mision-nueva').hidden = true;
    guardarUrl();
    alCambiar(actual);
  });
  $('mision').addEventListener('change', () => {
    const v = $('mision').value;
    $('mision-nueva').hidden = v !== ID_NUEVA;
    if (v === ID_NUEVA) rellenarNueva(null);
    const antes = actual;
    actual = v && v !== ID_NUEVA ? activaDeCatalogo(misiones.find((m) => m.id === v), indice, sitios) : null;
    if (!antes && !actual) return;
    guardarUrl();
    alCambiar(actual);
  });
  rellenarNueva(actual?.tipo === 'nueva' ? actual : null);
  $('mision-caja').hidden = false;
}

// Selector «When» del mismo bloque: alCambiar(mes) con la URL ya al día; null = año entero. poner(mes) lo cambia desde fuera sin avisar.
export function montarMes({ mes, alCambiar }) {
  const s = $('mes');
  s.append(...MESES_LARGO.map((n, k) => el('option', { value: String(k + 1), textContent: n })));
  s.value = mes ? String(mes) : '';
  const poner = (m) => {
    s.value = m ? String(m) : '';
    history.replaceState(history.state, '', `${location.pathname}?${escribirMes(new URLSearchParams(location.search), m)}`);
  };
  s.addEventListener('change', () => { const m = s.value ? Number(s.value) : null; poner(m); alCambiar(m); });
  return { poner };
}
