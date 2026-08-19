import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type QualityGateId =
  | "build"
  | "typecheck"
  | "typed-lint"
  | "tests-serial"
  | "package-coverage"
  | "maintenance-tool-coverage"
  | "dependency-audit";

export type QualityPipelineName = "local" | "ci-correctness" | "ci-coverage" | "ci-dependency-audit";

export interface QualityGate {
  id: QualityGateId;
  label: string;
  args: readonly string[];
}

export type QualityGateExecutor = (gate: QualityGate) => number;

const GATES: Record<QualityGateId, QualityGate> = {
  build: {
    id: "build",
    label: "Build workspace",
    args: ["build"],
  },
  typecheck: {
    id: "typecheck",
    label: "Typecheck",
    args: ["typecheck:only"],
  },
  "typed-lint": {
    id: "typed-lint",
    label: "Typed lint",
    args: ["lint:only"],
  },
  "tests-serial": {
    id: "tests-serial",
    label: "Full test suite (serial files)",
    args: ["exec", "vitest", "run", "--no-file-parallelism"],
  },
  "package-coverage": {
    id: "package-coverage",
    label: "Package coverage gate",
    args: ["test:coverage:only"],
  },
  "maintenance-tool-coverage": {
    id: "maintenance-tool-coverage",
    label: "Maintenance tool coverage gate",
    args: ["test:tools:coverage:only"],
  },
  "dependency-audit": {
    id: "dependency-audit",
    label: "Dependency audit (high+)",
    args: ["audit", "--audit-level=high"],
  },
};

const PIPELINES: Record<QualityPipelineName, readonly QualityGateId[]> = {
  // Package coverage executes the complete test suite, so local preflight does
  // not run tests-serial immediately beforehand and then repeat the suite with
  // coverage instrumentation.
  local: [
    "build",
    "typecheck",
    "typed-lint",
    "package-coverage",
    "maintenance-tool-coverage",
    "dependency-audit",
  ],
  "ci-correctness": ["typecheck", "typed-lint", "tests-serial"],
  "ci-coverage": ["package-coverage", "maintenance-tool-coverage"],
  "ci-dependency-audit": ["dependency-audit"],
};

export function qualityPipelineGateIds(name: QualityPipelineName): readonly QualityGateId[] {
  return PIPELINES[name];
}

function pnpmExecutable(): string {
  return process.platform === "win32" ? "pnpm.cmd" : "pnpm";
}

export function executeQualityGate(gate: QualityGate): number {
  const result = spawnSync(pnpmExecutable(), [...gate.args], {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) {
    console.error(`Failed to start ${gate.label}: ${result.error.message}`);
    return 1;
  }
  return typeof result.status === "number" ? result.status : 1;
}

export function runQualityPipeline(
  name: QualityPipelineName,
  options: {
    execute?: QualityGateExecutor;
    out?: (message: string) => void;
    err?: (message: string) => void;
  } = {},
): number {
  const execute = options.execute ?? executeQualityGate;
  const out = options.out ?? console.log;
  const err = options.err ?? console.error;

  for (const id of PIPELINES[name]) {
    const gate = GATES[id];
    out(`==> ${gate.label}`);
    const code = execute(gate);
    if (code !== 0) {
      err(`Quality gate failed: ${gate.label} (exit ${code})`);
      return code;
    }
  }

  out(`Quality pipeline passed: ${name}`);
  return 0;
}

function isQualityPipelineName(value: string): value is QualityPipelineName {
  return value === "local"
    || value === "ci-correctness"
    || value === "ci-coverage"
    || value === "ci-dependency-audit";
}

export function qualityGateMain(
  argv: readonly string[],
  options: {
    execute?: QualityGateExecutor;
    out?: (message: string) => void;
    err?: (message: string) => void;
  } = {},
): number {
  const name = argv[0] ?? "local";
  if (!isQualityPipelineName(name)) {
    (options.err ?? console.error)(
      `Unknown quality pipeline: ${name}. Expected local, ci-correctness, ci-coverage, or ci-dependency-audit.`,
    );
    return 2;
  }
  return runQualityPipeline(name, options);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  process.exitCode = qualityGateMain(process.argv.slice(2));
}
