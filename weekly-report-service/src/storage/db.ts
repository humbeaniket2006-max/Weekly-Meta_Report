import pg from "pg";

const { Pool } = pg;

let pool: pg.Pool | null = null;

export async function openDb() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is required");
    pool = new Pool({ connectionString, ssl: getSslConfig(connectionString) });
    pool.on("error", (error) => {
      console.error("Unexpected Postgres pool error", error);
    });
  }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS weekly_snapshot (
      id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      week_start TEXT NOT NULL,
      week_end TEXT NOT NULL,
      freshsales_json TEXT NOT NULL,
      meta_json TEXT NOT NULL,
      reconciled_json TEXT NOT NULL,
      summary_text TEXT,
      created_at TEXT NOT NULL
    );
  `);
  return pool;
}

function getSslConfig(connectionString: string) {
  const url = new URL(connectionString);
  const sslMode = url.searchParams.get("sslmode");
  return sslMode === "require" ? { rejectUnauthorized: false } : undefined;
}
