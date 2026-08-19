import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "packages/server/test/audit9-batch10-maintenance.test.ts",
      "packages/server/test/audit11-batch8-quality.test.ts",
    ],
    testTimeout: 30_000,
    maxWorkers: 1,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "json"],
      include: [
        "tools/agent-lint.ts",
        "tools/audit-truncation-scan.ts",
        "tools/structured-config.ts",
        "tools/typed-lint.ts",
      ],
      // The measured weakest supported-tool baseline is 84.18% statements/lines,
      // 64.38% branches and 90% functions. Keep per-file floors a few points
      // below that baseline so ordinary line movement is tolerated without
      // allowing any maintenance tool to fall out of meaningful coverage.
      thresholds: {
        perFile: true,
        statements: 80,
        branches: 60,
        functions: 85,
        lines: 80,
      },
    },
  },
});
