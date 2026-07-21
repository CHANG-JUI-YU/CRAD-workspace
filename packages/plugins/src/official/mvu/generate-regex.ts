import type { PluginContributions } from "@card-workspace/schemas";

export function generateMvuRegexScripts(): PluginContributions["regex_scripts"] {
  return [{
    scriptName: "Card Workspace MVU hide UpdateVariable",
    findRegex: "<UpdateVariable>[\\s\\S]*?<\\/UpdateVariable>",
    replaceString: "",
    trimStrings: [],
    placement: [2],
    disabled: false,
    markdownOnly: false,
    promptOnly: true,
    runOnEdit: false,
    substituteRegex: false,
    minDepth: 4,
  }];
}
