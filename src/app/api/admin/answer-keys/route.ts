import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { previewAnswerKeyCsv } from "@/lib/answerKeys";
import { answerKeyImportSchema, answerKeyWriteSchema, zodErrorDetails } from "@/lib/schemas/examQuestion";
import { saveAnswerKeysByQuestionId } from "@/lib/supabase/projects";
import type { ProjectQuestion } from "@/types/ict";

function badRequest(error: string, details?: string[], extra?: Record<string, unknown>, status = 400) {
  return NextResponse.json({ ok: false, error, details: details ?? [error], ...extra }, { status });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("รูปแบบคำขอไม่ถูกต้อง", ["body ต้องเป็น JSON"]);
  }

  const parsed = answerKeyImportSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest("ข้อมูลนำเข้าไม่ครบหรือไม่ถูกต้อง", zodErrorDetails(parsed.error));
  }
  const { token, projectId, csv, apply } = parsed.data;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return NextResponse.json({ ok: false, error: "ยังไม่ได้ตั้งค่า Supabase", details: ["missing env"] }, { status: 500 });
  }

  const supabase = createClient(url, anonKey);
  const listed = await supabase.rpc("admin_list_questions", {
    p_token: token,
    p_project_id: projectId,
  });
  if (listed.error) {
    return badRequest("โหลดรายการข้อสอบไม่สำเร็จ", [listed.error.message]);
  }

  const questions = ((Array.isArray(listed.data) ? listed.data : []) as ProjectQuestion[]).filter(
    (question) => !question.project_id || question.project_id === projectId
  );
  const preview = previewAnswerKeyCsv(csv, questions);
  const errors = preview.filter((row) => row.status === "error");
  const ready = preview.filter((row) => row.status === "ok" && row.questionId && row.storedAnswer);

  if (!apply) {
    return NextResponse.json({ ok: errors.length === 0, preview, readyCount: ready.length });
  }
  if (errors.length > 0) {
    return badRequest(
      "ไฟล์ยังมีข้อผิดพลาด จึงยังไม่บันทึก แถวที่เว้นเฉลยไม่ถือว่าผิด",
      errors.map((row) => `แถว ${row.line}: ${row.message}`),
      { preview },
      422
    );
  }
  if (ready.length === 0) {
    return NextResponse.json({
      ok: true,
      preview,
      applied: [],
      message: "ไม่มีเฉลยใหม่ ข้อที่เว้นว่างยังไม่ถูกกำหนด",
    });
  }

  const appliedPayload = ready.map((row) => ({
    questionId: row.questionId || "",
    questionCode: row.questionCode || "",
    correctAnswer: row.storedAnswer || "",
  }));
  const checked = answerKeyWriteSchema.array().safeParse(appliedPayload);
  if (!checked.success) {
    return badRequest("ข้อมูลเฉลยไม่ถูกต้อง", zodErrorDetails(checked.error), { preview }, 422);
  }

  try {
    await saveAnswerKeysByQuestionId(
      token,
      projectId,
      checked.data.map((row) => ({
        questionId: row.questionId || undefined,
        questionCode: row.questionCode || undefined,
        correctAnswer: row.correctAnswer,
      })),
      supabase as Parameters<typeof saveAnswerKeysByQuestionId>[3]
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "บันทึกเฉลยไม่สำเร็จ";
    return badRequest(message, [message], { preview });
  }

  return NextResponse.json({
    ok: true,
    preview,
    applied: checked.data.map((row) => ({
      questionId: row.questionId,
      questionCode: row.questionCode,
      correctAnswer: row.correctAnswer,
    })),
  });
}
