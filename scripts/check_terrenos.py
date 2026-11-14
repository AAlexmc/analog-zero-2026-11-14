"""Cada terreno de web/data/terreno cumple docs/contrato-terreno.md."""
import json, math, sys
from pathlib import Path

raiz = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / "web" / "data" / "terreno"
AGUA = {"0": "no water", "1": "ocean", "2": "lake", "3": "river"}
TAM = {"float32": 4, "uint8": 1}
errores = []
for meta_p in sorted(raiz.glob("*/meta.json")):
    d = meta_p.parent
    m = json.loads(meta_p.read_text())
    def err(msg):
        errores.append(f"{d.name}: {msg}")
    for k in ("id", "cuerpo", "nombre", "centro", "lado_km", "n", "m_por_px", "z_min", "z_max", "georef", "capas"):
        if k not in m:
            err(f"falta '{k}'")
    if errores and errores[-1].startswith(d.name):
        continue
    if m["id"] != d.name:
        err("id distinto del nombre de carpeta")
    if m["cuerpo"] not in ("luna", "tierra", "marte"):
        err("cuerpo desconocido")
    n = m["n"]
    if not math.isclose(m["m_por_px"] * n, m["lado_km"] * 1000, rel_tol=1e-3):
        err("m_por_px * n != lado_km")
    if "altura" not in m["capas"]:
        err("sin capa altura")
    for nombre, c in m["capas"].items():
        f = d / c["fichero"]
        if c.get("tipo") not in TAM:
            err(f"capa {nombre}: tipo desconocido")
        elif not f.exists():
            err(f"capa {nombre}: no existe {c['fichero']}")
        elif f.stat().st_size != n * n * TAM[c["tipo"]]:
            err(f"capa {nombre}: tamaño {f.stat().st_size} != {n*n*TAM[c['tipo']]}")
        if not c.get("fuente"):
            err(f"capa {nombre}: sin fuente")
    if "agua" in m["capas"]:
        c = m["capas"]["agua"]
        f = d / c["fichero"]
        if m["cuerpo"] != "tierra":
            err("capa agua: solo en la tierra")
        if c.get("tipo") != "uint8":
            err("capa agua: tipo debe ser uint8")
        elif f.exists() and f.stat().st_size == n * n:
            raros = sorted(set(f.read_bytes()) - {0, 1, 2, 3, 255})
            if raros:
                err(f"capa agua: valores fuera de 0-3/255: {raros[:5]}")
        if c.get("clases") != AGUA:
            err(f"capa agua: clases != {AGUA}")
idx = raiz / "index.json"
if idx.exists():
    for t in json.loads(idx.read_text()).get("terrenos", []):
        if not (raiz / t["id"] / "meta.json").exists():
            errores.append(f"index.json: falta terreno {t['id']}")
for e in errores:
    print("TERRENO:", e)
sys.exit(1 if errores else 0)
