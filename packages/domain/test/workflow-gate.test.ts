import { describe, expect, it } from "vitest";
import { MemoryProjectRepository, computeBuildPlan, contentHash, createProjectState, qualityProfileForLevel, type ArtifactRecord, type BlueprintPrecheckRecord, type FactRecord, type IssueSeverity, type OperationRecord } from "@st-workspace/core";
import { AuthoringService, buildRequiredArtifactManifest, validateWorkflow } from "../src/index.js";

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

  it("uses current quality policy and issue status instead of review.status", async () => {
    const repository = new MemoryProjectRepository("quality-policy");
    const target = artifact("character-quality", "character:demo", "character", "Demo", character());
    const review = { id: "review-quality", artifact_id: target.id, artifact_revision: target.revision, reviewer: "character-critic", status: "partial" as const, issue_ids: ["issue-quality"], created_at: now };
    const issue = { id: "issue-quality", artifact_id: target.id, review_id: review.id, code: "FINDING_STYLE", message: "Style needs a decision.", severity: "warning" as const, effective_severity: "warning" as const, against_effective_severity: "warning" as const, overridable: true, status: "open" as const, created_at: now, updated_at: now };
    const base = { ...(await repository.read()), project_status: "ready" as const, interview: { ...(await repository.read()).interview, status: "complete" as const }, artifacts: [target], reviews: [review], issues: [issue], operations: [operation("op-quality")] };
    const severityMatrix: Array<{ level: "none" | "light" | "normal" | "strict"; blocks: readonly IssueSeverity[] }> = [
      { level: "none", blocks: [] },
      { level: "light", blocks: ["critical"] },
      { level: "normal", blocks: ["error", "critical"] },
      { level: "strict", blocks: ["warning", "error", "critical"] },
    ];
    for (const { level, blocks } of severityMatrix) {
      for (const severity of ["info", "warning", "error", "critical"] as const) {
        const currentIssue = { ...issue, severity, effective_severity: severity, against_effective_severity: severity };
        expect(validateWorkflow({ ...base, quality_profile: qualityProfileForLevel(level), issues: [currentIssue] }, "publish").ok).toBe(!blocks.includes(severity));
      }
    }
    expect(validateWorkflow({ ...base, quality_profile: qualityProfileForLevel("normal", { FINDING_STYLE: "info" }) }, "publish").ok).toBe(true);
    expect(validateWorkflow({ ...base, quality_profile: qualityProfileForLevel("strict"), issues: [{ ...issue, status: "resolved" }] }, "publish").ok).toBe(true);
  });

  it("keeps an issue-scoped override isolated while global overrides remain shared", async () => {
    const repository = new MemoryProjectRepository("issue-scope-gate");
    const target = artifact("character-scope", "character:scope", "character", "Scope", character("scope"));
    const review = { id: "review-scope", artifact_id: target.id, artifact_revision: target.revision, reviewer: "critic", status: "partial" as const, issue_ids: ["issue-one", "issue-two"], created_at: now };
    const issueOne = { id: "issue-one", artifact_id: target.id, review_id: review.id, code: "FINDING_STYLE", message: "One", severity: "error" as const, effective_severity: "info" as const, against_effective_severity: "error" as const, overridable: true, override: { by: "director", reason: "Only this issue is accepted.", timestamp: now, against_effective_severity: "error" as const, severity: "info" as const }, status: "open" as const, created_at: now, updated_at: now };
    const issueTwo = { id: "issue-two", artifact_id: target.id, review_id: review.id, code: "FINDING_STYLE", message: "Two", severity: "error" as const, effective_severity: "error" as const, against_effective_severity: "error" as const, overridable: true, status: "open" as const, created_at: now, updated_at: now };
    const base = { ...(await repository.read()), project_status: "ready" as const, interview: { ...(await repository.read()).interview, status: "complete" as const }, artifacts: [target], reviews: [review], issues: [issueOne, issueTwo], operations: [operation("op-scope")] };
    expect(validateWorkflow({ ...base, issues: [issueOne] }, "publish").ok).toBe(true);
    expect(validateWorkflow(base, "publish").ok).toBe(false);
    const strictGlobalWarning = qualityProfileForLevel("strict", { FINDING_STYLE: "warning" });
    expect(validateWorkflow({ ...base, issues: [issueOne], quality_profile: strictGlobalWarning }, "publish").ok).toBe(true);
    expect(validateWorkflow({ ...base, issues: [issueTwo], quality_profile: strictGlobalWarning }, "publish").ok).toBe(false);
    expect(validateWorkflow({ ...base, quality_profile: strictGlobalWarning }, "publish").ok).toBe(false);
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
    const result = await new AuthoringService(repository).create("op-edit", "Draft note: Create character: Revised. Personality: calm and direct.", "writer");
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

  it("gates publish on the Blueprint-selected mode, world and relationships", async () => {
    const repository = new MemoryProjectRepository("manifest-gate");
    const precheck: BlueprintPrecheckRecord = {
      id: "precheck-manifest",
      schema_version: 1,
      project_id: "manifest-gate",
      operation_id: "interview-manifest",
      collaboration_mode: "assisted",
      candidate_blueprint: {
        flow: "source_adaptation",
        collaboration_mode: "assisted",
        characters: [{ id: "demo", label: "Demo", ordinal: 1, mode: "zhuji" }],
        world: { enabled: true, authoring_timing: "before_character" },
        relationships: { enabled: true },
      },
      candidate_blueprint_revision: contentHash("manifest-candidate"),
      checks: [{ subject_id: "manifest-gate", dimension: "character_core", uncertainty: "low", impact: "high", basis: "explicit", action: "preserve_explicit" }],
      status: "recorded",
      created_at: now,
      created_by: "director",
    };
    const target = artifact("character-1", "character:demo", "character", "demo", character("demo"));
    const zhuji = artifact("zhuji-1", "zhuji:demo/appearance", "zhuji", "demo/appearance", { kind: "zhuji", character_id: "demo", module: { schema_version: 1, mode: "zhuji", module: "appearance", title: "Appearance", content: "Tall." } });
    await repository.commit(0, (state) => ({
      ...state,
      project_status: "ready",
      interview: { ...state.interview, status: "complete" },
      blueprint_prechecks: [precheck],
      artifacts: [target, zhuji],
      reviews: [{ id: "review-character", artifact_id: target.id, artifact_revision: target.revision, reviewer: "critic", status: "passed", issue_ids: [], created_at: now }],
      operations: [operation("op-publish")],
    }));
    const result = validateWorkflow(await repository.read(), "publish");
    expect(result.ok).toBe(false);
    const codes = result.diagnostics.map((item) => item.code);
    expect(codes).toContain("REQUIRED_WORLD_ARTIFACT_MISSING");
    expect(codes).toContain("REQUIRED_RELATIONSHIPS_ARTIFACT_MISSING");
    expect(codes).toContain("MODE_MODULES_INCOMPLETE");
  });

  it("does not block publish on artifacts outside the Blueprint-selected mode", async () => {
    const repository = new MemoryProjectRepository("manifest-scope");
    const precheck: BlueprintPrecheckRecord = {
      id: "precheck-scope",
      schema_version: 1,
      project_id: "manifest-scope",
      operation_id: "interview-scope",
      collaboration_mode: "assisted",
      candidate_blueprint: {
        flow: "source_adaptation",
        collaboration_mode: "assisted",
        characters: [{ id: "demo", label: "Demo", ordinal: 1, mode: "zhuji" }],
      },
      candidate_blueprint_revision: contentHash("scope-candidate"),
      checks: [{ subject_id: "manifest-scope", dimension: "character_core", uncertainty: "low", impact: "high", basis: "explicit", action: "preserve_explicit" }],
      status: "recorded",
      created_at: now,
      created_by: "director",
    };
    const target = artifact("character-scope", "character:demo", "character", "demo", character("demo"));
    const moduleNames = ["appearance", "inner_nature", "extension", "trait_refinement", "trait_dialogue", "scene_dialogue", "self_introduction"];
    const modules = moduleNames.map((module, index) => artifact(`zhuji-scope-${index}`, `zhuji:demo/${module}`, "zhuji", `demo/${module}`, { kind: "zhuji", character_id: "demo", module: { schema_version: 1, mode: "zhuji", module, title: module, content: "Complete module content." } }));
    const greeting = artifact("greeting-scope", "greeting:demo", "greeting", "demo", { document: { greetings: [{ character_ids: ["demo"], text: "Hello." }] } });
    const outOfScope = artifact("palette-out", "palette:demo/basic_information", "palette", "demo/basic_information", { kind: "palette", character_id: "demo", module: { schema_version: 1, mode: "palette", module: "basic_information", title: "Basic", content: "Unreviewed." } });
    const bound = [target, ...modules, greeting, outOfScope].map((item) => ({ ...item, blueprint_precheck_id: precheck.id, blueprint_precheck_revision: precheck.candidate_blueprint_revision }));
    await repository.commit(0, (state) => ({
      ...state,
      project_status: "ready",
      interview: { ...state.interview, status: "complete" },
      blueprint_prechecks: [precheck],
      artifacts: bound,
      reviews: [target, ...modules, greeting].map((item, index) => ({ id: `review-scope-${index}`, artifact_id: item.id, artifact_revision: item.revision, reviewer: "critic", status: "passed", issue_ids: [], created_at: now })),
      operations: [operation("op-publish")],
    }));
    expect(validateWorkflow(await repository.read(), "publish")).toMatchObject({ ok: true, diagnostics: [] });
  });

  it("flags accepted facts that contradict each other on the same subject and predicate", async () => {
    const repository = new MemoryProjectRepository("contradiction");
    const officialContent = "Yukino has_trait direct. Yukino has_trait calm.";
    const sourceId = "source-contradiction";
    const chunkId = "chunk-contradiction";
    const fact = (id: string, occurrenceId: string, value: string, decisionId: string): FactRecord => ({
      id,
      candidate_occurrence_id: occurrenceId,
      fact_revision: 2,
      review_run_id: "run-contradiction",
      decision_id: decisionId,
      statement: `Yukino has_trait ${value}.`,
      subject: "Yukino",
      predicate: "has_trait",
      value,
      classification: "trait",
      coverage: ["identity", "personality"],
      status: "accepted",
      confidence: 1,
      source_ids: [sourceId],
      evidence: [officialContent],
      evidence_refs: [{ source_id: sourceId, source_revision_id: contentHash(officialContent), chunk_id: chunkId, chunk_hash: contentHash(officialContent), quote: `Yukino has_trait ${value}.` }],
      created_at: now,
      updated_at: now,
      created_by: "curator",
    });
    await repository.commit(0, (state) => ({
      ...state,
      project_status: "ready",
      interview: { ...state.interview, status: "complete", flow: "source_adaptation" },
      sources: [{ id: sourceId, candidate_id: "candidate-contradiction", title: "Official page", canonical_text: officialContent, original_hash: contentHash(officialContent), revision: contentHash(officialContent), media_type: "text/plain", created_at: now }],
      knowledge_chunks: [{ id: chunkId, source_id: sourceId, ordinal: 0, text: officialContent, hash: contentHash(officialContent), created_at: now }],
      facts: [fact("fact-direct", "occ-direct", "direct", "decision-direct"), fact("fact-calm", "occ-calm", "calm", "decision-calm")],
      fact_review_runs: [{ schema_version: 1, id: "run-contradiction", candidate_set_revision: contentHash("candidate-set"), candidate_occurrence_ids: ["occ-direct", "occ-calm"], source_revisions: [{ source_id: sourceId, revision: contentHash(officialContent) }], policy_revision: contentHash("fact-review-strict-v1"), status: "completed", created_by: "fact-reviewer-1", created_at: now, completed_at: now }],
      fact_review_decisions: ["direct", "calm"].map((value, index) => ({ schema_version: 1, id: `decision-${value}`, operation_id: "op-review", review_run_id: "run-contradiction", candidate_occurrence_id: `occ-${value}`, fact_id: `fact-${value}`, reviewer_identity: `fact-reviewer-${index + 1}`, decision: "accepted" as const, reason: "Exact quote.", evidence: [{ source_id: sourceId, source_revision_id: contentHash(officialContent), chunk_id: chunkId, chunk_hash: contentHash(officialContent), quote: `Yukino has_trait ${value}.` }], candidate_revision: contentHash(`candidate-${value}`), expected_projection_revision: contentHash(`projection-${value}`), resulting_fact_revision: 2, created_at: now })),
      operations: [operation("op-publish")],
    }));
    const result = validateWorkflow(await repository.read(), "publish");
    expect(result.ok).toBe(false);
    const contradiction = result.diagnostics.find((item) => item.code === "FACT_REVIEW_CONTRADICTION");
    expect(contradiction).toMatchObject({ severity: "error", fact_ids: ["fact-direct", "fact-calm"] });
  });

  it("matches the source-adaptation coverage register through entity refs and legacy subject aliases", async () => {
    const repository = new MemoryProjectRepository("coverage-alias");
    const officialContent = "Yukino has_trait direct.";
    const sourceId = "source-alias";
    const chunkId = "chunk-alias";
    const blueprint = artifact("blueprint-alias", "blueprint:alias", "blueprint", "Alias", { kind: "blueprint", flow: "source_adaptation", characters: [{ id: "demo", label: "Demo", aliases: ["Yukino", "Alicia"], ordinal: 1, mode: "zhuji" }], source_adaptation: { subject_name: "Yukino", subjects: [{ character_id: "demo", subject_name: "Yukino" }] } }, "director", "interview");
    const characterArtifact = artifact("character-alias", "character:demo", "character", "Demo", { kind: "character", document: { schema_version: 1, id: "demo", display_name: "Demo", aliases: [], summary: "A student.", relationships: [], sections: [], fact_refs: [], provenance: [], extensions: {} } }, "director", "interview");
    const baseFacts: FactRecord[] = [{
      id: "fact-alias",
      candidate_occurrence_id: "occ-alias",
      fact_revision: 2,
      review_run_id: "run-alias",
      decision_id: "decision-alias",
      statement: "Yukino has_trait direct.",
      subject: "Alicia",
      predicate: "has_trait",
      value: "direct",
      classification: "trait",
      entity_refs: ["demo"],
      coverage: ["identity", "personality", "speech", "habits", "background", "relationships", "appearance"],
      status: "accepted",
      confidence: 1,
      source_ids: [sourceId],
      evidence: [officialContent],
      evidence_refs: [{ source_id: sourceId, source_revision_id: contentHash(officialContent), chunk_id: chunkId, chunk_hash: contentHash(officialContent), quote: officialContent }],
      created_at: now,
      updated_at: now,
      created_by: "curator",
    }];
    const run = { schema_version: 1, id: "run-alias", candidate_set_revision: contentHash("candidate-set"), candidate_occurrence_ids: ["occ-alias"], source_revisions: [{ source_id: sourceId, revision: contentHash(officialContent) }], policy_revision: contentHash("fact-review-strict-v1"), status: "completed" as const, created_by: "fact-reviewer-1", created_at: now, completed_at: now };
    const decision = { schema_version: 1, id: "decision-alias", operation_id: "op-review", review_run_id: "run-alias", candidate_occurrence_id: "occ-alias", fact_id: "fact-alias", reviewer_identity: "fact-reviewer-1", decision: "accepted" as const, reason: "Exact quote.", evidence: [{ source_id: sourceId, source_revision_id: contentHash(officialContent), chunk_id: chunkId, chunk_hash: contentHash(officialContent), quote: officialContent }], candidate_revision: contentHash("candidate"), expected_projection_revision: contentHash("projection"), resulting_fact_revision: 2, created_at: now };
    const sources = [{ id: sourceId, candidate_id: "candidate-alias", title: "Official page", canonical_text: officialContent, original_hash: contentHash(officialContent), revision: contentHash(officialContent), media_type: "text/plain", created_at: now }];
    const chunks = [{ id: chunkId, source_id: sourceId, ordinal: 0, text: officialContent, hash: contentHash(officialContent), created_at: now }];
    await repository.commit(0, (state) => ({
      ...state,
      project_status: "ready",
      interview: { ...state.interview, status: "complete", flow: "source_adaptation" },
      artifacts: [blueprint, characterArtifact],
      sources,
      knowledge_chunks: chunks,
      facts: baseFacts,
      fact_review_runs: [run],
      fact_review_decisions: [decision],
      reviews: [{ id: "review-alias", artifact_id: characterArtifact.id, artifact_revision: characterArtifact.revision, reviewer: "critic", status: "passed" as const, issue_ids: [], created_at: now }],
      operations: [operation("op-publish")],
    }));
    await repository.commit((await repository.read()).revision, (state) => ({
      ...state,
      facts: [{ ...state.facts[0]!, subject: "Someone Else", entity_refs: [], statement: "Someone Else has_trait direct." }],
    }));
    const result = validateWorkflow(await repository.read(), "publish");
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics.map((item) => item.code)).not.toContain("FACT_COVERAGE_INCOMPLETE");
  });


  it("treats user-provided evidence as proven without source references", async () => {
    const repository = new MemoryProjectRepository("user-evidence");
    const characterArtifact = artifact("character-ue", "character:demo", "character", "Demo", character());
    await repository.commit(0, (state) => ({
      ...state,
      project_status: "ready",
      interview: { ...state.interview, status: "complete", flow: "character" },
      artifacts: [characterArtifact],
      facts: [
        { id: "fact-user", statement: "Yukino 是我的原創角色", status: "accepted" as const, confidence: 1, source_ids: [], evidence: ["user provided"], created_at: now, updated_at: now, created_by: "curator" },
        { id: "fact-regular", statement: "Yukino is direct", status: "accepted" as const, confidence: 0.7, source_ids: [], evidence: ["plain quote"], created_at: now, updated_at: now, created_by: "curator" },
      ],
      reviews: [{ id: "review-ue", artifact_id: characterArtifact.id, artifact_revision: characterArtifact.revision, reviewer: "critic", status: "passed" as const, issue_ids: [], created_at: now }],
      operations: [operation("op-ue")],
    }));
    const result = validateWorkflow(await repository.read(), "publish");
    const provenance = result.diagnostics.find((item) => item.code === "FACT_PROVENANCE_MISSING");
    expect(provenance).toBeDefined();
    expect(provenance!.fact_ids).toEqual(["fact-regular"]);
  });

  it("treats rejected research candidates as resolved", async () => {
    const repository = new MemoryProjectRepository("rejected-research");
    const research = artifact("research-r", "source_research:one", "source_research", "one", { candidates: [{ title: "Rejected page", url: "https://rejected.example/page", official: true }], allowed_domains: ["rejected.example"] });
    await repository.commit(0, (state) => ({
      ...state,
      project_status: "ready",
      interview: { ...state.interview, status: "complete", flow: "character" },
      artifacts: [research],
      candidates: [{ id: "candidate-rejected", title: "Rejected page", url: "https://rejected.example/page", official: true, status: "rejected" as const }],
      operations: [operation("op-r")],
    }));
    const result = validateWorkflow(await repository.read(), "publish");
    expect(result.diagnostics.map((item) => item.code)).toEqual(expect.not.arrayContaining(["SOURCE_RESEARCH_NOT_INGESTED", "SOURCE_RESEARCH_OFFICIAL_REQUIRED"]));
  });

  it("still requires approved research candidates to be ingested", async () => {
    const repository = new MemoryProjectRepository("pending-research");
    const research = artifact("research-p", "source_research:one", "source_research", "one", { candidates: [{ title: "Pending page", url: "https://pending.example/page" }], allowed_domains: [] });
    await repository.commit(0, (state) => ({
      ...state,
      project_status: "ready",
      interview: { ...state.interview, status: "complete", flow: "character" },
      artifacts: [research],
      candidates: [{ id: "candidate-approved", title: "Pending page", url: "https://pending.example/page", status: "approved" as const }],
      operations: [operation("op-p")],
    }));
    const result = validateWorkflow(await repository.read(), "publish");
    expect(result.diagnostics.map((item) => item.code)).toContain("SOURCE_RESEARCH_NOT_INGESTED");
  });

  it("flags artifacts authored against an outdated Blueprint revision", async () => {
    const repository = new MemoryProjectRepository("stale-binding");
    const precheck = { id: "precheck-current", schema_version: 1, project_id: "stale-binding", operation_id: "interview", collaboration_mode: "assisted", candidate_blueprint: { project_id: "stale-binding" }, candidate_blueprint_revision: contentHash("current"), checks: [{ subject_id: "demo", dimension: "character_core", uncertainty: "low", impact: "high", basis: "explicit", action: "preserve_explicit" }], status: "recorded" as const, created_at: new Date().toISOString(), created_by: "director" };
    const characterArtifact = artifact("character-stale", "character:demo", "character", "demo", { kind: "character", document: { schema_version: 1, id: "demo", display_name: "Demo", summary: "A character bound to an outdated blueprint." } });
    const bound = { ...characterArtifact, blueprint_precheck_id: precheck.id, blueprint_precheck_revision: contentHash("old") };
    await repository.commit(0, (state) => ({
      ...state,
      project_status: "ready",
      interview: { ...state.interview, status: "complete", flow: "character" },
      artifacts: [bound],
      blueprint_prechecks: [precheck],
      reviews: [{ id: "review-stale", artifact_id: bound.id, artifact_revision: bound.revision, reviewer: "critic", status: "passed", issue_ids: [], created_at: new Date().toISOString() }],
      operations: [operation("op-stale")],
    }));
    const result = validateWorkflow(await repository.read(), "publish");
    expect(result.diagnostics.find((item) => item.code === "BLUEPRINT_BINDING_STALE")).toMatchObject({ severity: "error", artifact_ids: [bound.id] });
  });

  it("passes artifacts bound to the current Blueprint revision", async () => {
    const repository = new MemoryProjectRepository("fresh-binding");
    const precheck = { id: "precheck-current", schema_version: 1, project_id: "fresh-binding", operation_id: "interview", collaboration_mode: "assisted", candidate_blueprint: { project_id: "fresh-binding" }, candidate_blueprint_revision: contentHash("current"), checks: [{ subject_id: "demo", dimension: "character_core", uncertainty: "low", impact: "high", basis: "explicit", action: "preserve_explicit" }], status: "recorded" as const, created_at: new Date().toISOString(), created_by: "director" };
    const characterArtifact = artifact("character-fresh", "character:demo", "character", "demo", { kind: "character", document: { schema_version: 1, id: "demo", display_name: "Demo", summary: "A character bound to the current blueprint." } });
    const bound = { ...characterArtifact, blueprint_precheck_id: precheck.id, blueprint_precheck_revision: precheck.candidate_blueprint_revision };
    await repository.commit(0, (state) => ({
      ...state,
      project_status: "ready",
      interview: { ...state.interview, status: "complete", flow: "character" },
      artifacts: [bound],
      blueprint_prechecks: [precheck],
      reviews: [{ id: "review-fresh", artifact_id: bound.id, artifact_revision: bound.revision, reviewer: "critic", status: "passed", issue_ids: [], created_at: new Date().toISOString() }],
      operations: [operation("op-fresh")],
    }));
    const result = validateWorkflow(await repository.read(), "publish");
    expect(result.diagnostics.map((item) => item.code)).not.toContain("BLUEPRINT_BINDING_STALE");
  });

  it("binds the required-artifact manifest to the newest revision of a character", async () => {
    const repository = new MemoryProjectRepository("manifest-latest");
    const precheck = { id: "precheck-latest", schema_version: 1, project_id: "manifest-latest", operation_id: "interview", collaboration_mode: "assisted", candidate_blueprint: { project_id: "manifest-latest", characters: [{ id: "demo", label: "Demo", ordinal: 1, mode: "zhuji" }] }, candidate_blueprint_revision: contentHash("current"), checks: [{ subject_id: "demo", dimension: "character_core", uncertainty: "low", impact: "high", basis: "explicit", action: "preserve_explicit" }], status: "recorded" as const, created_at: new Date().toISOString(), created_by: "director" };
    const blueprint = artifact("blueprint-latest", "blueprint:manifest", "blueprint", "Manifest", { kind: "blueprint", flow: "character", characters: [{ id: "demo", label: "Demo", ordinal: 1, mode: "zhuji" }] }, "director", "interview");
    const boundBlueprint = { ...blueprint, blueprint_precheck_id: precheck.id, blueprint_precheck_revision: precheck.candidate_blueprint_revision };
    const oldRevision = artifact("character-old", "character:demo", "character", "Demo", character());
    const newRevision = artifact("character-new", "character:demo", "character", "Demo", { ...character(), document: { ...character().document, summary: "A complete character, revised." } });
    await repository.commit(0, (state) => ({
      ...state,
      project_status: "ready",
      interview: { ...state.interview, status: "complete", flow: "character" },
      artifacts: [oldRevision, newRevision, boundBlueprint],
      blueprint_prechecks: [precheck],
      operations: [operation("op-manifest")],
    }));
    const manifest = buildRequiredArtifactManifest(await repository.read());
    expect(manifest?.in_scope_artifact_ids).toContain(newRevision.id);
    expect(manifest?.in_scope_artifact_ids).not.toContain(oldRevision.id);
  });

  it("does not require reviews for world lore excluded by the build plan", async () => {
    const repository = new MemoryProjectRepository("plan-scope");
    const precheck = { id: "precheck-plan", schema_version: 1, project_id: "plan-scope", operation_id: "interview", collaboration_mode: "assisted", candidate_blueprint: { project_id: "plan-scope" }, candidate_blueprint_revision: contentHash("current"), checks: [{ subject_id: "demo", dimension: "character_core", uncertainty: "low", impact: "high", basis: "explicit", action: "preserve_explicit" }], status: "recorded" as const, created_at: new Date().toISOString(), created_by: "director" };
    const blueprint = artifact("blueprint-plan", "blueprint:plan", "blueprint", "Plan", { kind: "blueprint", flow: "character", characters: [{ id: "demo", label: "Demo", ordinal: 1, mode: "zhuji" }], world: { enabled: false } }, "director", "interview");
    const characterArtifact = artifact("character-plan", "character:demo", "character", "Demo", character());
    const boundCharacter = { ...characterArtifact, blueprint_precheck_id: precheck.id, blueprint_precheck_revision: precheck.candidate_blueprint_revision };
    const worldLore = artifact("world-plan", "world:unused", "world_lore", "unused", { kind: "world", entries: [{ schema_version: 1, id: "unused", category: "geography", title: "Unused", content: "Not part of the build plan." }] });
    await repository.commit(0, (state) => ({
      ...state,
      project_status: "ready",
      interview: { ...state.interview, status: "complete", flow: "character" },
      artifacts: [boundCharacter, worldLore, blueprint],
      blueprint_prechecks: [precheck],
      reviews: [{ id: "review-plan", artifact_id: boundCharacter.id, artifact_revision: boundCharacter.revision, reviewer: "critic", status: "passed", issue_ids: [], created_at: new Date().toISOString() }],
      operations: [operation("op-plan")],
    }));
    const result = validateWorkflow(await repository.read(), "publish");
    expect(result.diagnostics.map((item) => item.code)).not.toContain("ARTIFACT_REVIEW_REQUIRED");
    expect(result.diagnostics.map((item) => item.code)).not.toContain("BLUEPRINT_BINDING_STALE");
  });

  it("does not count historical greeting revisions toward primary coverage", async () => {
    const repository = new MemoryProjectRepository("greeting-current");
    const precheck = { id: "precheck-greeting", schema_version: 1, project_id: "greeting-current", operation_id: "interview", collaboration_mode: "assisted", candidate_blueprint: { project_id: "greeting-current", characters: [{ id: "demo", label: "Demo", ordinal: 1, mode: "zhuji" }] }, candidate_blueprint_revision: contentHash("current"), checks: [{ subject_id: "demo", dimension: "character_core", uncertainty: "low", impact: "high", basis: "explicit", action: "preserve_explicit" }], status: "recorded" as const, created_at: now, created_by: "director" };
    const target = artifact("character-g", "character:demo", "character", "demo", character("demo"));
    const oldGreeting = artifact("greeting-old", "greeting:greetings", "greeting", "greetings", { document: { greetings: [{ character_ids: ["demo"] }] } });
    const newGreeting = artifact("greeting-new", "greeting:greetings", "greeting", "greetings", { document: { greetings: [{ character_ids: ["other"] }] } });
    await repository.commit(0, (state) => ({
      ...state,
      project_status: "ready",
      interview: { ...state.interview, status: "complete", flow: "character" },
      blueprint_prechecks: [precheck],
      artifacts: [target, oldGreeting, newGreeting],
      operations: [operation("op-greeting")],
    }));
    const missing = buildRequiredArtifactManifest(await repository.read());
    expect(missing?.greeting.complete).toBe(false);
    expect(missing?.greeting.required).toBe(true);
    expect(missing?.diagnostics.map((item) => item.code)).toContain("REQUIRED_GREETING_MISSING");
    const coveringContent = JSON.stringify({ document: { greetings: [{ character_ids: ["demo"] }] } });
    await repository.commit((await repository.read()).revision, (state) => ({
      ...state,
      artifacts: state.artifacts.map((item) => (item.id === "greeting-new" ? { ...item, content: coveringContent, content_hash: contentHash(coveringContent), revision: contentHash(coveringContent) } : item)),
    }));
    const covered = buildRequiredArtifactManifest(await repository.read());
    expect(covered?.greeting.complete).toBe(true);
    expect(covered?.diagnostics.map((item) => item.code)).not.toContain("REQUIRED_GREETING_MISSING");
  });

  it("matches greeting coverage through the shared Blueprint entity matcher", async () => {
    const repository = new MemoryProjectRepository("greeting-exact");
    const precheck = { id: "precheck-exact", schema_version: 1, project_id: "greeting-exact", operation_id: "interview", collaboration_mode: "assisted", candidate_blueprint: { project_id: "greeting-exact", characters: [{ id: "momoka", label: "Momoka", aliases: ["桃華"], ordinal: 1, mode: "zhuji" }] }, candidate_blueprint_revision: contentHash("current"), checks: [{ subject_id: "momoka", dimension: "character_core", uncertainty: "low", impact: "high", basis: "explicit", action: "preserve_explicit" }], status: "recorded" as const, created_at: now, created_by: "director" };
    const target = artifact("character-momoka", "character:momoka", "character", "momoka", character("momoka"));
    const fuzzy = artifact("greeting-fuzzy", "greeting:greetings", "greeting", "greetings", { document: { greetings: [{ character_ids: ["momoka-2"] }] } });
    await repository.commit(0, (state) => ({
      ...state,
      project_status: "ready",
      interview: { ...state.interview, status: "complete", flow: "character" },
      blueprint_prechecks: [precheck],
      artifacts: [target, fuzzy],
      operations: [operation("op-exact")],
    }));
    const manifest = buildRequiredArtifactManifest(await repository.read());
    expect(manifest?.greeting.complete).toBe(false);
    expect(manifest?.diagnostics.map((item) => item.code)).toContain("REQUIRED_GREETING_MISSING");
    const normalizedContent = JSON.stringify({ document: { greetings: [{ character_ids: ["桃華"] }] } });
    await repository.commit((await repository.read()).revision, (state) => ({
      ...state,
      artifacts: state.artifacts.map((item) => (item.id === "greeting-fuzzy" ? { ...item, content: normalizedContent, content_hash: contentHash(normalizedContent), revision: contentHash(normalizedContent) } : item)),
    }));
    expect(buildRequiredArtifactManifest(await repository.read())?.greeting.complete).toBe(true);
  });

  it("flags a Blueprint character without a valid mode", async () => {
    const repository = new MemoryProjectRepository("mode-invalid");
    const precheck = { id: "precheck-mode", schema_version: 1, project_id: "mode-invalid", operation_id: "interview", collaboration_mode: "assisted", candidate_blueprint: { project_id: "mode-invalid", characters: [{ id: "demo", label: "Demo", ordinal: 1, mode: "hybrid" }] }, candidate_blueprint_revision: contentHash("current"), checks: [{ subject_id: "demo", dimension: "character_core", uncertainty: "low", impact: "high", basis: "explicit", action: "preserve_explicit" }], status: "recorded" as const, created_at: now, created_by: "director" };
    const target = artifact("character-mi", "character:demo", "character", "demo", character("demo"));
    await repository.commit(0, (state) => ({
      ...state,
      project_status: "ready",
      interview: { ...state.interview, status: "complete", flow: "character" },
      blueprint_prechecks: [precheck],
      artifacts: [target],
      operations: [operation("op-mode")],
    }));
    const manifest = buildRequiredArtifactManifest(await repository.read());
    expect(manifest?.diagnostics).toContainEqual(expect.objectContaining({ code: "BLUEPRINT_CHARACTER_MODE_INVALID", severity: "error" }));
  });

  it("recomputes module requirements and scope for the selected export mode", async () => {
    const repository = new MemoryProjectRepository("export-recompute");
    const precheck = { id: "precheck-export", schema_version: 1, project_id: "export-recompute", operation_id: "interview", collaboration_mode: "assisted", candidate_blueprint: { project_id: "export-recompute", characters: [{ id: "alpha", label: "Alpha", ordinal: 1, mode: "zhuji" }, { id: "beta", label: "Beta", ordinal: 2, mode: "palette" }] }, candidate_blueprint_revision: contentHash("current"), checks: [{ subject_id: "alpha", dimension: "character_core", uncertainty: "low", impact: "high", basis: "explicit", action: "preserve_explicit" }], status: "recorded" as const, created_at: now, created_by: "director" };
    const alphaCharacter = artifact("character-alpha", "character:alpha", "character", "alpha", character("alpha"));
    const betaCharacter = artifact("character-beta", "character:beta", "character", "beta", character("beta"));
    const zhujiModule = artifact("zhuji-alpha", "zhuji:alpha/appearance", "zhuji", "alpha/appearance", { kind: "zhuji", character_id: "alpha", module: { schema_version: 1, mode: "zhuji", module: "appearance", title: "Appearance", content: "Tall." } });
    const paletteModule = artifact("palette-beta", "palette:beta/basic_information", "palette", "beta/basic_information", { kind: "palette", character_id: "beta", module: { schema_version: 1, mode: "palette", module: "basic_information", title: "Basic", content: "Calm." } });
    await repository.commit(0, (state) => ({
      ...state,
      project_status: "ready",
      interview: { ...state.interview, status: "complete", flow: "character" },
      blueprint_prechecks: [precheck],
      artifacts: [alphaCharacter, betaCharacter, zhujiModule, paletteModule],
      operations: [operation("op-export")],
    }));
    const all = buildRequiredArtifactManifest(await repository.read());
    expect(all?.export_modes).toBe("both");
    expect(all?.characters.find((item) => item.character_id === "alpha")?.mode_complete).toBe(false);
    expect(all?.characters.find((item) => item.character_id === "beta")?.mode_complete).toBe(false);
    expect(all?.diagnostics.map((item) => item.code)).toContain("MODE_MODULES_INCOMPLETE");
    const zhujiOnly = buildRequiredArtifactManifest(await repository.read(), "zhuji");
    expect(zhujiOnly?.export_modes).toBe("zhuji");
    expect(zhujiOnly?.characters.find((item) => item.character_id === "alpha")?.mode_complete).toBe(false);
    const betaZhuji = zhujiOnly?.characters.find((item) => item.character_id === "beta");
    expect(betaZhuji?.mode_complete).toBe(true);
    expect(betaZhuji?.missing_modules).toEqual([]);
    expect(zhujiOnly?.in_scope_artifact_ids).not.toContain(paletteModule.id);
    expect(zhujiOnly?.diagnostics.map((item) => item.code)).toContain("MODE_MODULES_INCOMPLETE");
  });

  it("uses an overridden manifest for the publish gate", async () => {
    const repository = new MemoryProjectRepository("gate-override");
    const precheck = { id: "precheck-override", schema_version: 1, project_id: "gate-override", operation_id: "interview", collaboration_mode: "assisted", candidate_blueprint: { project_id: "gate-override", characters: [{ id: "demo", label: "Demo", ordinal: 1, mode: "zhuji" }] }, candidate_blueprint_revision: contentHash("current"), checks: [{ subject_id: "demo", dimension: "character_core", uncertainty: "low", impact: "high", basis: "explicit", action: "preserve_explicit" }], status: "recorded" as const, created_at: now, created_by: "director" };
    const target = artifact("character-go", "character:demo", "character", "demo", character("demo"));
    await repository.commit(0, (state) => ({
      ...state,
      project_status: "ready",
      interview: { ...state.interview, status: "complete", flow: "character" },
      blueprint_prechecks: [precheck],
      artifacts: [target],
      operations: [operation("op-go")],
    }));
    const base = buildRequiredArtifactManifest(await repository.read());
    expect(base).toBeDefined();
    const overridden = {
      ...base!,
      diagnostics: [{ code: "BLUEPRINT_CHARACTER_MODE_INVALID" as const, severity: "error" as const, message: "Blueprint character demo must declare a valid mode: zhuji or palette." }],
    };
    const result = validateWorkflow(await repository.read(), "publish", overridden);
    expect(result.diagnostics.map((item) => item.code)).toContain("BLUEPRINT_CHARACTER_MODE_INVALID");
  });

  it("infers the only available mode into the build plan when no blueprint exists", async () => {
    const timestamp = new Date().toISOString();
    const moduleArtifact = (id: string, kind: "zhuji" | "palette", module: string): ArtifactRecord => ({
      id,
      key: `${kind}:demo/${module}`,
      kind,
      name: `${kind}/${module}`,
      content: JSON.stringify({ kind, character_id: "demo", module: { schema_version: 1, mode: kind, module, title: module, data: {} } }),
      media_type: "application/json",
      content_hash: contentHash(id),
      revision: contentHash(id),
      status: "draft",
      created_at: timestamp,
      updated_at: timestamp,
      created_by: "test",
      operation_id: "op",
    });
    const zhujiOnly = new MemoryProjectRepository("plan-single-zhuji");
    await zhujiOnly.commit(0, (state) => ({
      ...state,
      artifacts: [moduleArtifact("zhuji-1", "zhuji", "basic_information")],
    }));
    const zhujiPlan = computeBuildPlan(await zhujiOnly.read(), undefined, { inferMode: true });
    expect(zhujiPlan.mode_selection).toBe("zhuji");
    expect(zhujiPlan.entries.map((entry) => entry.kind)).toEqual(["zhuji"]);

    const paletteOnly = new MemoryProjectRepository("plan-single-palette");
    await paletteOnly.commit(0, (state) => ({
      ...state,
      artifacts: [moduleArtifact("palette-1", "palette", "personality_palette")],
    }));
    const palettePlan = computeBuildPlan(await paletteOnly.read(), undefined, { inferMode: true });
    expect(palettePlan.mode_selection).toBe("palette");
    expect(palettePlan.entries.map((entry) => entry.kind)).toEqual(["palette"]);

    const both = new MemoryProjectRepository("plan-both-modes");
    await both.commit(0, (state) => ({
      ...state,
      artifacts: [moduleArtifact("zhuji-1", "zhuji", "basic_information"), moduleArtifact("palette-1", "palette", "personality_palette")],
    }));
    const bothPlan = computeBuildPlan(await both.read(), undefined, { inferMode: true });
    expect(bothPlan.mode_selection).toBeUndefined();
    expect(bothPlan.entries.every((entry) => entry.kind !== "zhuji" && entry.kind !== "palette")).toBe(true);
  });
});
