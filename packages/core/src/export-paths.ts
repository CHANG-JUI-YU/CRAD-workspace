import type { ArtifactRecord } from "./project-state.js";
import { safeSegment } from "./repository/materialization.js";

export type CardExportMode = "zhuji" | "palette" | "both";

function exportNameSuffix(artifacts: readonly Pick<ArtifactRecord, "kind">[], mode: CardExportMode | undefined): string {
  if (mode !== undefined) {
    if (mode === "zhuji") return "珠璣角色卡";
    if (mode === "palette") return "調色盤角色卡";
    return "雙模式角色卡";
  }
  return artifacts.some((artifact) => artifact.kind === "zhuji") ? "珠璣角色卡" : "角色卡";
}

export function publishedCardExportPath(projectName: string | undefined, projectId: string, artifacts: readonly Pick<ArtifactRecord, "kind">[], mode?: CardExportMode): string {
  const stem = safeSegment(projectName ?? projectId);
  return `exports/${stem}-${exportNameSuffix(artifacts, mode)}.json`;
}

export function publishedCardPngExportPath(projectName: string | undefined, projectId: string, artifacts: readonly Pick<ArtifactRecord, "kind">[], mode?: CardExportMode): string {
  const stem = safeSegment(projectName ?? projectId);
  return `exports/${stem}-${exportNameSuffix(artifacts, mode)}.png`;
}
