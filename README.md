# Organizzatore Turni

App per pianificare i turni settimanali dei dipendenti di più locali (Viale Tunisia, Via Pola, Via Feltre, …) e generare il PDF "Ordine di servizio" condivisibile (WhatsApp, mail, …). Pensata per l'uso da telefono in verticale.

- `web/` – frontend statico (JS puro, nessuna build) pubblicato su **GitHub Pages**. Il PDF è creato nel browser (jsPDF, incluso in `web/vendor/`).
- `server/` – API Node/Express collegata a **MySQL**. Serve perché GitHub Pages è solo statico e il browser non può parlare direttamente con MySQL.

## Modello dati (MySQL)
`venues` (locali) → `employees` (dipendenti, reparto + locale di appartenenza) → `shifts` (turni: `work`, `rest`, `loan` = prestito in un altro locale).
Più `departments`, `legend` (legenda del PDF per locale), `users` e `user_venues` (per l'espansione: ogni manager vede solo i propri locali; l'amministratore vede tutto).

## Avvio in locale
```bash
cd server && npm install
cp .env.example .env   # poi esporta le variabili (o usa un gestore di .env)
DATABASE_URL=mysql://utente:pw@localhost:3306/turni JWT_SECRET=... ADMIN_PASSWORD=... \
  ALLOWED_ORIGIN=http://localhost:8080 npm start
cd ../web && python3 -m http.server 8080
```
Le tabelle e il primo utente (`ADMIN_USER`/`ADMIN_PASSWORD`) vengono creati all'avvio. Test: `cd server && npm test` (richiede MySQL/MariaDB con un utente che possa creare il database `turni_test`; `DATABASE_URL` punta a un database qualsiasi dello stesso server).

## Messa online
1. **API + MySQL**: su un servizio come Railway/Render crea un database MySQL e un servizio dalla cartella `server/` con le variabili di `server/.env.example` (`ALLOWED_ORIGIN` = URL di GitHub Pages, es. `https://alexmysther.github.io`).
2. **Frontend**: in `web/js/config.js` imposta `API_URL` con l'indirizzo pubblico dell'API.
3. **GitHub Pages**: Settings → Pages → Source: *GitHub Actions*. Il workflow `.github/workflows/pages.yml` pubblica `web/` a ogni push su `main`.
4. Sul telefono apri il sito e usa "Aggiungi a schermata Home".
