// Posición del sol hora a hora en cada mundo, para el recorrido del día del visor. Sin DOM.
const RAD = Math.PI / 180;

export const FUENTES_SOL = {
  tierra: { texto: 'General Solar Position Calculations, NOAA Global Monitoring Division', url: 'https://gml.noaa.gov/grad/solcalc/solareqns.PDF', cita: 'cos(Φ) = sin(lat)sin(decl) + cos(lat)cos(decl)cos(ha)' },
  luna: { texto: 'Moon Fact Sheet, NASA NSSDCA', url: 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/moonfact.html', cita: 'Synodic period (days) 29.53' },
};
export const DIA_LUNAR_H = 29.53 * 24;
export const MESES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
// Criterio propio: el día 15 de cada mes (año de 365 días) representa al mes.
export const DIA_DEL_ANO = [15, 46, 74, 105, 135, 166, 196, 227, 258, 288, 319, 349];

const norm360 = (a) => ((a % 360) + 360) % 360;

// Declinación solar en grados (serie de NOAA, a mediodía del día dado).
export function declinacionSolar(diaDelAno) {
  const g = (2 * Math.PI / 365) * (diaDelAno - 1);
  return (0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g)) / RAD;
}

// lat, decl y ángulo horario en grados (0 = mediodía, positivo por la tarde). az: horario desde el norte.
export function posicionSol(lat, decl, ha) {
  const p = lat * RAD, d = decl * RAD, h = ha * RAD;
  const el = Math.asin(Math.max(-1, Math.min(1, Math.sin(p) * Math.sin(d) + Math.cos(p) * Math.cos(d) * Math.cos(h))));
  const az = Math.atan2(Math.sin(h), Math.cos(h) * Math.sin(p) - Math.tan(d) * Math.cos(p));
  return { el: el / RAD, az: norm360(az / RAD + 180) };
}

// hora = hora solar local (12 = el sol en el meridiano del lugar); mes 1-12.
export const solTierra = ({ lat, mes, hora }) => posicionSol(lat, declinacionSolar(DIA_DEL_ANO[mes - 1]), 15 * (hora - 12));

// Recorte polar (estereográfica): el acimut de rejilla del sol es la longitud subsolar, que retrocede 360° por día
// sinódico; la altura cambia con la estación, no con la hora: se deja la que marca el mando.
export const solPolar = ({ az0, el, horas, dia_h = DIA_LUNAR_H }) => ({ el, az: norm360(az0 - (360 * horas) / dia_h) });

// Sombra de un objeto de altura alto_m con el sol a el grados: null sin sol.
export const largoSombra = (alto_m, el) => (el > 0 && alto_m > 0 ? alto_m / Math.tan(el * RAD) : null);

export const horaTexto = (h) => { const m = Math.round((((h % 24) + 24) % 24) * 60) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };

// Rumbo de brújula de 8 puntas para un acimut.
export const rumboTexto = (az) => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(norm360(az) / 45) % 8];
