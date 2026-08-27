import fs from "node:fs";
import { z } from "zod";
import type { MappingRow } from "../types.js";

const mappingSchema = z.object({
  qualifiedContactStatusId: z.string(),
  qualifiedContactStatusName: z.string(),
  secondaryQualificationCandidate: z
    .object({
      field: z.string(),
      value: z.string(),
      label: z.string(),
      usedForMetric: z.literal(false)
    })
    .optional(),
  sources: z.array(
    z.object({
      sourceKey: z.string(),
      freshsalesLeadSourceId: z.string(),
      metaCampaignId: z.string(),
      metaAdsetId: z.string().nullable().optional(),
      label: z.string()
    })
  )
});

export type AttributionMapping = z.infer<typeof mappingSchema>;

export function loadMapping(path = "config/mapping.json"): AttributionMapping {
  return mappingSchema.parse(JSON.parse(fs.readFileSync(path, "utf8")));
}

export function findMappingForFreshsales(sourceId: string, rows: MappingRow[]) {
  return rows.find((row) => row.freshsalesLeadSourceId === sourceId);
}

export function findMappingForMeta(campaignId: string, adsetId: string | null | undefined, rows: MappingRow[]) {
  return rows.find((row) => {
    if (row.metaCampaignId !== campaignId) return false;
    return row.metaAdsetId ? row.metaAdsetId === adsetId : true;
  });
}
