import { API_URL } from './config.js';

const KEY = 'turni.token';
export const getToken = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
export const setToken = (t) => { try { t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY); } catch { /* storage non disponibile */ } };

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function call(method, path, body) {
  let res;
  try {
    res = await fetch(API_URL + path, {
      method,
      headers: { 'content-type': 'application/json', ...(getToken() ? { authorization: 'Bearer ' + getToken() } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'Server non raggiungibile. Controlla la connessione.');
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || 'Errore del server');
  return data;
}

export const api = {
  login: (username, password) => call('POST', '/api/login', { username, password }),
  venues: () => call('GET', '/api/venues'),
  addVenue: (city, name) => call('POST', '/api/venues', { city, name }),
  departments: () => call('GET', '/api/departments'),
  week: (venueId, start) => call('GET', `/api/venues/${venueId}/week?start=${start}`),
  addEmployee: (venue_id, department_id, full_name, weekly_hours) => call('POST', '/api/employees', { venue_id, department_id, full_name, weekly_hours }),
  updateEmployee: (id, full_name, department_id, weekly_hours) => call('PUT', `/api/employees/${id}`, { full_name, department_id, weekly_hours }),
  deleteEmployee: (id) => call('DELETE', `/api/employees/${id}`),
  saveDay: (id, date, entries) => call('PUT', `/api/employees/${id}/day`, { date, entries }),
  copyWeek: (venueId, from, to) => call('POST', `/api/venues/${venueId}/copy-week`, { from, to }),
  saveLegend: (venueId, items) => call('PUT', `/api/venues/${venueId}/legend`, { items }),
};
