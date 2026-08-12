import path from "node:path";
import { closeDashboardServer, DashboardLauncherError, launchDashboard } from "../packages/server/src/dashboard-launcher.js";

async function main(): Promise<void> {
  const workspaceRoot = path.resolve(process.cwd());
  const result = await launchDashboard(workspaceRoot);
  if (result.ownership !== "started" || result.server === undefined) return;

  let closing = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (closing) return;
    closing = true;
    process.stdout.write(`\n收到 ${signal}，正在停止 ST Workspace server...\n`);
    try {
      await closeDashboardServer(result.server!);
      process.stdout.write("ST Workspace server 已停止。\n");
      process.exitCode = 0;
    } catch (error) {
      process.stderr.write(`DASHBOARD_SHUTDOWN_FAILED：${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    }
  };

  process.once("SIGINT", () => void shutdown("Ctrl+C"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error) => {
  if (error instanceof DashboardLauncherError) {
    process.stderr.write(`${error.message}\n`);
  } else {
    process.stderr.write(`DASHBOARD_START_FAILED：${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  }
  process.exitCode = 1;
});
