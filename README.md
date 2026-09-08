# OBEC School Challenge (Next.js + Supabase)

This repository is a starter implementation for the OBEC School Challenge system described in `Plan.md`.

It includes:

- A **Next.js 14 app** (App Router) with **Tailwind CSS** styling
- A **Supabase client** integration for Auth + Database
- A **database schema** for `profiles`, `schools`, `project_teams`, and `team_members`
- Skeleton pages for **training**, **team building**, **submission**, and **showcase**
- Placeholder Supabase Edge Function stubs for **R2 presigned uploads** and **Google Drive validation**

---

## Getting Started (Local Development)

1. Copy the environment template:

```bash
cp .env.local.example .env.local
```

2. Fill in your Supabase project values in `.env.local`:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

3. Install dependencies:

```bash
npm install
```

4. Start the dev server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see the app.

---

## Database Schema

The Supabase schema is located in `supabase/schema.sql`. It defines:

- `profiles` (users, roles, flags)
- `schools` (school metadata)
- `project_teams` (submission teams)
- `team_members` (team membership)

You can apply the schema using the Supabase SQL editor or a migration tool.

---

## Supabase Edge Functions (Skeletons)

Edge functions are under `supabase/functions/`:

- `getPresignedUrl` (Cloudflare R2 presigned upload URL)
- `validateDriveUrl` (Google Drive checksum/mime validation)

---

## Next Steps

- Implement the R2 presigned upload flow (Edge Function + frontend file upload)
- Finish the Google Drive validation service
- Add full authentication flows and profile onboarding
- Add a referee dashboard and access controls (RLS)
