/** Standardized position options for registration / profile */
export const POSITION_OPTIONS = [
  "ผู้อำนวยการสถานศึกษา",
  "รองผู้อำนวยการสถานศึกษา",
  "ครูผู้ช่วย",
  "ครู",
  "ครูชำนาญการ",
  "ครูชำนาญการพิเศษ",
  "ครูเชี่ยวชาญ",
  "ครูเชี่ยวชาญพิเศษ",
  "พนักงานราชการ",
  "ครูอัตราจ้าง",
] as const;

export type PositionOption = (typeof POSITION_OPTIONS)[number];

/** Dropdown sentinel. The typed title is stored in `profiles.position` and mirrored in `position_other`. */
export const POSITION_OTHER = "อื่นๆ";
export const POSITION_OTHER_MAX = 120;

export function isListedPosition(value: string): boolean {
  return (POSITION_OPTIONS as readonly string[]).includes(value.trim());
}

/** Restore the dropdown + textbox from stored columns, including legacy free text. */
export function positionFormState(
  position?: string | null,
  positionOther?: string | null
): { position: string; positionOther: string } {
  const listed = position?.trim() ?? "";
  if (listed && isListedPosition(listed)) {
    return { position: listed, positionOther: "" };
  }
  const custom = (positionOther || (listed && listed !== POSITION_OTHER ? listed : "")).trim();
  if (listed === POSITION_OTHER || custom) {
    return { position: POSITION_OTHER, positionOther: custom };
  }
  return { position: "", positionOther: "" };
}

/** Label to show in lists. Custom titles replace the "อื่นๆ" sentinel. */
export function displayPosition(position?: string | null, positionOther?: string | null): string {
  if ((position ?? "").trim() === POSITION_OTHER) return (positionOther ?? "").trim();
  return (position ?? "").trim();
}

/** Persist a listed title, or the typed title, into `profiles.position`. */
export function storedPositionFields(selected: string, custom: string): {
  position: string;
  position_other: string;
} {
  if (selected.trim() === POSITION_OTHER) {
    const typed = custom.trim();
    return { position: typed, position_other: typed };
  }
  return { position: selected.trim(), position_other: "" };
}

export const ICT_TALENT_COHORT_OPTIONS = [
  { value: "never", label: "ไม่เคย" },
  { value: "gen1", label: "เคยเป็นรุ่นที่ 1" },
  { value: "gen2", label: "เคยเป็นรุ่นที่ 2" },
  { value: "gen3", label: "เคยเป็นรุ่นที่ 3" },
  { value: "gen4", label: "เคยเป็นรุ่นที่ 4" },
  { value: "gen5", label: "เคยเป็นรุ่นที่ 5" },
] as const;

export type IctTalentCohort = (typeof ICT_TALENT_COHORT_OPTIONS)[number]["value"];

export type IctSurveyDomainKey =
  | "domain1_planning"
  | "domain2_teacher_dev"
  | "domain3_student_skills"
  | "domain4_infra"
  | "domain5_coordination"
  | "domain6_monitoring"
  | "sms_usage";

export type IctSurvey = {
  domain1_planning: string[];
  domain2_teacher_dev: string[];
  domain3_student_skills: string[];
  domain4_infra: string[];
  domain5_coordination: string[];
  domain6_monitoring: string[];
  /** Multi-select SMS usage answers */
  sms_usage: string[];
};

export const EMPTY_ICT_SURVEY: IctSurvey = {
  domain1_planning: [],
  domain2_teacher_dev: [],
  domain3_student_skills: [],
  domain4_infra: [],
  domain5_coordination: [],
  domain6_monitoring: [],
  sms_usage: [],
};

export const ICT_SURVEY_SECTIONS: {
  key: Exclude<IctSurveyDomainKey, "sms_usage">;
  title: string;
  options: string[];
}[] = [
  {
    key: "domain1_planning",
    title: "ด้านที่ 1: การวางแผนพัฒนาด้าน ICT (ตอบได้มากกว่า 1 ข้อ)",
    options: [
      "สำรวจปัญหาและความต้องการด้าน ICT",
      "ร่วมจัดทำแผนงาน/โครงการด้าน ICT",
      "วางแผนการจัดหา/พัฒนาอุปกรณ์ ระบบ หรือโครงสร้างพื้นฐาน",
      "วางแผนการนำเทคโนโลยีมาใช้ในการบริหารหรือการจัดการเรียนรู้",
      "ให้ข้อเสนอแนะด้าน ICT แก่ผู้บริหาร",
      "ยังไม่เคยมีส่วนร่วม",
    ],
  },
  {
    key: "domain2_teacher_dev",
    title: "ด้านที่ 2: การพัฒนาครูและบุคลากรด้าน ICT (ตอบได้มากกว่า 1 ข้อ)",
    options: [
      "การใช้เครื่องมือดิจิทัลในการปฏิบัติงาน",
      "การใช้เทคโนโลยีในการจัดการเรียนรู้ (Digital Learning)",
      "การสร้างสื่อดิจิทัล",
      "การใช้ AI เพื่อการศึกษา",
      "การใช้ระบบข้อมูล/ระบบสารสนเทศของสถานศึกษา",
      "การใช้เทคโนโลยีอย่างปลอดภัย",
      "ยังไม่เคย",
    ],
  },
  {
    key: "domain3_student_skills",
    title: "ด้านที่ 3: การพัฒนาทักษะดิจิทัลของนักเรียน (ตอบได้มากกว่า 1 ข้อ)",
    options: [
      "การใช้เทคโนโลยีเพื่อการเรียนรู้และค้นคว้า",
      "การสร้างสรรค์ผลงานหรือสื่อดิจิทัล",
      "การใช้ AI เพื่อการเรียนรู้",
      "Coding / Computational Thinking",
      "Digital Literacy",
      "การรู้เท่าทันสื่อและสารสนเทศ",
      "ความปลอดภัยและจริยธรรมในการใช้เทคโนโลยี",
      "ยังไม่เคยดำเนินการ",
    ],
  },
  {
    key: "domain4_infra",
    title: "ด้านที่ 4: การดูแลระบบและอุปกรณ์ ICT (ตอบได้มากกว่า 1 ข้อ)",
    options: [
      "คอมพิวเตอร์/Notebook/Tablet",
      "อุปกรณ์ห้องเรียน เช่น Projector / Smart TV",
      "ระบบเครือข่ายและอินเทอร์เน็ต",
      "Software / Application",
      "Website หรือช่องทางออนไลน์ของสถานศึกษา",
      "ระบบฐานข้อมูล/ระบบสารสนเทศ",
      "การแก้ไขปัญหาการใช้งาน ICT เบื้องต้น",
      "ยังไม่มีประสบการณ์",
    ],
  },
  {
    key: "domain5_coordination",
    title: "ด้านที่ 5: การประสานงานด้านเทคโนโลยี (ตอบได้มากกว่า 1 ข้อ)",
    options: [
      "ผู้บริหารสถานศึกษา",
      "ครูและบุคลากรภายในสถานศึกษา",
      "สำนักงานเขตพื้นที่การศึกษา",
      "สพฐ. หรือหน่วยงานต้นสังกัด",
      "บริษัท/ภาคเอกชน",
      "มหาวิทยาลัย/สถาบันการศึกษา",
      "เครือข่ายโรงเรียน",
      "ภาคีเครือข่าย CONNEXT ED",
      "ยังไม่เคยมีประสบการณ์",
    ],
  },
  {
    key: "domain6_monitoring",
    title: "ด้านที่ 6: การติดตาม ประเมิน และรายงานผล (ตอบได้มากกว่า 1 ข้อ)",
    options: [
      "เก็บรวบรวมข้อมูลการใช้งาน ICT",
      "บันทึกข้อมูลในระบบสารสนเทศ",
      "ติดตามผลการดำเนินงาน/โครงการ",
      "วิเคราะห์หรือสรุปข้อมูล",
      "จัดทำรายงานผลการดำเนินงาน",
      "นำเสนอข้อมูลต่อผู้บริหาร/ผู้เกี่ยวข้อง",
      "ใช้ข้อมูลเพื่อเสนอแนวทางปรับปรุงหรือพัฒนา",
      "ยังไม่เคยดำเนินการ",
    ],
  },
];

export const SMS_USAGE_OPTIONS = [
  "ใช้งานเป็นประจำและสามารถแนะนำผู้อื่นได้",
  "ใช้งานได้ด้วยตนเอง",
  "เคยใช้งานเป็นบางครั้ง",
  "รู้จักระบบแต่ยังไม่เคยใช้งาน",
  "ไม่เคยใช้งาน/ไม่รู้จักระบบ",
] as const;

/** Stable CSV keys + Thai headers for flattened ict_survey export. */
export const ICT_SURVEY_CSV_COLUMNS: {
  key: `survey_${IctSurveyDomainKey}`;
  surveyKey: IctSurveyDomainKey;
  label: string;
}[] = [
  {
    key: "survey_domain1_planning",
    surveyKey: "domain1_planning",
    label: "แบบสำรวจ ICT — ด้านที่ 1 การวางแผนพัฒนาด้าน ICT",
  },
  {
    key: "survey_domain2_teacher_dev",
    surveyKey: "domain2_teacher_dev",
    label: "แบบสำรวจ ICT — ด้านที่ 2 การพัฒนาครูและบุคลากรด้าน ICT",
  },
  {
    key: "survey_domain3_student_skills",
    surveyKey: "domain3_student_skills",
    label: "แบบสำรวจ ICT — ด้านที่ 3 การพัฒนาทักษะดิจิทัลของนักเรียน",
  },
  {
    key: "survey_domain4_infra",
    surveyKey: "domain4_infra",
    label: "แบบสำรวจ ICT — ด้านที่ 4 การดูแลระบบและอุปกรณ์ ICT",
  },
  {
    key: "survey_domain5_coordination",
    surveyKey: "domain5_coordination",
    label: "แบบสำรวจ ICT — ด้านที่ 5 การประสานงานด้านเทคโนโลยี",
  },
  {
    key: "survey_domain6_monitoring",
    surveyKey: "domain6_monitoring",
    label: "แบบสำรวจ ICT — ด้านที่ 6 การติดตาม ประเมิน และรายงานผล",
  },
  {
    key: "survey_sms_usage",
    surveyKey: "sms_usage",
    label: "แบบสำรวจ ICT — การใช้งานระบบ SMS",
  },
];

/** Join multi-select survey answers into a single CSV cell. */
export function formatSurveyAnswers(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((v) => String(v ?? "").trim()).filter(Boolean).join("; ");
  }
  if (typeof value === "string") return value.trim();
  if (value == null) return "";
  return String(value);
}

/** Flatten ict_survey JSON into survey_* columns (client-side fallback). */
export function flattenIctSurveyForCsv(survey: unknown): Record<string, string> {
  const obj =
    survey && typeof survey === "object" && !Array.isArray(survey)
      ? (survey as Record<string, unknown>)
      : {};
  const out: Record<string, string> = {};
  for (const col of ICT_SURVEY_CSV_COLUMNS) {
    out[col.key] = formatSurveyAnswers(obj[col.surveyKey]);
  }
  return out;
}
