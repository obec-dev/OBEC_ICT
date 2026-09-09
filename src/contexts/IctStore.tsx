"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { LEARNING_VIDEO_ID } from "@/data/schools";
import {
  adminDeleteProfileRpc,
  adminLogin as adminLoginRpc,
  adminLogout as adminLogoutRpc,
  adminUpdateProfileRpc,
} from "@/lib/supabase/admin";
import {
  fetchDistrictStats,
  fetchSchoolById,
  fetchSchoolTotals,
  findProfileForLogin,
  insertProfile,
  updateOwnProfile,
  upsertExamProgressToDb,
  upsertWatchProgressToDb,
} from "@/lib/supabase/data";
import {
  readPersistedState,
  readSession,
  writePersistedState,
  writeSession,
} from "@/lib/storage";
import type {
  AdminUser,
  Candidate,
  DistrictStat,
  ExamProgress,
  IctPersistedState,
  LearningProject,
  ProjectQuestion,
  ProjectVideo,
  School,
  SchoolTotals,
  SessionUser,
  WatchProgress,
} from "@/types/ict";
import {
  adminFetchProjectQuestions,
  deleteProjectDb,
  deleteProjectQuestionDb,
  deleteProjectVideoDb,
  fetchPublicExamQuestions,
  fetchProjects,
  fetchProjectVideos,
  upsertProject,
  upsertProjectQuestion,
  upsertProjectVideo,
} from "@/lib/supabase/projects";
import { MOCK_PROJECTS, MOCK_QUESTIONS, MOCK_VIDEOS } from "@/data/mockProjects";
import { getSiteProject } from "@/lib/siteSettings";

function stripQuestionKeys(questions: ProjectQuestion[]): ProjectQuestion[] {
  return questions.map((q) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { correct_answer, model_answer, ...rest } = q;
    return rest;
  });
}

function requireAdminToken(session: SessionUser | null): string {
  if (session?.kind !== "admin" || !session.token) {
    throw new Error("ไม่ได้เข้าสู่ระบบผู้ดูแล");
  }
  return session.token;
}

type RegisterInput = {
  profile_id: string;
  school_id: string;
  first_name: string;
  last_name: string;
  phone: string;
  remark?: string;
  title_key: string;
  title_en: string;
  title_th: string;
  title_other_en?: string;
  title_other_th?: string;
  eng_first_name: string;
  eng_last_name: string;
  birth_date: string;
  gender: string;
  position: string;
  duty: string;
  line_id: string;
  email: string;
  /** Subject whose reg checkbox/window must be open */
  project_id?: string;
};

type IctStoreValue = {
  hydrated: boolean;
  loading: boolean;
  loadError: string | null;
  refreshData: () => Promise<void>;
  districtStats: DistrictStat[];
  schoolTotals: SchoolTotals;
  candidates: Candidate[];
  watchProgress: WatchProgress[];
  examProgress: ExamProgress[];
  projects: LearningProject[];
  videos: ProjectVideo[];
  questions: ProjectQuestion[];
  activeProjectId: string;
  setActiveProjectId: (id: string) => void;
  saveProject: (project: LearningProject) => Promise<{ ok: true } | { ok: false; error: string }>;
  deleteProject: (id: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  saveProjectVideo: (video: ProjectVideo) => Promise<{ ok: true } | { ok: false; error: string }>;
  deleteProjectVideo: (id: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  saveProjectQuestion: (question: ProjectQuestion) => Promise<{ ok: true } | { ok: false; error: string }>;
  deleteProjectQuestion: (id: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  bulkSaveAnswerKeys: (
    projectId: string,
    keys: { questionIdOrOrder: string; correctAnswer: string }[]
  ) => Promise<{ ok: true; updatedCount: number } | { ok: false; error: string }>;
  gradeProjectExams: (
    projectId: string
  ) => Promise<{ ok: true; gradedCount: number; passedCount: number } | { ok: false; error: string }>;
  session: SessionUser | null;
  currentCandidate: Candidate | null;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  adminToken: string | null;
  adminUser: AdminUser | null;
  lookupSchool: (schoolId: string) => Promise<School | null>;
  registerCandidate: (
    input: RegisterInput
  ) => Promise<{ ok: true; candidate: Candidate } | { ok: false; error: string }>;
  login: (
    profileIdOrAdmin: string,
    phoneOrPassword: string
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  loginAdmin: (
    username: string,
    password: string
  ) => Promise<{ ok: true; mustChangePassword: boolean } | { ok: false; error: string }>;
  refreshAdminSession: (admin: AdminUser) => void;
  logout: () => void;
  saveWatchProgress: (
    partial: Omit<WatchProgress, "candidate_id" | "last_updated">
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  saveExamDraft: (
    answers: Record<string, string>,
    projectId?: string
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  submitExam: (
    answers: Record<string, string>,
    projectId?: string
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  unlockExamForCandidate: (
    candidateId: string,
    projectId?: string
  ) => Promise<{ ok: true; updated: number } | { ok: false; error: string }>;
  adminUpdateCandidate: (
    id: string,
    patch: Partial<Pick<Candidate, "first_name" | "last_name" | "phone" | "remark">>
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  updateCandidateProfile: (
    id: string,
    patch: Partial<
      Pick<
        Candidate,
        | "first_name"
        | "last_name"
        | "phone"
        | "remark"
        | "title_key"
        | "title_en"
        | "title_th"
        | "title_other_en"
        | "title_other_th"
        | "eng_first_name"
        | "eng_last_name"
        | "position"
        | "duty"
        | "line_id"
        | "email"
      >
    >
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  adminDeleteCandidate: (id: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  getWatchFor: (candidateId: string, videoId?: string) => WatchProgress | undefined;
  getExamFor: (candidateId: string, projectId?: string) => ExamProgress | undefined;
};

const IctStoreContext = createContext<IctStoreValue | null>(null);

const emptyTotals: SchoolTotals = { total: 0, registered: 0, zones: 0 };

export function IctStoreProvider({ children }: { children: React.ReactNode }) {
  const [hydrated, setHydrated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [districtStats, setDistrictStats] = useState<DistrictStat[]>([]);
  const [schoolTotals, setSchoolTotals] = useState<SchoolTotals>(emptyTotals);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [watchProgress, setWatchProgress] = useState<WatchProgress[]>([]);
  const [examProgress, setExamProgress] = useState<ExamProgress[]>([]);
  const [projects, setProjects] = useState<LearningProject[]>(MOCK_PROJECTS);
  const [videos, setVideos] = useState<ProjectVideo[]>(MOCK_VIDEOS);
  const [questions, setQuestions] = useState<ProjectQuestion[]>(MOCK_QUESTIONS);
  const [activeProjectId, setActiveProjectId] = useState<string>("ict-talent-2026");
  const [session, setSession] = useState<SessionUser | null>(null);

  const refreshData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [stats, totals, dbProjects, dbVideos, publicQuestions] = await Promise.all([
        fetchDistrictStats(),
        fetchSchoolTotals(),
        fetchProjects(),
        fetchProjectVideos(),
        fetchPublicExamQuestions(),
      ]);
      setDistrictStats(stats);
      setSchoolTotals(totals);

      const sess = readSession();
      if (sess?.kind === "candidate") {
        setCandidates([sess.candidate]);
      } else {
        setCandidates([]);
      }

      if (dbProjects?.length) setProjects(dbProjects);
      if (dbVideos?.length) setVideos(dbVideos);

      const siteId = getSiteProject(dbProjects?.length ? dbProjects : MOCK_PROJECTS)?.id;
      const publicForSite = siteId
        ? publicQuestions.filter((q) => !q.project_id || q.project_id === siteId)
        : publicQuestions;
      setQuestions(publicForSite as ProjectQuestion[]);

      if (sess?.kind === "admin" && sess.token) {
        try {
          const adminQs = await adminFetchProjectQuestions(sess.token);
          if (adminQs.length) setQuestions(adminQs);
        } catch {
          /* keep public questions if admin RPC fails */
        }
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "โหลดข้อมูลจากฐานข้อมูลไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const persisted = readPersistedState();
    if (persisted) {
      setWatchProgress(persisted.watchProgress ?? []);
      setExamProgress(persisted.examProgress ?? []);
      if (persisted.projects?.length) setProjects(persisted.projects);
      if (persisted.videos?.length) setVideos(persisted.videos);
      if (persisted.questions?.length) setQuestions(stripQuestionKeys(persisted.questions));
    }
    setSession(readSession());
    setHydrated(true);
    void refreshData();
  }, [refreshData]);

  useEffect(() => {
    if (!hydrated) return;
    const state: IctPersistedState = {
      watchProgress,
      examProgress,
      projects,
      videos,
      questions: stripQuestionKeys(questions),
    };
    writePersistedState(state);
  }, [hydrated, watchProgress, examProgress, projects, videos, questions]);

  const persistSession = useCallback((next: SessionUser | null) => {
    setSession(next);
    writeSession(next);
  }, []);

  const lookupSchool = useCallback(async (schoolId: string) => {
    return fetchSchoolById(schoolId);
  }, []);

  const saveProject = useCallback(async (project: LearningProject) => {
    try {
      const token = requireAdminToken(session);
      await upsertProject(token, project);
      setProjects((prev) => {
        const idx = prev.findIndex((p) => p.id === project.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = project;
          return next;
        }
        return [...prev, project];
      });
      return { ok: true as const };
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : "บันทึกโครงการไม่สำเร็จ" };
    }
  }, [session]);

  const deleteProject = useCallback(async (id: string) => {
    try {
      const token = requireAdminToken(session);
      await deleteProjectDb(token, id);
      setProjects((prev) => prev.filter((p) => p.id !== id));
      setVideos((prev) => prev.filter((v) => v.project_id !== id));
      setQuestions((prev) => prev.filter((q) => q.project_id !== id));
      return { ok: true as const };
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : "ลบโครงการไม่สำเร็จ" };
    }
  }, [session]);

  const saveProjectVideo = useCallback(async (video: ProjectVideo) => {
    try {
      const token = requireAdminToken(session);
      await upsertProjectVideo(token, video);
      setVideos((prev) => {
        const idx = prev.findIndex((v) => v.id === video.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = video;
          return next;
        }
        return [...prev, video];
      });
      return { ok: true as const };
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : "บันทึกวิดีโอไม่สำเร็จ" };
    }
  }, [session]);

  const deleteProjectVideo = useCallback(async (id: string) => {
    try {
      const token = requireAdminToken(session);
      await deleteProjectVideoDb(token, id);
      setVideos((prev) => prev.filter((v) => v.id !== id));
      return { ok: true as const };
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : "ลบวิดีโอไม่สำเร็จ" };
    }
  }, [session]);

  const saveProjectQuestion = useCallback(async (question: ProjectQuestion) => {
    try {
      const token = requireAdminToken(session);
      await upsertProjectQuestion(token, question);
      setQuestions((prev) => {
        const idx = prev.findIndex((q) => q.id === question.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = question;
          return next;
        }
        return [...prev, question];
      });
      return { ok: true as const };
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : "บันทึกข้อสอบไม่สำเร็จ" };
    }
  }, [session]);

  const deleteProjectQuestion = useCallback(async (id: string) => {
    try {
      const token = requireAdminToken(session);
      await deleteProjectQuestionDb(token, id);
      setQuestions((prev) => prev.filter((q) => q.id !== id));
      return { ok: true as const };
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : "ลบข้อสอบไม่สำเร็จ" };
    }
  }, [session]);

  const bulkSaveAnswerKeys = useCallback(
    async (projectId: string, keys: { questionIdOrOrder: string; correctAnswer: string }[]) => {
      try {
        const token = requireAdminToken(session);
        const projQuestions = questions.filter((q) => q.project_id === projectId);
        let updatedCount = 0;
        const nextQuestions = [...questions];

        for (const item of keys) {
          const target = projQuestions.find(
            (q, index) =>
              q.id === item.questionIdOrOrder ||
              String(index + 1) === item.questionIdOrOrder ||
              String(q.order_index) === item.questionIdOrOrder
          );
          if (target) {
            let finalAnswer = item.correctAnswer;
            // Map 1-based index (e.g. 1, 2, 3, 4) to option text if target has options
            if (target.options && target.options.length > 0) {
              const num = parseInt(item.correctAnswer, 10);
              if (!Number.isNaN(num) && num >= 1 && num <= target.options.length) {
                finalAnswer = target.options[num - 1];
              }
            }

            const updated = { ...target, correct_answer: finalAnswer };
            await upsertProjectQuestion(token, updated);
            const idx = nextQuestions.findIndex((q) => q.id === target.id);
            if (idx >= 0) nextQuestions[idx] = updated;
            updatedCount++;
          }
        }
        setQuestions(nextQuestions);
        return { ok: true as const, updatedCount };
      } catch (err) {
        return { ok: false as const, error: err instanceof Error ? err.message : "อัปเดตเฉลยคำตอบไม่สำเร็จ" };
      }
    },
    [questions, session]
  );

  const gradeProjectExams = useCallback(
    async (projectId: string) => {
      try {
        const token = requireAdminToken(session);
        const projectQsAll = questions.filter((q) => q.project_id === projectId);
        const gradedQs = projectQsAll.filter((q) => {
          const pts = typeof q.points === "number" ? q.points : 1;
          return pts > 0;
        });
        const missingKeys = gradedQs.filter((q) => !(q.correct_answer || "").trim());
        if (missingKeys.length > 0) {
          return {
            ok: false as const,
            error: "กรุณากำหนดเฉลยคำตอบให้ครบทุกข้อก่อนประมวลผล",
          };
        }

        const { gradeProjectExamsRpc } = await import("@/lib/supabase/projects");
        let rpcResult = { graded_total: 0, passed_total: 0 };
        try {
          rpcResult = await gradeProjectExamsRpc(token, projectId);
        } catch (rpcErr) {
          const msg = rpcErr instanceof Error ? rpcErr.message : String(rpcErr);
          if (/missing_answer_keys/i.test(msg)) {
            return {
              ok: false as const,
              error: "กรุณากำหนดเฉลยคำตอบให้ครบทุกข้อก่อนประมวลผล",
            };
          }
          throw rpcErr;
        }

        const project = projects.find((p) => p.id === projectId);
        const maxScore =
          gradedQs.reduce((acc, q) => acc + (typeof q.points === "number" ? q.points : 1), 0) ||
          project?.max_score ||
          5;
        const { isExamPassed } = await import("@/lib/siteSettings");

        let gradedCount = 0;
        let passedCount = 0;

        setExamProgress((prev) =>
          prev.map((exam) => {
            if (exam.status !== "submitted") return exam;
            if (exam.project_id && exam.project_id !== projectId && projectId !== "ict-talent-2026") return exam;

            let score = 0;
            for (const q of gradedQs) {
              const candidateAns = (exam.answers[q.id] || "").trim();
              const correctAns = (q.correct_answer || "").trim();

              if (!candidateAns || !correctAns) continue;

              let isMatch = candidateAns === correctAns;

              if (!isMatch && q.options && q.options.length > 0) {
                const corrIndex = q.options.indexOf(correctAns) + 1;
                const candIndex = q.options.indexOf(candidateAns) + 1;

                if (String(candIndex) === correctAns || String(corrIndex) === candidateAns) {
                  isMatch = true;
                }
              }

              if (isMatch) {
                score += typeof q.points === "number" ? q.points : 1;
              }
            }
            const passed = isExamPassed(score, maxScore, project);
            gradedCount++;
            if (passed) passedCount++;

            return {
              ...exam,
              score,
              passed,
              graded_at: new Date().toISOString(),
            };
          })
        );

        return {
          ok: true as const,
          gradedCount: rpcResult.graded_total || gradedCount,
          passedCount: rpcResult.passed_total || passedCount,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "ตรวจข้อสอบไม่สำเร็จ";
        if (/missing_answer_keys/i.test(msg)) {
          return {
            ok: false as const,
            error: "กรุณากำหนดเฉลยคำตอบให้ครบทุกข้อก่อนประมวลผล",
          };
        }
        return { ok: false as const, error: msg };
      }
    },
    [projects, questions, session]
  );

  const registerCandidate = useCallback(
    async (input: RegisterInput) => {
      try {
        const { getAnyProjectRegistrationStatus, getProjectRegistrationStatus } = await import(
          "@/lib/siteSettings"
        );
        if (input.project_id) {
          const project = projects.find((p) => p.id === input.project_id);
          if (!project) return { ok: false as const, error: "ไม่พบโครงการที่เลือก" };
          const regStatus = getProjectRegistrationStatus(project);
          if (!regStatus.open) return { ok: false as const, error: regStatus.message };
        } else {
          const regStatus = getAnyProjectRegistrationStatus(projects);
          if (!regStatus.open) return { ok: false as const, error: regStatus.message };
        }

        const school = await fetchSchoolById(input.school_id);
        if (!school) return { ok: false as const, error: "ไม่พบรหัสโรงเรียนนี้ในระบบ" };

        const candidate = await insertProfile({
          profile_id: input.profile_id,
          school_id: school.school_id,
          first_name: input.first_name,
          last_name: input.last_name,
          phone: input.phone,
          remark: input.remark,
          pdpa_accepted: true,
          title_key: input.title_key,
          title_en: input.title_en,
          title_th: input.title_th,
          title_other_en: input.title_other_en,
          title_other_th: input.title_other_th,
          eng_first_name: input.eng_first_name,
          eng_last_name: input.eng_last_name,
          birth_date: input.birth_date,
          gender: input.gender,
          position: input.position,
          duty: input.duty,
          line_id: input.line_id,
          email: input.email,
        });

        setCandidates((prev) => [candidate, ...prev.filter((c) => c.id !== candidate.id)]);
        setDistrictStats((prev) =>
          prev.map((d) =>
            d.district_id === school.district_id
              ? {
                  ...d,
                  registered_schools: Math.min(d.total_schools, d.registered_schools + (school.is_registered ? 0 : 1)),
                }
              : d
          )
        );
        setSchoolTotals((prev) => ({
          ...prev,
          registered: school.is_registered ? prev.registered : prev.registered + 1,
        }));
        return { ok: true as const, candidate };
      } catch (err) {
        return {
          ok: false as const,
          error: err instanceof Error ? err.message : "ลงทะเบียนไม่สำเร็จ",
        };
      }
    },
    [projects]
  );

  const login = useCallback(
    async (profileIdOrAdmin: string, phoneOrPassword: string) => {
      try {
        const rawId = profileIdOrAdmin.trim();
        const rawPhone = phoneOrPassword.trim();
        const candidate = await findProfileForLogin(rawId, rawPhone);

        if (!candidate) return { ok: false as const, error: "เลขบัตรประชาชนหรือเบอร์โทรศัพท์ไม่ถูกต้อง" };
        persistSession({ kind: "candidate", candidate });
        setCandidates([candidate]);
        return { ok: true as const };
      } catch (err) {
        const rawId = profileIdOrAdmin.trim();
        const rawPhone = phoneOrPassword.trim();
        const digitsId = rawId.replace(/\D/g, "");
        const digitsPhone = rawPhone.replace(/\D/g, "");
        const matchLocal = candidates.find((c) => {
          const candIdDigits = c.id.replace(/\D/g, "");
          const candPhoneDigits = (c.phone || "").replace(/\D/g, "");
          const idMatch = c.id === rawId || (digitsId && candIdDigits === digitsId);
          const phoneMatch =
            (c.phone || "").trim() === rawPhone ||
            (digitsPhone && candPhoneDigits === digitsPhone) ||
            (c.phone || "").trim() === digitsPhone;
          return idMatch && phoneMatch;
        });
        if (matchLocal) {
          persistSession({ kind: "candidate", candidate: matchLocal });
          setCandidates([matchLocal]);
          return { ok: true as const };
        }
        return {
          ok: false as const,
          error: err instanceof Error ? err.message : "เข้าสู่ระบบไม่สำเร็จ",
        };
      }
    },
    [candidates, persistSession]
  );

  const loginAdmin = useCallback(
    async (username: string, password: string) => {
      const result = await adminLoginRpc(username, password);
      if (!result.ok) return { ok: false as const, error: result.error };
      persistSession({ kind: "admin", admin: result.admin, token: result.token });
      try {
        const adminQs = await adminFetchProjectQuestions(result.token);
        if (adminQs.length) setQuestions(adminQs);
      } catch {
        /* public questions remain */
      }
      return { ok: true as const, mustChangePassword: result.admin.must_change_password };
    },
    [persistSession]
  );

  const refreshAdminSession = useCallback(
    (admin: AdminUser) => {
      if (session?.kind !== "admin") return;
      persistSession({ kind: "admin", admin, token: session.token });
    },
    [persistSession, session]
  );

  const logout = useCallback(() => {
    if (session?.kind === "admin") {
      void adminLogoutRpc(session.token);
    }
    persistSession(null);
    if (typeof window !== "undefined") {
      window.location.href = "/";
    }
  }, [persistSession, session]);

  const saveWatchProgress = useCallback(
    async (partial: Omit<WatchProgress, "candidate_id" | "last_updated">) => {
      if (session?.kind !== "candidate") return { ok: false as const, error: "ไม่ได้เข้าสู่ระบบ" };
      const candidateId = session.candidate.id;
      const next: WatchProgress = {
        candidate_id: candidateId,
        video_id: partial.video_id || LEARNING_VIDEO_ID,
        project_id: partial.project_id || activeProjectId,
        watched_seconds: partial.watched_seconds,
        duration_seconds: partial.duration_seconds,
        completed: partial.completed,
        last_updated: new Date().toISOString(),
      };

      try {
        await upsertWatchProgressToDb({
          profile_id: candidateId,
          phone: session.candidate.phone,
          video_id: next.video_id,
          watched_seconds: next.watched_seconds,
          duration_seconds: next.duration_seconds,
          completed: next.completed,
        });
        setWatchProgress((prev) => {
          const existing = prev.find((w) => w.candidate_id === candidateId && w.video_id === next.video_id);
          const merged: WatchProgress = {
            ...next,
            completed: next.completed || existing?.completed || false,
          };
          if (!existing) return [...prev, merged];
          return prev.map((w) => (w.candidate_id === candidateId && w.video_id === next.video_id ? merged : w));
        });
        return { ok: true as const };
      } catch (err) {
        return { ok: false as const, error: err instanceof Error ? err.message : "บันทึกบทเรียนไม่สำเร็จ" };
      }
    },
    [activeProjectId, session]
  );

  const saveExamDraft = useCallback(
    async (answers: Record<string, string>, targetProjectId?: string) => {
      if (session?.kind !== "candidate") return { ok: false as const, error: "ไม่ได้เข้าสู่ระบบ" };
      const candidateId = session.candidate.id;
      const pId = targetProjectId || activeProjectId;
      const existing = examProgress.find((e) => e.candidate_id === candidateId && (e.project_id === pId || !e.project_id));
      if (existing?.status === "submitted") {
        return { ok: false as const, error: "ส่งข้อสอบแล้ว ไม่สามารถแก้ไขได้" };
      }

      try {
        const { getProjectExamStatus, isProjectActive } = await import("@/lib/siteSettings");
        const project = projects.find((p) => p.id === pId);
        if (!project) return { ok: false as const, error: "ไม่พบโครงการ" };
        if (!isProjectActive(project)) {
          return { ok: false as const, error: "โครงการนี้ปิดใช้งานชั่วคราว" };
        }
        const examStatus = getProjectExamStatus(project);
        if (!examStatus.open) return { ok: false as const, error: examStatus.message };

        await upsertExamProgressToDb({
          profile_id: candidateId,
          phone: session.candidate.phone,
          project_id: pId,
          answers,
          status: "draft",
        });
        const next: ExamProgress = {
          candidate_id: candidateId,
          project_id: pId,
          answers,
          status: "draft",
          updated_at: new Date().toISOString(),
        };
        setExamProgress((prev) => {
          const row = prev.find((e) => e.candidate_id === candidateId && (e.project_id === pId || !e.project_id));
          if (!row) return [...prev, next];
          return prev.map((e) => (e.candidate_id === candidateId && (e.project_id === pId || !e.project_id) ? next : e));
        });
        return { ok: true as const };
      } catch (err) {
        return { ok: false as const, error: err instanceof Error ? err.message : "บันทึกร่างข้อสอบไม่สำเร็จ" };
      }
    },
    [activeProjectId, examProgress, projects, session]
  );

  const submitExam = useCallback(
    async (answers: Record<string, string>, targetProjectId?: string) => {
      if (session?.kind !== "candidate") return { ok: false as const, error: "ไม่ได้เข้าสู่ระบบ" };
      const candidateId = session.candidate.id;
      const pId = targetProjectId || activeProjectId;
      try {
        const { getProjectExamStatus, isProjectActive } = await import("@/lib/siteSettings");
        const project = projects.find((p) => p.id === pId);
        if (!project) return { ok: false as const, error: "ไม่พบโครงการ" };
        if (!isProjectActive(project)) {
          return { ok: false as const, error: "โครงการนี้ปิดใช้งานชั่วคราว ไม่สามารถส่งข้อสอบได้" };
        }
        const existing = examProgress.find(
          (e) => e.candidate_id === candidateId && (e.project_id === pId || !e.project_id)
        );
        if (existing?.status === "submitted") {
          return { ok: false as const, error: "ส่งข้อสอบแล้ว ไม่สามารถส่งซ้ำได้" };
        }
        const examStatus = getProjectExamStatus(project);
        if (!examStatus.open) return { ok: false as const, error: examStatus.message };

        await upsertExamProgressToDb({
          profile_id: candidateId,
          phone: session.candidate.phone,
          project_id: pId,
          answers,
          status: "submitted",
        });
        const next: ExamProgress = {
          candidate_id: candidateId,
          project_id: pId,
          answers,
          status: "submitted",
          updated_at: new Date().toISOString(),
        };
        setExamProgress((prev) => {
          const row = prev.find((e) => e.candidate_id === candidateId && (e.project_id === pId || !e.project_id));
          if (!row) return [...prev, next];
          return prev.map((e) => (e.candidate_id === candidateId && (e.project_id === pId || !e.project_id) ? next : e));
        });
        return { ok: true as const };
      } catch (err) {
        return { ok: false as const, error: err instanceof Error ? err.message : "ส่งข้อสอบไม่สำเร็จ" };
      }
    },
    [activeProjectId, examProgress, projects, session]
  );

  const unlockExamForCandidate = useCallback(
    async (candidateId: string, targetProjectId?: string) => {
      const token = session?.kind === "admin" ? session.token : null;
      if (!token) return { ok: false as const, error: "ไม่ได้เข้าสู่ระบบผู้ดูแล" };
      const pId = targetProjectId || activeProjectId || projects[0]?.id;
      try {
        const { adminUnlockExamRpc } = await import("@/lib/supabase/admin");
        const result = await adminUnlockExamRpc(token, candidateId, pId);
        if (!result.ok) return result;

        setExamProgress((prev) => {
          const existing = prev.find(
            (e) => e.candidate_id === candidateId && (e.project_id === pId || !e.project_id)
          );
          if (!existing) {
            return [
              ...prev,
              {
                candidate_id: candidateId,
                project_id: pId,
                answers: {},
                status: "draft" as const,
                updated_at: new Date().toISOString(),
              },
            ];
          }
          return prev.map((e) =>
            e.candidate_id === candidateId && (e.project_id === pId || !e.project_id)
              ? {
                  ...e,
                  status: "draft" as const,
                  score: undefined,
                  passed: undefined,
                  graded_at: undefined,
                  updated_at: new Date().toISOString(),
                }
              : e
          );
        });
        return { ok: true as const, updated: result.updated };
      } catch (err) {
        return { ok: false as const, error: err instanceof Error ? err.message : "ปลดล็อกไม่สำเร็จ" };
      }
    },
    [activeProjectId, projects, session]
  );

  const updateCandidateProfile = useCallback(
    async (
      id: string,
      patch: Partial<
        Pick<
          Candidate,
          | "first_name"
          | "last_name"
          | "phone"
          | "remark"
          | "title_key"
          | "title_en"
          | "title_th"
          | "title_other_en"
          | "title_other_th"
          | "eng_first_name"
          | "eng_last_name"
          | "position"
          | "duty"
          | "line_id"
          | "email"
        >
      >
    ) => {
      try {
        if (session?.kind !== "candidate" || session.candidate.id !== id) {
          return { ok: false as const, error: "ยืนยันตัวตนไม่สำเร็จ" };
        }
        const updatedProfile = await updateOwnProfile(id, session.candidate.phone, patch);
        setCandidates((prev) => prev.map((c) => (c.id === id ? updatedProfile : c)));
        setSession((prev) => {
          if (prev?.kind === "candidate" && prev.candidate.id === id) {
            const updated: SessionUser = { kind: "candidate", candidate: updatedProfile };
            writeSession(updated);
            return updated;
          }
          return prev;
        });
        return { ok: true as const };
      } catch (err) {
        return { ok: false as const, error: err instanceof Error ? err.message : "อัปเดตไม่สำเร็จ" };
      }
    },
    [session]
  );

  const adminUpdateCandidate = useCallback(
    async (id: string, patch: Partial<Pick<Candidate, "first_name" | "last_name" | "phone" | "remark">>) => {
      try {
        const token = requireAdminToken(session);
        const existing = candidates.find((c) => c.id === id);
        const result = await adminUpdateProfileRpc(token, {
          profile_id: id,
          first_name: patch.first_name ?? existing?.first_name ?? "",
          last_name: patch.last_name ?? existing?.last_name ?? "",
          phone: patch.phone ?? existing?.phone ?? "",
          remark: patch.remark ?? existing?.remark,
        });
        if (!result.ok) return result;
        setCandidates((prev) =>
          prev.map((c) =>
            c.id === id
              ? {
                  ...c,
                  ...patch,
                  full_name: `${patch.first_name ?? c.first_name} ${patch.last_name ?? c.last_name}`.trim(),
                }
              : c
          )
        );
        return { ok: true as const };
      } catch (err) {
        return { ok: false as const, error: err instanceof Error ? err.message : "อัปเดตไม่สำเร็จ" };
      }
    },
    [candidates, session]
  );

  const adminDeleteCandidate = useCallback(async (id: string) => {
    try {
      const token = requireAdminToken(session);
      const result = await adminDeleteProfileRpc(token, id);
      if (!result.ok) return result;
      setCandidates((prev) => prev.filter((c) => c.id !== id));
      setWatchProgress((prev) => prev.filter((w) => w.candidate_id !== id));
      setExamProgress((prev) => prev.filter((e) => e.candidate_id !== id));
      void refreshData();
      return { ok: true as const };
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : "ลบไม่สำเร็จ" };
    }
  }, [refreshData, session]);

  const getWatchFor = useCallback(
    (candidateId: string, videoId?: string) =>
      watchProgress.find((w) => w.candidate_id === candidateId && (!videoId || w.video_id === videoId)),
    [watchProgress]
  );

  const getExamFor = useCallback(
    (candidateId: string, projectId?: string) =>
      examProgress.find((e) => e.candidate_id === candidateId && (!projectId || e.project_id === projectId || !e.project_id)),
    [examProgress]
  );

  const currentCandidate = session?.kind === "candidate" ? session.candidate : null;
  const isAdmin = session?.kind === "admin";
  const isSuperAdmin = session?.kind === "admin" && session.admin.role === "super_admin";
  const adminToken = session?.kind === "admin" ? session.token : null;
  const adminUser = session?.kind === "admin" ? session.admin : null;

  const value = useMemo<IctStoreValue>(
    () => ({
      hydrated,
      loading,
      loadError,
      refreshData,
      districtStats,
      schoolTotals,
      candidates,
      watchProgress,
      examProgress,
      projects,
      videos,
      questions,
      activeProjectId,
      setActiveProjectId,
      saveProject,
      deleteProject,
      saveProjectVideo,
      deleteProjectVideo,
      saveProjectQuestion,
      deleteProjectQuestion,
      bulkSaveAnswerKeys,
      gradeProjectExams,
      session,
      currentCandidate,
      isAdmin,
      isSuperAdmin,
      adminToken,
      adminUser,
      lookupSchool,
      registerCandidate,
      login,
      loginAdmin,
      refreshAdminSession,
      logout,
      saveWatchProgress,
      saveExamDraft,
      submitExam,
      unlockExamForCandidate,
      adminUpdateCandidate,
      updateCandidateProfile,
      adminDeleteCandidate,
      getWatchFor,
      getExamFor,
    }),
    [
      activeProjectId,
      adminDeleteCandidate,
      adminToken,
      adminUpdateCandidate,
      updateCandidateProfile,
      adminUser,
      bulkSaveAnswerKeys,
      candidates,
      currentCandidate,
      deleteProject,
      deleteProjectQuestion,
      deleteProjectVideo,
      districtStats,
      examProgress,
      getExamFor,
      getWatchFor,
      gradeProjectExams,
      hydrated,
      isAdmin,
      isSuperAdmin,
      loadError,
      loading,
      login,
      loginAdmin,
      logout,
      lookupSchool,
      projects,
      questions,
      refreshAdminSession,
      refreshData,
      registerCandidate,
      saveExamDraft,
      saveProject,
      saveProjectQuestion,
      saveProjectVideo,
      saveWatchProgress,
      schoolTotals,
      session,
      submitExam,
      unlockExamForCandidate,
      videos,
      watchProgress,
    ]
  );

  return <IctStoreContext.Provider value={value}>{children}</IctStoreContext.Provider>;
}

export function useIctStore() {
  const ctx = useContext(IctStoreContext);
  if (!ctx) throw new Error("useIctStore must be used within IctStoreProvider");
  return ctx;
}

export function useSchoolStats() {
  const { schoolTotals } = useIctStore();
  return schoolTotals;
}
