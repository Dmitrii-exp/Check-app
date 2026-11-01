// Isolated Postgres tests. The runner accepts PGlite installed outside the production dependency graph.
import fs from 'node:fs';
const {PGlite} = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const database = new PGlite();
try {
  await database.exec(fs.readFileSync('supabase/tests/engine-hours-baseline.sql', 'utf8'));
  await database.exec(fs.readFileSync('supabase/migrations/20261101183944_engine_hour_maintenance.sql', 'utf8'));
  const results = await database.exec(fs.readFileSync('supabase/tests/engine-hours-transaction.sql', 'utf8'));
  for (const result of results) for (const row of result.rows) if (row.result) console.log(row.result);
} finally { await database.close(); }
