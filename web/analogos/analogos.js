// Resultados en la Tierra para un punto de la Luna o de Marte: globo con los mejores lugares, pestañas Places y Metrics.
import * as THREE from 'three';
import { webglDisponible, cargarMundos } from '../portada/espacio.js';
import { crearGlobo } from '../explorar/globo.js';
import { formatoLatLon } from '../explorar/geo.js';
import { cargar } from '../buscar/motor.js';
import { enlaceTerreno } from '../mapa/estado.js';
import { CORTES, NO_COMPARADO, agrupar, fmtPct, formatoValor, masCercano, lineaContexto, fraseParcial, terrenoDelPunto, minMax, pintarMapa, partesSup } from './metricas.js';
import { engancharRelieve } from '../relieve/enganche.js';

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...hijos) => { const e = Object.assign(document.createElement(tag), props); e.append(...hijos.filter((h) => h !== null && h !== undefined)); return e; };
const conSup = (s) => partesSup(s).map((p) => (p.sup ? el('sup', { textContent: p.sup }) : p.t));
const sep = () => el('span', { className: 'sep', textContent: '·' });
const q = new URLSearchParams(location.search);
const NOMBRES = { moon: 'Moon', mars: 'Mars' };
const EN = { moon: 'on the Moon', mars: 'on Mars' };
const mundo = q.get('mundo'), lat = Number(q.get('lat')), lon = Number(q.get('lon')), nombre = q.get('nombre');
const valido = mundo in NOMBRES && q.get('lat') !== null && q.get('lon') !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
const az = (window.__az ??= {});
const A = (az.analogos = { listo: false, errores: [], mundo: valido ? mundo : null, lat: valido ? lat : null, lon: valido ? lon : null, nombre: valido ? nombre : null, r: null, sel: null });
const fallo = (e) => A.errores.push(String(e?.message ?? e));

if (!valido) {
  $('origen').textContent = 'No place picked yet.';
  $('estado').textContent = 'Pick a world and a place first.';
  A.listo = true;
} else {
  await montar();
}

async function montar() {
  const volver = `../explorar/index.html?mundo=${mundo}&lat=${q.get('lat')}&lon=${q.get('lon')}`;
  $('volver').href = volver; $('otro').href = volver;
  const coords = formatoLatLon(lat, lon).texto;
  $('origen').replaceChildren(`Your place ${EN[mundo]}`, ...(nombre ? [sep(), el('strong', { textContent: nombre })] : []), sep(), el('span', { className: 'marca-num', textContent: coords }));
  document.title = `Analog Zero · Earth analogs for ${nombre ?? coords}`;
  $('estado').classList.add('cargando');

  const [mundos, sitios, terrenos, M] = await Promise.all([
    cargarMundos('../data/cuerpos/mundos.json').catch((e) => { fallo(e); return []; }),
    fetch('../data/sitios_ensayo.json').then((r) => r.json()).then((j) => j.sitios ?? []).catch((e) => { fallo(e); return []; }),
    cargarTerrenos().catch((e) => { fallo(e); return []; }),
    cargar('../data/cuerpos/').catch((e) => { fallo(e); return null; }),
  ]);
  const tierra = mundos.find((m) => m.id === 'earth');
  if (tierra) $('credito').textContent = `Image: ${tierra.credito}`;

  let G = null;
  if (webglDisponible() && tierra) {
    G = crearGlobo({ canvas: $('globo'), panel: $('panel'), mundo: tierra, vista0: { lat: 25, lon: 10 }, arriba: () => ($('mandos').hidden ? 0 : $('mandos').getBoundingClientRect().bottom + 6) });
    A.vista = { camara: G.camara, aPantalla: G.aPantalla, animando: G.animando, latLonDePixel: G.latLonDePixel };
    $('reiniciar').addEventListener('click', () => (A.sel ? G.mirar(lugarSel()) : G.reiniciar()));
  } else document.body.classList.add('sin-webgl');

  if (!M) {
    $('estado').classList.remove('cargando');
    $('estado').textContent = 'Could not load the Earth data. Reload the page to try again.';
    A.listo = true;
    return;
  }
  const P = Object.fromEntries(M.indice.parametros.map((p) => [p.id, p]));
  const logaritmicos = M.indice.parametros.filter((p) => p.reproducible_en_tierra && p.transformacion !== 'lineal').map((p) => p.nombre.toLowerCase());
  const r = M.buscar(M.leerPunto(mundo, lat, lon));
  A.r = r;
  A.parametros = P;
  $('estado').classList.remove('cargando');
  $('estado').hidden = !!r.resultados.length;
  if (!r.resultados.length) $('estado').textContent = 'No place on Earth could be compared with this point.';
  $('pestanas').hidden = false;
  $('mandos').hidden = !G;

  const lunaresConCentro = terrenos.filter((t) => t.cuerpo === 'luna');
  const objetivoLunar = mundo === 'moon' ? terrenoDelPunto(lat, lon, lunaresConCentro, M.indice.cuerpos.moon.radio_km) : null;
  const lunares = lunaresConCentro.map((t) => t.id);
  const tierraTerrenos = terrenos.filter((t) => t.cuerpo === 'tierra');
  const lugarSel = () => (A.sel ? r[A.sel.lista][A.sel.k] : null);
  $('ver-relieve').hidden = !(r.resultados.length || r.parciales.length);
  engancharRelieve({ boton: $('ver-relieve'), aviso: $('relieve-aviso'), mundo: 'earth', punto: () => { const x = lugarSel(); return x && { lat: x.lat, lon: x.lon, celda: { lat: x.lat, lon: x.lon }, titulo: `${A.sel.lista === 'resultados' ? `Place ${A.sel.k + 1}` : 'Partly compared place'} · ${formatoLatLon(x.lat, x.lon).texto}` }; } });

  function tarjeta(x, k, lista) {
    const c = masCercano(x.lat, x.lon, sitios);
    const t = masCercano(x.lat, x.lon, tierraTerrenos);
    const li = el('li', { className: 'tarjeta' },
      el('span', { className: 'num', textContent: lista === 'resultados' ? String(k + 1) : '·' }),
      el('p', { className: 'pct' }, el('span', { textContent: fmtPct(x.similitud_pct) }), el('small', { textContent: 'match' })),
      el('p', { className: 'coords marca-num', textContent: formatoLatLon(x.lat, x.lon).texto }),
      lista === 'parciales' ? el('p', { className: 'parcial', textContent: fraseParcial(x) }) : null,
      el('p', { className: `contexto${c ? ' conocido' : ''}`, textContent: lineaContexto(c) }),
      el('div', { className: 'acciones' },
        el('button', { type: 'button', className: 'marca-boton', textContent: 'See metrics', onclick: (e) => { e.stopPropagation(); elegir(lista, k); verPestana('metricas'); } }),
        t ? el('a', { className: 'marca-boton secundario', textContent: 'Open detailed terrain', href: `../${enlaceTerreno(t.item.id, objetivoLunar, lunares).href}`, onclick: (e) => e.stopPropagation() }) : null));
    li.dataset.lista = lista; li.dataset.k = k;
    li.tabIndex = 0;
    li.addEventListener('click', () => elegir(lista, k));
    li.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === li) elegir(lista, k); });
    return li;
  }
  $('lista').replaceChildren(...r.resultados.map((x, k) => tarjeta(x, k, 'resultados')));
  $('parciales').hidden = !r.parciales.length;
  $('lista-parciales').replaceChildren(...r.parciales.map((x, k) => tarjeta(x, k, 'parciales')));

  // Números sobre el globo, colocados en cada fotograma.
  const numeros = r.resultados.map((x, k) => {
    const b = el('button', { type: 'button', textContent: String(k + 1), title: `Place ${k + 1}: ${fmtPct(x.similitud_pct)} match` });
    b.addEventListener('click', () => elegir('resultados', k));
    $('numeros').append(b);
    return b;
  });
  if (G) G.alDibujar(() => {
    const p = $('panel').getBoundingClientRect(), m = $('mandos').getBoundingClientRect();
    const sel = A.sel?.lista === 'resultados' ? A.sel.k : -1;
    const puestos = [];
    // El elegido primero; luego por número. Uno que pisa a otro ya puesto se oculta (sigue en la lista).
    for (const k of [sel, ...numeros.keys()].filter((k, i, a) => k >= 0 && a.indexOf(k) === i)) {
      const b = numeros[k], s = G.aPantalla(r.resultados[k].lat, r.resultados[k].lon);
      const dentro = (q) => s.x > q.left - 16 && s.x < q.right + 16 && s.y > q.top - 16 && s.y < q.bottom + 16;
      b.hidden = !s.visible || dentro(p) || (!$('mandos').hidden && dentro(m)) || s.y < 72 || puestos.some((o) => Math.hypot(o.x - s.x, o.y - s.y) < 26);
      if (b.hidden) continue;
      puestos.push(s);
      b.style.transform = `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px)`;
    }
  });

  // Capa de similitud: rejilla del motor pintada con la rampa de la marca sobre una esfera un poco mayor.
  const mm = minMax(r.mapa);
  A.leyenda = mm;
  let capa = null;
  $('capa').addEventListener('change', () => {
    const on = $('capa').checked;
    if (on && !capa && G && mm) {
      const g = M.indice.rejilla, cv = el('canvas', { width: g.ancho, height: g.alto });
      cv.getContext('2d').putImageData(new ImageData(pintarMapa(r.mapa, mm.min, mm.max, 205, M.tierra), g.ancho, g.alto), 0, 0);
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      capa = new THREE.Mesh(new THREE.SphereGeometry(1.002, 192, 96), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
      capa.name = 'similitud';
      G.escena.add(capa);
    }
    if (capa) capa.visible = on;
    G?.pedir();
    $('leyenda').hidden = !on || !mm;
    if (mm) { $('ley-min').textContent = fmtPct(mm.min); $('ley-max').textContent = fmtPct(mm.max); }
    A.capa = on;
  });

  function elegir(lista, k) {
    A.sel = { lista, k };
    document.querySelectorAll('.tarjeta').forEach((t) => t.setAttribute('aria-current', String(t.dataset.lista === lista && Number(t.dataset.k) === k)));
    numeros.forEach((b, i) => b.setAttribute('aria-current', String(lista === 'resultados' && i === k)));
    G?.mirar(lugarSel(), A.listo ? Math.min(G.camara.position.length(), 2) : undefined);
    pintarMetricas();
  }

  function verPestana(id) {
    $('panel').dataset.pestana = id;
    for (const [t, s] of [['tab-lugares', 'lugares'], ['tab-metricas', 'metricas']]) {
      $(t).setAttribute('aria-selected', String(s === id));
      $(s).hidden = s !== id;
    }
    $('panel').scrollTop = 0;
  }
  $('tab-lugares').addEventListener('click', () => verPestana('lugares'));
  $('tab-metricas').addEventListener('click', () => verPestana('metricas'));

  const fuente = (lado, f) => {
    if (!f) return null;
    return el('p', {}, el('strong', { textContent: `${lado}: ` }), f.texto ?? '', ...(f.url ? [' ', el('a', { href: f.url, target: '_blank', rel: 'noopener', textContent: 'source' })] : []));
  };
  function fila(x) {
    const p = P[x.id], d = x.desviacion_pct;
    const det = el('details', { className: 'fila' });
    det.dataset.id = x.id;
    const valores = el('dl', { className: 'valores' },
      el('dt', { textContent: NOMBRES[mundo] }), el('dd', {}, ...conSup(formatoValor(x.valor_objetivo, p.unidad))),
      el('dt', { textContent: 'Earth' }), el('dd', {}, ...conSup(formatoValor(x.valor_tierra, p.unidad))));
    valores.children[1].dataset.v = 'objetivo'; valores.children[3].dataset.v = 'tierra';
    const desv = el('span', { className: 'desv', textContent: d === null ? 'no data' : `${fmtPct(d)} off` });
    desv.dataset.v = 'desv';
    const barra = el('span', { className: 'barra' }, el('span', { style: `width:${d === null ? 0 : Math.max(1, d).toFixed(1)}%` }));
    det.append(el('summary', {}, el('span', { className: 'nombre', textContent: p.nombre }), desv, valores, barra),
      el('div', { className: 'detalle' },
        el('p', { textContent: p.definicion }),
        p.aviso ? el('p', {}, el('strong', { textContent: 'Not quite the same measure: ' }), p.aviso) : null,
        fuente(NOMBRES[mundo], p.fuentes?.[mundo]), fuente('Earth', p.fuentes?.earth)));
    return det;
  }
  const grupo = (clase, titulo, corte, filas, vacio) => {
    const s = el('section', { className: `grupo ${clase}` }, el('h3', { textContent: titulo }), el('p', { className: 'corte', textContent: corte }));
    s.dataset.grupo = clase;
    if (filas.length) s.append(...filas.map(fila)); else s.append(el('p', { className: 'vacio', textContent: vacio }));
    return s;
  };

  function pintarMetricas() {
    const x = lugarSel(), caja = $('metricas');
    if (!x) { caja.replaceChildren(el('p', { className: 'tenue', textContent: 'Pick a place in the list first.' })); return; }
    const g = agrupar(x.parametros.filter((p) => p.estado === 'ok' || p.estado === 'sin_dato_tierra'));
    const num = A.sel.lista === 'resultados' ? `Place ${A.sel.k + 1}` : 'Partly compared place';
    const total = el('p', { className: 'met-total' }, el('span', { textContent: fmtPct(x.similitud_pct) }), el('small', { textContent: 'match' }));
    total.dataset.v = 'total';
    const sinDato = r.sin_dato.map((id) => P[id]?.nombre ?? id);
    const noRepro = x.no_reproducibles.map((n) => {
      const vo = el('span', { className: 'valor' }, ...conSup(formatoValor(n.valor_objetivo, P[n.id].unidad)));
      const vt = el('span', { className: 'valor' }, ...conSup(formatoValor(n.valor_tierra, P[n.id].unidad)));
      vo.dataset.v = 'objetivo'; vt.dataset.v = 'tierra';
      const li = el('li', {}, el('strong', { textContent: `${P[n.id].nombre}:` }), ` ${NOMBRES[mundo]} `, vo, sep(), 'Earth ', vt);
      li.dataset.id = n.id;
      return li;
    });
    caja.replaceChildren(...[
      el('p', { className: 'met-lugar' }, num, sep(), el('span', { className: 'marca-num', textContent: formatoLatLon(x.lat, x.lon).texto })),
      total,
      el('p', { className: 'met-que', textContent: `Average of the ${x.comparados} parameters we could compare${x.comparados < x.de ? ` (of ${x.de})` : ''}. Our own metric — not a probability.` }),
      el('details', { className: 'como' }, el('summary', { textContent: 'How we measure' }),
        el('p', {}, 'For each parameter: ', el('code', { textContent: 'deviation % = min(100, |f(Earth) − f(your point)| / (f(max) − f(min)) × 100)' }), '.'),
        el('p', { textContent: `f is the scale of the parameter: logarithmic for ${logaritmicos.join(', ')}; plain for the rest. [min, max] is the range from the 1st to the 99th percentile of Earth land and of the Moon and Mars.` }),
        el('p', { textContent: 'Match % = 100 − deviation %. The match of a place is the average over the parameters with data there, all with the same weight.' }),
        el('p', { textContent: `Groups: under ${CORTES.cerca} % deviation is a close match, over ${CORTES.lejos} % is far off (own cut-offs). Gravity and air pressure are shown apart and do not count.` })),
      sinDato.length ? el('p', { className: 'sin-dato', textContent: `No data at your point for: ${sinDato.join(', ')}.` }) : null,
      el('div', { className: 'grupos' },
        grupo('cerca', 'Close match — test this here', `deviation under ${CORTES.cerca} % (own cut-offs)`, g.cerca, 'Nothing this close.'),
        grupo('lejos', 'Far off — compensate in the lab', `deviation over ${CORTES.lejos} % (own cut-offs)`, g.lejos, 'Nothing this far off.')),
      grupo('medio', 'Partly similar', `deviation ${CORTES.cerca}–${CORTES.lejos} % (own cut-offs)`, g.medio, 'Nothing in between.'),
      g.sin.length ? grupo('sin', 'No Earth data here', 'not counted in the match', g.sin, '') : null,
      el('section', { className: 'bloque no-repro' }, el('h3', { textContent: 'Earth cannot reproduce this' }), el('ul', {}, ...noRepro),
        el('p', { textContent: 'No place on Earth has this gravity or this air pressure, so there is no percentage here.' })),
      el('section', { className: 'bloque no-comparado' }, el('h3', { textContent: 'Not compared yet' }), el('ul', {}, ...NO_COMPARADO.map((t) => el('li', { textContent: t }))),
        el('p', { textContent: 'no global layer in this version' })),
    ].filter(Boolean));
  }

  verPestana('lugares');
  if (r.resultados.length) elegir('resultados', 0);
  if (G) A.textura = await G.texturaLista;
  await document.fonts.ready;
  A.listo = true;
}

async function cargarTerrenos() {
  const idx = await fetch('../data/terreno/index.json').then((r) => r.json());
  const metas = await Promise.all((idx.terrenos ?? []).map((t) => fetch(`../data/terreno/${encodeURIComponent(t.id)}/meta.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null)));
  return (idx.terrenos ?? []).map((t, i) => ({ id: t.id, cuerpo: t.cuerpo, nombre: t.nombre, lado_km: t.lado_km, lat: metas[i]?.centro?.lat ?? null, lon: metas[i]?.centro?.lon ?? null }));
}
