import { CoreError } from "@st-workspace/core";
import { AgentRegistry, type AgentDefinition, type RoutedKind } from "./agent-registry.js";

export interface AgentResolution {
  readonly agent_id: string;
  readonly agent_role: AgentDefinition["role"];
  readonly kind: RoutedKind;
  readonly intent: string;
  readonly explicit: boolean;
  readonly fallback: boolean;
}

function matches(value: string, pattern: RegExp): boolean {
  return pattern.test(value);
}

function specialistFor(kind: RoutedKind, request: string, registry: AgentRegistry): AgentDefinition {
  const text = request.toLocaleLowerCase();
  const choose = (id: string): AgentDefinition => registry.get(id) ?? registry.get("director")!;
  if (kind === "source") return choose("source-researcher");
  if (kind === "import") return choose("card-import-analyst");
  if (kind === "knowledge") return matches(text, /review|審查|檢查/u) ? choose("fact-reviewer-1") : choose("fact-curator");
  if (kind === "review") {
    if (matches(text, /world|lore|世界|設定/u)) return choose("world-lore-critic");
    if (matches(text, /greeting|開場|問候/u)) return choose("greetings-critic");
    if (matches(text, /mvu/u)) return choose("mvu-critic");
    if (matches(text, /ejs/u)) return choose("ejs-critic");
    if (matches(text, /html/u)) return choose("html-critic");
    if (matches(text, /character|角色|人物/u)) return choose("character-critic");
    return choose("fact-reviewer-1");
  }
  if (kind === "authoring") {
    if (matches(text, /conversion|convert|mode-conversion|轉換/iu)) return choose("mode-conversion");
    if (matches(text, /mvu/u)) return choose("mvu-creator");
    if (matches(text, /ejs/u)) return choose("ejs-creator");
    if (matches(text, /html/u)) return choose("html-creator");
    if (matches(text, /zhuji|珠璣/u)) return choose("zhuji-creator");
    if (matches(text, /palette|調色盤/u)) return choose("palette-creator");
    if (matches(text, /wardrobe|衣櫃|衣橱|服裝清單/u)) return choose("wardrobe-creator");
    if (matches(text, /relationship|關係/u)) return choose("relationship-creator");
    if (matches(text, /greeting|開場|問候/u)) return choose("greetings-creator");
    if (matches(text, /world|lore|世界|設定/u)) return choose("world-lore-creator");
  }
  return choose("director");
}

export function classifyIntent(request: string): RoutedKind {
  if (matches(request, /source|來源|檔案|資料來源|網頁|候選|搜尋|找來源|官方|\b(?:research|search|fetch)\b/iu)) return "source";
  if (matches(request, /\b(?:build|preview|publish|release)\b|建置|預覽|發布|發佈|上線/iu)) return "build";
  if (matches(request, /\b(?:review|quality|issue|critic)\b|審查|檢查|品質|問題清單/iu)) return "review";
  if (matches(request, /\b(?:import|imported|legacy)\b|匯入|舊卡/iu)) return "import";
  if (matches(request, /\b(?:knowledge|fact|evidence|refresh)\b|知識|事實|證據|整理/iu)) return "knowledge";
  if (matches(request, /\b(?:author|character|relationship|world|lore|greeting|blueprint|zhuji|palette|wardrobe|plugin|conversion|mode-conversion)\b|角色|人物|二創|同人|原作改編|關係|世界|開場白|藍圖|珠璣|調色盤|衣櫃|衣橱|服裝清單|插件|轉換|建立產物/iu)) return "authoring";
  if (matches(request, /\bstatus\b|狀態|目前|進度|現況/iu)) return "status";
  return "unknown";
}

function kindForAgent(agent: AgentDefinition, request: string): RoutedKind {
  if (agent.role === "orchestrator") return classifyIntent(request);
  if (agent.role === "researcher") return "source";
  if (agent.role === "curator") return "knowledge";
  if (agent.role === "reviewer" || agent.role === "critic") return "review";
  if (agent.role === "importer") return "import";
  if (agent.role === "creator" || agent.role === "converter") return "authoring";
  return classifyIntent(request);
}

export class AgentRouter {
  constructor(private readonly registry = new AgentRegistry()) {}

  resolve(request: string, requestedAgent?: string): AgentResolution {
    const explicit = requestedAgent ?? request.match(/(?:^|\s)@([a-z][a-z0-9-]*)/iu)?.[1];
    if (explicit !== undefined) {
      const explicitDefinition = this.registry.resolve(explicit);
      if (explicitDefinition === undefined) {
        throw new CoreError("AGENT_UNKNOWN", `Unknown agent: ${explicit}`, true, { requested_agent: explicit });
      }
      const kind = kindForAgent(explicitDefinition, request);
      /* c8 ignore next -- AgentRegistry requires at least one intent. */
      return { agent_id: explicitDefinition.id, agent_role: explicitDefinition.role, kind, intent: explicitDefinition.intents[0] ?? "route", explicit: true, fallback: false };
    }
    const kind = classifyIntent(request);
    const selected = specialistFor(kind, request, this.registry);
    /* c8 ignore next -- AgentRegistry requires at least one intent. */
    return { agent_id: selected.id, agent_role: selected.role, kind, intent: selected.intents[0] ?? "route", explicit: false, fallback: false };
  }

  registryView(): AgentRegistry {
    return this.registry;
  }
}
