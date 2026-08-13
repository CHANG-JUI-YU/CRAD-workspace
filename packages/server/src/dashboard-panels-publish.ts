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
            makeActionButton("下載", function () { downloadArtifact(current); })
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
          if (operation.status !== "cancelled" && operation.error_class === "recoverable") labelParts.push("可安全重試");
          if (operation.status !== "cancelled" && operation.error_class === "fatal") labelParts.push("需人工重送");
          if (operation.last_error) labelParts.push("error: " + operation.last_error);
          label.textContent = labelParts.join(" · ");
          row.append(badge, label);
          var actions = document.createElement("span");
          actions.className = "inline-actions";
          var status = operation.status || "unknown";
          if (status === "needs_input") {
            var answer = document.createElement("input");
            answer.type = "text";
            answer.placeholder = "回答此問題…";
            var send = document.createElement("button");
            send.type = "button";
            send.textContent = "送出";
            send.addEventListener("click", answerNeedsInput(operation.id, answer));
            actions.append(answer, send);
          } else if (status === "failed") {
            if (operation.error_class !== "fatal") {
              var retry = document.createElement("button");
              retry.type = "button";
              retry.textContent = "重試";
              retry.addEventListener("click", retryOperation(operation.id));
              actions.append(retry);
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
            var cancel = document.createElement("button");
            cancel.type = "button";
            cancel.textContent = "取消";
            cancel.addEventListener("click", confirmCancel(operation.id));
            actions.append(cancel);
          }
          row.append(actions);
          target.append(row);
        }
      }

`;
