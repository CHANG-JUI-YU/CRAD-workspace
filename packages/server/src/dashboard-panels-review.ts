export const DASHBOARD_PANELS_REVIEW_JS = `      function renderQuality(snapshot) {
        var quality = snapshot.quality;
        if (quality === undefined) {
          byId("quality-message").textContent = "尚未設定品質門檻。";
          byId("quality-json").textContent = "{}";
          return;
        }
        var level = firstString(quality, ["level"]) || "normal";
        byId("quality-level").value = level;
        byId("quality-message").textContent = "目前門檻： " + level + "（阻擋 " + (firstString(quality, ["blocking_severity"]) || "?") + " 以上）。";
        byId("quality-json").textContent = jsonText(quality);
        currentOverrides = isRecord(quality.overrides) ? quality.overrides : {};
        renderQualityOverrides();
      }

      function renderQualityOverrides() {
        var target = byId("quality-override-list");
        target.textContent = "";
        var codes = Object.keys(currentOverrides);
        if (codes.length === 0) {
          target.textContent = "沒有逐 code 覆寫。";
          return;
        }
        for (var i = 0; i < codes.length; i += 1) {
          var code = codes[i];
          var row = document.createElement("div");
          row.className = "override-row";
          var text = document.createElement("span");
          text.textContent = code + " → " + currentOverrides[code];
          var remove = document.createElement("button");
          remove.type = "button";
          remove.textContent = "移除";
          remove.addEventListener("click", removeQualityOverride(code));
          row.append(text, remove);
          target.append(row);
        }
      }

      function removeQualityOverride(code) {
        return function () {
          delete currentOverrides[code];
          renderQualityOverrides();
          void applyQuality();
        };
      }

      function addQualityOverride() {
        if (state.busy) return;
        var code = byId("quality-code").value.trim();
        if (!code) {
          localValidation("品質覆寫", "請輸入 issue code。");
          return;
        }
        currentOverrides[code] = byId("quality-severity").value;
        byId("quality-code").value = "";
        renderQualityOverrides();
        void applyQuality();
      }

      function postIssueAction(issueId, action, reasonElement, severitySelect) {
        return function () {
          postIssue(issueId, action, reasonElement.value, severitySelect === null ? undefined : severitySelect.value);
        };
      }

      function severityPreview(selectElement, previewElement, issueRecord) {
        return function () {
          previewElement.textContent = "effective " + (firstString(issueRecord, ["effective_severity"]) || "?") + " → " + selectElement.value;
        };
      }

      function renderIssueList(snapshot) {
        var target = byId("issue-list");
        target.textContent = "";
        var issues = Array.isArray(snapshot.issues) ? snapshot.issues : [];
        if (issues.length === 0) {
          target.textContent = "沒有待處理 issue。";
          return;
        }
        for (var i = 0; i < issues.length; i += 1) {
          var issue = issues[i];
          if (!isRecord(issue)) continue;
          var row = document.createElement("div");
          row.className = "issue-row";
          var badge = document.createElement("span");
          badge.className = "status-badge " + (issue.effective_severity === "error" || issue.effective_severity === "critical" ? "error" : "active");
          badge.textContent = firstString(issue, ["effective_severity"]) || firstString(issue, ["severity"]) || "?";
          var text = document.createElement("span");
          var issueText = (firstString(issue, ["code"]) || "?") + "：" + (firstString(issue, ["message"]) || "") + "（" + (firstString(issue, ["status"]) || "?") + "）";
          if (issue.overridable) issueText += "〔可覆寫〕";
          if (isRecord(issue.override)) {
            issueText += " override→" + (firstString(issue.override, ["severity"]) || "?") + " by " + (firstString(issue.override, ["by"]) || "?") + "（" + (firstString(issue.override, ["reason"]) || "") + "）";
          }
          text.textContent = issueText;
          row.append(badge, text);
          var actions = document.createElement("span");
          actions.className = "inline-actions";
          if (issue.status === "open") {
            var reason = document.createElement("input");
            reason.type = "text";
            reason.placeholder = "原因（必填）…";
            var resolve = document.createElement("button");
            resolve.type = "button";
            resolve.textContent = "已解決";
            resolve.addEventListener("click", postIssueAction(issue.id, "resolve", reason, null));
            actions.append(reason, resolve);
            if (issue.overridable) {
              var ignore = document.createElement("button");
              ignore.type = "button";
              ignore.textContent = "忽略";
              ignore.addEventListener("click", postIssueAction(issue.id, "ignore", reason, null));
              actions.append(ignore);
              var effectiveRank = SEVERITY_RANK[issue.effective_severity] || 4;
              var select = document.createElement("select");
              select.setAttribute("aria-label", "覆寫目標嚴重度");
              for (var s = 0; s < SEVERITIES.length; s += 1) {
                if ((SEVERITY_RANK[SEVERITIES[s]] || 0) < effectiveRank) {
                  var option = document.createElement("option");
                  option.value = SEVERITIES[s];
                  option.textContent = SEVERITIES[s];
                  select.append(option);
                }
              }
              var preview = document.createElement("span");
              preview.className = "readiness-hint";
              preview.textContent = "effective " + (firstString(issue, ["effective_severity"]) || "?") + " → " + select.value;
              select.addEventListener("change", severityPreview(select, preview, issue));
              var override = document.createElement("button");
              override.type = "button";
              override.textContent = "覆寫";
              override.addEventListener("click", postIssueAction(issue.id, "override", reason, select));
              actions.append(ignore, select, preview, override);
            }
          }
          row.append(actions);
          target.append(row);
        }
      }

      function postIssue(issueId, action, reason, severity) {
        if (state.busy) return;
        var reasonValue = typeof reason === "string" ? reason.trim() : "";
        if (!reasonValue) {
          localValidation("Issue 操作", "請填寫原因後再操作。");
          return;
        }
        var body = { issue_id: issueId, action: action, reason: reasonValue };
        if (severity !== undefined) body.severity = severity;
        void runTask("更新 issue", async function () {
          var payload = await postJson("/workspace/issue", body);
          await refreshAfterAction();
          return payload;
        });
      }

      function submitFactDecision(run, occurrenceId, statement, selectElement, reasonElement, endpoint) {
        var reason = reasonElement.value;
        if (!reason || !reason.trim()) { localValidation("fact-review-run", "事實裁決需要原因。"); return; }
        postJson(endpoint, {
          decisions: [{ candidate_occurrence_id: occurrenceId, claim: statement, decision: selectElement.value, reason: reason }],
          run_id: run.id,
          expected_projection_revision: run.projection_revision || run.review_projection_revision || run.candidate_set_revision
        }).then(function () { reasonElement.value = ""; refresh(); }).catch(function (error) { setAreaError("fact-review-run", error); });
      }

      function factAdjudicationRow(run, occurrenceId, statement, status, conflictOnly) {
        var row = document.createElement("div");
        row.className = "fact-row fact-adjudication";
        var text = document.createElement("span");
        text.textContent = (statement || "?") + (status === "conflict" ? "（衝突，需 Director）" : "");
        row.append(text);
        var select = document.createElement("select");
        var options = [["accept", "接受"], ["reject", "拒絕"], ["needs_evidence", "需補證據"], ["conflict", "衝突"]];
        for (var o = 0; o < options.length; o += 1) {
          var option = document.createElement("option");
          option.value = options[o][0];
          option.textContent = options[o][1];
          select.append(option);
        }
        var reason = document.createElement("input");
        reason.type = "text";
        reason.placeholder = "裁決原因（必填）";
        row.append(select, reason);
        var submit = document.createElement("button");
        submit.className = "button";
        submit.textContent = conflictOnly ? "Director 解析" : "送出裁決";
        submit.addEventListener("click", function () {
          submitFactDecision(run, occurrenceId, statement, select, reason, conflictOnly ? "/workspace/fact/review/conflict" : "/workspace/fact/review/batch");
        });
        row.append(submit);
        return row;
      }

      function evidenceSourceDetailElement(source) {
        var box = document.createElement("div");
        box.className = "workflow-stage";
        var title = document.createElement("div");
        title.className = "workflow-stage-title";
        var label = document.createElement("span");
        label.textContent = "來源 " + (firstString(source, ["title"]) || firstString(source, ["id"]) || "?");
        title.append(label);
        box.append(title);
        var meta = document.createElement("div");
        meta.className = "muted";
        var metaParts = [];
        if (source.id) metaParts.push("id " + source.id);
        if (source.revision) metaParts.push("revision " + String(source.revision).slice(0, 8));
        if (source.media_type) metaParts.push("型別 " + source.media_type);
        if (source.canonical_text) metaParts.push("chars " + source.canonical_text.length);
        meta.textContent = metaParts.join(" · ");
        box.append(meta);
        if (source.canonical_text) {
          var body = document.createElement("div");
          body.className = "muted";
          body.textContent = "內文：" + source.canonical_text.slice(0, 600);
          box.append(body);
        }
        if (source.url) {
          var link = document.createElement("a");
          link.href = source.url;
          link.target = "_blank";
          link.rel = "noopener";
          link.textContent = "開啟外部來源";
          box.append(link);
        }
        return box;
      }

      function showEvidenceSourceDetail(sourceId) {
        var target = byId("evidence-source-detail");
        target.textContent = "";
        if (!sourceId) { target.textContent = "無法開啟來源：缺少來源 ID。"; return; }
        target.textContent = "載入來源…";
        requestJson("/workspace/dashboard/sources/" + encodeURIComponent(sourceId)).then(function (source) {
          target.textContent = "";
          target.append(evidenceSourceDetailElement(source));
        }).catch(function (error) {
          target.textContent = "";
          setAreaError("evidence-message", error);
        });
      }

      function evidenceContextBlock(ctx) {
        var box = document.createElement("div");
        box.className = "workflow-stage";
        var title = document.createElement("div");
        title.className = "workflow-stage-title";
        var titleParts = [];
        if (ctx.stale) {
          var staleBadge = document.createElement("span");
          staleBadge.className = "status-badge error";
          staleBadge.textContent = ctx.stale_reason || "證據已過期";
          title.append(staleBadge);
        }
        var label = document.createElement("span");
        label.textContent = ctx.source_title || ctx.source_id || "來源";
        title.append(label);
        box.append(title);
        var meta = document.createElement("div");
        meta.className = "muted";
        var metaParts = [];
        metaParts.push("revision " + String(ctx.source_revision || "").slice(0, 8));
        if (ctx.chunk_id) metaParts.push("chunk " + String(ctx.chunk_id).slice(0, 8) + (ctx.chunk_hash ? "@" + String(ctx.chunk_hash).slice(0, 8) : ""));
        if (ctx.section_heading) metaParts.push("章節 " + ctx.section_heading);
        if (ctx.paragraph) metaParts.push("段落 " + ctx.paragraph);
        meta.textContent = metaParts.join(" · ");
        box.append(meta);
        if (ctx.preceding_context || ctx.evidence_span || ctx.following_context) {
          var passage = document.createElement("div");
          passage.className = "evidence-passage";
          if (ctx.preceding_context) passage.append(document.createTextNode(ctx.preceding_context));
          if (ctx.evidence_span && ctx.evidence_span.quote) {
            var quote = document.createElement("strong");
            quote.textContent = ctx.evidence_span.quote;
            passage.append(quote);
          }
          if (ctx.following_context) passage.append(document.createTextNode(ctx.following_context));
          box.append(passage);
        }
        var viewButton = document.createElement("button");
        viewButton.type = "button";
        viewButton.textContent = "查看來源";
        viewButton.addEventListener("click", function () { showEvidenceSourceDetail(ctx.source_id); });
        box.append(viewButton);
        return box;
      }

      function renderEvidence(page) {
        var target = byId("evidence-list");
        target.textContent = "";
        if (page === null || page === undefined) {
          byId("evidence-message").textContent = "尚未取得證據上下文。";
          return;
        }
        var candidates = Array.isArray(page.candidates) ? page.candidates : [];
        if (candidates.length === 0) {
          byId("evidence-message").textContent = "沒有待裁決的候選事實。";
          return;
        }
        byId("evidence-message").textContent = "候選事實 " + candidates.length + " 筆；每筆顯示完整證據上下文。";
        for (var i = 0; i < candidates.length; i += 1) {
          var candidate = candidates[i];
          if (!isRecord(candidate)) continue;
          var row = document.createElement("div");
          row.className = "fact-row fact-adjudication";
          var text = document.createElement("span");
          text.textContent = (firstString(candidate, ["statement"]) || "?");
          row.append(text);
          var contexts = Array.isArray(candidate.evidence_context) ? candidate.evidence_context : [];
          for (var c = 0; c < contexts.length; c += 1) {
            row.append(evidenceContextBlock(contexts[c]));
          }
          if (isRecord(page.run)) {
            var runView = page.run;
            if (page.projection_revision) runView.projection_revision = page.projection_revision;
            var select = document.createElement("select");
            var options = [["accept", "接受"], ["reject", "拒絕"], ["needs_evidence", "需補證據"], ["conflict", "衝突"]];
            for (var o = 0; o < options.length; o += 1) {
              var option = document.createElement("option");
              option.value = options[o][0];
              option.textContent = options[o][1];
              select.append(option);
            }
            var reason = document.createElement("input");
            reason.type = "text";
            reason.placeholder = "裁決原因（必填）";
            var submit = document.createElement("button");
            submit.className = "button";
            submit.textContent = "送出裁決";
            submit.addEventListener("click", function () {
              submitFactDecision(runView, candidate.candidate_occurrence_id, candidate.statement, select, reason, "/workspace/fact/review/batch");
            });
            row.append(select, reason, submit);
          }
          target.append(row);
        }
      }

      async function loadEvidenceData() {
        try {
          var page = await requestJson("/workspace/dashboard/fact-review/evidence");
          renderEvidence(page);
          return page;
        } catch (error) {
          setAreaError("evidence-message", error);
          throw error;
        }
      }

      function renderSourceFact(snapshot) {
        var candidates = Array.isArray(snapshot.candidates) ? snapshot.candidates : [];
        var sources = Array.isArray(snapshot.sources) ? snapshot.sources : [];
        var facts = Array.isArray(snapshot.facts) ? snapshot.facts : [];
        var runs = Array.isArray(snapshot.review_runs) ? snapshot.review_runs : [];
        var candidateTarget = byId("candidate-list");
        candidateTarget.textContent = "";
        candidateTarget.textContent = candidates.length === 0 ? "沒有候選來源。" : "候選來源 " + candidates.length + " 筆";
        for (var i = 0; i < candidates.length; i += 1) {
          var candidate = candidates[i];
          if (!isRecord(candidate)) continue;
          var row = document.createElement("div");
          row.className = "fact-row";
          var badge = document.createElement("span");
          badge.className = "status-badge " + statusClass(candidate.status || "pending");
          badge.textContent = firstString(candidate, ["status"]) || "?";
          var text = document.createElement("span");
          var candidateLabel = (firstString(candidate, ["title"]) || "?") + (candidate.official ? "（官方）" : "");
          if (candidate.url) {
            var link = document.createElement("a");
            link.href = candidate.url;
            link.target = "_blank";
            link.rel = "noopener";
            link.textContent = candidateLabel;
            text.append(link);
          } else {
            text.textContent = candidateLabel;
          }
          row.append(badge, text);
          if (candidate.selection_snapshot && candidate.status === "approved") {
            var approved = document.createElement("span");
            approved.className = "status-badge ok";
            approved.textContent = "已選入（approved）";
            row.append(approved);
          }
          if (candidate.selection_snapshot && candidate.status === "rejected") {
            var rejected = document.createElement("span");
            rejected.className = "status-badge bad";
            rejected.textContent = "已拒絕（rejected）";
            row.append(rejected);
          }
          if (candidate.failure && isRecord(candidate.failure)) {
            var failure = document.createElement("span");
            failure.className = "status-badge bad";
            failure.textContent = "擷取失敗：" + (firstString(candidate.failure, ["code"]) || "?") + " " + (firstString(candidate.failure, ["message"]) || "");
            row.append(failure);
          }
          candidateTarget.append(row);
        }
        var sourceTarget = byId("source-list");
        sourceTarget.textContent = "";
        sourceTarget.textContent = sources.length === 0 ? "沒有已入庫來源。" : "已入庫來源 " + sources.length + " 筆";
        for (var j = 0; j < sources.length; j += 1) {
          var source = sources[j];
          if (!isRecord(source)) continue;
          var sourceRow = document.createElement("div");
          sourceRow.className = "fact-row";
          if (firstString(source, ["id"])) {
            sourceRow.setAttribute("data-object-kind", "source");
            sourceRow.setAttribute("data-object-id", firstString(source, ["id"]));
          }
          var sourceParts = [];
          sourceParts.push(firstString(source, ["title"]) || "?");
          if (source.media_type) sourceParts.push(source.media_type);
          if (source.revision) sourceParts.push("r" + String(source.revision).slice(0, 8));
          if (typeof source.chunk_count === "number") sourceParts.push("chunks " + source.chunk_count);
          if (typeof source.canonical_chars === "number") sourceParts.push("chars " + source.canonical_chars);
          sourceRow.textContent = sourceParts.join(" · ");
          if (source.url) {
            var sourceLink = document.createElement("a");
            sourceLink.href = source.url;
            sourceLink.target = "_blank";
            sourceLink.rel = "noopener";
            sourceLink.textContent = "開啟來源";
            sourceRow.append(sourceLink);
          }
          sourceTarget.append(sourceRow);
        }
        var factTarget = byId("fact-list");
        factTarget.textContent = "";
        factTarget.textContent = facts.length === 0 ? "沒有知識事實。" : "知識事實 " + facts.length + " 筆";
        for (var k = 0; k < facts.length; k += 1) {
          var fact = facts[k];
          if (!isRecord(fact)) continue;
          var factRow = document.createElement("div");
          factRow.className = "fact-row";
          if (firstString(fact, ["id"])) {
            factRow.setAttribute("data-object-kind", "fact");
            factRow.setAttribute("data-object-id", firstString(fact, ["id"]));
          }
          var factBadge = document.createElement("span");
          factBadge.className = "status-badge " + statusClass(fact.status || "candidate");
          factBadge.textContent = firstString(fact, ["status"]) || "?";
          var factText = document.createElement("span");
          var statement = (firstString(fact, ["statement"]) || "");
          if (fact.status === "conflict") statement += "（待 Director 解析）";
          factText.textContent = statement;
          factRow.append(factBadge, factText);
          var factMeta = document.createElement("span");
          var factParts = [];
          if (typeof fact.fact_revision === "number") factParts.push("r" + fact.fact_revision);
          if (Array.isArray(fact.source_ids)) factParts.push("來源 " + fact.source_ids.length);
          if (fact.evidence_quote) factParts.push("引文：" + fact.evidence_quote);
          if (fact.locator) factParts.push("L:" + fact.locator);
          if (fact.chunk_id) factParts.push("chunk " + String(fact.chunk_id).slice(0, 8));
          if (fact.last_reviewer) factParts.push("reviewer " + fact.last_reviewer + "：" + (fact.last_decision || "?"));
          if (Array.isArray(fact.coverage) && fact.coverage.length > 0) factParts.push("coverage: " + fact.coverage.join("、"));
          factMeta.textContent = factParts.join(" · ");
          factRow.append(factMeta);
          factTarget.append(factRow);
        }
        var runTarget = byId("fact-review-run");
        runTarget.textContent = "";
        var latestRun = runs.length > 0 ? runs[runs.length - 1] : undefined;
        if (!isRecord(latestRun)) {
          runTarget.textContent = "尚未建立事實 Review Run。";
          var startButton = document.createElement("button");
          startButton.className = "button";
          startButton.textContent = "建立 Review Run";
          startButton.addEventListener("click", function () {
            postJson("/workspace/fact/review/run", {}).then(function () { refresh(); }).catch(function (error) { setAreaError("fact-review-run", error); });
          });
          runTarget.append(startButton);
          return;
        }
        var runHeading = document.createElement("div");
        runHeading.className = "fact-row";
        if (firstString(latestRun, ["id"])) {
          runHeading.setAttribute("data-object-kind", "review_run");
          runHeading.setAttribute("data-object-id", firstString(latestRun, ["id"]));
        }
        var runBadge = document.createElement("span");
        runBadge.className = "status-badge " + statusClass(firstString(latestRun, ["status"]) || "open");
        runBadge.textContent = "run " + (firstString(latestRun, ["status"]) || "open");
        var runMeta = document.createElement("span");
        var runParts = ["候選 " + (Array.isArray(latestRun.candidate_occurrence_ids) ? latestRun.candidate_occurrence_ids.length : 0)];
        if (latestRun.candidate_set_revision) runParts.push("candidate set " + String(latestRun.candidate_set_revision).slice(0, 8));
        if (latestRun.created_by) runParts.push("by " + latestRun.created_by);
        runMeta.textContent = runParts.join(" · ");
        runHeading.append(runBadge, runMeta);
        runTarget.append(runHeading);
        var adjudicated = new Set();
        if (Array.isArray(latestRun.decisions)) {
          for (var d = 0; d < latestRun.decisions.length; d += 1) {
            adjudicated.add(latestRun.decisions[d].candidate_occurrence_id);
          }
        }
        var candidatesForRun = Array.isArray(latestRun.candidates) ? latestRun.candidates : [];
        for (var m = 0; m < candidatesForRun.length; m += 1) {
          var runCandidate = candidatesForRun[m];
          if (!isRecord(runCandidate)) continue;
          if (adjudicated.has(runCandidate.candidate_occurrence_id)) continue;
          var isConflict = runCandidate.status === "conflict";
          runTarget.append(factAdjudicationRow(latestRun, runCandidate.candidate_occurrence_id, runCandidate.statement, runCandidate.status, isConflict));
        }
        if (candidatesForRun.length > 0 && adjudicated.size >= candidatesForRun.length) {
          var completeNote = document.createElement("div");
          completeNote.className = "muted";
          completeNote.textContent = "此 run 的所有候選事實都已裁決；可建立新 Review Run 進行下一輪。";
          runTarget.append(completeNote);
        }
      }

`;
