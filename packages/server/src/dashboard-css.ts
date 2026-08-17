export const DASHBOARD_CSS = `  <style>
    :root {
      color-scheme: light dark;
      --color-page: #f2f5f9;
      --color-surface: #ffffff;
      --color-surface-elevated: #ffffff;
      --color-surface-subtle: #f8fafc;
      --color-surface-muted: #f1f5f9;
      --color-surface-warm: #fffdf7;
      --color-code-bg: #f6f6f6;
      --color-text-primary: #1f2937;
      --color-text-secondary: #334155;
      --color-text-muted: #64748b;
      --color-text-label: #39566b;
      --color-text-inverse: #ffffff;
      --color-on-accent: #ffffff;
      --color-control-text: #12324a;
      --color-control-border: #9bb7d4;
      --color-heading: #142c3e;
      --color-code-text: #1e293b;
      --color-border: #cbd5e1;
      --color-border-strong: #94a3b8;
      --color-divider: #dde5ec;
      --color-accent: #1f5f91;
      --color-accent-hover: #2d6a9f;
      --color-accent-active: #164a73;
      --color-accent-subtle: #eef6ff;
      --color-accent-overlay: rgba(31, 95, 145, 0.12);
      --color-focus: #005fb8;
      --color-link: #2563eb;
      --color-link-hover: #1d4ed8;
      --color-neutral-text: #43515d;
      --color-neutral-bg: #e9eef2;
      --color-disabled-bg: #9ca3af;
      --color-info-text: #0369a1;
      --color-info-bg: #e0f2fe;
      --color-info-border: #bfdbfe;
      --color-success-text: #247047;
      --color-success-strong: #15803d;
      --color-success-bg: #eaf7ef;
      --color-success-border: #a7f3d0;
      --color-success-shadow: rgba(34, 197, 94, 0.2);
      --color-warning-text: #92400e;
      --color-warning-strong: #b45309;
      --color-warning-bg: #fffbeb;
      --color-warning-border: #fde68a;
      --color-warning-shadow: rgba(245, 158, 11, 0.2);
      --color-error-text: #a43d3d;
      --color-error-strong: #b91c1c;
      --color-error-bg: #fff0ef;
      --color-error-border: #fecaca;
      --color-purple-bg: #ede9fe;
      --color-purple-text: #5b21b6;
      --color-supplement-border: #3d7a5a;
      --color-creative-border: #7a5a3d;
      --color-overlay: rgba(15, 23, 42, 0.65);
      --color-shadow: rgba(0, 0, 0, 0.2);
      --color-shadow-subtle: rgba(0, 0, 0, 0.1);
      font-family: "Segoe UI", "Noto Sans TC", system-ui, sans-serif;
      color: var(--color-text-primary);
      background: var(--color-page);
      line-height: 1.55;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --color-page: #0b1220;
        --color-surface: #111827;
        --color-surface-elevated: #182334;
        --color-surface-subtle: #1a2533;
        --color-surface-muted: #243244;
        --color-surface-warm: #2a2618;
        --color-code-bg: #0c1422;
        --color-text-primary: #e5edf7;
        --color-text-secondary: #c2cfdd;
        --color-text-muted: #9aabbc;
        --color-text-label: #b7c9da;
        --color-text-inverse: #0b1220;
        --color-on-accent: #07111f;
        --color-control-text: #e5edf7;
        --color-control-border: #53677d;
        --color-heading: #eef6ff;
        --color-code-text: #d7e2ef;
        --color-border: #334155;
        --color-border-strong: #52647a;
        --color-divider: #26364a;
        --color-accent: #60a5fa;
        --color-accent-hover: #93c5fd;
        --color-accent-active: #3b82f6;
        --color-accent-subtle: #172b46;
        --color-accent-overlay: rgba(96, 165, 250, 0.18);
        --color-focus: #7dd3fc;
        --color-link: #7dc4ff;
        --color-link-hover: #bfdbfe;
        --color-neutral-text: #cbd5e1;
        --color-neutral-bg: #273448;
        --color-disabled-bg: #4b5563;
        --color-info-text: #7dd3fc;
        --color-info-bg: #123047;
        --color-info-border: #286184;
        --color-success-text: #86efac;
        --color-success-strong: #4ade80;
        --color-success-bg: #123524;
        --color-success-border: #2c6e4b;
        --color-success-shadow: rgba(34, 197, 94, 0.3);
        --color-warning-text: #fcd34d;
        --color-warning-strong: #fbbf24;
        --color-warning-bg: #3a2b0b;
        --color-warning-border: #8a6113;
        --color-warning-shadow: rgba(245, 158, 11, 0.35);
        --color-error-text: #fca5a5;
        --color-error-strong: #f87171;
        --color-error-bg: #3b1c23;
        --color-error-border: #7f3341;
        --color-purple-bg: #33204d;
        --color-purple-text: #d8b4fe;
        --color-supplement-border: #4ade80;
        --color-creative-border: #c084fc;
        --color-overlay: rgba(2, 6, 23, 0.8);
        --color-shadow: rgba(0, 0, 0, 0.4);
        --color-shadow-subtle: rgba(0, 0, 0, 0.25);
      }
    }
    * { box-sizing: border-box; }
    body { margin: 0; min-width: 320px; background: var(--color-page); }
    button, select, textarea, input { font: inherit; }
    button, select, input[type="text"], input[type="url"], input[type="search"] { min-height: 2.5rem; }
    button {
      border: 1px solid var(--color-control-border);
      border-radius: 0.55rem;
      padding: 0.55rem 0.85rem;
      color: var(--color-control-text);
      background: var(--color-surface);
      cursor: pointer;
    }
    button:hover:not(:disabled) { border-color: var(--color-accent-hover); background: var(--color-accent-subtle); }
    button.primary, .btn-primary { border-color: var(--color-accent); color: var(--color-on-accent); background: var(--color-accent); }
    button.primary:hover:not(:disabled), .btn-primary:hover:not(:disabled) { background: var(--color-accent-active); }
    button.danger, .danger-button { border-color: var(--color-error-strong); color: var(--color-on-accent); background: var(--color-error-strong); font-weight: 600; }
    button.danger:hover:not(:disabled), .danger-button:hover:not(:disabled) { background: var(--color-error-strong); }
    .btn-secondary { border-color: var(--color-border); color: var(--color-text-secondary); background: var(--color-surface); }
    .btn-secondary:hover:not(:disabled) { border-color: var(--color-border-strong); background: var(--color-surface-subtle); }
    .btn-compact, .inline-button { min-height: 1.9rem; padding: 0.25rem 0.6rem; font-size: 0.82rem; }
    .action-link {
      background: none;
      border: none;
      color: var(--color-accent);
      text-decoration: underline;
      cursor: pointer;
      padding: 0.2rem 0.4rem;
      min-height: auto;
      font-size: 0.85rem;
    }
    .action-link:hover { color: var(--color-link-hover); }
    button.choice { width: 100%; text-align: left; }
    button:disabled, select:disabled, textarea:disabled, input:disabled {
      cursor: not-allowed;
      opacity: 0.58;
    }
    select, textarea, input[type="text"], input[type="url"], input[type="search"], input[type="file"] {
      width: 100%;
      border: 1px solid var(--color-control-border);
      border-radius: 0.55rem;
      padding: 0.6rem 0.7rem;
      color: var(--color-control-text);
      background: var(--color-surface);
    }
    .inline-actions select, .field-row select, .form-actions select, .publish-controls select {
      width: auto;
      max-width: 100%;
    }
    textarea { min-height: 7rem; resize: vertical; }
    :focus-visible {
      outline: 2px solid var(--color-focus) !important;
      outline-offset: 2px !important;
    }
    .app-shell { width: min(1180px, 100%); margin: 0 auto; padding: 1.25rem; }
    .app-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 1rem;
      padding-top: 2rem;
      padding-bottom: 0.75rem;
    }
    h1, h2, h3 { margin: 0; line-height: 1.25; color: var(--color-heading); }
    h1 { font-size: clamp(1.55rem, 3vw, 2.25rem); }
    h2 { font-size: 1.15rem; }
    h3 { font-size: 0.95rem; }
    p { margin: 0.55rem 0 0; }
    .subtitle, .muted { color: var(--color-text-muted); }
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
      border: 1px solid var(--color-border);
      border-radius: 0.9rem;
      padding: 1rem;
      background: var(--color-surface);
      box-shadow: 0 0.35rem 1.2rem var(--color-shadow-subtle);
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
    .field-label, label { display: block; margin-top: 0.85rem; font-size: 0.88rem; font-weight: 650; color: var(--color-text-label); }
    .field-label:first-child { margin-top: 0; }
    .panel-message { min-height: 1.6rem; color: var(--color-text-muted); }
    .panel-message.error { color: var(--color-error-text); }
    .panel-message.success { color: var(--color-success-text); }
    .busy-indicator { min-height: 1.5rem; color: var(--color-info-text); font-size: 0.9rem; }
    .notice {
      margin-top: 0.65rem;
      border-radius: 0.6rem;
      padding: 0.6rem 0.75rem;
      color: var(--color-info-text);
      background: var(--color-info-bg);
    }
    .notice.success { color: var(--color-success-text); background: var(--color-success-bg); }
    .notice.error { color: var(--color-error-text); background: var(--color-error-bg); }
    .notice.info { color: var(--color-info-text); background: var(--color-info-bg); }
    .header-status-line {
      display: flex;
      align-items: center;
      gap: 1rem;
      flex-wrap: wrap;
    }
    .last-updated-indicator {
      font-size: 0.85rem;
      color: var(--color-text-muted);
    }
    .transient-notice {
      margin-top: 0.5rem;
      border-radius: 0.55rem;
      padding: 0.5rem 0.8rem;
      font-size: 0.88rem;
      color: var(--color-info-text);
      background: var(--color-info-bg);
      border: 1px solid var(--color-info-border);
    }
    .transient-notice.success { color: var(--color-success-strong); background: var(--color-success-bg); border-color: var(--color-success-border); }
    .transient-notice.error { color: var(--color-error-strong); background: var(--color-error-bg); border-color: var(--color-error-border); }
    .transient-notice.warning { color: var(--color-warning-text); background: var(--color-warning-bg); border-color: var(--color-warning-border); }
    .cell-action-item {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      flex-wrap: wrap;
    }
    .prerequisite-nav-btn {
      font-size: 0.82rem;
      padding: 0.25rem 0.55rem;
      border: 1px dashed var(--color-link);
      background: var(--color-surface-subtle);
      color: var(--color-link-hover);
      border-radius: 0.4rem;
      cursor: pointer;
    }
    .prerequisite-nav-btn:hover:not(:disabled) {
      background: var(--color-info-bg);
      border-style: solid;
    }
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border-width: 0;
    }
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
      color: var(--color-neutral-text);
      background: var(--color-neutral-bg);
      font-size: 0.82rem;
      font-weight: 700;
    }
    .status-badge.ready { color: var(--color-success-strong); background: var(--color-success-bg); }
    .status-badge.active { color: var(--color-info-text); background: var(--color-info-bg); }
    .status-badge.error { color: var(--color-error-text); background: var(--color-error-bg); }
    .status-badge.cancelled { color: var(--color-text-secondary); background: var(--color-surface-muted); border: 1px solid var(--color-border); }
    .workflow-stages {
      display: grid;
      grid-template-columns: repeat(1, minmax(0, 1fr));
      gap: 0.55rem;
      margin: 0.75rem 0 0;
    }
    .workflow-stage {
      border: 1px solid var(--color-border);
      border-radius: 8px;
      padding: 0.55rem 0.75rem;
      background: var(--color-surface-subtle);
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
      color: var(--color-error-text);
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
      border: 1px solid var(--color-error-border);
      border-radius: 8px;
      padding: 0.45rem 0.65rem;
      margin-bottom: 0.4rem;
      background: var(--color-error-bg);
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
    .recovery-cards {
  margin-top: 0.6rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.recovery-card {
  border: 1px solid var(--color-error-border);
  border-radius: 8px;
  padding: 0.6rem 0.75rem;
  background: var(--color-error-bg);
}
.recovery-title {
  font-weight: 600;
  color: var(--color-error-text);
  margin-bottom: 0.35rem;
}
.recovery-cause, .recovery-impact, .recovery-correlation {
  margin: 0.2rem 0;
  font-size: 0.9rem;
}
.recovery-affected {
  margin: 0.25rem 0 0.25rem 1rem;
  font-size: 0.85rem;
}
.recovery-technical {
  margin-top: 0.35rem;
}
.recovery-technical pre {
  max-height: 12rem;
  overflow: auto;
  background: var(--color-code-bg);
  border-radius: 6px;
  padding: 0.4rem;
  font-size: 0.75rem;
}
.recovery-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-top: 0.45rem;
}
.recovery-action {
  padding: 0.28rem 0.6rem;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-surface-subtle);
  cursor: pointer;
}
.recovery-dismiss {
  background: transparent;
  border: none;
  color: var(--color-error-text);
  cursor: pointer;
  font-size: 0.85rem;
}

.section-nav {
      grid-column: 1 / -1;
      width: 100%;
      box-sizing: border-box;
      position: sticky;
      top: 0;
      z-index: 40;
      display: flex;
      flex-wrap: wrap;
      gap: 0.4rem;
      padding: 0.5rem 0.75rem;
      margin-bottom: 0.75rem;
      background: var(--color-surface);
      border-bottom: 1px solid var(--color-divider);
    }
    .section-nav-button {
      padding: 0.3rem 0.7rem;
      border: 1px solid var(--color-border-strong);
      border-radius: 6px;
      background: var(--color-surface-subtle);
      color: var(--color-text-secondary);
      cursor: pointer;
      font-size: 0.85rem;
    }
    .section-nav-button:hover {
      background: var(--color-surface-subtle);
    }
    .section-nav-button.active {
      background: var(--color-accent);
      border-color: var(--color-accent);
      color: var(--color-on-accent);
      font-weight: 600;
    }
    .coverage-center-heading {
      margin-top: 1rem;
      font-size: 0.9rem;
    }
    .coverage-center-heading h3 {
      margin: 0 0 0.25rem;
    }
    .coverage-toolbar {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 0.5rem;
      margin-bottom: 0.75rem;
    }
    .coverage-filter-label {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      margin: 0;
      color: var(--color-text-secondary);
      font-size: 0.85rem;
      font-weight: 650;
    }
    .coverage-filter-select { width: auto; min-width: 8rem; }
    .coverage-grid {
      display: grid;
      gap: 0.6rem;
    }
    .coverage-cell {
      min-width: 0;
      border: 1px solid var(--color-border);
      border-radius: 0.65rem;
      padding: 0.7rem 0.8rem;
      background: var(--color-surface);
    }
    .coverage-cell-title {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 0.45rem;
      font-weight: 700;
      color: var(--color-text-primary);
    }
    .coverage-cell-summary { margin-top: 0.25rem; overflow-wrap: anywhere; }
    .coverage-cell-counts { margin-top: 0.35rem; font-size: 0.82rem; overflow-wrap: anywhere; }
    .coverage-cell > .disclosure-toggle { margin-top: 0.55rem; }
    .coverage-cell-disclosure {
      margin-top: 0.65rem;
      padding-top: 0.65rem;
      border-top: 1px solid var(--color-divider);
    }
    .coverage-cell-details { display: grid; gap: 0.45rem; }
    .coverage-actions { display: flex; flex-wrap: wrap; gap: 0.45rem; margin-top: 0.35rem; }
    .coverage-history-detail,
    .coverage-lifecycle-detail {
      margin-top: 0.35rem;
      padding: 0.45rem 0.65rem;
      border-radius: 0.4rem;
      font-size: 0.85rem;
    }
    .coverage-history-detail {
      color: var(--color-text-secondary);
      background: var(--color-surface-subtle);
      border: 1px dashed var(--color-border-strong);
    }
    .coverage-lifecycle-detail {
      color: var(--color-info-text);
      background: var(--color-info-bg);
      border: 1px solid var(--color-info-border);
    }
    .coverage-lifecycle-stage { margin-bottom: 0.15rem; font-weight: 700; }
    .coverage-lifecycle-failure { margin-top: 0.15rem; color: var(--color-error-text); font-weight: 700; }
    .coverage-lifecycle-attempt { margin-top: 0.15rem; color: var(--color-text-secondary); }
    .coverage-lifecycle-history { margin-top: 0.15rem; color: var(--color-text-muted); }
    .coverage-count-message,
    .research-count-message { font-size: 0.84rem; }
    .coverage-more-button,
    .research-more-button { justify-self: start; }
    .empty-state,
    .loading-state {
      padding: 0.7rem 0.8rem;
      border: 1px dashed var(--color-border-strong);
      border-radius: 0.5rem;
      color: var(--color-text-secondary);
      background: var(--color-surface-subtle);
    }
    .error-state { color: var(--color-error-text); background: var(--color-error-bg); border-color: var(--color-error-border); }
    .research-monitor-summary,
    .research-batches-section,
    .research-tasks-section { margin-top: 0.85rem; }
    .research-monitor-summary h3,
    .research-batches-section h4,
    .research-lineages-section h4,
    .research-tasks-section h4 { margin: 0; }
    .research-summary-note { margin-top: 0.45rem; }
    .research-batch-list,
    .research-lineage-list { display: grid; gap: 0.5rem; margin-top: 0.55rem; }
    .research-batch-stage { margin: 0; }
    .research-batch-stage > .disclosure-toggle { margin-top: 0.5rem; }
    .research-batch-disclosure,
    .research-lineage-disclosure { margin-top: 0.55rem; }
    .research-batch-details { display: grid; gap: 0.35rem; padding: 0.55rem 0.65rem; color: var(--color-text-secondary); background: var(--color-surface-subtle); border-radius: 0.4rem; }
    .research-batch-task-ids { overflow-wrap: anywhere; }
    .lineage-card-summary { margin: 0; }
    .lineage-card-summary > .disclosure-toggle { margin-top: 0.45rem; }
    .lineage-summary-count { flex: 1 1 16rem; }
    .research-all-shown { border-style: solid; }
    .coverage-center {
      margin-top: 0.6rem;
    }
    .research-monitor {
      margin-top: 0.6rem;
      display: grid;
      gap: 0.5rem;
    }
    .url-ingestion-monitor {
      margin-top: 0.9rem;
      padding-top: 0.85rem;
      border-top: 1px solid var(--color-border);
    }
    .url-ingestion-section { display: grid; gap: 0.55rem; }
    .url-ingestion-section h3 { margin: 0; }
    .url-ingestion-list { display: grid; gap: 0.5rem; }
    .url-ingestion-card {
      border: 1px solid var(--color-border);
      border-radius: 0.6rem;
      padding: 0.65rem 0.75rem;
      background: var(--color-surface);
    }
    .url-ingestion-card.needs-attention { border-color: var(--color-warning-border); background: var(--color-warning-bg); }
    .url-ingestion-summary { display: flex; align-items: center; gap: 0.55rem; flex-wrap: wrap; cursor: pointer; }
    .url-ingestion-url { max-width: 42rem; overflow-wrap: anywhere; font-weight: 650; color: var(--color-text-primary); }
    .url-ingestion-details { display: grid; gap: 0.55rem; margin-top: 0.65rem; padding-top: 0.65rem; border-top: 1px solid var(--color-divider); }
    .url-ingestion-meta { display: grid; grid-template-columns: minmax(7rem, 0.35fr) minmax(0, 1fr); gap: 0.25rem 0.75rem; margin: 0; }
    .url-ingestion-meta dt { color: var(--color-text-muted); font-size: 0.82rem; }
    .url-ingestion-meta dd { margin: 0; overflow-wrap: anywhere; color: var(--color-text-primary); }
    .url-ingestion-history, .url-ingestion-context { overflow-wrap: anywhere; }
    .url-ingestion-components { margin: 0.65rem 0 0; padding-left: 1.35rem; color: var(--color-text-secondary); }
    .url-ingestion-components li + li { margin-top: 0.25rem; }
    .url-ingestion-failure { padding: 0.45rem 0.6rem; border: 1px solid var(--color-error-border); border-radius: 0.4rem; overflow-wrap: anywhere; }
    .url-ingestion-actions { display: flex; gap: 0.45rem; flex-wrap: wrap; }
    .url-ingestion-summary-note { margin-bottom: 0.15rem; }
    .evidence-passage {
      margin-top: 0.4rem;
      padding: 0.4rem 0.55rem;
      border-left: 3px solid var(--color-border);
      background: var(--color-surface-subtle);
      font-size: 0.88rem;
    }
    .evidence-passage strong {
      background: var(--color-warning-bg);
      padding: 0 0.15rem;
    }
    .kpi-list {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      margin-top: 0.6rem;
    }
    .kpi-item {
      border: 1px solid var(--color-border);
      border-radius: 8px;
      padding: 0.3rem 0.55rem;
      background: var(--color-surface-subtle);
      font-size: 0.85rem;
    }
    .provenance-summary {
      margin-top: 0.75rem;
    }
    .provenance-history {
      margin-top: 0.75rem;
    }
    .provenance-section {
      border: 1px solid var(--color-border);
      border-radius: 8px;
      padding: 0.45rem 0.65rem;
      margin-top: 0.5rem;
      background: var(--color-surface-subtle);
      font-size: 0.85rem;
    }
    .provenance-section.supplement {
      border-left: 4px solid var(--color-supplement-border);
    }
    .provenance-section.creative {
      border-left: 4px solid var(--color-creative-border);
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
      outline: 3px solid var(--color-warning-strong);
      outline-offset: 2px;
      background: var(--color-warning-bg);
    }
    .diagnostic-nav {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      margin-left: 0.5rem;
    }
    .diagnostic-nav-count {
      font-size: 0.82rem;
      color: var(--color-text-muted);
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
      border-bottom: 1px solid var(--color-surface-subtle);
      padding-bottom: 0.45rem;
    }
    .field-row dt { color: var(--color-text-muted); font-size: 0.82rem; }
    .field-row dd {
      max-width: 65%;
      margin: 0;
      overflow-wrap: anywhere;
      color: var(--color-text-primary);
      text-align: right;
    }
    .agent-list, .choice-list { display: grid; gap: 0.6rem; margin-top: 0.8rem; }
    .agent-card {
      border: 1px solid var(--color-border);
      border-radius: 0.65rem;
      padding: 0.65rem 0.75rem;
      background: var(--color-surface-subtle);
    }
    .agent-name { display: flex; align-items: center; gap: 0.45rem; font-weight: 700; color: var(--color-heading); }
    .agent-tag {
      border-radius: 999px;
      padding: 0.08rem 0.45rem;
      color: var(--color-info-text);
      background: var(--color-info-bg);
      font-size: 0.75rem;
      font-weight: 650;
    }
    .agent-description { margin-top: 0.2rem; color: var(--color-text-muted); font-size: 0.88rem; overflow-wrap: anywhere; }
    .form-actions { display: flex; flex-wrap: wrap; gap: 0.55rem; margin-top: 0.75rem; }
    .form-actions button { flex: 0 0 auto; }
    .raw-json { margin-top: 1rem; border-top: 1px solid var(--color-surface-subtle); padding-top: 0.65rem; }
    .raw-json summary { color: var(--color-link); cursor: pointer; font-weight: 650; }
    pre {
      max-height: 20rem;
      margin: 0.65rem 0 0;
      overflow: auto;
      border-radius: 0.6rem;
      padding: 0.75rem;
      color: var(--color-text-primary);
      background: var(--color-code-bg);
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      font: 0.82rem/1.45 ui-monospace, SFMono-Regular, Consolas, monospace;
    }
    .deferred-list { margin: 0.75rem 0 0; padding-left: 1.25rem; color: var(--color-text-muted); }
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
    .publish-stepper {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      list-style: none;
      margin: 0 0 0.9rem 0;
      padding: 0.65rem 0.8rem;
      background: var(--color-surface-subtle);
      border: 1px solid var(--color-border);
      border-radius: 0.65rem;
    }
    .stepper-step {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.35rem 0.65rem;
      border-radius: 0.45rem;
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      font-size: 0.82rem;
      color: var(--color-text-muted);
    }
    .stepper-step .step-num {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 1.35rem;
      height: 1.35rem;
      border-radius: 50%;
      background: var(--color-border);
      color: var(--color-text-secondary);
      font-weight: 700;
      font-size: 0.75rem;
    }
    .stepper-step .step-badge {
      font-size: 0.7rem;
      padding: 0.05rem 0.35rem;
      border-radius: 999px;
      background: var(--color-surface-muted);
      text-transform: uppercase;
      font-weight: 600;
    }
    .stepper-step.current {
      border-color: var(--color-accent-active);
      background: var(--color-info-bg);
      color: var(--color-link-hover);
      font-weight: 600;
    }
    .stepper-step.current .step-num {
      background: var(--color-accent-active);
      color: var(--color-on-accent);
    }
    .stepper-step.pass {
      border-color: var(--color-success-strong);
      background: var(--color-success-bg);
      color: var(--color-success-strong);
    }
    .stepper-step.pass .step-num {
      background: var(--color-success-strong);
      color: var(--color-on-accent);
    }
    .stepper-step.blocked {
      border-color: var(--color-error-strong);
      background: var(--color-error-bg);
      color: var(--color-error-strong);
    }
    .stepper-step.blocked .step-num {
      background: var(--color-error-strong);
      color: var(--color-on-accent);
    }
    .stepper-step.stale {
      border-color: var(--color-warning-strong);
      background: var(--color-warning-bg);
      color: var(--color-warning-strong);
    }
    .stepper-step.stale .step-num {
      background: var(--color-warning-strong);
      color: var(--color-on-accent);
    }
    .provenance-card {
      border: 1px solid var(--color-border);
      border-radius: 0.75rem;
      padding: 1rem;
      background: var(--color-surface);
      margin-top: 0.8rem;
    }
    .provenance-card.stale-border {
      border-color: var(--color-warning-strong);
      box-shadow: 0 0 0 2px var(--color-warning-shadow);
    }
    .provenance-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 0.75rem;
      border-bottom: 1px solid var(--color-surface-muted);
      padding-bottom: 0.5rem;
    }
    .provenance-title {
      font-size: 1.05rem;
      font-weight: 700;
      color: var(--color-code-text);
    }
    .provenance-groups {
      display: grid;
      gap: 0.65rem;
      margin-top: 0.65rem;
    }
    .provenance-group-item {
      padding: 0.6rem 0.75rem;
      border: 1px solid var(--color-border);
      border-radius: 0.5rem;
      background: var(--color-surface-subtle);
    }
    .provenance-group-item.stale {
      border-color: var(--color-warning-strong);
      background: var(--color-warning-bg);
    }
    .group-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-weight: 600;
      font-size: 0.88rem;
      color: var(--color-text-secondary);
    }
    .group-status {
      font-size: 0.72rem;
      padding: 0.1rem 0.45rem;
      border-radius: 999px;
      font-weight: 600;
    }
    .group-status.included { background: var(--color-success-bg); color: var(--color-success-strong); }
    .group-status.not_applicable { background: var(--color-surface-muted); color: var(--color-text-muted); }
    .group-status.legacy_unavailable { background: var(--color-error-bg); color: var(--color-error-strong); }
    .group-body {
      margin-top: 0.35rem;
      font-size: 0.82rem;
      color: var(--color-text-secondary);
    }
    .provenance-cover-preview {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      margin-top: 0.4rem;
    }
    .provenance-cover-thumb {
      width: 48px;
      height: 48px;
      object-fit: cover;
      border-radius: 0.35rem;
      border: 1px solid var(--color-border);
    }
    .human-ack-box {
      margin-top: 0.85rem;
      padding: 0.75rem;
      background: var(--color-success-bg);
      border: 1px solid var(--color-success-border);
      border-radius: 0.5rem;
      font-size: 0.85rem;
      color: var(--color-success-strong);
      line-height: 1.45;
    }
    .provenance-stale-diff {
      margin-top: 0.75rem;
      padding: 0.75rem;
      background: var(--color-warning-bg);
      border: 1px solid var(--color-warning-border);
      border-radius: 0.5rem;
    }
    .stale-diff-title {
      font-weight: 700;
      color: var(--color-warning-text);
      font-size: 0.9rem;
      margin-bottom: 0.4rem;
    }
    .stale-diff-item {
      padding: 0.35rem 0;
      border-top: 1px solid var(--color-warning-bg);
      font-size: 0.82rem;
      color: var(--color-warning-text);
    }
    .both-blocker-info {
      margin-top: 0.5rem;
      padding: 0.65rem 0.8rem;
      background: var(--color-error-bg);
      border: 1px solid var(--color-error-border);
      border-radius: 0.5rem;
      color: var(--color-error-strong);
      font-size: 0.85rem;
    }
    .copy-chip {
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      padding: 0.1rem 0.4rem;
      background: var(--color-border);
      border-radius: 0.25rem;
      font-size: 0.75rem;
      font-family: ui-monospace, monospace;
      color: var(--color-code-text);
      border: none;
    }
    .copy-chip:hover {
      background: var(--color-border);
    }
    .diagnostic-group-card {
      border: 1px solid var(--color-border);
      border-radius: 0.65rem;
      padding: 0.85rem;
      margin-bottom: 0.85rem;
      background: var(--color-surface);
    }
    .diagnostic-group-card.severity-error {
      border-color: var(--color-error-border);
      background: var(--color-error-bg);
    }
    .diagnostic-group-card.severity-warning {
      border-color: var(--color-warning-border);
      background: var(--color-surface-warm);
    }
    .diagnostic-group-header {
      display: flex;
      align-items: center;
      gap: 0.65rem;
      flex-wrap: wrap;
      margin-bottom: 0.65rem;
    }
    .diagnostic-group-title {
      font-size: 0.95rem;
      color: var(--color-code-text);
      flex: 1;
    }
    .diagnostic-object-list {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    .diagnostic-object-row {
      border: 1px solid var(--color-border);
      border-radius: 0.4rem;
      padding: 0.5rem 0.75rem;
      background: var(--color-surface);
    }
    .diagnostic-object-head {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      flex-wrap: wrap;
    }
    .diagnostic-object-id {
      font-weight: 600;
      font-size: 0.88rem;
      color: var(--color-code-text);
    }
    .diagnostic-code-badge {
      font-size: 0.75rem;
      padding: 0.1rem 0.4rem;
      background: var(--color-info-bg);
      color: var(--color-info-text);
      border-radius: 0.25rem;
      font-weight: 600;
    }
    .diagnostic-msg {
      font-size: 0.85rem;
      color: var(--color-text-secondary);
      flex: 1;
    }
    .secondary-diagnostics {
      margin-top: 0.4rem;
      font-size: 0.82rem;
      color: var(--color-text-muted);
      padding: 0.25rem 0.5rem;
      background: var(--color-surface-subtle);
      border-radius: 0.3rem;
    }
    .secondary-diagnostic-line {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      margin-top: 0.25rem;
    }
    .creative-warning-box {
      padding: 0.75rem;
      background: var(--color-warning-bg);
      border: 1px solid var(--color-warning-strong);
      border-radius: 0.4rem;
      font-weight: 600;
      color: var(--color-warning-text);
      margin-bottom: 0.85rem;
    }
    .creative-info-section {
      background: var(--color-surface-subtle);
      border: 1px solid var(--color-border);
      border-radius: 0.4rem;
      padding: 0.75rem;
      margin-bottom: 0.85rem;
    }
    .creative-meta-dl {
      margin: 0;
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 0.35rem 0.75rem;
      font-size: 0.85rem;
    }
    .consequences-header {
      font-weight: 600;
      margin-top: 0.5rem;
      font-size: 0.85rem;
      color: var(--color-text-secondary);
    }
    .consequences-list {
      margin: 0.25rem 0 0 1.25rem;
      padding: 0;
      font-size: 0.82rem;
      color: var(--color-text-secondary);
    }
    .creative-form {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }
    .research-lineages-section {
      margin-top: 1.25rem;
      padding-top: 0.85rem;
      border-top: 1px solid var(--color-border);
    }
    .lineages-title {
      margin: 0 0 0.75rem 0;
      font-size: 1rem;
      color: var(--color-code-text);
    }
    .lineage-card {
      border: 1px solid var(--color-border);
      border-radius: 0.6rem;
      padding: 0.75rem;
      margin-bottom: 0.85rem;
      background: var(--color-surface);
    }
    .lineage-card-header {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex-wrap: wrap;
      margin-bottom: 0.6rem;
    }
    .scope-tag {
      font-size: 0.75rem;
      padding: 0.1rem 0.45rem;
      border-radius: 0.25rem;
      font-weight: 600;
    }
    .scope-character { background: var(--color-purple-bg); color: var(--color-purple-text); }
    .scope-world { background: var(--color-purple-bg); color: var(--color-purple-text); }
    .lineage-chains-flow {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    .lineage-chain-row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex-wrap: wrap;
      padding: 0.4rem;
      background: var(--color-surface-subtle);
      border-radius: 0.4rem;
    }
    .lineage-node-card {
      border: 1px solid var(--color-border);
      border-radius: 0.4rem;
      padding: 0.4rem 0.6rem;
      background: var(--color-surface);
      min-width: 140px;
      display: flex;
      flex-direction: column;
      gap: 0.3rem;
    }
    .node-in-flight {
      border-color: var(--color-success-border);
      box-shadow: 0 0 4px var(--color-success-shadow);
    }
    .node-terminal {
      border-color: var(--color-border);
      opacity: 0.9;
    }
    .node-top, .node-mid, .node-bot {
      display: flex;
      align-items: center;
      gap: 0.35rem;
      flex-wrap: wrap;
    }
    .lineage-arrow {
      font-size: 1.1rem;
      color: var(--color-border-strong);
      font-weight: bold;
    }
    .flight-tag {
      font-size: 0.7rem;
      padding: 0.05rem 0.35rem;
      border-radius: 0.2rem;
      font-weight: 600;
    }
    .flight-active { background: var(--color-success-bg); color: var(--color-success-strong); }
    .flight-terminal { background: var(--color-surface-muted); color: var(--color-text-muted); }
    .origin-badge {
      font-size: 0.7rem;
      padding: 0.05rem 0.35rem;
      border-radius: 0.2rem;
      font-weight: 600;
    }
    .origin-newly_created { background: var(--color-info-bg); color: var(--color-info-text); }
    .origin-reused_existing { background: var(--color-warning-bg); color: var(--color-warning-text); }
    .origin-successor_recovery { background: var(--color-purple-bg); color: var(--color-purple-text); }
    .origin-legacy_unknown { background: var(--color-surface-muted); color: var(--color-text-secondary); }
    .recovery-action-tag {
      font-size: 0.72rem;
      padding: 0.05rem 0.35rem;
      background: var(--color-error-bg);
      color: var(--color-error-strong);
      border-radius: 0.2rem;
    }
    .task-link-btn {
      background: none;
      border: none;
      padding: 0;
      color: var(--color-link);
      text-decoration: underline;
      cursor: pointer;
      font-size: 0.82rem;
      font-weight: 600;
    }
    .action-link-small {
      background: none;
      border: none;
      padding: 0;
      color: var(--color-text-secondary);
      text-decoration: underline;
      cursor: pointer;
      font-size: 0.75rem;
    }
    .task-context-dl {
      margin: 0;
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 0.35rem 0.75rem;
      font-size: 0.85rem;
    }
    .task-context-ops {
      margin-top: 0.85rem;
      border-top: 1px solid var(--color-border);
      padding-top: 0.5rem;
    }
    .task-op-list {
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
      margin-top: 0.35rem;
    }
    .task-op-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      padding: 0.3rem 0.5rem;
      background: var(--color-surface-muted);
      border-radius: 0.3rem;
      font-size: 0.82rem;
    }
    .external-change-notice {
      border: 1px solid var(--color-warning-strong);
      background: var(--color-warning-bg);
      color: var(--color-warning-text);
      border-radius: 0.4rem;
      padding: 0.6rem 0.8rem;
      margin-bottom: 0.8rem;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
    }
    .external-change-notice .form-actions { margin: 0; }
    .external-change-notice-text { flex: 1 1 24rem; }
    .interview-history {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      margin-top: 0.6rem;
    }
    .interview-history-entry {
      border: 1px solid var(--color-border);
      border-radius: 0.4rem;
      padding: 0.5rem 0.7rem;
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
    }
    .interview-history-entry.current { border-left: 4px solid var(--color-success-strong); }
    .interview-history-entry.superseded { border-left: 4px solid var(--color-disabled-bg); opacity: 0.8; }
    .interview-history-entry.amendment { border-left: 4px solid var(--color-link); }
    .interview-history-head {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex-wrap: wrap;
    }
    .interview-history-head strong { flex: 1 1 16rem; }
    .history-time { font-size: 0.8rem; }
    .history-tag {
      font-size: 0.75rem;
      border-radius: 0.25rem;
      padding: 0.1rem 0.45rem;
      color: var(--color-on-accent);
      background: var(--color-disabled-bg);
    }
    .history-tag.current { background: var(--color-success-strong); }
    .history-tag.superseded { background: var(--color-text-muted); }
    .history-tag.amendment { background: var(--color-link); }
    .interview-history-answer {
      white-space: pre-wrap;
      font-size: 0.9rem;
    }
    .amend-area {
      border: 1px dashed var(--color-link);
      border-radius: 0.4rem;
      padding: 0.7rem;
      margin-top: 0.6rem;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    .amend-impact {
      border-radius: 0.4rem;
      background: var(--color-info-bg);
      padding: 0.5rem 0.7rem;
      font-size: 0.88rem;
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }
    .amend-impact p { margin: 0; }
    .external-link-warning {
      display: inline-block;
      margin-left: 0.5rem;
      color: var(--color-warning-strong);
      font-size: 0.85rem;
    }
    .modal-overlay, .dialog-overlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: var(--color-overlay);
      z-index: 9999;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1.25rem;
      box-sizing: border-box;
    }
    .modal-dialog, .dialog-modal {
      background: var(--color-surface-elevated);
      border-radius: 0.75rem;
      max-width: min(560px, 95vw);
      width: 100%;
      max-height: 90vh;
      overflow-y: auto;
      padding: 1.5rem;
      box-shadow: 0 10px 25px -5px var(--color-shadow), 0 8px 10px -6px var(--color-shadow-subtle);
      font-family: inherit;
      outline: none;
      box-sizing: border-box;
    }
    .modal-title, .dialog-modal h3 {
      margin: 0 0 1rem 0;
      font-size: 1.25rem;
      font-weight: 700;
      color: var(--color-code-text);
    }
    .dialog-actions, .modal-actions {
      display: flex;
      justify-content: flex-end;
      gap: 0.75rem;
      margin-top: 1.5rem;
      flex-wrap: wrap;
    }
    .creative-warning-box {
      background: var(--color-warning-bg);
      border: 1px solid var(--color-warning-border);
      border-left: 4px solid var(--color-warning-strong);
      color: var(--color-warning-text);
      padding: 0.75rem 1rem;
      border-radius: 0.5rem;
      font-size: 0.88rem;
      line-height: 1.5;
      margin-bottom: 1rem;
    }
    .creative-meta-dl {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 0.4rem 0.8rem;
      font-size: 0.88rem;
      margin: 0 0 1rem 0;
      background: var(--color-surface-subtle);
      padding: 0.8rem 1rem;
      border-radius: 0.5rem;
      border: 1px solid var(--color-border);
    }
    .dialog-input, .dialog-textarea {
      width: 100%;
      box-sizing: border-box;
      margin-top: 0.35rem;
    }
    .dialog-error {
      color: var(--color-error-strong);
      font-weight: 600;
      font-size: 0.88rem;
      margin-top: 0.5rem;
    }
    .image-thumb, .image-card-thumb {
      width: 4.5rem;
      height: 4.5rem;
      object-fit: cover;
      border-radius: 0.4rem;
      border: 1px solid var(--color-border);
      background: var(--color-surface-subtle);
      flex-shrink: 0;
    }
    .image-card {
      border: 1px solid var(--color-border);
      border-radius: 0.55rem;
      padding: 0.75rem;
      background: var(--color-surface);
      display: flex;
      gap: 0.75rem;
      align-items: center;
    }
    .image-placeholder {
      width: 4.5rem;
      height: 4.5rem;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--color-surface-muted);
      border-radius: 0.4rem;
      color: var(--color-border-strong);
      font-size: 0.75rem;
      border: 1px dashed var(--color-border);
    }
    #image-crop-preview canvas {
      max-width: 100%;
      height: auto;
      border-radius: 0.4rem;
      border: 1px solid var(--color-border);
      background: var(--color-surface);
    }
    .publish-completion-card {
      background: var(--color-success-bg);
      border: 1px solid var(--color-success-border);
      border-radius: 0.75rem;
      padding: 1.25rem;
      margin-top: 1rem;
    }
    .publish-completion-card .completion-title {
      color: var(--color-success-strong);
      font-size: 1.15rem;
      font-weight: 700;
      margin-top: 0;
      margin-bottom: 0.5rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .publish-completion-card .completion-summary {
      color: var(--color-success-strong);
      font-size: 0.92rem;
      line-height: 1.6;
      margin-bottom: 1rem;
    }
    .publish-completion-card .download-guide {
      background: var(--color-surface);
      border: 1px solid var(--color-success-bg);
      border-radius: 0.5rem;
      padding: 0.75rem 1rem;
      font-size: 0.88rem;
      color: var(--color-code-text);
      margin-bottom: 1rem;
    }
    .publish-completion-card .completion-actions {
      display: flex;
      gap: 0.75rem;
      flex-wrap: wrap;
      align-items: center;
    }
    .home-action {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      padding: 0.6rem 1.2rem;
      font-weight: 600;
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation-duration: 0.001ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.001ms !important;
        scroll-behavior: auto !important;
      }
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
