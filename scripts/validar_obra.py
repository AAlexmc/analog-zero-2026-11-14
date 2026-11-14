"""Optimalidad de la rasante de web/terreno/obra.js (ejecutado con Node) contra un programa lineal (scipy linprog, HiGHS).

Uso: python scripts/validar_obra.py
Sale con 0 solo si en todos los perfiles: el perfil (s, z) de obra.js coincide con el recalculado aquí, la rasante cumple
la pendiente (1e-9) y los anclajes, y su volumen V_js cumple óptimo·(1 − 1e-6) ≤ V_js ≤ óptimo·(1 + 1e-6).

Protocolo, fijado antes de correr:
- Alturas reales sin retocar de shackleton y haughton (altura.f32). Trazas rectas (fila, columna, diagonal) y una ruta de
  caminoMinimo (rutas.js) sobre shackleton.
- Mismo problema en los dos lados: min Σ wᵢ·|zpᵢ − zᵢ| con |zpᵢ₊₁ − zpᵢ| ≤ tan(límite)·Δsᵢ, wᵢ = pesos del trapecio.
  LP: variables zp y e ≥ |zp − z|; anclar = cota fija en los límites de la variable.
- V = Σ wᵢ·|zpᵢ − zᵢ| (m³ por metro de anchura) evaluado aquí con numpy para las dos rasantes.
"""
import json
import math
import subprocess
import sys
import time
from pathlib import Path

import numpy as np
from scipy.optimize import linprog
from scipy.sparse import coo_matrix

RAIZ = Path(__file__).resolve().parent.parent
TERRENOS = RAIZ / "web" / "data" / "terreno"
OBRA_JS = RAIZ / "web" / "terreno" / "obra.js"
RUTAS_JS = RAIZ / "web" / "terreno" / "rutas.js"
TOL_PEND = 1e-9
TOL_ABAJO = 1e-6
TOL_ARRIBA = 1e-6

NODE = """
import { readFileSync } from 'node:fs';
import { perfil, rasante } from %(obra)s;
import { caminoMinimo } from %(rutas)s;
const c = JSON.parse(readFileSync(0, 'utf8'));
const b = readFileSync(c.altura);
const alturas = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
const t = { n: c.n, m: c.m, alturas };
let camino = c.camino;
if (c.ruta) {
  const r = caminoMinimo(t, c.ruta.o, c.ruta.d, { limite: c.ruta.limite });
  if (!r.camino) { console.error('no route'); process.exit(3); }
  camino = Array.from(r.camino);
}
const p = perfil(t, camino);
const t0 = performance.now();
const r = rasante(p.s, p.z, c.limite, c.opc);
const ms = performance.now() - t0;
process.stdout.write(JSON.stringify({ camino, s: Array.from(p.s), z: Array.from(p.z), factible: r.factible, zp: r.zp ? Array.from(r.zp) : null, motivo: r.motivo, ms }));
"""


def node(entrada):
    codigo = NODE % {"obra": json.dumps(OBRA_JS.as_uri()), "rutas": json.dumps(RUTAS_JS.as_uri())}
    r = subprocess.run(["node", "--input-type=module", "-e", codigo], input=json.dumps(entrada),
                       capture_output=True, text=True, check=False)
    if r.returncode != 0:
        sys.exit(f"node falló ({r.returncode}): {r.stderr}")
    return json.loads(r.stdout)


def pesos(s):
    ds = np.diff(s)
    w = np.zeros_like(s)
    w[:-1] += ds / 2
    w[1:] += ds / 2
    return w


def lp(s, z, limite, ini, fin):
    N = len(s)
    c = math.tan(math.radians(limite)) * np.diff(s)
    w = pesos(s)
    # x = [zp_0..zp_{N-1}, e_0..e_{N-1}]
    filas, cols, vals, b = [], [], [], []
    fila = 0
    for i in range(N):
        filas += [fila, fila]; cols += [i, N + i]; vals += [1.0, -1.0]; b.append(z[i]); fila += 1
        filas += [fila, fila]; cols += [i, N + i]; vals += [-1.0, -1.0]; b.append(-z[i]); fila += 1
    for i in range(N - 1):
        filas += [fila, fila]; cols += [i + 1, i]; vals += [1.0, -1.0]; b.append(c[i]); fila += 1
        filas += [fila, fila]; cols += [i, i + 1]; vals += [1.0, -1.0]; b.append(c[i]); fila += 1
    A = coo_matrix((vals, (filas, cols)), shape=(fila, 2 * N)).tocsr()
    lim = [(None, None)] * N + [(0, None)] * N
    if ini:
        lim[0] = (z[0], z[0])
    if fin:
        lim[N - 1] = (z[N - 1], z[N - 1])
    obj = np.concatenate([np.zeros(N), w])
    t0 = time.perf_counter()
    r = linprog(obj, A_ub=A, b_ub=np.array(b), bounds=lim, method="highs")
    ms = (time.perf_counter() - t0) * 1000
    return r, ms


def perfil_py(a, n, m, camino):
    camino = np.asarray(camino)
    f, col = camino // n, camino % n
    ds = np.hypot(np.diff(f), np.diff(col)) * m
    return np.concatenate([[0.0], np.cumsum(ds)]), a[camino].astype(np.float64)


def recta(n, f0, c0, f1, c1):
    k = max(abs(f1 - f0), abs(c1 - c0))
    return [(f0 + (f1 - f0) * j // k) * n + (c0 + (c1 - c0) * j // k) for j in range(k + 1)]


def main():
    casos = [
        ("shackleton", "row 512, cols 200-800", {"camino": ("recta", 512, 200, 512, 800)}, 10, {}),
        ("shackleton", "col 300, rows 100-900", {"camino": ("recta", 100, 300, 900, 300)}, 5, {}),
        ("shackleton", "diagonal 150-850", {"camino": ("recta", 150, 150, 850, 850)}, 15, {}),
        ("shackleton", "row 512, start anchored", {"camino": ("recta", 512, 200, 512, 800)}, 10, {"anclarInicio": True}),
        ("shackleton", "caminoMinimo route (20°)", {"ruta": {"o": 100 * 1024 + 100, "d": 900 * 1024 + 300, "limite": 20}}, 8, {}),
        ("haughton", "row 512, all cols", {"camino": ("recta", 512, 0, 512, 1023)}, 5, {}),
        ("haughton", "col 700, both anchored", {"camino": ("recta", 0, 700, 1023, 700)}, 3, {"anclarInicio": True, "anclarFin": True}),
    ]
    alturas = {}
    fallos = []
    print(f"{'terrain':<11} {'profile':<27} {'lim°':>4} {'pts':>5} {'V_obra.js m³/m':>16} {'V_LP m³/m':>16} {'ratio':>12} {'js ms':>7} {'LP ms':>7}  result")
    for tid, nombre, spec, limite, opc in casos:
        meta = json.loads((TERRENOS / tid / "meta.json").read_text())
        n, m = meta["n"], meta["m_por_px"]
        if tid not in alturas:
            alturas[tid] = np.fromfile(TERRENOS / tid / "altura.f32", dtype="<f4")
        a = alturas[tid]
        entrada = {"altura": str(TERRENOS / tid / "altura.f32"), "n": n, "m": m, "limite": limite, "opc": opc}
        if "camino" in spec:
            entrada["camino"] = recta(n, *spec["camino"][1:])
        else:
            entrada["ruta"] = spec["ruta"]
        js = node(entrada)
        s, z = perfil_py(a, n, m, js["camino"])
        motivo = []
        if not (np.allclose(s, js["s"], rtol=0, atol=1e-9) and np.array_equal(z, np.array(js["z"]))):
            motivo.append("profile differs")
        r, ms_lp = lp(s, z, limite, opc.get("anclarInicio"), opc.get("anclarFin"))
        if not r.success:
            motivo.append(f"LP: {r.message}")
        if not js["factible"]:
            motivo.append(f"obra.js not feasible: {js['motivo']}")
        if motivo:
            fallos.append(f"{tid} {nombre}: {'; '.join(motivo)}")
            print(f"{tid:<11} {nombre:<27} {limite:>4} {len(s):>5}  FAIL {'; '.join(motivo)}")
            continue
        zp = np.array(js["zp"])
        w = pesos(s)
        v_js = float(np.sum(w * np.abs(zp - z)))
        v_lp = float(r.fun)
        exceso = np.max(np.abs(np.diff(zp)) - math.tan(math.radians(limite)) * np.diff(s))
        if exceso > TOL_PEND:
            motivo.append(f"slope exceeded by {exceso:.3g}")
        if opc.get("anclarInicio") and zp[0] != z[0]:
            motivo.append("start not anchored")
        if opc.get("anclarFin") and zp[-1] != z[-1]:
            motivo.append("end not anchored")
        if v_js > v_lp * (1 + TOL_ARRIBA):
            motivo.append("worse than optimum × (1 + 1e-6)")
        if v_js < v_lp * (1 - TOL_ABAJO):
            motivo.append("below optimum − 1e-6 (LP or obra.js wrong)")
        ratio = v_js / v_lp if v_lp > 0 else float("nan")
        res = "OK" if not motivo else "FAIL " + "; ".join(motivo)
        if motivo:
            fallos.append(f"{tid} {nombre}: {res}")
        print(f"{tid:<11} {nombre:<27} {limite:>4} {len(s):>5} {v_js:>16.6f} {v_lp:>16.6f} {ratio:>12.9f} {js['ms']:>7.1f} {ms_lp:>7.1f}  {res}")
    if fallos:
        print("\n".join(["", "FAILED:"] + fallos))
        return 1
    print(f"\nall {len(casos)} profiles OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
