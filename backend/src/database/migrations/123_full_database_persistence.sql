-- 123_full_database_persistence.sql
-- Ensures 100% database persistence for all entities:
-- Programs, Classes, Staff, Assignments, Trainer Tenures, Student Profiles, Tasks, Reports.

-- 1. Enhance org.programs
ALTER TABLE org.programs ADD COLUMN IF NOT EXISTS target_department VARCHAR(255);
ALTER TABLE org.programs ADD COLUMN IF NOT EXISTS assigned_admin_name VARCHAR(255);
ALTER TABLE org.programs ADD COLUMN IF NOT EXISTS assigned_admin_email VARCHAR(255);
ALTER TABLE org.programs ADD COLUMN IF NOT EXISTS admin_permissions JSONB DEFAULT '[]'::jsonb;

-- 2. Enhance org.department_classes
ALTER TABLE org.department_classes ADD COLUMN IF NOT EXISTS semester VARCHAR(50);
ALTER TABLE org.department_classes ADD COLUMN IF NOT EXISTS student_ids JSONB DEFAULT '[]'::jsonb;

-- 3. Enhance org.department_staff
ALTER TABLE org.department_staff ADD COLUMN IF NOT EXISTS permissions JSONB DEFAULT '[]'::jsonb;

-- 4. Enhance org.students for full profile & assessment persistence
ALTER TABLE org.students ADD COLUMN IF NOT EXISTS department VARCHAR(255);
ALTER TABLE org.students ADD COLUMN IF NOT EXISTS batch_year INTEGER;
ALTER TABLE org.students ADD COLUMN IF NOT EXISTS track VARCHAR(255);
ALTER TABLE org.students ADD COLUMN IF NOT EXISTS class_name VARCHAR(255);
ALTER TABLE org.students ADD COLUMN IF NOT EXISTS program_name VARCHAR(255);
ALTER TABLE org.students ADD COLUMN IF NOT EXISTS sub_program_name VARCHAR(255);
ALTER TABLE org.students ADD COLUMN IF NOT EXISTS mentor_name VARCHAR(255);
ALTER TABLE org.students ADD COLUMN IF NOT EXISTS mentor_email VARCHAR(255);
ALTER TABLE org.students ADD COLUMN IF NOT EXISTS resume_data JSONB;
ALTER TABLE org.students ADD COLUMN IF NOT EXISTS criteria_tasks JSONB DEFAULT '[]'::jsonb;
ALTER TABLE org.students ADD COLUMN IF NOT EXISTS improvement_checklist JSONB DEFAULT '[]'::jsonb;
ALTER TABLE org.students ADD COLUMN IF NOT EXISTS recent_reports JSONB DEFAULT '[]'::jsonb;
ALTER TABLE org.students ADD COLUMN IF NOT EXISTS overall_readiness NUMERIC DEFAULT 0;
ALTER TABLE org.students ADD COLUMN IF NOT EXISTS coins INTEGER DEFAULT 5;
ALTER TABLE org.students ADD COLUMN IF NOT EXISTS zero_coins_at TIMESTAMPTZ;

-- 5. Create org.interview_assignments for real database storage of assignments
CREATE TABLE IF NOT EXISTS org.interview_assignments (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id          UUID REFERENCES org.institutions(id) ON DELETE CASCADE,
  title                   VARCHAR(255) NOT NULL,
  session_type            VARCHAR(50) NOT NULL,
  assigned_by_role        VARCHAR(50),
  assigned_by_name        VARCHAR(255),
  assigned_by_email       VARCHAR(255),
  assigned_by_id          VARCHAR(255),
  target_scope            VARCHAR(50) DEFAULT 'ALL_STUDENTS',
  target_domain_or_track  VARCHAR(255),
  target_program_name     VARCHAR(255),
  target_program_names    JSONB DEFAULT '[]'::jsonb,
  target_sub_program      VARCHAR(255),
  target_department       VARCHAR(255),
  target_departments      JSONB DEFAULT '[]'::jsonb,
  target_student_id       VARCHAR(255),
  target_student_name     VARCHAR(255),
  target_class_name       VARCHAR(255),
  target_class_names      JSONB DEFAULT '[]'::jsonb,
  interview_mode          VARCHAR(50) DEFAULT 'TOPIC',
  domain_or_topic         VARCHAR(255),
  difficulty              VARCHAR(50) DEFAULT 'MEDIUM',
  listening_passage_id    VARCHAR(100),
  custom_instructions     TEXT,
  due_date                VARCHAR(50),
  start_time              VARCHAR(50),
  end_time                VARCHAR(50),
  has_time_window         BOOLEAN DEFAULT false,
  is_mandatory            BOOLEAN DEFAULT true,
  submissions             JSONB DEFAULT '[]'::jsonb,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_interview_assignments_inst ON org.interview_assignments(institution_id);
CREATE INDEX IF NOT EXISTS idx_interview_assignments_created ON org.interview_assignments(created_at DESC);

-- 6. Create org.trainer_tenures for real database storage of onboarded trainers
CREATE TABLE IF NOT EXISTS org.trainer_tenures (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id          UUID REFERENCES org.institutions(id) ON DELETE CASCADE,
  trainer_name            VARCHAR(255) NOT NULL,
  trainer_email           VARCHAR(255) NOT NULL,
  company_or_institute    VARCHAR(255),
  domain                  VARCHAR(255),
  program_id              UUID,
  is_common_trainer       BOOLEAN DEFAULT false,
  associated_program_names JSONB DEFAULT '[]'::jsonb,
  start_date              VARCHAR(50),
  end_date                VARCHAR(50),
  is_active               BOOLEAN DEFAULT true,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trainer_tenures_inst ON org.trainer_tenures(institution_id);
