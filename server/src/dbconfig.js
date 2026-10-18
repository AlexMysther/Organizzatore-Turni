// Costruisce la configurazione di connessione da DATABASE_URL (es. quella di Aiven):
//   mysql://utente:password@host:porta/database?ssl-mode=REQUIRED
// Con ?ssl-mode=... serve DB_CA, il certificato CA del servizio (Aiven: "CA certificate"):
// la connessione è sempre cifrata e il certificato del server viene verificato.
export function parseDbConfig(env = process.env) {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL mancante');
  const url = new URL(env.DATABASE_URL);
  const config = {
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.slice(1)),
  };
  const mode = url.searchParams.get('ssl-mode');
  if (mode || env.DB_CA) {
    if (!env.DB_CA) throw new Error('La connessione richiede TLS: imposta DB_CA con il certificato CA del database');
    // le variabili d'ambiente spesso contengono i ritorni a capo come "\n"
    config.ssl = { ca: env.DB_CA.replace(/\\n/g, '\n'), rejectUnauthorized: true };
  }
  return config;
}
