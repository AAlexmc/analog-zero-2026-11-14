// Recuadro «What makes a good base site?»: criterios con su cita de NASA, controles, «Find the best spot»,
// resultado bajo el botón y marcadores de las alternativas sobre el globo. El cálculo va en optimo_worker.js.
import { esLimite, esPeso, ajustesPorDefecto, separacionPorDefecto, PESO_INICIAL } from './optimo.js';
import { formatoLatLon, normLon } from '../explorar/geo.js';

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...hijos) => { const e = Object.assign(document.createElement(tag), props); e.append(...hijos.filter((h) => h !== null && h !== undefined && h !== false)); return e; };
const OP = { '<=': 'at most', '<': 'under', '>=': 'at least', '>': 'over' };
const MOVIL = '(max-width: 760px), (max-aspect-ratio: 1/1)';

const cifra = (v) => new Intl.NumberFormat('en', { maximumFractionDigits: Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : 2 }).format(v);
export function formatoCriterio(c, v) {
  if (v === null || v === undefined || !Number.isFinite(v)) return 'no data';
  if (/^fraction/.test(c.unidad ?? '')) return `${Math.round(v * 100)} % of the time`;
  if (c.unidad === '°' || c.unidad === 'deg') return `${cifra(v)}°`;
  return c.unidad ? `${cifra(v)} ${c.unidad}` : cifra(v);
}
export const nombreCorto = (c) => c.nombre.replace(/\s*\(.*\)\s*$/, '');
// Una línea por sitio: «Sunlight 84 % of the time · Slope 3.1° · …».
export const lineaValores = (criterios, valores) => criterios.map((c) => `${nombreCorto(c)} ${formatoCriterio(c, valores[c.id])}`).join(' · ');
export const rotuloRango = (k) => (k === 1 ? 'Best spot' : `Option ${k}`);
// Con un solo criterio de peso no hay nada que pesar: se ordena por él y el deslizador sobra.
export const fraseUnPeso = (c, hayLimites) => `Ranked by the ${(c.nombre.match(/\(([^)]+)\)\s*$/)?.[1] ?? c.nombre).toLowerCase()}${hayLimites ? " among the places that meet NASA's limits" : ''}.`;
const sepEl = () => el('span', { className: 'sep', textContent: ' · ' });

function crearCalculo(indice, id, base, radio_km) {
  const espera = new Map();
  let n = 0;
  const w = new Worker(new URL('./optimo_worker.js', import.meta.url), { type: 'module' });
  w.onmessage = ({ data }) => {
    const p = espera.get(data.n);
    if (!p) return;
    espera.delete(data.n);
    if (data.error) p.no(new Error(data.error)); else p.ok(data);
  };
  w.onerror = (e) => { for (const p of espera.values()) p.no(new Error(e.message || 'site worker failed')); espera.clear(); };
  const pedir = (m) => new Promise((ok, no) => { const k = ++n; espera.set(k, { ok, no }); w.postMessage({ ...m, n: k }); });
  return {
    listo: pedir({ tipo: 'cargar', indice, id, base, radio_km }),
    calcular: (ajustes) => pedir({ tipo: 'calcular', ajustes }),
    valores: (lat, lon, ajustes) => pedir({ tipo: 'valores', lat, lon, ajustes }).then((d) => d.v),
  };
}

// ir(sitio, rango, girar): mover la chincheta a un sitio calculado. punto(): chincheta actual {lat, lon, sug} o null.
export async function montarSitio({ mundo, base = '../data/sitio/', ir, punto, V, alCalcular = null }) {
  const S = (V.sitio = { estado: 'cargando', r: null, ajustes: null, aj: null, rango: null, propio: null, ms: null });
  const caja = $('sitio'), boton = $('calcular'), salida = $('resultado');
  caja.hidden = false;
  const sinDatos = (texto) => {
    $('criterios').hidden = true; boton.hidden = true;
    salida.replaceChildren(el('p', { className: 'tenue', textContent: texto }));
  };
  const baseAbs = new URL(base, location.href).href;
  let indice = null;
  try {
    const r = await fetch(`${baseAbs}indice.json`);
    if (r.ok) indice = await r.json();
  } catch { /* sin índice: estado «not available» */ }
  const D = indice?.mundos?.[mundo.id];
  if (!D) { S.estado = 'sin datos'; sinDatos('Site criteria not available.'); return null; }
  document.getElementById('panel').classList.add('con-sitio');

  const criterios = D.criterios;
  const aj = (S.aj = ajustesPorDefecto({ criterios }));
  const sep = separacionPorDefecto({ rejilla: D.rejilla });
  $('ambito').textContent = D.ambito ?? '';
  if (matchMedia(MOVIL).matches) $('criterios').open = false;

  const fuente = (f, texto) => (f?.url || f?.fuente ? el('a', { href: f.url ?? f.fuente, target: '_blank', rel: 'noopener', textContent: texto }) : null);
  const bocadillo = (cita, extra = []) => el('div', { className: 'cita', hidden: true },
    el('blockquote', { textContent: `“${cita.texto}”` }), el('p', {}, fuente(cita, 'Source')), ...extra);
  const botonCita = (caja) => {
    const b = el('button', { type: 'button', className: 'nasa', textContent: 'NASA says' });
    b.setAttribute('aria-expanded', 'false');
    b.addEventListener('click', () => { caja.hidden = !caja.hidden; b.setAttribute('aria-expanded', String(!caja.hidden)); });
    return b;
  };
  const alCambiar = () => { if (S.propio) evaluarPropio(); };

  const conPeso = criterios.filter(esPeso), unPeso = conPeso.length === 1;
  $('pesos-propios').hidden = !conPeso.length;
  if (unPeso) $('pesos-propios').textContent = fraseUnPeso(conPeso[0], criterios.some(esLimite));
  $('lista-criterios').replaceChildren(...criterios.map((c) => {
    const fila = el('div', { className: 'criterio' });
    fila.dataset.id = c.id;
    const cita = c.cita ? bocadillo(c.cita, [
      c.definicion ? el('p', { textContent: c.definicion }) : null,
      c.aviso ? el('p', {}, el('strong', { textContent: 'Note: ' }), c.aviso) : null,
      c.fuente_dato ? el('p', {}, `Data: ${c.fuente_dato.texto ?? ''} `, fuente(c.fuente_dato, 'link')) : null,
    ]) : null;
    fila.append(el('div', { className: 'cab' }, el('span', { className: 'nombre', textContent: c.nombre }), cita ? botonCita(cita) : null));
    if (esLimite(c)) {
      const chk = el('input', { type: 'checkbox', checked: true });
      const num = el('input', { type: 'number', className: 'marca-num', value: String(c.limite.valor), step: 'any', inputMode: 'decimal' });
      chk.setAttribute('aria-label', `Use the ${c.nombre.toLowerCase()} limit`);
      num.setAttribute('aria-label', `${c.nombre} limit${c.unidad ? ` in ${c.unidad}` : ''}`);
      const nota = el('span', { className: 'nota' });
      const pintar = () => {
        num.disabled = !chk.checked;
        const v = Number(num.value), vale = num.value.trim() !== '' && Number.isFinite(v);
        aj.limites[c.id] = chk.checked && vale ? v : null;
        const cambiado = vale && v !== c.limite.valor;
        nota.textContent = !chk.checked ? 'off'
          : c.limite.origen === 'mío' ? `own limit${cambiado ? `, changed from ${formatoCriterio(c, c.limite.valor)}` : ''}`
            : cambiado ? `changed from NASA's ${formatoCriterio(c, c.limite.valor)}` : '';
        alCambiar();
      };
      chk.addEventListener('change', pintar);
      num.addEventListener('input', pintar);
      pintar();
      fila.append(el('label', { className: 'limite' }, chk, el('span', { textContent: OP[c.limite.op] ?? c.limite.op }), num, c.unidad ? el('span', { textContent: c.unidad === 'deg' ? '°' : c.unidad }) : null), nota);
      fila.dataset.limite = '';
    }
    if (esPeso(c) && !unPeso) {
      const r = el('input', { type: 'range', min: '0', max: '1', step: '0.05', value: String(PESO_INICIAL) });
      r.setAttribute('aria-label', `How much ${c.nombre.toLowerCase()} matters`);
      r.addEventListener('input', () => { aj.pesos[c.id] = Number(r.value); });
      fila.append(el('div', { className: 'peso' }, el('span', { textContent: 'matters less' }), r, el('span', { textContent: 'matters more' })));
    }
    if (cita) fila.append(cita);
    return fila;
  }));
  const nm = D.no_medidos ?? [];
  $('no-medidos').hidden = !nm.length;
  $('no-medidos-lista').replaceChildren(...nm.map((x) => {
    const cita = x.cita ? bocadillo(x.cita) : null;
    return el('li', {}, el('div', { className: 'cab' }, el('span', { textContent: x.nombre }), cita ? botonCita(cita) : null),
      x.motivo ? el('span', { className: 'nota', textContent: x.motivo }) : null, cita);
  }));

  let calc;
  try {
    calc = crearCalculo(indice, mundo.id, baseAbs, mundo.radio_km);
    await calc.listo;
  } catch (e) {
    S.estado = 'error'; S.error = String(e?.message ?? e);
    sinDatos('Could not load the site criteria. Reload the page to try again.');
    return null;
  }
  S.estado = 'ok';

  // Marcadores 1-5 sobre el globo; el del sitio donde está la chincheta se oculta.
  const opciones = $('opciones');
  let marcas = [];
  const sitios = () => (S.r?.mejor ? [S.r.mejor, ...S.r.alternativas] : []);
  function ponerMarcas() {
    marcas = sitios().map((s, k) => {
      const b = el('button', { type: 'button', textContent: String(k + 1), title: rotuloRango(k + 1) });
      b.dataset.rango = k + 1;
      b.addEventListener('click', () => ir(s, k + 1, false));
      return b;
    });
    opciones.replaceChildren(...marcas, juntar);
    G?.pedir();
  }
  let G = null;
  // Distancia de cámara (en radios) a la que los dos sitios más juntos quedan a unos 36 px: lo justo para que no se pisen
  // (de lejos, en la Luna, caen todos en el mismo punto) sin perder de vista a los demás.
  const distanciaParaSeparar = () => {
    const c = G.camara, alto = G.renderer.domElement.clientHeight || window.innerHeight, ss = sitios(), rad = Math.PI / 180;
    const pxPorRadio = (alto / 2) / Math.tan((c.fov * Math.PI) / 360);
    let minimo = Infinity;
    for (let i = 0; i < ss.length; i++) for (let j = i + 1; j < ss.length; j++) {
      const a = ss[i], b = ss[j];
      const h = Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lon - a.lon) * rad) / 2) ** 2;
      minimo = Math.min(minimo, 2 * Math.asin(Math.sqrt(h)));
    }
    if (!Number.isFinite(minimo)) minimo = sep.km / mundo.radio_km;
    return Math.max(G.controles.minDistance, Math.min(G.distancia0(), 1 + (minimo * pxPorRadio) / 36));
  };
  const juntar = el('button', { type: 'button', className: 'juntos', hidden: true });
  juntar.addEventListener('click', () => { const s = sitios()[(S.rango ?? 1) - 1] ?? sitios()[0]; if (s && G) G.mirar(s, distanciaParaSeparar(), 88); });
  const colocarMarcas = () => {
    if (!G) return;
    if (!juntar.isConnected) opciones.append(juntar);
    const p = $('panel').getBoundingClientRect(), pin = punto(), qp = pin && G.aPantalla(pin.lat, pin.lon);
    // Uno que pisa la chincheta o a otro ya puesto se oculta hasta que se amplía (en la Luna caen todos juntos de lejos);
    // un botón junto al grupo dice cuántos faltan y amplía hasta separarlos.
    const puestos = qp?.visible ? [qp] : [];
    let pisados = 0, donde = null;
    sitios().forEach((s, k) => {
      const b = marcas[k], q = G.aPantalla(s.lat, s.lon);
      const fuera = S.rango === k + 1 || !q.visible || q.y < 72 || (q.x > p.left - 14 && q.x < p.right + 14 && q.y > p.top - 14 && q.y < p.bottom + 14);
      const pisa = !fuera && puestos.some((o) => Math.hypot(o.x - q.x, o.y - q.y) < 28);
      b.hidden = fuera || pisa;
      if (pisa) { pisados++; donde ??= q; }
      if (b.hidden) return;
      puestos.push(q);
      b.style.transform = `translate(${q.x.toFixed(1)}px, ${q.y.toFixed(1)}px)`;
    });
    juntar.hidden = !pisados;
    S.pisados = pisados;
    if (pisados) {
      // «+N more» si ya se ve alguno (o la chincheta es uno de ellos); si no, «N spots here».
      juntar.textContent = S.rango || puestos.length > (qp?.visible ? 1 : 0) ? `+${pisados} more · zoom in` : `${pisados} spots here · zoom in`;
      juntar.title = `${pisados} more ${pisados === 1 ? 'spot is' : 'spots are'} hidden here because they overlap at this zoom`;
      juntar.style.transform = `translate(${donde.x.toFixed(1)}px, ${(donde.y + 30).toFixed(1)}px)`;
    }
  };

  const linea = (cls, ...hijos) => el('p', { className: cls }, ...hijos);
  function pintar() {
    const r = S.r, out = [];
    if (!r) out.push(linea('tenue', 'Finding the best spot…'));
    else if (!r.mejor) {
      const porque = r.motivo === 'sin_pesos' ? 'Every slider is at zero: nothing to rank. Move one up.'
        : r.motivo === 'sin_aptas' ? `No place meets all the limits.${r.descartadoPor ? ` ${r.descartadoPor.nombre} rules out the most.` : ''}`
          : 'No data for the chosen criteria where the limits are met.';
      out.push(linea('r-aviso', porque));
    }
    const pinta = (titulo, lat, lon, v, conMarcas) => {
      out.push(linea('r-titulo', el('strong', { textContent: titulo }), lat === null ? null : sepEl(), lat === null ? null : el('span', { className: 'marca-num', textContent: formatoLatLon(lat, lon).texto })));
      if (v === undefined) { out.push(linea('tenue', 'Reading the values here…')); return; }
      if (v === null || criterios.every((c) => !Number.isFinite(v.valores[c.id]))) { out.push(linea('r-valores', 'Outside the area we score.')); return; }
      const items = criterios.map((c) => {
        const s = el('span', { className: 'item' }, `${nombreCorto(c)} ${formatoCriterio(c, v.valores[c.id])}`);
        s.dataset.id = c.id;
        if (conMarcas && c.id in v.cumple) {
          const ok = v.cumple[c.id];
          const m = el('span', { className: `marca ${ok ? 'cumple' : 'no-cumple'}`, textContent: ok === null ? ' ?' : ok ? ' ✓' : ' ✕' });
          m.title = ok === null ? 'no data for this limit' : ok ? 'meets the limit' : 'does not meet the limit';
          m.setAttribute('aria-label', m.title);
          s.append(m);
        }
        return s;
      });
      out.push(linea('r-valores', ...items.flatMap((s, i) => (i ? [sepEl(), s] : [s]))));
    };
    if (S.propio) pinta(S.propio.nombre ?? 'Your own pick', S.propio.lat, S.propio.lon, S.propio.v, true);
    else if (S.rango && sitios()[S.rango - 1]) { const s = sitios()[S.rango - 1]; pinta(rotuloRango(S.rango), s.lat, s.lon, s, false); }
    if (r) {
      const nf = new Intl.NumberFormat('en');
      const lim = r.usados.limites.length;
      out.push(linea('r-aptas tenue', lim
        ? `${nf.format(r.aptas.n)} grid cells meet the limits: ${Math.round(100 * r.aptas.fracArea)} % of the area.`
        : `${criterios.some(esLimite) ? 'All limits off' : 'NASA gives no hard limit here'}: all ${nf.format(r.aptas.de)} grid cells with data compete.`));
      if (r.alternativas.length) out.push(linea('r-aptas tenue', `Numbers on the globe: the next best spots, at least ${cifra(sep.km)} km apart (own choice).`));
    }
    salida.replaceChildren(...out);
    G?.pedir();
  }

  let turnoP = 0;
  async function evaluarPropio() {
    const p = S.propio, yo = ++turnoP;
    try {
      const v = await calc.valores(p.lat, p.lon, structuredClone(aj));
      if (yo !== turnoP || S.propio !== p) return;
      p.v = v;
    } catch (e) { if (S.propio === p) p.v = null; V.errores?.push(String(e?.message ?? e)); }
    pintar();
  }
  const rangoDe = (lat, lon) => {
    const k = sitios().findIndex((s) => Math.abs(s.lat - lat) < 1e-4 && Math.abs(normLon(s.lon - lon)) < 1e-4);
    return k < 0 ? null : k + 1;
  };

  let turno = 0;
  async function calcular(mover) {
    const yo = ++turno, ajustes = structuredClone(aj);
    boton.disabled = true;
    caja.setAttribute('aria-busy', 'true');
    try {
      const { r, ms } = await calc.calcular(ajustes);
      if (yo !== turno) return;
      Object.assign(S, { r, ms, ajustes });
      S.n = (S.n ?? 0) + 1;
      ponerMarcas();
      try { alCalcular?.(); } catch (e) { V.errores?.push(String(e?.message ?? e)); }
      if (r.mejor && mover()) { ir(r.mejor, 1, true); return; }
      const p = punto();
      if (p) alPunto(p, p.sug, null); else pintar();
    } catch (e) {
      V.errores?.push(String(e?.message ?? e));
      salida.replaceChildren(linea('r-aviso', 'Could not compute the best spot.'));
    } finally {
      if (yo === turno) { boton.disabled = false; caja.removeAttribute('aria-busy'); }
    }
  }
  boton.addEventListener('click', () => calcular(() => true));

  function alPunto(p, sug, origen) {
    const k = origen?.rango ?? (sug ? null : rangoDe(p.lat, p.lon));
    if (k) { S.rango = k; S.propio = null; pintar(); return; }
    S.rango = null;
    S.propio = { lat: p.lat, lon: p.lon, nombre: sug ? sug.nombre : origen?.nombre ?? null, v: undefined };
    pintar();
    evaluarPropio();
  }

  const inicial = calcular(() => !punto());
  // Zona que se puntúa, a grandes rasgos (rejilla polar: hasta la esquina del recorte); el corte fino lo da apta().
  const g = D.rejilla, colatMax = g.tipo === 'polar' ? (((g.n * g.m_por_px) / 2) * Math.SQRT2) / g.georef.radio_m / (Math.PI / 180) : null;
  return {
    alPunto,
    inicial,
    conGlobo(g2) { G = g2; G.alDibujar(colocarMarcas); },
    separacion_km: sep.km,
    hayLimites: criterios.some(esLimite),
    ambito: colatMax === null ? null : (lat) => (g.georef.polo === 'sur' ? lat <= -90 + colatMax : lat >= 90 - colatMax),
    // Dentro de la zona puntuada y cumple todos los límites activos del paso 2 (con los ajustes de ahora).
    async apta(lat, lon) {
      const v = await calc.valores(lat, lon, structuredClone(aj));
      if (!v || criterios.every((c) => !Number.isFinite(v.valores[c.id]))) return false;
      return Object.values(v.cumple ?? {}).every((x) => x === true);
    },
  };
}
