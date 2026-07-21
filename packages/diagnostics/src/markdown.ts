import type { AuditReport } from "@card-workspace/schemas";

export function renderAuditMarkdown(report: AuditReport, title = "Card Audit"): string {
  const lines = [
    `# ${title}`,
    "",
    `- Result: ${report.blocked ? "BLOCKED" : report.ok ? "PASS" : "REVIEW"}`,
    `- Errors: ${report.summary.errors}`,
    `- Warnings: ${report.summary.warnings}`,
    `- Info: ${report.summary.info}`,
    "",
  ];
  for (const item of report.findings) {
    lines.push(
      `## [${item.severity.toUpperCase()}] ${item.rule_id}`,
      "",
      `Layer: ${item.layer}`,
      "",
      item.message,
      "",
    );
  }
  return `${lines.join("\n")}\n`;
}
