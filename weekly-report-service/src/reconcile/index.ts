import fs from "node:fs";
import { z } from "zod";
import type { FreshsalesLead, MetaInsight, ReconciledReport, ReconciledRow, ReconciliationGap, SnapshotRecord } from "../types.js";
import { findMappingForFreshsales, findMappingForMeta, type AttributionMapping } from "./mapping.js";

const benchmarksSchema = z.record(
  z.object({
    okMax: z.number().optional(),
    warnMax: z.number().optional(),
    okMin: z.number().optional(),
    warnMin: z.number().optional()
  })
);

export function loadBenchmarks(path = "config/benchmarks.json") {
  return benchmarksSchema.parse(JSON.parse(fs.readFileSync(path, "utf8")));
}

export function aggregateFreshsalesBySource(leads: FreshsalesLead[], mapping: AttributionMapping) {
  const qualifiedId = mapping.qualifiedContactStatusId;
  const out = new Map<string, { leads: number; qualifiedLeads: number }>();
  for (const lead of leads) {
    const sourceId = String(lead.lead_source_id);
    const current = out.get(sourceId) ?? { leads: 0, qualifiedLeads: 0 };
    current.leads += 1;
    if (String(lead.contact_status_id ?? "") === qualifiedId || Boolean(lead.qualified_at)) current.qualifiedLeads += 1;
    out.set(sourceId, current);
  }
  return out;
}

export function aggregateMetaByCampaign(insights: MetaInsight[]) {
  const out = new Map<string, ReturnType<typeof emptyMeta> & { campaign_name?: string; adset_name?: string | null; publisher_platform?: string | null }>();
  for (const item of insights) {
    const key = metaKey(item.campaign_id, item.adset_id);
    const current =
      out.get(key) ??
      {
        campaign_id: item.campaign_id,
        campaign_name: item.campaign_name,
        adset_id: item.adset_id,
        adset_name: item.adset_name,
        spend: 0,
        impressions: 0,
        clicks: 0,
        ctr: 0,
        cpc: 0,
        cpm: 0,
        reach: 0,
        publisher_platform: item.publisher_platform,
        actions: 0
      };
    current.spend += item.spend;
    current.impressions += item.impressions;
    current.clicks += item.clicks;
    current.reach += item.reach;
    current.actions += sumActionValues(item.actions);
    current.ctr = current.impressions ? current.clicks / current.impressions : 0;
    current.cpc = current.clicks ? current.spend / current.clicks : 0;
    current.cpm = current.impressions ? (current.spend / current.impressions) * 1000 : 0;
    out.set(key, current);
  }
  return out;
}

export function reconcile(input: {
  weekStart: string;
  weekEnd: string;
  freshsales: FreshsalesLead[];
  meta: MetaInsight[];
  mapping: AttributionMapping;
  priorSnapshot?: SnapshotRecord | null;
}): ReconciledReport {
  const fresh = aggregateFreshsalesBySource(input.freshsales, input.mapping);
  const meta = aggregateMetaByCampaign(input.meta);
  const priorBySource = priorRowsBySource(input.priorSnapshot);
  const rows = input.mapping.sources.map((mapRow) => {
    const f = fresh.get(mapRow.freshsalesLeadSourceId) ?? { leads: 0, qualifiedLeads: 0 };
    const m = meta.get(metaKey(mapRow.metaCampaignId, mapRow.metaAdsetId)) ?? emptyMeta(mapRow.metaCampaignId, mapRow.metaAdsetId);
    const row = buildRow(mapRow.sourceKey, mapRow.label, mapRow.freshsalesLeadSourceId, mapRow.metaCampaignId, mapRow.metaAdsetId, f, m);
    row.deltas = computeDeltas(row, priorBySource.get(row.sourceKey));
    return row;
  });
  const benchmarks = loadBenchmarks();
  rows.forEach((row) => {
    row.flags = flagAgainstBenchmarks(row, benchmarks);
  });
  const totals = totalRow(rows);
  totals.flags = flagAgainstBenchmarks(totals, benchmarks);
  return { weekStart: input.weekStart, weekEnd: input.weekEnd, rows, gaps: findReconciliationGaps(input.freshsales, input.meta, input.mapping), totals };
}

export function findReconciliationGaps(leads: FreshsalesLead[], insights: MetaInsight[], mapping: AttributionMapping): ReconciliationGap[] {
  const gaps: ReconciliationGap[] = [];
  const fresh = aggregateFreshsalesBySource(leads, mapping);
  const meta = aggregateMetaByCampaign(insights);
  for (const [sourceId, counts] of fresh) {
    if (!findMappingForFreshsales(sourceId, mapping.sources)) {
      gaps.push({ type: "leads_without_campaign", key: sourceId, label: sourceId, amount: counts.leads });
    }
  }
  for (const [key, item] of meta) {
    if (!findMappingForMeta(item.campaign_id, item.adset_id, mapping.sources) && item.spend > 0) {
      gaps.push({ type: "spend_without_source", key, label: item.campaign_name ?? key, amount: item.spend });
    }
  }
  return gaps;
}

export function flagAgainstBenchmarks(row: ReconciledRow, benchmarks: Record<string, { okMax?: number; warnMax?: number; okMin?: number; warnMin?: number }>) {
  const flags: ReconciledRow["flags"] = {};
  for (const metric of ["cpl", "cpql", "conversionRate", "ctr", "cpm"] as const) {
    const value = row[metric];
    const band = benchmarks[metric];
    if (value === null || !band) {
      flags[metric] = "unknown";
    } else if (band.okMax !== undefined) {
      flags[metric] = value <= band.okMax ? "ok" : value <= (band.warnMax ?? band.okMax) ? "warn" : "critical";
    } else {
      flags[metric] = value >= (band.okMin ?? 0) ? "ok" : value >= (band.warnMin ?? 0) ? "warn" : "critical";
    }
  }
  return flags;
}

function buildRow(sourceKey: string, label: string, freshsalesLeadSourceId: string, metaCampaignId: string, metaAdsetId: string | null | undefined, f: { leads: number; qualifiedLeads: number }, m: ReturnType<typeof emptyMeta>): ReconciledRow {
  return {
    sourceKey,
    label,
    freshsalesLeadSourceId,
    metaCampaignId,
    metaAdsetId,
    leads: f.leads,
    qualifiedLeads: f.qualifiedLeads,
    spend: m.spend,
    impressions: m.impressions,
    clicks: m.clicks,
    actions: m.actions,
    ctr: m.ctr,
    cpc: m.cpc,
    cpm: m.cpm,
    reach: m.reach,
    cpl: f.leads ? m.spend / f.leads : null,
    cpql: f.qualifiedLeads ? m.spend / f.qualifiedLeads : null,
    conversionRate: f.leads ? f.qualifiedLeads / f.leads : null,
    deltas: {},
    flags: {}
  };
}

function totalRow(rows: ReconciledRow[]): ReconciledRow {
  const base = buildRow("total", "Total", "*", "*", null, { leads: 0, qualifiedLeads: 0 }, emptyMeta("*", null));
  for (const row of rows) {
    base.leads += row.leads;
    base.qualifiedLeads += row.qualifiedLeads;
    base.spend += row.spend;
    base.impressions += row.impressions;
    base.clicks += row.clicks;
    base.actions += row.actions;
    base.reach += row.reach;
  }
  base.ctr = base.impressions ? base.clicks / base.impressions : 0;
  base.cpc = base.clicks ? base.spend / base.clicks : 0;
  base.cpm = base.impressions ? (base.spend / base.impressions) * 1000 : 0;
  base.cpl = base.leads ? base.spend / base.leads : null;
  base.cpql = base.qualifiedLeads ? base.spend / base.qualifiedLeads : null;
  base.conversionRate = base.leads ? base.qualifiedLeads / base.leads : null;
  return base;
}

function computeDeltas(row: ReconciledRow, prior?: ReconciledRow) {
  const deltas: Record<string, number | null> = {};
  for (const metric of ["leads", "qualifiedLeads", "spend", "cpl", "cpql", "conversionRate", "ctr", "cpm"] as const) {
    const current = row[metric];
    const previous = prior?.[metric];
    deltas[metric] = typeof current === "number" && typeof previous === "number" && previous !== 0 ? (current - previous) / previous : null;
  }
  return deltas;
}

function priorRowsBySource(snapshot?: SnapshotRecord | null) {
  const rows = new Map<string, ReconciledRow>();
  if (!snapshot) return rows;
  const parsed = JSON.parse(snapshot.reconciled_json) as ReconciledReport;
  for (const row of parsed.rows) rows.set(row.sourceKey, row);
  return rows;
}

function emptyMeta(campaign_id: string, adset_id: string | null | undefined) {
  return { campaign_id, adset_id, spend: 0, impressions: 0, clicks: 0, ctr: 0, cpc: 0, cpm: 0, reach: 0, actions: 0 };
}

function metaKey(campaignId: string, adsetId?: string | null) {
  return `${campaignId}:${adsetId ?? "*"}`;
}

function sumActionValues(actions: MetaInsight["actions"]) {
  return actions.reduce((sum, action) => sum + Number(action.value || 0), 0);
}
