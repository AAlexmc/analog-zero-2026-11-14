// Lectura de informe_validacion.json y validacion_sombras.json. Nada se escribe a mano: lo que falta sale como null.
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);

export function resumenValidacion(inf) {
  if (!inf || typeof inf !== 'object') return null;
  const h1 = inf.h1 ?? {}, h1s = inf.h1_s ?? {}, h3 = inf.h3 ?? {};
  return {
    h1: { k: num(h1.k), n: num(h1.n_sitios), k0: num(h1.k0), veredicto: typeof h1.veredicto === 'string' ? h1.veredicto : null },
    h1s: { k: num(h1s.n_dentro), n: num(h1s.n_sitios), noEval: num(h1s.n_no_evaluables) },
    h3: { aciertos: num(h3.aciertos), de: num(h3.de) },
    sha: typeof inf.umbrales_sha256 === 'string' ? inf.umbrales_sha256 : null,
    fecha: inf.generado ?? inf.fecha ?? null,
    polar: inf.descriptivo_polar ?? null,
    ejemplo: inf.ejemplo === true,
  };
}

// Primero el terreno de rol «primary».
export function resumenSombras(v) {
  const t = v?.terrenos;
  if (!t || typeof t !== 'object') return [];
  return Object.entries(t)
    .map(([id, x]) => ({ id, rol: x.rol ?? '', lado_km: num(x.lado_km), pearson: num(x.metricas?.iluminacion?.pearson), iou: num(x.metricas?.sombra_permanente?.iou) }))
    .filter((x) => x.pearson !== null)
    .sort((a, b) => (b.rol.startsWith('primary') ? 1 : 0) - (a.rol.startsWith('primary') ? 1 : 0));
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Volcado legible del JSON tal cual, para «how this was validated».
export function jsonAHtml(x, nivel = 0) {
  if (x === null || x === undefined) return '<span class="tenue">null</span>';
  if (Array.isArray(x)) {
    if (!x.length) return '<span class="tenue">[]</span>';
    if (x.every((v) => v === null || typeof v !== 'object')) return `<span class="num">${x.map((v) => esc(v)).join(', ')}</span>`;
    return `<ol class="json">${x.map((v) => `<li>${jsonAHtml(v, nivel + 1)}</li>`).join('')}</ol>`;
  }
  if (typeof x === 'object') {
    return `<dl class="json">${Object.entries(x).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${jsonAHtml(v, nivel + 1)}</dd>`).join('')}</dl>`;
  }
  return `<span class="num">${esc(x)}</span>`;
}
