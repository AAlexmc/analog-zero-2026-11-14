// Botón «See the terrain»: carga el relieve y, si llega, pone la vista 3D encima del globo; si no, deja el globo y un aviso.
import { webglDisponible } from '../portada/espacio.js';
import { abrirRelieve } from './vista.js';

let conCss = false;

// punto() → { lat, lon, titulo, celda? } o null; mundo: id o función que lo devuelve; alCambiar(cb): avisa si se mueve el punto.
export function engancharRelieve({ boton, aviso, mundo, punto, alCambiar = null }) {
  if (!conCss) {
    conCss = true;
    document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: new URL('relieve.css', import.meta.url).href }));
  }
  const R = ((window.__az ??= {}).relieve ??= {});
  R.estado = 'cerrado';
  if (!webglDisponible()) { boton.hidden = true; return; }
  alCambiar?.(() => { if (R.estado !== 'cargando') aviso.hidden = true; });
  const texto = boton.textContent;
  let abierta = null, capa = null;

  const cerrada = () => {
    capa?.remove();
    capa = abierta = null;
    R.estado = 'cerrado';
    boton.focus();
  };
  boton.addEventListener('click', async () => {
    const p = punto();
    if (!p || abierta || R.estado === 'cargando') return;
    aviso.hidden = true;
    aviso.textContent = '';
    boton.disabled = true;
    boton.textContent = 'Loading terrain…';
    Object.assign(R, { estado: 'cargando', mensaje: null, causa: null });
    capa = Object.assign(document.createElement('div'), { className: 'relieve-capa' });
    capa.setAttribute('role', 'dialog');
    capa.setAttribute('aria-label', `Terrain around ${p.titulo}`);
    document.body.append(capa);
    try {
      abierta = await abrirRelieve(capa, { mundo: typeof mundo === 'function' ? mundo() : mundo, ...p, alVolver: cerrada });
      requestAnimationFrame(() => capa?.classList.add('visible'));
      abierta.volver.focus();
      R.estado = 'abierto';
    } catch (e) {
      capa.remove();
      capa = null;
      aviso.textContent = e.message;
      aviso.hidden = false;
      Object.assign(R, { estado: 'error', mensaje: e.message, causa: e.causa ?? String(e.stack ?? '') });
    } finally {
      boton.disabled = false;
      boton.textContent = texto;
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && abierta) { abierta.cerrar(); cerrada(); }
  });
}
