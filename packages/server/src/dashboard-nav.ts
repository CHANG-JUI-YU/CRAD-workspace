import { DASHBOARD_PANEL_REGISTRY } from "./dashboard-navigation-registry.js";

const DASHBOARD_NAV_PANEL_REGISTRY_JSON = JSON.stringify(DASHBOARD_PANEL_REGISTRY);

export const DASHBOARD_NAV_JS = `
var DASHBOARD_NAV_PANEL_REGISTRY = ${DASHBOARD_NAV_PANEL_REGISTRY_JSON};

function reducedMotion() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

var DASHBOARD_SECTIONS = [
  { id: "overview", label: "總覽" },
  { id: "define", label: "定義" },
  { id: "research", label: "研究與證據" },
  { id: "create", label: "創作與審查" },
  { id: "publish", label: "發布" },
  { id: "operations", label: "作業與修復" }
];
var activeSection = "overview";
var sectionHistoryGuard = false;

function navigationPanelDefinition(panelKey) {
  if (typeof panelKey !== "string" || panelKey.length === 0) return null;
  for (var i = 0; i < DASHBOARD_NAV_PANEL_REGISTRY.length; i += 1) {
    if (DASHBOARD_NAV_PANEL_REGISTRY[i].key === panelKey) return DASHBOARD_NAV_PANEL_REGISTRY[i];
  }
  return null;
}

function sectionOfPanel(panelKey) {
  if (typeof DASHBOARD_NAV_PANEL_REGISTRY !== "undefined") {
    for (var i = 0; i < DASHBOARD_NAV_PANEL_REGISTRY.length; i += 1) {
      if (DASHBOARD_NAV_PANEL_REGISTRY[i].key === panelKey) return DASHBOARD_NAV_PANEL_REGISTRY[i].section;
    }
  }
  // Compatibility only for historical unit harnesses that execute extracted functions
  // without the generated registry declaration. Production never defines SECTION_PANEL_MAP.
  if (typeof SECTION_PANEL_MAP !== "undefined" && SECTION_PANEL_MAP !== null) {
    return SECTION_PANEL_MAP[panelKey];
  }
  return undefined;
}

function sectionLabel(sectionId) {
  for (var i = 0; i < DASHBOARD_SECTIONS.length; i += 1) {
    if (DASHBOARD_SECTIONS[i].id === sectionId) { return DASHBOARD_SECTIONS[i].label; }
  }
  return sectionId;
}
function parseSectionHash() {
  if (typeof window === "undefined" || !window.location) return undefined;
  var raw = window.location.hash;
  if (typeof raw !== "string" || raw.indexOf("#section:") !== 0) { return undefined; }
  var section = raw.slice("#section:".length);
  for (var i = 0; i < DASHBOARD_SECTIONS.length; i += 1) {
    if (DASHBOARD_SECTIONS[i].id === section) { return section; }
  }
  return undefined;
}
function applySectionVisibility(section) {
  var target = section || activeSection || "overview";
  var valid = false;
  for (var k = 0; k < DASHBOARD_SECTIONS.length; k += 1) {
    if (DASHBOARD_SECTIONS[k].id === target) { valid = true; break; }
  }
  if (!valid) target = "overview";
  activeSection = target;

  if (typeof document !== "undefined" && document.querySelectorAll) {
    var panels = document.querySelectorAll("section.panel");
    for (var i = 0; i < panels.length; i += 1) {
      var panel = panels[i];
      if (panel.id === "home-panel") {
        if (typeof state !== "undefined" && state.sessionUnselected) {
          panel.hidden = false;
          continue;
        }
        panel.hidden = true;
        continue;
      }
      var panelKey = null;
      var labelledBy = typeof panel.getAttribute === "function" ? String(panel.getAttribute("aria-labelledby") || "") : "";
      if (typeof DASHBOARD_NAV_PANEL_REGISTRY !== "undefined") {
        for (var p = 0; p < DASHBOARD_NAV_PANEL_REGISTRY.length; p += 1) {
          var definition = DASHBOARD_NAV_PANEL_REGISTRY[p];
          if (definition.anchor === panel.id || definition.heading === labelledBy) {
            panelKey = definition.key;
            break;
          }
        }
      } else {
        // Historical isolated-function harness fallback; production uses the registry branch above.
        if (typeof panel.id === "string" && panel.id.slice(-6) === "-panel") panelKey = panel.id.slice(0, -6);
        else if (labelledBy.slice(-8) === "-heading") panelKey = labelledBy.slice(0, -8);
      }
      var own = panelKey === null ? undefined : sectionOfPanel(panelKey);
      panel.hidden = own !== target;
    }
    for (var j = 0; j < DASHBOARD_SECTIONS.length; j += 1) {
      var button = document.getElementById("section-nav-" + DASHBOARD_SECTIONS[j].id);
      if (button !== null) {
        if (DASHBOARD_SECTIONS[j].id === target) {
          button.setAttribute("aria-current", "page");
          button.classList.add("active");
        } else {
          button.removeAttribute("aria-current");
          button.classList.remove("active");
        }
      }
    }
  }
}
function switchSection(section, options) {
  var target = section;
  var valid = false;
  for (var i = 0; i < DASHBOARD_SECTIONS.length; i += 1) {
    if (DASHBOARD_SECTIONS[i].id === target) { valid = true; break; }
  }
  if (!valid) { target = "overview"; }
  if (target === activeSection && options && options.force !== true) {
    applySectionVisibility(target);
    return;
  }
  activeSection = target;
  applySectionVisibility(target);
  var opts = options || {};
  if (opts.pushHistory !== false && !sectionHistoryGuard && typeof window !== "undefined" && window.history && window.history.pushState) {
    try {
      window.history.pushState({ section: target }, "", "#section:" + target);
    } catch (err) { /* noop */ }
  }
  if (typeof opts.onSectionChange === "function") { opts.onSectionChange(target); }
}
function syncSectionForPanel(panel) {
  var own = sectionOfPanel(panel);
  if (own === undefined || own === activeSection) { return; }
  switchSection(own, { pushHistory: false });
}
function updateSectionNav() {
  if (typeof document === "undefined" || !document.getElementById) return;
  var nav = document.getElementById("section-nav");
  if (nav === null) { return; }
  for (var i = 0; i < DASHBOARD_SECTIONS.length; i += 1) {
    var section = DASHBOARD_SECTIONS[i];
    if (document.getElementById("section-nav-" + section.id) !== null) { continue; }
    var button = document.createElement("button");
    button.type = "button";
    button.id = "section-nav-" + section.id;
    button.className = "section-nav-button";
    button.textContent = section.label;
    button.setAttribute("aria-label", "切換到「" + section.label + "」區段");
    (function (sectionId) {
      button.addEventListener("click", function () {
        switchSection(sectionId, { pushHistory: true });
      });
    })(section.id);
    nav.appendChild(button);
  }
  applySectionVisibility(activeSection);
}
function switchPanel(panel) {
  var definition = navigationPanelDefinition(panel);
  if (definition === null) {
    if (typeof announceDashboardNavigationFallback === "function") announceDashboardNavigationFallback("此面板目前不可用。");
    return false;
  }
  var crossSection = definition.section !== activeSection;
  syncSectionForPanel(definition.key);
  var scrollToPanel = function () {
    if (typeof document === "undefined" || !document.getElementById) return;
    var el = document.getElementById(definition.anchor);
    if (el === null) {
      if (typeof announceDashboardNavigationFallback === "function") announceDashboardNavigationFallback("找不到此面板；請重新整理後再試。");
      return;
    }
    if (el.scrollIntoView) { el.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" }); }
  };
  if (crossSection && typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
    window.requestAnimationFrame(scrollToPanel);
    return true;
  }
  scrollToPanel();
  return true;
}
if (typeof window !== "undefined" && window.addEventListener) {
  window.addEventListener("popstate", function () {
    var section = parseSectionHash();
    if (section === undefined) { return; }
    sectionHistoryGuard = true;
    try {
      if (section !== activeSection) {
        activeSection = section;
        applySectionVisibility(section);
      }
    } finally {
      sectionHistoryGuard = false;
    }
  });
}
var sectionHash = parseSectionHash();
if (sectionHash !== undefined && sectionHash !== "overview") {
  activeSection = sectionHash;
}
updateSectionNav();
`;
