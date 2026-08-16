import { describe, expect, it } from "vitest";
import { CoreError } from "@st-workspace/core";
import { httpStatusFor, structuredError, type ErrorPayload } from "../src/errors.js";

const EMITTED_CODES = [
  "ADAPTATION_DECISION_FACT_INVALID",
  "AGENT_CAPABILITY_DENIED",
  "AGENT_READ_ONLY",
  "AGENT_UNKNOWN",
  "ATTACHMENT_REQUIRED",
  "BLUEPRINT_CHARACTER_REQUIRED",
  "BLUEPRINT_PRECHECK_REQUIRED",
  "BLUEPRINT_REQUIRED",
  "BUILD_MODE_INVALID",
  "CARD_IMAGE_DECODE_FAILED",
  "CARD_IMAGE_REQUIRED",
  "CHARACTER_AUTHORING_ORDER",
  "CHARACTER_SETTINGS_REQUIRED",
  "COVERAGE_ASSESSMENT_STALE",
  "COVERAGE_RESEARCH_TASK_ALREADY_RECOVERED",
  "COVERAGE_RESEARCH_TASK_STALE",
  "COVERAGE_RESEARCH_TASK_TERMINAL",
  "COVERAGE_RESEARCH_TARGET_INELIGIBLE",
  "COVERAGE_RESOLUTION_INVALID",
  "COVERAGE_RESOLUTION_DUPLICATE",
  "TRANSACTION_RECOVERY_REQUIRED",
  "TRANSACTION_RECOVERY_UNCERTAIN",
  "DASHBOARD_CURSOR_INVALID",
  "DASHBOARD_CURSOR_STALE",
  "DASHBOARD_FILTER_INVALID",
  "DASHBOARD_PATH_INVALID",
  "DASHBOARD_QUERY_INVALID",
  "EXTERNAL_HOST_AUTH_REQUIRED",
  "FACT_REFERENCE_INVALID",
  "IDEMPOTENCY_CONFLICT",
  "IMAGE_CHARACTER_NOT_IN_ROSTER",
  "IMAGE_NOT_FOUND",
  "INTERVIEW_ANSWER_EMPTY",
  "INTERVIEW_MULTI_ROSTER_INCOMPLETE",
  "INTERVIEW_OPERATION_NOT_FOUND",
  "INTERVIEW_PRECHECK_INVALID",
  "INTERVIEW_PRECHECK_STALE",
  "INTERVIEW_REQUIRED",
  "LEGACY_CARD_NOT_FOUND",
  "LEGACY_CARD_UNREADABLE",
  "MODE_SELECTION_REQUIRED",
  "OPERATION_COMMAND_INVALID",
  "OPERATION_LEASE_LOST",
  "OPERATION_NOT_CANCELLABLE",
  "OPERATION_NOT_FOUND",
  "OPERATION_NOT_RECOVERABLE",
  "OPERATION_NOT_RESUMABLE",
  "PROJECT_MANAGER_REQUIRED",
  "PROJECT_NOT_FOUND",
  "PROJECT_SELECTION_AMBIGUOUS",
  "PROJECT_SELECTION_INVALID",
  "PROVENANCE_CONFIRMATION_STALE",
  "PUBLISH_DOWNLOAD_HASH_MISMATCH",
  "PUBLISH_DOWNLOAD_KIND_INVALID",
  "PUBLISH_DOWNLOAD_LEGACY",
  "PUBLISH_DOWNLOAD_MISSING",
  "PUBLISH_DOWNLOAD_PATH_INVALID",
  "PUBLISH_ID_REQUIRED",
  "PUBLISH_NOT_FOUND",
  "REQUEST_EMPTY",
  "SOURCE_SELECTION_EMPTY",
  "TEMPLATE_KIND_REQUIRED",
  "TEMPLATE_SCHEMA_INVALID",
  "UNAUTHORIZED",
  "URL_CONTENT_EMPTY",
  "URL_CONTENT_INVALID",
  "URL_FETCH_FAILED",
  "URL_FETCHER_UNAVAILABLE",
  "WORLD_AUTHORING_ORDER",
  "ZHUJI_SCHEMA_INVALID",
  "ADAPTATION_DECISION_REQUIRED",
  "ANSWER_REQUIRED",
  "CHARACTER_ID_REQUIRED",
  "COVERAGE_RESEARCH_REQUIRED",
  "COVERAGE_RESOLUTION_REQUIRED",
  "COVERAGE_SUPPLEMENT_REQUIRED",
  "COVER_SELECT_REQUIRED",
  "FACT_DECISIONS_REQUIRED",
  "IMAGE_INPUT_REQUIRED",
  "IMAGE_ID_REQUIRED",
  "INTERVIEW_AMEND_PREVIEW_REQUIRED",
  "INTERVIEW_AMEND_REQUIRED",
  "INTERVIEW_CHOICE_INVALID",
  "ISSUE_UPDATE_REQUIRED",
  "OPERATION_ID_REQUIRED",
  "PROJECT_REQUIRED",
  "PROVENANCE_CONFIRMATION_REQUIRED",
  "QUALITY_LEVEL_REQUIRED",
  "SOURCE_IDS_REQUIRED",
  "REQUEST_REQUIRED",
  "SOURCE_SELECTION_REQUIRED",
  "DASHBOARD_ARTIFACT_NOT_FOUND",
  "DASHBOARD_ARTIFACT_COVERAGE_NOT_FOUND",
  "DASHBOARD_SOURCE_NOT_FOUND",
  "DASHBOARD_CANDIDATE_NOT_FOUND",
  "DASHBOARD_OPERATION_NOT_FOUND",
  "DASHBOARD_REVIEW_RUN_NOT_FOUND",
  "REQUEST_INVALID_JSON",
  "REQUEST_INVALID_UTF8",
  "REQUEST_TOO_LARGE",
];

describe("structured error catalog completeness", () => {
  it("covers every code emitted by routes and runtime", () => {
    for (const code of EMITTED_CODES) {
      const payload = structuredError(new CoreError(code, `internal detail for ${code}`, true));
      expect(payload.code, `emitted code ${code} must be catalogued`).toBe(code);
      expect(payload.message_zh, `${code} must use catalogued copy, not the raw message`).not.toBe(`internal detail for ${code}`);
      expect(payload.impact.length).toBeGreaterThan(0);
      expect(payload.next_actions.length).toBeGreaterThan(0);
    }
  });

  it("does not leak the raw message for a catalogued code", () => {
    const payload = structuredError(new CoreError("REQUEST_REQUIRED", "Invalid request: nested path secrets", true));
    expect(payload.message_zh).not.toContain("secrets");
    expect(payload.error).toBe("Invalid request: nested path secrets");
  });

  it("maps an uncatalogued code to INTERNAL_ERROR without leaking the message", () => {
    const payload = structuredError(new CoreError("SOME_FUTURE_CODE", "sensitive internal failure", true));
    expect(payload.code).toBe("INTERNAL_ERROR");
    expect(payload.uncatalogued_code).toBe("SOME_FUTURE_CODE");
    expect(payload.message_zh).not.toContain("sensitive");
    expect(payload.message_zh).toContain("內部錯誤");
    expect(payload.recoverable).toBe(true);
  });

  it("maps a non-CoreError to INTERNAL_ERROR", () => {
    const payload = structuredError(new Error("stack trace secret"));
    expect(payload.code).toBe("INTERNAL_ERROR");
    expect(payload.message_zh).not.toContain("stack trace secret");
    expect(payload.error).toBe("stack trace secret");
  });

  it("maps a non-Error value to INTERNAL_ERROR", () => {
    const payload = structuredError("some random throw");
    expect(payload.code).toBe("INTERNAL_ERROR");
  });

  it("preserves safe details from a CoreError", () => {
    const payload = structuredError(new CoreError("REVISION_CONFLICT", "expected 3 but got 4", true, { expected: 3, actual: 4 }));
    expect(payload.details).toEqual({ expected: 3, actual: 4 });
  });
});

describe("httpStatusFor semantic mapping", () => {
  const payloadFor = (code: string, recoverable: boolean): ErrorPayload =>
    structuredError(new CoreError(code, `msg ${code}`, recoverable));

  it("maps authorization failures to 401", () => {
    expect(httpStatusFor(payloadFor("UNAUTHORIZED", true))).toBe(401);
    expect(httpStatusFor(payloadFor("EXTERNAL_HOST_AUTH_REQUIRED", true))).toBe(401);
  });

  it("maps agent capability denials to 403", () => {
    expect(httpStatusFor(payloadFor("AGENT_CAPABILITY_DENIED", true))).toBe(403);
    expect(httpStatusFor(payloadFor("AGENT_READ_ONLY", true))).toBe(403);
  });

  it("maps not-found codes to 404", () => {
    expect(httpStatusFor(payloadFor("NOT_FOUND", false))).toBe(404);
    expect(httpStatusFor(payloadFor("IMAGE_NOT_FOUND", true))).toBe(404);
    expect(httpStatusFor(payloadFor("OPERATION_NOT_FOUND", true))).toBe(404);
  });

  it("maps conflicts to 409", () => {
    expect(httpStatusFor(payloadFor("REVISION_CONFLICT", true))).toBe(409);
    expect(httpStatusFor(payloadFor("IDEMPOTENCY_CONFLICT", true))).toBe(409);
  });

  it("maps oversized bodies to 413", () => {
    expect(httpStatusFor(payloadFor("REQUEST_TOO_LARGE", true))).toBe(413);
  });

  it("maps internal and non-recoverable errors to 500", () => {
    expect(httpStatusFor(payloadFor("INTERNAL_ERROR", false))).toBe(500);
    expect(httpStatusFor(payloadFor("OPERATION_LEASE_LOST", false))).toBe(500);
  });

  it("maps recoverable input errors to 400", () => {
    expect(httpStatusFor(payloadFor("REQUEST_REQUIRED", true))).toBe(400);
    expect(httpStatusFor(payloadFor("ANSWER_REQUIRED", true))).toBe(400);
  });
});
