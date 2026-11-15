# 30-second video script

**Flow:** home → world (step 1: mission and month) → best base site → analogs on Earth → Calendar → terrain. It is one run on the Moon, from the south pole to Earth and back.

**Narration:** in English, under 75 words in total (count by spaces at the end).

**Captures:** every screen is a capture of the running app on real data. `capturas/` is not in the repository, so each capture is made by the script named in its row.

| Seconds | Screen | Capture (script → file) | Narration |
|---|---|---|---|
| 0–4 | Home, Moon selected | `scripts/captura_portada.mjs` → `capturas/portada/01-portada-luna.png` | Before hardware flies to the Moon or Mars, where on Earth do you test it? |
| 4–8 | The Moon in 3D: step 1 (mission objective and «When»), point placed at the south pole | `scripts/captura_portada.mjs` → `capturas/portada/06-luna-polo-sur.png` | Pick a world, a mission, a month and a spot. |
| 8–12 | Best base site found with NASA's criteria | `scripts/captura_sitio.mjs` → `capturas/sitio/07-luna-auto.png` | It finds the best base site by NASA's criteria. |
| 12–18 | Most similar places on Earth, Shackleton rim | `scripts/captura_analogos.mjs` → `capturas/analogos/08-shackleton-lugares.png` | Then it searches all of Earth: what matches, how much, and what Earth cannot reproduce. |
| 18–24 | Calendar tab: the mission's lidar within its limits only in July, and the best place on Earth each month | `scripts/captura_equipo_mes.mjs` → `capturas/equipo_mes/01-lidar-artico.png` | Calendar checks your equipment month by month: when it works, and where to test. |
| 24–30 | Terrain viewer, equipment planted on real terrain | `scripts/captura_base.mjs` → `capturas/base/01-base-generada.png` | Plant your equipment and see what breaks. Fail here, not there. |

Word count of the narration: 15 + 10 + 9 + 15 + 14 + 11 = 74.

## Notes

- `scripts/video_demo.mjs` already builds a 30-second video from captures, with another script centred on the terrain viewer. This file is the script for the new flow; it does not change that video.
- «Fail here, not there» comes from the last line of the current video (`scripts/video_demo.mjs`, `GUION`).
- Mars could replace the Moon in rows 2 to 5, with captures from the same scripts:
  - `capturas/portada/09-marte-jezero.png`
  - `capturas/sitio/01-marte-auto.png`
  - `capturas/analogos/02-jezero-lugares.png`
  - `capturas/meses/03-calendar-plan.png` (`scripts/captura_meses.mjs`)

  The terrain viewer only has the Moon next to Earth.
- The Calendar row replaces the portfolio row (`scripts/captura_cartera.mjs` → `capturas/cartera/shackleton-2-portfolio.png`); the portfolio stays on slide 4 of the pitch. Its capture is another Moon point (89.45° S, 137.15° W) with the mission «Laser and camera 3D mapping» and July, not the south pole of rows 2 to 4.
- No figure is spoken, so nothing in the narration goes out of date if the data are rebuilt.
