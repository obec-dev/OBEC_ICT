"use client";

import { useEffect, useState } from "react";
import { useIctStore } from "@/contexts/IctStore";
import { inputClass } from "@/lib/styles";
import {
  adminFetchExamSections,
  deleteExamSectionDb,
  upsertExamSection,
} from "@/lib/supabase/projects";
import type { ExamSection } from "@/types/ict";

type Props = {
  projectId: string;
  onChange: (sections: ExamSection[]) => void;
};

export function ExamSectionManager({ projectId, onChange }: Props) {
  const { session } = useIctStore();
  const token = session?.kind === "admin" ? session.token : "";
  const [sections, setSections] = useState<ExamSection[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const publish = (next: ExamSection[]) => {
    const ordered = [...next].sort((a, b) => a.section_order - b.section_order);
    setSections(ordered);
    onChange(ordered);
  };

  useEffect(() => {
    if (!token || !projectId) return;
    let cancelled = false;
    void adminFetchExamSections(token, projectId)
      .then((rows) => {
        if (!cancelled) publish(rows);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "โหลดส่วนข้อสอบไม่สำเร็จ");
      });
    return () => {
      cancelled = true;
    };
    // publish is stable enough for this load; sections are owned here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, projectId]);

  const resetForm = () => {
    setTitle("");
    setDescription("");
    setEditingId(null);
  };

  const save = async () => {
    if (!token) return;
    if (!title.trim()) {
      setError("กรุณากรอกชื่อส่วนข้อสอบ");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const nextOrder = editingId
        ? sections.find((section) => section.id === editingId)?.section_order ?? sections.length + 1
        : sections.length + 1;
      const section: ExamSection = {
        id: editingId || crypto.randomUUID(),
        project_id: projectId,
        title: title.trim(),
        description: description.trim() || null,
        section_order: nextOrder,
      };
      await upsertExamSection(token, section);
      publish(
        editingId
          ? sections.map((item) => (item.id === section.id ? section : item))
          : [...sections, section]
      );
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "บันทึกส่วนข้อสอบไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };

  const move = async (index: number, direction: -1 | 1) => {
    if (!token) return;
    const target = index + direction;
    if (target < 0 || target >= sections.length) return;
    const next = [...sections];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    const reordered = next.map((section, order) => ({ ...section, section_order: order + 1 }));
    setBusy(true);
    setError("");
    try {
      await Promise.all(reordered.map((section) => upsertExamSection(token, section)));
      publish(reordered);
    } catch (err) {
      setError(err instanceof Error ? err.message : "จัดลำดับส่วนข้อสอบไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (section: ExamSection) => {
    if (!token) return;
    if (!confirm(`ลบส่วน “${section.title}”? คำถามในส่วนนี้จะยังอยู่ แต่ไม่สังกัดส่วน`)) return;
    setBusy(true);
    setError("");
    try {
      await deleteExamSectionDb(token, section.id);
      publish(sections.filter((item) => item.id !== section.id));
      if (editingId === section.id) resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "ลบส่วนข้อสอบไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-8 rounded-2xl border border-blue-100 bg-blue-50/40 p-5">
      <h3 className="text-sm font-extrabold text-[var(--primary-blue)]">ส่วนข้อสอบ / Exam parts</h3>
      <p className="mt-1 text-xs text-gray-500">
        กำหนดชื่อและคำอธิบายในแต่ละส่วน
      </p>

      <div className="mt-4 grid gap-3 md:grid-cols-[1.2fr_1.4fr_auto]">
        <input
          className={inputClass}
          placeholder="ชื่อหัวข้อของส่วนนี้"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <input
          className={inputClass}
          placeholder="คำอธิบายของส่วนนี้ (ไม่บังคับ)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => void save()}
          className="rounded-full bg-[var(--primary-blue)] px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
        >
          {editingId ? "บันทึกส่วน" : "+ เพิ่มส่วน"}
        </button>
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      {sections.length > 0 && (
        <ol className="mt-4 space-y-2">
          {sections.map((section, index) => (
            <li
              key={section.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white bg-white px-3 py-2"
            >
              <div>
                <p className="text-sm font-bold text-gray-800">
                  ส่วนที่ {index + 1}: {section.title}
                </p>
                {section.description && <p className="text-xs text-gray-500">{section.description}</p>}
              </div>
              <div className="flex gap-1">
                <button type="button" className="rounded-lg bg-gray-100 px-2 py-1 text-xs font-bold" onClick={() => void move(index, -1)}>
                  ขึ้น
                </button>
                <button type="button" className="rounded-lg bg-gray-100 px-2 py-1 text-xs font-bold" onClick={() => void move(index, 1)}>
                  ลง
                </button>
                <button
                  type="button"
                  className="rounded-lg bg-gray-100 px-2 py-1 text-xs font-bold"
                  onClick={() => {
                    setEditingId(section.id);
                    setTitle(section.title);
                    setDescription(section.description || "");
                  }}
                >
                  แก้ไข
                </button>
                <button type="button" className="rounded-lg bg-red-50 px-2 py-1 text-xs font-bold text-red-700" onClick={() => void remove(section)}>
                  ลบ
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
