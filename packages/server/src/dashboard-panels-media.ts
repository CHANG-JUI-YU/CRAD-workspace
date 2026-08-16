export const DASHBOARD_PANELS_MEDIA_JS = `      function removeImage(imageId, button) {
        var confirming = false;
        return function () {
          if (!confirming) {
            confirming = true;
            button.textContent = "再次點擊確認移除";
            button.setAttribute("aria-label", "再次點擊以確認移除圖片 " + imageId + "。此操作可能使未完成的發布確認失效。");
            window.setTimeout(function () {
              confirming = false;
              button.textContent = "移除";
            }, 4000);
            return;
          }
          postImageRemove(imageId);
        };
      }

      function renderImageUploadOptions(roster, primaryCharacterId) {
        var select = byId("image-character");
        var current = select.value;
        var rosterList = Array.isArray(roster) ? roster : [];
        while (select.options.length > 1) select.remove(1);
        for (var i = 0; i < rosterList.length; i += 1) {
          var entry = rosterList[i];
          if (!isRecord(entry)) continue;
          var option = document.createElement("option");
          option.value = firstString(entry, ["id"]) || "";
          var label = firstString(entry, ["label"]) || firstString(entry, ["id"]) || "";
          if (firstString(entry, ["id"]) === primaryCharacterId) label += "（primary）";
          option.textContent = label;
          select.append(option);
        }
        var restored = false;
        for (var j = 0; j < select.options.length; j += 1) {
          if (select.options[j].value === current) {
            select.selectedIndex = j;
            restored = true;
            break;
          }
        }
        if (!restored) select.selectedIndex = 0;
      }

      function parseRatio(ratio) {
        var parts = typeof ratio === "string" ? ratio.split(":") : [];
        var width = parseFloat(parts[0] || "");
        var height = parseFloat(parts[1] || "");
        if (!(width > 0) || !(height > 0)) return undefined;
        return { width: width, height: height };
      }

      function renderCropPreview() {
        var container = byId("image-crop-preview");
        container.textContent = "";
        var fileInput = byId("image-file");
        var file = fileInput.files && fileInput.files.length > 0 ? fileInput.files[0] : undefined;
        var ratio = parseRatio(byId("image-ratio").value);
        if (file === undefined || !file.type || file.type.indexOf("image/") !== 0) {
          container.hidden = true;
          return;
        }
        var image = new Image();
        var url = URL.createObjectURL(file);
        image.onload = function () {
          var naturalRatio = image.naturalWidth / image.naturalHeight;
          var canvas = document.createElement("canvas");
          var maxWidth = 480;
          var scale = Math.min(1, maxWidth / image.naturalWidth);
          canvas.width = Math.round(image.naturalWidth * scale);
          canvas.height = Math.round(image.naturalHeight * scale);
          var ctx = canvas.getContext("2d");
          ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
          if (ratio !== undefined) {
            var currentRatio = image.naturalWidth / image.naturalHeight;
            var cropWidth = 0;
            var cropHeight = 0;
            var offsetX = 0;
            var offsetY = 0;
            if (currentRatio > ratio.width / ratio.height) {
              cropHeight = image.naturalHeight;
              cropWidth = cropHeight * ratio.width / ratio.height;
              offsetX = Math.floor((image.naturalWidth - cropWidth) / 2);
            } else {
              cropWidth = image.naturalWidth;
              cropHeight = cropWidth * ratio.height / ratio.width;
              offsetY = Math.floor((image.naturalHeight - cropHeight) / 2);
            }
            var sx = offsetX * scale;
            var sy = offsetY * scale;
            var sw = cropWidth * scale;
            var sh = cropHeight * scale;
            ctx.strokeStyle = "#1d6fb8";
            ctx.lineWidth = 2;
            ctx.strokeRect(sx, sy, sw, sh);
            ctx.fillStyle = "rgba(29,111,184,0.12)";
            ctx.fillRect(sx, sy, sw, sh);
            canvas.setAttribute("data-crop", "1");
            var sizeText = document.createElement("div");
            sizeText.className = "muted";
            sizeText.textContent = "裁切輸出約 " + Math.round(cropWidth) + "×" + Math.round(cropHeight) + "px（依內建封面裁切規則置中）";
            container.append(canvas, sizeText);
          } else {
            var plainText = document.createElement("div");
            plainText.className = "muted";
            plainText.textContent = "原始尺寸 " + image.naturalWidth + "×" + image.naturalHeight + "px，不裁切";
            container.append(canvas, plainText);
          }
          container.hidden = false;
          URL.revokeObjectURL(url);
        };
        image.onerror = function () {
          container.textContent = "無法讀取圖片預覽。";
          container.hidden = false;
        };
        image.src = url;
      }

      function coverReasonText(reason) {
        if (reason === "explicit") return "使用者明確選擇";
        if (reason === "primary") return "主要角色候選";
        if (reason === "global") return "全域候選";
        if (reason === "placeholder") return "預設佔位圖";
        return "自動選擇";
      }

      function renderImageList(images, roster, primaryCharacterId, activeCover) {
        var target = byId("image-list");
        target.textContent = "";
        var list = Array.isArray(images) ? images : [];
        var cover = isRecord(activeCover) && isRecord(activeCover.identity) ? activeCover.identity : undefined;
        var coverImageId = cover && cover.mode === "uploaded" && typeof cover.image_id === "string" ? cover.image_id : undefined;
        target.textContent = list.length === 0 ? "沒有角色圖像。" : "角色圖像 " + list.length + " 筆";
        renderImageUploadOptions(roster, primaryCharacterId);
        if (cover !== undefined) {
          var coverRow = document.createElement("div");
          coverRow.className = "fact-row";
          var coverText = document.createElement("span");
          if (cover.mode === "uploaded" && coverImageId !== undefined) {
            coverText.textContent = "目前發布使用：" + coverImageId + "（" + coverReasonText(cover.selection_reason) + "）";
          } else {
            coverText.textContent = "目前發布使用：預設佔位圖（" + coverReasonText(cover.selection_reason) + "）";
          }
          coverRow.append(coverText);
          target.append(coverRow);
        }
        for (var i = 0; i < list.length; i += 1) {
          var image = list[i];
          if (!isRecord(image)) continue;
          var row = document.createElement("div");
          row.className = "fact-row";
          var imageId = firstString(image, ["id"]) || "";
          var isActive = imageId !== "" && imageId === coverImageId;
          if (isActive) {
            var badge = document.createElement("span");
            badge.className = "status-badge ready";
            badge.textContent = "目前發布使用";
            row.append(badge);
          }
          var preview = document.createElement("img");
          setProtectedImageSource(preview, "/workspace/images/" + imageId);
          preview.setAttribute("alt", "角色圖預覽");
          preview.className = "image-thumb";
          var text = document.createElement("span");
          var parts = [];
          var width = typeof image.width === "number" ? image.width : NaN;
          var height = typeof image.height === "number" ? image.height : NaN;
          parts.push(isNaN(width) || isNaN(height) ? "?×?" : width + "×" + height);
          if (image.aspect_ratio) parts.push("裁切 " + image.aspect_ratio);
          var characterId = typeof image.character_id === "string" ? image.character_id : undefined;
          if (characterId !== undefined) {
            var isPrimary = characterId === primaryCharacterId;
            parts.push(isPrimary ? "角色 " + characterId + "（primary）" : "角色 " + characterId);
          } else {
            parts.push("封面圖");
          }
          if (image.source) parts.push("來源：" + image.source);
          else parts.push("來源未註記");
          if (image.license) parts.push("授權：" + image.license);
          else parts.push("授權未註記");
          text.textContent = parts.join(" · ");
          if (characterId === undefined || (typeof image.source !== "string" || image.source === "") || (typeof image.license !== "string" || image.license === "")) {
            row.className = "fact-row row-warn";
          }
          row.append(preview, text);
          if (!isActive) {
            var selectButton = document.createElement("button");
            selectButton.className = "inline-button";
            selectButton.textContent = "設為目前封面";
            selectButton.setAttribute("aria-label", "將 " + imageId + " 設為目前封面");
            selectButton.addEventListener("click", function () {
              void runTask("設定封面", async function () {
                var payload = await postJson("/workspace/cover/select", { image_id: imageId });
                await Promise.allSettled([loadDashboardData()]);
                return payload;
              });
            });
            row.append(selectButton);
          }
          var removeButton = document.createElement("button");
          removeButton.className = "inline-button";
          removeButton.textContent = "移除";
          removeButton.setAttribute("aria-label", "移除圖片 " + imageId + "。再次點擊以確認。");
          removeButton.addEventListener("click", removeImage(imageId, removeButton));
          row.append(removeButton);
          target.append(row);
        }
      }

      function postImageRemove(imageId) {
        if (state.busy || imageId === "") return;
        void runTask("移除角色圖", async function () {
          var payload = await postJson("/workspace/images/remove", { image_id: imageId });
          await Promise.allSettled([loadDashboardData()]);
          return payload;
        });
      }

      function submitImage() {
        if (state.busy) return;
        var fileInput = byId("image-file");
        var file = fileInput.files && fileInput.files.length > 0 ? fileInput.files[0] : undefined;
        if (file === undefined) {
          byId("image-message").textContent = "請先選擇 PNG 圖片檔案。";
          return;
        }
        var reader = new FileReader();
        reader.onload = function () {
          var base64 = typeof reader.result === "string" ? reader.result.split(",")[1] || "" : "";
          var body = {
            attachments: [{ name: file.name, content_base64: base64, media_type: file.type || "image/png" }],
          };
          var characterId = byId("image-character").value;
          if (characterId !== "") body.character_id = characterId;
          var ratio = byId("image-ratio").value;
          if (ratio !== "") body.aspect_ratio = ratio;
          var source = byId("image-source").value.trim();
          if (source !== "") body.source = source;
          var license = byId("image-license").value.trim();
          if (license !== "") body.license = license;
          void runTask("上傳角色圖", async function () {
            var payload = await postJson("/workspace/images", body);
            await Promise.allSettled([loadDashboardData()]);
            return payload;
          });
        };
        reader.readAsDataURL(file);
      }

      function renderBuildReadiness(readiness) {
        var target = byId("build-summary");
        target.textContent = "";
        if (!isRecord(readiness)) {
          byId("build-message").textContent = "沒有打包預覽資料。";
          return;
        }
        var parts = [];
        var modes = isRecord(readiness.modes) ? readiness.modes : {};
        if (modes.zhuji) parts.push("珠璣可用");
        if (modes.palette) parts.push("調色盤可用");
        if (parts.length === 0) parts.push("尚無可用打包模式");
        if (isRecord(readiness.primary_character)) {
          parts.push("主要角色 " + (firstString(readiness.primary_character, ["label"]) || "?"));
        }
        if (firstString(readiness, ["selected_mode"])) parts.push("選定模式 " + firstString(readiness, ["selected_mode"]));
        else if (firstString(readiness, ["export_modes"])) parts.push("Blueprint 模式 " + firstString(readiness, ["export_modes"]));
        if (firstString(readiness, ["card_name"])) parts.push("角色卡 " + firstString(readiness, ["card_name"]));
        if (firstString(readiness, ["world_book_name"])) parts.push("世界書 " + firstString(readiness, ["world_book_name"]));
        byId("build-message").textContent = parts.join(" · ");
        var entries = Array.isArray(readiness.entries) ? readiness.entries : [];
        var entryTarget = document.createElement("div");
        var entryLabels = entries.map(function (entry) {
          if (!isRecord(entry)) return "?";
          var label = (firstString(entry, ["kind"]) || "?") + ":" + (firstString(entry, ["name"]) || "?");
          if (firstString(entry, ["revision"])) label += "（@" + String(firstString(entry, ["revision"])).slice(0, 8) + "）";
          return label;
        });
        entryTarget.textContent = entries.length === 0 ? "沒有附加條目。" : "附加條目：" + entryLabels.join("、");
        target.append(entryTarget);
        var stats = [];
        if (readiness.greeting_entries !== undefined) stats.push("greeting 共 " + readiness.greeting_entries + " 組");
        if (readiness.alternate_greeting_count !== undefined) stats.push("備選 " + readiness.alternate_greeting_count + "／群組 " + readiness.group_greeting_count);
        if (firstString(readiness, ["first_greeting"])) stats.push("首發：" + String(firstString(readiness, ["first_greeting"])));
        if (Array.isArray(readiness.plugin_ids) && readiness.plugin_ids.length > 0) stats.push("plugin：" + readiness.plugin_ids.join("、"));
        if (readiness.png_expected !== undefined) stats.push(readiness.png_expected ? "將輸出 PNG" : "不輸出 PNG");
        if (isRecord(readiness.output_paths)) {
          if (firstString(readiness.output_paths, ["json"])) stats.push("JSON → " + firstString(readiness.output_paths, ["json"]));
          if (firstString(readiness.output_paths, ["png"])) stats.push("PNG → " + firstString(readiness.output_paths, ["png"]));
        }
        var totalChars = entries.reduce(function (sum, entry) { return sum + (isRecord(entry) && typeof entry.char_count === "number" ? entry.char_count : 0); }, 0);
        var totalTokens = entries.reduce(function (sum, entry) { return sum + (isRecord(entry) && typeof entry.estimated_tokens === "number" ? entry.estimated_tokens : 0); }, 0);
        if (entries.length > 0) stats.push("字數 " + totalChars + "／token 預估 " + totalTokens);
        var statsTarget = document.createElement("div");
        statsTarget.textContent = stats.join(" · ");
        target.append(statsTarget);
        var missing = Array.isArray(readiness.missing) ? readiness.missing : [];
        var missingTarget = document.createElement("div");
        missingTarget.textContent = missing.length === 0 ? "模組齊全。" : "缺少模組：" + missing.join("、");
        target.append(missingTarget);
        var diagnosticsTarget = byId("build-diagnostics");
        diagnosticsTarget.textContent = "";
        var diagnostics = Array.isArray(readiness.diagnostics) ? readiness.diagnostics : [];
        for (var i = 0; i < diagnostics.length; i += 1) {
          var item = diagnostics[i];
          if (!isRecord(item)) continue;
          var row = document.createElement("div");
          row.className = "readiness-row";
          row.textContent = (firstString(item, ["code"]) || "?") + "： " + (firstString(item, ["message"]) || "");
          diagnosticsTarget.append(row);
        }
      }

      function renderTavern(report) {
        var target = byId("tavern-report");
        target.textContent = "";
        if (!isRecord(report)) {
          byId("tavern-message").textContent = "沒有相容性資料。";
          return;
        }
        byId("tavern-message").textContent = report.available === true
          ? (firstString(report, ["summary"]) || "相容性檢查完成。")
          : "目前無法檢查相容性。";
        var checks = Array.isArray(report.checks) ? report.checks : [];
        for (var i = 0; i < checks.length; i += 1) {
          var check = checks[i];
          if (!isRecord(check)) continue;
          var row = document.createElement("div");
          row.className = "fact-row tavern-check";
          var badge = document.createElement("span");
          var status = firstString(check, ["status"]) || "WARN";
          badge.className = "badge badge-" + String(status).toLowerCase();
          badge.textContent = status;
          row.append(badge);
          var label = document.createElement("strong");
          label.textContent = firstString(check, ["label"]) || "檢查";
          row.append(label);
          row.append("： " + (firstString(check, ["detail"]) || ""));
          target.append(row);
        }
        var jsonPath = firstString(report, ["json_path"]);
        var pngPath = firstString(report, ["png_path"]);
        if (jsonPath !== "" || pngPath !== "") {
          var paths = document.createElement("div");
          paths.className = "readiness-row";
          paths.textContent = (jsonPath === "" ? "" : "JSON → " + jsonPath + "　") + (pngPath === "" ? "" : "PNG → " + pngPath);
          target.append(paths);
        }
      }

      function renderRepairInspection(inspection) {
        var target = byId("repair-report");
        target.textContent = "";
        if (!isRecord(inspection)) {
          byId("repair-message").textContent = "沒有修復資料。";
          return;
        }
        var items = Array.isArray(inspection.items) ? inspection.items : [];
        var planHash = firstString(inspection, ["plan_hash"]);
        if (planHash !== "") repairPlanHash = planHash;
        if (items.length === 0) {
          byId("repair-message").textContent = "沒有需要修復的項目。";
          return;
        }
        byId("repair-message").textContent = "發現 " + items.length + " 項待修復（計畫 hash " + planHash.slice(0, 12) + "）。";
        for (var i = 0; i < items.length; i += 1) {
          var item = items[i];
          if (!isRecord(item)) continue;
          var row = document.createElement("div");
          row.className = "readiness-row";
          var badge = document.createElement("span");
          badge.className = "badge badge-" + (firstString(item, ["kind"]) === "orphan_backup" ? "warn" : "info");
          badge.textContent = firstString(item, ["kind"]) === "orphan_backup" ? "孤兒備份" : "legacy";
          row.append(badge);
          row.append(" " + (firstString(item, ["source"]) || "?") + " → " + (firstString(item, ["target"]) || "?"));
          var note = document.createElement("div");
          note.className = "muted";
          note.textContent = (firstString(item, ["reason"]) || "") + (item.recoverable === true ? "（可回復）" : "（不可回復）");
          row.append(note);
          target.append(row);
        }
      }

      function renderRepairReport(report) {
        var target = byId("repair-report");
        target.textContent = "";
        if (!isRecord(report)) {
          byId("repair-message").textContent = "修復執行沒有回報。";
          return;
        }
        var actions = Array.isArray(report.actions) ? report.actions : [];
        byId("repair-message").textContent = actions.length === 0 ? "修復完成：沒有需要處理的項目。" : "修復完成（計畫 hash " + firstString(report, ["plan_hash"]).slice(0, 12) + "）。";
        for (var i = 0; i < actions.length; i += 1) {
          var action = actions[i];
          if (!isRecord(action)) continue;
          var row = document.createElement("div");
          row.className = "readiness-row";
          var outcome = firstString(action, ["outcome"]) || "skipped";
          var badge = document.createElement("span");
          badge.className = "badge badge-" + (outcome === "archived" ? "pass" : outcome === "missing" ? "fail" : "warn");
          badge.textContent = outcome === "archived" ? "已歸檔" : outcome === "missing" ? "來源已不存在" : "略過";
          row.append(badge);
          row.append(" " + (firstString(action, ["source"]) || "?") + " → " + (firstString(action, ["target"]) || "?"));
          target.append(row);
        }
      }

      var currentLatestReviewRun = null;
      var currentSfCollections = null;

      async function loadArtifactData() {
        try {
          var pages = await Promise.all([
            requestJson("/workspace/dashboard/artifacts?limit=50"),
            requestJson("/workspace/dashboard/reviews?limit=200")
          ]);
          var artifactPage = pages[0];
          var reviewPage = pages[1];
          renderArtifactList({
            items: Array.isArray(artifactPage.items) ? artifactPage.items : [],
            total: artifactPage.total,
            next_cursor: artifactPage.next_cursor,
            reviews: Array.isArray(reviewPage.items) ? reviewPage.items : []
          });
          return artifactPage;
        } catch (error) {
          setAreaError("artifact-message", error);
          throw error;
        }
      }

      async function loadIssueData() {
        try {
          var payload = await requestJson("/workspace/dashboard/issues?limit=100");
          renderIssueList({ issues: Array.isArray(payload.items) ? payload.items : [] });
          return payload;
        } catch (error) {
          setAreaError("quality-message", error);
          throw error;
        }
      }

      function renderSourceFactCollections() {
        if (currentSfCollections === null) return;
        var latestRun = null;
        if (currentLatestReviewRun !== null && currentLatestReviewRun !== undefined && firstString(currentLatestReviewRun, ["id"])) {
          latestRun = currentLatestReviewRun;
        }
        renderSourceFact({
          candidates: currentSfCollections.candidates.items,
          sources: currentSfCollections.sources.items,
          facts: currentSfCollections.facts.items,
          review_runs: currentSfCollections.runs.items,
          latest_review_run: latestRun,
          collection_counts: {
            candidates: collectionCountText(currentSfCollections.candidates),
            sources: collectionCountText(currentSfCollections.sources),
            facts: collectionCountText(currentSfCollections.facts),
            runs: collectionCountText(currentSfCollections.runs)
          }
        });
        collectionMoreButton(currentSfCollections.candidates, "/workspace/dashboard/candidates", renderSourceFactCollections, "candidates-more", "candidates-count");
        collectionMoreButton(currentSfCollections.sources, "/workspace/dashboard/sources", renderSourceFactCollections, "sources-more", "sources-count");
        collectionMoreButton(currentSfCollections.facts, "/workspace/dashboard/facts", renderSourceFactCollections, "facts-more", "facts-count");
        collectionMoreButton(currentSfCollections.runs, "/workspace/dashboard/fact-review/runs", renderSourceFactCollections, "runs-more", "runs-count");
      }

      async function loadSourceFactData() {
        try {
          var sfCandidates = collectionController();
          var sfSources = collectionController();
          var sfFacts = collectionController();
          var sfRuns = collectionController();
          currentSfCollections = { candidates: sfCandidates, sources: sfSources, facts: sfFacts, runs: sfRuns };
          var pages = await Promise.all([
            collectionResetAndFetch(sfCandidates, "/workspace/dashboard/candidates", function () { return null; }),
            collectionResetAndFetch(sfSources, "/workspace/dashboard/sources", function () { return null; }),
            collectionResetAndFetch(sfFacts, "/workspace/dashboard/facts", function () { return null; }),
            collectionResetAndFetch(sfRuns, "/workspace/dashboard/fact-review/runs", function () { return null; })
          ]);
          if (currentLatestReviewRun !== null && currentLatestReviewRun !== undefined && firstString(currentLatestReviewRun, ["id"])) {
            currentLatestReviewRun = await requestJson("/workspace/dashboard/fact-review/runs/" + encodeURIComponent(firstString(currentLatestReviewRun, ["id"])));
          }
          renderSourceFactCollections();
          void loadCoverageCenterData();
          void loadEvidenceData();
          return pages;
        } catch (error) {
          setAreaError("source-fact-message", error);
          throw error;
        }
      }

      async function loadOperationData() {
        try {
          var payload = await requestJson("/workspace/dashboard/operations?limit=100");
          renderOperationList(Array.isArray(payload.items) ? payload.items : []);
          return payload;
        } catch (error) {
          setAreaError("operation-message", error);
          throw error;
        }
      }

      async function loadDashboardData() {
        try {
          var payload = await requestJson("/workspace/dashboard/data");
          currentLatestReviewRun = payload.latest_review_run === undefined || payload.latest_review_run === null ? null : payload.latest_review_run;
          renderPrecheckMatrix(payload.prechecks);
          renderQuality(payload);
          renderImageList(payload.images, payload.roster, payload.primary_character_id, payload.active_cover);
          renderKpis(payload.kpis);
          var staleBanner = byId("image-stale-banner");
          if (payload.images_stale === true) {
            staleBanner.hidden = false;
            staleBanner.textContent = "圖片已變更，最新發布的輸出已過期；請重新打包（Preview／發布）。";
          } else if (payload.images_freshness !== undefined && payload.images_freshness.status === "unknown") {
            staleBanner.hidden = false;
            staleBanner.textContent = "無法判定封面圖片是否最新（此發布為舊版記錄，未保存封面 identity）。";
          } else {
            staleBanner.hidden = true;
          }
          byId("artifact-message").textContent = "首頁摘要已載入；按下按鈕取得 artifact 明細。";
          byId("source-fact-message").textContent = "首頁摘要已載入；按下按鈕取得來源與事實。";
          byId("operation-message").textContent = "首頁摘要已載入；按下按鈕取得 operation。";
          byId("quality-message").textContent = "首頁摘要已載入；按下按鈕取得 issue。";
          void refreshWorkflowViews();
          void loadProvenanceHistory();
          return payload;
        } catch (error) {
          setAreaError("prechecks-message", error);
          throw error;
        }
      }

`;
