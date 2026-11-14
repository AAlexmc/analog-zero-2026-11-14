# Tareas del equipo

Antes de empezar una, pon tu nombre en «Quién» (primer commit de tu rama). Una tarea, una rama, un PR contra `hackathon`. Las reglas están en `CLAUDE.md`.

| Id | Tarea | Qué se entrega | Dónde | Quién | Estado |
|---|---|---|---|---|---|
| A1 | Portada y mundo en 3D | selector Luna / Marte / próximamente; globo con punto | `web/index.html`, `web/portada/`, `web/explorar/` | Ale | hecho |
| A2 | Capas globales y motor de búsqueda | parámetros de Luna, Marte y Tierra a 0,5°; `motor.js` | `pipeline/cuerpos/`, `web/data/cuerpos/`, `web/buscar/` | Ale | hecho |
| A3 | Resultados y pestaña de métricas | lugares de la Tierra, porcentajes por parámetro | `web/analogos/` | Ale | hecho |
| B1 | Lugares con nombre | catálogo de puntos sugeridos: regiones candidatas de alunizaje de Artemis en el polo sur y zonas candidatas de exploración humana de Marte, cada una con coordenadas, fuente oficial y cita literal | `datos_json/lugares.json` (formato de cita como `datos_json/obra.json`) + test que valide el fichero | libre | — |
| B2 | Sitios análogos conocidos de la Tierra | ampliar `datos_json/sitios_ensayo.json` con sitios análogos ya usados por agencias (nombre, coordenadas, qué se ensayó, fuente y cita literal), para poder decir en los resultados «cerca de un análogo conocido» o «lugar poco estudiado» | `datos_json/sitios_ensayo.json` + su test | libre | — |
| B3 | Textos de la entrega | en inglés: resumen, descripción, cómo respondemos a cada «consideration» del reto, uso de IA, lista de datos y recursos con URL. Solo afirmaciones que estén en el repo; cifras copiadas de los ficheros, no de memoria | `docs/entrega/` | libre | — |
| B4 | README para el jurado | qué es, cómo abrirlo, de dónde sale cada dato, qué no hace | `README.md` | libre | — |
| B6 | Nombre del lugar | que cada resultado diga país o región además de las coordenadas («Ellesmere Island, Canada»), a partir de un fichero público de límites (p. ej. Natural Earth, dominio público) reducido y guardado en el repo, con función pura punto-en-polígono y tests; sin servicios externos | `web/analogos/`, `web/data/` (fichero nuevo; decir fuente y licencia) | libre | — |
| B7 | Más sitios análogos con coordenadas | 6 de los 9 sitios de `sitios_ensayo.json` no tienen coordenadas y por eso no salen como «near a known analog site»: añadirlas con fuente y cita literal | `datos_json/sitios_ensayo.json` | libre | — |
| B8 | Datos a la vista | página de fuentes por parámetro leída de `indice.json` + enlace a NASA Worldview por lugar | `web/datos/`, `web/analogos/` | libre | — |
| B5 | Guion del vídeo de 30 s y del pitch | guion con lo que se ve en pantalla en cada segundo; 7 diapositivas | `docs/entrega/` | libre | — |

## Orden recomendado para quien llega ahora
1. **B7 + B2 — catálogo de análogos conocidos.** Es lo más urgente: el evaluador pide encontrar análogos «no reconocidos» y para decir que un lugar no lo está hace falta la lista de los que sí. Objetivo: 25–40 sitios análogos ya usados por agencias o publicados (NASA, ESA, CSA y otros), cada uno con nombre, latitud y longitud, a qué cuerpo y qué condición emulan, qué se ensayó allí, URL de la fuente y cita literal que lo diga. Mismo formato que las entradas que ya hay en `datos_json/sitios_ensayo.json`; no cambies las existentes salvo para añadirles coordenadas.
2. **B6 — nombre del lugar** en los resultados.
3. **B8 — datos a la vista.** Página `web/datos/index.html` con el formato de marca: de dónde sale cada parámetro (NASA Earthdata, Worldview/GIBS, Planetary Data System, Lunar Reconnaissance Orbiter…), leyéndolo de `web/data/cuerpos/indice.json` (campo `fuentes`), sin escribir nada de memoria; y en cada resultado de `web/analogos/` un enlace «Open in NASA Worldview» centrado en sus coordenadas.
4. **B3 y B5 — entrega.**

## Cómo se comprueba una cita
`scripts/verificar_citas.py` baja cada `fuente` y comprueba que la `cita` aparece literal. Una cita que no aparece en su fuente no entra. Si no tienes el entorno de Python, deja la cita con `"verificado": false` y dilo en el PR: se verifica en la revisión.
