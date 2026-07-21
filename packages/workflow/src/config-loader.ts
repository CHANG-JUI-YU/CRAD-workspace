import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  agentRegistrySchema,
  personalityProfileSchema,
  toolPolicySchema,
  workflowDefinitionsSchema,
  type AgentRegistry,
  type PersonalityProfile,
  type ToolPolicy,
  type WorkflowDefinitions,
} from "@card-workspace/schemas";
import { parse } from "yaml";
import type { ZodType } from "zod";

export class WorkflowConfigError extends Error {
  constructor(
    readonly code: "CONFIG_READ_FAILED" | "CONFIG_YAML_INVALID" | "CONFIG_SCHEMA_INVALID",
    readonly file: string,
    readonly details: unknown,
  ) {
    super(`${code}: ${file}`);
    this.name = "WorkflowConfigError";
  }
}

export interface WorkflowConfig {
  registry: AgentRegistry;
  toolPolicy: ToolPolicy;
  definitions: WorkflowDefinitions;
  personalities: PersonalityProfile[];
}

async function loadYaml<T>(root: string, file: string, schema: ZodType<T>): Promise<T> {
  let source: string;
  try {
    source = await readFile(resolve(root, file), "utf8");
  } catch (error) {
    throw new WorkflowConfigError("CONFIG_READ_FAILED", file, error);
  }

  let value: unknown;
  try {
    value = parse(source);
  } catch (error) {
    throw new WorkflowConfigError("CONFIG_YAML_INVALID", file, error);
  }

  const result = schema.safeParse(value);
  if (!result.success) {
    throw new WorkflowConfigError("CONFIG_SCHEMA_INVALID", file, result.error.issues);
  }
  return result.data;
}

export async function loadWorkflowConfig(root: string): Promise<WorkflowConfig> {
  const personalityDirectory = resolve(root, "workflow/personalities");
  let personalityEntries;
  try {
    personalityEntries = await readdir(personalityDirectory, { withFileTypes: true });
  } catch (error) {
    throw new WorkflowConfigError("CONFIG_READ_FAILED", "workflow/personalities", error);
  }
  const personalityFiles = personalityEntries
    .filter((entry) => entry.isFile() && /\.ya?ml$/u.test(entry.name))
    .map((entry) => `workflow/personalities/${entry.name}`)
    .sort();
  const [registry, toolPolicy, definitions, personalities] = await Promise.all([
    loadYaml(root, "workflow/agent-registry.yaml", agentRegistrySchema),
    loadYaml(root, "workflow/tool-policy.yaml", toolPolicySchema),
    loadYaml(root, "workflow/workflow-definitions.yaml", workflowDefinitionsSchema),
    Promise.all(personalityFiles.map((file) => loadYaml(root, file, personalityProfileSchema))),
  ]);
  return { registry, toolPolicy, definitions, personalities };
}
