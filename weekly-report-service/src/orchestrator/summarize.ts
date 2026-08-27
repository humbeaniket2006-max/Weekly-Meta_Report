import type { CorrelationResult, ReconciledReport } from "../types.js";

export async function summarizeReport(reconciled: ReconciledReport, correlations: CorrelationResult[]) {
  try {
    return await groqChat([
      {
        role: "system",
        content:
          "Write a concise weekly performance summary. Use only the supplied precomputed numbers. Do not recompute, infer, or invent any figures. Correlation language must say moved alongside, never caused by."
      },
      { role: "user", content: JSON.stringify({ reconciled, correlations }) }
    ]);
  } catch (error) {
    console.warn(`Groq summary failed, using template fallback: ${(error as Error).message}`);
    return templateSummary(reconciled, correlations);
  }
}

export async function answerReportQuestion(question: string, snapshotPayload: unknown) {
  return groqChat([
    {
      role: "system",
      content:
        "Answer questions about this weekly report using only the supplied snapshot numbers and summary. Do not use tools, external data, or invent figures. Return answer text only."
    },
    { role: "user", content: JSON.stringify({ question, snapshot: snapshotPayload }) }
  ]);
}

async function groqChat(messages: Array<{ role: "system" | "user"; content: string }>) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY is required");
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: process.env.GROQ_MODEL ?? "openai/gpt-oss-20b", messages, temperature: 0.2 })
  });
  if (!response.ok) throw new Error(`Groq request failed: ${response.status}`);
  const json = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return json.choices?.[0]?.message?.content?.trim() ?? "";
}

function templateSummary(reconciled: ReconciledReport, correlations: CorrelationResult[]) {
  const total = reconciled.totals;
  const flagged = reconciled.rows.filter((row) => Object.values(row.flags).some((flag) => flag === "warn" || flag === "critical")).length;
  const correlationText = correlations[0]?.status === "not_enough_history" ? "Not enough history yet for correlation signals." : `${correlations.length} correlation signal(s) available.`;
  return `Weekly totals: ${total.leads} leads, ${total.qualifiedLeads} qualified leads, ${money(total.spend)} spend. ${flagged} mapped source(s) need review. ${correlationText}`;
}

function money(value: number) {
  return `$${value.toFixed(2)}`;
}
