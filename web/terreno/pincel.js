// Pincel de retoque sobre un campo de alturas: altura = base + delta. Solo escribe delta.
export const FACTOR_PASO = 0.01;

export const pasoMetros = (radio_m, intensidad) => Math.fround(radio_m * FACTOR_PASO * intensidad);

export function pesoPincel(d, r) {
  if (d >= r) return 0;
  const t = 1 - (d / r) ** 2;
  return t * t;
}

// toque: {fila, col, radio_m, intensidad 0-1, herramienta: subir|bajar|allanar|suavizar, cota_objetivo}
// registro: Map índice → delta antes del primer toque del trazo.
export function aplicarToque(estado, toque, registro) {
  const { n, m_por_px: m, base, delta } = estado;
  const rpx = toque.radio_m / m;
  const f0 = Math.max(0, Math.floor(toque.fila - rpx)), f1 = Math.min(n - 1, Math.ceil(toque.fila + rpx));
  const c0 = Math.max(0, Math.floor(toque.col - rpx)), c1 = Math.min(n - 1, Math.ceil(toque.col + rpx));
  if (f0 > f1 || c0 > c1) return null;
  const s = toque.intensidad;
  const paso = pasoMetros(toque.radio_m, s);
  const h = (i) => base[i] + delta[i];

  let media = null;
  if (toque.herramienta === 'suavizar') {
    const w = c1 - c0 + 1;
    media = new Float64Array((f1 - f0 + 1) * w);
    for (let f = f0; f <= f1; f++) for (let c = c0; c <= c1; c++) {
      let suma = 0, k = 0;
      for (let df = -1; df <= 1; df++) for (let dc = -1; dc <= 1; dc++) {
        const ff = f + df, cc = c + dc;
        if (ff < 0 || cc < 0 || ff >= n || cc >= n) continue;
        const v = h(ff * n + cc);
        if (Number.isFinite(v)) { suma += v; k++; }
      }
      media[(f - f0) * w + (c - c0)] = k ? suma / k : NaN;
    }
  }

  for (let f = f0; f <= f1; f++) for (let c = c0; c <= c1; c++) {
    const wgt = pesoPincel(Math.hypot(f - toque.fila, c - toque.col) * m, toque.radio_m);
    if (wgt <= 0) continue;
    const i = f * n + c;
    if (!Number.isFinite(base[i])) continue;
    let d;
    switch (toque.herramienta) {
      case 'subir': d = paso * wgt; break;
      case 'bajar': d = -paso * wgt; break;
      case 'allanar': d = (toque.cota_objetivo - h(i)) * s * wgt; break;
      case 'suavizar': {
        const mu = media[(f - f0) * (c1 - c0 + 1) + (c - c0)];
        d = Number.isFinite(mu) ? (mu - h(i)) * s * wgt : 0;
        break;
      }
      default: throw new Error(`unknown tool: ${toque.herramienta}`);
    }
    if (!Number.isFinite(d) || d === 0) continue;
    if (registro && !registro.has(i)) registro.set(i, delta[i]);
    delta[i] += d;
  }
  return { f0, f1, c0, c1 };
}
