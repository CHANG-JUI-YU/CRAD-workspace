export const DASHBOARD_NAV_JS = `
function reducedMotion() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function panelAnchorId(panel) {
  if (typeof panel !== "string" || panel.length === 0) return null;
  return panel.indexOf("-panel") === -1 ? panel + "-panel" : panel;
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
var SECTION_PANEL_MAP = {
  "project": "overview", "status": "overview",
  "agents": "overview", "latest": "overview",
  "request": "define", "interview": "define", "precheck": "define",
  "source-fact": "research", "coverage": "research", "workflow": "research",
  "artifact": "create", "quality": "create",
  "readiness": "publish", "build": "publish",
  "operation": "operations", "repair": "operations", "tavern": "operations", "image": "operations"
};
function sectionOfPanel(panel) {
  return Object.prototype.hasOwnProperty.call(SECTION_PANEL_MAP, panel) ? SECTION_PANEL_MAP[panel] : undefined;
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
      }
      var key = panel.id !== undefined && panel.id !== "" ? panel.id.replace(/-panel$/u, "") : String(panel.getAttribute("aria-labelledby") || "").replace(/-heading$/u, "");
      var own = sectionOfPanel(key) === target;
      panel.hidden = !own;
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
  var own = sectionOfPanel(panel);
  var crossSection = own !== undefined && own !== activeSection;
  syncSectionForPanel(panel);
  var scrollToPanel = function () {
    var anchor = panelAnchorId(panel);
    if (anchor !== null && typeof document !== "undefined" && document.getElementById) {
      var el = document.getElementById(anchor);
      if (el !== null && el.scrollIntoView) { el.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" }); }
    }
  };
  if (crossSection && typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
    window.requestAnimationFrame(scrollToPanel);
    return;
  }
  scrollToPanel();
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
