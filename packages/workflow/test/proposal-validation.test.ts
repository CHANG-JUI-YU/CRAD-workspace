import { computeRevision, initializeProject, loadAuthorProject } from "@card-workspace/project";
import {
  projectManifestSchema,
  proposalSchema,
  type Proposal,
  type WorkflowTask,
} from "@card-workspace/schemas";
import { makeTemporaryWorkspace } from "@card-workspace/testing";
import { afterEach, describe, expect, it } from "vitest";

import { deriveProposalTargets, validateProposal } from "../src/index.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => Promise.all(cleanups.splice(0).map((cleanup) => cleanup())));

async function fixture() {
  const workspace = await makeTemporaryWorkspace();
  cleanups.push(workspace.cleanup);
  await initializeProject({
    projectsRoot: workspace.projectsRoot,
    manifest: projectManifestSchema.parse({
      schema_version: 1,
      id: "validation-demo",
      title: "Validation",
      kind: "character_card",
      card: { name: "Validation" },
      characters: [
        { id: "alice", display_name: "Alice", mode: "zhuji", role: "primary" },
        { id: "bob", display_name: "Bob", mode: "palette", role: "supporting" },
      ],
    }),
  });
  const project = await loadAuthorProject(workspace.projectsRoot, "validation-demo");
  if (!project.workflow || !project.manifest || !project.blueprint || !project.greetings) {
    throw new Error("fixture project incomplete");
  }
  return project;
}

function task(overrides: Partial<WorkflowTask> = {}): WorkflowTask {
  return {
    id: "task-1",
    kind: "proposal",
    status: "pending",
    assigned_agent: "creator",
    capabilities: ["author-write"],
    input_artifacts: [],
    output_contract: "proposal@1",
    dependencies: [],
    attempt: 0,
    max_attempts: 2,
    extensions: {},
    ...overrides,
  };
}

function proposal(value: Proposal["value"], overrides: Partial<Proposal> = {}): Proposal {
  return proposalSchema.parse({
    schema_version: 1,
    id: "proposal-1",
    owner: "creator",
    base_workflow_revision: 0,
    value,
    ...overrides,
  });
}

function structuredTraitDialogue() {
  const corpus = "這是一段只由角色本人直接說出的完整長篇語料，用來固定她在特定人格特質下的語速、詞彙、情緒濃度與攻防方式，不包含動作、神態、場景旁白或第三人稱心理分析，並刻意延伸到足夠長度以通過一百個 Unicode 字元的最低限制，讓後續角色扮演能穩定模仿。";
  return {
    schema_version: 1 as const, mode: "zhuji" as const, module: "trait_dialogue" as const, title: "特質語料",
    data: {
      人物說話節奏: "節奏",
      人物語言習慣: { 自稱: "我", 口頭禪: "嗯", 特殊詞彙偏好: "直白", 方言痕跡: "無", 語氣助詞使用: "少", 語言情感程度: "高", 用詞程度選擇: "具體" },
      扮演關鍵要點: ["維持聲線"],
      Traits: Array.from({ length: 5 }, (_, index) => ({ Trait_Name: `特質${index}`, Embodiments: ["定義"], instant: [corpus, corpus, corpus], Results: ["結果"] })),
    },
  };
}

function expectCode(operation: () => unknown, code: string): void {
  try {
    operation();
    throw new Error(`expected workflow error ${code}`);
  } catch (error: unknown) {
    expect(error).toMatchObject({ code });
  }
}

describe("proposal ownership", () => {
  it("推導所有可寫 proposal 類型的固定路徑", async () => {
    const project = await fixture();
    const blueprint = proposal({ kind: "blueprint", document: project.blueprint! });
    const character = proposal({ kind: "character", document: project.characters[0]!.document });
    const zhuji = proposal({ kind: "zhuji", character_id: "alice", module: structuredTraitDialogue() });
    const palette = proposal({ kind: "palette", character_id: "bob", module: project.characters[1]!.modules[0]! });
    const world = proposal({ kind: "world", entries: [
      { schema_version: 1, id: "capital", category: "geography", title: "Capital", content: "City", related_ids: [] },
    ] });
    const greetings = proposal({ kind: "greetings", document: project.greetings! });
    const analysis = proposal({ kind: "import_analysis", mappings: [], losses: [], recommendations: [] });

    expect(deriveProposalTargets(task(), blueprint, project)[0]?.relativePath).toBe("blueprint.yaml");
    expect(deriveProposalTargets(task(), character, project)[0]?.relativePath).toBe("characters/alice/character.yaml");
    expect(deriveProposalTargets(task(), zhuji, project)[0]?.relativePath).toContain("/zhuji/");
    expect(deriveProposalTargets(task(), palette, project)[0]?.relativePath).toContain("/palette/");
    expect(deriveProposalTargets(task(), world, project)[0]?.relativePath).toBe("world/geography/capital.yaml");
    expect(deriveProposalTargets(task(), greetings, project)[0]?.relativePath).toBe("greetings.yaml");
    expect(deriveProposalTargets(task(), analysis, project)).toEqual([]);
  });

  it("拒絕 contract、owner、Critic、kind 與 character ownership 越權", async () => {
    const project = await fixture();
    const value = proposal({ kind: "zhuji", character_id: "alice", module: structuredTraitDialogue() });
    expectCode(() => deriveProposalTargets(task(), value, { manifest: undefined }), "PROPOSAL_PROJECT_INVALID");
    expectCode(() => deriveProposalTargets(task({ output_contract: "audit@1" }), value, project), "PROPOSAL_TASK_CONTRACT_MISMATCH");
    expectCode(() => deriveProposalTargets(task({ assigned_agent: "other" }), value, project), "PROPOSAL_OWNER_MISMATCH");
    expectCode(() => deriveProposalTargets(task({ assigned_agent: "creator-critic" }), proposal(value.value, { owner: "creator-critic" }), project), "PROPOSAL_CRITIC_READ_ONLY");
    expectCode(() => deriveProposalTargets(task({ capabilities: ["review"] }), value, project), "PROPOSAL_CRITIC_READ_ONLY");
    expectCode(() => deriveProposalTargets(task({ extensions: { output_kind: "world" } }), value, project), "PROPOSAL_OUTPUT_KIND_MISMATCH");
    expectCode(() => deriveProposalTargets(task({ extensions: { character_id: "bob" } }), value, project), "PROPOSAL_CHARACTER_OWNERSHIP_DENIED");
    expectCode(() => deriveProposalTargets(task({ extensions: { module: "appearance" } }), value, project), "PROPOSAL_MODULE_OWNERSHIP_DENIED");
  });

  it("拒絕未知角色、錯誤 active mode、未知模組、world category 與 conversion", async () => {
    const project = await fixture();
    const character = proposal({ kind: "character", document: { ...project.characters[0]!.document, id: "nobody" } });
    expectCode(() => deriveProposalTargets(task(), character, project), "PROPOSAL_CHARACTER_UNKNOWN");

    const wrongMode = proposal({ kind: "palette", character_id: "alice", module: project.characters[1]!.modules[0]! });
    expectCode(() => deriveProposalTargets(task(), wrongMode, project), "PROPOSAL_MODE_MISMATCH");

    const unknownModule = {
      ...proposal({ kind: "zhuji", character_id: "alice", module: structuredTraitDialogue() }),
      value: {
        kind: "zhuji", character_id: "alice",
        module: { ...structuredTraitDialogue(), module: "basic_information" },
      },
    } as unknown as Proposal;
    expectCode(() => deriveProposalTargets(task(), unknownModule, project), "PROPOSAL_MODULE_UNKNOWN");

    const world = proposal({ kind: "world", entries: [
      { schema_version: 1, id: "guild", category: "organizations", title: "Guild", content: "Guild", related_ids: [] },
    ] });
    expectCode(() => deriveProposalTargets(task({ extensions: { world_category: "geography" } }), world, project), "PROPOSAL_WORLD_OWNERSHIP_DENIED");
    expectCode(() => deriveProposalTargets(task({ extensions: { world_category: "organizations", world_entry_id: "company" } }), world, project), "PROPOSAL_WORLD_OWNERSHIP_DENIED");

    const conversion = proposal({
      kind: "conversion", character_id: "alice", source_mode: "zhuji", target_mode: "palette",
      modules: project.characters[1]!.modules,
      mappings: [{ source: "appearance", target: "basic_information", summary: "map" }],
    });
    expectCode(() => deriveProposalTargets(task(), conversion, project), "PROPOSAL_CONVERSION_SERVICE_REQUIRED");
  });
});

describe("proposal validation", () => {
  it("拒絕 schema、workflow revision、Blueprint project 與 reference 錯誤", async () => {
    const project = await fixture();
    expectCode(() => validateProposal({ task: task(), proposal: {}, project }), "PROPOSAL_SCHEMA_INVALID");
    const valid = proposal({ kind: "blueprint", document: project.blueprint! });
    expectCode(() => validateProposal({ task: task(), proposal: { ...valid, base_workflow_revision: 9 }, project }), "PROPOSAL_WORKFLOW_REVISION_CONFLICT");
    expectCode(() => validateProposal({ task: task(), proposal: valid, project: { ...project, workflow: undefined } }), "PROPOSAL_WORKFLOW_REVISION_CONFLICT");

    const wrongProject = proposal({ kind: "blueprint", document: { ...project.blueprint!, project_id: "other" } });
    expectCode(() => validateProposal({ task: task(), proposal: wrongProject, project }), "PROPOSAL_PROJECT_ID_MISMATCH");
    const changedCollaboration = proposal({ kind: "blueprint", document: { ...project.blueprint!, collaboration_mode: "assisted" } });
    expectCode(() => validateProposal({ task: task(), proposal: changedCollaboration, project }), "PROPOSAL_COLLABORATION_MODE_MISMATCH");
    const missingCharacter = proposal({
      kind: "blueprint",
      document: {
        ...project.blueprint!,
        characters: [...project.blueprint!.characters, { ...project.blueprint!.characters[0]!, id: "nobody" }],
      },
    });
    expectCode(() => validateProposal({ task: task(), proposal: missingCharacter, project }), "PROPOSAL_REFERENCE_MISSING");
  });

  it("assisted Blueprint 必須有相同候選 revision 的預檢紀錄", async () => {
    const project = await fixture();
    const candidate = { ...project.blueprint!, collaboration_mode: "assisted" as const };
    const assistedProject = { ...project, blueprint: candidate };
    const candidateProposal = proposal({ kind: "blueprint", document: candidate });
    expectCode(() => validateProposal({ task: task(), proposal: candidateProposal, project: assistedProject }), "BLUEPRINT_PRECHECK_REQUIRED");
    const precheckedTask = task({
      blueprint_precheck: {
        schema_version: 1,
        candidate_blueprint_revision: computeRevision(candidate),
        recorded_at: "2026-07-14T10:00:00Z",
        checks: [{
          subject_id: "alice", dimension: "character_core", uncertainty: "low", impact: "high",
          basis: "intake 已明確提供", action: "preserve_explicit",
        }],
      },
    });
    expect(validateProposal({ task: precheckedTask, proposal: candidateProposal, project: assistedProject }).proposal.value.kind).toBe("blueprint");
    const changedCandidate = proposal({ kind: "blueprint", document: { ...candidate, purpose: `${candidate.purpose} changed` } });
    expectCode(() => validateProposal({ task: precheckedTask, proposal: changedCandidate, project: assistedProject }), "BLUEPRINT_PRECHECK_REVISION_MISMATCH");
  });

  it("拒絕 character、greetings 與 world 的懸空 reference", async () => {
    const project = await fixture();
    const renamed = proposal({ kind: "character", document: { ...project.characters[0]!.document, display_name: "Other" } });
    expectCode(() => validateProposal({ task: task(), proposal: renamed, project }), "PROPOSAL_CHARACTER_NAME_MISMATCH");
    const relationship = proposal({
      kind: "character",
      document: { ...project.characters[0]!.document, relationships: [{ target_id: "nobody", summary: "unknown" }] },
    });
    expectCode(() => validateProposal({ task: task(), proposal: relationship, project }), "PROPOSAL_REFERENCE_MISSING");
    const greetings = proposal({
      kind: "greetings",
      document: { ...project.greetings!, greetings: [{ ...project.greetings!.greetings[0]!, character_ids: ["nobody"] }] },
    });
    expectCode(() => validateProposal({ task: task(), proposal: greetings, project }), "PROPOSAL_REFERENCE_MISSING");
    const world = proposal({ kind: "world", entries: [
      { schema_version: 1, id: "capital", category: "geography", title: "Capital", content: "City", related_ids: ["nobody"] },
    ] });
    expectCode(() => validateProposal({ task: task(), proposal: world, project }), "PROPOSAL_REFERENCE_MISSING");
  });

  it("要求 fact accepted、有證據，並阻擋 single-value unresolved conflict", async () => {
    const project = await fixture();
    const factProposal = proposal({ kind: "world", entries: [{
      schema_version: 1,
      id: "capital",
      category: "geography",
      title: "Capital",
      content: "City",
      related_ids: [],
      provenance: [{ kind: "fact", ref: "fact-one", requires_single_value: true, extensions: {} }],
      extensions: { fact_refs: ["fact-one"] },
    }] });
    expectCode(() => validateProposal({ task: task(), proposal: factProposal, project }), "PROPOSAL_FACT_NOT_ACCEPTED");

    const baseFact = {
      id: "fact-one", status: "accepted", classification: "source_fact", evidence: [],
    };
    const withFact = { ...project, factRegister: { facts: [baseFact] } } as typeof project;
    expectCode(() => validateProposal({ task: task(), proposal: factProposal, project: withFact }), "PROPOSAL_FACT_EVIDENCE_INCOMPLETE");

    const creative = {
      ...project,
      factRegister: { facts: [{ ...baseFact, classification: "creative_completion" }] },
      conflictRegister: {
        conflicts: [{ status: "open", members: [{ fact_id: "fact-one" }, { fact_id: "fact-two" }] }],
      },
    } as typeof project;
    expectCode(() => validateProposal({ task: task(), proposal: factProposal, project: creative }), "PROPOSAL_FACT_CONFLICT_UNRESOLVED");
    expect(validateProposal({
      task: task(), proposal: factProposal,
      project: { ...creative, conflictRegister: { conflicts: [{ ...creative.conflictRegister!.conflicts[0]!, status: "resolved" }] } } as typeof project,
    }).targets).toHaveLength(1);
  });
});
