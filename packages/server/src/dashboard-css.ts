export const DASHBOARD_CSS = `  <style>
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
    .status-badge.cancelled { color: #475569; background: #f1f5f9; border: 1px solid #cbd5e1; }
    .workflow-stages {
      display: grid;
      grid-template-columns: repeat(1, minmax(0, 1fr));
      gap: 0.55rem;
      margin: 0.75rem 0 0;
    }
    .workflow-stage {
      border: 1px solid #dfe6ec;
      border-radius: 8px;
      padding: 0.55rem 0.75rem;
      background: #fbfcfd;
    }
    .workflow-stage-title {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-weight: 700;
    }
    .workflow-blockers {
      margin: 0.4rem 0 0;
      padding-left: 1.1rem;
      color: #8e3030;
      font-size: 0.85rem;
    }
    .workflow-invalidations {
      margin: 0.75rem 0 0;
      font-size: 0.88rem;
    }
    .workflow-invalidations-heading {
      font-weight: 700;
      margin-bottom: 0.4rem;
    }
    .workflow-invalidation-item {
      border: 1px solid #f0d4d4;
      border-radius: 8px;
      padding: 0.45rem 0.65rem;
      margin-bottom: 0.4rem;
      background: #fffafa;
    }
    .workflow-invalidation-title {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-weight: 700;
    }
    .workflow-stage button {
      margin-top: 0.45rem;
    }
    .coverage-center-heading {
      margin-top: 1rem;
      font-size: 0.9rem;
    }
    .coverage-center-heading h3 {
      margin: 0 0 0.25rem;
    }
    .coverage-center {
      margin-top: 0.6rem;
    }
    .research-monitor {
      margin-top: 0.6rem;
      display: grid;
      gap: 0.5rem;
    }
    .evidence-passage {
      margin-top: 0.4rem;
      padding: 0.4rem 0.55rem;
      border-left: 3px solid #c9d6e0;
      background: #f7fafc;
      font-size: 0.88rem;
    }
    .evidence-passage strong {
      background: #fdecc8;
      padding: 0 0.15rem;
    }
    .kpi-list {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      margin-top: 0.6rem;
    }
    .kpi-item {
      border: 1px solid #dfe6ec;
      border-radius: 8px;
      padding: 0.3rem 0.55rem;
      background: #fbfcfd;
      font-size: 0.85rem;
    }
    .provenance-summary {
      margin-top: 0.75rem;
    }
    .provenance-history {
      margin-top: 0.75rem;
    }
    .provenance-section {
      border: 1px solid #dfe6ec;
      border-radius: 8px;
      padding: 0.45rem 0.65rem;
      margin-top: 0.5rem;
      background: #fbfcfd;
      font-size: 0.85rem;
    }
    .provenance-section.supplement {
      border-left: 4px solid #3d7a5a;
    }
    .provenance-section.creative {
      border-left: 4px solid #7a5a3d;
    }
    .provenance-section ul {
      margin: 0.4rem 0 0;
      padding-left: 1.2rem;
    }
    .provenance-hash-row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-top: 0.35rem;
      flex-wrap: wrap;
    }
    .provenance-hash-row code {
      word-break: break-all;
      max-width: 34rem;
      font-size: 0.8rem;
    }
    .readiness-row {
      display: flex;
      align-items: flex-start;
      gap: 0.5rem;
      margin-bottom: 0.4rem;
    }
    .diagnostic-highlight {
      outline: 3px solid #c98a00;
      outline-offset: 2px;
      background: #fff8e1;
    }
    .diagnostic-nav {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      margin-left: 0.5rem;
    }
    .diagnostic-nav-count {
      font-size: 0.82rem;
      color: #607585;
      min-width: 3.5rem;
      text-align: center;
    }
    @media (prefers-reduced-motion: reduce) {
      .diagnostic-highlight {
        outline-width: 3px;
        scroll-behavior: auto;
      }
    }
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
`;
