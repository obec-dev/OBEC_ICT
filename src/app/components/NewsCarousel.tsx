"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { listPublishedNews } from "@/lib/supabase/news";
import { normalizeExternalUrl } from "@/lib/url";
import type { NewsListItem } from "@/types/ict";

export function NewsCarousel() {
  const [items, setItems] = useState<NewsListItem[]>([]);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    void listPublishedNews(12)
      .then(setItems)
      .catch(() => setItems([]));
  }, []);

  useEffect(() => {
    if (paused || items.length <= 1) return;
    const t = window.setInterval(() => {
      setIndex((i) => (i + 1) % items.length);
    }, 6000);
    return () => window.clearInterval(t);
  }, [items.length, paused]);

  if (!items.length) return null;

  const current = items[index] ?? items[0];
  const hero = normalizeExternalUrl(current.hero_image_url);

  return (
    <section className="max-w-7xl mx-auto px-4 relative z-20 mb-16">
      <div className="flex items-end justify-between gap-3 mb-4">
        <h2 className="text-2xl md:text-3xl font-extrabold text-[var(--primary-blue)] dark:text-white">
          ข่าวสาร
        </h2>
        <Link href="/news" className="text-sm font-bold underline text-[var(--primary-blue)]">
          ดูทั้งหมด →
        </Link>
      </div>
      <div
        className="relative overflow-hidden rounded-3xl border border-gray-100 dark:border-slate-700 shadow-lg min-h-[220px] md:min-h-[280px] group"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocusCapture={() => setPaused(true)}
        onBlurCapture={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
            setPaused(false);
          }
        }}
      >
        {hero ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={hero}
            alt=""
            className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-[#0b3d6e] to-[#1d7ac4]" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/35 to-transparent" />
        <Link
          href={`/news/${current.slug}`}
          className="absolute inset-0 z-0"
          aria-label={current.title}
        />
        <div className="relative z-10 p-6 md:p-10 text-white max-w-2xl mt-auto h-full flex flex-col justify-end min-h-[220px] md:min-h-[280px] pointer-events-none">
          {current.hashtags?.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3 pointer-events-auto">
              {current.hashtags.slice(0, 4).map((t) => (
                <Link
                  key={t}
                  href={`/news?tag=${encodeURIComponent(t)}`}
                  className="text-[10px] font-bold uppercase tracking-wide bg-white/20 px-2 py-0.5 rounded-full hover:bg-white/35"
                >
                  #{t}
                </Link>
              ))}
            </div>
          )}
          <Link href={`/news/${current.slug}`} className="pointer-events-auto">
            <h3 className="text-xl md:text-3xl font-extrabold leading-snug">{current.title}</h3>
            {current.summary && (
              <p className="mt-2 text-sm md:text-base text-white/85 line-clamp-2">{current.summary}</p>
            )}
          </Link>
        </div>
      </div>
      {items.length > 1 && (
        <div className="flex justify-center gap-2 mt-4">
          {items.map((item, i) => (
            <button
              key={item.id}
              type="button"
              aria-label={`ข่าว ${i + 1}`}
              className={`h-2.5 rounded-full transition-all ${
                i === index ? "w-8 bg-[var(--primary-blue)]" : "w-2.5 bg-gray-300"
              }`}
              onClick={() => setIndex(i)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
