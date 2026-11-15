// Modo de lectura: «simple» esconde .solo-fondo, «fondo» (In depth, por defecto) esconde .solo-simple. Lo aplica marca.css.
export const MODOS = ['simple', 'fondo'];
export const POR_DEFECTO = 'fondo';
export const CLAVE = 'analog-zero.mode';
const ROTULO = { simple: 'Simple', fondo: 'In depth' };

export const modoValido = (m) => typeof m === 'string' && MODOS.includes(m);

// Prioridad: ?modo= de la URL, luego lo guardado, luego In depth.
export function leerModo(search, guardado) {
  const url = new URLSearchParams(search ?? '').get('modo');
  if (modoValido(url)) return url;
  return modoValido(guardado) ? guardado : POR_DEFECTO;
}

function guardar(m) { try { localStorage.setItem(CLAVE, m); } catch { /* sin almacenamiento: vale para esta página */ } }

function montar() {
  const raiz = document.documentElement;
  let guardado = null;
  try { guardado = localStorage.getItem(CLAVE); } catch { /* idem */ }
  const enUrl = modoValido(new URLSearchParams(location.search).get('modo'));
  const botones = [];
  const poner = (m) => {
    if (!modoValido(m)) return;
    raiz.dataset.modo = m;
    guardar(m);
    for (const b of botones) b.setAttribute('aria-pressed', String(b.dataset.valor === m));
  };
  raiz.dataset.modo = leerModo(location.search, guardado);
  if (enUrl) guardar(raiz.dataset.modo);
  window.__azModo = { poner, leer: () => raiz.dataset.modo };

  const insertar = () => {
    const barra = document.querySelector('.marca-barra');
    if (!barra || barra.querySelector('.marca-modo')) return;
    const g = document.createElement('span');
    g.className = 'marca-modo';
    g.setAttribute('role', 'group');
    g.setAttribute('aria-label', 'Reading mode');
    for (const m of MODOS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.valor = m;
      b.textContent = ROTULO[m];
      b.setAttribute('aria-pressed', String(raiz.dataset.modo === m));
      b.addEventListener('click', () => poner(m));
      botones.push(b);
      g.append(b);
    }
    const hueco = barra.querySelector('.hueco');
    if (hueco) hueco.after(g); else barra.append(g);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', insertar, { once: true });
  else insertar();
}

if (typeof document !== 'undefined') montar();
