// Base alrededor del punto: un botón coloca cada equipo de superficie del catálogo dentro de un radio (asentamiento.js),
// en el mundo de destino y, a los mismos metros del centro, en la Tierra. Al pasar el ratón por una pieza sale su lectura
// en los dos mundos, que cambia con la hora de la barra Day. Aquí solo la pantalla.
import * as THREE from 'three';
import { RADIOS_M, RADIO_DEFECTO_M, piezasDe, piezasPorPrioridad, generarAsentamiento } from './asentamiento.js';
import { PAR_BASE, esDeBase, lecturaPieza, filaRequisito, alinear, resumenBase } from './asentamiento_ficha.js';
import { celdaEspejo } from './espejo.js';
import { evaluarRequisito } from './evaluar.js';

const SVG = 'http://www.w3.org/2000/svg';
const PUNTOS_ANILLO = 72;
const bits = (v) => { let k = 0; for (let x = v >>> 0; x; x &= x - 1) k++; return k; };
const radioTexto = (r) => (r >= 1000 ? `${r / 1000} km` : `${r} m`);
// Clave de una pieza de la base: base:<radio>:<id> y, si se generó por prioridad, :p<puesto> (así el orden sobrevive a recargar).
const parDe = (radio_m, id, puesto = null) => `${PAR_BASE}${radio_m}:${id}${puesto ? `:p${puesto}` : ''}`;
const radioDePar = (par) => { const v = +String(par).slice(PAR_BASE.length).split(':')[0]; return Number.isFinite(v) && v > 0 ? v : null; };
const puestoDePar = (par) => { const m = /:p(\d+)$/.exec(String(par)); return m ? +m[1] : null; };

// ctx: { paneles, catalogo, esc, fuenteYCita, nombreCorto, CUERPO, equipoDe, dia(), plantarLote, quitarLote, seleccionar,
//        refrescarPlantado, evaluar, medidasDe, alternarSuelo, centroDe(p) → { fila, col, punto } (centro de la base en ese panel;
//        punto = es el punto elegido y no solo el centro de la ventana) }.
export function crearAsentamiento(caja, ctx) {
  const { paneles, esc, nombreCorto, CUERPO } = ctx;
  // modo: 'optimo' (reglas propias, orden propio) | 'prioridad' (el orden de S.orden; la primera pieza es el ancla).
  const S = { radio_m: RADIO_DEFECTO_M, trabajando: false, res: null, aviso: '', ficha: null, tFicha: 0, modo: 'optimo', orden: [], elegido: false };
  const vivos = () => paneles.filter((p) => p.escena && p.plantados);
  const primario = () => vivos().find((p) => p.escena.meta.cuerpo !== 'tierra') ?? vivos()[0] ?? null;
  const secundario = (pri) => vivos().find((p) => p !== pri && p.escena.meta.cuerpo !== pri.escena.meta.cuerpo) ?? null;
  const cuerpo = (p) => CUERPO[p.escena.meta.cuerpo] ?? p.escena.meta.cuerpo;
  const polar = (p) => p.escena.meta.georef.tipo === 'estereo_polar';
  const deBase = (p) => p.plantados.lista.filter(esDeBase);
  const centroDe = (p) => ctx.centroDe?.(p) ?? { fila: (p.escena.n - 1) / 2, col: (p.escena.n - 1) / 2, punto: false };
  const nombreCentro = () => { const pri = primario(); return pri && centroDe(pri).punto ? 'your point' : 'the window centre'; };
  if (!vivos().length || !Array.isArray(ctx.catalogo?.equipos)) return { dibujar() {}, refrescar() {}, estado: S, generar: async () => null };

  const centro = nombreCentro();
  const PIEZAS = piezasDe(ctx.catalogo).piezas;
  const reglasDe = (modo, orden) => new Map((modo === 'prioridad' ? piezasPorPrioridad(PIEZAS, orden) : PIEZAS).map((x, i) => [x.id, { ...x, numero: i + 1 }]));
  S.orden = PIEZAS.map((x) => x.id);
  let reglas = reglasDe('optimo');
  const textoRegla = (regla) => (regla ? `${regla.texto}${regla.tira ? `; pulled towards ${nombreCorto(regla.tira.con)}, your first need` : ''}` : '');
  const tope = Math.min(...vivos().map((p) => (p.escena.m * (p.escena.n - 1)) / 2));
  const radios = RADIOS_M.filter((r) => r <= tope);
  if (!radios.length) radios.push(Math.floor(tope));
  if (!radios.includes(S.radio_m)) S.radio_m = radios.at(-1);
  // Una base restaurada del autoguardado trae su radio en la clave de cada pieza.
  const previo = vivos().flatMap(deBase).map((it) => radioDePar(it.par)).find(Boolean);
  if (previo) { S.radio_m = previo; if (!radios.includes(previo)) radios.push(previo); }
  const puestos = vivos().flatMap(deBase).map((it) => [it.equipo, puestoDePar(it.par)]).filter((x) => x[1]).sort((a, b) => a[1] - b[1]);
  if (puestos.length) {
    // Cada pieza vuelve a su puesto; las que falten (quitadas a mano) rellenan los huecos, para no correr los números.
    const con = new Map(puestos.map(([id, k]) => [k - 1, id])), ids = new Set(con.values()), resto = S.orden.filter((id) => !ids.has(id));
    S.modo = 'prioridad'; S.elegido = true;
    S.orden = S.orden.map((_, k) => (con.has(k) && PIEZAS.some((x) => x.id === con.get(k)) ? con.get(k) : null)).map((id) => id ?? resto.shift()).filter(Boolean);
    reglas = reglasDe(S.modo, S.orden);
  }

  caja.hidden = false;
  caja.innerHTML = `
    <div class="as-mandos">
      <h2 class="marca-subtitulo">Base</h2>
      <button type="button" class="marca-boton" data-a="generar">Generate base</button>
      <span class="grupo" role="group" aria-label="Radius around ${esc(centro)}"><span class="et">Radius</span>${radios.map((r) => `<button type="button" data-radio="${r}" aria-pressed="${r === S.radio_m}">${radioTexto(r)}</button>`).join('')}</span>
      <button type="button" class="marca-boton secundario" data-a="limpiar">Clear base</button>
      <span class="as-estado" role="status" data-v="estado"></span>
    </div>
    <details class="as-detalle solo-fondo" hidden><summary>How each piece was placed and how it does in each world</summary><div data-v="tabla"></div></details>`;
  const $ = (s) => caja.querySelector(s);

  // ---------- Tabla de prioridades (antes de generar) ----------
  const dlg = document.createElement('dialog');
  dlg.className = 'as-dialogo';
  dlg.setAttribute('aria-label', 'Base layout');
  document.body.appendChild(dlg);
  const D = { modo: 'prioridad', orden: [] };
  const MODOS = [['prioridad', 'Around what you need most'], ['optimo', 'Optimal layout']];
  function pintarDialogo(foco = null) {
    const lista = D.modo === 'prioridad' ? D.orden : PIEZAS.map((x) => x.id), mueve = D.modo === 'prioridad';
    const de = new Map(PIEZAS.map((x) => [x.id, x]));
    dlg.innerHTML = `
      <h2 class="marca-subtitulo">What does this base need most?</h2>
      <div class="grupo" role="group" aria-label="How to lay out the base">${MODOS.map(([k, t]) => `<button type="button" data-modo="${k}" aria-pressed="${k === D.modo}">${t}</button>`).join('')}</div>
      <p class="as-dlg-nota">${mueve
    ? `Put first what you need most: it gets the best ground for it and the rest is laid out around it, in your order.<span class="solo-fondo"> Published limits still hold. The pull towards the first piece is our own rule, not from a source; a piece whose own rule already places it relative to the first one (the landing pad keeps away from the habitat) keeps that rule.</span>`
    : `Each piece goes where our own rules put it, habitat first.<span class="solo-fondo"> Published limits hold. The order and weights are ours, not from a source.</span>`}</p>
      <div class="as-dlg-tabla"><table class="as-orden"><thead><tr><th>#</th><th>Piece</th><th class="solo-fondo">What it looks for <span class="tenue">(own rule)</span></th><th>${mueve ? 'Move' : ''}</th></tr></thead>
      <tbody>${lista.map((id, k) => `<tr data-id="${esc(id)}"${mueve ? ' draggable="true"' : ''}${mueve && k === 0 ? ' class="ancla"' : ''}>
        <td><span class="as-n">${k + 1}</span></td><td><b>${esc(nombreCorto(id))}</b>${mueve && k === 0 ? ' <span class="marca-chip">first need</span>' : ''}</td>
        <td class="solo-fondo">${esc(de.get(id)?.texto ?? '')}</td>
        <td class="mover">${mueve ? `<button type="button" data-mover="-1" aria-label="Move ${esc(nombreCorto(id))} up"${k === 0 ? ' disabled' : ''}>↑</button><button type="button" data-mover="1" aria-label="Move ${esc(nombreCorto(id))} down"${k === lista.length - 1 ? ' disabled' : ''}>↓</button><button type="button" data-mover="primero" aria-label="Make ${esc(nombreCorto(id))} the first need"${k === 0 ? ' disabled' : ''}>First</button>` : ''}</td></tr>`).join('')}</tbody></table></div>
      <div class="as-dlg-pie"><button type="button" class="marca-boton" data-a="ok">Generate base</button><button type="button" class="marca-boton secundario" data-a="cancelar">Cancel</button>${mueve ? '<button type="button" class="marca-boton secundario" data-a="orden-propio">Reset order</button>' : ''}<span class="tenue">Radius ${radioTexto(S.radio_m)} around ${esc(nombreCentro())}</span></div>`;
    if (foco) dlg.querySelector(foco)?.focus();
  }
  function mover(id, hasta) {
    const de = D.orden.indexOf(id);
    if (de < 0 || hasta < 0 || hasta >= D.orden.length || hasta === de) return false;
    D.orden.splice(hasta, 0, ...D.orden.splice(de, 1));
    return true;
  }
  function abrirDialogo() {
    if (S.trabajando) return;
    D.modo = S.elegido ? S.modo : 'prioridad';
    D.orden = [...S.orden];
    pintarDialogo();
    if (!dlg.open) dlg.showModal();
  }
  const aceptar = () => { dlg.close(); return generar({ modo: D.modo, orden: [...D.orden] }); };
  dlg.addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.dataset.modo) { D.modo = b.dataset.modo; pintarDialogo(`[data-modo=${D.modo}]`); }
    else if (b.dataset.mover) {
      const id = b.closest('tr').dataset.id, k = D.orden.indexOf(id), hasta = b.dataset.mover === 'primero' ? 0 : k + +b.dataset.mover;
      if (mover(id, hasta)) pintarDialogo(`tr[data-id="${CSS.escape(id)}"] [data-mover="${b.dataset.mover}"]:not(:disabled), tr[data-id="${CSS.escape(id)}"] [data-mover]:not(:disabled)`);
    } else if (b.dataset.a === 'ok') aceptar();
    else if (b.dataset.a === 'cancelar') dlg.close();
    else if (b.dataset.a === 'orden-propio') { D.orden = PIEZAS.map((x) => x.id); pintarDialogo('[data-a=orden-propio]'); }
  });
  let arrastrada = null;
  dlg.addEventListener('dragstart', (ev) => { const tr = ev.target.closest?.('tr[data-id]'); if (!tr || D.modo !== 'prioridad') return; arrastrada = tr.dataset.id; ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', arrastrada); tr.classList.add('arrastrada'); });
  dlg.addEventListener('dragover', (ev) => { const tr = ev.target.closest?.('tr[data-id]'); if (!arrastrada || !tr) return; ev.preventDefault(); dlg.querySelectorAll('tr.sobre').forEach((x) => x.classList.remove('sobre')); tr.classList.add('sobre'); });
  dlg.addEventListener('drop', (ev) => {
    const tr = ev.target.closest?.('tr[data-id]');
    if (!arrastrada || !tr) return;
    ev.preventDefault();
    mover(arrastrada, D.orden.indexOf(tr.dataset.id));
    arrastrada = null;
    pintarDialogo();
  });
  dlg.addEventListener('dragend', () => { arrastrada = null; dlg.querySelectorAll('tr.sobre, tr.arrastrada').forEach((x) => x.classList.remove('sobre', 'arrastrada')); });

  // Una sola ficha, sobre toda la página: puede ser más alta que el lienzo del panel.
  const fichaEl = document.createElement('div');
  fichaEl.className = 'as-ficha';
  fichaEl.hidden = true;
  document.body.appendChild(fichaEl);
  for (const p of vivos()) {
    const lienzo = p.el.querySelector('.lienzo');
    const svg = document.createElementNS(SVG, 'svg');
    svg.classList.add('as-anillo');
    svg.innerHTML = '<polygon></polygon>';
    lienzo.append(svg);
    p.asAnillo = svg;
    engancharRaton(p);
  }

  // ---------- Generar ----------
  const esperarMapa = (p) => new Promise((ok) => {
    const t0 = performance.now();
    const mirar = () => {
      const m = ctx.dia()?.mapa(p) ?? null;
      if (!m || !m.pendiente) ok(m);
      else if (performance.now() - t0 > 90000) ok(null);
      else setTimeout(mirar, 40);
    };
    mirar();
  });

  // opc: { modo, orden } (por defecto lo último elegido; sin elegir nada, el modo óptimo).
  async function generar(opc = {}) {
    if (S.trabajando) return null;
    const pri = primario();
    if (!pri) return null;
    const sec = secundario(pri);
    const modo = opc.modo === 'prioridad' || opc.modo === 'optimo' ? opc.modo : S.modo;
    const orden = Array.isArray(opc.orden) ? [...new Set([...opc.orden.filter((id) => PIEZAS.some((x) => x.id === id)), ...PIEZAS.map((x) => x.id)])] : S.orden;
    S.trabajando = true;
    S.aviso = 'Working out the light through the day…';
    pintar();
    try {
      const luz = await esperarMapa(pri);
      if (sec) await esperarMapa(sec);
      S.aviso = 'Placing each piece…';
      pintar();
      await new Promise((ok) => setTimeout(ok, 0));
      const e = pri.escena, { excluidos } = piezasDe(ctx.catalogo);
      const piezas = modo === 'prioridad' ? piezasPorPrioridad(PIEZAS, orden) : PIEZAS;
      const cp = centroDe(pri), cs = sec ? centroDe(sec) : null;
      const o = { n: e.n, m: e.m, centro: cp }, d = sec ? { n: sec.escena.n, m: sec.escena.m, alturas: sec.escena.mostradas, centro: cs } : null, aguaSec = sec?.escena.capas.agua ?? null;
      // La celda gemela tiene que existir en el otro mundo, con cota y en tierra firme.
      const apto = sec ? (f, c) => { const r = celdaEspejo(o, d, f, c); return !!r && !r.recortado && !r.movido && !(aguaSec?.[r.fila * d.n + r.col] >= 1); } : undefined;
      const radio_m = S.radio_m;
      // Límites publicados que se miden en la celda con los mapas del terreno (temperatura, iluminación): duros como la pendiente.
      const DE_CAPA = new Set(['temp_k', 'iluminacion_frac', 'sombra_permanente']);
      const reqsCapa = new Map(piezas.map((x) => [x.id, (ctx.equipoDe(x.id)?.requisitos ?? []).filter((q) => DE_CAPA.has(q.variable) && Number.isFinite(q.valor))]));
      const enCapa = (k, i) => { const x = e.capas[k]?.[i]; return Number.isFinite(x) ? { valor: x } : { valor: null }; };
      const cumple = (pieza, f, c) => {
        const reqs = reqsCapa.get(pieza.id);
        if (!reqs?.length) return true;
        const i = f * e.n + c, med = { temp_k: { max: enCapa('temp_max', i), min: enCapa('temp_min', i) }, iluminacion_frac: enCapa('iluminacion', i), sombra_permanente: enCapa('sombra_permanente', i) };
        return reqs.every((q) => evaluarRequisito(q, med).estado !== 'rompe');
      };
      // Separación mínima entre piezas (criterio propio): que no compartan celda en ningún mundo y se distingan en la vista aérea.
      const separacion_min_m = Math.max(1.5 * Math.max(e.m, sec?.escena.m ?? 0), radio_m / 12);
      // Lo plantado a mano ocupa sitio y cuenta para las separaciones publicadas; el gemelo se redondea a su rejilla (hasta √2 celdas entre dos piezas).
      const ocupadas = pri.plantados.lista.filter((it) => !esDeBase(it)).map((it) => ({ equipo: it.equipo, fila: it.fila, col: it.col, huella_m: reglas.get(it.equipo)?.huella_m ?? null }));
      const margen_separacion_m = sec ? sec.escena.m * Math.SQRT2 : 0;
      const r = generarAsentamiento(
        { n: e.n, m: e.m, alturas: e.mostradas, agua: e.capas.agua ?? null, capas: e.capas.sombra_permanente ? { sombra_permanente: e.capas.sombra_permanente } : {} },
        piezas,
        { radio_m, centro: { fila: cp.fila, col: cp.col }, luz: luz ? { pasos: (i) => bits(luz.bits[i]), total: luz.total } : null, apto, cumple, separacion_min_m, ocupadas, margen_separacion_m });
      const puesto = new Map(piezas.map((x, k) => [x.id, modo === 'prioridad' ? k + 1 : null]));
      const par = (id) => parDe(radio_m, id, puesto.get(id));
      for (const p of vivos()) ctx.quitarLote(p, esDeBase);
      ctx.plantarLote(pri, r.piezas.map((x) => ({ equipo: x.id, fila: x.fila, col: x.col, par: par(x.id) })));
      if (sec) ctx.plantarLote(sec, r.piezas.map((x) => { const g = celdaEspejo(o, d, x.fila, x.col); return g ? { equipo: x.id, fila: g.fila, col: g.col, par: par(x.id) } : null; }).filter(Boolean));
      S.modo = modo; S.orden = orden; S.elegido = true;
      reglas = reglasDe(modo, orden);
      S.res = { r, excluidos, radio_m, separacion_min_m, margen_separacion_m, modo, orden: piezas.map((x) => x.id), pri: pri.lado, sec: sec?.lado ?? null };
      S.aviso = '';
      for (const p of vivos()) {
        if (p.escena.suelo) ctx.alternarSuelo(p, false);
        p.escena.encuadrar((radio_m * 1.1) / 1000, centroDe(p));
      }
      ctx.refrescarPlantado();
      return r;
    } catch (err) {
      S.aviso = `The base could not be generated: ${err.message}`;
      return null;
    } finally {
      S.trabajando = false;
      pintar();
    }
  }

  function limpiar() {
    let k = 0;
    for (const p of vivos()) k += ctx.quitarLote(p, esDeBase);
    S.res = null;
    S.aviso = '';
    ocultarFicha(true);
    if (k) ctx.refrescarPlantado(); else pintar();
  }

  // ---------- Barra: estado y tabla ----------
  const rompe = (p, it) => p.escena.capas.agua?.[it.fila * p.escena.n + it.col] >= 1 || (ctx.equipoDe(it.equipo) ? ctx.evaluar(p, it).some((r) => r.estado === 'rompe') : false);
  function veredicto(p, it) {
    if (!it) return '<span class="tenue">not planted here</span>';
    if (p.escena.capas.agua?.[it.fila * p.escena.n + it.col] >= 1) return '<b class="v-rompe">ON WATER</b>';
    const evs = ctx.evaluar(p, it), rotas = evs.filter((r) => r.estado === 'rompe');
    if (rotas.length) {
      return rotas.map((r) => {
        const f = filaRequisito(r, nombreCorto);
        return `<b class="v-rompe">BREAKS</b> ${esc(f.nombre)} <span class="num">${esc(f.valor)}</span> <span class="tenue">${esc(f.nota.replace(': BREAKS by', ', off by'))}</span>`;
      }).join('<br>');
    }
    const medidos = evs.filter((r) => r.estado === 'ok').length, sinMedir = evs.filter((r) => r.estado === 'no_medido' || r.estado === 'cota_inferior').length;
    if (!evs.some((r) => r.estado !== 'sin_limite')) return '<span class="tenue">no public limit to check</span>';
    return `${medidos ? `<b class="v-ok">OK</b> <span class="tenue">${medidos} published limit${medidos > 1 ? 's' : ''} met</span>` : ''}${sinMedir ? `${medidos ? ' · ' : ''}<span class="tenue">${sinMedir} not measurable here</span>` : ''}`;
  }

  // Las marcas de la base llevan su número (el de la tabla); el nombre sale al pasar el ratón o al elegirla.
  function numerar() {
    for (const p of vivos()) for (const it of deBase(p)) {
      const d = p.marcas.get(it.uid)?.d;
      if (!d || d.classList.contains('de-base')) continue;
      d.classList.add('de-base');
      d.querySelector('.rot').innerHTML = `<b class="as-n">${reglas.get(it.equipo)?.numero ?? ''}</b><span class="as-nom">${esc(nombreCorto(it.equipo))}</span>`;
    }
  }

  function pintar() {
    numerar();
    const pri = primario(), sec = pri ? secundario(pri) : null;
    const hay = pri ? deBase(pri) : [];
    $('[data-a=generar]').disabled = S.trabajando;
    $('[data-a=generar]').textContent = S.trabajando ? 'Generating…' : hay.length ? 'Generate again' : 'Generate base';
    $('[data-a=limpiar]').disabled = S.trabajando || !vivos().some((p) => deBase(p).length);
    caja.querySelectorAll('[data-radio]').forEach((b) => { b.disabled = S.trabajando; b.setAttribute('aria-pressed', String(+b.dataset.radio === S.radio_m)); });
    const est = $('[data-v=estado]'), det = $('.as-detalle');
    if (S.aviso) { est.textContent = S.aviso; det.hidden = !hay.length; if (!hay.length) return; }
    if (!hay.length) {
      if (!S.aviso) est.innerHTML = `<span class="solo-simple">Lays out a whole base around ${esc(centro)}.</span><span class="solo-fondo">Places every surface system of the catalogue around ${esc(centro)}, inside the radius: each by its own rule and its published limits${sec ? `, on ${esc(cuerpo(pri))} and at the same offsets on ${esc(cuerpo(sec))}` : ''}.</span>`;
      det.hidden = true;
      return;
    }
    const radio = radioDePar(hay[0].par);
    const lados = [pri, sec].filter(Boolean).map((p) => {
      const r = resumenBase(deBase(p).map((it) => ({ nombre: nombreCorto(it.equipo), rompe: rompe(p, it) })));
      if (!r.total) return `<b>${esc(cuerpo(p))}</b> <span class="tenue">no pieces planted</span>`;
      return `<b>${esc(cuerpo(p))}</b> ${r.rompen ? `<span class="v-rompe">${r.rompen} break${r.rompen > 1 ? '' : 's'} a published limit</span><span class="solo-fondo"> (${esc(r.nombres.join(', '))})</span>` : 'no published limit broken'}`;
    });
    if (!S.aviso) est.innerHTML = `<span class="num">${hay.length}</span> pieces<span class="solo-fondo"> inside <span class="num">${radio ? radioTexto(radio) : '—'}</span> of ${esc(centro)}</span>${S.modo === 'prioridad' ? ` · around <b>${esc(nombreCorto(S.orden[0]))}</b>` : ''} · ${lados.join(' · ')}<span class="tenue solo-fondo"> · hover a piece to read it, click to open its sheet</span>`;
    det.hidden = false;
    const R = S.res;
    const fila = (it) => {
      const g = sec?.plantados.lista.find((x) => x.par === it.par) ?? null, regla = reglas.get(it.equipo), opt = R?.r.piezas.find((x) => x.id === it.equipo);
      const lim = [regla?.limite ? `slope ${regla.limite.op === '<' ? '<' : '≤'} ${regla.limite.valor}° ${ctx.fuenteYCita(regla.limite.req, 'source')}` : null,
        ...(regla?.separaciones ?? []).map((s) => `≥ ${s.min_m} m from ${esc(nombreCorto(s.con))} ${ctx.fuenteYCita(s.req, 'source')}`)].filter(Boolean);
      const sinSitio = opt?.incumple?.length ? `<div class="as-nota">No ground inside this radius meets ${opt.incumple.map((x) => (x === 'pendiente' ? 'its slope limit' : x === 'limite' ? 'its other published limits' : `its distance from ${esc(nombreCorto(x.split(':')[1]))}`)).join(' and ')}: try a wider radius.</div>` : '';
      return `<tr data-pieza="${esc(it.equipo)}" data-uid="${it.uid}" tabindex="0"><td><span class="as-n">${regla?.numero ?? ''}</span> <b>${esc(nombreCorto(it.equipo))}</b></td>
        <td>${esc(textoRegla(regla))}${sinSitio}</td><td>${lim.length ? lim.join('<br>') : '<span class="tenue">none published</span>'}</td>
        <td data-v="pri">${veredicto(pri, it)}</td>${sec ? `<td data-v="sec">${veredicto(sec, g)}</td>` : ''}</tr>`;
    };
    const notas = [];
    if (R?.r.sin_sitio.length) notas.push(`Not placed: ${R.r.sin_sitio.map((x) => `${esc(nombreCorto(x.id))} (${esc(x.motivo)})`).join(' · ')}`);
    if (R?.excluidos.length) notas.push(`Left out: ${R.excluidos.map((x) => `${esc(x.nombre)} (${esc(x.motivo)})`).join(' · ')}`);
    if (S.modo === 'prioridad') notas.push(`Laid out by your priorities: ${esc(nombreCorto(S.orden[0]))} was placed first, by what it measures on the ground; every other piece keeps its own rule and is also pulled towards it, more the higher you ranked it (own rule). A piece whose own rule already places it relative to ${esc(nombreCorto(S.orden[0]))} keeps that rule instead, even if it means staying away from it.`);
    if (R?.r && pri.plantados.lista.some((it) => !esDeBase(it))) notas.push('Equipment you planted by hand was left where it is: it takes up room and counts for the published distances.');
    if (R) notas.push(`${R.r.candidatos.toLocaleString('en-US')} cells of ${esc(cuerpo(pri))} tried inside the radius${R.r.paso > 1 ? ` (one in every ${R.r.paso} each way)` : ''} · pieces kept at least ${Math.round(R.separacion_min_m)} m apart (own choice, so they can be told apart) · ${R.r.usaLuz ? `light = sunlit steps of the day computed from the terrain${R.r.sombraDe === 'sombra_permanente' ? ' · darkest ground = the permanent-shadow map' : ''}` : 'no light map for this terrain: light rules not used'}`);
    $('[data-v=tabla]').innerHTML = `<table class="as-tabla"><thead><tr><th>Piece</th><th>Why there <span class="tenue">(own rule)</span></th><th>Published limits</th><th>On ${esc(cuerpo(pri))}</th>${sec ? `<th>On ${esc(cuerpo(sec))}</th>` : ''}</tr></thead>
      <tbody>${hay.map(fila).join('')}</tbody></table>
      <div class="tenue as-notas">${notas.map((t) => `<div>${t}</div>`).join('')}<div>${sec ? `Laid out for ${esc(cuerpo(pri))}; ${esc(cuerpo(sec))} gets the same layout, each piece at the same offset from ${esc(centro)} rounded to its own grid, to rehearse it. ` : ''}The rules and weights are ours, not from a source; the limits are the published ones. The 3D models are enlarged from above so they can be seen: outlines are true size.</div></div>`;
    $('[data-v=tabla]').querySelectorAll('tr[data-uid]').forEach((tr) => {
      const abrir = () => ctx.seleccionar(pri, +tr.dataset.uid);
      tr.addEventListener('click', (ev) => { if (!ev.target.closest('a, summary')) abrir(); });
      tr.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') abrir(); });
    });
  }

  // ---------- Anillo del radio ----------
  function anillo(p) {
    const svg = p.asAnillo, e = p.escena;
    const it = deBase(p)[0], radio = it ? radioDePar(it.par) : null;
    if (!radio || e.suelo) { svg.style.display = 'none'; return; }
    const caja2 = p.el.querySelector('.lienzo').getBoundingClientRect(), k = centroDe(p), rc = radio / e.m, pts = [];
    for (let j = 0; j < PUNTOS_ANILLO; j++) {
      const a = (2 * Math.PI * j) / PUNTOS_ANILLO;
      const f = Math.min(e.n - 1, Math.max(0, k.fila + rc * Math.sin(a))), c = Math.min(e.n - 1, Math.max(0, k.col + rc * Math.cos(a)));
      const s = e.aPantalla(e.mundoDePixel(f, c));
      if (!s) { svg.style.display = 'none'; return; }
      pts.push(`${(s.x - caja2.left).toFixed(1)},${(s.y - caja2.top).toFixed(1)}`);
    }
    svg.style.display = '';
    svg.firstElementChild.setAttribute('points', pts.join(' '));
  }

  // ---------- Ficha al pasar el ratón ----------
  const gemelo = (p, it) => {
    if (!it.par) return null;
    for (const q of vivos()) { if (q === p) continue; const x = q.plantados.lista.find((y) => y.par === it.par); if (x) return { q, it: x }; }
    return null;
  };

  function lectura(p, it) {
    const e = p.escena, k = esDeBase(it) ? centroDe(p) : { fila: (e.n - 1) / 2, col: (e.n - 1) / 2, punto: false }, i = it.fila * e.n + it.col;
    const D = ctx.dia(), mapa = D?.mapa(p) ?? null;
    const inst = p.modelos?.instancias().find((x) => x.uid === it.uid) ?? null, tam = inst?.tam ?? null;
    const capas = {};
    for (const c of ['iluminacion', 'temp_max']) if (e.capas[c]) capas[c] = e.capas[c][i];
    return lecturaPieza({
      cuerpo: cuerpo(p), punto: !!k.punto, desplazamiento: { este_m: (it.col - k.col) * e.m, sur_m: (it.fila - k.fila) * e.m }, rejilla: polar(p), cota: e.mostradas[i],
      pendiente: ctx.medidasDe(p, it).pendiente_deg, evs: ctx.equipoDe(it.equipo) ? ctx.evaluar(p, it) : [], nombreDe: nombreCorto,
      sol: { activo: !!D?.estado.activo && !!p.diaSol, el: e.sol.el, az: e.sol.az, polar: polar(p), luz: e.conSol(it.fila, it.col) }, alto_m: tam ? tam[1] : null, altoSupuesto: inst?.generado === 'concepto',
      dia: mapa && !mapa.pendiente ? { v: mapa.bits[i], soles: mapa.soles, total: mapa.total, unidad: mapa.unidad, ahora: mapa.ahora } : null,
      diaMotivo: mapa ? null : 'not computed for this terrain', capas, sinModelo: !inst,
    });
  }

  const celda = (f) => (f ? `<span class="num">${esc(f.valor)}</span>${f.nota ? `<div class="as-nota${f.estado === 'rompe' ? ' v-rompe' : ''}">${esc(f.nota)}</div>` : ''}` : '<span class="tenue">—</span>');
  const tira = (l) => (l.tira ? `<div class="as-tira"><span class="et">${esc(l.cuerpo)}</span><span class="dia-tira"><span class="celdas">${l.tira.map((x) => `<i class="${x.c}${x.ahora ? ' ahora' : ''}"></i>`).join('')}</span></span></div>` : '');

  function pintarFicha() {
    const F = S.ficha;
    if (!F) return;
    const p = F.p, it = p.plantados.buscar(F.uid);
    if (!it) { ocultarFicha(true); return; }
    const g = gemelo(p, it), a = lectura(p, it), b = g ? lectura(g.q, g.it) : null;
    const regla = esDeBase(it) ? reglas.get(it.equipo) : null;
    const el = fichaEl;
    el.dataset.uid = it.uid;
    el.dataset.lado = p.lado;
    el.dataset.fijada = String(!!F.fijada);
    el.innerHTML = `<div class="as-cab"><b>${esc(nombreCorto(it.equipo))}</b>${F.fijada ? '<span class="et">pinned · Esc closes</span>' : ''}</div>
      ${regla ? `<div class="as-regla solo-fondo">${esc(textoRegla(regla))} <span class="tenue">(own rule)</span></div>` : ''}
      <table class="as-lect"><thead><tr><th></th><th>${esc(a.cuerpo)}</th>${b ? `<th>${esc(b.cuerpo)}</th>` : ''}</tr></thead><tbody>
      ${alinear(a, b).map((f) => `<tr data-fila="${esc(f.id)}"><td>${esc((f.a ?? f.b).nombre)}</td><td>${celda(f.a)}</td>${b ? `<td>${celda(f.b)}</td>` : ''}</tr>`).join('')}</tbody></table>
      ${a.tira || b?.tira ? `<div class="as-tiras"><span class="et">Light through its day · <i class="as-ley sol"></i> sunlit <i class="as-ley sombra"></i> terrain shadow <i class="as-ley noche"></i> night</span>${tira(a)}${b ? tira(b) : ''}</div>` : ''}
      <div class="tenue as-pie">Temperature hour by hour: NOT MEASURED (not loaded in this viewer). ${F.fijada ? '' : 'Click to pin and open the full sheet.'}</div>`;
    el.hidden = false;
    colocarFicha();
    S.tFicha = performance.now();
  }

  function colocarFicha() {
    const F = S.ficha;
    if (!F || (F.fijada && F.puesta)) return;
    F.puesta = true;
    const el = fichaEl, w = el.offsetWidth, h = el.offsetHeight, W = window.innerWidth, H = window.innerHeight;
    let x = F.x + 18, y = F.y + 18;
    if (x + w > W - 6) x = F.x - w - 18;
    if (y + h > H - 6) y = H - h - 6;
    el.style.left = `${Math.max(6, x)}px`;
    el.style.top = `${Math.max(6, y)}px`;
  }

  function mostrarFicha(p, uid, x, y, fijada = false) {
    if (S.ficha?.fijada && !fijada) return;
    const cambia = !S.ficha || S.ficha.uid !== uid || S.ficha.p !== p || fijada !== !!S.ficha.fijada;
    S.ficha = { p, uid, x, y, fijada };
    if (cambia) pintarFicha(); else colocarFicha();
  }

  function ocultarFicha(tambienFijada = false) {
    if (!S.ficha || (S.ficha.fijada && !tambienFijada)) return;
    fichaEl.hidden = true;
    S.ficha = null;
  }

  const rayo = new THREE.Raycaster(), ndc = new THREE.Vector2();
  function uidBajo(p, x, y) {
    const e = p.escena, r = e.renderer.domElement.getBoundingClientRect();
    if (!p.modelos?.grupo.children.length) return null;
    ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    rayo.setFromCamera(ndc, e.camara);
    for (const h of rayo.intersectObjects(p.modelos.grupo.children, true)) {
      let o = h.object;
      while (o && o.userData?.uid === undefined) o = o.parent;
      if (o && p.plantados.buscar(o.userData.uid)) return o.userData.uid;
    }
    return null;
  }

  function engancharRaton(p) {
    const cv = p.escena.renderer.domElement, marcas = p.el.querySelector('.marcas');
    let pend = null, enCola = false, abajo = null;
    cv.addEventListener('pointermove', (ev) => {
      if (ev.buttons || p.plantar || p.herramienta !== 'navegar') { pend = null; if (ev.buttons) ocultarFicha(); return; }
      pend = { x: ev.clientX, y: ev.clientY };
      if (enCola) return;
      enCola = true;
      requestAnimationFrame(() => {
        const q = pend;
        pend = null;
        enCola = false;
        if (!q) return;
        const uid = uidBajo(p, q.x, q.y);
        cv.style.cursor = uid === null ? '' : 'pointer';
        if (uid === null) ocultarFicha(); else mostrarFicha(p, uid, q.x, q.y);
      });
    });
    cv.addEventListener('pointerleave', () => { cv.style.cursor = ''; ocultarFicha(); });
    cv.addEventListener('pointerdown', (ev) => { abajo = ev.button === 0 ? { x: ev.clientX, y: ev.clientY } : null; });
    cv.addEventListener('pointerup', (ev) => {
      const a = abajo;
      abajo = null;
      if (!a || Math.hypot(ev.clientX - a.x, ev.clientY - a.y) > 4 || p.plantar || p.herramienta !== 'navegar') return;
      const uid = uidBajo(p, ev.clientX, ev.clientY);
      if (uid === null) { ocultarFicha(true); return; }
      mostrarFicha(p, uid, ev.clientX, ev.clientY, true);
      ctx.seleccionar(p, uid);
    });
    marcas.addEventListener('pointerover', (ev) => {
      const m = ev.target.closest?.('.marca');
      if (m && !ev.buttons) mostrarFicha(p, +m.dataset.uid, ev.clientX, ev.clientY);
    });
    marcas.addEventListener('pointerout', (ev) => { if (ev.target.closest?.('.marca')) ocultarFicha(); });
  }
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && S.ficha?.fijada) ocultarFicha(true); });

  $('[data-a=generar]').addEventListener('click', abrirDialogo);
  $('[data-a=limpiar]').addEventListener('click', limpiar);
  caja.querySelectorAll('[data-radio]').forEach((b) => b.addEventListener('click', () => { S.radio_m = +b.dataset.radio; pintar(); }));
  pintar();

  return {
    estado: S,
    generar,
    limpiar,
    // Regla y número de una pieza tal como salen en pantalla (para el informe).
    reglaDe: (id) => { const r = reglas.get(id); return r ? { numero: r.numero, texto: textoRegla(r), ancla: !!r.ancla } : null; },
    // Para los guiones: la tabla de prioridades y su borrador.
    dialogo: { el: dlg, abrir: abrirDialogo, borrador: D, mover: (id, hasta) => { const ok = mover(id, hasta); pintarDialogo(); return ok; }, aceptar },
    // Tras cada fotograma de un panel: el anillo sigue a la cámara y la ficha abierta sigue a la hora.
    dibujar(p) {
      if (!p.asAnillo) return;
      anillo(p);
      if (S.ficha && performance.now() - S.tFicha > 250) pintarFicha();
    },
    refrescar() { pintar(); pintarFicha(); },
    // Para los guiones: abre la ficha de una pieza como si el ratón estuviera encima.
    fichaDe(p, uid, fijada = false) {
      const it = p.plantados.buscar(uid), s = it && p.escena.aPantalla(p.escena.mundoDePixel(it.fila, it.col));
      if (!s) return false;
      if (S.ficha?.fijada) ocultarFicha(true);
      mostrarFicha(p, uid, s.x, s.y, fijada);
      return true;
    },
    uidBajo,
  };
}
