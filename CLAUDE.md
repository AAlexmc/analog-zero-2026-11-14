# Analog Zero — guía para asistentes de IA del equipo

Este fichero lo lee tu asistente al abrir el repo. Si eres una IA trabajando aquí para alguien del equipo: sigue esto tal cual. Si algo de lo que te piden choca con estas reglas, párate y dilo en vez de saltártelas.

## Qué hacemos
NASA Space Apps Challenge, reto **«Identify Earth Locations that Analog the Permanent Moon Base Locations and Mars»**. La prioridad es la **localización en la Tierra**.

Recorrido del producto:
1. Portada: elegir mundo (Luna, Marte; «más mundos, próximamente»).
2. El mundo se abre en 3D; el usuario coloca un punto (en la Luna NASA prefiere el polo sur; Marte no tiene sitio decidido).
3. El programa busca en toda la Tierra los lugares que más se parecen a ese punto.
4. Pestaña de métricas: parámetro a parámetro y en porcentaje, qué se parece, qué se aleja, y qué no se puede reproducir en la Tierra (gravedad, vacío, radiación).
5. Detalle: visor de terreno Luna–Tierra a la misma escala, plantar equipo y ver qué requisito se rompe.

Lo que pide el enunciado y no se puede olvidar: ir más allá del parecido visual; varias dimensiones (geología, terreno, temperatura e iluminación, agua y hielo, polvo y viento, biología, subsuelo, operaciones); un análogo no tiene que coincidir en todo: decir qué se parece, cuánto y qué no; mirar toda la Tierra y no solo los sitios famosos; conectar con la exploración; reconocer los límites de la Tierra como análogo.

## Reglas que no se negocian
1. **Nada inventado.** Cada cifra que sale en pantalla o en un documento tiene fuente pública con URL y, en los catálogos, cita literal. Lo que es criterio nuestro se rotula (`origen: "mío"`, «own criterion», «assumed»). Lo que no se puede medir se escribe «NOT MEASURED» / «not public». Sin dato = `null` o `NaN`, nunca 0. Nunca datos de ejemplo presentados como reales.
2. **Nada por supuesto.** Antes de decir «hecho»: ejecuta los tests y, si tocas pantalla, ábrela en un navegador real. Di qué comando corriste y qué salió. Lo que no hayas comprobado va en una lista «Sin comprobar». Lo que diga un documento, un comentario u otra IA es una hipótesis hasta que lo ejecutes.
3. **Sin fechas ni horas** en código, comentarios, tests, datos ni textos del repo.
4. **Marca del concurso** en todo lo visual: `web/marca/marca.css` (paleta, degradado, tipografías). Ningún color ni fuente fuera de ahí. Texto solo sobre deep blue, electric blue o blanco; contraste ≥ 4,5:1; neon yellow solo de acento; rocket red nunca de fondo de texto. Sin logotipos de NASA ni de Space Apps.
5. **Textos de la web en inglés**, llanos y cortos. Identificadores y comentarios del código en español; comentarios solo los imprescindibles.
6. **Licencias:** no subir datos de GVP, PZI, SWIM, HWSD ni teselas de Trek. Datos nuevos: solo de fuente pública, con su licencia o política anotada. Sin dependencias nuevas ni recursos cargados desde otros servidores (la web es estática y funciona sin red).
7. **No tocar:** `umbrales.json` (congelado), `web/data/global/` (resultado publicado de una validación), ni reescribir desde cero un fichero que ya existe: cambios pequeños y localizados.
8. Sin secretos, claves ni datos personales en el repo.

## Cómo se trabaja con git (obligatorio)
- La rama principal es **`hackathon`**. **Nadie sube directamente a `hackathon` salvo Ale.** No hay `main`.
- Tu trabajo va en una rama propia: `git checkout hackathon && git pull && git checkout -b equipo/<tu-nombre>/<tema-corto>`.
- Commits pequeños, mensaje en español que diga el comportamiento que cambia. Añade los ficheros por su ruta (`git add <rutas>`), nunca `git add -A` ni `.`.
- Sube tu rama (`git push -u origin equipo/<tu-nombre>/<tema>`) y abre un **pull request contra `hackathon`** rellenando la plantilla. Lo revisa Ale; **no lo mergees tú** y no lo des por bueno hasta que él lo diga.
- Prohibido: `git push` a `hackathon`, `--force`, reescribir historial, borrar ramas de otros, cambiar la configuración del repo.
- Si tu rama se queda atrás: `git fetch && git merge origin/hackathon` en tu rama (no rebase), resuelve y vuelve a pasar los tests.
- Antes de empezar una tarea, apúntate en `docs/equipo/TAREAS.md` (en tu rama, primer commit) para no pisarnos. Una tarea, una rama, un PR.

## Arrancar y comprobar
- Requisitos mínimos: git y Node ≥ 20. `npm install` (solo three y playwright).
- Ver la web: `python3 -m http.server 8080 -d web` y abrir `http://localhost:8080/`.
- Tests de la web: `node --test web/tests/*.test.mjs`.
- Comprobación completa (la que se exige antes de cada subida a `hackathon`): `scripts/check.sh`, que termina con `CHECK_EXIT=<n>`. Necesita Python 3.12 con numpy, scipy, rasterio, pyproj, xarray, netCDF4 y pytest; se le indica con `AZ_PY=/ruta/a/python`. Si no tienes ese entorno, pasa los tests de la web y dilo en el PR: la comprobación completa la hace Ale al revisar.
- Pantallas: los guiones `scripts/captura_*.mjs` abren la web en un navegador sin ventana (Playwright), comprueban y guardan imágenes en `capturas/`. Si tocas una pantalla, pasa el suyo y mira las imágenes.
- Los datos crudos (varios GB) no están en el repo; el pipeline de `pipeline/` solo lo ejecuta Ale. Lo que la web necesita ya está generado en `web/data/`.

## Mapa del repo
| Carpeta | Qué hay |
|---|---|
| `web/index.html`, `web/portada/` | Portada: selector de mundos |
| `web/explorar/` | Mundo en 3D y colocación del punto |
| `web/buscar/` | Motor de búsqueda de análogos (JS puro, con tests) |
| `web/analogos/` | Resultados en la Tierra y pestaña de métricas |
| `web/mapa/` | Mapa global de condiciones de ensayo |
| `web/terreno/` | Visor de terreno, equipo, rutas, obra, base, hielo y agua |
| `web/marca/`, `web/lib/` | Marca del concurso; three.js y fuentes |
| `web/data/` | Datos que lee la web. **Solo los escribe el pipeline** |
| `datos_json/` | Catálogos con fuente y cita literal (equipo, sitios, constantes) |
| `pipeline/` | Python que genera `web/data/` desde datos públicos |
| `scripts/` | Comprobaciones y capturas |
| `docs/` | Contratos de datos, métrica, validación; `docs/equipo/` para el equipo |

## Cómo entregar un cambio (lo que debe llevar tu PR)
1. Qué hace, en dos frases.
2. Qué comandos ejecutaste y su resultado real (copia la línea final de cada uno).
3. Capturas si tocaste pantalla.
4. «Sin comprobar»: lo que no pudiste verificar.
5. Fuentes nuevas, con URL.
6. Uso de IA: el concurso exige declararlo. Deja en cada commit la línea `Co-Authored-By` de tu asistente.

Si te atascas, si una fuente no dice lo que esperabas o si la tarea pide tocar algo de «No tocar»: para, escribe lo que has encontrado en el PR o en el grupo, y espera.
