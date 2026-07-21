# Prototype Findings & Architectural Refinements

Based on the isolated prototype built to validate the core `YAML Module -> Merge -> Zod Validation -> Export` pipeline, the following conclusions have been integrated into our architectural strategy:

1. **Merge Strategy Specifics**:
   - The merge operation cannot be a naive object merge. It must utilize a custom strategy (e.g., via `lodash.mergeWith`).
   - **Arrays**: Must be strictly concatenated (appended). This is critical for `character_book.entries` (Worldbooks) and `alternate_greetings`, which are generated across multiple, independent module drafts.
   - **Objects**: Must be deep-merged. This is essential for `extensions` (e.g., combining `mvu` and `ejs` settings generated in separate files).
   - **Primitives**: Overwrites apply ("last writer wins"), but a detection mechanism should log `[MERGE CONFLICT]` warnings. This acts as a diagnostic tool if the LLM incorrectly hallucinates duplicate core fields (like `description`) in later modules.
2. **Schema Validation Efficacy**: The `zod` validation layer acts as an impenetrable shield. It successfully caught missing required fields (like `name`) and structurally invalid array items (like lorebook entries missing `keys`). This confirms that Stage 6 (Validation & Export) will prevent malformed cards from ever reaching the user.
