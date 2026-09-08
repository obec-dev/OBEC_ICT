-- Instructions for running the migration
-- Since Docker is not available, run this SQL in your Supabase dashboard:
-- Go to: https://supabase.com/dashboard/project/YOUR_PROJECT/sql-editor
-- Copy and paste the entire migration_role_system.sql content

-- Alternative: If you have psql access, you can run:
-- psql "postgresql://postgres:[YOUR-PASSWORD]@db.YOUR-PROJECT.supabase.co:5432/postgres" -f supabase/migration_role_system.sql

-- The migration includes:
-- 1. Drop existing policies to avoid conflicts
-- 2. Add personal_role column to profiles
-- 3. Update sub_role constraint to include vice_director
-- 4. Create school_profiles table
-- 5. Create all necessary policies
-- 6. Create RPC functions

-- After running the migration, the role-based system will be fully functional.