import { decodificarPNG, byteDe } from './png.js';
import { latLonDeCelda, celdaDeLatLon, celdaDePosicion, posicionDeLatLon, valorByte, leerPuertas, estadoCelda, cercanos, segmentosCosta } from './rejilla.js';
import { objetivosDe, capasDePar, dimensionesConPeso, colorear, mascaraTierra, rampaCSS, colorCategoria, estadosLeyenda, COLOR } from './capas.js';
import { florSVG, ROMPE } from './flor.js';
import { leerURL, escribirURL, enlaceTerreno } from './estado.js';
import { resumenValidacion, resumenSombras, jsonAHtml } from './validacion.js';
import { leerCond, escribirCond, opcionesRequisito, seleccion, canalDe, valorCondicion, colorearCond, lineaResumen, fmtValor, filasHoja } from './condiciones.js';

const URL0 = leerURL(location.search);
const URLC = leerCond(location.search);
const EJEMPLO = URL0.ejemplo;
const RAIZ = EJEMPLO ? 'data/global_ejemplo' : 'data/global';
const PAR_INICIAL = 'shackleton_P3';
const N_MARCAS = 20;
const KM_GRADO_ECUADOR = 40075.017 / 360;
const NOTA_NO_PRERREG = 'added after the NASA briefing — not part of the pre-registered validation';

const estado = {
  listo: false, errores: [], manifiesto: null, rejilla: null, par: null, capa: 'S', capas: [], imgs: new Map(), candidatos: null,
  lugares: [], terrenos: [], lunares: [], lunaCond: null, informe: null, hoja: null, aviso: null, vista: null, leyenda: null, modo: 'ranking', cond: null,
};
const COLOR_CONTORNO = 'rgb(230, 159, 0)';
window.__mapa = estado;

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtLat = (v) => (Number.isFinite(v) ? `${Math.abs(v).toFixed(2)}° ${v < 0 ? 'S' : 'N'}` : '—');
const fmtLon = (v) => (Number.isFinite(v) ? `${Math.abs(v).toFixed(2)}° ${v < 0 ? 'W' : 'E'}` : '—');
const urlSegura = (u) => (/^https?:\/\//i.test(u ?? '') ? u : null);
const decimales = (canal) => Math.min(4, Math.max(0, Math.ceil(-Math.log10(canal?.scale || 1))));
const fmtNum = (v, canal) => (Number.isFinite(v) ? v.toFixed(decimales(canal)) : '—');
const nombreCapa = (c) => (c.grupo === 'dimension' ? `${c.id} ${estado.manifiesto.dimensiones?.[c.id] ?? ''}` : c.meta.nombre ?? c.id);
const ROTULO_S = { S: 'S', S_p5: 'S p5', S_p95: 'S p95' };
const conUnidad = (canal) => canal?.unidad && canal.unidad !== '0-1' && canal.unidad !== '1';

function textoValor(x, canal) {
  if (x.tipo === 'sin_dato') return 'no data';
  if (x.tipo === 'na') return 'n/a';
  if (x.tipo === 'clase') { const n = estado.manifiesto.litologia_clases?.[x.codigo]; return n ? `${n} (class ${x.codigo})` : `class ${x.codigo}`; }
  return `${fmtNum(x.v, canal)}${conUnidad(canal) ? ` ${canal.unidad}` : ''}`;
}

async function pedirJSON(url) {
  let r;
  try { r = await fetch(url, { cache: 'no-cache' }); } catch { return null; }
  if (!r.ok) return null;
  try { return await r.json(); } catch { throw new Error(`${url} is broken (not valid JSON)`); }
}

function imagen(fichero) {
  if (!estado.imgs.has(fichero)) {
    const p = fetch(`${RAIZ}/${fichero}`, { cache: 'no-cache' })
      .then((r) => { if (!r.ok) throw new Error(`${fichero}: HTTP ${r.status}`); return r.arrayBuffer(); })
      .then(decodificarPNG)
      .then((img) => {
        const r = estado.rejilla;
        if (img.ancho !== r.ancho || img.alto !== r.alto) throw new Error(`${fichero} is ${img.ancho}×${img.alto}, expected ${r.ancho}×${r.alto}`);
        return img;
      });
    estado.imgs.set(fichero, p);
  }
  return estado.imgs.get(fichero);
}

// ---------- Vista ----------
const lienzo = $('lienzo'), cv = $('mapa'), ctx = cv.getContext('2d');
const capaOff = document.createElement('canvas');
let costa = null, ajuste = 1;

function ajustarTam() {
  const r = lienzo.getBoundingClientRect(), dpr = devicePixelRatio || 1;
  cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
  if (!estado.rejilla) return;
  const { ancho, alto } = estado.rejilla;
  const prev = estado.vista, prevAjuste = ajuste;
  ajuste = Math.min(r.width / ancho, r.height / alto);
  if (!prev || prev.esc <= prevAjuste * 1.0001) estado.vista = { esc: ajuste, ox: (r.width - ancho * ajuste) / 2, oy: Math.min(44, (r.height - alto * ajuste) / 2) };
  limitarVista();
  dibujar();
}

function limitarVista() {
  const v = estado.vista, r = lienzo.getBoundingClientRect(), { ancho, alto } = estado.rejilla;
  v.esc = Math.min(ajuste * 48, Math.max(ajuste, v.esc));
  const w = ancho * v.esc, h = alto * v.esc;
  v.ox = w <= r.width ? (r.width - w) / 2 : Math.min(0, Math.max(r.width - w, v.ox));
  v.oy = h <= r.height ? Math.min(44, (r.height - h) / 2) : Math.min(0, Math.max(r.height - h, v.oy));
}

function zoomEn(f, sx, sy) {
  const v = estado.vista, e0 = v.esc;
  v.esc = Math.min(ajuste * 48, Math.max(ajuste, e0 * f));
  v.ox = sx - ((sx - v.ox) * v.esc) / e0;
  v.oy = sy - ((sy - v.oy) * v.esc) / e0;
  limitarVista();
  dibujar();
}

function celdaEn(sx, sy) {
  const v = estado.vista;
  return celdaDePosicion(estado.rejilla, (sx - v.ox) / v.esc, (sy - v.oy) / v.esc);
}

estado.aPantalla = (fila, col) => {
  const v = estado.vista, r = cv.getBoundingClientRect();
  return { x: r.left + v.ox + (col + 0.5) * v.esc, y: r.top + v.oy + (fila + 0.5) * v.esc };
};

function dibujar() {
  const dpr = devicePixelRatio || 1;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#021226';
  ctx.fillRect(0, 0, cv.width, cv.height);
  const v = estado.vista;
  if (!v || !estado.leyenda) return;
  const { ancho, alto, paso } = estado.rejilla;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(capaOff, v.ox, v.oy, ancho * v.esc, alto * v.esc);
  ctx.save();
  ctx.translate(v.ox, v.oy);
  ctx.scale(v.esc, v.esc);
  ctx.lineWidth = 1 / v.esc;
  ctx.strokeStyle = 'rgba(233, 240, 245, .12)';
  ctx.beginPath();
  for (let lon = -150; lon < 180; lon += 30) { const x = (lon + 180) / paso; ctx.moveTo(x, 0); ctx.lineTo(x, alto); }
  for (let lat = -60; lat <= 60; lat += 30) { const y = (90 - lat) / paso; ctx.moveTo(0, y); ctx.lineTo(ancho, y); }
  ctx.stroke();
  ctx.strokeStyle = 'rgba(233, 240, 245, .75)';
  if (costa) ctx.stroke(costa);
  if (estado.modo === 'cond' && estado.cond?.contorno) {
    ctx.lineWidth = 2 / v.esc;
    ctx.strokeStyle = COLOR_CONTORNO;
    ctx.stroke(estado.cond.contorno);
  }
  if (estado.hoja) {
    ctx.lineWidth = 2 / v.esc;
    ctx.strokeStyle = '#e9f0f5';
    const m = Math.max(0.15, 3 / v.esc);
    ctx.strokeRect(estado.hoja.col - m, estado.hoja.fila - m, 1 + 2 * m, 1 + 2 * m);
  }
  ctx.restore();
  dibujarMarcas();
}

const aPx = (lat, lon) => {
  const p = posicionDeLatLon(estado.rejilla, lat, lon), v = estado.vista;
  return [v.ox + p.x * v.esc, v.oy + p.y * v.esc];
};

function rotulo(x, y, txt) {
  ctx.font = '10px "DejaVu Sans Mono", monospace';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(2, 18, 38, .9)';
  ctx.strokeText(txt, x, y);
  ctx.fillStyle = '#e9f0f5';
  ctx.fillText(txt, x, y);
}

function dibujarMarcas() {
  ctx.lineWidth = 1.5;
  for (const s of estado.lugares) {
    const [x, y] = aPx(s.lat, s.lon);
    ctx.strokeStyle = '#e9f0f5'; ctx.fillStyle = 'rgba(2, 18, 38, .6)';
    ctx.fillRect(x - 4, y - 4, 8, 8); ctx.strokeRect(x - 4, y - 4, 8, 8);
  }
  const top = estado.modo === 'cond' ? [] : (estado.candidatos ?? []).slice(0, N_MARCAS);
  top.slice(1).forEach((c) => {
    const [x, y] = aPx(c.lat, c.lon);
    ctx.beginPath(); ctx.arc(x, y, 4, 0, 2 * Math.PI);
    ctx.strokeStyle = '#e9f0f5'; ctx.lineWidth = 1.5; ctx.stroke();
  });
  for (const t of estado.terrenos) {
    const [x, y] = aPx(t.lat, t.lon);
    ctx.save(); ctx.translate(x, y); ctx.rotate(Math.PI / 4);
    ctx.fillStyle = '#e9f0f5'; ctx.fillRect(-5, -5, 10, 10);
    ctx.strokeStyle = '#021226'; ctx.lineWidth = 1.5; ctx.strokeRect(-5, -5, 10, 10);
    ctx.restore();
    rotulo(x + 10, y + 4, `3D ${t.id.toUpperCase()}`);
  }
  if (top[0]) {
    const [x, y] = aPx(top[0].lat, top[0].lon);
    ctx.beginPath(); ctx.arc(x, y, 8, 0, 2 * Math.PI);
    ctx.strokeStyle = '#021226'; ctx.lineWidth = 5; ctx.stroke();
    ctx.strokeStyle = '#e9f0f5'; ctx.lineWidth = 2.5; ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y, 2.5, 0, 2 * Math.PI); ctx.fillStyle = '#e9f0f5'; ctx.fill();
    rotulo(x + 12, y + 4, 'BEST #1');
  }
}

// ---------- Capa activa ----------
async function repintarCapa() {
  const par = estado.par;
  const capa = estado.capas.find((c) => c.id === estado.capa);
  const [img, imgS, imgC] = await Promise.all([imagen(capa.fichero), imagen(par.ficheros.s), imagen(par.ficheros.c)]);
  const res = colorear(capa, img, imgS, imgC);
  capaOff.width = img.ancho; capaOff.height = img.alto;
  capaOff.getContext('2d').putImageData(new ImageData(res.rgba, img.ancho, img.alto), 0, 0);
  estado.leyenda = { capa: capa.id, ...res, rgba: undefined };
  pintarLeyenda(capa, res);
  dibujar();
  lectura(ultimaCelda);
}

function muestra(color, ajedrez) {
  const c = Array.isArray(color[0]) ? color : [color, color];
  return `<span class="muestra" style="background: repeating-linear-gradient(45deg, rgb(${c[0].join(',')}) 0 3px, rgb(${c[1].join(',')}) 3px 6px)"></span>`;
}

function pintarLeyenda(capa, res) {
  const par = estado.par, m = capa.meta, partes = [];
  const unidad = conUnidad(m) ? ` (${m.unidad})` : m.unidad === '0-1' ? ' (0–1)' : '';
  partes.push(`<div class="et">${esc(capa.grupo === 'puntuacion' ? `${ROTULO_S[capa.id] ?? capa.id} · ${m.nombre ?? 'similarity score'}` : nombreCapa(capa))}${esc(res.clases.length ? '' : unidad)}</div>`);
  if (res.clases.length) {
    partes.push(`<div class="clases">${res.clases.map((k) => `<span>${muestra(colorCategoria(k))}${esc(estado.manifiesto.litologia_clases?.[k] ?? `class ${k}`)}</span>`).join('')}</div>`);
  } else {
    const [a, b] = res.dominio;
    partes.push(`<div class="bar" style="background:${rampaCSS()}"></div><div class="ext num"><span>${fmtNum(a, m)}</span><span>${fmtNum(b, m)}</span></div>`);
  }
  const filas = estadosLeyenda(capa, res.cuenta, par);
  for (const f of filas) {
    const val = Number.isFinite(f.nValidacion) ? ` <span class="tenue">(<span class="num">${f.nValidacion}</span>)</span>` : '';
    partes.push(`<div data-v="${f.id}">${muestra(f.color)}${esc(f.texto)} · <span class="num">${f.n}</span> cells${val}</div>`);
  }
  if (filas.some((f) => Number.isFinite(f.nValidacion))) partes.push('<div class="tenue">(in brackets: cells in the validation set, which leaves out land south of 60° S except McMurdo)</div>');
  partes.push(`<div class="simbolos"><span><i class="sim mejor"></i>best candidate</span><span><i class="sim cand"></i>top ${N_MARCAS} candidates</span>`
    + `<span><i class="sim sitio"></i>known test site</span><span><i class="sim t3d"></i>3D terrain</span><span><i class="sim costa"></i>coast (from data mask)</span></div>`);
  $('leyenda').innerHTML = partes.join('');
}

// ---------- Modo «test conditions» ----------
const enlace = (u, txt) => (urlSegura(u) ? `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(txt ?? u.replace(/^https?:\/\//, ''))}</a>` : esc(u ?? 'no source'));
const limiteTxt = (r) => (r.valor === null || r.valor === undefined ? 'not public' : `${r.op} ${r.valor} ${r.unidad ?? ''}`.trim());

function pintarSelectorCond() {
  const c = estado.cond, o = opcionesRequisito(c.man, c.eq.id);
  $('cond-eq').innerHTML = c.man.equipos.map((e) => `<option value="${esc(e.id)}"${e.id === c.eq.id ? ' selected' : ''}>${esc(e.nombre)}</option>`).join('');
  const opt = (x, dis = false) => `<option value="${esc(x.valor)}"${x.valor === c.clave ? ' selected' : ''}${dis ? ' disabled' : ''}>${esc(x.texto)}${x.nota ? ` — ${esc(x.nota)}` : ''}</option>`;
  $('cond-req').innerHTML = (o.evaluables.length ? `<optgroup label="Design limits of this equipment">${o.evaluables.map((x) => opt(x)).join('')}</optgroup>` : '')
    + (o.otros.length ? `<optgroup label="Not mapped here">${o.otros.map((x) => opt(x, true)).join('')}</optgroup>` : '')
    + `<optgroup label="Lunar environment (no equipment limit)">${o.entorno.map((x) => opt(x)).join('')}</optgroup>`;
  $('cond-acc').value = Number.isFinite(c.acc) ? String(c.acc) : '';
}

async function repintarCond() {
  const c = estado.cond, sel = seleccion(c.man, c.eqId, c.clave);
  Object.assign(c, { eq: sel.eq, eqId: sel.eq.id, req: sel.req, clave: sel.clave, canal: sel.canal });
  const res = colorearCond({ man: c.man, canal: c.canal, imgs: c.imgs, req: c.req, acc: c.acc });
  const { ancho, alto } = estado.rejilla;
  capaOff.width = ancho; capaOff.height = alto;
  capaOff.getContext('2d').putImageData(new ImageData(res.rgba, ancho, alto), 0, 0);
  let contorno = null;
  if (res.alcanza.some((x) => x)) {
    contorno = new Path2D();
    for (const [x0, y0, x1, y1] of segmentosCosta(res.alcanza, ancho, alto)) { contorno.moveTo(x0, y0); contorno.lineTo(x1, y1); }
  }
  c.contorno = contorno;
  estado.leyenda = { capa: `cond:${c.eq.id}:${c.clave}`, dominio: res.dominio, cuenta: res.cuenta };
  pintarSelectorCond();
  pintarLeyendaCond(res);
  $('cond-resumen').textContent = c.req ? lineaResumen(c.req) : (c.man.entorno ?? []).find((e) => e.condicion === c.canal)?.texto ?? 'Environment layer — no equipment limit selected';
  dibujar();
  lectura(ultimaCelda);
}

function pintarLeyendaCond(res) {
  const c = estado.cond, k = canalDe(c.man, c.canal), m = k.meta, r = c.req, partes = [];
  partes.push(`<div class="et">${esc(m.nombre ?? m.id)} (${esc(m.unidad)})${res.log ? ' · log scale' : ''}</div>`);
  const [a, b] = res.dominio;
  partes.push(`<div class="bar" style="background:${rampaCSS()}"></div><div class="ext num"><span>${res.log ? `≤ ${res.logMin}` : esc(fmtValor(a, ''))}</span><span>${esc(fmtValor(b, ''))}</span></div>`);
  if (r) {
    partes.push(`<div>Limit: <b>${esc(r.prueba)}</b> · catalog: ${esc(r.texto ?? '')}</div><div class="cita">“${esc(r.cita)}” — ${enlace(r.fuente)}</div>`);
    if (r.veredicto_global === 'reaches') partes.push(`<div><i class="sim contorno"></i>edge of the land that reaches the limit</div>`);
    else partes.push(`<div class="v-rompe">not reachable on Earth — chamber only</div>`);
  }
  partes.push(`<div class="cita">${esc(m.metodo ?? '')} ${enlace(m.fuente)}${m.origen === 'mío' ? ' <span class="sello-propio">own computation</span>' : ''}</div>`);
  if (Number.isFinite(c.acc)) {
    partes.push(`<div>${muestra(COLOR.falla)}more than ${esc(c.acc)} h from a city <span class="sello-propio">own threshold</span> · <span class="num">${res.cuenta.lejos}</span> cells</div>`);
    if (res.cuenta.sin_acceso) partes.push(`<div>${muestra(COLOR.sinDato)}no travel-time data · <span class="num">${res.cuenta.sin_acceso}</span> cells</div>`);
  }
  if (res.cuenta.sin_dato) partes.push(`<div>${muestra(COLOR.sinDato)}no data · <span class="num">${res.cuenta.sin_dato}</span> cells</div>`);
  partes.push(`<div class="simbolos"><span><i class="sim sitio"></i>known test site</span><span><i class="sim t3d"></i>3D terrain</span><span><i class="sim costa"></i>coast (from data mask)</span></div>`);
  $('leyenda').innerHTML = partes.join('');
}

function puenteTerreno(terrenos, objetivo, nombreObjetivo) {
  if (!terrenos.length) return '<span class="tenue" data-v="sin-terreno">no 3D terrain generated for this cell yet</span>';
  return terrenos.map((t) => {
    const e = enlaceTerreno(t.id, objetivo, estado.lunares);
    const txt = e.solo ? `Open this Earth terrain alone — no 3D terrain of ${nombreObjetivo ?? objetivo ?? 'this base site'}` : 'Open terrain and plant equipment';
    return `<a class="boton abrir-terreno" href="${esc(e.href)}">${esc(txt)}</a> <span class="tenue">${esc(t.nombre)}</span>`;
  }).join('<br>');
}

async function abrirHojaCond(fila, col) {
  const c = estado.cond, r = estado.rejilla, t = canalDe(c.man, 'oscuridad_max_h');
  if (byteDe(c.imgs[t.fichero], fila, col, t.indice) === 255) return false;
  const { lat, lon } = latLonDeCelda(r, fila, col);
  const lugar = cercanos(r, { fila, col }, [...estado.lugares, ...estado.terrenos])[0];
  const terrenos = cercanos(r, { fila, col }, estado.terrenos);
  const filas = filasHoja(c.man, c.eq, fila, col, c.imgs);
  estado.hoja = { fila, col, lat, lon, modo: 'cond', eq: c.eq.id, nombre: lugar?.nombre ?? null, terrenos: terrenos.map((x) => x.id),
    filas: filas.map((f) => ({ indice: f.req.indice, variable: f.req.variable, valor: f.valor, veredicto: f.veredicto, texto: f.texto })) };
  const visor = terrenos.length ? enlaceTerreno(terrenos[0].id, estado.lunaCond, estado.lunares).href : 'terreno/index.html';
  const html = filas.map((f) => {
    const q = f.req;
    const aqui = q.tratamiento === 'condicion' ? fmtValor(f.valor, c.man.condiciones?.[q.condicion]?.unidad ?? '') : '—';
    const ver = f.veredicto === 'terreno' ? `<a href="${esc(visor)}">${esc(f.texto)}</a>` : esc(f.texto);
    const motivo = f.veredicto === 'no_evaluado' && q.motivo ? `<div class="cita">${esc(q.motivo)}</div>` : '';
    let sub = '';
    if (f.rompe) {
      const labs = q.laboratorios ?? [];
      sub = `<div class="sub">${esc(q.camara ?? 'chamber only')}${labs.length ? ': ' : ''}${labs.map((l) => `${esc(l.nombre)} — “${esc(l.cita)}” ${enlace(l.fuente, 'source')}`).join('; ')}</div>`;
    }
    return `<div class="req-cond" data-indice="${esc(q.indice)}"><div class="ver${f.rompe ? ' v-rompe' : ''}" data-v="veredicto">${ver}</div>${motivo}`
      + `<div>${esc(q.texto ?? q.variable)}</div>`
      + `<div><span class="tenue">limit</span> <span class="num">${esc(limiteTxt(q))}</span> · <span class="tenue">here</span> <span class="num">${esc(aqui)}</span></div>`
      + `<div class="cita">“${esc(q.cita)}” ${enlace(q.fuente, 'source')}</div>${sub}</div>`;
  }).join('');
  const entorno = ['oscuridad_max_h', 'sol_rasante_h_ano', 't_min_alcanzable_k', 'tiempo_ciudad_h'].map((id) => {
    const k = canalDe(c.man, id);
    return k ? `<tr><td>${esc(k.meta.nombre)}</td><td class="num">${esc(fmtValor(valorCondicion(c.man, id, fila, col, c.imgs), k.meta.unidad))}</td><td>${enlace(k.meta.fuente)}</td></tr>` : '';
  }).join('');
  $('hoja').innerHTML = `
    <div class="cab-hoja"><div><div class="et">TEST CONDITIONS · ${esc(c.eq.nombre)}</div>
      <h3>${esc(lugar?.nombre ?? 'Unnamed cell')}</h3></div><button type="button" data-a="cerrar" title="Close (Esc)">×</button></div>
    <div class="lugar num">${fmtLat(lat)} ${fmtLon(lon)} · row ${fila} col ${col}</div>
    <div class="tenue">${esc(c.man.rotulo ?? '')}</div>
    <div class="bloque"><div class="et">DESIGN LIMITS VS THIS PLACE</div>${filas.length
      ? `<div class="cond">${html}</div>`
      : '<div class="tenue" data-v="sin-requisitos">no design limits in the catalog for this equipment</div>'}</div>
    <details class="bloque tabla" open><summary class="et">CONDITIONS IN THIS CELL</summary><table class="comp"><tbody>${entorno}</tbody></table></details>
    <div class="bloque puente"><div class="et">PLANT EQUIPMENT HERE</div>${puenteTerreno(terrenos, estado.lunaCond)}</div>`;
  $('hoja').querySelector('[data-a=cerrar]').addEventListener('click', cerrarHoja);
  $('aviso').hidden = true;
  estado.aviso = null;
  dibujar();
  actualizarURL();
  return true;
}

async function activarModo(m) {
  if (m === 'cond' && !estado.cond) return;
  estado.modo = m;
  document.querySelectorAll('#modos [data-modo]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.modo === m)));
  $('mandos-ranking').hidden = m === 'cond';
  $('mandos-cond').hidden = m !== 'cond';
  $('nota-cond').hidden = m !== 'cond';
  $('nota-par').hidden = m === 'cond' || estado.par?.prerregistrado !== false;
  ajustarTam();
  if (m === 'cond') await repintarCond(); else await repintarCapa();
  if (estado.hoja && !(m === 'cond' ? await abrirHojaCond(estado.hoja.fila, estado.hoja.col) : await abrirHoja(estado.hoja.fila, estado.hoja.col))) estado.hoja = null;
  if (!estado.hoja) pintarHojaVacia();
  actualizarURL();
}

// ---------- Selector ----------
function pintarSelector() {
  const objetivos = objetivosDe(estado.manifiesto), par = estado.par;
  $('objetivo').innerHTML = objetivos.map((o) => `<option value="${esc(o.id)}"${o.id === par.objetivo ? ' selected' : ''}>${esc(o.nombre)}</option>`).join('');
  const o = objetivos.find((x) => x.id === par.objetivo);
  $('misiones').innerHTML = o.pares.map((p) => `<button type="button" data-par="${esc(p.id)}" aria-pressed="${p.id === par.id}"${p.prerregistrado === false ? ` title="${esc(NOTA_NO_PRERREG)}"` : ''}>`
    + `${esc(p.mision)} ${esc(p.nombre_mision ?? '')}${p.prerregistrado === false ? ' <span class="sello-propio">post-briefing</span>' : ''}</button>`).join('');
  $('nota-par').hidden = par.prerregistrado !== false;
  const grupos = [['puntuacion', 'Score'], ['dimension', 'Dimensions (weight in this mission)'], ['variable', 'Raw variables']];
  $('capa').innerHTML = grupos.map(([g, t]) => `<optgroup label="${esc(t)}">${estado.capas.filter((c) => c.grupo === g).map((c) => {
    const txt = c.grupo === 'puntuacion' ? `${ROTULO_S[c.id] ?? c.id}${c.meta.nombre ? ` · ${c.meta.nombre}` : ''}` : c.grupo === 'dimension' ? `${nombreCapa(c)} · w ${c.peso}` : `${nombreCapa(c)}${conUnidad(c.meta) ? ` (${c.meta.unidad})` : ''}`;
    return `<option value="${esc(c.id)}"${c.id === estado.capa ? ' selected' : ''}>${esc(txt)}</option>`;
  }).join('')}</optgroup>`).join('');
  for (const [k, id] of [['csv', 'desc-csv'], ['geojson', 'desc-geojson']]) {
    const a = $(id), f = par.candidatos?.[k];
    if (f && estado.candidatos) { a.href = `${RAIZ}/${f}`; a.setAttribute('download', f); a.removeAttribute('aria-disabled'); }
    else { a.removeAttribute('href'); a.setAttribute('aria-disabled', 'true'); }
  }
  pintarValidacion();
}

let turnoPar = 0;
async function cambiarPar(id, capaPreferida) {
  const turno = ++turnoPar;
  const par = estado.manifiesto.pares.find((p) => p.id === id);
  await Promise.all([imagen(par.ficheros.s), imagen(par.ficheros.c), ...par.ficheros.dim.map(imagen)]);
  const candidatos = await cargarCandidatos(par);
  if (turno !== turnoPar) return;
  estado.par = par;
  estado.capas = capasDePar(estado.manifiesto, par);
  estado.capa = estado.capas.some((c) => c.id === capaPreferida) ? capaPreferida : estado.capas.some((c) => c.id === estado.capa) ? estado.capa : 'S';
  estado.candidatos = candidatos;
  pintarSelector();
  await repintarCapa();
  if (estado.hoja) abrirHoja(estado.hoja.fila, estado.hoja.col);
  else pintarHojaVacia();
  actualizarURL();
}

async function cargarCandidatos(par) {
  const g = par.candidatos?.geojson ? await pedirJSON(`${RAIZ}/${par.candidatos.geojson}`).catch((e) => { estado.errores.push(e.message); return null; }) : null;
  if (!g?.features) return null;
  return g.features.map((f) => ({ ...f.properties, lat: f.properties.lat ?? f.geometry.coordinates[1], lon: f.properties.lon ?? f.geometry.coordinates[0] }))
    .sort((a, b) => a.puesto - b.puesto);
}

function actualizarURL() {
  const h = estado.hoja ? latLonDeCelda(estado.rejilla, estado.hoja.fila, estado.hoja.col) : null;
  const c = estado.cond;
  history.replaceState(null, '', location.pathname + escribirCond(escribirURL({ ejemplo: EJEMPLO, par: estado.par?.id, capa: estado.capa, lat: h?.lat ?? null, lon: h?.lon ?? null }),
    { modo: estado.modo, eq: c?.eqId, req: c?.clave, acc: c?.acc }));
}

// ---------- Validación ----------
function pintarValidacion() {
  const r = resumenValidacion(estado.informe), par = estado.par;
  const b = (x) => `<b class="num">${x ?? '—'}</b>`;
  const frac = Number.isFinite(par?.fraccion_tierra_pasa_puertas) ? `${b((par.fraccion_tierra_pasa_puertas * 100).toFixed(1))} % of land passes this mission's gates` : '';
  let linea;
  if (!r) linea = `<span class="et">VALIDATION</span> <span>validation pending</span>${frac ? ` · ${frac}` : ''}`;
  else {
    const fallo = r.h1.veredicto === 'fallo';
    const ver = r.h1.veredicto ? `<span data-v="veredicto" class="${fallo ? 'v-rompe' : ''}">pre-registered test ${fallo ? 'FAILED — read this ranking as exploratory' : esc(r.h1.veredicto)}</span> · ` : '';
    linea = `<span class="et">VALIDATION</span> ${ver}<span data-v="h1">recovers ${b(r.h1.k)} of ${b(r.h1.n)} known analogs; baseline k₀ ${b(r.h1.k0)}</span>`
      + ` · <span data-v="h1s">H1-S ${b(r.h1s.k)} of ${b(r.h1s.n)}${r.h1s.noEval ? ` (${b(r.h1s.noEval)} not evaluable)` : ''}</span> · <span data-v="h3">H3 ${b(r.h3.aciertos)} of ${b(r.h3.de)} sign predictions</span>`
      + `${frac ? ` · <span data-v="frac">${frac}</span>` : ''} · <button type="button" class="ver-detalle" aria-expanded="${!$('val-detalle').hidden}">how this was validated</button>`;
  }
  const sombras = resumenSombras(estado.sombras);
  const ls = sombras.length
    ? `<span class="et">SHADOWS</span> viewer shadow model vs official LOLA mean illumination: ${sombras.map((s) => `Pearson ${b(s.pearson.toFixed(3))} (${esc(s.id)}, ${esc(s.lado_km)} km)`).join(' · ')} · <a href="terreno/index.html">terrain viewer</a>`
    : '<span class="et">SHADOWS</span> shadow validation not found';
  $('val-linea').innerHTML = linea;
  $('val-sombras').innerHTML = ls;
  const det = $('val-detalle');
  if (r) {
    const polar = r.polar ? `<h4>Polar descriptive <span class="sello-propio">not pre-registered</span></h4>${jsonAHtml(r.polar)}` : '';
    det.innerHTML = `<div class="tenue">Read from <code>${esc(RAIZ)}/informe_validacion.json</code>${r.fecha ? ` · run ${esc(r.fecha)}` : ''}</div>`
      + `<div>umbrales_sha256 <code class="num" data-v="sha">${esc(r.sha ?? '—')}</code></div>${polar}<h4>Full report</h4>${jsonAHtml(estado.informe)}`;
  }
}

// ---------- Hoja ----------
function pintarHojaVacia() {
  if (estado.modo === 'cond') {
    $('hoja').innerHTML = `<div class="et">PLACE SHEET · TEST CONDITIONS</div><p>Click any land cell to compare it with every design limit of <b>${esc(estado.cond.eq.nombre)}</b>.</p>`
      + `<p class="tenue">${esc(estado.cond.man.rotulo ?? '')}</p>`;
    return;
  }
  const c = estado.candidatos?.[0];
  $('hoja').innerHTML = `<div class="et">PLACE SHEET</div><p>Click any land cell to open its sheet.</p>`
    + (c ? `<p class="tenue">Best candidate for this mission: <span class="num">${fmtLat(c.lat)} ${fmtLon(c.lon)}</span>, S <span class="num">${esc(c.S)}</span>.</p><button type="button" data-a="abrir-mejor">Open best candidate</button>` : '');
  const bt = $('hoja').querySelector('[data-a=abrir-mejor]');
  if (bt) bt.addEventListener('click', () => { const k = celdaDeLatLon(estado.rejilla, c.lat, c.lon); abrirHoja(k.fila, k.col); });
}

async function abrirHoja(fila, col) {
  const par = estado.par, m = estado.manifiesto, r = estado.rejilla;
  const [S, C, ...dims] = await Promise.all([imagen(par.ficheros.s), imagen(par.ficheros.c), ...par.ficheros.dim.map(imagen)]);
  const varsF = Object.keys(m.canales).filter((k) => /^var_/.test(k)).sort();
  const vars = await Promise.all(varsF.map((f) => imagen(f).catch(() => null)));
  const sR = byteDe(S, fila, col, 0), cG = byteDe(C, fila, col, 1);
  const est = estadoCelda(sR, cG);
  if (est === 'oceano') return false;
  const { lat, lon } = latLonDeCelda(r, fila, col);
  const canS = m.canales[par.ficheros.s] ?? [], canC = m.canales[par.ficheros.c] ?? [];
  const leer = (img, k, canal) => valorByte(byteDe(img, fila, col, k), canal);
  const sV = leer(S, 0, canS[0]), p5 = leer(S, 1, canS[1]), p95 = leer(S, 2, canS[2]), cob = leer(C, 0, canC[0]);
  const lugar = cercanos(r, { fila, col }, [...estado.lugares, ...estado.terrenos])[0];
  const terrenos = cercanos(r, { fila, col }, estado.terrenos);
  const cand = (estado.candidatos ?? []).find((c) => { const k = celdaDeLatLon(r, c.lat, c.lon); return k && k.fila === fila && k.col === col; });
  const puertas = leerPuertas(cG, par.puertas);
  estado.hoja = { fila, col, lat, lon, estado: est, sByte: sR, S: est === 'evaluable' && sV.tipo === 'valor' ? sV.v : null, puesto: cand?.puesto ?? null, nombre: lugar?.nombre ?? null, terrenos: terrenos.map((t) => t.id) };

  let situacion;
  if (est === 'evaluable') situacion = cand ? `Rank <b class="num">#${cand.puesto}</b> of the ${estado.candidatos.length} listed candidates` : `Evaluable · not among the ${estado.candidatos?.length ?? '—'} listed candidates`;
  else if (est === 'falla_puerta') situacion = `<b>Fails a gate</b> — no rank: ${puertas.filter((p) => p.estado === 'falla').map((p) => esc(p.texto ?? p.id)).join('; ')}`;
  else {
    const sd = puertas.filter((p) => p.estado === 'sin_dato');
    situacion = `<b>Not evaluable</b> — no rank: ${sd.length ? `no data for gate ${sd.map((p) => esc(p.texto ?? p.id)).join('; ')}` : `data coverage too low to rank this place (C ${esc(textoValor(cob, canC[0]))})`}`;
  }
  const sTxt = est === 'evaluable' ? `<span class="num grande" data-v="S">${esc(textoValor(sV, canS[0]))}</span> <span class="tenue">p5–p95</span> <span class="num">${esc(textoValor(p5, canS[1]))}–${esc(textoValor(p95, canS[2]))}</span>`
    : '<span class="num grande">—</span> <span class="tenue">not scored</span>';

  const ids = dimensionesConPeso(par);
  const capasDim = estado.capas.filter((c) => c.grupo === 'dimension');
  const petalos = ids.map((d) => {
    const capa = capasDim.find((c) => c.id === d);
    if (!capa) return { id: d, nombre: m.dimensiones?.[d] ?? d, estado: 'sin_dato' };
    const x = valorByte(byteDe(dims[par.ficheros.dim.indexOf(capa.fichero)], fila, col, capa.canal), capa.meta);
    return { id: d, nombre: m.dimensiones?.[d] ?? d, estado: x.tipo === 'valor' ? 'valor' : x.tipo, v: x.v };
  });

  const filas = [];
  const fila_ = (nom, val, extra = '') => filas.push(`<tr><td>${nom}</td><td class="num">${val}</td><td>${extra}</td></tr>`);
  canS.forEach((c, k) => { if (!c.vacio) fila_(esc(ROTULO_S[c.id] ?? c.id), est === 'evaluable' ? esc(textoValor(leer(S, k, c), c)) : '—', esc(c.nombre ?? '')); });
  canC.forEach((c, k) => { if (!c.vacio && k !== 1) fila_(esc(c.id), esc(textoValor(leer(C, k, c), c)), esc(c.nombre ?? '')); });
  for (const p of petalos) fila_(`${esc(p.id)} ${esc(p.nombre)}`, p.estado === 'valor' ? p.v.toFixed(3) : p.estado === 'na' ? 'n/a' : 'no data', `weight ${esc(par.pesos[p.id])}`);
  varsF.forEach((f, j) => (m.canales[f] ?? []).forEach((c, k) => {
    if (c.vacio) return;
    const u = urlSegura(c.fuente);
    const fuente = u ? `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(u.replace(/^https?:\/\//, ''))}</a>` : esc(c.fuente ?? 'no source in manifest');
    fila_(esc(c.nombre ?? c.id), vars[j] ? esc(textoValor(leer(vars[j], k, c), c)) : 'not loaded', fuente);
  }));

  const ESTADO_P = { pasa: 'passes', falla: 'FAILS', sin_dato: 'NO DATA' };
  const puente = puenteTerreno(terrenos, par.objetivo, par.nombre_objetivo);
  const cerca = cand?.sitio_cercano && !lugar ? `<div class="tenue">near ${esc(cand.sitio_cercano)} (candidate list)</div>` : '';

  $('hoja').innerHTML = `
    <div class="cab-hoja"><div><div class="et">${esc(par.nombre_objetivo)} · ${esc(par.mision)} ${esc(par.nombre_mision ?? '')}</div>
      <h3>${esc(lugar?.nombre ?? 'Unnamed cell')}</h3></div><button type="button" data-a="cerrar" title="Close (Esc)">×</button></div>
    <div class="lugar num">${fmtLat(lat)} ${fmtLon(lon)} · row ${fila} col ${col}</div>
    <div class="tenue">cell ${esc(r.paso)}° (~${Math.floor(r.paso * KM_GRADO_ECUADOR)} km at the equator)${lugar ? ` · known place within 1 cell` : ''}</div>${cerca}
    <div class="situacion">${situacion}</div>
    <div class="cifras"><div><span class="et">S</span>${sTxt}</div><div><span class="et">COVERAGE C</span><span class="num" data-v="C">${esc(textoValor(cob, canC[0]))}</span></div></div>
    <div class="bloque"><div class="et">SIMILARITY BY DIMENSION</div>${petalos.length ? florSVG(petalos) : '<div class="tenue">no weighted dimensions in this mission</div>'}
      <div class="nota-flor">Petal length = similarity of that dimension (centre 0, outer ring 1; inner ring 0.5). <span class="v-rompe">Red split petal</span> = breaks (s &lt; ${ROMPE}). Hatched = no data. Only S carries a p5–p95 interval in the export.</div></div>
    <div class="bloque"><div class="et">GATES</div>${puertas.map((p) => `<div class="puerta ${p.estado}"><span class="est">${ESTADO_P[p.estado]}</span> ${esc(p.texto ?? p.id)}</div>`).join('') || '<div class="tenue">no gates in manifest</div>'}</div>
    <details class="bloque tabla"><summary class="et">ALL VALUES IN THIS CELL</summary><table class="comp"><thead><tr><th>Variable</th><th>Here</th><th>Unit note / source</th></tr></thead><tbody>${filas.join('')}</tbody></table></details>
    <div class="bloque puente"><div class="et">PLANT EQUIPMENT HERE</div>${puente}</div>`;
  $('hoja').querySelector('[data-a=cerrar]').addEventListener('click', cerrarHoja);
  $('aviso').hidden = true;
  estado.aviso = null;
  dibujar();
  actualizarURL();
  return true;
}

function cerrarHoja() {
  estado.hoja = null;
  pintarHojaVacia();
  dibujar();
  actualizarURL();
}

let temporizadorAviso = null;
function avisar(texto, sx, sy) {
  const a = $('aviso');
  a.textContent = texto;
  a.style.left = `${sx + 12}px`; a.style.top = `${sy + 12}px`;
  a.hidden = false;
  estado.aviso = texto;
  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(() => { a.hidden = true; estado.aviso = null; }, 1800);
}

// ---------- Lectura bajo el cursor ----------
const imgSinc = (f) => estado.imgsListas?.get(f);
let ultimaCelda = null;
function lectura(celda) {
  ultimaCelda = celda;
  const set = (k, t) => { lienzo.ownerDocument.querySelector(`#lectura [data-k=${k}]`).textContent = t; };
  if (!celda) { set('lat', '—'); set('lon', '—'); set('celda', '—'); set('valor', '—'); return; }
  const { lat, lon } = latLonDeCelda(estado.rejilla, celda.fila, celda.col);
  set('lat', fmtLat(lat)); set('lon', fmtLon(lon)); set('celda', `${celda.fila}, ${celda.col}`);
  if (estado.modo === 'cond') {
    const c = estado.cond, k = canalDe(c.man, c.canal), t = canalDe(c.man, 'oscuridad_max_h');
    const oc = byteDe(c.imgs[t.fichero], celda.fila, celda.col, t.indice) === 255;
    set('valor', `${c.canal} ${oc ? 'ocean' : fmtValor(valorCondicion(c.man, c.canal, celda.fila, celda.col, c.imgs), k.meta.unidad)}`);
    return;
  }
  const par = estado.par, capa = estado.capas.find((c) => c.id === estado.capa);
  const S = imgSinc(par.ficheros.s), C = imgSinc(par.ficheros.c), img = imgSinc(capa.fichero);
  if (!S || !C || !img) { set('valor', '…'); return; }
  const est = estadoCelda(byteDe(S, celda.fila, celda.col, 0), byteDe(C, celda.fila, celda.col, 1));
  let t;
  if (est === 'oceano') t = 'ocean';
  else if (capa.grupo === 'puntuacion' && est === 'falla_puerta') t = 'fails a gate';
  else if (capa.grupo === 'puntuacion' && est === 'no_evaluable') t = 'not evaluable';
  else t = textoValor(valorByte(byteDe(img, celda.fila, celda.col, capa.canal), capa.meta), capa.meta);
  set('valor', `${capa.grupo === 'puntuacion' ? ROTULO_S[capa.id] ?? capa.id : capa.id} ${t}`);
}

// ---------- Eventos ----------
let arrastre = null;
cv.addEventListener('pointerdown', (e) => {
  if (!estado.vista || e.button !== 0) return;
  arrastre = { x: e.clientX, y: e.clientY, ox: estado.vista.ox, oy: estado.vista.oy, movido: false };
  cv.setPointerCapture(e.pointerId);
});
cv.addEventListener('pointermove', (e) => {
  if (!estado.vista) return;
  const r = cv.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top;
  if (arrastre) {
    const dx = e.clientX - arrastre.x, dy = e.clientY - arrastre.y;
    if (Math.hypot(dx, dy) > 4) arrastre.movido = true;
    if (arrastre.movido) { estado.vista.ox = arrastre.ox + dx; estado.vista.oy = arrastre.oy + dy; limitarVista(); dibujar(); }
  }
  lectura(celdaEn(sx, sy));
});
cv.addEventListener('pointerleave', () => lectura(null));
cv.addEventListener('pointerup', async (e) => {
  const a = arrastre;
  arrastre = null;
  if (!a || a.movido || !estado.par) return;
  const r = cv.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top;
  const k = celdaEn(sx, sy);
  if (!k) return;
  const abierta = estado.modo === 'cond' ? await abrirHojaCond(k.fila, k.col) : await abrirHoja(k.fila, k.col);
  if (!abierta) avisar('Ocean — no land data in this cell', sx, sy);
});
cv.addEventListener('wheel', (e) => {
  if (!estado.vista) return;
  e.preventDefault();
  const r = cv.getBoundingClientRect();
  zoomEn(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
}, { passive: false });
document.querySelectorAll('[data-zoom]').forEach((b) => b.addEventListener('click', () => {
  if (!estado.vista) return;
  const r = lienzo.getBoundingClientRect();
  if (b.dataset.zoom === 'ajustar') { estado.vista.esc = ajuste; limitarVista(); dibujar(); return; }
  zoomEn(b.dataset.zoom === 'mas' ? 1.6 : 1 / 1.6, r.width / 2, r.height / 2);
}));
addEventListener('keydown', (e) => { if (e.key === 'Escape' && estado.hoja) cerrarHoja(); });
$('objetivo').addEventListener('change', (e) => {
  const o = objetivosDe(estado.manifiesto).find((x) => x.id === e.target.value);
  if (o) cambiarPar(o.pares[0].id).catch(fallo);
});
$('misiones').addEventListener('click', (e) => {
  const b = e.target.closest('[data-par]');
  if (b && b.dataset.par !== estado.par.id) cambiarPar(b.dataset.par).catch(fallo);
});
$('capa').addEventListener('change', (e) => { estado.capa = e.target.value; repintarCapa().then(actualizarURL).catch(fallo); });
$('modos').addEventListener('click', (e) => {
  const b = e.target.closest('[data-modo]');
  if (b && !b.disabled && b.dataset.modo !== estado.modo) activarModo(b.dataset.modo).catch(fallo);
});
const trasCambioCond = () => repintarCond().then(() => (estado.hoja ? abrirHojaCond(estado.hoja.fila, estado.hoja.col) : pintarHojaVacia())).then(actualizarURL).catch(fallo);
$('cond-eq').addEventListener('change', (e) => { Object.assign(estado.cond, { eqId: e.target.value, clave: null }); trasCambioCond(); });
$('cond-req').addEventListener('change', (e) => { estado.cond.clave = e.target.value; trasCambioCond(); });
$('cond-acc').addEventListener('change', (e) => {
  const v = e.target.value.trim() === '' ? NaN : Number(e.target.value);
  estado.cond.acc = Number.isFinite(v) && v >= 0 ? v : null;
  trasCambioCond();
});
$('validacion').addEventListener('click', (e) => {
  if (!e.target.closest('.ver-detalle')) return;
  const d = $('val-detalle');
  d.hidden = !d.hidden;
  e.target.setAttribute('aria-expanded', String(!d.hidden));
});
new ResizeObserver(ajustarTam).observe(lienzo);

function fallo(e) {
  estado.errores.push(e.message ?? String(e));
  const d = document.createElement('div');
  d.className = 'error';
  d.innerHTML = `<b>${esc(e.message ?? e)}</b>`;
  lienzo.appendChild(d);
}

// ---------- Arranque ----------
async function iniciar() {
  const seguro = (p) => p.catch((e) => { estado.errores.push(e.message); return null; });
  const [man, sitios, indice, sombras, informe, cond] = await Promise.all([
    seguro(pedirJSON(`${RAIZ}/capas.json`)), seguro(pedirJSON('data/sitios_ensayo.json')), seguro(pedirJSON('data/terreno/index.json')),
    seguro(pedirJSON('data/validacion_sombras.json')), seguro(pedirJSON(`${RAIZ}/informe_validacion.json`)), seguro(pedirJSON(`${RAIZ}/condiciones.json`)),
  ]);
  estado.sombras = sombras;
  estado.informe = informe;
  if (EJEMPLO || man?.ejemplo === true || informe?.ejemplo === true) $('banda-sintetico').hidden = false;
  estado.lugares = (sitios?.sitios ?? []).filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon)).map((s) => ({ id: s.id, nombre: s.nombre, lat: s.lat, lon: s.lon }));
  const metas = await Promise.all((indice?.terrenos ?? []).filter((t) => t.cuerpo === 'tierra').map((t) => seguro(pedirJSON(`data/terreno/${encodeURIComponent(t.id)}/meta.json`))));
  estado.lunares = (indice?.terrenos ?? []).filter((t) => t.cuerpo === 'luna').map((t) => t.id);
  estado.lunaCond = indice?.pareja_inicial?.luna ?? null;
  estado.terrenos = metas.filter((x) => x && Number.isFinite(x.centro?.lat) && Number.isFinite(x.centro?.lon)).map((x) => ({ id: x.id, nombre: x.nombre, lat: x.centro.lat, lon: x.centro.lon }));
  if (!man?.pares?.length || !man.rejilla) {
    $('val-linea').innerHTML = '';
    pintarValidacion();
    document.body.dataset.sinDatos = '';
    lienzo.insertAdjacentHTML('beforeend', `<div class="error"><b>global layers not found</b><span class="pista">${EJEMPLO ? 'run node scripts/ejemplo_global.mjs' : 'expected in web/data/global/ · add ?ejemplo=1 for a synthetic example'}</span></div>`);
    $('hoja').innerHTML = '';
    $('modo-nota').textContent = cond ? 'test conditions need the global layers' : 'test conditions not generated';
    estado.errores.push('global layers not found');
    estado.listo = true;
    return;
  }
  estado.manifiesto = man;
  estado.rejilla = man.rejilla;
  // Copia síncrona de las imágenes ya decodificadas, para leer bajo el cursor.
  estado.imgsListas = new Map();
  const varsF = Object.keys(man.canales).filter((k) => /^var_/.test(k));
  const par0 = man.pares.find((p) => p.id === URL0.par) ?? man.pares.find((p) => p.id === PAR_INICIAL) ?? man.pares[0];
  const todos = [...new Set([...man.pares.flatMap((p) => [p.ficheros.s, p.ficheros.c, ...p.ficheros.dim]), ...varsF])];
  await Promise.all(todos.map((f) => imagen(f).then((img) => estado.imgsListas.set(f, img)).catch((e) => { estado.errores.push(e.message); })));
  const C = estado.imgsListas.get(par0.ficheros.c);
  if (C) {
    const p = new Path2D();
    for (const [x0, y0, x1, y1] of segmentosCosta(mascaraTierra(C), C.ancho, C.alto)) { p.moveTo(x0, y0); p.lineTo(x1, y1); }
    costa = p;
  }
  await iniciarCond(cond);
  ajustarTam();
  await cambiarPar(par0.id, URL0.capa);
  if (estado.cond && URLC.modo === 'cond') await activarModo('cond');
  if (Number.isFinite(URL0.lat) && Number.isFinite(URL0.lon)) {
    const k = celdaDeLatLon(estado.rejilla, URL0.lat, URL0.lon);
    if (k) await (estado.modo === 'cond' ? abrirHojaCond(k.fila, k.col) : abrirHoja(k.fila, k.col));
  }
  estado.listo = true;
}

// Sin condiciones.json (o con PNG rotos) el modo queda deshabilitado y lo dice.
async function iniciarCond(cm) {
  const r = estado.rejilla;
  const ok = cm?.equipos?.length && cm.canales && cm.rejilla?.ancho === r.ancho && cm.rejilla?.alto === r.alto && canalDe(cm, 'oscuridad_max_h');
  let imgs = null;
  if (ok) {
    try {
      const fs = Object.keys(cm.canales);
      imgs = Object.fromEntries(await Promise.all(fs.map(async (f) => [f, await imagen(f)])));
    } catch (e) { estado.errores.push(e.message); imgs = null; }
  }
  if (!imgs) { $('modo-nota').textContent = 'test conditions not generated'; return; }
  const sel = seleccion(cm, URLC.eq, URLC.req);
  estado.cond = { man: cm, imgs, eqId: sel.eq.id, eq: sel.eq, clave: sel.clave, canal: sel.canal, req: sel.req, acc: URLC.acc, contorno: null };
  const b = document.querySelector('#modos [data-modo=cond]');
  b.disabled = false;
  b.title = cm.rotulo ?? '';
}

iniciar().catch((e) => { fallo(e); estado.listo = true; });
