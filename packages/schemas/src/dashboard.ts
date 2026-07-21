import { z } from "zod";

import { diagnosticSchema } from "./diagnostic.js";
import { jsonValueSchema } from "./json.js";
import { revisionSchema, stableIdSchema } from "./ids.js";

export const dashboardResourceKindSchema = z.enum([
  "project",
  "blueprint",
  "greetings",
  "character",
  "zhuji_module",
  "palette_module",
  "world_entry",
  "workflow",
  "source",
  "fact",
  "preview",
  "export",
]);

export const dashboardResourceRefSchema = z.object({
  project_id: stableIdSchema,
  kind: dashboardResourceKindSchema,
  id: stableIdSchema,
  owner_id: stableIdSchema.optional(),
}).strict();

export const dashboardProjectSummarySchema = z.object({
  id: stableIdSchema,
  title: z.string().min(1),
  stage: z.string().min(1),
  workflow_revision: z.number().int().nonnegative(),
  valid: z.boolean(),
  character_count: z.number().int().nonnegative(),
  pending_gates: z.number().int().nonnegative(),
  failed_tasks: z.number().int().nonnegative(),
  diagnostics: z.array(diagnosticSchema),
}).strict();

export const dashboardDocumentSchema = z.object({
  resource: dashboardResourceRefSchema,
  format: z.enum(["yaml", "json"]),
  value: jsonValueSchema,
  semantic_revision: revisionSchema,
  raw_revision: revisionSchema,
  read_only: z.boolean(),
}).strict();

export const dashboardPatchOperationSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("add"), path: z.string().startsWith("/"), value: jsonValueSchema }).strict(),
  z.object({ op: z.literal("replace"), path: z.string().startsWith("/"), value: jsonValueSchema }).strict(),
  z.object({ op: z.literal("remove"), path: z.string().startsWith("/") }).strict(),
  z.object({ op: z.literal("copy"), path: z.string().startsWith("/"), from: z.string().startsWith("/") }).strict(),
  z.object({ op: z.literal("move"), path: z.string().startsWith("/"), from: z.string().startsWith("/") }).strict(),
  z.object({ op: z.literal("test"), path: z.string().startsWith("/"), value: jsonValueSchema }).strict(),
]);

export const dashboardPatchRequestSchema = z.object({
  resource: dashboardResourceRefSchema,
  expected_revision: revisionSchema,
  operations: z.array(dashboardPatchOperationSchema).min(1).max(256),
  dry_run: z.boolean(),
}).strict();

export const dashboardPatchResultSchema = z.object({
  resource: dashboardResourceRefSchema,
  before_revision: revisionSchema,
  after_revision: revisionSchema,
  workflow_revision: z.number().int().nonnegative(),
  no_op: z.boolean(),
  dry_run: z.boolean(),
  affected_resources: z.array(z.string()),
  rebuild_scopes: z.array(z.string()),
  differences: z.array(jsonValueSchema),
  value: jsonValueSchema,
}).strict();

export const dashboardPageRequestSchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(200).default(50),
}).strict();

export const dashboardPageSchema = z.object({
  items: z.array(jsonValueSchema),
  next_cursor: z.string().min(1).optional(),
}).strict();

export const dashboardGraphRequestSchema = z.object({
  project_id: stableIdSchema,
  root_id: stableIdSchema.optional(),
  kinds: z.array(stableIdSchema).max(16).default([]),
  limit: z.number().int().min(1).max(500).default(100),
}).strict();

export const dashboardGraphSchema = z.object({
  nodes: z.array(z.object({ id: stableIdSchema, kind: stableIdSchema, label: z.string(), data: jsonValueSchema.optional() }).strict()),
  edges: z.array(z.object({ id: stableIdSchema, source: stableIdSchema, target: stableIdSchema, kind: stableIdSchema }).strict()),
  truncated: z.boolean(),
}).strict();

export const dashboardBootstrapRequestSchema = z.object({ token: z.string().min(32).max(512) }).strict();
export const dashboardBootstrapResponseSchema = z.object({ csrf_token: z.string().min(32), expires_at: z.string().datetime({ offset: true }) }).strict();

export const dashboardEventSchema = z.object({
  type: z.enum([
    "project.changed", "workflow.changed", "task.changed", "gate.changed", "source.changed",
    "facts.changed", "preview.changed", "build.published", "diagnostics.changed",
  ]),
  project_id: stableIdSchema,
  resource_kind: stableIdSchema,
  resource_id: stableIdSchema,
  revision: z.union([revisionSchema, z.number().int().nonnegative()]),
}).strict();

export const dashboardErrorSchema = z.object({
  code: z.string().min(1),
  severity: z.enum(["error", "warning", "info"]),
  message: z.string().min(1),
  retryable: z.boolean(),
  diagnostics: z.array(diagnosticSchema).default([]),
  next_actions: z.array(z.string()).default([]),
}).strict();

export const dashboardSuccessEnvelopeSchema = z.object({ ok: z.literal(true), data: jsonValueSchema }).strict();
export const dashboardErrorEnvelopeSchema = z.object({ ok: z.literal(false), error: dashboardErrorSchema }).strict();
export const dashboardEnvelopeSchema = z.union([dashboardSuccessEnvelopeSchema, dashboardErrorEnvelopeSchema]);

export type DashboardResourceKind = z.infer<typeof dashboardResourceKindSchema>;
export type DashboardResourceRef = z.infer<typeof dashboardResourceRefSchema>;
export type DashboardDocument = z.infer<typeof dashboardDocumentSchema>;
export type DashboardPatchRequest = z.infer<typeof dashboardPatchRequestSchema>;
export type DashboardEvent = z.infer<typeof dashboardEventSchema>;
