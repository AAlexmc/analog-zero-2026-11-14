// Equipo de una misión (web/data/equipo_mision.json) en el visor: forma a tamaño publicado, modelo sustituto y límites. Sin DOM.
export const PREFIJO = 'mision:';
export const ROTULO = { caja: 'box at the published size, not the real shape', domo: 'dome at the published diameter, not the real shape' };
const A_METROS = { m: 1, cm: 0.01, mm: 0.001, ft: 0.3048, in: 0.0254 };
const ETIQUETA = { largo: 'length', ancho: 'width', alto: 'height', diametro: 'diameter' };
const PARAMETRO = { pendiente_grados: 'Slope', viento_p95_m_s: 'Wind (95th percentile)', viento_medio_m_s: 'Mean wind', t_min_k: 'Temperature', t_max_k: 'Temperature' };

export function equiposDeMision(catalogo, mision) {
  const m = Array.isArray(catalogo?.misiones) ? catalogo.misiones.find((x) => x?.mision === mision) : null;
  return Array.isArray(m?.equipos) ? m.equipos.filter((e) => typeof e?.id === 'string' && e.id) : [];
}

function citada(dims, k) {
  const d = dims?.[k], f = A_METROS[d?.unidad];
  return Number.isFinite(d?.valor) && d.valor > 0 && f && /^https?:\/\//.test(d.fuente ?? '') ? { ...d, k, etiqueta: ETIQUETA[k], m: d.valor * f } : null;
}

// caja = largo × ancho × alto citados; domo = hábitat con diámetro (o largo = ancho): sin alto, media esfera (supuesto, se dice).
export function formaPublicada(eq) {
  const c = Object.fromEntries(['largo', 'ancho', 'alto', 'diametro'].map((k) => [k, citada(eq?.dimensiones, k)]));
  if (eq?.tipo === 'habitat') {
    const iguales = c.largo && c.ancho && Math.abs(c.largo.m - c.ancho.m) < 1e-9;
    const d = c.diametro ?? (iguales ? c.largo : null);
    if (d) {
      const citas = [...(c.diametro ? [c.diametro] : [c.largo, c.ancho]), c.alto].filter(Boolean);
      return {
        forma: 'domo', diametro_m: d.m, alto_m: c.alto ? c.alto.m : d.m / 2, citas, rotulo: ROTULO.domo,
        supuesto: c.alto ? null : 'height not published: drawn as a half sphere of the published diameter (assumed)',
      };
    }
  }
  const faltan = ['largo', 'ancho', 'alto'].filter((k) => !c[k]);
  if (!faltan.length) return { forma: 'caja', largo_m: c.largo.m, ancho_m: c.ancho.m, alto_m: c.alto.m, citas: [c.largo, c.ancho, c.alto], rotulo: ROTULO.caja, supuesto: null };
  const hay = ['largo', 'ancho', 'alto', 'diametro'].filter((k) => c[k]);
  return { forma: null, citas: hay.map((k) => c[k]), falta: faltan.map((k) => ETIQUETA[k]), motivo: hay.length ? 'not enough published dimensions' : 'no published dimensions' };
}

export const medidaForma = (f) => (f.forma === 'domo' ? [f.diametro_m, f.diametro_m, f.alto_m] : [f.largo_m, f.ancho_m, f.alto_m]);

const nombreFichero = (u) => { try { return decodeURIComponent(String(u ?? '').split('/').pop()) || null; } catch { return null; } };

// Modelo de web/data/modelos.json que el catálogo de la misión señala como sustituto (mismo fichero publicado).
export function sustitutoDe(eq, modelos) {
  const s = eq?.modelo3d?.sustituto_de, f = nombreFichero(eq?.modelo3d?.fichero);
  if (!s || !f || !Array.isArray(modelos)) return null;
  const m = modelos.find((x) => nombreFichero(x?.fichero_url) === f && /^modelos\/[a-z0-9_]+\.glb$/.test(x?.fichero ?? ''));
  if (!m) return null;
  const corto = /\(([^)]+)\)\s*$/.exec(m.nombre_real)?.[1] ?? m.nombre_real;
  const porque = /evolved from/i.test(s.cita ?? '') ? `the ${corto} concept evolved from it` : 'a stand-in, not the same vehicle';
  return { modelo: m, cita: s, rotulo: `${corto} model shown in place of the ${eq.nombre} (${porque})` };
}

const UNIDAD = (u) => (u === 'deg' ? '°' : ` ${u}`);
export function limitesDe(eq) {
  return (Array.isArray(eq?.limites) ? eq.limites : []).filter((l) => Number.isFinite(l?.valor) && (l.tipo === 'max' || l.tipo === 'min')).map((l) => ({
    ...l, texto: `${PARAMETRO[l.parametro] ?? l.parametro} ${l.tipo === 'max' ? '≤' : '≥'} ${l.valor}${UNIDAD(l.unidad)}`,
  }));
}

// Pendiente medida en la celda frente al límite publicado; m = lado de celda del terreno en metros.
export function textoPendiente(pend, lim, m) {
  const res = `measured over ${m.toFixed(1)} m terrain cells`;
  if (!Number.isFinite(pend)) return { estado: 'sin_dato', texto: `slope not measured here (no elevation data) · ${res}` };
  const dentro = lim.tipo === 'max' ? pend <= lim.valor : pend >= lim.valor;
  const fuera = lim.tipo === 'max' ? 'over' : 'under';
  return { estado: dentro ? 'dentro' : 'fuera', texto: `slope here ${pend.toFixed(1)}° — ${dentro ? 'within' : fuera} the published ${lim.valor}° · ${res}` };
}
