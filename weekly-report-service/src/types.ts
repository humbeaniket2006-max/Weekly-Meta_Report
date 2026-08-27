export type FreshsalesLead = {
  id?: string;
  lead_source_id: string;
  stage?: string | null;
  contact_status_id?: string | number | null;
  cf_qualification_status?: string | number | null;
  created_at: string;
  qualified_at?: string | null;
};

export type MetaInsight = {
  campaign_id: string;
  campaign_name?: string;
  adset_id?: string | null;
  adset_name?: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  cpm: number;
  reach: number;
  actions: Array<{ action_type: string; value: number | string }>;
  cost_per_action_type: Array<{ action_type: string; value: number | string }>;
  publisher_platform?: string | null;
};

export type PulledData = {
  weekStart: string;
  weekEnd: string;
  freshsales: FreshsalesLead[];
  meta: MetaInsight[];
};

export type MappingRow = {
  sourceKey: string;
  freshsalesLeadSourceId: string;
  metaCampaignId: string;
  metaAdsetId?: string | null;
  label: string;
};

export type ReconciledRow = {
  sourceKey: string;
  label: string;
  freshsalesLeadSourceId: string;
  metaCampaignId: string;
  metaAdsetId?: string | null;
  leads: number;
  qualifiedLeads: number;
  spend: number;
  impressions: number;
  clicks: number;
  actions: number;
  ctr: number;
  cpc: number;
  cpm: number;
  reach: number;
  cpl: number | null;
  cpql: number | null;
  conversionRate: number | null;
  deltas: Record<string, number | null>;
  flags: Record<string, "ok" | "warn" | "critical" | "unknown">;
};

export type ReconciliationGap = {
  type: "spend_without_source" | "leads_without_campaign";
  key: string;
  label: string;
  amount: number;
};

export type ReconciledReport = {
  weekStart: string;
  weekEnd: string;
  rows: ReconciledRow[];
  gaps: ReconciliationGap[];
  totals: ReconciledRow;
};

export type CorrelationResult =
  | {
      status: "ready";
      metric: "cpl" | "cpql" | "conversionRate";
      sourceKey: string;
      drivers: Array<{ driver: "cpm" | "ctr" | "spend"; score: number; phrase: "moved alongside" }>;
    }
  | { status: "not_enough_history"; requiredPriorSnapshots: number; availablePriorSnapshots: number };

export type SnapshotRecord = {
  id: number;
  week_start: string;
  week_end: string;
  freshsales_json: string;
  meta_json: string;
  reconciled_json: string;
  summary_text: string | null;
  created_at: string;
};
