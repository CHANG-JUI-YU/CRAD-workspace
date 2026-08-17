export const DASHBOARD_ACTIONS_JS = `      function submitRequest() {
        if (state.busy) return;
        var request = byId("request-input").value.trim();
        if (!request) {
          localValidation("自然語言操作", "Request 不可為空。");
          return;
        }
        var body = { request: request };
        var agent = byId("agent-select").value;
        if (agent) body.agent = agent;
        void runTask("自然語言操作", async function () {
          try {
            var payload = await postJson("/workspace/request", body);
            cradDraftStore.clearDraft("request");
            await refreshAfterAction();
            return payload;
          } catch (error) {
            cradDraftStore.saveDraft("request", request, state.interviewRevision);
            throw error;
          }
        });
      }

      function selectProject() {
        if (state.busy) return;
        var project = byId("project-select").value;
        if (!project) {
          localValidation("切換專案", "目前沒有可提交的專案選擇。");
          return;
        }
        void runTask("切換專案", async function () {
          var payload = await postJson("/workspace/project/select", { project: project });
          await transitionProjectContext(project);
          return payload;
        });
      }

      function submitInterviewAnswer(answer) {
        if (state.busy) return;
        var value = typeof answer === "string" ? answer : String(answer);
        if (!value.trim()) {
          localValidation("提交訪談回答", "回答不可為空。");
          return;
        }
        byId("interview-answer-input").value = value;
        void runTask("提交訪談回答", async function () {
          try {
            var payload = await postJson("/workspace/interview/answer", { answer: value.trim() });
            cradDraftStore.clearDraft("interview");
            await refreshAfterAction();
            return payload;
          } catch (error) {
            cradDraftStore.saveDraft("interview", value, state.interviewRevision);
            throw error;
          }
        });
      }

      function previewInterviewAmend() {
        if (state.busy || state.amendQuestionId === null) return;
        var questionId = state.amendQuestionId;
        var answer = byId("amend-answer-input").value.trim();
        if (!answer) {
          localValidation("預覽修訂", "修訂回答不可為空。");
          return;
        }
        cradDraftStore.saveDraft("interview_amend", answer, state.interviewRevision, questionId);
        void runTask("預覽修訂影響", async function () {
          var preview = await postJson("/workspace/interview/amend-preview", { question_id: questionId, answer: answer });
          renderAmendPreview(preview);
          return preview;
        });
      }

      function confirmInterviewAmend() {
        if (state.busy || state.amendQuestionId === null || state.amendPreview === null || state.amendPreview.noop === true) return;
        var questionId = state.amendQuestionId;
        var answer = byId("amend-answer-input").value.trim();
        if (!answer) return;
        state.amendInFlight = true;
        var confirmButton = byId("amend-confirm");
        if (confirmButton) confirmButton.disabled = true;
        void runTask("確認修訂", async function () {
          try {
            var payload = await postJson("/workspace/interview/amend", { question_id: questionId, answer: answer });
            cradDraftStore.clearDraft("interview_amend", questionId);
            closeAmendArea();
            await refreshAfterAction();
            return payload;
          } catch (error) {
            cradDraftStore.saveDraft("interview_amend", answer, state.interviewRevision, questionId);
            reconcileExternalChanges();
            throw error;
          } finally {
            state.amendInFlight = false;
            var button = byId("amend-confirm");
            if (button) button.disabled = false;
          }
        });
      }

      function cancelInterviewAmend() {
        closeAmendArea();
      }

      function discardAllDrafts() {
        cradDraftStore.clearProjectDrafts();
        reconcileExternalChanges();
        var requestInput = byId("request-input");
        if (requestInput && document.activeElement !== requestInput) requestInput.value = "";
        var interviewInput = byId("interview-answer-input");
        if (interviewInput && document.activeElement !== interviewInput) interviewInput.value = "";
        setNotice("info", "已捨棄目前專案的所有草稿。");
      }

`;
