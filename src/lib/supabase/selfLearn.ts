import { createClient } from "@/lib/supabase/client";
import { normalizeExternalUrl } from "@/lib/url";

function asObj(data: unknown): Record<string, unknown> {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    return data as Record<string, unknown>;
  }
  return {};
}

function asArr(data: unknown): unknown[] {
  return Array.isArray(data) ? data : [];
}

export type SelfLearnVideo = {
  id: string;
  title: string;
  video_url: string;
  score_points: number;
  sort_order: number;
  is_published?: boolean;
  credited?: boolean;
  updated_at?: string;
};

function mapVideo(raw: unknown): SelfLearnVideo {
  const m = asObj(raw);
  return {
    id: String(m.id),
    title: String(m.title ?? ""),
    video_url: String(m.video_url ?? ""),
    score_points: Number(m.score_points) || 0,
    sort_order: Number(m.sort_order) || 0,
    is_published: m.is_published != null ? Boolean(m.is_published) : undefined,
    credited: m.credited === true,
    updated_at: m.updated_at ? String(m.updated_at) : undefined,
  };
}

export async function adminListSelfLearnVideos(token: string): Promise<SelfLearnVideo[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_list_self_learn_videos", { p_token: token });
  if (error) throw new Error(error.message);
  return asArr(data).map(mapVideo);
}

export async function adminUpsertSelfLearnVideo(
  token: string,
  video: {
    id?: string;
    title: string;
    video_url: string;
    score_points: number;
    sort_order: number;
    is_published: boolean;
  }
) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_upsert_self_learn_video", {
    p_token: token,
    p_video: {
      ...video,
      video_url: normalizeExternalUrl(video.video_url) || video.video_url,
    },
  });
  if (error) return { ok: false as const, error: error.message };
  const row = asObj(data);
  if (!row.ok) return { ok: false as const, error: String(row.error ?? "บันทึกไม่สำเร็จ") };
  return { ok: true as const, id: String(row.id ?? "") };
}

export async function adminDeleteSelfLearnVideo(token: string, id: string) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_delete_self_learn_video", {
    p_token: token,
    p_id: id,
  });
  if (error) return { ok: false as const, error: error.message };
  const row = asObj(data);
  if (!row.ok) return { ok: false as const, error: String(row.error ?? "ลบไม่สำเร็จ") };
  return { ok: true as const };
}

export async function listSelfLearnVideos(profileId?: string, phone?: string): Promise<SelfLearnVideo[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("list_self_learn_videos", {
    p_profile_id: profileId ?? null,
    p_phone: phone ?? null,
  });
  if (error) throw new Error(error.message);
  return asArr(data).map(mapVideo);
}

export async function creditSelfLearnVideo(profileId: string, phone: string, videoId: string) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("credit_self_learn_video", {
    p_profile_id: profileId,
    p_phone: phone,
    p_video_id: videoId,
  });
  if (error) return { ok: false as const, error: error.message };
  const row = asObj(data);
  if (!row.ok) return { ok: false as const, error: String(row.error ?? "รับคะแนนไม่สำเร็จ") };
  return {
    ok: true as const,
    credited: row.credited === true,
    points: Number(row.points) || 0,
  };
}
