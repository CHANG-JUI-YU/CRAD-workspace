import { z } from "zod";

import { revisionSchema, stableIdSchema } from "./ids.js";
import { jsonObjectSchema } from "./json.js";
import {
  workflowArtifactSchema,
  workflowDecisionSchema,
  workflowEntryKindSchema,
  workflowGateSchema,
  workflowStageSchema,
  workflowTaskSchema,
} from "./workflow-contracts.js";

export const artifactStatusSchema = z.enum([
  "missing",
  "draft",
  "reviewed",
  "approved",
  "stale",
]);

const workflowArtifactV1Schema = z
  .object({
    status: artifactStatusSchema,
    revision: revisionSchema.optional(),
    updated_at: z.string().datetime({ offset: true }),
  })
  .strict();

const workflowGateV1Schema = z
  .object({
    status: z.enum(["pending", "approved", "rejected"]),
    decided_at: z.string().datetime({ offset: true }).optional(),
    note: z.string().optional(),
  })
  .strict();

export const workflowStateV1Schema = z
  .object({
    schema_version: z.literal(1),
    project_id: stableIdSchema,
    stage: z.enum([
      "initialized",
      "sources",
      "facts",
      "blueprint",
      "drafting",
      "review",
      "ready",
      "published",
    ]),
    revision: z.number().int().nonnegative(),
    artifacts: z.record(stableIdSchema, workflowArtifactV1Schema).default({}),
    gates: z.record(stableIdSchema, workflowGateV1Schema).default({}),
    metadata: jsonObjectSchema.default({}),
  })
  .strict();

function uniqueIds<T extends { id: string }>(
  values: T[],
  path: "artifacts" | "gates" | "tasks" | "decisions",
  context: z.RefinementCtx,
) {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value.id)) {
      context.addIssue({ code: "custom", message: `${path} ID 重複：${value.id}`, path: [path, index, "id"] });
    }
    seen.add(value.id);
  });
}

export const workflowStateSchema = z
  .object({
    schema_version: z.literal(2),
    project_id: stableIdSchema,
    workflow_definition_id: stableIdSchema,
    entry_kind: workflowEntryKindSchema,
    stage: workflowStageSchema,
    revision: z.number().int().nonnegative(),
    artifacts: z.array(workflowArtifactSchema).default([]),
    gates: z.array(workflowGateSchema).default([]),
    tasks: z.array(workflowTaskSchema).default([]),
    decisions: z.array(workflowDecisionSchema).default([]),
    outcome: z.object({
      status: z.literal("closed"),
      kind: z.enum(["report_retained", "corrected_copy_exported", "cancelled"]),
      closed_at: z.string().datetime({ offset: true }),
      decision_id: stableIdSchema,
      artifact: workflowArtifactSchema.optional(),
    }).strict().optional(),
    journal_revision: revisionSchema.optional(),
    extensions: jsonObjectSchema.default({}),
  })
  .strict()
  .superRefine((state, context) => {
    uniqueIds(state.artifacts, "artifacts", context);
    uniqueIds(state.gates, "gates", context);
    uniqueIds(state.tasks, "tasks", context);
    uniqueIds(state.decisions, "decisions", context);
  });

export const workflowStateV2Schema = workflowStateSchema;

export const workflowMigrationWarningSchema = z
  .object({
    code: stableIdSchema,
    path: z.string().min(1),
    message: z.string().min(1),
  })
  .strict();

export const workflowMigrationReportSchema = z
  .object({
    from_schema_version: z.literal(1),
    to_schema_version: z.literal(2),
    warnings: z.array(workflowMigrationWarningSchema),
  })
  .strict();

const stageMigration = {
  initialized: "intake",
  sources: "source_processing",
  facts: "facts_review",
  blueprint: "blueprint",
  drafting: "authoring",
  review: "semantic_review",
  ready: "compile_preview",
  published: "published",
} as const;

const knownGateIds = new Set(["facts", "blueprint", "content", "publish"]);

export function migrateWorkflowV1ToV2(input: unknown) {
  const source = workflowStateV1Schema.parse(input);
  const warnings: z.infer<typeof workflowMigrationWarningSchema>[] = [
    {
      code: "legacy_entry_kind_defaulted",
      path: "entry_kind",
      message: "v1 未保存入口種類；v2 entry_kind 已確定性設為 original",
    },
    {
      code: "legacy_definition_defaulted",
      path: "workflow_definition_id",
      message: "v1 未保存 workflow definition；v2 已確定性設為 legacy-v1",
    },
  ];
  const gates: z.infer<typeof workflowGateSchema>[] = [];

  for (const [id, gate] of Object.entries(source.gates).sort(([left], [right]) => left.localeCompare(right))) {
    if (!knownGateIds.has(id)) {
      warnings.push({ code: "legacy_gate_unmapped", path: `gates.${id}`, message: `v1 gate ${id} 不屬於 v2 固定 gate vocabulary` });
      continue;
    }
    gates.push({ id: id as "facts" | "blueprint" | "content" | "publish", status: gate.status, input_revisions: [], extensions: {} });
    if (gate.decided_at !== undefined || gate.note !== undefined) {
      warnings.push({ code: "legacy_gate_details", path: `gates.${id}`, message: "v1 gate 的 decided_at/note 無法轉為具 actor 的 v2 decision" });
    }
  }

  if (Object.keys(source.metadata).length > 0) {
    warnings.push({ code: "legacy_metadata_preserved", path: "metadata", message: "v1 metadata 已保存在 extensions.legacy_metadata，語意未提升為 v2 欄位" });
  }

  const state = workflowStateSchema.parse({
    schema_version: 2,
    project_id: source.project_id,
    workflow_definition_id: "legacy-v1",
    entry_kind: "original",
    stage: stageMigration[source.stage],
    revision: source.revision,
    artifacts: Object.entries(source.artifacts)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([id, artifact]) => ({ id, ...artifact, extensions: {} })),
    gates,
    tasks: [],
    decisions: [],
    extensions: Object.keys(source.metadata).length > 0 ? { legacy_metadata: source.metadata } : {},
  });

  return {
    state,
    report: workflowMigrationReportSchema.parse({
      from_schema_version: 1,
      to_schema_version: 2,
      warnings,
    }),
  };
}

export type WorkflowState = z.infer<typeof workflowStateSchema>;
export type WorkflowStateV1 = z.infer<typeof workflowStateV1Schema>;
export type WorkflowMigrationReport = z.infer<typeof workflowMigrationReportSchema>;
