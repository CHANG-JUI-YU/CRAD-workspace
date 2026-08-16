export const EXIT_OK = 0;
export const EXIT_DOMAIN = 1;
export const EXIT_USAGE = 2;
export const EXIT_FATAL = 70;

export const CLI_PROGRAM = "st-workspace";

export const COMMANDS = ["serve", "agents", "status", "repair-export", "import-legacy", "request", "help"] as const;
export type CliCommand = (typeof COMMANDS)[number];

export class CliUsageError extends Error {
  readonly exitCode = EXIT_USAGE;
  constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

export class CliDomainError extends Error {
  readonly exitCode = EXIT_DOMAIN;
  constructor(message: string) {
    super(message);
    this.name = "CliDomainError";
  }
}

export type ParsedInvocation =
  | { kind: "help"; topic?: CliCommand }
  | { kind: "serve" }
  | { kind: "agents" }
  | { kind: "status" }
  | { kind: "repair-export"; inputPath: string; outputPath?: string }
  | { kind: "import-legacy"; legacyRoot: string }
  | { kind: "request"; text: string; attachments: string[] };

const HELP_FLAGS = new Set(["-h", "--help"]);

function isCommand(token: string): token is CliCommand {
  return (COMMANDS as readonly string[]).includes(token);
}

export function parseArgv(argv: readonly string[]): ParsedInvocation {
  const first = argv[0];
  if (first === undefined || first === "") return { kind: "status" };
  if (HELP_FLAGS.has(first)) return { kind: "help" };
  if (first === "help") {
    const topic = argv[1];
    if (argv.length > 2) {
      throw new CliUsageError(`help accepts at most one command name; got extra arguments: ${argv.slice(2).join(" ")}`);
    }
    if (topic === undefined || HELP_FLAGS.has(topic)) return { kind: "help" };
    if (!isCommand(topic)) {
      throw new CliUsageError(`Unknown help topic "${topic}".${suggestionSentence(topic)}Run "${CLI_PROGRAM} help" for available commands.`);
    }
    return { kind: "help", topic };
  }
  if (isCommand(first)) {
    const rest = argv.slice(1);
    if (rest.some((token) => HELP_FLAGS.has(token))) return { kind: "help", topic: first };
    switch (first) {
      case "serve":
      case "agents":
      case "status":
        rejectArguments(rest, first);
        return { kind: first };
      case "repair-export": {
        const positionals = positionalArgs(rest, first);
        if (positionals.length === 0) {
          throw new CliUsageError(`repair-export requires a bundle JSON path.\nUsage: ${CLI_PROGRAM} repair-export <bundle.json> [<output.json>]`);
        }
        if (positionals.length > 2) {
          throw new CliUsageError(`repair-export accepts at most two paths; got extra argument "${positionals[2]}".`);
        }
        const outputPath = positionals[1];
        return outputPath === undefined
          ? { kind: "repair-export", inputPath: positionals[0]! }
          : { kind: "repair-export", inputPath: positionals[0]!, outputPath };
      }
      case "import-legacy": {
        const positionals = positionalArgs(rest, first);
        if (positionals.length === 0) {
          throw new CliUsageError(`import-legacy requires a legacy project path.\nUsage: ${CLI_PROGRAM} import-legacy <legacy-project-path>`);
        }
        if (positionals.length > 1) {
          throw new CliUsageError(`import-legacy accepts exactly one path; got extra argument "${positionals[1]}".`);
        }
        return { kind: "import-legacy", legacyRoot: positionals[0]! };
      }
      case "request":
        return parseRequest(rest);
      case "help":
        throw new CliUsageError(`Unexpected arguments for help: ${rest.join(" ")}`);
    }
  }
  const suggestions = suggestCommand(first);
  if (suggestions.length > 0) {
    throw new CliUsageError(
      `Unknown command "${first}".${suggestionSentence(first)}\nRun "${CLI_PROGRAM} help" for usage, or prefix the token with "--" to send it as request text: ${CLI_PROGRAM} request -- "${first} ..."`,
    );
  }
  return parseRequest(argv);
}

function rejectArguments(tokens: readonly string[], command: string): void {
  if (tokens.length === 0) return;
  const token = tokens[0]!;
  if (token.startsWith("-")) {
    throw new CliUsageError(`Unknown option "${token}" for ${command}. Run "${CLI_PROGRAM} ${command} --help" for usage.`);
  }
  throw new CliUsageError(`Unexpected argument "${token}" for ${command}; it takes no arguments. Run "${CLI_PROGRAM} ${command} --help" for usage.`);
}

function positionalArgs(tokens: readonly string[], command: string): string[] {
  const positionals: string[] = [];
  for (const token of tokens) {
    if (token.startsWith("-")) {
      throw new CliUsageError(`Unknown option "${token}" for ${command}. Run "${CLI_PROGRAM} ${command} --help" for usage.`);
    }
    positionals.push(token);
  }
  return positionals;
}

function parseRequest(tokens: readonly string[]): ParsedInvocation {
  const attachments: string[] = [];
  let index = 0;
  for (; index < tokens.length; index++) {
    const token = tokens[index]!;
    if (token === "--") {
      index += 1;
      break;
    }
    if (HELP_FLAGS.has(token)) return { kind: "help", topic: "request" };
    if (token === "--attach") {
      const value = tokens[index + 1];
      if (value === undefined || value === "--") {
        throw new CliUsageError(`Missing value for --attach.\nUsage: ${CLI_PROGRAM} request [--attach <path>]... [--] <request text>`);
      }
      attachments.push(value);
      index += 1;
      continue;
    }
    if (token.startsWith("-")) {
      throw new CliUsageError(
        `Unknown option "${token}" in request. Option-like text belongs after "--": ${CLI_PROGRAM} request -- "${token} ..."`,
      );
    }
    break;
  }
  const text = tokens.slice(index).join(" ").trim();
  if (text.length === 0) {
    throw new CliUsageError(`Request text is empty.\nUsage: ${CLI_PROGRAM} request [--attach <path>]... [--] <request text>`);
  }
  return { kind: "request", text, attachments };
}

export function suggestCommand(token: string): string[] {
  if (token.length === 0) return [];
  const lower = token.toLowerCase();
  const suggestions = new Set<string>();
  for (const command of COMMANDS) {
    if (command === "help") continue;
    const commandLower = command.toLowerCase();
    if (levenshtein(lower, commandLower) <= 2) suggestions.add(command);
    if (token.length >= 3 && (commandLower.startsWith(lower) || lower.startsWith(commandLower))) suggestions.add(command);
  }
  return [...suggestions];
}

function suggestionSentence(token: string): string {
  const suggestions = suggestCommand(token);
  if (suggestions.length === 0) return "";
  return ` Did you mean ${suggestions.map((command) => `"${command}"`).join(" or ")}?`;
}

function levenshtein(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    current[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(current[j - 1]! + 1, previous[j]! + 1, previous[j - 1]! + cost);
    }
    for (let j = 0; j <= b.length; j++) previous[j] = current[j]!;
  }
  return previous[b.length]!;
}
