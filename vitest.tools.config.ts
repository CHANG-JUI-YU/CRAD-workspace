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
    },
  },
});
