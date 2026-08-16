import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "apps/*/test/**/*.test.ts"],
    testTimeout: 30_000,
    maxWorkers: 4,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "json"],
      include: ["packages/*/src/**/*.ts"],
      exclude: ["**/dist/**", "**/*.d.ts", "packages/cli/src/index.ts"],
      thresholds: {
        lines: 90,
        statements: 90,
        functions: 90,
        branches: 82,
      },
    },
  },
});
