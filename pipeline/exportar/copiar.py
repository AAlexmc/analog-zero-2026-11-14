"""Copia datos_json/*.json a web/data/ con escritura atómica. Solo el pipeline escribe web/data/."""
import argparse
import json
import os
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]


def _atomico(p, datos):
    tmp = p.with_name(p.name + ".tmp")
    with open(tmp, "wb") as f:
        f.write(datos)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, p)


def exportar(origen=RAIZ / "datos_json", destino=RAIZ / "web" / "data"):
    origen, destino = Path(origen), Path(destino)
    if not origen.is_dir():
        raise FileNotFoundError(f"no existe {origen}")
    ficheros = sorted(origen.glob("*.json"))
    cuerpos = []
    for f in ficheros:
        b = f.read_bytes()
        try:
            json.loads(b.decode("utf-8"))
        except ValueError as e:
            raise ValueError(f"{f.name}: JSON inválido ({e})") from e
        cuerpos.append(b)
    destino.mkdir(parents=True, exist_ok=True)
    escritos = []
    for f, b in zip(ficheros, cuerpos):
        _atomico(destino / f.name, b)
        escritos.append(destino / f.name)
    return escritos


def main(argv=None):
    ap = argparse.ArgumentParser(prog="python -m pipeline.exportar", description=__doc__)
    ap.add_argument("--origen", type=Path, default=RAIZ / "datos_json")
    ap.add_argument("--destino", type=Path, default=RAIZ / "web" / "data")
    a = ap.parse_args(argv)
    for p in exportar(a.origen, a.destino):
        print(p)
