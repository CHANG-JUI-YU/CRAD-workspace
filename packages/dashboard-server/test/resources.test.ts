import type { DashboardResourceRef } from "@card-workspace/schemas";
import { describe, expect, it } from "vitest";

import { patchDashboardDocument, resourcePath } from "../src/resources.js";

function expectCode(operation: () => unknown, code: string): void {
  try {
    operation();
    throw new Error(`expected dashboard error ${code}`);
  } catch (error: unknown) {
    expect(error).toMatchObject({ code });
  }
}

describe("dashboard resource paths", () => {
  it.each([
    [{ kind: "project", id: "project" }, "project.yaml"],
    [{ kind: "blueprint", id: "blueprint" }, "blueprint.yaml"],
    [{ kind: "greetings", id: "greetings" }, "greetings.yaml"],
    [{ kind: "workflow", id: "workflow" }, "workflow.json"],
    [{ kind: "character", id: "alice" }, "characters/alice/character.yaml"],
    [{ kind: "zhuji_module", id: "appearance", owner_id: "alice" }, "characters/alice/zhuji/01-appearance.yaml"],
    [{ kind: "palette_module", id: "basic_information", owner_id: "alice" }, "characters/alice/palette/01-basic-information.yaml"],
    [{ kind: "world_entry", id: "capital", owner_id: "geography" }, "world/geography/capital.yaml"],
  ] satisfies Array<[DashboardResourceRef, string]>)("maps $0.kind to a fixed path", (resource, expected) => {
    expect(resourcePath(resource)).toBe(expected);
  });

  it.each(["source", "fact", "preview", "export"] as const)("keeps %s resources read-only", (kind) => {
    expectCode(() => resourcePath({ kind, id: "item" }), "DASHBOARD_RESOURCE_READ_ONLY");
  });

  it("requires owners for nested resources", () => {
    expectCode(() => resourcePath({ kind: "zhuji_module", id: "appearance" }), "DASHBOARD_RESOURCE_OWNER_REQUIRED");
    expectCode(() => resourcePath({ kind: "palette_module", id: "basic_information" }), "DASHBOARD_RESOURCE_OWNER_REQUIRED");
    expectCode(() => resourcePath({ kind: "world_entry", id: "capital" }), "DASHBOARD_RESOURCE_OWNER_REQUIRED");
  });

  it("禁止 workflow 走一般 document patch", async () => {
    await expect(patchDashboardDocument({
      projectRoot: "unused",
      resource: { kind: "workflow", id: "workflow" },
      expectedRevision: `sha256:${"0".repeat(64)}`,
      operations: [],
      dryRun: true,
    })).rejects.toMatchObject({ code: "DASHBOARD_RESOURCE_READ_ONLY" });
  });
});
