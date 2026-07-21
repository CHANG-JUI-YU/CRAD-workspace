import type {
  AuditReport,
  PluginBuildTrace,
  PluginImplementationPin,
  Revision,
  TokenSimulationReport,
  TriggerSimulationReport,
} from "@card-workspace/schemas";

export interface BuildArtifactRecord {
  path: string;
  revision: Revision;
  bytes: number;
}

/** Build metadata contains runtime timings and is not a reproducible artifact hash. */
export function isStableArtifactHashPath(path: string): boolean {
  return !path.endsWith("/.build/manifest.json") && !path.endsWith("/.build/plugin-build-trace.json");
}

export function stableArtifactHashes(artifacts: readonly BuildArtifactRecord[]): Record<string, Revision> {
  return Object.fromEntries(
    artifacts
      .filter((artifact) => isStableArtifactHashPath(artifact.path))
      .map((artifact) => [artifact.path, artifact.revision]),
  );
}

export interface ForgeBuildManifest {
  schema_version: 1;
  project_id: string;
  input_revision: Revision;
  workflow_revision: number;
  tool: { name: "card-workspace"; version: string };
  tokenizer: TokenSimulationReport["tokenizer"];
  passes_ms: Record<string, number>;
  artifacts: BuildArtifactRecord[];
  audit: AuditReport["summary"];
  trigger_profile: TriggerSimulationReport["profile"];
  plugin_artifacts?: PluginBuildRecord[];
  plugin_selection_revision?: PluginBuildTrace["selection_revision"];
  plugin_diagnostics_summary?: PluginBuildTrace["diagnostics_summary"];
  plugin_timings_ms?: Record<string, number>;
}

export interface PluginBuildRecord {
  plugin_id: string;
  artifact_revision: Revision;
  source_revision: Revision;
  resolved_source_hash: Revision;
  template_payload_hash?: Revision;
  implementation: PluginImplementationPin;
  asset_manifest: {
    id: string;
    revision: Revision;
    hash: Revision;
  };
  compatibility_profile: "sillytavern-regex-helper@1";
  compatibility_profile_revision: Revision;
  contribution_revision: Revision;
}

export interface RoundTripDifference {
  path: string;
  classification: "expected_loss" | "unexpected_loss";
  reason: string;
}

export interface RoundTripReport {
  schema_version: 1;
  status: "equivalent" | "expected_loss" | "unexpected_loss";
  differences: RoundTripDifference[];
}
