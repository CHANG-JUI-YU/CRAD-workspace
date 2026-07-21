import { safeJsString, safeJsValue } from "../../canonical.js";
import { htmlPolicyVersion } from "./policy-v1.js";

export interface HtmlRuntimeBinding {
  readonly component_id: string;
  readonly path: string;
  readonly writable: boolean;
}

export function generateHtmlRuntimeScript(css: string, bindings: readonly HtmlRuntimeBinding[] = []): string {
  const serializedBindings = safeJsValue(bindings.map((binding) => ({ ...binding })));
  return [
    `const CARD_WORKSPACE_HTML_POLICY = ${safeJsString(htmlPolicyVersion)};`,
    `const CARD_WORKSPACE_HTML_CSS = ${safeJsString(css)};`,
    `const CARD_WORKSPACE_HTML_BINDINGS = ${serializedBindings};`,
    "export function mount(root) {",
    "  if (!(root instanceof HTMLElement)) return null;",
    "  if (!root.querySelector('style[data-card-workspace-html]')) {",
    "    const style = document.createElement('style');",
    "    style.dataset.cardWorkspaceHtml = 'true';",
    "    style.textContent = CARD_WORKSPACE_HTML_CSS;",
    "    document.head.appendChild(style);",
    "  }",
    "  return root;",
    "}",
    "export async function writeMvuBinding(host, componentId, path, value, expectedRevision) {",
    "  const binding = CARD_WORKSPACE_HTML_BINDINGS.find((candidate) => candidate.component_id === componentId && candidate.path === path);",
    "  if (!binding || !binding.writable) throw new Error('MVU binding is not writable');",
    "  if (!host || typeof host.compareAndSwapMvu !== 'function') throw new Error('MVU host CAS unavailable');",
    "  if (typeof host.readMvuSnapshot !== 'function' || typeof host.validateMvuState !== 'function') throw new Error('MVU host validation seam unavailable');",
    "  if (typeof host.validateMvuValue === 'function' && !host.validateMvuValue(path, value)) throw new Error('MVU binding value rejected');",
    "  let snapshot = await host.readMvuSnapshot();",
    "  if (!host.validateMvuState(snapshot.state)) throw new Error('MVU state validation failed');",
    "  let result = await host.compareAndSwapMvu(path, value, expectedRevision ?? snapshot.revision);",
    "  if (result && result.conflict === true) {",
    "    snapshot = await host.readMvuSnapshot();",
    "    if (!host.validateMvuState(snapshot.state)) throw new Error('MVU state validation failed');",
    "    result = await host.compareAndSwapMvu(path, value, snapshot.revision);",
    "  }",
    "  return result;",
    "}",
    "",
  ].join("\n");
}
