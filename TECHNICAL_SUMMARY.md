# EDU_ICT — Version 1.0 Snapshot

**Captured:** 2026-09-09 · Stack: Next.js App Router · TypeScript · Tailwind · Supabase

Single-site ICT Talent platform: register → learn → exam → grade → publish results.

Auth is **client-side** (`IctStore` + `AuthGuard`). Candidate = national ID + phone (`profiles`). Admin = custom token RPC sessions (`admins` / `admin_sessions`). Logout always → `/`. Idle timeout **5 min**. Dark mode = class `.dark` + matte CSS vars.

Canonical SQL: `supabase/*.sql` (esp. `fix_pass_threshold_mode.sql`, `fix_results_visibility_and_grading.sql`). Deeper DB: `supabase/DATABASE.md`. Ignore obsolete `schema.sql` / `migration_role_system.sql`.

---

## Routes

| Area | Path | Purpose |
|------|------|---------|
| Public | `/` | Hero → metrics → project carousel → schedule → steps |
| | `/dashboard` | District heatmap + school lists `(N)` candidate counts |
| | `/register/consent` → `/form` → `/success` | PDPA → school lookup → multi-person insert |
| | `/login` | Candidate login |
| Portal | `/portal/learn` | YouTube playlist + watch progress |
| | `/portal/exam` | Draft/submit; sync status dirty/saved; lock after submit |
| | `/portal/profile` | Self-edit title/names/phone/position/duty/line/email |
| Admin | `/admin/login` | Admin login |
| | `/admin` | Hub |
| | `/admin/overview` | ภาพรวมผู้ดูแลระบบ |
| | `/admin/projects` | จัดการ - โครงการ (1st management tab) |
| | `/admin/registrations` | จัดการ - การลงทะเบียน (delete only) |
| | `/admin/candidates` | จัดการ - การส่งข้อสอบ (retake + delete) |
| | `/admin/config` · `/admins` · `/audit` | super_admin |
| | `/admin/change-password` | Password change |
| API | `/api/portal/questions` | Questions **without** keys |
| | `/api/health/supabase` | Health |

**Admin nav order:** Overview → Projects → Registrations → Submitted exams → (super) config/admins/audit.

---

## End-to-end flows

```text
REGISTER
  consent → school_id lookup → INSERT profiles (1..N)
  → schools.is_registered (trigger/RPC) → success (no auto-login)

LEARN
  videos by project → YT player remount per clip
  → upsert watch_progress (started / completed)

EXAM
  strip answer keys → answers JSONB
  draft | submit → lock UI
  sync label: hidden → saved after save → dirty after edit

GRADE (admin)
  require answer keys on all points>0 questions
  skip 0-point (survey) from max score & grade
  pass =
    mode percent → (earned/max)*100 >= value
    mode score   → earned >= value
  set score, passed, graded_at

PUBLISH RESULTS
  projects.enable_results_visibility
  → carousel pass badge + PassCelebrationModal
  → localStorage dismiss: ict_pass_dismissed_{profile}_{project}

UNLOCK
  submitted → draft; keep answers; clear score/passed/graded_at
```

---

## Core tables

| Table | PK | Notes |
|-------|-----|--------|
| `districts` | TEXT | geography |
| `schools` | TEXT | `district_id`, `is_registered` |
| `profiles` | TEXT (national ID) | bilingual fields; `portfolio_files` JSONB |
| `projects` | TEXT | `is_active`, `reg_*`/`exam_*`, `enable_results_visibility`, `pass_threshold_mode` (`percent`\|`score`), `pass_threshold_value`, legacy `pass_threshold`, `max_score` |
| `project_videos` | TEXT | YouTube + `is_mandatory` |
| `project_questions` | TEXT | `options` JSONB, `correct_answer`, `points` (0 = unscored) |
| `watch_progress` | UUID | per profile |
| `exam_progress` | UUID | UNIQUE(`profile_id`,`project_id`); `answers` JSONB; draft\|submitted |
| `admins` / `admin_sessions` | UUID / token | roles admin\|super_admin; session slide ~12h |
| `audit_logs` / `audit_purge_history` | UUID | `old_data`/`new_data` JSONB |
| `site_settings` | TEXT key | `value` JSONB |

---

## Relationships

```text
districts 1──<N schools 1──<N profiles
                              ├──1── watch_progress
                              └──N── exam_progress ──> projects
projects 1──<N videos | questions
admins 1──<N sessions | audit_logs | purge_history
```

---

## Key modules

| Role | Path |
|------|------|
| State | `src/contexts/IctStore.tsx` |
| Types | `src/types/ict.ts` |
| Pass rules | `src/lib/siteSettings.ts` (`isExamPassed`, `formatPassCriteriaLabel`) |
| Projects/grade RPC | `src/lib/supabase/projects.ts` |
| Admin RPCs | `src/lib/supabase/admin.ts` |
| Theme | `ThemeProvider` + `globals.css` (`.dark`) |
| Celebration | `PassCelebrationModal` |

---

## Security (v1 harden)

Run `supabase/harden_security_v1.sql` before deploying the app that uses it.

Locks: profiles / exam_progress / watch_progress / project_questions (no open CRUD).
Public: schools, districts, projects, videos, `public_project_questions` (no keys).
Candidate: phone-proof RPCs (`login_profile`, `register_profile`, progress upserts).
Admin: token RPCs for projects/questions/grading; bcrypt-only admin passwords.

