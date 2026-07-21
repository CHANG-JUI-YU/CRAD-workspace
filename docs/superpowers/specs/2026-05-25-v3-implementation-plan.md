# Implementation Plan: SillyTavern V3 Character Generation Workflow (Strict Specification)

This plan outlines the step-by-step implementation of the new V3 architecture, breaking down the work across the MCP server, the new Agent, and the generative Skills.

## Phase 1: Foundation (The `st-forge` MCP Server)

The foundation of the system is the robust TypeScript MCP server that handles all I/O and strict schema validation.

### Step 1.1: Initialize MCP Server Project
1. Navigate to `mcp-servers/st-forge`.
2. Initialize a new Node.js project (`npm init -y`).
3. Install required dependencies: `@modelcontextprotocol/sdk`, `zod`, `yaml`, `typescript`, `@types/node`, `png-chunks-extract`, `png-chunk-text`, `png-chunks-encode`, `lodash`.
4. Set up `tsconfig.json` for compilation.
5. Create the basic MCP server boilerplate in `src/index.ts`.

### Step 1.2: Define V3 Zod Schemas
1. Create `src/schemas/v3.ts`.
2. Define strict `zod` schemas for the core character card structure, including `extensions` (MVU, EJS).
3. Export the schemas and TypeScript types.

### Step 1.3: Implement `validate_schema` Tool
1. In `src/tools/validate.ts`, implement the logic to receive a JSON/YAML string and parse it against the V3 schema.
2. Register this tool in the MCP server instance.

### Step 1.4: Implement I/O Tools (`init_workspace`, `write_draft`)
1. Create `src/tools/io.ts`.
2. Implement `init_v3_workspace`: Creates the visible `drafts/` directory (avoiding hidden dot-directories for Windows user visibility).
3. Implement `write_yaml_draft`: Receives a `moduleName` and `content`. It must read the `drafts/模組0_概覽.yaml` budget for that module, calculate the length of the incoming content, and throw a strict MCP error if it exceeds the budget. If within budget, it writes to `drafts/`.

### Step 1.5: Implement Assembly Tools (`import_card`, `export_card`)
1. Create `src/tools/assembly.ts`.
2. Implement `import_chara_card`: Reads an existing PNG/JSON, extracts text fields, and writes them as raw text files into `drafts/`.
3. Implement `merge_and_export`: Reads the 7 strict module drafts (`模組1_外顯.yaml` through `模組7_自我介紹.yaml`) from `drafts/`, compiles them into a beautiful, structured V3 character card JSON (with appropriate markdown description blocks, custom personality summary, scenario dialogue as message examples, and self-introduction as first message), merges extensions, runs a final validation against SillyTavern V3 schema, and writes to the `exports/` folder.

### Step 1.6: Register MCP Server
1. Update `opencode.jsonc` at the workspace root to register the new `st-forge` MCP server. During development, use `npx tsx` pointing directly to the `src/index.ts` file to allow for rapid iteration without manual build steps.

## Phase 2: Generative Skills (`st-creator-skill` & `st-critic-skill`)

With the MCP foundation solid, we rebuild the prompt logic and externalize the rules.

### Step 2.1: Extract and Refine Creator Rules
1. In `.agents/skills/st-creator-skill/references/`, create the strict modular rule files:
   - `module-appearance.md` (模組1_外顯)
   - `module-inner-psychology.md` (模組2_內質)
   - `module-social-background.md` (模組3_外延)
   - `module-relationship-expansion.md` (模組4_外延擴展)
   - `module-trait-refinement.md` (模組5_特質細化)
   - `module-scenario-dialogue.md` (模組6_場景語料)
   - `module-self-introduction.md` (模組7_自我介紹)
2. Ensure each markdown file acts as a standalone, highly focused prompt snippet.

### Step 2.2: Draft `st-creator-skill/SKILL.md`
1. Write the main skill prompt.
2. Instruct the LLM on how to read the `references/` directory.
3. Define the instruction constraint: "You must only generate content for the module requested, follow its specific reference file, and immediately use the `write_yaml_draft` tool to save it."

### Step 2.3: Extract Critic Rules and Draft Skill
1. In `.agents/skills/st-critic-skill/references/`, populate `anti-ai-guidelines.md` with known AI-isms and OOC patterns.
2. Draft `st-critic-skill/SKILL.md`.
3. Explicitly define the mandatory output format as the structured JSON diagnostic report: `{"passed": boolean, "violations": [{"module": string, "quote": string, "suggestion": string}]}`.

## Phase 3: The Director Agent (`st-director.md`)

Finally, we construct the brain that glues everything together into the 7-stage state machine.

### Step 3.1: Draft the State Machine Prompt
1. Open `.opencode/agent/st-director.md`.
2. Define the Agent's Persona: A workflow controller managing the V3 generation pipeline.
3. Embed the 7 stages (Stage 0 to Stage 6) directly into the prompt as strict instructions.
4. Define the User Gates explicitly ("You MUST pause and wait for user confirmation before proceeding past Stage X").

### Step 3.2: Wire up the Tools and Skills
1. Instruct the Director on *when* and *how* to invoke the `st-forge` MCP tools.
2. Instruct the Director on how to command the Creator skill (passing the Blueprint).
3. Instruct the Director on how to invoke the Critic skill, parse its JSON output, and manage the `Retry Counter` (max 2).

### Step 3.3: Handle Edge Cases
1. Add rules for User Overrides in Gate 2 (bypassing the Critic).
2. Add rules for On-Demand Extension generation (only triggering EJS/MVU creation if explicitly requested).

## Phase 4: Integration and Testing

1. Launch opencode using the new `st-director.md` agent.
2. Run a "from scratch" character generation test to verify the User Gates, the Blueprint YAML generation, and the linear expansion.
3. Intentionally inject an "AI-ism" into a draft and verify the Critic catches it, outputs the JSON, and the Director routes it back for a retry.
4. Verify the final export passes the strict V3 validation.
