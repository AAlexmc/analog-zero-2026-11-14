// Botón «See the terrain»: carga el relieve y, si llega, pone la vista 3D encima del globo; si no, deja el globo y un aviso.
// Devuelve { abrir, cerrar, encajar } para abrirlo sin el botón.
import { webglDisponible } from '../portada/espacio.js';
import { abrirRelieve } from './vista.js';

let conCss = false;

// punto() → { lat, lon, titulo, celda? } o null; mundo: id o función que lo devuelve; alCambiar(cb): avisa si se mueve el punto.
// hueco() → { right, bottom } en px: margen que la vista deja libre (p. ej. el panel de resultados).
export function engancharRelieve({ boton, aviso, mundo, punto, alCambiar = null, hueco = null }) {
  if (!conCss) {
    conCss = true;
    document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: new URL('relieve.css', import.meta.url).href }));
  }
  const R = ((window.__az ??= {}).relieve ??= {});
  R.estado = 'cerrado';
  if (!webglDisponible()) { boton.hidden = true; return { abrir: async () => false, cerrar: () => {}, encajar: () => {} }; }
  alCambiar?.(() => { if (R.estado !== 'cargando') aviso.hidden = true; });
  const texto = boton.textContent;
  let abierta = null, capa = null;

  const cerrada = (foco = true) => {
    capa?.remove();
    capa = abierta = null;
    R.estado = 'cerrado';
    if (foco) boton.focus();
  };
  const encajar = () => {
    if (!capa || !hueco) return;
    const h = hueco();
    Object.assign(capa.style, { right: `${h.right}px`, bottom: `${h.bottom}px` });
  };
  addEventListener('resize', encajar);
  async function abrir() {
    const p = punto();
    if (!p || abierta || R.estado === 'cargando') return false;
    aviso.hidden = true;
    aviso.textContent = '';
    boton.disabled = true;
    boton.textContent = 'Loading terrain…';
    Object.assign(R, { estado: 'cargando', mensaje: null, causa: null });
    capa = Object.assign(document.createElement('div'), { className: 'relieve-capa' });
    capa.setAttribute('role', 'dialog');
    capa.setAttribute('aria-label', `Terrain around ${p.titulo}`);
    document.body.append(capa);
    encajar();
    try {
      abierta = await abrirRelieve(capa, { mundo: typeof mundo === 'function' ? mundo() : mundo, ...p, alVolver: cerrada });
      requestAnimationFrame(() => capa?.classList.add('visible'));
      abierta.volver.focus();
      R.estado = 'abierto';
      return true;
    } catch (e) {
      capa.remove();
      capa = null;
      aviso.textContent = e.message;
      aviso.hidden = false;
      Object.assign(R, { estado: 'error', mensaje: e.message, causa: e.causa ?? String(e.stack ?? '') });
      return false;
    } finally {
      boton.disabled = false;
      boton.textContent = texto;
    }
  }
  boton.addEventListener('click', abrir);
  const cerrar = (foco = false) => { if (abierta) { abierta.cerrar(); cerrada(foco); } };
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') cerrar(true);
  });
  return { abrir, cerrar, encajar };
}
