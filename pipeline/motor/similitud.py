"""Similitud por variable, dimensión, puertas y S de una celda frente a un objetivo y una misión (umbrales.json)."""
import warnings

import numpy as np

OK, NA, SD = 0, 1, 2
PASA, FALLADA, NO_EVAL_PUERTA, NO_EVAL_C = 0, 1, 2, 3
_TOL = 1e-9


def _vacio(x):
    x = np.asarray(x, dtype=float)
    return x, np.full(x.shape, np.nan), np.full(x.shape, SD, dtype=np.int8)


def var_T(x, xo, E, f):
    x, s, e = _vacio(x)
    log = f == "log10"
    if xo is None or not np.isfinite(xo) or (log and xo <= 0):
        return s, e
    ok = np.isfinite(x) & (x > 0) if log else np.isfinite(x)
    fx, fo = (np.log10(x[ok]), np.log10(xo)) if log else (x[ok], xo)
    s[ok] = 1.0 - np.minimum(1.0, np.abs(fx - fo) / E)
    e[ok] = OK
    return s, e


def var_U(x, a, b, inversa=False):
    x, s, e = _vacio(x)
    ok = np.isfinite(x)
    t = np.clip((x[ok] - a) / (b - a), 0.0, 1.0)
    s[ok] = 1.0 - t if inversa else t
    e[ok] = OK
    return s, e


def var_U_log_inversa(x, a, b):
    x, s, e = _vacio(x)
    ok = np.isfinite(x) & (x >= 0)
    with np.errstate(divide="ignore"):
        t = np.clip((np.log10(x[ok]) - np.log10(a)) / (np.log10(b) - np.log10(a)), 0.0, 1.0)
    s[ok] = 1.0 - t
    e[ok] = OK
    return s, e


def var_cociente(x, xo):
    x, s, e = _vacio(x)
    if xo is None or not np.isfinite(xo) or xo <= 0:
        return s, e
    ok = np.isfinite(x)
    s[ok] = np.clip(x[ok] / xo, 0.0, 1.0)
    e[ok] = OK
    return s, e


def var_clase(codigos, tabla, columna):
    codigos, s, e = _vacio(codigos)
    if columna not in tabla["columnas"]:
        return s, e
    for fila, lista in tabla["codigos_glim"].items():
        if not isinstance(lista, list) or fila == "sin_dato":
            continue
        m = np.isin(codigos, lista)
        if fila == "na":
            e[m] = NA
        else:
            s[m] = tabla["filas"][fila][columna]
            e[m] = OK
    return s, e


def _variable(u, d, v, objetivo, datos, rug, factores):
    dim = u["dimensiones"][d]
    spec = dim["variables"][v]
    obj = u["objetivos"][objetivo]
    k = (factores or {}).get(f"{d}.{v}", 1.0)
    tipo = spec["tipo"]
    citado = (obj.get("valores_citados") or {}).get(d) or {}
    if tipo == "C":
        tabla = u["tablas_clase"][spec["escala"].split(",")[0].split(".")[1]]
        s, e = var_clase(datos[v], tabla, obj["clase_litologia"])
    elif tipo in ("U", "U_inversa"):
        a, b = spec["a"], spec["b"]
        if a == 0:
            b = b * k
        s, e = var_U(datos[v], a, b, inversa=tipo == "U_inversa")
    elif tipo == "T":
        if "entrada_tierra" in spec:
            x = np.asarray(datos[spec["entrada_tierra"]], dtype=float) / dim["umbral_viento_2m"]["tierra_m_s"]
            xo = citado.get("R_objetivo")
        else:
            x = datos[v]
            xo = rug.get(objetivo) if str(dim.get("valor_objetivo", "")).endswith("rugosidad_objetivos.json") else None
        s, e = var_T(x, xo, spec["E"] * k, spec["f"])
    elif tipo == "U_cociente":
        xo = citado[v].get("valor_usado") if isinstance(citado.get(v), dict) else None
        s, e = var_cociente(datos[v], xo)
    elif tipo == "U_log_inversa":
        s, e = var_U_log_inversa(datos[v], spec["a_h"], spec["b_h"])
    else:
        raise ValueError(f"{d}.{v}: tipo {tipo} desconocido")
    est = datos.get(f"{v}_estado")
    if est is not None:
        est = np.asarray(est, dtype=float)
        e = np.where(est == 1, NA, np.where(est == 0, e, SD)).astype(np.int8)
        s = np.where(e == OK, s, np.nan)
    return s, e


def dimension(u, d, objetivo, datos, rug, factores=None):
    dim = u["dimensiones"][d]
    forma = np.shape(next(iter(datos.values())))
    if dim.get("luna") == "na" and u["objetivos"][objetivo]["cuerpo"] == "luna":
        return np.full(forma, np.nan), np.full(forma, NA, dtype=np.int8)
    combinacion = dim.get("combinacion", "media simple")
    if "por_objetivo" in dim:
        por = dim["por_objetivo"].get(objetivo)
        if por is None or por.get("variables") is None:
            return np.full(forma, np.nan), np.full(forma, SD, dtype=np.int8)
        variables = por["variables"]
        combinacion = por.get("combinacion", combinacion)
    else:
        variables = list(dim["variables"])
    ss, ee = zip(*(_variable(u, d, v, objetivo, datos, rug, factores) for v in variables))
    ss, ee = np.stack(ss), np.stack(ee)
    hay_sd = (ee == SD).any(axis=0)
    ok = ee == OK
    vals = np.where(ok, ss, np.nan)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        s = np.nanmin(vals, axis=0) if combinacion.startswith("mínimo") else np.nanmean(vals, axis=0)
    # todas na: solo D5 lunar tiene regla escrita; el resto (p. ej. D4 con aridez na fuera de arcadia) es null → sin_dato
    e = np.where(hay_sd | ~ok.any(axis=0), SD, OK).astype(np.int8)
    return np.where(e == OK, s, np.nan), e


def puertas(u, mision, datos):
    forma = np.shape(next(iter(datos.values())))
    fall = np.zeros(forma, dtype=np.uint8)
    sd = np.zeros(forma, dtype=np.uint8)
    for i, p in enumerate(u["misiones"][mision]["puertas"]):
        x = np.asarray(datos[p["variable"]], dtype=float)
        est = datos.get(f"{p['variable']}_estado")
        na = np.zeros(forma, dtype=bool) if est is None else np.asarray(est, dtype=float) == 1
        sin = ~np.isfinite(x) & ~na
        if est is not None:
            sin |= ~np.isin(np.asarray(est, dtype=float), (0, 1))
        pasa_na = p.get("si_na_por_frio") == "pasa"
        if not pasa_na:
            sin |= na
        if p["condicion"] == "<=":
            cumple = x <= p["umbral"]
        elif p["condicion"] == ">=":
            cumple = x >= p["umbral"]
        else:
            raise ValueError(p["condicion"])
        cumple = cumple | (na & pasa_na)
        falla = ~sin & ~cumple
        fall |= (falla.astype(np.uint8) << i)
        sd |= (sin.astype(np.uint8) << i)
    return fall, sd


def agrega(s, e, pesos, suelo):
    C = sum(w * (np.asarray(e[d]) == OK) for d, w in pesos.items())
    num = sum(w * np.where(np.asarray(e[d]) == OK, np.log(np.maximum(np.nan_to_num(s[d], nan=1.0), suelo)), 0.0)
              for d, w in pesos.items())
    with np.errstate(invalid="ignore", divide="ignore"):
        S = np.where(C > 0, np.exp(num / np.where(C > 0, C, 1.0)), np.nan)
    return S, C


def evalua_par(u, objetivo, mision, datos, rug, factores=None, pesos=None, s_dims=None):
    m = u["misiones"][mision]
    pesos = pesos or m["pesos"]
    if s_dims is None:
        s_dims = {d: dimension(u, d, objetivo, datos, rug, factores) for d in m["pesos"]}
    s = {d: v[0] for d, v in s_dims.items()}
    e = {d: v[1] for d, v in s_dims.items()}
    fall, sd = puertas(u, mision, datos)
    S_libre, C = agrega(s, e, pesos, u["agregacion"]["suelo_similitud"])
    c_ok = C >= u["agregacion"]["cobertura_minima"] - _TOL
    estado = np.where(fall > 0, FALLADA, np.where(sd > 0, NO_EVAL_PUERTA, np.where(c_ok, PASA, NO_EVAL_C))).astype(np.int8)
    S = np.where(estado == PASA, S_libre, np.where(estado == FALLADA, 0.0, np.nan))
    return {"S": S, "S_libre": np.where(c_ok, S_libre, np.nan), "C": C, "estado": estado,
            "fall": fall, "sd": sd, "s": s, "e": e}
