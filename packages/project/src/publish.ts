import { readFile } from "node:fs/promises";
import path from "node:path";

import type { Revision } from "@card-workspace/schemas";

import { computeTextRevision } from "./canonical.js";
import { ProjectError } from "./errors.js";
import { assertSafeSegment } from "./path-security.js";
import { resolveWithin } from "./path-security.js";
import {
  runFileTransaction,
  type TransactionExpectation,
  type TransactionOperation,
  type TransactionResult,
} from "./transaction.js";

const buildFileNames = new Set([
  "ir.json",
  "plan.json",
  "token-report.json",
  "trigger-report.json",
  "audit.json",
  "audit.md",
  "provenance-index.json",
  "plugin-build-trace.json",
  "manifest.json",
]);

export interface ForgePublishArtifact {
  fileName: string;
  content: string | Buffer;
}

export interface ForgePublishOptions {
  workspaceRoot: string;
  projectId: string;
  buildFiles: ForgePublishArtifact[];
  exportFiles: ForgePublishArtifact[];
  sourceRevisions: Record<string, Revision>;
  beforePublish?: (index: number, operation: TransactionOperation) => void | Promise<void>;
}

export interface PublishPlan {
  operations: TransactionOperation[];
  expectations: TransactionExpectation[];
}

function validateBuildFileName(fileName: string): string {
  if (!buildFileNames.has(fileName)) {
    throw new ProjectError("PUBLISH_PATH_DENIED", `不允許的 build artifact：${fileName}`);
  }
  return fileName;
}

function validateExportFileName(fileName: string): string {
  if (path.basename(fileName) !== fileName || !/^[a-z0-9][a-z0-9._-]*\.(?:json|png|md)$/u.test(fileName)) {
    throw new ProjectError("PUBLISH_PATH_DENIED", `不允許的 export artifact：${fileName}`);
  }
  return fileName;
}

async function readExisting(filePath: string): Promise<Buffer | undefined> {
  try {
    return await readFile(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function archiveFileName(fileName: string, revision: Revision): string {
  const extension = path.extname(fileName);
  const stem = fileName.slice(0, -extension.length);
  const digest = revision.slice("sha256:".length);
  return `${stem}.${digest}${extension}`;
}

export async function prepareForgePublishPlan(options: Omit<ForgePublishOptions, "beforePublish">): Promise<PublishPlan> {
  const projectId = assertSafeSegment(options.projectId);
  const sourcePrefix = `projects/${projectId}/`;
  const expectations: TransactionExpectation[] = Object.entries(options.sourceRevisions).map(
    ([relativePath, expectedRawRevision]) => {
      const normalized = relativePath.replaceAll("\\", "/");
      if (!normalized.startsWith(sourcePrefix) || normalized.includes("/.build/")) {
        throw new ProjectError("PUBLISH_SOURCE_DENIED", `不允許的來源 revision 路徑：${relativePath}`);
      }
      return { relativePath: normalized, expectedRawRevision };
    },
  );
  const exportOperations = [];
  for (const artifact of options.exportFiles) {
    const fileName = validateExportFileName(artifact.fileName);
    const relativePath = `exports/${projectId}/${fileName}`;
    const current = await readExisting(await resolveWithin(options.workspaceRoot, relativePath));
    if (current) {
      const expectedRawRevision = computeTextRevision(current);
      const nextRawRevision = computeTextRevision(artifact.content);
      if (expectedRawRevision !== nextRawRevision) {
        const archivePath = `exports/${projectId}/old/${archiveFileName(fileName, expectedRawRevision)}`;
        const archived = await readExisting(await resolveWithin(options.workspaceRoot, archivePath));
        if (archived === undefined) {
          exportOperations.push({ relativePath: archivePath, content: current, expectedAbsent: true });
        } else if (!archived.equals(current)) {
          throw new ProjectError("PUBLISH_ARCHIVE_CONFLICT", `既有 archive 內容不符：${archivePath}`);
        }
      }
      exportOperations.push({ relativePath, content: artifact.content, expectedRawRevision });
    } else {
      exportOperations.push({ relativePath, content: artifact.content, expectedAbsent: true });
    }
  }
  const operations = [
    ...options.buildFiles.map((artifact) => ({
      relativePath: `${sourcePrefix}.build/${validateBuildFileName(artifact.fileName)}`,
      content: artifact.content,
    })),
    ...exportOperations,
  ];
  return { operations, expectations };
}

export async function publishForgeArtifacts(options: ForgePublishOptions): Promise<TransactionResult> {
  const plan = await prepareForgePublishPlan(options);
  return runFileTransaction({
    root: options.workspaceRoot,
    ...plan,
    ...(options.beforePublish ? { beforePublish: options.beforePublish } : {}),
  });
}
