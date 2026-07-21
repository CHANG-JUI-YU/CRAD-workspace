import * as ts from "typescript";

import { safeJsString } from "../../canonical.js";

export function emitTypeScriptStringLiteral(value: string): string {
  const sourceFile = ts.createSourceFile("literal.ts", "", ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  const node = ts.factory.createStringLiteral(value);
  const printed = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed }).printNode(
    ts.EmitHint.Unspecified,
    node,
    sourceFile,
  );
  validateGeneratedTypeScript(`const literal = ${printed};`);
  return safeJsString(value);
}

export function validateGeneratedTypeScript(source: string): string {
  const file = ts.createSourceFile(
    "generated-mvu.ts",
    source,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.TS,
  );
  const parseDiagnostics = (file as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? [];
  if (parseDiagnostics.length > 0) {
    const message = parseDiagnostics
      .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))
      .join("; ");
    throw new Error(`生成的 MVU TypeScript 無法重新解析: ${message}`);
  }
  return source;
}
