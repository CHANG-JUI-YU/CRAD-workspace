import { CoreError } from "@st-workspace/core";
import type { WorkspaceRuntime } from "@st-workspace/runtime";

export type PublishReadinessMode = Parameters<WorkspaceRuntime["publishPreview"]>[0];

export interface PublishReadinessSnapshot {
  project_revision: number;
  publish: Awaited<ReturnType<WorkspaceRuntime["publishPreview"]>>;
  build: Awaited<ReturnType<WorkspaceRuntime["buildReadiness"]>>;
  diagnostics: Awaited<ReturnType<WorkspaceRuntime["dashboardPublishDiagnostics"]>>;
}

export function parsePublishReadinessMode(value: string | null): PublishReadinessMode {
  if (value === null || value === "") return undefined;
  if (value === "zhuji" || value === "palette" || value === "both") return value;
  throw new CoreError("BUILD_MODE_INVALID", `Unsupported build mode: ${value}`, true);
}

export async function publishReadinessSnapshot(
  runtime: WorkspaceRuntime,
  mode?: PublishReadinessMode,
): Promise<PublishReadinessSnapshot> {
  const observed: Array<{ before: number; after: number }> = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const before = (await runtime.dashboardSummary()).project.revision;
    const publish = await runtime.publishPreview(mode);
    const build = await runtime.buildReadiness();
    const diagnostics = await runtime.dashboardPublishDiagnostics();
    const after = (await runtime.dashboardSummary()).project.revision;
    observed.push({ before, after });
    if (before === after) {
      return {
        project_revision: after,
        publish,
        build,
        diagnostics,
      };
    }
  }
  throw new CoreError(
    "PUBLISH_READINESS_SNAPSHOT_STALE",
    "Project state changed while publish readiness was being evaluated. Reload the latest project state and run readiness again.",
    true,
    { observed_revisions: observed },
  );
}
