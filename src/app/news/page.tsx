"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { listPublishedNews } from "@/lib/supabase/news";
import { normalizeExternalUrl } from "@/lib/url";
import { formatDateTimeTh } from "@/lib/siteSettings";
import { inputClass } from "@/lib/styles";
import type { NewsListItem } from "@/types/ict";

const PAGE_SIZE = 10;

function dayStartIso(dateStr: string): string | null {
  if (!dateStr) return null;
  const d = new Date(`${dateStr}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function dayEndIso(dateStr: string): string | null {
  if (!dateStr) return null;
  const d = new Date(`${dateStr}T23:59:59.999`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function parseTags(raw: string): string[] {
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

function NewsIndexContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const qParam = searchParams.get("q") ?? "";
  const tagParam = searchParams.get("tag") ?? "";
  const fromParam = searchParams.get("from") ?? "";
  const toParam = searchParams.get("to") ?? "";
  const pageParam = Math.max(1, Number(searchParams.get("page") || "1") || 1);

  const [items, setItems] = useState<NewsListItem[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState(qParam);
  const [tags, setTags] = useState<string[]>(() => parseTags(tagParam));
  const [from, setFrom] = useState(fromParam);
  const [to, setTo] = useState(toParam);
  const [page, setPage] = useState(pageParam);

  useEffect(() => {
    setQ(qParam);
    setTags(parseTags(tagParam));
    setFrom(fromParam);
    setTo(toParam);
    setPage(pageParam);
  }, [qParam, tagParam, fromParam, toParam, pageParam]);

  useEffect(() => {
    void listPublishedNews(100)
      .then(setItems)
      .catch((err) => setError(err instanceof Error ? err.message : "โหลดข่าวไม่สำเร็จ"))
      .finally(() => setLoading(false));
  }, []);

  const syncUrl = (next: {
    q?: string;
    tags?: string[];
    from?: string;
    to?: string;
    page?: number;
  }) => {
    const params = new URLSearchParams();
    const nextQ = (next.q ?? q).trim();
    const nextTags = next.tags ?? tags;
    const nextFrom = next.from ?? from;
    const nextTo = next.to ?? to;
    const nextPage = next.page ?? page;
    if (nextQ) params.set("q", nextQ);
    if (nextTags.length) params.set("tag", nextTags.join(","));
    if (nextFrom) params.set("from", nextFrom);
    if (nextTo) params.set("to", nextTo);
    if (nextPage > 1) params.set("page", String(nextPage));
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const tagOptions = useMemo(() => {
    const set = new Set<string>();
    for (const n of items) {
      for (const t of n.hashtags ?? []) {
        const trimmed = t.trim();
        if (trimmed) set.add(trimmed);
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "th"));
  }, [items]);

  const filtered = useMemo(() => {
    const qLower = q.trim().toLowerCase();
    const selected = tags.map((t) => t.trim().toLowerCase()).filter(Boolean);
    const fromIso = dayStartIso(from);
    const toIso = dayEndIso(to);

    const list = items.filter((n) => {
      if (qLower) {
        const title = (n.title ?? "").toLowerCase();
        const summary = (n.summary ?? "").toLowerCase();
        if (!title.includes(qLower) && !summary.includes(qLower)) return false;
      }
      if (selected.length) {
        const newsTags = (n.hashtags ?? []).map((t) => t.trim().toLowerCase());
        if (!selected.every((t) => newsTags.includes(t))) return false;
      }
      if (fromIso || toIso) {
        if (!n.published_at) return false;
        const pub = new Date(n.published_at).getTime();
        if (Number.isNaN(pub)) return false;
        if (fromIso && pub < new Date(fromIso).getTime()) return false;
        if (toIso && pub > new Date(toIso).getTime()) return false;
      }
      return true;
    });

    return list.sort((a, b) => {
      const so = (a.sort_order || 0) - (b.sort_order || 0);
      if (so !== 0) return so;
      const pa = a.published_at ? new Date(a.published_at).getTime() : 0;
      const pb = b.published_at ? new Date(b.published_at).getTime() : 0;
      return pb - pa;
    });
  }, [items, q, tags, from, to]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  useEffect(() => {
    if (page !== safePage) {
      setPage(safePage);
      syncUrl({ page: safePage });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safePage]);

  const clearFilters = () => {
    setQ("");
    setTags([]);
    setFrom("");
    setTo("");
    setPage(1);
    router.replace(pathname, { scroll: false });
  };

  const toggleTag = (t: string) => {
    const next = tags.includes(t) ? tags.filter((x) => x !== t) : [...tags, t];
    setTags(next);
    setPage(1);
    syncUrl({ tags: next, page: 1 });
  };

  const hasFilters = Boolean(q.trim() || tags.length || from || to);

  return (
    <div className="max-w-5xl mx-auto px-4 py-12 animate-fade-in-up">
      <h1 className="text-3xl font-extrabold text-[var(--primary-blue)] dark:text-white mb-2">ข่าวสาร</h1>
      <p className="text-gray-500 mb-8">อัปเดตจากโครงการ ICT Talent</p>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <div className="sm:col-span-2 lg:col-span-1">
          <label className="block text-sm font-semibold text-[var(--primary-blue)] mb-2">ค้นหา</label>
          <input
            className={inputClass}
            value={q}
            placeholder="ชื่อข่าว / สรุป"
            onChange={(e) => {
              const value = e.target.value;
              setQ(value);
              setPage(1);
              syncUrl({ q: value, page: 1 });
            }}
          />
        </div>
        <div>
          <label className="block text-sm font-semibold text-[var(--primary-blue)] mb-2">ตั้งแต่</label>
          <input
            type="date"
            className={inputClass}
            value={from}
            onChange={(e) => {
              const value = e.target.value;
              setFrom(value);
              setPage(1);
              syncUrl({ from: value, page: 1 });
            }}
          />
        </div>
        <div>
          <label className="block text-sm font-semibold text-[var(--primary-blue)] mb-2">ถึง</label>
          <input
            type="date"
            className={inputClass}
            value={to}
            onChange={(e) => {
              const value = e.target.value;
              setTo(value);
              setPage(1);
              syncUrl({ to: value, page: 1 });
            }}
          />
        </div>
        <div className="flex items-end">
          {hasFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="w-full rounded-xl border border-gray-300 px-4 py-3 text-sm font-bold text-gray-700 hover:bg-gray-50"
            >
              ล้างตัวกรอง
            </button>
          )}
        </div>
      </div>

      {tagOptions.length > 0 && (
        <div className="mb-8">
          <label className="block text-sm font-semibold text-[var(--primary-blue)] mb-2">แฮชแท็ก</label>
          <div className="flex flex-wrap gap-2">
            {tagOptions.map((t) => {
              const selected = tags.includes(t);
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => toggleTag(t)}
                  className={`text-xs font-bold px-3 py-1.5 rounded-full border transition-colors ${
                    selected
                      ? "bg-[var(--primary-blue)] text-white border-[var(--primary-blue)]"
                      : "bg-white text-[var(--primary-blue)] border-gray-200 hover:border-[var(--primary-blue)]"
                  }`}
                >
                  #{t}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {loading && <p className="text-sm text-gray-500">กำลังโหลด...</p>}
      {error && <p className="text-sm text-[var(--accent-red)]">{error}</p>}
      <div className="grid sm:grid-cols-2 gap-5">
        {pageItems.map((n) => {
          const hero = normalizeExternalUrl(n.hero_image_url);
          return (
            <Link
              key={n.id}
              href={`/news/${n.slug}`}
              className="rounded-2xl border border-gray-100 dark:border-slate-700 overflow-hidden bg-white dark:bg-slate-950 hover:border-[var(--primary-blue)] transition-colors"
            >
              <div className="aspect-[16/9] bg-slate-100 dark:bg-slate-800 relative">
                {hero ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={hero} alt="" className="absolute inset-0 w-full h-full object-cover" />
                ) : null}
              </div>
              <div className="p-4 space-y-2">
                {n.hashtags?.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {n.hashtags.slice(0, 6).map((t) => (
                      <button
                        key={t}
                        type="button"
                        className="text-[10px] font-bold uppercase tracking-wide bg-blue-50 text-[var(--primary-blue)] px-2 py-0.5 rounded-full hover:bg-blue-100"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          const next = tags.includes(t) ? tags : [...tags, t];
                          setTags(next);
                          setPage(1);
                          syncUrl({ tags: next, page: 1 });
                        }}
                      >
                        #{t}
                      </button>
                    ))}
                  </div>
                )}
                <h2 className="font-extrabold text-[var(--primary-blue)] dark:text-white line-clamp-2">
                  {n.title}
                </h2>
                {n.summary && <p className="text-sm text-gray-600 line-clamp-2">{n.summary}</p>}
                <div className="text-xs text-gray-400">
                  {n.published_at ? formatDateTimeTh(n.published_at) : ""}
                </div>
              </div>
            </Link>
          );
        })}
      </div>

      {!loading && filtered.length > 0 && (
        <div className="flex items-center justify-center gap-3 mt-8">
          <button
            type="button"
            disabled={safePage <= 1}
            className="rounded-full border px-4 py-2 text-sm font-bold disabled:opacity-40"
            onClick={() => {
              const next = safePage - 1;
              setPage(next);
              syncUrl({ page: next });
            }}
          >
            ← ก่อนหน้า
          </button>
          <span className="text-sm text-gray-600">
            หน้า {safePage} / {totalPages}
          </span>
          <button
            type="button"
            disabled={safePage >= totalPages}
            className="rounded-full border px-4 py-2 text-sm font-bold disabled:opacity-40"
            onClick={() => {
              const next = safePage + 1;
              setPage(next);
              syncUrl({ page: next });
            }}
          >
            ถัดไป →
          </button>
        </div>
      )}

      {!loading && !filtered.length && !error && (
        <p className="text-sm text-gray-500">
          {items.length
            ? "ไม่พบข่าวตามเงื่อนไขที่เลือก"
            : "ยังไม่มีข่าวที่เผยแพร่ — ในแอดมินต้องเปิดสถานะ “เผยแพร่บนเว็บไซต์” (แบบร่างจะไม่โชว์ที่นี่)"}
        </p>
      )}
    </div>
  );
}

export default function NewsIndexPage() {
  return (
    <Suspense
      fallback={
        <div className="max-w-5xl mx-auto px-4 py-12 text-sm text-gray-500">กำลังโหลด...</div>
      }
    >
      <NewsIndexContent />
    </Suspense>
  );
}
