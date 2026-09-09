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
  fix_pass_threshold_mode.sql
  fix_results_visibility_and_grading.sql
  fix_admin_session_slide.sql

Roles
  Public → register / dashboard
  Candidate → learn / exam / profile
  Admin → overview → projects → registrations → submitted exams
  Super admin → + config / admins / audit
