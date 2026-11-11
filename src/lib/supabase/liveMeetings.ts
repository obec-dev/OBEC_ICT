import { createClient } from "@/lib/supabase/client";
import type { LiveMeeting } from "@/types/ict";

function asArr(data: unknown): unknown[] {
  return Array.isArray(data) ? data : [];
}

function asObj(data: unknown): Record<string, unknown> {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    return data as Record<string, unknown>;
  }
  return {};
}

/** Active live meetings that have not expired (for landing page). */
export async function listPublicLiveMeetings(): Promise<LiveMeeting[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("list_public_live_meetings");
  if (error) throw new Error(error.message);
  return asArr(data).map((raw) => {
    const m = asObj(raw);
    return {
      id: String(m.id),
      title: String(m.title ?? "Live meeting"),
      youtube_url: String(m.youtube_url ?? ""),
      window_start: m.window_start ? String(m.window_start) : "",
      window_end: m.window_end ? String(m.window_end) : "",
      score_points: Number(m.score_points) || 0,
      is_active: m.is_active !== false,
      in_window: Boolean(m.in_window),
    };
  });
}
