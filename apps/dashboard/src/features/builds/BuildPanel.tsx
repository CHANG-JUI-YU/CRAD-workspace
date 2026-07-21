import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { apiFetch } from "../../api/client";
import type { ProjectDetail, Workflow } from "../../api/types";

interface AuditFinding {
  rule_id: string;
  layer: "normative" | "compatibility" | "workspace";
  severity: "error" | "warning" | "info";
  message: string;
  hint?: string;
  overridable: boolean;
}

interface CompilePreview {
  id: string;
  revision: string;
  input_revision: string;
  created_at: string;
  options: { strict: boolean; token_budget?: number; json: boolean; png: boolean; v2_backfill: boolean };
  audit: { ok: boolean; blocked: boolean; findings: AuditFinding[]; summary: { errors: number; warnings: number; info: number } };
  artifact_hashes: Record<string, string>;
}

interface PreviewItem { preview: CompilePreview; status: string; updated_at: string }
interface ExportItem { id: string; bytes: number; modified_at: string; read_only: true }
interface RoundTripResult {
  envelope: { format: string; source_revision: string; card: { data: { name: string } } };
  report: { status: "equivalent" | "expected_loss" | "unexpected_loss"; differences: Array<{ path: string; classification: string; reason: string }> };
}

export function BuildPanel({ projectId, project }: { projectId: string; project: ProjectDetail }) {
  const queryClient = useQueryClient();
  const previews = useQuery({ queryKey: ["previews", projectId], queryFn: () => apiFetch<PreviewItem[]>(`/api/builds/${projectId}/previews`) });
  const exportsQuery = useQuery({ queryKey: ["exports", projectId], queryFn: () => apiFetch<ExportItem[]>(`/api/builds/${projectId}/exports`) });
  const workflow = useQuery({ queryKey: ["workflow", projectId], queryFn: () => apiFetch<Workflow>(`/api/workflow/${projectId}`), initialData: project.workflow });
  const [selectedId, setSelectedId] = useState<string>();
  const [strict, setStrict] = useState(true);
  const [json, setJson] = useState(true);
  const [png, setPng] = useState(false);
  const [v2Backfill, setV2Backfill] = useState(false);

  useEffect(() => {
    if (!selectedId && previews.data?.[0]) setSelectedId(previews.data[0].preview.id);
  }, [previews.data, selectedId]);

  const selected = previews.data?.find((item) => item.preview.id === selectedId) ?? previews.data?.[0];
  const createPreview = useMutation({
    mutationFn: () => {
      const stamp = Date.now();
      return apiFetch<CompilePreview>("/api/builds/preview", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ project_id: projectId, preview_id: `preview-${stamp}`, event_id: `dashboard-preview-${stamp}`, strict, json, png, v2_backfill: v2Backfill }),
      });
    },
    onSuccess: async (preview) => {
      setSelectedId(preview.id);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["previews", projectId] }),
        queryClient.invalidateQueries({ queryKey: ["workflow", projectId] }),
        queryClient.invalidateQueries({ queryKey: ["project", projectId] }),
      ]);
    },
  });
  const publish = useMutation({
    mutationFn: async () => {
      if (!selected || !workflow.data) throw new Error("尚未選擇可發布的 preview");
      const stamp = Date.now();
      await apiFetch("/api/workflow/gate", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          project_id: projectId, expected_workflow_revision: workflow.data.revision,
          event_id: `dashboard-publish-gate-${stamp}`, decision_id: `publish-${stamp}`,
          gate_id: "publish", action: "approve", summary: `Approve exact preview ${selected.preview.id}`,
          input_revisions: [{ id: selected.preview.id, revision: selected.preview.revision }],
          findings: selected.preview.audit.findings.map((finding) => ({
            id: finding.rule_id,
            category: finding.layer === "compatibility" ? "schema" : finding.layer,
            severity: finding.severity,
            overridable: finding.overridable,
          })),
        }),
      });
      return apiFetch("/api/builds/publish", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ project_id: projectId, preview_id: selected.preview.id, event_id: `dashboard-publish-${stamp}` }),
      });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["exports", projectId] }),
        queryClient.invalidateQueries({ queryKey: ["workflow", projectId] }),
        queryClient.invalidateQueries({ queryKey: ["project", projectId] }),
      ]);
    },
  });

  const busy = createPreview.isPending || publish.isPending;
  const publishDisabled = busy || !selected || selected.status === "stale" || selected.preview.audit.blocked;
  return <section>
    <p className="eyebrow">RELEASE CONTROL</p><h1>編譯、Audit與輸出</h1>
    <div className="build-toolbar">
      <Check label="Strict" checked={strict} set={setStrict} />
      <Check label="JSON" checked={json} set={setJson} />
      <Check label="PNG" checked={png} set={setPng} />
      <Check label="V2 Backfill" checked={v2Backfill} set={setV2Backfill} />
      <button className="action" disabled={busy || (!json && !png)} onClick={() => createPreview.mutate()}>建立Exact Preview</button>
    </div>
    {errorMessage(createPreview.error ?? publish.error) && <p className="editor-error">{errorMessage(createPreview.error ?? publish.error)}</p>}
    <div className="build-workbench">
      <aside>
        <h2>Preview History</h2>
        {previews.isPending && <p className="empty">載入 preview...</p>}
        {previews.data?.map((item) => <button key={item.preview.id} className={selected?.preview.id === item.preview.id ? "active" : ""} onClick={() => setSelectedId(item.preview.id)}>
          <b>{item.preview.id}</b><small>{item.status} / {new Date(item.updated_at).toLocaleString()}</small>
        </button>)}
        {!previews.isPending && previews.data?.length === 0 && <p className="empty">尚無 preview</p>}
      </aside>
      <article>
        {selected ? <>
          <header className="build-summary"><div><h2>{selected.preview.id}</h2><code>{selected.preview.revision}</code></div><span className={`status status-${selected.status}`}>{selected.status}</span></header>
          <div className="metric-grid audit-metrics"><Metric label="Errors" value={selected.preview.audit.summary.errors} /><Metric label="Warnings" value={selected.preview.audit.summary.warnings} /><Metric label="Info" value={selected.preview.audit.summary.info} /><Metric label="Artifacts" value={Object.keys(selected.preview.artifact_hashes).length} /></div>
          <p className="build-formats">JSON <b>{yesNo(selected.preview.options.json)}</b> / PNG <b>{yesNo(selected.preview.options.png)}</b> / V2 <b>{yesNo(selected.preview.options.v2_backfill)}</b> / Strict <b>{yesNo(selected.preview.options.strict)}</b></p>
          <AuditLayers findings={selected.preview.audit.findings} />
          <div className="publish-gate"><div><b>Publish Gate</b><small>僅批准並發布此 preview revision 與 artifact hashes。</small></div><button className="action" disabled={publishDisabled} onClick={() => publish.mutate()}>{publish.isPending ? "發布中..." : "Approve Exact Preview & Publish"}</button></div>
          {publish.isSuccess && <p className="publish-success">發布完成，Exports 已更新。</p>}
        </> : <p className="empty">建立或選擇 preview 以檢視 Audit。</p>}
      </article>
    </div>
    <div className="section-grid">
      <RoundTripPanel />
      <article><h2>Exports（唯讀）</h2><div className="export-list">{exportsQuery.data?.map((item) => <a key={item.id} href={`/api/builds/${encodeURIComponent(projectId)}/export/${encodeURIComponent(item.id)}`} download><b>{item.id}</b><span>{formatBytes(item.bytes)} / {new Date(item.modified_at).toLocaleString()}</span></a>)}{exportsQuery.data?.length === 0 && <p className="empty">尚無已發布輸出</p>}</div></article>
    </div>
  </section>;
}

function Check({ label, checked, set }: { label: string; checked: boolean; set: (value: boolean) => void }) {
  return <label className="build-check"><input type="checkbox" checked={checked} onChange={(event) => set(event.target.checked)} /><span>{label}</span></label>;
}

function Metric({ label, value }: { label: string; value: number }) { return <div className="metric"><span>{label}</span><b>{value}</b></div>; }

function AuditLayers({ findings }: { findings: AuditFinding[] }) {
  return <div className="audit-layers">{(["normative", "compatibility", "workspace"] as const).map((layer) => {
    const layerFindings = findings.filter((finding) => finding.layer === layer);
    return <div key={layer}><h3>{layer}</h3>{layerFindings.map((finding, index) => <div className={`audit-finding severity-${finding.severity}`} key={`${finding.rule_id}-${index}`}><b>{finding.rule_id}</b><span>{finding.message}</span>{finding.hint && <small>{finding.hint}</small>}</div>)}{layerFindings.length === 0 && <p className="empty">No findings</p>}</div>;
  })}</div>;
}

function RoundTripPanel() {
  const [fileName, setFileName] = useState("");
  const roundTrip = useMutation({ mutationFn: async (file: File) => apiFetch<RoundTripResult>("/api/builds/roundtrip", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ bytes_base64: bytesToBase64(new Uint8Array(await file.arrayBuffer())) }) }) });
  return <article><h2>Round-trip Loss</h2><label className="file-input"><span>{fileName || "選擇角色卡 JSON/PNG"}</span><input aria-label="Round-trip card" type="file" accept=".json,.png,application/json,image/png" onChange={(event) => { const file = event.target.files?.[0]; if (file) { setFileName(file.name); roundTrip.mutate(file); } }} /></label>
    {roundTrip.isPending && <p className="empty">分析中...</p>}
    {errorMessage(roundTrip.error) && <p className="editor-error">{errorMessage(roundTrip.error)}</p>}
    {roundTrip.data && <><p className={`roundtrip-status status-${roundTrip.data.report.status}`}>{roundTrip.data.envelope.card.data.name} / {roundTrip.data.report.status}</p>{roundTrip.data.report.differences.map((difference, index) => <div className="roundtrip-diff" key={`${difference.path}-${index}`}><code>{difference.path}</code><b>{difference.classification}</b><span>{difference.reason}</span></div>)}{roundTrip.data.report.differences.length === 0 && <p className="good">Equivalent：未偵測到 loss。</p>}</>}
  </article>;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : ""; }
function yesNo(value: boolean): string { return value ? "ON" : "OFF"; }
function formatBytes(bytes: number): string { return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`; }
