-- SQL to add school admin role for testing

-- Replace 'your-user-id' with actual user ID from auth.users
-- Replace 'your-school-id' with actual school ID from schools table

-- Update existing profile to school admin
UPDATE profiles
SET personal_role = 'school_admin'
WHERE id = 'f851c542-8e56-472d-866a-310ed2250ebb';

-- Create school profile if not exists
INSERT INTO school_profiles (school_id, admin_user_id)
VALUES ('eca7805d-0f9f-4799-a87b-35256f1751a2', 'f851c542-8e56-472d-866a-310ed2250ebb')
ON CONFLICT (school_id) DO NOTHING;