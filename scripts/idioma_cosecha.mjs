// Cosecha de textos para el diccionario español (web/marca/es.js): recorre en inglés, en los dos modos de lectura, las
// pantallas y estados de la web y apunta cada texto visible con letras (nodos de texto y aria-label/title/placeholder)
// pasado por plantilla() de idioma.js, con en qué pantalla y modo salió y si ya tiene traducción.
// Uso: node scripts/idioma_cosecha.mjs <salida.json>
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { chromium } from 'playwright';

const RAIZ = resolve(new URL('..', import.meta.url).pathname);
const WEB = join(RAIZ, 'web');
const SALIDA = process.argv[2];
if (!SALIDA) { console.error('usage: node scripts/idioma_cosecha.mjs <out.json>'); process.exit(2); }
const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm', '.svg': 'image/svg+xml' };

const servidor = createServer(async (req, res) => {
  const ruta = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
  const f = join(WEB, ruta.endsWith('/') ? `${ruta}index.html` : ruta);
  if (!f.startsWith(WEB)) { res.writeHead(403).end(); return; }
  try { res.writeHead(200, { 'content-type': TIPOS[extname(f)] ?? 'application/octet-stream' }).end(await readFile(f)); } catch { res.writeHead(404).end(); }
});
await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${servidor.address().port}`;
const nav = await chromium.launch({ headless: true, args: ['--use-angle=gl-egl', '--enable-gpu', '--ignore-gpu-blocklist'] });

// Textos visibles de la página, ya en plantilla. Fuera: citas, URL y nombres de fuentes o productos de datos.
export async function textosVisibles(pag) {
  return pag.evaluate(async () => {
    const { plantilla } = await import('/marca/idioma.js');
    const FUERA = '[data-notr], script, style, code, q, blockquote, noscript';
    const FUENTE = /^(?:©|\(c\) |Image: |Credit: |Elevation: |Contains modified Copernicus)|\b(?:LOLA|LDEM|MOLA|HRSC|Copernicus DEM|GLO-30|PDS Geosciences|SRTM|GMTED|ERA5|MODIS|CERES|Diviner|MERRA|GPM|WorldClim)\b/;
    const vale = (t) => /[A-Za-z]/.test(t) && !/[“”]/.test(t) && !/https?:\/\/|www\.|\b[\w-]+\.(?:gov|org|com|edu|int)\b/.test(t) && !FUENTE.test(t);
    const ve = (e) => e.checkVisibility({ checkOpacity: true, visibilityProperty: true });
    const out = [];
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n; (n = w.nextNode());) {
      const p = n.parentElement;
      if (!p || p.closest(FUERA) || !ve(p)) continue;
      const t = n.nodeValue.replace(/\s+/g, ' ').trim();
      if (!t || !vale(t)) continue;
      out.push({ t: plantilla(t).t, tipo: 'texto', ej: t.slice(0, 700) });
    }
    for (const el of document.body.querySelectorAll('[aria-label], [title], [placeholder], [data-titulo]')) {
      if (el.closest(FUERA) || !ve(el)) continue;
      for (const a of ['aria-label', 'title', 'placeholder', 'data-titulo']) {
        const v = el.getAttribute(a);
        if (!v || !vale(v)) continue;
        if (a === 'title' && el.closest('a[href]') && /[“"]/.test(v)) continue;
        out.push({ t: plantilla(v).t, tipo: a, ej: v.slice(0, 700) });
      }
    }
    return out;
  });
}

const esperar = (pag, f, ms = 120000) => pag.waitForFunction(f, null, { timeout: ms });
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

// Cada recorrido abre una URL y va pasando por estados; tras cada estado se cosecha.
export const RECORRIDOS = [
  { url: 'index.html', listo: (p) => esperar(p, () => window.__az?.portada?.listo === true), estados: [['portada', async () => {}]] },
  { url: 'explorar/index.html?mundo=moon', listo: listoMundo, estados: [['mundo_moon', async () => {}]] },
  { url: 'explorar/index.html?mundo=mars', listo: listoMundo, estados: [['mundo_mars', async () => {}]] },
  { url: 'explorar/index.html?mundo=moon&lat=-89.68643&lon=-162.9371', listo: listoMundo, estados: [
    ['mundo_sitio', async () => {}],
    ['mundo_mision', async (p) => {
      const v = await p.$$eval('#mision option', (os) => os.map((o) => o.value).filter((x) => x && x !== 'nueva'));
      if (!v.length) return;
      await p.selectOption('#mision', v[0]);
      await esperar(p, () => window.__az.vista.misionPuntos && window.__az.vista.misionPuntos.estado !== 'calculando', 60000);
      await p.waitForTimeout(1500);
    }],
  ] },
  { url: `analogos/index.html?${JEZERO}`, listo: listoAnalogos, estados: [
    ['res_places', async () => {}],
    ['res_metrics', async (p) => { await p.click('#tab-metricas'); await p.waitForTimeout(300); }],
    ['res_portfolio', async (p) => { const t = await p.$('#tab-cartera'); if (t) { await t.click(); await p.waitForTimeout(800); } }],
    ['res_calendar', async (p) => { await p.click('#tab-calendario'); await esperar(p, () => !!document.querySelector('#calendario h1'), 60000); await p.waitForTimeout(300); }],
  ] },
  { url: `analogos/index.html?${JEZERO}&mision=taladros&mes=7`, listo: listoAnalogos, estados: [
    ['resm_places', async () => { }],
    ['resm_metrics', async (p) => { await p.click('#tab-metricas'); await p.waitForTimeout(300); }],
    ['resm_portfolio', async (p) => { const t = await p.$('#tab-cartera'); if (t) { await t.click(); await p.waitForTimeout(800); } }],
    ['resm_calendar', async (p) => { await p.click('#tab-calendario'); await esperar(p, () => !!document.querySelector('#calendario h1'), 60000); await p.waitForTimeout(300); }],
  ] },
  { url: 'mapa/index.html', listo: async (p) => { await esperar(p, () => !document.querySelector('#hoja')?.textContent.includes('Loading')); await p.waitForTimeout(800); }, estados: [['mapa', async () => {}]] },
  { url: 'datos/index.html', listo: (p) => esperar(p, () => !!document.querySelector('#contenido .grupos')), estados: [['datos', async () => {}]] },
  { url: 'terreno/index.html?a=haughton&b=shackleton&mes=6', listo: listoVisor, estados: [['visor', async () => {}]] },
  { url: SIM, listo: listoVisor, estados: [
    ['sim', async () => {}],
    ['sim_dialogo', async (p) => { await p.click('#asentamiento [data-a=generar]'); await p.waitForSelector('dialog.as-dialogo[open]'); await p.waitForTimeout(300); }],
    ['sim_base', async (p) => {
      await p.keyboard.press('Escape');
      await p.evaluate(() => window.__az.asentamiento.generar());
      await esperar(p, () => window.__az.asentamiento.estado.trabajando === false, 180000);
      await p.waitForTimeout(900);
    }],
    ['sim_tabla', async (p) => {
      await p.evaluate(() => { for (const d of document.querySelectorAll('#asentamiento details, .as-tabla')) { const x = d.closest('details'); if (x) x.open = true; } });
      await p.waitForTimeout(300);
    }],
    ['sim_ficha', abrirFicha],
    ['sim_dia', async (p) => { await p.evaluate(() => window.__az.dia.ir(9)); await esperar(p, () => window.__az.dia.listo(), 120000); await p.waitForTimeout(700); }],
    ['sim_suelo', async (p) => { await p.click('.panel[data-lado=a] .suelo'); await p.waitForTimeout(1500); }],
    ['sim_paleta', async (p) => { await p.click('.panel[data-lado=b] .ver-paleta'); await p.waitForTimeout(500); }],
    ['sim_informe', async (p) => { await p.keyboard.press('Escape'); await p.click('#informe'); await p.waitForTimeout(1500); }],
  ] },
  { url: SIM_MARTE, listo: listoVisor, estados: [
    ['marte', async () => {}],
    ['marte_base', async (p) => {
      await p.evaluate(() => window.__az.asentamiento.generar());
      await esperar(p, () => window.__az.asentamiento.estado.trabajando === false, 180000);
      await p.waitForTimeout(900);
    }],
    ['marte_ficha', abrirFicha],
    ['marte_dia', async (p) => { await p.evaluate(() => window.__az.dia.ir(9)); await esperar(p, () => window.__az.dia.listo(), 120000); await p.waitForTimeout(700); }],
  ] },
];

if (import.meta.url === `file://${process.argv[1]}`) {
  const { TEXTOS } = await import('../web/marca/es.js');
  const { plantilla } = await import('../web/marca/idioma.js');
  const ya = new Set(Object.keys(TEXTOS).map((k) => plantilla(k).t));
  const res = {};
  const errores = [];
  for (const modo of ['simple', 'fondo']) {
    for (const r of RECORRIDOS) {
      const ctx = await nav.newContext({ viewport: { width: 1600, height: 900 } });
      const pag = await ctx.newPage();
      pag.on('pageerror', (e) => errores.push(`${r.url} ${modo}: ${e.message}`));
      try {
        await pag.goto(`${base}/${r.url}${r.url.includes('?') ? '&' : '?'}modo=${modo}&lang=en`);
        await r.listo(pag);
        for (const [id, paso] of r.estados) {
          try { await paso(pag); } catch (e) { errores.push(`${id} ${modo}: ${e.message.split('\n')[0]}`); }
          const ts = await textosVisibles(pag);
          for (const { t, tipo, ej } of ts) {
            const x = (res[t] ??= { pantallas: [], modos: [], veces: 0, tipo, ej, traducido: ya.has(t) });
            if (!x.pantallas.includes(id)) x.pantallas.push(id);
            if (!x.modos.includes(modo)) x.modos.push(modo);
            x.veces++;
          }
          console.log(`${modo} ${id}: ${ts.length} texts`);
        }
      } catch (e) { errores.push(`${r.url} ${modo}: ${e.message.split('\n')[0]}`); console.error(`ERR ${r.url} ${modo}: ${e.message.split('\n')[0]}`); }
      await ctx.close();
    }
  }
  await writeFile(SALIDA, JSON.stringify(res, null, 1));
  const total = Object.keys(res).length, faltan = Object.values(res).filter((x) => !x.traducido).length;
  console.log(`${total} templates, ${faltan} without translation; errors: ${errores.length}`);
  for (const e of errores) console.log(`  ${e}`);
  await nav.close();
  servidor.close();
}
