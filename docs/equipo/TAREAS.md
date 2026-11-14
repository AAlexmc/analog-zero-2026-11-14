# Tareas del equipo

Antes de empezar una, pon tu nombre en «Quién» (primer commit de tu rama). Una tarea, una rama, un PR contra `hackathon`. Las reglas están en `CLAUDE.md`.

| Id | Tarea | Qué se entrega | Dónde | Quién | Estado |
|---|---|---|---|---|---|
| A1 | Portada y mundo en 3D | selector Luna / Marte / próximamente; globo con punto | `web/index.html`, `web/portada/`, `web/explorar/` | Ale | hecho |
| A2 | Capas globales y motor de búsqueda | parámetros de Luna, Marte y Tierra a 0,5°; `motor.js` | `pipeline/cuerpos/`, `web/data/cuerpos/`, `web/buscar/` | Ale | hecho |
| A3 | Resultados y pestaña de métricas | lugares de la Tierra, porcentajes por parámetro | `web/analogos/` | Ale | hecho |
| B1 | Lugares con nombre | catálogo de puntos sugeridos: regiones candidatas de alunizaje de Artemis en el polo sur y zonas candidatas de exploración humana de Marte, cada una con coordenadas, fuente oficial y cita literal | `datos_json/lugares.json` (formato de cita como `datos_json/obra.json`) + test que valide el fichero | libre | — |
| B2 | Sitios análogos conocidos de la Tierra | ampliar `datos_json/sitios_ensayo.json` con sitios análogos ya usados por agencias (nombre, coordenadas, qué se ensayó, fuente y cita literal), para poder decir en los resultados «cerca de un análogo conocido» o «lugar poco estudiado» | `datos_json/sitios_ensayo.json` + su test | Pedro | en curso |
| B3 | Textos de la entrega | en inglés: resumen, descripción, cómo respondemos a cada «consideration» del reto, uso de IA, lista de datos y recursos con URL. Solo afirmaciones que estén en el repo; cifras copiadas de los ficheros, no de memoria | `docs/entrega/` | libre | — |
| B4 | README para el jurado | qué es, cómo abrirlo, de dónde sale cada dato, qué no hace | `README.md` | libre | — |
| B6 | Nombre del lugar | que cada resultado diga país o región además de las coordenadas («Ellesmere Island, Canada»), a partir de un fichero público de límites (p. ej. Natural Earth, dominio público) reducido y guardado en el repo, con función pura punto-en-polígono y tests; sin servicios externos | `web/analogos/`, `web/data/` (fichero nuevo; decir fuente y licencia) | Ale | pendiente |
| B7 | Más sitios análogos con coordenadas | 6 de los 9 sitios de `sitios_ensayo.json` no tienen coordenadas y por eso no salen como «near a known analog site»: añadirlas con fuente y cita literal | `datos_json/sitios_ensayo.json` | Pedro | en curso |
| B8 | Datos a la vista | página de fuentes por parámetro leída de `indice.json` + enlace a NASA Worldview por lugar | `web/datos/`, `web/analogos/` | libre | — |
| B5 | Guion del vídeo de 30 s y del pitch | guion con lo que se ve en pantalla en cada segundo; 7 diapositivas | `docs/entrega/` | libre | — |

## Para Pedro ahora (presupuesto ajustado: PR pequeños, de uno en uno)
Tu PR #1 está integrado; la revisión está en su hilo. Antes de nada: `git checkout hackathon && git pull` y rama nueva por tarea. Para gastar poco: no releas el repo entero (basta `CLAUDE.md`, este fichero y los ficheros de la tarea), no ejecutes los guiones `scripts/captura_*.mjs` salvo que toques pantalla, y abre el PR en cuanto la tarea pase `node --test web/tests/*.test.mjs`. Si te quedas sin presupuesto a media tarea: sube la rama, abre el PR como borrador y escribe en él qué falta.

| Orden | Tarea | Qué se entrega | Tamaño |
|---|---|---|---|
| 1 | **B7b — rematar el catálogo** (rama `equipo/pedro/analogos-2`) | (a) Yungay con su punto real: está en `umbrales.json` → `validacion` (sitio `yungay`), con su fuente. (b) Campos nuevos en los 19 sitios: `"cuerpo"` (`["moon"]`, `["mars"]`, los dos, o `null` si ninguna cita del sitio lo dice) y `"clase"` (`"terreno"` u `"operaciones"`; Pavilion Lake es `"operaciones"`). (c) Ocho sitios más cuyas coordenadas YA están citadas en `umbrales.json` → `validacion` (McMurdo Dry Valleys, Dalangtan/Qaidam, Death Valley, MDRS Utah, Dallol, Timanfaya, tubo de La Corona, Cinder Lake): solo hay que añadirles nombre, qué se ensayó y una cita de agencia. Actualiza tu test para los campos nuevos. | pequeño · en curso (Pedro) |
| 2 | **B8a — enlace a NASA Worldview** (rama `equipo/pedro/worldview`) | En cada lugar de `web/analogos/` (tarjeta de la pestaña Places), un enlace «Open in NASA Worldview» que abra `https://worldview.earthdata.nasa.gov/` centrado en sus coordenadas (parámetro `v=` con la caja lon/lat mín y máx, ±2° alrededor del punto). Función pura que construye la URL + test de node. Estilo: enlace de texto como los que ya hay, sin colores nuevos. Aquí sí toca pasar `node scripts/captura_analogos.mjs`. | pequeño |
| 3 | **B3 — textos de la entrega** (rama `equipo/pedro/entrega`) | `docs/entrega/formulario.md`, en inglés: resumen de alto nivel (≤ 150 palabras), descripción del proyecto, cómo respondemos a cada «consideration» del reto (una línea cada una, diciendo también lo que NO hacemos), uso de IA, y lista de datos y recursos con URL. **Solo afirmaciones que estén en el repo**: las cifras se copian de `docs/metrica-analogos.md`, `docs/validacion-global.md`, `web/data/cuerpos/indice.json` y `web/data/sitio/indice.json`, nunca de memoria. Lo que no encuentres en el repo va en una lista «to confirm with Ale». | medio |
| 4 | **B5 — guion del vídeo de 30 s y 7 diapositivas** (misma rama que B3 o `equipo/pedro/pitch`) | `docs/entrega/video.md`: segundo a segundo, qué pantalla se ve (portada → mundo → mejor sitio → análogos → Metrics → terreno) y qué frase se dice (≤ 75 palabras en total, inglés). `docs/entrega/pitch.md`: 7 diapositivas, título + 3 líneas + qué captura lleva cada una. Mismas reglas que B3. | medio |
| 5 | **B8b — página de datos** (si queda presupuesto) | `web/datos/index.html` con el formato de marca: por parámetro, de dónde sale en cada mundo, leído de `web/data/cuerpos/indice.json` (campo `fuentes`) y de `web/data/sitio/indice.json`; agrupado por NASA Earthdata, Worldview/GIBS, Planetary Data System y Lunar Reconnaissance Orbiter. Sin texto escrito de memoria. | medio |

B6 (nombre del lugar) lo hace Ale; no lo cojas.

## Cómo se comprueba una cita
`scripts/verificar_citas.py` baja cada `fuente` y comprueba que la `cita` aparece literal. Una cita que no aparece en su fuente no entra. Si no tienes el entorno de Python, deja la cita con `"verificado": false` y dilo en el PR: se verifica en la revisión.
