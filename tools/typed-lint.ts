import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";

export type TypedLintRule = "no-floating-promises" | "no-promise-condition" | "no-fallthrough" | "no-unused";

export interface TypedLintFinding {
  readonly rule: TypedLintRule;
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly message: string;
}

export interface TypedLintReport {
  readonly files: number;
  readonly findings: readonly TypedLintFinding[];
}

export interface TypedLintIo {
  readonly out: (message: string) => void;
  readonly err: (message: string) => void;
}

const DEFAULT_CONFIG_PATH = "tsconfig.lint.json";
const UNUSED_DIAGNOSTICS = new Set([6133, 6196]);
const FALLTHROUGH_DIAGNOSTIC = 7029;

function diagnosticLocation(diagnostic: ts.Diagnostic): { file: string; line: number; column: number } | undefined {
  if (diagnostic.file === undefined || diagnostic.start === undefined) return undefined;
  const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
  return {
    file: diagnostic.file.fileName,
    line: position.line + 1,
    column: position.character + 1,
  };
}

function hasFunctionLikeAncestor(node: ts.Node): boolean {
  let current: ts.Node | undefined = node.parent;
  while (current !== undefined && !ts.isSourceFile(current)) {
    if (ts.isFunctionLike(current)) return true;
    current = current.parent;
  }
  return false;
}

function isFunctionLocalUnused(diagnostic: ts.Diagnostic): boolean {
  if (diagnostic.file === undefined || diagnostic.start === undefined) return false;
  let current: ts.Node | undefined = ts.getTokenAtPosition(diagnostic.file, diagnostic.start);
  while (current !== undefined && current !== diagnostic.file) {
    if (ts.isParameter(current)) return false;
    if (ts.isVariableDeclaration(current)) return hasFunctionLikeAncestor(current);
    current = current.parent;
  }
  return false;
}

function compilerFinding(diagnostic: ts.Diagnostic): TypedLintFinding | undefined {
  const location = diagnosticLocation(diagnostic);
  if (location === undefined) return undefined;
  const rule = diagnostic.code === FALLTHROUGH_DIAGNOSTIC
    ? "no-fallthrough"
    : UNUSED_DIAGNOSTICS.has(diagnostic.code) && isFunctionLocalUnused(diagnostic)
      ? "no-unused"
      : undefined;
  if (rule === undefined) return undefined;
  return {
    rule,
    ...location,
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
  };
}

function unwrapParentheses(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (ts.isParenthesizedExpression(current)) current = current.expression;
  return current;
}

function isHandledPromiseChain(expression: ts.Expression): boolean {
  if (!ts.isCallExpression(expression)) return false;
  const callee = unwrapParentheses(expression.expression);
  if (!ts.isPropertyAccessExpression(callee)) return false;
  if (callee.name.text === "catch") return expression.arguments.length >= 1;
  if (callee.name.text === "then") return expression.arguments.length >= 2;
  return false;
}

function isExplicitlyHandledPromise(expression: ts.Expression): boolean {
  const current = unwrapParentheses(expression);
  return (
    ts.isAwaitExpression(current) ||
    ts.isVoidExpression(current) ||
    ts.isAssignmentExpression(current, false) ||
    isHandledPromiseChain(current)
  );
}

function isPromiseLike(checker: ts.TypeChecker, expression: ts.Expression): boolean {
  const type = checker.getNonNullableType(checker.getTypeAtLocation(expression));
  const then = type.getProperty("then");
  if (then === undefined) return false;
  const declaration = then.valueDeclaration ?? then.declarations?.[0];
  if (declaration === undefined) return false;
  const thenType = checker.getTypeOfSymbolAtLocation(then, expression);
  return checker.getSignaturesOfType(thenType, ts.SignatureKind.Call).length > 0;
}

function customFinding(
  rule: Extract<TypedLintRule, "no-floating-promises" | "no-promise-condition">,
  sourceFile: ts.SourceFile,
  node: ts.Node,
  message: string,
): TypedLintFinding {
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return {
    rule,
    file: sourceFile.fileName,
    line: position.line + 1,
    column: position.character + 1,
    message,
  };
}

function inspectCondition(
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
  findings: TypedLintFinding[],
): void {
  const current = unwrapParentheses(expression);
  if (isPromiseLike(checker, current)) {
    findings.push(customFinding(
      "no-promise-condition",
      sourceFile,
      current,
      "Promise-like value used directly as a condition; await it before testing the result.",
    ));
  }
}

function inspectNode(checker: ts.TypeChecker, sourceFile: ts.SourceFile, node: ts.Node, findings: TypedLintFinding[]): void {
  if (ts.isExpressionStatement(node)) {
    const expression = unwrapParentheses(node.expression);
    if (!isExplicitlyHandledPromise(expression) && isPromiseLike(checker, expression)) {
      findings.push(customFinding(
        "no-floating-promises",
        sourceFile,
        expression,
        "Promise-like expression is ignored; await it, handle rejection, store it, or explicitly discard it with void.",
      ));
    }
  }

  if (ts.isIfStatement(node) || ts.isWhileStatement(node) || ts.isDoStatement(node)) {
    inspectCondition(checker, sourceFile, node.expression, findings);
  } else if (ts.isForStatement(node) && node.condition !== undefined) {
    inspectCondition(checker, sourceFile, node.condition, findings);
  } else if (ts.isConditionalExpression(node)) {
    inspectCondition(checker, sourceFile, node.condition, findings);
  }

  ts.forEachChild(node, (child) => inspectNode(checker, sourceFile, child, findings));
}

function diagnosticHost(): ts.FormatDiagnosticsHost {
  return {
    getCanonicalFileName: (fileName) => fileName,
    getCurrentDirectory: ts.sys.getCurrentDirectory,
    getNewLine: () => ts.sys.newLine,
  };
}

function parseProject(configPath: string): ts.ParsedCommandLine {
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error !== undefined) throw new Error(ts.formatDiagnostic(config.error, diagnosticHost()));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configPath), undefined, configPath);
  if (parsed.errors.length > 0) throw new Error(ts.formatDiagnostics(parsed.errors, diagnosticHost()));
  return parsed;
}

export function lintTypeScriptProject(configPath = DEFAULT_CONFIG_PATH): TypedLintReport {
  const resolvedConfig = path.resolve(configPath);
  const parsed = parseProject(resolvedConfig);
  const program = ts.createProgram({
    rootNames: parsed.fileNames,
    options: parsed.options,
    projectReferences: parsed.projectReferences,
  });
  const findings: TypedLintFinding[] = [];

  for (const diagnostic of program.getSemanticDiagnostics()) {
    const finding = compilerFinding(diagnostic);
    if (finding !== undefined) findings.push(finding);
  }

  const checker = program.getTypeChecker();
  const rootFiles = new Set(parsed.fileNames.map((fileName) => path.resolve(fileName)));
  const sourceFiles = program.getSourceFiles().filter(
    (sourceFile) => !sourceFile.isDeclarationFile && rootFiles.has(path.resolve(sourceFile.fileName)),
  );
  for (const sourceFile of sourceFiles) inspectNode(checker, sourceFile, sourceFile, findings);

  findings.sort(
    (left, right) =>
      left.file.localeCompare(right.file) ||
      left.line - right.line ||
      left.column - right.column ||
      left.rule.localeCompare(right.rule),
  );
  return { files: sourceFiles.length, findings };
}

function formatFinding(finding: TypedLintFinding, root: string): string {
  const relative = path.relative(root, finding.file) || finding.file;
  return `${relative}:${finding.line}:${finding.column} [${finding.rule}] ${finding.message}`;
}

export function runTypedLint(
  args: readonly string[] = process.argv.slice(2),
  io: TypedLintIo = { out: console.log, err: console.error },
): number {
  const configPath = path.resolve(args[0] ?? DEFAULT_CONFIG_PATH);
  try {
    const report = lintTypeScriptProject(configPath);
    const root = path.dirname(configPath);
    if (report.findings.length > 0) {
      for (const finding of report.findings) io.err(formatFinding(finding, root));
      io.err(`Typed lint failed with ${report.findings.length} finding(s) across ${report.files} file(s).`);
      return 1;
    }
    io.out(`Typed lint passed across ${report.files} file(s).`);
    return 0;
  } catch (error) {
    io.err(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) process.exitCode = runTypedLint();
