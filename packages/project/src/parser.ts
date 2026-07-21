import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

import type { Diagnostic } from "@card-workspace/schemas";
import { LineCounter, parseDocument } from "yaml";

export interface ParsedFile {
  filePath: string;
  format: "json" | "yaml";
  raw: string;
  data?: unknown;
  diagnostics: Diagnostic[];
}

export interface ScanResult {
  files: ParsedFile[];
  diagnostics: Diagnostic[];
}

const supportedExtensions = new Set([".json", ".yaml", ".yml"]);

function offsetLocation(text: string, offset: number): { line: number; column: number } {
  const before = text.slice(0, Math.max(0, offset));
  const lines = before.split(/\r?\n/u);
  return { line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 };
}

function jsonDiagnostic(filePath: string, text: string, error: unknown): Diagnostic {
  const message = error instanceof Error ? error.message : String(error);
  const match = /position\s+(\d+)/iu.exec(message);
  const location = match ? offsetLocation(text, Number(match[1])) : undefined;
  return {
    code: "JSON_PARSE_ERROR",
    severity: "error",
    message,
    evidence: [],
    fixability: "manual",
    location: { file: filePath, ...location },
  };
}

export async function parseStructuredFile(
  filePath: string,
  options: { maxBytes?: number; displayPath?: string } = {},
): Promise<ParsedFile> {
  const maxBytes = options.maxBytes ?? 10 * 1024 * 1024;
  const extension = path.extname(filePath).toLowerCase();
  const format = extension === ".json" ? "json" : "yaml";
  const displayPath = options.displayPath ?? filePath;

  if (!supportedExtensions.has(extension)) {
    return {
      filePath,
      format,
      raw: "",
      diagnostics: [
        {
          code: "FILE_EXTENSION_DENIED",
          severity: "error",
          message: `不支援的結構化檔案副檔名：${extension || "<none>"}`,
          evidence: [],
          fixability: "manual",
          location: { file: displayPath },
        },
      ],
    };
  }

  const metadata = await stat(filePath);
  if (metadata.size > maxBytes) {
    return {
      filePath,
      format,
      raw: "",
      diagnostics: [
        {
          code: "FILE_TOO_LARGE",
          severity: "error",
          message: `檔案超過 ${maxBytes} bytes 限制`,
          evidence: [],
          fixability: "manual",
          location: { file: displayPath },
        },
      ],
    };
  }

  const rawBuffer = await readFile(filePath);
  let raw: string;
  try {
    raw = new TextDecoder("utf-8", { fatal: true }).decode(rawBuffer);
  } catch {
    return {
      filePath,
      format,
      raw: "",
      diagnostics: [
        {
          code: "FILE_ENCODING_INVALID",
          severity: "error",
          message: "檔案不是有效 UTF-8",
          evidence: [],
          fixability: "manual",
          location: { file: displayPath },
        },
      ],
    };
  }
  if (format === "json") {
    try {
      return { filePath, format, raw, data: JSON.parse(raw) as unknown, diagnostics: [] };
    } catch (error) {
      return { filePath, format, raw, diagnostics: [jsonDiagnostic(displayPath, raw, error)] };
    }
  }

  const lineCounter = new LineCounter();
  const document = parseDocument(raw, {
    lineCounter,
    prettyErrors: false,
    uniqueKeys: true,
  });
  const diagnostics = document.errors.map<Diagnostic>((error) => {
    const first = error.linePos?.[0] ?? lineCounter.linePos(error.pos[0]);
    return {
      code: "YAML_PARSE_ERROR",
      severity: "error",
      message: error.message,
      evidence: [],
      fixability: "manual",
      location: {
        file: displayPath,
        ...(first ? { line: first.line, column: first.col } : {}),
      },
    };
  });

  return {
    filePath,
    format,
    raw,
    ...(diagnostics.length === 0 ? { data: document.toJS() as unknown } : {}),
    diagnostics,
  };
}

async function collectFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const paths: string[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.name === ".transactions" || entry.name === ".build" || entry.name === ".workflow") {
      continue;
    }
    const entryPath = path.join(root, entry.name);
    if (entry.isSymbolicLink()) {
      continue;
    }
    if (entry.isDirectory()) {
      paths.push(...(await collectFiles(entryPath)));
    } else if (entry.isFile() && supportedExtensions.has(path.extname(entry.name).toLowerCase())) {
      paths.push(entryPath);
    }
  }
  return paths;
}

export async function scanStructuredFiles(root: string): Promise<ScanResult> {
  const filePaths = await collectFiles(root);
  const files = await Promise.all(
    filePaths.map((filePath) =>
      parseStructuredFile(filePath, { displayPath: path.relative(root, filePath) }),
    ),
  );
  return { files, diagnostics: files.flatMap((file) => file.diagnostics) };
}
