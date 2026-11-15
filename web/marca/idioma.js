// Idioma de la pantalla: inglés (el del código, por defecto) o español. En español se traduce lo ya pintado: cada texto se
// busca en el diccionario (es.js) con sus cifras cambiadas por «#»; lo que no está se queda en inglés. Las citas literales
// de las fuentes no se traducen nunca (no están en el diccionario y lo marcado con data-notr no se toca).
export const IDIOMAS = ['en', 'es'];
export const POR_DEFECTO = 'en';
export const CLAVE = 'analog-zero.lang';
const ROTULO = { en: 'EN', es: 'ES' };
const NOMBRE = { en: 'English', es: 'Español' };
const NUM = /\d+(?:[.,]\d+)*/g;
// data-titulo: rótulo que alguna pantalla pinta desde CSS con attr().
const ATRIBUTOS = ['aria-label', 'title', 'placeholder', 'data-titulo'];
const SIN_TRADUCIR = '[data-notr], script, style, code, q, blockquote';
const TOPE_FALLOS = 4000;

export const idiomaValido = (x) => typeof x === 'string' && IDIOMAS.includes(x);

// Prioridad: ?lang= de la URL, luego lo guardado, luego inglés.
export function leerIdioma(search, guardado) {
  const url = new URLSearchParams(search ?? '').get('lang');
  if (idiomaValido(url)) return url;
  return idiomaValido(guardado) ? guardado : POR_DEFECTO;
}

// Plantilla de un texto: espacios compactados y cada cifra por «#» (así una frase vale para cualquier número).
export function plantilla(texto) {
  const nums = [];
  const t = String(texto).replace(/\s+/g, ' ').trim().replace(NUM, (m) => { nums.push(m); return '#'; });
  return { t, nums };
}

// dic = { textos: Map(plantilla en → es), patrones: [[RegExp, 'es con $1…']] }. Devuelve la traducción o null si no hay.
// En la traducción «#» toma las cifras por orden y «#2» la segunda (cuando el español las cambia de sitio).
// Un patrón se prueba sobre el texto con sus cifras; lo que captura se traduce a su vez si está en el diccionario.
export function traducir(texto, dic, fallos = null, fondo = 0) {
  if (typeof texto !== 'string' || !/[A-Za-z]/.test(texto)) return null;
  const ini = texto.match(/^\s*/)[0], fin = texto.match(/\s*$/)[0];
  const { t, nums } = plantilla(texto);
  const es = dic.textos.get(t);
  if (es !== undefined) {
    let k = 0;
    return ini + es.replace(/#(\d)?/g, (_, n) => nums[n ? n - 1 : k++] ?? '') + fin;
  }
  if (fallos?.has(t) || fondo > 2 || t.length > 600) return null;
  const plano = texto.replace(/\s+/g, ' ').trim();
  for (const [re, salida] of dic.patrones ?? []) {
    const m = re.exec(plano);
    if (!m) continue;
    return ini + salida.replace(/\$(\d)/g, (_, n) => { const g = m[+n] ?? ''; return traducir(g, dic, null, fondo + 1) ?? g; }) + fin;
  }
  if (fallos && fallos.size < TOPE_FALLOS) fallos.add(t);
  return null;
}

export function diccionario({ TEXTOS = {}, PATRONES = [] } = {}) {
  return { textos: new Map(Object.entries(TEXTOS).map(([k, v]) => [plantilla(k).t, v])), patrones: PATRONES };
}

function guardar(v) { try { localStorage.setItem(CLAVE, v); } catch { /* sin almacenamiento: vale para esta página */ } }

function montar() {
  const raiz = document.documentElement;
  let guardado = null;
  try { guardado = localStorage.getItem(CLAVE); } catch { /* idem */ }
  const idioma = leerIdioma(location.search, guardado);
  if (idiomaValido(new URLSearchParams(location.search).get('lang'))) guardar(idioma);
  raiz.lang = idioma;
  raiz.dataset.idioma = idioma;
  const estado = { idioma, listo: idioma === 'en', traducidos: 0, sinTraducir: () => [] };

  // Cambiar de idioma recarga la página con el nuevo: así todo lo pintado sale del mismo sitio.
  const poner = (v) => {
    if (!idiomaValido(v) || v === estado.idioma) return;
    guardar(v);
    const u = new URL(location.href);
    u.searchParams.delete('lang');
    location.replace(u.href);
  };
  window.__azIdioma = { poner, leer: () => estado.idioma, estado };

  const insertar = () => {
    const barra = document.querySelector('.marca-barra');
    if (!barra || barra.querySelector('.marca-idioma')) return;
    const g = document.createElement('span');
    g.className = 'marca-modo marca-idioma';
    g.dataset.notr = '';
    g.setAttribute('role', 'group');
    g.setAttribute('aria-label', 'Language');
    for (const v of IDIOMAS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.valor = v;
      b.textContent = ROTULO[v];
      b.title = NOMBRE[v];
      b.lang = v;
      b.setAttribute('aria-pressed', String(v === estado.idioma));
      b.addEventListener('click', () => poner(v));
      g.append(b);
    }
    const tras = barra.querySelector('.marca-modo:not(.marca-idioma)') ?? barra.querySelector('.hueco');
    if (tras) tras.after(g); else barra.append(g);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', insertar, { once: true });
  else insertar();
  // modo.js puede insertar su conmutador después: el de idioma se recoloca a su lado.
  queueMicrotask(() => setTimeout(() => { const b = document.querySelector('.marca-barra'), m = b?.querySelector('.marca-modo:not(.marca-idioma)'), g = b?.querySelector('.marca-idioma'); if (m && g && m.nextElementSibling !== g) m.after(g); }, 0));

  if (idioma !== 'es') return;
  import('./es.js').then((mod) => {
    const dic = diccionario(mod), fallos = new Set(), puesto = new WeakMap();
    const texto = (n) => {
      const p = n.parentElement;
      if (!p || p.closest(SIN_TRADUCIR)) return;
      const v = n.nodeValue;
      if (puesto.get(n) === v) return;
      const es = traducir(v, dic, fallos);
      if (es !== null && es !== v) { puesto.set(n, es); n.nodeValue = es; estado.traducidos++; }
    };
    const puestoAtr = new WeakMap();
    const atributos = (el) => {
      if (el.closest(SIN_TRADUCIR)) return;
      for (const a of ATRIBUTOS) {
        const v = el.getAttribute(a);
        if (!v || puestoAtr.get(el)?.[a] === v) continue;
        const es = traducir(v, dic, fallos);
        if (es !== null && es !== v) { puestoAtr.set(el, { ...puestoAtr.get(el), [a]: es }); el.setAttribute(a, es); }
      }
    };
    const recorrer = (raizNodo) => {
      if (raizNodo.nodeType === Node.TEXT_NODE) { texto(raizNodo); return; }
      if (raizNodo.nodeType !== Node.ELEMENT_NODE) return;
      atributos(raizNodo);
      const w = document.createTreeWalker(raizNodo, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
      for (let n = w.nextNode(); n; n = w.nextNode()) { if (n.nodeType === Node.TEXT_NODE) texto(n); else atributos(n); }
    };
    const titulo = traducir(document.title, dic, fallos);
    if (titulo) document.title = titulo;
    recorrer(document.body);
    new MutationObserver((cambios) => {
      for (const c of cambios) {
        if (c.type === 'characterData') texto(c.target);
        else if (c.type === 'attributes') atributos(c.target);
        else for (const n of c.addedNodes) recorrer(n);
      }
    }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATRIBUTOS });
    // Para los guiones: plantillas vistas que no están en el diccionario.
    estado.sinTraducir = () => [...fallos];
    estado.listo = true;
  }).catch((e) => { estado.error = String(e?.message ?? e); estado.listo = true; });
}

if (typeof document !== 'undefined') montar();
