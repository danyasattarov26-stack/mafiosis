// Runs the database migrations during `npm run build` (so every Vercel deploy upgrades the schema).
// Without a database URL it does nothing, and a failure only warns: the API also migrates on first use.
import { dbUrl, pgConfig, migrate, MIGRATIONS } from '../api/_db.js';

const url = dbUrl(true);
if (!url) {
  console.log('[migrate] no database configured, skipping (saves stay on the device)');
  process.exit(0);
}
try {
  const { default: Pg } = await import('pg');
  const client = new Pg.Client(pgConfig(url));
  await client.connect();
  const before = await migrate(client, m => console.log('[migrate]', m));
  console.log(`[migrate] schema at version ${MIGRATIONS.length} (was ${before >= MIGRATIONS.length ? MIGRATIONS.length : 'older'})`);
  await client.end();
} catch (e) {
  console.warn('[migrate] could not migrate now, the API will retry on first request:', e.message);
}
