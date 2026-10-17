import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from './db.js';

const SECRET = process.env.JWT_SECRET;

export function assertConfig() {
  if (!SECRET || SECRET.length < 16) throw new Error('JWT_SECRET mancante o troppo corto (min 16 caratteri)');
}

// Crea il primo manager (admin) dalle variabili d'ambiente se non esiste nessun utente.
export async function seedAdmin() {
  const [[{ n }]] = await pool.query('SELECT COUNT(*) n FROM users');
  if (n > 0) return;
  const user = process.env.ADMIN_USER || 'manager';
  const pass = process.env.ADMIN_PASSWORD;
  if (!pass || pass.length < 8) throw new Error('ADMIN_PASSWORD mancante o troppo corta (min 8 caratteri)');
  await pool.query('INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, 1)', [
    user,
    await bcrypt.hash(pass, 10),
  ]);
}

export async function login(username, password) {
  const [[u]] = await pool.query('SELECT * FROM users WHERE username = ?', [username || '']);
  // confronto sempre eseguito per non rivelare se l'utente esiste
  const ok = await bcrypt.compare(password || '', u?.password_hash || '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvali');
  if (!u || !ok) return null;
  return jwt.sign({ uid: u.id }, SECRET, { expiresIn: '30d' });
}

export async function requireAuth(req, res, next) {
  try {
    const h = req.headers.authorization || '';
    const payload = jwt.verify(h.replace(/^Bearer /, ''), SECRET);
    const [[u]] = await pool.query('SELECT id, username, is_admin FROM users WHERE id = ?', [payload.uid]);
    if (!u) throw new Error('utente');
    if (u.is_admin) u.venues = null; // null = tutti
    else {
      const [rows] = await pool.query('SELECT venue_id FROM user_venues WHERE user_id = ?', [u.id]);
      u.venues = rows.map((r) => r.venue_id);
    }
    req.user = u;
    next();
  } catch {
    res.status(401).json({ error: 'Non autorizzato' });
  }
}

export const canAccess = (user, venueId) => user.venues === null || user.venues.includes(Number(venueId));
