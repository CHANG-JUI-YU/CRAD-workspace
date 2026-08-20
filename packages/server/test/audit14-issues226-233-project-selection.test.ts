import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileProjectRepository } from "@st-workspace/core";
import { dashboard } from "../src/dashboard.js";
import { DASHBOARD_PANELS_PROJECT_SELECTOR_UX_JS } from "../src/dashboard-project-selector-ux.js";
import { startWorkspaceServer, type WorkspaceServer } from "../src/index.js";

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        await rm(root, { recursive: true, force: true });
        break;
      } catch (error) {
        if (attempt === 9) throw error;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
  }
});

function extractFunctions(source: string, names: string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const name of names) {
    const marker = `function ${name}(`;
    const start = source.indexOf(marker);
    if (start < 0) throw new Error(`missing function ${name}`);
    let depth = 0;
    let inBody = false;
    let end = -1;
    for (let index = start + marker.length; index < source.length; index += 1) {
      const char = source[index];
      if (!inBody) {
        if (char === "{") {
          inBody = true;
          depth = 1;
        }
        continue;
      }
      if (char === "{") depth += 1;
      if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          end = index + 1;
          break;
        }
      }
    }
    if (end < 0) throw new Error(`unterminated function ${name}`);
    out.set(name, source.slice(start, end));
  }
  return out;
}

function executeFunctions(names: string[], context: Record<string, unknown>): Record<string, any> {
  const functions = extractFunctions(DASHBOARD_PANELS_PROJECT_SELECTOR_UX_JS, names);
  const keys = Object.keys(context);
  const args = keys.map((key) => context[key]);
  const body = names.map((name) => functions.get(name)).join("\n");
  const factory = new Function(...keys, `${body}\nreturn { ${names.join(", ")} };`);
  return factory(...args) as Record<string, any>;
}

const isRecord = (value: unknown): value is Record<string, any> => value !== null && typeof value === "object" && !Array.isArray(value);
const hasOwn = (record: unknown, key: string): boolean => isRecord(record) && Object.prototype.hasOwnProperty.call(record, key);
const firstString = (record: unknown, keys: string[]): string | undefined => {
  if (!isRecord(record)) return undefined;
  for (const key of keys) {
    if (typeof record[key] === "string" && record[key].trim().length > 0) return record[key];
  }
  return undefined;
};
const valueText = (value: unknown): string => value === undefined || value === null ? "—" : typeof value === "string" ? value : String(value);
const lastPathSegment = (value: unknown): string | undefined => {
  if (typeof value !== "string" || value.trim().length === 0) return undefined;
  const slash = Math.max(value.lastIndexOf("/"), value.lastIndexOf("\\"));
  return value.slice(slash + 1) || undefined;
};

async function createProject(root: string, id: string, name: string): Promise<void> {
  const repository = new FileProjectRepository(root, id, { layout: "project", materialize: true });
  const initial = await repository.read();
  await repository.commit(initial.revision, (state) => ({
    ...state,
    project_name: name,
    project_slug: id,
    project_status: "ready",
  }));
}

describe("Audit 14 issues #226 + #233 project selector UX", () => {
  it("uses unique folder selectors, disambiguates duplicate display names, and omits revision labels", () => {
    const { projectEntries } = executeFunctions(["projectEntries"], { isRecord, firstString, valueText, lastPathSegment });
    const entries = projectEntries({
      projects: [
        { project_name: "Alice", path: "/projects/Alice", project_id: "Alice", revision: 4 },
        { project_name: "Alice", path: "/projects/Alice-2", project_id: "Alice-2", revision: 9 },
        { project_name: "Bob", path: "/projects/Bob", project_id: "Bob", revision: 3 },
      ],
    });

    expect(entries.map((entry: any) => entry.value)).toEqual(["Alice", "Alice-2", "Bob"]);
    expect(new Set(entries.map((entry: any) => entry.value)).size).toBe(entries.length);
    expect(entries.map((entry: any) => entry.label)).toEqual([
      "Alice（資料夾：Alice）",
      "Alice（資料夾：Alice-2）",
      "Bob",
    ]);
    expect(entries.map((entry: any) => entry.label).join(" ")).not.toMatch(/revision|（r\d+/iu);
  });

  it("syncs the current project by its exact folder selector instead of guessing by display name", () => {
    const select = {
      selectedIndex: 0,
      options: [
        { value: "Alice", textContent: "Alice（資料夾：Alice）" },
        { value: "Alice-2", textContent: "Alice（資料夾：Alice-2）" },
      ],
    };
    const state = { currentProjectValue: "" };
    const { syncProjectSelection } = executeFunctions(["projectReference", "syncProjectSelection"], {
      isRecord,
      firstString,
      lastPathSegment,
      state,
      byId: () => select,
    });

    syncProjectSelection({ project_name: "Alice", project_id: "Alice-2", project_path: "C:\\projects\\Alice-2" });
    expect(state.currentProjectValue).toBe("Alice-2");
    expect(select.selectedIndex).toBe(1);
  });

  it("keeps revision, lease, CAS and internal IDs out of normal fields while raw JSON remains intact", () => {
    const rows: Array<{ label: string; value: string }> = [];
    const { renderFields } = executeFunctions(["internalSyncField", "renderFields"], {
      isRecord,
      hasOwn,
      valueText,
      appendField: (_container: unknown, label: string, value: string) => rows.push({ label, value }),
    });
    const record = {
      project_name: "Alice",
      status: "ready",
      summary: "已切換專案。",
      project_path: "/projects/Alice-2",
      revision: 7,
      project_revision: 7,
      project_id: "Alice-2",
      operation_id: "operation-123",
      lease_token: "lease-secret",
      lease_expires_at: "2099-01-01T00:00:00Z",
      cas: "opaque-cas",
    };

    renderFields({}, record);
    const visible = JSON.stringify(rows);
    expect(visible).toContain("Alice");
    expect(visible).toContain("ready");
    expect(visible).not.toContain("revision");
    expect(visible).not.toContain("Alice-2\"");
    expect(visible).not.toContain("operation-123");
    expect(visible).not.toContain("lease-secret");
    expect(visible).not.toContain("opaque-cas");

    const raw = JSON.stringify(record);
    expect(raw).toContain('"revision":7');
    expect(raw).toContain('"project_id":"Alice-2"');
    expect(raw).toContain('"lease_token":"lease-secret"');
    expect(raw).toContain('"cas":"opaque-cas"');
    expect(dashboard()).toContain('byId("status-json").textContent = jsonText(payload);');
  });

  it("selects missing, unique-name, duplicate-name and explicit-folder cases through the server boundary", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "st-workspace-v3-audit14-selector-"));
    roots.push(root);
    await createProject(root, "Alice", "Alice");
    await createProject(root, "Alice-2", "Alice");
    await createProject(root, "Bob-folder", "Bob");

    const server = await startWorkspaceServer({ port: 0, projectRoot: root, actor: "user" }) as WorkspaceServer;
    await server.workspaceWorker.stop();
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("server did not bind");
    const base = `http://127.0.0.1:${address.port}`;
    const select = (project: string) => fetch(`${base}/workspace/project/select`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ project }),
    });

    try {
      const listed = await (await fetch(`${base}/workspace/projects`)).json() as { projects: Array<{ project_name?: string; path: string }> };
      expect(listed.projects.filter((project) => project.project_name === "Alice")).toHaveLength(2);

      const missing = await select("Missing");
      expect(missing.ok).toBe(false);
      expect((await missing.json() as { code?: string }).code).toBe("PROJECT_NOT_FOUND");

      const unique = await select("Bob");
      expect(unique.ok).toBe(true);
      expect((await unique.json() as { project_id?: string }).project_id).toBe("Bob-folder");

      const ambiguous = await select("Alice");
      expect(ambiguous.ok).toBe(false);
      expect((await ambiguous.json() as { code?: string }).code).toBe("PROJECT_SELECTION_AMBIGUOUS");

      const explicitFolder = await select("Alice-2");
      expect(explicitFolder.ok).toBe(true);
      expect((await explicitFolder.json() as { project_id?: string; project_name?: string }).project_id).toBe("Alice-2");
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
    }
  });
});
