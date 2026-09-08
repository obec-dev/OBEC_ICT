import type { LearningProject, ProjectQuestion, ProjectVideo } from "@/types/ict";

export const DEFAULT_PROJECT_ID = "ict-talent-2026";

export const MOCK_PROJECTS: LearningProject[] = [
  {
    id: "ict-talent-2026",
    name: "โครงการพัฒนาศักยภาพตัวแทน ICT Talent 2026",
    description: "วิชาหลักสำหรับครูและบุคลากรตัวแทน ICT Talent เพื่อเตรียมความพร้อมในการนำเทคโนโลยีดิจิทัลไปประยุกต์ใช้ในโรงเรียน",
    reg_enabled: true,
    exam_enabled: true,
    pass_threshold: 3,
    max_score: 5,
    created_at: new Date().toISOString(),
  },
  {
    id: "pdpa-cyber-security",
    name: "วิชาความมั่นคงปลอดภัยไซเบอร์และ PDPA ในสถานศึกษา",
    description: "ความรู้พื้นฐานเกี่ยวกับการคุ้มครองข้อมูลส่วนบุคคลและแนวปฏิบัติในการรับมือภัยคุกคามทางไซเบอร์",
    reg_enabled: true,
    exam_enabled: true,
    pass_threshold: 3,
    max_score: 5,
    created_at: new Date().toISOString(),
  },
];

export const MOCK_VIDEOS: ProjectVideo[] = [
  {
    id: "vid-1",
    project_id: "ict-talent-2026",
    title: "บทเรียนหลัก: การเป็นตัวแทน ICT Talent และแนวทางการพัฒนาสื่อดิจิทัล",
    video_url: "https://www.youtube.com/watch?v=YaG5SAw1n0c",
    video_id: "YaG5SAw1n0c",
    is_mandatory: true,
    order_index: 1,
  },
  {
    id: "vid-2",
    project_id: "pdpa-cyber-security",
    title: "บทเรียน PDPA: กฎหมายคุ้มครองข้อมูลส่วนบุคคลสำหรับครูและสถานศึกษา",
    video_url: "https://www.youtube.com/watch?v=YaG5SAw1n0c",
    video_id: "YaG5SAw1n0c",
    is_mandatory: false,
    order_index: 1,
  },
];

export const MOCK_QUESTIONS: ProjectQuestion[] = [
  {
    id: "q1",
    project_id: "ict-talent-2026",
    prompt: "บทบาทหลักของตัวแทน ICT Talent ประจำโรงเรียนคือข้อใด",
    type: "mcq",
    options: [
      "ดูแลเฉพาะเครื่องพิมพ์ในห้องพักครู",
      "ประสานงานระบบดิจิทัลและการใช้ ICT เพื่อการเรียนรู้ในโรงเรียน",
      "จัดซื้อครุภัณฑ์ทุกประเภทโดยไม่ต้องผ่านผู้บริหาร",
      "สอนวิชาคอมพิวเตอร์แทนครูผู้สอนทุกชั้น",
    ],
    correct_answer: "ประสานงานระบบดิจิทัลและการใช้ ICT เพื่อการเรียนรู้ในโรงเรียน",
    points: 1,
    order_index: 1,
  },
  {
    id: "q2",
    project_id: "ict-talent-2026",
    prompt: "ข้อใดสอดคล้องกับหลัก PDPA เมื่อเก็บข้อมูลผู้เรียน",
    type: "mcq",
    options: [
      "เก็บข้อมูลเกินความจำเป็นเพื่อใช้ในอนาคต",
      "เผยแพร่รายชื่อนักเรียนพร้อมเลขบัตรประชาชนในกลุ่มไลน์",
      "เก็บเท่าที่จำเป็น แจ้งวัตถุประสงค์ และขอความยินยอมตามกฎหมาย",
      "ส่งไฟล์ข้อมูลไปยังบุคคลภายนอกได้ทันทีหากสะดวก",
    ],
    correct_answer: "เก็บเท่าที่จำเป็น แจ้งวัตถุประสงค์ และขอความยินยอมตามกฎหมาย",
    points: 1,
    order_index: 2,
  },
  {
    id: "q3",
    project_id: "ict-talent-2026",
    prompt: "เมื่อพบอีเมลฟิชชิงส่งถึงครูในโรงเรียน ควรทำอย่างไรเป็นอันดับแรก",
    type: "mcq",
    options: [
      "คลิกลิงก์เพื่อตรวจสอบว่าเป็นของจริงหรือไม่",
      "ส่งต่ออีเมลนั้นให้เพื่อนร่วมงานทุกคน",
      "ไม่คลิกลิงก์ แจ้งผู้เกี่ยวข้อง และลบหรือรายงานตามแนวทางของโรงเรียน",
      "ตอบกลับผู้ส่งเพื่อขอข้อมูลเพิ่มเติม",
    ],
    correct_answer: "ไม่คลิกลิงก์ แจ้งผู้เกี่ยวข้อง และลบหรือรายงานตามแนวทางของโรงเรียน",
    points: 1,
    order_index: 3,
  },
  {
    id: "q4",
    project_id: "ict-talent-2026",
    prompt: "สรุปสั้น ๆ ว่าจะวางแผนสนับสนุนครูในการใช้ ICT เพื่อการสอนในภาคเรียนนี้ได้อย่างไร",
    type: "open_ended",
    model_answer: "ระบุแนวทางการอบรม/สนับสนุนเทคโนโลยีให้ครูในโรงเรียน อย่างน้อย 2 ประโยค",
    points: 2,
    order_index: 4,
  },
];
