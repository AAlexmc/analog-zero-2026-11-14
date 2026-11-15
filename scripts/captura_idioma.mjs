// Idioma en Chromium: (a) por defecto inglés y nada traducido; (b) ES pasa a español sin perder la URL, sigue al navegar y
// con ?lang=, EN vuelve; (c) en español, % de textos visibles traducidos por pantalla (Simple: falla bajo el 90 %; In depth:
// solo se imprime); (d) las cifras visibles son las mismas en los dos idiomas; (e) la barra mide lo mismo en los dos y a
// 390 px los conmutadores caben sin pisarse; (f) consola limpia. Capturas capturas/idioma_*.png.
// Uso: node scripts/captura_idioma.mjs
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { chromium } from 'playwright';

const RAIZ = resolve(new URL('..', import.meta.url).pathname);
const WEB = join(RAIZ, 'web');
const SALIDA = join(RAIZ, 'capturas');
const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm', '.svg': 'image/svg+xml' };
const MIN_SIMPLE = 90;
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

async function contexto(ancho, alto, etiqueta) {
  const ctx = await nav.newContext({ viewport: { width: ancho, height: alto } });
  ctx.on('page', (pag) => {
    pag.on('console', (m) => { if (m.type() === 'error') comprobar(false, '', `console error (${etiqueta}): ${m.text()}`); });
    pag.on('pageerror', (e) => comprobar(false, '', `page error (${etiqueta}): ${e.message}`));
  });
  return ctx;
}

const esperar = (pag, f, ms = 120000) => pag.waitForFunction(f, null, { timeout: ms });
const listoIdioma = (pag) => esperar(pag, () => window.__azIdioma?.estado?.listo === true, 30000);
const listoAnalogos = async (pag) => { await esperar(pag, () => window.__az?.analogos?.listo === true); await pag.evaluate(() => { window.__az.analogos.autoTerreno = false; }); };
const listoMundo = async (pag) => { await esperar(pag, () => window.__az?.vista?.listo === true); await pag.waitForTimeout(1200); };
const listoVisor = async (pag) => { await esperar(pag, () => window.__az?.listo === true, 180000); await pag.waitForTimeout(800); };
const JEZERO = 'mundo=mars&lat=18.38&lon=77.58&nombre=Jezero%20crater';
const SIM = 'terreno/index.html?lugar=75.25,-84.25&nombre=Test+place&b=shackleton&punto=-89.5,120&mundo=moon&vista=aerea';
const SIM_MARTE = 'terreno/index.html?lugar=-23.8634,-69.1328&nombre=Test+place&punto=-4.5895,137.4417&mundo=mars&vista=aerea';
// Ficha de la primera pieza de la base, abierta y fijada (en Simple la tabla está escondida).
const abrirFicha = async (p) => {
  await p.evaluate(() => { const pa = window.__az.paneles[1]; const uid = pa.plantados?.lista[0]?.uid; if (uid != null) window.__az.asentamiento.fichaDe(pa, uid, true); });
  await p.waitForTimeout(800);
};
const generarBase = async (p) => {
  await p.evaluate(() => window.__az.asentamiento.generar());
  await esperar(p, () => window.__az.asentamiento.estado.trabajando === false, 180000);
  await p.waitForTimeout(900);
};

// Pantallas y estados (los mismos que la cosecha, scripts/idioma_cosecha.mjs). foto = captura en español y Simple.
const RECORRIDOS = [
  { url: 'index.html', listo: (p) => esperar(p, () => window.__az?.portada?.listo === true), estados: [['portada', async () => {}, 'portada']] },
  { url: 'explorar/index.html?mundo=mars', listo: listoMundo, estados: [['mundo_mars', async () => {}]] },
  { url: 'explorar/index.html?mundo=moon&lat=-89.68643&lon=-162.9371', listo: listoMundo, estados: [
    ['mundo_sitio', async () => {}, 'mundo'],
    ['mundo_mision', async (p) => {
      const v = await p.$$eval('#mision option', (os) => os.map((o) => o.value).filter((x) => x && x !== 'nueva'));
      if (!v.length) return;
      await p.selectOption('#mision', v[0]);
      await esperar(p, () => window.__az.vista.misionPuntos && window.__az.vista.misionPuntos.estado !== 'calculando', 60000);
      await p.waitForTimeout(1500);
    }, 'mundo_mision'],
  ] },
  { url: `analogos/index.html?${JEZERO}`, listo: listoAnalogos, estados: [
    ['res_places', async () => {}, 'resultados'],
    ['res_metrics', async (p) => { await p.click('#tab-metricas'); await p.waitForTimeout(300); }],
    ['res_portfolio', async (p) => { const t = await p.$('#tab-cartera'); if (t) { await t.click(); await p.waitForTimeout(800); } }],
    ['res_calendar', async (p) => { await p.click('#tab-calendario'); await esperar(p, () => !!document.querySelector('#calendario h1'), 60000); await p.waitForTimeout(300); }],
  ] },
  { url: `analogos/index.html?${JEZERO}&mision=taladros&mes=7`, listo: listoAnalogos, estados: [
    ['resm_places', async () => {}],
    ['resm_calendar', async (p) => { await p.click('#tab-calendario'); await esperar(p, () => !!document.querySelector('#calendario h1'), 60000); await p.waitForTimeout(300); }],
  ] },
  { url: 'mapa/index.html', listo: async (p) => { await esperar(p, () => !document.querySelector('#hoja')?.textContent.includes('Loading')); await p.waitForTimeout(800); }, estados: [['mapa', async () => {}]] },
  { url: 'datos/index.html', listo: (p) => esperar(p, () => !!document.querySelector('#contenido .grupos')), estados: [['datos', async () => {}]] },
  { url: 'terreno/index.html?a=haughton&b=shackleton&mes=6', listo: listoVisor, estados: [['visor', async () => {}]] },
  { url: SIM, listo: listoVisor, estados: [
    ['sim', async () => {}],
    ['sim_dialogo', async (p) => { await p.click('#asentamiento [data-a=generar]'); await p.waitForSelector('dialog.as-dialogo[open]'); await p.waitForTimeout(300); }, 'dialogo'],
    ['sim_base', async (p) => { await p.keyboard.press('Escape'); await generarBase(p); }, 'visor_base'],
    ['sim_ficha', abrirFicha, 'ficha'],
    ['sim_dia', async (p) => { await p.evaluate(() => window.__az.dia.ir(9)); await esperar(p, () => window.__az.dia.listo(), 120000); await p.waitForTimeout(700); }],
    ['sim_suelo', async (p) => { await p.click('.panel[data-lado=a] .suelo'); await p.waitForTimeout(1500); }],
    ['sim_paleta', async (p) => { await p.click('.panel[data-lado=b] .ver-paleta'); await p.waitForTimeout(500); }],
  ] },
  { url: SIM_MARTE, listo: listoVisor, estados: [
    ['marte', async () => {}],
    ['marte_base', generarBase, 'marte_base'],
    ['marte_ficha', abrirFicha],
    ['marte_dia', async (p) => { await p.evaluate(() => window.__az.dia.ir(9)); await esperar(p, () => window.__az.dia.listo(), 120000); await p.waitForTimeout(700); }],
  ] },
];

// Cobertura: nodos de texto visibles con letras (y aria-label/title/placeholder de lo visible) cuya plantilla no está
// en sinTraducir(). Fuera, como en la cosecha: lo que idioma.js no toca, citas, URL y nombres de fuentes de datos.
const cobertura = (pag) => pag.evaluate(async () => {
  const { plantilla } = await import('/marca/idioma.js');
  const pend = new Set(window.__azIdioma.estado.sinTraducir());
  const FUERA = '[data-notr], script, style, code, q, blockquote, noscript';
  const FUENTE = /^(?:©|\(c\) |Image: |Credit: |Elevation: |Contains modified Copernicus)|\b(?:LOLA|LDEM|MOLA|HRSC|Copernicus DEM|GLO-30|PDS Geosciences|SRTM|GMTED|ERA5|MODIS|CERES|Diviner|MERRA|GPM|WorldClim)\b/;
  const vale = (t) => /[A-Za-z]/.test(t) && !/[“”]/.test(t) && !/https?:\/\/|www\.|\b[\w-]+\.(?:gov|org|com|edu|int)\b/.test(t) && !FUENTE.test(t);
  const ve = (e) => e.checkVisibility({ checkOpacity: true, visibilityProperty: true });
  let total = 0;
  const faltan = new Map();
  const mirar = (v) => { const t = plantilla(v).t; total++; if (pend.has(t)) faltan.set(t, (faltan.get(t) ?? 0) + 1); };
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n; (n = w.nextNode());) {
    const p = n.parentElement;
    if (!p || p.closest(FUERA) || !ve(p)) continue;
    const t = n.nodeValue.replace(/\s+/g, ' ').trim();
    if (t && vale(t)) mirar(t);
  }
  for (const el of document.body.querySelectorAll('[aria-label], [title], [placeholder], [data-titulo]')) {
    if (el.closest(FUERA) || !ve(el)) continue;
    for (const a of ['aria-label', 'title', 'placeholder', 'data-titulo']) { const v = el.getAttribute(a); if (v && vale(v) && !(a === 'title' && el.closest('a[href]') && /[“"]/.test(v))) mirar(v); }
  }
  const nf = [...faltan.values()].reduce((s, x) => s + x, 0);
  return { total, faltan: nf, pct: total ? (100 * (total - nf)) / total : 100, lista: [...faltan.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t) };
});

const cifras = (pag) => pag.evaluate(() => [...new Set(document.body.innerText.match(/\d+(?:[.,]\d+)*/g) ?? [])].sort());
const barra = (pag) => pag.evaluate(() => {
  const b = document.querySelector('.marca-barra'), cs = getComputedStyle(b);
  const hijos = [...b.children].filter((e) => e.getClientRects().length);
  const linea = Math.max(...hijos.map((e) => e.getBoundingClientRect().height)) + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
  const cajas = [...b.querySelectorAll('.marca-modo')].map((g) => { const r = g.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom }; });
  return { alto: b.getBoundingClientRect().height, linea, cajas, vw: innerWidth };
});

const tabla = [];
try {
  // ---------- (a) por defecto inglés ----------
  {
    const ctx = await contexto(1600, 900, 'default');
    const pag = await ctx.newPage();
    await pag.goto(`${base}/index.html`);
    await esperar(pag, () => window.__az?.portada?.listo === true);
    await pag.waitForTimeout(800);
    const e = await pag.evaluate(() => ({ lang: document.documentElement.lang, i: window.__azIdioma?.leer(), n: window.__azIdioma?.estado.traducidos, botones: [...document.querySelectorAll('.marca-idioma button')].map((b) => `${b.textContent}:${b.getAttribute('aria-pressed')}`).join() }));
    comprobar(e.lang === 'en' && e.i === 'en' && e.n === 0 && e.botones === 'EN:true,ES:false', `default: English, ${e.n} texts translated, switch ${e.botones}`, `default: ${JSON.stringify(e)}`);

    // ---------- (b) ES, persistencia, ?lang=, EN ----------
    const q = `analogos/index.html?${JEZERO}`;
    await pag.goto(`${base}/${q}`);
    await listoAnalogos(pag);
    await Promise.all([pag.waitForNavigation(), pag.click('.marca-idioma [data-valor=es]')]);
    await listoAnalogos(pag);
    await listoIdioma(pag);
    let u = new URL(pag.url());
    comprobar(await pag.evaluate(() => document.documentElement.lang) === 'es' && u.pathname === '/analogos/index.html' && u.searchParams.get('nombre') === 'Jezero crater' && u.searchParams.get('lat') === '18.38',
      `ES: Spanish, address kept (${u.pathname}${u.search})`, `ES: lang ${await pag.evaluate(() => document.documentElement.lang)} at ${pag.url()}`);
    await pag.goto(`${base}/datos/index.html`);
    await listoIdioma(pag);
    comprobar(await pag.evaluate(() => document.documentElement.lang) === 'es', 'ES kept when going to another page', 'Spanish lost when going to another page');
    await pag.goto(`${base}/datos/index.html?lang=en`);
    await pag.waitForTimeout(500);
    comprobar(await pag.evaluate(() => document.documentElement.lang === 'en' && window.__azIdioma.estado.traducidos === 0), '?lang=en wins over the saved Spanish', '?lang=en does not give English');
    await pag.goto(`${base}/index.html?lang=es`);
    await listoIdioma(pag);
    await pag.goto(`${base}/index.html`);
    await listoIdioma(pag);
    comprobar(await pag.evaluate(() => document.documentElement.lang) === 'es', '?lang=es is remembered', '?lang=es not remembered');
    await Promise.all([pag.waitForNavigation(), pag.click('.marca-idioma [data-valor=en]')]);
    await pag.waitForTimeout(500);
    comprobar(await pag.evaluate(() => document.documentElement.lang === 'en' && window.__azIdioma.estado.traducidos === 0 && document.body.innerText.includes('Explore the Moon')), 'EN goes back to English', 'EN does not go back to English');
    await ctx.close();
  }

  // ---------- (c) cobertura por pantalla, (d) cifras, (e) barra ----------
  for (const modo of ['simple', 'fondo']) {
    for (const r of RECORRIDOS) {
      const ctx = await contexto(1600, 900, `${r.url} ${modo}`);
      const pag = await ctx.newPage();
      const ir = async (lang) => {
        await pag.goto(`${base}/${r.url}${r.url.includes('?') ? '&' : '?'}modo=${modo}&lang=${lang}`);
        await r.listo(pag);
        await listoIdioma(pag);
      };
      // Inglés: cifras y barra de referencia (solo en Simple, para no duplicar).
      const ref = {};
      if (modo === 'simple') {
        await ir('en');
        for (const [id, paso] of r.estados) { await paso(pag); ref[id] = { cifras: await cifras(pag), barra: await barra(pag) }; }
      }
      await ir('es');
      for (const [id, paso, foto] of r.estados) {
        await paso(pag);
        await pag.waitForTimeout(300);
        const c = await cobertura(pag);
        tabla.push({ id, modo, pct: c.pct, total: c.total });
        const txt = `${id} ${modo}: ${c.pct.toFixed(1)} % of ${c.total} visible texts in Spanish`;
        if (modo === 'simple') comprobar(c.pct >= MIN_SIMPLE, txt, `${txt} (under ${MIN_SIMPLE} %)`); else console.log(`info ${txt}`);
        for (const t of c.lista.slice(0, 15)) console.log(`       pending: ${t}`);
        if (modo === 'simple') {
          const b = await barra(pag);
          comprobar(Math.abs(b.alto - ref[id].barra.alto) < 0.5 && b.alto <= b.linea + 0.5, `${id}: bar ${b.alto.toFixed(1)} px in Spanish = ${ref[id].barra.alto.toFixed(1)} px in English, one line`, `${id}: bar ${b.alto} px in Spanish, ${ref[id].barra.alto} px in English, one line ${b.linea}`);
          if (['res_places', 'sim_base'].includes(id)) {
            const es = await cifras(pag), en = ref[id].cifras;
            const solo = (a, b) => a.filter((x) => !b.includes(x));
            comprobar(!solo(es, en).length && !solo(en, es).length, `${id}: the same ${es.length} figures in English and Spanish`, `${id}: figures differ: only Spanish ${solo(es, en).join(' ')} · only English ${solo(en, es).join(' ')}`);
          }
          if (foto) await pag.screenshot({ path: join(SALIDA, `idioma_${foto}.png`) });
        }
      }
      await ctx.close();
    }
  }

  // ---------- (e) móvil: conmutadores dentro y sin pisarse ----------
  for (const url of ['index.html', `analogos/index.html?${JEZERO}`, 'terreno/index.html?a=haughton&b=shackleton&mes=6']) {
    const ctx = await contexto(390, 844, `mobile ${url}`);
    const pag = await ctx.newPage();
    await pag.goto(`${base}/${url}${url.includes('?') ? '&' : '?'}lang=es&modo=simple`);
    await listoIdioma(pag);
    await pag.waitForTimeout(1500);
    const b = await barra(pag);
    const dentro = b.cajas.every((c) => c.l >= 0 && c.r <= b.vw + 0.5);
    const [x, y] = b.cajas;
    const pisan = x && y && !(x.r <= y.l || y.r <= x.l || x.b <= y.t || y.b <= x.t);
    comprobar(b.cajas.length === 2 && dentro && !pisan, `390 px ${url}: both switches inside the screen and apart`, `390 px ${url}: switches ${JSON.stringify(b.cajas)} in ${b.vw} px`);
    if (url === 'index.html') await pag.screenshot({ path: join(SALIDA, 'idioma_movil.png') });
    await ctx.close();
  }
} catch (e) {
  fallos.push(`exception: ${e.message.split('\n')[0]}`);
  console.error(e);
}

console.log('\nscreen           mode    Spanish  texts');
for (const f of tabla) console.log(`${f.id.padEnd(16)} ${f.modo.padEnd(7)} ${f.pct.toFixed(1).padStart(6)} %  ${f.total}`);
await nav.close();
servidor.close();
console.log(fallos.length ? `\n${fallos.length} FAIL` : '\nall ok');
process.exit(fallos.length ? 1 : 0);
