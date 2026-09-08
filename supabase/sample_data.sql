-- Sample data for schools (for testing)
-- Insert some sample schools into the schools table

INSERT INTO schools (school_code, school_name, district_name, province) VALUES
('SCH001', 'โรงเรียนทดสอบ 1', 'เขตทดสอบ 1', 'กรุงเทพมหานคร'),
('SCH002', 'โรงเรียนทดสอบ 2', 'เขตทดสอบ 1', 'กรุงเทพมหานคร'),
('SCH003', 'โรงเรียนทดสอบ 3', 'เขตทดสอบ 2', 'นนทบุรี'),
('SCH004', 'โรงเรียนทดสอบ 4', 'เขตทดสอบ 2', 'นนทบุรี')
ON CONFLICT (school_code) DO NOTHING;

-- Sample data for profiles (for testing)
-- Note: These profiles require corresponding auth.users entries
-- You need to create users in Supabase Auth first, then use their IDs here
-- For testing, create users via the app or Supabase Auth dashboard

-- Example (replace with actual user IDs from auth.users):
-- INSERT INTO profiles (id, full_name, sub_role, training_flag, school_id, district_id, personal_role) VALUES
-- ('user-uuid-1', 'นักเรียนทดสอบ 1', 'student', true, (SELECT id FROM schools WHERE school_code = 'SCH001'), 'เขตทดสอบ 1', 'personal'),
-- ('user-uuid-2', 'ครูทดสอบ 1', 'teacher', true, (SELECT id FROM schools WHERE school_code = 'SCH001'), 'เขตทดสอบ 1', 'school_admin')
-- ON CONFLICT (id) DO NOTHING;
