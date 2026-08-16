import { DASHBOARD_SHELL } from "./dashboard-shell.js";
import { DASHBOARD_CSS } from "./dashboard-css.js";
import { DASHBOARD_MARKUP } from "./dashboard-markup.js";
import { DASHBOARD_STATE_JS } from "./dashboard-state.js";
import { DASHBOARD_DRAFT_STORE_JS } from "./dashboard-draft-store.js";
import { DASHBOARD_PANELS_CORE_JS } from "./dashboard-panels-core.js";
import { DASHBOARD_API_JS } from "./dashboard-api.js";
import { DASHBOARD_ACTIONS_JS } from "./dashboard-actions.js";
import { DASHBOARD_PANELS_PUBLISH_JS } from "./dashboard-panels-publish.js";
import { DASHBOARD_PANELS_REVIEW_JS } from "./dashboard-panels-review.js";
import { DASHBOARD_PANELS_COVERAGE_JS } from "./dashboard-panels-coverage.js";
import { DASHBOARD_PANELS_WORKFLOW_JS } from "./dashboard-panels-workflow.js";
import { DASHBOARD_PANELS_COLLECTIONS_JS } from "./dashboard-panels-collections.js";
import { DASHBOARD_PANELS_MEDIA_JS } from "./dashboard-panels-media.js";
import { DASHBOARD_NAV_JS } from "./dashboard-nav.js";
import { DASHBOARD_LISTENERS_JS } from "./dashboard-listeners.js";

const DASHBOARD_FOOTER = `    }());
  </script>
</body>
</html>
`;

export function dashboard(): string {
  return (
    DASHBOARD_SHELL
    + DASHBOARD_CSS
    + DASHBOARD_MARKUP
    + DASHBOARD_STATE_JS
    + DASHBOARD_DRAFT_STORE_JS
    + DASHBOARD_PANELS_CORE_JS
    + DASHBOARD_API_JS
    + DASHBOARD_ACTIONS_JS
    + DASHBOARD_PANELS_PUBLISH_JS
    + DASHBOARD_PANELS_REVIEW_JS
    + DASHBOARD_PANELS_COVERAGE_JS
    + DASHBOARD_PANELS_WORKFLOW_JS
    + DASHBOARD_PANELS_COLLECTIONS_JS
    + DASHBOARD_PANELS_MEDIA_JS
    + DASHBOARD_NAV_JS
    + DASHBOARD_LISTENERS_JS
    + DASHBOARD_FOOTER
  );
}
