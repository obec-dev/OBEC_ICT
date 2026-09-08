-- Migration to add role-based system
-- Run this after updating schema.sql

-- Drop existing policies first
DROP POLICY IF EXISTS "project_teams_school_insert_update" ON project_teams;
DROP POLICY IF EXISTS "project_teams_referee_select" ON project_teams;
DROP POLICY IF EXISTS "project_teams_owner_select" ON project_teams;
DROP POLICY IF EXISTS "school_profiles_select" ON school_profiles;
DROP POLICY IF EXISTS "school_profiles_insert" ON school_profiles;

-- Add new columns to profiles table
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS personal_role text DEFAULT 'personal' CHECK (personal_role IN ('personal', 'school_admin'));
UPDATE profiles SET personal_role = 'personal' WHERE personal_role IS NULL;

-- Update sub_role constraint to include vice_director
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_sub_role_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_sub_role_check CHECK (sub_role IN ('student', 'teacher', 'director', 'vice_director'));

-- Create school_profiles table
CREATE TABLE IF NOT EXISTS school_profiles (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  school_id uuid REFERENCES schools(id) UNIQUE,
  admin_user_id uuid REFERENCES profiles(id),
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now())
);

-- Enable RLS
ALTER TABLE school_profiles ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "school_profiles_select"
ON school_profiles
FOR SELECT
TO authenticated
USING (
  admin_user_id = auth.uid()
  OR
  EXISTS (
    SELECT 1
    FROM profiles p
    WHERE p.id = auth.uid()
      AND p.school_id = school_profiles.school_id
  )
);

CREATE POLICY "school_profiles_insert"
ON school_profiles
FOR INSERT
TO authenticated
WITH CHECK (false);

-- Create policies for project_teams
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
CREATE OR REPLACE FUNCTION public.create_school_profile(target_school_id uuid)
RETURNS uuid AS $$
DECLARE
  new_school_profile_id uuid;
  current_user_profile profiles;
BEGIN
  SELECT * INTO current_user_profile
  FROM profiles
  WHERE id = auth.uid();

  IF current_user_profile.school_id != target_school_id THEN
    RAISE EXCEPTION 'User must belong to the same school';
  END IF;

  IF EXISTS (SELECT 1 FROM school_profiles WHERE school_id = target_school_id) THEN
    RAISE EXCEPTION 'School profile already exists';
  END IF;

  INSERT INTO school_profiles (school_id, admin_user_id)
  VALUES (target_school_id, auth.uid())
  RETURNING id INTO new_school_profile_id;

  UPDATE profiles
  SET personal_role = 'school_admin'
  WHERE id = auth.uid();

  RETURN new_school_profile_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.get_user_roles()
RETURNS json AS $$
DECLARE
  user_profile profiles;
  has_school_admin boolean := false;
BEGIN
  SELECT * INTO user_profile
  FROM profiles
  WHERE id = auth.uid();

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