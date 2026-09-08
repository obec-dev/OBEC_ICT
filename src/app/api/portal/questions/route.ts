import { NextResponse } from "next/server";
import { fetchPublicExamQuestions } from "@/lib/supabase/projects";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("projectId") || "ict-talent-2026";

  try {
    const publicQuestions = await fetchPublicExamQuestions(projectId);
    return NextResponse.json({ ok: true, questions: publicQuestions });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to load questions" },
      { status: 500 }
    );
  }
}
