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
  artifacts?: ArtifactRecord[];
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
  content: string;
  original: string;
  line: number;
}

/** Removes a YAML comment while respecting quoted strings and the requirement
 * that a comment marker must be preceded by whitespace or start the line. */
function stripYamlComment(line: string): string {
  let inDouble = false;
  let inSingle = false;
  for (let index = 0; index < line.length; index += 1) {
    const ch = line[index] as string;
    if (ch === '"' && !inSingle && (index === 0 || line[index - 1] !== "\\")) inDouble = !inDouble;
    else if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === "#" && !inDouble && !inSingle && (index === 0 || /\s/u.test(line[index - 1] as string))) return line.slice(0, index);
  }
  return line;
}

const BLOCK_SCALAR = /^([|>])([+-]?)(\d*)$/u;

/** Reads the literal (|) or folded (>) block scalar that starts at `start`.
 * Content lines must be indented beyond `baseIndent` (the key line indent);
 * blank lines inside the block are preserved. */
function readBlockScalar(lines: YamlLine[], start: number, baseIndent: number, style: string, strip: boolean): { text: string; cursor: number } {
  const collected: string[] = [];
  let contentIndent: number | undefined;
  let cursor = start;
  while (cursor < lines.length) {
    const token = lines[cursor] as YamlLine;
    if (token.content.trim().length === 0) {
      collected.push("");
      cursor += 1;
      continue;
    }
    if (token.indent <= baseIndent) break;
    if (contentIndent === undefined) contentIndent = token.indent;
    collected.push(token.original);
    cursor += 1;
  }
  const minIndent = contentIndent ?? baseIndent + 1;
  let text = collected.map((line) => (line.trim().length === 0 ? "" : line.slice(Math.min(minIndent, line.length)))).join("\n");
  if (style === ">") {
    let folded = "";
    let pendingNewline = false;
    for (const line of text.split("\n")) {
      if (line.length === 0) {
        pendingNewline = true;
        continue;
      }
      if (folded.length === 0) folded = line;
      else if (pendingNewline) folded += `\n${line}`;
      else folded += ` ${line}`;
      pendingNewline = false;
    }
    text = folded;
  }
  if (strip) text = text.replace(/\n+$/u, "");
  else if (text.length > 0 && text !== "\n") text = `${text.replace(/\n*$/u, "")}\n`;
  return { text, cursor };
}

function parseYamlDocument(text: string): Record<string, unknown> {
  const lines: YamlLine[] = [];
  for (const [index, line] of text.split(/\r?\n/u).entries()) {
    const stripped = stripYamlComment(line);
    if (stripped.trim().length === 0 || stripped.trim() === "---") continue;
    lines.push({ indent: stripped.length - stripped.trimStart().length, raw: stripped.trim(), content: stripped, original: line, line: index + 1 });
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
            const block = BLOCK_SCALAR.exec(inlineValue);
            if (block !== null) {
              const read = readBlockScalar(lines, cursor, token.indent, block[1] as string, block[2] === "-");
              cursor = read.cursor;
              element[key] = read.text;
            } else {
              element[key] = yamlScalarToken(inlineValue);
            }
          } else {
            cursor += 1;
            const nested = parseValue(token.indent + 2);
            if (nested !== undefined) element[key] = nested;
          }
          while (cursor < lines.length) {
            const next = lines[cursor] as YamlLine;
            if (next.indent !== token.indent + 2 || /^-\s+/u.test(next.raw)) break;
            const nextInline = /^([^:]+):(?:\s*(.*))?$/u.exec(next.raw);
            if (nextInline === null) throw new Error(`expected key at line ${next.line}`);
            cursor += 1;
            const nextKey = (nextInline[1] ?? "").trim();
            const nextValue = (nextInline[2] ?? "").trim();
            if (nextValue.length > 0) {
              const block = BLOCK_SCALAR.exec(nextValue);
              if (block !== null) {
                const read = readBlockScalar(lines, cursor, token.indent + 2, block[1] as string, block[2] === "-");
                cursor = read.cursor;
                element[nextKey] = read.text;
              } else {
                element[nextKey] = yamlScalarToken(nextValue);
              }
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
        const block = BLOCK_SCALAR.exec(inlineValue);
        if (block !== null) {
          const read = readBlockScalar(lines, cursor, token.indent, block[1] as string, block[2] === "-");
          cursor = read.cursor;
          map[key] = read.text;
        } else {
          map[key] = yamlScalarToken(inlineValue);
        }
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

function topOrData(payload: Record<string, unknown>, key: string): string {
  const top = payload[key];
  if (typeof top === "string" && top.trim().length > 0) return top.trim();
  const data = typeof payload.data === "object" && payload.data !== null ? (payload.data as Record<string, unknown>) : {};
  const nested = data[key];
  return typeof nested === "string" && nested.trim().length > 0 ? nested.trim() : "";
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
  pushSection("personality", "Personality", topOrData(payload, "personality"));
  pushSection("scenario", "Scenario", topOrData(payload, "scenario"));
  pushSection("system-prompt", "System Prompt", topOrData(payload, "system_prompt"));
  pushSection("message-examples", "Message Examples", topOrData(payload, "mes_example"));
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

/** Extracts greeting content from V1 top-level fields and V2/V3 data fields. */
function importGreetings(payload: Record<string, unknown>, characterId: string): Array<{ kind: "primary" | "alternate" | "group_only"; content: string; character_ids: string[] }> {
  const data = typeof payload.data === "object" && payload.data !== null ? (payload.data as Record<string, unknown>) : {};
  const primary = topOrData(payload, "first_mes");
  const alternate = Array.isArray(data.alternate_greetings)
    ? data.alternate_greetings.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  const groupOnly = Array.isArray(data.group_only_greetings)
    ? data.group_only_greetings.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  const greetings: Array<{ kind: "primary" | "alternate" | "group_only"; content: string; character_ids: string[] }> = [];
  if (primary.length > 0) greetings.push({ kind: "primary", content: primary, character_ids: [characterId] });
  for (const content of alternate) greetings.push({ kind: "alternate", content, character_ids: [characterId] });
  for (const content of groupOnly) greetings.push({ kind: "group_only", content, character_ids: [characterId] });
  return greetings;
}

/** Extracts CCv3 character_book entries into the world_lore artifact shape. */
function importWorldEntries(payload: Record<string, unknown>): { name?: string; entries: Array<{ id: string; title: string; content: string; aliases?: string[]; keys?: string[] }> } {
  const data = typeof payload.data === "object" && payload.data !== null ? (payload.data as Record<string, unknown>) : {};
  const book = data.character_book;
  if (book === null || typeof book !== "object" || Array.isArray(book)) return { entries: [] };
  const bookRecord = book as Record<string, unknown>;
  const name = typeof bookRecord.name === "string" && bookRecord.name.trim().length > 0 ? bookRecord.name.trim() : undefined;
  const rawEntries = bookRecord.entries;
  if (!Array.isArray(rawEntries)) return { entries: [] };
  const entries: Array<{ id: string; title: string; content: string; aliases?: string[]; keys?: string[] }> = [];
  for (const [index, rawEntry] of rawEntries.entries()) {
    if (rawEntry === null || typeof rawEntry !== "object" || Array.isArray(rawEntry)) continue;
    const entryRecord = rawEntry as Record<string, unknown>;
    const content = typeof entryRecord.content === "string" ? entryRecord.content.trim() : "";
    if (content.length === 0) continue;
    const keys = Array.isArray(entryRecord.keys)
      ? entryRecord.keys.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [];
    const order = entryRecord.insertion_order;
    const id = typeof order === "number" ? `entry-${order}` : `entry-${index + 1}`;
    const title = typeof entryRecord.name === "string" && entryRecord.name.trim().length > 0 ? entryRecord.name.trim() : keys[0] ?? id;
    entries.push({ id, title, content, ...(keys.length > 0 ? { aliases: keys, keys } : {}) });
  }
  return { ...(name === undefined ? {} : { name }), entries };
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
    const characterId = slugFor(name);
    const characterArtifact: ArtifactRecord = {
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
    const artifacts: ArtifactRecord[] = [characterArtifact];
    const greetings = importGreetings(payload, characterId);
    const world = importWorldEntries(payload);
    if (greetings.length > 0) {
      const greetingContent = canonicalJson({ document: { schema_version: 1, greetings } });
      artifacts.push({
        id: internalId("artifact"),
        key: `greeting:${characterId}`,
        kind: "greeting",
        name: `${name}_問候`,
        content: greetingContent,
        media_type: "application/json",
        content_hash: contentHash(greetingContent),
        revision: contentHash(greetingContent),
        status: "draft",
        created_at: now(),
        updated_at: now(),
        created_by: actor,
        operation_id: operationId,
      });
    }
    if (world.entries.length > 0) {
      const worldContent = canonicalJson({ schema_version: 1, ...(world.name === undefined ? {} : { name: world.name }), entries: world.entries });
      artifacts.push({
        id: internalId("artifact"),
        key: `world_lore:${characterId}`,
        kind: "world_lore",
        name: world.name ?? `${name}_世界書`,
        content: worldContent,
        media_type: "application/json",
        content_hash: contentHash(worldContent),
        revision: contentHash(worldContent),
        status: "draft",
        created_at: now(),
        updated_at: now(),
        created_by: actor,
        operation_id: operationId,
      });
    }
    const sectionFields = ["personality", "scenario", "system_prompt", "mes_example"].filter((key) => topOrData(payload, key).length > 0);
    const fieldReport = [
      "欄位對應：",
      `name→Character(名稱)、description→Character(摘要)`,
      `personality/scenario/system_prompt/mes_example→Character(sections: ${sectionFields.length > 0 ? `已建立 ${sectionFields.length} 節` : "未提供"})`,
      `first_mes→Greeting(primary: ${greetings.some((item) => item.kind === "primary") ? "已建立" : "未提供"})`,
      `alternate_greetings→Greeting(alternate: ${greetings.filter((item) => item.kind === "alternate").length} 組)`,
      `group_only_greetings→Greeting(group_only: ${greetings.filter((item) => item.kind === "group_only").length} 組)`,
      `character_book→World(entries: ${world.entries.length} 條${world.name === undefined ? "" : `，書名「${world.name}」`})`,
      "其餘欄位保留於 raw import_source。",
    ];
    const report = [
      `保留原始資料 hash ${originalHash}`,
      `來源格式：${sourceFormat}。`,
      ...(unknownFields.length === 0 ? ["未發現未知欄位。"] : [`未知欄位已保留，未靜默丟棄：${unknownFields.join(", ")}`]),
      ...fieldReport,
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
    return { record, artifacts };
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
    const importedArtifacts = imported.flatMap((item) => item.artifacts ?? []);
    const characterCount = importedArtifacts.filter((item) => item.kind === "character").length;
    const greetingCount = importedArtifacts.filter((item) => item.kind === "greeting").length;
    const worldCount = importedArtifacts.filter((item) => item.kind === "world_lore").length;
    const summary = imported.length === 0
      ? (failedRecords[0]?.report[0] ?? "匯入失敗。")
      : `匯入完成${failedCount === 0 ? "" : `，${failedCount} 個附件失敗`}，已建立 ${importedArtifacts.length} 個 artifact（角色 ${characterCount}、問候 ${greetingCount}、世界 ${worldCount}）${dryRun ? "（dry-run，未寫入）" : ""}。`;
    const status: "completed" | "needs_input" = imported.length === 0 ? "needs_input" : "completed";
    const state = await this.repository.read();
    await this.repository.commit(state.revision, (current) => {
      const existingByKeyHash = new Set(current.artifacts.filter((item) => importedArtifacts.some((entry) => entry.key === item.key)).map((item) => `${item.key}:${item.content_hash}`));
      return {
        ...current,
        ...(current.project_status === "published" && !dryRun && imported.length > 0 ? { project_status: "ready" as const } : {}),
        imports: [...current.imports, ...imported.map((item) => item.record), ...failedRecords],
        ...(dryRun ? {} : {
          artifacts: [
            ...current.artifacts,
            ...importedArtifacts
              .filter((artifact) => !existingByKeyHash.has(`${artifact.key}:${artifact.content_hash}`)),
          ],
        }),
      operations: current.operations.map((item) => item.id === operationId
        ? updateOperation(item, {
          status,
          ...(status === "needs_input" ? { question: "匯入失敗，請檢查附件格式後重試。" } : {}),
          result_summary: summary,
          progress: [...item.progress, ...imported.map((entry) => ({ item_id: entry.record.id, status: "completed" as const, message: dryRun ? "import dry-run completed" : "import converted and committed", ...(dryRun || entry.artifacts === undefined || entry.artifacts.length === 0 ? {} : { artifact_id: (entry.artifacts[0] as ArtifactRecord).id }) }))],
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
    };
    });
    return { ...(imported[0] === undefined ? {} : { import_id: imported[0].record.id }), ...(dryRun || importedArtifacts.length === 0 ? {} : { artifact_id: (importedArtifacts[0] as ArtifactRecord).id }), status, summary };
  }
}
