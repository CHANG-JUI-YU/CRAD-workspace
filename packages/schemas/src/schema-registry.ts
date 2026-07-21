import type { z } from "zod";

import {
  agentRegistrySchema,
  personalityProfileSchema,
  toolPolicySchema,
  workflowDefinitionsSchema,
} from "./agent-config.js";
import { blueprintSchema } from "./blueprint.js";
import { characterDocumentSchema } from "./character.js";
import { greetingsDocumentSchema } from "./greetings.js";
import { handoffSchema } from "./handoff.js";
import { cardInspectionReportSchema } from "./import.js";
import { conflictRegisterSchema } from "./conflict.js";
import { factRegisterSchema, factsCurationSummarySchema } from "./fact.js";
import { paletteModuleSchema } from "./palette.js";
import {
  pluginArtifactSchema,
  pluginBuildTraceSchema,
  pluginProposalEnvelopeSchema,
  pluginSelectionProjectionSchema,
  pluginTemplateManifestSchema,
  pluginTemplatePayloadSchema,
} from "./plugin-contracts.js";
import { pluginRevisionIntentSchema } from "./plugins.js";
import { proposalSchema } from "./proposal.js";
import { reviewReportSchema } from "./review.js";
import { relationshipsDocumentSchema } from "./relationships.js";
import { workflowStateSchema } from "./workflow.js";
import { worldEntrySchema } from "./world.js";
import { zhujiModuleSchema } from "./zhuji.js";

export const schemaRegistry = {
  "workflow-state@2": workflowStateSchema,
  "blueprint@1": blueprintSchema,
  "handoff@1": handoffSchema,
  "proposal@1": proposalSchema,
  "plugin-template-manifest@1": pluginTemplateManifestSchema,
  "plugin-template-payload@1": pluginTemplatePayloadSchema,
  "plugin-proposal@1": pluginProposalEnvelopeSchema,
  "plugin-revision-intent@1": pluginRevisionIntentSchema,
  "plugin-selection@1": pluginSelectionProjectionSchema,
  "plugin-artifact@1": pluginArtifactSchema,
  "plugin-build-trace@1": pluginBuildTraceSchema,
  "review-report@1": reviewReportSchema,
  "agent-registry@1": agentRegistrySchema,
  "tool-policy@1": toolPolicySchema,
  "workflow-definitions@1": workflowDefinitionsSchema,
  "personality@1": personalityProfileSchema,
  "character@1": characterDocumentSchema,
  "zhuji@1": zhujiModuleSchema,
  "palette@1": paletteModuleSchema,
  "world@1": worldEntrySchema,
  "greetings@1": greetingsDocumentSchema,
  "relationships@1": relationshipsDocumentSchema,
  "card-inspection@1": cardInspectionReportSchema,
  "facts-curation-summary@1": factsCurationSummarySchema,
  "fact-register@1": factRegisterSchema,
  "conflict-register@1": conflictRegisterSchema,
} satisfies Record<string, z.ZodType>;

export type RegisteredContractReference = keyof typeof schemaRegistry;

export const registeredContractReferences = Object.freeze(
  Object.keys(schemaRegistry) as RegisteredContractReference[],
);

export function resolveContractSchema(reference: string): z.ZodType {
  if (!Object.hasOwn(schemaRegistry, reference)) {
    throw new Error(`Unknown contract reference: ${reference}`);
  }
  return schemaRegistry[reference as RegisteredContractReference];
}

export function parseContract(reference: string, input: unknown): unknown {
  return resolveContractSchema(reference).parse(input);
}
