import { readFile } from "node:fs/promises";
import path from "node:path";

import type { LoadedAuthorProject } from "@card-workspace/project";
import {
  canonicalJson,
  computeRevision,
  computeTextRevision,
  loadAuthorProject,
  resolveExistingWithin,
} from "@card-workspace/project";
import {
  provenanceIndexSchema,
  provenanceTraceSchema,
  type Diagnostic,
  type FactEvidence,
  type ProvenanceEdge,
  type ProvenanceIndex,
  type ProvenanceNode,
  type ProvenanceRef,
  type ProvenanceTrace,
  type Revision,
} from "@card-workspace/schemas";

import { verifyChunkSet } from "./chunk-store.js";
import { validateEvidenceArtifacts } from "./evidence.js";
import { getSourceRevision, getTextProjection } from "./source-manifest.js";

export const provenanceRuleIds = {
  invalidFactRef: "workspace.provenance.invalid-fact-ref",
  nonAcceptedFact: "workspace.provenance.non-accepted-fact",
  brokenEvidence: "workspace.provenance.broken-evidence",
  unresolvedConflict: "workspace.provenance.unresolved-conflict",
  staleSourceRevision: "workspace.provenance.stale-source-revision",
} as const;

interface AuthorFragmentRef {
  id: string;
  file: string;
  provenance: ProvenanceRef[];
}

export interface ProvenanceBuildResult {
  index: ProvenanceIndex;
  diagnostics: Diagnostic[];
  sourceRevisions: Record<string, Revision>;
}

export interface ProvenanceVerification extends ProvenanceBuildResult {
  ok: boolean;
}

function fragments(project: LoadedAuthorProject): AuthorFragmentRef[] {
  const result: AuthorFragmentRef[] = [];
  for (const character of project.characters) {
    const root = `characters/${character.manifest.id}`;
    const identity = `character.${character.manifest.id}.identity`;
    result.push({ id: `${identity}.main`, file: `${root}/character.yaml`, provenance: character.document.provenance });
    character.document.sections.forEach((section) => result.push({
      id: `${identity}.section.${section.id}`,
      file: `${root}/character.yaml`,
      provenance: section.provenance,
    }));
    for (const module of character.modules) {
      const node = `character.${character.manifest.id}.${module.module}`;
      const file = `${root}/${character.manifest.mode}`;
      result.push({ id: `${node}.main`, file, provenance: module.provenance });
      if ("sections" in module) {
        module.sections.forEach((section) => result.push({
          id: `${node}.section.${section.id}`,
          file,
          provenance: section.provenance,
        }));
      }
    }
  }
  for (const entry of project.world) {
    const node = `world.${entry.id}`;
    result.push({ id: `${node}.main`, file: "world", provenance: entry.provenance });
    entry.sections.forEach((section) => result.push({
      id: `${node}.section.${section.id}`,
      file: "world",
      provenance: section.provenance,
    }));
  }
  project.greetings?.greetings.forEach((greeting) => result.push({
    id: `greeting.${greeting.id}`,
    file: "greetings.yaml",
    provenance: greeting.provenance,
  }));
  if (project.relationships) {
    result.push({
      id: "project.relationships.main",
      file: "relationships.yaml",
      provenance: project.relationships.provenance,
    });
  }
  return result.sort((left, right) => left.id.localeCompare(right.id));
}

function evidenceDetails(fragmentId: string, factId: string, evidence?: FactEvidence, snapshotPath?: string) {
  return {
    fragment_id: fragmentId,
    fact_id: factId,
    ...(evidence ? {
      evidence_id: evidence.id,
      chunk_id: evidence.chunk_id,
      source_id: evidence.source_id,
      source_revision_id: evidence.source_revision_id,
    } : {}),
    ...(snapshotPath ? { snapshot_path: snapshotPath } : {}),
  };
}

function diagnostic(
  code: string,
  message: string,
  fragment: AuthorFragmentRef,
  factId: string,
  evidence?: FactEvidence,
  snapshotPath?: string,
  severity: Diagnostic["severity"] = "error",
): Diagnostic {
  return {
    code,
    severity,
    message,
    location: { file: fragment.file, path: ["provenance"] },
    details: evidenceDetails(fragment.id, factId, evidence, snapshotPath),
    evidence: evidence ? [{
      source: evidence.source_id,
      excerpt: evidence.quote,
      revision: evidence.source_revision_id,
    }] : [],
    fixability: "manual",
  };
}

function addNode(nodes: Map<string, ProvenanceNode>, node: ProvenanceNode): void {
  const key = `${node.kind}\u0000${node.id}`;
  if (!nodes.has(key)) nodes.set(key, node);
}

function edgeKey(edge: ProvenanceEdge): string {
  return `${edge.from}\u0000${edge.to}`;
}

function revisionDigest(revision: Revision): string {
  return revision.slice("sha256:".length);
}

async function recordRevision(
  projectRoot: string,
  relativePath: string,
  sourceRevisions: Record<string, Revision>,
): Promise<void> {
  const content = await readFile(await resolveExistingWithin(projectRoot, relativePath));
  sourceRevisions[relativePath] = computeTextRevision(content);
}

export async function buildProvenanceIndex(project: LoadedAuthorProject): Promise<ProvenanceBuildResult> {
  if (!project.manifest || !project.factRegister || !project.sourceManifest || !project.conflictRegister) {
    throw new TypeError("provenance index 需要已載入的 manifest、sources、facts 與 conflicts");
  }
  const nodes = new Map<string, ProvenanceNode>();
  const edges = new Map<string, ProvenanceEdge>();
  const diagnostics: Diagnostic[] = [];
  const sourceRevisions: Record<string, Revision> = {};
  const facts = new Map(project.factRegister.facts.map((fact) => [fact.id, fact]));
  const sources = new Map(project.sourceManifest.sources.map((source) => [source.id, source]));
  const artifactCache = new Map<string, Awaited<ReturnType<typeof verifyChunkSet>>>();

  for (const fragment of fragments(project)) {
    const factRefs = fragment.provenance.filter((ref) => ref.kind === "fact");
    if (factRefs.length === 0) continue;
    addNode(nodes, { id: fragment.id, kind: "fragment", extensions: { file: fragment.file } });
    for (const ref of factRefs) {
      const fact = facts.get(ref.ref);
      addNode(nodes, { id: ref.ref, kind: "fact", extensions: fact ? { status: fact.status } : { missing: true } });
      const fragmentEdge = { from: fragment.id, to: ref.ref };
      edges.set(edgeKey(fragmentEdge), fragmentEdge);
      if (!fact) {
        diagnostics.push(diagnostic(provenanceRuleIds.invalidFactRef, `找不到 fact：${ref.ref}`, fragment, ref.ref));
        continue;
      }
      if (fact.status !== "accepted") {
        diagnostics.push(diagnostic(
          provenanceRuleIds.nonAcceptedFact,
          `fact ${fact.id} 狀態為 ${fact.status}，正式 provenance 只接受 accepted fact`,
          fragment,
          fact.id,
        ));
        continue;
      }
      const openConflicts = project.conflictRegister.conflicts.filter((conflict) =>
        conflict.status === "open" && conflict.members.some((member) => member.fact_id === fact.id));
      if (ref.requires_single_value && openConflicts.length > 0) {
        diagnostics.push(diagnostic(
          provenanceRuleIds.unresolvedConflict,
          `fact ${fact.id} 需要單一值，但仍有 unresolved conflict：${openConflicts.map((item) => item.id).join(", ")}`,
          fragment,
          fact.id,
        ));
      }
      for (const item of fact.evidence) {
        addNode(nodes, { id: item.id, kind: "evidence", extensions: {} });
        addNode(nodes, { id: item.chunk_id, kind: "chunk", revision: item.chunk_hash, extensions: { chunk_set_id: item.chunk_set_id } });
        const revisionNodeId = `${item.source_id}@${item.source_revision_id}`;
        addNode(nodes, {
          id: revisionNodeId,
          kind: "source_revision",
          revision: item.source_revision_id,
          extensions: { source_id: item.source_id },
        });
        for (const edge of [
          { from: fact.id, to: item.id },
          { from: item.id, to: item.chunk_id },
          { from: item.chunk_id, to: revisionNodeId },
        ]) edges.set(edgeKey(edge), edge);

        let snapshotPath: string | undefined;
        try {
          const revision = await getSourceRevision(project.projectRoot, item.source_id, item.source_revision_id);
          snapshotPath = revision.snapshot.path;
          addNode(nodes, { id: snapshotPath, kind: "snapshot", revision: revision.raw_hash, extensions: {} });
          const snapshotEdge = { from: revisionNodeId, to: snapshotPath };
          edges.set(edgeKey(snapshotEdge), snapshotEdge);
          const cacheKey = `${item.source_id}\u0000${item.source_revision_id}\u0000${item.chunk_set_id}`;
          let artifacts = artifactCache.get(cacheKey);
          if (!artifacts) {
            artifacts = await verifyChunkSet(project.projectRoot, item.source_id, item.source_revision_id, item.chunk_set_id);
            artifactCache.set(cacheKey, artifacts);
          }
          const chunk = artifacts.chunks.find((candidate) => candidate.id === item.chunk_id);
          if (!chunk) throw new Error(`chunk 不存在：${item.chunk_id}`);
          const projection = await getTextProjection(project.projectRoot, item.source_id, item.source_revision_id);
          validateEvidenceArtifacts(item, { projection, chunk });

          const digest = revisionDigest(item.source_revision_id);
          await Promise.all([
            recordRevision(project.projectRoot, `sources/revisions/${item.source_id}/${digest}.json`, sourceRevisions),
            recordRevision(project.projectRoot, `sources/projections/${item.source_id}/${digest}.json`, sourceRevisions),
            recordRevision(project.projectRoot, `sources/chunks/${item.source_id}/${digest}/${item.chunk_set_id}/manifest.json`, sourceRevisions),
            recordRevision(project.projectRoot, `sources/chunks/${item.source_id}/${digest}/${item.chunk_set_id}/${item.chunk_id}.json`, sourceRevisions),
            recordRevision(project.projectRoot, snapshotPath, sourceRevisions),
          ]);
          const source = sources.get(item.source_id);
          if (source?.current_revision_id !== item.source_revision_id) {
            diagnostics.push(diagnostic(
              provenanceRuleIds.staleSourceRevision,
              `fact ${fact.id} 引用的 source revision 不是目前版本`,
              fragment,
              fact.id,
              item,
              snapshotPath,
              "warning",
            ));
          }
        } catch (error) {
          diagnostics.push(diagnostic(
            provenanceRuleIds.brokenEvidence,
            `fact ${fact.id} 的 evidence chain 無效：${error instanceof Error ? error.message : String(error)}`,
            fragment,
            fact.id,
            item,
            snapshotPath,
          ));
        }
      }
    }
  }

  const sortedNodes = [...nodes.values()].sort((left, right) =>
    left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id));
  const sortedEdges = [...edges.values()].sort((left, right) =>
    left.from.localeCompare(right.from) || left.to.localeCompare(right.to));
  const state = {
    schema_version: 1 as const,
    project_id: project.manifest.id,
    nodes: sortedNodes,
    edges: sortedEdges,
    extensions: {},
  };
  const index = provenanceIndexSchema.parse({ ...state, revision: computeRevision(state) });
  diagnostics.sort((left, right) => canonicalJson([
    left.code,
    left.location,
    left.details,
  ]).localeCompare(canonicalJson([right.code, right.location, right.details])));
  return { index, diagnostics, sourceRevisions };
}

async function loadFromProjectRoot(projectRoot: string): Promise<LoadedAuthorProject> {
  return loadAuthorProject(path.dirname(projectRoot), path.basename(projectRoot));
}

export async function verifyProvenance(projectRoot: string): Promise<ProvenanceVerification> {
  const loaded = await loadFromProjectRoot(projectRoot);
  if (!loaded.ok) {
    return {
      ok: false,
      index: provenanceIndexSchema.parse({
        schema_version: 1,
        project_id: path.basename(projectRoot),
        revision: computeRevision({ invalid: true, project_id: path.basename(projectRoot) }),
        nodes: [],
        edges: [],
        extensions: {},
      }),
      diagnostics: loaded.diagnostics,
      sourceRevisions: loaded.sourceRevisions,
    };
  }
  const result = await buildProvenanceIndex(loaded);
  return { ...result, ok: !result.diagnostics.some((item) => item.severity === "error") };
}

export async function traceProvenance(projectRoot: string, id: string): Promise<ProvenanceTrace> {
  const result = await verifyProvenance(projectRoot);
  const nodeIds = new Set(result.index.nodes.filter((node) =>
    node.id === id || node.extensions.source_id === id).map((node) => node.id));
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of result.index.edges) {
      if (nodeIds.has(edge.from) && !nodeIds.has(edge.to)) {
        nodeIds.add(edge.to);
        changed = true;
      }
      if (nodeIds.has(edge.to) && !nodeIds.has(edge.from)) {
        nodeIds.add(edge.from);
        changed = true;
      }
    }
  }
  const nodes = result.index.nodes.filter((node) => nodeIds.has(node.id));
  const edges = result.index.edges.filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to));
  const relatedIds = new Set([
    ...nodeIds,
    ...nodes.flatMap((node) => typeof node.extensions.source_id === "string" ? [node.extensions.source_id] : []),
  ]);
  const relatedDiagnostics = result.diagnostics.filter((item) => {
    if (!item.details || typeof item.details !== "object" || Array.isArray(item.details)) return true;
    return Object.values(item.details).some((value) => typeof value === "string" && relatedIds.has(value));
  });
  return provenanceTraceSchema.parse({
    schema_version: 1,
    query_id: id,
    nodes,
    edges,
    complete: nodeIds.size > 0 && !relatedDiagnostics.some((item) => item.severity === "error"),
    diagnostics: [...new Set(relatedDiagnostics.map((item) => item.code))].sort(),
  });
}
