// Obra sobre la rejilla de alturas: rasante de carretera, movimiento de tierras, plataformas, densidad del regolito y flota. Sin DOM.
// Las constantes físicas entran siempre como parámetros.
import { pendienteGrados } from './calculo.js';

const RAD = Math.PI / 180;

const metros = (t) => t.m ?? t.m_por_px;

export function perfil(t, camino) {
  const { n, alturas } = t, m = metros(t);
  const k = camino.length, s = new Float64Array(k), z = new Float64Array(k);
  for (let i = 0; i < k; i++) {
    const b = camino[i];
    z[i] = alturas[b];
    if (i) {
      const a = camino[i - 1];
      s[i] = s[i - 1] + Math.hypot(Math.floor(b / n) - Math.floor(a / n), (b % n) - (a % n)) * m;
    }
  }
  return { s, z };
}

// Montículo de mínimos de pares (clave, peso).
class Monton {
  constructor() { this.k = []; this.w = []; }
  meter(key, w) {
    const K = this.k, W = this.w;
    let i = K.length;
    K.push(key); W.push(w);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (K[p] <= key) break;
      K[i] = K[p]; W[i] = W[p]; i = p;
    }
    K[i] = key; W[i] = w;
  }
  quitar() {
    const K = this.k, W = this.w, key = K.pop(), w = W.pop(), n = K.length;
    if (!n) return;
    let i = 0;
    for (;;) {
      let h = 2 * i + 1;
      if (h >= n) break;
      if (h + 1 < n && K[h + 1] < K[h]) h++;
      if (K[h] >= key) break;
      K[i] = K[h]; W[i] = W[h]; i = h;
    }
    K[i] = key; W[i] = w;
  }
  tomar(d) { if (this.w[0] <= d) this.quitar(); else this.w[0] -= d; }
}

// min Σ wᵢ·|zpᵢ − zᵢ| con |zpᵢ₊₁ − zpᵢ| ≤ tan(límite)·Δsᵢ; wᵢ = regla del trapecio.
// Programación dinámica exacta sobre funciones convexas a trozos («slope trick»): fᵢ se guarda como dos montículos de
// puntos de quiebre (izquierda/derecha del mínimo) con desplazamientos perezosos; la ventana ±cᵢ solo mueve los desplazamientos.
// opc = {anclarInicio, anclarFin}: el extremo se queda en la cota del terreno.
export function rasante(s, z, limite_deg, opc = {}) {
  const N = s.length;
  if (z.length !== N) throw new Error('distance and elevation arrays must have the same length');
  if (!(limite_deg >= 0 && limite_deg < 90)) throw new Error('slope limit must be in [0, 90) degrees');
  for (let i = 0; i + 1 < N; i++) if (!(s[i + 1] > s[i])) throw new Error('distance must be strictly increasing');
  for (let i = 0; i < N; i++) {
    if (!Number.isFinite(z[i])) return { factible: false, zp: null, motivo: `no elevation data at profile point ${i}` };
  }
  const k = Math.tan(limite_deg * RAD);
  const c = new Float64Array(Math.max(N - 1, 0));
  let C = 0, cumple = true;
  for (let i = 0; i + 1 < N; i++) {
    c[i] = k * (s[i + 1] - s[i]);
    C += c[i];
    if (Math.abs(z[i + 1] - z[i]) > c[i]) cumple = false;
  }
  if (cumple) return { factible: true, zp: Float64Array.from(z), motivo: null };
  const ini = !!opc.anclarInicio, fin = !!opc.anclarFin;
  if (ini && fin && Math.abs(z[N - 1] - z[0]) > C) {
    return { factible: false, zp: null, motivo: 'both ends anchored: their elevation difference exceeds what the slope limit allows over this length' };
  }

  const L = new Monton(), R = new Monton();
  let oL = 0, oR = 0;
  const lo = new Float64Array(N), hi = new Float64Array(N);
  if (ini) { L.meter(-z[0], Infinity); R.meter(z[0], Infinity); }
  for (let i = 0; i < N; i++) {
    if (i > 0) { oL -= c[i - 1]; oR += c[i - 1]; }
    const w = ((i > 0 ? s[i] - s[i - 1] : 0) + (i < N - 1 ? s[i + 1] - s[i] : 0)) / 2;
    L.meter(-(z[i] - oL), w); R.meter(z[i] - oR, w);
    for (;;) {
      const l = -L.k[0] + oL, r = R.k[0] + oR;
      if (!(l - r > 1e-12 * (1 + Math.abs(l)))) break;
      const d = Math.min(L.w[0], R.w[0]);
      L.tomar(d); R.tomar(d);
      R.meter(l - oR, d); L.meter(-(r - oL), d);
    }
    lo[i] = -L.k[0] + oL; hi[i] = R.k[0] + oR;
  }

  const zp = new Float64Array(N);
  zp[N - 1] = fin ? z[N - 1] : Math.min(Math.max(z[N - 1], lo[N - 1]), hi[N - 1]);
  for (let i = N - 2; i >= 0; i--) {
    const x = zp[i + 1];
    zp[i] = Math.min(Math.max(Math.min(Math.max(x, lo[i]), hi[i]), x - c[i]), x + c[i]);
  }
  if (ini) zp[0] = z[0];
  return { factible: true, zp, motivo: null };
}

// Integral exacta de la diferencia lineal a trozos (se parte el tramo donde rasante y terreno se cruzan).
// Sección: ancho·h + talud·h² (talud = horizontal/vertical en cada lado).
export function volumenCarretera(s, z, zp, ancho_m, talud = 0) {
  const N = s.length;
  if (z.length !== N || zp.length !== N) throw new Error('distance, elevation and grade arrays must have the same length');
  if (!(ancho_m > 0 && Number.isFinite(ancho_m))) throw new Error('road width must be > 0');
  if (!(talud >= 0 && Number.isFinite(talud))) throw new Error('side slope must be ≥ 0');
  const sec = (h1, h2, Ls) => Ls * ((ancho_m * (h1 + h2)) / 2 + (talud * (h1 * h1 + h1 * h2 + h2 * h2)) / 3);
  let corte = 0, relleno = 0, cmax = 0, rmax = 0;
  for (let i = 0; i < N; i++) {
    const d = z[i] - zp[i];
    cmax = Math.max(cmax, d); rmax = Math.max(rmax, -d);
    if (i + 1 === N) break;
    const d2 = z[i + 1] - zp[i + 1], Ls = s[i + 1] - s[i];
    if (d >= 0 && d2 >= 0) corte += sec(d, d2, Ls);
    else if (d <= 0 && d2 <= 0) relleno += sec(-d, -d2, Ls);
    else {
      const x = (Ls * d) / (d - d2);
      if (d > 0) { corte += sec(d, 0, x); relleno += sec(0, -d2, Ls - x); } else { relleno += sec(-d, 0, x); corte += sec(0, d2, Ls - x); }
    }
  }
  return { corte_m3: corte, relleno_m3: relleno, corte_max_m: cmax, relleno_max_m: rmax, longitud_m: N ? s[N - 1] - s[0] : 0 };
}

// Por debajo de este diámetro (en celdas) la rejilla no resuelve la plataforma: cuña analítica.
export const DIAMETRO_SUBCELDA = 3;

// Disco de radio r inclinado α → β: a cada lado V = (2/3)·r³·(tan α − tan β).
export function volumenCuna(radio_m, pend_deg, limite_deg) {
  const fin = Math.min(pend_deg, limite_deg);
  const V = (2 / 3) * radio_m ** 3 * (Math.tan(pend_deg * RAD) - Math.tan(fin * RAD));
  return { corte_m3: V, relleno_m3: V, pend_despues_deg: fin };
}

// Plano de mínimos cuadrados sobre el disco; si pasa del límite se reduce al límite conservando dirección y cota media.
export function plataforma(t, fila, col, diametro_m, limite_deg) {
  const { n, alturas } = t, m = metros(t);
  if (!(diametro_m > 0 && Number.isFinite(diametro_m))) throw new Error('platform diameter must be > 0');
  if (!(limite_deg >= 0 && limite_deg < 90)) throw new Error('slope limit must be in [0, 90) degrees');
  const r = diametro_m / 2;
  const nada = (motivo, sub) => ({ sub_celda: sub, corte_m3: null, relleno_m3: null, pend_antes_deg: null, pend_despues_deg: null, cota_media_m: null, celdas: 0, delta: null, motivo });

  if (diametro_m < DIAMETRO_SUBCELDA * m) {
    const f = Math.min(n - 1, Math.max(0, Math.round(fila))), c = Math.min(n - 1, Math.max(0, Math.round(col)));
    const a = pendienteGrados(alturas, n, m, f, c);
    if (!Number.isFinite(a)) return nada('no elevation data at this point', true);
    const w = volumenCuna(r, a, limite_deg);
    return {
      sub_celda: true, corte_m3: w.corte_m3, relleno_m3: w.relleno_m3, pend_antes_deg: a, pend_despues_deg: w.pend_despues_deg,
      cota_media_m: alturas[f * n + c], celdas: 1, delta: null,
      motivo: `platform narrower than ${DIAMETRO_SUBCELDA} cells: tilted-disc wedge with the local DEM slope, not applied to the grid`,
    };
  }

  const rc = r / m;
  const f0 = Math.max(0, Math.ceil(fila - rc)), f1 = Math.min(n - 1, Math.floor(fila + rc));
  const c0 = Math.max(0, Math.ceil(col - rc)), c1 = Math.min(n - 1, Math.floor(col + rc));
  const idx = [], xs = [], ys = [];
  let mx = 0, my = 0, mz = 0;
  for (let f = f0; f <= f1; f++) for (let c = c0; c <= c1; c++) {
    const i = f * n + c;
    if (Math.hypot(f - fila, c - col) * m > r || !Number.isFinite(alturas[i])) continue;
    const x = (c - col) * m, y = (fila - f) * m;
    idx.push(i); xs.push(x); ys.push(y);
    mx += x; my += y; mz += alturas[i];
  }
  const k = idx.length;
  if (k < 3) return nada('fewer than 3 cells with elevation data inside the platform', false);
  mx /= k; my /= k; mz /= k;
  let Sxx = 0, Sxy = 0, Syy = 0, Sxz = 0, Syz = 0;
  for (let j = 0; j < k; j++) {
    const x = xs[j] - mx, y = ys[j] - my, h = alturas[idx[j]] - mz;
    Sxx += x * x; Sxy += x * y; Syy += y * y; Sxz += x * h; Syz += y * h;
  }
  const det = Sxx * Syy - Sxy * Sxy;
  if (!(det > 0)) return nada('cells inside the platform are collinear: no plane fit', false);
  let gx = (Syy * Sxz - Sxy * Syz) / det, gy = (Sxx * Syz - Sxy * Sxz) / det;
  const g = Math.hypot(gx, gy), tl = Math.tan(limite_deg * RAD);
  const antes = Math.atan(g) / RAD;
  if (g > tl) { gx *= tl / g; gy *= tl / g; }
  const delta = new Float32Array(n * n);
  let corte = 0, relleno = 0;
  for (let j = 0; j < k; j++) {
    const d = mz + gx * (xs[j] - mx) + gy * (ys[j] - my) - alturas[idx[j]];
    delta[idx[j]] = d;
    if (d > 0) relleno += d; else corte -= d;
  }
  return {
    sub_celda: false, corte_m3: corte * m * m, relleno_m3: relleno * m * m, pend_antes_deg: antes,
    pend_despues_deg: g > tl ? Math.atan(tl) / RAD : antes, cota_media_m: mz, celdas: k, delta, motivo: null,
  };
}

// ρ(z) = rho_inf·(z + a)/(z + b), z en cm bajo la superficie; ρ en las unidades de rho_inf.
function comprobarDensidad({ rho_inf, a, b }) {
  if (!(rho_inf > 0 && b > 0 && Number.isFinite(a) && Number.isFinite(rho_inf) && Number.isFinite(b))) throw new Error('density parameters need rho_inf > 0, finite a and b > 0');
}

export function densidad(z_cm, p) {
  comprobarDensidad(p);
  return (p.rho_inf * (z_cm + p.a)) / (z_cm + p.b);
}

// Media en [0, d]: rho_inf·(1 + (a − b)·ln(1 + d/b)/d).
export function densidadMedia(profundidad_cm, p) {
  comprobarDensidad(p);
  const d = profundidad_cm;
  if (!(d >= 0 && Number.isFinite(d))) throw new Error('depth must be ≥ 0');
  if (d === 0) return (p.rho_inf * p.a) / p.b;
  return p.rho_inf * (1 + ((p.a - p.b) * Math.log1p(d / p.b)) / d);
}

// params en g/cm³ y cm (forma del perfil de densidad); devuelve kg.
export function masaCorte(volumen_m3, profundidad_media_m, params) {
  if (!(volumen_m3 >= 0 && Number.isFinite(volumen_m3))) throw new Error('volume must be ≥ 0');
  return volumen_m3 * densidadMedia(profundidad_media_m * 100, params) * 1000;
}

const CAMPOS_FLOTA = ['masa_kg', 'n_robots', 'kg_por_dia_lunar', 'fraccion_luz', 'distancia_acarreo_m', 'carga_kg', 'velocidad_m_s', 'horas_dia_lunar'];

// Excavar y acarrear en paralelo: manda el más lento. kg_por_dia_lunar = por robot en un día lunar entero con luz;
// solo se trabaja la fracción con luz. Acarreo: viajes de ida y vuelta, repartidos entre los robots, sin tiempos de carga.
export function planFlota(e) {
  const no = (motivo) => ({ evaluable: false, motivo, dias_excavacion: null, dias_acarreo: null, dias: null, manda: null, viajes: null });
  if (!e || typeof e !== 'object') return no(`missing fleet inputs: ${CAMPOS_FLOTA.join(', ')}`);
  const malos = CAMPOS_FLOTA.filter((k) => {
    const v = e[k];
    if (typeof v !== 'number' || !Number.isFinite(v)) return true;
    return k === 'masa_kg' ? v < 0 : v <= 0;
  });
  if (malos.length) return no(`missing, non-finite or non-positive: ${malos.join(', ')}`);
  if (e.fraccion_luz > 1) return no('fraccion_luz must be in (0, 1]');
  if (!Number.isInteger(e.n_robots)) return no('n_robots must be a whole number');
  if (e.masa_kg === 0) return { evaluable: true, motivo: null, dias_excavacion: 0, dias_acarreo: 0, dias: 0, manda: null, viajes: 0 };
  const dias_excavacion = e.masa_kg / (e.n_robots * e.kg_por_dia_lunar * e.fraccion_luz);
  const viajes = Math.ceil(e.masa_kg / e.carga_kg);
  const horasViaje = (2 * e.distancia_acarreo_m) / e.velocidad_m_s / 3600;
  const dias_acarreo = (Math.ceil(viajes / e.n_robots) * horasViaje) / (e.horas_dia_lunar * e.fraccion_luz);
  if (!Number.isFinite(dias_excavacion) || !Number.isFinite(dias_acarreo)) return no('inputs out of range: result overflows');
  const manda = dias_excavacion >= dias_acarreo ? 'excavacion' : 'acarreo';
  return { evaluable: true, motivo: null, dias_excavacion, dias_acarreo, dias: Math.max(dias_excavacion, dias_acarreo), manda, viajes };
}

// Aquí la calzada ocupa la celda entera; el volumen que se informa es el de volumenCarretera (por anchura).
export function deltaCarretera(t, camino, zp) {
  const { n, alturas } = t;
  if (!zp || zp.length !== camino.length) throw new Error('grade and path must have the same length');
  const d = new Float32Array(n * n);
  for (let k = 0; k < camino.length; k++) {
    const i = camino[k];
    if (Number.isFinite(alturas[i]) && Number.isFinite(zp[k])) d[i] = zp[k] - alturas[i];
  }
  return d;
}
