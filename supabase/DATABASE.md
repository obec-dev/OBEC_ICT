# OBEC ICT — Database Schema & Flow Archive

เอกสารเก็บโครงสร้างฐานข้อมูลและ flow การทำงานของระบบ (อัปเดตตามโค้ด/SQL ปัจจุบัน)

> ใช้เป็นคู่มืออ้างอิง ไม่ต้องรันทั้งไฟล์นี้เป็น migration  
> SQL ที่รันจริงอยู่ใต้ `supabase/*.sql` — ดูลำดับท้ายเอกสาร

---

## 1. Entity overview

```text
┌──────────────────────────────────────────────────────────────────────────┐
│                         PUBLIC / REGISTRATION                            │
│                                                                          │
│  districts 1───N schools 1───N profiles                                  │
│                   │              │                                       │
│                   │              ├──1── watch_progress                   │
│                   │              └──1── exam_progress                    │
│                   └── is_registered ← trigger / mark_school_registered   │
└──────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────┐
│                              ADMIN                                       │
│                                                                          │
│  admins 1───N admin_sessions                                             │
│    │                                                                     │
│    ├──1──N audit_logs                                                    │
│    ├──1──N audit_purge_history                                           │
│    └── updates site_settings                                             │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Core tables (registration)

### `districts`
| Column | Type | Notes |
|--------|------|--------|
| `district_id` | `TEXT` PK | เช่น `10010000` |
| `district_name` | `TEXT` NOT NULL | เช่น `สพป.กรุงเทพมหานคร` |
| `created_at` / `updated_at` | `TIMESTAMPTZ` | |

### `schools`
| Column | Type | Notes |
|--------|------|--------|
| `school_id` | `TEXT` PK | เช่น `1010720001` |
| `school_name` | `TEXT` NOT NULL | |
| `district_id` | `TEXT` FK → `districts` | `ON DELETE RESTRICT` |
| `province` | `TEXT` NOT NULL | |
| `is_registered` | `BOOLEAN` default `FALSE` | true เมื่อมี profile แล้ว |
| `created_at` / `updated_at` | `TIMESTAMPTZ` | |

Indexes: `idx_schools_district`, `idx_schools_is_registered`

### `profiles` (PDPA-sensitive)
| Column | Type | Notes |
|--------|------|--------|
| `profile_id` | `TEXT` PK | เลขบัตรประชาชน |
| `user_id` | `UUID` FK → `auth.users` | optional |
| `school_id` | `TEXT` FK → `schools` | **ไม่ UNIQUE** — หลายคน/โรงเรียน |
| `first_name` / `last_name` | `TEXT` NOT NULL | |
| `phone` | `TEXT` NOT NULL | |
| `remark` | `TEXT` | |
| `avatar_url` | `TEXT` | |
| `portfolio_files` | `JSONB` default `[]` | |
| `pdpa_accepted` | `BOOLEAN` default `TRUE` | |
| `created_at` / `updated_at` | `TIMESTAMPTZ` | |

Index: `idx_profiles_school`

### `watch_progress`
| Column | Type | Notes |
|--------|------|--------|
| `id` | `UUID` PK | |
| `profile_id` | `TEXT` UNIQUE FK → `profiles` | 1 คน / 1 แถว |
| `video_id` | `TEXT` | |
| `watched_seconds` / `duration_seconds` | `INT` | |
| `completed` | `BOOLEAN` | |
| `created_at` / `updated_at` | `TIMESTAMPTZ` | |

### `exam_progress`
Enum: `exam_status_enum` = `'draft' | 'submitted'`

| Column | Type | Notes |
|--------|------|--------|
| `id` | `UUID` PK | |
| `profile_id` | `TEXT` UNIQUE FK → `profiles` | |
| `answers` | `JSONB` | |
| `status` | `exam_status_enum` | |
| `score` | `NUMERIC(5,2)` | |
| `submitted_at` | `TIMESTAMPTZ` | |
| `created_at` / `updated_at` | `TIMESTAMPTZ` | |

---

## 3. Admin tables

### `admins`
| Column | Type | Notes |
|--------|------|--------|
| `admin_id` | `UUID` PK | `gen_random_uuid()` |
| `username` | `TEXT` UNIQUE NOT NULL | |
| `password_hash` | `TEXT` NOT NULL | bcrypt via `extensions.crypt` (หรือ plain ชั่วคราวตอน bootstrap) |
| `full_name` | `TEXT` NOT NULL | |
| `role` | `TEXT` default `'admin'` | `'admin'` \| `'super_admin'` |
| `is_active` | `BOOLEAN` default `TRUE` | |
| `must_change_password` | `BOOLEAN` default `FALSE` | บังคับเปลี่ยนตอน login |
| `created_at` / `updated_at` | `TIMESTAMPTZ` | |

### `admin_sessions`
| Column | Type | Notes |
|--------|------|--------|
| `token` | `TEXT` PK | session token หลัง login |
| `admin_id` | `UUID` FK → `admins` | |
| `expires_at` | `TIMESTAMPTZ` | ปกติ +12 ชม. |
| `created_at` | `TIMESTAMPTZ` | |

### `audit_logs`
| Column | Type | Notes |
|--------|------|--------|
| `log_id` | `UUID` PK | |
| `admin_id` | `UUID` FK → `admins` | `ON DELETE SET NULL` |
| `action` | `TEXT` | เช่น `login`, `update_profile`, `purge_audit_logs` |
| `target_table` | `TEXT` | |
| `target_id` | `TEXT` | |
| `old_data` / `new_data` | `JSONB` | |
| `ip_address` | `TEXT` | optional |
| `created_at` | `TIMESTAMPTZ` | |

### `audit_purge_history`
เก็บประวัติการล้าง log (ไม่เก็บเนื้อหา log ใน DB หลัง purge — อ้างอิงไฟล์ export ภายนอก)

| Column | Type | Notes |
|--------|------|--------|
| `purge_id` | `UUID` PK | |
| `admin_id` | `UUID` FK → `admins` | |
| `purged_count` | `INT` | จำนวนแถวที่ลบ |
| `export_filename` | `TEXT` | ชื่อไฟล์ JSON ที่ดาวน์โหลดไว้ |
| `oldest_log_at` / `newest_log_at` | `TIMESTAMPTZ` | ช่วงเวลาของชุดที่ลบ |
| `note` | `TEXT` | |
| `created_at` | `TIMESTAMPTZ` | |

### `site_settings`
| Column | Type | Notes |
|--------|------|--------|
| `key` | `TEXT` PK | `site_name`, `registration_open`, `login_announce_message`, `registration_start`, `registration_end`, `exam_start`, `exam_end` |
| `value` | `JSONB` | วันที่เป็น ISO string หรือ `null` = ไม่จำกัดด้านนั้น |
| `updated_at` | `TIMESTAMPTZ` | |
| `updated_by` | `UUID` FK → `admins` | |

**Period rules (แอป):**
- ลงทะเบียนเปิดเมื่อ `registration_open = true` และอยู่ใน `[registration_start, registration_end]` (ด้านที่ว่าง = ไม่จำกัด)
- สอบเปิดเมื่ออยู่ใน `[exam_start, exam_end]` (ด้านที่ว่าง = ไม่จำกัด); ส่งแล้วยังดูได้หลังหมดเขต
- ตั้งค่าที่ `/admin/config` (super_admin) — SQL seed: `site_period_settings.sql`

---

## 4. Triggers & helper functions

### Registration flag
- **Trigger** `trigger_update_school_reg` → `AFTER INSERT ON profiles`
- **Function** `update_school_registration()` (`SECURITY DEFINER`)  
  → `UPDATE schools SET is_registered = TRUE`
- **Backup RPC** `mark_school_registered(p_school_id)`  
  → แอปเรียกหลัง insert profile (กรณี trigger พลาด)

### Dashboard aggregates (เบา — ไม่ดึง 7k แถวเต็ม)
- `get_district_stats()` → ต่อเขต: total / registered  
  (นับ registered จาก `is_registered` **หรือ** มีแถวใน `profiles`)
- `get_school_totals()` → total schools / registered / districts

### Admin auth helpers
- `_admin_from_token(token)` → คืนแถว `admins` ถ้า session ยังไม่หมดอายุ
- `_write_audit(...)` → เขียน `audit_logs`
- Password crypto ใช้ **`extensions.crypt` / `extensions.gen_salt`** (pgcrypto บน Supabase อยู่ใน schema `extensions`)

---

## 5. Application flows

### A) Public registration (ช่วงเปิดรับสมัคร)
```text
Consent (PDPA)
    → ตรวจสอบ school_id (lookup 1 แถว)
    → กรอกผู้สมัคร 1..N คน (การ์ดละคน)
    → INSERT profiles ทีละคน
         ├─ ตรวจ profile_id ซ้ำ (โรงเรียนเดิม / คนละโรงเรียน)
         ├─ trigger / mark_school_registered
         └─ ไม่ auto-login (รอประกาศวันเปิดพอร์ทัล)
    → หน้า success
```

หน้าเกี่ยวข้อง: `/register/consent`, `/register/form`, `/register/success`

### B) Public dashboard
```text
โหลด get_district_stats + get_school_totals
    → การ์ดเขต (water-tank สี 5 ระดับ) + เรียง % / ชื่อ / จำนวนโรงเรียน
    → คลิกเขต → fetchSchoolsByDistrict เท่านั้น (on-demand)
    → ค้นชื่อโรงเรียน → search limit (ไม่โหลดทั้งตาราง)
```

หน้า: `/dashboard`

### C) Admin login & roles
```text
/admin/login
    → admin_login(username, password)
         ├─ ตรวจ bcrypt หรือ plain bootstrap
         ├─ สร้าง admin_sessions.token
         └─ audit: login
    → ถ้า must_change_password → /admin/change-password
    → /admin
```

| Role | สิทธิ์ |
|------|--------|
| `super_admin` | ทั้งหมด: overview, registrations, config, admins, audit |
| `admin` | overview + registrations เท่านั้น |

### D) Manage registrations (admin)
```text
ค้นชื่อ/รหัสโรงเรียน (autosuggest)
    → เลือกโรงเรียน
    → แสดง profiles ของโรงเรียนนั้น
    → แก้ไข / ลบรายคน / ลบทั้งโรงเรียน
         └─ ผ่าน RPC + เขียน audit_logs
    → ถ้าไม่เหลือ profile → is_registered = false
```

หน้า: `/admin/registrations`

### E) Audit export & purge (super_admin)
```text
ดู audit_logs (ล่าสุด)
    → Export JSON ลงเครื่อง (ข้อมูลอ้างอิงภายนอก)
    → Purge:
         1) auto-export JSON อีกครั้ง
         2) บันทึก audit_purge_history (จำนวน + ชื่อไฟล์)
         3) DELETE ทั้งหมดจาก audit_logs → เหลือ 0 แถว
         4) เขียน log การ purge (แถวใหม่หลังล้าง)
```

หน้า: `/admin/audit`

### F) Future: watch / exam (ออกแบบไว้ใน admin overview)
- Admin overview แสดง count จาก `watch_progress` / `exam_progress` แล้ว
- รายละเอียด funnel ต่อเขต / คะแนนเฉลี่ย → ทำต่อเมื่อเปิดพอร์ทัลเรียน-สอบ

---

## 6. RLS (สรุปแนวคิดปัจจุบัน)

| Table | นโยบายหลัก |
|-------|------------|
| `districts` / `schools` | Public **SELECT** |
| `profiles` | Public INSERT + SELECT (ช่วงสมัคร); admin แก้ผ่าน RPC |
| `watch_progress` / `exam_progress` | เปิดกว้างชั่วคราว (`USING true`) — harden ก่อน production |
| `admins` / `admin_sessions` / `audit_logs` | ไม่เปิดตรงจาก client — ใช้ **SECURITY DEFINER RPC** + token |
| `site_settings` | Public SELECT; แก้ผ่าน RPC ของ super_admin |

> Production ควรจำกัด INSERT/SELECT ของ `profiles` และ progress tables ให้แคบลง (Auth / Edge Function)

---

## 7. App routes map

| Route | ใครใช้ | ข้อมูลหลัก |
|-------|--------|------------|
| `/` | สาธารณะ | school totals |
| `/dashboard` | สาธารณะ | district stats |
| `/register/*` | สาธารณะ | schools lookup, profiles insert |
| `/admin/login` | admin | `admins` + sessions |
| `/admin` | admin | hub |
| `/admin/overview` | admin+ | overview RPC |
| `/admin/registrations` | admin+ | profiles by school |
| `/admin/config` | super_admin | `site_settings` |
| `/admin/admins` | super_admin | `admins` CRUD |
| `/admin/audit` | super_admin | `audit_logs` / purge |
| `/admin/change-password` | admin | password hash |

---

## 8. SQL files — ลำดับที่แนะนำ

รันใน Supabase **SQL Editor** ตามลำดับนี้ (ไฟล์ส่วนใหญ่ใช้ `IF NOT EXISTS` / `CREATE OR REPLACE` รันซ้ำได้):

| ลำดับ | ไฟล์ | หน้าที่ |
|------:|------|---------|
| 1 | schema หลักของ registration (ที่คุณสร้างในโปรเจกต์: districts/schools/profiles/…) | ตารางสมัคร |
| 2 | `fix_rls_trigger.sql` | trigger + backfill `is_registered` + stats ที่นับจาก profiles |
| 3 | `dashboard_stats.sql` | `get_district_stats` / `get_school_totals` |
| 4 | `admin_system.sql` | admins, sessions, audit_logs, site_settings, admin RPCs |
| 4b | `site_period_settings.sql` | keys ช่วงลงทะเบียน/สอบ (ถ้ารัน admin_system เก่าแล้ว) |
| 5 | `fix_crypt_extension.sql` | แก้ `extensions.crypt` สำหรับ login/password |
| 6 | `admin_audit_and_overview.sql` | purge history + audit/overview RPCs |

ไฟล์เก่าที่ไม่ใช่ source of truth ปัจจุบัน: `schema.sql`, `migration_role_system.sql` (รุ่นก่อน — อย่าสับสนกับ schema ปัจจุบัน)

---

## 9. Admin RPC catalog (ย่อ)

**Auth / account**
- `admin_login`, `admin_logout`, `admin_change_password`
- `admin_list`, `admin_create`, `admin_reset_password`, `admin_set_active`, `admin_set_role`

**Settings**
- `admin_get_settings`, `admin_save_settings`

**Registrations**
- `admin_list_profiles_by_school`, `admin_update_profile`
- `admin_delete_profile`, `admin_delete_school_profiles`

**Audit / overview**
- `admin_list_audit_logs`, `admin_audit_stats`, `admin_export_audit_logs`
- `admin_purge_audit_logs`, `admin_list_purge_history`
- `admin_overview_stats`

---

## 10. Operational notes

1. **Egress:** อย่าโหลด schools ทั้งระบบในหน้า dashboard — ใช้ RPC สรุป + โหลดรายเขตตอนขยายการ์ด  
2. **PDPA:** `profile_id` = เลขบัตร — อย่า log ลง client/console โดยไม่จำเป็น  
3. **Audit growth:** ใช้ Export JSON เก็บภายนอก แล้ว Purge ใน `/admin/audit` เมื่อตารางโต  
4. **First super_admin:** ใส่แถวใน `admins` แล้วตั้ง `role = 'super_admin'` — ถ้ารหัสเป็น plain text ระบบจะบังคับเปลี่ยนหลัง login  
5. **Register phase:** ไม่ auto-login ผู้สมัครหลังสมัครสำเร็จ

---

*Archived for project OBEC_ICT — keep this file in sync when schema/RPC changes.*
