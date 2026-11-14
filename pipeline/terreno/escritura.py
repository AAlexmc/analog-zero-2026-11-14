"""Escritura atómica (temporal + rename) de terrenos según docs/contrato-terreno.md."""
import json
import os
from pathlib import Path

import numpy as np

TIPOS = {"float32": "<f4", "uint8": "u1"}


def _atomico(p, datos):
    p = Path(p)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_name(p.name + ".tmp")
    with open(tmp, "wb") as f:
        f.write(datos)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, p)


def escribir_capa(p, a):
    a = np.asarray(a)
    tipo = "uint8" if a.dtype == np.uint8 else "float32"
    _atomico(p, np.ascontiguousarray(a, dtype=TIPOS[tipo]).tobytes())
    return tipo


def escribir_json(p, d):
    _atomico(p, (json.dumps(d, ensure_ascii=False, indent=1) + "\n").encode())


def rango(a):
    return float(np.nanmin(a)), float(np.nanmax(a))


def actualizar_index(raiz, entrada, pareja_inicial):
    p = Path(raiz) / "index.json"
    d = json.loads(p.read_text()) if p.exists() else {"terrenos": []}
    ts = d["terrenos"]
    i = next((k for k, t in enumerate(ts) if t["id"] == entrada["id"]), None)
    if i is None:
        ts.append(entrada)
    else:
        ts[i] = entrada
    d["pareja_inicial"] = pareja_inicial
    escribir_json(p, d)
