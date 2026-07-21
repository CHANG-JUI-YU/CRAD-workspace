import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import { bootstrapSession } from "../api/client";
import { connectDashboardEvents } from "../api/events";
import { Workbench } from "./Workbench";

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 5_000, retry: 1 } } });

export function App() {
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [connection, setConnection] = useState<"live" | "retrying">("retrying");

  useEffect(() => {
    let disconnect: (() => void) | undefined;
    void bootstrapSession()
      .then(() => {
        setState("ready");
        disconnect = connectDashboardEvents(queryClient, setConnection);
      })
      .catch(() => setState("failed"));
    return () => disconnect?.();
  }, []);

  if (state === "loading") return <main className="startup">正在連接本機工作區...</main>;
  if (state === "failed") return <main className="startup error">工作階段無效。請從CLI重新啟動Dashboard。</main>;
  return <QueryClientProvider client={queryClient}>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Workbench connection={connection} />} />
        <Route path="/projects/:projectId/:section?" element={<Workbench connection={connection} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </QueryClientProvider>;
}
