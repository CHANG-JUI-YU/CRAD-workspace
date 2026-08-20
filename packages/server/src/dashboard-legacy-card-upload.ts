import { DASHBOARD_LISTENERS_JS } from "./dashboard-listeners.js";

function replaceExactlyOnce(source: string, before: string, after: string, label: string): string {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Dashboard legacy-card transform missing ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`Dashboard legacy-card transform found duplicate ${label}`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

const LEGACY_REVIEW_ENTRY = `      function legacyReviewEntry() {
        revealProjectPanel();
        setNotice("info", "舊卡審核：請先選擇或建立專案，再於結構化訪談中選擇「舊卡審核」。");
      }`;

const LEGACY_REVIEW_UPLOAD_ENTRY = `      var LEGACY_CARD_MAX_BYTES = 5 * 1024 * 1024;
      var legacyCardFileInput = null;

      function legacyCardMediaType(file) {
        var name = String(file && file.name || "").toLowerCase();
        if (name.endsWith(".png")) return "image/png";
        if (name.endsWith(".yaml") || name.endsWith(".yml")) return "text/yaml";
        if (name.endsWith(".json")) return "application/json";
        return "";
      }

      function legacyCardInput() {
        if (legacyCardFileInput) return legacyCardFileInput;
        var input = document.createElement("input");
        input.type = "file";
        input.id = "legacy-card-file";
        input.accept = ".png,.json,.yaml,.yml,image/png,application/json,text/yaml,application/yaml,application/x-yaml";
        input.hidden = true;
        input.addEventListener("cancel", function () {
          setNotice("info", "已取消舊卡檔案選擇，未上傳任何內容。");
        });
        input.addEventListener("change", function () {
          var file = input.files && input.files.length > 0 ? input.files[0] : undefined;
          if (file === undefined) {
            setNotice("info", "未選擇舊卡檔案，沒有上傳任何內容。");
            return;
          }
          var mediaType = legacyCardMediaType(file);
          if (!mediaType) {
            setNotice("warning", "舊卡審核僅支援 PNG、JSON、YAML（.yaml/.yml）檔案。");
            return;
          }
          if (file.size > LEGACY_CARD_MAX_BYTES) {
            setNotice("warning", "舊卡檔案超過 5 MiB 上限，請縮小檔案後重試。");
            return;
          }
          if (file.size === 0) {
            setNotice("warning", "舊卡檔案是空檔案，請重新選擇。");
            return;
          }
          var reader = new FileReader();
          reader.onerror = function () {
            setNotice("error", "瀏覽器無法讀取這個舊卡檔案，請重新選擇。");
          };
          reader.onload = function () {
            var base64 = typeof reader.result === "string" ? reader.result.split(",")[1] || "" : "";
            if (!base64) {
              setNotice("error", "舊卡檔案內容無法讀取，請重新選擇。");
              return;
            }
            void runTask("舊卡審核", async function () {
              var payload = await postJson("/workspace/legacy-card/import", {
                attachments: [{ name: file.name, content_base64: base64, media_type: mediaType }]
              });
              await refreshAfterAction();
              return payload;
            });
          };
          reader.readAsDataURL(file);
        });
        document.body.append(input);
        legacyCardFileInput = input;
        return input;
      }

      function legacyReviewEntry() {
        if (state.busy) return;
        var input = legacyCardInput();
        input.value = "";
        setNotice("info", "請直接選擇 PNG、JSON 或 YAML 舊卡；瀏覽器會上傳檔案內容，不會提交本機 filesystem path。");
        input.click();
      }`;

export const DASHBOARD_LISTENERS_LEGACY_UPLOAD_JS = replaceExactlyOnce(
  DASHBOARD_LISTENERS_JS,
  LEGACY_REVIEW_ENTRY,
  LEGACY_REVIEW_UPLOAD_ENTRY,
  "legacyReviewEntry",
);
