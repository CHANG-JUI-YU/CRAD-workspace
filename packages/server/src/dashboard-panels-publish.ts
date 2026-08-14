export const DASHBOARD_PANELS_PUBLISH_JS = `      function renderPrecheckMatrix(prechecks) {
        var target = byId("precheck-matrix");
        target.textContent = "";
        if (!Array.isArray(prechecks) || prechecks.length === 0) {
          byId("prechecks-message").textContent = "目前沒有 Blueprint 預檢記錄。";
          return;
        }
        var pending = null;
        for (var i = prechecks.length - 1; i >= 0; i -= 1) {
          if (isRecord(prechecks[i]) && prechecks[i].status === "needs_input") {
            pending = prechecks[i];
            break;
          }
        }
        var active = null;
        if (pending !== null && Array.isArray(pending.checks)) {
          for (var a = 0; a < pending.checks.length; a += 1) {
            var item = pending.checks[a];
            if (isRecord(item) && item.action === "user_confirmed" && (item.user_answer === undefined || item.user_answer === "pending confirmation")) {
              active = item;
              break;
            }
          }
        }
        byId("prechecks-message").textContent = "共 " + prechecks.length + " 筆預檢記錄；" + (active !== null ? "目前待確認 1 項。" : "歷史矩陣僅供瀏覽。");
        if (active !== null) {
          var card = document.createElement("div");
          card.className = "precheck-active";
          var heading = document.createElement("div");
          heading.className = "precheck-active-heading";
          heading.textContent = "目前待確認：" + (firstString(active, ["subject_id"]) || "?") + " × " + (firstString(active, ["dimension"]) || "?");
          card.append(heading);
          var detail = document.createElement("div");
          var detailParts = [];
          detailParts.push("原依據：" + (firstString(active, ["basis"]) || "?"));
          detailParts.push("影響：" + (firstString(active, ["impact"]) || "?"));
          detailParts.push("不確定性：" + (firstString(active, ["uncertainty"]) || "?"));
          detail.textContent = detailParts.join(" · ");
          card.append(detail);
          var actions = document.createElement("span");
          actions.className = "inline-actions";
          var confirm = document.createElement("button");
          confirm.type = "button";
          confirm.className = "primary";
          confirm.textContent = "確認沿用";
          confirm.addEventListener("click", function () { submitInterviewAnswer("確認"); });
          actions.append(confirm);
          var supplement = document.createElement("input");
          supplement.type = "text";
          supplement.placeholder = "補充內容（可選）…";
          var submitSupplement = document.createElement("button");
          submitSupplement.type = "button";
          submitSupplement.textContent = "送出補充";
          submitSupplement.addEventListener("click", function () {
            var value = supplement.value.trim();
            if (!value) {
              localValidation("預檢補充", "補充內容不可為空。");
              return;
            }
            submitInterviewAnswer(value);
          });
          actions.append(supplement, submitSupplement);
          card.append(actions);
          target.append(card);
        }
        var rows = [];
        for (var p = 0; p < prechecks.length; p += 1) {
          var precheck = prechecks[p];
          if (!isRecord(precheck) || !Array.isArray(precheck.checks)) continue;
          var statusLabel = precheck.status === "superseded" ? "已取代" : (precheck.status === "needs_input" ? "待處理" : "已記錄");
          for (var c = 0; c < precheck.checks.length; c += 1) {
            var check = precheck.checks[c];
            if (!isRecord(check)) continue;
            var row = document.createElement("div");
            row.className = "precheck-row";
            var subjectCell = document.createElement("span");
            subjectCell.textContent = firstString(check, ["subject_id"]) || "?";
            var dimensionCell = document.createElement("span");
            dimensionCell.textContent = firstString(check, ["dimension"]) || "?";
            var statusCell = document.createElement("span");
            var answered = check.user_answer !== undefined && check.user_answer !== "pending confirmation";
            statusCell.className = "status-badge " + (answered ? "ready" : (precheck.status === "needs_input" ? "active" : ""));
            if (answered) statusCell.textContent = "已確認";
            else if (check.action !== "user_confirmed") statusCell.textContent = "無需確認";
            else statusCell.textContent = statusLabel;
            var metaCell = document.createElement("span");
            var metaParts = ["impact " + (firstString(check, ["impact"]) || "?"), "uncertainty " + (firstString(check, ["uncertainty"]) || "?")];
            if (firstString(check, ["basis"])) metaParts.push("basis " + firstString(check, ["basis"]));
            if (answered) metaParts.push("回答：" + check.user_answer);
            metaCell.textContent = metaParts.join(" / ");
            row.append(subjectCell, dimensionCell, statusCell, metaCell);
            rows.push(row);
          }
        }
        if (rows.length > 0) {
          var history = document.createElement("div");
          history.className = "precheck-history";
          history.append.apply(history, rows);
          target.append(history);
        }
      }

      function renderReadiness(diagnostics) {
        var target = byId("readiness-list");
        target.textContent = "";
        if (!Array.isArray(diagnostics) || diagnostics.length === 0) {
          byId("readiness-message").textContent = "就緒：可以發布。";
          return;
        }
        var blocking = diagnostics.filter(function (item) { return item.severity === "error"; });
        byId("readiness-message").textContent = blocking.length === 0
          ? "有 " + diagnostics.length + " 條警告，不阻擋發布。"
          : "有 " + blocking.length + " 條阻擋診斷；修復後再發布。";
        for (var i = 0; i < diagnostics.length; i += 1) {
          var item = diagnostics[i];
          if (!isRecord(item)) continue;
          var row = document.createElement("div");
          row.className = "readiness-row";
          var badge = document.createElement("span");
          badge.className = "status-badge " + (item.severity === "error" ? "error" : "active");
          badge.textContent = item.severity === "error" ? "阻擋" : "警告";
          var text = document.createElement("span");
          text.textContent = (firstString(item, ["code"]) || "?") + "： " + (firstString(item, ["message"]) || "");
          row.append(badge, text);
          var hint = document.createElement("span");
          hint.className = "readiness-hint";
          hint.textContent = readinessHint(firstString(item, ["code"]));
          row.append(hint);
          target.append(row);
        }
      }

      function readinessHint(code) {
        var hints = {
          "BLUEPRINT_PRECHECK_REQUIRED": "動作：在訪談中完成預檢確認。",
          "INTERVIEW_REQUIRED": "動作：完成結構化訪談。",
          "PUBLISH_NO_CONTENT": "動作：建立至少一個角色內容 artifact。",
          "ARTIFACT_REVIEW_REQUIRED": "動作：送交對應 Critic 審查。",
          "REQUIRED_WORLD_ARTIFACT_MISSING": "動作：建立世界設定。",
          "BLUEPRINT_BINDING_STALE": "動作：依目前 Blueprint 重建 artifact。",
          "FACT_REVIEW_RUN_MISSING": "動作：整理來源後自動抽取事實。",
          "FACT_REVIEW_COVERAGE_INCOMPLETE": "動作：完成全部候選的裁決。",
          "FACT_REVIEW_NEEDS_EVIDENCE": "動作：補齊來源引文後重新送審。",
          "FACT_REVIEW_CONFLICT": "動作：由 Director 執行衝突裁決。",
          "FACT_REVIEW_CONTRADICTION": "動作：送交 Director 裁決矛盾事實。",
          "SOURCE_RESEARCH_NOT_INGESTED": "動作：批准候選並執行來源入庫。",
          "SOURCE_RESEARCH_OFFICIAL_REQUIRED": "動作：搜尋並入庫官方來源。",
          "WORLD_AUTHORING_ORDER": "動作：先建立世界設定。",
          "CHARACTER_AUTHORING_ORDER": "動作：先建立角色設定。",
          "FACT_PROVENANCE_MISSING": "動作：為已接受事實補上來源佐證。",
          "FACT_REVIEW_DECISION_MISSING": "動作：確認每個已接受事實都有裁決記錄。",
          "REQUIRED_ARTIFACT_MISSING": "動作：建立缺少的必要 artifact。"
        };
        return hints[code] || "";
      }

      function panelAnchorId(panel) {
        var panelIds = {
          sources: "source-list",
          artifacts: "artifact-list",
          facts: "fact-list",
          "fact-review": "fact-review-run",
          coverage: "coverage-center",
          precheck: "precheck-matrix",
          interview: "interview-heading",
          readiness: "readiness-list",
          quality: "quality-heading",
          builds: "build-heading",
          publishes: "readiness-list"
        };
        return panelIds[panel] || "readiness-list";
      }

      function coverageCellId(characterId, requirementId) {
        return "coverage-cell-" + (characterId || "world") + "-" + String(requirementId).split(".").join("-");
      }

      function findDiagnosticObjectElement(target) {
        if (target === undefined || target === null) return null;
        if (target.kind === "coverage_cell") {
          if (target.requirement_id === undefined || target.requirement_id === null) return null;
          var cell = byId(coverageCellId(target.character_id, target.requirement_id));
          if (cell !== null && cell !== undefined) return cell;
          return null;
        }
        if (target.kind === undefined || target.id === undefined || target.id === null) return null;
        var matches = document.querySelectorAll("[data-object-kind]");
        for (var i = 0; i < matches.length; i += 1) {
          if (matches[i].getAttribute("data-object-kind") === target.kind && matches[i].getAttribute("data-object-id") === target.id) {
            return matches[i];
          }
        }
        return null;
      }

      var lastDiagnosticHighlight = null;
      var currentProvenanceConfirmation = null;

      function clearDiagnosticHighlight() {
        if (lastDiagnosticHighlight !== null && lastDiagnosticHighlight !== undefined) {
          lastDiagnosticHighlight.classList.remove("diagnostic-highlight");
          lastDiagnosticHighlight.removeAttribute("data-diagnostic-code");
          lastDiagnosticHighlight = null;
        }
      }

      function reducedMotion() {
        return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      }

      function switchPanel(panel) {
        var anchor = byId(panelAnchorId(panel));
        if (anchor === null || anchor === undefined) return;
        anchor.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
      }

      function revealDiagnosticTarget(target, code) {
        if (target === undefined || target === null) return;
        var element = findDiagnosticObjectElement(target);
        if (element === null) element = byId(panelAnchorId(target.panel));
        if (element === null || element === undefined) element = byId("readiness-list");
        if (element === null || element === undefined) return;
        clearDiagnosticHighlight();
        element.classList.add("diagnostic-highlight");
        element.setAttribute("data-diagnostic-code", code || target.panel || "");
        element.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
        if (typeof element.focus === "function") {
          try {
            element.focus({ preventScroll: true });
          } catch (focusError) {
            element.focus();
          }
        }
        lastDiagnosticHighlight = element;
      }

      function navigateDiagnosticTarget(target) {
        revealDiagnosticTarget(target);
      }

      function makeDiagnosticNavGroup(rowState) {
        var group = document.createElement("span");
        group.className = "diagnostic-nav";
        var count = document.createElement("span");
        count.className = "diagnostic-nav-count";
        count.textContent = "1 / " + rowState.targets.length;
        var prev = document.createElement("button");
        prev.type = "button";
        prev.textContent = "上一個";
        prev.setAttribute("aria-label", "上一個受影響物件");
        prev.addEventListener("click", function () {
          rowState.index = (rowState.index - 1 + rowState.targets.length) % rowState.targets.length;
          count.textContent = (rowState.index + 1) + " / " + rowState.targets.length;
          revealDiagnosticTarget(rowState.targets[rowState.index], rowState.code);
        });
        var next = document.createElement("button");
        next.type = "button";
        next.textContent = "下一個";
        next.setAttribute("aria-label", "下一個受影響物件");
        next.addEventListener("click", function () {
          rowState.index = (rowState.index + 1) % rowState.targets.length;
          count.textContent = (rowState.index + 1) + " / " + rowState.targets.length;
          revealDiagnosticTarget(rowState.targets[rowState.index], rowState.code);
        });
        group.append(prev, count, next);
        return group;
      }

      function renderPublishDiagnostics(structured) {
        var target = byId("readiness-list");
        target.textContent = "";
        if (structured === null || structured === undefined || !Array.isArray(structured.rows) || structured.rows.length === 0) {
          byId("readiness-message").textContent = "就緒：可以發布。";
          return;
        }
        var blocking = structured.rows.filter(function (item) { return item.severity === "error"; });
        byId("readiness-message").textContent = blocking.length === 0
          ? "有 " + structured.rows.length + " 條警告，不阻擋發布。"
          : "有 " + blocking.length + " 條阻擋診斷；修復後再發布。";
        for (var i = 0; i < structured.rows.length; i += 1) {
          var row = structured.rows[i];
          if (!isRecord(row)) continue;
          var line = document.createElement("div");
          line.className = "readiness-row";
          var badge = document.createElement("span");
          badge.className = "status-badge " + (row.severity === "error" ? "error" : "active");
          badge.textContent = row.severity === "error" ? "阻擋" : "警告";
          line.append(badge);
          var text = document.createElement("span");
          text.textContent = (firstString(row, ["code"]) || "?") + "： " + (firstString(row, ["message"]) || "");
          line.append(text);
          var detail = document.createElement("span");
          detail.className = "readiness-hint";
          var detailParts = [];
          if (Array.isArray(row.affected) && row.affected.length > 0) {
            for (var a = 0; a < row.affected.length; a += 1) {
              var affected = row.affected[a];
              var affectedLabel = affected.kind + " " + (affected.id ? affected.id.slice(0, 12) : "?");
              if (affected.character_id) affectedLabel += "（" + affected.character_id + "）";
              if (affected.requirement_id) affectedLabel += "／" + affected.requirement_id;
              detailParts.push(affectedLabel);
            }
          }
          if (row.next_action) detailParts.push("下一步：" + row.next_action);
          detail.textContent = detailParts.join("；");
          line.append(detail);
          var targets = Array.isArray(row.targets) && row.targets.length > 0
            ? row.targets.slice()
            : (row.target !== undefined && row.target !== null ? [row.target] : [{ panel: "readiness" }]);
          if (targets.length > 1) {
            line.append(makeDiagnosticNavGroup({ targets: targets, index: 0, code: row.code }));
          } else {
            var go = document.createElement("button");
            go.type = "button";
            go.textContent = "前往";
            go.setAttribute("aria-label", "前往受影響物件或面板");
            var singleTarget = targets[0];
            go.addEventListener("click", (function (immutableTarget, immutableCode) {
              return function () { revealDiagnosticTarget(immutableTarget, immutableCode); };
            })(singleTarget, row.code));
            line.append(go);
          }
          target.append(line);
        }
        if (structured.has_unknown === true) {
          var note = document.createElement("div");
          note.className = "muted";
          note.textContent = "部分診斷缺少明確動作，已在 Readiness 面板標示。";
          target.append(note);
        }
      }

      function provenanceCoverageRefs(refs) {
        var list = document.createElement("ul");
        if (!Array.isArray(refs) || refs.length === 0) {
          var empty = document.createElement("li");
          empty.className = "muted";
          empty.textContent = "沒有項目。";
          list.append(empty);
          return list;
        }
        for (var i = 0; i < refs.length; i += 1) {
          var ref = refs[i];
          var li = document.createElement("li");
          li.textContent = (isRecord(ref) && ref.character_id ? ref.character_id : "world") + "／" + (isRecord(ref) && ref.requirement_id ? ref.requirement_id : "?");
          list.append(li);
        }
        return list;
      }

      function provenanceSection(title, refs) {
        var section = document.createElement("details");
        section.className = "provenance-section";
        var summaryEl = document.createElement("summary");
        summaryEl.textContent = title;
        section.append(summaryEl);
        section.append(provenanceCoverageRefs(refs));
        return section;
      }

      function overrideList(refs) {
        var list = document.createElement("ul");
        if (!Array.isArray(refs) || refs.length === 0) {
          var empty = document.createElement("li");
          empty.className = "muted";
          empty.textContent = "沒有項目。";
          list.append(empty);
          return list;
        }
        for (var i = 0; i < refs.length; i += 1) {
          var ref = refs[i];
          if (!isRecord(ref)) continue;
          var li = document.createElement("li");
          var text = String(ref.decision_id) + "（" + String(ref.action) + "）：" + (Array.isArray(ref.requirement_ids) ? ref.requirement_ids.join(", ") : "?");
          if (ref.supersedes) text += "；取代 " + String(ref.supersedes);
          li.textContent = text;
          list.append(li);
        }
        return list;
      }

      function hashRow(label, value, container, legacyNote) {
        var rowEl = document.createElement("div");
        rowEl.className = "provenance-hash-row";
        var labelEl = document.createElement("span");
        labelEl.className = "muted";
        labelEl.textContent = label;
        rowEl.append(labelEl);
        var valueEl = document.createElement("code");
        valueEl.textContent = String(value);
        rowEl.append(valueEl);
        if (legacyNote) {
          var legacy = document.createElement("span");
          legacy.className = "status-badge cancelled";
          legacy.textContent = legacyNote;
          rowEl.append(legacy);
        }
        if (typeof navigator !== "undefined" && navigator.clipboard) {
          var copy = document.createElement("button");
          copy.type = "button";
          copy.textContent = "複製";
          copy.setAttribute("aria-label", "複製完整 " + label);
          copy.addEventListener("click", function () {
            navigator.clipboard.writeText(String(value)).catch(function () {});
          });
          rowEl.append(copy);
        }
        container.append(rowEl);
      }

      function renderProvenanceComposition(preview) {
        var target = byId("provenance-summary");
        target.textContent = "";
        var confirmButton = byId("confirm-publish");
        if (!isRecord(preview)) {
          byId("provenance-confirm-message").textContent = "無法取得 provenance 資訊。";
          if (confirmButton) confirmButton.disabled = true;
          return;
        }
        if (preview.available !== true || !isRecord(preview.composition)) {
          byId("provenance-confirm-message").textContent = "尚未準備完成：" + (firstString(preview, ["reason"]) || "不可用") + "。請先完成 Fact Review 與 formal coverage assessment 後再試。";
          if (confirmButton) confirmButton.disabled = true;
          return;
        }
        currentProvenanceConfirmation = { fingerprint: firstString(preview, ["fingerprint"]) };
        var composition = preview.composition;
        var box = document.createElement("div");
        box.className = "workflow-stage";
        var title = document.createElement("div");
        title.className = "workflow-stage-title";
        title.textContent = "發布來源組成（不可變 provenance）";
        box.append(title);
        var counts = document.createElement("div");
        counts.className = "muted";
        var countParts = [];
        if (composition.source_backed) countParts.push("來源佐證 " + composition.source_backed.count);
        if (composition.user_supplement) countParts.push("使用者補充 " + composition.user_supplement.count);
        if (composition.creative_completion) countParts.push("創作補全 " + composition.creative_completion.count);
        if (Array.isArray(composition.overrides) && composition.overrides.length > 0) countParts.push("active override " + composition.overrides.length);
        if (Array.isArray(composition.quality_overrides) && composition.quality_overrides.length > 0) countParts.push("品質覆寫 " + composition.quality_overrides.length);
        counts.textContent = countParts.join(" · ");
        box.append(counts);
        box.append(provenanceSection("來源佐證 source-backed（" + (composition.source_backed ? composition.source_backed.count : 0) + "）", composition.source_backed ? composition.source_backed.refs : []));
        var supplementSection = provenanceSection("使用者補充 user supplement（" + (composition.user_supplement ? composition.user_supplement.count : 0) + "）", composition.user_supplement ? composition.user_supplement.refs : []);
        supplementSection.className += " supplement";
        box.append(supplementSection);
        var creativeSection = provenanceSection("創作補全 creative completion（" + (composition.creative_completion ? composition.creative_completion.count : 0) + "）", composition.creative_completion ? composition.creative_completion.refs : []);
        creativeSection.className += " creative";
        box.append(creativeSection);
        var activeOverrideSection = document.createElement("details");
        activeOverrideSection.className = "provenance-section";
        var activeOverrideSummary = document.createElement("summary");
        activeOverrideSummary.textContent = "Active coverage decisions／overrides（" + (Array.isArray(composition.overrides) ? composition.overrides.length : 0) + "）";
        activeOverrideSection.append(activeOverrideSummary);
        activeOverrideSection.append(overrideList(composition.overrides));
        box.append(activeOverrideSection);
        var qualityOverrideSection = document.createElement("details");
        qualityOverrideSection.className = "provenance-section";
        var qualityOverrideSummary = document.createElement("summary");
        qualityOverrideSummary.textContent = "Quality overrides（" + (Array.isArray(composition.quality_overrides) ? composition.quality_overrides.length : 0) + "）";
        qualityOverrideSection.append(qualityOverrideSummary);
        qualityOverrideSection.append(overrideList(composition.quality_overrides.map(function (item) {
          return { decision_id: String(item.code), action: "quality_override", requirement_ids: [], rationale: item.reason, supersedes: undefined };
        })));
        box.append(qualityOverrideSection);
        var identities = document.createElement("details");
        identities.className = "provenance-section";
        var identitiesSummary = document.createElement("summary");
        identitiesSummary.textContent = "Snapshot identities（完整值）";
        identities.append(identitiesSummary);
        var identityBox = document.createElement("div");
        if (composition.assessment) hashRow("評估 assessment", composition.assessment.id + "@" + composition.assessment.revision, identityBox);
        if (composition.requirement_set) hashRow("requirement set", composition.requirement_set.id + "@" + composition.requirement_set.revision, identityBox);
        if (composition.fact_review_run) hashRow("fact review run", composition.fact_review_run.id + "@" + (composition.fact_review_run.projection_revision || "?"), identityBox);
        if (composition.fact_projection_revision) hashRow("fact projection revision", composition.fact_projection_revision, identityBox);
        if (Array.isArray(composition.source_revisions) && composition.source_revisions.length > 0) {
          hashRow("來源 revisions", composition.source_revisions.map(function (ref) { return ref.source_id + "@" + ref.revision; }).join(", "), identityBox);
        }
        if (Array.isArray(composition.resolution_ids) && composition.resolution_ids.length > 0) hashRow("resolution IDs", composition.resolution_ids.join(", "), identityBox);
        if (Array.isArray(composition.authoring_binding_ids) && composition.authoring_binding_ids.length > 0) hashRow("authoring binding IDs", composition.authoring_binding_ids.join(", "), identityBox);
        if (composition.coverage_snapshot_hash) hashRow("coverage snapshot hash", composition.coverage_snapshot_hash, identityBox);
        if (composition.build_snapshot_hash) {
          var legacyNote = composition.compiled_content_hash === undefined ? "legacy identity" : undefined;
          hashRow("build snapshot hash（build input identity）", composition.build_snapshot_hash, identityBox, legacyNote);
        }
        if (composition.compiled_content_hash) hashRow("compiled content hash（compiler output identity）", composition.compiled_content_hash, identityBox);
        identities.append(identityBox);
        box.append(identities);
        target.append(box);
        if (confirmButton) {
          confirmButton.disabled = currentProvenanceConfirmation.fingerprint === "";
          confirmButton.textContent = Array.isArray(composition.overrides) && composition.overrides.length > 0
            ? "確認覆寫並發布（" + composition.overrides.length + " 筆 active override）"
            : "確認並發布";
        }
        byId("provenance-confirm-message").textContent = "已準備；確認後將以同一份 immutable refs 保存到 Publish Record。";
      }

      function renderProvenanceHistory(view) {
        var target = byId("provenance-history");
        target.textContent = "";
        if (!isRecord(view)) return;
        var historical = Array.isArray(view.historical_decisions) ? view.historical_decisions : [];
        if (historical.length === 0 && view.provenance_summary === undefined && view.legacy_build_snapshot_hash !== true) return;
        var box = document.createElement("div");
        box.className = "workflow-stage";
        var title = document.createElement("div");
        title.className = "workflow-stage-title";
        title.textContent = "歷史與已取代決策（不計入 active composition）";
        box.append(title);
        box.append(overrideList(historical));
        if (view.legacy_build_snapshot_hash === true) {
          var legacy = document.createElement("div");
          legacy.className = "muted";
          legacy.textContent = "此 build 為舊版記錄：build_snapshot_hash 為舊語意（compiled content hash），不是新版 build-input snapshot identity。";
          box.append(legacy);
        }
        target.append(box);
      }

      function loadProvenanceHistory() {
        return requestJson("/workspace/dashboard/provenance").then(function (view) {
          renderProvenanceHistory(view);
          return view;
        }).catch(function (error) {
          setAreaError("provenance-history", error);
          return undefined;
        });
      }

      function renderArtifactList(snapshot) {
        var target = byId("artifact-list");
        target.textContent = "";
        var artifactItems = Array.isArray(snapshot.items) ? snapshot.items : (Array.isArray(snapshot.artifacts) ? snapshot.artifacts : []);
        var groups = Array.isArray(snapshot.artifact_groups) ? snapshot.artifact_groups : [];
        if (groups.length === 0 && artifactItems.length > 0) {
          for (var itemIndex = 0; itemIndex < artifactItems.length; itemIndex += 1) {
            var item = artifactItems[itemIndex];
            if (!isRecord(item)) continue;
            var existing = groups.find(function (candidate) { return isRecord(candidate) && candidate.key === item.key; });
            if (existing) {
              if (!Array.isArray(existing.revisions)) existing.revisions = [];
              existing.revisions.push(item);
              existing.current = item;
            } else {
              groups.push({ key: item.key, current: item, revisions: [item] });
            }
          }
        }
        if (groups.length === 0) {
          byId("artifact-message").textContent = "目前沒有 artifact。";
        } else {
          byId("artifact-message").textContent = "共 " + groups.length + " 個 artifact key（" + (typeof snapshot.total === "number" ? snapshot.total : artifactItems.length) + " 個 revision）。";
        }
        var reviews = Array.isArray(snapshot.reviews) ? snapshot.reviews : [];
        for (var i = 0; i < groups.length; i += 1) {
          var group = groups[i];
          if (!isRecord(group) || !isRecord(group.current)) continue;
          var current = group.current;
          var revisions = Array.isArray(group.revisions) ? group.revisions : [current];
          var row = document.createElement("div");
          row.className = "artifact-row";
          var artifactId = firstString(current, ["id"]);
          if (artifactId) {
            row.setAttribute("data-object-kind", "artifact");
            row.setAttribute("data-object-id", artifactId);
          }
          var badge = document.createElement("span");
          badge.className = "status-badge " + statusClass(firstString(current, ["status"]) || "draft");
          badge.textContent = firstString(current, ["kind"]) || "?";
          var name = document.createElement("span");
          name.textContent = firstString(current, ["name"]) || firstString(current, ["id"]) || "?";
          var currentBadge = document.createElement("span");
          currentBadge.className = "current-badge";
          currentBadge.textContent = "目前版本";
          var meta = document.createElement("span");
          var parts = ["rev " + String(firstString(current, ["revision"]) || "?").slice(0, 8)];
          if (current.created_by) parts.push("by " + current.created_by);
          if (current.blueprint_precheck_id) parts.push("binding " + String(firstString(current, ["blueprint_precheck_revision"]) || "?").slice(0, 8));
          var artifactReviews = reviews.filter(function (review) { return isRecord(review) && review.artifact_id === current.id; });
          if (artifactReviews.length > 0) parts.push("reviewer " + (firstString(artifactReviews[artifactReviews.length - 1], ["reviewer"]) || "?"));
          if (revisions.length > 1) parts.push("歷史 " + revisions.length + " 個 revision");
          meta.textContent = parts.join(" · ");
          var actions = document.createElement("span");
          actions.className = "artifact-actions";
          actions.append(
            makeActionButton("原始內容", function () { toggleArtifactRaw(row, current); }),
            makeActionButton("與前一版差異", function () { toggleArtifactDiff(row, current, revisions); }),
            makeActionButton("送審", function () { submitArtifactForReview(firstString(current, ["name"]) || firstString(current, ["id"]) || ""); }),
            makeActionButton("下載", function () { downloadArtifact(current); }),
            makeActionButton("覆蓋關聯", function () { toggleArtifactLineage(row, current); })
          );
          row.append(badge, currentBadge, name, meta, actions);
          target.append(row);
        }
        var blueprint = snapshot.blueprint;
        byId("blueprint-json").textContent = blueprint === undefined ? "{}" : jsonText(blueprint);
      }

      function makeActionButton(label, handler) {
        var button = document.createElement("button");
        button.type = "button";
        button.className = "action-link";
        button.textContent = label;
        button.addEventListener("click", handler);
        return button;
      }

      function toggleArtifactLineage(row, artifact) {
        var detail = findRowDetail(row, "artifact-lineage");
        if (detail !== null) {
          detail.hidden = !detail.hidden;
          return;
        }
        var artifactId = firstString(artifact, ["id"]);
        if (!artifactId) return;
        var container = document.createElement("div");
        container.className = "artifact-detail artifact-lineage";
        var loading = document.createElement("div");
        loading.textContent = "載入覆蓋關聯…";
        container.append(loading);
        row.append(container);
        requestJson("/workspace/dashboard/artifacts/" + encodeURIComponent(artifactId) + "/coverage").then(function (lineage) {
          container.textContent = "";
          if (lineage === undefined || lineage === null) {
            container.textContent = "此 artifact 不在覆蓋綁定範圍內。";
            return;
          }
          var heading = document.createElement("div");
          heading.className = "detail-heading";
          var badge = document.createElement("span");
          badge.className = "status-badge " + (lineage.state === "current" ? "ready" : "error");
          badge.textContent = lineage.state;
          heading.append(badge);
          heading.append(" 覆蓋綁定");
          container.append(heading);
          if (lineage.reason) {
            var reason = document.createElement("div");
            reason.className = "muted";
            reason.textContent = "原因：" + lineage.reason;
            container.append(reason);
          }
          var parts = [];
          if (lineage.assessment) parts.push("評估 " + lineage.assessment.id + "@" + lineage.assessment.revision.slice(0, 8));
          if (lineage.requirement_set) parts.push("requirement set " + lineage.requirement_set.revision.slice(0, 8));
          if (lineage.fact_projection_revision) parts.push("fact projection " + lineage.fact_projection_revision.slice(0, 8));
          if (lineage.fact_review_run) parts.push("review run " + lineage.fact_review_run.id.slice(0, 8));
          if (lineage.binding) parts.push("binding " + lineage.binding.id.slice(0, 8));
          if (lineage.input_snapshot_hash) parts.push("input snapshot " + lineage.input_snapshot_hash.slice(0, 8));
          if (lineage.resolution_ids && lineage.resolution_ids.length > 0) parts.push("resolutions " + lineage.resolution_ids.map(function (id) { return id.slice(0, 8); }).join(", "));
          var meta = document.createElement("div");
          meta.className = "muted";
          meta.textContent = parts.join(" · ");
          container.append(meta);
        }).catch(function (error) {
          loading.textContent = errorText(error);
        });
      }

      function artifactDisplayContent(artifact) {
        var content = firstString(artifact, ["content"]);
        if (content === "") return content;
        var mediaType = firstString(artifact, ["media_type"]);
        if (mediaType === "application/json") {
          try {
            return JSON.stringify(JSON.parse(content), null, 2);
          } catch (ignore) {
            return content;
          }
        }
        return content;
      }

      function toggleArtifactRaw(row, artifact) {
        var detail = findRowDetail(row, "artifact-raw");
        if (detail !== null) {
          detail.hidden = !detail.hidden;
          return;
        }
        var artifactId = firstString(artifact, ["id"]);
        if (!hasOwn(artifact, "content") && artifactId) {
          var loading = document.createElement("div");
          loading.className = "artifact-detail artifact-raw";
          loading.textContent = "Loading artifact detail…";
          row.append(loading);
          requestJson("/workspace/dashboard/artifacts/" + encodeURIComponent(artifactId)).then(function (fullArtifact) {
            loading.textContent = "";
            var heading = document.createElement("div");
            heading.className = "detail-heading";
            heading.textContent = "Artifact detail";
            var pre = document.createElement("pre");
            pre.textContent = artifactDisplayContent(fullArtifact);
            loading.append(heading, pre);
          }).catch(function (error) {
            loading.textContent = errorText(error);
          });
          return;
        }
        var container = document.createElement("div");
        container.className = "artifact-detail artifact-raw";
        var heading = document.createElement("div");
        heading.className = "detail-heading";
        heading.textContent = "原始內容（rendered：JSON 格式化後顯示）";
        var pre = document.createElement("pre");
        pre.textContent = artifactDisplayContent(artifact);
        container.append(heading, pre);
        row.append(container);
        container.hidden = false;
      }

      function renderArtifactDiff(container, current, previous) {
        var heading = document.createElement("div");
        heading.className = "detail-heading";
        heading.textContent = "Artifact diff";
        if (!isRecord(previous)) {
          heading.textContent = "No previous artifact revision.";
          container.append(heading);
          return;
        }
        heading.textContent = "Diff " + String(firstString(previous, ["revision"]) || "?").slice(0, 8) + " → " + String(firstString(current, ["revision"]) || "?").slice(0, 8);
        var lines = lineDiff(firstString(previous, ["content"]) || "", firstString(current, ["content"]) || "");
        var pre = document.createElement("pre");
        pre.className = "diff-view";
        for (var i = 0; i < lines.length; i += 1) {
          var lineNode = document.createElement("div");
          lineNode.textContent = lines[i].text;
          if (lines[i].type === "added") lineNode.className = "diff-added";
          else if (lines[i].type === "removed") lineNode.className = "diff-removed";
          pre.append(lineNode);
        }
        container.append(heading, pre);
      }

      function toggleArtifactDiff(row, current, revisions) {
        var detail = findRowDetail(row, "artifact-diff");
        if (detail !== null) {
          detail.hidden = !detail.hidden;
          return;
        }
        if (!hasOwn(current, "content") || revisions.length <= 1 || !hasOwn(revisions[revisions.length - 2], "content")) {
          var loading = document.createElement("div");
          loading.className = "artifact-detail artifact-diff";
          loading.textContent = "Loading artifact history…";
          row.append(loading);
          var currentId = firstString(current, ["id"]);
          var key = firstString(current, ["key"]) || currentId || "";
          requestJson("/workspace/dashboard/artifacts/" + encodeURIComponent(key) + "/history?limit=200").then(function (history) {
            var items = Array.isArray(history.items) ? history.items : [];
            var previous = items.length > 1 ? items[items.length - 2] : undefined;
            var currentItem = items.length > 0 ? items[items.length - 1] : current;
            var requests = [];
            if (isRecord(currentItem) && !hasOwn(currentItem, "content") && firstString(currentItem, ["id"])) {
              requests.push(requestJson("/workspace/dashboard/artifacts/" + encodeURIComponent(firstString(currentItem, ["id"]))).then(function (value) { currentItem = value; }));
            }
            if (isRecord(previous) && !hasOwn(previous, "content") && firstString(previous, ["id"])) {
              requests.push(requestJson("/workspace/dashboard/artifacts/" + encodeURIComponent(firstString(previous, ["id"]))).then(function (value) { previous = value; }));
            }
            return Promise.all(requests).then(function () {
              loading.textContent = "";
              renderArtifactDiff(loading, currentItem, previous);
            });
          }).catch(function (error) {
            loading.textContent = errorText(error);
          });
          return;
        }
        var container = document.createElement("div");
        container.className = "artifact-detail artifact-diff";
        var heading = document.createElement("div");
        heading.className = "detail-heading";
        var previous = revisions.length > 1 ? revisions[revisions.length - 2] : undefined;
        if (!isRecord(previous)) {
          heading.textContent = "與前一版差異：這是此 key 的第一版，沒有前一版可比對。";
        } else {
          heading.textContent = "與前一版差異（" + String(firstString(previous, ["revision"]) || "?").slice(0, 8) + " → " + String(firstString(current, ["revision"]) || "?").slice(0, 8) + "）";
          var lines = lineDiff(firstString(previous, ["content"]) || "", firstString(current, ["content"]) || "");
          var pre = document.createElement("pre");
          pre.className = "diff-view";
          pre.textContent = "";
          for (var i = 0; i < lines.length; i += 1) {
            var lineNode = document.createElement("div");
            lineNode.textContent = lines[i].text;
            if (lines[i].type === "added") {
              lineNode.className = "diff-added";
            } else if (lines[i].type === "removed") {
              lineNode.className = "diff-removed";
            }
            pre.append(lineNode);
          }
          container.append(heading, pre);
        }
        row.append(container);
        container.hidden = false;
      }

      function findRowDetail(row, className) {
        for (var i = 0; i < row.children.length; i += 1) {
          var child = row.children[i];
          if (typeof child.className === "string" && child.className.indexOf(className) >= 0) return child;
        }
        return null;
      }

      function lineDiff(previous, current) {
        var oldLines = previous.split("\n");
        var newLines = current.split("\n");
        var rows = [];
        for (var i = 0; i < oldLines.length; i += 1) rows.push({ text: oldLines[i], type: "same" });
        var oldSet = {};
        for (var j = 0; j < oldLines.length; j += 1) oldSet[oldLines[j]] = true;
        var added = [];
        for (var k = 0; k < newLines.length; k += 1) {
          if (oldSet[newLines[k]]) {
            while (added.length > 0) rows.push(added.shift());
          } else {
            added.push({ text: newLines[k], type: "added" });
          }
        }
        while (added.length > 0) rows.push(added.shift());
        var removed = [];
        var newSet = {};
        for (var m = 0; m < newLines.length; m += 1) newSet[newLines[m]] = true;
        var rebuilt = [];
        for (var n = 0; n < rows.length; n += 1) {
          if (rows[n].type === "same" && !newSet[rows[n].text]) {
            removed.push({ text: rows[n].text, type: "removed" });
          } else {
            while (removed.length > 0) rebuilt.push(removed.shift());
            rebuilt.push(rows[n]);
          }
        }
        while (removed.length > 0) rebuilt.push(removed.shift());
        return rebuilt;
      }

      function submitArtifactForReview(name) {
        if (name === "") {
          byId("artifact-message").textContent = "找不到可送審的 artifact 名稱。";
          return;
        }
        postJson("/workspace/request", { request: "Review " + name }).then(function () {
          byId("artifact-message").textContent = "已送出審查請求：" + name;
          refresh();
        }).catch(function (error) {
          setAreaError("artifact-message", error);
        });
      }

      function downloadArtifact(artifact) {
        if (!hasOwn(artifact, "content") && firstString(artifact, ["id"])) {
          requestJson("/workspace/dashboard/artifacts/" + encodeURIComponent(firstString(artifact, ["id"]))).then(downloadArtifact).catch(function (error) {
            setAreaError("artifact-message", error);
          });
          return;
        }
        var content = firstString(artifact, ["content"]);
        if (content === "") {
          byId("artifact-message").textContent = "此 artifact 沒有可下載的內容。";
          return;
        }
        var mediaType = firstString(artifact, ["media_type"]) || "text/plain";
        var extension = mediaType === "application/json" ? ".json" : mediaType === "text/markdown" ? ".md" : ".txt";
        var blob = new Blob([content], { type: mediaType });
        var url = URL.createObjectURL(blob);
        var link = document.createElement("a");
        link.href = url;
        link.download = (firstString(artifact, ["name"]) || firstString(artifact, ["id"]) || "artifact") + extension;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      }

      var cachedOperations = [];
      var OPERATION_FILTERS = { all: "", active: "created,resolving,running,partial", needs_input: "needs_input", failed: "failed", cancelled: "cancelled", terminal: "completed,cancelled,failed" };
      var SEVERITY_RANK = { critical: 4, error: 3, warning: 2, info: 1 };
      var SEVERITIES = ["critical", "error", "warning", "info"];
      var currentOverrides = {};
      var repairPlanHash = "";

      function operationMatchesFilter(operation, filter) {
        var states = OPERATION_FILTERS[filter] || "";
        if (states === "") return true;
        return states.split(",").indexOf(operation.status || "unknown") !== -1;
      }

      function answerNeedsInput(operationId, input) {
        return function () {
          if (state.busy) return;
          var value = input.value.trim();
          if (!value) {
            localValidation("Operation 回答", "回答不可為空。");
            return;
          }
          var body = { request: value, target_operation_id: operationId, operation_id: operationId };
          void runTask("回答 Operation", async function () {
            var payload = await postJson("/workspace/request", body);
            await loadDashboardData();
            return payload;
          });
        };
      }

      function retryOperation(operationId) {
        return function () {
          postOperation("recover", operationId);
        };
      }

      function confirmCancel(operationId) {
        return function () {
          if (state.busy) return;
          if (!window.confirm("確定要取消 operation " + operationId + "？此操作將被標記為取消。")) return;
          postOperation("fail", operationId);
        };
      }

      function renderOperationList(operations) {
        var target = byId("operation-list");
        var filter = byId("operation-filter").value;
        cachedOperations = Array.isArray(operations) ? operations : [];
        target.textContent = "";
        if (cachedOperations.length === 0) {
          byId("operation-message").textContent = "目前沒有 operation。";
          return;
        }
        var visible = [];
        for (var i = 0; i < cachedOperations.length; i += 1) {
          if (isRecord(cachedOperations[i]) && operationMatchesFilter(cachedOperations[i], filter)) visible.push(cachedOperations[i]);
        }
        byId("operation-message").textContent = "共 " + cachedOperations.length + " 個 operation（顯示 " + visible.length + " 個）。";
        for (var j = 0; j < visible.length; j += 1) {
          var operation = visible[j];
          var row = document.createElement("div");
          row.className = "operation-row";
          var badge = document.createElement("span");
          badge.className = "status-badge " + statusClass(operation.status || "unknown");
          badge.textContent = firstString(operation, ["status"]) || "?";
          var label = document.createElement("span");
          var labelParts = [firstString(operation, ["kind"]) || "?", firstString(operation, ["request"]) || ""];
          if (operation.attempt) labelParts.push("attempt " + operation.attempt);
          if (operation.lease_owner) {
            var remainingText = operation.lease_expires_at ? " 剩餘 " + Math.max(0, Math.round((new Date(operation.lease_expires_at).getTime() - Date.now()) / 1000)) + "s" : "";
            labelParts.push("lease " + operation.lease_owner + remainingText);
          }
          if ((operation.status === "running" || operation.status === "partial") && typeof operation.progress_count === "number") labelParts.push("progress " + operation.progress_count);
          if ((operation.status === "running" || operation.status === "partial") && Array.isArray(operation.progress) && operation.progress.length > 0) {
            var lastProgress = operation.progress[operation.progress.length - 1];
            if (isRecord(lastProgress) && firstString(lastProgress, ["message"])) labelParts.push("step: " + firstString(lastProgress, ["message"]));
          }
          if (operation.status === "needs_input" && operation.question) labelParts.push("問題: " + operation.question);
          if (operation.status !== "cancelled" && operation.error_class === "recoverable") labelParts.push("可安全重試");
          if (operation.status !== "cancelled" && operation.error_class === "fatal") labelParts.push("需人工重送");
          if (operation.last_error) labelParts.push("error: " + operation.last_error);
          label.textContent = labelParts.join(" · ");
          row.append(badge, label);
          var actions = document.createElement("span");
          actions.className = "inline-actions";
          var status = operation.status || "unknown";
          if (status === "needs_input") {
            var answer = document.createElement("input");
            answer.type = "text";
            answer.placeholder = "回答此問題…";
            var send = document.createElement("button");
            send.type = "button";
            send.textContent = "送出";
            send.addEventListener("click", answerNeedsInput(operation.id, answer));
            actions.append(answer, send);
          } else if (status === "failed") {
            if (operation.error_class !== "fatal") {
              var retry = document.createElement("button");
              retry.type = "button";
              retry.textContent = "重試";
              retry.addEventListener("click", retryOperation(operation.id));
              actions.append(retry);
            }
          } else if (status === "cancelled") {
            var newReq = document.createElement("button");
            newReq.type = "button";
            newReq.textContent = "建立新工作";
            newReq.addEventListener("click", function () {
              var inputEl = byId("request-input");
              if (inputEl) {
                inputEl.focus();
                inputEl.scrollIntoView({ behavior: "smooth" });
              }
            });
            actions.append(newReq);
          } else if (status === "created" || status === "resolving" || status === "running" || status === "partial") {
            var cancel = document.createElement("button");
            cancel.type = "button";
            cancel.textContent = "取消";
            cancel.addEventListener("click", confirmCancel(operation.id));
            actions.append(cancel);
          }
          row.append(actions);
          target.append(row);
        }
      }

`;
