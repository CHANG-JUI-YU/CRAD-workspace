import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, rm, copyFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CliUsageError } from "../src/parser.js";
import { createExclusiveBackup, planRepairExport, runRepairExport, type CompiledRepairExport, type RepairExportFs } from "../src/repair-export.js";

const realFs: RepairExportFs = { copyFile, writeFile, rename, unlink, stat };

function eio(message: string): NodeJS.ErrnoException {
  const error = new Error(message) as NodeJS.ErrnoException;
  error.code = "EIO";
  return error;
}

function enoent(message: string): NodeJS.ErrnoException {
  const error = new Error(message) as NodeJS.ErrnoException;
  error.code = "ENOENT";
  return error;
}

function compiled(): CompiledRepairExport {
  return { json: JSON.stringify({ card: "測試" }), png: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]), content_hash: "hash-abc" };
}

async function writeText(path: string, content: string): Promise<void> {
  await writeFile(path, content, "utf8");
}

async function readText(path: string): Promise<string> {
  return readFile(path, "utf8");
}

function stagedResiduals(directory: string): Promise<string[]> {
  return readdir(directory).then((names) => names.filter((name) => name.includes(".staged-")));
}

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "repair-export-"));
}

describe("planRepairExport", () => {
  it("plans a normal .json explicit output", () => {
    const plan = planRepairExport("in.json", "out/card.json");
    expect(plan.inputJsonPath.replaceAll("\\", "/")).toMatch(/in\.json$/u);
    expect(plan.outputJsonPath.replaceAll("\\", "/")).toMatch(/out\/card\.json$/u);
    expect(plan.outputPngPath.replaceAll("\\", "/")).toMatch(/out\/card\.png$/u);
    expect(plan.inPlace).toBe(false);
  });

  it("handles uppercase .JSON by deriving an independent .png path", () => {
    const plan = planRepairExport("card.JSON");
    expect(plan.inPlace).toBe(true);
    expect(plan.outputJsonPath.endsWith("card.JSON")).toBe(true);
    expect(plan.outputPngPath.endsWith("card.png")).toBe(true);
  });

  it("rejects an output path without an extension", () => {
    expect(() => planRepairExport("bundle.json", "card.bundle")).toThrowError(CliUsageError);
    try {
      planRepairExport("bundle.json", "card.bundle");
    } catch (error) {
      expect((error as Error).message).toContain('.json"');
    }
  });

  it("rejects output paths with a wrong extension", () => {
    expect(() => planRepairExport("bundle.json", "card.txt")).toThrowError(CliUsageError);
    expect(() => planRepairExport("bundle.json", "card.png")).toThrowError(CliUsageError);
    expect(() => planRepairExport("bundle.json", "card.json.backup")).toThrowError(CliUsageError);
  });

  it("does not mistake a dotted directory for a file extension", () => {
    const plan = planRepairExport("in.json", "a.b/card.json");
    expect(plan.outputJsonPath.replaceAll("\\", "/")).toMatch(/a\.b\/card\.json$/u);
    expect(plan.outputPngPath.replaceAll("\\", "/")).toMatch(/a\.b\/card\.png$/u);
    expect(() => planRepairExport("in.json", "a.b/card")).toThrowError(CliUsageError);
  });

  it("plans in-place repair when no output path is given", () => {
    const plan = planRepairExport("in.json");
    expect(plan.inPlace).toBe(true);
    expect(plan.outputJsonPath).toBe(plan.inputJsonPath);
  });

  it("never mutates the input in explicit output mode", () => {
    const plan = planRepairExport("in.json", "out.json");
    expect(plan.inPlace).toBe(false);
    expect(plan.inputJsonPath).not.toBe(plan.outputJsonPath);
  });

  it("rejects an in-place path that cannot derive a JSON/PNG pair", () => {
    expect(() => planRepairExport("card.bundle")).toThrowError(CliUsageError);
  });

  it("ensures the JSON/PNG pair never aliases", () => {
    for (const name of ["a.json", "A.JSON", "x.y.json", "dir/a.json"]) {
      const plan = planRepairExport(name, name);
      expect(plan.outputJsonPath.toLowerCase()).not.toBe(plan.outputPngPath.toLowerCase());
    }
  });

  it.skipIf(process.platform !== "win32")("compares paths case-insensitively on Windows", () => {
    const plan = planRepairExport("in.JSON", "IN.json");
    expect(plan.inPlace).toBe(true);
    expect(plan.outputPngPath.toLowerCase()).toMatch(/in\.png$/u);
  });
});

describe("createExclusiveBackup", () => {
  it("creates a backup and increments the suffix on collisions without overwriting", async () => {
    const directory = await tempDir();
    const input = join(directory, "in.json");
    await writeText(input, "original");
    const first = await createExclusiveBackup(realFs, input);
    expect(first).toBe(`${input}.bundle-backup.json`);
    await writeText(`${input}.bundle-backup.json`, "existing-backup");
    const second = await createExclusiveBackup(realFs, input);
    expect(second).toBe(`${input}.bundle-backup-2.json`);
    expect(await readText(`${input}.bundle-backup.json`)).toBe("existing-backup");
    expect(await readText(second)).toBe("original");
    await rm(directory, { recursive: true, force: true });
  });
});

describe("runRepairExport", () => {
  it("writes both outputs to a fresh explicit directory", async () => {
    const directory = await tempDir();
    const input = join(directory, "in.json");
    await writeText(input, JSON.stringify({ original: true }));
    const output = join(directory, "out.json");
    const result = await runRepairExport(realFs, planRepairExport(input, output), compiled());
    expect(result.json_path).toBe(output);
    expect(result.png_path).toMatch(/[\\/]out\.png$/u);
    expect(result.backup_path).toBeUndefined();
    expect(result.content_hash).toBe("hash-abc");
    expect(await readText(output)).toBe(`${JSON.stringify({ card: "測試" })}\n`);
    const png = await readFile(`${directory}\\out.png`);
    expect([...png]).toEqual([...compiled().png]);
    expect(await readText(input)).toBe(JSON.stringify({ original: true }));
    expect(await stagedResiduals(directory)).toEqual([]);
    await rm(directory, { recursive: true, force: true });
  });

  it("repairs in place with an exclusive backup", async () => {
    const directory = await tempDir();
    const input = join(directory, "in.json");
    const original = JSON.stringify({ original: true });
    await writeText(input, original);
    const result = await runRepairExport(realFs, planRepairExport(input), compiled());
    expect(result.backup_path).toBe(`${input}.bundle-backup.json`);
    expect(await readText(result.backup_path)).toBe(original);
    expect(await readText(input)).toBe(`${JSON.stringify({ card: "測試" })}\n`);
    expect(await readFile(`${directory}\\in.png`)).toBeDefined();
    expect(await stagedResiduals(directory)).toEqual([]);
    await rm(directory, { recursive: true, force: true });
  });

  it("supports in-place repair with an uppercase .JSON extension", async () => {
    const directory = await tempDir();
    const input = join(directory, "IN.JSON");
    await writeText(input, "{}");
    await runRepairExport(realFs, planRepairExport(input), compiled());
    expect(await readText(join(directory, "IN.png"))).toBeDefined();
    expect(await readText(`${input}.bundle-backup.json`)).toBe("{}");
    expect(await stagedResiduals(directory)).toEqual([]);
    await rm(directory, { recursive: true, force: true });
  });

  it("keeps an existing backup untouched and picks the next suffix", async () => {
    const directory = await tempDir();
    const input = join(directory, "in.json");
    await writeText(input, "original");
    await writeText(`${input}.bundle-backup.json`, "existing");
    await runRepairExport(realFs, planRepairExport(input), compiled());
    expect(await readText(`${input}.bundle-backup.json`)).toBe("existing");
    expect(await readText(`${input}.bundle-backup-2.json`)).toBe("original");
    await rm(directory, { recursive: true, force: true });
  });

  it("replaces existing outputs on success and leaves no staged or protect files", async () => {
    const directory = await tempDir();
    const output = join(directory, "out.json");
    await writeText(output, "old-json");
    await writeText(join(directory, "out.png"), "old-png");
    await runRepairExport(realFs, planRepairExport("in.json", output), compiled());
    expect(await readText(output)).toBe(`${JSON.stringify({ card: "測試" })}\n`);
    const png = await readFile(join(directory, "out.png"));
    expect([...png]).toEqual([...compiled().png]);
    expect(await stagedResiduals(directory)).toEqual([]);
    await rm(directory, { recursive: true, force: true });
  });

  it("fails cleanly when the JSON temporary write fails, leaving the original intact", async () => {
    const directory = await tempDir();
    const input = join(directory, "in.json");
    const original = JSON.stringify({ original: true });
    await writeText(input, original);
    let stagedWrites = 0;
    const fs: RepairExportFs = {
      ...realFs,
      writeFile: async (path, data) => {
        if (path.includes(".staged-")) {
          stagedWrites += 1;
          if (stagedWrites === 1) throw eio("json temp write");
        }
        return writeFile(path, data);
      },
    };
    await expect(runRepairExport(fs, planRepairExport(input), compiled())).rejects.toThrow("json temp write");
    expect(await readText(input)).toBe(original);
    expect(await stagedResiduals(directory)).toEqual([]);
    await rm(directory, { recursive: true, force: true });
  });

  it("fails cleanly when the PNG temporary write fails, leaving the original intact", async () => {
    const directory = await tempDir();
    const input = join(directory, "in.json");
    const original = JSON.stringify({ original: true });
    await writeText(input, original);
    let stagedWrites = 0;
    const fs: RepairExportFs = {
      ...realFs,
      writeFile: async (path, data) => {
        if (path.includes(".staged-")) {
          stagedWrites += 1;
          if (stagedWrites === 2) throw eio("png temp write");
        }
        return writeFile(path, data);
      },
    };
    await expect(runRepairExport(fs, planRepairExport(input), compiled())).rejects.toThrow("png temp write");
    expect(await readText(input)).toBe(original);
    expect(await stagedResiduals(directory)).toEqual([]);
    await rm(directory, { recursive: true, force: true });
  });

  it("rolls back the committed JSON and restores old outputs when the PNG rename fails", async () => {
    const directory = await tempDir();
    const input = join(directory, "in.json");
    await writeText(input, JSON.stringify({ original: true }));
    const output = join(directory, "out.json");
    const oldJson = "old-json-content";
    const oldPng = "old-png-content";
    await writeText(output, oldJson);
    await writeText(join(directory, "out.png"), oldPng);
    const fs: RepairExportFs = {
      ...realFs,
      rename: async (from, to) => {
        if (from.includes(".staged-") && !from.includes("staged-protect-") && to.endsWith(".png")) throw eio("png commit rename");
        return rename(from, to);
      },
    };
    await expect(runRepairExport(fs, planRepairExport(input, output), compiled())).rejects.toThrow("png commit rename");
    expect(await readText(output)).toBe(oldJson);
    expect(await readText(join(directory, "out.png"))).toBe(oldPng);
    expect(await readText(input)).toBe(JSON.stringify({ original: true }));
    expect(await stagedResiduals(directory)).toEqual([]);
    await rm(directory, { recursive: true, force: true });
  });

  it("removes the freshly committed JSON when the PNG rename fails and there was no old output", async () => {
    const directory = await tempDir();
    const input = join(directory, "in.json");
    await writeText(input, JSON.stringify({ original: true }));
    const output = join(directory, "out.json");
    const fs: RepairExportFs = {
      ...realFs,
      rename: async (from, to) => {
        if (from.includes(".staged-") && !from.includes("staged-protect-") && to.endsWith(".png")) throw eio("png commit rename");
        return rename(from, to);
      },
    };
    await expect(runRepairExport(fs, planRepairExport(input, output), compiled())).rejects.toThrow("png commit rename");
    await expect(stat(output)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(join(directory, "out.png"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await stagedResiduals(directory)).toEqual([]);
    await rm(directory, { recursive: true, force: true });
  });

  it("restores protected outputs when the protect phase fails midway", async () => {
    const directory = await tempDir();
    const output = join(directory, "out.json");
    const oldJson = "old-json-content";
    const oldPng = "old-png-content";
    await writeText(output, oldJson);
    await writeText(join(directory, "out.png"), oldPng);
    let protectRenames = 0;
    const fs: RepairExportFs = {
      ...realFs,
      rename: async (from, to) => {
        if (to.includes(".staged-protect-")) {
          protectRenames += 1;
          if (protectRenames === 2) throw eio("second protect rename");
        }
        return rename(from, to);
      },
    };
    await expect(runRepairExport(fs, planRepairExport("in.json", output), compiled())).rejects.toThrow("second protect rename");
    expect(await readText(output)).toBe(oldJson);
    expect(await readText(join(directory, "out.png"))).toBe(oldPng);
    expect(await stagedResiduals(directory)).toEqual([]);
    await rm(directory, { recursive: true, force: true });
  });

  it("fails before any mutation when the backup cannot be created", async () => {
    const directory = await tempDir();
    const input = join(directory, "in.json");
    const original = JSON.stringify({ original: true });
    await writeText(input, original);
    const fs: RepairExportFs = {
      ...realFs,
      copyFile: async () => {
        throw eio("backup write");
      },
    };
    await expect(runRepairExport(fs, planRepairExport(input), compiled())).rejects.toThrow("backup write");
    expect(await readText(input)).toBe(original);
    expect(await stagedResiduals(directory)).toEqual([]);
    await rm(directory, { recursive: true, force: true });
  });

  it("leaves no staged or protect files after a successful explicit run", async () => {
    const directory = await tempDir();
    const output = join(directory, "out.json");
    await writeText(output, "old");
    await writeText(join(directory, "out.png"), "old-png");
    await runRepairExport(realFs, planRepairExport("in.json", output), compiled());
    const names = await readdir(directory);
    expect(names.filter((name) => name.includes(".staged-"))).toEqual([]);
    expect(names).toContain("out.json");
    expect(names).toContain("out.png");
    await rm(directory, { recursive: true, force: true });
  });

  it("keeps the original input byte-identical after a failure", async () => {
    const directory = await tempDir();
    const input = join(directory, "in.json");
    const original = JSON.stringify({ 原始: "內容", nested: [1, 2, 3] });
    await writeText(input, original);
    const fs: RepairExportFs = {
      ...realFs,
      writeFile: async (path, data) => {
        if (path.includes(".staged-")) throw eio("temp write");
        return writeFile(path, data);
      },
    };
    await expect(runRepairExport(fs, planRepairExport(input), compiled())).rejects.toThrow("temp write");
    expect(await readText(input)).toBe(original);
    await rm(directory, { recursive: true, force: true });
  });
});
