export const DASHBOARD_DRAFT_STORE_JS = `      var cradDraftStore = (function () {
        var KEY_PREFIX = "crad:draft:v1:";
        var SCHEMA_VERSION = 1;
        var TTL_MS = 7 * 24 * 60 * 60 * 1000;
        var MAX_VALUE_LENGTH = 65536;
        var ALLOWED_FORMS = [
          "interview",
          "interview_amend",
          "request",
          "quality_reason",
          "fact_review_reason",
          "coverage_supplement",
          "coverage_url",
          "publish_confirm"
        ];

        function currentProjectId() {
          if (state.status && isRecord(state.status) && typeof state.status.project_id === "string" && state.status.project_id.length > 0) {
            return state.status.project_id;
          }
          if (typeof state.currentProjectValue === "string" && state.currentProjectValue.length > 0) {
            return state.currentProjectValue;
          }
          return "";
        }

        function keyOf(formKey, objectKey) {
          return KEY_PREFIX + currentProjectId() + ":" + formKey + (objectKey ? ":" + objectKey : "");
        }

        function readRaw(key) {
          try {
            return window.sessionStorage.getItem(key);
          } catch (error) {
            return null;
          }
        }

        function writeRaw(key, raw) {
          try {
            window.sessionStorage.setItem(key, raw);
            return true;
          } catch (error) {
            return false;
          }
        }

        function removeRaw(key) {
          try {
            window.sessionStorage.removeItem(key);
          } catch (error) {
          }
        }

        function normalizeEntry(raw) {
          if (typeof raw !== "string" || raw.length === 0) return null;
          var entry;
          try {
            entry = JSON.parse(raw);
          } catch (error) {
            return null;
          }
          if (!isRecord(entry)) return null;
          if (entry.schema_version !== SCHEMA_VERSION) return null;
          if (typeof entry.form_key !== "string" || ALLOWED_FORMS.indexOf(entry.form_key) === -1) return null;
          if (typeof entry.value !== "string" || entry.value.length === 0 || entry.value.length > MAX_VALUE_LENGTH) return null;
          if (typeof entry.project_id !== "string" || entry.project_id.length === 0) return null;
          if (typeof entry.saved_at !== "string" || typeof entry.expires_at !== "string") return null;
          if (Date.parse(entry.expires_at) <= Date.now()) return null;
          return entry;
        }

        function saveDraft(formKey, value, baseRevision, objectKey) {
          if (ALLOWED_FORMS.indexOf(formKey) === -1) return false;
          if (typeof value !== "string") return false;
          var trimmed = value.trim();
          if (trimmed.length === 0) {
            clearDraft(formKey, objectKey);
            return true;
          }
          if (trimmed.length > MAX_VALUE_LENGTH) return false;
          var projectId = currentProjectId();
          if (projectId.length === 0) return false;
          var savedAt = new Date().toISOString();
          var entry = {
            schema_version: SCHEMA_VERSION,
            form_key: formKey,
            object_key: objectKey || "",
            project_id: projectId,
            value: trimmed,
            base_revision: typeof baseRevision === "number" ? baseRevision : null,
            saved_at: savedAt,
            expires_at: new Date(Date.now() + TTL_MS).toISOString()
          };
          return writeRaw(keyOf(formKey, objectKey), JSON.stringify(entry));
        }

        function loadDraft(formKey, objectKey) {
          var raw = readRaw(keyOf(formKey, objectKey));
          var entry = normalizeEntry(raw);
          if (entry === null) {
            if (raw !== null) removeRaw(keyOf(formKey, objectKey));
            return null;
          }
          if (entry.project_id !== currentProjectId()) return null;
          return entry;
        }

        function clearDraft(formKey, objectKey) {
          removeRaw(keyOf(formKey, objectKey));
        }

        function clearProjectDrafts() {
          var projectId = currentProjectId();
          var prefix = KEY_PREFIX + projectId + ":";
          if (projectId.length === 0) return;
          var keys = [];
          for (var index = 0; index < window.sessionStorage.length; index += 1) {
            var key = window.sessionStorage.key(index);
            if (key !== null && key.indexOf(prefix) === 0) keys.push(key);
          }
          for (var i = 0; i < keys.length; i += 1) removeRaw(keys[i]);
        }

        function scanDrafts() {
          var projectId = currentProjectId();
          if (projectId.length === 0) return [];
          var prefix = KEY_PREFIX + projectId + ":";
          var results = [];
          for (var index = 0; index < window.sessionStorage.length; index += 1) {
            var key = window.sessionStorage.key(index);
            if (key === null || key.indexOf(prefix) !== 0) continue;
            var raw = readRaw(key);
            if (raw === null) continue;
            var entry = normalizeEntry(raw);
            if (entry === null) {
              removeRaw(key);
              continue;
            }
            results.push(entry);
          }
          results.sort(function (a, b) {
            return a.saved_at < b.saved_at ? -1 : a.saved_at > b.saved_at ? 1 : 0;
          });
          return results;
        }

        return {
          saveDraft: saveDraft,
          loadDraft: loadDraft,
          clearDraft: clearDraft,
          clearProjectDrafts: clearProjectDrafts,
          scanDrafts: scanDrafts,
          TTL_MS: TTL_MS,
          MAX_VALUE_LENGTH: MAX_VALUE_LENGTH
        };
      })();

`;
