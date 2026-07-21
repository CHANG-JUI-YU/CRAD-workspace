import { z } from "zod";

import { stableIdSchema } from "./ids.js";
import { jsonObjectSchema } from "./json.js";
import { authoringModeSchema, projectKindSchema } from "./project.js";
import { blueprintPluginSelectionSchema } from "./plugins.js";
import { workflowEntryKindSchema } from "./workflow-contracts.js";
import { worldCategorySchema } from "./world.js";

export const collaborationModeSchema = z.enum(["free", "assisted"]);

export const blueprintCharacterSchema = z
  .object({
    id: stableIdSchema,
    display_name: z.string().min(1),
    mode: authoringModeSchema,
    core_concept: z.string().min(1),
    relationship_summary: z.string().min(1).optional(),
    fact_refs: z.array(stableIdSchema).default([]),
    extensions: jsonObjectSchema.default({}),
  })
  .strict();

export const blueprintWorldSchema = z
  .object({
    enabled: z.boolean(),
    authoring_timing: z.enum(["before_characters", "after_characters"]).optional(),
    categories: z.array(worldCategorySchema).default([]),
    scope: z.string().min(1).optional(),
    fact_refs: z.array(stableIdSchema).default([]),
    token_budget: z.number().int().positive().optional(),
  })
  .strict();

export const blueprintGreetingsSchema = z
  .object({
    enabled: z.boolean(),
    character_ids: z.array(stableIdSchema).default([]),
    requirements: z.array(z.string().min(1)).default([]),
  })
  .strict();

export const blueprintRelationshipsSchema = z
  .object({
    enabled: z.boolean(),
    character_ids: z.array(stableIdSchema).default([]),
    requirements: z.array(z.string().min(1)).default([]),
    extensions: jsonObjectSchema.default({}),
  })
  .strict()
  .superRefine((relationships, context) => {
    const ids = new Set<string>();
    relationships.character_ids.forEach((characterId, index) => {
      if (ids.has(characterId)) {
        context.addIssue({ code: "custom", message: `關係參與角色 ID 重複：${characterId}`, path: ["character_ids", index] });
      }
      ids.add(characterId);
    });
    if (relationships.enabled && relationships.character_ids.length < 2) {
      context.addIssue({ code: "custom", message: "啟用角色關係至少需要兩個角色", path: ["character_ids"] });
    }
  });

export const blueprintDecisionSchema = z
  .object({
    id: stableIdSchema,
    question: z.string().min(1),
    impact: z.string().min(1),
  })
  .strict();

export const blueprintSchema = z
  .object({
    schema_version: z.literal(1),
    project_id: stableIdSchema,
    project_kind: projectKindSchema.optional(),
    entry_kind: workflowEntryKindSchema,
    collaboration_mode: collaborationModeSchema.default("free"),
    purpose: z.string().min(1),
    characters: z.array(blueprintCharacterSchema),
    world: blueprintWorldSchema,
    greetings: blueprintGreetingsSchema,
    relationships: blueprintRelationshipsSchema.default({ enabled: false, character_ids: [], requirements: [], extensions: {} }),
    fact_refs: z.array(stableIdSchema).default([]),
    unresolved_decisions: z.array(blueprintDecisionSchema).default([]),
    plugins: z.array(blueprintPluginSelectionSchema).default([]),
    approved_revision: z.number().int().nonnegative().optional(),
    extensions: jsonObjectSchema.default({}),
  })
  .strict()
  .superRefine((blueprint, context) => {
    if (blueprint.plugins.length > 0 && blueprint.project_kind !== "character_card") {
      context.addIssue({ code: "custom", message: "啟用 authoring plugins 時必須明確指定 character_card project_kind", path: ["project_kind"] });
    }
    if (blueprint.characters.length === 0 && (!blueprint.world.enabled || blueprint.greetings.enabled)) {
      context.addIssue({
        code: "custom",
        message: "無角色 Blueprint 必須啟用世界設定並停用 greetings",
        path: ["characters"],
      });
    }
    const ids = new Set<string>();
    blueprint.characters.forEach((character, index) => {
      if (ids.has(character.id)) {
        context.addIssue({ code: "custom", message: `角色 ID 重複：${character.id}`, path: ["characters", index, "id"] });
      }
      ids.add(character.id);
    });
    blueprint.relationships.character_ids.forEach((characterId, index) => {
      if (!ids.has(characterId)) {
        context.addIssue({ code: "custom", message: `關係設定引用未知角色：${characterId}`, path: ["relationships", "character_ids", index] });
      }
    });
  });

export type Blueprint = z.infer<typeof blueprintSchema>;
export type BlueprintRelationshipsInput = z.input<typeof blueprintRelationshipsSchema>;
export type CollaborationMode = z.infer<typeof collaborationModeSchema>;
