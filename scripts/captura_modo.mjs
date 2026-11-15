// Modo de lectura «Simple» / «In depth» en Chromium: en In depth (por defecto) .solo-fondo no cambia nada y .solo-simple
// no se ve; en Simple ningún .solo-fondo se ve; la barra mide lo mismo en los dos modos y sin el conmutador; el modo
// sigue al navegar y ?modo= manda; palabras visibles por pantalla en cada modo; en Simple ningún bloque de texto pasa de
// 14 palabras salvo créditos de licencia y avisos de error (también en el visor de una simulación con base, Day y vista
// de suelo); móvil sin solapes; consola limpia.
// Uso: node scripts/captura_modo.mjs
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { chromium } from 'playwright';

const RAIZ = resolve(new URL('..', import.meta.url).pathname);
const WEB = join(RAIZ, 'web');
const SALIDA = join(RAIZ, 'capturas');
const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm' };
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
  { id: 'cartera', url: `analogos/index.html?${JEZERO}`, listo: () => window.__az?.analogos?.listo === true, tras: async (pag) => { await pag.evaluate(() => { window.__az.analogos.autoTerreno = false; }); await pag.click('#tab-cartera'); await pag.waitForTimeout(300); } },
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

// Brevedad en Simple: bloques de texto visibles (fuera de botones y mandos) con más de MAX_PALABRAS palabras con letras.
const MAX_PALABRAS = 14;
// Excepciones justificadas: créditos que exige la licencia y avisos de error.
const EXCEPCIONES = [
  { re: /^Image: NASA|Credit: NASA|^Elevation data: Copernicus DEM|Contains modified Copernicus/, por: 'licence credit' },
  { re: /could not load|failed to load|No connection|offline/i, por: 'error notice' },
];
const largos = (pag) => pag.evaluate((max) => {
  const mando = 'button, select, option, input, textarea, label, summary, [role=button], [role=tab], .marca-modo, .marca-barra nav, canvas';
  const bloque = (e) => { for (let x = e; x && x !== document.body; x = x.parentElement) { const d = getComputedStyle(x).display; if (!d.startsWith('inline') && d !== 'contents') return x; } return document.body; };
  const grupos = new Map();
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n; (n = w.nextNode());) {
    const t = n.textContent.replace(/\s+/g, ' ').trim();
    const p = n.parentElement;
    if (!t || !p || p.closest(`script, style, noscript, ${mando}`)) continue;
    if (!p.checkVisibility({ checkOpacity: true, visibilityProperty: true })) continue;
    const b = bloque(p);
    grupos.set(b, `${grupos.get(b) ?? ''} ${t}`);
  }
  return [...grupos.values()].map((t) => t.trim()).filter((t) => (t.match(/\S*\p{L}\S*/gu) ?? []).length > max);
}, MAX_PALABRAS);
async function brevedad(pag, id) {
  const ls = await largos(pag);
  const malos = ls.filter((t) => !EXCEPCIONES.some((x) => x.re.test(t)));
  for (const t of ls) console.log(`     ${malos.includes(t) ? 'LONG' : 'kept'} [${id}] ${t}`);
  comprobar(!malos.length, `${id} simple: no visible text block over ${MAX_PALABRAS} words${ls.length ? ` (${ls.length} allowed exceptions)` : ''}`, `${id} simple: ${malos.length} text blocks over ${MAX_PALABRAS} words`);
}

// Visor desde una simulación: base generada, ficha abierta, Day en marcha y vista de suelo.
const SIM = 'terreno/index.html?lugar=75.25,-84.25&nombre=Test+place&b=shackleton&punto=-89.5,120&mundo=moon&vista=aerea';
const ESTADOS_SIM = [
  { id: 'sim_base', paso: async (pag) => {
    await pag.evaluate(() => window.__az.asentamiento.generar());
    await pag.waitForFunction(() => window.__az.asentamiento.estado.trabajando === false, null, { timeout: 180000 });
    await pag.waitForTimeout(900);
    await pag.locator('.panel[data-lado=b] .marca .rot').first().click({ force: true });
    await pag.waitForFunction(() => !document.querySelector('.panel[data-lado=b] .hoja')?.hidden, null, { timeout: 20000 });
    await pag.mouse.move(5, 895);
  } },
  { id: 'sim_dia', paso: async (pag) => { await pag.evaluate(() => window.__az.dia.ir(9)); await pag.waitForFunction(() => window.__az.dia.listo(), null, { timeout: 120000 }); await pag.waitForTimeout(700); } },
  { id: 'sim_suelo', paso: async (pag) => { await pag.click('.panel[data-lado=a] .suelo'); await pag.waitForTimeout(1500); } },
];

// Comprobaciones de cada pantalla en un modo (y brevedad en Simple).
async function revisar(pag, id, modo) {
  const m = await medir(pag);
  comprobar(m.modo === modo, `${id} ${modo}: data-modo="${m.modo}"`, `${id} ${modo}: data-modo is "${m.modo}"`);
  comprobar(m.grupo.rol === 'group' && m.grupo.etiqueta === 'Reading mode' && m.grupo.botones.map((b) => `${b.t}:${b.p}`).join() === (modo === 'simple' ? 'Simple:true,In depth:false' : 'Simple:false,In depth:true'),
    `${id} ${modo}: switch ${m.grupo.botones.map((b) => `${b.t}${b.p === 'true' ? '*' : ''}`).join(' | ')}`, `${id} ${modo}: switch ${JSON.stringify(m.grupo)}`);
  comprobar(Math.abs(m.alto - m.altoSin) < 0.5 && m.alto <= m.unaLinea + 0.5, `${id} ${modo}: bar ${m.alto.toFixed(1)} px = without the switch ${m.altoSin.toFixed(1)} px, one line (${m.unaLinea.toFixed(1)} px)`,
    `${id} ${modo}: bar ${m.alto} px, without the switch ${m.altoSin} px, one line ${m.unaLinea} px`);
  comprobar(m.ancho <= 1600, `${id} ${modo}: page ${m.ancho} px wide`, `${id} ${modo}: page ${m.ancho} px wide`);
  if (modo === 'fondo') {
    comprobar(!m.simpleVisibles.length, `${id} in depth: no .solo-simple visible`, `${id} in depth: .solo-simple visible: ${m.simpleVisibles.join(' | ')}`);
    comprobar(!m.cambia.length, `${id} in depth: the ${m.fondoTotal} .solo-fondo look exactly as without the class`, `${id} in depth: .solo-fondo changes visibility: ${m.cambia.join(' | ')}`);
  } else {
    comprobar(!m.fondoVisibles.length, `${id} simple: none of the ${m.fondoTotal} .solo-fondo visible`, `${id} simple: .solo-fondo visible: ${m.fondoVisibles.join(' | ')}`);
    // Sin nada que esconder, o en la portada (solo cambia una frase por su versión corta), no hay línea «switch to In depth».
    const lineas = m.fondoTotal && id !== 'portada' ? 1 : 0;
    comprobar(m.lineaModo.length === lineas, `${id} simple: ${lineas ? `one line "${m.lineaModo[0]}"` : 'nothing to hide, no "switch to In depth" line'}${m.simpleVisibles.length > m.lineaModo.length ? `; other .solo-simple: ${m.simpleVisibles.filter((t) => !m.lineaModo.includes(t)).join(' | ')}` : ''}`,
      `${id} simple: ${m.lineaModo.length} "switch to In depth" lines: ${m.lineaModo.join(' | ')}`);
  }
  if (modo === 'simple') await brevedad(pag, id);
  return m;
}

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
      const m = await revisar(pag, s.id, modo);
      fila[modo] = m;
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

  // ---------- 1b. Visor desde una simulación, estado a estado ----------
  {
    const filas = ESTADOS_SIM.map((x) => ({ id: x.id }));
    for (const modo of ['fondo', 'simple']) {
      const ctx = await contexto(1600, 900, `sim ${modo}`);
      const pag = await ctx.newPage();
      await pag.goto(`${base}/${SIM}&modo=${modo}`);
      await pag.waitForFunction(() => window.__az?.listo === true, null, { timeout: 180000 });
      await pag.waitForTimeout(600);
      for (const [i, x] of ESTADOS_SIM.entries()) {
        await x.paso(pag);
        filas[i][modo] = await revisar(pag, x.id, modo);
        await pag.screenshot({ path: join(SALIDA, `modo_${x.id}_${modo}.png`) });
        if (x.id === 'sim_base') {
          await pag.evaluate(() => document.querySelector('.panel[data-lado=b] .hoja').scrollIntoView({ block: 'start' }));
          await pag.waitForTimeout(200);
          await pag.screenshot({ path: join(SALIDA, `modo_sim_ficha_${modo}.png`) });
          await pag.evaluate(() => document.querySelector('.panel[data-lado=b] .hoja').scrollIntoView({ block: 'end' }));
          await pag.waitForTimeout(200);
          await pag.screenshot({ path: join(SALIDA, `modo_sim_ficha_pie_${modo}.png`) });
          await pag.evaluate(() => window.scrollTo(0, 0));
        }
      }
      await ctx.close();
    }
    for (const f of filas) {
      tabla.push(f);
      comprobar(f.simple.palabras < f.fondo.palabras, `${f.id}: ${f.fondo.palabras} visible words in depth → ${f.simple.palabras} simple`, `${f.id}: simple ${f.simple.palabras} words, in depth ${f.fondo.palabras}`);
    }
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
