-- Migration 126: Make program_id and batch_id nullable in assessment.assessment_attempts
-- Allows independent candidates and students without an assigned program/batch to take interviews freely.

ALTER TABLE assessment.assessment_attempts ALTER COLUMN program_id DROP NOT NULL;
ALTER TABLE assessment.assessment_attempts ALTER COLUMN batch_id DROP NOT NULL;

-- Update foreign keys to ON DELETE SET NULL so deleting a program/batch does not block attempt persistence
ALTER TABLE assessment.assessment_attempts DROP CONSTRAINT IF EXISTS assessment_attempts_program_id_fkey;
ALTER TABLE assessment.assessment_attempts ADD CONSTRAINT assessment_attempts_program_id_fkey 
  FOREIGN KEY (program_id) REFERENCES org.programs(id) ON DELETE SET NULL;

ALTER TABLE assessment.assessment_attempts DROP CONSTRAINT IF EXISTS assessment_attempts_batch_id_fkey;
ALTER TABLE assessment.assessment_attempts ADD CONSTRAINT assessment_attempts_batch_id_fkey 
  FOREIGN KEY (batch_id) REFERENCES org.batches(id) ON DELETE SET NULL;
