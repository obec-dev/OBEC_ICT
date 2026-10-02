import { createClient } from "@supabase/supabase-js";
import { unstable_cache } from "next/cache";
import { NextResponse } from "next/server";

export const revalidate = 300;

const CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60",
};

function createAnonClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("missing_supabase_env");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const getCachedSchoolTotals = unstable_cache(
  async () => {
    const supabase = createAnonClient();
    const { data, error } = await supabase.rpc("get_school_totals");
    if (error) throw new Error(error.message);
    return data ?? null;
  },
  ["public-school-totals-v1"],
  { revalidate: 300, tags: ["school-totals"] }
);

export async function GET() {
  try {
    const data = await getCachedSchoolTotals();
    return NextResponse.json(data, { headers: CACHE_HEADERS });
  } catch (err) {
    const message = err instanceof Error ? err.message : "failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
