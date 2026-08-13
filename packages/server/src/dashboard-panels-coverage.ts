export const DASHBOARD_PANELS_COVERAGE_JS = `
var currentCoverage = null;

function coverageCellTitle(cell) {
  return (cell.character_id || "世界") + " / " + cell.requirement_id;
}

function coverageButton(label, onClick) {
  var button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function startCoverageResearch(cell) {
  var payload = currentCoverage;
  if (payload === null || payload.assessment === undefined) return;
  postJson("/workspace/coverage/research/start", {
    assessment_id: payload.assessment.id,
    assessment_revision: payload.assessment.revision,
  }).then(function () {
    byId("coverage-message").textContent = "已建立研究批次。";
    void loadCoverageData();
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
  postJson("/workspace/coverage/research/recover", body).then(function () {
    byId("coverage-message").textContent = "已建立 successor 研究任務。";
    void loadCoverageData();
  }).catch(function (error) {
    setAreaError("coverage-message", error);
  });
}

function previewCoverageResolution(cell, action) {
  var payload = currentCoverage;
  if (payload === null || payload.assessment === undefined) return;
  postJson("/workspace/coverage/resolution/preview", {
    assessment_id: payload.assessment.id,
    assessment_revision: payload.assessment.revision,
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
        assessment_id: payload.assessment.id,
        assessment_revision: payload.assessment.revision,
        requirement_id: cell.requirement_id,
        ...(cell.character_id === undefined ? {} : { character_id: cell.character_id }),
        action: action,
        choice: choice.trim(),
        rationale: choice.trim(),
      }).then(function () {
        container.textContent = "已確認 resolution。";
        void loadCoverageData();
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
`;
