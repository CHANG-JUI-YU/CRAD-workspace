import { DASHBOARD_SHELL } from "./dashboard-shell.js";
import { DASHBOARD_CSS } from "./dashboard-css.js";
import { DASHBOARD_MARKUP } from "./dashboard-markup.js";
import {
  DASHBOARD_NAVIGATION_REGISTRY_JS,
  prepareDashboardMarkup,
} from "./dashboard-navigation-registry.js";
import { DASHBOARD_STATE_JS } from "./dashboard-state.js";
import { DASHBOARD_DRAFT_STORE_JS } from "./dashboard-draft-store.js";
import { DASHBOARD_URL_JS } from "./dashboard-url.js";
import { DASHBOARD_PANELS_PROJECT_SELECTOR_UX_JS } from "./dashboard-project-selector-ux.js";
import { DASHBOARD_ACTIONS_JS } from "./dashboard-actions.js";
import {
  DASHBOARD_PANELS_MEDIA_PROJECT_SAFE_JS,
  DASHBOARD_PROJECT_CONTEXT_JS,
} from "./dashboard-project-context.js";
import { DASHBOARD_API_SESSION_SAFE_JS } from "./dashboard-session-client.js";
import {
  DASHBOARD_PANELS_PUBLISH_ROW_SAFE_JS,
  DASHBOARD_PANELS_REVIEW_ROW_SAFE_JS,
} from "./dashboard-row-scope.js";
import { DASHBOARD_PANELS_COVERAGE_JS } from "./dashboard-panels-coverage.js";
import { DASHBOARD_PANELS_WORKFLOW_JS } from "./dashboard-panels-workflow.js";
import { DASHBOARD_PANELS_COLLECTIONS_JS } from "./dashboard-panels-collections.js";
import { DASHBOARD_NAV_JS } from "./dashboard-nav.js";
import { DASHBOARD_LISTENERS_JS } from "./dashboard-listeners.js";

const DASHBOARD_FOOTER = `    }());
  </script>
</body>
</html>
`;

export interface DashboardRenderOptions {
  authenticationRequired?: boolean;
}

function dashboardAuthenticationConfig(authenticationRequired: boolean): string {
  return `      var dashboardAuthenticationEnabled = ${authenticationRequired ? "true" : "false"};\n`;
}

export function dashboard(options: DashboardRenderOptions = {}): string {
  return (
    DASHBOARD_SHELL
    + DASHBOARD_CSS
    + prepareDashboardMarkup(DASHBOARD_MARKUP)
    + dashboardAuthenticationConfig(options.authenticationRequired === true)
    + DASHBOARD_STATE_JS
    + DASHBOARD_DRAFT_STORE_JS
    + DASHBOARD_URL_JS
    + DASHBOARD_PANELS_PROJECT_SELECTOR_UX_JS
    + DASHBOARD_API_SESSION_SAFE_JS
    + DASHBOARD_ACTIONS_JS
    + DASHBOARD_PANELS_PUBLISH_ROW_SAFE_JS
    + DASHBOARD_PANELS_REVIEW_ROW_SAFE_JS
    + DASHBOARD_PANELS_COVERAGE_JS
    + DASHBOARD_NAVIGATION_REGISTRY_JS
    + DASHBOARD_PANELS_WORKFLOW_JS
    + DASHBOARD_PANELS_COLLECTIONS_JS
    + DASHBOARD_PANELS_MEDIA_PROJECT_SAFE_JS
    + DASHBOARD_PROJECT_CONTEXT_JS
    + DASHBOARD_NAV_JS
    + DASHBOARD_LISTENERS_JS
    + DASHBOARD_FOOTER
  );
}
