export function dashboard(): string {
  return `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ST Workspace 本機工作台</title>
  <style>
    :root {
      color-scheme: light;
      font-family: "Segoe UI", "Noto Sans TC", system-ui, sans-serif;
      color: #1f2937;
      background: #f2f5f9;
      line-height: 1.55;
    }
    * { box-sizing: border-box; }
    body { margin: 0; min-width: 320px; background: #f2f5f9; }
    button, select, textarea { font: inherit; }
    button, select { min-height: 2.5rem; }
    button {
      border: 1px solid #9bb7d4;
      border-radius: 0.55rem;
      padding: 0.55rem 0.85rem;
      color: #12324a;
      background: #fff;
      cursor: pointer;
    }
    button:hover:not(:disabled) { border-color: #2d6a9f; background: #eef6ff; }
    button.primary { border-color: #1f5f91; color: #fff; background: #1f5f91; }
    button.primary:hover:not(:disabled) { background: #164a73; }
    button.choice { width: 100%; text-align: left; }
    button:disabled, select:disabled, textarea:disabled {
      cursor: not-allowed;
      opacity: 0.58;
    }
    select, textarea {
      width: 100%;
      border: 1px solid #b7c4d1;
      border-radius: 0.55rem;
      padding: 0.6rem 0.7rem;
      color: #172b3a;
      background: #fff;
    }
    textarea { min-height: 7rem; resize: vertical; }
    .app-shell { width: min(1180px, 100%); margin: 0 auto; padding: 1.25rem; }
    .app-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 1rem;
      padding-top: 2rem;
      padding-bottom: 0.75rem;
    }
    h1, h2, h3 { margin: 0; line-height: 1.25; color: #142c3e; }
    h1 { font-size: clamp(1.55rem, 3vw, 2.25rem); }
    h2 { font-size: 1.15rem; }
    h3 { font-size: 0.95rem; }
    p { margin: 0.55rem 0 0; }
    .subtitle, .muted { color: #5f7180; }
    .subtitle { max-width: 50rem; }
    .dashboard-grid {
      display: grid;
      grid-template-columns: repeat(12, minmax(0, 1fr));
      gap: 1rem;
      padding-top: 0.75rem;
      padding-bottom: 3rem;
    }
    .panel {
      grid-column: span 6;
      min-width: 0;
      border: 1px solid #d5dee7;
      border-radius: 0.9rem;
      padding: 1rem;
      background: #fff;
      box-shadow: 0 0.35rem 1.2rem rgba(28, 54, 75, 0.06);
    }
    .panel-wide { grid-column: 1 / -1; }
    .panel-heading, .inline-actions, .field-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
    }
    .panel-heading { align-items: flex-start; }
    .inline-actions { flex-wrap: wrap; justify-content: flex-start; }
    .field-label, label { display: block; margin-top: 0.85rem; font-size: 0.88rem; font-weight: 650; color: #39566b; }
    .field-label:first-child { margin-top: 0; }
    .panel-message { min-height: 1.6rem; color: #5f7180; }
    .panel-message.error { color: #a43d3d; }
    .panel-message.success { color: #247047; }
    .busy-indicator { min-height: 1.5rem; color: #4a6980; font-size: 0.9rem; }
    .notice {
      margin-top: 0.65rem;
      border-radius: 0.6rem;
      padding: 0.6rem 0.75rem;
      color: #355165;
      background: #edf4f8;
    }
    .notice.success { color: #1d6240; background: #eaf7ef; }
    .notice.error { color: #8c3030; background: #fff0ef; }
    .notice.info { color: #2c5772; background: #edf4fb; }
    .status-line {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 0.55rem;
      margin-top: 0.8rem;
    }
    .status-badge {
      display: inline-flex;
      align-items: center;
      min-height: 1.7rem;
      border-radius: 999px;
      padding: 0.15rem 0.65rem;
      color: #43515d;
      background: #e9eef2;
      font-size: 0.82rem;
      font-weight: 700;
    }
    .status-badge.ready { color: #17633e; background: #e5f6ec; }
    .status-badge.active { color: #1d5d88; background: #e6f1fb; }
    .status-badge.error { color: #8e3030; background: #ffebea; }
    .field-list {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 0.55rem 1rem;
      margin: 1rem 0 0;
    }
    .field-row {
      align-items: flex-start;
      border-bottom: 1px solid #edf0f3;
      padding-bottom: 0.45rem;
    }
    .field-row dt { color: #607585; font-size: 0.82rem; }
    .field-row dd {
      max-width: 65%;
      margin: 0;
      overflow-wrap: anywhere;
      color: #203847;
      text-align: right;
    }
    .agent-list, .choice-list { display: grid; gap: 0.6rem; margin-top: 0.8rem; }
    .agent-card {
      border: 1px solid #e1e8ee;
      border-radius: 0.65rem;
      padding: 0.65rem 0.75rem;
      background: #fbfdff;
    }
    .agent-name { display: flex; align-items: center; gap: 0.45rem; font-weight: 700; color: #21435a; }
    .agent-tag {
      border-radius: 999px;
      padding: 0.08rem 0.45rem;
      color: #1d5d88;
      background: #e6f1fb;
      font-size: 0.75rem;
      font-weight: 650;
    }
    .agent-description { margin-top: 0.2rem; color: #5f7180; font-size: 0.88rem; overflow-wrap: anywhere; }
    .form-actions { display: flex; flex-wrap: wrap; gap: 0.55rem; margin-top: 0.75rem; }
    .form-actions button { flex: 0 0 auto; }
    .raw-json { margin-top: 1rem; border-top: 1px solid #e7edf2; padding-top: 0.65rem; }
    .raw-json summary { color: #385f78; cursor: pointer; font-weight: 650; }
    pre {
      max-height: 20rem;
      margin: 0.65rem 0 0;
      overflow: auto;
      border-radius: 0.6rem;
      padding: 0.75rem;
      color: #243541;
      background: #f3f6f8;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      font: 0.82rem/1.45 ui-monospace, SFMono-Regular, Consolas, monospace;
    }
    .deferred-list { margin: 0.75rem 0 0; padding-left: 1.25rem; color: #647481; }
    .deferred-list li + li { margin-top: 0.35rem; }
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }
    @media (max-width: 760px) {
      .app-shell { padding-right: 0.85rem; padding-left: 0.85rem; }
      .app-header { align-items: stretch; flex-direction: column; }
      .app-header button { align-self: flex-start; }
      .panel { grid-column: 1 / -1; }
      .field-list { grid-template-columns: 1fr; }
      .field-row dd { max-width: 58%; }
    }
  </style>
</head>
<body>
  <header class="app-shell app-header">
    <div>
      <h1>ST Workspace 本機工作台</h1>
      <p class="subtitle">用自然語言與單題訪談操作目前工作區；內部 workflow 參數由既有 runtime 管理。</p>
      <div id="busy-indicator" class="busy-indicator" aria-live="polite"></div>
    </div>
    <button id="refresh" type="button">重新整理</button>
  </header>

  <main class="app-shell dashboard-grid">
    <section id="project-panel" class="panel panel-wide" aria-labelledby="project-heading">
      <div class="panel-heading">
        <div>
          <h2 id="project-heading">專案選擇</h2>
          <p class="muted">只使用可見專案名稱或資料夾名稱；不要求輸入 project ID、path 或其他 runtime 參數。</p>
        </div>
      </div>
      <div id="projects-message" class="panel-message" aria-live="polite">正在讀取專案清單…</div>
      <label for="project-select">目前專案</label>
      <select id="project-select" aria-describedby="projects-message">
        <option value="">正在讀取…</option>
      </select>
      <div class="form-actions">
        <button id="select-project" class="primary" type="button">切換專案</button>
      </div>
      <div id="current-project" class="notice info" aria-live="polite">尚未取得目前專案。</div>
    </section>

    <section class="panel" aria-labelledby="status-heading">
      <div class="panel-heading">
        <h2 id="status-heading">目前專案 / 工作流狀態</h2>
        <span id="status-badge" class="status-badge">讀取中</span>
      </div>
      <div id="status-summary" class="panel-message" aria-live="polite">正在讀取狀態…</div>
      <dl id="status-fields" class="field-list"></dl>
      <details class="raw-json">
        <summary>查看狀態原始 JSON</summary>
        <pre id="status-json">{}</pre>
      </details>
    </section>

    <section class="panel" aria-labelledby="agents-heading">
      <div class="panel-heading">
        <h2 id="agents-heading">Agent</h2>
      </div>
      <label for="agent-select">指定執行 Agent（可省略）</label>
      <select id="agent-select" aria-describedby="agents-message">
        <option value="">Director（自動路由）</option>
      </select>
      <div id="agents-message" class="panel-message" aria-live="polite">正在讀取 Agent…</div>
      <div id="agent-list" class="agent-list"></div>
      <details class="raw-json">
        <summary>查看 Agent 原始 JSON</summary>
        <pre id="agents-json">{}</pre>
      </details>
    </section>

    <section class="panel panel-wide" aria-labelledby="request-heading">
      <div class="panel-heading">
        <div>
          <h2 id="request-heading">自然語言操作</h2>
          <p class="muted">描述想完成的工作即可；不要填寫 revision、lease、capability、stage、steps、bytes 等底層欄位。</p>
        </div>
      </div>
      <label for="request-input">Request</label>
      <textarea id="request-input" placeholder="例如：建立一個冷靜直接的角色，或查看目前工作流狀態。"></textarea>
      <div class="form-actions">
        <button id="submit-request" class="primary" type="button">送出 request</button>
      </div>
    </section>

    <section class="panel panel-wide" aria-labelledby="interview-heading">
      <div class="panel-heading">
        <div>
          <h2 id="interview-heading">結構化訪談</h2>
          <p class="muted">一次回答目前這一題；有選項時可直接點選，也可以用文字回答。</p>
        </div>
      </div>
      <div id="interview-message" class="panel-message" aria-live="polite">正在讀取訪談內容…</div>
      <h3 id="interview-question">尚未取得目前問題。</h3>
      <div id="interview-choices" class="choice-list" aria-live="polite"></div>
      <label for="interview-answer-input">回答</label>
      <textarea id="interview-answer-input" placeholder="輸入這一題的回答"></textarea>
      <div class="form-actions">
        <button id="submit-interview" class="primary" type="button">送出回答</button>
      </div>
      <details class="raw-json">
        <summary>查看訪談原始 JSON</summary>
        <pre id="interview-json">{}</pre>
      </details>
    </section>

    <section class="panel panel-wide" aria-labelledby="latest-heading">
      <div class="panel-heading">
        <div>
          <h2 id="latest-heading">最近回應 / 診斷</h2>
          <p class="muted">人類可讀摘要會保留在這裡；需要除錯時再展開原始 JSON。</p>
        </div>
      </div>
      <div id="latest-summary" class="notice info" aria-live="polite">尚未執行操作。</div>
      <details id="latest-details" class="raw-json">
        <summary>查看最近回應原始 JSON</summary>
        <pre id="latest-json">{}</pre>
      </details>
    </section>

    <section class="panel panel-wide" aria-labelledby="precheck-heading">
      <div class="panel-heading">
        <div>
          <h2 id="precheck-heading">Blueprint 預檢矩陣</h2>
          <p class="muted">訪談預檢的逐角色 × 逐維度狀態；不要求輸入 precheck ID 或 revision。</p>
        </div>
      </div>
      <div id="prechecks-message" class="panel-message" aria-live="polite">尚未取得預檢資料。</div>
      <div id="precheck-matrix" class="precheck-matrix"></div>
    </section>

    <section class="panel panel-wide" aria-labelledby="readiness-heading">
      <div class="panel-heading">
        <div>
          <h2 id="readiness-heading">Publish 就緒檢查</h2>
          <p class="muted">正式裁決來自既有 workflow gate；顯示每條診斷的 code 與嚴重度。</p>
        </div>
      </div>
      <div class="form-actions">
        <button id="check-readiness" class="primary" type="button">重新檢查</button>
      </div>
      <div id="readiness-message" class="panel-message" aria-live="polite">尚未執行就緒檢查。</div>
      <div id="readiness-list" class="readiness-list"></div>
    </section>

    <section class="panel panel-wide" aria-labelledby="artifact-heading">
      <div class="panel-heading">
        <div>
          <h2 id="artifact-heading">Artifact 工作台</h2>
          <p class="muted">顯示 revision、Blueprint binding、建立者與狀態；原始內容展開查看。</p>
        </div>
      </div>
      <div id="artifact-message" class="panel-message" aria-live="polite">尚未取得 artifact 資料。</div>
      <div id="artifact-list" class="artifact-list"></div>
      <details class="raw-json">
        <summary>查看目前 Blueprint 原始 JSON</summary>
        <pre id="blueprint-json">{}</pre>
      </details>
    </section>

    <section class="panel" aria-labelledby="quality-heading">
      <div class="panel-heading">
        <h2 id="quality-heading">品質門檻</h2>
      </div>
      <label for="quality-level">Quality level</label>
      <select id="quality-level">
        <option value="none">none（不阻擋）</option>
        <option value="light">light（只擋 critical）</option>
        <option value="normal">normal（擋 error 以上）</option>
        <option value="strict">strict（擋 warning 以上）</option>
      </select>
      <div class="form-actions">
        <button id="apply-quality" class="primary" type="button">套用品質設定</button>
      </div>
      <div id="quality-message" class="panel-message" aria-live="polite">尚未取得品質設定。</div>
      <details class="raw-json">
        <summary>查看品質原始 JSON</summary>
        <pre id="quality-json">{}</pre>
      </details>
    </section>

    <section class="panel panel-wide" aria-labelledby="source-fact-heading">
      <div class="panel-heading">
        <div>
          <h2 id="source-fact-heading">來源與事實</h2>
          <p class="muted">候選來源、已入庫來源與知識事實的目前狀態。</p>
        </div>
      </div>
      <div id="source-fact-message" class="panel-message" aria-live="polite">尚未取得來源與事實資料。</div>
      <div id="candidate-list" class="candidate-list"></div>
      <div id="source-list" class="source-list"></div>
      <div id="fact-list" class="fact-list"></div>
    </section>

    <section class="panel panel-wide" aria-labelledby="build-heading">
      <div class="panel-heading">
        <div>
          <h2 id="build-heading">打包選擇預覽</h2>
          <p class="muted">目前可用的打包模式、主要角色與缺少的模組；由既有 manifest 計算。</p>
        </div>
      </div>
      <div class="form-actions">
        <button id="check-build" class="primary" type="button">更新打包預覽</button>
      </div>
      <div id="build-message" class="panel-message" aria-live="polite">尚未取得打包預覽。</div>
      <div id="build-summary" class="build-summary"></div>
      <div id="build-diagnostics" class="build-diagnostics"></div>
    </section>

    <section class="panel panel-wide" aria-labelledby="operation-heading">
      <div class="panel-heading">
        <div>
          <h2 id="operation-heading">Operation 管理</h2>
          <p class="muted">列出 operation 與 lease/attempt 資訊；可取消卡住的 operation 或重新嘗試。</p>
        </div>
      </div>
      <div id="operation-message" class="panel-message" aria-live="polite">尚未取得 operation 資料。</div>
      <div id="operation-list" class="operation-list"></div>
    </section>

    <section class="panel" aria-labelledby="repair-heading">
      <div class="panel-heading">
        <h2 id="repair-heading">專案修復</h2>
      </div>
      <div class="form-actions">
        <button id="repair-preview" class="primary" type="button">檢查殘留</button>
        <button id="repair-run" type="button">執行修復</button>
      </div>
      <div id="repair-message" class="panel-message" aria-live="polite">尚未執行修復檢查。</div>
      <div id="repair-report" class="repair-report"></div>
    </section>

    <section class="panel" aria-labelledby="tavern-heading">
      <div class="panel-heading">
        <h2 id="tavern-heading">Tavern 相容性</h2>
      </div>
      <div class="form-actions">
        <button id="check-tavern" class="primary" type="button">檢查相容性</button>
      </div>
      <div id="tavern-message" class="panel-message" aria-live="polite">尚未執行相容性檢查。</div>
      <div id="tavern-report" class="tavern-report"></div>
    </section>

    <section class="panel panel-wide" aria-labelledby="deferred-heading">
      <div class="panel-heading">
        <h2 id="deferred-heading">後續提供</h2>
      </div>
      <ul class="deferred-list">
        <li>Publish readiness 的正式裁決</li>
        <li>artifact、review、fact 寫入與 quality override</li>
        <li>打包模式、operation cancel/retry 與 Tavern compatibility verifier</li>
      </ul>
    </section>
  </main>

  <script>
    (function () {
      "use strict";

      var state = {
        busy: false,
        projects: [],
        agents: [],
        status: null,
        interviewQuestion: null,
        currentProjectValue: ""
      };

      function byId(value) {
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
          return {
            label: name || folder || visiblePath || fallback,
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
        if (["failed", "cancelled", "error"].indexOf(status) >= 0) return "error";
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
        var status = firstString(record, ["status", "project_status"]);
        var badge = byId("status-badge");
        badge.className = "status-badge " + statusClass(status);
        badge.textContent = readableStatus(status);
        var summary = firstString(record, ["summary", "message"]);
        byId("status-summary").className = "panel-message" + (statusClass(status) === "error" ? " error" : "");
        byId("status-summary").textContent = summary || "API 未提供摘要；請查看下方欄位與原始 JSON。";
        renderFields(byId("status-fields"), record);
        byId("status-json").textContent = jsonText(payload);
        renderCurrentProject(record);
        syncProjectSelection(record);
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
          byId("interview-message").textContent = questionChoices.length > 0
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
        var code = error.code || "未提供";
        var message = error.message || "伺服器沒有提供錯誤訊息";
        return status + "錯誤代碼：" + code + "；訊息：" + message + "；下一步：" + nextStep(error);
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

      function renderLatestError(label, error, prefix) {
        var target = byId("latest-summary");
        target.className = "notice error";
        target.textContent = (prefix ? prefix + "；" : label + "；") + errorText(error);
        byId("latest-json").textContent = jsonText(errorSnapshot(error));
        byId("latest-details").open = true;
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

      async function requestJson(path, options) {
        var response;
        try {
          response = await fetch(path, options || { headers: { accept: "application/json" } });
        } catch (error) {
          var networkError = new Error("無法連線到本機 server");
          networkError.kind = "network";
          networkError.code = "NETWORK_ERROR";
          networkError.status = 0;
          throw networkError;
        }
        var raw = await response.text();
        var payload;
        try {
          payload = raw.length > 0 ? JSON.parse(raw) : {};
        } catch (error) {
          payload = { raw: raw };
        }
        if (!response.ok) {
          var errorValue = isRecord(payload) ? payload.error : undefined;
          var code = firstString(payload, ["code", "error_code"])
            || (typeof errorValue === "string" ? errorValue : "")
            || (isRecord(errorValue) ? firstString(errorValue, ["code", "error_code"]) : "");
          var message = firstString(payload, ["message", "detail"])
            || (typeof errorValue === "string" ? errorValue : "")
            || (isRecord(errorValue) ? firstString(errorValue, ["message", "detail"]) : "")
            || response.statusText
            || "伺服器拒絕了這次請求";
          var apiError = new Error(message);
          apiError.kind = "http";
          apiError.code = code || "HTTP_ERROR";
          apiError.status = response.status;
          apiError.statusText = response.statusText;
          apiError.payload = payload;
          throw apiError;
        }
        return payload;
      }

      function postJson(path, value) {
        return requestJson(path, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify(value)
        });
      }

      async function loadProjects() {
        try {
          var payload = await requestJson("/workspace/projects");
          renderProjects(payload);
          return payload;
        } catch (error) {
          setAreaError("projects-message", error);
          throw error;
        }
      }

      async function loadStatus() {
        try {
          var payload = await requestJson("/workspace/status");
          renderStatus(payload);
          return payload;
        } catch (error) {
          setAreaError("status-summary", error);
          throw error;
        }
      }

      async function loadAgents() {
        try {
          var payload = await requestJson("/workspace/agents");
          renderAgents(payload);
          return payload;
        } catch (error) {
          setAreaError("agents-message", error);
          throw error;
        }
      }

      async function loadInterview() {
        try {
          var payload = await requestJson("/workspace/interview/context");
          renderInterview(payload);
          return payload;
        } catch (error) {
          setAreaError("interview-message", error);
          throw error;
        }
      }

      async function refresh() {
        if (state.busy) return;
        setBusy(true);
        setNotice("info", "重新整理中…");
        var outcomes = await Promise.allSettled([loadProjects(), loadStatus(), loadAgents(), loadInterview(), loadDashboardData()]);
        var failures = outcomes.filter(function (outcome) { return outcome.status === "rejected"; });
        if (failures.length > 0) {
          renderLatestError("重新整理", failures[0].reason, "重新整理有 " + failures.length + " 個區塊失敗");
          setNotice("error", "部分資料更新失敗；請查看最近回應/診斷區。");
        } else {
          renderLatest("重新整理", { status: "completed", summary: "專案、狀態、Agent 與訪談資料已更新。" });
          setNotice("success", "資料已更新。");
        }
        setBusy(false);
      }

      async function runTask(label, task) {
        if (state.busy) return undefined;
        setBusy(true);
        setNotice("info", label + "執行中…");
        try {
          var payload = await task();
          renderLatest(label, payload);
          setNotice("success", label + "完成。");
          return payload;
        } catch (error) {
          renderLatestError(label, error);
          setNotice("error", label + "失敗；請查看最近回應/診斷區。");
          return undefined;
        } finally {
          setBusy(false);
        }
      }

      async function refreshAfterAction() {
        await Promise.allSettled([loadProjects(), loadStatus(), loadInterview()]);
      }

      function localValidation(label, message) {
        var error = new Error(message);
        error.kind = "validation";
        error.status = 400;
        error.code = "DASHBOARD_INPUT_REQUIRED";
        renderLatestError(label, error, "請先完成輸入");
        setNotice("error", message + "下一步：補齊內容後再送出。");
      }

      function submitRequest() {
        if (state.busy) return;
        var request = byId("request-input").value.trim();
        if (!request) {
          localValidation("自然語言操作", "Request 不可為空。");
          return;
        }
        var body = { request: request };
        var agent = byId("agent-select").value;
        if (agent) body.agent = agent;
        void runTask("自然語言操作", async function () {
          var payload = await postJson("/workspace/request", body);
          await refreshAfterAction();
          return payload;
        });
      }

      function selectProject() {
        if (state.busy) return;
        var project = byId("project-select").value;
        if (!project) {
          localValidation("切換專案", "目前沒有可提交的專案選擇。");
          return;
        }
        void runTask("切換專案", async function () {
          var payload = await postJson("/workspace/project/select", { project: project });
          await refreshAfterAction();
          return payload;
        });
      }

      function submitInterviewAnswer(answer) {
        if (state.busy) return;
        var value = typeof answer === "string" ? answer : String(answer);
        if (!value.trim()) {
          localValidation("提交訪談回答", "回答不可為空。");
          return;
        }
        byId("interview-answer-input").value = value;
        void runTask("提交訪談回答", async function () {
          var payload = await postJson("/workspace/interview/answer", { answer: value.trim() });
          await refreshAfterAction();
          return payload;
        });
      }

      function renderPrecheckMatrix(prechecks) {
        var target = byId("precheck-matrix");
        target.textContent = "";
        if (!Array.isArray(prechecks) || prechecks.length === 0) {
          byId("prechecks-message").textContent = "目前沒有 Blueprint 預檢記錄。";
          return;
        }
        byId("prechecks-message").textContent = "共 " + prechecks.length + " 筆預檢記錄。";
        var latest = prechecks[prechecks.length - 1];
        var checks = Array.isArray(latest.checks) ? latest.checks : [];
        if (checks.length === 0) {
          target.textContent = "最新預檢沒有檢查項目。";
          return;
        }
        var rows = [];
        var seen = {};
        for (var i = 0; i < checks.length; i += 1) {
          var check = checks[i];
          if (!isRecord(check)) continue;
          var subject = firstString(check, ["subject_id", "subject"]) || "?";
          var dimension = firstString(check, ["dimension"]) || "?";
          var uncertainty = firstString(check, ["uncertainty"]) || "?";
          var impact = firstString(check, ["impact"]) || "?";
          var basis = firstString(check, ["basis"]) || "?";
          var action = firstString(check, ["action"]) || "?";
          var key = subject + "\u0000" + dimension;
          if (seen[key]) continue;
          seen[key] = true;
          var row = document.createElement("div");
          row.className = "precheck-row";
          var subjectCell = document.createElement("span");
          subjectCell.textContent = subject;
          var dimensionCell = document.createElement("span");
          dimensionCell.textContent = dimension;
          var statusCell = document.createElement("span");
          statusCell.className = "status-badge " + statusClass(check.status || "active");
          statusCell.textContent = check.status === "resolved" ? "已解決" : (check.status === "confirmed" ? "已確認" : "待處理");
          var metaCell = document.createElement("span");
          metaCell.textContent = "uncertainty: " + uncertainty + " / impact: " + impact + " / basis: " + basis + " / action: " + action;
          row.append(subjectCell, dimensionCell, statusCell, metaCell);
          rows.push(row);
        }
        target.append.apply(target, rows);
        if (rows.length === 0) target.textContent = "最新預檢沒有可顯示的檢查項目。";
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
          target.append(row);
        }
      }

      function renderArtifactList(snapshot) {
        var target = byId("artifact-list");
        target.textContent = "";
        var artifacts = Array.isArray(snapshot.artifacts) ? snapshot.artifacts : [];
        if (artifacts.length === 0) {
          byId("artifact-message").textContent = "目前沒有 artifact。";
        } else {
          byId("artifact-message").textContent = "共 " + artifacts.length + " 個 artifact。";
        }
        for (var i = 0; i < artifacts.length; i += 1) {
          var artifact = artifacts[i];
          if (!isRecord(artifact)) continue;
          var row = document.createElement("div");
          row.className = "artifact-row";
          var badge = document.createElement("span");
          badge.className = "status-badge " + statusClass(artifact.status || "draft");
          badge.textContent = firstString(artifact, ["kind"]) || "?";
          var name = document.createElement("span");
          name.textContent = firstString(artifact, ["name"]) || firstString(artifact, ["id"]) || "?";
          var meta = document.createElement("span");
          var parts = ["rev " + (firstString(artifact, ["revision"]) || "?")];
          if (artifact.created_by) parts.push("by " + artifact.created_by);
          if (artifact.blueprint_precheck_id) parts.push("binding " + artifact.blueprint_precheck_revision || "?");
          meta.textContent = parts.join(" · ");
          row.append(badge, name, meta);
          target.append(row);
        }
        var blueprint = snapshot.blueprint;
        byId("blueprint-json").textContent = blueprint === undefined ? "{}" : jsonText(blueprint);
      }

      function renderOperationList(operations) {
        var target = byId("operation-list");
        target.textContent = "";
        if (!Array.isArray(operations) || operations.length === 0) {
          byId("operation-message").textContent = "目前沒有 operation。";
          return;
        }
        byId("operation-message").textContent = "共 " + operations.length + " 個 operation。";
        for (var i = 0; i < operations.length; i += 1) {
          var operation = operations[i];
          if (!isRecord(operation)) continue;
          var row = document.createElement("div");
          row.className = "operation-row";
          var badge = document.createElement("span");
          badge.className = "status-badge " + statusClass(operation.status || "unknown");
          badge.textContent = firstString(operation, ["status"]) || "?";
          var label = document.createElement("span");
          var labelParts = [firstString(operation, ["kind"]) || "?", firstString(operation, ["request"]) || ""];
          if (operation.attempt) labelParts.push("attempt " + operation.attempt);
          if (operation.lease_owner) labelParts.push("lease " + operation.lease_owner + (operation.lease_expires_at ? " ~ " + operation.lease_expires_at : ""));
          if (operation.last_error) labelParts.push("error: " + operation.last_error);
          label.textContent = labelParts.join(" · ");
          row.append(badge, label);
          var actions = document.createElement("span");
          actions.className = "inline-actions";
          var recover = document.createElement("button");
          recover.type = "button";
          recover.textContent = "重試";
          recover.addEventListener("click", function () { postOperation("recover", operation.id); });
          var fail = document.createElement("button");
          fail.type = "button";
          fail.textContent = "取消";
          fail.addEventListener("click", function () { postOperation("fail", operation.id); });
          actions.append(recover, fail);
          row.append(actions);
          target.append(row);
        }
      }

      function renderQuality(snapshot) {
        var quality = snapshot.quality;
        if (quality === undefined) {
          byId("quality-message").textContent = "尚未設定品質門檻。";
          byId("quality-json").textContent = "{}";
          return;
        }
        var level = firstString(quality, ["level"]) || "normal";
        byId("quality-level").value = level;
        byId("quality-message").textContent = "目前門檻： " + level + "（阻擋 " + (firstString(quality, ["blocking_severity"]) || "?") + " 以上）。";
        byId("quality-json").textContent = jsonText(quality);
      }

      function renderSourceFact(snapshot) {
        var candidates = Array.isArray(snapshot.candidates) ? snapshot.candidates : [];
        var sources = Array.isArray(snapshot.sources) ? snapshot.sources : [];
        var facts = Array.isArray(snapshot.facts) ? snapshot.facts : [];
        var candidateTarget = byId("candidate-list");
        candidateTarget.textContent = "";
        candidateTarget.textContent = candidates.length === 0 ? "沒有候選來源。" : "候選來源 " + candidates.length + " 筆";
        for (var i = 0; i < candidates.length; i += 1) {
          var candidate = candidates[i];
          if (!isRecord(candidate)) continue;
          var row = document.createElement("div");
          row.className = "fact-row";
          var badge = document.createElement("span");
          badge.className = "status-badge " + statusClass(candidate.status || "pending");
          badge.textContent = firstString(candidate, ["status"]) || "?";
          var text = document.createElement("span");
          text.textContent = (firstString(candidate, ["title"]) || "?") + (candidate.official ? "（官方）" : "");
          row.append(badge, text);
          candidateTarget.append(row);
        }
        var sourceTarget = byId("source-list");
        sourceTarget.textContent = "";
        sourceTarget.textContent = sources.length === 0 ? "沒有已入庫來源。" : "已入庫來源 " + sources.length + " 筆";
        for (var j = 0; j < sources.length; j += 1) {
          var source = sources[j];
          if (!isRecord(source)) continue;
          var sourceRow = document.createElement("div");
          sourceRow.className = "fact-row";
          sourceRow.textContent = firstString(source, ["title"]) || "?";
          sourceTarget.append(sourceRow);
        }
        var factTarget = byId("fact-list");
        factTarget.textContent = "";
        factTarget.textContent = facts.length === 0 ? "沒有知識事實。" : "知識事實 " + facts.length + " 筆";
        for (var k = 0; k < facts.length; k += 1) {
          var fact = facts[k];
          if (!isRecord(fact)) continue;
          var factRow = document.createElement("div");
          factRow.className = "fact-row";
          var factBadge = document.createElement("span");
          factBadge.className = "status-badge " + statusClass(fact.status || "candidate");
          factBadge.textContent = firstString(fact, ["status"]) || "?";
          var factText = document.createElement("span");
          factText.textContent = (firstString(fact, ["statement"]) || "");
          factRow.append(factBadge, factText);
          factTarget.append(factRow);
        }
      }

      function renderBuildReadiness(readiness) {
        var target = byId("build-summary");
        target.textContent = "";
        if (!isRecord(readiness)) {
          byId("build-message").textContent = "沒有打包預覽資料。";
          return;
        }
        var parts = [];
        var modes = isRecord(readiness.modes) ? readiness.modes : {};
        if (modes.zhuji) parts.push("珠璣可用");
        if (modes.palette) parts.push("調色盤可用");
        if (parts.length === 0) parts.push("尚無可用打包模式");
        if (isRecord(readiness.primary_character)) {
          parts.push("主要角色 " + (firstString(readiness.primary_character, ["label"]) || "?"));
        }
        byId("build-message").textContent = parts.join(" · ");
        var entries = Array.isArray(readiness.entries) ? readiness.entries : [];
        var entryTarget = document.createElement("div");
        entryTarget.textContent = entries.length === 0 ? "沒有附加條目。" : "附加條目：" + entries.map(function (entry) { return (isRecord(entry) ? (firstString(entry, ["kind"]) || "?") + ":" + (firstString(entry, ["name"]) || "?") : "?"); }).join("、");
        target.append(entryTarget);
        var missing = Array.isArray(readiness.missing) ? readiness.missing : [];
        var missingTarget = document.createElement("div");
        missingTarget.textContent = missing.length === 0 ? "模組齊全。" : "缺少模組：" + missing.join("、");
        target.append(missingTarget);
        var diagnosticsTarget = byId("build-diagnostics");
        diagnosticsTarget.textContent = "";
        var diagnostics = Array.isArray(readiness.diagnostics) ? readiness.diagnostics : [];
        for (var i = 0; i < diagnostics.length; i += 1) {
          var item = diagnostics[i];
          if (!isRecord(item)) continue;
          var row = document.createElement("div");
          row.className = "readiness-row";
          row.textContent = (firstString(item, ["code"]) || "?") + "： " + (firstString(item, ["message"]) || "");
          diagnosticsTarget.append(row);
        }
      }

      function renderTavern(report) {
        var target = byId("tavern-report");
        target.textContent = "";
        if (!isRecord(report)) {
          byId("tavern-message").textContent = "沒有相容性資料。";
          return;
        }
        byId("tavern-message").textContent = report.available === true ? "相容性檢查完成。" : "目前無法檢查相容性。";
        var items = Array.isArray(report.report) ? report.report : [];
        for (var i = 0; i < items.length; i += 1) {
          var row = document.createElement("div");
          row.className = "fact-row";
          row.textContent = items[i];
          target.append(row);
        }
      }

      function renderRepairInspection(inspection) {
        var target = byId("repair-report");
        target.textContent = "";
        if (!isRecord(inspection)) {
          byId("repair-message").textContent = "沒有修復資料。";
          return;
        }
        var legacy = Array.isArray(inspection.legacy_files) ? inspection.legacy_files : [];
        var orphan = Array.isArray(inspection.orphan_backups) ? inspection.orphan_backups : [];
        if (legacy.length === 0 && orphan.length === 0) {
          byId("repair-message").textContent = "沒有發現殘留 legacy 檔案或孤兒備份。";
          return;
        }
        byId("repair-message").textContent = "發現需要處理的項目。";
        if (legacy.length > 0) {
          var legacyRow = document.createElement("div");
          legacyRow.textContent = "legacy 檔案：" + legacy.join("、");
          target.append(legacyRow);
        }
        if (orphan.length > 0) {
          var orphanRow = document.createElement("div");
          orphanRow.textContent = "孤兒備份：" + orphan.join("、");
          target.append(orphanRow);
        }
      }

      function renderRepairReport(report) {
        var target = byId("repair-report");
        target.textContent = "";
        if (!isRecord(report)) {
          byId("repair-message").textContent = "修復執行沒有回報。";
          return;
        }
        var archived = Array.isArray(report.archived) ? report.archived : [];
        byId("repair-message").textContent = archived.length === 0 ? "修復完成：沒有需要歸檔的項目。" : "修復完成：已歸檔 " + archived.join("、");
      }

      async function loadDashboardData() {
        try {
          var payload = await requestJson("/workspace/dashboard/data");
          renderPrecheckMatrix(payload.prechecks);
          renderArtifactList(payload);
          renderOperationList(payload.operations);
          renderQuality(payload);
          renderSourceFact(payload);
          renderRepairInspection(payload.repair);
          return payload;
        } catch (error) {
          setAreaError("prechecks-message", error);
          throw error;
        }
      }

      function postOperation(action, operationId) {
        void runTask(action === "recover" ? "重試 operation" : "取消 operation", async function () {
          var payload = await postJson("/workspace/operation/" + action, { operation_id: operationId });
          await Promise.allSettled([loadDashboardData()]);
          return payload;
        });
      }

      function applyQuality() {
        if (state.busy) return;
        var level = byId("quality-level").value;
        void runTask("套用品質設定", async function () {
          var payload = await postJson("/workspace/quality/profile", { level: level });
          await Promise.allSettled([loadDashboardData()]);
          return payload;
        });
      }

      function runRepair() {
        void runTask("執行修復", async function () {
          var payload = await postJson("/workspace/repair/run", {});
          renderRepairReport(payload);
          return payload;
        });
      }

      byId("check-readiness").addEventListener("click", function () {
        void runTask("Publish 就緒檢查", async function () {
          var payload = await requestJson("/workspace/publish/preview");
          renderReadiness(payload.diagnostics);
          return payload;
        });
      });
      byId("check-build").addEventListener("click", function () {
        void runTask("打包預覽", async function () {
          var payload = await requestJson("/workspace/build/preview");
          renderBuildReadiness(payload);
          return payload;
        });
      });
      byId("check-tavern").addEventListener("click", function () {
        void runTask("Tavern 相容性", async function () {
          var payload = await requestJson("/workspace/tavern/compat");
          renderTavern(payload);
          return payload;
        });
      });
      byId("repair-preview").addEventListener("click", function () {
        void runTask("修復檢查", async function () {
          var payload = await requestJson("/workspace/repair/preview");
          renderRepairInspection(payload);
          return payload;
        });
      });
      byId("repair-run").addEventListener("click", runRepair);
      byId("apply-quality").addEventListener("click", applyQuality);
      byId("refresh").addEventListener("click", function () { void refresh(); });
      byId("submit-request").addEventListener("click", submitRequest);
      byId("select-project").addEventListener("click", selectProject);
      byId("submit-interview").addEventListener("click", function () {
        submitInterviewAnswer(byId("interview-answer-input").value);
      });
      byId("project-select").addEventListener("change", updateControls);
      void refresh();
    }());
  </script>
</body>
</html>`;
}
