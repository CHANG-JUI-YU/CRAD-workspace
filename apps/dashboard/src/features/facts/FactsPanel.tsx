import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { apiFetch } from "../../api/client";
import type { ProjectDetail } from "../../api/types";

interface Evidence {
  id: string;
  source_id: string;
  quote: string;
  normalized_character_range: [number, number];
  normalized_line_range: [number, number];
}

interface Candidate {
  id: string;
  subject: string;
  predicate: string;
  value: unknown;
  classification: string;
  confidence: number;
  status: string;
  evidence: Evidence[];
}

interface Fact {
  id: string;
  subject: string;
  predicate: string;
  value: unknown;
  status: string;
  fact_revision: number;
}

interface FactRow {
  fact: Fact;
  gate_status: string;
  conflict_ids: string[];
}

interface ConflictMember { fact_id?: string; candidate_id?: string; value: unknown }
interface Conflict {
  id: string;
  subject: string;
  predicate: string;
  status: string;
  members: ConflictMember[];
}

type ResolutionType = "choose_one" | "coexist" | "temporal" | "scope_split" | "unresolved" | "supersede";

function ids(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function assignments(value: string, label: string): Array<Record<string, unknown>> {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed)) throw new Error(`${label} 必須是 JSON array`);
  return parsed as Array<Record<string, unknown>>;
}

export function FactsPanel({ projectId, project }: { projectId: string; project: ProjectDetail }) {
  const queryClient = useQueryClient();
  const facts = useQuery({
    queryKey: ["facts", projectId],
    queryFn: () => apiFetch<{ facts: FactRow[]; projection_revision: string }>("/api/facts/query", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ project_id: projectId, filter: {} }),
    }),
  });
  const candidates = useQuery({
    queryKey: ["fact-candidates", projectId],
    queryFn: () => apiFetch<Candidate[]>(`/api/facts/${projectId}/candidates`),
  });
  const conflicts = (project.conflicts?.conflicts ?? []) as Conflict[];
  const openConflicts = conflicts.filter((item) => item.status === "open");
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["facts", projectId] }),
      queryClient.invalidateQueries({ queryKey: ["fact-candidates", projectId] }),
      queryClient.invalidateQueries({ queryKey: ["project", projectId] }),
    ]);
  };

  return <section>
    <p className="eyebrow">FACT REGISTER</p><h1>事實審核與衝突裁決</h1>
    <div className="metric-grid">
      <Metric label="Registered facts" value={facts.data?.facts.length ?? 0} />
      <Metric label="Review candidates" value={candidates.data?.length ?? 0} />
      <Metric label="Open conflicts" value={openConflicts.length} />
      <Metric label="Projection" value={facts.data?.projection_revision.slice(0, 15) ?? "--"} />
    </div>
    <CandidateReview projectId={projectId} candidates={candidates.data ?? []} facts={facts.data?.facts ?? []} projectionRevision={facts.data?.projection_revision} onChanged={refresh} />
    <ConflictResolution projectId={projectId} conflicts={openConflicts} facts={facts.data?.facts ?? []} projectionRevision={facts.data?.projection_revision} onChanged={refresh} />
    <article className="fact-register"><h2>Fact Register</h2>{(facts.data?.facts ?? []).map((row) => <div className="row" key={row.fact.id}><div><b>{row.fact.id}</b><small>{row.fact.subject} / {row.fact.predicate} / {JSON.stringify(row.fact.value)}</small></div><span className={`status status-${row.fact.status}`}>{row.gate_status}</span></div>)}</article>
  </section>;
}

function CandidateReview({ projectId, candidates, facts, projectionRevision, onChanged }: {
  projectId: string; candidates: Candidate[]; facts: FactRow[]; projectionRevision: string | undefined; onChanged: () => Promise<void>;
}) {
  const [selectedId, setSelectedId] = useState("");
  const selected = candidates.find((item) => item.id === selectedId) ?? candidates[0];
  const [factId, setFactId] = useState("");
  const [rationale, setRationale] = useState("人工審核");
  const review = useMutation({
    mutationFn: (type: "accepted" | "rejected") => {
      if (!selected || !projectionRevision) throw new Error("Candidate 或 projection 尚未載入");
      const targetFactId = factId.trim() || `fact-${selected.id}`;
      const previous = facts.find((item) => item.fact.id === targetFactId)?.fact;
      const nonce = Date.now();
      return apiFetch("/api/facts/review", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          expected_projection_revision: projectionRevision,
          ...(previous ? { expected_fact_revision: previous.fact_revision } : {}),
          decision: {
            schema_version: 1, id: `dashboard-review-${nonce}`, candidate_id: selected.id,
            fact_id: targetFactId, type, rationale, actor: "dashboard-user", decided_at: new Date().toISOString(),
          },
        }),
      });
    },
    onSuccess: onChanged,
  });

  return <div className="fact-workbench">
    <aside><h2>Candidate Queue</h2>{candidates.map((candidate) => <button key={candidate.id} className={selected?.id === candidate.id ? "active" : ""} onClick={() => { setSelectedId(candidate.id); setFactId(`fact-${candidate.id}`); }}>{candidate.id}<small>{candidate.subject} / {candidate.predicate}</small></button>)}</aside>
    <article><h2>Evidence Review</h2>{selected ? <>
      <div className="fact-summary"><b>{selected.classification}</b><span>{Math.round(selected.confidence * 100)}% confidence</span><code>{JSON.stringify(selected.value)}</code></div>
      {selected.evidence.map((evidence) => <blockquote key={evidence.id}><p>{evidence.quote}</p><footer>{evidence.source_id} · lines {evidence.normalized_line_range.join("-")} · chars {evidence.normalized_character_range.join("-")}</footer></blockquote>)}
      <label className="field"><span>Fact ID</span><input value={factId} placeholder={`fact-${selected.id}`} onChange={(event) => setFactId(event.target.value)} /></label>
      <label className="field"><span>Rationale</span><input value={rationale} onChange={(event) => setRationale(event.target.value)} /></label>
      <div className="fact-actions"><button disabled={review.isPending} onClick={() => review.mutate("rejected")}>Reject</button><button className="action" disabled={review.isPending} onClick={() => review.mutate("accepted")}>Accept Candidate</button></div>
      {review.error instanceof Error && <p className="editor-error">{review.error.message}</p>}
    </> : <p className="empty">尚無 candidate</p>}</article>
  </div>;
}

function ConflictResolution({ projectId, conflicts, facts, projectionRevision, onChanged }: {
  projectId: string; conflicts: Conflict[]; facts: FactRow[]; projectionRevision: string | undefined; onChanged: () => Promise<void>;
}) {
  const [selectedId, setSelectedId] = useState("");
  const conflict = conflicts.find((item) => item.id === selectedId) ?? conflicts[0];
  const memberIds = conflict?.members.flatMap((member) => member.fact_id ? [member.fact_id] : []) ?? [];
  const [type, setType] = useState<ResolutionType>("choose_one");
  const [accepted, setAccepted] = useState("");
  const [rejected, setRejected] = useState("");
  const [temporal, setTemporal] = useState("[]");
  const [scopes, setScopes] = useState("[]");
  const [rationale, setRationale] = useState("人工裁決");
  const resolve = useMutation({
    mutationFn: () => {
      if (!conflict || !projectionRevision) throw new Error("Conflict 或 projection 尚未載入");
      const nonce = Date.now();
      let acceptedIds = ids(accepted);
      let rejectedIds = ids(rejected);
      if ((type === "choose_one" || type === "supersede") && acceptedIds.length === 0 && rejectedIds.length === 0) {
        acceptedIds = memberIds.slice(0, 1);
        rejectedIds = memberIds.slice(1);
      } else if (type === "coexist" && acceptedIds.length === 0) {
        acceptedIds = memberIds;
      } else if (type === "unresolved") {
        acceptedIds = [];
        rejectedIds = [];
      }
      const expectedFactRevisions = Object.fromEntries(memberIds.map((id) => [id, facts.find((row) => row.fact.id === id)?.fact.fact_revision ?? 0]));
      return apiFetch("/api/facts/conflict/resolve", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          project_id: projectId, expected_projection_revision: projectionRevision,
          expected_fact_revisions: expectedFactRevisions,
          decision: {
            schema_version: 1, id: `dashboard-resolution-${nonce}`, conflict_id: conflict.id, type,
            accepted_fact_ids: acceptedIds, rejected_fact_ids: rejectedIds,
            temporal_assignments: assignments(temporal, "Temporal assignments"),
            scope_assignments: assignments(scopes, "Scope assignments"),
            rationale, actor: "dashboard-user", decided_at: new Date().toISOString(),
          },
        }),
      });
    },
    onSuccess: onChanged,
  });
  const selectConflict = (item: Conflict) => {
    const factIds = item.members.flatMap((member) => member.fact_id ? [member.fact_id] : []);
    setSelectedId(item.id);
    setAccepted(factIds[0] ?? "");
    setRejected(factIds.slice(1).join(", "));
  };

  return <div className="fact-workbench conflict-workbench">
    <aside><h2>Open Conflicts</h2>{conflicts.map((item) => <button key={item.id} className={conflict?.id === item.id ? "active" : ""} onClick={() => selectConflict(item)}>{item.id}<small>{item.subject} / {item.predicate}</small></button>)}</aside>
    <article><h2>Six-way Resolution</h2>{conflict ? <>
      <div className="conflict-members">{conflict.members.map((member, index) => <div key={member.fact_id ?? member.candidate_id ?? index}><code>{member.fact_id ?? member.candidate_id}</code><span>{JSON.stringify(member.value)}</span></div>)}</div>
      <label className="field"><span>Resolution</span><select value={type} onChange={(event) => setType(event.target.value as ResolutionType)}><option value="choose_one">Choose one</option><option value="coexist">Coexist</option><option value="temporal">Temporal</option><option value="scope_split">Scope split</option><option value="unresolved">Keep unresolved</option><option value="supersede">Supersede</option></select></label>
      <label className="field"><span>Accepted fact IDs</span><input value={accepted} onChange={(event) => setAccepted(event.target.value)} placeholder={memberIds.join(", ")} /></label>
      <label className="field"><span>Rejected fact IDs</span><input value={rejected} onChange={(event) => setRejected(event.target.value)} /></label>
      {type === "temporal" && <label className="field stack"><span>Temporal assignments JSON</span><textarea value={temporal} onChange={(event) => setTemporal(event.target.value)} /></label>}
      {type === "scope_split" && <label className="field stack"><span>Scope assignments JSON</span><textarea value={scopes} onChange={(event) => setScopes(event.target.value)} /></label>}
      <label className="field"><span>Rationale</span><input value={rationale} onChange={(event) => setRationale(event.target.value)} /></label>
      <div className="fact-actions"><button className="action" disabled={resolve.isPending} onClick={() => resolve.mutate()}>Record Resolution</button></div>
      {resolve.error instanceof Error && <p className="editor-error">{resolve.error.message}</p>}
    </> : <p className="empty">沒有待裁決衝突</p>}</article>
  </div>;
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div className="metric"><span>{label}</span><b>{value}</b></div>;
}
