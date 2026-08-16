import { WorkspaceRuntime } from "./packages/runtime/src/index.ts";
import { FileProjectRepository } from "./packages/core/src/repository/repository-implementation.ts";
import { FileAttachmentStore } from "./packages/core/src/attachments.ts";

async function main() {
  const projectRoot = "projects";
  const projectId = "母狗劍士基列奴";
  const repository = new FileProjectRepository(projectRoot, projectId, { layout: "project", materialize: true });
  const runtime = new WorkspaceRuntime(repository, {
    fetcher: fetch as any,
    attachmentStore: new FileAttachmentStore(projectRoot, projectId),
    interviewRequired: false,
  });
  try {
    const result = await runtime.coverageAssessment("formal");
    console.log("COVERAGE_RESULT:", JSON.stringify(result, null, 2));
  } catch (err) {
    console.log("COVERAGE_ERROR:", JSON.stringify(err, null, 2));
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error("FATAL:", e); process.exit(1); });
