import { getSiteProject } from "@/lib/siteSettings";
import type { ExamProgress, LearningProject, SessionUser } from "@/types/ict";

/** Candidate has a graded pass for the active site project. */
export function candidateHasPassedExam(
  session: SessionUser | null | undefined,
  examProgress: ExamProgress[],
  projects: LearningProject[]
): boolean {
  if (session?.kind !== "candidate") return false;
  const project = getSiteProject(projects);
  const exam = examProgress.find(
    (e) =>
      e.candidate_id === session.candidate.id &&
      (!project?.id || e.project_id === project.id || !e.project_id)
  );
  return Boolean(exam?.passed === true && exam?.graded_at);
}

/**
 * Missions unlock after a graded pass — only when the site setting is enabled.
 * Pass `missionsEnabled` from site_settings (default false until launch).
 */
export function candidateCanAccessMissions(
  session: SessionUser | null | undefined,
  examProgress: ExamProgress[],
  projects: LearningProject[],
  missionsEnabled = false
): boolean {
  if (!missionsEnabled) return false;
  return candidateHasPassedExam(session, examProgress, projects);
}

export function candidatePortalHome(
  session: SessionUser | null | undefined,
  examProgress: ExamProgress[],
  projects: LearningProject[],
  missionsEnabled = false
): string {
  return candidateCanAccessMissions(session, examProgress, projects, missionsEnabled)
    ? "/portal/missions"
    : "/portal/learn";
}
