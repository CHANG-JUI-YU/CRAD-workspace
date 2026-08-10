import {
  canonicalJson,
  contentHash,
  CoreError,
  internalId,
  type ArtifactRecord,
  type ImportRecord,
  type OperationRecord,
  type ProjectRepository,
  type SourceAttachment,
} from "@st-workspace/core";

export interface ImportExecutionResult {
  import_id?: string;
  artifact_id?: string;
  status: "completed" | "needs_input";
  summary: string;
}

function now(): string {
  return new Date().toISOString();
}

function updateOperation(operation: OperationRecord, patch: Partial<OperationRecord>): OperationRecord {
  return { ...operation, ...patch, updated_at: now() };
}

function artifactName(payload: Record<string, unknown>, attachment: SourceAttachment): string {
  const name = payload.name ?? payload.character_name ?? payload.char_name;
  if (typeof name === "string" && name.trim().length > 0) return name.trim().slice(0, 80);
  return attachment.name.replace(/\.[^.]+$/u, "") || "imported-character";
}

function keyFor(name: string): string {
  return `character:${name.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/gu, "") || "imported"}`;
}

export class ImportService {
  constructor(private readonly repository: ProjectRepository) {}

  async run(operationId: string, request: string, actor: string, attachments: SourceAttachment[]): Promise<ImportExecutionResult> {
    const initial = await this.repository.read();
    const operation = initial.operations.find((item) => item.id === operationId);
    if (operation === undefined) throw new CoreError("OPERATION_NOT_FOUND", `Operation ${operationId} does not exist`);
    const attachment = attachments[0];
    if (attachment === undefined) {
      await this.repository.commit(initial.revision, (current) => ({
        ...current,
        operations: current.operations.map((item) => item.id === operationId ? updateOperation(item, { status: "needs_input", question: "請附上要匯入的角色卡或 JSON 檔案。" }) : item),
      }));
      return { status: "needs_input", summary: "匯入需要一個附件。" };
    }
    let originalContent: string;
    try {
      originalContent = new TextDecoder("utf-8", { fatal: true }).decode(attachment.content).replace(/^\uFEFF/u, "");
    } catch {
      throw new CoreError("SOURCE_DECODE_FAILED", "The attachment content is not valid UTF-8", true);
    }
    const originalHash = contentHash(attachment.content);
    const dryRun = /dry[- ]?run|只檢查|檢視轉換|預覽轉換/iu.test(request);
    let payload: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(originalContent);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("root must be an object");
      payload = parsed as Record<string, unknown>;
    } catch (error) {
      const report = [`原始資料無法解析為 JSON：${error instanceof Error ? error.message : String(error)}`];
      const failureSummary = report[0] ?? "匯入失敗。";
      const record: ImportRecord = { id: internalId("import"), operation_id: operationId, original_name: attachment.name, original_hash: originalHash, original_content: originalContent, report, status: "failed", created_at: now() };
      const state = await this.repository.read();
      await this.repository.commit(state.revision, (current) => ({
        ...current,
        imports: [...current.imports, record],
        operations: current.operations.map((item) => item.id === operationId ? updateOperation(item, { status: "needs_input", question: "匯入檔案不是可解析的 JSON，請提供角色卡 JSON。", result_summary: failureSummary }) : item),
      }));
      return { import_id: record.id, status: "needs_input", summary: failureSummary };
    }

    const knownFields = new Set(["name", "character_name", "char_name", "description", "personality", "scenario", "first_mes", "greeting", "mes_example", "system_prompt", "data", "extensions"]);
    const unknownFields = Object.keys(payload).filter((key) => !knownFields.has(key));
    const report = [
      `保留原始資料 hash ${originalHash}`,
      ...(unknownFields.length === 0 ? ["未發現未知欄位。"] : [`未知欄位已保留，未靜默丟棄：${unknownFields.join(", ")}`]),
      ...(dryRun ? ["這是 dry-run，未寫入 artifact。"] : []),
    ];
    const name = artifactName(payload, attachment);
    const convertedContent = canonicalJson(payload);
    const convertedHash = contentHash(convertedContent);
    const record: ImportRecord = { id: internalId("import"), operation_id: operationId, original_name: attachment.name, original_hash: originalHash, original_content: originalContent, converted_hash: convertedHash, report, status: dryRun ? "dry_run" : "imported", created_at: now() };
    const artifact: ArtifactRecord = {
      id: internalId("artifact"),
      key: keyFor(name),
      kind: "character",
      name,
      content: convertedContent,
      media_type: "application/json",
      content_hash: convertedHash,
      revision: convertedHash,
      status: "draft",
      created_at: now(),
      updated_at: now(),
      created_by: actor,
      operation_id: operationId,
    };
    const summary = dryRun ? `匯入 dry-run 完成，保留 ${unknownFields.length} 個未知欄位，未建立 artifact。` : `匯入完成，已建立角色 artifact「${name}」。`;
    const state = await this.repository.read();
    await this.repository.commit(state.revision, (current) => ({
      ...current,
      ...(current.project_status === "published" && !dryRun ? { project_status: "ready" as const } : {}),
      imports: [...current.imports, record],
      ...(dryRun ? {} : { artifacts: [...current.artifacts, artifact] }),
      operations: current.operations.map((item) => item.id === operationId
        ? updateOperation(item, { status: "completed", result_summary: summary, progress: [...item.progress, { item_id: record.id, status: "completed", message: dryRun ? "import dry-run completed" : "import converted and committed", ...(dryRun ? {} : { artifact_id: artifact.id }) }] })
        : item),
      audit: [...current.audit, {
        id: internalId("audit"),
        operation_id: operationId,
        event: dryRun ? "import.inspected" : "import.committed",
        actor,
        occurred_at: now(),
        project_revision: current.revision + 1,
        details: { import_id: record.id, original_hash: originalHash, converted_hash: convertedHash, unknown_fields: unknownFields },
      }],
    }));
    return { import_id: record.id, ...(dryRun ? {} : { artifact_id: artifact.id }), status: "completed", summary };
  }
}
