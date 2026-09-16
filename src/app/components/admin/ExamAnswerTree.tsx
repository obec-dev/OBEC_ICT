"use client";

import { useMemo, useState } from "react";
import { canonicalMcqValue, permanentQuestionCode } from "@/lib/answerKeys";
import { groupQuestionsBySection } from "@/lib/examSections";
import { inputClass } from "@/lib/styles";
import type { NumberedQuestion } from "@/lib/examSections";
import type { ExamSection, ProjectQuestion } from "@/types/ict";

type Props = {
  sections: ExamSection[];
  questions: ProjectQuestion[];
  onSaveAnswer: (question: NumberedQuestion, value: string) => void;
};

export function ExamAnswerTree({ sections, questions, onSaveAnswer }: Props) {
  const parts = useMemo(() => groupQuestionsBySection(questions, sections), [questions, sections]);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});

  return (
    <div className="space-y-4">
      {parts.map((part, partIndex) => {
        const open = openSections[part.id] !== false;
        return (
          <section key={part.id} className="rounded-2xl border border-emerald-100 bg-white overflow-hidden">
            <button
              type="button"
              className="flex w-full items-center justify-between bg-emerald-50/70 px-5 py-3 text-left"
              onClick={() => setOpenSections((prev) => ({ ...prev, [part.id]: !open }))}
            >
              <span>
                <span className="block text-xs font-bold text-emerald-800">บทเรียนที่ {partIndex + 1}</span>
                <span className="text-base font-extrabold text-emerald-950">{part.title}</span>
              </span>
              <span className="text-xs font-bold text-emerald-800">{open ? "ย่อ" : "ขยาย"}</span>
            </button>
            {open && (
              <div className="space-y-3 p-4">
                {part.questions.map((question) => {
                  const selectedChoice = (() => {
                    if (!question.correct_answer) return "";
                    const stored = canonicalMcqValue(question.correct_answer, question.options || []);
                    if (!stored) return "";
                    const matchIdx = question.options?.findIndex((option) => option.trim() === stored) ?? -1;
                    return matchIdx >= 0 ? String(matchIdx + 1) : "";
                  })();
                  return (
                    <div key={question.id} className="flex flex-col gap-3 rounded-xl border border-gray-200 p-4 md:flex-row md:items-center md:justify-between">
                      <div className="flex-1">
                        <p className="text-sm font-bold text-[var(--primary-blue)]">
                          ข้อที่ {question.globalNumber} [{question.type === "mcq" ? "choice" : "open"}]
                        </p>
                        <p className="font-mono text-[11px] text-gray-400">
                          {permanentQuestionCode(question) || "รอรหัส Q001"}
                          {!question.correct_answer?.trim() ? " · ยังไม่กำหนดเฉลย" : ""}
                        </p>
                        <p className="text-sm font-semibold text-gray-700">{question.prompt}</p>
                      </div>
                      <div className="w-full shrink-0 md:w-72">
                        {question.type === "mcq" && question.options && question.options.length > 0 ? (
                          <select
                            className={`${inputClass} border-emerald-300 bg-emerald-50/50 text-xs font-bold text-emerald-800`}
                            value={selectedChoice}
                            onChange={(e) => {
                              if (!e.target.value) {
                                onSaveAnswer(question, "");
                                return;
                              }
                              const choice = question.options?.[Number(e.target.value) - 1];
                              if (choice) onSaveAnswer(question, choice);
                            }}
                          >
                            <option value="">-- เลือกเฉลยคำตอบ --</option>
                            {question.options.map((opt, optIdx) => (
                              <option key={optIdx} value={String(optIdx + 1)}>
                                ตัวเลือกที่ {optIdx + 1}: {opt}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            className={`${inputClass} border-emerald-300 text-xs`}
                            value={question.correct_answer || ""}
                            placeholder="กรอกคำตอบเฉลย..."
                            onChange={(e) => onSaveAnswer(question, e.target.value)}
                          />
                        )}
                      </div>
                    </div>
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
