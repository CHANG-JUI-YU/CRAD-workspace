export const DASHBOARD_MARKUP = `<body>
  <header class="app-shell app-header">
    <div>
      <h1>ST Workspace 本機工作台</h1>
      <p class="subtitle">用自然語言與單題訪談操作目前工作區；內部 workflow 參數由既有 runtime 管理。</p>
      <div class="header-status-line">
        <div id="busy-indicator" class="busy-indicator" aria-live="polite"></div>
        <div id="last-updated-indicator" class="last-updated-indicator" aria-live="polite"></div>
      </div>
      <div id="transient-notice" class="transient-notice" aria-live="polite" hidden></div>
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

    <nav id="section-nav" class="section-nav" aria-label="工作區段導覽"></nav>
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
      <div id="kpi-list" class="kpi-list"></div>
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
          <p class="muted">一次回答目前這一題；有選項時可直接點選，也可以用文字回答。輸入中途會自動保留草稿。</p>
        </div>
      </div>
      <div id="external-change-notice" class="external-change-notice" hidden>
        <div class="external-change-notice-text" aria-live="polite"></div>
        <div class="form-actions">
          <button id="draft-discard" class="danger" type="button">捨棄草稿</button>
          <button id="draft-review" type="button">檢視草稿</button>
          <button id="draft-refresh" class="primary" type="button">重新整理</button>
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
      <details id="interview-history-details">
        <summary>訪談答案歷史（可修訂）</summary>
        <div id="interview-history" class="interview-history" aria-live="polite"></div>
        <div id="amend-area" class="amend-area" hidden>
          <h4 id="amend-question-title">修訂訪談答案</h4>
          <div id="amend-question-text" class="muted"></div>
          <label for="amend-answer-input">新的回答</label>
          <textarea id="amend-answer-input" placeholder="輸入修訂後的回答"></textarea>
          <div id="amend-impact" class="amend-impact" aria-live="polite"></div>
          <div id="amend-message" class="panel-message" aria-live="polite"></div>
          <div class="form-actions">
            <button id="amend-cancel" type="button">取消</button>
            <button id="amend-preview" type="button">預覽影響</button>
            <button id="amend-confirm" class="primary" type="button" disabled>確認修訂</button>
          </div>
        </div>
      </details>
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
          <h2 id="readiness-heading">Publish 權威發布中心</h2>
          <p class="muted">嚴格遵循五階段發布狀態機，以可追溯的 Provenance 快照完成不可變確認與發布。</p>
        </div>
      </div>
      <ol id="publish-stepper" class="publish-stepper" aria-label="發布流程階段">
        <li class="stepper-step current" data-step="readiness" aria-current="step"><span class="step-num">1</span><span class="step-label">發布就緒</span><span class="step-badge">進行中</span></li>
        <li class="stepper-step" data-step="inputs_frozen"><span class="step-num">2</span><span class="step-label">輸入凍結</span><span class="step-badge">等待中</span></li>
        <li class="stepper-step" data-step="provenance_reviewed"><span class="step-num">3</span><span class="step-label">Provenance 審查</span><span class="step-badge">等待中</span></li>
        <li class="stepper-step" data-step="confirmed"><span class="step-num">4</span><span class="step-label">發布確認</span><span class="step-badge">等待中</span></li>
        <li class="stepper-step" data-step="published"><span class="step-num">5</span><span class="step-label">發布完成</span><span class="step-badge">等待中</span></li>
      </ol>
      <div class="form-actions publish-controls">
        <select id="readiness-mode" aria-label="就緒檢查打包模式">
          <option value="">依專案自動判斷</option>
          <option value="zhuji">Zhuji</option>
          <option value="palette">Palette</option>
          <option value="both" id="readiness-both-mode" disabled>Both（兩者）</option>
        </select>
        <button id="publish-primary-cta" class="primary" type="button">檢查發布就緒</button>
        <button id="check-readiness" type="button" style="display:none;">重新檢查</button>
        <button id="prepare-provenance" type="button" style="display:none;">準備發布確認</button>
        <button id="confirm-publish" type="button" style="display:none;" disabled>確認並發布</button>
      </div>
      <div id="both-mode-blocker-info" class="both-blocker-info" style="display:none;"></div>
      <div id="readiness-message" class="panel-message" aria-live="polite">尚未執行就緒檢查。</div>
      <div id="readiness-list" class="readiness-list"></div>
      <div id="provenance-stale-diff" class="provenance-stale-diff" style="display:none;"></div>
      <div id="provenance-summary" class="provenance-summary"></div>
    <div id="publish-completion" class="publish-completion" aria-live="polite"></div>
      <div id="provenance-confirm-message" class="panel-message" aria-live="polite">尚未準備 provenance 確認。</div>
      <div id="provenance-history" class="provenance-history"></div>
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
</details>
      <div id="latest-recovery" class="recovery-cards" aria-live="polite"></div>
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
      <p class="muted" id="candidates-count" aria-live="polite"></p>
      <button id="candidates-more" type="button" aria-label="載入更多候選來源">載入更多</button>
      <div id="candidate-list" class="candidate-list"></div>
      <p class="muted" id="sources-count" aria-live="polite"></p>
      <button id="sources-more" type="button" aria-label="載入更多來源">載入更多</button>
      <div id="source-list" class="source-list"></div>
      <p class="muted" id="facts-count" aria-live="polite"></p>
      <button id="facts-more" type="button" aria-label="載入更多事實">載入更多</button>
      <div id="fact-list" class="fact-list"></div>
      <p class="muted" id="runs-count" aria-live="polite"></p>
      <button id="runs-more" type="button" aria-label="載入更多審查回合">載入更多</button>
      <div id="fact-review-run" class="fact-list"></div>
      <div class="coverage-center-heading">
        <h3 id="evidence-heading">Fact Review 證據上下文</h3>
        <p class="muted">待裁決事實的逐字引文、來源段落與前後文，以及證據失效狀態。</p>
      </div>
      <div id="evidence-message" class="panel-message" aria-live="polite">尚未取得證據上下文。</div>
      <div id="evidence-list" class="fact-list"></div>
      <div id="evidence-source-detail" class="fact-list"></div>
    </section>

    <section class="panel panel-wide" aria-labelledby="coverage-heading">
      <div class="panel-heading">
        <div>
          <h2 id="coverage-heading">Coverage 角色設定覆蓋</h2>
          <p class="muted">Coverage Center 覆蓋矩陣與研究監控：角色 × 需求覆蓋矩陣、研究批次與 resolution 的權威即時狀態。</p>
        </div>
        <button id="load-coverage" type="button">載入覆蓋矩陣</button>
      </div>
      <div id="coverage-center-message" class="panel-message" aria-live="polite">尚未取得覆蓋矩陣資料。</div>
      <div id="coverage-center" class="coverage-center"></div>
      <div id="research-monitor" class="research-monitor"></div>
    </section>

    <section class="panel panel-wide" aria-labelledby="workflow-heading">
      <div class="panel-heading">
        <div>
          <h2 id="workflow-heading">來源適配工作流程</h2>
          <p class="muted">九階段進度、目前下一步與最新下游失效狀態。</p>
        </div>
        <button id="load-workflow" type="button">載入工作流程</button>
      </div>
      <div id="workflow-message" class="panel-message" aria-live="polite">尚未取得工作流程資料。</div>
      <div id="workflow-stages" class="workflow-stages"></div>
      <div id="workflow-invalidations" class="workflow-invalidations"></div>
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
          <div id="operation-last-updated" class="muted"></div>
        </div>
        <label class="field-label" for="operation-filter">狀態篩選
          <select id="operation-filter">
            <option value="all">全部</option>
            <option value="active">進行中</option>
            <option value="needs_input">待輸入</option>
            <option value="failed">失敗</option>
            <option value="cancelled">已取消</option>
            <option value="terminal">已完成／已取消／已失敗</option>
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

`;
