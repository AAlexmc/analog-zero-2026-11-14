"""Comprobación cruzada de recorridos: el módulo JS del visor (web/terreno/rutas.js, ejecutado con Node) contra scikit-image.

Uso: python scripts/validar_rutas.py
Escribe web/data/validacion_rutas.json (escritura atómica). Sale con 1 si el coste con la misma definición difiere > 1e-6 relativo.

Protocolo, fijado antes de correr:
- Terreno shackleton real, alturas sin retocar; vehículo LTV con su límite de pendiente del catálogo.
- Pendiente de celda y máscara transitable: las del módulo JS (se comprueba aparte que numpy da la misma pendiente).
- Pares: P0 = celda transitable más iluminada del borde de Shackleton (anillo 0,9-1,1 × radio del cráter);
  Q1..Q4 = celda transitable más cercana al centro de cada cuadrante. Pares P0→Q1..Q4 y Q1→Q4.
  Cada par con factor de sombra permanente 1 (por defecto) y 3.
- Misma definición: coste de un paso = sqrt((L·m)² + Δh²) × (w_a + w_b)/2, L = 1 o √2, w = factor si sombra_permanente = 1.
  skimage.graph.MCP_Flexible con travel_cost sobrescrito con esa fórmula (mismo motor MCP de scikit-image).
- Referencia: skimage.graph.MCP_Geometric, que solo admite coste por celda promediado: c = m·w/cos(pendiente de celda).
  Definición distinta a propósito (isótropa frente a Δh del paso); su diferencia se publica, no se ajusta.
"""
import hashlib
import json
import math
import os
import subprocess
import sys
import time
from pathlib import Path

import numpy as np
from skimage.graph import MCP_Flexible, MCP_Geometric

RAIZ = Path(__file__).resolve().parent.parent
TERRENO = RAIZ / "web" / "data" / "terreno" / "shackleton"
RUTAS_JS = RAIZ / "web" / "terreno" / "rutas.js"
SALIDA = RAIZ / "web" / "data" / "validacion_rutas.json"
TRABAJO = RAIZ / "build" / "validacion_rutas"
FACTORES = [1.0, 3.0]
TOL = 1e-6
GRANDE = 1e7  # separa la marca de sombra de la altura dentro del valor de coste de MCP_Flexible

NODE_PEND = """
import { readFileSync, writeFileSync } from 'node:fs';
import { pendientes } from %(url)s;
const c = JSON.parse(readFileSync(0, 'utf8'));
const b = readFileSync(c.altura);
const a = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
writeFileSync(c.salida, Buffer.from(pendientes(a, c.n, c.m).buffer));
"""

NODE_RUTAS = """
import { readFileSync } from 'node:fs';
import { pendientes, caminoMinimo } from %(url)s;
const c = JSON.parse(readFileSync(0, 'utf8'));
const f32 = (p) => { const b = readFileSync(p); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
const alturas = f32(c.altura), pend = f32(c.pend);
const u8 = readFileSync(c.sombra), sombra = Float32Array.from(u8, (x) => (x === 255 ? NaN : x));
const t = { n: c.n, m: c.m, alturas, pend, sombra };
const out = c.pares.map((p) => {
  const t0 = performance.now();
  const r = caminoMinimo(t, p.o, p.d, { limite: c.limite, factorSombra: p.factor });
  return { coste: Number.isFinite(r.coste) ? r.coste : null, celdas: r.camino ? r.camino.length : 0, ms: performance.now() - t0 };
});
process.stdout.write(JSON.stringify(out));
"""


def node(codigo, entrada):
    r = subprocess.run(["node", "--input-type=module", "-e", codigo % {"url": json.dumps(RUTAS_JS.as_uri())}],
                       input=json.dumps(entrada), capture_output=True, text=True, check=False)
    if r.returncode != 0:
        sys.exit(f"node falló: {r.stderr}")
    return r.stdout


def sha256(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


def pendiente_numpy(a, m):
    """Misma diferencia del visor (calculo.js): centrada si hay dos vecinos, lateral en el borde."""
    gx = np.full(a.shape, np.nan)
    gy = np.full(a.shape, np.nan)
    gx[:, 1:-1] = (a[:, 2:] - a[:, :-2]) / (2 * m)
    gx[:, 0] = (a[:, 1] - a[:, 0]) / m
    gx[:, -1] = (a[:, -1] - a[:, -2]) / m
    gy[1:-1, :] = (a[2:, :] - a[:-2, :]) / (2 * m)
    gy[0, :] = (a[1, :] - a[0, :]) / m
    gy[-1, :] = (a[-1, :] - a[-2, :]) / m
    return np.degrees(np.arctan(np.hypot(gx, gy)))


class PasoTresD(MCP_Flexible):
    def __init__(self, costes, m, factor):
        super().__init__(costes, fully_connected=True)
        self.m = m
        self.factor = factor

    def travel_cost(self, old_cost, new_cost, offset_length):
        so, sn = old_cost >= GRANDE, new_cost >= GRANDE
        dh = (new_cost - GRANDE * sn) - (old_cost - GRANDE * so)
        L = offset_length * self.m
        w = ((self.factor if so else 1.0) + (self.factor if sn else 1.0)) / 2
        return math.sqrt(L * L + dh * dh) * w


def control_minimo():
    """Antes de lo real: 1×3 plano a 10 m/px → 20 m; rampa de 4 m por celda a 3 m/px → 2 × 5 m.
    MCP_Flexible arranca con el valor de la celda de origen (comprobado): se resta."""
    c = np.full((1, 3), 1.0)
    cum, _ = PasoTresD(c, 10.0, 1.0).find_costs([(0, 0)], [(0, 2)])
    assert abs(cum[0, 2] - c[0, 0] - 20) < 1e-12, cum
    c = np.array([[1.0, 5.0, 9.0]])
    cum, _ = PasoTresD(c, 3.0, 1.0).find_costs([(0, 0)], [(0, 2)])
    assert abs(cum[0, 2] - c[0, 0] - 10) < 1e-12, cum
    cum, _ = MCP_Geometric(np.full((1, 3), 5.0)).find_costs([(0, 0)], [(0, 2)])
    assert abs(cum[0, 2] - 10) < 1e-12, cum


def principal():
    control_minimo()
    TRABAJO.mkdir(parents=True, exist_ok=True)
    meta = json.loads((TERRENO / "meta.json").read_text())
    cat = json.loads((RAIZ / "web" / "data" / "equipo.json").read_text())
    ltv = next(q for q in cat["equipos"] if q["id"] == "ltv")
    req = next(r for r in ltv["requisitos"] if r["variable"] == "pendiente_deg")
    limite = float(req["valor"])
    n, m = meta["n"], float(meta["m_por_px"])
    alt = np.fromfile(TERRENO / "altura.f32", dtype="<f4").reshape(n, n)
    ilu = np.fromfile(TERRENO / "iluminacion.f32", dtype="<f4").reshape(n, n)
    psr = np.fromfile(TERRENO / "sombra_permanente.u8", dtype=np.uint8).reshape(n, n)

    ruta_pend = TRABAJO / "pend_js.f32"
    node(NODE_PEND, {"altura": str(TERRENO / "altura.f32"), "salida": str(ruta_pend), "n": n, "m": m})
    pend = np.fromfile(ruta_pend, dtype="<f4").reshape(n, n)
    pend_np = pendiente_numpy(alt.astype(np.float64), m)
    dif_pend = float(np.nanmax(np.abs(pend_np - pend)))
    pasa = np.isfinite(alt) & (pend <= limite)
    pasa_np = np.isfinite(alt) & (pend_np <= limite)

    # Centro del cráter en la rejilla: estereográfica polar sur (docs/contrato-terreno.md).
    g = meta["georef"]
    rasgo = next(r for r in meta["rasgos"] if r["nombre"] == "Shackleton")
    R = g["radio_m"]
    cc = math.radians(rasgo["lat"] + 90)
    rho = 2 * R * math.tan(cc / 2)
    x, y = rho * math.sin(math.radians(rasgo["lon"])), rho * math.cos(math.radians(rasgo["lon"]))
    f0, c0 = (g["y0_m"] - y) / m, (x - g["x0_m"]) / m
    ff, cc_ = np.mgrid[0:n, 0:n]
    r_km = np.hypot(ff - f0, cc_ - c0) * m / 1000
    radio_km = rasgo["diametro_km"] / 2
    anillo = pasa & (r_km >= 0.9 * radio_km) & (r_km <= 1.1 * radio_km) & np.isfinite(ilu)
    p0 = np.unravel_index(np.argmax(np.where(anillo, ilu, -1)), (n, n))

    def mas_cercana(f, c):
        d = np.where(pasa, np.hypot(ff - f, cc_ - c), np.inf)
        return np.unravel_index(np.argmin(d), (n, n))

    q = [mas_cercana(n / 4, n / 4), mas_cercana(n / 4, 3 * n / 4), mas_cercana(3 * n / 4, n / 4), mas_cercana(3 * n / 4, 3 * n / 4)]
    nombres = ["P0 rim → Q1 NW", "P0 rim → Q2 NE", "P0 rim → Q3 SW", "P0 rim → Q4 SE", "Q1 NW → Q4 SE"]
    pares = [(p0, q[0]), (p0, q[1]), (p0, q[2]), (p0, q[3]), (q[0], q[3])]

    lista = [{"o": int(o[0] * n + o[1]), "d": int(d[0] * n + d[1]), "factor": fa} for fa in FACTORES for (o, d) in pares]
    js = json.loads(node(NODE_RUTAS, {"altura": str(TERRENO / "altura.f32"), "pend": str(ruta_pend), "sombra": str(TERRENO / "sombra_permanente.u8"),
                                      "n": n, "m": m, "limite": limite, "pares": lista}))

    base = alt.astype(np.float64) - float(np.nanmin(alt)) + 1.0
    filas = []
    k = 0
    for fa in FACTORES:
        flex = np.where(pasa, base + GRANDE * (psr == 1), np.inf)
        w = np.where(psr == 1, fa, 1.0)
        geo = np.where(pasa, m * w / np.cos(np.radians(pend.astype(np.float64))), np.inf)
        cache = {}
        for (o, d), nombre in zip(pares, nombres):
            fin = [dd for (oo, dd) in pares if oo == o]
            if o not in cache:
                t0 = time.time()
                cum_f, _ = PasoTresD(flex, m, fa).find_costs([o], fin)
                t_flex = time.time() - t0
                cum_g, _ = MCP_Geometric(geo, fully_connected=True).find_costs([o], fin)
                cache[o] = (cum_f, cum_g, t_flex)
            cum_f, cum_g, t_flex = cache[o]
            cj = js[k]["coste"]
            cf, cg = float(cum_f[d] - flex[o]), float(cum_g[d])
            cf = cf if math.isfinite(cf) else None
            cg = cg if math.isfinite(cg) else None
            rel = (abs(cj - cf) / cf) if (cj is not None and cf) else (0.0 if cj is None and cf is None else None)
            relg = (abs(cj - cg) / cg) if (cj is not None and cg) else None
            filas.append({
                "par": nombre, "factor_sombra": fa,
                "origen_fila_col": [int(o[0]), int(o[1])], "destino_fila_col": [int(d[0]), int(d[1])],
                "coste_js_m": cj, "coste_skimage_mismo_coste_m": cf, "dif_rel": rel,
                "coste_skimage_geometric_m": cg, "dif_rel_geometric": relg,
                "celdas_ruta_js": js[k]["celdas"], "ms_js": round(js[k]["ms"], 1), "s_skimage_flexible": round(t_flex, 1),
            })
            k += 1
    difs = [f["dif_rel"] for f in filas]
    max_rel = None if any(x is None for x in difs) else max(difs)
    max_geo = max((f["dif_rel_geometric"] for f in filas if f["dif_rel_geometric"] is not None), default=None)
    salida = {
        "comando": "python scripts/validar_rutas.py",
        "terreno": "shackleton", "n": n, "m_por_px": m,
        "altura_sha256": sha256(TERRENO / "altura.f32"), "rutas_js_sha256": sha256(RUTAS_JS),
        "vehiculo": "ltv", "limite_pendiente_deg": limite, "limite_fuente": req["fuente"],
        "definicion_coste": "step = sqrt((L*m)^2 + dh^2) * (w_a + w_b)/2, L = 1 or sqrt(2), w = shadow factor on permanent-shadow cells else 1; cell passable if finite and cell slope <= limit",
        "metodo_referencia": "skimage.graph.MCP_Flexible with travel_cost overridden by the same step formula (scikit-image %s)" % __import__("skimage").__version__,
        "pendiente_numpy_vs_js_max_abs_deg": dif_pend,
        "celdas_transitables_distintas_numpy_vs_js": int(np.count_nonzero(pasa != pasa_np)),
        "pares": filas,
        "max_dif_rel": max_rel,
        "max_dif_rel_geometric": max_geo,
        "nota_geometric": "MCP_Geometric only takes a per-cell cost averaged over the two cells of a step; here c = m*w/cos(cell slope). That is the isotropic surface stretch, not the Δh of the step, so it overestimates steps along contours: a known difference of definition, published as is.",
    }
    tmp = SALIDA.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(salida, indent=1, ensure_ascii=False))
    os.replace(tmp, SALIDA)
    for f in filas:
        print(f"{f['par']:16s} ×{f['factor_sombra']:.0f}  js {f['coste_js_m']}  skimage {f['coste_skimage_mismo_coste_m']}  rel {f['dif_rel']}  geometric rel {f['dif_rel_geometric']}")
    print(f"slope numpy vs js: max {dif_pend:.2e}°, passable cells differing {salida['celdas_transitables_distintas_numpy_vs_js']}")
    print(f"max_dif_rel {max_rel}  max_dif_rel_geometric {max_geo}")
    return 0 if (max_rel is not None and max_rel <= TOL) else 1


if __name__ == "__main__":
    sys.exit(principal())
