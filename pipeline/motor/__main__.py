"""python -m pipeline.motor: build/malla actual + umbrales.json → build/puntos_<obj>_<mis>.nc y build/puntos_indice.json."""
import argparse
import json
import os
import time
from pathlib import Path

from pipeline.malla import salida
from pipeline.motor import puntos
from pipeline.motor import umbrales as um

BUILD = um.RAIZ / "build"


def corre(build=BUILD, n_mc=None, rug_ruta=um.RUTA_RUGOSIDAD):
    u, sha = um.carga()
    build = Path(build)
    vars_, version = salida.lee_actual(build)
    if not vars_:
        raise FileNotFoundError(f"sin malla en {build}")
    malla = (build / "malla_actual.txt").read_text().strip()
    datos = {k: v[0].astype(float) for k, v in vars_.items()}
    registro = puntos.aplica_valores_a_mano(u, datos)
    tierra, base = puntos.mascaras(u, datos)
    rug = um.rugosidad_objetivos(rug_ruta)
    n_mc = n_mc or u["monte_carlo"]["n"]
    pares, fuera = puntos.pares_a_calcular(u)
    indice = {"malla": malla,
              "umbrales_sha256": sha, "mc_n": n_mc, "valores_a_mano": registro, "pares": [], "pares_fuera": fuera}
    for p in pares:
        t0 = time.time()
        sem = puntos.semilla_de(sha, p["objetivo"], p["mision"])
        ds = puntos.calcula_par(u, sha, p["objetivo"], p["mision"], datos, tierra, base, rug, n_mc, sem, malla)
        f = puntos.escribe(ds, build / f"puntos_{p['objetivo']}_{p['mision']}.nc")
        dt = time.time() - t0
        indice["pares"].append({**p, "id": f"{p['objetivo']}_{p['mision']}", "fichero": f.name, "segundos": round(dt, 1)})
        print(f"{f} ({dt:.1f} s)", flush=True)
    tmp = build / ".puntos_indice.json.tmp"
    tmp.write_text(json.dumps(indice, ensure_ascii=False, indent=1), encoding="utf-8")
    os.replace(tmp, build / "puntos_indice.json")
    return indice


def main(argv=None):
    ap = argparse.ArgumentParser(prog="python -m pipeline.motor", description=__doc__)
    ap.add_argument("--build", type=Path, default=BUILD)
    ap.add_argument("--n", type=int, default=None, help="réplicas de Monte Carlo (por defecto, umbrales.json)")
    a = ap.parse_args(argv)
    corre(a.build, a.n)


if __name__ == "__main__":
    main()
