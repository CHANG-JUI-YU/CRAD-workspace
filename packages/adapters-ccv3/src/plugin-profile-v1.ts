import { createHash } from "node:crypto";

import {
  pluginContributionsSchema,
  type PluginContributions,
} from "@card-workspace/schemas";
import { z } from "zod";

export const sillytavernRegexHelperProfileId = "sillytavern-regex-helper@1" as const;
export const sillytavernRegexHelperProfileNamespace = "7e7bd0b8-3b85-5f0a-9c7c-21aa15a2a2ab" as const;

const profileFingerprint = JSON.stringify({
  id: sillytavernRegexHelperProfileId,
  namespace: sillytavernRegexHelperProfileNamespace,
  resource_id: "<plugin-id>\n<implementation-version>\n<resource-kind>\n<normalized-resource-id>",
  resource_id_normalization: "lowercase-ascii-kebab",
  regex_fields: ["id", "scriptName", "findRegex", "replaceString", "trimStrings", "placement", "disabled", "markdownOnly", "promptOnly", "runOnEdit", "substituteRegex", "minDepth", "maxDepth"],
  helper_fields: ["type", "enabled", "id", "name", "content", "info", "button", "data"],
  targets: {
    regex: "/data/extensions/regex_scripts/-",
    helper: "/data/extensions/tavern_helper/scripts/-",
  },
});

export const sillytavernRegexHelperProfileRevision = `sha256:${createHash("sha256").update(profileFingerprint, "utf8").digest("hex")}`;

const uuidSchema = z.string().uuid();

const managedRegexScriptV1Schema = z
  .object({
    id: uuidSchema,
    scriptName: z.string().min(1),
    findRegex: z.string().min(1),
    replaceString: z.string(),
    trimStrings: z.array(z.string()),
    placement: z.array(z.number().int()),
    disabled: z.boolean(),
    markdownOnly: z.boolean(),
    promptOnly: z.boolean(),
    runOnEdit: z.boolean(),
    substituteRegex: z.boolean(),
    minDepth: z.number().int().nonnegative().nullable(),
    maxDepth: z.number().int().nonnegative().nullable(),
  })
  .strict()
  .superRefine((script, context) => {
    if (script.minDepth !== null && script.maxDepth !== null && script.minDepth > script.maxDepth) {
      context.addIssue({ code: "custom", path: ["minDepth"], message: "Regex minDepth 不可大於 maxDepth" });
    }
  });

const managedTavernHelperScriptV1Schema = z
  .object({
    type: z.literal("script"),
    enabled: z.boolean(),
    id: uuidSchema,
    name: z.string().min(1),
    content: z.string().min(1),
    info: z.string(),
    button: z
      .object({
        enabled: z.boolean(),
        buttons: z.array(z.object({ name: z.string().min(1), visible: z.boolean() }).strict()),
      })
      .strict(),
    data: z.object({}).strict(),
  })
  .strict();

export type ManagedRegexScriptV1 = z.infer<typeof managedRegexScriptV1Schema>;
export type ManagedTavernHelperScriptV1 = z.infer<typeof managedTavernHelperScriptV1Schema>;

function resourceId(value: string): string {
  const normalized = value.trim().toLowerCase().replaceAll(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "");
  if (!normalized) throw new Error("managed plugin resource ID 不可為空");
  return normalized;
}

function uuidV5(name: string): string {
  const namespace = Buffer.from(sillytavernRegexHelperProfileNamespace.replaceAll("-", ""), "hex");
  const digest = createHash("sha1").update(Buffer.concat([namespace, Buffer.from(name, "utf8")])).digest();
  digest[6] = (digest[6]! & 0x0f) | 0x50;
  digest[8] = (digest[8]! & 0x3f) | 0x80;
  const hex = digest.toString("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function managedPluginResourceId(
  pluginId: string,
  implementationVersion: string,
  resourceKind: "regex" | "helper",
  resourceIdValue: string,
): string {
  return uuidV5(`${pluginId}\n${implementationVersion}\n${resourceKind}\n${resourceId(resourceIdValue)}`);
}

export function toManagedRegexScriptV1(
  script: PluginContributions["regex_scripts"][number],
  id: string,
): ManagedRegexScriptV1 {
  return managedRegexScriptV1Schema.parse({
    id,
    scriptName: script.scriptName,
    findRegex: script.findRegex,
    replaceString: script.replaceString,
    trimStrings: script.trimStrings,
    placement: script.placement,
    disabled: script.disabled,
    markdownOnly: script.markdownOnly,
    promptOnly: script.promptOnly,
    runOnEdit: script.runOnEdit,
    substituteRegex: script.substituteRegex,
    minDepth: script.minDepth ?? null,
    maxDepth: script.maxDepth ?? null,
  });
}

export function toManagedTavernHelperScriptV1(
  script: PluginContributions["helper_scripts"][number],
  id: string,
): ManagedTavernHelperScriptV1 {
  return managedTavernHelperScriptV1Schema.parse({
    type: script.type,
    enabled: script.enabled,
    id,
    name: script.name,
    content: script.content,
    info: script.info,
    button: script.button,
    data: script.data,
  });
}

export function validatePluginCompatibilityProfile(value: unknown): PluginContributions {
  const contribution = pluginContributionsSchema.parse(value);
  for (const script of contribution.regex_scripts) {
    toManagedRegexScriptV1(
      script,
      managedPluginResourceId(contribution.plugin_id, contribution.implementation.version, "regex", script.scriptName),
    );
  }
  for (const script of contribution.helper_scripts) {
    toManagedTavernHelperScriptV1(
      script,
      managedPluginResourceId(contribution.plugin_id, contribution.implementation.version, "helper", script.id),
    );
  }
  return contribution;
}
