// Flor de datos (reglas de J-flor-percepcion.md): valor = longitud radial, anchura fija, sin contorno que una pétalos,
// anillos 0,5 y 1, número junto a cada pétalo, «n/d» rayado, «se rompe» en rojo y partido.
// Corte de «se rompe»: umbrales.json → agregacion.etiquetas.se_rompe (s < 0,4); no viaja en capas.json.
export const ROMPE = 0.4;

const R0 = 10, R1 = 92, ANCHO_DEG = 32, HUECO_DEG = 5, ETIQ = 112;
const rad = (g) => (g * Math.PI) / 180;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const radio = (v) => R0 + (R1 - R0) * Math.min(1, Math.max(0, v));
const pt = (r, g) => `${(r * Math.cos(rad(g))).toFixed(2)} ${(r * Math.sin(rad(g))).toFixed(2)}`;

function sector(ri, re, g0, g1) {
  const big = g1 - g0 > 180 ? 1 : 0;
  return `M${pt(ri, g0)} L${pt(re, g0)} A${re} ${re} 0 ${big} 1 ${pt(re, g1)} L${pt(ri, g1)} A${ri} ${ri} 0 ${big} 0 ${pt(ri, g0)} Z`;
}
const arco = (r, g0, g1) => `M${pt(r, g0)} A${r} ${r} 0 0 1 ${pt(r, g1)}`;

export function estadoPetalo(p) {
  if (p.estado !== 'valor') return p.estado === 'na' ? 'na' : 'nd';
  return p.v < ROMPE ? 'rompe' : 'ok';
}

// petalos: [{id, nombre, estado: 'valor'|'sin_dato'|'na', v, p5?, p95?}] en el orden en que se dibujan.
export function florSVG(petalos) {
  const n = petalos.length, partes = [];
  partes.push('<defs><pattern id="rayado-nd" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="5" class="raya"/></pattern></defs>');
  partes.push(`<circle class="anillo" r="${radio(0.5)}"/><circle class="anillo" r="${radio(1)}"/><circle class="anillo cubo" r="${R0}"/>`);
  petalos.forEach((p, i) => {
    const g = -90 + (i * 360) / n, g0 = g - ANCHO_DEG / 2, g1 = g + ANCHO_DEG / 2;
    const e = estadoPetalo(p);
    let cuerpo;
    if (e === 'nd' || e === 'na') {
      cuerpo = `<path class="fantasma" d="${sector(R0, radio(1), g0, g1)}"/>`;
    } else {
      const r = radio(p.v);
      const banda = Number.isFinite(p.p5) && Number.isFinite(p.p95)
        ? `<path class="banda" d="${sector(radio(p.p5), Math.max(radio(p.p95), radio(p.p5) + 0.5), g - ANCHO_DEG / 6, g + ANCHO_DEG / 6)}"/>` : '';
      if (e === 'rompe') {
        cuerpo = `<path class="relleno" d="${sector(R0, Math.max(r, R0 + 0.5), g0, g - HUECO_DEG / 2)}"/><path class="relleno" d="${sector(R0, Math.max(r, R0 + 0.5), g + HUECO_DEG / 2, g1)}"/>${banda}`
          + `<path class="valor" d="${arco(r, g0, g - HUECO_DEG / 2)}"/><path class="valor" d="${arco(r, g + HUECO_DEG / 2, g1)}"/>`;
      } else {
        cuerpo = `<path class="relleno" d="${sector(R0, Math.max(r, R0 + 0.5), g0, g1)}"/>${banda}<path class="valor" d="${arco(r, g0, g1)}"/>`;
      }
    }
    const cx = ETIQ * Math.cos(rad(g)), cy = ETIQ * Math.sin(rad(g));
    const ancla = Math.abs(cx) < 8 ? 'middle' : cx > 0 ? 'start' : 'end';
    const num = e === 'nd' ? 'n/d' : e === 'na' ? 'n/a' : p.v.toFixed(2);
    const intervalo = e === 'ok' || e === 'rompe' ? (Number.isFinite(p.p5) && Number.isFinite(p.p95) ? ` [${p.p5.toFixed(2)}–${p.p95.toFixed(2)}]` : '') : '';
    partes.push(`<g class="petalo ${e}" data-dim="${esc(p.id)}"><title>${esc(p.id)} ${esc(p.nombre)}: ${num}${intervalo}${e === 'rompe' ? ' — breaks' : ''}</title>${cuerpo}`
      + `<text x="${cx.toFixed(1)}" y="${cy.toFixed(1)}" text-anchor="${ancla}" dominant-baseline="middle"><tspan class="id">${esc(p.id)}</tspan> <tspan class="num">${num}${intervalo}</tspan></text></g>`);
  });
  return `<svg class="flor" viewBox="-165 -130 330 260" role="img" aria-label="data flower">${partes.join('')}</svg>`;
}
