-- Supabase Database Schema for OBEC Challenge
-- (Based on Plan.md)

-- 1. Table: Schools (User School)
CREATE TABLE IF NOT EXISTS schools (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  school_code text UNIQUE,
  school_name text,
  district_name text,
  province text
);

-- 2. Table: Profiles (User Personal)
CREATE TABLE IF NOT EXISTS profiles (
  id uuid REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  full_name text,
  sub_role text CHECK (sub_role IN ('student', 'teacher', 'director', 'vice_director')),
  training_flag boolean DEFAULT false,
  school_id uuid REFERENCES schools(id),
  district_id text,
  personal_role text DEFAULT 'personal' CHECK (personal_role IN ('personal', 'school_admin')),
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now())
);

-- 2.1 Table: School Profiles (School Administration)
CREATE TABLE IF NOT EXISTS school_profiles (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  school_id uuid REFERENCES schools(id) UNIQUE,
  admin_user_id uuid REFERENCES profiles(id),
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now())
);

-- 3. Table: Teams & Submissions
CREATE TABLE IF NOT EXISTS project_teams (
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
CREATE TABLE IF NOT EXISTS team_members (
  team_id uuid REFERENCES project_teams(id),
  user_id uuid REFERENCES profiles(id),
  PRIMARY KEY (team_id, user_id)
);

-- Row Level Security (RLS) for project_teams
-- Allow insert/update only when the authenticated user belongs to the same school.
-- Allow select only for referees in the same district.

ALTER TABLE project_teams ENABLE ROW LEVEL SECURITY;

-- Helper function to get the current user's profile
CREATE OR REPLACE FUNCTION public.current_user_profile()
RETURNS profiles AS $$
  SELECT *
  FROM profiles
  WHERE id = auth.uid();
$$ LANGUAGE sql STABLE;

-- Allow the user to insert/update their own school submissions
DROP POLICY IF EXISTS "project_teams_school_insert_update" ON project_teams;
CREATE POLICY "project_teams_school_insert_update"
ON project_teams
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM profiles p
    WHERE p.id = auth.uid()
      AND p.school_id = project_teams.school_id
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM profiles p
    WHERE p.id = auth.uid()
      AND p.school_id = project_teams.school_id
  )
);

-- Allow referees to select submissions from their district
-- (Assumes referees have a role stored in auth.role or in profiles.sub_role)
DROP POLICY IF EXISTS "project_teams_referee_select" ON project_teams;
CREATE POLICY "project_teams_referee_select"
ON project_teams
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM profiles p
    JOIN schools s ON s.id = project_teams.school_id
    WHERE p.id = auth.uid()
      AND p.sub_role = 'director'
      AND p.district_id = s.district_name
  )
);

-- Optional: allow users to select their own submissions regardless of role
DROP POLICY IF EXISTS "project_teams_owner_select" ON project_teams;
CREATE POLICY "project_teams_owner_select"
ON project_teams
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM profiles p
    WHERE p.id = auth.uid()
      AND p.school_id = project_teams.school_id
  )
);

-- RLS for school_profiles
ALTER TABLE school_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "school_profiles_select"
ON school_profiles
FOR SELECT
TO authenticated
USING (
  -- Allow school admin to see their school profile
  admin_user_id = auth.uid()
  OR
  -- Allow users from same school to see
  EXISTS (
    SELECT 1
    FROM profiles p
    WHERE p.id = auth.uid()
      AND p.school_id = school_profiles.school_id
  )
);

DROP POLICY IF EXISTS "school_profiles_insert" ON school_profiles;
CREATE POLICY "school_profiles_insert"
ON school_profiles
FOR INSERT
TO authenticated
WITH CHECK (
  -- Only allow creation through RPC function
  false
);

-- RPC function to mark training as complete
CREATE OR REPLACE FUNCTION public.mark_training_complete()
RETURNS void AS $$
BEGIN
  UPDATE profiles
  SET training_flag = true
  WHERE id = auth.uid();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RPC function to create school profile
CREATE OR REPLACE FUNCTION public.create_school_profile(target_school_id uuid)
RETURNS uuid AS $$
DECLARE
  new_school_profile_id uuid;
  current_user_profile profiles;
BEGIN
  -- Get current user profile
  SELECT * INTO current_user_profile
  FROM profiles
  WHERE id = auth.uid();

  -- Check if user has permission (same school and district)
  IF current_user_profile.school_id != target_school_id THEN
    RAISE EXCEPTION 'User must belong to the same school';
  END IF;

  -- Check if school profile already exists
  IF EXISTS (SELECT 1 FROM school_profiles WHERE school_id = target_school_id) THEN
    RAISE EXCEPTION 'School profile already exists';
  END IF;

  -- Create school profile
  INSERT INTO school_profiles (school_id, admin_user_id)
  VALUES (target_school_id, auth.uid())
  RETURNING id INTO new_school_profile_id;

  -- Update user to have school_admin role
  UPDATE profiles
  SET personal_role = 'school_admin'
  WHERE id = auth.uid();

  RETURN new_school_profile_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RPC function to get user roles
CREATE OR REPLACE FUNCTION public.get_user_roles()
RETURNS json AS $$
DECLARE
  user_profile profiles;
  has_school_admin boolean := false;
BEGIN
  -- Get user profile
  SELECT * INTO user_profile
  FROM profiles
  WHERE id = auth.uid();

  -- Check if user is school admin
  SELECT EXISTS(
    SELECT 1 FROM school_profiles
    WHERE admin_user_id = auth.uid()
  ) INTO has_school_admin;

  RETURN json_build_object(
    'personal_role', user_profile.personal_role,
    'has_school_admin', has_school_admin,
    'sub_role', user_profile.sub_role,
    'school_id', user_profile.school_id,
    'district_id', user_profile.district_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
