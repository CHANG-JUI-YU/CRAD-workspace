# 既有角色卡受控角色擴充設計

## 目標

允許已完成角色審查的單角色或多角色專案新增角色，同時選擇性更改專案中文顯示名稱。擴充必須保留既有專案歷史，並持續受 Task、lease、schema、CAS、provenance 與 Gates 約束。

## 識別與名稱

- `project_id`、專案資料夾、journal 身分及 export 目錄永遠不變。
- 顯示名稱可在擴充時更新。
- 名稱更新必須在同一交易同步 `project.yaml.title` 與 `project.yaml.card.name`。
- Compiler 繼續以 manifest title 作為酒館角色卡名稱。

## 公開入口

新增 Director-only `character_expansion_begin`。

輸入包含：

- workflow CAS event 欄位。
- 唯一 `run_id` 與擴充原因。
- 可選的新專案顯示名稱。
- 一個以上新角色；每個角色包含新 ID、已確認名稱、明確 `zhuji` 或 `palette` 模式、核心概念及關係摘要。
- 擴充後的完整 candidate Blueprint。
- 受影響的既有角色 artifact IDs。
- 是否需要世界設定修訂。

後端不得接受呼叫者提供任意檔案路徑或任意 Creator 身分。

## 前置條件

- 僅支援 `character_card` 專案。
- 僅允許從 `semantic_review`、`content_review`、`compile_preview`、`publish_review` 或 `published` 開始。
- 專案不得有 active task。
- 必須至少存在一個 completed Character Review。
- `run_id`、新角色 ID、Task ID 與 decision ID 不得重複。
- candidate Blueprint 必須保留既有角色 ID、模式及已確認名稱；除明確選定的受影響內容外，不得暗中移除既有角色。

## 原子啟動交易

`character_expansion_begin` 在單一 workspace transaction 中：

1. 驗證目前 manifest、Blueprint、workflow 與 exact revisions。
2. 更新 manifest title、card name 與 characters。
3. 更新正式 Blueprint，加入新角色與跨角色關係。
4. 為新角色建立 `character.yaml` 及所選模式的完整 placeholder layout。
5. 將新檔案與新 Blueprint revision 登記為 workflow artifacts。
6. 保存 typed `character.expansion.requested` decision，包含新角色、名稱變更、受影響 artifacts、世界修訂旗標及 exact input revisions。
7. 將舊 preview 標為 stale。
8. 重設 Blueprint、Content 與 Publish Gates。
9. 將 workflow 返回 `blueprint`，等待使用者批准擴充後的 Blueprint。

交易任何一步失敗時，manifest、Blueprint、角色檔案、workflow 與 journal 必須全部回滾。

## Blueprint Gate

- 擴充啟動後不得立即創作角色。
- 使用者必須核對新的專案名稱、角色清單、模式、核心概念、角色間關係及世界影響。
- 只有 Blueprint Gate 批准 exact Blueprint revision 後，runtime 才 materialize 擴充 Tasks。
- Gate 被拒絕時不得產生 Creator Tasks；後續修訂必須使用新的受控 candidate revision。

## Authoring Tasks

新角色依各自 author layout 建立線性 Task chain：

`create-character → 各模式模組順序`

既有角色採影響式同步修訂：

- 只為 `affected_artifact_ids` 建立 revision Tasks。
- 後端依 artifact path、角色 mode 與 authoritative layout 決定 Creator、module 及 target；呼叫者不得自行指定。
- Revision Task 必須以 exact正式 artifact 為基底，提交完整 replacement proposal，未受影響內容保持不變。
- 新角色與既有角色修訂完成後，建立唯一 `review-characters-<run_id>`，Character Critic 必須審查全部角色及跨角色一致性。

## 世界與開場白

- 若 `revise_world` 為 true，角色審查後建立 World Creator 與 World Critic 修訂輪次。
- 若為 false，不重作世界設定。
- 啟用 greetings 的角色卡一律建立 `revise-greetings-<run_id>`，因角色名單與互動關係已改變。
- Greetings Creator 必須提交完整 replacement，之後重新 Greetings Critic 與 Content Gate。

## 完成流程

擴充完成順序為：

`Blueprint Gate → 新角色創作／既有角色影響式修訂 → Character Review → 可選 World Revision／Review → Greeting Revision／Review → Content Gate → Compile Preview → Publish Gate → project_publish`

不得重開 completed Tasks、要求人工修改 YAML、跳過 Critics，或將 compile preview 冒充正式發布。

## 錯誤處理

至少提供穩定錯誤：

- stage 不允許。
- 專案存在 active task。
- 缺少 completed Character Review。
- 重複 run 或角色 ID。
- candidate Blueprint 與 manifest／既有角色不一致。
- 受影響 artifact 非角色 artifact、缺失、stale 或 revision 不符。
- 世界書專案嘗試新增角色。
- workflow、manifest、Blueprint 或檔案 CAS 衝突。

## 測試

- 單角色成功擴充為多角色並更改中文名稱。
- 多角色專案繼續新增角色。
- `project_id`、資料夾及 export 路徑保持不變。
- manifest title 與 card name 同步，Compiler 輸出新名稱。
- 新角色 Zhuji／Palette placeholders及Task順序正確。
- 既有角色只建立選定 artifact 的修訂 Tasks。
- Blueprint Gate 批准前沒有Creator Task。
- Character、World及Greeting reviews按條件重新執行。
- preview stale、三個 Gates重設，重新發布可原子替換並封存不同hash舊檔。
- active task、stale artifact、重複ID、非法stage及CAS衝突全部fail closed。
- transaction故障時所有正式檔案與workflow完整回滾。

## 非目標

- 不重新命名 `project_id`、專案資料夾或歷史 journal。
- 不移除既有角色。
- 不自動轉換既有角色的 Zhuji／Palette 模式。
- 不提供繞過 Blueprint Gate 的快速新增。
