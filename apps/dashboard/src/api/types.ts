export interface ApiSuccess<T> { ok: true; data: T }
export interface ApiFailure { ok: false; error: { code: string; message: string; retryable: boolean; diagnostics: unknown[]; next_actions: string[] } }
export type ApiEnvelope<T> = ApiSuccess<T> | ApiFailure;

export interface ProjectSummary {
  id: string;
  title: string;
  stage: string;
  workflow_revision: number;
  valid: boolean;
  character_count: number;
  pending_gates: number;
  failed_tasks: number;
  diagnostics: unknown[];
}

export interface ProjectDetail {
  project?: Record<string, unknown>;
  workflow?: Workflow;
  blueprint?: Record<string, unknown>;
  characters: Array<Record<string, unknown>>;
  greetings?: Record<string, unknown>;
  world: Array<Record<string, unknown>>;
  sources?: Record<string, unknown>;
  facts?: Record<string, unknown>;
  conflicts?: Record<string, unknown>;
  diagnostics: unknown[];
  revisions: Record<string, string>;
}

export interface Workflow {
  stage: string;
  revision: number;
  tasks: Array<{ id: string; status: string; assigned_agent?: string; attempt: number }>;
  gates: Array<{ id: string; status: string; input_revisions: Array<{ id: string; revision: string }> }>;
  decisions: Array<{ id: string; kind: string; summary: string; actor: string; decided_at: string }>;
  artifacts: Array<{ id: string; status: string; revision?: string }>;
}

export interface PluginProposal {
  id: string;
  task_id: string;
  project_id: string;
  owner: string;
  proposal_revision: string;
  base_workflow_revision: number;
  value: {
    plugin_id: string;
    capabilities: string[];
    template_id?: string;
    resolved_source_hash: string;
  };
}

export type PluginCapability = "mvu" | "ejs" | "html.status_bar" | "html.message_presentation" | "html.greeting_selector";

export interface PluginSelection {
  plugin_id: "official.mvu-zod" | "official.ejs" | "official.html";
  capabilities: PluginCapability[];
  template_id?: string;
}

export interface PluginSelectionProjection {
  schema_version: 1;
  project_id: string;
  intent_revision: string;
  selections: Array<{
    plugin_id: PluginSelection["plugin_id"];
    capabilities: PluginCapability[];
    source_revision: string;
    implementation: PluginImplementationPin;
    artifact_revision: string;
  }>;
  updated_at: string;
}

export interface PluginImplementationPin {
  version: string;
  digest: string;
  asset_manifest_id: string;
  asset_manifest_revision: string;
  asset_manifest_hash: string;
}

export interface PluginRevisionIntent {
  schema_version: 1;
  project_id: string;
  revision: string;
  project_kind: "character_card" | "worldbook";
  base_selection_revision: string;
  selections: PluginSelection[];
  dependency_closure: PluginSelection["plugin_id"][];
  implementation_pins: Array<{ plugin_id: PluginSelection["plugin_id"]; implementation: PluginImplementationPin }>;
}

export interface PluginDashboardState {
  project_id: string;
  project_kind?: string;
  workflow_stage?: string;
  workflow_revision?: number;
  blueprint_selections: PluginSelection[];
  selection?: PluginSelectionProjection;
  selection_revision?: string;
  sources: unknown[];
  artifacts: unknown[];
  pending_proposals: PluginProposal[];
  diagnostics: unknown[];
}
