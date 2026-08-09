# ST Workspace v3

## Structured templates

All migrated Agent/Skill outputs use the shared contract registry in
`packages/core/src/templates.ts`. Use
`workspace_template_context({ kind })` to read a fixed guide, examples and
JSON Schema, then call `workspace_template_submit({ kind, ...value })`.
The runtime generates persistence details and validates the proposal before it
is stored. The full mapping is documented in
`docs/migration/skill-contract-map.md`.

## Compiler and publish outputs

The build path is now a real compiler pipeline rather than an artifact dump:

- `@st-workspace/compiler` normalizes V3 artifacts and accepted facts into a deterministic project.
- `@st-workspace/adapters-ccv3` emits schema-valid CCv3 JSON and managed Plugin contributions.
- `@st-workspace/adapters-png` writes and reads PNG `ccv3` / `chara` metadata chunks with CRC validation.
- `@st-workspace/plugins` generates typed MVU, EJS and HTML contributions from Plugin proposals.

When a file-backed project is published, `exports/` contains only the latest
user-facing `exports/<project>-角色卡.json` (or
`exports/<project>-珠璣角色卡.json`) and matching PNG. They are committed with
one publish transaction; `.workspace/plugin-build-trace.json` remains internal.
The JSON is a Tavern-loadable CCv3 envelope and the PNG contains `ccv3` metadata
plus a `chara` V2 backfill. Blueprint, artifacts, facts and workflow state stay
in their semantic/workspace folders. A failed output materialization leaves the
previous revision and exports intact.

### Workflow gates and editable publishing

Formal projects run a single publish gate. It blocks unresolved interview or
blueprint prechecks, missing cross-artifact references, missing source
provenance, incomplete fact-review quorum, unreviewed current revisions and
effective blocking issues. Draft authoring remains open so incomplete work can
be previewed and corrected. A successful publish is an immutable snapshot;
authoring after publish creates a new draft revision and keeps the previous
publish/export available until the next publish succeeds.

Source research keeps the candidate domain policy with the project. Fetching
rejects candidates outside that policy and reports
`SOURCE_RESEARCH_OFFICIAL_REQUIRED` if an identified official candidate cannot
be ingested. Fact-review passes are persisted per fact for reviewer 1/2/3
auditing.

Available kinds include `character`, `zhuji`, `palette`, `wardrobe`, `greetings`,
`relationships`, `world`, `conversion`, `import_analysis`, `review`,
`source_research`, `fact_curation`, `fact_review`, `plugin` and
`director_routing`.

## Background worker and readiness

The local server starts a `WorkspaceWorker` automatically. It resumes persisted
`created`, `resolving`, and `running` operations, retries recoverable failures,
and leaves `needs_input` operations paused for the user. Check readiness with
`GET /workspace/health`; a healthy response includes `status: "ready"` and the
worker state. The worker is stopped automatically when the server closes.

## Project folders and interview

When no project is selected explicitly, the server and CLI use the workspace
`projects/` directory and create a fresh `project-###` session on first use; an
existing project is never reopened implicitly. A new request starts a
high-level interview; answers are stored atomically in `.workspace/interview.json`.
The interview delays the
project name until the concept is clear, asks world and multi-character
relationship questions when relevant, and then presents mode-neutral Blueprint
direction choices. A direction can be selected, regenerated, mixed or revised
with a short natural-language answer; it never becomes a Zhuji or palette
module directly. The Zhuji `self_introduction` 30-Unicode-character rule is
enforced only by the final formal Zhuji module, not by the interview.

The first persistence point is a recoverable folder such as
`projects/project-002` when `project-001` already exists. Once the interview is
complete and a display name is confirmed, the folder is safely renamed to that
name (with a numeric suffix on collision). Users never need to create folders
or supply internal workflow values. Existing projects can be listed and
selected through `workspace_projects` and `workspace_project_select`; in
OpenCode, Director presents those choices with the native `question` menu.

After a character's Blueprint and Zhuji or palette settings are ready, the
Director routes a cross-mode wardrobe task to `wardrobe-creator` by default.
The task can be skipped, deferred or revised in natural language without
repeating the interview or changing the character settings.

Every generated file stays inside its project folder:

```text
projects/<name>/
├─ .workspace/       interview, workflow and audit state
├─ sources/          source manifest
├─ knowledge/        knowledge chunks
├─ facts/            fact and issue register
├─ characters/
│  └─ <character-folder>/
│     ├─ character.json
│     ├─ zhuji/
│     ├─ palette/
│     └─ wardrobe/wardrobe.md
├─ blueprint/blueprint.json
├─ relationships/relationships.json
├─ world/<world-artifact>.json
├─ greetings/greetings.json
├─ plugins/
└─ exports/          latest final JSON and PNG only
```

公開內容樹不建立 `proposals/`；proposal revision 與流程型 artifact 留在
`.workspace/`。讀取舊專案時，舊 root state、`proposals/` 與中間 exports 會先
完整移入 `.workspace/legacy-layout/` 備份，再物化到上述語意路徑。

這是獨立重建的 intent-first 工作區。舊工作區只作唯讀參考，不在此專案的
runtime dependency graph 內，也不會被新 runtime 修改。

## 已完成的核心能力

- `workspace.request(request)` / `workspace.status()` 高階契約；Agent 不需傳 project ID、revision、capability、stage、steps、file path 或 bytes。
- strict schema、CAS revision、atomic file commit、audit 與失敗後可恢復的 operation。
- 來源搜尋候選、受控 HTTPS fetch、附件 fallback、UTF-8/BOM/換行正規化、partial recovery。
- knowledge chunks、facts、evidence/provenance、refresh；character、relationship、world lore、greeting、Blueprint、珠璣、調色盤、跨模式 wardrobe 與 plugin artifact revision。
- review、self-review 阻擋、effective severity、quality profile 與 issue re-evaluation。
- deterministic preview/build、blocking issue 驗證、transactional publish、publish hash receipt。
- JSON card dry-run/import/conversion；未知欄位會保留並列入 report。
- legacy read-only inspection；不會自動接回舊 workflow runtime。
- CLI、REST、MCP 與 Dashboard 共用同一個 runtime；Dashboard、`workspace_agents` 與 CLI `agents` 都會明確列出 Director 及所有可用 Agent，Director 是預設路由，也可被指定。
- 所有 Agent/Skill 都有固定結構化合約：core Zod Schema → MCP `workspace_template_submit` JSON Schema → `workspace_template_context` 的指南與既有實例 → 對應 Agent/Skill 寫作規則。珠璣七模組仍保留 `workspace_zhuji_*` 相容入口。

## Agent / Skill / Personality

- `.agents/agents`：21 份高階 Agent prompt；registry 的 23 個 Agent ID 由 `.agents/registry.yaml` 與 `.agents/aliases.yaml` 保留。
- `.agents/personalities`：23 份 personality YAML 原樣保留；Agent prompt 只引用人格，不複製人格內容。
- `.agents/skills`：21 個高階 Skill；領域規則保留，低階操作契約封裝在 Runtime。
- `docs/migration/legacy-prompts` 與 `docs/migration/legacy-skills`：舊版參考，不會被新版 Runtime 載入。

驗證 Agent 資產：

```text
pnpm agent:lint
```

可以直接用自然語言呼叫工作，也可以使用舊 Agent 名稱作為相容 alias；不需要輸入工作流識別資料。

OpenCode 的可見 Agent 另外由專案級設定提供：

- `opencode.jsonc`：註冊 `director (primary)`、將它設為預設 Agent，並以 `{file:...}` 在 OpenCode 啟動時把 Director prompt、繼承的 `base-adult`、`.agents/personalities/director.yaml` 與 `director-orchestration` skill 組合成同一份 system prompt。
- `.agents/agents/director.md`、`.agents/personalities/director.yaml`、`.agents/skills/director-orchestration/SKILL.md`：分別維護角色職責、人格與細部工作規則；修改後下次啟動 OpenCode 即會重新載入。

請從此專案根目錄重新啟動 OpenCode；若 OpenCode 已經開啟，需重開工作區或重啟 TUI 才會重新載入 Agent 清單。

## 使用方式

```text
pnpm install
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm build
```

CLI：

```text
pnpm --filter @st-workspace/cli start status
pnpm --filter @st-workspace/cli start "建立角色 Yukino，性格冷靜直接"
pnpm --filter @st-workspace/cli start "匯入角色卡" --attach card.json
pnpm --filter @st-workspace/cli start import-legacy "C:\\AI\\projects\\card-workspace"
pnpm --filter @st-workspace/cli start serve
pnpm --filter @st-workspace/cli start agents
```

HTTP/MCP server 預設在 `http://127.0.0.1:8787`：

- `GET /`：Dashboard
- `GET /workspace/status`
- `GET /workspace/agents`：檢視 Director 與所有 Agent
- `GET /workspace/projects`：列出 `projects/` 中可選專案
- `POST /workspace/project/select`：`{"project":"可見名稱或資料夾名稱"}`
- `GET /workspace/interview/context`：取得目前訪談問題與已保存回答
- `POST /workspace/interview/answer`：`{"answer":"..."}`，保存回答並回傳下一題
- `GET /workspace/zhuji/context?character_id=...`：取得珠璣 Schema、七模組指南與既有模組
- `POST /workspace/request`：`{"request":"...", "agent":"director"}`（`agent` 可省略）
- `POST /workspace/zhuji`：提交一個符合珠璣 Schema 的模組 proposal
- `POST /mcp`：標準 JSON-RPC tools/list/tools/call；包含 `workspace_agents`、`workspace_zhuji_context`、`workspace_zhuji_submit`

## 設計邊界

柔性只存在 runtime 邊界；進入 core 後仍會嚴格驗證 schema、身份、CAS、
交易完整性與 publish policy。遇到不能安全推斷的值，系統會建立一個
`needs_input` operation，只問一個可恢復的高階問題，不要求使用者補底層參數。
