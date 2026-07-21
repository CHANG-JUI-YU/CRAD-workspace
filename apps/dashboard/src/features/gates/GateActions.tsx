import { useMutation, useQueryClient } from "@tanstack/react-query";

import { apiFetch } from "../../api/client";
import type { Workflow } from "../../api/types";

export function GateActions({ projectId, workflow }: { projectId: string; workflow: Workflow }) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({ gateId, action }: { gateId: string; action: "approve" | "reject" | "not_required" }) => {
      const gate = workflow.gates.find((item) => item.id === gateId);
      const nonce = Date.now();
      return apiFetch("/api/workflow/gate", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          project_id: projectId, expected_workflow_revision: workflow.revision,
          event_id: `dashboard-gate-${gateId}-${nonce}`, decision_id: `dashboard-${action}-${gateId}-${nonce}`,
          gate_id: gateId, action, summary: `Dashboard user ${action}`, input_revisions: gate?.input_revisions ?? [], findings: [],
        }),
      });
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["project", projectId] }),
  });
  return <div className="gate-list">{workflow.gates.map((gate) => <article key={gate.id}><header><b>{gate.id}</b><span className={`status status-${gate.status}`}>{gate.status}</span></header><small>{gate.input_revisions.length} exact inputs</small>{gate.status === "pending" && <footer><button onClick={() => mutation.mutate({ gateId: gate.id, action: "reject" })}>Reject</button><button className="primary" onClick={() => mutation.mutate({ gateId: gate.id, action: "approve" })}>Approve</button></footer>}</article>)}{mutation.error instanceof Error && <p className="editor-error">{mutation.error.message}</p>}</div>;
}
