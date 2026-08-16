import { CLI_PROGRAM, type CliCommand } from "./parser.js";

const GLOBAL_HELP = `ST Workspace CLI
=================

Usage:
  ${CLI_PROGRAM} <command> [options]
  ${CLI_PROGRAM} <request text>               Natural-language request shorthand
  ${CLI_PROGRAM} help [<command>]
  ${CLI_PROGRAM} --help | -h

Commands:
  serve           Start the workspace HTTP server.
  agents          List the agents available to the runtime.
  status          Show the status of the selected workspace project (the default command).
  repair-export   Compile a bundle JSON into a Tavern card JSON and PNG card image.
  import-legacy   Inspect a legacy project directory and print its structure.
  request         Send a natural-language request to the workspace.
  help            Show global help, or per-command help with "help <command>".

Run "${CLI_PROGRAM} <command> --help" for details about a command.

Request mode:
  Any first argument that is not a known command is treated as natural-language
  request text. A mistyped command name (for example "statsu") is rejected with
  a suggestion instead of being sent as a request; prefix the token with "--"
  to send it as text:
    ${CLI_PROGRAM} request -- "statsu"
  Explicit form:
    ${CLI_PROGRAM} request [--attach <path>]... [--] <request text>
  Options:
    --attach <path>   Attach a file to the request. Repeatable; attachments are
                      read in the given order. The path must exist and be a
                      readable regular file, validated before any mutation.
    --                Everything after this marker is request text, even tokens
                      that look like options.

Options:
  -h, --help    Show help. Applies globally or per command
                (for example "${CLI_PROGRAM} serve --help").

Examples:
  ${CLI_PROGRAM}
  ${CLI_PROGRAM} status
  ${CLI_PROGRAM} serve
  ${CLI_PROGRAM} agents
  ${CLI_PROGRAM} request 建立一個角色卡
  ${CLI_PROGRAM} request --attach 參考資料.txt --attach 額外設定.txt 建立一個角色卡
  ${CLI_PROGRAM} request -- --attach 不是選項的範例文字
  ${CLI_PROGRAM} repair-export bundle.json
  ${CLI_PROGRAM} repair-export bundle.json exports/card.json
  ${CLI_PROGRAM} import-legacy legacy/my-card

Environment:
  ST_WORKSPACE_PROJECT_ROOT   Root directory for workspace projects (default "projects").
  ST_WORKSPACE_PROJECT        Select a specific project by name.
  ST_WORKSPACE_PORT           Port for the serve command (default 8787).

Exit codes:
  0   Success, or help was shown.
  1   Recoverable domain error (for example invalid bundle JSON).
  2   Usage or argument error (unknown command or option, missing value, missing file).
  70  Unexpected system/fatal error.
`;

const SERVE_HELP = `${CLI_PROGRAM} serve --help

Usage:
  ${CLI_PROGRAM} serve

Start the workspace HTTP server and keep it running. Takes no arguments.

The server listens on 127.0.0.1 using the port from ST_WORKSPACE_PORT
(default 8787). Projects live under ST_WORKSPACE_PROJECT_ROOT
(default "projects"); set ST_WORKSPACE_PROJECT to select a project by name.

Options:
  -h, --help  Show this help.
`;

const AGENTS_HELP = `${CLI_PROGRAM} agents --help

Usage:
  ${CLI_PROGRAM} agents

List the agents available to the runtime as JSON. Takes no arguments.

Environment: ST_WORKSPACE_PROJECT_ROOT, ST_WORKSPACE_PROJECT.

Options:
  -h, --help  Show this help.
`;

const STATUS_HELP = `${CLI_PROGRAM} status --help

Usage:
  ${CLI_PROGRAM} status

Show the status of the selected workspace project as JSON. This is the default
command when ${CLI_PROGRAM} is run without arguments.

Environment: ST_WORKSPACE_PROJECT_ROOT, ST_WORKSPACE_PROJECT.

Options:
  -h, --help  Show this help.
`;

const REPAIR_EXPORT_HELP = `${CLI_PROGRAM} repair-export --help

Usage:
  ${CLI_PROGRAM} repair-export <bundle.json> [<output.json>]

Compile a workspace bundle JSON into a Tavern card JSON plus a PNG card image.

Output path rules:
  The output path (explicit or the input path when repairing in place) must
  end in ".json" (case-insensitive). The PNG is written next to it with a
  ".png" extension, so "OUT.JSON" produces "OUT.png". Paths are compared
  case-insensitively on Windows, and JSON/PNG targets must never alias.
  Paths without a ".json" suffix are rejected with a suggested fix.

In-place repair:
  Without an output argument the input bundle is repaired in place. An
  exclusive backup (<input>.bundle-backup.json, or a numbered suffix such as
  "-2" when that name already exists) is created before anything is replaced;
  existing backups are never overwritten.

Staged writes:
  Both files are first written to unique temporary files next to their final
  targets and renamed into place only after both writes succeed. Existing
  outputs are moved aside and restored if a rename fails. Success is only
  reported after both files are committed, and no temporary files remain.

Options:
  -h, --help  Show this help.

Examples:
  ${CLI_PROGRAM} repair-export bundle.json
  ${CLI_PROGRAM} repair-export bundle.json exports/card.json
`;

const IMPORT_LEGACY_HELP = `${CLI_PROGRAM} import-legacy --help

Usage:
  ${CLI_PROGRAM} import-legacy <legacy-project-path>

Inspect a legacy project directory and print its structure as JSON. Takes
exactly one path argument.

Options:
  -h, --help  Show this help.
`;

const REQUEST_HELP = `${CLI_PROGRAM} request --help

Usage:
  ${CLI_PROGRAM} request [--attach <path>]... [--] <request text>
  ${CLI_PROGRAM} <request text>                (shorthand)

Send a natural-language request to the workspace.

Options:
  --attach <path>  Attach a file to the request. Repeatable; attachments are
                   read in the given order. The path must exist and be a
                   readable regular file, which is validated before any
                   mutation. A missing value is a usage error.
  -h, --help       Show this help.

Parsing rules:
  The first token that is not an option ends option parsing; everything after
  it is request text and is never truncated by option positions. "--" ends
  option parsing immediately, so text that looks like options can be sent:
    ${CLI_PROGRAM} request -- --attach 不是選項
  Empty request text, unknown options, and a missing --attach value are usage
  errors (exit code 2). A mistyped command name is rejected with a suggestion;
  prefix it with "--" to send it as text.

Examples:
  ${CLI_PROGRAM} request 建立一個角色卡
  ${CLI_PROGRAM} request --attach 參考資料.txt --attach 額外設定.txt 建立一個角色卡
  ${CLI_PROGRAM} request -- --attach 不是選項的範例文字
`;

const HELP_HELP = `${CLI_PROGRAM} help --help

Usage:
  ${CLI_PROGRAM} help [<command>]

Show global help, or per-command help for <command>.
`;

export function formatHelp(topic?: CliCommand): string {
  switch (topic) {
    case undefined:
      return GLOBAL_HELP;
    case "serve":
      return SERVE_HELP;
    case "agents":
      return AGENTS_HELP;
    case "status":
      return STATUS_HELP;
    case "repair-export":
      return REPAIR_EXPORT_HELP;
    case "import-legacy":
      return IMPORT_LEGACY_HELP;
    case "request":
      return REQUEST_HELP;
    case "help":
      return HELP_HELP;
  }
}
