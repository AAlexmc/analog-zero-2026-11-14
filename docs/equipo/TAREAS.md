# Tareas del equipo

Antes de empezar una, pon tu nombre en «Quién» (primer commit de tu rama). Una tarea, una rama, un PR contra `hackathon`. Las reglas están en `CLAUDE.md`.

| Id | Tarea | Qué se entrega | Dónde | Quién | Estado |
|---|---|---|---|---|---|
| A1 | Portada y mundo en 3D | selector Luna / Marte / próximamente; globo con punto | `web/index.html`, `web/portada/`, `web/explorar/` | Ale | hecho |
| A2 | Capas globales y motor de búsqueda | parámetros de Luna, Marte y Tierra a 0,5°; `motor.js` | `pipeline/cuerpos/`, `web/data/cuerpos/`, `web/buscar/` | Ale | hecho |
| A3 | Resultados y pestaña de métricas | lugares de la Tierra, porcentajes por parámetro | `web/analogos/` | Ale | hecho |
| B1 | Lugares con nombre | catálogo de puntos sugeridos: regiones candidatas de alunizaje de Artemis en el polo sur y zonas candidatas de exploración humana de Marte, cada una con coordenadas, fuente oficial y cita literal | `datos_json/lugares.json` (formato de cita como `datos_json/obra.json`) + test que valide el fichero | libre | — |
| B2 | Sitios análogos conocidos de la Tierra | ampliar `datos_json/sitios_ensayo.json` con sitios análogos ya usados por agencias (nombre, coordenadas, qué se ensayó, fuente y cita literal), para poder decir en los resultados «cerca de un análogo conocido» o «lugar poco estudiado» | `datos_json/sitios_ensayo.json` + su test | Pedro | en curso |
| B3 | Textos de la entrega | en inglés: resumen, descripción, cómo respondemos a cada «consideration» del reto, uso de IA, lista de datos y recursos con URL. Solo afirmaciones que estén en el repo; cifras copiadas de los ficheros, no de memoria | `docs/entrega/` | Pedro | en curso |
| B4 | README para el jurado | qué es, cómo abrirlo, de dónde sale cada dato, qué no hace | `README.md` | Pedro | siguiente |
| B6 | Nombre del lugar | que cada resultado diga país o región además de las coordenadas («Ellesmere Island, Canada»), a partir de un fichero público de límites (p. ej. Natural Earth, dominio público) reducido y guardado en el repo, con función pura punto-en-polígono y tests; sin servicios externos | `web/analogos/`, `web/data/` (fichero nuevo; decir fuente y licencia) | Ale | hecho |
| B7 | Más sitios análogos con coordenadas | 6 de los 9 sitios de `sitios_ensayo.json` no tienen coordenadas y por eso no salen como «near a known analog site»: añadirlas con fuente y cita literal | `datos_json/sitios_ensayo.json` | Pedro | en curso |
| B8 | Datos a la vista | página de fuentes por parámetro leída de `indice.json` + enlace a NASA Worldview por lugar | `web/datos/`, `web/analogos/` | libre | — |
| B10 | Catálogo de objetivos de misión (grupos 1–7 hechos) | ensayos que NASA hace en análogos terrestres, con campaña, sitio, características del entorno que la fuente nombra, cita literal y parámetros asignados; grupos 3 a 7 de la lista de partida | `datos_json/misiones.json` (formato: `docs/contrato-misiones.md`) + su test | Pedro (grupos 3–7), Ale (grupos 1–2) | en curso |
| B5 | Guion del vídeo de 30 s y del pitch | guion con lo que se ve en pantalla en cada segundo; 7 diapositivas | `docs/entrega/` | Pedro | en curso |

## Para Pedro ahora (PR pequeños, de uno en uno)
Tus PR #5 a #9 están integrados; la revisión de cada uno está en su hilo. Antes de nada: `git checkout hackathon && git pull` y rama nueva por tarea. Para gastar poco: no releas el repo entero (basta `CLAUDE.md`, este fichero y los ficheros de la tarea) y abre el PR en cuanto pase `node --test web/tests/*.test.mjs`. Si te quedas sin presupuesto a media tarea: sube la rama, abre el PR como borrador y escribe en él qué falta.

Qué hay nuevo desde tu último pull: el catálogo tiene 21 misiones (grupos 1 a 7), 128 de 133 citas verificadas; el objetivo de misión es el paso 1 del panel de la pantalla del mundo (`web/explorar/`) y viaja en la URL a resultados; el visor de terreno lleva la marca; al pulsar un lugar se abre solo su terreno. **Lo siguiente que entra (lo hace Ale): el mes del año.** El mismo lugar no se parece igual en enero que en agosto; habrá selector de mes, parecido mes a mes por lugar y aviso de cuándo conviene llevar el ensayo a otro sitio.

| Orden | Tarea | Qué se entrega | Tamaño |
|---|---|---|---|
| 1 | **B4 — README para el jurado** (rama `equipo/pedro/readme`) | `README.md` en inglés: qué es en tres frases; cómo abrirlo (`python3 -m http.server 8080 -d web`); el recorrido en cinco pasos (mundo → objetivo de misión → punto → lugares de la Tierra → terreno); de dónde sale cada dato (enlace a `web/datos/`); qué NO hace y límites reconocidos (copiados de `docs/metrica-analogos.md` y `docs/entrega/formulario.md`, no de memoria); uso de IA; cómo se comprueba (`scripts/check.sh`, `scripts/verificar_citas.py`). Sin capturas todavía. Mira primero el `README.md` que hay: conserva lo que siga siendo cierto. | medio |
| 2 | **B10d — sitios de referencia que faltan** (rama `equipo/pedro/misiones-c`) | En `datos_json/misiones.json`: (a) coordenadas con `coordenadas_fuente` para las campañas de `habitats_inflables` (McMurdo Station) y `psicologia_tripulacion` (McMurdo y Amundsen-Scott South Pole Station): hoy esas dos misiones no tienen sitio de referencia; (b) otra fuente para las tres coordenadas de Black Point (la hoja de NAU da 404): sirve la página de USGS, del servicio de parques o del Earth Observatory de NASA si da coordenadas; (c) otra fuente que cargue para las campañas de `flota_rovers` y `lidar_estereo` (las dos de ri.cmu.edu dan 404): lo ideal, la ficha de NTRS del mismo trabajo. Mismas reglas de citas que en B10b. | pequeño |
| 3 | **B3b — poner al día los textos** (rama `equipo/pedro/entrega-2`; **espera a que este fichero diga que el mes está integrado**) | `docs/entrega/formulario.md`, `video.md` y `pitch.md` con el mes del año como idea central nueva («el mismo ensayo, dos fechas, dos sitios»), las 21 misiones y el paso 1 en la pantalla del mundo. Cifras copiadas de los ficheros. | medio |

Hecho por Pedro: B10b + B10c (PR #5), B9 (PR #6), B7c (PR #7), B8b (PR #8), B3 + B5 (PR #9), B10a (PR #4), B7 + B2 (PR #1), B7b (PR #2), B8a (PR #3).

## Cómo se comprueba una cita
`scripts/verificar_citas.py` baja cada `fuente` y comprueba que la `cita` aparece literal. Una cita que no aparece en su fuente no entra. Si no tienes el entorno de Python, deja la cita con `"verificado": false` y dilo en el PR: se verifica en la revisión.
