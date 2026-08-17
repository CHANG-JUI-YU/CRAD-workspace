import type { ProjectRepository } from "@st-workspace/core";
import {
  artifactQueryFromDashboardQuery,
  auditQueryFromDashboardQuery,
  buildQueryFromDashboardQuery,
  dashboardArtifactDetail,
  dashboardCandidateDetail,
  dashboardOperationDetail,
  dashboardReviewRunDetail,
  dashboardSourceDetail,
  factQueryFromDashboardQuery,
  issueQueryFromDashboardQuery,
  operationQueryFromDashboardQuery,
  publishQueryFromDashboardQuery,
  queryDashboardArtifactHistory,
  queryDashboardArtifacts,
  queryDashboardAudit,
  queryDashboardBuilds,
  queryDashboardCandidates,
  queryDashboardFacts,
  queryDashboardIssues,
  queryDashboardOperations,
  queryDashboardPublishes,
  queryDashboardReviewRuns,
  queryDashboardReviews,
  queryDashboardSources,
  queryDashboardUrlIngestions,
  readDashboardSummary,
  reviewQueryFromDashboardQuery,
  reviewRunQueryFromDashboardQuery,
  sourceQueryFromDashboardQuery,
  type DashboardArtifactDetail,
  type DashboardArtifactListItem,
  type DashboardAuditView,
  type DashboardBuildView,
  type DashboardCandidateView,
  type DashboardFactView,
  type DashboardIssueView,
  type DashboardOperationDetail,
  type DashboardOperationView,
  type DashboardPage,
  type DashboardPublishView,
  type DashboardQuery,
  type DashboardReviewRunDetail,
  type DashboardReviewRunView,
  type DashboardReviewView,
  type DashboardSourceView,
  type DashboardUrlIngestionView,
  type DashboardUrlIngestionQuery,
  type DashboardSummary,
} from "./dashboard-read-model.js";

export interface DashboardQueryDeps {
  repository: ProjectRepository;
}

export async function dashboardSummary(deps: DashboardQueryDeps): Promise<DashboardSummary> {
  return readDashboardSummary(deps.repository);
}

export async function dashboardArtifacts(deps: DashboardQueryDeps, query?: DashboardQuery): Promise<DashboardPage<DashboardArtifactListItem>> {
  const state = await deps.repository.read();
  return queryDashboardArtifacts(state, query === undefined ? {} : artifactQueryFromDashboardQuery(query));
}

export async function dashboardArtifact(deps: DashboardQueryDeps, id: string, revision?: string): Promise<DashboardArtifactDetail | undefined> {
  const state = await deps.repository.read();
  return dashboardArtifactDetail(state, id, revision);
}

export async function dashboardArtifactHistory(deps: DashboardQueryDeps, keyOrId: string, query?: DashboardQuery): Promise<DashboardPage<DashboardArtifactListItem>> {
  const state = await deps.repository.read();
  return queryDashboardArtifactHistory(state, keyOrId, query);
}

export async function dashboardFacts(deps: DashboardQueryDeps, query?: DashboardQuery): Promise<DashboardPage<DashboardFactView>> {
  const state = await deps.repository.read();
  return queryDashboardFacts(state, query === undefined ? {} : factQueryFromDashboardQuery(query));
}

export async function dashboardSources(deps: DashboardQueryDeps, query?: DashboardQuery): Promise<DashboardPage<DashboardSourceView>> {
  const state = await deps.repository.read();
  return queryDashboardSources(state, query === undefined ? {} : sourceQueryFromDashboardQuery(query));
}

export async function dashboardUrlIngestions(deps: DashboardQueryDeps, query?: DashboardQuery): Promise<DashboardPage<DashboardUrlIngestionView>> {
  const state = await deps.repository.read();
  const filter: NonNullable<DashboardUrlIngestionQuery["filter"]> = {};
  const status = query?.filter?.status;
  if (typeof status === "string" && ["url_received", "fetching", "fetch_failed", "content_validated", "ingested"].includes(status)) filter.status = status as NonNullable<typeof filter.status>;
  const taskId = query?.filter?.task_id;
  if (typeof taskId === "string" && taskId.length > 0) filter.task_id = taskId;
  const operationId = query?.filter?.operation_id;
  if (typeof operationId === "string" && operationId.length > 0) filter.operation_id = operationId;
  const search = query?.filter?.search;
  if (typeof search === "string" && search.length > 0) filter.search = search;
  return queryDashboardUrlIngestions(state, { ...(query === undefined ? {} : { query }), filter });
}

export async function dashboardCandidates(deps: DashboardQueryDeps, query?: DashboardQuery): Promise<DashboardPage<DashboardCandidateView>> {
  const state = await deps.repository.read();
  return queryDashboardCandidates(state, query === undefined ? {} : sourceQueryFromDashboardQuery(query));
}

export async function dashboardSource(deps: DashboardQueryDeps, id: string): Promise<DashboardSourceView | undefined> {
  const state = await deps.repository.read();
  return dashboardSourceDetail(state, id);
}

export async function dashboardCandidate(deps: DashboardQueryDeps, id: string): Promise<DashboardCandidateView | undefined> {
  const state = await deps.repository.read();
  return dashboardCandidateDetail(state, id);
}

export async function dashboardOperations(deps: DashboardQueryDeps, query?: DashboardQuery): Promise<DashboardPage<DashboardOperationView>> {
  const state = await deps.repository.read();
  return queryDashboardOperations(state, query === undefined ? {} : operationQueryFromDashboardQuery(query));
}

export async function dashboardOperation(deps: DashboardQueryDeps, id: string): Promise<DashboardOperationDetail | undefined> {
  const state = await deps.repository.read();
  return dashboardOperationDetail(state, id);
}

export async function dashboardAudit(deps: DashboardQueryDeps, query?: DashboardQuery): Promise<DashboardPage<DashboardAuditView>> {
  const state = await deps.repository.read();
  return queryDashboardAudit(state, query === undefined ? {} : auditQueryFromDashboardQuery(query));
}

export async function dashboardIssues(deps: DashboardQueryDeps, query?: DashboardQuery): Promise<DashboardPage<DashboardIssueView>> {
  const state = await deps.repository.read();
  return queryDashboardIssues(state, query === undefined ? {} : issueQueryFromDashboardQuery(query));
}

export async function dashboardReviews(deps: DashboardQueryDeps, query?: DashboardQuery): Promise<DashboardPage<DashboardReviewView>> {
  const state = await deps.repository.read();
  return queryDashboardReviews(state, query === undefined ? {} : reviewQueryFromDashboardQuery(query));
}

export async function dashboardReviewRuns(deps: DashboardQueryDeps, query?: DashboardQuery): Promise<DashboardPage<DashboardReviewRunView>> {
  const state = await deps.repository.read();
  return queryDashboardReviewRuns(state, query === undefined ? {} : reviewRunQueryFromDashboardQuery(query));
}

export async function dashboardReviewRun(deps: DashboardQueryDeps, id: string): Promise<DashboardReviewRunDetail | undefined> {
  const state = await deps.repository.read();
  return dashboardReviewRunDetail(state, id);
}

export async function dashboardPublishes(deps: DashboardQueryDeps, query?: DashboardQuery): Promise<DashboardPage<DashboardPublishView>> {
  const state = await deps.repository.read();
  return queryDashboardPublishes(state, query === undefined ? {} : publishQueryFromDashboardQuery(query));
}

export async function dashboardBuilds(deps: DashboardQueryDeps, query?: DashboardQuery): Promise<DashboardPage<DashboardBuildView>> {
  const state = await deps.repository.read();
  return queryDashboardBuilds(state, query === undefined ? {} : buildQueryFromDashboardQuery(query));
}
