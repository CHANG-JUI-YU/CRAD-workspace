import {
  auditReportSchema,
  characterCardV3Schema,
  lorebookV3Schema,
  type AuditFinding,
  type AuditReport,
  type CharacterCardV3,
  type Ccv3Lorebook,
  type PolicyProfile,
  type TokenSimulationReport,
} from "@card-workspace/schemas";

export interface AuditOptions {
  tokenReport?: TokenSimulationReport;
  policy?: PolicyProfile;
  strict?: boolean;
  workspaceFindings?: AuditFinding[];
}

type FindingInput = Omit<AuditFinding, "evidence" | "fixability" | "overridable"> &
  Partial<Pick<AuditFinding, "evidence" | "fixability" | "overridable">>;

function finding(input: FindingInput): AuditFinding {
  return {
    ...input,
    evidence: input.evidence ?? [],
    fixability: input.fixability ?? "manual",
    overridable: input.overridable ?? input.layer !== "normative",
  };
}

function normativeFindings(value: unknown): AuditFinding[] {
  const parsed = characterCardV3Schema.safeParse(value);
  if (parsed.success) return [];
  return parsed.error.issues.map((issue) =>
    finding({
      rule_id: "ccv3.schema",
      layer: "normative",
      severity: "error",
      message: issue.message,
      location: { file: "card.json", path: issue.path.map(String) },
      hint: "修正輸出以符合 Character Card V3 canonical schema。",
      overridable: false,
    }),
  );
}

function loreEntryCompatibilityFindings(
  lorebook: Ccv3Lorebook | undefined,
  file: string,
  pathPrefix: string[],
): AuditFinding[] {
  const findings: AuditFinding[] = [];
  lorebook?.entries.forEach((entry, index) => {
    const position = entry.extensions.position;
    if (position !== undefined && (typeof position !== "number" || position < 0 || position > 7)) {
      findings.push(
        finding({
          rule_id: "st.position.range",
          layer: "compatibility",
          severity: "error",
          message: "SillyTavern extension position 必須介於 0 至 7。",
          location: { file, path: [...pathPrefix, "entries", String(index), "extensions", "position"] },
        }),
      );
    }
    if (position === 7 && typeof entry.extensions.outlet_name !== "string") {
      findings.push(
        finding({
          rule_id: "st.outlet.name",
          layer: "compatibility",
          severity: "error",
          message: "Outlet position 必須提供 outlet_name。",
          location: { file, path: [...pathPrefix, "entries", String(index), "extensions"] },
        }),
      );
    }
    if (entry.use_regex) {
      entry.keys.forEach((key, keyIndex) => {
        if (!/^\/.+\/[dgimsuvy]*$/u.test(key)) {
          findings.push(
            finding({
              rule_id: "st.regex.serialization",
              layer: "compatibility",
              severity: "warning",
              message: "SillyTavern 相容 regex 應使用 /pattern/flags。",
              location: { file, path: [...pathPrefix, "entries", String(index), "keys", String(keyIndex)] },
            }),
          );
        }
      });
    }
  });
  return findings;
}

function compatibilityFindings(card: CharacterCardV3): AuditFinding[] {
  return loreEntryCompatibilityFindings(card.data.character_book, "card.json", ["data", "character_book"]);
}

function workspaceFindings(card: CharacterCardV3, tokenReport?: TokenSimulationReport): AuditFinding[] {
  const findings: AuditFinding[] = [];
  for (const field of ["description", "personality", "scenario", "mes_example"] as const) {
    if (card.data[field] !== "") {
      findings.push(
        finding({
          rule_id: `workspace.minimal.${field}`,
          layer: "workspace",
          severity: "error",
          message: `minimal_worldbook profile 要求 ${field} 為空字串。`,
          location: { file: "card.json", path: ["data", field] },
          fixability: "automatic",
        }),
      );
    }
  }
  card.data.character_book?.entries.forEach((entry, index) => {
    if (!/^<lore_entry\b[\s\S]*<\/lore_entry>$/u.test(entry.content)) {
      findings.push(
        finding({
          rule_id: "workspace.xml.boundary",
          layer: "workspace",
          severity: "warning",
          message: "世界書內容缺少完整 lore_entry XML 邊界。",
          location: { file: "card.json", path: ["data", "character_book", "entries", index, "content"] },
        }),
      );
    }
  });
  if (/\{\{user\}\}\s+(?:說|回答|點頭|搖頭|走向|決定)/iu.test(card.data.first_mes)) {
    findings.push(
      finding({
        rule_id: "workspace.greeting.puppeteering",
        layer: "workspace",
        severity: "warning",
        message: "首發開場白可能替 {{user}} 決定言行。",
        location: { file: "card.json", path: ["data", "first_mes"] },
      }),
    );
  }
  if (tokenReport?.over_budget) {
    findings.push(
      finding({
        rule_id: "workspace.token.constant-budget",
        layer: "workspace",
        severity: "error",
        message: `常駐內容 ${tokenReport.constant_tokens} tokens 超過預算 ${tokenReport.budget}。`,
        location: { file: ".build/token-report.json" },
      }),
    );
  }
  return findings;
}

function applyPolicy(findings: AuditFinding[], policy?: PolicyProfile): AuditFinding[] {
  if (!policy) return findings;
  const rules = new Map(policy.rules.map((rule) => [rule.id, rule]));
  return findings.flatMap((item) => {
    const override = rules.get(item.rule_id);
    if (!override || item.layer === "normative") return [item];
    if (!override.enabled || override.severity === "off") return [];
    return [{ ...item, severity: override.severity }];
  });
}

export function auditCharacterCard(value: unknown, options: AuditOptions = {}): AuditReport {
  const normative = normativeFindings(value);
  const parsed = characterCardV3Schema.safeParse(value);
  const other = parsed.success
    ? [...compatibilityFindings(parsed.data), ...workspaceFindings(parsed.data, options.tokenReport)]
    : [];
  const suppliedWorkspace = (options.workspaceFindings ?? []).map((item) => ({
    ...item,
    layer: "workspace" as const,
    overridable: true,
  }));
  const findings = applyPolicy([...normative, ...other, ...suppliedWorkspace], options.policy);
  const summary = {
    errors: findings.filter((item) => item.severity === "error").length,
    warnings: findings.filter((item) => item.severity === "warning").length,
    info: findings.filter((item) => item.severity === "info").length,
  };
  const blocked = (options.strict ?? true) && summary.errors > 0;
  return auditReportSchema.parse({
    schema_version: 1,
    ok: summary.errors === 0,
    blocked,
    findings,
    summary,
  });
}

export function auditLorebook(value: unknown, options: AuditOptions = {}): AuditReport {
  const parsed = lorebookV3Schema.safeParse(value);
  const normative = parsed.success ? [] : parsed.error.issues.map((issue) => finding({
    rule_id: "ccv3.lorebook.schema",
    layer: "normative",
    severity: "error",
    message: issue.message,
    location: { file: "worldbook.json", path: issue.path.map(String) },
    hint: "修正輸出以符合 standalone Lorebook V3 schema。",
    overridable: false,
  }));
  const tokenFindings = options.tokenReport?.over_budget ? [finding({
    rule_id: "workspace.token.constant-budget",
    layer: "workspace",
    severity: "error",
    message: `常駐內容 ${options.tokenReport.constant_tokens} tokens 超過預算 ${options.tokenReport.budget}。`,
    location: { file: ".build/token-report.json" },
  })] : [];
  const supplied = (options.workspaceFindings ?? []).map((item) => ({ ...item, layer: "workspace" as const, overridable: true }));
  const findings = applyPolicy([
    ...normative,
    ...(parsed.success ? loreEntryCompatibilityFindings(parsed.data.data, "worldbook.json", ["data"]) : []),
    ...tokenFindings,
    ...supplied,
  ], options.policy);
  const summary = {
    errors: findings.filter((item) => item.severity === "error").length,
    warnings: findings.filter((item) => item.severity === "warning").length,
    info: findings.filter((item) => item.severity === "info").length,
  };
  return auditReportSchema.parse({
    schema_version: 1,
    ok: summary.errors === 0,
    blocked: (options.strict ?? true) && summary.errors > 0,
    findings,
    summary,
  });
}
