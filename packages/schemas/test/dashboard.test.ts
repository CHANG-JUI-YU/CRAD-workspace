import { describe, expect, it } from "vitest";

import {
  dashboardBootstrapRequestSchema,
  dashboardGraphRequestSchema,
  dashboardPatchRequestSchema,
  dashboardResourceRefSchema,
} from "../src/index.js";

const revision = `sha256:${"a".repeat(64)}`;

describe("dashboard contracts", () => {
  it("accepts typed patch requests", () => {
    expect(dashboardPatchRequestSchema.parse({
      resource: { project_id: "demo", kind: "blueprint", id: "blueprint" },
      expected_revision: revision,
      operations: [{ op: "replace", path: "/summary", value: "new" }],
      dry_run: true,
    }).dry_run).toBe(true);
  });

  it("does not accept filesystem paths as resources", () => {
    expect(() => dashboardResourceRefSchema.parse({
      project_id: "demo", kind: "blueprint", id: "../../secrets",
    })).toThrow();
    expect(() => dashboardPatchRequestSchema.parse({
      resource: { project_id: "demo", kind: "blueprint", id: "blueprint" },
      expected_revision: revision,
      operations: [{ op: "replace", path: "summary", value: "new" }],
      dry_run: true,
      file_path: "C:\\secret",
    })).toThrow();
  });

  it("bounds bootstrap and graph input", () => {
    expect(() => dashboardBootstrapRequestSchema.parse({ token: "short" })).toThrow();
    expect(() => dashboardGraphRequestSchema.parse({ project_id: "demo", limit: 501 })).toThrow();
  });
});
