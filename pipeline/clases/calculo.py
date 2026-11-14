"""Clases de entorno de la Tierra: componentes principales blanqueadas + k-medias pesadas por área. Sin E/S."""
import numpy as np

SEMILLA = 7
N_INICIOS = 10
MAX_ITER = 300
K_CANDIDATOS = tuple(range(6, 15))
N_MUESTRA = 5000
VARIANZA_MIN = 0.95
CIFRAS = 10


def redondea(a):
    """Lo que se guarda en clases.json; todo lo que sigue se calcula con estos números, igual que el motor."""
    return np.vectorize(lambda x: float(f"{x:.{CIFRAS}g}"), otypes=[float])(np.asarray(a, dtype=float))


def transforma(v, transformacion, minimo):
    v = np.asarray(v, dtype=float)
    if transformacion == "log10":
        return np.log10(np.maximum(v, minimo))
    if transformacion == "log1p":
        return np.log10(1 + np.maximum(v, 0))
    if transformacion == "lineal":
        return v
    raise ValueError(transformacion)


def destransforma(x, transformacion):
    x = np.asarray(x, dtype=float)
    if transformacion == "log10":
        return 10 ** x
    if transformacion == "log1p":
        return 10 ** x - 1
    return x


def estandariza(X, w):
    w = w / w.sum()
    media = w @ X
    desv = np.sqrt(w @ (X - media) ** 2)
    return media, desv


def pca(Z, w):
    """Autovectores de la covarianza pesada de Z (filas = componentes) y autovalores; signo: carga mayor en valor absoluto > 0."""
    _, s, vt = np.linalg.svd(Z * np.sqrt(w / w.sum())[:, None], full_matrices=False)
    for j in range(vt.shape[0]):
        if vt[j, np.argmax(np.abs(vt[j]))] < 0:
            vt[j] = -vt[j]
    return vt, s ** 2


def retenidas(autovalores, minimo=VARIANZA_MIN):
    acum = np.cumsum(autovalores) / autovalores.sum()
    return int(np.searchsorted(acum, minimo - 1e-12) + 1)


def puntuaciones(X, media, desv, comp, autoval):
    return ((X - media) / desv) @ comp.T / np.sqrt(autoval)


def distancias2(S, C):
    return ((S[:, None, :] - C[None, :, :]) ** 2).sum(-1)


def asigna(S, C):
    d2 = distancias2(S, C)
    e = np.argmin(d2, axis=1)
    return e, np.sqrt(d2[np.arange(len(S)), e])


def _kmeanspp(S, w, k, rng):
    p = w / w.sum()
    C = [S[rng.choice(len(S), p=p)]]
    d2 = ((S - C[0]) ** 2).sum(1)
    for _ in range(1, k):
        q = w * d2
        C.append(S[rng.choice(len(S), p=q / q.sum())])
        d2 = np.minimum(d2, ((S - C[-1]) ** 2).sum(1))
    return np.array(C)


def kmedias(S, w, k, semilla=SEMILLA, n_inicios=N_INICIOS):
    """k-medias pesadas (Lloyd, arranque k-means++); la de menor inercia entre n_inicios. (centros, etiquetas, inercia)."""
    rng = np.random.default_rng(semilla)
    mejor = None
    for _ in range(n_inicios):
        C = _kmeanspp(S, w, k, rng)
        e = None
        n2 = (S ** 2).sum(1)
        for _ in range(MAX_ITER):
            nuevo = np.argmin(n2[:, None] + (C ** 2).sum(1)[None, :] - 2 * S @ C.T, axis=1)
            if e is not None and np.array_equal(nuevo, e):
                break
            e = nuevo
            peso = np.bincount(e, weights=w, minlength=k)
            suma = np.stack([np.bincount(e, weights=w * S[:, d], minlength=k) for d in range(S.shape[1])], axis=1)
            for j in range(k):
                C[j] = suma[j] / peso[j] if peso[j] > 0 else S[np.argmax(((S - C[e]) ** 2).sum(1))]
        e, d = asigna(S, C)
        inercia = float(w @ d ** 2)
        if mejor is None or inercia < mejor[2]:
            mejor = (C.copy(), e, inercia)
    return mejor


def muestra(w, n=N_MUESTRA, semilla=SEMILLA):
    """Índices de una muestra fija, sin reemplazo, con probabilidad ∝ área."""
    rng = np.random.default_rng(semilla + 1)
    n = min(n, len(w))
    return np.sort(rng.choice(len(w), size=n, replace=False, p=w / w.sum()))


def matriz_distancias(S):
    g = S @ S.T
    n2 = np.diag(g)
    return np.sqrt(np.maximum(n2[:, None] + n2[None, :] - 2 * g, 0))


def silueta_media(D, e):
    """Silueta media (Rousseeuw) sobre la muestra; una clase con un solo punto en la muestra da 0."""
    ids = np.unique(e)
    medias = np.stack([D[:, e == j].sum(1) for j in ids], axis=1)
    cuenta = np.array([(e == j).sum() for j in ids])
    pos = np.searchsorted(ids, e)
    propia = cuenta[pos] - 1
    a = np.where(propia > 0, medias[np.arange(len(e)), pos] / np.maximum(propia, 1), 0.0)
    otras = medias / cuenta[None, :]
    otras[np.arange(len(e)), pos] = np.inf
    b = otras.min(1)
    s = np.where(propia > 0, (b - a) / np.maximum(a, b), 0.0)
    return float(s.mean())


def percentil_area(v, w, q):
    o = np.argsort(v, kind="stable")
    c = np.cumsum(w[o]) / w.sum()
    return float(v[o][min(np.searchsorted(c, q), len(v) - 1)])


PALABRAS = {
    "rugosidad_tan": ("smooth", "rough"),
    "relieve_m": ("flat", "steep"),
    "t_max_k": ("cool days", "hot days"),
    "t_min_k": ("cold nights", "warm nights"),
    "t_media_k": ("cold", "warm"),
    "insolacion_kwh_m2_dia": ("dim", "sunny"),
    "ndvi_max": ("bare", "green"),
    "precip_mm_ano": ("dry", "wet"),
}
Z_RASGO = 0.5
Z_MUY = 1.5
MAX_RASGOS = 3
REGLA_ROTULO = (
    f"For each class, the area-weighted mean of every standardized parameter (z). Within each parameter group "
    f"(terrain, temperature, …) only the parameter with the largest |z| is kept. Groups are ranked by |z|; the label "
    f"joins up to {MAX_RASGOS} of them with |z| ≥ {Z_RASGO}, at least one; the word is the 'low' or 'high' word of "
    f"the parameter, with 'very ' in front when |z| ≥ {Z_MUY}. If two classes end with the same label, the next "
    f"ranked group is added to both until they differ."
)


def _palabra(pid, z):
    bajo, alto = PALABRAS.get(pid, (f"low {pid}", f"high {pid}"))
    return ("very " if abs(z) >= Z_MUY else "") + (alto if z > 0 else bajo)


def rotulos(zmedias, ids, grupos):
    """zmedias: k × p. Devuelve una cadena por clase, según REGLA_ROTULO."""
    rangos = []
    for z in zmedias:
        mejor = {}
        for j, (pid, g) in enumerate(zip(ids, grupos)):
            if g not in mejor or abs(z[j]) > abs(z[mejor[g]]):
                mejor[g] = j
        rangos.append(sorted(mejor.values(), key=lambda j: (-abs(z[j]), j)))
    largo = [max(1, min(MAX_RASGOS, sum(abs(z[j]) >= Z_RASGO for j in r))) for z, r in zip(zmedias, rangos)]
    texto = lambda c: " · ".join(_palabra(ids[j], zmedias[c][j]) for j in rangos[c][:largo[c]])
    while True:
        t = [texto(c) for c in range(len(zmedias))]
        repetidos = [c for c in range(len(t)) if t.count(t[c]) > 1 and largo[c] < len(rangos[c])]
        if not repetidos:
            return t
        for c in repetidos:
            largo[c] += 1
