import { readFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";

import {
  downgradeCharacterCardV3ToV2,
  emitCharacterCardV3,
  emitLorebookV3,
  sillytavernRegexHelperProfileId,
  sillytavernRegexHelperProfileRevision,
} from "@card-workspace/adapters-ccv3";
import { writeCardToPng } from "@card-workspace/adapters-png";
import { auditCharacterCard, auditLorebook, renderAuditMarkdown } from "@card-workspace/diagnostics";
import { buildProvenanceIndex } from "@card-workspace/ingestion";
import { compileActivePlugins } from "./plugins.js";
import {
  canonicalJson,
  computeRevision,
  computeTextRevision,
  loadAuthorProject,
  ProjectError,
  prepareForgePublishPlan,
  resolveWithin,
  type ForgePublishArtifact,
  type PublishPlan,
} from "@card-workspace/project";
import type {
  AuditFinding,
  AuditReport,
  CanonicalProjectIr,
  CharacterCardV2,
  CharacterCardV3,
  Diagnostic,
  NormalizedProjectIr,
  TokenSimulationReport,
  TriggerSimulationReport,
  ProvenanceIndex,
  LorebookV3,
} from "@card-workspace/schemas";
import {
  pluginBuildTraceSchema,
} from "@card-workspace/schemas";

import { isStableArtifactHashPath, stableArtifactHashes, type ForgeBuildManifest, type PluginBuildRecord } from "./manifest.js";
import { normalizeAuthorProject } from "./normalize.js";
import { planCanonicalProject } from "./planner.js";
import { simulateTokens } from "./token-simulator.js";
import { createCl100kTokenizer, type Tokenizer } from "./tokenizer.js";
import { simulateTriggers } from "./trigger-simulator.js";
import { appendPluginLoreForSimulation } from "./plugin-simulation.js";

export interface BuildProjectOptions {
  workspaceRoot: string;
  projectId: string;
  publish?: boolean;
  strict?: boolean;
  tokenBudget?: number;
  tokenizer?: Tokenizer;
  json?: boolean;
  png?: boolean;
  v2Backfill?: boolean;
  beforePublish?: (index: number) => void | Promise<void>;
  buildWorkflowRevision?: number;
  expectedInputRevision?: string;
  expectedArtifactHashes?: Record<string, string>;
}

interface BuildProjectResultBase {
  inputRevision: string;
  normalized: NormalizedProjectIr;
  planned: CanonicalProjectIr;
  tokenReport: TokenSimulationReport;
  triggerReport: TriggerSimulationReport;
  audit: AuditReport;
  provenanceIndex: ProvenanceIndex;
  manifest: ForgeBuildManifest;
  published: boolean;
  publishPlan: PublishPlan;
}

export type BuildProjectResult = BuildProjectResultBase & (
  | {
      output: { kind: "character_card"; fileName: string; value: CharacterCardV3 };
      card: CharacterCardV3;
      worldbook?: never;
      v2Backfill?: CharacterCardV2;
      png?: Buffer;
    }
  | {
      output: { kind: "worldbook"; fileName: string; value: LorebookV3 };
      worldbook: LorebookV3;
      card?: never;
      v2Backfill?: never;
      png?: never;
    }
);

function failed(code: string, message: string, diagnostics: Diagnostic[]): never {
  throw new ProjectError(code, message, diagnostics);
}

function auditDiagnostics(findings: AuditFinding[]): Diagnostic[] {
  return findings.map((finding) => ({
    code: finding.rule_id,
    severity: finding.severity,
    message: finding.message,
    ...(finding.location ? { location: finding.location } : {}),
    ...(finding.hint ? { hint: finding.hint } : {}),
    details: { layer: finding.layer, overridable: finding.overridable },
    evidence: finding.evidence,
    fixability: finding.fixability,
  }));
}

function provenanceFindings(diagnostics: Diagnostic[]): AuditFinding[] {
  return diagnostics.map((item) => ({
    rule_id: item.code,
    layer: "workspace",
    severity: item.severity,
    message: item.message,
    ...(item.location ? { location: item.location } : {}),
    ...(item.hint ? { hint: item.hint } : {}),
    evidence: item.evidence,
    fixability: item.fixability,
    overridable: true,
  }));
}

function artifact(fileName: string, content: string | Buffer): ForgePublishArtifact {
  return { fileName, content };
}

function artifactRecord(prefix: string, item: ForgePublishArtifact) {
  const content = typeof item.content === "string" ? Buffer.from(item.content, "utf8") : item.content;
  return {
    path: `${prefix}/${item.fileName}`,
    revision: computeTextRevision(content),
    bytes: content.byteLength,
  };
}

export async function buildProject(options: BuildProjectOptions): Promise<BuildProjectResult> {
  if (options.publish === true) {
    failed("PUBLISH_WORKFLOW_REQUIRED", "正式發布必須由 Publish Gate workflow 執行", []);
  }
  const timings: Record<string, number> = {};
  const timed = async <T>(name: string, operation: () => T | Promise<T>): Promise<T> => {
    const start = performance.now();
    try {
      return await operation();
    } finally {
      timings[name] = Math.round((performance.now() - start) * 1000) / 1000;
    }
  };
  const projectsRoot = path.join(options.workspaceRoot, "projects");
  const loaded = await timed("parse_validate", () => loadAuthorProject(projectsRoot, options.projectId));
  if (!loaded.ok || !loaded.manifest || !loaded.workflow) {
    failed("BUILD_AUTHOR_INVALID", "作者專案驗證失敗", loaded.diagnostics);
  }
  const manifest = loaded.manifest;
  const workflow = loaded.workflow;
  const normalizedResult = await timed("normalize", () => normalizeAuthorProject(loaded));
  if (!normalizedResult.ok || !normalizedResult.ir) {
    failed("BUILD_NORMALIZE_FAILED", "Canonical IR 正規化失敗", normalizedResult.diagnostics);
  }
  const normalized = normalizedResult.ir;
  const pluginContributions = manifest.kind === "character_card"
    ? await timed("plugin_compile", () => compileActivePlugins(loaded.pluginSources ?? [], {
        projectKind: manifest.kind,
        ...(loaded.greetings
          ? { greetingIds: loaded.greetings.greetings.map((greeting) => greeting.id) }
          : {}),
      }))
    : [];
  const approvedPluginArtifacts = pluginContributions.map((contribution) => {
    const approved = loaded.pluginArtifacts?.find((artifact) => artifact.plugin_id === contribution.plugin_id && artifact.status === "approved");
    if (!approved || approved.revision !== contribution.artifact_revision) {
      failed("BUILD_PLUGIN_APPROVAL_STALE", `plugin ${contribution.plugin_id} 的 approved artifact 與目前生成結果不一致`, []);
    }
    return approved;
  });
  const provenance = await timed("verify_provenance", () => buildProvenanceIndex(loaded));
  const strict = options.strict ?? manifest.policies.strict_publish;
  if (strict && provenance.diagnostics.some((item) => item.severity === "error")) {
    failed("BUILD_PROVENANCE_BLOCKED", "Provenance 驗證阻止編譯", provenance.diagnostics);
  }
  const planResult = await timed("plan", () => planCanonicalProject(normalized));
  if (!planResult.ok || !planResult.ir) {
    failed("BUILD_PLAN_FAILED", "世界書規劃失敗", planResult.diagnostics);
  }
  const planned = planResult.ir;
  const simulationProject = appendPluginLoreForSimulation(planned, pluginContributions);
  const tokenizer = options.tokenizer ?? createCl100kTokenizer();
  const tokenReport = await timed("simulate_tokens", () =>
    simulateTokens(simulationProject, {
      tokenizer,
      ...(options.tokenBudget !== undefined ? { budget: options.tokenBudget } : {}),
    }),
  );
  const includedIds = tokenReport.entries.filter((entry) => entry.included).map((entry) => entry.entry_id);
  const triggerOptions = {
    messages: [],
    ...(pluginContributions.length > 0 ? { profile: sillytavernRegexHelperProfileId } : {}),
    budgetIncludedEntryIds: includedIds,
  };
  const triggerResult = await timed("simulate_triggers", () =>
    simulateTriggers(simulationProject, triggerOptions),
  );
  const triggerReport = triggerResult.report;
  const output = manifest.kind === "worldbook"
    ? {
        kind: "worldbook" as const,
        fileName: `${options.projectId}.worldbook.json`,
        value: await timed("emit_lorebook_v3", () => emitLorebookV3(planned)),
      }
    : {
        kind: "character_card" as const,
        fileName: `${options.projectId}.json`,
        value: await timed("emit_v3", () => emitCharacterCardV3(planned, { pluginContributions })),
      };
  const audit = await timed("audit", () =>
    (output.kind === "worldbook" ? auditLorebook : auditCharacterCard)(output.value, {
      tokenReport,
      strict,
      workspaceFindings: provenanceFindings(provenance.diagnostics),
    }),
  );
  if (audit.blocked) {
    failed("BUILD_AUDIT_BLOCKED", "實體卡片智慧診斷阻止發布", auditDiagnostics(audit.findings));
  }

  const wantsJson = manifest.kind === "worldbook" || (options.json ?? manifest.output.json);
  const wantsPng = manifest.kind === "character_card" && (options.png ?? manifest.output.png);
  const wantsV2 = manifest.kind === "character_card" && (options.v2Backfill ?? manifest.output.v2_backfill);
  const card = output.kind === "character_card" ? output.value : undefined;
  const v2Backfill = wantsV2 && card ? downgradeCharacterCardV3ToV2(card).card : undefined;
  const projectRoot = loaded.projectRoot;
  const png = wantsPng && card
    ? await timed("emit_png", async () => {
        const avatarPath = await resolveWithin(projectRoot, manifest.card.avatar);
        const avatar = await readFile(avatarPath);
        return writeCardToPng(avatar, card, v2Backfill);
      })
    : undefined;

  const irJson = canonicalJson(normalized);
  const planJson = canonicalJson(planned);
  const tokenJson = canonicalJson(tokenReport);
  const triggerJson = canonicalJson(triggerReport);
  const auditJson = canonicalJson(audit);
  const provenanceJson = canonicalJson(provenance.index);
  const auditMarkdown = renderAuditMarkdown(audit, output.kind === "worldbook" ? "Worldbook Audit" : "Card Audit");
  const outputJson = canonicalJson(output.value);
  const buildFiles = [
    artifact("ir.json", irJson),
    artifact("plan.json", planJson),
    artifact("token-report.json", tokenJson),
    artifact("trigger-report.json", triggerJson),
    artifact("audit.json", auditJson),
    artifact("audit.md", auditMarkdown),
    artifact("provenance-index.json", provenanceJson),
  ];
  const exportFiles = [
    ...(wantsJson ? [artifact(output.fileName, outputJson)] : []),
    ...(png ? [artifact(`${options.projectId}.png`, png)] : []),
  ];
  const publishSourceRevisions = { ...loaded.sourceRevisions, ...provenance.sourceRevisions };
  const buildSourceRevisions = { ...publishSourceRevisions };
  for (const contribution of pluginContributions) {
    buildSourceRevisions[`plugin/${contribution.plugin_id}/artifact`] = contribution.artifact_revision;
  }
  buildSourceRevisions["project.yaml"] = computeTextRevision(await readFile(path.join(projectRoot, "project.yaml")));
  const inputRevision = computeRevision({ sources: buildSourceRevisions });
  if (pluginContributions.length > 0) {
    const pluginTrace = pluginBuildTraceSchema.parse({
      schema_version: 1,
      project_id: options.projectId,
      input_revision: inputRevision,
      plugins: approvedPluginArtifacts,
      compatibility_profile: sillytavernRegexHelperProfileId,
      compatibility_profile_revision: sillytavernRegexHelperProfileRevision,
      selection_revision: loaded.pluginSelectionRevision ?? "absent",
       contribution_hashes: Object.fromEntries(pluginContributions.map((contribution) => [
         contribution.plugin_id,
         computeTextRevision(canonicalJson(contribution)),
       ])),
       diagnostics_summary: { errors: 0, warnings: 0, info: 0 },
       timings_ms: timings,
       generated_at: [...approvedPluginArtifacts].sort((left, right) => left.generated_at < right.generated_at ? -1 : left.generated_at > right.generated_at ? 1 : 0).at(-1)?.generated_at ?? new Date(0).toISOString(),
    });
    buildFiles.push(artifact("plugin-build-trace.json", canonicalJson(pluginTrace)));
  }
  const buildWorkflowRevision = options.buildWorkflowRevision ?? workflow.revision;
  const pluginBuildRecords: PluginBuildRecord[] = pluginContributions.map((contribution, index) => {
    const approved = approvedPluginArtifacts[index];
    return {
      plugin_id: contribution.plugin_id,
      artifact_revision: contribution.artifact_revision,
      source_revision: approved!.source_revision,
      resolved_source_hash: approved!.resolved_source_hash,
       ...(approved!.template_payload_hash === undefined ? {} : { template_payload_hash: approved!.template_payload_hash }),
       implementation: approved!.implementation,
       asset_manifest: {
         id: approved!.implementation.asset_manifest_id,
         revision: approved!.implementation.asset_manifest_revision,
         hash: approved!.implementation.asset_manifest_hash,
       },
       compatibility_profile: sillytavernRegexHelperProfileId,
      compatibility_profile_revision: sillytavernRegexHelperProfileRevision,
      contribution_revision: computeTextRevision(canonicalJson(contribution)),
    };
  });
  const buildManifest: ForgeBuildManifest = {
    schema_version: 1,
    project_id: options.projectId,
    input_revision: inputRevision,
    workflow_revision: buildWorkflowRevision,
    tool: { name: "card-workspace", version: "0.1.0" },
    tokenizer: tokenReport.tokenizer,
    passes_ms: timings,
    artifacts: [
      ...buildFiles.map((item) => artifactRecord(`projects/${options.projectId}/.build`, item)),
      ...exportFiles.map((item) => artifactRecord(`exports/${options.projectId}`, item)),
    ].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0),
    audit: audit.summary,
    trigger_profile: triggerReport.profile,
     ...(pluginBuildRecords.length > 0 ? { plugin_artifacts: pluginBuildRecords } : {}),
     ...(pluginContributions.length > 0 ? { plugin_selection_revision: loaded.pluginSelectionRevision ?? "absent" } : {}),
     ...(pluginContributions.length > 0 ? { plugin_diagnostics_summary: { errors: 0, warnings: 0, info: 0 } } : {}),
     ...(pluginContributions.length > 0 ? { plugin_timings_ms: timings } : {}),
   };
  buildFiles.push(artifact("manifest.json", canonicalJson(buildManifest)));

  if (options.expectedInputRevision !== undefined && inputRevision !== options.expectedInputRevision) {
    failed("BUILD_PREVIEW_INPUT_STALE", "目前輸入 revision 與已批准 preview 不同", []);
  }
  if (options.expectedArtifactHashes !== undefined) {
    const actual = stableArtifactHashes(buildManifest.artifacts);
    const expected = Object.fromEntries(
      Object.entries(options.expectedArtifactHashes)
        .filter(([artifactPath]) => isStableArtifactHashPath(artifactPath)),
    );
    if (canonicalJson(actual) !== canonicalJson(expected)) {
      failed("BUILD_PREVIEW_HASH_STALE", "目前 artifact hashes 與已批准 preview 不同", []);
    }
  }

  const sourceRevisions = { ...publishSourceRevisions };
  sourceRevisions["workflow.json"] = computeTextRevision(await readFile(path.join(projectRoot, "workflow.json")));
  const publishPlan = await prepareForgePublishPlan({
    workspaceRoot: options.workspaceRoot,
    projectId: options.projectId,
    buildFiles,
    exportFiles,
    sourceRevisions: Object.fromEntries(
      Object.entries(sourceRevisions).map(([relativePath, revision]) => [
        `projects/${options.projectId}/${relativePath}`,
        revision,
      ]),
    ),
  });
  const base = {
    inputRevision,
    normalized,
    planned,
    tokenReport,
    triggerReport,
    audit,
    provenanceIndex: provenance.index,
    manifest: buildManifest,
    published: false,
    publishPlan,
  };
  return output.kind === "worldbook"
    ? { ...base, output, worldbook: output.value }
    : {
        ...base,
        output,
        card: output.value,
        ...(v2Backfill ? { v2Backfill } : {}),
        ...(png ? { png } : {}),
      };
}
