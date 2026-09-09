"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AuthGuard } from "@/app/components/AuthGuard";
import { ModalOverlay } from "@/app/components/ModalOverlay";
import { PeriodClosedNotice } from "@/app/components/PeriodClosedNotice";
import { UnsavedLeaveGuard } from "@/app/components/UnsavedLeaveGuard";
import { useIctStore } from "@/contexts/IctStore";
import { getProjectExamStatus, getProjectLearningOpen, getSiteProject } from "@/lib/siteSettings";
import { inputClass } from "@/lib/styles";
import { questionPoints } from "@/lib/numberInput";
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
  projectQuestions: ProjectQuestion[];
  exam: ExamProgress | undefined;
  locked: boolean;
  initialAnswers: Record<string, string>;
  initialSavedAt: string | null;
};

function ExamWorkspace({
  currentProject,
  projectQuestions,
  exam,
  locked,
  initialAnswers,
  initialSavedAt,
}: ExamWorkspaceProps) {
  const { saveExamDraft, submitExam } = useIctStore();

  const [answers, setAnswers] = useState<Record<string, string>>(initialAnswers);
  const [lastSavedAnswers, setLastSavedAnswers] = useState<Record<string, string>>(initialAnswers);
  const [savedAt, setSavedAt] = useState<string | null>(initialSavedAt);
  /** hidden until first save in this session; then saved | dirty */
  const [syncStatus, setSyncStatus] = useState<"hidden" | "saved" | "dirty">("hidden");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const isDirty = useMemo(
    () => !locked && !answersEqual(answers, lastSavedAnswers),
    [answers, lastSavedAnswers, locked]
  );

  const setAnswer = (id: string, value: string) => {
    if (locked) return;
    setAnswers((prev) => ({ ...prev, [id]: value }));
    setSaveMessage("");
    setSaveError("");
    setSyncStatus((prev) => (prev === "hidden" ? "dirty" : "dirty"));
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
      setSavedAt(new Date().toISOString());
      setSyncStatus("saved");
      setSaveMessage("บันทึกคำตอบล่าสุดแล้ว");
      return true;
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "บันทึกคำตอบไม่สำเร็จ");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async () => {
    if (submitting) return;
    setSubmitting(true);
    setSaveError("");
    try {
      if (!ensureExamOpen()) return;
      const result = await submitExam(answers, currentProject?.id);
      if (!result.ok) {
        setSaveError(result.error);
        return;
      }
      setLastSavedAnswers(answers);
      setConfirmOpen(false);
      setSaveMessage("ส่งคำตอบเรียบร้อยแล้ว");
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
              แบบทดสอบประเมินผล
            </span>
            <h1 className="text-3xl font-extrabold text-[var(--primary-blue)]">
              {currentProject?.name ? `ข้อสอบ: ${currentProject.name}` : "ข้อสอบคัดเลือกตัวแทน ICT Talent"}
            </h1>
            <p className="text-gray-500 text-sm mt-1">
              {locked
                ? "ส่งคำตอบแล้ว ไม่สามารถแก้ไขได้"
                : "ท่านสามารถบันทึกคำตอบแล้วกลับมาทำต่อภายหลังได้จนกว่าจะหมดช่วงเวลาสอบ"}
            </p>
          </div>

          <div className="flex flex-col items-start md:items-end gap-1 shrink-0">
            <Link href="/portal/learn" className="text-xs font-bold text-[var(--primary-blue)] hover:underline mb-1">
              ← กลับไปหน้าบทเรียน
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
          <div className="mt-4 p-4 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center justify-between">
            <div>
              <span className="text-xs font-bold text-emerald-800 uppercase tracking-wider">ผลการประเมินการทดสอบ:</span>
              <div className="text-lg font-extrabold text-emerald-900 mt-0.5">
                คะแนนที่ได้: {exam.score ?? 0} / {currentProject?.max_score ?? 5} คะแนน
              </div>
            </div>
            <span
              className={`px-4 py-1.5 rounded-full font-extrabold text-sm ${
                exam.passed ? "bg-emerald-600 text-white shadow" : "bg-red-500 text-white shadow"
              }`}
            >
              {exam.passed ? "✓ ผ่านการทดสอบ (Passed)" : "✕ ไม่ผ่านเกณฑ์ (Failed)"}
            </span>
          </div>
        )}
      </div>

      {projectQuestions.length === 0 ? (
        <div className="bg-white rounded-2xl p-10 text-center text-gray-500 border border-gray-100 shadow-sm">
          ยังไม่มีคำถามในชุดข้อสอบนี้
        </div>
      ) : (
        <div className="space-y-6">
          {projectQuestions.map((question, index) => (
            <div key={question.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
              <div className="flex justify-between items-start mb-4">
                <h2 className="font-bold text-gray-800 text-base md:text-lg">
                  {index + 1}. {question.prompt}
                </h2>
                {questionPoints(question.points) > 0 && (
                  <span className="text-xs font-bold text-blue-700 bg-blue-50 px-2.5 py-1 rounded-full border border-blue-100 shrink-0 ml-2">
                    {questionPoints(question.points)} คะแนน
                  </span>
                )}
                {questionPoints(question.points) === 0 && (
                  <span className="text-xs font-bold text-gray-500 bg-gray-50 px-2.5 py-1 rounded-full border border-gray-200 shrink-0 ml-2">
                    ไม่คิดคะแนน
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
                      <span className="text-sm text-gray-700">{option}</span>
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

      {!locked && projectQuestions.length > 0 && (
        <div className="mt-8 flex flex-col sm:flex-row justify-end gap-3">
          <button
            type="button"
            disabled={saving || submitting || !isDirty}
            onClick={() => void commitDraft()}
            className="rounded-full border-2 border-[var(--primary-blue)] text-[var(--primary-blue)] px-8 py-3.5 font-bold disabled:opacity-40 hover:bg-blue-50 transition-all"
          >
            {saving ? "กำลังบันทึก..." : "บันทึกคำตอบ"}
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
            ส่งคำตอบสุดท้าย
          </button>
        </div>
      )}

      {confirmOpen && (
        <ModalOverlay onBackdropClick={() => !submitting && setConfirmOpen(false)}>
          <div className="bg-white rounded-3xl p-8 shadow-2xl border border-gray-100 mx-auto">
            <h3 className="text-xl font-bold text-[var(--primary-blue)] mb-2">ยืนยันการส่งข้อสอบ?</h3>
            <p className="text-gray-600 text-sm mb-4">
              หลังจากส่งข้อสอบแล้ว จะไม่สามารถแก้ไขคำตอบได้อีก
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
                onClick={() => void handleSubmit()}
              >
                {submitting ? "กำลังส่ง..." : "ยืนยันส่งข้อสอบ"}
              </button>
            </div>
          </div>
        </ModalOverlay>
      )}
    </div>
  );
}

function ExamContent() {
  const { currentCandidate, getExamFor, projects, questions } = useIctStore();

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

  const exam = currentCandidate ? getExamFor(currentCandidate.id, currentProject?.id) : undefined;
  const locked = exam?.status === "submitted";

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

  if (!examStatus.open && !locked) {
    return <PeriodClosedNotice title="ยังไม่เปิดช่วงสอบ" status={examStatus} homeHref="/portal/learn" />;
  }

  const workspaceKey = `${currentCandidate?.id ?? "anon"}-${currentProject.id}-${exam?.status ?? "none"}`;

  return (
    <ExamWorkspace
      key={workspaceKey}
      currentProject={currentProject}
      projectQuestions={projectQuestions}
      exam={exam}
      locked={locked}
      initialAnswers={exam?.answers ?? {}}
      initialSavedAt={exam?.updated_at ?? null}
    />
  );
}

export default function ExamPage() {
  return (
    <AuthGuard>
      <ExamContent />
    </AuthGuard>
  );
}
