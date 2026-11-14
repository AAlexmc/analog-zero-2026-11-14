// Resultados en la Tierra para un punto de la Luna o de Marte: globo con los mejores lugares, pestañas Places y Metrics.
import * as THREE from 'three';
import { webglDisponible, cargarMundos } from '../portada/espacio.js';
import { crearGlobo } from '../explorar/globo.js';
import { formatoLatLon } from '../explorar/geo.js';
import { cargar } from '../buscar/motor.js';
import { enlaceTerreno } from '../mapa/estado.js';
import { CORTES, NO_COMPARADO, NO_COMPARADO_MISION, agrupar, fmtPct, formatoValor, masCercano, lineaContexto, fraseParcial, terrenoDelPunto, minMax, pintarMapa, partesSup, RADIO_CONTEXTO_KM, sitiosConCoordenadas, fraseUnlisted, letra, nombreCorto, titularCartera, fraseSinCubrir, reglaCartera, lineaEntorno, comoSabemos, COLORES_CLASE, pintarClases, tablaComparar, lineaDistancia, textoComponentes, enlaceWorldview, colorRampa, SIN_COMPARAR } from './metricas.js';
import { engancharRelieve } from '../relieve/enganche.js';
import { enlaceSimulacion } from '../terreno/lugar.js';
import { paisDe } from './paises.js';
import { resumenLugar, lineaResumen, leerEstado, conMision, opcionesBusqueda, frasesNoUsados } from './misiones.js';
import { montarMision, pintarFicha as fichaMision, montarMes } from './mision_panel.js';
import { MESES_CORTO, MESES_LARGO, MARGEN, nombreMes, leerMes, escribirMes, conMes, idsMensuales, rachas, planRepetir, moverEnMes, fraseRepetir, lineaMejorPeor, lineaMesActivo, etiquetaMes, escalaTiras } from './meses.js';

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

  const [mundos, sitios, terrenos, M, paises, misiones] = await Promise.all([
    cargarMundos('../data/cuerpos/mundos.json').catch((e) => { fallo(e); return []; }),
    fetch('../data/sitios_ensayo.json').then((r) => r.json()).then((j) => j.sitios ?? []).catch((e) => { fallo(e); return []; }),
    cargarTerrenos().catch((e) => { fallo(e); return []; }),
    cargar('../data/cuerpos/').catch((e) => { fallo(e); return null; }),
    fetch('../data/paises_110m.json').then((r) => r.json()).then((j) => j.paises ?? []).catch((e) => { fallo(e); return []; }),
    fetch('../data/misiones.json').then((r) => r.json()).then((j) => j.misiones ?? []).catch((e) => { fallo(e); return []; }),
  ]);
  const tierra = mundos.find((m) => m.id === 'earth');
  if (tierra) $('credito').textContent = `Image: ${tierra.credito}. Country borders: Natural Earth (public domain).`;
  const pais = (x) => paisDe(x.lat, x.lon, paises);
  const lineaPais = (x) => { const n = pais(x); return n ? el('p', { className: 'pais', textContent: n }) : null; };

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
  const P = Object.fromEntries([...M.indice.parametros, ...(M.indice.parametros_tierra ?? [])].map((p) => [p.id, p]));
  const logaritmicos = M.indice.parametros.filter((p) => p.reproducible_en_tierra && p.transformacion !== 'lineal').map((p) => p.nombre.toLowerCase());
  const objetivo = M.leerPunto(mundo, lat, lon);
  // Objetivo de misión (misiones.js): elige los parámetros de la búsqueda; sin misión, los de siempre.
  let activa = leerEstado(q, misiones, M.indice, sitios);
  // Mes («When», docs/metrica-analogos.md «Meses»): null = año entero. tiras: los 12 meses ya se enseñan en las tarjetas.
  let mes = leerMes(q), tiras = false;
  const cargados = new Set();
  const opcs = () => (mes === null ? opcionesBusqueda(activa) : { ...opcionesBusqueda(activa), mes });
  const idsUso = () => idsMensuales(opcionesBusqueda(activa), M.indice);
  const mesesListos = () => idsUso().every((id) => cargados.has(id));
  const avisoMes = (texto, cargando = false) => { $('mes-estado').hidden = !texto; $('mes-estado').textContent = texto ?? ''; $('mes-estado').classList.toggle('cargando', cargando); };
  // Baja solo los ficheros mensuales que usa la búsqueda; sin red o sin fichero → false y aviso llano.
  async function asegurarMeses(texto) {
    const faltan = idsUso().filter((id) => !cargados.has(id));
    if (!faltan.length) return true;
    avisoMes(texto, true);
    $('mes').disabled = true;
    A.mesEstado = 'cargando';
    try {
      await M.cargarMeses(faltan);
      faltan.forEach((id) => cargados.add(id));
      avisoMes(null);
      A.mesEstado = 'ok';
      return true;
    } catch (e) {
      A.mesFallo = String(e?.message ?? e);
      A.mesEstado = 'fallo';
      avisoMes(mes === null ? 'Could not download the climate month by month. Try again later.' : 'Could not download the climate for that month. Showing the whole year.');
      return false;
    } finally {
      $('mes').disabled = false;
      A.mesesCargados = [...cargados];
    }
  }
  if (mes !== null && !(await asegurarMeses("Loading this month's climate…"))) {
    mes = null;
    history.replaceState(history.state, '', `${location.pathname}?${escribirMes(new URLSearchParams(location.search), null)}`);
  }
  tiras = mes !== null;
  A.mes = mes;
  // «Back to the globe» y «Pick another place» vuelven con la misión y el mes puestos.
  const enlacesVolver = () => { const h = conMes(conMision(volver, activa), mes); $('volver').href = h; $('otro').href = h; };
  enlacesVolver();
  const corto = (id) => nombreCorto(id, P);
  const rotuloRef = () => (activa?.tipo === 'nueva' ? 'Test site' : 'NASA test site');
  let r = M.buscar(objetivo, opcs());
  let r0 = r;
  let cart = M.cartera(objetivo, opcs());
  A.r = r;
  A.cartera = cart;
  A.mision = activa;
  A.clase = M.claseDe(objetivo);
  const lineaE = lineaEntorno(A.clase, M.clases?.clases.length);
  $('entorno').hidden = !lineaE;
  if (lineaE) {
    $('entorno-linea').textContent = lineaE;
    $('entorno-linea').classList.toggle('fuera', !A.clase.dentro);
    $('capa-clases').closest('label').hidden = !G;
    $('entorno-texto').replaceChildren(...comoSabemos(M.clases, A.clase).map((t) => el('p', { textContent: t })));
    $('leyenda-clases').replaceChildren(...M.clases.clases.map((c) => {
      const li = el('li', { className: c.id === A.clase.id ? 'cercano' : '' },
        el('span', { className: 'muestra', style: `background:${COLORES_CLASE[c.id]}` }),
        el('span', {}, el('span', { className: 'rotulo', textContent: c.rotulo }),
          el('span', { className: 'tenue', textContent: ` ${c.pct_area.toFixed(1)} % of grouped land${c.id === A.clase.id ? ' · closest to your point' : ''}` })));
      li.dataset.id = c.id;
      return li;
    }), el('li', {}, el('span', { className: 'muestra sin-clase' }), el('span', { className: 'tenue', textContent: 'not grouped (ice cap or missing data)' })));
  }
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
  const listaDe = (lista) => (lista === 'cartera' ? cart.lugares : r[lista]);
  const lugarSel = () => (A.sel ? listaDe(A.sel.lista)[A.sel.k] : null);
  const rotuloSel = () => ({ resultados: `Place ${A.sel.k + 1}`, parciales: 'Partly compared place', cartera: `Portfolio place ${letra(A.sel.k)}` })[A.sel.lista];
  $('ver-relieve').hidden = !(r.resultados.length || r.parciales.length || cart.lugares.length);
  // La vista de terreno ocupa el hueco del globo: el panel sigue a la vista para pulsar otro lugar (en móvil, pantalla entera).
  const hueco = () => { const p = $('panel').getBoundingClientRect(); return p.width >= innerWidth - 2 ? { right: 0, bottom: 0 } : { right: Math.max(0, innerWidth - p.left), bottom: 0 }; };
  // «Generate simulation»: del terreno del lugar al visor con las dos vistas; la misión y el mes viajan en la URL.
  const simular = (p) => ({ texto: 'Generate simulation', href: conMes(conMision(`../${enlaceSimulacion({ lat: p.lat, lon: p.lon, nombre: p.titulo, lunar: objetivoLunar })}`, activa), mes) });
  const relieve = engancharRelieve({ boton: $('ver-relieve'), aviso: $('relieve-aviso'), mundo: 'earth', hueco, accion: simular, punto: () => { const x = lugarSel(); return x && { lat: x.lat, lon: x.lon, celda: { lat: x.lat, lon: x.lon }, titulo: `${rotuloSel()} · ${formatoLatLon(x.lat, x.lon).texto}` }; } });
  $('panel').addEventListener('transitionend', (e) => { if (e.target === $('panel')) relieve.encajar(); });
  const fotograma = () => new Promise((ok) => requestAnimationFrame(ok));
  // Tras pulsar un lugar: cuando el globo termina de girar y ampliar, se abre su terreno sin más clics.
  let turno = 0;
  async function terrenoDe(lista, k) {
    if (!G || A.autoTerreno === false) return;
    const t = ++turno;
    A.terrenoAuto = 'esperando';
    do await fotograma(); while (t === turno && (G.animando() || az.relieve?.estado === 'cargando'));
    if (t !== turno || A.sel?.lista !== lista || A.sel.k !== k) return;
    relieve.cerrar();
    A.terrenoAuto = 'abriendo';
    const ok = await relieve.abrir();
    if (t !== turno) { relieve.cerrar(); return; }
    A.terrenoAuto = ok ? 'abierto' : 'fallo';
  }
  const pulsar = (lista, k) => { elegir(lista, k); terrenoDe(lista, k); };

  // Sitio conocido a menos de 300 km, o «unlisted»: solo quiere decir fuera de NUESTRO catálogo.
  const nSitios = sitiosConCoordenadas(sitios);
  const contexto = (c) => [
    el('p', { className: `contexto${c ? ' conocido' : ''}`, textContent: lineaContexto(c, nSitios) }),
    c ? null : el('span', { className: 'marca-chip unlisted', textContent: 'unlisted', title: `No analog site from our catalogue within ${RADIO_CONTEXTO_KM} km` }),
  ];
  // Con misión: cuántos parámetros comparados quedan cerca y cuáles no (cortes propios de Metrics).
  const resumen = (x) => (activa ? el('p', { className: 'resumen', textContent: lineaResumen(resumenLugar(x), corto), title: `Close: under ${CORTES.cerca} % off; far off: over ${CORTES.lejos} % off (own cut-offs)` }) : null);
  const worldview = (x) => { const href = enlaceWorldview(x.lat, x.lon); return href && el('a', { className: 'otro worldview', href, target: '_blank', rel: 'noopener', textContent: 'Open in NASA Worldview', onclick: (e) => e.stopPropagation() }); };
  function tarjeta(x, k, lista) {
    const c = masCercano(x.lat, x.lon, sitios);
    const t = masCercano(x.lat, x.lon, tierraTerrenos);
    const li = el('li', { className: 'tarjeta' },
      el('span', { className: 'num', textContent: lista === 'resultados' ? String(k + 1) : '·' }),
      el('p', { className: 'pct' }, el('span', { textContent: fmtPct(x.similitud_pct) }), el('small', { textContent: 'match' })),
      lineaPais(x),
      el('p', { className: 'coords marca-num', textContent: formatoLatLon(x.lat, x.lon).texto }),
      resumen(x),
      lista === 'parciales' ? el('p', { className: 'parcial', textContent: fraseParcial(x) }) : null,
      ...contexto(c),
      lineaDistancia(x.distancia_componentes, M.clases?.d_ref.valor) ? el('p', { className: 'distancia marca-num', textContent: lineaDistancia(x.distancia_componentes, M.clases.d_ref.valor) }) : null,
      el('div', { className: 'acciones' },
        el('button', { type: 'button', className: 'marca-boton', textContent: 'See metrics', onclick: (e) => { e.stopPropagation(); elegir(lista, k); verPestana('metricas'); } }),
        t ? el('a', { className: 'marca-boton secundario', textContent: 'Open detailed terrain', href: `../${enlaceTerreno(t.item.id, objetivoLunar, lunares).href}`, onclick: (e) => e.stopPropagation() }) : null,
        worldview(x)));
    li.dataset.lista = lista; li.dataset.k = k;
    li.tabIndex = 0;
    li.addEventListener('click', () => pulsar(lista, k));
    li.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === li) pulsar(lista, k); });
    return li;
  }
  function pintarLista() {
    $('lista').replaceChildren(...r.resultados.map((x, k) => tarjeta(x, k, 'resultados')));
    const unlisted = fraseUnlisted(r.resultados.filter((x) => !masCercano(x.lat, x.lon, sitios)).length, r.resultados.length, nSitios);
    $('unlisted').hidden = !unlisted;
    $('unlisted').textContent = unlisted ?? '';
  }
  pintarLista();
  $('parciales').hidden = !r.parciales.length;
  $('lista-parciales').replaceChildren(...r.parciales.map((x, k) => tarjeta(x, k, 'parciales')));

  // Cartera: el menor conjunto de lugares que entre todos cubren cada parámetro cubrible.
  function tarjetaCartera(x, k) {
    const li = el('li', { className: 'tarjeta cartera-lugar' },
      el('span', { className: 'num letra', textContent: letra(k) }),
      el('p', { className: 'pct' }, el('span', { textContent: fmtPct(x.similitud_pct) }), el('small', { textContent: 'match' })),
      lineaPais(x),
      el('p', { className: 'coords marca-num', textContent: formatoLatLon(x.lat, x.lon).texto }),
      resumen(x),
      x.comparados < x.de ? el('p', { className: 'parcial', textContent: fraseParcial(x) }) : null,
      ...contexto(masCercano(x.lat, x.lon, sitios)),
      el('p', { className: 'cubre-titulo', textContent: 'Close match here for' }),
      el('ul', { className: 'chips' }, ...x.cubre.map((id) => {
        const d = x.parametros.find((p) => p.id === id)?.desviacion_pct;
        const c = el('li', { className: 'marca-chip', textContent: nombreCorto(id, P), title: `${P[id].nombre}: ${fmtPct(d)} off` });
        c.dataset.id = id;
        return c;
      })),
      el('div', { className: 'acciones' }, worldview(x)));
    li.dataset.lista = 'cartera'; li.dataset.k = k;
    li.tabIndex = 0;
    li.addEventListener('click', () => pulsar('cartera', k));
    li.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === li) pulsar('cartera', k); });
    return li;
  }
  function pintarCartera() {
    $('cartera-titular').textContent = titularCartera(cart);
    $('cartera-como').replaceChildren($('cartera-como').querySelector('summary'), ...reglaCartera(cart).map((t) => el('p', { textContent: t })));
    $('lista-cartera').replaceChildren(...cart.lugares.map(tarjetaCartera));
    $('sin-cubrir').replaceChildren($('sin-cubrir').querySelector('h3'), ...[cart.sin_cubrir.length
      ? el('ul', {}, ...cart.sin_cubrir.map((s) => {
        const li = el('li', {}, el('strong', { textContent: `${P[s.id].nombre}. ` }),
          el('span', { className: 'cerca', textContent: fraseSinCubrir(s, s.lat === null ? '' : `${formatoLatLon(s.lat, s.lon).texto}${pais(s) ? ` (${pais(s)})` : ''}`) }), ' ',
          el('span', { className: 'lab', textContent: 'Test this in a lab or a chamber.' }));
        li.dataset.id = s.id;
        return li;
      }))
      : el('p', { textContent: 'Every parameter is covered by at least one place above.' }),
    cart.sin_dato.length ? el('p', { textContent: `No data at your point for: ${cart.sin_dato.map((id) => P[id].nombre).join(', ')}. Not counted.` }) : null].filter(Boolean));
  }
  pintarCartera();

  // Tira de 12 meses en cada tarjeta (con los meses cargados): rampa de la capa de similitud, una escala para todas las tiras.
  function tira(perfil, esc) {
    const den = esc && esc.max > esc.min ? esc.max - esc.min : 1;
    const ol = el('ol', { className: 'tira' }, ...perfil.map((p) => {
      const v = p.similitud_pct;
      const li = el('li', { className: `mes${p.mes === mes ? ' activo' : ''}`, title: etiquetaMes(p) },
        el('span', { className: `casilla${v === null ? ' sin' : ''}`, style: `background:${v === null || !esc ? SIN_COMPARAR : `rgb(${colorRampa((v - esc.min) / den).join(',')})`}` }),
        el('span', { className: 'inicial', textContent: MESES_CORTO[p.mes - 1][0] }));
      li.setAttribute('aria-label', etiquetaMes(p));
      li.lastChild.setAttribute('aria-hidden', 'true');
      if (p.mes === mes) li.setAttribute('aria-current', 'true');
      li.dataset.mes = p.mes;
      return li;
    }));
    ol.setAttribute('aria-label', 'Match month by month');
    return el('div', { className: 'tira-caja' }, ol,
      el('p', { className: 'tira-linea', textContent: lineaMejorPeor(perfil) ?? 'No monthly data here.' }),
      mes !== null ? el('p', { className: 'tira-linea activo', textContent: lineaMesActivo(perfil, mes) }) : null);
  }
  function ponerTiras() {
    const ver = (mes !== null || tiras) && mesesListos();
    document.querySelectorAll('.tira-caja').forEach((t) => t.remove());
    $('ver-meses').hidden = ver || !(r.resultados.length || r.parciales.length || cart.lugares.length);
    $('tiras-escala').hidden = true;
    A.tiras = ver;
    if (!ver) return;
    const o = opcionesBusqueda(activa);
    const tarjetas = [...document.querySelectorAll('#lista > .tarjeta, #lista-parciales > .tarjeta, #lista-cartera > .tarjeta')];
    const perfiles = tarjetas.map((t) => { const x = listaDe(t.dataset.lista)[Number(t.dataset.k)]; return M.perfilMensual(objetivo, { lat: x.lat, lon: x.lon }, o); });
    const esc = escalaTiras(perfiles);
    tarjetas.forEach((t, i) => t.querySelector('.acciones').before(tira(perfiles[i], esc)));
    if (esc) {
      $('tiras-escala').hidden = false;
      $('tiras-escala').textContent = `Month strips: colours as in the similarity layer, from the lowest (${fmtPct(esc.min)}) to the highest (${fmtPct(esc.max)}) monthly match of these places.`;
    }
  }
  ponerTiras();

  // Números (Places, Metrics) o letras (Portfolio) sobre el globo, colocados en cada fotograma.
  let numeros = [];
  const crearNumeros = () => {
    numeros.forEach((b) => b.remove());
    numeros = r.resultados.map((x, k) => {
      const b = el('button', { type: 'button', textContent: String(k + 1), title: `Place ${k + 1}: ${fmtPct(x.similitud_pct)} match` });
      b.addEventListener('click', () => pulsar('resultados', k));
      $('numeros').append(b);
      return b;
    });
  };
  crearNumeros();

  // Avanzado: el mismo top 5 con la métrica por componentes (los parámetros que van juntos cuentan una vez).
  $('avanzado').hidden = !M.clases || !!activa || mes !== null;
  if (M.clases) $('avanzado-texto').replaceChildren(...textoComponentes(M.clases).map((t) => el('p', { textContent: t })));
  let rComp = null;
  $('por-componentes').addEventListener('change', () => {
    const on = $('por-componentes').checked;
    if (on) {
      rComp ??= M.buscar(objetivo, { metrica: 'componentes' });
      if (!rComp.resultados.length) { $('por-componentes').checked = false; return; }
      r = { ...r0, resultados: rComp.resultados.map((x) => ({ ...x, similitud_pct: x.similitud_parametros_pct })) };
    } else r = r0;
    A.r = r;
    A.porComponentes = $('por-componentes').checked;
    pintarLista();
    ponerTiras();
    crearNumeros();
    elegir('resultados', 0);
  });
  let letras = [];
  const crearLetras = () => {
    letras.forEach((b) => b.remove());
    letras = cart.lugares.map((x, k) => {
      const b = el('button', { type: 'button', className: 'letra', textContent: letra(k), title: `Portfolio place ${letra(k)}: ${fmtPct(x.similitud_pct)} match` });
      b.hidden = true;
      b.addEventListener('click', () => pulsar('cartera', k));
      $('numeros').append(b);
      return b;
    });
  };
  crearLetras();
  if (G) G.alDibujar(() => {
    const p = $('panel').getBoundingClientRect(), m = $('mandos').getBoundingClientRect();
    const enCartera = $('panel').dataset.pestana === 'cartera';
    const [botones, lugares, lista] = enCartera ? [letras, cart.lugares, 'cartera'] : [numeros, r.resultados, 'resultados'];
    for (const b of enCartera ? numeros : letras) b.hidden = true;
    const sel = A.sel?.lista === lista ? A.sel.k : -1;
    const puestos = [];
    // El elegido primero; luego por número. Uno que pisa a otro ya puesto se oculta (sigue en la lista).
    for (const k of [sel, ...botones.keys()].filter((k, i, a) => k >= 0 && a.indexOf(k) === i)) {
      const b = botones[k], s = G.aPantalla(lugares[k].lat, lugares[k].lon);
      const dentro = (q) => s.x > q.left - 16 && s.x < q.right + 16 && s.y > q.top - 16 && s.y < q.bottom + 16;
      b.hidden = !s.visible || dentro(p) || (!$('mandos').hidden && dentro(m)) || s.y < 72 || puestos.some((o) => Math.hypot(o.x - s.x, o.y - s.y) < 26);
      if (b.hidden) continue;
      puestos.push(s);
      b.style.transform = `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px)`;
    }
  });

  // Capa de similitud: rejilla del motor pintada con la rampa de la marca sobre una esfera un poco mayor.
  let mm = minMax(r.mapa);
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
      A.capaLienzo = cv;
      G.escena.add(capa);
    }
    if (capa) capa.visible = on;
    G?.pedir();
    $('leyenda').hidden = !on || !mm;
    if (mm) { $('ley-min').textContent = fmtPct(mm.min); $('ley-max').textContent = fmtPct(mm.max); }
    A.capa = on;
    if (on && $('capa-clases').checked) { $('capa-clases').checked = false; $('capa-clases').dispatchEvent(new Event('change')); }
  });

  // Tipos de entorno de la Tierra (earth/clase.f32): una capa a la vez con la de similitud.
  let capaClases = null;
  $('capa-clases').addEventListener('change', async () => {
    const on = $('capa-clases').checked;
    if (on && $('capa').checked) { $('capa').checked = false; $('capa').dispatchEvent(new Event('change')); }
    if (on && !capaClases && G && M.clases) {
      try {
        const g = M.indice.rejilla, buf = await fetch(`../data/cuerpos/${M.clases.capa}`).then((x) => { if (!x.ok) throw new Error(`HTTP ${x.status}: ${M.clases.capa}`); return x.arrayBuffer(); });
        const dv = new DataView(buf), clase = new Float32Array(g.ancho * g.alto);
        if (buf.byteLength !== clase.length * 4) throw new Error(`${M.clases.capa}: ${buf.byteLength} bytes`);
        for (let i = 0; i < clase.length; i++) clase[i] = dv.getFloat32(i * 4, true);
        const cv = el('canvas', { width: g.ancho, height: g.alto });
        cv.getContext('2d').putImageData(new ImageData(pintarClases(clase, COLORES_CLASE, 225, M.tierra), g.ancho, g.alto), 0, 0);
        const tex = new THREE.CanvasTexture(cv);
        tex.colorSpace = THREE.SRGBColorSpace;
        capaClases = new THREE.Mesh(new THREE.SphereGeometry(1.002, 192, 96), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
        capaClases.name = 'clases';
        G.escena.add(capaClases);
      } catch (e) {
        fallo(e);
        $('capa-clases').checked = false;
      }
    }
    if (capaClases) capaClases.visible = $('capa-clases').checked;
    G?.pedir();
    A.capaClases = $('capa-clases').checked;
  });

  function elegir(lista, k) {
    turno++;
    A.terrenoAuto = null;
    relieve.cerrar();
    A.sel = { lista, k };
    document.querySelectorAll('.tarjeta').forEach((t) => t.setAttribute('aria-current', String(t.dataset.lista === lista && Number(t.dataset.k) === k)));
    numeros.forEach((b, i) => b.setAttribute('aria-current', String(lista === 'resultados' && i === k)));
    letras.forEach((b, i) => b.setAttribute('aria-current', String(lista === 'cartera' && i === k)));
    G?.mirar(lugarSel(), A.listo ? Math.min(G.camara.position.length(), 2) : undefined);
    if (lista !== 'cartera') { A.metSel = { lista, k }; pintarMetricas(); }
    if ($('panel').dataset.pestana === 'calendario') pintarCalendario();
  }

  function verPestana(id) {
    $('panel').dataset.pestana = id;
    for (const [t, s] of [['tab-lugares', 'lugares'], ['tab-metricas', 'metricas'], ['tab-cartera', 'cartera'], ['tab-calendario', 'calendario']]) {
      $(t).setAttribute('aria-selected', String(s === id));
      $(s).hidden = s !== id;
    }
    $('panel').scrollTop = 0;
    // El globo sigue a la pestaña: la cartera enseña sus letras; al volver, el lugar de Metrics.
    if (id === 'cartera' && A.sel?.lista !== 'cartera' && cart.lugares.length) elegir('cartera', 0);
    else if (id !== 'cartera' && A.sel?.lista === 'cartera' && A.metSel) elegir(A.metSel.lista, A.metSel.k);
    if (id === 'calendario') pintarCalendario();
    G?.pedir();
  }
  $('tab-lugares').addEventListener('click', () => verPestana('lugares'));
  $('tab-metricas').addEventListener('click', () => verPestana('metricas'));
  $('tab-cartera').addEventListener('click', () => verPestana('cartera'));
  $('tab-calendario').addEventListener('click', () => verPestana('calendario'));

  const fuente = (lado, f) => {
    if (!f) return null;
    return el('p', {}, el('strong', { textContent: `${lado}: ` }), f.texto ?? '', ...(f.url ? [' ', el('a', { href: f.url, target: '_blank', rel: 'noopener', textContent: 'source' })] : []));
  };
  function fila(x) {
    const p = P[x.id], d = x.desviacion_pct;
    const det = el('details', { className: 'fila' });
    det.dataset.id = x.id;
    // Con mes: la Tierra de un parámetro mensual lleva el mes; el punto de la Luna/Marte sigue en su valor anual.
    const mensual = mes !== null && !!r.mensuales?.includes(x.id);
    const valores = el('dl', { className: 'valores' },
      el('dt', { textContent: x.origen_objetivo === 'referencia' ? `${rotuloRef()}${mensual ? `, ${nombreMes(mes)}` : ''}` : `${NOMBRES[mundo]}${mes !== null ? ' (year average)' : ''}` }), el('dd', {}, ...conSup(formatoValor(x.valor_objetivo, p.unidad, p))),
      el('dt', { textContent: mensual ? `Earth, ${nombreMes(mes)}` : 'Earth' }), el('dd', {}, ...conSup(formatoValor(x.valor_tierra, p.unidad, p))));
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

  // Tabla lado a lado del punto y los lugares; plegada, recuerda si estaba abierta.
  const reproducibles = M.indice.parametros.filter((p) => p.reproducible_en_tierra).map((p) => p.id);
  function comparar() {
    if (!r.resultados.length) return null;
    const n = r.resultados.length;
    const det = el('details', { className: 'comparar', open: !!A.compararAbierto }, el('summary', { textContent: `Compare the ${n} places side by side` }),
      el('p', { className: 'tenue', textContent: 'Each cell: the Earth value and how far off it is. The closest place in each row is marked.' }));
    det.addEventListener('toggle', () => { A.compararAbierto = det.open; });
    const filas = tablaComparar(r.resultados, activa ? r.usados : reproducibles).map((f) => {
      const mensual = mes !== null && !!r.mensuales?.includes(f.id);
      const rotuloObj = P[f.id].solo_tierra ? `${rotuloRef()}${mensual ? `, ${nombreMes(mes)}` : ''}` : mes !== null ? 'year average' : null;
      const tr = el('tr', {}, el('th', { scope: 'row', title: P[f.id].nombre }, nombreCorto(f.id, P), mensual ? el('small', { className: 'mes-fila', textContent: `Earth: ${nombreMes(mes)}` }) : null),
        el('td', { className: 'objetivo' }, ...conSup(formatoValor(f.objetivo, P[f.id].unidad, P[f.id])), rotuloObj ? el('small', { textContent: rotuloObj }) : null),
        ...f.celdas.map((c) => el('td', { className: c.mejor ? 'mejor' : '', title: c.mejor ? `Closest of the ${n}` : '' },
          el('span', { className: 'valor' }, ...conSup(formatoValor(c.valor, P[f.id].unidad, P[f.id]))),
          el('span', { className: 'desv', textContent: c.desv === null ? 'no data' : `${fmtPct(c.desv)} off` }))));
      tr.dataset.id = f.id;
      return tr;
    });
    det.append(el('div', { className: 'tabla-scroll' }, el('table', { className: 'tabla-comparar' },
      el('thead', {}, el('tr', {}, el('th', { scope: 'col', textContent: 'Parameter' }), el('th', { scope: 'col', textContent: `Your point (${NOMBRES[mundo]})` }),
        ...r.resultados.map((x, k) => el('th', { scope: 'col' }, `Place ${k + 1}`, el('small', { className: 'pais', textContent: pais(x) ?? '' }), el('small', { className: 'marca-num', textContent: formatoLatLon(x.lat, x.lon).texto }))))),
      el('tbody', {}, ...filas))));
    return det;
  }

  // Solo con misión y parámetros solo-Tierra en uso (docs/metrica-analogos.md, «Parámetros solo-Tierra y referencia»).
  function fraseSoloTierra() {
    const ids = activa ? r.usados.filter((id) => P[id].solo_tierra) : [];
    if (!ids.length) return null;
    const logs = ids.filter((id) => P[id].transformacion === 'log10' || P[id].transformacion === 'log1p').map(corto);
    const cat = ids.filter((id) => P[id].transformacion === 'categoria').map(corto);
    return el('p', { textContent: [`Earth-only parameters (${ids.map(corto).join(', ')}): the target is the Earth value at the test site, and [min, max] is from Earth land only`,
      logs.length ? `logarithmic for ${logs.join(', ')}` : null,
      cat.length ? `${cat.join(', ')}: 0 % if the class is the same, 100 % if not (own criterion)` : null].filter(Boolean).join('; ') + '.' });
  }

  function pintarMetricas() {
    const x = A.metSel ? r[A.metSel.lista][A.metSel.k] : null, caja = $('metricas');
    if (!x) { caja.replaceChildren(el('p', { className: 'tenue', textContent: 'Pick a place in the list first.' })); return; }
    const g = agrupar(x.parametros.filter((p) => p.estado === 'ok' || p.estado === 'sin_dato_tierra'));
    const num = A.metSel.lista === 'resultados' ? `Place ${A.metSel.k + 1}` : 'Partly compared place';
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
      mes !== null ? el('p', { className: 'mes-nota', textContent: r.mensuales?.length
        ? `Earth in ${nombreMes(mes)}: ${r.mensuales.map(corto).join(', ')} are ${nombreMes(mes)} values (the average ${nombreMes(mes)} of many years). The rest, and your point ${EN[mundo]}, are year averages.`
        : `Earth in ${nombreMes(mes)}: none of these parameters has a monthly version, so this is the whole-year match.` }) : null,
      el('details', { className: 'como' }, el('summary', { textContent: 'How we measure' }),
        el('p', {}, 'For each parameter: ', el('code', { textContent: 'deviation % = min(100, |f(Earth) − f(your point)| / (f(max) − f(min)) × 100)' }), '.'),
        el('p', { textContent: `f is the scale of the parameter: logarithmic for ${logaritmicos.join(', ')}; plain for the rest. [min, max] is the range from the 1st to the 99th percentile of Earth land and of the Moon and Mars.` }),
        el('p', { textContent: 'Match % = 100 − deviation %. The match of a place is the average over the parameters with data there, all with the same weight.' }),
        el('p', { textContent: `Groups: under ${CORTES.cerca} % deviation is a close match, over ${CORTES.lejos} % is far off (own cut-offs). Gravity and air pressure are shown apart and do not count.` }),
        fraseSoloTierra()),
      comparar(),
      sinDato.length ? el('p', { className: 'sin-dato', textContent: `No data at your point for: ${sinDato.join(', ')}.` }) : null,
      el('div', { className: 'grupos' },
        grupo('cerca', 'Close match — test this here', `deviation under ${CORTES.cerca} % (own cut-offs)`, g.cerca, 'Nothing this close.'),
        grupo('lejos', 'Far off — compensate in the lab', `deviation over ${CORTES.lejos} % (own cut-offs)`, g.lejos, 'Nothing this far off.')),
      grupo('medio', 'Partly similar', `deviation ${CORTES.cerca}–${CORTES.lejos} % (own cut-offs)`, g.medio, 'Nothing in between.'),
      g.sin.length ? grupo('sin', 'No Earth data here', 'not counted in the match', g.sin, '') : null,
      el('section', { className: 'bloque no-repro' }, el('h3', { textContent: 'Earth cannot reproduce this' }), el('ul', {}, ...noRepro),
        el('p', { textContent: 'No place on Earth has this gravity or this air pressure, so there is no percentage here.' })),
      el('section', { className: 'bloque no-comparado' }, el('h3', { textContent: 'Not compared yet' }), el('ul', {}, ...(activa ? NO_COMPARADO_MISION : NO_COMPARADO).map((t) => el('li', { textContent: t }))),
        el('p', { textContent: 'no global layer in this version' })),
    ].filter(Boolean));
  }

  // Ficha de la misión elegida (mision_panel.js) con lo que el motor no pudo usar.
  const pintarFicha = () => fichaMision({ activa, P, sitios, avisos: activa ? frasesNoUsados(r, activa, corto) : [] });

  // Mes activo: chip y título de Places; sin mes, como siempre.
  function rotularMes() {
    $('mes-activo').hidden = mes === null;
    $('mes-activo-chip').textContent = mes === null ? '' : `Earth in ${nombreMes(mes)}`;
    $('lugares').querySelector('h1').textContent = mes === null ? 'Most similar places on Earth' : `Most similar places on Earth in ${nombreMes(mes)}`;
  }
  rotularMes();

  // Al cambiar de misión o de mes se recalcula todo lo que sale de la búsqueda; el tipo de entorno no depende de ella.
  function repintar() {
    const o = opcs();
    A.mes = mes;
    rotularMes();
    calCache = null;
    r0 = r = M.buscar(objetivo, o);
    cart = M.cartera(objetivo, o);
    rComp = null;
    $('por-componentes').checked = false;
    A.porComponentes = false;
    $('avanzado').hidden = !M.clases || !!activa || mes !== null;
    A.r = r; A.cartera = cart; A.mision = activa;
    $('estado').hidden = !!r.resultados.length;
    if (!r.resultados.length) $('estado').textContent = activa ? 'No place on Earth could be compared with these parameters.' : 'No place on Earth could be compared with this point.';
    $('ver-relieve').hidden = !(r.resultados.length || r.parciales.length || cart.lugares.length);
    pintarLista();
    $('parciales').hidden = !r.parciales.length;
    $('lista-parciales').replaceChildren(...r.parciales.map((x, k) => tarjeta(x, k, 'parciales')));
    pintarCartera();
    ponerTiras();
    crearNumeros();
    crearLetras();
    if (capa) { G.escena.remove(capa); capa.geometry.dispose(); capa.material.map.dispose(); capa.material.dispose(); capa = null; A.capaLienzo = null; }
    mm = minMax(r.mapa);
    A.leyenda = mm;
    $('capa').dispatchEvent(new Event('change'));
    pintarFicha();
    turno++;
    A.terrenoAuto = null;
    relieve.cerrar();
    A.sel = null; A.metSel = null;
    if (r.resultados.length) elegir('resultados', 0); else pintarMetricas();
    if ($('panel').dataset.pestana === 'cartera' && cart.lugares.length) elegir('cartera', 0);
    if ($('panel').dataset.pestana === 'calendario') pintarCalendario();
    G?.pedir();
  }
  // Misión o mes nuevos: con mes (o tiras ya puestas) baja antes lo que falte; si falla, vuelve al año entero. Sin descargas, repinta en el acto.
  let turnoMes = 0;
  async function aplicar() {
    const t = ++turnoMes;
    if ((mes !== null || tiras) && !mesesListos()) {
      const ok = await asegurarMeses(mes !== null ? "Loading this month's climate…" : 'Loading the climate month by month…');
      if (t !== turnoMes) return;
      if (!ok) { mes = null; tiras = false; selMes.poner(null); enlacesVolver(); }
    }
    if (mes !== null) tiras = true;
    repintar();
  }
  // Selector y formulario «New mission» (mision_panel.js).
  montarMision({ misiones, indice: M.indice, sitios, mundo, activa, alCambiar: (a) => { activa = a; enlacesVolver(); aplicar(); } });
  const selMes = montarMes({ mes, alCambiar: (m) => { mes = m; avisoMes(null); enlacesVolver(); aplicar(); } });
  pintarFicha();
  // «Show how these places change through the year»: baja los meses y pinta las tiras; el ranking no cambia.
  $('ver-meses').addEventListener('click', async () => {
    $('ver-meses').disabled = true;
    const ok = await asegurarMeses('Loading the climate month by month…');
    $('ver-meses').disabled = false;
    if (!ok) return;
    tiras = true;
    ponerTiras();
  });

  // Calendar: el lugar elegido mes a mes, el mejor lugar de la Tierra de cada mes y el plan de repetición.
  let calCache = null;
  const plan = { inicio: null, despues: 6 };
  const selector = (id, opciones, valor, cambiar) => {
    const s = el('select', { id }, ...opciones.map(([v, t]) => el('option', { value: String(v), textContent: t })));
    s.value = String(valor);
    s.addEventListener('change', () => cambiar(Number(s.value)));
    return s;
  };
  async function pintarCalendario() {
    const caja = $('calendario'), x = lugarSel();
    if (!x) { caja.replaceChildren(el('p', { className: 'tenue', textContent: 'Pick a place in the list first.' })); return; }
    if (!mesesListos()) {
      caja.replaceChildren(el('p', { className: 'tenue', textContent: 'Loading the climate month by month…' }));
      const ok = await asegurarMeses('Loading the climate month by month…');
      if (!ok) { caja.replaceChildren(el('p', { className: 'aviso-mes', textContent: 'Could not download the climate month by month. Try again later.' })); return; }
      tiras = true;
      ponerTiras();
      if ($('panel').dataset.pestana === 'calendario') pintarCalendario();
      return;
    }
    const o = opcionesBusqueda(activa);
    const clave = JSON.stringify([o, x.lat, x.lon]);
    if (calCache?.clave !== clave) calCache = { clave, cal: M.calendario(objetivo, { ...o, lugar: { lat: x.lat, lon: x.lon } }), per: M.perfilMensual(objetivo, { lat: x.lat, lon: x.lon }, o) };
    const { cal, per } = calCache;
    A.calendario = { lat: x.lat, lon: x.lon, filas: cal };
    const donde = (f) => `${formatoLatLon(f.lat, f.lon).texto}${pais(f) ? ` (${pais(f)})` : ''}`;
    plan.inicio ??= mes ?? 1;
    const p = planRepetir(cal, plan.inicio, plan.despues);
    const frase = fraseRepetir(p, p.repeticion.mejor ? donde(p.repeticion.mejor) : '');
    A.plan = { ...p, frase };
    const ir = p.mover && p.repeticion.mejor ? el('button', { type: 'button', className: 'marca-boton secundario', id: 'plan-ir', textContent: `Show the best place in ${nombreMes(p.repeticion.mes)} on the globe`,
      onclick: () => { A.planIr = { lat: p.repeticion.mejor.lat, lon: p.repeticion.mejor.lon }; G?.mirar(A.planIr); } }) : null;
    const rs = rachas(per, MARGEN);
    const numSel = A.sel.lista === 'resultados' ? `Place ${A.sel.k + 1}` : A.sel.lista === 'cartera' ? `Portfolio place ${letra(A.sel.k)}` : 'Partly compared place';
    const filas = cal.map((f) => {
      const mv = moverEnMes(f);
      const mejor = f.similitud_pct === null ? el('td', { className: 'tenue', textContent: 'none comparable' })
        : f.relevo === false ? el('td', {}, el('strong', { textContent: 'This place' }), el('span', { className: 'pct marca-num', textContent: fmtPct(f.similitud_pct) }))
          : el('td', {}, pais(f) ? el('strong', { textContent: pais(f) }) : null, el('span', { className: 'marca-num coords', textContent: formatoLatLon(f.lat, f.lon).texto }), el('span', { className: 'pct marca-num', textContent: fmtPct(f.similitud_pct) }));
      mejor.dataset.v = 'mejor';
      const tr = el('tr', { className: f.mes === mes ? 'actual' : '' }, el('th', { scope: 'row', textContent: MESES_CORTO[f.mes - 1], title: MESES_LARGO[f.mes - 1] }),
        el('td', { className: 'marca-num aqui', textContent: fmtPct(f.en_lugar_pct) }), mejor,
        el('td', { className: `mover${mv ? ' si' : ''}`, textContent: mv === null ? '—' : mv ? 'Yes' : 'No' }));
      tr.dataset.mes = f.mes;
      return tr;
    });
    caja.replaceChildren(
      el('h1', { className: 'marca-titulo titular', textContent: 'Month by month' }),
      el('p', { className: 'met-lugar' }, numSel, ...(pais(x) ? [sep(), pais(x)] : []), sep(), el('span', { className: 'marca-num', textContent: formatoLatLon(x.lat, x.lon).texto })),
      rs.length ? el('p', { className: 'racha', textContent: `Within ${MARGEN} points of its best month: ${rs.map((s) => s.texto).join(', ')} (own threshold).` }) : null,
      el('section', { className: 'bloque plan', id: 'plan' }, el('h3', { textContent: 'Repeat a test later' }),
        el('div', { className: 'plan-mandos' },
          el('label', { className: 'mision-rotulo', htmlFor: 'plan-inicio', textContent: 'First test in' }),
          selector('plan-inicio', MESES_LARGO.map((n, k) => [k + 1, n]), plan.inicio, (v) => { plan.inicio = v; pintarCalendario(); }),
          el('label', { className: 'mision-rotulo', htmlFor: 'plan-despues', textContent: 'Repeat after' }),
          selector('plan-despues', Array.from({ length: 11 }, (_, k) => [k + 1, `${k + 1} month${k ? 's' : ''}`]), plan.despues, (v) => { plan.despues = v; pintarCalendario(); })),
        el('p', { className: `plan-frase${p.mover ? ' mover' : ''}`, id: 'plan-frase', textContent: frase }),
        ir,
        el('p', { textContent: `Move = this place is more than ${MARGEN} points below the best place on Earth that month (own threshold).` })),
      el('div', { className: 'tabla-scroll' }, el('table', { className: 'tabla-calendario' },
        el('thead', {}, el('tr', {}, el('th', { scope: 'col', textContent: 'Month' }), el('th', { scope: 'col', textContent: 'This place' }), el('th', { scope: 'col', textContent: 'Best place on Earth' }),
          el('th', { scope: 'col' }, 'Move?', el('small', { textContent: `own threshold: ${MARGEN} points` })))),
        el('tbody', {}, ...filas))),
      el('section', { className: 'bloque limites' }, el('h3', { textContent: 'Limits' }),
        el('p', { textContent: `Your point ${EN[mundo]} keeps its year-average value in every month: season is not compared with season.` }),
        el('p', { textContent: 'Earth months are climatology: the average month of many years (NASA POWER), not one particular year.' }),
        el('p', { textContent: 'Snow on the ground is not measured: a snowy place in winter counts with its temperature and light, without the snow.' })));
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
