import { z } from "zod";

import { compileOverrideSchema, defaultCompileOverride, provenanceRefSchema } from "./author-common.js";
import { stableIdSchema } from "./ids.js";
import { jsonObjectSchema } from "./json.js";

export const relationshipTeamCodeSchema = z.string().regex(/^[A-Z0-9]{6}$/u);

export const relationshipCharacterSummarySchema = z
  .object({
    character_id: stableIdSchema,
    summary: z.string().min(1),
  })
  .strict();

export const directionalPerspectiveSchema = z
  .object({
    source_character_id: stableIdSchema,
    target_character_id: stableIdSchema,
    summary: z.string().min(1),
  })
  .strict();

export const relationshipGroupSchema = z
  .object({
    id: stableIdSchema,
    name: z.string().min(1),
    member_ids: z.array(stableIdSchema).min(2),
    formation_cause: z.string().min(1),
    operating_pattern: z.string().min(1),
    exclusivity: z.string().min(1),
    latent_conflicts: z.array(z.string().min(1)).default([]),
    joining_conditions: z.string().min(1),
    extensions: jsonObjectSchema.default({}),
  })
  .strict();

export const relationshipConflictTriggerSchema = z
  .object({
    trigger: z.string().min(1),
    severity: z.enum(["low", "medium", "high", "critical"]),
  })
  .strict();

export const relationshipNetworkSummarySchema = z
  .object({
    network_character: z.string().min(1),
    inter_group_relations: z.string().min(1),
    stability: z.string().min(1),
    conflict_triggers: z.array(relationshipConflictTriggerSchema).default([]),
    intimacy_opportunities: z.array(z.string().min(1)).default([]),
  })
  .strict();

export const relationshipsDocumentSchema = z
  .object({
    schema_version: z.literal(1),
    team_code: relationshipTeamCodeSchema,
    character_ids: z.array(stableIdSchema).min(2),
    character_summaries: z.array(relationshipCharacterSummarySchema),
    perspectives: z.array(directionalPerspectiveSchema),
    groups: z.array(relationshipGroupSchema).default([]),
    summary: relationshipNetworkSummarySchema,
    compile: compileOverrideSchema.default(defaultCompileOverride),
    provenance: z.array(provenanceRefSchema).default([]),
    extensions: jsonObjectSchema.default({}),
  })
  .strict()
  .superRefine((document, context) => {
    const participants = new Set<string>();
    document.character_ids.forEach((characterId, index) => {
      if (participants.has(characterId)) {
        context.addIssue({ code: "custom", message: `關係參與角色重複：${characterId}`, path: ["character_ids", index] });
      }
      participants.add(characterId);
    });

    const summaries = new Set<string>();
    document.character_summaries.forEach((item, index) => {
      if (!participants.has(item.character_id)) {
        context.addIssue({ code: "custom", message: `角色摘要引用非參與角色：${item.character_id}`, path: ["character_summaries", index, "character_id"] });
      }
      if (summaries.has(item.character_id)) {
        context.addIssue({ code: "custom", message: `角色摘要重複：${item.character_id}`, path: ["character_summaries", index, "character_id"] });
      }
      summaries.add(item.character_id);
    });
    for (const characterId of participants) {
      if (!summaries.has(characterId)) {
        context.addIssue({ code: "custom", message: `缺少角色摘要：${characterId}`, path: ["character_summaries"] });
      }
    }

    const perspectives = new Set<string>();
    document.perspectives.forEach((item, index) => {
      if (!participants.has(item.source_character_id) || !participants.has(item.target_character_id)) {
        context.addIssue({ code: "custom", message: "方向觀點只能引用參與角色", path: ["perspectives", index] });
      }
      const key = `${item.source_character_id}\u0000${item.target_character_id}`;
      if (perspectives.has(key)) {
        context.addIssue({ code: "custom", message: `方向觀點重複：${item.source_character_id} -> ${item.target_character_id}`, path: ["perspectives", index] });
      }
      perspectives.add(key);
    });
    for (const source of participants) {
      for (const target of participants) {
        if (!perspectives.has(`${source}\u0000${target}`)) {
          context.addIssue({ code: "custom", message: `缺少方向觀點：${source} -> ${target}`, path: ["perspectives"] });
        }
      }
    }

    const groupIds = new Set<string>();
    document.groups.forEach((group, groupIndex) => {
      if (groupIds.has(group.id)) {
        context.addIssue({ code: "custom", message: `關係群組 ID 重複：${group.id}`, path: ["groups", groupIndex, "id"] });
      }
      groupIds.add(group.id);
      const members = new Set<string>();
      group.member_ids.forEach((memberId, memberIndex) => {
        if (!participants.has(memberId)) {
          context.addIssue({ code: "custom", message: `群組成員不在參與角色中：${memberId}`, path: ["groups", groupIndex, "member_ids", memberIndex] });
        }
        if (members.has(memberId)) {
          context.addIssue({ code: "custom", message: `群組成員重複：${memberId}`, path: ["groups", groupIndex, "member_ids", memberIndex] });
        }
        members.add(memberId);
      });
    });
  });

export type RelationshipsDocument = z.infer<typeof relationshipsDocumentSchema>;
