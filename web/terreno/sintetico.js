// Terreno sintético para trabajar sin datos (solo con ?ejemplo=1). No es dato real.
import { sombras, rango } from './calculo.js';

function aleatorio(semilla) {
  let s = semilla >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function ruido(n, semilla, octavas, amp) {
  const out = new Float32Array(n * n);
  const rnd = aleatorio(semilla);
  for (let o = 0; o < octavas; o++) {
    const g = 4 << o, v = new Float32Array((g + 1) * (g + 1)).map(() => rnd() * 2 - 1), a = amp / 2 ** o;
    for (let f = 0; f < n; f++) {
      const y = (f / n) * g, y0 = Math.floor(y), ty = y - y0, sy = ty * ty * (3 - 2 * ty);
      for (let c = 0; c < n; c++) {
        const x = (c / n) * g, x0 = Math.floor(x), tx = x - x0, sx = tx * tx * (3 - 2 * tx);
        const i = y0 * (g + 1) + x0;
        out[f * n + c] += a * ((v[i] * (1 - sx) + v[i + 1] * sx) * (1 - sy) + (v[i + g + 1] * (1 - sx) + v[i + g + 2] * sx) * sy);
      }
    }
  }
  return out;
}

function crater(a, n, m, fc, cc, radio_m, prof, borde) {
  const rpx = radio_m / m, ext = rpx * 3;
  for (let f = Math.max(0, Math.floor(fc - ext)); f <= Math.min(n - 1, Math.ceil(fc + ext)); f++) {
    for (let c = Math.max(0, Math.floor(cc - ext)); c <= Math.min(n - 1, Math.ceil(cc + ext)); c++) {
      const r = Math.hypot(f - fc, c - cc) / rpx;
      if (r > 3) continue;
      a[f * n + c] += r < 1 ? prof * (r * r - 1) + borde : borde * r ** -3 * (1 - (r - 1) / 2);
    }
  }
}

export function terrenoSintetico(cuerpo, n = 1024) {
  const luna = cuerpo === 'luna';
  const lado_km = 40, m = (lado_km * 1000) / n;
  const altura = ruido(n, luna ? 7 : 11, 6, luna ? 220 : 160);
  const rnd = aleatorio(luna ? 3 : 5);
  crater(altura, n, m, n / 2, n / 2, luna ? 10500 : 11500, luna ? 4000 : 250, luna ? 1500 : 120);
  for (let k = 0; k < (luna ? 400 : 40); k++) {
    const r = 60 * (1 - rnd()) ** -0.9;
    crater(altura, n, m, rnd() * n, rnd() * n, Math.min(r, 2500), r * (luna ? 0.4 : 0.1), r * (luna ? 0.08 : 0.02));
  }
  if (!luna) {
    for (let f = Math.floor(n * 0.12); f < n * 0.16; f++) for (let c = Math.floor(n * 0.7); c < n * 0.78; c++) altura[f * n + c] = NaN;
  }
  const r = rango(altura);
  const half = ((n - 1) / 2) * m;
  const meta = {
    id: luna ? 'ejemplo-luna' : 'ejemplo-tierra', cuerpo, sintetico: true,
    nombre: luna ? 'Synthetic polar crater (example)' : 'Synthetic impact crater (example)',
    centro: luna ? { lat: -90, lon: 0 } : { lat: 75.38, lon: -89.68 },
    lado_km, n, m_por_px: m, z_min: r.min, z_max: r.max,
    z_referencia: 'synthetic',
    georef: luna
      ? { tipo: 'estereo_polar', polo: 'sur', radio_m: 1737400, x0_m: -half, y0_m: half }
      : { tipo: 'local_aeqd', radio_m: 6371000, x0_m: -half, y0_m: half },
    capas: { altura: { fichero: 'altura.f32', tipo: 'float32', unidad: 'm', fuente: 'synthetic (generated in the browser)', origen: 'mío' } },
    rasgos: [{ nombre: 'Example crater', tipo: 'crater', lat: luna ? -90 : 75.38, lon: luna ? 0 : -89.68, diametro_km: luna ? 21 : 23, fuente: 'synthetic' }],
  };
  const capas = {};
  if (luna) {
    const il = new Float32Array(n * n), pasos = 16;
    for (let k = 0; k < pasos; k++) {
      const s = sombras(altura, n, m, (360 * k) / pasos, 1.5);
      for (let i = 0; i < il.length; i++) il[i] += s[i] / 255 / pasos;
    }
    capas.iluminacion = il;
    meta.capas.iluminacion = { fichero: 'iluminacion.f32', tipo: 'float32', unidad: 'fraction 0-1',
      fuente: 'synthetic: sunlit fraction over 16 azimuths at 1.5° elevation', origen: 'mío' };
  }
  return { meta, altura, capas };
}
