import { permanentQuestionCode } from "@/lib/answerKeys";
import type { ExamProgress, ProjectQuestion } from "@/types/ict";

export type ReportPassLabel = "PASSED" | "FAILED" | "IN_PROGRESS" | "SUBMITTED" | "-";

/** Report-only pass label. Drafts are never FAILED even if DB passed is false. */
export function reportPassLabel(exam: Pick<ExamProgress, "status" | "passed" | "graded_at">): ReportPassLabel {
  if (exam.status === "draft") return "IN_PROGRESS";
  if (exam.status !== "submitted") return "-";
  if (!exam.graded_at) return "SUBMITTED";
  if (exam.passed === true) return "PASSED";
  if (exam.passed === false) return "FAILED";
  return "SUBMITTED";
}

export function isReportFailed(exam: Pick<ExamProgress, "status" | "passed" | "graded_at">): boolean {
  return reportPassLabel(exam) === "FAILED";
}

export function isReportPassed(exam: Pick<ExamProgress, "status" | "passed" | "graded_at">): boolean {
  return reportPassLabel(exam) === "PASSED";
}

export function reportQuestionHeader(question: ProjectQuestion): string {
  const code = permanentQuestionCode(question);
  return code || `UNCODED:${question.id.slice(0, 8)}`;
}

export function mapAnswersByQuestionCode(
  answers: Record<string, string> | undefined,
  questions: ProjectQuestion[],
  mapMcq: (answer: string, options: string[] | undefined) => string
): Record<string, string> {
  const mapped: Record<string, string> = {};
  for (const question of questions) {
    const code = reportQuestionHeader(question);
    const raw = answers?.[question.id] || "";
    mapped[code] = question.type === "mcq" ? mapMcq(raw, question.options) : raw;
  }
  return mapped;
}
