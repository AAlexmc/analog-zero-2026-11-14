// Botón «Generate report» del visor y su vista previa: recoge los datos (recoger.js), arma el HTML (informe.js) y lo enseña en un
// <iframe sandbox srcdoc> que es exactamente el fichero que se descarga. Aquí solo la pantalla.
import { recoger, parecidoDe } from './recoger.js';
import { construirInforme } from './informe.js';

const ESPERA_MS = 90000;

// ctx: { paneles, catalogo, cuerpos, dia(), asentamiento(), evaluar, equipoDe, nombreCorto, CUERPO, lugar, punto, mision, mes, exag(), espejo(), ejemplo, centroDe }.
export function crearInforme(boton, ctx) {
  const dlg = document.createElement('dialog');
  dlg.className = 'inf-dialogo';
  dlg.setAttribute('aria-labelledby', 'inf-titulo');
  dlg.innerHTML = `<div class="inf-cab"><h2 class="marca-subtitulo" id="inf-titulo">Report preview</h2><span class="inf-estado" role="status" data-v="estado"></span><span class="hueco"></span>
    <button type="button" class="marca-boton" data-a="descargar" disabled>Download report (.html)</button>
    <button type="button" class="marca-boton secundario" data-a="imprimir" disabled>Print / save as PDF</button>
    <button type="button" class="marca-boton secundario" data-a="cerrar">Close</button></div>
    <iframe class="inf-vista" title="Report preview" sandbox="allow-modals allow-same-origin allow-popups allow-popups-to-escape-sandbox"></iframe>`;
  document.body.appendChild(dlg);
  const $ = (s) => dlg.querySelector(s), marco = $('iframe');
  const U = { html: null, nombre: null, segundosMotor: null, trabajando: false };
  let motor = null;
  const aviso = (t) => { $('[data-v=estado]').textContent = t; };
  const botones = (si) => { $('[data-a=descargar]').disabled = !si; $('[data-a=imprimir]').disabled = !si; };

  const esperarMapa = (p) => new Promise((ok) => {
    const t0 = performance.now();
    const mirar = () => {
      const m = ctx.dia()?.mapa(p) ?? null;
      if (!m || !m.pendiente) ok(m);
      else if (performance.now() - t0 > ESPERA_MS) ok(null);
      else setTimeout(mirar, 40);
    };
    mirar();
  });

  async function parecido(mundo, lugar) {
    if (!mundo || !lugar) return { motivo: `No ${mundo ? 'place on Earth' : 'point on the Moon or Mars'} in this simulation, so there is nothing to compare.` };
    const t0 = performance.now();
    try {
      motor ??= import('../buscar/motor.js').then((m) => m.cargar(new URL('../data/cuerpos/', import.meta.url).href));
      const M = await motor;
      U.segundosMotor = (performance.now() - t0) / 1000;
      return parecidoDe(M, mundo, lugar);
    } catch (e) {
      motor = null;
      return { motivo: `The global layers could not be read here (${e.message}).` };
    }
  }

  async function datos() {
    const vivos = ctx.paneles.filter((p) => p.escena);
    for (const p of vivos) await esperarMapa(p);
    const d = recoger({
      paneles: ctx.paneles, catalogo: ctx.catalogo, cuerpos: ctx.cuerpos, dia: ctx.dia(), asentamiento: ctx.asentamiento(), evaluar: ctx.evaluar, equipoDe: ctx.equipoDe,
      nombreCorto: ctx.nombreCorto, CUERPO: ctx.CUERPO, lugar: ctx.lugar, punto: ctx.punto, mision: ctx.mision, mes: ctx.mes, exag: ctx.exag(), espejo: ctx.espejo(),
      ejemplo: ctx.ejemplo, centroDe: ctx.centroDe, url: location.href, parecido: null,
    });
    if (d.mundo) d.enlace_resultados = new URL(`../analogos/index.html?mundo=${encodeURIComponent(d.mundo.clave)}&lat=${d.mundo.lat.toFixed(4)}&lon=${d.mundo.lon.toFixed(4)}`, location.href).href;
    d.parecido = await parecido(d.mundo, d.lugar);
    return d;
  }

  async function construir() {
    const d = await datos();
    const sitio = d.mundo ?? d.lugar;
    U.html = construirInforme(d);
    U.nombre = `analog-zero-report-${d.mundo?.clave ?? 'earth'}-${sitio ? `${sitio.lat.toFixed(4)}_${sitio.lon.toFixed(4)}` : 'no-place'}.html`;
    return U.html;
  }

  async function abrir() {
    if (U.trabajando) return;
    U.trabajando = true;
    boton.setAttribute('aria-busy', 'true');
    botones(false);
    marco.srcdoc = '';
    aviso('Building the report…');
    if (!dlg.open) dlg.showModal();
    await new Promise((ok) => setTimeout(ok, 30));
    try {
      marco.srcdoc = await construir();
      aviso('');
      botones(true);
    } catch (e) {
      console.warn(e);
      aviso(`The report could not be built: ${e.message}`);
    } finally {
      U.trabajando = false;
      boton.removeAttribute('aria-busy');
    }
  }

  function descargar() {
    if (!U.html) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([U.html], { type: 'text/html;charset=utf-8' }));
    a.download = U.nombre;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function imprimir() {
    try { marco.contentWindow.focus(); marco.contentWindow.print(); } catch { aviso('Printing is blocked here: download the report and print it from your browser.'); }
  }

  boton.addEventListener('click', abrir);
  $('[data-a=descargar]').addEventListener('click', descargar);
  $('[data-a=imprimir]').addEventListener('click', imprimir);
  $('[data-a=cerrar]').addEventListener('click', () => dlg.close());
  dlg.addEventListener('close', () => boton.focus());

  return { construir, abrir, datos, cerrar: () => dlg.close(), ultimo: () => ({ ...U }) };
}
