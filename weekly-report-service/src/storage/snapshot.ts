import type pg from "pg";
import type { PulledData, ReconciledReport, SnapshotRecord } from "../types.js";

export async function insertSnapshot(db: pg.Pool, pulled: PulledData, reconciled: ReconciledReport, summaryText: string | null) {
  return db.query(
    `
    INSERT INTO weekly_snapshot
      (week_start, week_end, freshsales_json, meta_json, reconciled_json, summary_text, created_at)
    VALUES
      ($1, $2, $3, $4, $5, $6, $7)
  `,
    [pulled.weekStart, pulled.weekEnd, JSON.stringify(pulled.freshsales), JSON.stringify(pulled.meta), JSON.stringify(reconciled), summaryText, new Date().toISOString()]
  );
}

export async function getLatestSnapshotBefore(db: pg.Pool, weekStart: string): Promise<SnapshotRecord | null> {
  const result = await db.query<SnapshotRecord>("SELECT * FROM weekly_snapshot WHERE week_start < $1 ORDER BY week_start DESC LIMIT 1", [weekStart]);
  return result.rows[0] ?? null;
}

export async function getSnapshotByWeek(db: pg.Pool, weekStart: string): Promise<SnapshotRecord | null> {
  const result = await db.query<SnapshotRecord>("SELECT * FROM weekly_snapshot WHERE week_start = $1 ORDER BY created_at DESC LIMIT 1", [weekStart]);
  return result.rows[0] ?? null;
}

export async function listSnapshotWeeks(db: pg.Pool): Promise<string[]> {
  const result = await db.query<{ week_start: string }>("SELECT DISTINCT week_start FROM weekly_snapshot ORDER BY week_start DESC");
  return result.rows.map((row) => row.week_start);
}

export async function getTrailingSnapshots(db: pg.Pool, weekStart: string, limit: number): Promise<SnapshotRecord[]> {
  const result = await db.query<SnapshotRecord>("SELECT * FROM weekly_snapshot WHERE week_start < $1 ORDER BY week_start DESC LIMIT $2", [weekStart, limit]);
  return result.rows;
}
