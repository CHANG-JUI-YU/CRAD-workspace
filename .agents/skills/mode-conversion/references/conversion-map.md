# Conversion Map

珠璣轉調色盤時，先從七模組提取穩定核心，再分配到基礎信息、性格調色盤、三面性與二次解釋；調色盤轉珠璣時，目標固定為 `appearance`、`inner_nature`、`extension`、`trait_refinement`、`trait_dialogue`、`scene_dialogue`、`self_introduction`。每項 mapping 記錄來源欄位、目標欄位、fact refs、轉換方式與可能損失。舊來源的 `expanded_extension` 必須映射進新 `extension`，不得生成新的 `expanded_extension`；珠璣模組7永遠對應 `self_introduction`。
