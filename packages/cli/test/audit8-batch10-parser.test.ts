import { describe, expect, it } from "vitest";
import { CliUsageError, EXIT_DOMAIN, EXIT_FATAL, EXIT_OK, EXIT_USAGE, parseArgv, suggestCommand } from "../src/parser.js";
import { formatHelp } from "../src/usage.js";

function expectUsageError(argv: readonly string[], fragment: string): void {
  expect(() => parseArgv(argv)).toThrowError(CliUsageError);
  try {
    parseArgv(argv);
  } catch (error) {
    expect((error as Error).message).toContain(fragment);
  }
}

describe("CLI parser", () => {
  it("parses no arguments as the status command", () => {
    expect(parseArgv([])).toEqual({ kind: "status" });
    expect(parseArgv([""])).toEqual({ kind: "status" });
  });

  it("parses global help flags", () => {
    expect(parseArgv(["--help"])).toEqual({ kind: "help" });
    expect(parseArgv(["-h"])).toEqual({ kind: "help" });
    expect(parseArgv(["help"])).toEqual({ kind: "help" });
    expect(parseArgv(["help", "-h"])).toEqual({ kind: "help" });
  });

  it("parses help with an explicit topic", () => {
    expect(parseArgv(["help", "serve"])).toEqual({ kind: "help", topic: "serve" });
    expect(parseArgv(["help", "request"])).toEqual({ kind: "help", topic: "request" });
  });

  it("parses per-command --help for every command", () => {
    const commands = ["serve", "agents", "status", "repair-export", "import-legacy", "request"];
    for (const command of commands) {
      expect(parseArgv([command, "--help"])).toEqual({ kind: "help", topic: command });
      expect(parseArgv([command, "-h"])).toEqual({ kind: "help", topic: command });
      expect(parseArgv(["help", command])).toEqual({ kind: "help", topic: command });
    }
  });

  it("rejects unknown help topics with a suggestion", () => {
    expectUsageError(["help", "serv"], 'Unknown help topic "serv"');
    expectUsageError(["help", "nope"], "Unknown help topic");
  });

  it("rejects extra arguments after a help topic", () => {
    expectUsageError(["help", "serve", "extra"], "at most one command name");
  });

  it("parses all valid commands", () => {
    expect(parseArgv(["serve"])).toEqual({ kind: "serve" });
    expect(parseArgv(["agents"])).toEqual({ kind: "agents" });
    expect(parseArgv(["status"])).toEqual({ kind: "status" });
    expect(parseArgv(["repair-export", "a.json"])).toEqual({ kind: "repair-export", inputPath: "a.json" });
    expect(parseArgv(["repair-export", "a.json", "b.json"])).toEqual({ kind: "repair-export", inputPath: "a.json", outputPath: "b.json" });
    expect(parseArgv(["import-legacy", "legacy/dir"])).toEqual({ kind: "import-legacy", legacyRoot: "legacy/dir" });
    expect(parseArgv(["request", "建立一個角色卡"])).toEqual({ kind: "request", text: "建立一個角色卡", attachments: [] });
  });

  it("rejects commands that take no arguments or unknown options", () => {
    expectUsageError(["serve", "extra"], "takes no arguments");
    expectUsageError(["status", "--port", "9000"], 'Unknown option "--port"');
    expectUsageError(["agents", "-x"], "Unknown option");
  });

  it("rejects repair-export with missing or extra paths", () => {
    expectUsageError(["repair-export"], "requires a bundle JSON path");
    expectUsageError(["repair-export", "a.json", "b.json", "c.json"], "at most two paths");
    expectUsageError(["repair-export", "a.json", "--flag"], "Unknown option");
  });

  it("rejects import-legacy with missing or extra paths", () => {
    expectUsageError(["import-legacy"], "requires a legacy project path");
    expectUsageError(["import-legacy", "a", "b"], "exactly one path");
  });

  it("suggests the closest valid command for a mistyped command", () => {
    expectUsageError(["statsu"], 'Unknown command "statsu"');
    try {
      parseArgv(["statsu"]);
    } catch (error) {
      expect((error as Error).message).toContain('Did you mean "status"?');
    }
    expectUsageError(["serv", "extra"], 'Did you mean "serve"?');
  });

  it("treats a non-command first token as natural-language request text", () => {
    expect(parseArgv(["建立一個角色卡"])).toEqual({ kind: "request", text: "建立一個角色卡", attachments: [] });
    expect(parseArgv(["建立一個角色卡", "與", "設定"])).toEqual({ kind: "request", text: "建立一個角色卡 與 設定", attachments: [] });
  });

  it("preserves Unicode request text exactly", () => {
    const text = "建立「雪乃」的角色卡，需要冷靜系、外冷內熱，但重視界線。";
    expect(parseArgv(["request", text]).kind).toBe("request");
    if (parseArgv(["request", text]).kind === "request") {
      expect((parseArgv(["request", text]) as { text: string }).text).toBe(text);
    }
  });

  it("preserves argv elements with leading/trailing whitespace when joined", () => {
    const result = parseArgv(["request", "a", " b ", "c"]);
    expect(result).toEqual({ kind: "request", text: "a  b  c", attachments: [] });
  });

  it("keeps Windows attachment paths intact", () => {
    const path = "C:\\Users\\測試\\My File.txt";
    const result = parseArgv(["request", "--attach", path, "hi"]);
    expect(result).toEqual({ kind: "request", text: "hi", attachments: [path] });
  });

  it("treats everything after -- as request text even if it looks like an option", () => {
    expect(parseArgv(["request", "--", "--attach", "x.txt"])).toEqual({ kind: "request", text: "--attach x.txt", attachments: [] });
    expect(parseArgv(["request", "hello", "--", "--attach", "x.txt"])).toEqual({
      kind: "request",
      text: "hello -- --attach x.txt",
      attachments: [],
    });
  });

  it("accepts --attach in documented positions with order preserved", () => {
    expect(parseArgv(["request", "--attach", "a.txt", "text"])).toEqual({ kind: "request", text: "text", attachments: ["a.txt"] });
    expect(parseArgv(["--attach", "a.txt", "text"])).toEqual({ kind: "request", text: "text", attachments: ["a.txt"] });
    expect(parseArgv(["request", "--attach", "a.txt", "--attach", "b.txt", "--attach", "c.txt", "text"])).toEqual({
      kind: "request",
      text: "text",
      attachments: ["a.txt", "b.txt", "c.txt"],
    });
  });

  it("stops option parsing at the first non-option token so request text is never truncated", () => {
    const result = parseArgv(["request", "建立", "--attach", "a.txt", "角色卡"]);
    expect(result).toEqual({ kind: "request", text: "建立 --attach a.txt 角色卡", attachments: [] });
  });

  it("rejects a missing --attach value", () => {
    expectUsageError(["request", "--attach"], "Missing value for --attach");
    expectUsageError(["--attach"], "Missing value for --attach");
    expectUsageError(["request", "--attach", "--", "text"], "Missing value for --attach");
  });

  it("rejects empty request text", () => {
    expectUsageError(["request"], "Request text is empty");
    expectUsageError(["request", "--"], "Request text is empty");
    expectUsageError(["request", "   "], "Request text is empty");
    expectUsageError(["--attach", "a.txt"], "Request text is empty");
  });

  it("rejects unknown options in requests", () => {
    expectUsageError(["request", "--port", "9000", "text"], 'Unknown option "--port"');
    expectUsageError(["--port", "9000"], 'Unknown option "--port"');
  });

  it("does not validate attachment existence in the parser (no filesystem access)", () => {
    expect(parseArgv(["request", "--attach", "no-such-file-anywhere.txt", "text"])).toEqual({
      kind: "request",
      text: "text",
      attachments: ["no-such-file-anywhere.txt"],
    });
  });

  it("parses request --help as help", () => {
    expect(parseArgv(["request", "--help"])).toEqual({ kind: "help", topic: "request" });
    expect(parseArgv(["request", "--attach", "a.txt", "-h"])).toEqual({ kind: "help", topic: "request" });
  });

  it("exposes stable exit code constants", () => {
    expect(EXIT_OK).toBe(0);
    expect(EXIT_DOMAIN).toBe(1);
    expect(EXIT_USAGE).toBe(2);
    expect(EXIT_FATAL).toBe(70);
  });
});

describe("CLI command suggestion", () => {
  it("suggests commands within edit distance 2", () => {
    expect(suggestCommand("statsu")).toContain("status");
    expect(suggestCommand("serv")).toContain("serve");
    expect(suggestCommand("repair-export")).toContain("repair-export");
    expect(suggestCommand("import")).toContain("import-legacy");
  });

  it("suggests by prefix for longer tokens", () => {
    expect(suggestCommand("repair-")).toContain("repair-export");
    expect(suggestCommand("import-le")).toContain("import-legacy");
  });

  it("returns no suggestion for unrelated tokens", () => {
    expect(suggestCommand("xyzzy")).toEqual([]);
    expect(suggestCommand("--attach")).toEqual([]);
    expect(suggestCommand("")).toEqual([]);
  });
});

describe("CLI help text", () => {
  it("documents all commands, request mode, options, examples and exit codes", () => {
    const help = formatHelp();
    for (const fragment of ["Usage:", "serve", "agents", "status", "repair-export", "import-legacy", "request", "help",
      "--attach", "ST_WORKSPACE_PROJECT_ROOT", "ST_WORKSPACE_PROJECT", "ST_WORKSPACE_PORT",
      "Exit codes:", "0", "1", "2", "70", "request --", "statsu"]) {
      expect(help).toContain(fragment);
    }
  });

  it("provides per-command help with command-specific guidance", () => {
    const repairHelp = formatHelp("repair-export");
    expect(repairHelp).toContain(".json");
    expect(repairHelp).toContain("bundle-backup");
    expect(repairHelp).toContain("temporary");
    const requestHelp = formatHelp("request");
    expect(requestHelp).toContain("--attach");
    expect(requestHelp).toContain("--");
    expect(requestHelp).toContain("exit code 2");
    const serveHelp = formatHelp("serve");
    expect(serveHelp).toContain("ST_WORKSPACE_PORT");
    expect(formatHelp("help")).toContain("help [<command>]");
    expect(formatHelp("agents")).toContain("agents");
    expect(formatHelp("status")).toContain("status");
    expect(formatHelp("import-legacy")).toContain("legacy-project-path");
  });

  it("returns help as a plain string without any I/O side effects", () => {
    const help = formatHelp();
    expect(typeof help).toBe("string");
    expect(help.length).toBeGreaterThan(100);
    expect(help).not.toContain("[object Object]");
  });
});
