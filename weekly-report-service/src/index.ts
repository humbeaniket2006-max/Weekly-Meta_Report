import "dotenv/config";
import { pullData } from "./orchestrator/pullData.js";
import { summarizeReport } from "./orchestrator/summarize.js";
import { computeCorrelations } from "./reconcile/correlate.js";
import { reconcile } from "./reconcile/index.js";
import { loadMapping } from "./reconcile/mapping.js";
import { renderReport } from "./report/render.js";
import { publishToGithubPages } from "./publish/githubPages.js";
import { createNotionReportPage } from "./publish/notion.js";
import { initSchema } from "./storage/db.js";
import { getLatestSnapshot, getSnapshotHistory, saveSnapshot } from "./storage/snapshot.js";
import type { ReconciledReport } from "./types.js";

async function main() {
  await applyCronJitter();
  await initSchema();
  const { weekStart, weekEnd } = reportWeek();
  const mapping = loadMapping();
  const pulled = await pullData(weekStart, weekEnd);
  const priorSnapshot = await getLatestSnapshot(weekStart);
  const windowWeeks = Number(process.env.CORRELATION_WINDOW_WEEKS ?? 6);
  const history = await getSnapshotHistory(windowWeeks, weekStart);
  const reconciled = reconcile({ ...pulled, mapping, priorSnapshot });
  const correlations = computeCorrelations(reconciled, history, windowWeeks);
  const summary = await summarizeReport(reconciled, correlations);
  await saveSnapshot({
    weekStart,
    weekEnd,
    freshsalesJson: JSON.stringify(pulled.freshsales),
    metaJson: JSON.stringify(pulled.meta),
    reconciledJson: JSON.stringify(reconciled),
    summaryText: summary
  });
  const reportFile = renderReport({ report: reconciled, correlations, summaryText: summary, history });
  await deliverReport(reportFile, reconciled, summary, weekStart, weekEnd);
}

function reportWeek() {
  const now = new Date();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = end.getUTCDay();
  const daysSinceMonday = (day + 6) % 7;
  end.setUTCDate(end.getUTCDate() - daysSinceMonday);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 7);
  return { weekStart: start.toISOString().slice(0, 10), weekEnd: end.toISOString().slice(0, 10) };
}

async function applyCronJitter() {
  const minutes = Number(process.env.CRON_JITTER_MINUTES ?? 30);
  if (!minutes) return;
  const offsetMs = Math.round((Math.random() * 2 - 1) * minutes * 60_000);
  console.info(`Applying cron jitter offset of ${Math.round(offsetMs / 1000)} seconds.`);
  if (offsetMs > 0) await new Promise((resolve) => setTimeout(resolve, offsetMs));
}

async function deliverReport(reportFile: string, report: ReconciledReport, summary: string, weekStart: string, weekEnd: string) {
  const channel = process.env.NOTIFICATION_CHANNEL ?? "notion";
  if (channel !== "notion") {
    console.info(`Report rendered: ${reportFile}`);
    return;
  }

  const reportUrl = publishToGithubPages(reportFile, weekStart);

  const headlineMetrics = [
    { label: "Total leads", value: String(report.totals.leads) },
    { label: "Qualified leads", value: String(report.totals.qualifiedLeads) },
    { label: "Spend", value: `₹${report.totals.spend.toFixed(2)}` },
    { label: "Cost per lead", value: report.totals.cpl != null ? `₹${report.totals.cpl.toFixed(2)}` : "N/A" }
  ];

  await createNotionReportPage({
    weekStart,
    weekEnd,
    reportUrl,
    summaryText: summary,
    headlineMetrics,
    gaps: report.gaps.map((gap) => ({ label: gap.label, amount: gap.amount }))
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
