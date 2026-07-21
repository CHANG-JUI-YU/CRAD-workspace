import { z } from "zod";

import { blueprintSchema } from "./blueprint.js";
import { characterDocumentSchema } from "./character.js";
import { greetingsDocumentSchema } from "./greetings.js";
import { revisionSchema, stableIdSchema } from "./ids.js";
import { jsonObjectSchema } from "./json.js";
import { paletteModuleSchema } from "./palette.js";
import { pluginProposalValueSchema } from "./plugin-contracts.js";
import { authoringModeSchema } from "./project.js";
import { relationshipsDocumentSchema } from "./relationships.js";
import { worldEntrySchema } from "./world.js";
import { structuredZhujiModuleSchema } from "./zhuji.js";

const blueprintProposalValueSchema = z.object({ kind: z.literal("blueprint"), document: blueprintSchema }).strict();
const characterProposalValueSchema = z.object({ kind: z.literal("character"), document: characterDocumentSchema }).strict();
const zhujiProposalValueSchema = z.object({ kind: z.literal("zhuji"), character_id: stableIdSchema, module: structuredZhujiModuleSchema }).strict();
const paletteProposalValueSchema = z.object({ kind: z.literal("palette"), character_id: stableIdSchema, module: paletteModuleSchema }).strict();
const worldProposalValueSchema = z.object({ kind: z.literal("world"), entries: z.array(worldEntrySchema).min(1) }).strict();
const greetingsProposalValueSchema = z.object({ kind: z.literal("greetings"), document: greetingsDocumentSchema }).strict();
const relationshipsProposalValueSchema = z.object({ kind: z.literal("relationships"), document: relationshipsDocumentSchema }).strict();

export const conversionMappingSchema = z
  .object({
    source: stableIdSchema,
    target: stableIdSchema,
    summary: z.string().min(1),
  })
  .strict();

const conversionProposalValueSchema = z
  .object({
    kind: z.literal("conversion"),
    character_id: stableIdSchema,
    source_mode: authoringModeSchema,
    target_mode: authoringModeSchema,
    modules: z.array(z.union([structuredZhujiModuleSchema, paletteModuleSchema])).min(1),
    mappings: z.array(conversionMappingSchema).min(1),
  })
  .strict();

export const importFieldMappingSchema = z
  .object({
    source_field: z.string().min(1),
    target_contract: z.string().min(1),
    target_field: z.string().min(1),
    summary: z.string().min(1),
  })
  .strict();

const importAnalysisProposalValueSchema = z
  .object({
    kind: z.literal("import_analysis"),
    mappings: z.array(importFieldMappingSchema),
    losses: z.array(z.string().min(1)).default([]),
    recommendations: z.array(z.string().min(1)).default([]),
  })
  .strict();

export const proposalValueSchema = z
  .discriminatedUnion("kind", [
  blueprintProposalValueSchema,
  characterProposalValueSchema,
  zhujiProposalValueSchema,
  paletteProposalValueSchema,
  worldProposalValueSchema,
  greetingsProposalValueSchema,
  relationshipsProposalValueSchema,
  conversionProposalValueSchema,
  importAnalysisProposalValueSchema,
  pluginProposalValueSchema,
  ])
  .superRefine((value, context) => {
    if (value.kind !== "conversion") return;
    if (value.source_mode === value.target_mode) {
      context.addIssue({ code: "custom", message: "轉換的來源與目標模式必須不同", path: ["target_mode"] });
    }
    if (value.modules.some((module) => module.mode !== value.target_mode)) {
      context.addIssue({ code: "custom", message: "所有轉換模組必須屬於目標模式", path: ["modules"] });
    }
  });

export const proposalSchema = z
  .object({
    schema_version: z.literal(1),
    id: stableIdSchema,
    owner: stableIdSchema,
    base_workflow_revision: z.number().int().nonnegative(),
    base_artifact_revision: revisionSchema.optional(),
    value: proposalValueSchema,
    extensions: jsonObjectSchema.default({}),
  })
  .strict();

export type ProposalValue = z.infer<typeof proposalValueSchema>;
export type Proposal = z.infer<typeof proposalSchema>;
