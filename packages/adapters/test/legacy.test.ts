import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { inspectLegacyProject } from "../src/index.js";

describe("legacy read-only adapter", () => {
  it("inspects files and reports conversion candidates without writing", async () => {
    const root = await os.tmpdir();
    const project = path.join(root, `st-workspace-legacy-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    await mkdir(path.join(project, "cards"), { recursive: true });
    await writeFile(path.join(project, "cards", "yukino.json"), JSON.stringify({ name: "Yukino", description: "card" }));
    await writeFile(path.join(project, "notes.md"), "source notes");
    await writeFile(path.join(project, "broken.json"), "not-json");
    await writeFile(path.join(project, "unknown.json"), JSON.stringify({ arbitrary: true }));
    await writeFile(path.join(project, "null.json"), "null");
    await writeFile(path.join(project, "relationship.json"), JSON.stringify({ kind: "relationship", name: "pair" }));
    await writeFile(path.join(project, "world.json"), JSON.stringify({ kind: "world" }));
    await writeFile(path.join(project, "greeting.json"), JSON.stringify({ kind: "greeting" }));
    await writeFile(path.join(project, "note.txt"), "plain text");
    await writeFile(path.join(project, "binary.bin"), new Uint8Array([0, 1, 2]));
    const result = await inspectLegacyProject(project);
    expect(result.files).toHaveLength(10);
    expect(result.candidates.find((candidate) => candidate.name === "Yukino")?.kind).toBe("artifact");
    expect(result.candidates.find((candidate) => candidate.name === "notes.md")?.kind).toBe("source");
    expect(result.candidates.find((candidate) => candidate.name === "broken.json")?.kind).toBe("unknown");
    expect(result.candidates.find((candidate) => candidate.name === "unknown.json")?.kind).toBe("source");
    expect(result.candidates.find((candidate) => candidate.name === "pair")?.kind).toBe("artifact");
    expect(result.candidates.find((candidate) => candidate.name === "world")?.kind).toBe("artifact");
    expect(result.candidates.find((candidate) => candidate.name === "greeting")?.kind).toBe("artifact");
    expect(result.candidates.find((candidate) => candidate.name === "note.txt")?.kind).toBe("source");
    expect(result.unsupported).toContain("binary.bin");
    expect(result.warnings).toHaveLength(1);
  });
});
