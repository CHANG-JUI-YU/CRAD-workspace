export const DASHBOARD_PANELS_PUBLISH_JS = `      function renderPrecheckMatrix(prechecks) {
        var target = byId("precheck-matrix");
        target.textContent = "";
        if (!Array.isArray(prechecks) || prechecks.length === 0) {
          byId("prechecks-message").textContent = "目前沒有 Blueprint 預檢記錄。";
          return;
        }
        var pending = null;
        for (var i = prechecks.length - 1; i >= 0; i -= 1) {
          if (isRecord(prechecks[i]) && prechecks[i].status === "needs_input") {
            pending = prechecks[i];
            break;
          }
        }
        var active = null;
        if (pending !== null && Array.isArray(pending.checks)) {
          for (var a = 0; a < pending.checks.length; a += 1) {
            var item = pending.checks[a];
            if (isRecord(item) && item.action === "user_confirmed" && (item.user_answer === undefined || item.user_answer === "pending confirmation")) {
              active = item;
              break;
            }
          }
        }
        byId("prechecks-message").textContent = "共 " + prechecks.length + " 筆預檢記錄；" + (active !== null ? "目前待確認 1 項。" : "歷史矩陣僅供瀏覽。");
        if (active !== null) {
          var card = document.createElement("div");
          card.className = "precheck-active";
          var heading = document.createElement("div");
          heading.className = "precheck-active-heading";
          heading.textContent = "目前待確認：" + (firstString(active, ["subject_id"]) || "?") + " × " + (firstString(active, ["dimension"]) || "?");
          card.append(heading);
          var detail = document.createElement("div");
          var detailParts = [];
          detailParts.push("原依據：" + (firstString(active, ["basis"]) || "?"));
          detailParts.push("影響：" + (firstString(active, ["impact"]) || "?"));
          detailParts.push("不確定性：" + (firstString(active, ["uncertainty"]) || "?"));
          detail.textContent = detailParts.join(" · ");
          card.append(detail);
          var actions = document.createElement("span");
          actions.className = "inline-actions";
          var confirm = document.createElement("button");
          confirm.type = "button";
          confirm.className = "primary";
          confirm.textContent = "確認沿用";
          confirm.addEventListener("click", function () { submitInterviewAnswer("確認"); });
          actions.append(confirm);
          var supplement = document.createElement("input");
          supplement.type = "text";
          supplement.placeholder = "補充內容（可選）…";
          var submitSupplement = document.createElement("button");
          submitSupplement.type = "button";
          submitSupplement.textContent = "送出補充";
          submitSupplement.addEventListener("click", function () {
            var value = supplement.value.trim();
            if (!value) {
              localValidation("預檢補充", "補充內容不可為空。");
              return;
            }
            submitInterviewAnswer(value);
          });
          actions.append(supplement, submitSupplement);
          card.append(actions);
          target.append(card);
        }
        var rows = [];
        for (var p = 0; p < prechecks.length; p += 1) {
          var precheck = prechecks[p];
          if (!isRecord(precheck) || !Array.isArray(precheck.checks)) continue;
          var statusLabel = precheck.status === "superseded" ? "已取代" : (precheck.status === "needs_input" ? "待處理" : "已記錄");
          for (var c = 0; c < precheck.checks.length; c += 1) {
            var check = precheck.checks[c];
            if (!isRecord(check)) continue;
            var row = document.createElement("div");
            row.className = "precheck-row";
            var subjectCell = document.createElement("span");
            subjectCell.textContent = firstString(check, ["subject_id"]) || "?";
            var dimensionCell = document.createElement("span");
            dimensionCell.textContent = firstString(check, ["dimension"]) || "?";
            var statusCell = document.createElement("span");
            var answered = check.user_answer !== undefined && check.user_answer !== "pending confirmation";
            statusCell.className = "status-badge " + (answered ? "ready" : (precheck.status === "needs_input" ? "active" : ""));
            if (answered) statusCell.textContent = "已確認";
            else if (check.action !== "user_confirmed") statusCell.textContent = "無需確認";
            else statusCell.textContent = statusLabel;
            var metaCell = document.createElement("span");
            var metaParts = ["impact " + (firstString(check, ["impact"]) || "?"), "uncertainty " + (firstString(check, ["uncertainty"]) || "?")];
            if (firstString(check, ["basis"])) metaParts.push("basis " + firstString(check, ["basis"]));
            if (answered) metaParts.push("回答：" + check.user_answer);
            metaCell.textContent = metaParts.join(" / ");
            row.append(subjectCell, dimensionCell, statusCell, metaCell);
            rows.push(row);
          }
        }
        if (rows.length > 0) {
          var history = document.createElement("div");
          history.className = "precheck-history";
          history.append.apply(history, rows);
          target.append(history);
        }
      }

      var publishStepperState = {
        stage: "readiness",
        status: "waiting",
        readinessOk: false,
        previewData: null,
        staleDiff: null
      };

      function updatePublishStepper(stage, status, details) {
        publishStepperState.stage = stage;
        publishStepperState.status = status;
        var stageOrder = ["readiness", "inputs_frozen", "provenance_reviewed", "confirmed", "published"];
        var currentIdx = stageOrder.indexOf(stage);

        var cta = byId("publish-primary-cta");
        var stepperEl = byId("publish-stepper");
        if (stepperEl) {
          var stepEls = stepperEl.querySelectorAll(".stepper-step");
          for (var i = 0; i < stepEls.length; i += 1) {
            var el = stepEls[i];
            var stepKey = el.getAttribute("data-step");
            var stepIdx = stageOrder.indexOf(stepKey);
            var badge = el.querySelector(".step-badge");
            el.className = "stepper-step";
            if (stepIdx < currentIdx) {
              el.classList.add("pass");
              if (badge) badge.textContent = "pass";
            } else if (stepIdx === currentIdx) {
              var cls = status === "stale" ? "stale" : (status === "blocked" ? "blocked" : (status === "pass" ? "pass" : "current"));
              el.classList.add(cls);
              if (badge) badge.textContent = status;
            } else {
              if (badge) badge.textContent = "waiting";
            }
          }
        }

        if (cta) {
          cta.disabled = false;
          if (stage === "readiness") {
            cta.textContent = status === "blocked" ? "重新檢查就緒狀態" : (status === "pass" ? "凍結輸入並準備發布確認" : "檢查發布就緒");
            cta.setAttribute("data-action", status === "pass" ? "prepare_provenance" : "check_readiness");
          } else if (stage === "inputs_frozen") {
            cta.textContent = status === "stale" ? "重新準備發布確認" : "凍結輸入並準備發布確認";
            cta.setAttribute("data-action", "prepare_provenance");
          } else if (stage === "provenance_reviewed") {
            if (status === "stale") {
              cta.textContent = "重新準備發布確認";
              cta.setAttribute("data-action", "prepare_provenance");
            } else {
              var overridesCount = (details && details.overrides_count) || 0;
              cta.textContent = overridesCount > 0 ? "確認此組成並發布（" + overridesCount + " 筆覆寫）" : "確認此組成並發布";
              cta.setAttribute("data-action", "confirm_publish");
            }
          } else if (stage === "confirmed" || stage === "published") {
            cta.textContent = "已發布（可安全重試）";
            cta.setAttribute("data-action", "confirm_publish");
          }
        }
      }

      function updateBothModeOption(modes, exportModes, bothBlockers) {
        var option = byId("readiness-both-mode");
        var blockerInfoEl = byId("both-mode-blocker-info");
        var modesOk = isRecord(modes) && modes.zhuji === true && modes.palette === true;
        var manifestOk = exportModes === undefined || exportModes === null || exportModes === "both";
        if (option !== null && option !== undefined) {
          if (modesOk && manifestOk) {
            option.disabled = false;
            option.removeAttribute("title");
          } else {
            option.disabled = true;
            option.setAttribute("title", "僅在 Zhuji 與 Palette 都可建置且 Blueprint 未限制單一模式時可用");
          }
        }
        if (blockerInfoEl !== null && blockerInfoEl !== undefined) {
          if (Array.isArray(bothBlockers) && bothBlockers.length > 0 && !(modesOk && manifestOk)) {
            blockerInfoEl.style.display = "block";
            blockerInfoEl.textContent = "Both 雙模式目前不可用：" + bothBlockers.map(function (b) { return b.reason; }).join("；");
          } else {
            blockerInfoEl.style.display = "none";
            blockerInfoEl.textContent = "";
          }
        }
      }

      function renderReadiness(diagnostics) {
        var target = byId("readiness-list");
        target.textContent = "";
        if (!Array.isArray(diagnostics) || diagnostics.length === 0) {
          byId("readiness-message").textContent = "就緒：可以發布。";
          return;
        }
        var blocking = diagnostics.filter(function (item) { return item.severity === "error"; });
        byId("readiness-message").textContent = blocking.length === 0
          ? "有 " + diagnostics.length + " 條警告，不阻擋發布。"
          : "有 " + blocking.length + " 條阻擋診斷；修復後再發布。";
        for (var i = 0; i < diagnostics.length; i += 1) {
          var item = diagnostics[i];
          if (!isRecord(item)) continue;
          var row = document.createElement("div");
          row.className = "readiness-row";
          var badge = document.createElement("span");
          badge.className = "status-badge " + (item.severity === "error" ? "error" : "active");
          badge.textContent = item.severity === "error" ? "阻擋" : "警告";
          var text = document.createElement("span");
          text.textContent = (firstString(item, ["code"]) || "?") + "： " + (firstString(item, ["message"]) || "");
          row.append(badge, text);
          var hint = document.createElement("span");
          hint.className = "readiness-hint";
          hint.textContent = readinessHint(firstString(item, ["code"]));
          row.append(hint);
          target.append(row);
        }
      }

      function readinessHint(code) {
        var hints = {
          "BLUEPRINT_PRECHECK_REQUIRED": "動作：在訪談中完成預檢確認。",
          "INTERVIEW_REQUIRED": "動作：完成結構化訪談。",
          "PUBLISH_NO_CONTENT": "動作：建立至少一個角色內容 artifact。",
          "ARTIFACT_REVIEW_REQUIRED": "動作：送交對應 Critic 審查。",
          "REQUIRED_WORLD_ARTIFACT_MISSING": "動作：建立世界設定。",
          "BLUEPRINT_BINDING_STALE": "動作：依目前 Blueprint 重建 artifact。",
          "FACT_REVIEW_RUN_MISSING": "動作：整理來源後自動抽取事實。",
          "FACT_REVIEW_COVERAGE_INCOMPLETE": "動作：完成全部候選的裁決。",
          "FACT_REVIEW_NEEDS_EVIDENCE": "動作：補齊來源引文後重新送審。",
          "FACT_REVIEW_CONFLICT": "動作：由 Director 執行衝突裁決。",
          "FACT_REVIEW_CONTRADICTION": "動作：送交 Director 裁決矛盾事實。",
          "SOURCE_RESEARCH_NOT_INGESTED": "動作：批准候選並執行來源入庫。",
          "SOURCE_RESEARCH_OFFICIAL_REQUIRED": "動作：搜尋並入庫官方來源。",
          "WORLD_AUTHORING_ORDER": "動作：先建立世界設定。",
          "CHARACTER_AUTHORING_ORDER": "動作：先建立角色設定。",
          "FACT_PROVENANCE_MISSING": "動作：為已接受事實補上來源佐證。",
          "FACT_REVIEW_DECISION_MISSING": "動作：確認每個已接受事實都有裁決記錄。",
          "REQUIRED_ARTIFACT_MISSING": "動作：建立缺少的必要 artifact。"
        };
        return hints[code] || "";
      }

      function panelAnchorId(panel) {
        var panelIds = {
          sources: "source-list",
          artifacts: "artifact-list",
          facts: "fact-list",
          "fact-review": "fact-review-run",
          coverage: "coverage-center",
          precheck: "precheck-matrix",
          interview: "interview-heading",
          readiness: "readiness-list",
          quality: "quality-heading",
          builds: "build-heading",
          publishes: "readiness-list",
          publish: "readiness-list"
        };
        return panelIds[panel] || "readiness-list";
      }

      function coverageCellId(characterId, requirementId) {
        return "coverage-cell-" + (characterId || "world") + "-" + String(requirementId).split(".").join("-");
      }

      var currentDiagnosticNavToken = 0;

      function findDiagnosticObjectElement(target) {
        if (target === undefined || target === null) return null;
        if (target.kind === "coverage_cell") {
          if (target.requirement_id === undefined || target.requirement_id === null) return null;
          var cell = byId(coverageCellId(target.character_id, target.requirement_id));
          if (cell !== null && cell !== undefined) return cell;
          if (typeof document.querySelector === "function") {
            var cellByAttr = document.querySelector('[data-cell-id="' + (target.character_id || "world") + "__" + target.requirement_id + '"]');
            if (cellByAttr !== null && cellByAttr !== undefined) return cellByAttr;
          }
          return null;
        }
        if (target.kind === undefined || target.id === undefined || target.id === null) return null;
        var isReviewRun = target.kind === "review_run" || target.kind === "review-run";
        if (typeof document.querySelectorAll === "function") {
          var matches = document.querySelectorAll("[data-object-kind]");
          for (var i = 0; i < matches.length; i += 1) {
            var k = matches[i].getAttribute("data-object-kind");
            var id = matches[i].getAttribute("data-object-id");
            if ((k === target.kind || (isReviewRun && (k === "review_run" || k === "review-run"))) && id === target.id) {
              return matches[i];
            }
          }
        }
        if (typeof document.querySelector === "function") {
          var selector = isReviewRun
            ? '[data-object-kind="review_run"][data-object-id="' + target.id + '"], [data-object-kind="review-run"][data-object-id="' + target.id + '"]'
            : '[data-object-kind="' + target.kind + '"][data-object-id="' + target.id + '"]';
          var match = document.querySelector(selector);
          if (match !== null && match !== undefined) return match;
        }
        return null;
      }

      var lastDiagnosticHighlight = null;

      function generateIdempotencyKey() {
        if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
          return crypto.randomUUID();
        }
        var s4 = function () { return Math.floor((1 + Math.random()) * 0x10000).toString(16).substring(1); };
        return s4() + s4() + "-" + s4() + "-4" + s4().substr(0, 3) + "-" + s4() + "-" + s4() + s4() + s4();
      }

      function getOrCreateProvenanceIdempotencyKey(projectId, fingerprint, mode) {
        var storageKey = "crad_publish_idempotency_" + (projectId || "default") + "_" + fingerprint + "_" + (mode || "default");
        try {
          if (typeof sessionStorage !== "undefined") {
            var existing = sessionStorage.getItem(storageKey);
            if (existing && existing.length > 0) return existing;
            var newKey = generateIdempotencyKey();
            sessionStorage.setItem(storageKey, newKey);
            return newKey;
          }
        } catch (e) {}
        return generateIdempotencyKey();
      }

      function clearDiagnosticHighlight() {
        if (lastDiagnosticHighlight !== null && lastDiagnosticHighlight !== undefined) {
          lastDiagnosticHighlight.classList.remove("diagnostic-highlight");
          lastDiagnosticHighlight.removeAttribute("data-diagnostic-code");
          lastDiagnosticHighlight = null;
        }
      }

      function reducedMotion() {
        return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      }

      function switchPanel(panel) {
        var anchor = byId(panelAnchorId(panel));
        if (anchor === null || anchor === undefined) return;
        anchor.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
      }

      function revealDiagnosticTarget(target, code, btnEl) {
        if (target === undefined || target === null) return Promise.resolve();
        var token = typeof currentDiagnosticNavToken === "number" ? ++currentDiagnosticNavToken : 0;
        var originalBtnText = btnEl ? btnEl.textContent : "";
        if (btnEl) {
          btnEl.disabled = true;
          btnEl.textContent = "載入中…";
        }

        function highlightOrFallback() {
          if (typeof currentDiagnosticNavToken === "number" && token !== currentDiagnosticNavToken) return;
          var element = findDiagnosticObjectElement(target);
          if (element !== null && element !== undefined) {
            clearDiagnosticHighlight();
            element.classList.add("diagnostic-highlight");
            element.setAttribute("data-diagnostic-code", code || target.panel || "");
            element.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "center" });
            if (typeof element.focus === "function") {
              try {
                element.focus({ preventScroll: true });
              } catch (focusError) {
                element.focus();
              }
            }
            lastDiagnosticHighlight = element;
          } else {
            var fallbackAnchor = byId(panelAnchorId(target.panel)) || byId("readiness-list");
            if (fallbackAnchor !== null && fallbackAnchor !== undefined) {
              clearDiagnosticHighlight();
              fallbackAnchor.classList.add("diagnostic-highlight");
              fallbackAnchor.setAttribute("data-diagnostic-code", code || target.panel || "");
              fallbackAnchor.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
              lastDiagnosticHighlight = fallbackAnchor;
            }
            var targetDesc = (target.kind || "物件") + (target.id ? " " + target.id : (target.requirement_id ? " " + target.requirement_id : ""));
            var msg = "找不到指定物件（" + targetDesc + "），可能已刪除或診斷已更新；已退回 " + (target.panel || "Readiness") + " 面板。";
            var msgEl = byId("readiness-message");
            if (msgEl) msgEl.textContent = msg;
            if (typeof setNotice === "function") setNotice("warning", msg);
          }
        }

        var initialElement = findDiagnosticObjectElement(target);
        if (initialElement !== null) {
          highlightOrFallback();
          if (btnEl) {
            btnEl.disabled = false;
            btnEl.textContent = originalBtnText;
          }
          return Promise.resolve();
        }

        var kind = target.kind;
        var panel = target.panel;
        var hasLoader = false;
        var loadPromise = null;
        if (kind === "artifact" || panel === "artifacts") {
          if (typeof loadArtifactData === "function") { loadPromise = loadArtifactData(); hasLoader = true; }
        } else if (kind === "source" || kind === "fact" || kind === "review_run" || kind === "review-run" || panel === "sources" || panel === "facts" || panel === "fact-review") {
          if (typeof loadSourceFactData === "function") { loadPromise = loadSourceFactData(); hasLoader = true; }
        } else if (kind === "coverage_cell" || panel === "coverage") {
          if (typeof loadCoverageCenterData === "function") { loadPromise = loadCoverageCenterData(); hasLoader = true; }
        } else if (kind === "operation" || panel === "operations") {
          if (typeof loadOperationData === "function") { loadPromise = loadOperationData(); hasLoader = true; }
        } else if (panel === "quality") {
          if (typeof loadIssueData === "function") { loadPromise = loadIssueData(); hasLoader = true; }
        } else if (panel === "precheck") {
          if (typeof loadDashboardData === "function") { loadPromise = loadDashboardData(); hasLoader = true; }
        }

        if (!hasLoader) {
          highlightOrFallback();
          if (btnEl) {
            btnEl.disabled = false;
            btnEl.textContent = originalBtnText;
          }
          return Promise.resolve();
        }

        return Promise.resolve(loadPromise).then(function () {
          highlightOrFallback();
        }).catch(function (error) {
          var errAnchor = byId(panelAnchorId(target.panel)) || byId("readiness-list");
          if (errAnchor) {
            clearDiagnosticHighlight();
            errAnchor.classList.add("diagnostic-highlight");
            errAnchor.setAttribute("data-diagnostic-code", code || target.panel || "");
            errAnchor.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
            lastDiagnosticHighlight = errAnchor;
          }
        }).finally(function () {
          if (btnEl) {
            btnEl.disabled = false;
            btnEl.textContent = originalBtnText;
          }
        });
      }

      function navigateDiagnosticTarget(target) {
        void revealDiagnosticTarget(target);
      }

      function makeDiagnosticNavGroup(rowState) {
        var group = document.createElement("span");
        group.className = "diagnostic-nav";
        var count = document.createElement("span");
        count.className = "diagnostic-nav-count";
        count.textContent = (rowState.index + 1) + " / " + rowState.targets.length;
        var prev = document.createElement("button");
        prev.type = "button";
        prev.textContent = "上一個";
        prev.setAttribute("aria-label", "上一個受影響物件");
        prev.addEventListener("click", function () {
          rowState.index = (rowState.index - 1 + rowState.targets.length) % rowState.targets.length;
          count.textContent = (rowState.index + 1) + " / " + rowState.targets.length;
          void revealDiagnosticTarget(rowState.targets[rowState.index], rowState.code, prev);
        });
        var next = document.createElement("button");
        next.type = "button";
        next.textContent = "下一個";
        next.setAttribute("aria-label", "下一個受影響物件");
        next.addEventListener("click", function () {
          rowState.index = (rowState.index + 1) % rowState.targets.length;
          count.textContent = (rowState.index + 1) + " / " + rowState.targets.length;
          void revealDiagnosticTarget(rowState.targets[rowState.index], rowState.code, next);
        });
        var go = document.createElement("button");
        go.type = "button";
        go.textContent = "前往";
        go.setAttribute("aria-label", "前往目前受影響物件");
        go.addEventListener("click", function () {
          void revealDiagnosticTarget(rowState.targets[rowState.index], rowState.code, go);
        });
        group.append(prev, count, next, go);
        return group;
      }

      function renderPublishDiagnostics(structured) {
        var target = byId("readiness-list");
        target.textContent = "";
        if (structured === null || structured === undefined || ((!Array.isArray(structured.groups) || structured.groups.length === 0) && (!Array.isArray(structured.rows) || structured.rows.length === 0))) {
          byId("readiness-message").textContent = "就緒：可以發布。";
          return;
        }

        var summary = structured.summary || {};
        var errorCount = typeof summary.error_count === "number" ? summary.error_count : (structured.rows ? structured.rows.filter(function (r) { return r.severity === "error"; }).length : 0);
        var warningCount = typeof summary.warning_count === "number" ? summary.warning_count : (structured.rows ? structured.rows.filter(function (r) { return r.severity === "warning"; }).length : 0);
        var affectedCount = typeof summary.affected_object_count === "number" ? summary.affected_object_count : (structured.groups ? structured.groups.reduce(function (acc, g) { return acc + (g.affected_objects ? g.affected_objects.length : 0); }, 0) : 0);
        var groupCount = typeof summary.remediation_group_count === "number" ? summary.remediation_group_count : (structured.groups ? structured.groups.length : 0);

        if (errorCount === 0) {
          byId("readiness-message").textContent = "有 " + warningCount + " 條警告，不阻擋發布；共涉及 " + affectedCount + " 個物件、" + groupCount + " 組修復路徑。";
        } else {
          byId("readiness-message").textContent = "有 " + errorCount + " 條阻擋診斷（另有 " + warningCount + " 條警告）；共涉及 " + affectedCount + " 個物件、" + groupCount + " 組修復路徑。修復後再發布。";
        }

        if (Array.isArray(structured.groups) && structured.groups.length > 0) {
          for (var g = 0; g < structured.groups.length; g += 1) {
            var group = structured.groups[g];
            if (!isRecord(group)) continue;
            var groupCard = document.createElement("div");
            groupCard.className = "diagnostic-group-card " + (group.highest_severity === "error" ? "severity-error" : "severity-warning");

            var groupHeader = document.createElement("div");
            groupHeader.className = "diagnostic-group-header";
            var badge = document.createElement("span");
            badge.className = "status-badge " + (group.highest_severity === "error" ? "error" : "active");
            badge.textContent = group.highest_severity === "error" ? "阻擋" : "警告";
            groupHeader.append(badge);

            var groupTitle = document.createElement("strong");
            groupTitle.className = "diagnostic-group-title";
            groupTitle.textContent = "【" + (group.remediation_key || group.panel || "一般") + "】 主要下一步：" + (group.primary_next_action || "檢視診斷");
            groupHeader.append(groupTitle);

            var panelBtn = document.createElement("button");
            panelBtn.type = "button";
            panelBtn.className = "action-link";
            panelBtn.textContent = "前往 " + (group.panel || "面板");
            panelBtn.addEventListener("click", (function (p) {
              return function () { switchPanel(p); };
            })(group.panel));
            groupHeader.append(panelBtn);
            groupCard.append(groupHeader);

            var objList = document.createElement("div");
            objList.className = "diagnostic-object-list";

            var affObjs = Array.isArray(group.affected_objects) ? group.affected_objects : [];
            for (var o = 0; o < affObjs.length; o += 1) {
              var obj = affObjs[o];
              if (!isRecord(obj)) continue;
              var objRow = document.createElement("div");
              objRow.className = "diagnostic-object-row";

              var objHead = document.createElement("div");
              objHead.className = "diagnostic-object-head";
              var objIdent = document.createElement("span");
              objIdent.className = "diagnostic-object-id";
              var label = obj.kind + " " + (obj.id ? obj.id.slice(0, 14) : "");
              if (obj.character_id) label += "（" + obj.character_id + "）";
              if (obj.requirement_id) label += "／" + obj.requirement_id;
              objIdent.textContent = label;
              objHead.append(objIdent);

              var primaryDiag = (Array.isArray(obj.diagnostics) && obj.diagnostics.length > 0) ? obj.diagnostics[0] : null;
              if (primaryDiag) {
                var codeBadge = document.createElement("span");
                codeBadge.className = "diagnostic-code-badge";
                codeBadge.textContent = primaryDiag.code;
                objHead.append(codeBadge);

                var primaryMsg = document.createElement("span");
                primaryMsg.className = "diagnostic-msg";
                primaryMsg.textContent = primaryDiag.message;
                objHead.append(primaryMsg);
              }

              var targets = Array.isArray(obj.targets) && obj.targets.length > 0
                ? obj.targets.slice()
                : (obj.target !== undefined && obj.target !== null ? [obj.target] : [{ panel: group.panel || "readiness" }]);

              var navHolder = document.createElement("span");
              navHolder.className = "diagnostic-nav-holder";
              if (targets.length > 1) {
                navHolder.append(makeDiagnosticNavGroup({ targets: targets, index: 0, code: primaryDiag ? primaryDiag.code : "" }));
              } else {
                var goBtn = document.createElement("button");
                goBtn.type = "button";
                goBtn.textContent = "前往";
                goBtn.setAttribute("aria-label", "前往受影響物件");
                var sTarget = targets[0];
                goBtn.addEventListener("click", (function (targetObj, dCode, buttonElement) {
                  return function () { void revealDiagnosticTarget(targetObj, dCode, buttonElement); };
                })(sTarget, primaryDiag ? primaryDiag.code : "", goBtn));
                navHolder.append(goBtn);
              }
              objHead.append(navHolder);
              objRow.append(objHead);

              if (Array.isArray(obj.diagnostics) && obj.diagnostics.length > 1) {
                var secDetails = document.createElement("details");
                secDetails.className = "secondary-diagnostics";
                var secSummary = document.createElement("summary");
                secSummary.textContent = "其他 " + (obj.diagnostics.length - 1) + " 項診斷代碼與說明";
                secDetails.append(secSummary);
                for (var dIdx = 1; dIdx < obj.diagnostics.length; dIdx += 1) {
                  var secDiag = obj.diagnostics[dIdx];
                  var secLine = document.createElement("div");
                  secLine.className = "secondary-diagnostic-line";
                  var secBadge = document.createElement("span");
                  secBadge.className = "status-badge " + (secDiag.severity === "error" ? "error" : "active");
                  secBadge.textContent = secDiag.severity === "error" ? "阻擋" : "警告";
                  var secCode = document.createElement("strong");
                  secCode.textContent = " " + secDiag.code + "：";
                  var secText = document.createElement("span");
                  secText.textContent = secDiag.message;
                  secLine.append(secBadge, secCode, secText);
                  secDetails.append(secLine);
                }
                objRow.append(secDetails);
              }

              objList.append(objRow);
            }

            var unscoped = Array.isArray(group.unscoped_diagnostics) ? group.unscoped_diagnostics : [];
            for (var u = 0; u < unscoped.length; u += 1) {
              var uDiag = unscoped[u];
              if (!isRecord(uDiag)) continue;
              var uRow = document.createElement("div");
              uRow.className = "diagnostic-object-row unscoped-row";
              var uHead = document.createElement("div");
              uHead.className = "diagnostic-object-head";
              var uBadge = document.createElement("span");
              uBadge.className = "status-badge " + (uDiag.severity === "error" ? "error" : "active");
              uBadge.textContent = uDiag.severity === "error" ? "阻擋" : "警告";
              var uCode = document.createElement("strong");
              uCode.textContent = " " + uDiag.code + "：";
              var uText = document.createElement("span");
              uText.textContent = uDiag.message;
              uHead.append(uBadge, uCode, uText);
              var uBtn = document.createElement("button");
              uBtn.type = "button";
              uBtn.textContent = "前往";
              var uTarget = (Array.isArray(uDiag.targets) && uDiag.targets[0]) || uDiag.target || { panel: group.panel || "readiness" };
              uBtn.addEventListener("click", (function (targetObj, dCode, buttonElement) {
                return function () { void revealDiagnosticTarget(targetObj, dCode, buttonElement); };
              })(uTarget, uDiag.code, uBtn));
              uHead.append(uBtn);
              uRow.append(uHead);
              objList.append(uRow);
            }

            groupCard.append(objList);
            target.append(groupCard);
          }
        } else {
          for (var i = 0; i < structured.rows.length; i += 1) {
            var row = structured.rows[i];
            if (!isRecord(row)) continue;
            var line = document.createElement("div");
            line.className = "readiness-row";
            var rBadge = document.createElement("span");
            rBadge.className = "status-badge " + (row.severity === "error" ? "error" : "active");
            rBadge.textContent = row.severity === "error" ? "阻擋" : "警告";
            line.append(rBadge);
            var rText = document.createElement("span");
            rText.textContent = (firstString(row, ["code"]) || "?") + "： " + (firstString(row, ["message"]) || "");
            line.append(rText);
            var detail = document.createElement("span");
            detail.className = "readiness-hint";
            var detailParts = [];
            if (Array.isArray(row.affected) && row.affected.length > 0) {
              for (var a = 0; a < row.affected.length; a += 1) {
                var affected = row.affected[a];
                var affectedLabel = affected.kind + " " + (affected.id ? affected.id.slice(0, 12) : "?");
                if (affected.character_id) affectedLabel += "（" + affected.character_id + "）";
                if (affected.requirement_id) affectedLabel += "／" + affected.requirement_id;
                detailParts.push(affectedLabel);
              }
            }
            if (row.next_action) detailParts.push("下一步：" + row.next_action);
            detail.textContent = detailParts.join("；");
            line.append(detail);
            var rTargets = Array.isArray(row.targets) && row.targets.length > 0
              ? row.targets.slice()
              : (row.target !== undefined && row.target !== null ? [row.target] : [{ panel: "readiness" }]);
            if (rTargets.length > 1) {
              line.append(makeDiagnosticNavGroup({ targets: rTargets, index: 0, code: row.code }));
            } else {
              var rGo = document.createElement("button");
              rGo.type = "button";
              rGo.textContent = "前往";
              rGo.setAttribute("aria-label", "前往受影響物件或面板");
              var singleTarget = rTargets[0];
              rGo.addEventListener("click", (function (immutableTarget, immutableCode, buttonElement) {
                return function () { void revealDiagnosticTarget(immutableTarget, immutableCode, buttonElement); };
              })(singleTarget, row.code, rGo));
              line.append(rGo);
            }
            target.append(line);
          }
        }

        if (structured.has_unknown === true) {
          var note = document.createElement("div");
          note.className = "muted";
          note.textContent = "部分診斷缺少明確動作，已在 Readiness 面板標示。";
          target.append(note);
        }
      }

      function provenanceCoverageRefs(refs) {
        var list = document.createElement("ul");
        if (!Array.isArray(refs) || refs.length === 0) {
          var empty = document.createElement("li");
          empty.className = "muted";
          empty.textContent = "沒有項目。";
          list.append(empty);
          return list;
        }
        for (var i = 0; i < refs.length; i += 1) {
          var ref = refs[i];
          var li = document.createElement("li");
          li.textContent = (isRecord(ref) && ref.character_id ? ref.character_id : "world") + "／" + (isRecord(ref) && ref.requirement_id ? ref.requirement_id : "?");
          list.append(li);
        }
        return list;
      }

      function provenanceSection(title, refs) {
        var section = document.createElement("details");
        section.className = "provenance-section";
        var summaryEl = document.createElement("summary");
        summaryEl.textContent = title;
        section.append(summaryEl);
        section.append(provenanceCoverageRefs(refs));
        return section;
      }

      function overrideList(refs) {
        var list = document.createElement("ul");
        if (!Array.isArray(refs) || refs.length === 0) {
          var empty = document.createElement("li");
          empty.className = "muted";
          empty.textContent = "沒有項目。";
          list.append(empty);
          return list;
        }
        for (var i = 0; i < refs.length; i += 1) {
          var ref = refs[i];
          if (!isRecord(ref)) continue;
          var li = document.createElement("li");
          var text = String(ref.decision_id) + "（" + String(ref.action) + "）：" + (Array.isArray(ref.requirement_ids) ? ref.requirement_ids.join(", ") : "?");
          if (ref.supersedes) text += "；取代 " + String(ref.supersedes);
          li.textContent = text;
          list.append(li);
        }
        return list;
      }

      function provenanceImageMeta(label, value) {
        var meta = document.createElement("span");
        meta.className = "muted";
        meta.textContent = label + " " + String(value);
        return meta;
      }

      function hashRow(label, value, container, legacyNote) {
        var rowEl = document.createElement("div");
        rowEl.className = "provenance-hash-row";
        var labelEl = document.createElement("span");
        labelEl.className = "muted";
        labelEl.textContent = label;
        rowEl.append(labelEl);
        var valueEl = document.createElement("code");
        valueEl.textContent = String(value);
        rowEl.append(valueEl);
        if (legacyNote) {
          var legacy = document.createElement("span");
          legacy.className = "status-badge cancelled";
          legacy.textContent = legacyNote;
          rowEl.append(legacy);
        }
        if (typeof navigator !== "undefined" && navigator.clipboard) {
          var copy = document.createElement("button");
          copy.type = "button";
          copy.textContent = "複製";
          copy.setAttribute("aria-label", "複製完整 " + label);
          copy.addEventListener("click", function () {
            navigator.clipboard.writeText(String(value)).catch(function () {});
          });
          rowEl.append(copy);
        }
        container.append(rowEl);
      }

      function renderStaleDiff(changedInputs) {
        var target = byId("provenance-stale-diff");
        if (!target) return;
        if (!Array.isArray(changedInputs) || changedInputs.length === 0) {
          target.style.display = "none";
          target.textContent = "";
          return;
        }
        target.style.display = "block";
        target.textContent = "";
        var title = document.createElement("div");
        title.className = "stale-diff-title";
        title.textContent = "發布確認已失效（輸入已變更，共 " + changedInputs.length + " 項差異）：";
        target.append(title);

        for (var i = 0; i < changedInputs.length; i += 1) {
          var item = changedInputs[i];
          if (!isRecord(item)) continue;
          var row = document.createElement("div");
          row.className = "stale-diff-item";
          var labelSpan = document.createElement("strong");
          labelSpan.textContent = "【" + (item.label || item.category) + "】 ";
          row.append(labelSpan);
          var textSpan = document.createElement("span");
          textSpan.textContent = (item.before_summary || "") + " -> " + (item.after_summary || "");
          row.append(textSpan);
          if (item.target_panel) {
            var navBtn = document.createElement("button");
            navBtn.type = "button";
            navBtn.className = "action-link";
            navBtn.style.marginLeft = "0.5rem";
            navBtn.textContent = "前往面板";
            navBtn.addEventListener("click", (function (tPanel) {
              return function () { switchPanel(tPanel); };
            })(item.target_panel));
            row.append(navBtn);
          }
          target.append(row);
        }
      }

      function renderProvenanceComposition(preview) {
        var target = byId("provenance-summary");
        target.textContent = "";
        var confirmButton = byId("confirm-publish");
        renderStaleDiff([]);

        if (!isRecord(preview)) {
          byId("provenance-confirm-message").textContent = "無法取得 provenance 資訊。";
          if (confirmButton) confirmButton.disabled = true;
          currentProvenanceConfirmation = null;
          updatePublishStepper("readiness", "waiting");
          return;
        }
        if (preview.available !== true || !isRecord(preview.composition)) {
          byId("provenance-confirm-message").textContent = "尚未準備完成：" + (firstString(preview, ["reason"]) || "不可用") + "。請先完成 Fact Review 與 formal coverage assessment 後再試。";
          if (confirmButton) confirmButton.disabled = true;
          currentProvenanceConfirmation = null;
          updatePublishStepper("readiness", "blocked");
          return;
        }
        var fingerprint = firstString(preview, ["fingerprint"]);
        var modeSelection = firstString(preview, ["mode_selection"]) || undefined;
        var projectId = (state && state.status && state.status.project_id) || "";
        var idempotencyKey = getOrCreateProvenanceIdempotencyKey(projectId, fingerprint, modeSelection);
        var preparedSnapshot = preview.prepared_snapshot;

        currentProvenanceConfirmation = {
          fingerprint: fingerprint,
          mode_selection: modeSelection,
          idempotency_key: idempotencyKey,
          prepared_snapshot: preparedSnapshot,
          in_flight: false,
          completed: false,
          result: null
        };
        var composition = preview.composition;

        var card = document.createElement("div");
        card.className = "provenance-card";

        var header = document.createElement("div");
        header.className = "provenance-header";
        var titleBox = document.createElement("div");
        var title = document.createElement("div");
        title.className = "provenance-title";
        var isDual = modeSelection === "both";
        title.textContent = "權威發布快照（Authoritative Provenance Card）" + (isDual ? "【雙模式 Both】" : "");
        titleBox.append(title);
        var subTitle = document.createElement("div");
        subTitle.className = "muted";
        subTitle.textContent = "Fingerprint: " + fingerprint.slice(0, 16) + "… · Build Snapshot: " + composition.build_snapshot_hash.slice(0, 16) + "…";
        titleBox.append(subTitle);
        header.append(titleBox);
        card.append(header);

        var groupsContainer = document.createElement("div");
        groupsContainer.className = "provenance-groups";

        // Group: Mode
        var modeGroup = document.createElement("div");
        modeGroup.className = "provenance-group-item";
        var modeHead = document.createElement("div");
        modeHead.className = "group-header";
        modeHead.textContent = "1. 發布模式（Mode Selection）";
        var modeBadge = document.createElement("span");
        modeBadge.className = "group-status included";
        modeBadge.textContent = "included";
        modeHead.append(modeBadge);
        modeGroup.append(modeHead);
        var modeBody = document.createElement("div");
        modeBody.className = "group-body";
        modeBody.textContent = "選擇模式：" + (modeSelection || "預設") + (isDual ? "（同時打包 Zhuji 與 Palette 模組）" : "");
        modeGroup.append(modeBody);
        groupsContainer.append(modeGroup);

        // Group: Image
        var imageGroup = document.createElement("div");
        imageGroup.className = "provenance-group-item";
        var imageHead = document.createElement("div");
        imageHead.className = "group-header";
        imageHead.textContent = "2. 封面圖片（Cover Image Identity）";
        var imageIdentity = isRecord(composition.image_identity) ? composition.image_identity : undefined;
        var hasImage = imageIdentity && imageIdentity.mode === "uploaded";
        var imgBadge = document.createElement("span");
        imgBadge.className = "group-status " + (hasImage ? "included" : "not_applicable");
        imgBadge.textContent = hasImage ? "included" : "not_applicable";
        imageHead.append(imgBadge);
        imageGroup.append(imageHead);
        var imageBody = document.createElement("div");
        imageBody.className = "group-body";
        if (hasImage) {
          var imgPreview = document.createElement("div");
          imgPreview.className = "provenance-cover-preview";
          if (imageIdentity.image_id) {
            var thumb = document.createElement("img");
            thumb.className = "provenance-cover-thumb";
            thumb.src = "/workspace/images/" + encodeURIComponent(imageIdentity.image_id);
            thumb.alt = "封面預覽";
            imgPreview.append(thumb);
          }
          var imgText = document.createElement("div");
          imgText.textContent = "圖片 ID: " + imageIdentity.image_id + " · Blob: " + (imageIdentity.blob_hash ? imageIdentity.blob_hash.slice(0, 12) : "無") + (imageIdentity.aspect_ratio ? " · 比例: " + imageIdentity.aspect_ratio : "");
          imgPreview.append(imgText);
          imageBody.append(imgPreview);
        } else {
          imageBody.textContent = "未配置上傳圖片，使用預設佔位圖。";
        }
        imageGroup.append(imageBody);
        groupsContainer.append(imageGroup);

        // Group: Artifacts
        var artGroup = document.createElement("div");
        artGroup.className = "provenance-group-item";
        var artHead = document.createElement("div");
        artHead.className = "group-header";
        artHead.textContent = "3. 發布組件（Artifact Revisions）";
        var artBadge = document.createElement("span");
        artBadge.className = "group-status included";
        artBadge.textContent = "included";
        artHead.append(artBadge);
        artGroup.append(artHead);
        var artBody = document.createElement("div");
        artBody.className = "group-body";
        var artCount = (preparedSnapshot && preparedSnapshot.artifacts) ? preparedSnapshot.artifacts.length : 0;
        artBody.textContent = "包含 " + artCount + " 個不可變 Artifact 組件版本。";
        artGroup.append(artBody);
        groupsContainer.append(artGroup);

        // Group: Coverage & Facts
        var covGroup = document.createElement("div");
        covGroup.className = "provenance-group-item";
        var covHead = document.createElement("div");
        covHead.className = "group-header";
        covHead.textContent = "4. 來源改編與事實覆蓋（Coverage & Facts）";
        var hasCov = composition.assessment !== undefined;
        var covBadge = document.createElement("span");
        covBadge.className = "group-status " + (hasCov ? "included" : "not_applicable");
        covBadge.textContent = hasCov ? "included" : "not_applicable";
        covHead.append(covBadge);
        covGroup.append(covHead);
        var covBody = document.createElement("div");
        covBody.className = "group-body";
        var countParts = [];
        if (composition.source_backed) countParts.push("來源佐證 " + composition.source_backed.count);
        if (composition.user_supplement) countParts.push("使用者補充 " + composition.user_supplement.count);
        if (composition.creative_completion) countParts.push("創作補全 " + composition.creative_completion.count);
        covBody.textContent = hasCov ? countParts.join(" · ") : "非來源改編專案。";
        covGroup.append(covBody);
        groupsContainer.append(covGroup);

        // Group: Quality Policy
        var qualGroup = document.createElement("div");
        qualGroup.className = "provenance-group-item";
        var qualHead = document.createElement("div");
        qualHead.className = "group-header";
        qualHead.textContent = "5. 品質門檻與覆寫（Quality Policy）";
        var qualBadge = document.createElement("span");
        qualBadge.className = "group-status included";
        qualBadge.textContent = "included";
        qualHead.append(qualBadge);
        qualGroup.append(qualHead);
        var qualBody = document.createElement("div");
        qualBody.className = "group-body";
        var qualOverrides = Array.isArray(composition.quality_overrides) ? composition.quality_overrides.length : 0;
        qualBody.textContent = (preparedSnapshot && preparedSnapshot.quality_policy && preparedSnapshot.quality_policy.level ? "門檻：" + preparedSnapshot.quality_policy.level : "預設門檻") + " · " + qualOverrides + " 項品質覆寫。";
        qualGroup.append(qualBody);
        groupsContainer.append(qualGroup);

        // Group: Predicted Outputs
        var outGroup = document.createElement("div");
        outGroup.className = "provenance-group-item";
        var outHead = document.createElement("div");
        outHead.className = "group-header";
        outHead.textContent = "6. 預期發布產物（Predicted Outputs）";
        var outBadge = document.createElement("span");
        outBadge.className = "group-status included";
        outBadge.textContent = "included";
        outHead.append(outBadge);
        outGroup.append(outHead);
        var outBody = document.createElement("div");
        outBody.className = "group-body";
        var outFiles = (preparedSnapshot && preparedSnapshot.predicted_outputs && preparedSnapshot.predicted_outputs.files) ? preparedSnapshot.predicted_outputs.files : ["exports/card.json", "exports/card.png"];
        outBody.textContent = "輸出檔案： " + outFiles.join("、 ");
        outGroup.append(outBody);
        groupsContainer.append(outGroup);

        card.append(groupsContainer);

        // Drill-downs
        var drilldowns = document.createElement("div");
        drilldowns.style.marginTop = "0.75rem";
        drilldowns.append(provenanceSection("來源佐證 source-backed（" + (composition.source_backed ? composition.source_backed.count : 0) + "）", composition.source_backed ? composition.source_backed.refs : []));
        var supSec = provenanceSection("使用者補充 user supplement（" + (composition.user_supplement ? composition.user_supplement.count : 0) + "）", composition.user_supplement ? composition.user_supplement.refs : []);
        supSec.className += " supplement";
        drilldowns.append(supSec);
        var creaSec = provenanceSection("創作補全 creative completion（" + (composition.creative_completion ? composition.creative_completion.count : 0) + "）", composition.creative_completion ? composition.creative_completion.refs : []);
        creaSec.className += " creative";
        drilldowns.append(creaSec);

        var activeOverrideSection = document.createElement("details");
        activeOverrideSection.className = "provenance-section";
        var activeOverrideSummary = document.createElement("summary");
        activeOverrideSummary.textContent = "Active coverage decisions／overrides（" + (Array.isArray(composition.overrides) ? composition.overrides.length : 0) + "）";
        activeOverrideSection.append(activeOverrideSummary);
        activeOverrideSection.append(overrideList(composition.overrides));
        drilldowns.append(activeOverrideSection);

        var qualityOverrideSection = document.createElement("details");
        qualityOverrideSection.className = "provenance-section";
        var qualityOverrideSummary = document.createElement("summary");
        qualityOverrideSummary.textContent = "Quality overrides（" + (Array.isArray(composition.quality_overrides) ? composition.quality_overrides.length : 0) + "）";
        qualityOverrideSection.append(qualityOverrideSummary);
        qualityOverrideSection.append(overrideList(composition.quality_overrides.map(function (item) {
          return { decision_id: String(item.code), action: "quality_override", requirement_ids: [], rationale: item.reason, supersedes: undefined };
        })));
        drilldowns.append(qualityOverrideSection);

        var identities = document.createElement("details");
        identities.className = "provenance-section";
        var identitiesSummary = document.createElement("summary");
        identitiesSummary.textContent = "Snapshot identities（完整審計雜湊值）";
        identities.append(identitiesSummary);
        var identityBox = document.createElement("div");
        if (composition.assessment) hashRow("評估 assessment", composition.assessment.id + "@" + composition.assessment.revision, identityBox);
        if (composition.requirement_set) hashRow("requirement set", composition.requirement_set.id + "@" + composition.requirement_set.revision, identityBox);
        if (composition.fact_review_run) hashRow("fact review run", composition.fact_review_run.id + "@" + (composition.fact_review_run.projection_revision || "?"), identityBox);
        if (composition.fact_projection_revision) hashRow("fact projection revision", composition.fact_projection_revision, identityBox);
        if (Array.isArray(composition.source_revisions) && composition.source_revisions.length > 0) {
          hashRow("來源 revisions", composition.source_revisions.map(function (ref) { return ref.source_id + "@" + ref.revision; }).join(", "), identityBox);
        }
        if (Array.isArray(composition.resolution_ids) && composition.resolution_ids.length > 0) hashRow("resolution IDs", composition.resolution_ids.join(", "), identityBox);
        if (Array.isArray(composition.authoring_binding_ids) && composition.authoring_binding_ids.length > 0) hashRow("authoring binding IDs", composition.authoring_binding_ids.join(", "), identityBox);
        if (composition.coverage_snapshot_hash) hashRow("coverage snapshot hash", composition.coverage_snapshot_hash, identityBox);
        if (composition.build_snapshot_hash) {
          var legacyNote = composition.compiled_content_hash === undefined ? "legacy identity" : undefined;
          hashRow("build snapshot hash（build input identity）", composition.build_snapshot_hash, identityBox, legacyNote);
        }
        if (composition.compiled_content_hash) hashRow("compiled content hash（compiler output identity）", composition.compiled_content_hash, identityBox);
        hashRow("provenance confirmation fingerprint", fingerprint, identityBox);
        identities.append(identityBox);
        drilldowns.append(identities);

        card.append(drilldowns);

        // Human readable acknowledgement box
        var ackBox = document.createElement("div");
        ackBox.className = "human-ack-box";
        var ackTitle = document.createElement("strong");
        ackTitle.textContent = "發布確認聲明：";
        ackBox.append(ackTitle);
        var ackText = document.createElement("div");
        ackText.textContent = (preparedSnapshot && preparedSnapshot.human_acknowledgement)
          ? preparedSnapshot.human_acknowledgement
          : "我確認並批准目前畫面所顯示的模式、圖片、Artifacts、Coverage、Facts、來源、品質政策與輸出組成；本次發布只適用於這份不可變快照。";
        ackBox.append(ackText);
        card.append(ackBox);

        target.append(card);

        if (confirmButton) {
          confirmButton.disabled = currentProvenanceConfirmation.fingerprint === "";
          confirmButton.textContent = Array.isArray(composition.overrides) && composition.overrides.length > 0
            ? "確認覆寫並發布（" + composition.overrides.length + " 筆 active override）"
            : "確認並發布";
        }
        byId("provenance-confirm-message").textContent = "已準備完成；確認後將以此份不可變快照（Fingerprint: " + fingerprint.slice(0, 8) + "）執行發布。";
        updatePublishStepper("provenance_reviewed", "current", { overrides_count: (composition.overrides ? composition.overrides.length : 0) });
      }

      function renderProvenanceHistory(view) {
        var target = byId("provenance-history");
        target.textContent = "";
        if (!isRecord(view)) return;
        var historical = Array.isArray(view.historical_decisions) ? view.historical_decisions : [];
        if (historical.length === 0 && view.provenance_summary === undefined && view.legacy_build_snapshot_hash !== true) return;
        var box = document.createElement("div");
        box.className = "workflow-stage";
        var title = document.createElement("div");
        title.className = "workflow-stage-title";
        title.textContent = "歷史與已取代決策（不計入 active composition）";
        box.append(title);
        box.append(overrideList(historical));
        if (view.legacy_build_snapshot_hash === true) {
          var legacy = document.createElement("div");
          legacy.className = "muted";
          legacy.textContent = "此 build 為舊版記錄：build_snapshot_hash 為舊語意（compiled content hash），不是新版 build-input snapshot identity。";
          box.append(legacy);
        }
        target.append(box);
      }

      function loadProvenanceHistory() {
        return requestJson("/workspace/dashboard/provenance").then(function (view) {
          renderProvenanceHistory(view);
          return view;
        }).catch(function (error) {
          setAreaError("provenance-history", error);
          return undefined;
        });
      }

      function renderArtifactList(snapshot) {
        var target = byId("artifact-list");
        target.textContent = "";
        var artifactItems = Array.isArray(snapshot.items) ? snapshot.items : (Array.isArray(snapshot.artifacts) ? snapshot.artifacts : []);
        var groups = Array.isArray(snapshot.artifact_groups) ? snapshot.artifact_groups : [];
        if (groups.length === 0 && artifactItems.length > 0) {
          for (var itemIndex = 0; itemIndex < artifactItems.length; itemIndex += 1) {
            var item = artifactItems[itemIndex];
            if (!isRecord(item)) continue;
            var existing = groups.find(function (candidate) { return isRecord(candidate) && candidate.key === item.key; });
            if (existing) {
              if (!Array.isArray(existing.revisions)) existing.revisions = [];
              existing.revisions.push(item);
              existing.current = item;
            } else {
              groups.push({ key: item.key, current: item, revisions: [item] });
            }
          }
        }
        if (groups.length === 0) {
          byId("artifact-message").textContent = "目前沒有 artifact。";
        } else {
          byId("artifact-message").textContent = "共 " + groups.length + " 個 artifact key（" + (typeof snapshot.total === "number" ? snapshot.total : artifactItems.length) + " 個 revision）。";
        }
        var reviews = Array.isArray(snapshot.reviews) ? snapshot.reviews : [];
        for (var i = 0; i < groups.length; i += 1) {
          var group = groups[i];
          if (!isRecord(group) || !isRecord(group.current)) continue;
          var current = group.current;
          var revisions = Array.isArray(group.revisions) ? group.revisions : [current];
          var row = document.createElement("div");
          row.className = "artifact-row";
          var artifactId = firstString(current, ["id"]);
          if (artifactId) {
            row.setAttribute("data-object-kind", "artifact");
            row.setAttribute("data-object-id", artifactId);
          }
          var badge = document.createElement("span");
          badge.className = "status-badge " + statusClass(firstString(current, ["status"]) || "draft");
          badge.textContent = firstString(current, ["kind"]) || "?";
          var name = document.createElement("span");
          name.textContent = firstString(current, ["name"]) || firstString(current, ["id"]) || "?";
          var currentBadge = document.createElement("span");
          currentBadge.className = "current-badge";
          currentBadge.textContent = "目前版本";
          var meta = document.createElement("span");
          var parts = ["rev " + String(firstString(current, ["revision"]) || "?").slice(0, 8)];
          if (current.created_by) parts.push("by " + current.created_by);
          if (current.blueprint_precheck_id) parts.push("binding " + String(firstString(current, ["blueprint_precheck_revision"]) || "?").slice(0, 8));
          var artifactReviews = reviews.filter(function (review) { return isRecord(review) && review.artifact_id === current.id; });
          if (artifactReviews.length > 0) parts.push("reviewer " + (firstString(artifactReviews[artifactReviews.length - 1], ["reviewer"]) || "?"));
          if (revisions.length > 1) parts.push("歷史 " + revisions.length + " 個 revision");
          meta.textContent = parts.join(" · ");
          var actions = document.createElement("span");
          actions.className = "artifact-actions";
          actions.append(
            makeActionButton("原始內容", function () { toggleArtifactRaw(row, current); }),
            makeActionButton("與前一版差異", function () { toggleArtifactDiff(row, current, revisions); }),
            makeActionButton("送審", function () { submitArtifactForReview(firstString(current, ["name"]) || firstString(current, ["id"]) || ""); }),
            makeActionButton("下載", function () { downloadArtifact(current); }),
            makeActionButton("覆蓋關聯", function () { toggleArtifactLineage(row, current); })
          );
          row.append(badge, currentBadge, name, meta, actions);
          target.append(row);
        }
        var blueprint = snapshot.blueprint;
        byId("blueprint-json").textContent = blueprint === undefined ? "{}" : jsonText(blueprint);
      }

      function makeActionButton(label, handler) {
        var button = document.createElement("button");
        button.type = "button";
        button.className = "action-link";
        button.textContent = label;
        button.addEventListener("click", handler);
        return button;
      }

      function toggleArtifactLineage(row, artifact) {
        var detail = findRowDetail(row, "artifact-lineage");
        if (detail !== null) {
          detail.hidden = !detail.hidden;
          return;
        }
        var artifactId = firstString(artifact, ["id"]);
        if (!artifactId) return;
        var container = document.createElement("div");
        container.className = "artifact-detail artifact-lineage";
        var loading = document.createElement("div");
        loading.textContent = "載入覆蓋關聯…";
        container.append(loading);
        row.append(container);
        requestJson("/workspace/dashboard/artifacts/" + encodeURIComponent(artifactId) + "/coverage").then(function (lineage) {
          container.textContent = "";
          if (lineage === undefined || lineage === null) {
            container.textContent = "此 artifact 不在覆蓋綁定範圍內。";
            return;
          }
          var heading = document.createElement("div");
          heading.className = "detail-heading";
          var badge = document.createElement("span");
          badge.className = "status-badge " + (lineage.state === "current" ? "ready" : "error");
          badge.textContent = lineage.state;
          heading.append(badge);
          heading.append(" 覆蓋綁定");
          container.append(heading);
          if (lineage.reason) {
            var reason = document.createElement("div");
            reason.className = "muted";
            reason.textContent = "原因：" + lineage.reason;
            container.append(reason);
          }
          var parts = [];
          if (lineage.assessment) parts.push("評估 " + lineage.assessment.id + "@" + lineage.assessment.revision.slice(0, 8));
          if (lineage.requirement_set) parts.push("requirement set " + lineage.requirement_set.revision.slice(0, 8));
          if (lineage.fact_projection_revision) parts.push("fact projection " + lineage.fact_projection_revision.slice(0, 8));
          if (lineage.fact_review_run) parts.push("review run " + lineage.fact_review_run.id.slice(0, 8));
          if (lineage.binding) parts.push("binding " + lineage.binding.id.slice(0, 8));
          if (lineage.input_snapshot_hash) parts.push("input snapshot " + lineage.input_snapshot_hash.slice(0, 8));
          if (lineage.resolution_ids && lineage.resolution_ids.length > 0) parts.push("resolutions " + lineage.resolution_ids.map(function (id) { return id.slice(0, 8); }).join(", "));
          var meta = document.createElement("div");
          meta.className = "muted";
          meta.textContent = parts.join(" · ");
          container.append(meta);
        }).catch(function (error) {
          loading.textContent = errorText(error);
        });
      }

      function artifactDisplayContent(artifact) {
        var content = firstString(artifact, ["content"]);
        if (content === "") return content;
        var mediaType = firstString(artifact, ["media_type"]);
        if (mediaType === "application/json") {
          try {
            return JSON.stringify(JSON.parse(content), null, 2);
          } catch (ignore) {
            return content;
          }
        }
        return content;
      }

      function toggleArtifactRaw(row, artifact) {
        var detail = findRowDetail(row, "artifact-raw");
        if (detail !== null) {
          detail.hidden = !detail.hidden;
          return;
        }
        var artifactId = firstString(artifact, ["id"]);
        if (!hasOwn(artifact, "content") && artifactId) {
          var loading = document.createElement("div");
          loading.className = "artifact-detail artifact-raw";
          loading.textContent = "Loading artifact detail…";
          row.append(loading);
          requestJson("/workspace/dashboard/artifacts/" + encodeURIComponent(artifactId)).then(function (fullArtifact) {
            loading.textContent = "";
            var heading = document.createElement("div");
            heading.className = "detail-heading";
            heading.textContent = "Artifact detail";
            var pre = document.createElement("pre");
            pre.textContent = artifactDisplayContent(fullArtifact);
            loading.append(heading, pre);
          }).catch(function (error) {
            loading.textContent = errorText(error);
          });
          return;
        }
        var container = document.createElement("div");
        container.className = "artifact-detail artifact-raw";
        var heading = document.createElement("div");
        heading.className = "detail-heading";
        heading.textContent = "原始內容（rendered：JSON 格式化後顯示）";
        var pre = document.createElement("pre");
        pre.textContent = artifactDisplayContent(artifact);
        container.append(heading, pre);
        row.append(container);
        container.hidden = false;
      }

      function renderArtifactDiff(container, current, previous) {
        var heading = document.createElement("div");
        heading.className = "detail-heading";
        heading.textContent = "Artifact diff";
        if (!isRecord(previous)) {
          heading.textContent = "No previous artifact revision.";
          container.append(heading);
          return;
        }
        heading.textContent = "Diff " + String(firstString(previous, ["revision"]) || "?").slice(0, 8) + " → " + String(firstString(current, ["revision"]) || "?").slice(0, 8);
        var lines = lineDiff(firstString(previous, ["content"]) || "", firstString(current, ["content"]) || "");
        var pre = document.createElement("pre");
        pre.className = "diff-view";
        for (var i = 0; i < lines.length; i += 1) {
          var lineNode = document.createElement("div");
          lineNode.textContent = lines[i].text;
          if (lines[i].type === "added") lineNode.className = "diff-added";
          else if (lines[i].type === "removed") lineNode.className = "diff-removed";
          pre.append(lineNode);
        }
        container.append(heading, pre);
      }

      function toggleArtifactDiff(row, current, revisions) {
        var detail = findRowDetail(row, "artifact-diff");
        if (detail !== null) {
          detail.hidden = !detail.hidden;
          return;
        }
        if (!hasOwn(current, "content") || revisions.length <= 1 || !hasOwn(revisions[revisions.length - 2], "content")) {
          var loading = document.createElement("div");
          loading.className = "artifact-detail artifact-diff";
          loading.textContent = "Loading artifact history…";
          row.append(loading);
          var currentId = firstString(current, ["id"]);
          var key = firstString(current, ["key"]) || currentId || "";
          requestJson("/workspace/dashboard/artifacts/" + encodeURIComponent(key) + "/history?limit=200").then(function (history) {
            var items = Array.isArray(history.items) ? history.items : [];
            var previous = items.length > 1 ? items[items.length - 2] : undefined;
            var currentItem = items.length > 0 ? items[items.length - 1] : current;
            var requests = [];
            if (isRecord(currentItem) && !hasOwn(currentItem, "content") && firstString(currentItem, ["id"])) {
              requests.push(requestJson("/workspace/dashboard/artifacts/" + encodeURIComponent(firstString(currentItem, ["id"]))).then(function (value) { currentItem = value; }));
            }
            if (isRecord(previous) && !hasOwn(previous, "content") && firstString(previous, ["id"])) {
              requests.push(requestJson("/workspace/dashboard/artifacts/" + encodeURIComponent(firstString(previous, ["id"]))).then(function (value) { previous = value; }));
            }
            return Promise.all(requests).then(function () {
              loading.textContent = "";
              renderArtifactDiff(loading, currentItem, previous);
            });
          }).catch(function (error) {
            loading.textContent = errorText(error);
          });
          return;
        }
        var container = document.createElement("div");
        container.className = "artifact-detail artifact-diff";
        var heading = document.createElement("div");
        heading.className = "detail-heading";
        var previous = revisions.length > 1 ? revisions[revisions.length - 2] : undefined;
        if (!isRecord(previous)) {
          heading.textContent = "與前一版差異：這是此 key 的第一版，沒有前一版可比對。";
        } else {
          heading.textContent = "與前一版差異（" + String(firstString(previous, ["revision"]) || "?").slice(0, 8) + " → " + String(firstString(current, ["revision"]) || "?").slice(0, 8) + "）";
          var lines = lineDiff(firstString(previous, ["content"]) || "", firstString(current, ["content"]) || "");
          var pre = document.createElement("pre");
          pre.className = "diff-view";
          pre.textContent = "";
          for (var i = 0; i < lines.length; i += 1) {
            var lineNode = document.createElement("div");
            lineNode.textContent = lines[i].text;
            if (lines[i].type === "added") {
              lineNode.className = "diff-added";
            } else if (lines[i].type === "removed") {
              lineNode.className = "diff-removed";
            }
            pre.append(lineNode);
          }
          container.append(heading, pre);
        }
        row.append(container);
        container.hidden = false;
      }

      function findRowDetail(row, className) {
        for (var i = 0; i < row.children.length; i += 1) {
          var child = row.children[i];
          if (typeof child.className === "string" && child.className.indexOf(className) >= 0) return child;
        }
        return null;
      }

      function lineDiff(previous, current) {
        var oldLines = previous.split("\n");
        var newLines = current.split("\n");
        var rows = [];
        for (var i = 0; i < oldLines.length; i += 1) rows.push({ text: oldLines[i], type: "same" });
        var oldSet = {};
        for (var j = 0; j < oldLines.length; j += 1) oldSet[oldLines[j]] = true;
        var added = [];
        for (var k = 0; k < newLines.length; k += 1) {
          if (oldSet[newLines[k]]) {
            while (added.length > 0) rows.push(added.shift());
          } else {
            added.push({ text: newLines[k], type: "added" });
          }
        }
        while (added.length > 0) rows.push(added.shift());
        var removed = [];
        var newSet = {};
        for (var m = 0; m < newLines.length; m += 1) newSet[newLines[m]] = true;
        var rebuilt = [];
        for (var n = 0; n < rows.length; n += 1) {
          if (rows[n].type === "same" && !newSet[rows[n].text]) {
            removed.push({ text: rows[n].text, type: "removed" });
          } else {
            while (removed.length > 0) rebuilt.push(removed.shift());
            rebuilt.push(rows[n]);
          }
        }
        while (removed.length > 0) rebuilt.push(removed.shift());
        return rebuilt;
      }

      function submitArtifactForReview(name) {
        if (name === "") {
          byId("artifact-message").textContent = "找不到可送審的 artifact 名稱。";
          return;
        }
        postJson("/workspace/request", { request: "Review " + name }).then(function () {
          byId("artifact-message").textContent = "已送出審查請求：" + name;
          refresh();
        }).catch(function (error) {
          setAreaError("artifact-message", error);
        });
      }

      function downloadArtifact(artifact) {
        if (!hasOwn(artifact, "content") && firstString(artifact, ["id"])) {
          requestJson("/workspace/dashboard/artifacts/" + encodeURIComponent(firstString(artifact, ["id"]))).then(downloadArtifact).catch(function (error) {
            setAreaError("artifact-message", error);
          });
          return;
        }
        var content = firstString(artifact, ["content"]);
        if (content === "") {
          byId("artifact-message").textContent = "此 artifact 沒有可下載的內容。";
          return;
        }
        var mediaType = firstString(artifact, ["media_type"]) || "text/plain";
        var extension = mediaType === "application/json" ? ".json" : mediaType === "text/markdown" ? ".md" : ".txt";
        var blob = new Blob([content], { type: mediaType });
        var url = URL.createObjectURL(blob);
        var link = document.createElement("a");
        link.href = url;
        link.download = (firstString(artifact, ["name"]) || firstString(artifact, ["id"]) || "artifact") + extension;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      }

      var cachedOperations = [];
      var OPERATION_FILTERS = { all: "", active: "created,resolving,running,partial", needs_input: "needs_input", failed: "failed", cancelled: "cancelled", terminal: "completed,cancelled,failed" };
      var SEVERITY_RANK = { critical: 4, error: 3, warning: 2, info: 1 };
      var SEVERITIES = ["critical", "error", "warning", "info"];
      var currentOverrides = {};
      var repairPlanHash = "";

      function operationMatchesFilter(operation, filter) {
        var states = OPERATION_FILTERS[filter] || "";
        if (states === "") return true;
        return states.split(",").indexOf(operation.status || "unknown") !== -1;
      }

      function answerNeedsInput(operationId, input) {
        return function () {
          if (state.busy) return;
          var value = input.value.trim();
          if (!value) {
            localValidation("Operation 回答", "回答不可為空。");
            return;
          }
          var body = { request: value, target_operation_id: operationId, operation_id: operationId };
          void runTask("回答 Operation", async function () {
            var payload = await postJson("/workspace/request", body);
            await loadDashboardData();
            return payload;
          });
        };
      }

      function retryOperation(operationId) {
        return function () {
          postOperation("recover", operationId);
        };
      }

      function confirmCancel(operationId) {
        return function () {
          if (state.busy) return;
          if (!window.confirm("確定要取消 operation " + operationId + "？此操作將被標記為取消。")) return;
          postOperation("fail", operationId);
        };
      }

      function openReuploadModal(operation) {
        var overlay = document.createElement("div");
        overlay.id = "reupload-modal-overlay";
        overlay.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;";

        var modal = document.createElement("div");
        modal.style.cssText = "background:#fff;border-radius:8px;max-width:500px;width:100%;padding:24px;box-shadow:0 4px 20px rgba(0,0,0,0.25);font-family:inherit;";

        var title = document.createElement("h3");
        title.style.cssText = "margin-top:0;margin-bottom:12px;";
        title.textContent = "重新上傳附件 — Operation " + operation.id;
        modal.appendChild(title);

        var desc = document.createElement("p");
        desc.style.cssText = "font-size:0.9em;color:#555;margin-bottom:12px;";
        desc.textContent = "此操作需要附件檔案才能繼續重播。請選取對應的檔案進行補傳：";
        modal.appendChild(desc);

        var errBox = document.createElement("div");
        errBox.style.cssText = "color:#dc3545;font-weight:bold;margin-bottom:12px;display:none;font-size:0.9em;";
        modal.appendChild(errBox);

        var fileInput = document.createElement("input");
        fileInput.type = "file";
        fileInput.multiple = true;
        fileInput.style.cssText = "display:block;margin-bottom:16px;width:100%;";
        modal.appendChild(fileInput);

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
        submitBtn.textContent = "確認上傳並繼續重播";
        submitBtn.style.cssText = "padding:8px 16px;border:none;background:#0066cc;color:#fff;border-radius:4px;cursor:pointer;font-weight:bold;";

        submitBtn.addEventListener("click", async function () {
          var files = fileInput.files;
          if (!files || files.length === 0) {
            errBox.textContent = "請選擇至少一個檔案。";
            errBox.style.display = "block";
            return;
          }
          errBox.style.display = "none";
          submitBtn.disabled = true;
          submitBtn.textContent = "讀取中...";

          var replacements = [];
          for (var i = 0; i < files.length; i += 1) {
            var file = files[i];
            var buffer = await file.arrayBuffer();
            var bytes = new Uint8Array(buffer);
            var binary = "";
            for (var b = 0; b < bytes.byteLength; b += 1) binary += String.fromCharCode(bytes[b]);
            var b64 = window.btoa(binary);
            replacements.push({
              name: file.name,
              content_base64: b64,
              media_type: file.type || "text/plain",
            });
          }

          submitBtn.textContent = "上傳中...";
          try {
            var res = await postJson("/workspace/operation/attachments/reupload", {
              operation_id: operation.id,
              replacements: replacements,
            });
            overlay.remove();
            await loadOperationData();
            if (res && res.summary) setNotice("success", res.summary);
          } catch (e) {
            submitBtn.disabled = false;
            submitBtn.textContent = "確認上傳並繼續重播";
            errBox.textContent = "上傳失敗：" + (e.message || String(e));
            errBox.style.display = "block";
          }
        });

        actionRow.appendChild(submitBtn);
        modal.appendChild(actionRow);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
      }

      function renderOperationList(operations) {
        var target = byId("operation-list");
        var filter = byId("operation-filter").value;
        cachedOperations = Array.isArray(operations) ? operations : [];
        target.textContent = "";
        if (cachedOperations.length === 0) {
          byId("operation-message").textContent = "目前沒有 operation。";
          return;
        }
        var visible = [];
        for (var i = 0; i < cachedOperations.length; i += 1) {
          if (isRecord(cachedOperations[i]) && operationMatchesFilter(cachedOperations[i], filter)) visible.push(cachedOperations[i]);
        }
        byId("operation-message").textContent = "共 " + cachedOperations.length + " 個 operation（顯示 " + visible.length + " 個）。";
        for (var j = 0; j < visible.length; j += 1) {
          var operation = visible[j];
          var row = document.createElement("div");
          row.className = "operation-row";
          row.setAttribute("data-object-kind", "operation");
          row.setAttribute("data-object-id", operation.id);
          var badge = document.createElement("span");
          badge.className = "status-badge " + statusClass(operation.status || "unknown");
          badge.textContent = firstString(operation, ["status"]) || "?";
          var label = document.createElement("span");
          var labelParts = [firstString(operation, ["kind"]) || "?", firstString(operation, ["request"]) || ""];
          if (operation.attempt) labelParts.push("attempt " + operation.attempt);
          if (operation.lease_owner) {
            var remainingText = operation.lease_expires_at ? " 剩餘 " + Math.max(0, Math.round((new Date(operation.lease_expires_at).getTime() - Date.now()) / 1000)) + "s" : "";
            labelParts.push("lease " + operation.lease_owner + remainingText);
          }
          if ((operation.status === "running" || operation.status === "partial") && typeof operation.progress_count === "number") labelParts.push("progress " + operation.progress_count);
          if ((operation.status === "running" || operation.status === "partial") && Array.isArray(operation.progress) && operation.progress.length > 0) {
            var lastProgress = operation.progress[operation.progress.length - 1];
            if (isRecord(lastProgress) && firstString(lastProgress, ["message"])) labelParts.push("step: " + firstString(lastProgress, ["message"]));
          }
          if (operation.status === "needs_input" && operation.question) labelParts.push("問題: " + operation.question);

          var replayState = operation.replayability ? operation.replayability.state : (operation.error_class === "recoverable" ? "replayable" : "non_replayable");
          if (replayState === "replayable") labelParts.push("可重播");
          else if (replayState === "requires_reupload") labelParts.push("需要重新上傳附件");
          else if (replayState === "non_replayable" && operation.replayability && operation.replayability.reason) labelParts.push(operation.replayability.reason);

          if (operation.replayability && operation.replayability.attachment_count > 0) {
            var attNames = operation.replayability.attachments.map(function (a) { return a.name; }).join(", ");
            labelParts.push("附件 (" + operation.replayability.attachment_count + "): " + attNames);
          }

          if (operation.last_error) labelParts.push("error: " + operation.last_error);
          label.textContent = labelParts.join(" · ");
          row.append(badge, label);

          var actions = document.createElement("span");
          actions.className = "inline-actions";
          var status = operation.status || "unknown";

          if (replayState === "requires_reupload") {
            var reuploadBtn = document.createElement("button");
            reuploadBtn.type = "button";
            reuploadBtn.textContent = "重新上傳附件";
            reuploadBtn.addEventListener("click", (function (op) {
              return function () { openReuploadModal(op); };
            })(operation));
            var cancelReuploadBtn = document.createElement("button");
            cancelReuploadBtn.type = "button";
            cancelReuploadBtn.textContent = "取消";
            cancelReuploadBtn.addEventListener("click", confirmCancel(operation.id));
            actions.append(reuploadBtn, cancelReuploadBtn);
          } else if (status === "needs_input") {
            var answer = document.createElement("input");
            answer.type = "text";
            answer.placeholder = "回答此問題…";
            var send = document.createElement("button");
            send.type = "button";
            send.textContent = "送出";
            send.addEventListener("click", answerNeedsInput(operation.id, answer));
            var cancelBtn = document.createElement("button");
            cancelBtn.type = "button";
            cancelBtn.textContent = "取消";
            cancelBtn.addEventListener("click", confirmCancel(operation.id));
            actions.append(answer, send, cancelBtn);
          } else if (replayState === "replayable") {
            var retry = document.createElement("button");
            retry.type = "button";
            retry.textContent = "重試";
            retry.addEventListener("click", retryOperation(operation.id));
            actions.append(retry);
            if (status === "created" || status === "resolving" || status === "running" || status === "partial") {
              var cancel = document.createElement("button");
              cancel.type = "button";
              cancel.textContent = "取消";
              cancel.addEventListener("click", confirmCancel(operation.id));
              actions.append(cancel);
            }
          } else if (status === "cancelled") {
            var newReq = document.createElement("button");
            newReq.type = "button";
            newReq.textContent = "建立新工作";
            newReq.addEventListener("click", function () {
              var inputEl = byId("request-input");
              if (inputEl) {
                inputEl.focus();
                inputEl.scrollIntoView({ behavior: "smooth" });
              }
            });
            actions.append(newReq);
          } else if (status === "created" || status === "resolving" || status === "running" || status === "partial") {
            var cancelOnly = document.createElement("button");
            cancelOnly.type = "button";
            cancelOnly.textContent = "取消";
            cancelOnly.addEventListener("click", confirmCancel(operation.id));
            actions.append(cancelOnly);
          }
          row.append(actions);
          target.append(row);
        }
      }

`;
