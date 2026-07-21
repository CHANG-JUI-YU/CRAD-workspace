import type { HtmlSource, PluginContributions } from "@card-workspace/schemas";

import type { RenderedHtmlComponent } from "./generate-markup.js";

function pair(
  component: HtmlSource["components"][number],
  rendered: RenderedHtmlComponent,
): PluginContributions["regex_scripts"] {
  const marker = component.feature === "status_bar"
    ? "<StatusPlaceHolderImpl\\s*/>"
    : "<!--card-workspace-message-->";
  const label = `Card Workspace HTML ${component.id}`;
  return [
    {
      scriptName: `${label} display`,
      findRegex: marker,
      replaceString: rendered.markup,
      trimStrings: [],
      placement: [1],
      disabled: false,
      markdownOnly: true,
      promptOnly: false,
      runOnEdit: true,
      substituteRegex: false,
    },
    {
      scriptName: `${label} prompt hide`,
      findRegex: marker,
      replaceString: "",
      trimStrings: [],
      placement: [2],
      disabled: false,
      markdownOnly: false,
      promptOnly: true,
      runOnEdit: false,
      substituteRegex: false,
    },
  ];
}

export function generateHtmlRegexScripts(
  source: HtmlSource,
  rendered: readonly RenderedHtmlComponent[],
): PluginContributions["regex_scripts"] {
  const renderedById = new Map(rendered.map((component) => [component.id, component]));
  return source.components
    .filter((component) => component.feature === "status_bar" || component.feature === "message_presentation")
    .flatMap((component) => {
      const output = renderedById.get(component.id);
      if (!output) throw new Error(`HTML component render 缺失: ${component.id}`);
      return pair(component, output);
    });
}
