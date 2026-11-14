"""Carga umbrales.json solo si su sha256 coincide con umbrales.sha256."""
import hashlib
import json
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
RUTA = RAIZ / "umbrales.json"
RUTA_HASH = RAIZ / "umbrales.sha256"
RUTA_RUGOSIDAD = RAIZ / "build" / "rugosidad_objetivos.json"


class HashNoCoincide(RuntimeError):
    pass


def carga(ruta=RUTA, ruta_hash=RUTA_HASH):
    datos = Path(ruta).read_bytes()
    h = hashlib.sha256(datos).hexdigest()
    esperado = Path(ruta_hash).read_text().split()[0]
    if h != esperado:
        raise HashNoCoincide(f"{ruta}: sha256 {h} ≠ {esperado} de {ruta_hash}; no se corre")
    return json.loads(datos.decode("utf-8")), h


def rugosidad_objetivos(ruta=RUTA_RUGOSIDAD):
    d = json.loads(Path(ruta).read_text(encoding="utf-8"))["objetivos"]
    return {k: (float(v["rugosidad_tan"]) if v.get("estado") == "ok" and v.get("rugosidad_tan") is not None else None)
            for k, v in d.items()}
