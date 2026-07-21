import { z } from "zod";
import {
  artifactReferenceSchema,
  authoringModeSchema,
  blueprintPrecheckCheckSchema,
  blueprintRelationshipsSchema,
  blueprintSchema,
  blueprintWorldSchema,
  collaborationModeSchema,
  candidateBatchSubmissionDraftSchema,
  factClassificationSchema,
  factStatusSchema,
  jsonObjectSchema,
  projectCardSchema,
  projectKindSchema,
  proposalSchema,
  resolutionDecisionSchema,
  reviewDecisionSchema,
  reviewReportSchema,
  revisionSchema,
  taskFailureCategorySchema,
  workflowEntryKindSchema,
  workflowGateIdSchema,
  gateRejectionRouteSchema,
  contentRevisionScopeSchema,
  blueprintPluginSelectionSchema,
  officialPluginIdSchema,
  pluginImplementationPinSchema,
  pluginProposalEnvelopeSchema,
  pluginTemplateManifestSchema,
  pluginTemplatePayloadSchema,
} from "@card-workspace/schemas";

import { authorTools } from "./tools/author.js";
import { artifactTools } from "./tools/artifacts.js";
import { bootstrapTools } from "./tools/bootstrap.js";
import { cardImportTools } from "./tools/card-import.js";
import { factTools } from "./tools/facts.js";
import { forgeTools } from "./tools/forge.js";
import { sourceTools } from "./tools/sources.js";
import { researchTools } from "./tools/research.js";
import type { ToolHandler, WorkspaceToolHandler } from "./tools/types.js";
import { workflowTools } from "./tools/workflow.js";
import { pluginTools } from "./tools/plugins.js";

const projectIdentity = {
  project_id: z.string().min(1).describe("Workspace project ID"),
  agent_id: z.string().optional().describe("Ignored; identity comes from server context"),
};

const taskLease = {
  task_id: z.string().min(1).describe("Current workflow task ID"),
  lease_id: z.string().min(1).describe("Current workflow task lease ID"),
};

const workflowEvent = {
  expected_workflow_revision: z.number().int().nonnegative().describe("Current workflow revision for compare-and-swap"),
  event_id: z.string().min(1).describe("Unique workflow event ID"),
  occurred_at: z.string().datetime({ offset: true }).describe("Workflow event timestamp"),
};

function projectInput<T extends z.ZodRawShape>(shape: T) {
  return z.object({ ...projectIdentity, ...shape });
}

interface ProjectRegisteredTool {
  scope: "project";
  description: string;
  inputSchema: z.ZodObject<z.ZodRawShape>;
  handler: ToolHandler;
}

interface WorkspaceRegisteredTool {
  scope: "workspace";
  description: string;
  inputSchema: z.ZodObject<z.ZodRawShape>;
  handler: WorkspaceToolHandler;
}

export type RegisteredTool = ProjectRegisteredTool | WorkspaceRegisteredTool;

const allHandlers = {
  ...workflowTools,
  ...artifactTools,
  ...sourceTools,
  ...researchTools,
  ...factTools,
  ...authorTools,
  ...forgeTools,
  ...cardImportTools,
  ...pluginTools,
} satisfies Record<string, ToolHandler>;

const proposalInput = {
  ...taskLease,
  ...workflowEvent,
  proposal: proposalSchema.describe("Typed proposal matching the current task"),
  expected_artifact_revisions: z.record(z.string(), z.union([revisionSchema, z.literal("absent")])).optional()
    .describe("Expected raw revisions by engine-derived target path; use absent for new files"),
};

const projectInputSchemas = {
  workflow_start: projectInput({
    ...workflowEvent,
    intake_answers: z.array(z.object({
      decision_id: z.string().min(1),
      question_id: z.string().min(1),
      answer: z.string().min(1),
    }).strict()).default([]).describe("Only confirmed intake answers not already persisted by project_initialize; required when recovering an empty intake workflow"),
    intake_completion: z.object({
      decision_id: z.string().min(1),
      answer: z.string().min(1).describe("The user's explicit answer that no settings remain to be added"),
      confirmed_no_additional_settings: z.literal(true),
    }).strict().describe("Required final intake confirmation before entering Blueprint"),
  }),
  workflow_status: projectInput({
    detail: z.enum(["summary", "full"]).default("summary")
      .describe("summary returns the bounded active task queue; full returns complete workflow history for explicit audits"),
  }),
  project_artifact_list: projectInput({}),
  project_artifact_read: projectInput({
    artifact_id: z.string().min(1).describe("Exact artifact ID returned by project_artifact_list"),
    revision: revisionSchema.describe("Exact artifact revision returned by project_artifact_list"),
  }),
  workflow_advance: projectInput({ ...workflowEvent }),
  world_authoring_begin: projectInput({
    ...workflowEvent,
    run_id: z.string().regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u).describe("Unique world authoring run ID"),
    world: blueprintWorldSchema.refine((value) => value.enabled, "World authoring cannot disable world"),
  }),
  world_revision_begin: projectInput({
    ...workflowEvent,
    run_id: z.string().regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u).describe("Unique World revision run ID"),
    reason: z.string().min(1).describe("Exact reviewed defects or approved changes that require World revision"),
    artifact_ids: z.array(z.string().min(1)).min(1).describe("Exact current world artifact IDs to revise"),
  }),
  greetings_revision_begin: projectInput({
    ...workflowEvent,
    run_id: z.string().regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u).describe("Unique Greeting revision run ID"),
    reason: z.string().min(1).describe("Exact defect or approved change that requires a new Greeting revision"),
  }),
  character_revision_begin: projectInput({
    ...workflowEvent,
    run_id: z.string().regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u).describe("Unique Character revision run ID"),
    reason: z.string().min(1).describe("Exact reviewed defects or approved changes that require Character revision"),
    artifact_ids: z.array(z.string().min(1)).min(1).describe("Exact current character base, module, or relationship artifact IDs to revise"),
  }),
  character_expansion_begin: projectInput({
    ...workflowEvent,
    run_id: z.string().regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u).describe("Unique Character expansion run ID"),
    reason: z.string().min(1).describe("Auditable reason for adding the requested characters"),
    new_title: z.string().min(1).optional().describe("Optional new Chinese display title; project ID and paths remain unchanged"),
    new_characters: z.array(z.object({
      id: z.string().regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u),
      display_name: z.string().min(1),
      mode: authoringModeSchema,
      core_concept: z.string().min(1),
      relationship_summary: z.string().min(1).optional(),
      role: z.enum(["primary", "supporting"]).default("supporting"),
    }).strict()).min(1).describe("Exact new character roster; supporting is the default role"),
    candidate_blueprint: blueprintSchema.describe("Complete candidate Blueprint preserving all existing characters and adding exactly the requested roster"),
    affected_artifact_ids: z.array(z.string().min(1)).default([]).describe("Existing exact character or relationship artifact IDs that need selective revision"),
    revise_world: z.boolean().describe("Whether world authoring and review must run after Character Review"),
  }),
  character_expansion_blueprint_update: projectInput({
    ...workflowEvent,
    run_id: z.string().regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u).describe("Active Character expansion run ID"),
    reason: z.string().min(1).describe("Reason for amending the rejected candidate Blueprint"),
    new_title: z.string().min(1).optional().describe("Optional corrected display title; project ID and paths remain unchanged"),
    candidate_blueprint: blueprintSchema.describe("Corrected candidate with the same expanded roster"),
  }),
  character_review_retry_begin: projectInput({
    ...workflowEvent,
    run_id: z.string().regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u).describe("Unique Character Review retry run ID"),
    reason: z.string().min(1).describe("Exact failure that requires a new Character Review task"),
  }),
  task_recovery_begin: projectInput({
    ...workflowEvent,
    task_id: z.string().min(1).describe("Exact terminal failed workflow task ID"),
    run_id: z.string().regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u).describe("Unique task recovery run ID"),
    failure_category: taskFailureCategorySchema.describe("Persisted failure category, or explicit classification for a legacy failed task"),
    reason: z.string().min(1).describe("Auditable reason for the one permitted recovery successor"),
  }),
  task_repair_resume: projectInput({
    ...workflowEvent,
    task_id: z.string().min(1).describe("Exact recovery-exhausted task ID to resume after the underlying project defect was repaired"),
    run_id: z.string().regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u).describe("Unique audited repair-resume run ID"),
    reason: z.string().min(1).describe("Concrete repaired defect and validation evidence"),
  }),
  source_processing_repair_begin: projectInput({
    ...workflowEvent,
    run_id: z.string().regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u).describe("Unique source-processing repair run ID"),
    reason: z.string().min(1).describe("Auditable reason for repairing the failed legacy curation task"),
  }),
  facts_recuration_begin: projectInput({
    ...workflowEvent,
    run_id: z.string().regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u).describe("Unique facts re-curation run ID"),
    reason: z.string().min(1).describe("Auditable quality reason for re-curating the current exact sources"),
  }),
  workflow_answer_interview: projectInput({
    ...workflowEvent,
    decision_id: z.string().min(1),
    question_id: z.string().min(1),
    answer: z.string().min(1),
  }),
  workflow_approve_gate: projectInput({
    ...workflowEvent,
    decision_id: z.string().min(1),
    gate_id: workflowGateIdSchema,
    input_revisions: z.array(artifactReferenceSchema).default([]),
    summary: z.string().min(1),
  }),
  workflow_reject_gate: projectInput({
    ...workflowEvent,
    decision_id: z.string().min(1),
    gate_id: workflowGateIdSchema,
    input_revisions: z.array(artifactReferenceSchema).default([]),
    summary: z.string().min(1),
    rejection_route: gateRejectionRouteSchema.optional(),
    revision_scope: z.array(contentRevisionScopeSchema).length(1).optional()
      .describe("Exactly one revision domain for content_revision"),
    revision_run_id: z.string().regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u).optional()
      .describe("Unique revision run ID; required for content_revision"),
    revision_artifact_ids: z.array(z.string().min(1)).default([])
      .describe("Exact current artifact IDs to revise; required except for greetings"),
  }),
  task_claim: projectInput({
    ...taskLease,
    ...workflowEvent,
    lease_duration_ms: z.number().int().positive().describe("Requested lease duration in milliseconds"),
  }),
  task_context: projectInput({
    ...taskLease,
    artifact_id: z.string().min(1).optional().describe("Optional exact artifact ID from the current task input_artifacts; returns only that artifact context"),
    detail: z.enum(["summary", "full"]).default("summary")
      .describe("summary returns task metadata and exact input references; full returns all approved project context for explicit bounded use"),
  }),
  task_submit: projectInput({
    ...taskLease,
    ...workflowEvent,
    result: artifactReferenceSchema,
  }),
  task_fail: projectInput({
    ...taskLease,
    ...workflowEvent,
    summary: z.string().min(1),
    failure_category: taskFailureCategorySchema.describe("Structured reason for the task execution failure"),
  }),
  task_release: projectInput({ ...taskLease, ...workflowEvent }),
  task_request_clarification: projectInput({
    ...taskLease,
    ...workflowEvent,
    clarification_id: z.string().min(1),
    decision_id: z.string().min(1),
    question: z.string().min(1),
    reason: z.string().min(1),
    affected_modules: z.array(z.string().min(1)).min(1),
    options: z.array(z.object({
      id: z.string().min(1),
      label: z.string().min(1),
      consequence: z.string().min(1),
    }).strict()).min(2).max(5),
  }),
  blueprint_precheck_record: projectInput({
    ...taskLease,
    ...workflowEvent,
    decision_id: z.string().min(1),
    candidate_blueprint: blueprintSchema.describe("Exact assisted-mode Blueprint candidate being prechecked"),
    checks: z.array(blueprintPrecheckCheckSchema).min(1).describe("Complete per-subject, per-dimension precheck record"),
  }),
  task_resolve_clarification: projectInput({
    ...workflowEvent,
    task_id: z.string().min(1),
    clarification_id: z.string().min(1),
    decision_id: z.string().min(1),
    answer: z.string().min(1),
    selected_option: z.string().min(1).optional(),
  }),
  source_intake_local: projectInput({
    source_id: z.string().min(1).describe("Source ID or exact assigned source artifact ID (source-<source_id>)"),
    title: z.string().min(1),
    file_path: z.string().min(1),
  }),
  source_intake_retrieved: projectInput({
    source_id: z.string().min(1),
    title: z.string().min(1),
    bytes_base64: z.string().min(1),
    requested_url: z.url(),
    canonical_url: z.url(),
    fetched_at: z.string().datetime({ offset: true }),
    media_type: z.string().min(1).optional(),
    extension: z.string().min(1).optional(),
    language: z.string().min(1).optional(),
  }),
  source_research_submit_candidates: projectInput({
    work_title: z.string().trim().min(1).max(300),
    character_names: z.array(z.string().trim().min(1).max(200)).min(1).max(20),
    aliases: z.array(z.string().trim().min(1).max(200)).max(40).default([]),
    language: z.string().trim().min(2).max(35),
    allowed_domains: z.array(z.string().trim().min(1)).max(20).default([]),
    result_count: z.number().int().min(1).max(10).default(8),
    candidates: z.array(z.object({
      title: z.string().trim().min(1).max(500),
      url: z.url(),
      snippet: z.string().trim().max(2000).default(""),
      language: z.string().trim().min(2).max(35),
    }).strict()).max(10),
  }),
  source_research_status: projectInput({ batch_id: z.string().min(1) }),
  source_research_approve: projectInput({
    batch_id: z.string().min(1),
    expected_batch_revision: revisionSchema,
    approved_candidate_ids: z.array(z.string().min(1)).max(10),
    decision_id: z.string().min(1),
    decided_at: z.string().datetime({ offset: true }),
    single_family_fallback: z.boolean().default(false),
    single_family_fallback_reason: z.string().trim().min(1).max(2000).optional(),
  }).superRefine((input, context) => {
    if (input.single_family_fallback && !input.single_family_fallback_reason) {
      context.addIssue({ code: "custom", path: ["single_family_fallback_reason"], message: "single_family_fallback_reason is required when single_family_fallback is true" });
    }
    if (!input.single_family_fallback && input.single_family_fallback_reason) {
      context.addIssue({ code: "custom", path: ["single_family_fallback_reason"], message: "single_family_fallback_reason requires single_family_fallback=true" });
    }
  }),
  source_research_fetch_approved: projectInput({ batch_id: z.string().min(1) }),
  source_create_chunks: projectInput({
    ...taskLease,
    ...workflowEvent,
    source_id: z.string().min(1),
    source_revision_id: revisionSchema,
  }),
  source_get_chunk_task: projectInput({
    ...taskLease,
    job_id: z.string().min(1),
    claim: z.boolean().default(false),
    chunk_id: z.string().min(1).optional(),
    expected_job_revision: z.number().int().nonnegative().optional(),
    chunk_lease_id: z.string().min(1).optional(),
    chunk_lease_duration_ms: z.number().int().positive().optional(),
  }).superRefine((input, context) => {
    if (!input.claim) return;
    for (const key of ["chunk_id", "expected_job_revision", "chunk_lease_id", "chunk_lease_duration_ms"] as const) {
      if (input[key] === undefined) context.addIssue({ code: "custom", path: [key], message: `${key} is required when claim is true` });
    }
  }),
  fact_submit_candidates: projectInput({
    ...taskLease,
    batch: candidateBatchSubmissionDraftSchema,
    expected_job_revision: z.number().int().nonnegative(),
    chunk_lease_id: z.string().min(1).describe("Current ingestion chunk lease ID"),
  }),
  fact_finalize_curation: projectInput({
    ...taskLease,
    ...workflowEvent,
    result_id: z.string().regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u).describe("Stable facts-curation-summary result ID"),
  }),
  facts_review_status: projectInput({
    limit: z.number().int().min(1).max(50).default(20),
    cursor: z.string().min(1).optional().describe("Opaque cursor returned by the preceding facts_review_status page"),
    review_state: z.enum(["all", "reviewed", "unreviewed"]).default("all"),
  }),
  fact_query: projectInput({
    filter: z.object({
      status: factStatusSchema.optional(),
      subject: z.string().min(1).optional(),
      predicate: z.string().min(1).optional(),
      classification: factClassificationSchema.optional(),
      sourceId: z.string().min(1).optional(),
      gateStatus: z.enum(["clear", "blocked_unresolved_conflict"]).optional(),
    }).default({}),
  }),
  fact_review: projectInput({
    decision: reviewDecisionSchema.extend({
      candidate_id: z.string().regex(/^candidate-occurrence-[a-f0-9]{64}$/u),
    }),
    expected_projection_revision: revisionSchema,
    expected_fact_revision: z.number().int().positive().optional(),
    patch: jsonObjectSchema.optional(),
  }),
  facts_candidate_identity_migrate: projectInput({
    decision_id: z.string().min(1).describe("Exact legacy review decision ID reported by facts_review_status"),
    expected_projection_revision: revisionSchema,
    occurred_at: z.string().datetime({ offset: true }),
  }),
  conflict_resolve: projectInput({
    decision: resolutionDecisionSchema,
    expected_projection_revision: revisionSchema,
    expected_fact_revisions: z.record(z.string(), z.number().int().positive()).default({}),
  }),
  provenance_trace: projectInput({ id: z.string().min(1) }),
  provenance_verify: projectInput({}),
  blueprint_submit_proposal: projectInput(proposalInput),
  character_submit_proposal: projectInput(proposalInput),
  world_submit_proposal: projectInput(proposalInput),
  greetings_submit_proposal: projectInput(proposalInput),
  conversion_submit_proposal: projectInput(proposalInput),
  import_submit_analysis: projectInput(proposalInput),
  review_submit_report: projectInput({
    ...taskLease,
    ...workflowEvent,
    report: reviewReportSchema.describe("Typed review report matching the current task"),
  }),
  project_validate: projectInput({}),
  project_plan: projectInput({}),
  project_simulate: projectInput({
    strict: z.boolean().default(true),
    token_budget: z.number().int().positive().optional(),
  }),
  project_compile_preview: projectInput({
    preview_id: z.string().min(1),
    event_id: z.string().min(1),
    occurred_at: z.string().datetime({ offset: true }),
    strict: z.boolean().default(true),
    token_budget: z.number().int().positive().optional(),
  }),
  project_publish: projectInput({
    preview_id: z.string().min(1),
    event_id: z.string().min(1).describe("Unique publish event ID"),
    occurred_at: z.string().datetime({ offset: true }).describe("Publish event timestamp"),
  }),
  card_import: projectInput({ bytes_base64: z.string().min(1) }),
  card_audit: projectInput({
    card: z.unknown(),
    strict: z.boolean().default(true),
  }),
  roundtrip_verify: projectInput({ bytes_base64: z.string().min(1) }),
  card_inspect_local: projectInput({
    ...workflowEvent,
    file_path: z.string().min(1).describe("Explicit local PNG, JSON, YAML, or YML file path"),
  }),
  card_import_report: projectInput({}),
  card_import_disposition: projectInput({
    ...workflowEvent,
    decision_id: z.string().min(1),
    disposition: z.enum(["retain_report", "corrected_copy", "full_rebuild", "cancel"]),
    summary: z.string().min(1),
  }),
  plugin_selection_resolve: projectInput({}),
  plugin_revision_preview: projectInput({
    desired_selections: z.array(blueprintPluginSelectionSchema).optional(),
    implementation_pins: z.record(officialPluginIdSchema, pluginImplementationPinSchema).optional(),
  }),
  plugin_revision_begin: projectInput({
    ...workflowEvent,
    desired_selections: z.array(blueprintPluginSelectionSchema).optional(),
    implementation_pins: z.record(officialPluginIdSchema, pluginImplementationPinSchema).optional(),
  }),
  plugin_proposal_preview: projectInput({
    proposal: pluginProposalEnvelopeSchema,
    template_parameters: z.record(z.string(), z.union([
      z.string(),
      z.number().finite(),
      z.boolean(),
      z.null(),
      z.array(z.union([z.string(), z.number().finite(), z.boolean(), z.null()])),
    ])).optional(),
  }),
  plugin_proposal_submit: projectInput({
    ...taskLease,
    ...workflowEvent,
    proposal: pluginProposalEnvelopeSchema,
  }),
  plugin_review_decide: projectInput({
    ...workflowEvent,
    proposal: pluginProposalEnvelopeSchema,
    action: z.enum(["approve", "reject"]),
    authorization_token: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
    authenticated_session_id: z.string().regex(/^[A-Za-z0-9_-]{32,}$/u).optional(),
  }),
  template_list: projectInput({ plugin_id: officialPluginIdSchema.optional() }),
  template_read: projectInput({ plugin_id: officialPluginIdSchema, template_id: z.string().min(1) }),
  template_import: projectInput({
    plugin_id: officialPluginIdSchema,
    template_id: z.string().min(1),
    manifest: pluginTemplateManifestSchema,
    payload: pluginTemplatePayloadSchema,
    expected_manifest_revision: revisionSchema.optional(),
    expected_payload_revision: revisionSchema.optional(),
  }),
  template_save_from_artifact: projectInput({
    plugin_id: officialPluginIdSchema,
    template_id: z.string().min(1),
    artifact_id: z.string().min(1),
    description: z.string().min(1).optional(),
    expected_manifest_revision: revisionSchema.optional(),
    expected_payload_revision: revisionSchema.optional(),
  }),
} satisfies Record<keyof typeof allHandlers, z.ZodObject<z.ZodRawShape>>;

const descriptions: Record<keyof typeof allHandlers, string> = {
  workflow_start: "Persist only new intake answers plus the user's final no-additional-settings confirmation, then enter the configured next stage and materialize its tasks.",
  workflow_status: "Read current revision, gates, and a bounded agent-specific active task queue by default; request full detail only for explicit history audits.",
  project_artifact_list: "List controlled, currently resolvable author artifacts, review reports, and compile previews without exposing file paths.",
  project_artifact_read: "Read one controlled artifact by exact ID and revision without requiring a task, lease, or filesystem path.",
  workflow_advance: "Advance to the next configured stage and materialize its Blueprint-driven tasks after all prerequisites pass.",
  world_authoring_begin: "Begin a world-only authoring run for a published project without deleting existing world entries.",
  world_revision_begin: "Create auditable World Creator revision tasks for selected exact world artifacts, followed by fresh World and downstream review rounds.",
  greetings_revision_begin: "Create a new auditable Greeting revision task without reopening or overwriting the completed original task.",
  character_revision_begin: "Create auditable Creator revision tasks for selected exact character artifacts, followed by fresh Character and Greeting review rounds.",
  character_expansion_begin: "Atomically append one or more characters and placeholders, optionally rename the display title and select existing artifacts/world for revision, then stop at the exact Blueprint Gate without creating Creator tasks.",
  character_expansion_blueprint_update: "Amend the active rejected Character expansion candidate and optional display title without changing its new roster or rebuilding placeholders.",
  character_review_retry_begin: "Create a new auditable Character Review task after a failed review without reopening or erasing the failed task.",
  task_recovery_begin: "Create one auditable successor for an attempts-exhausted task with a transient failure, preserving history and rewiring pending direct dependents.",
  task_repair_resume: "Resume the same recovery-exhausted task once after its underlying project defect has been repaired and validated, without adding an attempt.",
  source_processing_repair_begin: "Create a bounded corrected curate-facts successor for an exhausted Source Adaptation task while preserving its repair lineage.",
  facts_recuration_begin: "Return a Source Adaptation workflow from Facts Review to source processing with a new run-identified curation task while preserving completed history.",
  workflow_answer_interview: "Record one interview answer with workflow CAS.",
  workflow_approve_gate: "Relay a user gate approval only after OpenCode's explicit ask-permission confirmation.",
  workflow_reject_gate: "Relay a user gate rejection only after OpenCode's explicit ask-permission confirmation.",
  task_claim: "Claim an assigned pending workflow task.",
  task_context: "Read bounded metadata for the current leased task by default. Use artifact_id from task.input_artifacts to retrieve one exact revision without accepting file paths; request full only when its size is known to be bounded.",
  task_submit: "Complete a non-proposal leased workflow task with an existing artifact reference. Tasks requiring proposal@1 must use their specialized proposal submission tool.",
  task_fail: "Fail the current leased workflow task with structured failure metadata.",
  task_release: "Release the current leased workflow task.",
  task_request_clarification: "Pause an assisted-mode Creator task for one high-uncertainty, high-impact user decision.",
  blueprint_precheck_record: "Persist the complete assisted-mode Blueprint precheck for the exact candidate revision before proposal submission.",
  task_resolve_clarification: "Record the user's clarification through the Director and return the Creator task to pending.",
  source_intake_local: "Ingest one explicit regular local source file.",
  source_intake_retrieved: "Ingest caller-supplied retrieved bytes and URL metadata.",
  source_research_submit_candidates: "Persist a bounded set of model-discovered web candidates for Source Adaptation intake; snippets remain discovery metadata only.",
  source_research_status: "Read the exact current research batch, approval audit, and fetch lineage.",
  source_research_approve: "Record Director approval for exact candidate IDs at the exact current batch revision; normally select two source families and include official when available, or explicitly audit a justified single-family fallback.",
  source_research_fetch_approved: "Controlled-fetch only approved candidates and ingest their extracted text as immutable sources.",
  source_create_chunks: "Create deterministic chunks and an extraction job, then bind the exact job to the leased curation task.",
  source_get_chunk_task: "Read or claim a task-bound ingestion chunk and return its verified exact payload.",
  fact_submit_candidates: "Resolve exact quote locators against a task-bound chunk, derive complete evidence plus the trusted batch creator, deterministic ID and content hash, then atomically complete the chunk.",
  fact_finalize_curation: "Validate every task-bound extraction result, persist a facts-curation-summary, and complete the leased curation task.",
  facts_review_status: "Read the bounded Source Adaptation candidate, decision, register, conflict, task, and job review status.",
  fact_query: "Query the projected fact register.",
  fact_review: "Apply a fact review decision with revision checks.",
  facts_candidate_identity_migrate: "Explicitly append an auditable binding from one uniquely resolvable legacy raw-ID review decision to its exact candidate occurrence; never rewrites historical events or batches.",
  conflict_resolve: "Resolve a fact conflict with revision checks.",
  provenance_trace: "Trace provenance for one domain ID.",
  provenance_verify: "Verify author-to-source provenance.",
  blueprint_submit_proposal: "Submit a blueprint proposal as a task result.",
  character_submit_proposal: "Submit a character/module or project-level relationships proposal as a task result.",
  world_submit_proposal: "Submit a world proposal as a task result.",
  greetings_submit_proposal: "Submit a greetings proposal as a task result.",
  review_submit_report: "Submit a read-only review report as a task result.",
  conversion_submit_proposal: "Submit a mode conversion proposal as a task result.",
  import_submit_analysis: "Submit import mapping analysis as a task result.",
  project_validate: "Validate the project through the project library.",
  project_plan: "Normalize and plan the project through compiler libraries.",
  project_simulate: "Run a non-publishing compiler simulation.",
  project_compile_preview: "Create a persistent non-publishing compile preview. From published, this starts a controlled repackaging cycle and reopens compile_preview.",
  project_publish: "Publish the exact approved preview and enter the published stage only after exports are written.",
  card_import: "Import caller-supplied JSON or PNG card bytes.",
  card_audit: "Audit a supplied card value.",
  roundtrip_verify: "Import and round-trip caller-supplied card bytes.",
  card_inspect_local: "Read one explicit local legacy card through immutable intake and persist deterministic import, audit, and round-trip inspection.",
  card_import_report: "Read the traceable deterministic inspection and completed Card Import Analyst analysis.",
  card_import_disposition: "Record the user's legacy-card disposition; corrected copy exports safely and full rebuild stops at the Blueprint gate.",
  plugin_selection_resolve: "Read the server-derived active plugin selection, exact source revisions, approved artifacts, and diagnostics.",
  plugin_revision_preview: "Resolve an immutable plugin revision intent without mutating the project.",
  plugin_revision_begin: "Persist a new immutable plugin revision intent and route the workflow through dependency-ordered plugin authoring stages.",
  plugin_proposal_preview: "Compile a typed plugin proposal without writing canonical source or workflow state.",
  plugin_proposal_submit: "Submit one leased plugin author proposal as an immutable pending result; it cannot modify canonical source or approval state.",
  plugin_review_decide: "Apply a plugin proposal only with a server-issued, one-time user authorization token; MCP cannot mint that token.",
  template_list: "List versioned typed plugin templates without exposing filesystem paths.",
  template_read: "Read one schema-validated versioned plugin template by exact plugin and template ID.",
  template_import: "Persist a schema-validated typed plugin template through the Director-controlled workflow; raw code and arbitrary path writes are not accepted.",
  template_save_from_artifact: "Save a typed template only from an approved plugin artifact.",
};

const workspaceTools: Readonly<Record<string, WorkspaceRegisteredTool>> = Object.freeze({
  project_list: {
    scope: "workspace",
    description: "List recently active valid projects, optionally filtered by project ID or title.",
    inputSchema: z.object({
      query: z.string().optional().describe("Optional project ID or title fragment"),
      limit: z.number().int().min(1).max(4).default(4).describe("Maximum recent projects to return"),
      agent_id: projectIdentity.agent_id,
    }),
    handler: bootstrapTools.project_list!,
  },
  project_initialize: {
    scope: "workspace",
    description: "Initialize a complete project foundation without overwriting an existing project.",
    inputSchema: z.object({
      project_id: projectIdentity.project_id,
      title: z.string().min(1).describe("Project title"),
      kind: projectKindSchema.default("character_card").describe("Project output kind"),
      entry_kind: workflowEntryKindSchema.describe("Creation entry: original, source adaptation, card import, or mode conversion"),
      collaboration_mode: collaborationModeSchema.describe("Creative collaboration: free model completion or assisted user clarification"),
      characters: z.array(z.object({
        display_name: z.string().min(1).describe("Character display name"),
        mode: authoringModeSchema.describe("Character authoring mode"),
      }).strict()).default([]).describe("Characters; must be empty for worldbook projects"),
      card: projectCardSchema.optional().describe("Optional card metadata; defaults to the project title"),
      world: blueprintWorldSchema.optional().describe("Optional typed world Blueprint settings; enabled character-card worlds must select before_characters or after_characters"),
      relationships: blueprintRelationshipsSchema.optional().describe("Optional shared relationship network; enabled networks require at least two generated character IDs such as character-1 and character-2"),
      occurred_at: z.string().datetime({ offset: true }).describe("Timestamp for persisted intake decisions"),
      intake_answers: z.array(z.object({
        decision_id: z.string().min(1),
        question_id: z.string().min(1),
        answer: z.string().min(1),
      }).strict()).min(1).describe("Structured pre-initialization interview answers"),
      agent_id: projectIdentity.agent_id,
    }),
    handler: bootstrapTools.project_initialize!,
  },
});

const projectTools = Object.fromEntries(
  Object.entries(allHandlers).map(([name, handler]) => {
    const toolName = name as keyof typeof allHandlers;
    return [toolName, {
      scope: "project" as const,
      description: descriptions[toolName],
      inputSchema: projectInputSchemas[toolName],
      handler,
    }];
  }),
);

export const toolRegistry: Readonly<Record<string, RegisteredTool>> = Object.freeze({
  ...workspaceTools,
  ...projectTools,
});

export const registeredToolNames = Object.freeze(Object.keys(toolRegistry).sort());
