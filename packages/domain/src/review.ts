import {
  CoreError,
  createQualityPolicySnapshot,
  internalId,
  type IssueOverride,
  type IssueRecord,
  type IssueSeverity,
  type OperationRecord,
  type ProjectRepository,
  type ReviewFinding,
  type ReviewRecord,
  type QualityLevel,
  qualityProfileForLevel,
} from "@st-workspace/core";

export interface ReviewExecutionResult {
  review_id?: string;
  issue_ids: string[];
  status: "completed" | "needs_input" | "blocked";
  summary: string;
}

export type IssueUpdateAction = "resolve" | "ignore" | "override";

export interface IssueUpdateInput {
  readonly issue_id: string;
  readonly action: IssueUpdateAction;
  readonly reason: string;
  readonly severity?: IssueSeverity;
}

export interface IssueUpdateResult {
  readonly issue_id: string;
  readonly action: IssueUpdateAction;
  readonly status: "completed";
  readonly summary: string;
}

const TECHNICAL_ARTIFACT_KINDS = new Set(["review", "source_research", "fact_curation", "fact_review"]);

function now(): string {
  return new Date().toISOString();
}

function updateOperation(operation: OperationRecord, patch: Partial<OperationRecord>): OperationRecord {
  return { ...operation, ...patch, updated_at: now() };
}

function severityRank(value: IssueSeverity): number {
  return { info: 0, warning: 1, error: 2, critical: 3 }[value];
}

function policySnapshot(profile: Parameters<typeof createQualityPolicySnapshot>[0], actor: string, capturedAt: string) {
  return createQualityPolicySnapshot(profile, actor, capturedAt);
}

function findingCode(finding: ReviewFinding): string {
  return `FINDING_${finding.id.replace(/[^A-Za-z0-9_-]+/gu, "_").toUpperCase()}`;
}

function findingEvidence(finding: ReviewFinding): string[] {
  return finding.evidence.map((evidence) => [evidence.source, evidence.excerpt, evidence.path?.join(".")].filter((value): value is string => value !== undefined && value.length > 0).join(" — "));
}

function policyBaselineForProfile(profile: Parameters<typeof createQualityPolicySnapshot>[0], issue: IssueRecord): IssueSeverity {
  return profile.overrides[issue.code] ?? profile.overrides[issue.id] ?? issue.severity;
}

function issueOverrideInvalidated(profile: Parameters<typeof createQualityPolicySnapshot>[0], issue: IssueRecord): boolean {
  return issue.override !== undefined && severityRank(policyBaselineForProfile(profile, issue)) > severityRank(issue.override.against_effective_severity);
}

function effectiveSeverityForProfile(profile: Parameters<typeof createQualityPolicySnapshot>[0], issue: IssueRecord): IssueSeverity {
  const baseline = policyBaselineForProfile(profile, issue);
  if (issue.override === undefined || issueOverrideInvalidated(profile, issue)) return baseline;
  const target = issue.override.severity ?? issue.effective_severity;
  return severityRank(target) < severityRank(baseline) ? target : baseline;
}

function targetKindMatches(artifactKind: string, requestedKind: string): boolean {
  const aliases: Record<string, string> = { greetings: "greeting", world: "world_lore", character_card: "character" };
  return artifactKind === requestedKind || artifactKind === aliases[requestedKind] || aliases[artifactKind] === requestedKind;
}

export class ReviewService {
  constructor(private readonly repository: ProjectRepository) {}

  /** Update quality policy through a single high-level operation. */
  async configureQualityProfile(operationId: string, level: QualityLevel, actor: string, overrides: Record<string, IssueSeverity> = {}): Promise<{ status: "completed"; summary: string }> {
    const initial = await this.repository.read();
    const operation = initial.operations.find((item) => item.id === operationId);
    if (operation === undefined) throw new CoreError("OPERATION_NOT_FOUND", `Operation ${operationId} does not exist`);
    const capturedAt = now();
    const base = qualityProfileForLevel(level, overrides);
    const snapshot = policySnapshot(base, actor, capturedAt);
    const profile = { ...base, policy_snapshot: snapshot };
    const invalidatedIssueOverrides = initial.issues
      .filter((issue) => issue.status === "open" && issueOverrideInvalidated(profile, issue) && issue.override !== undefined)
      .map((issue) => ({ issue, policy_baseline: policyBaselineForProfile(profile, issue) }));
    const invalidatedIssueIds = new Set(invalidatedIssueOverrides.map((item) => item.issue.id));
    const preservedIssueOverrideIds = initial.issues.filter((issue) => issue.status === "open" && issue.override !== undefined && !invalidatedIssueIds.has(issue.id)).map((issue) => issue.id);
    const summary = `Quality profile set to ${level}.`;
    await this.repository.commit(initial.revision, (current) => ({
      ...current,
      quality_profile: profile,
      issues: current.issues.map((issue) => {
        const invalidated = invalidatedIssueOverrides.find((item) => item.issue.id === issue.id);
        if (invalidated === undefined) {
          return issue.override === undefined ? issue : { ...issue, effective_severity: effectiveSeverityForProfile(profile, issue), updated_at: capturedAt };
        }
        const { override: _discarded, ...withoutOverride } = issue;
        return { ...withoutOverride, effective_severity: invalidated.policy_baseline, updated_at: capturedAt };
      }),
      operations: current.operations.map((item) => item.id === operationId
        ? updateOperation(item, { status: "completed", result_summary: summary, progress: [...item.progress, { item_id: snapshot.id, status: "completed", message: summary }] })
        : item),
      audit: [
        ...current.audit,
        ...invalidatedIssueOverrides.map(({ issue, policy_baseline }) => ({
          id: internalId("audit"),
          operation_id: operationId,
          event: "review.issue.override.invalidated",
          actor,
          occurred_at: capturedAt,
          project_revision: current.revision + 1,
          details: {
            issue_id: issue.id,
            reason: "Quality policy baseline became stricter than the saved issue override baseline.",
            against_effective_severity: issue.override!.against_effective_severity,
            policy_effective_severity: policy_baseline,
            policy_snapshot: snapshot,
          },
        })),
        {
          id: internalId("audit"),
          operation_id: operationId,
          event: "quality.profile.updated",
          actor,
          occurred_at: capturedAt,
          project_revision: current.revision + 1,
          details: {
            level,
            blocking_severity: profile.blocking_severity,
            overrides: profile.overrides,
            policy_snapshot: snapshot,
            preserved_issue_override_ids: preservedIssueOverrideIds,
            invalidated_issue_override_ids: invalidatedIssueOverrides.map((item) => item.issue.id),
          },
        },
      ],
    }));
    return { status: "completed", summary };
  }

  /** Resolve, ignore, or explicitly override one recorded issue. */
  async updateIssue(operationId: string, input: IssueUpdateInput, operator: string, auditActor = operator): Promise<IssueUpdateResult> {
    const reason = input.reason.trim();
    if (reason.length === 0) throw new CoreError("ISSUE_ACTION_REASON_REQUIRED", "Issue actions require a non-empty reason.", true);
    if (input.action === "override" && input.severity === undefined) {
      throw new CoreError("ISSUE_OVERRIDE_SEVERITY_REQUIRED", "An override action requires a target severity.", true);
    }
    const initial = await this.repository.read();
    const operation = initial.operations.find((item) => item.id === operationId);
    if (operation === undefined) throw new CoreError("OPERATION_NOT_FOUND", `Operation ${operationId} does not exist`);
    const issue = initial.issues.find((item) => item.id === input.issue_id);
    if (issue === undefined) throw new CoreError("ISSUE_NOT_FOUND", `Issue ${input.issue_id} does not exist`, true);
    if ((input.action === "ignore" || input.action === "override") && issue.overridable !== true) {
      throw new CoreError("ISSUE_NOT_OVERRIDABLE", `Issue ${input.issue_id} is not marked overridable and cannot be ${input.action === "ignore" ? "ignored" : "overridden"}.`, true);
    }
    if (issue.status !== "open") {
      throw new CoreError("ISSUE_NOT_OPEN", `Issue ${input.issue_id} is already ${issue.status}.`, true);
    }
    const againstEffectiveSeverity = policyBaselineForProfile(initial.quality_profile, issue);
    const effectiveSeverity = input.action === "override" && input.severity !== undefined
      ? input.severity
      : effectiveSeverityForProfile(initial.quality_profile, issue);
    const currentPolicyEffectiveSeverity = effectiveSeverityForProfile(initial.quality_profile, issue);
    if (input.action === "override" && input.severity !== undefined && severityRank(input.severity) >= severityRank(currentPolicyEffectiveSeverity)) {
      throw new CoreError("ISSUE_OVERRIDE_SEVERITY_ESCALATION", "An issue override can only downgrade the current issue severity.", true);
    }
    const nextStatus = input.action === "resolve" ? "resolved" : input.action === "ignore" ? "ignored" : issue.status;
    const summary = input.action === "override"
      ? `Issue ${issue.id} effective severity overridden to ${input.severity}.`
      : `Issue ${issue.id} marked ${nextStatus}.`;
    const occurredAt = now();
    await this.repository.commit(initial.revision, (current) => {
      const issueOverride: IssueOverride | undefined = input.action === "override" && input.severity !== undefined
        ? {
          by: operator,
          reason,
          timestamp: occurredAt,
          against_effective_severity: againstEffectiveSeverity,
          severity: input.severity,
          policy_snapshot: createQualityPolicySnapshot(current.quality_profile, auditActor, occurredAt),
        }
        : issue.override;
      return {
        ...current,
        issues: current.issues.map((candidate) => candidate.id !== issue.id ? candidate : {
          ...candidate,
          status: nextStatus,
          effective_severity: effectiveSeverity,
          ...(issueOverride === undefined ? {} : { override: issueOverride }),
          updated_at: occurredAt,
        }),
        operations: current.operations.map((item) => item.id === operationId
          ? updateOperation(item, { status: "completed", progress: [...item.progress, { item_id: issue.id, status: "completed", message: summary }], result_summary: summary })
          : item),
        audit: [...current.audit, {
          id: internalId("audit"),
          operation_id: operationId,
          event: "review.issue.updated",
          actor: auditActor,
          occurred_at: occurredAt,
          project_revision: current.revision + 1,
          details: {
            issue_id: issue.id,
            action: input.action,
            reason,
            operator,
            agent_id: operator,
            overridable: issue.overridable === true,
            original_severity: issue.severity,
            against_effective_severity: againstEffectiveSeverity,
            effective_severity: effectiveSeverity,
            ...(issueOverride === undefined ? {} : { override_scope: "issue", override: issueOverride }),
          },
        }],
      };
    });
    return { issue_id: issue.id, action: input.action, status: "completed", summary };
  }

  async review(operationId: string, request: string, actor: string, auditActor = actor): Promise<ReviewExecutionResult> {
    const initial = await this.repository.read();
    const operation = initial.operations.find((item) => item.id === operationId);
    if (operation === undefined) throw new CoreError("OPERATION_NOT_FOUND", `Operation ${operationId} does not exist`);
    const target = this.pickTarget(initial.artifacts, request);
    if (target === undefined) {
      await this.repository.commit(initial.revision, (current) => ({
        ...current,
        operations: current.operations.map((item) => item.id === operationId
          ? updateOperation(item, { status: "needs_input", question: "目前沒有可審查的 artifact，請先建立角色或其他產物。" })
          : item),
      }));
      return { issue_ids: [], status: "needs_input", summary: "目前沒有可審查的 artifact。" };
    }
    const creatorAgent = target.created_by ?? initial.operations.find((item) => item.id === target.operation_id)?.execution_snapshot?.execution_agent_id;
    if (creatorAgent !== undefined && creatorAgent === actor) {
      await this.repository.commit(initial.revision, (current) => ({
        ...current,
        operations: current.operations.map((item) => item.id === operationId
          ? updateOperation(item, { status: "blocked", question: "建立者不能審查自己的 artifact，請交由不同 reviewer 執行。" })
          : item),
      }));
      return { issue_ids: [], status: "blocked", summary: "已阻擋作者自審。" };
    }
    const issueDrafts: Array<{ code: string; message: string; severity: IssueSeverity }> = [];
    if (target.content.length < 20) issueDrafts.push({ code: "CONTENT_TOO_SHORT", message: "內容過短，可能不足以支撐使用情境。", severity: "warning" });
    if (/TODO|待補|TBD/iu.test(target.content)) issueDrafts.push({ code: "PLACEHOLDER_REMAINS", message: "內容仍含有未完成 placeholder。", severity: "error" });
    if (target.kind === "character" && !/(性格|個性|personality|traits)/iu.test(target.content)) issueDrafts.push({ code: "CHARACTER_PERSONALITY_MISSING", message: "角色內容缺少可辨識的性格描述。", severity: "warning" });
    const reviewId = internalId("review");
    const capturedAt = now();
    const qualityPolicy = policySnapshot(initial.quality_profile, actor, capturedAt);
    const issues: IssueRecord[] = issueDrafts.map((draft) => ({
      id: internalId("issue"),
      artifact_id: target.id,
      review_id: reviewId,
      code: draft.code,
      message: draft.message,
      severity: draft.severity,
      effective_severity: initial.quality_profile.overrides[draft.code] ?? draft.severity,
      against_effective_severity: draft.severity,
      status: "open",
      created_at: now(),
      updated_at: now(),
    }));
    const highest = issues.reduce<IssueSeverity>((current, issue) => severityRank(issue.effective_severity) > severityRank(current) ? issue.effective_severity : current, "info");
    const reviewStatus: ReviewRecord["status"] = highest === "error" || highest === "critical" ? "failed" : issues.length > 0 ? "partial" : "passed";
    const review: ReviewRecord = {
      id: reviewId,
      artifact_id: target.id,
      artifact_revision: target.revision,
      reviewer: actor,
      status: reviewStatus,
      issue_ids: issues.map((issue) => issue.id),
      created_at: capturedAt,
      quality_policy_snapshot: qualityPolicy,
    };
    const overrideAudits = issues.filter((issue) => issue.effective_severity !== issue.against_effective_severity).map((issue) => ({
      code: issue.code,
      configured_severity: issue.effective_severity,
      against_effective_severity: issue.against_effective_severity ?? issue.severity,
      actor: auditActor,
      occurred_at: capturedAt,
    }));
    const summary = reviewStatus === "passed" ? "審查通過，沒有發現問題。" : `審查完成：${issues.length} 個問題，最高嚴重度為 ${highest}。`;
    const state = await this.repository.read();
    await this.repository.commit(state.revision, (current) => ({
      ...current,
      reviews: [...current.reviews, review],
      issues: [...current.issues, ...issues],
      quality_profile: overrideAudits.length === 0 ? current.quality_profile : {
        ...current.quality_profile,
        override_audit: [...(current.quality_profile.override_audit ?? []), ...overrideAudits],
      },
      artifacts: current.artifacts.map((artifact) => artifact.id === target.id ? { ...artifact, status: reviewStatus === "passed" ? "reviewed" as const : artifact.status, updated_at: now() } : artifact),
      operations: current.operations.map((item) => item.id === operationId
        ? updateOperation(item, { status: "completed", progress: [...item.progress, { item_id: review.id, status: "completed", message: "artifact review 已完成" }], result_summary: summary })
        : item),
      audit: [...current.audit, {
        id: internalId("audit"),
        operation_id: operationId,
        event: "artifact.reviewed",
        actor: auditActor,
        occurred_at: now(),
        project_revision: current.revision + 1,
        details: {
          artifact_id: target.id,
          artifact_revision: target.revision,
          review_id: review.id,
          issue_ids: review.issue_ids,
          status: review.status,
          quality_policy_snapshot: qualityPolicy,
          overrides: issues.filter((issue) => issue.effective_severity !== issue.against_effective_severity).map((issue) => ({
            issue_id: issue.id,
            code: issue.code,
            configured_severity: issue.effective_severity,
            against_effective_severity: issue.against_effective_severity,
          })),
          agent_id: actor,
        },
      }],
    }));
    return { review_id: review.id, issue_ids: review.issue_ids, status: "completed", summary };
  }

  /** Apply a model-produced review proposal to the same review/issue ledger used by rule-based review. */
  async applyProposal(operationId: string, proposal: { target: { kind: string; name: string; id?: string | undefined }; findings: ReviewFinding[]; summary: string }, actor: string, auditActor = actor): Promise<ReviewExecutionResult> {
    const initial = await this.repository.read();
    const operation = initial.operations.find((item) => item.id === operationId);
    if (operation === undefined) throw new CoreError("OPERATION_NOT_FOUND", `Operation ${operationId} does not exist`);
    const target = proposal.target.id !== undefined
      ? initial.artifacts.find((artifact) => artifact.id === proposal.target.id)
      : [...initial.artifacts].reverse().find((artifact) => targetKindMatches(artifact.kind, proposal.target.kind)
        && (artifact.name.toLocaleLowerCase() === proposal.target.name.toLocaleLowerCase() || artifact.key.toLocaleLowerCase().includes(proposal.target.name.toLocaleLowerCase())));
    if (target === undefined) throw new CoreError("REVIEW_TARGET_INVALID", `Review target ${proposal.target.id ?? `${proposal.target.kind}/${proposal.target.name}`} does not exist`, true);
    if (target.created_by === actor) throw new CoreError("REVIEW_SELF_BLOCKED", "An author cannot review their own artifact", true);
    const ids = new Set<string>();
    for (const finding of proposal.findings) {
      if (ids.has(finding.id)) throw new CoreError("REVIEW_FINDING_DUPLICATE", `Finding ${finding.id} appears more than once`, true);
      ids.add(finding.id);
    }
    const reviewId = internalId("review");
    const capturedAt = now();
    const qualityPolicy = policySnapshot(initial.quality_profile, actor, capturedAt);
    const issues: IssueRecord[] = proposal.findings.map((finding) => {
      const code = findingCode(finding);
      const severity = finding.severity as IssueSeverity;
      return {
        id: internalId("issue"),
        artifact_id: target.id,
        review_id: reviewId,
        code,
        message: finding.hint === undefined ? finding.summary : `${finding.summary} (${finding.hint})`,
        severity,
        effective_severity: initial.quality_profile.overrides[code] ?? initial.quality_profile.overrides[finding.id] ?? severity,
        against_effective_severity: severity,
        evidence: findingEvidence(finding),
        overridable: finding.overridable,
        status: "open",
        created_at: now(),
        updated_at: now(),
      };
    });
    const highest = issues.reduce<IssueSeverity>((current, issue) => severityRank(issue.effective_severity) > severityRank(current) ? issue.effective_severity : current, "info");
    const reviewStatus: ReviewRecord["status"] = highest === "error" || highest === "critical" ? "failed" : issues.length > 0 ? "partial" : "passed";
    const review: ReviewRecord = {
      id: reviewId,
      artifact_id: target.id,
      artifact_revision: target.revision,
      reviewer: actor,
      status: reviewStatus,
      issue_ids: issues.map((issue) => issue.id),
      created_at: capturedAt,
      quality_policy_snapshot: qualityPolicy,
    };
    const overrideAudits = issues.filter((issue) => issue.effective_severity !== issue.against_effective_severity).map((issue) => ({
      code: issue.code,
      configured_severity: issue.effective_severity,
      against_effective_severity: issue.against_effective_severity ?? issue.severity,
      actor: auditActor,
      occurred_at: capturedAt,
    }));
    const summary = proposal.summary;
    await this.repository.commit(initial.revision, (current) => ({
      ...current,
      reviews: [...current.reviews, review],
      issues: [...current.issues, ...issues],
      quality_profile: overrideAudits.length === 0 ? current.quality_profile : {
        ...current.quality_profile,
        override_audit: [...(current.quality_profile.override_audit ?? []), ...overrideAudits],
      },
      artifacts: current.artifacts.map((artifact) => artifact.id === target.id && reviewStatus === "passed" ? { ...artifact, status: "reviewed" as const, updated_at: now() } : artifact),
      operations: current.operations.map((item) => item.id === operationId
        ? updateOperation(item, { status: "completed", progress: [...item.progress, { item_id: review.id, status: "completed", message: "Review proposal applied." }, ...issues.map((issue) => ({ item_id: issue.id, status: "completed" as const, message: "Review finding recorded.", artifact_id: target.id }))], result_summary: summary })
        : item),
      audit: [...current.audit, {
        id: internalId("audit"), operation_id: operationId, event: "review.proposal.applied", actor: auditActor, occurred_at: now(), project_revision: current.revision + 1,
        details: {
          artifact_id: target.id,
          artifact_revision: target.revision,
          review_id: review.id,
          issue_ids: review.issue_ids,
          finding_count: proposal.findings.length,
          status: review.status,
          quality_policy_snapshot: qualityPolicy,
          overrides: issues.filter((issue) => issue.effective_severity !== issue.against_effective_severity).map((issue) => ({
            issue_id: issue.id,
            code: issue.code,
            configured_severity: issue.effective_severity,
            against_effective_severity: issue.against_effective_severity,
          })),
          agent_id: actor,
        },
      }],
    }));
    return { review_id: review.id, issue_ids: review.issue_ids, status: "completed", summary };
  }

  async reevaluate(operationId: string, actor: string): Promise<ReviewExecutionResult> {
    const initial = await this.repository.read();
    const operation = initial.operations.find((item) => item.id === operationId);
    if (operation === undefined) throw new CoreError("OPERATION_NOT_FOUND", `Operation ${operationId} does not exist`);
    const openIssues = initial.issues.filter((issue) => issue.status === "open");
    if (openIssues.length === 0) {
      const summary = "目前沒有待重新評估的 open issue。";
      await this.repository.commit(initial.revision, (current) => ({
        ...current,
        operations: current.operations.map((item) => item.id === operationId ? updateOperation(item, { status: "completed", result_summary: summary }) : item),
      }));
      return { issue_ids: [], status: "completed", summary };
    }
    const invalidatedIssueOverrides = openIssues
      .filter((issue) => issueOverrideInvalidated(initial.quality_profile, issue) && issue.override !== undefined)
      .map((issue) => ({ issue, policy_baseline: policyBaselineForProfile(initial.quality_profile, issue) }));
    const invalidatedIssueIds = new Set(invalidatedIssueOverrides.map((item) => item.issue.id));
    const changed = openIssues.filter((issue) => effectiveSeverityForProfile(initial.quality_profile, issue) !== issue.effective_severity);
    const state = await this.repository.read();
    const summary = `已重新評估 ${openIssues.length} 個問題，${changed.length} 個有效嚴重度已更新。`;
    await this.repository.commit(state.revision, (current) => ({
      ...current,
      issues: current.issues.map((issue) => {
        if (issue.status !== "open") return issue;
        const invalidated = invalidatedIssueOverrides.find((item) => item.issue.id === issue.id);
        if (invalidated !== undefined) {
          const { override: _discarded, ...withoutOverride } = issue;
          return { ...withoutOverride, effective_severity: invalidated.policy_baseline, updated_at: now() };
        }
        return { ...issue, effective_severity: effectiveSeverityForProfile(current.quality_profile, issue), updated_at: now() };
      }),
      operations: current.operations.map((item) => item.id === operationId
        ? updateOperation(item, { status: "completed", progress: [...item.progress, ...changed.map((issue) => ({ item_id: issue.id, status: "completed" as const, message: "issue effective severity 已重新評估" }))], result_summary: summary })
        : item),
      audit: [
        ...current.audit,
        ...invalidatedIssueOverrides.map(({ issue, policy_baseline }) => ({
          id: internalId("audit"),
          operation_id: operationId,
          event: "review.issue.override.invalidated",
          actor,
          occurred_at: now(),
          project_revision: current.revision + 1,
          details: {
            issue_id: issue.id,
            reason: "Quality policy baseline became stricter than the saved issue override baseline.",
            against_effective_severity: issue.override!.against_effective_severity,
            policy_effective_severity: policy_baseline,
          },
        })),
        {
          id: internalId("audit"),
          operation_id: operationId,
          event: "review.reevaluated",
          actor,
          occurred_at: now(),
          project_revision: current.revision + 1,
          details: {
            issue_ids: openIssues.map((issue) => issue.id),
            changed_issue_ids: changed.map((issue) => issue.id),
            preserved_issue_override_ids: openIssues.filter((issue) => issue.override !== undefined && !invalidatedIssueIds.has(issue.id)).map((issue) => issue.id),
            invalidated_issue_override_ids: invalidatedIssueOverrides.map((item) => item.issue.id),
          },
        },
      ],
    }));
    return { issue_ids: openIssues.map((issue) => issue.id), status: "completed", summary };
  }

  private pickTarget(artifacts: Awaited<ReturnType<ProjectRepository["read"]>>["artifacts"], request: string) {
    const named = request.match(/(?:審查|review|檢查|inspect)\s*[:：]?\s*([^\n，,。；;]+)/iu)?.[1]?.trim();
    if (named !== undefined && named.length > 0) {
      const target = [...artifacts].reverse().find((artifact) => !TECHNICAL_ARTIFACT_KINDS.has(artifact.kind)
        && (artifact.name.toLocaleLowerCase().includes(named.toLocaleLowerCase()) || artifact.key.toLocaleLowerCase().includes(named.toLocaleLowerCase())));
      if (target !== undefined) return target;
    }
    return [...artifacts].reverse().find((artifact) => !TECHNICAL_ARTIFACT_KINDS.has(artifact.kind)) ?? [...artifacts].reverse()[0];
  }
}
