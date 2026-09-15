import { z } from "zod";
import { formatQuestionCode, parseQuestionCode } from "@/lib/answerKeys";

export const questionCodeSchema = z
  .string()
  .trim()
  .regex(/^Q\d{1,4}$/i, "รหัสข้อต้องเป็นรูปแบบ Q001")
  .transform((value) => formatQuestionCode(parseQuestionCode(value) || 1));

export const optionalAnswerKeySchema = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((value) => {
    const trimmed = (value ?? "").trim();
    return trimmed.length > 0 ? trimmed : undefined;
  });

export const examQuestionDraftSchema = z.object({
  id: z.string().trim().min(1, "ต้องมีรหัสข้อภายใน"),
  project_id: z.string().trim().min(1, "ต้องระบุโครงการ"),
  prompt: z.string().trim().min(1, "กรุณากรอกโจทย์"),
  type: z.enum(["mcq", "open_ended", "short"]),
  correct_answer: optionalAnswerKeySchema,
});

/** Accepts UUID, Q001, or blank answer. Blank answer is allowed for draft keys. */
export const answerKeyWriteSchema = z
  .object({
    questionId: z.union([z.string(), z.null(), z.undefined()]).transform((v) => (v ?? "").trim()),
    questionCode: z.union([z.string(), z.null(), z.undefined()]).transform((v) => (v ?? "").trim()),
    correctAnswer: z.union([z.string(), z.null(), z.undefined()]).transform((v) => (v ?? "").trim()),
  })
  .superRefine((row, ctx) => {
    const hasId = Boolean(row.questionId);
    const hasCode = Boolean(row.questionCode);
    if (!hasId && !hasCode) {
      ctx.addIssue({ code: "custom", message: "ต้องระบุ question_id หรือรหัส Q001", path: ["questionId"] });
      return;
    }
    if (hasCode && parseQuestionCode(row.questionCode) === null) {
      ctx.addIssue({ code: "custom", message: "question_code ต้องเป็นรูปแบบ Q001", path: ["questionCode"] });
    }
  });

export const answerKeyImportSchema = z.object({
  token: z.string().trim().min(1, "ต้องระบุโทเคนแอดมิน"),
  projectId: z.string().trim().min(1, "ต้องระบุโครงการ"),
  csv: z.string().min(1, "ต้องมีเนื้อหา CSV"),
  apply: z.boolean().optional().default(false),
});

export function zodErrorDetails(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length ? `${issue.path.join(".")}: ` : "";
    return `${path}${issue.message}`;
  });
}
