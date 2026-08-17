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
    var modalHandle = createAccessibleModal({
      id: "research-start-modal-overlay",
      titleText: isAssessmentWide ? "啟動全量缺口研究" : ("啟動研究 — " + coverageCellTitle(cell)),
      initialFocusSelector: 'button[type="button"].primary, button:not([disabled])'
    });
    var modal = modalHandle.modal;

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
    cancelBtn.addEventListener("click", function () { modalHandle.close({ cancelled: true }); });
    actionRow.appendChild(cancelBtn);

    var submitBtn = document.createElement("button");
    submitBtn.type = "button";
    submitBtn.className = "primary";
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
        modalHandle.close();
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
    document.body.appendChild(modalHandle.overlay);
    modalHandle.focusFirst();
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

  var actionLabels = {
    revise_query: "修改查詢 (Revise Query)",
    revise_constraints: "修改來源限制 (Revise Constraints)",
    manual_url: "手動提供 URL (Manual URL)",
    supplement: "提供補充資料 (User Supplement)",
    creative_completion: "授權創作補全 (Creative Completion)",
  };

  var modalHandle = createAccessibleModal({
    id: "recovery-modal-overlay",
    titleText: "任務恢復 — " + (actionLabels[action] || action) + " — " + coverageCellTitle(cell),
    initialFocusSelector: "select, input, textarea"
  });
  var modal = modalHandle.modal;

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
  cancelBtn.addEventListener("click", function () { modalHandle.close({ cancelled: true }); });
  actionRow.appendChild(cancelBtn);

  var submitBtn = document.createElement("button");
  submitBtn.type = "button";
  submitBtn.className = "primary";
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
        modalHandle.close();
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
  document.body.appendChild(modalHandle.overlay);
  modalHandle.focusFirst();
}

function openSupplementDialog(cell, preview) {
  var assessment = coverageAssessmentRef();
  if (assessment === undefined) return;

  var opId = "op-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  var lifecycle = cell.supplement_lifecycle;
  var pendingResId = lifecycle ? lifecycle.current_resolution_id : undefined;

  var modalHandle = createAccessibleModal({
    id: "supplement-modal-overlay",
    titleText: (pendingResId ? "繼續補充資料 — " : "提供補充資料 — ") + coverageCellTitle(cell),
    initialFocusSelector: "textarea, input, select"
  });
  var modal = modalHandle.modal;

  var previewBox = document.createElement("div");
  previewBox.style.cssText = "background:#f8f9fa;border-left:4px solid #0066cc;padding:10px 14px;margin-bottom:16px;font-size:0.9em;color:#333;";
  previewBox.textContent = pendingResId
    ? "此需求已有已確認之決策授權，本次提交將直接上傳補充資料並綁定至既有決策。"
    : "操作預期影響：" + ((preview && preview.consequences) ? preview.consequences.join("；") : "確認提供補充資料後，系統將記錄決策並進行來源分片與事實提煉。");
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

  var rationaleInput = null;
  if (!pendingResId) {
    var rationaleGroup = document.createElement("div");
    rationaleGroup.style.cssText = "margin-bottom:16px;";
    var rationaleLabel = document.createElement("label");
    rationaleLabel.style.cssText = "display:block;font-weight:bold;margin-bottom:4px;font-size:0.9em;";
    rationaleLabel.textContent = "決策與確認理由 (Rationale)：";
    rationaleInput = document.createElement("input");
    rationaleInput.type = "text";
    rationaleInput.value = "提供補充資料證據。";
    rationaleInput.style.cssText = "width:100%;padding:8px;box-sizing:border-box;border:1px solid #ccc;border-radius:4px;";
    rationaleGroup.appendChild(rationaleLabel);
    rationaleGroup.appendChild(rationaleInput);
    modal.appendChild(rationaleGroup);
  }

  var actionRow = document.createElement("div");
  actionRow.style.cssText = "display:flex;justify-content:flex-end;gap:8px;";

  var cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.textContent = "取消";
  cancelBtn.style.cssText = "padding:8px 16px;border:1px solid #ccc;background:#fff;border-radius:4px;cursor:pointer;";
  cancelBtn.addEventListener("click", function () { modalHandle.close({ cancelled: true }); });
  actionRow.appendChild(cancelBtn);

  var submitBtn = document.createElement("button");
  submitBtn.type = "button";
  submitBtn.className = "primary";
  submitBtn.textContent = pendingResId ? "確認並繼續提交補充資料" : "確認並提交補充資料";
  submitBtn.style.cssText = "padding:8px 16px;border:none;background:#0066cc;color:#fff;border-radius:4px;cursor:pointer;font-weight:bold;";

  submitBtn.addEventListener("click", function () {
    var textVal = textInput.value.trim();
    var urlVal = urlInput.value.trim();
    var rationaleVal = rationaleInput ? rationaleInput.value.trim() : "";
    var hasFile = fileInput.files && fileInput.files.length > 0;

    if (!textVal && !urlVal && !hasFile) {
      errBox.textContent = "請至少提供補充文字、URL 或上傳附件其中一項。";
      errBox.style.display = "block";
      return;
    }

    if (!pendingResId && !rationaleVal) {
      errBox.textContent = "請填寫確認理由。";
      errBox.style.display = "block";
      return;
    }

    errBox.style.display = "none";
    submitBtn.disabled = true;
    submitBtn.textContent = "處理中...";

    var processSubmission = function (attachmentsPayload) {
      var suppBody = {
        assessment_id: assessment.id,
        assessment_revision: assessment.revision,
        requirement_id: cell.requirement_id,
        ...(cell.character_id === undefined ? {} : { character_id: cell.character_id }),
        operation_id: opId,
        ...(pendingResId ? { pending_resolution_id: pendingResId } : { choice: rationaleVal, rationale: rationaleVal }),
        ...(textVal ? { text: textVal } : {}),
        ...(urlVal ? { url: urlVal } : {}),
        ...(attachmentsPayload ? { attachments: attachmentsPayload } : {}),
      };

      postJson("/workspace/coverage/supplement", suppBody).then(function (result) {
        modalHandle.close();
        renderMutationInvalidation(result.downstream_invalidation);
        setCoverageNotice("已成功提交補充資料（來源 ID: " + (result.source_id || "建立中") + "，分片數: " + (result.chunk_count || 0) + "）。" + (result.next_step ? " " + result.next_step : ""));
        void loadCoverageCenterData();
        void refreshWorkflowViews();
      }).catch(function (error) {
        submitBtn.disabled = false;
        submitBtn.textContent = pendingResId ? "確認並繼續提交補充資料" : "確認並提交補充資料";
        errBox.textContent = "提交失敗（可直接點擊重試）：" + (error && error.message ? error.message : String(error));
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
        submitBtn.textContent = pendingResId ? "確認並繼續提交補充資料" : "確認並提交補充資料";
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
  document.body.appendChild(modalHandle.overlay);
  modalHandle.focusFirst();
}

function openCreativeCompletionDialog(cell, preview) {
  var assessment = coverageAssessmentRef();
  if (assessment === undefined) return;

  var operationId = typeof generateIdempotencyKey === "function" ? generateIdempotencyKey() : ("op-creative-" + Date.now());

  var modalHandle = createAccessibleModal({
    id: "creative-modal-overlay",
    titleId: "creative-modal-title",
    dialogClass: "dialog-modal",
    initialFocusSelector: "input.dialog-input, textarea"
  });
  var modal = modalHandle.modal;

  var title = document.createElement("h3");
  title.id = "creative-modal-title";
  title.textContent = "創作補全授權（Creative Completion）";
  modal.appendChild(title);

  var warnBox = document.createElement("div");
  warnBox.className = "creative-warning-box";
  warnBox.textContent = "重要聲明：Creative Completion 是創作授權，不是 source-backed evidence，也不會建立來源佐證。";
  modal.appendChild(warnBox);

  var infoSection = document.createElement("div");
  infoSection.id = "creative-modal-desc";
  infoSection.className = "creative-info-section";

  var scopeText = cell.character_id ? ("角色：" + cell.character_id) : "世界（World）";
  var reqText = (cell.requirement_label || cell.requirement_id) + " (" + cell.requirement_id + ")";
  var statusText = cell.status || "未覆蓋";
  var assessText = assessment.id + "@" + (assessment.revision ? assessment.revision.slice(0, 8) : "");

  var dl = document.createElement("dl");
  dl.className = "creative-meta-dl";
  function addMetaRow(term, val) {
    var dt = document.createElement("dt");
    dt.textContent = term;
    var dd = document.createElement("dd");
    dd.textContent = val;
    dl.appendChild(dt);
    dl.appendChild(dd);
  }
  addMetaRow("目標範圍：", scopeText);
  addMetaRow("需求項目：", reqText);
  addMetaRow("目前狀態：", statusText);
  addMetaRow("評估版本：", assessText);
  infoSection.appendChild(dl);

  if (Array.isArray(preview.consequences) && preview.consequences.length > 0) {
    var conHeader = document.createElement("div");
    conHeader.className = "consequences-header";
    conHeader.textContent = "預期影響：";
    var conList = document.createElement("ul");
    conList.className = "consequences-list";
    for (var c = 0; c < preview.consequences.length; c += 1) {
      var li = document.createElement("li");
      li.textContent = preview.consequences[c];
      conList.appendChild(li);
    }
    infoSection.appendChild(conHeader);
    infoSection.appendChild(conList);
  }
  modal.appendChild(infoSection);

  var form = document.createElement("div");
  form.className = "creative-form";

  var choiceLabel = document.createElement("label");
  choiceLabel.textContent = "創作授權決策（必填）：";
  var choiceInput = document.createElement("input");
  choiceInput.type = "text";
  choiceInput.className = "dialog-input";
  choiceInput.value = "授權創作補全設定";
  choiceInput.placeholder = "請輸入授權決策內容…";
  choiceLabel.appendChild(choiceInput);
  form.appendChild(choiceLabel);

  var rationaleLabel = document.createElement("label");
  rationaleLabel.textContent = "授權理由（必填）：";
  var rationaleInput = document.createElement("textarea");
  rationaleInput.className = "dialog-textarea";
  rationaleInput.rows = 3;
  rationaleInput.value = "多方搜尋無官方佐證來源，依既有設定合理推導補全。";
  rationaleInput.placeholder = "請輸入授權依據與理由…";
  rationaleLabel.appendChild(rationaleInput);
  form.appendChild(rationaleLabel);

  var errBox = document.createElement("div");
  errBox.className = "dialog-error";
  errBox.setAttribute("aria-live", "polite");
  errBox.style.display = "none";
  form.appendChild(errBox);

  modal.appendChild(form);

  var actionRow = document.createElement("div");
  actionRow.className = "dialog-actions";

  var cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.textContent = "取消";
  cancelBtn.className = "btn-secondary";
  cancelBtn.addEventListener("click", function () { modalHandle.close({ cancelled: true }); });
  actionRow.appendChild(cancelBtn);

  var submitBtn = document.createElement("button");
  submitBtn.type = "button";
  submitBtn.textContent = "確認創作補全授權";
  submitBtn.className = "btn-primary";

  submitBtn.addEventListener("click", async function () {
    var choiceVal = choiceInput.value ? choiceInput.value.trim() : "";
    var rationaleVal = rationaleInput.value ? rationaleInput.value.trim() : "";

    if (!choiceVal || !rationaleVal) {
      errBox.textContent = "「創作授權決策」與「授權理由」皆為必填欄位，不得為空。";
      errBox.style.display = "block";
      return;
    }

    errBox.style.display = "none";
    submitBtn.disabled = true;
    cancelBtn.disabled = true;
    submitBtn.textContent = "提交授權中…";

    try {
      var result = await postJson("/workspace/coverage/resolution/confirm", {
        assessment_id: assessment.id,
        assessment_revision: assessment.revision,
        requirement_id: cell.requirement_id,
        ...(cell.character_id === undefined ? {} : { character_id: cell.character_id }),
        action: "creative_completion",
        choice: choiceVal,
        rationale: rationaleVal,
        operation_id: operationId,
      });

      modalHandle.close();
      setCoverageNotice("已成功確認創作補全授權。");
      renderMutationInvalidation(result.downstream_invalidation);
      await loadCoverageCenterData();
      await refreshWorkflowViews();
      if (typeof triggerCheckReadiness === "function") {
        void triggerCheckReadiness();
      }
    } catch (error) {
      cancelBtn.disabled = false;
      submitBtn.disabled = false;
      submitBtn.textContent = "重新提交授權";
      var errMsg = error ? (error.message || String(error)) : "授權提交失敗";
      if (errMsg.indexOf("STALE") >= 0 || errMsg.indexOf("過期") >= 0) {
        errBox.textContent = "評估已過期，無法以舊版本授權創作補全。請重新執行 Coverage 評估。";
        submitBtn.style.display = "none";
        var reloadBtn = document.createElement("button");
        reloadBtn.type = "button";
        reloadBtn.textContent = "重新載入覆蓋中心";
        reloadBtn.className = "btn-primary";
        reloadBtn.addEventListener("click", function () {
          modalHandle.close();
          void loadCoverageCenterData();
        });
        actionRow.appendChild(reloadBtn);
      } else {
        errBox.textContent = "授權失敗：" + errMsg;
      }
      errBox.style.display = "block";
    }
  });

  actionRow.appendChild(submitBtn);
  modal.appendChild(actionRow);
  document.body.appendChild(modalHandle.overlay);
  modalHandle.focusFirst();
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
    if (action === "creative_completion") {
      openCreativeCompletionDialog(cell, preview);
      return;
    }
    var msgEl = byId("coverage-center-message") || byId("coverage-message");
    if (msgEl) {
      msgEl.textContent = (preview.consequences || []).join("；");
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
  var cellId = (cell.character_id || "world") + "__" + cell.requirement_id;
  button.setAttribute("data-cell-id", cellId);
  button.setAttribute("data-scope", cell.scope || (cell.character_id ? "character" : "world"));
  if (cell.character_id) button.setAttribute("data-character-id", cell.character_id);
  button.setAttribute("data-requirement-id", cell.requirement_id);
  if (cell.assessment_id) button.setAttribute("data-assessment-id", cell.assessment_id);
  if (cell.assessment_revision) button.setAttribute("data-assessment-revision", cell.assessment_revision);
  button.setAttribute("data-action", actionOpt.action);

  if (!actionOpt.enabled) {
    button.disabled = true;
    button.setAttribute("aria-disabled", "true");
    button.setAttribute("data-domain-disabled", "true");
    var descId = "desc-" + cellId + "-" + actionOpt.action;
    var reason = actionOpt.disabled_reason || (cell.missing_prerequisite ? "前置需求：" + cell.missing_prerequisite : "");
    if (reason) {
      button.title = reason;
      button.setAttribute("data-disabled-reason", reason);
      button.setAttribute("aria-describedby", descId);
    }
  }

  button.addEventListener("click", function () {
    if (!actionOpt.enabled) {
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
        var targetEl = typeof byId === "function" ? byId("research-task-" + targetTaskId) : null;
        if (!targetEl && typeof document !== "undefined" && document.querySelector) {
          targetEl = document.querySelector('[data-task-id="' + targetTaskId + '"]');
        }
        if (targetEl && targetEl.scrollIntoView) {
          targetEl.scrollIntoView({ behavior: typeof reducedMotion === "function" && reducedMotion() ? "auto" : "smooth", block: "center" });
          if (targetEl.style) targetEl.style.outline = "2px solid #0066cc";
          setTimeout(function () { if (targetEl && targetEl.style) targetEl.style.outline = ""; }, 2000);
        }
      }
    } else if (actionOpt.action === "view_details") {
      if (actionOpt.prerequisite && actionOpt.prerequisite.target_panel) {
        switchPanel(actionOpt.prerequisite.target_panel);
      }
    }
  });

  if (actionOpt.enabled) {
    return button;
  }

  var container = document.createElement("span");
  container.className = "cell-action-item";
  container.appendChild(button);

  var targetPanel = (actionOpt.prerequisite && actionOpt.prerequisite.target_panel) || (actionOpt.action === "reassess" ? "coverage" : "coverage");
  var prereqLabel = (actionOpt.prerequisite && actionOpt.prerequisite.label) || (actionOpt.prerequisite && actionOpt.prerequisite.reason) || actionOpt.disabled_reason || "前置需求未達成";

  var remedyBtn = document.createElement("button");
  remedyBtn.type = "button";
  remedyBtn.className = "action-link prerequisite-nav-btn";
  remedyBtn.setAttribute("data-target-panel", targetPanel);
  remedyBtn.setAttribute("aria-label", "前往處理前置需求：" + prereqLabel);
  remedyBtn.textContent = "解決前置：" + (actionOpt.prerequisite && actionOpt.prerequisite.label ? actionOpt.prerequisite.label : (actionOpt.disabled_reason ? actionOpt.disabled_reason.slice(0, 20) : "前置需求"));
  remedyBtn.addEventListener("click", function () {
    if (actionOpt.prerequisite && actionOpt.prerequisite.target_panel) {
      switchPanel(actionOpt.prerequisite.target_panel);
    } else {
      switchPanel(targetPanel);
    }
    var targetId = actionOpt.target_task_id || (actionOpt.prerequisite ? actionOpt.prerequisite.target_id : null);
    if (targetId) {
      var el = (typeof byId === "function" ? byId("research-task-" + targetId) : null) ||
        (typeof document !== "undefined" && document.querySelector ? document.querySelector('[data-task-id="' + targetId + '"]') : null) ||
        (typeof byId === "function" ? byId(targetId) : null);
      if (el && el.scrollIntoView) {
        el.scrollIntoView({ behavior: typeof reducedMotion === "function" && reducedMotion() ? "auto" : "smooth", block: "center" });
        if (el.style) el.style.outline = "2px solid #0066cc";
        setTimeout(function () { if (el && el.style) el.style.outline = ""; }, 2000);
      }
    }
  });

  var descSpan = document.createElement("span");
  descSpan.id = "desc-" + cellId + "-" + actionOpt.action;
  descSpan.className = "prerequisite-desc sr-only";
  descSpan.textContent = "此操作目前已停用。原因：" + (actionOpt.disabled_reason || prereqLabel);

  container.appendChild(remedyBtn);
  container.appendChild(descSpan);

  return container;
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

  if (cell.supplement_lifecycle) {
    var sl = cell.supplement_lifecycle;
    var lifeDiv = document.createElement("div");
    lifeDiv.style.cssText = "font-size:0.85em;background:#f0f7ff;border:1px solid #cce5ff;padding:6px 10px;margin-top:6px;border-radius:4px;color:#004085;";

    var stageLine = document.createElement("div");
    stageLine.style.cssText = "font-weight:bold;margin-bottom:2px;";
    stageLine.textContent = "補件生命週期：階段 [" + sl.stage + "] · 狀態 [" + sl.stage_status + "]" + (sl.requires_attention ? " · 需要處理" : "");
    lifeDiv.appendChild(stageLine);

    if (sl.next_action) {
      var nextLine = document.createElement("div");
      nextLine.textContent = "下一步：" + sl.next_action;
      lifeDiv.appendChild(nextLine);
    }

    if (sl.failure_message) {
      var failLine = document.createElement("div");
      failLine.style.cssText = "color:#721c24;font-weight:bold;margin-top:2px;";
      failLine.textContent = "失敗診斷：" + sl.failure_message + (sl.authorization_saved ? "（授權決策已保存，可直接繼續補件）" : "");
      lifeDiv.appendChild(failLine);
    }

    if (sl.current_attempt) {
      var curLine = document.createElement("div");
      curLine.style.cssText = "margin-top:2px;color:#555;";
      curLine.textContent = "當前補件嘗試：" + sl.current_attempt.attempt_id.slice(0, 8) + " (" + sl.current_attempt.stage + ", " + sl.current_attempt.status + ")";
      lifeDiv.appendChild(curLine);
    }

    if (sl.historical_attempts && sl.historical_attempts.length > 0) {
      var histLine = document.createElement("div");
      histLine.style.cssText = "margin-top:2px;color:#777;";
      var hStrs = sl.historical_attempts.map(function (ha) {
        return ha.attempt_id.slice(0, 8) + " (" + ha.stage + ", " + ha.status + ")";
      });
      histLine.textContent = "歷史補件嘗試 (" + sl.historical_attempts.length + ")：" + hStrs.join("；");
      lifeDiv.appendChild(histLine);
    }

    row.appendChild(lifeDiv);
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
    allResearchBtn.disabled = false;
    allResearchBtn.removeAttribute("data-domain-disabled");
    allResearchBtn.removeAttribute("aria-disabled");
  } else {
    allResearchBtn.textContent = "全量缺口研究";
    allResearchBtn.disabled = true;
    allResearchBtn.setAttribute("data-domain-disabled", "true");
    allResearchBtn.setAttribute("aria-disabled", "true");
    var wideReasonText = wideResearch !== null && wideResearch !== undefined && wideResearch.disabled_reason ? wideResearch.disabled_reason : "目前不具備全量研究資格";
    allResearchBtn.title = wideReasonText;
    allResearchBtn.setAttribute("data-disabled-reason", wideReasonText);
    allResearchBtn.setAttribute("aria-describedby", "wide-research-desc");
    allResearchBtn.style.cssText = "padding:6px 14px;background:#b0b8c0;color:#fff;border:none;border-radius:4px;font-weight:bold;";
  }
  topBar.appendChild(allResearchBtn);
  if (wideResearch !== null && wideResearch !== undefined && !wideResearch.enabled && wideResearch.disabled_reason) {
    var wideReason = document.createElement("span");
    wideReason.id = "wide-research-desc";
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

function openTaskContextModal(task) {
  var modalHandle = createAccessibleModal({
    id: "task-context-modal-overlay",
    titleId: "task-context-title",
    dialogClass: "dialog-modal",
    initialFocusSelector: "button"
  });
  var modal = modalHandle.modal;
  modal.setAttribute("aria-describedby", "task-context-desc");

  var title = document.createElement("h3");
  title.id = "task-context-title";
  title.textContent = "研究任務上下文（Task " + task.id + "）";
  modal.appendChild(title);

  var desc = document.createElement("div");
  desc.id = "task-context-desc";
  desc.className = "task-context-desc";

  var originLabelMap = {
    newly_created: "新建立（Newly-created）",
    reused_existing: "既有重用（Reused-existing）",
    successor_recovery: "修復衍生（Successor-recovery）",
    legacy_unknown: "歷史紀錄（Legacy-unknown）",
  };

  var dl = document.createElement("dl");
  dl.className = "task-context-dl";

  var inFlightText = task.is_in_flight ? "進行中（In-flight）" : "歷史紀錄／已終止（Terminal history）";
  var originText = originLabelMap[task.origin_kind] || task.origin_kind || "未知";

  function addRow(term, val) {
    var dt = document.createElement("dt");
    dt.textContent = term;
    var dd = document.createElement("dd");
    dd.textContent = val;
    dl.appendChild(dt);
    dl.appendChild(dd);
  }

  addRow("任務 ID：", task.id);
  addRow("所屬批次：", task.batch_id);
  addRow("目標範圍：", task.character_id ? ("角色：" + task.character_id) : "世界（World）");
  addRow("狀態：", task.projected_status || task.status);
  addRow("執行狀態：", inFlightText);
  addRow("任務來源：", originText);
  addRow("嘗試次數 / 認領世代：", "attempt " + task.attempt + " / generation " + task.claim_generation);

  if (task.requirement_ids && task.requirement_ids.length > 0) {
    addRow("涵蓋需求：", task.requirement_ids.join(", "));
  }
  if (task.dimension_paths && task.dimension_paths.length > 0) {
    addRow("維度路徑：", task.dimension_paths.join(", "));
  }
  if (task.exhausted_reason) {
    addRow("耗盡原因：", task.exhausted_reason);
  }
  if (task.recovery_action) {
    addRow("修復動作：", task.recovery_action);
  }
  if (task.predecessor_id) {
    addRow("前身任務：", task.predecessor_id);
  }
  if (task.successor_ids && task.successor_ids.length > 0) {
    addRow("後續任務：", task.successor_ids.join(", "));
  }
  if (task.candidate_source_ids && task.candidate_source_ids.length > 0) {
    addRow("候選 / 來源：", task.candidate_source_ids.join(", "));
  }
  desc.appendChild(dl);

  var opSection = document.createElement("div");
  opSection.className = "task-context-ops";
  var opTitle = document.createElement("h4");
  opTitle.textContent = "關聯 Operations 與 Audit Events";
  opSection.appendChild(opTitle);

  if (Array.isArray(task.operation_ids) && task.operation_ids.length > 0) {
    var opList = document.createElement("div");
    opList.className = "task-op-list";
    for (var i = 0; i < task.operation_ids.length; i += 1) {
      var opId = task.operation_ids[i];
      var opItem = document.createElement("div");
      opItem.className = "task-op-item";
      var opLabel = document.createElement("span");
      opLabel.textContent = "Operation: " + opId;
      opItem.appendChild(opLabel);
      var jumpBtn = document.createElement("button");
      jumpBtn.type = "button";
      jumpBtn.className = "action-link";
      jumpBtn.textContent = "前往 Operations 面板並聚焦";
      jumpBtn.addEventListener("click", (function (targetOpId) {
        return function () {
          modalHandle.close();
          switchPanel("operations");
          void revealDiagnosticTarget({ kind: "operation", id: targetOpId, panel: "operations" });
        };
      })(opId));
      opItem.appendChild(jumpBtn);
      opList.appendChild(opItem);
    }
    opSection.appendChild(opList);
  } else {
    var noOp = document.createElement("div");
    noOp.className = "muted";
    noOp.textContent = "無直接關聯的進行中 Operation（可能為歷史或手動建立）。";
    opSection.appendChild(noOp);
  }

  if (Array.isArray(task.audit_event_ids) && task.audit_event_ids.length > 0) {
    var auditList = document.createElement("div");
    auditList.className = "task-audit-list muted";
    auditList.textContent = "Audit Events: " + task.audit_event_ids.join(", ");
    opSection.appendChild(auditList);
  }

  desc.appendChild(opSection);
  modal.appendChild(desc);

  var actionRow = document.createElement("div");
  actionRow.className = "dialog-actions";
  var closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.textContent = "關閉";
  closeBtn.className = "btn-secondary";
  closeBtn.addEventListener("click", function () { modalHandle.close(); });
  actionRow.appendChild(closeBtn);
  modal.appendChild(actionRow);
  document.body.appendChild(modalHandle.overlay);
  modalHandle.focusFirst();
}

function researchTaskElement(task) {
  var row = document.createElement("div");
  row.className = "workflow-stage research-task-stage";
  row.id = "research-task-" + task.id;
  row.setAttribute("data-object-kind", "research_task");
  row.setAttribute("data-object-id", task.id);
  row.setAttribute("data-task-id", task.id);

  var title = document.createElement("div");
  title.className = "workflow-stage-title";

  var projected = task.projected_status || task.status;
  var badge = document.createElement("span");
  badge.className = "status-badge " + statusClass(projected);
  badge.textContent = projected;
  title.appendChild(badge);

  var inFlightBadge = document.createElement("span");
  inFlightBadge.className = "status-badge " + (task.is_in_flight ? "active" : "inactive");
  inFlightBadge.textContent = task.is_in_flight ? "進行中" : "歷史";
  title.appendChild(inFlightBadge);

  if (task.origin_kind) {
    var originBadge = document.createElement("span");
    originBadge.className = "origin-badge origin-" + task.origin_kind;
    var originNames = {
      newly_created: "新建立",
      reused_existing: "既有重用",
      successor_recovery: "修復衍生",
      legacy_unknown: "歷史",
    };
    originBadge.textContent = originNames[task.origin_kind] || task.origin_kind;
    title.appendChild(originBadge);
  }

  var label = document.createElement("span");
  label.textContent = "任務 " + task.id + (task.character_id ? "（" + task.character_id + "）" : "（世界）");
  title.appendChild(label);

  var contextBtn = document.createElement("button");
  contextBtn.type = "button";
  contextBtn.className = "action-link";
  contextBtn.textContent = "查看上下文";
  contextBtn.addEventListener("click", function () {
    openTaskContextModal(task);
  });
  title.appendChild(contextBtn);

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
  if (task.recovery_action) metaParts.push("修復動作 " + task.recovery_action);
  if (task.predecessor_id) metaParts.push("前身 " + task.predecessor_id.slice(0, 8));
  if (task.successor_ids && task.successor_ids.length > 0) metaParts.push("後續 " + task.successor_ids.map(function (id) { return id.slice(0, 8); }).join(", "));
  if (task.candidate_source_ids && task.candidate_source_ids.length > 0) metaParts.push("候選/來源 " + task.candidate_source_ids.map(function (id) { return id.slice(0, 8); }).join(", "));
  meta.textContent = metaParts.join("；");
  row.appendChild(meta);
  return row;
}

function renderResearchLineages(lineages, tasks) {
  var section = document.createElement("div");
  section.className = "research-lineages-section";

  var heading = document.createElement("h4");
  heading.className = "lineages-title";
  heading.textContent = "需求研究血統圖（Research Lineage Chains）";
  section.appendChild(heading);

  var taskMap = {};
  if (Array.isArray(tasks)) {
    for (var t = 0; t < tasks.length; t += 1) {
      taskMap[tasks[t].id] = tasks[t];
    }
  }

  if (!Array.isArray(lineages) || lineages.length === 0) {
    var empty = document.createElement("div");
    empty.className = "muted";
    empty.textContent = "目前無研究血統鏈結。";
    section.appendChild(empty);
    return section;
  }

  for (var i = 0; i < lineages.length; i += 1) {
    var lin = lineages[i];
    var card = document.createElement("div");
    card.className = "lineage-card";

    var head = document.createElement("div");
    head.className = "lineage-card-header";

    var scopeTag = document.createElement("span");
    scopeTag.className = "scope-tag " + (lin.scope === "character" ? "scope-character" : "scope-world");
    scopeTag.textContent = lin.scope === "character" ? ("角色：" + (lin.character_id || "")) : "世界";
    head.appendChild(scopeTag);

    var reqTitle = document.createElement("strong");
    reqTitle.textContent = " " + lin.requirement_label + " (" + lin.requirement_id + ")";
    head.appendChild(reqTitle);

    var batchSpan = document.createElement("span");
    batchSpan.className = "muted lineage-batch-info";
    batchSpan.textContent = " · 批次 " + lin.batch_id;
    head.appendChild(batchSpan);

    card.appendChild(head);

    var chainsFlow = document.createElement("div");
    chainsFlow.className = "lineage-chains-flow";

    var chains = Array.isArray(lin.chains) ? lin.chains : [];
    for (var c = 0; c < chains.length; c += 1) {
      var chain = chains[c];
      var chainRow = document.createElement("div");
      chainRow.className = "lineage-chain-row";

      var nodes = Array.isArray(chain.nodes) ? chain.nodes : [];
      for (var n = 0; n < nodes.length; n += 1) {
        var node = nodes[n];
        var fullTask = taskMap[node.id] || node;

        if (n > 0) {
          var arrow = document.createElement("span");
          arrow.className = "lineage-arrow";
          arrow.textContent = "→";
          chainRow.appendChild(arrow);
        }

        var nodeCard = document.createElement("div");
        nodeCard.className = "lineage-node-card " + (node.is_in_flight ? "node-in-flight" : "node-terminal");

        var nodeTop = document.createElement("div");
        nodeTop.className = "node-top";
        var nodeBadge = document.createElement("span");
        nodeBadge.className = "status-badge " + statusClass(node.projected_status || node.status);
        nodeBadge.textContent = node.projected_status || node.status;
        nodeTop.appendChild(nodeBadge);

        var nodeFlightBadge = document.createElement("span");
        nodeFlightBadge.className = "flight-tag " + (node.is_in_flight ? "flight-active" : "flight-terminal");
        nodeFlightBadge.textContent = node.is_in_flight ? "進行中" : "歷史";
        nodeTop.appendChild(nodeFlightBadge);

        if (node.origin_kind) {
          var nodeOriginBadge = document.createElement("span");
          nodeOriginBadge.className = "origin-badge origin-" + node.origin_kind;
          var oNames = {
            newly_created: "新建立",
            reused_existing: "既有重用",
            successor_recovery: "修復衍生",
            legacy_unknown: "歷史",
          };
          nodeOriginBadge.textContent = oNames[node.origin_kind] || node.origin_kind;
          nodeTop.appendChild(nodeOriginBadge);
        }

        nodeCard.appendChild(nodeTop);

        var nodeMid = document.createElement("div");
        nodeMid.className = "node-mid";
        var taskIdLink = document.createElement("button");
        taskIdLink.type = "button";
        taskIdLink.className = "task-link-btn";
        taskIdLink.textContent = "Task: " + node.id.slice(0, 10);
        taskIdLink.title = "點擊檢視 Task " + node.id + " 上下文";
        taskIdLink.addEventListener("click", (function (tObj) {
          return function () { openTaskContextModal(tObj); };
        })(fullTask));
        nodeMid.appendChild(taskIdLink);

        if (node.recovery_action) {
          var recTag = document.createElement("span");
          recTag.className = "recovery-action-tag";
          recTag.textContent = "修復: " + node.recovery_action;
          nodeMid.appendChild(recTag);
        }
        nodeCard.appendChild(nodeMid);

        if (Array.isArray(node.operation_ids) && node.operation_ids.length > 0) {
          var nodeBot = document.createElement("div");
          nodeBot.className = "node-bot";
          var opLink = document.createElement("button");
          opLink.type = "button";
          opLink.className = "action-link-small";
          opLink.textContent = "前往 Op (" + node.operation_ids.length + ")";
          opLink.addEventListener("click", (function (opId) {
            return function () {
              switchPanel("operations");
              void revealDiagnosticTarget({ kind: "operation", id: opId, panel: "operations" });
            };
          })(node.operation_ids[0]));
          nodeBot.appendChild(opLink);
          nodeCard.appendChild(nodeBot);
        }

        chainRow.appendChild(nodeCard);
      }
      chainsFlow.appendChild(chainRow);
    }
    card.appendChild(chainsFlow);
    section.appendChild(card);
  }
  return section;
}

function renderResearchMonitor(monitor) {
  var container = byId("research-monitor");
  container.textContent = "";
  if (monitor === null || monitor === undefined) return;
  var batches = monitor.batches || [];
  var tasks = monitor.tasks || [];
  var lineages = monitor.lineages || [];

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

  if (lineages.length > 0) {
    container.appendChild(renderResearchLineages(lineages, tasks));
  }

  var taskListHeader = document.createElement("h4");
  taskListHeader.style.cssText = "margin: 16px 0 8px 0;";
  taskListHeader.textContent = "全部研究任務清單 (" + tasks.length + ")";
  container.appendChild(taskListHeader);

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

