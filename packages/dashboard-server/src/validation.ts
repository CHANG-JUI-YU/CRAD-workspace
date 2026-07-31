import { stableIdSchema } from "@card-workspace/schemas";

/** Parse IDs before they are ever joined to a workspace path. */
export function projectId(value: unknown): string {
  return stableIdSchema.parse(value);
}

export function resourceId(value: unknown): string {
  return stableIdSchema.parse(value);
}
