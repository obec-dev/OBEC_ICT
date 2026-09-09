# EDU_ICT — Technical Summary

Auth is client-side (`IctStore` + `AuthGuard`); no Next.js Server Actions. Candidate login = national ID + phone against `profiles`; admin login = custom token sessions via RPC.

Canonical schema docs: `supabase/DATABASE.md` + incremental `supabase/*.sql`.  
Ignore obsolete `schema.sql` / `migration_role_system.sql` for the live model.

---

## 1. Page & Route Structure

### Public

| Route | Purpose |
|-------|---------|
| `/` | Home / marketing (hero, project cover, school totals, CTA) |
| `/dashboard` | Registration heatmap by district + school lists |
| `/register/consent` | PDPA consent; gates registration period |
| `/register/form` | School ID lookup + multi-person registration |
| `/register/success` | Confirmation (no auto-login) |
| `/login` | Candidate login (national ID + phone) |

### Candidate portal

| Route | Purpose |
|-------|---------|
| `/portal/learn` | YouTube lessons; upserts `watch_progress` |
| `/portal/exam` | Exam UI: draft / submit / lock after submit |
| `/portal/profile` | View / edit own profile |

### Admin

| Route | Purpose |
|-------|---------|
| `/admin/login` | Admin login (`admin_login` RPC) |
| `/admin` | Admin hub |
| `/admin/overview` | Aggregate stats |
| `/admin/registrations` | School-centric profile CRUD |
| `/admin/candidates` | Candidate search, exam status, unlock exam |
| `/admin/projects` | Project / video / question builder + grading |
| `/admin/config` | Site settings (`super_admin`) |
| `/admin/admins` | Admin user management (`super_admin`) |
| `/admin/audit` | Audit log list / export / purge (`super_admin`) |
| `/admin/change-password` | Forced / optional password change |

### API

| Route | Purpose |
|-------|---------|
| `GET /api/portal/questions` | Questions **without** answer keys |
| `GET /api/health/supabase` | Connectivity check |

---

## 2. Core System Flows

### Registration

```text
/consent → sessionStorage flag + reg window check
    → /form: lookup school_id in schools (no PIN)
    → validate 1..N persons (13-digit profile_id, names, etc.)
    → INSERT profiles → trigger/RPC sets schools.is_registered
    → /success (no auto-login)
```

- Duplicate `profile_id` blocked (same school or another school).
- Period gated by project `reg_*` (and legacy `site_settings`).

### Exam submission & anti-cheating

```text
/portal/exam
  → questions stripped of correct_answer / model_answer
  → draft  → exam_progress.status = 'draft'   (answers JSONB)
  → submit → status = 'submitted' + submitted_at → UI locks
Admin grade_project_exams(project_id)
  → compare answers->>qid to project_questions.correct_answer
  → set score, passed, graded_at
Admin unlock → admin_unlock_exam → back to draft, clear score/passed/timestamps
```

- Keys live in DB; grading is server-side RPC.
- App strips keys on read; `/api/portal/questions` also omits them.
- Note: DB RLS on `project_questions` may still allow direct client `select *` unless hardened.

### Admin management

```text
admin_login → admin_sessions token (~12h) → audit
  → must_change_password? → /admin/change-password

Lookup: admin_search_profiles / admin_list_profiles_by_school
Unlock: admin_unlock_exam(token, profile_id, project_id)
Config: admin_get/save_settings → site_settings (JSONB)
Projects: upsert projects / videos / questions
```

Roles: `admin` (overview, registrations, candidates, projects); `super_admin` (+ config, admins, audit).

---

## 3. Database Schema & Key Columns

### Registration / geography

| Table | PK | Essential columns |
|-------|-----|-------------------|
| `districts` | `district_id` TEXT | `district_name`, timestamps |
| `schools` | `school_id` TEXT | `school_name`, `district_id` FK, `province`, `is_registered` BOOL |
| `profiles` | `profile_id` TEXT (national ID) | `school_id` FK, names, `phone`, `pdpa_accepted`, bilingual/reg fields, **`portfolio_files` JSONB**, optional `user_id`→`auth.users` |

### Learning / exam

| Table | PK | Essential columns |
|-------|-----|-------------------|
| `projects` | `id` TEXT | `name`, `is_active`, `cover_url`, `reg_*` / `exam_*` windows, `pass_threshold`, `max_score` |
| `project_videos` | `id` TEXT | `project_id` FK, `title`, `video_url`/`video_id`, `is_mandatory`, `order_index` |
| `project_questions` | `id` TEXT | `project_id` FK, `prompt`, `type`, **`options` JSONB**, `correct_answer`, `model_answer`, `points`, `order_index` |
| `watch_progress` | `id` UUID | `profile_id` UNIQUE FK, `video_id`, optional `project_id`, watch seconds, `completed` |
| `exam_progress` | `id` UUID | `profile_id` + `project_id` (UNIQUE pair), **`answers` JSONB**, `status` (`draft`\|`submitted`), `score`, `passed`, `graded_at`, `submitted_at` |

### Admin

| Table | PK | Essential columns |
|-------|-----|-------------------|
| `admins` | `admin_id` UUID | `username`, `password_hash`, `role`, `is_active`, `must_change_password` |
| `admin_sessions` | `token` TEXT | `admin_id` FK, `expires_at` |
| `audit_logs` | `log_id` UUID | `admin_id`, `action`, `target_*`, **`old_data`/`new_data` JSONB** |
| `audit_purge_history` | `purge_id` UUID | purge metadata + export filename |
| `site_settings` | `key` TEXT | **`value` JSONB**, `updated_by`→`admins` |

**JSONB:** `profiles.portfolio_files`, `project_questions.options`, `exam_progress.answers`, `audit_logs.old_data`/`new_data`, `site_settings.value`.

Legacy (repo SQL only, not current app path): `school_profiles`, `project_teams`, `team_members`.

---

## 4. Entity Relationships

```text
districts (1) ──< (N) schools (1) ──< (N) profiles
                                         │
                    ┌────────────────────┼────────────────────┐
                    │ 1:1                │ 1:N (per project)  │
                    ▼                    ▼
             watch_progress       exam_progress
                                         │ answers keys → question ids
projects (1) ──< (N) project_videos
         └──< (N) project_questions

admins (1) ──< (N) admin_sessions
       ├──< (N) audit_logs
       ├──< (N) audit_purge_history
       └── updates site_settings
```

| Relationship | Cardinality |
|--------------|-------------|
| districts → schools | 1 : N |
| schools → profiles | 1 : N |
| profiles → watch_progress | 1 : 1 |
| profiles → exam_progress | 1 : N (UNIQUE `profile_id`+`project_id`) |
| projects → videos / questions / exam_progress | 1 : N |
| admins → sessions / logs / purge history | 1 : N |

---

## Architecture notes

- Single active site project via `getSiteProject()`.
- State hub: `src/contexts/IctStore.tsx`.
- Domain types: `src/types/ict.ts`.
- Deeper DB reference: `supabase/DATABASE.md`.
