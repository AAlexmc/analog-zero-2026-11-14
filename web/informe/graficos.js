// Gráficos del informe como cadenas SVG dentro de un <figure>: líneas, tira por horas, barras, histograma y plano de la base.
// Sin DOM. Colores solo de la marca; un valor no finito deja un hueco, nunca se dibuja como 0.
export const COLORES = { tinta: '#07173F', acento: '#0042A6', celeste: '#2E96F5', neon: '#0960E1', rojo: '#E43700', marte: '#8E1100', amarillo: '#EAFE07', blanco: '#FFFFFF' };
const SERIES = [COLORES.acento, COLORES.rojo, COLORES.celeste, COLORES.marte];
const TRAZOS = ['', '7 4', '2 3', '9 3 2 3'];
const FUENTE = 12;

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const r1 = (v) => Math.round(v * 10) / 10;

function pasoBonito(bruto) {
  const mag = 10 ** Math.floor(Math.log10(bruto)), k = bruto / mag;
  return (k <= 1 ? 1 : k <= 2 ? 2 : k <= 5 ? 5 : 10) * mag;
}

// Marcas redondas que cubren [min, max].
export function marcas(min, max, n = 6) {
  if (!fin(min) || !fin(max)) return [];
  if (max < min) [min, max] = [max, min];
  if (max === min) { const d = Math.abs(min) * 0.1 || 1; min -= d; max += d; }
  const paso = pasoBonito((max - min) / Math.max(1, n - 1));
  const a = Math.floor(min / paso + 1e-9) * paso, b = Math.ceil(max / paso - 1e-9) * paso;
  const out = [];
  for (let v = a, i = 0; v <= b + paso * 1e-6 && i < 100; i++, v = a + i * paso) out.push(+v.toFixed(10));
  return out;
}

const textoMarca = (v, paso) => {
  const d = paso > 0 ? Math.max(0, -Math.floor(Math.log10(paso) + 1e-9)) : 0;
  return v.toFixed(Math.min(d, 6)).replace(/^-(?=0(\.0+)?$)/, '').replace(/^-/, '−');
};

const texto = (x, y, t, extra = '') => `<text x="${r1(x)}" y="${r1(y)}"${extra}>${esc(t)}</text>`;
const figura = (svg, titulo, pie, clase) => `<figure class="grafico ${clase}"><svg ${svg.dims} role="img" aria-label="${esc(titulo)}" font-size="${FUENTE}" fill="${COLORES.tinta}">${svg.cuerpo}</svg><figcaption>${esc(pie)}</figcaption></figure>`;
const titulo = (t, ancho) => texto(ancho / 2, 18, t, ` text-anchor="middle" font-weight="700" font-size="14"`);

// Leyenda en una o varias filas; items = [{ nombre, muestra(x, y) → svg }].
function leyenda(items, x0, y0, ancho) {
  let x = x0, y = y0, out = '';
  for (const it of items) {
    const w = 28 + 6.6 * String(it.nombre).length + 18;
    if (x + w > x0 + ancho && x > x0) { x = x0; y += 18; }
    out += `${it.muestra(x, y)}${texto(x + 26, y + 4, it.nombre)}`;
    x += w;
  }
  return { svg: `<g class="leyenda">${out}</g>`, alto: y - y0 + 18 };
}
const muestraLinea = (k) => (x, y) => `<line x1="${x}" y1="${y}" x2="${x + 20}" y2="${y}" stroke="${SERIES[k % SERIES.length]}" stroke-width="2.5"${TRAZOS[k % TRAZOS.length] ? ` stroke-dasharray="${TRAZOS[k % TRAZOS.length]}"` : ''}/>`;
const muestraCaja = (fill, trazo = COLORES.tinta, dash = '') => (x, y) => `<rect class="m" x="${x + 4}" y="${y - 6}" width="12" height="12" fill="${fill}" stroke="${trazo}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;

function ejes({ X, Y, mx, my, ax, ay, rx, ry, izq, arriba, ancho, alto, cx, cy }) {
  const pasoX = mx.length > 1 ? mx[1] - mx[0] : 1, pasoY = my.length > 1 ? my[1] - my[0] : 1;
  let s = `<g class="ejes" stroke="${COLORES.tinta}">`;
  for (const v of my) s += `<line x1="${izq}" x2="${izq + ancho}" y1="${r1(Y(v))}" y2="${r1(Y(v))}" stroke-opacity=".14"/>`;
  for (const v of mx) s += `<line y1="${arriba}" y2="${arriba + alto}" x1="${r1(X(v))}" x2="${r1(X(v))}" stroke-opacity=".14"/>`;
  s += `<rect x="${izq}" y="${arriba}" width="${ancho}" height="${alto}" fill="none"/></g><g class="marcas">`;
  for (const v of my) s += texto(izq - 6, Y(v) + 4, ay ? ay(v) : textoMarca(v, pasoY), ' text-anchor="end"');
  for (const v of mx) s += texto(X(v), arriba + alto + 16, ax ? ax(v) : textoMarca(v, pasoX), ' text-anchor="middle"');
  s += '</g>';
  s += texto(izq + ancho / 2, arriba + alto + 36, rx, ' text-anchor="middle" class="rotulo-x"');
  s += texto(cx, cy, ry, ` text-anchor="middle" class="rotulo-y" transform="rotate(-90 ${r1(cx)} ${r1(cy)})"`);
  return s;
}

// (1) Líneas. series = [{ nombre, puntos: [[x, y]] }]; x/y = { rotulo, min?, max?, marcas?, texto?(v) }.
export function graficoLineas({ titulo: tit, series, x, y, pie, ancho: W = 680, alto: H = 300 }) {
  const izq = 64, der = 18;
  const ley = leyenda(series.map((s, k) => ({ nombre: s.nombre, muestra: muestraLinea(k) })), izq, 38, W - izq - der);
  const arriba = 30 + ley.alto + 8, abajo = 48, alto = H - arriba - abajo, ancho = W - izq - der;
  const ys = series.flatMap((s) => s.puntos.map((p) => p[1])).filter(fin);
  const mx = x.marcas ?? marcas(x.min, x.max, 7);
  const my = y.marcas ?? marcas(fin(y.min) ? y.min : Math.min(...ys), fin(y.max) ? y.max : Math.max(...ys), 6);
  const x0 = fin(x.min) ? x.min : mx[0], x1 = fin(x.max) ? x.max : mx.at(-1);
  const y0 = my[0] ?? 0, y1 = my.at(-1) ?? 1;
  const X = (v) => izq + ((v - x0) / (x1 - x0 || 1)) * ancho, Y = (v) => arriba + alto - ((v - y0) / (y1 - y0 || 1)) * alto;
  let cuerpo = titulo(tit, W) + ley.svg + ejes({ X, Y, mx, my: ys.length ? my : [], ax: x.texto, ay: y.texto, rx: x.rotulo, ry: y.rotulo, izq, arriba, ancho, alto, cx: 16, cy: arriba + alto / 2 });
  if (!ys.length) cuerpo += texto(izq + ancho / 2, arriba + alto / 2, 'no data', ' text-anchor="middle" font-weight="700"');
  series.forEach((s, k) => {
    const color = SERIES[k % SERIES.length], dash = TRAZOS[k % TRAZOS.length];
    let d = '', abierto = false, aislados = 0, puntos = '';
    const p = s.puntos;
    p.forEach(([px, py], i) => {
      if (!fin(px) || !fin(py)) { abierto = false; return; }
      d += `${abierto ? 'L' : 'M'}${r1(X(px))} ${r1(Y(py))}`;
      const solo = !(i > 0 && fin(p[i - 1][1]) && fin(p[i - 1][0])) && !(i < p.length - 1 && fin(p[i + 1][1]) && fin(p[i + 1][0]));
      if (solo) aislados++;
      puntos += `<circle cx="${r1(X(px))}" cy="${r1(Y(py))}" r="${solo ? 3.5 : 2}" fill="${color}"/>`;
      abierto = true;
    });
    if (!d) return;
    cuerpo += `<g class="s${k}" data-aislados="${aislados}"><path class="serie" fill="none" stroke="${color}" stroke-width="2"${dash ? ` stroke-dasharray="${dash}"` : ''} d="${d}"/>${puntos}</g>`;
  });
  return figura({ dims: `width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"`, cuerpo }, tit, pie, 'lineas');
}

// (2) Tira por pasos del día: filas = [{ rotulo, celdas: ['sol'|'sombra'|'noche'|null], extra? }]; x = { rotulo, etiquetas?: [paso] }.
const CELDA = { sol: COLORES.amarillo, sombra: COLORES.celeste, noche: COLORES.tinta };
export function graficoTira({ titulo: tit, filas, x, pie, ancho: W = 800 }) {
  const izq = 262, cw = 18, ch = 16, gap = 5, n = Math.max(1, ...filas.map((f) => f.celdas.length));
  const ley = leyenda([
    { nombre: 'sunlit', muestra: muestraCaja(CELDA.sol) }, { nombre: 'terrain shadow', muestra: muestraCaja(CELDA.sombra) },
    { nombre: 'night', muestra: muestraCaja(CELDA.noche) }, { nombre: 'no data', muestra: muestraCaja(COLORES.blanco, COLORES.tinta, '2 2') },
  ], 16, 38, W - 32);
  const arriba = 30 + ley.alto + 6;
  const H = arriba + filas.length * (ch + gap) + 44;
  let cuerpo = titulo(tit, W) + ley.svg;
  filas.forEach((f, j) => {
    const yy = arriba + j * (ch + gap);
    const rot = String(f.rotulo);
    cuerpo += texto(izq - 8, yy + ch - 4, rot.length > 40 ? `${rot.slice(0, 39)}…` : rot, ' text-anchor="end"');
    f.celdas.forEach((c, k) => {
      const cl = CELDA[c] ? c : 'nd';
      cuerpo += `<rect class="c ${cl}" x="${izq + k * cw}" y="${yy}" width="${cw - 1}" height="${ch}" fill="${CELDA[c] ?? COLORES.blanco}" stroke="${COLORES.tinta}" stroke-width="${cl === 'nd' ? 0.8 : 0.4}"${cl === 'nd' ? ' stroke-dasharray="2 2"' : ''}/>`;
    });
    if (f.extra) cuerpo += texto(izq + n * cw + 8, yy + ch - 4, f.extra);
  });
  const yb = arriba + filas.length * (ch + gap);
  for (const k of x.etiquetas ?? [0, n]) cuerpo += texto(izq + k * cw, yb + 12, String(k), ' text-anchor="middle"');
  cuerpo += texto(izq + (n * cw) / 2, yb + 32, x.rotulo, ' text-anchor="middle" class="rotulo-x"');
  return figura({ dims: `width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"`, cuerpo }, tit, pie, 'tira');
}

// (3) Barras horizontales: filas = [{ rotulo, valor (null = sin dato), texto? }]; x = { rotulo, min, max }.
export function graficoBarras({ titulo: tit, filas, x, pie, ancho: W = 680 }) {
  const izq = 230, der = 70, fh = 20, gap = 6, arriba = 34, ancho = W - izq - der;
  const H = arriba + filas.length * (fh + gap) + 50;
  const x0 = x.min ?? 0, x1 = x.max ?? 100, X = (v) => izq + ((v - x0) / (x1 - x0)) * ancho;
  let cuerpo = titulo(tit, W);
  const mx = marcas(x0, x1, 6), alto = filas.length * (fh + gap);
  cuerpo += `<g class="ejes" stroke="${COLORES.tinta}">${mx.map((v) => `<line x1="${r1(X(v))}" x2="${r1(X(v))}" y1="${arriba}" y2="${arriba + alto}" stroke-opacity=".14"/>`).join('')}<line x1="${izq}" x2="${izq}" y1="${arriba}" y2="${arriba + alto}"/></g>`;
  filas.forEach((f, j) => {
    const yy = arriba + j * (fh + gap);
    const rot = String(f.rotulo);
    cuerpo += texto(izq - 8, yy + fh - 6, rot.length > 34 ? `${rot.slice(0, 33)}…` : rot, ' text-anchor="end"');
    if (fin(f.valor)) {
      const v = Math.min(x1, Math.max(x0, f.valor));
      cuerpo += `<rect class="barra" x="${izq}" y="${yy}" width="${r1(X(v) - izq)}" height="${fh}" fill="${COLORES.acento}"/>`;
      cuerpo += texto(X(v) + 6, yy + fh - 6, f.texto ?? textoMarca(f.valor, 0.1), ' font-weight="700"');
    } else cuerpo += texto(izq + 6, yy + fh - 6, 'no data', ' font-style="italic"');
  });
  cuerpo += mx.map((v) => texto(X(v), arriba + alto + 14, textoMarca(v, mx[1] - mx[0]), ' text-anchor="middle"')).join('');
  cuerpo += texto(izq + ancho / 2, arriba + alto + 34, x.rotulo, ' text-anchor="middle" class="rotulo-x"');
  return figura({ dims: `width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"`, cuerpo }, tit, pie, 'barras');
}

// (4) Histograma con las mismas clases para todas las series: bordes (último puede ser Infinity), valores por clase (%).
export function graficoHistograma({ titulo: tit, bordes, series, x, y, pie, ancho: W = 680, alto: H = 300 }) {
  const izq = 64, der = 18;
  const ley = leyenda(series.map((s, k) => ({ nombre: s.nombre, muestra: muestraCaja(SERIES[k % SERIES.length], COLORES.tinta) })), izq, 38, W - izq - der);
  const arriba = 30 + ley.alto + 8, abajo = 48, alto = H - arriba - abajo, ancho = W - izq - der;
  const nb = bordes.length - 1, vals = series.flatMap((s) => s.valores).filter(fin);
  const my = marcas(0, Math.max(1, ...vals), 6), y1 = my.at(-1);
  const Y = (v) => arriba + alto - (v / y1) * alto, gw = ancho / nb, bw = (gw * 0.82) / Math.max(1, series.length);
  let cuerpo = titulo(tit, W) + ley.svg;
  cuerpo += `<g class="ejes" stroke="${COLORES.tinta}">${my.map((v) => `<line x1="${izq}" x2="${izq + ancho}" y1="${r1(Y(v))}" y2="${r1(Y(v))}" stroke-opacity=".14"/>`).join('')}<rect x="${izq}" y="${arriba}" width="${ancho}" height="${alto}" fill="none"/></g>`;
  cuerpo += my.map((v) => texto(izq - 6, Y(v) + 4, textoMarca(v, my[1] - my[0]), ' text-anchor="end"')).join('');
  series.forEach((s, k) => s.valores.forEach((v, b) => {
    if (!fin(v) || b >= nb) return;
    cuerpo += `<rect class="barra s${k}" x="${r1(izq + b * gw + gw * 0.09 + k * bw)}" y="${r1(Y(v))}" width="${r1(bw)}" height="${r1(Math.max(0, arriba + alto - Y(v)))}" fill="${SERIES[k % SERIES.length]}"/>`;
  }));
  const cada = Math.ceil(nb / 11);
  for (let b = 0; b < nb; b++) {
    if (!fin(bordes[b + 1])) { cuerpo += texto(izq + (b + 0.5) * gw, arriba + alto + 16, `≥${bordes[b]}`, ' text-anchor="middle"'); continue; }
    if (b % cada === 0) cuerpo += texto(izq + b * gw, arriba + alto + 16, String(bordes[b]), ' text-anchor="middle"');
  }
  if (fin(bordes[nb]) && nb % cada === 0) cuerpo += texto(izq + ancho, arriba + alto + 16, String(bordes[nb]), ' text-anchor="middle"');
  cuerpo += texto(izq + ancho / 2, arriba + alto + 36, x.rotulo, ' text-anchor="middle" class="rotulo-x"');
  cuerpo += texto(16, arriba + alto / 2, y.rotulo, ` text-anchor="middle" class="rotulo-y" transform="rotate(-90 16 ${r1(arriba + alto / 2)})"`);
  return figura({ dims: `width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"`, cuerpo }, tit, pie, 'histograma');
}

// (5) Plano de la base: piezas = [{ num, este_m, sur_m, rompe }] respecto al centro; norteArriba = la rejilla tiene el norte arriba.
export function graficoPlano({ titulo: tit, radio_m: R, piezas, norteArriba, pie, lado: L = 420 }) {
  const izq = 70, arriba = 52, W = izq + L + 24, H = arriba + L + 56;
  const E = R * 1.15, s = L / (2 * E), cx = izq + L / 2, cy = arriba + L / 2;
  const X = (v) => cx + v * s, Y = (v) => cy + v * s;
  const m = marcas(-E, E, 7).filter((v) => Math.abs(v) <= E + 1e-9);
  let cuerpo = titulo(tit, W);
  cuerpo += texto(W / 2, 36, norteArriba ? 'north up · east to the right' : 'map grid, north not up', ' text-anchor="middle" font-style="italic"');
  cuerpo += `<g class="ejes" stroke="${COLORES.tinta}">${m.map((v) => `<line x1="${r1(X(v))}" x2="${r1(X(v))}" y1="${arriba}" y2="${arriba + L}" stroke-opacity=".12"/><line y1="${r1(Y(v))}" y2="${r1(Y(v))}" x1="${izq}" x2="${izq + L}" stroke-opacity=".12"/>`).join('')}<rect x="${izq}" y="${arriba}" width="${L}" height="${L}" fill="none"/></g>`;
  const paso = m.length > 1 ? m[1] - m[0] : 1;
  cuerpo += m.map((v) => texto(X(v), arriba + L + 15, textoMarca(v, paso), ' text-anchor="middle"') + texto(izq - 6, Y(v) + 4, textoMarca(v, paso), ' text-anchor="end"')).join('');
  const rx = norteArriba ? 'East of the centre (m)' : 'Grid right of the centre (m)', ry = norteArriba ? 'South of the centre (m)' : 'Grid down from the centre (m)';
  cuerpo += texto(cx, arriba + L + 34, rx, ' text-anchor="middle" class="rotulo-x"');
  cuerpo += texto(18, cy, ry, ` text-anchor="middle" class="rotulo-y" transform="rotate(-90 18 ${r1(cy)})"`);
  cuerpo += `<circle class="anillo" cx="${r1(cx)}" cy="${r1(cy)}" r="${r1(R * s)}" fill="none" stroke="${COLORES.acento}" stroke-width="1.5" stroke-dasharray="6 4"/>`;
  cuerpo += `<path d="M${r1(cx - 6)} ${r1(cy)}H${r1(cx + 6)}M${r1(cx)} ${r1(cy - 6)}V${r1(cy + 6)}" stroke="${COLORES.tinta}" stroke-width="1.5"/>`;
  if (norteArriba) {
    const nx = izq + L - 22, ny = arriba + 14;
    cuerpo += `<g class="norte"><path d="M${nx} ${ny + 34}V${ny + 6}M${nx - 6} ${ny + 14}L${nx} ${ny + 4}L${nx + 6} ${ny + 14}" fill="none" stroke="${COLORES.tinta}" stroke-width="2"/>${texto(nx, ny + 50, 'N', ' text-anchor="middle" font-weight="700"')}</g>`;
  }
  const bruto = R / 2, mag = 10 ** Math.floor(Math.log10(bruto)), largo = [5, 2, 1].map((k) => k * mag).find((v) => v <= bruto) ?? mag;
  const bx = izq + 14, by = arriba + L - 16;
  cuerpo += `<g class="escala"><path d="M${bx} ${by - 5}V${by}H${r1(bx + largo * s)}V${by - 5}" fill="none" stroke="${COLORES.tinta}" stroke-width="2"/>${texto(bx + (largo * s) / 2, by - 8, largo >= 1000 ? `${largo / 1000} km` : `${largo} m`, ' text-anchor="middle"')}</g>`;
  for (const p of piezas) {
    if (!fin(p.este_m) || !fin(p.sur_m)) continue;
    cuerpo += `<g class="pieza${p.rompe ? ' rompe' : ''}" transform="translate(${r1(X(p.este_m))} ${r1(Y(p.sur_m))})"><circle r="8.5" fill="${COLORES.blanco}" stroke="${p.rompe ? COLORES.rojo : COLORES.acento}" stroke-width="${p.rompe ? 3 : 1.6}"/>${texto(0, 3.5, String(p.num ?? '•'), ' text-anchor="middle" font-size="10" font-weight="700"')}</g>`;
  }
  return figura({ dims: `width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"`, cuerpo }, tit, pie, 'plano');
}
