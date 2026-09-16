import { createClient } from "@/lib/supabase/client";
import type {
  AuditUser,
  BusinessUser,
  Candidate,
  DistrictStat,
  ExamProgress,
  PortalRole,
  School,
  SchoolTotals,
  UserMissionProgress,
} from "@/types/ict";

function asPortalRole(value: unknown): PortalRole {
  if (value === "school_admin") return "school_admin";
  return "user";
}

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
  position_other?: string | null;
  duty?: string | null;
  line_id?: string | null;
  email?: string | null;
  contact_email?: string | null;
  login_email?: string | null;
  created_at: string | null;
  schools?: { school_name: string } | { school_name: string }[] | null;
  is_school_admin?: boolean | null;
  must_set_password?: boolean | null;
  ict_talent_cohort?: string | null;
  ict_survey?: Record<string, unknown> | null;
  portal_role?: string | null;
  is_active?: boolean | null;
  deleted_at?: string | null;
  assigned_district_id?: string | null;
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
    position_other: row.position_other ?? undefined,
    duty: row.duty ?? undefined,
    line_id: row.line_id ?? undefined,
    email: row.contact_email ?? row.email ?? undefined,
    contact_email: row.contact_email ?? row.email ?? undefined,
    login_email: row.login_email ?? undefined,
    is_school_admin: Boolean(row.is_school_admin),
    must_set_password: row.must_set_password !== false && row.must_set_password !== undefined
      ? Boolean(row.must_set_password)
      : row.must_set_password === false
        ? false
        : undefined,
    ict_talent_cohort: row.ict_talent_cohort ?? undefined,
    ict_survey: row.ict_survey ?? undefined,
    portal_role: asPortalRole(row.portal_role ?? (row.is_school_admin ? "school_admin" : "user")),
    is_active: row.is_active !== false,
    deleted_at: row.deleted_at ?? null,
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

/** Search schools by name or school_id. Empty query preloads registered schools. */
export async function searchSchoolsByName(query: string, limit = 50): Promise<School[]> {
  const q = query.trim().replace(/[%_,]/g, " ").replace(/\s+/g, " ").trim();
  const supabase = createClient();
  let req = supabase
    .from("schools")
    .select("school_id, school_name, province, is_registered, district_id, districts(district_name)")
    .order("school_name")
    .limit(limit);

  if (!q) {
    req = req.eq("is_registered", true);
  } else {
    req = req.or(`school_name.ilike.%${q}%,school_id.ilike.%${q}%`);
  }

  const { data, error } = await req;
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
    position_other: raw.position_other == null ? null : String(raw.position_other),
    duty: raw.duty == null ? null : String(raw.duty),
    line_id: raw.line_id == null ? null : String(raw.line_id),
    email: raw.email == null && raw.contact_email == null ? null : String(raw.contact_email ?? raw.email),
    contact_email:
      raw.contact_email == null && raw.email == null
        ? null
        : String(raw.contact_email ?? raw.email),
    login_email: raw.login_email == null ? null : String(raw.login_email),
    created_at: raw.created_at == null ? null : String(raw.created_at),
    schools: raw.school_name ? { school_name: String(raw.school_name) } : null,
    is_school_admin: Boolean(raw.is_school_admin),
    // Missing flag must not force first-time setup. Only an explicit true does.
    must_set_password: raw.must_set_password === true,
    ict_talent_cohort: raw.ict_talent_cohort == null ? null : String(raw.ict_talent_cohort),
    ict_survey:
      raw.ict_survey && typeof raw.ict_survey === "object"
        ? (raw.ict_survey as Record<string, unknown>)
        : null,
    portal_role: raw.portal_role == null ? null : String(raw.portal_role),
    is_active: raw.is_active == null ? true : Boolean(raw.is_active),
    deleted_at: raw.deleted_at == null ? null : String(raw.deleted_at),
  });
}

export type RegisterProfileInput = {
  /** Empty/omitted — the database mints a 13-digit profile_id. */
  profile_id?: string;
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
  position_other?: string;
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
    p_profile_id: input.profile_id?.trim() || null,
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
    p_position_other: input.position_other?.trim() || null,
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
    | "position_other"
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
  profileId: string,
  patch: OwnProfilePatch
): Promise<void> {
  void profileId;
  void patch;
  throw new Error("updateProfile is deprecated; use updateOwnProfile or admin RPCs");
}

/** @deprecated Direct profile deletes are blocked. Use adminDeleteProfileRpc. */
export async function deleteProfile(profileId: string): Promise<void> {
  void profileId;
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

export type PortalLoginResult =
  | { ok: true; kind: "candidate"; candidate: Candidate }
  | { ok: true; kind: "business"; user: BusinessUser }
  | { ok: true; kind: "audit"; user: AuditUser }
  | {
      ok: false;
      error: string;
      needPasswordSetup?: boolean;
      setupKind?: "candidate" | "business" | "audit";
      loginEmailForSetup?: string;
      profileIdForSetup?: string;
    };

/** @deprecated Use PortalLoginResult */
export type CandidateLoginResult = PortalLoginResult;

/** Whether this email still needs a first password. Unknown emails are treated as normal login. */
export async function fetchLoginSetupStatus(email: string): Promise<{
  needsPasswordSetup: boolean;
  kind: "candidate" | "business" | "audit" | "unknown";
}> {
  const id = email.trim().toLowerCase();
  if (!id) return { needsPasswordSetup: false, kind: "unknown" };

  const supabase = createClient();
  const { data, error } = await supabase.rpc("login_setup_status", { p_email: id });
  if (error) return { needsPasswordSetup: false, kind: "unknown" };

  const row = asRpcObj(data);
  const kindRaw = String(row.kind ?? "unknown");
  const kind =
    kindRaw === "candidate" || kindRaw === "business" || kindRaw === "audit" ? kindRaw : "unknown";
  return {
    needsPasswordSetup: kind === "candidate" && Boolean(row.needs_password_setup),
    kind,
  };
}

export async function loginCandidateWithPassword(
  email: string,
  password: string
): Promise<PortalLoginResult> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("login_candidate", {
    p_email: email.trim().toLowerCase(),
    p_password: password,
  });
  if (error) return { ok: false, error: error.message };

  const row = asRpcObj(data);
  if (!row.ok) {
    const setupKindRaw = String(row.kind ?? "candidate");
    const setupKind =
      setupKindRaw === "business" || setupKindRaw === "audit" ? setupKindRaw : "candidate";
    return {
      ok: false,
      error: String(row.error ?? "เข้าสู่ระบบไม่สำเร็จ"),
      needPasswordSetup: Boolean(row.need_password_setup),
      setupKind,
      loginEmailForSetup: row.login_email
        ? String(row.login_email)
        : email.trim().toLowerCase(),
      profileIdForSetup: row.profile_id ? String(row.profile_id) : undefined,
    };
  }

  const kind = String(row.kind ?? "candidate");
  if (kind === "business") {
    const u = asRpcObj(row.user);
    return {
      ok: true,
      kind: "business",
      user: {
        id: String(u.id),
        login_email: String(u.login_email ?? ""),
        display_name: String(u.display_name ?? ""),
        position: u.position == null ? null : String(u.position),
        must_set_password: Boolean(u.must_set_password),
      },
    };
  }
  if (kind === "audit") {
    const u = asRpcObj(row.user);
    const districts = parseDistrictIdList(u.assigned_districts);
    return {
      ok: true,
      kind: "audit",
      user: {
        id: String(u.id),
        login_email: String(u.login_email ?? ""),
        display_name: String(u.display_name ?? ""),
        position: u.position == null ? null : String(u.position),
        assigned_districts: districts,
        must_set_password: Boolean(u.must_set_password),
      },
    };
  }

  const candidate = mapRpcProfileJson(asRpcObj(row.profile));
  // login_candidate only returns ok after the password is already set and verified.
  candidate.must_set_password = false;
  return { ok: true, kind: "candidate", candidate };
}

export async function setExecutivePassword(
  kind: "business" | "audit",
  loginId: string,
  currentPassword: string,
  newPassword: string
) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("set_executive_password", {
    p_kind: kind,
    p_login_id: loginId.trim().toLowerCase(),
    p_current_password: currentPassword,
    p_new_password: newPassword,
  });
  if (error) return { ok: false as const, error: error.message };
  const row = asRpcObj(data);
  if (!row.ok) return { ok: false as const, error: String(row.error ?? "ตั้งรหัสผ่านไม่สำเร็จ") };
  const u = asRpcObj(row.user);
  if (String(row.kind) === "audit") {
    return {
      ok: true as const,
      kind: "audit" as const,
      user: {
        id: String(u.id),
        login_email: String(u.login_email ?? ""),
        display_name: String(u.display_name ?? ""),
        position: u.position == null ? null : String(u.position),
        assigned_districts: parseDistrictIdList(u.assigned_districts),
        must_set_password: false,
      } satisfies AuditUser,
    };
  }
  return {
    ok: true as const,
    kind: "business" as const,
    user: {
      id: String(u.id),
      login_email: String(u.login_email ?? ""),
      display_name: String(u.display_name ?? ""),
      position: u.position == null ? null : String(u.position),
      must_set_password: false,
    } satisfies BusinessUser,
  };
}

export async function logPortalLogout(profileId: string, phone: string) {
  const supabase = createClient();
  await supabase.rpc("log_portal_logout", {
    p_profile_id: profileId,
    p_phone: phone,
  });
}

export async function verifyCandidateForPassword(email: string, phone: string) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("verify_candidate_for_password", {
    p_email: email.trim().toLowerCase(),
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
    login_email: String(row.login_email ?? email.trim().toLowerCase()),
    must_set_password: Boolean(row.must_set_password),
    has_password: Boolean(row.has_password),
  };
}

/** Forgot password: login email + current phone. Returns the account login email. */
export async function verifyCandidateForgotPassword(email: string, phone: string) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("verify_candidate_forgot_password", {
    p_email: email.trim().toLowerCase(),
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
    login_email: String(row.login_email ?? ""),
    must_set_password: Boolean(row.must_set_password),
    has_password: Boolean(row.has_password),
  };
}

export async function setCandidatePassword(
  email: string,
  phone: string,
  newPassword: string
) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("set_candidate_password", {
    p_email: email.trim().toLowerCase(),
    p_phone: phone.trim(),
    p_new_password: newPassword,
    p_birth_date: null,
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

export async function fetchMyMissions(
  profileId: string,
  phone: string
): Promise<UserMissionProgress[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("get_my_missions", {
    p_profile_id: profileId,
    p_phone: phone,
  });
  if (error) throw new Error(error.message);
  const row = asRpcObj(data);
  if (!row.ok) throw new Error(String(row.error ?? "โหลดภารกิจไม่สำเร็จ"));
  if (!Array.isArray(row.missions)) return [];
  return row.missions.map((item) => {
    const m = asRpcObj(item);
    return {
      id: String(m.id),
      title: String(m.title ?? ""),
      description: m.description == null ? null : String(m.description),
      sequence_order: Number(m.sequence_order) || 0,
      validation_type:
        m.validation_type === "exam_completion" || m.validation_type === "manual"
          ? m.validation_type
          : "url_submission",
      status: m.status === "completed" ? ("completed" as const) : ("pending" as const),
      submitted_data:
        m.submitted_data && typeof m.submitted_data === "object"
          ? (m.submitted_data as Record<string, unknown>)
          : {},
      completed_at: m.completed_at ? String(m.completed_at) : null,
    };
  });
}

export async function submitMissionUrl(
  profileId: string,
  phone: string,
  missionId: string,
  videoUrl: string
) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("submit_mission_url", {
    p_profile_id: profileId,
    p_phone: phone,
    p_mission_id: missionId,
    p_video_url: videoUrl,
  });
  if (error) return { ok: false as const, error: error.message };
  const row = asRpcObj(data);
  if (!row.ok) return { ok: false as const, error: String(row.error ?? "บันทึกไม่สำเร็จ") };
  return { ok: true as const };
}

export type ExecutiveOpsTotals = {
  schools: number;
  registered_schools: number;
  districts: number;
  users: number;
  active_users: number;
  active_30d: number;
  learn_started: number;
  learn_completed: number;
  exam_submitted: number;
  exam_passed: number;
  school_updates: number;
  school_updates_30d: number;
  registrations_30d: number;
  missions_completed: number;
  partners: number;
};

export type ExecutiveTrendPoint = {
  week_start: string;
  registrations: number;
  learn_completed: number;
  exam_submitted: number;
  school_updates: number;
};

export type ExecutiveDistrictRow = {
  district_id: string;
  district_name: string;
  province: string;
  schools: number;
  registered: number;
  users: number;
  active_users: number;
  learn_completed: number;
  exam_submitted: number;
  exam_passed: number;
  school_updates: number;
  school_updates_30d: number;
};

export type ExecutiveSchoolActivity = {
  school_id: string;
  school_name: string;
  district_name: string;
  province: string;
  activity: number;
  users: number;
};

export type ExecutivePartnerStat = {
  partner: string;
  schools: number;
  participating: number;
  not_participating: number;
};

export type ExecutiveOpsDashboard = {
  kind: "business" | "audit";
  needs_domains: boolean;
  districts_assigned: number;
  totals: ExecutiveOpsTotals;
  trend: ExecutiveTrendPoint[];
  districts: ExecutiveDistrictRow[];
  active_schools: ExecutiveSchoolActivity[];
  inactive_schools: ExecutiveSchoolActivity[];
  partners: ExecutivePartnerStat[];
  has_partner_stats: boolean;
};

export function parseDistrictIdList(value: unknown): string[] {
  let raw = value;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith("[")) {
      try {
        raw = JSON.parse(trimmed) as unknown;
      } catch {
        return [trimmed];
      }
    } else {
      return [trimmed];
    }
  }
  if (!Array.isArray(raw)) return [];
  const ids: string[] = [];
  for (const item of raw) {
    let id = "";
    if (typeof item === "string" || typeof item === "number") id = String(item).trim();
    else if (item && typeof item === "object") {
      const row = item as Record<string, unknown>;
      const picked = row.district_id ?? row.id ?? row.districtId;
      if (picked != null) id = String(picked).trim();
    }
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

function mapSchoolActivity(value: unknown): ExecutiveSchoolActivity[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const row = asRpcObj(item);
    return {
      school_id: String(row.school_id ?? ""),
      school_name: String(row.school_name ?? ""),
      district_name: String(row.district_name ?? ""),
      province: String(row.province ?? ""),
      activity: num(row.activity),
      users: num(row.users),
    };
  });
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export async function fetchExecutiveOpsDashboard(
  kind: "business" | "audit",
  loginId: string
): Promise<ExecutiveOpsDashboard> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("executive_ops_dashboard", {
    p_kind: kind,
    p_login_id: loginId.trim().toLowerCase(),
  });
  if (error) throw new Error(error.message);
  const row = asRpcObj(data);
  if (!row.ok) throw new Error(String(row.error ?? "โหลดแดชบอร์ดไม่สำเร็จ"));

  const totals = asRpcObj(row.totals);
  const trend = Array.isArray(row.trend) ? row.trend : [];
  const districts = Array.isArray(row.districts) ? row.districts : [];

  return {
    kind,
    needs_domains: Boolean(row.needs_domains),
    districts_assigned: num(row.districts_assigned),
    totals: {
      schools: num(totals.schools),
      registered_schools: num(totals.registered_schools),
      districts: num(totals.districts),
      users: num(totals.users),
      active_users: num(totals.active_users),
      active_30d: num(totals.active_30d),
      learn_started: num(totals.learn_started),
      learn_completed: num(totals.learn_completed),
      exam_submitted: num(totals.exam_submitted),
      exam_passed: num(totals.exam_passed),
      school_updates: num(totals.school_updates),
      school_updates_30d: num(totals.school_updates_30d),
      registrations_30d: num(totals.registrations_30d),
      missions_completed: num(totals.missions_completed),
      partners: num(totals.partners),
    },
    trend: trend.map((item) => {
      const t = asRpcObj(item);
      return {
        week_start: String(t.week_start ?? ""),
        registrations: num(t.registrations),
        learn_completed: num(t.learn_completed),
        exam_submitted: num(t.exam_submitted),
        school_updates: num(t.school_updates),
      };
    }),
    districts: districts.map((item) => {
      const d = asRpcObj(item);
      return {
        district_id: String(d.district_id ?? ""),
        district_name: String(d.district_name ?? ""),
        province: String(d.province ?? ""),
        schools: num(d.schools),
        registered: num(d.registered),
        users: num(d.users),
        active_users: num(d.active_users),
        learn_completed: num(d.learn_completed),
        exam_submitted: num(d.exam_submitted),
        exam_passed: num(d.exam_passed),
        school_updates: num(d.school_updates),
        school_updates_30d: num(d.school_updates_30d),
      };
    }),
    active_schools: mapSchoolActivity(row.active_schools),
    inactive_schools: mapSchoolActivity(row.inactive_schools),
    partners: mapPartnerStats(row.partners),
    has_partner_stats: Array.isArray(row.partners),
  };
}

function mapPartnerStats(value: unknown): ExecutivePartnerStat[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const row = asRpcObj(item);
    return {
      partner: String(row.partner ?? "ไม่ระบุ Partner"),
      schools: num(row.schools),
      participating: num(row.participating),
      not_participating: num(row.not_participating),
    };
  });
}

export async function updateExecutiveProfile(input: {
  kind: "business" | "audit";
  loginId: string;
  displayName: string;
  position: string;
  districts?: string[];
}) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("update_executive_profile", {
    p_kind: input.kind,
    p_login_id: input.loginId.trim().toLowerCase(),
    p_display_name: input.displayName.trim(),
    p_position: input.position.trim(),
    p_districts: input.kind === "audit" ? input.districts ?? [] : null,
  });
  if (error) return { ok: false as const, error: error.message };
  const row = asRpcObj(data);
  if (!row.ok) return { ok: false as const, error: String(row.error ?? "บันทึกไม่สำเร็จ") };
  const user = asRpcObj(row.user);
  const districts = parseDistrictIdList(user.assigned_districts);
  return {
    ok: true as const,
    user: {
      id: String(user.id ?? ""),
      login_email: String(user.login_email ?? ""),
      display_name: String(user.display_name ?? ""),
      position: user.position == null ? null : String(user.position),
      assigned_districts: districts,
      must_set_password: Boolean(user.must_set_password),
    },
  };
}

export async function fetchExecutiveSummary() {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("executive_summary_stats");
  if (error) throw new Error(error.message);
  return asRpcObj(data);
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
  lesson_submissions?: Record<string, { status: "submitted"; submitted_at?: string }>;
}) {
  if (!input.project_id?.trim()) {
    throw new Error("ไม่พบโครงการ");
  }
  const supabase = createClient();
  const payload: Record<string, unknown> = {
    p_profile_id: input.profile_id,
    p_phone: input.phone,
    p_project_id: input.project_id,
    p_answers: input.answers,
    p_status: input.status,
  };
  if (input.lesson_submissions) {
    payload.p_lesson_submissions = input.lesson_submissions;
  }
  const { data, error } = await supabase.rpc("upsert_exam_progress", payload);
  if (error) throw new Error(error.message);

  const row = asRpcObj(data);
  if (!row.ok) throw new Error(String(row.error ?? "บันทึกข้อสอบไม่สำเร็จ"));
}

function asLessonSubmissions(
  value: unknown
): Record<string, { status: "submitted"; submitted_at?: string }> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, { status: "submitted"; submitted_at?: string }> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const item = asRpcObj(raw);
    if (item.status === "submitted") {
      out[key] = {
        status: "submitted",
        submitted_at: item.submitted_at ? String(item.submitted_at) : undefined,
      };
    }
  }
  return out;
}

function asAnswerMap(value: unknown): Record<string, string> {
  if (typeof value === "string") {
    try {
      return asAnswerMap(JSON.parse(value) as unknown);
    } catch {
      return {};
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const answers: Record<string, string> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (item == null) continue;
    answers[key] = String(item);
  }
  return answers;
}

/** Load this candidate's own exam draft/submission. Never read answers from local storage. */
export async function fetchMyExamProgress(profileId: string, phone: string): Promise<ExamProgress[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("get_my_exam_progress", {
    p_profile_id: profileId,
    p_phone: phone,
    p_project_id: null,
  });
  if (error) throw new Error(error.message);

  const row = asRpcObj(data);
  if (!row.ok) throw new Error(String(row.error ?? "โหลดคำตอบข้อสอบไม่สำเร็จ"));
  if (!Array.isArray(row.rows)) return [];

  return row.rows.map((item) => {
    const exam = asRpcObj(item);
    return {
      candidate_id: String(exam.profile_id ?? profileId),
      project_id: exam.project_id ? String(exam.project_id) : undefined,
      answers: asAnswerMap(exam.answers),
      status: exam.status === "submitted" ? ("submitted" as const) : ("draft" as const),
      lesson_submissions: asLessonSubmissions(exam.lesson_submissions),
      score: exam.score != null ? Number(exam.score) : undefined,
      passed: typeof exam.passed === "boolean" ? exam.passed : undefined,
      graded_at: exam.graded_at ? String(exam.graded_at) : undefined,
      updated_at: exam.updated_at ? String(exam.updated_at) : new Date().toISOString(),
    };
  });
}

/** @deprecated Public exam progress scans are blocked. Use adminListExamProgressRpc. */
export async function fetchExamProgressByProfiles(
  profileIds: string[],
  projectId?: string
): Promise<ExamProgress[]> {
  void profileIds;
  void projectId;
  return [];
}

