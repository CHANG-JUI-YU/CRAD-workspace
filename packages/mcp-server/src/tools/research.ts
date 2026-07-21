import {
  approveResearchSources,
  fetchApprovedResearchSources,
  getResearchStatus,
  registerResearchSources,
  researchQuerySchema,
} from "@card-workspace/ingestion";

import { mcpFail } from "../errors.js";
import { stringArg, type ToolCallContext } from "./types.js";

function assertResearchIntake(context: ToolCallContext): void {
  if (context.workflow.entry_kind !== "source_adaptation" || context.workflow.stage !== "intake") {
    mcpFail("SOURCE_RESEARCH_CONTEXT_INVALID", "Web source research is limited to Source Adaptation intake");
  }
}

export const researchTools = {
  source_research_submit_candidates: async (context: ToolCallContext) => {
    assertResearchIntake(context);
    const query = researchQuerySchema.parse({
      work_title: context.args.work_title,
      character_names: context.args.character_names,
      aliases: context.args.aliases ?? [],
      language: context.args.language,
      allowed_domains: context.args.allowed_domains ?? [],
      result_count: context.args.result_count ?? 8,
    });
    return registerResearchSources({
      projectRoot: context.projectRoot,
      query,
      results: context.args.candidates as Array<{ title: string; url: string; snippet: string; language: string }>,
      ...(context.trusted.webResearch.now ? { now: context.trusted.webResearch.now } : {}),
    });
  },
  source_research_status: async (context: ToolCallContext) => {
    assertResearchIntake(context);
    return getResearchStatus(context.projectRoot, stringArg(context.args, "batch_id"));
  },
  source_research_approve: async (context: ToolCallContext) => {
    assertResearchIntake(context);
    return approveResearchSources({
      projectRoot: context.projectRoot,
      batchId: stringArg(context.args, "batch_id"),
      expectedRevision: stringArg(context.args, "expected_batch_revision"),
      approvedCandidateIds: context.args.approved_candidate_ids as string[],
      decisionId: stringArg(context.args, "decision_id"),
      actor: context.trusted.agentId,
      decidedAt: stringArg(context.args, "decided_at"),
      singleFamilyFallback: context.args.single_family_fallback as boolean,
      ...(context.args.single_family_fallback_reason ? { singleFamilyFallbackReason: stringArg(context.args, "single_family_fallback_reason") } : {}),
    });
  },
  source_research_fetch_approved: async (context: ToolCallContext) => {
    assertResearchIntake(context);
    return fetchApprovedResearchSources({
      projectRoot: context.projectRoot,
      batchId: stringArg(context.args, "batch_id"),
      actor: context.trusted.agentId,
      transport: context.trusted.webResearch.pageTransport,
      resolveDns: context.trusted.webResearch.resolveDns,
      ...(context.trusted.webResearch.now ? { now: context.trusted.webResearch.now } : {}),
    });
  },
} satisfies Record<string, (context: ToolCallContext) => unknown>;
