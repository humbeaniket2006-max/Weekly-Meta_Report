import { getDb } from "./db.js";
import type { SnapshotRecord } from "../types.js";

export async function saveSnapshot(input: {
  weekStart: string;
  weekEnd: string;
  freshsalesJson: string;
  metaJson: string;
  reconciledJson: string;
  summaryText: string | null;
}): Promise<void> {
  const db = getDb();
  await db.execute({
    sql: `INSERT INTO weekly_snapshot
      (week_start, week_end, freshsales_json, meta_json, reconciled_json, summary_text, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [
      input.weekStart,
      input.weekEnd,
      input.freshsalesJson,
      input.metaJson,
      input.reconciledJson,
      input.summaryText,
      new Date().toISOString()
    ]
  });
}

export async function getLatestSnapshot(beforeWeekStart?: string): Promise<SnapshotRecord | null> {
  const db = getDb();
  const result = beforeWeekStart
    ? await db.execute({
        sql: `SELECT * FROM weekly_snapshot WHERE week_start < ? ORDER BY week_start DESC LIMIT 1`,
        args: [beforeWeekStart]
      })
    : await db.execute(`SELECT * FROM weekly_snapshot ORDER BY week_start DESC LIMIT 1`);
  if (result.rows.length === 0) return null;
  return result.rows[0] as unknown as SnapshotRecord;
}

export async function getSnapshotHistory(limit: number, beforeWeekStart?: string): Promise<SnapshotRecord[]> {
  const db = getDb();
  const result = beforeWeekStart
    ? await db.execute({
        sql: `SELECT * FROM weekly_snapshot WHERE week_start < ? ORDER BY week_start DESC LIMIT ?`,
        args: [beforeWeekStart, limit]
      })
    : await db.execute({
        sql: `SELECT * FROM weekly_snapshot ORDER BY week_start DESC LIMIT ?`,
        args: [limit]
      });
  return result.rows as unknown as SnapshotRecord[];
}
