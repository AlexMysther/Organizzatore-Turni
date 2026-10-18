# Organizzatore Turni

App per pianificare i turni settimanali dei dipendenti di più locali (Viale Tunisia, Via Pola, Via Feltre, …) e generare il PDF "Ordine di servizio" condivisibile (WhatsApp, mail, …). Pensata per l'uso da telefono in verticale.

- `web/` – frontend statico (JS puro, nessuna build) pubblicato su **GitHub Pages**. Il PDF è creato nel browser (jsPDF, incluso in `web/vendor/`).
- `server/` – API Node/Express collegata a **MySQL**. Serve perché GitHub Pages è solo statico e il browser non può parlare direttamente con MySQL.

## Modello dati (MySQL)
`venues` (locali) → `employees` (dipendenti, reparto + locale di appartenenza) → `shifts` (turni: `work`, `rest`, `loan` = prestito in un altro locale).
Più `departments`, `legend` (legenda del PDF per locale), `users` e `user_venues` (per l'espansione: ogni manager vede solo i propri locali; l'amministratore vede tutto).

## Avvio in locale
Serve un MySQL raggiungibile (anche locale). Con Node 20.6+:
```bash
cd server && npm install
cp .env.example .env    # compila i valori
node --env-file=.env src/index.js
cd ../web && python3 -m http.server 8080
```
Le tabelle e il primo utente (`ADMIN_USER`/`ADMIN_PASSWORD`) vengono creati all'avvio.
Test: `DATABASE_URL=mysql://utente:pw@localhost:3306/turni_test npm test` (l'utente deve poter creare il database `turni_test`, che viene ricreato a ogni esecuzione).

## Variabili d'ambiente del server
Vanno impostate sul servizio che ospita `server/` (mai nel repository): vedi `server/.env.example`.
Con Aiven: `DATABASE_URL` è il *Service URI* (con `?ssl-mode=REQUIRED`) e `DB_CA` il contenuto del certificato CA del servizio.

## Messa online
1. **Database**: MySQL su Aiven.
2. **API**: servizio dalla cartella `server/` (avvio: `node src/index.js`, controllo di salute: `/api/health`) con le variabili sopra; `ALLOWED_ORIGIN` = URL di GitHub Pages.
3. **Frontend**: in `web/js/config.js` imposta `API_URL` con l'indirizzo pubblico dell'API.
4. **GitHub Pages**: Settings → Pages → Source: *GitHub Actions*. Il workflow `.github/workflows/pages.yml` pubblica `web/` a ogni push su `main`.
5. Sul telefono apri il sito e usa "Aggiungi a schermata Home".
