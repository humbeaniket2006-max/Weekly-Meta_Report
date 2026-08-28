import { createClient } from "@libsql/client";

export function getDb() {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url) throw new Error("TURSO_DATABASE_URL is not set");
  return createClient({ url, authToken });
}

export async function initSchema() {
  const db = getDb();
  await db.execute(`
    CREATE TABLE IF NOT EXISTS weekly_snapshot (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      week_start TEXT NOT NULL,
      week_end TEXT NOT NULL,
      freshsales_json TEXT NOT NULL,
      meta_json TEXT NOT NULL,
      reconciled_json TEXT NOT NULL,
      summary_text TEXT,
      created_at TEXT NOT NULL
    )
  `);
  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_weekly_snapshot_week
    ON weekly_snapshot (week_start)
  `);
}
