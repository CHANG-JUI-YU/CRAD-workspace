import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const packageSource = (name: string) =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@card-workspace/schemas": packageSource("schemas"),
      "@card-workspace/project": packageSource("project"),
      "@card-workspace/testing": packageSource("testing"),
      "@card-workspace/workflow": packageSource("workflow"),
    },
  },
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["packages/*/src/**/*.ts", "apps/dashboard/src/**/*.{ts,tsx}"],
      exclude: [
        "**/node_modules/**",
        "**/dist/**",
        ".legacy-v1/**",
        "coverage/**",
        "**/test/**",
        "**/e2e/**",
        "**/*.d.ts",
      ],
      excludeAfterRemap: true,
      thresholds: {
        branches: 80,
        functions: 85,
        lines: 85,
        statements: 85,
      },
    },
    include: ["**/test/**/*.test.ts"],
    // Coverage instrumentation makes the deterministic ingestion fixtures I/O-heavy on Windows.
    testTimeout: 60_000,
  },
});
