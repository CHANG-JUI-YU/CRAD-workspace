import { useQuery } from "@tanstack/react-query";
import { NavLink, useNavigate, useParams } from "react-router-dom";

import { apiFetch } from "../api/client";
import type { ProjectDetail, ProjectSummary } from "../api/types";
import { PaneErrorBoundary } from "./ErrorBoundary";
import { DashboardSection } from "../features/sections/DashboardSection";
import { GateActions } from "../features/gates/GateActions";

const sections = [
  ["overview", "總覽"], ["workflow", "工作流"], ["sources", "來源"], ["facts", "事實"],
  ["characters", "角色"], ["world", "世界設定"], ["greetings", "開場白"], ["plugins", "Plugins 審查"], ["planner", "規劃模擬"], ["builds", "編譯輸出"],
] as const;

export function Workbench({ connection }: { connection: "live" | "retrying" }) {
  const { projectId, section = "overview" } = useParams();
  const navigate = useNavigate();
  const projects = useQuery({ queryKey: ["projects"], queryFn: () => apiFetch<ProjectSummary[]>("/api/projects") });
  const detail = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => apiFetch<ProjectDetail>(`/api/projects/${projectId}`),
    enabled: projectId !== undefined,
  });
  const active = projects.data?.find((item) => item.id === projectId);

  return <div className="workbench">
    <header className="topbar">
      <div className="brand"><span className="brand-mark">CW</span><div><b>Card Workspace</b><small>V3 Authoring Room</small></div></div>
      <select aria-label="目前專案" value={projectId ?? ""} onChange={(event) => { void navigate(`/projects/${event.target.value}/overview`); }}>
        <option value="" disabled>選擇專案</option>
        {projects.data?.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}
      </select>
      <div className="stage"><span>STAGE</span><b>{active?.stage ?? "--"}</b></div>
      <div className={`connection ${connection}`}>{connection === "live" ? "LIVE" : "RECONNECTING"}</div>
      <button className="action secondary">驗證</button><button className="action">建立預覽</button>
    </header>

    <aside className="nav-pane">
      <div className="pane-label">PROJECT</div>
      {projectId === undefined ? <p className="empty">從上方選擇專案</p> : sections.map(([id, label]) =>
        <NavLink key={id} to={`/projects/${projectId}/${id}`} className={({ isActive }) => isActive ? "nav-item active" : "nav-item"}>{label}</NavLink>)}
      <div className="project-stats"><span>角色 {active?.character_count ?? 0}</span><span>待審 {active?.pending_gates ?? 0}</span><span>失敗 {active?.failed_tasks ?? 0}</span></div>
    </aside>

    <main className="main-pane">
      <PaneErrorBoundary name="主工作區">
        <Section section={section} project={detail.data} loading={detail.isLoading} />
      </PaneErrorBoundary>
    </main>

    <aside className="inspector-pane">
      <div className="pane-label">INSPECTOR</div>
      <Inspector project={detail.data} />
    </aside>

    <footer className="console-pane"><span className="console-title">EVENT CONSOLE</span><span>{detail.error instanceof Error ? detail.error.message : "工作區已同步"}</span><span className="revision">rev {detail.data?.workflow?.revision ?? "--"}</span></footer>
  </div>;
}

function Section({ section, project, loading }: { section: string; project: ProjectDetail | undefined; loading: boolean }) {
  if (loading) return <div className="loading-grid"><i /><i /><i /></div>;
  if (project === undefined) return <section className="welcome"><p className="eyebrow">LOCAL AUTHORING SYSTEM</p><h1>選擇專案，進入編輯室。</h1><p>角色、來源、事實、世界書與發布狀態會集中在此處。</p></section>;
  if (section === "overview") return <Overview project={project} />;
  if (section === "workflow") return <WorkflowView projectId={safeString((project.project ?? {}).id)} workflow={project.workflow} />;
  return <DashboardSection section={section} projectId={safeString((project.project ?? {}).id)} project={project} />;
}

function Overview({ project }: { project: ProjectDetail }) {
  const manifest = project.project ?? {};
  return <section><p className="eyebrow">PROJECT OVERVIEW</p><h1>{safeString(manifest.title, "未命名專案")}</h1>
    <div className="metric-grid">
      <Metric label="角色" value={project.characters.length} /><Metric label="世界條目" value={project.world.length} />
      <Metric label="診斷" value={project.diagnostics.length} /><Metric label="Workflow" value={project.workflow?.stage ?? "--"} />
    </div>
    <div className="section-grid"><article><h2>角色模式</h2>{project.characters.map((character, index) => <div className="row" key={index}><span>{safeString((character.manifest as Record<string, unknown> | undefined)?.display_name, `角色 ${index + 1}`)}</span><code>{safeString((character.manifest as Record<string, unknown> | undefined)?.mode, "--")}</code></div>)}</article>
      <article><h2>待處理 Gate</h2>{project.workflow?.gates.map((gate) => <div className="row" key={gate.id}><span>{gate.id}</span><Status value={gate.status} /></div>)}</article></div>
  </section>;
}

function WorkflowView({ projectId, workflow }: { projectId: string; workflow?: ProjectDetail["workflow"] }) {
  if (!workflow) return <p className="empty">Workflow不可用</p>;
  return <section><p className="eyebrow">WORKFLOW CONTROL</p><h1>{workflow.stage}</h1>
    <div className="timeline">{["intake", "source_processing", "facts_review", "blueprint", "authoring", "semantic_review", "content_review", "compile_preview", "publish_review", "published"].map((stage) => <div key={stage} className={stage === workflow.stage ? "timeline-node current" : "timeline-node"}><i />{stage}</div>)}</div>
    <div className="section-grid"><article><h2>Tasks</h2>{workflow.tasks.map((task) => <div className="row" key={task.id}><span>{task.id}<small>{task.assigned_agent}</small></span><Status value={task.status} /></div>)}</article>
      <article><h2>Decisions</h2>{workflow.decisions.slice(-8).map((decision) => <div className="decision" key={decision.id}><b>{decision.kind}</b><p>{decision.summary}</p><small>{decision.actor}</small></div>)}</article></div><h2>Gates</h2><GateActions projectId={projectId} workflow={workflow} /></section>;
}

function Inspector({ project }: { project: ProjectDetail | undefined }) {
  return <><div className="inspector-block"><h3>VALIDATION</h3><b className={project?.diagnostics.length ? "bad" : "good"}>{project?.diagnostics.length ?? 0} findings</b></div>
    <div className="inspector-block"><h3>REVISION</h3><code>{project?.workflow?.revision ?? "--"}</code></div>
    <div className="inspector-block"><h3>GATES</h3>{project?.workflow?.gates.map((gate) => <div className="row compact" key={gate.id}><span>{gate.id}</span><Status value={gate.status} /></div>)}</div></>;
}

function Metric({ label, value }: { label: string; value: string | number }) { return <div className="metric"><span>{label}</span><b>{value}</b></div>; }
function Status({ value }: { value: string }) { return <span className={`status status-${value}`}>{value}</span>; }
function safeString(value: unknown, fallback = ""): string { return typeof value === "string" || typeof value === "number" ? String(value) : fallback; }
