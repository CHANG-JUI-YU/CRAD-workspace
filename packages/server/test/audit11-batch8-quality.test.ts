import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { lintTypeScriptProject, runTypedLint } from "../../../tools/typed-lint.js";

const repositoryRoot = path.resolve(process.cwd());

async function lintFixture(source: string): Promise<{ root: string; configPath: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "st-audit11-typed-lint-"));
  const sourceRoot = path.join(root, "src");
  await mkdir(sourceRoot, { recursive: true });
  await writeFile(path.join(sourceRoot, "fixture.ts"), source, "utf8");
  const configPath = path.join(root, "tsconfig.json");
  await writeFile(
    configPath,
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          noUnusedLocals: true,
          noUnusedParameters: true,
          noFallthroughCasesInSwitch: true,
        },
        include: ["src/**/*.ts"],
      },
      null,
      2,
    ),
    "utf8",
  );
  return { root, configPath };
}

describe("Audit 11 #157 typed lint", () => {
  it("accepts awaited and explicitly discarded promises", async () => {
    const fixture = await lintFixture(`
      export async function clean(): Promise<void> {
        await Promise.resolve();
        void Promise.resolve();
      }
    `);
    try {
      expect(lintTypeScriptProject(fixture.configPath)).toMatchObject({ findings: [] });
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("reports floating promises, promise conditions, fallthrough and unused locals", async () => {
    const fixture = await lintFixture(`
      export function broken(flag: boolean): void {
        const unused = 1;
        switch (flag ? 1 : 0) {
          case 0:
            console.log("zero");
          case 1:
            break;
        }
        Promise.resolve();
        if (Promise.resolve(true)) console.log("bad");
      }
    `);
    try {
      const report = lintTypeScriptProject(fixture.configPath);
      expect(new Set(report.findings.map((finding) => finding.rule))).toEqual(
        new Set(["no-floating-promises", "no-promise-condition", "no-fallthrough", "no-unused"]),
      );
      const errors: string[] = [];
      expect(runTypedLint([fixture.configPath], { out: () => undefined, err: (message) => errors.push(message) })).toBe(1);
      expect(errors.join("\n")).toContain("Typed lint failed with");
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("keeps lint and maintenance coverage in the required CI path without another build", async () => {
    const packageJson = JSON.parse(await readFile(path.join(repositoryRoot, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    const ci = await readFile(path.join(repositoryRoot, ".github", "workflows", "ci.yml"), "utf8");
    const toolsCoverage = await readFile(path.join(repositoryRoot, "vitest.tools.config.ts"), "utf8");

    expect(packageJson.scripts.lint).toBe("pnpm build && pnpm lint:only");
    expect(packageJson.scripts["lint:only"]).toBe("tsx tools/typed-lint.ts");
    expect(packageJson.scripts["test:tools:coverage"]).toBe("pnpm build && pnpm test:tools:coverage:only");
    expect(packageJson.scripts["test:tools:coverage:only"]).toContain("vitest.tools.config.ts");
    expect(packageJson.scripts.check).toBe("pnpm build && pnpm typecheck:only && pnpm test:only");
    expect(packageJson.scripts.check.match(/pnpm build/gu)?.length).toBe(1);
    expect(ci).toContain("run: pnpm lint:only");
    expect(ci).toContain("run: pnpm test:tools:coverage:only");
    for (const supportedTool of [
      "tools/agent-lint.ts",
      "tools/audit-truncation-scan.ts",
      "tools/structured-config.ts",
      "tools/typed-lint.ts",
    ]) {
      expect(toolsCoverage).toContain(`\"${supportedTool}\"`);
    }
  });
});
