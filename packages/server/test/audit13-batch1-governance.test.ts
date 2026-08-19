import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const repositoryRoot = path.resolve(process.cwd());

function runPython(args: string[]): SpawnSyncReturns<string> {
  for (const command of ["python", "python3"]) {
    const result = spawnSync(command, args, {
      cwd: repositoryRoot,
      encoding: "utf8",
    });
    if ((result.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
      continue;
    }
    return result;
  }
  throw new Error("Python 3 is required to validate Audit governance fixtures");
}

describe("Audit 13 #211 governance identity", () => {
  it("executes the canonical matcher fixture matrix", () => {
    const result = runPython([
      ".github/scripts/audit_issue_identity.py",
      "--check-fixtures",
      ".github/scripts/audit_issue_identity_fixtures.json",
    ]);
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stdout).toContain("Audit issue identity fixtures");
  });

  it("keeps PR guard and verify-close on the same trusted matcher", async () => {
    const governance = await readFile(
      path.join(repositoryRoot, ".github", "workflows", "governance.yml"),
      "utf8",
    );
    const closeWorkflow = await readFile(
      path.join(repositoryRoot, ".github", "workflows", "close-audit-issue.yml"),
      "utf8",
    );
    const governanceYaml = parse(governance) as { permissions: Record<string, string> };
    const closeYaml = parse(closeWorkflow) as { permissions: Record<string, string> };

    for (const workflow of [governance, closeWorkflow]) {
      expect(workflow).toContain("from audit_issue_identity import is_audit_issue_title");
      expect(workflow).not.toContain('title.startswith("[AUDIT")');
    }
    expect(governance).toContain("ref: ${{ github.event.pull_request.base.sha }}");
    expect(closeWorkflow).toContain("ref: main");
    expect(governanceYaml.permissions).toEqual({
      contents: "read",
      issues: "read",
      "pull-requests": "read",
    });
    expect(closeYaml.permissions).toEqual({
      actions: "read",
      contents: "read",
      issues: "write",
    });
  });

  it("documents one canonical title format and legacy read compatibility", async () => {
    const governanceDoc = await readFile(path.join(repositoryRoot, "docs", "governance.md"), "utf8");
    expect(governanceDoc).toContain("`<CATEGORY><ROUND>-<SEQUENCE>: <summary>`");
    expect(governanceDoc).toContain("Legacy bracketed titles are read-only compatibility");
    expect(governanceDoc).toContain("Only the issue title establishes Audit identity");
  });
});
