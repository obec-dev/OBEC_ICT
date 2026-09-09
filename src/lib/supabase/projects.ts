import { createClient } from "@/lib/supabase/client";
import type { LearningProject, ProjectQuestion, ProjectVideo, PublicExamQuestion } from "@/types/ict";
import { MOCK_PROJECTS, MOCK_QUESTIONS, MOCK_VIDEOS } from "@/data/mockProjects";

function asRpcObj(data: unknown): Record<string, unknown> {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    return data as Record<string, unknown>;
  }
  return {};
}

function assertAdminRpcOk(data: unknown, fallback: string) {
  const row = asRpcObj(data);
  if (row.ok === false) {
    throw new Error(String(row.error ?? fallback));
  }
}

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

/** Admin fallback: direct select (likely blocked by RLS). Prefer adminFetchProjectQuestions. */
export async function fetchProjectQuestions(projectId?: string): Promise<ProjectQuestion[]> {
  try {
    const supabase = createClient();
    let query = supabase.from("project_questions").select("*").order("order_index", { ascending: true });
    if (projectId) {
      query = query.eq("project_id", projectId);
    }
    const { data, error } = await query;
    if (error || !data) return [];
    return data as ProjectQuestion[];
  } catch {
    return [];
  }
}

function stripKeys(questions: ProjectQuestion[]): PublicExamQuestion[] {
  return questions.map((q) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { correct_answer, model_answer, ...publicItem } = q;
    return publicItem;
  });
}

/** Public questions without answer keys (view or key-stripped mock). */
export async function fetchPublicExamQuestions(projectId?: string): Promise<PublicExamQuestion[]> {
  try {
    const supabase = createClient();
    let query = supabase
      .from("public_project_questions")
      .select("id, project_id, prompt, type, options, image_url, points, order_index, answer_required")
      .order("order_index", { ascending: true });
    if (projectId) {
      query = query.eq("project_id", projectId);
    }
    const { data, error } = await query;
    if (error || !data) {
      const mocks = projectId
        ? MOCK_QUESTIONS.filter((q) => q.project_id === projectId)
        : MOCK_QUESTIONS;
      return stripKeys(mocks);
    }
    return data as PublicExamQuestion[];
  } catch {
    const mocks = projectId
      ? MOCK_QUESTIONS.filter((q) => q.project_id === projectId)
      : MOCK_QUESTIONS;
    return stripKeys(mocks);
  }
}

/** Token-gated question list including correct_answer keys. */
export async function adminFetchProjectQuestions(
  token: string,
  projectId?: string
): Promise<ProjectQuestion[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_list_questions", {
    p_token: token,
    p_project_id: projectId ?? null,
  });
  if (error) throw new Error(error.message);
  if (!Array.isArray(data)) return [];
  return data as ProjectQuestion[];
}

export async function upsertProject(token: string, project: LearningProject): Promise<void> {
  const supabase = createClient();
  const payload = {
    id: project.id,
    name: project.name,
    description: project.description,
    is_active: project.is_active !== false,
    cover_url: project.cover_url || null,
    reg_start: project.reg_start || null,
    reg_end: project.reg_end || null,
    reg_enabled: project.reg_enabled ?? true,
    exam_start: project.exam_start || null,
    exam_end: project.exam_end || null,
    exam_enabled: project.exam_enabled ?? true,
    enable_results_visibility: project.enable_results_visibility === true,
    pass_threshold_mode: project.pass_threshold_mode === "score" ? "score" : "percent",
    pass_threshold_value:
      typeof project.pass_threshold_value === "number"
        ? project.pass_threshold_value
        : project.pass_threshold ?? 60,
    pass_threshold:
      typeof project.pass_threshold_value === "number"
        ? project.pass_threshold_value
        : project.pass_threshold ?? 60,
    max_score: project.max_score ?? 5,
  };

  const { data, error } = await supabase.rpc("admin_upsert_project", {
    p_token: token,
    p_project: payload,
  });
  if (error) {
    console.error("upsertProject error:", error.message);
    throw new Error(`บันทึกโครงการไปยัง Supabase ไม่สำเร็จ: ${error.message}`);
  }
  assertAdminRpcOk(data, "บันทึกโครงการไม่สำเร็จ");
}

export async function deleteProjectDb(token: string, projectId: string): Promise<void> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_delete_project", {
    p_token: token,
    p_project_id: projectId,
  });
  if (error) {
    console.error("deleteProjectDb error:", error.message);
    throw new Error(`ลบโครงการจาก Supabase ไม่สำเร็จ: ${error.message}`);
  }
  assertAdminRpcOk(data, "ลบโครงการไม่สำเร็จ");
}

export async function upsertProjectVideo(token: string, video: ProjectVideo): Promise<void> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_upsert_video", {
    p_token: token,
    p_video: {
      id: String(video.id),
      project_id: video.project_id,
      title: video.title,
      video_url: video.video_url,
      video_id: video.video_id,
      is_mandatory: video.is_mandatory,
      order_index: video.order_index ?? 0,
    },
  });
  if (error) {
    console.error("upsertProjectVideo error:", error.message);
    throw new Error(`บันทึกวิดีโอไปยัง Supabase ไม่สำเร็จ: ${error.message}`);
  }
  assertAdminRpcOk(data, "บันทึกวิดีโอไม่สำเร็จ");
}

export async function deleteProjectVideoDb(token: string, videoId: string): Promise<void> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_delete_video", {
    p_token: token,
    p_video_id: videoId,
  });
  if (error) {
    console.error("deleteProjectVideoDb error:", error.message);
    throw new Error(`ลบวิดีโอจาก Supabase ไม่สำเร็จ: ${error.message}`);
  }
  assertAdminRpcOk(data, "ลบวิดีโอไม่สำเร็จ");
}

export async function upsertProjectQuestion(token: string, question: ProjectQuestion): Promise<void> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_upsert_question", {
    p_token: token,
    p_question: {
      id: String(question.id),
      project_id: question.project_id,
      prompt: question.prompt,
      type: question.type,
      options: question.options ?? [],
      correct_answer: question.correct_answer ?? null,
      model_answer: question.model_answer ?? null,
      image_url: question.image_url || null,
      points: question.points ?? 1,
      order_index: question.order_index ?? 0,
      answer_required: question.answer_required !== false,
    },
  });
  if (error) {
    console.error("upsertProjectQuestion error:", error.message);
    throw new Error(`บันทึกข้อสอบไปยัง Supabase ไม่สำเร็จ: ${error.message}`);
  }
  assertAdminRpcOk(data, "บันทึกข้อสอบไม่สำเร็จ");
}

export async function deleteProjectQuestionDb(token: string, questionId: string): Promise<void> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_delete_question", {
    p_token: token,
    p_question_id: questionId,
  });
  if (error) {
    console.error("deleteProjectQuestionDb error:", error.message);
    throw new Error(`ลบข้อสอบจาก Supabase ไม่สำเร็จ: ${error.message}`);
  }
  assertAdminRpcOk(data, "ลบข้อสอบไม่สำเร็จ");
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

/** Manual Grading Trigger via token-gated Supabase RPC */
export async function gradeProjectExamsRpc(
  token: string,
  projectId: string
): Promise<{ graded_total: number; passed_total: number }> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("grade_project_exams", {
    p_token: token,
    p_project_id: projectId,
  });
  if (error) {
    throw new Error(error.message);
  }
  if (data) {
    const row = asRpcObj(data);
    return {
      graded_total: Number(row.graded_total) || 0,
      passed_total: Number(row.passed_total) || 0,
    };
  }
  return { graded_total: 0, passed_total: 0 };
}
