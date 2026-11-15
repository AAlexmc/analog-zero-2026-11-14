// Vídeo de presentación (≈ 30 s) hecho con la propia web y sus datos reales: el guion la recorre (reto → idea → cómo),
// saca fotogramas en Chromium y los monta con ffmpeg. Añadidos sobre la pantalla: el rótulo de abajo y un aro que marca
// dónde se pulsa (los clics son reales). Necesita red para las teselas del lugar de la Tierra.
// Uso: node scripts/video_pitch.mjs   → build/video/analog-zero-pitch.mp4 (y los fotogramas en build/video/pitch/)
import { createServer } from 'node:http';
import { readFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { extname, join, normalize, resolve } from 'node:path';
import { homedir } from 'node:os';
import { chromium } from 'playwright';

const RAIZ = resolve(new URL('..', import.meta.url).pathname);
const WEB = join(RAIZ, 'web');
const OUT = join(RAIZ, 'build', 'video');
const FRAMES = join(OUT, 'pitch');
const MP4 = join(OUT, 'analog-zero-pitch.mp4');
const DURACION_S = 29.8;
const FFMPEG = spawnSync('ffmpeg', ['-version']).status === 0 ? 'ffmpeg' : join(homedir(), '.local/bin/ffmpeg');
const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.glb': 'model/gltf-binary' };
// El punto de la Luna (el mejor sitio que da la propia web para el polo sur) y el lugar de la Tierra que sale primero para él.
const PUNTO = { lat: -89.4531, lon: -137.1476 }, LUGAR = { lat: 81.75, lon: -76.25 };

const servidor = createServer(async (req, res) => {
  const ruta = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
  const f = join(WEB, ruta.endsWith('/') ? `${ruta}index.html` : ruta);
  if (!f.startsWith(WEB)) { res.writeHead(403).end(); return; }
  try { res.writeHead(200, { 'content-type': TIPOS[extname(f)] ?? 'application/octet-stream' }).end(await readFile(f)); } catch { res.writeHead(404).end(); }
});
await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${servidor.address().port}`;
await rm(FRAMES, { recursive: true, force: true });
await mkdir(FRAMES, { recursive: true });

const nav = await chromium.launch({ headless: true, args: ['--use-angle=gl-egl', '--enable-gpu', '--ignore-gpu-blocklist'] });
const pag = await nav.newPage({ viewport: { width: 1920, height: 1080 } });
pag.on('pageerror', (e) => console.error(`page error: ${e.message}`));

const planos = [];
const dibujado = () => pag.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
async function foto(segundos, nombre) {
  await dibujado();
  await pag.waitForTimeout(120);
  const f = join(FRAMES, `${String(planos.length).padStart(3, '0')}-${nombre}.png`);
  await pag.screenshot({ path: f });
  planos.push({ f, s: segundos });
}
// Rótulo de abajo y aro de «aquí se pulsa»: lo único que no es de la web.
const rotulo = (paso, texto) => pag.evaluate(([paso, texto]) => {
  // Con un diálogo modal abierto el rótulo va dentro de él: fuera quedaría tapado.
  const capa = document.querySelector('dialog[open]') ?? document.body;
  let r = document.getElementById('vp-rotulo');
  if (r && r.parentElement !== capa) { r.remove(); r = null; }
  if (!r) {
    if (!document.getElementById('vp-estilo')) {
    const st = document.createElement('style');
    st.id = 'vp-estilo';
    st.textContent = `#vp-rotulo{position:fixed;left:50%;bottom:30px;transform:translateX(-50%);z-index:99999;width:max-content;max-width:1640px;padding:18px 36px;border-radius:20px;background:rgba(7,23,63,.95);border:2px solid #fff;color:#fff;font:700 40px/1.22 "Fira Sans","Overpass",system-ui,sans-serif;text-align:center;box-shadow:0 12px 44px rgba(0,0,0,.5)}
      #vp-rotulo b{display:block;margin-bottom:4px;color:#EAFE07;font:900 22px/1.2 "Fira Sans","Overpass",system-ui,sans-serif;letter-spacing:.14em}
      #vp-aro{position:fixed;z-index:99998;width:96px;height:96px;margin:-48px 0 0 -48px;border:7px solid #EAFE07;border-radius:50%;pointer-events:none;box-shadow:0 0 0 7px rgba(7,23,63,.55)}`;
    document.head.append(st);
    }
    r = document.createElement('div');
    r.id = 'vp-rotulo';
    r.dataset.notr = '';
    capa.append(r);
  }
  r.replaceChildren();
  if (paso) { const b = document.createElement('b'); b.textContent = paso; r.append(b); }
  r.append(texto ?? '');
  r.style.display = texto ? '' : 'none';
}, [paso, texto]);
async function aro(sel) {
  await pag.evaluate((sel) => {
    document.getElementById('vp-aro')?.remove();
    if (!sel) return;
    const r = document.querySelector(sel).getBoundingClientRect(), a = document.createElement('div');
    a.id = 'vp-aro';
    a.style.left = `${r.left + r.width / 2}px`;
    a.style.top = `${r.top + r.height / 2}px`;
    (document.querySelector('dialog[open]') ?? document.body).append(a);
  }, sel);
}
const ir = async (ruta, listo) => {
  await pag.goto(`${BASE}${ruta}`);
  await pag.waitForFunction(listo, null, { timeout: 240000 });
  await document_fonts();
  await pag.waitForTimeout(1500);
};
const document_fonts = () => pag.evaluate(() => document.fonts.ready.then(() => true));

try {
  // ---------- 1. El reto ----------
  await pag.goto(`${BASE}/index.html?modo=simple&lang=en`);
  await pag.waitForTimeout(5000);
  await document_fonts();
  await rotulo('THE CHALLENGE', 'Before a base lands on the Moon or Mars: where on Earth do we rehearse it?');
  await foto(3.6, 'reto');

  // ---------- 2. La idea: mundo, misión y punto ----------
  await ir('/explorar/index.html?mundo=moon', () => window.__az?.vista?.listo === true);
  await pag.waitForFunction(() => /Best spot/.test(document.getElementById('panel')?.textContent ?? document.body.textContent), null, { timeout: 120000 }).catch(() => {});
  await pag.waitForTimeout(2500);
  await rotulo('OUR IDEA', 'Pick a world, a mission and a point on it…');
  await foto(2.0, 'mundo');
  await aro('#buscar');
  await rotulo('OUR IDEA', '…and we look for its twin on the whole Earth.');
  await foto(1.6, 'mundo-buscar');

  // ---------- 3. Cómo: toda la Tierra, parámetro a parámetro, mes a mes ----------
  await ir(`/analogos/index.html?mundo=moon&lat=${PUNTO.lat}&lon=${PUNTO.lon}`, () => window.__az?.analogos?.listo === true);
  await pag.evaluate(() => { window.__az.analogos.autoTerreno = false; });
  await pag.waitForTimeout(2500);
  await rotulo('HOW', 'The places on Earth most like your point, ranked by measured data.');
  await foto(2.2, 'resultados');
  await aro('#tab-metricas');
  await foto(0.4, 'resultados-aro');
  await aro(null);
  await pag.click('#tab-metricas');
  await pag.waitForTimeout(900);
  await rotulo('HOW', 'Parameter by parameter: what matches, and what Earth cannot reproduce.');
  await foto(2.0, 'metricas');
  await pag.click('#tab-calendario');
  await pag.waitForFunction(() => /Month by month/.test(document.getElementById('calendario')?.textContent ?? ''), null, { timeout: 120000 });
  await pag.waitForTimeout(900);
  await rotulo('HOW', 'Month by month: when to go, and when to move the test.');
  await foto(1.7, 'calendario');

  // ---------- 4. Ensayarlo: la misma base en los dos mundos ----------
  await ir(`/terreno/index.html?lugar=${LUGAR.lat.toFixed(4)}%2C${LUGAR.lon.toFixed(4)}&nombre=Place+1&b=cresta_shackleton_gerlache&punto=${PUNTO.lat}%2C${PUNTO.lon}&mundo=moon&vista=aerea&mes=7`, () => window.__az?.listo === true);
  const aviso = await pag.evaluate(() => window.__az.avisoLugar ?? null);
  if (aviso) throw new Error(`the Earth place could not be built (network?): ${aviso}`);
  await rotulo('REHEARSE IT', 'That place on Earth, next to your point on the Moon, at the same scale.');
  await foto(1.8, 'simulacion');
  await aro('#asentamiento [data-a=generar]');
  await foto(0.4, 'simulacion-aro');
  await aro(null);
  await pag.click('#asentamiento [data-a=generar]');
  await pag.waitForSelector('dialog.as-dialogo[open]');
  await rotulo('REHEARSE IT', 'Rank what your base needs most…');
  await foto(1.5, 'prioridades');
  await pag.click('dialog.as-dialogo [data-a=ok]');
  await pag.waitForFunction(() => window.__az.asentamiento.estado.trabajando === false, null, { timeout: 240000 });
  await pag.waitForTimeout(1500);
  await rotulo('REHEARSE IT', '…and it is laid out on both worlds. Red: a published limit breaks.');
  // Órbita corta de las dos cámaras alrededor de la base.
  const GIROS = 18;
  for (let k = 0; k < GIROS; k++) {
    await pag.evaluate((paso) => {
      for (const p of window.__az.paneles) {
        const e = p.escena, t = e.controles.target, c = e.camara.position, dx = c.x - t.x, dz = c.z - t.z, a = paso * Math.PI / 180;
        c.set(t.x + dx * Math.cos(a) - dz * Math.sin(a), c.y, t.z + dx * Math.sin(a) + dz * Math.cos(a));
        e.camara.lookAt(t); e.controles.update(); e.sucio = true;
      }
    }, k === 0 ? 0 : 1.3);
    await foto(k === 0 ? 0.5 : 0.13, `base-${String(k).padStart(2, '0')}`);
  }
  // El día hora a hora.
  await rotulo('REHEARSE IT', 'The real Sun, hour by hour, with the shadows of the terrain.');
  await pag.evaluate(() => window.__az.dia.ir(3));
  await pag.waitForFunction(() => window.__az.dia.listo(), null, { timeout: 240000 });
  for (let h = 3; h <= 21; h++) {
    await pag.evaluate((h) => window.__az.dia.ir(h), h);
    await pag.waitForFunction(() => window.__az.dia.listo(), null, { timeout: 120000 });
    await foto(h === 21 ? 0.5 : 0.15, `dia-${String(h).padStart(2, '0')}`);
  }
  // La ficha de una pieza en los dos mundos.
  await pag.evaluate(() => { const p = window.__az.paneles.find((x) => x.escena.meta.cuerpo !== 'tierra'), it = p.plantados.lista.find((x) => x.equipo === 'torre_solar') ?? p.plantados.lista[0]; window.__az.asentamiento.fichaDe(p, it.uid, true); });
  await pag.waitForTimeout(700);
  await rotulo('REHEARSE IT', 'Each piece, read on both worlds: slope, limits, light through the day.');
  await foto(2.0, 'ficha');
  await pag.keyboard.press('Escape');

  // ---------- 5. El informe ----------
  await aro('#informe');
  await rotulo('ONE CLICK', 'A report with every number, chart and source…');
  await foto(0.5, 'informe-aro');
  await aro(null);
  await pag.click('#informe');
  await pag.waitForFunction(() => !!window.__az.informe.ultimo().html && document.querySelector('.inf-dialogo')?.open, null, { timeout: 240000 });
  await pag.waitForTimeout(1200);
  await rotulo('ONE CLICK', 'A report with every number, chart and source…');
  await foto(1.3, 'informe');
  const aSeccion = (id) => pag.evaluate((id) => { document.querySelector('.inf-dialogo iframe').contentDocument.getElementById(id)?.scrollIntoView(); }, id);
  await rotulo('ONE CLICK', '…to preview, download or print.');
  await aSeccion('s4');
  await foto(1.2, 'informe-sol');
  await aSeccion('s6');
  await foto(1.2, 'informe-base');

  // ---------- 6. Para todos, y cierre ----------
  await ir(`/analogos/index.html?mundo=moon&lat=${PUNTO.lat}&lon=${PUNTO.lon}&lang=es&modo=simple`, () => window.__az?.analogos?.listo === true && window.__azIdioma?.estado.listo === true);
  await pag.waitForTimeout(2000);
  await rotulo('FOR EVERYONE', 'Simple or in depth. English or Spanish.');
  await foto(1.6, 'idioma');
  await pag.goto(`${BASE}/index.html?modo=simple&lang=en`);
  await pag.waitForTimeout(5000);
  await rotulo('ANALOG ZERO', 'Test here first. Fail here, not there.');
  await foto(2.4, 'cierre');

  // ---------- Montaje ----------
  const total = planos.reduce((s, p) => s + p.s, 0), k = DURACION_S / total;
  const lista = `${planos.map((p) => `file '${p.f}'\nduration ${(p.s * k).toFixed(4)}`).join('\n')}\nfile '${planos.at(-1).f}'\n`;
  await writeFile(join(FRAMES, 'lista.txt'), lista);
  const r = spawnSync(FFMPEG, ['-y', '-f', 'concat', '-safe', '0', '-i', join(FRAMES, 'lista.txt'), '-vf', 'fps=30,format=yuv420p', '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-t', String(DURACION_S), '-movflags', '+faststart', MP4], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffmpeg: ${r.stderr.slice(-600)}`);
  console.log(`ok   ${planos.length} frames, ${total.toFixed(1)} s of script scaled to ${DURACION_S} s → ${MP4}`);
} catch (e) {
  console.error(`FAIL ${e.message}`);
  process.exitCode = 1;
} finally {
  await nav.close();
  servidor.close();
}
