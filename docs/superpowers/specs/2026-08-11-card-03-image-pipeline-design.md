# CARD-03 角色圖像／封面管線設計（V3.14）

- 日期：2026-08-11
- 範圍：packages/adapters-png/src/index.ts、packages/core/src/index.ts、packages/runtime/src/index.ts、packages/compiler/src/index.ts、packages/domain/src/build.ts、packages/server/src/{index.ts,dashboard.ts}、測試（adapters-png/server/runtime/build-import）
- Commit：`V3.14: 實作 CARD-03 角色圖像管線(DS)`

## 背景

audit CARD-03：「建立或打包時可選圖片、裁切比例、預覽、替換，保存來源與使用權註記；PNG export 使用真正角色圖，不再是 1×1 透明圖。」現況：compileProject（compiler/src/index.ts:850）呼叫 `writeCardToPng(undefined, card)`——undefined 時 adapters-png 自建 512×768 灰色佔位圖（createBasePng，adapters-png:118-137）。writeCardToPng 已支援透傳 input 圖像（保留圖像 chunk、只替換 tEXt 卡片 metadata，185-204），但整條管線沒有任何圖片輸入端點。

## 設計

### 1. adapters-png：圖像資訊與 cover 裁切

- `readPngImageInfo(input): PngImageInfo | undefined`：IHDR 解析 {width, height, bit_depth, color_type, interlace}；非 PNG 簽名→undefined。
- `cropPngCover(input: Uint8Array, aspectRatio: string): Buffer`：cover 語意（不縮放，裁掉多餘邊）：
  - 只支援 bit_depth 8、color_type 2(RGB)/6(RGBA)、interlace 0；否則 throw CoreError("CARD_IMAGE_FORMAT_UNSUPPORTED", "角色圖只支援 8-bit RGB/RGBA 的非交錯 PNG", true)。
  - 尺寸上限 2048×2048（CARD_IMAGE_TOO_LARGE）。
  - aspectRatio 格式 /^(\d+):(\d+)$/；目標比 = w/h；原比 > 目標比 → 裁寬（cropWidth=round(height*r)、offsetX 置中）；否則裁高（offsetY 置中）。
  - 流程：parsePngChunks 合併 IDAT → inflateSync → 依 scanline（1+width*bpp）逐 row 解 filter（0-4：None/Sub/Up/Average/Paeth）還原 raw pixels → 裁切 → 全 filter 0 re-deflate → 重組 PNG（IHDR 新尺寸＋IDAT＋IEND，無 tEXt）。
  - 依賴 zlib（Node 內建，adapters-png 已用 deflateSync）。

### 2. core：ImageRecord＋state.images

- `export interface ImageRecord`：{id, character_id?, blob_hash, media_type: "image/png", width, height, aspect_ratio?, crop: {width, height, offset_x, offset_y} | undefined（存裁剪前的原尺寸＋裁切幾何）, source?, license?, created_at, updated_at, created_by?}。
- ProjectState 加 `images: ImageRecord[]`；stateSchema 加 images zod（array min 0）。舊 state 遷移：read 時缺欄位補 []（createProjectState 與 migrate 已有預設模式，需確認）。

### 3. runtime：ImageService 或 WorkspaceRuntime 方法

- `setProjectImage(context, { character_id?, aspect_ratio?, source?, license? }): Promise<{image_id, width, height}>`：
  - context.attachments 須恰一筆且 media_type image/png（或簽名檢查）→ 無→CARD_IMAGE_REQUIRED；多筆→CARD_IMAGE_MULTIPLE。
  - 簽名驗證（pngSignature）＋readPngImageInfo；aspect_ratio 給定→cropPngCover。
  - blob_hash=contentHash(bytes)；writeBlob；commit images append（character_id 同角色時先清舊？不——保留歷史，選圖取最新）。
- `getProjectImage(imageId): Promise<{media_type, content: Uint8Array} | undefined>`：readBlob。
- `removeProjectImage(imageId): Promise<void>`：images 移除（blob 保留）。
- `dashboardSnapshot` 加 images: Array<{id, character_id?, width, height, aspect_ratio?, source?, license?, created_at}>。

### 4. compiler＋build：PNG export 用真正角色圖

- compiler CompileOptions 加 `image?: Uint8Array`；compileProject 850 行 `writeCardToPng(options.image, card, ...)`。
- build.ts：compileProject 前，若 state.images 非空→選圖（綁定 primary character 的最後一筆，否則最後一筆）→ `await this.repository.readBlob(image.blob_hash)`（遺失→build 照常，加 diagnostic CARD_IMAGE_MISSING？保守：遺失時不傳圖並在 diagnostics 加 warning）→ compileProject(initial, { mode_selection, image })。注意 compileProject 呼叫處為 sync，readBlob 需在 compile 前 await。

### 5. server 端點＋dashboard

- `POST /workspace/images`：{character_id?, aspect_ratio?, source?, license?}＋attachments（既有 attachmentsFrom base64）→ setProjectImage → {image_id, width, height}；無 attachment→400 CARD_IMAGE_REQUIRED。
- `GET /workspace/images/<id>`：getProjectImage → image/png 回傳；無→404。
- `POST /workspace/images/remove`：{image_id} → removeProjectImage → {status:"removed"}。
- `POST /workspace/images/replace`：{image_id, aspect_ratio?, source?, license?}＋attachments→更新既有 ImageRecord（同 set 邏輯＋移除舊的 images 條目）。— 為簡化，替換=DELETE 舊＋POST 新，以 remove＋set 組合即可，dashboard 提供兩按鈕。若時間允許補 replace 端點。**定案：不另做 replace 端點；dashboard 的「替換」＝上傳新圖（同 character_id 時選最新）。**
- dashboard.ts：新 images-panel（images 清單：width×height/aspect/source/license/縮圖 `<img src="/workspace/images/<id>">`＋移除按鈕＋上傳表單（character_id、aspect_ratio select 1:1/2:3/3:4/9:16/16:9/free、source、license、attachment file input→base64）＋預覽）。維持無 innerHTML（img 用 makeElement＋setAttribute）。
- server 端點註冊加入 dashboard.test.ts 端點字面。

### 6. Tavern 相容性

- tavernCompat() 報告加：latest.publish png blob 尺寸（readPngImageInfo）與「角色圖」判斷（尺寸非佔位 512×768 或存在 images 綁定）。

## 測試策略

- adapters-png：cropPngCover（RGB/RGBA、裁寬/裁高、filter 0 與非 0、無裁切（同比例）、格式不支援、尺寸上限）、readPngImageInfo。
- runtime：setProjectImage（PNG 驗證/裁切/commit images）、getProjectImage、removeProjectImage、dashboardSnapshot images。
- build-import：compileProject 帶 image 後 png blob 尺寸變為原圖尺寸（非 512×768）。
- server：POST/GET/remove images 端點（base64 PNG fixture 用 adapters-png encodePngChunk 產最小 RGBA PNG）。
- 全量 pnpm build+typecheck+vitest+agent:lint 全綠 → commit「V3.14: 實作 CARD-03 角色圖像管線(DS)」。

## 驗證

pnpm build、pnpm typecheck、pnpm vitest run（319 基準）、pnpm agent:lint。
