import express from 'express';
import cors from 'cors';
import { pool } from './db.js';
import { login, requireAuth, canAccess } from './auth.js';
import { HttpError, parseDate, parseMonday, parseEntries, fmtDate, addDays } from './validate.js';

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

export function createApp() {
  const app = express();
  const origins = (process.env.ALLOWED_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
  app.use(cors({ origin: origins.length ? origins : false }));
  app.use(express.json({ limit: '100kb' }));

  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  // semplice limitatore di tentativi di login (per IP)
  const attempts = new Map();
  app.post('/api/login', wrap(async (req, res) => {
    const key = req.ip;
    const a = attempts.get(key) || { n: 0, t: Date.now() };
    if (Date.now() - a.t > 15 * 60000) { a.n = 0; a.t = Date.now(); }
    if (a.n >= 10) throw new HttpError(429, 'Troppi tentativi, riprova tra qualche minuto');
    const token = await login(req.body?.username, req.body?.password);
    if (!token) { attempts.set(key, { n: a.n + 1, t: a.t }); throw new HttpError(401, 'Credenziali errate'); }
    attempts.delete(key);
    res.json({ token });
  }));

  app.use('/api', requireAuth);

  const guard = (req, venueId) => {
    if (!canAccess(req.user, venueId)) throw new HttpError(403, 'Locale non accessibile');
  };

  app.get('/api/me', (req, res) => res.json({ username: req.user.username, is_admin: !!req.user.is_admin }));

  app.get('/api/venues', wrap(async (req, res) => {
    const [rows] = await pool.query('SELECT id, city, name FROM venues ORDER BY city, name');
    res.json(rows.filter((v) => canAccess(req.user, v.id)));
  }));

  app.post('/api/venues', wrap(async (req, res) => {
    if (!req.user.is_admin) throw new HttpError(403, 'Solo amministratore');
    const name = String(req.body?.name || '').trim();
    const city = String(req.body?.city || 'Milano').trim();
    if (!name) throw new HttpError(400, 'Nome locale mancante');
    try {
      const [r] = await pool.query('INSERT INTO venues (city, name) VALUES (?, ?)', [city, name]);
      res.status(201).json({ id: r.insertId, city, name });
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY') throw new HttpError(409, 'Locale già esistente');
      throw e;
    }
  }));

  app.get('/api/departments', wrap(async (_req, res) => {
    const [rows] = await pool.query('SELECT id, name FROM departments ORDER BY sort_order, id');
    res.json(rows);
  }));

  // Dati completi di una settimana per un locale.
  app.get('/api/venues/:id/week', wrap(async (req, res) => {
    const id = Number(req.params.id);
    guard(req, id);
    const start = parseMonday(String(req.query.start));
    const end = addDays(start, 6);
    const [[venue]] = await pool.query('SELECT id, city, name FROM venues WHERE id = ?', [id]);
    if (!venue) throw new HttpError(404, 'Locale non trovato');
    const [employees] = await pool.query(
      'SELECT id, department_id, full_name, weekly_hours FROM employees WHERE venue_id = ? AND active = 1 ORDER BY full_name', [id]);
    const [shifts] = await pool.query(
      `SELECT s.employee_id, s.work_date AS date, s.kind, s.start_time AS start, s.end_time AS end, s.location_venue_id AS venue_id
         FROM shifts s JOIN employees e ON e.id = s.employee_id
        WHERE e.venue_id = ? AND e.active = 1 AND s.work_date BETWEEN ? AND ?
        ORDER BY s.work_date, s.employee_id, s.position`, [id, fmtDate(start), fmtDate(end)]);
    // ospiti: persone di altri locali in prestito qui; i loro turni arrivano tutti (non solo quelli di questo locale) per avere il totale delle ore
    const [guests] = await pool.query(
      `SELECT DISTINCT e.id, e.department_id, e.full_name, e.weekly_hours, e.venue_id AS home_venue_id
         FROM employees e JOIN shifts s ON s.employee_id = e.id
        WHERE s.kind = 'loan' AND s.location_venue_id = ? AND e.venue_id <> ? AND e.active = 1 AND s.work_date BETWEEN ? AND ?
        ORDER BY e.full_name`, [id, id, fmtDate(start), fmtDate(end)]);
    if (guests.length) {
      const [guestShifts] = await pool.query(
        `SELECT s.employee_id, s.work_date AS date, s.kind, s.start_time AS start, s.end_time AS end, s.location_venue_id AS venue_id
           FROM shifts s WHERE s.employee_id IN (?) AND s.work_date BETWEEN ? AND ?
          ORDER BY s.work_date, s.employee_id, s.position`, [guests.map((g) => g.id), fmtDate(start), fmtDate(end)]);
      shifts.push(...guestShifts);
    }
    const [legend] = await pool.query(
      'SELECT short_desc, description, hours FROM legend WHERE venue_id = ? ORDER BY id', [id]);
    const [venues] = await pool.query('SELECT id, city, name FROM venues ORDER BY city, name');
    res.json({ venue, venues, employees, guests, shifts, legend });
  }));

  function parseHours(v, fallback) {
    if (v === undefined || v === null || v === '') return fallback;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > 80) throw new HttpError(400, 'Ore settimanali non valide');
    return Math.round(n * 2) / 2;
  }

  async function loadEmployee(req, id) {
    const [[e]] = await pool.query('SELECT * FROM employees WHERE id = ? AND active = 1', [id]);
    if (!e) throw new HttpError(404, 'Dipendente non trovato');
    guard(req, e.venue_id);
    return e;
  }

  app.post('/api/employees', wrap(async (req, res) => {
    const { venue_id, department_id } = req.body || {};
    const full_name = String(req.body?.full_name || '').trim();
    if (!full_name) throw new HttpError(400, 'Nome mancante');
    guard(req, venue_id);
    const [[d]] = await pool.query('SELECT id FROM departments WHERE id = ?', [department_id]);
    const [[v]] = await pool.query('SELECT id FROM venues WHERE id = ?', [venue_id]);
    if (!d || !v) throw new HttpError(400, 'Locale o reparto non valido');
    const weekly_hours = parseHours(req.body?.weekly_hours, 0);
    const [r] = await pool.query('INSERT INTO employees (venue_id, department_id, full_name, weekly_hours) VALUES (?, ?, ?, ?)',
      [venue_id, department_id, full_name, weekly_hours]);
    res.status(201).json({ id: r.insertId, department_id, full_name, weekly_hours });
  }));

  app.put('/api/employees/:id', wrap(async (req, res) => {
    const e = await loadEmployee(req, Number(req.params.id));
    const full_name = String(req.body?.full_name ?? e.full_name).trim();
    const department_id = req.body?.department_id ?? e.department_id;
    if (!full_name) throw new HttpError(400, 'Nome mancante');
    const [[d]] = await pool.query('SELECT id FROM departments WHERE id = ?', [department_id]);
    if (!d) throw new HttpError(400, 'Reparto non valido');
    const weekly_hours = parseHours(req.body?.weekly_hours, e.weekly_hours);
    await pool.query('UPDATE employees SET full_name = ?, department_id = ?, weekly_hours = ? WHERE id = ?', [full_name, department_id, weekly_hours, e.id]);
    res.json({ id: e.id, department_id, full_name, weekly_hours });
  }));

  // eliminazione "morbida": lo storico dei turni resta nel database
  app.delete('/api/employees/:id', wrap(async (req, res) => {
    const e = await loadEmployee(req, Number(req.params.id));
    await pool.query('UPDATE employees SET active = 0 WHERE id = ?', [e.id]);
    res.status(204).end();
  }));

  // Sostituisce le voci di una giornata di un dipendente.
  app.put('/api/employees/:id/day', wrap(async (req, res) => {
    const e = await loadEmployee(req, Number(req.params.id));
    const date = fmtDate(parseDate(req.body?.date));
    const entries = parseEntries(req.body?.entries, e.venue_id);
    for (const x of entries) {
      if (x.kind !== 'loan') continue;
      const [[v]] = await pool.query('SELECT id FROM venues WHERE id = ?', [x.venue]);
      if (!v) throw new HttpError(400, 'Locale del prestito non trovato');
    }
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      // serializza i salvataggi dello stesso dipendente (evita deadlock tra richieste concorrenti)
      await conn.query('SELECT id FROM employees WHERE id = ? FOR UPDATE', [e.id]);
      await conn.query('DELETE FROM shifts WHERE employee_id = ? AND work_date = ?', [e.id, date]);
      for (let i = 0; i < entries.length; i++) {
        const x = entries[i];
        await conn.query(
          'INSERT INTO shifts (employee_id, work_date, position, kind, start_time, end_time, location_venue_id) VALUES (?,?,?,?,?,?,?)',
          [e.id, date, i, x.kind, x.start, x.end, x.venue]);
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
    res.json({ ok: true });
  }));

  // Copia i turni di una settimana su un'altra (sostituisce quella di destinazione).
  app.post('/api/venues/:id/copy-week', wrap(async (req, res) => {
    const id = Number(req.params.id);
    guard(req, id);
    const from = parseMonday(String(req.body?.from));
    const to = parseMonday(String(req.body?.to));
    if (from.getTime() === to.getTime()) throw new HttpError(400, 'Settimane uguali');
    const shift = Math.round((to - from) / 86400000);
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query(
        `DELETE s FROM shifts s JOIN employees e ON e.id = s.employee_id
          WHERE e.venue_id = ? AND s.work_date BETWEEN ? AND ?`, [id, fmtDate(to), fmtDate(addDays(to, 6))]);
      const [r] = await conn.query(
        `INSERT INTO shifts (employee_id, work_date, position, kind, start_time, end_time, location_venue_id)
         SELECT s.employee_id, DATE_ADD(s.work_date, INTERVAL ? DAY), s.position, s.kind, s.start_time, s.end_time, s.location_venue_id
           FROM shifts s JOIN employees e ON e.id = s.employee_id
          WHERE e.venue_id = ? AND e.active = 1 AND s.work_date BETWEEN ? AND ?`,
        [shift, id, fmtDate(from), fmtDate(addDays(from, 6))]);
      await conn.commit();
      res.json({ copied: r.affectedRows });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }));

  app.put('/api/venues/:id/legend', wrap(async (req, res) => {
    const id = Number(req.params.id);
    guard(req, id);
    const items = req.body?.items;
    if (!Array.isArray(items) || items.length > 30) throw new HttpError(400, 'Legenda non valida');
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query('DELETE FROM legend WHERE venue_id = ?', [id]);
      for (const it of items) {
        const short = String(it?.short_desc || '').trim().slice(0, 40);
        if (!short) continue;
        await conn.query('INSERT INTO legend (venue_id, short_desc, description, hours) VALUES (?,?,?,?)',
          [id, short, String(it.description || '').slice(0, 160), String(it.hours || '').slice(0, 60)]);
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
    res.json({ ok: true });
  }));

  app.use((err, _req, res, _next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Errore interno' });
  });
  return app;
}
