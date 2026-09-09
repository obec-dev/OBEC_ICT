EDU_ICT — ICT Talent Representative Platform
Version: 1.0.0 (captured 2026-09-09)

Stack: Next.js (App Router) + TypeScript + Tailwind CSS + Supabase

Quick start
  npm install
  npm run dev
  Set NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY

Docs
  TECHNICAL_SUMMARY.md  — V1.0 routes, flows, schema, relationships
  supabase/DATABASE.md  — detailed DB archive
  supabase/*.sql        — incremental migrations (run in SQL Editor)

Apply latest SQL (if not yet)
  harden_security_v1.sql   — REQUIRED before this app build (RLS + secure RPCs)
  fix_candidate_login.sql  — REQUIRED if candidates cannot login after harden
  fix_register_birth_date.sql — REQUIRED if register fails on birth_date type
  fix_projects_pass_threshold_columns.sql — REQUIRED if admin project save fails (pass_threshold_mode)
  fix_pass_threshold_mode.sql
  fix_results_visibility_and_grading.sql
  fix_admin_session_slide.sql
  fix_exam_status_enum_cast.sql — REQUIRED if exam submit fails (status enum)
  fix_question_answer_required.sql — REQUIRED for mandatory answer flag on questions
  fix_schools_by_district_counts.sql — REQUIRED for district expand school list people counts (N)
  refactor_auth_school_admin_survey_v1.sql — REQUIRED for password login, school admin, ICT survey

After harden_security_v1.sql
  Admin passwords must be bcrypt. If login fails, reset in SQL Editor:
    UPDATE public.admins
    SET password_hash = extensions.crypt('TempPass123!', extensions.gen_salt('bf')),
        must_change_password = true
    WHERE username = 'your_admin';

Roles
  Public → register / dashboard
  Candidate → learn / exam / profile
  Admin → overview → projects → registrations → submitted exams
  Super admin → + config / admins / audit
