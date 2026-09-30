import { groupQuestionsBySection, type ExamPart } from "@/lib/examSections";
import type { ExamProgress, ProjectQuestion, ProjectVideo } from "@/types/ict";

export type LessonQuizStatus = "empty" | "in_progress" | "complete" | "submitted";

export function sortProjectVideos(videos: ProjectVideo[]): ProjectVideo[] {
  return [...videos].sort(
    (a, b) =>
      (a.order_index ?? 0) - (b.order_index ?? 0) || a.title.localeCompare(b.title, "th")
  );
}

/**
 * Pair each video to an exam part.
 * Prefer explicit video.exam_section_id; fall back to 1:1 by order index.
 * If a mapped section has no questions yet, fall back to order so UI still works
 * only when that order slot has questions.
 */
export function pairVideosWithExamParts(
  videos: ProjectVideo[],
  questions: ProjectQuestion[]
): { video: ProjectVideo; part: ExamPart | null; lessonIndex: number }[] {
  const sortedVideos = sortProjectVideos(videos);
  const parts = groupQuestionsBySection(questions).filter((p) => p.questions.length > 0);
  const partsById = new Map(parts.map((part) => [part.id, part]));
  const usedPartIds = new Set<string>();

  return sortedVideos.map((video, index) => {
    let part: ExamPart | null = null;
    const mappedId = video.exam_section_id?.trim() || "";

    if (mappedId && partsById.has(mappedId)) {
      part = partsById.get(mappedId) ?? null;
    }

    if (!part) {
      // Prefer unused part whose section_order matches lesson index (1-based)
      const byOrderMeta = parts.find(
        (p) =>
          !usedPartIds.has(p.id) &&
          (p.order === index + 1 || p.order === index)
      );
      const byIndex = parts[index] && !usedPartIds.has(parts[index].id) ? parts[index] : null;
      const free = parts.find((p) => !usedPartIds.has(p.id));
      part = byOrderMeta ?? byIndex ?? free ?? null;
    }

    if (part) usedPartIds.add(part.id);
    return {
      video,
      part,
      lessonIndex: index + 1,
    };
  });
}

export function resolveExamPartFromParams(
  videos: ProjectVideo[],
  questions: ProjectQuestion[],
  params: { videoId?: string | null; section?: string | null }
): { part: ExamPart; video: ProjectVideo | null; lessonIndex: number } | null {
  const pairs = pairVideosWithExamParts(videos, questions);
  const parts = groupQuestionsBySection(questions);

  const sectionRaw = params.section?.trim() || "";
  if (sectionRaw && !/^\d+$/.test(sectionRaw)) {
    const byId = parts.find((part) => part.id === sectionRaw);
    if (byId) {
      const pairIdx = pairs.findIndex((pair) => pair.part?.id === byId.id);
      return {
        part: byId,
        video: pairIdx >= 0 ? pairs[pairIdx].video : null,
        lessonIndex: pairIdx >= 0 ? pairs[pairIdx].lessonIndex : parts.findIndex((p) => p.id === byId.id) + 1,
      };
    }
  }

  const videoId = params.videoId?.trim() || "";
  if (videoId) {
    const hit = pairs.find((pair) => pair.video.id === videoId || pair.video.video_id === videoId);
    if (hit?.part) {
      return { part: hit.part, video: hit.video, lessonIndex: hit.lessonIndex };
    }
    // Video found but no part yet — try mapped section id even if questions empty in group
    const video = sortProjectVideos(videos).find((v) => v.id === videoId || v.video_id === videoId);
    if (video?.exam_section_id) {
      const part = parts.find((p) => p.id === video.exam_section_id);
      if (part) {
        const lessonIndex =
          sortProjectVideos(videos).findIndex((v) => v.id === video.id) + 1 || 1;
        return { part, video, lessonIndex };
      }
    }
  }

  if (sectionRaw) {
    const asIndex = Number(sectionRaw);
    if (Number.isFinite(asIndex) && asIndex >= 1 && asIndex <= pairs.length) {
      const pair = pairs[asIndex - 1];
      if (pair?.part) {
        return { part: pair.part, video: pair.video, lessonIndex: asIndex };
      }
    }
    if (Number.isFinite(asIndex) && asIndex >= 1 && asIndex <= parts.length) {
      const part = parts[asIndex - 1];
      return { part, video: pairs[asIndex - 1]?.video ?? null, lessonIndex: asIndex };
    }
  }

  return null;
}

export function lessonQuizHref(videoId: string, lessonIndex: number, sectionId?: string | null): string {
  const params = new URLSearchParams({
    videoId,
    section: sectionId?.trim() || String(lessonIndex),
  });
  return `/portal/exam?${params.toString()}`;
}

export function countSubmittedLessons(exam: ExamProgress | undefined | null): number {
  if (!exam?.lesson_submissions) return 0;
  return Object.values(exam.lesson_submissions).filter((s) => s?.status === "submitted").length;
}

/** Overall status still draft, but at least one lesson was submitted per lesson flow. */
export function hasPartialLessonSubmit(exam: ExamProgress | undefined | null): boolean {
  if (!exam || exam.status === "submitted") return false;
  return countSubmittedLessons(exam) > 0;
}

/** Admin may unlock full submit or partial per-lesson submit (resets lesson locks). */
export function canAdminUnlockExam(exam: ExamProgress | undefined | null): boolean {
  if (!exam) return false;
  if (exam.status === "submitted") return true;
  return countSubmittedLessons(exam) > 0;
}

export function isLessonSubmitted(
  exam: ExamProgress | undefined | null,
  sectionId: string | null | undefined
): boolean {
  if (!exam || !sectionId) return false;
  if (exam.status === "submitted") return true;
  return exam.lesson_submissions?.[sectionId]?.status === "submitted";
}

export function allLessonsSubmitted(
  exam: ExamProgress | undefined | null,
  parts: ExamPart[]
): boolean {
  if (!exam) return false;
  if (exam.status === "submitted") return true;
  if (parts.length === 0) return false;
  return parts.every((part) => isLessonSubmitted(exam, part.id));
}

export function sectionAnswerStatus(
  part: ExamPart,
  answers: Record<string, string> | undefined,
  exam?: ExamProgress | null
): LessonQuizStatus {
  if (isLessonSubmitted(exam, part.id)) return "submitted";
  const map = answers ?? {};
  const targets =
    part.questions.filter((q) => q.answer_required !== false).length > 0
      ? part.questions.filter((q) => q.answer_required !== false)
      : part.questions;
  if (targets.length === 0) return "empty";
  const answered = targets.filter((q) => (map[q.id] || "").trim()).length;
  if (answered === 0) return "empty";
  if (answered >= targets.length) return "complete";
  return "in_progress";
}

export function lessonQuizStatusLabel(status: LessonQuizStatus): string {
  if (status === "submitted") return "ส่งแบบทดสอบแล้ว";
  if (status === "complete") return "ตอบครบแล้ว (ยังไม่ส่ง)";
  if (status === "in_progress") return "กำลังทำแบบทดสอบ";
  return "ยังไม่ได้เริ่มแบบทดสอบ";
}
