"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AuthGuard } from "@/app/components/AuthGuard";
import { PeriodClosedNotice } from "@/app/components/PeriodClosedNotice";
import { UnsavedLeaveGuard } from "@/app/components/UnsavedLeaveGuard";
import { useIctStore } from "@/contexts/IctStore";
import { getProjectExamStatus, type PeriodStatus } from "@/lib/siteSettings";
import { inputClass } from "@/lib/styles";
import type { ProjectQuestion } from "@/types/ict";

function answersEqual(a: Record<string, string>, b: Record<string, string>) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if ((a[key] ?? "") !== (b[key] ?? "")) return false;
  }
  return true;
}

function ExamContent() {
  const { currentCandidate, getExamFor, saveExamDraft, submitExam, projects, questions, activeProjectId, setActiveProjectId } =
    useIctStore();

  const currentProject = projects.find((p) => p.id === activeProjectId) || projects[0];

  // Anti-Cheating Sanitization: Candidate view omits correct_answer & model_answer
  const projectQuestions: ProjectQuestion[] = useMemo(() => {
    const raw = questions.filter((q) => q.project_id === (currentProject?.id || activeProjectId));
    return raw.map((q) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { correct_answer, model_answer, ...publicItem } = q;
      return publicItem as ProjectQuestion;
    });
  }, [activeProjectId, currentProject?.id, questions]);

  const exam = currentCandidate ? getExamFor(currentCandidate.id, currentProject?.id) : undefined;
  const locked = exam?.status === "submitted";

  const [answers, setAnswers] = useState<Record<string, string>>(exam?.answers ?? {});
  const [lastSavedAnswers, setLastSavedAnswers] = useState<Record<string, string>>(exam?.answers ?? {});
  const [savedAt, setSavedAt] = useState<string | null>(exam?.updated_at ?? null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const [examStatus, setExamStatus] = useState<PeriodStatus | null>(null);
  const [periodLoading, setPeriodLoading] = useState(true);

  useEffect(() => {
    if (exam?.answers) {
      setAnswers(exam.answers);
      setLastSavedAnswers(exam.answers);
      setSavedAt(exam.updated_at ?? null);
    } else {
      setAnswers({});
      setLastSavedAnswers({});
      setSavedAt(null);
    }
  }, [exam, activeProjectId]);

  useEffect(() => {
    if (currentProject) {
      setExamStatus(getProjectExamStatus(currentProject));
    } else {
      setExamStatus({
        open: false,
        reason: "disabled",
        start: null,
        end: null,
        message: "ไม่พบข้อมูลโครงการ",
      });
    }
    setPeriodLoading(false);
  }, [currentProject]);

  const isDirty = useMemo(
    () => !locked && !answersEqual(answers, lastSavedAnswers),
    [answers, lastSavedAnswers, locked]
  );

  const setAnswer = (id: string, value: string) => {
    if (locked) return;
    setAnswers((prev) => ({ ...prev, [id]: value }));
    setSaveMessage("");
  };

  const ensureExamOpen = (): boolean => {
    if (!currentProject) {
      setSaveError("ไม่พบข้อมูลโครงการ");
      return false;
    }
    const status = getProjectExamStatus(currentProject);
    setExamStatus(status);
    if (!status.open) {
      setSaveError(status.message);
      return false;
    }
    return true;
  };

  const commitDraft = async () => {
    try {
      if (!ensureExamOpen()) return false;
    } catch {
      setSaveError("ตรวจสอบช่วงสอบไม่สำเร็จ");
      return false;
    }
    const result = await saveExamDraft(answers, currentProject?.id);
    if (!result.ok) {
      setSaveError(result.error);
      return false;
    }
    setLastSavedAnswers(answers);
    setSavedAt(new Date().toISOString());
    setSaveError("");
    setSaveMessage("บันทึกร่างไปยังเซิร์ฟเวอร์แล้ว");
    return true;
  };

  const handleSubmit = async () => {
    setSaving(true);
    if (!ensureExamOpen()) {
      setSaving(false);
      return;
    }
    const result = await submitExam(answers, currentProject?.id);
    setSaving(false);
    if (!result.ok) {
      setSaveError(result.error);
      return;
    }
    setLastSavedAnswers(answers);
    setConfirmOpen(false);
    setSaveMessage("ส่งคำตอบเรียบร้อยแล้ว");
  };

  if (periodLoading) {
    return <div className="max-w-xl mx-auto px-4 py-16 text-center text-gray-500">กำลังตรวจสอบช่วงสอบ...</div>;
  }

  // Allow viewing submitted exams even after the window closes
  if (examStatus && !examStatus.open && !locked) {
    return <PeriodClosedNotice title="ยังไม่เปิดช่วงสอบ" status={examStatus} homeHref="/portal/learn" />;
  }

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
        title="บันทึกร่างข้อสอบก่อนออก?"
        description="มีการแก้ไขคำตอบที่ยังไม่ได้บันทึก กด “บันทึก” เพื่อส่งร่างไปยังฐานข้อมูล หรือ “ไม่บันทึก” เพื่อคงร่างล่าสุดที่บันทึกไว้ก่อนหน้า"
      />

      {/* Header Banner */}
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
                : "สามารถทำข้อสอบได้ทันทีในช่วงเวลาที่เปิด — ระบบจะถามก่อนออกจากหน้าหากยังไม่บันทึก"}
            </p>
          </div>

          <div className="flex flex-col items-start md:items-end gap-1 shrink-0">
            <Link href="/portal/learn" className="text-xs font-bold text-[var(--primary-blue)] hover:underline mb-1">
              ← กลับไปหน้าบทเรียน
            </Link>
            {!locked && (
              <>
                {savedAt && <span className="text-sm text-[var(--accent-green)] font-semibold">บันทึกร่างล่าสุดแล้ว</span>}
                {isDirty && <span className="text-xs text-amber-700 font-semibold">มีการแก้ไขยังไม่บันทึก</span>}
              </>
            )}
          </div>
        </div>

        {/* Graded Result Status Banner if exam has been evaluated */}
        {exam?.graded_at && (
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

        {/* Project Selector if multiple projects exist */}
        {projects.length > 1 && (
          <div className="mt-4 pt-4 border-t border-gray-100 flex items-center gap-3">
            <span className="text-xs font-semibold text-gray-600">เลือกชุดข้อสอบ:</span>
            <div className="flex flex-wrap gap-2">
              {projects.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setActiveProjectId(p.id)}
                  className={`px-3 py-1 rounded-full text-xs font-bold transition-all ${
                    (currentProject?.id || activeProjectId) === p.id
                      ? "bg-[var(--primary-blue)] text-white shadow"
                      : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  }`}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Question Cards */}
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
                {question.points && (
                  <span className="text-xs font-bold text-blue-700 bg-blue-50 px-2.5 py-1 rounded-full border border-blue-100 shrink-0 ml-2">
                    {question.points} คะแนน
                  </span>
                )}
              </div>

              {/* Multiple Choice Question */}
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

              {/* Open Ended Question */}
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
            disabled={saving || !isDirty}
            onClick={() => void commitDraft()}
            className="rounded-full border-2 border-[var(--primary-blue)] text-[var(--primary-blue)] px-8 py-3.5 font-bold disabled:opacity-40 hover:bg-blue-50 transition-all"
          >
            {saving ? "กำลังบันทึก..." : "บันทึกร่าง"}
          </button>
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            className="rounded-full bg-[var(--accent-red)] text-white px-8 py-3.5 font-bold hover:-translate-y-0.5 shadow-md transition-all"
          >
            ส่งคำตอบสุดท้าย
          </button>
        </div>
      )}

      {confirmOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl border border-gray-100">
            <h3 className="text-xl font-bold text-[var(--primary-blue)] mb-2">ยืนยันการส่งข้อสอบ?</h3>
            <p className="text-gray-600 text-sm mb-6">
              หลังจากส่งข้อสอบแล้ว จะไม่สามารถแก้ไขคำตอบของวิชา {currentProject?.name || ""} ได้อีก
            </p>
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                className="px-5 py-2.5 rounded-full border border-gray-300 font-bold text-gray-700 text-sm hover:bg-gray-50"
                onClick={() => setConfirmOpen(false)}
              >
                ยกเลิก
              </button>
              <button
                type="button"
                className="px-6 py-2.5 rounded-full bg-[var(--accent-red)] text-white font-bold text-sm hover:bg-red-700 shadow"
                onClick={() => void handleSubmit()}
              >
                ยืนยันส่งข้อสอบ
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ExamPage() {
  return (
    <AuthGuard>
      <ExamContent />
    </AuthGuard>
  );
}
