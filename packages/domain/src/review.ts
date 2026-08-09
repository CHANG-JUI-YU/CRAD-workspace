import {
  CoreError,
  createQualityPolicySnapshot,
  internalId,
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
    const summary = `Quality profile set to ${level}.`;
    await this.repository.commit(initial.revision, (current) => ({
      ...current,
      quality_profile: profile,
      operations: current.operations.map((item) => item.id === operationId
        ? updateOperation(item, { status: "completed", result_summary: summary, progress: [...item.progress, { item_id: snapshot.id, status: "completed", message: summary }] })
        : item),
      audit: [...current.audit, {
        id: internalId("audit"),
        operation_id: operationId,
        event: "quality.profile.updated",
        actor,
        occurred_at: capturedAt,
        project_revision: current.revision + 1,
        details: { level, blocking_severity: profile.blocking_severity, overrides: profile.overrides, policy_snapshot: snapshot },
      }],
    }));
    return { status: "completed", summary };
  }

  async review(operationId: string, request: string, actor: string): Promise<ReviewExecutionResult> {
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
    if (target.created_by === actor) {
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
      actor,
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
        actor,
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
        },
      }],
    }));
    return { review_id: review.id, issue_ids: review.issue_ids, status: "completed", summary };
  }

  /** Apply a model-produced review proposal to the same review/issue ledger used by rule-based review. */
  async applyProposal(operationId: string, proposal: { target: { kind: string; name: string; id?: string | undefined }; findings: ReviewFinding[]; summary: string }, actor: string): Promise<ReviewExecutionResult> {
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
      actor,
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
        id: internalId("audit"), operation_id: operationId, event: "review.proposal.applied", actor, occurred_at: now(), project_revision: current.revision + 1,
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
    const changed = openIssues.filter((issue) => (initial.quality_profile.overrides[issue.code] ?? issue.severity) !== issue.effective_severity);
    const state = await this.repository.read();
    const summary = `已重新評估 ${openIssues.length} 個問題，${changed.length} 個有效嚴重度已更新。`;
    await this.repository.commit(state.revision, (current) => ({
      ...current,
      issues: current.issues.map((issue) => issue.status !== "open" ? issue : {
        ...issue,
        effective_severity: current.quality_profile.overrides[issue.code] ?? issue.severity,
        updated_at: now(),
      }),
      operations: current.operations.map((item) => item.id === operationId
        ? updateOperation(item, { status: "completed", progress: [...item.progress, ...changed.map((issue) => ({ item_id: issue.id, status: "completed" as const, message: "issue effective severity 已重新評估" }))], result_summary: summary })
        : item),
      audit: [...current.audit, {
        id: internalId("audit"),
        operation_id: operationId,
        event: "review.reevaluated",
        actor,
        occurred_at: now(),
        project_revision: current.revision + 1,
        details: { issue_ids: openIssues.map((issue) => issue.id), changed_issue_ids: changed.map((issue) => issue.id) },
      }],
    }));
    return { issue_ids: openIssues.map((issue) => issue.id), status: "completed", summary };
  }

  private pickTarget(artifacts: Awaited<ReturnType<ProjectRepository["read"]>>["artifacts"], request: string) {
    const named = request.match(/(?:審查|review|檢查|inspect)\s*[:：]?\s*([^\n，,。；;]+)/iu)?.[1]?.trim();
    if (named !== undefined && named.length > 0) {
      const target = [...artifacts].reverse().find((artifact) => artifact.name.toLocaleLowerCase().includes(named.toLocaleLowerCase()) || artifact.key.toLocaleLowerCase().includes(named.toLocaleLowerCase()));
      if (target !== undefined) return target;
    }
    return [...artifacts].reverse()[0];
  }
}
