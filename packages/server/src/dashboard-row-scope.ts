import { DASHBOARD_PANELS_MEDIA_JS } from "./dashboard-panels-media.js";
import { DASHBOARD_PANELS_PUBLISH_JS } from "./dashboard-panels-publish.js";
import { DASHBOARD_PANELS_REVIEW_JS } from "./dashboard-panels-review.js";

type RowScopeRule = {
  functionName: string;
  bindings: readonly string[];
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function scopeDashboardRowBindings(source: string, rules: readonly RowScopeRule[]): string {
  let output = source;
  for (const rule of rules) {
    const marker = `      function ${rule.functionName}(`;
    const start = output.indexOf(marker);
    if (start < 0) {
      throw new Error(`Dashboard row-scope function not found: ${rule.functionName}`);
    }
    const next = output.indexOf("\n\n      function ", start + marker.length);
    const end = next < 0 ? output.length : next;
    let segment = output.slice(start, end);

    for (const binding of rule.bindings) {
      const declaration = new RegExp(`\\bvar\\s+${escapeRegExp(binding)}\\s*=`, "g");
      const matches = segment.match(declaration) ?? [];
      if (matches.length !== 1) {
        throw new Error(
          `Dashboard row-scope binding ${rule.functionName}.${binding} expected once, found ${matches.length}`,
        );
      }
      segment = segment.replace(declaration, `let ${binding} =`);
    }

    output = output.slice(0, start) + segment + output.slice(end);
  }
  return output;
}

export const DASHBOARD_PANELS_MEDIA_ROW_SAFE_JS = scopeDashboardRowBindings(
  DASHBOARD_PANELS_MEDIA_JS,
  [{ functionName: "renderImageList", bindings: ["imageId"] }],
);

export const DASHBOARD_PANELS_PUBLISH_ROW_SAFE_JS = scopeDashboardRowBindings(
  DASHBOARD_PANELS_PUBLISH_JS,
  [{ functionName: "renderArtifactList", bindings: ["current", "revisions", "row"] }],
);

export const DASHBOARD_PANELS_REVIEW_ROW_SAFE_JS = scopeDashboardRowBindings(
  DASHBOARD_PANELS_REVIEW_JS,
  [{ functionName: "renderEvidence", bindings: ["candidate", "runView", "select", "reason"] }],
);
