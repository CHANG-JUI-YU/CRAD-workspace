export const DASHBOARD_PANELS_COVERAGE_JS = `
var currentCoverageCenter = null;

function setCoverageNotice(text) {
  var el = byId("coverage-center-message") || byId("coverage-message");
  if (el) el.textContent = text;
}

function setCoverageError(error) {
  setAreaError(byId("coverage-center-message") ? "coverage-center-message" : "coverage-message", error);
}

function coverageCellTitle(cell) {
  return (cell.character_id || "世界") + " / " + cell.requirement_id;
}

function coverageAssessmentRef() {
  if (currentCoverageCenter !== null && currentCoverageCenter.matrix !== null && currentCoverageCenter.matrix.assessment !== undefined) {
    return currentCoverageCenter.matrix.assessment;
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

function startCoverageResearch(cell, isAssessmentWide) {
  var assessment = coverageAssessmentRef();
  if (assessment === undefined) return;

  var scope = (isAssessmentWide || !cell)
    ? { kind: "assessment" }
    : { kind: "requirements", targets: [{ requirement_id: cell.requirement_id, ...(cell.character_id ? { character_id: cell.character_id } : {}) }] };

  postJson("/workspace/coverage/research/preview", {
    assessment_id: assessment.id,
    assessment_revision: assessment.revision,
    scope: scope,
  }).then(function (preview) {
    var existingModal = byId("research-start-modal-overlay");
    if (existingModal) existingModal.remove();

    var overlay = document.createElement("div");
    overlay.id = "research-start-modal-overlay";
    overlay.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;";

    var modal = document.createElement("div");
    modal.style.cssText = "background:#fff;border-radius:8px;max-width:520px;width:100%;max-height:90vh;overflow-y:auto;padding:24px;box-shadow:0 4px 20px rgba(0,0,0,0.25);font-family:inherit;";

    var title = document.createElement("h3");
    title.style.cssText = "margin-top:0;margin-bottom:12px;";
    title.textContent = isAssessmentWide ? "啟動全量缺口研究" : ("啟動研究 — " + coverageCellTitle(cell));
    modal.appendChild(title);

    var infoBox = document.createElement("div");
    infoBox.style.cssText = "background:#f8f9fa;border-left:4px solid #0066cc;padding:12px 16px;margin-bottom:16px;font-size:0.9em;color:#333;line-height:1.6;";
    
    var line1 = document.createElement("div");
    line1.textContent = "範圍：" + (isAssessmentWide ? "全評估所有缺口項目" : coverageCellTitle(cell));
    infoBox.appendChild(line1);

    var line2 = document.createElement("div");
    line2.textContent = "請求目標數：" + (preview.requested_targets ? preview.requested_targets.length : 0) + " 個";
    infoBox.appendChild(line2);

    var line3 = document.createElement("div");
    line3.textContent = "已有進行中任務：" + (preview.existing_targets ? preview.existing_targets.length : 0) + " 個";
    infoBox.appendChild(line3);

    var line4 = document.createElement("div");
    line4.textContent = "預計新建任務數：" + (preview.new_task_count !== undefined ? preview.new_task_count : 0) + " 個";
    infoBox.appendChild(line4);

    if (preview.already_covered) {
      var noteDiv = document.createElement("div");
      noteDiv.style.cssText = "margin-top:8px;color:#856404;background:#fff3cd;padding:6px 10px;border-radius:4px;";
      noteDiv.textContent = "注意：所有請求目標均已有正在執行的研究任務，確認後將直接重用既有工作。";
      infoBox.appendChild(noteDiv);
    }
    modal.appendChild(infoBox);

    var errBox = document.createElement("div");
    errBox.style.cssText = "color:#dc3545;font-weight:bold;margin-bottom:12px;display:none;font-size:0.9em;";
    modal.appendChild(errBox);

    var actionRow = document.createElement("div");
    actionRow.style.cssText = "display:flex;justify-content:flex-end;gap:8px;";

    var cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.textContent = "取消";
    cancelBtn.style.cssText = "padding:8px 16px;border:1px solid #ccc;background:#fff;border-radius:4px;cursor:pointer;";
    cancelBtn.addEventListener("click", function () { overlay.remove(); });
    actionRow.appendChild(cancelBtn);

    var submitBtn = document.createElement("button");
    submitBtn.type = "button";
    submitBtn.textContent = preview.already_covered ? "重用既有研究任務" : "確認啟動研究";
    submitBtn.style.cssText = "padding:8px 16px;border:none;background:#0066cc;color:#fff;border-radius:4px;cursor:pointer;font-weight:bold;";

    submitBtn.addEventListener("click", function () {
      submitBtn.disabled = true;
      submitBtn.textContent = "啟動中...";
      postJson("/workspace/coverage/research/start", {
        assessment_id: assessment.id,
        assessment_revision: assessment.revision,
        scope: scope,
      }).then(function (result) {
        overlay.remove();
        renderMutationInvalidation(result.downstream_invalidation);
        setCoverageNotice(result.summary || (result.reused ? "所請求的研究項目已有進行中的任務。" : "已建立研究批次。"));
        void loadCoverageCenterData();
        void refreshWorkflowViews();
      }).catch(function (error) {
        submitBtn.disabled = false;
        submitBtn.textContent = "確認啟動研究";
        errBox.textContent = "啟動失敗：" + (error && error.message ? error.message : String(error));
        errBox.style.display = "block";
      });
    });

    actionRow.appendChild(submitBtn);
    modal.appendChild(actionRow);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
  }).catch(function (error) {
    setCoverageError(error);
  });
}

function openRecoveryDialog(cell, action) {
  var allTasks = cell.current_research_tasks || cell.research_tasks || [];
  var exhaustedTasks = allTasks.filter(function (t) {
    return (t.is_exhausted || t.status === "exhausted") && !t.successor_id;
  });

  if (exhaustedTasks.length === 0) {
    setCoverageNotice("此項目沒有可恢復的 Exhausted 任務。");
    return;
  }

  var existingModal = byId("recovery-modal-overlay");
  if (existingModal) existingModal.remove();

  var overlay = document.createElement("div");
  overlay.id = "recovery-modal-overlay";
  overlay.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;";

  var modal = document.createElement("div");
  modal.style.cssText = "background:#fff;border-radius:8px;max-width:550px;width:100%;max-height:90vh;overflow-y:auto;padding:24px;box-shadow:0 4px 20px rgba(0,0,0,0.25);font-family:inherit;";

  var actionLabels = {
    revise_query: "修改查詢 (Revise Query)",
    revise_constraints: "修改來源限制 (Revise Constraints)",
    manual_url: "手動提供 URL (Manual URL)",
    supplement: "提供補充資料 (User Supplement)",
    creative_completion: "授權創作補全 (Creative Completion)",
  };

  var title = document.createElement("h3");
  title.style.cssText = "margin-top:0;margin-bottom:12px;";
  title.textContent = "任務恢復 — " + (actionLabels[action] || action) + " — " + coverageCellTitle(cell);
  modal.appendChild(title);

  var errBox = document.createElement("div");
  errBox.style.cssText = "color:#dc3545;font-weight:bold;margin-bottom:12px;display:none;font-size:0.9em;";
  modal.appendChild(errBox);

  var taskGroup = document.createElement("div");
  taskGroup.style.cssText = "margin-bottom:14px;";
  var taskLabel = document.createElement("label");
  taskLabel.style.cssText = "display:block;font-weight:bold;margin-bottom:4px;font-size:0.9em;";
  taskLabel.textContent = "選擇要恢復的 Exhausted 任務：";
  taskGroup.appendChild(taskLabel);

  var taskSelect = document.createElement("select");
  taskSelect.style.cssText = "width:100%;padding:8px;box-sizing:border-box;border:1px solid #ccc;border-radius:4px;";
  exhaustedTasks.forEach(function (t) {
    var opt = document.createElement("option");
    opt.value = t.id;
    var reasonText = t.exhausted_reason ? (" - " + t.exhausted_reason) : "";
    opt.textContent = "任務 " + t.id.slice(0, 8) + " (Attempt " + (t.attempt || 1) + reasonText + ")";
    taskSelect.appendChild(opt);
  });
  taskGroup.appendChild(taskSelect);
  modal.appendChild(taskGroup);

  var inputGroup = document.createElement("div");
  inputGroup.style.cssText = "margin-bottom:16px;";

  var queryInput = null;
  var constraintsInput = null;
  var urlInput = null;
  var textInput = null;
  var fileInput = null;
  var choiceInput = null;
  var rationaleInput = null;

  if (action === "revise_query") {
    var qLabel = document.createElement("label");
    qLabel.style.cssText = "display:block;font-weight:bold;margin-bottom:4px;font-size:0.9em;";
    qLabel.textContent = "新的查詢關鍵字 (Query Seeds，以逗號分隔)：";
    queryInput = document.createElement("input");
    queryInput.type = "text";
    queryInput.placeholder = "例如：角色別名, 歷史戰役, 家族背景";
    queryInput.style.cssText = "width:100%;padding:8px;box-sizing:border-box;border:1px solid #ccc;border-radius:4px;";
    inputGroup.appendChild(qLabel);
    inputGroup.appendChild(queryInput);
  } else if (action === "revise_constraints") {
    var cLabel = document.createElement("label");
    cLabel.style.cssText = "display:block;font-weight:bold;margin-bottom:4px;font-size:0.9em;";
    cLabel.textContent = "新的來源限制條件 (Source Constraints，以逗號分隔)：";
    constraintsInput = document.createElement("input");
    constraintsInput.type = "text";
    constraintsInput.placeholder = "例如：site:wikipedia.org, official:true";
    constraintsInput.style.cssText = "width:100%;padding:8px;box-sizing:border-box;border:1px solid #ccc;border-radius:4px;";
    inputGroup.appendChild(cLabel);
    inputGroup.appendChild(constraintsInput);
  } else if (action === "manual_url") {
    var uLabel = document.createElement("label");
    uLabel.style.cssText = "display:block;font-weight:bold;margin-bottom:4px;font-size:0.9em;";
    uLabel.textContent = "手動提供來源網址 (URL)：";
    urlInput = document.createElement("input");
    urlInput.type = "url";
    urlInput.placeholder = "https://example.com/character-source";
    urlInput.style.cssText = "width:100%;padding:8px;box-sizing:border-box;border:1px solid #ccc;border-radius:4px;";
    inputGroup.appendChild(uLabel);
    inputGroup.appendChild(urlInput);
  } else if (action === "supplement") {
    var tLabel = document.createElement("label");
    tLabel.style.cssText = "display:block;font-weight:bold;margin-bottom:4px;font-size:0.9em;";
    tLabel.textContent = "補充資料內容（純文字）：";
    textInput = document.createElement("textarea");
    textInput.rows = 3;
    textInput.style.cssText = "width:100%;padding:8px;box-sizing:border-box;border:1px solid #ccc;border-radius:4px;margin-bottom:8px;";
    inputGroup.appendChild(tLabel);
    inputGroup.appendChild(textInput);

    var suLabel = document.createElement("label");
    suLabel.style.cssText = "display:block;font-weight:bold;margin-bottom:4px;font-size:0.9em;";
    suLabel.textContent = "參考網址 (選填)：";
    urlInput = document.createElement("input");
    urlInput.type = "url";
    urlInput.style.cssText = "width:100%;padding:8px;box-sizing:border-box;border:1px solid #ccc;border-radius:4px;margin-bottom:8px;";
    inputGroup.appendChild(suLabel);
    inputGroup.appendChild(urlInput);

    var fLabel = document.createElement("label");
    fLabel.style.cssText = "display:block;font-weight:bold;margin-bottom:4px;font-size:0.9em;";
    fLabel.textContent = "上傳附件 (選填)：";
    fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.style.cssText = "display:block;";
    inputGroup.appendChild(fLabel);
    inputGroup.appendChild(fileInput);
  } else if (action === "creative_completion") {
    var chLabel = document.createElement("label");
    chLabel.style.cssText = "display:block;font-weight:bold;margin-bottom:4px;font-size:0.9em;";
    chLabel.textContent = "創作補全決策 (Choice)：";
    choiceInput = document.createElement("input");
    choiceInput.type = "text";
    choiceInput.value = "授權創作補全設定";
    choiceInput.style.cssText = "width:100%;padding:8px;box-sizing:border-box;border:1px solid #ccc;border-radius:4px;margin-bottom:8px;";
    inputGroup.appendChild(chLabel);
    inputGroup.appendChild(choiceInput);

    var rLabel = document.createElement("label");
    rLabel.style.cssText = "display:block;font-weight:bold;margin-bottom:4px;font-size:0.9em;";
    rLabel.textContent = "決策理由 (Rationale)：";
    rationaleInput = document.createElement("input");
    rationaleInput.type = "text";
    rationaleInput.value = "經多輪研究仍無公開官方來源，授權依世界觀補全。";
    rationaleInput.style.cssText = "width:100%;padding:8px;box-sizing:border-box;border:1px solid #ccc;border-radius:4px;";
    inputGroup.appendChild(rLabel);
    inputGroup.appendChild(rationaleInput);
  }

  modal.appendChild(inputGroup);

  var actionRow = document.createElement("div");
  actionRow.style.cssText = "display:flex;justify-content:flex-end;gap:8px;";

  var cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.textContent = "取消";
  cancelBtn.style.cssText = "padding:8px 16px;border:1px solid #ccc;background:#fff;border-radius:4px;cursor:pointer;";
  cancelBtn.addEventListener("click", function () { overlay.remove(); });
  actionRow.appendChild(cancelBtn);

  var submitBtn = document.createElement("button");
  submitBtn.type = "button";
  submitBtn.textContent = "確認執行恢復";
  submitBtn.style.cssText = "padding:8px 16px;border:none;background:#0066cc;color:#fff;border-radius:4px;cursor:pointer;font-weight:bold;";

  submitBtn.addEventListener("click", function () {
    var selectedTaskId = taskSelect.value;
    var payload = { task_id: selectedTaskId, action: action };

    if (action === "revise_query") {
      var qVal = queryInput.value.trim();
      if (!qVal) { errBox.textContent = "請輸入至少一個查詢關鍵字。"; errBox.style.display = "block"; return; }
      payload.query_seeds = qVal.split(",").map(function (s) { return s.trim(); }).filter(Boolean);
    } else if (action === "revise_constraints") {
      var cVal = constraintsInput.value.trim();
      if (!cVal) { errBox.textContent = "請輸入至少一個限制條件。"; errBox.style.display = "block"; return; }
      payload.source_constraints = cVal.split(",").map(function (s) { return s.trim(); }).filter(Boolean);
    } else if (action === "manual_url") {
      var uVal = urlInput.value.trim();
      if (!uVal) { errBox.textContent = "請提供有效的網址 URL。"; errBox.style.display = "block"; return; }
      payload.url = uVal;
    } else if (action === "creative_completion") {
      var chVal = choiceInput.value.trim();
      var rVal = rationaleInput.value.trim();
      if (!chVal || !rVal) { errBox.textContent = "請填寫補全決策與理由。"; errBox.style.display = "block"; return; }
      payload.choice = chVal;
      payload.rationale = rVal;
    }

    errBox.style.display = "none";
    submitBtn.disabled = true;
    submitBtn.textContent = "執行中...";

    var sendRecover = function (attachmentsPayload) {
      if (attachmentsPayload) payload.attachments = attachmentsPayload;
      if (action === "supplement") {
        if (textInput && textInput.value.trim()) payload.text = textInput.value.trim();
        if (urlInput && urlInput.value.trim()) payload.url = urlInput.value.trim();
        if (!payload.text && !payload.url && (!payload.attachments || payload.attachments.length === 0)) {
          submitBtn.disabled = false;
          submitBtn.textContent = "確認執行恢復";
          errBox.textContent = "請至少提供文字、URL 或附件其中一項。";
          errBox.style.display = "block";
          return;
        }
      }

      postJson("/workspace/coverage/research/recover", payload).then(function (result) {
        overlay.remove();
        renderMutationInvalidation(result.downstream_invalidation);
        setCoverageNotice(result.summary || "已完成任務恢復操作。");
        void loadCoverageCenterData();
        void refreshWorkflowViews();
      }).catch(function (error) {
        submitBtn.disabled = false;
        submitBtn.textContent = "確認執行恢復";
        errBox.textContent = "恢復失敗：" + (error && error.message ? error.message : String(error));
        errBox.style.display = "block";
      });
    };

    if (action === "supplement" && fileInput && fileInput.files && fileInput.files.length > 0) {
      var file = fileInput.files[0];
      var reader = new FileReader();
      reader.onload = function (e) {
        var arrayBuffer = e.target.result;
        var bytes = new Uint8Array(arrayBuffer);
        var binaryStr = "";
        for (var i = 0; i < bytes.byteLength; i++) {
          binaryStr += String.fromCharCode(bytes[i]);
        }
        var base64 = window.btoa(binaryStr);
        sendRecover([{ name: file.name, content: base64, media_type: file.type || "text/plain" }]);
      };
      reader.onerror = function () {
        submitBtn.disabled = false;
        submitBtn.textContent = "確認執行恢復";
        errBox.textContent = "讀取附件檔案失敗。";
        errBox.style.display = "block";
      };
      reader.readAsArrayBuffer(file);
    } else {
      sendRecover(null);
    }
  });

  actionRow.appendChild(submitBtn);
  modal.appendChild(actionRow);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}

function openSupplementDialog(cell, preview) {
  var assessment = coverageAssessmentRef();
  if (assessment === undefined) return;

  var existingModal = byId("supplement-modal-overlay");
  if (existingModal) existingModal.remove();

  var overlay = document.createElement("div");
  overlay.id = "supplement-modal-overlay";
  overlay.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;";

  var modal = document.createElement("div");
  modal.style.cssText = "background:#fff;border-radius:8px;max-width:550px;width:100%;max-height:90vh;overflow-y:auto;padding:24px;box-shadow:0 4px 20px rgba(0,0,0,0.25);font-family:inherit;";

  var title = document.createElement("h3");
  title.style.cssText = "margin-top:0;margin-bottom:12px;";
  title.textContent = "提供補充資料 — " + coverageCellTitle(cell);
  modal.appendChild(title);

  var previewBox = document.createElement("div");
  previewBox.style.cssText = "background:#f8f9fa;border-left:4px solid #0066cc;padding:10px 14px;margin-bottom:16px;font-size:0.9em;color:#333;";
  previewBox.textContent = "操作預期影響：" + ((preview && preview.consequences) ? preview.consequences.join("；") : "確認提供補充資料後，系統將記錄決策並進行來源分片與事實提煉。");
  modal.appendChild(previewBox);

  var errBox = document.createElement("div");
  errBox.style.cssText = "color:#dc3545;font-weight:bold;margin-bottom:12px;display:none;font-size:0.9em;";
  modal.appendChild(errBox);

  var textGroup = document.createElement("div");
  textGroup.style.cssText = "margin-bottom:12px;";
  var textLabel = document.createElement("label");
  textLabel.style.cssText = "display:block;font-weight:bold;margin-bottom:4px;font-size:0.9em;";
  textLabel.textContent = "補充資料內容（純文字）：";
  var textInput = document.createElement("textarea");
  textInput.rows = 3;
  textInput.style.cssText = "width:100%;padding:8px;box-sizing:border-box;border:1px solid #ccc;border-radius:4px;";
  textInput.placeholder = "請輸入補充事實或說明內容...";
  textGroup.appendChild(textLabel);
  textGroup.appendChild(textInput);
  modal.appendChild(textGroup);

  var urlGroup = document.createElement("div");
  urlGroup.style.cssText = "margin-bottom:12px;";
  var urlLabel = document.createElement("label");
  urlLabel.style.cssText = "display:block;font-weight:bold;margin-bottom:4px;font-size:0.9em;";
  urlLabel.textContent = "來源網址 URL（選填）：";
  var urlInput = document.createElement("input");
  urlInput.type = "url";
  urlInput.style.cssText = "width:100%;padding:8px;box-sizing:border-box;border:1px solid #ccc;border-radius:4px;";
  urlInput.placeholder = "https://example.com/source";
  urlGroup.appendChild(urlLabel);
  urlGroup.appendChild(urlInput);
  modal.appendChild(urlGroup);

  var fileGroup = document.createElement("div");
  fileGroup.style.cssText = "margin-bottom:12px;";
  var fileLabel = document.createElement("label");
  fileLabel.style.cssText = "display:block;font-weight:bold;margin-bottom:4px;font-size:0.9em;";
  fileLabel.textContent = "上傳檔案附件（文字/Markdown/JSON，選填）：";
  var fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.style.cssText = "display:block;";
  fileGroup.appendChild(fileLabel);
  fileGroup.appendChild(fileInput);
  modal.appendChild(fileGroup);

  var rationaleGroup = document.createElement("div");
  rationaleGroup.style.cssText = "margin-bottom:16px;";
  var rationaleLabel = document.createElement("label");
  rationaleLabel.style.cssText = "display:block;font-weight:bold;margin-bottom:4px;font-size:0.9em;";
  rationaleLabel.textContent = "確認理由 (Rationale)：";
  var rationaleInput = document.createElement("input");
  rationaleInput.type = "text";
  rationaleInput.value = "提供補充資料證據。";
  rationaleInput.style.cssText = "width:100%;padding:8px;box-sizing:border-box;border:1px solid #ccc;border-radius:4px;";
  rationaleGroup.appendChild(rationaleLabel);
  rationaleGroup.appendChild(rationaleInput);
  modal.appendChild(rationaleGroup);

  var actionRow = document.createElement("div");
  actionRow.style.cssText = "display:flex;justify-content:flex-end;gap:8px;";

  var cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.textContent = "取消";
  cancelBtn.style.cssText = "padding:8px 16px;border:1px solid #ccc;background:#fff;border-radius:4px;cursor:pointer;";
  cancelBtn.addEventListener("click", function () { overlay.remove(); });
  actionRow.appendChild(cancelBtn);

  var submitBtn = document.createElement("button");
  submitBtn.type = "button";
  submitBtn.textContent = "確認並提交補充資料";
  submitBtn.style.cssText = "padding:8px 16px;border:none;background:#0066cc;color:#fff;border-radius:4px;cursor:pointer;font-weight:bold;";

  submitBtn.addEventListener("click", function () {
    var textVal = textInput.value.trim();
    var urlVal = urlInput.value.trim();
    var rationaleVal = rationaleInput.value.trim();
    var hasFile = fileInput.files && fileInput.files.length > 0;

    if (!textVal && !urlVal && !hasFile) {
      errBox.textContent = "請至少提供補充文字、URL 或上傳附件其中一項。";
      errBox.style.display = "block";
      return;
    }

    if (!rationaleVal) {
      errBox.textContent = "請填寫確認理由。";
      errBox.style.display = "block";
      return;
    }

    errBox.style.display = "none";
    submitBtn.disabled = true;
    submitBtn.textContent = "處理中...";

    var processSubmission = function (attachmentsPayload) {
      postJson("/workspace/coverage/resolution/confirm", {
        assessment_id: assessment.id,
        assessment_revision: assessment.revision,
        requirement_id: cell.requirement_id,
        ...(cell.character_id === undefined ? {} : { character_id: cell.character_id }),
        action: "user_supplement",
        choice: rationaleVal,
        rationale: rationaleVal,
      }).then(function () {
        var suppBody = {
          assessment_id: assessment.id,
          assessment_revision: assessment.revision,
          requirement_id: cell.requirement_id,
          ...(cell.character_id === undefined ? {} : { character_id: cell.character_id }),
          ...(textVal ? { text: textVal } : {}),
          ...(urlVal ? { url: urlVal } : {}),
          ...(attachmentsPayload ? { attachments: attachmentsPayload } : {}),
        };
        return postJson("/workspace/coverage/supplement", suppBody);
      }).then(function (result) {
        overlay.remove();
        renderMutationInvalidation(result.downstream_invalidation);
        setCoverageNotice("已成功提交補充資料（來源 ID: " + (result.source_id || "建立中") + "，分片數: " + (result.chunk_count || 0) + "）。" + (result.next_step ? " " + result.next_step : ""));
        void loadCoverageCenterData();
        void refreshWorkflowViews();
      }).catch(function (error) {
        submitBtn.disabled = false;
        submitBtn.textContent = "確認並提交補充資料";
        errBox.textContent = "提交失敗：" + (error && error.message ? error.message : String(error));
        errBox.style.display = "block";
      });
    };

    if (hasFile) {
      var file = fileInput.files[0];
      var reader = new FileReader();
      reader.onload = function (e) {
        var arrayBuffer = e.target.result;
        var bytes = new Uint8Array(arrayBuffer);
        var binaryStr = "";
        for (var i = 0; i < bytes.byteLength; i++) {
          binaryStr += String.fromCharCode(bytes[i]);
        }
        var base64 = window.btoa(binaryStr);
        processSubmission([{ name: file.name, content: base64, media_type: file.type || "text/plain" }]);
      };
      reader.onerror = function () {
        submitBtn.disabled = false;
        submitBtn.textContent = "確認並提交補充資料";
        errBox.textContent = "讀取附件檔案失敗。";
        errBox.style.display = "block";
      };
      reader.readAsArrayBuffer(file);
    } else {
      processSubmission(null);
    }
  });

  actionRow.appendChild(submitBtn);
  modal.appendChild(actionRow);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
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
    if (action === "user_supplement") {
      openSupplementDialog(cell, preview);
      return;
    }
    var msgEl = byId("coverage-center-message") || byId("coverage-message");
    if (msgEl) {
      msgEl.textContent = (preview.consequences || []).join("；");
      var confirmButton = coverageButton("確認創作補全", function () {
        var choice = window.prompt("請輸入確認理由：", "使用者授權創作補全。");
        if (choice === null || choice.trim() === "") { setCoverageNotice("已取消確認。"); return; }
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
          setCoverageNotice("已確認 resolution。");
          void loadCoverageCenterData();
          void refreshWorkflowViews();
        }).catch(function (error) {
          setCoverageError(error);
        });
      });
      msgEl.appendChild(confirmButton);
    }
  }).catch(function (error) {
    setCoverageError(error);
  });
}

// Compatibility alias for /workspace/dashboard/coverage
async function loadCoverageData() {
  return loadCoverageCenterData();
}

function renderCellActionButton(cell, actionOpt) {
  var button = document.createElement("button");
  button.type = "button";
  button.textContent = actionOpt.label;
  button.setAttribute("data-cell-id", (cell.character_id || "world") + "__" + cell.requirement_id);
  button.setAttribute("data-scope", cell.scope || (cell.character_id ? "character" : "world"));
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
      startCoverageResearch(cell, false);
    } else if (actionOpt.action === "revise_query") {
      openRecoveryDialog(cell, "revise_query");
    } else if (actionOpt.action === "revise_constraints") {
      openRecoveryDialog(cell, "revise_constraints");
    } else if (actionOpt.action === "manual_url") {
      openRecoveryDialog(cell, "manual_url");
    } else if (actionOpt.action === "supplement") {
      previewCoverageResolution(cell, "user_supplement");
    } else if (actionOpt.action === "creative_completion") {
      previewCoverageResolution(cell, "creative_completion");
    } else if (actionOpt.action === "reassess") {
      switchPanel("coverage");
    } else if (actionOpt.action === "view_research_task") {
      var targetTaskId = actionOpt.target_task_id || (actionOpt.prerequisite ? actionOpt.prerequisite.target_id : null);
      if (actionOpt.prerequisite && actionOpt.prerequisite.target_panel) {
        switchPanel(actionOpt.prerequisite.target_panel);
      }
      if (targetTaskId) {
        var targetEl = byId("research-task-" + targetTaskId) || document.querySelector('[data-task-id="' + targetTaskId + '"]');
        if (targetEl) {
          targetEl.scrollIntoView({ behavior: "smooth", block: "center" });
          targetEl.style.outline = "2px solid #0066cc";
          setTimeout(function () { targetEl.style.outline = ""; }, 2000);
        }
      }
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
  row.id = coverageCellId(cell.character_id, cell.requirement_id);
  row.setAttribute("data-cell-id", (cell.character_id || "world") + "__" + cell.requirement_id);
  row.setAttribute("data-scope", cell.scope || (cell.character_id ? "character" : "world"));
  if (cell.character_id) row.setAttribute("data-character-id", cell.character_id);
  row.setAttribute("data-requirement-id", cell.requirement_id);
  if (cell.assessment_id) row.setAttribute("data-assessment-id", cell.assessment_id);
  if (cell.assessment_revision) row.setAttribute("data-assessment-revision", cell.assessment_revision);
  row.setAttribute("data-status", cell.status);

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
  if (cell.research_task_ids && cell.research_task_ids.length > 0) detailParts.push("當前任務 " + cell.research_task_ids.length);
  details.textContent = detailParts.join(" · ");
  row.appendChild(details);

  var taskList = document.createElement("div");
  taskList.className = "muted";
  var taskParts = [];
  var currentTasks = cell.current_research_tasks || [];
  if (currentTasks.length > 0) {
    currentTasks.forEach(function (task) {
      var stat = task.status;
      var reasonText = task.exhausted_reason ? ("（" + task.exhausted_reason + "）") : "";
      taskParts.push("當前任務 " + task.id.slice(0, 8) + " " + stat + reasonText);
    });
  } else {
    (cell.research_task_ids || []).forEach(function (taskId) {
      taskParts.push("任務 " + taskId.slice(0, 8));
    });
  }
  taskList.textContent = taskParts.join("；");
  row.appendChild(taskList);

  if (cell.history_research_tasks && cell.history_research_tasks.length > 0) {
    var historyDiv = document.createElement("div");
    historyDiv.style.cssText = "font-size:0.85em;color:#666;background:#fafafa;border:1px dashed #ddd;padding:4px 8px;margin-top:6px;border-radius:4px;";
    var hList = cell.history_research_tasks.map(function (ht) {
      return "任務 " + ht.id.slice(0, 8) + " (" + ht.status + ", rev " + ht.assessment_revision.slice(0, 6) + ")";
    });
    historyDiv.textContent = "歷史任務 (" + cell.history_research_tasks.length + ")：" + hList.join("；");
    row.appendChild(historyDiv);
  }

  var actions = document.createElement("div");
  actions.className = "coverage-actions";
  if (cell.typed_actions && cell.typed_actions.length > 0) {
    cell.typed_actions.forEach(function (opt) {
      actions.appendChild(renderCellActionButton(cell, opt));
    });
  } else {
    (cell.actions || []).forEach(function (action) {
      if (action === "research") {
        actions.appendChild(coverageButton("來源研究", function () { startCoverageResearch(cell, false); }));
      }
      if (action === "revise_query") {
        actions.appendChild(coverageButton("修改查詢", function () { openRecoveryDialog(cell, "revise_query"); }));
      }
      if (action === "revise_constraints") {
        actions.appendChild(coverageButton("修改來源限制", function () { openRecoveryDialog(cell, "revise_constraints"); }));
      }
      if (action === "manual_url") {
        actions.appendChild(coverageButton("手動提供 URL", function () { openRecoveryDialog(cell, "manual_url"); }));
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
  if (payload === null || payload.matrix === null || payload.matrix === undefined) {
    setCoverageNotice("尚未取得覆蓋矩陣資料。");
    return;
  }
  var matrix = payload.matrix;
  var msgText = "";
  if (matrix.assessment !== undefined) {
    msgText = "評估 " + matrix.assessment.id + "@" + matrix.assessment.revision.slice(0, 8) + "（" + matrix.assessment.pass + (matrix.assessment.fresh ? "、輸入仍新鮮" : "、輸入已過期") + "）";
    if (matrix.assessment.eligibility_reason) {
      msgText += " · " + matrix.assessment.eligibility_reason;
    }
    if (matrix.stale_components && matrix.stale_components.length > 0) {
      msgText += " · 失效元件：" + matrix.stale_components.join(", ");
    }
  } else {
    msgText = "目前沒有覆蓋評估資料；請先完成來源處理與正式評估。";
  }
  setCoverageNotice(msgText);
  var heading = document.createElement("div");
  heading.className = "coverage-center-heading";
  var headingParts = [];
  if (matrix.assessment !== undefined) {
    headingParts.push("評估 " + matrix.assessment.id + "@" + matrix.assessment.revision.slice(0, 8) + "（" + matrix.assessment.pass + (matrix.assessment.fresh ? "、輸入仍新鮮" : "、輸入已過期") + "）");
    if (matrix.assessment.actionable !== undefined) {
      headingParts.push(matrix.assessment.actionable ? "可操作" : "不可操作");
    }
    if (matrix.assessment.eligibility_reason) {
      headingParts.push(matrix.assessment.eligibility_reason);
    }
  }
  if (matrix.requirement_set !== undefined) {
    headingParts.push("requirement set " + matrix.requirement_set.revision.slice(0, 8));
  }
  if (matrix.stale_components && matrix.stale_components.length > 0) {
    headingParts.push("失效元件：" + matrix.stale_components.join(", "));
  }
  heading.textContent = headingParts.join(" · ");
  container.appendChild(heading);

  var topBar = document.createElement("div");
  topBar.style.cssText = "margin-bottom:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;";
  var wideResearch = matrix.assessment_wide_research;
  var allResearchBtn = coverageButton("", function () {
    startCoverageResearch(null, true);
  });
  if (wideResearch !== null && wideResearch !== undefined && wideResearch.enabled) {
    allResearchBtn.textContent = "啟動全量缺口研究 (" + wideResearch.target_count + " 個缺口)";
    allResearchBtn.style.cssText = "padding:6px 14px;background:#0066cc;color:#fff;border:none;border-radius:4px;cursor:pointer;font-weight:bold;";
  } else {
    allResearchBtn.textContent = "全量缺口研究";
    allResearchBtn.disabled = true;
    allResearchBtn.title = wideResearch !== null && wideResearch !== undefined && wideResearch.disabled_reason ? wideResearch.disabled_reason : "目前不具備全量研究資格";
    allResearchBtn.style.cssText = "padding:6px 14px;background:#b0b8c0;color:#fff;border:none;border-radius:4px;font-weight:bold;";
  }
  topBar.appendChild(allResearchBtn);
  if (wideResearch !== null && wideResearch !== undefined && !wideResearch.enabled && wideResearch.disabled_reason) {
    var wideReason = document.createElement("span");
    wideReason.className = "muted";
    wideReason.textContent = wideResearch.disabled_reason;
    topBar.appendChild(wideReason);
  }
  container.appendChild(topBar);

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
  row.id = "research-task-" + task.id;
  row.setAttribute("data-task-id", task.id);
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

