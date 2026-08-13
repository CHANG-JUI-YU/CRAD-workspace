import {
  authoringBindingHash,
  canonicalJson,
  contentHash,
  CoreError,
  internalId,
  normalizeSparseRelationshipsDocument,
  templateProposalValueSchema,
  zhujiProposalValueSchema,
  type ArtifactKind,
  type ArtifactRecord,
  type AuthoringCoverageBinding,
  type OperationRecord,
  type ProjectRepository,
  type ProjectState,
  type TemplateProposalValue,
  type ZhujiProposalValue,
} from "@st-workspace/core";
import { ConversionService } from "./conversion.js";
import { assertExecutionLease, assertExecutionLeaseForOperation, resolveExecutionActors, type ExecutionActorInput } from "./execution-context.js";

export interface AuthoringExecutionResult {
  artifact_id?: string;
  artifact_ids?: string[];
  artifact_key?: string;
  status: "completed" | "needs_input";
  summary: string;
}

function now(): string {
  return new Date().toISOString();
}

function updateOperation(operation: OperationRecord, patch: Partial<OperationRecord>): OperationRecord {
  return { ...operation, ...patch, updated_at: now() };
}

function inferKind(request: string): ArtifactKind {
  if (/draft_note|draft note|\bdraft\b|草稿|筆記|備忘|note|brief/iu.test(request)) return "draft_note";
  if (/relationship|關係|關係圖|relationships/iu.test(request)) return "relationship";
  if (/world|世界|世界觀|lore/iu.test(request)) return "world_lore";
  if (/greeting|開場|開場白/iu.test(request)) return "greeting";
  if (/blueprint|藍圖/iu.test(request)) return "blueprint";
  if (/zhuji|珠璣/iu.test(request)) return "zhuji";
  if (/palette|調色盤/iu.test(request)) return "palette";
  if (/wardrobe|衣櫃|衣橱|服裝清單/iu.test(request)) return "wardrobe";
  if (/plugin|插件|外掛|mvu|ejs|html/iu.test(request)) return "plugin";
  if (/character|角色|人物|card/iu.test(request)) return "character";
  return "unknown";
}

/** Public wrapper over inferKind so the runtime can gate authoring by kind. */
export function inferAuthoringKind(request: string): ArtifactKind {
  return inferKind(request);
}

function inferName(request: string, kind: ArtifactKind): string {
  const explicit = request.match(/(?:角色|人物|character)\s*[:：]\s*([^\n，,。；;.]+)/iu)?.[1]?.trim()
    ?? request.match(/(?:名稱|name)\s*[:：]\s*([^\n，,。；;.]+)/iu)?.[1]?.trim();
  if (explicit !== undefined && explicit.length > 0) return explicit.slice(0, 80);
  const labels: Record<ArtifactKind, string> = {
    character: "character",
    relationship: "relationships",
    world_lore: "world-lore",
    greeting: "greeting",
    blueprint: "blueprint",
    zhuji: "zhuji",
    palette: "palette",
    wardrobe: "wardrobe",
    plugin: "plugin",
    review: "review",
    source_research: "source-research",
    fact_curation: "fact-curation",
    fact_review: "fact-review",
    conversion: "conversion",
    import_analysis: "import-analysis",
    director_routing: "director-routing",
    draft_note: "draft-note",
    unknown: "artifact",
  };
  return labels[kind];
}

function keyFor(kind: ArtifactKind, name: string): string {
  const escaped = name.toLocaleLowerCase().replace(/[^a-z0-9-]/gu, (char) => `_${char.codePointAt(0)!.toString(16).padStart(4, "0")}`).replace(/-{2,}/gu, "-");
  return `${kind}:${escaped || "default"}`;
}

function blueprintBinding(state: { blueprint_prechecks: readonly { id: string; candidate_blueprint_revision: string; status: string }[] }): Pick<ArtifactRecord, "blueprint_precheck_id" | "blueprint_precheck_revision"> {
  const precheck = [...state.blueprint_prechecks].reverse().find((item) => item.status === "recorded");
  return precheck === undefined
    ? {}
    : { blueprint_precheck_id: precheck.id, blueprint_precheck_revision: precheck.candidate_blueprint_revision };
}

function templateArtifactKind(kind: TemplateProposalValue["kind"]): ArtifactKind {
  const mapping: Record<TemplateProposalValue["kind"], ArtifactKind> = {
    character: "character",
    zhuji: "zhuji",
    palette: "palette",
    wardrobe: "wardrobe",
    greetings: "greeting",
    relationships: "relationship",
    world: "world_lore",
    conversion: "conversion",
    import_analysis: "import_analysis",
    review: "review",
    source_research: "source_research",
    fact_curation: "fact_curation",
    fact_review: "fact_review",
    plugin: "plugin",
    director_routing: "director_routing",
  };
  return mapping[kind];
}

export function createCoverageBindingForArtifact(state: ProjectState, artifact: ArtifactRecord, actor: string): AuthoringCoverageBinding | undefined {
  const assessment = state.coverage_assessments.at(-1);
  if (assessment === undefined) return undefined;

  const factProjectionRev = contentHash(
    canonicalJson({
      facts: state.facts.map((fact) => ({ id: fact.id, status: fact.status, fact_revision: fact.fact_revision ?? 0 })),
    }),
  );

  const activeResolutions = state.coverage_resolutions.filter((r) => !state.coverage_resolutions.some((other) => other.supersedes === r.id));

  const bindingObj = {
    artifact_id: artifact.id,
    artifact_revision: artifact.revision,
    assessment_id: assessment.id,
    assessment_revision: assessment.revision,
    requirement_set_revision: assessment.requirement_set_revision,
    fact_projection_revision: factProjectionRev,
    ...(assessment.input_snapshot.fact_review_run_id === undefined ? {} : { fact_review_run_id: assessment.input_snapshot.fact_review_run_id }),
    resolution_ids: activeResolutions.map((r) => r.id),
    created_by: actor,
  };

  const hash = authoringBindingHash(bindingObj);

  return {
    id: internalId("authoring-binding"),
    ...bindingObj,
    input_snapshot_hash: hash,
    created_by: actor,
    created_at: now(),
  };
}

function templateName(value: Exclude<TemplateProposalValue, { kind: "zhuji" }>): string {
  switch (value.kind) {
    case "character": return value.document.display_name;
    case "palette": return `${value.character_id}/${value.module.module}`;
    case "wardrobe": return `${value.character_id}/wardrobe`;
    case "greetings": return "greetings";
    case "relationships": return value.document.document_id;
    case "world": return value.document_id;
    case "conversion": return `${value.character_id}-${value.source_mode}-to-${value.target_mode}`;
    case "import_analysis": return "import-analysis";
    case "review": return `${value.target.kind}-${value.target.id ?? value.target.name}`;
    case "source_research": return value.work_title ?? value.query.slice(0, 80);
    case "fact_curation": return value.topic ?? "facts";
    case "fact_review": return "fact-review";
    case "plugin": return value.plugin_id;
    case "director_routing": return value.phase;
  }
}

function keyName(value: Exclude<TemplateProposalValue, { kind: "zhuji" }>): string {
  if (value.kind === "character") return value.document.id;
  return templateName(value);
}

export class AuthoringService {
  private readonly conversion: ConversionService;

  constructor(private readonly repository: ProjectRepository) {
    this.conversion = new ConversionService(repository);
  }

  /** Persist any model-facing structured template using one common path. */
  async createTemplate(operationId: string, proposal: TemplateProposalValue, actorInput: ExecutionActorInput, legacyAuditActor?: string): Promise<AuthoringExecutionResult> {
    const actors = resolveExecutionActors(actorInput, legacyAuditActor);
    const { executionAgent: actor, auditActor, context: execution } = actors;
    await assertExecutionLease(this.repository, execution);
    const parsed = templateProposalValueSchema.safeParse(proposal);
    if (!parsed.success) throw new CoreError("TEMPLATE_SCHEMA_INVALID", parsed.error.message, true);
    const proposalValue = parsed.data.kind === "relationships"
      ? { ...parsed.data, document: normalizeSparseRelationshipsDocument(parsed.data.document) }
      : parsed.data;
    if (proposalValue.kind === "zhuji") return this.createZhuji(operationId, proposalValue, actorInput, legacyAuditActor);
    if (proposalValue.kind === "conversion") return this.conversion.materialize(operationId, proposalValue, actorInput, legacyAuditActor);
    const initial = await this.repository.read();
    const operation = initial.operations.find((item) => item.id === operationId);
    if (operation === undefined) throw new CoreError("OPERATION_NOT_FOUND", `Operation ${operationId} does not exist`);
    const kind = templateArtifactKind(proposalValue.kind);
    const name = templateName(proposalValue);
    const key = keyFor(kind, keyName(proposalValue));
    const content = proposalValue.kind === "wardrobe" ? proposalValue.content : canonicalJson(proposalValue);
    const hash = contentHash(content);
    const previous = [...initial.artifacts].reverse().find((artifact) => artifact.key === key);
    const artifact: ArtifactRecord = {
      id: internalId("artifact"),
      key,
      kind,
      name,
      content,
      media_type: proposalValue.kind === "wardrobe" ? "text/markdown" : "application/json",
      content_hash: hash,
      revision: hash,
      status: "draft",
      created_at: now(),
      updated_at: now(),
      created_by: actor,
      operation_id: operationId,
      ...(previous === undefined ? {} : { based_on: previous.revision }),
      ...blueprintBinding(initial),
    };
    const summary = `Stored ${proposalValue.kind} template ${name}.`;
    let reusedId: string | undefined;
    await this.repository.commit(initial.revision, (current) => {
      assertExecutionLeaseForOperation(current.operations.find((item) => item.id === operationId), execution);
      const currentPrevious = [...current.artifacts].reverse().find((item) => item.key === key);
      if (currentPrevious?.content_hash === hash) {
        reusedId = currentPrevious.id;
        return {
          ...current,
          operations: current.operations.map((item) => item.id === operationId
            ? updateOperation(item, { status: "completed", result_summary: `Template ${proposalValue.kind} is already stored.` })
            : item),
        };
      }
      return {
        ...current,
        ...(current.project_status === "published" ? { project_status: "ready" as const } : {}),
        artifacts: [...current.artifacts, artifact],
        operations: current.operations.map((item) => item.id === operationId
            ? updateOperation(item, { status: "completed", progress: [...item.progress, { item_id: artifact.id, status: "completed", message: `Validated ${proposalValue.kind} template.` }], result_summary: summary })
          : item),
        audit: [...current.audit, {
          id: internalId("audit"),
          operation_id: operationId,
          event: "template.created",
          actor: auditActor,
          occurred_at: now(),
          project_revision: current.revision + 1,
          details: { artifact_id: artifact.id, key, template_kind: proposalValue.kind, artifact_kind: kind, based_on: previous?.revision, agent_id: actor },
        }],
      };
    });
    if (reusedId !== undefined) return { artifact_id: reusedId, artifact_key: key, status: "completed", summary: `Reused existing ${proposalValue.kind} template.` };
    return { artifact_id: artifact.id, artifact_key: key, status: "completed", summary };
  }

  async createStructured(operationId: string, proposal: TemplateProposalValue, actorInput: ExecutionActorInput, legacyAuditActor?: string): Promise<AuthoringExecutionResult> {
    return this.createTemplate(operationId, proposal, actorInput, legacyAuditActor);
  }

  async createZhuji(operationId: string, proposal: ZhujiProposalValue, actorInput: ExecutionActorInput, legacyAuditActor?: string): Promise<AuthoringExecutionResult> {
    const actors = resolveExecutionActors(actorInput, legacyAuditActor);
    const { executionAgent: actor, auditActor, context: execution } = actors;
    await assertExecutionLease(this.repository, execution);
    const parsed = zhujiProposalValueSchema.safeParse(proposal);
    if (!parsed.success) throw new CoreError("ZHUJI_SCHEMA_INVALID", parsed.error.message, true);
    const initial = await this.repository.read();
    const operation = initial.operations.find((item) => item.id === operationId);
    if (operation === undefined) throw new CoreError("OPERATION_NOT_FOUND", `Operation ${operationId} does not exist`);
    const module = parsed.data.module;
    const name = `${parsed.data.character_id}/${module.module}`;
    const key = keyFor("zhuji", `${parsed.data.character_id}-${module.module}`);
    const content = canonicalJson(parsed.data);
    const hash = contentHash(content);
    const previous = [...initial.artifacts].reverse().find((artifact) => artifact.key === key);
    const artifact: ArtifactRecord = {
      id: internalId("artifact"),
      key,
      kind: "zhuji",
      name,
      content,
      media_type: "application/json",
      content_hash: hash,
      revision: hash,
      status: "draft",
      created_at: now(),
      updated_at: now(),
      created_by: actor,
      operation_id: operationId,
      ...(previous === undefined ? {} : { based_on: previous.revision }),
      ...blueprintBinding(initial),
    };
    const summary = `已建立珠璣模組「${name}」revision ${artifact.revision.slice(0, 12)}。`;
    let reusedId: string | undefined;
    await this.repository.commit(initial.revision, (current) => {
      assertExecutionLeaseForOperation(current.operations.find((item) => item.id === operationId), execution);
      const currentPrevious = [...current.artifacts].reverse().find((item) => item.key === key);
      if (currentPrevious?.content_hash === hash) {
        reusedId = currentPrevious.id;
        return {
          ...current,
          operations: current.operations.map((item) => item.id === operationId
            ? updateOperation(item, { status: "completed", result_summary: "珠璣模組內容未變更，沿用既有 revision。" })
            : item),
        };
      }
      return {
        ...current,
        ...(current.project_status === "published" ? { project_status: "ready" as const } : {}),
        artifacts: [...current.artifacts, artifact],
        operations: current.operations.map((item) => item.id === operationId
          ? updateOperation(item, { status: "completed", progress: [...item.progress, { item_id: artifact.id, status: "completed", message: "珠璣結構通過 Schema 驗證並建立 revision" }], result_summary: summary })
          : item),
        audit: [...current.audit, {
          id: internalId("audit"),
          operation_id: operationId,
          event: "zhuji.created",
          actor: auditActor,
          occurred_at: now(),
          project_revision: current.revision + 1,
          details: { artifact_id: artifact.id, key, kind: "zhuji", character_id: parsed.data.character_id, module: module.module, revision: artifact.revision, based_on: previous?.revision, agent_id: actor },
        }],
      };
    });
    if (reusedId !== undefined) return { artifact_id: reusedId, artifact_key: key, status: "completed", summary: "珠璣模組內容未變更，沿用既有 revision。" };
    return { artifact_id: artifact.id, artifact_key: key, status: "completed", summary };
  }

  async create(operationId: string, request: string, actorInput: ExecutionActorInput, legacyAuditActor?: string): Promise<AuthoringExecutionResult> {
    const actors = resolveExecutionActors(actorInput, legacyAuditActor);
    const { executionAgent: actor, auditActor, context: execution } = actors;
    await assertExecutionLease(this.repository, execution);
    const initial = await this.repository.read();
    const operation = initial.operations.find((item) => item.id === operationId);
    if (operation === undefined) throw new CoreError("OPERATION_NOT_FOUND", `Operation ${operationId} does not exist`);
    const kind = inferKind(request);
    if (kind === "unknown") {
      await this.repository.commit(initial.revision, (current) => ({
        ...current,
        operations: current.operations.map((item) => item.id === operationId
          ? updateOperation(item, { status: "needs_input", question: "請說明要建立角色、關係、世界設定、開場白或其他產物。" })
          : item),
      }));
      return { status: "needs_input", summary: "尚未判斷要建立哪一種產物。" };
    }
    const name = inferName(request, kind);
    const key = keyFor(kind, name);
    if (kind === "zhuji") {
      await this.repository.commit(initial.revision, (current) => ({
        ...current,
        operations: current.operations.map((item) => item.id === operationId
          ? updateOperation(item, { status: "needs_input", question: "珠璣必須使用七模組結構化 proposal；請由 Zhuji Creator 先讀取珠璣 context，再提交 workspace_zhuji_submit。" })
          : item),
      }));
      return { status: "needs_input", summary: "珠璣不能以自由文字略過固定七模組模板。" };
    }
    if (kind === "wardrobe") {
      if (/(?:先不要|延後|之後再做|跳過|不要建立|skip|defer)/iu.test(request)) {
        await this.repository.commit(initial.revision, (current) => ({
          ...current,
          operations: current.operations.map((item) => item.id === operationId
            ? updateOperation(item, { status: "completed", result_summary: "已依使用者要求跳過或延後衣櫃建立。" })
            : item),
        }));
        return { status: "completed", summary: "已依使用者要求跳過或延後衣櫃建立。" };
      }
      await this.repository.commit(initial.revision, (current) => ({
        ...current,
        operations: current.operations.map((item) => item.id === operationId
          ? updateOperation(item, { status: "needs_input", question: "衣櫃必須使用完整 Markdown proposal；請由 Wardrobe Creator 讀取衣櫃 context 後提交。" })
          : item),
      }));
      return { status: "needs_input", summary: "衣櫃不能以自由文字略過完整清單與數量驗證。" };
    }
    if (kind !== "draft_note") {
      await this.repository.commit(initial.revision, (current) => ({
        ...current,
        operations: current.operations.map((item) => item.id === operationId
          ? updateOperation(item, { status: "needs_input", question: `${kind} 必須使用對應的結構化 proposal；請由專屬 Creator 讀取 context 後提交，自由文字只能建立草稿筆記。` })
          : item),
      }));
      return { status: "needs_input", summary: `${kind} 不能以自由文字略過 typed schema。` };
    }
    const content = request.replace(/^\s*(建立|新增|更新|create|make|draft)\s*/iu, "").trim();
    if (content.length < 3) {
      await this.repository.commit(initial.revision, (current) => ({
        ...current,
        operations: current.operations.map((item) => item.id === operationId
          ? updateOperation(item, { status: "needs_input", question: "請補充產物內容或描述。" })
          : item),
      }));
      return { status: "needs_input", summary: "產物內容不足。" };
    }
    const hash = contentHash(content);
    const previous = [...initial.artifacts].reverse().find((artifact) => artifact.key === key);
    const artifact: ArtifactRecord = {
      id: internalId("artifact"),
      key,
      kind,
      name,
      content,
      media_type: "text/markdown",
      content_hash: hash,
      revision: hash,
      status: "draft",
      created_at: now(),
      updated_at: now(),
      created_by: actor,
      operation_id: operationId,
      ...(previous === undefined ? {} : { based_on: previous.revision }),
      ...blueprintBinding(initial),
    };
    const summary = `已建立 ${kind} artifact「${name}」revision ${artifact.revision.slice(0, 12)}。`;
    let reusedId: string | undefined;
    await this.repository.commit(initial.revision, (current) => {
      const currentPrevious = [...current.artifacts].reverse().find((item) => item.key === key);
      if (currentPrevious?.content_hash === hash) {
        reusedId = currentPrevious.id;
        return {
          ...current,
          operations: current.operations.map((item) => item.id === operationId
            ? updateOperation(item, { status: "completed", result_summary: "內容未變更，沿用既有 artifact revision。" })
            : item),
        };
      }
      const binding = createCoverageBindingForArtifact(current, artifact, actor);
      return {
        ...current,
        ...(current.project_status === "published" ? { project_status: "ready" as const } : {}),
        artifacts: [...current.artifacts, artifact],
        coverage_authoring_bindings: binding === undefined ? current.coverage_authoring_bindings : [...current.coverage_authoring_bindings, binding],
        operations: current.operations.map((item) => item.id === operationId
          ? updateOperation(item, { status: "completed", progress: [...item.progress, { item_id: artifact.id, status: "completed", message: "artifact revision 已建立" }], result_summary: summary })
          : item),
        audit: [...current.audit, {
          id: internalId("audit"),
          operation_id: operationId,
          event: "artifact.created",
          actor: auditActor,
          occurred_at: now(),
          project_revision: current.revision + 1,
          details: { artifact_id: artifact.id, key, kind, revision: artifact.revision, based_on: previous?.revision, agent_id: actor },
        }],
      };
    });
    if (reusedId !== undefined) return { artifact_id: reusedId, artifact_key: key, status: "completed", summary: "內容未變更，沿用既有 artifact revision。" };
    return { artifact_id: artifact.id, artifact_key: key, status: "completed", summary };
  }
}
