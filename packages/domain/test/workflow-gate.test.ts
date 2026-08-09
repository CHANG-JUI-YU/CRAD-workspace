import { describe, expect, it } from "vitest";
import { MemoryProjectRepository, contentHash, createProjectState, type ArtifactRecord, type OperationRecord } from "@st-workspace/core";
import { AuthoringService, validateWorkflow } from "../src/index.js";

const now = new Date().toISOString();

function operation(id: string, kind: OperationRecord["kind"] = "build"): OperationRecord {
  return { id, kind, request: kind, status: "running", created_at: now, updated_at: now, progress: [] };
}

function artifact(id: string, key: string, kind: ArtifactRecord["kind"], name: string, value: unknown, actor = "writer", operationId = "op-author"): ArtifactRecord {
  const content = typeof value === "string" ? value : JSON.stringify(value);
  const hash = contentHash(content);
  return { id, key, kind, name, content, media_type: "application/json", content_hash: hash, revision: hash, status: "draft", created_at: now, updated_at: now, created_by: actor, operation_id: operationId };
}

const character = (id = "demo") => ({ kind: "character", document: { schema_version: 1, id, display_name: "Demo", aliases: [], summary: "A complete character.", relationships: [], sections: [{ id: "personality", title: "Personality", content: "Calm and direct.", provenance: [], extensions: {} }], provenance: [], extensions: {} } });

describe("workflow gates and editable publish", () => {
  it("requires a passed review for the current artifact revision", async () => {
    const repository = new MemoryProjectRepository("demo");
    const target = artifact("character-1", "character:demo", "character", "Demo", character());
    await repository.commit(0, (state) => ({ ...state, project_status: "ready", interview: { ...state.interview, status: "complete" }, artifacts: [target], operations: [operation("op-publish")] }));
    const missing = validateWorkflow(await repository.read(), "publish");
    expect(missing.ok).toBe(false);
    expect(missing.diagnostics.map((item) => item.code)).toContain("ARTIFACT_REVIEW_REQUIRED");
    await repository.commit((await repository.read()).revision, (state) => ({
      ...state,
      reviews: [{ id: "review-1", artifact_id: target.id, artifact_revision: target.revision, reviewer: "critic", status: "passed", issue_ids: [], created_at: now }],
    }));
    expect(validateWorkflow(await repository.read(), "publish").ok).toBe(true);
  });

  it("blocks a reviewed wardrobe revision when its Markdown count is invalid", async () => {
    const repository = new MemoryProjectRepository("demo");
    const characterArtifact = artifact("character-1", "character:demo", "character", "Demo", character());
    const invalidWardrobe = `# Demo 的衣櫃\n\n## 衣櫃概況\n- 總件數：2\n\n## 上衣\n| 款式 | 顏色／材質 | 數量 |\n| --- | --- | ---: |\n| 白色 T 恤 | 棉質 | 1 |\n`;
    const wardrobeArtifact = artifact("wardrobe-1", "wardrobe:demo/wardrobe", "wardrobe", "demo/wardrobe", invalidWardrobe);
    await repository.commit(0, (state) => ({
      ...state,
      project_status: "ready",
      interview: { ...state.interview, status: "complete" },
      artifacts: [characterArtifact, wardrobeArtifact],
      reviews: [
        { id: "review-character", artifact_id: characterArtifact.id, artifact_revision: characterArtifact.revision, reviewer: "critic", status: "passed" as const, issue_ids: [], created_at: now },
        { id: "review-wardrobe", artifact_id: wardrobeArtifact.id, artifact_revision: wardrobeArtifact.revision, reviewer: "critic", status: "passed" as const, issue_ids: [], created_at: now },
      ],
    }));
    const blocked = validateWorkflow(await repository.read(), "publish");
    expect(blocked.ok).toBe(false);
    expect(blocked.diagnostics.map((item) => item.code)).toContain("WARDROBE_TOTAL_MISMATCH");
  });

  it("reports unresolved cross-artifact references instead of allowing a bad publish", async () => {
    const repository = new MemoryProjectRepository("demo");
    const relationship = artifact("relationship-1", "relationship:team", "relationship", "team", { kind: "relationships", document: { character_ids: ["ghost"], character_summaries: [], perspectives: [], groups: [] } });
    await repository.commit(0, (state) => ({ ...state, project_status: "ready", interview: { ...state.interview, status: "complete" }, artifacts: [relationship], operations: [operation("op-publish")] }));
    const result = validateWorkflow(await repository.read(), "publish");
    expect(result.diagnostics.map((item) => item.code)).toContain("ARTIFACT_REFERENCE_MISSING");
  });

  it("reopens a published project when a new artifact revision is authored", async () => {
    const repository = new MemoryProjectRepository("demo");
    await repository.commit(0, (state) => ({
      ...state,
      project_status: "published",
      publishes: [{ id: "publish-1", operation_id: "op-old", artifact_ids: [], content: "{}", content_hash: contentHash("{}"), created_at: now }],
      operations: [operation("op-edit", "authoring")],
    }));
    const result = await new AuthoringService(repository).create("op-edit", "Create character: Revised. Personality: calm and direct.", "writer");
    expect(result.status).toBe("completed");
    const state = await repository.read();
    expect(state.project_status).toBe("ready");
    expect(state.publishes).toHaveLength(1);
    expect(state.artifacts).toHaveLength(1);
  });

  it("evaluates the formal gate across sources, facts, references and derived links", async () => {
    const repository = new MemoryProjectRepository("diagnostics");
    const values = [
      artifact("character-d", "character:demo", "character", "Demo", { kind: "character", document: { id: "demo", display_name: "Demo", aliases: ["D"], relationships: [{ target_id: "ghost" }] } }),
      artifact("world-d", "world_lore:world", "world_lore", "world", { entries: [{ id: "place", related_ids: ["missing-place"], fact_refs: ["missing-fact"] }] }),
      artifact("relationship-d", "relationship:team", "relationship", "team", { document: { character_ids: ["demo", "ghost"], character_summaries: [{ character_id: "ghost" }], perspectives: [{ source_character_id: "demo", target_character_id: "ghost" }], groups: [{ member_ids: ["ghost"] }] } }),
      artifact("greeting-d", "greeting:greetings", "greeting", "greetings", { document: { greetings: [{ character_ids: ["ghost"] }] } }),
      artifact("zhuji-d", "zhuji:ghost/basic", "zhuji", "ghost/basic", { character_id: "ghost" }),
      artifact("palette-d", "palette:ghost/basic", "palette", "ghost/basic", { character_id: "ghost" }),
      artifact("conversion-d", "conversion:ghost", "conversion", "ghost", { character_id: "ghost", target_mode: "palette" }),
      artifact("import-analysis-d", "import_analysis:one", "import_analysis", "one", { mappings: [] }, "writer", "op-import-analysis"),
      artifact("mvu-d", "plugin:mvu", "plugin", "mvu", { kind: "plugin", plugin_id: "official.mvu-zod", source: { variables: [{ id: "known" }] } }),
      artifact("html-d", "plugin:html", "plugin", "html", { kind: "plugin", plugin_id: "official.html", source: { components: [{ binding_paths: ["/missing"] }] } }),
      artifact("research-d", "source_research:one", "source_research", "one", { candidates: [{ title: "Official page", url: "https://blocked.example/page", official: true }], allowed_domains: ["allowed.example"] }),
      artifact("broken-d", "unknown:broken", "unknown", "broken", "not-json"),
    ];
    await repository.commit(0, (state) => ({
      ...state,
      project_status: "interviewing",
      interview: { ...state.interview, status: "active", flow: "world" },
      artifacts: values,
      candidates: [{ id: "candidate-official", title: "Official page", url: "https://blocked.example/page", status: "pending" }],
      facts: [
        { id: "fact-accepted", statement: "unverified", status: "accepted", confidence: 0.5, source_ids: ["missing-source"], evidence: ["unverified quote"], created_at: now, updated_at: now, created_by: "curator" },
        { id: "fact-unproven", statement: "unproven", status: "accepted", confidence: 0.5, source_ids: [], evidence: ["unverified quote"], created_at: now, updated_at: now, created_by: "curator" },
      ],
      blueprint_prechecks: [{ id: "precheck", schema_version: 1, project_id: "diagnostics", operation_id: "op", collaboration_mode: "assisted", candidate_blueprint: {}, candidate_blueprint_revision: contentHash("blueprint"), checks: [{ subject_id: "diagnostics", dimension: "character_core", uncertainty: "high", impact: "high", basis: "pending", action: "user_confirmed", user_answer: "pending confirmation" }], status: "needs_input", created_at: now, created_by: "director" }],
      operations: [operation("op")],
    }));
    expect(validateWorkflow(await repository.read(), "draft").diagnostics.map((item) => item.code)).toContain("BLUEPRINT_PRECHECK_REQUIRED");
    await repository.commit((await repository.read()).revision, (state) => ({ ...state, project_status: "ready", interview: { ...state.interview, status: "complete" }, blueprint_prechecks: state.blueprint_prechecks.map((item) => ({ ...item, status: "recorded" as const })) }));
    const result = validateWorkflow(await repository.read(), "publish");
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining(["SOURCE_RESEARCH_NOT_INGESTED", "SOURCE_RESEARCH_OFFICIAL_REQUIRED", "SOURCE_DOMAIN_NOT_ALLOWED", "FACT_SOURCE_MISSING", "FACT_PROVENANCE_MISSING", "CONVERSION_TARGET_MISSING", "PLUGIN_BINDING_MISSING", "IMPORT_ANALYSIS_LINK_MISSING"]));
  });

  it("accepts a complete workflow and keeps legacy/unfilled states diagnosable", async () => {
    const repository = new MemoryProjectRepository("complete");
    const characterValue = { kind: "character", document: { id: "demo", display_name: "Demo", aliases: ["D"], relationships: [], sections: [] } };
    const values = [
      artifact("character", "character:demo", "character", "Demo", characterValue, "writer", "op-author"),
      artifact("relationship", "relationship:team", "relationship", "Team", { document: { character_ids: ["demo"], character_summaries: [{ character_id: "demo", summary: "Friend" }], perspectives: [{ source_character_id: "demo", target_character_id: "demo", summary: "Trust" }], groups: [{ member_ids: ["demo"] }] } }),
      artifact("greeting", "greeting:greetings", "greeting", "Greetings", { document: { greetings: [{ character_ids: ["demo"] }] } }),
      artifact("world", "world:world", "world_lore", "World", { entries: [{ id: "place", related_ids: ["place"], fact_refs: ["fact-1"] }] }),
      artifact("zhuji", "zhuji:demo/appearance", "zhuji", "demo/appearance", { character_id: "demo", module: { mode: "zhuji", module: "appearance", title: "Appearance", data: { description: "Tall" } } }),
      artifact("palette", "palette:demo/basic", "palette", "demo/basic", { character_id: "demo", module: { mode: "palette", module: "basic_information", title: "Basic", content: "Calm" } }),
      artifact("conversion", "conversion:demo", "conversion", "Conversion", { character_id: "demo", target_mode: "zhuji" }),
      artifact("mvu", "plugin:mvu", "plugin", "mvu", { plugin_id: "official.mvu-zod", source: { variables: [{ id: "known" }] } }),
      artifact("html", "plugin:html", "plugin", "html", { plugin_id: "official.html", source: { components: [{ binding_paths: ["/known"] }] } }),
      artifact("research", "source_research:official", "source_research", "Research", { candidates: [{ title: "Official page", url: "https://official.example/page", official: true }, { title: "Mirror page" }], allowed_domains: ["official.example", "allowed.example"] }),
      artifact("import-analysis", "import_analysis:one", "import_analysis", "Import", { mappings: [] }, "writer", "op-author"),
      artifact("broken", "unknown:broken", "unknown", "Broken", "not-json"),
    ];
    const officialContent = "official content";
    const mirrorContent = "mirror content";
    await repository.commit(0, (state) => ({
      ...state,
      project_status: "ready",
      interview: { ...state.interview, status: "complete", flow: "character" },
      artifacts: values,
      candidates: [
        { id: "candidate-official", title: "Official page", url: "https://official.example/page", domain: "official.example", official: true, status: "ingested" },
        { id: "candidate-mirror", title: "Mirror page", domain: "sub.allowed.example", status: "ingested" },
        { id: "candidate-other", title: "Other", url: "not-a-url", status: "ingested" },
      ],
      sources: [
        { id: "source-official", candidate_id: "candidate-official", title: "Official page", canonical_text: officialContent, original_hash: contentHash(officialContent), revision: contentHash(officialContent), media_type: "text/plain", created_at: now },
        { id: "source-mirror", candidate_id: "candidate-mirror", title: "Mirror page", canonical_text: mirrorContent, original_hash: contentHash(mirrorContent), revision: contentHash(mirrorContent), media_type: "text/plain", created_at: now },
      ],
      knowledge_chunks: [{ id: "chunk-official", source_id: "source-official", ordinal: 0, text: officialContent, hash: contentHash(officialContent), created_at: now }],
      facts: [{ id: "fact-1", candidate_occurrence_id: "occ-1", fact_revision: 2, review_run_id: "run-1", decision_id: "decision-1", statement: "Demo is calm", status: "accepted", confidence: 1, source_ids: ["source-official"], evidence: [officialContent], evidence_refs: [{ source_id: "source-official", source_revision_id: contentHash(officialContent), chunk_id: "chunk-official", chunk_hash: contentHash(officialContent), quote: officialContent }], created_at: now, updated_at: now, created_by: "curator" }],
      fact_review_passes: [1, 2, 3].map((pass) => ({ id: `pass-${pass}`, operation_id: "op-review", reviewer: `reviewer-${pass}`, pass: pass as 1 | 2 | 3, fact_ids: ["fact-1"], decisions_hash: contentHash(`pass-${pass}`), created_at: now })),
      fact_review_runs: [{ schema_version: 1, id: "run-1", candidate_set_revision: contentHash("candidate-set"), candidate_occurrence_ids: ["occ-1"], source_revisions: [{ source_id: "source-official", revision: contentHash(officialContent) }], policy_revision: contentHash("fact-review-strict-v1"), status: "completed", created_by: "fact-reviewer-1", created_at: now, completed_at: now }],
      fact_review_decisions: [{ schema_version: 1, id: "decision-1", operation_id: "op-review", review_run_id: "run-1", candidate_occurrence_id: "occ-1", fact_id: "fact-1", reviewer_identity: "fact-reviewer-1", decision: "accepted", reason: "Exact quote.", evidence: [{ source_id: "source-official", source_revision_id: contentHash(officialContent), chunk_id: "chunk-official", chunk_hash: contentHash(officialContent), quote: officialContent }], candidate_revision: contentHash("candidate"), expected_projection_revision: contentHash("projection"), resulting_fact_revision: 2, created_at: now }],
      reviews: values.filter((item) => ["character", "relationship", "greeting", "world_lore", "zhuji", "palette", "plugin"].includes(item.kind)).map((item, index) => ({ id: `review-${index}`, artifact_id: item.id, artifact_revision: item.revision, reviewer: "critic", status: "passed" as const, issue_ids: [], created_at: now })),
      imports: [],
    }));
    const complete = await repository.read();
    expect(validateWorkflow(complete, "draft").ok).toBe(true);
    expect(validateWorkflow(complete, "publish")).toMatchObject({ ok: true, diagnostics: [] });

    const legacy = createProjectState("legacy");
    expect(validateWorkflow(legacy, "publish")).toMatchObject({ ok: true, diagnostics: [] });
    const empty = { ...legacy, project_status: "ready" as const, interview: { ...legacy.interview, status: "complete" as const } };
    expect(validateWorkflow(empty, "publish").diagnostics.map((item) => item.code)).toContain("PUBLISH_NO_CONTENT");
    const worldMissing = { ...empty, interview: { ...empty.interview, flow: "world" as const } };
    expect(validateWorkflow(worldMissing, "publish").diagnostics.map((item) => item.code)).toContain("REQUIRED_WORLD_ARTIFACT_MISSING");
    const blocked = { ...complete, issues: [{ id: "issue", artifact_id: "character", review_id: "review-0", code: "BLOCK", message: "blocked", severity: "error" as const, effective_severity: "error" as const, status: "open" as const, created_at: now, updated_at: now }] };
    expect(validateWorkflow(blocked, "publish").diagnostics.map((item) => item.code)).toContain("PUBLISH_BLOCKING_ISSUES");
  });

  it("handles defensive input shapes across every cross-artifact branch", async () => {
    const repository = new MemoryProjectRepository("defensive");
    const base = createProjectState("defensive");
    const malformed = [
      artifact("source-empty", "source_research:empty", "source_research", "empty", { candidates: [] }),
      artifact("source-invalid", "source_research:invalid", "source_research", "invalid", { candidates: "not-an-array", allowed_domains: ["allowed.example", 3] }),
      artifact("source-unmatched", "source_research:unmatched", "source_research", "unmatched", { candidates: [{ title: "Official missing", url: "not-a-url", official: true }, { title: "Blank domain", domain: " ", url: "https://allowed.example/page" }], allowed_domains: ["allowed.example"] }),
      artifact("source-whitespace", "source_research:whitespace", "source_research", "whitespace", { candidates: [{ title: "Whitespace domain", domain: "" }], allowed_domains: ["allowed.example"] }),
      artifact("character-array", "character:array", "character", "array", { document: [] }),
      artifact("character-alias", "character:alias", "character", "alias", { document: { id: "alias", aliases: "not-an-array" } }),
      artifact("relationship-shape", "relationship:shape", "relationship", "shape", { document: { character_ids: "demo", character_summaries: "not-an-array", perspectives: null, groups: {} } }),
      artifact("greeting-shape", "greeting:shape", "greeting", "shape", { document: { greetings: {} } }),
      artifact("world-shape", "world_lore:shape", "world_lore", "shape", { entries: {} }),
      artifact("zhuji-shape", "zhuji:shape", "zhuji", "shape", { module: { mode: "zhuji", module: "appearance" } }),
      artifact("conversion-shape", "conversion:shape", "conversion", "shape", { target_mode: "other" }),
      artifact("conversion-missing", "conversion:missing", "conversion", "missing", { character_id: "ghost", target_mode: "palette" }),
      artifact("mvu-shape", "plugin:mvu-shape", "plugin", "mvu-shape", { plugin_id: "official.mvu-zod", source: { variables: {} } }),
      artifact("mvu-valid", "plugin:mvu-valid", "plugin", "mvu-valid", { plugin_id: "official.mvu-zod", source: { variables: [{ id: "known" }] } }),
      artifact("html-shape", "plugin:html-shape", "plugin", "html-shape", { plugin_id: "official.html", source: { components: {} } }),
      artifact("primitive", "unknown:array", "unknown", "array", "[]"),
    ];
    await repository.commit(0, (state) => ({
      ...state,
      ...base,
      project_status: "interviewing",
      interview: { ...base.interview, status: "active", flow: "world" },
      artifacts: malformed,
      candidates: [{ id: "other", title: "Other", url: "https://other.example", status: "pending" }],
      issues: [{ id: "issue", artifact_id: "character-array", review_id: "review", code: "BLOCK", message: "open", severity: "error", effective_severity: "error", status: "open", created_at: now, updated_at: now }],
      quality_profile: { ...base.quality_profile, blocking_severity: "none" },
    }));
    const result = validateWorkflow(await repository.read(), "publish");
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining(["INTERVIEW_REQUIRED", "SOURCE_RESEARCH_OFFICIAL_REQUIRED", "ARTIFACT_REVIEW_REQUIRED"]));
  });
});
