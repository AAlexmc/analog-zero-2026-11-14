// Modo de lectura «Simple» / «In depth» en Chromium: en In depth (por defecto) .solo-fondo no cambia nada y .solo-simple
// no se ve; en Simple ningún .solo-fondo se ve; la barra mide lo mismo en los dos modos y sin el conmutador; el modo
// sigue al navegar y ?modo= manda; palabras visibles por pantalla en cada modo; móvil sin solapes; consola limpia.
// Uso: node scripts/captura_modo.mjs
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { chromium } from 'playwright';

const RAIZ = resolve(new URL('..', import.meta.url).pathname);
const WEB = join(RAIZ, 'web');
const SALIDA = join(RAIZ, 'capturas');
const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm' };
const fallos = [];
const comprobar = (cond, bien, mal) => { if (cond) console.log(`ok   ${bien}`); else { fallos.push(mal); console.error(`FAIL ${mal}`); } };

const servidor = createServer(async (req, res) => {
  const ruta = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
  const f = join(WEB, ruta.endsWith('/') ? `${ruta}index.html` : ruta);
  if (!f.startsWith(WEB)) { res.writeHead(403).end(); return; }
  try { res.writeHead(200, { 'content-type': TIPOS[extname(f)] ?? 'application/octet-stream' }).end(await readFile(f)); } catch { res.writeHead(404).end(); }
});
await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${servidor.address().port}`;
await mkdir(SALIDA, { recursive: true });
const nav = await chromium.launch({ headless: true, args: ['--use-angle=gl-egl', '--enable-gpu', '--ignore-gpu-blocklist'] });

async function contexto(ancho, alto, etiqueta, opciones = {}) {
  const ctx = await nav.newContext({ viewport: { width: ancho, height: alto }, ...opciones });
  ctx.on('page', (pag) => {
    pag.on('console', (m) => { if (m.type() === 'error') comprobar(false, '', `console error (${etiqueta}): ${m.text()}`); });
    pag.on('pageerror', (e) => comprobar(false, '', `page error (${etiqueta}): ${e.message}`));
  });
  return ctx;
}

// Torre solar en la Luna (panel b) con su gemelo en la Tierra: abre la ficha con requisitos y comparación.
async function plantarTorre(pag) {
  await pag.waitForTimeout(600);
  await pag.click('.panel[data-lado=b] .ver-paleta');
  await pag.click('.panel[data-lado=b] .paleta [data-eq=torre_solar]');
  const c = await pag.locator('.panel[data-lado=b] .lienzo canvas').first().boundingBox();
  await pag.mouse.click(c.x + c.width / 2 + 60, c.y + c.height / 2 + 40);
  await pag.waitForFunction(() => !document.querySelector('.panel[data-lado=b] .hoja')?.hidden, null, { timeout: 20000 });
  await pag.mouse.move(5, 895);
  await pag.waitForTimeout(400);
}

const JEZERO = 'mundo=mars&lat=18.38&lon=77.58&nombre=Jezero%20crater';
const PANTALLAS = [
  { id: 'portada', url: 'index.html', listo: () => window.__az?.portada?.listo === true },
  { id: 'mundo', url: 'explorar/index.html?mundo=moon&lat=-89.68643&lon=-162.9371', listo: () => window.__az?.vista?.listo === true },
  { id: 'resultados', url: `analogos/index.html?${JEZERO}`, listo: () => window.__az?.analogos?.listo === true, tras: async (pag) => { await pag.evaluate(() => { window.__az.analogos.autoTerreno = false; }); } },
  { id: 'metricas', url: `analogos/index.html?${JEZERO}`, listo: () => window.__az?.analogos?.listo === true, tras: async (pag) => { await pag.evaluate(() => { window.__az.analogos.autoTerreno = false; }); await pag.click('#tab-metricas'); await pag.waitForTimeout(200); } },
  { id: 'calendario', url: `analogos/index.html?${JEZERO}`, listo: () => window.__az?.analogos?.listo === true, tras: async (pag) => { await pag.evaluate(() => { window.__az.analogos.autoTerreno = false; }); await pag.click('#tab-calendario'); await pag.waitForFunction(() => !!document.querySelector('#calendario h1'), null, { timeout: 60000 }); } },
  { id: 'visor', url: 'terreno/index.html', listo: () => window.__az?.listo === true, tras: plantarTorre },
  { id: 'mapa', url: 'mapa/index.html', listo: () => !document.querySelector('#hoja')?.textContent.includes('Loading'), tras: async (pag) => { await pag.waitForTimeout(800); } },
  { id: 'datos', url: 'datos/index.html', listo: () => !!document.querySelector('#contenido .grupos') },
];

// Lo que se mide en la página tal como está: barra, solo-fondo/solo-simple y palabras visibles.
const medir = (pag) => pag.evaluate(() => {
  const ve = (e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
  const barra = document.querySelector('.marca-barra'), g = barra.querySelector('.marca-modo');
  const alto = barra.getBoundingClientRect().height;
  // Sin el conmutador: se quita, se mide y se vuelve a poner en su sitio.
  const sig = g.nextSibling;
  g.remove();
  const altoSin = barra.getBoundingClientRect().height;
  barra.insertBefore(g, sig);
  const cs = getComputedStyle(barra);
  const linea = Math.max(...[...barra.children].filter((e) => e !== g && ve(e)).map((e) => e.getBoundingClientRect().height));
  const unaLinea = linea + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
  const fondo = [...document.querySelectorAll('.solo-fondo')];
  // En In depth la clase no debe cambiar nada: se quita y se mira si cambia la visibilidad.
  const cambia = document.documentElement.dataset.modo === 'simple' ? [] : fondo.filter((e) => { const a = ve(e); e.classList.remove('solo-fondo'); const b = ve(e); e.classList.add('solo-fondo'); return a !== b; }).map((e) => e.className);
  const botones = [...g.querySelectorAll('button')].map((b) => ({ t: b.textContent, p: b.getAttribute('aria-pressed') }));
  const rg = g.getBoundingClientRect();
  return {
    modo: document.documentElement.dataset.modo, alto, altoSin, unaLinea,
    fondoVisibles: fondo.filter(ve).map((e) => `${e.tagName.toLowerCase()}.${e.className}`), fondoTotal: fondo.length, cambia,
    simpleVisibles: [...document.querySelectorAll('.solo-simple')].filter(ve).map((e) => e.textContent.trim()),
    lineaModo: [...document.querySelectorAll('.nota-modo.solo-simple')].filter(ve).map((e) => e.textContent.trim()),
    palabras: (document.body.innerText.match(/\S+/g) ?? []).length,
    grupo: { rol: g.getAttribute('role'), etiqueta: g.getAttribute('aria-label'), botones, caja: { l: rg.left, r: rg.right, t: rg.top, b: rg.bottom } },
    ancho: document.documentElement.scrollWidth,
  };
});

const tabla = [];
try {
  // ---------- 1. Cada pantalla en los dos modos ----------
  for (const s of PANTALLAS) {
    const fila = { id: s.id };
    for (const modo of ['fondo', 'simple']) {
      const ctx = await contexto(1600, 900, `${s.id} ${modo}`);
      const pag = await ctx.newPage();
      await pag.goto(`${base}/${s.url}${s.url.includes('?') ? '&' : '?'}modo=${modo}`);
      await pag.waitForFunction(s.listo, null, { timeout: 120000 });
      await s.tras?.(pag);
      await pag.waitForTimeout(250);
      const m = await medir(pag);
      fila[modo] = m;
      comprobar(m.modo === modo, `${s.id} ${modo}: data-modo="${m.modo}"`, `${s.id} ${modo}: data-modo is "${m.modo}"`);
      comprobar(m.grupo.rol === 'group' && m.grupo.etiqueta === 'Reading mode' && m.grupo.botones.map((b) => `${b.t}:${b.p}`).join() === (modo === 'simple' ? 'Simple:true,In depth:false' : 'Simple:false,In depth:true'),
        `${s.id} ${modo}: switch ${m.grupo.botones.map((b) => `${b.t}${b.p === 'true' ? '*' : ''}`).join(' | ')}`, `${s.id} ${modo}: switch ${JSON.stringify(m.grupo)}`);
      comprobar(Math.abs(m.alto - m.altoSin) < 0.5 && m.alto <= m.unaLinea + 0.5, `${s.id} ${modo}: bar ${m.alto.toFixed(1)} px = without the switch ${m.altoSin.toFixed(1)} px, one line (${m.unaLinea.toFixed(1)} px)`,
        `${s.id} ${modo}: bar ${m.alto} px, without the switch ${m.altoSin} px, one line ${m.unaLinea} px`);
      comprobar(m.ancho <= 1600, `${s.id} ${modo}: page ${m.ancho} px wide`, `${s.id} ${modo}: page ${m.ancho} px wide`);
      if (modo === 'fondo') {
        comprobar(!m.simpleVisibles.length, `${s.id} in depth: no .solo-simple visible`, `${s.id} in depth: .solo-simple visible: ${m.simpleVisibles.join(' | ')}`);
        comprobar(!m.cambia.length, `${s.id} in depth: the ${m.fondoTotal} .solo-fondo look exactly as without the class`, `${s.id} in depth: .solo-fondo changes visibility: ${m.cambia.join(' | ')}`);
      } else {
        comprobar(!m.fondoVisibles.length, `${s.id} simple: none of the ${m.fondoTotal} .solo-fondo visible`, `${s.id} simple: .solo-fondo visible: ${m.fondoVisibles.join(' | ')}`);
        // Sin nada que esconder (portada) no hay línea «switch to In depth»: no habría nada más que ver.
        const lineas = m.fondoTotal ? 1 : 0;
        comprobar(m.lineaModo.length === lineas, `${s.id} simple: ${lineas ? `one line "${m.lineaModo[0]}"` : 'nothing to hide, no "switch to In depth" line'}${m.simpleVisibles.length > m.lineaModo.length ? `; other .solo-simple: ${m.simpleVisibles.filter((t) => !m.lineaModo.includes(t)).join(' | ')}` : ''}`,
          `${s.id} simple: ${m.lineaModo.length} "switch to In depth" lines: ${m.lineaModo.join(' | ')}`);
      }
      await pag.screenshot({ path: join(SALIDA, `modo_${s.id}_${modo}.png`) });
      if (s.id === 'visor') {
        await pag.evaluate(() => document.querySelector('.panel[data-lado=b] .hoja').scrollIntoView({ block: 'start' }));
        await pag.waitForTimeout(200);
        await pag.screenshot({ path: join(SALIDA, `modo_${s.id}_ficha_${modo}.png`) });
      }
      await ctx.close();
    }
    tabla.push(fila);
    comprobar(fila.fondo.fondoTotal ? fila.simple.palabras < fila.fondo.palabras : fila.simple.palabras === fila.fondo.palabras, `${s.id}: ${fila.fondo.palabras} visible words in depth → ${fila.simple.palabras} simple`, `${s.id}: simple ${fila.simple.palabras} words, in depth ${fila.fondo.palabras}`);
  }

  // ---------- 2. Se cambia con el botón, sin recargar, y sigue al navegar ----------
  {
    const ctx = await contexto(1600, 900, 'persist');
    const pag = await ctx.newPage();
    await pag.goto(`${base}/index.html`);
    await pag.waitForFunction(() => window.__az?.portada?.listo === true, null, { timeout: 60000 });
    const antes = await pag.evaluate(() => ({ modo: window.__azModo.leer(), guardado: localStorage.getItem('analog-zero.mode') }));
    comprobar(antes.modo === 'fondo' && antes.guardado === null, 'fresh browser: In depth, nothing stored', `fresh browser: ${JSON.stringify(antes)}`);
    const marca = await pag.evaluate(() => { window.__sinRecargar = 1; return 1; });
    await pag.click('.marca-modo button[data-valor=simple]');
    const tras = await pag.evaluate(() => ({ modo: document.documentElement.dataset.modo, guardado: localStorage.getItem('analog-zero.mode'), mismo: window.__sinRecargar, pulsado: document.querySelector('.marca-modo [aria-pressed=true]').textContent }));
    comprobar(marca === 1 && tras.modo === 'simple' && tras.guardado === 'simple' && tras.mismo === 1 && tras.pulsado === 'Simple', 'click "Simple": switches without reload and stores "simple"', `click Simple: ${JSON.stringify(tras)}`);
    await pag.click('.marca-barra a[href="mapa/index.html"]');
    await pag.waitForURL(/\/mapa\//);
    const enMapa = await pag.evaluate(() => ({ modo: document.documentElement.dataset.modo, url: location.search }));
    comprobar(enMapa.modo === 'simple' && !/modo=/.test(enMapa.url), 'link to the Global map: still Simple (no ?modo= in the URL)', `after the link: ${JSON.stringify(enMapa)}`);
    await pag.goto(`${base}/explorar/index.html?mundo=mars`);
    await pag.waitForFunction(() => window.__az?.vista?.listo === true, null, { timeout: 60000 });
    comprobar(await pag.evaluate(() => document.documentElement.dataset.modo) === 'simple', 'another page opened by address: Simple', 'another page: not Simple');
    await pag.goto(`${base}/datos/index.html?modo=fondo`);
    const url = await pag.evaluate(() => ({ modo: document.documentElement.dataset.modo, guardado: localStorage.getItem('analog-zero.mode') }));
    comprobar(url.modo === 'fondo' && url.guardado === 'fondo', '?modo=fondo wins over the stored Simple and is stored', `?modo=fondo: ${JSON.stringify(url)}`);
    await pag.goto(`${base}/index.html`);
    comprobar(await pag.evaluate(() => document.documentElement.dataset.modo) === 'fondo', 'next page without ?modo=: In depth', 'next page without ?modo=: not In depth');
    await pag.evaluate(() => window.__azModo.poner('simple'));
    comprobar(await pag.evaluate(() => [document.documentElement.dataset.modo, document.querySelector('.marca-modo [aria-pressed=true]').textContent].join()) === 'simple,Simple', '__azModo.poner("simple") switches and presses the button', '__azModo.poner failed');
    await pag.goto(`${base}/index.html?modo=nonsense`);
    comprobar(await pag.evaluate(() => document.documentElement.dataset.modo) === 'simple', '?modo=nonsense ignored: the stored Simple stays', '?modo=nonsense changed the mode');
    await ctx.close();
  }

  // ---------- 3. Móvil: el conmutador cuelga bajo la barra, dentro de la pantalla y sin pisar mandos ----------
  for (const [s, otros] of [[PANTALLAS[0], ['.intro']], [PANTALLAS[1], ['#reiniciar', '#panel']], [PANTALLAS[2], ['#mandos > :not([hidden])', '#panel']]]) {
    for (const modo of ['fondo', 'simple']) {
      const ctx = await contexto(390, 844, `${s.id} mobile ${modo}`, { isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
      const pag = await ctx.newPage();
      await pag.goto(`${base}/${s.url}${s.url.includes('?') ? '&' : '?'}modo=${modo}`);
      await pag.waitForFunction(s.listo, null, { timeout: 120000 });
      await s.tras?.(pag);
      const m = await medir(pag);
      const choques = await pag.evaluate((sels) => {
        const g = document.querySelector('.marca-modo').getBoundingClientRect();
        return sels.flatMap((sel) => [...document.querySelectorAll(sel)].filter((e) => e.getClientRects().length).map((e) => [sel, e.getBoundingClientRect()]))
          .filter(([, r]) => r.left < g.right && r.right > g.left && r.top < g.bottom && r.bottom > g.top).map(([sel]) => sel);
      }, otros);
      const c = m.grupo.caja;
      comprobar(c.l >= 0 && c.r <= 390 && c.t >= m.alto - 1.5 && m.ancho <= 390 && Math.abs(m.alto - m.altoSin) < 0.5 && !choques.length,
        `${s.id} mobile ${modo}: switch at ${c.l.toFixed(0)}–${c.r.toFixed(0)} × ${c.t.toFixed(0)}–${c.b.toFixed(0)} px under the ${m.alto.toFixed(1)} px bar, nothing under it`,
        `${s.id} mobile ${modo}: switch ${JSON.stringify(c)}, bar ${m.alto}/${m.altoSin}, page ${m.ancho}, overlaps ${choques.join(', ')}`);
      if (modo === 'simple') comprobar(!m.fondoVisibles.length, `${s.id} mobile simple: no .solo-fondo visible`, `${s.id} mobile simple: ${m.fondoVisibles.join(' | ')}`);
      await pag.screenshot({ path: join(SALIDA, `modo_movil_${s.id}_${modo}.png`) });
      await ctx.close();
    }
  }
} catch (e) {
  comprobar(false, '', `script error: ${e.stack ?? e}`);
} finally {
  await nav.close();
  servidor.close();
}

console.log('\nvisible words   in depth   simple');
for (const f of tabla) console.log(`${f.id.padEnd(14)} ${String(f.fondo?.palabras ?? '—').padStart(9)} ${String(f.simple?.palabras ?? '—').padStart(8)}`);
console.log(fallos.length ? `\n${fallos.length} FAILED` : '\nALL OK');
process.exit(fallos.length ? 1 : 0);
