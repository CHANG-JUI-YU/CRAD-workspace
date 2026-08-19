export type DashboardSectionId = "overview" | "define" | "research" | "create" | "publish" | "operations";

export interface DashboardPanelDefinition {
  key: string;
  section: DashboardSectionId;
  anchor: string;
  heading: string;
}

export const DASHBOARD_PANEL_REGISTRY: readonly DashboardPanelDefinition[] = [
  { key: "project", section: "overview", anchor: "project-panel", heading: "project-heading" },
  { key: "status", section: "overview", anchor: "status-panel", heading: "status-heading" },
  { key: "agents", section: "overview", anchor: "agents-panel", heading: "agents-heading" },
  { key: "latest", section: "overview", anchor: "latest-panel", heading: "latest-heading" },
  { key: "request", section: "define", anchor: "request-panel", heading: "request-heading" },
  { key: "interview", section: "define", anchor: "interview-panel", heading: "interview-heading" },
  { key: "precheck", section: "define", anchor: "precheck-panel", heading: "precheck-heading" },
  { key: "source-fact", section: "research", anchor: "source-fact-panel", heading: "source-fact-heading" },
  { key: "coverage", section: "research", anchor: "coverage-panel", heading: "coverage-heading" },
  { key: "workflow", section: "research", anchor: "workflow-panel", heading: "workflow-heading" },
  { key: "artifact", section: "create", anchor: "artifact-panel", heading: "artifact-heading" },
  { key: "quality", section: "create", anchor: "quality-panel", heading: "quality-heading" },
  { key: "readiness", section: "publish", anchor: "readiness-panel", heading: "readiness-heading" },
  { key: "build", section: "publish", anchor: "build-panel", heading: "build-heading" },
  { key: "operation", section: "operations", anchor: "operation-panel", heading: "operation-heading" },
  { key: "repair", section: "operations", anchor: "repair-panel", heading: "repair-heading" },
  { key: "tavern", section: "operations", anchor: "tavern-panel", heading: "tavern-heading" },
  { key: "image", section: "operations", anchor: "image-panel", heading: "image-heading" },
] as const;

export const DASHBOARD_WORKFLOW_STAGE_PANEL = {
  sources: "source-fact",
  fact_curation: "source-fact",
  fact_review: "source-fact",
  coverage: "coverage",
  research_resolution: "coverage",
  authoring: "artifact",
  review: "quality",
  preview: "build",
  publish: "readiness",
} as const;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function addPanelAnchor(markup: string, definition: DashboardPanelDefinition): string {
  const heading = escapeRegExp(definition.heading);
  const sectionPattern = new RegExp(`<section\\b[^>]*\\baria-labelledby="${heading}"[^>]*>`, "g");
  const matches = markup.match(sectionPattern) ?? [];
  if (matches.length !== 1) {
    throw new Error(`Dashboard panel ${definition.key} expected exactly one section, found ${matches.length}`);
  }
  const tag = matches[0];
  const idMatch = tag.match(/\bid="([^"]+)"/u);
  if (idMatch !== null) {
    if (idMatch[1] !== definition.anchor) {
      throw new Error(`Dashboard panel ${definition.key} uses unexpected anchor ${idMatch[1] ?? ""}`);
    }
    return markup;
  }
  const anchored = tag.replace("<section", `<section id="${definition.anchor}"`);
  return markup.replace(tag, anchored);
}

function repairKnownDetailsImbalance(markup: string): string {
  const marker = "</details>\n</details>\n      <div id=\"latest-recovery\"";
  const count = markup.split(marker).length - 1;
  if (count === 0) return markup;
  if (count !== 1) throw new Error(`Dashboard markup expected at most one known details imbalance, found ${count}`);
  return markup.replace(marker, "</details>\n      <div id=\"latest-recovery\"");
}

export function prepareDashboardMarkup(markup: string): string {
  let prepared = repairKnownDetailsImbalance(markup);
  for (const definition of DASHBOARD_PANEL_REGISTRY) {
    prepared = addPanelAnchor(prepared, definition);
  }
  const ids = [...prepared.matchAll(/\bid="([^"]+)"/gu)].map((match) => match[1]);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (duplicates.length > 0) {
    throw new Error(`Dashboard markup contains duplicate ids: ${[...new Set(duplicates)].join(", ")}`);
  }
  return prepared;
}

const registryJson = JSON.stringify(DASHBOARD_PANEL_REGISTRY);
const workflowStagePanelJson = JSON.stringify(DASHBOARD_WORKFLOW_STAGE_PANEL);

export const DASHBOARD_NAVIGATION_REGISTRY_JS = `
var DASHBOARD_PANEL_REGISTRY = ${registryJson};
var DASHBOARD_WORKFLOW_STAGE_PANEL = ${workflowStagePanelJson};

function dashboardPanelDefinition(panelKey) {
  if (typeof panelKey !== "string" || panelKey.length === 0) return null;
  for (var i = 0; i < DASHBOARD_PANEL_REGISTRY.length; i += 1) {
    if (DASHBOARD_PANEL_REGISTRY[i].key === panelKey) return DASHBOARD_PANEL_REGISTRY[i];
  }
  return null;
}

function dashboardPanelFromElement(element) {
  if (element === null || element === undefined) return null;
  var elementId = typeof element.id === "string" ? element.id : "";
  var labelledBy = typeof element.getAttribute === "function" ? String(element.getAttribute("aria-labelledby") || "") : "";
  for (var i = 0; i < DASHBOARD_PANEL_REGISTRY.length; i += 1) {
    var definition = DASHBOARD_PANEL_REGISTRY[i];
    if (definition.anchor === elementId || definition.heading === labelledBy) return definition;
  }
  return null;
}

function sectionOfPanel(panelKey) {
  var definition = dashboardPanelDefinition(panelKey);
  return definition === null ? undefined : definition.section;
}

function panelAnchorId(panelKey) {
  var definition = dashboardPanelDefinition(panelKey);
  return definition === null ? null : definition.anchor;
}

function dashboardWorkflowTarget(stage) {
  if (stage === null || stage === undefined || typeof stage.id !== "string") return null;
  var panel = DASHBOARD_WORKFLOW_STAGE_PANEL[stage.id];
  if (typeof panel !== "string") return null;
  return { type: "panel", panel: panel };
}

function announceDashboardNavigationFallback(message) {
  if (typeof document === "undefined" || !document.getElementById) return;
  var notice = document.getElementById("transient-notice");
  if (notice === null) return;
  notice.textContent = message;
  notice.hidden = false;
}

function dashboardObjectElement(objectId) {
  if (typeof objectId !== "string" || objectId.length === 0 || typeof document === "undefined" || !document.querySelectorAll) return null;
  var candidates = document.querySelectorAll("[data-dashboard-object-id]");
  for (var i = 0; i < candidates.length; i += 1) {
    if (String(candidates[i].getAttribute("data-dashboard-object-id") || "") === objectId) return candidates[i];
  }
  return null;
}

function navigateDashboardTarget(target) {
  if (target === null || typeof target !== "object") {
    announceDashboardNavigationFallback("無法辨識導覽目標。");
    return false;
  }
  var definition = dashboardPanelDefinition(target.panel);
  if (definition === null) {
    announceDashboardNavigationFallback("此導覽目標目前不可用。");
    return false;
  }
  switchPanel(definition.key);
  if (target.type !== "object") return true;
  var scrollObject = function () {
    var objectElement = dashboardObjectElement(target.object_id);
    if (objectElement !== null && objectElement.scrollIntoView) {
      objectElement.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "center" });
      return;
    }
    announceDashboardNavigationFallback("指定項目已不存在或尚未載入；已帶你前往相關區段。");
  };
  if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
    window.requestAnimationFrame(scrollObject);
  } else {
    scrollObject();
  }
  return true;
}
`;
