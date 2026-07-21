import { z } from "zod";

import { stableIdSchema } from "./ids.js";
import { jsonObjectSchema } from "./json.js";

export const authoringModeSchema = z.enum(["zhuji", "palette"]);
export const characterRoleSchema = z.enum(["primary", "supporting"]);
export const projectKindSchema = z.enum(["character_card", "worldbook"]);

export const projectCharacterSchema = z
  .object({
    id: stableIdSchema,
    display_name: z.string().min(1),
    mode: authoringModeSchema,
    role: characterRoleSchema.default("primary"),
  })
  .strict();

export const projectCardSchema = z
  .object({
    name: z.string().min(1),
    profile: z.literal("minimal_worldbook").default("minimal_worldbook"),
    avatar: z.string().min(1).default("assets/avatar.png"),
  })
  .strict();

export const projectOutputSchema = z
  .object({
    json: z.boolean().default(true),
    png: z.boolean().default(true),
    v2_backfill: z.boolean().default(false),
  })
  .strict();

export const projectPoliciesSchema = z
  .object({
    profile: stableIdSchema.default("workspace-default"),
    strict_publish: z.boolean().default(true),
  })
  .strict();

export const projectManifestSchema = z
  .object({
    schema_version: z.literal(1),
    id: stableIdSchema,
    title: z.string().min(1),
    kind: projectKindSchema,
    characters: z.array(projectCharacterSchema),
    card: projectCardSchema,
    output: projectOutputSchema.default({ json: true, png: true, v2_backfill: false }),
    policies: projectPoliciesSchema.default({
      profile: "workspace-default",
      strict_publish: true,
    }),
    plugins: z.array(stableIdSchema).default([]),
    extensions: jsonObjectSchema.default({}),
  })
  .strict()
  .superRefine((manifest, context) => {
    if (manifest.kind === "character_card" && manifest.characters.length === 0) {
      context.addIssue({ code: "custom", message: "角色卡專案至少需要一個角色", path: ["characters"] });
    }
    if (manifest.kind === "worldbook" && manifest.characters.length !== 0) {
      context.addIssue({ code: "custom", message: "世界書專案不可包含角色", path: ["characters"] });
    }
    const ids = new Set<string>();
    manifest.characters.forEach((character, index) => {
      if (ids.has(character.id)) {
        context.addIssue({
          code: "custom",
          message: `角色 ID 重複：${character.id}`,
          path: ["characters", index, "id"],
        });
      }
      ids.add(character.id);
    });
    const pluginIds = new Set<string>();
    manifest.plugins.forEach((pluginId, index) => {
      if (pluginIds.has(pluginId)) {
        context.addIssue({
          code: "custom",
          message: `Plugin ID 重複：${pluginId}`,
          path: ["plugins", index],
        });
      }
      pluginIds.add(pluginId);
    });
  });

export type AuthoringMode = z.infer<typeof authoringModeSchema>;
export type ProjectCharacter = z.infer<typeof projectCharacterSchema>;
export type ProjectManifest = z.infer<typeof projectManifestSchema>;
