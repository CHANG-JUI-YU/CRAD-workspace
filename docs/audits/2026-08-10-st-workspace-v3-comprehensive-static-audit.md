# ST-workspace-v3 完整靜態稽核報告

- 稽核日期：2026-08-10
- 稽核版本：Git HEAD fbdfba1
- 稽核範圍：packages、tools、.agents、CLI、HTTP/MCP server、Dashboard、專案儲存與 materialization、訪談、來源與事實、authoring/review、workflow gate、mode conversion、CCv3/PNG compiler、plugin compiler、import/build/publish，以及相關 README、設計文件、schema 與測試程式碼
- 方法：逐層靜態追蹤資料流與狀態轉換，並用文件、schema、既有測試案例交叉核對
- 限制：依要求沒有執行 build、typecheck 或任何測試，也沒有修改任何程式碼。因此本報告能確認「從程式碼可直接證明」的缺陷與合約落差，但不宣稱列出了所有只會在實際環境出現的相容性問題。

## 一、總結結論

ST-workspace-v3 已不是空殼。它目前確實具備專案 materialization、訪談、Blueprint/precheck、四級 quality profile 資料模型、來源擷取、結構化事實候選與裁決、typed proposal、review record、mode conversion、CCv3 JSON envelope、PNG chara metadata、世界書與衣櫃打包等主要骨架。

但目前還不能判定為「該有的功能都可靠完成」。比較準確的狀態是：

> 可進入全新專案的人工監督測試；尚不適合把完整自動工作流、發布 gate、跨實例交易、崩潰復原與 plugin 執行視為可靠完成品。

最需要優先處理的不是再加更多角色欄位，而是六個會破壞現有主流程的問題：

1. OpenCode/MCP 路徑把建立者與 reviewer 都記成同一個 opencode actor，正常 creator → critic 流程可能被判定為自我審查。
2. quality profile 的 warning/info 雖名義上不阻斷，review 卻會成為 partial，而 publish gate 只接受 passed，四級 profile 因而無法真正控制發布。
3. publish gate 沒有依 Blueprint 驗證每個角色的選定模式、完整模組、relationships、world.enabled 與 authoring timing。
4. 新式 JSON 珠璣／調色盤模組在編譯時只留下 leaf value，欄位名稱與層級會遺失；Blueprint 中的 label 也沒有被解析成角色顯示名稱。
5. 檔案交易具有 CAS 與程序內 queue，但不是完整 crash-atomic transaction；特定 rename 失敗點甚至會讓原檔已移到 backup、回滾清單卻不知道它存在。
6. operation worker 沒有跨實例 lease/claim，且 operation 沒保存 typed proposal 或附件；同步請求、worker 與崩潰復原之間可能競跑或無法正確重播。

因此，如果目標是「你自己慢慢實測」，目前可以開始；但建議先把本報告 P0 項目修完，再信任審查結果、正式發布與資料耐久性。

## 二、此次確認「已經有做」或符合目前決策的部分

以下舊缺口已全部或部分補上，不應再沿用舊結論：

- fact_review 已不只是 schema：KnowledgeService 已能建立 Review Run、保存 reviewer decision，並把 candidate occurrence 投影為 accepted、rejected、needs_evidence 或 conflict。剩餘問題是識別、證據、衝突解決與狀態邏輯。
- 自動事實抽取已具有 subject、predicate、value、classification，不再只是單一 statement 形狀。
- review proposal 會進入 ReviewService，能建立 ReviewRecord 與 IssueRecord；問題是 actor 身分與 quality gate 語意。
- Blueprint precheck 與 none/light/normal/strict quality level 已有資料模型和部分 runtime 行為，不再完全缺席。
- NUL 判定已採比例而不是「出現一個 NUL 就判二進位」。
- mode conversion 已能生成另一模式的 typed target artifact；問題是來源歷史、完整性與 Blueprint binding。
- 卡片 name 使用專案名稱、description/personality/scenario 等核心欄位留白、greeting 綁在卡片、世界書名稱使用「專案名稱_世界書」、Blueprint 與 accepted facts 不進世界書，均符合目前已批准的打包設計，不列為 BUG。
- 世界設定、角色模式模組、relationships 與 wardrobe 已有世界書投影；wardrobe 條目名稱可形成「角色名_衣櫃」。
- CCv3 JSON 基本 envelope 與 PNG chara tEXt metadata 是實作，不再只是副檔名假裝。
- 建立新專案時已有 .workspace、blueprint、characters/character-id-名字、world、relationships、greetings、plugins、exports 等 materialized 結構方向。

## 三、現有 BUG 與功能合約缺口

### 分級定義

- P0：會阻斷正常主流程、破壞資料一致性或讓公開宣稱的核心保證失效；應在擴大實測前處理。
- P1：在常見工作流可重現，會造成錯誤產物、永久 gate、不可恢復操作或顯著誤導。
- P2：邊界條件、擴充性、效能、安全或較低頻流程問題；值得修，但可排在主流程後。

### P0：正常工作流與資料安全

#### BUG-01：MCP actor 身分讓 creator 與 critic 變成同一人

證據鏈：

- tools/opencode-mcp.ts:55-58 啟動整個 server 時固定 actor 為 opencode。
- packages/server/src/index.ts:408-410、452-454 將同一 actor 傳給所有 template submit。
- packages/domain/src/authoring.ts:154-169、218-234 把該 actor 存成 artifact.created_by。
- packages/domain/src/review.ts:97-103、190-195 禁止 created_by 與 reviewer actor 相同。
- packages/domain/src/workflow-gate.ts:207-219 又要求所有目前內容產物都有 passed review。

影響：即使 OpenCode 依序使用 creator 與 critic agent，domain 層仍只看到同一個 opencode，critic proposal 可能被 REVIEW_SELF_BLOCKED 拒絕；最後 publish 永遠缺 passed review。

建議：把「人類／session actor」與「實際 agent identity」拆開。artifact.created_by 與 review.reviewer 應記錄已解析的 agent_id，另保留 initiated_by/session actor；server 也應驗證 agent capability，而不是只接受一個全域 actor。

#### BUG-02：quality profile 實際上不能放行 warning/info

- packages/domain/src/review.ts:126-127、223-224：只要有任何 issue，即使最高只有 info 或 warning，review.status 都是 partial。
- packages/domain/src/workflow-gate.ts:207-219：publish 只接受 review.status === passed。
- 因此 none/light/normal/strict、blocking_severity 與 severity override 尚未真正控制「能否發布」；先被 passed-review 條件擋住。
- IssueStatus 雖有 resolved/ignored，公開服務沒有完整的 resolve/ignore/override 操作；finding.overridable 也沒有成為可執行授權。
- packages/core/src/templates.ts:302-307 的 review finding severity 又不允許 critical，和 light 只阻擋 critical 的設定不一致。

影響：一個不阻斷的文字建議也能永久卡住發布；四級品質設定對使用者看似可調，實際效果近乎單一 strict。

建議：review 的「品質結果」與「是否符合目前 profile」分離。Gate 應依 effective severity、issue status 與 profile snapshot 判斷，而不是只看 passed；補上明確 resolve、ignore、override API 和審計。

#### BUG-03：publish gate 沒有執行 Blueprint 選定的工作流

packages/domain/src/workflow-gate.ts:447-484 目前主要檢查一般 artifact/review/fact/source 狀態，但沒有完整檢查：

- 每個 Blueprint roster character 是否存在正式顯示名稱。
- 每個角色的 selected mode 是否存在，且該模式的必需模組是否全部完成。
- relationships.enabled 時是否真的有目前 Blueprint revision 對應的 relationship artifact。
- character Blueprint 的 world.enabled 與 world.authoring_timing；目前只在 interview.flow === world 時要求 world artifact。
- primary character、必要 greeting、選定 export mode 與要審查的 artifact 集合。
- 只選珠璣或只選調色盤打包時，未選模式的舊 artifact 是否仍不應阻擋發布。

影響：工作流一方面可能太嚴格地被無關 artifact 卡住，另一方面又能在角色只有第一個模式模組、缺 relationships/world 的情況下發布不完整卡片。

建議：新增從 latest approved Blueprint 產生的「required artifact manifest」，所有 authoring、review、build、publish 都只使用同一份 manifest。

#### BUG-04：JSON 模組編譯遺失欄位語意

packages/compiler/src/index.ts:284-317 的 flattenText 對物件遞迴時只收 leaf value，且排序後串接；key、標題和巢狀層級都不保留。新專案的珠璣 module.data 與調色盤 module.sections 走這條路，而 legacy YAML parser 反而保留 title/data 結構。

影響：例如身高、髮色、界線、語氣、偏好等值會變成一串脫離欄名的文字；世界書仍「有內容」，但模型無法知道每個值代表什麼，這是實際的語意損失。

建議：各 typed module 應有顯式 renderer，輸出穩定的 Markdown headings/labels；不要用通用 leaf flattener 代替語意編譯。

#### BUG-05：Blueprint label 沒有進入角色名稱解析，primary character 也靠排序猜測

- runtime 生成的 Blueprint character 形狀是 id + label（packages/runtime/src/index.ts:333-353）。
- compiler 的 characterDisplayNames 只讀 Character artifact 的 document.display_name，或 legacy YAML Blueprint 的 display_name（packages/compiler/src/index.ts:192-211、255-269）。
- primaryCharacterIdFor 則取字典序最前的 id（packages/compiler/src/index.ts:556-562）。

影響：正常新式 JSON Blueprint 若沒有額外 Character artifact，條目會使用 character-1 或內部 id，而不是訪談標籤；多人卡代表角色也可能選錯。

建議：Blueprint schema 增加並統一 formal display_name；明確保存 primary_character_id，compiler 不再推測。

#### BUG-06：FileProjectRepository 不是完整的 crash-atomic transaction

packages/core/src/index.ts:1244-1291 的流程是逐一：

1. 寫 staging。
2. 把 target 移成隨機 .bak。
3. 把 staged file rename 成 target。
4. 完成後逐一刪 backup。

可確認的缺陷：

- 在 target 已移到 backup、staged rename 失敗時，applied.push 尚未執行（1270-1272），catch 不知道目前這一筆 backup，原 target 可能消失並留下孤兒 .bak。
- backup 在整個交易完全穩定前逐一刪除（1279-1281）；清理中途失敗時，先刪掉的 backup 已無法用來完整回滾。
- state 與所有 materialized/export files 是逐檔 replace；程序在中途 crash 可留下新 state 搭配部分舊輸出。
- 沒有 durable transaction journal、startup recovery 與目錄 fsync。
- lock 的 stale 判定固定 30 秒且沒有 heartbeat（1366-1407）。合法交易若超過 30 秒，另一實例可刪除仍在使用的 lock。
- relocate 只有 repository instance 內 queue，沒有同等的跨實例 project lock（1043-1061）。

影響：README 所稱的 atomic file commit 與跨實例 CAS 只在短時間、正常結束的情況部分成立，無法涵蓋崩潰與長交易。

附註：lock 位於 packages/core/src/index.ts:1069-1071 所示的 OS Temp/st-workspace-v3-locks；Temp 目前只用於跨程序 lock，不是角色創作內容的工作目錄。

#### BUG-07：worker 沒有 lease，可能和同步請求或另一實例重複執行

- server 啟動時自動啟動 worker（packages/server/src/index.ts:279-282）。
- runtime 先保存 created/resolving operation，再於另一個 commit/步驟執行。
- worker 會拾取 created、resolving、running operation（packages/runtime/src/index.ts:691-716；packages/runtime/src/worker.ts:131-170）。
- 沒有 owner token、lease expiry、compare-and-claim 或 idempotency key。

影響：同步 request 還在執行時，worker 可能同時 recover 同一 operation；多 server instance 更容易重複擷取來源、建立 artifact 或發布。

其他 worker 問題：

- 所有錯誤都進 retry，沒有區分 recoverable 與永久輸入錯誤。
- results Map 在 job 完成後不刪除（worker.ts:102-119），長時間運行會累積。
- stop 不等待 in-flight work；成功後也未一致清除 last_error。

建議：operation 增加 lease_owner、lease_token、lease_expires_at、attempt 與 idempotency key；只有原子 claim 成功者可以執行。

#### BUG-08：operation 復原無法重播 typed proposal 與附件

- submitTemplateProposal 建立的 operation 只保存類似「create kind」的自然語言 request，沒有保存 proposal payload（packages/runtime/src/index.ts:933-1017）。
- recoverOperation 對 authoring 會重新走一般 authoring.create，對 review 會走規則式 review，而不是重播原 proposal（701-780）。
- worker 復原永遠傳 attachments: []（packages/runtime/src/worker.ts:164-170）。
- proposal 的 domain mutation 與之後保存 technical artifact 是分開 commit。

影響：崩潰後無法正確恢復 character/zhuji/review/fact_review proposal，也無法恢復來源附件；可能留下「domain 已套用、technical artifact 未保存」或反向的半套狀態。

建議：operation 保存 versioned typed command payload 與持久附件 reference；domain mutation、technical record、audit 和 operation completion 應在同一 use-case transaction 內提交。

#### BUG-09：assisted precheck confirmation 會覆蓋整份 audit 歷史

packages/runtime/src/index.ts:582-601 在確認 precheck 的 commit 中寫 audit: [new events]，沒有展開 current.audit。相同檔案其他 commit 都使用 [...current.audit, ...]。

影響：一次正常的協助創作確認就能刪除先前所有 audit event，破壞追溯與除錯。

建議：這是明確的一行級資料破壞 BUG，應優先修復並補 migration/偵測工具確認既有專案是否已遭截斷。

### P1：常見工作流錯誤

#### BUG-10：實際顯示的「沒有，開始建立」無法完成訪談

- 選項定義於 packages/core/src/interview.ts:193。
- choice validator 會接受完整選項。
- isNo 只接受精確的「沒有／不要／不需要」等（79-80），不接受「沒有，開始建立」。
- transition 在 442-445 因而進 supplement，不是 complete。

影響：使用者點擊介面原樣提供的選項，卻被要求繼續補充。現有測試若只傳「沒有」會漏掉這個整合缺陷。

#### BUG-11：多人訪談不是逐角色訪談，且「正式命名稍後」沒有後續問題

目前 roster/mode 是 per-character，但 concept、background、personality 仍是全專案單一回答。runtime 又把同一批回答套入每個角色的 precheck，可能把所有角色誤判為 core/background/personality 已明確。

同時 roster 問題把名稱描述為暫時標籤，卻沒有真正的 per-character formal name 步驟；單人預設甚至只是「角色」。

影響：多人卡可能得到多個模式方向，卻共用同一份角色核心；後續 compiler 也缺可靠顯示名稱。

#### BUG-12：assisted precheck 不是逐項確認

高影響但缺少資料的 check 會統一標記為 pending confirmation；runtime 用一個總確認回答一次套用全部 pending checks，沒有逐角色／逐維度展示與回答，也不會因回答更新 candidate Blueprint。

影響：「協助創作」看似有 precheck，實際不能釐清每一個高不確定、高影響問題。

#### BUG-13：continue、legacy review、expansion 與 existing-world 多半只是訪談外殼

- continue 收集 project/path，engine 本身不完成 project selection。
- legacy review 保存路徑字串，沒有真正載入 PNG/JSON/YAML 或呼叫 ImportService。
- character expansion 從 fresh interview/default character 開始，沒有可靠綁定現有 roster 與 Blueprint。
- 「既有專案補世界」若未由 Director 外部攔截，也可能落入新專案 manager。

OpenCode prompt 可以補部分 orchestration，但 Dashboard/直接 API 沒有同等能力，因此同一功能在不同入口行為不一致。

#### BUG-14：world timing 與 source-adaptation policy 只保存或被硬編碼

- 獨立 world flow 的 worldConfig 會強制 before_characters，可能忽略訪談回答。
- world.authoring_timing 沒有成為 runtime branch 或 gate 條件。
- source adaptation 的 canon_policy 固定為 canon_inspired（packages/runtime/src/index.ts:166），雖然型別支援其他策略。
- 二創多人卡仍只有一份 subject/medium/identifier，無法表達不同作品來源的角色。

#### BUG-15：自動抽取的 fact 在 strict path 幾乎無法 accept

packages/domain/src/knowledge.ts 的自動 sentence candidate 雖已有結構欄位，但 coverage 預設為空；strict acceptance 又要求 coverage 非空，review decision 沒有可修補 coverage 的欄位。

影響：自動抽出的候選可以被拒絕或要求證據，卻很難走到 accepted；「自動抽取 → reviewer 裁決 → 創作上下文」主鏈中斷。

#### BUG-16：fact review schema、狀態機與衝突流程不一致

- factDecisionSchema 讓 fact_id 與 candidate_occurrence_id 同時 optional，但 strict runtime 需要 occurrence id。
- schema 欄位是 evidence，template guide 範例卻使用 evidence_refs（packages/core/src/templates.ts:390-401、578），strict schema 會拒絕自己的範例。
- Review Run status 的 completed/blocked 條件排列使 blocked 幾乎不可達：有 needs_evidence/conflict 時「全部 accepted/rejected」不成立。
- 已 settled occurrence 在競態時會 throw 並中止整批，而設計文件期待跳過 settled 並繼續其他項目。
- conflict 沒有公開 Director resolve 操作；普通 reviewer 又被禁止覆寫 conflict。
- 沒有實作 accepted facts 間 subject+predicate 矛盾的自動 conflict 偵測。

影響：三 reviewer 身分雖已建模，但完整裁決閉環仍會卡在證據或 conflict。

#### BUG-17：user-provided accepted fact 的 provenance 例外無效

packages/domain/src/workflow-gate.ts:251-260 先允許 evidence 文字標記為 user/manual/provided，但下一步仍無條件要求 evidence_refs 非空。沒有來源 reference 的使用者明示事實仍被判 unproven。

#### BUG-18：拒絕 source-research candidate 仍可能永久卡 publish

workflow-gate 對每個 source_research proposal candidate 只判斷是否已 ingest（packages/domain/src/workflow-gate.ts:91-108），沒有把 state.candidate.status === rejected 視為已解決。

影響：使用者正確拒絕低品質來源後，該 proposal 仍報 SOURCE_RESEARCH_NOT_INGESTED。

#### BUG-19：SourceService.execute 使用全專案 approved 候選，非 operation snapshot

packages/domain/src/index.ts:273 之後的 execute 會讀取全域 approved candidates，而不是只執行該 operation 的 selection snapshot；並行 execute 可讀到相同候選並各自 ingest，transaction commit 時沒有重新驗證目前 candidate 已被其他 operation ingest。

影響：重複 SourceRecord、重複知識抽取與來源／operation 歸屬錯亂。

#### BUG-20：來源擷取有 SSRF、timeout 與記憶體風險

packages/adapters/src/index.ts:29-38：

- 只驗證初始 host；fetch 預設跟隨 redirect，沒有驗證 final URL。
- allowedHosts 預設可空，沒有 private/loopback/link-local IP 與 DNS rebinding 防護。
- 沒有 timeout/AbortSignal。
- 缺 Content-Length 時先 arrayBuffer 整份 response，之後才可能檢查大小。

在 localhost 自用模式風險較低，但只要 server 能接收不可信 URL 或改綁非 localhost，就可能讀取內網服務或耗盡記憶體。

#### BUG-21：UTF-8 解碼與 knowledge chunking 會靜默破壞來源

- decodeText 使用非 fatal UTF-8 decoder；Big5/Shift-JIS 等內容可能變成 replacement character 而不是明確失敗。
- knowledge chunk 固定按 800 個 JS code unit 切割，可切斷句子與 surrogate pair。
- sentenceCandidates 只取前 100 句，長來源會靜默截斷。
- refresh 可重建重複 chunk；語意去重會丟掉第二來源的佐證，而不是合併 evidence。
- applyCuration 建立 chunk 後回傳 chunks: []，回應和狀態不一致。

#### BUG-22：typed schema 可被 generic Markdown authoring 繞過

packages/domain/src/authoring.ts 的 free-text authoring 只明確阻擋部分種類；Character、World、Greeting、Relationship、Palette、Plugin 等仍可能被建立成不符合 typed schema 的 Markdown artifact。

影響：gate 可能把它當正式 content artifact 要求 review，compiler 卻無法解析；甚至能發布空白或缺模組卡片。

建議：正式 kind 一律只允許 typed proposal；自由文字只能進 draft_note/brief 等非發布種類。

#### BUG-23：Blueprint revision binding 不完整

Zhuji/Palette/Wardrobe 有部分 binding，但 Character、World、Greeting、Relationship、Plugin 沒有一致綁定 approved Blueprint revision；gate 也沒有驗證。

影響：修改 Blueprint 後，舊角色設定、世界、關係或 greeting 仍可被當作目前版本發布。

#### BUG-24：build 的 mode 與 preview 狀態有語意錯誤

- packages/domain/src/build.ts:109 的 both 可用性檢查只檢查 Zhuji，Palette 缺少時 compiler 可靜默降級。
- preview 有 blocking diagnostics 時 BuildRecord.status 記 failed，但 operation 仍 completed 並回覆 Preview complete。
- export suffix 依「專案裡是否存在任一 Zhuji artifact」而不是本次選定模式，混合專案選 Palette 仍可能得到珠璣命名。

這些問題不一定破壞 CCv3 格式，但會讓使用者誤認本次到底打包了什麼。

#### BUG-25：plugin compiler 仍沒有真正可執行的 plugin

packages/plugins/src/index.ts 目前產生的是安全、可序列化的描述資料，但不是實際 runtime：

- MVU helper script 是 JSON manifest，沒有 state initialization、typed update、path runtime 或實際執行入口。
- EJS condition 被寫成世界書中的字面「[when ...]」文字，沒有條件 evaluator。
- HTML 只有 greeting_selector 路徑把 markup 加到 greeting；status_bar/message_presentation 沒有可見注入位置。
- helper script 同樣只是 JSON manifest，repo 內沒有 consumer。
- 多個 binding path 會生成重複 data-cw-bind attribute（packages/plugins/src/index.ts:101-106），HTML 行為不可靠。

結論：目前可以稱為「plugin proposal 編譯成受控 manifest」，不能稱為「真正生成並可在 SillyTavern 執行的 MVU/EJS/HTML plugin」。

#### BUG-26：ImportService 與訪談宣稱的格式不一致

訪談表示可審核 PNG/JSON/YAML，但 packages/domain/src/import.ts 只讀第一個 attachment、以 UTF-8 當 JSON 解析：

- PNG adapter 沒接入 import。
- YAML 未解析。
- 標準 CCv3 的 data.name 不一定被 artifactName 讀到。
- 匯入內容被原樣存成 kind=character artifact，不是內部 Character schema，compiler 可能忽略。
- 額外 attachments 被忽略，原始 binary bytes 也未可靠保存。

這不是目前自用原創／二創建立流程的最高優先，但「舊卡審核／匯入」仍屬未完成。

#### BUG-27：project rename 與 legacy migration 可留下不一致

- ProjectManager finalize 先把 state.project_id 改成目標，再執行未受同一 transaction 保護的 filesystem relocate；rename 失敗時，舊資料夾裡的 state 已宣稱新 id。
- select 用 state.project_id 重建 repository，而不是實際 folder basename；上述不一致會被放大。
- listProjects 會用可 materialize 的 repository.read，因此「列出專案」可能觸發 migration/reconcile 寫入；損壞專案又被空 catch 靜默隱藏。
- legacy migration 把 exports 視為 legacy entry，卻先 materialize 新 state/output，再搬走整個 exports，可能連剛生成的最新輸出一起移到 archive（packages/core/src/index.ts:1154-1177）。

### P2：邊界、維護與長期運行

#### BUG-28：state 與輸出會快速膨脹

每次 build 把完整 card JSON 放進 BuildRecord.canonical_ir；publish 又保存 JSON 與 PNG base64，之後整份 state 再寫進 .workspace/workflow.json，並另外 materialize exports。長期反覆打包會多重複製大 payload，導致每次 commit 都重寫越來越大的 state。

建議：state 只保存 content hash、相對路徑、大小與必要摘要；大型 binary/compiled payload 使用 immutable blob/object store。

#### BUG-29：PNG 邊界相容性

- 沒有使用者圖片時固定建立 1×1 透明 PNG；格式有效，但不是可用的角色卡封面。
- PNG reader 對所有既有 tEXt chunk 用嚴格 ASCII 解碼；PNG tEXt text 可含 Latin-1，其他軟體寫入的合法非 ASCII metadata 可能讓 embedding 失敗。

#### BUG-30：mode conversion 使用所有歷史 revision

conversion sourceArtifacts 收集所有歷史 artifact，不是每個 key 的 latest；proposal 只要求至少一個 target module，沒有檢查完整來源／目標模組集；生成 target 也未一致綁定 Blueprint。已發布專案即使做 no-op/重複 conversion，仍可能被改回 ready。

#### BUG-31：pending operation 續接範圍過窄

runtime 對 needs_input 的自動續接主要處理 source/build；其他 operation 可被留在 needs_input。又因「最新 pending operation」可能攔截下一段自然語言，使用者原本想開始的新命令可能被當成舊操作回答。

#### BUG-32：server input/error 邊界不足

- request body 無上限；attachment base64 驗證寬鬆。
- malformed JSON 多數會變成 500，而非 400。
- REST 與 MCP 重複大量 dispatch 邏輯，錯誤分類不一致。
- server 可設定非 localhost，但沒有 authentication/authorization；若未來外部綁定，任何可連線者都能修改專案。

#### BUG-33：agent 權限目前多為描述性 metadata

- read_only 與 capability 沒有在 submit/runtime 層強制執行。
- unknown explicit agent 會 fallback 到其他 agent，而不是清楚報錯。
- agent router 依關鍵字 regex 排序，混合意圖容易誤路由。
- runtime registry、.agents/registry.yaml、aliases.yaml、opencode.jsonc 重複維護同一組 agent；agent-lint 尚未把它們變成單一來源。

#### BUG-34：Artifact key 與 review key 有碰撞／殘留風險

- Character key 使用 display name 而非 document.id；改名會建立新 logical key，舊角色仍留在 latest 集合。
- review technical artifact key 沒完整包含 target id/revision，可能碰撞。
- review、fact_review、source 等已在 domain state 有正式 record，之後又保存 technical artifact，造成重複表示與 gate/列表雜訊。

#### BUG-35：semantic CAS 不完整

多個 service 先讀 initial 做目標選擇與規則判斷，之後再讀 latest revision 並 commit。這能避免單純檔案 revision conflict，卻可能把基於舊 artifact/source/fact 的決策套到新 state。CAS 應保護「判斷依據的版本」，不只是最後一次 state revision。

## 四、以程式碼精簡化來說，值得修正的地方

精簡化不應只追求檔案變少；目前最值得做的是減少「同一規則散落多份」與「一個檔案承擔多種生命週期」。以下按效益排序。

### REF-01：拆分 core/src/index.ts 與 runtime/src/index.ts

目前兩個檔案分別約 1,700 與 1,500 行，混合：

- state/schema/validation
- repository transaction/lock/migration/materialization
- export naming
- interview orchestration
- operation creation/recovery
- template dispatch
- status formatting

建議拆為 state、repository、transaction-journal、materializer、migration、export-store，以及 interview-use-case、proposal-use-case、operation-recovery、status-projection。這不只是美觀；能避免修 transaction 時意外碰 export path，或修訪談時破壞 recovery。

### REF-02：建立單一 RequiredArtifactManifest

目前 Blueprint、authoring 順序、review、gate、compiler、build 各自推測需要哪些角色／模式／模組。應由一個純函式從 approved Blueprint + export selection 產生 manifest：

- character_id/display_name/primary
- selected mode
- required module keys
- world/relationship/greeting/wardrobe/plugin requirements
- required revision bindings
- review targets

其餘服務只消費 manifest，可同時修掉大部分 gate 與編譯分歧。

### REF-03：建立共用 Module Descriptor Registry

珠璣／調色盤的模組 id、中文名稱、順序、schema、creator、critic、compiler renderer、gate requirement 分散在多個 package。用一份 typed descriptor registry 生成：

- proposal schema routing
- 訪談／任務順序
- 中文世界書條目名稱
- compiler renderer
- mode completeness diagnostics
- agent capability

可以大幅降低新增模組或改中文名稱時的漂移。

### REF-04：REST、MCP、CLI 共用 command dispatcher

server 目前 REST 與 MCP 各寫一套路由，CLI 又再寫巢狀 if/else。應先解析成 versioned WorkspaceCommand，再由單一 dispatcher 執行；各介面只處理 transport、actor/session、附件與錯誤映射。

### REF-05：agent registry 改成單一真實來源

建議以一份 machine-readable registry 生成 runtime TS、OpenCode agent config、aliases 與 lint expectations。不要人工同步四份 23-agent 清單。

### REF-06：typed command 取代不可重播的自然語言 operation

自然語言可以保留為原始 request，但 persisted operation 應保存已解析的 command payload。這會同時簡化 router、worker、retry、recovery、audit 和 idempotency。

### REF-07：統一 compiler pipeline

compileProject 與 compileWorkspaceBundle 是兩條有重複規則但功能不對稱的路徑；legacyArtifactEntries 與手寫 YAML parser 又混在主 compiler。建議：

1. legacy adapter 先轉成同一份 canonical typed IR。
2. 所有來源都走一個 semantic compiler。
3. JSON/PNG 只是在同一 IR 後面的輸出 adapter。

### REF-08：移除 generic typed authoring 與 technical artifact 重複表示

正式 schema kind 只走 template proposal；一般 authoring 改成 note/brief。ReviewRecord、FactReviewDecision、SourceRecord 已足夠時，不必再假裝成可發布 artifact，除非它有獨立版本／下載需求。

### REF-09：集中 latest projection/selectors

目前各 service 自行 reverse/find、Map by key、latest by array order，容易對「最新」「目前」「已批准」有不同定義。建立 selectors：

- latestArtifactByKey
- latestApprovedBlueprint
- currentReviewForRevision
- currentFactDecisionByOccurrence
- currentSourceSelection

並要求回傳 basis revision/hash，供 semantic CAS 使用。

### REF-10：把 migration/list/read 副作用分離

listProjects 應純讀；migrate、repair、reconcile 應是明確命令並回報做了什麼。這會讓專案列表更可靠，也讓資料修復可稽核。

### REF-11：降低 package 反向耦合

adapters 只為 FetchResult/SourceFetcher 型別依賴 domain。這類 transport port 可移到 core/contracts，避免基礎 adapter 反向依賴較高階業務 domain。

### REF-12：刪除或隔離死路徑

值得清理的項目包括：

- 新流程到不了的 self_introduction interview state。
- work_type 中已被 validator 排除、transition 卻仍保留的 source-adaptation 舊分支。
- compiler 中未使用或只服務舊 bundle 的 ArtifactParts/core-field 路徑。
- 未使用的世界設定 allowlist 常數。
- 同功能不同命名的 legacy compatibility helper。

先標記 legacy boundary，再刪除，避免把相容性程式和正式流程混在一起。

## 五、以使用者體驗來說，可改良的地方

目前 Dashboard 更接近開發者 console：一個文字框、agent 欄與簡單 status。若要讓你長期自用，最有價值的不是華麗介面，而是讓「現在在哪一步、缺什麼、打包了什麼」永遠看得見。

### UX-01：專案首頁與明確 project switcher

顯示專案名稱、狀態、Blueprint revision、角色清單、目前 mode、最後輸出與未完成 operation。continue/expansion/world addition 都從選定的專案開始，而不是靠自然語言猜路徑。

### UX-02：把訪談變成結構化表單

- 使用真正的 choice button，提交 canonical value，不再把完整顯示文字交給 regex。
- 多人卡逐角色顯示正式名稱、別名、創作來源、模式、核心、背景、個性。
- 最後提供回答摘要與「返回修改」，再確認建立。

### UX-03：可視化 Blueprint precheck

以角色 × 維度矩陣顯示：

- 已由使用者明示
- agent 推定
- 高影響待確認
- 已確認
- 對哪些 downstream artifacts 有影響

每一項獨立確認，不用一個「全部同意」吞掉差異。

### UX-04：Publish readiness 頁

把 gate diagnostics 轉成可操作清單：

- 缺哪個角色的哪個模組
- 哪個 artifact review 未通過
- 哪個 issue 可 override
- 哪個 fact 缺證據／有 conflict
- 哪個來源被拒絕但已解決
- 點擊後直接前往相應 artifact 或動作

### UX-05：Artifact 工作台

提供 current revision、Blueprint binding、creator、reviewer、狀態、diff、歷史 revision、重新生成／手動修改／送審。現在資料雖存在，使用者很難知道哪個才是正式最新版。

### UX-06：真正可操作的 quality profile

在 UI 清楚顯示 none/light/normal/strict 各自阻擋哪些 severity；每個 issue 有 resolve、ignore、override 按鈕、理由欄和審計紀錄。發布預覽要顯示本次 effective policy snapshot。

### UX-07：來源與事實審查板

來源候選分 approved/rejected/failed/ingested；facts 分 candidate/needs evidence/conflict/accepted/rejected。每個 fact 顯示 quote、source version、chunk locator、reviewer 與將被哪些 creator 使用。

### UX-08：每次打包前的明確選擇與語意預覽

延續你已決定的「每次詢問」：

- 本次選珠璣、調色盤或兩者
- primary character
- world/relationship/wardrobe/greeting/plugin 條目清單
- 世界書名稱與每個 entry 的實際名稱
- 卡片核心欄位確實留白
- greeting/alternate/group-only 的實際位置
- 預估 token 數與 PNG 圖像

不要只顯示 Build complete；要顯示輸出完整路徑與可直接開啟的檔案。

### UX-09：operation 與復原可視化

顯示 queued/running/needs input/retrying/failed、attempt、lease owner、最後錯誤；允許取消、重試、捨棄舊 pending operation。避免下一句自然語言被看不見的舊 operation 攔截。

### UX-10：錯誤訊息改成「原因 + 影響 + 下一步」

例如不是只顯示 ARTIFACT_REVIEW_REQUIRED，而是：

「一條桃華_外觀目前 revision abc123 尚未由不同 reviewer 通過。請送交 Zhuji Critic，或返回修改。」

保留 error code 供除錯，但正常介面用中文與可操作連結。

### UX-11：安全的專案修復入口

專案清單不要靜默隱藏損壞資料。顯示「需要 migration／materialization mismatch／orphan backup」，提供先預覽、再修復；任何修復都生成報告。

### UX-12：Tavern 相容性檢查

打包後提供一個不需 LLM 的靜態 compatibility summary：

- CCv3 spec/version
- PNG chara chunk 可否解回相同 JSON
- character_book 名稱與 entry 數
- greeting 欄位數量
- 角色圖尺寸
- plugin 所需 extension/runtime

這不能取代你在 SillyTavern 的實測，但能先擋掉結構型錯誤。

## 六、以角色卡設計來說，值得加入的功能／設定

以下是產品功能建議，不是現有 BUG。依你「專案內創作、自用、資訊主要綁世界書」的方向排序。

### CARD-01：明確 primary character 與卡片代表

多人卡必須保存 primary_character_id，並允許選：

- 卡面名稱／頭像代表誰
- greeting 的預設視角
- 哪些條目屬於全體、哪些只屬於指定角色

不能依 character id 字典序猜測。

### CARD-02：正式名稱、別名、讀音與稱呼規則

每個角色加入：

- display name
- aliases／原文名
- pronunciation
- 不同人物對她的稱呼
- 模型對 user 的稱呼

這些資料同時用於世界書 keywords，能比只用單一中文名稱提高觸發可靠性。

### CARD-03：角色圖像／封面管線

建立或打包時可選圖片、裁切比例、預覽、替換，保存來源與使用權註記；PNG export 使用真正角色圖，不再是 1×1 透明圖。

### CARD-04：世界書 entry activation policy

每個條目可設定：

- primary/secondary keys
- constant 或 selective
- enabled
- position/order/depth
- probability
- regex
- token budget
- 與哪些角色／場景／greeting 綁定

目前固定 enabled、after_char、非 regex 的單一策略對大型卡不夠。

### CARD-05：二創的「原作事實 vs 個人詮釋」雙層模型

每個關鍵設定標記：

- canon fact
- canon inference
- personal interpretation
- intentional divergence
- unknown/ambiguous

並能記錄「此處刻意偏離原作的理由」。這比只在整個專案設一個 canon_policy 更符合你說的「最後會成為我內心中的形象」。

### CARD-06：Greeting 套件管理

現有 primary/alternate/group_only 欄位可再補：

- 中文標題
- 適用角色與關係階段
- 場景／時間／地點
- POV、人稱、語言
- content rating
- 排序與啟用
- 預覽渲染

這些 metadata 不一定要全部輸出到世界書，但應協助挑選與維護。

### CARD-07：使用者角色與互動契約

為每張卡明確定義：

- user 在世界中的身分／未知程度
- 角色與 user 的初始關係
- 可否替 user 決定行動或內心
- 敘事人稱與回覆長度
- 主動性、節奏、衝突偏好

這通常比再增加外貌欄位更直接影響實際聊天品質。

### CARD-08：關係的階段與弧線

現有 relationships 偏靜態總覽。可加入：

- 初始狀態
- 信任／親密／衝突階段
- 轉換觸發
- 每個角色對同一事件的不同認知
- 不可逆事件與界線

若未來 MVU runtime 真正完成，再選擇性把階段狀態接到 MVU；沒有 runtime 時仍可作為條理化 lore。

### CARD-09：內容尺度、界線與版本 profile

目前部分珠璣欄位天然偏成人向，但訪談只在使用者明示時才問。建議使用 project/card profile：

- general / mature / explicit
- romance/violence/sensitive topic boundaries
- fade-to-black 規則
- 不同 export profile 是否排除敏感模組

不要把成人欄位強迫填滿，也不要靠空字串猜測使用者意圖。

### CARD-10：角色聲線樣本與一致性預覽

除了 personality，保存少量「應該怎麼說／不應該怎麼說」對照、常用句式、禁用口癖、情緒下的語氣變化。打包前可產生純預覽，不必新增硬編碼 review 規則。

### CARD-11：Token/context 預算

對每個世界書條目與整張卡顯示估計 token，允許設定：

- 核心常駐預算
- 角色模組預算
- 世界／衣櫃／關係預算
- 超額時優先裁切順序

大型多人卡或雙模式打包尤其需要。

### CARD-12：Export compatibility profile

保存目標：

- SillyTavern 版本／CCv3
- JSON 或 PNG
- 是否包含特定 plugin runtime
- 是否允許 group-only greetings
- 世界書 entry policy

同一專案可有多個 export profile，但每次打包仍由你確認。

### CARD-13：版本說明與回滾

每次正式發布記錄：

- 版本名稱
- 變更摘要
- 使用的 Blueprint/artifact revisions
- export profile
- 與上一版的條目差異

提供「以舊 revision 重建」，不要把完整 binary 全塞進 state。

### CARD-14：多語言與 keyword 同義詞

二創角色常有中文、日文、英文與不同譯名。世界書 entry 可將別名當 secondary keys，正文仍只保留使用者選定語言；避免因對話使用原文名而不觸發角色條目。

## 七、建議修正順序

### 第一批：在擴大實測前

1. BUG-01 actor/agent identity。
2. BUG-02 quality profile 與 review/publish 語意。
3. BUG-04、BUG-05 compiler 的欄位標籤、角色名稱、primary character。
4. BUG-03 Blueprint-derived required manifest 與 mode completeness gate。
5. BUG-06 transaction rollback、journal、heartbeat。
6. BUG-07、BUG-08 operation lease 與 typed recovery。
7. BUG-09 audit overwrite。
8. BUG-10 實際訪談選項。

### 第二批：確保二創與多人主流程

1. BUG-11、BUG-12、BUG-14：逐角色訪談、正式命名、precheck、canon/personal interpretation。
2. BUG-15 至 BUG-19：facts/source 的接受、衝突與 rejected candidate 閉環。
3. BUG-22、BUG-23：typed artifact 與 Blueprint binding。
4. BUG-24：build selection 與 preview 結果一致。
5. BUG-27：project rename/migration。

### 第三批：完成公開宣稱功能

1. BUG-25 真正 plugin runtime。
2. BUG-26 PNG/JSON/YAML import 與語意映射。
3. BUG-28 至 BUG-35 的長期運行、安全與維護問題。
4. Dashboard/UX 工作台。

由於你目前主要是專案內自創／二創，ImportService 可排在 plugin、compiler、gate 與資料安全之後；但 README 應在完成前明確標示它是 partial。

## 八、未來實作測試矩陣

本次沒有執行測試。修正後建議至少增加以下整合／故障注入案例：

1. 真實 OpenCode MCP：creator 建 artifact → critic review → publish gate。
2. none/light/normal/strict 各自遇到 info/warning/error/critical。
3. UI 原樣提交「沒有，開始建立」。
4. 兩角色、不同正式名稱、不同模式、不同 personality/background。
5. 新式 JSON 珠璣／調色盤編譯後保留每個欄名與章節。
6. mixed mode 專案分別選 Zhuji、Palette、both；確認檔名、條目與 gate。
7. relationships/world enabled/disabled/timing 的 required manifest。
8. 在每個 backup/rename/delete 邊界注入 crash/error，重啟後驗證 state 與 materialized files 一致。
9. 兩個 process 同時 commit，以及交易超過 30 秒時 lock 不被偷走。
10. typed proposal 與 attachment 在 operation 中途 crash 後正確重播且不重複。
11. source candidate reject 後可發布；兩個 execute 不會重複 ingest。
12. user-provided fact、auto-extracted fact、needs evidence、conflict、Director resolve。
13. Big5/Shift-JIS、長來源、redirect 到 private IP、無 Content-Length 大 response。
14. PNG/JSON/YAML import 後都轉成相同 canonical IR。
15. 真實 SillyTavern smoke test：載入 PNG、世界書觸發、primary/alternate/group-only greeting，以及每一種官方 plugin 功能實際執行。

## 九、README／設計宣稱與目前實作的落差

| 宣稱方向 | 目前靜態結論 |
|---|---|
| atomic file commit / cross-instance CAS | 有 lock、revision CAS、staging/backup；但無 heartbeat/journal/crash recovery，且 rollback 有遺漏點。屬部分完成。 |
| failure recoverable operation | 一般自然語言操作部分可重跑；typed proposal 與 attachment 不可正確重播，也無 lease。屬部分完成。 |
| quality profile | 四級資料模型存在，但 publish 仍以 passed review 一刀切，實際阻斷策略未完成。 |
| fact-review identities | 三個 reviewer 身分與 Review Run 已建模；MCP actor 未傳遞 agent identity，conflict resolve/證據閉環未完成。 |
| real plugin generation | 現為受控 manifest/lore/markup 投影，沒有可執行 MVU/EJS/HTML runtime。 |
| JSON/PNG compiler | CCv3 envelope 與 PNG metadata 已實作；typed module 語意渲染、正式名稱與 primary character 仍有錯誤。 |
| PNG/JSON/YAML import | 目前主要是第一個 attachment 的 JSON parse，PNG/YAML 與 canonical mapping 未完成。 |
| workflow gate | 有集中 diagnostics；但尚未由 Blueprint 生成完整 required set，quality/source 邏輯也有永久阻斷。 |

## 十、最終判定

### 1. 現有工作區是否有 BUG？

有，而且包含會阻斷正常審查／發布、破壞 audit、產生語意錯誤世界書，以及在 crash/並行時破壞一致性的高優先缺陷。不是只有 UI 細節。

### 2. 程式碼精簡化是否值得做？

值得，但應以「單一規則來源」為核心，不是單純縮短程式。最高效益是 RequiredArtifactManifest、Module Descriptor Registry、單一 command dispatcher、單一 agent registry、typed persisted operation，以及統一 compiler IR。

### 3. 使用者體驗是否還能改良？

可以，而且目前差距很大。最重要的是 project/workflow dashboard、逐角色訪談、可操作 gate diagnostics、artifact/review/fact/source 工作台，以及每次打包前的實際內容預覽。

### 4. 角色卡設計還能加入什麼？

最值得先加的是 primary character、正式名稱／別名、真實角色圖、世界書 activation policy、二創 canon-vs-personal-interpretation 分層、greeting 套件、user interaction contract、關係階段與 token/export profile。

整體而言，V3 的「精簡骨架」方向是合理的；目前主要問題不是缺更多抽象層，而是幾個跨層合約沒有接到底。先把 actor → review → gate、Blueprint → required artifacts → compiler，以及 operation → transaction → recovery 三條主鏈閉合，V3 才會從「可測試原型」進入「可靠自用工具」。
