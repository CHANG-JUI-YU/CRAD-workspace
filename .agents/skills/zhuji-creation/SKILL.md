---
name: zhuji-creation
description: 只在 Zhuji Creator 依已批准 Blueprint 產生珠璣模式七模組 proposal 時使用。
---

# Zhuji Creation

## Template contract

Bound kind: `zhuji`. Read the fixed contract with `workspace_template_context` and submit the validated value with `workspace_template_submit`. Keep the output focused on the template value; the runtime supplies persistence details.

## Purpose

依已確認的 Blueprint、角色核心、背景、性格、關係與事實建立珠璣模式七模組提案。訪談中的方向選項只屬於 Blueprint 意圖；珠璣不是一段自由格式文字，而是可被 Runtime 驗證、可被後續模型直接使用的角色行為模板。

## Knowledge

七個固定 module kind 與用途為：

- `appearance`：外觀、聲音、服裝與互動身體語言。
- `inner_nature`：核心人格、價值觀、驅動力、情緒、衝突與經歷。
- `extension`：社會身分、背景、生活、人際關係、對 user 的互動與私人空間。
- `trait_refinement`：把人格標籤拆成 5 至 8 個可觸發、可觀察的特質。
- `trait_dialogue`：特質對應的說話節奏、語言習慣、即時語料與結果。
- `scene_dialogue`：不同場景、情緒、對象與關係階段的演出語料。
- `self_introduction`：最後依 Blueprint 與前六個模組生成的角色第一人稱常態自我介紹；不是訪談答案，也不是 greeting。

每個模組都要服務同一個角色核心，並保持聲線、關係與界線一致。除第一個模組外，提交前必須讀取前一個或多個已完成模組的 exact context；不得跳過順序。

## Contract

- 先呼叫 `workspace_zhuji_context`，取得目前 JSON Schema、required sections、寫作指南與既有 module instances。
- 每次只產出一個 `{ kind: "zhuji", character_id, module }` proposal，使用 `workspace_zhuji_submit` 寫入。
- `module.schema_version` 固定為 `1`，`module.mode` 固定為 `zhuji`；`module.module` 只能是上述七個 kind。
- 引擎會拒絕缺少 module、錯誤 kind、缺少 required sections、trait_dialogue 少於 5 個 Traits 或不符合語料規則的 proposal。
- 可在 `extensions` 增加不影響核心的補充，但不可用 extensions 取代 required sections。

## References

- [`generation-guide.md`](references/generation-guide.md)：生成順序與跨模組一致性。
- [`module-appearance.md`](references/module-appearance.md)、[`module-inner-nature.md`](references/module-inner-nature.md)、[`module-extension.md`](references/module-extension.md)：前三個核心模組。
- [`module-trait-refinement.md`](references/module-trait-refinement.md)、[`module-trait-dialogue.md`](references/module-trait-dialogue.md)：特質與語料模組。
- [`module-scene-dialogue.md`](references/module-scene-dialogue.md)、[`module-self-introduction.md`](references/module-self-introduction.md)：場景與自我介紹模組。

## Quality

- 已確認資料、合理推論與創作延伸要清楚區分。
- 不捏造來源，不宣稱 proposal 已批准或發布。
- 不讓單一模組引入與其他模組衝突的新設定。
- 成人向內容遵守 personality 與專案安全規則。

## Interaction

非核心細節由模型安全補完；會改變角色身份、關係或界線時才提出一個簡短問題。

## Output

輸出七模組 proposal、依據、假設、待審查事項與可選替代方案。
