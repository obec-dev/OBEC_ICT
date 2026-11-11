"use client";

import { useCallback, useEffect, useState } from "react";
import { AuthGuard } from "@/app/components/AuthGuard";
import { AdminNav } from "@/app/components/AdminNav";
import { useIctStore } from "@/contexts/IctStore";
import {
  adminDeleteNews,
  adminGetNews,
  adminListNews,
  adminUpsertNews,
  slugifyTitle,
} from "@/lib/supabase/news";
import { inputClass } from "@/lib/styles";
import type { NewsListItem } from "@/types/ict";

type GalleryRow = { image_url: string; caption: string };

function emptyForm() {
  return {
    id: "",
    title: "",
    slug: "",
    summary: "",
    body: "",
    hero_image_url: "",
    hashtags: "",
    is_published: false,
    sort_order: 0,
    images: [] as GalleryRow[],
  };
}

function NewsAdminContent() {
  const { adminToken } = useIctStore();
  const [rows, setRows] = useState<NewsListItem[]>([]);
  const [form, setForm] = useState(emptyForm());
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    if (!adminToken) return;
    setLoading(true);
    try {
      setRows(await adminListNews(adminToken));
    } catch (err) {
      setError(err instanceof Error ? err.message : "โหลดข่าวไม่สำเร็จ — รัน supabase/news_v1.sql");
    } finally {
      setLoading(false);
    }
  }, [adminToken]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const edit = async (id: string) => {
    if (!adminToken) return;
    setError("");
    try {
      const n = await adminGetNews(adminToken, id);
      setForm({
        id: n.id,
        title: n.title,
        slug: n.slug,
        summary: n.summary ?? "",
        body: n.body ?? "",
        hero_image_url: n.hero_image_url ?? "",
        hashtags: (n.hashtags ?? []).join(", "),
        is_published: Boolean(n.is_published),
        sort_order: n.sort_order ?? 0,
        images: (n.images ?? []).map((i) => ({
          image_url: i.image_url,
          caption: i.caption ?? "",
        })),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "โหลดรายละเอียดไม่สำเร็จ");
    }
  };

  const save = async () => {
    if (!adminToken) return;
    setBusy(true);
    setError("");
    setMessage("");
    const tags = form.hashtags
      .split(",")
      .map((t) => t.trim().replace(/^#/, ""))
      .filter(Boolean);
    const result = await adminUpsertNews(adminToken, {
      id: form.id || undefined,
      title: form.title,
      slug: form.slug || slugifyTitle(form.title),
      summary: form.summary,
      body: form.body,
      hero_image_url: form.hero_image_url,
      hashtags: tags,
      is_published: form.is_published,
      sort_order: form.sort_order,
      images: form.images.filter((i) => i.image_url.trim()),
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (form.is_published) {
      setMessage("บันทึกและเผยแพร่แล้ว — แสดงที่หน้าแรกและ /news");
    } else {
      setMessage("บันทึกแบบร่างแล้ว — ติ๊ก “เผยแพร่” หรือกดเผยแพร่ในรายการด้านล่างจึงจะโชว์บนเว็บ");
    }
    setForm(emptyForm());
    await reload();
  };

  const setPublished = async (id: string, publish: boolean) => {
    if (!adminToken) return;
    setError("");
    try {
      const n = await adminGetNews(adminToken, id);
      const result = await adminUpsertNews(adminToken, {
        id: n.id,
        title: n.title,
        slug: n.slug,
        summary: n.summary ?? "",
        body: n.body ?? "",
        hero_image_url: n.hero_image_url ?? "",
        hashtags: n.hashtags ?? [],
        is_published: publish,
        sort_order: n.sort_order ?? 0,
        images: (n.images ?? []).map((i, idx) => ({
          image_url: i.image_url,
          caption: i.caption ?? "",
          sort_order: i.sort_order ?? idx,
        })),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setMessage(publish ? "เผยแพร่แล้ว — รีเฟรชหน้า /news เพื่อดู" : "ยกเลิกการเผยแพร่แล้ว");
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "อัปเดตสถานะไม่สำเร็จ");
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-12 animate-fade-in-up space-y-6">
      <AdminNav />
      <div>
        <h1 className="text-3xl font-extrabold text-[var(--primary-blue)]">ข่าว</h1>
        <p className="text-gray-500 mt-1">จัดการข่าวสำหรับหน้าแรกและหน้า /news</p>
      </div>

      {error && <p className="text-sm text-[var(--accent-red)]">{error}</p>}
      {message && <p className="text-sm text-emerald-700">{message}</p>}

      <div className="bg-white rounded-2xl border p-6 space-y-3">
        <h2 className="font-bold text-[var(--primary-blue)]">{form.id ? "แก้ไขข่าว" : "สร้างข่าวใหม่"}</h2>
        <input
          className={inputClass}
          placeholder="หัวข้อข่าว"
          value={form.title}
          onChange={(e) => {
            const title = e.target.value;
            setForm((f) => ({
              ...f,
              title,
              slug: f.id ? f.slug : slugifyTitle(title),
            }));
          }}
        />
        <input
          className={inputClass}
          placeholder="slug (URL)"
          value={form.slug}
          onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
        />
        <textarea
          className={`${inputClass} min-h-[70px]`}
          placeholder="สรุปสั้น (carousel)"
          value={form.summary}
          onChange={(e) => setForm((f) => ({ ...f, summary: e.target.value }))}
        />
        <textarea
          className={`${inputClass} min-h-[140px]`}
          placeholder="รายละเอียดข่าว"
          value={form.body}
          onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
        />
        <input
          className={inputClass}
          placeholder="URL รูปหลัก / พื้นหลัง (www… หรือ https://…)"
          value={form.hero_image_url}
          onChange={(e) => setForm((f) => ({ ...f, hero_image_url: e.target.value }))}
        />
        <input
          className={inputClass}
          placeholder="แฮชแท็ก คั่นด้วยจุลภาค เช่น ICT, อบจ"
          value={form.hashtags}
          onChange={(e) => setForm((f) => ({ ...f, hashtags: e.target.value }))}
        />
        <div className="flex flex-wrap gap-4 items-center">
          <label className="flex items-start gap-3 cursor-pointer rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
            <input
              type="checkbox"
              className="mt-1 accent-[var(--primary-blue)]"
              checked={form.is_published}
              onChange={(e) => setForm((f) => ({ ...f, is_published: e.target.checked }))}
            />
            <span>
              <span className="block text-sm font-bold text-[var(--primary-blue)]">เผยแพร่บนเว็บไซต์</span>
              <span className="block text-xs text-gray-600 mt-0.5">
                ต้องเปิดช่องนี้ ข่าวถึงจะขึ้นที่หน้าแรกและเมนูข่าว
              </span>
            </span>
          </label>
          <label className="text-sm font-semibold flex items-center gap-2">
            ลำดับ
            <input
              type="number"
              className={`${inputClass} w-24`}
              value={form.sort_order}
              onChange={(e) => setForm((f) => ({ ...f, sort_order: Number(e.target.value) || 0 }))}
            />
          </label>
        </div>

        <div className="space-y-2 border-t pt-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold">รูปประกอบ (gallery)</h3>
            <button
              type="button"
              className="text-xs font-bold underline text-[var(--primary-blue)]"
              onClick={() => setForm((f) => ({ ...f, images: [...f.images, { image_url: "", caption: "" }] }))}
            >
              + เพิ่มรูป
            </button>
          </div>
          {form.images.map((img, idx) => (
            <div key={idx} className="flex flex-wrap gap-2">
              <input
                className={`${inputClass} flex-1 min-w-[200px]`}
                placeholder="URL รูป"
                value={img.image_url}
                onChange={(e) =>
                  setForm((f) => {
                    const images = [...f.images];
                    images[idx] = { ...images[idx], image_url: e.target.value };
                    return { ...f, images };
                  })
                }
              />
              <input
                className={`${inputClass} flex-1 min-w-[140px]`}
                placeholder="คำอธิบาย"
                value={img.caption}
                onChange={(e) =>
                  setForm((f) => {
                    const images = [...f.images];
                    images[idx] = { ...images[idx], caption: e.target.value };
                    return { ...f, images };
                  })
                }
              />
              <button
                type="button"
                className="text-xs font-bold text-[var(--accent-red)]"
                onClick={() =>
                  setForm((f) => ({ ...f, images: f.images.filter((_, i) => i !== idx) }))
                }
              >
                ลบ
              </button>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy || !form.title.trim()}
            onClick={() => void save()}
            className="rounded-full bg-[var(--primary-blue)] text-white px-5 py-2.5 font-bold disabled:opacity-50"
          >
            {busy ? "กำลังบันทึก..." : "บันทึก"}
          </button>
          {form.id && (
            <button
              type="button"
              className="rounded-full border px-5 py-2.5 font-bold"
              onClick={() => setForm(emptyForm())}
            >
              ยกเลิก
            </button>
          )}
        </div>
      </div>

      <div className="bg-white rounded-2xl border divide-y">
        {loading && <p className="p-4 text-sm text-gray-500">กำลังโหลด...</p>}
        {!loading &&
          rows.map((n) => (
            <div key={n.id} className="p-4 flex flex-wrap justify-between gap-3">
              <div>
                <div className="font-bold">{n.title}</div>
                <div className="text-xs text-gray-500 mt-0.5">
                  /{n.slug}
                  {n.is_published ? " · เผยแพร่แล้ว" : " · แบบร่าง"}
                  {n.hashtags?.length ? ` · #${n.hashtags.join(" #")}` : ""}
                </div>
              </div>
              <div className="flex flex-wrap gap-3 items-center">
                {!n.is_published ? (
                  <button
                    type="button"
                    className="text-sm font-bold text-emerald-700"
                    onClick={() => void setPublished(n.id, true)}
                  >
                    เผยแพร่
                  </button>
                ) : (
                  <button
                    type="button"
                    className="text-sm font-bold text-amber-700"
                    onClick={() => void setPublished(n.id, false)}
                  >
                    ยกเลิกเผยแพร่
                  </button>
                )}
                <button
                  type="button"
                  className="text-sm font-bold text-[var(--primary-blue)]"
                  onClick={() => void edit(n.id)}
                >
                  แก้ไข
                </button>
                <button
                  type="button"
                  className="text-sm font-bold text-[var(--accent-red)]"
                  onClick={() => {
                    if (!adminToken || !confirm("ลบข่าวนี้?")) return;
                    void adminDeleteNews(adminToken, n.id).then((r) => {
                      if (!r.ok) setError(r.error);
                      else void reload();
                    });
                  }}
                >
                  ลบ
                </button>
              </div>
            </div>
          ))}
        {!loading && !rows.length && <p className="p-4 text-sm text-gray-500">ยังไม่มีข่าว</p>}
      </div>
    </div>
  );
}

export default function AdminNewsPage() {
  return (
    <AuthGuard requireAdmin>
      <NewsAdminContent />
    </AuthGuard>
  );
}
