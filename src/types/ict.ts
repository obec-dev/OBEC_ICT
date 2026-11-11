export type PortalRole = "user" | "school_admin";

export type ExecutiveKind = "business" | "audit";

export type BusinessUser = {
  id: string;
  login_email: string;
  display_name: string;
  position?: string | null;
  must_set_password?: boolean;
};

export type AuditUser = {
  id: string;
  login_email: string;
  display_name: string;
  position?: string | null;
  assigned_districts: string[];
  must_set_password?: boolean;
};

export type School = {
  school_id: string;
  school_name: string;
  area_zone: string;
  province: string;
  is_registered: boolean;
  district_id?: string;
  /** Partner network label (optional) */
  partner?: string | null;
  /** Number of registered candidates (profiles) at this school */
  registered_count?: number;
  school_director_name?: string | null;
  school_director_position?: string | null;
  updated_by_national_id?: string | null;
  updated_by_name?: string | null;
  school_profile_updated_at?: string | null;
};

/** Aggregated per-district stats for dashboard (no full school list) */
export type DistrictStat = {
  district_id: string;
  district_name: string;
  province: string;
  total_schools: number;
  registered_schools: number;
};

export type SchoolTotals = {
  total: number;
  registered: number;
  zones: number;
};

export type Candidate = {
  id: string; // immutable 13-digit profile_id (generated on registration)
  school_id: string;
  school_name?: string;
  /** Thai given name (legacy primary display) */
  first_name: string;
  /** Thai surname */
  last_name: string;
  full_name: string;
  phone: string;
  remark?: string;
  title_key?: string;
  title_en?: string;
  title_th?: string;
  title_other_en?: string;
  title_other_th?: string;
  eng_first_name?: string;
  eng_last_name?: string;
  birth_date?: string;
  gender?: string;
  position?: string;
  /** Free-text title when position is "อื่นๆ" */
  position_other?: string;
  duty?: string;
  line_id?: string;
  /** @deprecated Prefer contact_email — kept for legacy UI bindings */
  email?: string;
  /** Personal contact email (candidate-editable) */
  contact_email?: string;
  /** Login ID email (admin-only change; used for authentication) */
  login_email?: string;
  /** School geography (from admin search join) */
  province?: string;
  district_id?: string;
  district_name?: string;
  /** Designated school data manager (one per school) */
  is_school_admin?: boolean;
  /** Portal access role for candidates only */
  portal_role?: PortalRole;
  /** Suspended accounts cannot log in */
  is_active?: boolean;
  /** Soft-delete timestamp (hidden from standard views) */
  deleted_at?: string | null;
  /** Must complete password setup before portal access */
  must_set_password?: boolean;
  ict_talent_cohort?: string;
  ict_survey?: Record<string, unknown>;
  /** ชื่อ-นามสกุล ผู้บังคับบัญชา/ผู้อนุมัติ (from registration) */
  approver?: string | null;
  /** ตำแหน่งผู้บังคับบัญชา/ผู้อนุมัติ (from registration) */
  approver_position?: string | null;
  created_at: string;
};

export type MissionValidationType = "url_submission" | "exam_completion" | "manual";

export type Mission = {
  id: string;
  title: string;
  description?: string | null;
  sequence_order: number;
  validation_type: MissionValidationType;
  is_active?: boolean;
};

export type UserMissionProgress = Mission & {
  status: "pending" | "completed";
  submitted_data?: Record<string, unknown>;
  completed_at?: string | null;
};

export type SchoolProfile = {
  school_id: string;
  school_name: string;
  province?: string;
  school_director_name?: string | null;
  school_director_position?: string | null;
  updated_by_national_id?: string | null;
  updated_by_name?: string | null;
  school_profile_updated_at?: string | null;
};

export type WatchProgress = {
  candidate_id: string;
  video_id: string;
  project_id?: string;
  watched_seconds: number;
  duration_seconds: number;
  completed: boolean;
  last_updated: string;
};

export type LessonSubmissionStatus = {
  status: "submitted";
  submitted_at?: string;
};

export type ExamProgress = {
  candidate_id: string;
  project_id?: string;
  answers: Record<string, string>;
  status: "draft" | "submitted";
  /** Per-lesson (section_id) submit map — independent of overall status until all lessons are in. */
  lesson_submissions?: Record<string, LessonSubmissionStatus>;
  score?: number;
  passed?: boolean;
  graded_at?: string;
  updated_at: string;
};

export type QuestionType = "mcq" | "open_ended" | "short";

export type ExamQuestion = {
  id: string;
  project_id?: string;
  /** Permanent code. Assigned once; never follows display order. */
  question_code?: string | null;
  prompt: string;
  type: QuestionType;
  options?: string[];
  correct_answer?: string;
  model_answer?: string;
  /** Optional diagram / reference image shown to candidates during the exam */
  image_url?: string | null;
  points?: number;
  order_index?: number;
  /** When true, candidate must answer before exam submit */
  answer_required?: boolean;
  section_id?: string | null;
  section_title?: string | null;
  section_description?: string | null;
  section_order?: number | null;
};

export type ExamSection = {
  id: string;
  project_id: string;
  title: string;
  description?: string | null;
  section_order: number;
};

/** Sanitized version for candidates during exams to prevent anti-cheating inspection */
export type PublicExamQuestion = Omit<ExamQuestion, "correct_answer" | "model_answer">;

export type PassThresholdMode = "percent" | "score";

export type LearningProject = {
  id: string; // project_id e.g. "ict-talent-2026"
  name: string;
  description: string;
  /** Master switch — inactive hides registration, exam, learn, and cover */
  is_active?: boolean;
  /** Optional cover/banner URL for homepage hero card */
  cover_url?: string | null;
  reg_start?: string | null;
  reg_end?: string | null;
  reg_enabled?: boolean;
  exam_start?: string | null;
  exam_end?: string | null;
  exam_enabled?: boolean;
  /** When true, candidates can see pass/fail results and celebration. */
  enable_results_visibility?: boolean;
  /** How pass_threshold_value is interpreted. */
  pass_threshold_mode?: PassThresholdMode;
  /** Percentage (0–100) or absolute score, depending on mode. */
  pass_threshold_value?: number;
  /**
   * @deprecated Prefer pass_threshold_value + pass_threshold_mode.
   * Kept in sync for older rows / clients.
   */
  pass_threshold?: number;
  max_score?: number;
  created_at?: string;
  updated_at?: string;
};

export type ProjectVideo = {
  id: string;
  project_id: string;
  title: string;
  video_url: string;
  video_id: string; // YouTube video ID extracted from url or string
  is_mandatory: boolean; // Flag to indicate if video is mandatory for exam
  order_index?: number;
  /** Explicit 1:1 link to exam_sections.id (preferred over order pairing) */
  exam_section_id?: string | null;
  /** Points credited once when watch is completed */
  score_points?: number;
  created_at?: string;
};

export type ActivitySubmissionStatus =
  | "not_submitted"
  | "draft"
  | "pending"
  | "approved"
  /** @deprecated mapped to draft after activity_draft_notify_v1 */
  | "rejected";

export type AppNotification = {
  id: string;
  title: string;
  body: string;
  kind: string;
  link_path?: string | null;
  meta?: Record<string, unknown>;
  created_at: string;
  read_at?: string | null;
  is_unread: boolean;
};

export type NewsImage = {
  id?: string;
  image_url: string;
  caption?: string | null;
  sort_order?: number;
};

export type NewsListItem = {
  id: string;
  slug: string;
  title: string;
  summary?: string | null;
  hero_image_url?: string | null;
  hashtags: string[];
  published_at?: string | null;
  sort_order: number;
  is_published?: boolean;
  image_count?: number;
  updated_at?: string;
};

export type NewsArticle = NewsListItem & {
  body: string;
  images: NewsImage[];
};

export type ActivityProject = {
  id: string;
  name: string;
  created_at?: string;
};

export type ActivityTask = {
  id: string;
  activity_project_id?: string | null;
  activity_project_name?: string | null;
  /** @deprecated learning project id — unused for new tasks */
  project_id?: string;
  project_name?: string | null;
  report_name: string;
  report_detail?: string | null;
  report_deadline?: string | null;
  include_report_name?: boolean;
  include_detail?: boolean;
  include_deadline?: boolean;
  include_video_url?: boolean;
  include_doc_url?: boolean;
  link_required?: boolean;
  file_required?: boolean;
  score_points: number;
  is_open: boolean;
  activity_year: number;
  submission_status?: ActivitySubmissionStatus;
  submitted_report_name?: string | null;
  submitted_report_detail?: string | null;
  video_url?: string | null;
  doc_url?: string | null;
  report_url?: string | null;
  file_path?: string | null;
  file_name?: string | null;
  submitted_at?: string | null;
  reviewer_note?: string | null;
  submission_count?: number;
  approved_count?: number;
  pending_count?: number;
};

export type LiveMeeting = {
  id: string;
  title: string;
  youtube_url: string;
  window_start: string;
  window_end: string;
  score_points: number;
  is_active: boolean;
  in_window?: boolean;
  checked_in?: boolean;
  checked_in_at?: string | null;
};

export type ScoreRankRow = {
  rank: number;
  profile_id: string;
  first_name?: string;
  last_name?: string;
  school_name?: string | null;
  total_score: number;
  is_me?: boolean;
};

export type ActivityHub = {
  total_score: number;
  activity_year: number;
  tasks_total: number;
  tasks_approved: number;
  performance_pct: number;
  school_name?: string | null;
  district_id?: string | null;
  district_name?: string | null;
  tasks: ActivityTask[];
  live_meetings: LiveMeeting[];
};

export type AuditorDocument = {
  id: string;
  district_id?: string;
  title: string;
  file_url?: string | null;
  file_path?: string | null;
  created_at?: string;
};

export type ProjectQuestion = ExamQuestion;

export type AdminRole = "super_admin" | "admin";

export type AdminUser = {
  admin_id: string;
  username: string;
  full_name: string;
  role: AdminRole;
  must_change_password: boolean;
  is_active?: boolean;
  created_at?: string;
};

export type SessionUser =
  | { kind: "candidate"; candidate: Candidate }
  | { kind: "admin"; admin: AdminUser; token: string }
  | { kind: "business"; user: BusinessUser }
  | { kind: "audit"; user: AuditUser };

export type IctPersistedState = {
  watchProgress: WatchProgress[];
  examProgress: ExamProgress[];
  projects?: LearningProject[];
  videos?: ProjectVideo[];
  questions?: ProjectQuestion[];
};


