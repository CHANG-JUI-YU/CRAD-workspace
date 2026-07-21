# Optional Authoring Plugins and Reusable Templates

## 1. Goal

Add three optional, first-class authoring capabilities to character-card projects:

- MVU with generated Zod 4 schema and supporting assets.
- EJS conditional worldbook content driven by MVU variables.
- HTML status bars, global message presentation, and greeting selectors.

Each capability is explicitly selected, generated as a reviewed proposal, stored as revisionable canonical source, validated before compile, and compiled into SillyTavern-compatible output. Users may import reusable templates or save approved project artifacts as templates.

## 2. Product Decisions

- Selection uses independent options with automatic dependency resolution.
- EJS automatically enables MVU.
- The HTML status bar automatically enables MVU.
- Global message presentation and greeting selectors do not require MVU.
- All three HTML capabilities are in the first release.
- Features can be enabled, disabled, reconfigured, or retargeted after project creation through a formal revision flow.
- MVU, EJS, and HTML are reviewed and approved in dependency order rather than generated as one opaque bundle.
- Canonical plugin sources are durable project artifacts, not temporary export output.
- The first release contains official executable plugin implementations only.
- User customization is provided through validated data templates for all three plugins. It does not install backend code.
- Templates can be imported from files and created from approved project artifacts.

## 3. Scope

### 3.1 Included

- A versioned plugin SDK and official plugin registry.
- Typed Blueprint feature selections.
- MVU, EJS, and HTML canonical source schemas.
- Dependency resolution and impact analysis.
- Proposal, review, revision, compile, diagnostics, and publish integration.
- Workspace-level immutable template registry.
- MCP tools and Agent instructions required to operate the flow.
- JSON and PNG export through the existing CCv3 pipeline.

### 3.2 Excluded

- Installation or execution of third-party backend plugin code.
- Arbitrary JavaScript execution inside Forge, validators, or template rendering.
- Remote template registries, package managers, or author-supplied network asset downloads. An official generator may emit only URLs listed in its versioned official asset manifest and pinned to an immutable commit.
- A visual template editor in the Dashboard.
- Automatic conversion of arbitrary legacy MVU/EJS/HTML scripts into canonical source.
- SillyTavern API keys, secrets, or credentials in templates or card output.

The Dashboard may expose existing artifact and diagnostic views without a dedicated editor. A visual editor is a separate follow-up.

## 4. Architecture

### 4.1 Package Boundary

Create `packages/plugins` with four responsibilities:

1. Define the versioned SDK and contribution boundary.
2. Resolve enabled plugins and dependencies deterministically.
3. Load and validate canonical plugin sources and templates.
4. Register the three official implementations.

The core compiler does not contain MVU, EJS, or HTML-specific branches. It invokes registry definitions and merges their typed contributions.

The schemas remain in `@card-workspace/schemas` so Project, Workflow, MCP, Plugins, and tests share one dependency-free contract package. Dependencies point in one direction:

```text
Schemas
  <- Project (generic safe paths, parsing, storage, and transactions)
  <- Plugins (semantic validation and generation)
  <- CCv3 Adapter (typed output mapping)
Schemas + Project + Plugins + Adapter
  <- Workflow / Compiler / MCP composition
```

Project and the CCv3 Adapter must not import Plugins. Project may expose generic byte-storage and transaction adapters, but it does not perform plugin semantic validation. Plugins may use those generic adapters through composition. This prevents a Project/Plugins or Adapter/Plugins dependency cycle.

### 4.2 Official Plugins

| Plugin ID | Canonical responsibility | Dependency |
| --- | --- | --- |
| `official.mvu-zod` | Variables, defaults, update rules, Zod source, MVU instructions, placeholders, and required regex | None |
| `official.ejs` | Entry visibility, section visibility, dynamic text, and generated preprocessing definitions | `official.mvu-zod` |
| `official.html` | Status bar, global message presentation, and greeting selector | Status bar only requires `official.mvu-zod` |

The first release supports every official plugin and HTML capability only for `character_card`. Blueprint refinement, dependency resolution, revision, project validation, and compile all reject active plugin selections for `worldbook`; standalone-worldbook EJS is deferred.

Plugin versions use explicit positive integers, but the integer is not the integrity boundary. Every authoring task seed, pending proposal, and canonical source pins an exact implementation version plus implementation SHA-256 digest, and an official asset-manifest ID, revision, and SHA-256 digest. Registry resolution must match every pin and must never fall forward after a registry upgrade. Registry versions and asset manifests are append-only; registering the same ID/version with different bytes is rejected. Upgrading requires a migration proposal and normal review.

Each official asset entry records exact URL, allowed resource kind, expected content SHA-256, and redirect policy. Only HTTPS URLs containing an immutable upstream commit are valid; redirects are disabled. Build manifests record all implementation and asset pins, source contract, source revision, and template provenance.

### 4.3 SDK Contract

Each registered plugin declares:

- Stable ID and implementation version.
- Supported project kinds.
- Configuration and source contract references.
- Dependency resolver.
- Source loader and semantic validator.
- Contribution compiler.
- Revision impact analyzer.
- Template contract and policy rules.

The compile interface receives immutable Canonical IR, parsed plugin source, resolved dependency outputs, and policy. It returns a `PluginContribution` containing only:

- Additional namespaced lore entries.
- Namespaced card extension values.
- Namespaced regex scripts.
- Idempotent greeting transformations declared by operation type.
- Runtime assets represented as inline text.
- Structured diagnostics and trace metadata.

A plugin cannot receive filesystem handles, mutate input IR, emit arbitrary output paths, overwrite core card fields, or publish files. Contribution merging rejects duplicate IDs, namespace violations, conflicting greeting operations, and extension collisions.

### 4.4 CCv3 Contribution Mapping

The CCv3 Adapter maps merged contributions to these exact JSON Pointer targets:

| Contribution | CCv3 target |
| --- | --- |
| Managed lore entry | `/data/character_book/entries/-` |
| Managed regex script | `/data/extensions/regex_scripts/-` |
| Tavern Helper script | `/data/extensions/tavern_helper/scripts/-` |
| Plugin trace metadata | `/data/extensions/card-workspace/plugins/<plugin-id>` |

The `/-` suffix describes deterministic append semantics; the Adapter constructs the final object and does not execute JSON Patch against output. Missing managed-array targets are created as arrays. An existing non-array target fails without coercion.

The first compatibility profile is `sillytavern-regex-helper@1`. It pins one tested SillyTavern commit plus tested Regex and Tavern Helper extension revisions. Its managed Regex object has exactly `id`, `scriptName`, `findRegex`, `replaceString`, `trimStrings`, `placement`, `disabled`, `markdownOnly`, `promptOnly`, `runOnEdit`, `substituteRegex`, `minDepth`, and `maxDepth`. Its managed Tavern Helper script has exactly `type: "script"`, `enabled`, `id`, `name`, `content`, `info`, `button: { enabled, buttons: [{ name, visible }] }`, and `data: {}`. Extra or missing managed fields fail profile validation.

Greeting operations are applied to canonical greeting IDs before `packages/adapters-ccv3/src/emit.ts` maps them to `first_mes`, `alternate_greetings`, or `group_only_greetings`. Managed regex and helper-script IDs are deterministic UUIDv5 values using namespace `7e7bd0b8-3b85-5f0a-9c7c-21aa15a2a2ab` and canonical name `<plugin-id>\n<implementation-version>\n<resource-kind>\n<resource-id>`. Resource IDs use lowercase ASCII stable IDs. Content identity is SHA-256 over RFC 8785 canonical JSON.

Unmanaged imported arrays retain their original order and values. Managed values append in deterministic plugin/resource order. A same-ID, same-content-hash contribution is idempotent; a same-ID, different-content-hash collision fails. Generic deep merge must never replace these arrays.

## 5. Selection Model

### 5.1 Blueprint

Add a defaulted `plugins` field to `blueprintSchema`:

```yaml
plugins:
  mvu:
    enabled: true
    template_ref: mvu.relationship-core@1
  ejs:
    enabled: true
    template_ref: ejs.relationship-phases@2
  html:
    status_bar:
      enabled: true
      template_ref: html.compact-status@1
    message_presentation:
      enabled: true
      template_ref: html.parchment-message@1
    greeting_selector:
      enabled: true
      template_ref: html.route-selector@1
```

All options default to disabled and all template references are optional. The intake resolver applies these implications before Blueprint proposal creation:

```text
EJS enabled -> MVU enabled
HTML status bar enabled -> MVU enabled
Any HTML capability enabled -> official.html enabled
```

Schema validation still rejects unresolved invalid combinations. Automatic resolution is an authoring convenience, while validation is the invariant.

`blueprintSchema` does not independently know project kind. The versioned project/Blueprint validation envelope compares `project.yaml.kind` with Blueprint selections and rejects any active first-release capability unless the manifest kind is `character_card`. Tests assert the envelope diagnostic path, not a standalone Blueprint-only refinement.

### 5.2 Project Manifest

Keep the existing `project.yaml.plugins` string array. It records the approved active plugin set, not pending Blueprint intent. IDs are unique and stored in dependency order.

The manifest changes only in the same atomic transaction that applies an approved plugin proposal. Disabling a plugin removes its ID only after dependent changes are approved.

Initial authoring routes from the approved Blueprint. Every later `plugin_revision_begin` creates one immutable `plugin-revision-intent` workflow artifact containing the normalized desired selection, dependency closure, base approved-selection revision, and exact implementation/asset pins. That artifact, not the original Blueprint or directory presence, is the sole routing authority until the revision closes.

The workflow also maintains a server-derived `plugin-selection` approved artifact. It records approved capabilities, active IDs, source revisions, implementation/asset pins, plugin artifact revisions, and selection revision. It is updated atomically on approval; dependency-safe ordering is mandatory, and Content Gate waits until selection and revision intent converge.

### 5.3 Canonical Source Layout

Approved sources live under the existing project root:

```text
projects/<project-id>/
  extensions/
    official.mvu-zod/
      source.yaml
    official.ejs/
      source.yaml
    official.html/
      source.yaml
```

Each `source.yaml` contains its schema version, exact positive implementation version and digest, official asset-manifest ID/revision/hash, feature configuration, template provenance, and canonical authoring model. Generated Zod, EJS, HTML, worldbook entries, and regex are build artifacts and are not edited as canonical source.

## 6. Canonical Authoring Models

### 6.1 MVU

MVU canonical source is declarative. Forge does not execute an authored `schema.ts` to discover its shape.

The model contains:

- A recursive variable tree with stable IDs and display labels.
- Types: object, string, number, boolean, enum, and homogeneous array.
- Initial values.
- Closed constraints such as min, max, integer, length, enum values, and clamping.
- Update permissions and natural-language update rules.
- Visibility and description metadata.
- Optional template parameters already resolved to concrete values.

The compiler derives from this single model:

- Zod 4 schema source using approved imports and idempotent defaults.
- InitVar content.
- Variable list.
- `[mvu_update]` update rules and JSON Patch output contract.
- Fixed MVU helper entries.
- UpdateVariable hiding regex.
- A variable path registry consumed by EJS and HTML.

The path registry distinguishes:

```text
Runtime read path: stat_data.<variable-path>
AI JSON Patch path: /<variable-path>
```

Validators prove variable ID uniqueness, type/default compatibility, constraint consistency, generated path uniqueness, init/update coverage, and deterministic generation. Beta-style MVU and Zod-style MVU cannot be mixed.

Generated TypeScript is emitted from the typed variable AST through a lockfile-pinned TypeScript AST/printer. The only text contexts are string literals and property keys; both use AST nodes rather than source interpolation. Generated source is reparsed by the same pinned TypeScript parser before acceptance. Regression cases include quotes, backticks, `${...}`, backslashes, NUL, lone surrogates, CRLF, Unicode escapes, and every ECMAScript line terminator.

### 6.2 EJS

EJS canonical source represents intent rather than unrestricted JavaScript. It supports the three required levels:

- Whole-entry visibility.
- Conditional sections within an entry.
- Dynamic text selected from exhaustive cases.

Conditions use a closed expression tree with variable references, literals, comparisons, membership, `all`, `any`, and `not`. Every variable reference must resolve through the MVU path registry. Ranges and cases must not overlap and must declare an explicit fallback when they are not exhaustive.

The compiler generates:

- One preprocessing entry containing stable variable definitions.
- Controller entries and disabled phase entries where whole-entry switching is appropriate.
- Inline EJS blocks for section and dynamic-text rules.
- Correct async use for world-info lookups when a generated rule requires it.

Generated runtime reads always include `stat_data`; generated JSON Patch paths never do. The first release has no raw-JavaScript escape hatch.

Generated EJS uses separate emitters for expression string literals and non-executable output text. It never concatenates authored values into EJS delimiters or expressions. Expression literals encode `<%` and `%>` into JavaScript escapes whose emitted bytes contain no raw delimiter. Output text is emitted outside executable tags with EJS delimiter escaping. Every generated entry is parsed by a lockfile-pinned EJS parser before acceptance. Tests include the TypeScript hostile corpus plus `<%`, `%>`, and nested delimiter combinations.

### 6.3 HTML

HTML source contains up to three components:

- `status_bar`
- `message_presentation`
- `greeting_selector`

Each component declares a stable component ID, semantic bindings, markup, scoped CSS, and declarative interactions. Forge derives the root selector as `#cw-<component-id>`; authors cannot supply selector syntax for the root. Status-bar bindings resolve through the MVU path registry. Greeting-selector actions select approved greeting IDs rather than evaluating authored JavaScript.

Forge generates the trusted runtime helper. Templates cannot provide arbitrary JavaScript. `official.html`, not MVU, owns StatusPlaceHolder markup, paired regex, and the idempotent greeting transformation; MVU exposes only the approved path registry and state assets.

A writable control must resolve to an MVU path whose source declares write permission. The helper fetches the latest complete MVU object, rejects `__proto__`, `prototype`, and `constructor` at every path segment, applies a path-level update through the host compare-and-swap API, validates the resulting complete `stat_data` against the approved MVU schema, and writes the complete object only if the runtime revision still matches. It retries one fresh read on CAS conflict and otherwise reports a diagnostic; it never overwrites concurrent state from a stale snapshot.

Markup and CSS are parsed before acceptance. Policy uses positive allowlists for HTML elements, attributes, URL schemes, CSS properties, and CSS functions; escaping or encoding cannot bypass the parsed checks. Policy requires:

- Inline output with no remote script, style, font, image, or iframe resource.
- CSS scoped beneath the declared root selector.
- Escaping of model-derived text by default.
- Allowlist sanitization for explicitly declared rich text.
- Responsive layout, touch targets, and reduced-motion behavior.
- Paired display and prompt-hiding regex where presentation markup must not enter model context.
- No network calls, persistent secrets, `localStorage`, or arbitrary host selectors.
- No SVG, MathML, `srcdoc`, forms, iframes, inline event handlers, authored scripts, CSS imports, or non-official resource URLs.

`html-policy@1` is a versioned closed policy implemented with lockfile-pinned `parse5` and `css-tree` versions:

- Elements: `div`, `span`, `p`, `section`, `header`, `footer`, `ul`, `ol`, `li`, `dl`, `dt`, `dd`, `table`, `thead`, `tbody`, `tr`, `th`, `td`, `button`, `label`, `input`, `select`, `option`, `progress`, `meter`, `br`, `strong`, `em`, and `small`.
- Attributes: `id`, `class`, `role`, `tabindex`, closed `aria-*` names, and generated `data-cw-bind`, `data-cw-action`, `data-cw-target`; form-control attributes are limited to `type`, `value`, `min`, `max`, `step`, `checked`, `selected`, and `disabled`. No URL-bearing attribute, namespace, `style`, arbitrary `data-*`, or duplicate attribute is accepted.
- CSS properties: `display`, grid/flex alignment and gap properties, `box-sizing`, width/height/min/max variants, margin/padding variants, border variants, `border-radius`, `background-color`, `color`, font properties, `line-height`, `text-align`, `white-space`, `overflow` variants, `opacity`, `transform`, `transition`, and `animation`. Functions are limited to `rgb`, `rgba`, `hsl`, `hsla`, `calc`, `min`, `max`, and `clamp`; `url`, `var`, custom properties, unknown functions, and escaped function names fail.
- Selectors may contain only the generated root ID followed by descendant child combinators, classes, allowed attributes, and `:hover`, `:focus`, `:focus-visible`, `:checked`, `:disabled`, `:first-child`, or `:last-child`. Pseudo-elements, namespaces, escaped identifiers, and selectors outside the generated root fail.
- At-rules are forbidden except a generated `@media (prefers-reduced-motion: reduce)` block. Templates cannot author at-rules. Rich text uses a separate `rich-text@1` subset limited to `br`, `strong`, `em`, `small`, and plain text with no attributes.

Parser normalization occurs before policy checks: HTML entities are decoded, names are ASCII-case-folded, duplicate attributes are rejected from parser tokens, CSS escapes are decoded, and comments are discarded. Anything not explicitly listed fails closed.

## 7. Template Registry

### 7.1 Storage

Templates are workspace resources, separate from projects:

```text
templates/plugins/<plugin-id>/<template-id>/<version>/
  template.yaml
  payload.yaml
```

`template.yaml` records contract version, plugin ID and compatibility, template ID and immutable version, title, description, parameters, payload hash, provenance, and creation time.

Template IDs and versions are immutable. Updating a template creates a new version. Projects store the exact reference and payload hash used, so later registry changes cannot silently alter an existing project.

### 7.2 Import

Template import performs path containment and symlink/junction checks, strict YAML or JSON parsing, schema validation, plugin policy validation, parameter validation, canonical serialization, and hash computation before one atomic registry write. A shared `plugin-data@1` parser profile applies to template manifests, template payloads, canonical plugin sources, and MCP proposal payloads: at most 1 MiB UTF-8, depth 64, and 50,000 scalar/container nodes, counting the document root as depth 1 and each mapping pair's value or sequence item as one node.

Budgets are enforced on parser tokens/AST before value materialization. YAML permits one document with core scalar tags only and rejects aliases, anchors, merge keys, custom tags, directives, and complex mapping keys. JSON uses a tokenizing parser rather than native `JSON.parse` and rejects duplicate keys. Both formats reject `__proto__`, `prototype`, and `constructor` mapping keys at every depth.

Importing never executes template content. A conflicting existing ID/version with a different hash is rejected; an identical import is idempotent.

### 7.3 Save from Project

Only an approved canonical plugin source may be saved as a template. The operation snapshots the approved revision, declares typed parameters, validates the resulting payload, and writes a new immutable version. Draft proposals and generated build files cannot become templates directly.

Parameters never perform textual substitution. The versioned official plugin contract, not the template, publishes the finite parameter-target allowlist. A parameter definition may select one of those RFC 6901 JSON Pointers and write a typed scalar or whole scalar array. Dynamic array indices, `-`, duplicate targets, ancestor/descendant overlaps, and decoded `__proto__`, `prototype`, or `constructor` segments are forbidden. Targets cannot address object keys, IDs, implementation/asset pins, provenance, code, markup, CSS, operators, or paths. Application first validates all parameter values, applies them structurally to a clone, revalidates the complete resolved source, and records both the immutable template payload hash and resolved-source hash.

### 7.4 Application

Applying a template creates a proposal seed. Agent-authored customization follows normal schema validation and review. A template can never directly update `project.yaml`, canonical sources, workflow approval, or exports.

## 8. Workflow

### 8.1 Initial Authoring

Insert six optional stages after `greetings_authoring` and before `content_review`:

```text
mvu_authoring -> mvu_review
ejs_authoring -> ejs_review
html_authoring -> html_review
```

The state machine skips each pair when the corresponding plugin is not resolved as enabled. HTML is one reviewed bundle containing only selected HTML capabilities.

For each enabled pair:

1. The engine creates a task with the Blueprint, upstream approved artifact references, optional template snapshot, and output contract.
2. The assigned official authoring Agent claims the task and calls leased `plugin_proposal_submit` with a typed plugin proposal.
3. Server validation checks ownership, lease, base revisions, plugin schema, dependency paths, template provenance, and policy. Submission may write only the immutable result, workflow journal event, workflow projection, and task result needed to complete authoring. It cannot modify canonical source, manifest, approved artifacts, decisions, or gates.
4. The review stage binds to that exact proposal revision and exposes semantic diff, diagnostics, generated-preview summary, and affected artifacts.
5. `plugin_review_decide` requires a server-issued one-time user-authorization envelope from the Dashboard's authenticated loopback session and CSRF boundary. After an explicit approve/reject action, Dashboard creates a 256-bit opaque token and stores only its SHA-256 plus `project_id`, proposal ID/revision, decision, workflow revision, authenticated session ID, nonce, issued time, and five-minute expiry. The decision transaction validates and consumes the record once; replay, mismatch, or expiry fails. Dashboard may call the decision service directly, or Director may relay the opaque token. The MCP input accepts no Agent-supplied `actor`, `actor_role`, envelope fields, or token-issuance operation.
6. The pending proposal also pins target source raw revision or `expectedAbsent`, manifest raw revision, dependency artifact revisions, implementation/asset pins, and pending-result hash. Under the project lock, approval rereads all inputs, reruns schema/semantic/policy validation, validates raw file compare-and-swap expectations, then atomically writes canonical source, manifest active set, `plugin-selection`, decision, artifact `plugin-<plugin-id>`, consumed authorization nonce, and workflow state.
7. Rejection records the decision and creates a bounded revision task without changing formal sources.

EJS authoring cannot start until MVU approval. HTML authoring cannot start until MVU approval when status bar is selected. Artifact IDs are exactly `plugin-official.mvu-zod`, `plugin-official.ejs`, and `plugin-official.html`. Each artifact revision is SHA-256 over RFC 8785 canonical JSON containing canonical source revision, resolved-source hash, template payload hash, implementation version and digest, and asset-manifest ID/revision/hash. The Content Gate authoritative snapshot includes approved `author-*` and these exact plugin artifact revisions. Compile Preview input revision and Publish CAS use the same values, so any pinned input change makes all prior evidence stale.

### 8.2 Revision

Add `plugin_revision_begin` for approved or published projects. The caller supplies desired selections, reason, and affected plugin IDs. The server computes the dependency closure and returns a dry-run impact report before creating tasks.

Examples:

- MVU variable rename stales MVU, EJS, status bar, and affected greeting placeholder output.
- Disabling MVU while EJS or status bar remains selected is rejected.
- A cascade disable must explicitly include EJS and status bar.
- Changing only a message-presentation template does not stale MVU or EJS.
- Disabling the last HTML capability removes `official.html` after approval.

Revision uses compare-and-swap revisions and the existing transaction journal. Previous canonical source remains active until its replacement passes plugin review approval. Previous exports remain intact until the replacement passes Content Gate, Compile Preview, and Publish Gate.

## 9. MCP and Agent Responsibilities

Add tools for:

- Listing and reading template metadata.
- Importing a template through a workspace-scoped trusted operation.
- Saving an approved plugin artifact as a template.
- Resolving feature dependencies and previewing impact.
- Beginning plugin revision.
- Validating and previewing a plugin proposal.
- Submitting an immutable pending plugin proposal through a current task lease.
- Deciding a plugin review.

Director performs intake, records explicit selections, explains automatic dependencies, routes tasks, and presents review results. Director does not author plugin content.

Official plugin authoring Agents receive only task-scoped artifacts and proposal tools. They cannot write project files, approve their own proposals, alter the manifest, import templates, or publish output.

## 10. Compile and Publish

Plugin compile runs after core planning and before CCv3 emission:

```text
Load and validate project
-> Normalize core IR
-> Plan core lore
-> Resolve active plugins
-> Compile MVU
-> Compile EJS
-> Compile HTML
-> Merge typed contributions
-> Emit CCv3
-> Audit and simulate
-> Prepare atomic publish plan
```

Strict build fails when an active source is missing, a dependency is unresolved, a contribution collides, or any plugin emits an error diagnostic. No formal output is written by build. Publish remains exclusively controlled by the existing Publish Gate transaction.

The build manifest adds exact implementation versions/digests, asset-manifest IDs/revisions/hashes, compatibility profile, source/template revisions, resolved hashes, contribution hashes, and timings. All participate in build revision and trace.

Templates cannot provide remote URLs. An official generator may emit only an exact URL listed in its versioned official asset manifest, and the URL must identify an immutable commit rather than a branch, tag, `latest`, or mutable release alias. Any other managed remote reference fails validation.

## 11. Import and Compatibility

- Existing projects parse with all Blueprint plugin options disabled by default.
- Existing `project.yaml.plugins: []` remains valid.
- Existing workflow states retain their current stage values; new stages are only entered after a new transition under the updated definition.
- Existing unknown CCv3 extensions continue through passthrough unchanged.
- Official contributions use owned namespaces and cannot overwrite unknown imported values.
- If an imported card contains recognizable MVU/EJS/HTML assets without canonical source, inspection reports them as unmanaged passthrough. Adoption into managed source is out of scope for the first release.
- A manifest that names an unknown active plugin fails explicitly; it does not silently omit output.

## 12. Diagnostics and Failure Handling

Every diagnostic contains stable rule ID, severity, plugin ID, source location or variable path, evidence, impact, and repair hint.

Required diagnostic families include:

- Dependency missing or cascade required.
- Template contract, compatibility, hash, or parameter failure.
- MVU type/default, path, constraint, or update-coverage failure.
- EJS unknown path, invalid condition, overlap, or missing fallback.
- HTML unscoped CSS, unsafe resource, unsafe binding, or missing accessibility behavior.
- Contribution ID, namespace, extension, regex, or greeting-operation collision.
- Stale proposal, source, template, compile preview, or publish revision.

Plugin task failures use the existing bounded retry and generic recovery system. A failed plugin proposal never mutates formal sources. A compile failure never replaces the previous build or export.

## 13. Security

- Resolve every project and template path through the existing containment helpers.
- Reject traversal, symlink/junction escapes, reserved names, and duplicate canonical paths.
- Parse plugin/template/source/proposal data through the shared `plugin-data@1` token/AST limits before value conversion.
- Never evaluate authored TypeScript, EJS, HTML script, or template expressions inside Forge.
- Generate Zod with the pinned TypeScript AST/printer and EJS with context-specific emitters; reparse both outputs.
- Generate HTML runtime behavior from trusted helpers and declarative actions.
- Parse HTML/CSS and enforce positive allowlists. Reject secret-like fields and every remote URL except an immutable URL owned by the selected official asset manifest.
- Keep Agent permissions task-scoped and server-authoritative.
- Apply project, workflow, and template mutations transactionally with compare-and-swap expectations.

## 14. Testing

### 14.1 Unit and Property Tests

- Blueprint defaults, dependency invariants, and active-plugin rejection for `worldbook`.
- Deterministic dependency order, missing dependencies, and cycle rejection.
- MVU variable trees, constraints, defaults, path registry, deterministic Zod generation, and hostile literal serialization.
- EJS expression generation, path resolution, boundary overlap, fallback coverage, and hostile literal serialization.
- HTML parsed allowlists, scoping, escaping, bindings, interactions, remote-resource rejection, and regex pairing.
- Contribution merge ownership and collision rejection.
- Exact CCv3 pointer mapping, deterministic managed IDs, unmanaged array preservation, and canonical greeting-ID mapping.
- Template identity, hashing, immutability, traversal defense, parser budgets, structural parameters, and idempotent import.
- Exact implementation-version resolution and official asset-manifest pinning.

### 14.2 Workflow Tests

- All-disabled flow skips every plugin stage.
- EJS and status bar automatically resolve MVU.
- Approval order is enforced.
- Pending submission cannot modify canonical source or the active manifest.
- Rejection does not mutate formal source.
- Revision impact closure and cascade disable are correct.
- Stale proposal and stale template snapshots fail closed.
- Plugin input revisions stale Content Gate, Compile Preview, and Publish Gate evidence.
- Plugin task exhaustion enters the existing recovery path.

### 14.3 Golden and End-to-End Tests

Golden projects cover every individual option and the full combination. Assert deterministic JSON and PNG payloads, exact CCv3 targets, generated entries and regex, placeholder idempotency, no prompt leakage, build trace metadata, and preservation of unrelated passthrough extensions. A `worldbook` fixture with any active first-release plugin must fail closed at project/Blueprint envelope validation and compile.

Final acceptance includes import into a pinned, controlled SillyTavern version and verifies MVU updates, EJS phase switching, all three HTML capabilities, alternate greetings, mobile layout, and prompt visibility.

## 15. Acceptance Criteria

- A user can independently select MVU, EJS, status bar, message presentation, and greeting selector during Blueprint intake.
- Dependencies are explained and enabled automatically, while invalid persisted combinations are rejected.
- Each enabled plugin produces a separate typed proposal and requires explicit approval.
- Approved canonical sources survive rebuilds and can be revised without editing generated output.
- Templates for all three plugins can be imported and created from approved sources with immutable version and hash provenance.
- A full build deterministically emits valid CCv3 JSON and PNG with working MVU, EJS, and selected HTML assets.
- Disabling or changing a plugin reports and enforces the complete downstream impact.
- Plugin or template failures cannot corrupt core project artifacts, workflow state, previous builds, or exports.
- Existing projects with no enabled plugins continue to build without migration edits.
