// Informe de la simulación: un documento HTML completo y autocontenido (CSS y SVG en línea, sin scripts ni recursos de fuera).
// Entrada = el objeto plano de recoger.js. Sin DOM. Todo texto se escapa; un dato que falta se dice, nunca se rellena.
import { esc, graficoLineas, graficoTira, graficoBarras, graficoHistograma, graficoPlano } from './graficos.js';
import { BORDES_PENDIENTE, PASOS } from './recoger.js';
import { formatoValor, NO_COMPARADO } from '../analogos/metricas.js';

export const TITULO = 'Analog Zero — simulation report';
// Logo del concurso (SVG del kit oficial, lo lee la pantalla): entra solo si es un SVG sin scripts, manejadores ni enlaces.
export const logoSeguro = (s) => (typeof s === 'string' && /^\s*<svg[\s>]/.test(s) && !/<script|<foreignObject|<image|\son\w+\s*=|href\s*=/i.test(s) ? s : '');
const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const fmt = (v, d = 1, u = '') => (fin(v) ? `${v.toFixed(d).replace(/^-(?=0(\.0+)?$)/, '').replace(/^-/, '−')}${u === '°' ? '°' : u ? ` ${u}` : ''}` : 'no data');
const fmtLat = (v) => (fin(v) ? `${Math.abs(v).toFixed(4)}° ${v < 0 ? 'S' : 'N'}` : 'no data');
const fmtLon = (v) => (fin(v) ? `${Math.abs(v).toFixed(4)}° ${v < 0 ? 'W' : 'E'}` : 'no data');
const urlSegura = (u) => (typeof u === 'string' && /^https?:\/\/[^\s"'<>]+$/i.test(u) ? u : null);
const PROYECCION = { estereo_polar: 'polar stereographic (map grid; north is not up)', local_aeqd: 'local azimuthal equidistant (north up)' };
const CRITERIO = { pendiente: 'flat ground', centro: 'near the centre', luz: 'sunlight through the day', sombra: 'least sunlight' };
const CAPA = { altura: 'elevation', agua: 'water mask', iluminacion: 'illumination', sombra_permanente: 'permanent shadow', temp_max: 'max temperature', temp_min: 'min temperature', temp_media: 'mean temperature' };
const MODO_BASE = { prioridad: 'Around what you need most (priority order)', optimo: 'Optimal layout' };
const ESCALA = { propio: 'One day of each world', mismo: 'Same 24 hours' };

const CSS = `
:root{color-scheme:light}
*{box-sizing:border-box}
body{margin:0;background:#FFFFFF;color:#07173F;font:15px/1.5 "Overpass",system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:960px;margin:0 auto;padding:28px 32px 56px}
h1,h2,h3{font-family:"Fira Sans","Overpass",system-ui,sans-serif;color:#07173F;line-height:1.15}
h1{font-weight:900;font-size:30px;margin:4px 0 14px}
h2{font-weight:700;font-size:21px;margin:38px 0 10px;padding-bottom:4px;border-bottom:3px solid #0042A6}
h3{font-weight:700;font-size:16px;margin:22px 0 6px}
.marca{font:900 13px/1 "Fira Sans","Overpass",system-ui,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:#0042A6;margin:0}
a{color:#0042A6;overflow-wrap:anywhere}
p{margin:8px 0}
table{border-collapse:collapse;width:100%;font-size:13px;margin:10px 0 14px}
th,td{border:1px solid #2E96F5;padding:4px 7px;text-align:left;vertical-align:top}
th{background:#07173F;color:#FFFFFF;font-weight:700}
td.num,th.num{text-align:right}
.num{font-family:"Overpass Mono",ui-monospace,"SFMono-Regular",Menlo,monospace;font-variant-numeric:tabular-nums}
.v-ok{font-weight:700;color:#07173F}
.v-rompe{font-weight:700;color:#8E1100}
.v-nm{font-weight:700;color:#0042A6}
tr.rompe td:first-child{border-left:5px solid #E43700}
.propio{color:#0042A6;font-style:italic}
.falta{border-left:4px solid #0042A6;padding:2px 0 2px 10px;font-style:italic}
.nota{font-size:13px}
q,blockquote{font-style:italic}
blockquote{margin:2px 0 0;font-size:12px}
.logo{float:right;margin:0 0 8px 20px}
.logo svg{display:block;height:54px;width:auto}
dl.cab{display:grid;grid-template-columns:max-content 1fr;gap:4px 16px;margin:10px 0}
dl.cab dt{font-weight:700}
dl.cab dd{margin:0}
.sello{display:inline-block;background:#0042A6;color:#FFFFFF;font-weight:700;padding:4px 10px;border-radius:4px}
nav ol{columns:2;font-size:14px;padding-left:22px}
figure{margin:16px 0 20px;break-inside:avoid;page-break-inside:avoid}
figure svg{display:block;max-width:100%;height:auto}
td.num,td span.num{white-space:nowrap}
figcaption{font-size:12px;color:#0042A6;margin-top:4px}
ul.fuentes li{margin:6px 0;font-size:13px}
.pares{display:grid;grid-template-columns:repeat(auto-fit,minmax(420px,1fr));gap:8px 24px}
footer{margin-top:40px;font-size:12px;border-top:1px solid #2E96F5;padding-top:8px}
@media print{
  @page{margin:14mm}
  body{font-size:10.5pt}
  main{max-width:none;padding:0}
  h2{break-after:avoid;page-break-after:avoid}
  h3{break-after:avoid;page-break-after:avoid}
  table.corta,figure,.bloque{break-inside:avoid;page-break-inside:avoid}
  tr{break-inside:avoid;page-break-inside:avoid}
  thead{display:table-header-group}
  nav{display:none}
}`;

// Fuentes citadas: cada URL una vez, con todos sus textos y citas.
function registro() {
  const m = new Map();
  const enlace = (url, rotulo, { texto = null, cita = null } = {}) => {
    const u = urlSegura(url);
    if (!u) return esc(rotulo ?? texto ?? 'no source');
    if (!m.has(u)) m.set(u, { textos: new Set(), citas: new Set() });
    if (texto) m.get(u).textos.add(texto);
    if (cita) m.get(u).citas.add(cita);
    return `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(rotulo ?? hostDe(u))}</a>`;
  };
  return { enlace, lista: () => [...m].map(([url, x]) => ({ url, textos: [...x.textos], citas: [...x.citas] })) };
}
const hostDe = (u) => { try { return new URL(u).hostname; } catch { return 'source'; } };

const fila = (celdas, clase = '') => `<tr${clase ? ` class="${clase}"` : ''}>${celdas.map((c) => (typeof c === 'object' && c !== null ? `<td${c.num ? ' class="num"' : ''}>${c.html}</td>` : `<td>${c}</td>`)).join('')}</tr>`;
const tabla = (cab, filas, corta = true) => `<table${corta ? ' class="corta"' : ''}><thead><tr>${cab.map((c) => `<th${c.num ? ' class="num"' : ''}>${c.html ?? esc(c)}</th>`).join('')}</tr></thead><tbody>${filas.join('')}</tbody></table>`;
const n = (html) => ({ html, num: true });
const falta = (t) => `<p class="falta">${t}</p>`;
const seccion = (k, titulo, cuerpo) => `<section id="s${k}"><h2>${k}. ${esc(titulo)}</h2>${cuerpo}</section>`;

function textoPunto(x) {
  return x ? `${esc(x.nombre ?? '')} · <span class="num">${fmtLat(x.lat)}, ${fmtLon(x.lon)}</span>${x.de === 'window centre' ? ' <span class="nota">(centre of the terrain window)</span>' : ''}` : 'none in this simulation';
}

// ---------- 1. Cabecera ----------
function cabecera(d, F) {
  const mundo = d.mundo ? `${esc(d.mundo.nombre)} · <span class="num">${fmtLat(d.mundo.lat)}, ${fmtLon(d.mundo.lon)}</span>${d.mundo.de === 'point' ? ' <span class="nota">(your point)</span>' : ` <span class="nota">(centre of the ${esc(d.mundo.terreno ?? '')} window)</span>`}` : 'none: this simulation has no Moon or Mars terrain';
  const url = urlSegura(d.url);
  const logo = logoSeguro(d.logo_svg);
  return `<header>${logo ? `<div class="logo" role="img" aria-label="NASA Space Apps Challenge">${logo}</div>` : ''}<p class="marca">Analog Zero</p><h1>${esc(TITULO)}</h1>
    ${d.ejemplo || d.paneles.some((p) => p.sintetico) ? '<p><span class="sello">SYNTHETIC EXAMPLE — not real data</span></p>' : ''}
    <dl class="cab"><dt>World and point</dt><dd>${mundo}</dd>
    <dt>Place on Earth</dt><dd>${textoPunto(d.lugar)}</dd>
    <dt>Simulation</dt><dd>${url ? `<a href="${esc(url)}">${esc(url)}</a>` : 'address not available'}<div class="nota">Opening this address rebuilds the same terrains and settings. The base and the equipment planted by hand are not in the address: they are listed in this report.</div></dd></dl>
    <nav><ol>${['Parameters used', 'Terrain of both worlds', 'Sun through the day', 'Light on each piece hour by hour', 'Base layout', 'Published limits checked', 'Similarity parameter by parameter', 'What this report does not measure', 'Sources'].map((t, i) => `<li value="${i + 2}"><a href="#s${i + 2}">${esc(t)}</a></li>`).join('')}</ol></nav></header>`;
}

// ---------- 2. Parámetros ----------
function parametros(d, F) {
  const P = [];
  const add = (nombre, valor, nota = '') => P.push(fila([esc(nombre), valor, nota]));
  add('World and point', d.mundo ? `${esc(d.mundo.nombre)} · <span class="num">${fmtLat(d.mundo.lat)}, ${fmtLon(d.mundo.lon)}</span>` : 'none', d.mundo?.de === 'point' ? 'from the address (&amp;punto=)' : d.mundo ? 'centre of the terrain window' : '');
  add('Place on Earth', d.lugar ? textoPunto(d.lugar) : 'none', d.lugar?.de === 'place' ? 'from the address (&amp;lugar=)' : d.lugar ? 'centre of the terrain window' : '');
  if (fin(d.simulacion.ventana_km)) add('Window side asked for', `<span class="num">${fmt(d.simulacion.ventana_km, 0, 'km')}</span>`, 'from the address (&amp;lado=, default 10 km)');
  for (const p of d.paneles) {
    const h = esc(p.nombre_cuerpo);
    add(`${p.nombre_cuerpo}: terrain`, `${esc(p.nombre)} <span class="nota num">(${esc(p.id)})</span>`, p.dinamico || p.es_punto ? 'built live in the browser from open elevation data, not stored' : 'terrain catalogue of this tool');
    add(`${p.nombre_cuerpo}: grid`, `<span class="num">${p.n} × ${p.n}</span> cells of <span class="num">${fmt(p.m, 2, 'm')}</span> · side <span class="num">${fmt(p.lado_km, 2, 'km')}</span>`, esc(PROYECCION[p.georef] ?? p.georef ?? ''));
    for (const f of p.fuentes) add(`${p.nombre_cuerpo}: ${CAPA[f.capa] ?? f.capa} data`, F.enlace(f.url, f.texto, { texto: f.texto }), f.origen ? '<span class="propio">own processing</span>' : '');
    if (p.muestreo) add(`${p.nombre_cuerpo}: sampling`, esc(p.muestreo), '');
    if (p.imagen) add(`${p.nombre_cuerpo}: ground colour`, esc(p.imagen), 'visual only');
    if (p.retocado) add(`${p.nombre_cuerpo}: retouched`, p.original ? 'yes, but the original elevation is being shown' : 'yes: statistics and slopes use the retouched elevation', 'own edit in the viewer');
    if (p.tipo_sol === 'polar') add(`${p.nombre_cuerpo}: Sun height`, `<span class="num">${fmt(p.el_display, 1, '°')}</span>`, `${h} polar window: set in Display and held through the day <span class="propio">(own simplification)</span>`);
  }
  add('Mission', d.simulacion.mision ? esc(d.simulacion.mision) : 'none in the address', '');
  add('Month in the address', d.simulacion.mes_url ? esc(d.simulacion.mes_url) : 'none', '');
  if (d.dia) {
    if (d.paneles.some((p) => p.tipo_sol === 'tierra')) add('Day: Earth month', esc(d.dia.mes_nombre ?? 'no data'), 'Sun of day 15 of the month <span class="propio">(own choice)</span>');
    if (d.paneles.some((p) => p.tipo_sol === 'polar' || p.tipo_sol === 'mundo')) add('Day: time scale', esc(ESCALA[d.dia.modo] ?? d.dia.modo), '');
    if (d.paneles.some((p) => p.cuerpo === 'marte' && p.tipo_sol === 'mundo')) add('Day: Mars season', `Sun over latitude <span class="num">${fmt(d.dia.decl, 2, '°')}</span>`, '');
    add('Day: running', d.dia.activo ? `yes, at <span class="num">${fmt(d.dia.hora, 2)}</span> of 24` : 'no (the Sun in the 3D view is the one set by hand)', 'the hour-by-hour tables below do not depend on it');
  }
  if (d.base) {
    add('Base: radius', `<span class="num">${fmt(d.base.radio_m, 0, 'm')}</span>`, d.base.restaurada ? 'base restored from a previous visit' : '');
    add('Base: placement mode', d.base.modo ? esc(MODO_BASE[d.base.modo] ?? d.base.modo) : 'not set', d.base.modo ? '<span class="propio">own rules</span>' : 'the base panel does not report a mode');
    add('Base: placement order', d.base.orden?.length ? esc(d.base.orden.join(' → ')) : 'not set', 'order in which the pieces were placed; numbers in sections 5–7 follow it');
    add('Base: minimum separation', fin(d.base.separacion_min_m) ? `<span class="num">${fmt(d.base.separacion_min_m, 0, 'm')}</span>` : 'no data', '<span class="propio">own choice</span>: max(1.5 × the larger cell, radius ÷ 12)');
    add('Base: free ground between footprints', `<span class="num">${fmt(d.base.holgura_m, 0, 'm')}</span>`, '<span class="propio">own choice</span>');
  } else add('Base', 'not generated', 'press Generate base');
  add('Vertical exaggeration', `<span class="num">${fmt(d.simulacion.exag, 1)}×</span>`, 'visual only: no measurement in this report uses it');
  if (d.simulacion.espejo_aplica) add('Mirror equipment', d.simulacion.espejo ? 'on' : 'off', 'what is planted on one world is also planted on the other, at the same offset from the centre');
  return tabla(['Parameter', 'Value', 'Note'], P, false);
}

// ---------- 3. Terreno ----------
function terreno(d) {
  if (!d.paneles.length) return falta('No terrain could be loaded, so there is nothing to describe.');
  const P = d.paneles, cab = ['', ...P.map((p) => n(`${esc(p.nombre_cuerpo)}`))];
  const st = (k, campo, dec, u) => P.map((p) => n(fmt(p[k][campo], dec, u)));
  const filas = [
    fila(['Cells with elevation', ...P.map((p) => n(`${p.cotas.validas.toLocaleString('en-US')} of ${p.cotas.total.toLocaleString('en-US')} (${fmt((100 * p.cotas.validas) / p.cotas.total, 2)} %)`))]),
    ...[['min', 'Elevation, min'], ['p05', 'Elevation, 5th percentile'], ['mediana', 'Elevation, median'], ['media', 'Elevation, mean'], ['p95', 'Elevation, 95th percentile'], ['max', 'Elevation, max'], ['de', 'Elevation, standard deviation']].map(([c, t]) => fila([t, ...st('cotas', c, 1, 'm')])),
    fila(['Cells with a slope', ...P.map((p) => n(p.pendientes.validas.toLocaleString('en-US')))]),
    ...[['min', 'Slope, min'], ['mediana', 'Slope, median'], ['media', 'Slope, mean'], ['p95', 'Slope, 95th percentile'], ['max', 'Slope, max']].map(([c, t]) => fila([t, ...st('pendientes', c, 2, '°')])),
    fila(['Water cells (not ground)', ...P.map((p) => n(p.celdas_agua === null ? 'no water layer' : p.celdas_agua.toLocaleString('en-US')))]),
    fila(['Elevation reference', ...P.map((p) => esc(p.z_referencia ?? 'not stated'))]),
  ];
  const hist = graficoHistograma({
    titulo: 'Slope of every cell, same classes for both worlds', bordes: BORDES_PENDIENTE,
    series: P.map((p) => ({ nombre: `${p.nombre_cuerpo} (cells of ${fmt(p.m, 1)} m)`, valores: p.hist_pendiente })),
    x: { rotulo: 'Slope (°), classes of 2°' }, y: { rotulo: 'Share of cells with a slope (%)' },
    pie: 'Own calculation from the elevation grids above: slope by central differences over 2 cells; cells without elevation and water cells left out.',
  });
  const bases = P.length === 2 && P[0].m !== P[1].m ? `<p class="nota">Slopes are measured over 2 cells: ${P.map((p) => `${fmt(2 * p.m, 0, 'm')} on ${esc(p.nombre_cuerpo)}`).join(', ')}. The grids are not resampled, so the two slope distributions are only roughly comparable.</p>` : '';
  return `${tabla(cab, filas)}<p class="nota">Percentiles: nearest rank. Standard deviation over all cells with data. Own calculation from the grids shown in the viewer.</p>${bases}${hist}`;
}

// ---------- 4. Sol ----------
function sol(d, F) {
  const P = d.paneles.filter((p) => p.sol);
  if (!P.length) return falta('The Day bar cannot move the Sun on these terrains (an Earth terrain in a polar grid), so there is no hour-by-hour Sun.');
  const nombre = (p) => `${p.nombre_cuerpo}${p.tipo_sol === 'polar' ? ' (grid azimuth)' : ''}`;
  const eje = { rotulo: 'Hour of the day (0–24 = one day; time scales above)', min: 0, max: 24, marcas: [0, 3, 6, 9, 12, 15, 18, 21, 24] };
  const alt = graficoLineas({ titulo: 'Sun elevation through the day', series: P.map((p) => ({ nombre: p.nombre_cuerpo, puntos: p.sol.map((s) => [s.t, s?.el ?? NaN]) })), x: eje, y: { rotulo: 'Sun elevation (°)' }, pie: 'Own calculation (formulas and periods above). Below 0° the Sun is under the horizon.' });
  const conCorte = (sols) => {
    const out = [];
    sols.forEach((s, i) => { if (i && fin(s?.az) && fin(sols[i - 1]?.az) && Math.abs(s.az - sols[i - 1].az) > 180) out.push([NaN, NaN]); out.push([s.t, s?.az ?? NaN]); });
    return out;
  };
  const az = graficoLineas({ titulo: 'Sun azimuth through the day', series: P.map((p) => ({ nombre: nombre(p), puntos: conCorte(p.sol) })), x: eje, y: { rotulo: 'Azimuth (°, clockwise)', min: 0, max: 360, marcas: [0, 90, 180, 270, 360] }, pie: 'Own calculation. Earth and non-polar windows: compass azimuth from north. Lunar polar window: grid azimuth = subsolar longitude, not a compass bearing. The line breaks where it wraps past 360°.' });
  const filas = Array.from({ length: PASOS + 1 }, (_, t) => fila([n(String(t)), ...P.flatMap((p) => [n(fmt(p.sol[t]?.el, 2, '°')), n(fmt(p.sol[t]?.az, 1, '°'))])]));
  const escalas = P.map((p) => {
    if (p.tipo_sol === 'tierra') return `<li>${esc(p.nombre_cuerpo)}: local solar time (12 = Sun on the meridian), 1 unit = 1 hour; Sun of day 15 of ${esc(d.dia?.mes_nombre ?? 'the month')} <span class="propio">(own choice)</span>. Formulas: ${F.enlace(d.fuentes_sol.tierra.url, d.fuentes_sol.tierra.texto, { texto: d.fuentes_sol.tierra.texto, cita: d.fuentes_sol.tierra.cita })}, <q>${esc(d.fuentes_sol.tierra.cita)}</q>.</li>`;
    const luna = p.cuerpo === 'luna', f = luna ? d.fuentes_sol.luna : d.fuentes_sol.marte;
    const periodo = `${F.enlace(f.url, f.texto, { texto: f.texto, cita: f.cita })}, <q>${esc(f.cita)}</q>`;
    const unidad = `1 unit = <span class="num">${fmt(p.equivale_h, 2)}</span> Earth hours`;
    if (p.tipo_sol === 'polar') return `<li>${esc(p.nombre_cuerpo)} (polar window): the Sun goes once round the horizon in one lunar day (${periodo}); ${unidad}. Its height stays at the value set in Display (<span class="num">${fmt(p.el_display, 1, '°')}</span>) <span class="propio">(own simplification: at the pole it changes with the season, not the hour)</span>.</li>`;
    const marte = p.cuerpo === 'marte' ? `; Mars season: Sun over latitude <span class="num">${fmt(d.dia?.decl, 2, '°')}</span> (tilt ${F.enlace(f.url, f.texto, { texto: f.texto, cita: f.cita_oblicuidad })}, <q>${esc(f.cita_oblicuidad)}</q>)` : '; Sun taken over the equator <span class="propio">(own simplification)</span>';
    return `<li>${esc(p.nombre_cuerpo)}: local solar time of its own day (${periodo}); ${unidad}${marte}. Same NOAA spherical formula as on Earth.</li>`;
  });
  return `<p>Two time scales: <b>One day of each world</b> runs each world through one full day of its own on the same 0–24 axis; <b>Same 24 hours</b> lets the same 24 Earth hours pass everywhere. This report uses the one set in Day: <b>${esc(ESCALA[d.dia?.modo] ?? 'not set')}</b>.</p>
    <ul>${escalas.join('')}</ul><p class="nota"><span class="propio">Own calculation</span> in the browser from these formulas and periods; no ephemeris.</p>
    ${alt}${az}
    <div class="bloque"><h3>Hour by hour</h3>${tabla([n('Hour'), ...P.flatMap((p) => [n(`${esc(p.nombre_cuerpo)} elevation`), n(`${esc(p.nombre_cuerpo)} ${p.tipo_sol === 'polar' ? 'grid azimuth' : 'azimuth'}`)])], filas, false)}</div>`;
}

// ---------- 5. Luz por pieza ----------
const SIN_BASE = 'No base generated: press Generate base.';
const rotPieza = (x) => `${x.num ?? '–'} ${x.nombre}`;
function luz(d) {
  const P = d.paneles.filter((p) => p.piezas.length);
  if (!P.length) return falta(`${SIN_BASE} Nothing is planted by hand either.`);
  let out = d.base ? '' : falta(`${SIN_BASE} Below: equipment planted by hand.`);
  const conLuz = P.filter((p) => p.mapa_luz);
  for (const p of P) {
    if (!p.mapa_luz) { out += falta(`${esc(p.nombre_cuerpo)}: no light map (the Day bar does not move the Sun on this terrain, or the map was still being worked out when this report was built).`); continue; }
    out += graficoTira({
      titulo: `Light on each piece through the day · ${p.nombre_cuerpo} (steps sunlit on the right)`,
      filas: p.piezas.map((x) => ({ rotulo: rotPieza(x), celdas: x.luz ?? Array(PASOS).fill(null), extra: fin(x.horas_luz) ? `${x.horas_luz} of ${PASOS}` : 'no data' })),
      x: { rotulo: `Step of the day (${p.unidad_paso ?? 'steps'}; 1 step = ${fmt(p.equivale_h, 2)} Earth hours)`, etiquetas: [0, 6, 12, 18, 24] },
      pie: 'Own calculation: shadow cast by the terrain with the Sun at the middle of each step. The shadows of the equipment itself are not included.',
    });
  }
  if (conLuz.length) {
    out += graficoLineas({
      titulo: 'Pieces in sunlight at each step',
      series: conLuz.map((p) => ({ nombre: `${p.nombre_cuerpo} (${p.piezas.length} pieces)`, puntos: Array.from({ length: PASOS }, (_, k) => [k + 0.5, p.piezas.some((x) => !x.luz) ? NaN : p.piezas.filter((x) => x.luz[k] === 'sol').length]) })),
      x: { rotulo: 'Step of the day (middle of each step)', min: 0, max: 24, marcas: [0, 3, 6, 9, 12, 15, 18, 21, 24] }, y: { rotulo: 'Pieces sunlit (count)', min: 0, max: Math.max(1, ...conLuz.map((p) => p.piezas.length)) },
      pie: 'Count of the strips above that are sunlit at each step.',
    });
    out += `<div class="bloque">${tabla(['World', 'Piece', n('Steps sunlit'), n('Earth hours sunlit')], conLuz.flatMap((p) => p.piezas.map((x) => fila([esc(p.nombre_cuerpo), esc(rotPieza(x)), n(fin(x.horas_luz) ? `${x.horas_luz} of ${PASOS}` : 'no data'), n(fin(x.horas_luz) ? fmt(x.horas_luz * p.equivale_h, 1, 'h') : 'no data')]))), false)}</div>`;
  }
  return `${out}<p><b>Temperature hour by hour: NOT MEASURED</b> (not loaded in this viewer).</p>`;
}

// ---------- 6. Base ----------
function textoCriterio(c, sombraDe) {
  const nom = c.tipo === 'cerca' ? `near ${c.con ?? 'another piece'}` : c.tipo === 'lejos' ? `far from ${c.con ?? 'another piece'}` : CRITERIO[c.tipo] ?? c.tipo;
  if (!c.usado) return `${esc(nom)} ×${c.peso} <span class="nota">(not used: ${esc(c.motivo ?? 'no data')})</span>`;
  const v = c.tipo === 'pendiente' ? fmt(c.valor, 1, '°') : c.tipo === 'luz' ? `${fmt(c.valor, 0)} steps sunlit` : c.tipo === 'sombra' ? (sombraDe === 'sombra_permanente' ? `${fmt(c.valor, 0, 'm')} to permanent shadow` : `${fmt(c.valor * 100, 0)} % of the day dark`) : fmt(c.valor, 0, 'm');
  return `${esc(nom)} ×${c.peso} <span class="num">(${v})</span>`;
}
function base(d) {
  if (!d.base) return falta(SIN_BASE);
  const B = d.base, P = d.paneles.filter((p) => p.piezas.some((x) => x.de_base));
  const pri = d.paneles.find((p) => p.lado === B.pri), sec = d.paneles.find((p) => p.lado === B.sec);
  let out = `<p>Radius <span class="num">${fmt(B.radio_m, 0, 'm')}</span> around ${P.some((p) => p.centro_base?.punto) ? 'your point' : 'the window centre'}.${pri && sec ? ` Laid out for ${esc(pri.nombre_cuerpo)}; ${esc(sec.nombre_cuerpo)} gets the same layout, each piece at the same offset from the centre rounded to its own grid, to rehearse it.` : ''} The placement rules and their weights are <span class="propio">own rules</span>; the limits are the published ones (section 7).</p>`;
  if (B.restaurada) out += falta('This base was restored from a previous visit: the placement criteria were not kept. Press Generate again to see them.');
  for (const p of P) {
    const pz = p.piezas.filter((x) => x.de_base);
    const plano = graficoPlano({ titulo: `Base on ${p.nombre_cuerpo}`, radio_m: B.radio_m, piezas: pz.map((x) => ({ num: x.num, este_m: x.este_m, sur_m: x.sur_m, rompe: x.agua || x.requisitos.some((r) => r.estado === 'rompe') })), norteArriba: p.norte_arriba, pie: `Positions from the viewer grid (${fmt(p.m, 2)} m cells). Dashed ring = radius. Red ring = breaks a published limit (section 7).` });
    const [cx, cy] = p.norte_arriba ? ['East (m)', 'South (m)'] : ['Grid right (m)', 'Grid down (m)'];
    const filas = pz.map((x) => fila([n(String(x.num ?? '–')), esc(x.nombre), n(fmt(x.este_m, 0)), n(fmt(x.sur_m, 0)), n(fmt(x.dist_m, 0)), n(fmt(x.cota, 1)), n(x.agua ? 'water' : fmt(x.pendiente, 2)), `${esc(x.regla ?? '')} <span class="propio">(own rule)</span>`, x.criterios ? x.criterios.map((c) => textoCriterio(c, B.sombra_de)).join('<br>') : `<span class="nota">${B.restaurada ? 'not kept (restored base)' : 'same place as on the other world'}</span>`]));
    const cb = p.centro_base, mov = cb && (Math.abs(cb.este_m) > 0.5 || Math.abs(cb.sur_m) > 0.5);
    out += `<h3>${esc(p.nombre_cuerpo)}</h3>${mov ? `<p class="nota">Centre of the base: <span class="num">${fmt(cb.este_m, 0, 'm')}</span> ${p.norte_arriba ? 'east' : 'grid right'} and <span class="num">${fmt(cb.sur_m, 0, 'm')}</span> ${p.norte_arriba ? 'south' : 'grid down'} of the window centre. Offsets below are from the centre of the base.</p>` : ''}${plano}${tabla([n('No.'), 'Piece', n(cx), n(cy), n('From centre (m)'), n('Elevation (m)'), n('Slope (°)'), 'Placement rule', 'Criteria × weight (value)'], filas, false)}`;
  }
  const notas = [];
  if (B.sin_sitio.length) notas.push(`Not placed: ${B.sin_sitio.map((x) => `${esc(x.nombre)} (${esc(x.motivo)})`).join(' · ')}`);
  if (B.excluidos.length) notas.push(`Left out: ${B.excluidos.map((x) => `${esc(x.nombre)} (${esc(x.motivo)})`).join(' · ')}`);
  if (fin(B.candidatos)) notas.push(`${B.candidatos.toLocaleString('en-US')} cells tried inside the radius${B.paso > 1 ? ` (one in every ${B.paso} each way)` : ''}; ${B.usa_luz ? 'light = sunlit steps of the day computed from the terrain' : 'no light map: light rules not used'}${B.sombra_de === 'sombra_permanente' ? '; least sunlight = distance to the permanent-shadow map' : ''}.`);
  return out + (notas.length ? `<ul class="nota">${notas.map((t) => `<li>${t}</li>`).join('')}</ul>` : '');
}

// ---------- 7. Límites ----------
const CLASE_V = { ok: 'v-ok', rompe: 'v-rompe' };
function limites(d, F) {
  const P = d.paneles.filter((p) => p.piezas.length);
  if (!P.length) return falta(`${SIN_BASE} Nothing planted, so no published limit was checked.`);
  const resumen = P.map((p) => {
    const rotas = p.piezas.filter((x) => x.agua || x.requisitos.some((r) => r.estado === 'rompe'));
    return `<li><b>${esc(p.nombre_cuerpo)}</b>: <span class="num">${rotas.length}</span> of <span class="num">${p.piezas.length}</span> pieces break at least one published limit${rotas.length ? ` (${rotas.map((x) => esc(rotPieza(x))).join(', ')})` : ''}.</li>`;
  }).join('');
  let out = `<ul>${resumen}</ul>`;
  for (const p of P) {
    const filas = p.piezas.flatMap((x) => {
      const nom = esc(rotPieza(x));
      const pre = x.agua ? [fila([nom, 'Ground', '—', 'water', '<span class="v-rompe">ON WATER</span> <span class="nota">the elevation data are the water surface, not ground</span>', 'water mask of the terrain (section 2)'], 'rompe')] : [];
      if (!x.en_catalogo) return [...pre, fila([nom, '—', '—', '—', '<span class="v-nm">NOT CHECKED</span>', 'not in the equipment catalogue used for these checks'])];
      if (!x.requisitos.length) return [...pre, fila([nom, '—', '—', '—', '<span class="v-nm">NO LIMIT</span>', 'the catalogue has no public design limit for this system'])];
      return [...pre, ...x.requisitos.map((r) => fila([nom, esc(r.nombre), n(esc(r.limite ?? '—')), n(esc(r.valor)),
        `<span class="${CLASE_V[r.estado] ?? 'v-nm'}">${esc(r.veredicto)}</span>${r.estado === 'rompe' || r.estado === 'ok' ? '' : ` <span class="nota">${esc(r.motivo ?? r.nota ?? '')}</span>`}${r.estado === 'rompe' ? ` <span class="nota">${esc(r.nota.replace(/^published limit [^:]*: /, ''))}</span>` : ''}`,
        `${F.enlace(r.url, null, { texto: r.texto, cita: r.cita })}${r.texto ? ` <span class="nota">${esc(r.texto)}</span>` : ''}${r.cita ? `<blockquote>“${esc(r.cita)}”${r.verificado ? '' : ' (quote not verified)'}</blockquote>` : ''}`], r.estado === 'rompe' ? 'rompe' : ''))];
    });
    out += `<h3>${esc(p.nombre_cuerpo)}</h3>${tabla(['Piece', 'Requirement', n('Published limit'), n('Value here'), 'Verdict', 'Source and quote'], filas, false)}`;
  }
  return `${out}<p class="nota">Values are read on the viewer grid at the cell of each piece (slope over 2 cells). NOT MEASURED = this viewer has no data for it here; the reason is given.</p>`;
}

// ---------- 8. Parecido ----------
function parecido(d, F) {
  const R = d.parecido, enl = urlSegura(d.enlace_resultados);
  const ir = enl ? `<a href="${esc(enl)}">results page</a>` : 'results page';
  if (!R?.filas) return falta(`${esc(R?.motivo ?? 'Not computed.')} The similarity parameter by parameter is on the ${ir}.`);
  const nom = d.mundo?.nombre ?? 'World', B = R.busqueda ?? null;
  const barras = graficoBarras({ titulo: `Match of each parameter: ${nom} point vs the place on Earth`, filas: R.filas.map((f) => ({ rotulo: f.nombre, valor: f.similitud_pct, texto: fin(f.similitud_pct) ? `${f.similitud_pct.toFixed(1)} %` : null })), x: { rotulo: 'Match (%) = 100 − deviation', min: 0, max: 100 }, pie: `Search engine of this tool (web/buscar/motor.js): values of the ${fmt(R.celda_deg, 2, '°')} global cells that contain the two points. Own metric.` });
  const filas = R.filas.map((f) => fila([esc(f.nombre), n(`${esc(formatoValor(f.valor_mundo, f.unidad, f))}${f.referencia ? ' †' : ''}`), n(`${esc(formatoValor(f.valor_tierra, f.unidad, f))}${f.mensual ? ' *' : ''}`), n(fin(f.similitud_pct) ? `${f.similitud_pct.toFixed(1)} %` : 'no data'), f.fuentes.map((s) => `${F.enlace(s.url, null, { texto: s.texto, cita: s.cita })}${s.origen ? ' <span class="propio">(own computation)</span>' : ''}`).join(' · ')]));
  const cab = `<p>Global grid cell of <span class="num">${fmt(R.celda_deg, 2, '°')}</span>. Deviation per parameter <span class="propio">(own metric)</span>: <span class="num">${esc(R.formula ?? '')}</span>.`;
  if (B) {
    const M = B.mision, notas = [];
    if (R.filas.some((f) => f.referencia)) notas.push(`† trait that only exists on Earth: the target is its value at ${M?.referencia ? `the test site of this mission, ${esc(M.referencia)}` : 'the reference site'}, not at your point.`);
    if (R.filas.some((f) => f.mensual)) notas.push(`* Earth value of ${esc(B.mes_nombre ?? `month ${B.mes}`)} (average of that month over many years); the rest are whole-year values.`);
    if (B.no_usados.length) notas.push(`Not used by this search: ${B.no_usados.map(esc).join(', ')}.`);
    return `${cab}</p>
    <p>Same search as the ${ir}: ${M ? `mission objective <b>${esc(M.titulo)}</b> <span class="propio">(own mapping of its traits to ${fmt(M.parametros, 0)} parameters${M.ampliada ? ', plus every parameter of your point' : ''})</span>` : 'every parameter that can be reproduced on Earth'}, ${B.mes === null ? 'whole-year Earth values' : `Earth in ${esc(B.mes_nombre ?? `month ${B.mes}`)}`}. In that search this place is number <span class="num">${fmt(B.puesto, 0)}</span>${B.lista === 'parciales' ? ' of the places with only part of the data' : ''}, with an overall match of <span class="num">${fin(B.similitud_pct) ? `${B.similitud_pct.toFixed(1)} %` : 'no data'}</span> over <span class="num">${fmt(B.comparados, 0)}</span> of <span class="num">${fmt(B.de, 0)}</span> parameters <span class="propio">(own metric, not a probability)</span>.</p>
    ${barras}${tabla(['Parameter', n('Target'), n('Earth'), n('Match'), 'Sources'], filas, false)}${notas.length ? `<ul class="nota">${notas.map((t) => `<li>${t}</li>`).join('')}</ul>` : ''}`;
  }
  return `${cab} The overall match and the ranking of places are on the ${ir}.</p>
    <p>Compared here: every parameter that can be reproduced on Earth, with the whole-year values of the global grid.${d.simulacion?.mision || d.simulacion?.mes_url ? ` <b>The mission objective and the month in the address are not applied in this table</b>${R.sin_busqueda ? ` (${esc(R.sin_busqueda)})` : ''}: the ${ir} applies them (its own parameter set, its reference site and that month on Earth), so its figures can differ from these.` : ''}</p>
    ${barras}${tabla(['Parameter', n(esc(nom)), n('Earth (whole year)'), n('Match'), 'Sources'], filas, false)}`;
}

// ---------- 9. Lo que no mide ----------
function noMide(d, F) {
  const L = [];
  for (const x of d.limites_tierra) {
    const v = fin(x.mundo) && fin(x.tierra) ? `: <span class="num">${esc(formatoValor(x.mundo, x.unidad))}</span> on ${esc(d.mundo?.nombre ?? 'the other world')}, <span class="num">${esc(formatoValor(x.tierra, x.unidad))}</span> on Earth` : '';
    L.push(`<li><b>${esc(x.nombre)}</b>${v}. ${esc(x.aviso ?? 'Cannot be reproduced at a fixed place on Earth.')} ${x.fuentes.map((f) => F.enlace(f.url, null, { texto: f.texto, cita: f.cita })).join(' · ')}</li>`);
  }
  L.push(`<li><b>${NO_COMPARADO.map(esc).join(', ')}</b>: not compared by this tool (no global layer), as stated on the results page.</li>`);
  L.push('<li><b>Temperature hour by hour</b>: NOT MEASURED (not loaded in this viewer).</li>');
  const sinModelo = d.paneles.flatMap((p) => p.piezas.filter((x) => !x.modelo3d).map((x) => `${x.nombre} (${p.nombre_cuerpo})`));
  if (sinModelo.length) L.push(`<li><b>No 3D model</b> (marker only, no published size to draw it to scale): ${esc([...new Set(sinModelo)].join(', '))}.</li>`);
  const noEns = new Map();
  for (const p of d.paneles) for (const x of p.piezas) for (const z of x.no_ensayable) noEns.set(`${x.id}|${z.factor}|${z.texto}`, { ...z, nombre: x.nombre });
  if (noEns.size) L.push(`<li><b>Not testable on Earth</b> (equipment catalogue): ${[...noEns.values()].map((z) => `${esc(z.nombre)}: ${esc(z.texto ?? z.factor ?? '')} ${F.enlace(z.url, null, { cita: z.cita })}`).join(' · ')}</li>`);
  const propias = ['Sun of day 15 of each Earth month', 'light map from the terrain only, with the Sun at the middle of each step'];
  if (d.paneles.some((p) => p.tipo_sol === 'polar')) propias.push('Sun height held constant through the lunar polar day');
  if (d.paneles.some((p) => p.cuerpo === 'luna' && p.tipo_sol === 'mundo')) propias.push('Sun over the lunar equator');
  if (d.base) propias.push('placement rules and weights of the base', 'minimum separation and free ground between pieces');
  if (d.parecido?.filas) propias.push('the similarity metric and its reference ranges');
  L.push(`<li><b>Own rules</b>, not from a source: ${esc(propias.join('; '))}.</li>`);
  const res = d.paneles.map((p) => `${p.nombre_cuerpo} ${fmt(p.m, 2, 'm')}`).join(', ');
  if (res) L.push(`<li><b>Grain of the terrain</b>: one elevation value every ${esc(res)}. Anything smaller than one cell is not in the data.</li>`);
  L.push('<li><b>Limits of the Earth as an analogue</b>: a place matches in some parameters and not in others; section 8 says which and how much. What cannot be reproduced is listed above.</li>');
  return `<ul>${L.join('')}</ul>`;
}

function fuentes(F) {
  const lista = F.lista();
  if (!lista.length) return falta('No source was cited.');
  return `<ul class="fuentes">${lista.map((x) => `<li><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.url)}</a>${x.textos.length ? `<div>${x.textos.map(esc).join(' · ')}</div>` : ''}${x.citas.map((c) => `<blockquote>“${esc(c)}”</blockquote>`).join('')}</li>`).join('')}</ul>`;
}

export function construirInforme(d) {
  const F = registro();
  const S = [
    seccion(2, 'Parameters used', parametros(d, F)),
    seccion(3, 'Terrain of both worlds', terreno(d)),
    seccion(4, 'Sun through the day', sol(d, F)),
    seccion(5, 'Light on each piece hour by hour', luz(d)),
    seccion(6, 'Base layout', base(d)),
    seccion(7, 'Published limits checked', limites(d, F)),
    seccion(8, 'Similarity parameter by parameter', parecido(d, F)),
    seccion(9, 'What this report does not measure', noMide(d, F)),
  ];
  const cab = cabecera(d, F);
  S.push(seccion(10, 'Sources', fuentes(F)));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(TITULO)}${d.mundo ? ` · ${esc(d.mundo.nombre)} ${fmtLat(d.mundo.lat)}, ${fmtLon(d.mundo.lon)}` : ''}</title>
<style>${CSS}</style>
</head>
<body>
<main>
<section id="s1">${cab}</section>
${S.join('\n')}
<footer>Made with Analog Zero in the browser from the simulation above. Sources cited are listed in section 10; own calculations and own rules are labelled as such.</footer>
</main>
</body>
</html>
`;
}
