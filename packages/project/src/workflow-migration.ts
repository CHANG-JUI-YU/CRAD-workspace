import { lstat, readFile } from "node:fs/promises";
import path from "node:path";

import {
  blueprintSchema,
  migrateWorkflowV1ToV2,
  projectManifestSchema,
  workflowStateV1Schema,
  workflowStateSchema,
  type Blueprint,
  type Revision,
} from "@card-workspace/schemas";

import { canonicalJson, canonicalYaml, computeRevision, computeTextRevision } from "./canonical.js";
import { ProjectError } from "./errors.js";
import { parseStructuredFile } from "./parser.js";
import { resolveWithin } from "./path-security.js";
import { runFileTransaction, type TransactionOperation } from "./transaction.js";
import { blueprintFile, workflowJournalFile, workflowProjectionFile } from "./workflow-layout.js";

export interface MigrateWorkflowProjectOptions {
  projectRoot: string;
  expectedRawRevision: Revision;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function assertPathHasNoLinks(projectRoot: string, relativePath: string): Promise<void> {
  let current = projectRoot;
  for (const segment of relativePath.split("/")) {
    current = path.join(current, segment);
    try {
      const metadata = await lstat(current);
      if (metadata.isSymbolicLink()) {
        throw new ProjectError(
          "PROJECT_PATH_LINK_DENIED",
          `Workflow migration 路徑不得使用 symlink 或 junction：${relativePath}`,
        );
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
  }
}

function initialBlueprint(manifest: ReturnType<typeof projectManifestSchema.parse>): Blueprint {
  return blueprintSchema.parse({
    schema_version: 1,
    project_id: manifest.id,
    entry_kind: "original",
    purpose: "[待確認專案目的]",
    characters: manifest.characters.map((character) => ({
      id: character.id,
      display_name: character.display_name,
      mode: character.mode,
      core_concept: "[待確認角色核心概念]",
    })),
    world: { enabled: false },
    greetings: { enabled: true, character_ids: manifest.characters.map((character) => character.id) },
  });
}

export async function migrateWorkflowProjectV1ToV2(options: MigrateWorkflowProjectOptions) {
  await assertPathHasNoLinks(options.projectRoot, workflowProjectionFile);
  await assertPathHasNoLinks(options.projectRoot, workflowJournalFile);
  const workflowPath = await resolveWithin(options.projectRoot, workflowProjectionFile);
  const raw = await readFile(workflowPath);
  const actualRawRevision = computeTextRevision(raw);
  if (actualRawRevision !== options.expectedRawRevision) {
    throw new ProjectError(
      "REVISION_CONFLICT",
      `workflow.json 已變更；預期 ${options.expectedRawRevision}，實際 ${actualRawRevision}`,
    );
  }

  const parsed = await parseStructuredFile(workflowPath, { displayPath: workflowProjectionFile });
  if (parsed.data === undefined) {
    throw new ProjectError("WORKFLOW_INVALID", "workflow.json 無法解析", parsed.diagnostics);
  }
  const legacy = workflowStateV1Schema.parse(parsed.data);
  const migration = migrateWorkflowV1ToV2(legacy);
  const digest = actualRawRevision.replace(/^sha256:/u, "");
  const backupPath = `.workflow/results/workflow-migration/${digest}.json`;
  const backup = {
    schema_version: 1,
    kind: "workflow-v1-backup",
    source_raw_revision: actualRawRevision,
    source_raw: raw.toString("utf8"),
    report: migration.report,
  };
  const payload = {
    from_schema_version: 1,
    to_schema_version: 2,
    source_raw_revision: actualRawRevision,
    backup: { path: backupPath, revision: computeRevision(backup) },
    report: migration.report,
  };
  const journalPath = await resolveWithin(options.projectRoot, workflowJournalFile);
  const journalExists = await exists(journalPath);
  const currentJournal = journalExists ? await readFile(journalPath, "utf8") : "";
  const sequence = currentJournal.split(/\r?\n/u).filter(Boolean).length + 1;
  const semanticEvent = { sequence, kind: "workflow_migrated", actor: "project-migration", payload };
  const event = {
    schema_version: 1,
    id: `migration-${digest.slice(0, 16)}`,
    ...semanticEvent,
    payload_hash: computeRevision(payload),
    occurred_at: new Date().toISOString(),
  };
  const journalContent = `${currentJournal}${currentJournal.length > 0 && !currentJournal.endsWith("\n") ? "\n" : ""}${JSON.stringify(event)}\n`;
  const workflow = workflowStateSchema.parse({
    ...migration.state,
    journal_revision: computeRevision(semanticEvent),
  });

  const operations: TransactionOperation[] = [
    {
      relativePath: workflowProjectionFile,
      content: canonicalJson(workflow),
      expectedRawRevision: options.expectedRawRevision,
    },
    { relativePath: backupPath, content: canonicalJson(backup), expectedAbsent: true },
    {
      relativePath: workflowJournalFile,
      content: journalContent,
      ...(journalExists
        ? { expectedRawRevision: computeTextRevision(currentJournal) }
        : { expectedAbsent: true }),
    },
  ];

  const blueprintPath = await resolveWithin(options.projectRoot, blueprintFile);
  if (!(await exists(blueprintPath))) {
    const manifestParsed = await parseStructuredFile(
      await resolveWithin(options.projectRoot, "project.yaml"),
      { displayPath: "project.yaml" },
    );
    if (manifestParsed.data === undefined) {
      throw new ProjectError("PROJECT_MANIFEST_INVALID", "project.yaml 無法解析", manifestParsed.diagnostics);
    }
    operations.push({
      relativePath: blueprintFile,
      content: canonicalYaml(initialBlueprint(projectManifestSchema.parse(manifestParsed.data))),
      expectedAbsent: true,
    });
  }

  await runFileTransaction({ root: options.projectRoot, operations });
  return { workflow, report: migration.report, backupPath, journalPath: workflowJournalFile };
}
