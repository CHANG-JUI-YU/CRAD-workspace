import { describe, expect, it } from "vitest";
import { DASHBOARD_API_JS } from "../src/dashboard-api.js";
import { DASHBOARD_MARKUP } from "../src/dashboard-markup.js";
import { DASHBOARD_PANELS_CORE_JS } from "../src/dashboard-panels-core.js";

function extractFunctions(source: string, names: string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const name of names) {
    const pattern = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`, "u");
    const match = pattern.exec(source);
    if (!match) continue;
    const start = match.index;
    const parenStart = source.indexOf("(", start);
    let depth = 0;
    let i = parenStart;
    for (; i < source.length; i++) {
      const ch = source[i];
      if (ch === "(") depth += 1;
      else if (ch === ")") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    let braceDepth = 0;
    let bodyStart = -1;
    for (let j = i + 1; j < source.length; j++) {
      if (source[j] === "{") {
        if (braceDepth === 0) bodyStart = j;
        braceDepth += 1;
      } else if (source[j] === "}") {
        braceDepth -= 1;
        if (braceDepth === 0 && bodyStart >= 0) {
          out.set(name, source.slice(start, j + 1));
          break;
        }
      }
    }
  }
  return out;
}

describe("Audit 8 Batch 6 - Dashboard per-action busy and operation monitor", () => {
  it("exposes setActionBusy and scoped runTask in the Dashboard API surface", () => {
    expect(DASHBOARD_API_JS).toContain("function runTask(label, task, busyKey)");
    expect(DASHBOARD_API_JS).toContain("setActionBusy(busyKey, true)");
    expect(DASHBOARD_API_JS).toContain("setActionBusy(busyKey, false)");
    expect(DASHBOARD_PANELS_CORE_JS).toContain("function setActionBusy(controlId, busy)");
  });

  it("includes the adaptive operation monitor with visibility and online handling", () => {
    expect(DASHBOARD_API_JS).toContain("function operationMonitorSchedule()");
    expect(DASHBOARD_API_JS).toContain("function operationMonitorTick()");
    expect(DASHBOARD_API_JS).toContain("function startOperationMonitoring()");
    expect(DASHBOARD_API_JS).toContain("operationMonitorRunning ? 3000 : 12000");
    expect(DASHBOARD_API_JS).toContain("visibilitychange");
    expect(DASHBOARD_API_JS).toContain('addEventListener("online"');
    expect(DASHBOARD_API_JS).toContain("operationMonitorGeneration");
    expect(DASHBOARD_API_JS).toContain("renderOperationList(items)");
    expect(DASHBOARD_API_JS).toContain("startOperationMonitoring();");
  });

  it("marks the operation panel with a last-updated element", () => {
    expect(DASHBOARD_MARKUP).toContain('id="operation-last-updated"');
    expect(DASHBOARD_MARKUP).toContain('aria-labelledby="operation-heading"');
  });

  it("keeps the dashboard shell free of unsafe innerHTML", () => {
    expect(DASHBOARD_MARKUP).not.toContain("innerHTML");
    expect(DASHBOARD_API_JS).not.toContain("innerHTML");
    expect(DASHBOARD_PANELS_CORE_JS).not.toContain("innerHTML");
  });

  it("extracts and executes setActionBusy with a fake DOM element", () => {
    const functions = extractFunctions(DASHBOARD_PANELS_CORE_JS, ["setActionBusy"]);
    expect(functions.has("setActionBusy")).toBe(true);
    const byIdStub = { disabled: false };
    const ctx = new Function("byId", functions.get("setActionBusy") + "\nreturn { setActionBusy };")((id: string) => (id === "submit-request" ? byIdStub : undefined));
    ctx.setActionBusy("submit-request", true);
    expect(byIdStub.disabled).toBe(true);
    ctx.setActionBusy("submit-request", false);
    expect(byIdStub.disabled).toBe(false);
    ctx.setActionBusy("missing-control", true);
  });
});
