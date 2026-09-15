"use client";

import { useMemo, useState } from "react";
import { permanentQuestionCode } from "@/lib/answerKeys";
import { groupQuestionsBySection } from "@/lib/examSections";
import type { ExamSection, ProjectQuestion } from "@/types/ict";

type Props = {
  sections: ExamSection[];
  questions: ProjectQuestion[];
  onAddQuestion: (sectionId: string) => void;
  onEditQuestion: (question: ProjectQuestion) => void;
  onDeleteQuestion: (questionId: string) => void;
  onToggleRequired: (question: ProjectQuestion) => void;
  onMoveQuestion: (question: ProjectQuestion, direction: -1 | 1) => void;
};

export function ExamQuestionTree({
  sections,
  questions,
  onAddQuestion,
  onEditQuestion,
  onDeleteQuestion,
  onToggleRequired,
  onMoveQuestion,
}: Props) {
  const parts = useMemo(() => groupQuestionsBySection(questions, sections), [questions, sections]);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  const [openQuestions, setOpenQuestions] = useState<Record<string, boolean>>({});

  if (parts.length === 0) {
    return (
      <div className="p-12 text-center text-gray-400 bg-gray-50 rounded-2xl border border-dashed">
        สร้างส่วนข้อสอบก่อน แล้วเพิ่มคำถามใต้ส่วนนั้น
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {parts.map((part, partIndex) => {
        const sectionOpen = openSections[part.id] !== false;
        return (
          <section key={part.id} className="rounded-2xl border border-blue-100 bg-white overflow-hidden">
            <button
              type="button"
              className="flex w-full items-center justify-between gap-3 bg-blue-50/80 px-5 py-4 text-left"
              onClick={() => setOpenSections((prev) => ({ ...prev, [part.id]: !sectionOpen }))}
            >
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-[var(--primary-blue)]">
                  ส่วนที่ {partIndex + 1}
                </p>
                <h3 className="text-lg font-extrabold text-[var(--primary-blue)]">{part.title}</h3>
                <p className="text-xs text-gray-500">
                  {part.questions.length} ข้อ
                  {part.questions.length > 0
                    ? ` · ข้อ ${part.questions[0].globalNumber}–${part.questions[part.questions.length - 1].globalNumber}`
                    : ""}
                </p>
              </div>
              <span className="text-sm font-bold text-[var(--primary-blue)]">{sectionOpen ? "ย่อ" : "ขยาย"}</span>
            </button>

            {sectionOpen && (
              <div className="space-y-3 p-4">
                {part.description && <p className="text-sm text-gray-600">{part.description}</p>}
                {part.id !== "__unsectioned__" && (
                  <button
                    type="button"
                    onClick={() => onAddQuestion(part.id)}
                    className="rounded-full bg-[var(--accent-red)] px-4 py-2 text-xs font-bold text-white"
                  >
                    + เพิ่มคำถามในส่วนนี้
                  </button>
                )}
                {part.questions.length === 0 && (
                  <p className="text-sm text-gray-400">ยังไม่มีคำถามในส่วนนี้</p>
                )}
                {part.questions.map((question, index) => {
                  const open = openQuestions[question.id] === true;
                  return (
                    <article key={question.id} className="rounded-xl border border-gray-200">
                      <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                        <button
                          type="button"
                          className="flex min-w-0 flex-1 items-start gap-3 text-left"
                          onClick={() =>
                            setOpenQuestions((prev) => ({ ...prev, [question.id]: !open }))
                          }
                        >
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-100 text-sm font-bold text-[var(--primary-blue)]">
                            {question.globalNumber}
                          </span>
                          <span>
                            <span className="block text-sm font-bold text-gray-800">{question.prompt}</span>
                            <span className="text-xs text-gray-500">
                              {question.type === "mcq" ? "choice" : "open"} · {question.points ?? 1} คะแนน · {permanentQuestionCode(question) || "รอ Q001"} ·{" "}
                              {open ? "ย่อ" : "ขยาย"}
                            </span>
                          </span>
                        </button>
                        <div className="flex flex-wrap justify-end gap-1">
                          <button type="button" className="rounded-lg bg-gray-100 px-2 py-1 text-xs font-bold" onClick={() => onMoveQuestion(question, -1)} disabled={index === 0}>
                            ขึ้น
                          </button>
                          <button
                            type="button"
                            className="rounded-lg bg-gray-100 px-2 py-1 text-xs font-bold"
                            onClick={() => onMoveQuestion(question, 1)}
                            disabled={index === part.questions.length - 1}
                          >
                            ลง
                          </button>
                          <button type="button" className="rounded-lg bg-gray-100 px-2 py-1 text-xs font-bold" onClick={() => onToggleRequired(question)}>
                            {question.answer_required !== false ? "บังคับตอบ" : "ไม่บังคับ"}
                          </button>
                          <button type="button" className="rounded-lg bg-gray-100 px-2 py-1 text-xs font-bold" onClick={() => onEditQuestion(question)}>
                            แก้ไข
                          </button>
                          <button type="button" className="rounded-lg bg-red-50 px-2 py-1 text-xs font-bold text-red-700" onClick={() => onDeleteQuestion(question.id)}>
                            ลบ
                          </button>
                        </div>
                      </div>
                      {open && question.image_url && (
                        <div className="px-4 pb-3">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={question.image_url} alt="" className="max-h-40 rounded-xl border object-contain" />
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
