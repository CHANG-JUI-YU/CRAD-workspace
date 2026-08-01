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
        branches: 90,
        functions: 90,
        lines: 90,
        statements: 90,
      },
    },
    include: ["**/test/**/*.test.{ts,tsx}"],
    // Coverage instrumentation makes the deterministic ingestion fixtures I/O-heavy on Windows.
    testTimeout: 60_000,
  },
});
