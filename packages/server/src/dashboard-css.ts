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
    button, select, textarea, input { font: inherit; }
    button, select, input[type="text"], input[type="url"], input[type="search"] { min-height: 2.5rem; }
    button {
      border: 1px solid #9bb7d4;
      border-radius: 0.55rem;
      padding: 0.55rem 0.85rem;
      color: #12324a;
      background: #fff;
      cursor: pointer;
    }
    button:hover:not(:disabled) { border-color: #2d6a9f; background: #eef6ff; }
    button.primary, .btn-primary { border-color: #1f5f91; color: #fff; background: #1f5f91; }
    button.primary:hover:not(:disabled), .btn-primary:hover:not(:disabled) { background: #164a73; }
    button.danger, .danger-button { border-color: #b91c1c; color: #fff; background: #dc2626; font-weight: 600; }
    button.danger:hover:not(:disabled), .danger-button:hover:not(:disabled) { background: #b91c1c; }
    .btn-secondary { border-color: #cbd5e1; color: #334155; background: #fff; }
    .btn-secondary:hover:not(:disabled) { border-color: #94a3b8; background: #f8fafc; }
    .btn-compact, .inline-button { min-height: 1.9rem; padding: 0.25rem 0.6rem; font-size: 0.82rem; }
    .action-link {
      background: none;
      border: none;
      color: #1f5f91;
      text-decoration: underline;
      cursor: pointer;
      padding: 0.2rem 0.4rem;
      min-height: auto;
      font-size: 0.85rem;
    }
    .action-link:hover { color: #123e63; }
    button.choice { width: 100%; text-align: left; }
    button:disabled, select:disabled, textarea:disabled, input:disabled {
      cursor: not-allowed;
      opacity: 0.58;
    }
    select, textarea, input[type="text"], input[type="url"], input[type="search"], input[type="file"] {
      width: 100%;
      border: 1px solid #b7c4d1;
      border-radius: 0.55rem;
      padding: 0.6rem 0.7rem;
      color: #172b3a;
      background: #fff;
    }
    .inline-actions select, .field-row select, .form-actions select, .publish-controls select {
      width: auto;
      max-width: 100%;
    }
    textarea { min-height: 7rem; resize: vertical; }
    :focus-visible {
      outline: 2px solid #005fb8 !important;
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
    .header-status-line {
      display: flex;
      align-items: center;
      gap: 1rem;
      flex-wrap: wrap;
    }
    .last-updated-indicator {
      font-size: 0.85rem;
      color: #64748b;
    }
    .transient-notice {
      margin-top: 0.5rem;
      border-radius: 0.55rem;
      padding: 0.5rem 0.8rem;
      font-size: 0.88rem;
      color: #1e3a8a;
      background: #eff6ff;
      border: 1px solid #bfdbfe;
    }
    .transient-notice.success { color: #065f46; background: #ecfdf5; border-color: #a7f3d0; }
    .transient-notice.error { color: #991b1b; background: #fef2f2; border-color: #fecaca; }
    .transient-notice.warning { color: #92400e; background: #fffbeb; border-color: #fde68a; }
    .cell-action-item {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      flex-wrap: wrap;
    }
    .prerequisite-nav-btn {
      font-size: 0.82rem;
      padding: 0.25rem 0.55rem;
      border: 1px dashed #2563eb;
      background: #f8fafc;
      color: #1d4ed8;
      border-radius: 0.4rem;
      cursor: pointer;
    }
    .prerequisite-nav-btn:hover:not(:disabled) {
      background: #eff6ff;
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
    .recovery-cards {
  margin-top: 0.6rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.recovery-card {
  border: 1px solid #e0b4b4;
  border-radius: 8px;
  padding: 0.6rem 0.75rem;
  background: #fff8f8;
}
.recovery-title {
  font-weight: 600;
  color: #8e3030;
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
  background: #f6f6f6;
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
  border: 1px solid #c9d6e0;
  border-radius: 6px;
  background: #f7fafc;
  cursor: pointer;
}
.recovery-dismiss {
  background: transparent;
  border: none;
  color: #8e3030;
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
      background: #ffffff;
      border-bottom: 1px solid #dde5ec;
    }
    .section-nav-button {
      padding: 0.3rem 0.7rem;
      border: 1px solid #c7d3dd;
      border-radius: 6px;
      background: #f7fafc;
      color: #33475b;
      cursor: pointer;
      font-size: 0.85rem;
    }
    .section-nav-button:hover {
      background: #eef3f7;
    }
    .section-nav-button.active {
      background: #2f6f9f;
      border-color: #2f6f9f;
      color: #ffffff;
      font-weight: 600;
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
    .publish-stepper {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      list-style: none;
      margin: 0 0 0.9rem 0;
      padding: 0.65rem 0.8rem;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 0.65rem;
    }
    .stepper-step {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.35rem 0.65rem;
      border-radius: 0.45rem;
      background: #ffffff;
      border: 1px solid #cbd5e1;
      font-size: 0.82rem;
      color: #64748b;
    }
    .stepper-step .step-num {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 1.35rem;
      height: 1.35rem;
      border-radius: 50%;
      background: #e2e8f0;
      color: #475569;
      font-weight: 700;
      font-size: 0.75rem;
    }
    .stepper-step .step-badge {
      font-size: 0.7rem;
      padding: 0.05rem 0.35rem;
      border-radius: 999px;
      background: #f1f5f9;
      text-transform: uppercase;
      font-weight: 600;
    }
    .stepper-step.current {
      border-color: #3b82f6;
      background: #eff6ff;
      color: #1d4ed8;
      font-weight: 600;
    }
    .stepper-step.current .step-num {
      background: #3b82f6;
      color: #ffffff;
    }
    .stepper-step.pass {
      border-color: #10b981;
      background: #ecfdf5;
      color: #047857;
    }
    .stepper-step.pass .step-num {
      background: #10b981;
      color: #ffffff;
    }
    .stepper-step.blocked {
      border-color: #ef4444;
      background: #fef2f2;
      color: #b91c1c;
    }
    .stepper-step.blocked .step-num {
      background: #ef4444;
      color: #ffffff;
    }
    .stepper-step.stale {
      border-color: #f59e0b;
      background: #fffbeb;
      color: #b45309;
    }
    .stepper-step.stale .step-num {
      background: #f59e0b;
      color: #ffffff;
    }
    .provenance-card {
      border: 1px solid #cbd5e1;
      border-radius: 0.75rem;
      padding: 1rem;
      background: #ffffff;
      margin-top: 0.8rem;
    }
    .provenance-card.stale-border {
      border-color: #f59e0b;
      box-shadow: 0 0 0 2px rgba(245, 158, 11, 0.2);
    }
    .provenance-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 0.75rem;
      border-bottom: 1px solid #f1f5f9;
      padding-bottom: 0.5rem;
    }
    .provenance-title {
      font-size: 1.05rem;
      font-weight: 700;
      color: #1e293b;
    }
    .provenance-groups {
      display: grid;
      gap: 0.65rem;
      margin-top: 0.65rem;
    }
    .provenance-group-item {
      padding: 0.6rem 0.75rem;
      border: 1px solid #e2e8f0;
      border-radius: 0.5rem;
      background: #f8fafc;
    }
    .provenance-group-item.stale {
      border-color: #f59e0b;
      background: #fffbeb;
    }
    .group-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-weight: 600;
      font-size: 0.88rem;
      color: #334155;
    }
    .group-status {
      font-size: 0.72rem;
      padding: 0.1rem 0.45rem;
      border-radius: 999px;
      font-weight: 600;
    }
    .group-status.included { background: #dcfce7; color: #15803d; }
    .group-status.not_applicable { background: #f1f5f9; color: #64748b; }
    .group-status.legacy_unavailable { background: #fee2e2; color: #b91c1c; }
    .group-body {
      margin-top: 0.35rem;
      font-size: 0.82rem;
      color: #475569;
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
      border: 1px solid #cbd5e1;
    }
    .human-ack-box {
      margin-top: 0.85rem;
      padding: 0.75rem;
      background: #f0fdf4;
      border: 1px solid #bbf7d0;
      border-radius: 0.5rem;
      font-size: 0.85rem;
      color: #166534;
      line-height: 1.45;
    }
    .provenance-stale-diff {
      margin-top: 0.75rem;
      padding: 0.75rem;
      background: #fffbeb;
      border: 1px solid #fde68a;
      border-radius: 0.5rem;
    }
    .stale-diff-title {
      font-weight: 700;
      color: #92400e;
      font-size: 0.9rem;
      margin-bottom: 0.4rem;
    }
    .stale-diff-item {
      padding: 0.35rem 0;
      border-top: 1px solid #fef3c7;
      font-size: 0.82rem;
      color: #78350f;
    }
    .both-blocker-info {
      margin-top: 0.5rem;
      padding: 0.65rem 0.8rem;
      background: #fef2f2;
      border: 1px solid #fecaca;
      border-radius: 0.5rem;
      color: #991b1b;
      font-size: 0.85rem;
    }
    .copy-chip {
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      padding: 0.1rem 0.4rem;
      background: #e2e8f0;
      border-radius: 0.25rem;
      font-size: 0.75rem;
      font-family: ui-monospace, monospace;
      color: #1e293b;
      border: none;
    }
    .copy-chip:hover {
      background: #cbd5e1;
    }
    .diagnostic-group-card {
      border: 1px solid #d5dee7;
      border-radius: 0.65rem;
      padding: 0.85rem;
      margin-bottom: 0.85rem;
      background: #fff;
    }
    .diagnostic-group-card.severity-error {
      border-color: #fca5a5;
      background: #fffafa;
    }
    .diagnostic-group-card.severity-warning {
      border-color: #fde68a;
      background: #fffdf7;
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
      color: #1e293b;
      flex: 1;
    }
    .diagnostic-object-list {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    .diagnostic-object-row {
      border: 1px solid #e2e8f0;
      border-radius: 0.4rem;
      padding: 0.5rem 0.75rem;
      background: #fff;
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
      color: #0f172a;
    }
    .diagnostic-code-badge {
      font-size: 0.75rem;
      padding: 0.1rem 0.4rem;
      background: #e0f2fe;
      color: #0369a1;
      border-radius: 0.25rem;
      font-weight: 600;
    }
    .diagnostic-msg {
      font-size: 0.85rem;
      color: #334155;
      flex: 1;
    }
    .secondary-diagnostics {
      margin-top: 0.4rem;
      font-size: 0.82rem;
      color: #64748b;
      padding: 0.25rem 0.5rem;
      background: #f8fafc;
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
      background: #fef3c7;
      border: 1px solid #f59e0b;
      border-radius: 0.4rem;
      font-weight: 600;
      color: #92400e;
      margin-bottom: 0.85rem;
    }
    .creative-info-section {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
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
      color: #334155;
    }
    .consequences-list {
      margin: 0.25rem 0 0 1.25rem;
      padding: 0;
      font-size: 0.82rem;
      color: #475569;
    }
    .creative-form {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }
    .research-lineages-section {
      margin-top: 1.25rem;
      padding-top: 0.85rem;
      border-top: 1px solid #e2e8f0;
    }
    .lineages-title {
      margin: 0 0 0.75rem 0;
      font-size: 1rem;
      color: #1e293b;
    }
    .lineage-card {
      border: 1px solid #cbd5e1;
      border-radius: 0.6rem;
      padding: 0.75rem;
      margin-bottom: 0.85rem;
      background: #fff;
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
    .scope-character { background: #e0e7ff; color: #3730a3; }
    .scope-world { background: #ede9fe; color: #5b21b6; }
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
      background: #f8fafc;
      border-radius: 0.4rem;
    }
    .lineage-node-card {
      border: 1px solid #cbd5e1;
      border-radius: 0.4rem;
      padding: 0.4rem 0.6rem;
      background: #fff;
      min-width: 140px;
      display: flex;
      flex-direction: column;
      gap: 0.3rem;
    }
    .node-in-flight {
      border-color: #86efac;
      box-shadow: 0 0 4px rgba(34, 197, 94, 0.2);
    }
    .node-terminal {
      border-color: #cbd5e1;
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
      color: #94a3b8;
      font-weight: bold;
    }
    .flight-tag {
      font-size: 0.7rem;
      padding: 0.05rem 0.35rem;
      border-radius: 0.2rem;
      font-weight: 600;
    }
    .flight-active { background: #dcfce7; color: #166534; }
    .flight-terminal { background: #f1f5f9; color: #64748b; }
    .origin-badge {
      font-size: 0.7rem;
      padding: 0.05rem 0.35rem;
      border-radius: 0.2rem;
      font-weight: 600;
    }
    .origin-newly_created { background: #dbeafe; color: #1e40af; }
    .origin-reused_existing { background: #fef3c7; color: #92400e; }
    .origin-successor_recovery { background: #fae8ff; color: #86198f; }
    .origin-legacy_unknown { background: #f1f5f9; color: #475569; }
    .recovery-action-tag {
      font-size: 0.72rem;
      padding: 0.05rem 0.35rem;
      background: #fee2e2;
      color: #991b1b;
      border-radius: 0.2rem;
    }
    .task-link-btn {
      background: none;
      border: none;
      padding: 0;
      color: #2563eb;
      text-decoration: underline;
      cursor: pointer;
      font-size: 0.82rem;
      font-weight: 600;
    }
    .action-link-small {
      background: none;
      border: none;
      padding: 0;
      color: #4b5563;
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
      border-top: 1px solid #e2e8f0;
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
      background: #f1f5f9;
      border-radius: 0.3rem;
      font-size: 0.82rem;
    }
    .external-change-notice {
      border: 1px solid #b45309;
      background: #fffbeb;
      color: #78350f;
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
      border: 1px solid #d1d5db;
      border-radius: 0.4rem;
      padding: 0.5rem 0.7rem;
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
    }
    .interview-history-entry.current { border-left: 4px solid #15803d; }
    .interview-history-entry.superseded { border-left: 4px solid #9ca3af; opacity: 0.8; }
    .interview-history-entry.amendment { border-left: 4px solid #2563eb; }
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
      color: #fff;
      background: #9ca3af;
    }
    .history-tag.current { background: #15803d; }
    .history-tag.superseded { background: #6b7280; }
    .history-tag.amendment { background: #2563eb; }
    .interview-history-answer {
      white-space: pre-wrap;
      font-size: 0.9rem;
    }
    .amend-area {
      border: 1px dashed #2563eb;
      border-radius: 0.4rem;
      padding: 0.7rem;
      margin-top: 0.6rem;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    .amend-impact {
      border-radius: 0.4rem;
      background: #eff6ff;
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
      color: #b45309;
      font-size: 0.85rem;
    }
    .modal-overlay, .dialog-overlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(15, 23, 42, 0.65);
      z-index: 9999;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1.25rem;
      box-sizing: border-box;
    }
    .modal-dialog, .dialog-modal {
      background: #ffffff;
      border-radius: 0.75rem;
      max-width: min(560px, 95vw);
      width: 100%;
      max-height: 90vh;
      overflow-y: auto;
      padding: 1.5rem;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.2), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
      font-family: inherit;
      outline: none;
      box-sizing: border-box;
    }
    .modal-title, .dialog-modal h3 {
      margin: 0 0 1rem 0;
      font-size: 1.25rem;
      font-weight: 700;
      color: #1e293b;
    }
    .dialog-actions, .modal-actions {
      display: flex;
      justify-content: flex-end;
      gap: 0.75rem;
      margin-top: 1.5rem;
      flex-wrap: wrap;
    }
    .creative-warning-box {
      background: #fffbeb;
      border: 1px solid #fde68a;
      border-left: 4px solid #f59e0b;
      color: #92400e;
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
      background: #f8fafc;
      padding: 0.8rem 1rem;
      border-radius: 0.5rem;
      border: 1px solid #e2e8f0;
    }
    .dialog-input, .dialog-textarea {
      width: 100%;
      box-sizing: border-box;
      margin-top: 0.35rem;
    }
    .dialog-error {
      color: #dc2626;
      font-weight: 600;
      font-size: 0.88rem;
      margin-top: 0.5rem;
    }
    .image-thumb, .image-card-thumb {
      width: 4.5rem;
      height: 4.5rem;
      object-fit: cover;
      border-radius: 0.4rem;
      border: 1px solid #cbd5e1;
      background: #f8fafc;
      flex-shrink: 0;
    }
    .image-card {
      border: 1px solid #e2e8f0;
      border-radius: 0.55rem;
      padding: 0.75rem;
      background: #ffffff;
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
      background: #f1f5f9;
      border-radius: 0.4rem;
      color: #94a3b8;
      font-size: 0.75rem;
      border: 1px dashed #cbd5e1;
    }
    #image-crop-preview canvas {
      max-width: 100%;
      height: auto;
      border-radius: 0.4rem;
      border: 1px solid #cbd5e1;
      background: #fff;
    }
    .publish-completion-card {
      background: #f0fdf4;
      border: 1px solid #bbf7d0;
      border-radius: 0.75rem;
      padding: 1.25rem;
      margin-top: 1rem;
    }
    .publish-completion-card .completion-title {
      color: #166534;
      font-size: 1.15rem;
      font-weight: 700;
      margin-top: 0;
      margin-bottom: 0.5rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .publish-completion-card .completion-summary {
      color: #15803d;
      font-size: 0.92rem;
      line-height: 1.6;
      margin-bottom: 1rem;
    }
    .publish-completion-card .download-guide {
      background: #ffffff;
      border: 1px solid #dcfce7;
      border-radius: 0.5rem;
      padding: 0.75rem 1rem;
      font-size: 0.88rem;
      color: #1e293b;
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
