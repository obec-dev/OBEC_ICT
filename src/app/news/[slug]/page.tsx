"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ModalOverlay } from "@/app/components/ModalOverlay";
import { getPublishedNews } from "@/lib/supabase/news";
import { normalizeExternalUrl } from "@/lib/url";
import { formatDateTimeTh } from "@/lib/siteSettings";
import type { NewsArticle } from "@/types/ict";

type GalleryItem = { url: string; caption?: string | null };

function buildGallery(news: NewsArticle): GalleryItem[] {
  const out: GalleryItem[] = [];
  const hero = normalizeExternalUrl(news.hero_image_url);
  if (hero) out.push({ url: hero, caption: news.title });
  for (const img of news.images ?? []) {
    const src = normalizeExternalUrl(img.image_url);
    if (!src) continue;
    out.push({ url: src, caption: img.caption });
  }
  return out;
}

export default function NewsDetailPage() {
  const params = useParams();
  const slug = String(params?.slug ?? "");
  const [news, setNews] = useState<NewsArticle | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  useEffect(() => {
    if (!slug) return;
    setLoading(true);
    void getPublishedNews(slug)
      .then(setNews)
      .catch((err) => setError(err instanceof Error ? err.message : "ไม่พบข่าว"))
      .finally(() => setLoading(false));
  }, [slug]);

  const gallery = useMemo(() => (news ? buildGallery(news) : []), [news]);
  const lightbox = lightboxIndex != null ? gallery[lightboxIndex] ?? null : null;
  const hasMany = gallery.length > 1;

  const goPrev = () => {
    if (!hasMany || lightboxIndex == null) return;
    setLightboxIndex((lightboxIndex - 1 + gallery.length) % gallery.length);
  };

  const goNext = () => {
    if (!hasMany || lightboxIndex == null) return;
    setLightboxIndex((lightboxIndex + 1) % gallery.length);
  };

  useEffect(() => {
    if (lightboxIndex == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightboxIndex(null);
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setLightboxIndex((i) => {
          if (i == null || gallery.length <= 1) return i;
          return (i - 1 + gallery.length) % gallery.length;
        });
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        setLightboxIndex((i) => {
          if (i == null || gallery.length <= 1) return i;
          return (i + 1) % gallery.length;
        });
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [lightboxIndex, gallery.length]);

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
  const openAtUrl = (url: string) => {
    const idx = gallery.findIndex((g) => g.url === url);
    setLightboxIndex(idx >= 0 ? idx : 0);
  };

  return (
    <article className="pb-16">
      <div
        className={`relative min-h-[240px] md:min-h-[360px] flex items-end ${
          hero ? "cursor-zoom-in" : ""
        }`}
        role={hero ? "button" : undefined}
        tabIndex={hero ? 0 : undefined}
        aria-label={hero ? "ดูรูปปกขนาดเต็ม" : undefined}
        onClick={() => {
          if (hero) openAtUrl(hero);
        }}
        onKeyDown={(e) => {
          if (!hero) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openAtUrl(hero);
          }
        }}
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
        <div
          className="relative z-10 max-w-3xl mx-auto px-4 py-10 text-white w-full"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
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
          {hero && (
            <p className="text-xs text-white/60 mt-3"></p>
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
                    <button
                      type="button"
                      className="block w-full text-left cursor-zoom-in focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary-blue)]"
                      onClick={() => openAtUrl(src)}
                      aria-label={img.caption ? `ขยายรูป: ${img.caption}` : "ขยายรูป"}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={src} alt={img.caption ?? ""} className="w-full object-cover aspect-[4/3]" />
                    </button>
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

      {lightbox && lightboxIndex != null && (
        <ModalOverlay
          onBackdropClick={() => setLightboxIndex(null)}
          panelMaxWidthClass="max-w-5xl"
          zIndexClass="z-[120]"
        >
          <div className="relative bg-black/90 rounded-2xl overflow-hidden shadow-2xl">
            <button
              type="button"
              className="absolute top-3 right-3 z-20 rounded-full bg-black/60 text-white w-9 h-9 font-bold hover:bg-black/80"
              aria-label="ปิด"
              onClick={() => setLightboxIndex(null)}
            >
              ×
            </button>

            {hasMany && (
              <>
                <button
                  type="button"
                  className="absolute left-2 top-1/2 -translate-y-1/2 z-20 rounded-full bg-black/60 text-white w-10 h-10 text-xl font-bold hover:bg-black/80"
                  aria-label="รูปก่อนหน้า"
                  onClick={(e) => {
                    e.stopPropagation();
                    goPrev();
                  }}
                >
                  ‹
                </button>
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 z-20 rounded-full bg-black/60 text-white w-10 h-10 text-xl font-bold hover:bg-black/80"
                  aria-label="รูปถัดไป"
                  onClick={(e) => {
                    e.stopPropagation();
                    goNext();
                  }}
                >
                  ›
                </button>
              </>
            )}

            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={lightbox.url}
              alt={lightbox.caption ?? ""}
              className="w-full max-h-[85vh] object-contain bg-black"
            />
            <div className="px-4 py-3 text-center space-y-1">
              {lightbox.caption && (
                <p className="text-sm text-white/90">{lightbox.caption}</p>
              )}
              {hasMany && (
                <p className="text-xs text-white/60">
                  {lightboxIndex + 1} / {gallery.length}
                </p>
              )}
            </div>
          </div>
        </ModalOverlay>
      )}
    </article>
  );
}
