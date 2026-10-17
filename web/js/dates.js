export const DAYS = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];
export const MONTHS = ['GEN', 'FEB', 'MAR', 'APR', 'MAG', 'GIU', 'LUG', 'AGO', 'SET', 'OTT', 'NOV', 'DIC'];

const pad = (n) => String(n).padStart(2, '0');

// Tutte le date sono "AAAA-MM-GG" e i calcoli avvengono in UTC (nessun problema di fuso/ora legale).
export const parse = (s) => new Date(s + 'T00:00:00Z');
export const fmt = (d) => d.toISOString().slice(0, 10);
export const addDays = (s, n) => fmt(new Date(parse(s).getTime() + n * 86400000));
export const weekDates = (monday) => Array.from({ length: 7 }, (_, i) => addDays(monday, i));
export const dayOfMonth = (s) => Number(s.slice(8, 10));
export const monthIdx = (s) => Number(s.slice(5, 7)) - 1;
export const itDate = (s) => `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;

export function mondayOf(s) {
  const dow = (parse(s).getUTCDay() + 6) % 7; // 0 = lunedì
  return addDays(s, -dow);
}

// Numero di settimana ISO 8601 (la settimana contenente il giovedì).
export function isoWeek(monday) {
  const thursday = parse(addDays(monday, 3));
  const jan1 = Date.UTC(thursday.getUTCFullYear(), 0, 1);
  return Math.floor((thursday - jan1) / 86400000 / 7) + 1;
}

export function todayLocal() {
  const n = new Date();
  return `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}`;
}

// Settimana da mostrare all'apertura: nel weekend si prepara già la successiva.
export function defaultWeek() {
  const t = todayLocal();
  const monday = mondayOf(t);
  const dow = (parse(t).getUTCDay() + 6) % 7;
  return dow >= 5 ? addDays(monday, 7) : monday;
}

export function weekLabel(monday) {
  const end = addDays(monday, 6);
  const a = `${dayOfMonth(monday)} ${MONTHS[monthIdx(monday)].toLowerCase()}`;
  const b = `${dayOfMonth(end)} ${MONTHS[monthIdx(end)].toLowerCase()}`;
  return `${a} – ${b}`;
}

export function fileWeekLabel(monday) {
  const end = addDays(monday, 6);
  const same = monthIdx(monday) === monthIdx(end);
  return same
    ? `${pad(dayOfMonth(monday))}-${pad(dayOfMonth(end))}_${MONTHS_FULL[monthIdx(end)]}`
    : `${pad(dayOfMonth(monday))}${MONTHS[monthIdx(monday)]}-${pad(dayOfMonth(end))}${MONTHS[monthIdx(end)]}`;
}
const MONTHS_FULL = ['GENNAIO', 'FEBBRAIO', 'MARZO', 'APRILE', 'MAGGIO', 'GIUGNO', 'LUGLIO', 'AGOSTO', 'SETTEMBRE', 'OTTOBRE', 'NOVEMBRE', 'DICEMBRE'];
