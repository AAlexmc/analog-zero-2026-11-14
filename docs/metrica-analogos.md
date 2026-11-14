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

## Límites conocidos
- La similitud depende de qué parámetros entran y del rango de referencia: no es una probabilidad ni una medida física.
- Cada parámetro declara en `aviso` en qué no es igual entre cuerpos (p. ej. insolación de la Tierra en superficie con nubes frente a la Luna sin atmósfera).
- La Tierra no tiene rugosidad ni relieve al sur de 56° S (GMTED2010 7,5″) ni NDVI en hielo: en la Antártida la similitud se calcula con menos parámetros (p. ej. 5 de 8) y no paga la desviación de los que faltan: por eso esas celdas van en `parciales` y no en `resultados`. Cada una lista sus parámetros con `estado` (`sin_dato_tierra`).
- El casquete sale de GLiM a 0,5°: hay celdas antárticas bajo hielo que GLiM rotula por la roca de debajo (o sin dato) y no se quitan.
- Islas y costas con menos de la mitad de tierra en la celda (p. ej. Lanzarote) no entran.
