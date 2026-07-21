# Workflow Routing

固定 vocabulary 為 intake、source_processing、facts_review、blueprint、pre_world_authoring、pre_world_review、authoring、semantic_review、post_world_authoring、post_world_review、greetings_authoring、content_review、compile_preview、publish_review、published。Engine 依 Blueprint 跳過不適用階段。`before_characters` 必須完成 World Creator 與 World Critic task 後才進入角色 authoring；`after_characters` 必須先完成所有角色與 Character Critic task，才建立 World Creator 與 World Critic task；disabled 跳過四個 world stages。所有路徑都在相關 Critic task 真正完成後才可進入 greetings，世界與角色絕不並行。獨立 worldbook 走 pre-world 兩階段且不要求 characters。

`workflow_start` 只有在使用者明確確認沒有其他設定需要增加或補充，且 `intake_completion` 已保存後，才依入口 definition 從 intake 推進至其下一個實際階段、初始化 gates，並只建立該階段的正式 tasks。原創入口會直接進入 blueprint，由 Director claim `create-blueprint`；不得在 intake 將角色 Creator 當作替代啟動器。

目前 stage 的所有 task 完成且必要 gate 已由使用者批准後，呼叫 `workflow_advance` 一次。不得用 `project_plan`、重複 `workflow_start` 或猜測其他工具代替推進；engine 會依正式 Blueprint 的每角色 mode、world.enabled 與 world.authoring_timing 建立唯一下一階段 tasks。舊 Blueprint 啟用 world 但缺 timing 時，engine 確定性採 `after_characters`。

Facts、Blueprint、Content、Publish 四道 gate 由使用者決定。原創的 Facts gate 只能由 engine 記錄明確 `not_required` decision。Creator/Critic 最多自動修訂兩輪，之後呈現 `needs_user_decision`。任何 artifact revision 改變後重新讀 status，不沿用舊 review、preview 或 approval。

Director核對既有內容或review evidence時，先以 `project_artifact_list` 取得受控artifact ID、kind、status與exact revision，再以 `project_artifact_read` 讀取單一內容。這是所有stage皆可用且不需task/lease的純唯讀路徑；不得把artifact ID當檔案路徑，也不得以 `workflow_status`、聊天記憶或其他Agent代替內容核對。

`card_import` 在 Blueprint 階段先由 Director 對明確單檔路徑執行 `card_inspect_local`，再由 Card Import Analyst 以正式 `analyze-import` task+lease 讀 inspection 並提交分析。Director 讀取合併報告後必須用 `question` 取得四選一 disposition。`corrected_copy` 只輸出 deterministic canonical V3 至受控 exports；它與 `retain_report`、`cancel` 都會關閉 workflow。`full_rebuild` 只建立 `create-blueprint` task，提交後仍停 Blueprint gate。`mode_conversion` runtime 仍不可執行。

`source_adaptation`路徑為intake source保存（可選Source Researcher模型聯網discovery與候選登錄 -> Director exact revision approval -> Researcher controlled fetch）-> `source_processing`的task-bound chunk/job/candidate curation -> `facts_review` -> exact Facts Gate -> Blueprint -> 共用authoring tail。Research snippet只屬discovery metadata；Director只讀status與批准，Researcher只登錄搜尋候選及擷取已批准candidate。`facts_review_status`是Director-only無task唯讀入口，只列最新completed curation summary的active candidates，並回傳品質diagnostics、角色coverage與`gate_ready`；orphan與舊run batches只保留歷史。Gate approval必須使用其目前Fact/Conflict Register exact refs，未裁決candidate、未拒絕的不合格candidate、角色coverage不足、open conflict、無效projection或stale refs都會fail closed。若最新`curate-facts`已completed但品質不足，Director可在`facts_review`使用`facts_recuration_begin`保留predecessor，以current exact source inputs建立`curate-facts-recurate-<run>`並回到`source_processing`；新run identity強制建立不同extraction jobs，Facts與全部downstream gates回到pending，舊review與refs不可沿用。Exhausted curation只由`source_processing_repair_begin`保留舊task並建立受控successor；repair lineage最多兩代，第二代只處理第一代遭已修正orchestration/tool contract defect阻斷的情況。

既有角色卡的 Character Expansion V2 由 `character_expansion_begin` 只寫 immutable `.workflow/candidates/character-expansion/**` candidate 與 workflow state；正式 manifest、Blueprint、placeholder、relationships、reviews、gates、previews 在批准前不得被候選污染。拒絕後以同 run 的 `character_expansion_blueprint_update` 產生下一 immutable candidate；Blueprint Gate 批准 exact candidate/base CAS 時才在單一交易 materialize，下一次 advance 才建立 Creator tasks。既有 V1 materialized run 保留明確 legacy branch且不自動改寫。

所有 Gate 只接受 engine-derived authoritative exact snapshot。Facts reject 路由 audited recuration；普通 Blueprint reject 建立唯一 successor；Content reject 必須以單一呼叫提交 exact scope、run ID及必要artifact IDs，並原子建立修訂Tasks；Publish reject 只允許 `repreview|content_revision|cancel`。Preview 僅能從 `compile_preview`、approved exact current Content snapshot 建立。

多人角色卡訪談必須詢問是否啟用 project-level relationships；啟用時可選完整 roster 或至少兩人的 participant subset，並將 exact IDs 寫入 Blueprint `relationships.character_ids`。Engine 只在 enabled 時建立 mode-neutral `create-relationships`，且等待每位 participant 的最後 required mode module；非 participant 不構成依賴。Director委派 `relationship-creator`，其只提交 structured `relationships` proposal，不可要求 thinking、roleplay或 `<team_CODE>` 編譯標記。Character Critic 的 exact inputs 必須包含 `relationship_module`。

`character_revision_begin` 可直接選 `author-relationships.yaml`，會建立 Relationship Creator 修訂 task並重置下游 review/gates。Expansion candidate 可啟用或調整 participants；若新建、participant set 改變或 `affected_artifact_ids` 明列 relationship artifact，Blueprint Gate 後才建立 relationship task。既有啟用狀態不可在 expansion 中刪除，team_code 必須保留。

既有世界條目修訂使用 `world_revision_begin`，只接受目前有效 world artifact 的 exact IDs，且必須已有 completed World Review、沒有 active task。`pre_world_review` 發起時回到 `pre_world_authoring`，修訂後重跑該 World Review再繼續尚未完成的角色流程；其他允許階段回到 `authoring`，依序重跑 Character Review、World Review及必要 Greetings/Content/Preview流程。`world_authoring_begin` 僅是 published專案補世界入口，不得用於修改既有條目。

`retryable`表示正常attempts尚未耗盡，由原assigned Agent重新claim。Terminal `failed`只有在typed category為`provider_timeout|tool_failure|context_limit|session_interruption|temporary_unavailable`時，Director才可用`task_recovery_begin`建立一次`max_attempts: 1`的same-snapshot successor；Engine保留並supersede原Task，原子重接pending direct dependents。Completed內容修改仍走專用revision工具。Successor再失敗、`needs_user_decision`、semantic/validation/revision/policy/artifact integrity failure皆不得再recovery。

唯一successor進入`needs_user_decision`後，只有在底層專案缺陷已由使用者修復且正式validation通過時，Director才可呼叫一次`task_repair_resume`。它續接同一Task並保留attempt/recovery lineage；不是第二代recovery。續接後再次失敗即停止。
