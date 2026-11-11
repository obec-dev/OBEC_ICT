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
 * @deprecated Missions replaced by activity tasks on /portal/profile.
 * Always false so learn/exam remain available after pass.
 */
export function candidateCanAccessMissions(
  _session?: SessionUser | null,
  _examProgress?: ExamProgress[],
  _projects?: LearningProject[],
  _missionsEnabled = false
): boolean {
  return false;
}

/** Portal home for candidates — learn (missions hub moved to profile). */
export function candidatePortalHome(
  _session?: SessionUser | null,
  _examProgress?: ExamProgress[],
  _projects?: LearningProject[],
  _missionsEnabled = false
): string {
  return "/portal/learn";
}
