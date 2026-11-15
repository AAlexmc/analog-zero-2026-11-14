// Equipo de la misión en un lugar, mes a mes (web/data/equipo_mision.json): límites publicados frente a la Tierra del lugar. Sin DOM.
import { MESES_CORTO, MESES_LARGO, rachas } from './meses.js';
import { distanciaKm, RADIO_CONTEXTO_KM } from './metricas.js';

const finito = (v) => typeof v === 'number' && Number.isFinite(v);

// [a la unidad del motor, de vuelta]; solo estas: cualquier otra unidad deja el límite sin medir.
const UNIDADES = {
  temperatura: { K: [(v) => v, (v) => v], '°C': [(v) => v + 273.15, (v) => v - 273.15], '°F': [(v) => ((v - 32) * 5) / 9 + 273.15, (v) => ((v - 273.15) * 9) / 5 + 32] },
  viento: { 'm/s': [(v) => v, (v) => v], 'km/h': [(v) => v / 3.6, (v) => v * 3.6], mph: [(v) => v * 0.44704, (v) => v / 0.44704] },
};
// t_min_k / t_max_k son la temperatura de la superficie del suelo (mínima y máxima del día medio del mes), no la del aire.
const PARAMETROS = {
  t_min_k: { clase: 'temperatura', sujeto: 'the night-time ground low', superficie: true },
  t_max_k: { clase: 'temperatura', sujeto: 'the daytime ground high', superficie: true },
  viento_p95_m_s: { clase: 'viento', sujeto: 'the 95th-percentile wind' },
  viento_medio_m_s: { clase: 'viento', sujeto: 'the mean wind' },
};
const SIN_CAPA = { pendiente_grados: 'no slope layer at this scale; see the simulation' };
const TIPOS = { rover: 'Rover', taladro: 'Drill', habitat: 'Habitat', dron: 'Drone', instrumento: 'Instrument' };

export const nombreTipo = (t) => TIPOS[t] ?? t;
export const verUnidad = (u) => (u === 'deg' ? '°' : ` ${u}`);
export const fmtLimite = (l) => `${l.valor}${verUnidad(l.unidad)}`;
export const sujetoDe = (id) => PARAMETROS[id]?.sujeto ?? (id === 'pendiente_grados' ? 'the slope' : id);
export const esSuperficie = (id) => !!PARAMETROS[id]?.superficie;

const conversor = (unidad, parametro) => UNIDADES[PARAMETROS[parametro]?.clase]?.[unidad] ?? null;
export function aMotor(v, unidad, parametro) {
  const c = conversor(unidad, parametro);
  return c && finito(v) ? c[0](v) : null;
}
export function deMotor(v, unidad, parametro) {
  const c = conversor(unidad, parametro);
  return c && finito(v) ? c[1](v) : null;
}

export function medible(l) {
  if (SIN_CAPA[l?.parametro]) return { medible: false, motivo: SIN_CAPA[l.parametro] };
  if (!PARAMETROS[l?.parametro]) return { medible: false, motivo: 'no layer for this' };
  if (l.tipo !== 'min' && l.tipo !== 'max') return { medible: false, motivo: 'unknown kind of limit' };
  if (!finito(l.valor)) return { medible: false, motivo: 'no published value' };
  if (!conversor(l.unidad, l.parametro)) return { medible: false, motivo: `unit "${l.unidad}" not converted` };
  return { medible: true, motivo: null };
}

export function equiposDe(catalogo, idMision) {
  const misiones = Array.isArray(catalogo) ? catalogo : catalogo?.misiones ?? [];
  return misiones.find((m) => m.mision === idMision)?.equipos ?? [];
}

// En el límite aguanta. margen y valor en la unidad del catálogo; sin dato → null (nunca 0).
export function veredictoMes(limite, valorTierra) {
  const lim = medible(limite).medible ? aMotor(limite.valor, limite.unidad, limite.parametro) : null;
  if (lim === null || !finito(valorTierra)) return { estado: 'sin_dato', margen: null, valor: null };
  const ok = limite.tipo === 'min' ? valorTierra >= lim : valorTierra <= lim;
  const valor = deMotor(valorTierra, limite.unidad, limite.parametro);
  return { estado: ok ? 'ok' : 'rompe', margen: valor - limite.valor, valor };
}

// Meses seguidos en 'ok' (año circular), con rachas de meses.js: ok = 1, rompe = 0, sin dato = null.
function rachasOk(veredictos) {
  if (!veredictos.some((v) => v.estado === 'ok')) return [];
  return rachas(veredictos.map((v) => ({ mes: v.mes, similitud_pct: v.estado === 'ok' ? 1 : v.estado === 'rompe' ? 0 : null })), 0.5);
}
const cuenta = (vs, e) => vs.filter((v) => v.estado === e).length;

function fraseLimite(l, vs, rs) {
  const s = sujetoDe(l.parametro), lim = fmtLimite(l);
  const aguanta = `${s} ${l.tipo === 'min' ? 'does not drop below' : 'does not rise above'} ${lim}`;
  const rompe = `${s} is ${l.tipo === 'min' ? 'below' : 'above'} ${lim}`;
  if (cuenta(vs, 'sin_dato') === 12) return 'No data here.';
  if (cuenta(vs, 'ok') === 12) return `Holds all year: ${aguanta}.`;
  if (!rs.length) return cuenta(vs, 'rompe') === 12 ? `Breaks every month here: ${rompe} all year.` : `Breaks in every month with data here: ${rompe}.`;
  return `Works here ${rs.map((r) => r.texto).join(', ')}: ${aguanta}.`;
}

// perfil: salida de M.perfilMensual (12 × { mes, parametros: [{ id, valor_tierra }] }) o null; anuales: M.leerPunto('earth', …).valores.
// Un parámetro sin versión mensual en el perfil usa el valor anual en los 12 meses (origen 'anual', «year value»).
export function calendarioEquipo(equipo, perfil, anuales) {
  const limites = (equipo.limites ?? []).map((limite) => {
    const m = medible(limite);
    if (!m.medible) return { limite, medible: false, motivo: m.motivo, origen: null, veredictos: null, rachas: [], frase: null };
    const id = limite.parametro;
    const mensual = !!perfil?.some((f) => f.parametros?.some((p) => p.id === id));
    const valorMes = (k) => (mensual ? perfil[k]?.parametros?.find((p) => p.id === id)?.valor_tierra : anuales?.[id]);
    const veredictos = Array.from({ length: 12 }, (_, k) => ({ mes: k + 1, ...veredictoMes(limite, valorMes(k)) }));
    const rs = rachasOk(veredictos);
    return { limite, medible: true, motivo: null, origen: mensual ? 'mes' : 'anual', veredictos, rachas: rs, frase: fraseLimite(limite, veredictos, rs) };
  });
  const med = limites.filter((l) => l.medible);
  const base = { id: equipo.id, nombre: equipo.nombre, tipo: equipo.tipo, campana: equipo.campana, limites, medibles: med.length, superficie: med.some((l) => esSuperficie(l.limite.parametro)) };
  if (!med.length) return { ...base, resumen: null };
  // Un mes aguanta si aguantan todos los límites medibles; rompe si rompe uno; si no, sin dato.
  const veredictos = Array.from({ length: 12 }, (_, k) => {
    const es = med.map((l) => l.veredictos[k].estado);
    return { mes: k + 1, estado: es.includes('rompe') ? 'rompe' : es.every((e) => e === 'ok') ? 'ok' : 'sin_dato' };
  });
  const rs = rachasOk(veredictos);
  // Con algún límite publicado que no se puede medir aquí, «all» sería decir de más.
  const todos = med.length === limites.length ? 'all its published limits' : 'the published limits we can measure';
  let frase = med[0].frase;
  if (med.length > 1) {
    frase = cuenta(veredictos, 'sin_dato') === 12 ? 'No data here.'
      : cuenta(veredictos, 'ok') === 12 ? `Within ${todos} all year.`
        : !rs.length ? `Outside at least one published limit ${cuenta(veredictos, 'rompe') === 12 ? 'every month here' : 'in every month with data here'}.`
          : `Within ${todos} here: ${rs.map((r) => r.texto).join(', ')}.`;
  }
  return { ...base, resumen: { veredictos, rachas: rs, frase } };
}

export function idsMensualesEquipo(equipos, conMeses) {
  const ids = (equipos ?? []).flatMap((e) => (e.limites ?? []).filter((l) => medible(l).medible).map((l) => l.parametro));
  return [...new Set(ids)].filter((id) => conMeses.includes(id));
}

// Campañas de la misión con coordenadas y meses a menos de km del lugar; null si no hay ninguna.
export function campanasCerca(mision, lat, lon, km = RADIO_CONTEXTO_KM) {
  const cs = (mision?.campanas ?? []).filter((c) => finito(c.lat) && finito(c.lon) && Array.isArray(c.meses) && c.meses.length)
    .map((c) => ({ nombre: c.nombre, meses: c.meses, km: distanciaKm(lat, lon, c.lat, c.lon) })).filter((c) => c.km <= km).sort((a, b) => a.km - b.km);
  if (!cs.length) return null;
  return { meses: [...new Set(cs.flatMap((c) => c.meses))].sort((a, b) => a - b), campanas: cs };
}
export const fraseNasaAqui = (c) => (c ? `NASA ran this here in ${c.meses.map((m) => MESES_CORTO[m - 1]).join(', ')} (${c.campanas.map((x) => `${x.nombre}, ${Math.round(x.km)} km away`).join('; ')}).` : null);

// Frase bajo el plan de repetición: equipos que rompen algún límite en el mes de la repetición.
export function fraseRepeticion(calendarios, mes) {
  const n = (calendarios ?? []).filter((c) => c.resumen?.veredictos[mes - 1]?.estado === 'rompe').map((c) => `the ${c.nombre}`);
  if (!n.length) return null;
  const lista = n.length === 1 ? n[0] : `${n.slice(0, -1).join(', ')} and ${n.at(-1)}`;
  return `In ${MESES_LARGO[mes - 1]} ${lista} ${n.length === 1 ? 'is outside its published range' : 'are outside their published ranges'} here.`;
}
