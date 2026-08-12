import { createHash, randomUUID } from "node:crypto";
import type { InterviewFlow, InterviewState } from "./interview.js";
import type { ArtifactKind } from "./project-state.js";
import type { OperationRecord } from "./operations.js";

export interface SourceAttachment {
  name: string;
  content: Uint8Array;
  media_type?: string;
}

export interface WorkspaceContext {
  actor: string;
  attachments: SourceAttachment[];
  research_results?: Array<{ title: string; url: string; snippet?: string; content?: string; media_type?: string; domain?: string; official?: boolean }>;
}

export interface ExecutionContextTarget {
  artifactId: string;
  artifactKind?: ArtifactKind;
}

export interface ExecutionLeaseContext {
  owner: string;
  token: string;
  generation?: number;
}

export interface ExecutionContext {
  operationId: string;
  executionAgent: { id: string; role: string };
  initiatedBy: string;
  auditActor: string;
  target?: ExecutionContextTarget;
  lease?: ExecutionLeaseContext;
  capabilities: readonly string[];
}

export interface ExecutionContextInput {
  auditActor: string;
  executionAgent?: ExecutionContext["executionAgent"];
  initiatedBy?: string;
  target?: ExecutionContextTarget;
  lease?: ExecutionLeaseContext;
  capabilities?: readonly string[];
}

/**
 * Build an execution context at an operation boundary. A persisted snapshot
 * is authoritative for identity, target, capabilities, and initiation data;
 * caller-provided values are only used when the snapshot has no value.
 */
export function executionContextFromOperation(operation: OperationRecord, input: ExecutionContextInput): ExecutionContext {
  const snapshot = operation.execution_snapshot;
  const executionAgent = snapshot?.execution_agent_id !== undefined && snapshot.execution_agent_id.trim().length > 0
    ? { id: snapshot.execution_agent_id.trim(), role: snapshot.execution_agent_role ?? input.executionAgent?.role ?? "specialist" }
    : input.executionAgent ?? { id: operation.actor ?? input.auditActor, role: "specialist" };
  const target = snapshot?.target_artifact_id === undefined
    ? input.target
    : {
      artifactId: snapshot.target_artifact_id,
      ...(snapshot.target_artifact_kind === undefined ? {} : { artifactKind: snapshot.target_artifact_kind as ArtifactKind }),
    };
  const capabilities = snapshot?.capabilities ?? input.capabilities ?? [];
  return {
    operationId: operation.id,
    executionAgent,
    initiatedBy: snapshot?.initiated_by ?? input.initiatedBy ?? operation.actor ?? input.auditActor,
    auditActor: input.auditActor,
    ...(target === undefined ? {} : { target }),
    ...(input.lease === undefined ? {} : { lease: input.lease }),
    capabilities: [...capabilities],
  };
}

export interface RequestResult {
  operation_id?: string;
  status: import("./project-state.js").OperationStatus | "completed";
  summary: string;
  completed: string[];
  blocked: string[];
  question?: string;
  agent_id?: string;
  agent_role?: string;
  project_id?: string;
  project_name?: string;
  project_path?: string;
  interview_question?: InterviewState["current"];
  flow?: InterviewFlow;
}

export class CoreError extends Error {
  readonly code: string;
  readonly recoverable: boolean;
  readonly details?: unknown;

  constructor(code: string, message: string, recoverable = false, details?: unknown) {
    super(message);
    this.name = "CoreError";
    this.code = code;
    this.recoverable = recoverable;
    this.details = details;
  }
}

export function internalId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonicalize(item)]));
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function contentHash(content: Uint8Array | string): string {
  return createHash("sha256").update(content).digest("hex");
}
