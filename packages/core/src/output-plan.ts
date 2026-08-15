import { z } from "zod";
import { publishedCardExportPath, publishedCardPngExportPath, type CardExportMode } from "./export-paths.js";
import type { ProjectState } from "./project-state.js";

export type PublishedOutputMode = CardExportMode | "default";

export interface PublishedOutputPlan {
  mode: PublishedOutputMode;
  project_name?: string;
  sanitized_name: string;
  json_path: string;
  png_path: string;
}

export const publishedOutputPlanSchema = z.object({
  mode: z.enum(["zhuji", "palette", "both", "default"]),
  project_name: z.string().optional(),
  sanitized_name: z.string().min(1),
  json_path: z.string().min(1),
  png_path: z.string().min(1),
}).strict();

const OUTPUT_NAME_SUFFIXES = ["雙模式角色卡", "珠璣角色卡", "調色盤角色卡", "角色卡"] as const;

export function derivePublishedOutputPlan(state: Pick<ProjectState, "project_name" | "project_id" | "artifacts">, mode: CardExportMode | null | undefined): PublishedOutputPlan {
  const json_path = publishedCardExportPath(state.project_name, state.project_id, state.artifacts, mode ?? undefined);
  const png_path = publishedCardPngExportPath(state.project_name, state.project_id, state.artifacts, mode ?? undefined);
  const relative = json_path.slice("exports/".length);
  const withoutExt = relative.endsWith(".json") ? relative.slice(0, relative.length - ".json".length) : relative;
  let sanitized_name = withoutExt;
  for (const suffix of OUTPUT_NAME_SUFFIXES) {
    if (sanitized_name.endsWith(`-${suffix}`)) {
      sanitized_name = sanitized_name.slice(0, sanitized_name.length - suffix.length - 1);
      break;
    }
  }
  return {
    mode: mode ?? "default",
    ...(state.project_name === undefined ? {} : { project_name: state.project_name }),
    sanitized_name,
    json_path,
    png_path,
  };
}
