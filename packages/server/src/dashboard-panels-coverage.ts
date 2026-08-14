export const DASHBOARD_PANELS_COVERAGE_JS = `
var currentCoverage = null;
var currentCoverageCenter = null;

function coverageCellTitle(cell) {
  return (cell.character_id || "世界") + " / " + cell.requirement_id;
}

function coverageAssessmentRef() {
  if (currentCoverageCenter !== null && currentCoverageCenter.matrix !== null && currentCoverageCenter.matrix.assessment !== undefined) {
    return currentCoverageCenter.matrix.assessment;
  }
  if (currentCoverage !== null && currentCoverage.assessment !== undefined) {
    return currentCoverage.assessment;
  }
  return undefined;
}

function coverageButton(label, onClick) {
  var button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function startCoverageResearch(cell) {
  var assessment = coverageAssessmentRef();
  if (assessment === undefined) return;
  postJson("/workspace/coverage/research/start", {
    assessment_id: assessment.id,
    assessment_revision: assessment.revision,
  }).then(function (result) {
    renderMutationInvalidation(result.downstream_invalidation);
    byId("coverage-message").textContent = "已建立研究批次。";
    void loadCoverageData();
    void refreshWorkflowViews();
  }).catch(function (error) {
    setAreaError("coverage-message", error);
  });
}

function recoverCoverageTask(cell, action, promptText) {
  var tasks = cell.research_tasks || [];
  if (tasks.length === 0) {
    setAreaError("coverage-message", "沒有可恢復的研究任務。");
    return;
  }
  var task = tasks[tasks.length - 1];
  var value = window.prompt(promptText, "");
  if (value === null) return;
  var body = { task_id: task.id, action: action };
  if (action === "revise_query") body.query_seeds = value.trim() === "" ? [] : [value.trim()];
  if (action === "revise_constraints") body.source_constraints = value.trim() === "" ? [] : [value.trim()];
  if (action === "manual_url") {
    if (value.trim() === "") { setAreaError("coverage-message", "請提供 URL。"); return; }
    body.url = value.trim();
  }
  postJson("/workspace/coverage/research/recover", body).then(function (result) {
    renderMutationInvalidation(result.downstream_invalidation);
    byId("coverage-message").textContent = "已建立 successor 研究任務。";
    void loadCoverageData();
    void refreshWorkflowViews();
  }).catch(function (error) {
    setAreaError("coverage-message", error);
  });
}

function previewCoverageResolution(cell, action) {
  var assessment = coverageAssessmentRef();
  if (assessment === undefined) return;
  postJson("/workspace/coverage/resolution/preview", {
    assessment_id: assessment.id,
    assessment_revision: assessment.revision,
    requirement_id: cell.requirement_id,
    ...(cell.character_id === undefined ? {} : { character_id: cell.character_id }),
    action: action,
  }).then(function (preview) {
    var container = byId("coverage-message");
    container.textContent = (preview.consequences || []).join("；");
    var confirmButton = coverageButton(action === "user_supplement" ? "確認補充資料" : "確認創作補全", function () {
      var choice = window.prompt("請輸入確認理由：", action === "user_supplement" ? "使用者提供補充資料。" : "使用者授權創作補全。");
      if (choice === null || choice.trim() === "") { container.textContent = "已取消確認。"; return; }
      postJson("/workspace/coverage/resolution/confirm", {
        assessment_id: assessment.id,
        assessment_revision: assessment.revision,
        requirement_id: cell.requirement_id,
        ...(cell.character_id === undefined ? {} : { character_id: cell.character_id }),
        action: action,
        choice: choice.trim(),
        rationale: choice.trim(),
      }).then(function (result) {
        renderMutationInvalidation(result.downstream_invalidation);
        container.textContent = "已確認 resolution。";
        void loadCoverageData();
        void refreshWorkflowViews();
      }).catch(function (error) {
        setAreaError("coverage-message", error);
      });
    });
    container.appendChild(confirmButton);
  }).catch(function (error) {
    setAreaError("coverage-message", error);
  });
}

function renderCoverage(payload) {
  currentCoverage = payload;
  var grid = byId("coverage-grid");
  var message = byId("coverage-message");
  grid.textContent = "";
  if (payload === null || payload.assessment === undefined) {
    message.textContent = "目前沒有覆蓋評估資料；請先完成來源處理與正式評估。";
    return;
  }
  var parts = [];
  parts.push("評估 " + payload.assessment.pass + (payload.assessment.current ? "（目前）" : "（已過期，請重新評估）"));
  parts.push("requirement set " + payload.requirement_set.revision.slice(0, 8));
  parts.push(payload.ready ? "已就緒" : "尚未就緒");
  message.textContent = parts.join(" · ");
  var cells = payload.cells || [];
  for (var i = 0; i < cells.length; i++) {
    var cell = cells[i];
    var row = document.createElement("div");
    row.className = "coverage-cell";
    var title = document.createElement("div");
    title.className = "coverage-cell-title";
    var badge = document.createElement("span");
    badge.className = "status-badge " + statusClass(cell.status);
    badge.textContent = cell.status;
    title.appendChild(badge);
    var label = document.createElement("span");
    label.textContent = coverageCellTitle(cell);
    title.appendChild(label);
    row.appendChild(title);
    var meta = document.createElement("div");
    meta.className = "muted";
    var metaParts = [];
    (cell.research_tasks || []).forEach(function (task) {
      metaParts.push("任務 " + task.id.slice(0, 8) + " " + task.status + (task.predecessor_id ? "（承接 " + task.predecessor_id.slice(0, 8) + "）" : ""));
    });
    (cell.resolutions || []).forEach(function (res) {
      metaParts.push("resolution " + res.mode + " " + res.status);
    });
    meta.textContent = metaParts.join("；");
    row.appendChild(meta);
    var actions = document.createElement("div");
    actions.className = "coverage-actions";
    (cell.actions || []).forEach(function (action) {
      if (action === "research") {
        actions.appendChild(coverageButton("來源研究", function () { startCoverageResearch(cell); }));
      }
      if (action === "revise_query") {
        actions.appendChild(coverageButton("修改查詢", function () { recoverCoverageTask(cell, "revise_query", "新的 query seeds（逗號分隔）："); }));
      }
      if (action === "revise_constraints") {
        actions.appendChild(coverageButton("修改來源限制", function () { recoverCoverageTask(cell, "revise_constraints", "新的 source constraints（逗號分隔）："); }));
      }
      if (action === "manual_url") {
        actions.appendChild(coverageButton("手動提供 URL", function () { recoverCoverageTask(cell, "manual_url", "請貼上 URL："); }));
      }
      if (action === "supplement") {
        actions.appendChild(coverageButton("提供補充資料", function () { previewCoverageResolution(cell, "user_supplement"); }));
      }
      if (action === "creative_completion") {
        actions.appendChild(coverageButton("授權創作補全", function () { previewCoverageResolution(cell, "creative_completion"); }));
      }
    });
    row.appendChild(actions);
    grid.appendChild(row);
  }
}

async function loadCoverageData() {
  try {
    var payload = await requestJson("/workspace/dashboard/coverage");
    renderCoverage(payload);
    return payload;
  } catch (error) {
    setAreaError("coverage-message", error);
    throw error;
  }
}

function renderCellActionButton(cell, actionOpt) {
  var button = document.createElement("button");
  button.type = "button";
  button.textContent = actionOpt.label;
  if (cell.character_id) button.setAttribute("data-character-id", cell.character_id);
  button.setAttribute("data-requirement-id", cell.requirement_id);
  if (cell.assessment_id) button.setAttribute("data-assessment-id", cell.assessment_id);
  if (cell.assessment_revision) button.setAttribute("data-assessment-revision", cell.assessment_revision);
  button.setAttribute("data-action", actionOpt.action);

  if (!actionOpt.enabled) {
    button.disabled = true;
    if (actionOpt.disabled_reason) {
      button.title = actionOpt.disabled_reason;
    }
  }

  button.addEventListener("click", function () {
    if (!actionOpt.enabled) {
      if (actionOpt.prerequisite && actionOpt.prerequisite.target_panel) {
        switchPanel(actionOpt.prerequisite.target_panel);
      }
      return;
    }
    if (actionOpt.action === "research") {
      startCoverageResearch(cell);
    } else if (actionOpt.action === "revise_query") {
      recoverCoverageTask(cell, "revise_query", "新的 query seeds（逗號分隔）：");
    } else if (actionOpt.action === "revise_constraints") {
      recoverCoverageTask(cell, "revise_constraints", "新的 source constraints（逗號分隔）：");
    } else if (actionOpt.action === "manual_url") {
      recoverCoverageTask(cell, "manual_url", "請貼上 URL：");
    } else if (actionOpt.action === "supplement") {
      previewCoverageResolution(cell, "user_supplement");
    } else if (actionOpt.action === "creative_completion") {
      previewCoverageResolution(cell, "creative_completion");
    } else if (actionOpt.action === "reassess") {
      switchPanel("coverage");
    } else if (actionOpt.action === "view_details") {
      if (actionOpt.prerequisite && actionOpt.prerequisite.target_panel) {
        switchPanel(actionOpt.prerequisite.target_panel);
      }
    }
  });

  return button;
}

function coverageCenterCellElement(cell, tasks) {
  var row = document.createElement("div");
  row.className = "coverage-cell";
  if (cell.character_id) row.setAttribute("data-character-id", cell.character_id);
  row.setAttribute("data-requirement-id", cell.requirement_id);
  if (cell.assessment_id) row.setAttribute("data-assessment-id", cell.assessment_id);
  if (cell.assessment_revision) row.setAttribute("data-assessment-revision", cell.assessment_revision);

  var title = document.createElement("div");
  title.className = "coverage-cell-title";
  var badge = document.createElement("span");
  badge.className = "status-badge " + statusClass(cell.status);
  badge.textContent = cell.status;
  title.appendChild(badge);
  var label = document.createElement("span");
  label.textContent = coverageCellTitle(cell);
  title.appendChild(label);
  row.appendChild(title);
  var meta = document.createElement("div");
  meta.className = "muted";
  var metaParts = [];
  if (cell.requirement_label) metaParts.push(cell.requirement_label);
  if (cell.dimension_path) metaParts.push("維度 " + cell.dimension_path);
  if (cell.scope) metaParts.push(cell.scope === "world" ? "世界範圍" : "角色範圍");
  if (cell.reason) metaParts.push(cell.reason);
  if (cell.missing_prerequisite) metaParts.push("前置需求：" + cell.missing_prerequisite);
  meta.textContent = metaParts.join(" · ");
  row.appendChild(meta);
  var details = document.createElement("div");
  details.className = "muted";
  var detailParts = [];
  if (cell.assessment_id) detailParts.push("評估 " + cell.assessment_id + "@" + cell.assessment_revision.slice(0, 8));
  if (cell.accepted_fact_ids && cell.accepted_fact_ids.length > 0) detailParts.push("採用事實 " + cell.accepted_fact_ids.length);
  if (cell.candidate_fact_ids && cell.candidate_fact_ids.length > 0) detailParts.push("候選事實 " + cell.candidate_fact_ids.length);
  if (cell.evidence_source_ids && cell.evidence_source_ids.length > 0) detailParts.push("證據來源 " + cell.evidence_source_ids.length);
  if (cell.resolution_ids && cell.resolution_ids.length > 0) detailParts.push("resolutions " + cell.resolution_ids.length);
  if (cell.research_task_ids && cell.research_task_ids.length > 0) detailParts.push("研究任務 " + cell.research_task_ids.length);
  details.textContent = detailParts.join(" · ");
  row.appendChild(details);
  var taskList = document.createElement("div");
  taskList.className = "muted";
  var taskParts = [];
  (cell.research_task_ids || []).forEach(function (taskId) {
    var task = null;
    for (var i = 0; i < tasks.length; i++) {
      if (tasks[i].id === taskId) { task = tasks[i]; break; }
    }
    if (task !== null) {
      taskParts.push("任務 " + task.id.slice(0, 8) + " " + (task.projected_status || task.status) + (task.lease_owner ? "（租約 " + task.lease_owner + "）" : ""));
    } else {
      taskParts.push("任務 " + taskId.slice(0, 8));
    }
  });
  taskList.textContent = taskParts.join("；");
  row.appendChild(taskList);
  var actions = document.createElement("div");
  actions.className = "coverage-actions";
  if (cell.typed_actions && cell.typed_actions.length > 0) {
    cell.typed_actions.forEach(function (opt) {
      actions.appendChild(renderCellActionButton(cell, opt));
    });
  } else {
    (cell.actions || []).forEach(function (action) {
      if (action === "research") {
        actions.appendChild(coverageButton("來源研究", function () { startCoverageResearch(cell); }));
      }
      if (action === "revise_query") {
        actions.appendChild(coverageButton("修改查詢", function () { recoverCoverageTask(cell, "revise_query", "新的 query seeds（逗號分隔）："); }));
      }
      if (action === "revise_constraints") {
        actions.appendChild(coverageButton("修改來源限制", function () { recoverCoverageTask(cell, "revise_constraints", "新的 source constraints（逗號分隔）："); }));
      }
      if (action === "manual_url") {
        actions.appendChild(coverageButton("手動提供 URL", function () { recoverCoverageTask(cell, "manual_url", "請貼上 URL："); }));
      }
      if (action === "supplement") {
        actions.appendChild(coverageButton("提供補充資料", function () { previewCoverageResolution(cell, "user_supplement"); }));
      }
      if (action === "creative_completion") {
        actions.appendChild(coverageButton("授權創作補全", function () { previewCoverageResolution(cell, "creative_completion"); }));
      }
    });
  }
  row.appendChild(actions);
  return row;
}


function renderCoverageCenter(payload) {
  currentCoverageCenter = payload;
  var container = byId("coverage-center");
  container.textContent = "";
  if (payload === null || payload.matrix === null || payload.matrix === undefined) return;
  var matrix = payload.matrix;
  var heading = document.createElement("div");
  heading.className = "coverage-center-heading";
  var headingParts = [];
  if (matrix.assessment !== undefined) {
    headingParts.push("評估 " + matrix.assessment.id + "@" + matrix.assessment.revision.slice(0, 8) + "（" + matrix.assessment.pass + (matrix.assessment.fresh ? "、目前" : "、已過期") + "）");
  }
  if (matrix.requirement_set !== undefined) {
    headingParts.push("requirement set " + matrix.requirement_set.revision.slice(0, 8));
  }
  if (matrix.stale_components && matrix.stale_components.length > 0) {
    headingParts.push("失效元件：" + matrix.stale_components.join(", "));
  }
  heading.textContent = headingParts.join(" · ");
  container.appendChild(heading);
  var grid = document.createElement("div");
  grid.className = "coverage-grid";
  var tasks = payload.monitor !== undefined && payload.monitor.tasks !== undefined ? payload.monitor.tasks : [];
  var cells = matrix.cells || [];
  for (var i = 0; i < cells.length; i++) {
    grid.appendChild(coverageCenterCellElement(cells[i], tasks));
  }
  container.appendChild(grid);
}

function researchTaskElement(task) {
  var row = document.createElement("div");
  row.className = "workflow-stage";
  var title = document.createElement("div");
  title.className = "workflow-stage-title";
  var badge = document.createElement("span");
  var projected = task.projected_status || task.status;
  badge.className = "status-badge " + statusClass(projected);
  badge.textContent = projected;
  title.appendChild(badge);
  var label = document.createElement("span");
  label.textContent = "任務 " + task.id + (task.character_id ? "（" + task.character_id + "）" : "（世界）");
  title.appendChild(label);
  row.appendChild(title);
  var meta = document.createElement("div");
  meta.className = "muted";
  var metaParts = [];
  if (task.requirement_ids && task.requirement_ids.length > 0) metaParts.push("需求 " + task.requirement_ids.join(", "));
  if (task.dimension_paths && task.dimension_paths.length > 0) metaParts.push("維度 " + task.dimension_paths.join(", "));
  if (task.query_seeds && task.query_seeds.length > 0) metaParts.push("查詢種子 " + task.query_seeds.join(", "));
  if (task.source_constraints && task.source_constraints.length > 0) metaParts.push("來源限制 " + task.source_constraints.join(", "));
  if (task.lease_owner) metaParts.push("租約 " + task.lease_owner + (task.lease_expires_at ? " 到期 " + task.lease_expires_at : ""));
  metaParts.push("generation " + task.claim_generation);
  metaParts.push("attempt " + task.attempt);
  if (task.searched_queries && task.searched_queries.length > 0) metaParts.push("已查詢 " + task.searched_queries.join(", "));
  if (task.source_families && task.source_families.length > 0) metaParts.push("來源家族 " + task.source_families.join(", "));
  if (task.exhausted_reason) metaParts.push("耗盡原因 " + task.exhausted_reason);
  if (task.predecessor_id) metaParts.push("前身 " + task.predecessor_id.slice(0, 8));
  if (task.successor_ids && task.successor_ids.length > 0) metaParts.push("後續 " + task.successor_ids.map(function (id) { return id.slice(0, 8); }).join(", "));
  if (task.candidate_source_ids && task.candidate_source_ids.length > 0) metaParts.push("候選/來源 " + task.candidate_source_ids.map(function (id) { return id.slice(0, 8); }).join(", "));
  meta.textContent = metaParts.join("；");
  row.appendChild(meta);
  return row;
}

function renderResearchMonitor(monitor) {
  var container = byId("research-monitor");
  container.textContent = "";
  if (monitor === null || monitor === undefined) return;
  var batches = monitor.batches || [];
  var tasks = monitor.tasks || [];
  for (var i = 0; i < batches.length; i++) {
    var batch = batches[i];
    var box = document.createElement("div");
    box.className = "workflow-stage";
    var title = document.createElement("div");
    title.className = "workflow-stage-title";
    var badge = document.createElement("span");
    badge.className = "status-badge " + statusClass(batch.status);
    badge.textContent = batch.status;
    title.appendChild(badge);
    var label = document.createElement("span");
    label.textContent = "批次 " + batch.id + "（評估 " + batch.assessment_id + "@" + batch.assessment_revision.slice(0, 8) + "、requirement set " + batch.requirement_set_revision.slice(0, 8) + "）";
    title.appendChild(label);
    box.appendChild(title);
    var meta = document.createElement("div");
    meta.className = "muted";
    var metaParts = [];
    metaParts.push("建立者 " + batch.created_by);
    metaParts.push("時間 " + batch.created_at);
    var summaries = [];
    for (var key in batch.task_status_summary) {
      if (Object.prototype.hasOwnProperty.call(batch.task_status_summary, key)) {
        summaries.push(key + " " + batch.task_status_summary[key]);
      }
    }
    if (summaries.length > 0) metaParts.push("任務摘要 " + summaries.join(", "));
    if (batch.task_ids && batch.task_ids.length > 0) metaParts.push("任務 " + batch.task_ids.map(function (id) { return id.slice(0, 8); }).join(", "));
    meta.textContent = metaParts.join(" · ");
    box.appendChild(meta);
    container.appendChild(box);
  }
  for (var j = 0; j < tasks.length; j++) {
    container.appendChild(researchTaskElement(tasks[j]));
  }
}

async function loadCoverageCenterData() {
  try {
    var payload = await requestJson("/workspace/dashboard/coverage-center");
    renderCoverageCenter(payload);
    renderResearchMonitor(payload.monitor);
    return payload;
  } catch (error) {
    setAreaError("coverage-center-message", error);
    throw error;
  }
}
`;
