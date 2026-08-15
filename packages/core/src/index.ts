/**
 * Public Core barrel.
 *
 * Domain state, projections, codecs and repository adapters live in focused
 * modules. This file intentionally contains no state or persistence logic so
 * package consumers keep the stable `@st-workspace/core` import path while
 * internal responsibilities remain independently maintainable.
 */
export { z } from "zod";

export * from "./core-utilities.js";
export * from "./coverage.js";
export * from "./provenance.js";
export * from "./coverage-command-identity.js";
export * from "./project-state.js";
export * from "./fact-taxonomy.js";
export * from "./entity-matcher.js";
export * from "./operations.js";
export * from "./project-projection.js";
export * from "./relationship-graph.js";
export * from "./project-state-schema.js";
export * from "./artifact-fingerprint.js";
export * from "./artifact-binding.js";
export * from "./repository/project-repository.js";
export { MemoryProjectRepository } from "./repository/memory-project-repository.js";
export { FileProjectRepository } from "./repository/file-project-repository.js";
export * from "./attachments.js";
export * from "./export-paths.js";

// Existing domain modules remain public through the same compatibility barrel.
export * from "./zhuji.js";
export * from "./interview.js";
export * from "./zhuji-template.js";
export {
  TEMPLATE_BINDINGS,
  TEMPLATE_GUIDES,
  buildTemplateContext,
  characterDocumentTemplateSchema,
  characterProposalValueSchema,
  characterRelationshipTemplateSchema,
  conversionMappingSchema,
  conversionProposalValueSchema,
  directorRoutingProposalValueSchema,
  directionalPerspectiveSchema,
  ejsConditionSchema,
  ejsDynamicTextSchema,
  ejsEntrySchema,
  ejsSectionSchema,
  ejsSourceSchema,
  factClaimSchema,
  factCurationProposalValueSchema,
  factDecisionSchema,
  factEvidenceSchema,
  factEvidenceReferenceSchema,
  factReviewProposalValueSchema,
  greetingKindSchema,
  greetingSchema,
  greetingsDocumentSchema,
  greetingsProposalValueSchema,
  htmlComponentSchema,
  htmlFeatureSchema,
  htmlSourceSchema,
  importAnalysisProposalValueSchema,
  importFieldMappingSchema,
  jsonPointerPathSchema,
  mvuSourceSchema,
  mvuUpdateRuleSchema,
  mvuVariableSchema,
  officialPluginIdSchema,
  paletteModuleKindSchema,
  paletteModuleSchema,
  paletteProposalValueSchema,
  pluginCapabilitySchema,
  pluginProposalValueSchema,
  pluginSourceSchema,
  relationshipsDocumentSchema,
  relationshipsProposalValueSchema,
  relationshipCharacterSummarySchema,
  relationshipConflictTriggerSchema,
  relationshipGroupSchema,
  relationshipNetworkSummarySchema,
  relationshipTeamCodeSchema,
  reviewEvidenceSchema,
  reviewFindingSchema,
  reviewProposalValueSchema,
  reviewReportSchema,
  reviewSeveritySchema,
  sourceCandidateDraftSchema,
  sourceResearchProposalValueSchema,
  templateIdSchema,
  templateJsonSchemaFor,
  templateProvenanceSchema,
  templateProposalJsonSchema,
  templateProposalValueSchema,
  templateSchemaFor,
  templateSectionSchema,
  worldCategorySchema,
  worldEntrySchema,
  worldProposalValueSchema,
  type CharacterDocumentTemplate,
  type FactClaim,
  type FactDecision,
  type GreetingsDocument,
  type PaletteModule,
  type PaletteModuleKind,
  type PluginSource,
  type RelationshipsDocument,
  type ReviewFinding,
  type TemplateInstance,
  type TemplateKind,
  type TemplateProposalValue,
  type WardrobeProposalValue,
  type WorldEntry,
} from "./templates.js";
export * from "./wardrobe.js";
export * from "./fact-provenance.js";
export * from "./authoring-context.js";
