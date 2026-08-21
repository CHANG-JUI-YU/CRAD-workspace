import { describe, expect, it } from "vitest";
import { MemoryProjectRepository } from "@st-workspace/core";
import { WorkspaceRuntime } from "@st-workspace/runtime";
import { dashboard } from "../src/dashboard.js";
import { createWorkspaceServer } from "../src/index.js";
import { publishReadinessSnapshot } from "../src/publish-readiness.js";

class CommitOnceDuringReadinessRuntime extends WorkspaceRuntime {
  publishCalls = 0;
  private committed = false;

  constructor(private readonly testRepository: MemoryProjectRepository) {
    super(testRepository);
  }

  override async publishPreview(mode?: Parameters<WorkspaceRuntime["publishPreview"]>[0]) {
    this.publishCalls += 1;
    const result = await super.publishPreview(mode);
    if (!this.committed) {
      const state = await this.testRepository.read();
      await this.testRepository.commit(state.revision, (current) => ({
        ...current,
        project_name: "changed-between-readiness-stages",
      }));
      this.committed = true;
    }
    return result;
  }
}

class AlwaysChangingReadinessRuntime extends WorkspaceRuntime {
  private change = 0;

  constructor(private readonly testRepository: MemoryProjectRepository) {
    super(testRepository);
  }

  override async publishPreview(mode?: Parameters<WorkspaceRuntime["publishPreview"]>[0]) {
    const result = await super.publishPreview(mode);
    const state = await this.testRepository.read();
    this.change += 1;
    await this.testRepository.commit(state.revision, (current) => ({
      ...current,
      project_name: `changing-${this.change}`,
    }));
    return result;
  }
}

async function withServer(runtime: WorkspaceRuntime, run: (base: string) => Promise<void>): Promise<void> {
  const server = createWorkspaceServer({ runtime, actor: "audit14", autoStartWorker: false });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("server did not bind");
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
  }
}

describe("#228 revision-bound publish readiness", () => {
  it("retries a mid-readiness commit and returns one verifiable project revision", async () => {
    const repository = new MemoryProjectRepository("issue228-retry");
    const runtime = new CommitOnceDuringReadinessRuntime(repository);

    await withServer(runtime, async (base) => {
      const response = await fetch(`${base}/workspace/publish/readiness`);
      expect(response.status).toBe(200);
      const payload = await response.json() as Record<string, unknown>;
      expect(payload.project_revision).toBe(1);
      expect(payload).toHaveProperty("publish");
      expect(payload).toHaveProperty("build");
      expect(payload).toHaveProperty("diagnostics");
    });

    expect(runtime.publishCalls).toBe(2);
    expect((await repository.read()).revision).toBe(1);
  });

  it("fails closed when the project keeps changing during both snapshot attempts", async () => {
    const repository = new MemoryProjectRepository("issue228-stale");
    const runtime = new AlwaysChangingReadinessRuntime(repository);

    await expect(publishReadinessSnapshot(runtime)).rejects.toMatchObject({
      code: "PUBLISH_READINESS_SNAPSHOT_STALE",
      recoverable: true,
    });
  });

  it("renders readiness from the atomic endpoint and reloads on a stale snapshot", () => {
    const html = dashboard();
    const start = html.indexOf("async function triggerCheckReadiness()");
    const end = html.indexOf("async function triggerPrepareProvenance()", start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const readinessBlock = html.slice(start, end);

    expect(readinessBlock).toContain("/workspace/publish/readiness");
    expect(readinessBlock).not.toContain("/workspace/publish/preview");
    expect(readinessBlock).not.toContain("/workspace/build/preview");
    expect(readinessBlock).not.toContain("/workspace/dashboard/publish-diagnostics");
    expect(readinessBlock).toContain("PUBLISH_READINESS_SNAPSHOT_STALE");
    expect(readinessBlock).toContain("loadDashboardData()");
    expect(readinessBlock).toContain("currentProvenanceConfirmation = null");
  });
});
