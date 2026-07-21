import { z } from "zod";

import { stableIdSchema } from "./ids.js";
import { jsonObjectSchema } from "./json.js";
import {
  contractReferenceSchema,
  workflowEntryKindSchema,
  workflowGateIdSchema,
  workflowStageSchema,
} from "./workflow-contracts.js";

export const agentDefinitionSchema = z
  .object({
    id: stableIdSchema,
    kind: stableIdSchema,
    agent_file: z.string().min(1),
    skill: stableIdSchema,
    personality: stableIdSchema,
    capabilities: z.array(stableIdSchema),
    input_contracts: z.array(contractReferenceSchema),
    output_contracts: z.array(contractReferenceSchema),
    extensions: jsonObjectSchema.default({}),
  })
  .strict();

export const agentRegistrySchema = z
  .object({
    schema_version: z.literal(1),
    agents: z.array(agentDefinitionSchema),
    extensions: jsonObjectSchema.default({}),
  })
  .strict()
  .superRefine((registry, context) => {
    const ids = new Set<string>();
    registry.agents.forEach((agent, index) => {
      if (ids.has(agent.id)) {
        context.addIssue({ code: "custom", message: `Agent ID 重複：${agent.id}`, path: ["agents", index, "id"] });
      }
      ids.add(agent.id);
    });
  });

export const toolPolicyRuleSchema = z
  .object({
    capability: stableIdSchema,
    tools: z.array(stableIdSchema).min(1),
    stages: z.array(workflowStageSchema).min(1),
    mutation: z.boolean(),
    requires_task: z.boolean(),
    requires_gate: workflowGateIdSchema.optional(),
  })
  .strict();

export const toolPolicySchema = z
  .object({
    schema_version: z.literal(1),
    rules: z.array(toolPolicyRuleSchema),
    extensions: jsonObjectSchema.default({}),
  })
  .strict();

export const workflowTaskTemplateSchema = z
  .object({
    id: stableIdSchema,
    kind: stableIdSchema,
    agent_kind: stableIdSchema,
    stage: workflowStageSchema,
    capabilities: z.array(stableIdSchema),
    output_contract: contractReferenceSchema,
    max_attempts: z.number().int().positive(),
  })
  .strict();

export const workflowDefinitionSchema = z
  .object({
    id: stableIdSchema,
    entry_kind: workflowEntryKindSchema,
    stages: z.array(workflowStageSchema).min(1),
    required_gates: z.array(workflowGateIdSchema),
    tasks: z.array(workflowTaskTemplateSchema),
  })
  .strict();

export const workflowDefinitionsSchema = z
  .object({
    schema_version: z.literal(1),
    definitions: z.array(workflowDefinitionSchema),
    extensions: jsonObjectSchema.default({}),
  })
  .strict()
  .superRefine((document, context) => {
    const ids = new Set<string>();
    const entries = new Set<string>();
    document.definitions.forEach((definition, index) => {
      if (ids.has(definition.id)) {
        context.addIssue({ code: "custom", message: `Workflow definition ID 重複：${definition.id}`, path: ["definitions", index, "id"] });
      }
      if (entries.has(definition.entry_kind)) {
        context.addIssue({ code: "custom", message: `Entry kind 重複：${definition.entry_kind}`, path: ["definitions", index, "entry_kind"] });
      }
      ids.add(definition.id);
      entries.add(definition.entry_kind);
    });
  });

export const personalityProfileSchema = z
  .object({
    schema_version: z.literal(1),
    id: stableIdSchema,
    tone: z.string().min(1),
    style: z.array(z.string().min(1)),
    prohibited_behaviors: z.array(z.string().min(1)).default([]),
    extensions: jsonObjectSchema.default({}),
  })
  .strict();

export type AgentDefinition = z.infer<typeof agentDefinitionSchema>;
export type AgentRegistry = z.infer<typeof agentRegistrySchema>;
export type ToolPolicy = z.infer<typeof toolPolicySchema>;
export type WorkflowDefinitions = z.infer<typeof workflowDefinitionsSchema>;
export type PersonalityProfile = z.infer<typeof personalityProfileSchema>;
