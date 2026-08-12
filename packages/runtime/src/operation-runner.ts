import { assertExecutionLeaseForOperation } from "@st-workspace/domain";
import { computeProjectProjection, type ArtifactRecord, type ExecutionContext, type OperationRecord, type ProjectState, type RequestResult } from "@st-workspace/core";

function now(): string {
  return new Date().toISOString();
}

type BuildModeSelection = "zhuji" | "palette" | "both";

const OPERATION_LEASE_MS = 60_000;

/** Assert fencing inside a repository transaction before returning its state patch. */
function executionLeaseGuard(current: ProjectState, operationId: string, execution: ExecutionContext): Record<string, never> {
  assertExecutionLeaseForOperation(current.operations.find((item) => item.id === operationId), execution);
  return {};
}

/** Remove lease fields from a record so they are absent (not `undefined`) in persisted state. */
function stripLease<TOperation extends { lease_owner?: string; lease_token?: string; lease_expires_at?: string }>(
  operation: TOperation,
): Omit<TOperation, "lease_owner" | "lease_token" | "lease_expires_at"> {
  const { lease_owner: _owner, lease_token: _token, lease_expires_at: _expires, ...rest } = operation;
  return rest;
}

function parseBuildModeSelection(value: string): BuildModeSelection | undefined {
  const normalized = value.trim().toLocaleLowerCase();
  if (/(?:both|兩者|兩個都有|兩種|珠璣[、,\s]+調色盤|調色盤[、,\s]+珠璣)/iu.test(normalized)) return "both";
  if (/(?:zhuji|珠璣|珠玑|珠机)/iu.test(normalized) && !/(?:palette|調色盤|调色盘)/iu.test(normalized)) return "zhuji";
  if (/(?:palette|調色盤|调色盘)/iu.test(normalized) && !/(?:zhuji|珠璣|珠玑|珠机)/iu.test(normalized)) return "palette";
  return undefined;
}

function hasUsableArtifact(_artifact: ProjectState["artifacts"][number]): boolean {
  // v3 currently models artifact liveness through revision replacement rather
  // than stale/missing statuses; keep this boundary for future status growth.
  return true;
}

/** Current projection: the latest revision per artifact key, mirroring domain/gate semantics. */
function latestByKey(state: ProjectState): ArtifactRecord[] {
  return [...computeProjectProjection(state).currentArtifacts];
}

/** Roster ids from the current usable Blueprint artifact; undefined when no Blueprint is bound. */
function blueprintRosterIds(state: ProjectState): Set<string> | undefined {
  const roster = computeProjectProjection(state).roster;
  return roster.length > 0 ? new Set(roster.map((character) => character.id)) : undefined;
}

function parsedModeModules(state: ProjectState, kind: "zhuji" | "palette", characterId: string): Set<string> {
  const modules = new Set<string>();
  for (const artifact of latestByKey(state)) {
    if (artifact.kind !== kind || !hasUsableArtifact(artifact)) continue;
    try {
      const value = JSON.parse(artifact.content) as { character_id?: unknown; module?: { module?: unknown } };
      if (value.character_id === characterId && typeof value.module?.module === "string") modules.add(value.module.module);
    } catch {
      // Malformed historical artifacts are ignored here and reported by normal review/gate diagnostics.
    }
  }
  return modules;
}

/** Actual buildable modes derived from current module artifacts, mirroring compiler availableCardModes. */
function availableCardModesRuntime(state: ProjectState): { zhuji: boolean; palette: boolean } {
  const current = latestByKey(state);
  const hasModeModule = (kind: "zhuji" | "palette"): boolean => {
    return current.some((artifact) => {
      if (artifact.kind !== kind) return false;
      try {
        const value = JSON.parse(artifact.content) as { character_id?: unknown; module?: { module?: unknown } };
        return typeof value.character_id === "string" && typeof value.module?.module === "string";
      } catch {
        return false;
      }
    });
  };
  return { zhuji: hasModeModule("zhuji"), palette: hasModeModule("palette") };
}

function responseFromOperation(operation: OperationRecord): RequestResult {
  const completed = operation.progress.filter((item) => item.status === "completed").map((item) => item.item_id);
  const blocked = operation.progress.filter((item) => item.status !== "completed").map((item) => item.item_id);
  return {
    operation_id: operation.id,
    status: operation.status,
    summary: operation.result_summary ?? "操作正在處理中。",
    completed,
    blocked,
    ...(operation.question === undefined ? {} : { question: operation.question }),
    ...(operation.execution_snapshot?.execution_agent_id === undefined ? {} : { agent_id: operation.execution_snapshot.execution_agent_id }),
    ...(operation.execution_snapshot?.execution_agent_role === undefined ? {} : { agent_role: operation.execution_snapshot.execution_agent_role }),
  };
}

export {
  now,
  OPERATION_LEASE_MS,
  executionLeaseGuard,
  stripLease,
  parseBuildModeSelection,
  hasUsableArtifact,
  latestByKey,
  blueprintRosterIds,
  parsedModeModules,
  availableCardModesRuntime,
  responseFromOperation,
  type BuildModeSelection,
};
