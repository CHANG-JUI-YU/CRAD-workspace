import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const repositoryRoot = path.resolve(process.cwd());

type WorkflowDocument = {
  permissions: Record<string, string>;
  jobs: Record<
    string,
    {
      steps?: Array<{
        name?: string;
        env?: Record<string, string>;
        run?: string;
      }>;
    }
  >;
};

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

  it("keeps PR guard and verify-close on the same matcher with minimal token exposure", async () => {
    const governance = await readFile(
      path.join(repositoryRoot, ".github", "workflows", "governance.yml"),
      "utf8",
    );
    const closeWorkflow = await readFile(
      path.join(repositoryRoot, ".github", "workflows", "close-audit-issue.yml"),
      "utf8",
    );
    const governanceYaml = parse(governance) as WorkflowDocument;
    const closeYaml = parse(closeWorkflow) as WorkflowDocument;

    for (const workflow of [governance, closeWorkflow]) {
      expect(workflow).toContain("from audit_issue_identity import is_audit_issue_title");
      expect(workflow).not.toContain('title.startswith("[AUDIT")');
    }

    const prSteps = governanceYaml.jobs["pr-governance"]?.steps ?? [];
    const collector = prSteps.find((step) => step.name === "Collect issue-closing candidates");
    const classifier = prSteps.find(
      (step) => step.name === "Prevent Audit issues from closing at merge time",
    );
    expect(collector?.env?.GH_TOKEN).toBe("${{ github.token }}");
    expect(classifier?.env).toEqual({
      CANDIDATE_PATH: "${{ runner.temp }}/audit-closing-candidates.json",
    });
    expect(classifier?.run).toContain("from audit_issue_identity import is_audit_issue_title");
    expect(classifier?.env).not.toHaveProperty("GH_TOKEN");
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
