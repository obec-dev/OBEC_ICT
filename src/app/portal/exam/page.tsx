"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthGuard } from "@/app/components/AuthGuard";
import { ExamAccessGate } from "@/app/components/ExamAccessGate";
import { ModalOverlay } from "@/app/components/ModalOverlay";
import { PeriodClosedNotice } from "@/app/components/PeriodClosedNotice";
import { UnsavedLeaveGuard } from "@/app/components/UnsavedLeaveGuard";
import { useIctStore } from "@/contexts/IctStore";
import type { ExamPart } from "@/lib/examSections";
import { groupQuestionsBySection } from "@/lib/examSections";
import { isLessonSubmitted, resolveExamPartFromParams } from "@/lib/lessonExamMap";
import { getProjectExamStatus, getProjectLearningOpen, getSiteProject } from "@/lib/siteSettings";
import { inputClass } from "@/lib/styles";
import type { ExamProgress, LearningProject, ProjectQuestion } from "@/types/ict";

function answersEqual(a: Record<string, string>, b: Record<string, string>) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if ((a[key] ?? "") !== (b[key] ?? "")) return false;
  }
  return true;
}

type ExamWorkspaceProps = {
  currentProject: LearningProject | undefined;
  allSectionIds: string[];
  activePart: ExamPart;
  lessonIndex: number;
  lessonTitle: string;
  exam: ExamProgress | undefined;
  lessonLocked: boolean;
  initialAnswers: Record<string, string>;
};

function ExamWorkspace({
  currentProject,
  allSectionIds,
  activePart,
  lessonIndex,
  lessonTitle,
  exam,
  lessonLocked,
  initialAnswers,
}: ExamWorkspaceProps) {
  const { saveExamDraft, submitExamLesson } = useIctStore();
  const locked = lessonLocked;

  const [answers, setAnswers] = useState<Record<string, string>>(initialAnswers);
  const [lastSavedAnswers, setLastSavedAnswers] = useState<Record<string, string>>(initialAnswers);
  const [syncStatus, setSyncStatus] = useState<"hidden" | "saved" | "dirty">("hidden");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const sectionQuestions = activePart.questions;
  const sectionAnswered = sectionQuestions.filter((q) => (answers[q.id] || "").trim()).length;

  const isDirty = useMemo(
    () => !locked && !answersEqual(answers, lastSavedAnswers),
    [answers, lastSavedAnswers, locked]
  );

  const setAnswer = (id: string, value: string) => {
    if (locked) return;
    setAnswers((prev) => ({ ...prev, [id]: value }));
    setSaveMessage("");
    setSaveError("");
    setSyncStatus("dirty");
  };

  const ensureExamOpen = (): boolean => {
    if (!currentProject) {
      setSaveError("ไม่พบข้อมูลโครงการ");
      return false;
    }
    if (!getProjectLearningOpen(currentProject)) {
      setSaveError("โครงการนี้ปิดใช้งานชั่วคราว");
      return false;
    }
    const status = getProjectExamStatus(currentProject);
    if (!status.open) {
      setSaveError(status.message);
      return false;
    }
    return true;
  };

  const commitDraft = async () => {
    setSaving(true);
    setSaveError("");
    try {
      if (!ensureExamOpen()) return false;
      const result = await saveExamDraft(answers, currentProject?.id);
      if (!result.ok) {
        setSaveError(result.error);
        return false;
      }
      setLastSavedAnswers(answers);
      setSyncStatus("saved");
      setSaveMessage("บันทึกร่างคำตอบบทเรียนนี้แล้ว");
      return true;
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "บันทึกคำตอบไม่สำเร็จ");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleSubmitLesson = async () => {
    if (submitting) return;
    setSubmitting(true);
    setSaveError("");
    try {
      if (!ensureExamOpen()) return;
      const missing = sectionQuestions.filter((q) => {
        if (q.answer_required === false) return false;
        return !(answers[q.id] || "").trim();
      });
      if (missing.length > 0) {
        setSaveError(`กรุณาตอบคำถามที่บังคับในบทนี้ให้ครบก่อนส่ง (${missing.length} ข้อยังไม่ได้ตอบ)`);
        setConfirmOpen(false);
        return;
      }
      const result = await submitExamLesson(
        answers,
        activePart.id,
        allSectionIds,
        currentProject?.id
      );
      if (!result.ok) {
        setSaveError(result.error);
        return;
      }
      setLastSavedAnswers(answers);
      setConfirmOpen(false);
      setSaveMessage(
        result.allDone
          ? "ส่งแบบทดสอบบทนี้แล้ว และส่งครบทุกบทเรียนแล้ว"
          : "ส่งแบบทดสอบบทเรียนนี้เรียบร้อยแล้ว — สามารถไปทำบทถัดไปได้จากหน้าบทเรียน"
      );
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "ส่งข้อสอบไม่สำเร็จ");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-12 animate-fade-in-up">
      <UnsavedLeaveGuard
        isDirty={isDirty}
        onSave={async () => {
          await commitDraft();
        }}
        onDiscard={async () => {
          setAnswers(lastSavedAnswers);
          setSaveMessage("ไม่บันทึกคำตอบปัจจุบัน — คงร่างล่าสุดที่บันทึกไว้");
        }}
        title="บันทึกคำตอบก่อนออก?"
        description="มีการแก้ไขคำตอบที่ยังไม่ได้บันทึก กด “บันทึก” เพื่อส่งคำตอบไปยังฐานข้อมูล หรือ “ไม่บันทึก” เพื่อคงคำตอบล่าสุดที่บันทึกไว้ก่อนหน้า"
      />

      <div className="mb-8 bg-white/70 backdrop-blur-md p-6 rounded-3xl border border-white/60 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <span className="text-xs font-bold text-[var(--primary-blue)] uppercase tracking-wider bg-blue-50 px-3 py-1 rounded-full border border-blue-100 mb-2 inline-block">
              แบบทดสอบบทเรียนที่ {lessonIndex}
            </span>
            <h1 className="text-3xl font-extrabold text-[var(--primary-blue)]">{activePart.title}</h1>
            <p className="text-gray-500 text-sm mt-1">
              {lessonTitle ? `จากวิดีโอ: ${lessonTitle}` : null}
              {activePart.description ? (
                <span className="block mt-1">{activePart.description}</span>
              ) : null}
            </p>
            <p className="text-gray-500 text-sm mt-2">
              {locked
                ? "ส่งแบบทดสอบบทนี้แล้ว ไม่สามารถแก้ไขได้"
                : ""}
            </p>
            <p className="text-xs font-semibold text-gray-500 mt-2">
              ตอบแล้ว {sectionAnswered} จาก {sectionQuestions.length} ข้อในบทนี้
            </p>
          </div>

          <div className="flex flex-col items-start md:items-end gap-1 shrink-0">
            <Link href="/portal/learn" className="text-xs font-bold text-[var(--primary-blue)] hover:underline mb-1">
              ← กลับไปหน้าบทเรียนและแบบทดสอบ
            </Link>
            {!locked && syncStatus === "saved" && (
              <span className="text-sm text-[var(--accent-green)] font-semibold">บันทึกคำตอบล่าสุดแล้ว</span>
            )}
            {!locked && syncStatus === "dirty" && (
              <span className="text-xs text-amber-700 font-semibold">มีการแก้ไขยังไม่บันทึก</span>
            )}
          </div>
        </div>

        {exam?.graded_at && currentProject?.enable_results_visibility && (
          <div className="mt-4 p-4 rounded-2xl bg-emerald-50 dark:bg-[rgba(61,143,130,0.18)] border border-emerald-200 dark:border-[var(--border-soft)] flex items-center justify-between gap-3">
            <div>
              <span className="text-xs font-bold text-emerald-800 dark:text-emerald-300 uppercase tracking-wider">
                ผลการประเมินการทดสอบ
              </span>
              <div className="text-base font-extrabold text-emerald-900 dark:text-emerald-100 mt-0.5">
                {exam.passed ? "ท่านผ่านการทดสอบแล้ว" : "ยังไม่ผ่านเกณฑ์การทดสอบ"}
              </div>
            </div>
            <span
              className={`px-4 py-1.5 rounded-full font-extrabold text-sm shrink-0 ${
                exam.passed ? "bg-emerald-600 text-white shadow" : "bg-red-500 text-white shadow"
              }`}
            >
              {exam.passed ? "✓ ผ่าน (Passed)" : "✕ ไม่ผ่าน (Failed)"}
            </span>
          </div>
        )}
      </div>

      {sectionQuestions.length === 0 ? (
        <div className="bg-white rounded-2xl p-10 text-center text-gray-500 border border-gray-100 shadow-sm">
          ยังไม่มีคำถามในแบบทดสอบบทเรียนนี้
          <div className="mt-4">
            <Link href="/portal/learn" className="text-sm font-bold text-[var(--primary-blue)] underline">
              กลับไปเลือกบทเรียนอื่น
            </Link>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {sectionQuestions.map((question, index) => (
            <div key={question.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
              <div className="flex justify-between items-start mb-4 gap-2">
                <h2 className="font-semibold text-base md:text-lg text-gray-800 dark:text-white">
                  {index + 1}. {question.prompt}
                  {question.answer_required !== false && (
                    <span className="text-[var(--accent-red)] ml-1" title="ต้องตอบก่อนส่ง">
                      *
                    </span>
                  )}
                </h2>
                {question.answer_required !== false && (
                  <span className="text-[10px] font-bold text-red-700 dark:text-red-300 bg-red-50 px-2 py-0.5 rounded-full border border-red-100 shrink-0">
                    บังคับตอบ
                  </span>
                )}
              </div>

              {question.image_url && (
                <div className="mb-4">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={question.image_url}
                    alt={`ภาพประกอบข้อ ${index + 1}`}
                    className="max-h-64 w-auto rounded-xl border border-gray-200 object-contain bg-gray-50"
                  />
                </div>
              )}

              {question.type === "mcq" && question.options && (
                <div className="space-y-2">
                  {question.options.map((option) => (
                    <label
                      key={option}
                      className={`flex items-start gap-3 rounded-xl border px-4 py-3 transition-all ${
                        answers[question.id] === option
                          ? "border-[var(--primary-blue)] bg-blue-50/80 font-medium"
                          : "border-gray-200 hover:border-gray-300"
                      } ${locked ? "opacity-70" : "cursor-pointer"}`}
                    >
                      <input
                        type="radio"
                        name={question.id}
                        disabled={locked}
                        checked={answers[question.id] === option}
                        onChange={() => setAnswer(question.id, option)}
                        className="mt-1 accent-[var(--primary-blue)]"
                      />
                      <span className="text-base text-gray-800 dark:text-white">{option}</span>
                    </label>
                  ))}
                </div>
              )}

              {(question.type === "open_ended" || question.type === "short") && (
                <div>
                  <textarea
                    className={`${inputClass} min-h-28 text-sm`}
                    disabled={locked}
                    placeholder="พิมพ์คำตอบของคุณที่นี่..."
                    value={answers[question.id] ?? ""}
                    onChange={(e) => setAnswer(question.id, e.target.value)}
                  />
                  {question.model_answer && (
                    <p className="mt-2 text-xs text-gray-500 bg-gray-50 p-2.5 rounded-lg border border-gray-200">
                      💡 <strong>คำแนะนำในการตอบ:</strong> {question.model_answer}
                    </p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {saveMessage && <p className="mt-4 text-sm text-[var(--accent-green)] font-semibold">{saveMessage}</p>}
      {saveError && <p className="mt-4 text-sm text-[var(--accent-red)] font-semibold">{saveError}</p>}

      {!locked && sectionQuestions.length > 0 && (
        <div className="mt-8 flex flex-col sm:flex-row justify-end gap-3">
          <button
            type="button"
            disabled={saving || submitting || !isDirty}
            onClick={() => void commitDraft()}
            className="rounded-full border-2 border-[var(--primary-blue)] text-[var(--primary-blue)] px-8 py-3.5 font-bold disabled:opacity-40 hover:bg-blue-50 transition-all"
          >
            {saving ? "กำลังบันทึก..." : "บันทึกร่างบทนี้"}
          </button>
          <button
            type="button"
            disabled={saving || submitting}
            onClick={() => {
              setSaveError("");
              setConfirmOpen(true);
            }}
            className="rounded-full bg-[var(--accent-red)] text-white px-8 py-3.5 font-bold hover:-translate-y-0.5 shadow-md transition-all disabled:opacity-40"
          >
            ส่งแบบทดสอบบทนี้
          </button>
        </div>
      )}

      {confirmOpen && (
        <ModalOverlay onBackdropClick={() => !submitting && setConfirmOpen(false)}>
          <div className="bg-white rounded-3xl p-8 shadow-2xl border border-gray-100 mx-auto">
            <h3 className="text-xl font-bold text-[var(--primary-blue)] mb-2">
              ยืนยันส่งแบบทดสอบบทเรียนที่ {lessonIndex}?
            </h3>
            <p className="text-gray-600 text-sm mb-4">
              หลังส่งแล้วจะไม่สามารถแก้ไขคำตอบในบทนี้ได้อีก แต่ยังทำและส่งบทเรียนอื่นได้ตามปกติ
            </p>
            {saveError && <p className="text-sm text-[var(--accent-red)] font-semibold mb-4">{saveError}</p>}
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                disabled={submitting}
                className="px-5 py-2.5 rounded-full border border-gray-300 font-bold text-gray-700 text-sm hover:bg-gray-50 disabled:opacity-40"
                onClick={() => setConfirmOpen(false)}
              >
                ยกเลิก
              </button>
              <button
                type="button"
                disabled={submitting}
                className="px-6 py-2.5 rounded-full bg-[var(--accent-red)] text-white font-bold text-sm hover:bg-red-700 shadow disabled:opacity-60"
                onClick={() => void handleSubmitLesson()}
              >
                {submitting ? "กำลังส่ง..." : "ยืนยันส่งบทนี้"}
              </button>
            </div>
          </div>
        </ModalOverlay>
      )}
    </div>
  );
}

function ExamContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const {
    currentCandidate,
    getExamFor,
    projects,
    videos,
    questions,
    examProgressReady,
    examProgressError,
    reloadExamProgress,
    ensureLearningContent,
  } = useIctStore();

  useEffect(() => {
    void ensureLearningContent();
  }, [ensureLearningContent]);

  const currentProject = useMemo(() => getSiteProject(projects), [projects]);

  const projectQuestions: ProjectQuestion[] = useMemo(() => {
    if (!currentProject) return [];
    const raw = questions.filter((q) => q.project_id === currentProject.id);
    return raw.map((q) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { correct_answer, model_answer, ...publicItem } = q;
      return publicItem as ProjectQuestion;
    });
  }, [currentProject, questions]);

  const projectVideos = useMemo(
    () => videos.filter((v) => v.project_id === currentProject?.id),
    [videos, currentProject?.id]
  );

  const videoIdParam = searchParams.get("videoId");
  const sectionParam = searchParams.get("section");

  const resolved = useMemo(
    () =>
      resolveExamPartFromParams(projectVideos, projectQuestions, {
        videoId: videoIdParam,
        section: sectionParam,
      }),
    [projectVideos, projectQuestions, videoIdParam, sectionParam]
  );

  useEffect(() => {
    if (!videoIdParam && !sectionParam) {
      router.replace("/portal/learn");
    }
  }, [router, sectionParam, videoIdParam]);

  const exam = currentCandidate ? getExamFor(currentCandidate.id, currentProject?.id) : undefined;
  const examFullySubmitted = exam?.status === "submitted";

  const examStatus = useMemo(() => {
    if (!currentProject) {
      return {
        open: false,
        reason: "disabled" as const,
        start: null,
        end: null,
        message: "ไม่พบโครงการที่เปิดใช้งาน",
      };
    }
    return getProjectExamStatus(currentProject);
  }, [currentProject]);

  if (!examProgressReady) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center text-gray-500">
        กำลังโหลดคำตอบล่าสุดจากระบบ...
      </div>
    );
  }

  if (examProgressError) {
    return (
      <div className="max-w-lg mx-auto px-4 py-16 text-center">
        <h1 className="text-xl font-extrabold text-[var(--primary-blue)] mb-2">โหลดคำตอบไม่สำเร็จ</h1>
        <p className="text-sm text-gray-500 mb-6">{examProgressError}</p>
        <button
          type="button"
          onClick={() => void reloadExamProgress()}
          className="rounded-full bg-[var(--primary-blue)] text-white px-6 py-3 font-bold"
        >
          ลองโหลดอีกครั้ง
        </button>
      </div>
    );
  }

  if (!currentProject) {
    return (
      <PeriodClosedNotice
        title="ยังไม่มีโครงการที่เปิดใช้งาน"
        status={{
          open: false,
          reason: "inactive",
          start: null,
          end: null,
          message: "ขณะนี้ไม่มีโครงการที่เปิดให้เข้าสอบ",
        }}
        homeHref="/portal/learn"
      />
    );
  }

  if (!examStatus.open && !examFullySubmitted) {
    return <PeriodClosedNotice title="ยังไม่เปิดช่วงสอบ" status={examStatus} homeHref="/portal/learn" />;
  }

  if (!resolved) {
    return (
      <div className="max-w-lg mx-auto px-4 py-16 text-center">
        <h1 className="text-xl font-extrabold text-[var(--primary-blue)] mb-2">ไม่พบแบบทดสอบของบทเรียนนี้</h1>
        <p className="text-sm text-gray-500 mb-6">
          กรุณาเลือกบทเรียนจากหน้าบทเรียนและแบบทดสอบ แล้วกดปุ่มทำแบบทดสอบประจำบทเรียน
        </p>
        <Link
          href="/portal/learn"
          className="inline-flex rounded-full bg-[var(--primary-blue)] text-white px-6 py-3 font-bold"
        >
          กลับไปหน้าบทเรียนและแบบทดสอบ
        </Link>
      </div>
    );
  }

  const allSectionIds = groupQuestionsBySection(projectQuestions).map((part) => part.id);
  const lessonLocked = isLessonSubmitted(exam, resolved.part.id);
  const workspaceKey = `${currentCandidate?.id ?? "anon"}-${currentProject.id}-${resolved.part.id}-${lessonLocked ? "locked" : "open"}`;

  return (
    <ExamWorkspace
      key={workspaceKey}
      currentProject={currentProject}
      allSectionIds={allSectionIds}
      activePart={resolved.part}
      lessonIndex={resolved.lessonIndex}
      lessonTitle={resolved.video?.title ?? ""}
      exam={exam}
      lessonLocked={lessonLocked}
      initialAnswers={exam?.answers ?? {}}
    />
  );
}

export default function ExamPage() {
  return (
    <AuthGuard requirePortalRoles={["user", "school_admin"]}>
      <ExamAccessGate mode="learn-exam">
        <Suspense
          fallback={
            <div className="max-w-3xl mx-auto px-4 py-16 text-center text-gray-500">กำลังโหลดแบบทดสอบ...</div>
          }
        >
          <ExamContent />
        </Suspense>
      </ExamAccessGate>
    </AuthGuard>
  );
}
