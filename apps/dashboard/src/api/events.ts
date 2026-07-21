import type { QueryClient } from "@tanstack/react-query";

export function connectDashboardEvents(queryClient: QueryClient, onState: (state: "live" | "retrying") => void): () => void {
  const source = new EventSource("/api/events");
  source.onopen = () => onState("live");
  source.onerror = () => onState("retrying");
  const types = ["project.changed", "workflow.changed", "task.changed", "gate.changed", "source.changed", "facts.changed", "preview.changed", "build.published", "diagnostics.changed"];
  const listeners = types.map((type) => {
    const listener = (event: Event) => {
      const data = JSON.parse((event as MessageEvent<string>).data) as { project_id: string };
      void queryClient.invalidateQueries({ queryKey: ["project", data.project_id] });
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
    };
    source.addEventListener(type, listener);
    return [type, listener] as const;
  });
  return () => {
    for (const [type, listener] of listeners) source.removeEventListener(type, listener);
    source.close();
  };
}
