-- Migration to add tables that frontend expects but are missing from backend schema
-- identity.pending_invites, org.department_staff, org.department_classes

-- identity.pending_invites - Stores invitation tokens for new users
CREATE TABLE IF NOT EXISTS identity.pending_invites (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token             VARCHAR(255) UNIQUE NOT NULL,
  email             VARCHAR(255) NOT NULL CHECK (email = lower(email)),
  first_name        VARCHAR(255),
  last_name         VARCHAR(255),
  name              VARCHAR(255),
  role              identity.user_role NOT NULL,
  institution_id    UUID REFERENCES org.institutions(id) ON DELETE CASCADE,
  institution_name  VARCHAR(255),
  program_id        UUID REFERENCES org.programs(id) ON DELETE CASCADE,
  department        VARCHAR(255),
  permissions       JSONB DEFAULT '[]'::jsonb,
  status            VARCHAR(50) DEFAULT 'PENDING',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at        TIMESTAMPTZ,
  accepted_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_pending_invites_token ON identity.pending_invites(token);
CREATE INDEX IF NOT EXISTS idx_pending_invites_email ON identity.pending_invites(email);
CREATE INDEX IF NOT EXISTS idx_pending_invites_status ON identity.pending_invites(status);
CREATE INDEX IF NOT EXISTS idx_pending_invites_institution ON identity.pending_invites(institution_id);

-- org.department_staff - Faculty and staff members assigned to departments
CREATE TABLE IF NOT EXISTS org.department_staff (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID REFERENCES identity.users(id) ON DELETE CASCADE,
  institution_id    UUID NOT NULL REFERENCES org.institutions(id) ON DELETE CASCADE,
  department_id     UUID REFERENCES org.departments(id) ON DELETE CASCADE,
  department        VARCHAR(255),
  name              VARCHAR(255) NOT NULL,
  email             VARCHAR(255) NOT NULL CHECK (email = lower(email)),
  staff_id          VARCHAR(100),
  designation       VARCHAR(255),
  status            VARCHAR(50) DEFAULT 'ACTIVE',
  activation_token  VARCHAR(255),
  assigned_classes  JSONB DEFAULT '[]'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_department_staff_email ON org.department_staff(email);
CREATE INDEX IF NOT EXISTS idx_department_staff_institution ON org.department_staff(institution_id);
CREATE INDEX IF NOT EXISTS idx_department_staff_department ON org.department_staff(department_id);
CREATE INDEX IF NOT EXISTS idx_department_staff_user ON org.department_staff(user_id);
CREATE INDEX IF NOT EXISTS idx_department_staff_status ON org.department_staff(status);

-- org.department_classes - Classes/sections within departments
CREATE TABLE IF NOT EXISTS org.department_classes (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id      UUID NOT NULL REFERENCES org.institutions(id) ON DELETE CASCADE,
  department_id       UUID REFERENCES org.departments(id) ON DELETE CASCADE,
  department          VARCHAR(255),
  name                VARCHAR(255) NOT NULL,
  code                VARCHAR(100),
  section             VARCHAR(50),
  batch_year          INTEGER,
  faculty_in_charge   VARCHAR(255),
  student_count       INTEGER DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_department_classes_institution ON org.department_classes(institution_id);
CREATE INDEX IF NOT EXISTS idx_department_classes_department ON org.department_classes(department_id);
CREATE INDEX IF NOT EXISTS idx_department_classes_batch_year ON org.department_classes(batch_year);
CREATE UNIQUE INDEX IF NOT EXISTS uq_department_classes_code ON org.department_classes(institution_id, code) WHERE code IS NOT NULL;

-- Add triggers for updated_at
CREATE TRIGGER trg_department_staff_updated_at
  BEFORE UPDATE ON org.department_staff
  FOR EACH ROW EXECUTE FUNCTION system.set_updated_at();

CREATE TRIGGER trg_department_classes_updated_at
  BEFORE UPDATE ON org.department_classes
  FOR EACH ROW EXECUTE FUNCTION system.set_updated_at();

-- Add helpful comments
COMMENT ON TABLE identity.pending_invites IS 'Invitation tokens for onboarding new users (Super Admins, Program Admins, Counsellors)';
COMMENT ON TABLE org.department_staff IS 'Faculty and staff members assigned to departments - can be counsellors, department admins, or faculty';
COMMENT ON TABLE org.department_classes IS 'Classes/sections within departments - groupings of students by year/section';
