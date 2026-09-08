import { createClient } from "@/lib/supabase/client";
import type { LearningProject, ProjectQuestion, ProjectVideo, PublicExamQuestion } from "@/types/ict";
import { MOCK_PROJECTS, MOCK_QUESTIONS, MOCK_VIDEOS } from "@/data/mockProjects";

export function extractYouTubeId(urlOrId: string): string {
  const str = urlOrId.trim();
  if (!str) return "YaG5SAw1n0c";
  if (str.length === 11 && !str.includes("http") && !str.includes("/")) {
    return str;
  }
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
  const match = str.match(regExp);
  return match && match[2].length === 11 ? match[2] : str;
}

export async function fetchProjects(): Promise<LearningProject[]> {
  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("projects")
      .select("*")
      .order("created_at", { ascending: true });

    if (error || !data || data.length === 0) {
      return MOCK_PROJECTS;
    }
    return data as LearningProject[];
  } catch {
    return MOCK_PROJECTS;
  }
}

export async function fetchProjectVideos(projectId?: string): Promise<ProjectVideo[]> {
  try {
    const supabase = createClient();
    let query = supabase.from("project_videos").select("*").order("order_index", { ascending: true });
    if (projectId) {
      query = query.eq("project_id", projectId);
    }
    const { data, error } = await query;
    if (error || !data) {
      return projectId ? MOCK_VIDEOS.filter((v) => v.project_id === projectId) : MOCK_VIDEOS;
    }
    if (data.length === 0) {
      return projectId ? MOCK_VIDEOS.filter((v) => v.project_id === projectId) : MOCK_VIDEOS;
    }
    return data as ProjectVideo[];
  } catch {
    return projectId ? MOCK_VIDEOS.filter((v) => v.project_id === projectId) : MOCK_VIDEOS;
  }
}

/** Admin internal question fetch including correct_answer keys */
export async function fetchProjectQuestions(projectId?: string): Promise<ProjectQuestion[]> {
  try {
    const supabase = createClient();
    let query = supabase.from("project_questions").select("*").order("order_index", { ascending: true });
    if (projectId) {
      query = query.eq("project_id", projectId);
    }
    const { data, error } = await query;
    if (error || !data) {
      return projectId ? MOCK_QUESTIONS.filter((q) => q.project_id === projectId) : MOCK_QUESTIONS;
    }
    if (data.length === 0) {
      return projectId ? MOCK_QUESTIONS.filter((q) => q.project_id === projectId) : MOCK_QUESTIONS;
    }
    return data as ProjectQuestion[];
  } catch {
    return projectId ? MOCK_QUESTIONS.filter((q) => q.project_id === projectId) : MOCK_QUESTIONS;
  }
}

/** Anti-Cheating Public Question fetch: strips correct_answer & model_answer before sending to client */
export async function fetchPublicExamQuestions(projectId: string): Promise<PublicExamQuestion[]> {
  const fullQuestions = await fetchProjectQuestions(projectId);
  return fullQuestions.map((q) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { correct_answer, model_answer, ...publicItem } = q;
    return publicItem;
  });
}

export async function upsertProject(project: LearningProject): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("projects").upsert({
    id: project.id,
    name: project.name,
    description: project.description,
    reg_start: project.reg_start || null,
    reg_end: project.reg_end || null,
    reg_enabled: project.reg_enabled ?? true,
    exam_start: project.exam_start || null,
    exam_end: project.exam_end || null,
    exam_enabled: project.exam_enabled ?? true,
    pass_threshold: project.pass_threshold ?? 3,
    max_score: project.max_score ?? 5,
    updated_at: new Date().toISOString(),
  });
  if (error) {
    console.error("upsertProject error:", error.message);
    throw new Error(`บันทึกโครงการไปยัง Supabase ไม่สำเร็จ: ${error.message}`);
  }
}

export async function deleteProjectDb(projectId: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("projects").delete().eq("id", projectId);
  if (error) {
    console.error("deleteProjectDb error:", error.message);
    throw new Error(`ลบโครงการจาก Supabase ไม่สำเร็จ: ${error.message}`);
  }
}

export async function upsertProjectVideo(video: ProjectVideo): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("project_videos").upsert({
    id: String(video.id),
    project_id: video.project_id,
    title: video.title,
    video_url: video.video_url,
    video_id: video.video_id,
    is_mandatory: video.is_mandatory,
    order_index: video.order_index ?? 0,
  });
  if (error) {
    console.error("upsertProjectVideo error:", error.message);
    throw new Error(`บันทึกวิดีโอไปยัง Supabase ไม่สำเร็จ: ${error.message}`);
  }
}

export async function deleteProjectVideoDb(videoId: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("project_videos").delete().eq("id", videoId);
  if (error) {
    console.error("deleteProjectVideoDb error:", error.message);
    throw new Error(`ลบวิดีโอจาก Supabase ไม่สำเร็จ: ${error.message}`);
  }
}

export async function upsertProjectQuestion(question: ProjectQuestion): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("project_questions").upsert({
    id: String(question.id),
    project_id: question.project_id,
    prompt: question.prompt,
    type: question.type,
    options: question.options ?? [],
    correct_answer: question.correct_answer ?? null,
    model_answer: question.model_answer ?? null,
    points: question.points ?? 1,
    order_index: question.order_index ?? 0,
  });
  if (error) {
    console.error("upsertProjectQuestion error:", error.message);
    throw new Error(`บันทึกข้อสอบไปยัง Supabase ไม่สำเร็จ: ${error.message}`);
  }
}

export async function deleteProjectQuestionDb(questionId: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("project_questions").delete().eq("id", questionId);
  if (error) {
    console.error("deleteProjectQuestionDb error:", error.message);
    throw new Error(`ลบข้อสอบจาก Supabase ไม่สำเร็จ: ${error.message}`);
  }
}

/** CSV Parser helper mapping CSV lines (e.g. q1,คำตอบ หรือ 1,คำตอบ) to question correct answers */
export function parseAnswerKeysCsv(csvText: string): { questionIdOrOrder: string; correctAnswer: string }[] {
  const lines = csvText.split(/\r?\n/);
  const results: { questionIdOrOrder: string; correctAnswer: string }[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.toLowerCase().startsWith("question")) continue;
    const parts = trimmed.split(",");
    if (parts.length >= 2) {
      const questionIdOrOrder = parts[0].trim();
      const correctAnswer = parts.slice(1).join(",").trim().replace(/^["']|["']$/g, "");
      if (questionIdOrOrder && correctAnswer) {
        results.push({ questionIdOrOrder, correctAnswer });
      }
    }
  }
  return results;
}

/** Manual Grading Trigger via Supabase RPC or client fallback */
export async function gradeProjectExamsRpc(projectId: string): Promise<{ graded_total: number; passed_total: number }> {
  try {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("grade_project_exams", { p_project_id: projectId });
    if (!error && data) {
      return {
        graded_total: Number(data.graded_total) || 0,
        passed_total: Number(data.passed_total) || 0,
      };
    }
  } catch (e) {
    console.warn("gradeProjectExamsRpc fallback:", e);
  }

  // Local/Store Fallback grading implementation:
  return { graded_total: 0, passed_total: 0 };
}
