import { initSchema } from './db.js';
import { assertConfig, seedAdmin } from './auth.js';
import { createApp } from './app.js';

assertConfig();
await initSchema();
await seedAdmin();
const port = process.env.PORT || 3000;
createApp().listen(port, () => console.log(`API turni in ascolto sulla porta ${port}`));
