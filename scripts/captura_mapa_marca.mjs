// Mapa global con la marca, en portátil (1440×900) y móvil (390×844): ranking con celda abierta, «test conditions»
// y validación desplegada. Comprueba barra común, sin texto rojo, contraste de los textos que se ven y que nada se sale.
// Uso: node scripts/captura_mapa_marca.mjs
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { chromium } from 'playwright';
import { contraste } from '../web/marca/contraste.js';

const RAIZ = resolve(new URL('..', import.meta.url).pathname);
const WEB = join(RAIZ, 'web');
const SALIDA = join(RAIZ, 'capturas/mapa');
const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.geojson': 'application/geo+json', '.csv': 'text/csv', '.woff2': 'font/woff2' };

const fallos = [];
const falla = (m) => { fallos.push(m); console.error(`FAIL ${m}`); };
const ok = (m) => console.log(`ok   ${m}`);

const servidor = createServer(async (req, res) => {
  const ruta = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
  const f = join(WEB, ruta.endsWith('/') ? `${ruta}index.html` : ruta);
  if (!f.startsWith(WEB)) { res.writeHead(403).end(); return; }
  try {
    const b = await readFile(f);
    res.writeHead(200, { 'content-type': TIPOS[extname(f)] ?? 'application/octet-stream' }).end(b);
  } catch { res.writeHead(404).end(); }
});
await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${servidor.address().port}`;
await mkdir(SALIDA, { recursive: true });

const cm = JSON.parse(await readFile(join(WEB, 'data/global/condiciones.json'), 'utf8'));
const haughton = cm.sitios.find((s) => s.id === 'haughton');

// Textos visibles: color propio y fondo opaco efectivo (capas con alfa mezcladas de dentro afuera sobre el degradado).
const leerTextos = (p) => p.evaluate(() => {
  const rgba = (s) => { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return null; const v = m[1].split(',').map(Number); return [v[0], v[1], v[2], v[3] ?? 1]; };
  const fuera = [];
  const vistos = new Map();
  const nodos = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = nodos.nextNode(); n; n = nodos.nextNode()) {
    if (!n.textContent.trim()) continue;
    const el = n.parentElement;
    if (!el || el.closest('[hidden], canvas, option, optgroup, .banda-sintetico, details:not([open]) > :not(summary)')) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || Number(cs.opacity) < 1 || el.closest('button:disabled, [aria-disabled=true]')) continue;
    const enSvg = el instanceof SVGElement;
    const color = rgba(enSvg ? cs.fill : cs.color);
    const capas = [];
    for (let a = el; a && a !== document.body; a = a.parentElement) {
      const b = rgba(getComputedStyle(a).backgroundColor);
      if (b && b[3] > 0) capas.push(b);
      if (b && b[3] >= 1) break;
    }
    // Sin fondo opaco: el peor caso del degradado de marca es electric blue (el más claro).
    let fondo = [0, 66, 166];
    for (const c of capas.reverse()) fondo = fondo.map((v, i) => c[3] * c[i] + (1 - c[3]) * v);
    const texto = color.slice(0, 3).map((v, i) => color[3] * v + (1 - color[3]) * fondo[i]);
    const clave = `${texto.map(Math.round)}|${fondo.map(Math.round)}`;
    if (!vistos.has(clave)) vistos.set(clave, { texto, fondo, muestra: n.textContent.trim().slice(0, 40), sobreMapa: !!el.closest('.zona-mapa .zoom, .leyenda-mapa') });
    if ((color[0] === 228 && color[1] === 55 && color[2] === 0) || (color[0] === 142 && color[1] === 17 && color[2] === 0)) fuera.push(n.textContent.trim().slice(0, 40));
  }
  return { rojos: fuera, parejas: [...vistos.values()] };
});

async function revisar(p, nombre, ancho) {
  const t = await leerTextos(p);
  if (t.rojos.length) falla(`${nombre}: red text ${JSON.stringify(t.rojos)}`); else ok(`${nombre}: no text in rocket or martian red`);
  const malas = t.parejas.filter((x) => contraste(x.texto, x.fondo) < 4.5);
  if (malas.length) falla(`${nombre}: contrast < 4.5 → ${malas.map((x) => `"${x.muestra}" ${contraste(x.texto, x.fondo).toFixed(2)}`).join('; ')}`);
  else ok(`${nombre}: ${t.parejas.length} text/background pairs, all ≥ 4.5:1 (legend and zoom judged on their own panel; the map under them is in marca/contraste.js)`);
  const sale = await p.evaluate((w) => {
    const malos = [];
    if (document.documentElement.scrollWidth > w) malos.push(`page ${document.documentElement.scrollWidth} px wide`);
    for (const el of document.querySelectorAll('.marca-barra, .cabecera-mapa, .mandos-mapa:not([hidden]), .validacion, .zona-mapa, #hoja, select, #misiones button')) {
      const r = el.getBoundingClientRect();
      if (r.width && (r.left < -1 || r.right > w + 1)) malos.push(`${el.id || el.className} ${Math.round(r.left)}–${Math.round(r.right)}`);
    }
    return malos;
  }, ancho);
  if (sale.length) falla(`${nombre}: past the ${ancho} px edge: ${sale.join('; ')}`); else ok(`${nombre}: nothing past the ${ancho} px edges`);
}

const nav = await chromium.launch({ headless: true, args: ['--use-angle=gl-egl', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  for (const [etiqueta, vista] of [['portatil', { width: 1440, height: 900 }], ['movil', { width: 390, height: 844 }]]) {
    const movil = etiqueta === 'movil';
    const pag = await nav.newPage({ viewport: vista, deviceScaleFactor: 1, isMobile: movil, hasTouch: movil });
    pag.on('console', (m) => { if (m.type() === 'error') falla(`console ${etiqueta}: ${m.text()}`); });
    pag.on('pageerror', (e) => falla(`page error ${etiqueta}: ${e.message}`));
    await pag.goto(`${base}/mapa/index.html`);
    await pag.waitForFunction(() => window.__mapa?.listo === true, null, { timeout: 60000 });
    await pag.evaluate(() => document.fonts.ready);

    const barra = await pag.evaluate(() => ({ nombre: document.querySelector('.marca-barra .marca-nombre')?.textContent, inicio: document.querySelector('.marca-barra .marca-nombre')?.getAttribute('href'),
      enlaces: [...document.querySelectorAll('.marca-barra a.marca-enlace')].map((a) => [a.querySelector(innerWidth <= 520 ? '.corto' : '.largo')?.textContent, a.getAttribute('href')]),
      fuente: getComputedStyle(document.querySelector('.marca-barra .marca-nombre')).fontFamily }));
    const esperados = movil ? [['Map', 'mapa/index.html'], ['Data', 'datos/index.html']] : [['Global map', 'mapa/index.html'], ['Data sources', 'datos/index.html']];
    if (barra.nombre !== 'Analog Zero' || barra.inicio !== 'index.html' || JSON.stringify(barra.enlaces) !== JSON.stringify(esperados) || !/Fira Sans/.test(barra.fuente)) falla(`${etiqueta}: top bar ${JSON.stringify(barra)}`);
    else ok(`${etiqueta}: top bar "Analog Zero" (Fira Sans) → portada, links ${barra.enlaces.map((x) => x[0]).join(', ')}`);

    // Ranking con la mejor celda abierta.
    await pag.click('[data-a=abrir-mejor]');
    await pag.waitForFunction(() => window.__mapa.hoja?.puesto === 1);
    await pag.waitForTimeout(250);
    const caja = await pag.evaluate(() => {
      const r = (s) => { const b = document.querySelector(s).getBoundingClientRect(); return { top: b.top + scrollY, bottom: b.bottom + scrollY, left: b.left, right: b.right, h: b.height, w: b.width }; };
      return { mapa: r('#lienzo'), hoja: r('#hoja'), mandos: [...document.querySelectorAll('#mandos-ranking .mando')].map((m) => { const b = m.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top)]; }) };
    });
    if (movil) {
      if (caja.hoja.top < caja.mapa.bottom) falla(`mobile: sheet not below the map ${JSON.stringify(caja)}`); else ok(`mobile: sheet below the map (map ${Math.round(caja.mapa.w)}×${Math.round(caja.mapa.h)} px)`);
      const apilados = caja.mandos.every((m, i) => i === 0 || m[1] > caja.mandos[i - 1][1]);
      if (!apilados) falla(`mobile: controls not stacked ${JSON.stringify(caja.mandos)}`); else ok(`mobile: ${caja.mandos.length} ranking controls stacked`);
    } else if (caja.mapa.h < 420 || caja.hoja.w < 360) falla(`laptop: map ${caja.mapa.w}×${caja.mapa.h}, sheet ${caja.hoja.w} wide`);
    else ok(`laptop: map ${Math.round(caja.mapa.w)}×${Math.round(caja.mapa.h)} px, sheet ${Math.round(caja.hoja.w)} px wide beside it`);
    await revisar(pag, `${etiqueta} ranking`, vista.width);
    if (movil) await pag.evaluate(() => scrollTo(0, 0));
    await pag.screenshot({ path: join(SALIDA, `07-marca-${etiqueta}-ranking.png`), fullPage: movil });

    // Validación desplegada.
    await pag.click('#validacion .ver-detalle');
    await pag.waitForTimeout(150);
    const val = await pag.evaluate(() => ({ abierto: !document.getElementById('val-detalle').hidden, aria: document.querySelector('#validacion .ver-detalle').getAttribute('aria-expanded'),
      titular: document.querySelector('#val-linea [data-v=veredicto]')?.textContent, marca: getComputedStyle(document.querySelector('#val-linea [data-v=veredicto]'), '::before').backgroundColor,
      borde: getComputedStyle(document.getElementById('validacion')).borderLeftColor }));
    if (!val.abierto || val.aria !== 'true' || !/FAILED/.test(val.titular ?? '') || val.marca !== 'rgb(228, 55, 0)' || val.borde !== 'rgb(228, 55, 0)') falla(`${etiqueta}: validation block ${JSON.stringify(val)}`);
    else ok(`${etiqueta}: validation open; "${val.titular}" in white with a rocket-red dot and border`);
    await revisar(pag, `${etiqueta} validation`, vista.width);
    if (movil) await pag.$eval('#validacion', (e) => e.scrollIntoView());
    await pag.screenshot({ path: join(SALIDA, `08-marca-${etiqueta}-validacion.png`), fullPage: false });
    await pag.click('#validacion .ver-detalle');

    // Test conditions con Haughton abierto y VIPER (un requisito que no se alcanza).
    await pag.click('#modos [data-modo=cond]');
    await pag.waitForFunction(() => window.__mapa.modo === 'cond' && window.__mapa.leyenda?.capa?.startsWith('cond:'), null, { timeout: 20000 });
    await pag.$eval('#lienzo', (e) => e.scrollIntoView({ block: 'center' }));
    const pt = await pag.evaluate(([f, c]) => { const p = window.__mapa.aPantalla(f, c); return { ...p, encima: document.elementFromPoint(p.x, p.y)?.id ?? null }; }, [haughton.fila, haughton.col]);
    if (pt.encima !== 'mapa') falla(`${etiqueta}: Haughton on the map is covered by ${pt.encima}`); else ok(`${etiqueta}: Haughton visible on the map (legend and buttons leave it free)`);
    await pag.mouse.click(pt.x, pt.y);
    await pag.waitForFunction(() => window.__mapa.hoja?.modo === 'cond' && /Haughton/.test(window.__mapa.hoja?.nombre ?? ''), null, { timeout: 10000 });
    await pag.selectOption('#cond-eq', 'viper');
    await pag.waitForFunction(() => window.__mapa.hoja?.eq === 'viper', null, { timeout: 20000 });
    await pag.waitForTimeout(250);
    const rompe = await pag.evaluate(() => [...document.querySelectorAll('#hoja .ver.v-rompe')].map((e) => ({ t: e.textContent, color: getComputedStyle(e).color, punto: getComputedStyle(e, '::before').backgroundColor, borde: getComputedStyle(e.closest('.req-cond')).borderLeftColor })));
    if (!rompe.length || rompe.some((x) => x.color !== 'rgb(255, 255, 255)' || x.punto !== 'rgb(228, 55, 0)' || x.borde !== 'rgb(228, 55, 0)')) falla(`${etiqueta}: "not reachable" rows ${JSON.stringify(rompe)}`);
    else ok(`${etiqueta}: ${rompe.length} "not reachable" row(s) in white with a red dot and red bar`);
    await revisar(pag, `${etiqueta} test conditions`, vista.width);
    if (movil) await pag.evaluate(() => scrollTo(0, 0));
    await pag.screenshot({ path: join(SALIDA, `09-marca-${etiqueta}-condiciones.png`), fullPage: movil });
    await pag.close();
  }
} catch (e) {
  falla(`script: ${e.stack ?? e.message}`);
} finally {
  await nav.close();
  servidor.close();
}
console.log(fallos.length ? `CAPTURA_MAPA_MARCA: ${fallos.length} failure(s)` : 'CAPTURA_MAPA_MARCA: ok');
process.exit(fallos.length ? 1 : 0);
