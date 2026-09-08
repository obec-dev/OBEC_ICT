🚀 National School Challenge & Showcase: Project Blueprint (Solo Dev Version)

Project Lead: Joker (Solo Developer)
Tech Stack: Supabase (Auth/DB/Edge Functions), Cloudflare R2 (Storage), Next.js (Frontend)

🏗️ Step 1: Foundation & Database Design (Supabase)

เป้าหมาย: ออกแบบตารางให้รองรับโครงสร้าง 4 ระดับ (Student -> School -> Supervisor -> District) และระบบ Flag

📋 Database Schema (SQL for AI Prompt)

-- 1. Table: Profiles (User Personal)
CREATE TABLE profiles (
  id uuid REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  full_name text,
  sub_role text CHECK (sub_role IN ('student', 'teacher', 'director')),
  training_flag boolean DEFAULT false,
  school_id uuid REFERENCES schools(id),
  district_id uuid, -- Reference to Educational Area
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now())
);

-- 2. Table: Schools (User School)
CREATE TABLE schools (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  school_code text UNIQUE,
  school_name text,
  district_name text,
  province text
);

-- 3. Table: Teams & Submissions
CREATE TABLE project_teams (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  school_id uuid REFERENCES schools(id),
  team_name text,
  status text DEFAULT 'draft', -- draft, submitted
  pdf_url text, -- Path in Cloudflare R2
  video_url text, -- Link to Google Drive
  video_snapshot jsonb, -- Metadata from Google API (MD5, LastModified)
  created_at timestamp with time zone DEFAULT now()
);

-- 4. Table: Team Members (Link Profiles to Teams)
CREATE TABLE team_members (
  team_id uuid REFERENCES project_teams(id),
  user_id uuid REFERENCES profiles(id),
  PRIMARY KEY (team_id, user_id)
);


🔑 Step 2: Authentication & Role-Based Access (RLS)

เป้าหมาย: ใช้ Supabase Auth และล็อคสิทธิ์ให้แก้ไขงานตัวเองได้เท่านั้น

Prompt สำหรับ AI:

"ช่วยเขียน Supabase Row Level Security (RLS) สำหรับตาราง project_teams โดยให้สิทธิ์ 'INSERT/UPDATE' เฉพาะ User ที่มี school_id ตรงกัน และอนุญาตให้ 'SELECT' เฉพาะคนที่มี role เป็น 'referee' ในเขตพื้นที่เดียวกันเท่านั้น"

📦 Step 3: Storage Integration (Cloudflare R2)

เป้าหมาย: ตั้งค่าเก็บ PDF ที่ R2 เพื่อประหยัดค่า Egress

Action Plan:

สร้าง Bucket ใน Cloudflare R2 (ชื่อ school-challenge-assets)

ตั้งค่า CORS ให้รองรับ Domain ของเว็บพี่

ใช้ @aws-sdk/client-s3 ในโปรเจกต์ (R2 ใช้ S3 Protocol)

Logic: หน้าบ้านอัปโหลดตรงไปที่ R2 ผ่าน Presigned URL (ขอ URL จาก Supabase Edge Function)

🛠️ Step 4: Core Logic Development

Phase 4.1: Training & Flag Flow

หน้าแสดงคลิปวิดีโอกติกา

เมื่อดูจบ (หรือทำ Quiz ผ่าน) ให้เรียก RPC หรือ Edge Function เพื่ออัปเดต training_flag = true

Phase 4.2: Team Building (The Criteria)

ระบบค้นหาเพื่อนร่วมโรงเรียน (Filter profiles ที่มี school_id เดียวกัน และ training_flag = true)

ตรวจสอบจำนวนสมาชิก (เช่น ต้องมีนักเรียนอย่างน้อย 2 คน, ครู 1 คน) ก่อนยอมให้สร้างทีม

Phase 4.3: Submission & Autosave

Autosave: ใช้ useEffect ใน React คอยตรวจจับการเปลี่ยนแปลงของ Form และใช้ supabase.from('project_teams').upsert() ทุกๆ 3-5 วินาที

Status: ปุ่ม "ส่งผลงาน" จะเปลี่ยน status จาก draft เป็น submitted และล็อคการแก้ไข

🔒 Step 5: Google Drive Validation Service

เป้าหมาย: ป้องกันการแอบเปลี่ยนไฟล์หลังปิดรับสมัคร

Prompt สำหรับ AI (Edge Function):

"สร้าง Supabase Edge Function เพื่อรับ Google Drive URL แล้วทำการเรียก Google Drive API เพื่อดึง md5Checksum และ mimeType มาตรวจสอบ หากเป็นไฟล์วิดีโอ ให้บันทึกค่าเหล่านั้นลงในตาราง project_teams เพื่อทำ Snapshot"

📈 Step 6: Web Showcase (The Social Part)

เป้าหมาย: นำข้อมูลมาแสดงผล

ดึงข้อมูลจากตาราง project_teams ที่มีสถานะ submitted มาแสดงผลแบบ Grid

อนุญาตให้ User ที่เป็นเจ้าของผลงาน เข้ามาอัปเดต description เพิ่มเติมได้ (ผ่านระบบ Showcase)

🚀 Step 7: Scaling & Maintenance (The "Joker" Strategy)

Pilot Test (Free): ทดสอบกับคน 10-20 คน (ใช้ Supabase Free Tier)

Stress Test: ตรวจสอบความเร็วการ Query รายชื่อ 30,000 โรงเรียน (แนะนำให้ทำ Index ที่ school_code และ district_name)

Upgrade Path: - เมื่อเริ่มเปิดรับสมัคร (Go-Live) ให้กดอัปเกรด Supabase เป็น Pro Plan ($25) - ผูกบัตรกับ Cloudflare R2 เป็น Pay-as-you-go

⚠️ Checklist สำหรับ Solo Dev (Cursor/AI Prompts)

[ ] "Create a Next.js 14 project with Tailwind CSS and Supabase client"

[ ] "Generate a multi-step form for project submission with autosave to Supabase"

[ ] "Implement a PDF upload component that gets a presigned URL from an Edge Function and uploads to R2"

[ ] "Build a referee dashboard that filters submissions by district_id"