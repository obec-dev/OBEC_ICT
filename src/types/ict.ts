export type School = {
  school_id: string;
  school_name: string;
  area_zone: string;
  province: string;
  is_registered: boolean;
  district_id?: string;
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
  id: string; // profile_id (เลขบัตรประชาชน)
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
  duty?: string;
  line_id?: string;
  email?: string;
  created_at: string;
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

export type ExamProgress = {
  candidate_id: string;
  project_id?: string;
  answers: Record<string, string>;
  status: "draft" | "submitted";
  score?: number;
  passed?: boolean;
  graded_at?: string;
  updated_at: string;
};

export type QuestionType = "mcq" | "open_ended" | "short";

export type ExamQuestion = {
  id: string;
  project_id?: string;
  prompt: string;
  type: QuestionType;
  options?: string[];
  correct_answer?: string;
  model_answer?: string;
  points?: number;
  order_index?: number;
};

/** Sanitized version for candidates during exams to prevent anti-cheating inspection */
export type PublicExamQuestion = Omit<ExamQuestion, "correct_answer" | "model_answer">;

export type LearningProject = {
  id: string; // project_id e.g. "ict-talent-2026"
  name: string;
  description: string;
  reg_start?: string | null;
  reg_end?: string | null;
  reg_enabled?: boolean;
  exam_start?: string | null;
  exam_end?: string | null;
  exam_enabled?: boolean;
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
  | { kind: "admin"; admin: AdminUser; token: string };

export type IctPersistedState = {
  watchProgress: WatchProgress[];
  examProgress: ExamProgress[];
  projects?: LearningProject[];
  videos?: ProjectVideo[];
  questions?: ProjectQuestion[];
};


