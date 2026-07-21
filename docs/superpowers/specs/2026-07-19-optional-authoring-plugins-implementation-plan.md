# Optional Authoring Plugins Implementation Plan

## 1. Delivery Strategy

Implement the feature as vertical, testable increments. Keep all plugins disabled by default until the final end-to-end milestone. Each milestone must leave existing non-plugin projects buildable and all tests green.

Use test-first changes at the real seam whenever possible. Do not add compatibility behavior beyond the defaults and passthrough guarantees in the design.

Primary verification command:

```powershell
pnpm check
pnpm agent-lint
```

## 2. Milestone 1: Shared Contracts and Defaults

### Goal

Introduce typed feature selections and canonical source contracts without changing runtime behavior.

### Files

- Add `packages/schemas/src/plugins.ts`.
- Update `packages/schemas/src/blueprint.ts`.
- Update `packages/schemas/src/proposal.ts`.
- Update `packages/schemas/src/workflow-contracts.ts`.
- Update `packages/schemas/src/index.ts`.
- Update `packages/schemas/src/schema-registry.ts` if persisted contracts are registered there.
- Add `packages/schemas/test/plugins.test.ts`.
- Update `packages/schemas/test/author-schemas.test.ts`.
- Update `packages/schemas/test/workflow-contracts.test.ts`.

### Work

1. Define official plugin ID schemas plus exact implementation version/digest and asset-manifest ID/revision/hash pins.
2. Define immutable template references as stable ID plus positive version and payload revision.
3. Define default-disabled Blueprint selections for MVU, EJS, and three HTML capabilities.
4. Add schema refinements requiring MVU for EJS and status bar.
5. Define recursive MVU variable source, EJS condition/source, HTML component/source, template manifest, plugin contribution, and plugin build-trace schemas.
6. Add discriminated proposal values for MVU, EJS, and HTML bundles. Include target source raw revision/`expectedAbsent`, manifest raw revision, dependency artifact revisions, pending-result hash, and implementation/asset pins. Keep each bundle typed rather than using `unknown` or unrestricted `extensions`.
7. Add the six optional workflow stage literals between greetings and content review.
8. Export all contracts and register persisted schema IDs.
9. Define `plugin-revision-intent`, `plugin-selection`, and `plugin-*` artifact contracts. Compute plugin artifact revision from the canonical source, resolved template, implementation, and asset pins.
10. Keep default-disabled plugin fields valid for `worldbook`. Enforce `character_card` through the versioned project/Blueprint validation envelope because standalone `blueprintSchema` has no project kind.

### Tests

- Existing Blueprint documents parse with all plugin options disabled.
- `EJS=true, MVU=false` fails at the expected path.
- `status_bar=true, MVU=false` fails at the expected path.
- Message presentation and greeting selector parse without MVU.
- Duplicate IDs, invalid defaults, invalid condition nodes, and malformed template references fail.
- Existing workflow stage values remain valid.
- Every active official plugin/capability fails at the expected project/Blueprint envelope path for `worldbook`.

### Acceptance

`pnpm --filter @card-workspace/schemas test` and `pnpm --filter @card-workspace/schemas typecheck` pass with no production behavior change.

## 3. Milestone 2: Plugin SDK and Dependency Resolver

### Goal

Create the official-only execution boundary and deterministic dependency model.

### Files

- Add `packages/plugins/package.json`.
- Add `packages/plugins/tsconfig.json`.
- Add `packages/plugins/src/index.ts`.
- Add `packages/plugins/src/types.ts`.
- Add `packages/plugins/src/registry.ts`.
- Add `packages/plugins/src/dependencies.ts`.
- Add `packages/plugins/src/contributions.ts`.
- Add `packages/plugins/src/diagnostics.ts`.
- Add `packages/plugins/test/dependencies.test.ts`.
- Add `packages/plugins/test/contributions.test.ts`.

### Work

1. Define `PluginDefinition`, immutable compile context, dependency result, impact result, and typed contribution contracts.
2. Implement an append-only registry that resolves only exact implementation version plus SHA-256 digest, rejects duplicate IDs, same-version/different-byte registration, or unsupported pins, and never falls forward.
3. Implement selection normalization that automatically enables MVU for EJS and status bar and returns explanations for Director.
4. Implement stable topological ordering with explicit missing-dependency and cycle diagnostics.
5. Implement contribution merge ownership rules for lore IDs, extension namespaces, regex IDs, runtime assets, and greeting operations.
6. Freeze or clone compile inputs so an implementation cannot mutate Canonical IR by reference.
7. Reject unknown active plugins explicitly.
8. Reject unsupported project kinds in selection resolution and compile dispatch.

### Tests

- Every valid selection resolves to the same order regardless of object insertion order.
- EJS and status bar independently enable MVU.
- Duplicate registration, missing dependency, and cycle fail with stable diagnostics.
- Contributions cannot overwrite core fields or another plugin namespace.
- Duplicate regex, lore, asset, and greeting-operation IDs fail.
- Input IR remains byte-equivalent after plugin compile.
- Adding a newer registry implementation does not alter output from a source pinned to an older version.

### Acceptance

The package exposes a stable SDK and resolver but has no official implementations registered yet.

## 4. Milestone 3: Secure Template Registry

### Goal

Support immutable import, listing, reading, and saving of validated templates.

### Files

- Add `packages/plugins/src/templates.ts`.
- Add `packages/plugins/src/template-parameters.ts`.
- Add `packages/plugins/test/templates.test.ts`.
- Update `packages/project/src/parser.ts`.
- Add `packages/project/src/plugin-templates.ts` only as a generic byte-storage/transaction adapter if existing Project primitives cannot be composed directly. It must not import Plugins or perform plugin semantic validation.
- Update `packages/project/src/index.ts`.
- Add `packages/project/test/plugin-templates.test.ts`.

### Work

1. Use the existing workspace path-security and transaction primitives instead of direct unchecked filesystem calls.
2. Add shared `plugin-data@1` parsing for template manifest/payload, canonical plugin source, and MCP proposal payload. Enforce 1 MiB UTF-8, depth 64, and 50,000 scalar/container nodes on parser tokens/AST before materialization. YAML permits one core-tag document and rejects anchors, aliases, merge keys, custom tags, directives, and complex keys. Tokenized JSON rejects duplicate keys. Both reject dangerous prototype keys.
3. Canonically serialize payloads and compute revisions with existing hash helpers.
4. Store under `templates/plugins/<plugin-id>/<template-id>/<version>/`.
5. Reject symlink/junction traversal, reserved paths, duplicate canonical paths, excessive YAML, and mismatched payload hashes.
6. Make identical import idempotent and conflicting ID/version immutable.
7. Do not implement textual substitution. Derive the finite pointer allowlist from versioned official plugin metadata, not template content. Apply declared typed scalar or whole scalar-array values only through RFC 6901 pointers on a clone. Reject dynamic indices, `-`, duplicate/overlapping targets, dangerous decoded segments, and targets addressing keys, IDs, implementation/asset pins, provenance, code, markup, CSS, operators, or paths; then revalidate the complete resolved source.
8. Record the immutable template payload hash and resolved-source hash.
9. Implement save-from-approved-source with exact source revision and provenance. Draft proposals and build files are invalid inputs.

### Tests

- Import/list/read round trip preserves canonical payload.
- Identical re-import succeeds without changes.
- Same ID/version with different content fails.
- Traversal, links, hash mismatch, invalid plugin compatibility, and invalid parameters fail closed.
- Alias/merge bombs, multiple YAML documents, custom tags, complex keys, duplicate JSON keys, depth 65, node 50,001, dangerous keys, and payloads over 1 MiB fail before materializing unrestricted values.
- Quotes, template syntax, code-like strings, and pointer attempts against forbidden fields remain data or fail; they never perform textual replacement.
- Save from approved source succeeds; draft or stale source fails.
- Fault injection leaves either the old registry or the complete new version.

### Acceptance

Template operations are usable as library calls and never execute payload content.

## 5. Milestone 4: Official MVU/Zod Plugin

### Goal

Generate the complete MVU asset chain from one declarative canonical source.

### Files

- Add `packages/plugins/src/official/mvu/index.ts`.
- Add `packages/plugins/src/official/mvu/validate.ts`.
- Add `packages/plugins/src/official/mvu/paths.ts`.
- Add `packages/plugins/src/official/mvu/generate-zod.ts`.
- Add `packages/plugins/src/official/mvu/typescript-literal.ts`.
- Add `packages/plugins/src/official/mvu/generate-entries.ts`.
- Add `packages/plugins/src/official/mvu/generate-regex.ts`.
- Add `packages/plugins/src/official/assets.ts` containing versioned, immutable official asset manifests.
- Add `packages/plugins/test/mvu.test.ts`.
- Add `packages/plugins/test/fixtures/mvu/` golden sources and expected contributions.

### Work

1. Validate recursive variable IDs, types, defaults, arrays, enum values, constraints, and update coverage.
2. Generate separate runtime-read and JSON-Patch path registries.
3. Generate deterministic Zod 4 source using approved imports, `prefault` where required, and closed clamp/integer transforms.
4. Generate InitVar, variable list, update rules, JSON Patch instruction, and fixed helper entries.
5. Generate UpdateVariable hiding regex.
6. Register `official.mvu-zod` only after its complete test suite passes.
7. Emit TypeScript with a lockfile-pinned TypeScript AST/printer for string literals and property keys; never interpolate authored strings, and reparse generated source before acceptance.
8. Use an append-only official asset manifest whose entries contain URL, allowed resource kind, expected SHA-256, and no-redirect policy. Permit only HTTPS immutable-commit URLs; reject branches, tags, `latest`, mutable aliases, template URLs, digest mismatch, and redirects.

### Tests

- Golden output covers nested objects, enums, numbers with clamp, booleans, and arrays.
- Every initial value validates against its declared model without evaluating generated TypeScript.
- Runtime paths include `stat_data`; patch paths exclude it.
- Invalid defaults, conflicting constraints, uncovered variables, and duplicate paths fail.
- Output ordering and hashes are deterministic.
- Quotes, backticks, `${...}`, backslashes, NUL, lone surrogates, CRLF, Unicode escapes, and every ECMAScript line separator cannot alter generated syntax; reparsing succeeds.
- Official asset manifest revision participates in output trace; mutable or unlisted URLs fail validation.

### Acceptance

A library-level compile of a valid MVU source returns the complete typed contribution and no filesystem changes.

## 6. Milestone 5: Official EJS Plugin

### Goal

Generate safe EJS for all three required conditional-content levels.

### Files

- Add `packages/plugins/src/official/ejs/index.ts`.
- Add `packages/plugins/src/official/ejs/validate.ts`.
- Add `packages/plugins/src/official/ejs/generate-expression.ts`.
- Add `packages/plugins/src/official/ejs/ejs-literal.ts`.
- Add `packages/plugins/src/official/ejs/generate-entries.ts`.
- Add `packages/plugins/test/ejs.test.ts`.
- Add `packages/plugins/test/fixtures/ejs/` golden sources and expected contributions.

### Work

1. Resolve every variable reference through the approved MVU path registry.
2. Validate the closed condition AST and literal compatibility with MVU types.
3. Detect overlapping numeric ranges, duplicate enum cases, unreachable branches, and missing fallback.
4. Generate one deterministic preprocessing entry with stable variable definitions.
5. Generate controller plus disabled entries for whole-entry visibility.
6. Generate inline blocks for section visibility and dynamic text.
7. Generate awaited world-info lookup only through a declared operation; do not accept raw code.
8. Register `official.ejs` with a hard MVU dependency.
9. Use separate AST emitters for EJS expression literals and output text. Encode `<%`/`%>` so expression output contains no raw delimiter, escape delimiters in output text, and parse every generated entry with a lockfile-pinned EJS parser.

### Tests

- Golden fixtures cover entry, section, dynamic text, nested boolean expressions, and fallback.
- Runtime paths always include `stat_data` exactly once.
- Unknown path, wrong literal type, overlap, gap without fallback, and raw-code payload fail.
- Generated variable declarations cannot redeclare on repeated evaluation.
- Output remains deterministic when rule input order is semantically equivalent.
- Quotes, backticks, `${...}`, `<%`, `%>`, NUL, lone surrogates, CRLF, Unicode escapes, and line separators cannot escape generated EJS contexts; reparsing succeeds.

### Acceptance

EJS cannot compile without an approved MVU dependency output and cannot reference undeclared variables.

## 7. Milestone 6: Official HTML Plugin

### Goal

Generate status bar, global message presentation, and greeting selector with a trusted runtime helper.

### Files

- Add `packages/plugins/src/official/html/index.ts`.
- Add `packages/plugins/src/official/html/validate.ts`.
- Add `packages/plugins/src/official/html/css-scope.ts`.
- Add `packages/plugins/src/official/html/sanitize.ts`.
- Add `packages/plugins/src/official/html/policy-v1.ts`.
- Add `packages/plugins/src/official/html/generate-markup.ts`.
- Add `packages/plugins/src/official/html/generate-runtime.ts`.
- Add `packages/plugins/src/official/html/generate-regex.ts`.
- Add `packages/plugins/test/html.test.ts`.
- Add `packages/plugins/test/fixtures/html/` golden sources and expected contributions.

### Work

1. Validate unique component and root IDs.
2. Resolve status-bar bindings through MVU and reject status bar without MVU.
3. Parse with lockfile-pinned `parse5` and `css-tree`, normalize entities/case/escapes, reject duplicate attributes, and enforce the exact versioned `html-policy@1` element, attribute, selector, property, function, at-rule, and rich-text tables from the design. Derive root IDs from stable component IDs; authors cannot supply root selector syntax.
4. Reject SVG, MathML, `srcdoc`, forms, iframes, inline event handlers, authored scripts, CSS imports, network/storage APIs, escape bypasses, and all non-official URLs.
5. Escape bound text by default and allow rich text only through the approved sanitizer declaration.
6. Generate responsive and reduced-motion base rules without overriding explicit valid template rules.
7. Require writable bindings to resolve to write-enabled MVU paths. Fetch the latest runtime object, reject dangerous path segments, apply a path-level host CAS update, validate complete `stat_data`, retry one fresh read on conflict, and never overwrite concurrent state from a stale snapshot.
8. Generate greeting-selector actions from approved greeting IDs.
9. When status bar is enabled, generate StatusPlaceHolder markup, paired display/prompt-hiding regex, and one idempotent canonical greeting-ID transformation. MVU must not depend on HTML selection.
10. Generate paired display and prompt-hiding regex for each enabled presentation component.
11. Register `official.html` with conditional MVU dependency for status bar.

### Tests

- Each capability compiles independently where dependencies allow; all three compile together.
- Missing MVU path, unknown greeting, unscoped CSS, remote resource, inline script, host selector, and missing regex pair fail.
- Bound model strings are escaped in markup and attributes.
- Generated controls meet minimum touch target and reduced-motion checks.
- Status updates preserve non-`stat_data` MVU keys.
- Writes to read-only/unknown paths, dangerous keys, schema-invalid values, and repeated CAS conflicts fail without lost updates.
- Placeholder append is idempotent across primary, alternate, and group-only canonical greetings.
- Mobile and desktop golden markup remain stable.
- SVG/MathML payloads, encoded event attributes, CSS escapes, disguised `url()`, `srcdoc`, forms, and imports fail after parsing.

### Acceptance

All runtime behavior comes from reviewed official generator code, not executable template code.

## 8. Milestone 7: Project Loading, Pending Proposals, Review Apply, and Impact Analysis

### Goal

Make plugin canonical sources formal project artifacts while keeping pending proposals immutable and separate until explicit review approval.

### Files

- Update `packages/project/src/author-layout.ts`.
- Update `packages/project/src/load-author-project.ts`.
- Update `packages/project/src/validate.ts`.
- Update `packages/project/src/index.ts`.
- Update `packages/project/test/load-author-project.test.ts`.
- Update `packages/project/test/parser-validation.test.ts`.
- Update `packages/workflow/src/proposal-validation.ts`.
- Update `packages/workflow/src/proposal-ownership.ts`.
- Update `packages/workflow/src/proposal-apply.ts`.
- Add `packages/workflow/src/plugin-impact.ts`.
- Add `packages/workflow/test/plugin-proposals.test.ts`.
- Add `packages/workflow/test/plugin-impact.test.ts`.

### Work

1. Load only exact canonical paths for active official plugins and include their revisions in `LoadedAuthorProject.sourceRevisions`.
2. Require one valid source per active plugin; ignore absent directories for disabled plugins.
3. Report disabled orphan sources without compiling them; do not silently reactivate them.
4. Map each typed proposal to its one owned canonical path.
5. Validate owner, current task lease, task contract, base workflow revision, target source raw revision/`expectedAbsent`, manifest raw revision, dependency artifact revisions, template snapshot, implementation/asset pins, and semantic source before submission.
6. Submit one immutable pending proposal and complete the task using an exact write allowlist: `.workflow/results/` result, workflow journal event, workflow projection, and task result. Canonical source, manifest, approved artifacts, decisions, and gates are forbidden writes.
7. Bind review to the exact pending proposal revision and result hash. Under the project lock, approval rereads every pinned input, reruns schema/semantic/policy validation, enforces source and manifest raw CAS plus workflow CAS, consumes one user-authorization nonce, then atomically writes source, manifest active set, `plugin-selection`, `plugin-<plugin-id>` artifact, decision journal, and workflow state.
8. Rejection records the decision and creates the bounded revision successor without changing formal source.
9. Implement impact closure for variable, template, capability, enable, disable, exact implementation-version, and official asset-manifest changes.
10. Require explicit cascade confirmation when disabling dependencies.

### Tests

- Active valid sources load and contribute revisions.
- Missing, unknown, duplicate, and invalid active sources block validation.
- Disabled source directories do not affect builds.
- Pending submission touches only result, journal, projection, and task-result writes; fault injection proves it cannot alter source, manifest, approved artifacts, decisions, or gates.
- Review approval is atomic and idempotent; rejection preserves the old canonical source.
- Source/manifest raw revision drift, dependency artifact drift, pending-result byte drift, or semantic-policy drift fails under the lock without partial writes.
- Stale base, stale template, wrong owner, wrong task kind, or wrong plugin fails without writes.
- Stale proposal revision, missing explicit user authorization, spoofed user role, or workflow CAS mismatch fails without writes.
- MVU rename stales EJS and status bar but not unrelated message presentation.

### Acceptance

Formal plugin state can change only through explicit user-authorized review approval under server-authoritative proposal, compare-and-swap, and transaction guarantees.

## 9. Milestone 8: Workflow Stages and Revision Lifecycle

### Goal

Route initial authoring and later revisions through ordered, optional review stages.

### Files

- Update `packages/workflow/src/definitions.ts`.
- Update `packages/workflow/src/state-machine.ts`.
- Update `packages/workflow/src/runtime.ts`.
- Update `packages/workflow/src/gates.ts`.
- Add `packages/workflow/src/plugin-revision.ts`.
- Update `packages/workflow/src/index.ts`.
- Update `packages/workflow/test/state-machine.test.ts`.
- Update `packages/workflow/test/runtime.test.ts`.
- Add `packages/workflow/test/plugin-revision.test.ts`.
- Update `packages/workflow/test/gates.test.ts`.
- Update `workflow/workflow-definitions.yaml`.

### Work

1. Insert MVU, EJS, and HTML authoring/review pairs in canonical stage order.
2. Route initial authoring from the approved Blueprint. For revisions, create an immutable `plugin-revision-intent` containing desired normalized selection, dependency closure, base `plugin-selection` revision, and exact implementation/asset pins; route only from that intent, never the old Blueprint or directory presence.
3. Create tasks only through the engine with exact input artifacts, output contracts, dependencies, capabilities, and bounded attempts.
4. Block review until the matching immutable typed proposal exists; bind review to its exact revision.
5. Require explicit authenticated user authorization and workflow compare-and-swap for review decisions. Director presents decisions but cannot supply or spoof the user role.
6. Record approve/reject decisions with input revisions and semantic summary.
7. On rejection, use the existing bounded successor/retry behavior and preserve formal sources.
8. Add revision begin and dry-run impact operations for approved and published projects. Maintain server-derived `plugin-selection` with complete approved capabilities and source revisions; atomically update it on approval. Content Gate requires selection and revision intent to converge.
9. Use exact artifact IDs `plugin-official.mvu-zod`, `plugin-official.ejs`, and `plugin-official.html`. Define each revision as SHA-256 over RFC 8785 canonical JSON of source revision, resolved-source hash, template payload hash, implementation version/digest, and asset-manifest ID/revision/hash; include these exact revisions in Content Gate.
10. Re-enter only affected plugin pairs, then Content Gate, Compile Preview, and Publish Gate.
11. Invalidate old Content, Compile Preview, and Publish evidence when source, resolved template, exact implementation version, or official asset-manifest revision changes.
12. Route exhausted plugin tasks through existing generic recovery without special unlimited retries.

### Tests

- All-disabled workflows preserve the effective old route.
- Each individual selection enters only required stages.
- EJS waits for approved MVU; status-bar HTML waits for approved MVU.
- Review rejection cannot advance or mutate source.
- Approved proposals advance in order.
- Revisions select the minimal affected stage set and republish only after all gates.
- Revision routing remains correct when initial Blueprint intent differs from the new immutable revision intent or only one HTML capability changes.
- Exact snapshot tests prove every plugin input change stales Content Gate, Compile Preview, and Publish Gate while unrelated inputs remain valid.
- Existing persisted workflow stage values parse and project correctly.

### Acceptance

The workflow remains deterministic, resumable, and journal-projected for every feature combination.

## 10. Milestone 9: Compiler and CCv3 Integration

### Goal

Compile approved plugin sources into deterministic preview and publish artifacts.

### Files

- Add `packages/compiler/src/plugins.ts`.
- Update `packages/compiler/src/build.ts`.
- Update `packages/compiler/src/manifest.ts`.
- Update `packages/compiler/src/index.ts`.
- Add `packages/adapters-ccv3/src/plugin-contributions.ts` for typed mapping and managed-array merging.
- Add `packages/adapters-ccv3/src/plugin-profile-v1.ts` for the pinned SillyTavern/Regex/Tavern Helper payload schemas.
- Update `packages/adapters-ccv3/src/emit.ts` to apply mapped contributions.
- Update `packages/diagnostics/src/` audit rules for managed plugin output.
- Add `packages/compiler/test/plugins.test.ts`.
- Update `packages/compiler/test/build.test.ts`.
- Update `packages/adapters-ccv3/test/emit.test.ts`.
- Update `packages/diagnostics/test/audit.test.ts`.

### Work

1. Resolve active plugins after core planning and compile them in dependency order.
2. Merge contributions through the SDK merger before CCv3 emission.
3. Implement `sillytavern-regex-helper@1`, pinning tested SillyTavern, Regex, and Tavern Helper revisions. Validate the exact Regex and helper-script fields defined in the design, with no extra/missing managed fields.
4. Map managed lore to `/data/character_book/entries/-`, regex to `/data/extensions/regex_scripts/-`, Tavern Helper scripts to `/data/extensions/tavern_helper/scripts/-`, and trace metadata to `/data/extensions/card-workspace/plugins/<plugin-id>`. Treat `/-` as append semantics, create missing arrays, and reject non-array targets.
5. Apply greeting operations by canonical greeting ID before `emit.ts` maps them to `first_mes`, `alternate_greetings`, or `group_only_greetings`.
6. Derive managed regex and helper IDs with namespace `7e7bd0b8-3b85-5f0a-9c7c-21aa15a2a2ab` and canonical `<plugin-id>\n<implementation-version>\n<resource-kind>\n<resource-id>` names. Hash content as SHA-256 over RFC 8785 canonical JSON.
7. Preserve unmanaged array values and order, then append managed values deterministically. Treat same-ID/same-hash as idempotent and same-ID/different-hash as an error; do not use generic deep-array replacement.
8. Add plugin source, resolved template, exact implementation version/digest, and official asset-manifest ID/revision/hash to input revision calculation and publish CAS expectations.
9. Add exact plugin/compatibility profile versions, official asset manifests, template provenance, resolved-source hashes, contribution hashes, diagnostics summary, and timing to build manifest.
10. Include generated managed assets in token and trigger simulation where they affect context.
11. Audit placeholder count, regex route, prompt hiding, extension shape, and managed lore activation.
12. Preserve the rule that build only prepares a publish plan and cannot directly publish.

### Tests

- Existing no-plugin golden builds remain semantically unchanged.
- MVU-only, EJS, each HTML capability, and full-stack golden builds are deterministic.
- JSON and PNG contain equivalent V3 payloads.
- Unknown plugin, missing source, collision, and validation error block before publish-plan mutation.
- Changing a plugin source invalidates an old Compile Preview.
- Unknown passthrough fields survive plugin compilation.
- Golden assertions cover every exact CCv3 pointer, canonical greeting-ID mapping, unmanaged array ordering, deterministic append order, idempotent duplicates, and conflicting managed IDs.
- Missing managed arrays are created; non-array targets, wrong profile fields, extra fields, and unsupported extension revisions fail closed.
- Registering a newer implementation or changing an unselected asset manifest does not change an existing pinned build.

### Acceptance

Compile Preview and Publish Gate observe the exact same plugin-expanded artifact hashes.

## 11. Milestone 10: MCP Tools, Authorization, and Agents

### Goal

Expose the flow safely to Director and dedicated official authoring Agents.

### Files

- Add `packages/mcp-server/src/tools/plugins.ts`.
- Update `packages/mcp-server/src/tool-registry.ts`.
- Update `packages/mcp-server/src/authorization.ts` for workspace template capabilities.
- Add `packages/workflow/src/user-authorization.ts` for hashed one-time review tokens and transactional nonce consumption.
- Add an authenticated, CSRF-protected review-authorization route under `packages/dashboard-server/src/routes/` and its tests. No MCP tool may issue tokens.
- Update `packages/mcp-server/test/authorization.test.ts`.
- Add `packages/mcp-server/test/plugin-tools.test.ts`.
- Update `workflow/agent-registry.yaml`.
- Update `workflow/tool-policy.yaml`.
- Update `workflow/workflow-definitions.yaml` if tool-stage policy is co-located there.
- Update `.opencode/prompts/director.md`.
- Add `.opencode/prompts/mvu-creator.md`.
- Add `.opencode/prompts/ejs-creator.md`.
- Add `.opencode/prompts/html-creator.md`.
- Update `.agents/skills/director-orchestration/SKILL.md`.
- Add `.agents/skills/mvu-creation/SKILL.md`.
- Add `.agents/skills/ejs-creation/SKILL.md`.
- Add `.agents/skills/html-creation/SKILL.md`.
- Update workflow Agent-lint fixtures and tests.

### Tools

Register narrow operations rather than a generic filesystem or plugin command:

- `plugin_selection_resolve`
- `plugin_revision_preview`
- `plugin_revision_begin`
- `plugin_proposal_preview`
- `plugin_proposal_submit`
- `plugin_review_decide`
- `template_list`
- `template_read`
- `template_import`
- `template_save_from_artifact`

### Authorization

- Director can resolve selections, preview/begin revisions, present reviews, relay an opaque Dashboard-issued decision token, list/read templates, and save approved artifacts. Director identity alone is never sufficient authorization for approval.
- Template import is workspace-scoped, Director-only, and requires an explicit local source plus expected hash.
- Plugin creators can claim only their assigned task and call leased `plugin_proposal_submit` only for their plugin proposal contract. Submission stores an immutable pending result and cannot apply it.
- Plugin creators cannot approve, import templates, edit the manifest, invoke another plugin's tools, or publish.
- All project mutations require workflow revision compare-and-swap; task operations also require current lease.
- Dashboard issues a random 256-bit token only after authenticated-session plus CSRF validation and an explicit decision. Store only its SHA-256 with bound project/proposal/decision/workflow/session/nonce fields and a five-minute expiry; validate and consume once in the approval transaction. MCP exposes no issuance path and accepts no actor fields.

### Tests

- Every tool has positive and negative agent/stage/task/lease authorization tests.
- Spoofed `agent_id` remains ignored.
- A creator cannot submit another plugin kind or read undeclared artifacts.
- Director cannot bypass proposal review with a direct source write.
- Director cannot forge explicit user authorization; stale proposal revision or workflow CAS fails before mutation.
- Token replay, expiry, decision mismatch, proposal mismatch, workflow mismatch, and session-bound issuance failures are covered; the raw token is never persisted or logged.
- Agent-lint proves prompt, registry, capabilities, tools, stages, and output contracts agree.

### Acceptance

The complete authoring flow can be driven through MCP without direct filesystem writes by Agents.

## 12. Milestone 11: End-to-End Fixtures and Controlled Acceptance

### Goal

Prove the complete feature against real workflows and a pinned SillyTavern environment.

### Files

- Add `packages/testing/src/fixtures/plugins.ts` or the repository's matching fixture module.
- Add full project fixtures under the existing test fixture convention.
- Add `packages/mcp-server/test/plugin-lifecycle.test.ts`.
- Add or update CLI integration tests if validation/build exposes plugin diagnostics.
- Add an operator acceptance checklist under `docs/`.

### Automated Scenarios

1. No plugins: create, approve, preview, and publish with unchanged behavior.
2. MVU only: generate, approve, compile, revise a variable, and republish.
3. EJS selected: automatically enable MVU and enforce ordered approvals.
4. Status bar selected: automatically enable MVU and append one placeholder.
5. Message presentation only: compile without MVU.
6. Greeting selector only: validate referenced greetings and compile without MVU.
7. Full stack: use imported templates for all plugins, customize proposals, approve separately, publish JSON and PNG.
8. Save approved full-stack sources as templates and reuse them in a second project.
9. Cascade disable MVU, EJS, and status bar while retaining other HTML capabilities.
10. Prove submission touches only the pending-result/task journal/projection allowlist; then test approval and publish rollback.
11. Reject active plugins for `worldbook` at project/Blueprint envelope validation, revision, project validation, and compile.
12. Prove newer registry code cannot alter an older exact-version/digest source before approved migration.

### Controlled SillyTavern Acceptance

Pin the tested SillyTavern version or commit and record it in the acceptance report. Verify:

- MVU initializes and emits valid JSON Patch updates.
- EJS switches entries, sections, and dynamic text at boundary values.
- Status bar renders and updates without losing non-`stat_data` state.
- Global message presentation is visible to the user but hidden from model context where declared.
- Greeting selector chooses only approved greetings.
- Primary, alternate, and group-only greetings contain no duplicate placeholder.
- Desktop, narrow mobile, touch, and reduced-motion behavior are usable.
- Exported cards contain no unlisted or mutable remote resource, secret, or unexpected host-global style; any official remote reference matches the recorded immutable asset manifest exactly.

### Final Verification

```powershell
pnpm build
pnpm lint
pnpm typecheck
pnpm test
pnpm agent-lint
```

Do not declare the feature complete until the automated suite passes, the full-stack fixture publishes atomically, and the controlled SillyTavern report records all acceptance results.

## 13. Recommended Execution Order

Execute Milestones 1 through 3 sequentially. After the SDK and template contracts stabilize, MVU must be completed first. EJS and the non-status HTML work may proceed in parallel, but status-bar integration waits for MVU path-registry output. Project/workflow integration starts only after all three official source contracts are stable. Compiler integration follows formal project loading. MCP and Agent wiring follows stable workflow operations. End-to-end acceptance is last.

The smallest useful tracer bullet is:

```text
Blueprint MVU selection
-> MVU typed proposal
-> leased pending proposal submission
-> explicit user-authorized review approval and canonical source
-> plugin compile contribution
-> CCv3 preview
-> existing Publish Gate
```

Complete this MVU vertical slice before broadening EJS, HTML, templates, or revision UX. It establishes the real seams and prevents three partially integrated subsystems from hiding architectural mistakes.

## 14. Current Implementation Status and Outstanding Work

This section is the authoritative status snapshot during staged implementation. The plan is not complete, and no item below may be reported as complete until its production seam and acceptance tests pass.

### 14.1 Completed Foundations

- The shared schemas package exports the initial official plugin IDs, capabilities, implementation pins, Blueprint selections, simplified MVU/EJS/HTML sources, typed contributions, revision intent, template contracts, proposal contracts, selection projection, plugin artifacts, build trace, and user-authorization envelope.
- Blueprint and workflow schemas accept the optional plugin fields and six plugin authoring/review stage literals while retaining legacy no-plugin documents.
- `packages/plugins` exists with canonical hashing, typed template parameter application, safe basic JS/HTML escaping, minimal generators, and deterministic MVU/EJS/HTML dependency ordering.
- The CCv3 adapter has the initial typed contribution merger, exact managed-array targets, deterministic UUIDv5 naming, greeting operations, idempotency, collision detection, and plugin options on character-card emission.
- The compiler has a preliminary pure plugin compile seam and a preliminary character-card build integration that preserves the no-plugin path.

### 14.2 Partially Implemented, Not Accepted

- Milestone 1: contracts are incomplete. Recursive MVU source, complete EJS condition levels, complete HTML policy contracts, dependency-artifact references, template provenance, and the full project/Blueprint validation envelope remain to be added and tested.
- Milestone 2: the registry now has append-only exact implementation/digest registration, immutable local asset-manifest resolution, deterministic registry revisions, explicit migration records, digest-drift rejection, and pin-preservation tests. External upstream profile/asset pins, production migration operations, stable diagnostics/impact analysis, and broader contribution ownership remain incomplete.
- Milestone 3: `plugin-data@1`, generic source/template storage, bounded parsing, YAML/JSON feature rejection, symlink/path enforcement, canonical template-pair validation, idempotent import, immutable conflict handling, and raw-revision CAS replacement are implemented and covered by project/MCP tests. Official template materialization validates the source payload, derives the finite pointer allowlist, applies typed values structurally, revalidates the complete source, and is exposed through proposal preview without filesystem mutation. A second temporary project imports the same template and resolves a new proposal source; the applied resolved source is also covered through submit, approval, compiler, trace, and atomic publish.
- Milestone 7: active-source loading, revision-intent scaffolding, pending proposal submission, server-issued token consumption, source/manifest/selection/artifact/workflow CAS, and atomic approval/rejection paths are implemented and covered by targeted project/workflow/Dashboard lifecycle tests. Exact dependency/pin resolution, task/owner/workflow/source-CAS rejection cases, pending-byte equality, token replay, template/pin revalidation, pending proposal failure cases, and local MVU-to-EJS/HTML-status-bar impact invalidation are covered; rejection successors and the complete all-combination impact matrix remain incomplete.
- Milestone 8: plugin stages, dependency-ordered task materialization, immutable revision-intent routing, author/review output-contract separation, exact plugin evidence snapshots, dependency artifact invalidation for MVU consumers, and Content/Preview/Publish stale invalidation are implemented and covered by targeted workflow tests. The complete MVU-to-EJS-to-HTML dependency chain, author/review contracts, and local MVU dependency impact closure are covered; complete review-binding and all revision-impact combinations remain incomplete.
- Milestone 9: strict `sillytavern-regex-helper@1` profile schemas, exact CCv3 managed mappings, UUIDv5/idempotency, plugin lore token/trigger simulation, plugin build provenance records (asset manifest, profile fingerprint, diagnostics, timings, contribution hashes), the plugin build-trace publish allowlist, MVU-to-HTML compiler/adapter tests, persisted approved-plugin JSON/PNG deterministic builds, multi-plugin persisted JSON/PNG builds, source/selection/artifact Publish CAS golden cases, and stable preview artifact hashing that excludes runtime timing metadata are implemented. External upstream asset/profile pins and the complete preview/publish matrix remain incomplete.
- Milestone 10: the ten plugin/template MCP tools, Dashboard plugin state/token/review and revision preview/begin routes, tool policies, six creator/critic agents, prompts, skills, personalities, OpenCode bindings, and agent-lint integration are implemented and targeted typecheck/tests pass. The authenticated bootstrap→token→review path and a Dashboard Plugins panel with capability selection, dependency/pin preview, explicit confirmation, cancellation, rejection, token-error handling, and server-owned revision pins are covered; broader product UX and end-user workflow affordances remain incomplete.
- Milestone 11: temporary-project tests now cover MVU revision/proposal/token approval/reload/replay rejection, pending proposal drift rejection, approval-to-compiler-to-plugin-trace-to-atomic-publish, no-plugin deterministic build behavior, worldbook fail-closed compilation, template import/replacement CAS, approved-source template persistence/idempotency, typed template materialization/proposal-preview validation, reuse of one imported template in a second project, applied-template source through submit/HTTP approval/compiler trace/atomic publish, and persisted approved-plugin JSON/PNG deterministic multi-plugin build/publish round-trips including a three-plugin selection and exact preview-to-publish JSON/PNG/plugin-trace flow. Remaining gaps are broader template/fixture combinations, migration/pinning production scenarios, and controlled SillyTavern acceptance.
- Milestone 4: library-level acceptance is complete. The official MVU compiler has recursive typed source validation, separate runtime/patch paths, Zod/InitVar/variable-list/update-rule/JSON-Patch assets, fixed lore entries, UpdateVariable hiding regex, pinned TypeScript literal emission/reparse, and an immutable official runtime asset manifest. The dedicated MVU suite, schemas, plugins, compiler, and CCv3 adapter checks pass. Formal approved-source loading, workflow approval, and publish lifecycle integration remain tracked under Milestones 7-9.
- Milestone 5: library-level acceptance is complete. The official EJS compiler has closed recursive expressions, MVU path resolution, preprocessing aliases, whole-entry/section/dynamic-text generation, conservative range overlap/gap/fallback validation, context-safe emitters, lightweight delimiter reparse, deterministic contributions, and hostile-input coverage. Formal approved-source loading, workflow approval, and publish lifecycle integration remain tracked under Milestones 7-9.
- Milestone 6: library-level acceptance is complete. The official HTML compiler has a pinned `parse5`/`css-tree` boundary, positive `html-policy@1` tables, generated component/root IDs, scoped responsive/reduced-motion CSS, parsed HTML/CSS rejection of unsafe constructs, paired status/message regexes, approved greeting operations, and a trusted runtime CAS/write-permission seam. Formal approved-source loading, workflow approval, host integration, and publish lifecycle remain tracked under Milestones 7-9.

### 14.3 Not Yet Implemented

- Milestone 10: the local authenticated review panel and revision controls are implemented, but the complete productized Dashboard review UX and broader end-user workflow affordances remain.
- Milestone 11: broader template/JSON/PNG fixture combinations, the full multi-plugin lifecycle E2E matrix, production migration/pinning scenarios, and controlled SillyTavern acceptance remain.

### 14.4 Known Remaining Gaps

1. Imported templates are validated, idempotent, safely materialized into resolved typed source, reusable across projects, and covered through one applied submit/approval/publish lifecycle. Broader template combinations and failure-matrix coverage remain incomplete.
2. Plugin artifact/build-trace provenance, local exact registry pins, explicit migration records, and pin-preservation tests are implemented; external compatibility asset/profile commit pins and production migration operations are not complete.
3. Plugin token/trigger impact, persisted approved-plugin JSON/PNG build round-trips, multi-plugin builds, source/selection/artifact Publish CAS golden cases, local MVU-dependent artifact impact invalidation, centralized capability-sensitive dependency resolution, and a three-plugin exact preview/publish JSON/PNG flow are covered locally; broader preview/publish combinations remain incomplete.
4. The Dashboard review and revision routes and HTTP-level token/review flow are covered, and the local Plugins panel now supports capability selection, dependency/pin preview, explicit confirmation, cancel/reject/token errors; broader product UX remains.
5. Broader M11 template/JSON/PNG fixture combinations and the controlled SillyTavern execution report are missing.
6. The latest full workspace verification passes: `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm agent-lint`, and `pnpm test` (80 test files, 616 tests). It validates the current local implementation but does not replace the missing controlled external acceptance.

7. The MVU official runtime asset is pinned to the verified `StageDog/tavern_resource` commit and SHA-256 recorded in `packages/plugins/src/official/assets.ts`; controlled SillyTavern execution and external compatibility-profile acceptance remain unverified.

### 14.5 Resume Order

Continue in this order:

1. Complete the remaining multi-plugin fixture and pending-proposal matrix.
2. Complete the broader preview/publish golden CAS combinations and template combinations.
3. Extend the Dashboard panel into the full productized user review workflow.
4. Pin external compatibility assets/profile versions, add production migration operations, and run controlled SillyTavern execution.
5. Run the final verification commands in Section 12 after the remaining local changes.

### 14.6 MVU Milestone Resume Point

Milestone 4 library-level acceptance is recorded after `packages/plugins/test/mvu.test.ts`, schemas, plugins, compiler, and CCv3 adapter checks passed. The next MVU-related work is to consume the compilation only from the formal approved-source and pinned-selection path during Milestones 7-9; direct library compilation must remain deterministic and filesystem-free. The other milestones remain in progress.

### 14.7 EJS Milestone Resume Point

Milestone 5 library-level acceptance is recorded after `packages/plugins/test/ejs.test.ts`, schemas, plugins, compiler, and CCv3 adapter checks passed. The next EJS-related work is to consume the compilation only from the formal approved-source and pinned-selection path during Milestones 7-9; direct library compilation must remain deterministic and filesystem-free. Milestones 6-11 remain in progress.

### 14.8 HTML Milestone Resume Point

Milestone 6 library-level acceptance is recorded after `packages/plugins/test/html.test.ts`, the pinned parser boundary, schemas, plugins, and CCv3 adapter checks passed. The next HTML-related work is to consume the compilation only from the formal approved-source and pinned-selection path during Milestones 7-9; direct library compilation must remain deterministic and filesystem-free. The trusted runtime still requires a real host implementation and controlled execution acceptance.

### 14.9 Latest Verification Snapshot

The latest full workspace verification passes:

- `pnpm build`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm agent-lint`
- `pnpm test` — 80 test files and 616 tests

Targeted plugin verification also passes:

- compiler — 6 files, 42 tests
- MCP server — 12 files, 74 tests
- Dashboard server — 4 files, 24 tests
- Dashboard frontend — 4 files, 13 tests
- Plugins — 6 files, 27 tests
- Project — 13 files, 87 tests
- Workflow — 12 files, 118 tests

The Dashboard production build still emits the existing large-chunk warning. M7-M11 remain **in progress** because automated local verification does not cover template resolution into canonical sources, the complete authenticated review UX, external compatibility asset/profile pin acceptance, the full JSON/PNG plugin publish matrix, migration stability, or controlled SillyTavern execution.

Until all of the above is complete and verified, the feature status is **in progress**, not complete.
