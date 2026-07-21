import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { lazy, Suspense, useEffect, useState } from "react";

import { apiFetch } from "../../api/client";
import type { PluginDashboardState, PluginProposal, PluginRevisionIntent, PluginSelection, ProjectDetail } from "../../api/types";
import { BuildPanel } from "../builds/BuildPanel";
import { FactsPanel } from "../facts/FactsPanel";
const ResourceEditor = lazy(() => import("../editor/ResourceEditor").then((module) => ({ default: module.ResourceEditor })));
const GraphPanel = lazy(() => import("../graphs/GraphPanel").then((module) => ({ default: module.GraphPanel })));

const pluginCapabilityOptions: Array<{ plugin_id: PluginSelection["plugin_id"] ; capability: PluginSelection["capabilities"][number]; label: string }> = [
  { plugin_id: "official.mvu-zod", capability: "mvu", label: "MVU / Zod" },
  { plugin_id: "official.ejs", capability: "ejs", label: "EJS" },
  { plugin_id: "official.html", capability: "html.status_bar", label: "HTML 狀態欄" },
  { plugin_id: "official.html", capability: "html.message_presentation", label: "HTML 訊息美化" },
  { plugin_id: "official.html", capability: "html.greeting_selector", label: "HTML 開場選擇器" },
];

export function DashboardSection({ section, projectId, project }: { section: string; projectId: string; project: ProjectDetail }) {
  if (section === "characters") return <Characters projectId={projectId} project={project} />;
  if (section === "world") return <World projectId={projectId} project={project} />;
  if (section === "greetings") return <Suspense fallback={<p className="empty">載入編輯器...</p>}><ResourceEditor label="專案開場白" resource={{ project_id: projectId, kind: "greetings", id: "greetings" }} /></Suspense>;
  if (section === "sources") return <Sources projectId={projectId} />;
  if (section === "facts") return <FactsPanel projectId={projectId} project={project} />;
  if (section === "planner") return <Planner projectId={projectId} />;
  if (section === "builds") return <BuildPanel projectId={projectId} project={project} />;
  if (section === "plugins") return <Plugins projectId={projectId} />;
  return null;
}

function Plugins({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [confirmation, setConfirmation] = useState<{ proposal: PluginProposal; action: "approve" | "reject" }>();
  const [revisionSelections, setRevisionSelections] = useState<PluginSelection[]>([]);
  const state = useQuery({
    queryKey: ["plugins", projectId],
    queryFn: () => apiFetch<PluginDashboardState>(`/api/plugins/${projectId}`),
  });
  useEffect(() => {
    if (state.data === undefined) return;
    setRevisionSelections(normalizePluginSelections(state.data.selection?.selections ?? state.data.blueprint_selections));
  }, [state.data]);
  const review = useMutation({
    mutationFn: async ({ proposal, action }: { proposal: PluginProposal; action: "approve" | "reject" }) => {
      const workflowRevision = state.data?.workflow_revision;
      if (workflowRevision === undefined) throw new Error("Workflow revision unavailable");
      const token = await apiFetch<{ token: string }>(`/api/plugins/${projectId}/decision-token`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          proposal_id: proposal.id,
          proposal_revision: proposal.proposal_revision,
          decision: action,
          workflow_revision: workflowRevision,
        }),
      });
      return apiFetch(`/api/plugins/${projectId}/review`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expected_workflow_revision: workflowRevision,
          proposal,
          action,
          authorization_token: token.token,
          occurred_at: new Date().toISOString(),
        }),
      });
    },
    onSuccess: async () => {
      setConfirmation(undefined);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["plugins", projectId] }),
        queryClient.invalidateQueries({ queryKey: ["project", projectId] }),
      ]);
    },
  });
  const revisionPreview = useMutation({
    mutationFn: async () => {
      const workflowRevision = state.data?.workflow_revision;
      if (workflowRevision === undefined) throw new Error("Workflow revision unavailable");
      return apiFetch<{ intent: PluginRevisionIntent; workflow_revision: number }>(`/api/plugins/${projectId}/revision-preview`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expected_workflow_revision: workflowRevision, desired_selections: revisionSelections }),
      });
    },
  });
  const revisionBegin = useMutation({
    mutationFn: async () => {
      const workflowRevision = state.data?.workflow_revision;
      const intent = revisionPreview.data?.intent;
      if (workflowRevision === undefined || intent === undefined) throw new Error("請先建立仍有效的 revision preview");
      return apiFetch<{ workflow: unknown; intent: PluginRevisionIntent }>(`/api/plugins/${projectId}/revision-begin`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expected_workflow_revision: workflowRevision,
          desired_selections: intent.selections,
          event_id: `plugin-revision-begin-${Date.now()}`,
          occurred_at: new Date().toISOString(),
        }),
      });
    },
    onSuccess: async () => {
      revisionPreview.reset();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["plugins", projectId] }),
        queryClient.invalidateQueries({ queryKey: ["project", projectId] }),
      ]);
    },
  });

  const toggleCapability = (pluginId: PluginSelection["plugin_id"], capability: PluginSelection["capabilities"][number]) => {
    revisionPreview.reset();
    setRevisionSelections((current) => {
      const existing = current.find((selection) => selection.plugin_id === pluginId);
      const hasCapability = existing?.capabilities.includes(capability) ?? false;
      const nextCapabilities = hasCapability
        ? (existing?.capabilities ?? []).filter((item) => item !== capability)
        : [...(existing?.capabilities ?? []), capability];
      const next = current.filter((selection) => selection.plugin_id !== pluginId);
      if (nextCapabilities.length > 0) next.push({ plugin_id: pluginId, capabilities: nextCapabilities });
      return normalizePluginSelections(next);
    });
  };

  if (state.isLoading) return <section><p className="eyebrow">PLUGIN REVIEW</p><h1>載入中...</h1></section>;
  if (state.error instanceof Error) return <section><p className="eyebrow">PLUGIN REVIEW</p><h1>無法載入</h1><p className="empty">{state.error.message}</p></section>;
  const proposals = state.data?.pending_proposals ?? [];
  return <section>
    <p className="eyebrow">PLUGIN REVIEW</p>
    <h1>官方擴充審查</h1>
    <div className="plugin-review-header">
      <p className="empty">{state.data?.workflow_stage ?? "--"} · revision {state.data?.workflow_revision ?? "--"}</p>
      <span className="status status-approved">Dashboard session · CSRF protected</span>
    </div>
    <div className="plugin-review-metrics">
      <div><span>Active sources</span><b>{state.data?.sources.length ?? 0}</b></div>
      <div><span>Approved artifacts</span><b>{state.data?.artifacts.length ?? 0}</b></div>
      <div><span>Diagnostics</span><b className={state.data?.diagnostics.length ? "bad" : "good"}>{state.data?.diagnostics.length ?? 0}</b></div>
    </div>
    <article className="plugin-revision-controls">
      <div className="plugin-review-header"><div><h2>Plugin Revision</h2><p className="empty">只提交能力選擇；implementation pin 由伺服器 registry 解析。</p></div><span className="status status-pending">Immutable intent</span></div>
      <div className="plugin-capability-grid">
        {pluginCapabilityOptions.map((option) => <label key={`${option.plugin_id}-${option.capability}`}>
          <input
            type="checkbox"
            checked={revisionSelections.some((selection) => selection.plugin_id === option.plugin_id && selection.capabilities.includes(option.capability))}
            onChange={() => toggleCapability(option.plugin_id, option.capability)}
          />
          <span>{option.label}</span>
        </label>)}
      </div>
      <div className="review-actions">
        <button className="action secondary" disabled={revisionPreview.isPending || revisionBegin.isPending} onClick={() => revisionPreview.mutate()}>預覽 Plugin 修訂</button>
        <button className="action" disabled={!revisionPreview.data || revisionPreview.isPending || revisionBegin.isPending} onClick={() => revisionBegin.mutate()}>{revisionBegin.isPending ? "開始中..." : "開始 Plugin 修訂"}</button>
      </div>
      {revisionPreview.error instanceof Error ? <p className="status status-rejected">{revisionPreview.error.message}</p> : null}
      {revisionBegin.error instanceof Error ? <p className="status status-rejected">{revisionBegin.error.message}</p> : null}
      {revisionPreview.data ? <div className="plugin-revision-preview">
        <div className="row"><span>Intent revision</span><code>{revisionPreview.data.intent.revision}</code></div>
        <div className="row"><span>Dependency closure</span><span>{revisionPreview.data.intent.dependency_closure.join(", ") || "none"}</span></div>
        <div className="row"><span>Exact implementation pins</span><span>{revisionPreview.data.intent.implementation_pins.length}</span></div>
      </div> : null}
    </article>
    {review.error instanceof Error ? <p className="status status-rejected">{review.error.message}</p> : null}
    {proposals.length === 0
      ? <p className="empty">目前沒有待審 Plugin proposal。</p>
      : <div className="section-grid">{proposals.map((proposal) => <PluginProposalCard
        key={proposal.id}
        proposal={proposal}
        disabled={review.isPending}
        onDecision={(action) => setConfirmation({ proposal, action })}
      />)}</div>}
    {confirmation ? <aside className="plugin-review-confirm" role="dialog" aria-label="確認 Plugin 審查決策">
      <p className="eyebrow">EXPLICIT USER DECISION</p>
      <h2>{confirmation.action === "approve" ? "核准 Plugin proposal？" : "拒絕 Plugin proposal？"}</h2>
      <p>這個決策會綁定目前 workflow revision、proposal revision 與一次性 server token。Agent 不能代替使用者核准。</p>
      <div className="row"><code>{confirmation.proposal.id}</code><span>{confirmation.proposal.value.plugin_id}</span></div>
      <div className="review-actions">
        <button className="action secondary" disabled={review.isPending} onClick={() => setConfirmation(undefined)}>取消</button>
        <button className="action" disabled={review.isPending} onClick={() => review.mutate(confirmation)}>
          {review.isPending ? "送出中..." : confirmation.action === "approve" ? "確認核准" : "確認拒絕"}
        </button>
      </div>
    </aside> : null}
  </section>;
}

function normalizePluginSelections(selections: readonly PluginSelection[]): PluginSelection[] {
  return selections
    .map((selection) => ({
      ...selection,
      capabilities: [...new Set(selection.capabilities)].sort(),
    }))
    .filter((selection) => selection.capabilities.length > 0)
    .sort((left, right) => left.plugin_id < right.plugin_id ? -1 : left.plugin_id > right.plugin_id ? 1 : 0);
}

function PluginProposalCard({
  proposal,
  disabled,
  onDecision,
}: {
  proposal: PluginProposal;
  disabled: boolean;
  onDecision: (action: "approve" | "reject") => void;
}) {
  return <article>
    <div className="row"><span>{proposal.value.plugin_id}<small>{proposal.owner} · {proposal.task_id}</small></span><code>{proposal.proposal_revision.slice(0, 18)}...</code></div>
    <div className="row"><span>Capabilities</span><span>{proposal.value.capabilities.join(", ")}</span></div>
    {proposal.value.template_id ? <div className="row"><span>Template</span><span>{proposal.value.template_id}</span></div> : null}
    <div className="row"><span>Resolved source</span><code>{proposal.value.resolved_source_hash.slice(0, 18)}...</code></div>
    <div className="row"><span>Proposal 狀態</span><span className="status status-pending">待審</span></div>
    <div className="row"><span /><span><button className="action" disabled={disabled} onClick={() => onDecision("approve")}>核准</button> <button className="action secondary" disabled={disabled} onClick={() => onDecision("reject")}>拒絕</button></span></div>
  </article>;
}

function Characters({ projectId, project }: { projectId: string; project: ProjectDetail }) {
  const resources = project.characters.flatMap((item) => {
    const manifest = item.manifest as { id: string; display_name: string; mode: "zhuji" | "palette" };
    const modules = item.modules as Array<{ module: string }>;
    return [{ label: `${manifest.display_name}／身份`, resource: { project_id: projectId, kind: "character", id: manifest.id } }, ...modules.map((module) => ({ label: `${manifest.display_name}／${module.module}${module.module === "self_introduction" ? "（非開場白）" : ""}`, resource: { project_id: projectId, kind: `${manifest.mode}_module`, id: module.module, owner_id: manifest.id } }))];
  });
  return <ResourceTabs title="角色設定" resources={resources} />;
}

function World({ projectId, project }: { projectId: string; project: ProjectDetail }) {
  const resources = project.world.map((item) => ({
    label: String(item.title ?? item.id),
    resource: { project_id: projectId, kind: "world_entry", id: String(item.id), owner_id: String(item.category) },
  }));
  return <ResourceTabs title="多維世界設定" resources={resources} />;
}

function ResourceTabs({ title, resources }: { title: string; resources: Array<{ label: string; resource: { project_id: string; kind: string; id: string; owner_id?: string } }> }) {
  const [selected, setSelected] = useState(0);
  const active = resources[selected];
  return <section><p className="eyebrow">AUTHOR MODEL</p><h1>{title}</h1><div className="resource-layout"><aside>{resources.map((item, index) => <button key={`${item.resource.kind}-${item.resource.id}-${item.resource.owner_id ?? ""}`} className={selected === index ? "active" : ""} onClick={() => setSelected(index)}>{item.label}</button>)}</aside><div>{active ? <Suspense fallback={<p className="empty">載入編輯器...</p>}><ResourceEditor label={active.label} resource={active.resource} /></Suspense> : <p className="empty">尚無資源</p>}</div></div></section>;
}

function Sources({ projectId }: { projectId: string }) {
  const query = useQuery({ queryKey: ["sources", projectId], queryFn: () => apiFetch<Array<Record<string, unknown>>>(`/api/sources/${projectId}`) });
  return <section><p className="eyebrow">IMMUTABLE EVIDENCE</p><h1>來源與版本</h1><DataTable rows={query.data ?? []} columns={["id", "title", "tier", "current_revision_id"]} /></section>;
}

function Planner({ projectId }: { projectId: string }) {
  const plan = useQuery({ queryKey: ["planner", projectId], queryFn: () => apiFetch<Record<string, unknown>>(`/api/planner/${projectId}`) });
  const [conversation, setConversation] = useState("");
  const simulation = useMutation({ mutationFn: () => apiFetch<Record<string, unknown>>("/api/planner/simulate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ project_id: projectId, conversation: conversation.split("\n").filter(Boolean), strict: false }) }) });
  const entries = (((plan.data?.plan as Record<string, unknown> | undefined)?.entries ?? []) as Array<Record<string, unknown>>);
  return <section><p className="eyebrow">CANONICAL PLANNER</p><h1>世界書規劃與模擬</h1><Suspense fallback={<p className="empty">載入圖譜...</p>}><GraphPanel items={entries} /></Suspense><div className="section-grid"><article><h2>Planned Entries</h2><DataTable rows={entries} columns={["id", "insertion_order", "priority", "activation"]} /></article><article><h2>Trigger Conversation</h2><textarea value={conversation} onChange={(event) => setConversation(event.target.value)} placeholder="每行一則測試訊息" /><button className="action" onClick={() => simulation.mutate()}>執行模擬</button><pre>{simulation.data ? JSON.stringify(simulation.data, null, 2).slice(0, 4000) : "尚未執行"}</pre></article></div></section>;
}

function DataTable({ rows, columns }: { rows: Array<Record<string, unknown>>; columns: string[] }) {
  return <div className="data-table"><div className="data-head">{columns.map((column) => <b key={column}>{column}</b>)}</div>{rows.map((row, index) => <div className="data-row" key={typeof row.id === "string" ? row.id : String(index)}>{columns.map((column) => <span key={column}>{format(row[column])}</span>)}</div>)}</div>;
}

function format(value: unknown): string {
  if (value === undefined) return "--";
  if (value === null || typeof value === "object") return JSON.stringify(value);
  switch (typeof value) {
    case "string": return value;
    case "number": return String(value);
    case "boolean": return value ? "true" : "false";
    case "bigint": return value.toString();
    default: return "--";
  }
}
