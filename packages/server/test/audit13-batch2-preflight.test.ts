import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  executeQualityGate,
  qualityGateMain,
  qualityPipelineGateIds,
  runQualityPipeline,
  type QualityGate,
} from "../../../tools/quality-gates.js";

const repositoryRoot = path.resolve(process.cwd());

describe("Audit 13 #212 local preflight", () => {
  it("uses coverage as the single local full-suite execution", () => {
    expect(qualityPipelineGateIds("local")).toEqual([
      "build",
      "typecheck",
      "typed-lint",
      "package-coverage",
      "maintenance-tool-coverage",
      "dependency-audit",
    ]);
    expect(qualityPipelineGateIds("local")).not.toContain("tests-serial");
    expect(qualityPipelineGateIds("ci-correctness")).toEqual([
      "typecheck",
      "typed-lint",
      "tests-serial",
    ]);
    expect(qualityPipelineGateIds("ci-coverage")).toEqual([
      "package-coverage",
      "maintenance-tool-coverage",
    ]);
    expect(qualityPipelineGateIds("ci-dependency-audit")).toEqual(["dependency-audit"]);
  });

  it("stops at the first failed gate and preserves its exit code", () => {
    const seen: string[] = [];
    const errors: string[] = [];
    const code = runQualityPipeline("local", {
      execute: (gate) => {
        seen.push(gate.id);
        return gate.id === "typed-lint" ? 23 : 0;
      },
      out: () => undefined,
      err: (message) => errors.push(message),
    });

    expect(code).toBe(23);
    expect(seen).toEqual(["build", "typecheck", "typed-lint"]);
    expect(errors.join("\n")).toContain("Typed lint");
  });

  it("reports invalid pipeline names with a non-zero exit code", () => {
    const errors: string[] = [];
    expect(qualityGateMain(["not-a-pipeline"], { err: (message) => errors.push(message) })).toBe(2);
    expect(errors.join("\n")).toContain("Unknown quality pipeline");
  });

  it("can execute a pnpm gate cross-platform", () => {
    const gate: QualityGate = {
      id: "build",
      label: "pnpm version probe",
      args: ["--version"],
    };
    expect(executeQualityGate(gate)).toBe(0);
  });

  it("wires CI and local verification through the same gate registry", async () => {
    const packageJson = JSON.parse(await readFile(path.join(repositoryRoot, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    const ci = await readFile(path.join(repositoryRoot, ".github", "workflows", "ci.yml"), "utf8");
    const security = await readFile(path.join(repositoryRoot, ".github", "workflows", "security.yml"), "utf8");
    const readme = await readFile(path.join(repositoryRoot, "README.md"), "utf8");
    const toolsCoverage = await readFile(path.join(repositoryRoot, "vitest.tools.config.ts"), "utf8");

    expect(packageJson.scripts.verify).toBe("tsx tools/quality-gates.ts local");
    expect(packageJson.scripts["quality:correctness:only"]).toBe("tsx tools/quality-gates.ts ci-correctness");
    expect(packageJson.scripts["quality:coverage:only"]).toBe("tsx tools/quality-gates.ts ci-coverage");
    expect(packageJson.scripts["quality:dependency-audit:only"]).toBe(
      "tsx tools/quality-gates.ts ci-dependency-audit",
    );
    expect(packageJson.scripts["audit:dependencies"]).toBe("pnpm audit --audit-level=high");
    expect(packageJson.scripts.check).toBe("pnpm build && pnpm typecheck:only && pnpm test:only");

    expect(ci).toContain("run: pnpm quality:correctness:only");
    expect(ci).toContain("run: pnpm quality:coverage:only");
    expect(security).toContain("run: pnpm audit:dependencies");
    expect(ci).not.toContain("run: pnpm lint:only");
    expect(ci).not.toContain("run: pnpm test:coverage:only");

    expect(readme).toContain("pnpm verify");
    expect(readme).toContain("Local-equivalent required gates");
    expect(readme).toContain("Remote-only required gates");
    expect(readme).toContain("`pnpm check` 不是完整的 pre-PR gate");
    expect(readme).toContain("`pnpm agent:lint` 與 `pnpm audit:truncation`");

    expect(toolsCoverage).toContain("packages/server/test/audit13-batch2-preflight.test.ts");
    expect(toolsCoverage).toContain("tools/quality-gates.ts");
  });
});
