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

/** Missions unlock after a graded pass. Learn/exam stay available until then. */
export function candidateCanAccessMissions(
  session: SessionUser | null | undefined,
  examProgress: ExamProgress[],
  projects: LearningProject[]
): boolean {
  return candidateHasPassedExam(session, examProgress, projects);
}

export function candidatePortalHome(
  session: SessionUser | null | undefined,
  examProgress: ExamProgress[],
  projects: LearningProject[]
): string {
  return candidateCanAccessMissions(session, examProgress, projects)
    ? "/portal/missions"
    : "/portal/learn";
}
