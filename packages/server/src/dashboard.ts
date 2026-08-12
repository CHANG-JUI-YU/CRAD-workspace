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
    <section id="home-panel" class="panel panel-wide" aria-labelledby="home-heading" hidden>
      <div class="panel-heading">
        <div>
          <h2 id="home-heading">尚未選擇專案</h2>
          <p class="muted">先建立新專案或開啟既有專案；本機不會在啟動時自動建立任何資料夾。</p>
        </div>
      </div>
      <div class="home-actions">
        <button id="home-new-project" class="primary" type="button">建立新專案</button>
        <button id="home-open-project" type="button">開啟既有專案</button>
        <button id="home-legacy-review" type="button">舊卡審核</button>
      </div>
      <div id="home-projects" class="panel-message" aria-live="polite">正在讀取專案清單…</div>
    </section>

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
        <button id="new-project" type="button">建立新專案</button>
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
      <div id="interview-target-area" hidden>
        <label for="interview-target-select">目標專案</label>
        <select id="interview-target-select" aria-describedby="interview-target-note"></select>
        <div id="interview-target-note" class="muted"></div>
        <div class="form-actions">
          <button id="interview-target-submit" class="primary" type="button">以此專案為目標</button>
        </div>
      </div>
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
        <select id="readiness-mode" aria-label="就緒檢查打包模式">
          <option value="">依專案自動判斷</option>
          <option value="zhuji">Zhuji</option>
          <option value="palette">Palette</option>
        </select>
        <button id="check-readiness" class="primary" type="button">重新檢查</button>
      </div>
      <div id="readiness-message" class="panel-message" aria-live="polite">尚未執行就緒檢查。</div>
      <div id="readiness-list" class="readiness-list"></div>
    </section>

    <section class="panel panel-wide" aria-labelledby="artifact-heading">
      <div class="panel-heading">
        <div>
          <h2 id="artifact-heading">Artifact 工作台</h2>
          <p class="muted">一個 key 一列目前版本；可展開查看原始／格式化內容、與前一版差異，並送審或下載。</p>
        </div>
        <button id="load-artifacts" type="button">載入 Artifact</button>
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
        <button id="load-issues" type="button">載入 Issues</button>
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
      <div class="panel-heading">
        <h3>逐 code 覆寫</h3>
      </div>
      <div class="form-actions">
        <input id="quality-code" type="text" placeholder="issue code（如 PLACEHOLDER_REMAINS）" aria-label="issue code">
        <select id="quality-severity" aria-label="覆寫嚴重度">
          <option value="info">info</option>
          <option value="warning">warning</option>
          <option value="error">error</option>
          <option value="critical">critical</option>
        </select>
        <button id="add-quality-override" type="button">新增覆寫</button>
      </div>
      <div id="quality-override-list" class="override-list"></div>
      <div id="quality-message" class="panel-message" aria-live="polite">尚未取得品質設定。</div>
      <div class="panel-heading">
        <h3>逐項 issue 操作</h3>
      </div>
      <div id="issue-list" class="issue-list"></div>
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
        <button id="load-source-facts" type="button">載入來源與事實</button>
      </div>
      <div id="source-fact-message" class="panel-message" aria-live="polite">尚未取得來源與事實資料。</div>
      <div id="candidate-list" class="candidate-list"></div>
      <div id="source-list" class="source-list"></div>
      <div id="fact-list" class="fact-list"></div>
      <div id="fact-review-run" class="fact-list"></div>
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
          <p class="muted">列出 operation 與 lease/attempt 資訊；可回答待輸入問題、取消卡住的 operation 或重新嘗試失敗的操作。</p>
        </div>
        <label class="field-label" for="operation-filter">狀態篩選
          <select id="operation-filter">
            <option value="all">全部</option>
            <option value="active">進行中</option>
            <option value="needs_input">待輸入</option>
            <option value="failed">失敗</option>
            <option value="terminal">已完成／已取消</option>
          </select>
        </label>
        <button id="load-operations" type="button">載入 Operations</button>
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

    <section class="panel" aria-labelledby="image-heading">
      <div class="panel-heading">
        <h2 id="image-heading">角色圖像</h2>
      </div>
      <div class="field-row">
        <select id="image-character">
          <option value="">未綁定（作為封面圖）</option>
        </select>
        <select id="image-ratio">
          <option value="">不裁切</option>
          <option value="1:1">1:1 方形</option>
          <option value="2:3">2:3</option>
          <option value="3:4">3:4</option>
          <option value="9:16">9:16</option>
          <option value="16:9">16:9</option>
        </select>
      </div>
      <div id="image-crop-preview" class="crop-preview" hidden></div>
      <div class="field-row">
        <input id="image-source" type="text" placeholder="來源（檔案/網址）">
        <input id="image-license" type="text" placeholder="使用權註記">
      </div>
      <div class="form-actions">
        <input id="image-file" type="file" accept="image/png">
        <button id="submit-image" class="primary" type="button">上傳角色圖</button>
      </div>
      <div id="image-stale-banner" class="panel-message" hidden></div>
      <div id="image-message" class="panel-message" aria-live="polite">尚未上傳角色圖像。</div>
      <div id="image-list" class="fact-list"></div>
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

      function tokenQuery() {
        var match = /[?&]token=([^&]+)/u.exec(window.location.search || "");
        return match ? "?token=" + encodeURIComponent(match[1] || "") : "";
      }

      async function requestJson(path, options) {
        var response;
        try {
          response = await fetch(path + (path.indexOf("?") >= 0 ? "&" : "?") + tokenQuery().replace(/^\?/u, ""), options || { headers: { accept: "application/json" } });
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
        var outcomes = await Promise.allSettled([loadStatus()]);
        var statusFailed = outcomes[0].status === "rejected" || state.sessionUnselected === undefined;
        if (statusFailed) {
          outcomes = outcomes.concat(await Promise.allSettled([loadProjects(), loadAgents(), loadInterview(), loadDashboardData()]));
        } else if (state.sessionUnselected) {
          outcomes = outcomes.concat(await Promise.allSettled([loadProjects()]));
        } else {
          outcomes = outcomes.concat(await Promise.allSettled([loadProjects(), loadAgents(), loadInterview(), loadDashboardData()]));
        }
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
      var OPERATION_FILTERS = { all: "", active: "created,resolving,running,partial", needs_input: "needs_input", failed: "failed", terminal: "completed,cancelled" };
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
          var body = { request: value };
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
          if (!window.confirm("確定要取消 operation " + operationId + "？此操作將被標記為失敗。" + "需要重新執行時可再按「重試」。")) return;
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
          if (operation.error_class === "recoverable") labelParts.push("可安全重試");
          if (operation.error_class === "fatal") labelParts.push("需人工重送");
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
        currentOverrides = isRecord(quality.overrides) ? quality.overrides : {};
        renderQualityOverrides();
      }

      function renderQualityOverrides() {
        var target = byId("quality-override-list");
        target.textContent = "";
        var codes = Object.keys(currentOverrides);
        if (codes.length === 0) {
          target.textContent = "沒有逐 code 覆寫。";
          return;
        }
        for (var i = 0; i < codes.length; i += 1) {
          var code = codes[i];
          var row = document.createElement("div");
          row.className = "override-row";
          var text = document.createElement("span");
          text.textContent = code + " → " + currentOverrides[code];
          var remove = document.createElement("button");
          remove.type = "button";
          remove.textContent = "移除";
          remove.addEventListener("click", removeQualityOverride(code));
          row.append(text, remove);
          target.append(row);
        }
      }

      function removeQualityOverride(code) {
        return function () {
          delete currentOverrides[code];
          renderQualityOverrides();
          void applyQuality();
        };
      }

      function addQualityOverride() {
        if (state.busy) return;
        var code = byId("quality-code").value.trim();
        if (!code) {
          localValidation("品質覆寫", "請輸入 issue code。");
          return;
        }
        currentOverrides[code] = byId("quality-severity").value;
        byId("quality-code").value = "";
        renderQualityOverrides();
        void applyQuality();
      }

      function postIssueAction(issueId, action, reasonElement, severitySelect) {
        return function () {
          postIssue(issueId, action, reasonElement.value, severitySelect === null ? undefined : severitySelect.value);
        };
      }

      function severityPreview(selectElement, previewElement, issueRecord) {
        return function () {
          previewElement.textContent = "effective " + (firstString(issueRecord, ["effective_severity"]) || "?") + " → " + selectElement.value;
        };
      }

      function renderIssueList(snapshot) {
        var target = byId("issue-list");
        target.textContent = "";
        var issues = Array.isArray(snapshot.issues) ? snapshot.issues : [];
        if (issues.length === 0) {
          target.textContent = "沒有待處理 issue。";
          return;
        }
        for (var i = 0; i < issues.length; i += 1) {
          var issue = issues[i];
          if (!isRecord(issue)) continue;
          var row = document.createElement("div");
          row.className = "issue-row";
          var badge = document.createElement("span");
          badge.className = "status-badge " + (issue.effective_severity === "error" || issue.effective_severity === "critical" ? "error" : "active");
          badge.textContent = firstString(issue, ["effective_severity"]) || firstString(issue, ["severity"]) || "?";
          var text = document.createElement("span");
          var issueText = (firstString(issue, ["code"]) || "?") + "：" + (firstString(issue, ["message"]) || "") + "（" + (firstString(issue, ["status"]) || "?") + "）";
          if (issue.overridable) issueText += "〔可覆寫〕";
          if (isRecord(issue.override)) {
            issueText += " override→" + (firstString(issue.override, ["severity"]) || "?") + " by " + (firstString(issue.override, ["by"]) || "?") + "（" + (firstString(issue.override, ["reason"]) || "") + "）";
          }
          text.textContent = issueText;
          row.append(badge, text);
          var actions = document.createElement("span");
          actions.className = "inline-actions";
          if (issue.status === "open") {
            var reason = document.createElement("input");
            reason.type = "text";
            reason.placeholder = "原因（必填）…";
            var resolve = document.createElement("button");
            resolve.type = "button";
            resolve.textContent = "已解決";
            resolve.addEventListener("click", postIssueAction(issue.id, "resolve", reason, null));
            actions.append(reason, resolve);
            if (issue.overridable) {
              var ignore = document.createElement("button");
              ignore.type = "button";
              ignore.textContent = "忽略";
              ignore.addEventListener("click", postIssueAction(issue.id, "ignore", reason, null));
              actions.append(ignore);
              var effectiveRank = SEVERITY_RANK[issue.effective_severity] || 4;
              var select = document.createElement("select");
              select.setAttribute("aria-label", "覆寫目標嚴重度");
              for (var s = 0; s < SEVERITIES.length; s += 1) {
                if ((SEVERITY_RANK[SEVERITIES[s]] || 0) < effectiveRank) {
                  var option = document.createElement("option");
                  option.value = SEVERITIES[s];
                  option.textContent = SEVERITIES[s];
                  select.append(option);
                }
              }
              var preview = document.createElement("span");
              preview.className = "readiness-hint";
              preview.textContent = "effective " + (firstString(issue, ["effective_severity"]) || "?") + " → " + select.value;
              select.addEventListener("change", severityPreview(select, preview, issue));
              var override = document.createElement("button");
              override.type = "button";
              override.textContent = "覆寫";
              override.addEventListener("click", postIssueAction(issue.id, "override", reason, select));
              actions.append(ignore, select, preview, override);
            }
          }
          row.append(actions);
          target.append(row);
        }
      }

      function postIssue(issueId, action, reason, severity) {
        if (state.busy) return;
        var reasonValue = typeof reason === "string" ? reason.trim() : "";
        if (!reasonValue) {
          localValidation("Issue 操作", "請填寫原因後再操作。");
          return;
        }
        var body = { issue_id: issueId, action: action, reason: reasonValue };
        if (severity !== undefined) body.severity = severity;
        void runTask("更新 issue", async function () {
          var payload = await postJson("/workspace/issue", body);
          await refreshAfterAction();
          return payload;
        });
      }

      function submitFactDecision(run, occurrenceId, statement, selectElement, reasonElement, endpoint) {
        var reason = reasonElement.value;
        if (!reason || !reason.trim()) { localValidation("fact-review-run", "事實裁決需要原因。"); return; }
        postJson(endpoint, {
          decisions: [{ candidate_occurrence_id: occurrenceId, claim: statement, decision: selectElement.value, reason: reason }],
          run_id: run.id,
          expected_projection_revision: run.projection_revision || run.review_projection_revision || run.candidate_set_revision
        }).then(function () { reasonElement.value = ""; refresh(); }).catch(function (error) { setAreaError("fact-review-run", error); });
      }

      function factAdjudicationRow(run, occurrenceId, statement, status, conflictOnly) {
        var row = document.createElement("div");
        row.className = "fact-row fact-adjudication";
        var text = document.createElement("span");
        text.textContent = (statement || "?") + (status === "conflict" ? "（衝突，需 Director）" : "");
        row.append(text);
        var select = document.createElement("select");
        var options = [["accept", "接受"], ["reject", "拒絕"], ["needs_evidence", "需補證據"], ["conflict", "衝突"]];
        for (var o = 0; o < options.length; o += 1) {
          var option = document.createElement("option");
          option.value = options[o][0];
          option.textContent = options[o][1];
          select.append(option);
        }
        var reason = document.createElement("input");
        reason.type = "text";
        reason.placeholder = "裁決原因（必填）";
        row.append(select, reason);
        var submit = document.createElement("button");
        submit.className = "button";
        submit.textContent = conflictOnly ? "Director 解析" : "送出裁決";
        submit.addEventListener("click", function () {
          submitFactDecision(run, occurrenceId, statement, select, reason, conflictOnly ? "/workspace/fact/review/conflict" : "/workspace/fact/review/batch");
        });
        row.append(submit);
        return row;
      }

      function renderSourceFact(snapshot) {
        var candidates = Array.isArray(snapshot.candidates) ? snapshot.candidates : [];
        var sources = Array.isArray(snapshot.sources) ? snapshot.sources : [];
        var facts = Array.isArray(snapshot.facts) ? snapshot.facts : [];
        var runs = Array.isArray(snapshot.review_runs) ? snapshot.review_runs : [];
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
          var candidateLabel = (firstString(candidate, ["title"]) || "?") + (candidate.official ? "（官方）" : "");
          if (candidate.url) {
            var link = document.createElement("a");
            link.href = candidate.url;
            link.target = "_blank";
            link.rel = "noopener";
            link.textContent = candidateLabel;
            text.append(link);
          } else {
            text.textContent = candidateLabel;
          }
          row.append(badge, text);
          if (candidate.selection_snapshot && candidate.status === "approved") {
            var approved = document.createElement("span");
            approved.className = "status-badge ok";
            approved.textContent = "已選入（approved）";
            row.append(approved);
          }
          if (candidate.selection_snapshot && candidate.status === "rejected") {
            var rejected = document.createElement("span");
            rejected.className = "status-badge bad";
            rejected.textContent = "已拒絕（rejected）";
            row.append(rejected);
          }
          if (candidate.failure && isRecord(candidate.failure)) {
            var failure = document.createElement("span");
            failure.className = "status-badge bad";
            failure.textContent = "擷取失敗：" + (firstString(candidate.failure, ["code"]) || "?") + " " + (firstString(candidate.failure, ["message"]) || "");
            row.append(failure);
          }
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
          var sourceParts = [];
          sourceParts.push(firstString(source, ["title"]) || "?");
          if (source.media_type) sourceParts.push(source.media_type);
          if (source.revision) sourceParts.push("r" + String(source.revision).slice(0, 8));
          if (typeof source.chunk_count === "number") sourceParts.push("chunks " + source.chunk_count);
          if (typeof source.canonical_chars === "number") sourceParts.push("chars " + source.canonical_chars);
          sourceRow.textContent = sourceParts.join(" · ");
          if (source.url) {
            var sourceLink = document.createElement("a");
            sourceLink.href = source.url;
            sourceLink.target = "_blank";
            sourceLink.rel = "noopener";
            sourceLink.textContent = "開啟來源";
            sourceRow.append(sourceLink);
          }
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
          var statement = (firstString(fact, ["statement"]) || "");
          if (fact.status === "conflict") statement += "（待 Director 解析）";
          factText.textContent = statement;
          factRow.append(factBadge, factText);
          var factMeta = document.createElement("span");
          var factParts = [];
          if (typeof fact.fact_revision === "number") factParts.push("r" + fact.fact_revision);
          if (Array.isArray(fact.source_ids)) factParts.push("來源 " + fact.source_ids.length);
          if (fact.evidence_quote) factParts.push("引文：" + fact.evidence_quote);
          if (fact.locator) factParts.push("L:" + fact.locator);
          if (fact.chunk_id) factParts.push("chunk " + String(fact.chunk_id).slice(0, 8));
          if (fact.last_reviewer) factParts.push("reviewer " + fact.last_reviewer + "：" + (fact.last_decision || "?"));
          if (Array.isArray(fact.coverage) && fact.coverage.length > 0) factParts.push("coverage: " + fact.coverage.join("、"));
          factMeta.textContent = factParts.join(" · ");
          factRow.append(factMeta);
          factTarget.append(factRow);
        }
        var runTarget = byId("fact-review-run");
        runTarget.textContent = "";
        var latestRun = runs.length > 0 ? runs[runs.length - 1] : undefined;
        if (!isRecord(latestRun)) {
          runTarget.textContent = "尚未建立事實 Review Run。";
          var startButton = document.createElement("button");
          startButton.className = "button";
          startButton.textContent = "建立 Review Run";
          startButton.addEventListener("click", function () {
            postJson("/workspace/fact/review/run", {}).then(function () { refresh(); }).catch(function (error) { setAreaError("fact-review-run", error); });
          });
          runTarget.append(startButton);
          return;
        }
        var runHeading = document.createElement("div");
        runHeading.className = "fact-row";
        var runBadge = document.createElement("span");
        runBadge.className = "status-badge " + statusClass(firstString(latestRun, ["status"]) || "open");
        runBadge.textContent = "run " + (firstString(latestRun, ["status"]) || "open");
        var runMeta = document.createElement("span");
        var runParts = ["候選 " + (Array.isArray(latestRun.candidate_occurrence_ids) ? latestRun.candidate_occurrence_ids.length : 0)];
        if (latestRun.candidate_set_revision) runParts.push("candidate set " + String(latestRun.candidate_set_revision).slice(0, 8));
        if (latestRun.created_by) runParts.push("by " + latestRun.created_by);
        runMeta.textContent = runParts.join(" · ");
        runHeading.append(runBadge, runMeta);
        runTarget.append(runHeading);
        var adjudicated = new Set();
        if (Array.isArray(latestRun.decisions)) {
          for (var d = 0; d < latestRun.decisions.length; d += 1) {
            adjudicated.add(latestRun.decisions[d].candidate_occurrence_id);
          }
        }
        var candidatesForRun = Array.isArray(latestRun.candidates) ? latestRun.candidates : [];
        for (var m = 0; m < candidatesForRun.length; m += 1) {
          var runCandidate = candidatesForRun[m];
          if (!isRecord(runCandidate)) continue;
          if (adjudicated.has(runCandidate.candidate_occurrence_id)) continue;
          var isConflict = runCandidate.status === "conflict";
          runTarget.append(factAdjudicationRow(latestRun, runCandidate.candidate_occurrence_id, runCandidate.statement, runCandidate.status, isConflict));
        }
        if (candidatesForRun.length > 0 && adjudicated.size >= candidatesForRun.length) {
          var completeNote = document.createElement("div");
          completeNote.className = "muted";
          completeNote.textContent = "此 run 的所有候選事實都已裁決；可建立新 Review Run 進行下一輪。";
          runTarget.append(completeNote);
        }
      }

      function removeImage(imageId) {
        return function () {
          postImageRemove(imageId);
        };
      }

      function renderImageUploadOptions(roster, primaryCharacterId) {
        var select = byId("image-character");
        var current = select.value;
        var rosterList = Array.isArray(roster) ? roster : [];
        while (select.options.length > 1) select.remove(1);
        for (var i = 0; i < rosterList.length; i += 1) {
          var entry = rosterList[i];
          if (!isRecord(entry)) continue;
          var option = document.createElement("option");
          option.value = firstString(entry, ["id"]) || "";
          var label = firstString(entry, ["label"]) || firstString(entry, ["id"]) || "";
          if (firstString(entry, ["id"]) === primaryCharacterId) label += "（primary）";
          option.textContent = label;
          select.append(option);
        }
        var restored = false;
        for (var j = 0; j < select.options.length; j += 1) {
          if (select.options[j].value === current) {
            select.selectedIndex = j;
            restored = true;
            break;
          }
        }
        if (!restored) select.selectedIndex = 0;
      }

      function parseRatio(ratio) {
        var parts = typeof ratio === "string" ? ratio.split(":") : [];
        var width = parseFloat(parts[0] || "");
        var height = parseFloat(parts[1] || "");
        if (!(width > 0) || !(height > 0)) return undefined;
        return { width: width, height: height };
      }

      function renderCropPreview() {
        var container = byId("image-crop-preview");
        container.textContent = "";
        var fileInput = byId("image-file");
        var file = fileInput.files && fileInput.files.length > 0 ? fileInput.files[0] : undefined;
        var ratio = parseRatio(byId("image-ratio").value);
        if (file === undefined || !file.type || file.type.indexOf("image/") !== 0) {
          container.hidden = true;
          return;
        }
        var image = new Image();
        var url = URL.createObjectURL(file);
        image.onload = function () {
          var naturalRatio = image.naturalWidth / image.naturalHeight;
          var canvas = document.createElement("canvas");
          var maxWidth = 480;
          var scale = Math.min(1, maxWidth / image.naturalWidth);
          canvas.width = Math.round(image.naturalWidth * scale);
          canvas.height = Math.round(image.naturalHeight * scale);
          var ctx = canvas.getContext("2d");
          ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
          if (ratio !== undefined) {
            var currentRatio = image.naturalWidth / image.naturalHeight;
            var cropWidth = 0;
            var cropHeight = 0;
            var offsetX = 0;
            var offsetY = 0;
            if (currentRatio > ratio.width / ratio.height) {
              cropHeight = image.naturalHeight;
              cropWidth = cropHeight * ratio.width / ratio.height;
              offsetX = Math.floor((image.naturalWidth - cropWidth) / 2);
            } else {
              cropWidth = image.naturalWidth;
              cropHeight = cropWidth * ratio.height / ratio.width;
              offsetY = Math.floor((image.naturalHeight - cropHeight) / 2);
            }
            var sx = offsetX * scale;
            var sy = offsetY * scale;
            var sw = cropWidth * scale;
            var sh = cropHeight * scale;
            ctx.strokeStyle = "#1d6fb8";
            ctx.lineWidth = 2;
            ctx.strokeRect(sx, sy, sw, sh);
            ctx.fillStyle = "rgba(29,111,184,0.12)";
            ctx.fillRect(sx, sy, sw, sh);
            canvas.setAttribute("data-crop", "1");
            var sizeText = document.createElement("div");
            sizeText.className = "muted";
            sizeText.textContent = "裁切輸出約 " + Math.round(cropWidth) + "×" + Math.round(cropHeight) + "px（依內建封面裁切規則置中）";
            container.append(canvas, sizeText);
          } else {
            var plainText = document.createElement("div");
            plainText.className = "muted";
            plainText.textContent = "原始尺寸 " + image.naturalWidth + "×" + image.naturalHeight + "px，不裁切";
            container.append(canvas, plainText);
          }
          container.hidden = false;
          URL.revokeObjectURL(url);
        };
        image.onerror = function () {
          container.textContent = "無法讀取圖片預覽。";
          container.hidden = false;
        };
        image.src = url;
      }

      function renderImageList(images, roster, primaryCharacterId) {
        var target = byId("image-list");
        target.textContent = "";
        var list = Array.isArray(images) ? images : [];
        target.textContent = list.length === 0 ? "沒有角色圖像。" : "角色圖像 " + list.length + " 筆";
        renderImageUploadOptions(roster, primaryCharacterId);
        for (var i = 0; i < list.length; i += 1) {
          var image = list[i];
          if (!isRecord(image)) continue;
          var row = document.createElement("div");
          row.className = "fact-row";
          var preview = document.createElement("img");
          preview.setAttribute("src", "/workspace/images/" + (firstString(image, ["id"]) || "") + tokenQuery());
          preview.setAttribute("alt", "角色圖預覽");
          preview.className = "image-thumb";
          var text = document.createElement("span");
          var parts = [];
          var width = typeof image.width === "number" ? image.width : NaN;
          var height = typeof image.height === "number" ? image.height : NaN;
          parts.push(isNaN(width) || isNaN(height) ? "?×?" : width + "×" + height);
          if (image.aspect_ratio) parts.push("裁切 " + image.aspect_ratio);
          var characterId = typeof image.character_id === "string" ? image.character_id : undefined;
          if (characterId !== undefined) {
            var isPrimary = characterId === primaryCharacterId;
            parts.push(isPrimary ? "角色 " + characterId + "（primary）" : "角色 " + characterId);
          } else {
            parts.push("封面圖");
          }
          if (image.source) parts.push("來源：" + image.source);
          else parts.push("來源未註記");
          if (image.license) parts.push("授權：" + image.license);
          else parts.push("授權未註記");
          text.textContent = parts.join(" · ");
          if (characterId === undefined || (typeof image.source !== "string" || image.source === "") || (typeof image.license !== "string" || image.license === "")) {
            row.className = "fact-row row-warn";
          }
          var removeButton = document.createElement("button");
          removeButton.className = "inline-button";
          removeButton.textContent = "移除";
          removeButton.addEventListener("click", removeImage(firstString(image, ["id"]) || ""));
          row.append(preview, text, removeButton);
          target.append(row);
        }
      }

      function postImageRemove(imageId) {
        if (state.busy || imageId === "") return;
        void runTask("移除角色圖", async function () {
          var payload = await postJson("/workspace/images/remove", { image_id: imageId });
          await Promise.allSettled([loadDashboardData()]);
          return payload;
        });
      }

      function submitImage() {
        if (state.busy) return;
        var fileInput = byId("image-file");
        var file = fileInput.files && fileInput.files.length > 0 ? fileInput.files[0] : undefined;
        if (file === undefined) {
          byId("image-message").textContent = "請先選擇 PNG 圖片檔案。";
          return;
        }
        var reader = new FileReader();
        reader.onload = function () {
          var base64 = typeof reader.result === "string" ? reader.result.split(",")[1] || "" : "";
          var body = {
            attachments: [{ name: file.name, content_base64: base64, media_type: file.type || "image/png" }],
          };
          var characterId = byId("image-character").value;
          if (characterId !== "") body.character_id = characterId;
          var ratio = byId("image-ratio").value;
          if (ratio !== "") body.aspect_ratio = ratio;
          var source = byId("image-source").value.trim();
          if (source !== "") body.source = source;
          var license = byId("image-license").value.trim();
          if (license !== "") body.license = license;
          void runTask("上傳角色圖", async function () {
            var payload = await postJson("/workspace/images", body);
            await Promise.allSettled([loadDashboardData()]);
            return payload;
          });
        };
        reader.readAsDataURL(file);
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
        if (firstString(readiness, ["selected_mode"])) parts.push("選定模式 " + firstString(readiness, ["selected_mode"]));
        else if (firstString(readiness, ["export_modes"])) parts.push("Blueprint 模式 " + firstString(readiness, ["export_modes"]));
        if (firstString(readiness, ["card_name"])) parts.push("角色卡 " + firstString(readiness, ["card_name"]));
        if (firstString(readiness, ["world_book_name"])) parts.push("世界書 " + firstString(readiness, ["world_book_name"]));
        byId("build-message").textContent = parts.join(" · ");
        var entries = Array.isArray(readiness.entries) ? readiness.entries : [];
        var entryTarget = document.createElement("div");
        var entryLabels = entries.map(function (entry) {
          if (!isRecord(entry)) return "?";
          var label = (firstString(entry, ["kind"]) || "?") + ":" + (firstString(entry, ["name"]) || "?");
          if (firstString(entry, ["revision"])) label += "（@" + String(firstString(entry, ["revision"])).slice(0, 8) + "）";
          return label;
        });
        entryTarget.textContent = entries.length === 0 ? "沒有附加條目。" : "附加條目：" + entryLabels.join("、");
        target.append(entryTarget);
        var stats = [];
        if (readiness.greeting_entries !== undefined) stats.push("greeting 共 " + readiness.greeting_entries + " 組");
        if (readiness.alternate_greeting_count !== undefined) stats.push("備選 " + readiness.alternate_greeting_count + "／群組 " + readiness.group_greeting_count);
        if (firstString(readiness, ["first_greeting"])) stats.push("首發：" + String(firstString(readiness, ["first_greeting"])));
        if (Array.isArray(readiness.plugin_ids) && readiness.plugin_ids.length > 0) stats.push("plugin：" + readiness.plugin_ids.join("、"));
        if (readiness.png_expected !== undefined) stats.push(readiness.png_expected ? "將輸出 PNG" : "不輸出 PNG");
        if (isRecord(readiness.output_paths)) {
          if (firstString(readiness.output_paths, ["json"])) stats.push("JSON → " + firstString(readiness.output_paths, ["json"]));
          if (firstString(readiness.output_paths, ["png"])) stats.push("PNG → " + firstString(readiness.output_paths, ["png"]));
        }
        var totalChars = entries.reduce(function (sum, entry) { return sum + (isRecord(entry) && typeof entry.char_count === "number" ? entry.char_count : 0); }, 0);
        var totalTokens = entries.reduce(function (sum, entry) { return sum + (isRecord(entry) && typeof entry.estimated_tokens === "number" ? entry.estimated_tokens : 0); }, 0);
        if (entries.length > 0) stats.push("字數 " + totalChars + "／token 預估 " + totalTokens);
        var statsTarget = document.createElement("div");
        statsTarget.textContent = stats.join(" · ");
        target.append(statsTarget);
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
        byId("tavern-message").textContent = report.available === true
          ? (firstString(report, ["summary"]) || "相容性檢查完成。")
          : "目前無法檢查相容性。";
        var checks = Array.isArray(report.checks) ? report.checks : [];
        for (var i = 0; i < checks.length; i += 1) {
          var check = checks[i];
          if (!isRecord(check)) continue;
          var row = document.createElement("div");
          row.className = "fact-row tavern-check";
          var badge = document.createElement("span");
          var status = firstString(check, ["status"]) || "WARN";
          badge.className = "badge badge-" + String(status).toLowerCase();
          badge.textContent = status;
          row.append(badge);
          var label = document.createElement("strong");
          label.textContent = firstString(check, ["label"]) || "檢查";
          row.append(label);
          row.append("： " + (firstString(check, ["detail"]) || ""));
          target.append(row);
        }
        var jsonPath = firstString(report, ["json_path"]);
        var pngPath = firstString(report, ["png_path"]);
        if (jsonPath !== "" || pngPath !== "") {
          var paths = document.createElement("div");
          paths.className = "readiness-row";
          paths.textContent = (jsonPath === "" ? "" : "JSON → " + jsonPath + "　") + (pngPath === "" ? "" : "PNG → " + pngPath);
          target.append(paths);
        }
      }

      function renderRepairInspection(inspection) {
        var target = byId("repair-report");
        target.textContent = "";
        if (!isRecord(inspection)) {
          byId("repair-message").textContent = "沒有修復資料。";
          return;
        }
        var items = Array.isArray(inspection.items) ? inspection.items : [];
        var planHash = firstString(inspection, ["plan_hash"]);
        if (planHash !== "") repairPlanHash = planHash;
        if (items.length === 0) {
          byId("repair-message").textContent = "沒有需要修復的項目。";
          return;
        }
        byId("repair-message").textContent = "發現 " + items.length + " 項待修復（計畫 hash " + planHash.slice(0, 12) + "）。";
        for (var i = 0; i < items.length; i += 1) {
          var item = items[i];
          if (!isRecord(item)) continue;
          var row = document.createElement("div");
          row.className = "readiness-row";
          var badge = document.createElement("span");
          badge.className = "badge badge-" + (firstString(item, ["kind"]) === "orphan_backup" ? "warn" : "info");
          badge.textContent = firstString(item, ["kind"]) === "orphan_backup" ? "孤兒備份" : "legacy";
          row.append(badge);
          row.append(" " + (firstString(item, ["source"]) || "?") + " → " + (firstString(item, ["target"]) || "?"));
          var note = document.createElement("div");
          note.className = "muted";
          note.textContent = (firstString(item, ["reason"]) || "") + (item.recoverable === true ? "（可回復）" : "（不可回復）");
          row.append(note);
          target.append(row);
        }
      }

      function renderRepairReport(report) {
        var target = byId("repair-report");
        target.textContent = "";
        if (!isRecord(report)) {
          byId("repair-message").textContent = "修復執行沒有回報。";
          return;
        }
        var actions = Array.isArray(report.actions) ? report.actions : [];
        byId("repair-message").textContent = actions.length === 0 ? "修復完成：沒有需要處理的項目。" : "修復完成（計畫 hash " + firstString(report, ["plan_hash"]).slice(0, 12) + "）。";
        for (var i = 0; i < actions.length; i += 1) {
          var action = actions[i];
          if (!isRecord(action)) continue;
          var row = document.createElement("div");
          row.className = "readiness-row";
          var outcome = firstString(action, ["outcome"]) || "skipped";
          var badge = document.createElement("span");
          badge.className = "badge badge-" + (outcome === "archived" ? "pass" : outcome === "missing" ? "fail" : "warn");
          badge.textContent = outcome === "archived" ? "已歸檔" : outcome === "missing" ? "來源已不存在" : "略過";
          row.append(badge);
          row.append(" " + (firstString(action, ["source"]) || "?") + " → " + (firstString(action, ["target"]) || "?"));
          target.append(row);
        }
      }

      async function loadArtifactData() {
        try {
          var pages = await Promise.all([
            requestJson("/workspace/dashboard/artifacts?limit=50"),
            requestJson("/workspace/dashboard/reviews?limit=200")
          ]);
          var artifactPage = pages[0];
          var reviewPage = pages[1];
          renderArtifactList({
            items: Array.isArray(artifactPage.items) ? artifactPage.items : [],
            total: artifactPage.total,
            reviews: Array.isArray(reviewPage.items) ? reviewPage.items : []
          });
          return artifactPage;
        } catch (error) {
          setAreaError("artifact-message", error);
          throw error;
        }
      }

      async function loadIssueData() {
        try {
          var payload = await requestJson("/workspace/dashboard/issues?limit=100");
          renderIssueList({ issues: Array.isArray(payload.items) ? payload.items : [] });
          return payload;
        } catch (error) {
          setAreaError("quality-message", error);
          throw error;
        }
      }

      async function loadSourceFactData() {
        try {
          var pages = await Promise.all([
            requestJson("/workspace/dashboard/candidates?limit=50"),
            requestJson("/workspace/dashboard/sources?limit=50"),
            requestJson("/workspace/dashboard/facts?limit=100"),
            requestJson("/workspace/dashboard/fact-review/runs?limit=20")
          ]);
          var runs = Array.isArray(pages[3].items) ? pages[3].items : [];
          if (runs.length > 0 && firstString(runs[runs.length - 1], ["id"])) {
            var runDetail = await requestJson("/workspace/dashboard/fact-review/runs/" + encodeURIComponent(firstString(runs[runs.length - 1], ["id"])));
            runs[runs.length - 1] = runDetail;
          }
          renderSourceFact({
            candidates: Array.isArray(pages[0].items) ? pages[0].items : [],
            sources: Array.isArray(pages[1].items) ? pages[1].items : [],
            facts: Array.isArray(pages[2].items) ? pages[2].items : [],
            review_runs: runs
          });
          return pages;
        } catch (error) {
          setAreaError("source-fact-message", error);
          throw error;
        }
      }

      async function loadOperationData() {
        try {
          var payload = await requestJson("/workspace/dashboard/operations?limit=100");
          renderOperationList(Array.isArray(payload.items) ? payload.items : []);
          return payload;
        } catch (error) {
          setAreaError("operation-message", error);
          throw error;
        }
      }

      async function loadDashboardData() {
        try {
          var payload = await requestJson("/workspace/dashboard/data");
          renderPrecheckMatrix(payload.prechecks);
          renderQuality(payload);
          renderImageList(payload.images, payload.roster, payload.primary_character_id);
          var staleBanner = byId("image-stale-banner");
          if (payload.images_stale === true) {
            staleBanner.hidden = false;
            staleBanner.textContent = "圖片已變更，最新發布的輸出已過期；請重新打包（Preview／發布）。";
          } else {
            staleBanner.hidden = true;
          }
          byId("artifact-message").textContent = "首頁摘要已載入；按下按鈕取得 artifact 明細。";
          byId("source-fact-message").textContent = "首頁摘要已載入；按下按鈕取得來源與事實。";
          byId("operation-message").textContent = "首頁摘要已載入；按下按鈕取得 operation。";
          byId("quality-message").textContent = "首頁摘要已載入；按下按鈕取得 issue。";
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
        var overrides = {};
        var codes = Object.keys(currentOverrides);
        for (var i = 0; i < codes.length; i += 1) overrides[codes[i]] = currentOverrides[codes[i]];
        void runTask("套用品質設定", async function () {
          var payload = await postJson("/workspace/quality/profile", { level: level, overrides: overrides });
          await Promise.allSettled([loadDashboardData()]);
          return payload;
        });
      }

      function runRepair() {
        void runTask("執行修復", async function () {
          var payload = await postJson("/workspace/repair/run", { plan_hash: repairPlanHash });
          renderRepairReport(payload);
          return payload;
        });
      }

      function createNewProject() {
        if (state.busy) return;
        void runTask("建立新專案", async function () {
          var payload = await postJson("/workspace/project/new", {});
          await refreshAfterAction();
          return payload;
        });
      }

      function revealProjectPanel() {
        var panel = byId("project-panel");
        if (panel) {
          panel.hidden = false;
          panel.scrollIntoView({ behavior: "smooth", block: "start" });
        }
        var select = byId("project-select");
        if (select) select.focus();
      }

      function legacyReviewEntry() {
        revealProjectPanel();
        setNotice("info", "舊卡審核：請先選擇或建立專案，再於結構化訪談中選擇「舊卡審核」。");
      }

      byId("operation-filter").addEventListener("change", function () {
        renderOperationList(cachedOperations);
      });
      byId("load-artifacts").addEventListener("click", function () {
        void runTask("載入 Artifact", loadArtifactData);
      });
      byId("load-issues").addEventListener("click", function () {
        void runTask("載入 Issues", loadIssueData);
      });
      byId("load-source-facts").addEventListener("click", function () {
        void runTask("載入來源與事實", loadSourceFactData);
      });
      byId("load-operations").addEventListener("click", function () {
        void runTask("載入 Operations", loadOperationData);
      });
      byId("check-readiness").addEventListener("click", function () {
        void runTask("Publish 就緒檢查", async function () {
          var modeSelect = byId("readiness-mode");
          var modeValue = modeSelect instanceof HTMLSelectElement ? modeSelect.value : "";
          var endpoint = modeValue === "" ? "/workspace/publish/preview" : "/workspace/publish/preview?mode=" + encodeURIComponent(modeValue);
          var payload = await requestJson(endpoint);
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
      byId("add-quality-override").addEventListener("click", addQualityOverride);
      byId("submit-image").addEventListener("click", submitImage);
      byId("image-file").addEventListener("change", renderCropPreview);
      byId("image-ratio").addEventListener("change", renderCropPreview);
      byId("refresh").addEventListener("click", function () { void refresh(); });
      byId("submit-request").addEventListener("click", submitRequest);
      byId("select-project").addEventListener("click", selectProject);
      byId("new-project").addEventListener("click", createNewProject);
      byId("home-new-project").addEventListener("click", createNewProject);
      byId("home-open-project").addEventListener("click", revealProjectPanel);
      byId("home-legacy-review").addEventListener("click", legacyReviewEntry);
      byId("interview-target-submit").addEventListener("click", function () {
        submitInterviewAnswer(byId("interview-target-select").value);
      });
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
