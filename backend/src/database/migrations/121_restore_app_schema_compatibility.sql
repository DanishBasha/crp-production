-- Migration 121: Restore application schema compatibility for auth, student, and mentor queries

-- 1. org.faculty_profiles
CREATE TABLE IF NOT EXISTS org.faculty_profiles (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID UNIQUE NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  department   VARCHAR(100),
  designation  VARCHAR(100),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_faculty_profiles_user ON org.faculty_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_faculty_profiles_dept ON org.faculty_profiles(department);

-- 2. org.students columns required by application routes
ALTER TABLE org.students
  ADD COLUMN IF NOT EXISTS roll_number     VARCHAR(100),
  ADD COLUMN IF NOT EXISTS coding_handles  JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS resume_url      TEXT,
  ADD COLUMN IF NOT EXISTS resume_verified BOOLEAN DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS uq_students_roll_number ON org.students(roll_number) WHERE roll_number IS NOT NULL;

-- 3. org.batches columns required by application routes
ALTER TABLE org.batches
  ADD COLUMN IF NOT EXISTS track VARCHAR(100) DEFAULT 'General Track';
