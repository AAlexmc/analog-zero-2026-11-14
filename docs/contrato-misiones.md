# Contrato: catálogo de objetivos de misión (`datos_json/misiones.json`)

La búsqueda de análogos pasa a elegirse por **objetivo de misión**: un tipo de ensayo que NASA hace (o ha hecho) en un análogo terrestre. Cada objetivo lleva las características del entorno por las que se elige el sitio, y cada característica se asigna a parámetros que la herramienta mide. El usuario elige el objetivo y la herramienta busca con esos parámetros; también puede crear una «misión nueva» marcando parámetros a mano.

## Qué es hecho y qué es criterio nuestro
- **Hecho, con cita literal:** que NASA hizo ese ensayo en ese sitio (`campanas`) y que la fuente nombra esa característica del entorno como razón o condición del ensayo (`caracteristicas`).
- **Criterio nuestro** (se rotula «own mapping» en pantalla): a qué parámetros de la herramienta se asigna cada característica (`parametros`).
- Lo que la fuente nombra y no tenemos como capa global va con `"medido": false` y su `motivo`. No se quita: en pantalla sale «NOT MEASURED».
- Un ensayo de la lista de partida que no se pueda respaldar con fuente se deja con `"respaldo": "no_encontrado"` y sin características. No se rellena.

## Forma
```json
{
  "descripcion": "…",
  "misiones": [
    {
      "id": "georradar_hielo",
      "nombre": "Ground-penetrating radar for buried ice",
      "que_se_prueba": "One plain English sentence.",
      "cuerpo": ["moon", "mars"],
      "grupo": 3,
      "respaldo": "confirmado",
      "campanas": [
        {
          "nombre": "…",
          "organismo": "NASA Ames",
          "sitio": "haughton",
          "sitio_texto": "Haughton impact structure, Devon Island, Canada",
          "lat": 75.3667,
          "lon": -89.6833,
          "coordenadas_fuente": null,
          "anos": "2010",
          "fuente": "https://…",
          "cita": "…",
          "verificado": false
        }
      ],
      "caracteristicas": [
        {
          "id": "hielo_subsuperficial",
          "nombre": "Buried ground ice",
          "en_lista_de_partida": true,
          "valor_texto": null,
          "fuente": "https://…",
          "cita": "…",
          "verificado": false,
          "parametros": ["permafrost_frac", "t_media_k"],
          "medido": true,
          "motivo": null
        }
      ]
    }
  ]
}
```

## Campos
| Campo | Regla |
|---|---|
| `id` | minúsculas y guion bajo, en español, único |
| `nombre` | inglés llano, cinco palabras como mucho; es lo que lee el usuario en el selector |
| `que_se_prueba` | una frase en inglés |
| `cuerpo` | `"moon"`, `"mars"` o ambos, según diga la fuente |
| `grupo` | número del grupo de la lista de partida (abajo) |
| `respaldo` | `"confirmado"`, `"parcial"` o `"no_encontrado"` |
| `campanas[].sitio` | `id` de `datos_json/sitios_ensayo.json` si el sitio ya está ahí; si no, `null` y se rellenan `sitio_texto`, `lat`, `lon` y `coordenadas_fuente` (objeto `{fuente, cita, verificado}`) |
| `campanas[].lat`, `lon` | grados decimales; `null` si la fuente no los da. La primera campaña con coordenadas es el **sitio de referencia** de la misión para los parámetros que solo existen en la Tierra |
| `fuente`, `cita`, `verificado` | igual que en `sitios_ensayo.json`: URL exacta, fragmento literal contiguo de 5 a 40 palabras, y `true` solo si `scripts/verificar_citas.py` la encuentra |
| `caracteristicas[].en_lista_de_partida` | `true` si ya estaba en la lista de partida; `false` si la añade la fuente |
| `caracteristicas[].valor_texto` | valor del entorno que dé la fuente, con unidad, copiado tal cual; `null` si no da número |
| `caracteristicas[].parametros` | ids de la lista de abajo; `[]` si ninguno vale |
| `caracteristicas[].medido` | `false` si `parametros` está vacío; entonces `motivo` dice por qué en inglés |

## Parámetros a los que se puede asignar
Comparados con el punto de la Luna o de Marte: `rugosidad_tan`, `relieve_m`, `t_max_k`, `t_min_k`, `t_media_k`, `insolacion_kwh_m2_dia`, `ndvi_max`, `precip_mm_ano`.

Solo en la Tierra, comparados con el sitio de referencia de la misión (en preparación; la lista puede acortarse si alguna capa se queda sin fuente): `aridez_ai` (índice de aridez), `viento_medio_m_s`, `viento_p95_m_s`, `amplitud_diurna_k` (amplitud térmica diaria), `permafrost_frac`, `elev_m` (altitud), `tiempo_ciudad_h` (horas de viaje a la ciudad más cercana), `litologia_glim` (clase de roca).

Sin capa global (van como `medido: false`): radiación ultravioleta, percloratos y sales, mineralogía, tubos de lava, hielo bajo el suelo medido, polvo en suspensión, retardo de comunicaciones.

## Lista de partida (hipótesis del equipo, sin fuentes: hay que confirmarla, corregirla o descartarla)
| Grupo | Ensayos | Características que se le suponen |
|---|---|---|
| 1 | detección de biomarcadores y espectrómetros; taladros subsuperficiales (rendimiento y contaminación cruzada); degradación de polímeros y sellos en ambiente corrosivo | hiperaridez y ultravioleta extremo; suelos salinos con percloratos; química superficial oxidante |
| 2 | hábitats inflables y modulares (térmico y estructural); energía autónoma y soporte vital; comportamiento y fatiga de tripulaciones aisladas | frío extremo; permafrost y hielo profundo; viento catabático y aislamiento total |
| 3 | georradar para hielo bajo el suelo; movilidad autónoma de rovers y drones en terreno irregular; tubos de lava como refugio contra la radiación | llanuras basálticas recientes; tubos de lava; interacción entre hielo y volcán |
| 4 | simulaciones tripuladas de larga duración (agua, residuos, energía solar); actividades extravehiculares con retardo de comunicaciones; recursos in situ a partir de basalto | mineralogía basáltica; entorno volcánico aislado a gran altitud |
| 5 | navegación autónoma de flotas de rovers; LiDAR y visión estéreo; muestreo geológico con traje presurizado | abanicos aluviales y dunas; pendientes rocosas y terreno abrupto |
| 6 | navegación relativa al terreno para aterrizaje de precisión; aerodinámica de helicópteros y drones con arena; desgaste y tracción de ruedas | dinámica sedimentaria y eólica; llanuras evaporíticas y gradientes térmicos extremos |
| 7 | arquitectura de misión y logística de campamento base; rover presurizado de largo alcance; comunicaciones de emergencia y perforación profunda en roca con hielo | cráter de impacto; desierto polar con brechas de impacto y hielo intersticial |
