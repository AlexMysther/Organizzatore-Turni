export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function parseDate(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) throw new HttpError(400, 'Data non valida (AAAA-MM-GG)');
  const d = new Date(s + 'T00:00:00Z');
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) throw new HttpError(400, 'Data non valida');
  return d;
}

export const fmtDate = (d) => d.toISOString().slice(0, 10);
export const addDays = (d, n) => new Date(d.getTime() + n * 86400000);

export function parseMonday(s) {
  const d = parseDate(s);
  if (d.getUTCDay() !== 1) throw new HttpError(400, 'La settimana deve iniziare di lunedì');
  return d;
}

// Normalizza e valida le voci di una giornata di un dipendente.
export function parseEntries(entries, homeVenueId) {
  if (!Array.isArray(entries) || entries.length > 3) throw new HttpError(400, 'Voci non valide (max 3)');
  const out = entries.map((e) => {
    if (!e || !['work', 'rest', 'loan'].includes(e.kind)) throw new HttpError(400, 'Tipo di voce non valido');
    const start = e.start || null;
    const end = e.end || null;
    for (const t of [start, end]) if (t && !TIME_RE.test(t)) throw new HttpError(400, 'Orario non valido (HH:MM)');
    if (e.kind === 'rest') return { kind: 'rest', start: null, end: null, venue: null };
    if (e.kind === 'work') {
      if (!start || !end) throw new HttpError(400, 'Turno: servono inizio e fine');
      return { kind: 'work', start, end, venue: null };
    }
    const venue = Number(e.venue_id);
    if (!Number.isInteger(venue) || venue === homeVenueId) throw new HttpError(400, 'Prestito: scegli un altro locale');
    if (Boolean(start) !== Boolean(end)) throw new HttpError(400, 'Prestito: indica inizio e fine, oppure nessuno dei due');
    return { kind: 'loan', start, end, venue };
  });
  if (out.some((e) => e.kind === 'rest') && out.length > 1) throw new HttpError(400, 'Il riposo non si combina con altri turni');
  return out;
}
