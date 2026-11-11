"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { getPublishedNews } from "@/lib/supabase/news";
import { normalizeExternalUrl } from "@/lib/url";
import { formatDateTimeTh } from "@/lib/siteSettings";
import type { NewsArticle } from "@/types/ict";

export default function NewsDetailPage() {
  const params = useParams();
  const slug = String(params?.slug ?? "");
  const [news, setNews] = useState<NewsArticle | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!slug) return;
    setLoading(true);
    void getPublishedNews(slug)
      .then(setNews)
      .catch((err) => setError(err instanceof Error ? err.message : "ไม่พบข่าว"))
      .finally(() => setLoading(false));
  }, [slug]);

  if (loading) {
    return <p className="text-sm text-gray-500 px-4 py-16 text-center">กำลังโหลด...</p>;
  }

  if (error || !news) {
    return (
      <div className="max-w-xl mx-auto px-4 py-16 text-center space-y-4">
        <p className="text-[var(--accent-red)]">{error || "ไม่พบข่าว"}</p>
        <Link href="/news" className="text-sm font-bold underline text-[var(--primary-blue)]">
          ← กลับรายการข่าว
        </Link>
      </div>
    );
  }

  const hero = normalizeExternalUrl(news.hero_image_url);

  return (
    <article className="pb-16">
      <div
        className="relative min-h-[240px] md:min-h-[360px] flex items-end"
        style={
          hero
            ? {
                backgroundImage: `linear-gradient(to top, rgba(0,0,0,.75), rgba(0,0,0,.25)), url(${hero})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
              }
            : undefined
        }
      >
        {!hero && <div className="absolute inset-0 bg-gradient-to-br from-[#0b3d6e] to-[#1d7ac4]" />}
        <div className="relative z-10 max-w-3xl mx-auto px-4 py-10 text-white w-full">
          <Link href="/news" className="text-sm font-semibold text-white/80 hover:text-white">
            ← ข่าวสาร
          </Link>
          {news.hashtags?.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-4">
              {news.hashtags.map((t) => (
                <Link
                  key={t}
                  href={`/news?tag=${encodeURIComponent(t)}`}
                  className="text-xs font-bold bg-white/20 px-2.5 py-1 rounded-full hover:bg-white/35"
                >
                  #{t}
                </Link>
              ))}
            </div>
          )}
          <h1 className="text-3xl md:text-5xl font-extrabold mt-3 leading-tight">{news.title}</h1>
          {news.published_at && (
            <p className="text-sm text-white/70 mt-3">{formatDateTimeTh(news.published_at)}</p>
          )}
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-10 space-y-8">
        {news.summary && (
          <p className="text-lg text-gray-700 dark:text-gray-200 font-medium">{news.summary}</p>
        )}
        <div className="prose prose-slate dark:prose-invert max-w-none whitespace-pre-wrap text-base leading-relaxed">
          {news.body}
        </div>
        {news.images?.length > 0 && (
          <div className="space-y-4">
            <h2 className="text-xl font-extrabold text-[var(--primary-blue)]">รูปประกอบ</h2>
            <div className="grid sm:grid-cols-2 gap-4">
              {news.images.map((img, i) => {
                const src = normalizeExternalUrl(img.image_url);
                if (!src) return null;
                return (
                  <figure key={img.id ?? i} className="rounded-2xl overflow-hidden border border-gray-100">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src} alt={img.caption ?? ""} className="w-full object-cover aspect-[4/3]" />
                    {img.caption && (
                      <figcaption className="px-3 py-2 text-xs text-gray-500">{img.caption}</figcaption>
                    )}
                  </figure>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </article>
  );
}
