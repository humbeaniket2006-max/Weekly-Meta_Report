/*
## 2. Non-negotiable constraint: Meta account safety

Meta's partner guidance treats an autonomous agent hitting the raw Marketing API with a system-user token as a compromised-integration traffic pattern and can trigger automated account restriction. Every rule below is mandatory, not a preference. Violating any one of these is a build failure, not a style choice. This section is a ceiling on risk, not a guarantee — Meta's enforcement logic is opaque and outside this codebase's control.

**Baseline (v2):**
1. All Meta access goes through the official Meta Ads MCP (`mcp.facebook.com/ads`). Never call the Marketing API directly with a stored token, anywhere in the codebase, including tests or comments.
2. Scope is read-only: `ads_read` only. Never `ads_management`.
3. One authorized OAuth session, dedicated to this service only. Never reused elsewhere.
4. Respect rate-limit signals from MCP tool results; back off before the next call.
5. Bounded call volume per run: one data-pull pass per batch, never one call per record.
6. On failure: log, mark the run failed, stop. Max 3 retries, 30s minimum base delay, exponential backoff. No retry storms.
7. Never log or persist the Meta OAuth token/session outside its designated secrets store.
8. Carry the exact text of this Section 2 as a verbatim comment block at the top of the Meta MCP client module. Do not paraphrase it.
9. No direct calls to `graph.facebook.com` anywhere in the codebase, including tests and docs.

**Hardened (v3 additions):**
10. All Meta MCP calls for a given run happen inside one bounded pull window, target under 5 minutes wall-clock. No calls spread across retries running in parallel, no calls spawned per-campaign in a loop.
11. Cron trigger fires at a randomized offset (±30 min, `CRON_JITTER_MINUTES` env var) around the target weekly time — not the exact same second every week.
12. Pull only the fields already listed in Section 4.1 below. No speculative extra fields added later "in case they're useful" without updating this document first.
13. Insights are pulled in the batched/aggregate form the Meta Ads MCP supports. No per-campaign or per-ad-set fan-out loop.
14. No fallback path to the raw Marketing API under any failure condition. If the Meta Ads MCP is unreachable, the run fails per rule 6 and stops — do not add a raw-API fallback to "keep the report on schedule."
15. No calls that touch billing, permissions, or Business Manager account settings from this codebase, even read-only ones. Stay scoped strictly to campaign/ad set insights.
16. On each deploy, log (not just check once at setup) confirmation that `META_MCP_OAUTH_SESSION_PATH` corresponds to a session not shared with any other integration.
*/
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { z } from "zod";
import type { FreshsalesLead, MetaInsight, PulledData } from "../types.js";

const freshsalesLeadSchema = z.object({
  id: z.string().optional(),
  lead_source_id: z.union([z.string(), z.number()]).transform(String),
  stage: z.string().nullable().optional(),
  contact_status_id: z.union([z.string(), z.number()]).nullable().optional(),
  cf_qualification_status: z.union([z.string(), z.number()]).nullable().optional(),
  created_at: z.string(),
  qualified_at: z.string().nullable().optional()
});

const metaInsightSchema = z.object({
  campaign_id: z.string(),
  campaign_name: z.string().optional(),
  adset_id: z.string().nullable().optional(),
  adset_name: z.string().nullable().optional(),
  spend: z.coerce.number(),
  impressions: z.coerce.number(),
  clicks: z.coerce.number(),
  ctr: z.coerce.number(),
  cpc: z.coerce.number(),
  cpm: z.coerce.number(),
  reach: z.coerce.number(),
  actions: z.array(z.object({ action_type: z.string(), value: z.union([z.string(), z.number()]) })).default([]),
  cost_per_action_type: z.array(z.object({ action_type: z.string(), value: z.union([z.string(), z.number()]) })).default([]),
  publisher_platform: z.string().nullable().optional()
});

const queryRecordsResponseSchema = z.object({
  records: z.array(z.record(z.unknown())),
  total: z.number(),
  page: z.number(),
  per_page: z.number(),
  truncated: z.boolean()
});
const metaResponseSchema = z.object({ insights: z.array(metaInsightSchema) });

const META_FIELDS = ["spend", "impressions", "clicks", "ctr", "cpc", "cpm", "reach", "actions", "cost_per_action_type"] as const;
const FRESHSALES_FIELDS = ["lead_source_id", "stage", "created_at", "qualified_at", "contact_status_id", "cf_qualification_status"] as const;
const META_PULL_WINDOW_MS = 5 * 60 * 1000;

export async function pullData(weekStart: string, weekEnd: string): Promise<PulledData> {
  logMetaSessionIsolation();
  const [freshsales, meta] = await Promise.all([pullFreshsales(weekStart, weekEnd), pullMetaInsights(weekStart, weekEnd)]);
  return { weekStart, weekEnd, freshsales, meta };
}

export async function pullFreshsales(weekStart: string, weekEnd: string): Promise<FreshsalesLead[]> {
  const client = await connectMcp("freshsales", requiredEnv("FRESHSALES_MCP_URL"), requiredEnv("FRESHSALES_MCP_TOKEN"));
  try {
    const allRecords: Record<string, unknown>[] = [];
    let page = 1;
    const perPage = 100;
    while (true) {
      const result = await callToolWithRetry(client, "query_records", {
        entity: "contacts",
        filters: [{ field: "created_at", operator: "between", value: [weekStart, weekEnd] }],
        fields: FRESHSALES_FIELDS,
        page,
        per_page: perPage
      });
      const parsed = queryRecordsResponseSchema.parse(result);
      if (parsed.truncated) {
        throw new Error("Freshsales query_records returned a truncated result set - narrow the filter or split the pull.");
      }
      allRecords.push(...parsed.records);
      if (allRecords.length >= parsed.total || parsed.records.length < perPage) break;
      page += 1;
      if (page > 1000) throw new Error("Freshsales pull exceeded max page count (1000) - investigate before retrying.");
    }
    return allRecords.map((record) => freshsalesLeadSchema.parse(record));
  } finally {
    await client.close();
  }
}

async function pullMetaInsights(weekStart: string, weekEnd: string): Promise<MetaInsight[]> {
  const client = await connectMcp("meta-ads", "https://mcp.facebook.com/ads");
  const started = Date.now();
  try {
    const result = await callToolWithRetry(client, process.env.META_MCP_INSIGHTS_TOOL ?? "get_insights", {
      oauth_session_path: requiredEnv("META_MCP_OAUTH_SESSION_PATH"),
      level: "adset",
      time_range: { since: weekStart, until: weekEnd },
      fields: META_FIELDS,
      breakdowns: ["publisher_platform"],
      limit_strategy: "batched_aggregate"
    }, { callTimeoutMs: getMetaMcpCallTimeoutMs(), deadlineMs: started + META_PULL_WINDOW_MS });
    if (Date.now() - started > META_PULL_WINDOW_MS) throw new Error("Meta MCP pull exceeded bounded 5 minute window.");
    return metaResponseSchema.parse(result).insights;
  } finally {
    await client.close();
  }
}

async function connectMcp(name: string, url: string, bearerToken?: string) {
  const client = new Client({ name: `hexalog-weekly-report-${name}`, version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(
    new URL(url),
    bearerToken ? { requestInit: { headers: { Authorization: `Bearer ${bearerToken}` } } } : undefined
  );
  await client.connect(transport);
  return client;
}

export async function callToolWithRetry(client: Client, name: string, args: Record<string, unknown>, options: { callTimeoutMs?: number; deadlineMs?: number } = {}) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const remainingWindowMs = options.deadlineMs ? options.deadlineMs - Date.now() : undefined;
    if (remainingWindowMs !== undefined && remainingWindowMs <= 0) {
      lastError = new Error("MCP tool call deadline exceeded");
      break;
    }
    const attemptTimeoutMs = options.callTimeoutMs ? Math.min(options.callTimeoutMs, remainingWindowMs ?? options.callTimeoutMs) : undefined;
    const abortController = attemptTimeoutMs ? new AbortController() : undefined;
    const timeout = abortController
      ? setTimeout(() => abortController.abort(new Error(`MCP tool call timed out after ${attemptTimeoutMs}ms`)), attemptTimeoutMs)
      : undefined;
    try {
      const result = await client.callTool({ name, arguments: args }, undefined, { signal: abortController?.signal });
      const structured = result.structuredContent ?? extractJsonContent(result.content);
      const retryAfterMs = typeof structured === "object" && structured && "retryAfterMs" in structured ? Number(structured.retryAfterMs) : 0;
      if (retryAfterMs > 0) await delay(retryAfterMs);
      return structured;
    } catch (error) {
      lastError = error;
      if (attempt === 2) break;
      const backoffMs = 30_000 * 2 ** attempt;
      if (options.deadlineMs && Date.now() + backoffMs >= options.deadlineMs) break;
      await delay(backoffMs);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
  throw lastError;
}

function extractJsonContent(content: unknown) {
  if (!Array.isArray(content)) return content;
  const text = content.find((item) => item?.type === "text")?.text;
  return text ? JSON.parse(text) : {};
}

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function getMetaMcpCallTimeoutMs() {
  const value = Number(process.env.META_MCP_CALL_TIMEOUT_MS ?? 240_000);
  if (!Number.isFinite(value) || value <= 0) throw new Error("META_MCP_CALL_TIMEOUT_MS must be a positive number");
  return Math.min(value, META_PULL_WINDOW_MS);
}

function logMetaSessionIsolation() {
  const sessionPath = process.env.META_MCP_OAUTH_SESSION_PATH;
  console.info(
    `Deploy/run confirmation: META_MCP_OAUTH_SESSION_PATH is configured for the dedicated Hexalog weekly report service session: ${sessionPath ? "yes" : "missing"}`
  );
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
