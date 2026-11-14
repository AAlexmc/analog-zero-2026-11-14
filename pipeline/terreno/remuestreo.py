import numpy as np


def bilineal(a, filas, cols):
    """Interpolación bilineal en índices fraccionarios (centros de píxel). Fuera del ráster o con vecino NaN: NaN.

    `a` puede ser un np.memmap: solo se leen los 4 vecinos de cada punto.
    """
    filas = np.asarray(filas, dtype=float)
    cols = np.asarray(cols, dtype=float)
    H, W = a.shape
    dentro = (filas >= 0) & (filas <= H - 1) & (cols >= 0) & (cols <= W - 1) & np.isfinite(filas) & np.isfinite(cols)
    fs = np.where(dentro, filas, 0.0)
    cs = np.where(dentro, cols, 0.0)
    f0 = np.clip(np.floor(fs).astype(np.int64), 0, max(H - 2, 0))
    c0 = np.clip(np.floor(cs).astype(np.int64), 0, max(W - 2, 0))
    f1 = np.minimum(f0 + 1, H - 1)
    c1 = np.minimum(c0 + 1, W - 1)
    tf = fs - f0
    tc = cs - c0
    v00 = np.asarray(a[f0, c0], dtype=np.float64)
    v01 = np.asarray(a[f0, c1], dtype=np.float64)
    v10 = np.asarray(a[f1, c0], dtype=np.float64)
    v11 = np.asarray(a[f1, c1], dtype=np.float64)
    # peso 0 no debe propagar un NaN vecino (borde exacto)
    w00, w01, w10, w11 = (1 - tf) * (1 - tc), (1 - tf) * tc, tf * (1 - tc), tf * tc
    out = np.zeros(fs.shape)
    for w, v in ((w00, v00), (w01, v01), (w10, v10), (w11, v11)):
        out = out + np.where(w > 0, w * v, 0.0)
    return np.where(dentro, out, np.nan)


def vecino(a, filas, cols):
    """Vecino más próximo (para capas de clases). Devuelve (valores, dentro); fuera del ráster el valor no vale."""
    fi = np.rint(np.nan_to_num(np.asarray(filas, dtype=float), nan=-1.0)).astype(np.int64)
    ci = np.rint(np.nan_to_num(np.asarray(cols, dtype=float), nan=-1.0)).astype(np.int64)
    H, W = a.shape
    dentro = (fi >= 0) & (fi < H) & (ci >= 0) & (ci < W)
    v = np.asarray(a[np.where(dentro, fi, 0), np.where(dentro, ci, 0)])
    return v, dentro
