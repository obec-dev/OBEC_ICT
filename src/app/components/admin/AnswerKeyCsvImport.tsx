"use client";

import { useRef, useState } from "react";
import {
  buildAnswerKeyTemplate,
  previewAnswerKeyCsv,
  type AnswerKeyPreviewRow,
} from "@/lib/answerKeys";
import type { ExamSection, ProjectQuestion } from "@/types/ict";

type AppliedKey = {
  questionId?: string;
  questionCode?: string;
  correctAnswer?: string | null;
};

type Props = {
  projectId: string;
  questions: ProjectQuestion[];
  sections: ExamSection[];
  onApply: (
    updates: AppliedKey[]
  ) => Promise<{ ok: true; updatedCount: number } | { ok: false; error: string }>;
  onStatus: (message: string, isError?: boolean) => void;
};

export function AnswerKeyCsvImport({ questions, sections, onApply, onStatus }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<AnswerKeyPreviewRow[]>([]);
  const [busy, setBusy] = useState(false);

  const errors = preview.filter((row) => row.status === "error");
  const ready = preview.filter((row) => row.status === "ok" && row.questionId && row.storedAnswer);

  const downloadTemplate = () => {
    const blob = new Blob([buildAnswerKeyTemplate(questions, sections)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "answer-keys-template.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleFile = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || "");
      setPreview(previewAnswerKeyCsv(text, questions, sections));
    };
    reader.readAsText(file);
  };

  const apply = async () => {
    if (errors.length > 0) {
      onStatus("ยังนำเข้าไม่ได้ กรุณาแก้แถวที่มีข้อผิดพลาดก่อน", true);
      return;
    }
    if (ready.length === 0) {
      onStatus("ไม่มีเฉลยใหม่ให้บันทึก แถวที่เว้นว่างถือว่ายังไม่กำหนด", true);
      return;
    }
    setBusy(true);
    try {
      const updates = ready.map((row) => ({
        questionId: row.questionId,
        questionCode: row.questionCode,
        correctAnswer: row.storedAnswer,
      }));
      const res = await onApply(updates);
      if (!res.ok) {
        onStatus(res.error || "นำเข้าเฉลยไม่สำเร็จ", true);
        return;
      }
      onStatus(`บันทึกเฉลยตามรหัสข้อถาวรแล้ว ${res.updatedCount} ข้อ`);
      setPreview([]);
      if (fileRef.current) fileRef.current.value = "";
    } catch (err) {
      onStatus(err instanceof Error ? err.message : "นำเข้าเฉลยไม่สำเร็จ", true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-8 rounded-2xl border border-emerald-200 bg-emerald-50/50 p-6">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-bold text-emerald-900">อัปโหลดเฉลยผ่านไฟล์ CSV</h3>
          <p className="mt-1 text-xs leading-relaxed text-gray-600">
            จับคู่ด้วยรหัสคำถาม <code>question_id</code> เช่น <code>Q001</code> ช่องเฉลยเว้นว่างไว้ได้ หากไม่มีการเปลี่ยนแปลง
          </p>
        </div>
        <button
          type="button"
          onClick={downloadTemplate}
          className="rounded-full bg-white px-4 py-2 text-xs font-bold text-emerald-800 ring-1 ring-emerald-200 hover:bg-emerald-50"
        >
          ดาวน์โหลดเทมเพลต
        </button>
      </div>
      <p className="mb-4 text-xs text-gray-600">
        การใส่จะเป็น <code>question_code</code> แล้วตามด้วยคำตอบ เช่น <code>Q001,2</code> ข้อที่เป็นตัวเลือกให้ใส่เลขตัวเลือก ข้อที่เป็นข้อความให้ใส่ข้อความได้
      </p>
      <input
        ref={fileRef}
        type="file"
        accept=".csv,.txt,text/csv"
        onChange={(event) => handleFile(event.target.files?.[0])}
        className="cursor-pointer text-xs file:mr-4 file:rounded-full file:border-0 file:bg-emerald-600 file:px-4 file:py-2 file:text-xs file:font-bold file:text-white hover:file:bg-emerald-700"
      />

      {preview.length > 0 && (
        <div className="mt-4 rounded-xl border border-emerald-200 bg-white p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-xs font-bold text-emerald-800">
              ตรวจสอบก่อนบันทึก · พร้อม {ready.length} ข้อ
              {errors.length > 0 ? ` · ข้อผิดพลาด ${errors.length} แถว` : ""}
            </h4>
            <button
              type="button"
              disabled={busy || errors.length > 0 || ready.length === 0}
              onClick={() => void apply()}
              className="rounded-full bg-emerald-800 px-5 py-2 text-xs font-bold text-white disabled:opacity-40"
            >
              {busy ? "กำลังบันทึก..." : `ยืนยันการนำเข้า (${ready.length} ข้อ)`}
            </button>
          </div>
          <div className="max-h-72 space-y-2 overflow-y-auto">
            {preview.map((row) => (
              <div
                key={`${row.line}-${row.questionId || row.questionCode || "row"}`}
                className={`rounded-lg border px-3 py-2 text-xs ${
                  row.status === "error"
                    ? "border-red-200 bg-red-50"
                    : row.status === "skip"
                      ? "border-gray-200 bg-gray-50"
                      : "border-emerald-100 bg-emerald-50/40"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-gray-500">
                    แถว {row.line}
                    {row.questionCode ? ` · ${row.questionCode}` : ""}
                    {row.displayNumber ? ` · แสดงเป็นข้อ ${row.displayNumber}` : ""}
                    {row.type ? ` · ${row.type === "mcq" ? "ปรนัย" : "อัตนัย"}` : ""}
                  </span>
                  <span className={row.status === "error" ? "font-bold text-red-700" : "font-bold text-emerald-800"}>
                    {row.status === "error" ? "ไม่ผ่าน" : row.status === "skip" ? "ยังไม่กำหนด" : "พร้อมบันทึก"}
                  </span>
                </div>
                {row.prompt && <p className="mt-1 text-gray-700">{row.prompt}</p>}
                <p className="mt-1 text-gray-600">
                  ค่าในไฟล์: <span className="font-semibold">{row.rawAnswer || "—"}</span>
                  {row.storedAnswer ? ` → บันทึก "${row.storedAnswer}"` : ""}
                </p>
                <p className={row.status === "error" ? "mt-1 font-semibold text-red-700" : "mt-1 text-gray-500"}>
                  {row.message}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
