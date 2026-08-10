import {
  canonicalJson,
  characterProposalValueSchema,
  contentHash,
  CoreError,
  internalId,
  type ArtifactRecord,
  type ImportRecord,
  type OperationRecord,
  type ProjectRepository,
  type SourceAttachment,
} from "@st-workspace/core";

export interface ImportServiceOptions {
  pngDecoder?: (input: Uint8Array) => Promise<{ authority: "ccv3" | "chara"; card: Record<string, unknown> }>;
}

export interface ImportExecutionResult {
  import_id?: string;
  artifact_id?: string;
  status: "completed" | "needs_input";
  summary: string;
}

interface AttachmentImportResult {
  record: ImportRecord;
  artifact?: ArtifactRecord;
}

function now(): string {
  return new Date().toISOString();
}

function updateOperation(operation: OperationRecord, patch: Partial<OperationRecord>): OperationRecord {
  return { ...operation, ...patch, updated_at: now() };
}

function slugFor(name: string): string {
  return name.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/gu, "") || "imported";
}

function keyFor(name: string): string {
  return `character:${slugFor(name)}`;
}

function artifactName(payload: Record<string, unknown>, attachment: SourceAttachment): string {
  const data = payload.data;
  const nestedName = typeof data === "object" && data !== null ? (data as Record<string, unknown>).name : undefined;
  const name = payload.name ?? payload.character_name ?? payload.char_name ?? nestedName;
  if (typeof name === "string" && name.trim().length > 0) return name.trim().slice(0, 80);
  return attachment.name.replace(/\.[^.]+$/u, "") || "imported-character";
}

function looksLikePng(content: Uint8Array): boolean {
  if (content.length < 8) return false;
  return content[0] === 0x89 && content[1] === 0x50 && content[2] === 0x4e && content[3] === 0x47
    && content[4] === 0x0d && content[5] === 0x0a && content[6] === 0x1a && content[7] === 0x0a;
}

function yamlScalarToken(value: string): unknown {
  const trimmed = value.trim();
  if (trimmed === "") return "";
  if (/^(?:true|false)$/iu.test(trimmed)) return trimmed.toLocaleLowerCase() === "true";
  if (/^-?(?:\d+\.\d+|\d+)(?:e[+-]?\d+)?$/iu.test(trimmed)) return Number(trimmed);
  if (trimmed === "null" || trimmed === "~") return null;
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) return trimmed.slice(1, -1);
  return trimmed;
}

interface YamlLine {
  indent: number;
  raw: string;
  line: number;
}

function parseYamlDocument(text: string): Record<string, unknown> {
  const lines: YamlLine[] = [];
  for (const [index, line] of text.split(/\r?\n/u).entries()) {
    const stripped = line.replace(/#.*$/u, "").trimEnd();
    if (stripped.trim().length === 0 || stripped.trim() === "---") continue;
    lines.push({ indent: line.length - line.trimStart().length, raw: stripped.trim(), line: index + 1 });
  }
  let cursor = 0;
  const parseValue = (minIndent: number): unknown => {
    if (cursor >= lines.length) return undefined;
    const first = lines[cursor] as YamlLine;
    if (first.indent < minIndent) return undefined;
    const listMatch = /^-\s+(.*)$/u.exec(first.raw);
    if (listMatch !== null) {
      const items: unknown[] = [];
      while (cursor < lines.length) {
        const token = lines[cursor] as YamlLine;
        if (token.indent < minIndent) break;
        const match = /^-\s+(.*)$/u.exec(token.raw);
        if (match === null) break;
        cursor += 1;
        const rest = (match[1] ?? "").trim();
        if (rest.length === 0) {
          items.push(parseValue(token.indent + 2));
          continue;
        }
        const inline = /^([^:]+):(?:\s*(.*))?$/u.exec(rest);
        if (inline !== null) {
          const element: Record<string, unknown> = {};
          const key = (inline[1] ?? "").trim();
          const inlineValue = (inline[2] ?? "").trim();
          if (inlineValue.length > 0) {
            element[key] = yamlScalarToken(inlineValue);
          } else {
            cursor += 1;
            const nested = parseValue(token.indent + 2);
            if (nested !== undefined) element[key] = nested;
          }
          while (cursor < lines.length) {
            const next = lines[cursor] as YamlLine;
            if (next.indent !== token.indent || /^-\s+/u.test(next.raw)) break;
            const nextInline = /^([^:]+):(?:\s*(.*))?$/u.exec(next.raw);
            if (nextInline === null) throw new Error(`expected key at line ${next.line}`);
            cursor += 1;
            const nextKey = (nextInline[1] ?? "").trim();
            const nextValue = (nextInline[2] ?? "").trim();
            if (nextValue.length > 0) {
              element[nextKey] = yamlScalarToken(nextValue);
            } else {
              const nested = parseValue(token.indent + 2);
              if (nested !== undefined) element[nextKey] = nested;
            }
          }
          items.push(element);
        } else {
          items.push(yamlScalarToken(rest));
        }
      }
      return items;
    }
    const map: Record<string, unknown> = {};
    while (cursor < lines.length) {
      const token = lines[cursor] as YamlLine;
      if (token.indent < minIndent) break;
      if (/^-\s+/u.test(token.raw)) break;
      const inline = /^([^:]+):(?:\s*(.*))?$/u.exec(token.raw);
      if (inline === null) throw new Error(`expected key at line ${token.line}`);
      cursor += 1;
      const key = (inline[1] ?? "").trim();
      const inlineValue = (inline[2] ?? "").trim();
      if (inlineValue.length > 0) {
        map[key] = yamlScalarToken(inlineValue);
      } else {
        const nested = parseValue(token.indent + 2);
        map[key] = nested === undefined ? "" : nested;
      }
    }
    return map;
  };
  const result = parseValue(0);
  if (result === undefined || Array.isArray(result) || typeof result !== "object") throw new Error("root must be a mapping");
  return result as Record<string, unknown>;
}

function toCharacterProposal(payload: Record<string, unknown>, name: string): unknown {
  const data = typeof payload.data === "object" && payload.data !== null ? (payload.data as Record<string, unknown>) : {};
  const description = typeof payload.description === "string" && payload.description.trim().length > 0
    ? payload.description
    : typeof data.description === "string" ? data.description : "";
  const sections: Array<{ id: string; title: string; content: string }> = [];
  const pushSection = (id: string, title: string, raw: unknown): void => {
    if (typeof raw === "string" && raw.trim().length > 0) sections.push({ id, title, content: raw.trim().slice(0, 4000) });
  };
  pushSection("personality", "Personality", payload.personality);
  pushSection("scenario", "Scenario", payload.scenario);
  pushSection("system-prompt", "System Prompt", payload.system_prompt);
  pushSection("message-examples", "Message Examples", payload.mes_example);
  if (sections.length === 0) pushSection("description", "Description", description);
  return characterProposalValueSchema.parse({
    kind: "character",
    document: {
      schema_version: 1,
      id: slugFor(name),
      display_name: name,
      aliases: [],
      summary: (description.trim().slice(0, 80) || name.slice(0, 80)),
      relationships: [],
      sections,
      fact_refs: [],
      provenance: [],
      extensions: { "card-workspace": { import_source: payload } },
    },
  });
}

function failedRecord(operationId: string, attachment: SourceAttachment, originalHash: string, report: string[]): ImportRecord {
  return { id: internalId("import"), operation_id: operationId, original_name: attachment.name, original_hash: originalHash, original_content: attachment.content.length > 0 ? "[binary or undecodable content]" : "", report, status: "failed", created_at: now() };
}

export class ImportService {
  constructor(
    private readonly repository: ProjectRepository,
    private readonly options: ImportServiceOptions = {},
  ) {}

  private async importAttachment(operationId: string, actor: string, attachment: SourceAttachment, dryRun: boolean): Promise<AttachmentImportResult> {
    const originalHash = contentHash(attachment.content);
    let originalContent = "";
    let originalBinary: string | undefined;
    let payload: Record<string, unknown>;
    let sourceFormat = "json";
    if (looksLikePng(attachment.content)) {
      if (this.options.pngDecoder === undefined) {
        const record = failedRecord(operationId, attachment, originalHash, ["PNG 卡片解析未接入：此環境未提供 PNG decoder。"]);
        return { record };
      }
      try {
        const decoded = await this.options.pngDecoder(attachment.content);
        payload = decoded.card;
        sourceFormat = `png-${decoded.authority}`;
        originalBinary = Buffer.from(attachment.content).toString("base64");
      } catch (error) {
        const record = failedRecord(operationId, attachment, originalHash, [`PNG 卡片解析失敗：${error instanceof Error ? error.message : String(error)}`]);
        return { record };
      }
    } else {
      try {
        originalContent = new TextDecoder("utf-8", { fatal: true }).decode(attachment.content).replace(/^\uFEFF/u, "");
      } catch {
        const record = failedRecord(operationId, attachment, originalHash, ["原始資料不是有效的 UTF-8 文字，且不是 PNG 卡片。"]);
        return { record };
      }
      const yamlLike = /^text\/yaml/iu.test(attachment.media_type ?? "") || /\.ya?ml$/iu.test(attachment.name) || (!originalContent.trimStart().startsWith("{") && /:\s/u.test(originalContent.slice(0, 200)));
      if (yamlLike) {
        try {
          payload = parseYamlDocument(originalContent);
          sourceFormat = "yaml";
        } catch (error) {
          const record = failedRecord(operationId, attachment, originalHash, [`YAML 解析失敗：${error instanceof Error ? error.message : String(error)}`]);
          return { record };
        }
      } else {
        try {
          const parsed: unknown = JSON.parse(originalContent);
          if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("root must be an object");
          payload = parsed as Record<string, unknown>;
        } catch (error) {
          const record = failedRecord(operationId, attachment, originalHash, [`原始資料無法解析為 JSON：${error instanceof Error ? error.message : String(error)}`]);
          return { record };
        }
      }
    }

    const knownFields = new Set(["name", "character_name", "char_name", "description", "personality", "scenario", "first_mes", "greeting", "mes_example", "system_prompt", "data", "extensions"]);
    const unknownFields = Object.keys(payload).filter((key) => !knownFields.has(key));
    const name = artifactName(payload, attachment);
    let proposal: unknown;
    try {
      proposal = toCharacterProposal(payload, name);
    } catch (error) {
      const record = failedRecord(operationId, attachment, originalHash, [`角色卡轉換為內部 Character schema 失敗：${error instanceof Error ? error.message : String(error)}`]);
      return { record };
    }
    const convertedContent = canonicalJson(proposal);
    const convertedHash = contentHash(convertedContent);
    const report = [
      `保留原始資料 hash ${originalHash}`,
      `來源格式：${sourceFormat}。`,
      ...(unknownFields.length === 0 ? ["未發現未知欄位。"] : [`未知欄位已保留，未靜默丟棄：${unknownFields.join(", ")}`]),
      ...(dryRun ? ["這是 dry-run，未寫入 artifact。"] : []),
    ];
    const record: ImportRecord = {
      id: internalId("import"),
      operation_id: operationId,
      original_name: attachment.name,
      original_hash: originalHash,
      original_content: originalContent.length > 0 ? originalContent : (originalBinary !== undefined ? `[png card, ${attachment.name}]` : ""),
      ...(originalBinary === undefined ? {} : { original_binary: originalBinary }),
      attachments: [{ name: attachment.name, media_type: attachment.media_type ?? "application/octet-stream", original_hash: originalHash }],
      converted_hash: convertedHash,
      report,
      status: dryRun ? "dry_run" : "imported",
      created_at: now(),
    };
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
    return { record, artifact };
  }

  async run(operationId: string, request: string, actor: string, attachments: SourceAttachment[]): Promise<ImportExecutionResult> {
    const initial = await this.repository.read();
    const operation = initial.operations.find((item) => item.id === operationId);
    if (operation === undefined) throw new CoreError("OPERATION_NOT_FOUND", `Operation ${operationId} does not exist`);
    if (attachments.length === 0) {
      await this.repository.commit(initial.revision, (current) => ({
        ...current,
        operations: current.operations.map((item) => item.id === operationId ? updateOperation(item, { status: "needs_input", question: "請附上要匯入的角色卡或 JSON 檔案。" }) : item),
      }));
      return { status: "needs_input", summary: "匯入需要至少一個附件。" };
    }
    const dryRun = /dry[- ]?run|只檢查|檢視轉換|預覽轉換/iu.test(request);
    const imported: AttachmentImportResult[] = [];
    const failedRecords: ImportRecord[] = [];
    for (const attachment of attachments) {
      const result = await this.importAttachment(operationId, actor, attachment, dryRun);
      if (result.record.status === "failed") failedRecords.push(result.record);
      else imported.push(result);
    }
    const failedCount = failedRecords.length;
    const summary = imported.length === 0
      ? (failedRecords[0]?.report[0] ?? "匯入失敗。")
      : `匯入完成${failedCount === 0 ? "" : `，${failedCount} 個附件失敗`}，已建立 ${imported.filter((item) => item.artifact !== undefined).length} 個角色 artifact${dryRun ? "（dry-run，未寫入）" : ""}。`;
    const status: "completed" | "needs_input" = imported.length === 0 ? "needs_input" : "completed";
    const state = await this.repository.read();
    await this.repository.commit(state.revision, (current) => ({
      ...current,
      ...(current.project_status === "published" && !dryRun && imported.length > 0 ? { project_status: "ready" as const } : {}),
      imports: [...current.imports, ...imported.map((item) => item.record), ...failedRecords],
      ...(dryRun ? {} : { artifacts: [...current.artifacts, ...imported.flatMap((item) => item.artifact === undefined ? [] : [item.artifact])] }),
      operations: current.operations.map((item) => item.id === operationId
        ? updateOperation(item, {
          status,
          ...(status === "needs_input" ? { question: "匯入失敗，請檢查附件格式後重試。" } : {}),
          result_summary: summary,
          progress: [...item.progress, ...imported.map((entry) => ({ item_id: entry.record.id, status: "completed" as const, message: dryRun ? "import dry-run completed" : "import converted and committed", ...(dryRun || entry.artifact === undefined ? {} : { artifact_id: entry.artifact.id }) }))],
        })
        : item),
      audit: [...current.audit, {
        id: internalId("audit"),
        operation_id: operationId,
        event: dryRun ? "import.inspected" : "import.committed",
        actor,
        occurred_at: now(),
        project_revision: current.revision + 1,
        details: { import_ids: imported.map((item) => item.record.id), failed_count: failedCount },
      }],
    }));
    return { ...(imported[0] === undefined ? {} : { import_id: imported[0].record.id }), ...(dryRun ? {} : imported[0]?.artifact === undefined ? {} : { artifact_id: imported[0].artifact.id }), status, summary };
  }
}
