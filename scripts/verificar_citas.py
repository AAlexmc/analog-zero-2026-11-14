"""Comprueba que cada `cita` de los JSON de datos_json aparece literal en su `fuente`.

Uso: python scripts/verificar_citas.py [ficheros.json ...] [--sin-red] [--cache DIR] [--informe PATH]
Sale con 1 si algún objeto marcado `"verificado": true` en el JSON no pasa.
"""
import argparse
import datetime
import hashlib
import json
import re
import shutil
import subprocess
import sys
import tempfile
import time
import unicodedata
import urllib.error
import urllib.request
from html.parser import HTMLParser
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
ENTRADAS = [RAIZ / "datos_json" / n for n in ("equipo.json", "sitios_ensayo.json", "obra.json")]
CACHE = RAIZ / "build" / "citas_cache"
INFORME = RAIZ / "build" / "citas_informe.json"
AGENTE = "Mozilla/5.0 (X11; Linux x86_64) citation-checker/1.0"
TIEMPO_LIMITE = 45
PALABRAS_MIN, PALABRAS_MAX = 5, 40

_COMILLAS = str.maketrans({c: "'" for c in "‘’‚‛′´`"} |
                          {c: '"' for c in "“”„‟″«»"} |
                          {c: "-" for c in "‐‑‒–—―−﹘﹣－"} |
                          {c: "" for c in "­​‌‍﻿"})
_INSTRUCCIONES = re.compile(
    r"ignore (all |any )?(the )?(previous|prior|above) (instructions|prompts?)|system prompt|"
    r"you are an? (ai|language model|assistant)|as an ai (assistant|model)", re.I)


class _Texto(HTMLParser):
    OCULTAS = {"script", "style", "noscript", "template", "svg"}
    BLOQUE = {"p", "div", "br", "li", "ul", "ol", "tr", "td", "th", "table", "section", "article",
              "header", "footer", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "figcaption", "dd", "dt"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.trozos, self._oculta = [], 0

    def handle_starttag(self, tag, attrs):
        if tag in self.OCULTAS:
            self._oculta += 1
        elif tag in self.BLOQUE:
            self.trozos.append("\n")

    def handle_endtag(self, tag):
        if tag in self.OCULTAS:
            self._oculta = max(0, self._oculta - 1)
        elif tag in self.BLOQUE:
            self.trozos.append("\n")

    def handle_data(self, data):
        if not self._oculta:
            self.trozos.append(data)


def html_a_texto(html):
    p = _Texto()
    p.feed(html)
    p.close()
    return "".join(p.trozos)


def pdf_a_texto(cuerpo):
    if shutil.which("pdftotext"):
        with tempfile.NamedTemporaryFile(suffix=".pdf") as f:
            f.write(cuerpo)
            f.flush()
            r = subprocess.run(["pdftotext", "-enc", "UTF-8", f.name, "-"], capture_output=True, timeout=120)
        if r.returncode != 0:
            raise ValueError(r.stderr.decode("utf-8", "replace").strip()[:200] or f"pdftotext {r.returncode}")
        texto = r.stdout.decode("utf-8", "replace")
    else:
        import io
        import pypdf
        texto = "\n".join(p.extract_text() or "" for p in pypdf.PdfReader(io.BytesIO(cuerpo)).pages)
    if len(texto.strip()) < 20:
        raise ValueError("sin texto extraíble")
    return texto


def _base(texto):
    return unicodedata.normalize("NFKC", texto).translate(_COMILLAS)


def _espacios(texto):
    return re.sub(r"\s+", " ", texto).strip()


def variantes(texto):
    """Texto normalizado en dos lecturas del guion de final de línea: palabra unida y guion conservado."""
    t = _base(texto)
    unido = re.sub(r"(\w)-[ \t]*\n\s*(\w)", r"\1\2", t)
    con_guion = re.sub(r"(\w)-[ \t]*\n\s*(\w)", r"\1-\2", t)
    return {_espacios(unido), _espacios(con_guion)}


def normalizar_cita(cita):
    return _espacios(_base(cita))


def _ruta_cache(cache, url):
    h = hashlib.sha256(url.encode("utf-8")).hexdigest()[:24]
    return Path(cache) / f"{h}.bin", Path(cache) / f"{h}.json"


def guardar_cache(cache, url, cuerpo, tipo):
    cuerpo_p, meta_p = _ruta_cache(cache, url)
    cuerpo_p.parent.mkdir(parents=True, exist_ok=True)
    tmp = cuerpo_p.with_suffix(".tmp")
    tmp.write_bytes(cuerpo)
    tmp.replace(cuerpo_p)
    meta_p.write_text(json.dumps({"url": url, "tipo": tipo,
                                  "fecha": datetime.datetime.now(datetime.timezone.utc).isoformat()}))


def _bajar(url):
    pet = urllib.request.Request(url, headers={"User-Agent": AGENTE, "Accept": "text/html,application/pdf,*/*"})
    with urllib.request.urlopen(pet, timeout=TIEMPO_LIMITE) as r:
        return r.read(), r.headers.get("Content-Type", "")


def obtener(url, cache, sin_red):
    """Devuelve (cuerpo, tipo) desde la caché o la red; lanza RuntimeError con el motivo."""
    cuerpo_p, meta_p = _ruta_cache(cache, url)
    if cuerpo_p.exists() and meta_p.exists():
        return cuerpo_p.read_bytes(), json.loads(meta_p.read_text())["tipo"]
    if sin_red:
        raise RuntimeError("no está en caché (--sin-red)")
    ultimo = None
    for intento in range(2):
        try:
            cuerpo, tipo = _bajar(url.split("#")[0])
            guardar_cache(cache, url, cuerpo, tipo)
            return cuerpo, tipo
        except urllib.error.HTTPError as e:
            ultimo = f"HTTP {e.code}"
            if e.code < 500:
                break
        except Exception as e:
            ultimo = f"red: {type(e).__name__}: {e}"
        if intento == 0:
            time.sleep(2)
    raise RuntimeError(ultimo)


_textos = {}


def texto_de(url, cache, sin_red=False):
    """Texto plano de la fuente (sin normalizar). Lanza RuntimeError con el motivo."""
    clave = (url, str(cache), sin_red)
    if clave not in _textos:
        try:
            cuerpo, tipo = obtener(url, cache, sin_red)
            if "pdf" in tipo.lower() or cuerpo[:5] == b"%PDF-":
                try:
                    _textos[clave] = pdf_a_texto(cuerpo)
                except Exception as e:
                    raise RuntimeError(f"PDF ilegible: {e}")
            else:
                m = re.search(r"charset=([\w-]+)", tipo, re.I)
                _textos[clave] = html_a_texto(cuerpo.decode(m.group(1) if m else "utf-8", "replace"))
        except RuntimeError as e:
            _textos[clave] = e
    if isinstance(_textos[clave], Exception):
        raise _textos[clave]
    return _textos[clave]


def comprobar_cita(url, cita, cache, sin_red=False):
    res = {"verificado": False, "motivo": None, "aviso": None}
    n = len(cita.split())
    if not PALABRAS_MIN <= n <= PALABRAS_MAX:
        res["motivo"] = f"cita de {n} palabras (fuera de {PALABRAS_MIN}-{PALABRAS_MAX})"
        return res
    try:
        texto = texto_de(url, cache, sin_red)
    except RuntimeError as e:
        res["motivo"] = str(e)
        return res
    m = _INSTRUCCIONES.search(texto)
    if m:
        res["aviso"] = "la página contiene texto que parece instrucciones a un asistente (ignorado): " + \
            _espacios(texto[max(0, m.start() - 60): m.end() + 60])
    objetivo = normalizar_cita(cita)
    if any(objetivo in v for v in variantes(texto)):
        res["verificado"] = True
    else:
        res["motivo"] = "cita no encontrada"
    return res


def recorrer(nodo, ruta=""):
    """Objetos con `fuente` y `cita`, con su ruta legible."""
    if isinstance(nodo, dict):
        if isinstance(nodo.get("fuente"), str) and isinstance(nodo.get("cita"), str):
            yield ruta, nodo
        for k, v in nodo.items():
            yield from recorrer(v, f"{ruta}.{k}" if ruta else k)
    elif isinstance(nodo, list):
        for i, v in enumerate(nodo):
            etiqueta = v["id"] if isinstance(v, dict) and "id" in v else i
            yield from recorrer(v, f"{ruta}[{etiqueta}]")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("entradas", nargs="*", type=Path, default=ENTRADAS)
    ap.add_argument("--sin-red", action="store_true", help="usar solo la caché")
    ap.add_argument("--cache", type=Path, default=CACHE)
    ap.add_argument("--informe", type=Path, default=INFORME)
    a = ap.parse_args(argv)

    resultados, avisos = [], []
    for f in a.entradas:
        datos = json.loads(Path(f).read_text(encoding="utf-8"))
        for ruta, obj in recorrer(datos):
            r = comprobar_cita(obj["fuente"], obj["cita"], a.cache, a.sin_red)
            fila = {"ruta": f"{Path(f).name}:{ruta}", "fuente": obj["fuente"], "cita": obj["cita"],
                    "marcado_en_json": obj.get("verificado") is True, "verificado": r["verificado"],
                    "motivo": r["motivo"]}
            if r["aviso"]:
                fila["aviso"] = r["aviso"]
                avisos.append({"fuente": obj["fuente"], "aviso": r["aviso"]})
            resultados.append(fila)

    rotos = [r for r in resultados if r["marcado_en_json"] and not r["verificado"]]
    informe = {
        "fecha": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "sin_red": a.sin_red,
        "resumen": {"citas": len(resultados), "verificadas": sum(r["verificado"] for r in resultados),
                    "no_verificadas": sum(not r["verificado"] for r in resultados),
                    "marcadas_true_que_fallan": len(rotos)},
        "avisos": list({x["fuente"]: x for x in avisos}.values()),
        "resultados": resultados,
    }
    a.informe.parent.mkdir(parents=True, exist_ok=True)
    a.informe.write_text(json.dumps(informe, ensure_ascii=False, indent=1), encoding="utf-8")
    for r in resultados:
        if not r["verificado"]:
            print(f"{'FALLA' if r['marcado_en_json'] else 'no verificada'}: {r['ruta']}: {r['motivo']}")
    s = informe["resumen"]
    print(f"{s['verificadas']}/{s['citas']} citas verificadas; {s['marcadas_true_que_fallan']} marcadas true fallan")
    return 1 if rotos else 0


if __name__ == "__main__":
    sys.exit(main())
