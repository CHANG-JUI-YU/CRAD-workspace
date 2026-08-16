import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { resolve } from "node:path";
import { CliUsageError } from "./parser.js";

export interface RepairExportPlan {
  inputJsonPath: string;
  outputJsonPath: string;
  outputPngPath: string;
  inPlace: boolean;
}

export interface RepairExportFs {
  copyFile(source: string, destination: string, flags: number): Promise<void>;
  writeFile(path: string, data: string | Uint8Array): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  unlink(path: string): Promise<void>;
  stat(path: string): Promise<unknown>;
}

export interface CompiledRepairExport {
  json: string;
  png: Uint8Array;
  content_hash: string;
}

export interface RepairExportResult {
  json_path: string;
  png_path: string;
  backup_path?: string;
  content_hash: string;
}

interface StagedTarget {
  final: string;
  temp: string;
  protect?: string;
}

function comparisonPath(path: string): string {
  const resolved = resolve(path);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function hasJsonExtension(path: string): boolean {
  const lastSegment = path.split(/[\\/]/u).at(-1) ?? path;
  return /\.json$/iu.test(lastSegment);
}

function derivePngPath(jsonPath: string): string {
  return `${jsonPath.slice(0, -5)}.png`;
}

export function planRepairExport(inputPath: string, outputPath?: string): RepairExportPlan {
  const inputJsonPath = resolve(inputPath);
  const outputJsonPath = outputPath === undefined ? inputJsonPath : resolve(outputPath);
  if (!hasJsonExtension(outputJsonPath)) {
    throw new CliUsageError(
      `repair-export output path must end in ".json" (case-insensitive) so a separate PNG path can be derived; got "${outputJsonPath}". Rename the output, e.g. to "${outputJsonPath}.json", or drop the output argument to repair in place.`,
    );
  }
  const outputPngPath = derivePngPath(outputJsonPath);
  const jsonKey = comparisonPath(outputJsonPath);
  const pngKey = comparisonPath(outputPngPath);
  if (jsonKey === pngKey) {
    throw new CliUsageError(
      `repair-export JSON and PNG outputs resolve to the same path "${outputJsonPath}"; refusing to overwrite one with the other.`,
    );
  }
  return { inputJsonPath, outputJsonPath, outputPngPath, inPlace: comparisonPath(inputJsonPath) === jsonKey };
}

export async function createExclusiveBackup(fs: RepairExportFs, inputPath: string): Promise<string> {
  let backupPath = `${inputPath}.bundle-backup.json`;
  let suffix = 2;
  for (;;) {
    try {
      await fs.copyFile(inputPath, backupPath, constants.COPYFILE_EXCL);
      return backupPath;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      backupPath = `${inputPath}.bundle-backup-${suffix}.json`;
      suffix += 1;
    }
  }
}

function stagedTempPath(finalPath: string): string {
  return `${finalPath}.staged-${randomUUID()}`;
}

async function exists(fs: RepairExportFs, path: string): Promise<boolean> {
  try {
    await fs.stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function cleanupQuietly(fs: RepairExportFs, paths: readonly string[]): Promise<void> {
  for (const path of paths) {
    try {
      await fs.unlink(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

async function rollbackProtects(fs: RepairExportFs, targets: readonly StagedTarget[]): Promise<void> {
  for (const target of targets) {
    if (target.protect !== undefined) await fs.rename(target.protect, target.final);
  }
}

async function rollbackCommits(fs: RepairExportFs, targets: readonly StagedTarget[], committed: number): Promise<void> {
  for (let i = 0; i < targets.length; i++) {
    const target = targets[i]!;
    if (target.protect === undefined) {
      if (i < committed) await cleanupQuietly(fs, [target.final]);
    } else if (i < committed) {
      await cleanupQuietly(fs, [target.final]);
      await fs.rename(target.protect, target.final);
    } else {
      await fs.rename(target.protect, target.final);
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function runRepairExport(fs: RepairExportFs, plan: RepairExportPlan, compiled: CompiledRepairExport): Promise<RepairExportResult> {
  const backupPath = plan.inPlace ? await createExclusiveBackup(fs, plan.inputJsonPath) : undefined;
  const targets: StagedTarget[] = [
    { final: plan.outputJsonPath, temp: stagedTempPath(plan.outputJsonPath) },
    { final: plan.outputPngPath, temp: stagedTempPath(plan.outputPngPath) },
  ];
  try {
    await fs.writeFile(targets[0]!.temp, `${compiled.json}\n`);
    await fs.writeFile(targets[1]!.temp, compiled.png);
  } catch (error) {
    await cleanupQuietly(fs, targets.map((target) => target.temp));
    throw error;
  }
  try {
    for (const target of targets) {
      if (await exists(fs, target.final)) {
        const protectPath = `${target.final}.staged-protect-${randomUUID()}`;
        await fs.rename(target.final, protectPath);
        target.protect = protectPath;
      }
    }
  } catch (error) {
    try {
      await rollbackProtects(fs, targets);
    } catch (rollbackError) {
      throw new Error(`Repair rollback failed: ${errorMessage(rollbackError)} (original failure: ${errorMessage(error)})`);
    }
    await cleanupQuietly(fs, targets.map((target) => target.temp));
    throw error;
  }
  let committed = 0;
  try {
    for (const target of targets) {
      await fs.rename(target.temp, target.final);
      committed += 1;
    }
  } catch (error) {
    try {
      await rollbackCommits(fs, targets, committed);
    } catch (rollbackError) {
      throw new Error(`Repair rollback failed: ${errorMessage(rollbackError)} (original failure: ${errorMessage(error)})`);
    }
    await cleanupQuietly(fs, targets.map((target) => target.temp));
    throw error;
  }
  for (const target of targets) {
    if (target.protect !== undefined) await fs.unlink(target.protect);
  }
  return {
    json_path: plan.outputJsonPath,
    png_path: plan.outputPngPath,
    ...(backupPath === undefined ? {} : { backup_path: backupPath }),
    content_hash: compiled.content_hash,
  };
}
