import type { ArtifactReference } from "@card-workspace/schemas";

import { workflowFail } from "./errors.js";

export interface InterviewAnswer {
  questionId: string;
  actor: string;
  answer: string;
  inputRevisions: ArtifactReference[];
  answeredAt: string;
}

export function recordInterviewAnswer(answer: InterviewAnswer): InterviewAnswer {
  if (answer.answer.trim() === "") workflowFail("INTERVIEW_ANSWER_EMPTY", "interview answer 不可為空");
  return { ...answer, inputRevisions: [...answer.inputRevisions] };
}
