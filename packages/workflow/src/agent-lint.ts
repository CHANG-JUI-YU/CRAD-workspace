import { readFile, readdir, stat } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

import {
  registeredContractReferences,
  type AgentDefinition,
  type Diagnostic,
  type DiagnosticReport,
} from "@card-workspace/schemas";

import { loadWorkflowConfig, WorkflowConfigError, type WorkflowConfig } from "./config-loader.js";

interface ToolInvariant {
  mutation: boolean;
  requiresTask: boolean;
  requiresGate?: "publish";
}

const readTool = { mutation: false, requiresTask: false } as const;
const taskReadTool = { mutation: false, requiresTask: true } as const;
const mutationTool = { mutation: true, requiresTask: false } as const;
const taskMutationTool = { mutation: true, requiresTask: true } as const;
const workspaceCapabilities = new Set(["workspace.initialize", "workspace.discover"]);

export const TOOL_REGISTRY: Readonly<Record<string, ToolInvariant>> = Object.freeze({
  workflow_start: mutationTool,
  workflow_status: readTool,
  project_artifact_list: readTool,
  project_artifact_read: readTool,
  workflow_advance: mutationTool,
  world_authoring_begin: mutationTool,
  world_revision_begin: mutationTool,
  greetings_revision_begin: mutationTool,
  character_revision_begin: mutationTool,
  character_expansion_begin: mutationTool,
  character_expansion_blueprint_update: mutationTool,
  character_review_retry_begin: mutationTool,
  task_recovery_begin: mutationTool,
  task_repair_resume: mutationTool,
  source_processing_repair_begin: mutationTool,
  facts_recuration_begin: mutationTool,
  workflow_answer_interview: mutationTool,
  workflow_approve_gate: mutationTool,
  workflow_reject_gate: mutationTool,
  task_claim: taskMutationTool,
  task_context: taskReadTool,
  task_submit: taskMutationTool,
  task_fail: taskMutationTool,
  task_release: taskMutationTool,
  task_request_clarification: taskMutationTool,
  task_resolve_clarification: mutationTool,
  blueprint_precheck_record: taskMutationTool,
  source_intake_local: mutationTool,
  source_intake_retrieved: mutationTool,
  source_research_submit_candidates: mutationTool,
  source_research_status: readTool,
  source_research_approve: mutationTool,
  source_research_fetch_approved: mutationTool,
  source_create_chunks: taskMutationTool,
  source_get_chunk_task: taskMutationTool,
  fact_submit_candidates: taskMutationTool,
  fact_finalize_curation: taskMutationTool,
  facts_review_status: readTool,
  fact_query: taskReadTool,
  fact_review: mutationTool,
  facts_candidate_identity_migrate: mutationTool,
  conflict_resolve: mutationTool,
  provenance_trace: taskReadTool,
  provenance_verify: taskReadTool,
  blueprint_submit_proposal: taskMutationTool,
  character_submit_proposal: taskMutationTool,
  world_submit_proposal: taskMutationTool,
  greetings_submit_proposal: taskMutationTool,
  review_submit_report: taskMutationTool,
  conversion_submit_proposal: taskMutationTool,
  import_submit_analysis: taskMutationTool,
  project_validate: readTool,
  project_plan: readTool,
  project_simulate: readTool,
  project_compile_preview: mutationTool,
  project_publish: { mutation: true, requiresTask: false, requiresGate: "publish" },
  card_import: taskMutationTool,
  card_audit: readTool,
  roundtrip_verify: readTool,
  card_inspect_local: mutationTool,
  card_import_report: readTool,
  card_import_disposition: mutationTool,
  plugin_selection_resolve: readTool,
  plugin_revision_preview: readTool,
  plugin_proposal_preview: readTool,
  template_list: readTool,
  template_read: readTool,
  plugin_revision_begin: mutationTool,
  plugin_proposal_submit: taskMutationTool,
  plugin_review_decide: mutationTool,
  template_import: mutationTool,
  template_save_from_artifact: mutationTool,
});

export interface AgentLintOptions {
  root: string;
}

type ExtensionFields = {
  delegates?: string[];
  references?: string[];
  fixtures?: string[];
  skill_dependencies?: string[];
};

function extensionFields(agent: AgentDefinition): ExtensionFields {
  return agent.extensions as ExtensionFields;
}

function diagnostic(code: string, message: string, file: string, path?: (string | number)[], details?: unknown): Diagnostic {
  return {
    code,
    severity: "error",
    message,
    location: { file, ...(path === undefined ? {} : { path }) },
    hint: "修正設定引用或補齊已註冊資源後重試。",
    ...(details === undefined ? {} : { details: details as never }),
    evidence: [],
    fixability: "manual",
  };
}

async function pathKind(path: string): Promise<"file" | "directory" | undefined> {
  try {
    const info = await stat(path);
    return info.isFile() ? "file" : info.isDirectory() ? "directory" : undefined;
  } catch {
    return undefined;
  }
}

async function listFiles(root: string): Promise<string[]> {
  if ((await pathKind(root)) !== "directory") return [];
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(root, entry.name);
      return entry.isDirectory() ? listFiles(path) : entry.isFile() ? [path] : [];
    }),
  );
  return nested.flat();
}

function normalizeRelative(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}

function findCycles(graph: ReadonlyMap<string, readonly string[]>): string[][] {
  const cycles: string[][] = [];
  const active = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];
  const visit = (node: string): void => {
    if (active.has(node)) {
      const start = stack.indexOf(node);
      cycles.push([...stack.slice(start), node]);
      return;
    }
    if (visited.has(node)) return;
    visited.add(node);
    active.add(node);
    stack.push(node);
    for (const target of graph.get(node) ?? []) visit(target);
    stack.pop();
    active.delete(node);
  };
  for (const node of graph.keys()) visit(node);
  return cycles;
}

function validateReferences(config: WorkflowConfig, diagnostics: Diagnostic[]): void {
  const schemas = new Set<string>(registeredContractReferences);
  const capabilities = new Set([
    ...config.toolPolicy.rules.map((rule) => rule.capability),
    ...workspaceCapabilities,
  ]);
  const agents = new Map(config.registry.agents.map((agent) => [agent.id, agent]));
  const agentKinds = new Set(config.registry.agents.map((agent) => agent.kind));
  const personalities = new Map(config.personalities.map((profile) => [profile.id, profile]));

  config.registry.agents.forEach((agent, index) => {
    const personality = personalities.get(agent.personality);
    if (personality === undefined) {
      diagnostics.push(diagnostic("PERSONALITY_UNREGISTERED", `Personality 未註冊：${agent.personality}`, "workflow/agent-registry.yaml", ["agents", index, "personality"]));
    } else {
      const inheritance = personality.extensions as { inherits?: unknown; inheritance_required?: unknown };
      if (inheritance.inherits !== "base-adult" || inheritance.inheritance_required !== true) {
        diagnostics.push(diagnostic(
          "PERSONALITY_BASE_BINDING_INVALID",
          `Agent personality 未強制繼承 base-adult：${agent.personality}`,
          `workflow/personalities/${agent.personality}.yaml`,
          ["extensions"],
        ));
      }
    }
    for (const capability of agent.capabilities) {
      if (!capabilities.has(capability)) diagnostics.push(diagnostic("CAPABILITY_UNREGISTERED", `Capability 未註冊：${capability}`, "workflow/agent-registry.yaml", ["agents", index, "capabilities"]));
    }
    for (const contract of [...agent.input_contracts, ...agent.output_contracts]) {
      if (!schemas.has(contract)) diagnostics.push(diagnostic("SCHEMA_UNREGISTERED", `Schema 未註冊：${contract}`, "workflow/agent-registry.yaml", ["agents", index]));
    }
    for (const delegate of extensionFields(agent).delegates ?? []) {
      if (!agents.has(delegate)) diagnostics.push(diagnostic("AGENT_UNREGISTERED", `Delegate Agent 未註冊：${delegate}`, "workflow/agent-registry.yaml", ["agents", index, "extensions", "delegates"]));
    }
  });

  config.toolPolicy.rules.forEach((rule, index) => {
    for (const tool of rule.tools) {
      const invariant = TOOL_REGISTRY[tool];
      if (invariant === undefined) {
        diagnostics.push(diagnostic("TOOL_UNREGISTERED", `Tool 未在 TypeScript registry 註冊：${tool}`, "workflow/tool-policy.yaml", ["rules", index, "tools"]));
        continue;
      }
      const gateMatches = invariant.requiresGate === rule.requires_gate;
      if (invariant.mutation !== rule.mutation || (invariant.requiresTask && !rule.requires_task) || !gateMatches) {
        diagnostics.push(diagnostic("TOOL_INVARIANT_EXPANDED", `Policy 擴張不可變 tool 約束：${tool}`, "workflow/tool-policy.yaml", ["rules", index]));
      }
    }
  });

  config.definitions.definitions.forEach((definition, definitionIndex) => {
    definition.tasks.forEach((task, taskIndex) => {
      const path = ["definitions", definitionIndex, "tasks", taskIndex];
      if (!agentKinds.has(task.agent_kind)) diagnostics.push(diagnostic("AGENT_UNREGISTERED", `Task Agent kind 未註冊：${task.agent_kind}`, "workflow/workflow-definitions.yaml", [...path, "agent_kind"]));
      if (!schemas.has(task.output_contract)) diagnostics.push(diagnostic("SCHEMA_UNREGISTERED", `Task output schema 未註冊：${task.output_contract}`, "workflow/workflow-definitions.yaml", [...path, "output_contract"]));
      for (const capability of task.capabilities) {
        if (!capabilities.has(capability)) diagnostics.push(diagnostic("CAPABILITY_UNREGISTERED", `Task capability 未註冊：${capability}`, "workflow/workflow-definitions.yaml", [...path, "capabilities"]));
      }
    });
  });
}

function validateIsolation(config: WorkflowConfig, diagnostics: Diagnostic[]): void {
  for (const [index, agent] of config.registry.agents.entries()) {
    const references = extensionFields(agent).references ?? [];
    const creator = agent.kind.includes("creator");
    const critic = agent.kind.includes("critic");
    if (creator && references.some((reference) => /(?:critic|critique|negative-rules|anti-ai)/u.test(reference))) {
      diagnostics.push(diagnostic("CREATOR_CRITIC_REFERENCE_FORBIDDEN", `Creator 引用了 Critic 負面規則：${agent.id}`, "workflow/agent-registry.yaml", ["agents", index, "extensions", "references"]));
    }
    if (critic && references.some((reference) => /(?:creator|creation|generation-guide|positive-method)/u.test(reference))) {
      diagnostics.push(diagnostic("CRITIC_CREATOR_REFERENCE_FORBIDDEN", `Critic 引用了 Creator 生成規則：${agent.id}`, "workflow/agent-registry.yaml", ["agents", index, "extensions", "references"]));
    }
    if (critic && agent.capabilities.some((capability) => capability.endsWith(".propose"))) {
      diagnostics.push(diagnostic("CRITIC_MUTATION_CAPABILITY_FORBIDDEN", `Critic 不可取得生成 capability：${agent.id}`, "workflow/agent-registry.yaml", ["agents", index, "capabilities"]));
    }
    if (creator && agent.capabilities.includes("review.submit")) {
      diagnostics.push(diagnostic("CREATOR_REVIEW_CAPABILITY_FORBIDDEN", `Creator 不可取得 review capability：${agent.id}`, "workflow/agent-registry.yaml", ["agents", index, "capabilities"]));
    }
  }
}

async function validateFilesAndGraphs(root: string, config: WorkflowConfig, diagnostics: Diagnostic[]): Promise<void> {
  const agentIds = new Set(config.registry.agents.map((agent) => agent.id));
  const skills = new Set(config.registry.agents.map((agent) => agent.skill));
  const declaredAssets = new Set<string>();
  const agentGraph = new Map<string, readonly string[]>();
  const skillGraph = new Map<string, readonly string[]>();

  for (const [index, agent] of config.registry.agents.entries()) {
    const extensions = extensionFields(agent);
    agentGraph.set(agent.id, extensions.delegates ?? []);
    skillGraph.set(agent.skill, extensions.skill_dependencies ?? []);
    const required = [agent.agent_file, `.agents/skills/${agent.skill}/SKILL.md`, ...(extensions.references ?? []), ...(extensions.fixtures ?? [])];
    for (const file of required) {
      declaredAssets.add(file);
      if ((await pathKind(resolve(root, file))) !== "file") diagnostics.push(diagnostic(file === agent.agent_file ? "AGENT_FILE_NOT_FOUND" : file.endsWith("SKILL.md") ? "SKILL_NOT_FOUND" : file.includes("/references/") ? "REFERENCE_NOT_FOUND" : "FIXTURE_NOT_FOUND", `必要檔案不存在：${file}`, "workflow/agent-registry.yaml", ["agents", index]));
    }
    for (const reference of extensions.references ?? []) {
      if (!reference.startsWith(`.agents/skills/${agent.skill}/references/`)) diagnostics.push(diagnostic("REFERENCE_UNREGISTERED", `Reference 不屬於 Agent Skill：${reference}`, "workflow/agent-registry.yaml", ["agents", index, "extensions", "references"]));
    }
    for (const dependency of extensions.skill_dependencies ?? []) {
      if (!skills.has(dependency)) diagnostics.push(diagnostic("SKILL_UNREGISTERED", `Skill dependency 未註冊：${dependency}`, "workflow/agent-registry.yaml", ["agents", index, "extensions", "skill_dependencies"]));
    }
  }

  for (const cycle of findCycles(agentGraph)) diagnostics.push(diagnostic("AGENT_DELEGATION_CYCLE", `Agent delegation cycle：${cycle.join(" -> ")}`, "workflow/agent-registry.yaml"));
  for (const cycle of findCycles(skillGraph)) diagnostics.push(diagnostic("SKILL_REFERENCE_CYCLE", `Skill reference cycle：${cycle.join(" -> ")}`, "workflow/agent-registry.yaml"));

  const reachable = new Set<string>();
  const visit = (id: string): void => {
    if (reachable.has(id)) return;
    reachable.add(id);
    for (const target of agentGraph.get(id) ?? []) visit(target);
  };
  visit("director");
  for (const id of agentIds) if (!reachable.has(id)) diagnostics.push(diagnostic("AGENT_ORPHAN", `Agent 無法由 Director 委派：${id}`, "workflow/agent-registry.yaml"));

  const agentFiles = await listFiles(resolve(root, ".opencode/prompts"));
  for (const file of agentFiles) {
    const relativeFile = normalizeRelative(root, file);
    if (!declaredAssets.has(relativeFile)) diagnostics.push(diagnostic("AGENT_ORPHAN", `未註冊 Agent 檔案：${relativeFile}`, relativeFile));
  }
  const skillFiles = await listFiles(resolve(root, ".agents/skills"));
  for (const file of skillFiles) {
    const relativeFile = normalizeRelative(root, file);
    if (!declaredAssets.has(relativeFile)) {
      const code = relativeFile.includes("/references/") ? "REFERENCE_ORPHAN" : relativeFile.includes("/fixtures/") ? "FIXTURE_ORPHAN" : "SKILL_ORPHAN";
      diagnostics.push(diagnostic(code, `未註冊 Skill 資源：${relativeFile}`, relativeFile));
    }
  }
}

async function validateOpenCodePromptBindings(root: string, config: WorkflowConfig, diagnostics: Diagnostic[]): Promise<void> {
  const file = "opencode.jsonc";
  const runtimeInstructionsPrompt = "{file:./workflow/personalities/runtime-instructions.md}";
  const baselinePrompt = "{file:./workflow/personalities/base-adult.yaml}";
  let source: string;
  try {
    source = await readFile(resolve(root, file), "utf8");
  } catch (error) {
    diagnostics.push(diagnostic("OPENCODE_CONFIG_READ_FAILED", "無法讀取 OpenCode Agent 設定", file, undefined, error));
    return;
  }
  for (const agent of config.registry.agents) {
    const agentPrompt = `{file:./${agent.agent_file}}`;
    const personalityPrompt = `{file:./workflow/personalities/${agent.personality}.yaml}`;
    const extensions = agent.extensions as { references?: string[] };
    const referencePrompts = (extensions.references ?? []).map((reference) => `{file:./${reference}}`);
    const escapedId = agent.id.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const prompt = new RegExp(`"${escapedId}"\\s*:\\s*\\{[^}]*"prompt"\\s*:\\s*"([^"]*)"`, "u").exec(source)?.[1];
    const missingReferences = referencePrompts.filter((referencePrompt) => !prompt?.includes(referencePrompt));
    if (!prompt?.includes(agentPrompt) || !prompt.includes(runtimeInstructionsPrompt) || !prompt.includes(baselinePrompt) || !prompt.includes(personalityPrompt) || missingReferences.length > 0) {
      diagnostics.push(diagnostic(
        "AGENT_PROMPT_BINDING_INVALID",
        `OpenCode prompt 未同時綁定 Agent 契約、Skill references、personality runtime 指令、共用基底與專屬 personality：${agent.id}`,
        file,
        ["agent", agent.id, "prompt"],
        { agent_prompt: agentPrompt, reference_prompts: referencePrompts, missing_references: missingReferences, runtime_instructions_prompt: runtimeInstructionsPrompt, baseline_prompt: baselinePrompt, personality_prompt: personalityPrompt },
      ));
    }
  }
}

export async function lintAgentConfiguration(options: AgentLintOptions): Promise<DiagnosticReport> {
  const diagnostics: Diagnostic[] = [];
  let config: WorkflowConfig;
  try {
    config = await loadWorkflowConfig(options.root);
  } catch (error) {
    if (error instanceof WorkflowConfigError) {
      diagnostics.push(diagnostic(error.code, error.message, error.file, undefined, error.details));
      return { ok: false, diagnostics };
    }
    throw error;
  }

  validateReferences(config, diagnostics);
  validateIsolation(config, diagnostics);
  await validateFilesAndGraphs(options.root, config, diagnostics);
  await validateOpenCodePromptBindings(options.root, config, diagnostics);
  diagnostics.sort((left, right) => left.code.localeCompare(right.code) || (left.location?.file ?? "").localeCompare(right.location?.file ?? ""));
  return { ok: diagnostics.length === 0, diagnostics };
}
