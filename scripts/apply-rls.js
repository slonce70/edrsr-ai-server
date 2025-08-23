// Apply RLS policies using node-postgres (no psql required)
import fs from 'fs';
import path from 'path';
import pg from 'pg';

const { Pool } = pg;

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const envPath = path.resolve(process.cwd(), 'server/.env');
    if (fs.existsSync(envPath)) {
      const text = fs.readFileSync(envPath, 'utf-8');
      const line = text.split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='));
      if (line) {
        let value = line.replace(/^DATABASE_URL=/, '');
        value = value.replace(/^"|"$/g, '');
        return value;
      }
    }
  } catch {}
  return null;
}

async function main() {
  const root = process.cwd();
  const sqlFile = path.join(root, 'server/sql/apply_rls.sql');
  if (!fs.existsSync(sqlFile)) {
    console.error(`[ERROR] SQL file not found: ${sqlFile}`);
    process.exit(1);
  }

  const dbUrl = loadDatabaseUrl();
  if (!dbUrl) {
    console.error('[ERROR] DATABASE_URL not set. Set env or add to server/.env');
    process.exit(1);
  }

  const ssl =
    /supabase\.co/.test(dbUrl) && !/sslmode=/.test(dbUrl)
      ? { rejectUnauthorized: false }
      : undefined;
  const pool = new Pool({ connectionString: dbUrl, ssl });

  const sql = fs.readFileSync(sqlFile, 'utf-8');
  const client = await pool.connect();
  try {
    console.log(`[INFO] Applying RLS policies from ${sqlFile}`);
    await client.query(sql);
    console.log('[OK] RLS policies applied.');
  } catch (e) {
    console.error('[ERROR] Failed to apply RLS:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
