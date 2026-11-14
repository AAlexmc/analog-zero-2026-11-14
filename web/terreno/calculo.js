// Cálculo sobre la rejilla de alturas (fila 0 arriba = norte de la rejilla). Sin DOM.
const RAD = Math.PI / 180;
const BAJO = -1e30;

export function rango(a) {
  let min = Infinity, max = -Infinity, nan = 0;
  for (let i = 0; i < a.length; i++) {
    const v = a[i];
    if (Number.isFinite(v)) { if (v < min) min = v; if (v > max) max = v; } else nan++;
  }
  return { min, max, nan: a.length ? nan / a.length : 0 };
}

export function alturaBilineal(a, n, f, c) {
  f = Math.min(Math.max(f, 0), n - 1); c = Math.min(Math.max(c, 0), n - 1);
  const f0 = Math.min(Math.floor(f), n - 2 < 0 ? 0 : n - 2), c0 = Math.min(Math.floor(c), n - 2 < 0 ? 0 : n - 2);
  const tf = f - f0, tc = c - c0;
  const i = f0 * n + c0;
  // Un vecino con peso 0 no cuenta (NaN·0 = NaN).
  const p = (v, w) => (w ? v * w : 0);
  return p(p(a[i], 1 - tc) + p(a[i + 1], tc), 1 - tf) + p(p(a[i + n], 1 - tc) + p(a[i + n + 1], tc), tf);
}

function derivada(a, i, paso, hayAntes, hayDespues, m) {
  const h = a[i];
  const ant = hayAntes ? a[i - paso] : NaN, des = hayDespues ? a[i + paso] : NaN;
  if (Number.isFinite(ant) && Number.isFinite(des)) return (des - ant) / (2 * m);
  if (!Number.isFinite(h)) return NaN;
  if (Number.isFinite(des)) return (des - h) / m;
  if (Number.isFinite(ant)) return (h - ant) / m;
  return NaN;
}

export function pendienteGrados(a, n, m, f, c) {
  const i = f * n + c;
  if (!Number.isFinite(a[i])) return NaN;
  const gx = derivada(a, i, 1, c > 0, c < n - 1, m);
  const gy = derivada(a, i, n, f > 0, f < n - 1, m);
  return Math.atan(Math.hypot(gx, gy)) / RAD;
}

// Rumbo (grados desde arriba de la rejilla, horario) en el que el terreno sube más sobre el suelo de (f, c), en ángulo
// visto desde ahí hasta el borde de la rejilla. Empate → el primero (norte). null sin dato bajo el punto.
export function rumboHorizonte(a, n, m, f, c, pasos = 72) {
  const h0 = alturaBilineal(a, n, f, c);
  if (!Number.isFinite(h0)) return null;
  let mejor = null;
  for (let k = 0; k < pasos; k++) {
    const az = (360 * k) / pasos, dc = Math.sin(az * RAD), df = -Math.cos(az * RAD);
    let ang = -Infinity;
    for (let d = 1; ; d++) {
      const ff = f + df * d, cc = c + dc * d;
      if (ff < 0 || cc < 0 || ff > n - 1 || cc > n - 1) break;
      const h = alturaBilineal(a, n, ff, cc);
      if (Number.isFinite(h)) ang = Math.max(ang, Math.atan2(h - h0, d * m));
    }
    if (ang > -Infinity && (!mejor || ang > mejor.a + 1e-12)) mejor = { a: ang, rumbo_deg: az };
  }
  return mejor && { rumbo_deg: mejor.rumbo_deg, angulo_deg: mejor.a / RAD };
}

// Alturas sobre el plano tangente en el centro del recorte: h − r²/(2R). Ahí un rayo de sol es una recta.
export function sobrePlanoTangente(a, n, m, R) {
  const out = new Float32Array(n * n), k = (n - 1) / 2, q = (m * m) / (2 * R);
  for (let f = 0; f < n; f++) {
    const df2 = (f - k) * (f - k);
    for (let c = 0; c < n; c++) out[f * n + c] = a[f * n + c] - q * (df2 + (c - k) * (c - k));
  }
  return out;
}

// Sombra arrojada por barrido: s(p) = max(s(q), h(q)) − d·tan(elev), q = vecino aguas arriba hacia el sol.
// azimut en grados desde arriba de la rejilla, horario. Devuelve 255 = luz, 0 = sombra.
export function sombras(a, n, m, azimut, elevacion) {
  const out = new Uint8Array(n * n).fill(255);
  if (elevacion >= 90) return out;
  const tanE = Math.tan(Math.max(elevacion, 0) * RAD);
  // cos(90°) = 6e-17, no 0: sin redondear, el borde paralelo al sol se queda sin vecino aguas arriba.
  const limpio = (x) => (Math.abs(x) < 1e-12 ? 0 : x);
  const dc = limpio(Math.sin(azimut * RAD)), df = limpio(-Math.cos(azimut * RAD));
  const porColumnas = Math.abs(dc) >= Math.abs(df);
  const pa = porColumnas ? dc : df, pb = porColumnas ? df : dc;
  const sa = pa > 0 ? 1 : -1, rb = pb / Math.abs(pa);
  const dist = m * Math.hypot(1, rb);
  const idx = porColumnas ? (A, B) => B * n + A : (A, B) => A * n + B;
  let U = new Float64Array(n).fill(BAJO), Un = new Float64Array(n);
  const a0 = sa > 0 ? n - 1 : 0;
  for (let A = a0, k = 0; k < n; A -= sa, k++) {
    for (let B = 0; B < n; B++) {
      const i = idx(A, B);
      const h = a[i];
      let s = BAJO;
      if (k > 0) {
        const q = B + rb;
        if (q >= 0 && q <= n - 1) {
          const q0 = Math.min(Math.floor(q), n - 2), t = q - q0;
          s = U[q0] * (1 - t) + U[q0 + 1] * t - dist * tanE;
        }
      }
      if (Number.isFinite(h)) {
        if (s > h + 0.01) out[i] = 0;
        Un[B] = Math.max(s, h);
      } else Un[B] = Math.max(s, BAJO);
    }
    [U, Un] = [Un, U];
  }
  return out;
}

// Mundo en km: x = este de la rejilla, z = fila hacia abajo, y = (h − zc)/1000 · exag; origen en el centro.
export function pixelAMundo(geo, fila, col) {
  const k = (geo.n - 1) / 2;
  return { x: (col - k) * geo.mkm, z: (fila - k) * geo.mkm };
}

export function intersectarRayo(geo, o, d) {
  const { alturas, n, mkm, zc, exag } = geo;
  const k = (n - 1) / 2, lim = k * mkm;
  let t0 = 0, t1 = Infinity;
  for (const [oi, di] of [[o[0], d[0]], [o[2], d[2]]]) {
    if (Math.abs(di) < 1e-12) { if (oi < -lim || oi > lim) return null; continue; }
    let ta = (-lim - oi) / di, tb = (lim - oi) / di;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
  }
  if (!geo.rangoY) {
    const r = rango(alturas);
    geo.rangoY = [((r.min - zc) / 1000) * exag, ((r.max - zc) / 1000) * exag];
  }
  const [y0, y1] = geo.rangoY;
  if (Math.abs(d[1]) < 1e-12) { if (o[1] < y0 || o[1] > y1) return null; } else {
    let ta = (y0 - 1e-9 - o[1]) / d[1], tb = (y1 + 1e-9 - o[1]) / d[1];
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
  }
  if (!(t1 > t0)) return null;
  const alto = (t) => {
    const x = o[0] + d[0] * t, z = o[2] + d[2] * t;
    const f = z / mkm + k, c = x / mkm + k;
    const h = alturaBilineal(alturas, n, f, c);
    return { f, c, dif: o[1] + d[1] * t - ((h - zc) / 1000) * exag };
  };
  const horiz = Math.hypot(d[0], d[2]);
  let dt = horiz > 1e-9 ? (0.5 * mkm) / horiz : t1 - t0;
  dt = Math.max(dt, (t1 - t0) / 20000);
  let ta = t0, pa = alto(ta);
  if (pa.dif <= 0) return { fila: pa.f, col: pa.c, x: o[0] + d[0] * ta, y: o[1] + d[1] * ta, z: o[2] + d[2] * ta };
  for (let t = t0 + dt; ta < t1; t += dt) {
    const tt = Math.min(t, t1);
    const p = alto(tt);
    if (p.dif <= 0) {
      let lo = ta, hi = tt;
      for (let j = 0; j < 40; j++) {
        const mid = (lo + hi) / 2, pm = alto(mid);
        if (pm.dif <= 0) hi = mid; else lo = mid;
      }
      const q = alto(hi);
      return { fila: q.f, col: q.c, x: o[0] + d[0] * hi, y: o[1] + d[1] * hi, z: o[2] + d[2] * hi };
    }
    ta = tt; pa = p;
  }
  return null;
}
