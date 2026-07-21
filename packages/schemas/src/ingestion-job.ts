import { z } from "zod";

import { revisionSchema, stableIdSchema } from "./ids.js";
import { jsonObjectSchema } from "./json.js";

export const ingestionJobKindSchema = z.enum(["fact_extraction"]);
export const ingestionJobStatusSchema = z.enum(["pending", "processing", "completed", "failed", "superseded"]);
export const ingestionTaskStatusSchema = z.enum(["pending", "processing", "completed", "failed", "superseded"]);

export const ingestionTaskLeaseSchema = z
  .object({
    id: stableIdSchema,
    owner: stableIdSchema,
    claimed_at: z.string().datetime({ offset: true }),
    expires_at: z.string().datetime({ offset: true }),
  })
  .strict();

export const ingestionChunkTaskSchema = z
  .object({
    chunk_id: stableIdSchema,
    chunk_hash: revisionSchema,
    status: ingestionTaskStatusSchema,
    attempt: z.number().int().nonnegative(),
    lease: ingestionTaskLeaseSchema.optional(),
    result_batch_id: stableIdSchema.optional(),
    result_batch_hash: revisionSchema.optional(),
    diagnostics: z.array(stableIdSchema).default([]),
  })
  .strict()
  .superRefine((task, context) => {
    if (task.status === "processing" && task.lease === undefined) {
      context.addIssue({ code: "custom", message: "processing task 需要 lease", path: ["lease"] });
    }
    if (task.status !== "processing" && task.lease !== undefined) {
      context.addIssue({ code: "custom", message: "非 processing task 不得保留 lease", path: ["lease"] });
    }
    if (task.status === "completed" && (task.result_batch_id === undefined || task.result_batch_hash === undefined)) {
      context.addIssue({ code: "custom", message: "completed task 需要 result batch reference" });
    }
    if ((task.result_batch_id === undefined) !== (task.result_batch_hash === undefined)) {
      context.addIssue({ code: "custom", message: "result batch ID 與 hash 必須同時存在" });
    }
  });

export const ingestionJobSchema = z
  .object({
    schema_version: z.literal(1),
    id: stableIdSchema,
    kind: ingestionJobKindSchema,
    revision: z.number().int().nonnegative(),
    status: ingestionJobStatusSchema,
    source_id: stableIdSchema,
    source_revision_id: revisionSchema,
    chunk_set_id: stableIdSchema,
    input_revision: revisionSchema,
    created_by: stableIdSchema,
    created_at: z.string().datetime({ offset: true }),
    tasks: z.array(ingestionChunkTaskSchema),
    extensions: jsonObjectSchema.default({}),
  })
  .strict()
  .superRefine((job, context) => {
    const taskIds = job.tasks.map((task) => task.chunk_id);
    if (new Set(taskIds).size !== taskIds.length) {
      context.addIssue({ code: "custom", message: "task chunk IDs 不得重複", path: ["tasks"] });
    }

    const statuses = job.tasks.map((task) => task.status);
    const expectedStatus = statuses.length > 0 && statuses.every((status) => status === "superseded")
      ? "superseded"
      : statuses.every((status) => status === "completed")
        ? "completed"
        : statuses.some((status) => status === "processing")
          ? "processing"
          : statuses.some((status) => status === "failed")
            ? "failed"
            : "pending";
    if (job.status !== expectedStatus) {
      context.addIssue({
        code: "custom",
        message: `job status 必須由 tasks 推導為 ${expectedStatus}`,
        path: ["status"],
      });
    }
  });

export type IngestionTaskStatus = z.infer<typeof ingestionTaskStatusSchema>;
export type IngestionChunkTask = z.output<typeof ingestionChunkTaskSchema>;
export type IngestionJob = z.output<typeof ingestionJobSchema>;
