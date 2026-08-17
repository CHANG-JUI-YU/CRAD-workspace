export const DASHBOARD_PANELS_WORKFLOW_JS = `
var currentWorkflow = null;
var currentInvalidations = null;

function workflowStatusClass(status) {
  if (status === "completed") return "ready";
  if (status === "current") return "active";
  if (status === "blocked") return "error";
  if (status === "stale") return "cancelled";
  return "";
}

function workflowStatusLabel(status) {
  var labels = {
    completed: "已完成",
    current: "目前步驟",
    blocked: "受阻",
    stale: "已過期",
    not_applicable: "不適用"
  };
  return labels[status] || status || "未知";
}

function navigateWorkflowTarget(target) {
  if (!target) return;
  var anchor = target;
  if (anchor.indexOf("#") === 0) anchor = anchor.slice(1);
  var panel = byId(anchor);
  if (panel === null) return;
  panel.scrollIntoView({ behavior: typeof reducedMotion === "function" && reducedMotion() ? "auto" : "smooth", block: "start" });
}

function workflowStageElement(stage) {
  var row = document.createElement("div");
  row.className = "workflow-stage";
  var title = document.createElement("div");
  title.className = "workflow-stage-title";
  var badge = document.createElement("span");
  badge.className = "status-badge " + workflowStatusClass(stage.status);
  badge.textContent = workflowStatusLabel(stage.status);
  title.appendChild(badge);
  var label = document.createElement("span");
  label.textContent = stage.label;
  title.appendChild(label);
  row.appendChild(title);
  var meta = document.createElement("div");
  meta.className = "muted";
  var metaParts = [];
  if (stage.reason) metaParts.push(stage.reason);
  if (stage.revision) metaParts.push("revision " + stage.revision.slice(0, 8));
  if (stage.next_action) metaParts.push("下一步：" + stage.next_action);
  if (stage.affected_object_ids && stage.affected_object_ids.length > 0) metaParts.push("對象 " + stage.affected_object_ids.join(", "));
  meta.textContent = metaParts.join("；");
  row.appendChild(meta);
  if (stage.blockers && stage.blockers.length > 0) {
    var blockerList = document.createElement("ul");
    blockerList.className = "workflow-blockers";
    stage.blockers.forEach(function (blocker) {
      var item = document.createElement("li");
      item.textContent = blocker.message || blocker.code;
      blockerList.appendChild(item);
    });
    row.appendChild(blockerList);
  }
  if (stage.target) {
    var nav = document.createElement("button");
    nav.type = "button";
    nav.textContent = "前往";
    nav.addEventListener("click", function () { navigateWorkflowTarget(stage.target); });
    row.appendChild(nav);
  }
  return row;
}

function renderWorkflow(payload) {
  currentWorkflow = payload;
  var container = byId("workflow-stages");
  var message = byId("workflow-message");
  container.textContent = "";
  if (payload === null || payload.is_source_adaptation === false || payload.stages === undefined || payload.stages.length === 0) {
    message.textContent = "此專案不是來源適配工作流程。";
    return;
  }
  var summary = [];
  if (payload.current_stage) summary.push("目前階段 " + payload.current_stage);
  if (payload.next_action) summary.push("下一步：" + payload.next_action);
  message.textContent = summary.join(" · ") || "九階段進度如下。";
  payload.stages.forEach(function (stage) {
    container.appendChild(workflowStageElement(stage));
  });
}

function invalidationItemElement(item) {
  var row = document.createElement("div");
  row.className = "workflow-invalidation-item";
  var title = document.createElement("div");
  title.className = "workflow-invalidation-title";
  var badge = document.createElement("span");
  badge.className = "status-badge cancelled";
  badge.textContent = item.target_kind;
  title.appendChild(badge);
  var label = document.createElement("span");
  label.textContent = item.target_id + (item.revision ? " @" + item.revision.slice(0, 8) : "");
  title.appendChild(label);
  row.appendChild(title);
  var reason = document.createElement("div");
  reason.className = "muted";
  reason.textContent = item.reason_code + "：" + item.reason + " 下一步：" + item.next_action;
  row.appendChild(reason);
  return row;
}

function renderInvalidations(report) {
  currentInvalidations = report;
  var container = byId("workflow-invalidations");
  container.textContent = "";
  if (report === null || report.invalidated === false || report.items === undefined || report.items.length === 0) {
    container.textContent = "目前沒有下游失效項目。";
    return;
  }
  var heading = document.createElement("div");
  heading.className = "workflow-invalidations-heading";
  heading.textContent = "下游失效" + (report.publish_readiness_affected ? "（影響發布就緒）" : "");
  container.appendChild(heading);
  report.items.forEach(function (item) {
    container.appendChild(invalidationItemElement(item));
  });
}

async function loadWorkflowData() {
  try {
    var workflow = await requestJson("/workspace/dashboard/workflow");
    renderWorkflow(workflow);
    var invalidations = await requestJson("/workspace/dashboard/invalidations");
    renderInvalidations(invalidations);
    return { workflow: workflow, invalidations: invalidations };
  } catch (error) {
    setAreaError("workflow-message", error);
    throw error;
  }
}

function refreshWorkflowViews() {
  return loadWorkflowData().catch(function () { /* 背景重新載入失敗不中斷其他動作 */ });
}

function renderMutationInvalidation(report) {
  if (report === undefined || report === null) return;
  renderInvalidations(report);
}
`;
