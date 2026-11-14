"""python -m pipeline.validacion --motivo "...": build/puntos_*.nc + malla → build/informe_validacion.json (y apunta la corrida)."""
import argparse
import json
import os
from pathlib import Path

import xarray as xr

from pipeline.malla import salida
from pipeline.motor import puntos
from pipeline.motor import umbrales as um
from pipeline.validacion import informe as inf

BUILD = um.RAIZ / "build"
DECISIONES = [
    "Puertas con lógica de Kleene: si una puerta falla, la celda falla (S = 0) aunque otra puerta no tenga dato.",
    "Dimensión con alguna variable sin_dato → sin_dato; variable na se quita de la media; dimensión toda na → sin_dato salvo D5 lunar (única regla na escrita; D4 con aridez na fuera de arcadia es null).",
    "C = suma de pesos de las dimensiones con estado ok (na no cuenta como dato).",
    "Monte Carlo: E × factor en escalas T y b × factor en saturaciones con a = 0; soc (1-20 g/kg) y tiempo a ciudad (2-48 h) no se perturban porque umbrales.json no dice cómo aplicar el factor a (a, b) con a ≠ 0; D9 no figura en afecta_a. La evaluabilidad (puertas y C) es la de la corrida central.",
    "Percentiles de cada celda sobre réplicas: sin peso (todas las réplicas de una celda tienen la misma latitud). Peso cos(lat) en todos los percentiles por área.",
    "Top por área: el sitio cuenta dentro si el área con valor ≥ el suyo (incluido su grupo de empate) es ≤ al corte.",
    "Sitios de meridiani (Death Valley, Dalangtan): no evaluables en H1 y H1-S por cierres.sin_resolver; su s de D1 se da como informativo y no cuenta.",
    "k₀: AI menor = mejor; celdas con aridez na o sin_dato fuera del orden de k₀ y sitio no evaluable en k₀.",
    "H3: puesto = fracción del área con S sin puertas ≥ la del sitio; empate o no evaluable = no acierto. Jaccard sobre S sin puertas, top 1000 celdas incluyendo empates en el corte.",
    "Tierra forzada en las 11 celdas de validación (20 §7). Base del denominador: tierra al norte de −60° más la celda de McMurdo.",
    "Valor a mano aplicado: permafrost_frac = 1,0 en la celda de McMurdo. Bockfjorden: null en umbrales.json → se usa la malla.",
]
SIN_VERIFICAR = [
    "H2 no se calcula aquí (revisión a mano de imágenes y literatura).",
    "pieza_ensayable_aqui (20 % de §16) no se calcula aquí; sale de s_* y c_*.",
    "Error del dato no perturbado en Monte Carlo (cierre n.º 4).",
]


def _atomico_json(ruta, d):
    tmp = ruta.with_name(f".{ruta.name}.tmp")
    tmp.write_text(json.dumps(d, ensure_ascii=False, indent=1, allow_nan=False) + "\n", encoding="utf-8")
    os.replace(tmp, ruta)


def corre(build=BUILD, motivo="", cambios="", rug_ruta=um.RUTA_RUGOSIDAD):
    u, sha = um.carga()
    build = Path(build)
    indice = json.loads((build / "puntos_indice.json").read_text(encoding="utf-8"))
    malla = (build / "malla_actual.txt").read_text().strip()
    if indice["umbrales_sha256"] != sha or indice["malla"] != malla:
        raise RuntimeError("puntos de otra malla u otros umbrales: correr antes python -m pipeline.motor")
    vars_, _ = salida.lee_actual(build)
    datos = {k: v[0].astype(float) for k, v in vars_.items()}
    puntos.aplica_valores_a_mano(u, datos)
    tierra, base = puntos.mascaras(u, datos)
    rug = um.rugosidad_objetivos(rug_ruta)
    ds = {}
    for p in indice["pares"]:
        with xr.open_dataset(build / p["fichero"]) as d:
            ds[p["id"]] = d.load()
    ruta_c = build / "corridas.json"
    corridas = json.loads(ruta_c.read_text(encoding="utf-8")) if ruta_c.exists() else []
    corridas.append({"n": len(corridas) + 1, "malla": malla, "umbrales_sha256": sha,
                     "mc_n": indice["mc_n"], "motivo": motivo, "que_cambio": cambios})
    _atomico_json(ruta_c, corridas)
    r_h1 = inf.h1(u, datos, base, rug)
    r_h1s = inf.h1_s(u, ds, indice["pares_fuera"], base)
    r_h3 = inf.h3(u, ds, base)
    no_eval = ([{"prueba": "H1", "sitio": f["id"], "motivo": f["motivo"]} for f in r_h1["sitios"] if f["dentro"] is None]
               + [{"prueba": "k0", "sitio": k, "motivo": v["motivo"]} for k, v in r_h1["k0_sitios"].items() if v["dentro"] is None]
               + [{"prueba": "H1-S", "sitio": f["id"], "motivo": f["motivo"]} for f in r_h1s["sitios"] if f["dentro"] is None]
               + [{"prueba": "H3", "sitio": f["sitio"], "n": f["n"], "motivo": f["motivo"]} for f in r_h3["predicciones"] if f["motivo"]])
    informe = {
        "malla": malla, "umbrales_sha256": sha, "mc_n": indice["mc_n"],
        "corrida_oficial": u["validacion"]["corrida_oficial"], "corridas": corridas,
        "cifra_del_video": u["validacion"]["cifra_del_video"],
        "h1": r_h1, "h1_s": r_h1s, "h3": r_h3,
        "controles": inf.controles(u, ds, base),
        "descriptivo_polar": inf.descriptivo_polar(u, ds, base, inf.sitios_ensayo()),
        "denominadores": inf.denominadores(u, datos, tierra, base),
        "no_evaluables": no_eval, "valores_a_mano": indice["valores_a_mano"], "pares_fuera": indice["pares_fuera"],
        "decisiones": DECISIONES, "sin_verificar": SIN_VERIFICAR,
    }
    _atomico_json(build / "informe_validacion.json", informe)
    return informe


def main(argv=None):
    ap = argparse.ArgumentParser(prog="python -m pipeline.validacion", description=__doc__)
    ap.add_argument("--build", type=Path, default=BUILD)
    ap.add_argument("--motivo", required=True)
    ap.add_argument("--cambios", default="")
    a = ap.parse_args(argv)
    r = corre(a.build, a.motivo, a.cambios)
    print(json.dumps({"k": r["h1"]["k"], "k0": r["h1"]["k0"], "veredicto_h1": r["h1"]["veredicto"],
                      "h1_s": r["h1_s"]["n_dentro"], "h3": r["h3"]["aciertos"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
