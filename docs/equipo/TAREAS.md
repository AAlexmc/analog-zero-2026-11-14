# Tareas del equipo

Antes de empezar una, pon tu nombre en «Quién» (primer commit de tu rama). Una tarea, una rama, un PR contra `hackathon`. Las reglas están en `CLAUDE.md`.

| Id | Tarea | Qué se entrega | Dónde | Quién | Estado |
|---|---|---|---|---|---|
| A1 | Portada y mundo en 3D | selector Luna / Marte / próximamente; globo con punto | `web/index.html`, `web/portada/`, `web/explorar/` | Ale | en curso |
| A2 | Capas globales y motor de búsqueda | parámetros de Luna, Marte y Tierra a 0,5°; `motor.js` | `pipeline/cuerpos/`, `web/data/cuerpos/`, `web/buscar/` | Ale | en curso |
| A3 | Resultados y pestaña de métricas | lugares de la Tierra, porcentajes por parámetro | `web/analogos/` | Ale | espera a A1 y A2 |
| B1 | Lugares con nombre | catálogo de puntos sugeridos: regiones candidatas de alunizaje de Artemis en el polo sur y zonas candidatas de exploración humana de Marte, cada una con coordenadas, fuente oficial y cita literal | `datos_json/lugares.json` (formato de cita como `datos_json/obra.json`) + test que valide el fichero | libre | — |
| B2 | Sitios análogos conocidos de la Tierra | ampliar `datos_json/sitios_ensayo.json` con sitios análogos ya usados por agencias (nombre, coordenadas, qué se ensayó, fuente y cita literal), para poder decir en los resultados «cerca de un análogo conocido» o «lugar poco estudiado» | `datos_json/sitios_ensayo.json` + su test | libre | — |
| B3 | Textos de la entrega | en inglés: resumen, descripción, cómo respondemos a cada «consideration» del reto, uso de IA, lista de datos y recursos con URL. Solo afirmaciones que estén en el repo; cifras copiadas de los ficheros, no de memoria | `docs/entrega/` | libre | — |
| B4 | README para el jurado | qué es, cómo abrirlo, de dónde sale cada dato, qué no hace | `README.md` | libre | después de A3 |
| B5 | Guion del vídeo de 30 s y del pitch | guion con lo que se ve en pantalla en cada segundo; 7 diapositivas | `docs/entrega/` | libre | después de A3 |

## Cómo se comprueba una cita
`scripts/verificar_citas.py` baja cada `fuente` y comprueba que la `cita` aparece literal. Una cita que no aparece en su fuente no entra. Si no tienes el entorno de Python, deja la cita con `"verificado": false` y dilo en el PR: se verifica en la revisión.
