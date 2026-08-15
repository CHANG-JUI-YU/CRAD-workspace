export const DASHBOARD_PANELS_COLLECTIONS_JS = `
function collectionController() {
  return { items: [], total: 0, nextCursor: null, generation: 0, loading: false, end: false, error: null };
}

function collectionReset(controller) {
  controller.items = [];
  controller.total = 0;
  controller.nextCursor = null;
  controller.generation += 1;
  controller.loading = false;
  controller.end = false;
  controller.error = null;
}

async function collectionFetch(controller, endpoint, render, options) {
  var opts = options || {};
  var generation = ++controller.generation;
  controller.loading = true;
  try {
    var query = "";
    if (opts.filter !== undefined && opts.filter !== null && opts.filter !== "") {
      query += (query === "" ? "" : "&") + "filter=" + encodeURIComponent(JSON.stringify(opts.filter));
    }
    if (controller.nextCursor) {
      query += (query === "" ? "" : "&") + "cursor=" + encodeURIComponent(controller.nextCursor);
    }
    var payload = await requestJson(endpoint + (query === "" ? "" : "?" + query));
    if (generation !== controller.generation) return;
    var seen = new Set(controller.items.map(function (item) { return String(item.id); }));
    var fresh = payload.items.filter(function (item) { return !seen.has(String(item.id)); });
    controller.items = controller.items.concat(fresh);
    controller.total = payload.total;
    controller.nextCursor = payload.next_cursor || null;
    controller.end = !payload.next_cursor;
    controller.loading = false;
    controller.error = null;
    render(controller);
  } catch (error) {
    if (generation !== controller.generation) return;
    controller.loading = false;
    controller.error = error;
    render(controller);
  }
}

function collectionResetAndFetch(controller, endpoint, render, options) {
  collectionReset(controller);
  return collectionFetch(controller, endpoint, render, options);
}

function collectionCountText(controller) {
  if (controller.total === 0) return "";
  return "目前顯示 " + String(controller.items.length) + " / 共 " + String(controller.total) + " 筆";
}

function collectionMoreButton(controller, endpoint, render, buttonId, countId) {
  var button = byId(buttonId);
  var count = byId(countId);
  if (button === null) return;
  if (count !== null) {
    count.textContent = collectionCountText(controller);
    count.hidden = controller.total === 0;
  }
  if (controller.loading) {
    button.disabled = true;
    button.textContent = "載入中…";
    button.setAttribute("aria-busy", "true");
    return;
  }
  button.disabled = controller.end;
  button.hidden = controller.end;
  button.textContent = "載入更多";
  button.removeAttribute("aria-busy");
  if (!controller.end) {
    button.addEventListener("click", function () { void collectionFetch(controller, endpoint, render); });
  }
}
`;