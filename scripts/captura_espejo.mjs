// Equipo espejo en el visor (Chromium): (a) plantar en la Luna planta el gemelo en la Tierra a los mismos metros del centro;
// (b) las dos fichas dicen qué coincide, qué no y qué no se puede medir, y lo que la Tierra no reproduce con su fuente;
// (c) quitar uno quita el otro; (d) tras recargar siguen emparejados; (e) con «Mirror equipment» apagado no hay gemelo;
// (f) «Drill here» también se refleja.
// Uso: node scripts/captura_espejo.mjs
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { chromium } from 'playwright';
import { celdaEspejo } from '../web/terreno/espejo.js';

const RAIZ = resolve(new URL('..', import.meta.url).pathname);
const WEB = join(RAIZ, 'web');
const SALIDA = join(RAIZ, 'capturas', 'espejo');
const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm' };
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
const pag = await nav.newPage({ viewport: { width: 1600, height: 900 } });
pag.on('console', (m) => { if (m.type() === 'error') { fallos.push(`console: ${m.text()}`); console.error(`FAIL console: ${m.text()}`); } });
pag.on('pageerror', (e) => { fallos.push(`page error: ${e.message}`); console.error(`FAIL page error: ${e.message}`); });
const abrir = async (q = '') => {
  await pag.goto(`${base}/terreno/index.html?a=haughton&b=shackleton${q}`);
  await pag.waitForFunction(() => window.__az?.listo === true, null, { timeout: 120000 });
  await pag.waitForTimeout(600);
};
const lista = (i) => pag.evaluate((i) => window.__az.paneles[i].plantados.lista.map((x) => ({ uid: x.uid, equipo: x.equipo, fila: x.fila, col: x.col, par: x.par })), i);
const plantar = async (lado, eq, dx = 0, dy = 0) => {
  const sel = `.panel[data-lado=${lado}]`;
  await pag.click(`${sel} .ver-paleta`);
  await pag.click(`${sel} .paleta [data-eq=${eq}]`);
  const c = await pag.locator(`${sel} .lienzo canvas`).first().boundingBox();
  await pag.mouse.click(c.x + c.width / 2 + dx, c.y + c.height / 2 + dy);
  await pag.waitForTimeout(400);
};
const hoja = (lado) => pag.evaluate((lado) => {
  const h = document.querySelector(`.panel[data-lado=${lado}] .hoja [data-espejo]`);
  if (!h) return null;
  const t = (e) => e.textContent.replace(/\s+/g, ' ').trim();
  return { cab: t(h.querySelector('.et')), resumen: Object.fromEntries([...h.querySelectorAll('[data-r]')].map((d) => [d.dataset.r, t(d)])),
    filas: [...h.querySelectorAll('tr[data-fila]')].map((tr) => ({ id: tr.dataset.fila, clase: tr.className, celdas: [...tr.children].map(t) })),
    noRepro: [...h.querySelectorAll('[data-no-repro]')].map((d) => ({ id: d.dataset.noRepro, texto: t(d), enlaces: [...d.querySelectorAll('a')].map((a) => a.href) })) };
}, lado);

try {
  await abrir();
  await pag.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('analog-zero.planted.')) localStorage.removeItem(k); });
  await abrir();
  comprobar(await pag.isVisible('#espejo') && await pag.getAttribute('#espejo', 'aria-pressed') === 'true', '(a) "Mirror equipment" is shown and on', '(a) the Mirror equipment switch is missing or off');
  const geo = await pag.evaluate(() => window.__az.paneles.map((p) => ({ n: p.escena.n, m: p.escena.m, cuerpo: p.escena.meta.cuerpo })));
  await plantar('b', 'torre_solar', 60, 40);
  // El aviso dura unos segundos: se lee antes de traer la rejilla entera de alturas.
  const aviso = await pag.evaluate(() => { const a = document.querySelector('.panel[data-lado=a] .aviso-espejo'); return a.hidden ? null : a.textContent; });
  let [ta, tb] = [await lista(0), await lista(1)];
  comprobar(tb.length === 1 && ta.length === 1 && ta[0].equipo === 'torre_solar' && ta[0].par && ta[0].par === tb[0].par, `(a) planting on the Moon planted its twin on Earth (pair ${tb[0]?.par})`, `(a) no twin: moon ${JSON.stringify(tb)} earth ${JSON.stringify(ta)}`);
  const alturas = await pag.evaluate(() => Array.from(window.__az.paneles[0].escena.mostradas));
  const esp = celdaEspejo({ n: geo[1].n, m: geo[1].m }, { n: geo[0].n, m: geo[0].m, alturas }, tb[0].fila, tb[0].col);
  comprobar(esp && ta[0].fila === esp.fila && ta[0].col === esp.col, `(a) twin cell ${ta[0].fila},${ta[0].col} = same metres from the centre as the Moon cell ${tb[0].fila},${tb[0].col} (node)`, `(a) twin cell ${ta[0]?.fila},${ta[0]?.col} vs node ${JSON.stringify(esp)}`);
  comprobar(/Also planted here: Vertical solar array tower · \d+ m (right|left) and \d+ m (down|up) from the window centre on the map, as on Moon/.test(aviso ?? ''), `(a) notice on the Earth panel: "${aviso}"`, `(a) notice missing: ${aviso}`);
  const modelos = await pag.evaluate(() => window.__az.paneles.map((p) => { p.modelos.sincronizar(p.plantados.lista); return p.modelos.instancias().length; }));
  comprobar(modelos[0] === 1 && modelos[1] === 1, '(a) a 3D model stands on both panels', `(a) 3D models per panel: ${modelos}`);

  const [hb, ha] = [await hoja('b'), await hoja('a')];
  comprobar(hb && ha, '(b) both sheets are open with the comparison', `(b) comparison block: moon ${!!hb} earth ${!!ha}`);
  if (hb && ha) {
    comprobar(/Same equipment on Earth/.test(hb.cab) && /Same equipment on Moon/.test(ha.cab), `(b) headers: "${hb.cab}"`, `(b) headers: ${hb.cab} / ${ha.cab}`);
    const ids = hb.filas.map((f) => f.id);
    comprobar(['pendiente', 'limite_pendiente', 'iluminacion', 'temp_max'].every((k) => ids.includes(k)) && !ids.includes('sol') && !ids.includes('luz'), `(b) rows before Day runs: ${ids.join(', ')} (no Sun rows: the Suns are still set by hand)`, `(b) rows: ${ids.join(', ')}`);
    const pie = await pag.$eval('.panel[data-lado=b] .hoja [data-espejo]', (h) => h.textContent);
    comprobar(/Sun and light are compared once “Day” above is running/.test(pie) && /same place on each map, not the same compass bearing/.test(pie), '(b) the sheet says why the Sun is not compared yet and that a polar map has no common compass bearing', '(b) the sheet lacks the Day / polar notes');
    comprobar(JSON.stringify(hb.filas) === JSON.stringify(ha.filas), '(b) the Moon sheet and the Earth sheet show the same table (Moon column first)', '(b) the two sheets disagree');
    const med = await pag.evaluate(() => window.__az.paneles.map((p) => { const it = p.plantados.lista[0], e = p.escena; return { pend: e.leer(it.fila, it.col).pendiente, el: e.sol.el }; }));
    const fp = hb.filas.find((f) => f.id === 'pendiente');
    comprobar(fp.celdas[1] === `${med[1].pend.toFixed(1)}°` && fp.celdas[2] === `${med[0].pend.toFixed(1)}°`, `(b) slope row = cells: Moon ${fp.celdas[1]}, Earth ${fp.celdas[2]} → ${fp.celdas[3]}`, `(b) slope row ${JSON.stringify(fp.celdas)} vs ${JSON.stringify(med)}`);
    const fi = hb.filas.find((f) => f.id === 'iluminacion');
    comprobar(/cannot be measured/.test(fi.celdas[3]) && /no such map for the Earth terrain/.test(fi.celdas[3]) && fi.celdas[2] === '—', `(b) mean illumination: ${fi.celdas[3]}`, `(b) illumination row ${JSON.stringify(fi.celdas)}`);
    comprobar(Object.values(hb.resumen).length === 3 && /Matches/.test(hb.resumen.igual) && /Differs/.test(hb.resumen.distinto), `(b) summary: ${Object.values(hb.resumen).join(' | ')}`, `(b) summary ${JSON.stringify(hb.resumen)}`);
    const g = hb.noRepro.find((x) => x.id === 'gravedad_m_s2');
    comprobar(g && /1\.62 m\/s2 on Moon, 9\.82 m\/s2 on Earth/.test(g.texto) && g.enlaces.length === 2 && g.enlaces.every((u) => /nssdc\.gsfc\.nasa\.gov/.test(u)), `(b) not reproducible: ${hb.noRepro.map((x) => x.texto).join(' | ')}`, `(b) gravity line: ${JSON.stringify(hb.noRepro)}`);
  }
  await pag.screenshot({ path: join(SALIDA, 'a-gemelo.png') });
  await pag.locator('.panel[data-lado=b] .lado').screenshot({ path: join(SALIDA, 'b-ficha-luna.png') });

  // (d) recarga
  await pag.waitForTimeout(600);
  await abrir();
  [ta, tb] = [await lista(0), await lista(1)];
  comprobar(ta.length === 1 && tb.length === 1 && ta[0].par === tb[0].par && !!ta[0].par, '(d) after a reload the pair is still linked', `(d) after reload: ${JSON.stringify(ta)} ${JSON.stringify(tb)}`);
  await pag.click(`.panel[data-lado=a] .marca[data-uid="${ta[0].uid}"] .pin`);
  await pag.waitForTimeout(300);
  comprobar(!!(await hoja('a')) && !!(await hoja('b')), '(d) selecting the Earth twin opens both sheets', '(d) selecting one twin did not open both sheets');

  // (c) quitar
  await pag.click('.panel[data-lado=a] .hoja [data-a=quitar]');
  await pag.waitForTimeout(300);
  [ta, tb] = [await lista(0), await lista(1)];
  comprobar(ta.length === 0 && tb.length === 0, '(c) removing the Earth twin removed the Moon one', `(c) left after remove: earth ${ta.length}, moon ${tb.length}`);

  // (e) apagado
  await pag.click('#espejo');
  await plantar('a', 'viper', -40, 30);
  [ta, tb] = [await lista(0), await lista(1)];
  comprobar(ta.length === 1 && tb.length === 0 && !ta[0].par, '(e) with Mirror equipment off, planting on Earth leaves the Moon alone', `(e) off: earth ${JSON.stringify(ta)} moon ${JSON.stringify(tb)}`);
  await pag.click('#espejo');
  await plantar('a', 'viper', 80, -30);
  [ta, tb] = [await lista(0), await lista(1)];
  comprobar(ta.length === 2 && tb.length === 1 && tb[0].equipo === 'viper', '(e) back on: planting on Earth plants the twin on the Moon', `(e) on again: earth ${ta.length} moon ${JSON.stringify(tb)}`);
  await pag.screenshot({ path: join(SALIDA, 'e-tierra-a-luna.png') });

  // (f) «Drill here» en la Luna pone el punto también en la Tierra, a los mismos metros del centro
  await pag.waitForFunction(() => window.__az.paneles.every((p) => p.volatiles?.V.D), null, { timeout: 30000 });
  await pag.click('.panel[data-lado=b] .perforar');
  const cb = await pag.locator('.panel[data-lado=b] .lienzo canvas').first().boundingBox();
  await pag.mouse.click(cb.x + cb.width / 2 - 70, cb.y + cb.height / 2 + 50);
  await pag.waitForTimeout(500);
  const perf = await pag.evaluate(() => window.__az.paneles.map((p) => ({ perf: p.volatiles.V.perf, tarjeta: !p.el.querySelector('.perforacion').hidden, bocados: p.el.querySelector('.perforacion [data-v=secuencia]')?.dataset.bocados ?? null })));
  const espPerf = perf[1].perf && celdaEspejo({ n: geo[1].n, m: geo[1].m }, { n: geo[0].n, m: geo[0].m, alturas }, perf[1].perf.fila, perf[1].perf.col);
  comprobar(espPerf && perf[0].perf?.fila === espPerf.fila && perf[0].perf?.col === espPerf.col && perf.every((x) => x.tarjeta && x.bocados === '10'), `(f) drilling on the Moon also set the drill point on Earth (cell ${perf[0].perf?.fila},${perf[0].perf?.col}), both cards with the 10-bite sequence`, `(f) drill twin: ${JSON.stringify(perf)} vs ${JSON.stringify(espPerf)}`);
  await pag.screenshot({ path: join(SALIDA, 'f-perforar-gemelo.png') });
  await pag.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('analog-zero.planted.')) localStorage.removeItem(k); });
} catch (e) {
  fallos.push(`script: ${e.message}`); console.error(e);
} finally {
  await nav.close();
  servidor.close();
}
console.log(fallos.length ? `\n${fallos.length} FAILED` : '\nall ok');
process.exit(fallos.length ? 1 : 0);
