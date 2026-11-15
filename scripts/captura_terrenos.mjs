// Abre cada terreno de index.json en el visor (solo, ampliado), comprueba que pinta sin errores y guarda una captura.
// Uso: node scripts/captura_terrenos.mjs [id ...]
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { chromium } from 'playwright';

const RAIZ = resolve(new URL('..', import.meta.url).pathname);
const WEB = join(RAIZ, 'web');
const SALIDA = join(RAIZ, 'capturas', 'terrenos');
const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm' };

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

const indice = JSON.parse(await readFile(join(WEB, 'data/terreno/index.json'), 'utf8'));
const pedidos = process.argv.slice(2);
const terrenos = indice.terrenos.filter((t) => !pedidos.length || pedidos.includes(t.id));
for (const id of pedidos) if (!indice.terrenos.some((t) => t.id === id)) falla(`unknown terrain id: ${id}`);
const otro = (t) => (t.cuerpo === 'luna' ? indice.pareja_inicial.tierra : indice.pareja_inicial.luna);
await mkdir(SALIDA, { recursive: true });

const nav = await chromium.launch({ headless: true, args: ['--use-angle=gl-egl', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  for (const t of terrenos) {
    const pag = await nav.newPage({ viewport: { width: 1600, height: 900 } });
    const errs = [];
    pag.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    pag.on('pageerror', (e) => errs.push(e.message));
    const [a, b] = t.cuerpo === 'luna' ? [otro(t), t.id] : [t.id, otro(t)];
    try {
      await pag.goto(`${base}/terreno/index.html?a=${a}&b=${b}&solo=${t.id}`);
      await pag.waitForFunction(() => window.__az?.listo === true, null, { timeout: 60000 });
      const info = await pag.evaluate((id) => {
        const p = window.__az.paneles.find((x) => x.id === id);
        return { errores: window.__az.errores, lienzo: p?.escena?.muestraLienzo() ?? null, n: p?.escena?.n ?? null, capas: Object.keys(p?.escena?.meta?.capas ?? {}), picos: p?.escena?.meta?.picos_luz?.puntos?.length ?? null };
      }, t.id);
      if (info.errores.length) falla(`${t.id}: panel errors: ${info.errores.join('; ')}`);
      if (errs.length) falla(`${t.id}: console: ${errs.join('; ')}`);
      if (!info.lienzo || info.lienzo.colores < 20) falla(`${t.id}: canvas blank (${info.lienzo?.colores ?? 'no scene'} colours)`);
      else ok(`${t.id}: n=${info.n}, ${info.lienzo.colores} colours, layers ${info.capas.join(',')}${info.picos === null ? '' : `, ${info.picos} light peaks in meta`}`);
      await pag.waitForTimeout(300);
      await pag.screenshot({ path: join(SALIDA, `${t.id}.png`) });
    } catch (e) { falla(`${t.id}: ${e.message}`); }
    await pag.close();
  }
} finally { await nav.close(); servidor.close(); }

console.log(fallos.length ? `CAPTURA_TERRENOS: ${fallos.length} failure(s)` : 'CAPTURA_TERRENOS: ok');
process.exit(fallos.length ? 1 : 0);
