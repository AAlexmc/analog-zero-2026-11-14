# Métrica de análogos (criterio propio, `origen: "mío"`)

Datos: `web/data/cuerpos/indice.json` (lo escribe `python -m pipeline.cuerpos`). Motor: `web/buscar/motor.js`.

## Rejilla
720 × 360 celdas de 0,5°, float32 little-endian, fila 0 = 89,75° N, columna 0 = −179,75°, longitud este positiva en los tres cuerpos, NaN = sin dato. Un parámetro que es constante en un cuerpo lleva `capas[cuerpo] = null` y `constante[cuerpo] = valor`; sin dato en un cuerpo: los dos `null`.

## Desviación de un parámetro
desviación % = min(100, |f(v_Tierra) − f(v_objetivo)| / (f(max) − f(min)) × 100)

- f = `transformacion` del parámetro: `lineal` (f(v) = v), `log10` (f(v) = log10(max(v, min))) o `log1p` (f(v) = log10(1 + max(v, 0)); la usa la precipitación, cuyo objetivo es 0).
- [min, max] = `rango_ref`: p1–p99 de la tierra firme de la Tierra ∪ p1–p99 de cada cuerpo objetivo, celdas pesadas por área; un cuerpo con valor constante cuenta como ese valor.
- Sin dato en cualquiera de los dos lados → `null`, nunca 0.
- similitud % = 100 − desviación %.

## Similitud de una celda de la Tierra
Media ponderada (pesos por defecto 1) de las similitudes de los parámetros usados que tienen dato en esa celda. La celda entra en `resultados` solo si tiene dato en TODOS los parámetros usados (`comparados` = `de`); las que tienen dato en al menos la mitad pero no en todos salen aparte en `parciales`, con su `comparados` de `de`, y no compiten con las primeras (`completos: false` vuelve a mezclarlas). En los dos casos la celda necesita `tierra_frac` ≥ 0,5 y no ser casquete de hielo (GLiM clase 16), salvo `incluir_casquete`.

Parámetros usados = los pedidos que se pueden reproducir en la Tierra y tienen dato en el punto objetivo. Los que no tienen dato en el objetivo salen en `sin_dato`. Los no reproducibles (gravedad, presión) se informan aparte en `no_reproducibles` y no entran en la similitud; cada resultado lleva los suyos (la presión de la Tierra es una capa) y el `no_reproducibles` de arriba es el de la mejor celda.

## Resultados
Las n mejores celdas (por defecto 5), separadas al menos `separacion_km` (por defecto 500 km, círculo máximo con el radio medio de la Tierra), elegidas en orden de similitud; empate → la celda de índice menor.

## Parámetros solo-Tierra y referencia (`opc.referencia`)
`indice.parametros_tierra` (lo escribe `python -m pipeline.cuerpos.tierra_extra`, y también `python -m pipeline.cuerpos`) lista capas que solo existen o solo tienen sentido en la Tierra, con `solo_tierra: true` y solo `capas.earth`. `parametros` no cambia. `M.leerPunto('earth', …)` da también sus valores; en la Luna y Marte valen `null`.

Su valor objetivo no sale del punto de la Luna o de Marte: sale de la Tierra en `opc.referencia = { lat, lon }` (p. ej. el sitio donde NASA hace ese ensayo). `buscar` y `cartera` aceptan en `opc.parametros` ids de los dos tipos; sin `referencia`, o si ahí no hay dato, el id no se usa y sale en `sin_referencia` (no en `sin_dato`). El resto (media ponderada, mitad mínima, completos/parciales, separación, cartera) es igual sobre los usados. Cada parámetro de un resultado lleva `origen_objetivo: 'punto' | 'referencia'` (sin referencia: `estado: 'sin_referencia'`). Id desconocido o referencia fuera de la rejilla → error. Sin `parametros` ni `referencia` todo da lo mismo que antes (test con huella fijada con el motor anterior).

- `rango_ref`: p1–p99 de la tierra firme (tierra ≥ 0,5) de la Tierra sola, celdas pesadas por área.
- `transformacion` (mirando la distribución real por área): `aridez_ai` log10 (p1 0,003, p50 0,70, p99 4,87: tres órdenes de magnitud); `tiempo_ciudad_h` log10 (p1 0,24 h, p50 5,2 h, p99 149 h: cola larga); vientos, amplitud diurna, permafrost (0–1) y elevación (hay valores < 0) lineales: su p99 no pasa de ~10× la mediana.
- `litologia_glim`: `transformacion: 'categoria'` (criterio propio): desviación 0 % si la clase GLiM coincide con la de la referencia y 100 % si no; `rango_ref: null`, nombres en `clases`. No entra en la métrica por componentes (que ya no admite `parametros`).
- Límites: con log10 lo que queda por debajo de p1 cuenta como p1 (todo lo más seco que aridez 0,003 se ve igual). Permafrost solo tiene dato de 25° N a 85° N, y no en buena parte de la tierra templada (`docs/validacion-global.md`): con una referencia del hemisferio sur sale en `sin_referencia`.

## Límites conocidos
- La similitud depende de qué parámetros entran y del rango de referencia: no es una probabilidad ni una medida física.
- Cada parámetro declara en `aviso` en qué no es igual entre cuerpos (p. ej. insolación de la Tierra en superficie con nubes frente a la Luna sin atmósfera).
- La Tierra no tiene rugosidad ni relieve al sur de 56° S (GMTED2010 7,5″) ni NDVI en hielo: en la Antártida la similitud se calcula con menos parámetros (p. ej. 5 de 8) y no paga la desviación de los que faltan: por eso esas celdas van en `parciales` y no en `resultados`. Cada una lista sus parámetros con `estado` (`sin_dato_tierra`).
- El casquete sale de GLiM a 0,5°: hay celdas antárticas bajo hielo que GLiM rotula por la roca de debajo (o sin dato) y no se quitan.
- Islas y costas con menos de la mitad de tierra en la celda (p. ej. Lanzarote) no entran.

## Clases de entorno de la Tierra (aprendizaje no supervisado, `origen: "mío"`)
Qué es: agrupar la tierra firme de la Tierra por sus propios números, sin etiquetas ni modelo entrenado; no es una predicción. Lo escribe `python -m pipeline.clases` (después de `pipeline.cuerpos`) en `web/data/cuerpos/clases.json` y `earth/clase.f32` (id de clase por celda, NaN fuera); `indice.json` lo apunta con `clases`.

Regla:
1. Celdas: `tierra_frac` ≥ 0,5, sin casquete, con dato en todos los parámetros `reproducible_en_tierra`. Valores con la misma f del motor, estandarizados con media y desviación pesadas por área (cos lat).
2. Componentes principales de la covarianza pesada; se guardan las primeras que suman ≥ 95 % de la varianza. Espacio de trabajo: puntuaciones **blanqueadas** (cada componente dividida por la raíz de su autovalor).
3. k-medias pesadas por área (arranque k-means++, 10 arranques con semilla fija, la de menor inercia). k entre 6 y 14 por la mayor silueta media sobre una muestra fija de 5000 celdas (probabilidad ∝ área); empate → k menor. El criterio se fijó antes de mirar ningún mapa; la tabla k → silueta va en `criterio_k`.
4. Por clase: centro en componentes, centro físico (f⁻¹ de la media pesada de f(v)), nº de celdas, % del área clasificada, radio = percentil 95 (por área) de la distancia de sus celdas al centro, y un rótulo por regla (`rotulo.regla`): z medio de cada parámetro, uno por grupo, los de |z| ≥ 0,5 hasta 3, palabra «baja»/«alta» del parámetro y «very» si |z| ≥ 1,5.

`M.claseDe(objetivo)` proyecta el punto y da la clase de centro más cercano, `dentro` = distancia ≤ radio, `faltan` (parámetros sin dato: se proyecta por mínimos cuadrados con los que hay; con menos parámetros que componentes no se proyecta) y `residuo_z`: la parte del punto que las componentes guardadas no ven, frente a `residuo_z_p99_tierra`.

Límites: la estructura es débil (silueta ≈ 0,3 para todo k): la tierra es un continuo y las fronteras entre clases son convencionales. Las clases solo ven los parámetros que hay (sin geología, polvo, subsuelo). El 5 % de las celdas de cada clase queda fuera de su radio por construcción. NDVI y lluvia de la Luna y Marte son 0 por definición: eso solo ya los aleja de toda la Tierra. Proyectar un punto muy fuera del rango de la Tierra es extrapolar.

## Métrica por componentes (`opc.metrica: 'componentes'`)
Qué es: ordenar las celdas por distancia euclídea al objetivo en las componentes blanqueadas, para que parámetros redundantes (máxima, mínima y media de temperatura) no cuenten tres veces. Distancia blanqueada = distancia de Mahalanobis de la Tierra en las componentes guardadas.

Regla: `similitud_pct = 100 × (1 − d / d_ref)` recortada a [0, 100]; `d_ref` = percentil 99 de la distancia entre todos los pares de la muestra fija de 5000 celdas (`clases.json`, `d_ref`). Cada resultado lleva además `distancia_componentes` y `similitud_parametros_pct` (la de siempre); las desviaciones por parámetro no cambian. Entran solo celdas con todos los parámetros (`parciales` vacío); sin `pesos` ni `parametros`.

Límites: un punto de la Luna o de Marte suele quedar más lejos de toda la Tierra que `d_ref`, así que su similitud sale 0 % aunque el orden siga siendo útil. Lo que el objetivo tiene fuera de las componentes guardadas (`residuo_z`; p. ej. buena parte de la oscilación diaria de ~300 K de Mare Tranquillitatis, que la Tierra no tiene) no cuenta en la distancia.

## Cartera de análogos (`M.cartera(objetivo, opc)`)
Qué es: un análogo no tiene que coincidir en todo. La cartera es el conjunto más pequeño de lugares de la Tierra que entre todos cubren cada parámetro cubrible; lo que ningún lugar cubre es lo que hay que ensayar en laboratorio.

Regla: un parámetro queda cubierto por una celda si su desviación es < `corte` (por defecto 15, el corte «close match» de la pantalla). Celdas: las mismas que `buscar` con `completos: false` (tierra ≥ 0,5, sin casquete salvo `incluir_casquete`, dato en al menos la mitad de los parámetros). Cada celda se reduce a su máscara de parámetros cubiertos; programación dinámica exacta por capas sobre la unión de máscaras: la primera capa que llega a la unión total da el mínimo nº de lugares, y dentro de ella se queda la combinación con mayor similitud media, usando para cada máscara su celda de mayor similitud (empate → índice menor). `sin_cubrir` da, por parámetro no cubierto, la menor desviación de toda la Tierra y dónde. `separacion_km` (por defecto 0): después de elegir las máscaras, cada lugar pasa a ser la mejor celda que cubra al menos lo mismo y esté a esa distancia de los anteriores; si no existe se dice (`separacion_cumplida: false`) y el óptimo de similitud deja de estar garantizado.

Límites: depende del corte y del rango de referencia; un parámetro «cubierto» no dice nada de los demás de ese lugar (cada lugar lleva todas sus desviaciones). Celdas con menos parámetros (Antártida sin relieve ni NDVI) pueden entrar y cubrir solo los que tienen.

## Meses (`opc.mes`, `M.cargarMeses`, `M.perfilMensual`, `M.calendario`)
Qué es: un lugar de la Tierra puede ser buen análogo en enero y no en julio. Siete parámetros de la Tierra tienen versión por mes del calendario: `t_max_k`, `t_min_k`, `t_media_k`, `insolacion_kwh_m2_dia`, `precip_mm_ano` y, de los solo-Tierra, `viento_medio_m_s` y `amplitud_diurna_k`. Los demás (rugosidad, relieve, vegetación, altitud, roca, permafrost, tiempo a una ciudad, aridez, viento P95) no llevan mes.

- Es climatología: el mes medio de muchos años de NASA POWER (MERRA-2, SYN1deg), no un año concreto. Mismas fuentes, remuestreo, máscara y reglas de sin dato que la capa anual; el «mes 13» calculado con el mismo código da la capa anual byte a byte (precipitación: ver abajo).
- Precipitación del mes: ritmo del mes (mm/día) × 365, en mm/año, para que la unidad y `rango_ref` sean los de la anual; no es el total del mes. La media de los 12 pesada por días da la anual (diferencia ≤ 0,0003 mm/año).
- Vegetación (`ndvi_max`): se queda en el máximo del año con cualquier mes. Con nieve o hielo MODIS no da NDVI, y una versión mensual sacaba del ranking de invierno todo lo que está nevado (más de 12.000 celdas en enero); el máximo anual responde a «¿hay plantas aquí?», que es lo que se compara con la Luna y Marte.
- El objetivo NO cambia con el mes: la Luna y Marte siguen con su valor anual (límite conocido: no se compara estación con estación). Con `referencia`, los solo-Tierra con mes toman el valor de ese mes en la referencia.
- Ficheros: `earth/mes/<id>.i16` = 12 mapas seguidos (enero…diciembre) de 720 × 360, fila 0 = norte, Int16 little-endian; valor = entero × `escala` + `desplazamiento`, `sin_dato` = −32768. Los apunta `indice[…].meses` (`earth`, `escala`, `desplazamiento`, `sin_dato`, `fuente`, `aviso`). Error de cuantización ≤ escala/2: ≤ 0,0013 % de desviación en todos salvo la precipitación (≤ 0,12 mm/año; por la escala logarítmica, hasta 1,1 % de desviación en celdas con menos de 1 mm/año, p99 0,09 %; la propia fuente redondea a 0,01 mm/día = 3,65 mm/año).

Motor: `cargar` no baja ningún fichero mensual. `await M.cargarMeses(ids?)` los baja una vez (por defecto todos los de `M.conMeses`). `buscar` y `cartera` con `mes` (1–12) usan el valor del mes en los parámetros que lo tienen y el anual en el resto; la salida añade `mes` y `mensuales`. Sin `cargarMeses`, mes fuera de 1–12 o `metrica: 'componentes'` → error. `perfilMensual(objetivo, { lat, lon }, opc)` da los 12 meses de una celda (mismas cuentas que `buscar`, sin máscara de tierra). `calendario(objetivo, opc)` da la mejor celda de cada mes con las reglas de `buscar`; con `opc.lugar`, `en_lugar_pct` (como `perfilMensual`) y `relevo` (la mejor está en otra celda, aunque empate).

Límites: la insolación de la noche polar vale 0 (es dato, no sin dato). La nieve en el suelo no se mide: un lugar nevado en invierno entra con su temperatura y su luz de ese mes, pero sin capa de nieve.
