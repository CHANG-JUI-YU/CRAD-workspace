import { DASHBOARD_PANELS_CORE_JS } from "./dashboard-panels-core.js";

function replaceExactlyOnce(source: string, before: string, after: string, label: string): string {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Dashboard project-selector transform missing ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`Dashboard project-selector transform found duplicate ${label}`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

function makeProjectSelectorUserFacing(source: string): string {
  let output = replaceExactlyOnce(
    source,
    `      function projectEntries(payload) {
        var source = Array.isArray(payload)
          ? payload
          : isRecord(payload) && Array.isArray(payload.projects)
            ? payload.projects
            : [];
        return source.map(function (item) {
          if (!isRecord(item)) {
            var simple = valueText(item);
            return { label: simple, value: simple, record: item };
          }
          var name = firstString(item, ["project_name", "name", "label"]);
          var folder = firstString(item, ["folder_name", "slug"]);
          var visiblePath = lastPathSegment(firstString(item, ["path", "project_path"]));
          var fallback = firstString(item, ["project", "project_id", "id"]) || visiblePath || "未命名專案";
          var revision = typeof item.revision === "number" ? "（r" + item.revision + "）" : "";
          return {
            label: (name || folder || visiblePath || fallback) + revision,
            value: name || folder || visiblePath || fallback,
            record: item
          };
        });
      }`,
    `      function projectEntries(payload) {
        var source = Array.isArray(payload)
          ? payload
          : isRecord(payload) && Array.isArray(payload.projects)
            ? payload.projects
            : [];
        var entries = source.map(function (item) {
          if (!isRecord(item)) {
            var simple = valueText(item);
            return { label: simple, value: simple, record: item };
          }
          var name = firstString(item, ["project_name", "name", "label"]);
          var visiblePath = lastPathSegment(firstString(item, ["path", "project_path"]));
          var folder = visiblePath || firstString(item, ["folder_name", "slug"]);
          var projectId = firstString(item, ["project_id", "id"]);
          var fallback = firstString(item, ["project"]) || projectId || folder || "未命名專案";
          var selector = folder || projectId || fallback;
          return {
            label: name || folder || fallback,
            value: selector,
            name: name,
            secondary: folder || projectId,
            record: item
          };
        });
        var duplicateNames = {};
        entries.forEach(function (entry) {
          if (!entry.name) return;
          duplicateNames[entry.name] = (duplicateNames[entry.name] || 0) + 1;
        });
        entries.forEach(function (entry) {
          if (!entry.name || duplicateNames[entry.name] < 2 || !entry.secondary) return;
          entry.label = entry.name + "（資料夾：" + entry.secondary + "）";
        });
        return entries;
      }`,
    "projectEntries",
  );

  output = replaceExactlyOnce(
    output,
    `      function projectReference(record) {
        if (!isRecord(record)) return "";
        return firstString(record, ["project_name", "name", "label", "project", "folder_name", "slug"])
          || lastPathSegment(firstString(record, ["project_path", "path"]))
          || firstString(record, ["project_id", "id"])
          || "";
      }`,
    `      function projectReference(record) {
        if (!isRecord(record)) return "";
        return lastPathSegment(firstString(record, ["project_path", "path"]))
          || firstString(record, ["folder_name", "project_id", "id", "slug"])
          || firstString(record, ["project_name", "name", "label", "project"])
          || "";
      }`,
    "projectReference",
  );

  output = replaceExactlyOnce(
    output,
    `      function renderFields(container, record) {`,
    `      function internalSyncField(key) {
        var normalized = String(key || "").toLowerCase();
        return normalized === "revision"
          || normalized.endsWith("_revision")
          || normalized === "lease"
          || normalized.startsWith("lease_")
          || normalized.endsWith("_lease")
          || normalized.indexOf("_lease_") >= 0
          || normalized === "cas"
          || normalized.startsWith("cas_")
          || normalized.endsWith("_cas")
          || normalized === "etag"
          || normalized === "id"
          || normalized.endsWith("_id")
          || normalized.endsWith("_ids")
          || normalized === "fencing_generation";
      }

      function renderFields(container, record) {`,
    "internal field filter",
  );

  output = replaceExactlyOnce(
    output,
    `          { label: "revision", keys: ["revision", "project_revision"] },
`,
    "",
    "revision preferred field",
  );

  output = replaceExactlyOnce(
    output,
    `          { label: "operation", keys: ["operation_id", "operation"] },`,
    `          { label: "operation", keys: ["operation"] },`,
    "operation id preferred field",
  );

  output = replaceExactlyOnce(
    output,
    `            if (used[key]) return;`,
    `            if (used[key] || internalSyncField(key)) return;`,
    "internal field suppression",
  );

  output = replaceExactlyOnce(
    output,
    `      function syncProjectSelection(record) {
        var reference = projectReference(record);
        state.currentProjectValue = reference;
        var select = byId("project-select");
        if (!reference) return;
        for (var index = 0; index < select.options.length; index += 1) {
          if (select.options[index].value === reference || select.options[index].textContent === reference) {
            select.selectedIndex = index;
            return;
          }
        }
      }`,
    `      function syncProjectSelection(record) {
        var reference = projectReference(record);
        state.currentProjectValue = reference;
        var select = byId("project-select");
        if (!reference) return;
        for (var index = 0; index < select.options.length; index += 1) {
          if (select.options[index].value === reference) {
            select.selectedIndex = index;
            return;
          }
        }
      }`,
    "syncProjectSelection",
  );

  return output;
}

export const DASHBOARD_PANELS_PROJECT_SELECTOR_UX_JS = makeProjectSelectorUserFacing(DASHBOARD_PANELS_CORE_JS);
