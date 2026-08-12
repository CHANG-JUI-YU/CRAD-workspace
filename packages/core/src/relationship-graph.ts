export interface RelationshipPerspective {
  readonly source_character_id: string;
  readonly target_character_id: string;
  readonly summary: string;
}

export interface RelationshipDocumentLike {
  readonly schema_version: 1 | 2;
  readonly perspectives?: readonly RelationshipPerspective[] | undefined;
  readonly self_perspectives?: readonly RelationshipPerspective[] | undefined;
  readonly edges?: readonly RelationshipPerspective[] | undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function perspective(value: unknown): RelationshipPerspective | undefined {
  const item = record(value);
  const source = text(item?.source_character_id);
  const target = text(item?.target_character_id);
  const summary = text(item?.summary);
  if (source === undefined || target === undefined || summary === undefined) return undefined;
  return { source_character_id: source, target_character_id: target, summary };
}

function perspectiveArray(value: unknown): RelationshipPerspective[] {
  return Array.isArray(value) ? value.flatMap((item) => {
    const parsed = perspective(item);
    return parsed === undefined ? [] : [parsed];
  }) : [];
}

/**
 * Read both the v2 sparse fields and the v1 full-matrix field. The first
 * occurrence of a pair wins, making recovery deterministic for mixed legacy
 * payloads while keeping the schema strict for newly authored documents.
 */
export function relationshipPerspectiveEntries(document: unknown): RelationshipPerspective[] {
  const value = record(document);
  const candidates = [
    ...perspectiveArray(value?.self_perspectives),
    ...perspectiveArray(value?.edges),
    ...perspectiveArray(value?.perspectives),
  ];
  const seen = new Set<string>();
  return candidates.filter((item) => {
    const key = `${item.source_character_id}\u0000${item.target_character_id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Convert a validated v1 or v2 document into the canonical sparse shape. */
export function normalizeSparseRelationshipsDocument<T extends RelationshipDocumentLike>(document: T): Omit<T, "schema_version" | "perspectives" | "self_perspectives" | "edges"> & {
  readonly schema_version: 2;
  readonly self_perspectives: RelationshipPerspective[];
  readonly edges: RelationshipPerspective[];
} {
  const { schema_version: _version, perspectives: _legacy, self_perspectives: _self, edges: _edges, ...rest } = document;
  const entries = relationshipPerspectiveEntries(document);
  return {
    ...rest,
    schema_version: 2,
    self_perspectives: entries.filter((item) => item.source_character_id === item.target_character_id),
    edges: entries.filter((item) => item.source_character_id !== item.target_character_id),
  } as Omit<T, "schema_version" | "perspectives" | "self_perspectives" | "edges"> & {
    readonly schema_version: 2;
    readonly self_perspectives: RelationshipPerspective[];
    readonly edges: RelationshipPerspective[];
  };
}
