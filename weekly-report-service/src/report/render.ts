import fs from "node:fs";
import path from "node:path";
import type { CorrelationResult, ReconciledReport, SnapshotRecord } from "../types.js";

export function renderReport(input: {
  report: ReconciledReport;
  correlations: CorrelationResult[];
  summaryText: string;
  history: SnapshotRecord[];
  outputDir?: string;
}) {
  const template = fs.readFileSync("src/report/template.html", "utf8");
  const outputDir = input.outputDir ?? process.env.REPORT_OUTPUT_DIR ?? "reports";
  fs.mkdirSync(outputDir, { recursive: true });
  const payload = {
    report: input.report,
    correlations: input.correlations,
    summaryText: input.summaryText,
    history: input.history.map((snapshot) => JSON.parse(snapshot.reconciled_json))
  };
  const html = template.replace("__REPORT_DATA__", escapeJsonForHtml(JSON.stringify(payload)));
  const file = path.join(outputDir, `weekly-report-${input.report.weekStart}.html`);
  fs.writeFileSync(file, html, "utf8");
  return file;
}

function escapeJsonForHtml(json: string) {
  return json.replaceAll("<", "\\u003c").replaceAll(">", "\\u003e").replaceAll("&", "\\u0026");
}
