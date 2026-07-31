import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { lazy, Suspense, useEffect, useState } from "react";
import { parse, stringify } from "yaml";

import { apiFetch } from "../../api/client";
import { buildPatch } from "./patch";

interface ResourceRef { project_id: string; kind: string; id: string; owner_id?: string }
interface DocumentResult { resource: ResourceRef; format: "yaml" | "json"; value: unknown; semantic_revision: string; raw_revision: string; read_only: boolean }
interface PatchResult { differences: unknown[]; value: unknown; after_revision: string; no_op: boolean; dry_run: boolean }

const MonacoEditor = lazy(async () => {
  const [editor] = await Promise.all([import("@monaco-editor/react"), import("./monaco")]);
  return { default: editor.default };
});

function serialize(value: unknown, format: "yaml" | "json"): string {
  return format === "yaml" ? stringify(value, { lineWidth: 0 }) : JSON.stringify(value, null, 2);
}

export function ResourceEditor({ resource, label }: { resource: ResourceRef; label: string }) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<"form" | "advanced">("form");
  const [draft, setDraft] = useState<unknown>();
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<PatchResult>();
  const [parseError, setParseError] = useState<string>();
  const query = useQuery({
    queryKey: ["document", resource],
    queryFn: () => apiFetch<DocumentResult>("/api/documents/read", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(resource),
    }),
  });

  useEffect(() => {
    if (query.data === undefined) return;
    setDraft(query.data.value);
    setText(serialize(query.data.value, query.data.format));
    setPreview(undefined);
    setParseError(undefined);
  }, [query.data]);

  const mutation = useMutation({
    mutationFn: async (dryRun: boolean) => {
      if (query.data === undefined || draft === undefined) throw new Error("文件尚未載入");
      return apiFetch<PatchResult>("/api/documents/patch", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ resource, expected_revision: query.data.semantic_revision, operations: buildPatch(query.data.value, draft), dry_run: dryRun }),
      });
    },
    onSuccess: (result, dryRun) => {
      setPreview(dryRun ? result : undefined);
      if (!dryRun) {
        void queryClient.invalidateQueries({ queryKey: ["document", resource] });
        void queryClient.invalidateQueries({ queryKey: ["project", resource.project_id] });
      }
    },
  });

  function updateDraft(next: unknown): void {
    if (query.data === undefined) return;
    setDraft(next);
    setText(serialize(next, query.data.format));
    setParseError(undefined);
    setPreview(undefined);
  }

  function updateText(value: string | undefined): void {
    const next = value ?? "";
    setText(next);
    setPreview(undefined);
    try {
      setDraft(query.data?.format === "yaml" ? parse(next) : JSON.parse(next));
      setParseError(undefined);
    } catch (error) {
      setParseError(error instanceof Error ? error.message : String(error));
    }
  }

  if (query.isLoading) return <div className="editor-loading">載入 {label}...</div>;
  if (query.error instanceof Error) return <div className="pane-error">{query.error.message}</div>;
  if (query.data === undefined) return null;

  const operations = draft === undefined ? [] : buildPatch(query.data.value, draft);
  return <section className="resource-editor">
    <header><div><p className="eyebrow">TYPED DOCUMENT</p><h2>{label}</h2></div><code>{query.data.semantic_revision.slice(0, 19)}...</code></header>
    <nav className="editor-tabs"><button className={mode === "form" ? "active" : ""} onClick={() => setMode("form")}>表單</button><button className={mode === "advanced" ? "active" : ""} onClick={() => setMode("advanced")}>Advanced</button></nav>
    {mode === "form" ? <PrimitiveForm value={draft} onChange={updateDraft} /> : <div className="monaco-wrap"><Suspense fallback={<p className="empty">載入編輯器...</p>}><MonacoEditor height="480px" language={query.data.format} theme="vs-dark" value={text} onChange={updateText} options={{ minimap: { enabled: false }, fontSize: 13, wordWrap: "on", automaticLayout: true }} /></Suspense></div>}
    {parseError && <div className="editor-error">{parseError}</div>}
    {preview && <div className="diff-summary"><b>{preview.differences.length}</b> semantic changes {preview.no_op ? "（無變更）" : ""}</div>}
    <footer><span>{operations.length} patch operations</span><button disabled={operations.length === 0 || parseError !== undefined || mutation.isPending} onClick={() => mutation.mutate(true)}>Dry-run</button><button className="primary" disabled={preview === undefined || parseError !== undefined || mutation.isPending} onClick={() => mutation.mutate(false)}>確認儲存</button></footer>
    {mutation.error instanceof Error && <div className="editor-error">{mutation.error.message}</div>}
  </section>;
}

function PrimitiveForm({ value, onChange }: { value: unknown; onChange: (value: unknown) => void }) {
  if (!isRecord(value)) return <p className="empty">複雜內容請使用Advanced editor。</p>;
  const primitive = Object.entries(value).filter(([, item]) => ["string", "number", "boolean"].includes(typeof item));
  return <div className="schema-form">{primitive.map(([key, item]) => <label key={key}><span>{key}</span>{typeof item === "boolean" ? <input type="checkbox" checked={item} onChange={(event) => onChange({ ...value, [key]: event.target.checked })} /> : <input value={String(item)} disabled={["schema_version", "id", "mode", "module", "category"].includes(key)} onChange={(event) => onChange({ ...value, [key]: typeof item === "number" ? Number(event.target.value) : event.target.value })} />}</label>)}<p>陣列、巢狀設定與sections請使用Advanced editor。</p></div>;
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
