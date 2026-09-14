# OBEC ICT — Project status (14 Sep 2026)

Archive of the current app before production deploy. This is **not** a clearance to go live.

## Verdict

**Ready to deploy after you run `supabase/fix_auth_reset_and_login_probe_v1.sql` on the live database.** The app code for the password-reset gate is in the repo, but the live RPC stays unsafe until that script is applied.

`npm audit` was not completed. The request to `registry.npmjs.org` timed out (`ETIMEDOUT`). That is a network failure, not a code defect.

## Security review

Reviewed before this fix. Status after the code change:

| Severity | Status | What changed |
|----------|--------|----------------|
| High | Fixed in code; **apply SQL** | First-time `set_candidate_password` uses email only (no second email/phone check). Accounts that already have a password also require phone + national ID. Inactive accounts cannot reset. |
| Medium | Fixed | Login no longer calls `login_setup_status` before a password attempt. The RPC now returns the same payload for every email. |
| Medium | Fixed | Executive temp password stays in memory on the login page. It is not written to `sessionStorage`. |
| Medium | Reduced | `/portal` and `/admin` redirect to login when the role cookie is missing. A forged role cookie can still open the page shell; `AuthGuard` and RPCs remain the real checks. |

Apply `supabase/fix_auth_reset_and_login_probe_v1.sql` last (re-run it if you already applied an earlier copy). Then smoke-test: a direct call to `set_candidate_password` with only email + phone must fail for an account that already has a password. First-time setup with email only must still work.

## What the app is now

ICT Representative portal (Next.js App Router, TypeScript, Tailwind, Supabase RPC). Not the older “School Challenge / R2 / Google Drive” sketch in `README.md` and `Plan.md`. Those two files are stale.

Roles: guest, user, school_admin, business, audit, admin / super_admin.

Current behavior that is in the app code:

- Public registration overview at `/dashboard` (no login).
- Registration form: required fields marked with `*`, Line ID optional, phone limited to digits / space / hyphen / `+`, scroll to the first invalid field.
- Login stays on email + password until the user clicks Login, then checks whether a first password is still required.
- Business dashboard: project overview, partner count, schools by partner (joined vs not joined), top 10 schools with activity and top 10 with none (last 30 days). Re-run `executive_dashboards_v1.sql` so partner stats appear. Nav label is ภาพรวมโครงการ. Profile is only under the avatar menu. Login ID is a label. No current-password field.
- Audit dashboard: assigned districts only. District assignment works from the audit profile and from admin user management, after `executive_dashboards_v1.sql` is applied. Profile is only under the avatar menu.
- Avatar initial uses the given name, not the title prefix of the full name.
- Navbar: public link is ภาพรวมการลงทะเบียน. Business and audit do not show a โปรไฟล์ link or a Business/Audit role label.

## Apply before deploy

Set these on the host (anon key only — never a service role key in the browser):

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Build:

```bash
npm install
npm run lint
npx tsc --noEmit
npm run build
npm start
```

Re-run these in the Supabase SQL Editor if they are not already on the live database. Later files replace functions from earlier ones, so run them in this order:

1. `supabase/decouple_login_email_executives_v1.sql`
2. `supabase/executive_login_id_actions_v1.sql`
3. `supabase/executive_pending_temp_password_v1.sql`
4. `supabase/auth_forgot_national_id_v1.sql`
5. `supabase/fix_register_false_duplicate_v1.sql`
6. `supabase/login_setup_status_v1.sql`
7. `supabase/executive_dashboards_v1.sql`
8. `supabase/fix_auth_reset_and_login_probe_v1.sql`

`executive_dashboards_v1.sql` must be last among these. It replaces profile save (no password), audit district assignment (`text[]`), and the business school lists. Then reload the API schema (`NOTIFY pgrst, 'reload schema'` is already at the end of that file).

Full historical order is in `supabase/DATABASE.md`. Do not apply `schema.sql` or `migration_role_system.sql` as the current source of truth.

## Smoke test after the password-reset fix

- Register a new candidate. Empty Line ID succeeds. Required fields without `*` are only Line ID.
- First login: click Login, then phone confirmation, then create password. Returning login uses email + password only.
- Public `/dashboard` loads logged out.
- Business user: ภาพรวมโครงการ shows the two school cards. Profile opens only from the avatar.
- Audit user: can add and remove assigned districts in profile and in admin → users. Dashboard is limited to those districts.
- Admin: district save persists after refresh.
- Direct call to `set_candidate_password` with only email + phone fails for an account that already has a password.

## Not in this release

- Cloudflare R2 uploads and Google Drive validation (placeholders in the old README).
- Dependency vulnerability report (`npm audit` did not reach the registry).
- Replacing the client-writable `ict_access_role` cookie with a server session. Acceptable only while every sensitive RPC fails closed.
