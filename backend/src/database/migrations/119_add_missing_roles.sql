-- Add roles required by the frontend that are missing from the initial enum
ALTER TYPE identity.user_role ADD VALUE IF NOT EXISTS 'PLATFORM_OWNER';
ALTER TYPE identity.user_role ADD VALUE IF NOT EXISTS 'SUPER_ADMIN';
ALTER TYPE identity.user_role ADD VALUE IF NOT EXISTS 'DEPARTMENT_ADMIN';
ALTER TYPE identity.user_role ADD VALUE IF NOT EXISTS 'COUNSELLOR';

-- Seed the new roles into identity.roles (used by RBAC role_assignments)
INSERT INTO identity.roles (name, description) VALUES
  ('PLATFORM_OWNER',  'Platform-level owner with cross-institution access'),
  ('SUPER_ADMIN',     'Institution super administrator'),
  ('DEPARTMENT_ADMIN','Department administrator'),
  ('COUNSELLOR',      'Department counsellor / class faculty in-charge')
ON CONFLICT (name) DO NOTHING;
