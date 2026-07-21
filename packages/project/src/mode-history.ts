import { readdir, readFile } from "node:fs/promises";

import { canonicalJson, computeTextRevision } from "./canonical.js";
import type { Revision } from "@card-workspace/schemas";
import { ProjectError } from "./errors.js";
import { assertModeHistoryPath } from "./ownership.js";
import { resolveExistingWithin } from "./path-security.js";
import type { TransactionOperation } from "./transaction.js";

export interface ModeHistoryFile {
  relativePath: string;
  revision: Revision;
}

export interface ModeHistoryReport {
  schema_version: 1;
  conversion_id: string;
  character_id: string;
  source_mode: "zhuji" | "palette";
  target_mode: "zhuji" | "palette";
  source_revisions: Record<string, Revision>;
  target_revisions: Record<string, Revision>;
  mappings: Array<{ source: string; target: string; summary: string }>;
  provenance: string[];
  expected_semantic_loss: string[];
}

export async function prepareModeHistoryArchive(options: {
  projectRoot: string;
  characterId: string;
  conversionId: string;
  sourceMode: "zhuji" | "palette";
  report: ModeHistoryReport;
}): Promise<{ operations: TransactionOperation[]; files: ModeHistoryFile[] }> {
  const sourceRoot = `characters/${options.characterId}/${options.sourceMode}`;
  const sourcePath = await resolveExistingWithin(options.projectRoot, sourceRoot);
  const names = (await readdir(sourcePath, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".yaml"))
    .map((entry) => entry.name)
    .sort();
  if (names.length === 0) throw new ProjectError("MODE_HISTORY_SOURCE_EMPTY", `來源模式沒有可封存模組：${sourceRoot}`);
  const operations: TransactionOperation[] = [];
  const files: ModeHistoryFile[] = [];
  for (const name of names) {
    const content = await readFile(await resolveExistingWithin(options.projectRoot, `${sourceRoot}/${name}`));
    const relativePath = assertModeHistoryPath(
      `characters/${options.characterId}/mode-history/${options.conversionId}/${options.sourceMode}/${name}`,
    );
    operations.push({ relativePath, content, expectedAbsent: true });
    files.push({ relativePath, revision: computeTextRevision(content) });
  }
  const reportPath = assertModeHistoryPath(
    `characters/${options.characterId}/mode-history/${options.conversionId}/${options.sourceMode}/mapping-report.json`,
  );
  const reportContent = canonicalJson(options.report);
  operations.push({ relativePath: reportPath, content: reportContent, expectedAbsent: true });
  files.push({ relativePath: reportPath, revision: computeTextRevision(reportContent) });
  return { operations, files };
}
