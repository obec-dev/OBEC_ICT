import { createClient } from "@/lib/supabase/client";
import type { Candidate, DistrictStat, ExamProgress, School, SchoolTotals } from "@/types/ict";

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
  title_key?: string | null;
  title_en?: string | null;
  title_th?: string | null;
  title_other_en?: string | null;
  title_other_th?: string | null;
  eng_first_name?: string | null;
  eng_last_name?: string | null;
  birth_date?: string | null;
  gender?: string | null;
  position?: string | null;
  duty?: string | null;
  line_id?: string | null;
  email?: string | null;
  created_at: string | null;
  schools?: { school_name: string } | { school_name: string }[] | null;
  is_school_admin?: boolean | null;
  must_set_password?: boolean | null;
  ict_talent_cohort?: string | null;
  ict_survey?: Record<string, unknown> | null;
};

function districtName(row: SchoolRow): string {
  const d = row.districts;
  if (!d) return row.district_id;
  if (Array.isArray(d)) return d[0]?.district_name ?? row.district_id;
  return d.district_name ?? row.district_id;
}

export function mapSchoolRow(row: SchoolRow): School {
  const profileList = Array.isArray(row.profiles)
    ? row.profiles
    : row.profiles
      ? [row.profiles]
      : [];
  const registered_count = profileList.length;
  const hasProfile = registered_count > 0;

  return {
    school_id: row.school_id,
    school_name: row.school_name,
    area_zone: districtName(row),
    province: row.province,
    is_registered: Boolean(row.is_registered) || hasProfile,
    district_id: row.district_id,
    registered_count,
  };
}

export function mapProfileRow(row: ProfileRow): Candidate {
  const school = row.schools;
  const school_name = Array.isArray(school)
    ? school[0]?.school_name
    : school?.school_name;

  const titleTh = row.title_other_th || row.title_th || "";
  const displayName = `${titleTh} ${row.first_name} ${row.last_name}`.trim();

  return {
    id: row.profile_id,
    school_id: row.school_id,
    school_name,
    first_name: row.first_name,
    last_name: row.last_name,
    full_name: displayName,
    phone: row.phone,
    remark: row.remark ?? undefined,
    title_key: row.title_key ?? undefined,
    title_en: row.title_en ?? undefined,
    title_th: row.title_th ?? undefined,
    title_other_en: row.title_other_en ?? undefined,
    title_other_th: row.title_other_th ?? undefined,
    eng_first_name: row.eng_first_name ?? undefined,
    eng_last_name: row.eng_last_name ?? undefined,
    birth_date: row.birth_date ?? undefined,
    gender: row.gender ?? undefined,
    position: row.position ?? undefined,
    duty: row.duty ?? undefined,
    line_id: row.line_id ?? undefined,
    email: row.email ?? undefined,
    is_school_admin: Boolean(row.is_school_admin),
    must_set_password: row.must_set_password !== false && row.must_set_password !== undefined
      ? Boolean(row.must_set_password)
      : row.must_set_password === false
        ? false
        : undefined,
    ict_talent_cohort: row.ict_talent_cohort ?? undefined,
    ict_survey: row.ict_survey ?? undefined,
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

  // Rely on get_district_stats only (no public profiles scan — PII leak)
  return stats;
}

/** 1 tiny row — home page counters */
export async function fetchSchoolTotals(): Promise<SchoolTotals> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("get_school_totals");
  if (error) throw new Error(error.message);

  const row = Array.isArray(data) ? data[0] : data;
  return {
    total: Number(row?.total_schools) || 0,
    registered: Number(row?.registered_schools) || 0,
    zones: Number(row?.total_districts) || 0,
  };
}

/** Load schools only for one district (on card expand) — includes people count */
export async function fetchSchoolsByDistrict(districtId: string): Promise<School[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("get_schools_by_district", {
    p_district_id: districtId,
  });

  if (error) throw new Error(error.message);

  type Row = {
    school_id: string;
    school_name: string;
    province: string;
    district_id: string;
    district_name: string;
    is_registered: boolean;
    registered_count: number | string;
  };

  return ((data as Row[] | null) ?? []).map((row) => ({
    school_id: row.school_id,
    school_name: row.school_name,
    area_zone: row.district_name || row.district_id,
    province: row.province,
    is_registered: Boolean(row.is_registered),
    district_id: row.district_id,
    registered_count: Number(row.registered_count) || 0,
  }));
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
  const q = query.trim().replace(/[%_,]/g, " ").replace(/\s+/g, " ").trim();
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

/** @deprecated Public profile dumps are blocked by RLS. Use admin RPCs. */
export async function fetchAllProfiles(): Promise<Candidate[]> {
  return [];
}

function mapRpcProfileJson(raw: Record<string, unknown>): Candidate {
  return mapProfileRow({
    profile_id: String(raw.profile_id ?? ""),
    school_id: String(raw.school_id ?? ""),
    first_name: String(raw.first_name ?? ""),
    last_name: String(raw.last_name ?? ""),
    phone: String(raw.phone ?? ""),
    remark: raw.remark == null ? null : String(raw.remark),
    title_key: raw.title_key == null ? null : String(raw.title_key),
    title_en: raw.title_en == null ? null : String(raw.title_en),
    title_th: raw.title_th == null ? null : String(raw.title_th),
    title_other_en: raw.title_other_en == null ? null : String(raw.title_other_en),
    title_other_th: raw.title_other_th == null ? null : String(raw.title_other_th),
    eng_first_name: raw.eng_first_name == null ? null : String(raw.eng_first_name),
    eng_last_name: raw.eng_last_name == null ? null : String(raw.eng_last_name),
    birth_date: raw.birth_date == null ? null : String(raw.birth_date),
    gender: raw.gender == null ? null : String(raw.gender),
    position: raw.position == null ? null : String(raw.position),
    duty: raw.duty == null ? null : String(raw.duty),
    line_id: raw.line_id == null ? null : String(raw.line_id),
    email: raw.email == null ? null : String(raw.email),
    created_at: raw.created_at == null ? null : String(raw.created_at),
    schools: raw.school_name ? { school_name: String(raw.school_name) } : null,
    is_school_admin: Boolean(raw.is_school_admin),
    must_set_password: raw.must_set_password == null ? true : Boolean(raw.must_set_password),
    ict_talent_cohort: raw.ict_talent_cohort == null ? null : String(raw.ict_talent_cohort),
    ict_survey:
      raw.ict_survey && typeof raw.ict_survey === "object"
        ? (raw.ict_survey as Record<string, unknown>)
        : null,
  });
}

export type RegisterProfileInput = {
  profile_id: string;
  school_id: string;
  /** Thai given name */
  first_name: string;
  /** Thai surname */
  last_name: string;
  phone: string;
  remark?: string;
  pdpa_accepted?: boolean;
  title_key: string;
  title_en: string;
  title_th: string;
  title_other_en?: string;
  title_other_th?: string;
  eng_first_name: string;
  eng_last_name: string;
  birth_date: string;
  gender: string;
  position: string;
  duty: string;
  line_id: string;
  email: string;
  is_school_admin?: boolean;
  ict_talent_cohort?: string;
  ict_survey?: Record<string, unknown>;
};

function asRpcObj(data: unknown): Record<string, unknown> {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    return data as Record<string, unknown>;
  }
  return {};
}

export async function findProfileById(profileId: string): Promise<{
  profile_id: string;
  school_id: string;
  school_name?: string;
} | null> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("profile_registration_check", {
    p_profile_id: profileId.trim(),
  });
  if (error) throw new Error(error.message);

  const row = asRpcObj(data);
  if (!row.exists) return null;

  return {
    profile_id: String(row.profile_id ?? ""),
    school_id: String(row.school_id ?? ""),
    school_name: row.school_name ? String(row.school_name) : undefined,
  };
}

export async function insertProfile(input: RegisterProfileInput): Promise<Candidate> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("register_profile", {
    p_profile_id: input.profile_id.trim(),
    p_school_id: input.school_id,
    p_first_name: input.first_name.trim(),
    p_last_name: input.last_name.trim(),
    p_phone: input.phone.trim(),
    p_remark: input.remark?.trim() || null,
    p_pdpa_accepted: input.pdpa_accepted ?? true,
    p_title_key: input.title_key,
    p_title_en: input.title_en.trim() || null,
    p_title_th: input.title_th.trim() || null,
    p_title_other_en: input.title_other_en?.trim() || null,
    p_title_other_th: input.title_other_th?.trim() || null,
    p_eng_first_name: input.eng_first_name.trim(),
    p_eng_last_name: input.eng_last_name.trim(),
    p_birth_date: input.birth_date,
    p_gender: input.gender,
    p_position: input.position.trim(),
    p_duty: input.duty.trim(),
    p_line_id: input.line_id.trim(),
    p_email: input.email.trim().toLowerCase(),
    p_is_school_admin: input.is_school_admin === true,
    p_ict_talent_cohort: input.ict_talent_cohort || null,
    p_ict_survey: input.ict_survey ?? {},
  });
  if (error) throw new Error(error.message);

  const row = asRpcObj(data);
  if (!row.ok) {
    throw new Error(String(row.error ?? "ลงทะเบียนไม่สำเร็จ"));
  }

  const profile = asRpcObj(row.profile);
  return mapRpcProfileJson(profile);
}

export type OwnProfilePatch = Partial<
  Pick<
    Candidate,
    | "first_name"
    | "last_name"
    | "phone"
    | "remark"
    | "title_key"
    | "title_en"
    | "title_th"
    | "title_other_en"
    | "title_other_th"
    | "eng_first_name"
    | "eng_last_name"
    | "position"
    | "duty"
    | "line_id"
    | "email"
  >
>;

export async function updateOwnProfile(
  profileId: string,
  phone: string,
  patch: OwnProfilePatch
): Promise<Candidate> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("update_own_profile", {
    p_profile_id: profileId,
    p_phone: phone,
    p_patch: patch,
  });
  if (error) throw new Error(error.message);

  const row = asRpcObj(data);
  if (!row.ok) {
    throw new Error(String(row.error ?? "อัปเดตไม่สำเร็จ"));
  }
  return mapRpcProfileJson(asRpcObj(row.profile));
}

/** @deprecated Direct profile updates are blocked. Use updateOwnProfile or admin RPCs. */
export async function updateProfile(
  _profileId: string,
  _patch: OwnProfilePatch
): Promise<void> {
  throw new Error("updateProfile is deprecated; use updateOwnProfile or admin RPCs");
}

/** @deprecated Direct profile deletes are blocked. Use adminDeleteProfileRpc. */
export async function deleteProfile(_profileId: string): Promise<void> {
  throw new Error("deleteProfile is deprecated; use adminDeleteProfileRpc");
}

export async function findProfileForLogin(profileId: string, phone: string): Promise<Candidate | null> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("login_profile", {
    p_profile_id: profileId.trim(),
    p_phone: phone.trim(),
  });
  if (error) throw new Error(error.message);

  const row = asRpcObj(data);
  if (!row.ok) {
    const msg = String(row.error ?? "");
    if (msg) throw new Error(msg);
    return null;
  }

  const candidate = mapRpcProfileJson(asRpcObj(row.profile));
  if (row.need_password_setup) {
    candidate.must_set_password = true;
  }
  return candidate;
}

export type CandidateLoginResult =
  | { ok: true; candidate: Candidate; needPasswordSetup?: boolean }
  | { ok: false; error: string; needPasswordSetup?: boolean };

export async function loginCandidateWithPassword(
  profileId: string,
  password: string
): Promise<CandidateLoginResult> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("login_candidate", {
    p_profile_id: profileId.trim(),
    p_password: password,
  });
  if (error) return { ok: false, error: error.message };

  const row = asRpcObj(data);
  if (!row.ok) {
    return {
      ok: false,
      error: String(row.error ?? "เข้าสู่ระบบไม่สำเร็จ"),
      needPasswordSetup: Boolean(row.need_password_setup),
    };
  }
  return { ok: true, candidate: mapRpcProfileJson(asRpcObj(row.profile)) };
}

export async function verifyCandidateForPassword(profileId: string, phone: string) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("verify_candidate_for_password", {
    p_profile_id: profileId.trim(),
    p_phone: phone.trim(),
  });
  if (error) return { ok: false as const, error: error.message };
  const row = asRpcObj(data);
  if (!row.ok) {
    return {
      ok: false as const,
      error: String(row.error ?? "ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้งหรือติดต่อผู้ดูแลระบบ"),
    };
  }
  return {
    ok: true as const,
    profile_id: String(row.profile_id),
    must_set_password: Boolean(row.must_set_password),
    has_password: Boolean(row.has_password),
  };
}

export async function setCandidatePassword(profileId: string, phone: string, newPassword: string) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("set_candidate_password", {
    p_profile_id: profileId.trim(),
    p_phone: phone.trim(),
    p_new_password: newPassword,
  });
  if (error) return { ok: false as const, error: error.message };
  const row = asRpcObj(data);
  if (!row.ok) {
    return {
      ok: false as const,
      error: String(row.error ?? "ตั้งรหัสผ่านไม่สำเร็จ"),
    };
  }
  return { ok: true as const, candidate: mapRpcProfileJson(asRpcObj(row.profile)) };
}

export async function getSchoolProfileForAdmin(profileId: string, phone: string) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("get_school_profile_for_admin", {
    p_profile_id: profileId,
    p_phone: phone,
  });
  if (error) throw new Error(error.message);
  const row = asRpcObj(data);
  if (!row.ok) throw new Error(String(row.error ?? "โหลดข้อมูลโรงเรียนไม่สำเร็จ"));
  return asRpcObj(row.school);
}

export async function updateSchoolProfileRpc(
  profileId: string,
  phone: string,
  directorName: string,
  directorPosition: string
) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("update_school_profile", {
    p_profile_id: profileId,
    p_phone: phone,
    p_director_name: directorName,
    p_director_position: directorPosition,
  });
  if (error) return { ok: false as const, error: error.message };
  const row = asRpcObj(data);
  if (!row.ok) return { ok: false as const, error: String(row.error ?? "บันทึกไม่สำเร็จ") };
  return { ok: true as const, school: asRpcObj(row.school) };
}

/** @deprecated Prefer loginCandidateWithPassword for portal access */
export async function findProfileForLoginLegacyPhone(
  profileId: string,
  phone: string
): Promise<Candidate | null> {
  return findProfileForLogin(profileId, phone);
}

export async function upsertWatchProgressToDb(input: {
  profile_id: string;
  phone: string;
  video_id: string;
  watched_seconds: number;
  duration_seconds: number;
  completed: boolean;
}) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("upsert_watch_progress", {
    p_profile_id: input.profile_id,
    p_phone: input.phone,
    p_video_id: input.video_id,
    p_watched_seconds: Math.floor(input.watched_seconds),
    p_duration_seconds: Math.floor(input.duration_seconds),
    p_completed: input.completed,
  });
  if (error) throw new Error(error.message);

  const row = asRpcObj(data);
  if (!row.ok) throw new Error(String(row.error ?? "บันทึกความคืบหน้าไม่สำเร็จ"));
}

export async function upsertExamProgressToDb(input: {
  profile_id: string;
  phone: string;
  project_id: string;
  answers: Record<string, string>;
  status: "draft" | "submitted";
}) {
  if (!input.project_id?.trim()) {
    throw new Error("ไม่พบโครงการ");
  }
  const supabase = createClient();
  const { data, error } = await supabase.rpc("upsert_exam_progress", {
    p_profile_id: input.profile_id,
    p_phone: input.phone,
    p_project_id: input.project_id,
    p_answers: input.answers,
    p_status: input.status,
  });
  if (error) throw new Error(error.message);

  const row = asRpcObj(data);
  if (!row.ok) throw new Error(String(row.error ?? "บันทึกข้อสอบไม่สำเร็จ"));
}

/** @deprecated Public exam progress scans are blocked. Use adminListExamProgressRpc. */
export async function fetchExamProgressByProfiles(
  _profileIds: string[],
  _projectId?: string
): Promise<ExamProgress[]> {
  return [];
}

