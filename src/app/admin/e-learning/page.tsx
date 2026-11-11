"use client";

import { useCallback, useEffect, useState } from "react";
import { AuthGuard } from "@/app/components/AuthGuard";
import { AdminNav } from "@/app/components/AdminNav";
import { useIctStore } from "@/contexts/IctStore";
import {
  adminDeleteSelfLearnVideo,
  adminListSelfLearnVideos,
  adminUpsertSelfLearnVideo,
  type SelfLearnVideo,
} from "@/lib/supabase/selfLearn";
import { inputClass } from "@/lib/styles";

function emptyForm() {
  return {
    id: "",
    title: "",
    video_url: "",
    score_points: 10,
    sort_order: 0,
    is_published: false,
  };
}

function ELearningAdminContent() {
  const { adminToken } = useIctStore();
  const [rows, setRows] = useState<SelfLearnVideo[]>([]);
  const [form, setForm] = useState(emptyForm());
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!adminToken) return;
    setLoading(true);
    try {
      setRows(await adminListSelfLearnVideos(adminToken));
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "โหลดไม่สำเร็จ — รัน supabase/self_learn_v1.sql");
    } finally {
      setLoading(false);
    }
  }, [adminToken]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const save = async () => {
    if (!adminToken) return;
    setError("");
    setMessage("");
    if (!form.title.trim() || !form.video_url.trim()) {
      setError("กรุณาระบุชื่อวิดีโอและลิงก์");
      return;
    }
    const result = await adminUpsertSelfLearnVideo(adminToken, {
      id: form.id || undefined,
      title: form.title.trim(),
      video_url: form.video_url.trim(),
      score_points: Number(form.score_points) || 0,
      sort_order: Number(form.sort_order) || 0,
      is_published: form.is_published,
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setMessage(form.id ? "บันทึกแล้ว" : "สร้างวิดีโอแล้ว");
    setForm(emptyForm());
    await reload();
  };

  const remove = async (id: string) => {
    if (!adminToken) return;
    if (!window.confirm("ลบวิดีโอนี้?")) return;
    const result = await adminDeleteSelfLearnVideo(adminToken, id);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setMessage("ลบแล้ว");
    await reload();
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-12 animate-fade-in-up admin-surface">
      <AdminNav />
      <h1 className="text-3xl font-extrabold text-[var(--primary-blue)] dark:text-white mb-2">
        E-learning (เรียนรู้ด้วยตนเอง)
      </h1>
      <p className="text-sm text-gray-500 mb-8">
        วิดีโอแยกจากบทเรียนและแบบทดสอบ — ผู้ใช้ดูใน /portal/e-learning
      </p>

      {error && <p className="text-sm text-[var(--accent-red)] mb-3">{error}</p>}
      {message && <p className="text-sm text-emerald-700 mb-3">{message}</p>}

      <div className="bg-white dark:bg-slate-950 rounded-2xl border border-gray-100 dark:border-slate-700 p-6 space-y-3 mb-8">
        <h2 className="font-bold text-[var(--primary-blue)]">
          {form.id ? "แก้ไขวิดีโอ" : "เพิ่มวิดีโอ"}
        </h2>
        <label className="block text-sm font-semibold">ชื่อวิดีโอ</label>
        <input
          className={inputClass}
          value={form.title}
          onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          placeholder="เช่น แนะนำการใช้ระบบ"
        />
        <label className="block text-sm font-semibold">ลิงก์วิดีโอ</label>
        <input
          className={inputClass}
          value={form.video_url}
          onChange={(e) => setForm((f) => ({ ...f, video_url: e.target.value }))}
          placeholder="https://www.youtube.com/watch?v=..."
        />
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-semibold">คะแนน</label>
            <input
              type="number"
              min={0}
              className={inputClass}
              value={form.score_points}
              onChange={(e) => setForm((f) => ({ ...f, score_points: Number(e.target.value) }))}
            />
          </div>
          <div>
            <label className="block text-sm font-semibold">ลำดับ</label>
            <input
              type="number"
              className={inputClass}
              value={form.sort_order}
              onChange={(e) => setForm((f) => ({ ...f, sort_order: Number(e.target.value) }))}
            />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input
            type="checkbox"
            checked={form.is_published}
            onChange={(e) => setForm((f) => ({ ...f, is_published: e.target.checked }))}
          />
          เผยแพร่ให้ผู้ใช้เห็น
        </label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void save()}
            className="rounded-full bg-[var(--primary-blue)] text-white px-5 py-2.5 font-bold"
          >
            บันทึก
          </button>
          {form.id && (
            <button
              type="button"
              onClick={() => setForm(emptyForm())}
              className="rounded-full border px-5 py-2.5 font-bold"
            >
              ยกเลิก
            </button>
          )}
        </div>
      </div>

      <div className="bg-white dark:bg-slate-950 rounded-2xl border border-gray-100 dark:border-slate-700 divide-y">
        <div className="p-4 text-sm font-bold text-[var(--primary-blue)]">รายการวิดีโอ</div>
        {loading && <p className="p-4 text-sm text-gray-500">กำลังโหลด...</p>}
        {!loading &&
          rows.map((v) => (
            <div key={v.id} className="p-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="font-bold text-[var(--primary-blue)]">
                  {v.title}{" "}
                  <span className="text-xs font-normal text-gray-500">
                    · {v.score_points} คะแนน · ลำดับ {v.sort_order}
                    {v.is_published ? " · เผยแพร่" : " · แบบร่าง"}
                  </span>
                </div>
                <a
                  href={v.video_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs underline break-all text-gray-500"
                >
                  {v.video_url}
                </a>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="text-xs font-bold underline"
                  onClick={() =>
                    setForm({
                      id: v.id,
                      title: v.title,
                      video_url: v.video_url,
                      score_points: v.score_points,
                      sort_order: v.sort_order,
                      is_published: Boolean(v.is_published),
                    })
                  }
                >
                  แก้ไข
                </button>
                <button
                  type="button"
                  className="text-xs font-bold text-[var(--accent-red)] underline"
                  onClick={() => void remove(v.id)}
                >
                  ลบ
                </button>
              </div>
            </div>
          ))}
        {!loading && !rows.length && (
          <p className="p-4 text-sm text-gray-500">ยังไม่มีวิดีโอ</p>
        )}
      </div>
    </div>
  );
}

export default function AdminELearningPage() {
  return (
    <AuthGuard requireAdmin>
      <ELearningAdminContent />
    </AuthGuard>
  );
}
