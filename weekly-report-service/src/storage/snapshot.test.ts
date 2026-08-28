import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initSchema } from "./db.js";
import { getLatestSnapshot, getSnapshotHistory, saveSnapshot } from "./snapshot.js";

let dbPath: string;

beforeEach(async () => {
  dbPath = path.join(os.tmpdir(), `weekly-snapshot-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  process.env.TURSO_DATABASE_URL = `file:${dbPath}`;
  delete process.env.TURSO_AUTH_TOKEN;
  await initSchema();
});

afterEach(() => {
  fs.rmSync(dbPath, { force: true });
});

describe("snapshot storage", () => {
  it("returns a saved row as the latest snapshot", async () => {
    await saveTestSnapshot("2026-08-17", "summary");

    const snapshot = await getLatestSnapshot();

    expect(snapshot).not.toBeNull();
    expect(snapshot?.week_start).toBe("2026-08-17");
    expect(snapshot?.week_end).toBe("2026-08-24");
    expect(snapshot?.freshsales_json).toBe("[]");
    expect(snapshot?.meta_json).toBe("[]");
    expect(snapshot?.reconciled_json).toContain("2026-08-17");
    expect(snapshot?.summary_text).toBe("summary");
    expect(snapshot?.created_at).toEqual(expect.any(String));
  });

  it("excludes snapshots at or after the beforeWeekStart boundary", async () => {
    await saveTestSnapshot("2026-08-03");
    await saveTestSnapshot("2026-08-10");
    await saveTestSnapshot("2026-08-17");

    const snapshot = await getLatestSnapshot("2026-08-17");

    expect(snapshot?.week_start).toBe("2026-08-10");
  });

  it("returns limited history most-recent-first while excluding the current week", async () => {
    await saveTestSnapshot("2026-07-27");
    await saveTestSnapshot("2026-08-03");
    await saveTestSnapshot("2026-08-10");
    await saveTestSnapshot("2026-08-17");

    const history = await getSnapshotHistory(2, "2026-08-17");

    expect(history.map((snapshot) => snapshot.week_start)).toEqual(["2026-08-10", "2026-08-03"]);
  });

  it("returns null when no snapshots exist", async () => {
    await expect(getLatestSnapshot()).resolves.toBeNull();
  });
});

async function saveTestSnapshot(weekStart: string, summaryText: string | null = null) {
  const weekEnd = nextWeek(weekStart);
  await saveSnapshot({
    weekStart,
    weekEnd,
    freshsalesJson: "[]",
    metaJson: "[]",
    reconciledJson: JSON.stringify({ weekStart, weekEnd, rows: [], gaps: [], totals: null }),
    summaryText
  });
}

function nextWeek(weekStart: string) {
  const date = new Date(`${weekStart}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 7);
  return date.toISOString().slice(0, 10);
}
