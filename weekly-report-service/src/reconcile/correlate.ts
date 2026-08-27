import type { CorrelationResult, ReconciledReport, ReconciledRow, SnapshotRecord } from "../types.js";

const HEADLINE_METRICS = ["cpl", "cpql", "conversionRate"] as const;
const DRIVERS = ["cpm", "ctr", "spend"] as const;

export function computeCorrelations(current: ReconciledReport, snapshots: SnapshotRecord[], windowWeeks = 6): CorrelationResult[] {
  const history = snapshots.slice(0, windowWeeks);
  if (history.length < 3) {
    return [{ status: "not_enough_history", requiredPriorSnapshots: 3, availablePriorSnapshots: history.length }];
  }

  const reports = history.map((snapshot) => JSON.parse(snapshot.reconciled_json) as ReconciledReport).reverse();
  const results: CorrelationResult[] = [];
  for (const row of current.rows) {
    const previousRow = reports.at(-1)?.rows.find((candidate) => candidate.sourceKey === row.sourceKey);
    if (!previousRow) continue;
    for (const metric of HEADLINE_METRICS) {
      if (!movedBeyondBand(row, metric)) continue;
      const metricMove = move(row[metric], previousRow[metric]);
      if (metricMove === 0) continue;
      const drivers = DRIVERS.map((driver) => ({
        driver,
        score: Math.abs(correlation([...reports.map((report) => valueFor(report.rows, row.sourceKey, metric)), row[metric]], [...reports.map((report) => valueFor(report.rows, row.sourceKey, driver)), row[driver]])),
        sameDirection: Math.sign(move(row[driver], previousRow[driver])) === Math.sign(metricMove)
      }))
        .filter((driver) => driver.sameDirection && Number.isFinite(driver.score))
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)
        .map(({ driver, score }) => ({ driver, score, phrase: "moved alongside" as const }));
      if (drivers.length) results.push({ status: "ready", metric, sourceKey: row.sourceKey, drivers });
    }
  }
  return results;
}

function movedBeyondBand(row: ReconciledRow, metric: (typeof HEADLINE_METRICS)[number]) {
  return row.flags[metric] === "warn" || row.flags[metric] === "critical";
}

function valueFor(rows: ReconciledRow[], sourceKey: string, metric: keyof ReconciledRow) {
  const value = rows.find((row) => row.sourceKey === sourceKey)?.[metric];
  return typeof value === "number" ? value : null;
}

function move(current: number | null, previous: number | null) {
  if (current === null || previous === null) return 0;
  return current - previous;
}

function correlation(a: Array<number | null>, b: Array<number | null>) {
  const pairs = a.map((value, index) => [value, b[index]] as const).filter((pair): pair is readonly [number, number] => pair[0] !== null && pair[1] !== null);
  if (pairs.length < 3) return Number.NaN;
  const xs = pairs.map(([x]) => x);
  const ys = pairs.map(([, y]) => y);
  const xMean = mean(xs);
  const yMean = mean(ys);
  const numerator = pairs.reduce((sum, [x, y]) => sum + (x - xMean) * (y - yMean), 0);
  const xDen = Math.sqrt(xs.reduce((sum, x) => sum + (x - xMean) ** 2, 0));
  const yDen = Math.sqrt(ys.reduce((sum, y) => sum + (y - yMean) ** 2, 0));
  return xDen && yDen ? numerator / (xDen * yDen) : Number.NaN;
}

function mean(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
