"use client";

import { useEffect, useMemo, useState } from "react";
import { useIctStore } from "@/contexts/IctStore";
import { sortProjectVideos } from "@/lib/lessonExamMap";
import { inputClass } from "@/lib/styles";
import {
  adminFetchExamSections,
  deleteExamSectionDb,
  upsertExamSection,
} from "@/lib/supabase/projects";
import type { ExamSection, ProjectVideo } from "@/types/ict";

type Props = {
  projectId: string;
  onChange: (sections: ExamSection[]) => void;
};

export function ExamSectionManager({ projectId, onChange }: Props) {
  const { session, videos, saveProjectVideo } = useIctStore();
  const token = session?.kind === "admin" ? session.token : "";
  const [sections, setSections] = useState<ExamSection[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const projectVideos = useMemo(
    () => sortProjectVideos(videos.filter((video) => video.project_id === projectId)),
    [videos, projectId]
  );

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
        if (!cancelled) setError(err instanceof Error ? err.message : "โหลดบทเรียนไม่สำเร็จ");
      });
    return () => {
      cancelled = true;
    };
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
      setError("กรุณากรอกชื่อบทเรียน");
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
      setError(err instanceof Error ? err.message : "บันทึกบทเรียนไม่สำเร็จ");
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

    // Keep video↔lesson pairs glued: apply the same permutation to video order_index
    // and re-bind exam_section_id to the section at the same index.
    const nextVideos = [...projectVideos];
    if (index < nextVideos.length && target < nextVideos.length) {
      const [videoItem] = nextVideos.splice(index, 1);
      nextVideos.splice(target, 0, videoItem);
    }
    const reorderedVideos = nextVideos.map((video, order) => ({
      ...video,
      order_index: order + 1,
      exam_section_id: reordered[order]?.id ?? video.exam_section_id ?? null,
    }));

    setBusy(true);
    setError("");
    try {
      await Promise.all(reordered.map((section) => upsertExamSection(token, section)));
      for (const video of reorderedVideos) {
        const res = await saveProjectVideo(video);
        if (!res.ok) throw new Error(res.error);
      }
      publish(reordered);
    } catch (err) {
      setError(err instanceof Error ? err.message : "จัดลำดับบทเรียนไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (section: ExamSection) => {
    if (!token) return;
    if (!confirm(`ลบบทเรียน “${section.title}”? คำถามในบทนี้จะยังอยู่ แต่ไม่สังกัดบทเรียน`)) return;
    setBusy(true);
    setError("");
    try {
      await deleteExamSectionDb(token, section.id);
      // Clear video mappings that pointed at this section
      for (const video of projectVideos.filter((v) => v.exam_section_id === section.id)) {
        const res = await saveProjectVideo({ ...video, exam_section_id: null });
        if (!res.ok) throw new Error(res.error);
      }
      publish(sections.filter((item) => item.id !== section.id));
      if (editingId === section.id) resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "ลบบทเรียนไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };

  const mapVideoToSection = async (video: ProjectVideo, sectionId: string) => {
    setBusy(true);
    setError("");
    try {
      const res = await saveProjectVideo({
        ...video,
        exam_section_id: sectionId || null,
      });
      if (!res.ok) throw new Error(res.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : "ผูกวิดีโอกับแบบทดสอบไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };

  const autoMapByOrder = async () => {
    if (!token || sections.length === 0) return;
    setBusy(true);
    setError("");
    try {
      for (let i = 0; i < projectVideos.length; i++) {
        const section = sections[i];
        if (!section) continue;
        const video = projectVideos[i];
        const res = await saveProjectVideo({
          ...video,
          order_index: i + 1,
          exam_section_id: section.id,
        });
        if (!res.ok) throw new Error(res.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "แมปอัตโนมัติไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-8 rounded-2xl border border-blue-100 bg-blue-50/40 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-extrabold text-[var(--primary-blue)]">บทเรียน / แบบทดสอบ</h3>
          <p className="mt-1 text-xs text-gray-500">
            กำหนดชื่อบทเรียน และผูกวิดีโอ ↔ แบบทดสอบแบบ 1 ต่อ 1 (แนะนำให้ตรงลำดับบทเรียนที่ 1, 2, …)
          </p>
        </div>
        <button
          type="button"
          disabled={busy || sections.length === 0 || projectVideos.length === 0}
          onClick={() => void autoMapByOrder()}
          className="rounded-full border border-[var(--primary-blue)] bg-white px-3 py-1.5 text-xs font-bold text-[var(--primary-blue)] disabled:opacity-40"
        >
          แมปวิดีโอตามลำดับอัตโนมัติ
        </button>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-[1.2fr_1.4fr_auto]">
        <input
          className={inputClass}
          placeholder="ชื่อบทเรียน"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <input
          className={inputClass}
          placeholder="คำอธิบายบทเรียน (ไม่บังคับ)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => void save()}
          className="rounded-full bg-[var(--primary-blue)] px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
        >
          {editingId ? "บันทึกบทเรียน" : "+ เพิ่มบทเรียน"}
        </button>
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      {sections.length > 0 && (
        <ol className="mt-4 space-y-2">
          {sections.map((section, index) => {
            const mappedVideo = projectVideos.find((v) => v.exam_section_id === section.id);
            return (
              <li
                key={section.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white bg-white px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-gray-800">
                    บทเรียนที่ {index + 1}: {section.title}
                  </p>
                  {section.description && <p className="text-xs text-gray-500">{section.description}</p>}
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <label className="text-[11px] font-semibold text-gray-500">วิดีโอ : </label>
                    <select
                      className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs max-w-[240px]"
                      disabled={busy}
                      value={mappedVideo?.id || ""}
                      onChange={(e) => {
                        const videoId = e.target.value;
                        if (!videoId) {
                          if (mappedVideo) void mapVideoToSection(mappedVideo, "");
                          return;
                        }
                        const video = projectVideos.find((v) => v.id === videoId);
                        if (video) void mapVideoToSection(video, section.id);
                      }}
                    >
                      <option value="">— ยังไม่ผูก —</option>
                      {projectVideos.map((video, vIdx) => (
                        <option key={video.id} value={video.id}>
                          วิดีโอที่ {vIdx + 1}: {video.title}
                          {video.exam_section_id && video.exam_section_id !== section.id
                            ? " (ผูกกับบทอื่นแล้ว)"
                            : ""}
                        </option>
                      ))}
                    </select>
                    {!mappedVideo && (
                      <span className="text-[11px] font-semibold text-amber-700">
                        ยังไม่ได้บันทึกการผูกจริง — กดแมปอัตโนมัติหรือเลือกวิดีโอ
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex gap-1">
                  <button
                    type="button"
                    disabled={busy}
                    className="rounded-lg bg-gray-100 px-2 py-1 text-xs font-bold disabled:opacity-40"
                    onClick={() => void move(index, -1)}
                  >
                    ขึ้น
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    className="rounded-lg bg-gray-100 px-2 py-1 text-xs font-bold disabled:opacity-40"
                    onClick={() => void move(index, 1)}
                  >
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
                  <button
                    type="button"
                    className="rounded-lg bg-red-50 px-2 py-1 text-xs font-bold text-red-700"
                    onClick={() => void remove(section)}
                  >
                    ลบ
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
