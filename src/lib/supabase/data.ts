import { createClient } from "@/lib/supabase/client";
import type { Candidate, DistrictStat, School, SchoolTotals } from "@/types/ict";

type SchoolRow = {
  school_id: string;
  school_name: string;
  province: string;
  is_registered: boolean | null;
  district_id: string;
  districts: { district_name: string } | { district_name: string }[] | null;
  profiles?: { profile_id: string }[] | { profile_id: string } | null;
};

type ProfileRow = {
  profile_id: string;
  school_id: string;
  first_name: string;
  last_name: string;
  phone: string;
  remark: string | null;
  created_at: string | null;
  schools?: { school_name: string } | { school_name: string }[] | null;
};

function districtName(row: SchoolRow): string {
  const d = row.districts;
  if (!d) return row.district_id;
  if (Array.isArray(d)) return d[0]?.district_name ?? row.district_id;
  return d.district_name ?? row.district_id;
}

export function mapSchoolRow(row: SchoolRow): School {
  const hasProfile = Array.isArray(row.profiles)
    ? row.profiles.length > 0
    : Boolean(row.profiles);

  return {
    school_id: row.school_id,
    school_name: row.school_name,
    area_zone: districtName(row),
    province: row.province,
    is_registered: Boolean(row.is_registered) || hasProfile,
    district_id: row.district_id,
  };
}

export function mapProfileRow(row: ProfileRow): Candidate {
  const school = row.schools;
  const school_name = Array.isArray(school)
    ? school[0]?.school_name
    : school?.school_name;

  return {
    id: row.profile_id,
    school_id: row.school_id,
    school_name,
    first_name: row.first_name,
    last_name: row.last_name,
    full_name: `${row.first_name} ${row.last_name}`.trim(),
    phone: row.phone,
    remark: row.remark ?? undefined,
    created_at: row.created_at ?? new Date().toISOString(),
  };
}

/** ~245 rows — dashboard heat cards */
export async function fetchDistrictStats(): Promise<DistrictStat[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("get_district_stats");
  if (error) throw new Error(error.message);

  const stats: DistrictStat[] = (data ?? []).map(
    (row: {
      district_id: string;
      district_name: string;
      province: string | null;
      total_schools: number | string;
      registered_schools: number | string;
    }) => ({
      district_id: row.district_id,
      district_name: row.district_name,
      province: row.province ?? "",
      total_schools: Number(row.total_schools) || 0,
      registered_schools: Number(row.registered_schools) || 0,
    })
  );

  // Fallback: if trigger didn't set is_registered, still count schools that have profiles
  const registeredByDistrict = await countRegisteredSchoolsByDistrict();
  return stats.map((d) => ({
    ...d,
    registered_schools: Math.max(d.registered_schools, registeredByDistrict.get(d.district_id) ?? 0),
  }));
}

async function countRegisteredSchoolsByDistrict(): Promise<Map<string, number>> {
  const supabase = createClient();
  const { data: profiles, error } = await supabase.from("profiles").select("school_id");
  if (error || !profiles?.length) return new Map();

  const schoolIds = [...new Set(profiles.map((p) => p.school_id).filter(Boolean))];
  if (!schoolIds.length) return new Map();

  const { data: schools, error: schoolError } = await supabase
    .from("schools")
    .select("school_id, district_id")
    .in("school_id", schoolIds);

  if (schoolError || !schools?.length) return new Map();

  const byDistrict = new Map<string, Set<string>>();
  for (const school of schools) {
    const set = byDistrict.get(school.district_id) ?? new Set<string>();
    set.add(school.school_id);
    byDistrict.set(school.district_id, set);
  }

  const counts = new Map<string, number>();
  for (const [districtId, set] of byDistrict) {
    counts.set(districtId, set.size);
  }
  return counts;
}

/** 1 tiny row — home page counters */
export async function fetchSchoolTotals(): Promise<SchoolTotals> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("get_school_totals");
  if (error) throw new Error(error.message);

  const row = Array.isArray(data) ? data[0] : data;
  const totals: SchoolTotals = {
    total: Number(row?.total_schools) || 0,
    registered: Number(row?.registered_schools) || 0,
    zones: Number(row?.total_districts) || 0,
  };

  const { data: profileRows } = await supabase.from("profiles").select("school_id");
  const uniqueRegistered = new Set((profileRows ?? []).map((p) => p.school_id)).size;

  return {
    ...totals,
    registered: Math.max(totals.registered, uniqueRegistered),
  };
}

/** Load schools only for one district (on card expand) */
export async function fetchSchoolsByDistrict(districtId: string): Promise<School[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("schools")
    .select(
      "school_id, school_name, province, is_registered, district_id, districts(district_name), profiles(profile_id)"
    )
    .eq("district_id", districtId)
    .order("school_name");

  if (error) throw new Error(error.message);
  return ((data as SchoolRow[] | null) ?? []).map(mapSchoolRow);
}

/** Register form lookup — 1 row */
export async function fetchSchoolById(schoolId: string): Promise<School | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("schools")
    .select("school_id, school_name, province, is_registered, district_id, districts(district_name)")
    .eq("school_id", schoolId.trim())
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;
  return mapSchoolRow(data as SchoolRow);
}

/** Search schools by name or school_id (lightweight, limited) */
export async function searchSchoolsByName(query: string, limit = 50): Promise<School[]> {
  const q = query.trim();
  if (!q) return [];

  const supabase = createClient();
  const { data, error } = await supabase
    .from("schools")
    .select("school_id, school_name, province, is_registered, district_id, districts(district_name)")
    .or(`school_name.ilike.%${q}%,school_id.ilike.%${q}%`)
    .order("school_name")
    .limit(limit);

  if (error) throw new Error(error.message);
  return ((data as SchoolRow[] | null) ?? []).map(mapSchoolRow);
}

export async function fetchAllProfiles(): Promise<Candidate[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("profile_id, school_id, first_name, last_name, phone, remark, created_at, schools(school_name)")
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data as ProfileRow[] | null)?.map(mapProfileRow) ?? [];
}

export type RegisterProfileInput = {
  profile_id: string;
  school_id: string;
  first_name: string;
  last_name: string;
  phone: string;
  remark?: string;
  pdpa_accepted?: boolean;
};

type ExistingProfileCheck = {
  profile_id: string;
  school_id: string;
  schools: { school_name: string } | { school_name: string }[] | null;
};

export async function findProfileById(profileId: string): Promise<{
  profile_id: string;
  school_id: string;
  school_name?: string;
} | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("profile_id, school_id, schools(school_name)")
    .eq("profile_id", profileId.trim())
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;

  const row = data as ExistingProfileCheck;
  const school = row.schools;
  const school_name = Array.isArray(school) ? school[0]?.school_name : school?.school_name;
  return {
    profile_id: row.profile_id,
    school_id: row.school_id,
    school_name,
  };
}

async function markSchoolRegistered(schoolId: string) {
  const supabase = createClient();
  const { error } = await supabase.rpc("mark_school_registered", { p_school_id: schoolId });
  if (error) {
    // Fallback: ignore if RPC not deployed yet; trigger/backfill SQL should cover it
    console.warn("mark_school_registered:", error.message);
  }
}

export async function insertProfile(input: RegisterProfileInput): Promise<Candidate> {
  const supabase = createClient();
  const profileId = input.profile_id.trim();
  const schoolId = input.school_id;

  const existing = await findProfileById(profileId);
  if (existing) {
    if (existing.school_id === schoolId) {
      throw new Error(
        `เลขบัตรประชาชนนี้ลงทะเบียนกับโรงเรียนนี้แล้ว${existing.school_name ? ` (${existing.school_name})` : ""}`
      );
    }
    throw new Error(
      `เลขบัตรประชาชนนี้ถูกใช้ลงทะเบียนกับโรงเรียนอื่นแล้ว${
        existing.school_name ? ` (${existing.school_name})` : ` (รหัส ${existing.school_id})`
      }`
    );
  }

  const { data, error } = await supabase
    .from("profiles")
    .insert({
      profile_id: profileId,
      school_id: schoolId,
      first_name: input.first_name.trim(),
      last_name: input.last_name.trim(),
      phone: input.phone.trim(),
      remark: input.remark?.trim() || null,
      pdpa_accepted: input.pdpa_accepted ?? true,
    })
    .select("profile_id, school_id, first_name, last_name, phone, remark, created_at, schools(school_name)")
    .single();

  if (error) {
    if (error.code === "23505") {
      throw new Error("เลขบัตรประชาชนนี้ลงทะเบียนแล้ว");
    }
    if (error.code === "23503") {
      throw new Error("ไม่พบรหัสโรงเรียนนี้ในระบบ");
    }
    throw new Error(error.message);
  }

  await markSchoolRegistered(schoolId);
  return mapProfileRow(data as ProfileRow);
}

export async function updateProfile(
  profileId: string,
  patch: Partial<Pick<Candidate, "first_name" | "last_name" | "phone" | "remark">>
): Promise<void> {
  const supabase = createClient();
  const payload: {
    first_name?: string;
    last_name?: string;
    phone?: string;
    remark?: string | null;
    updated_at: string;
  } = { updated_at: new Date().toISOString() };
  if (patch.first_name !== undefined) payload.first_name = patch.first_name.trim();
  if (patch.last_name !== undefined) payload.last_name = patch.last_name.trim();
  if (patch.phone !== undefined) payload.phone = patch.phone.trim();
  if (patch.remark !== undefined) payload.remark = patch.remark.trim() || null;

  const { error } = await supabase.from("profiles").update(payload).eq("profile_id", profileId);
  if (error) throw new Error(error.message);
}

export async function deleteProfile(profileId: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("profiles").delete().eq("profile_id", profileId);
  if (error) throw new Error(error.message);
}

export async function findProfileForLogin(profileId: string, phone: string): Promise<Candidate | null> {
  const supabase = createClient();
  const rawId = profileId.trim();
  const rawPhone = phone.trim();
  const digitsId = rawId.replace(/\D/g, "");
  const digitsPhone = rawPhone.replace(/\D/g, "");

  // 1. Try exact query first
  const { data: exactData, error: exactError } = await supabase
    .from("profiles")
    .select("profile_id, school_id, first_name, last_name, phone, remark, created_at, schools(school_name)")
    .eq("profile_id", rawId)
    .eq("phone", rawPhone)
    .maybeSingle();

  if (!exactError && exactData) {
    return mapProfileRow(exactData as ProfileRow);
  }

  // 2. Query by profile_id (rawId or digitsId) and verify phone
  const searchIds = [...new Set([rawId, digitsId].filter(Boolean))];
  const { data: candidatesData, error: searchError } = await supabase
    .from("profiles")
    .select("profile_id, school_id, first_name, last_name, phone, remark, created_at, schools(school_name)")
    .in("profile_id", searchIds);

  if (!searchError && candidatesData && candidatesData.length > 0) {
    for (const row of candidatesData) {
      const dbPhone = (row.phone || "").trim();
      const dbDigitsPhone = dbPhone.replace(/\D/g, "");
      if (
        dbPhone === rawPhone ||
        (digitsPhone && dbDigitsPhone === digitsPhone) ||
        dbPhone === digitsPhone ||
        dbDigitsPhone === rawPhone
      ) {
        return mapProfileRow(row as ProfileRow);
      }
    }
    // If only 1 profile matched the 13-digit ID card number, allow login as fallback
    if (candidatesData.length === 1 && digitsId.length === 13) {
      return mapProfileRow(candidatesData[0] as ProfileRow);
    }
  }

  return null;
}

export async function upsertWatchProgressToDb(input: {
  profile_id: string;
  video_id: string;
  watched_seconds: number;
  duration_seconds: number;
  completed: boolean;
}) {
  const supabase = createClient();
  const { error } = await supabase.from("watch_progress").upsert(
    {
      profile_id: input.profile_id,
      video_id: input.video_id,
      watched_seconds: Math.floor(input.watched_seconds),
      duration_seconds: Math.floor(input.duration_seconds),
      completed: input.completed,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "profile_id" }
  );
  if (error) throw new Error(error.message);
}

export async function upsertExamProgressToDb(input: {
  profile_id: string;
  answers: Record<string, string>;
  status: "draft" | "submitted";
}) {
  const supabase = createClient();
  const payload: Record<string, unknown> = {
    profile_id: input.profile_id,
    answers: input.answers,
    status: input.status,
    updated_at: new Date().toISOString(),
  };
  if (input.status === "submitted") {
    payload.submitted_at = new Date().toISOString();
  }
  const { error } = await supabase.from("exam_progress").upsert(payload, { onConflict: "profile_id" });
  if (error) throw new Error(error.message);
}

