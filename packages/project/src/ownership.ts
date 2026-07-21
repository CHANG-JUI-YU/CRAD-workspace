import type { Operation } from "fast-json-patch";

import { ProjectError } from "./errors.js";

const policyPattern = /^policies\/[a-z0-9._-]+\.(?:json|ya?ml)$/u;
const characterPattern = /^characters\/[a-z0-9]+(?:[._-][a-z0-9]+)*\/character\.yaml$/u;
const modulePattern = /^characters\/[a-z0-9]+(?:[._-][a-z0-9]+)*\/(?:zhuji|palette)\/[a-z0-9-]+\.yaml$/u;
const worldPattern = /^world\/(?:people|geography|organizations|history|concepts|systems|items|events)(?:\/[a-z0-9._-]+)+\.ya?ml$/u;
const modeHistoryPattern = /^characters\/[a-z0-9]+(?:[._-][a-z0-9]+)*\/mode-history\/[a-z0-9]+(?:[._-][a-z0-9]+)*\/(?:zhuji|palette)\/(?:[a-z0-9-]+\.yaml|mapping-report\.json)$/u;
const safeSegment = "[a-z0-9]+(?:[._-][a-z0-9]+)*";

const ingestionPathPatterns = [
  ["source_projection", /^sources\/manifest\.yaml$/u],
  ["fact_projection", /^facts\/(?:register|conflicts)\.yaml$/u],
  ["snapshot", new RegExp(`^sources/snapshots/${safeSegment}/${safeSegment}\\.[a-z0-9]+$`, "u")],
  ["source_revision", new RegExp(`^sources/revisions/${safeSegment}/${safeSegment}\\.json$`, "u")],
  ["text_projection", new RegExp(`^sources/projections/${safeSegment}/${safeSegment}\\.json$`, "u")],
  ["chunk_set", new RegExp(`^sources/chunks/${safeSegment}/${safeSegment}/${safeSegment}/manifest\\.json$`, "u")],
  ["chunk", new RegExp(`^sources/chunks/${safeSegment}/${safeSegment}/${safeSegment}/${safeSegment}\\.json$`, "u")],
  ["candidate_batch", new RegExp(`^facts/candidates/${safeSegment}\\.json$`, "u")],
  ["job", new RegExp(`^sources/jobs/${safeSegment}\\.json$`, "u")],
  ["source_journal", /^sources\/journals\/source-events\.jsonl$/u],
  ["research_batch", new RegExp(`^sources/research/${safeSegment}/(?:${safeSegment}|current)\\.json$`, "u")],
  ["decision_journal", /^facts\/decisions\.jsonl$/u],
] as const;

export type IngestionPathKind = (typeof ingestionPathPatterns)[number][0];

export interface IngestionProjectPath {
  relativePath: string;
  kind: IngestionPathKind;
}

export function classifyIngestionProjectPath(relativePath: string): IngestionProjectPath | undefined {
  const normalized = relativePath.replaceAll("\\", "/");
  const match = ingestionPathPatterns.find(([, pattern]) => pattern.test(normalized));
  return match ? { relativePath: normalized, kind: match[0] } : undefined;
}

export function assertIngestionProjectPath(relativePath: string): IngestionProjectPath {
  const classified = classifyIngestionProjectPath(relativePath);
  if (!classified) {
    throw new ProjectError(
      "INGESTION_TARGET_DENIED",
      `ingestion 僅允許存取受控 Sources/Facts 路徑：${relativePath}`,
    );
  }
  return classified;
}

export function assertFoundationDocumentPath(relativePath: string): string {
  const normalized = relativePath.replaceAll("\\", "/");
  if (
    !["project.yaml", "workflow.json", "blueprint.yaml", "greetings.yaml"].includes(normalized) &&
    !policyPattern.test(normalized) &&
    !characterPattern.test(normalized) &&
    !modulePattern.test(normalized) &&
    !worldPattern.test(normalized)
  ) {
    throw new ProjectError(
      "DOCUMENT_TARGET_DENIED",
      `僅允許存取已知作者文件：${relativePath}`,
    );
  }
  return normalized;
}

export function assertModeHistoryPath(relativePath: string): string {
  const normalized = relativePath.replaceAll("\\", "/");
  if (!modeHistoryPattern.test(normalized)) {
    throw new ProjectError("MODE_HISTORY_TARGET_DENIED", `不允許的 mode-history 路徑：${relativePath}`);
  }
  return normalized;
}

export function assertPatchOwnership(relativePath: string, operations: readonly Operation[]): void {
  const immutable =
    relativePath === "project.yaml"
      ? ["/schema_version", "/id", "/kind"]
      : relativePath === "workflow.json"
        ? ["/schema_version", "/project_id", "/revision"]
        : relativePath === "blueprint.yaml"
          ? ["/schema_version", "/project_id"]
        : relativePath === "greetings.yaml"
          ? ["/schema_version"]
          : relativePath.endsWith("/character.yaml")
            ? ["/schema_version", "/id"]
            : relativePath.includes("/zhuji/") || relativePath.includes("/palette/")
              ? ["/schema_version", "/mode", "/module"]
              : relativePath.startsWith("world/")
                ? ["/schema_version", "/id", "/category"]
                : ["/schema_version", "/id"];
  for (const operation of operations) {
    if (immutable.some((prefix) => operation.path === prefix || operation.path.startsWith(`${prefix}/`))) {
      throw new ProjectError("PATCH_PATH_DENIED", `不可修改受保護欄位：${operation.path}`);
    }
  }
}
