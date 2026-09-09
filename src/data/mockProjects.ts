import type { LearningProject, ProjectQuestion, ProjectVideo } from "@/types/ict";

export const DEFAULT_PROJECT_ID = "ict-talent-2026";

/** Single-site: one canonical project (extra mock rows removed). */
export const MOCK_PROJECTS: LearningProject[] = [
  {
    id: DEFAULT_PROJECT_ID,
    name: "โครงการพัฒนาศักยภาพตัวแทน ICT Talent 2026",
    description:
      "วิชาหลักสำหรับครูและบุคลากรตัวแทน ICT Talent เพื่อเตรียมความพร้อมในการนำเทคโนโลยีดิจิทัลไปประยุกต์ใช้ในโรงเรียน",
    is_active: true,
    reg_enabled: true,
    exam_enabled: true,
    enable_results_visibility: false,
    pass_threshold_mode: "percent",
    pass_threshold_value: 60,
    pass_threshold: 60,
    max_score: 5,
    created_at: new Date().toISOString(),
  },
];

export const MOCK_VIDEOS: ProjectVideo[] = [
  {
    id: "vid-1",
    project_id: DEFAULT_PROJECT_ID,
    title: "บทเรียนหลัก: การเป็นตัวแทน ICT Talent และแนวทางการพัฒนาสื่อดิจิทัล",
    video_url: "https://www.youtube.com/watch?v=YaG5SAw1n0c",
    video_id: "YaG5SAw1n0c",
    is_mandatory: true,
    order_index: 1,
  },
];

export const MOCK_QUESTIONS: ProjectQuestion[] = [
  {
    id: "q1",
    project_id: DEFAULT_PROJECT_ID,
    prompt: "บทบาทหลักของตัวแทน ICT Talent ประจำโรงเรียนคือข้อใด",
    type: "mcq",
    options: [
      "ดูแลเฉพาะเครื่องพิมพ์ในห้องพักครู",
      "ประสานงานระบบดิจิทัลและการใช้ ICT เพื่อการเรียนรู้ในโรงเรียน",
      "จัดซื้อครุภัณฑ์ทุกประเภทโดยไม่ต้องผ่านผู้บริหาร",
      "สอนวิชาคอมพิวเตอร์แทนครูผู้สอนทุกชั้น",
    ],
    points: 1,
    order_index: 1,
  },
  {
    id: "q2",
    project_id: DEFAULT_PROJECT_ID,
    prompt: "ข้อใดสอดคล้องกับหลัก PDPA เมื่อเก็บข้อมูลผู้เรียน",
    type: "mcq",
    options: [
      "เก็บข้อมูลเกินความจำเป็นเพื่อใช้ในอนาคต",
      "เผยแพร่รายชื่อนักเรียนพร้อมเลขบัตรประชาชนในกลุ่มไลน์",
      "เก็บเท่าที่จำเป็น แจ้งวัตถุประสงค์ และขอความยินยอมตามกฎหมาย",
      "ส่งไฟล์ข้อมูลไปยังบุคคลภายนอกได้ทันทีหากสะดวก",
    ],
    points: 1,
    order_index: 2,
  },
  {
    id: "q3",
    project_id: DEFAULT_PROJECT_ID,
    prompt: "เมื่อพบอีเมลฟิชชิงส่งถึงครูในโรงเรียน ควรทำอย่างไรเป็นอันดับแรก",
    type: "mcq",
    options: [
      "คลิกลิงก์เพื่อตรวจสอบว่าเป็นของจริงหรือไม่",
      "ส่งต่ออีเมลนั้นให้เพื่อนร่วมงานทุกคน",
      "ไม่คลิกลิงก์ แจ้งผู้เกี่ยวข้อง และลบหรือรายงานตามแนวทางของโรงเรียน",
      "ตอบกลับผู้ส่งเพื่อขอข้อมูลเพิ่มเติม",
    ],
    points: 1,
    order_index: 3,
  },
  {
    id: "q4",
    project_id: DEFAULT_PROJECT_ID,
    prompt: "สรุปสั้น ๆ ว่าจะวางแผนสนับสนุนครูในการใช้ ICT เพื่อการสอนในภาคเรียนนี้ได้อย่างไร",
    type: "open_ended",
    points: 2,
    order_index: 4,
  },
];
