import { describe, expect, it } from "vitest";

import {
  parsePolicyProfile,
  parseProjectManifest,
  parseWorkflowState,
  lorebookV3Schema,
  policyProfileSchema,
  projectManifestSchema,
  blueprintSchema,
  htmlSourceSchema,
  pluginContributionsSchema,
  pluginRevisionIntentSchema,
  mvuSourceSchema,
  safeParsePolicyProfile,
  safeParseProjectManifest,
  safeParseWorkflowState,
  validateSchema,
  workflowStateV1Schema,
} from "../src/index.js";

const validManifest = {
  schema_version: 1,
  id: "demo-project",
  title: "示範專案",
  kind: "character_card",
  characters: [
    { id: "alice", display_name: "愛麗絲", mode: "zhuji", role: "primary" },
    { id: "bob", display_name: "鮑伯", mode: "palette", role: "supporting" },
  ],
  card: { name: "示範角色卡", profile: "minimal_worldbook", avatar: "assets/avatar.png" },
};

describe("projectManifestSchema", () => {
  it("接受同一專案中不同角色採用不同模式", () => {
    const result = projectManifestSchema.safeParse(validManifest);
    expect(result.success).toBe(true);
  });

  it("拒絕同一角色 ID 被重複宣告", () => {
    const result = projectManifestSchema.safeParse({
      ...validManifest,
      characters: [validManifest.characters[0], validManifest.characters[0]],
    });
    expect(result.success).toBe(false);
  });

  it("拒絕未知根欄位，擴充必須放入 extensions", () => {
    const result = projectManifestSchema.safeParse({ ...validManifest, surprise: true });
    expect(result.success).toBe(false);
  });

  it("允許空角色 worldbook，並拒絕角色卡空角色或 worldbook 角色", () => {
    expect(projectManifestSchema.safeParse({
      ...validManifest,
      kind: "worldbook",
      characters: [],
    }).success).toBe(true);
    expect(projectManifestSchema.safeParse({ ...validManifest, characters: [] }).success).toBe(false);
    expect(projectManifestSchema.safeParse({ ...validManifest, kind: "worldbook" }).success).toBe(false);
  });
});

describe("authoring plugin schemas", () => {
  const implementation = {
    version: "1.0.0",
    digest: `sha256:${"a".repeat(64)}`,
    asset_manifest_id: "sillytavern-assets",
    asset_manifest_revision: `sha256:${"b".repeat(64)}`,
    asset_manifest_hash: `sha256:${"c".repeat(64)}`,
  };

  it("只允許 character_card Blueprint 啟用 plugins", () => {
    const result = blueprintSchema.safeParse({
      schema_version: 1,
      project_id: "demo-project",
      project_kind: "worldbook",
      purpose: "worldbook",
      characters: [],
      world: { enabled: true, categories: [] },
      greetings: { enabled: false, character_ids: [], requirements: [] },
      plugins: [{ plugin_id: "official.mvu-zod", capabilities: ["mvu"] }],
    });
    expect(result.success).toBe(false);
  });

  it("驗證 typed MVU source 與安全 HTML source", () => {
    expect(mvuSourceSchema.parse({
      schema_version: 1,
      plugin_id: "official.mvu-zod",
      project_kind: "character_card",
      implementation,
      variables: [{ name: "mood", type: "string", default: "calm", writable: true }],
    }).variables[0]?.name).toBe("mood");

    expect(htmlSourceSchema.safeParse({
      schema_version: 1,
      plugin_id: "official.html",
      project_kind: "character_card",
      implementation,
      features: ["status_bar"],
      components: [{
        id: "status",
        feature: "status_bar",
        tag: "section",
        label: "Status",
        text: [{ kind: "text", value: "Mood" }],
        binding_paths: ["/mood"],
      }],
    }).success).toBe(true);
  });

  it("拒絕 worldbook intent 與 malformed contribution", () => {
    expect(pluginRevisionIntentSchema.safeParse({
      schema_version: 1,
      project_id: "demo-project",
      revision: `sha256:${"d".repeat(64)}`,
      project_kind: "worldbook",
      base_selection_revision: "absent",
      selections: [{ plugin_id: "official.ejs", capabilities: ["ejs"] }],
      dependency_closure: ["official.ejs", "official.mvu-zod"],
      implementation_pins: [
        { plugin_id: "official.ejs", implementation },
        { plugin_id: "official.mvu-zod", implementation },
      ],
    }).success).toBe(false);
    expect(pluginContributionsSchema.safeParse({
      schema_version: 1,
      plugin_id: "official.ejs",
      implementation,
      artifact_revision: `sha256:${"e".repeat(64)}`,
      lore_entries: [],
      regex_scripts: [{
        scriptName: "bad",
        findRegex: "x",
        replaceString: "y",
        trimStrings: [],
        placement: [],
        disabled: false,
        markdownOnly: false,
        promptOnly: false,
        runOnEdit: false,
        substituteRegex: false,
        unexpected: true,
      }],
      helper_scripts: [],
      greeting_operations: [],
      metadata: {},
    }).success).toBe(false);
  });

  it("要求 revision intent 固定選擇、依賴閉包與 implementation pins", () => {
    const result = pluginRevisionIntentSchema.safeParse({
      schema_version: 1,
      project_id: "demo-project",
      revision: `sha256:${"e".repeat(64)}`,
      project_kind: "character_card",
      base_selection_revision: "absent",
      selections: [
        { plugin_id: "official.ejs", capabilities: ["ejs"] },
      ],
      dependency_closure: ["official.ejs", "official.mvu-zod"],
      implementation_pins: [
        { plugin_id: "official.ejs", implementation },
        { plugin_id: "official.mvu-zod", implementation },
      ],
    });
    expect(result.success).toBe(true);
    expect(pluginRevisionIntentSchema.safeParse({
      ...(result.success ? result.data : {}),
      implementation_pins: [{ plugin_id: "official.ejs", implementation }],
    }).success).toBe(false);
  });
});

describe("lorebookV3Schema", () => {
  it("以 lorebook_v3 明確區別 standalone worldbook 與角色卡", () => {
    const worldbook = lorebookV3Schema.parse({
      spec: "lorebook_v3",
      data: { name: "世界", extensions: {}, entries: [] },
    });
    expect(worldbook.spec).toBe("lorebook_v3");
    expect(lorebookV3Schema.safeParse({ spec: "chara_card_v3", data: worldbook.data }).success).toBe(false);
  });
});

describe("workflowStateSchema", () => {
  it("要求 artifact revision 為 sha256", () => {
    const result = workflowStateV1Schema.safeParse({
      schema_version: 1,
      project_id: "demo-project",
      stage: "drafting",
      revision: 2,
      artifacts: {
        blueprint: {
          status: "approved",
          revision: "not-a-hash",
          updated_at: "2026-07-13T10:00:00+08:00",
        },
      },
    });
    expect(result.success).toBe(false);
  });
});

describe("policyProfileSchema", () => {
  it("保留三層規則來源，不把 workspace policy 冒充規格", () => {
    const result = policyProfileSchema.parse({
      schema_version: 1,
      id: "workspace-default",
      rules: [
        { id: "ccv3.shape", layer: "normative", severity: "error" },
        { id: "st.position", layer: "compatibility", severity: "warning" },
        { id: "workspace.empty-description", layer: "workspace", severity: "error" },
      ],
    });
    expect(result.rules.map((rule) => rule.layer)).toEqual([
      "normative",
      "compatibility",
      "workspace",
    ]);
  });
});

describe("stable IDs and extensions", () => {
  it.each(["", ".", "..", "a/b", "a\\b", "control\u0000id"])(
    "拒絕不安全 ID %j",
    (id) => {
      expect(projectManifestSchema.safeParse({ ...validManifest, id }).success).toBe(false);
    },
  );

  it("未知 JSON extensions 可完整往返", () => {
    const extensions = { vendor: { nested: [1, true, null, "字串"] } };
    const result = projectManifestSchema.parse({ ...validManifest, extensions });
    expect(result.extensions).toEqual(extensions);
  });
});

describe("validateSchema", () => {
  it("將全部 schema issue 轉成結構化診斷", () => {
    const result = validateSchema(projectManifestSchema, {}, { file: "project.yaml" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.length).toBeGreaterThan(1);
      expect(result.diagnostics[0]?.location?.file).toBe("project.yaml");
    }
  });

  it("提供三種 Foundation 文件的 parse 與 safeParse API", () => {
    const workflow = {
      schema_version: 2,
      project_id: "demo-project",
      workflow_definition_id: "original-v1",
      entry_kind: "original",
      revision: 0,
      stage: "intake",
      artifacts: [],
      gates: [],
      tasks: [],
      decisions: [],
    };
    const policy = { schema_version: 1, id: "default", rules: [] };
    expect(parseProjectManifest(validManifest).id).toBe("demo-project");
    expect(parseWorkflowState(workflow).revision).toBe(0);
    expect(parsePolicyProfile(policy).id).toBe("default");
    expect(safeParseProjectManifest(validManifest).ok).toBe(true);
    expect(safeParseWorkflowState({}).ok).toBe(false);
    expect(safeParsePolicyProfile({}).ok).toBe(false);
  });
});
