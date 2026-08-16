export const DASHBOARD_PANELS_CORE_JS = `      function byId(value) {
        return document.getElementById(value);
      }

      function makeElement(tagName, className, text) {
        var node = document.createElement(tagName);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
      }

      function isRecord(value) {
        return value !== null && typeof value === "object" && !Array.isArray(value);
      }

      function hasOwn(record, key) {
        return isRecord(record) && Object.prototype.hasOwnProperty.call(record, key);
      }

      function firstString(record, keys) {
        for (var index = 0; index < keys.length; index += 1) {
          var key = keys[index];
          if (hasOwn(record, key) && typeof record[key] === "string" && record[key].trim().length > 0) {
            return record[key];
          }
        }
        return undefined;
      }

      function valueText(value) {
        if (value === undefined || value === null) return "—";
        if (typeof value === "string") return value;
        if (typeof value === "number" || typeof value === "boolean") return String(value);
        try {
          return JSON.stringify(value);
        } catch (error) {
          return String(value);
        }
      }

      function jsonText(value) {
        try {
          return JSON.stringify(value, null, 2);
        } catch (error) {
          return String(value);
        }
      }

      function lastPathSegment(value) {
        if (typeof value !== "string" || value.trim().length === 0) return undefined;
        var separator = String.fromCharCode(92);
        var slash = Math.max(value.lastIndexOf("/"), value.lastIndexOf(separator));
        return value.slice(slash + 1) || undefined;
      }

      function projectEntries(payload) {
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
      }

      function projectReference(record) {
        if (!isRecord(record)) return "";
        return firstString(record, ["project_name", "name", "label", "project", "folder_name", "slug"])
          || lastPathSegment(firstString(record, ["project_path", "path"]))
          || firstString(record, ["project_id", "id"])
          || "";
      }

      function statusClass(status) {
        if (["completed", "complete", "ready", "published"].indexOf(status) >= 0) return "ready";
        if (["created", "resolving", "running", "needs_input", "partial", "active", "interviewing"].indexOf(status) >= 0) return "active";
        if (["cancelled"].indexOf(status) >= 0) return "cancelled";
        if (["failed", "error"].indexOf(status) >= 0) return "error";
        return "";
      }

      function readableStatus(status) {
        var labels = {
          completed: "已完成",
          complete: "已完成",
          ready: "就緒",
          published: "已發布",
          created: "已建立",
          resolving: "解析中",
          running: "執行中",
          needs_input: "等待輸入",
          partial: "部分完成",
          active: "進行中",
          interviewing: "訪談中",
          failed: "失敗",
          cancelled: "已取消"
        };
        return labels[status] || status || "未知";
      }

      function renderFields(container, record) {
        container.replaceChildren();
        var used = {};
        var preferred = [
          { label: "名稱", keys: ["project_name", "name", "project", "label"] },
          { label: "狀態", keys: ["status", "project_status"] },
          { label: "revision", keys: ["revision", "project_revision"] },
          { label: "角色", keys: ["agent_role", "role", "actor"] },
          { label: "mode", keys: ["mode", "operation_mode"] },
          { label: "operation", keys: ["operation_id", "operation"] },
          { label: "問題", keys: ["question", "interview_question"] },
          { label: "摘要", keys: ["summary"] }
        ];
        preferred.forEach(function (group) {
          for (var index = 0; index < group.keys.length; index += 1) {
            var key = group.keys[index];
            if (hasOwn(record, key) && record[key] !== undefined && record[key] !== null) {
              used[key] = true;
              appendField(container, group.label, valueText(record[key]));
              break;
            }
          }
        });
        if (isRecord(record)) {
          Object.keys(record).forEach(function (key) {
            if (used[key]) return;
            appendField(container, key, valueText(record[key]));
          });
        }
      }

      function appendField(container, label, value) {
        var row = makeElement("div", "field-row");
        row.append(makeElement("dt", "", label), makeElement("dd", "", value));
        container.append(row);
      }

      function syncProjectSelection(record) {
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
      }

      function renderProjects(payload) {
        var entries = projectEntries(payload);
        state.projects = entries;
        var select = byId("project-select");
        select.replaceChildren();
        if (entries.length === 0) {
          select.append(makeElement("option", "", "目前沒有可切換專案"));
          byId("projects-message").className = "panel-message";
          byId("projects-message").textContent = "目前沒有可切換專案；自然語言操作與狀態查詢仍可使用。";
        } else {
          entries.forEach(function (entry) {
            var option = makeElement("option", "", entry.label);
            option.value = entry.value;
            select.append(option);
          });
          byId("projects-message").className = "panel-message success";
          byId("projects-message").textContent = "已載入 " + entries.length + " 個可切換專案。";
          syncProjectSelection(state.status);
        }
        updateControls();
      }

      function renderCurrentProject(record) {
        var current = byId("current-project");
        var name = firstString(record, ["project_name", "name", "project", "label"]);
        var status = firstString(record, ["project_status", "status"]);
        current.className = "notice info";
        current.textContent = name
          ? "目前專案：" + name + (status ? "；狀態：" + readableStatus(status) : "")
          : "目前專案名稱尚未提供；可在原始 JSON 查看 API 回傳欄位。";
      }

      function renderStatus(payload) {
        var record = isRecord(payload) ? payload : { value: payload };
        state.status = record;
        renderSession(record);
        var status = firstString(record, ["status", "project_status"]);
        var badge = byId("status-badge");
        badge.className = "status-badge " + statusClass(status);
        badge.textContent = status === undefined && record.selected === false ? "未選擇專案" : readableStatus(status);
        var summary = firstString(record, ["summary", "message"]);
        byId("status-summary").className = "panel-message" + (statusClass(status) === "error" ? " error" : "");
        byId("status-summary").textContent = summary || "API 未提供摘要；請查看下方欄位與原始 JSON。";
        renderFields(byId("status-fields"), record);
        byId("status-json").textContent = jsonText(payload);
        renderCurrentProject(record);
        syncProjectSelection(record);
      }

      function renderKpis(kpis) {
        var target = byId("kpi-list");
        target.textContent = "";
        if (kpis === undefined || kpis === null) return;
        var parts = [];
        var rows = [
          ["未解決需求", kpis.unresolved_requirements],
          ["衝突", kpis.conflicts],
          ["待補齊補充資料", kpis.pending_supplements],
          ["進行中研究任務", kpis.active_research_tasks],
          ["已過期評估", kpis.stale_assessments],
          ["缺少綁定", kpis.missing_bindings],
          ["過期綁定", kpis.stale_bindings],
          ["來源佐證覆蓋率", kpis.source_backed_percent === null ? "不適用" : kpis.source_backed_percent + "%"],
          ["創作補全覆蓋率", kpis.creative_completion_percent === null ? "不適用" : kpis.creative_completion_percent + "%"]
        ];
        for (var i = 0; i < rows.length; i += 1) {
          var item = document.createElement("span");
          item.className = "kpi-item";
          item.textContent = rows[i][0] + "：" + rows[i][1];
          parts.push(item);
        }
        target.append.apply(target, parts);
      }

      var TARGET_QUESTION_SCOPES = {
        "continue_project": "將在目標專案上繼續工作，不會建立新的 Blueprint。",
        "world_project": "將在目標專案上補充世界設定，並以選定範圍更新其 Blueprint。",
        "expansion_project": "將在目標專案上把新角色合併進既有 Blueprint。"
      };

      function renderSession(record) {
        var unselected = isRecord(record) && record.selected === false;
        state.sessionUnselected = unselected;
        var home = byId("home-panel");
        if (home) home.hidden = !unselected;
        document.querySelectorAll(".app-shell .panel").forEach(function (panel) {
          if (panel.id === "home-panel") return;
          if (unselected) {
            panel.hidden = true;
          } else {
            panel.hidden = false;
          }
        });
        if (unselected) renderHomeProjects(record.projects);
      }

      function renderHomeProjects(projects) {
        var target = byId("home-projects");
        if (!target) return;
        var entries = projectEntries(projects);
        if (entries.length === 0) {
          target.className = "panel-message";
          target.textContent = "目前沒有既有專案；請建立新專案開始。";
          return;
        }
        target.className = "panel-message success";
        target.textContent = "既有專案：" + entries.map(function (entry) { return entry.label; }).join("、");
      }

      function renderAgents(payload) {
        var source = isRecord(payload) && Array.isArray(payload.agents)
          ? payload.agents
          : Array.isArray(payload)
            ? payload
            : [];
        state.agents = source;
        var defaultAgent = isRecord(payload) && typeof payload.default_agent === "string" ? payload.default_agent : "director";
        var select = byId("agent-select");
        var list = byId("agent-list");
        select.replaceChildren();
        list.replaceChildren();
        var automatic = makeElement("option", "", "Director（自動路由）");
        automatic.value = "";
        select.append(automatic);
        if (source.length === 0) {
          byId("agents-message").className = "panel-message";
          byId("agents-message").textContent = "目前沒有可列出的 Agent；仍可使用 Director 自動路由。";
        } else {
          source.forEach(function (item, index) {
            var record = isRecord(item) ? item : {};
            var agentId = firstString(record, ["id", "agent_id", "name"]) || (typeof item === "string" ? item : "agent-" + (index + 1));
            var option = makeElement("option", "", agentId);
            option.value = agentId;
            if (agentId === defaultAgent) option.textContent = agentId + "（預設）";
            select.append(option);

            var card = makeElement("article", "agent-card");
            var name = makeElement("div", "agent-name", agentId);
            if (agentId === defaultAgent) name.append(makeElement("span", "agent-tag", "預設"));
            var role = firstString(record, ["role", "agent_role"]);
            var description = firstString(record, ["description", "summary"]);
            var intents = Array.isArray(record.intents) ? record.intents.map(valueText).join("、") : "";
            var details = [role, description, intents].filter(function (value) { return Boolean(value); }).join(" · ");
            card.append(name, makeElement("p", "agent-description", details || "API 未提供描述。"));
            list.append(card);
          });
          byId("agents-message").className = "panel-message success";
          byId("agents-message").textContent = "已載入 " + source.length + " 個 Agent；未指定時由 " + defaultAgent + " 路由。";
        }
        byId("agents-json").textContent = jsonText(payload);
        updateControls();
      }

      function currentQuestion(payload) {
        if (!isRecord(payload)) return null;
        if (isRecord(payload.question)) return payload.question;
        if (isRecord(payload.current)) return payload.current;
        return null;
      }

      function choiceEntries(question, payload) {
        var raw = question && Array.isArray(question.options)
          ? question.options
          : question && Array.isArray(question.choices)
            ? question.choices
            : isRecord(payload) && Array.isArray(payload.choices)
              ? payload.choices
              : [];
        return raw.map(function (item, index) {
          if (typeof item === "string") return { label: item, value: item };
          if (!isRecord(item)) return null;
          var label = firstString(item, ["label", "title", "text", "name"]);
          var value = firstString(item, ["value", "canonical_value", "id", "key", "code"]);
          if (!value) value = label;
          if (!label) label = value || "選項 " + (index + 1);
          return value ? { label: label, value: value } : null;
        }).filter(function (item) { return item !== null; });
      }

      function renderInterview(payload) {
        var question = currentQuestion(payload);
        state.interviewQuestion = question;
        var questionNode = byId("interview-question");
        var choices = byId("interview-choices");
        choices.replaceChildren();
        var questionId = question ? firstString(question, ["id"]) : undefined;
        var targetArea = byId("interview-target-area");
        if (questionId && TARGET_QUESTION_SCOPES[questionId]) {
          var targetSelect = byId("interview-target-select");
          targetSelect.replaceChildren();
          state.projects.forEach(function (entry) {
            var option = makeElement("option", "", entry.label);
            option.value = entry.value;
            targetSelect.append(option);
          });
          byId("interview-target-note").textContent = TARGET_QUESTION_SCOPES[questionId];
          targetArea.hidden = false;
        } else if (targetArea) {
          targetArea.hidden = true;
        }
        if (!question) {
          questionNode.textContent = isRecord(payload) && payload.status === "complete"
            ? "訪談已完成，目前沒有待回答問題。"
            : "目前沒有待回答問題。";
          byId("interview-message").className = "panel-message";
          byId("interview-message").textContent = "API 未提供 current/question；仍可用自然語言 request 操作工作區。";
        } else {
          questionNode.textContent = firstString(question, ["text", "question", "prompt"]) || "目前問題未提供文字。";
          var questionChoices = choiceEntries(question, payload);
          questionChoices.forEach(function (choice) {
            var button = makeElement("button", "choice", choice.label);
            button.type = "button";
            button.addEventListener("click", function () {
              void submitInterviewAnswer(choice.value);
            });
            choices.append(button);
          });
          byId("interview-message").className = "panel-message success";
          byId("interview-message").textContent = questionId && TARGET_QUESTION_SCOPES[questionId]
            ? "請從清單選擇目標專案（revision 顯示在括號中），或直接在下方輸入專案名稱。"
            : questionChoices.length > 0
              ? "請點選一個選項，或在下方輸入文字。選項會提交 canonical value。"
              : "這一題沒有 choices/options，請在下方輸入文字回答。";
        }
        byId("interview-json").textContent = jsonText(payload);
        updateControls();
      }

      function setAreaError(targetId, error) {
        var target = byId(targetId);
        target.className = "panel-message error";
        target.textContent = errorText(error);
      }

      function errorText(error) {
        if (!error) return "發生未知錯誤。下一步：重新整理並確認本機 server。";
        var status = error.status ? "HTTP " + error.status + (error.statusText ? " " + error.statusText : "") + "；" : "";
        var payload = error.payload && isRecord(error.payload) ? error.payload : null;
        var code = payload && firstString(payload, ["code"]) ? firstString(payload, ["code"]) : (error.code || "未提供");
        var messageZh = payload && firstString(payload, ["message_zh"]);
        var message = error.message || "伺服器沒有提供錯誤訊息";
        var impact = payload && firstString(payload, ["impact"]);
        var actions = payload && Array.isArray(payload.next_actions) ? payload.next_actions : [];
        var pieces = [status, "錯誤代碼：" + code];
        if (messageZh) pieces.push("說明：" + messageZh);
        else pieces.push("訊息：" + message);
        if (impact) pieces.push("影響：" + impact);
        pieces.push("下一步：" + (actions.length > 0 ? actions.join("；") : codeHint(code)));
        return pieces.join("；");
      }

      function codeHint(code) {
        var hints = {
          "BLUEPRINT_PRECHECK_REQUIRED": "工作區缺少 Blueprint 預檢：請在訪談中完成角色與世界設定的預檢確認。",
          "ARTIFACT_REVIEW_REQUIRED": "工作區缺少 artifact review：目前 revision 需要不同 reviewer 通過，請送交對應 Critic 或重新審查。",
          "REQUIRED_WORLD_ARTIFACT_MISSING": "世界設定尚未建立：請先建立世界設定，再繼續角色創作。",
          "BLUEPRINT_BINDING_STALE": "artifact 綁定到舊版 Blueprint：請依目前 Blueprint 重新建立該 artifact。",
          "FACT_REVIEW_RUN_MISSING": "事實尚未進入審查：請先整理來源並自動抽取事實。",
          "FACT_REVIEW_COVERAGE_INCOMPLETE": "事實審查未完成：所有候選都需要 accepted 或 rejected 裁決。",
          "FACT_REVIEW_NEEDS_EVIDENCE": "事實缺少證據：請補上來源引文後重新送審。",
          "FACT_REVIEW_CONFLICT": "事實裁決衝突：需要 Director 使用衝突裁決功能處理。",
          "FACT_REVIEW_CONTRADICTION": "已接受的事實彼此矛盾：請送交 Director 裁決哪一筆為真。",
          "SOURCE_RESEARCH_NOT_INGESTED": "來源研究候選尚未入庫：請批准候選來源並執行入庫。",
          "SOURCE_RESEARCH_OFFICIAL_REQUIRED": "缺少官方來源：請搜尋並入庫至少一個官方來源。",
          "WORLD_AUTHORING_ORDER": "世界設定需在角色創作之前完成：請先建立世界設定。",
          "CHARACTER_AUTHORING_ORDER": "角色創作需在世界設定之前完成：請先建立角色設定。",
          "AGENT_READ_ONLY": "該 agent 是唯讀角色：請改由 director 或其他可寫角色執行此操作。",
          "AGENT_CAPABILITY_DENIED": "該 agent 沒有此操作能力：請選擇具備對應能力的 agent。",
          "REVISION_CONFLICT": "狀態版本衝突：請先重新整理目前狀態，再重試這個操作。",
          "REQUEST_INVALID_JSON": "請求內容不是有效 JSON：請確認輸入格式後重新送出。",
          "REQUEST_TOO_LARGE": "請求內容超過上限：請縮短內容後重新送出。",
          "SOURCE_DECODE_FAILED": "來源內容不是有效 UTF-8：請改用正確編碼的檔案或文字。",
          "TEMPLATE_SCHEMA_INVALID": "提交的結構化內容不符合 schema：請由專屬 Creator 依 context 重新產生。"
        };
        if (code && hints[code]) return hints[code];
        return nextStep(errorFromCode(code));
      }

      function errorFromCode(code) {
        if (!code) return {};
        if (/^REQUEST_/u.test(code)) return { status: 400 };
        return { status: 500 };
      }

      function nextStep(error) {
        if (error.status === 400) return "確認輸入內容或目前訪談選項，再重新送出。";
        if (error.status === 404) return "確認本機 server 版本與 endpoint，再按重新整理。";
        if (error.status === 409) return "先重新整理目前狀態，再重試這個操作。";
        if (error.status >= 500) return "查看本機 server log，修復服務後再重新整理。";
        if (error.kind === "network") return "確認本機 server 正在執行，再按重新整理。";
        return "檢查回應內容後按重新整理，必要時查看 server log。";
      }

      function errorSnapshot(error) {
        return {
          status: error && error.status !== undefined ? error.status : 0,
          status_text: error && error.statusText ? error.statusText : "",
          code: error && error.code ? error.code : "",
          message: error && error.message ? error.message : "未知錯誤",
          next_step: nextStep(error),
          response: error && error.payload !== undefined ? error.payload : null
        };
      }

      function renderLatest(label, payload) {
        var target = byId("latest-summary");
        target.className = "notice success";
        var record = isRecord(payload) ? payload : {};
        var status = firstString(record, ["status", "project_status"]);
        var summary = firstString(record, ["summary", "message"]);
        var question = firstString(record, ["question"]);
        var pieces = [label];
        if (status) pieces.push("狀態：" + readableStatus(status));
        if (summary) pieces.push("摘要：" + summary);
        if (question) pieces.push("需要輸入：" + question);
        target.textContent = pieces.join("；");
        byId("latest-json").textContent = jsonText(payload);
        byId("latest-details").open = false;
      }

      function recoveryErrorInfo(error) {
        var payload = isRecord(error && error.payload) ? error.payload : {};
        var details = isRecord(error && error.details) ? error.details : (isRecord(payload.details) ? payload.details : null);
        var info = {
          code: payload.code || (error && error.code) || "未知",
          messageZh: payload.message_zh || "",
          message: (error && error.message) || "",
          impact: (typeof error.impact === "string" && error.impact !== "" ? error.impact : "") || payload.impact || "",
          nextActions: Array.isArray(error.next_actions) ? error.next_actions : (Array.isArray(payload.next_actions) ? payload.next_actions : []),
          operationId: (typeof error.operation_id === "string" && error.operation_id !== "" ? error.operation_id : "") || payload.operation_id || "",
          changedInputs: details && Array.isArray(details.changed_inputs) ? details.changed_inputs : [],
          affected: details && details.affected,
          status: (error && error.status) || payload.status || "",
        };
        return info;
      }

      function recoveryCardDismissed(context) {
        if (context === undefined || context.projectId === undefined || context.code === undefined) return false;
        try {
          var key = "recovery-dismissed:v1:" + context.projectId;
          var raw = window.sessionStorage.getItem(key);
          var list = raw === null ? [] : JSON.parse(raw);
          return Array.isArray(list) && list.indexOf(context.code) !== -1;
        } catch (ignored) {
          return false;
        }
      }

      function recoveryCardDismiss(context) {
        if (context === undefined || context.projectId === undefined || context.code === undefined) return;
        try {
          var key = "recovery-dismissed:v1:" + context.projectId;
          var raw = window.sessionStorage.getItem(key);
          var list = raw === null ? [] : JSON.parse(raw);
          if (!Array.isArray(list)) list = [];
          if (list.indexOf(context.code) === -1) list.push(context.code);
          window.sessionStorage.setItem(key, JSON.stringify(list));
        } catch (ignored) {
        }
      }

      function renderRecoveryCards(container, error, context) {
        if (container === null || container === undefined) return;
        while (container.firstChild !== null) container.removeChild(container.firstChild);
        var info = recoveryErrorInfo(error);
        var cardContext = { projectId: context && context.projectId, code: info.code };
        if (recoveryCardDismissed(cardContext)) return;
        var card = document.createElement("div");
        card.className = "recovery-card";
        card.setAttribute("role", "status");
        var title = document.createElement("div");
        title.className = "recovery-title";
        title.textContent = "復原建議：無法完成此操作";
        card.appendChild(title);
        var cause = document.createElement("div");
        cause.className = "recovery-cause";
        cause.textContent = (info.messageZh !== "" ? info.messageZh + "；" : "") + (info.message !== "" ? info.message : "伺服器未提供說明。");
        card.appendChild(cause);
        if (info.impact !== "") {
          var impact = document.createElement("div");
          impact.className = "recovery-impact";
          impact.textContent = "影響：" + info.impact;
          card.appendChild(impact);
        }
        var affected = document.createElement("ul");
        affected.className = "recovery-affected";
        if (info.changedInputs.length > 0) {
          var affectedTitle = document.createElement("li");
          affectedTitle.textContent = "已變更的輸入：";
          affected.appendChild(affectedTitle);
          info.changedInputs.forEach(function (item) {
            if (!isRecord(item)) return;
            var li = document.createElement("li");
            li.textContent = (item.label || item.category || "項目") + "：" + (item.before_summary || "（無）") + " -> " + (item.after_summary || "（無）");
            affected.appendChild(li);
          });
        } else if (info.affected !== undefined && info.affected !== null) {
          var li2 = document.createElement("li");
          li2.textContent = "受影響對象：" + String(info.affected);
          affected.appendChild(li2);
        }
        if (affected.childNodes.length > 0) card.appendChild(affected);
        if (info.operationId !== "") {
          var correlation = document.createElement("div");
          correlation.className = "recovery-correlation";
          correlation.textContent = "關聯操作：" + info.operationId;
          card.appendChild(correlation);
        }
        var detailsEl = document.createElement("details");
        detailsEl.className = "recovery-technical";
        var detailsSummary = document.createElement("summary");
        detailsSummary.textContent = "技術細節";
        detailsEl.appendChild(detailsSummary);
        var detailsBody = document.createElement("div");
        detailsBody.textContent = jsonText(errorSnapshot(error));
        detailsEl.appendChild(detailsBody);
        card.appendChild(detailsEl);
        var actions = document.createElement("div");
        actions.className = "recovery-actions";
        var actionDefs = [];
        if (info.code === "NETWORK_ERROR" || info.status === 0) {
          actionDefs.push({ label: "重試", kind: "retry" });
        } else if (info.status === 401 || info.status === 403) {
          actionDefs.push({ label: "重新整理", kind: "refresh" });
        } else if (info.status === 409) {
          actionDefs.push({ label: "重新整理（重新取得最新狀態）", kind: "refresh" });
        } else {
          actionDefs.push({ label: "重試", kind: "retry" });
        }
        actionDefs.push({ label: "重新整理區塊", kind: "refresh" });
        actionDefs.forEach(function (def) {
          var button = document.createElement("button");
          button.type = "button";
          button.className = "recovery-action";
          button.textContent = def.label;
          button.addEventListener("click", function () {
            if (def.kind === "retry" && context && typeof context.onRetry === "function") {
              context.onRetry();
            } else if (typeof refresh === "function") {
              void refresh();
            }
          });
          actions.appendChild(button);
        });
        var dismiss = document.createElement("button");
        dismiss.type = "button";
        dismiss.className = "recovery-action recovery-dismiss";
        dismiss.textContent = "關閉此建議";
        dismiss.setAttribute("aria-label", "關閉此復原建議");
        dismiss.addEventListener("click", function () {
          recoveryCardDismiss(cardContext);
          if (card.parentNode !== null) card.parentNode.removeChild(card);
        });
        actions.appendChild(dismiss);
        card.appendChild(actions);
        container.appendChild(card);
      }

      function currentProjectId() {
  var sel = byId("project-select");
  return sel ? sel.value : "";
}

function renderLatestError(label, error, prefix) {
        var target = byId("latest-summary");
        target.className = "notice error";
        target.textContent = (prefix ? prefix + "；" : label + "；") + errorText(error);
        byId("latest-json").textContent = jsonText(errorSnapshot(error));
        byId("latest-details").open = true;
        renderRecoveryCards(byId("latest-recovery"), error, { projectId: currentProjectId(), onRetry: refresh });
      }

      function setNotice(kind, text) {
        var target = byId("latest-summary");
        target.className = "notice " + kind;
        target.textContent = text;
      }

      function setBusy(value) {
        state.busy = value;
        byId("busy-indicator").textContent = value ? "執行中，操作按鈕暫時停用…" : "";
        document.querySelectorAll("button, select, textarea").forEach(function (control) {
          control.disabled = value;
        });
        updateControls();
        document.body.setAttribute("aria-busy", value ? "true" : "false");
      }

      function setActionBusy(controlId, busy) {
        var control = byId(controlId);
        if (control) control.disabled = busy;
      }

      function updateControls() {
        if (state.busy) return;
        byId("project-select").disabled = state.projects.length === 0;
        byId("select-project").disabled = state.projects.length === 0 || !byId("project-select").value;
        byId("agent-select").disabled = state.agents.length === 0;
        byId("submit-interview").disabled = !state.interviewQuestion;
        byId("interview-answer-input").disabled = !state.interviewQuestion;
        document.querySelectorAll("#interview-choices button").forEach(function (button) {
          button.disabled = !state.interviewQuestion;
        });
      }

`;
