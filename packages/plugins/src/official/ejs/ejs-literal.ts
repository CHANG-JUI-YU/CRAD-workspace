import { safeJsString, safeJsValue } from "../../canonical.js";

function assertSingleLine(value: string, context: string): void {
  if (value.includes("\n") || value.includes("\r")) {
    throw new Error(`EJS ${context} 不可包含換行`);
  }
  if (value.includes("<%") || value.includes("%>")) {
    throw new Error(`EJS ${context} 不可包含 raw delimiter`);
  }
}

export function emitEjsStringLiteral(value: string): string {
  const literal = safeJsString(value);
  assertSingleLine(literal, "string literal");
  return literal;
}

export function emitEjsJsonLiteral(value: Parameters<typeof safeJsValue>[0]): string {
  const literal = safeJsValue(value);
  assertSingleLine(literal, "JSON literal");
  return literal;
}

export function emitEjsOutputText(value: string): string {
  return `<%= ${emitEjsStringLiteral(value)} %>`;
}

export function emitEjsControl(code: string): string {
  assertSingleLine(code, "control expression");
  return `<%_ ${code} _%>`;
}

function validateTagBody(body: string, index: number, source: string): number {
  if (body.startsWith("=")) {
    if (body.slice(1).trim().length === 0) throw new Error(`EJS output tag ${index} 為空`);
    return 0;
  }
  if (!body.startsWith("_")) throw new Error(`EJS 僅允許受控 output/control tag: ${index}`);
  const code = body.slice(1).replace(/_$/u, "").trim();
  if (code.startsWith("define(")) return 0;
  if (/^if\s*\(.+\)\s*\{$/u.test(code)) return 1;
  if (/^\}\s*else(?:\s+if\s*\(.+\))?\s*\{$/u.test(code)) return 0;
  if (code === "}") return -1;
  throw new Error(`EJS control tag 含未核准語法 (${index}): ${source.slice(Math.max(0, index - 20), index + 80)}`);
}

export function reparseGeneratedEjs(source: string): string {
  let cursor = 0;
  let controlDepth = 0;
  let tagIndex = 0;
  while (true) {
    const start = source.indexOf("<%", cursor);
    if (start < 0) break;
    const end = source.indexOf("%>", start + 2);
    if (end < 0) throw new Error("生成的 EJS 有未關閉 tag");
    const body = source.slice(start + 2, end);
    if (body.includes("<%") || body.includes("%>") || body.includes("\n") || body.includes("\r")) {
      throw new Error("生成的 EJS tag 含有未編碼 delimiter 或換行");
    }
    const depthChange = validateTagBody(body, tagIndex, source);
    if (depthChange > 0) controlDepth += depthChange;
    if (depthChange < 0) {
      controlDepth += depthChange;
      if (controlDepth < 0) throw new Error("生成的 EJS control tag 關閉順序錯誤");
    }
    cursor = end + 2;
    tagIndex += 1;
  }
  if (controlDepth !== 0) throw new Error("生成的 EJS control tag 未完整閉合");
  return source;
}
