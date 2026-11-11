import { createClient } from "@/lib/supabase/client";
import { normalizeExternalUrl } from "@/lib/url";
import type { NewsArticle, NewsListItem } from "@/types/ict";

function asObj(data: unknown): Record<string, unknown> {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    return data as Record<string, unknown>;
  }
  return {};
}

function asArr(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (typeof data === "string") {
    try {
      const parsed = JSON.parse(data) as unknown;
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function asBool(v: unknown, fallback = false): boolean {
  if (typeof v === "boolean") return v;
  if (v === "true" || v === 1 || v === "1") return true;
  if (v === "false" || v === 0 || v === "0") return false;
  return fallback;
}

function mapListItem(raw: unknown): NewsListItem {
  const m = asObj(raw);
  return {
    id: String(m.id),
    slug: String(m.slug ?? ""),
    title: String(m.title ?? ""),
    summary: m.summary ? String(m.summary) : null,
    hero_image_url: m.hero_image_url ? String(m.hero_image_url) : null,
    hashtags: Array.isArray(m.hashtags) ? m.hashtags.map(String) : [],
    published_at: m.published_at ? String(m.published_at) : null,
    sort_order: Number(m.sort_order) || 0,
    is_published: m.is_published != null ? asBool(m.is_published) : undefined,
    image_count: m.image_count != null ? Number(m.image_count) : undefined,
    updated_at: m.updated_at ? String(m.updated_at) : undefined,
  };
}

function mapArticle(raw: unknown): NewsArticle {
  const m = asObj(raw);
  return {
    ...mapListItem(m),
    body: String(m.body ?? ""),
    images: asArr(m.images).map((item) => {
      const i = asObj(item);
      return {
        id: i.id ? String(i.id) : undefined,
        image_url: String(i.image_url ?? ""),
        caption: i.caption ? String(i.caption) : null,
        sort_order: Number(i.sort_order) || 0,
      };
    }),
  };
}

export async function listPublishedNews(limit = 20): Promise<NewsListItem[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("list_published_news", { p_limit: limit });
  if (error) throw new Error(error.message);
  return asArr(data).map(mapListItem);
}

export async function getPublishedNews(slug: string): Promise<NewsArticle> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("get_published_news", { p_slug: slug });
  if (error) throw new Error(error.message);
  const row = asObj(data);
  if (!row.ok) throw new Error(String(row.error ?? "ไม่พบข่าว"));
  return mapArticle(row.news);
}

export async function adminListNews(token: string): Promise<NewsListItem[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_list_news", { p_token: token });
  if (error) throw new Error(error.message);
  return asArr(data).map(mapListItem);
}

export async function adminGetNews(token: string, id: string): Promise<NewsArticle> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_get_news", { p_token: token, p_id: id });
  if (error) throw new Error(error.message);
  const row = asObj(data);
  if (!row.ok) throw new Error(String(row.error ?? "ไม่พบข่าว"));
  return mapArticle(row.news);
}

export type NewsUpsertInput = {
  id?: string;
  title: string;
  slug?: string;
  summary?: string;
  body?: string;
  hero_image_url?: string;
  hashtags?: string[];
  is_published?: boolean;
  sort_order?: number;
  images?: { image_url: string; caption?: string; sort_order?: number }[];
};

export async function adminUpsertNews(token: string, news: NewsUpsertInput) {
  const supabase = createClient();
  const payload = {
    ...news,
    hero_image_url: news.hero_image_url
      ? normalizeExternalUrl(news.hero_image_url)
      : news.hero_image_url,
    images: news.images?.map((img, idx) => ({
      image_url: normalizeExternalUrl(img.image_url),
      caption: img.caption ?? null,
      sort_order: img.sort_order ?? idx,
    })),
  };
  const { data, error } = await supabase.rpc("admin_upsert_news", {
    p_token: token,
    p_news: payload,
  });
  if (error) return { ok: false as const, error: error.message };
  const row = asObj(data);
  if (!row.ok) return { ok: false as const, error: String(row.error ?? "บันทึกข่าวไม่สำเร็จ") };
  return { ok: true as const, id: String(row.id ?? ""), slug: String(row.slug ?? "") };
}

export async function adminDeleteNews(token: string, id: string) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_delete_news", {
    p_token: token,
    p_id: id,
  });
  if (error) return { ok: false as const, error: error.message };
  const row = asObj(data);
  if (!row.ok) return { ok: false as const, error: String(row.error ?? "ลบไม่สำเร็จ") };
  return { ok: true as const };
}

export function slugifyTitle(title: string): string {
  const v = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9ก-๙\-]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return (v || "news").slice(0, 80);
}
