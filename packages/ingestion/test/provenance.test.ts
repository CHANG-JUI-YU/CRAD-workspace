import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  canonicalYaml,
  computeRevision,
  initializeProject,
  loadAuthorProject,
} from "@card-workspace/project";
import {
  conflictRegisterSchema,
  factRegisterSchema,
  projectManifestSchema,
  type Fact,
} from "@card-workspace/schemas";
import { makeTemporaryWorkspace } from "@card-workspace/testing";
import { parse as parseYaml } from "yaml";
import { afterEach, describe, expect, it } from "vitest";

import {
  buildProvenanceIndex,
  createChunkSet,
  DEFAULT_CHUNK_PROFILE,
  intakeLocalSource,
  normalizedRangeToLineRange,
  normalizedRangeToSourceByteRange,
  provenanceRuleIds,
  storeChunkSet,
  traceProvenance,
  verifyProvenance,
} from "../src/index.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => Promise.all(cleanups.splice(0).map((cleanup) => cleanup())));

async function fixture() {
  const workspace = await makeTemporaryWorkspace();
  cleanups.push(workspace.cleanup);
  const projectRoot = await initializeProject({
    projectsRoot: workspace.projectsRoot,
    manifest: projectManifestSchema.parse({
      schema_version: 1,
      id: "provenance-demo",
      title: "Provenance",
      kind: "character_card",
      card: { name: "Provenance" },
      characters: [{ id: "alice", display_name: "Alice", mode: "zhuji", role: "primary" }],
    }),
  });
  const sourcePath = path.join(workspace.root, "source.txt");
  await writeFile(sourcePath, "Alice has black hair.", "utf8");
  const intake = await intakeLocalSource({ projectRoot, filePath: sourcePath, sourceId: "novel", title: "Novel" });
  const chunkSet = createChunkSet({
    projection: intake.projection,
    profile: { ...DEFAULT_CHUNK_PROFILE, target_tokens: 5_000, overlap_tokens: 500 },
  });
  await storeChunkSet({ projectRoot, artifacts: chunkSet, timestamp: "2026-07-13T10:00:00.000Z" });
  const chunk = chunkSet.chunks[0]!;
  const range: [number, number] = [10, 20];
  const rawRange = normalizedRangeToSourceByteRange(intake.projection.text, intake.projection.line_map!, range);
  const fact: Fact = {
    schema_version: 1,
    id: "fact-hair",
    subject: "alice",
    predicate: "appearance.hair",
    value: "black hair",
    classification: "source_fact",
    confidence: 1,
    scope: { character_ids: ["alice"], extensions: {} },
    valid_time: { extensions: {} },
    evidence: [{
      id: "evidence-hair",
      source_id: "novel",
      source_revision_id: intake.revision.id,
      chunk_set_id: chunkSet.manifest.id,
      chunk_id: chunk.id,
      chunk_hash: chunk.content_hash,
      quote: intake.projection.text.slice(...range),
      normalized_character_range: range,
      normalized_line_range: normalizedRangeToLineRange(intake.projection.line_map!, range),
      ...(rawRange ? { raw_byte_range: rawRange } : {}),
      extensions: {},
    }],
    source_tiers: ["unknown"],
    status: "accepted",
    fact_revision: 1,
    decision_id: "decision-hair",
    created_by: "curator",
    created_at: "2026-07-13T10:00:00.000Z",
    supersedes: [],
    decision_ids: ["decision-hair"],
    extensions: {},
  };
  await writeFacts(projectRoot, [fact]);
  await setAppearanceRef(projectRoot, { kind: "fact", ref: fact.id });
  return { workspace, projectRoot, intake, chunkSet, fact };
}

async function writeFacts(projectRoot: string, facts: Fact[]): Promise<void> {
  const state = { schema_version: 1 as const, facts, extensions: {} };
  await writeFile(
    path.join(projectRoot, "facts", "register.yaml"),
    canonicalYaml(factRegisterSchema.parse({ ...state, revision: computeRevision(state) })),
    "utf8",
  );
}

async function setAppearanceRef(projectRoot: string, ref: Record<string, unknown>): Promise<void> {
  const file = path.join(projectRoot, "characters", "alice", "zhuji", "01-appearance.yaml");
  const value = parseYaml(await readFile(file, "utf8")) as Record<string, unknown>;
  value.provenance = [ref];
  await writeFile(file, canonicalYaml(value), "utf8");
}

describe("provenance index", () => {
  it("structured Zhuji data 只建立模組層 provenance fragment", async () => {
    const f = await fixture();
    const file = path.join(f.projectRoot, "characters", "alice", "zhuji", "01-appearance.yaml");
    const previous = parseYaml(await readFile(file, "utf8")) as Record<string, unknown>;
    await writeFile(file, canonicalYaml({
      schema_version: 1,
      mode: "zhuji",
      module: "appearance",
      title: previous.title,
      data: {
        外顯核心: {}, 面貌: {}, 身體基礎數據: {}, 性器官特徵: {}, 其他器官特徵: {},
        聲音: {}, 服裝風格與著裝習慣: {}, 交互模式: {}, 整體感官體驗: {},
      },
      provenance: previous.provenance,
    }), "utf8");

    const result = await buildProvenanceIndex(await loadAuthorProject(f.workspace.projectsRoot, "provenance-demo"));
    expect(result.diagnostics).toEqual([]);
    expect(result.index.nodes).toContainEqual(expect.objectContaining({
      id: "character.alice.appearance.main",
      kind: "fragment",
    }));
    expect(result.index.nodes.some((node) => node.id.includes("appearance.section."))).toBe(false);
  });

  it("建立 deterministic 雙向完整鏈，顯示名稱改動不破壞 stable refs", async () => {
    const f = await fixture();
    const loaded = await loadAuthorProject(f.workspace.projectsRoot, "provenance-demo");
    const first = await buildProvenanceIndex(loaded);
    expect(first.diagnostics).toEqual([]);
    expect(first.index.nodes.map((node) => node.kind)).toEqual(expect.arrayContaining([
      "fragment", "fact", "evidence", "chunk", "source_revision", "snapshot",
    ]));
    expect((await traceProvenance(f.projectRoot, "fact-hair")).nodes).toHaveLength(6);

    const manifestPath = path.join(f.projectRoot, "sources", "manifest.yaml");
    const manifest = parseYaml(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
    const sources = manifest.sources as Array<Record<string, unknown>>;
    sources[0]!.title = "Renamed display title";
    const state = { schema_version: 1 as const, sources, extensions: manifest.extensions ?? {} };
    await writeFile(manifestPath, canonicalYaml({ ...state, revision: computeRevision(state) }), "utf8");
    const renamed = await buildProvenanceIndex(await loadAuthorProject(f.workspace.projectsRoot, "provenance-demo"));
    expect(renamed.index.revision).toBe(first.index.revision);
    expect(renamed.index).toEqual(first.index);
  });

  it.each(["rejected", "withdrawn", "superseded"] as const)("回報 %s fact reference", async (status) => {
    const f = await fixture();
    await writeFacts(f.projectRoot, [{ ...f.fact, status }]);
    const result = await verifyProvenance(f.projectRoot);
    expect(result.ok).toBe(false);
    const item = result.diagnostics.find((candidate) => candidate.code === provenanceRuleIds.nonAcceptedFact);
    expect(item?.details).toMatchObject({ fact_id: "fact-hair" });
  });

  it("區分 missing ref、broken evidence，並攜帶 fact/chunk/source chain", async () => {
    const missing = await fixture();
    await setAppearanceRef(missing.projectRoot, { kind: "fact", ref: "fact-missing" });
    expect((await verifyProvenance(missing.projectRoot)).diagnostics.map((item) => item.code))
      .toContain(provenanceRuleIds.invalidFactRef);

    const broken = await fixture();
    const digest = broken.intake.revision.id.slice("sha256:".length);
    const chunkPath = path.join(
      broken.projectRoot,
      "sources", "chunks", "novel", digest, broken.chunkSet.manifest.id, `${broken.chunkSet.chunks[0]!.id}.json`,
    );
    await writeFile(chunkPath, "{}", "utf8");
    const finding = (await verifyProvenance(broken.projectRoot)).diagnostics.find((item) =>
      item.code === provenanceRuleIds.brokenEvidence);
    expect(finding).toMatchObject({
      details: { fact_id: "fact-hair", chunk_id: broken.chunkSet.chunks[0]!.id, source_id: "novel" },
      evidence: [{ source: "novel", revision: broken.intake.revision.id }],
    });
  });

  it("只在被引用且要求單一值時阻斷 unresolved conflict", async () => {
    const f = await fixture();
    const other: Fact = {
      ...f.fact,
      id: "fact-hair-other",
      value: "white hair",
      classification: "creative_completion",
      evidence: [],
      decision_id: "decision-other",
      decision_ids: ["decision-other"],
    };
    await writeFacts(f.projectRoot, [f.fact, other]);
    const conflictState = {
      schema_version: 1 as const,
      conflicts: [{
        schema_version: 1 as const,
        id: "conflict-hair",
        subject: "alice",
        predicate: "appearance.hair",
        scope: f.fact.scope,
        valid_time: f.fact.valid_time,
        members: [
          { fact_id: f.fact.id, source_id: "novel", source_revision_id: f.intake.revision.id, value: f.fact.value },
          { fact_id: other.id, source_id: "novel", source_revision_id: f.intake.revision.id, value: other.value },
        ],
        status: "open" as const,
        opened_at: "2026-07-13T10:00:00.000Z",
        updated_at: "2026-07-13T10:00:00.000Z",
        extensions: {},
      }],
      extensions: {},
    };
    await writeFile(
      path.join(f.projectRoot, "facts", "conflicts.yaml"),
      canonicalYaml(conflictRegisterSchema.parse({ ...conflictState, revision: computeRevision(conflictState) })),
      "utf8",
    );
    expect((await verifyProvenance(f.projectRoot)).diagnostics.map((item) => item.code))
      .not.toContain(provenanceRuleIds.unresolvedConflict);
    await setAppearanceRef(f.projectRoot, { kind: "fact", ref: f.fact.id, requires_single_value: true });
    expect((await verifyProvenance(f.projectRoot)).diagnostics.map((item) => item.code))
      .toContain(provenanceRuleIds.unresolvedConflict);
  });
});
