import { access, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileProjectRepository } from "@st-workspace/core";
import { WorkspaceProjectManager, WorkspaceRuntime, type InterviewMigrationFailureInjection } from "../src/index.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function manager(root: string, options: { initialProjectId?: string; injection?: InterviewMigrationFailureInjection } = {}): WorkspaceProjectManager {
  return new WorkspaceProjectManager({
    root,
    ...(options.initialProjectId === undefined ? {} : { initialProjectId: options.initialProjectId }),
    ...(options.injection === undefined ? {} : { interviewMigrationFailureInjection: options.injection }),
    createRuntime: (repository) => new WorkspaceRuntime(repository),
  });
}

async function targetProject(root: string, name = "目標專案"): Promise<FileProjectRepository> {
  const target = new FileProjectRepository(root, "project-001", { layout: "project", materialize: true });
  const initial = await target.read();
  await target.commit(initial.revision, (state) => ({
    ...state,
    project_name: name,
    project_slug: name,
    project_status: "ready",
  }));
  return target;
}

function migrationAudits(state: Awaited<ReturnType<FileProjectRepository["read"]>>) {
  return state.audit.filter((item) => item.event === "interview.target.migrated");
}

describe("Audit12 RISK12-02 recoverable targeted interview migration", () => {
  it("restores source authority when target migration has not committed, then converges on restart", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "st-workspace-audit12-migration-source-"));
    roots.push(root);
    const target = await targetProject(root);
    const projects = manager(root, { injection: { point: "after_target_selection", mode: "error" } });

    expect((await projects.interviewContext()).project_id).toBe("project-002");
    await projects.answerInterview("繼續專案", { actor: "user", attachments: [] });
    await expect(projects.answerInterview("目標專案", { actor: "user", attachments: [] })).rejects.toMatchObject({
      code: "INTERVIEW_MIGRATION_NOT_COMMITTED",
      recoverable: true,
    });

    expect(projects.repository.projectId).toBe("project-002");
    const sourceRepository = new FileProjectRepository(root, "project-002", { layout: "project", materialize: true });
    const sourceBeforeRecovery = await sourceRepository.read();
    expect(sourceBeforeRecovery.interview.flow).toBe("continue");
    expect(sourceBeforeRecovery.operations.some((item) => item.kind === "interview")).toBe(true);
    expect(migrationAudits(await target.read())).toHaveLength(0);
    await access(path.join(root, "project-002", ".workspace", "interview-migration.json"));

    const restarted = manager(root, { initialProjectId: "project-002" });
    expect((await restarted.status()).project_id).toBe("project-001");
    expect(restarted.repository.projectId).toBe("project-001");

    const targetAfterRecovery = await target.read();
    expect(migrationAudits(targetAfterRecovery)).toHaveLength(1);
    const sourceAfterRecovery = await sourceRepository.read();
    expect(sourceAfterRecovery.interview.status).toBe("idle");
    expect(sourceAfterRecovery.interview.flow).toBe("new_project");
    expect(sourceAfterRecovery.operations.some((item) => item.kind === "interview")).toBe(false);
    await expect(access(path.join(root, "project-002", ".workspace", "interview-migration.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("reports committed migration with cleanup pending and retries cleanup without repeating the target commit", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "st-workspace-audit12-migration-cleanup-"));
    roots.push(root);
    const target = await targetProject(root);
    const projects = manager(root, { injection: { point: "after_target_commit", mode: "error" } });

    await projects.interviewContext();
    await projects.answerInterview("繼續專案", { actor: "user", attachments: [] });
    const result = await projects.answerInterview("目標專案", { actor: "user", attachments: [] });
    expect(result.status).toBe("partial");
    expect(result.project_id).toBe("project-001");
    expect(result.summary).toContain("目標遷移已提交");
    expect(result.summary).toContain("清理尚未完成");

    const targetBeforeCleanup = await target.read();
    const auditBefore = migrationAudits(targetBeforeCleanup);
    expect(auditBefore).toHaveLength(1);
    const migrationId = auditBefore[0]?.details.migration_id;
    const targetRevision = targetBeforeCleanup.revision;
    await access(path.join(root, "project-002", ".workspace", "interview-migration.json"));

    expect((await projects.status()).project_id).toBe("project-001");
    const targetAfterCleanup = await target.read();
    expect(targetAfterCleanup.revision).toBe(targetRevision);
    expect(migrationAudits(targetAfterCleanup)).toHaveLength(1);
    expect(migrationAudits(targetAfterCleanup)[0]?.details.migration_id).toBe(migrationId);
    const source = await new FileProjectRepository(root, "project-002", { layout: "project", materialize: true }).read();
    expect(source.interview.status).toBe("idle");
    expect(source.operations.some((item) => item.kind === "interview")).toBe(false);
  });

  it("uses stable remapped operation and audit identities across a crash after target commit", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "st-workspace-audit12-migration-idempotent-"));
    roots.push(root);
    const target = await targetProject(root);
    const projects = manager(root, { injection: { point: "after_target_commit", mode: "crash" } });

    await projects.interviewContext();
    await projects.answerInterview("繼續專案", { actor: "user", attachments: [] });
    const sourceRepository = new FileProjectRepository(root, "project-002", { layout: "project", materialize: true });
    const source = await sourceRepository.read();
    const sourceOperation = [...source.operations].reverse().find((item) => item.kind === "interview");
    expect(sourceOperation).toBeDefined();

    const targetBefore = await target.read();
    await target.commit(targetBefore.revision, (state) => ({
      ...state,
      operations: [
        ...state.operations,
        {
          ...sourceOperation!,
          id: sourceOperation!.id,
          kind: "status" as const,
          request: "pre-existing target operation",
          status: "completed" as const,
          question: undefined,
        },
      ],
    }));

    await expect(projects.answerInterview("目標專案", { actor: "user", attachments: [] })).rejects.toMatchObject({
      name: "InterviewMigrationCrashInjection",
    });

    const targetAfterCrash = await target.read();
    const auditsAfterCrash = migrationAudits(targetAfterCrash);
    expect(auditsAfterCrash).toHaveLength(1);
    const migrationId = auditsAfterCrash[0]?.details.migration_id;
    expect(typeof migrationId).toBe("string");
    const migratedOperationId = auditsAfterCrash[0]?.operation_id;
    expect(migratedOperationId).not.toBe(sourceOperation!.id);
    expect(targetAfterCrash.operations.filter((item) => item.id === sourceOperation!.id)).toHaveLength(1);
    expect(targetAfterCrash.operations.filter((item) => item.id === migratedOperationId)).toHaveLength(1);
    const targetRevision = targetAfterCrash.revision;

    const restarted = manager(root, { initialProjectId: "project-002" });
    expect((await restarted.status()).project_id).toBe("project-001");
    const targetAfterRecovery = await target.read();
    expect(targetAfterRecovery.revision).toBe(targetRevision);
    expect(migrationAudits(targetAfterRecovery)).toHaveLength(1);
    expect(migrationAudits(targetAfterRecovery)[0]?.details.migration_id).toBe(migrationId);
    expect(migrationAudits(targetAfterRecovery)[0]?.operation_id).toBe(migratedOperationId);
    expect(targetAfterRecovery.operations.filter((item) => item.id === migratedOperationId)).toHaveLength(1);
    const sourceAfterRecovery = await sourceRepository.read();
    expect(sourceAfterRecovery.interview.status).toBe("idle");
    expect(sourceAfterRecovery.operations.some((item) => item.id === sourceOperation!.id)).toBe(false);
  });
});
