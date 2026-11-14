// Vídeo de demostración (≤ 30 s) hecho solo con capturas del producto con sus datos reales: fotograma a fotograma en Chromium con GPU,
// montaje con ffmpeg. Añadidos: rótulos, subtítulos y un cursor que marca dónde se pulsa (los clics son reales).
// Uso: node scripts/video_demo.mjs   → build/video/{analog-zero-demo.mp4, analog-zero-demo.srt, cifras.json, muestra_NN.png}
import { createServer } from 'node:http';
import { readFile, mkdir, rm, copyFile, writeFile } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { extname, join, normalize, resolve } from 'node:path';
import { homedir } from 'node:os';
import { chromium } from 'playwright';
import { pendientes } from '../web/terreno/rutas.js';
import { latLonAPixel } from '../web/terreno/georef.js';

const RAIZ = resolve(new URL('..', import.meta.url).pathname);
const WEB = join(RAIZ, 'web');
const OUT = join(RAIZ, 'build', 'video');
const FRAMES = join(OUT, 'frames');
const MP4 = join(OUT, 'analog-zero-demo.mp4');
const FPS = 30;
const DURACION_S = 29.5;
const FFMPEG = spawnSync('ffmpeg', ['-version']).status === 0 ? 'ffmpeg' : join(homedir(), '.local/bin/ffmpeg');
const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.geojson': 'application/geo+json', '.csv': 'text/csv' };
const OPCIONALES = /informe_validacion\.json$|condiciones\.json$/;

// Guion: [inicio s, fin s, subtítulo]. Los planos tienen exactamente esta duración en fotogramas.
const GUION = [
  [0, 2, "I'm Ale, team Analog Zero."],
  [2, 5, "Before hardware flies to the Moon's south pole, where on Earth do you test it?"],
  [5, 10, 'Analog Zero: plant it, see what breaks.'],
  [10, 16, 'Real LOLA terrain. Each limit is quoted from its source.'],
  [16, 21, 'No way down under twenty degrees. Flatten the ground and the tower stands.'],
  [21, 26, 'The map shows where Earth can reproduce each condition, and what only a chamber can.'],
  [26, 29.5, 'Test here first. Fail here, not there.'],
];
const F = (s) => Math.round(s * FPS);

const fallos = [];
const falla = (m) => { fallos.push(m); console.error(`FAIL ${m}`); };
const ok = (m) => console.log(`ok   ${m}`);
const cifras = {};
const momentos = [];
const t0 = Date.now();

// ---------- Servidor estático ----------
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
const BASE = `http://127.0.0.1:${servidor.address().port}`;

await rm(OUT, { recursive: true, force: true });
await mkdir(FRAMES, { recursive: true });

// ---------- Puntos de la ruta (mismo criterio que scripts/captura_rutas.mjs) ----------
const dirS = join(WEB, 'data/terreno/shackleton');
const metaS = JSON.parse(readFileSync(join(dirS, 'meta.json'), 'utf8'));
const f32 = (f) => { const b = readFileSync(join(dirS, f)); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
const NS = metaS.n, MS = metaS.m_por_px;
const altS = f32('altura.f32'), iluS = f32('iluminacion.f32');
const pendS = pendientes(altS, NS, MS);
const ltvLim = JSON.parse(readFileSync(join(WEB, 'data/equipo.json'), 'utf8')).equipos.find((q) => q.id === 'ltv').requisitos.find((r) => r.variable === 'pendiente_deg').valor;
const crater = metaS.rasgos.find((r) => r.nombre === 'Shackleton');
const cpx = latLonAPixel(metaS, crater.lat, crater.lon), Rpx = (crater.diametro_km * 500) / MS;
let P0 = -1, FONDO = -1;
for (let f = 0; f < NS; f++) for (let c = 0; c < NS; c++) {
  const i = f * NS + c, d = Math.hypot(f - cpx.fila, c - cpx.col);
  if (d >= 0.9 * Rpx && d <= 1.1 * Rpx && pendS[i] <= ltvLim && Number.isFinite(iluS[i]) && (P0 < 0 || iluS[i] > iluS[P0])) P0 = i;
  if (d <= 0.3 * Rpx && Number.isFinite(altS[i]) && (FONDO < 0 || altS[i] < altS[FONDO])) FONDO = i;
}
const borde = { f: Math.floor(P0 / NS), c: P0 % NS }, fondo = { f: Math.floor(FONDO / NS), c: FONDO % NS };
console.log(`route: rim cell ${borde.f},${borde.c} · floor cell ${fondo.f},${fondo.c} · crater centre ${cpx.fila.toFixed(1)},${cpx.col.toFixed(1)}, R ${Rpx.toFixed(0)} px`);

// ---------- Navegador ----------
const nav = await chromium.launch({ headless: true, args: ['--use-angle=gl-egl', '--enable-gpu', '--ignore-gpu-blocklist'] });

// Cursor y anillo de clic; los coloca el guion en cada fotograma.
const CURSOR = () => {
  window.__video = {
    el: null,
    poner(x, y, clic) {
      if (!this.el) {
        const d = document.createElement('div');
        d.id = 'video-cursor';
        d.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;width:0;height:0';
        d.innerHTML = '<div class="anillo" style="position:absolute;border:2px solid #e9f0f5;border-radius:50%;opacity:0"></div>'
          + '<svg width="22" height="30" viewBox="0 0 22 30" style="position:absolute;left:-2px;top:-1px;overflow:visible"><path d="M1 1 L1 23 L7 17.5 L11.5 27.5 L15 26 L10.5 16 L18.5 16 Z" fill="#e9f0f5" stroke="#021226" stroke-width="1.6" stroke-linejoin="round"/></svg>';
        document.body.appendChild(d);
        this.el = d;
      }
      this.el.style.display = x === null ? 'none' : '';
      if (x === null) return;
      this.el.style.transform = `translate(${x}px, ${y}px)`;
      const a = this.el.querySelector('.anillo'), r = 6 + 16 * (clic ?? 1);
      a.style.opacity = clic === undefined || clic === null ? '0' : String(1 - clic);
      Object.assign(a.style, { left: `${-r}px`, top: `${-r}px`, width: `${2 * r}px`, height: `${2 * r}px` });
    },
  };
};

async function abrir(url, { w, h, dsf, etiqueta, listo }) {
  const ctx = await nav.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dsf });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, (r) => r.abort());
  const pag = await ctx.newPage();
  pag.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (/Failed to load resource/.test(m.text()) && OPCIONALES.test(m.location()?.url ?? '')) return;
    falla(`console (${etiqueta}): ${m.text()}`);
  });
  pag.on('pageerror', (e) => falla(`page error (${etiqueta}): ${e.message}`));
  pag.on('worker', (wk) => wk.on('console', (m) => { if (m.type() === 'error') falla(`worker console (${etiqueta}): ${m.text()}`); }));
  await pag.addInitScript(CURSOR);
  await pag.goto(`${BASE}/${url}`);
  await pag.waitForFunction(listo, null, { timeout: 120000 });
  await pag.evaluate(() => document.fonts.ready);
  return pag;
}
const pintado = (pag, k = 3) => pag.evaluate((k) => new Promise((ok) => { const paso = (j) => (j ? requestAnimationFrame(() => paso(j - 1)) : ok()); paso(k); }), k);
const suave = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const mezcla = (a, b, t) => a + (b - a) * t;

// Toma: secuencia de fotogramas con un recorte fijo (16:9) de la página.
class Toma {
  constructor(pag, nombre, clip, total) { Object.assign(this, { pag, nombre, clip, total, n: 0, dir: join(FRAMES, nombre), ultima: null, cursor: null }); }
  async iniciar() { await mkdir(this.dir, { recursive: true }); return this; }
  ruta(k) { return join(this.dir, `${String(k).padStart(4, '0')}.png`); }
  async foto() {
    if (this.n >= this.total) throw new Error(`${this.nombre}: more than ${this.total} frames`);
    const f = this.ruta(this.n);
    await this.pag.screenshot({ path: f, clip: this.clip, animations: 'disabled', caret: 'hide' });
    this.ultima = f; this.n++;
  }
  async quieto(k) {
    if (!this.ultima) await this.foto(), k--;
    for (let j = 0; j < k; j++) { if (this.n >= this.total) throw new Error(`${this.nombre}: more than ${this.total} frames`); await copyFile(this.ultima, this.ruta(this.n)); this.n++; }
  }
  async hasta(n) { await this.quieto(n - this.n); }
  async cerrar() {
    if (this.n < this.total) { await this.foto(); await this.quieto(this.total - this.n); }
    if (this.n !== this.total) throw new Error(`${this.nombre}: ${this.n} frames, expected ${this.total}`);
    return this;
  }
  momento(etiqueta) { momentos.push({ toma: this.nombre, frame: this.n, etiqueta }); }
  // Cursor: mueve el falso y el ratón real a la vez, k fotogramas.
  async mover(x, y, k, { real = true } = {}) {
    const [x0, y0] = this.cursor ?? [x, y];
    for (let j = 1; j <= k; j++) {
      const t = suave(j / k), cx = mezcla(x0, x, t), cy = mezcla(y0, y, t);
      if (real) await this.pag.mouse.move(cx, cy);
      await this.pag.evaluate(([a, b]) => window.__video.poner(a, b), [cx, cy]);
      await pintado(this.pag, 1);
      await this.foto();
    }
    this.cursor = [x, y];
  }
  async ponerCursor(x, y) { this.cursor = x === null ? null : [x, y]; await this.pag.evaluate(([a, b]) => window.__video.poner(a, b), [x, y]); }
  // Clic real en la posición del cursor y anillo que se abre durante k fotogramas.
  async clic(k = 5, accion = null) {
    const [x, y] = this.cursor;
    if (accion) await accion(); else await this.pag.mouse.click(x, y);
    for (let j = 0; j < k; j++) {
      await this.pag.evaluate(([a, b, c]) => window.__video.poner(a, b, c), [x, y, j / k]);
      await pintado(this.pag);
      await this.foto();
    }
    await this.pag.evaluate(([a, b]) => window.__video.poner(a, b), [x, y]);
  }
}
const tomas = [];
const nuevaToma = async (pag, nombre, clip, s) => { const t = await new Toma(pag, nombre, clip, F(s)).iniciar(); tomas.push(t); return t; };
const centro = async (pag, sel) => { const b = await pag.locator(sel).first().boundingBox(); if (!b) throw new Error(`not visible: ${sel}`); return [b.x + b.width / 2, b.y + b.height / 2]; };
const caja = (pag, sel) => pag.evaluate((s) => document.querySelector(s)?.getBoundingClientRect().toJSON() ?? null, sel);
const texto = (pag, sel) => pag.evaluate((s) => document.querySelector(s)?.textContent.replace(/\s+/g, ' ').trim() ?? null, sel);
// Recorte 16:9 de ancho w que contiene (cx, cy) en lo posible, dentro de la ventana.
const recorte = (cx, cy, w, W, H) => {
  const h = (w * 9) / 16;
  return { x: Math.round(Math.min(Math.max(cx - w / 2, 0), W - w)), y: Math.round(Math.min(Math.max(cy - h / 2, 0), H - h)), width: w, height: h };
};

// ---------- Cámara ----------
// Órbita: centro (mundo, km), distancia, rumbo y elevación en grados.
const camara = (pag, lados, o) => pag.evaluate(([lados, o]) => {
  for (const lado of lados) {
    const e = window.__az.paneles[lado].escena, r = Math.PI / 180;
    e.controles.target.set(o.x, o.y, o.z);
    e.camara.position.set(o.x + o.d * Math.cos(o.el * r) * Math.sin(o.az * r), o.y + o.d * Math.sin(o.el * r), o.z + o.d * Math.cos(o.el * r) * Math.cos(o.az * r));
    e.controles.update();
    e.sucio = true;
  }
}, [lados, o]);
const mundo = (pag, lado, f, c) => pag.evaluate(([l, f, c]) => { const v = window.__az.paneles[l].escena.mundoDePixel(f, c); return { x: v.x, y: v.y, z: v.z }; }, [lado, f, c]);
// ok: el rayo vuelve a la celda y (salvo conMarca) no hay nada encima del lienzo en ese punto.
const pantalla = (pag, lado, f, c, conMarca = false) => pag.evaluate(([l, f, c, conMarca]) => {
  const e = window.__az.paneles[l].escena, s = e.aPantalla(e.mundoDePixel(f, c)), g = s?.dentro && e.rayo(s.x, s.y);
  return s && { x: s.x, y: s.y, ok: !!g && Math.hypot(g.fila - f, g.col - c) < 1.5 && (conMarca || document.elementFromPoint(s.x, s.y) === e.renderer.domElement) };
}, [lado, f, c, conMarca]);
const orbita = (a, b, t) => Object.fromEntries(Object.keys(a).map((k) => [k, mezcla(a[k], b[k], t)]));

// Celdas visibles con la pendiente en [lo, hi] dentro de una caja de pantalla, ordenadas por cercanía a un punto.
const buscarCeldas = (pag, lado, o) => pag.evaluate(([lado, o]) => {
  const p = window.__az.paneles[lado], e = p.escena, n = e.n, out = [];
  for (let f = 4; f < n - 4; f += 3) for (let c = 4; c < n - 4; c += 3) {
    const i = f * n + c;
    if (e.capas.agua?.[i] >= 1) continue;
    if (o.anillo && !(Math.hypot(f - o.anillo.f, c - o.anillo.c) >= o.anillo.r0 && Math.hypot(f - o.anillo.f, c - o.anillo.c) <= o.anillo.r1)) continue;
    if (o.tempMin !== undefined && !(e.capas.temp_max?.[i] >= o.tempMin)) continue;
    const l = e.leer(f, c);
    if (!(l.pendiente >= o.lo && l.pendiente <= o.hi)) continue;
    const s = e.aPantalla(e.mundoDePixel(f, c));
    if (!s?.dentro || s.x < o.caja.x0 || s.x > o.caja.x1 || s.y < o.caja.y0 || s.y > o.caja.y1) continue;
    out.push({ f, c, x: s.x, y: s.y, pend: l.pendiente, d: Math.hypot(s.x - o.obj[0], s.y - o.obj[1]) });
  }
  out.sort((a, b) => a.d - b.d);
  return out.filter((x) => {
    const g = document.elementFromPoint(x.x, x.y) === e.renderer.domElement && e.rayo(x.x, x.y);
    return g && Math.round(g.fila) === x.f && Math.round(g.col) === x.c;
  }).slice(0, o.max ?? 12);
}, [lado, o]);
const filaHoja = (pag, lado, v) => pag.evaluate(([l, v]) => {
  const r = window.__az.paneles[l].el.querySelector(`.hoja .req[data-var=${v}]`), t = (s) => r.querySelector(s)?.textContent.replace(/\s+/g, ' ').trim() ?? null;
  return r ? { clase: r.className, texto: r.textContent.replace(/\s+/g, ' ').trim(), valor: t('.aqui'), limite: t('.lim'), veredicto: t('.veredicto') } : null;
}, [lado, v]);
const cifraFila = (x) => x && { valor: x.valor, limite: x.limite, veredicto: x.veredicto };
// Cámara en órbita que deja la celda (f, c) en el punto de pantalla meta.
const encuadrar = (pag, lado, f, c, meta, o) => pag.evaluate(([l, f, c, meta, o]) => {
  const e = window.__az.paneles[l].escena, w = e.mundoDePixel(f, c), r = Math.PI / 180;
  const der = [Math.cos(o.az * r), -Math.sin(o.az * r)], atras = [Math.sin(o.az * r), Math.cos(o.az * r)];
  let tx = w.x, tz = w.z, s = null;
  for (let k = 0; k < 6; k++) {
    e.controles.target.set(tx, w.y, tz);
    e.camara.position.set(tx + o.d * Math.cos(o.el * r) * atras[0], w.y + o.d * Math.sin(o.el * r), tz + o.d * Math.cos(o.el * r) * atras[1]);
    e.controles.update();
    e.camara.updateMatrixWorld();
    s = e.aPantalla(w);
    const ppk = e.pxPorKm(), dx = (s.x - meta.x) / ppk, dy = (s.y - meta.y) / ppk / Math.sin(o.el * r);
    tx += der[0] * dx + atras[0] * dy; tz += der[1] * dx + atras[1] * dy;
  }
  e.sucio = true;
  return s;
}, [lado, f, c, meta, o]);
const deslizar = (pag, sel, v) => pag.$eval(sel, (i, v) => { i.value = v; i.dispatchEvent(new Event('input')); }, v);

// ---------- Rótulos (PNG transparentes con las fuentes y colores de web/terreno/estilo.css) ----------
async function rotulos() {
  const ctx = await nav.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const pag = await ctx.newPage();
  pag.on('pageerror', (e) => falla(`page error (overlays): ${e.message}`));
  const css = `<link rel="stylesheet" href="${BASE}/terreno/estilo.css"><style>
    html, body { background: transparent !important; overflow: hidden; }
    body { display: block; width: 1920px; height: 1080px; position: relative; }
    .sub { position: absolute; left: 0; right: 0; bottom: 0; padding: 22px 120px 26px; background: rgba(2, 18, 38, .9); border-top: 1px solid var(--linea);
      font: 36px/1.25 var(--sans); color: var(--blanco); text-align: center; letter-spacing: .01em; }
    .titulo { position: absolute; left: 50%; top: 42%; transform: translate(-50%, -50%); white-space: nowrap; padding: 30px 64px 34px; background: rgba(2, 18, 38, .9); border: 1px solid var(--linea); text-align: center; }
    .titulo b { display: block; font: bold 104px/1 var(--mono); letter-spacing: .2em; margin-right: -.2em; color: var(--blanco); }
    .cierre { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 30px; background: rgba(2, 18, 38, .9); text-align: center; }
    .cierre b { font: bold 112px/1 var(--mono); letter-spacing: .2em; margin-right: -.2em; color: var(--blanco); }
    .cierre .lema { font: 46px/1.2 var(--sans); color: var(--blanco); }
    .cierre .fuentes { margin-top: 40px; font: 22px/1.3 var(--mono); letter-spacing: .14em; color: var(--tenue); text-transform: uppercase; }
  </style>`;
  const png = async (nombre, html) => {
    await pag.setContent(`<!doctype html><html><head><meta charset="utf-8">${css}</head><body>${html}</body></html>`, { waitUntil: 'load' });
    await pag.evaluate(() => document.fonts.ready);
    const f = join(OUT, 'rotulos', `${nombre}.png`);
    await pag.screenshot({ path: f, omitBackground: true });
    return f;
  };
  await mkdir(join(OUT, 'rotulos'), { recursive: true });
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const subs = [];
  for (const [k, [, , txt]] of GUION.entries()) subs.push(k === GUION.length - 1 ? null : await png(`sub_${k + 1}`, `<div class="sub">${esc(txt)}</div>`));
  const titulo = await png('titulo', '<div class="titulo"><b>ANALOG ZERO</b></div>');
  const cierre = await png('cierre', `<div class="cierre"><b>ANALOG ZERO</b><div class="lema">${esc(GUION.at(-1)[2])}</div><div class="fuentes">NASA LRO LOLA · Diviner · POWER · Copernicus DEM · open data</div></div>`);
  await ctx.close();
  return { subs, titulo, cierre };
}

// ======================================================================
try {
  // ---------- Plano 1 (0-2 s): polo sur, título ----------
  const W = 1280;
  const polo = await abrir('terreno/index.html?a=haughton&b=polo_sur&solo=polo_sur', { w: W, h: 1100, dsf: 3, etiqueta: 'polo_sur', listo: () => window.__az?.listo === true });
  const lzP = await caja(polo, '.panel[data-lado=b] .lienzo');
  const clipLienzo = (lz, cy) => recorte(lz.x + lz.width / 2, cy ?? lz.y + lz.height / 2, Math.floor(lz.width / 16) * 16, W, lz.y + lz.height);
  const clipP = clipLienzo(lzP);
  await deslizar(polo, '.panel[data-lado=b] [data-sol=el]', 2.5);
  await deslizar(polo, '.panel[data-lado=b] [data-sol=az]', 300);
  await pintado(polo, 4);
  const p1 = await nuevaToma(polo, 'p1-polo', clipP, 2);
  const a1 = { x: 0, y: 0, z: 0, d: 300, az: -14, el: 34 }, b1 = { x: 0, y: 0, z: 0, d: 250, az: -6, el: 30 };
  for (let j = 0; j < p1.total; j++) { await camara(polo, [1], orbita(a1, b1, suave(j / (p1.total - 1)))); await pintado(polo); await p1.foto(); }
  await p1.cerrar();
  cifras.plano1 = { terreno: await texto(polo, '.panel[data-lado=b] .tarjeta h2'), dem: await texto(polo, '.panel[data-lado=b] .tarjeta .fuente') };

  // ---------- Plano 2 (2-5 s): Shackleton, sol rasante que se mueve ----------
  const shk = await abrir('terreno/index.html?a=haughton&b=shackleton&solo=shackleton', { w: W, h: 1100, dsf: 3, etiqueta: 'shackleton', listo: () => window.__az?.listo === true });
  const lzS = await caja(shk, '.panel[data-lado=b] .lienzo');
  const centroS = await mundo(shk, 1, cpx.fila, cpx.col);
  await deslizar(shk, '.panel[data-lado=b] [data-sol=el]', 1.5);
  const p2 = await nuevaToma(shk, 'p2-sol', clipLienzo(lzS), 3);
  const a2 = { ...centroS, d: 70, az: 10, el: 40 }, b2 = { ...centroS, d: 58, az: 24, el: 35 };
  const az0 = 20, az1 = az0 + p2.total - 1;
  for (let j = 0; j < p2.total; j++) {
    await deslizar(shk, '.panel[data-lado=b] [data-sol=az]', az0 + j);
    await camara(shk, [1], orbita(a2, b2, suave(j / (p2.total - 1))));
    await pintado(shk, 4);
    await p2.foto();
  }
  await p2.cerrar();
  cifras.plano2 = { sol: `${await texto(shk, '.panel[data-lado=b] .mandos .fila:nth-of-type(3)')}`, recorrido_longitud_subsolar_deg: [az0, az1] };
  await shk.context().close();

  // ---------- Plano 3 (5-10 s): pareja a la misma escala ----------
  const par = await abrir('terreno/index.html?a=haughton&b=shackleton', { w: W, h: 720, dsf: 3, etiqueta: 'pair', listo: () => window.__az?.listo === true });
  const FULL = { x: 0, y: 0, width: W, height: 720 };
  const p3 = await nuevaToma(par, 'p3-pareja', FULL, 5);
  const a3 = { x: 0, y: 0, z: 0, d: 52, az: -18, el: 52 }, b3 = { x: 0, y: 0, z: 0, d: 46, az: 0, el: 50 };
  for (let j = 0; j < p3.total; j++) { await camara(par, [0, 1], orbita(a3, b3, suave(j / (p3.total - 1)))); await pintado(par); await p3.foto(); }
  await p3.cerrar();
  cifras.plano3 = { escala: await texto(par, '#nota-escala'), tierra: await texto(par, '.panel[data-lado=a] .tarjeta h2'), luna: await texto(par, '.panel[data-lado=b] .tarjeta h2') };

  // ---------- Plano 4 (10-16 s): LTV en la pared de Shackleton (BREAKS) y en llano de Haughton (OK) ----------
  const pb = await caja(par, '.panel[data-lado=b] .lienzo'), pa = await caja(par, '.panel[data-lado=a] .lienzo');
  const pared = await buscarCeldas(par, 1, { lo: 24, hi: 34, anillo: { f: cpx.fila, c: cpx.col, r0: 0.45 * Rpx, r1: 0.98 * Rpx },
    caja: { x0: pb.x + 40, x1: pb.x + pb.width - 360, y0: 250, y1: 500 }, obj: [pb.x + 200, 400] });
  const llano = await buscarCeldas(par, 0, { lo: 0, hi: 2, caja: { x0: pa.x + 40, x1: pa.x + pa.width - 360, y0: 250, y1: 500 }, obj: [pa.x + 170, 400] });
  if (!pared.length || !llano.length) throw new Error(`no visible cell to plant the LTV (wall ${pared.length}, flat ${llano.length})`);
  const [paredC, llanoC] = [pared[0], llano[0]];
  console.log(`LTV: Moon wall cell ${paredC.f},${paredC.c} (${paredC.pend.toFixed(1)}°) · Haughton flat cell ${llanoC.f},${llanoC.c} (${llanoC.pend.toFixed(1)}°)`);
  const plantar = async (toma, lado, eq, celda) => {
    const S = `.panel[data-lado=${lado ? 'b' : 'a'}]`;
    await toma.mover(...(await centro(par, `${S} .ver-paleta`)), 8);
    await toma.clic(3);
    await toma.mover(...(await centro(par, `${S} .paleta [data-eq=${eq}]`)), 6);
    await toma.clic(3);
    await toma.mover(celda.x, celda.y, 8);
    await toma.clic(4);
  };
  // 4a: plantar en la Luna
  const p4a = await nuevaToma(par, 'p4a-plantar-luna', FULL, 1.2);
  await p4a.ponerCursor(pb.x + pb.width * 0.55, 560);
  await p4a.foto();
  await plantar(p4a, 1, 'ltv', paredC);
  await p4a.cerrar();
  const luna = await filaHoja(par, 1, 'pendiente_deg');
  if (!/\brompe\b/.test(luna?.clase ?? '') || !/BREAKS by/.test(luna?.texto ?? '')) falla(`LTV on the Shackleton wall should BREAK: ${JSON.stringify(luna)}`);
  else ok(`Moon LTV slope row: ${luna.texto.slice(0, 120)}`);
  // 4b: hoja de la Luna ampliada; se abre la cita literal.
  const SUM = '.panel[data-lado=b] .hoja .req[data-var=pendiente_deg] .src details.cita';
  await par.$eval(SUM, (d) => { d.open = true; });
  const hb = await caja(par, '.panel[data-lado=b] .hoja .req[data-var=pendiente_deg]');
  await par.$eval(SUM, (d) => { d.open = false; });
  const clip4b = recorte(hb.x + hb.width / 2 - 110, hb.y + hb.height / 2, 720, W, 720);
  const p4b = await nuevaToma(par, 'p4b-hoja-luna', clip4b, 1.8);
  p4b.cursor = p4a.cursor;
  await p4b.foto();
  await p4b.mover(...(await centro(par, `${SUM} .ver-cita`)), 10);
  await p4b.clic(4);
  await p4b.mover(hb.x - 70, hb.y + hb.height * 0.45, 8);
  p4b.momento('Moon sheet: BREAKS + quote');
  await p4b.cerrar();
  const cita = await texto(par, '.panel[data-lado=b] .hoja .req[data-var=pendiente_deg] .src q');
  const citaVisible = await par.isVisible('.panel[data-lado=b] .hoja .req[data-var=pendiente_deg] .src q');
  if (!cita || !citaVisible) falla(`NASA quote not visible in the Moon sheet (${cita})`);
  cifras.plano4 = { luna_celda: { fila: paredC.f, col: paredC.c }, luna_pendiente: cifraFila(luna), cita, fuente: await par.$eval('.panel[data-lado=b] .hoja .req[data-var=pendiente_deg] .src summary a', (a) => a.href) };
  // 4c: plantar en Haughton
  const p4c = await nuevaToma(par, 'p4c-plantar-tierra', FULL, 1.2);
  p4c.cursor = [hb.x - 70, hb.y + hb.height * 0.45];
  await p4c.foto();
  await plantar(p4c, 0, 'ltv', llanoC);
  await p4c.cerrar();
  const tierra = await filaHoja(par, 0, 'pendiente_deg');
  if (!/\bok\b/.test(tierra?.clase ?? '') || !/\bOK\b/.test(tierra?.texto ?? '')) falla(`LTV on Haughton flat ground should be OK: ${JSON.stringify(tierra)}`);
  else ok(`Haughton LTV slope row: ${tierra.texto.slice(0, 120)}`);
  // 4d: hoja de Haughton ampliada
  const ha = await caja(par, '.panel[data-lado=a] .hoja .req[data-var=pendiente_deg]');
  const comp = await caja(par, '.panel[data-lado=a] .hoja .comp');
  const clip4d = recorte(ha.x + ha.width / 2 - 120, (ha.y + (comp ? comp.y + comp.height : ha.y + ha.height)) / 2, 720, W, 720);
  const p4d = await nuevaToma(par, 'p4d-hoja-tierra', clip4d, 1.8);
  p4d.cursor = [llanoC.x, llanoC.y];
  await p4d.foto();
  await p4d.mover(ha.x - 30, ha.y + ha.height / 2 + 40, 10);
  p4d.momento('Haughton sheet: OK');
  await p4d.cerrar();
  cifras.plano4.tierra_celda = { fila: llanoC.f, col: llanoC.c };
  cifras.plano4.tierra_pendiente = cifraFila(tierra);
  cifras.plano4.comparacion = await par.evaluate(() => [...document.querySelectorAll('.panel[data-lado=b] .hoja .comp tbody tr')].map((tr) => tr.textContent.replace(/\s+/g, ' ').trim()));

  // ---------- Plano 5 (16-21 s): ruta del LTV borde → fondo; torre solar en ladera, allanar ----------
  await par.click('.panel[data-lado=b] .hoja [data-a=cerrar]');
  await par.click('.panel[data-lado=a] .hoja [data-a=cerrar]');
  await par.click('.panel[data-lado=b] .ampliar');
  await par.click('.panel[data-lado=b] [data-modo=pendiente]');
  await pintado(par, 6);
  const lzE = await caja(par, '.panel[data-lado=b] .lienzo');
  const medio = await mundo(par, 1, (borde.f + fondo.f) / 2, (borde.c + fondo.c) / 2);
  let sB = null, sF = null;
  for (const o of [{ az: 0, x: 0 }, { az: 0, x: -2.5 }, { az: 180, x: 0 }, { az: 90, x: 0 }]) {
    await camara(par, [1], { ...medio, x: medio.x + o.x, d: 30, az: o.az, el: 58 });
    await pintado(par, 4);
    [sB, sF] = [await pantalla(par, 1, borde.f, borde.c), await pantalla(par, 1, fondo.f, fondo.c)];
    if (sB?.ok && sF?.ok) break;
  }
  if (!sB?.ok || !sF?.ok) throw new Error(`rim or floor not clickable from the route camera (${JSON.stringify([sB, sF])})`);
  const R = (k) => `.panel[data-lado=b] .rutas [data-r="${k}"]`;
  await par.selectOption(R('veh'), 'ltv');
  await par.click(R('clic-desde')); await par.mouse.click(sB.x, sB.y);
  await par.click(R('clic-hasta')); await par.mouse.click(sF.x, sF.y);
  const puntos = await par.evaluate(() => { const r = window.__az.paneles[1].rutas.R; return [r.desde, r.hasta]; });
  if (Math.hypot(puntos[0].fila - borde.f, puntos[0].col - borde.c) > 1.5 || Math.hypot(puntos[1].fila - fondo.f, puntos[1].col - fondo.c) > 1.5) falla(`route end points not set where clicked: ${JSON.stringify(puntos)}`);
  await par.mouse.move(5, 5);
  // 5a: pulsar Compute route
  const p5a = await nuevaToma(par, 'p5a-ruta', FULL, 1);
  await p5a.ponerCursor(lzE.x + lzE.width * 0.6, lzE.y + lzE.height * 0.55);
  await p5a.foto();
  await p5a.mover(...(await centro(par, R('calcular'))), 11);
  await par.evaluate(() => { window.__resPrevio = window.__az.paneles[1].rutas.R.res; });
  await p5a.clic(3, async () => {
    await par.mouse.click(...p5a.cursor);
    await par.waitForFunction(() => { const r = window.__az.paneles[1].rutas.R.res; return r && r !== window.__resPrevio && r.ms !== undefined; }, null, { timeout: 120000 });
  });
  const rr = await caja(par, R('res'));
  await p5a.mover(rr.x - 70, rr.y + 12, 8);
  await p5a.cerrar();
  const sinRuta = await texto(par, R('res'));
  const res = await par.evaluate(() => { const r = window.__az.paneles[1].rutas.R.res; return { camino: !!r.camino, umbral: r.umbral ?? null, limite: r.limite, ms: r.ms }; });
  if (res.camino || !/no route within Lunar Terrain Vehicle's slope limit \(≤ 20°\)/.test(sinRuta ?? '') || !/minimum slope limit that would connect them: [\d.]+°/.test(sinRuta ?? '')) falla(`rim → floor should give "no route" with the minimum slope: ${sinRuta}`);
  else ok(`route: ${sinRuta.slice(0, 200)}`);
  cifras.plano5 = { ruta: { desde: borde, hasta: fondo, texto: sinRuta, pendiente_minima_deg: res.umbral, limite_deg: res.limite } };
  // 5b: resultado ampliado
  const p5b = await nuevaToma(par, 'p5b-ruta-resultado', recorte(rr.x + rr.width / 2 - 130, rr.y + rr.height / 2, 640, W, 720), 1.2);
  p5b.momento('route: no route + minimum slope');
  await p5b.ponerCursor(null);
  await p5b.foto();
  await p5b.cerrar();

  // 5c: torre solar en ladera → BREAKS; allanar → OK
  await par.click(R('borrar'));
  await par.mouse.move(5, 5);
  const objT = [lzE.x + lzE.width / 2 - 170, lzE.y + lzE.height * 0.52];
  let torre = null, filaT = null;
  for (const intento of [{ d: 9, az: 30 }, { d: 9, az: 150 }, { d: 9, az: 270 }]) {
    await camara(par, [1], { ...centroS, d: 30, az: intento.az, el: 55 });
    await pintado(par, 4);
    const cands = await buscarCeldas(par, 1, { lo: 15, hi: 24, tempMin: 120, caja: { x0: lzE.x + 60, x1: lzE.x + lzE.width - 380, y0: lzE.y + 230, y1: lzE.y + lzE.height - 190 }, obj: objT, max: 8 });
    for (const c of cands) {
      await par.click('.panel[data-lado=b] .ver-paleta');
      await par.click('.panel[data-lado=b] .paleta [data-eq=torre_solar]');
      await par.mouse.click(c.x, c.y);
      await pintado(par);
      const rotos = await par.evaluate(() => [...document.querySelectorAll('.panel[data-lado=b] .hoja .req.rompe')].map((r) => r.dataset.var));
      if (rotos.length === 1 && rotos[0] === 'pendiente_deg') { torre = c; break; }
      await par.click('.panel[data-lado=b] .hoja [data-a=quitar]');
    }
    if (torre) break;
  }
  if (!torre) throw new Error('no visible slope cell where only the solar tower slope limit breaks');
  filaT = await filaHoja(par, 1, 'pendiente_deg');
  ok(`solar tower at ${torre.f},${torre.c} (${torre.pend.toFixed(1)}°): ${filaT.texto.slice(0, 100)}`);
  // Encuadre: la torre a la izquierda de la hoja.
  const wT = await mundo(par, 1, torre.f, torre.c);
  await encuadrar(par, 1, torre.f, torre.c, { x: lzE.x + 250, y: lzE.y + 420 }, { d: 7, az: 20, el: 50 });
  await pintado(par, 4);
  const sT = await pantalla(par, 1, torre.f, torre.c, true);
  if (!sT?.ok) throw new Error(`solar tower cell not visible after framing (${JSON.stringify(sT)})`);
  await par.click('.panel[data-lado=b] [data-herr=allanar]');
  await deslizar(par, '.panel[data-lado=b] [data-i=int]', 100);
  await deslizar(par, '.panel[data-lado=b] [data-i=radio]', 380);
  const hT = await caja(par, '.panel[data-lado=b] .hoja .req[data-var=pendiente_deg]');
  const w5c = Math.floor(lzE.width / 16) * 16, y5c = Math.max(lzE.y, Math.min(hT.y - 40, sT.y - 250));
  const clip5c = { x: Math.round(lzE.x + (lzE.width - w5c) / 2), y: Math.round(Math.min(y5c, 720 - (w5c * 9) / 16)), width: w5c, height: (w5c * 9) / 16 };
  const p5c = await nuevaToma(par, 'p5c-torre', clip5c, 2.8);
  await p5c.ponerCursor(sT.x - 60, sT.y + 50);
  await p5c.foto();
  await p5c.mover(sT.x, sT.y, 10);
  p5c.momento('solar tower: BREAKS');
  await p5c.hasta(F(1.2));
  // Trazo de allanar real: botón abajo sobre la torre, vaivén, botón arriba.
  const vaiven = [];
  for (let j = 0; j < 5; j++) vaiven.push([sT.x + 9, sT.y], [sT.x - 9, sT.y + 4], [sT.x, sT.y - 4]);
  vaiven.push([sT.x, sT.y]);
  await par.mouse.move(sT.x, sT.y);
  await par.mouse.down();
  for (const [k, q] of vaiven.entries()) {
    await par.mouse.move(q[0], q[1], { steps: 3 });
    await p5c.ponerCursor(q[0], q[1]);
    if (k % 2 === 1) { await pintado(par); await p5c.foto(); }
  }
  await par.mouse.up();
  let trazos = 1;
  while (!/\bok\b/.test((await filaHoja(par, 1, 'pendiente_deg'))?.clase ?? '') && trazos < 3) {
    trazos++;
    await par.mouse.down();
    for (const q of vaiven) await par.mouse.move(q[0], q[1], { steps: 3 });
    await par.mouse.up();
  }
  await pintado(par, 4);
  const trasT = await filaHoja(par, 1, 'pendiente_deg');
  const rotosT = await par.evaluate(() => [...document.querySelectorAll('.panel[data-lado=b] .hoja .req.rompe')].map((r) => r.dataset.var));
  if (!/\bok\b/.test(trasT?.clase ?? '') || rotosT.length) falla(`after flattening, the solar tower should be OK: ${trasT?.texto} (breaking: ${rotosT.join(', ')})`);
  else ok(`after flattening (${trazos} stroke(s)): ${trasT.texto.slice(0, 100)}`);
  await p5c.mover(sT.x + 40, sT.y + 60, 6);
  p5c.momento('solar tower: OK after flatten');
  await p5c.cerrar();
  cifras.plano5.torre = { celda: { fila: torre.f, col: torre.c }, antes: cifraFila(filaT), despues: cifraFila(trasT), trazos, retoque: await texto(par, '.panel[data-lado=b] .retoque .estado'),
    marca_roja_tras_allanar: await par.$eval('.panel[data-lado=b] .marca.sel', (d) => d.classList.contains('rompe')) };

  // ---------- Plano 6 (21-26 s): mapa global, TEST CONDITIONS ----------
  const mapa = await abrir('mapa/index.html?modo=cond&eq=ltv&req=1', { w: W, h: 720, dsf: 1.5, etiqueta: 'map', listo: () => window.__mapa?.listo === true && window.__mapa.modo === 'cond' });
  await pintado(mapa, 4);
  const res1 = await texto(mapa, '#cond-resumen');
  if (!/^Continuous darkness ≥ 150 h: [\d.]+ % of land/.test(res1 ?? '')) falla(`darkness summary: ${res1}`); else ok(`map: ${res1}`);
  const p6 = await nuevaToma(mapa, 'p6-mapa', FULL, 5);
  await p6.ponerCursor(560, 470);
  await p6.foto();
  const hz = await mapa.evaluate(() => { const s = window.__mapa.cond.man.sitios.find((x) => x.id === 'haughton'); return window.__mapa.aPantalla(s.fila, s.col); });
  await p6.mover(hz.x + 6, hz.y + 4, 20);
  p6.momento('map: darkness ≥ 150 h');
  await p6.hasta(F(2.4));
  await p6.mover(...(await centro(mapa, '#cond-eq')), 12);
  await p6.clic(5, async () => {
    await mapa.selectOption('#cond-eq', 'viper');
    await mapa.waitForFunction(() => window.__mapa.cond.eqId === 'viper' && window.__mapa.leyenda?.capa?.startsWith('cond:viper'), null, { timeout: 20000 });
  });
  const rojo = await caja(mapa, '#leyenda .v-rompe');
  await p6.mover(rojo.x + rojo.width + 14, rojo.y + rojo.height / 2 - 6, 10);
  p6.momento('map: cold not reachable');
  await p6.cerrar();
  const res2 = await texto(mapa, '#cond-resumen'), ley2 = await texto(mapa, '#leyenda .v-rompe');
  if (!/not reachable in the field — chamber only/.test(res2 ?? '') || !/not reachable on Earth — chamber only/.test(ley2 ?? '')) falla(`cold requirement should read "not reachable — chamber only": ${res2} | ${ley2}`);
  else ok(`map: ${res2} | legend: ${ley2}`);
  cifras.plano6 = { oscuridad: res1, frio: res2, leyenda_frio: ley2, requisito_frio: await mapa.$eval('#cond-req', (s) => s.selectedOptions[0]?.textContent) };
  await mapa.context().close();

  // ---------- Plano 7 (26-29.5 s): cierre sobre el polo sur ----------
  const p7 = await nuevaToma(polo, 'p7-cierre', clipP, 3.5);
  const a7 = { x: 0, y: 0, z: 0, d: 230, az: 8, el: 26 }, b7 = { x: 0, y: 0, z: 0, d: 210, az: 18, el: 24 };
  for (let j = 0; j < p7.total; j++) { await camara(polo, [1], orbita(a7, b7, suave(j / (p7.total - 1)))); await pintado(polo); await p7.foto(); }
  await p7.cerrar();
} catch (e) {
  falla(`script: ${e.stack ?? e.message}`);
}

// ---------- Montaje ----------
const ffmpeg = (args, etiqueta) => {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-y', ...args], { encoding: 'utf8', maxBuffer: 64 << 20 });
  if (r.status !== 0) falla(`ffmpeg ${etiqueta}: exit ${r.status}\n${r.stderr.split('\n').slice(-12).join('\n')}`);
  return r;
};
if (!fallos.length) {
  const total = tomas.reduce((s, t) => s + t.total, 0);
  if (total !== F(DURACION_S)) falla(`frames ${total} ≠ ${F(DURACION_S)}`);
  const rot = await rotulos();
  const ent = [], filtros = [];
  tomas.forEach((t, k) => { ent.push('-framerate', String(FPS), '-i', join(t.dir, '%04d.png')); filtros.push(`[${k}:v]scale=1920:1080:flags=lanczos,setsar=1,format=yuv444p[s${k}]`); });
  filtros.push(`${tomas.map((_, k) => `[s${k}]`).join('')}concat=n=${tomas.length}:v=1:a=0[b0]`);
  let ult = 'b0', idx = tomas.length;
  const capa = (png, a, b) => { ent.push('-i', png); filtros.push(`[${ult}][${idx}:v]overlay=0:0:enable='between(t,${a},${b - 0.001})'[o${idx}]`); ult = `o${idx}`; idx++; };
  capa(rot.titulo, 0, 2);
  GUION.forEach(([a, b], k) => { if (rot.subs[k]) capa(rot.subs[k], a, b); });
  capa(rot.cierre, GUION.at(-1)[0], GUION.at(-1)[1] + 1);
  filtros.push(`[${ult}]fade=t=in:st=0:d=0.3,fade=t=out:st=${DURACION_S - 0.5}:d=0.5,format=yuv420p[v]`);
  ffmpeg([...ent, '-filter_complex', filtros.join(';'), '-map', '[v]', '-r', String(FPS), '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', MP4], 'encode');

  // SRT
  const tc = (s) => { const ms = Math.round(s * 1000); return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`; };
  await writeFile(join(OUT, 'analog-zero-demo.srt'), GUION.map(([a, b, t], k) => `${k + 1}\n${tc(a)} --> ${tc(b)}\n${t}\n`).join('\n'));

  // Comprobaciones del mp4 (no hay ffprobe en esta máquina: cabecera de ffmpeg -i y recuento de fotogramas decodificados).
  if (existsSync(MP4)) {
    const cab = spawnSync(FFMPEG, ['-hide_banner', '-i', MP4], { encoding: 'utf8' }).stderr;
    const cuenta = ffmpeg(['-i', MP4, '-map', '0:v:0', '-f', 'null', '-'], 'count').stderr;
    const frames = +([...cuenta.matchAll(/frame=\s*(\d+)/g)].at(-1)?.[1] ?? NaN);
    const dur = cab.match(/Duration: (\d+):(\d+):([\d.]+)/);
    const durS = dur ? +dur[1] * 3600 + +dur[2] * 60 + +dur[3] : NaN;
    const v = cab.match(/Stream #\S+.*Video: (\w+).*?, (\w+)\(.*?, (\d+)x(\d+)/);
    const fps = +(cab.match(/([\d.]+) fps/)?.[1] ?? NaN);
    const info = { duracion_cabecera_s: durS, fotogramas: frames, duracion_fotogramas_s: frames / FPS, codec: v?.[1], pix_fmt: v?.[2], ancho: +v?.[3], alto: +v?.[4], fps };
    console.log(`mp4: ${JSON.stringify(info)}`);
    if (!(info.duracion_fotogramas_s <= 30 && info.duracion_fotogramas_s >= 28 && durS <= 30 && durS >= 28)) falla(`duration ${durS} s / ${frames} frames out of [28, 30] s`);
    if (info.ancho !== 1920 || info.alto !== 1080) falla(`size ${info.ancho}×${info.alto}`);
    if (info.codec !== 'h264' || info.pix_fmt !== 'yuv420p') falla(`codec ${info.codec} ${info.pix_fmt}`);
    if (fps !== FPS) falla(`fps ${fps}`);
    cifras.mp4 = info;
    // Muestras: mitad de cada plano y momentos con el texto clave.
    let inicio = 0;
    const inicios = Object.fromEntries(tomas.map((t) => { const x = [t.nombre, inicio]; inicio += t.total; return x; }));
    const muestras = GUION.map(([a, b], k) => ({ t: (a + b) / 2, etiqueta: `plane ${k + 1} middle` }))
      .concat(momentos.map((m) => ({ t: (inicios[m.toma] + m.frame + 3) / FPS, etiqueta: m.etiqueta })));
    cifras.muestras = [];
    for (const [k, m] of muestras.entries()) {
      const f = join(OUT, `muestra_${String(k + 1).padStart(2, '0')}.png`);
      ffmpeg(['-ss', m.t.toFixed(3), '-i', MP4, '-frames:v', '1', f], `sample ${k + 1}`);
      cifras.muestras.push({ fichero: f, t_s: +m.t.toFixed(3), que: m.etiqueta });
    }
  }
}
await nav.close();
servidor.close();
cifras.errores = fallos;
cifras.segundos_de_generacion = Math.round((Date.now() - t0) / 1000);
await writeFile(join(OUT, 'cifras.json'), `${JSON.stringify(cifras, null, 1)}\n`);
console.log(fallos.length ? `VIDEO_DEMO: ${fallos.length} failure(s)` : `VIDEO_DEMO: ok · ${MP4} · ${cifras.segundos_de_generacion} s`);
process.exit(fallos.length ? 1 : 0);
