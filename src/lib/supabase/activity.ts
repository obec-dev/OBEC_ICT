import { createClient } from "@/lib/supabase/client";
import { normalizeExternalUrl } from "@/lib/url";
import type {
  ActivityHub,
  ActivityTask,
  AuditorDocument,
  LiveMeeting,
  ScoreRankRow,
} from "@/types/ict";

function asObj(data: unknown): Record<string, unknown> {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    return data as Record<string, unknown>;
  }
  return {};
}

function asArr(data: unknown): unknown[] {
  return Array.isArray(data) ? data : [];
}

function mapTask(raw: unknown): ActivityTask {
  const m = asObj(raw);
  const status = String(m.submission_status ?? "not_submitted");
  return {
    id: String(m.id),
    activity_project_id: m.activity_project_id ? String(m.activity_project_id) : null,
    activity_project_name: m.activity_project_name == null ? null : String(m.activity_project_name),
    project_id: m.project_id ? String(m.project_id) : undefined,
    project_name: m.project_name == null ? null : String(m.project_name),
    report_name: String(m.report_name ?? ""),
    report_detail: m.report_detail == null ? null : String(m.report_detail),
    report_deadline: m.report_deadline ? String(m.report_deadline) : null,
    include_report_name: m.include_report_name !== false,
    include_detail: Boolean(m.include_detail),
    include_deadline: Boolean(m.include_deadline),
    include_video_url: m.include_video_url !== false,
    include_doc_url: m.include_doc_url !== false,
    score_points: Number(m.score_points) || 0,
    is_open: Boolean(m.is_open),
    activity_year: Number(m.activity_year) || new Date().getFullYear(),
    submission_status:
      status === "draft" || status === "pending" || status === "approved"
        ? status
        : status === "rejected"
          ? "draft"
          : "not_submitted",
    submitted_report_name: m.submitted_report_name ? String(m.submitted_report_name) : null,
    submitted_report_detail: m.submitted_report_detail ? String(m.submitted_report_detail) : null,
    video_url: m.video_url ? String(m.video_url) : null,
    doc_url: m.doc_url ? String(m.doc_url) : null,
    report_url: m.report_url ? String(m.report_url) : null,
    file_path: m.file_path ? String(m.file_path) : null,
    file_name: m.file_name ? String(m.file_name) : null,
    submitted_at: m.submitted_at ? String(m.submitted_at) : null,
    reviewer_note: m.reviewer_note ? String(m.reviewer_note) : null,
    submission_count: m.submission_count != null ? Number(m.submission_count) : undefined,
    approved_count: m.approved_count != null ? Number(m.approved_count) : undefined,
    pending_count: m.pending_count != null ? Number(m.pending_count) : undefined,
  };
}

function mapLive(raw: unknown): LiveMeeting {
  const m = asObj(raw);
  return {
    id: String(m.id),
    title: String(m.title ?? "Live meeting"),
    youtube_url: String(m.youtube_url ?? ""),
    window_start: String(m.window_start ?? ""),
    window_end: String(m.window_end ?? ""),
    score_points: Number(m.score_points) || 0,
    is_active: m.is_active !== false,
    in_window: Boolean(m.in_window),
    checked_in: Boolean(m.checked_in),
    checked_in_at: m.checked_in_at ? String(m.checked_in_at) : null,
  };
}

export async function fetchMyActivityHub(
  profileId: string,
  phone: string,
  year?: number
): Promise<ActivityHub> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("get_my_activity_hub", {
    p_profile_id: profileId,
    p_phone: phone,
    p_year: year ?? null,
  });
  if (error) throw new Error(error.message);
  const row = asObj(data);
  if (!row.ok) throw new Error(String(row.error ?? "โหลดกิจกรรมไม่สำเร็จ"));
  return {
    total_score: Number(row.total_score) || 0,
    activity_year: Number(row.activity_year) || new Date().getFullYear(),
    tasks_total: Number(row.tasks_total) || 0,
    tasks_approved: Number(row.tasks_approved) || 0,
    performance_pct: Number(row.performance_pct) || 0,
    school_name: row.school_name ? String(row.school_name) : null,
    district_id: row.district_id ? String(row.district_id) : null,
    district_name: row.district_name ? String(row.district_name) : null,
    tasks: asArr(row.tasks).map(mapTask),
    live_meetings: asArr(row.live_meetings).map(mapLive),
  };
}

export type ActivityTaskPayload = {
  report_name?: string;
  report_detail?: string;
  video_url?: string;
  doc_url?: string;
};

function normalizeTaskPayload(payload: ActivityTaskPayload): ActivityTaskPayload {
  return {
    report_name: payload.report_name,
    report_detail: payload.report_detail,
    video_url: payload.video_url ? normalizeExternalUrl(payload.video_url) : payload.video_url,
    doc_url: payload.doc_url ? normalizeExternalUrl(payload.doc_url) : payload.doc_url,
  };
}

export async function saveActivityTaskDraft(
  profileId: string,
  phone: string,
  taskId: string,
  payload: ActivityTaskPayload
) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("save_activity_task_draft", {
    p_profile_id: profileId,
    p_phone: phone,
    p_task_id: taskId,
    p_payload: normalizeTaskPayload(payload),
  });
  if (error) return { ok: false as const, error: error.message };
  const row = asObj(data);
  if (!row.ok) return { ok: false as const, error: String(row.error ?? "บันทึกแบบร่างไม่สำเร็จ") };
  return { ok: true as const };
}

export async function submitActivityTask(
  profileId: string,
  phone: string,
  taskId: string,
  payload: ActivityTaskPayload
) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("submit_activity_task", {
    p_profile_id: profileId,
    p_phone: phone,
    p_task_id: taskId,
    p_payload: normalizeTaskPayload(payload),
  });
  if (error) return { ok: false as const, error: error.message };
  const row = asObj(data);
  if (!row.ok) return { ok: false as const, error: String(row.error ?? "ส่งรายงานไม่สำเร็จ") };
  return { ok: true as const };
}

export async function checkinLiveMeeting(profileId: string, phone: string, meetingId: string) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("checkin_live_meeting", {
    p_profile_id: profileId,
    p_phone: phone,
    p_meeting_id: meetingId,
  });
  if (error) return { ok: false as const, error: error.message };
  const row = asObj(data);
  if (!row.ok) return { ok: false as const, error: String(row.error ?? "Check-in ไม่สำเร็จ") };
  return { ok: true as const, points: Number(row.points) || 0 };
}

export async function creditElearningVideo(profileId: string, phone: string, videoRowId: string) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("credit_elearning_video", {
    p_profile_id: profileId,
    p_phone: phone,
    p_video_row_id: videoRowId,
  });
  if (error) return { ok: false as const, error: error.message };
  const row = asObj(data);
  if (!row.ok) return { ok: false as const, error: String(row.error ?? "ให้คะแนนไม่สำเร็จ") };
  return { ok: true as const, points: Number(row.points) || 0, credited: Boolean(row.credited) };
}

export async function fetchScoreRanking(profileId: string, phone: string, limit = 10) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("get_score_ranking", {
    p_profile_id: profileId,
    p_phone: phone,
    p_limit: limit,
  });
  if (error) throw new Error(error.message);
  const row = asObj(data);
  if (!row.ok) throw new Error(String(row.error ?? "โหลดจัดอันดับไม่สำเร็จ"));
  const top: ScoreRankRow[] = asArr(row.top).map((item) => {
    const m = asObj(item);
    return {
      rank: Number(m.rank) || 0,
      profile_id: String(m.profile_id ?? ""),
      first_name: m.first_name ? String(m.first_name) : "",
      last_name: m.last_name ? String(m.last_name) : "",
      school_name: m.school_name ? String(m.school_name) : null,
      total_score: Number(m.total_score) || 0,
      is_me: Boolean(m.is_me),
    };
  });
  const me = asObj(row.me);
  return {
    top,
    me: {
      profile_id: String(me.profile_id ?? profileId),
      total_score: Number(me.total_score) || 0,
      rank: me.rank != null ? Number(me.rank) : null,
      in_top: Boolean(me.in_top),
    },
  };
}

export type AuditorActivityDashboard = {
  needs_district: boolean;
  district_id: string | null;
  district_name?: string | null;
  stats: { schools: number; users: number; tasks: number; pending_submissions: number };
  projects: { project_id: string; project_name: string; passed: number; not_passed: number }[];
};

export async function fetchAuditorActivityDashboard(
  loginEmail: string
): Promise<AuditorActivityDashboard> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("auditor_activity_dashboard", {
    p_login_email: loginEmail,
  });
  if (error) throw new Error(error.message);
  const row = asObj(data);
  const stats = asObj(row.stats);
  return {
    needs_district: Boolean(row.needs_district),
    district_id: row.district_id ? String(row.district_id) : null,
    district_name: row.district_name ? String(row.district_name) : null,
    stats: {
      schools: Number(stats.schools) || 0,
      users: Number(stats.users) || 0,
      tasks: Number(stats.tasks) || 0,
      pending_submissions: Number(stats.pending_submissions) || 0,
    },
    projects: asArr(row.projects).map((item) => {
      const m = asObj(item);
      return {
        project_id: String(m.project_id ?? ""),
        project_name: String(m.project_name ?? m.project_id ?? ""),
        passed: Number(m.passed) || 0,
        not_passed: Number(m.not_passed) || 0,
      };
    }),
  };
}

export type AuditorRadarUser = {
  profile_id: string;
  first_name: string;
  last_name: string;
  status?: string | null;
  done?: number | null;
  total?: number | null;
};

export type AuditorRadarSchool = {
  school_id: string;
  school_name: string;
  users: AuditorRadarUser[];
};

export async function fetchAuditorSchoolRadar(loginEmail: string, taskId?: string | null) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("auditor_school_radar", {
    p_login_email: loginEmail,
    p_task_id: taskId || null,
  });
  if (error) throw new Error(error.message);
  const row = asObj(data);
  if (row.ok === false) throw new Error(String(row.error ?? "โหลด radar ไม่สำเร็จ"));
  const tasks = asArr(row.tasks).map((item) => {
    const m = asObj(item);
    return {
      id: String(m.id),
      report_name: String(m.report_name ?? ""),
      activity_project_name: m.activity_project_name ? String(m.activity_project_name) : null,
      project_id: String(m.project_id ?? ""),
    };
  });
  const schools: AuditorRadarSchool[] = asArr(row.schools).map((item) => {
    const m = asObj(item);
    return {
      school_id: String(m.school_id ?? ""),
      school_name: String(m.school_name ?? ""),
      users: asArr(m.users).map((u) => {
        const x = asObj(u);
        return {
          profile_id: String(x.profile_id ?? ""),
          first_name: String(x.first_name ?? ""),
          last_name: String(x.last_name ?? ""),
          status: x.status != null ? String(x.status) : null,
          done: x.done != null ? Number(x.done) : null,
          total: x.total != null ? Number(x.total) : null,
        };
      }),
    };
  });
  return {
    district_id: row.district_id ? String(row.district_id) : null,
    tasks_total: Number(row.tasks_total) || 0,
    tasks,
    schools,
  };
}

export type AuditorPendingRow = {
  id: string;
  task_id: string;
  report_name: string;
  project_id: string;
  score_points: number;
  profile_id: string;
  first_name: string;
  last_name: string;
  school_name: string;
  video_url?: string | null;
  doc_url?: string | null;
  report_url?: string | null;
  file_path?: string | null;
  file_name?: string | null;
  submitted_at?: string | null;
  status: string;
};

function mapPendingRow(item: unknown): AuditorPendingRow {
  const m = asObj(item);
  return {
    id: String(m.id),
    task_id: String(m.task_id ?? ""),
    report_name: String(m.report_name ?? ""),
    project_id: String(m.project_id ?? m.activity_project_name ?? ""),
    score_points: Number(m.score_points) || 0,
    profile_id: String(m.profile_id ?? ""),
    first_name: String(m.first_name ?? ""),
    last_name: String(m.last_name ?? ""),
    school_name: String(m.school_name ?? ""),
    video_url: m.video_url ? String(m.video_url) : null,
    doc_url: m.doc_url ? String(m.doc_url) : null,
    report_url: m.report_url ? String(m.report_url) : null,
    file_path: m.file_path ? String(m.file_path) : null,
    file_name: m.file_name ? String(m.file_name) : null,
    submitted_at: m.submitted_at ? String(m.submitted_at) : null,
    status: String(m.status ?? "pending"),
  };
}

export async function fetchAuditorPending(
  loginEmail: string,
  page = 1,
  pageSize = 10
): Promise<{
  rows: AuditorPendingRow[];
  total: number;
  auditor_can_approve: boolean;
}> {
  const offset = Math.max(0, (page - 1) * pageSize);
  const supabase = createClient();
  const { data, error } = await supabase.rpc("auditor_list_pending_submissions", {
    p_login_email: loginEmail,
    p_limit: pageSize,
    p_offset: offset,
  });
  if (error) throw new Error(error.message);
  const row = asObj(data);
  if (row.ok === false) throw new Error(String(row.error ?? "โหลดคิวอนุมัติไม่สำเร็จ"));
  return {
    rows: asArr(row.rows).map(mapPendingRow),
    total: Number(row.total) || 0,
    auditor_can_approve: row.auditor_can_approve !== false,
  };
}

export type AuditorDistrictSchoolUser = {
  profile_id: string;
  first_name: string;
  last_name: string;
  score: number;
  recent_activity_at: string | null;
};

export type AuditorDistrictSchool = {
  school_id: string;
  school_name: string;
  province: string;
  user_count: number;
  is_registered: boolean;
  max_user_score: number;
  users: AuditorDistrictSchoolUser[];
};

export async function fetchAuditorDistrictSchools(
  loginEmail: string,
  districtId?: string | null
): Promise<AuditorDistrictSchool[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("auditor_district_schools", {
    p_login_email: loginEmail,
    p_district_id: districtId ?? null,
  });
  if (error) throw new Error(error.message);
  const row = asObj(data);
  if (row.ok === false) throw new Error(String(row.error ?? "โหลดโรงเรียนไม่สำเร็จ"));
  return asArr(row.schools).map((item) => {
    const m = asObj(item);
    return {
      school_id: String(m.school_id ?? ""),
      school_name: String(m.school_name ?? ""),
      province: m.province ? String(m.province) : "",
      user_count: Number(m.user_count) || 0,
      is_registered: Boolean(m.is_registered),
      max_user_score: Number(m.max_user_score) || 0,
      users: asArr(m.users).map((u) => {
        const x = asObj(u);
        return {
          profile_id: String(x.profile_id ?? ""),
          first_name: String(x.first_name ?? ""),
          last_name: String(x.last_name ?? ""),
          score: Number(x.score) || 0,
          recent_activity_at: x.recent_activity_at ? String(x.recent_activity_at) : null,
        };
      }),
    };
  });
}

export async function auditorReviewSubmission(
  loginEmail: string,
  submissionId: string,
  approve: boolean,
  note?: string
) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("auditor_review_submission", {
    p_login_email: loginEmail,
    p_submission_id: submissionId,
    p_approve: approve,
    p_note: note ?? null,
  });
  if (error) return { ok: false as const, error: error.message };
  const row = asObj(data);
  if (!row.ok) return { ok: false as const, error: String(row.error ?? "บันทึกไม่สำเร็จ") };
  return { ok: true as const };
}

export async function fetchAuditorDocuments(loginEmail: string): Promise<AuditorDocument[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("auditor_list_documents", {
    p_login_email: loginEmail,
  });
  if (error) throw new Error(error.message);
  const row = asObj(data);
  if (row.ok === false) throw new Error(String(row.error ?? "โหลดเอกสารไม่สำเร็จ"));
  return asArr(row.documents).map((item) => {
    const m = asObj(item);
    return {
      id: String(m.id),
      title: String(m.title ?? ""),
      file_url: m.file_url ? String(m.file_url) : null,
      created_at: m.created_at ? String(m.created_at) : undefined,
    };
  });
}
