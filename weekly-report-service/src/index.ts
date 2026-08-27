import "dotenv/config";
import { pullData } from "./orchestrator/pullData.js";
import { summarizeReport } from "./orchestrator/summarize.js";
import { computeCorrelations } from "./reconcile/correlate.js";
import { reconcile } from "./reconcile/index.js";
import { loadMapping } from "./reconcile/mapping.js";
import { renderReport } from "./report/render.js";
import type { SnapshotRecord } from "./types.js";

async function main() {
  await applyCronJitter();
  const { weekStart, weekEnd } = reportWeek();
  const mapping = loadMapping();
  const pulled = await pullData(weekStart, weekEnd);
  const history: SnapshotRecord[] = [];
  const reconciled = reconcile({ ...pulled, mapping, priorSnapshot: null });
  const windowWeeks = Number(process.env.CORRELATION_WINDOW_WEEKS ?? 6);
  const correlations = computeCorrelations(reconciled, history, windowWeeks);
  const summary = await summarizeReport(reconciled, correlations);
  const reportFile = renderReport({ report: reconciled, correlations, summaryText: summary, history });
  await deliverReport(reportFile);
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

async function deliverReport(reportFile: string) {
  if ((process.env.NOTIFICATION_CHANNEL ?? "notion") !== "notion") {
    console.info(`Report rendered: ${reportFile}`);
    return;
  }
  const notionWebhook = process.env.NOTION_WEBHOOK_URL;
  if (!notionWebhook) {
    console.info(`Report rendered for Notion delivery: ${reportFile}. Configure NOTION_WEBHOOK_URL or attach this artifact in your Render notification step.`);
    return;
  }
  const response = await fetch(notionWebhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reportFile })
  });
  if (!response.ok) throw new Error(`Notion delivery failed: ${response.status}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
